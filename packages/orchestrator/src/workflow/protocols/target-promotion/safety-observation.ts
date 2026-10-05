import { Effect, Schema } from "effect"
import {
  journalRecordsForPromotionRequest,
  type JournalHistorySource
} from "../../../workflow-journal/record-evidence.js"
import { targetPromotionSafetyRefusedRecordKey } from "../../../workflow-journal/record-key.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  TargetPromotionTerminalBasis,
  TargetPromotionSafetyObservationOrdinal,
  TargetPromotionSafetyRefusedEvent,
  TargetPromotionSafetyRefusal,
  type TargetPromotionCorrelation,
  type TargetPromotionAttemptOrdinal
} from "./events.js"
import { deriveTargetPromotionState } from "./state.js"
import { appendTargetPromotionEvent } from "./transition-journal.js"

const refusalEquals = Schema.toEquivalence(TargetPromotionSafetyRefusal)
const basisEquals = Schema.toEquivalence(TargetPromotionTerminalBasis)

/** Retains a fresh failed boundary observation, without storing inventory or granting a retry. */
export const appendTargetPromotionSafetyRefusal = Effect.fn("TargetPromotion.appendSafetyRefusal")(function* (
  source: JournalHistorySource,
  boundary: TargetPromotionSafetyRefusedEvent["boundary"],
  correlation: TargetPromotionCorrelation,
  afterAttemptOrdinal: TargetPromotionAttemptOrdinal | undefined,
  refusal: TargetPromotionSafetyRefusal
) {
  const records = Array.from(journalRecordsForPromotionRequest(source, correlation.requestId))
  const basis =
    afterAttemptOrdinal === undefined
      ? TargetPromotionTerminalBasis.cases.BeforeFirstAttempt.make({})
      : TargetPromotionTerminalBasis.cases.AfterAttempt.make({ attemptOrdinal: afterAttemptOrdinal })
  const observations = records.flatMap(({ event }) => (event._tag === "TargetPromotionSafetyRefused" ? [event] : []))
  const last = observations[observations.length - 1]
  const current = deriveTargetPromotionState(records, correlation)
  if (
    current?._tag === "PromotionSafetyRefused" &&
    last !== undefined &&
    last.boundary === boundary &&
    basisEquals(last.basis, basis) &&
    refusalEquals(last.refusal, refusal)
  )
    return current
  const observationOrdinal = TargetPromotionSafetyObservationOrdinal.make(observations.length + 1)
  const event = TargetPromotionSafetyRefusedEvent.make({
    boundary,
    basis,
    correlation,
    observationOrdinal,
    refusal,
    version: workflowJournalEventVersion
  })
  const record = yield* appendTargetPromotionEvent(
    correlation,
    targetPromotionSafetyRefusedRecordKey(correlation.requestId, observationOrdinal),
    event
  )
  const state = deriveTargetPromotionState([...records, record], correlation)
  if (state?._tag !== "PromotionSafetyRefused")
    return yield* Effect.die("appended safety refusal did not reconstruct its exact promotion state")
  return state
})
