import { Effect, Schema } from "effect"
import { OperationId, type RunId } from "./domain.js"
import {
  claimForPlannedAttempt,
  convergenceDispositionPredecessorMatches,
  convergenceSubjectWorktreeMatches,
  executionOutcomeCausalChainMatches,
  implementationReviewCausalChainMatches,
  implementationReviewRequestCausalChainMatches,
  reviewFindingsHandbackCausalChainMatches,
  sameEncoded,
  successfulConvergenceInvocationOutcomeExists,
  technicalRetryScopeForConvergenceExhaustion
} from "./implementation-convergence-history.js"
import { ImplementationConvergenceDispositionRecordedEvent } from "./implementation-convergence-journal.js"
import {
  AuthoritativeImplementationConvergenceDisposition,
  type ImplementationConvergenceDisposition,
  ImplementationConvergenceSimulated,
  type ImplementationConvergenceSubject
} from "./implementation-convergence.js"
import type { SealedImplementationReview } from "./implementation-review.js"
import { workflowJournalEventVersion } from "./journal-event-version.js"
import { implementationDispositionRecordKey, type JournalRecord, type JournalStoreService } from "./journal-store.js"
import { samePlannedTaskAttempt } from "./task-attempt-plan-recording.js"
import { analyzeTechnicalRetryFacts } from "./technical-retry.js"
import { isExactTaskClaim } from "./tracker-mutation.js"
import type { WorkflowOperation } from "./workflow-operation.js"

type DispositionOperation = typeof WorkflowOperation.cases.RecordImplementationDisposition.Type

/** Durable workflow history cannot authorize the proposed implementation disposition. */
export class ImplementationConvergenceHistoryContradiction
  extends Schema.TaggedErrorClass<ImplementationConvergenceHistoryContradiction>()(
    "ImplementationConvergenceHistoryContradiction",
    {
      operationId: OperationId,
      reason: Schema.Literals([
        "AttemptMismatch",
        "ClaimMismatch",
        "DispositionAlreadyRecorded",
        "EvidenceMismatch",
        "IntentMismatch",
        "MissingAttempt",
        "MissingClaim",
        "MissingExecution",
        "MissingReview",
        "MissingSession",
        "MissingWorktree",
        "PredecessorMismatch",
        "RetryNotExhausted",
        "RunMismatch",
        "SessionMismatch"
      ])
    }
  )
{}

const fail = (
  operationId: DispositionOperation["request"]["operationId"],
  reason: ConstructorParameters<typeof ImplementationConvergenceHistoryContradiction>[0]["reason"]
) => new ImplementationConvergenceHistoryContradiction({ operationId, reason })

const dispositionSubject = (disposition: ImplementationConvergenceDisposition): ImplementationConvergenceSubject =>
  disposition.subject

const requireReview = (
  records: ReadonlyArray<JournalRecord>,
  review: SealedImplementationReview
): boolean =>
  records.some(({ event }) => event._tag === "ImplementationReviewCompleted" && sameEncoded(event.review, review))
  && implementationReviewCausalChainMatches(records, review)

const requirePriorEvidence = (
  records: ReadonlyArray<JournalRecord>,
  disposition: Extract<ImplementationConvergenceDisposition, {
    readonly _tag: "ImplementationExecutionFailed" | "ImplementationExecutionInterrupted" | "ResourceEmergency"
  }>,
  executionIndex: number
): boolean => {
  const latestApplicableReview = records.slice(0, executionIndex).findLast(({ event }) =>
    event._tag === "ImplementationReviewCompleted"
    && samePlannedTaskAttempt(event.review.manifest.plannedAttempt, disposition.subject.plannedAttempt)
  )?.event
  return latestApplicableReview?._tag === "ImplementationReviewCompleted"
    ? disposition.priorEvidence._tag === "PriorReviewEvidence"
      && sameEncoded(disposition.priorEvidence.review, latestApplicableReview.review)
    : disposition.priorEvidence._tag === "NoPriorReviewEvidence"
}

