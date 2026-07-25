import type { WorkflowJournalEvent } from "./journal-store.js"

type ManagedHistoryTransitionRule =
  | { readonly _tag: "Intent" }
  | { readonly _tag: "Observation"; readonly requiredIntent: JournalEventTag }
  | { readonly _tag: "Outcome"; readonly requiredIntent: JournalEventTag }
  | {
    readonly _tag: "ProviderOutcome"
    readonly requiredIntent: JournalEventTag
    readonly requiredProof: JournalEventTag
  }

type JournalEventTag = WorkflowJournalEvent["_tag"]

const intent = { _tag: "Intent" } as const
const observation = (requiredIntent: JournalEventTag): ManagedHistoryTransitionRule => ({
  _tag: "Observation",
  requiredIntent
})
const outcome = (
  requiredIntent: JournalEventTag,
  requiredProof?: JournalEventTag
): ManagedHistoryTransitionRule =>
  requiredProof === undefined
    ? { _tag: "Outcome", requiredIntent }
    : { _tag: "ProviderOutcome", requiredIntent, requiredProof }

const transitionRuleByEventKind: Partial<Record<JournalEventTag, ManagedHistoryTransitionRule>> = {
  ImplementationEvidenceSealed: outcome("ImplementationEvidenceSealingIntended"),
  ImplementationEvidenceSealingIntended: intent,
  ImplementationReviewCompleted: outcome("ImplementationReviewIntended"),
  ImplementationReviewIntended: intent,
  ReviewFindingsHandbackCompleted: outcome("ReviewFindingsHandbackIntended"),
  ReviewFindingsHandbackIntended: intent,
  TaskClaimAcquired: outcome("TaskClaimAcquisitionIntended"),
  TaskClaimAcquisitionIntended: intent,
  TaskExecutionIntentRecorded: intent,
  TaskExecutionObservationFailed: observation("TaskExecutionIntentRecorded"),
  TaskExecutionOutcomeObserved: outcome("TaskExecutionIntentRecorded", "TaskExecutionReported"),
  TaskExecutionReported: observation("TaskExecutionIntentRecorded"),
  TaskExecutionRequestAttemptRecorded: observation("TaskExecutionIntentRecorded"),
  TaskExecutionRequestFailed: observation("TaskExecutionIntentRecorded"),
  TaskExecutionRequestReturned: observation("TaskExecutionIntentRecorded"),
  TaskWorkSessionEstablished: outcome("TaskWorkSessionEstablishmentIntentRecorded", "TaskWorkSessionReported"),
  TaskWorkSessionEstablishmentIntentRecorded: intent,
  TaskWorkSessionLookupFailed: observation("TaskWorkSessionEstablishmentIntentRecorded"),
  TaskWorkSessionLookupRequested: observation("TaskWorkSessionEstablishmentIntentRecorded"),
  TaskWorkSessionReported: observation("TaskWorkSessionEstablishmentIntentRecorded"),
  TaskWorkStartRequestAcknowledged: observation("TaskWorkSessionEstablishmentIntentRecorded"),
  TaskWorkStartRequestFailed: observation("TaskWorkSessionEstablishmentIntentRecorded"),
  TaskWorkStartRequested: observation("TaskWorkSessionEstablishmentIntentRecorded"),
  TaskWorktreeReady: outcome("TaskWorktreeReconciliationIntended"),
  TaskWorktreeReconciliationIntended: intent,
  TrackerGraphObservationIntentRecorded: intent,
  TrackerGraphOutcomeObserved: outcome("TrackerGraphObservationIntentRecorded")
}

/** One canonical causal role and predecessor rule for a journal event kind. */
export const managedHistoryTransitionRuleFor = (
  eventKind: JournalEventTag
): ManagedHistoryTransitionRule | undefined => transitionRuleByEventKind[eventKind]
