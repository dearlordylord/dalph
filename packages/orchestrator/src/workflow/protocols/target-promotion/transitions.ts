import { Effect } from "effect"
import {
  targetPromotionAttemptIntentRecordKey,
  targetPromotionIntentRecordKey
} from "../../../workflow-journal/record-key.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import type { IntegratorRunQualifiedCandidate } from "../integrator/events.js"
import {
  TargetPromotionAttemptIntendedEvent,
  TargetPromotionAttemptOrdinal,
  TargetPromotionAttemptReason,
  type TargetPromotionCompareAndSetResult,
  type TargetPromotionCorrelation,
  TargetPromotionGit,
  TargetPromotionIntendedEvent,
  TargetPromotionTerminalBasis,
  targetPromotionCandidateCommitOf,
  targetPromotionCorrelationFor,
  targetPromotionGitRequestFor
} from "./events.js"
import { TargetPromotionResultContradiction } from "./errors.js"
import { TargetPromotionPendingRetry, TargetPromotionState } from "./state.js"
import {
  decideFailedTargetPromotionRead,
  decideSuccessfulTargetPromotionRead,
  decideTargetPromotionSettlement,
  targetPromotionAttemptBasisMatches,
  targetPromotionReadBasisMatches,
  type TargetPromotionReadDecision
} from "./transition-decisions.js"
import {
  appendTargetPromotionEvent,
  appendTargetPromotionNonConvergence,
  appendTargetPromotionReconciliationDeferral,
  appendTargetPromotionStale,
  appendTargetPromotionSuccess,
  readValidatedTargetPromotionState
} from "./transition-journal.js"

const ordinalFor = (value: number): TargetPromotionAttemptOrdinal => TargetPromotionAttemptOrdinal.make(value)

const readAuthorizationBrand: unique symbol = Symbol("TargetPromotionReadAuthorization")
const attemptAuthorizationBrand: unique symbol = Symbol("TargetPromotionAttemptAuthorization")
const intendedAttemptBrand: unique symbol = Symbol("TargetPromotionIntendedAttempt")
const observedAttemptBrand: unique symbol = Symbol("TargetPromotionObservedAttempt")

const availableReadAuthorizations = new WeakSet<object>()
const availableAttemptAuthorizations = new WeakSet<object>()
const availableIntendedAttempts = new WeakSet<object>()
const availableObservedAttempts = new WeakSet<object>()

/** Process-local permission to perform exactly one promotion read; it is never durable authority. */
export type TargetPromotionReadAuthorization = {
  readonly _tag: "TargetPromotionReadAuthorized"
  readonly [readAuthorizationBrand]: true
  readonly authority: "ReadOnly" | "RetryAuthorized"
  readonly correlation: TargetPromotionCorrelation
  readonly durableBasis: "DeferredTargetReadFailed" | "PendingAttempt" | "PendingInitial"
  readonly previousAttemptOrdinal: TargetPromotionAttemptOrdinal | undefined
}

/** Process-local proof that one exact-head read authorizes one numbered attempt intent. */
export type TargetPromotionAttemptAuthorization = {
  readonly _tag: "TargetPromotionAttemptAuthorized"
  readonly [attemptAuthorizationBrand]: true
  readonly attemptOrdinal: TargetPromotionAttemptOrdinal
  readonly correlation: TargetPromotionCorrelation
  readonly durableBasis: "DeferredRetryAuthority" | "DeferredTargetReadFailed" | "PendingAttempt" | "PendingInitial"
  readonly reason: TargetPromotionAttemptReason
}

/** Process-local proof that the exact numbered attempt intent was appended before Git is called. */
export type TargetPromotionIntendedAttempt = {
  readonly _tag: "TargetPromotionAttemptIntended"
  readonly [intendedAttemptBrand]: true
  readonly attemptOrdinal: TargetPromotionAttemptOrdinal
  readonly correlation: TargetPromotionCorrelation
  readonly reason: TargetPromotionAttemptReason
}

