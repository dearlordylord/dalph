/* eslint-disable max-lines -- The journaled review protocol keeps its complete validation algebra together. */
import { Effect } from "effect"
import type { CoordinatorOwnershipError } from "./coordinator-lock.js"
import type { PlannedTaskAttempt, RunId } from "./domain.js"
import { authorizeImplementationReview, EvidenceStore, type EvidenceStoreService } from "./implementation-evidence.js"
import {
  ImplementationReviewCompletedEvent,
  ImplementationReviewIntendedEvent,
  ReviewFindingsHandbackCompletedEvent,
  ReviewFindingsHandbackIntendedEvent
} from "./implementation-review-journal.js"
import {
  type AuthorizedImplementationReviewRequest,
  authorizeImplementationReviewEvidence,
  extendReviewFindingHistory,
  type ImplementationReviewerService,
  ImplementationReviewHistoryContradiction,
  ImplementationReviewInvocationFailure,
  ImplementationReviewModeContradiction,
  ReviewFindingsHandbackAcknowledged,
  ReviewFindingsHandbackFailure,
  type ReviewFindingsHandbackRequest,
  type ReviewFindingsHandbackService,
  type SealedImplementationReview,
  sealImplementationReview
} from "./implementation-review.js"
import { workflowJournalEventVersion } from "./journal-event-version.js"
import { intentRecordKey, type JournalRecord, type JournalStoreService, outcomeRecordKey } from "./journal-store.js"
import { samePlannedTaskAttempt } from "./task-attempt-plan-recording.js"
import { firstTechnicalRetryAdmissionContradiction } from "./technical-retry-temporal.js"
import { captureTechnicalRetryPolicy, type TechnicalRetryPolicy, TechnicalRetryScope } from "./technical-retry.js"
import type { WorkflowOperation } from "./workflow-operation.js"

type ReviewOperation = typeof WorkflowOperation.cases.ReviewImplementation.Type
type HandbackOperation = typeof WorkflowOperation.cases.HandBackReviewFindings.Type

const sameEncoded = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right)

const reviewMatchesRequest = (
  review: SealedImplementationReview,
  request: AuthorizedImplementationReviewRequest
): boolean => {
  const manifest = review.manifest
  return sameEncoded(
    {
      findingHistory: manifest.findingHistory,
      implementationEvidenceReference: manifest.implementationEvidenceReference,
      implementerInvocationId: manifest.implementerInvocationId,
      implementerSessionId: manifest.implementerSessionId,
      operationId: manifest.operationId,
      plannedAttempt: manifest.plannedAttempt,
      predecessorEvidenceReference: manifest.predecessorEvidenceReference,
      reviewerSessionId: manifest.reviewerSessionId,
      round: manifest.round,
      roundLimit: manifest.roundLimit
    },
    {
      findingHistory: extendReviewFindingHistory(request.findingHistory, manifest.disposition),
      implementationEvidenceReference: request.implementationEvidence.manifestReference,
      implementerInvocationId: request.implementerInvocationId,
      implementerSessionId: request.implementerSessionId,
      operationId: request.operationId,
      plannedAttempt: request.plannedAttempt,
      predecessorEvidenceReference: request.predecessorEvidenceReference,
      reviewerSessionId: request.reviewerSessionId,
      round: request.round,
      roundLimit: request.roundLimit
    }
  )
}

const handbackAcknowledgesRequest = (
  acknowledgement: typeof ReviewFindingsHandbackAcknowledged.Type,
  request: ReviewFindingsHandbackRequest
): boolean =>
  sameEncoded(
    acknowledgement,
    ReviewFindingsHandbackAcknowledged.make({
      operationId: request.operationId,
      reviewEvidenceReference: request.review.manifestReference
    })
  )

const failHistory = (
  operationId: ReviewOperation["request"]["operationId"],
  reason: ConstructorParameters<typeof ImplementationReviewHistoryContradiction>[0]["reason"]
) => new ImplementationReviewHistoryContradiction({ operationId, reason })

const successfulExecutionsForAttempt = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt
) =>
  records.flatMap((record) => {
    const event = record.event
    if (event._tag !== "TaskExecutionOutcomeObserved" || event.outcome.outcome._tag !== "Succeeded") return []
    const intent = records.find(({ event: candidate }) =>
      candidate._tag === "TaskExecutionIntentRecorded"
      && candidate.operation.request.operationId === event.outcome.outcome.operationId
    )?.event
    if (
      intent?._tag !== "TaskExecutionIntentRecorded"
      || !samePlannedTaskAttempt(intent.operation.request.plannedAttempt, plannedAttempt)
    ) return []
    return [{ outcome: event.outcome.outcome, position: record.position }]
  })

