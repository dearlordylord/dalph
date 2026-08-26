/* eslint-disable max-lines -- One cursor atomically owns every authored story interaction and optional boundary probe. */
import { Deferred, Effect, Option, Ref, Schema, Stream, SubscriptionRef } from "effect"
import type { AttemptId, GitCommitSha, GitRepositoryLocator, TaskId } from "@dalph/contracts"
import { IntegratorSessionCorrelation, type IntegratorCandidateText } from "@dalph/orchestrator"
import {
  type AuthoredCassetteDecision as CassetteDecision,
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

export class AuthoredCassetteInteractionMismatch extends Schema.TaggedError<AuthoredCassetteInteractionMismatch>()(
  "AuthoredCassetteInteractionMismatch",
  { actual: Schema.String, expected: Schema.String, storyPosition: Schema.Int }
) {}

export class AuthoredIntegratorGitObservationFailure extends Schema.TaggedError<AuthoredIntegratorGitObservationFailure>()(
  "AuthoredIntegratorGitObservationFailure",
  { detail: Schema.String, storyPosition: Schema.Int }
) {}

export class AuthoredTargetPromotionCompareAndSetFailure extends Schema.TaggedError<AuthoredTargetPromotionCompareAndSetFailure>()(
  "AuthoredTargetPromotionCompareAndSetFailure",
  { detail: Schema.String, storyPosition: Schema.Int }
) {}

export class AuthoredTargetPromotionGitReadFailure extends Schema.TaggedError<AuthoredTargetPromotionGitReadFailure>()(
  "AuthoredTargetPromotionGitReadFailure",
  { detail: Schema.String, storyPosition: Schema.Int }
) {}

/**
 * A cassette-only lifecycle control. It is raised as an Effect defect so the
 * delivery scope unwinds on the same fiber that reached the authored death
 * item; it is never a workflow error, journal event, or projection input.
 */
export class AuthoredCoordinatorProcessDies extends Schema.TaggedError<AuthoredCoordinatorProcessDies>()(
  "AuthoredCoordinatorProcessDies",
  { storyPosition: Schema.Int }
) {}

type CursorFailure = AuthoredCassetteInteractionMismatch
type OuterIntegratorGitStoryItem =
  | typeof AuthoredCassetteStoryItem.cases.IntegratorGitObservationFailed.Type
  | typeof AuthoredCassetteStoryItem.cases.IntegratorGitObservationReturned.Type
type AuthoredExecutorRequest = "StartOrContinue" | "Suspend"
type ActiveExecutorReportRequest = { readonly attemptId: AttemptId; readonly request: AuthoredExecutorRequest }
type GitRequestCorrelation = { readonly candidateCommit: GitCommitSha; readonly repository: GitRepositoryLocator }
type PromotionGitStoryItem =
  | typeof AuthoredCassetteStoryItem.cases.TargetPromotionGitReadFailed.Type
  | typeof AuthoredCassetteStoryItem.cases.TargetPromotionGitReadReturned.Type

const gitRequestMatches = (
  request: GitRequestCorrelation,
  repository: GitRepositoryLocator,
  candidateCommit: GitCommitSha
): boolean => request.repository === repository && request.candidateCommit === candidateCommit

const promotionGitStoryItem = (item: StoryItem | undefined): PromotionGitStoryItem | null =>
  item?._tag === "TargetPromotionGitReadFailed" || item?._tag === "TargetPromotionGitReadReturned" ? item : null

const promotionGitStoryItemMatches = (
  item: StoryItem | undefined,
  repository: GitRepositoryLocator,
  candidateCommit: GitCommitSha
): item is PromotionGitStoryItem => {
  const candidate = promotionGitStoryItem(item)
  return candidate !== null && gitRequestMatches(candidate, repository, candidateCommit)
}

const integratorCorrelationEquivalence = Schema.toEquivalence(IntegratorSessionCorrelation)
/** SubscriptionRef.changes replays the current position before later updates, so a completed advance cannot be lost between an ownership signal and this wait. */
const awaitsLaterStoryItem = (position: SubscriptionRef.SubscriptionRef<number>, index: number) =>
  SubscriptionRef.changes(position).pipe(
    Stream.filter((current) => current > index),
    Stream.runHead,
    Effect.asVoid
  )

// A reverse-arriving operation gets a deterministic scheduler window to register
// its exact ownership. A malformed story without that owner fails closed after
// the window instead of retaining a permanently pending cursor fiber.
const authoredOwnershipRegistrationTurns = 8
const authoredFutureSelectionRegistrationTurns = 128

const executorReportRequestMatches = (
  active: ActiveExecutorReportRequest,
  item: AuthoredPlannedAttemptExecutorOutcomeItem
): boolean => active.request === item.request && active.attemptId === item.report.attemptId

const authoredExecutorReportMatches = (
  item: StoryItem | undefined,
  request: AuthoredExecutorRequest,
  attemptId: AttemptId
): item is AuthoredPlannedAttemptExecutorOutcomeItem =>
  isAuthoredPlannedAttemptExecutorOutcomeItem(item) && item.request === request && item.report.attemptId === attemptId

const executorReportImmediatelyBefore = (
  item: StoryItem | undefined,
  next: StoryItem | undefined,
  request: AuthoredExecutorRequest,
  attemptId: AttemptId
): AuthoredPlannedAttemptExecutorOutcomeItem | null =>
  isAuthoredPlannedAttemptExecutorOutcomeItem(item) && authoredExecutorReportMatches(next, request, attemptId)
    ? item
    : null

const authoredDalphSelectionMatches = (
  item: StoryItem | undefined,
  operation: CassetteDecision
): item is typeof AuthoredCassetteStoryItem.cases.DalphSelects.Type =>
  item?._tag === "DalphSelects" && JSON.stringify(item.operation) === JSON.stringify(operation)

const cassetteDecisionMatches = (left: CassetteDecision, right: CassetteDecision): boolean =>
  JSON.stringify(left) === JSON.stringify(right)

const hasLaterAuthoredSelection = (
  story: ReadonlyArray<StoryItem>,
  index: number,
  operation: CassetteDecision
): boolean =>
  story.findIndex(
    (candidate, candidateIndex) => candidateIndex > index && authoredDalphSelectionMatches(candidate, operation)
  ) > index

const isIntegratorRecoverySelection = (operation: CassetteDecision): boolean =>
  operation._tag === "ReadTrackerGraph" || operation._tag === "ReadTaskClaim" || operation._tag === "ReadTargetLineage"

const integratorGitStoryItemMatches = (item: StoryItem | undefined, candidateText: IntegratorCandidateText): boolean =>
  (item?._tag === "IntegratorGitObservationReturned" || item?._tag === "IntegratorGitObservationFailed") &&
  item.candidateText === candidateText

type SelectionPredecessor =
  | { readonly _tag: "ExecutorReport"; readonly item: AuthoredPlannedAttemptExecutorOutcomeItem }
  | { readonly _tag: "IntegratorGit"; readonly candidateText: IntegratorCandidateText }
  | { readonly _tag: "Selection"; readonly operation: CassetteDecision }

const integratorGitSelectionPredecessor = (item: StoryItem | undefined): SelectionPredecessor | null =>
  item?._tag === "IntegratorGitObservationReturned" || item?._tag === "IntegratorGitObservationFailed"
    ? { _tag: "IntegratorGit", candidateText: item.candidateText }
    : null

const selectionPredecessorFor = (
  item: StoryItem | undefined,
  next: StoryItem | undefined,
  requested: CassetteDecision
): SelectionPredecessor | null => {
  if (!authoredDalphSelectionMatches(next, requested)) return null
  if (isAuthoredPlannedAttemptExecutorOutcomeItem(item)) return { _tag: "ExecutorReport", item }
  const integratorGit = integratorGitSelectionPredecessor(item)
  if (integratorGit !== null) return integratorGit
  if (item?._tag === "DalphSelects") return { _tag: "Selection", operation: item.operation }
  return null
}

const selectionCanWaitAfterClaim = (
  item: StoryItem | undefined,
  activeRequests: ReadonlyArray<ActiveExecutorReportRequest>,
  activeIntegratorGitObservations: ReadonlyArray<IntegratorCandidateText>,
  activeSelections: ReadonlyArray<CassetteDecision>
): boolean =>
  item?._tag === "CassetteHoldsTargetPromotionReconciliationReadBeforeBoundary" ||
  (isAuthoredPlannedAttemptExecutorOutcomeItem(item) &&
    activeRequests.some((active) => executorReportRequestMatches(active, item))) ||
  activeIntegratorGitObservations.some((candidateText) => integratorGitStoryItemMatches(item, candidateText)) ||
  (item?._tag === "DalphSelects" &&
    activeSelections.some((selection) => cassetteDecisionMatches(selection, item.operation)))

const expectedSelectionAt = (item: StoryItem | undefined): string => {
  if (item?._tag === "DalphSelects") return JSON.stringify(item.operation)
  if (item?._tag === "ExpectedBehavior") return item._tag
  return item?._tag ?? "EndOfStory"
}

type ClaimedStoryItem<A extends StoryItem> =
  | { readonly _tag: "Claimed"; readonly index: number; readonly item: A }
  | { readonly _tag: "Mismatch"; readonly index: number; readonly item: StoryItem | undefined }
export interface StoryCursor {
  /** Release the exact pre-admission control latch after its production application has completed. */
  readonly completeControlDirectionBeforeDeliveryActionAdmission: Effect.Effect<void>
  /** Current zero-based position after all successfully consumed authored items. */
  readonly storyPosition: Effect.Effect<number>
  /** Current unconsumed authored item for the one sequential harness driver. */
  readonly currentStoryItem: Effect.Effect<StoryItem | undefined>
  /** Waits until the current authored boundary has been consumed by its production adapter. */
  readonly awaitCurrentStoryAdvance: Effect.Effect<void>
  readonly atTerminalAssertions: Effect.Effect<boolean>
  readonly awaitTerminalAssertions: Effect.Effect<void>
  readonly consumeCoordinatorActivationReturned: Effect.Effect<
    typeof AuthoredCassetteStoryItem.cases.CoordinatorActivationReturned.Type,
    CursorFailure
  >
  readonly consumeCompletionClaimDeletionApplied: Effect.Effect<
    typeof AuthoredCassetteStoryItem.cases.CompletionClaimDeletionApplied.Type,
    CursorFailure
  >
  readonly consumeCompletionClaimReadReturned: Effect.Effect<
    typeof AuthoredCassetteStoryItem.cases.CompletionClaimReadReturned.Type,
    CursorFailure
  >
  readonly consumeCompletionClaimReplacementApplied: Effect.Effect<
    typeof AuthoredCassetteStoryItem.cases.CompletionClaimReplacementApplied.Type,
    CursorFailure
  >
  readonly consumeCompletionTaskFocusedReadReturned: Effect.Effect<
    typeof AuthoredCassetteStoryItem.cases.CompletionTaskFocusedReadReturned.Type,
    CursorFailure
  >
  readonly consumeCompletionTaskPrerequisiteReopened: Effect.Effect<
    typeof AuthoredCassetteStoryItem.cases.CompletionTaskPrerequisiteReopened.Type,
    CursorFailure
  >
  readonly consumeCompletionTaskRequestLookupReturned: Effect.Effect<
    typeof AuthoredCassetteStoryItem.cases.CompletionTaskRequestLookupReturned.Type,
    CursorFailure
  >
  readonly consumeCompletionTaskRequestReturned: Effect.Effect<
    typeof AuthoredCassetteStoryItem.cases.CompletionTaskRequestReturned.Type,
    CursorFailure
  >
  readonly consumeAdmittedContinuationExecutorIntentHold: Effect.Effect<
    Option.Option<typeof AuthoredCassetteStoryItem.cases.DalphHoldsAdmittedContinuationBeforeExecutorIntent.Type>
  >
  /** Consume one exact task/attempt Suspend hold before its ready acknowledgement. */
  readonly consumePlannedAttemptSuspensionExecutorBoundaryHold: Effect.Effect<
    Option.Option<
      typeof AuthoredCassetteStoryItem.cases.CassetteHoldsPlannedAttemptSuspensionBeforeExecutorBoundary.Type
    >
  >
  /** Consume one exact wait for a held Suspend to reach its boundary without releasing it. */
  readonly consumePlannedAttemptSuspensionExecutorBoundaryReady: Effect.Effect<
    Option.Option<typeof AuthoredCassetteStoryItem.cases.CassetteAwaitsHeldPlannedAttemptSuspensionBoundary.Type>
  >
  readonly consumePlannedAttemptContinuationExecutorBoundaryHold: Effect.Effect<
    Option.Option<
      typeof AuthoredCassetteStoryItem.cases.CassetteHoldsPlannedAttemptContinuationBeforeExecutorBoundary.Type
    >
  >
  readonly consumePlannedAttemptContinuationExecutorBoundaryRelease: Effect.Effect<
    Option.Option<typeof AuthoredCassetteStoryItem.cases.CassetteReleasesHeldPlannedAttemptContinuation.Type>
  >
  /** Consume the paired exact release; the runner still waits for boundary readiness before opening it. */
  readonly consumePlannedAttemptSuspensionExecutorBoundaryRelease: Effect.Effect<
    Option.Option<typeof AuthoredCassetteStoryItem.cases.CassetteReleasesHeldPlannedAttemptSuspension.Type>
  >
  readonly consumeTargetPromotionReconciliationReadBoundaryHold: Effect.Effect<
    Option.Option<
      typeof AuthoredCassetteStoryItem.cases.CassetteHoldsTargetPromotionReconciliationReadBeforeBoundary.Type
    >
  >
  readonly consumeTargetPromotionReconciliationReadBoundaryDeath: Effect.Effect<
    Option.Option<
      typeof AuthoredCassetteStoryItem.cases.CassetteKillsCoordinatorAtTargetPromotionReconciliationRead.Type
    >
  >
  readonly consumeTargetPromotionReconciliationReadBoundaryRelease: Effect.Effect<
    Option.Option<typeof AuthoredCassetteStoryItem.cases.CassetteReleasesHeldTargetPromotionReconciliationRead.Type>
  >
  readonly consumeTaskWorkSpecificationReadBoundaryHold: Effect.Effect<
    Option.Option<typeof AuthoredCassetteStoryItem.cases.CassetteHoldsTaskWorkSpecificationReadBeforeBoundary.Type>
  >
  readonly consumeTaskWorkSpecificationReadBoundaryRelease: Effect.Effect<
    Option.Option<typeof AuthoredCassetteStoryItem.cases.CassetteReleasesHeldTaskWorkSpecificationRead.Type>
  >
  readonly awaitTaskWorkSpecificationReadBoundary: (taskId: TaskId) => Effect.Effect<void>
  readonly consumeExecutorRequestPublicationHold: Effect.Effect<
    Option.Option<typeof AuthoredCassetteStoryItem.cases.DalphHoldsExecutorRequestThroughNextDeliveryPublication.Type>
  >
  readonly consumeExecutorProgressAdmissionBatchGate: Effect.Effect<
    Option.Option<typeof AuthoredCassetteStoryItem.cases.CassetteRendezvousesExecutorReportsBeforeJournalAppend.Type>
  >
  readonly consumeCapacityChange: Effect.Effect<
    Option.Option<typeof AuthoredCassetteStoryItem.cases.SetTaskExecutionCapacity.Type>
  >
  readonly consumeAttemptChoice: Effect.Effect<Option.Option<AttemptChoiceItem>>
  readonly consumeDalphSelection: Effect.Effect<typeof AuthoredCassetteStoryItem.cases.DalphSelects.Type, CursorFailure>
  /** Concurrent operations wait for their exact authored selection instead of consuming a sibling selection. */
  readonly consumeDalphSelectionFor: (
    operation: CassetteDecision
  ) => Effect.Effect<typeof AuthoredCassetteStoryItem.cases.DalphSelects.Type, CursorFailure>
  readonly consumeExecutorReport: Effect.Effect<AuthoredPlannedAttemptExecutorOutcomeItem, CursorFailure>
  /** Concurrent executor requests wait for the exact authored attempt and command response. */
  readonly consumeExecutorReportFor: (
    request: "StartOrContinue" | "Suspend",
    attemptId: AttemptId
  ) => Effect.Effect<AuthoredPlannedAttemptExecutorOutcomeItem, CursorFailure>
  /** Marks the exact executor command in flight before crash and response boundaries are inspected. */
  readonly beginExecutorReportRequest: (
    request: "StartOrContinue" | "Suspend",
    attemptId: AttemptId
  ) => Effect.Effect<void>
  /** Releases one exact in-flight executor command marker after its controlled boundary settles. */
  readonly endExecutorReportRequest: (
    request: "StartOrContinue" | "Suspend",
    attemptId: AttemptId
  ) => Effect.Effect<void>
  readonly consumeExecutorProjection: Effect.Effect<
    Option.Option<typeof AuthoredCassetteStoryItem.cases.PlannedAttemptExecutorProjectionReturned.Type>
  >
  readonly consumeGitWorktreeObservationChange: Effect.Effect<
    Option.Option<typeof AuthoredCassetteStoryItem.cases.GitWorktreeObservationChanged.Type>
  >
  readonly consumeGitPlannedWorktreeCreateResponseLost: Effect.Effect<
    Option.Option<typeof AuthoredCassetteStoryItem.cases.GitPlannedWorktreeCreateResponseLost.Type>
  >
  /** A boundary already in flight lets authored Operator/client items arm before its response item is consumed. */
  readonly awaitInFlightOperatorItems: Effect.Effect<void>
  readonly consumeInitialPolicy: Effect.Effect<
    typeof AuthoredCassetteStoryItem.cases.InitialControlPolicy.Type,
    CursorFailure
  >
  /** The authored outer Integrator request must equal the exact production correlation. */
  readonly consumeIntegratorRequest: (
    correlation: IntegratorSessionCorrelation
  ) => Effect.Effect<typeof AuthoredCassetteStoryItem.cases.IntegratorRequestReceived.Type, CursorFailure>
  /** The authored outer Integrator returns only PreparedCandidate or NotPrepared. */
  readonly consumeIntegratorResult: Effect.Effect<
    typeof AuthoredCassetteStoryItem.cases.IntegratorResultReturned.Type,
    CursorFailure
  >
  /** Git returns or fails while observing the exact candidate text reported by the Integrator. */
  readonly consumeIntegratorGitObservation: (
    candidateText: IntegratorCandidateText
  ) => Effect.Effect<
    typeof AuthoredCassetteStoryItem.cases.IntegratorGitObservationReturned.Type,
    CursorFailure | AuthoredIntegratorGitObservationFailure
  >
  readonly consumeTargetPromotionCompareAndSet: Effect.Effect<
    typeof AuthoredCassetteStoryItem.cases.TargetPromotionCompareAndSetReturned.Type,
    CursorFailure | AuthoredTargetPromotionCompareAndSetFailure
  >
  readonly consumeTargetPromotionGitRead: (
    repository: GitRepositoryLocator,
    candidateCommit: GitCommitSha
  ) => Effect.Effect<
    typeof AuthoredCassetteStoryItem.cases.TargetPromotionGitReadReturned.Type,
    CursorFailure | AuthoredTargetPromotionGitReadFailure
  >
  readonly consumeControlDirection: (
    expected:
      | typeof AuthoredCassetteStoryItem.cases.OperatorAppliesControlDirection.Type
      | typeof AuthoredCassetteStoryItem.cases.OperatorAppliesControlDirectionBeforeDeliveryActionAdmission.Type
  ) => Effect.Effect<
    Option.Option<
      | typeof AuthoredCassetteStoryItem.cases.OperatorAppliesControlDirection.Type
      | typeof AuthoredCassetteStoryItem.cases.OperatorAppliesControlDirectionBeforeDeliveryActionAdmission.Type
    >
  >
  /** Consume Alice's exact FullRerun choice for one durable Integrator quarantine. */
  readonly consumeIntegrationQuarantineDirection: Effect.Effect<
    Option.Option<typeof AuthoredCassetteStoryItem.cases.OperatorAppliesIntegrationQuarantineDirection.Type>
  >
  /** Releases the in-flight FullRerun choice so the authored crash boundary may be consumed. */
  readonly completeIntegrationQuarantineDirection: Effect.Effect<void>
  /** Consume Alice's exact whole-Run cancellation boundary. */
  readonly consumeRunCancellation: Effect.Effect<
    Option.Option<typeof AuthoredCassetteStoryItem.cases.OperatorAppliesRunCancellation.Type>
  >
  readonly consumePauseObservationStart: Effect.Effect<
    Option.Option<
      | typeof AuthoredCassetteStoryItem.cases.OperatorStartsPauseObservation.Type
      | typeof AuthoredCassetteStoryItem.cases.OperatorSubscribesToPauseObservation.Type
    >
  >
  readonly consumePauseProgressAwait: Effect.Effect<
    Option.Option<typeof AuthoredCassetteStoryItem.cases.OperatorAwaitsPauseProgress.Type>
  >
  readonly consumePauseProgressObservedCancelledAndReconnected: Effect.Effect<
    Option.Option<typeof AuthoredCassetteStoryItem.cases.PauseProgressObservedCancelledAndReconnected.Type>
  >
  readonly consumePauseProgressObserved: Effect.Effect<
    Option.Option<typeof AuthoredCassetteStoryItem.cases.PauseProgressObserved.Type>
  >
  readonly consumeControlDirectionFailure: Effect.Effect<
    Option.Option<typeof AuthoredCassetteStoryItem.cases.OperatorControlDirectionFailed.Type>
  >
  readonly consumeInFlightExecutorControlDirection: (
    attemptId?: AttemptId
  ) => Effect.Effect<
    Option.Option<
      | typeof AuthoredCassetteStoryItem.cases.OperatorAppliesControlDirectionWhileExecutorRequestInFlight.Type
      | typeof AuthoredCassetteStoryItem.cases.OperatorAppliesRunCancellationWhileExecutorRequestInFlight.Type
      | typeof AuthoredCassetteStoryItem.cases.OperatorUnpausesWhileExecutorRequestInFlightAfterQueuedPauseWaiting.Type
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
  readonly consumeTaskClaimAcquisitionConflictReturned: Effect.Effect<
    Option.Option<typeof AuthoredCassetteStoryItem.cases.TaskClaimAcquisitionConflictReturned.Type>
  >
  readonly consumeTaskClaimAcquisitionRejected: Effect.Effect<
    typeof AuthoredCassetteStoryItem.cases.TaskClaimAcquisitionRejected.Type,
    CursorFailure
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

export interface AuthoredStoryOccurrenceObserved {
  readonly item: StoryItem
  /** Count of typed story occurrences consumed through this exact occurrence. */
  readonly storyPosition: number
}

interface StoryCursorOptions {
  readonly onOccurrence?: (occurrence: AuthoredStoryOccurrenceObserved) => Effect.Effect<void>
}

export const makeStoryCursor = Effect.fn("AuthoredCassette.makeStoryCursor")(function* (
  story: ReadonlyArray<StoryItem>,
  options: StoryCursorOptions = {}
): Effect.fn.Return<StoryCursor> {
  const position = yield* SubscriptionRef.make(0)
  const controlDirectionBeforeAdmission = yield* SubscriptionRef.make<Option.Option<Deferred.Deferred<void>>>(
    Option.none()
  )
  const integrationQuarantineDirectionInFlight = yield* SubscriptionRef.make<Option.Option<Deferred.Deferred<void>>>(
    Option.none()
  )
  const terminalAssertionsReached = yield* Deferred.make<void>()
  const activeDalphSelections = yield* SubscriptionRef.make<ReadonlyArray<CassetteDecision>>([])
  const activeExecutorReportRequests = yield* SubscriptionRef.make<ReadonlyArray<ActiveExecutorReportRequest>>([])
  const activeIntegratorGitObservations = yield* SubscriptionRef.make<ReadonlyArray<IntegratorCandidateText>>([])
  const activeTargetPromotionGitRequests = yield* Ref.make<
    ReadonlyArray<{ readonly candidateCommit: GitCommitSha; readonly repository: GitRepositoryLocator }>
  >([])
  const taskWorkSpecificationReadBoundaries = yield* SubscriptionRef.make<ReadonlyMap<TaskId, Deferred.Deferred<void>>>(
    new Map()
  )
  const cursorDriverBarrierTags: ReadonlySet<StoryItem["_tag"]> = new Set([
    "CassetteRendezvousesExecutorReportsBeforeJournalAppend",
    "CassetteHoldsPlannedAttemptSuspensionBeforeExecutorBoundary",
    "CassetteReleasesHeldPlannedAttemptSuspension",
    "CassetteReleasesHeldPlannedAttemptContinuation",
    "CassetteReleasesHeldTargetPromotionReconciliationRead",
    "CassetteHoldsTaskWorkSpecificationReadBeforeBoundary",
    "CassetteReleasesHeldTaskWorkSpecificationRead",
    "OperatorAppliesControlDirectionBeforeDeliveryActionAdmission",
    "OperatorAwaitsPauseProgress",
    "OperatorStartsPauseObservation",
    "OperatorSubscribesToPauseObservation",
    "PauseProgressObserved",
    "PauseProgressObservedCancelledAndReconnected"
  ])
  const controlBoundaryResultTags: ReadonlySet<StoryItem["_tag"]> = new Set([
    "TrackerGraphReadFailed",
    "TrackerGraphReadReturned",
    "OperatorControlDirectionFailed"
  ])
  const isControlBoundaryRead = (item: StoryItem | undefined): boolean => {
    if (item?._tag === "DalphSelects") return item.operation._tag === "ReadTrackerGraph"
    return item !== undefined && controlBoundaryResultTags.has(item._tag)
  }

  const awaitControlBoundary = Effect.fn("AuthoredCassette.awaitControlBoundary")(function* () {
    const activeControl = yield* SubscriptionRef.get(controlDirectionBeforeAdmission)
    if (Option.isNone(activeControl)) return false
    const index = yield* SubscriptionRef.get(position)
    if (isControlBoundaryRead(story[index])) return false
    yield* Deferred.await(activeControl.value)
    return true
  })

  const announceTerminalAssertions = SubscriptionRef.get(position).pipe(
    Effect.flatMap((index) =>
      story[index]?._tag === "ExpectedBehavior" ? Deferred.succeed(terminalAssertionsReached, undefined) : Effect.void
    )
  )

  const awaitBarrierAdvance = <A extends StoryItem>(claimed: ClaimedStoryItem<A>): Effect.Effect<boolean> => {
    if (claimed._tag === "Claimed" || claimed.item === undefined || !cursorDriverBarrierTags.has(claimed.item._tag)) {
      return Effect.succeed(false)
    }
    return SubscriptionRef.changes(position).pipe(
      Stream.filter((next) => next > claimed.index),
      Stream.take(1),
      Stream.runDrain,
      Effect.as(true)
    )
  }

  function claimNext<A extends StoryItem>(
    predicate: (item: StoryItem | undefined) => item is A,
    bypassControlBoundary = false
  ): Effect.Effect<ClaimedStoryItem<A>> {
    return Effect.gen(function* () {
      // The coordinator-death probe runs from a durable journal append. It
      // must be able to inspect the next crash boundary while a
      // before-admission control gate is still awaiting completion; otherwise
      // the append that proves the control read deadlocks behind its own gate.
      if (!bypassControlBoundary && (yield* awaitControlBoundary())) return yield* claimNext(predicate)
      const claimed = yield* SubscriptionRef.modify(position, (index): readonly [ClaimedStoryItem<A>, number] => {
        const item = story[index]
        return predicate(item)
          ? [{ _tag: "Claimed" as const, index, item }, index + 1]
          : [{ _tag: "Mismatch" as const, index, item }, index]
      })
      if (claimed._tag === "Claimed") {
        yield* options.onOccurrence?.({ item: claimed.item, storyPosition: claimed.index + 1 }) ?? Effect.void
      }
      yield* announceTerminalAssertions
      const advanced = bypassControlBoundary ? false : yield* awaitBarrierAdvance(claimed)
      return advanced ? yield* claimNext(predicate) : claimed
    })
  }
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
  const awaitOwnershipOrAdvance = Effect.fn("AuthoredCassette.awaitOwnershipOrAdvance")(function* (
    ownership: Stream.Stream<unknown>,
    index: number,
    isOwned: Effect.Effect<boolean>
  ): Effect.fn.Return<"Owned" | "Advanced" | "Unowned"> {
    const signal = yield* Effect.raceFirst(
      Stream.merge(
        ownership.pipe(Stream.map(() => "Owned" as const)),
        SubscriptionRef.changes(position).pipe(
          Stream.filter((current) => current > index),
          Stream.map(() => "Advanced" as const)
        )
      ).pipe(Stream.runHead, Effect.map(Option.getOrThrow)),
      Effect.forEach(Array.from({ length: authoredOwnershipRegistrationTurns }), () => Effect.yieldNow, {
        discard: true
      }).pipe(Effect.as("RegistrationClosed" as const))
    )
    if (signal !== "RegistrationClosed") return signal
    if ((yield* SubscriptionRef.get(position)) > index) return "Advanced"
    return (yield* isOwned) ? "Owned" : "Unowned"
  })
  const awaitFutureAuthoredSelectionOrAdvance = Effect.fn("AuthoredCassette.awaitFutureAuthoredSelectionOrAdvance")(
    function* (index: number, operation: CassetteDecision) {
      if (!hasLaterAuthoredSelection(story, index, operation)) return false
      const outcome = yield* Effect.raceFirst(
        awaitsLaterStoryItem(position, index).pipe(Effect.as("Advanced" as const)),
        Effect.forEach(Array.from({ length: authoredFutureSelectionRegistrationTurns }), () => Effect.yieldNow, {
          discard: true
        }).pipe(Effect.as("RegistrationClosed" as const))
      )
      return outcome === "Advanced"
    }
  )
  const awaitOwnedIntegratorGitBeforeSelection = Effect.fn("AuthoredCassette.awaitOwnedIntegratorGitBeforeSelection")(
    function* (candidateText: IntegratorCandidateText, index: number) {
      const ownership = SubscriptionRef.changes(activeIntegratorGitObservations).pipe(
        Stream.filter((active) => active.includes(candidateText))
      )
      const isOwned = SubscriptionRef.get(activeIntegratorGitObservations).pipe(
        Effect.map((active) => active.includes(candidateText))
      )
      const ownershipOrAdvance = yield* awaitOwnershipOrAdvance(ownership, index, isOwned)
      if (ownershipOrAdvance === "Unowned") return false
      if (ownershipOrAdvance === "Owned") yield* awaitsLaterStoryItem(position, index)
      return true
    }
  )
  const awaitOwnedStoryItemImmediatelyBeforeSelection = Effect.fn(
    "AuthoredCassette.awaitOwnedStoryItemImmediatelyBeforeSelection"
  )(function* (item: StoryItem | undefined, index: number, operation: CassetteDecision) {
    const predecessor = selectionPredecessorFor(item, story[index + 1], operation)
    if (predecessor === null) return false
    if (predecessor._tag === "IntegratorGit") {
      return yield* awaitOwnedIntegratorGitBeforeSelection(predecessor.candidateText, index)
    }
    const ownership =
      predecessor._tag === "ExecutorReport"
        ? SubscriptionRef.changes(activeExecutorReportRequests).pipe(
            Stream.filter((active) => active.some((request) => executorReportRequestMatches(request, predecessor.item)))
          )
        : SubscriptionRef.changes(activeDalphSelections).pipe(
            Stream.filter((active) =>
              active.some((selection) => cassetteDecisionMatches(selection, predecessor.operation))
            )
          )
    const isOwned =
      predecessor._tag === "ExecutorReport"
        ? SubscriptionRef.get(activeExecutorReportRequests).pipe(
            Effect.map((active) => active.some((request) => executorReportRequestMatches(request, predecessor.item)))
          )
        : SubscriptionRef.get(activeDalphSelections).pipe(
            Effect.map((active) =>
              active.some((selection) => cassetteDecisionMatches(selection, predecessor.operation))
            )
          )
    const ownershipOrAdvance = yield* awaitOwnershipOrAdvance(ownership, index, isOwned)
    if (ownershipOrAdvance === "Unowned") return false
    if (ownershipOrAdvance === "Owned") yield* awaitsLaterStoryItem(position, index)
    return true
  })
  const consumeDalphSelectionForLoop: StoryCursor["consumeDalphSelectionFor"] = Effect.fn(
    "AuthoredCassette.consumeDalphSelectionForLoop"
  )(function* (operation) {
    const claimed = yield* claimNext((item) => authoredDalphSelectionMatches(item, operation))
    if (claimed._tag === "Claimed") return claimed.item
    const shouldRetry = yield* Effect.gen(function* () {
      const activeRequests = yield* SubscriptionRef.get(activeExecutorReportRequests)
      const activeIntegratorRequests = yield* SubscriptionRef.get(activeIntegratorGitObservations)
      const activeSelections = yield* SubscriptionRef.get(activeDalphSelections)
      if (selectionCanWaitAfterClaim(claimed.item, activeRequests, activeIntegratorRequests, activeSelections)) {
        yield* awaitsLaterStoryItem(position, claimed.index)
        return true
      }
      if (yield* awaitOwnedStoryItemImmediatelyBeforeSelection(claimed.item, claimed.index, operation)) {
        return true
      }
      // Concurrent production fibers can request a later authored selection
      // before the operation occupying the current selection/response has
      // registered. Wait for one bounded registration window; if no owner
      // advances the story, this remains a fail-closed authored mismatch.
      if (yield* awaitFutureAuthoredSelectionOrAdvance(claimed.index, operation)) {
        return true
      }
      return false
    })
    if (shouldRetry) return yield* consumeDalphSelectionForLoop(operation)
    return yield* new AuthoredCassetteInteractionMismatch({
      actual: JSON.stringify(operation),
      expected: expectedSelectionAt(claimed.item),
      storyPosition: claimed.index
    })
  })
  const consumeDalphSelectionFor: StoryCursor["consumeDalphSelectionFor"] = Effect.fn(
    "AuthoredCassette.consumeDalphSelectionFor"
  )((operation) =>
    Effect.acquireUseRelease(
      SubscriptionRef.update(activeDalphSelections, (current) => [...current, operation]),
      () => consumeDalphSelectionForLoop(operation),
      () =>
        SubscriptionRef.update(activeDalphSelections, (current) => {
          const index = current.findIndex((selection) => cassetteDecisionMatches(selection, operation))
          return index < 0 ? current : [...current.slice(0, index), ...current.slice(index + 1)]
        })
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
  const consumePlannedAttemptSuspensionExecutorBoundaryHold = Effect.gen(function* () {
    const claimed = yield* claimNext(
      (
        item
      ): item is typeof AuthoredCassetteStoryItem.cases.CassetteHoldsPlannedAttemptSuspensionBeforeExecutorBoundary.Type =>
        item?._tag === "CassetteHoldsPlannedAttemptSuspensionBeforeExecutorBoundary"
    )
    /* v8 ignore next -- @preserve The direct-item dispatcher calls this consumer only for its exact current hold tag. */
    if (claimed._tag === "Mismatch") return Option.none()
    return Option.some(claimed.item)
  })
  const consumePlannedAttemptSuspensionExecutorBoundaryReady = Effect.gen(function* () {
    const claimed = yield* claimNext(
      (item): item is typeof AuthoredCassetteStoryItem.cases.CassetteAwaitsHeldPlannedAttemptSuspensionBoundary.Type =>
        item?._tag === "CassetteAwaitsHeldPlannedAttemptSuspensionBoundary"
    )
    /* v8 ignore next -- @preserve The direct-item dispatcher calls this consumer only for its exact current wait tag. */
    return claimed._tag === "Mismatch" ? Option.none() : Option.some(claimed.item)
  })
  const consumeExecutorProgressAdmissionBatchGate = Effect.gen(function* () {
    const claimed = yield* claimNext(
      (
        item
      ): item is typeof AuthoredCassetteStoryItem.cases.CassetteRendezvousesExecutorReportsBeforeJournalAppend.Type =>
        item?._tag === "CassetteRendezvousesExecutorReportsBeforeJournalAppend"
    )
    /* v8 ignore next -- @preserve The direct-item dispatcher calls this consumer only for its exact current synchronization item. */
    return claimed._tag === "Mismatch" ? Option.none() : Option.some(claimed.item)
  })
  const consumePlannedAttemptContinuationExecutorBoundaryHold = Effect.gen(function* () {
    const claimed = yield* claimNext(
      (
        item
      ): item is typeof AuthoredCassetteStoryItem.cases.CassetteHoldsPlannedAttemptContinuationBeforeExecutorBoundary.Type =>
        item?._tag === "CassetteHoldsPlannedAttemptContinuationBeforeExecutorBoundary"
    )
    /* v8 ignore next -- @preserve The direct-item dispatcher calls this consumer only for its exact current continuation-hold tag. */
    return claimed._tag === "Mismatch" ? Option.none() : Option.some(claimed.item)
  })
  const consumePlannedAttemptContinuationExecutorBoundaryRelease = Effect.gen(function* () {
    const claimed = yield* claimNext(
      (item): item is typeof AuthoredCassetteStoryItem.cases.CassetteReleasesHeldPlannedAttemptContinuation.Type =>
        item?._tag === "CassetteReleasesHeldPlannedAttemptContinuation"
    )
    /* v8 ignore next -- @preserve The direct-item dispatcher calls this consumer only for its exact current continuation-release tag. */
    return claimed._tag === "Mismatch" ? Option.none() : Option.some(claimed.item)
  })
  const consumePlannedAttemptSuspensionExecutorBoundaryRelease = Effect.gen(function* () {
    const claimed = yield* claimNext(
      (item): item is typeof AuthoredCassetteStoryItem.cases.CassetteReleasesHeldPlannedAttemptSuspension.Type =>
        item?._tag === "CassetteReleasesHeldPlannedAttemptSuspension"
    )
    /* v8 ignore next -- @preserve The direct-item dispatcher calls this consumer only for its exact current release tag. */
    if (claimed._tag === "Mismatch") return Option.none()
    return Option.some(claimed.item)
  })
  const consumeTargetPromotionReconciliationReadBoundaryHold = Effect.gen(function* () {
    const claimed = yield* claimNext(
      (
        item
      ): item is typeof AuthoredCassetteStoryItem.cases.CassetteHoldsTargetPromotionReconciliationReadBeforeBoundary.Type =>
        item?._tag === "CassetteHoldsTargetPromotionReconciliationReadBeforeBoundary"
    )
    return claimed._tag === "Mismatch" ? Option.none() : Option.some(claimed.item)
  })
  const consumeTargetPromotionReconciliationReadBoundaryDeath = Effect.gen(function* () {
    const claimed = yield* claimNext(
      (
        item
      ): item is typeof AuthoredCassetteStoryItem.cases.CassetteKillsCoordinatorAtTargetPromotionReconciliationRead.Type =>
        item?._tag === "CassetteKillsCoordinatorAtTargetPromotionReconciliationRead"
    )
    return claimed._tag === "Mismatch" ? Option.none() : Option.some(claimed.item)
  })
  const consumeTargetPromotionReconciliationReadBoundaryRelease = Effect.gen(function* () {
    const claimed = yield* claimNext(
      (
        item
      ): item is typeof AuthoredCassetteStoryItem.cases.CassetteReleasesHeldTargetPromotionReconciliationRead.Type =>
        item?._tag === "CassetteReleasesHeldTargetPromotionReconciliationRead"
    )
    /* v8 ignore next -- @preserve The direct-item dispatcher calls this consumer only for its exact current request-correlated release tag. */
    return claimed._tag === "Mismatch" ? Option.none() : Option.some(claimed.item)
  })
  const consumeTaskWorkSpecificationReadBoundaryHold = Effect.gen(function* () {
    const claimed = yield* claimNext(
      (
        item
      ): item is typeof AuthoredCassetteStoryItem.cases.CassetteHoldsTaskWorkSpecificationReadBeforeBoundary.Type =>
        item?._tag === "CassetteHoldsTaskWorkSpecificationReadBeforeBoundary"
    )
    /* v8 ignore start -- @preserve The direct-item dispatcher and paired-hold closure guarantee this exact single hold. */
    if (claimed._tag === "Mismatch") return Option.none()
    const gates = yield* SubscriptionRef.get(taskWorkSpecificationReadBoundaries)
    if (gates.has(claimed.item.taskId)) {
      return yield* Effect.die(`a task-work specification read hold is already armed for ${claimed.item.taskId}`)
    }
    /* v8 ignore stop -- @preserve */
    const release = yield* Deferred.make<void>()
    yield* SubscriptionRef.set(taskWorkSpecificationReadBoundaries, new Map(gates).set(claimed.item.taskId, release))
    return Option.some(claimed.item)
  })
  const consumeTaskWorkSpecificationReadBoundaryRelease = Effect.gen(function* () {
    const claimed = yield* claimNext(
      (item): item is typeof AuthoredCassetteStoryItem.cases.CassetteReleasesHeldTaskWorkSpecificationRead.Type =>
        item?._tag === "CassetteReleasesHeldTaskWorkSpecificationRead"
    )
    /* v8 ignore start -- @preserve The direct-item dispatcher and paired-hold closure guarantee this exact release. */
    if (claimed._tag === "Mismatch") return Option.none()
    const gates = yield* SubscriptionRef.get(taskWorkSpecificationReadBoundaries)
    const release = gates.get(claimed.item.taskId)
    if (release === undefined) {
      return yield* Effect.die(`no held task-work specification read matches ${claimed.item.taskId}`)
    }
    /* v8 ignore stop -- @preserve */
    yield* Deferred.succeed(release, undefined)
    const remaining = new Map(gates)
    remaining.delete(claimed.item.taskId)
    yield* SubscriptionRef.set(taskWorkSpecificationReadBoundaries, remaining)
    return Option.some(claimed.item)
  })
  const awaitTaskWorkSpecificationReadBoundary = (taskId: TaskId) =>
    SubscriptionRef.get(taskWorkSpecificationReadBoundaries).pipe(
      Effect.flatMap((gates) => {
        const release = gates.get(taskId)
        return release === undefined ? Effect.void : Deferred.await(release)
      })
    )
  const consumeExecutorRequestPublicationHold = Effect.gen(function* () {
    const claimed = yield* claimNext(
      (
        item
      ): item is typeof AuthoredCassetteStoryItem.cases.DalphHoldsExecutorRequestThroughNextDeliveryPublication.Type =>
        item?._tag === "DalphHoldsExecutorRequestThroughNextDeliveryPublication"
    )
    if (claimed._tag === "Mismatch") return Option.none()
    return Option.some(claimed.item)
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
  const awaitOwnedExecutorReport = Effect.fn("AuthoredCassette.awaitOwnedExecutorReport")(function* (
    currentReport: AuthoredPlannedAttemptExecutorOutcomeItem,
    index: number
  ) {
    const ownership = SubscriptionRef.changes(activeExecutorReportRequests).pipe(
      Stream.filter((active) => active.some((candidate) => executorReportRequestMatches(candidate, currentReport)))
    )
    const isOwned = SubscriptionRef.get(activeExecutorReportRequests).pipe(
      Effect.map((active) => active.some((candidate) => executorReportRequestMatches(candidate, currentReport)))
    )
    const ownershipOrAdvance = yield* awaitOwnershipOrAdvance(ownership, index, isOwned)
    if (ownershipOrAdvance === "Owned") yield* awaitsLaterStoryItem(position, index)
    return ownershipOrAdvance !== "Unowned"
  })
  const awaitOwnedStoryItemBeforeExecutorReport = Effect.fn("AuthoredCassette.awaitOwnedStoryItemBeforeExecutorReport")(
    function* (item: StoryItem | undefined, index: number) {
      if (isAuthoredPlannedAttemptExecutorOutcomeItem(item)) {
        const owned = yield* awaitOwnedExecutorReport(item, index)
        return owned || story[index - 1]?._tag === "DalphSelects"
      }
      // Non-report items are consumed by their protocol operation. A report is
      // the only independently claimable item that must have a live owner before
      // the lookahead may wait; an unowned report must never be skipped.
      return true
    }
  )
  const consumeExecutorReportForLoop: StoryCursor["consumeExecutorReportFor"] = Effect.fn(
    "AuthoredCassette.consumeExecutorReportFor"
  )(function* (request, attemptId) {
    const claimed = yield* claimNext((item) => authoredExecutorReportMatches(item, request, attemptId))
    if (claimed._tag === "Claimed") {
      return yield* Schema.decodeUnknownEffect(AuthoredPlannedAttemptExecutorOutcomeItem)(claimed.item).pipe(
        Effect.orDie
      )
    }
    const currentReport = executorReportImmediatelyBefore(claimed.item, story[claimed.index + 1], request, attemptId)
    const retryAfterCurrentReport = yield* Effect.gen(function* () {
      if (currentReport === null) return false
      if (!(yield* awaitOwnedExecutorReport(currentReport, claimed.index))) {
        return yield* new AuthoredCassetteInteractionMismatch({
          actual: `${request}/${attemptId}`,
          expected: claimed.item?._tag ?? "EndOfStory",
          storyPosition: claimed.index
        })
      }
      return true
    })
    if (retryAfterCurrentReport) return yield* consumeExecutorReportForLoop(request, attemptId)
    const matchingReportIndex = story.findIndex(
      (candidate, index) => index > claimed.index && authoredExecutorReportMatches(candidate, request, attemptId)
    )
    const retryAfterOwnedPredecessor = yield* Effect.gen(function* () {
      if (matchingReportIndex <= claimed.index) return false
      if (!(yield* awaitOwnedStoryItemBeforeExecutorReport(claimed.item, claimed.index))) {
        return yield* new AuthoredCassetteInteractionMismatch({
          actual: `${request}/${attemptId}`,
          expected: claimed.item?._tag ?? "EndOfStory",
          storyPosition: claimed.index
        })
      }
      yield* awaitsLaterStoryItem(position, claimed.index)
      return true
    })
    if (retryAfterOwnedPredecessor) return yield* consumeExecutorReportForLoop(request, attemptId)
    return yield* new AuthoredCassetteInteractionMismatch({
      actual: `${request}/${attemptId}`,
      expected: claimed.item?._tag ?? "EndOfStory",
      storyPosition: claimed.index
    })
  })
  const consumeExecutorReportFor: StoryCursor["consumeExecutorReportFor"] = Effect.fn(
    "AuthoredCassette.consumeExecutorReportFor"
  )((request, attemptId) =>
    Effect.acquireUseRelease(
      SubscriptionRef.update(activeExecutorReportRequests, (current) => [...current, { attemptId, request }]),
      () => consumeExecutorReportForLoop(request, attemptId),
      () =>
        SubscriptionRef.update(activeExecutorReportRequests, (current) => {
          const index = current.findIndex((active) => active.request === request && active.attemptId === attemptId)
          return index < 0 ? current : [...current.slice(0, index), ...current.slice(index + 1)]
        })
    )
  )
  const beginExecutorReportRequest: StoryCursor["beginExecutorReportRequest"] = (request, attemptId) =>
    SubscriptionRef.update(activeExecutorReportRequests, (current) => [...current, { attemptId, request }])
  const endExecutorReportRequest: StoryCursor["endExecutorReportRequest"] = (request, attemptId) =>
    SubscriptionRef.update(activeExecutorReportRequests, (current) => {
      const index = current.findIndex((active) => active.request === request && active.attemptId === attemptId)
      return index < 0 ? current : [...current.slice(0, index), ...current.slice(index + 1)]
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
  const consumeIntegratorRequest = Effect.fn("AuthoredCassette.consumeIntegratorRequest")(function* (
    correlation: IntegratorSessionCorrelation
  ) {
    const claimed = yield* claimNext(
      (item): item is typeof AuthoredCassetteStoryItem.cases.IntegratorRequestReceived.Type =>
        item?._tag === "IntegratorRequestReceived"
    )
    if (claimed._tag === "Mismatch") {
      return yield* new AuthoredCassetteInteractionMismatch({
        actual: "IntegratorRequestReceived",
        expected: claimed.item?._tag ?? "EndOfStory",
        storyPosition: claimed.index
      })
    }
    const decoded = yield* Schema.decodeUnknownEffect(AuthoredCassetteStoryItem.cases.IntegratorRequestReceived)(
      claimed.item
    ).pipe(Effect.orDie)
    if (!integratorCorrelationEquivalence(decoded.correlation, correlation)) {
      return yield* new AuthoredCassetteInteractionMismatch({
        actual: JSON.stringify({ correlation }),
        expected: JSON.stringify(decoded),
        storyPosition: claimed.index
      })
    }
    return decoded
  })
  const consumeIntegratorResult = consume("IntegratorResultReturned").pipe(
    Effect.flatMap((item) =>
      Schema.decodeUnknownEffect(AuthoredCassetteStoryItem.cases.IntegratorResultReturned)(item).pipe(Effect.orDie)
    )
  )
  const awaitOwnedSelectionBeforeBoundary = Effect.fn("AuthoredCassette.awaitOwnedSelectionBeforeBoundary")(function* (
    item: StoryItem | undefined,
    index: number
  ) {
    if (item?._tag !== "DalphSelects" || !isIntegratorRecoverySelection(item.operation)) return false
    const ownership = SubscriptionRef.changes(activeDalphSelections).pipe(
      Stream.filter((active) => active.some((selection) => cassetteDecisionMatches(selection, item.operation)))
    )
    const isOwned = SubscriptionRef.get(activeDalphSelections).pipe(
      Effect.map((active) => active.some((selection) => cassetteDecisionMatches(selection, item.operation)))
    )
    const ownershipOrAdvance = yield* awaitOwnershipOrAdvance(ownership, index, isOwned)
    if (ownershipOrAdvance === "Unowned") return false
    if (ownershipOrAdvance === "Owned") yield* awaitsLaterStoryItem(position, index)
    return true
  })
  const consumeIntegratorGitObservationLoop: StoryCursor["consumeIntegratorGitObservation"] = Effect.fn(
    "AuthoredCassette.consumeIntegratorGitObservationLoop"
  )(function* (candidateText: IntegratorCandidateText) {
    const claimed = yield* claimNext(
      (item): item is OuterIntegratorGitStoryItem =>
        (item?._tag === "IntegratorGitObservationReturned" || item?._tag === "IntegratorGitObservationFailed") &&
        item.candidateText === candidateText &&
        (item._tag === "IntegratorGitObservationFailed" || item.observation.candidateText === candidateText)
    )
    if (claimed._tag === "Mismatch") {
      if (yield* awaitOwnedSelectionBeforeBoundary(claimed.item, claimed.index)) {
        return yield* consumeIntegratorGitObservationLoop(candidateText)
      }
      return yield* new AuthoredCassetteInteractionMismatch({
        actual: `IntegratorGitObservation/${candidateText}`,
        expected: claimed.item?._tag ?? "EndOfStory",
        storyPosition: claimed.index
      })
    }
    if (claimed.item._tag === "IntegratorGitObservationFailed") {
      const decoded = yield* Schema.decodeUnknownEffect(AuthoredCassetteStoryItem.cases.IntegratorGitObservationFailed)(
        claimed.item
      ).pipe(Effect.orDie)
      return yield* new AuthoredIntegratorGitObservationFailure({
        detail: decoded.detail,
        storyPosition: claimed.index
      })
    }
    return yield* Schema.decodeUnknownEffect(AuthoredCassetteStoryItem.cases.IntegratorGitObservationReturned)(
      claimed.item
    ).pipe(Effect.orDie)
  })
  const consumeIntegratorGitObservation: StoryCursor["consumeIntegratorGitObservation"] = Effect.fn(
    "AuthoredCassette.consumeIntegratorGitObservation"
  )((candidateText) =>
    Effect.acquireUseRelease(
      SubscriptionRef.update(activeIntegratorGitObservations, (current) => [...current, candidateText]),
      () =>
        Effect.gen(function* () {
          const result = yield* consumeIntegratorGitObservationLoop(candidateText)
          return result
        }),
      () =>
        SubscriptionRef.update(activeIntegratorGitObservations, (current) => {
          const index = current.indexOf(candidateText)
          return index < 0 ? current : [...current.slice(0, index), ...current.slice(index + 1)]
        })
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
  const consumeTargetPromotionGitReadLoop: (
    repository: GitRepositoryLocator,
    candidateCommit: GitCommitSha
  ) => Effect.Effect<
    typeof AuthoredCassetteStoryItem.cases.TargetPromotionGitReadReturned.Type,
    CursorFailure | AuthoredTargetPromotionGitReadFailure
  > = Effect.fn("AuthoredCassette.consumeTargetPromotionGitReadLoop")(function* (
    repository: GitRepositoryLocator,
    candidateCommit: GitCommitSha
  ) {
    const claimed = yield* claimNext(
      (
        item
      ): item is
        | typeof AuthoredCassetteStoryItem.cases.TargetPromotionGitReadReturned.Type
        | typeof AuthoredCassetteStoryItem.cases.TargetPromotionGitReadFailed.Type =>
        promotionGitStoryItemMatches(item, repository, candidateCommit)
    )
    if (claimed._tag === "Mismatch") {
      const current = story[claimed.index]
      const expected = promotionGitStoryItem(current)
      if (expected !== null) {
        const owned = (yield* Ref.get(activeTargetPromotionGitRequests)).some((request) =>
          gitRequestMatches(request, expected.repository, expected.candidateCommit)
        )
        if (!owned) {
          return yield* new AuthoredCassetteInteractionMismatch({
            actual: `${repository}/${candidateCommit}`,
            expected: `${expected.repository}/${expected.candidateCommit}`,
            storyPosition: claimed.index
          })
        }
        yield* awaitsLaterStoryItem(position, claimed.index)
        return yield* consumeTargetPromotionGitReadLoop(repository, candidateCommit)
      }
      return yield* new AuthoredCassetteInteractionMismatch({
        actual: `${repository}/${candidateCommit}`,
        expected: current?._tag ?? "EndOfStory",
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
  const consumeTargetPromotionGitRead = Effect.fn("AuthoredCassette.consumeTargetPromotionGitRead")(
    (repository: GitRepositoryLocator, candidateCommit: GitCommitSha) =>
      Ref.update(activeTargetPromotionGitRequests, (current) => [...current, { candidateCommit, repository }]).pipe(
        Effect.andThen(
          Effect.gen(function* () {
            const result = yield* consumeTargetPromotionGitReadLoop(repository, candidateCommit)
            return result
          })
        ),
        Effect.ensuring(
          Ref.update(activeTargetPromotionGitRequests, (current) => {
            const index = current.findIndex((request) => gitRequestMatches(request, repository, candidateCommit))
            return index < 0 ? current : [...current.slice(0, index), ...current.slice(index + 1)]
          })
        )
      )
  )
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
  const consumeControlDirection = (
    expected:
      | typeof AuthoredCassetteStoryItem.cases.OperatorAppliesControlDirection.Type
      | typeof AuthoredCassetteStoryItem.cases.OperatorAppliesControlDirectionBeforeDeliveryActionAdmission.Type
  ) =>
    Effect.gen(function* () {
      const gate =
        expected._tag === "OperatorAppliesControlDirectionBeforeDeliveryActionAdmission"
          ? Option.some(yield* Deferred.make<void>())
          : Option.none()
      const claimed = yield* claimNext(
        (
          item
        ): item is
          | typeof AuthoredCassetteStoryItem.cases.OperatorAppliesControlDirection.Type
          | typeof AuthoredCassetteStoryItem.cases.OperatorAppliesControlDirectionBeforeDeliveryActionAdmission.Type =>
          (item?._tag === "OperatorAppliesControlDirection" ||
            item?._tag === "OperatorAppliesControlDirectionBeforeDeliveryActionAdmission") &&
          JSON.stringify(item) === JSON.stringify(expected)
      )
      /* v8 ignore next -- @preserve Operator directions are optional story probes; maintained control stories exercise the request path and ordinary stories exercise absence through the runner. */
      if (claimed._tag === "Mismatch") {
        return Option.none()
      }
      if (Option.isSome(gate)) yield* SubscriptionRef.set(controlDirectionBeforeAdmission, gate)
      return Option.some(claimed.item)
    })
  const consumeIntegrationQuarantineDirection = Effect.gen(function* () {
    const completion = yield* Deferred.make<void>()
    const claimed = yield* claimNext(
      (item): item is typeof AuthoredCassetteStoryItem.cases.OperatorAppliesIntegrationQuarantineDirection.Type =>
        item?._tag === "OperatorAppliesIntegrationQuarantineDirection"
    )
    /* v8 ignore next -- @preserve The direct-item dispatcher invokes this consumer only for the exact operator-choice tag. */
    if (claimed._tag === "Mismatch") return Option.none()
    yield* SubscriptionRef.set(integrationQuarantineDirectionInFlight, Option.some(completion))
    return Option.some(
      yield* Schema.decodeUnknownEffect(AuthoredCassetteStoryItem.cases.OperatorAppliesIntegrationQuarantineDirection)(
        claimed.item
      ).pipe(Effect.orDie)
    )
  })
  const consumeRunCancellation = Effect.gen(function* () {
    const claimed = yield* claimNext(
      (item): item is typeof AuthoredCassetteStoryItem.cases.OperatorAppliesRunCancellation.Type =>
        item?._tag === "OperatorAppliesRunCancellation"
    )
    /* v8 ignore next -- @preserve The direct-item dispatcher calls this consumer only for the current cancellation tag. */
    if (claimed._tag === "Mismatch") return Option.none()
    return Option.some(claimed.item)
  })
  const consumePauseObservationStart = Effect.gen(function* () {
    const claimed = yield* claimNext(
      (
        item
      ): item is
        | typeof AuthoredCassetteStoryItem.cases.OperatorStartsPauseObservation.Type
        | typeof AuthoredCassetteStoryItem.cases.OperatorSubscribesToPauseObservation.Type =>
        item?._tag === "OperatorStartsPauseObservation" || item?._tag === "OperatorSubscribesToPauseObservation"
    )
    /* v8 ignore next -- @preserve The direct-item dispatcher calls this consumer only for a current observation-start tag. */
    if (claimed._tag === "Mismatch") return Option.none()
    return Option.some(claimed.item)
  })
  const consumePauseProgressAwait = Effect.gen(function* () {
    const claimed = yield* claimNext(
      (item): item is typeof AuthoredCassetteStoryItem.cases.OperatorAwaitsPauseProgress.Type =>
        item?._tag === "OperatorAwaitsPauseProgress"
    )
    if (claimed._tag === "Mismatch") return Option.none()
    return Option.some(claimed.item)
  })
  const consumePauseProgressObservedCancelledAndReconnected = Effect.gen(function* () {
    const claimed = yield* claimNext(
      (item): item is typeof AuthoredCassetteStoryItem.cases.PauseProgressObservedCancelledAndReconnected.Type =>
        item?._tag === "PauseProgressObservedCancelledAndReconnected"
    )
    /* v8 ignore next -- @preserve The direct-item dispatcher calls this consumer only for the current cancel/reconnect tag. */
    if (claimed._tag === "Mismatch") return Option.none()
    return Option.some(claimed.item)
  })
  const consumePauseProgressObserved = Effect.gen(function* () {
    const claimed = yield* claimNext(
      (item): item is typeof AuthoredCassetteStoryItem.cases.PauseProgressObserved.Type =>
        item?._tag === "PauseProgressObserved"
    )
    /* v8 ignore next -- @preserve The direct-item dispatcher calls this consumer only for the current Pause result tag. */
    if (claimed._tag === "Mismatch") return Option.none()
    return Option.some(
      yield* Schema.decodeUnknownEffect(AuthoredCassetteStoryItem.cases.PauseProgressObserved)(claimed.item).pipe(
        Effect.orDie
      )
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
  const consumeInFlightExecutorControlDirection = (attemptId?: AttemptId) =>
    Effect.gen(function* () {
      const claimed = yield* claimNext(
        (
          item
        ): item is
          | typeof AuthoredCassetteStoryItem.cases.OperatorAppliesControlDirectionWhileExecutorRequestInFlight.Type
          | typeof AuthoredCassetteStoryItem.cases.OperatorAppliesRunCancellationWhileExecutorRequestInFlight.Type
          | typeof AuthoredCassetteStoryItem.cases.OperatorUnpausesWhileExecutorRequestInFlightAfterQueuedPauseWaiting.Type =>
          (item?._tag === "OperatorAppliesControlDirectionWhileExecutorRequestInFlight" ||
            item?._tag === "OperatorAppliesRunCancellationWhileExecutorRequestInFlight" ||
            item?._tag === "OperatorUnpausesWhileExecutorRequestInFlightAfterQueuedPauseWaiting") &&
          (attemptId === undefined || item.duringAttemptId === attemptId)
      )
      if (claimed._tag === "Mismatch") return Option.none()
      return Option.some(claimed.item)
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
  const consumeGitPlannedWorktreeCreateResponseLost = Effect.gen(function* () {
    const claimed = yield* claimNext(
      (item): item is typeof AuthoredCassetteStoryItem.cases.GitPlannedWorktreeCreateResponseLost.Type =>
        item?._tag === "GitPlannedWorktreeCreateResponseLost"
    )
    if (claimed._tag === "Mismatch") return Option.none()
    return Option.some(
      yield* Schema.decodeUnknownEffect(AuthoredCassetteStoryItem.cases.GitPlannedWorktreeCreateResponseLost)(
        claimed.item
      ).pipe(Effect.orDie)
    )
  })
  const inFlightOperatorTags: ReadonlySet<StoryItem["_tag"]> = new Set([
    "CassetteRendezvousesExecutorReportsBeforeJournalAppend",
    "CassetteHoldsPlannedAttemptSuspensionBeforeExecutorBoundary",
    "CassetteReleasesHeldPlannedAttemptSuspension",
    "CassetteHoldsTaskWorkSpecificationReadBeforeBoundary",
    "CassetteReleasesHeldTaskWorkSpecificationRead",
    "OperatorAppliesControlDirection",
    "OperatorAppliesControlDirectionBeforeDeliveryActionAdmission",
    "OperatorStartsPauseObservation",
    "PauseProgressObserved",
    "PauseProgressObservedCancelledAndReconnected"
  ])
  const awaitInFlightOperatorItems: Effect.Effect<void> = Effect.gen(function* () {
    const index = yield* SubscriptionRef.get(position)
    const item = story[index]
    if (item === undefined || !inFlightOperatorTags.has(item._tag)) return
    yield* SubscriptionRef.changes(position).pipe(
      Stream.filter((next) => next > index),
      Stream.take(1),
      Stream.runDrain
    )
    return yield* awaitInFlightOperatorItems
  })
  const pauseAtCoordinatorProcessDeath = Effect.gen(function* () {
    const bypassControlBoundary = Option.isSome(yield* SubscriptionRef.get(controlDirectionBeforeAdmission))
    const activeIntegrationDirection = yield* SubscriptionRef.get(integrationQuarantineDirectionInFlight)
    if (Option.isSome(activeIntegrationDirection)) yield* Deferred.await(activeIntegrationDirection.value)
    const claimed = yield* claimNext(
      (item): item is typeof AuthoredCassetteStoryItem.cases.CoordinatorProcessDies.Type =>
        item?._tag === "CoordinatorProcessDies",
      bypassControlBoundary
    )
    if (claimed._tag === "Mismatch") return
    yield* Schema.decodeUnknownEffect(AuthoredCassetteStoryItem.cases.CoordinatorProcessDies)(claimed.item).pipe(
      Effect.orDie
    )
    // Keep decoding as the boundary proof, then fail immediately in this
    // production action fiber. The parent activation observes the defect and
    // disposes the whole scoped activation before the next report can occur.
    return yield* Effect.die(new AuthoredCoordinatorProcessDies({ storyPosition: claimed.index }))
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
  const awaitOwnedSelectionBeforeTaskClaimRead = Effect.fn("AuthoredCassette.awaitOwnedSelectionBeforeTaskClaimRead")(
    function* (item: StoryItem | undefined, index: number) {
      if (item?._tag !== "DalphSelects" || item.operation._tag !== "ReadTaskClaim") return false
      const taskClaimSelection: CassetteDecision = item.operation
      const ownership = SubscriptionRef.changes(activeDalphSelections).pipe(
        Stream.filter((active) => active.some((selection) => cassetteDecisionMatches(selection, taskClaimSelection)))
      )
      const isOwned = SubscriptionRef.get(activeDalphSelections).pipe(
        Effect.map((active) => active.some((selection) => cassetteDecisionMatches(selection, taskClaimSelection)))
      )
      const ownershipOrAdvance = yield* awaitOwnershipOrAdvance(ownership, index, isOwned)
      if (ownershipOrAdvance === "Unowned") return false
      if (ownershipOrAdvance === "Owned") yield* awaitsLaterStoryItem(position, index)
      return true
    }
  )
  const consumeTaskClaimReadLoop: () => StoryCursor["consumeTaskClaimRead"] = Effect.fn(
    "AuthoredCassette.consumeTaskClaimReadLoop"
  )(function* () {
    const claimed = yield* claimNext(isTaskClaimReadItem)
    if (claimed._tag === "Mismatch") {
      if (yield* awaitOwnedSelectionBeforeTaskClaimRead(claimed.item, claimed.index)) {
        return yield* consumeTaskClaimReadLoop()
      }
      return Option.none()
    }
    return Option.some(yield* Schema.decodeUnknownEffect(AuthoredTaskClaimReadItem)(claimed.item).pipe(Effect.orDie))
  })
  const consumeTaskClaimRead = consumeTaskClaimReadLoop()
  const consumeTaskClaimAcquisitionConflictReturned = Effect.gen(function* () {
    const claimed = yield* claimNext(
      (item): item is typeof AuthoredCassetteStoryItem.cases.TaskClaimAcquisitionConflictReturned.Type =>
        item?._tag === "TaskClaimAcquisitionConflictReturned"
    )
    if (claimed._tag === "Mismatch") return Option.none()
    return Option.some(
      yield* Schema.decodeUnknownEffect(AuthoredCassetteStoryItem.cases.TaskClaimAcquisitionConflictReturned)(
        claimed.item
      ).pipe(Effect.orDie)
    )
  })
  const consumeTaskClaimAcquisitionRejected = consume("TaskClaimAcquisitionRejected").pipe(
    Effect.flatMap((item) =>
      Schema.decodeUnknownEffect(AuthoredCassetteStoryItem.cases.TaskClaimAcquisitionRejected)(item).pipe(Effect.orDie)
    )
  )
  const consumeCompletionClaimDeletionApplied = consume("CompletionClaimDeletionApplied").pipe(
    Effect.flatMap((item) =>
      Schema.decodeUnknownEffect(AuthoredCassetteStoryItem.cases.CompletionClaimDeletionApplied)(item).pipe(
        Effect.orDie
      )
    )
  )
  const consumeCompletionClaimReadReturned = consume("CompletionClaimReadReturned").pipe(
    Effect.flatMap((item) =>
      Schema.decodeUnknownEffect(AuthoredCassetteStoryItem.cases.CompletionClaimReadReturned)(item).pipe(Effect.orDie)
    )
  )
  const consumeCompletionClaimReplacementApplied = consume("CompletionClaimReplacementApplied").pipe(
    Effect.flatMap((item) =>
      Schema.decodeUnknownEffect(AuthoredCassetteStoryItem.cases.CompletionClaimReplacementApplied)(item).pipe(
        Effect.orDie
      )
    )
  )
  const consumeCompletionTaskFocusedReadReturned = Effect.gen(function* () {
    const item = yield* consume("CompletionTaskFocusedReadReturned")
    const decoded = yield* Schema.decodeUnknownEffect(
      AuthoredCassetteStoryItem.cases.CompletionTaskFocusedReadReturned
    )(item).pipe(Effect.orDie)
    return decoded
  })
  const consumeCompletionTaskPrerequisiteReopened = consume("CompletionTaskPrerequisiteReopened").pipe(
    Effect.flatMap((item) =>
      Schema.decodeUnknownEffect(AuthoredCassetteStoryItem.cases.CompletionTaskPrerequisiteReopened)(item).pipe(
        Effect.orDie
      )
    )
  )
  const consumeCompletionTaskRequestLookupReturned = consume("CompletionTaskRequestLookupReturned").pipe(
    Effect.flatMap((item) =>
      Schema.decodeUnknownEffect(AuthoredCassetteStoryItem.cases.CompletionTaskRequestLookupReturned)(item).pipe(
        Effect.orDie
      )
    )
  )
  const consumeCompletionTaskRequestReturned = consume("CompletionTaskRequestReturned").pipe(
    Effect.flatMap((item) =>
      Schema.decodeUnknownEffect(AuthoredCassetteStoryItem.cases.CompletionTaskRequestReturned)(item).pipe(Effect.orDie)
    )
  )
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
  const awaitOwnedSelectionBeforeTrackerGraphResult = Effect.fn(
    "AuthoredCassette.awaitOwnedSelectionBeforeTrackerGraphResult"
  )(function* (item: StoryItem | undefined, index: number) {
    if (item?._tag !== "DalphSelects" || !isIntegratorRecoverySelection(item.operation)) return false
    const ownership = SubscriptionRef.changes(activeDalphSelections).pipe(
      Stream.filter((active) => active.some((selection) => cassetteDecisionMatches(selection, item.operation)))
    )
    const isOwned = SubscriptionRef.get(activeDalphSelections).pipe(
      Effect.map((active) => active.some((selection) => cassetteDecisionMatches(selection, item.operation)))
    )
    const ownershipOrAdvance = yield* awaitOwnershipOrAdvance(ownership, index, isOwned)
    if (ownershipOrAdvance === "Unowned") return false
    if (ownershipOrAdvance === "Owned") yield* awaitsLaterStoryItem(position, index)
    return true
  })
  const consumeTrackerGraphLoop: () => StoryCursor["consumeTrackerGraph"] = Effect.fn(
    "AuthoredCassette.consumeTrackerGraphLoop"
  )(function* () {
    const claimed = yield* claimNext(
      (item): item is AuthoredTrackerGraphReadResult =>
        item?._tag === "TrackerGraphReadFailed" ||
        item?._tag === "TrackerGraphReadReturned" ||
        item?._tag === "RunActivationFinalTrackerGraphReadReturned"
    )
    if (claimed._tag === "Mismatch") {
      if (yield* awaitOwnedSelectionBeforeTrackerGraphResult(claimed.item, claimed.index)) {
        return yield* consumeTrackerGraphLoop()
      }
      return yield* new AuthoredCassetteInteractionMismatch({
        actual: "TrackerGraphReadFailed | TrackerGraphReadReturned | RunActivationFinalTrackerGraphReadReturned",
        /* v8 ignore next -- A decoded story retains its terminal assertion after any graph interaction. */
        expected: claimed.item?._tag ?? "EndOfStory",
        storyPosition: claimed.index
      })
    }
    return yield* Schema.decodeUnknownEffect(AuthoredTrackerGraphReadResult)(claimed.item).pipe(Effect.orDie)
  })
  const consumeTrackerGraph = consumeTrackerGraphLoop()
  return {
    completeControlDirectionBeforeDeliveryActionAdmission: Effect.gen(function* () {
      const gate = yield* SubscriptionRef.get(controlDirectionBeforeAdmission)
      /* v8 ignore next -- @preserve Closure pairs this completion with the exact earlier before-admission control item. */
      if (Option.isNone(gate)) return
      yield* SubscriptionRef.set(controlDirectionBeforeAdmission, Option.none())
      yield* Deferred.succeed(gate.value, undefined)
    }),
    completeIntegrationQuarantineDirection: Effect.gen(function* () {
      const gate = yield* SubscriptionRef.get(integrationQuarantineDirectionInFlight)
      if (Option.isNone(gate)) return
      yield* SubscriptionRef.set(integrationQuarantineDirectionInFlight, Option.none())
      yield* Deferred.succeed(gate.value, undefined)
    }),
    storyPosition: SubscriptionRef.get(position),
    currentStoryItem: SubscriptionRef.get(position).pipe(Effect.map((index) => story[index])),
    awaitCurrentStoryAdvance: SubscriptionRef.get(position).pipe(
      Effect.flatMap((index) => awaitsLaterStoryItem(position, index))
    ),
    atTerminalAssertions,
    awaitInFlightOperatorItems,
    awaitTerminalAssertions: Deferred.await(terminalAssertionsReached),
    consumeAdmittedContinuationExecutorIntentHold,
    consumeExecutorProgressAdmissionBatchGate,
    consumePlannedAttemptSuspensionExecutorBoundaryHold,
    consumePlannedAttemptSuspensionExecutorBoundaryReady,
    consumePlannedAttemptContinuationExecutorBoundaryHold,
    consumePlannedAttemptContinuationExecutorBoundaryRelease,
    consumePlannedAttemptSuspensionExecutorBoundaryRelease,
    consumeTargetPromotionReconciliationReadBoundaryHold,
    consumeTargetPromotionReconciliationReadBoundaryDeath,
    consumeTargetPromotionReconciliationReadBoundaryRelease,
    consumeTaskWorkSpecificationReadBoundaryHold,
    consumeTaskWorkSpecificationReadBoundaryRelease,
    awaitTaskWorkSpecificationReadBoundary,
    consumeCoordinatorActivationReturned,
    consumeCompletionClaimDeletionApplied,
    consumeCompletionClaimReadReturned,
    consumeCompletionClaimReplacementApplied,
    consumeCompletionTaskFocusedReadReturned,
    consumeCompletionTaskPrerequisiteReopened,
    consumeCompletionTaskRequestLookupReturned,
    consumeCompletionTaskRequestReturned,
    consumeAttemptChoice,
    consumeAttemptChoiceRace,
    consumeCapacityChange,
    consumeControlDirection,
    consumeIntegrationQuarantineDirection,
    consumeControlDirectionFailure,
    consumeRunCancellation,
    consumePauseObservationStart,
    consumePauseProgressAwait,
    consumePauseProgressObservedCancelledAndReconnected,
    consumePauseProgressObserved,
    consumeInFlightExecutorControlDirection,
    consumeClaimReacquisitionDirection,
    consumeDalphSelection,
    consumeDalphSelectionFor,
    beginExecutorReportRequest,
    endExecutorReportRequest,
    consumeExecutorProjection,
    consumeExecutorRequestPublicationHold,
    consumeExecutorReport,
    consumeExecutorReportFor,
    consumeGitWorktreeObservationChange,
    consumeGitPlannedWorktreeCreateResponseLost,
    consumeInitialPolicy,
    consumeIntegratorRequest,
    consumeIntegratorResult,
    consumeIntegratorGitObservation,
    consumeTargetPromotionCompareAndSet,
    consumeTargetPromotionGitRead,
    consumeRunCoordinator,
    consumeTaskClaimRead,
    consumeTaskClaimAcquisitionConflictReturned,
    consumeTaskClaimAcquisitionRejected,
    consumeTaskClaimReleaseResponseLost,
    consumeTaskWorkSpecification,
    consumeTerminalAssertions,
    consumeTrackerGraph,
    pauseAtCoordinatorProcessDeath,
    storyItems: SubscriptionRef.changes(position).pipe(Stream.map((index) => story[index]))
  }
})
