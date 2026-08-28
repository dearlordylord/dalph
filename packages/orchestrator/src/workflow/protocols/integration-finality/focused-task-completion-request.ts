import { TaskId } from "@dalph/contracts"
import { Schema } from "effect"
import { TrackerTarget } from "../../../authorities/task-tracker/target.js"
import { OperationId } from "../../identity.js"
import { CompletionTaskClaim } from "./completion-claim.js"

/**
 * One exact task-local read request carrying the claim whose provider
 * fingerprint may be reconstructed as current completion authority.
 */
export const FocusedTaskCompletionReadRequest = Schema.Struct({
  expectedClaim: CompletionTaskClaim,
  operationId: OperationId,
  target: TrackerTarget,
  taskId: TaskId
}).check(
  Schema.makeFilter((request) =>
    request.taskId === request.expectedClaim.plannedAttempt.taskId
      ? undefined
      : "focused completion read must bind the expected claim's exact task"
  )
)
export type FocusedTaskCompletionReadRequest = typeof FocusedTaskCompletionReadRequest.Type
