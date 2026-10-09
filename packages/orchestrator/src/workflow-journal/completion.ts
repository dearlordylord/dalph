import { RunCompletion, type RunCompletionTiming, type RunCompletionInspection } from "./completion-model.js"
import type { RunId } from "@dalph/contracts"
import { Effect, Schema } from "effect"
import { taskTrackerTargetKey, type TrackerTarget } from "../authorities/task-tracker/target.js"
import { decideJournalPartitionHistory } from "./partition-history.js"
import {
  JournalDataCorruption,
  WorkflowRunTargetMismatch,
  WorkflowRunAlreadyTerminated,
  type JournalRecord
} from "./store.js"

export * from "./completion-model.js"

const lastRecordIndex = -1

/** Extract only bounded terminal metadata from an already canonically validated chronology. */
export const compactRunCompletion = (
  runId: RunId,
  records: ReadonlyArray<JournalRecord>,
  timing: RunCompletionTiming
): RunCompletion | undefined => {
  const began = records[0]
  const terminal = records.at(lastRecordIndex)
  if (began?.event._tag !== "WorkflowRunBegan" || terminal?.event._tag !== "WorkflowRunTerminated") return undefined
  const publication = records.findLast(({ event }) => event._tag === "RemotePublicationSucceeded")
  return RunCompletion.make({
    runId,
    target: began.event.target,
    disposition: terminal.event.disposition,
    terminatedAt: terminal.position,
    timing,
    publication:
      publication?.event._tag === "RemotePublicationSucceeded"
        ? {
            _tag: "RecordedPublication",
            candidateCommit: publication.event.correlation.qualifiedCandidate.candidateCommit,
            target: publication.event.correlation.target,
            proof: publication.event.proof,
            recordedAt: publication.position
          }
        : { _tag: "NoRecordedPublication" }
  })
}

/** The canonical reducer, not a bare terminal tag, authorizes creation or verification of a completion record. */
export const verifiedRunCompletion = Effect.fn("RunCompletion.verify")(function* (
  runId: RunId,
  records: ReadonlyArray<JournalRecord>,
  timing: RunCompletionTiming
) {
  const decision = decideJournalPartitionHistory("Hot", runId, records)
  if (decision._tag === "InvalidPartitionHistory") {
    return yield* new JournalDataCorruption({ operation: "JournalStore.readCompletion", detail: decision.issue.detail })
  }
  return compactRunCompletion(runId, decision.records, timing)
})

export const sameRunCompletion = Schema.toEquivalence(RunCompletion)

/** Target mismatch is distinct from a same-target terminal identity. */
export const completedRunRecoveryFailure = (
  runId: RunId,
  target: TrackerTarget,
  inspection: RunCompletionInspection
) =>
  inspection._tag !== "CompletedRun"
    ? undefined
    : taskTrackerTargetKey(inspection.completion.target) !== taskTrackerTargetKey(target)
      ? new WorkflowRunTargetMismatch({ runId, recordedTarget: inspection.completion.target, requestedTarget: target })
      : new WorkflowRunAlreadyTerminated({ runId, terminatedAt: inspection.completion.terminatedAt })
