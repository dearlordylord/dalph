// @effect-diagnostics lazyEffect:off
import { Context, Effect, Layer, Schema } from "effect"
import { RunId } from "@dalph/contracts"
import { JournalPartition, JournalPosition, JournalRecordKey, JournalSchemaVersion } from "./identity.js"
import { TrackerTarget } from "../authorities/task-tracker/target.js"
import type { JournalAudit, JournalScan } from "./recovery-model.js"
import {
  type WorkflowJournalEvent,
  WorkflowJournalEvent as WorkflowJournalEventSchema
} from "../workflow/registry/event.js"
import type { InitialControlPolicy } from "../control/policy.js"
import type { RunFinalityEvidence, RunTerminationDisposition } from "../coordination/frontier/run-finality.js"
import { InRunJournal } from "./in-run-journal.js"
export { InRunJournal } from "./in-run-journal.js"
export type { InRunJournalService } from "./in-run-journal.js"

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

export const JournalStoreOperation = Schema.Literals([
  "JournalStore.open",
  "JournalStore.migrate",
  "JournalStore.append",
  "JournalStore.read",
  "JournalStore.beginRun",
  "JournalStore.terminateRun",
  "JournalStore.readRunForRecovery",
  "JournalStore.scanHot",
  "JournalStore.auditAll",
  "JournalStore.retireTerminalRun"
])
export type JournalStoreOperation = typeof JournalStoreOperation.Type

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

/** One exact Run history is malformed in one physical Journal partition. */
export class JournalHistoryCorruption extends Schema.TaggedError<JournalHistoryCorruption>()(
  "JournalHistoryCorruption",
  { operation: JournalStoreOperation, detail: Schema.String, partition: JournalPartition, runId: RunId }
) {}

/** The database belongs to a journal schema this Dalph cannot safely open. */
export class JournalSchemaIncompatible extends Schema.TaggedError<JournalSchemaIncompatible>()(
  "JournalSchemaIncompatible",
  { found: JournalSchemaVersion, supported: JournalSchemaVersion }
) {}

export type JournalStoreError =
  | JournalDataCorruption
  | JournalHistoryCorruption
  | JournalSchemaIncompatible
  | JournalStorageAccessDenied
  | JournalStorageCapacityExhausted
  | JournalStorageLocked
  | JournalStorageUnavailable
  | JournalPartitionContradiction

/** The same durable key was presented with unequal workflow-journal-history content. */
export class JournalStoreContradiction extends Schema.TaggedError<JournalStoreContradiction>()(
  "JournalStoreContradiction",
  { runId: RunId, key: JournalRecordKey, existingPosition: JournalPosition }
) {}

/** One Run was found in both storage partitions, so neither copy may be used. */
export class JournalPartitionContradiction extends Schema.TaggedError<JournalPartitionContradiction>()(
  "JournalPartitionContradiction",
  { runId: RunId }
) {}

/** A complete history lacks the valid final termination occurrence required for retirement. */
export class JournalHistoryNotTerminal extends Schema.TaggedError<JournalHistoryNotTerminal>()(
  "JournalHistoryNotTerminal",
  { runId: RunId }
) {}

/** The exact result of one atomic terminal-history retirement attempt. */
export const JournalTerminalHistoryRetirement = Schema.Union([
  Schema.TaggedStruct("Retired", { from: Schema.Literal("Hot"), runId: RunId, to: Schema.Literal("Cold") }),
  Schema.TaggedStruct("AlreadyRetired", { partition: Schema.Literal("Cold"), runId: RunId })
])
export type JournalTerminalHistoryRetirement = typeof JournalTerminalHistoryRetirement.Type

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

/** Run establishment submitted an identity whose durable beginning already exists. */
export class WorkflowRunAlreadyBegan extends Schema.TaggedError<WorkflowRunAlreadyBegan>()("WorkflowRunAlreadyBegan", {
  beganAt: JournalPosition,
  runId: RunId
}) {}

/** Run establishment received an identity already used by non-lifecycle journal history. */
export class WorkflowRunIdentityAlreadyUsed extends Schema.TaggedError<WorkflowRunIdentityAlreadyUsed>()(
  "WorkflowRunIdentityAlreadyUsed",
  { firstRecordAt: JournalPosition, runId: RunId }
) {}

/** Run establishment or termination named an identity for which no Run beginning exists. */
export class WorkflowRunNotBegan extends Schema.TaggedError<WorkflowRunNotBegan>()("WorkflowRunNotBegan", {
  runId: RunId
}) {}

/** Run establishment named a tracker target different from the one recorded when the Run began. */
export class WorkflowRunTargetMismatch extends Schema.TaggedError<WorkflowRunTargetMismatch>()(
  "WorkflowRunTargetMismatch",
  { recordedTarget: TrackerTarget, requestedTarget: TrackerTarget, runId: RunId }
) {}

/** The caller attempted to activate a Run after its durable termination. */
export class WorkflowRunAlreadyTerminated extends Schema.TaggedError<WorkflowRunAlreadyTerminated>()(
  "WorkflowRunAlreadyTerminated",
  { runId: RunId, terminatedAt: JournalPosition }
) {}

