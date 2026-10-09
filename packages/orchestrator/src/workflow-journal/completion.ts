import { GitCommitSha, RemotePublicationTarget, RunId } from "@dalph/contracts"
import { Effect, Schema } from "effect"
import { taskTrackerTargetKey, TrackerTarget } from "../authorities/task-tracker/target.js"
import { RunTerminationDisposition } from "../coordination/frontier/run-finality.js"
import { RemotePublicationProofBasis } from "../workflow/protocols/direct-publication/events.js"
import { JournalPosition } from "./identity.js"
import { decideJournalPartitionHistory } from "./partition-history.js"
import {
  JournalDataCorruption,
  WorkflowRunTargetMismatch,
  WorkflowRunAlreadyTerminated,
  type JournalRecord
} from "./store.js"

/** Wall-clock milliseconds for storage age; never a tracker revision or Journal ordering key. */
export const RunCompletionTime = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
  Schema.brand("RunCompletionTime")
)
export type RunCompletionTime = typeof RunCompletionTime.Type

/** Legacy histories carry no trustworthy original termination date. The first verified baseline is retained forever. */
export const RunCompletionTiming = Schema.TaggedUnion({
  Known: { completedAt: RunCompletionTime },
  LegacyBaseline: { originalTime: Schema.Literal("Unknown"), verifiedAt: RunCompletionTime }
})
export type RunCompletionTiming = typeof RunCompletionTiming.Type

/** Recorded receiving-branch proof only; this does not assert the branch's current contents. */
export const RunCompletionPublication = Schema.TaggedUnion({
  NoRecordedPublication: {},
  RecordedPublication: {
    candidateCommit: GitCommitSha,
    target: RemotePublicationTarget,
    proof: RemotePublicationProofBasis,
    recordedAt: JournalPosition
  }
})

/** Durable terminal result, independent of the original finality tree and detailed history. */
export const RunCompletion = Schema.Struct({
  runId: RunId,
  target: TrackerTarget,
  disposition: RunTerminationDisposition,
  terminatedAt: JournalPosition,
  timing: RunCompletionTiming,
  publication: RunCompletionPublication
})
export type RunCompletion = typeof RunCompletion.Type

/** Deleted is reserved for ticket #489; this implementation produces only Available. */
export const RunHistoryAvailability = Schema.Literals(["Available", "Deleted"])
export const RunCompletionInspection = Schema.TaggedUnion({
  NoCompletion: { runId: RunId },
  CompletedRun: { completion: RunCompletion, history: RunHistoryAvailability }
})
export type RunCompletionInspection = typeof RunCompletionInspection.Type

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
