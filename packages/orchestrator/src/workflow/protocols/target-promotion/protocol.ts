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
  targetPromotionRequestFor,
  type TargetPromotionAttemptReason as TargetPromotionAttemptReasonType,
  type TargetPromotionCompareAndSetResult,
  type TargetPromotionGitReadObservation,
  TargetPromotionJournalEvent,
  type TargetPromotionRequest as TargetPromotionRequestType
} from "./events.js"
import {
  IntegrationCandidateId,
  integrationCandidateCorrelationEquals
} from "../integration-candidate-construction/events.js"
import type { TargetVerificationState } from "../target-verification/protocol.js"
import type { TargetVerificationCandidate } from "../target-verification/events.js"
import {
  deriveTargetPromotionState,
  TargetPromotionPendingRetry,
  TargetPromotionState,
  type JournalOccurrence
} from "./state.js"
import { journalPrefixPredecessorOf } from "../../../workflow-journal/prefix-lineage.js"
export { deriveTargetPromotionState, TargetPromotionPendingRetry, TargetPromotionState } from "./state.js"
export type { JournalOccurrence } from "./state.js"

/** The caller offered a candidate whose target or constructed occurrence differs from Passed evidence. */
export class TargetPromotionPremiseContradiction extends Schema.TaggedError<TargetPromotionPremiseContradiction>()(
  "TargetPromotionPremiseContradiction",
  { candidateId: IntegrationCandidateId, detail: Schema.String }
) {}

/** Promotion requires the terminal Passed verification state and its exact sealed manifest. */
export class TargetPromotionVerificationRequired extends Schema.TaggedError<TargetPromotionVerificationRequired>()(
  "TargetPromotionVerificationRequired",
  { candidateId: IntegrationCandidateId }
) {}

/** A provider returned a successful mutation for a commit other than the requested M. */
export class TargetPromotionResultContradiction extends Schema.TaggedError<TargetPromotionResultContradiction>()(
  "TargetPromotionResultContradiction",
  { candidateCommit: GitCommitSha, detail: Schema.String }
) {}

const ordinalFor = (value: number): TargetPromotionAttemptOrdinal => TargetPromotionAttemptOrdinal.make(value)

const appendPromotionEvent = Effect.fn("TargetPromotion.appendEvent")(function* (
  runId: TargetPromotionRequestType["candidateCorrelation"]["runId"],
  key: Parameters<InRunJournal["Service"]["append"]>[1],
  event: TargetPromotionJournalEvent
) {
  const journal = yield* InRunJournal
  return yield* journal.append(runId, key, event)
})

const targetMatchesRequest = (
  candidate: TargetVerificationCandidate,
  verification: Extract<TargetVerificationState, { readonly _tag: "VerificationPassed" }>
): boolean =>
  candidate.candidateCommit === verification.correlation.candidateCommit &&
  candidate.constructedAt === verification.correlation.candidateConstructedAt &&
  integrationCandidateCorrelationEquals(candidate.correlation, verification.correlation.candidateCorrelation)

const makeRequest = Effect.fn("TargetPromotion.makeRequest")(function* (
  candidate: TargetVerificationCandidate,
  verification: TargetVerificationState
) {
  if (verification._tag !== "VerificationPassed") {
    return yield* new TargetPromotionVerificationRequired({ candidateId: candidate.correlation.candidateId })
  }
  if (!targetMatchesRequest(candidate, verification)) {
    return yield* new TargetPromotionPremiseContradiction({
      candidateId: candidate.correlation.candidateId,
      detail: "candidate construction and sealed verification correlation differ"
    })
  }
  return targetPromotionRequestFor(candidate, {
    correlation: verification.correlation,
    manifest: verification.manifest
  })
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
  request: TargetPromotionRequestType,
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
  request: TargetPromotionRequestType,
  basis: TargetPromotionTerminalBasis,
  observation: TargetPromotionSuccessObservation
) {
  yield* appendPromotionEvent(
    request.candidateCorrelation.runId,
    targetPromotionObservedSuccessRecordKey(request.requestId),
    TargetPromotionObservedSuccessEvent.make({
      basis,
      correlation: request,
      observation,
      version: workflowJournalEventVersion
    })
  )
  return TargetPromotionState.cases.PromotionSucceeded.make({ basis, correlation: request, observation })
})

const appendStale = Effect.fn("TargetPromotion.appendStale")(function* (
  request: TargetPromotionRequestType,
  basis: TargetPromotionTerminalBasis,
  observation: TargetPromotionStaleObservation
) {
  yield* appendPromotionEvent(
    request.candidateCorrelation.runId,
    targetPromotionStaleRecordKey(request.requestId),
    TargetPromotionStaleEvent.make({ basis, correlation: request, observation, version: workflowJournalEventVersion })
  )
  return TargetPromotionState.cases.PromotionStale.make({ basis, correlation: request, observation })
})

