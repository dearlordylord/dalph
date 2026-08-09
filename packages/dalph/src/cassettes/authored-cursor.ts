/* eslint-disable max-lines -- One cursor atomically owns every authored story interaction and optional boundary probe. */
import { Deferred, Effect, Option, Queue, Schema, Stream, SubscriptionRef } from "effect"
import {
  AuthoredCassetteStoryItem,
  type AuthoredCassetteStoryItem as StoryItem,
  AuthoredTrackerGraphReadResult
} from "./authored-domain.js"
import {
  AuthoredAttemptChoiceItem,
  AuthoredPlannedAttemptExecutorOutcomeItem,
  AuthoredTaskClaimReadItem,
  isAuthoredPlannedAttemptExecutorOutcomeItem,
  isAuthoredAttemptChoiceItem,
  isTaskClaimReadItem,
  type AuthoredAttemptChoiceItem as AttemptChoiceItem
} from "./authored-cursor-items.js"

export class AuthoredCassetteInteractionMismatch extends Schema.TaggedErrorClass<AuthoredCassetteInteractionMismatch>()(
  "AuthoredCassetteInteractionMismatch",
  { actual: Schema.String, expected: Schema.String, storyPosition: Schema.Int }
) {}

export class AuthoredIntegrationCandidateGitValidationFailure extends Schema.TaggedErrorClass<AuthoredIntegrationCandidateGitValidationFailure>()(
  "AuthoredIntegrationCandidateGitValidationFailure",
  { detail: Schema.String, storyPosition: Schema.Int }
) {}

export class AuthoredTargetPromotionCompareAndSetFailure extends Schema.TaggedErrorClass<AuthoredTargetPromotionCompareAndSetFailure>()(
  "AuthoredTargetPromotionCompareAndSetFailure",
  { detail: Schema.String, storyPosition: Schema.Int }
) {}

export class AuthoredTargetPromotionGitReadFailure extends Schema.TaggedErrorClass<AuthoredTargetPromotionGitReadFailure>()(
  "AuthoredTargetPromotionGitReadFailure",
  { detail: Schema.String, storyPosition: Schema.Int }
) {}

type CursorFailure = AuthoredCassetteInteractionMismatch
type ClaimedStoryItem<A extends StoryItem> =
  | { readonly _tag: "Claimed"; readonly index: number; readonly item: A }
  | { readonly _tag: "Mismatch"; readonly index: number; readonly item: StoryItem | undefined }
