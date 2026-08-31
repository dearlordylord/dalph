import { Context, Deferred, Effect, Exit, Option, Queue, Ref, Schema, Semaphore, Stream } from "effect"
import type * as Cause from "effect/Cause"
import {
  OperationIdAllocator,
  type PlannedTaskAttemptError,
  PlannedTaskAttemptPlanner
} from "../../workflow/protocols/task-attempt-planning/plan.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import {
  DeliveryActionExecutor,
  type DeliveryActionExecutionError,
  DeliverySemanticTrace,
  type DeliveryActionResult,
  type DeliverySemanticTraceEvent
} from "./delivery-action-executor.js"
import type { DeliveryActionProposal, DeliveryProposalId } from "./delivery-action-proposal.js"
import { materializeDeliveryAction, materializedOperationId } from "./delivery-action-materialization.js"
import type { DeliveryAdmissionReservation } from "./delivery-runtime-admission.js"
import {
  makeDeliveryRuntimeAdmissionLoop,
  DeliveryRuntimeProposalOwnershipConflict
} from "./delivery-runtime-admission-loop.js"
import { attachCurrentSignal, type CurrentSignal, type DeliveryRuntimeEvaluation } from "./relations.js"
import { DeliveryRuntimeResources } from "./delivery-runtime-resources.js"
import * as RuntimeObservation from "./delivery-runtime-observation.js"
import type { PlannedAttemptProtocolController } from "../../workflow/protocols/planned-attempt-executor-work/protocol-controller.js"
import { installInterruptibleDeliveryChild } from "./delivery-child-handoff.js"
import { liveActionIsPresent, proposalIsPresent, proposalsForLiveAction } from "./live-delivery-action.js"
import type { ApplicationExiting } from "../application-exit/lifecycle-decision.js"
import {
  DeliveryRuntimePhase,
  evaluationForPhase,
  type DeliveryRuntimePhase as DeliveryRuntimePhaseType
} from "./delivery-runtime-phase.js"
import {
  classifyTaskWorkAdmissionStalledRuntimeQuiescence,
  type AvailableProposalFrontier,
  type DeliveryRuntimeQuiescence,
  type EmptyProposalFrontier
} from "./delivery-runtime-quiescence.js"
import {
  deliveryRuntimeLocalDeferralAfter,
  deliveryRuntimeLocalDeferralAppliesAt,
  type DeliveryRuntimeLocalDeferral
} from "./delivery-runtime-local-deferral.js"

export { DeliveryRuntimeProposalOwnershipConflict } from "./delivery-runtime-admission-loop.js"
export * from "./delivery-runtime-phase.js"
export type { DeliveryRuntimeQuiescence } from "./delivery-runtime-quiescence.js"

/** Reconfirmation was allowed without one exact accepted established graph, so G2 cannot be ordered after G1. */
export class DeliveryRuntimeReconfirmationStateInvalid extends Schema.TaggedError<DeliveryRuntimeReconfirmationStateInvalid>()(
  "DeliveryRuntimeReconfirmationStateInvalid",
  {
    acceptedAt: Schema.NullOr(JournalPosition),
    graphState: Schema.Literals(["GraphEstablished", "GraphNotEstablished"])
  }
) {}

type LiveOwner = RuntimeObservation.DeliveryRuntimeLiveOwnerSource

interface Completion {
  readonly acknowledged: Deferred.Deferred<void>
  readonly exit: Exit.Exit<DeliveryActionResult, DeliveryActionExecutionError | PlannedTaskAttemptError>
  readonly proposalId: DeliveryProposalId
}

type RuntimeEvent<E> =
  | { readonly _tag: "ActionCompleted"; readonly completion: Completion }
  | { readonly _tag: "EvaluationChanged"; readonly evaluation: DeliveryRuntimeEvaluation }
  | { readonly _tag: "RelationFailed"; readonly cause: Cause.Cause<E> }

/**
 * The runtime consumes one coherent current-first evaluation signal. Authority
 * facts may remove a proposal before its admitted interpreter has returned;
 * live ownership remains process-local until that exact action settles.
 */
export type DeliveryRuntimeInput<E = never> = CurrentSignal<DeliveryRuntimeEvaluation, E>

