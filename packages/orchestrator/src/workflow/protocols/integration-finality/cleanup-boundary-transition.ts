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
  previous.call._tag === "ReadBeforeDeletionAttempt"
    ? next.call._tag === "DeleteAttempt" && next.call.attemptOrdinal === previous.call.attemptOrdinal
    : previous.call._tag === "DeleteAttempt"
      ? (next.call._tag === "ReadBeforeDeletionAttempt" &&
          Number(next.call.attemptOrdinal) === Number(previous.call.attemptOrdinal) + 1) ||
        (next.call._tag === "ReadAfterDeletionAttemptsExhausted" &&
          next.call.attemptOrdinal === previous.call.attemptOrdinal &&
          Number(previous.call.attemptOrdinal) === completionClaimRequestLimit)
      : false
