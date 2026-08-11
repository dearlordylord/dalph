import { Schema } from "effect"
import { TaskId, TaskRevision } from "@dalph/contracts"
import { TrackerRevision } from "../../../authorities/task-tracker/task.js"
import { TrackerTarget } from "../../../authorities/task-tracker/target.js"
import { OperationId } from "../../identity.js"
import { CompletionClaimObservation } from "./completion-claim.js"

/** One focused, all-or-nothing tracker read for the task being completed. */
export const FocusedTaskCompletionFacts = Schema.Struct({
  currentClaim: CompletionClaimObservation,
  lifecycle: Schema.Union([
    Schema.Literal("Open"),
    Schema.Literal("CompletedSuccessfully"),
    Schema.Literal("TerminalWithoutSuccess")
  ]),
  operationId: OperationId,
  targetMembership: Schema.Literals(["Member", "NotMember"]),
  target: TrackerTarget,
  taskId: TaskId,
  taskRevision: TaskRevision,
  trackerRevision: TrackerRevision,
  unfinishedPrerequisiteTaskIds: Schema.Array(TaskId)
})
export type FocusedTaskCompletionFacts = typeof FocusedTaskCompletionFacts.Type