/** An untrusted structural settlement claim; only a registered Git response can settle it. */
type TargetPromotionSettlementClaim = {
  readonly _tag: "TargetPromotionAttemptObserved"
  readonly attemptOrdinal: TargetPromotionAttemptOrdinal
  readonly correlation: TargetPromotionCorrelation
  readonly result: TargetPromotionCompareAndSetResult
}

/** Process-local proof minted only from the response to one exact Git compare-and-set. */
type TargetPromotionObservedAttempt = TargetPromotionSettlementClaim & { readonly [observedAttemptBrand]: true }

/** The one Git compare-and-set has no trustworthy response and must be reconciled by a read. */
type TargetPromotionAmbiguousAttempt = {
  readonly _tag: "TargetPromotionAttemptAmbiguous"
  readonly attemptOrdinal: TargetPromotionAttemptOrdinal
  readonly correlation: TargetPromotionCorrelation
}

export type TargetPromotionAttemptBoundaryResult = TargetPromotionObservedAttempt | TargetPromotionAmbiguousAttempt

export type TargetPromotionProgress =
  | TargetPromotionState
  | TargetPromotionReadAuthorization
  | TargetPromotionAttemptAuthorization

const mintReadAuthorization = (
  correlation: TargetPromotionCorrelation,
  previousAttemptOrdinal: TargetPromotionAttemptOrdinal | undefined,
  authority: "ReadOnly" | "RetryAuthorized",
  durableBasis: TargetPromotionReadAuthorization["durableBasis"]
): TargetPromotionReadAuthorization => {
  const authorization = Object.freeze({
    _tag: "TargetPromotionReadAuthorized" as const,
    [readAuthorizationBrand]: true as const,
    authority,
    correlation,
    durableBasis,
    previousAttemptOrdinal
  })
  availableReadAuthorizations.add(authorization)
  return authorization
}

const mintAttemptAuthorization = (
  correlation: TargetPromotionCorrelation,
  attemptOrdinal: TargetPromotionAttemptOrdinal,
  reason: TargetPromotionAttemptReason,
  durableBasis: TargetPromotionAttemptAuthorization["durableBasis"]
): TargetPromotionAttemptAuthorization => {
  const authorization = Object.freeze({
    _tag: "TargetPromotionAttemptAuthorized" as const,
    [attemptAuthorizationBrand]: true as const,
    attemptOrdinal,
    correlation,
    durableBasis,
    reason
  })
  availableAttemptAuthorizations.add(authorization)
  return authorization
}

const mintIntendedAttempt = (authorization: TargetPromotionAttemptAuthorization): TargetPromotionIntendedAttempt => {
  const intended = Object.freeze({
    _tag: "TargetPromotionAttemptIntended" as const,
    [intendedAttemptBrand]: true as const,
    attemptOrdinal: authorization.attemptOrdinal,
    correlation: authorization.correlation,
    reason: authorization.reason
  })
  availableIntendedAttempts.add(intended)
  return intended
}

const mintObservedAttempt = (
  intended: TargetPromotionIntendedAttempt,
  result: TargetPromotionCompareAndSetResult
): TargetPromotionObservedAttempt => {
  const observed = Object.freeze({
    _tag: "TargetPromotionAttemptObserved" as const,
    [observedAttemptBrand]: true as const,
    attemptOrdinal: intended.attemptOrdinal,
    correlation: intended.correlation,
    result
  })
  availableObservedAttempts.add(observed)
  return observed
}

type PendingState = Extract<TargetPromotionState, { readonly _tag: "PromotionPending" }>
type DeferredState = Extract<TargetPromotionState, { readonly _tag: "PromotionReconciliationDeferred" }>

const authorizePendingProgress = (
  state: PendingState,
  authority: "ReadOnly" | "RetryAuthorized"
): TargetPromotionReadAuthorization | undefined => {
  if (state.retry._tag === "NeedInitialReconciliationRead") {
    return authority === "ReadOnly"
      ? undefined
      : mintReadAuthorization(state.correlation, undefined, authority, "PendingInitial")
  }
  return mintReadAuthorization(state.correlation, state.retry.afterAttemptOrdinal, authority, "PendingAttempt")
}

