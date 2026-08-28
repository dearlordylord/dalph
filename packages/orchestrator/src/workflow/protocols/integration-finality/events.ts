import { Context, type Effect, Match, Schema } from "effect"
import { TaskId } from "@dalph/contracts"
import { taskTrackerTargetKey } from "../../../authorities/task-tracker/target.js"
import { OperationId } from "../../identity.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  type ActiveTaskClaim,
  isExactTaskClaim,
  type TaskClaimObservation
} from "../../../authorities/task-tracker/claim-mutation.js"
import { TargetPromotionGitReadObservation } from "../target-promotion/events.js"
import {
  CompletionClaimDeletionRequest,
  CompletionClaimCleanupObservation,
  CompletionClaimReplacementRequest,
  CompletionSuccessObservation,
  completionTaskClaimEquals,
  CompletionTaskClaim
} from "./completion-claim.js"
import type { FocusedTaskCompletionFacts } from "./focused-task-completion-facts.js"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import type { TaskTrackerMutationThrottled } from "../../../authorities/task-tracker/mutation-throttling.js"
import type { FocusedTaskCompletionReadRequest } from "./focused-task-completion-request.js"
import { CompletionTaskRequest } from "./completion-task-request.js"

export * from "./completion-claim.js"
export * from "./completion-task-request.js"
export * from "./focused-task-completion-facts.js"
export * from "./focused-task-completion-request.js"

/** The tracker acknowledged one exact completion request; this is not success evidence. */
export const CompletionTaskAcknowledgement = Schema.Struct({ operationId: OperationId, taskId: TaskId })
export type CompletionTaskAcknowledgement = typeof CompletionTaskAcknowledgement.Type

/** Exact-request lookup outcomes are closed and never inferred from current lifecycle. */
export const CompletionTaskRequestLookup = Schema.TaggedUnion({
  Applied: { request: CompletionTaskRequest },
  NotApplied: { request: CompletionTaskRequest },
  Unreadable: { detail: Schema.String, request: CompletionTaskRequest }
})
export type CompletionTaskRequestLookup = typeof CompletionTaskRequestLookup.Type

/** Tracker completion request boundary failure with an explicit ambiguity class. */
export class CompletionTaskRequestFailure extends Schema.TaggedError<CompletionTaskRequestFailure>()(
  "IntegrationFinality.CompletionTaskRequestFailure",
  {
    detail: Schema.String,
    outcome: Schema.Literals(["DefinitelyNotApplied", "Unknown"]),
    request: CompletionTaskRequest
  }
) {}

/** Focused task facts were incomplete, contradictory, or unreadable. */
export class FocusedTaskCompletionReadFailure extends Schema.TaggedError<FocusedTaskCompletionReadFailure>()(
  "IntegrationFinality.FocusedTaskCompletionReadFailure",
  { detail: Schema.String, taskId: TaskId }
) {}

/** Exact-request lookup itself could not establish Applied or NotApplied. */
export class CompletionTaskRequestLookupFailure extends Schema.TaggedError<CompletionTaskRequestLookupFailure>()(
  "IntegrationFinality.CompletionTaskRequestLookupFailure",
  { detail: Schema.String, request: CompletionTaskRequest }
) {}

export interface CompletionTaskBoundaryService {
  readonly readFocusedTaskCompletion: (
    request: FocusedTaskCompletionReadRequest
  ) => Effect.Effect<FocusedTaskCompletionFacts, FocusedTaskCompletionReadFailure>
  readonly completeTask: (
    request: CompletionTaskRequest
  ) => Effect.Effect<CompletionTaskAcknowledgement, CompletionTaskRequestFailure | TaskTrackerMutationThrottled>
  readonly readCompletionRequest: (
    request: CompletionTaskRequest
  ) => Effect.Effect<CompletionTaskRequestLookup, CompletionTaskRequestLookupFailure>
}

export class CompletionTaskBoundary extends Context.Service<CompletionTaskBoundary, CompletionTaskBoundaryService>()(
  "@dalph/CompletionTaskBoundary"
) {}

