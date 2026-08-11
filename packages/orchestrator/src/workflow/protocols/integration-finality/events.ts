import { Context, type Effect, Match, Schema } from "effect"
import { evidenceReferenceEquals, TaskId, TaskRevision } from "@dalph/contracts"
import { taskTrackerTargetKey, type TrackerTarget } from "../../../authorities/task-tracker/target.js"
import { OperationId } from "../../identity.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  type ActiveTaskClaim,
  isExactTaskClaim,
  type TaskClaimObservation
} from "../../../authorities/task-tracker/claim-mutation.js"
import {
  TargetPromotionCorrelation,
  TargetPromotionGitReadObservation,
  targetPromotionCorrelationEquals
} from "../target-promotion/events.js"
import { EvidenceReference } from "../target-verification/evidence-store.js"
import {
  CompletionClaimDeletionRequest,
  CompletionClaimReplacementRequest,
  CompletionSuccessObservation,
  completionTaskClaimEquals,
  CompletionTaskClaim
} from "./completion-claim.js"
import type { FocusedTaskCompletionFacts } from "./focused-task-completion-facts.js"

export * from "./completion-claim.js"
export * from "./focused-task-completion-facts.js"

/** Stable operation identity for the one task-completion request derived from promotion. */
export const completionTaskOperationIdFor = (claim: CompletionTaskClaim): OperationId =>
  OperationId.make(`completion-task:${claim.promotionCorrelation.requestId}`)

/** The immutable completion request Q; retries retain this exact identity. */
export const CompletionTaskRequest = Schema.Struct({
  acceptanceManifest: EvidenceReference,
  claim: CompletionTaskClaim,
  integrationReviewManifest: EvidenceReference,
  operationId: OperationId,
  promotionCorrelation: TargetPromotionCorrelation,
  taskId: TaskId,
  taskRevision: TaskRevision,
  verificationManifest: EvidenceReference
}).check(
  Schema.makeFilter((request) => {
    const exactBinding =
      request.claim.plannedAttempt.taskId === request.taskId &&
      request.claim.plannedAttempt.taskRevision === request.taskRevision &&
      request.operationId === completionTaskOperationIdFor(request.claim) &&
      targetPromotionCorrelationEquals(request.claim.promotionCorrelation, request.promotionCorrelation) &&
      evidenceReferenceEquals(request.claim.acceptanceManifest, request.acceptanceManifest) &&
      evidenceReferenceEquals(request.claim.integrationReviewManifest, request.integrationReviewManifest) &&
      evidenceReferenceEquals(request.claim.verificationManifest, request.verificationManifest)
    return exactBinding
      ? undefined
      : "completion request must bind one exact task, revision, claim, promotion, and evidence"
  })
)
export type CompletionTaskRequest = typeof CompletionTaskRequest.Type

/** Compares the complete immutable task-completion request Q. */
export const completionTaskRequestEquals = (left: CompletionTaskRequest, right: CompletionTaskRequest): boolean =>
  left.operationId === right.operationId &&
  left.taskId === right.taskId &&
  left.taskRevision === right.taskRevision &&
  completionTaskClaimEquals(left.claim, right.claim) &&
  targetPromotionCorrelationEquals(left.promotionCorrelation, right.promotionCorrelation) &&
  evidenceReferenceEquals(left.acceptanceManifest, right.acceptanceManifest) &&
  evidenceReferenceEquals(left.integrationReviewManifest, right.integrationReviewManifest) &&
  evidenceReferenceEquals(left.verificationManifest, right.verificationManifest)

/**
 * Purely derives Q's immutable value from a promoted claim. This value carries
 * no current authority and establishes no workflow occurrence; the completion
 * protocol rereads every premise before it durably establishes Q's intent.
 */
export const completionTaskRequestFor = (claim: CompletionTaskClaim): CompletionTaskRequest =>
  CompletionTaskRequest.make({
    acceptanceManifest: claim.acceptanceManifest,
    claim,
    integrationReviewManifest: claim.integrationReviewManifest,
    operationId: completionTaskOperationIdFor(claim),
    promotionCorrelation: claim.promotionCorrelation,
    taskId: claim.plannedAttempt.taskId,
    taskRevision: claim.plannedAttempt.taskRevision,
    verificationManifest: claim.verificationManifest
  })

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
    taskId: TaskId,
    target: TrackerTarget,
    operationId: OperationId
  ) => Effect.Effect<FocusedTaskCompletionFacts, FocusedTaskCompletionReadFailure>
  readonly completeTask: (
    request: CompletionTaskRequest
  ) => Effect.Effect<CompletionTaskAcknowledgement, CompletionTaskRequestFailure>
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
  CompletionTaskIntendedEvent,
  CompletionTaskAttemptIntendedEvent,
  CompletionTaskAcknowledgedEvent,
  CompletionTaskResponseLostEvent,
  CompletionTaskRejectedEvent,
  CompletionTaskCandidateAncestryReadIntendedEvent,
  CompletionTaskCandidateAncestryObservedEvent,
  CompletionTaskRequestLookupIntendedEvent,
  CompletionTaskRequestLookupObservedEvent
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
export type { ActiveTaskClaim, TaskClaimObservation }
export { isExactTaskClaim }