const authorizeDeferredProgress = (
  state: DeferredState,
  authority: "ReadOnly" | "RetryAuthorized"
): DeferredState | TargetPromotionReadAuthorization | TargetPromotionAttemptAuthorization => {
  if (authority === "ReadOnly") return state
  if (state.deferral._tag === "TargetReadFailed") {
    return mintReadAuthorization(state.correlation, state.afterAttemptOrdinal, authority, "DeferredTargetReadFailed")
  }
  return mintAttemptAuthorization(
    state.correlation,
    ordinalFor(state.afterAttemptOrdinal + 1),
    TargetPromotionAttemptReason.cases.ReconciledExpectedHead.make({
      observedHeadSha: state.deferral.observedHeadSha,
      previousAttemptOrdinal: state.afterAttemptOrdinal
    }),
    "DeferredRetryAuthority"
  )
}

/** Appends only the outer promotion intent and returns permission for the later initial read. */
export const recordTargetPromotionIntent = Effect.fn("TargetPromotion.recordIntent")(function* (
  candidate: IntegratorRunQualifiedCandidate
) {
  const correlation = targetPromotionCorrelationFor(candidate)
  const state = yield* readValidatedTargetPromotionState(correlation)
  if (state !== undefined) {
    return yield* new TargetPromotionResultContradiction({
      candidateCommit: candidate.candidateCommit,
      detail: "target promotion intent requires an absent exact promotion state"
    })
  }
  yield* appendTargetPromotionEvent(
    correlation,
    targetPromotionIntentRecordKey(correlation.requestId),
    TargetPromotionIntendedEvent.make({ correlation, version: workflowJournalEventVersion })
  )
  return mintReadAuthorization(correlation, undefined, "RetryAuthorized", "PendingInitial")
})

/** Selects the next read or retry without reading Git, appending an event, or requesting a mutation. */
export const authorizeTargetPromotionProgress = Effect.fn("TargetPromotion.authorizeProgress")(function* (
  candidate: IntegratorRunQualifiedCandidate,
  authority: "ReadOnly" | "RetryAuthorized"
) {
  const correlation = targetPromotionCorrelationFor(candidate)
  const state = yield* readValidatedTargetPromotionState(correlation)
  if (state === undefined) {
    return yield* new TargetPromotionResultContradiction({
      candidateCommit: candidate.candidateCommit,
      detail: "target promotion progress requires a durable promotion intent"
    })
  }
  if (state._tag === "PromotionPending") {
    const progress = authorizePendingProgress(state, authority)
    if (progress !== undefined) return progress
    return yield* new TargetPromotionResultContradiction({
      candidateCommit: candidate.candidateCommit,
      detail: "read-only reconciliation requires one exact unmatched compare-and-set intent"
    })
  }
  if (state._tag === "PromotionReconciliationDeferred") {
    return authorizeDeferredProgress(state, authority)
  }
  return state
})

/** Starts a new promotion or selects the next step for an existing exact correlation. */
export const authorizeOrRecordTargetPromotionProgress = Effect.fn("TargetPromotion.authorizeOrRecordProgress")(
  function* (candidate: IntegratorRunQualifiedCandidate) {
    const correlation = targetPromotionCorrelationFor(candidate)
    const state = yield* readValidatedTargetPromotionState(correlation)
    if (state === undefined) {
      yield* appendTargetPromotionEvent(
        correlation,
        targetPromotionIntentRecordKey(correlation.requestId),
        TargetPromotionIntendedEvent.make({ correlation, version: workflowJournalEventVersion })
      )
      return mintReadAuthorization(correlation, undefined, "RetryAuthorized", "PendingInitial")
    }
    if (state._tag === "PromotionPending") {
      const progress = authorizePendingProgress(state, "RetryAuthorized")
      /* v8 ignore next -- @preserve RetryAuthorized always mints a read for either closed PromotionPending retry variant. */
      return progress ?? (yield* Effect.die("retry-authorized pending promotion did not authorize a read"))
    }
    if (state._tag === "PromotionReconciliationDeferred") return authorizeDeferredProgress(state, "RetryAuthorized")
    return state
  }
)