/** Positive ordinal for one bounded completion request. */
export const CompletionTaskRequestOrdinal = Schema.Int.check(Schema.isGreaterThan(0)).pipe(
  Schema.brand("CompletionTaskRequestOrdinal")
)
export type CompletionTaskRequestOrdinal = typeof CompletionTaskRequestOrdinal.Type

/** Positive ordinal for one focused confirmation read of a numbered completion call. */
export const CompletionTaskConfirmationReadOrdinal = Schema.Int.check(Schema.isGreaterThan(0)).pipe(
  Schema.brand("CompletionTaskConfirmationReadOrdinal")
)
export type CompletionTaskConfirmationReadOrdinal = typeof CompletionTaskConfirmationReadOrdinal.Type

/** Positive ordinal for one restart-distinct current-authorization read cycle before a numbered completion call. */
export const CompletionTaskAuthorizationReadOrdinal = Schema.Int.check(Schema.isGreaterThan(0)).pipe(
  Schema.brand("CompletionTaskAuthorizationReadOrdinal")
)
export type CompletionTaskAuthorizationReadOrdinal = typeof CompletionTaskAuthorizationReadOrdinal.Type

/**
 * Exact tracker chronology that requires Git to reprove promoted-candidate
 * ancestry before Dalph may replace the task's active claim.
 */
export const PostPromotionBlockerClearAuthorization = Schema.Struct({
  blockerClearedAt: JournalPosition,
  blockerObservedAt: JournalPosition,
  claim: CompletionTaskClaim
}).check(
  Schema.makeFilter((authorization) =>
    authorization.blockerObservedAt < authorization.blockerClearedAt
      ? undefined
      : "post-promotion blocker clearance must follow the blocker observation"
  )
)
export type PostPromotionBlockerClearAuthorization = typeof PostPromotionBlockerClearAuthorization.Type

/** Stable identity for one exact post-promotion blocker-clear ancestry read. */
export const postPromotionBlockerAncestryOperationIdFor = (
  authorization: PostPromotionBlockerClearAuthorization
): OperationId =>
  OperationId.make(
    `post-promotion-blocker-ancestry:${authorization.claim.promotionCorrelation.requestId}:${authorization.blockerObservedAt}:${authorization.blockerClearedAt}`
  )

/** Git either returned a normalized ancestry fact or the read remained unavailable. */
export const PostPromotionBlockerCandidateAncestryObservation = Schema.TaggedUnion({
  Observed: { observation: TargetPromotionGitReadObservation },
  Unreadable: { detail: Schema.String }
})
export type PostPromotionBlockerCandidateAncestryObservation =
  typeof PostPromotionBlockerCandidateAncestryObservation.Type

/** Durable intent before the Git read required by one exact blocker-clear chronology. */
export const PostPromotionBlockerCandidateAncestryReadIntendedEvent = Schema.TaggedStruct(
  "PostPromotionBlockerCandidateAncestryReadIntended",
  {
    authorization: PostPromotionBlockerClearAuthorization,
    operationId: OperationId,
    version: Schema.Literal(workflowJournalEventVersion)
  }
).check(
  Schema.makeFilter((event) =>
    event.operationId === postPromotionBlockerAncestryOperationIdFor(event.authorization)
      ? undefined
      : "post-promotion blocker ancestry intent must use its exact deterministic identity"
  )
)
export type PostPromotionBlockerCandidateAncestryReadIntendedEvent =
  typeof PostPromotionBlockerCandidateAncestryReadIntendedEvent.Type

/** Durable Git outcome for one exact post-promotion blocker-clear ancestry intent. */
export const PostPromotionBlockerCandidateAncestryObservedEvent = Schema.TaggedStruct(
  "PostPromotionBlockerCandidateAncestryObserved",
  {
    authorization: PostPromotionBlockerClearAuthorization,
    observation: PostPromotionBlockerCandidateAncestryObservation,
    operationId: OperationId,
    version: Schema.Literal(workflowJournalEventVersion)
  }
).check(
  Schema.makeFilter((event) =>
    event.operationId === postPromotionBlockerAncestryOperationIdFor(event.authorization)
      ? undefined
      : "post-promotion blocker ancestry outcome must use its exact deterministic identity"
  )
)
export type PostPromotionBlockerCandidateAncestryObservedEvent =
  typeof PostPromotionBlockerCandidateAncestryObservedEvent.Type

