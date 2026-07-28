import { Effect } from "effect"
import fc from "fast-check"
import { expect, it } from "vitest"
import { ExecutorOuterInvocationId, ProviderObservationId, RunId, TaskId, TaskWorkCapacity } from "./domain.js"
import { makeExecutorOuterInvocation } from "./executor-boundary.js"
import { RunnableFrontierTransition } from "./runnable-frontier.js"
import { makeTaskAdmissionController } from "./task-admission-controller.js"
import { oneTaskWorkCapacityRequirement } from "./task-work-capacity.js"

const taskArbitrary = fc.integer({ min: 0, max: 3 })
const operationArbitrary = fc.integer({ min: 0, max: 7 })
const commandArbitrary = fc.oneof(
  fc.record({
    _tag: fc.constant("Admit" as const),
    operation: operationArbitrary,
    task: taskArbitrary
  }),
  fc.record({
    _tag: fc.constant("ReleaseOperation" as const),
    operation: operationArbitrary
  })
)

it("generated controller commands never create more new positions than configured capacity", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: 1, max: 4 }),
      fc.array(commandArbitrary, { maxLength: 40 }),
      async (capacityValue, commands) => {
        const capacity = TaskWorkCapacity.make(capacityValue)
        await Effect.runPromise(Effect.gen(function*() {
          const controller = yield* makeTaskAdmissionController({
            capacity,
            latestExecutorActiveReports: [],
            unfinishedRecordedExecutorInvocations: []
          })

          for (const [ordinal, command] of commands.entries()) {
            const taskId = TaskId.make(`generated-task-${"task" in command ? command.task : 0}`)
            const invocationId = ExecutorOuterInvocationId.make(
              `generated-operation-${"operation" in command ? command.operation : ordinal}`
            )
            if (command._tag === "Admit") {
              yield* controller.admit({
                explanations: [],
                transitions: [
                  RunnableFrontierTransition.ContinueExecutorInvocation({
                    capacityRequirement: oneTaskWorkCapacityRequirement,
                    invocation: makeExecutorOuterInvocation(
                      invocationId,
                      taskId
                    )
                  })
                ]
              }, RunId.make("generated-run"))
            } else {
              yield* controller.releaseTaskAdmissionPosition(invocationId).pipe(
                Effect.catchTag(
                  "TaskAdmissionPositionReleaseIssue",
                  () => Effect.void
                )
              )
            }

            const snapshot = yield* controller.snapshot()
            expect(snapshot.taskWorkPositions.size).toBeLessThanOrEqual(capacityValue)
          }
        }))
      }
    ),
    { numRuns: 100 }
  )
})

it("a delayed release changes only its exact operation", async () => {
  await fc.assert(
    fc.asyncProperty(
      operationArbitrary,
      operationArbitrary.filter((later) => later !== 0),
      async (earlier, laterOffset) => {
        const taskId = TaskId.make("delayed-release-task")
        const earlierOperation = ExecutorOuterInvocationId.make(`attempt-${earlier}`)
        const laterOperation = ExecutorOuterInvocationId.make(`attempt-${earlier + laterOffset + 1}`)
        await Effect.runPromise(Effect.gen(function*() {
          const controller = yield* makeTaskAdmissionController({
            capacity: TaskWorkCapacity.make(1),
            latestExecutorActiveReports: [{
              observationId: ProviderObservationId.make("later-observation"),
              invocationId: laterOperation,
              taskId
            }],
            unfinishedRecordedExecutorInvocations: [{
              invocationId: laterOperation,
              taskId
            }]
          })

          const delayed = yield* controller.releaseTaskAdmissionPosition(
            earlierOperation
          ).pipe(Effect.flip)
          expect(delayed._tag).toBe("TaskAdmissionPositionReleaseIssue")

          expect((yield* controller.snapshot()).taskWorkPositions).toEqual(
            new Map([[
              taskId,
              {
                _tag: "Working",
                observationId: "later-observation",
                invocationId: laterOperation
              }
            ]])
          )
        }))
      }
    ),
    { numRuns: 100 }
  )
})
