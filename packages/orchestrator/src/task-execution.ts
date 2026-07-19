import { Context, Effect, Layer } from "effect"
import { type TaskId } from "./domain.js"

interface TaskExecutionService {
  readonly execute: (taskId: TaskId) => Effect.Effect<void>
}

export class TaskExecution extends Context.Service<TaskExecution, TaskExecutionService>()(
  "@dalph/TaskExecution"
) {}

export const taskExecutionDryRunLayer = Layer.effect(
  TaskExecution,
  Effect.gen(function*() {
    const execute = Effect.fn("TaskExecution.DryRun.execute")(function*(
      _taskId: TaskId
    ) {
      yield* Effect.void
    })

    return TaskExecution.of({ execute })
  })
)
