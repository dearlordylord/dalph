import {
  GitCommitSha,
  RemotePublicationBranchRef,
  RemotePublicationEndpoint,
  RemotePublicationTarget
} from "@dalph/contracts"
import { Schema } from "effect"
import { expect, it } from "vitest"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { integrationFinalityFixture } from "../integration-finality/fixtures.js"
import {
  RemotePublicationAttemptIntendedEvent,
  RemotePublicationAttemptRejectedNonFastForwardEvent,
  RemotePublicationAttemptOrdinal,
  RemotePublicationIntendedEvent,
  RemotePublicationProofBasis,
  RemotePublicationRetainedCause,
  RemotePublicationRetainedEvent,
  RemotePublicationSucceededEvent,
  remotePublicationCorrelationFor,
  remotePublicationRefspecFor
} from "./events.js"
import { deriveRemotePublicationState } from "./state.js"

const target = RemotePublicationTarget.make({
  branch: RemotePublicationBranchRef.make("refs/heads/main"),
  endpoint: RemotePublicationEndpoint.make("ssh://git@example.invalid/repository.git")
})
const correlation = remotePublicationCorrelationFor(integrationFinalityFixture.qualifiedCandidate, target)
const outerIntent = RemotePublicationIntendedEvent.make({
  correlation,
  initiatedBy: { _tag: "DalphCoordinator" },
  occurrenceClassification: "InitiatedAction",
  version: workflowJournalEventVersion
})
const attempt = RemotePublicationAttemptIntendedEvent.make({
  attemptOrdinal: RemotePublicationAttemptOrdinal.make(1),
  correlation,
  initiatedBy: { _tag: "DalphCoordinator" },
  occurrenceClassification: "InitiatedAction",
  refspec: remotePublicationRefspecFor(correlation.qualifiedCandidate.candidateCommit, correlation.target.branch),
  version: workflowJournalEventVersion
})

it("retains a conclusive rejection and rejects orphan, duplicate, wrong-ordinal, or conflicting results", () => {
  const rejected = RemotePublicationAttemptRejectedNonFastForwardEvent.make({
    attemptOrdinal: attempt.attemptOrdinal,
    correlation,
    occurrenceClassification: "NonActionOccurrence",
    version: workflowJournalEventVersion
  })
  expect(deriveRemotePublicationState([outerIntent, attempt, rejected])).toMatchObject({
    _tag: "PublicationPending",
    attemptOrdinals: [1]
  })
  for (const events of [
    [outerIntent, rejected],
    [outerIntent, attempt, rejected, rejected],
    [outerIntent, attempt, { ...rejected, attemptOrdinal: RemotePublicationAttemptOrdinal.make(2) }],
    [
      outerIntent,
      attempt,
      rejected,
      RemotePublicationSucceededEvent.make({
        correlation,
        occurrenceClassification: "NonActionOccurrence",
        version: workflowJournalEventVersion,
        proof: RemotePublicationProofBasis.cases.PushApplied.make({
          attemptOrdinal: attempt.attemptOrdinal,
          remoteHead: correlation.qualifiedCandidate.candidateCommit
        })
      })
    ]
  ])
    expect(deriveRemotePublicationState(events)._tag).toBe("PublicationContradiction")
})

it("derives exact publication proof only after its numbered intent", () => {
  const proof = RemotePublicationProofBasis.cases.PushApplied.make({
    attemptOrdinal: attempt.attemptOrdinal,
    remoteHead: correlation.qualifiedCandidate.candidateCommit
  })
  expect(
    deriveRemotePublicationState([
      outerIntent,
      attempt,
      RemotePublicationSucceededEvent.make({
        correlation,
        occurrenceClassification: "NonActionOccurrence",
        proof,
        version: workflowJournalEventVersion
      })
    ])
  ).toEqual({ _tag: "PublicationSucceeded", correlation, proof })
})