/** Issue #61's fixed completion mutation bound. */
export const completionTaskRequestLimit = 3 as const // eslint-disable-line no-magic-numbers
export const CompletionTaskRequestLimit = Schema.Literal(completionTaskRequestLimit)
export type CompletionTaskRequestLimit = typeof CompletionTaskRequestLimit.Type

/** Why one task-local read is required in the bounded completion chronology. */
export const CompletionTaskFocusedReadPurpose = Schema.TaggedUnion({
  Authorization: {
    attemptOrdinal: CompletionTaskRequestOrdinal,
    authorizationOrdinal: CompletionTaskAuthorizationReadOrdinal
  },
  Confirmation: {
    attemptOrdinal: CompletionTaskRequestOrdinal,
    confirmationOrdinal: CompletionTaskConfirmationReadOrdinal
  }
})
export type CompletionTaskFocusedReadPurpose = typeof CompletionTaskFocusedReadPurpose.Type

/** Compares the complete variant and numbered call that one focused read serves. */
export const completionTaskFocusedReadPurposeEquals = (
  left: CompletionTaskFocusedReadPurpose,
  right: CompletionTaskFocusedReadPurpose
): boolean =>
  Match.valueTags(left, {
    Authorization: ({ attemptOrdinal, authorizationOrdinal }) =>
      right._tag === "Authorization" &&
      right.attemptOrdinal === attemptOrdinal &&
      right.authorizationOrdinal === authorizationOrdinal,
    Confirmation: ({ attemptOrdinal, confirmationOrdinal }) =>
      right._tag === "Confirmation" &&
      right.attemptOrdinal === attemptOrdinal &&
      right.confirmationOrdinal === confirmationOrdinal
  })

/** Positive ordinal for one bounded replacement or deletion request. */
export const CompletionClaimRequestOrdinal = Schema.Int.check(Schema.isGreaterThan(0)).pipe(
  Schema.brand("CompletionClaimRequestOrdinal")
)
export type CompletionClaimRequestOrdinal = typeof CompletionClaimRequestOrdinal.Type

/** Positive restart-distinct ordinal for one cleanup reread serving a numbered deletion attempt. */
export const CompletionClaimCleanupReadOrdinal = Schema.Int.check(Schema.isGreaterThan(0)).pipe(
  Schema.brand("CompletionClaimCleanupReadOrdinal")
)
export type CompletionClaimCleanupReadOrdinal = typeof CompletionClaimCleanupReadOrdinal.Type

/** The fixed request bound for each completion-claim mutation. */
export const completionClaimRequestLimit = 3 as const // eslint-disable-line no-magic-numbers
export const CompletionClaimRequestLimit = Schema.Literal(completionClaimRequestLimit)
export type CompletionClaimRequestLimit = typeof CompletionClaimRequestLimit.Type

