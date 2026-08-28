import { Effect } from "effect"
import type { GitCommitSha } from "@dalph/contracts"
import { InRunJournal } from "../../../workflow-journal/store.js"
import {
  targetPromotionAttemptIntentRecordKey,
  targetPromotionIntentRecordKey,
  targetPromotionNonConvergenceRecordKey,
  targetPromotionObservedSuccessRecordKey,
  targetPromotionReconciliationDeferredRecordKey,
  targetPromotionStaleRecordKey
} from "../../../workflow-journal/record-key.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  TargetPromotionAttemptLimit,
  TargetPromotionAttemptIntendedEvent,
  TargetPromotionAttemptOrdinal,
  TargetPromotionAttemptReason,
  type TargetPromotionCorrelation,
  TargetPromotionGit,
  type TargetPromotionGitReadFailure,
  TargetPromotionIntendedEvent,
  TargetPromotionNonConvergenceEvent,
  TargetPromotionNonConvergenceObservation,
  TargetPromotionObservedSuccessEvent,
  TargetPromotionReconciliationDeferredEvent,
  TargetPromotionReconciliationDeferral,
  TargetPromotionStaleEvent,
  TargetPromotionStaleObservation,
  TargetPromotionTerminalBasis,
  TargetPromotionSuccessObservation,
  targetPromotionAttemptLimit,
  targetPromotionCandidateCommitOf,
  targetPromotionCorrelationFor,
  targetPromotionExpectedHeadOf,
  targetPromotionGitRequestFor,
  targetPromotionRunIdOf,
  type TargetPromotionAttemptReason as TargetPromotionAttemptReasonType,
  type TargetPromotionJournalEvent
} from "./events.js"
import { TargetPromotionCorrelationContradiction, TargetPromotionResultContradiction } from "./errors.js"
import {
  readObservationContradiction,
  successObservationForCompareAndSet,
  successObservationForRead
} from "./read-observation.js"
import type { IntegratorRunQualifiedCandidate } from "../integrator/events.js"
import {
  deriveTargetPromotionState,
  targetPromotionCorrelationConflictFor,
  TargetPromotionPendingRetry,
  TargetPromotionState
} from "./state.js"
export { deriveTargetPromotionState, TargetPromotionPendingRetry, TargetPromotionState } from "./state.js"
export { targetPromotionCorrelationConflictFor } from "./state.js"
export type { JournalOccurrence } from "./state.js"
export { targetPromotionCorrelationFor, targetPromotionRequestIdForCandidate } from "./events.js"
export { deriveTargetPromotionStateFor } from "./state-cache.js"
export { TargetPromotionCorrelationContradiction, TargetPromotionResultContradiction } from "./errors.js"

const ordinalFor = (value: number): TargetPromotionAttemptOrdinal => TargetPromotionAttemptOrdinal.make(value)

const appendPromotionEvent = Effect.fn("TargetPromotion.appendEvent")(function* (
  correlation: TargetPromotionCorrelation,
  key: Parameters<InRunJournal["Service"]["append"]>[1],
  event: TargetPromotionJournalEvent
) {
  const journal = yield* InRunJournal
  return yield* journal.append(targetPromotionRunIdOf(correlation), key, event)
})

const appendSuccess = Effect.fn("TargetPromotion.appendSuccess")(function* (
  correlation: TargetPromotionCorrelation,
  basis: TargetPromotionTerminalBasis,
  observation: TargetPromotionSuccessObservation
) {
  yield* appendPromotionEvent(
    correlation,
    targetPromotionObservedSuccessRecordKey(correlation.requestId),
    TargetPromotionObservedSuccessEvent.make({ basis, correlation, observation, version: workflowJournalEventVersion })
  )
  return TargetPromotionState.cases.PromotionSucceeded.make({ basis, correlation, observation })
})

const appendStale = Effect.fn("TargetPromotion.appendStale")(function* (
  correlation: TargetPromotionCorrelation,
  basis: TargetPromotionTerminalBasis,
  observation: TargetPromotionStaleObservation
) {
  yield* appendPromotionEvent(
    correlation,
    targetPromotionStaleRecordKey(correlation.requestId),
    TargetPromotionStaleEvent.make({ basis, correlation, observation, version: workflowJournalEventVersion })
  )
  return TargetPromotionState.cases.PromotionStale.make({ basis, correlation, observation })
})

