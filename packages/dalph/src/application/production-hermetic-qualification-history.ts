import { GitCommitSha, plannedAttemptExecutorCorrelation } from "@dalph/contracts"
import {
  completionClaimDeletionRequestFor,
  completionClaimReplacementRequestFor,
  completionOriginalTaskClaimReleaseFor,
  completionTaskRequestLookupOperationIdFor,
  completionTaskCandidateAncestryReadOperationIdFor,
  type CompletionTaskClaim,
  FocusedTaskCompletionFactsObserved,
  IntegratorSessionCorrelation,
  TargetPromotionCorrelation,
  TraceAtCursor,
  type WorkflowOccurrence
} from "@dalph/orchestrator"
import { Effect, Schema } from "effect"
import {
  sourceRejected,
  validateActiveClaim,
  strictSource,
  validateOperationId,
  validatePlannedAttempt,
  validateTarget,
  validateWorkflowOperationId,
  qualificationPlannedAttemptFor,
  type HermeticQualificationSourceRejected,
  type QualificationContext
} from "./production-hermetic-qualification-attempt-source.js"
import {
  validateCandidate,
  validateCompletionClaim,
  validateCompletionRequest,
  validateDeletionRequest,
  validateGraph,
  validateOperation,
  validateRunCorrelation,
  validateSessionCorrelation,
  validateTrackerFacts
} from "./production-hermetic-qualification-fixture-source.js"

const controlledOccurrenceTag = Schema.Literals([
  "GitReadInitiated",
  "TaskAttemptPlanned",
  "TaskClaimAcquisitionInitiated",
  "TaskClaimAcquired",
  "TaskTrackerReadInitiated",
  "TaskTrackerFactsObserved",
  "TaskWorktreeReconciliationInitiated",
  "TaskWorktreeReady",
  "PlannedAttemptExecutorWorkResponsibilityBegan",
  "PlannedAttemptExecutorWorkReported",
  "PlannedAttemptWorktreeObserved",
  "IntegrationResponsibilityBegan",
  "IntegrationStarted",
  "TargetLineageObserved",
  "IntegratorSessionFixed",
  "IntegratorRunStarted",
  "IntegratorRunResultRecorded",
  "IntegratorCandidateQualificationInitiated",
  "IntegratorCandidateQualificationObserved",
  "TargetPromotionRequested",
  "TargetPromotionAttemptRequested",
  "TargetPromotionSucceeded",
  "TargetPromotionStale",
  "IntegrationQuarantined",
  "TaskClaimReleaseInitiated",
  "TaskClaimReleased",
  "IntegrationClaimReplacementOccurred",
  "IntegrationClaimDeletionOccurred",
  "IntegrationFinalitySettledOccurred",
  "IntegrationFocusedCompletionOccurred"
])

type FinalityOccurrence = Extract<
  WorkflowOccurrence,
  {
    readonly _tag:
      | "IntegrationClaimReplacementOccurred"
      | "IntegrationClaimDeletionOccurred"
      | "IntegrationFinalitySettledOccurred"
      | "IntegrationFocusedCompletionOccurred"
  }
>

const finalityClaim = (occurrence: FinalityOccurrence): CompletionTaskClaim => {
  const event = occurrence.event
  if ("claim" in event) return event.claim
  if ("request" in event) return event.request.claim
  return event.authorization.claim
}

const historicalDerivedOperationIds = Effect.fn("HermeticQualification.historicalDerivedOperationIds")(function* (
  snapshot: TraceAtCursor,
  context: QualificationContext
) {
  return yield* Effect.forEach(snapshot.items, (item) =>
    Effect.gen(function* () {
      const occurrence = item.occurrence
      if (occurrence._tag === "TaskTrackerFactsObserved" && occurrence.evidence._tag === "FocusedTaskCompletionFacts") {
        const facts = yield* Schema.decodeUnknownEffect(
          FocusedTaskCompletionFactsObserved,
          strictSource
        )(occurrence.evidence).pipe(Effect.mapError(sourceRejected))
        yield* validateCompletionRequest(facts.request, context)
        return [facts.operationId]
      }
      if (
        occurrence._tag !== "IntegrationClaimReplacementOccurred" &&
        occurrence._tag !== "IntegrationClaimDeletionOccurred" &&
        occurrence._tag !== "IntegrationFinalitySettledOccurred" &&
        occurrence._tag !== "IntegrationFocusedCompletionOccurred"
      )
        return []
      const claim = yield* validateCompletionClaim(finalityClaim(occurrence), context)
      return [completionOriginalTaskClaimReleaseFor(claim).operationId]
    })
  ).pipe(Effect.map((ids) => ids.flat()))
})

