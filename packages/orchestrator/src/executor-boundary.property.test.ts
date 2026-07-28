import { Effect, Option } from "effect"
import fc from "fast-check"
import { expect, it } from "vitest"
import { ExecutorOuterInvocationId, ProviderObservationId, RunId, TaskId, TaskWorkCapacity } from "./domain.js"
import { makeExecutorOuterInvocation } from "./executor-boundary.js"
import { RunnableFrontierTransition } from "./runnable-frontier.js"
import { makeTaskAdmissionController } from "./task-admission-controller.js"
import { noTaskWorkCapacityRequirement, oneTaskWorkCapacityRequirement } from "./task-work-capacity.js"

it("generated Dalph transitions use capacity exactly when their requirement says so", async () => {
  await fc.assert(fc.asyncProperty(
    fc.boolean(),
    async (usesTaskWorkCapacity) => {
      const taskId = TaskId.make("generated-executor-boundary-task")
      const transition = RunnableFrontierTransition
        .ContinueExecutorInvocation({
          capacityRequirement: usesTaskWorkCapacity
            ? oneTaskWorkCapacityRequirement
            : noTaskWorkCapacityRequirement,
          invocation: makeExecutorOuterInvocation(
            ExecutorOuterInvocationId.make(
              "generated-executor-boundary-invocation"
            ),
            taskId
          )
        })
      const decision = await Effect.runPromise(Effect.gen(function*() {
        const controller = yield* makeTaskAdmissionController({
          capacity: TaskWorkCapacity.make(1),
          latestExecutorActiveReports: [{
            observationId: ProviderObservationId.make(
              "generated-capacity-observation"
            ),
            invocationId: ExecutorOuterInvocationId.make("generated-capacity-occupant"),
            taskId: TaskId.make("generated-capacity-occupant-task")
          }],
          unfinishedRecordedExecutorInvocations: [{
            invocationId: ExecutorOuterInvocationId.make("generated-capacity-occupant"),
            taskId: TaskId.make("generated-capacity-occupant-task")
          }]
        })
        return yield* controller.admit(
          { explanations: [], transitions: [transition] },
          RunId.make("generated-executor-boundary-run")
        )
      }))

      expect(Option.isSome(decision.transition)).toBe(!usesTaskWorkCapacity)
      expect(
        decision.explanations.some(({ _tag }) => _tag === "CapacityWait")
      ).toBe(usesTaskWorkCapacity)
    }
  ))
})