/** Records intent before the first request to replace the exact active claim. */
export const CompletionClaimReplacementIntendedEvent = Schema.TaggedStruct("CompletionClaimReplacementIntended", {
  claim: CompletionTaskClaim,
  operationId: OperationId,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type CompletionClaimReplacementIntendedEvent = typeof CompletionClaimReplacementIntendedEvent.Type

/** Records intent before one numbered replacement request. */
export const CompletionClaimReplacementAttemptIntendedEvent = Schema.TaggedStruct(
  "CompletionClaimReplacementAttemptIntended",
  {
    attemptOrdinal: CompletionClaimRequestOrdinal,
    claim: CompletionTaskClaim,
    operationId: OperationId,
    version: Schema.Literal(workflowJournalEventVersion)
  }
)
export type CompletionClaimReplacementAttemptIntendedEvent = typeof CompletionClaimReplacementAttemptIntendedEvent.Type

/** The replacement response or a later fresh read proved the exact completion claim current. */
export const CompletionClaimReplacedEvent = Schema.TaggedStruct("CompletionClaimReplaced", {
  claim: CompletionTaskClaim,
  operationId: OperationId,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type CompletionClaimReplacedEvent = typeof CompletionClaimReplacedEvent.Type

/** Records intent before deleting the exact completion claim after fresh success. */
export const CompletionClaimDeletionIntendedEvent = Schema.TaggedStruct("CompletionClaimDeletionIntended", {
  claim: CompletionTaskClaim,
  operationId: OperationId,
  successObservation: CompletionSuccessObservation,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type CompletionClaimDeletionIntendedEvent = typeof CompletionClaimDeletionIntendedEvent.Type

/** Records intent before one numbered deletion request. */
export const CompletionClaimDeletionAttemptIntendedEvent = Schema.TaggedStruct(
  "CompletionClaimDeletionAttemptIntended",
  {
    attemptOrdinal: CompletionClaimRequestOrdinal,
    claim: CompletionTaskClaim,
    operationId: OperationId,
    successObservation: CompletionSuccessObservation,
    version: Schema.Literal(workflowJournalEventVersion)
  }
)
export type CompletionClaimDeletionAttemptIntendedEvent = typeof CompletionClaimDeletionAttemptIntendedEvent.Type

/** Why Dalph reread the exact completion claim during its bounded deletion cleanup. */
export const CompletionClaimDeletionReadPurpose = Schema.TaggedUnion({
  BeforeOriginalClaimRelease: { readOrdinal: CompletionClaimCleanupReadOrdinal },
  /** Current tracker proof, after one exact marker reread, that the already-released original claim remains absent. */
  ConfirmOriginalClaimReleased: {
    attemptOrdinal: CompletionClaimRequestOrdinal,
    readOrdinal: CompletionClaimCleanupReadOrdinal
  },
  /** Current tracker proof, after marker-specific absence, that no active claim now occupies the task. */
  ConfirmNoActiveClaimAfterMarkerAbsent: {
    attemptOrdinal: CompletionClaimRequestOrdinal,
    readOrdinal: CompletionClaimCleanupReadOrdinal
  },
  BeforeDeletionAttempt: {
    attemptOrdinal: CompletionClaimRequestOrdinal,
    readOrdinal: CompletionClaimCleanupReadOrdinal
  },
  AfterDeletionAttemptsExhausted: {
    attemptOrdinal: CompletionClaimRequestOrdinal,
    readOrdinal: CompletionClaimCleanupReadOrdinal
  }
}).check(
  Schema.makeFilter((purpose) =>
    purpose._tag !== "AfterDeletionAttemptsExhausted" || purpose.attemptOrdinal === completionClaimRequestLimit
      ? undefined
      : "exhausted completion-claim cleanup read must follow the final bounded attempt"
  )
)
export type CompletionClaimDeletionReadPurpose = typeof CompletionClaimDeletionReadPurpose.Type

/** The exact claim state returned by one cleanup reread before deletion or terminal reconciliation. */
export const CompletionClaimDeletionReadObservedEvent = Schema.TaggedStruct("CompletionClaimDeletionReadObserved", {
  observation: CompletionClaimCleanupObservation,
  purpose: CompletionClaimDeletionReadPurpose,
  replacementOperationId: OperationId,
  request: CompletionClaimDeletionRequest,
  version: Schema.Literal(workflowJournalEventVersion)
}).check(
  Schema.makeFilter((event) => {
    const observedTaskId =
      event.observation._tag === "CompletionTaskClaim"
        ? event.observation.plannedAttempt.taskId
        : event.observation.taskId
    return observedTaskId === event.request.claim.plannedAttempt.taskId
      ? undefined
      : "completion-claim cleanup read must observe the exact requested task"
  })
)
export type CompletionClaimDeletionReadObservedEvent = typeof CompletionClaimDeletionReadObservedEvent.Type

/** The deletion response or a later fresh read proved the exact completion claim absent. */
export const CompletionClaimDeletedEvent = Schema.TaggedStruct("CompletionClaimDeleted", {
  claim: CompletionTaskClaim,
  operationId: OperationId,
  successObservation: CompletionSuccessObservation,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type CompletionClaimDeletedEvent = typeof CompletionClaimDeletedEvent.Type

/** Task-scoped integration responsibility settlement after fresh success and exact deletion. */
export const IntegrationFinalitySettledEvent = Schema.TaggedStruct("IntegrationFinalitySettled", {
  claim: CompletionTaskClaim,
  deletionOperationId: OperationId,
  replacementOperationId: OperationId,
  successObservation: CompletionSuccessObservation,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type IntegrationFinalitySettledEvent = typeof IntegrationFinalitySettledEvent.Type

/** Durable intent before constructing one exact task-completion request Q. */
export const CompletionTaskIntendedEvent = Schema.TaggedStruct("CompletionTaskIntended", {
  request: CompletionTaskRequest,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type CompletionTaskIntendedEvent = typeof CompletionTaskIntendedEvent.Type

/** Durable intent before one numbered tracker completion call. */
export const CompletionTaskAttemptIntendedEvent = Schema.TaggedStruct("CompletionTaskAttemptIntended", {
  attemptOrdinal: CompletionTaskRequestOrdinal,
  focusedFactsOperationId: OperationId,
  gitReadOperationId: OperationId,
  request: CompletionTaskRequest,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type CompletionTaskAttemptIntendedEvent = typeof CompletionTaskAttemptIntendedEvent.Type

/** Tracker acknowledgement is retained separately from focused success. */
export const CompletionTaskAcknowledgedEvent = Schema.TaggedStruct("CompletionTaskAcknowledged", {
  acknowledgement: CompletionTaskAcknowledgement,
  attemptOrdinal: CompletionTaskRequestOrdinal,
  request: CompletionTaskRequest,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type CompletionTaskAcknowledgedEvent = typeof CompletionTaskAcknowledgedEvent.Type

/** A process or transport boundary lost the direct completion response. */
export const CompletionTaskResponseLostEvent = Schema.TaggedStruct("CompletionTaskResponseLost", {
  attemptOrdinal: CompletionTaskRequestOrdinal,
  request: CompletionTaskRequest,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type CompletionTaskResponseLostEvent = typeof CompletionTaskResponseLostEvent.Type

/** The tracker definitively rejected one numbered Q call without applying it. */
export const CompletionTaskRejectedEvent = Schema.TaggedStruct("CompletionTaskRejected", {
  attemptOrdinal: CompletionTaskRequestOrdinal,
  detail: Schema.String,
  request: CompletionTaskRequest,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type CompletionTaskRejectedEvent = typeof CompletionTaskRejectedEvent.Type

/** Durable intent before asking the tracker for exact task-local completion facts. */
/** Durable intent before asking Git whether the promoted candidate remains in target ancestry. */
export const CompletionTaskCandidateAncestryReadIntendedEvent = Schema.TaggedStruct(
  "CompletionTaskCandidateAncestryReadIntended",
  {
    attemptOrdinal: CompletionTaskRequestOrdinal,
    operationId: OperationId,
    request: CompletionTaskRequest,
    version: Schema.Literal(workflowJournalEventVersion)
  }
)
export type CompletionTaskCandidateAncestryReadIntendedEvent =
  typeof CompletionTaskCandidateAncestryReadIntendedEvent.Type

/** Git's normalized current-head and candidate-ancestry result for one exact read intent. */
export const CompletionTaskCandidateAncestryObservedEvent = Schema.TaggedStruct(
  "CompletionTaskCandidateAncestryObserved",
  {
    attemptOrdinal: CompletionTaskRequestOrdinal,
    observation: TargetPromotionGitReadObservation,
    operationId: OperationId,
    request: CompletionTaskRequest,
    version: Schema.Literal(workflowJournalEventVersion)
  }
)
export type CompletionTaskCandidateAncestryObservedEvent = typeof CompletionTaskCandidateAncestryObservedEvent.Type

/** Durable intent before asking the tracker how it classified exact request Q. */
export const CompletionTaskRequestLookupIntendedEvent = Schema.TaggedStruct("CompletionTaskRequestLookupIntended", {
  attemptOrdinal: CompletionTaskRequestOrdinal,
  operationId: OperationId,
  request: CompletionTaskRequest,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type CompletionTaskRequestLookupIntendedEvent = typeof CompletionTaskRequestLookupIntendedEvent.Type

/** The exact-request lookup recorded Applied, NotApplied, or Unreadable. */
export const CompletionTaskRequestLookupObservedEvent = Schema.TaggedStruct("CompletionTaskRequestLookupObserved", {
  attemptOrdinal: CompletionTaskRequestOrdinal,
  lookup: CompletionTaskRequestLookup,
  operationId: OperationId,
  request: CompletionTaskRequest,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type CompletionTaskRequestLookupObservedEvent = typeof CompletionTaskRequestLookupObservedEvent.Type

/** Closed claim-replacement, cleanup, and settlement event vocabulary. */
export const CompletionClaimFinalityJournalEvent = Schema.Union([
  CompletionClaimReplacementIntendedEvent,
  CompletionClaimReplacementAttemptIntendedEvent,
  CompletionClaimReplacedEvent,
  CompletionClaimDeletionIntendedEvent,
  CompletionClaimDeletionAttemptIntendedEvent,
  CompletionClaimDeletedEvent,
  IntegrationFinalitySettledEvent
])
export type CompletionClaimFinalityJournalEvent = typeof CompletionClaimFinalityJournalEvent.Type

/** Closed completion-claim and task-settlement event vocabulary. */
export const IntegrationFinalityJournalEvent = Schema.Union([
  CompletionClaimFinalityJournalEvent,
  CompletionClaimDeletionReadObservedEvent,
  CompletionTaskIntendedEvent,
  CompletionTaskAttemptIntendedEvent,
  CompletionTaskAcknowledgedEvent,
  CompletionTaskResponseLostEvent,
  CompletionTaskRejectedEvent,
  CompletionTaskCandidateAncestryReadIntendedEvent,
  CompletionTaskCandidateAncestryObservedEvent,
  CompletionTaskRequestLookupIntendedEvent,
  CompletionTaskRequestLookupObservedEvent,
  PostPromotionBlockerCandidateAncestryReadIntendedEvent,
  PostPromotionBlockerCandidateAncestryObservedEvent
])
export type IntegrationFinalityJournalEvent = typeof IntegrationFinalityJournalEvent.Type

/** Compares the exact proof used to authorize cleanup. */
export const completionSuccessObservationEquals = (
  left: CompletionSuccessObservation,
  right: CompletionSuccessObservation
): boolean => {
  if (left.observedAt !== right.observedAt || left.operationId !== right.operationId || left.taskId !== right.taskId) {
    return false
  }
  if (left.trackerRevision !== right.trackerRevision) return false
  return (
    completionTaskClaimEquals(left.claim, right.claim) &&
    left.taskRevision === right.taskRevision &&
    taskTrackerTargetKey(left.target) === taskTrackerTargetKey(right.target)
  )
}

/** Derives stable operation identity for replacement of one promoted claim. */
export const completionClaimReplacementOperationIdFor = (claim: CompletionTaskClaim): OperationId =>
  OperationId.make(`completion-claim-replacement:${claim.promotionCorrelation.requestId}`)

/** Derives stable operation identity for deletion of one promoted claim. */
export const completionClaimDeletionOperationIdFor = (claim: CompletionTaskClaim): OperationId =>
  OperationId.make(`completion-claim-deletion:${claim.promotionCorrelation.requestId}`)

/** Creates the exact replacement request from the promotion-bound claim. */
export const completionClaimReplacementRequestFor = (
  claim: CompletionTaskClaim,
  operationId: OperationId = completionClaimReplacementOperationIdFor(claim)
): CompletionClaimReplacementRequest => CompletionClaimReplacementRequest.make({ claim, operationId })

/** Creates the exact deletion request from fresh task success evidence. */
export const completionClaimDeletionRequestFor = (
  claim: CompletionTaskClaim,
  successObservation: CompletionSuccessObservation,
  operationId: OperationId = completionClaimDeletionOperationIdFor(claim)
): CompletionClaimDeletionRequest => CompletionClaimDeletionRequest.make({ claim, operationId, successObservation })

// Keep these imports in the module's public type surface without making callers
// re-import the claim observation identities from the provider adapter.
export { type ActiveTaskClaim, isExactTaskClaim, type TaskClaimObservation }
