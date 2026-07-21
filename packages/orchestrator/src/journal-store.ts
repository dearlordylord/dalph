import { Context, Effect, Layer, Ref, Schema } from "effect"
import { JournalPosition, JournalRecordKey, JournalSchemaVersion, OperationId, RunId } from "./domain.js"
import {
  type WorkflowOperation,
  WorkflowOperation as WorkflowOperationSchema,
  type WorkflowOutcome,
  WorkflowOutcome as WorkflowOutcomeSchema
} from "./workflow.js"

/**
 * Records a managed operation before an ambiguity-crossing effect. It is
 * workflow history, not proof of tracker, Git, or execution-substrate state.
 */
const ManagedWorkflowIntent = Schema.TaggedStruct("ManagedWorkflowIntent", {
  operation: WorkflowOperationSchema
})

/** Records one tracker-graph observation without replacing tracker authority. */
const ManagedTrackerGraphOutcomeObserved = Schema.TaggedStruct(
  "ManagedTrackerGraphOutcomeObserved",
  {
    operationId: OperationId,
    outcome: WorkflowOutcomeSchema.cases.TrackerGraphObserved
  }
)

/** Records one task-execution observation without replacing substrate authority. */
const ManagedTaskExecutionOutcomeObserved = Schema.TaggedStruct(
  "ManagedTaskExecutionOutcomeObserved",
  {
    operationId: OperationId,
    outcome: WorkflowOutcomeSchema.cases.TaskExecuted
  }
)

export const ManagedWorkflowEvent = Schema.Union([
  ManagedWorkflowIntent,
  ManagedTrackerGraphOutcomeObserved,
  ManagedTaskExecutionOutcomeObserved
])
export type ManagedWorkflowEvent = typeof ManagedWorkflowEvent.Type

export const managedWorkflowIntent = (
  operation: WorkflowOperation
): typeof ManagedWorkflowIntent.Type => ManagedWorkflowIntent.make({ operation })

export const managedWorkflowOutcome = (
  operationId: OperationId,
  outcome: WorkflowOutcome
):
  | typeof ManagedTrackerGraphOutcomeObserved.Type
  | typeof ManagedTaskExecutionOutcomeObserved.Type =>
  outcome._tag === "TrackerGraphObserved"
    ? ManagedTrackerGraphOutcomeObserved.make({ operationId, outcome })
    : ManagedTaskExecutionOutcomeObserved.make({ operationId, outcome })

export interface JournalRecord {
  readonly runId: RunId
  readonly key: JournalRecordKey
  readonly position: JournalPosition
  readonly event: ManagedWorkflowEvent
}

const JournalStoreOperation = Schema.Literals([
  "JournalStore.open",
  "JournalStore.migrate",
  "JournalStore.append",
  "JournalStore.read"
])

/** Journal storage could not perform an operation and may become available later. */
export class JournalStorageUnavailable extends Schema.TaggedErrorClass<JournalStorageUnavailable>()(
  "JournalStorageUnavailable",
  {
    operation: JournalStoreOperation,
    detail: Schema.String
  }
) {}

/** Another live writer currently owns the journal; retry requires new ownership. */
export class JournalStorageLocked extends Schema.TaggedErrorClass<JournalStorageLocked>()(
  "JournalStorageLocked",
  {
    operation: JournalStoreOperation,
    detail: Schema.String
  }
) {}

/** Journal access was denied and requires configuration or operator repair. */
export class JournalStorageAccessDenied extends Schema.TaggedErrorClass<JournalStorageAccessDenied>()(
  "JournalStorageAccessDenied",
  {
    operation: JournalStoreOperation,
    detail: Schema.String
  }
) {}

/** Journal storage has exhausted capacity and cannot progress by immediate retry. */
export class JournalStorageCapacityExhausted extends Schema.TaggedErrorClass<JournalStorageCapacityExhausted>()(
  "JournalStorageCapacityExhausted",
  {
    operation: JournalStoreOperation,
    detail: Schema.String
  }
) {}

/** Persisted journal bytes do not satisfy Dalph's managed-history schema. */
export class JournalDataCorruption extends Schema.TaggedErrorClass<JournalDataCorruption>()(
  "JournalDataCorruption",
  {
    operation: JournalStoreOperation,
    detail: Schema.String
  }
) {}

