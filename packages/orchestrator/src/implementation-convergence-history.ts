import type { PlannedTaskAttempt } from "./domain.js"
import type {
  ImplementationConvergenceDisposition,
  ImplementationConvergenceSubject
} from "./implementation-convergence.js"
import {
  type AuthorizedImplementationReviewRequest,
  extendReviewFindingHistory,
  type ReviewFindingsHandbackRequest,
  type SealedImplementationReview
} from "./implementation-review.js"
import type { JournalRecord } from "./journal-store.js"
import { samePlannedTaskAttempt } from "./task-attempt-plan-recording.js"
import type { TaskExecutionOutcome } from "./task-execution.js"
import { TechnicalRetryScope } from "./technical-retry.js"
import type { ActiveTaskClaim } from "./tracker-mutation.js"
import type { WorkflowOperation } from "./workflow-operation.js"

export const sameEncoded = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right)

/** Proves the retained ready-worktree fact is the exact authoritative outcome of this attempt's reconciliation. */
export const convergenceSubjectWorktreeMatches = (
  records: ReadonlyArray<JournalRecord>,
  subject: ImplementationConvergenceSubject
): boolean => {
  const ready = records.filter(({ event }) =>
    event._tag === "TaskWorktreeReady"
    && event.operationId === subject.worktreeOperationId
  )
  if (ready.length !== 1 || ready[0]?.event._tag !== "TaskWorktreeReady") return false
  const intents = records.filter(({ event }) =>
    event._tag === "TaskWorktreeReconciliationIntended"
    && event.operation.operationId === subject.worktreeOperationId
  )
  const plans = records.filter(({ event }) =>
    event._tag === "TaskAttemptPlanned"
    && samePlannedTaskAttempt(event.operation.plannedAttempt, subject.plannedAttempt)
  )
  return intents.length === 1
    && intents[0]?.event._tag === "TaskWorktreeReconciliationIntended"
    && plans.length === 1
    && plans[0]?.event._tag === "TaskAttemptPlanned"
    && samePlannedTaskAttempt(intents[0].event.operation.plannedAttempt, subject.plannedAttempt)
    && intents[0].event.operation.predecessorOperationIds.includes(plans[0].event.operation.operationId)
    && intents[0].position < ready[0].position
    && sameEncoded(ready[0].event.proof, subject.worktreeProof)
}

type DispositionOperation = typeof WorkflowOperation.cases.RecordImplementationDisposition.Type

/** Proves one terminal execution outcome came from the exact retained planned attempt and session binding. */
export const executionOutcomeCausalChainMatches = (
  records: ReadonlyArray<JournalRecord>,
  outcome: TaskExecutionOutcome,
  plannedAttempt: PlannedTaskAttempt
): boolean => {
  const outcomes = records.filter(({ event }) =>
    event._tag === "TaskExecutionOutcomeObserved"
    && sameEncoded(event.outcome.outcome, outcome)
  )
  const intents = records.filter(({ event }) =>
    event._tag === "TaskExecutionIntentRecorded"
    && event.operation.request.operationId === outcome.operationId
    && samePlannedTaskAttempt(event.operation.request.plannedAttempt, plannedAttempt)
    && event.operation.request.session._tag === "EstablishedSession"
    && event.operation.request.session.sessionId === outcome.sessionId
  )
  return outcomes.length === 1
    && intents.length === 1
    && outcomes[0] !== undefined
    && intents[0] !== undefined
    && intents[0].position < outcomes[0].position
}

