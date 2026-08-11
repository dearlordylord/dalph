import { Schema } from "effect"
import { OperationId } from "../identity.js"
import { TrackerTarget, taskTrackerTargetKey } from "../../authorities/task-tracker/target.js"
import type { WorkflowOperation } from "../registry/operation.js"
import {
  CompletionTaskFocusedReadPurpose,
  CompletionTaskRequest,
  FocusedTaskCompletionFacts
} from "../protocols/integration-finality/events.js"
import { completionTaskFocusedReadOperationIdFor } from "../protocols/integration-finality/completion-task-operation-identity.js"

/** One task-local tracker read returned every current fact required by one exact completion request. */
export const FocusedTaskCompletionFactsObserved = Schema.TaggedStruct("FocusedTaskCompletionFacts", {
  facts: FocusedTaskCompletionFacts,
  operationId: OperationId,
  purpose: CompletionTaskFocusedReadPurpose,
  request: CompletionTaskRequest,
  target: TrackerTarget
}).check(
  Schema.makeFilter((observation) => {
    if (observation.operationId !== completionTaskFocusedReadOperationIdFor(observation.request, observation.purpose)) {
      return "focused completion facts must use the exact deterministic read operation identity"
    }
    return observation.facts.operationId === observation.operationId &&
      observation.facts.taskId === observation.request.taskId &&
      taskTrackerTargetKey(observation.facts.target) === taskTrackerTargetKey(observation.target)
      ? undefined
      : "focused completion facts must bind the exact request task, target, and read operation"
  })
)
export type FocusedTaskCompletionFactsObserved = typeof FocusedTaskCompletionFactsObserved.Type

/** Constructs the canonical focused completion observation after one exact tracker read. */
export const makeFocusedTaskCompletionFactsObserved = (
  operation: typeof WorkflowOperation.cases.ReadCompletionTaskFacts.Type,
  facts: FocusedTaskCompletionFacts
): FocusedTaskCompletionFactsObserved =>
  FocusedTaskCompletionFactsObserved.make({
    facts,
    operationId: operation.operationId,
    purpose: operation.purpose,
    request: operation.request,
    target: operation.target
  })
