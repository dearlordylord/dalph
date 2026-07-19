import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect, Layer, Option, PlatformError, Ref, Sink, Stdio } from "effect"
import { expect } from "vitest"
import {
  CliUsageError,
  FixtureTarget,
  runCli,
  runCliFromStdio,
  TraceOutput,
  TraceOutputError,
  traceOutputStdioLayer,
  TrackerGraphReader,
  trackerGraphReaderFileLayer,
  trackerWorkflowInterpreterLayer
} from "./index.js"

const fixture = (
  name:
    | "diamond"
    | "empty"
    | "invalid"
    | "invalid-graph"
    | "malformed"
    | "singleton"
    | "wayfinder-105"
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

const runArgumentsAndCollect = (args: ReadonlyArray<string>) =>
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

    yield* runCli(args).pipe(
      Effect.provide(outputLayer),
      Effect.provide(trackerWorkflowInterpreterLayer),
      Effect.provide(trackerGraphReaderFileLayer),
      Effect.provide(NodeServices.layer)
    )

    return yield* Ref.get(lines)
  })

const runAndCollect = (target: string) => runArgumentsAndCollect(["run", target, "--dry"])

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

it.effect("traverses a diamond deterministically through the dry workflow", () =>
  Effect.gen(function*() {
    const target = fixture("diamond")
    const first = yield* runAndCollect(target)
    const second = yield* runAndCollect(target)

    expect(first).toEqual(
      expectedTrace(target, "fixture-diamond-v1", [
        "group",
        "root",
        "left",
        "right",
        "join"
      ])
    )
    expect(second).toEqual(first)
  }))

it.effect("traverses the retained 105-task snapshot through the same dry workflow", () =>
  Effect.gen(function*() {
    const target = fixture("wayfinder-105")
    const first = yield* runAndCollect(target)
    const second = yield* runAndCollect(target)
    const observed: unknown = JSON.parse(first[1] ?? "null")

    expect(second).toEqual(first)
    expect(first).toHaveLength(3)
    expect(observed).toMatchObject({
      _tag: "OperationOutcomeObserved",
      outcome: {
        _tag: "TrackerGraphObserved",
        revision: "tracker-revision:github-issue-12-04f996b64663a5e0"
      }
    })
    if (
      typeof observed === "object"
      && observed !== null
      && "outcome" in observed
      && typeof observed.outcome === "object"
      && observed.outcome !== null
      && "taskIds" in observed.outcome
      && Array.isArray(observed.outcome.taskIds)
    ) {
      expect(observed.outcome.taskIds).toHaveLength(105)
      expect(new Set(observed.outcome.taskIds)).toHaveLength(105)
    }
  }))

it.effect("parses the dry flag independently of its argument position", () =>
  Effect.gen(function*() {
    const target = fixture("singleton")
    const lines = yield* runArgumentsAndCollect(["run", "--dry", target])

    expect(lines).toEqual(
      expectedTrace(target, "fixture-singleton-v1", ["task-only"])
    )
  }))

it.effect("runs the CLI entrypoint through injected Stdio and application services", () =>
  Effect.gen(function*() {
    const target = fixture("singleton")
    const chunks = yield* Ref.make<ReadonlyArray<string>>([])
    const stdioLayer = Stdio.layerTest({
      args: Effect.succeed(["run", "--dry", target]),
      stdout: () =>
        Sink.forEach((chunk: string | Uint8Array) =>
          Ref.update(chunks, (current) => [
            ...current,
            typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk)
          ])
        )
    })

    yield* runCliFromStdio.pipe(
      Effect.provide(traceOutputStdioLayer),
      Effect.provide(trackerWorkflowInterpreterLayer),
      Effect.provide(trackerGraphReaderFileLayer),
      Effect.provide(stdioLayer),
      Effect.provide(NodeServices.layer)
    )

    expect(yield* Ref.get(chunks)).toEqual(
      expectedTrace(target, "fixture-singleton-v1", ["task-only"]).map(
        (line) => `${line}\n`
      )
    )
  }))

