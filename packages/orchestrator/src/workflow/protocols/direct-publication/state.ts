import { Schema } from "effect"
import {
  RemotePublicationAttemptLimit,
  RemotePublicationAttemptOrdinal,
  RemotePublicationAttemptAuthorization,
  RemotePublicationCorrelation,
  type RemotePublicationJournalEvent,
  RemotePublicationProofBasis,
  RemotePublicationRetainedCause,
  RemotePublicationResumeRequest,
  remotePublicationAttemptLimit,
  remotePublicationCorrelationEquals,
  remotePublicationRefspecFor
} from "./events.js"

export const RemotePublicationState = Schema.TaggedUnion({
  PublicationAbsent: {},
  PublicationContradiction: { detail: Schema.String },
  PublicationPending: {
    authorization: RemotePublicationAttemptAuthorization,
    attemptOrdinals: Schema.Array(RemotePublicationAttemptOrdinal),
    correlation: RemotePublicationCorrelation
  },
  PublicationResumeReady: {
    attemptOrdinals: Schema.Array(RemotePublicationAttemptOrdinal),
    correlation: RemotePublicationCorrelation,
    request: RemotePublicationResumeRequest
  },
  PublicationSucceeded: { correlation: RemotePublicationCorrelation, proof: RemotePublicationProofBasis },
  PublicationRetained: { cause: RemotePublicationRetainedCause, correlation: RemotePublicationCorrelation }
})
export type RemotePublicationState = typeof RemotePublicationState.Type

const attemptOrdinalOfProof = (proof: RemotePublicationProofBasis): RemotePublicationAttemptOrdinal =>
  proof.attemptOrdinal

const contiguousAttemptsIssue = (attempts: ReadonlyArray<RemotePublicationAttemptOrdinal>): string | undefined => {
  if (attempts.length > remotePublicationAttemptLimit) return "publication history exceeds the accepted attempt limit"
  for (const [index, ordinal] of attempts.entries()) {
    if (Number(ordinal) !== index + 1) return "publication attempt ordinals must begin at one and remain contiguous"
  }
  return undefined
}

export const remotePublicationRetainedCauseIsResumable = (cause: RemotePublicationRetainedCause): boolean =>
  cause._tag === "AuthenticationDenied" ||
  cause._tag === "ObservationUnavailable" ||
  cause._tag === "PolicyDenied" ||
  cause._tag === "PushCustodyUnproven" ||
  cause._tag === "PushEndpointMappingChanged" ||
  cause._tag === "RemoteDenied" ||
  cause._tag === "TargetMissing"

type ReductionPhase =
  | { readonly _tag: "Pending"; readonly authorization: RemotePublicationAttemptAuthorization }
  | {
      readonly _tag: "ResumeReady"
      readonly cause: RemotePublicationRetainedCause
      readonly request: RemotePublicationResumeRequest
    }
  | { readonly _tag: "Retained"; readonly cause: RemotePublicationRetainedCause }
  | { readonly _tag: "Succeeded"; readonly proof: RemotePublicationProofBasis }

const contradiction = (detail: string): RemotePublicationState =>
  RemotePublicationState.cases.PublicationContradiction.make({ detail })

