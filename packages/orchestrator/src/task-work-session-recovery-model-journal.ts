/* eslint-disable functional/immutable-data */
import { Effect } from "effect"
import { JournalPosition, type RunId } from "./domain.js"
import {
  type JournalRecord,
  JournalStore,
  JournalStoreContradiction,
  type WorkflowJournalEvent
} from "./journal-store.js"

const sameEvent = (left: WorkflowJournalEvent, right: WorkflowJournalEvent) =>
  JSON.stringify(left) === JSON.stringify(right)

/** In-memory journal boundary used by the executable M1 production-control adapter. */
export const makeTaskWorkSessionRecoveryModelJournal = (
  records: Array<JournalRecord>,
  runId: RunId,
  beforeAppend: (event: WorkflowJournalEvent) => Effect.Effect<void>,
  afterAppend: (event: WorkflowJournalEvent, existed: boolean) => Effect.Effect<void>
) =>
  JournalStore.of({
    append: (runId, key, event) =>
      Effect.gen(function*() {
        yield* beforeAppend(event)
        const existing = records.find((record) => record.runId === runId && record.key === key)
        if (existing !== undefined) {
          if (!sameEvent(existing.event, event)) {
            return yield* new JournalStoreContradiction({
              existingPosition: existing.position,
              key,
              runId
            })
          }
          yield* afterAppend(event, true)
          return existing
        }
        const record: JournalRecord = {
          event,
          key,
          position: JournalPosition.make(records.length + 1),
          runId
        }
        records.push(record)
        yield* afterAppend(event, false)
        return record
      }),
    read: (requestedRunId) => Effect.succeed(records.filter((record) => record.runId === requestedRunId)),
    scan: () => Effect.succeed({ issues: [], runs: [{ records, runId }] })
  })
