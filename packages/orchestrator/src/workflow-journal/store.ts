// @effect-diagnostics lazyEffect:off
import { Context, Effect, Layer, Schema } from "effect"
import { RunId } from "@dalph/contracts"
import { JournalPosition, JournalRecordKey, JournalSchemaVersion } from "./identity.js"
import { TrackerTarget } from "../authorities/task-tracker/target.js"
import type { JournalScan } from "./recovery-model.js"
import {
  type WorkflowJournalEvent,
  WorkflowJournalEvent as WorkflowJournalEventSchema
} from "../workflow/registry/event.js"
import type { InitialControlPolicy } from "../control/policy.js"

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
export class JournalStorageUnavailable extends Schema.TaggedError<JournalStorageUnavailable>()(
  "JournalStorageUnavailable",
  { operation: JournalStoreOperation, detail: Schema.String }
) {}

/** Another live writer currently owns the journal; retry requires new ownership. */
export class JournalStorageLocked extends Schema.TaggedError<JournalStorageLocked>()("JournalStorageLocked", {
  operation: JournalStoreOperation,
  detail: Schema.String
}) {}

/** Journal access was denied and requires configuration or operator repair. */
export class JournalStorageAccessDenied extends Schema.TaggedError<JournalStorageAccessDenied>()(
  "JournalStorageAccessDenied",
  { operation: JournalStoreOperation, detail: Schema.String }
) {}

/** Journal storage has exhausted capacity and cannot progress by immediate retry. */
export class JournalStorageCapacityExhausted extends Schema.TaggedError<JournalStorageCapacityExhausted>()(
  "JournalStorageCapacityExhausted",
  { operation: JournalStoreOperation, detail: Schema.String }
) {}

/** Persisted journal bytes do not satisfy Dalph's workflow-journal-history schema. */
export class JournalDataCorruption extends Schema.TaggedError<JournalDataCorruption>()("JournalDataCorruption", {
  operation: JournalStoreOperation,
  detail: Schema.String
}) {}

