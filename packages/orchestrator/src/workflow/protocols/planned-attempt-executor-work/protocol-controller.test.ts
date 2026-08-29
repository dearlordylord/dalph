import { it } from "@effect/vitest"
import { AttemptId, PlannedAttemptExecutorProjection, PlannedAttemptExecutorReport, RunId } from "@dalph/contracts"
import { Deferred, Effect, Exit, Fiber, Option, Ref } from "effect"
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
  const report = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
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

it.effect("atomically hands an unactivated reservation to Terminal and restores it before another waiter", () =>
  Effect.gen(function* () {
    const controller = yield* makePlannedAttemptProtocolController()
    const reserved = yield* controller.reserve(correlation)
    expect(Option.isSome(reserved)).toBe(true)
    if (Option.isNone(reserved)) return

    const terminalEntered = yield* Deferred.make<void>()
    const finishTerminal = yield* Deferred.make<void>()
    const terminal = yield* controller
      .withTerminalPermit(correlation, () =>
        Deferred.succeed(terminalEntered, undefined).pipe(Effect.andThen(Deferred.await(finishTerminal)))
      )
      .pipe(Effect.forkChild)
    yield* Deferred.await(terminalEntered)

    const staleEntered = yield* Deferred.make<void>()
    const stale = yield* withPlannedAttemptProtocolPermit(
      reserved.value,
      correlation,
      Deferred.succeed(staleEntered, undefined)
    ).pipe(Effect.forkChild)
    expect(stale.pollUnsafe()).toBeUndefined()

    const thirdEntered = yield* Deferred.make<void>()
    const third = yield* controller
      .withPermit(correlation, () => Deferred.succeed(thirdEntered, undefined))
      .pipe(Effect.forkChild)
    expect(third.pollUnsafe()).toBeUndefined()

    yield* Deferred.succeed(finishTerminal, undefined)
    yield* Fiber.join(terminal)
    yield* Deferred.await(staleEntered)
    yield* Fiber.join(stale)
    expect(third.pollUnsafe()).toBeUndefined()
    yield* reserved.value.release
    yield* Deferred.await(thirdEntered)
    yield* Fiber.join(third)
  })
)

it.effect("preempts an activated owner before its durable intent append", () =>
  Effect.gen(function* () {
    const controller = yield* makePlannedAttemptProtocolController()
    const reserved = yield* controller.reserve(correlation)
    expect(Option.isSome(reserved)).toBe(true)
    if (Option.isNone(reserved)) return

    const activated = yield* Deferred.make<void>()
    const attemptIntent = yield* Deferred.make<void>()
    const intentRecorded = yield* Ref.make(false)
    const terminalChoiceApplied = yield* Ref.make(false)
    const action = yield* withPlannedAttemptProtocolPermit(
      reserved.value,
      correlation,
      Deferred.succeed(activated, undefined).pipe(
        Effect.andThen(Deferred.await(attemptIntent)),
        Effect.andThen(
          reserved.value.commitIntent(
            Ref.get(terminalChoiceApplied).pipe(
              Effect.flatMap((applied) =>
                applied ? Effect.fail("TerminalApplied" as const) : Ref.set(intentRecorded, true)
              )
            )
          )
        )
      )
    ).pipe(Effect.result, Effect.forkChild)
    yield* Deferred.await(activated)

    const terminalEntered = yield* Deferred.make<void>()
    const finishTerminal = yield* Deferred.make<void>()
    const terminal = yield* controller
      .withTerminalPermit(correlation, () =>
        Ref.set(terminalChoiceApplied, true).pipe(
          Effect.andThen(Deferred.succeed(terminalEntered, undefined)),
          Effect.andThen(Deferred.await(finishTerminal))
        )
      )
      .pipe(Effect.forkChild)
    yield* Deferred.await(terminalEntered)
    yield* Deferred.succeed(attemptIntent, undefined)
    expect(action.pollUnsafe()).toBeUndefined()
    expect(yield* Ref.get(intentRecorded)).toBe(false)

    yield* Deferred.succeed(finishTerminal, undefined)
    yield* Fiber.join(terminal)
    expect(yield* Fiber.join(action)).toMatchObject({ _tag: "Failure", failure: "TerminalApplied" })
    expect(yield* Ref.get(intentRecorded)).toBe(false)
    yield* reserved.value.release
  })
)

it.effect("defers a preempted owner's release until Terminal finishes", () =>
  Effect.gen(function* () {
    const controller = yield* makePlannedAttemptProtocolController()
    const reserved = yield* controller.reserve(correlation)
    expect(Option.isSome(reserved)).toBe(true)
    if (Option.isNone(reserved)) return

    const terminalEntered = yield* Deferred.make<void>()
    const finishTerminal = yield* Deferred.make<void>()
    const terminal = yield* controller
      .withTerminalPermit(correlation, () =>
        Deferred.succeed(terminalEntered, undefined).pipe(Effect.andThen(Deferred.await(finishTerminal)))
      )
      .pipe(Effect.forkChild)
    yield* Deferred.await(terminalEntered)
    yield* reserved.value.release

    const waiterEntered = yield* Deferred.make<void>()
    const waiter = yield* controller
      .withPermit(correlation, () => Deferred.succeed(waiterEntered, undefined))
      .pipe(Effect.forkChild)
    expect(waiter.pollUnsafe()).toBeUndefined()
    yield* Deferred.succeed(finishTerminal, undefined)
    yield* Fiber.join(terminal)
    yield* Deferred.await(waiterEntered)
    yield* Fiber.join(waiter)
  })
)

