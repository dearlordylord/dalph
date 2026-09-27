import {
  GitCommitSha,
  RemotePublicationBranchRef,
  RemotePublicationEndpoint,
  RemotePublicationTarget,
  RunId
} from "@dalph/contracts"
import { Schema } from "effect"
import { expect, it } from "vitest"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { WorkflowActor } from "../../registry/actor.js"
import { integrationFinalityFixture } from "../integration-finality/fixtures.js"
import { IntegrationResponsibilityIdentity } from "../integration-admission/responsibility.js"
import {
  RemotePublicationAttemptAuthorization,
  RemotePublicationAttemptIntendedEvent,
  RemotePublicationAttemptRejectedNonFastForwardEvent,
  RemotePublicationAttemptOrdinal,
  RemotePublicationIntendedEvent,
  RemotePublicationProofBasis,
  RemotePublicationRetainedCause,
  RemotePublicationRetainedEvent,
  RemotePublicationResumeRequest,
  RemotePublicationResumeRequestId,
  RemotePublicationResumeRequestedEvent,
  RemotePublicationSucceededEvent,
  remotePublicationAttemptLimit,
  remotePublicationCorrelationFor,
  remotePublicationRefspecFor
} from "./events.js"
import { deriveRemotePublicationState } from "./state.js"
import { JournalPosition } from "../../../workflow-journal/identity.js"

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
    authorization: { _tag: "InitialAttempt" },
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

it("derives publication proof for a successor candidate whose first intent uses the responsibility grant", () => {
  const grantAt = JournalPosition.make(42)
  const grantedAttempt = RemotePublicationAttemptIntendedEvent.make({ ...attempt, batchGrantAt: grantAt })
  const proof = RemotePublicationProofBasis.cases.PushApplied.make({
    attemptOrdinal: grantedAttempt.attemptOrdinal,
    remoteHead: correlation.qualifiedCandidate.candidateCommit
  })
  expect(
    deriveRemotePublicationState([
      outerIntent,
      grantedAttempt,
      RemotePublicationSucceededEvent.make({
        correlation,
        occurrenceClassification: "NonActionOccurrence",
        proof,
        version: workflowJournalEventVersion
      })
    ])
  ).toEqual({ _tag: "PublicationSucceeded", correlation, proof })
})

it("preserves publication proof when a new exact resume receipt continues pending finality", () => {
  const runId = correlation.qualifiedCandidate.run.session.plannedAttempt.runId
  const request = RemotePublicationResumeRequest.make({
    requestId: RemotePublicationResumeRequestId.make("resume-after-publication-proof"),
    responsibility: IntegrationResponsibilityIdentity.make({
      queuedAt: correlation.qualifiedCandidate.run.session.queuedAt,
      runId
    }),
    runId,
    schemaVersion: 1
  })
  const receipt = RemotePublicationResumeRequestedEvent.make({
    correlation,
    initiatedBy: WorkflowActor.cases.Operator.make({}),
    occurrenceClassification: "InitiatedAction",
    request,
    version: workflowJournalEventVersion
  })
  const proof = RemotePublicationProofBasis.cases.PushApplied.make({
    attemptOrdinal: attempt.attemptOrdinal,
    remoteHead: correlation.qualifiedCandidate.candidateCommit
  })
  const success = RemotePublicationSucceededEvent.make({
    correlation,
    occurrenceClassification: "NonActionOccurrence",
    proof,
    version: workflowJournalEventVersion
  })

  expect(deriveRemotePublicationState([outerIntent, attempt, success, receipt])).toEqual({
    _tag: "PublicationSucceeded",
    correlation,
    proof
  })
  expect(deriveRemotePublicationState([outerIntent, attempt, success, receipt, receipt])).toMatchObject({
    _tag: "PublicationContradiction",
    detail: "publication resume request identity is duplicated"
  })
  expect(
    deriveRemotePublicationState([
      outerIntent,
      attempt,
      success,
      RemotePublicationResumeRequestedEvent.make({
        ...receipt,
        request: RemotePublicationResumeRequest.make({
          ...request,
          responsibility: IntegrationResponsibilityIdentity.make({
            queuedAt: request.responsibility.queuedAt,
            runId: RunId.make("foreign-publication-resume-run")
          }),
          runId: RunId.make("foreign-publication-resume-run")
        })
      })
    ])
  ).toMatchObject({
    _tag: "PublicationContradiction",
    detail: "publication resume receipt does not identify the exact Run responsibility"
  })
})

