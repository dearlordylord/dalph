import { Schema } from "effect"
import {
  RemotePublicationAttemptLimit,
  RemotePublicationAttemptOrdinal,
  RemotePublicationCorrelation,
  type RemotePublicationJournalEvent,
  RemotePublicationProofBasis,
  RemotePublicationRetainedCause,
  remotePublicationAttemptLimit,
  remotePublicationCorrelationEquals
} from "./events.js"

export const RemotePublicationState = Schema.TaggedUnion({
  PublicationAbsent: {},
  PublicationContradiction: { detail: Schema.String },
  PublicationPending: {
    attemptOrdinals: Schema.Array(RemotePublicationAttemptOrdinal),
    correlation: RemotePublicationCorrelation
  },
  PublicationSucceeded: { correlation: RemotePublicationCorrelation, proof: RemotePublicationProofBasis },
  PublicationRetained: { cause: RemotePublicationRetainedCause, correlation: RemotePublicationCorrelation }
})
export type RemotePublicationState = typeof RemotePublicationState.Type

const attemptOrdinalOfProof = (proof: RemotePublicationProofBasis): RemotePublicationAttemptOrdinal =>
  proof.attemptOrdinal

const finalEventOffset = -1

const contiguousAttemptsIssue = (attempts: ReadonlyArray<RemotePublicationAttemptOrdinal>): string | undefined => {
  if (attempts.length > remotePublicationAttemptLimit) return "publication history exceeds the accepted attempt limit"
  for (const [index, ordinal] of attempts.entries()) {
    if (Number(ordinal) !== index + 1) return "publication attempt ordinals must begin at one and remain contiguous"
  }
  return undefined
}

/** Reduces one request's durable events without inferring a result from a process exit or missing record. */
export const deriveRemotePublicationState = (
  events: ReadonlyArray<RemotePublicationJournalEvent>
): RemotePublicationState => {
  if (events.length === 0) return RemotePublicationState.cases.PublicationAbsent.make({})
  const intent = events[0]
  if (intent?._tag !== "RemotePublicationIntended") {
    return RemotePublicationState.cases.PublicationContradiction.make({
      detail: "publication history must begin with the outer intent"
    })
  }
  if (events.filter(({ _tag }) => _tag === "RemotePublicationIntended").length !== 1) {
    return RemotePublicationState.cases.PublicationContradiction.make({
      detail: "publication history has more than one outer intent"
    })
  }
  if (
    events.some(
      (event) => "correlation" in event && !remotePublicationCorrelationEquals(event.correlation, intent.correlation)
    )
  ) {
    return RemotePublicationState.cases.PublicationContradiction.make({
      detail: "publication history mixes distinct request correlations"
    })
  }
  const attempts = events.flatMap((event) =>
    event._tag === "RemotePublicationAttemptIntended" ? [event.attemptOrdinal] : []
  )
  const attemptIssue = contiguousAttemptsIssue(attempts)
  if (attemptIssue !== undefined) {
    return RemotePublicationState.cases.PublicationContradiction.make({ detail: attemptIssue })
  }
  const successes = events.filter(
    (event): event is Extract<RemotePublicationJournalEvent, { readonly _tag: "RemotePublicationSucceeded" }> =>
      event._tag === "RemotePublicationSucceeded"
  )
  if (successes.length > 1) {
    return RemotePublicationState.cases.PublicationContradiction.make({
      detail: "publication history has more than one terminal proof"
    })
  }
  const retained = events.filter(
    (event): event is Extract<RemotePublicationJournalEvent, { readonly _tag: "RemotePublicationRetained" }> =>
      event._tag === "RemotePublicationRetained"
  )
  if (retained.length > 1 || (retained.length === 1 && successes.length === 1)) {
    return RemotePublicationState.cases.PublicationContradiction.make({
      detail: "publication history has more than one terminal outcome"
    })
  }
  const retainedOutcome = retained[0]
  if (retainedOutcome !== undefined) {
    if (events.at(finalEventOffset)?._tag !== "RemotePublicationRetained") {
      return RemotePublicationState.cases.PublicationContradiction.make({
        detail: "publication history contains an event after retained outcome"
      })
    }
    if (retainedOutcome.cause._tag === "AttemptsExhausted" && attempts.length !== remotePublicationAttemptLimit) {
      return RemotePublicationState.cases.PublicationContradiction.make({
        detail: "publication exhaustion requires the exact accepted attempt limit"
      })
    }
    return RemotePublicationState.cases.PublicationRetained.make({
      cause: retainedOutcome.cause,
      correlation: intent.correlation
    })
  }
  const success = successes[0]
  if (success !== undefined) {
    if (events.at(finalEventOffset)?._tag !== "RemotePublicationSucceeded") {
      return RemotePublicationState.cases.PublicationContradiction.make({
        detail: "publication history contains an event after terminal proof"
      })
    }
    const proofOrdinal = attemptOrdinalOfProof(success.proof)
    const successIndex = events.indexOf(success)
    const intendedIndex = events.findIndex(
      (event) => event._tag === "RemotePublicationAttemptIntended" && event.attemptOrdinal === proofOrdinal
    )
    if (intendedIndex < 1 || intendedIndex >= successIndex) {
      return RemotePublicationState.cases.PublicationContradiction.make({
        detail: "publication proof has no exact earlier attempt intent"
      })
    }
    if (
      (success.proof._tag === "PushApplied" ||
        success.proof._tag === "PushUpToDate" ||
        success.proof._tag === "ReconciledCandidateCurrent") &&
      success.proof.remoteHead !== intent.correlation.qualifiedCandidate.candidateCommit
    ) {
      return RemotePublicationState.cases.PublicationContradiction.make({
        detail: "current-head publication proof does not identify the exact candidate"
      })
    }
    return RemotePublicationState.cases.PublicationSucceeded.make({
      correlation: intent.correlation,
      proof: success.proof
    })
  }
  return RemotePublicationState.cases.PublicationPending.make({
    attemptOrdinals: [...attempts],
    correlation: intent.correlation
  })
}

export const remotePublicationAttemptsExhausted = (state: RemotePublicationState): boolean =>
  state._tag === "PublicationPending" &&
  state.attemptOrdinals.length === RemotePublicationAttemptLimit.make(remotePublicationAttemptLimit)
