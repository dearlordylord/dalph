import type { RunId } from "@dalph/contracts"
import type { JournalRecord } from "../../workflow-journal/store.js"
import { invalidIntegrationHistoryEvent, type IntegrationHistoryIndexes } from "./integration-history.js"
import { invalidIntegrationRunBinding } from "./integration-history-run-binding.js"

export const validateIntegrationHistoryRecord = (
  record: JournalRecord,
  runId: RunId,
  indexes: IntegrationHistoryIndexes,
  recordIdentityIssue: (detail: string) => void,
  recordSemanticIssue: (detail: string) => void,
  records: ReadonlyArray<JournalRecord> = [record]
): void => {
  const bindingIssue = invalidIntegrationRunBinding(record.event, runId)
  if (bindingIssue !== undefined) recordIdentityIssue(bindingIssue)
  const historyIssue = invalidIntegrationHistoryEvent(record, indexes, records)
  if (historyIssue !== undefined) recordSemanticIssue(historyIssue)
}
