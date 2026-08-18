import { it } from "@effect/vitest"
import { AttemptId, PlannedAttemptExecutorProjection, PlannedAttemptExecutorReport, RunId } from "@dalph/contracts"
import { Deferred, Effect, Exit, Fiber, Option } from "effect"
import { expect } from "vitest"
import {
  PlannedAttemptExecutorProjectionCorrelationMismatch,
  validatePlannedAttemptExecutorProjectionCorrelation
} from "./errors.js"
import { makePlannedAttemptProtocolController, withPlannedAttemptProtocolPermit } from "./protocol-controller.js"

const correlation = { attemptId: AttemptId.make("guard-attempt"), runId: RunId.make("guard-run") }

it("rejects a projection observed for a different requested correlation", () => {
  const observed = { attemptId: AttemptId.make("foreign-attempt"), runId: correlation.runId }
  const projection = PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation: observed })

  expect(validatePlannedAttemptExecutorProjectionCorrelation(projection, correlation)).toEqual(
    new PlannedAttemptExecutorProjectionCorrelationMismatch({ expected: correlation, observed })
  )
})

it("rejects a contradiction whose observed report repeats its expected correlation", () => {
  const report = PlannedAttemptExecutorReport.cases.Running.make({ correlation })
  const projection = PlannedAttemptExecutorProjection.cases.CorrelationContradiction.make({
    expected: correlation,
    observed: report
  })

  expect(validatePlannedAttemptExecutorProjectionCorrelation(projection, correlation)).toEqual(
    new PlannedAttemptExecutorProjectionCorrelationMismatch({ expected: correlation, observed: correlation })
  )
})

it("accepts a projection whose correlation matches the request", () => {
  const projection = PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation })

  expect(validatePlannedAttemptExecutorProjectionCorrelation(projection, correlation)).toBeUndefined()
})

it.effect("releases only the current exact permit and admits the next waiter", () =>
  Effect.gen(function* () {
    const controller = yield* makePlannedAttemptProtocolController()
    const first = yield* controller.reserve(correlation)
    expect(Option.isSome(first)).toBe(true)
    if (Option.isNone(first)) return
    expect(Option.isNone(yield* controller.reserve(correlation))).toBe(true)

    const entered = yield* Deferred.make<void>()
    const releaseUse = yield* Deferred.make<void>()
    const waiter = yield* controller
      .withPermit(correlation, () =>
        Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(releaseUse)))
      )
      .pipe(Effect.forkChild)
    yield* first.value.release
    yield* first.value.release
    yield* Deferred.await(entered)
    yield* Deferred.succeed(releaseUse, undefined)
    yield* Fiber.join(waiter)

    const next = yield* controller.reserve(correlation)
    expect(Option.isSome(next)).toBe(true)
    if (Option.isSome(next)) yield* next.value.release

    const wrongCorrelation = { ...correlation, attemptId: AttemptId.make("another-attempt") }
    expect(
      Exit.isFailure(yield* Effect.exit(withPlannedAttemptProtocolPermit(first.value, wrongCorrelation, Effect.void)))
    ).toBe(true)
  })
)
