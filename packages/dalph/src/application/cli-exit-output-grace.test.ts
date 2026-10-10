import { RunId } from "@dalph/contracts"
import {
  AllocatedWorkflowRunId,
  ApplicationExitResult,
  currentSignalOf,
  currentSignalFromCurrentFirstStream,
  type DeliveryRuntimeObservationState,
  JournalPosition,
  ProductionRunSelection,
  TraceAtCursor,
  TraceCursor,
  traceControlDispositionFacetVersion,
  traceReaderSchemaVersion,
  TraceOutputError,
  TraceSnapshotAdmission
} from "@dalph/orchestrator"
import { it } from "@effect/vitest"
import { Cause, Clock, Deferred, Effect, Fiber, Option, Queue, Ref, Stream } from "effect"
import { TestClock } from "effect/testing"
import { expect } from "vitest"
import {
  abandonedCliOutputProcessStatus,
  CliExitOutputAbandoned,
  retainCliExitOutputCompletion,
  withCliExitOutputGrace
} from "./cli-exit-output.js"
import { presentApplicationExitResult, presentSelectedProductionRun } from "./production-cli.js"

const runId = AllocatedWorkflowRunId.make(RunId.make("cli-output-grace"))
const cursor = TraceCursor.make({ runId, position: JournalPosition.make(1) })
const snapshot = TraceAtCursor.make({
  cursor,
  derivedTaskOrder: { _tag: "DerivedTaskOrder", basis: "TaskIdCodeUnitAscending", taskIds: [] },
  facets: {
    controlDisposition: { cleanup: [], controls: [], dispositions: [], version: traceControlDispositionFacetVersion },
    integration: { facts: [] },
    recovery: { observationGaps: [], preservationDispositions: [], retainedResponsibilities: [] }
  },
  graph: null,
  items: [],
  relationships: {
    outsideAuthorityAcknowledgements: [],
    processLocalResourceSerializations: [],
    taskGraphEdges: [],
    workflowCausalEdges: []
  },
  version: traceReaderSchemaVersion
})

const selected = {
  acceptedHistory: currentSignalOf(cursor),
  current: currentSignalOf({ _tag: "Closed" as const, final: null }),
  runTermination: { await: Effect.never, poll: Effect.succeed(Option.none()) },
  selection: ProductionRunSelection.cases.Allocated.make({ runId }),
  traceReader: {
    readAt: () => Effect.succeed(snapshot),
    snapshotAdmission: () => Effect.succeed(TraceSnapshotAdmission.cases.MayFit.make({}))
  }
}
const successfulExit = ApplicationExitResult.cases.Succeeded.make({ requestedStatus: 0 })

for (const preparation of ["readAt", "snapshotAdmission"] as const) {
  it.effect(
    preparation === "readAt"
      ? "Exit interrupts historical preparation before waiting for output admission"
      : "Exit interrupts snapshot admission before waiting for output serialization",
    () =>
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>()
        const interrupted = yield* Deferred.make<void>()
        const request = yield* Deferred.make<void>()
        const lines = yield* Ref.make<ReadonlyArray<string>>([])
        const write = (line: string) => Ref.update(lines, (prior) => [...prior, line])
        const blocked = Deferred.succeed(entered, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.ensuring(Deferred.succeed(interrupted, undefined))
        )
        const running = yield* presentSelectedProductionRun(
          {
            ...selected,
            traceReader: {
              ...selected.traceReader,
              readAt: preparation === "readAt" ? () => blocked : selected.traceReader.readAt,
              snapshotAdmission:
                preparation === "snapshotAdmission" ? () => blocked : selected.traceReader.snapshotAdmission
            }
          },
          write,
          Effect.void,
          {
            awaitRequest: Deferred.await(request),
            awaitResult: Effect.succeed(successfulExit),
            presentResult: (result) => presentApplicationExitResult(runId, result, write)
          }
        ).pipe(Effect.forkChild)
        yield* Deferred.await(entered)
        yield* Deferred.succeed(request, undefined)
        yield* Fiber.join(running)
        expect(yield* Deferred.isDone(interrupted)).toBe(true)
        expect((yield* Ref.get(lines)).map((line) => JSON.parse(line)._tag)).toEqual([
          "RunSelected",
          "CurrentStatus",
          "ApplicationExitDisposition"
        ])
      })
  )
}

it.effect("an admitted record finishes before the Exit record when the reader resumes within grace", () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const request = yield* Deferred.make<void>()
    const interrupted = yield* Ref.make(false)
    const lines = yield* Ref.make<ReadonlyArray<string>>([])
    const write = (line: string) =>
      Effect.gen(function* () {
        if (JSON.parse(line)._tag === "HistoricalSnapshot") {
          yield* Deferred.succeed(entered, undefined)
          yield* Deferred.await(release).pipe(Effect.onInterrupt(() => Ref.set(interrupted, true)))
        }
        yield* Ref.update(lines, (prior) => [...prior, line])
      })
    const running = yield* presentSelectedProductionRun(selected, write, Effect.void, {
      awaitRequest: Deferred.await(request),
      awaitResult: Effect.succeed(successfulExit),
      presentResult: (result) => presentApplicationExitResult(runId, result, write)
    }).pipe(Effect.forkChild)
    yield* Deferred.await(entered)
    yield* Deferred.succeed(request, undefined)
    yield* TestClock.adjust("100 millis")
    expect(yield* Ref.get(interrupted)).toBe(false)
    yield* Deferred.succeed(release, undefined)
    yield* Fiber.join(running)
    expect((yield* Ref.get(lines)).map((line) => JSON.parse(line)._tag)).toEqual([
      "RunSelected",
      "CurrentStatus",
      "HistoricalSnapshot",
      "ApplicationExitDisposition"
    ])
  })
)