export interface StoryCursor {
  readonly atTerminalAssertions: Effect.Effect<boolean>
  readonly awaitTerminalAssertions: Effect.Effect<void>
  readonly awaitCoordinatorProcessDeath: Effect.Effect<
    typeof AuthoredCassetteStoryItem.cases.CoordinatorProcessDies.Type
  >
  readonly consumeCoordinatorActivationReturned: Effect.Effect<
    typeof AuthoredCassetteStoryItem.cases.CoordinatorActivationReturned.Type,
    CursorFailure
  >
  readonly consumeAdmittedContinuationExecutorIntentHold: Effect.Effect<
    Option.Option<typeof AuthoredCassetteStoryItem.cases.DalphHoldsAdmittedContinuationBeforeExecutorIntent.Type>
  >
  readonly consumeCapacityChange: Effect.Effect<
    Option.Option<typeof AuthoredCassetteStoryItem.cases.SetTaskExecutionCapacity.Type>
  >
  readonly consumeAttemptChoice: Effect.Effect<Option.Option<AttemptChoiceItem>>
  readonly consumeDalphSelection: Effect.Effect<typeof AuthoredCassetteStoryItem.cases.DalphSelects.Type, CursorFailure>
  readonly consumeExecutorReport: Effect.Effect<AuthoredPlannedAttemptExecutorOutcomeItem, CursorFailure>
  readonly consumeExecutorProjection: Effect.Effect<
    Option.Option<typeof AuthoredCassetteStoryItem.cases.PlannedAttemptExecutorProjectionReturned.Type>
  >
  readonly consumeGitWorktreeObservationChange: Effect.Effect<
    Option.Option<typeof AuthoredCassetteStoryItem.cases.GitWorktreeObservationChanged.Type>
  >
  readonly consumeInitialPolicy: Effect.Effect<
    typeof AuthoredCassetteStoryItem.cases.InitialControlPolicy.Type,
    CursorFailure
  >
  readonly consumeIntegrationCandidateAgentReport: Effect.Effect<
    Option.Option<typeof AuthoredCassetteStoryItem.cases.IntegrationCandidateAgentReported.Type>
  >
  readonly consumeIntegrationCandidateGitValidation: Effect.Effect<
    typeof AuthoredCassetteStoryItem.cases.IntegrationCandidateGitValidationReturned.Type,
    CursorFailure | AuthoredIntegrationCandidateGitValidationFailure
  >
  readonly consumeTargetVerificationReturned: Effect.Effect<
    typeof AuthoredCassetteStoryItem.cases.TargetVerificationReturned.Type,
    CursorFailure
  >
  readonly consumeTargetPromotionCompareAndSet: Effect.Effect<
    typeof AuthoredCassetteStoryItem.cases.TargetPromotionCompareAndSetReturned.Type,
    CursorFailure | AuthoredTargetPromotionCompareAndSetFailure
  >
  readonly consumeTargetPromotionGitRead: Effect.Effect<
    typeof AuthoredCassetteStoryItem.cases.TargetPromotionGitReadReturned.Type,
    CursorFailure | AuthoredTargetPromotionGitReadFailure
  >
  readonly consumeControlDirection: Effect.Effect<
    Option.Option<typeof AuthoredCassetteStoryItem.cases.OperatorAppliesControlDirection.Type>
  >
  readonly consumeControlDirectionFailure: Effect.Effect<
    Option.Option<typeof AuthoredCassetteStoryItem.cases.OperatorControlDirectionFailed.Type>
  >
  readonly consumeInFlightExecutorControlDirection: Effect.Effect<
    Option.Option<
      typeof AuthoredCassetteStoryItem.cases.OperatorAppliesControlDirectionWhileExecutorRequestInFlight.Type
    >
  >
  readonly consumeClaimReacquisitionDirection: Effect.Effect<
    Option.Option<typeof AuthoredCassetteStoryItem.cases.OperatorDirectsTaskClaimReacquisition.Type>
  >
  readonly consumeAttemptChoiceRace: Effect.Effect<
    Option.Option<typeof AuthoredCassetteStoryItem.cases.OperatorRacesContinueAndStop.Type>
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
  readonly consumeTaskClaimReleaseResponseLost: Effect.Effect<
    Option.Option<typeof AuthoredCassetteStoryItem.cases.TaskClaimReleaseResponseLost.Type>
  >
  readonly consumeTerminalAssertions: Effect.Effect<
    typeof AuthoredCassetteStoryItem.cases.ExpectedBehavior.Type,
    CursorFailure
  >
  readonly consumeTrackerGraph: Effect.Effect<AuthoredTrackerGraphReadResult, CursorFailure>
  readonly pauseAtCoordinatorProcessDeath: Effect.Effect<void>
  /** Test-driver view of the next authored boundary; observing it never advances the story. */
  readonly storyItems: Stream.Stream<StoryItem | undefined>
}

