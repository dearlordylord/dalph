import { Config, Context, Crypto, Effect, Layer, type PlatformError } from "effect"
import type { OperationId, TaskId } from "./domain.js"
import { ClaimOwner, ClaimToken } from "./domain.js"
import { TaskClaimAcquisition } from "./tracker-mutation.js"

interface TaskClaimAcquisitionPlannerService {
  readonly plan: (
    operationId: OperationId,
    taskId: TaskId
  ) => Effect.Effect<TaskClaimAcquisition, PlatformError.PlatformError>
}

/** Assigns configured ownership and a fresh exact token before claim intent. */
export class TaskClaimAcquisitionPlanner extends Context.Service<
  TaskClaimAcquisitionPlanner,
  TaskClaimAcquisitionPlannerService
>()("@dalph/TaskClaimAcquisitionPlanner") {}

export const taskClaimAcquisitionPlannerConfigLayer = Layer.effect(
  TaskClaimAcquisitionPlanner,
  Effect.gen(function*() {
    const crypto = yield* Crypto.Crypto
    const owner = yield* Config.schema(ClaimOwner, "DALPH_CLAIM_OWNER")
    const plan = Effect.fn("TaskClaimAcquisitionPlanner.Fresh.plan")(
      function*(operationId: OperationId, taskId: TaskId) {
        return TaskClaimAcquisition.make({
          operationId,
          owner,
          taskId,
          token: ClaimToken.make(yield* crypto.randomUUIDv7)
        })
      }
    )
    return TaskClaimAcquisitionPlanner.of({ plan })
  })
)

export const deterministicTaskClaimAcquisitionPlannerLayer = (
  options: {
    readonly owner: ClaimOwner
    readonly tokenPrefix: string
  }
) =>
  Layer.succeed(
    TaskClaimAcquisitionPlanner,
    TaskClaimAcquisitionPlanner.of({
      plan: Effect.fn("TaskClaimAcquisitionPlanner.Deterministic.plan")(
        function*(operationId, taskId) {
          return TaskClaimAcquisition.make({
            operationId,
            owner: options.owner,
            taskId,
            token: ClaimToken.make(
              `${options.tokenPrefix}:${taskId}:${operationId}`
            )
          })
        }
      )
    })
  )
