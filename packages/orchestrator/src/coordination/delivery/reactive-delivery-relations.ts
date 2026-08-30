import { type RunId, type TaskId } from "@dalph/contracts"
import { Deferred, Effect, Layer, Option, Ref, Schema, Semaphore, Stream, SubscriptionRef } from "effect"
import * as Cause from "effect/Cause"
import type { TrackerTarget } from "../../authorities/task-tracker/target.js"
import { deriveIntegrationAdmission } from "../../workflow/protocols/integration-admission/protocol.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { IntegrationTargetResourceController } from "../admission/integration-target-resource.js"
import { runnableTransitionTaskId, transitionTrackerGraphRequirement } from "../frontier/frontier.js"
import { readDeliveryProjectionFrom, type RunRecoveryProjectionSource } from "../run/recovery-activation.js"
import { requiredPlannedAttemptPositionsOf } from "../run/required-planned-attempt-positions.js"
import { journaledCurrentDeliveryFrameOf, type CurrentDeliveryFrame } from "../run/current-delivery-frame.js"
import { deriveFreshWorkflowDecisions } from "../run/fresh-workflow.js"
import {
  acceptedOperationIdsOf,
  ticketDeliveryEvidenceOf,
  journaledIntegrationEvidenceOf
} from "./delivery-evidence.js"
import { deliveryProposalsOf, trackerGraphReadProposalOf } from "./delivery-proposal.js"
import { DeliveryRuntimeResources } from "./delivery-runtime-resources.js"
import { makeDeliveryRelationsLayer } from "./in-memory-relations.js"
import { DeliveryAcceptedFactPublication } from "./delivery-accepted-fact-publication.js"
import { DeliveryRelationPublicationObserver } from "./delivery-publication-observer.js"
import {
  currentSignalFromCurrentFirstStream,
  type CurrentSignal,
  DeliveryRelationReconciliationError,
  type DeliveryRelationSourceError,
  type DeliveryRelationInputBundle,
  type TicketDeliveryEvidence,
  type TrackerGraphActionProposal
} from "./relations.js"
import type { JournalService } from "./journal.js"

/** Journal history cannot drive delivery until its initial control policy exists. */
export class DeliveryControlPolicyMissing extends Schema.TaggedError<DeliveryControlPolicyMissing>()(
  "DeliveryControlPolicyMissing",
  {}
) {}

type ReactiveDeliveryBundle = DeliveryRelationInputBundle

type JournalProjection = Effect.Success<JournalService["state"]["get"]>
type RecoveredDeliveryProjection = Effect.Success<RunRecoveryProjectionSource["readDeliveryProjection"]>

const pauseCoverageFactsOf = (journal: JournalProjection) => {
  if (journal.graph._tag !== "GraphEstablished") {
    return { _tag: "PauseCoverageGraphNotEstablished", applied: journal.reconstructed.pause } as const
  }
  return {
    _tag: "PauseCoverageGraphEstablished",
    applied: journal.reconstructed.pause,
    observedAt: journal.graph.observation.recordedAt,
    snapshot: journal.graph.observation.snapshot
  } as const
}

const eligibleRecoveredTransitions = (
  journal: JournalProjection,
  projection: RecoveredDeliveryProjection,
  freshTaskIds: ReadonlySet<TaskId>
) =>
  projection.frontier.transitions.filter(
    (transition) =>
      !freshTaskIds.has(runnableTransitionTaskId(transition)) &&
      (journal.graph._tag === "GraphEstablished" ||
        transitionTrackerGraphRequirement(transition) === "AcceptedHistorySufficient")
  )

