/* eslint-disable no-magic-numbers -- Saved envelopes count two fixed eight-byte integers. */
import { Clock, Effect, Ref, Semaphore } from "effect"
import {
  archiveRetentionPass,
  archiveAgeMillis,
  SavedArchiveBytes,
  retentionBaseline,
  retentionReason
} from "../archive-retention.js"
import { encodeSqliteJournalEvent } from "./sqlite-event-codec.js"
import { RunCompletionTime } from "../completion.js"
import { decideMemoryCompletion, type MemoryJournalState } from "./memory-completion.js"
import { decideJournalPartitionHistory } from "../partition-history.js"
import {
  type JournalRecord,
  type JournalDataCorruption,
  JournalHistoryCorruption,
  type JournalPartitionContradiction
} from "../store.js"

export const savedMemoryArchiveBytes = (records: ReadonlyArray<JournalRecord>) =>
  SavedArchiveBytes.make(
    records.reduce((sum, record) => {
      const encoded = encodeSqliteJournalEvent(record.event)
      const utf8 = new TextEncoder()
      return (
        sum +
        [record.runId, record.key, encoded.kind, encoded.payloadJson].reduce(
          (bytes, value) => bytes + utf8.encode(value).byteLength,
          0
        ) +
        16
      )
    }, 0)
  )

export const makeMemoryArchiveRetention = Effect.fn("JournalStore.Memory.makeArchiveRetention")(function* (
  state: Ref.Ref<MemoryJournalState>
) {
  const snapshot = (now: number) =>
    Ref.get(state).pipe(
      Effect.map((current) => ({
        expiredBacklog: [...current.archiveBytes.keys()].filter((id) => {
          const completion = current.completions.get(id)
          return completion !== undefined && retentionBaseline(completion) + archiveAgeMillis <= now
        }).length,
        savedBytes: SavedArchiveBytes.make([...current.archiveBytes.values()].reduce((sum, bytes) => sum + bytes, 0)),
        candidates: [...current.archiveBytes].flatMap(([runId, bytes]) => {
          const completion = current.completions.get(runId)
          return completion === undefined ? [] : [{ runId, baseline: retentionBaseline(completion), bytes }]
        })
      }))
    )
  const serialization = yield* Semaphore.make(1)
  const maintainArchive = () =>
    serialization.withPermit(
      archiveRetentionPass({
        now: Clock.currentTimeMillis,
        snapshot,
        remove: (candidate, now) =>
          Ref.modify(
            state,
            (
              current
            ): readonly [
              Effect.Effect<void, JournalDataCorruption | JournalHistoryCorruption | JournalPartitionContradiction>,
              MemoryJournalState
            ] => {
              const receipt = decideMemoryCompletion(current, candidate.runId, "JournalStore.maintainArchive")
              if (receipt._tag !== "CompletedRun")
                return [receipt._tag === "NoCompletion" ? Effect.void : Effect.fail(receipt), current]
              if (receipt.history === "Deleted") return [Effect.void, current]
              const records = current.coldRecordsByRun.get(candidate.runId)
              if (records === undefined) return [Effect.void, current]
              const decision = decideJournalPartitionHistory("Cold", candidate.runId, records)
              if (decision._tag === "InvalidPartitionHistory")
                return [
                  Effect.fail(
                    new JournalHistoryCorruption({
                      runId: candidate.runId,
                      partition: "Cold",
                      operation: "JournalStore.maintainArchive",
                      detail: decision.issue.detail
                    })
                  ),
                  current
                ]
              const total = [...current.archiveBytes.values()].reduce((sum, bytes) => sum + bytes, 0)
              const reason = retentionReason(
                { ...candidate, baseline: retentionBaseline(receipt.completion) },
                now,
                total
              )
              if (reason === undefined) return [Effect.void, current]
              return [
                Effect.void,
                {
                  ...current,
                  archiveBytes: new Map([...current.archiveBytes].filter(([id]) => id !== candidate.runId)),
                  deletions: new Map([
                    ...current.deletions,
                    [candidate.runId, { reason, observedAt: RunCompletionTime.make(now) }] as const
                  ]),
                  coldRecordsByRun: new Map([...current.coldRecordsByRun].filter(([id]) => id !== candidate.runId))
                }
              ]
            }
          ).pipe(Effect.flatMap((result) => result))
      })
    )
  return maintainArchive
})
