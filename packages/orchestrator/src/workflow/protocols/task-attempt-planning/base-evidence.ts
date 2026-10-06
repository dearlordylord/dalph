import type { AttemptBasePolicy } from "./base.js"
import { journalRecordByKey, type JournalHistorySource } from "../../../workflow-journal/record-evidence.js"
import { workflowRunBeganRecordKey } from "../../../workflow-journal/record-key.js"

/** Immutable Run policy; absence is retained as historical evidence, never defaulted. */
export const acceptedAttemptBasePolicy = (records: JournalHistorySource): AttemptBasePolicy | undefined => {
  const beginning = journalRecordByKey(records, workflowRunBeganRecordKey)?.event
  return beginning?._tag === "WorkflowRunBegan" ? beginning.attemptBasePolicy : undefined
}