const sameReference = (
  left: AuthorizedImplementationReviewRequest["predecessorEvidenceReference"],
  right: AuthorizedImplementationReviewRequest["predecessorEvidenceReference"]
): boolean => left.digest === right.digest && left.byteLength === right.byteLength

const requireAuthorizedReviewChain = Effect.fn("ImplementationReview.requireAuthorizedChain")(
  function*(records: ReadonlyArray<JournalRecord>, review: SealedImplementationReview) {
    let current = review
    for (;;) {
      yield* authorizeImplementationReviewEvidence(current)
      const implementationEvents = records.filter(({ event }) =>
        event._tag === "ImplementationEvidenceSealed"
        && sameReference(event.sealed.manifestReference, current.manifest.implementationEvidenceReference)
      )
      if (implementationEvents.length !== 1 || implementationEvents[0]?.event._tag !== "ImplementationEvidenceSealed") {
        return yield* failHistory(current.manifest.operationId, "MissingEvidence")
      }
      const implementation = implementationEvents[0].event.sealed
      const implementationManifest = implementation.manifest
      if (
        implementationManifest.runId !== current.manifest.plannedAttempt.runId
        || implementationManifest.taskId !== current.manifest.plannedAttempt.taskId
        || implementationManifest.plannedBaseSha !== current.manifest.plannedAttempt.baseSha
        || implementationManifest.predecessorOperationId !== current.manifest.implementerInvocationId
      ) return yield* failHistory(current.manifest.operationId, "EvidenceMismatch")
      yield* authorizeImplementationReview(implementation)
      if (current.manifest.round === 1) {
        if (
          !sameReference(
            current.manifest.predecessorEvidenceReference,
            current.manifest.implementationEvidenceReference
          )
          || !sameEncoded(
            current.manifest.findingHistory,
            extendReviewFindingHistory([], current.manifest.disposition)
          )
        ) return yield* failHistory(current.manifest.operationId, "FindingHistoryMismatch")
        return
      }
      const predecessors = records.flatMap(({ event }) =>
        event._tag === "ImplementationReviewCompleted"
          && sameReference(event.review.manifestReference, current.manifest.predecessorEvidenceReference)
          ? [event.review]
          : []
      )
      const previous = predecessors[0]
      if (previous === undefined) return yield* failHistory(current.manifest.operationId, "MissingEvidence")
      if (predecessors.length !== 1) {
        return yield* failHistory(current.manifest.operationId, "MissingEvidence")
      }
      if (
        !samePlannedTaskAttempt(previous.manifest.plannedAttempt, current.manifest.plannedAttempt)
        || previous.manifest.implementerInvocationId === current.manifest.implementerInvocationId
      ) return yield* failHistory(current.manifest.operationId, "CrossAttemptContinuation")
      if (previous.manifest.round + 1 !== current.manifest.round) {
        return yield* failHistory(current.manifest.operationId, "RoundMismatch")
      }
      if (previous.manifest.roundLimit !== current.manifest.roundLimit) {
        return yield* failHistory(current.manifest.operationId, "RoundMismatch")
      }
      if (
        !sameEncoded(
          current.manifest.findingHistory,
          extendReviewFindingHistory(previous.manifest.findingHistory, current.manifest.disposition)
        )
      ) return yield* failHistory(current.manifest.operationId, "FindingHistoryMismatch")
      current = previous
    }
  }
)

