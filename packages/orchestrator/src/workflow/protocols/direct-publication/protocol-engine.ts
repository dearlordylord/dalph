import type { GitCommitSha, RemotePublicationTarget } from "@dalph/contracts"
import { Effect, Schema } from "effect"
import { integrationResponsibilityIdentity } from "../integration-admission/responsibility.js"
import type { IntegratorRunQualifiedCandidate } from "../integrator/events.js"
import {
  RemotePublicationAttemptOrdinal,
  RemotePublicationGit,
  type RemotePublicationObservationFailure,
  RemotePublicationProofBasis,
  RemotePublicationResumeRequest,
  remotePublicationAttemptLimit,
  type RemotePublicationPushFailure,
  RemotePublicationRetainedCause,
  remotePublicationCorrelationFor,
  remotePublicationGitRequestFor
} from "./events.js"
import {
  remotePublicationAttemptsExhausted,
  remotePublicationRetainedCauseIsResumable,
  RemotePublicationState,
  type RemotePublicationState as RemotePublicationStateType
} from "./state.js"
import {
  appendRemotePublicationAttemptIntent,
  appendRemotePublicationAttemptRejection,
  appendRemotePublicationIntent,
  appendRemotePublicationRetained,
  appendRemotePublicationResumeRequest,
  appendRemotePublicationSuccess,
  readAcceptedRemotePublicationEvidence,
  remotePublicationEventsFor,
  validateRemotePublicationState,
  type CurrentRemotePublicationEvidence
} from "./transition-journal.js"
import { RemotePublicationResumeRequestConflict, RemotePublicationResumeSubjectMismatch } from "./errors.js"

/** Post-resume handoff to the existing direct-delivery or same-commit integration owner. */
export type RemotePublicationResumeDispatch =
  | {
      readonly _tag: "ContinueDirectPublication"
      readonly state: Extract<
        RemotePublicationStateType,
        { readonly _tag: "PublicationAbsent" | "PublicationPending" | "PublicationResumeReady" }
      >
    }
  | {
      readonly _tag: "PublicationStatus"
      readonly state: Extract<
        RemotePublicationStateType,
        { readonly _tag: "PublicationContradiction" | "PublicationRetained" | "PublicationSucceeded" }
      >
    }
  | {
      readonly _tag: "ExistingSameCommitRecovery"
      readonly candidate: IntegratorRunQualifiedCandidate
      readonly target: RemotePublicationTarget
      readonly mergeBase: GitCommitSha
      readonly remoteHead: GitCommitSha
    }

/** Route compatibility recovery to its existing owner without creating another recovery engine. */
export const remotePublicationResumeDispatchOf = (
  candidate: IntegratorRunQualifiedCandidate,
  target: RemotePublicationTarget,
  state: RemotePublicationStateType
): RemotePublicationResumeDispatch => {
  if (state._tag === "PublicationRetained" && state.cause._tag === "CompatibleCompetingHead") {
    return {
      _tag: "ExistingSameCommitRecovery",
      candidate,
      target,
      mergeBase: state.cause.mergeBase,
      remoteHead: state.cause.remoteHead
    }
  }
  if (
    state._tag === "PublicationAbsent" ||
    state._tag === "PublicationPending" ||
    state._tag === "PublicationResumeReady"
  ) {
    return { _tag: "ContinueDirectPublication", state }
  }
  return { _tag: "PublicationStatus", state }
}

const lastElementOffset = -1

