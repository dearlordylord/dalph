import { Effect } from "effect"
import { InRunJournal } from "../../../workflow-journal/store.js"
import { AcceptedJournalReader } from "../../../workflow-journal/accepted-reader.js"
import {
  journalRecordsForPromotionRequest,
  type JournalHistorySource
} from "../../../workflow-journal/record-evidence.js"
import type { RunId } from "@dalph/contracts"
import {
  targetPromotionNonConvergenceRecordKey,
  targetPromotionObservedSuccessRecordKey,
  targetPromotionReconciliationDeferredRecordKey,
  targetPromotionStaleRecordKey
} from "../../../workflow-journal/record-key.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  TargetPromotionAttemptLimit,
  type TargetPromotionAttemptOrdinal,
  type TargetPromotionCorrelation,
  TargetPromotionNonConvergenceEvent,
  type TargetPromotionNonConvergenceObservation,
  TargetPromotionObservedSuccessEvent,
  TargetPromotionReconciliationDeferredEvent,
  type TargetPromotionReconciliationDeferral,
  TargetPromotionStaleEvent,
  type TargetPromotionStaleObservation,
  type TargetPromotionSuccessObservation,
  type TargetPromotionTerminalBasis,
  targetPromotionAttemptLimit,
  targetPromotionRunIdOf,
  type TargetPromotionJournalEvent
} from "./events.js"
import { TargetPromotionCorrelationContradiction, TargetPromotionHistoryContradiction } from "./errors.js"
import {
  deriveTargetPromotionState,
  targetPromotionCorrelationConflictFor,
  targetPromotionReconciliationDeferralIssueFor,
  TargetPromotionState
} from "./state.js"

export const appendTargetPromotionEvent = Effect.fn("TargetPromotion.appendEvent")(function* (
  correlation: TargetPromotionCorrelation,
  key: Parameters<InRunJournal["Service"]["append"]>[1],
  event: TargetPromotionJournalEvent
) {
  const journal = yield* InRunJournal
  return yield* journal.append(targetPromotionRunIdOf(correlation), key, event)
})

export const appendTargetPromotionSuccess = Effect.fn("TargetPromotion.appendSuccess")(function* (
  correlation: TargetPromotionCorrelation,
  basis: TargetPromotionTerminalBasis,
  observation: TargetPromotionSuccessObservation
) {
  yield* appendTargetPromotionEvent(
    correlation,
    targetPromotionObservedSuccessRecordKey(correlation.requestId),
    TargetPromotionObservedSuccessEvent.make({ basis, correlation, observation, version: workflowJournalEventVersion })
  )
  return TargetPromotionState.cases.PromotionSucceeded.make({ basis, correlation, observation })
})

export const appendTargetPromotionStale = Effect.fn("TargetPromotion.appendStale")(function* (
  correlation: TargetPromotionCorrelation,
  basis: TargetPromotionTerminalBasis,
  observation: TargetPromotionStaleObservation
) {
  yield* appendTargetPromotionEvent(
    correlation,
    targetPromotionStaleRecordKey(correlation.requestId),
    TargetPromotionStaleEvent.make({ basis, correlation, observation, version: workflowJournalEventVersion })
  )
  return TargetPromotionState.cases.PromotionStale.make({ basis, correlation, observation })
})

export const appendTargetPromotionNonConvergence = Effect.fn("TargetPromotion.appendNonConvergence")(function* (
  correlation: TargetPromotionCorrelation,
  attemptOrdinal: TargetPromotionAttemptOrdinal,
  lastObservation: TargetPromotionNonConvergenceObservation
) {
  const attemptLimit = TargetPromotionAttemptLimit.make(targetPromotionAttemptLimit)
  yield* appendTargetPromotionEvent(
    correlation,
    targetPromotionNonConvergenceRecordKey(correlation.requestId),
    TargetPromotionNonConvergenceEvent.make({
      attemptLimit,
      attemptOrdinal,
      correlation,
      lastObservation,
      version: workflowJournalEventVersion
    })
  )
  return TargetPromotionState.cases.PromotionNonConvergent.make({
    attemptLimit,
    attemptOrdinal,
    correlation,
    lastObservation
  })
})

export const appendTargetPromotionReconciliationDeferral = Effect.fn("TargetPromotion.appendReconciliationDeferral")(
  function* (
    correlation: TargetPromotionCorrelation,
    afterAttemptOrdinal: TargetPromotionAttemptOrdinal,
    deferral: TargetPromotionReconciliationDeferral
  ) {
    yield* appendTargetPromotionEvent(
      correlation,
      targetPromotionReconciliationDeferredRecordKey(correlation.requestId, afterAttemptOrdinal),
      TargetPromotionReconciliationDeferredEvent.make({
        afterAttemptOrdinal,
        correlation,
        deferral,
        version: workflowJournalEventVersion
      })
    )
    return TargetPromotionState.cases.PromotionReconciliationDeferred.make({
      afterAttemptOrdinal,
      correlation,
      deferral
    })
  }
)

/** Current decoded evidence is an input, not a claim that the whole workflow history is accepted. */
export type CurrentTargetPromotionEvidence<E, R> = (runId: RunId) => Effect.Effect<JournalHistorySource, E, R>

export const readAcceptedTargetPromotionEvidence = Effect.fn("TargetPromotion.readAcceptedEvidence")(function* (
  runId: RunId
) {
  const accepted = yield* AcceptedJournalReader
  return yield* accepted.readAccepted(runId)
})

export const validateTargetPromotionState = Effect.fn("TargetPromotion.validateState")(function* (
  source: JournalHistorySource,
  correlation: TargetPromotionCorrelation
) {
  const records = Array.from(journalRecordsForPromotionRequest(source, correlation.requestId))
  const foreignCorrelation = targetPromotionCorrelationConflictFor(records, correlation)
  if (foreignCorrelation !== undefined) {
    return yield* new TargetPromotionCorrelationContradiction({
      detail: "journal contains a different exact promotion correlation for this request id",
      requestId: correlation.requestId
    })
  }
  const deferralIssue = targetPromotionReconciliationDeferralIssueFor(records, correlation)
  if (deferralIssue !== undefined) {
    return yield* new TargetPromotionHistoryContradiction({ detail: deferralIssue, requestId: correlation.requestId })
  }
  return deriveTargetPromotionState(records, correlation)
})
