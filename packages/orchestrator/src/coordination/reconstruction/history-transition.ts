import type { WorkflowJournalEvent } from "../../workflow/registry/event.js"

type JournalEventTag = WorkflowJournalEvent["_tag"]

type WorkflowJournalTransitionRule =
  | { readonly _tag: "Intent" }
  | { readonly _tag: "Outcome"; readonly requiredIntent: JournalEventTag }

const transitionRuleByEventKind: Partial<Record<JournalEventTag, WorkflowJournalTransitionRule>> = {
  TaskClaimAcquired: { _tag: "Outcome", requiredIntent: "TaskClaimAcquisitionIntended" },
  TaskClaimAcquisitionRejected: { _tag: "Outcome", requiredIntent: "TaskClaimAcquisitionIntended" },
  TaskClaimAcquisitionIntended: { _tag: "Intent" },
  TaskClaimReleaseIntended: { _tag: "Intent" },
  TaskClaimReleased: { _tag: "Outcome", requiredIntent: "TaskClaimReleaseIntended" },
  TaskWorktreeReady: { _tag: "Outcome", requiredIntent: "TaskWorktreeReconciliationIntended" },
  TaskWorktreeReconciliationIntended: { _tag: "Intent" },
  GitReadIntentRecorded: { _tag: "Intent" },
  PlannedAttemptWorktreeObserved: { _tag: "Outcome", requiredIntent: "GitReadIntentRecorded" },
  TargetLineageObserved: { _tag: "Outcome", requiredIntent: "GitReadIntentRecorded" },
  TaskTrackerReadIntentRecorded: { _tag: "Intent" },
  TaskTrackerFactsObserved: { _tag: "Outcome", requiredIntent: "TaskTrackerReadIntentRecorded" }
}

export const workflowJournalTransitionRuleFor = (
  event: WorkflowJournalEvent
): WorkflowJournalTransitionRule | undefined =>
  event._tag === "AttemptRestartAuthorityReadFailed"
    ? {
        _tag: "Outcome",
        requiredIntent:
          event.failure._tag === "AttemptRestartTaskFactsReadFailure"
            ? "TaskTrackerReadIntentRecorded"
            : "GitReadIntentRecorded"
      }
    : transitionRuleByEventKind[event._tag]