it.effect("stalled output abandons presentation once within the original deadline", () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>()
    const request = yield* Deferred.make<void>()
    const interrupted = yield* Deferred.make<void>()
    const writeCount = yield* Ref.make(0)
    const running = yield* presentSelectedProductionRun(
      selected,
      () =>
        Ref.update(writeCount, (count) => count + 1).pipe(
          Effect.andThen(Deferred.succeed(entered, undefined)),
          Effect.andThen(Effect.never),
          Effect.ensuring(Deferred.succeed(interrupted, undefined))
        ),
      Effect.void,
      {
        awaitRequest: Deferred.await(request),
        awaitResult: Effect.succeed(successfulExit),
        presentResult: () => Effect.void
      }
    ).pipe(Effect.forkChild)
    // This cut is the initial selection write, before the ordinary workers exist.
    yield* Deferred.await(entered)
    yield* Deferred.succeed(request, undefined)
    yield* TestClock.adjust("499 millis")
    expect(running.pollUnsafe()).toBeUndefined()
    yield* TestClock.adjust("1 millis")
    const failure = yield* Fiber.join(running).pipe(Effect.flip)
    expect(failure).toBeInstanceOf(CliExitOutputAbandoned)
    expect(failure).toMatchObject({ requestedStatus: 0 })
    expect(yield* Deferred.isDone(interrupted)).toBe(true)
    expect(yield* Ref.get(writeCount)).toBe(1)
  })
)

it.effect("a repeated Exit does not extend output grace", () =>
  Effect.gen(function* () {
    const request = yield* Deferred.make<void>()
    const entered = yield* Deferred.make<void>()
    const reads = yield* Ref.make(0)
    const running = yield* withCliExitOutputGrace(
      {
        awaitRequest: Deferred.await(request).pipe(Effect.andThen(Ref.update(reads, (count) => count + 1))),
        awaitResult: Effect.succeed(successfulExit)
      },
      (joined) =>
        joined.awaitRequest.pipe(Effect.andThen(Deferred.succeed(entered, undefined)), Effect.andThen(Effect.never))
    ).pipe(Effect.forkChild)
    yield* Deferred.succeed(request, undefined)
    yield* Deferred.await(entered)
    yield* TestClock.adjust("250 millis")
    yield* Deferred.succeed(request, undefined)
    yield* TestClock.adjust("249 millis")
    expect(running.pollUnsafe()).toBeUndefined()
    yield* TestClock.adjust("1 millis")
    expect(yield* Fiber.join(running).pipe(Effect.flip)).toMatchObject({ requestedStatus: 0 })
    expect(yield* Ref.get(reads)).toBe(1)
  })
)

it.effect("a late lifecycle result cannot extend the original Exit deadline", () =>
  Effect.gen(function* () {
    const result = yield* Deferred.make<ApplicationExitResult>()
    const entered = yield* Deferred.make<void>()
    const running = yield* withCliExitOutputGrace(
      { awaitRequest: Effect.void, awaitResult: Deferred.await(result) },
      (joined) =>
        joined.awaitRequest.pipe(Effect.andThen(Deferred.succeed(entered, undefined)), Effect.andThen(Effect.never))
    ).pipe(Effect.forkChild)
    yield* Deferred.await(entered)
    yield* TestClock.adjust("4750 millis")
    yield* Deferred.succeed(result, successfulExit)
    yield* TestClock.adjust("249 millis")
    expect(running.pollUnsafe()).toBeUndefined()
    yield* TestClock.adjust("1 millis")
    expect(yield* Fiber.join(running).pipe(Effect.flip)).toMatchObject({ requestedStatus: 0 })
  })
)

it.effect("a TimedOut result receives no further output allowance", () =>
  Effect.gen(function* () {
    const running = yield* withCliExitOutputGrace(
      {
        awaitRequest: Effect.void,
        awaitResult: Effect.succeed(ApplicationExitResult.cases.TimedOut.make({ diagnostics: [], requestedStatus: 1 }))
      },
      () => Effect.never
    ).pipe(Effect.forkChild)
    expect(yield* Fiber.join(running).pipe(Effect.flip)).toMatchObject({ requestedStatus: 1 })
  })
)

it.effect("a conclusive output failure keeps its typed identity", () =>
  Effect.gen(function* () {
    const expected = new TraceOutputError({ detail: "closed pipe" })
    const failure = yield* withCliExitOutputGrace(
      { awaitRequest: Effect.never, awaitResult: Effect.succeed(successfulExit) },
      () => Effect.fail(expected)
    ).pipe(Effect.flip)
    expect(failure).toBe(expected)
  })
)

