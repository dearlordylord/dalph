import type { SavedArchiveBytes } from "../archive-retention.js"
import { decideWorkflowRunTermination } from "../run-lifecycle.js"
import type { RunFinalityEvidence, RunTerminationDisposition } from "../../coordination/frontier/run-finality.js"
import {
  type RunHistoryDeletion,
  type RunCompletionInspection,
  type RunCompletionTiming,
  compactRunCompletion,
  sameRunCompletion,
  type RunCompletion,
  type RunCompletionTime
} from "../completion.js"
import type { RunId } from "@dalph/contracts"
import { Effect } from "effect"
import { decideJournalPartitionHistory } from "../partition-history.js"
import {
  WorkflowRunAlreadyTerminated,
  type WorkflowRunNotBegan,
  type WorkflowRunTerminationEvidenceInvalid,
  JournalDataCorruption,
  JournalHistoryCorruption,
  JournalPartitionContradiction,
  type JournalRecord,
  type JournalStoreOperation
} from "../store.js"

export interface MemoryJournalState {
  readonly archiveBytes: ReadonlyMap<RunId, SavedArchiveBytes>
  readonly deletions: ReadonlyMap<RunId, RunHistoryDeletion>
  readonly completions: ReadonlyMap<RunId, RunCompletion>
  readonly hotRecordsByRun: ReadonlyMap<RunId, ReadonlyArray<JournalRecord>>
  readonly coldRecordsByRun: ReadonlyMap<RunId, ReadonlyArray<JournalRecord>>
}
const lastRecordIndex = -1

/** Seeded legacy fixtures use the same canonical adoption rule as physical storage. */
export const adoptMemoryCompletions = (
  state: MemoryJournalState,
  baseline: RunCompletionTime
): ReadonlyMap<RunId, RunCompletion> =>
  [...state.hotRecordsByRun, ...state.coldRecordsByRun].reduce((adopted, [runId, records]) => {
    if (adopted.has(runId)) return adopted
    const decision = decideJournalPartitionHistory("Hot", runId, records)
    if (decision._tag === "InvalidPartitionHistory" || !decision.isTerminal) return adopted
    const completion = compactRunCompletion(runId, decision.records, {
      _tag: "LegacyBaseline",
      originalTime: "Unknown",
      verifiedAt: baseline
    })
    return completion === undefined ? adopted : new Map([...adopted, [runId, completion] as const])
  }, state.completions)

/** Reads bounded metadata only for known completion; invalid legacy candidates remain errors. */
export const decideMemoryCompletion = (
  state: MemoryJournalState,
  runId: RunId,
  operation: JournalStoreOperation
): RunCompletionInspection | JournalPartitionContradiction | JournalHistoryCorruption | JournalDataCorruption => {
  const hot = state.hotRecordsByRun.get(runId)
  const cold = state.coldRecordsByRun.get(runId)
  if (cold !== undefined && hot !== undefined) return new JournalPartitionContradiction({ runId })
  const records = hot ?? cold ?? []
  const receipt = state.completions.get(runId)
  if (receipt === undefined) {
    if (records.at(lastRecordIndex)?.event._tag === "WorkflowRunTerminated") {
      const decision = decideJournalPartitionHistory(cold === undefined ? "Hot" : "Cold", runId, records)
      if (decision._tag === "InvalidPartitionHistory")
        return new JournalHistoryCorruption({
          operation,
          detail: decision.issue.detail,
          partition: cold === undefined ? "Hot" : "Cold",
          runId
        })
    }
    return { _tag: "NoCompletion" as const, runId }
  }
  const deletion = state.deletions.get(runId)
  if (deletion !== undefined) {
    if (hot !== undefined || cold !== undefined)
      return new JournalDataCorruption({ operation, detail: `deleted history still has rows for ${runId}` })
    return { _tag: "CompletedRun", completion: receipt, history: "Deleted", deletion }
  }
  const began = records[0]
  const terminal = records.at(lastRecordIndex)
  const publication =
    receipt.publication._tag === "RecordedPublication" ? records[receipt.publication.recordedAt - 1] : undefined
  const endpoints = [began, publication, terminal].filter((record): record is JournalRecord => record !== undefined)
  const expected = compactRunCompletion(runId, endpoints, receipt.timing)
  if (expected === undefined || !sameRunCompletion(receipt, expected))
    return new JournalDataCorruption({ operation, detail: `completion/history contradiction for ${runId}` })
  return { _tag: "CompletedRun" as const, completion: receipt, history: "Available" as const }
}

export const readMemoryCompletion = (state: MemoryJournalState, runId: RunId, operation: JournalStoreOperation) => {
  const decision = decideMemoryCompletion(state, runId, operation)
  return decision._tag === "NoCompletion" || decision._tag === "CompletedRun"
    ? Effect.succeed(decision)
    : Effect.fail(decision)
}

/** The terminal occurrence and independent result become visible through one immutable state transition. */
export const memoryTerminationTransition = (
  current: MemoryJournalState,
  runId: RunId,
  disposition: RunTerminationDisposition,
  evidence: RunFinalityEvidence,
  timing: RunCompletionTiming
): readonly [
  Effect.Effect<
    JournalRecord,
    | JournalDataCorruption
    | WorkflowRunAlreadyTerminated
    | WorkflowRunNotBegan
    | WorkflowRunTerminationEvidenceInvalid
    | JournalPartitionContradiction
    | JournalHistoryCorruption
  >,
  MemoryJournalState
] => {
  const completionDecision = decideMemoryCompletion(current, runId, "JournalStore.terminateRun")
  if (completionDecision._tag === "CompletedRun")
    return [
      Effect.fail(
        new WorkflowRunAlreadyTerminated({ runId, terminatedAt: completionDecision.completion.terminatedAt })
      ),
      current
    ]
  if (completionDecision._tag !== "NoCompletion") return [Effect.fail(completionDecision), current]
  const cold = current.coldRecordsByRun.get(runId)
  const hot = current.hotRecordsByRun.get(runId)
  if (cold !== undefined && hot !== undefined)
    return [Effect.fail(new JournalPartitionContradiction({ runId })), current]
  const records = hot ?? cold ?? []
  const decision = decideWorkflowRunTermination(records, runId, disposition, evidence)
  if (decision._tag === "LifecycleTransitionRejected") {
    return [Effect.fail(decision.failure), current]
  }
  if (cold !== undefined) {
    return [
      Effect.fail(
        new JournalHistoryCorruption({
          detail: "cold partition contains nonterminal history",
          operation: "JournalStore.terminateRun",
          partition: "Cold",
          runId
        })
      ),
      current
    ]
  }
  const record = decision.record
  const hotRecordsByRun = new Map([...current.hotRecordsByRun, [runId, [...records, record]] as const])
  const full = [...records, record]
  const validation = decideJournalPartitionHistory("Hot", runId, full)
  if (validation._tag === "InvalidPartitionHistory")
    return [
      Effect.fail(
        new JournalDataCorruption({ operation: "JournalStore.terminateRun", detail: validation.issue.detail })
      ),
      current
    ]
  const completion = compactRunCompletion(runId, full, timing)
  if (completion === undefined)
    return [
      Effect.fail(
        new JournalDataCorruption({ operation: "JournalStore.terminateRun", detail: "missing terminal metadata" })
      ),
      current
    ]
  const completions = new Map([...current.completions, [runId, completion] as const])
  return [Effect.succeed(record), { ...current, hotRecordsByRun, completions }]
}
