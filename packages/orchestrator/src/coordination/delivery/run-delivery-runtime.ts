import { Context, Deferred, Effect, Exit, Option, Queue, Ref, Schema, Semaphore, Stream } from "effect"
import type * as Cause from "effect/Cause"
import {
  OperationIdAllocator,
  type PlannedTaskAttemptError,
  PlannedTaskAttemptPlanner
} from "../../workflow/protocols/task-attempt-planning/plan.js"
import { taskClaimReacquisitionOperationId } from "../../workflow/protocols/task-claim-reacquisition/plan.js"
import { OperationId } from "../../workflow/identity.js"
import type { RunFinalityProof } from "../frontier/run-finality.js"
import {
  DeliveryActionExecutor,
  type DeliveryActionExecutionError,
  DeliverySemanticTrace,
  type DeliveryActionExecutionLease,
  type DeliveryActionResult,
  type DeliverySemanticTraceEvent,
  type MaterializedDeliveryAction
} from "./delivery-action-executor.js"
import type {
  AcceptedIdentityDeliveryProposal,
  DeliveryActionProposal,
  FreshIdentityDeliveryProposal,
  IdentityFreeDeliveryProposal
} from "./delivery-action-proposal.js"
import { DeliveryProposalId } from "./delivery-action-proposal.js"
import {
  makeDeliveryRuntimeAdmissionController,
  type DeliveryAdmissionReservation,
  type DeliveryRuntimeAdmissionController
} from "./delivery-runtime-admission.js"
import type { DeliveryRelationRevision, DeliveryRuntimeEvaluation, DeliveryRuntimeRelation } from "./relations.js"
import { DeliveryRuntimeResources } from "./delivery-runtime-resources.js"

/** Two lower relations claim the same proposal identity, so no action is authorized. */
export class DeliveryRuntimeProposalOwnershipConflict extends Schema.TaggedErrorClass<DeliveryRuntimeProposalOwnershipConflict>()(
  "DeliveryRuntimeProposalOwnershipConflict",
  { proposalIds: Schema.Array(DeliveryProposalId) }
) {}

type FreshOperationProposal = Extract<
  FreshIdentityDeliveryProposal,
  { readonly actionIdentity: { readonly _tag: "FreshOperationIdRequired" } }
>

const isAcceptedOperationProposal = (proposal: DeliveryActionProposal): proposal is AcceptedIdentityDeliveryProposal =>
  proposal.actionIdentity._tag === "ExistingOperationId"

const isIdentityFreeProposal = (proposal: DeliveryActionProposal): proposal is IdentityFreeDeliveryProposal =>
  proposal.actionIdentity._tag === "NoWorkflowOperationIdentity"

const isFreshOperationProposal = (proposal: DeliveryActionProposal): proposal is FreshOperationProposal =>
  proposal.actionIdentity._tag === "FreshOperationIdRequired"

const operationIdFor = Effect.fn("DeliveryRuntime.materializeOperationId")(function* (
  proposal: FreshOperationProposal
) {
  const source = proposal.actionIdentity.source
  if (source._tag === "TaskClaimReacquisitionRequest") {
    return taskClaimReacquisitionOperationId(source.requestId)
  }
  if (source._tag === "ExternalSuccessReleaseClaim") {
    return OperationId.make(`external-success-release:${source.claimOperationId}`)
  }
  const allocator = yield* OperationIdAllocator
  return yield* allocator.allocate()
})

/** Allocates a genuinely fresh identity only after the proposal has been admitted. */
const materializeDeliveryAction = Effect.fn("DeliveryRuntime.materializeAction")(function* (
  proposal: DeliveryActionProposal
): Effect.fn.Return<
  MaterializedDeliveryAction,
  PlannedTaskAttemptError,
  OperationIdAllocator | PlannedTaskAttemptPlanner
> {
  if (isAcceptedOperationProposal(proposal)) return { _tag: "AcceptedOperationAction", proposal }
  if (isIdentityFreeProposal(proposal)) return { _tag: "IdentityFreeAction", proposal }
  if (isFreshOperationProposal(proposal)) {
    return { _tag: "FreshOperationAction", operationId: yield* operationIdFor(proposal), proposal }
  }
  const allocator = yield* OperationIdAllocator
  const planner = yield* PlannedTaskAttemptPlanner
  return {
    _tag: "FreshAttemptAction",
    operationId: yield* allocator.allocate(),
    plannedAttempt: yield* planner.plan(proposal.route.step.specification),
    proposal
  }
})

