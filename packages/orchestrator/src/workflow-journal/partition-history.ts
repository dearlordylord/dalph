import type { RunId } from "@dalph/contracts"
import type { JournalPartition } from "./identity.js"
import { JournalSemanticIssue } from "./recovery-model.js"
import type { JournalRecord } from "./store.js"
import { workflowJournalHistoryIssueDetail } from "../coordination/reconstruction/history-result.js"
import { reduceWorkflowJournalHistory } from "../coordination/reconstruction/history.js"

const lastRecordIndex = -1
const coldHistoryNotTerminal = "Cold history is not terminal"

type JournalPartitionHistoryDecision =
  | { readonly _tag: "InvalidPartitionHistory"; readonly issue: JournalSemanticIssue }
  | {
      readonly _tag: "ValidPartitionHistory"
      readonly isTerminal: boolean
      readonly records: ReadonlyArray<JournalRecord>
    }

/**
 * Reduces one complete physical partition history once, reporting canonical
 * semantic defects and requiring every Cold history to end in Run termination.
 */
export const decideJournalPartitionHistory = (
  partition: JournalPartition,
  runId: RunId,
  records: ReadonlyArray<JournalRecord>
): JournalPartitionHistoryDecision => {
  const reduction = reduceWorkflowJournalHistory(runId, records)
  if (reduction._tag === "InvalidWorkflowJournalHistory") {
    return {
      _tag: "InvalidPartitionHistory",
      issue: new JournalSemanticIssue({
        detail: reduction.issues.map(workflowJournalHistoryIssueDetail).join("; "),
        partition,
        runId
      })
    }
  }
  const isTerminal = reduction.records.at(lastRecordIndex)?.event._tag === "WorkflowRunTerminated"
  if (partition === "Cold" && !isTerminal) {
    return {
      _tag: "InvalidPartitionHistory",
      issue: new JournalSemanticIssue({ detail: coldHistoryNotTerminal, partition, runId })
    }
  }
  return { _tag: "ValidPartitionHistory", isTerminal, records: reduction.records }
}
