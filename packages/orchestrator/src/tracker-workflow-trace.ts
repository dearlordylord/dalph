import { Schema } from "effect"
import { ActiveTaskClaim } from "./tracker-mutation.js"
import { WorkflowOperation } from "./workflow-operation.js"
import { WorkflowOutcome } from "./workflow-outcome.js"

/** Records selection of one immutable workflow operation. */
export const OperationSelected = Schema.TaggedStruct("OperationSelected", {
  operation: WorkflowOperation
})

export const TrackerGraphOutcomeObserved = Schema.TaggedStruct(
  "TrackerGraphOutcomeObserved",
  {
    operation: WorkflowOperation.cases.ReadTrackerGraph,
    outcome: WorkflowOutcome.cases.TrackerGraphObserved
  }
)

/** Records immutable claim intent before any task-tracker state-changing request. */
export const TaskClaimAcquisitionIntended = Schema.TaggedStruct(
  "TaskClaimAcquisitionIntended",
  { operation: WorkflowOperation.cases.AcquireTaskClaim }
)

/** Records the exact claim only after a fresh tracker claim observation. */
export const TaskClaimAcquiredTrace = Schema.TaggedStruct("TaskClaimAcquired", {
  claim: ActiveTaskClaim,
  operation: WorkflowOperation.cases.AcquireTaskClaim
})

/** A post-claim tracker read proved the task remains open and in target closure. */
export const TrackerExecutionAdmitted = Schema.TaggedStruct(
  "TrackerExecutionAdmitted",
  {
    claimOperation: WorkflowOperation.cases.AcquireTaskClaim,
    observationOperation: WorkflowOperation.cases.ReadTrackerGraph
  }
)