/** A terminal append supplied evidence that does not describe the current journal prefix. */
export class WorkflowRunTerminationEvidenceInvalid extends Schema.TaggedError<WorkflowRunTerminationEvidenceInvalid>()(
  "WorkflowRunTerminationEvidenceInvalid",
  { detail: Schema.String, runId: RunId }
) {}

/** Failures owned by raw persistence before journal state publication exists. */
export type JournalStorageAppendError = JournalStoreContradiction | JournalStoreError | WorkflowRunAlreadyTerminated

/** Failures from raw persistence or the installed journal state service. */
export type JournalAppendError = JournalError | InRunJournalRunMismatch | JournalStorageAppendError

/** Whether a failed append call proves that its exact record was never submitted to storage. */
type JournalAppendFailureDisposition = "DefinitelyAbsent" | "MayHaveCommitted" | "NotJournalAppendFailure"

const JournalAppendErrorSchema = Schema.Union([
  JournalHistoryInvalid,
  JournalPositionGap,
  JournalRecordMismatch,
  InRunJournalRunMismatch,
  JournalStoreContradiction,
  JournalDataCorruption,
  JournalHistoryCorruption,
  JournalSchemaIncompatible,
  JournalStorageAccessDenied,
  JournalStorageCapacityExhausted,
  JournalStorageLocked,
  JournalStorageUnavailable,
  JournalPartitionContradiction,
  WorkflowRunAlreadyTerminated
])

const journalAppendFailureDispositions: Readonly<Record<JournalAppendError["_tag"], JournalAppendFailureDisposition>> =
  {
    InRunJournalRunMismatch: "DefinitelyAbsent",
    JournalDataCorruption: "MayHaveCommitted",
    JournalHistoryCorruption: "MayHaveCommitted",
    JournalHistoryInvalid: "MayHaveCommitted",
    JournalPartitionContradiction: "MayHaveCommitted",
    JournalPositionGap: "MayHaveCommitted",
    JournalRecordMismatch: "MayHaveCommitted",
    JournalSchemaIncompatible: "MayHaveCommitted",
    JournalStorageAccessDenied: "MayHaveCommitted",
    JournalStorageCapacityExhausted: "MayHaveCommitted",
    JournalStorageLocked: "MayHaveCommitted",
    JournalStorageUnavailable: "MayHaveCommitted",
    JournalStoreContradiction: "MayHaveCommitted",
    WorkflowRunAlreadyTerminated: "MayHaveCommitted"
  }

/** Exhaustively classifies typed append failures without inspecting error names or messages. */
export const journalAppendFailureDisposition = (failure: unknown): JournalAppendFailureDisposition => {
  if (!Schema.is(JournalAppendErrorSchema)(failure)) return "NotJournalAppendFailure"
  return journalAppendFailureDispositions[failure._tag]
}

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
  /** Discovers only histories whose rows remain eligible to own recovery work. */
  readonly scanHot: () => Effect.Effect<JournalScan, JournalStoreError>
  /** Explicitly audits both physical partitions, including cold historical rows. */
  readonly auditAll: () => Effect.Effect<JournalAudit, JournalStoreError>
  /** Atomically moves one complete valid terminal history from hot to cold. */
  readonly retireTerminalRun: (
    runId: RunId
  ) => Effect.Effect<
    JournalTerminalHistoryRetirement,
    JournalStoreError | WorkflowRunNotBegan | JournalHistoryNotTerminal
  >
  readonly terminateRun: (
    runId: RunId,
    disposition: RunTerminationDisposition,
    evidence: RunFinalityEvidence
  ) => Effect.Effect<
    JournalRecord,
    JournalStoreError | WorkflowRunAlreadyTerminated | WorkflowRunNotBegan | WorkflowRunTerminationEvidenceInvalid
  >
}

export class JournalStore extends Context.Service<JournalStore, JournalStoreService>()("@dalph/JournalStore") {}

/** Bootstrap and post-runtime Run lifecycle access; ordinary workflow services never receive it. */
export interface RunLifecycleJournalService {
  readonly beginRun: JournalStoreService["beginRun"]
  readonly read: JournalStoreService["read"]
  readonly readRunForRecovery: JournalStoreService["readRunForRecovery"]
  readonly scanHot: JournalStoreService["scanHot"]
  readonly auditAll: JournalStoreService["auditAll"]
  readonly retireTerminalRun: JournalStoreService["retireTerminalRun"]
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
            scanHot: journal.scanHot,
            auditAll: journal.auditAll,
            retireTerminalRun: journal.retireTerminalRun,
            terminateRun: journal.terminateRun
          })
        )
      )
    })
  ).pipe(Layer.provide(storage))

/**
 * Test-support adapter for focused protocol compositions that intentionally do
 * not install the published Journal service. Production bootstrap receives raw
 * storage and installs its own published Journal capability.
 */
export const unpublishedInRunJournalTestLayer = Layer.effect(
  InRunJournal,
  JournalStore.pipe(Effect.map((journal) => InRunJournal.of({ append: journal.append, read: journal.read })))
)