const requireReviewPredecessors = Effect.fn("ImplementationReview.requirePredecessors")(
  function*(
    records: ReadonlyArray<JournalRecord>,
    request: AuthorizedImplementationReviewRequest,
    requireLatestInvocation: boolean
  ) {
    const evidence = records.flatMap(({ event, position }) =>
      event._tag === "ImplementationEvidenceSealed"
        && event.operationId === request.evidenceSealingOperationId
        ? [{ event, position }]
        : []
    )
    if (evidence.length !== 1 || evidence[0] === undefined) {
      return yield* failHistory(request.operationId, "MissingEvidence")
    }
    if (JSON.stringify(request.implementationEvidence) !== JSON.stringify(evidence[0].event.sealed)) {
      return yield* failHistory(request.operationId, "EvidenceMismatch")
    }
    const implementationManifest = request.implementationEvidence.manifest
    if (
      implementationManifest.runId !== request.plannedAttempt.runId
      || implementationManifest.taskId !== request.plannedAttempt.taskId
      || implementationManifest.plannedBaseSha !== request.plannedAttempt.baseSha
    ) return yield* failHistory(request.operationId, "AttemptMismatch")
    if (implementationManifest.predecessorOperationId !== request.implementerInvocationId) {
      return yield* failHistory(request.operationId, "EvidenceMismatch")
    }
    yield* authorizeImplementationReview(request.implementationEvidence)
    const executions = successfulExecutionsForAttempt(records, request.plannedAttempt)
    const invocationExecutions = executions.filter(({ outcome }) =>
      outcome.operationId === request.implementerInvocationId
    )
    const evidenceExecutions = invocationExecutions.filter(({ outcome }) =>
      outcome.sessionId === request.implementerSessionId
    )
    const evidenceIntents = records.flatMap(({ event, position }) =>
      event._tag === "ImplementationEvidenceSealingIntended"
        && event.operation.operationId === request.evidenceSealingOperationId
        && event.operation.execution._tag === "SuccessfulExecution"
        && sameEncoded(event.operation.execution.outcome, evidenceExecutions[0]?.outcome)
        && samePlannedTaskAttempt(event.operation.plannedAttempt, request.plannedAttempt)
        ? [{ event, position }]
        : []
    )
    if (invocationExecutions.length === 0) {
      return yield* failHistory(request.operationId, "MissingImplementerInvocation")
    }
    const evidenceExecution = evidenceExecutions[0]
    const evidenceIntent = evidenceIntents[0]
    if (evidenceExecution === undefined) {
      return yield* failHistory(request.operationId, "ImplementerSessionMismatch")
    }
    if (evidenceIntent === undefined) {
      return yield* failHistory(request.operationId, "EvidenceMismatch")
    }
    if (evidenceExecutions.length !== 1 || evidenceIntents.length !== 1) {
      return yield* failHistory(request.operationId, "EvidenceMismatch")
    }
    if (
      evidenceExecution.position >= evidenceIntent.position
      || evidenceIntent.position >= evidence[0].position
    ) return yield* failHistory(request.operationId, "EvidenceMismatch")
    if (requireLatestInvocation) {
      const latest = executions.reduce(
        (current, candidate) => candidate.position > current.position ? candidate : current,
        evidenceExecution
      )
      if (latest.outcome.operationId !== request.implementerInvocationId) {
        return yield* failHistory(request.operationId, "ImplementerInvocationIsNotLatest")
      }
    }
    if (
      records.some(({ event }) =>
        (event._tag === "ImplementationReviewCompleted"
          && event.review.manifest.operationId !== request.operationId
          && event.review.manifest.reviewerSessionId === request.reviewerSessionId)
        || (event._tag === "ImplementationReviewIntended"
          && event.operation.request._tag === "AuthorizedImplementationReview"
          && event.operation.request.operationId !== request.operationId
          && event.operation.request.reviewerSessionId === request.reviewerSessionId)
      )
    ) return yield* failHistory(request.operationId, "ReviewerSessionReused")
    if (request.round === 1) {
      if (
        request.predecessorEvidenceReference.digest !== request.implementationEvidence.manifestReference.digest
        || request.predecessorEvidenceReference.byteLength
          !== request.implementationEvidence.manifestReference.byteLength
      ) return yield* failHistory(request.operationId, "EvidenceMismatch")
      if (request.findingHistory.length !== 0) {
        return yield* failHistory(request.operationId, "FindingHistoryMismatch")
      }
      return
    }
    const previousRecord = records.findLast(({ event }) =>
      event._tag === "ImplementationReviewCompleted"
      && event.review.manifestReference.digest === request.predecessorEvidenceReference.digest
      && event.review.manifestReference.byteLength === request.predecessorEvidenceReference.byteLength
    )
    if (previousRecord?.event._tag !== "ImplementationReviewCompleted") {
      return yield* failHistory(request.operationId, "MissingEvidence")
    }
    const previous = previousRecord.event
    if (
      !samePlannedTaskAttempt(previous.review.manifest.plannedAttempt, request.plannedAttempt)
      || previous.review.manifest.implementerInvocationId === request.implementerInvocationId
    ) return yield* failHistory(request.operationId, "CrossAttemptContinuation")
    if (previous.review.manifest.disposition._tag !== "Findings") {
      return yield* failHistory(request.operationId, "HandbackWithoutFindings")
    }
    if (previous.review.manifest.round + 1 !== request.round) {
      return yield* failHistory(request.operationId, "RoundMismatch")
    }
    if (previous.review.manifest.roundLimit !== request.roundLimit) {
      return yield* failHistory(request.operationId, "RoundMismatch")
    }
    if (JSON.stringify(previous.review.manifest.findingHistory) !== JSON.stringify(request.findingHistory)) {
      return yield* failHistory(request.operationId, "FindingHistoryMismatch")
    }
    const previousPosition = previousRecord.position
    const handbackIntents = records.flatMap(({ event, position }) =>
      event._tag === "ReviewFindingsHandbackIntended"
        && event.operation.request.reviewOperationId === previous.review.manifest.operationId
        && sameEncoded(event.operation.request.review, previous.review)
        && event.operation.request.implementerInvocationId === previous.review.manifest.implementerInvocationId
        && event.operation.request.implementerSessionId === request.implementerSessionId
        && samePlannedTaskAttempt(event.operation.request.plannedAttempt, request.plannedAttempt)
        ? [{ event, position }]
        : []
    )
    if (handbackIntents.length !== 1 || handbackIntents[0] === undefined) {
      return yield* failHistory(request.operationId, "MissingEvidence")
    }
    const handbackIntent = handbackIntents[0]
    const handbackOperationId = handbackIntent.event.operation.request.operationId
    const handbackOutcomes = records.filter(({ event }) =>
      event._tag === "ReviewFindingsHandbackCompleted"
      && event.acknowledgement.operationId === handbackOperationId
      && handbackAcknowledgesRequest(event.acknowledgement, handbackIntent.event.operation.request)
    )
    if (handbackOutcomes.length !== 1 || handbackOutcomes[0] === undefined) {
      return yield* failHistory(request.operationId, "MissingEvidence")
    }
    const executionIntents = records.flatMap(({ event, position }) =>
      event._tag === "TaskExecutionIntentRecorded"
        && event.operation.request.operationId === request.implementerInvocationId
        ? [{ event, position }]
        : []
    )
    if (executionIntents.length !== 1 || executionIntents[0] === undefined) {
      return yield* failHistory(request.operationId, "MissingImplementerInvocation")
    }
    const executionIntent = executionIntents[0]
    const session = executionIntent.event.operation.request.session
    const establishedSessions = records.flatMap(({ event, position }) =>
      event._tag === "TaskWorkSessionEstablished"
        && event.outcome.sessionId === request.implementerSessionId
        && records.some(({ event: candidate }) =>
          candidate._tag === "TaskWorkSessionEstablishmentIntentRecorded"
          && candidate.operation.request.operationId === event.outcome.operationId
          && samePlannedTaskAttempt(candidate.operation.request.plannedAttempt, request.plannedAttempt)
        )
        ? [{ event, position }]
        : []
    )
    if (establishedSessions.length !== 1 || establishedSessions[0] === undefined) {
      return yield* failHistory(request.operationId, "ImplementerSessionMismatch")
    }
    const establishedSession = establishedSessions[0]
    if (
      session._tag !== "EstablishedSession"
      || session.sessionId !== request.implementerSessionId
      || !executionIntent.event.operation.predecessorOperationIds.includes(handbackOperationId)
      || !executionIntent.event.operation.predecessorOperationIds.includes(
        establishedSession.event.outcome.operationId
      )
      || previousPosition >= handbackIntent.position
      || handbackIntent.position >= handbackOutcomes[0].position
      || handbackOutcomes[0].position >= executionIntent.position
      || executionIntent.position >= evidence[0].position
    ) return yield* failHistory(request.operationId, "ImplementerSessionMismatch")
    yield* requireAuthorizedReviewChain(records, previous.review)
  }
)