/**
 * The sole runtime-coloured consumer of the descriptive delivery relation.
 * It owns subscriptions, admission, live actions, completion, and quiescence.
 *
 * TODO: this is the largest unmodelled state machine in the system. Every
 * property the delivery requirements rest on — restart mid-attempt, capacity
 * changed mid-run, operator pause, tickets added to the graph mid-run — is
 * decided in the loop below, across `owners`, the selection semaphore, and
 * forked fibers with interrupt handlers. No model covers any of it.
 * `research/verification-bakeoff/quint/deliveryCore.qnt` is an abstraction of
 * what this loop should do and is bound to no code;
 * `specs/plannedAttemptExecutor.qnt` binds to code and stops at the executor
 * boundary. Closing that gap means an MBT driver over this loop, which is the
 * single highest-value model in the study.
 */
export const runDeliveryRuntimePhase = Effect.fn("DeliveryRuntime.runPhase")(function* <E>(
  relation: DeliveryRuntimeInput<E>,
  phase: DeliveryRuntimePhaseType = DeliveryRuntimePhase.Ordinary
): Effect.fn.Return<
  DeliveryRuntimeQuiescence,
  | E
  | ApplicationExiting
  | DeliveryActionExecutionError
  | DeliveryRuntimeProposalOwnershipConflict
  | DeliveryRuntimeReconfirmationStateInvalid
  | PlannedTaskAttemptError,
  | DeliveryActionExecutor
  | RuntimeObservation.DeliveryRuntimeObservationPublication
  | DeliveryRuntimeResources
  | OperationIdAllocator
  | PlannedAttemptProtocolController
  | PlannedTaskAttemptPlanner
> {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const scope = yield* Effect.scope
      const executor = yield* DeliveryActionExecutor
      const resources = yield* DeliveryRuntimeResources
      const runtimeObservation = yield* RuntimeObservation.DeliveryRuntimeObservationPublication
      const operationAllocator = yield* OperationIdAllocator
      const attemptPlanner = yield* PlannedTaskAttemptPlanner
      const ambient = yield* Effect.context<never>()
      const semanticTrace = Context.getOption(ambient, DeliverySemanticTrace)
      const emit = (event: DeliverySemanticTraceEvent) =>
        Option.match(semanticTrace, { onNone: () => Effect.void, onSome: ({ emit }) => emit(event) })
      const events = yield* Queue.unbounded<RuntimeEvent<E>>()
      const owners = yield* Ref.make<ReadonlyMap<DeliveryProposalId, LiveOwner>>(new Map())
      const localDeferrals = yield* Ref.make<ReadonlyMap<DeliveryProposalId, DeliveryRuntimeLocalDeferral>>(new Map())
      const latest = yield* Ref.make<Option.Option<DeliveryRuntimeEvaluation>>(Option.none())
      const selectionGate = yield* Semaphore.make(1)
      const integrationTargets = resources.integrationTargets
      const attachment = yield* attachCurrentSignal(relation)
      const first = evaluationForPhase(phase, attachment.current)
      yield* Ref.set(latest, Option.some(first))
      yield* runtimeObservation.publish(first, [])
      const admission = yield* resources.makeAdmissionController(first.taskWork)
      const evaluationsSubscribed = yield* Deferred.make<void>()

      yield* Stream.concat(
        Stream.fromEffect(Deferred.succeed(evaluationsSubscribed, undefined)).pipe(Stream.drain),
        attachment.changes
      ).pipe(
        Stream.runForEach((evaluation) => Queue.offer(events, { _tag: "EvaluationChanged", evaluation })),
        Effect.catchCause((cause) => Queue.offer(events, { _tag: "RelationFailed", cause })),
        Effect.forkIn(scope)
      )
      yield* Deferred.await(evaluationsSubscribed)

      const publishRuntimeObservationInsideGate = Effect.fn("DeliveryRuntime.publishObservationInsideGate")(
        function* () {
          const evaluation = Option.getOrThrow(yield* Ref.get(latest))
          yield* runtimeObservation.publish(
            evaluation,
            yield* RuntimeObservation.deliveryRuntimeLiveOwnerSnapshots(yield* Ref.get(owners))
          )
        }
      )
      const publishRuntimeObservation = Effect.fn("DeliveryRuntime.publishObservation")(() =>
        selectionGate.withPermit(publishRuntimeObservationInsideGate())
      )

      yield* publishRuntimeObservation()

      const start = Effect.fn("DeliveryRuntime.startProposal")(function* (reservation: DeliveryAdmissionReservation) {
        const proposal = reservation.proposal
        const owner = yield* RuntimeObservation.makeDeliveryRuntimeLiveOwner(reservation)
        yield* Ref.update(owners, (current) => new Map(current).set(proposal.id, owner))
        yield* publishRuntimeObservationInsideGate()
        yield* emit({ _tag: "ProposalAdmitted", proposalId: proposal.id })
        const run = Effect.gen(function* () {
          const action = yield* materializeDeliveryAction(proposal).pipe(
            Effect.provideService(OperationIdAllocator, operationAllocator),
            Effect.provideService(PlannedTaskAttemptPlanner, attemptPlanner)
          )
          const operationId = materializedOperationId(action)
          if (operationId !== null) yield* owner.materialize(operationId)
          yield* publishRuntimeObservation()
          return yield* executor.execute(
            action,
            RuntimeObservation.makeObservedDeliveryActionLease(
              admission,
              integrationTargets,
              owner,
              publishRuntimeObservation()
            )
          )
        })
        const releaseInterruptedOwner = selectionGate.withPermit(
          owner.isSettled.pipe(
            Effect.flatMap((isSettled) =>
              isSettled
                ? Effect.void
                : admission
                    .rollback(reservation, false)
                    .pipe(
                      Effect.andThen(
                        Ref.update(owners, (current) => new Map([...current].filter(([id]) => id !== proposal.id)))
                      ),
                      Effect.andThen(publishRuntimeObservationInsideGate())
                    )
            )
          )
        )
        const child = Effect.gen(function* () {
          const exit = yield* Effect.exit(run)
          const acknowledged = yield* Deferred.make<void>()
          yield* Queue.offer(events, {
            _tag: "ActionCompleted",
            completion: { acknowledged, exit, proposalId: proposal.id }
          })
          yield* Deferred.await(acknowledged)
        })
        return yield* installInterruptibleDeliveryChild(scope, child, releaseInterruptedOwner)
      })

      const reserveAndStart = Effect.fn("DeliveryRuntime.reserveAndStart")((proposal: DeliveryActionProposal) =>
        Effect.uninterruptible(
          Effect.gen(function* () {
            const result = yield* admission.tryReserve(proposal)
            if (result._tag === "Deferred") return result
            const started = yield* start(result.reservation)
            return { _tag: "Started" as const, started }
          })
        )
      )

      const admissionLoop = yield* makeDeliveryRuntimeAdmissionLoop({
        admission,
        localDeferrals,
        emit,
        latest,
        owners,
        publishRuntimeObservationInsideGate,
        reserveAndStart,
        selectionGate
      })

      const applyEvaluation = Effect.fn("DeliveryRuntime.applyEvaluation")(function* (
        evaluation: DeliveryRuntimeEvaluation
      ) {
        const phaseEvaluation = evaluationForPhase(phase, evaluation)
        yield* selectionGate.withPermit(
          Effect.gen(function* () {
            const current = Option.getOrThrow(yield* Ref.get(latest))
            // Relation refreshes can be queued behind a newer journal publication while an action is settling.
            // Never let that older frontier resurrect an already-observed operation or its stale proposal.
            if (
              current.acceptedAt !== null &&
              (phaseEvaluation.acceptedAt === null || phaseEvaluation.acceptedAt < current.acceptedAt)
            ) {
              return
            }
            yield* Ref.set(latest, Option.some(phaseEvaluation))
            yield* Ref.update(
              localDeferrals,
              (current) =>
                new Map(
                  [...current].filter(
                    ([proposalId, localDeferral]) =>
                      deliveryRuntimeLocalDeferralAppliesAt(localDeferral, phaseEvaluation.acceptedAt) &&
                      proposalIsPresent(phaseEvaluation.proposedActions, proposalId)
                  )
                )
            )
            yield* admission.synchronize(phaseEvaluation.taskWork)
            yield* admissionLoop.pruneSettledOwners(phaseEvaluation.proposedActions)
            yield* publishRuntimeObservationInsideGate()
          })
        )
      })

      const applyCompletion = Effect.fn("DeliveryRuntime.applyCompletion")(function* (completion: Completion) {
        const result = yield* selectionGate.withPermit(
          Effect.gen(function* () {
            const owner = Option.getOrThrow(Option.fromUndefinedOr((yield* Ref.get(owners)).get(completion.proposalId)))
            const intentRecorded = yield* owner.intentRecorded
            if (Exit.isFailure(completion.exit)) {
              yield* admission.rollback(owner.reservation, intentRecorded)
              yield* owner.settle
              yield* publishRuntimeObservationInsideGate()
              yield* Ref.update(
                owners,
                (current) => new Map([...current].filter(([id]) => id !== completion.proposalId))
              )
              yield* publishRuntimeObservationInsideGate()
            } else {
              yield* admission.complete(owner.reservation)
              yield* emit({ _tag: "ActionOutcome", result: completion.exit.value })
              yield* owner.settle
              yield* publishRuntimeObservationInsideGate()
              // Sample the accepted signal before deciding whether this owner coalesces with the next proposal.
              const current = Option.getOrThrow(yield* Ref.get(latest))
              yield* Ref.set(latest, Option.some(current))
              yield* admission.synchronize(current.taskWork)
              const localDeferral = deliveryRuntimeLocalDeferralAfter(
                completion.exit.value,
                owner.proposal,
                current.acceptedAt
              )
              if (Option.isSome(localDeferral)) {
                const proposalIds =
                  localDeferral.value._tag === "PassiveOwnerAttached"
                    ? proposalsForLiveAction(current.proposedActions, owner.proposal).map(({ id }) => id)
                    : proposalIsPresent(current.proposedActions, completion.proposalId)
                      ? [completion.proposalId]
                      : []
                if (proposalIds.length > 0) {
                  yield* Ref.update(
                    localDeferrals,
                    (deferred) =>
                      new Map([
                        ...deferred,
                        ...proposalIds.map((proposalId) => [proposalId, localDeferral.value] as const)
                      ])
                  )
                }
                yield* Ref.update(
                  owners,
                  (owners) => new Map([...owners].filter(([id]) => id !== completion.proposalId))
                )
                yield* publishRuntimeObservationInsideGate()
              } else if (!liveActionIsPresent(current.proposedActions, owner.proposal)) {
                yield* Ref.update(
                  owners,
                  (owners) => new Map([...owners].filter(([id]) => id !== completion.proposalId))
                )
                yield* publishRuntimeObservationInsideGate()
              }
            }
            return completion.exit
          })
        )
        yield* Deferred.succeed(completion.acknowledged, undefined)
        return result
      })

      const runtimeQuiescence = Effect.fn("DeliveryRuntime.quiescence")(function* (
        current: DeliveryRuntimeEvaluation,
        live: ReadonlyMap<DeliveryProposalId, LiveOwner>
      ) {
        const proposedActions = current.proposedActions
        if (proposedActions._tag === "DeliveryProposalOwnershipConflict") {
          return yield* new DeliveryRuntimeProposalOwnershipConflict({
            proposalIds: proposedActions.conflicts.map(({ id }) => id)
          })
        }
        const deferred = yield* Ref.get(localDeferrals)
        const locallyRunnableProposals = proposedActions.proposals.filter(({ id }) => {
          const localDeferral = deferred.get(id)
          return (
            localDeferral === undefined || !deliveryRuntimeLocalDeferralAppliesAt(localDeferral, current.acceptedAt)
          )
        })
        const locallyRunnableFrontier: AvailableProposalFrontier = {
          ...proposedActions,
          proposals: locallyRunnableProposals
        }
        const everyProposalIsLocallyDeferred = locallyRunnableProposals.length === 0
        const activeRefreshG2Pending =
          phase._tag === "ActiveRefreshPreG2RuntimePhase" && current.activeRefreshBoundary !== undefined
        /**
         * After G2, an active refresh may deliberately retain a Running
         * executor position while the relation exposes independent work. If
         * that position fills the whole configured capacity and no local
         * action owner remains, waiting for another runtime event cannot free
         * it: the retained executor responsibility is outside this phase.
         * Return an unsettled quiescence while leaving the proposal in the
         * descriptive relation so a later ordinary activation can retry it.
         */
        const postG2RetainedCapacityBlocks =
          phase._tag === "ActiveRefreshPostG2RuntimePhase" &&
          current.activeRefreshBoundary !== undefined &&
          current.taskWork.held.length >= Number(current.taskWork.capacity) &&
          current.taskWork.held.every(({ correlation }) =>
            current.activeRefreshBoundary?.reconciledAttempts.some(
              (subject) => subject.runId === correlation.runId && subject.attemptId === correlation.attemptId
            )
          ) &&
          locallyRunnableProposals.length > 0 &&
          locallyRunnableProposals.every(
            ({ admission: { taskWorkPosition } }) =>
              taskWorkPosition._tag === "TaskWorkPositionRequired" && taskWorkPosition.mode === "ReserveOrReuse"
          )
        const ordinaryTaskWorkAdmissionStalled =
          phase._tag === "OrdinaryDeliveryRuntimePhase"
            ? classifyTaskWorkAdmissionStalledRuntimeQuiescence(current, locallyRunnableFrontier)
            : Option.none()
        if (
          live.size !== 0 ||
          (!activeRefreshG2Pending &&
            !everyProposalIsLocallyDeferred &&
            !postG2RetainedCapacityBlocks &&
            Option.isNone(ordinaryTaskWorkAdmissionStalled))
        ) {
          return Option.none<DeliveryRuntimeQuiescence>()
        }
        if (Option.isSome(ordinaryTaskWorkAdmissionStalled)) {
          return Option.some<DeliveryRuntimeQuiescence>(ordinaryTaskWorkAdmissionStalled.value)
        }
        const empty: EmptyProposalFrontier = { ...locallyRunnableFrontier, proposals: [] }
        if (current.quiescence._tag === "QuiescencePassive") {
          const quiescence: DeliveryRuntimeQuiescence = {
            _tag: "PassiveRuntimeQuiescence",
            acceptedAt: current.acceptedAt,
            current: current.current,
            disposition: current.quiescence,
            proposedActions: empty,
            ...(current.activeRefreshBoundary === undefined
              ? {}
              : { activeRefreshBoundary: current.activeRefreshBoundary })
          }
          return Option.some(quiescence)
        }
        const graph = current.current.trackerGraph
        if (graph._tag !== "GraphEstablished" || current.acceptedAt === null) {
          return yield* new DeliveryRuntimeReconfirmationStateInvalid({
            acceptedAt: current.acceptedAt,
            graphState: graph._tag
          })
        }
        const quiescence: DeliveryRuntimeQuiescence = {
          _tag: "TrackerReconfirmationQuiescence",
          acceptedAt: current.acceptedAt,
          current: { ...current.current, trackerGraph: graph },
          disposition: current.quiescence,
          proposedActions: empty,
          ...(current.activeRefreshBoundary === undefined
            ? {}
            : { activeRefreshBoundary: current.activeRefreshBoundary })
        }
        return Option.some(quiescence)
      })

      const applyRuntimeEvent = Effect.fn("DeliveryRuntime.applyEvent")(function* (event: RuntimeEvent<E>) {
        if (event._tag === "RelationFailed") return yield* Effect.failCause(event.cause)
        if (event._tag === "EvaluationChanged") {
          yield* applyEvaluation(event.evaluation)
          return
        }
        const exit = yield* applyCompletion(event.completion)
        if (Exit.isFailure(exit)) return yield* Effect.failCause(exit.cause)
      })

      for (;;) {
        const current = Option.getOrThrow(yield* Ref.get(latest))
        const activeRefreshG2Pending =
          phase._tag === "ActiveRefreshPreG2RuntimePhase" && current.activeRefreshBoundary !== undefined
        if (!activeRefreshG2Pending) {
          while (yield* admissionLoop.admitPass()) yield* Effect.yieldNow
        }

        const currentAfterAdmission = Option.getOrThrow(yield* Ref.get(latest))
        const live = yield* Ref.get(owners)
        const quiescence = yield* runtimeQuiescence(currentAfterAdmission, live)
        if (Option.isSome(quiescence)) {
          yield* publishRuntimeObservation()
          return quiescence.value
        }
        yield* applyRuntimeEvent(yield* Queue.take(events))
      }
    })
  )
})

/** Runs one standalone runtime phase and releases its process-local resources at the phase boundary. */
export const runDeliveryRuntime = <E>(relation: DeliveryRuntimeInput<E>) =>
  runDeliveryRuntimePhase(relation).pipe(
    Effect.ensuring(
      Effect.gen(function* () {
        yield* Effect.flatMap(DeliveryRuntimeResources, ({ integrationTargets }) => integrationTargets.releaseAll)
        yield* Effect.flatMap(RuntimeObservation.DeliveryRuntimeObservationPublication, ({ close }) => close)
      })
    )
  )
