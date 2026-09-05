// @effect-diagnostics lazyEffect:off
import { NodeFileSystem } from "@effect/platform-node"
import { Context, Effect, FileSystem, Layer, Option, Ref, Schema } from "effect"
import { makeTaskWorkSpecification, TaskId, type TaskWorkSpecification } from "@dalph/contracts"
import { FixtureTarget } from "./fixture/target.js"
import { type TrackerTarget } from "./target.js"
import { GraphProjectionError, projectTrackerSnapshot, type TaskDagSnapshot } from "./graph.js"

const TrackerReadOperation = Schema.Literals(["TrackerGraphReader.parse", "TrackerGraphReader.decode"])

/** Failure to acquire serialized tracker-fixture content from its read capability. */
export class FixtureReadError extends Schema.TaggedError<FixtureReadError>()("FixtureReader.FixtureReadError", {
  target: FixtureTarget,
  detail: Schema.String
}) {}

export class TrackerReadError extends Schema.TaggedError<TrackerReadError>()("TrackerGraphReader.TrackerReadError", {
  operation: TrackerReadOperation,
  detail: Schema.String
}) {}

export const TrackerAdapterReadFailureReason = Schema.TaggedUnion({
  BoundaryDecode: {},
  IncompleteSnapshot: {},
  ResourceLimitExceeded: {},
  /** The provider proved a request limit, so Dalph must not infer missing tracker facts. */
  Throttled: {},
  Transport: {},
  UnsupportedTarget: {}
})
export type TrackerAdapterReadFailureReason = typeof TrackerAdapterReadFailureReason.Type

export const GithubTrackerReadOperation = Schema.Literals([
  "GithubTrackerGraphReader.readBlockedBy",
  "GithubTrackerGraphReader.readIssue",
  "GithubTrackerGraphReader.readTaskWorkSpecification",
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
export class TrackerAdapterReadError extends Schema.TaggedError<TrackerAdapterReadError>()(
  "TrackerGraphReader.AdapterReadError",
  { context: TrackerAdapterReadContext, detail: Schema.String, reason: TrackerAdapterReadFailureReason }
) {}

interface TrackerGraphReaderService {
  readonly read: (
    target: TrackerTarget
  ) => Effect.Effect<
    TaskDagSnapshot,
    FixtureReadError | GraphProjectionError | TrackerAdapterReadError | TrackerReadError
  >
  readonly readTaskWorkSpecification: (
    target: TrackerTarget,
    taskId: TaskId
  ) => Effect.Effect<TaskWorkSpecification, FixtureReadError | TrackerAdapterReadError | TrackerReadError>
}

export class TrackerGraphReader extends Context.Service<TrackerGraphReader, TrackerGraphReaderService>()(
  "@dalph/TrackerGraphReader"
) {}

interface TestTrackerGraphReaderService extends TrackerGraphReaderService {
  /** Inspects fixture state without recording a Dalph tracker read. */
  readonly inspectTask: (
    taskId: TaskId
  ) => Effect.Effect<{
    readonly snapshot: TaskDagSnapshot
    readonly specification: Option.Option<TaskWorkSpecification>
  }>
  readonly requestedTargets: () => Effect.Effect<ReadonlyArray<TrackerTarget>>
  readonly setSnapshot: (snapshot: TaskDagSnapshot) => Effect.Effect<void>
  readonly setTaskWorkSpecification: (specification: TaskWorkSpecification) => Effect.Effect<void>
}

export class TestTrackerGraphReader extends Context.Service<TestTrackerGraphReader, TestTrackerGraphReaderService>()(
  "@dalph/TrackerGraphReader/Test"
) {}

export const trackerGraphReaderTestLayer = (
  initialSnapshot: TaskDagSnapshot,
  initialTaskWorkSpecifications: ReadonlyArray<TaskWorkSpecification> = []
) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const snapshot = yield* Ref.make(initialSnapshot)
      const targets = yield* Ref.make<ReadonlyArray<TrackerTarget>>([])
      const taskWorkSpecifications = yield* Ref.make(
        new Map(initialTaskWorkSpecifications.map((specification) => [specification.taskId, specification]))
      )
      const service = TestTrackerGraphReader.of({
        inspectTask: (taskId) =>
          Effect.all({
            snapshot: Ref.get(snapshot),
            specification: Ref.get(taskWorkSpecifications).pipe(
              Effect.map((specifications) => Option.fromUndefinedOr(specifications.get(taskId)))
            )
          }),
        read: Effect.fn("TrackerGraphReader.Test.read")(function* (target) {
          yield* Ref.update(targets, (current) => [...current, target])
          return yield* Ref.get(snapshot)
        }),
        requestedTargets: () => Ref.get(targets),
        readTaskWorkSpecification: Effect.fn("TrackerGraphReader.Test.readTaskWorkSpecification")(
          function* (target, taskId) {
            yield* Ref.update(targets, (current) => [...current, target])
            const specification = (yield* Ref.get(taskWorkSpecifications)).get(taskId)
            if (specification !== undefined) return specification
            return yield* new TrackerAdapterReadError({
              context: TrackerAdapterReadContext.cases.Fixture.make({ operation: "TrackerGraphReader.selectAdapter" }),
              detail: `no controlled task-work specification for ${taskId}`,
              reason: TrackerAdapterReadFailureReason.cases.IncompleteSnapshot.make({})
            })
          }
        ),
        setSnapshot: (next) => Ref.set(snapshot, next),
        setTaskWorkSpecification: (specification) =>
          Ref.update(taskWorkSpecifications, (current) => new Map([...current, [specification.taskId, specification]]))
      })
      return Context.empty().pipe(
        Context.add(TrackerGraphReader, service),
        Context.add(TestTrackerGraphReader, service)
      )
    })
  )