interface JournaledImplementationReviewOptions {
  readonly evidenceStore: EvidenceStoreService
  readonly handback: ReviewFindingsHandbackService
  readonly journal: JournalStoreService
  readonly reviewer: ImplementationReviewerService
  readonly runId: RunId
  readonly technicalRetryPolicy?: TechnicalRetryPolicy
}

/** Invokes and seals one exact fresh review, idempotently returning a durable outcome. */
export const makeJournaledImplementationReview = (options: JournaledImplementationReviewOptions) =>
  Effect.fn("WorkflowInterpreter.Journaled.reviewImplementation")(function*(operation: ReviewOperation) {
    const request = operation.request
    if (request._tag !== "AuthorizedImplementationReview") {
      return yield* new ImplementationReviewModeContradiction({ operationId: request.operationId })
    }
    if (request.plannedAttempt.runId !== options.runId) {
      return yield* failHistory(request.operationId, "RunMismatch")
    }
    const records = yield* options.journal.read(options.runId)
    const intents = records.flatMap(({ event }) =>
      event._tag === "ImplementationReviewIntended"
        && event.operation.request.operationId === request.operationId
        ? [event.operation]
        : []
    )
    if (intents.length > 1) return yield* failHistory(request.operationId, "MultipleIntents")
    if (intents[0] !== undefined && !sameEncoded(intents[0], operation)) {
      return yield* failHistory(request.operationId, "IntentMismatch")
    }
    const outcomes = records.flatMap(({ event }) =>
      event._tag === "ImplementationReviewCompleted"
        && event.review.manifest.operationId === request.operationId
        ? [event.review]
        : []
    )
    if (outcomes.length > 1) return yield* failHistory(request.operationId, "MultipleOutcomes")
    const retryTemporalFailure = firstTechnicalRetryAdmissionContradiction(records, request.operationId)
    if (retryTemporalFailure !== undefined) return yield* failHistory(request.operationId, retryTemporalFailure)
    if (outcomes[0] !== undefined) {
      if (intents[0] === undefined) return yield* failHistory(request.operationId, "OutcomeWithoutIntent")
      if (!reviewMatchesRequest(outcomes[0], request)) {
        return yield* failHistory(request.operationId, "ReviewMismatch")
      }
      yield* requireReviewPredecessors(records, request, false).pipe(
        Effect.provideService(EvidenceStore, options.evidenceStore)
      )
      yield* requireAuthorizedReviewChain(records, outcomes[0]).pipe(
        Effect.provideService(EvidenceStore, options.evidenceStore)
      )
      return outcomes[0]
    }
    yield* requireReviewPredecessors(records, request, true).pipe(
      Effect.provideService(EvidenceStore, options.evidenceStore)
    )
    const technicalRetry = {
      isRetryable: (failure: unknown): failure is ImplementationReviewInvocationFailure =>
        failure instanceof ImplementationReviewInvocationFailure,
      journal: options.journal,
      policy: options.technicalRetryPolicy,
      runId: options.runId,
      scope: TechnicalRetryScope.cases.ImplementationReviewInvocation.make({
        operationId: request.operationId,
        reviewerSessionId: request.reviewerSessionId,
        semanticRound: request.round
      })
    }
    const capturedTechnicalRetry = yield* captureTechnicalRetryPolicy<
      CoordinatorOwnershipError | ImplementationReviewInvocationFailure
    >(technicalRetry)
    yield* options.journal.append(
      options.runId,
      intentRecordKey(request.operationId),
      ImplementationReviewIntendedEvent.make({ operation, version: workflowJournalEventVersion })
    )
    const disposition = yield* capturedTechnicalRetry.run(options.reviewer.createOrResume(request))
    const review = yield* sealImplementationReview(request, disposition).pipe(
      Effect.provideService(EvidenceStore, options.evidenceStore)
    )
    yield* options.journal.append(
      options.runId,
      outcomeRecordKey(request.operationId),
      ImplementationReviewCompletedEvent.make({ review, version: workflowJournalEventVersion })
    )
    return review
  })

