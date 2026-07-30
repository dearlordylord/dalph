import { Effect, Ref, Schema } from "effect"
import { AuthoredCassetteStoryItem, type AuthoredCassetteStoryItem as StoryItem } from "./authored-domain.js"

export class AuthoredCassetteInteractionMismatch extends Schema.TaggedErrorClass<AuthoredCassetteInteractionMismatch>()(
  "AuthoredCassetteInteractionMismatch",
  { actual: Schema.String, expected: Schema.String, storyPosition: Schema.Int }
) {}

export class UnsupportedAuthoredCapacityChange extends Schema.TaggedErrorClass<UnsupportedAuthoredCapacityChange>()(
  "UnsupportedAuthoredCapacityChange",
  { storyPosition: Schema.Int }
) {}

type CursorFailure = AuthoredCassetteInteractionMismatch | UnsupportedAuthoredCapacityChange

export interface StoryCursor {
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
  readonly consumeTrackerGraph: Effect.Effect<
    typeof AuthoredCassetteStoryItem.cases.TrackerGraphReadReturned.Type,
    CursorFailure
  >
}

export const makeStoryCursor = Effect.fn("AuthoredCassette.makeStoryCursor")(function* (
  story: ReadonlyArray<StoryItem>
): Effect.fn.Return<StoryCursor> {
  const position = yield* Ref.make(0)
  const consume = (tag: StoryItem["_tag"]) =>
    Effect.gen(function* () {
      const index = yield* Ref.get(position)
      const item = story[index]
      if (item?._tag === "SetTaskExecutionCapacity") {
        return yield* new UnsupportedAuthoredCapacityChange({ storyPosition: index })
      }
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
  const consumeTrackerGraph = consume("TrackerGraphReadReturned").pipe(
    Effect.flatMap((item) =>
      Schema.decodeUnknownEffect(AuthoredCassetteStoryItem.cases.TrackerGraphReadReturned)(item).pipe(Effect.orDie)
    )
  )
  return {
    consumeDalphSelection,
    consumeExecutorReport,
    consumeInitialPolicy,
    consumeRunCoordinator,
    consumeTaskWorkSpecification,
    consumeTerminalAssertions,
    consumeTrackerGraph
  }
})
