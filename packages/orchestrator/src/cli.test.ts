import { it } from "@effect/vitest"
import { Effect, Layer, Ref } from "effect"
import { expect } from "vitest"
import {
  CliUsageError,
  FixtureTarget,
  runCli,
  TraceOutput,
  TraceOutputError,
  TrackerGraphReader,
  trackerGraphReaderFileLayer,
  trackerWorkflowInterpreterLayer
} from "./index.js"

const fixture = (
  name: "empty" | "invalid" | "malformed" | "singleton"
): string => new URL(`../fixtures/${name}.json`, import.meta.url).pathname

const expectedTrace = (
  target: string,
  revision: string,
  taskIds: ReadonlyArray<string>
): ReadonlyArray<string> => [
  JSON.stringify({
    _tag: "OperationSelected",
    operation: { _tag: "ReadTrackerGraph", target }
  }),
  JSON.stringify({
    _tag: "OperationOutcomeObserved",
    operation: { _tag: "ReadTrackerGraph", target },
    outcome: { _tag: "TrackerGraphObserved", revision, taskIds }
  }),
  JSON.stringify({ _tag: "RunCompleted" })
]

const runAndCollect = (target: string) =>
  Effect.gen(function*() {
    const lines = yield* Ref.make<ReadonlyArray<string>>([])
    const outputLayer = Layer.succeed(
      TraceOutput,
      TraceOutput.of({
        writeLine: Effect.fn("TraceOutput.Test.writeLine")(function*(line) {
          yield* Ref.update(lines, (current) => [...current, line])
        })
      })
    )

    yield* runCli(["run", target, "--dry"]).pipe(
      Effect.provide(outputLayer),
      Effect.provide(trackerWorkflowInterpreterLayer),
      Effect.provide(trackerGraphReaderFileLayer)
    )

    return yield* Ref.get(lines)
  })

const discardOutputLayer = Layer.succeed(
  TraceOutput,
  TraceOutput.of({
    writeLine: Effect.fn("TraceOutput.Test.discard")(function*() {
      yield* Effect.void
    })
  })
)

it.effect("runs an empty fixture deterministically through the dry workflow", () =>
  Effect.gen(function*() {
    const target = fixture("empty")
    const first = yield* runAndCollect(target)
    const second = yield* runAndCollect(target)

    expect(first).toEqual(expectedTrace(target, "fixture-empty-v1", []))
    expect(second).toEqual(first)
  }))

it.effect("runs a singleton fixture deterministically through the dry workflow", () =>
  Effect.gen(function*() {
    const target = fixture("singleton")
    const first = yield* runAndCollect(target)
    const second = yield* runAndCollect(target)

    expect(first).toEqual(
      expectedTrace(target, "fixture-singleton-v1", ["task-only"])
    )
    expect(second).toEqual(first)
  }))

it.effect("rejects arguments outside the dry run command", () =>
  Effect.gen(function*() {
    const error = yield* runCli(["run", fixture("empty")]).pipe(
      Effect.provide(discardOutputLayer),
      Effect.provide(trackerWorkflowInterpreterLayer),
      Effect.provide(trackerGraphReaderFileLayer),
      Effect.flip,
      Effect.orDie
    )

    expect(error).toBeInstanceOf(CliUsageError)
    if (error._tag === "Cli.CliUsageError") {
      expect(error.usage).toBe("dalph run <fixture-target> --dry")
    }
  }))

it.effect("reports fixture read, parse, and decode failures precisely", () =>
  Effect.gen(function*() {
    const reader = yield* TrackerGraphReader
    const missing = yield* reader
      .read(FixtureTarget.make(`${fixture("empty")}.missing`))
      .pipe(Effect.flip, Effect.orDie)
    const malformed = yield* reader
      .read(FixtureTarget.make(fixture("malformed")))
      .pipe(Effect.flip, Effect.orDie)
    const invalid = yield* reader
      .read(FixtureTarget.make(fixture("invalid")))
      .pipe(Effect.flip, Effect.orDie)

    expect(missing.operation).toBe("TrackerGraphReader.read")
    expect(malformed.operation).toBe("TrackerGraphReader.parse")
    expect(invalid.operation).toBe("TrackerGraphReader.decode")
  }).pipe(Effect.provide(trackerGraphReaderFileLayer)))

it.effect("propagates typed trace output failures", () =>
  Effect.gen(function*() {
    const failure = new TraceOutputError({ detail: "closed" })
    const outputLayer = Layer.succeed(
      TraceOutput,
      TraceOutput.of({
        writeLine: Effect.fn("TraceOutput.Test.failWrite")(function*() {
          return yield* Effect.fail(failure)
        })
      })
    )
    const error = yield* runCli(["run", fixture("empty"), "--dry"]).pipe(
      Effect.provide(outputLayer),
      Effect.provide(trackerWorkflowInterpreterLayer),
      Effect.provide(trackerGraphReaderFileLayer),
      Effect.flip,
      Effect.orDie
    )

    expect(error).toBe(failure)
  }))