/** Requires the terminal operation's sole direct predecessor to contain its exact embedded evidence. */
export const convergenceDispositionPredecessorMatches = (
  records: ReadonlyArray<JournalRecord>,
  operation: DispositionOperation
): boolean => {
  const request = operation.request
  if (request._tag !== "AuthorizedImplementationConvergenceDisposition") return true
  if (operation.predecessorOperationIds.length !== 1) return false
  const predecessorOperationId = operation.predecessorOperationIds[0]
  const disposition = request.disposition
  switch (disposition._tag) {
    case "Accepted":
    case "ImplementationNonConvergent":
      return predecessorOperationId === disposition.review.manifest.operationId
        && records.some(({ event }) =>
          event._tag === "ImplementationReviewCompleted"
          && event.review.manifest.operationId === predecessorOperationId
          && sameEncoded(event.review, disposition.review)
        )
    case "ReviewTechnicalRetryExhausted":
      return predecessorOperationId === disposition.request.operationId
        && records.some(({ event }) =>
          event._tag === "ImplementationReviewIntended"
          && event.operation.request.operationId === predecessorOperationId
          && sameEncoded(event.operation.request, disposition.request)
        )
    case "HandbackTechnicalRetryExhausted":
      return predecessorOperationId === disposition.request.operationId
        && records.some(({ event }) =>
          event._tag === "ReviewFindingsHandbackIntended"
          && event.operation.request.operationId === predecessorOperationId
          && sameEncoded(event.operation.request, disposition.request)
        )
    case "ResourceEmergency":
    case "ImplementationExecutionFailed":
    case "ImplementationExecutionInterrupted":
      return predecessorOperationId === disposition.outcome.operationId
        && executionOutcomeCausalChainMatches(records, disposition.outcome, disposition.subject.plannedAttempt)
  }
}

const sameReference = (
  left: SealedImplementationReview["manifestReference"],
  right: SealedImplementationReview["manifestReference"]
): boolean => left.digest === right.digest && left.byteLength === right.byteLength

/** Validates the causal facts required before one exact review request may cross its boundary. */
export const implementationReviewRequestCausalChainMatches = (
  records: ReadonlyArray<JournalRecord>,
  request: AuthorizedImplementationReviewRequest
): boolean => {
  const evidence = records.find(({ event }) =>
    event._tag === "ImplementationEvidenceSealed"
    && event.operationId === request.evidenceSealingOperationId
    && sameEncoded(event.sealed, request.implementationEvidence)
  )
  const execution = records.find(({ event }) =>
    event._tag === "TaskExecutionOutcomeObserved"
    && event.outcome.outcome._tag === "Succeeded"
    && event.outcome.outcome.operationId === request.implementerInvocationId
    && event.outcome.outcome.sessionId === request.implementerSessionId
  )
  const executionIntent = records.find(({ event }) =>
    event._tag === "TaskExecutionIntentRecorded"
    && event.operation.request.operationId === request.implementerInvocationId
    && samePlannedTaskAttempt(event.operation.request.plannedAttempt, request.plannedAttempt)
  )
  const evidenceIntent = records.find(({ event }) =>
    event._tag === "ImplementationEvidenceSealingIntended"
    && event.operation.operationId === request.evidenceSealingOperationId
    && event.operation.execution._tag === "SuccessfulExecution"
    && execution?.event._tag === "TaskExecutionOutcomeObserved"
    && sameEncoded(event.operation.execution.outcome, execution.event.outcome.outcome)
    && samePlannedTaskAttempt(event.operation.plannedAttempt, request.plannedAttempt)
  )
  const reviewIntent = records.find(({ event }) =>
    event._tag === "ImplementationReviewIntended"
    && event.operation.request._tag === "AuthorizedImplementationReview"
    && sameEncoded(event.operation.request, request)
  )
  if (
    evidence === undefined
    || execution?.event._tag !== "TaskExecutionOutcomeObserved"
    || executionIntent?.event._tag !== "TaskExecutionIntentRecorded"
    || evidenceIntent === undefined
    || reviewIntent === undefined
    || executionIntent.position >= execution.position
    || execution.position >= evidenceIntent.position
    || evidenceIntent.position >= evidence.position
    || evidence.position >= reviewIntent.position
  ) return false
  const session = executionIntent.event.operation.request.session
  const sessionOperation = records.find(({ event }) =>
    event._tag === "TaskWorkSessionEstablished"
    && event.outcome.sessionId === request.implementerSessionId
    && records.some(({ event: candidate }) =>
      candidate._tag === "TaskWorkSessionEstablishmentIntentRecorded"
      && candidate.operation.request.operationId === event.outcome.operationId
      && samePlannedTaskAttempt(candidate.operation.request.plannedAttempt, request.plannedAttempt)
    )
  )?.event
  if (
    session._tag !== "EstablishedSession"
    || session.sessionId !== request.implementerSessionId
    || sessionOperation?._tag !== "TaskWorkSessionEstablished"
    || records.some(({ event }) =>
      (event._tag === "ImplementationReviewCompleted"
        && event.review.manifest.operationId !== request.operationId
        && event.review.manifest.reviewerSessionId === request.reviewerSessionId)
      || (event._tag === "ImplementationReviewIntended"
        && event.operation.request._tag === "AuthorizedImplementationReview"
        && event.operation.request.operationId !== request.operationId
        && event.operation.request.reviewerSessionId === request.reviewerSessionId)
    )
  ) return false
  if (Number(request.round) === 1) {
    return request.findingHistory.length === 0
      && sameReference(request.predecessorEvidenceReference, request.implementationEvidence.manifestReference)
  }
  const previous = records.find(({ event }) =>
    event._tag === "ImplementationReviewCompleted"
    && sameReference(event.review.manifestReference, request.predecessorEvidenceReference)
  )
  if (previous?.event._tag !== "ImplementationReviewCompleted") return false
  const priorReview = previous.event.review
  if (
    priorReview.manifest.disposition._tag !== "Findings"
    || !samePlannedTaskAttempt(priorReview.manifest.plannedAttempt, request.plannedAttempt)
    || Number(priorReview.manifest.round) + 1 !== Number(request.round)
    || Number(priorReview.manifest.roundLimit) !== Number(request.roundLimit)
    || !sameEncoded(priorReview.manifest.findingHistory, request.findingHistory)
  ) return false
  const handback = records.find(({ event }) =>
    event._tag === "ReviewFindingsHandbackIntended"
    && event.operation.request.reviewOperationId === priorReview.manifest.operationId
    && sameEncoded(event.operation.request.review, priorReview)
    && event.operation.request.implementerInvocationId === priorReview.manifest.implementerInvocationId
    && event.operation.request.implementerSessionId === request.implementerSessionId
    && samePlannedTaskAttempt(event.operation.request.plannedAttempt, request.plannedAttempt)
  )
  if (handback?.event._tag !== "ReviewFindingsHandbackIntended") return false
  const handbackRequest = handback.event.operation.request
  const acknowledgement = records.find(({ event }) =>
    event._tag === "ReviewFindingsHandbackCompleted"
    && event.acknowledgement.operationId === handbackRequest.operationId
    && sameReference(event.acknowledgement.reviewEvidenceReference, priorReview.manifestReference)
  )
  return acknowledgement !== undefined
    && previous.position < handback.position
    && handback.position < acknowledgement.position
    && acknowledgement.position < executionIntent.position
    && executionIntent.event.operation.predecessorOperationIds.includes(handbackRequest.operationId)
    && executionIntent.event.operation.predecessorOperationIds.includes(sessionOperation.outcome.operationId)
}

