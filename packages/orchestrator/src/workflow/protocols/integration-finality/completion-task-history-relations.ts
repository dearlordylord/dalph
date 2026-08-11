import { taskTrackerTargetKey } from "../../../authorities/task-tracker/target.js"
import type { WorkflowJournalEvent } from "../../registry/event.js"
import type { FocusedTaskCompletionFactsObserved } from "../../task-tracker-facts/observation.js"
import { completionTaskFocusedReadPurposeEquals, completionTaskRequestEquals } from "./events.js"

/** One canonical focused task-completion outcome retained in workflow history. */
export type FocusedCompletionFactsObservedEvent = Extract<
  WorkflowJournalEvent,
  { readonly _tag: "TaskTrackerFactsObserved" }
> & { readonly observation: FocusedTaskCompletionFactsObserved }

export const isFocusedCompletionFactsObserved = (
  event: WorkflowJournalEvent
): event is FocusedCompletionFactsObservedEvent =>
  event._tag === "TaskTrackerFactsObserved" && event.observation._tag === "FocusedTaskCompletionFacts"

export const focusedCompletionIntentMatchesOutcome = (
  intent: WorkflowJournalEvent | undefined,
  event: FocusedCompletionFactsObservedEvent
): boolean =>
  intent?._tag === "TaskTrackerReadIntentRecorded" &&
  intent.operation._tag === "ReadCompletionTaskFacts" &&
  completionTaskRequestEquals(intent.operation.request, event.observation.request) &&
  completionTaskFocusedReadPurposeEquals(intent.operation.purpose, event.observation.purpose) &&
  taskTrackerTargetKey(intent.operation.target) === taskTrackerTargetKey(event.observation.target)

export const focusedCompletionOutcomeMatchesRunTarget = (
  event: FocusedCompletionFactsObservedEvent,
  runBeginning: WorkflowJournalEvent | undefined
): boolean =>
  runBeginning?._tag !== "WorkflowRunBegan" ||
  taskTrackerTargetKey(runBeginning.target) === taskTrackerTargetKey(event.observation.target)
