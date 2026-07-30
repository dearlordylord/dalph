import { Effect, Option, Ref, Schema } from "effect"
import {
  AuthoredCassetteStoryItem,
  type AuthoredCassetteStoryItem as StoryItem,
  AuthoredTrackerGraphReadResult
} from "./authored-domain.js"

export class AuthoredCassetteInteractionMismatch extends Schema.TaggedErrorClass<AuthoredCassetteInteractionMismatch>()(
  "AuthoredCassetteInteractionMismatch",
  { actual: Schema.String, expected: Schema.String, storyPosition: Schema.Int }
) {}

type CursorFailure = AuthoredCassetteInteractionMismatch

export interface StoryCursor {
  readonly consumeCapacityChange: Effect.Effect<
    Option.Option<typeof AuthoredCassetteStoryItem.cases.SetTaskExecutionCapacity.Type>
  >
  readonly consumeDalphSelection: Effect.Effect<typeof AuthoredCassetteStoryItem.cases.DalphSelects.Type, CursorFailure>
  readonly consumeExecutorReport: Effect.Effect<
    typeof AuthoredCassetteStoryItem.cases.PlannedAttemptExecutorWorkReported.Type,
    CursorFailure
  >
  readonly consumeInitialPolicy: Effect.Effect<
    typeof AuthoredCassetteStoryItem.cases.InitialControlPolicy.Type,
    CursorFailure
  >
  readonly consumeRunCoordinator: Effect.Effect<
    typeof AuthoredCassetteStoryItem.cases.RunCoordinator.Type,
    CursorFailure
  >
  readonly consumeTaskWorkSpecification: Effect.Effect<
    typeof AuthoredCassetteStoryItem.cases.TaskWorkSpecificationReadReturned.Type,
    CursorFailure
  >
  readonly consumeTerminalAssertions: Effect.Effect<
    typeof AuthoredCassetteStoryItem.cases.ExpectedBehavior.Type,
    CursorFailure
  >
  readonly consumeTrackerGraph: Effect.Effect<AuthoredTrackerGraphReadResult, CursorFailure>
}

export const makeStoryCursor = Effect.fn("AuthoredCassette.makeStoryCursor")(function* (
  story: ReadonlyArray<StoryItem>
): Effect.fn.Return<StoryCursor> {
  const position = yield* Ref.make(0)
  const consume = (tag: StoryItem["_tag"]) =>
    Effect.gen(function* () {
      const index = yield* Ref.get(position)
      const item = story[index]
      if (item?._tag !== tag) {
        return yield* new AuthoredCassetteInteractionMismatch({
          actual: tag,
          /* v8 ignore next -- The terminal assertion item keeps a decoded story non-empty until execution ends. */
          expected: item?._tag ?? "EndOfStory",
          storyPosition: index
        })
      }
      yield* Ref.set(position, index + 1)
      return item
    })
  const consumeDalphSelection = consume("DalphSelects").pipe(
    Effect.flatMap((item) =>
      Schema.decodeUnknownEffect(AuthoredCassetteStoryItem.cases.DalphSelects)(item).pipe(Effect.orDie)
    )
  )
  const consumeExecutorReport = consume("PlannedAttemptExecutorWorkReported").pipe(
    Effect.flatMap((item) =>
      Schema.decodeUnknownEffect(AuthoredCassetteStoryItem.cases.PlannedAttemptExecutorWorkReported)(item).pipe(
        Effect.orDie
      )
    )
  )
  const consumeInitialPolicy = consume("InitialControlPolicy").pipe(
    Effect.flatMap((item) =>
      Schema.decodeUnknownEffect(AuthoredCassetteStoryItem.cases.InitialControlPolicy)(item).pipe(Effect.orDie)
    )
  )
  const consumeCapacityChange = Effect.gen(function* () {
    const index = yield* Ref.get(position)
    const item = story[index]
    if (item?._tag !== "SetTaskExecutionCapacity") return Option.none()
    yield* Ref.set(position, index + 1)
    return Option.some(
      yield* Schema.decodeUnknownEffect(AuthoredCassetteStoryItem.cases.SetTaskExecutionCapacity)(item).pipe(
        Effect.orDie
      )
    )
  })
  const consumeRunCoordinator = consume("RunCoordinator").pipe(
    Effect.flatMap((item) =>
      Schema.decodeUnknownEffect(AuthoredCassetteStoryItem.cases.RunCoordinator)(item).pipe(Effect.orDie)
    )
  )
  const consumeTaskWorkSpecification = consume("TaskWorkSpecificationReadReturned").pipe(
    Effect.flatMap((item) =>
      Schema.decodeUnknownEffect(AuthoredCassetteStoryItem.cases.TaskWorkSpecificationReadReturned)(item).pipe(
        Effect.orDie
      )
    )
  )
  const consumeTerminalAssertions = consume("ExpectedBehavior").pipe(
    Effect.flatMap((item) =>
      Schema.decodeUnknownEffect(AuthoredCassetteStoryItem.cases.ExpectedBehavior)(item).pipe(Effect.orDie)
    )
  )
  const consumeTrackerGraph = Effect.gen(function* () {
    const index = yield* Ref.get(position)
    const item = story[index]
    if (item?._tag !== "TrackerGraphReadFailed" && item?._tag !== "TrackerGraphReadReturned") {
      return yield* new AuthoredCassetteInteractionMismatch({
        actual: "TrackerGraphReadFailed | TrackerGraphReadReturned",
        /* v8 ignore next -- A decoded story retains its terminal assertion after any graph interaction. */
        expected: item?._tag ?? "EndOfStory",
        storyPosition: index
      })
    }
    yield* Ref.set(position, index + 1)
    return yield* Schema.decodeUnknownEffect(AuthoredTrackerGraphReadResult)(item).pipe(Effect.orDie)
  })
  return {
    consumeCapacityChange,
    consumeDalphSelection,
    consumeExecutorReport,
    consumeInitialPolicy,
    consumeRunCoordinator,
    consumeTaskWorkSpecification,
    consumeTerminalAssertions,
    consumeTrackerGraph
  }
})
