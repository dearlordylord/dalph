import { Context, Deferred, Effect, Exit, Option, Queue, Ref, Schema, Semaphore, Stream } from "effect"
import type * as Cause from "effect/Cause"
import {
  OperationIdAllocator,
  type PlannedTaskAttemptError,
  PlannedTaskAttemptPlanner
} from "../../workflow/protocols/task-attempt-planning/plan.js"
import type { OperationId } from "../../workflow/identity.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import {
  DeliveryActionExecutor,
  DeliveryActionProtocolAdmissionMissing,
  type DeliveryActionExecutionError,
  DeliverySemanticTrace,
  type DeliveryActionExecutionLease,
  type DeliveryActionResult,
  type DeliverySemanticTraceEvent
} from "./delivery-action-executor.js"
import type { DeliveryActionProposal } from "./delivery-action-proposal.js"
import { DeliveryProposalId } from "./delivery-action-proposal.js"
import { materializeDeliveryAction, materializedOperationId } from "./delivery-action-materialization.js"
import {
  type DeliveryAdmissionReservation,
  type DeliveryRuntimeAdmissionController
} from "./delivery-runtime-admission.js"
import {
  type CurrentSignal,
  type DeliveryProposalFrontier,
  type DeliveryQuiescenceDisposition,
  type DeliveryRuntimeEvaluation,
  type DeliveryRuntimeSnapshot,
  type TrackerGraphState
} from "./relations.js"
import { DeliveryRuntimeResources } from "./delivery-runtime-resources.js"
import {
  type PlannedAttemptProtocolController,
  withPlannedAttemptProtocolPermit
} from "../../workflow/protocols/planned-attempt-executor-work/protocol-controller.js"
import { installInterruptibleDeliveryChild } from "./delivery-child-handoff.js"
import {
  liveActionIsPresent,
  liveActionKeyOf,
  type LiveDeliveryActionKey,
  proposalIsAvailable
} from "./live-delivery-action.js"

/** Two lower relations claim the same proposal identity, so no action is authorized. */
export class DeliveryRuntimeProposalOwnershipConflict extends Schema.TaggedError<DeliveryRuntimeProposalOwnershipConflict>()(
  "DeliveryRuntimeProposalOwnershipConflict",
  { proposalIds: Schema.Array(DeliveryProposalId) }
) {}

/** Reconfirmation was allowed without one exact accepted established graph, so G2 cannot be ordered after G1. */
export class DeliveryRuntimeReconfirmationStateInvalid extends Schema.TaggedError<DeliveryRuntimeReconfirmationStateInvalid>()(
  "DeliveryRuntimeReconfirmationStateInvalid",
  {
    acceptedAt: Schema.NullOr(JournalPosition),
    graphState: Schema.Literals(["GraphEstablished", "GraphNotEstablished"])
  }
) {}

interface LiveOwner {
  readonly intentRecorded: Ref.Ref<boolean>
  readonly operationId: Ref.Ref<OperationId | null>
  readonly proposal: DeliveryActionProposal
  readonly reservation: DeliveryAdmissionReservation
  readonly settled: Ref.Ref<boolean>
}

interface Completion {
  readonly acknowledged: Deferred.Deferred<void>
  readonly exit: Exit.Exit<DeliveryActionResult, DeliveryActionExecutionError | PlannedTaskAttemptError>
  readonly proposalId: DeliveryProposalId
}

type RuntimeEvent<E> =
  | { readonly _tag: "ActionCompleted"; readonly completion: Completion }
  | { readonly _tag: "EvaluationChanged"; readonly evaluation: DeliveryRuntimeEvaluation }
  | { readonly _tag: "RelationFailed"; readonly cause: Cause.Cause<E> }

export const proposalIsPresent = (frontier: DeliveryProposalFrontier, proposalId: DeliveryProposalId): boolean =>
  frontier._tag === "DeliveryProposalsAvailable"
    ? frontier.proposals.some(({ id }) => id === proposalId)
    : frontier.conflicts.some(({ id }) => id === proposalId)

const proposalTaskId = (proposal: DeliveryActionProposal) => {
  const requirement = proposal.admission.taskWorkPosition
  return requirement._tag === "TaskWorkPositionRequired" ? requirement.taskId : undefined
}

