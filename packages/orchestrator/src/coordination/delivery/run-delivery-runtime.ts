import { Context, Deferred, Effect, Exit, Option, Queue, Ref, Schema, Semaphore, Stream } from "effect"
import type * as Cause from "effect/Cause"
import {
  OperationIdAllocator,
  type PlannedTaskAttemptError,
  PlannedTaskAttemptPlanner
} from "../../workflow/protocols/task-attempt-planning/plan.js"
import type { OperationId } from "../../workflow/identity.js"
import type { RunFinalityProof } from "../frontier/run-finality.js"
import {
  DeliveryActionExecutor,
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
  makeDeliveryRuntimeAdmissionController,
  type DeliveryAdmissionReservation,
  type DeliveryRuntimeAdmissionController
} from "./delivery-runtime-admission.js"
import {
  type CurrentSignal,
  type DeliveryProposalFrontier,
  type DeliveryRelationRevision,
  type DeliveryRuntimeEvaluation
} from "./relations.js"
import { DeliveryRuntimeResources } from "./delivery-runtime-resources.js"

/** Two lower relations claim the same proposal identity, so no action is authorized. */
export class DeliveryRuntimeProposalOwnershipConflict extends Schema.TaggedErrorClass<DeliveryRuntimeProposalOwnershipConflict>()(
  "DeliveryRuntimeProposalOwnershipConflict",
  { proposalIds: Schema.Array(DeliveryProposalId) }
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
  | {
      readonly _tag: "ProposalsChanged"
      readonly evaluation: DeliveryRuntimeEvaluation
      readonly proposals: DeliveryProposalFrontier
    }
  | { readonly _tag: "RelationFailed"; readonly cause: Cause.Cause<E> }

type QuiescenceProbeState =
  | { readonly _tag: "NoProbe" }
  | { readonly _tag: "ProbeCompleted"; readonly startedRevision: DeliveryRelationRevision }
  | { readonly _tag: "ProbeRequested"; readonly requestedRevision: DeliveryRelationRevision }

const isQuiescenceProbe = (proposal: DeliveryActionProposal): boolean =>
  proposal.route._tag === "TrackerGraphReadRoute" && proposal.route.purpose === "QuiescenceProbe"

export const proposalFrontiersAgree = (left: DeliveryProposalFrontier, right: DeliveryProposalFrontier): boolean => {
  if (left._tag !== right._tag) return false
  if (left._tag === "DeliveryProposalOwnershipConflict") {
    /* v8 ignore start -- equal frontier tags already prove this narrowing. */
    if (right._tag !== "DeliveryProposalOwnershipConflict") return false
    /* v8 ignore stop */
    return (
      left.conflicts.length === right.conflicts.length &&
      left.conflicts.every(({ id }, index) => right.conflicts[index]?.id === id)
    )
  }
  /* v8 ignore start -- equal frontier tags already prove this narrowing. */
  if (right._tag !== "DeliveryProposalsAvailable") return false
  /* v8 ignore stop */
  return (
    left.proposals.length === right.proposals.length &&
    left.proposals.every(({ id }, index) => right.proposals[index]?.id === id)
  )
}

export const proposalIsPresent = (frontier: DeliveryProposalFrontier, proposalId: DeliveryProposalId): boolean =>
  frontier._tag === "DeliveryProposalsAvailable"
    ? frontier.proposals.some(({ id }) => id === proposalId)
    : frontier.conflicts.some(({ id }) => id === proposalId)

const completedProbeAllowsFinality = (
  probe: QuiescenceProbeState,
  currentRevision: DeliveryRelationRevision
): boolean => probe._tag === "ProbeCompleted" && currentRevision > probe.startedRevision

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
  releasePlannedAttemptPosition: admission.releasePlannedAttemptPosition
})

/**
 * The runtime consumes the ordinary evaluation and proposal signals directly.
 * The proposal signal is deliberately separate: an authority fact may remove
 * a proposal before the interpreter has returned its in-memory action result.
 * Only the stabilization port is allowed to request a new read.
 */
export interface DeliveryRuntimeInput<E = never> {
  readonly evaluations: CurrentSignal<DeliveryRuntimeEvaluation, E>
  readonly proposedActions: CurrentSignal<DeliveryProposalFrontier, E>
  readonly requestStabilizationRead: () => Effect.Effect<DeliveryRelationRevision>
}

