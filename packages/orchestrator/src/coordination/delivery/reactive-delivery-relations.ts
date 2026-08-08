import { plannedAttemptExecutorCorrelation, type AttemptId, type RunId, type TaskId } from "@dalph/contracts"
import { Effect, Layer, Option, Ref, Schema, Semaphore, Stream, SubscriptionRef } from "effect"
import * as Cause from "effect/Cause"
import type { TrackerTarget } from "../../authorities/task-tracker/target.js"
import { deriveIntegrationAdmission } from "../../workflow/protocols/integration-admission/protocol.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import { runnableTransitionTaskId, transitionTrackerGraphRequirement } from "../frontier/frontier.js"
import type { RunRecoveryProjectionSource } from "../run/recovery-activation.js"
import { journaledCurrentDeliveryFrameOf, type CurrentDeliveryFrame } from "../run/current-delivery-frame.js"
import { deriveFreshWorkflowDecisions } from "../run/fresh-workflow.js"
import {
  acceptedOperationIdsOf,
  ticketDeliveryEvidenceOf,
  journaledIntegrationEvidenceOf
} from "./delivery-evidence.js"
import { deliveryProposalsOf, trackerGraphReadProposalOf } from "./delivery-proposal.js"
import { makeDeliveryRelationsLayer } from "./in-memory-relations.js"
import {
  type CurrentSignal,
  type DeliveryInvalidation,
  DeliveryRelationReconciliationError,
  type DeliveryRelationSourceError,
  DeliveryRelationRevision,
  type DeliveryRelationInputBundle,
  type DeliveryRuntimeFacts,
  type TicketDeliveryEvidence,
  type TrackerGraphActionProposal
} from "./relations.js"
import type { JournalService } from "./journal.js"

/** Journal history cannot drive delivery until its initial control policy exists. */
export class DeliveryControlPolicyMissing extends Schema.TaggedErrorClass<DeliveryControlPolicyMissing>()(
  "DeliveryControlPolicyMissing",
  {}
) {}

type ReactiveDeliveryBundle = DeliveryRelationInputBundle

type JournalProjection = Effect.Success<JournalService["state"]["get"]>
type RecoveredDeliveryProjection = Effect.Success<RunRecoveryProjectionSource["readDeliveryProjection"]>

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
  activeProbe: ReadonlyArray<TrackerGraphActionProposal>,
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
  return journal.graph._tag === "GraphEstablished" ? activeProbe : []
}

