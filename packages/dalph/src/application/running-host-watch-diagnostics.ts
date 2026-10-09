import type { RunId } from "@dalph/contracts"
import {
  type AcceptedJournalReaderService,
  type CurrentSignal,
  type DeliveryRuntimeObservationState,
  type TrackerTarget,
  journalRecordAt,
  projectDeliveryDiagnostics
} from "@dalph/orchestrator"
import { Effect } from "effect"
import type { RunningHostError } from "./running-host-contract.js"
import { observerRetentionLimits, observerStructuralBytes } from "./running-host-observer-budget.js"

/** The reader lends its accepted canonical prefix without exporting an array.
 * Charge every record before diagnostic sorting, indexing or string preparation.
 * Conservative whole-prefix admission avoids duplicating diagnostic selection
 * policy. Excess optional preparation refuses this watch, never workflow work. */
export const readRunningHostWatchCurrent = Effect.fn("RunningHostWatch.readDiagnosticCurrent")(function* (
  current: CurrentSignal<DeliveryRuntimeObservationState>,
  reader: AcceptedJournalReaderService | undefined,
  runId: RunId,
  target: TrackerTarget
) {
  const state = yield* current.get
  if (state._tag !== "Ready" || reader === undefined) return state
  let remaining =
    observerRetentionLimits.preparationBytes -
    (yield* observerStructuralBytes(state, observerRetentionLimits.preparationBytes, "Preparation"))
  const prefix = yield* reader.readAccepted(runId).pipe(Effect.result)
  // Preserve existing unavailable-history behavior. A known budget refusal is
  // not an unavailable read and cannot fall back to a diagnostic-free value.
  if (prefix._tag === "Failure") return state
  for (let index = 0; index < prefix.success.records.length; index += 1) {
    const record = journalRecordAt(prefix.success.records, index)
    if (record === undefined)
      return yield* Effect.fail<RunningHostError>({
        _tag: "ReadFailed",
        causeTag: "AcceptedRecordMissing",
        detail: "The accepted prefix cannot supply its record."
      })
    const charge = yield* observerStructuralBytes(record, remaining, "Preparation").pipe(
      Effect.mapError(
        (): RunningHostError => ({
          _tag: "ObserverRetentionExceeded",
          boundary: "Preparation",
          maximumBytes: observerRetentionLimits.preparationBytes
        })
      )
    )
    remaining -= charge
  }
  return {
    ...state,
    evaluation: {
      ...state.evaluation,
      diagnostics: projectDeliveryDiagnostics(runId, prefix.success, undefined, target)
    }
  }
})