const appendNonConvergence = Effect.fn("TargetPromotion.appendNonConvergence")(function* (
  request: TargetPromotionRequestType,
  attemptOrdinal: TargetPromotionAttemptOrdinal,
  lastObservation: TargetPromotionNonConvergenceObservation
) {
  const attemptLimit = TargetPromotionAttemptLimit.make(targetPromotionAttemptLimit)
  yield* appendPromotionEvent(
    request.candidateCorrelation.runId,
    targetPromotionNonConvergenceRecordKey(request.requestId),
    TargetPromotionNonConvergenceEvent.make({
      attemptLimit,
      attemptOrdinal,
      correlation: request,
      lastObservation,
      version: workflowJournalEventVersion
    })
  )
  return TargetPromotionState.cases.PromotionNonConvergent.make({
    attemptLimit,
    attemptOrdinal,
    correlation: request,
    lastObservation
  })
})

const appendAttemptIntent = Effect.fn("TargetPromotion.appendAttemptIntent")(function* (
  request: TargetPromotionRequestType,
  attemptOrdinal: TargetPromotionAttemptOrdinal,
  reason: TargetPromotionAttemptReasonType
) {
  yield* appendPromotionEvent(
    request.candidateCorrelation.runId,
    targetPromotionAttemptIntentRecordKey(request.requestId, attemptOrdinal),
    TargetPromotionAttemptIntendedEvent.make({
      attemptOrdinal,
      correlation: request,
      reason,
      version: workflowJournalEventVersion
    })
  )
})

const pendingAfterAmbiguousAttempt = (
  request: TargetPromotionRequestType,
  attemptOrdinal: TargetPromotionAttemptOrdinal
): TargetPromotionState =>
  TargetPromotionState.cases.PromotionPending.make({
    correlation: request,
    retry: TargetPromotionPendingRetry.cases.NeedReconciliationRead.make({ afterAttemptOrdinal: attemptOrdinal })
  })

/** Records intent for one attempt, then performs at most one compare-and-set. */
const performAttempt = Effect.fn("TargetPromotion.performAttempt")(function* (
  request: TargetPromotionRequestType,
  attemptOrdinal: TargetPromotionAttemptOrdinal,
  reason: TargetPromotionAttemptReasonType
) {
  yield* appendAttemptIntent(request, attemptOrdinal, reason)
  const git = yield* TargetPromotionGit
  const result = yield* git.compareAndSet(request).pipe(Effect.result)
  if (result._tag === "Failure") return pendingAfterAmbiguousAttempt(request, attemptOrdinal)
  if (result.success._tag === "RejectedExpectedHead") {
    if (result.success.observedHeadSha === request.candidateCommit) {
      return yield* appendSuccess(
        request,
        TargetPromotionTerminalBasis.cases.AfterAttempt.make({ attemptOrdinal }),
        TargetPromotionSuccessObservation.cases.ReconciledCandidateCurrent.make({
          candidateAncestry: "Current",
          targetHeadSha: result.success.observedHeadSha
        })
      )
    }
    if (result.success.observedHeadSha === request.expectedTargetHead) {
      return yield* new TargetPromotionResultContradiction({
        candidateCommit: request.candidateCommit,
        detail: "Git rejected the compare-and-set while reporting the exact expected head"
      })
    }
    return yield* appendStale(
      request,
      TargetPromotionTerminalBasis.cases.AfterAttempt.make({ attemptOrdinal }),
      TargetPromotionStaleObservation.cases.CompareAndSetRejected.make({
        observedHeadSha: result.success.observedHeadSha
      })
    )
  }
  if (result.success.newHeadSha !== request.candidateCommit) {
    return yield* new TargetPromotionResultContradiction({
      candidateCommit: request.candidateCommit,
      detail: `Git reported ${result.success.newHeadSha} after requesting ${request.candidateCommit}`
    })
  }
  return yield* appendSuccess(
    request,
    TargetPromotionTerminalBasis.cases.AfterAttempt.make({ attemptOrdinal }),
    successObservationForCompareAndSet(result.success)
  )
})

const runInitialRead = Effect.fn("TargetPromotion.runInitialRead")(function* (request: TargetPromotionRequestType) {
  const git = yield* TargetPromotionGit
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
    return yield* appendSuccess(request, TargetPromotionTerminalBasis.cases.BeforeFirstAttempt.make({}), success)
  if (readResult.success.currentHeadSha !== request.expectedTargetHead)
    return yield* appendStale(
      request,
      TargetPromotionTerminalBasis.cases.BeforeFirstAttempt.make({}),
      TargetPromotionStaleObservation.cases.ReconciledCandidateNotInAncestry.make({
        observedHeadSha: readResult.success.currentHeadSha
      })
    )
  return yield* performAttempt(
    request,
    ordinalFor(1),
    TargetPromotionAttemptReason.cases.Initial.make({ observedHeadSha: readResult.success.currentHeadSha })
  )
})

