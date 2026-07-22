import { NodeFileSystem } from "@effect/platform-node"
import { Context, Effect, FileSystem, Layer, Ref, Schema } from "effect"
import { FixtureTarget, type TrackerTarget } from "./domain.js"
import { GraphProjectionError, projectTrackerSnapshot, type TaskDagSnapshot } from "./task-dag.js"

const TrackerReadOperation = Schema.Literals([
  "TrackerGraphReader.parse",
  "TrackerGraphReader.decode"
])

/** Failure to acquire serialized tracker-fixture content from its read capability. */
export class FixtureReadError extends Schema.TaggedErrorClass<FixtureReadError>()(
  "FixtureReader.FixtureReadError",
  {
    target: FixtureTarget,
    detail: Schema.String
  }
) {}

export class TrackerReadError extends Schema.TaggedErrorClass<TrackerReadError>()(
  "TrackerGraphReader.TrackerReadError",
  {
    operation: TrackerReadOperation,
    detail: Schema.String
  }
) {}

export const TrackerAdapterReadFailureReason = Schema.TaggedUnion({
  BoundaryDecode: {},
  IncompleteSnapshot: {},
  ResourceLimitExceeded: {},
  Transport: {},
  UnsupportedTarget: {}
})
export type TrackerAdapterReadFailureReason = typeof TrackerAdapterReadFailureReason.Type

export const GithubTrackerReadOperation = Schema.Literals([
  "GithubTrackerGraphReader.readBlockedBy",
  "GithubTrackerGraphReader.readIssue",
  "GithubTrackerGraphReader.readSubIssues",
  "GithubTrackerGraphReader.resolveIssue",
  "GithubTrackerGraphReader.project",
  "GithubTrackerGraphReader.selectAdapter"
])
export type GithubTrackerReadOperation = typeof GithubTrackerReadOperation.Type

export const TrackerAdapterReadContext = Schema.TaggedUnion({
  Fixture: { operation: Schema.Literal("TrackerGraphReader.selectAdapter") },
  Github: { operation: GithubTrackerReadOperation }
})
export type TrackerAdapterReadContext = typeof TrackerAdapterReadContext.Type

/** A provider adapter could not produce one complete, decoded tracker observation. */
export class TrackerAdapterReadError extends Schema.TaggedErrorClass<TrackerAdapterReadError>()(
  "TrackerGraphReader.AdapterReadError",
  {
    context: TrackerAdapterReadContext,
    detail: Schema.String,
    reason: TrackerAdapterReadFailureReason
  }
) {}

interface TrackerGraphReaderService {
  readonly read: (
    target: TrackerTarget
  ) => Effect.Effect<
    TaskDagSnapshot,
    FixtureReadError | GraphProjectionError | TrackerAdapterReadError | TrackerReadError
  >
}

export class TrackerGraphReader extends Context.Service<TrackerGraphReader, TrackerGraphReaderService>()(
  "@dalph/TrackerGraphReader"
) {}

interface TestTrackerGraphReaderService extends TrackerGraphReaderService {
  readonly requestedTargets: () => Effect.Effect<ReadonlyArray<TrackerTarget>>
  readonly setSnapshot: (snapshot: TaskDagSnapshot) => Effect.Effect<void>
}

export class TestTrackerGraphReader extends Context.Service<
  TestTrackerGraphReader,
  TestTrackerGraphReaderService
>()("@dalph/TrackerGraphReader/Test") {}

export const trackerGraphReaderTestLayer = (
  initialSnapshot: TaskDagSnapshot
) =>
  Layer.effectContext(
    Effect.gen(function*() {
      const snapshot = yield* Ref.make(initialSnapshot)
      const targets = yield* Ref.make<ReadonlyArray<TrackerTarget>>([])
      const service = TestTrackerGraphReader.of({
        read: Effect.fn("TrackerGraphReader.Test.read")(function*(target) {
          yield* Ref.update(targets, (current) => [...current, target])
          return yield* Ref.get(snapshot)
        }),
        requestedTargets: () => Ref.get(targets),
        setSnapshot: (next) => Ref.set(snapshot, next)
      })
      return Context.empty().pipe(
        Context.add(TrackerGraphReader, service),
        Context.add(TestTrackerGraphReader, service)
      )
    })
  )

interface FixtureReaderService {
  readonly read: (
    target: FixtureTarget
  ) => Effect.Effect<string, FixtureReadError>
}

/** Reads fixture content without granting graph projection any filesystem authority. */
export class FixtureReader extends Context.Service<FixtureReader, FixtureReaderService>()(
  "@dalph/FixtureReader"
) {}

const fixtureReaderFileSystemLayer = Layer.effect(
  FixtureReader,
  Effect.gen(function*() {
    const fileSystem = yield* FileSystem.FileSystem
    const read = Effect.fn("FixtureReader.File.read")(function*(
      target: FixtureTarget
    ) {
      return yield* fileSystem.readFileString(target).pipe(
        Effect.mapError((cause) =>
          new FixtureReadError({
            target,
            detail: String(cause)
          })
        )
      )
    })

    return FixtureReader.of({ read })
  })
)

export const fixtureReaderFileLayer = fixtureReaderFileSystemLayer.pipe(
  Layer.provide(NodeFileSystem.layer)
)

const parseJson = Effect.fn("TrackerGraphReader.parseJson")(function*(
  contents: string
) {
  return yield* Effect.try({
    try: (): unknown => JSON.parse(contents),
    catch: (cause) =>
      new TrackerReadError({
        operation: "TrackerGraphReader.parse",
        detail: String(cause)
      })
  })
})

export const trackerGraphReaderLayer = Layer.effect(
  TrackerGraphReader,
  Effect.gen(function*() {
    const fixtureReader = yield* FixtureReader
    const read = Effect.fn("TrackerGraphReader.read")(function*(
      target: TrackerTarget
    ) {
      if (typeof target !== "string") {
        return yield* new TrackerAdapterReadError({
          context: TrackerAdapterReadContext.cases.Fixture.make({
            operation: "TrackerGraphReader.selectAdapter"
          }),
          detail: `fixture reader cannot read ${target._tag}`,
          reason: TrackerAdapterReadFailureReason.cases.UnsupportedTarget.make({})
        })
      }
      const contents = yield* fixtureReader.read(target)
      const input = yield* parseJson(contents)
      const projection = projectTrackerSnapshot(input)
      if (projection._tag === "Valid") return projection.snapshot

      const boundaryIssue = projection.issues.find(
        (issue) => issue._tag === "BoundaryDecodeFailed"
      )
      if (boundaryIssue?._tag === "BoundaryDecodeFailed") {
        return yield* new TrackerReadError({
          operation: "TrackerGraphReader.decode",
          detail: boundaryIssue.detail
        })
      }
      return yield* new GraphProjectionError({ issues: projection.issues })
    })

    return TrackerGraphReader.of({ read })
  })
)

export const trackerGraphReaderFileLayer = trackerGraphReaderLayer.pipe(
  Layer.provide(fixtureReaderFileLayer)
)
