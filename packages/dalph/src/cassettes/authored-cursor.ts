/* eslint-disable max-lines -- One cursor atomically owns every authored story interaction and optional boundary probe. */
import { Deferred, Effect, Equal, Option, Ref, Schema, Semaphore, Stream, SubscriptionRef } from "effect"
import type { AttemptId, GitCommitSha, GitRepositoryLocator, TaskId } from "@dalph/contracts"
import {
  IntegratorSessionCorrelation,
  type IntegratorCandidateText,
  type OperationId,
  type TrackerTarget
} from "@dalph/orchestrator"
import {
  type AuthoredCassetteDecision as CassetteDecision,
  type AuthoredCausalSelection,
  type AuthoredConcurrentInteractionClaimKey,
  type AuthoredConcurrentInteractionMember,
  type AuthoredConcurrentInteractionNode,
  type AuthoredConcurrentTrackerRead,
  type AuthoredConcurrentTrackerReadResult,
  AuthoredCassetteStoryItem,
  type AuthoredCassetteStoryItem as StoryItem,
  AuthoredTrackerGraphReadResult,
  authoredConcurrentInteractionClaimKey
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

/** A cassette operation did not satisfy its exact authored predecessor relationship. */
export class AuthoredCausalSelectionFailure extends Schema.TaggedError<AuthoredCausalSelectionFailure>()(
  "AuthoredCausalSelectionFailure",
  { detail: Schema.String, storyPosition: Schema.Int }
) {}

/** A concurrent cassette read was missing, duplicated, crossed, or consumed twice. */
class AuthoredConcurrentReadBatchFailure extends Schema.TaggedError<AuthoredConcurrentReadBatchFailure>()(
  "AuthoredConcurrentReadBatchFailure",
  { detail: Schema.String, storyPosition: Schema.Int }
) {}

/** Raw operation identity observed at the real WorkflowTrace selection seam. */
export interface AuthoredOperationCausalContext {
  readonly operationId: OperationId
  readonly predecessorOperationIds: ReadonlyArray<OperationId>
}

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
type ExactCausalCursorFailure =
  | AuthoredCassetteInteractionMismatch
  | AuthoredCausalSelectionFailure
  | AuthoredConcurrentReadBatchFailure
type OuterIntegratorGitStoryItem =
  | typeof AuthoredCassetteStoryItem.cases.IntegratorGitObservationFailed.Type
  | typeof AuthoredCassetteStoryItem.cases.IntegratorGitObservationReturned.Type
type AuthoredExecutorRequest = "Begin" | "Resume" | "Suspend"
type ActiveExecutorReportRequest = { readonly attemptId: AttemptId; readonly request: AuthoredExecutorRequest }
type ExecutorRequestPublicationHold =
  typeof AuthoredCassetteStoryItem.cases.DalphHoldsExecutorRequestThroughNextDeliveryPublication.Type
type GitRequestCorrelation = { readonly candidateCommit: GitCommitSha; readonly repository: GitRepositoryLocator }
type PromotionGitStoryItem =
  | typeof AuthoredCassetteStoryItem.cases.TargetPromotionGitReadFailed.Type
  | typeof AuthoredCassetteStoryItem.cases.TargetPromotionGitReadReturned.Type

interface ConcurrentInteractionGroupState {
  readonly consumedRoles: ReadonlySet<AuthoredConcurrentInteractionNode["role"]>
  readonly index: number
}

type ConcurrentInteractionIncomingClaimKey =
  | AuthoredConcurrentInteractionClaimKey
  | {
      readonly _tag: "PlannedAttemptExecutorWorkReported"
      readonly attemptId: AttemptId
      readonly request: AuthoredExecutorRequest
    }
type ConcurrentSelectionMember = Extract<AuthoredConcurrentInteractionMember, { readonly _tag: "DalphSelects" }>
type ConcurrentExecutorMember = Extract<
  AuthoredConcurrentInteractionMember,
  { readonly _tag: "PlannedAttemptExecutorWorkReported" }
>

type ConcurrentInteractionClaimDecision =
  | {
      readonly _tag: "Claimed"
      readonly completed: boolean
      readonly index: number
      readonly item: typeof AuthoredCassetteStoryItem.cases.ConcurrentInteractionGroup.Type
      readonly member: AuthoredConcurrentInteractionMember
      readonly nextState: ConcurrentInteractionGroupState | undefined
    }
  | { readonly _tag: "Failure"; readonly detail: string; readonly index: number }
  | { readonly _tag: "None" }

type ConcurrentInteractionMemberMatch =
  | { readonly _tag: "Ambiguous" }
  | { readonly _tag: "Match"; readonly node: AuthoredConcurrentInteractionNode }
  | { readonly _tag: "Missing" }

type ConcurrentInteractionPreparedState =
  | { readonly _tag: "Failure"; readonly detail: string; readonly index: number }
  | {
      readonly _tag: "Ready"
      readonly index: number
      readonly item: typeof AuthoredCassetteStoryItem.cases.ConcurrentInteractionGroup.Type
      readonly state: ConcurrentInteractionGroupState
    }

const concurrentInteractionMemberMatch = (
  members: ReadonlyArray<AuthoredConcurrentInteractionNode>,
  claimKey: ConcurrentInteractionIncomingClaimKey
): ConcurrentInteractionMemberMatch => {
  let match: Extract<ConcurrentInteractionMemberMatch, { readonly _tag: "Match" }> | undefined
  for (const node of members) {
    if (!Equal.equals(authoredConcurrentInteractionClaimKey(node.interaction), claimKey)) continue
    if (match !== undefined) return { _tag: "Ambiguous" }
    match = { _tag: "Match", node }
  }
  return match ?? { _tag: "Missing" }
}

const prepareConcurrentInteractionState = (
  item: StoryItem | undefined,
  index: number,
  prior: ConcurrentInteractionGroupState | undefined
): ConcurrentInteractionPreparedState | { readonly _tag: "None" } => {
  if (item?._tag !== "ConcurrentInteractionGroup") {
    return prior === undefined
      ? { _tag: "None" }
      : {
          _tag: "Failure",
          detail: `concurrent interaction group at story position ${prior.index} has not completed`,
          index
        }
  }
  if (prior !== undefined && prior.index !== index) {
    return {
      _tag: "Failure",
      detail: `concurrent interaction group at story position ${prior.index} contradicts current position`,
      index
    }
  }
  const state: ConcurrentInteractionGroupState = prior ?? { consumedRoles: new Set(), index }
  return { _tag: "Ready", index, item, state }
}

/** Pure matcher decision for one cassette-local concurrent-group claim. */
const decideConcurrentInteractionClaim = (
  item: StoryItem | undefined,
  index: number,
  prior: ConcurrentInteractionGroupState | undefined,
  claimKey: ConcurrentInteractionIncomingClaimKey
): ConcurrentInteractionClaimDecision => {
  const prepared = prepareConcurrentInteractionState(item, index, prior)
  if (prepared._tag !== "Ready") return prepared
  const match = concurrentInteractionMemberMatch(prepared.item.members, claimKey)
  if (match._tag !== "Match") {
    return {
      _tag: "Failure",
      detail:
        match._tag === "Missing"
          ? "the interaction is not a member of the current concurrent group"
          : "the interaction matches more than one member of the current concurrent group",
      index
    }
  }
  const role = match.node.role
  if (prepared.state.consumedRoles.has(role)) {
    return { _tag: "Failure", detail: "the concurrent group member was already consumed", index }
  }
  const incompletePredecessor = match.node.predecessorRoles.find(
    (predecessorRole) => !prepared.state.consumedRoles.has(predecessorRole)
  )
  if (incompletePredecessor !== undefined) {
    return {
      _tag: "Failure",
      detail: `concurrent interaction role ${role} requires predecessor ${incompletePredecessor}`,
      index
    }
  }
  const consumedRoles = new Set(prepared.state.consumedRoles).add(role)
  const completed = consumedRoles.size === prepared.item.members.length
  return {
    _tag: "Claimed",
    completed,
    index,
    item: prepared.item,
    member: match.node.interaction,
    nextState: completed ? undefined : { consumedRoles, index }
  }
}

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

const executorReportRequestMatches = (
  active: ActiveExecutorReportRequest,
  item: AuthoredPlannedAttemptExecutorOutcomeItem
): boolean => active.request === item.request && active.attemptId === item.report.attemptId

const executorRequestPublicationHoldMatches = (
  active: ActiveExecutorReportRequest,
  item: ExecutorRequestPublicationHold
): boolean => active.request === item.request && active.attemptId === item.attemptId

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
  activeIntegratorGitObservations: ReadonlyArray<IntegratorCandidateText>
): boolean =>
  item?._tag === "CassetteHoldsTargetPromotionReconciliationReadBeforeBoundary" ||
  (isAuthoredPlannedAttemptExecutorOutcomeItem(item) &&
    activeRequests.some((active) => executorReportRequestMatches(active, item))) ||
  activeIntegratorGitObservations.some((candidateText) => integratorGitStoryItemMatches(item, candidateText))

