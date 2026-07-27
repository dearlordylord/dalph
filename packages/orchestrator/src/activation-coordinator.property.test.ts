import { Effect } from "effect"
import fc from "fast-check"
import { expect, it } from "vitest"
import { OperationId, ProviderObservationId, RunId, TaskId, TaskWorkCapacity } from "./domain.js"
import { makeExecutorOuterInvocation, oneTaskWorkCapacityPosition } from "./executor-boundary.js"
import { RunnableFrontierTransition } from "./runnable-frontier.js"
import { makeTaskAdmissionController } from "./task-admission-controller.js"

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
            freshOccupiedInvocations: [],
            reconstructedReservedPositions: []
          })

          for (const [ordinal, command] of commands.entries()) {
            const taskId = TaskId.make(`generated-task-${"task" in command ? command.task : 0}`)
            const operationId = OperationId.make(
              `generated-operation-${"operation" in command ? command.operation : ordinal}`
            )
            if (command._tag === "Admit") {
              yield* controller.admit({
                explanations: [],
                transitions: [
                  RunnableFrontierTransition.ContinueExecutorInvocation({
                    invocation: makeExecutorOuterInvocation(
                      operationId,
                      taskId,
                      oneTaskWorkCapacityPosition
                    )
                  })
                ]
              }, RunId.make("generated-run"))
            } else {
              yield* controller.releaseTaskAdmissionPosition(operationId).pipe(
                Effect.catchTag(
                  "TaskAdmissionPositionReleaseIssue",
                  () => Effect.void
                )
              )
            }

            const snapshot = yield* controller.snapshot()
            expect(
              snapshot.occupied.length + snapshot.reservedTaskIds.length
            ).toBeLessThanOrEqual(capacityValue)
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
        const earlierOperation = OperationId.make(`attempt-${earlier}`)
        const laterOperation = OperationId.make(`attempt-${earlier + laterOffset + 1}`)
        await Effect.runPromise(Effect.gen(function*() {
          const controller = yield* makeTaskAdmissionController({
            capacity: TaskWorkCapacity.make(1),
            freshOccupiedInvocations: [{
              observationId: ProviderObservationId.make("later-observation"),
              operationId: laterOperation,
              taskId
            }],
            reconstructedReservedPositions: []
          })

          const delayed = yield* controller.releaseTaskAdmissionPosition(
            earlierOperation
          ).pipe(Effect.flip)
          expect(delayed._tag).toBe("TaskAdmissionPositionReleaseIssue")

          expect((yield* controller.snapshot()).occupied).toEqual([{
            observationId: "later-observation",
            operationId: laterOperation,
            taskId
          }])
        }))
      }
    ),
    { numRuns: 100 }
  )
})