const exactDeliveryEvidenceOf = (
  frame: CurrentDeliveryFrame | undefined,
  projection: RecoveredDeliveryProjection,
  records: ReadonlyArray<JournalRecord>
): ReadonlyArray<TicketDeliveryEvidence> => {
  if (frame === undefined) {
    const responsibilityEvidence =
      projection.evidence._tag === "AvailableDeliveryProjectionEvidence"
        ? projection.evidence.facts.map((facts): TicketDeliveryEvidence => ({ _tag: "ResponsibilityFacts", facts }))
        : []
    return [...responsibilityEvidence, ...journaledIntegrationEvidenceOf(records)]
  }
  if (projection.evidence._tag !== "AvailableDeliveryProjectionEvidence") return []
  return [
    ...ticketDeliveryEvidenceOf(frame, projection.evidence.facts),
    ...projection.evidence.integrationWaits.map((wait): TicketDeliveryEvidence => ({ _tag: "IntegrationWait", wait }))
  ]
}

const trackerGraphProposalsOf = (
  journal: JournalProjection,
  recoveredTransitionCount: number,
  runIsPaused: boolean,
  runId: RunId,
  target: TrackerTarget
): ReadonlyArray<TrackerGraphActionProposal> => {
  if (runIsPaused) return []
  if (journal.graph._tag === "GraphNotEstablished" && recoveredTransitionCount === 0) {
    return [
      trackerGraphReadProposalOf({ acceptedAt: journal.position, purpose: "EstablishCurrentGraph", runId, target })
    ]
  }
  return []
}

/**
 * Keeps one effectful reconciliation subscription hot while all exposed
 * delivery signals remain descriptive and safe to observe repeatedly.
 */
