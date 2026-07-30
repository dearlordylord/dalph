import { Deferred, Effect, Option, Ref, Schema } from "effect"
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
type ClaimedStoryItem<A extends StoryItem> =
  | { readonly _tag: "Claimed"; readonly index: number; readonly item: A }
  | { readonly _tag: "Mismatch"; readonly index: number; readonly item: StoryItem | undefined }
type AuthoredTaskClaimReadItem =
  | typeof AuthoredCassetteStoryItem.cases.TaskClaimReadFailed.Type
  | typeof AuthoredCassetteStoryItem.cases.TaskClaimCurrentReadReturned.Type
  | typeof AuthoredCassetteStoryItem.cases.TaskClaimReadReturned.Type

const AuthoredTaskClaimReadItem = Schema.Union([
  AuthoredCassetteStoryItem.cases.TaskClaimReadFailed,
  AuthoredCassetteStoryItem.cases.TaskClaimCurrentReadReturned,
  AuthoredCassetteStoryItem.cases.TaskClaimReadReturned
])

const isTaskClaimReadItem = (item: StoryItem | undefined): item is AuthoredTaskClaimReadItem =>
  item?._tag === "TaskClaimReadFailed" ||
  item?._tag === "TaskClaimCurrentReadReturned" ||
  item?._tag === "TaskClaimReadReturned"

export interface StoryCursor {
  readonly awaitCoordinatorProcessDeath: Effect.Effect<
    typeof AuthoredCassetteStoryItem.cases.CoordinatorProcessDies.Type
  >
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
  readonly consumeClaimReacquisitionRequest: Effect.Effect<
    Option.Option<typeof AuthoredCassetteStoryItem.cases.OperatorRequestsTaskClaimReacquisition.Type>
  >
  readonly consumeRunCoordinator: Effect.Effect<
    typeof AuthoredCassetteStoryItem.cases.RunCoordinator.Type,
    CursorFailure
  >
  readonly consumeTaskWorkSpecification: Effect.Effect<
    typeof AuthoredCassetteStoryItem.cases.TaskWorkSpecificationReadReturned.Type,
    CursorFailure
  >
  readonly consumeTaskClaimRead: Effect.Effect<
    Option.Option<
      | typeof AuthoredCassetteStoryItem.cases.TaskClaimReadFailed.Type
      | typeof AuthoredCassetteStoryItem.cases.TaskClaimCurrentReadReturned.Type
      | typeof AuthoredCassetteStoryItem.cases.TaskClaimReadReturned.Type
    >
  >
  readonly consumeTerminalAssertions: Effect.Effect<
    typeof AuthoredCassetteStoryItem.cases.ExpectedBehavior.Type,
    CursorFailure
  >
  readonly consumeTrackerGraph: Effect.Effect<AuthoredTrackerGraphReadResult, CursorFailure>
  readonly pauseAtCoordinatorProcessDeath: Effect.Effect<void>
}

