import { Context, Effect, Schema } from "effect"
import { RunId } from "@dalph/contracts"
import {
  JournalDataCorruption,
  JournalHistoryCorruption,
  JournalHistoryNotTerminal,
  JournalPartitionContradiction,
  JournalSchemaIncompatible,
  JournalStorageAccessDenied,
  JournalStorageCapacityExhausted,
  JournalStorageLocked,
  JournalStorageUnavailable,
  type JournalStoreError,
  WorkflowRunNotBegan
} from "./store.js"

/** Typed failures that can leave one already-terminated Run in hot storage. */
export const JournalMaintenanceFailure = Schema.Union([
  JournalDataCorruption,
  JournalHistoryCorruption,
  JournalHistoryNotTerminal,
  JournalPartitionContradiction,
  JournalSchemaIncompatible,
  JournalStorageAccessDenied,
  JournalStorageCapacityExhausted,
  JournalStorageLocked,
  JournalStorageUnavailable,
  WorkflowRunNotBegan
])
export type JournalMaintenanceFailure = typeof JournalMaintenanceFailure.Type

/** Application diagnostic emitted when storage maintenance degrades after workflow termination committed. */
export const JournalMaintenanceDiagnostic = Schema.TaggedStruct("JournalMaintenanceDiagnostic", {
  failure: JournalMaintenanceFailure,
  operation: Schema.Literal("JournalStore.retireTerminalRun"),
  runId: RunId
})
export type JournalMaintenanceDiagnostic = typeof JournalMaintenanceDiagnostic.Type

/** Narrow application boundary for observing terminal-history maintenance degradation. */
export interface JournalMaintenanceObservationService {
  readonly observe: (diagnostic: JournalMaintenanceDiagnostic) => Effect.Effect<void>
}

export class JournalMaintenanceObservation extends Context.Service<
  JournalMaintenanceObservation,
  JournalMaintenanceObservationService
>()("@dalph/JournalMaintenanceObservation") {}

/** Maps one storage failure to the typed application diagnostic without adding a journal occurrence. */
export const journalMaintenanceDiagnosticFor = (
  runId: RunId,
  failure: JournalStoreError | JournalHistoryNotTerminal | WorkflowRunNotBegan
): JournalMaintenanceDiagnostic => ({
  _tag: "JournalMaintenanceDiagnostic",
  failure,
  operation: "JournalStore.retireTerminalRun",
  runId
})

/** Keeps default production composition observable without creating a retry worker or durable debt record. */
export const defaultJournalMaintenanceObservation = JournalMaintenanceObservation.of({
  observe: (diagnostic) => Effect.logWarning(diagnostic)
})

/** Explicit test composition that observes the boundary without adding a logger or retry worker. */
export const noopJournalMaintenanceObservation = JournalMaintenanceObservation.of({ observe: () => Effect.void })