const mismatchExpectedTag = (item: StoryItem | undefined): string =>
  item?._tag === "ExpectedBehavior" ? item._tag : (item?._tag ?? "EndOfStory")

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
  readonly consumePlannedAttemptSuspensionExecutorBoundaryHold: Effect.Effect<
    Option.Option<
      typeof AuthoredCassetteStoryItem.cases.CassetteHoldsPlannedAttemptSuspensionBeforeExecutorBoundary.Type
    >
  >
  readonly consumePlannedAttemptContinuationExecutorBoundaryHold: Effect.Effect<
    Option.Option<
      typeof AuthoredCassetteStoryItem.cases.CassetteHoldsPlannedAttemptContinuationBeforeExecutorBoundary.Type
    >
  >
  readonly consumePlannedAttemptContinuationExecutorBoundaryRelease: Effect.Effect<
    Option.Option<typeof AuthoredCassetteStoryItem.cases.CassetteReleasesHeldPlannedAttemptContinuation.Type>
  >
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
  readonly consumeExecutorRequestPublicationHold: (
    taskId: TaskId,
    attemptId: AttemptId,
    request: AuthoredExecutorRequest
  ) => Effect.Effect<
    Option.Option<{
      readonly item: typeof AuthoredCassetteStoryItem.cases.DalphHoldsExecutorRequestThroughNextDeliveryPublication.Type
      readonly releaseAfterStoryPosition: number
    }>
  >
  readonly consumeCapacityChange: Effect.Effect<
    Option.Option<typeof AuthoredCassetteStoryItem.cases.SetTaskExecutionCapacity.Type>
  >
  readonly consumeRunReactivationHints: Effect.Effect<
    Option.Option<typeof AuthoredCassetteStoryItem.cases.CassetteOffersRunReactivationHints.Type>
  >
  readonly consumeCurrentTrackerNotification: Effect.Effect<
    Option.Option<typeof AuthoredCassetteStoryItem.cases.CassettePublishesCurrentTrackerNotification.Type>
  >
  readonly consumeAttemptChoice: Effect.Effect<Option.Option<AttemptChoiceItem>>
  readonly consumeDalphSelection: Effect.Effect<typeof AuthoredCassetteStoryItem.cases.DalphSelects.Type, CursorFailure>
  /** Concurrent operations wait for their exact authored selection instead of consuming a sibling selection. */
  readonly consumeDalphSelectionFor: (
    operation: CassetteDecision,
    context?: AuthoredOperationCausalContext
  ) => Effect.Effect<typeof AuthoredCassetteStoryItem.cases.DalphSelects.Type, ExactCausalCursorFailure>
  readonly consumeExecutorReport: Effect.Effect<AuthoredPlannedAttemptExecutorOutcomeItem, CursorFailure>
  /** Concurrent executor requests wait for the exact authored attempt and command response. */
  readonly consumeExecutorReportFor: (
    request: "Begin" | "Resume" | "Suspend",
    attemptId: AttemptId
  ) => Effect.Effect<AuthoredPlannedAttemptExecutorOutcomeItem, CursorFailure>
  /** Marks the exact executor command in flight before crash and response boundaries are inspected. */
  readonly beginExecutorReportRequest: (
    request: "Begin" | "Resume" | "Suspend",
    attemptId: AttemptId
  ) => Effect.Effect<void>
  /** Releases one exact in-flight executor command marker after its controlled boundary settles. */
  readonly endExecutorReportRequest: (
    request: "Begin" | "Resume" | "Suspend",
    attemptId: AttemptId
  ) => Effect.Effect<void>
  readonly consumeExecutorProjection: Effect.Effect<
    Option.Option<typeof AuthoredCassetteStoryItem.cases.PlannedAttemptExecutorProjectionReturned.Type>
  >
  /** Consume an executor lifecycle change only for its exact attached attempt owner. */
  readonly consumePassiveExecutorLifecycleChangeFor: (
    attemptId: AttemptId
  ) => Effect.Effect<
    Option.Option<typeof AuthoredCassetteStoryItem.cases.PlannedAttemptExecutorPassiveLifecycleChanged.Type>
  >
  /** Exact passive changes for one attached attempt; stories without that typed capability complete immediately. */
  readonly passiveExecutorLifecycleChangesFor: (
    attemptId: AttemptId
  ) => Stream.Stream<typeof AuthoredCassetteStoryItem.cases.PlannedAttemptExecutorPassiveLifecycleChanged.Type>
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
  /** Consume the result paired with one exact selected task-work specification read. */
  readonly consumeTaskWorkSpecificationFor: (
    taskId: TaskId,
    context?: AuthoredOperationCausalContext
  ) => Effect.Effect<
    typeof AuthoredCassetteStoryItem.cases.TaskWorkSpecificationReadReturned.Type,
    ExactCausalCursorFailure
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
  /** Consume the result paired with one exact selected complete tracker read. */
  readonly consumeTrackerGraphFor: (
    target: TrackerTarget,
    context?: AuthoredOperationCausalContext
  ) => Effect.Effect<AuthoredTrackerGraphReadResult, ExactCausalCursorFailure>
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
  const exactCausalStory = story.some(
    (item) =>
      item._tag === "ConcurrentTrackerReadBatch" ||
      (item._tag === "DalphSelects" && (item.causal !== undefined || item.causalAnchor !== undefined))
  )
  const position = yield* SubscriptionRef.make(0)
  const transition = yield* Semaphore.make(1)
  const concurrentInteractionGroupState = yield* Ref.make<ConcurrentInteractionGroupState | undefined>(undefined)
  interface ConcurrentTrackerReadMemberState {
    readonly context?: AuthoredOperationCausalContext
    readonly member: AuthoredConcurrentTrackerRead
    readonly resultConsumed: boolean
  }
  interface ConcurrentTrackerReadBatchState {
    readonly index: number
    readonly members: ReadonlyArray<ConcurrentTrackerReadMemberState>
  }
  interface CausalRegistry {
    readonly byOperationId: ReadonlyMap<string, string>
    readonly byRole: ReadonlyMap<string, AuthoredOperationCausalContext>
  }
  interface ExactCausalCursorState {
    readonly batch?: ConcurrentTrackerReadBatchState
    readonly causal: CausalRegistry
  }
  const exactCausalState = yield* Ref.make<ExactCausalCursorState>({
    causal: { byOperationId: new Map(), byRole: new Map() }
  })
  const controlDirectionBeforeAdmission = yield* SubscriptionRef.make<Option.Option<Deferred.Deferred<void>>>(
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
    "CassetteHoldsPlannedAttemptSuspensionBeforeExecutorBoundary",
    "CassetteReleasesHeldPlannedAttemptSuspension",
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

  const causalBindingIssue = (
    causal: { readonly occurrenceRole: AuthoredCausalSelection["occurrenceRole"] },
    context: AuthoredOperationCausalContext,
    registry: CausalRegistry
  ): string | undefined => {
    const role = String(causal.occurrenceRole)
    const priorForRole = registry.byRole.get(role)
    if (priorForRole !== undefined && priorForRole.operationId !== context.operationId) {
      return `authored causal role ${role} is already bound to another operation`
    }
    const priorRole = registry.byOperationId.get(String(context.operationId))
    if (priorRole !== undefined && priorRole !== role) {
      return `operation ${context.operationId} is already bound to causal role ${priorRole}`
    }
    return undefined
  }

  const causalPredecessorIssue = (
    causal: AuthoredCausalSelection,
    context: AuthoredOperationCausalContext,
    registry: CausalRegistry
  ): string | undefined => {
    const role = String(causal.occurrenceRole)
    const actualPredecessors = context.predecessorOperationIds.map(String)
    if (new Set(actualPredecessors).size !== actualPredecessors.length) {
      return `operation ${context.operationId} repeats one causal predecessor`
    }
    for (const predecessorRole of causal.predecessorRoles) {
      if (predecessorRole === causal.occurrenceRole) return `causal role ${role} cannot name itself as a predecessor`
      if (!registry.byRole.has(String(predecessorRole))) {
        return `causal predecessor ${predecessorRole} is not bound before ${role}`
      }
    }
    const expectedPredecessors = causal.predecessorRoles.map((predecessorRole) =>
      String(registry.byRole.get(String(predecessorRole))?.operationId)
    )
    return expectedPredecessors.length === actualPredecessors.length &&
      expectedPredecessors.every((operationId) => actualPredecessors.includes(operationId))
      ? undefined
      : `operation ${context.operationId} predecessors [${actualPredecessors.join(", ")}] do not exactly match authored ${role} predecessors [${expectedPredecessors.join(", ")}]`
  }

  const causalSelectionIssue = (
    causal: AuthoredCausalSelection,
    context: AuthoredOperationCausalContext | undefined,
    registry: CausalRegistry
  ): string | undefined =>
    context === undefined
      ? "a causally authored selection requires its exact raw operation identity"
      : (causalBindingIssue(causal, context, registry) ?? causalPredecessorIssue(causal, context, registry))

  const standaloneCausalSelectionIssue = (
    item: typeof AuthoredCassetteStoryItem.cases.DalphSelects.Type,
    context: AuthoredOperationCausalContext | undefined,
    registry: CausalRegistry
  ): string | undefined => {
    if (context === undefined) return "a causally authored selection requires its exact raw operation identity"
    if (item.causal !== undefined) return causalSelectionIssue(item.causal, context, registry)
    return item.causalAnchor === undefined
      ? "a causally authored selection requires one exact constraint"
      : causalBindingIssue(item.causalAnchor, context, registry)
  }

  const registerCausalSelection = (
    causal: { readonly occurrenceRole: AuthoredCausalSelection["occurrenceRole"] },
    context: AuthoredOperationCausalContext,
    registry: CausalRegistry
  ): CausalRegistry => ({
    byOperationId: new Map(registry.byOperationId).set(String(context.operationId), String(causal.occurrenceRole)),
    byRole: new Map(registry.byRole).set(String(causal.occurrenceRole), context)
  })

  const concurrentBatchFailure = (detail: string, storyPosition: number) =>
    new AuthoredConcurrentReadBatchFailure({ detail, storyPosition })

  const concurrentInteractionFailure = (detail: string, storyPosition: number) =>
    new AuthoredCassetteInteractionMismatch({ actual: detail, expected: "ConcurrentInteractionGroup", storyPosition })

  const claimConcurrentInteraction = Effect.fn("AuthoredCassette.claimConcurrentInteraction")(function* (
    claimKey: ConcurrentInteractionIncomingClaimKey
  ) {
    const result = yield* transition.withPermits(1)(
      Effect.gen(function* () {
        const index = yield* SubscriptionRef.get(position)
        const item = story[index]
        const prior = yield* Ref.get(concurrentInteractionGroupState)
        const decision = decideConcurrentInteractionClaim(item, index, prior, claimKey)
        if (decision._tag !== "Claimed") return decision
        return yield* Effect.uninterruptible(
          Effect.gen(function* () {
            yield* Ref.set(concurrentInteractionGroupState, decision.nextState)
            if (decision.completed) {
              yield* SubscriptionRef.set(position, decision.index + 1)
              // Completion publication is part of the same cursor transition:
              // this callback must not invoke another consuming cursor operation.
              yield* options.onOccurrence?.({ item: decision.item, storyPosition: decision.index + 1 }) ?? Effect.void
              yield* announceTerminalAssertions
            }
            return decision
          })
        )
      })
    )
    if (result._tag === "Failure") return yield* concurrentInteractionFailure(result.detail, result.index)
    if (result._tag === "None") return Option.none<AuthoredConcurrentInteractionMember>()
    return Option.some(result.member)
  })

  const claimConcurrentSelection = Effect.fn("AuthoredCassette.claimConcurrentSelection")(function* (
    operation: CassetteDecision
  ): Effect.fn.Return<Option.Option<ConcurrentSelectionMember>, AuthoredCassetteInteractionMismatch> {
    const claimed = yield* claimConcurrentInteraction({ _tag: "DalphSelects", operation })
    if (Option.isNone(claimed)) return Option.none<ConcurrentSelectionMember>()
    if (claimed.value._tag !== "DalphSelects") {
      return yield* concurrentInteractionFailure(
        "a selection claim resolved to an executor member",
        yield* SubscriptionRef.get(position)
      )
    }
    return Option.some(claimed.value)
  })

  const claimConcurrentExecutorReport = Effect.fn("AuthoredCassette.claimConcurrentExecutorReport")(function* (
    request: AuthoredExecutorRequest,
    attemptId: AttemptId
  ): Effect.fn.Return<Option.Option<ConcurrentExecutorMember>, AuthoredCassetteInteractionMismatch> {
    const claimed = yield* claimConcurrentInteraction({
      _tag: "PlannedAttemptExecutorWorkReported",
      attemptId,
      request
    })
    if (Option.isNone(claimed)) return Option.none<ConcurrentExecutorMember>()
    if (request !== "Begin" || claimed.value._tag !== "PlannedAttemptExecutorWorkReported") {
      return yield* concurrentInteractionFailure(
        "an executor claim resolved to an incompatible group member",
        yield* SubscriptionRef.get(position)
      )
    }
    return Option.some(claimed.value)
  })

  const currentConcurrentTrackerReadBatch = Effect.fn("AuthoredCassette.currentConcurrentTrackerReadBatch")(
    function* () {
      return yield* transition.withPermits(1)(
        Effect.gen(function* () {
          const index = yield* SubscriptionRef.get(position)
          const item = story[index]
          if (item?._tag !== "ConcurrentTrackerReadBatch") return undefined
          const current = yield* Ref.get(exactCausalState)
          if (current.batch?.index === index) return current.batch
          if (current.batch !== undefined) {
            return yield* concurrentBatchFailure(
              `concurrent tracker-read batch at story position ${current.batch.index} has not drained`,
              index
            )
          }
          const batch: ConcurrentTrackerReadBatchState = {
            index,
            members: item.members.map((member) => ({ member, resultConsumed: false }))
          }
          yield* Ref.set(exactCausalState, { ...current, batch })
          return batch
        })
      )
    }
  )

  const advanceConcurrentTrackerReadBatch = (batch: ConcurrentTrackerReadBatchState) =>
    Effect.gen(function* () {
      const advanced = yield* transition.withPermits(1)(
        Effect.gen(function* () {
          const current = yield* Ref.get(exactCausalState)
          if (current.batch?.index !== batch.index) return false
          if (current.batch.members.some(({ context, resultConsumed }) => context === undefined || !resultConsumed)) {
            return false
          }
          yield* Ref.set(exactCausalState, { causal: current.causal })
          yield* SubscriptionRef.set(position, batch.index + 1)
          return true
        })
      )
      if (!advanced) return
      const item = story[batch.index]
      if (item !== undefined) yield* options.onOccurrence?.({ item, storyPosition: batch.index + 1 }) ?? Effect.void
      yield* announceTerminalAssertions
    })

  const consumeConcurrentTrackerReadSelection = Effect.fn("AuthoredCassette.consumeConcurrentTrackerReadSelection")(
    function* (operation: CassetteDecision, context: AuthoredOperationCausalContext | undefined) {
      const batch = yield* currentConcurrentTrackerReadBatch()
      if (batch === undefined) return Option.none<typeof AuthoredCassetteStoryItem.cases.DalphSelects.Type>()
      type SelectionResult =
        | { readonly _tag: "Failure"; readonly causal: boolean; readonly detail: string }
        | {
            readonly _tag: "Selected"
            readonly batch: ConcurrentTrackerReadBatchState
            readonly selection: typeof AuthoredCassetteStoryItem.cases.DalphSelects.Type
          }
      const candidateIndexes = (current: ConcurrentTrackerReadBatchState, state: ExactCausalCursorState) => {
        const structural = current.members.flatMap(({ member }, index) =>
          cassetteDecisionMatches(member.operation, operation) ? [index] : []
        )
        const unclaimed = structural.filter((index) => current.members[index]?.context === undefined)
        const eligible = unclaimed.filter((index) => {
          const candidate = current.members[index]
          return (
            candidate !== undefined &&
            causalSelectionIssue(candidate.member.causal, context, state.causal) === undefined
          )
        })
        return { eligible, structural, unclaimed }
      }
      const failedSelection = (
        current: ConcurrentTrackerReadBatchState,
        state: ExactCausalCursorState,
        indexes: ReturnType<typeof candidateIndexes>
      ): SelectionResult => {
        const candidate = indexes.unclaimed[0] === undefined ? undefined : current.members[indexes.unclaimed[0]]
        const causalDetail =
          candidate === undefined ? undefined : causalSelectionIssue(candidate.member.causal, context, state.causal)
        const detail =
          indexes.structural.length === 0
            ? `unlisted concurrent tracker read ${JSON.stringify(operation)}`
            : indexes.unclaimed.length === 0
              ? `duplicate concurrent tracker read ${JSON.stringify(operation)}`
              : indexes.eligible.length > 1
                ? `concurrent tracker read ${JSON.stringify(operation)} matches more than one causal owner`
                : (causalDetail ?? `concurrent tracker read ${JSON.stringify(operation)} has no exact causal owner`)
        return { _tag: "Failure", causal: causalDetail !== undefined, detail }
      }
      const result = yield* transition.withPermits(1)(
        Ref.modify(exactCausalState, (state): readonly [SelectionResult, ExactCausalCursorState] => {
          const current = state.batch
          if (current?.index !== batch.index) {
            return [{ _tag: "Failure", causal: false, detail: "the concurrent tracker-read batch disappeared" }, state]
          }
          const indexes = candidateIndexes(current, state)
          if (indexes.eligible.length !== 1) return [failedSelection(current, state, indexes), state]
          const memberIndex = indexes.eligible[0]
          const member = memberIndex === undefined ? undefined : current.members[memberIndex]
          if (member === undefined || context === undefined) {
            return [{ _tag: "Failure", causal: true, detail: "the exact causal owner is missing" }, state]
          }
          const nextBatch: ConcurrentTrackerReadBatchState = {
            ...current,
            members: current.members.map((candidate, index) =>
              index === memberIndex ? { ...candidate, context } : candidate
            )
          }
          return [
            {
              _tag: "Selected",
              batch: nextBatch,
              selection: AuthoredCassetteStoryItem.cases.DalphSelects.make({
                causal: member.member.causal,
                operation: member.member.operation
              })
            },
            { batch: nextBatch, causal: registerCausalSelection(member.member.causal, context, state.causal) }
          ]
        })
      )
      if (result._tag === "Failure") {
        return yield* result.causal
          ? new AuthoredCausalSelectionFailure({ detail: result.detail, storyPosition: batch.index })
          : concurrentBatchFailure(result.detail, batch.index)
      }
      yield* advanceConcurrentTrackerReadBatch(result.batch)
      return Option.some(result.selection)
    }
  )

  const storyItemFromConcurrentTrackerReadResult = (result: AuthoredConcurrentTrackerReadResult): StoryItem => {
    switch (result._tag) {
      case "TaskWorkSpecificationReadReturned":
        return AuthoredCassetteStoryItem.cases.TaskWorkSpecificationReadReturned.make(result)
      case "TrackerGraphReadFailed":
        return AuthoredCassetteStoryItem.cases.TrackerGraphReadFailed.make(result)
      case "TrackerGraphReadReturned":
        return AuthoredCassetteStoryItem.cases.TrackerGraphReadReturned.make(result)
    }
  }

  const consumeConcurrentTrackerReadResult = Effect.fn("AuthoredCassette.consumeConcurrentTrackerReadResult")(
    function* (
      context: AuthoredOperationCausalContext | undefined,
      matches: (member: AuthoredConcurrentTrackerRead) => boolean
    ) {
      const batch = yield* currentConcurrentTrackerReadBatch()
      if (batch === undefined) return Option.none<StoryItem>()
      if (context === undefined) {
        return yield* new AuthoredCausalSelectionFailure({
          detail: "a concurrent tracker-read result requires its initiating operation identity",
          storyPosition: batch.index
        })
      }
      type Result =
        | { readonly _tag: "Failure"; readonly detail: string }
        | { readonly _tag: "Result"; readonly batch: ConcurrentTrackerReadBatchState; readonly item: StoryItem }
      const result: Result = yield* transition.withPermits(1)(
        Ref.modify(exactCausalState, (state): readonly [Result, ExactCausalCursorState] => {
          const current = state.batch
          if (current?.index !== batch.index) {
            return [{ _tag: "Failure", detail: "the concurrent tracker-read batch disappeared" }, state]
          }
          const matchesByOwner = current.members.flatMap((candidate, index) =>
            candidate.context?.operationId === context.operationId && matches(candidate.member) ? [index] : []
          )
          if (matchesByOwner.length !== 1) {
            return [
              { _tag: "Failure", detail: `missing duplicate or crossed result for operation ${context.operationId}` },
              state
            ]
          }
          const memberIndex = matchesByOwner[0]
          const member = memberIndex === undefined ? undefined : current.members[memberIndex]
          if (member === undefined || member.resultConsumed) {
            return [
              { _tag: "Failure", detail: `result for operation ${context.operationId} was already consumed` },
              state
            ]
          }
          const nextBatch: ConcurrentTrackerReadBatchState = {
            ...current,
            members: current.members.map((candidate, index) =>
              index === memberIndex ? { ...candidate, resultConsumed: true } : candidate
            )
          }
          return [
            { _tag: "Result", batch: nextBatch, item: storyItemFromConcurrentTrackerReadResult(member.member.result) },
            { ...state, batch: nextBatch }
          ]
        })
      )
      if (result._tag === "Failure") return yield* concurrentBatchFailure(result.detail, batch.index)
      yield* advanceConcurrentTrackerReadBatch(result.batch)
      return Option.some(result.item)
    }
  )

  const consumeStandaloneCausalSelection = Effect.fn("AuthoredCassette.consumeStandaloneCausalSelection")(function* (
    operation: CassetteDecision,
    context: AuthoredOperationCausalContext | undefined
  ) {
    type Result =
      | { readonly _tag: "Failure"; readonly detail: string; readonly index: number }
      | { readonly _tag: "None" }
      | {
          readonly _tag: "Selected"
          readonly index: number
          readonly item: typeof AuthoredCassetteStoryItem.cases.DalphSelects.Type
        }
    const result: Result = yield* transition.withPermits(1)(
      Effect.gen(function* () {
        const index = yield* SubscriptionRef.get(position)
        const item = story[index]
        if (
          !authoredDalphSelectionMatches(item, operation) ||
          (item.causal === undefined && item.causalAnchor === undefined)
        ) {
          return { _tag: "None" as const }
        }
        const state = yield* Ref.get(exactCausalState)
        const constraint = item.causal ?? item.causalAnchor
        /* v8 ignore next -- @preserve The enclosing condition requires one exact constraint. */
        if (constraint === undefined) return { _tag: "Failure" as const, detail: "missing constraint", index }
        const issue = standaloneCausalSelectionIssue(item, context, state.causal)
        if (issue !== undefined) return { _tag: "Failure" as const, detail: issue, index }
        /* v8 ignore next -- @preserve A successful causal check requires the context. */
        if (context === undefined) return { _tag: "Failure" as const, detail: "missing context", index }
        yield* Ref.set(exactCausalState, {
          ...state,
          causal: registerCausalSelection(constraint, context, state.causal)
        })
        yield* SubscriptionRef.set(position, index + 1)
        return { _tag: "Selected" as const, index, item }
      })
    )
    if (result._tag === "Failure") {
      return yield* new AuthoredCausalSelectionFailure({ detail: result.detail, storyPosition: result.index })
    }
    if (result._tag === "None") return Option.none()
    yield* options.onOccurrence?.({ item: result.item, storyPosition: result.index + 1 }) ?? Effect.void
    yield* announceTerminalAssertions
    return Option.some(result.item)
  })

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
    claimOptions: { readonly bypassControlBoundary?: boolean; readonly throughTransition?: boolean } = {}
  ): Effect.Effect<ClaimedStoryItem<A>> {
    return Effect.gen(function* () {
      // The coordinator-death probe runs from a durable journal append. It
      // must be able to inspect the next crash boundary while a
      // before-admission control gate is still awaiting completion; otherwise
      // the append that proves the control read deadlocks behind its own gate.
      if (claimOptions.bypassControlBoundary !== true && (yield* awaitControlBoundary())) {
        return yield* claimNext(predicate, claimOptions)
      }
      const claim = SubscriptionRef.modify(position, (index): readonly [ClaimedStoryItem<A>, number] => {
        const item = story[index]
        return predicate(item)
          ? [{ _tag: "Claimed" as const, index, item }, index + 1]
          : [{ _tag: "Mismatch" as const, index, item }, index]
      })
      const claimEffect = claimOptions.throughTransition === true ? transition.withPermits(1)(claim) : claim
      const claimed = yield* claimEffect
      if (claimed._tag === "Claimed") {
        yield* options.onOccurrence?.({ item: claimed.item, storyPosition: claimed.index + 1 }) ?? Effect.void
      }
      yield* announceTerminalAssertions
      const advanced = claimOptions.bypassControlBoundary === true ? false : yield* awaitBarrierAdvance(claimed)
      return advanced ? yield* claimNext(predicate, claimOptions) : claimed
    })
  }
  const consume = (tag: StoryItem["_tag"], options?: { readonly throughTransition: boolean }) =>
    Effect.gen(function* () {
      const claimed = yield* claimNext((item): item is StoryItem => item?._tag === tag, options)
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
  const awaitOwnedExecutorRequestPublicationHoldBeforeSelection = Effect.fn(
    "AuthoredCassette.awaitOwnedExecutorRequestPublicationHoldBeforeSelection"
  )(function* (item: StoryItem | undefined, index: number) {
    if (item?._tag !== "DalphHoldsExecutorRequestThroughNextDeliveryPublication") return false
    const ownership = SubscriptionRef.changes(activeExecutorReportRequests).pipe(
      Stream.filter((active) => active.some((candidate) => executorRequestPublicationHoldMatches(candidate, item)))
    )
    const isOwned = SubscriptionRef.get(activeExecutorReportRequests).pipe(
      Effect.map((active) => active.some((candidate) => executorRequestPublicationHoldMatches(candidate, item)))
    )
    const ownershipOrAdvance = yield* awaitOwnershipOrAdvance(ownership, index, isOwned)
    if (ownershipOrAdvance === "Unowned") return false
    if (ownershipOrAdvance === "Owned") yield* awaitsLaterStoryItem(position, index)
    return true
  })
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
  const consumeDalphSelectionOutsideConcurrentGroup: StoryCursor["consumeDalphSelectionFor"] = Effect.fn(
    "AuthoredCassette.consumeDalphSelectionOutsideConcurrentGroup"
  )(function* (operation, context) {
    if (exactCausalStory) {
      const concurrent = yield* consumeConcurrentTrackerReadSelection(operation, context)
      if (Option.isSome(concurrent)) return concurrent.value
      const causal = yield* consumeStandaloneCausalSelection(operation, context)
      if (Option.isSome(causal)) return causal.value
    }
    const claimed = yield* claimNext((item) => authoredDalphSelectionMatches(item, operation))
    if (claimed._tag === "Claimed") return claimed.item
    if (yield* awaitOwnedExecutorRequestPublicationHoldBeforeSelection(claimed.item, claimed.index)) {
      return yield* consumeDalphSelectionForLoop(operation, context)
    }
    const activeRequests = yield* SubscriptionRef.get(activeExecutorReportRequests)
    const activeIntegratorRequests = yield* SubscriptionRef.get(activeIntegratorGitObservations)
    if (selectionCanWaitAfterClaim(claimed.item, activeRequests, activeIntegratorRequests)) {
      yield* awaitsLaterStoryItem(position, claimed.index)
      return yield* consumeDalphSelectionForLoop(operation, context)
    }
    if (yield* awaitOwnedStoryItemImmediatelyBeforeSelection(claimed.item, claimed.index, operation)) {
      return yield* consumeDalphSelectionForLoop(operation, context)
    }
    return yield* new AuthoredCassetteInteractionMismatch({
      actual: JSON.stringify(operation),
      expected: mismatchExpectedTag(claimed.item),
      storyPosition: claimed.index
    })
  })
  const consumeDalphSelectionForLoop: StoryCursor["consumeDalphSelectionFor"] = Effect.fn(
    "AuthoredCassette.consumeDalphSelectionForLoop"
  )(function* (operation, context) {
    const grouped = yield* claimConcurrentSelection(operation)
    return yield* Option.match(grouped, {
      onNone: () => consumeDalphSelectionOutsideConcurrentGroup(operation, context),
      onSome: Effect.succeed
    })
  })
  const consumeDalphSelectionFor: StoryCursor["consumeDalphSelectionFor"] = Effect.fn(
    "AuthoredCassette.consumeDalphSelectionFor"
  )((operation, context) =>
    Effect.acquireUseRelease(
      SubscriptionRef.update(activeDalphSelections, (current) => [...current, operation]),
      () => consumeDalphSelectionForLoop(operation, context),
      () =>
        SubscriptionRef.update(activeDalphSelections, (current) => {
          const index = current.findIndex((selection) => cassetteDecisionMatches(selection, operation))
          return index < 0 ? current : [...current.slice(0, index), ...current.slice(index + 1)]
        })
    )
  )
  const consumeCoordinatorActivationReturned = consume("CoordinatorActivationReturned", {
    throughTransition: true
  }).pipe(
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
    const remaining = new Map([...gates].filter(([taskId]) => taskId !== claimed.item.taskId))
    yield* SubscriptionRef.set(taskWorkSpecificationReadBoundaries, remaining)
    return Option.some(claimed.item)
  })
  const consumeRunReactivationHints = Effect.gen(function* () {
    const claimed = yield* claimNext(
      (item): item is typeof AuthoredCassetteStoryItem.cases.CassetteOffersRunReactivationHints.Type =>
        item?._tag === "CassetteOffersRunReactivationHints"
    )
    return claimed._tag === "Mismatch" ? Option.none() : Option.some(claimed.item)
  })
  const consumeCurrentTrackerNotification = Effect.gen(function* () {
    const claimed = yield* claimNext(
      (item): item is typeof AuthoredCassetteStoryItem.cases.CassettePublishesCurrentTrackerNotification.Type =>
        item?._tag === "CassettePublishesCurrentTrackerNotification"
    )
    return claimed._tag === "Mismatch" ? Option.none() : Option.some(claimed.item)
  })
  const awaitTaskWorkSpecificationReadBoundary = (taskId: TaskId) =>
    SubscriptionRef.get(taskWorkSpecificationReadBoundaries).pipe(
      Effect.flatMap((gates) => {
        const release = gates.get(taskId)
        return release === undefined ? Effect.void : Deferred.await(release)
      })
    )
  const consumeExecutorRequestPublicationHold = (
    taskId: TaskId,
    attemptId: AttemptId,
    request: AuthoredExecutorRequest
  ) =>
    Effect.gen(function* () {
      const claimed = yield* claimNext(
        (
          item
        ): item is typeof AuthoredCassetteStoryItem.cases.DalphHoldsExecutorRequestThroughNextDeliveryPublication.Type =>
          item?._tag === "DalphHoldsExecutorRequestThroughNextDeliveryPublication" &&
          item.taskId === taskId &&
          item.attemptId === attemptId &&
          item.request === request
      )
      if (claimed._tag === "Mismatch") return Option.none()
      return Option.some({ item: claimed.item, releaseAfterStoryPosition: claimed.index + 1 })
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
  const consumeExecutorReportOutsideConcurrentGroup: StoryCursor["consumeExecutorReportFor"] = Effect.fn(
    "AuthoredCassette.consumeExecutorReportOutsideConcurrentGroup"
  )(function* (request, attemptId) {
    const claimed = yield* claimNext((item) => authoredExecutorReportMatches(item, request, attemptId))
    if (claimed._tag === "Claimed") {
      return yield* Schema.decodeUnknownEffect(AuthoredPlannedAttemptExecutorOutcomeItem)(claimed.item).pipe(
        Effect.orDie
      )
    }
    const currentReport = executorReportImmediatelyBefore(claimed.item, story[claimed.index + 1], request, attemptId)
    if (currentReport !== null) {
      if (!(yield* awaitOwnedExecutorReport(currentReport, claimed.index))) {
        return yield* new AuthoredCassetteInteractionMismatch({
          actual: `${request}/${attemptId}`,
          expected: claimed.item?._tag ?? "EndOfStory",
          storyPosition: claimed.index
        })
      }
      return yield* consumeExecutorReportForLoop(request, attemptId)
    }
    return yield* new AuthoredCassetteInteractionMismatch({
      actual: `${request}/${attemptId}`,
      expected: claimed.item?._tag ?? "EndOfStory",
      storyPosition: claimed.index
    })
  })
  const consumeExecutorReportForLoop: StoryCursor["consumeExecutorReportFor"] = Effect.fn(
    "AuthoredCassette.consumeExecutorReportFor"
  )(function* (request, attemptId) {
    const grouped = yield* claimConcurrentExecutorReport(request, attemptId)
    return yield* Option.match(grouped, {
      onNone: () => consumeExecutorReportOutsideConcurrentGroup(request, attemptId),
      onSome: Effect.succeed
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
  const consumePassiveExecutorLifecycleChangeFor: StoryCursor["consumePassiveExecutorLifecycleChangeFor"] = (
    attemptId
  ) =>
    Effect.gen(function* () {
      const claimed = yield* claimNext(
        (item): item is typeof AuthoredCassetteStoryItem.cases.PlannedAttemptExecutorPassiveLifecycleChanged.Type =>
          item?._tag === "PlannedAttemptExecutorPassiveLifecycleChanged" && item.report.attemptId === attemptId
      )
      if (claimed._tag === "Mismatch") return Option.none()
      return Option.some(
        yield* Schema.decodeUnknownEffect(
          AuthoredCassetteStoryItem.cases.PlannedAttemptExecutorPassiveLifecycleChanged
        )(claimed.item).pipe(Effect.orDie)
      )
    })
  const passiveExecutorLifecycleChangesFor: StoryCursor["passiveExecutorLifecycleChangesFor"] = (attemptId) => {
    if (
      !story.some(
        (item) => item._tag === "PlannedAttemptExecutorPassiveLifecycleChanged" && item.report.attemptId === attemptId
      )
    ) {
      return Stream.empty
    }
    return SubscriptionRef.changes(position).pipe(
      Stream.map((index) => story[index]),
      Stream.filter(
        (item) => item?._tag === "PlannedAttemptExecutorPassiveLifecycleChanged" && item.report.attemptId === attemptId
      ),
      Stream.mapEffect(() =>
        consumePassiveExecutorLifecycleChangeFor(attemptId).pipe(
          Effect.flatMap(
            Option.match({
              onNone: () => Effect.die(new Error(`authored passive lifecycle change for ${attemptId} disappeared`)),
              onSome: Effect.succeed
            })
          )
        )
      )
    )
  }
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
      () => consumeIntegratorGitObservationLoop(candidateText),
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
        Effect.andThen(consumeTargetPromotionGitReadLoop(repository, candidateCommit)),
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
    const claimed = yield* claimNext(
      (item): item is typeof AuthoredCassetteStoryItem.cases.CoordinatorProcessDies.Type =>
        item?._tag === "CoordinatorProcessDies",
      { bypassControlBoundary }
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
  const consumeTaskWorkSpecificationFor: StoryCursor["consumeTaskWorkSpecificationFor"] = Effect.fn(
    "AuthoredCassette.consumeTaskWorkSpecificationFor"
  )(function* (taskId, context) {
    const concurrent = yield* consumeConcurrentTrackerReadResult(
      context,
      (member) => member.operation._tag === "ReadTaskWorkSpecification" && member.operation.taskId === taskId
    )
    if (Option.isSome(concurrent)) {
      return yield* Schema.decodeUnknownEffect(AuthoredCassetteStoryItem.cases.TaskWorkSpecificationReadReturned)(
        concurrent.value
      ).pipe(Effect.orDie)
    }
    const result = yield* consumeTaskWorkSpecification
    if (result.taskId !== taskId) {
      return yield* new AuthoredCassetteInteractionMismatch({
        actual: `TaskWorkSpecificationReadReturned(${taskId})`,
        expected: `TaskWorkSpecificationReadReturned(${result.taskId})`,
        storyPosition: yield* SubscriptionRef.get(position)
      })
    }
    return result
  })
  const consumeTaskClaimRead = Effect.gen(function* () {
    const claimed = yield* claimNext(isTaskClaimReadItem)
    if (claimed._tag === "Mismatch") return Option.none()
    return Option.some(yield* Schema.decodeUnknownEffect(AuthoredTaskClaimReadItem)(claimed.item).pipe(Effect.orDie))
  })
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
  const consumeTrackerGraphLoop = Effect.fn("AuthoredCassette.consumeTrackerGraphLoop")(function* (): Effect.fn.Return<
    AuthoredTrackerGraphReadResult,
    CursorFailure
  > {
    const claimed = yield* claimNext(
      (item): item is AuthoredTrackerGraphReadResult =>
        item?._tag === "TrackerGraphReadFailed" ||
        item?._tag === "TrackerGraphReadReturned" ||
        item?._tag === "RunActivationFinalTrackerGraphReadReturned"
    )
    if (claimed._tag === "Mismatch") {
      const currentItem = claimed.item
      if (isAuthoredPlannedAttemptExecutorOutcomeItem(currentItem)) {
        const ownershipOrAdvance = yield* awaitOwnershipOrAdvance(
          SubscriptionRef.changes(activeExecutorReportRequests).pipe(
            Stream.filter((active) => active.some((candidate) => executorReportRequestMatches(candidate, currentItem)))
          ),
          claimed.index,
          SubscriptionRef.get(activeExecutorReportRequests).pipe(
            Effect.map((active) => active.some((candidate) => executorReportRequestMatches(candidate, currentItem)))
          )
        )
        if (ownershipOrAdvance !== "Unowned") {
          yield* awaitsLaterStoryItem(position, claimed.index)
          return yield* consumeTrackerGraphLoop()
        }
      }
    }
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
  const consumeTrackerGraph = consumeTrackerGraphLoop()
  const consumeTrackerGraphFor: StoryCursor["consumeTrackerGraphFor"] = Effect.fn(
    "AuthoredCassette.consumeTrackerGraphFor"
  )(function* (target, context) {
    const concurrent = yield* consumeConcurrentTrackerReadResult(
      context,
      (member) => member.operation._tag === "ReadTrackerGraph" && member.operation.target === target
    )
    if (Option.isSome(concurrent)) {
      return yield* Schema.decodeUnknownEffect(AuthoredTrackerGraphReadResult)(concurrent.value).pipe(Effect.orDie)
    }
    return yield* consumeTrackerGraph
  })
  return {
    completeControlDirectionBeforeDeliveryActionAdmission: Effect.gen(function* () {
      const gate = yield* SubscriptionRef.get(controlDirectionBeforeAdmission)
      /* v8 ignore next -- @preserve Closure pairs this completion with the exact earlier before-admission control item. */
      if (Option.isNone(gate)) return
      yield* SubscriptionRef.set(controlDirectionBeforeAdmission, Option.none())
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
    consumePlannedAttemptSuspensionExecutorBoundaryHold,
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
    consumeRunReactivationHints,
    consumeCurrentTrackerNotification,
    consumeControlDirection,
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
    consumePassiveExecutorLifecycleChangeFor,
    passiveExecutorLifecycleChangesFor,
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
    consumeTaskWorkSpecificationFor,
    consumeTerminalAssertions,
    consumeTrackerGraphFor,
    consumeTrackerGraph,
    pauseAtCoordinatorProcessDeath,
    storyItems: SubscriptionRef.changes(position).pipe(Stream.map((index) => story[index]))
  }
})
