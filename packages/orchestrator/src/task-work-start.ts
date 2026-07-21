import type { Effect } from "effect"
import { Context } from "effect"
import type { CoordinatorOwnershipError } from "./coordinator-lock.js"
import { type TaskId } from "./domain.js"

interface TaskRunnerService {
  readonly requestTaskWorkStart: (taskId: TaskId) => Effect.Effect<void>
}

export class TaskRunner extends Context.Service<TaskRunner, TaskRunnerService>()(
  "@dalph/TaskRunner"
) {}

interface TaskWorkStartService {
  readonly request: (
    taskId: TaskId
  ) => Effect.Effect<void, CoordinatorOwnershipError>
}

export class TaskWorkStart extends Context.Service<TaskWorkStart, TaskWorkStartService>()(
  "@dalph/TaskWorkStart"
) {}
