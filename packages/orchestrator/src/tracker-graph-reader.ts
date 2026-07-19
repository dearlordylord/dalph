import { Context, Effect, Layer, Schema } from "effect"
import { readFile } from "node:fs/promises"
import { type FixtureTarget, TrackerSnapshot } from "./domain.js"

const TrackerReadOperation = Schema.Literals([
  "TrackerGraphReader.read",
  "TrackerGraphReader.parse",
  "TrackerGraphReader.decode"
])

// eslint-disable-next-line functional/no-class-inheritance -- Effect typed errors use Schema.TaggedErrorClass inheritance.
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
  ) => Effect.Effect<TrackerSnapshot, TrackerReadError>
}

// eslint-disable-next-line functional/no-class-inheritance -- Effect service tags use Context.Service inheritance.
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
      const snapshot = yield* Schema.decodeUnknownEffect(TrackerSnapshot)(
        input
      ).pipe(
        Effect.mapError(
          (cause) =>
            new TrackerReadError({
              operation: "TrackerGraphReader.decode",
              detail: String(cause)
            })
        )
      )
      return snapshot
    })

    return TrackerGraphReader.of({ read })
  })
)