const validateWorktreeProof = Effect.fn("HermeticQualification.validateWorktreeProof")(function* (
  occurrence: Extract<WorkflowOccurrence, { readonly _tag: "TaskWorktreeReady" | "PlannedAttemptWorktreeObserved" }>,
  context: QualificationContext
) {
  const proof = occurrence._tag === "TaskWorktreeReady" ? occurrence.proof : occurrence.observation
  if (proof._tag !== "PlannedWorktreeReady") return yield* sourceRejected()
  const plan =
    occurrence._tag === "TaskWorktreeReady"
      ? occurrence.operation.plannedAttempt
      : qualificationPlannedAttemptFor(context)
  yield* validatePlannedAttempt(plan, context)
  if (proof.worktree !== plan.worktree || proof.branch !== plan.branch || proof.baseSha !== plan.baseSha)
    return yield* sourceRejected()
})

const validateHistoricalCorrelation = Effect.fn("HermeticQualification.validateHistoricalCorrelation")(function* (
  occurrence: WorkflowOccurrence,
  context: QualificationContext
) {
  if ("run" in occurrence) yield* validateRunCorrelation(occurrence.run, context)
  if ("originatingActionRun" in occurrence) yield* validateRunCorrelation(occurrence.originatingActionRun, context)
  if ("candidateText" in occurrence)
    yield* Schema.decodeUnknownEffect(
      GitCommitSha,
      strictSource
    )(occurrence.candidateText).pipe(Effect.mapError(sourceRejected))
  if (!("correlation" in occurrence)) return
  if (Schema.is(TargetPromotionCorrelation)(occurrence.correlation)) {
    yield* validateCandidate(occurrence.correlation.qualifiedCandidate, context)
    return
  }
  if (Schema.is(IntegratorSessionCorrelation)(occurrence.correlation)) {
    yield* validateSessionCorrelation(occurrence.correlation, context)
    return
  }
  return yield* sourceRejected()
})

const validateHistoricalResult = Effect.fn("HermeticQualification.validateHistoricalResult")(function* (
  occurrence: WorkflowOccurrence,
  context: QualificationContext
) {
  if (occurrence._tag === "IntegratorRunResultRecorded") {
    if (occurrence.result._tag !== "PreparedCandidate") return yield* sourceRejected()
    yield* validateRunCorrelation(occurrence.result.correlation, context)
    yield* Schema.decodeUnknownEffect(
      GitCommitSha,
      strictSource
    )(occurrence.result.candidateText).pipe(Effect.mapError(sourceRejected))
  }
  if (occurrence._tag === "IntegrationQuarantined" && occurrence.basis._tag !== "PromotionStale")
    return yield* sourceRejected()
  if (occurrence._tag === "PlannedAttemptExecutorWorkReported") {
    const expected = plannedAttemptExecutorCorrelation(qualificationPlannedAttemptFor(context))
    if (
      occurrence.report.correlation.runId !== expected.runId ||
      occurrence.report.correlation.attemptId !== expected.attemptId
    )
      return yield* sourceRejected()
  }
})

const validateFinalityOccurrence = Effect.fn("HermeticQualification.validateFinalityOccurrence")(function* (
  occurrence: FinalityOccurrence,
  snapshot: TraceAtCursor,
  context: QualificationContext
) {
  const claim = yield* validateCompletionClaim(finalityClaim(occurrence), context)
  if (occurrence._tag === "IntegrationClaimReplacementOccurred") {
    if (occurrence.event.operationId !== completionClaimReplacementRequestFor(claim).operationId)
      return yield* sourceRejected()
    return
  }
  if (
    occurrence._tag === "IntegrationClaimDeletionOccurred" ||
    occurrence._tag === "IntegrationFinalitySettledOccurred"
  ) {
    return yield* validateDeletionOccurrence(occurrence, context)
  }
  return yield* validateCompletionOccurrence(occurrence, snapshot, context)
})

