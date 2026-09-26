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
  PublicationRetained: {
    authorization: RemotePublicationAttemptAuthorization,
    cause: RemotePublicationRetainedCause,
    correlation: RemotePublicationCorrelation
  }
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
  cause._tag === "CompatibleCompetingHead" ||
  cause._tag === "IncompatibleLineage" ||
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
  | {
      readonly _tag: "Retained"
      readonly authorization: RemotePublicationAttemptAuthorization
      readonly cause: RemotePublicationRetainedCause
    }
  | { readonly _tag: "Succeeded"; readonly proof: RemotePublicationProofBasis }

const contradiction = (detail: string): RemotePublicationState =>
  RemotePublicationState.cases.PublicationContradiction.make({ detail })

const resumeRequestMatchesCorrelation = (
  correlation: RemotePublicationCorrelation,
  request: RemotePublicationResumeRequest
): boolean =>
  request.runId === correlation.qualifiedCandidate.run.session.plannedAttempt.runId &&
  request.responsibility.runId === request.runId &&
  request.responsibility.queuedAt === correlation.qualifiedCandidate.run.session.queuedAt

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
      if (event._tag !== "RemotePublicationResumeRequested") {
        return contradiction("publication history contains an event after terminal proof")
      }
      if (!resumeRequestMatchesCorrelation(event.correlation, event.request)) {
        return contradiction("publication resume receipt does not identify the exact Run responsibility")
      }
      if (seenResumeRequestIds.has(event.request.requestId)) {
        return contradiction("publication resume request identity is duplicated")
      }
      seenResumeRequestIds.add(event.request.requestId)
      continue
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
      const matchesAuthorization =
        phase._tag === "Pending"
          ? event.authorization._tag === phase.authorization._tag &&
            (event.authorization._tag === "InitialAttempt" ||
              (phase.authorization._tag === "ResumeRequest" &&
                event.authorization.requestId === phase.authorization.requestId))
          : phase._tag === "ResumeReady" &&
            event.authorization._tag === "ResumeRequest" &&
            event.authorization.requestId === phase.request.requestId
      if (!matchesAuthorization) {
        return contradiction("publication retained outcome must identify its exact active authorization")
      }
      if (event.cause._tag === "AttemptsExhausted" && attempts.length !== remotePublicationAttemptLimit) {
        return contradiction("publication exhaustion requires the exact accepted attempt limit")
      }
      phase = { _tag: "Retained", authorization: event.authorization, cause: event.cause }
      continue
    }
    if (event._tag === "RemotePublicationResumeRequested") {
      const previous = events[index - 1]
      if (phase._tag !== "Retained" || previous?._tag !== "RemotePublicationRetained") {
        return contradiction("publication resume receipt must immediately follow an exact retained outcome")
      }
      const { request } = event
      if (!resumeRequestMatchesCorrelation(event.correlation, request)) {
        return contradiction("publication resume receipt does not identify the exact Run responsibility")
      }
      if (seenResumeRequestIds.has(request.requestId)) {
        return contradiction("publication resume request identity is duplicated")
      }
      seenResumeRequestIds.add(request.requestId)
      const attemptsBeforeReceipt = events
        .slice(0, index)
        .filter((prior) => prior._tag === "RemotePublicationAttemptIntended").length
      if (!remotePublicationRetainedCauseIsResumable(phase.cause)) {
        return contradiction(`publication resume receipt cannot override retained cause ${phase.cause._tag}`)
      }
      if (attemptsBeforeReceipt >= remotePublicationAttemptLimit) {
        return contradiction("publication resume receipt cannot override the exhausted attempt allowance")
      }
      phase = { _tag: "ResumeReady", cause: phase.cause, request }
      continue
    }
    if (event._tag === "RemotePublicationSucceeded") {
      if (phase._tag !== "Pending" && phase._tag !== "ResumeReady") {
        return contradiction("publication proof has no active delivery phase")
      }
      const proofOrdinal = attemptOrdinalOfProof(event.proof)
      if (phase._tag === "ResumeReady") {
        const latestAttempt = events
          .slice(0, index)
          .findLast((prior) => prior._tag === "RemotePublicationAttemptIntended")
        if (event.proof._tag !== "ReconciledCandidateCurrent" && event.proof._tag !== "ReconciledCandidateAncestor") {
          return contradiction("resume receipt can settle publication only through exact remote reconciliation")
        }
        if (
          latestAttempt?._tag !== "RemotePublicationAttemptIntended" ||
          latestAttempt.attemptOrdinal !== proofOrdinal
        ) {
          return contradiction("resumed publication proof must identify the latest pre-receipt attempt")
        }
      }
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
        authorization: phase.authorization,
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
