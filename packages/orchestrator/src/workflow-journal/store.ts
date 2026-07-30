// @effect-diagnostics lazyEffect:off
import type { Effect } from "effect"
import { Context, Schema } from "effect"
import { RunId } from "@dalph/contracts"
import { JournalPosition, JournalRecordKey, JournalSchemaVersion } from "./identity.js"
import { TrackerTarget } from "../authorities/task-tracker/target.js"
import type { JournalScan } from "./recovery-model.js"
import {
  type WorkflowJournalEvent,
  WorkflowJournalEvent as WorkflowJournalEventSchema
} from "../workflow/registry/event.js"

/** One schema-decodable durable envelope around a workflow event. */
export const JournalRecord = Schema.Struct({
  event: WorkflowJournalEventSchema,
  key: JournalRecordKey,
  position: JournalPosition,
  runId: RunId
})
export type JournalRecord = typeof JournalRecord.Type

/** Ordinary workflow facts accepted by generic append; Run lifecycle facts use their dedicated atomic methods. */
export type AppendableWorkflowJournalEvent = Exclude<
  WorkflowJournalEvent,
  { readonly _tag: "WorkflowRunBegan" | "WorkflowRunTerminated" }
>

const JournalStoreOperation = Schema.Literals([
  "JournalStore.open",
  "JournalStore.migrate",
  "JournalStore.append",
  "JournalStore.read",
  "JournalStore.beginRun",
  "JournalStore.terminateRun",
  "JournalStore.readRunForRecovery"
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

/** Persisted journal bytes do not satisfy Dalph's workflow-journal-history schema. */
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

/** The same durable key was presented with unequal workflow-journal-history content. */
export class JournalStoreContradiction extends Schema.TaggedErrorClass<JournalStoreContradiction>()(
  "JournalStoreContradiction",
  { runId: RunId, key: JournalRecordKey, existingPosition: JournalPosition }
) {}

/** The fresh-start boundary submitted an identity whose Run already began. */
export class WorkflowRunAlreadyBegan extends Schema.TaggedErrorClass<WorkflowRunAlreadyBegan>()(
  "WorkflowRunAlreadyBegan",
  { beganAt: JournalPosition, runId: RunId }
) {}

/** The fresh-start boundary received an identity already used by non-lifecycle journal history. */
export class WorkflowRunIdentityAlreadyUsed extends Schema.TaggedErrorClass<WorkflowRunIdentityAlreadyUsed>()(
  "WorkflowRunIdentityAlreadyUsed",
  { firstRecordAt: JournalPosition, runId: RunId }
) {}

/** Recovery or termination named an identity for which no Run beginning exists. */
export class WorkflowRunNotBegan extends Schema.TaggedErrorClass<WorkflowRunNotBegan>()("WorkflowRunNotBegan", {
  runId: RunId
}) {}

/** Recovery named a tracker target different from the one recorded when the Run began. */
export class WorkflowRunTargetMismatch extends Schema.TaggedErrorClass<WorkflowRunTargetMismatch>()(
  "WorkflowRunTargetMismatch",
  { recordedTarget: TrackerTarget, requestedTarget: TrackerTarget, runId: RunId }
) {}

/** The caller attempted to recover or extend a Run after its durable termination. */
export class WorkflowRunAlreadyTerminated extends Schema.TaggedErrorClass<WorkflowRunAlreadyTerminated>()(
  "WorkflowRunAlreadyTerminated",
  { runId: RunId, terminatedAt: JournalPosition }
) {}

export type JournalAppendError = JournalStoreContradiction | JournalStoreError | WorkflowRunAlreadyTerminated

interface JournalStoreService {
  readonly beginRun: (
    runId: RunId,
    target: TrackerTarget
  ) => Effect.Effect<JournalRecord, JournalStoreError | WorkflowRunAlreadyBegan | WorkflowRunIdentityAlreadyUsed>
  readonly append: (
    runId: RunId,
    key: JournalRecordKey,
    event: AppendableWorkflowJournalEvent
  ) => Effect.Effect<JournalRecord, JournalAppendError>
  readonly read: (runId: RunId) => Effect.Effect<ReadonlyArray<JournalRecord>, JournalStoreError>
  readonly readRunForRecovery: (
    runId: RunId,
    target: TrackerTarget
  ) => Effect.Effect<
    JournalRecord,
    JournalStoreError | WorkflowRunAlreadyTerminated | WorkflowRunNotBegan | WorkflowRunTargetMismatch
  >
  readonly scan: () => Effect.Effect<JournalScan, JournalStoreError>
  readonly terminateRun: (
    runId: RunId
  ) => Effect.Effect<JournalRecord, JournalStoreError | WorkflowRunAlreadyTerminated | WorkflowRunNotBegan>
}

export class JournalStore extends Context.Service<JournalStore, JournalStoreService>()("@dalph/JournalStore") {}