export const makeStoryCursor = Effect.fn("AuthoredCassette.makeStoryCursor")(function* (
  story: ReadonlyArray<StoryItem>
): Effect.fn.Return<StoryCursor> {
  const position = yield* SubscriptionRef.make(0)
  const coordinatorProcessDeaths =
    yield* Queue.unbounded<typeof AuthoredCassetteStoryItem.cases.CoordinatorProcessDies.Type>()
  const terminalAssertionsReached = yield* Deferred.make<void>()
  const claimNext = <A extends StoryItem>(
    predicate: (item: StoryItem | undefined) => item is A
  ): Effect.Effect<ClaimedStoryItem<A>> =>
    SubscriptionRef.modify(position, (index): readonly [ClaimedStoryItem<A>, number] => {
      const item = story[index]
      return predicate(item)
        ? [{ _tag: "Claimed" as const, index, item }, index + 1]
        : [{ _tag: "Mismatch" as const, index, item }, index]
    }).pipe(
      Effect.tap(() =>
        SubscriptionRef.get(position).pipe(
          Effect.flatMap((index) =>
            story[index]?._tag === "ExpectedBehavior"
              ? Deferred.succeed(terminalAssertionsReached, undefined)
              : Effect.void
          )
        )
      )
    )
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
  const consumeCoordinatorActivationReturned = consume("CoordinatorActivationReturned").pipe(
    Effect.flatMap((item) =>
      Schema.decodeUnknownEffect(AuthoredCassetteStoryItem.cases.CoordinatorActivationReturned)(item).pipe(Effect.orDie)
    )
  )
  const consumeAdmittedContinuationExecutorIntentHold = Effect.gen(function* () {
    const claimed = yield* claimNext(
      (item): item is typeof AuthoredCassetteStoryItem.cases.DalphHoldsAdmittedContinuationBeforeExecutorIntent.Type =>
        item?._tag === "DalphHoldsAdmittedContinuationBeforeExecutorIntent"
    )
    if (claimed._tag === "Mismatch") return Option.none()
    return Option.some(
      yield* Schema.decodeUnknownEffect(
        AuthoredCassetteStoryItem.cases.DalphHoldsAdmittedContinuationBeforeExecutorIntent
      )(claimed.item).pipe(Effect.orDie)
    )
  })
  const consumeExecutorReport = Effect.gen(function* () {
    const claimed = yield* claimNext(isAuthoredPlannedAttemptExecutorOutcomeItem)
    if (claimed._tag === "Mismatch") {
      return yield* new AuthoredCassetteInteractionMismatch({
        actual: "PlannedAttemptExecutorResponseLost | PlannedAttemptExecutorWorkReported",
        expected: claimed.item?._tag ?? "EndOfStory",
        storyPosition: claimed.index
      })
    }
    return yield* Schema.decodeUnknownEffect(AuthoredPlannedAttemptExecutorOutcomeItem)(claimed.item).pipe(Effect.orDie)
  })
  const consumeExecutorProjection = Effect.gen(function* () {
    const claimed = yield* claimNext(
      (item): item is typeof AuthoredCassetteStoryItem.cases.PlannedAttemptExecutorProjectionReturned.Type =>
        item?._tag === "PlannedAttemptExecutorProjectionReturned"
    )
    if (claimed._tag === "Mismatch") return Option.none()
    return Option.some(
      yield* Schema.decodeUnknownEffect(AuthoredCassetteStoryItem.cases.PlannedAttemptExecutorProjectionReturned)(
        claimed.item
      ).pipe(Effect.orDie)
    )
  })
  const consumeInitialPolicy = consume("InitialControlPolicy").pipe(
    Effect.flatMap((item) =>
      Schema.decodeUnknownEffect(AuthoredCassetteStoryItem.cases.InitialControlPolicy)(item).pipe(Effect.orDie)
    )
  )
  const consumeIntegrationCandidateAgentReport = Effect.gen(function* () {
    const claimed = yield* claimNext(
      (item): item is typeof AuthoredCassetteStoryItem.cases.IntegrationCandidateAgentReported.Type =>
        item?._tag === "IntegrationCandidateAgentReported"
    )
    /* v8 ignore next -- @preserve Candidate-report absence is an optional probe; maintained candidate stories exercise reports and the runner exercises the no-report outcome. */
    return claimed._tag === "Mismatch"
      ? Option.none()
      : Option.some(
          yield* Schema.decodeUnknownEffect(AuthoredCassetteStoryItem.cases.IntegrationCandidateAgentReported)(
            claimed.item
          ).pipe(Effect.orDie)
        )
  })
  const consumeIntegrationCandidateGitValidation = Effect.gen(function* () {
    const claimed = yield* claimNext(
      (
        item
      ): item is
        | typeof AuthoredCassetteStoryItem.cases.IntegrationCandidateGitValidationFailed.Type
        | typeof AuthoredCassetteStoryItem.cases.IntegrationCandidateGitValidationReturned.Type =>
        item?._tag === "IntegrationCandidateGitValidationFailed" ||
        item?._tag === "IntegrationCandidateGitValidationReturned"
    )
    /* v8 ignore next -- @preserve Candidate Git mismatch uses the same claimNext mismatch projection exercised by other authored boundaries. */
    if (claimed._tag === "Mismatch") {
      return yield* new AuthoredCassetteInteractionMismatch({
        actual: "IntegrationCandidateGitValidationFailed | IntegrationCandidateGitValidationReturned",
        expected: claimed.item?._tag ?? "EndOfStory",
        storyPosition: claimed.index
      })
    }
    if (claimed.item._tag === "IntegrationCandidateGitValidationFailed") {
      return yield* new AuthoredIntegrationCandidateGitValidationFailure({
        detail: claimed.item.detail,
        storyPosition: claimed.index
      })
    }
    return claimed.item
  })
  const consumeTargetVerificationReturned = consume("TargetVerificationReturned").pipe(
    Effect.flatMap((item) =>
      Schema.decodeUnknownEffect(AuthoredCassetteStoryItem.cases.TargetVerificationReturned)(item).pipe(Effect.orDie)
    )
  )
  /* v8 ignore start -- @preserve Maintained promotion cassettes cover returned, lost, and unreadable outcomes; generic authored-boundary mismatch projection is exercised by the shared cursor tests. */
  const consumeTargetPromotionCompareAndSet = Effect.gen(function* () {
    const claimed = yield* claimNext(
      (
        item
      ): item is
        | typeof AuthoredCassetteStoryItem.cases.TargetPromotionCompareAndSetReturned.Type
        | typeof AuthoredCassetteStoryItem.cases.TargetPromotionCompareAndSetResponseLost.Type =>
        item?._tag === "TargetPromotionCompareAndSetReturned" ||
        item?._tag === "TargetPromotionCompareAndSetResponseLost"
    )
    if (claimed._tag === "Mismatch") {
      return yield* new AuthoredCassetteInteractionMismatch({
        actual: "TargetPromotionCompareAndSetReturned | TargetPromotionCompareAndSetResponseLost",
        expected: claimed.item?._tag ?? "EndOfStory",
        storyPosition: claimed.index
      })
    }
    if (claimed.item._tag === "TargetPromotionCompareAndSetResponseLost") {
      return yield* new AuthoredTargetPromotionCompareAndSetFailure({
        detail: claimed.item.detail,
        storyPosition: claimed.index
      })
    }
    return claimed.item
  })
  const consumeTargetPromotionGitRead = Effect.gen(function* () {
    const claimed = yield* claimNext(
      (
        item
      ): item is
        | typeof AuthoredCassetteStoryItem.cases.TargetPromotionGitReadReturned.Type
        | typeof AuthoredCassetteStoryItem.cases.TargetPromotionGitReadFailed.Type =>
        item?._tag === "TargetPromotionGitReadReturned" || item?._tag === "TargetPromotionGitReadFailed"
    )
    if (claimed._tag === "Mismatch") {
      return yield* new AuthoredCassetteInteractionMismatch({
        actual: "TargetPromotionGitReadReturned | TargetPromotionGitReadFailed",
        expected: claimed.item?._tag ?? "EndOfStory",
        storyPosition: claimed.index
      })
    }
    if (claimed.item._tag === "TargetPromotionGitReadFailed") {
      return yield* new AuthoredTargetPromotionGitReadFailure({
        detail: claimed.item.detail,
        storyPosition: claimed.index
      })
    }
    return claimed.item
  })
  /* v8 ignore stop -- @preserve */
  const atTerminalAssertions = SubscriptionRef.get(position).pipe(
    Effect.map((index) => story[index]?._tag === "ExpectedBehavior")
  )
  const consumeCapacityChange = Effect.gen(function* () {
    const claimed = yield* claimNext(
      (item): item is typeof AuthoredCassetteStoryItem.cases.SetTaskExecutionCapacity.Type =>
        item?._tag === "SetTaskExecutionCapacity"
    )
    /* v8 ignore next -- @preserve Capacity changes are optional story probes; accepted maintained stories exercise the applied-change path and the unchanged policy is covered at startup. */
    if (claimed._tag === "Mismatch") return Option.none()
    return Option.some(
      yield* Schema.decodeUnknownEffect(AuthoredCassetteStoryItem.cases.SetTaskExecutionCapacity)(claimed.item).pipe(
        Effect.orDie
      )
    )
  })
  const consumeAttemptChoice = Effect.gen(function* () {
    const claimed = yield* claimNext(isAuthoredAttemptChoiceItem)
    if (claimed._tag === "Mismatch") return Option.none()
    return Option.some(yield* Schema.decodeUnknownEffect(AuthoredAttemptChoiceItem)(claimed.item).pipe(Effect.orDie))
  })
  const consumeAttemptChoiceRace = Effect.gen(function* () {
    const claimed = yield* claimNext(
      (item): item is typeof AuthoredCassetteStoryItem.cases.OperatorRacesContinueAndStop.Type =>
        item?._tag === "OperatorRacesContinueAndStop"
    )
    if (claimed._tag === "Mismatch") return Option.none()
    return Option.some(
      yield* Schema.decodeUnknownEffect(AuthoredCassetteStoryItem.cases.OperatorRacesContinueAndStop)(
        claimed.item
      ).pipe(Effect.orDie)
    )
  })
  const consumeControlDirection = Effect.gen(function* () {
    const claimed = yield* claimNext(
      (item): item is typeof AuthoredCassetteStoryItem.cases.OperatorAppliesControlDirection.Type =>
        item?._tag === "OperatorAppliesControlDirection"
    )
    /* v8 ignore next -- @preserve Operator directions are optional story probes; maintained control stories exercise the request path and ordinary stories exercise absence through the runner. */
    if (claimed._tag === "Mismatch") return Option.none()
    return Option.some(
      yield* Schema.decodeUnknownEffect(AuthoredCassetteStoryItem.cases.OperatorAppliesControlDirection)(
        claimed.item
      ).pipe(Effect.orDie)
    )
  })
  const consumeControlDirectionFailure = Effect.gen(function* () {
    const claimed = yield* claimNext(
      (item): item is typeof AuthoredCassetteStoryItem.cases.OperatorControlDirectionFailed.Type =>
        item?._tag === "OperatorControlDirectionFailed"
    )
    /* v8 ignore next -- @preserve A maintained failed-control chronology always follows its request with the visible failure item. */
    /* v8 ignore next -- @preserve Claim-reacquisition directions are optional story probes; maintained reacquisition stories exercise requests and ordinary stories exercise absence through the runner. */
    if (claimed._tag === "Mismatch") return Option.none()
    return Option.some(
      yield* Schema.decodeUnknownEffect(AuthoredCassetteStoryItem.cases.OperatorControlDirectionFailed)(
        claimed.item
      ).pipe(Effect.orDie)
    )
  })
  const consumeInFlightExecutorControlDirection = Effect.gen(function* () {
    const claimed = yield* claimNext(
      (
        item
      ): item is typeof AuthoredCassetteStoryItem.cases.OperatorAppliesControlDirectionWhileExecutorRequestInFlight.Type =>
        item?._tag === "OperatorAppliesControlDirectionWhileExecutorRequestInFlight"
    )
    if (claimed._tag === "Mismatch") return Option.none()
    return Option.some(
      yield* Schema.decodeUnknownEffect(
        AuthoredCassetteStoryItem.cases.OperatorAppliesControlDirectionWhileExecutorRequestInFlight
      )(claimed.item).pipe(Effect.orDie)
    )
  })
  const consumeClaimReacquisitionDirection = Effect.gen(function* () {
    const claimed = yield* claimNext(
      (item): item is typeof AuthoredCassetteStoryItem.cases.OperatorDirectsTaskClaimReacquisition.Type =>
        item?._tag === "OperatorDirectsTaskClaimReacquisition"
    )
    /* v8 ignore next -- @preserve Claim-reacquisition directions are optional story probes; maintained reacquisition stories exercise requests and ordinary stories exercise absence through the runner. */
    if (claimed._tag === "Mismatch") return Option.none()
    return Option.some(
      yield* Schema.decodeUnknownEffect(AuthoredCassetteStoryItem.cases.OperatorDirectsTaskClaimReacquisition)(
        claimed.item
      ).pipe(Effect.orDie)
    )
  })
  const consumeGitWorktreeObservationChange = Effect.gen(function* () {
    const claimed = yield* claimNext(
      (item): item is typeof AuthoredCassetteStoryItem.cases.GitWorktreeObservationChanged.Type =>
        item?._tag === "GitWorktreeObservationChanged"
    )
    if (claimed._tag === "Mismatch") return Option.none()
    return Option.some(
      yield* Schema.decodeUnknownEffect(AuthoredCassetteStoryItem.cases.GitWorktreeObservationChanged)(
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
    yield* Queue.offer(coordinatorProcessDeaths, decoded)
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
  const consumeTaskClaimReleaseResponseLost = Effect.gen(function* () {
    const claimed = yield* claimNext(
      (item): item is typeof AuthoredCassetteStoryItem.cases.TaskClaimReleaseResponseLost.Type =>
        item?._tag === "TaskClaimReleaseResponseLost"
    )
    if (claimed._tag === "Mismatch") return Option.none()
    return Option.some(
      yield* Schema.decodeUnknownEffect(AuthoredCassetteStoryItem.cases.TaskClaimReleaseResponseLost)(
        claimed.item
      ).pipe(Effect.orDie)
    )
  })
  const consumeTerminalAssertions = consume("ExpectedBehavior").pipe(
    Effect.flatMap((item) =>
      Schema.decodeUnknownEffect(AuthoredCassetteStoryItem.cases.ExpectedBehavior)(item).pipe(Effect.orDie)
    )
  )
  const consumeTrackerGraph = Effect.gen(function* () {
    const claimed = yield* claimNext(
      (item): item is AuthoredTrackerGraphReadResult =>
        item?._tag === "TrackerGraphReadFailed" ||
        item?._tag === "TrackerGraphReadReturned" ||
        item?._tag === "RunActivationFinalTrackerGraphReadReturned"
    )
    if (claimed._tag === "Mismatch") {
      return yield* new AuthoredCassetteInteractionMismatch({
        actual: "TrackerGraphReadFailed | TrackerGraphReadReturned | RunActivationFinalTrackerGraphReadReturned",
        /* v8 ignore next -- A decoded story retains its terminal assertion after any graph interaction. */
        expected: claimed.item?._tag ?? "EndOfStory",
        storyPosition: claimed.index
      })
    }
    return yield* Schema.decodeUnknownEffect(AuthoredTrackerGraphReadResult)(claimed.item).pipe(Effect.orDie)
  })
  return {
    atTerminalAssertions,
    awaitTerminalAssertions: Deferred.await(terminalAssertionsReached),
    awaitCoordinatorProcessDeath: Queue.take(coordinatorProcessDeaths),
    consumeAdmittedContinuationExecutorIntentHold,
    consumeCoordinatorActivationReturned,
    consumeAttemptChoice,
    consumeAttemptChoiceRace,
    consumeCapacityChange,
    consumeControlDirection,
    consumeControlDirectionFailure,
    consumeInFlightExecutorControlDirection,
    consumeClaimReacquisitionDirection,
    consumeDalphSelection,
    consumeExecutorProjection,
    consumeExecutorReport,
    consumeGitWorktreeObservationChange,
    consumeInitialPolicy,
    consumeIntegrationCandidateAgentReport,
    consumeIntegrationCandidateGitValidation,
    consumeTargetVerificationReturned,
    consumeTargetPromotionCompareAndSet,
    consumeTargetPromotionGitRead,
    consumeRunCoordinator,
    consumeTaskClaimRead,
    consumeTaskClaimReleaseResponseLost,
    consumeTaskWorkSpecification,
    consumeTerminalAssertions,
    consumeTrackerGraph,
    pauseAtCoordinatorProcessDeath,
    storyItems: SubscriptionRef.changes(position).pipe(Stream.map((index) => story[index]))
  }
})
