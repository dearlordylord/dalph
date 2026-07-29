import { Context, Effect, Layer, Ref, Schema } from "effect"
import { ControlCommandRecordedEvent } from "./control-command.js"
import { JournalPosition, JournalRecordKey, JournalSchemaVersion, OperationId, RunId } from "./domain.js"
import { PlannedWorktreeReady } from "./git-worktree.js"
import { workflowJournalEventVersion } from "./journal-event-version.js"
import type { JournalScan } from "./journal-recovery-model.js"
import { PlannedAttemptExecutorJournalEvent } from "./planned-attempt-executor-journal.js"
import { ActiveTaskClaim } from "./tracker-mutation.js"
import { WorkflowOperation as WorkflowOperationSchema } from "./workflow-operation.js"
import { WorkflowOutcome as WorkflowOutcomeSchema } from "./workflow-outcome.js"

/** Records selection of a read-only tracker-graph observation in workflow history. */
const TrackerGraphObservationIntentRecorded = Schema.TaggedStruct("TrackerGraphObservationIntentRecorded", {
  operation: WorkflowOperationSchema.cases.ReadTrackerGraph,
  version: Schema.Literal(workflowJournalEventVersion)
})

/** Records one tracker-graph observation without replacing tracker authority. */
const TrackerGraphOutcomeObservedEvent = Schema.TaggedStruct("TrackerGraphOutcomeObserved", {
  operationId: OperationId,
  outcome: WorkflowOutcomeSchema.cases.TrackerGraphObserved,
  version: Schema.Literal(workflowJournalEventVersion)
})

/** Records immutable claim intent before a task-tracker mutation can cross its boundary. */
export const TaskClaimAcquisitionIntendedEvent = Schema.TaggedStruct("TaskClaimAcquisitionIntended", {
  operation: WorkflowOperationSchema.cases.AcquireTaskClaim,
  version: Schema.Literal(workflowJournalEventVersion)
})

/** Records the exact claim after a fresh task-tracker observation proves it. */
export const TaskClaimAcquiredEvent = Schema.TaggedStruct("TaskClaimAcquired", {
  claim: ActiveTaskClaim,
  version: Schema.Literal(workflowJournalEventVersion)
})

/** Acknowledges the immutable planned task attempt before any execution resource mutation. */
export const TaskAttemptPlannedEvent = Schema.TaggedStruct("TaskAttemptPlanned", {
  operation: WorkflowOperationSchema.cases.RecordTaskAttemptPlan,
  version: Schema.Literal(workflowJournalEventVersion)
})

/** Records exact Git create-or-rediscover intent before any Git state-changing request. */
export const TaskWorktreeReconciliationIntendedEvent = Schema.TaggedStruct("TaskWorktreeReconciliationIntended", {
  operation: WorkflowOperationSchema.cases.ReconcileTaskWorktree,
  version: Schema.Literal(workflowJournalEventVersion)
})

/** Records declared Base, current HEAD, and the successful ancestor proof read from Git. */
export const TaskWorktreeReadyEvent = Schema.TaggedStruct("TaskWorktreeReady", {
  operationId: OperationId,
  proof: PlannedWorktreeReady,
  version: Schema.Literal(workflowJournalEventVersion)
})

export const WorkflowJournalEvent = Schema.Union([
  ControlCommandRecordedEvent,
  TrackerGraphObservationIntentRecorded,
  TrackerGraphOutcomeObservedEvent,
  TaskClaimAcquisitionIntendedEvent,
  TaskClaimAcquiredEvent,
  TaskAttemptPlannedEvent,
  TaskWorktreeReconciliationIntendedEvent,
  TaskWorktreeReadyEvent,
  PlannedAttemptExecutorJournalEvent
])
export type WorkflowJournalEvent = typeof WorkflowJournalEvent.Type

export const trackerGraphObservationIntent = (
  operation: typeof WorkflowOperationSchema.cases.ReadTrackerGraph.Type
): typeof TrackerGraphObservationIntentRecorded.Type =>
  TrackerGraphObservationIntentRecorded.make({ operation, version: workflowJournalEventVersion })

export const trackerGraphOutcomeObserved = (
  operationId: OperationId,
  outcome: typeof WorkflowOutcomeSchema.cases.TrackerGraphObserved.Type
): typeof TrackerGraphOutcomeObservedEvent.Type =>
  TrackerGraphOutcomeObservedEvent.make({ operationId, outcome, version: workflowJournalEventVersion })

export interface JournalRecord {
  readonly runId: RunId
  readonly key: JournalRecordKey
  readonly position: JournalPosition
  readonly event: WorkflowJournalEvent
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
  { operation: JournalStoreOperation, detail: Schema.String }
) {}

/** Another live writer currently owns the journal; retry requires new ownership. */
export class JournalStorageLocked extends Schema.TaggedErrorClass<JournalStorageLocked>()("JournalStorageLocked", {
  operation: JournalStoreOperation,
  detail: Schema.String
}) {}

/** Journal access was denied and requires configuration or operator repair. */
export class JournalStorageAccessDenied extends Schema.TaggedErrorClass<JournalStorageAccessDenied>()(
  "JournalStorageAccessDenied",
  { operation: JournalStoreOperation, detail: Schema.String }
) {}

/** Journal storage has exhausted capacity and cannot progress by immediate retry. */
export class JournalStorageCapacityExhausted extends Schema.TaggedErrorClass<JournalStorageCapacityExhausted>()(
  "JournalStorageCapacityExhausted",
  { operation: JournalStoreOperation, detail: Schema.String }
) {}

/** Persisted journal bytes do not satisfy Dalph's managed-history schema. */
export class JournalDataCorruption extends Schema.TaggedErrorClass<JournalDataCorruption>()("JournalDataCorruption", {
  operation: JournalStoreOperation,
  detail: Schema.String
}) {}

/** The database belongs to a journal schema this Dalph cannot safely open. */
export class JournalSchemaIncompatible extends Schema.TaggedErrorClass<JournalSchemaIncompatible>()(
  "JournalSchemaIncompatible",
  { found: JournalSchemaVersion, supported: JournalSchemaVersion }
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
  { runId: RunId, key: JournalRecordKey, existingPosition: JournalPosition }
) {}

interface JournalStoreService {
  readonly append: (
    runId: RunId,
    key: JournalRecordKey,
    event: WorkflowJournalEvent
  ) => Effect.Effect<JournalRecord, JournalStoreContradiction | JournalStoreError>
  readonly read: (runId: RunId) => Effect.Effect<ReadonlyArray<JournalRecord>, JournalStoreError>
  readonly scan: () => Effect.Effect<JournalScan, JournalStoreError>
}

export class JournalStore extends Context.Service<JournalStore, JournalStoreService>()("@dalph/JournalStore") {}

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

export * from "./journal-record-key.js"