export const makeReactiveDeliveryRelationsLayer = Effect.fn("DeliveryRelations.makeReactiveLayer")(function* (
  runId: RunId,
  target: TrackerTarget,
  journal: JournalService,
  recovery: RunRecoveryProjectionSource,
  integrationTargets: IntegrationTargetResourceController
) {
  const publicationObserver = yield* DeliveryRelationPublicationObserver
  const recoveredAttemptIds = new Set(recovery.reconstructedPlannedAttemptPositions.map(({ attemptId }) => attemptId))
  const readCoherentJournalProjection = Effect.fn("DeliveryRelations.readCoherentJournalProjection")(function* () {
    for (;;) {
      const journalBefore = yield* journal.state.get
      const projection = yield* readDeliveryProjectionFrom(recovery, journalBefore.reconstructed)
      const journalAfter = yield* journal.state.get
      const projectionAcceptedAt =
        projection.evidence._tag === "AvailableDeliveryProjectionEvidence"
          ? projection.evidence.acceptedAt
          : journalAfter.position
      if (journalBefore.position === journalAfter.position && projectionAcceptedAt === journalAfter.position) {
        return { journal: journalAfter, projection }
      }
    }
  })

  const deriveBundle = Effect.fn("DeliveryRelations.deriveBundle")(function* () {
    const { journal, projection } = yield* readCoherentJournalProjection()
    const policy = yield* Option.match(journal.reconstructed.controlPolicy, {
      onNone: () => Effect.fail(new DeliveryControlPolicyMissing()),
      onSome: Effect.succeed
    })
    const frame =
      journal.graph._tag === "GraphEstablished" ? yield* journaledCurrentDeliveryFrameOf(journal) : undefined
    const fresh = frame === undefined ? [] : deriveFreshWorkflowDecisions(frame, recoveredAttemptIds, target)
    const freshTaskIds = new Set(fresh.map(({ transition }) => runnableTransitionTaskId(transition)))
    const recovered = eligibleRecoveredTransitions(journal, projection, freshTaskIds)
    const transitions = [...recovered, ...fresh.map(({ transition }) => transition)]
    const records = journal.records
    const integrationResponsibilities = deriveIntegrationAdmission(records).responsibilities
    const proposalContributions = deliveryProposalsOf({
      acceptedAt: journal.position,
      acceptedOperationIds: acceptedOperationIdsOf(records),
      fresh,
      integrationResponsibilities,
      responsibilities: journal.reconstructed.responsibility.entries,
      runId,
      transitions
    })
    const exactEvidence = exactDeliveryEvidenceOf(frame, projection, records)
    const runIsPaused = journal.reconstructed.pause.run._tag === "RunPaused"
    const trackerGraphProposals = trackerGraphProposalsOf(journal, recovered.length, runIsPaused, runId, target)
    return {
      actionInputs: {
        proposalContributions,
        reflectionProposals: [],
        runtimeFacts: {
          acceptedAt: journal.position,
          runId,
          pauseCoverage: pauseCoverageFactsOf(journal),
          quiescence: runIsPaused
            ? { _tag: "QuiescencePassive", reason: "RunPaused" }
            : { _tag: "TrackerReconfirmationAllowed" },
          taskWork: {
            capacity: policy.taskExecutionCapacity,
            held: requiredPlannedAttemptPositionsOf(journal.reconstructed).map(({ attemptId, runId, taskId }) => ({
              correlation: { attemptId, runId },
              taskId
            }))
          },
          cancellationApplied: journal.reconstructed.cancellation._tag === "RunCancellationApplied"
        },
        trackerGraphProposals
      },
      publication: { exactEvidence, graph: journal.graph, policy }
    } satisfies ReactiveDeliveryBundle
  })

  type ReactiveDeliveryFailure = Effect.Error<ReturnType<typeof deriveBundle>>
  type ReactiveDeliveryStatus =
    | { readonly _tag: "ReactiveDeliveryFailed"; readonly cause: Cause.Cause<ReactiveDeliveryFailure> }
    | { readonly _tag: "ReactiveDeliveryOpen"; readonly bundle: ReactiveDeliveryBundle }

  const statusSignal = <A>(
    project: (bundle: ReactiveDeliveryBundle) => A
  ): CurrentSignal<A, DeliveryRelationSourceError> =>
    currentSignalFromCurrentFirstStream(
      SubscriptionRef.changes(state).pipe(
        Stream.mapEffect((status) =>
          status._tag === "ReactiveDeliveryOpen"
            ? Effect.succeed(project(status.bundle))
            : Effect.fail(new DeliveryRelationReconciliationError({ cause: status.cause }))
        )
      )
    )

  const initial = yield* deriveBundle()
  const state = yield* SubscriptionRef.make<ReactiveDeliveryStatus>({ _tag: "ReactiveDeliveryOpen", bundle: initial })
  yield* publicationObserver.observe(initial)
  const gate = yield* Semaphore.make(1)
  type PublicationWaiter = {
    readonly completed: Deferred.Deferred<void, DeliveryRelationReconciliationError>
    readonly targetPosition: JournalPosition
  }
  const publicationWaiters = yield* Ref.make<ReadonlyArray<PublicationWaiter>>([])
  const completePublicationWaiters = Effect.fn("DeliveryRelations.completePublicationWaiters")(function* (
    acceptedAt: JournalPosition
  ) {
    const completed = yield* Ref.modify(publicationWaiters, (current) => [
      current.filter(({ targetPosition }) => targetPosition <= acceptedAt),
      current.filter(({ targetPosition }) => targetPosition > acceptedAt)
    ])
    yield* Effect.forEach(completed, ({ completed }) => Deferred.succeed(completed, undefined), { discard: true })
  })
  const failPublicationWaiters = Effect.fn("DeliveryRelations.failPublicationWaiters")(function* (
    cause: Cause.Cause<ReactiveDeliveryFailure>
  ) {
    const failure = new DeliveryRelationReconciliationError({ cause })
    const failed = yield* Ref.getAndSet(publicationWaiters, [])
    yield* Effect.forEach(failed, ({ completed }) => Deferred.fail(completed, failure), { discard: true })
  })
  const failReactiveDeliveryWhileHoldingGate = (cause: Cause.Cause<ReactiveDeliveryFailure>) =>
    SubscriptionRef.set(state, { _tag: "ReactiveDeliveryFailed" as const, cause }).pipe(
      Effect.andThen(failPublicationWaiters(cause))
    )
  const refresh = gate.withPermit(
    deriveBundle().pipe(
      Effect.matchCauseEffect({
        onFailure: failReactiveDeliveryWhileHoldingGate,
        onSuccess: (bundle) =>
          SubscriptionRef.set(state, { _tag: "ReactiveDeliveryOpen", bundle }).pipe(
            Effect.andThen(publicationObserver.observe(bundle)),
            Effect.andThen(completePublicationWaiters(bundle.actionInputs.runtimeFacts.acceptedAt))
          )
      })
    )
  )

  const refreshAfterJournalChange = Effect.fn("DeliveryRelations.refreshAfterJournalChange")(function* (
    journalPosition: JournalPosition
  ) {
    // Intent and its accepted observation are commonly appended back-to-back.
    // Let the writer finish its current turn, then publish the newest accepted
    // position once instead of exposing an intermediate planning frontier.
    yield* Effect.yieldNow
    const current = yield* SubscriptionRef.get(state)
    if (
      current._tag === "ReactiveDeliveryOpen" &&
      current.bundle.actionInputs.runtimeFacts.acceptedAt !== null &&
      current.bundle.actionInputs.runtimeFacts.acceptedAt >= journalPosition
    )
      return
    return yield* refresh
  })
  const failReactiveDelivery = (cause: Cause.Cause<ReactiveDeliveryFailure>) =>
    gate.withPermit(failReactiveDeliveryWhileHoldingGate(cause))

  yield* journal.state.changes.pipe(
    Stream.runForEach(({ position }) => refreshAfterJournalChange(position)),
    Effect.catchCause(failReactiveDelivery),
    Effect.forkScoped
  )
  const resourceSubscribed = yield* Deferred.make<void>()
  yield* integrationTargets.changes.pipe(
    Stream.tap(() => Deferred.succeed(resourceSubscribed, undefined)),
    Stream.drop(1),
    Stream.runForEach(() => refresh),
    Effect.catchCause(failReactiveDelivery),
    Effect.forkScoped
  )
  yield* Deferred.await(resourceSubscribed)

  const bundleSignal = <A>(project: (bundle: ReactiveDeliveryBundle) => A) => statusSignal(project)
  const acceptedFactPublication = DeliveryAcceptedFactPublication.of({
    awaitCurrent: Effect.gen(function* () {
      const targetPosition = (yield* journal.state.get.pipe(
        Effect.mapError((failure) => new DeliveryRelationReconciliationError({ cause: Cause.fail(failure) }))
      )).position
      const completed = yield* Deferred.make<void, DeliveryRelationReconciliationError>()
      const awaiting = yield* gate.withPermit(
        Effect.gen(function* () {
          const current = yield* SubscriptionRef.get(state)
          if (current._tag === "ReactiveDeliveryFailed") {
            return yield* new DeliveryRelationReconciliationError({ cause: current.cause })
          }
          const acceptedAt = current.bundle.actionInputs.runtimeFacts.acceptedAt
          if (acceptedAt !== null && acceptedAt >= targetPosition) return false
          yield* Ref.update(publicationWaiters, (waiters) => [...waiters, { completed, targetPosition }])
          return true
        })
      )
      if (!awaiting) return
      yield* Deferred.await(completed).pipe(
        Effect.onInterrupt(() =>
          Ref.update(publicationWaiters, (waiters) => waiters.filter((waiter) => waiter.completed !== completed))
        )
      )
    })
  })
  return Layer.merge(
    makeDeliveryRelationsLayer({
      publicationConsistency: { withStablePublication: (effect) => gate.withPermit(effect) },
      coherent: bundleSignal((bundle) => bundle)
    }),
    Layer.succeed(DeliveryAcceptedFactPublication, acceptedFactPublication)
  )
})

/** Scoped Layer form for application compositions that already own the journal service. */
export const reactiveDeliveryRelationsLayer = (
  runId: RunId,
  target: TrackerTarget,
  journal: JournalService,
  recovery: RunRecoveryProjectionSource
) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const resources = yield* DeliveryRuntimeResources
      return yield* makeReactiveDeliveryRelationsLayer(runId, target, journal, recovery, resources.integrationTargets)
    })
  )
