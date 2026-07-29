import type { WorkflowJournalEvent } from "./journal-store.js"

type JournalEventTag = WorkflowJournalEvent["_tag"]

type WorkflowJournalTransitionRule =
  | { readonly _tag: "Intent" }
  | { readonly _tag: "Outcome"; readonly requiredIntent: JournalEventTag }

const transitionRuleByEventKind: Partial<Record<JournalEventTag, WorkflowJournalTransitionRule>> = {
  TaskClaimAcquired: { _tag: "Outcome", requiredIntent: "TaskClaimAcquisitionIntended" },
  TaskClaimAcquisitionIntended: { _tag: "Intent" },
  TaskWorktreeReady: { _tag: "Outcome", requiredIntent: "TaskWorktreeReconciliationIntended" },
  TaskWorktreeReconciliationIntended: { _tag: "Intent" },
  TaskTrackerReadIntentRecorded: { _tag: "Intent" },
  TaskTrackerFactsObserved: { _tag: "Outcome", requiredIntent: "TaskTrackerReadIntentRecorded" }
}

export const workflowJournalTransitionRuleFor = (
  eventKind: JournalEventTag
): WorkflowJournalTransitionRule | undefined => transitionRuleByEventKind[eventKind]