it.effect("maps injected Stdio write failures to a typed trace error", () =>
  Effect.gen(function*() {
    const platformFailure = PlatformError.systemError({
      _tag: "WriteZero",
      module: "Stdio",
      method: "write"
    })
    const stdioLayer = Stdio.layerTest({
      stdout: () => Sink.fail(platformFailure)
    })
    const error = yield* Effect.gen(function*() {
      const output = yield* TraceOutput
      yield* output.writeLine("trace")
    }).pipe(
      Effect.provide(traceOutputStdioLayer),
      Effect.provide(stdioLayer),
      Effect.flip,
      Effect.orDie
    )

    expect(error).toBeInstanceOf(TraceOutputError)
    expect(error.detail).toContain("WriteZero")
  }))

it.effect("requires the dry flag", () =>
  Effect.gen(function*() {
    const error = yield* runCli(["run", fixture("empty")]).pipe(
      Effect.provide(discardOutputLayer),
      Effect.provide(trackerWorkflowInterpreterLayer),
      Effect.provide(trackerGraphReaderFileLayer),
      Effect.provide(NodeServices.layer),
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

    expect(missing._tag).toBe("TrackerGraphReader.TrackerReadError")
    expect(malformed._tag).toBe("TrackerGraphReader.TrackerReadError")
    expect(invalid._tag).toBe("TrackerGraphReader.TrackerReadError")
    if (
      missing._tag === "TrackerGraphReader.TrackerReadError"
      && malformed._tag === "TrackerGraphReader.TrackerReadError"
      && invalid._tag === "TrackerGraphReader.TrackerReadError"
    ) {
      expect(missing.operation).toBe("TrackerGraphReader.read")
      expect(malformed.operation).toBe("TrackerGraphReader.parse")
      expect(invalid.operation).toBe("TrackerGraphReader.decode")
    }
  }).pipe(Effect.provide(trackerGraphReaderFileLayer)))

it.effect("rejects every structural graph issue without exposing a snapshot", () =>
  Effect.gen(function*() {
    const reader = yield* TrackerGraphReader
    const error = yield* reader
      .read(FixtureTarget.make(fixture("invalid-graph")))
      .pipe(Effect.flip, Effect.orDie)

    expect(error._tag).toBe("TaskDag.GraphProjectionError")
    if (error._tag === "TaskDag.GraphProjectionError") {
      expect(error.issues.map((issue) => issue._tag)).toEqual([
        "DuplicateTask",
        "MissingPrerequisite",
        "DuplicatePrerequisite",
        "SelfPrerequisite",
        "Cycle"
      ])
    }
  }).pipe(Effect.provide(trackerGraphReaderFileLayer)))

it.effect("preserves containment and blocker edges from the retained snapshot", () =>
  Effect.gen(function*() {
    const reader = yield* TrackerGraphReader
    const graph = yield* reader.read(
      FixtureTarget.make(fixture("wayfinder-105"))
    )
    const taskIds = graph.taskIds()
    const containmentEdges = taskIds.filter(
      (taskId) => Option.getOrNull(graph.parentTaskIdOf(taskId)) !== null
    ).length
    const derivedContainmentEdges = taskIds.reduce(
      (count, taskId) => count + graph.childrenOf(taskId).length,
      0
    )
    const blockerEdges = taskIds.reduce(
      (count, taskId) => count + graph.prerequisitesOf(taskId).length,
      0
    )

    expect(taskIds).toHaveLength(105)
    expect(containmentEdges).toBe(104)
    expect(derivedContainmentEdges).toBe(104)
    expect(blockerEdges).toBe(108)
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
      Effect.provide(NodeServices.layer),
      Effect.flip,
      Effect.orDie
    )

    expect(error).toBe(failure)
  }))