/** Exit authority around each publication phase that can start new Git work. */
export interface RemotePublicationPhaseBoundary {
  readonly runObservation: <A, E, R>(phase: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  readonly runSender: <A, E, R>(phase: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
}

const retainedCauseForObservationFailure = (failure: RemotePublicationObservationFailure) =>
  RemotePublicationRetainedCause.cases.ObservationUnavailable.make({ reason: failure.reason })

const retainedCauseForPushFailure = (failure: RemotePublicationPushFailure) =>
  failure.reason === "SenderStopUnproven"
    ? RemotePublicationRetainedCause.cases.PushCustodyUnproven.make({})
    : RemotePublicationRetainedCause.cases.PushEndpointMappingChanged.make({})

/** Stateless direct-publication engine; durable history is reread before every effectful boundary. */
export const makeRemotePublicationEngine = <E, R>(readEvidence: CurrentRemotePublicationEvidence<E, R>) => {
  const runRemotePublication = Effect.fn("RemotePublication.run")(function* (
    candidate: IntegratorRunQualifiedCandidate,
    target: RemotePublicationTarget,
    phaseBoundary: RemotePublicationPhaseBoundary
  ) {
    const correlation = remotePublicationCorrelationFor(candidate, target)
    const reconstructed = yield* validateRemotePublicationState(
      yield* readEvidence(candidate.run.session.plannedAttempt.runId),
      correlation
    )
    if (reconstructed._tag === "PublicationSucceeded") return reconstructed
    if (reconstructed._tag === "PublicationRetained") return reconstructed
    const resumeRequestId =
      reconstructed._tag === "PublicationResumeReady"
        ? reconstructed.request.requestId
        : reconstructed._tag === "PublicationPending"
          ? reconstructed.resumeRequestId
          : undefined
    let pendingState: Extract<RemotePublicationStateType, { readonly _tag: "PublicationPending" }> =
      reconstructed._tag === "PublicationAbsent"
        ? yield* appendRemotePublicationIntent(correlation).pipe(
            Effect.as(RemotePublicationState.cases.PublicationPending.make({ attemptOrdinals: [], correlation }))
          )
        : reconstructed._tag === "PublicationResumeReady"
          ? RemotePublicationState.cases.PublicationPending.make({
              attemptOrdinals: reconstructed.attemptOrdinals,
              correlation: reconstructed.correlation,
              resumeRequestId: reconstructed.request.requestId
            })
          : reconstructed
    const git = yield* RemotePublicationGit
    const request = remotePublicationGitRequestFor(correlation)
    const prepareAttemptIntent = Effect.fn("RemotePublication.prepareAttemptIntent")(function* (
      attemptOrdinal: RemotePublicationAttemptOrdinal
    ) {
      const prepared = yield* git
        .prepareSenderCustody(request, attemptOrdinal)
        .pipe(Effect.match({ onFailure: () => false, onSuccess: () => true }))
      if (!prepared) {
        const cause = RemotePublicationRetainedCause.cases.PushCustodyUnproven.make({})
        yield* appendRemotePublicationRetained(correlation, cause, resumeRequestId)
        return RemotePublicationState.cases.PublicationRetained.make({ cause, correlation })
      }
      yield* appendRemotePublicationAttemptIntent(correlation, attemptOrdinal)
    })
    const observationResult = yield* phaseBoundary.runObservation(
      Effect.gen(function* () {
        const pendingOrdinalAtActivation = pendingState.attemptOrdinals.at(lastElementOffset)
        if (pendingOrdinalAtActivation !== undefined) {
          const custody = yield* git
            .reconcileSenderCustody(request, pendingOrdinalAtActivation)
            .pipe(
              Effect.matchEffect({
                onFailure: (failure) => Effect.succeed({ _tag: "Unproven" as const, failure }),
                onSuccess: () => Effect.succeed({ _tag: "Stopped" as const })
              })
            )
          if (custody._tag === "Unproven") {
            const cause = RemotePublicationRetainedCause.cases.PushCustodyUnproven.make({})
            yield* appendRemotePublicationRetained(correlation, cause, resumeRequestId)
            return { _tag: "Retained" as const, cause }
          }
        }
        const observationResult = yield* git.observe(request).pipe(
          Effect.map((observation) => ({ _tag: "Observed" as const, observation })),
          Effect.catchTag("RemotePublicationObservationFailure", (failure) =>
            Effect.succeed({ _tag: "Unavailable" as const, failure })
          )
        )
        if (observationResult._tag === "Unavailable") {
          const cause = retainedCauseForObservationFailure(observationResult.failure)
          yield* appendRemotePublicationRetained(correlation, cause, resumeRequestId)
          return { _tag: "Retained" as const, cause }
        }
        if (
          observationResult.observation._tag === "CandidateCurrent" ||
          observationResult.observation._tag === "CandidateAncestor"
        ) {
          const existingOrdinal = pendingState.attemptOrdinals.at(lastElementOffset)
          const attemptOrdinal =
            existingOrdinal === undefined
              ? RemotePublicationAttemptOrdinal.make(pendingState.attemptOrdinals.length + 1)
              : existingOrdinal
          if (existingOrdinal === undefined) {
            const preparation = yield* prepareAttemptIntent(attemptOrdinal)
            if (preparation !== undefined) return { _tag: "SucceededOrRetained" as const, state: preparation }
          }
          const proof =
            observationResult.observation._tag === "CandidateCurrent"
              ? RemotePublicationProofBasis.cases.ReconciledCandidateCurrent.make({
                  attemptOrdinal,
                  remoteHead: observationResult.observation.remoteHead
                })
              : RemotePublicationProofBasis.cases.ReconciledCandidateAncestor.make({
                  attemptOrdinal,
                  remoteHead: observationResult.observation.remoteHead
                })
          yield* appendRemotePublicationSuccess(correlation, proof)
          return {
            _tag: "SucceededOrRetained" as const,
            state: RemotePublicationState.cases.PublicationSucceeded.make({ correlation, proof })
          }
        }
        return observationResult
      })
    )
    if (observationResult._tag === "SucceededOrRetained") return observationResult.state
    if (observationResult._tag === "Retained") {
      return RemotePublicationState.cases.PublicationRetained.make({ cause: observationResult.cause, correlation })
    }
    const { observation } = observationResult
    return yield* phaseBoundary.runSender(
      Effect.gen(function* () {
        const retainedCause =
          observation._tag === "CompatibleCompetingHead"
            ? RemotePublicationRetainedCause.cases.CompatibleCompetingHead.make({
                mergeBase: observation.mergeBase,
                remoteHead: observation.remoteHead
              })
            : observation._tag === "IncompatibleLineage"
              ? RemotePublicationRetainedCause.cases.IncompatibleLineage.make({ remoteHead: observation.remoteHead })
              : observation._tag === "TargetMissing"
                ? RemotePublicationRetainedCause.cases.TargetMissing.make({})
                : undefined
        if (retainedCause !== undefined) {
          yield* appendRemotePublicationRetained(correlation, retainedCause, resumeRequestId)
          return RemotePublicationState.cases.PublicationRetained.make({ cause: retainedCause, correlation })
        }
        if (remotePublicationAttemptsExhausted(pendingState)) {
          const cause = RemotePublicationRetainedCause.cases.AttemptsExhausted.make({})
          yield* appendRemotePublicationRetained(correlation, cause, resumeRequestId)
          return RemotePublicationState.cases.PublicationRetained.make({ cause, correlation })
        }
        const attemptOrdinal = RemotePublicationAttemptOrdinal.make(pendingState.attemptOrdinals.length + 1)
        const preparation = yield* prepareAttemptIntent(attemptOrdinal)
        if (preparation !== undefined) return preparation
        const pushResult = yield* git.push(request, attemptOrdinal).pipe(
          Effect.map((result) => ({ _tag: "Result" as const, result })),
          Effect.catchTag("RemotePublicationPushFailure", (failure) =>
            Effect.succeed({ _tag: "Failure" as const, failure })
          )
        )
        if (pushResult._tag === "Failure") {
          pendingState = RemotePublicationState.cases.PublicationPending.make({
            attemptOrdinals: [...pendingState.attemptOrdinals, attemptOrdinal],
            correlation,
            ...(resumeRequestId === undefined ? {} : { resumeRequestId })
          })
          if (pushResult.failure.reason === "ResponseDeadline" || pushResult.failure.reason === "TransportUnavailable")
            return pendingState
          const cause = retainedCauseForPushFailure(pushResult.failure)
          yield* appendRemotePublicationRetained(correlation, cause, resumeRequestId)
          return RemotePublicationState.cases.PublicationRetained.make({ cause, correlation })
        }
        const { result } = pushResult
        if (result._tag === "Applied" || result._tag === "UpToDate") {
          const proof =
            result._tag === "Applied"
              ? RemotePublicationProofBasis.cases.PushApplied.make({ attemptOrdinal, remoteHead: result.remoteHead })
              : RemotePublicationProofBasis.cases.PushUpToDate.make({ attemptOrdinal, remoteHead: result.remoteHead })
          yield* appendRemotePublicationSuccess(correlation, proof)
          return RemotePublicationState.cases.PublicationSucceeded.make({ correlation, proof })
        }
        if (result._tag === "RejectedNonFastForward") {
          yield* appendRemotePublicationAttemptRejection(correlation, attemptOrdinal)
          pendingState = RemotePublicationState.cases.PublicationPending.make({
            attemptOrdinals: [...pendingState.attemptOrdinals, attemptOrdinal],
            correlation,
            ...(resumeRequestId === undefined ? {} : { resumeRequestId })
          })
          return pendingState
        }
        const cause =
          result._tag === "Throttled"
            ? RemotePublicationRetainedCause.cases.Throttled.make({})
            : result.cause === "Authentication"
              ? RemotePublicationRetainedCause.cases.AuthenticationDenied.make({})
              : result.cause === "Policy"
                ? RemotePublicationRetainedCause.cases.PolicyDenied.make({})
                : RemotePublicationRetainedCause.cases.RemoteDenied.make({})
        yield* appendRemotePublicationRetained(correlation, cause, resumeRequestId)
        return RemotePublicationState.cases.PublicationRetained.make({ cause, correlation })
      })
    )
  })

  const resumeRemotePublication = Effect.fn("RemotePublication.resumeRetained")(function* (
    candidate: IntegratorRunQualifiedCandidate,
    target: RemotePublicationTarget,
    unknownRequest: unknown,
    phaseBoundary: RemotePublicationPhaseBoundary
  ) {
    const request = yield* Schema.decodeUnknownEffect(RemotePublicationResumeRequest, { onExcessProperty: "error" })(
      unknownRequest
    )
    const expectedRunId = candidate.run.session.plannedAttempt.runId
    const expectedResponsibility = integrationResponsibilityIdentity({
      plannedAttempt: candidate.run.session.plannedAttempt,
      queuedAt: candidate.run.session.queuedAt
    })
    if (
      request.runId !== expectedRunId ||
      request.responsibility.runId !== expectedResponsibility.runId ||
      request.responsibility.queuedAt !== expectedResponsibility.queuedAt
    ) {
      return yield* new RemotePublicationResumeSubjectMismatch({ requestId: request.requestId, runId: expectedRunId })
    }

    const correlation = remotePublicationCorrelationFor(candidate, target)
    const source = yield* readEvidence(expectedRunId)
    const state = yield* validateRemotePublicationState(source, correlation)
    const events = remotePublicationEventsFor(source, correlation)
    const recordedRequest = events.find(
      (event) => event._tag === "RemotePublicationResumeRequested" && event.request.requestId === request.requestId
    )
    if (recordedRequest?._tag === "RemotePublicationResumeRequested") {
      const sameRequest = Schema.toEquivalence(RemotePublicationResumeRequest)(recordedRequest.request, request)
      if (!sameRequest) return yield* new RemotePublicationResumeRequestConflict({ requestId: request.requestId })
      if (state._tag === "PublicationResumeReady" && state.request.requestId === request.requestId) {
        return yield* runRemotePublication(candidate, target, phaseBoundary)
      }
      const latestEvent = events.at(events.length - 1)
      if (
        state._tag === "PublicationPending" &&
        state.resumeRequestId === request.requestId &&
        latestEvent?._tag === "RemotePublicationAttemptIntended" &&
        latestEvent.attemptOrdinal === state.attemptOrdinals.at(state.attemptOrdinals.length - 1)
      ) {
        // An acknowledged attempt intent without an outcome is still ambiguous. Re-enter the ordinary
        // owner so it proves sender custody and reads the pinned head before it can issue another push.
        return yield* runRemotePublication(candidate, target, phaseBoundary)
      }
      return state
    }
    if (state._tag !== "PublicationRetained") return state
    const priorAttemptCount = events.filter((event) => event._tag === "RemotePublicationAttemptIntended").length
    if (!remotePublicationRetainedCauseIsResumable(state.cause) || priorAttemptCount >= remotePublicationAttemptLimit)
      return state

    yield* appendRemotePublicationResumeRequest(correlation, request)
    return yield* runRemotePublication(candidate, target, phaseBoundary)
  })
  return { runRemotePublication, resumeRemotePublication }
}

const RemotePublicationEngine = makeRemotePublicationEngine(readAcceptedRemotePublicationEvidence)
export const runRemotePublication = RemotePublicationEngine.runRemotePublication
export const resumeRemotePublication = RemotePublicationEngine.resumeRemotePublication
