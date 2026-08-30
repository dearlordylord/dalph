import { it } from "@effect/vitest"
import {
  AttemptId,
  GitCommitSha,
  PlannedAttemptExecutorLifecycleObservation,
  PlannedAttemptExecutorProjection,
  type PlannedAttemptExecutorProjection as PlannedAttemptExecutorProjectionType,
  PlannedAttemptExecutorReport,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator,
  plannedAttemptExecutorCorrelation
} from "@dalph/contracts"
import { Deferred, Effect, Queue, Stream } from "effect"
import { expect, expectTypeOf } from "vitest"
import {
  makePassivePlannedAttemptObserver,
  type PassivePlannedAttemptObserverService
} from "./passive-planned-attempt-observer.js"

const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("passive-observer-attempt"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/passive-observer-attempt"),
  executor: TaskExecutorLocator.make("executor:passive-observer"),
  runId: RunId.make("passive-observer-run"),
  taskId: TaskId.make("passive-observer-task"),
  taskRevision: TaskRevision.make("passive-observer-revision"),
  worktree: WorktreeLocator.make("/worktrees/passive-observer-attempt")
})

const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
const executing = PlannedAttemptExecutorProjection.cases.Exact.make({
  report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
})
const terminal = PlannedAttemptExecutorProjection.cases.Exact.make({
  report: PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({ correlation, result: { _tag: "Completed" } })
})

it.effect("publishes one live terminal candidate without a second command", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const hints = yield* Queue.unbounded<typeof terminal>()
      const terminalPublished = yield* Deferred.make<void>()
      const published: Array<PlannedAttemptExecutorProjectionType> = []
      const observer = yield* makePassivePlannedAttemptObserver().pipe(
        Effect.provideService(PlannedAttemptExecutorLifecycleObservation, {
          attach: () => Effect.succeed({ changes: Stream.fromQueue(hints), close: Effect.void, current: executing })
        })
      )

      yield* observer.attach({
        plannedAttempt,
        publishCurrent: (projection) =>
          Effect.sync(() => published.push(projection)).pipe(
            Effect.as({ acceptedFacts: "UnchangedPassiveObservation" as const, report: executing.report })
          ),
        publishChange: (projection) =>
          Effect.sync(() => published.push(projection)).pipe(
            Effect.tap(() => (projection === terminal ? Deferred.succeed(terminalPublished, undefined) : Effect.void))
          )
      })

      expect(published).toEqual([executing])
      yield* Queue.offer(hints, terminal)
      yield* Deferred.await(terminalPublished)
      expect(published).toEqual([executing, terminal])
    })
  )
)

it.effect("awaits after unchanged executing projection without another read or journal append", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const changes = yield* Queue.unbounded<typeof terminal>()
      let attachments = 0
      let publications = 0
      const observer = yield* makePassivePlannedAttemptObserver().pipe(
        Effect.provideService(PlannedAttemptExecutorLifecycleObservation, {
          attach: () =>
            Effect.sync(() => {
              attachments += 1
              return { changes: Stream.fromQueue(changes), close: Effect.void, current: executing }
            })
        })
      )

      yield* observer.attach({
        plannedAttempt,
        publishCurrent: () =>
          Effect.sync(() => (publications += 1)).pipe(
            Effect.as({ acceptedFacts: "UnchangedPassiveObservation" as const, report: executing.report })
          ),
        publishChange: () => Effect.sync(() => (publications += 1)).pipe(Effect.asVoid)
      })
      yield* Effect.yieldNow

      expect({ attachments, publications }).toEqual({ attachments: 1, publications: 1 })
    })
  )
)

it.effect("coalesces duplicate attachment requests for the same exact correlation", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const changes = yield* Queue.unbounded<typeof terminal>()
      let attachments = 0
      let currentPublications = 0
      const observer = yield* makePassivePlannedAttemptObserver().pipe(
        Effect.provideService(PlannedAttemptExecutorLifecycleObservation, {
          attach: () =>
            Effect.sync(() => {
              attachments += 1
              return { changes: Stream.fromQueue(changes), close: Effect.void, current: executing }
            })
        })
      )
      const input = {
        plannedAttempt,
        publishCurrent: () =>
          Effect.sync(() => (currentPublications += 1)).pipe(
            Effect.as({ acceptedFacts: "UnchangedPassiveObservation" as const, report: executing.report })
          ),
        publishChange: () => Effect.void
      }

      yield* observer.attach(input)
      yield* observer.attach(input)

      expect({ attachments, currentPublications }).toEqual({ attachments: 1, currentPublications: 1 })
    })
  )
)