it("accepts only exact reconciled proof from the active resume receipt and its latest retained attempt", () => {
  const runId = correlation.qualifiedCandidate.run.session.plannedAttempt.runId
  const request = RemotePublicationResumeRequest.make({
    requestId: RemotePublicationResumeRequestId.make("resume-reconcile-current-proof"),
    responsibility: IntegrationResponsibilityIdentity.make({
      queuedAt: correlation.qualifiedCandidate.run.session.queuedAt,
      runId
    }),
    runId,
    schemaVersion: 1
  })
  const retained = RemotePublicationRetainedEvent.make({
    authorization: RemotePublicationAttemptAuthorization.cases.InitialAttempt.make({}),
    cause: RemotePublicationRetainedCause.cases.AuthenticationDenied.make({}),
    correlation,
    occurrenceClassification: "NonActionOccurrence",
    version: workflowJournalEventVersion
  })
  const receipt = RemotePublicationResumeRequestedEvent.make({
    correlation,
    initiatedBy: WorkflowActor.cases.Operator.make({}),
    occurrenceClassification: "InitiatedAction",
    request,
    version: workflowJournalEventVersion
  })
  const proof = RemotePublicationProofBasis.cases.ReconciledCandidateCurrent.make({
    attemptOrdinal: attempt.attemptOrdinal,
    remoteHead: correlation.qualifiedCandidate.candidateCommit
  })
  const success = RemotePublicationSucceededEvent.make({
    correlation,
    occurrenceClassification: "NonActionOccurrence",
    proof,
    version: workflowJournalEventVersion
  })
  expect(deriveRemotePublicationState([outerIntent, attempt, retained, receipt, success])).toEqual({
    _tag: "PublicationSucceeded",
    correlation,
    proof
  })

  const pushSuccess = RemotePublicationSucceededEvent.make({
    ...success,
    proof: RemotePublicationProofBasis.cases.PushApplied.make({
      attemptOrdinal: attempt.attemptOrdinal,
      remoteHead: correlation.qualifiedCandidate.candidateCommit
    })
  })
  expect(deriveRemotePublicationState([outerIntent, attempt, retained, receipt, pushSuccess])).toEqual({
    _tag: "PublicationContradiction",
    detail: "resume receipt can settle publication only through exact remote reconciliation"
  })

  const wrongOrdinalSuccess = RemotePublicationSucceededEvent.make({
    ...success,
    proof: RemotePublicationProofBasis.cases.ReconciledCandidateCurrent.make({
      attemptOrdinal: RemotePublicationAttemptOrdinal.make(2),
      remoteHead: correlation.qualifiedCandidate.candidateCommit
    })
  })
  expect(deriveRemotePublicationState([outerIntent, attempt, retained, receipt, wrongOrdinalSuccess])).toEqual({
    _tag: "PublicationContradiction",
    detail: "resumed publication proof must identify the latest pre-receipt attempt"
  })
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
    authorization: RemotePublicationAttemptAuthorization.cases.InitialAttempt.make({}),
    cause,
    correlation,
    occurrenceClassification: "NonActionOccurrence",
    version: workflowJournalEventVersion
  })
  expect(deriveRemotePublicationState([outerIntent, retained])).toEqual({
    _tag: "PublicationRetained",
    attemptOrdinalsInBatch: [],
    authorization: RemotePublicationAttemptAuthorization.cases.InitialAttempt.make({}),
    cause,
    correlation
  })
  expect(deriveRemotePublicationState([outerIntent, retained, attempt])).toEqual({
    _tag: "PublicationContradiction",
    detail: "publication attempt after retained outcome requires a new exact batch grant or resume receipt"
  })
})

it("rejects exhaustion before the exact publication attempt limit", () => {
  expect(
    deriveRemotePublicationState([
      outerIntent,
      attempt,
      RemotePublicationRetainedEvent.make({
        authorization: RemotePublicationAttemptAuthorization.cases.InitialAttempt.make({}),
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

it("rejects resume receipts for exhausted, throttled, or out-of-budget retained histories", () => {
  const runId = correlation.qualifiedCandidate.run.session.plannedAttempt.runId
  const request = RemotePublicationResumeRequest.make({
    requestId: RemotePublicationResumeRequestId.make("resume-reject-exhausted-or-throttled"),
    responsibility: IntegrationResponsibilityIdentity.make({
      queuedAt: correlation.qualifiedCandidate.run.session.queuedAt,
      runId
    }),
    runId,
    schemaVersion: 1
  })
  const receipt = RemotePublicationResumeRequestedEvent.make({
    correlation,
    initiatedBy: WorkflowActor.cases.Operator.make({}),
    occurrenceClassification: "InitiatedAction",
    request,
    version: workflowJournalEventVersion
  })
  const makeHistory = (
    cause: typeof RemotePublicationRetainedCause.Type,
    attemptCount: number,
    rejectedCount: number
  ) => {
    const attemptEvents = Array.from({ length: attemptCount }, (_, index) => {
      const attemptOrdinal = RemotePublicationAttemptOrdinal.make(index + 1)
      const intended = RemotePublicationAttemptIntendedEvent.make({ ...attempt, attemptOrdinal })
      return rejectedCount > index
        ? [
            intended,
            RemotePublicationAttemptRejectedNonFastForwardEvent.make({
              attemptOrdinal,
              correlation,
              occurrenceClassification: "NonActionOccurrence",
              version: workflowJournalEventVersion
            })
          ]
        : [intended]
    }).flat()
    const retained = RemotePublicationRetainedEvent.make({
      authorization: RemotePublicationAttemptAuthorization.cases.InitialAttempt.make({}),
      cause,
      correlation,
      occurrenceClassification: "NonActionOccurrence",
      version: workflowJournalEventVersion
    })
    return [outerIntent, ...attemptEvents, retained, receipt]
  }
  const cases = [
    {
      events: makeHistory(
        RemotePublicationRetainedCause.cases.AttemptsExhausted.make({}),
        remotePublicationAttemptLimit,
        remotePublicationAttemptLimit
      ),
      detail: "publication resume receipt cannot override retained cause AttemptsExhausted"
    },
    {
      events: makeHistory(RemotePublicationRetainedCause.cases.Throttled.make({}), 1, 0),
      detail: "publication resume receipt cannot override retained cause Throttled"
    },
    {
      events: makeHistory(
        RemotePublicationRetainedCause.cases.AuthenticationDenied.make({}),
        remotePublicationAttemptLimit,
        remotePublicationAttemptLimit - 1
      ),
      detail: "publication resume receipt cannot override the exhausted attempt allowance"
    }
  ]
  for (const { detail, events } of cases) {
    expect(deriveRemotePublicationState(events)).toEqual({ _tag: "PublicationContradiction", detail })
  }
})
