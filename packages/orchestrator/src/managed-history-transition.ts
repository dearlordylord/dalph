import type { WorkflowJournalEvent } from "./journal-store.js"

type JournalEventTag = WorkflowJournalEvent["_tag"]

type ManagedHistoryTransitionRule =
  | { readonly _tag: "Intent" }
  | { readonly _tag: "Outcome"; readonly requiredIntent: JournalEventTag }

const transitionRuleByEventKind: Partial<Record<JournalEventTag, ManagedHistoryTransitionRule>> = {
  TaskClaimAcquired: { _tag: "Outcome", requiredIntent: "TaskClaimAcquisitionIntended" },
  TaskClaimAcquisitionIntended: { _tag: "Intent" },
  TaskWorktreeReady: { _tag: "Outcome", requiredIntent: "TaskWorktreeReconciliationIntended" },
  TaskWorktreeReconciliationIntended: { _tag: "Intent" },
  TrackerGraphObservationIntentRecorded: { _tag: "Intent" },
  TrackerGraphOutcomeObserved: { _tag: "Outcome", requiredIntent: "TrackerGraphObservationIntentRecorded" }
}

export const managedHistoryTransitionRuleFor = (eventKind: JournalEventTag): ManagedHistoryTransitionRule | undefined =>
  transitionRuleByEventKind[eventKind]