it.effect("current status can publish while optional historical preparation is blocked", () =>
  Effect.gen(function* () {
    const changes = yield* Queue.unbounded<DeliveryRuntimeObservationState>()
    const entered = yield* Deferred.make<void>()
    const closedWritten = yield* Deferred.make<void>()
    const lines = yield* Ref.make<ReadonlyArray<string>>([])
    const running = yield* presentSelectedProductionRun(
      {
        ...selected,
        current: currentSignalFromCurrentFirstStream(
          Stream.concat(
            Stream.make({ _tag: "NotReady" } satisfies DeliveryRuntimeObservationState),
            Stream.fromQueue(changes)
          )
        ),
        traceReader: {
          ...selected.traceReader,
          readAt: () => Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never))
        }
      },
      (line) =>
        Effect.gen(function* () {
          yield* Ref.update(lines, (prior) => [...prior, line])
          if (JSON.parse(line).status?._tag === "DeliveryStatusClosed")
            yield* Deferred.succeed(closedWritten, undefined)
        })
    ).pipe(Effect.forkChild)
    yield* Deferred.await(entered)
    yield* Queue.offer(changes, { _tag: "Closed", final: null })
    yield* TestClock.adjust("1 second")
    expect(yield* Deferred.isDone(closedWritten)).toBe(true)
    yield* Fiber.interrupt(running)
    expect((yield* Ref.get(lines)).map((line) => JSON.parse(line)._tag)).toEqual([
      "RunSelected",
      "CurrentStatus",
      "CurrentStatus"
    ])
  })
)

it.effect("an admitted output failure remains visible after ordinary presenters stop", () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    const request = yield* Deferred.make<void>()
    const expected = new TraceOutputError({ detail: "admitted pipe failed" })
    const write = (line: string) =>
      JSON.parse(line)._tag === "HistoricalSnapshot"
        ? Deferred.succeed(entered, undefined).pipe(
            Effect.andThen(Deferred.await(release)),
            Effect.andThen(Effect.fail(expected))
          )
        : Effect.void
    const running = yield* presentSelectedProductionRun(selected, write, Effect.void, {
      awaitRequest: Deferred.await(request),
      awaitResult: Effect.succeed(successfulExit),
      presentResult: (result) => presentApplicationExitResult(runId, result, write)
    }).pipe(Effect.forkChild)
    yield* Deferred.await(entered)
    yield* Deferred.succeed(request, undefined)
    yield* TestClock.adjust("100 millis")
    yield* Deferred.succeed(release, undefined)
    expect(yield* Fiber.join(running).pipe(Effect.flip)).toBe(expected)
  })
)

it.effect("output abandonment cannot hide a host finalization failure", () =>
  Effect.gen(function* () {
    const running = yield* retainCliExitOutputCompletion(
      withCliExitOutputGrace(
        {
          awaitRequest: Effect.void,
          awaitResult: Effect.succeed(ApplicationExitResult.cases.Succeeded.make({ requestedStatus: 0 }))
        },
        () => Effect.never
      ).pipe(Effect.ensuring(Effect.die("host resource did not finalize")))
    ).pipe(Effect.exit, Effect.forkChild)
    yield* TestClock.adjust("500 millis")
    const outcome = yield* Fiber.join(running)
    if (outcome._tag !== "Failure") return yield* Effect.die("expected finalization failure")
    expect(abandonedCliOutputProcessStatus(outcome.cause)).toEqual(Option.some(1))
    expect(abandonedCliOutputProcessStatus(Cause.fail(new CliExitOutputAbandoned({ requestedStatus: 0 })))).toEqual(
      Option.some(0)
    )
    expect(abandonedCliOutputProcessStatus(Cause.fail(new CliExitOutputAbandoned({ requestedStatus: 1 })))).toEqual(
      Option.some(1)
    )
    expect(abandonedCliOutputProcessStatus(Cause.die("unrelated failure"))).toEqual(Option.none())
  })
)

it.effect("a delayed observer uses the retained signal time instead of restarting the deadline", () =>
  Effect.gen(function* () {
    const receivedAt = yield* Clock.monotonicTimeNanos
    const request = yield* Deferred.make<void>()
    const running = yield* withCliExitOutputGrace(
      {
        awaitRequest: Deferred.await(request),
        awaitRequestTime: Effect.succeed(receivedAt),
        awaitResult: Effect.succeed(successfulExit)
      },
      () => Effect.never
    ).pipe(Effect.forkChild)
    yield* TestClock.adjust("4750 millis")
    yield* Deferred.succeed(request, undefined)
    yield* TestClock.adjust("249 millis")
    expect(running.pollUnsafe()).toBeUndefined()
    yield* TestClock.adjust("1 millis")
    expect(yield* Fiber.join(running).pipe(Effect.flip)).toMatchObject({
      _tag: "CliExitOutputAbandoned",
      requestedStatus: 0
    })
  })
)
