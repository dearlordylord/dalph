import { type RunId } from "@dalph/contracts"
import { Effect, Layer, Ref, Schema } from "effect"
import { JournalPosition, type JournalRecordKey } from "../identity.js"
import { type JournalRecord, JournalStore, JournalStoreContradiction } from "../store.js"
import { WorkflowJournalEvent } from "../../workflow/registry/event.js"

interface MemoryJournalState {
  readonly recordsByRun: ReadonlyMap<RunId, ReadonlyArray<JournalRecord>>
}

const sameEvent = (left: WorkflowJournalEvent, right: WorkflowJournalEvent): boolean =>
  JSON.stringify(Schema.encodeUnknownSync(WorkflowJournalEvent)(left)) ===
  JSON.stringify(Schema.encodeUnknownSync(WorkflowJournalEvent)(right))

export const memoryJournalStoreLayer = Layer.effect(
  JournalStore,
  Effect.gen(function* () {
    const state = yield* Ref.make<MemoryJournalState>({ recordsByRun: new Map() })
    const append = Effect.fn("JournalStore.Memory.append")(function* (
      runId: RunId,
      key: JournalRecordKey,
      event: WorkflowJournalEvent
    ) {
      const update = (
        current: MemoryJournalState
      ): readonly [Effect.Effect<JournalRecord, JournalStoreContradiction>, MemoryJournalState] => {
        const records = current.recordsByRun.get(runId) ?? []
        const existing = records.find((record) => record.key === key)
        if (existing !== undefined) {
          if (sameEvent(existing.event, event)) return [Effect.succeed(existing), current] as const
          return [
            Effect.fail(new JournalStoreContradiction({ existingPosition: existing.position, key, runId })),
            current
          ] as const
        }

        const record: JournalRecord = { event, key, position: JournalPosition.make(records.length + 1), runId }
        const recordsByRun = new Map([...current.recordsByRun, [runId, [...records, record]] as const])
        return [Effect.succeed(record), { recordsByRun }] as const
      }
      const result = yield* Ref.modify(state, update)
      return yield* result
    })
    const read = Effect.fn("JournalStore.Memory.read")(function* (runId: RunId) {
      return (yield* Ref.get(state)).recordsByRun.get(runId) ?? []
    })
    const scan = Effect.fn("JournalStore.Memory.scan")(function* () {
      const recordsByRun = (yield* Ref.get(state)).recordsByRun
      return { issues: [], runs: [...recordsByRun].map(([runId, records]) => ({ records, runId })) }
    })

    return JournalStore.of({ append, read, scan })
  })
)
