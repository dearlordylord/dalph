import type { Effect } from "effect"
import { Context } from "effect"
import { type TaskId } from "./domain.js"

interface TaskExecutionService {
  readonly execute: (taskId: TaskId) => Effect.Effect<void>
}

export class TaskExecution extends Context.Service<TaskExecution, TaskExecutionService>()(
  "@dalph/TaskExecution"
) {}
