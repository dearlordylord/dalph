import type { RunId } from "@dalph/contracts"
import type { JournalRecord } from "../../workflow-journal/store.js"
import type { JournalHistorySource } from "../../workflow-journal/record-evidence.js"
import { invalidIntegrationHistoryEvent, type IntegrationHistoryIndexes } from "./integration-history.js"
import { invalidWorkflowRunBinding } from "./integration-history-run-binding.js"

export const validateIntegrationHistoryRecord = <Indexes extends IntegrationHistoryIndexes>(
  record: JournalRecord,
  runId: RunId,
  indexes: Indexes,
  recordIdentityIssue: (detail: string) => void,
  recordSemanticIssue: (detail: string) => void,
  records: JournalHistorySource = [record]
): Indexes => {
  const bindingIssue = invalidWorkflowRunBinding(record.event, runId)
  if (bindingIssue !== undefined) recordIdentityIssue(bindingIssue)
  const historyValidation = invalidIntegrationHistoryEvent(record, indexes, records)
  if (historyValidation.detail !== undefined) recordSemanticIssue(historyValidation.detail)
  return historyValidation.indexes
}