interface LiveOwner {
  readonly intentRecorded: Ref.Ref<boolean>
  readonly operationId: Ref.Ref<OperationId | null>
  readonly proposal: DeliveryActionProposal
  readonly reservation: DeliveryAdmissionReservation
  readonly settled: Ref.Ref<boolean>
  readonly startedRevision: DeliveryRelationRevision
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

type QuiescenceProbeState =
  | { readonly _tag: "NoProbe" }
  | { readonly _tag: "ProbeCompleted"; readonly startedRevision: DeliveryRelationRevision }
  | { readonly _tag: "ProbeRequested"; readonly requestedRevision: DeliveryRelationRevision }

const isQuiescenceProbe = (proposal: DeliveryActionProposal): boolean =>
  proposal.route._tag === "TrackerGraphReadRoute" && proposal.route.purpose === "QuiescenceProbe"

const proposalTaskId = (proposal: DeliveryActionProposal) => {
  const requirement = proposal.admission.taskWorkPosition
  return requirement._tag === "TaskWorkPositionRequired" ? requirement.taskId : undefined
}

const materializedOperationId = (action: MaterializedDeliveryAction): OperationId | null =>
  action._tag === "AcceptedOperationAction"
    ? action.proposal.actionIdentity.operationId
    : action._tag === "FreshOperationAction" || action._tag === "FreshAttemptAction"
      ? action.operationId
      : null

const makeLease = (
  admission: DeliveryRuntimeAdmissionController,
  integrationTargets: DeliveryActionExecutionLease["integrationTargets"],
  owner: LiveOwner
): DeliveryActionExecutionLease => ({
  bindPlannedAttemptPosition: (correlation) => {
    const taskId = proposalTaskId(owner.proposal)
    return taskId === undefined ? Effect.void : admission.bindPlannedAttemptPosition(taskId, correlation)
  },
  integrationTargets,
  recordIntent: () => Ref.set(owner.intentRecorded, true),
  releasePlannedAttemptPosition: admission.releasePlannedAttemptPosition
})

/**
 * The sole runtime-coloured consumer of the descriptive delivery relation.
 * It owns subscriptions, admission, live actions, completion, and quiescence.
 *
 * TODO: this is the largest unmodelled state machine in the system. Every
 * property the delivery requirements rest on — restart mid-attempt, capacity
 * changed mid-run, operator pause, tickets added to the graph mid-run — is
 * decided in the loop below, across `owners`, `probe`, `awaitingEvaluation`,
 * `deferredCompletions`, the selection semaphore, and forked fibers with
 * interrupt handlers. No model covers any of it.
 * `research/verification-bakeoff/quint/deliveryCore.qnt` is an abstraction of
 * what this loop should do and is bound to no code;
 * `specs/plannedAttemptExecutor.qnt` binds to code and stops at the executor
 * boundary. Closing that gap means an MBT driver over this loop, which is the
 * single highest-value model in the study.
 */
export const runDeliveryRuntime = Effect.fn("DeliveryRuntime.run")(function* <E>(
  relation: DeliveryRuntimeRelation<E>
): Effect.fn.Return<
  RunFinalityProof,
  E | DeliveryActionExecutionError | DeliveryRuntimeProposalOwnershipConflict | PlannedTaskAttemptError,
  DeliveryActionExecutor | DeliveryRuntimeResources | OperationIdAllocator | PlannedTaskAttemptPlanner
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
      const latest = yield* Ref.make<Option.Option<DeliveryRuntimeEvaluation>>(Option.none())
      const selectionGate = yield* Semaphore.make(1)
      const integrationTargets = resources.integrationTargets
      const probe = yield* Ref.make<QuiescenceProbeState>({ _tag: "NoProbe" })
      const awaitingEvaluation = yield* Ref.make<DeliveryRelationRevision | null>(null)
      const deferredCompletions = yield* Ref.make<ReadonlyArray<Completion>>([])

      const first = Option.getOrThrow(yield* relation.evaluations.changes.pipe(Stream.runHead))
      yield* Ref.set(latest, Option.some(first))
      const admission = yield* makeDeliveryRuntimeAdmissionController(first.taskWork, integrationTargets)

      yield* relation.evaluations.changes.pipe(
        Stream.runForEach((evaluation) => Queue.offer(events, { _tag: "EvaluationChanged", evaluation })),
        Effect.catchCause((cause) => Queue.offer(events, { _tag: "RelationFailed", cause })),
        Effect.forkIn(scope)
      )

      const start = Effect.fn("DeliveryRuntime.startProposal")(function* (
        proposal: DeliveryActionProposal,
        reservation: DeliveryAdmissionReservation,
        startedRevision: DeliveryRelationRevision
      ) {
        const intentRecorded = yield* Ref.make(false)
        const operationId = yield* Ref.make<OperationId | null>(null)
        const settled = yield* Ref.make(false)
        const owner: LiveOwner = { intentRecorded, operationId, proposal, reservation, settled, startedRevision }
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
        }).pipe(Effect.onInterrupt(() => releaseInterruptedOwner))
        yield* child.pipe(Effect.forkIn(scope))
        yield* Effect.yieldNow
        return true
      })

      const proposalIsAvailable = (
        proposal: DeliveryActionProposal,
        live: ReadonlyMap<DeliveryProposalId, LiveOwner>,
        liveOperationIds: ReadonlySet<OperationId>
      ): boolean =>
        !live.has(proposal.id) &&
        (proposal.waitsForLiveOperationId === null || !liveOperationIds.has(proposal.waitsForLiveOperationId))

      const admitLaterAvailableProposal = Effect.fn("DeliveryRuntime.admitLaterAvailableProposal")(function* (
        proposals: ReadonlyArray<DeliveryActionProposal>,
        deferredIndex: number,
        live: ReadonlyMap<DeliveryProposalId, LiveOwner>,
        liveOperationIds: ReadonlySet<OperationId>,
        revision: DeliveryRelationRevision
      ) {
        for (const independent of proposals.slice(deferredIndex + 1)) {
          if (!proposalIsAvailable(independent, live, liveOperationIds)) continue
          const laterReservation = yield* admission.tryReserve(independent)
          if (laterReservation._tag === "Admitted") {
            return yield* start(independent, laterReservation.reservation, revision)
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
            if (current.proposedActions._tag === "DeliveryProposalOwnershipConflict") {
              return yield* new DeliveryRuntimeProposalOwnershipConflict({
                proposalIds: current.proposedActions.conflicts.map(({ id }) => id)
              })
            }
            const live = yield* Ref.get(owners)
            const liveOperationIds = new Set(
              (yield* Effect.forEach(live.values(), ({ operationId }) => Ref.get(operationId))).filter(
                (operationId): operationId is OperationId => operationId !== null
              )
            )
            const proposal = current.proposedActions.proposals.find((candidate) =>
              proposalIsAvailable(candidate, live, liveOperationIds)
            )
            if (proposal === undefined) return false
            const reservation = yield* admission.tryReserve(proposal)
            if (reservation._tag === "Deferred") {
              yield* emit({ _tag: "ProposalDeferred", proposalId: proposal.id, reason: reservation.reason })
              return yield* admitLaterAvailableProposal(
                current.proposedActions.proposals,
                current.proposedActions.proposals.findIndex(({ id }) => id === proposal.id),
                live,
                liveOperationIds,
                current.revision
              )
            }
            return yield* start(proposal, reservation.reservation, current.revision)
          })
        )
      })

      const applyEvaluation = Effect.fn("DeliveryRuntime.applyEvaluation")(function* (
        evaluation: DeliveryRuntimeEvaluation
      ) {
        yield* Ref.set(latest, Option.some(evaluation))
        yield* admission.synchronize(evaluation.taskWork)
        if (evaluation.proposedActions._tag === "DeliveryProposalsAvailable") {
          if (evaluation.proposedActions.proposals.some((proposal) => !isQuiescenceProbe(proposal))) {
            yield* Ref.set(probe, { _tag: "NoProbe" })
          }
        }
      })

      const applyCompletion = Effect.fn("DeliveryRuntime.applyCompletion")(function* (completion: Completion) {
        const result = yield* selectionGate.withPermit(
          Effect.gen(function* () {
            const owner = Option.getOrThrow(Option.fromUndefinedOr((yield* Ref.get(owners)).get(completion.proposalId)))
            const intentRecorded = yield* Ref.get(owner.intentRecorded)
            if (Exit.isFailure(completion.exit)) {
              yield* admission.rollback(owner.reservation, intentRecorded)
            } else {
              yield* admission.complete(owner.reservation)
              yield* emit({
                _tag: "ActionOutcome",
                outcome: completion.exit.value._tag,
                proposalId: completion.proposalId
              })
              if (isQuiescenceProbe(owner.proposal)) {
                yield* Ref.update(probe, (current) =>
                  current._tag === "NoProbe"
                    ? current
                    : ({
                        _tag: "ProbeCompleted",
                        startedRevision: owner.startedRevision
                      } satisfies QuiescenceProbeState)
                )
              }
            }
            yield* Ref.set(owner.settled, true)
            yield* Ref.update(owners, (current) => new Map([...current].filter(([id]) => id !== completion.proposalId)))
            return completion.exit
          })
        )
        const requiredRevision = yield* relation.invalidate({
          _tag: "ProposalCompleted",
          proposalId: completion.proposalId,
          result: Exit.isSuccess(completion.exit) ? completion.exit.value : null
        })
        yield* Ref.set(awaitingEvaluation, requiredRevision)
        yield* Deferred.succeed(completion.acknowledged, undefined)
        return result
      })

      const finalityAtQuiescence = Effect.fn("DeliveryRuntime.finalityAtQuiescence")(function* (
        current: DeliveryRuntimeEvaluation,
        live: ReadonlyMap<DeliveryProposalId, LiveOwner>
      ) {
        if (current.proposedActions._tag === "DeliveryProposalOwnershipConflict") {
          return yield* new DeliveryRuntimeProposalOwnershipConflict({
            proposalIds: current.proposedActions.conflicts.map(({ id }) => id)
          })
        }
        if (live.size !== 0 || current.proposedActions.proposals.length !== 0) {
          return Option.none<RunFinalityProof>()
        }
        if (current.quiescence._tag === "QuiescencePassive") {
          return Option.some({ acceptedAt: current.acceptedAt, decision: current.finality })
        }
        const currentProbe = yield* Ref.get(probe)
        if (currentProbe._tag === "ProbeCompleted" && current.revision > currentProbe.startedRevision) {
          return Option.some({ acceptedAt: current.acceptedAt, decision: current.finality })
        }
        if (currentProbe._tag === "NoProbe") {
          yield* Ref.set(probe, { _tag: "ProbeRequested", requestedRevision: current.revision })
          const requiredRevision = yield* relation.invalidate({ _tag: "QuiescenceProbeRequested" })
          yield* Ref.set(awaitingEvaluation, requiredRevision)
        }
        return Option.none<RunFinalityProof>()
      })

      const nextRuntimeEvent = Effect.fn("DeliveryRuntime.nextEvent")(function* (
        waitingForEvaluation: boolean
      ): Effect.fn.Return<RuntimeEvent<E>> {
        const deferred = waitingForEvaluation
          ? Option.none<Completion>()
          : yield* Ref.modify(deferredCompletions, (current) => {
              const [first, ...remaining] = current
              return [Option.fromUndefinedOr(first), remaining] as const
            })
        return Option.isSome(deferred)
          ? { _tag: "ActionCompleted", completion: deferred.value }
          : yield* Queue.take(events)
      })

      const applyRuntimeEvent = Effect.fn("DeliveryRuntime.applyEvent")(function* (
        event: RuntimeEvent<E>,
        requiredRevision: DeliveryRelationRevision | null
      ) {
        if (event._tag === "RelationFailed") return yield* Effect.failCause(event.cause)
        if (event._tag === "EvaluationChanged") {
          yield* applyEvaluation(event.evaluation)
          if (requiredRevision !== null && event.evaluation.revision >= requiredRevision) {
            yield* Ref.set(awaitingEvaluation, null)
          }
          return
        }
        if (requiredRevision !== null) {
          yield* Ref.update(deferredCompletions, (deferred) => [...deferred, event.completion])
          return
        }
        const exit = yield* applyCompletion(event.completion)
        if (Exit.isFailure(exit)) return yield* Effect.failCause(exit.cause)
      })

      for (;;) {
        if ((yield* Ref.get(awaitingEvaluation)) === null) {
          while (yield* admitPass()) yield* Effect.yieldNow
        }

        const current = Option.getOrThrow(yield* Ref.get(latest))
        const live = yield* Ref.get(owners)
        const finality = yield* finalityAtQuiescence(current, live)
        if (Option.isSome(finality)) return finality.value

        const requiredRevision = yield* Ref.get(awaitingEvaluation)
        yield* applyRuntimeEvent(yield* nextRuntimeEvent(requiredRevision !== null), requiredRevision)
      }
    })
  ).pipe(
    Effect.ensuring(Effect.flatMap(DeliveryRuntimeResources, ({ integrationTargets }) => integrationTargets.releaseAll))
  )
})