it.effect("makes Terminal wait after the durable intent append wins", () =>
  Effect.gen(function* () {
    const controller = yield* makePlannedAttemptProtocolController()
    const reserved = yield* controller.reserve(correlation)
    expect(Option.isSome(reserved)).toBe(true)
    if (Option.isNone(reserved)) return

    expect(yield* reserved.value.commitIntent(Effect.succeed("intent"))).toBe("intent")
    const terminalEntered = yield* Deferred.make<void>()
    const terminal = yield* controller
      .withTerminalPermit(correlation, () => Deferred.succeed(terminalEntered, undefined))
      .pipe(Effect.forkChild)
    expect(terminal.pollUnsafe()).toBeUndefined()
    yield* reserved.value.release
    yield* Deferred.await(terminalEntered)
    yield* Fiber.join(terminal)
  })
)

it.effect("serializes concurrent terminal choices for one exact attempt", () =>
  Effect.gen(function* () {
    const controller = yield* makePlannedAttemptProtocolController()
    const firstEntered = yield* Deferred.make<void>()
    const finishFirst = yield* Deferred.make<void>()
    const secondEntered = yield* Deferred.make<void>()

    const first = yield* controller
      .withTerminalPermit(correlation, () =>
        Deferred.succeed(firstEntered, undefined).pipe(Effect.andThen(Deferred.await(finishFirst)))
      )
      .pipe(Effect.forkChild)
    yield* Deferred.await(firstEntered)

    const second = yield* controller
      .withTerminalPermit(correlation, () => Deferred.succeed(secondEntered, undefined))
      .pipe(Effect.forkChild)
    yield* Effect.yieldNow
    expect(second.pollUnsafe()).toBeUndefined()

    yield* Deferred.succeed(finishFirst, undefined)
    yield* Fiber.join(first)
    yield* Deferred.await(secondEntered)
    yield* Fiber.join(second)
  })
)

it.effect("waits for an occupied exact permit before admitting the next protocol owner", () =>
  Effect.gen(function* () {
    const controller = yield* makePlannedAttemptProtocolController()
    const firstEntered = yield* Deferred.make<void>()
    const finishFirst = yield* Deferred.make<void>()
    const secondEntered = yield* Deferred.make<void>()

    const first = yield* controller
      .withPermit(correlation, () =>
        Deferred.succeed(firstEntered, undefined).pipe(Effect.andThen(Deferred.await(finishFirst)))
      )
      .pipe(Effect.forkChild)
    yield* Deferred.await(firstEntered)

    const second = yield* controller
      .withPermit(correlation, () => Deferred.succeed(secondEntered, undefined))
      .pipe(Effect.forkChild)
    yield* Effect.yieldNow
    expect(second.pollUnsafe()).toBeUndefined()

    yield* Deferred.succeed(finishFirst, undefined)
    yield* Fiber.join(first)
    yield* Deferred.await(secondEntered)
    yield* Fiber.join(second)
  })
)

it.effect("does not reactivate a permit until a terminal choice releases its preemption", () =>
  Effect.gen(function* () {
    const controller = yield* makePlannedAttemptProtocolController()
    const reserved = yield* controller.reserve(correlation)
    expect(Option.isSome(reserved)).toBe(true)
    if (Option.isNone(reserved)) return

    const terminalEntered = yield* Deferred.make<void>()
    const finishTerminal = yield* Deferred.make<void>()
    const terminal = yield* controller
      .withTerminalPermit(correlation, () =>
        Deferred.succeed(terminalEntered, undefined).pipe(Effect.andThen(Deferred.await(finishTerminal)))
      )
      .pipe(Effect.forkChild)
    yield* Deferred.await(terminalEntered)

    const activation = yield* reserved.value.activate.pipe(Effect.forkChild)
    yield* Effect.yieldNow
    expect(activation.pollUnsafe()).toBeUndefined()
    yield* Deferred.succeed(finishTerminal, undefined)
    yield* Fiber.join(terminal)
    expect(yield* Fiber.join(activation)).toBe("Active")
    yield* reserved.value.release
  })
)

it.effect("holds a terminal choice behind a durable intent append boundary", () =>
  Effect.gen(function* () {
    const controller = yield* makePlannedAttemptProtocolController()
    const reserved = yield* controller.reserve(correlation)
    expect(Option.isSome(reserved)).toBe(true)
    if (Option.isNone(reserved)) return

    const appendEntered = yield* Deferred.make<void>()
    const allowAppend = yield* Deferred.make<void>()
    const terminalEntered = yield* Deferred.make<void>()
    const finishTerminal = yield* Deferred.make<void>()
    const appendCount = yield* Ref.make(0)

    const intent = yield* withPlannedAttemptProtocolPermit(
      reserved.value,
      correlation,
      reserved.value.commitIntent(
        Deferred.succeed(appendEntered, undefined).pipe(
          Effect.andThen(Deferred.await(allowAppend)),
          Effect.andThen(Ref.updateAndGet(appendCount, (count) => count + 1))
        )
      )
    ).pipe(Effect.forkChild)
    yield* Deferred.await(appendEntered)

    const terminal = yield* controller
      .withTerminalPermit(correlation, () =>
        Deferred.succeed(terminalEntered, undefined).pipe(Effect.andThen(Deferred.await(finishTerminal)))
      )
      .pipe(Effect.forkChild)
    yield* Effect.yieldNow
    expect(terminal.pollUnsafe()).toBeUndefined()

    yield* Deferred.succeed(allowAppend, undefined)
    expect(yield* Fiber.join(intent)).toBe(1)
    expect(yield* Ref.get(appendCount)).toBe(1)
    expect(terminal.pollUnsafe()).toBeUndefined()

    yield* reserved.value.release
    yield* Deferred.await(terminalEntered)
    yield* Deferred.succeed(finishTerminal, undefined)
    yield* Fiber.join(terminal)
  })
)