const finishReadDecision = Effect.fn("TargetPromotion.finishReadDecision")(function* (
  authorization: TargetPromotionReadAuthorization,
  decision: TargetPromotionReadDecision
) {
  switch (decision._tag) {
    case "AttemptAuthorized":
      return mintAttemptAuthorization(
        authorization.correlation,
        decision.attemptOrdinal,
        decision.reason,
        decision.durableBasis
      )
    case "NonConvergent":
      return yield* appendTargetPromotionNonConvergence(
        authorization.correlation,
        decision.attemptOrdinal,
        decision.observation
      )
    case "PropagateFailure":
      return yield* decision.failure
    case "ReconciliationDeferred":
      return yield* appendTargetPromotionReconciliationDeferral(
        authorization.correlation,
        decision.afterAttemptOrdinal,
        decision.deferral
      )
    case "ResultContradiction":
      return yield* new TargetPromotionResultContradiction({
        candidateCommit: targetPromotionCandidateCommitOf(authorization.correlation),
        detail: decision.detail
      })
    case "Stale":
      return yield* appendTargetPromotionStale(authorization.correlation, decision.basis, decision.observation)
    case "Succeeded":
      return yield* appendTargetPromotionSuccess(authorization.correlation, decision.basis, decision.observation)
  }
})

/** Performs exactly the one Git read represented by a process-local authorization. */
export const observeTargetPromotionRead = Effect.fn("TargetPromotion.observeRead")(function* (
  authorization: TargetPromotionReadAuthorization
) {
  const state = yield* readValidatedTargetPromotionState(authorization.correlation)
  if (!targetPromotionReadBasisMatches(authorization, state)) {
    return yield* new TargetPromotionResultContradiction({
      candidateCommit: targetPromotionCandidateCommitOf(authorization.correlation),
      detail: "promotion read authorization no longer matches the exact durable state"
    })
  }

  const git = yield* TargetPromotionGit
  const request = targetPromotionGitRequestFor(authorization.correlation)
  if (!availableReadAuthorizations.delete(authorization)) {
    return yield* new TargetPromotionResultContradiction({
      candidateCommit: request.candidateCommit,
      detail: "promotion read permission was already consumed or did not originate in this process"
    })
  }
  const readResult = yield* git.read(request).pipe(Effect.result)
  const decision =
    readResult._tag === "Failure"
      ? decideFailedTargetPromotionRead(authorization, readResult.failure)
      : decideSuccessfulTargetPromotionRead(authorization, readResult.success)
  return yield* finishReadDecision(authorization, decision)
})

/** Appends exactly one numbered compare-and-set intent and does not call Git. */
export const recordTargetPromotionAttemptIntent = Effect.fn("TargetPromotion.recordAttemptIntent")(function* (
  authorization: TargetPromotionAttemptAuthorization
) {
  const state = yield* readValidatedTargetPromotionState(authorization.correlation)
  if (!targetPromotionAttemptBasisMatches(authorization, state)) {
    return yield* new TargetPromotionResultContradiction({
      candidateCommit: targetPromotionCandidateCommitOf(authorization.correlation),
      detail: "promotion attempt authorization no longer matches the exact durable state"
    })
  }
  const key = targetPromotionAttemptIntentRecordKey(authorization.correlation.requestId, authorization.attemptOrdinal)
  const event = TargetPromotionAttemptIntendedEvent.make({
    attemptOrdinal: authorization.attemptOrdinal,
    correlation: authorization.correlation,
    reason: authorization.reason,
    version: workflowJournalEventVersion
  })
  if (!availableAttemptAuthorizations.delete(authorization)) {
    return yield* new TargetPromotionResultContradiction({
      candidateCommit: targetPromotionCandidateCommitOf(authorization.correlation),
      detail: "promotion attempt-intent permission was already consumed or did not originate in this process"
    })
  }
  yield* appendTargetPromotionEvent(authorization.correlation, key, event)
  return mintIntendedAttempt(authorization)
})

