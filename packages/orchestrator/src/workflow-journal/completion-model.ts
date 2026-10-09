import { GitCommitSha, RemotePublicationTarget, RunId } from "@dalph/contracts"
import { Schema } from "effect"
import { TrackerTarget } from "../authorities/task-tracker/target.js"
import { RunTerminationDisposition } from "../coordination/frontier/run-termination-disposition.js"
import { RemotePublicationProofBasis } from "../workflow/protocols/direct-publication/events.js"
import { JournalPosition } from "./identity.js"

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

/** Detail availability is independent of the immutable terminal disposition. */
export const RunHistoryAvailability = Schema.Literals(["Available", "Deleted"])
/** Why and when the owner atomically removed the whole detailed history. */
export const RunHistoryDeletion = Schema.Struct({
  reason: Schema.Literals(["Age", "Budget", "AgeAndBudget"]),
  observedAt: RunCompletionTime
})
export type RunHistoryDeletion = typeof RunHistoryDeletion.Type

/** Availability and deletion provenance form one variant, so impossible combinations cannot be constructed. */
export const CompletedRunInspection = Schema.Union([
  Schema.TaggedStruct("CompletedRun", { completion: RunCompletion, history: Schema.Literal("Available") }),
  Schema.TaggedStruct("CompletedRun", {
    completion: RunCompletion,
    history: Schema.Literal("Deleted"),
    deletion: RunHistoryDeletion
  })
])
export const RunCompletionInspection = Schema.Union([
  Schema.TaggedStruct("NoCompletion", { runId: RunId }),
  CompletedRunInspection
])
export type RunCompletionInspection = typeof RunCompletionInspection.Type
