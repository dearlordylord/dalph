import {
  makeTargetPromotionCapabilities,
  type TargetPromotionReadAuthorization,
  type TargetPromotionAttemptAuthorization,
  type TargetPromotionIntendedAttempt,
  type TargetPromotionSettlementClaim
} from "./capabilities.js"
import { appendTargetPromotionSafetyRefusal } from "./safety-observation.js"
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
  type TargetPromotionCorrelation,
  TargetPromotionGit,
  TargetPromotionIntendedEvent,
  TargetPromotionTerminalBasis,
  targetPromotionCandidateCommitOf,
  targetPromotionCorrelationFor,
  targetPromotionGitRequestFor,
  targetPromotionRunIdOf
} from "./events.js"
import { TargetPromotionResultContradiction } from "./errors.js"
import type { TargetPromotionState } from "./state.js"
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
  readAcceptedTargetPromotionEvidence,
  validateTargetPromotionState,
  type CurrentTargetPromotionEvidence
} from "./transition-journal.js"

const {
  availableAttemptAuthorizations,
  availableIntendedAttempts,
  availableObservedAttempts,
  availableReadAuthorizations,
  mintAttemptAuthorization,
  mintIntendedAttempt,
  mintObservedAttempt,
  mintReadAuthorization
} = makeTargetPromotionCapabilities()

const ordinalFor = (value: number): TargetPromotionAttemptOrdinal => TargetPromotionAttemptOrdinal.make(value)

export type {
  TargetPromotionReadAuthorization,
  TargetPromotionAttemptAuthorization,
  TargetPromotionIntendedAttempt,
  TargetPromotionAttemptBoundaryResult,
  TargetPromotionProgress
} from "./capabilities.js"

type PendingState = Extract<TargetPromotionState, { readonly _tag: "PromotionPending" | "PromotionSafetyRefused" }>
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

/** Internal engine seam: every reread obtains current evidence after the preceding append. */
export const makeTargetPromotionTransitions = <E, R>(readEvidence: CurrentTargetPromotionEvidence<E, R>) => {
  const readValidatedTargetPromotionState = Effect.fn("TargetPromotion.readValidatedState")(function* (
    correlation: TargetPromotionCorrelation
  ) {
    return yield* validateTargetPromotionState(yield* readEvidence(targetPromotionRunIdOf(correlation)), correlation)
  })

  /** Appends only the outer promotion intent and returns permission for the later initial read. */
  const recordTargetPromotionIntent = Effect.fn("TargetPromotion.recordIntent")(function* (
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
  const authorizeTargetPromotionProgress = Effect.fn("TargetPromotion.authorizeProgress")(function* (
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
    if (state._tag === "PromotionPending" || state._tag === "PromotionSafetyRefused") {
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
  const authorizeOrRecordTargetPromotionProgress = Effect.fn("TargetPromotion.authorizeOrRecordProgress")(function* (
    candidate: IntegratorRunQualifiedCandidate
  ) {
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
    if (state._tag === "PromotionPending" || state._tag === "PromotionSafetyRefused") {
      const progress = authorizePendingProgress(state, "RetryAuthorized")
      /* v8 ignore next -- @preserve RetryAuthorized always mints a read for either closed PromotionPending retry variant. */
      return progress ?? (yield* Effect.die("retry-authorized pending promotion did not authorize a read"))
    }
    if (state._tag === "PromotionReconciliationDeferred") return authorizeDeferredProgress(state, "RetryAuthorized")
    return state
  })

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
  const observeTargetPromotionRead = Effect.fn("TargetPromotion.observeRead")(function* (
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
    if (readResult._tag === "Success")
      return yield* finishReadDecision(
        authorization,
        decideSuccessfulTargetPromotionRead(authorization, readResult.success)
      )
    const failure = readResult.failure
    if (failure._tag === "TargetPromotionSafetyFailure")
      return yield* appendTargetPromotionSafetyRefusal(
        yield* readEvidence(targetPromotionRunIdOf(authorization.correlation)),
        "ReconciliationRead",
        authorization.correlation,
        authorization.previousAttemptOrdinal,
        failure.refusal
      )
    return yield* finishReadDecision(authorization, decideFailedTargetPromotionRead(authorization, failure))
  })

  /** Appends exactly one numbered compare-and-set intent and does not call Git. */
  const recordTargetPromotionAttemptIntent = Effect.fn("TargetPromotion.recordAttemptIntent")(function* (
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
  const sendTargetPromotionAttempt = Effect.fn("TargetPromotion.sendAttempt")(function* (
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
    if (result._tag === "Failure" && result.failure._tag === "TargetPromotionSafetyFailure")
      return yield* appendTargetPromotionSafetyRefusal(
        yield* readEvidence(targetPromotionRunIdOf(attempt.correlation)),
        "CompareAndSet",
        attempt.correlation,
        attempt.attemptOrdinal,
        result.failure.refusal
      )
    return result._tag === "Failure"
      ? {
          _tag: "TargetPromotionAttemptAmbiguous" as const,
          attemptOrdinal: attempt.attemptOrdinal,
          correlation: attempt.correlation
        }
      : mintObservedAttempt(attempt, result.success)
  })
  /** Appends the terminal interpretation of one already-observed compare-and-set response. */
  const settleTargetPromotionAttempt = Effect.fn("TargetPromotion.settleAttempt")(function* (
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

  return {
    recordTargetPromotionIntent,
    authorizeTargetPromotionProgress,
    authorizeOrRecordTargetPromotionProgress,
    observeTargetPromotionRead,
    recordTargetPromotionAttemptIntent,
    sendTargetPromotionAttempt,
    settleTargetPromotionAttempt
  }
}

export const {
  authorizeTargetPromotionProgress,
  observeTargetPromotionRead,
  recordTargetPromotionAttemptIntent,
  recordTargetPromotionIntent,
  sendTargetPromotionAttempt,
  settleTargetPromotionAttempt
} = makeTargetPromotionTransitions(readAcceptedTargetPromotionEvidence)