it("rejects a numbered intent whose explicit refspec does not name the exact candidate and branch", () => {
  expect(() =>
    Schema.decodeUnknownSync(RemotePublicationAttemptIntendedEvent)({
      ...attempt,
      refspec: remotePublicationRefspecFor(
        correlation.qualifiedCandidate.candidateCommit,
        RemotePublicationBranchRef.make("refs/heads/other")
      )
    })
  ).toThrow()
})

it("rejects a publication proof with no exact earlier numbered intent", () => {
  const proof = RemotePublicationProofBasis.cases.PushUpToDate.make({
    attemptOrdinal: RemotePublicationAttemptOrdinal.make(1),
    remoteHead: correlation.qualifiedCandidate.candidateCommit
  })
  expect(
    deriveRemotePublicationState([
      outerIntent,
      RemotePublicationSucceededEvent.make({
        correlation,
        occurrenceClassification: "NonActionOccurrence",
        proof,
        version: workflowJournalEventVersion
      })
    ])
  ).toEqual({ _tag: "PublicationContradiction", detail: "publication proof has no exact earlier attempt intent" })
})

it("rejects noncontiguous publication attempt ordinals", () => {
  expect(
    deriveRemotePublicationState([
      outerIntent,
      RemotePublicationAttemptIntendedEvent.make({
        attemptOrdinal: RemotePublicationAttemptOrdinal.make(2),
        correlation,
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        refspec: remotePublicationRefspecFor(correlation.qualifiedCandidate.candidateCommit, correlation.target.branch),
        version: workflowJournalEventVersion
      })
    ])
  ).toEqual({
    _tag: "PublicationContradiction",
    detail: "publication attempt ordinals must begin at one and remain contiguous"
  })
})

it("rejects an attempt that precedes the outer intent", () => {
  expect(deriveRemotePublicationState([attempt, outerIntent])).toEqual({
    _tag: "PublicationContradiction",
    detail: "publication history must begin with the outer intent"
  })
})

it("rejects current-head proof for a different commit", () => {
  const proof = RemotePublicationProofBasis.cases.PushApplied.make({
    attemptOrdinal: attempt.attemptOrdinal,
    remoteHead: GitCommitSha.make("9999999999999999999999999999999999999999")
  })
  expect(
    deriveRemotePublicationState([
      outerIntent,
      attempt,
      RemotePublicationSucceededEvent.make({
        correlation,
        occurrenceClassification: "NonActionOccurrence",
        proof,
        version: workflowJournalEventVersion
      })
    ])
  ).toEqual({
    _tag: "PublicationContradiction",
    detail: "current-head publication proof does not identify the exact candidate"
  })
})

it("retains an exact competing head only as the terminal outcome", () => {
  const cause = RemotePublicationRetainedCause.cases.CompatibleCompetingHead.make({
    mergeBase: integrationFinalityFixture.qualifiedCandidate.run.session.expectedTargetHead,
    remoteHead: GitCommitSha.make("8888888888888888888888888888888888888888")
  })
  const retained = RemotePublicationRetainedEvent.make({
    cause,
    correlation,
    occurrenceClassification: "NonActionOccurrence",
    version: workflowJournalEventVersion
  })
  expect(deriveRemotePublicationState([outerIntent, retained])).toEqual({
    _tag: "PublicationRetained",
    cause,
    correlation
  })
  expect(deriveRemotePublicationState([outerIntent, retained, attempt])).toEqual({
    _tag: "PublicationContradiction",
    detail: "publication history contains an event after retained outcome"
  })
})

it("rejects exhaustion before the exact publication attempt limit", () => {
  expect(
    deriveRemotePublicationState([
      outerIntent,
      attempt,
      RemotePublicationRetainedEvent.make({
        cause: RemotePublicationRetainedCause.cases.AttemptsExhausted.make({}),
        correlation,
        occurrenceClassification: "NonActionOccurrence",
        version: workflowJournalEventVersion
      })
    ])
  ).toEqual({
    _tag: "PublicationContradiction",
    detail: "publication exhaustion requires the exact accepted attempt limit"
  })
})
