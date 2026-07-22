import { expect, it } from "vitest"
import { JournalPosition, JournalRecordKey, OperationId, RunId } from "./domain.js"
import type { JournalRecord, WorkflowJournalEvent } from "./journal-store.js"
import { analyzeTechnicalRetryTemporalFacts } from "./technical-retry-temporal.js"

const runId = RunId.make("retry-temporal-run")
const operationId = OperationId.make("retry-temporal-operation")
const reviewScope = {
  _tag: "ImplementationReviewInvocation",
  operationId,
  reviewerSessionId: "retry-temporal-reviewer",
  semanticRound: 1
}
const handbackScope = {
  _tag: "ReviewFindingsHandbackInvocation",
  operationId,
  reviewOperationId: "retry-temporal-reviewed-operation",
  semanticRound: 1
}
const record = (position: number, input: unknown): JournalRecord => ({
  event: input as WorkflowJournalEvent,
  key: JournalRecordKey.make(`retry-temporal-${position}`),
  position: JournalPosition.make(position),
  runId
})
const reviewIntent = record(1, {
  _tag: "ImplementationReviewIntended",
  operation: {
    request: {
      _tag: "AuthorizedImplementationReview",
      operationId,
      reviewerSessionId: reviewScope.reviewerSessionId,
      round: reviewScope.semanticRound
    }
  }
})
const handbackIntent = record(1, {
  _tag: "ReviewFindingsHandbackIntended",
  operation: {
    request: {
      operationId,
      review: { manifest: { round: handbackScope.semanticRound } },
      reviewOperationId: handbackScope.reviewOperationId
    }
  }
})
const scheduled = record(2, {
  _tag: "TechnicalRetryScheduled",
  scope: reviewScope
})
const superseded = record(3, {
  _tag: "TechnicalRetryDeferralSuperseded",
  scope: reviewScope
})

it("classifies retry facts around review and handback intent-to-outcome intervals", () => {
  const admission = (records: ReadonlyArray<JournalRecord>) =>
    analyzeTechnicalRetryTemporalFacts(records, operationId)
      .find(({ admissionContradiction }) => admissionContradiction !== undefined)
      ?.admissionContradiction
  expect(admission([reviewIntent])).toBeUndefined()
  expect(admission([scheduled])).toBe("RetryFactsWithoutIntent")
  expect(admission([
    record(1, { _tag: "TechnicalRetryScheduled", scope: reviewScope }),
    record(2, { ...reviewIntent.event })
  ])).toBe("RetryFactsBeforeIntent")
  expect(admission([reviewIntent, scheduled])).toBeUndefined()
  expect(admission([
    reviewIntent,
    record(2, { _tag: "ImplementationReviewCompleted", review: { manifest: { operationId } } }),
    superseded
  ])).toBe("RetryFactsAfterOutcome")
  expect(admission([
    handbackIntent,
    record(2, { _tag: "ReviewFindingsHandbackCompleted", acknowledgement: { operationId } }),
    record(3, { _tag: "TechnicalRetryDeferralSuperseded", scope: handbackScope })
  ])).toBe("RetryFactsAfterOutcome")
})
