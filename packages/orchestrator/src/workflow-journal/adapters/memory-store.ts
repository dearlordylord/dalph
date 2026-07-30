import { type RunId } from "@dalph/contracts"
import { Effect, Layer, Ref, Schema } from "effect"
import { JournalPosition, type JournalRecordKey } from "../identity.js"
import {
  type AppendableWorkflowJournalEvent,
  type JournalRecord,
  JournalStore,
  JournalStoreContradiction,
  type WorkflowRunAlreadyBegan,
  WorkflowRunAlreadyTerminated,
  type WorkflowRunIdentityAlreadyUsed,
  type WorkflowRunNotBegan
} from "../store.js"
import { WorkflowJournalEvent } from "../../workflow/registry/event.js"
import type { TrackerTarget } from "../../authorities/task-tracker/target.js"
import {
  decideWorkflowRunBeginning,
  decideWorkflowRunTermination,
  readRecoverableRunBeginning
} from "../run-lifecycle.js"

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

    const beginRun = Effect.fn("JournalStore.Memory.beginRun")(function* (runId: RunId, target: TrackerTarget) {
      const update = (
        current: MemoryJournalState
      ): readonly [
        Effect.Effect<JournalRecord, WorkflowRunAlreadyBegan | WorkflowRunIdentityAlreadyUsed>,
        MemoryJournalState
      ] => {
        const records = current.recordsByRun.get(runId) ?? []
        const decision = decideWorkflowRunBeginning(records, runId, target)
        if (decision._tag === "LifecycleTransitionRejected") {
          return [Effect.fail(decision.failure), current]
        }
        const record = decision.record
        const recordsByRun = new Map([...current.recordsByRun, [runId, [record]] as const])
        return [Effect.succeed(record), { recordsByRun }]
      }
      const result = yield* Ref.modify(state, update)
      return yield* result
    })

    const append = Effect.fn("JournalStore.Memory.append")(function* (
      runId: RunId,
      key: JournalRecordKey,
      event: AppendableWorkflowJournalEvent
    ) {
      const update = (
        current: MemoryJournalState
      ): readonly [
        Effect.Effect<JournalRecord, JournalStoreContradiction | WorkflowRunAlreadyTerminated>,
        MemoryJournalState
      ] => {
        const records = current.recordsByRun.get(runId) ?? []
        const terminated = records.find(({ event: recorded }) => recorded._tag === "WorkflowRunTerminated")
        if (terminated !== undefined) {
          return [Effect.fail(new WorkflowRunAlreadyTerminated({ runId, terminatedAt: terminated.position })), current]
        }
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

    const readRunForRecovery = Effect.fn("JournalStore.Memory.readRunForRecovery")(function* (
      runId: RunId,
      target: TrackerTarget
    ) {
      return yield* readRecoverableRunBeginning((yield* Ref.get(state)).recordsByRun.get(runId) ?? [], runId, target)
    })

    const scan = Effect.fn("JournalStore.Memory.scan")(function* () {
      const recordsByRun = (yield* Ref.get(state)).recordsByRun
      return { issues: [], runs: [...recordsByRun].map(([runId, records]) => ({ records, runId })) }
    })

    const terminateRun = Effect.fn("JournalStore.Memory.terminateRun")(function* (runId: RunId) {
      const update = (
        current: MemoryJournalState
      ): readonly [
        Effect.Effect<JournalRecord, WorkflowRunAlreadyTerminated | WorkflowRunNotBegan>,
        MemoryJournalState
      ] => {
        const records = current.recordsByRun.get(runId) ?? []
        const decision = decideWorkflowRunTermination(records, runId)
        if (decision._tag === "LifecycleTransitionRejected") {
          return [Effect.fail(decision.failure), current]
        }
        const record = decision.record
        const recordsByRun = new Map([...current.recordsByRun, [runId, [...records, record]] as const])
        return [Effect.succeed(record), { recordsByRun }]
      }
      const result = yield* Ref.modify(state, update)
      return yield* result
    })

    return JournalStore.of({ append, beginRun, read, readRunForRecovery, scan, terminateRun })
  })
)