const validateDeletionOccurrence = Effect.fn("HermeticQualification.validateDeletionOccurrence")(function* (
  occurrence: Extract<
    FinalityOccurrence,
    { readonly _tag: "IntegrationClaimDeletionOccurred" | "IntegrationFinalitySettledOccurred" }
  >,
  context: QualificationContext
) {
  const event = occurrence.event
  const request =
    event._tag === "CompletionClaimDeletionReadObserved"
      ? event.request
      : completionClaimDeletionRequestFor(event.claim, event.successObservation)
  yield* validateDeletionRequest(request, context)
  yield* validateDeletionEventOperationIds(event, request)
  if (event._tag === "CompletionClaimDeletionReadObserved") yield* validateDeletionReadClaim(event.observation, context)
})

type DeletionEvent = Extract<
  FinalityOccurrence,
  { readonly _tag: "IntegrationClaimDeletionOccurred" | "IntegrationFinalitySettledOccurred" }
>["event"]
const validateDeletionEventOperationIds = Effect.fn("HermeticQualification.validateDeletionEventOperationIds")(
  function* (event: DeletionEvent, request: ReturnType<typeof completionClaimDeletionRequestFor>) {
    if ("operationId" in event && event.operationId !== request.operationId) return yield* sourceRejected()
    if ("deletionOperationId" in event && event.deletionOperationId !== request.operationId)
      return yield* sourceRejected()
    if (
      "replacementOperationId" in event &&
      event.replacementOperationId !== completionClaimReplacementRequestFor(request.claim).operationId
    )
      return yield* sourceRejected()
  }
)

type CompletionEvent = Extract<FinalityOccurrence, { readonly _tag: "IntegrationFocusedCompletionOccurred" }>["event"]

const validateDeletionReadClaim = Effect.fn("HermeticQualification.validateDeletionReadClaim")(function* (
  observation: Extract<DeletionEvent, { readonly _tag: "CompletionClaimDeletionReadObserved" }>["observation"],
  context: QualificationContext
) {
  if (observation._tag === "CompletionTaskClaim") yield* validateCompletionClaim(observation, context)
  else if (observation._tag === "ActiveTaskClaim") yield* validateActiveClaim(observation, context)
  else if (
    (observation._tag !== "UnclaimedTask" && observation._tag !== "CompletionClaimMarkerAbsent") ||
    observation.taskId !== context.taskId
  )
    return yield* sourceRejected()
})

const validateCompletionOccurrence = Effect.fn("HermeticQualification.validateCompletionOccurrence")(function* (
  occurrence: Extract<FinalityOccurrence, { readonly _tag: "IntegrationFocusedCompletionOccurred" }>,
  snapshot: TraceAtCursor,
  context: QualificationContext
) {
  const event = occurrence.event
  if (
    event._tag === "CompletionTaskRejected" ||
    event._tag === "PostPromotionBlockerCandidateAncestryReadIntended" ||
    event._tag === "PostPromotionBlockerCandidateAncestryObserved"
  )
    return yield* sourceRejected()
  yield* validateCompletionRequest(event.request, context)
  yield* validateCompletionLookupOccurrence(event, context)
  yield* validateCompletionAncestryOccurrence(event, snapshot)
  yield* validateCompletionCallReferences(occurrence, snapshot)
})

