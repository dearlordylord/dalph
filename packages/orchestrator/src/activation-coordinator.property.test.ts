import { Effect } from "effect"
import fc from "fast-check"
import { expect, it } from "vitest"
import { AttemptId, RunId, TaskId, TaskRevision, TaskWorkCapacity } from "./domain.js"
import { RunnableFrontierTransition } from "./runnable-frontier.js"
import { makeSelectedTransitionIdentity } from "./selected-transition.js"
import { makeTaskAdmissionController } from "./task-admission-controller.js"

const taskArbitrary = fc.integer({ min: 0, max: 3 })
const attemptArbitrary = fc.integer({ min: 0, max: 7 })

const transitionFor = (task: number, attempt: number) =>
  RunnableFrontierTransition.CommitFreshTaskClaimIntent({
    taskId: TaskId.make(`generated-task-${task}`),
    taskRevision: TaskRevision.make(`generated-revision-${attempt}`)
  })

it("generated selection and cancellation commands stay within configured capacity", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: 1, max: 4 }),
      fc.array(fc.record({ cancel: fc.boolean(), attempt: attemptArbitrary, task: taskArbitrary }), { maxLength: 40 }),
      async (capacityValue, commands) => {
        const runId = RunId.make("generated-run")
        await Effect.runPromise(
          Effect.gen(function* () {
            const controller = yield* makeTaskAdmissionController({ capacity: TaskWorkCapacity.make(capacityValue) })
            for (const command of commands) {
              const transition = transitionFor(command.task, command.attempt)
              if (command.cancel) {
                yield* controller
                  .cancelReservedPosition(makeSelectedTransitionIdentity(runId, transition))
                  .pipe(Effect.catch(() => Effect.void))
              } else {
                yield* controller.admit({ explanations: [], transitions: [transition] }, runId)
              }
              expect((yield* controller.snapshot()).reservedTaskIds.length).toBeLessThanOrEqual(capacityValue)
            }
          })
        )
      }
    ),
    { numRuns: 100 }
  )
})

it("a delayed planned-attempt release changes only its exact pair", async () => {
  await fc.assert(
    fc.asyncProperty(
      attemptArbitrary,
      attemptArbitrary.filter((later) => later !== 0),
      async (earlier, laterOffset) => {
        const runId = RunId.make("delayed-release-run")
        const laterAttemptId = AttemptId.make(`attempt-${earlier + laterOffset + 1}`)
        await Effect.runPromise(
          Effect.gen(function* () {
            const controller = yield* makeTaskAdmissionController({
              capacity: TaskWorkCapacity.make(1),
              reconstructedPlannedAttemptPositions: [
                { attemptId: laterAttemptId, runId, taskId: TaskId.make("delayed-release-task") }
              ]
            })
            const delayed = yield* controller
              .releasePlannedAttemptPosition({ attemptId: AttemptId.make(`attempt-${earlier}`), runId })
              .pipe(Effect.flip)
            expect(delayed._tag).toBe("PlannedAttemptPositionReleaseIssue")
            expect((yield* controller.snapshot()).reservedPositions).toEqual([
              {
                correlation: { _tag: "PlannedAttemptReservation", attemptId: laterAttemptId, runId },
                taskId: "delayed-release-task"
              }
            ])
          })
        )
      }
    ),
    { numRuns: 100 }
  )
})