const appendNonConvergence = Effect.fn("TargetPromotion.appendNonConvergence")(function* (
  correlation: TargetPromotionCorrelation,
  attemptOrdinal: TargetPromotionAttemptOrdinal,
  lastObservation: TargetPromotionNonConvergenceObservation
) {
  const attemptLimit = TargetPromotionAttemptLimit.make(targetPromotionAttemptLimit)
  yield* appendPromotionEvent(
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

const appendAttemptIntent = Effect.fn("TargetPromotion.appendAttemptIntent")(function* (
  correlation: TargetPromotionCorrelation,
  attemptOrdinal: TargetPromotionAttemptOrdinal,
  reason: TargetPromotionAttemptReasonType
) {
  yield* appendPromotionEvent(
    correlation,
    targetPromotionAttemptIntentRecordKey(correlation.requestId, attemptOrdinal),
    TargetPromotionAttemptIntendedEvent.make({
      attemptOrdinal,
      correlation,
      reason,
      version: workflowJournalEventVersion
    })
  )
})

const pendingAfterAmbiguousAttempt = (
  correlation: TargetPromotionCorrelation,
  attemptOrdinal: TargetPromotionAttemptOrdinal
): TargetPromotionState =>
  TargetPromotionState.cases.PromotionPending.make({
    correlation,
    retry: TargetPromotionPendingRetry.cases.NeedReconciliationRead.make({ afterAttemptOrdinal: attemptOrdinal })
  })

const appendReconciliationDeferral = Effect.fn("TargetPromotion.appendReconciliationDeferral")(function* (
  correlation: TargetPromotionCorrelation,
  afterAttemptOrdinal: TargetPromotionAttemptOrdinal,
  deferral: TargetPromotionReconciliationDeferral
) {
  yield* appendPromotionEvent(
    correlation,
    targetPromotionReconciliationDeferredRecordKey(correlation.requestId, afterAttemptOrdinal),
    TargetPromotionReconciliationDeferredEvent.make({
      afterAttemptOrdinal,
      correlation,
      deferral,
      version: workflowJournalEventVersion
    })
  )
  return TargetPromotionState.cases.PromotionReconciliationDeferred.make({ afterAttemptOrdinal, correlation, deferral })
})

/** Records intent for one attempt, then performs at most one compare-and-set. */
const performAttempt = Effect.fn("TargetPromotion.performAttempt")(function* (
  correlation: TargetPromotionCorrelation,
  attemptOrdinal: TargetPromotionAttemptOrdinal,
  reason: TargetPromotionAttemptReasonType
) {
  yield* appendAttemptIntent(correlation, attemptOrdinal, reason)
  const git = yield* TargetPromotionGit
  const result = yield* git.compareAndSet(targetPromotionGitRequestFor(correlation)).pipe(Effect.result)
  if (result._tag === "Failure") return pendingAfterAmbiguousAttempt(correlation, attemptOrdinal)
  if (result.success._tag === "RejectedExpectedHead") {
    if (result.success.observedHeadSha === targetPromotionCandidateCommitOf(correlation)) {
      return yield* appendSuccess(
        correlation,
        TargetPromotionTerminalBasis.cases.AfterAttempt.make({ attemptOrdinal }),
        TargetPromotionSuccessObservation.cases.ReconciledCandidateCurrent.make({
          candidateAncestry: "Current",
          targetHeadSha: result.success.observedHeadSha
        })
      )
    }
    if (result.success.observedHeadSha === targetPromotionExpectedHeadOf(correlation)) {
      return yield* new TargetPromotionResultContradiction({
        candidateCommit: targetPromotionCandidateCommitOf(correlation),
        detail: "Git rejected the compare-and-set while reporting the exact expected head"
      })
    }
    return yield* appendStale(
      correlation,
      TargetPromotionTerminalBasis.cases.AfterAttempt.make({ attemptOrdinal }),
      TargetPromotionStaleObservation.cases.CompareAndSetRejected.make({
        observedHeadSha: result.success.observedHeadSha
      })
    )
  }
  if (result.success.newHeadSha !== targetPromotionCandidateCommitOf(correlation)) {
    return yield* new TargetPromotionResultContradiction({
      candidateCommit: targetPromotionCandidateCommitOf(correlation),
      detail: `Git reported ${result.success.newHeadSha} after requesting ${targetPromotionCandidateCommitOf(correlation)}`
    })
  }
  return yield* appendSuccess(
    correlation,
    TargetPromotionTerminalBasis.cases.AfterAttempt.make({ attemptOrdinal }),
    successObservationForCompareAndSet(result.success)
  )
})

const runInitialRead = Effect.fn("TargetPromotion.runInitialRead")(function* (correlation: TargetPromotionCorrelation) {
  const git = yield* TargetPromotionGit
  const request = targetPromotionGitRequestFor(correlation)
  const readResult = yield* git.read(request).pipe(Effect.result)
  if (readResult._tag === "Failure") return yield* readResult.failure
  const readContradiction = readObservationContradiction(request, readResult.success)
  if (readContradiction !== undefined) {
    return yield* new TargetPromotionResultContradiction({
      candidateCommit: request.candidateCommit,
      detail: readContradiction
    })
  }
  const success = successObservationForRead(readResult.success)
  if (success !== undefined)
    return yield* appendSuccess(correlation, TargetPromotionTerminalBasis.cases.BeforeFirstAttempt.make({}), success)
  if (readResult.success.currentHeadSha !== request.expectedTargetHead)
    return yield* appendStale(
      correlation,
      TargetPromotionTerminalBasis.cases.BeforeFirstAttempt.make({}),
      TargetPromotionStaleObservation.cases.ReconciledCandidateNotInAncestry.make({
        observedHeadSha: readResult.success.currentHeadSha
      })
    )
  return yield* performAttempt(
    correlation,
    ordinalFor(1),
    TargetPromotionAttemptReason.cases.Initial.make({ observedHeadSha: readResult.success.currentHeadSha })
  )
})

const continueAfterExpectedHeadRead = Effect.fn("TargetPromotion.continueAfterExpectedHeadRead")(function* (
  correlation: TargetPromotionCorrelation,
  previousAttemptOrdinal: TargetPromotionAttemptOrdinal,
  observedHeadSha: GitCommitSha,
  authority: "ReadOnly" | "RetryAuthorized"
) {
  if (previousAttemptOrdinal === targetPromotionAttemptLimit) {
    return yield* appendNonConvergence(
      correlation,
      previousAttemptOrdinal,
      TargetPromotionNonConvergenceObservation.cases.ExpectedHeadStillObserved.make({ observedHeadSha })
    )
  }
  if (authority === "ReadOnly") {
    return yield* appendReconciliationDeferral(
      correlation,
      previousAttemptOrdinal,
      TargetPromotionReconciliationDeferral.cases.RetryAuthorityRequired.make({ observedHeadSha })
    )
  }
  const nextAttemptOrdinal = ordinalFor(previousAttemptOrdinal + 1)
  return yield* performAttempt(
    correlation,
    nextAttemptOrdinal,
    TargetPromotionAttemptReason.cases.ReconciledExpectedHead.make({ observedHeadSha, previousAttemptOrdinal })
  )
})

const finishFailedReconciliationRead = Effect.fn("TargetPromotion.finishFailedReconciliationRead")(function* (
  correlation: TargetPromotionCorrelation,
  previousAttemptOrdinal: TargetPromotionAttemptOrdinal,
  authority: "ReadOnly" | "RetryAuthorized",
  failure: TargetPromotionGitReadFailure
) {
  if (authority === "ReadOnly" && previousAttemptOrdinal !== targetPromotionAttemptLimit) {
    return yield* appendReconciliationDeferral(
      correlation,
      previousAttemptOrdinal,
      TargetPromotionReconciliationDeferral.cases.TargetReadFailed.make({ detail: failure.detail })
    )
  }
  return previousAttemptOrdinal === targetPromotionAttemptLimit
    ? yield* appendNonConvergence(
        correlation,
        previousAttemptOrdinal,
        TargetPromotionNonConvergenceObservation.cases.TargetReadFailed.make({ detail: failure.detail })
      )
    : yield* failure
})

const runReconciliationRead = Effect.fn("TargetPromotion.runReconciliationRead")(function* (
  correlation: TargetPromotionCorrelation,
  previousAttemptOrdinal: TargetPromotionAttemptOrdinal,
  authority: "ReadOnly" | "RetryAuthorized"
) {
  const git = yield* TargetPromotionGit
  const request = targetPromotionGitRequestFor(correlation)
  const readResult = yield* git.read(request).pipe(Effect.result)
  if (readResult._tag === "Failure") {
    return yield* finishFailedReconciliationRead(correlation, previousAttemptOrdinal, authority, readResult.failure)
  }
  const observation = readResult.success
  const readContradiction = readObservationContradiction(request, observation)
  if (readContradiction !== undefined)
    return yield* new TargetPromotionResultContradiction({
      candidateCommit: request.candidateCommit,
      detail: readContradiction
    })
  const success = successObservationForRead(observation)
  if (success !== undefined)
    return yield* appendSuccess(
      correlation,
      TargetPromotionTerminalBasis.cases.AfterAttempt.make({ attemptOrdinal: previousAttemptOrdinal }),
      success
    )
  if (observation._tag === "CandidateNotInAncestry" && observation.currentHeadSha !== request.expectedTargetHead) {
    return yield* appendStale(
      correlation,
      TargetPromotionTerminalBasis.cases.AfterAttempt.make({ attemptOrdinal: previousAttemptOrdinal }),
      TargetPromotionStaleObservation.cases.ReconciledCandidateNotInAncestry.make({
        observedHeadSha: observation.currentHeadSha
      })
    )
  }
  return yield* continueAfterExpectedHeadRead(
    correlation,
    previousAttemptOrdinal,
    observation.currentHeadSha,
    authority
  )
})

/** Reads Git to settle one ambiguous prior attempt but can never issue a new compare-and-set. */
export const reconcileTargetPromotionAttempt = Effect.fn("TargetPromotion.reconcileAttempt")(function* (
  candidate: IntegratorRunQualifiedCandidate
) {
  const correlation = targetPromotionCorrelationFor(candidate)
  const journal = yield* InRunJournal
  const records = yield* journal.read(targetPromotionRunIdOf(correlation))
  const foreignCorrelation = targetPromotionCorrelationConflictFor(records, correlation)
  if (foreignCorrelation !== undefined) {
    return yield* new TargetPromotionCorrelationContradiction({
      detail: "journal contains a different exact promotion correlation for this request id",
      requestId: correlation.requestId
    })
  }
  const state = deriveTargetPromotionState(records, correlation)
  if (state !== undefined && state._tag !== "PromotionPending") return state
  if (state?.retry._tag !== "NeedReconciliationRead") {
    return yield* new TargetPromotionResultContradiction({
      candidateCommit: candidate.candidateCommit,
      detail: "read-only reconciliation requires one exact unmatched compare-and-set intent"
    })
  }
  return yield* runReconciliationRead(correlation, state.retry.afterAttemptOrdinal, "ReadOnly")
})

const runPending = Effect.fn("TargetPromotion.runPending")(function* (
  correlation: TargetPromotionCorrelation,
  state: Extract<TargetPromotionState, { readonly _tag: "PromotionPending" }>
) {
  return state.retry._tag === "NeedInitialReconciliationRead"
    ? yield* runInitialRead(correlation)
    : yield* runReconciliationRead(correlation, state.retry.afterAttemptOrdinal, "RetryAuthorized")
})

const runDeferred = Effect.fn("TargetPromotion.runDeferred")(function* (
  state: Extract<TargetPromotionState, { readonly _tag: "PromotionReconciliationDeferred" }>
) {
  return state.deferral._tag === "RetryAuthorityRequired"
    ? yield* continueAfterExpectedHeadRead(
        state.correlation,
        state.afterAttemptOrdinal,
        state.deferral.observedHeadSha,
        "RetryAuthorized"
      )
    : yield* runReconciliationRead(state.correlation, state.afterAttemptOrdinal, "RetryAuthorized")
})

/** Performs at most one compare-and-set and one reconciliation read for one Integrator-qualified candidate. */
export const runTargetPromotion = Effect.fn("TargetPromotion.run")(function* (
  candidate: IntegratorRunQualifiedCandidate
) {
  const request = targetPromotionCorrelationFor(candidate)
  const journal = yield* InRunJournal
  const records = yield* journal.read(targetPromotionRunIdOf(request))
  const foreignCorrelation = targetPromotionCorrelationConflictFor(records, request)
  if (foreignCorrelation !== undefined) {
    return yield* new TargetPromotionCorrelationContradiction({
      detail: "journal contains a different exact promotion correlation for this request id",
      requestId: request.requestId
    })
  }
  const state = deriveTargetPromotionState(records, request)
  if (state !== undefined && state._tag !== "PromotionPending" && state._tag !== "PromotionReconciliationDeferred") {
    return state
  }
  if (state === undefined) {
    yield* appendPromotionEvent(
      request,
      targetPromotionIntentRecordKey(request.requestId),
      TargetPromotionIntendedEvent.make({ correlation: request, version: workflowJournalEventVersion })
    )
    return yield* runPending(
      request,
      TargetPromotionState.cases.PromotionPending.make({
        correlation: request,
        retry: TargetPromotionPendingRetry.cases.NeedInitialReconciliationRead.make({})
      })
    )
  }
  return state._tag === "PromotionReconciliationDeferred"
    ? yield* runDeferred(state)
    : yield* runPending(request, state)
})