/** Returns findings only to the latest exact implementer invocation and journals acknowledgement. */
export const makeJournaledReviewFindingsHandback = (options: JournaledImplementationReviewOptions) =>
  Effect.fn("WorkflowInterpreter.Journaled.handBackReviewFindings")(function*(operation: HandbackOperation) {
    const request = operation.request
    if (request.plannedAttempt.runId !== options.runId) {
      return yield* failHistory(request.operationId, "RunMismatch")
    }
    const records = yield* options.journal.read(options.runId)
    const intents = records.flatMap(({ event }) =>
      event._tag === "ReviewFindingsHandbackIntended"
        && event.operation.request.operationId === request.operationId
        ? [event.operation]
        : []
    )
    if (intents.length > 1) return yield* failHistory(request.operationId, "MultipleIntents")
    if (intents[0] !== undefined && !sameEncoded(intents[0], operation)) {
      return yield* failHistory(request.operationId, "IntentMismatch")
    }
    const outcomes = records.flatMap(({ event }) =>
      event._tag === "ReviewFindingsHandbackCompleted"
        && event.acknowledgement.operationId === request.operationId
        ? [event.acknowledgement]
        : []
    )
    if (outcomes.length > 1) return yield* failHistory(request.operationId, "MultipleOutcomes")
    const retryTemporalFailure = firstTechnicalRetryAdmissionContradiction(records, request.operationId)
    if (retryTemporalFailure !== undefined) return yield* failHistory(request.operationId, retryTemporalFailure)
    const reviewEvents = records.filter(({ event }) =>
      event._tag === "ImplementationReviewCompleted"
      && event.review.manifest.operationId === request.reviewOperationId
    )
    if (reviewEvents.length !== 1 || reviewEvents[0]?.event._tag !== "ImplementationReviewCompleted") {
      return yield* failHistory(request.operationId, "MissingEvidence")
    }
    if (JSON.stringify(reviewEvents[0].event.review) !== JSON.stringify(request.review)) {
      return yield* failHistory(request.operationId, "ReviewMismatch")
    }
    const manifest = request.review.manifest
    if (manifest.disposition._tag !== "Findings") {
      return yield* failHistory(request.operationId, "HandbackWithoutFindings")
    }
    if (!samePlannedTaskAttempt(manifest.plannedAttempt, request.plannedAttempt)) {
      return yield* failHistory(request.operationId, "CrossAttemptContinuation")
    }
    if (manifest.implementerInvocationId !== request.implementerInvocationId) {
      return yield* failHistory(request.operationId, "ImplementerInvocationIsNotLatest")
    }
    if (manifest.implementerSessionId !== request.implementerSessionId) {
      return yield* failHistory(request.operationId, "ImplementerSessionMismatch")
    }
    yield* requireAuthorizedReviewChain(records, request.review).pipe(
      Effect.provideService(EvidenceStore, options.evidenceStore)
    )
    if (outcomes[0] !== undefined) {
      if (intents[0] === undefined) return yield* failHistory(request.operationId, "OutcomeWithoutIntent")
      if (!handbackAcknowledgesRequest(outcomes[0], request)) {
        return yield* failHistory(request.operationId, "ReviewMismatch")
      }
      return outcomes[0]
    }
    const latest = successfulExecutionsForAttempt(records, request.plannedAttempt)
      .toSorted((left, right) => right.position - left.position)[0]
    if (latest?.outcome.operationId !== request.implementerInvocationId) {
      return yield* failHistory(request.operationId, "ImplementerInvocationIsNotLatest")
    }
    const technicalRetry = {
      isRetryable: (failure: unknown): failure is ReviewFindingsHandbackFailure =>
        failure instanceof ReviewFindingsHandbackFailure,
      journal: options.journal,
      policy: options.technicalRetryPolicy,
      runId: options.runId,
      scope: TechnicalRetryScope.cases.ReviewFindingsHandbackInvocation.make({
        operationId: request.operationId,
        reviewOperationId: request.reviewOperationId,
        semanticRound: request.review.manifest.round
      })
    }
    const capturedTechnicalRetry = yield* captureTechnicalRetryPolicy<
      CoordinatorOwnershipError | ReviewFindingsHandbackFailure
    >(technicalRetry)
    yield* options.journal.append(
      options.runId,
      intentRecordKey(request.operationId),
      ReviewFindingsHandbackIntendedEvent.make({ operation, version: workflowJournalEventVersion })
    )
    const acknowledgement = yield* capturedTechnicalRetry.run(options.handback.deliverOrResume(request))
    if (!handbackAcknowledgesRequest(acknowledgement, request)) {
      return yield* failHistory(request.operationId, "ReviewMismatch")
    }
    yield* options.journal.append(
      options.runId,
      outcomeRecordKey(request.operationId),
      ReviewFindingsHandbackCompletedEvent.make({ acknowledgement, version: workflowJournalEventVersion })
    )
    return acknowledgement
  })