const exactInvocationIntentExists = (
  records: ReadonlyArray<JournalRecord>,
  disposition: Extract<ImplementationConvergenceDisposition, {
    readonly _tag: "HandbackTechnicalRetryExhausted" | "ReviewTechnicalRetryExhausted"
  }>
): boolean =>
  records.some(({ event }) =>
    disposition._tag === "ReviewTechnicalRetryExhausted"
      ? event._tag === "ImplementationReviewIntended"
        && sameEncoded(event.operation.request, disposition.request)
      : event._tag === "ReviewFindingsHandbackIntended"
        && sameEncoded(event.operation.request, disposition.request)
  )

const retryFactsFor = (records: ReadonlyArray<JournalRecord>, operationId: OperationId) =>
  records.flatMap(({ event }) =>
    (event._tag === "TechnicalRetryPolicyCaptured"
        || event._tag === "TechnicalRetryScheduled"
        || event._tag === "TechnicalRetryDeferralSuperseded")
      && event.scope.operationId === operationId
      ? [event]
      : []
  )

const isRetryExhausted = (
  records: ReadonlyArray<JournalRecord>,
  disposition: Extract<ImplementationConvergenceDisposition, {
    readonly _tag: "HandbackTechnicalRetryExhausted" | "ReviewTechnicalRetryExhausted"
  }>
): boolean => {
  const scope = technicalRetryScopeForConvergenceExhaustion(disposition)
  const successfulOutcomeExists = successfulConvergenceInvocationOutcomeExists(records, disposition)
  if (successfulOutcomeExists) return false
  const analysis = analyzeTechnicalRetryFacts(retryFactsFor(records, scope.operationId), scope)
  return analysis.issues.length === 0
    && analysis.policy !== undefined
    && analysis.progress.pendingDeferral === undefined
    && Number(analysis.progress.activeRetryOrdinal) === Number(analysis.policy.limit)
}

const validateDispositionEvidence = (
  records: ReadonlyArray<JournalRecord>,
  operationId: DispositionOperation["request"]["operationId"],
  disposition: ImplementationConvergenceDisposition
): Effect.Effect<void, ImplementationConvergenceHistoryContradiction> => {
  switch (disposition._tag) {
    case "Accepted":
    case "ImplementationNonConvergent":
      return requireReview(records, disposition.review)
        ? Effect.void
        : Effect.fail(fail(operationId, "MissingReview"))
    case "ReviewTechnicalRetryExhausted": {
      if (!exactInvocationIntentExists(records, disposition)) {
        return Effect.fail(fail(operationId, "IntentMismatch"))
      }
      const evidenceExists = records.some(({ event }) =>
        event._tag === "ImplementationEvidenceSealed"
        && sameEncoded(event.sealed, disposition.request.implementationEvidence)
      )
      if (!evidenceExists) return Effect.fail(fail(operationId, "EvidenceMismatch"))
      if (!implementationReviewRequestCausalChainMatches(records, disposition.request)) {
        return Effect.fail(fail(operationId, "EvidenceMismatch"))
      }
      return isRetryExhausted(records, disposition)
        ? Effect.void
        : Effect.fail(fail(operationId, "RetryNotExhausted"))
    }
    case "HandbackTechnicalRetryExhausted":
      if (!exactInvocationIntentExists(records, disposition)) {
        return Effect.fail(fail(operationId, "IntentMismatch"))
      }
      if (!requireReview(records, disposition.request.review)) {
        return Effect.fail(fail(operationId, "MissingReview"))
      }
      if (!reviewFindingsHandbackCausalChainMatches(records, disposition.request)) {
        return Effect.fail(fail(operationId, "EvidenceMismatch"))
      }
      return isRetryExhausted(records, disposition)
        ? Effect.void
        : Effect.fail(fail(operationId, "RetryNotExhausted"))
    case "ResourceEmergency":
    case "ImplementationExecutionFailed":
    case "ImplementationExecutionInterrupted": {
      const executionIndex = records.findIndex(({ event }) =>
        event._tag === "TaskExecutionOutcomeObserved"
        && sameEncoded(event.outcome.outcome, disposition.outcome)
      )
      if (
        executionIndex < 0
        || !executionOutcomeCausalChainMatches(records, disposition.outcome, disposition.subject.plannedAttempt)
      ) return Effect.fail(fail(operationId, "MissingExecution"))
      return requirePriorEvidence(records, disposition, executionIndex)
        ? Effect.void
        : Effect.fail(fail(operationId, "MissingReview"))
    }
  }
}

