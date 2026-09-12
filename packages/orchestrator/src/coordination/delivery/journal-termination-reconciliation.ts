import type { RunId } from "@dalph/contracts"
import { Schema } from "effect"
import type { AcceptedJournalPrefix } from "../../workflow-journal/accepted-prefix.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { workflowRunTerminatedRecordKey } from "../../workflow-journal/record-key.js"
import { journalRecordAt } from "../../workflow-journal/record-sequence.js"
import { JournalRecordMismatch, type JournalRecord } from "../../workflow-journal/store.js"
import { RunFinalityEvidence, type RunTerminationDisposition } from "../frontier/run-finality.js"

/** Reconciliation must retain every already-published occurrence before accepting a recovered terminal write. */
export const persistedPrefixMismatch = (
  prefix: AcceptedJournalPrefix,
  records: ReadonlyArray<JournalRecord>,
  runId: RunId
): JournalRecordMismatch | undefined => {
  for (let offset = 0; offset < prefix.records.length; offset += 1) {
    const prior = journalRecordAt(prefix.records, offset)
    if (JSON.stringify(prior) !== JSON.stringify(records[offset])) {
      return new JournalRecordMismatch({
        key: prior?.key ?? workflowRunTerminatedRecordKey,
        position: prior?.position ?? JournalPosition.make(offset + 1),
        runId
      })
    }
  }
  return undefined
}

/** A returned terminal occurrence acknowledges only the exact requested disposition and finality evidence. */
export const acknowledgedTerminationMatches = (
  record: JournalRecord,
  runId: RunId,
  disposition: RunTerminationDisposition,
  evidence: RunFinalityEvidence
): boolean =>
  record.key === workflowRunTerminatedRecordKey &&
  record.runId === runId &&
  record.event._tag === "WorkflowRunTerminated" &&
  record.event.disposition === disposition &&
  Schema.toEquivalence(RunFinalityEvidence)(record.event.evidence, evidence)
