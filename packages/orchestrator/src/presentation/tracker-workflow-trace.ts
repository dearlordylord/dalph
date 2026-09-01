import { Schema } from "effect"
import { TaskId } from "@dalph/contracts"
import { CompleteTaskTrackerFactsObserved } from "../workflow/task-tracker-facts/observation.js"
import { ActiveTaskClaim } from "../authorities/task-tracker/claim-mutation.js"
import { OperationId } from "../workflow/identity.js"
import { WorkflowOperation } from "../workflow/registry/operation.js"

/** Records selection of one immutable workflow operation. */
export const OperationSelected = Schema.TaggedStruct("OperationSelected", { operation: WorkflowOperation })

/** Records the exact recovered task-claim transition immediately before its protocol enters the tracker. */
export const TaskClaimCheckSelected = Schema.TaggedStruct("TaskClaimCheckSelected", {
  operationId: OperationId,
  taskId: TaskId
})

/** Exposes the same normalized complete graph facts used by the journal. */
export const TaskTrackerFactsObservedTrace = Schema.TaggedStruct("TaskTrackerFactsObserved", {
  operation: WorkflowOperation.cases.ReadTrackerGraph,
  observation: CompleteTaskTrackerFactsObserved
})

/** Records immutable claim intent before any task-tracker state-changing request. */
export const TaskClaimAcquisitionIntended = Schema.TaggedStruct("TaskClaimAcquisitionIntended", {
  operation: WorkflowOperation.cases.AcquireTaskClaim
})

/** Records the exact claim only after a fresh tracker claim observation. */
export const TaskClaimAcquiredTrace = Schema.TaggedStruct("TaskClaimAcquired", {
  claim: ActiveTaskClaim,
  operation: WorkflowOperation.cases.AcquireTaskClaim
})

/** A post-claim tracker read proved the task remains open and in target closure. */
export const TrackerExecutionAdmitted = Schema.TaggedStruct("TrackerExecutionAdmitted", {
  claimOperation: WorkflowOperation.cases.AcquireTaskClaim,
  observationOperation: WorkflowOperation.cases.ReadTrackerGraph
})