/** The database belongs to a journal schema this Dalph cannot safely open. */
export class JournalSchemaIncompatible extends Schema.TaggedErrorClass<JournalSchemaIncompatible>()(
  "JournalSchemaIncompatible",
  {
    found: JournalSchemaVersion,
    supported: JournalSchemaVersion
  }
) {}

/**
 * Temporary fail-closed substitute delivered by issue #39 while the real
 * authority-reconciliation protocol remains unspecified. This error is not a
 * recovery outcome and must be replaced, not normalized, by the Wayfinder-led
 * specification and implementation in issue #41.
 *
 * @see https://github.com/dearlordylord/dalph/issues/39
 * @see https://github.com/dearlordylord/dalph/issues/41
 */
export class JournalReconciliationRequired extends Schema.TaggedErrorClass<JournalReconciliationRequired>()(
  "JournalReconciliationRequired",
  {
    runId: RunId,
    operationId: OperationId
  }
) {}

export type JournalStoreError =
  | JournalDataCorruption
  | JournalSchemaIncompatible
  | JournalStorageAccessDenied
  | JournalStorageCapacityExhausted
  | JournalStorageLocked
  | JournalStorageUnavailable

/** The same durable key was presented with unequal managed-history content. */
export class JournalStoreContradiction extends Schema.TaggedErrorClass<JournalStoreContradiction>()(
  "JournalStoreContradiction",
  {
    runId: RunId,
    key: JournalRecordKey,
    existingPosition: JournalPosition
  }
) {}

interface JournalStoreService {
  readonly append: (
    runId: RunId,
    key: JournalRecordKey,
    event: ManagedWorkflowEvent
  ) => Effect.Effect<JournalRecord, JournalStoreContradiction | JournalStoreError>
  readonly read: (
    runId: RunId
  ) => Effect.Effect<ReadonlyArray<JournalRecord>, JournalStoreError>
}

export class JournalStore extends Context.Service<JournalStore, JournalStoreService>()(
  "@dalph/JournalStore"
) {}

interface MemoryJournalState {
  readonly recordsByRun: ReadonlyMap<RunId, ReadonlyArray<JournalRecord>>
}

const sameEvent = (
  left: ManagedWorkflowEvent,
  right: ManagedWorkflowEvent
): boolean =>
  JSON.stringify(Schema.encodeUnknownSync(ManagedWorkflowEvent)(left))
    === JSON.stringify(Schema.encodeUnknownSync(ManagedWorkflowEvent)(right))

export const memoryJournalStoreLayer = Layer.effect(
  JournalStore,
  Effect.gen(function*() {
    const state = yield* Ref.make<MemoryJournalState>({
      recordsByRun: new Map()
    })
    const append = Effect.fn("JournalStore.Memory.append")(function*(
      runId: RunId,
      key: JournalRecordKey,
      event: ManagedWorkflowEvent
    ) {
      const update = (
        current: MemoryJournalState
      ): readonly [
        Effect.Effect<JournalRecord, JournalStoreContradiction>,
        MemoryJournalState
      ] => {
        const records = current.recordsByRun.get(runId) ?? []
        const existing = records.find((record) => record.key === key)
        if (existing !== undefined) {
          if (sameEvent(existing.event, event)) {
            return [Effect.succeed(existing), current] as const
          }
          return [
            Effect.fail(
              new JournalStoreContradiction({
                existingPosition: existing.position,
                key,
                runId
              })
            ),
            current
          ] as const
        }

        const record: JournalRecord = {
          event,
          key,
          position: JournalPosition.make(records.length + 1),
          runId
        }
        const recordsByRun = new Map([
          ...current.recordsByRun,
          [runId, [...records, record]] as const
        ])
        return [Effect.succeed(record), { recordsByRun }] as const
      }
      const result = yield* Ref.modify(state, update)
      return yield* result
    })
    const read = Effect.fn("JournalStore.Memory.read")(function*(runId: RunId) {
      const current = yield* Ref.get(state)
      return current.recordsByRun.get(runId) ?? []
    })

    return JournalStore.of({ append, read })
  })
)

export const intentRecordKey = (operationId: OperationId): JournalRecordKey =>
  JournalRecordKey.make(`operation:${operationId}:intent`)

export const outcomeRecordKey = (operationId: OperationId): JournalRecordKey =>
  JournalRecordKey.make(`operation:${operationId}:outcome`)
