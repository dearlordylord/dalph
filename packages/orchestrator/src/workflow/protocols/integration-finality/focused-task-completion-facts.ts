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
  unfinishedPrerequisiteTaskIds: Schema.Array(TaskId).check(Schema.isUnique())
}).check(
  Schema.makeFilter((facts) => {
    const claimTaskId =
      facts.currentClaim._tag === "CompletionTaskClaim"
        ? facts.currentClaim.plannedAttempt.taskId
        : facts.currentClaim.taskId
    if (claimTaskId !== facts.taskId) return "focused completion claim must belong to the exact task"
    return facts.unfinishedPrerequisiteTaskIds.includes(facts.taskId)
      ? "focused completion task cannot be its own unfinished prerequisite"
      : undefined
  })
)
export type FocusedTaskCompletionFacts = typeof FocusedTaskCompletionFacts.Type