const latestExecutorReport = (records: ReadonlyArray<JournalRecord>, attemptId: AttemptId) =>
  records.findLast(
    ({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkReported" && event.report.correlation.attemptId === attemptId
  )?.event

/**
 * Rebuilds held task-work positions from journal history after process loss.
 * The correlation comes from the stored planned attempt, so restart continues
 * the exact `(RunId, AttemptId)` rather than minting a replacement, and a
 * position is surrendered only on a SafelySuspended or Terminal report —
 * process loss is neither.
 *
 * TODO: this is the derivation half of crash recovery and no model covers it.
 * It carries I9, I10 and I16 of research/verification-bakeoff/INVARIANTS.md at
 * once, and I9 is `not modelled` in all seven tools because no model here
 * carries a RunId or an AttemptId at all. The adoption half is
 * `makeDeliveryRuntimeAdmissionController` and `synchronize` in
 * ./delivery-runtime-admission.ts; a crash/recover model needs both ends.
 * Correctness of the fold this reads from is I15, which
 * research/verification-bakeoff/JOURNAL-EVENTS.md designs and nothing builds.
 */
const activeAttemptPositions = (
  state: Effect.Success<JournalService["state"]["get"]>
): DeliveryRuntimeFacts["taskWork"]["held"] =>
  state.reconstructed.responsibility.entries.flatMap((responsibility) => {
    if (responsibility._tag !== "PlannedAttemptExecutorWorkResponsibility") return []
    const latest = latestExecutorReport(state.records, responsibility.plannedAttempt.attemptId)
    return latest?._tag === "PlannedAttemptExecutorWorkReported" &&
      (latest.report._tag === "SafelySuspended" || latest.report._tag === "Terminal")
      ? []
      : [
          {
            correlation: plannedAttemptExecutorCorrelation(responsibility.plannedAttempt),
            taskId: responsibility.plannedAttempt.taskId
          }
        ]
  })

/**
 * Keeps one effectful reconciliation subscription hot while all exposed
 * delivery signals remain descriptive and safe to observe repeatedly.
 */
export const makeReactiveDeliveryRelationsLayer = Effect.fn("DeliveryRelations.makeReactiveLayer")(function* (
  runId: RunId,
  target: TrackerTarget,
  journal: JournalService,
  recovery: RunRecoveryProjectionSource
) {
  const recoveredAttemptIds = new Set(recovery.reconstructedPlannedAttemptPositions.map(({ attemptId }) => attemptId))
  const probe = yield* Ref.make<Option.Option<TrackerGraphActionProposal>>(Option.none())
  const revision = yield* Ref.make(DeliveryRelationRevision.make(0))

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

  const deriveBundle = Effect.fn("DeliveryRelations.deriveBundle")(function* (
    currentRevision: DeliveryRelationRevision
  ) {
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
    if (runIsPaused) yield* Ref.set(probe, Option.none())
    const activeProbe = runIsPaused ? [] : Option.toArray(yield* Ref.get(probe))
    const trackerGraphProposals = trackerGraphProposalsOf(
      journal,
      recovered.length,
      activeProbe,
      runIsPaused,
      runId,
      target
    )
    return {
      legacy: {
        proposalContributions,
        reflectionProposals: [],
        runtimeFacts: {
          acceptedAt: journal.position,
          quiescence: runIsPaused
            ? { _tag: "QuiescencePassive", reason: "RunPaused" }
            : { _tag: "QuiescenceProbeAllowed" },
          revision: currentRevision,
          taskWork: { capacity: policy.taskExecutionCapacity, held: activeAttemptPositions(journal) }
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
  ): CurrentSignal<A, DeliveryRelationSourceError> => ({
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

  const initial = yield* deriveBundle(yield* Ref.get(revision))
  const state = yield* SubscriptionRef.make<ReactiveDeliveryStatus>({ _tag: "ReactiveDeliveryOpen", bundle: initial })
  const gate = yield* Semaphore.make(1)
  const refresh = gate.withPermit(
    Ref.updateAndGet(revision, (current) => DeliveryRelationRevision.make(current + 1)).pipe(
      Effect.flatMap((nextRevision) =>
        deriveBundle(nextRevision).pipe(Effect.map((bundle) => [nextRevision, bundle] as const))
      ),
      Effect.matchCauseEffect({
        onFailure: (cause) =>
          SubscriptionRef.set(state, { _tag: "ReactiveDeliveryFailed", cause }).pipe(Effect.andThen(Ref.get(revision))),
        onSuccess: ([nextRevision, bundle]) =>
          SubscriptionRef.set(state, { _tag: "ReactiveDeliveryOpen", bundle }).pipe(Effect.as(nextRevision))
      })
    )
  )
  const invalidate = Effect.fn("DeliveryRelations.invalidate")(function* (cause: DeliveryInvalidation) {
    if (cause._tag === "QuiescenceProbeRequested" && Option.isNone(yield* Ref.get(probe))) {
      const currentJournal = yield* journal.state.get.pipe(
        Effect.matchEffect({
          onFailure: (failure) =>
            SubscriptionRef.set(state, { _tag: "ReactiveDeliveryFailed", cause: Cause.fail(failure) }).pipe(
              Effect.as(Option.none())
            ),
          onSuccess: (current) => Effect.succeed(Option.some(current))
        })
      )
      if (Option.isNone(currentJournal)) return yield* Ref.get(revision)
      yield* Ref.set(
        probe,
        Option.some(
          trackerGraphReadProposalOf({
            acceptedAt: currentJournal.value.position,
            purpose: "QuiescenceProbe",
            runId,
            target
          })
        )
      )
    }
    if (cause._tag === "ProposalCompleted") {
      const currentProbe = yield* Ref.get(probe)
      if (Option.isSome(currentProbe) && currentProbe.value.id === cause.proposalId) {
        yield* Ref.set(probe, Option.none())
      }
    }
    return yield* refresh
  })

  yield* journal.state.changes.pipe(
    Stream.runForEach(() => refresh),
    Effect.catchCause((cause) => SubscriptionRef.set(state, { _tag: "ReactiveDeliveryFailed", cause })),
    Effect.forkScoped
  )

  const bundleSignal = <A>(project: (bundle: ReactiveDeliveryBundle) => A) => statusSignal(project)
  return makeDeliveryRelationsLayer({
    evaluationConsistency: {
      currentRevision: Ref.get(revision),
      withStableRevision: (effect) => gate.withPermit(effect)
    },
    invalidate,
    runtimeFacts: bundleSignal(({ legacy }) => legacy.runtimeFacts),
    coherent: bundleSignal((bundle) => bundle)
  })
})

/** Scoped Layer form for application compositions that already own the journal service. */
export const reactiveDeliveryRelationsLayer = (
  runId: RunId,
  target: TrackerTarget,
  journal: JournalService,
  recovery: RunRecoveryProjectionSource
) => Layer.unwrap(makeReactiveDeliveryRelationsLayer(runId, target, journal, recovery))
