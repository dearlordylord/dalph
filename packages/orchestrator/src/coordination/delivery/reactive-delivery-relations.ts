import { type RunId, type TaskId } from "@dalph/contracts"
import { Deferred, Effect, Layer, Option, Schema, Semaphore, Stream, SubscriptionRef } from "effect"
import * as Cause from "effect/Cause"
import type { TrackerTarget } from "../../authorities/task-tracker/target.js"
import { deriveIntegrationAdmission } from "../../workflow/protocols/integration-admission/protocol.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { IntegrationTargetResourceController } from "../admission/integration-target-resource.js"
import { runnableTransitionTaskId, transitionTrackerGraphRequirement } from "../frontier/frontier.js"
import type { RunRecoveryProjectionSource } from "../run/recovery-activation.js"
import { requiredPlannedAttemptPositionsOf } from "../run/required-planned-attempt-positions.js"
import { journaledCurrentDeliveryFrameOf, type CurrentDeliveryFrame } from "../run/current-delivery-frame.js"
import { latestReconstructedTaskGraph } from "../reconstruction/graph-knowledge.js"
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
  attachCurrentSignal,
  type CurrentSignal,
  DeliveryRelationReconciliationError,
  type DeliveryRelationSourceError,
  type DeliveryRelationInputBundle,
  type TicketDeliveryEvidence,
  type TrackerGraphActionProposal,
  makeCurrentSignal
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
  const latestGraphRecord = journal.records.findLast(
    ({ event }) =>
      event._tag === "TaskTrackerFactsObserved" &&
      (event.observation._tag === "CompleteTaskTrackerFacts" ||
        event.observation._tag === "UnchangedTaskTrackerFactsReconfirmed")
  )
  const snapshot = Option.getOrUndefined(latestReconstructedTaskGraph(journal.reconstructed.graphKnowledge))
  return latestGraphRecord === undefined || snapshot === undefined
    ? ({ _tag: "PauseCoverageGraphNotEstablished", applied: journal.reconstructed.pause } as const)
    : ({
        _tag: "PauseCoverageGraphEstablished",
        applied: journal.reconstructed.pause,
        observedAt: latestGraphRecord.position,
        snapshot
      } as const)
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
      const projection = yield* recovery.readDeliveryProjection
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
    const fresh = frame === undefined ? [] : deriveFreshWorkflowDecisions(frame, recoveredAttemptIds)
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
      legacy: {
        proposalContributions,
        reflectionProposals: [],
        runtimeFacts: {
          acceptedAt: journal.position,
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
          }
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
    makeCurrentSignal({
      get: SubscriptionRef.get(state).pipe(
        Effect.flatMap((status) =>
          status._tag === "ReactiveDeliveryOpen"
            ? Effect.succeed(project(status.bundle))
            : Effect.fail(new DeliveryRelationReconciliationError({ cause: status.cause }))
        )
      ),
      changes: SubscriptionRef.changes(state).pipe(
        Stream.mapEffect((status) =>
          status._tag === "ReactiveDeliveryOpen"
            ? Effect.succeed(project(status.bundle))
            : Effect.fail(new DeliveryRelationReconciliationError({ cause: status.cause }))
        )
      )
    })

  const initial = yield* deriveBundle()
  const state = yield* SubscriptionRef.make<ReactiveDeliveryStatus>({ _tag: "ReactiveDeliveryOpen", bundle: initial })
  yield* publicationObserver.observe(initial)
  const gate = yield* Semaphore.make(1)
  const refresh = gate.withPermit(
    deriveBundle().pipe(
      Effect.matchCauseEffect({
        onFailure: (cause) => SubscriptionRef.set(state, { _tag: "ReactiveDeliveryFailed", cause }),
        onSuccess: (bundle) =>
          SubscriptionRef.set(state, { _tag: "ReactiveDeliveryOpen", bundle }).pipe(
            Effect.andThen(publicationObserver.observe(bundle))
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
    if (current._tag === "ReactiveDeliveryOpen" && current.bundle.legacy.runtimeFacts.acceptedAt === journalPosition)
      return
    return yield* refresh
  })

  yield* journal.state.changes.pipe(
    Stream.runForEach(({ position }) => refreshAfterJournalChange(position)),
    Effect.catchCause((cause) => SubscriptionRef.set(state, { _tag: "ReactiveDeliveryFailed", cause })),
    Effect.forkScoped
  )
  const resourceSubscribed = yield* Deferred.make<void>()
  yield* integrationTargets.changes.pipe(
    Stream.tap(() => Deferred.succeed(resourceSubscribed, undefined)),
    Stream.drop(1),
    Stream.runForEach(() => refresh),
    Effect.catchCause((cause) => SubscriptionRef.set(state, { _tag: "ReactiveDeliveryFailed", cause })),
    Effect.forkScoped
  )
  yield* Deferred.await(resourceSubscribed)

  const bundleSignal = <A>(project: (bundle: ReactiveDeliveryBundle) => A) => statusSignal(project)
  const acceptedFactPublication = DeliveryAcceptedFactPublication.of({
    awaitCurrent: Effect.gen(function* () {
      const targetPosition = (yield* journal.state.get.pipe(
        Effect.mapError((failure) => new DeliveryRelationReconciliationError({ cause: Cause.fail(failure) }))
      )).position
      yield* Effect.scoped(
        Effect.gen(function* () {
          const publication = yield* attachCurrentSignal(
            statusSignal(
              (bundle) =>
                bundle.legacy.runtimeFacts.acceptedAt !== null &&
                bundle.legacy.runtimeFacts.acceptedAt >= targetPosition
            )
          )
          if (publication.current) return
          yield* publication.changes.pipe(
            Stream.filter((published) => published),
            Stream.runHead
          )
        })
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