const validateCompletionCallReferences = Effect.fn("HermeticQualification.validateCompletionCallReferences")(function* (
  occurrence: Extract<FinalityOccurrence, { readonly _tag: "IntegrationFocusedCompletionOccurred" }>,
  snapshot: TraceAtCursor
) {
  const event = occurrence.event
  if (event._tag === "CompletionTaskAcknowledged") {
    if (
      event.acknowledgement.operationId !== event.request.operationId ||
      event.acknowledgement.taskId !== event.request.taskId
    )
      return yield* sourceRejected()
    return
  }
  if (event._tag !== "CompletionTaskAttemptIntended") return
  const authorization = snapshot.items.find((item) => {
    if (item.occurrence._tag !== "TaskTrackerFactsObserved") return false
    const facts = item.occurrence.evidence
    if (facts._tag !== "FocusedTaskCompletionFacts" || facts.purpose._tag !== "Authorization") return false
    return (
      item.occurrence.recordedAt < occurrence.recordedAt &&
      facts.request.operationId === event.request.operationId &&
      facts.purpose.attemptOrdinal === event.attemptOrdinal &&
      facts.operationId === event.focusedFactsOperationId &&
      completionTaskCandidateAncestryReadOperationIdFor(event.request, facts.purpose) === event.gitReadOperationId
    )
  })
  if (authorization === undefined) return yield* sourceRejected()
  const ancestryObserved = snapshot.items.some((item) => {
    if (item.occurrence._tag !== "IntegrationFocusedCompletionOccurred") return false
    const prior = item.occurrence.event
    return (
      prior._tag === "CompletionTaskCandidateAncestryObserved" &&
      item.occurrence.recordedAt < occurrence.recordedAt &&
      prior.request.operationId === event.request.operationId &&
      prior.attemptOrdinal === event.attemptOrdinal &&
      prior.operationId === event.gitReadOperationId
    )
  })
  if (!ancestryObserved) return yield* sourceRejected()
})

const validateCompletionLookupOccurrence = Effect.fn("HermeticQualification.validateCompletionLookupOccurrence")(
  function* (event: CompletionEvent, context: QualificationContext) {
    if (event._tag === "CompletionTaskRequestLookupObserved") {
      yield* validateCompletionRequest(event.lookup.request, context)
      if (
        event.lookup._tag === "Unreadable" &&
        event.lookup.detail !== "GitHub cannot query a prior CloseIssue request by clientMutationId"
      )
        return yield* sourceRejected()
    }
    if (event._tag === "CompletionTaskRequestLookupIntended" || event._tag === "CompletionTaskRequestLookupObserved") {
      if (event.operationId !== completionTaskRequestLookupOperationIdFor(event.request, event.attemptOrdinal))
        return yield* sourceRejected()
    }
  }
)

const validateCompletionAncestryOccurrence = Effect.fn("HermeticQualification.validateCompletionAncestryOccurrence")(
  function* (event: CompletionEvent, snapshot: TraceAtCursor) {
    if (
      event._tag === "CompletionTaskCandidateAncestryReadIntended" ||
      event._tag === "CompletionTaskCandidateAncestryObserved"
    ) {
      const request = event.request
      const authorizations = snapshot.items.filter(
        (item) =>
          item.occurrence._tag === "TaskTrackerFactsObserved" &&
          item.occurrence.evidence._tag === "FocusedTaskCompletionFacts" &&
          item.occurrence.evidence.purpose._tag === "Authorization"
      )
      const matched = authorizations.some(
        (item) =>
          item.occurrence._tag === "TaskTrackerFactsObserved" &&
          item.occurrence.evidence._tag === "FocusedTaskCompletionFacts" &&
          item.occurrence.evidence.purpose._tag === "Authorization" &&
          item.occurrence.evidence.request.operationId === request.operationId &&
          item.occurrence.evidence.purpose.attemptOrdinal === event.attemptOrdinal &&
          completionTaskCandidateAncestryReadOperationIdFor(request, item.occurrence.evidence.purpose) ===
            event.operationId
      )
      if (!matched) return yield* sourceRejected()
    }
  }
)

