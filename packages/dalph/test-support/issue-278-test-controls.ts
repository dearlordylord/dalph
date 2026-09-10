import { Effect, Fiber, Queue, Ref, Deferred } from "effect"
import { TaskId } from "@dalph/contracts"
import type { WorkflowJournalEvent as WorkflowEvent } from "@dalph/orchestrator"
import type { makeIssue278NormalTermination } from "./issue-278-normal-termination.js"
export type Issue278Fixture = Effect.Success<ReturnType<typeof makeIssue278NormalTermination>>
type Fixture = Issue278Fixture
export const names = ["B", "C", "D", "E", "F", "G"] as const
export const start = Effect.fn("Issue278Test.start")(function* (fixture: Fixture) {
  const running = yield* fixture.activate.pipe(Effect.forkScoped)
  const take = <A>(queue: Queue.Dequeue<A>) =>
    Queue.take(queue).pipe(
      Effect.raceFirst(Fiber.join(running).pipe(Effect.andThen(Effect.die("runtime exited before checkpoint"))))
    )
  const event = (matches: (event: WorkflowEvent) => boolean) =>
    Effect.gen(function* () {
      for (;;) {
        const next = yield* take(fixture.events)
        if (matches(next)) return next
      }
    })
  return { running, take, event }
})

export const deliver = Effect.fn("Issue278Test.deliver")(function* (
  fixture: Fixture,
  process: Effect.Success<ReturnType<typeof start>>
) {
  for (const name of names) {
    if (!(yield* Ref.get(fixture.commands)).some(({ taskId }) => taskId === name))
      yield* process.event(
        (event) =>
          event._tag === "PlannedAttemptExecutorWorkReported" &&
          event.report._tag === "ExecutorWorkExecuting" &&
          event.report.correlation.attemptId === fixture.facts.taskFacts[name].attemptId
      )
    const release = fixture.releaseIntegration.get(TaskId.make(name))
    if (release === undefined) return yield* Effect.die("missing exact integration release")
    yield* Deferred.succeed(release, undefined)
    yield* fixture.terminal(name)
    yield* process.event(
      (event) => event._tag === "IntegrationFinalitySettled" && event.claim.plannedAttempt.taskId === name
    )
  }
})
