import { RunId, TaskId } from "@dalph/contracts"
import { Schema } from "effect"
import { type TaskDagSnapshot } from "../../../authorities/task-tracker/graph.js"
import { ControlDirection } from "./events.js"

/** A complete current tracker read proved that an Operator's exact task subject is no longer in this Run. */
export class TaskControlSubjectOutsideRun extends Schema.TaggedErrorClass<TaskControlSubjectOutsideRun>()(
  "TaskControlSubjectOutsideRun",
  { direction: ControlDirection, reason: Schema.Literal("OutsideCurrentTargetClosure"), runId: RunId, taskId: TaskId }
) {}

/** Only a complete normalized target-closure observation may prove task membership or absence. */
export const taskControlSubjectIsCurrent = (graph: TaskDagSnapshot, taskId: TaskId): boolean =>
  graph.taskIds().includes(taskId)