const makeLease = (
  admission: DeliveryRuntimeAdmissionController,
  integrationTargets: DeliveryActionExecutionLease["integrationTargets"],
  owner: LiveOwner
): DeliveryActionExecutionLease => ({
  acceptIntegrationTargetOwnership:
    owner.reservation.acquiredIntegrationResponsibility === null
      ? Effect.void
      : integrationTargets.publishAcceptedOwnership(owner.reservation.acquiredIntegrationResponsibility),
  bindPlannedAttemptPosition: (correlation) => {
    const taskId = proposalTaskId(owner.proposal)
    return taskId === undefined ? Effect.void : admission.bindPlannedAttemptPosition(taskId, correlation)
  },
  integrationTargets,
  recordIntent: () => Ref.set(owner.intentRecorded, true),
  releasePlannedAttemptPosition: admission.releasePlannedAttemptPosition,
  withPlannedAttemptProtocol: (correlation, effect) => {
    const reservation = owner.reservation
    return reservation._tag === "NoPlannedAttemptProtocolAdmission"
      ? Effect.fail(new DeliveryActionProtocolAdmissionMissing({ correlation, proposalId: reservation.proposal.id }))
      : withPlannedAttemptProtocolPermit(reservation.permit, correlation, effect(reservation.permit))
  }
})

/**
 * The runtime consumes one coherent current-first evaluation signal. Authority
 * facts may remove a proposal before its admitted interpreter has returned;
 * live ownership remains process-local until that exact action settles.
 */
export type DeliveryRuntimeInput<E = never> = CurrentSignal<DeliveryRuntimeEvaluation, E>

type AvailableProposalFrontier = Extract<DeliveryProposalFrontier, { readonly _tag: "DeliveryProposalsAvailable" }>
type EmptyProposalFrontier = Omit<AvailableProposalFrontier, "proposals"> & { readonly proposals: readonly [] }
type EstablishedTrackerGraph = Extract<TrackerGraphState, { readonly _tag: "GraphEstablished" }>
type EstablishedRuntimeSnapshot = Omit<DeliveryRuntimeSnapshot, "trackerGraph"> & {
  readonly trackerGraph: EstablishedTrackerGraph
}

