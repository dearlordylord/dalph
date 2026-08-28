import { Match } from "effect"
import type { InterruptibleWorkflowBoundaryIntent } from "../../interpretation/interruptible-boundary.js"
import { completionClaimRequestLimit, completionSuccessObservationEquals, completionTaskClaimEquals } from "./events.js"

/** Allows only the next exact call in one value-equal completion-claim cleanup disposition. */
export const continuesCompletionClaimCleanup = (
  previous: InterruptibleWorkflowBoundaryIntent,
  next: InterruptibleWorkflowBoundaryIntent
): boolean =>
  previous._tag === "CompletionClaimCleanup" &&
  next._tag === "CompletionClaimCleanup" &&
  previous.sequenceId === next.sequenceId &&
  previous.replacementOperationId === next.replacementOperationId &&
  previous.request.operationId === next.request.operationId &&
  completionTaskClaimEquals(previous.request.claim, next.request.claim) &&
  completionSuccessObservationEquals(previous.request.successObservation, next.request.successObservation) &&
  matchCleanupCall(previous, next)

const matchCleanupCall = (
  previous: Extract<InterruptibleWorkflowBoundaryIntent, { readonly _tag: "CompletionClaimCleanup" }>,
  next: Extract<InterruptibleWorkflowBoundaryIntent, { readonly _tag: "CompletionClaimCleanup" }>
): boolean =>
  Match.valueTags(previous.call, {
    ConfirmNoActiveClaimAfterMarkerAbsent: () => false,
    ConfirmOriginalClaimReleased: ({ attemptOrdinal }) =>
      next.call._tag === "DeleteAttempt" && next.call.attemptOrdinal === attemptOrdinal,
    DeleteAttempt: ({ attemptOrdinal }) => followsMarkerDelete(attemptOrdinal, next),
    ReadAfterDeletionAttemptsExhausted: ({ attemptOrdinal }) => followsMarkerAbsenceRead(attemptOrdinal, next),
    ReadBeforeDeletionAttempt: ({ attemptOrdinal }) => followsMarkerRead(attemptOrdinal, next),
    ReadBeforeOriginalClaimRelease: () => next.call._tag === "ReleaseOriginalClaim",
    ReleaseOriginalClaim: () => beginsCompletionMarkerDeletion(next)
  })

type CleanupIntent = Extract<InterruptibleWorkflowBoundaryIntent, { readonly _tag: "CompletionClaimCleanup" }>
type CleanupCall = CleanupIntent["call"]

const beginsCompletionMarkerDeletion = (next: CleanupIntent): boolean =>
  next.call._tag === "ReadBeforeDeletionAttempt" && Number(next.call.attemptOrdinal) === 1

const followsMarkerRead = (
  attemptOrdinal: Extract<CleanupCall, { readonly _tag: "ReadBeforeDeletionAttempt" }>["attemptOrdinal"],
  next: CleanupIntent
): boolean =>
  (next.call._tag === "ConfirmOriginalClaimReleased" ||
    (next.call._tag === "ConfirmNoActiveClaimAfterMarkerAbsent" && Number(attemptOrdinal) > 1)) &&
  next.call.attemptOrdinal === attemptOrdinal

const followsMarkerAbsenceRead = (
  attemptOrdinal: Extract<CleanupCall, { readonly _tag: "ReadAfterDeletionAttemptsExhausted" }>["attemptOrdinal"],
  next: CleanupIntent
): boolean => next.call._tag === "ConfirmNoActiveClaimAfterMarkerAbsent" && next.call.attemptOrdinal === attemptOrdinal

const followsMarkerDelete = (
  attemptOrdinal: Extract<CleanupCall, { readonly _tag: "DeleteAttempt" }>["attemptOrdinal"],
  next: CleanupIntent
): boolean =>
  (next.call._tag === "ReadBeforeDeletionAttempt" && Number(next.call.attemptOrdinal) === Number(attemptOrdinal) + 1) ||
  (next.call._tag === "ReadAfterDeletionAttemptsExhausted" &&
    next.call.attemptOrdinal === attemptOrdinal &&
    Number(attemptOrdinal) === completionClaimRequestLimit)