const pendingAttemptOrdinalMatches = (
  state: TargetPromotionState | undefined,
  attemptOrdinal: TargetPromotionAttemptOrdinal
): boolean =>
  state?._tag === "PromotionPending" &&
  state.retry._tag === "NeedReconciliationRead" &&
  state.retry.afterAttemptOrdinal === attemptOrdinal

/** Calls Git exactly once for an already-journaled attempt and does not append a result. */
export const sendTargetPromotionAttempt = Effect.fn("TargetPromotion.sendAttempt")(function* (
  attempt: TargetPromotionIntendedAttempt
) {
  const state = yield* readValidatedTargetPromotionState(attempt.correlation)
  if (!pendingAttemptOrdinalMatches(state, attempt.attemptOrdinal)) {
    return yield* new TargetPromotionResultContradiction({
      candidateCommit: targetPromotionCandidateCommitOf(attempt.correlation),
      detail: "promotion attempt intent no longer matches the exact durable state"
    })
  }
  const git = yield* TargetPromotionGit
  const request = targetPromotionGitRequestFor(attempt.correlation)
  if (!availableIntendedAttempts.delete(attempt)) {
    return yield* new TargetPromotionResultContradiction({
      candidateCommit: targetPromotionCandidateCommitOf(attempt.correlation),
      detail: "promotion attempt permission was already consumed or did not originate in this process"
    })
  }
  const result = yield* git.compareAndSet(request).pipe(Effect.result)
  return result._tag === "Failure"
    ? {
        _tag: "TargetPromotionAttemptAmbiguous" as const,
        attemptOrdinal: attempt.attemptOrdinal,
        correlation: attempt.correlation
      }
    : mintObservedAttempt(attempt, result.success)
})

/** Appends the terminal interpretation of one already-observed compare-and-set response. */
export const settleTargetPromotionAttempt = Effect.fn("TargetPromotion.settleAttempt")(function* (
  attempt: TargetPromotionSettlementClaim
) {
  const state = yield* readValidatedTargetPromotionState(attempt.correlation)
  if (!pendingAttemptOrdinalMatches(state, attempt.attemptOrdinal)) {
    return yield* new TargetPromotionResultContradiction({
      candidateCommit: targetPromotionCandidateCommitOf(attempt.correlation),
      detail: "observed promotion attempt no longer matches the exact durable state"
    })
  }
  const basis = TargetPromotionTerminalBasis.cases.AfterAttempt.make({ attemptOrdinal: attempt.attemptOrdinal })
  const decision = decideTargetPromotionSettlement(attempt.correlation, attempt.result)
  if (!availableObservedAttempts.delete(attempt)) {
    return yield* new TargetPromotionResultContradiction({
      candidateCommit: targetPromotionCandidateCommitOf(attempt.correlation),
      detail: "promotion result proof was already consumed or did not originate from the Git boundary"
    })
  }
  switch (decision._tag) {
    case "ResultContradiction":
      return yield* new TargetPromotionResultContradiction({
        candidateCommit: targetPromotionCandidateCommitOf(attempt.correlation),
        detail: decision.detail
      })
    case "Stale":
      return yield* appendTargetPromotionStale(attempt.correlation, basis, decision.observation)
    case "Succeeded":
      return yield* appendTargetPromotionSuccess(attempt.correlation, basis, decision.observation)
  }
})

export const pendingTargetPromotionAfter = (
  attempt: TargetPromotionAmbiguousAttempt | TargetPromotionIntendedAttempt
): TargetPromotionState =>
  TargetPromotionState.cases.PromotionPending.make({
    correlation: attempt.correlation,
    retry: TargetPromotionPendingRetry.cases.NeedReconciliationRead.make({
      afterAttemptOrdinal: attempt.attemptOrdinal
    })
  })
