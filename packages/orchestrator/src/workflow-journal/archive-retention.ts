/* eslint-disable no-magic-numbers -- Accepted exact archive policy constants and deterministic comparator signs. */
import { Effect, Schema } from "effect"
import type { RunId } from "@dalph/contracts"
import { RunCompletionTime, type RunCompletion, type RunHistoryDeletion } from "./completion-model.js"
import type { JournalStoreError } from "./store.js"

/** Logical saved record bytes, excluding receipts and physical database overhead. */
export const SavedArchiveBytes = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
  Schema.brand("SavedArchiveBytes")
)
export type SavedArchiveBytes = typeof SavedArchiveBytes.Type
export const archiveByteBudget = SavedArchiveBytes.make(268_435_456)
/** Thirty elapsed UTC days; equality expires details. */
export const ArchiveRetentionDuration = Schema.Int.check(Schema.isGreaterThan(0)).pipe(
  Schema.brand("ArchiveRetentionDuration")
)
export const archiveAgeMillis = ArchiveRetentionDuration.make(30 * 24 * 60 * 60 * 1000)
/** Each normal owner pass processes at most 32 whole Runs and starts no unit after one second. */
export const ArchiveRetentionRunLimit = Schema.Int.check(Schema.isGreaterThan(0)).pipe(
  Schema.brand("ArchiveRetentionRunLimit")
)
export const archivePassRunLimit = ArchiveRetentionRunLimit.make(32)
export const archivePassMillis = ArchiveRetentionDuration.make(1000)

export interface ArchiveRetentionCandidate {
  readonly runId: RunId
  readonly baseline: RunCompletionTime
  readonly bytes: SavedArchiveBytes
}
export interface ArchiveRetentionObservation {
  readonly savedBytes: SavedArchiveBytes
  readonly excessBytes: SavedArchiveBytes
  readonly expiredBacklog: number
  readonly deletedRuns: ReadonlyArray<RunId>
  readonly deferred: "None" | "Bound" | "Protected" | "StorageFailure"
  readonly failure?: JournalStoreError
}

export const retentionBaseline = (completion: RunCompletion): RunCompletionTime =>
  completion.timing._tag === "Known" ? completion.timing.completedAt : completion.timing.verifiedAt
export const retentionOrder = (a: ArchiveRetentionCandidate, b: ArchiveRetentionCandidate): number =>
  a.baseline - b.baseline || (a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0)
export const retentionReason = (
  candidate: ArchiveRetentionCandidate,
  now: number,
  total: number
): RunHistoryDeletion["reason"] | undefined => {
  const aged = candidate.baseline + archiveAgeMillis <= now
  const pressure = total > archiveByteBudget
  return aged ? (pressure ? "AgeAndBudget" : "Age") : pressure ? "Budget" : undefined
}

/** One policy interpreted by both exclusive storage owners; fresh storage facts precede every atomic unit. */
export const archiveRetentionPass = Effect.fn("JournalStore.maintainArchive")(function* (owner: {
  readonly now: Effect.Effect<number>
  readonly snapshot: (
    now: number
  ) => Effect.Effect<
    {
      readonly expiredBacklog: number
      readonly savedBytes: SavedArchiveBytes
      readonly candidates: ReadonlyArray<ArchiveRetentionCandidate>
    },
    JournalStoreError
  >
  readonly remove: (candidate: ArchiveRetentionCandidate, now: number) => Effect.Effect<void, JournalStoreError>
}) {
  const now = RunCompletionTime.make(yield* owner.now)
  const deletedRuns: Array<RunId> = []
  let failure: JournalStoreError | undefined
  let bounded = false
  let snapshot = yield* owner.snapshot(now)
  for (;;) {
    const ordered = [...snapshot.candidates].sort(retentionOrder)
    const selected =
      ordered.find((candidate) => candidate.baseline + archiveAgeMillis <= now) ??
      (snapshot.savedBytes > archiveByteBudget ? ordered[0] : undefined)
    if (selected === undefined) break
    if (deletedRuns.length >= archivePassRunLimit || (yield* owner.now) - now >= archivePassMillis) {
      bounded = true
      break
    }
    const result = yield* owner.remove(selected, now).pipe(Effect.result)
    if (result._tag === "Failure") {
      failure = result.failure
      break
    }
    deletedRuns.push(selected.runId)
    snapshot = yield* owner.snapshot(now)
  }
  // An ambiguous unit is reconciled by the adapter. Failed facts are not guessed.
  const excessBytes = SavedArchiveBytes.make(Math.max(0, snapshot.savedBytes - archiveByteBudget))
  const expiredBacklog = snapshot.expiredBacklog
  return {
    savedBytes: snapshot.savedBytes,
    excessBytes,
    expiredBacklog,
    deletedRuns,
    deferred: failure !== undefined ? "StorageFailure" : bounded ? "Bound" : excessBytes > 0 ? "Protected" : "None",
    ...(failure === undefined ? {} : { failure })
  } satisfies ArchiveRetentionObservation
})