it.effect("current-first attachment cannot miss a terminal change between projection and await", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const published: Array<typeof terminal> = []
      let closes = 0
      const observer = yield* makePassivePlannedAttemptObserver().pipe(
        Effect.provideService(PlannedAttemptExecutorLifecycleObservation, {
          attach: () =>
            Effect.succeed({ changes: Stream.never, close: Effect.sync(() => (closes += 1)), current: terminal })
        })
      )
      yield* observer.attach({
        plannedAttempt,
        publishCurrent: (projection) =>
          Effect.sync(() => published.push(projection as typeof terminal)).pipe(
            Effect.as({ acceptedFacts: "Changed" as const, report: terminal.report })
          ),
        publishChange: () => Effect.die("terminal current projection must end attachment")
      })
      expect(published).toEqual([terminal])
      expect(closes).toBe(1)
    })
  )
)

it.effect("a fresh process observer reattaches once to an executing attempt", () => {
  let attachments = 0
  let currentPublications = 0
  const lifecycle = PlannedAttemptExecutorLifecycleObservation.of({
    attach: () =>
      Effect.sync(() => {
        attachments += 1
        return { changes: Stream.never, close: Effect.void, current: executing }
      })
  })
  const runProcess = Effect.scoped(
    Effect.gen(function* () {
      const observer = yield* makePassivePlannedAttemptObserver().pipe(
        Effect.provideService(PlannedAttemptExecutorLifecycleObservation, lifecycle)
      )
      yield* observer.attach({
        plannedAttempt,
        publishCurrent: () =>
          Effect.sync(() => (currentPublications += 1)).pipe(
            Effect.as({ acceptedFacts: "UnchangedPassiveObservation" as const, report: executing.report })
          ),
        publishChange: () => Effect.die("unchanged restart attachment must remain suspended")
      })
    })
  )

  return Effect.gen(function* () {
    yield* runProcess
    yield* runProcess
    expect({ attachments, currentPublications }).toEqual({ attachments: 2, currentPublications: 2 })
    expect(Object.keys(lifecycle)).toEqual(["attach"])
  })
})

it.effect("reattaches after process death during suspension without repeating the suspend command", () => {
  let attachments = 0
  const safe = PlannedAttemptExecutorProjection.cases.Exact.make({
    report: PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })
  })
  const published: Array<PlannedAttemptExecutorProjectionType> = []
  const lifecycle = PlannedAttemptExecutorLifecycleObservation.of({
    attach: () =>
      Effect.sync(() => {
        attachments += 1
        return { changes: Stream.never, close: Effect.void, current: attachments === 1 ? executing : safe }
      })
  })
  const runProcess = Effect.scoped(
    Effect.gen(function* () {
      const observer = yield* makePassivePlannedAttemptObserver().pipe(
        Effect.provideService(PlannedAttemptExecutorLifecycleObservation, lifecycle)
      )
      yield* observer.attach({
        plannedAttempt,
        publishCurrent: (projection) =>
          Effect.sync(() => published.push(projection)).pipe(
            Effect.as({
              acceptedFacts:
                projection._tag === "Exact" && projection.report._tag === "ExecutorWorkSafelySuspended"
                  ? ("Changed" as const)
                  : ("UnchangedPassiveObservation" as const),
              report: projection._tag === "Exact" ? projection.report : executing.report
            })
          ),
        publishChange: () => Effect.die("controlled restart returns Safe as its current projection")
      })
    })
  )

  return Effect.gen(function* () {
    yield* runProcess
    yield* runProcess
    expect({ attachments, published }).toEqual({ attachments: 2, published: [executing, safe] })
    expect(Object.keys(lifecycle)).toEqual(["attach"])
  })
})

it.effect("passive lifecycle owner has only current projection await and publication capabilities", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const boundary = PlannedAttemptExecutorLifecycleObservation.of({
        attach: () => Effect.succeed({ changes: Stream.never, close: Effect.void, current: terminal })
      })
      const observer = yield* makePassivePlannedAttemptObserver().pipe(
        Effect.provideService(PlannedAttemptExecutorLifecycleObservation, boundary)
      )
      expectTypeOf<keyof typeof boundary>().toEqualTypeOf<"attach">()
      expectTypeOf<keyof typeof observer>().toEqualTypeOf<keyof PassivePlannedAttemptObserverService>()
      expectTypeOf<keyof PassivePlannedAttemptObserverService>().toEqualTypeOf<"attach">()
      expectTypeOf<keyof Parameters<PassivePlannedAttemptObserverService["attach"]>[0]>().toEqualTypeOf<
        "plannedAttempt" | "publishChange" | "publishCurrent"
      >()
    })
  )
)