const runReconciliationRead = Effect.fn("TargetPromotion.runReconciliationRead")(function* (
  request: TargetPromotionRequestType,
  previousAttemptOrdinal: TargetPromotionAttemptOrdinal
) {
  const git = yield* TargetPromotionGit
  const readResult = yield* git.read(request).pipe(Effect.result)
  if (readResult._tag === "Failure")
    return previousAttemptOrdinal === targetPromotionAttemptLimit
      ? yield* appendNonConvergence(
          request,
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
      request,
      TargetPromotionTerminalBasis.cases.AfterAttempt.make({ attemptOrdinal: previousAttemptOrdinal }),
      success
    )
  if (observation._tag === "CandidateNotInAncestry" && observation.currentHeadSha !== request.expectedTargetHead) {
    return yield* appendStale(
      request,
      TargetPromotionTerminalBasis.cases.AfterAttempt.make({ attemptOrdinal: previousAttemptOrdinal }),
      TargetPromotionStaleObservation.cases.ReconciledCandidateNotInAncestry.make({
        observedHeadSha: observation.currentHeadSha
      })
    )
  }
  if (previousAttemptOrdinal === targetPromotionAttemptLimit) {
    return yield* appendNonConvergence(
      request,
      previousAttemptOrdinal,
      TargetPromotionNonConvergenceObservation.cases.ExpectedHeadStillObserved.make({
        observedHeadSha: observation.currentHeadSha
      })
    )
  }

  const nextAttemptOrdinal = ordinalFor(previousAttemptOrdinal + 1)
  return yield* performAttempt(
    request,
    nextAttemptOrdinal,
    TargetPromotionAttemptReason.cases.ReconciledExpectedHead.make({
      observedHeadSha: observation.currentHeadSha,
      previousAttemptOrdinal
    })
  )
})

const runPending = Effect.fn("TargetPromotion.runPending")(function* (
  request: TargetPromotionRequestType,
  state: Extract<TargetPromotionState, { readonly _tag: "PromotionPending" }>
) {
  return state.retry._tag === "NeedInitialReconciliationRead"
    ? yield* runInitialRead(request)
    : yield* runReconciliationRead(request, state.retry.afterAttemptOrdinal)
})

/** Performs at most one compare-and-set and one reconciliation read for one invocation. */
export const runTargetPromotion = Effect.fn("TargetPromotion.run")(function* (
  candidate: TargetVerificationCandidate,
  verification: TargetVerificationState
) {
  const request = yield* makeRequest(candidate, verification)
  const journal = yield* InRunJournal
  const records = yield* journal.read(request.candidateCorrelation.runId)
  const state = deriveTargetPromotionState(records, request)
  if (
    state?._tag === "PromotionSucceeded" ||
    state?._tag === "PromotionStale" ||
    state?._tag === "PromotionNonConvergent"
  ) {
    return state
  }
  if (state === undefined) {
    yield* appendPromotionEvent(
      request.candidateCorrelation.runId,
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

/** Reconstructs state for an exact candidate and verification premise. */
const promotionStateByPrefix = new WeakMap<
  ReadonlyArray<JournalOccurrence>,
  Map<string, TargetPromotionState | undefined>
>()

export const deriveTargetPromotionStateFor = (
  records: ReadonlyArray<JournalOccurrence>,
  candidate: TargetVerificationCandidate,
  verification: Extract<TargetVerificationState, { readonly _tag: "VerificationPassed" }>
): TargetPromotionState | undefined => {
  const request = targetPromotionRequestFor(candidate, {
    correlation: verification.correlation,
    manifest: verification.manifest
  })
  const requestId = request.requestId
  const cachedByRequest = promotionStateByPrefix.get(records)
  if (cachedByRequest?.has(requestId) === true) return cachedByRequest.get(requestId)
  const predecessor = journalPrefixPredecessorOf(records)
  if (predecessor !== undefined && !Schema.is(TargetPromotionJournalEvent)(predecessor.appended.event)) {
    const state = deriveTargetPromotionStateFor(predecessor.prior, candidate, verification)
    const cache = cachedByRequest ?? new Map<string, TargetPromotionState | undefined>()
    cache.set(requestId, state)
    promotionStateByPrefix.set(records, cache)
    return state
  }
  const state = deriveTargetPromotionState(records, request)
  const cache = cachedByRequest ?? new Map<string, TargetPromotionState | undefined>()
  cache.set(requestId, state)
  promotionStateByPrefix.set(records, cache)
  return state
}
