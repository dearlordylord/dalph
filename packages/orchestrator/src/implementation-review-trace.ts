import { Schema } from "effect"
import { ImplementationEvidenceSealingSimulated, SealedImplementationEvidence } from "./implementation-evidence.js"
import {
  ImplementationReviewSimulated,
  ReviewFindingsHandbackAcknowledged,
  SealedImplementationReview
} from "./implementation-review.js"
import { WorkflowOperation } from "./workflow-operation.js"

/** Exposes the complete immutable implementation-stage review input. */
export const SealedImplementationEvidenceTrace = Schema.TaggedStruct(
  "ImplementationEvidenceSealed",
  {
    operation: WorkflowOperation.cases.SealImplementationEvidence,
    sealed: SealedImplementationEvidence
  }
)

/** Projects sealing order without claiming that any evidence bytes exist. */
export const ImplementationEvidenceSealingSimulatedTrace = Schema.TaggedStruct(
  "ImplementationEvidenceSealingSimulated",
  {
    operation: WorkflowOperation.cases.SealImplementationEvidence,
    simulation: ImplementationEvidenceSealingSimulated
  }
)

/** Exposes one durable fresh-review disposition and its exact evidence chain. */
export const ImplementationReviewCompletedTrace = Schema.TaggedStruct(
  "ImplementationReviewCompleted",
  {
    operation: WorkflowOperation.cases.ReviewImplementation,
    review: SealedImplementationReview
  }
)

/** Projects the semantic review stage without claiming a reviewer invocation occurred. */
export const ImplementationReviewSimulatedTrace = Schema.TaggedStruct(
  "ImplementationReviewSimulated",
  {
    operation: WorkflowOperation.cases.ReviewImplementation,
    simulation: ImplementationReviewSimulated
  }
)

/** Records exact implementer-session receipt of one findings evidence object. */
export const ReviewFindingsHandedBackTrace = Schema.TaggedStruct(
  "ReviewFindingsHandedBack",
  {
    acknowledgement: ReviewFindingsHandbackAcknowledged,
    operation: WorkflowOperation.cases.HandBackReviewFindings
  }
)