/** Records one exact terminal implementation disposition after validating all retained lineage. */
export const makeJournaledImplementationDisposition = (
  runId: RunId,
  journal: JournalStoreService
) =>
  Effect.fn("WorkflowInterpreter.Journaled.recordImplementationDisposition")(function*(
    operation: DispositionOperation
  ) {
    const request = operation.request
    if (request._tag === "SimulatedImplementationConvergenceDisposition") {
      return ImplementationConvergenceSimulated.make({
        operationId: request.operationId,
        plannedAttempt: request.plannedAttempt,
        roundLimit: request.roundLimit
      })
    }
    const disposition = request.disposition
    const subject = dispositionSubject(disposition)
    if (subject.plannedAttempt.runId !== runId) return yield* fail(request.operationId, "RunMismatch")
    const records = yield* journal.read(runId)
    const planExists = records.some(({ event }) =>
      event._tag === "TaskAttemptPlanned"
      && samePlannedTaskAttempt(event.operation.plannedAttempt, subject.plannedAttempt)
    )
    if (!planExists) return yield* fail(request.operationId, "MissingAttempt")
    const claim = claimForPlannedAttempt(records, subject.plannedAttempt)
    if (claim === undefined) return yield* fail(request.operationId, "MissingClaim")
    if (!isExactTaskClaim(claim, subject.claim)) return yield* fail(request.operationId, "ClaimMismatch")
    if (!convergenceSubjectWorktreeMatches(records, subject)) {
      return yield* fail(request.operationId, "MissingWorktree")
    }
    const session = records.find(({ event }) =>
      event._tag === "TaskWorkSessionEstablished"
      && event.outcome.operationId === subject.sessionEstablishmentOperationId
      && event.outcome.sessionId === subject.sessionId
    )?.event
    if (session?._tag !== "TaskWorkSessionEstablished") return yield* fail(request.operationId, "MissingSession")
    const sessionIntent = records.find(({ event }) =>
      event._tag === "TaskWorkSessionEstablishmentIntentRecorded"
      && event.operation.request.operationId === session.outcome.operationId
    )?.event
    if (
      sessionIntent?._tag !== "TaskWorkSessionEstablishmentIntentRecorded"
      || !samePlannedTaskAttempt(sessionIntent.operation.request.plannedAttempt, subject.plannedAttempt)
    ) return yield* fail(request.operationId, "SessionMismatch")
    yield* validateDispositionEvidence(records, request.operationId, disposition)
    if (!convergenceDispositionPredecessorMatches(records, operation)) {
      return yield* fail(request.operationId, "PredecessorMismatch")
    }
    const key = implementationDispositionRecordKey(subject.plannedAttempt.attemptId)
    const existing = records.find((record) => record.key === key)
    const event = ImplementationConvergenceDispositionRecordedEvent.make({
      operation,
      version: workflowJournalEventVersion
    })
    if (existing !== undefined && !sameEncoded(existing.event, event)) {
      return yield* fail(request.operationId, "DispositionAlreadyRecorded")
    }
    yield* journal.append(runId, key, event)
    return AuthoritativeImplementationConvergenceDisposition.make({
      disposition,
      operationId: request.operationId
    })
  })