const validateOccurrence = Effect.fn("HermeticQualification.validateOccurrence")(function* (
  occurrence: WorkflowOccurrence,
  snapshot: TraceAtCursor,
  context: QualificationContext
) {
  yield* Schema.decodeUnknownEffect(
    controlledOccurrenceTag,
    strictSource
  )(occurrence._tag).pipe(Effect.mapError(sourceRejected))
  if (!("runId" in occurrence) || occurrence.runId !== context.runId) return yield* sourceRejected()
  yield* validateHistoricalActionAttribution(occurrence, context)
  yield* validateOccurrenceWorkflowAtoms(occurrence, context)
  if (occurrence._tag === "TaskTrackerFactsObserved") yield* validateTrackerFacts(occurrence.evidence, context)
  if (occurrence._tag === "TaskWorktreeReady" || occurrence._tag === "PlannedAttemptWorktreeObserved")
    yield* validateWorktreeProof(occurrence, context)
  yield* validateHistoricalCorrelation(occurrence, context)
  yield* validateHistoricalResult(occurrence, context)
  yield* validateOccurrenceFinality(occurrence, snapshot, context)
})

const validateOccurrenceWorkflowAtoms = Effect.fn("HermeticQualification.validateOccurrenceWorkflowAtoms")(function* (
  occurrence: WorkflowOccurrence,
  context: QualificationContext
) {
  if ("operation" in occurrence) yield* validateOperation(occurrence.operation, context)
  if ("plannedAttempt" in occurrence) yield* validatePlannedAttempt(occurrence.plannedAttempt, context)
  if ("integrationTarget" in occurrence) yield* validateTarget(occurrence.integrationTarget, context)
  if ("claim" in occurrence) yield* validateActiveClaim(occurrence.claim, context)
  if ("release" in occurrence) {
    yield* validateActiveClaim(occurrence.release.claim, context)
    yield* validateWorkflowOperationId(occurrence.release.operationId, context)
  }
})

const validateOccurrenceFinality = Effect.fn("HermeticQualification.validateOccurrenceFinality")(function* (
  occurrence: WorkflowOccurrence,
  snapshot: TraceAtCursor,
  context: QualificationContext
) {
  if (
    occurrence._tag === "IntegrationClaimReplacementOccurred" ||
    occurrence._tag === "IntegrationClaimDeletionOccurred" ||
    occurrence._tag === "IntegrationFinalitySettledOccurred" ||
    occurrence._tag === "IntegrationFocusedCompletionOccurred"
  )
    yield* validateFinalityOccurrence(occurrence, snapshot, context)
})

const validateHistoricalActionAttribution = Effect.fn("HermeticQualification.validateHistoricalActionAttribution")(
  function* (occurrence: WorkflowOccurrence, context: QualificationContext) {
    if ("originatingActionOperationId" in occurrence)
      yield* validateWorkflowOperationId(occurrence.originatingActionOperationId, context)
    if ("operationId" in occurrence) yield* validateWorkflowOperationId(occurrence.operationId, context)
  }
)

/** Checks the existing original cursor view once; its existing invariants recompute every historical facet from items. */
export const validateHermeticQualificationHistoricalSource: (
  snapshot: TraceAtCursor,
  context: QualificationContext
) => Effect.Effect<TraceAtCursor, HermeticQualificationSourceRejected> = Effect.fn(
  "HermeticQualification.validateHistoricalSource"
)(function* (
  snapshot: TraceAtCursor,
  context: QualificationContext
): Effect.fn.Return<TraceAtCursor, HermeticQualificationSourceRejected> {
  const original = yield* Schema.decodeUnknownEffect(
    TraceAtCursor,
    strictSource
  )(snapshot).pipe(Effect.mapError(sourceRejected))
  if (original.cursor.runId !== context.runId || original.derivedTaskOrder.taskIds.some((id) => id !== context.taskId))
    return yield* sourceRejected()
  if (original.graph !== null) {
    yield* validateGraph(original.graph.snapshot, context)
    yield* validateOperationId(original.graph.observation.operationId)
  }
  yield* Effect.forEach(original.relationships.processLocalResourceSerializations, (relationship) =>
    validateTarget(relationship.target, context)
  )
  const derivedOperationIds = yield* historicalDerivedOperationIds(original, context)
  yield* Effect.forEach(original.items, (item) =>
    validateOccurrence(item.occurrence, original, { ...context, derivedOperationIds })
  )
  return snapshot
})
