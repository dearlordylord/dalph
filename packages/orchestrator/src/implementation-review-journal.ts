import { Schema } from "effect"
import { ReviewFindingsHandbackAcknowledged, SealedImplementationReview } from "./implementation-review.js"
import { workflowJournalEventVersion } from "./journal-event-version.js"
import { TechnicalRetryJournalEvent } from "./technical-retry.js"
import { WorkflowOperation } from "./workflow-operation.js"

/** Records the exact fresh reviewer session before invoking the reviewer. */
export const ImplementationReviewIntendedEvent = Schema.TaggedStruct(
  "ImplementationReviewIntended",
  {
    operation: WorkflowOperation.cases.ReviewImplementation,
    version: Schema.Literal(workflowJournalEventVersion)
  }
)

/** Records the immutable predecessor-linked review disposition. */
export const ImplementationReviewCompletedEvent = Schema.TaggedStruct(
  "ImplementationReviewCompleted",
  {
    review: SealedImplementationReview,
    version: Schema.Literal(workflowJournalEventVersion)
  }
)

/** Records exact-session findings handback intent before the provider request. */
export const ReviewFindingsHandbackIntendedEvent = Schema.TaggedStruct(
  "ReviewFindingsHandbackIntended",
  {
    operation: WorkflowOperation.cases.HandBackReviewFindings,
    version: Schema.Literal(workflowJournalEventVersion)
  }
)

/** Records the implementer provider acknowledgement for exact review evidence. */
export const ReviewFindingsHandbackCompletedEvent = Schema.TaggedStruct(
  "ReviewFindingsHandbackCompleted",
  {
    acknowledgement: ReviewFindingsHandbackAcknowledged,
    version: Schema.Literal(workflowJournalEventVersion)
  }
)

export const ImplementationReviewJournalEvent = Schema.Union([
  ImplementationReviewIntendedEvent,
  ImplementationReviewCompletedEvent,
  ReviewFindingsHandbackIntendedEvent,
  ReviewFindingsHandbackCompletedEvent,
  TechnicalRetryJournalEvent
])