/** The exact descriptive state observed after no executable or admitted action remains. */
export type DeliveryRuntimeQuiescence =
  | {
      readonly _tag: "PassiveRuntimeQuiescence"
      readonly acceptedAt: DeliveryRuntimeEvaluation["acceptedAt"]
      readonly current: DeliveryRuntimeSnapshot
      readonly disposition: Extract<DeliveryQuiescenceDisposition, { readonly _tag: "QuiescencePassive" }>
      readonly proposedActions: EmptyProposalFrontier
    }
  | {
      readonly _tag: "TrackerReconfirmationQuiescence"
      readonly acceptedAt: JournalPosition
      readonly current: EstablishedRuntimeSnapshot
      readonly disposition: Extract<DeliveryQuiescenceDisposition, { readonly _tag: "TrackerReconfirmationAllowed" }>
      readonly proposedActions: EmptyProposalFrontier
    }

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
  relation: DeliveryRuntimeInput<E>
): Effect.fn.Return<
  DeliveryRuntimeQuiescence,
  | E
  | DeliveryActionExecutionError
  | DeliveryRuntimeProposalOwnershipConflict
  | DeliveryRuntimeReconfirmationStateInvalid
  | PlannedTaskAttemptError,
  | DeliveryActionExecutor
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
      const operationAllocator = yield* OperationIdAllocator
      const attemptPlanner = yield* PlannedTaskAttemptPlanner
      const ambient = yield* Effect.context<never>()
      const semanticTrace = Context.getOption(ambient, DeliverySemanticTrace)
      const emit = (event: DeliverySemanticTraceEvent) =>
        Option.match(semanticTrace, { onNone: () => Effect.void, onSome: ({ emit }) => emit(event) })
      const events = yield* Queue.unbounded<RuntimeEvent<E>>()
      const owners = yield* Ref.make<ReadonlyMap<DeliveryProposalId, LiveOwner>>(new Map())
      const deferredAt = yield* Ref.make<ReadonlyMap<DeliveryProposalId, JournalPosition | null>>(new Map())
      const latest = yield* Ref.make<Option.Option<DeliveryRuntimeEvaluation>>(Option.none())
      const selectionGate = yield* Semaphore.make(1)
      const integrationTargets = resources.integrationTargets
      const first = yield* relation.get
      yield* Ref.set(latest, Option.some(first))
      const admission = yield* resources.makeAdmissionController(first.taskWork)
      const evaluationsSubscribed = yield* Deferred.make<void>()

      yield* relation.changes.pipe(
        Stream.tap(() => Deferred.succeed(evaluationsSubscribed, undefined)),
        Stream.drop(1),
        Stream.runForEach((evaluation) => Queue.offer(events, { _tag: "EvaluationChanged", evaluation })),
        Effect.catchCause((cause) => Queue.offer(events, { _tag: "RelationFailed", cause })),
        Effect.forkIn(scope)
      )
      yield* Deferred.await(evaluationsSubscribed)
      // Close the interval between the initial sample and the live subscription.
      const subscribedCurrent = yield* relation.get
      yield* Ref.set(latest, Option.some(subscribedCurrent))
      yield* admission.synchronize(subscribedCurrent.taskWork)

      const start = Effect.fn("DeliveryRuntime.startProposal")(function* (reservation: DeliveryAdmissionReservation) {
        const proposal = reservation.proposal
        const intentRecorded = yield* Ref.make(false)
        const operationId = yield* Ref.make<OperationId | null>(null)
        const settled = yield* Ref.make(false)
        const owner: LiveOwner = { intentRecorded, operationId, proposal, reservation, settled }
        yield* Ref.update(owners, (current) => new Map(current).set(proposal.id, owner))
        yield* emit({ _tag: "ProposalAdmitted", proposalId: proposal.id })
        const run = Effect.gen(function* () {
          const action = yield* materializeDeliveryAction(proposal).pipe(
            Effect.provideService(OperationIdAllocator, operationAllocator),
            Effect.provideService(PlannedTaskAttemptPlanner, attemptPlanner)
          )
          yield* Ref.set(operationId, materializedOperationId(action))
          return yield* executor.execute(action, makeLease(admission, integrationTargets, owner))
        })
        const releaseInterruptedOwner = selectionGate.withPermit(
          Ref.get(settled).pipe(
            Effect.flatMap((isSettled) =>
              isSettled
                ? Effect.void
                : admission
                    .rollback(reservation, false)
                    .pipe(
                      Effect.andThen(
                        Ref.update(owners, (current) => new Map([...current].filter(([id]) => id !== proposal.id)))
                      )
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

      const admitLaterAvailableProposal = Effect.fn("DeliveryRuntime.admitLaterAvailableProposal")(function* (
        proposals: ReadonlyArray<DeliveryActionProposal>,
        deferredIndex: number,
        live: ReadonlyMap<DeliveryProposalId, LiveOwner>,
        liveActionKeys: ReadonlySet<LiveDeliveryActionKey>,
        liveOperationIds: ReadonlySet<OperationId>,
        deferred: ReadonlyMap<DeliveryProposalId, JournalPosition | null>,
        acceptedAt: JournalPosition | null
      ) {
        for (const independent of proposals.slice(deferredIndex + 1)) {
          if (!proposalIsAvailable(independent, live, liveActionKeys, liveOperationIds, deferred, acceptedAt)) continue
          const laterReservation = yield* reserveAndStart(independent)
          if (laterReservation._tag === "Started") {
            return laterReservation.started
          }
          yield* emit({ _tag: "ProposalDeferred", proposalId: independent.id, reason: laterReservation.reason })
        }
        return false
      })

      const admitPass = Effect.fn("DeliveryRuntime.admitPass")(function* () {
        return yield* selectionGate.withPermit(
          Effect.gen(function* () {
            const current = Option.getOrThrow(yield* Ref.get(latest))
            yield* admission.synchronize(current.taskWork)
            const proposedActions = current.proposedActions
            if (proposedActions._tag === "DeliveryProposalOwnershipConflict") {
              return yield* new DeliveryRuntimeProposalOwnershipConflict({
                proposalIds: proposedActions.conflicts.map(({ id }) => id)
              })
            }
            const live = yield* Ref.get(owners)
            const deferred = yield* Ref.get(deferredAt)
            const liveActionKeys = new Set([...live.values()].map(({ proposal }) => liveActionKeyOf(proposal)))
            const liveOperationIds = new Set(
              (yield* Effect.forEach(live.values(), ({ operationId }) => Ref.get(operationId))).filter(
                (operationId): operationId is OperationId => operationId !== null
              )
            )
            const proposal = proposedActions.proposals.find((candidate) =>
              proposalIsAvailable(candidate, live, liveActionKeys, liveOperationIds, deferred, current.acceptedAt)
            )
            if (proposal === undefined) return false
            const reservation = yield* reserveAndStart(proposal)
            if (reservation._tag === "Deferred") {
              yield* emit({ _tag: "ProposalDeferred", proposalId: proposal.id, reason: reservation.reason })
              return yield* admitLaterAvailableProposal(
                proposedActions.proposals,
                proposedActions.proposals.findIndex(({ id }) => id === proposal.id),
                live,
                liveActionKeys,
                liveOperationIds,
                deferred,
                current.acceptedAt
              )
            }
            return reservation.started
          })
        )
      })

      /** Releases a settled owner only after its exact proposal disappeared from the ordinary signal. */
      const pruneSettledOwners = Effect.fn("DeliveryRuntime.pruneSettledOwners")(function* (
        frontier: DeliveryProposalFrontier
      ) {
        const current = yield* Ref.get(owners)
        const removable: Array<LiveOwner> = []
        for (const owner of current.values()) {
          if ((yield* Ref.get(owner.settled)) && !liveActionIsPresent(frontier, owner.proposal)) {
            removable.push(owner)
          }
        }
        if (removable.length === 0) return
        const removableIds = new Set(removable.map(({ proposal }) => proposal.id))
        yield* Ref.update(owners, (current) => new Map([...current].filter(([id]) => !removableIds.has(id))))
      })

      const applyEvaluation = Effect.fn("DeliveryRuntime.applyEvaluation")(function* (
        evaluation: DeliveryRuntimeEvaluation
      ) {
        yield* Ref.set(latest, Option.some(evaluation))
        yield* Ref.update(
          deferredAt,
          (current) =>
            new Map(
              [...current].filter(
                ([proposalId, acceptedAt]) =>
                  acceptedAt === evaluation.acceptedAt && proposalIsPresent(evaluation.proposedActions, proposalId)
              )
            )
        )
        yield* admission.synchronize(evaluation.taskWork)
        yield* selectionGate.withPermit(pruneSettledOwners(evaluation.proposedActions))
      })

      const applyCompletion = Effect.fn("DeliveryRuntime.applyCompletion")(function* (completion: Completion) {
        const result = yield* selectionGate.withPermit(
          Effect.gen(function* () {
            const owner = Option.getOrThrow(Option.fromUndefinedOr((yield* Ref.get(owners)).get(completion.proposalId)))
            const intentRecorded = yield* Ref.get(owner.intentRecorded)
            if (Exit.isFailure(completion.exit)) {
              yield* admission.rollback(owner.reservation, intentRecorded)
              yield* Ref.set(owner.settled, true)
              yield* Ref.update(
                owners,
                (current) => new Map([...current].filter(([id]) => id !== completion.proposalId))
              )
            } else {
              yield* admission.complete(owner.reservation)
              yield* emit({
                _tag: "ActionOutcome",
                outcome: completion.exit.value._tag,
                proposalId: completion.proposalId
              })
              yield* Ref.set(owner.settled, true)
              const current = Option.getOrThrow(yield* Ref.get(latest))
              if (completion.exit.value._tag === "ActionDeferred") {
                yield* Ref.update(deferredAt, (deferred) =>
                  new Map(deferred).set(completion.proposalId, current.acceptedAt)
                )
                yield* Ref.update(
                  owners,
                  (owners) => new Map([...owners].filter(([id]) => id !== completion.proposalId))
                )
              } else if (!liveActionIsPresent(current.proposedActions, owner.proposal)) {
                yield* Ref.update(
                  owners,
                  (owners) => new Map([...owners].filter(([id]) => id !== completion.proposalId))
                )
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
        /* v8 ignore start -- admitPass rejects a conflicting frontier before finality is evaluated. */
        if (proposedActions._tag === "DeliveryProposalOwnershipConflict")
          return Option.none<DeliveryRuntimeQuiescence>()
        /* v8 ignore stop */
        if (live.size !== 0 || proposedActions.proposals.length !== 0) {
          return Option.none<DeliveryRuntimeQuiescence>()
        }
        const empty: EmptyProposalFrontier = { ...proposedActions, proposals: [] }
        if (current.quiescence._tag === "QuiescencePassive") {
          const quiescence: DeliveryRuntimeQuiescence = {
            _tag: "PassiveRuntimeQuiescence",
            acceptedAt: current.acceptedAt,
            current: current.current,
            disposition: current.quiescence,
            proposedActions: empty
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
          proposedActions: empty
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
        while (yield* admitPass()) yield* Effect.yieldNow

        const current = Option.getOrThrow(yield* Ref.get(latest))
        const live = yield* Ref.get(owners)
        const quiescence = yield* runtimeQuiescence(current, live)
        if (Option.isSome(quiescence)) return quiescence.value

        yield* applyRuntimeEvent(yield* Queue.take(events))
      }
    })
  )
})

/** Runs one standalone runtime phase and releases its process-local resources at the phase boundary. */
export const runDeliveryRuntime = <E>(relation: DeliveryRuntimeInput<E>) =>
  runDeliveryRuntimePhase(relation).pipe(
    Effect.ensuring(Effect.flatMap(DeliveryRuntimeResources, ({ integrationTargets }) => integrationTargets.releaseAll))
  )