/** Reduces one request's durable events without inferring a result from process loss or a missing record. */
export const deriveRemotePublicationState = (
  events: ReadonlyArray<RemotePublicationJournalEvent>
): RemotePublicationState => {
  if (events.length === 0) return RemotePublicationState.cases.PublicationAbsent.make({})
  const intent = events[0]
  if (intent?._tag !== "RemotePublicationIntended") {
    return contradiction("publication history must begin with the outer intent")
  }
  if (events.filter(({ _tag }) => _tag === "RemotePublicationIntended").length !== 1) {
    return contradiction("publication history has more than one outer intent")
  }
  if (
    events.some(
      (event) => "correlation" in event && !remotePublicationCorrelationEquals(event.correlation, intent.correlation)
    )
  ) {
    return contradiction("publication history mixes distinct request correlations")
  }

  const attempts = events.flatMap((event) =>
    event._tag === "RemotePublicationAttemptIntended" ? [event.attemptOrdinal] : []
  )
  if (
    events.some(
      (event) =>
        event._tag === "RemotePublicationAttemptIntended" &&
        event.refspec !==
          remotePublicationRefspecFor(
            event.correlation.qualifiedCandidate.candidateCommit,
            event.correlation.target.branch
          )
    )
  ) {
    return contradiction("publication attempt intent refspec must derive from the exact candidate and pinned branch")
  }
  const attemptIssue = contiguousAttemptsIssue(attempts)
  if (attemptIssue !== undefined) return contradiction(attemptIssue)

  const rejectedOrdinals = new Set(
    events.flatMap((event) =>
      event._tag === "RemotePublicationAttemptRejectedNonFastForward" ? [event.attemptOrdinal] : []
    )
  )
  const successes = events.filter(
    (event): event is Extract<RemotePublicationJournalEvent, { readonly _tag: "RemotePublicationSucceeded" }> =>
      event._tag === "RemotePublicationSucceeded"
  )
  if (successes.length > 1) return contradiction("publication history has more than one terminal proof")

  const seenResumeRequestIds = new Set<string>()
  let phase: ReductionPhase = {
    _tag: "Pending",
    authorization: RemotePublicationAttemptAuthorization.cases.InitialAttempt.make({})
  }
  for (const [index, event] of events.entries()) {
    if (index === 0) continue
    if (phase._tag === "Succeeded") {
      return contradiction("publication history contains an event after terminal proof")
    }
    if (event._tag === "RemotePublicationIntended") {
      return contradiction("publication history has more than one outer intent")
    }
    if (event._tag === "RemotePublicationAttemptIntended") {
      if (phase._tag !== "Pending" && phase._tag !== "ResumeReady") {
        return contradiction("publication attempt after retained outcome requires a new exact resume receipt")
      }
      const authorization: RemotePublicationAttemptAuthorization =
        phase._tag === "ResumeReady"
          ? RemotePublicationAttemptAuthorization.cases.ResumeRequest.make({ requestId: phase.request.requestId })
          : phase.authorization
      phase = { _tag: "Pending", authorization }
      continue
    }
    if (event._tag === "RemotePublicationAttemptRejectedNonFastForward") {
      const previous = events[index - 1]
      if (
        previous?._tag !== "RemotePublicationAttemptIntended" ||
        previous.attemptOrdinal !== event.attemptOrdinal ||
        events
          .slice(0, index)
          .some((prior) => prior._tag === event._tag && prior.attemptOrdinal === event.attemptOrdinal)
      ) {
        return contradiction("publication rejection requires its exact unmatched preceding attempt intent")
      }
      if (phase._tag !== "Pending") return contradiction("publication rejection has no active attempt")
      continue
    }
    if (event._tag === "RemotePublicationRetained") {
      if (phase._tag !== "Pending") return contradiction("publication retained outcome has no active delivery phase")
      if (
        event.authorization._tag !== phase.authorization._tag ||
        (event.authorization._tag === "ResumeRequest" &&
          (phase.authorization._tag !== "ResumeRequest" ||
            event.authorization.requestId !== phase.authorization.requestId))
      ) {
        return contradiction("publication retained outcome must identify its exact active authorization")
      }
      if (event.cause._tag === "AttemptsExhausted" && attempts.length !== remotePublicationAttemptLimit) {
        return contradiction("publication exhaustion requires the exact accepted attempt limit")
      }
      phase = { _tag: "Retained", cause: event.cause }
      continue
    }
    if (event._tag === "RemotePublicationResumeRequested") {
      const previous = events[index - 1]
      if (phase._tag !== "Retained" || previous?._tag !== "RemotePublicationRetained") {
        return contradiction("publication resume receipt must immediately follow an exact retained outcome")
      }
      const { correlation, request } = event
      if (
        request.runId !== correlation.qualifiedCandidate.run.session.plannedAttempt.runId ||
        request.responsibility.runId !== request.runId ||
        request.responsibility.queuedAt !== correlation.qualifiedCandidate.run.session.queuedAt
      ) {
        return contradiction("publication resume receipt does not identify the exact Run responsibility")
      }
      if (seenResumeRequestIds.has(request.requestId)) {
        return contradiction("publication resume request identity is duplicated")
      }
      seenResumeRequestIds.add(request.requestId)
      const attemptsBeforeReceipt = events
        .slice(0, index)
        .filter((prior) => prior._tag === "RemotePublicationAttemptIntended").length
      phase =
        remotePublicationRetainedCauseIsResumable(phase.cause) && attemptsBeforeReceipt < remotePublicationAttemptLimit
          ? { _tag: "ResumeReady", cause: phase.cause, request }
          : { _tag: "Retained", cause: phase.cause }
      continue
    }
    if (event._tag === "RemotePublicationSucceeded") {
      if (phase._tag !== "Pending") return contradiction("publication proof has no active delivery phase")
      const proofOrdinal = attemptOrdinalOfProof(event.proof)
      if (
        (event.proof._tag === "PushApplied" || event.proof._tag === "PushUpToDate") &&
        rejectedOrdinals.has(proofOrdinal)
      ) {
        return contradiction("one push attempt cannot both reject and succeed")
      }
      const intendedIndex = events.findIndex(
        (prior) => prior._tag === "RemotePublicationAttemptIntended" && prior.attemptOrdinal === proofOrdinal
      )
      if (intendedIndex < 1 || intendedIndex >= index) {
        return contradiction("publication proof has no exact earlier attempt intent")
      }
      if (
        (event.proof._tag === "PushApplied" ||
          event.proof._tag === "PushUpToDate" ||
          event.proof._tag === "ReconciledCandidateCurrent") &&
        event.proof.remoteHead !== intent.correlation.qualifiedCandidate.candidateCommit
      ) {
        return contradiction("current-head publication proof does not identify the exact candidate")
      }
      phase = { _tag: "Succeeded", proof: event.proof }
    }
  }

  switch (phase._tag) {
    case "Pending":
      return RemotePublicationState.cases.PublicationPending.make({
        authorization: phase.authorization,
        attemptOrdinals: [...attempts],
        correlation: intent.correlation
      })
    case "ResumeReady":
      return RemotePublicationState.cases.PublicationResumeReady.make({
        attemptOrdinals: [...attempts],
        correlation: intent.correlation,
        request: phase.request
      })
    case "Retained":
      return RemotePublicationState.cases.PublicationRetained.make({
        cause: phase.cause,
        correlation: intent.correlation
      })
    case "Succeeded":
      return RemotePublicationState.cases.PublicationSucceeded.make({
        correlation: intent.correlation,
        proof: phase.proof
      })
  }
}

export const remotePublicationAttemptsExhausted = (state: RemotePublicationState): boolean =>
  state._tag === "PublicationPending" &&
  state.attemptOrdinals.length === RemotePublicationAttemptLimit.make(remotePublicationAttemptLimit)