/**
 * The sole runtime-coloured consumer of the descriptive delivery relation.
 * It owns subscriptions, admission, live actions, completion, and quiescence.
 *
 * TODO: this is the largest unmodelled state machine in the system. Every
 * property the delivery requirements rest on — restart mid-attempt, capacity
 * changed mid-run, operator pause, tickets added to the graph mid-run — is
 * decided in the loop below, across `owners`, `probe`, the selection semaphore,
 * and forked fibers with
 * interrupt handlers. No model covers any of it.
 * `research/verification-bakeoff/quint/deliveryCore.qnt` is an abstraction of
 * what this loop should do and is bound to no code;
 * `specs/plannedAttemptExecutor.qnt` binds to code and stops at the executor
 * boundary. Closing that gap means an MBT driver over this loop, which is the
 * single highest-value model in the study.
 */
export const runDeliveryRuntime = Effect.fn("DeliveryRuntime.run")(function* <E>(
  relation: DeliveryRuntimeInput<E>
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
      const latestProposals = yield* Ref.make<Option.Option<DeliveryProposalFrontier>>(Option.none())
      const selectionGate = yield* Semaphore.make(1)
      const integrationTargets = resources.integrationTargets
      const probe = yield* Ref.make<QuiescenceProbeState>({ _tag: "NoProbe" })
      const first = yield* relation.evaluations.get
      const firstProposals = yield* relation.proposedActions.get
      yield* Ref.set(latest, Option.some(first))
      yield* Ref.set(latestProposals, Option.some(firstProposals))
      const admission = yield* makeDeliveryRuntimeAdmissionController(first.taskWork, integrationTargets)
      const evaluationsSubscribed = yield* Deferred.make<void>()
      const proposalsSubscribed = yield* Deferred.make<void>()

      yield* relation.evaluations.changes.pipe(
        Stream.tap(() => Deferred.succeed(evaluationsSubscribed, undefined)),
        Stream.drop(1),
        Stream.runForEach((evaluation) => Queue.offer(events, { _tag: "EvaluationChanged", evaluation })),
        Effect.catchCause((cause) => Queue.offer(events, { _tag: "RelationFailed", cause })),
        Effect.forkIn(scope)
      )
      yield* relation.proposedActions.changes.pipe(
        Stream.tap(() => Deferred.succeed(proposalsSubscribed, undefined)),
        Stream.drop(1),
        Stream.runForEach((proposals) =>
          relation.evaluations.get.pipe(
            Effect.flatMap((evaluation) => Queue.offer(events, { _tag: "ProposalsChanged", evaluation, proposals }))
          )
        ),
        Effect.catchCause((cause) => Queue.offer(events, { _tag: "RelationFailed", cause })),
        Effect.forkIn(scope)
      )
      yield* Deferred.await(evaluationsSubscribed)
      yield* Deferred.await(proposalsSubscribed)
      // Close the interval between the initial sample and both subscriptions.
      // A fact accepted in that interval is already the streams' dropped
      // current value, so sample once more after both subscriptions are live.
      const subscribedCurrent = yield* relation.evaluations.get
      const subscribedProposals = yield* relation.proposedActions.get
      yield* Ref.set(latest, Option.some(subscribedCurrent))
      yield* Ref.set(latestProposals, Option.some(subscribedProposals))
      yield* admission.synchronize(subscribedCurrent.taskWork)

      const start = Effect.fn("DeliveryRuntime.startProposal")(function* (
        proposal: DeliveryActionProposal,
        reservation: DeliveryAdmissionReservation
      ) {
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
        liveOperationIds: ReadonlySet<OperationId>
      ) {
        for (const independent of proposals.slice(deferredIndex + 1)) {
          if (!proposalIsAvailable(independent, live, liveOperationIds)) continue
          const laterReservation = yield* admission.tryReserve(independent)
          if (laterReservation._tag === "Admitted") {
            return yield* start(independent, laterReservation.reservation)
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
            const proposedActions = Option.getOrThrow(yield* Ref.get(latestProposals))
            if (proposedActions._tag === "DeliveryProposalOwnershipConflict") {
              return yield* new DeliveryRuntimeProposalOwnershipConflict({
                proposalIds: proposedActions.conflicts.map(({ id }) => id)
              })
            }
            const live = yield* Ref.get(owners)
            const liveOperationIds = new Set(
              (yield* Effect.forEach(live.values(), ({ operationId }) => Ref.get(operationId))).filter(
                (operationId): operationId is OperationId => operationId !== null
              )
            )
            const proposal = proposedActions.proposals.find((candidate) =>
              proposalIsAvailable(candidate, live, liveOperationIds)
            )
            if (proposal === undefined) return false
            const reservation = yield* admission.tryReserve(proposal)
            if (reservation._tag === "Deferred") {
              yield* emit({ _tag: "ProposalDeferred", proposalId: proposal.id, reason: reservation.reason })
              return yield* admitLaterAvailableProposal(
                proposedActions.proposals,
                proposedActions.proposals.findIndex(({ id }) => id === proposal.id),
                live,
                liveOperationIds
              )
            }
            return yield* start(proposal, reservation.reservation)
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
          if ((yield* Ref.get(owner.settled)) && !proposalIsPresent(frontier, owner.proposal.id)) {
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
        const prior = yield* Ref.get(latest)
        if (Option.isSome(prior) && evaluation.revision < prior.value.revision) return false
        yield* Ref.set(latest, Option.some(evaluation))
        yield* admission.synchronize(evaluation.taskWork)
        return true
      })

      const applyProposals = Effect.fn("DeliveryRuntime.applyProposals")(function* (
        proposedActions: DeliveryProposalFrontier
      ) {
        yield* Ref.set(latestProposals, Option.some(proposedActions))
        if (
          proposedActions._tag === "DeliveryProposalsAvailable" &&
          proposedActions.proposals.some((proposal) => !isQuiescenceProbe(proposal))
        ) {
          yield* Ref.set(probe, { _tag: "NoProbe" })
        }
        yield* selectionGate.withPermit(pruneSettledOwners(proposedActions))
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
              if (isQuiescenceProbe(owner.proposal)) {
                yield* Ref.update(probe, (current) =>
                  current._tag === "ProbeRequested"
                    ? ({
                        _tag: "ProbeCompleted",
                        startedRevision: current.requestedRevision
                      } satisfies QuiescenceProbeState)
                    : current
                )
              }
              yield* Ref.set(owner.settled, true)
              const frontier = Option.getOrThrow(yield* Ref.get(latestProposals))
              if (!proposalIsPresent(frontier, owner.proposal.id)) {
                yield* Ref.update(
                  owners,
                  (current) => new Map([...current].filter(([id]) => id !== completion.proposalId))
                )
              }
            }
            return completion.exit
          })
        )
        yield* Deferred.succeed(completion.acknowledged, undefined)
        return result
      })

      const finalityAtQuiescence = Effect.fn("DeliveryRuntime.finalityAtQuiescence")(function* (
        current: DeliveryRuntimeEvaluation,
        proposedActions: DeliveryProposalFrontier,
        live: ReadonlyMap<DeliveryProposalId, LiveOwner>
      ) {
        /* v8 ignore start -- admitPass rejects a conflicting frontier before finality is evaluated. */
        if (proposedActions._tag === "DeliveryProposalOwnershipConflict") return Option.none<RunFinalityProof>()
        /* v8 ignore stop */
        if (live.size !== 0 || proposedActions.proposals.length !== 0) {
          return Option.none<RunFinalityProof>()
        }
        if (!proposalFrontiersAgree(current.proposedActions, proposedActions)) {
          return Option.none<RunFinalityProof>()
        }
        if (current.quiescence._tag === "QuiescencePassive") {
          return Option.some({ acceptedAt: current.acceptedAt, decision: current.finality })
        }
        const currentProbe = yield* Ref.get(probe)
        if (completedProbeAllowsFinality(currentProbe, current.revision)) {
          return Option.some({ acceptedAt: current.acceptedAt, decision: current.finality })
        }
        if (currentProbe._tag === "NoProbe") {
          const requestedRevision = yield* relation.requestStabilizationRead()
          yield* Ref.set(probe, { _tag: "ProbeRequested", requestedRevision })
        }
        return Option.none<RunFinalityProof>()
      })

      const applyRuntimeEvent = Effect.fn("DeliveryRuntime.applyEvent")(function* (event: RuntimeEvent<E>) {
        if (event._tag === "RelationFailed") return yield* Effect.failCause(event.cause)
        if (event._tag === "EvaluationChanged") {
          yield* applyEvaluation(event.evaluation)
          return
        }
        if (event._tag === "ProposalsChanged") {
          if (!proposalFrontiersAgree(event.evaluation.proposedActions, event.proposals)) return
          if (!(yield* applyEvaluation(event.evaluation))) return
          yield* applyProposals(event.proposals)
          return
        }
        const exit = yield* applyCompletion(event.completion)
        if (Exit.isFailure(exit)) return yield* Effect.failCause(exit.cause)
      })

      for (;;) {
        while (yield* admitPass()) yield* Effect.yieldNow

        const current = Option.getOrThrow(yield* Ref.get(latest))
        const proposedActions = Option.getOrThrow(yield* Ref.get(latestProposals))
        const live = yield* Ref.get(owners)
        const finality = yield* finalityAtQuiescence(current, proposedActions, live)
        if (Option.isSome(finality)) return finality.value

        yield* applyRuntimeEvent(yield* Queue.take(events))
      }
    })
  ).pipe(
    Effect.ensuring(Effect.flatMap(DeliveryRuntimeResources, ({ integrationTargets }) => integrationTargets.releaseAll))
  )
})