interface FixtureReaderService {
  readonly read: (target: FixtureTarget) => Effect.Effect<string, FixtureReadError>
}

/** Reads fixture content without granting graph projection any filesystem authority. */
export class FixtureReader extends Context.Service<FixtureReader, FixtureReaderService>()("@dalph/FixtureReader") {}

const fixtureReaderFileSystemLayer = Layer.effect(
  FixtureReader,
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const read = Effect.fn("FixtureReader.File.read")(function* (target: FixtureTarget) {
      return yield* fileSystem
        .readFileString(target)
        .pipe(Effect.mapError((cause) => new FixtureReadError({ target, detail: String(cause) })))
    })

    return FixtureReader.of({ read })
  })
)

export const fixtureReaderFileLayer = fixtureReaderFileSystemLayer.pipe(Layer.provide(NodeFileSystem.layer))

const parseJson = Effect.fn("TrackerGraphReader.parseJson")(function* (contents: string) {
  return yield* Effect.try({
    try: (): unknown => JSON.parse(contents),
    catch: (cause) => new TrackerReadError({ operation: "TrackerGraphReader.parse", detail: String(cause) })
  })
})

const FixtureTaskWorkSpecifications = Schema.Struct({
  tasks: Schema.Array(Schema.Struct({ body: Schema.String, id: TaskId, title: Schema.NonEmptyString }))
})

export const trackerGraphReaderLayer = Layer.effect(
  TrackerGraphReader,
  Effect.gen(function* () {
    const fixtureReader = yield* FixtureReader
    const read = Effect.fn("TrackerGraphReader.read")(function* (target: TrackerTarget) {
      if (typeof target !== "string") {
        return yield* new TrackerAdapterReadError({
          context: TrackerAdapterReadContext.cases.Fixture.make({ operation: "TrackerGraphReader.selectAdapter" }),
          detail: `fixture reader cannot read ${target._tag}`,
          reason: TrackerAdapterReadFailureReason.cases.UnsupportedTarget.make({})
        })
      }
      const contents = yield* fixtureReader.read(target)
      const input = yield* parseJson(contents)
      const projection = projectTrackerSnapshot(input)
      if (projection._tag === "Valid") return projection.snapshot

      const boundaryIssue = projection.issues.find((issue) => issue._tag === "BoundaryDecodeFailed")
      if (boundaryIssue?._tag === "BoundaryDecodeFailed") {
        return yield* new TrackerReadError({ operation: "TrackerGraphReader.decode", detail: boundaryIssue.detail })
      }
      return yield* new GraphProjectionError({ issues: projection.issues })
    })

    const readTaskWorkSpecification = Effect.fn("TrackerGraphReader.readTaskWorkSpecification")(function* (
      target: TrackerTarget,
      taskId: TaskId
    ) {
      if (typeof target !== "string") {
        return yield* new TrackerAdapterReadError({
          context: TrackerAdapterReadContext.cases.Fixture.make({ operation: "TrackerGraphReader.selectAdapter" }),
          detail: `fixture reader cannot read ${target._tag}`,
          reason: TrackerAdapterReadFailureReason.cases.UnsupportedTarget.make({})
        })
      }
      const contents = yield* fixtureReader.read(target)
      const input = yield* parseJson(contents)
      const decoded = yield* Schema.decodeUnknownEffect(FixtureTaskWorkSpecifications)(input).pipe(
        Effect.mapError(
          (cause) => new TrackerReadError({ operation: "TrackerGraphReader.decode", detail: String(cause) })
        )
      )
      const task = decoded.tasks.find(({ id }) => id === taskId)
      if (task === undefined) {
        return yield* new TrackerAdapterReadError({
          context: TrackerAdapterReadContext.cases.Fixture.make({ operation: "TrackerGraphReader.selectAdapter" }),
          detail: `fixture does not contain task-work specification for ${taskId}`,
          reason: TrackerAdapterReadFailureReason.cases.IncompleteSnapshot.make({})
        })
      }
      return makeTaskWorkSpecification({ body: task.body, taskId: task.id, title: task.title })
    })

    return TrackerGraphReader.of({ read, readTaskWorkSpecification })
  })
)

export const trackerGraphReaderFileLayer = trackerGraphReaderLayer.pipe(Layer.provide(fixtureReaderFileLayer))
