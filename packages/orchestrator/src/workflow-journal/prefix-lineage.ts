import type { JournalRecord } from "./store.js"
import type { ValidWorkflowJournalHistory } from "../coordination/reconstruction/history-result.js"

interface JournalPrefixSuccessor {
  readonly appended: JournalRecord
  readonly prior: ReadonlyArray<JournalRecord>
}

const successorByPrefix = new WeakMap<object, JournalPrefixSuccessor>()

/** Records process-local lineage only after reconstruction accepted both exact prefixes. */
export const rememberValidatedJournalPrefixSuccessor = (
  prior: Pick<ValidWorkflowJournalHistory, "records" | "runId">,
  successor: Pick<ValidWorkflowJournalHistory, "records" | "runId">,
  appended: JournalRecord
): void => {
  const priorLength = prior.records.length
  const exactSuccessor =
    successor.runId === prior.runId &&
    successor.records.length === priorLength + 1 &&
    successor.records[priorLength] === appended &&
    prior.records.every((record, index) => successor.records[index] === record)
  if (!exactSuccessor) return
  successorByPrefix.set(successor.records, { appended, prior: prior.records })
}

/** Returns process-local lineage only; restart intentionally begins without it. */
export const journalPrefixPredecessorOf = (records: object): JournalPrefixSuccessor | undefined =>
  successorByPrefix.get(records)
