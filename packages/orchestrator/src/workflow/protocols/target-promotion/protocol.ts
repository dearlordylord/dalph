/* eslint-disable functional/immutable-data -- Process-local memo indexes mutate only private maps; promotion state stays journal-derived. */
import { Effect, Schema } from "effect"
import { GitCommitSha } from "@dalph/contracts"
import { InRunJournal } from "../../../workflow-journal/store.js"
import {
  targetPromotionAttemptIntentRecordKey,
  targetPromotionIntentRecordKey,
  targetPromotionNonConvergenceRecordKey,
  targetPromotionObservedSuccessRecordKey,
  targetPromotionStaleRecordKey
} from "../../../workflow-journal/record-key.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  TargetPromotionAttemptLimit,
  TargetPromotionAttemptIntendedEvent,
  TargetPromotionAttemptOrdinal,
  TargetPromotionAttemptReason,
  type TargetPromotionCorrelation,
  TargetPromotionRequestId,
  TargetPromotionGit,
  TargetPromotionIntendedEvent,
  TargetPromotionNonConvergenceEvent,
  TargetPromotionNonConvergenceObservation,
  TargetPromotionObservedSuccessEvent,
  TargetPromotionStaleEvent,
  TargetPromotionStaleObservation,
  TargetPromotionTerminalBasis,
  TargetPromotionSuccessObservation,
  targetPromotionAttemptLimit,
  targetPromotionCandidateCommitOf,
  targetPromotionCorrelationEquals,
  targetPromotionCorrelationFor,
  targetPromotionExpectedHeadOf,
  targetPromotionGitRequestFor,
  targetPromotionRunIdOf,
  type TargetPromotionAttemptReason as TargetPromotionAttemptReasonType,
  type TargetPromotionCompareAndSetResult,
  type TargetPromotionGitReadObservation,
  TargetPromotionJournalEvent,
  type TargetPromotionGitRequest
} from "./events.js"
import type { IntegratorRunQualifiedCandidate } from "../integrator/events.js"
import {
  deriveTargetPromotionState,
  targetPromotionCorrelationConflictFor,
  TargetPromotionPendingRetry,
  TargetPromotionState,
  type JournalOccurrence
} from "./state.js"
import { journalPrefixPredecessorOf } from "../../../workflow-journal/prefix-lineage.js"
export { deriveTargetPromotionState, TargetPromotionPendingRetry, TargetPromotionState } from "./state.js"
export { targetPromotionCorrelationConflictFor } from "./state.js"
export type { JournalOccurrence } from "./state.js"
export { targetPromotionCorrelationFor, targetPromotionRequestIdForCandidate } from "./events.js"

/** A provider returned a successful mutation for a commit other than the requested M. */
export class TargetPromotionResultContradiction extends Schema.TaggedError<TargetPromotionResultContradiction>()(
  "TargetPromotionResultContradiction",
  { candidateCommit: GitCommitSha, detail: Schema.String }
) {}

/** Fails closed when one request id is reused for a different exact promotion correlation. */
export class TargetPromotionCorrelationContradiction extends Schema.TaggedError<TargetPromotionCorrelationContradiction>()(
  "TargetPromotionCorrelationContradiction",
  { detail: Schema.String, requestId: TargetPromotionRequestId }
) {}

const ordinalFor = (value: number): TargetPromotionAttemptOrdinal => TargetPromotionAttemptOrdinal.make(value)

const appendPromotionEvent = Effect.fn("TargetPromotion.appendEvent")(function* (
  correlation: TargetPromotionCorrelation,
  key: Parameters<InRunJournal["Service"]["append"]>[1],
  event: TargetPromotionJournalEvent
) {
  const journal = yield* InRunJournal
  return yield* journal.append(targetPromotionRunIdOf(correlation), key, event)
})

const successObservationForCompareAndSet = (
  result: Extract<TargetPromotionCompareAndSetResult, { readonly _tag: "Applied" }>
): TargetPromotionSuccessObservation =>
  TargetPromotionSuccessObservation.cases.CompareAndSetApplied.make({
    candidateAncestry: "Current",
    targetHeadSha: result.newHeadSha
  })

