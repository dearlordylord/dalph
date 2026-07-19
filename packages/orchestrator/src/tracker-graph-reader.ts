import { Context, Effect, Layer, Schema } from "effect"
import { readFile } from "node:fs/promises"
import { type FixtureTarget } from "./domain.js"
import { GraphProjectionError, projectTrackerSnapshot, type TaskDagSnapshot } from "./task-dag.js"

const TrackerReadOperation = Schema.Literals([
  "TrackerGraphReader.read",
  "TrackerGraphReader.parse",
  "TrackerGraphReader.decode"
])

export class TrackerReadError extends Schema.TaggedErrorClass<TrackerReadError>()(
  "TrackerGraphReader.TrackerReadError",
  {
    operation: TrackerReadOperation,
    detail: Schema.String
  }
) {}

interface TrackerGraphReaderService {
  readonly read: (
    target: FixtureTarget
  ) => Effect.Effect<TaskDagSnapshot, GraphProjectionError | TrackerReadError>
}

export class TrackerGraphReader extends Context.Service<TrackerGraphReader, TrackerGraphReaderService>()(
  "@dalph/TrackerGraphReader"
) {}

const readJson = Effect.fn("TrackerGraphReader.readJson")(function*(
  target: FixtureTarget
) {
  const contents = yield* Effect.tryPromise({
    try: () => readFile(target, "utf8"),
    catch: (cause) =>
      new TrackerReadError({
        operation: "TrackerGraphReader.read",
        detail: String(cause)
      })
  })
  return yield* Effect.try({
    try: (): unknown => JSON.parse(contents),
    catch: (cause) =>
      new TrackerReadError({
        operation: "TrackerGraphReader.parse",
        detail: String(cause)
      })
  })
})

export const trackerGraphReaderFileLayer = Layer.effect(
  TrackerGraphReader,
  Effect.gen(function*() {
    const read = Effect.fn("TrackerGraphReader.read")(function*(
      target: FixtureTarget
    ) {
      const input = yield* readJson(target)
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