/** Validates an exact findings-handback request against its completed review and full review chain. */
export const reviewFindingsHandbackCausalChainMatches = (
  records: ReadonlyArray<JournalRecord>,
  request: ReviewFindingsHandbackRequest
): boolean => {
  const review = records.find(({ event }) =>
    event._tag === "ImplementationReviewCompleted"
    && sameEncoded(event.review, request.review)
  )
  const intent = records.find(({ event }) =>
    event._tag === "ReviewFindingsHandbackIntended"
    && sameEncoded(event.operation.request, request)
  )
  return request.review.manifest.disposition._tag === "Findings"
    && request.reviewOperationId === request.review.manifest.operationId
    && request.implementerInvocationId === request.review.manifest.implementerInvocationId
    && request.implementerSessionId === request.review.manifest.implementerSessionId
    && samePlannedTaskAttempt(request.plannedAttempt, request.review.manifest.plannedAttempt)
    && review !== undefined
    && intent !== undefined
    && review.position < intent.position
    && implementationReviewCausalChainMatches(records, request.review)
}

/** Validates the complete causal path that admits a semantic review round. */
export const implementationReviewCausalChainMatches = (
  records: ReadonlyArray<JournalRecord>,
  review: SealedImplementationReview
): boolean => {
  const completed = records.filter(({ event }) =>
    event._tag === "ImplementationReviewCompleted"
    && event.review.manifest.operationId === review.manifest.operationId
    && sameEncoded(event.review, review)
  )
  const intended = records.filter(({ event }) =>
    event._tag === "ImplementationReviewIntended"
    && event.operation.request._tag === "AuthorizedImplementationReview"
    && event.operation.request.operationId === review.manifest.operationId
  )
  if (
    completed.length !== 1
    || intended.length !== 1
    || completed[0] === undefined
    || intended[0]?.event._tag !== "ImplementationReviewIntended"
    || intended[0].event.operation.request._tag !== "AuthorizedImplementationReview"
    || intended[0].position >= completed[0].position
  ) return false
  const request = intended[0].event.operation.request
  if (!implementationReviewRequestCausalChainMatches(records, request)) return false
  if (
    !sameEncoded(
      {
        findingHistory: review.manifest.findingHistory,
        implementationEvidenceReference: review.manifest.implementationEvidenceReference,
        implementerInvocationId: review.manifest.implementerInvocationId,
        implementerSessionId: review.manifest.implementerSessionId,
        operationId: review.manifest.operationId,
        plannedAttempt: review.manifest.plannedAttempt,
        predecessorEvidenceReference: review.manifest.predecessorEvidenceReference,
        reviewerSessionId: review.manifest.reviewerSessionId,
        round: review.manifest.round,
        roundLimit: review.manifest.roundLimit
      },
      {
        findingHistory: extendReviewFindingHistory(request.findingHistory, review.manifest.disposition),
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
  ) return false
  return true
}

/** Resolves the exact claim that causally admitted one planned attempt. */
export const claimForPlannedAttempt = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt
): ActiveTaskClaim | undefined => {
  const plan = records.find(({ event }) =>
    event._tag === "TaskAttemptPlanned"
    && samePlannedTaskAttempt(event.operation.plannedAttempt, plannedAttempt)
  )?.event
  if (plan?._tag !== "TaskAttemptPlanned") return undefined
  const admission = records.find(({ event }) =>
    event._tag === "TrackerGraphObservationIntentRecorded"
    && plan.operation.predecessorOperationIds.includes(event.operation.operationId)
  )?.event
  if (admission?._tag !== "TrackerGraphObservationIntentRecorded") return undefined
  const claims = records.flatMap(({ event }) =>
    event._tag === "TaskClaimAcquired"
      && admission.operation.predecessorOperationIds.includes(event.claim.operationId)
      && event.claim.taskId === plannedAttempt.taskId
      ? [event.claim]
      : []
  )
  return claims.length === 1 ? claims[0] : undefined
}

type TechnicalExhaustionDisposition = Extract<ImplementationConvergenceDisposition, {
  readonly _tag: "HandbackTechnicalRetryExhausted" | "ReviewTechnicalRetryExhausted"
}>

/** Reconstructs the exact durable retry identity retained by a technical-exhaustion disposition. */
export const technicalRetryScopeForConvergenceExhaustion = (
  disposition: TechnicalExhaustionDisposition
): typeof TechnicalRetryScope.Type =>
  disposition._tag === "ReviewTechnicalRetryExhausted"
    ? TechnicalRetryScope.cases.ImplementationReviewInvocation.make({
      operationId: disposition.request.operationId,
      reviewerSessionId: disposition.request.reviewerSessionId,
      semanticRound: disposition.request.round
    })
    : TechnicalRetryScope.cases.ReviewFindingsHandbackInvocation.make({
      operationId: disposition.request.operationId,
      reviewOperationId: disposition.request.reviewOperationId,
      semanticRound: disposition.request.review.manifest.round
    })

/** A successful exact invocation outcome contradicts a later exhaustion disposition for that invocation. */
export const successfulConvergenceInvocationOutcomeExists = (
  records: ReadonlyArray<JournalRecord>,
  disposition: TechnicalExhaustionDisposition
): boolean => {
  const scope = technicalRetryScopeForConvergenceExhaustion(disposition)
  return records.some(({ event }) =>
    disposition._tag === "ReviewTechnicalRetryExhausted"
      ? event._tag === "ImplementationReviewCompleted"
        && event.review.manifest.operationId === scope.operationId
      : event._tag === "ReviewFindingsHandbackCompleted"
        && event.acknowledgement.operationId === scope.operationId
  )
}