export const makeStoryCursor = Effect.fn("AuthoredCassette.makeStoryCursor")(function* (
  story: ReadonlyArray<StoryItem>
): Effect.fn.Return<StoryCursor> {
  const position = yield* Ref.make(0)
  const coordinatorProcessDeath =
    yield* Deferred.make<typeof AuthoredCassetteStoryItem.cases.CoordinatorProcessDies.Type>()
  const claimNext = <A extends StoryItem>(
    predicate: (item: StoryItem | undefined) => item is A
  ): Effect.Effect<ClaimedStoryItem<A>> =>
    Ref.modify(position, (index): readonly [ClaimedStoryItem<A>, number] => {
      const item = story[index]
      return predicate(item)
        ? [{ _tag: "Claimed" as const, index, item }, index + 1]
        : [{ _tag: "Mismatch" as const, index, item }, index]
    })
  const consume = (tag: StoryItem["_tag"]) =>
    Effect.gen(function* () {
      const claimed = yield* claimNext((item): item is StoryItem => item?._tag === tag)
      if (claimed._tag === "Mismatch") {
        return yield* new AuthoredCassetteInteractionMismatch({
          actual: tag,
          /* v8 ignore next -- The terminal assertion item keeps a decoded story non-empty until execution ends. */
          expected: claimed.item?._tag ?? "EndOfStory",
          storyPosition: claimed.index
        })
      }
      return claimed.item
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
    const claimed = yield* claimNext(
      (item): item is typeof AuthoredCassetteStoryItem.cases.SetTaskExecutionCapacity.Type =>
        item?._tag === "SetTaskExecutionCapacity"
    )
    if (claimed._tag === "Mismatch") return Option.none()
    return Option.some(
      yield* Schema.decodeUnknownEffect(AuthoredCassetteStoryItem.cases.SetTaskExecutionCapacity)(claimed.item).pipe(
        Effect.orDie
      )
    )
  })
  const consumeClaimReacquisitionRequest = Effect.gen(function* () {
    const claimed = yield* claimNext(
      (item): item is typeof AuthoredCassetteStoryItem.cases.OperatorRequestsTaskClaimReacquisition.Type =>
        item?._tag === "OperatorRequestsTaskClaimReacquisition"
    )
    if (claimed._tag === "Mismatch") return Option.none()
    return Option.some(
      yield* Schema.decodeUnknownEffect(AuthoredCassetteStoryItem.cases.OperatorRequestsTaskClaimReacquisition)(
        claimed.item
      ).pipe(Effect.orDie)
    )
  })
  const pauseAtCoordinatorProcessDeath = Effect.gen(function* () {
    const claimed = yield* claimNext(
      (item): item is typeof AuthoredCassetteStoryItem.cases.CoordinatorProcessDies.Type =>
        item?._tag === "CoordinatorProcessDies"
    )
    if (claimed._tag === "Mismatch") return
    const decoded = yield* Schema.decodeUnknownEffect(AuthoredCassetteStoryItem.cases.CoordinatorProcessDies)(
      claimed.item
    ).pipe(Effect.orDie)
    yield* Deferred.succeed(coordinatorProcessDeath, decoded)
    return yield* Effect.never
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
  const consumeTaskClaimRead = Effect.gen(function* () {
    const claimed = yield* claimNext(isTaskClaimReadItem)
    if (claimed._tag === "Mismatch") return Option.none()
    return Option.some(yield* Schema.decodeUnknownEffect(AuthoredTaskClaimReadItem)(claimed.item).pipe(Effect.orDie))
  })
  const consumeTerminalAssertions = consume("ExpectedBehavior").pipe(
    Effect.flatMap((item) =>
      Schema.decodeUnknownEffect(AuthoredCassetteStoryItem.cases.ExpectedBehavior)(item).pipe(Effect.orDie)
    )
  )
  const consumeTrackerGraph = Effect.gen(function* () {
    const claimed = yield* claimNext(
      (item): item is AuthoredTrackerGraphReadResult =>
        item?._tag === "TrackerGraphReadFailed" || item?._tag === "TrackerGraphReadReturned"
    )
    if (claimed._tag === "Mismatch") {
      return yield* new AuthoredCassetteInteractionMismatch({
        actual: "TrackerGraphReadFailed | TrackerGraphReadReturned",
        /* v8 ignore next -- A decoded story retains its terminal assertion after any graph interaction. */
        expected: claimed.item?._tag ?? "EndOfStory",
        storyPosition: claimed.index
      })
    }
    return yield* Schema.decodeUnknownEffect(AuthoredTrackerGraphReadResult)(claimed.item).pipe(Effect.orDie)
  })
  return {
    awaitCoordinatorProcessDeath: Deferred.await(coordinatorProcessDeath),
    consumeCapacityChange,
    consumeClaimReacquisitionRequest,
    consumeDalphSelection,
    consumeExecutorReport,
    consumeInitialPolicy,
    consumeRunCoordinator,
    consumeTaskClaimRead,
    consumeTaskWorkSpecification,
    consumeTerminalAssertions,
    consumeTrackerGraph,
    pauseAtCoordinatorProcessDeath
  }
})
