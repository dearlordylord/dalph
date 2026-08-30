import { Effect } from "effect"
import { InRunJournal } from "../../../workflow-journal/store.js"
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

export const readValidatedTargetPromotionState = Effect.fn("TargetPromotion.readValidatedState")(function* (
  correlation: TargetPromotionCorrelation
) {
  const journal = yield* InRunJournal
  const records = yield* journal.read(targetPromotionRunIdOf(correlation))
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
