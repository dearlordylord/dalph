import { Context, Effect, Layer, Ref, Schema } from "effect"
import {
  JournalPosition,
  JournalRecordKey,
  JournalSchemaVersion,
  OperationId,
  ProviderObservationId,
  RunId
} from "./domain.js"
import {
  TaskWorkSessionLookup,
  TaskWorkSessionLookupFailure,
  TaskWorkSessionReport,
  TaskWorkSessionResultReported as TaskWorkSessionResultReport,
  TaskWorkStartRequest,
  TaskWorkStartRequestAcknowledgement,
  TaskWorkStartRequestFailure
} from "./task-work-start.js"
import { type WorkflowOperation, WorkflowOperation as WorkflowOperationSchema } from "./workflow-operation.js"
import { WorkflowOutcome as WorkflowOutcomeSchema } from "./workflow-outcome.js"

/**
 * Records a managed operation before its state-changing request. It is
 * workflow history, not proof of tracker, Git, or task-work-provider facts.
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

// Version 2 is the first canonical task-work event vocabulary.
const workflowJournalEventVersion = 2 as const // eslint-disable-line no-magic-numbers

/** Records the immutable intent before a task-work start request can cross its boundary. */
export const TaskWorkSessionEstablishmentIntentRecorded = Schema.TaggedStruct(
  "TaskWorkSessionEstablishmentIntentRecorded",
  {
    operation: WorkflowOperationSchema.cases.EstablishTaskWorkSession,
    version: Schema.Literal(workflowJournalEventVersion)
  }
)

/** Records one exact task-work start request that crossed the provider boundary. */
export const TaskWorkStartRequested = Schema.TaggedStruct(
  "TaskWorkStartRequested",
  {
    observationId: ProviderObservationId,
    request: TaskWorkStartRequest,
    version: Schema.Literal(workflowJournalEventVersion)
  }
)

/** Records the provider acknowledgement without treating it as session evidence. */
export const TaskWorkStartRequestAcknowledged = Schema.TaggedStruct(
  "TaskWorkStartRequestAcknowledged",
  {
    acknowledgement: TaskWorkStartRequestAcknowledgement,
    operationId: OperationId,
    version: Schema.Literal(workflowJournalEventVersion)
  }
)

/** Records an uncertain start-request return; recovery still requires a fresh lookup. */
export const TaskWorkStartRequestFailed = Schema.TaggedStruct(
  "TaskWorkStartRequestFailed",
  {
    failure: TaskWorkStartRequestFailure,
    request: TaskWorkStartRequest,
    version: Schema.Literal(workflowJournalEventVersion)
  }
)

/** Records one completed read-only task-work session lookup request. */
export const TaskWorkSessionLookupRequested = Schema.TaggedStruct(
  "TaskWorkSessionLookupRequested",
  {
    lookup: TaskWorkSessionLookup,
    observationId: ProviderObservationId,
    version: Schema.Literal(workflowJournalEventVersion)
  }
)

/** Records an unreadable provider lookup without inventing a session report. */
export const TaskWorkSessionLookupFailed = Schema.TaggedStruct(
  "TaskWorkSessionLookupFailed",
  {
    failure: TaskWorkSessionLookupFailure,
    operationId: OperationId,
    version: Schema.Literal(workflowJournalEventVersion)
  }
)

/** Records the provider's authoritative task-work session report. */
export const TaskWorkSessionReported = Schema.TaggedStruct(
  "TaskWorkSessionReported",
  {
    operationId: OperationId,
    report: TaskWorkSessionReport,
    version: Schema.Literal(workflowJournalEventVersion)
  }
)

/** Records that exactly one matching task-work session establishes the operation. */
export const TaskWorkSessionEstablishedEvent = Schema.TaggedStruct(
  "TaskWorkSessionEstablished",
  {
    outcome: WorkflowOutcomeSchema.cases.TaskWorkSessionEstablished,
    version: Schema.Literal(workflowJournalEventVersion)
  }
)

/**
 * Records a terminal provider result without deciding task-tracker success.
 * Issue #29 owns connecting this later result-observation operation end to end.
 */
const TaskWorkSessionResultReportedEvent = Schema.TaggedStruct(
  "TaskWorkSessionResultReported",
  {
    report: TaskWorkSessionResultReport,
    version: Schema.Literal(workflowJournalEventVersion)
  }
)

export const WorkflowJournalEvent = Schema.Union([
  ManagedWorkflowIntent,
  ManagedTrackerGraphOutcomeObserved,
  TaskWorkSessionEstablishmentIntentRecorded,
  TaskWorkStartRequested,
  TaskWorkStartRequestAcknowledged,
  TaskWorkStartRequestFailed,
  TaskWorkSessionLookupRequested,
  TaskWorkSessionLookupFailed,
  TaskWorkSessionReported,
  TaskWorkSessionEstablishedEvent,
  TaskWorkSessionResultReportedEvent
])
export type WorkflowJournalEvent = typeof WorkflowJournalEvent.Type

export const managedWorkflowIntent = (
  operation: WorkflowOperation
): typeof ManagedWorkflowIntent.Type => ManagedWorkflowIntent.make({ operation })

export const managedWorkflowOutcome = (
  operationId: OperationId,
  outcome: typeof WorkflowOutcomeSchema.cases.TrackerGraphObserved.Type
): typeof ManagedTrackerGraphOutcomeObserved.Type => ManagedTrackerGraphOutcomeObserved.make({ operationId, outcome })

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
    event: WorkflowJournalEvent
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
  left: WorkflowJournalEvent,
  right: WorkflowJournalEvent
): boolean =>
  JSON.stringify(Schema.encodeUnknownSync(WorkflowJournalEvent)(left))
    === JSON.stringify(Schema.encodeUnknownSync(WorkflowJournalEvent)(right))

export const memoryJournalStoreLayer = Layer.effect(
  JournalStore,
  Effect.gen(function*() {
    const state = yield* Ref.make<MemoryJournalState>({
      recordsByRun: new Map()
    })
    const append = Effect.fn("JournalStore.Memory.append")(function*(
      runId: RunId,
      key: JournalRecordKey,
      event: WorkflowJournalEvent
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

export const providerObservationRequestRecordKey = (
  observationId: ProviderObservationId
): JournalRecordKey => JournalRecordKey.make(`provider-observation:${observationId}:request`)

export const taskWorkStartAcknowledgedRecordKey = (
  operationId: OperationId,
  observationId: ProviderObservationId
): JournalRecordKey => JournalRecordKey.make(`operation:${operationId}:task-work-start-acknowledged:${observationId}`)

export const taskWorkStartFailedRecordKey = (
  operationId: OperationId,
  observationId: ProviderObservationId
): JournalRecordKey => JournalRecordKey.make(`operation:${operationId}:task-work-start-failed:${observationId}`)

export const taskWorkSessionReportedRecordKey = (
  operationId: OperationId,
  observationId: ProviderObservationId
): JournalRecordKey => JournalRecordKey.make(`operation:${operationId}:task-work-session-reported:${observationId}`)