const successObservationForRead = (
  observation: TargetPromotionGitReadObservation
): TargetPromotionSuccessObservation | undefined => {
  if (observation._tag === "CandidateCurrent") {
    return TargetPromotionSuccessObservation.cases.ReconciledCandidateCurrent.make({
      candidateAncestry: "Current",
      targetHeadSha: observation.currentHeadSha
    })
  }
  if (observation._tag === "CandidateAncestor") {
    return TargetPromotionSuccessObservation.cases.ReconciledCandidateAncestor.make({
      candidateAncestry: "Ancestor",
      targetHeadSha: observation.currentHeadSha
    })
  }
  return undefined
}

const readObservationContradiction = (
  request: TargetPromotionGitRequest,
  observation: TargetPromotionGitReadObservation
): string | undefined => {
  if (observation._tag === "CandidateCurrent" && observation.currentHeadSha !== request.candidateCommit)
    return "Git classified a non-candidate head as the candidate current head"
  if (observation._tag !== "CandidateCurrent" && observation.currentHeadSha === request.candidateCommit)
    return "Git classified the exact candidate current head as not current"
  if (observation._tag === "CandidateAncestor" && observation.currentHeadSha === request.expectedTargetHead)
    return "Git classified the candidate as an ancestor of its own expected first parent"
  return undefined
}

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

const runReconciliationRead = Effect.fn("TargetPromotion.runReconciliationRead")(function* (
  correlation: TargetPromotionCorrelation,
  previousAttemptOrdinal: TargetPromotionAttemptOrdinal
) {
  const git = yield* TargetPromotionGit
  const request = targetPromotionGitRequestFor(correlation)
  const readResult = yield* git.read(request).pipe(Effect.result)
  if (readResult._tag === "Failure")
    return previousAttemptOrdinal === targetPromotionAttemptLimit
      ? yield* appendNonConvergence(
          correlation,
          previousAttemptOrdinal,
          TargetPromotionNonConvergenceObservation.cases.TargetReadFailed.make({ detail: readResult.failure.detail })
        )
      : yield* readResult.failure
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
  if (previousAttemptOrdinal === targetPromotionAttemptLimit) {
    return yield* appendNonConvergence(
      correlation,
      previousAttemptOrdinal,
      TargetPromotionNonConvergenceObservation.cases.ExpectedHeadStillObserved.make({
        observedHeadSha: observation.currentHeadSha
      })
    )
  }

  const nextAttemptOrdinal = ordinalFor(previousAttemptOrdinal + 1)
  return yield* performAttempt(
    correlation,
    nextAttemptOrdinal,
    TargetPromotionAttemptReason.cases.ReconciledExpectedHead.make({
      observedHeadSha: observation.currentHeadSha,
      previousAttemptOrdinal
    })
  )
})

const runPending = Effect.fn("TargetPromotion.runPending")(function* (
  correlation: TargetPromotionCorrelation,
  state: Extract<TargetPromotionState, { readonly _tag: "PromotionPending" }>
) {
  return state.retry._tag === "NeedInitialReconciliationRead"
    ? yield* runInitialRead(correlation)
    : yield* runReconciliationRead(correlation, state.retry.afterAttemptOrdinal)
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
  if (state !== undefined && state._tag !== "PromotionPending") {
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
  return yield* runPending(request, state)
})

/** Reconstructs state for one exact Integrator-qualified candidate. */
type PromotionStateCacheEntry = readonly [TargetPromotionCorrelation, TargetPromotionState | undefined]

const promotionStateByPrefix = new WeakMap<ReadonlyArray<JournalOccurrence>, Array<PromotionStateCacheEntry>>()

export const deriveTargetPromotionStateFor = (
  records: ReadonlyArray<JournalOccurrence>,
  candidate: IntegratorRunQualifiedCandidate
): TargetPromotionState | undefined => {
  const request = targetPromotionCorrelationFor(candidate)
  const cachedByRequest = promotionStateByPrefix.get(records)
  const cached = cachedByRequest?.find(([cachedRequest]) => targetPromotionCorrelationEquals(cachedRequest, request))
  if (cached !== undefined) return cached[1]
  const predecessor = journalPrefixPredecessorOf(records)
  if (predecessor !== undefined && !Schema.is(TargetPromotionJournalEvent)(predecessor.appended.event)) {
    const state = deriveTargetPromotionStateFor(predecessor.prior, candidate)
    const cache = cachedByRequest ?? []
    cache.push([request, state])
    promotionStateByPrefix.set(records, cache)
    return state
  }
  const state = deriveTargetPromotionState(records, request)
  const cache = cachedByRequest ?? []
  cache.push([request, state])
  promotionStateByPrefix.set(records, cache)
  return state
}