/** The database belongs to a journal schema this Dalph cannot safely open. */
export class JournalSchemaIncompatible extends Schema.TaggedError<JournalSchemaIncompatible>()(
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
export class JournalStoreContradiction extends Schema.TaggedError<JournalStoreContradiction>()(
  "JournalStoreContradiction",
  { runId: RunId, key: JournalRecordKey, existingPosition: JournalPosition }
) {}

/** An in-Run capability was used for a Run other than the one installed behind it. */
export class InRunJournalRunMismatch extends Schema.TaggedError<InRunJournalRunMismatch>()("InRunJournalRunMismatch", {
  expectedRunId: RunId,
  requestedRunId: RunId
}) {}

/** Journal storage returned a non-successor position while the coordinator held exclusive ownership. */
export class JournalPositionGap extends Schema.TaggedError<JournalPositionGap>()("JournalPositionGap", {
  position: JournalPosition,
  expectedPosition: JournalPosition,
  runId: RunId
}) {}

/** Idempotent append returned a record unequal to the journal record at that position. */
export class JournalRecordMismatch extends Schema.TaggedError<JournalRecordMismatch>()("JournalRecordMismatch", {
  position: JournalPosition,
  key: JournalRecordKey,
  runId: RunId
}) {}

/** A newly appended record made the in-process journal prefix invalid and publication stopped. */
export class JournalHistoryInvalid extends Schema.TaggedError<JournalHistoryInvalid>()("JournalHistoryInvalid", {
  position: JournalPosition,
  detail: Schema.String,
  runId: RunId
}) {}

/** A durable append could not be reconciled with the process-local journal prefix. */
export type JournalError = JournalHistoryInvalid | JournalPositionGap | JournalRecordMismatch

/** The fresh-start boundary submitted an identity whose Run already began. */
export class WorkflowRunAlreadyBegan extends Schema.TaggedError<WorkflowRunAlreadyBegan>()("WorkflowRunAlreadyBegan", {
  beganAt: JournalPosition,
  runId: RunId
}) {}

/** The fresh-start boundary received an identity already used by non-lifecycle journal history. */
export class WorkflowRunIdentityAlreadyUsed extends Schema.TaggedError<WorkflowRunIdentityAlreadyUsed>()(
  "WorkflowRunIdentityAlreadyUsed",
  { firstRecordAt: JournalPosition, runId: RunId }
) {}

/** Recovery or termination named an identity for which no Run beginning exists. */
export class WorkflowRunNotBegan extends Schema.TaggedError<WorkflowRunNotBegan>()("WorkflowRunNotBegan", {
  runId: RunId
}) {}

/** Recovery named a tracker target different from the one recorded when the Run began. */
export class WorkflowRunTargetMismatch extends Schema.TaggedError<WorkflowRunTargetMismatch>()(
  "WorkflowRunTargetMismatch",
  { recordedTarget: TrackerTarget, requestedTarget: TrackerTarget, runId: RunId }
) {}

/** The caller attempted to recover or extend a Run after its durable termination. */
export class WorkflowRunAlreadyTerminated extends Schema.TaggedError<WorkflowRunAlreadyTerminated>()(
  "WorkflowRunAlreadyTerminated",
  { runId: RunId, terminatedAt: JournalPosition }
) {}

/** Failures owned by raw persistence before journal state publication exists. */
export type JournalStorageAppendError = JournalStoreContradiction | JournalStoreError | WorkflowRunAlreadyTerminated

/** Failures from raw persistence or the installed journal state service. */
export type JournalAppendError = JournalError | InRunJournalRunMismatch | JournalStorageAppendError

/** Failures that prevent a caller from reading one coherent in-Run journal prefix. */
export type JournalReadError = JournalError | InRunJournalRunMismatch | JournalStoreError

export interface JournalStoreService {
  readonly beginRun: (
    runId: RunId,
    target: TrackerTarget,
    initialControlPolicy: InitialControlPolicy
  ) => Effect.Effect<JournalRecord, JournalStoreError | WorkflowRunAlreadyBegan | WorkflowRunIdentityAlreadyUsed>
  readonly append: (
    runId: RunId,
    key: JournalRecordKey,
    event: AppendableWorkflowJournalEvent
  ) => Effect.Effect<JournalRecord, JournalStorageAppendError>
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

/** Fixed-process access to ordinary Run history; it cannot begin, recover, scan, or terminate a Run. */
export interface InRunJournalService {
  readonly append: (
    runId: RunId,
    key: JournalRecordKey,
    event: AppendableWorkflowJournalEvent
  ) => Effect.Effect<JournalRecord, JournalAppendError>
  readonly read: (runId: RunId) => Effect.Effect<ReadonlyArray<JournalRecord>, JournalReadError>
}

export class InRunJournal extends Context.Service<InRunJournal, InRunJournalService>()("@dalph/InRunJournal") {}

/** Bootstrap and post-runtime Run lifecycle access; ordinary workflow services never receive it. */
export interface RunLifecycleJournalService {
  readonly beginRun: JournalStoreService["beginRun"]
  readonly read: JournalStoreService["read"]
  readonly readRunForRecovery: JournalStoreService["readRunForRecovery"]
  readonly scan: JournalStoreService["scan"]
  readonly terminateRun: JournalStoreService["terminateRun"]
}

export class RunLifecycleJournal extends Context.Service<RunLifecycleJournal, RunLifecycleJournalService>()(
  "@dalph/RunLifecycleJournal"
) {}

/** Exposes raw storage and lifecycle operations without fabricating journal state. */
export const journalStoreCapabilities = <E, R>(
  storage: Layer.Layer<JournalStore, E, R>
): Layer.Layer<JournalStore | RunLifecycleJournal, E, R> =>
  Layer.effectContext(
    Effect.gen(function* () {
      const journal = yield* JournalStore
      return Context.empty().pipe(
        Context.add(JournalStore, journal),
        Context.add(
          RunLifecycleJournal,
          RunLifecycleJournal.of({
            beginRun: journal.beginRun,
            read: journal.read,
            readRunForRecovery: journal.readRunForRecovery,
            scan: journal.scan,
            terminateRun: journal.terminateRun
          })
        )
      )
    })
  ).pipe(Layer.provide(storage))

/**
 * Temporary adapter for test and scheduler compositions that do not install the
 * Journal service. Production bootstrap must receive raw storage and install
 * its own published Journal capability.
 * #184 deletes the remaining scheduler consumers.
 */
export const legacyUnpublishedInRunJournalLayer = Layer.effect(
  InRunJournal,
  JournalStore.pipe(Effect.map((journal) => InRunJournal.of({ append: journal.append, read: journal.read })))
)
