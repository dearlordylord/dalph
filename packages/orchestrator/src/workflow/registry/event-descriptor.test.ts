import { describe, expect, it } from "vitest"
import {
  EvidenceDigest,
  EvidenceReference,
  GitCommitSha,
  IntegrationTarget,
  IntegrationTargetRef,
  GitRepositoryLocator
} from "@dalph/contracts"
import { integrationFinalityFixture } from "../protocols/integration-finality/fixtures.js"
import {
  IntegrationCandidateAgentReport,
  IntegrationCandidateAgentReportedEvent,
  IntegrationCandidateAgentReportOrdinal,
  CandidateContinuationLimit,
  CandidateCorrectionLimit,
  IntegrationCandidateContinuationLimitReachedEvent,
  IntegrationCandidateCorrelation,
  IntegrationCandidateCorrectionLimitReachedEvent,
  IntegrationCandidateGitObservation,
  IntegrationCandidateGitObservedEvent,
  IntegrationCandidateGitValidationAttemptOrdinal,
  IntegrationCandidateGitValidationFailedEvent,
  IntegrationCandidateId,
  IntegrationCandidateResourceLocator,
  IntegrationSessionId
} from "../protocols/integration-candidate-construction/events.js"
import {
  IntegratorCandidateGitObservedEvent,
  IntegratorCandidateGitReadIntendedEvent,
  IntegratorCandidateText,
  IntegratorCorrelation,
  IntegratorGitObservation,
  IntegratorResult,
  IntegratorResultRecordedEvent
} from "../protocols/integrator/events.js"
import {
  CompletionTaskRequestLookup,
  CompletionTaskRequestLookupIntendedEvent,
  CompletionTaskRequestLookupObservedEvent,
  CompletionTaskRequestOrdinal
} from "../protocols/integration-finality/events.js"
import {
  TargetVerificationCorrelation,
  TargetVerificationCorrelationContradictedEvent,
  TargetVerificationEvidenceSealedEvent,
  TargetVerificationIntendedEvent,
  TargetVerificationPlanId,
  targetVerificationCorrelationFor
} from "../protocols/target-verification/events.js"
import { workflowJournalEventVersion } from "../kernel/event.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { describeJournalEvent } from "./event-descriptor.js"
import {
  completionTaskRequestLookupIntentRecordKey,
  completionTaskRequestLookupRecordKey,
  integrationCandidateContinuationLimitReachedRecordKey,
  integrationCandidateCorrectionLimitReachedRecordKey,
  integrationCandidateGitValidationFailureRecordKey,
  integratorCandidateGitObservedRecordKey,
  integratorCandidateGitReadIntendedRecordKey,
  integratorResultRecordedRecordKey,
  targetVerificationCorrelationContradictedRecordKey,
  targetVerificationEvidenceSealedRecordKey,
  targetVerificationIntentRecordKey
} from "../../workflow-journal/record-key.js"

const candidateCorrelation = IntegrationCandidateCorrelation.make({
  acceptanceManifest: EvidenceReference.make({ byteLength: 1, digest: EvidenceDigest.make("a".repeat(64)) }),
  acceptedResultCommit: GitCommitSha.make("b".repeat(40)),
  attemptId: integrationFinalityFixture.plannedAttempt.attemptId,
  candidateId: IntegrationCandidateId.make("descriptor-candidate"),
  candidateResource: IntegrationCandidateResourceLocator.make("/candidate/descriptor"),
  expectedTargetHead: GitCommitSha.make("c".repeat(40)),
  integrationSessionId: IntegrationSessionId.make("descriptor-session"),
  integrationTarget: IntegrationTarget.make({
    ref: IntegrationTargetRef.make("refs/heads/main"),
    repository: GitRepositoryLocator.make("/repositories/descriptor.git")
  }),
  runId: integrationFinalityFixture.runId
})
const candidateCommit = GitCommitSha.make("d".repeat(40))
const candidateText = IntegratorCandidateText.make("refs/heads/descriptor-candidate")
const reviewManifest = EvidenceReference.make({ byteLength: 2, digest: EvidenceDigest.make("e".repeat(64)) })
const submissionAt = JournalPosition.make(11)
const candidateVerification = targetVerificationCorrelationFor(
  { candidateCommit, constructedAt: JournalPosition.make(12), correlation: candidateCorrelation, reviewManifest },
  TargetVerificationPlanId.make("descriptor-plan")
)
const integratorCorrelation = IntegratorCorrelation.make({
  ...integrationFinalityFixture.qualifiedCandidate.run.session,
  candidateResource: integrationFinalityFixture.qualifiedCandidate.run.session.candidateResource
})

describe("journal event descriptors", () => {
  it("describes Integrator, candidate, verification, and completion boundary events by exact key", () => {
    const integratorResult = IntegratorResult.cases.PreparedCandidate.make({
      candidateText,
      correlation: integratorCorrelation
    })
    const integratorEvents = [
      IntegratorResultRecordedEvent.make({ result: integratorResult, version: workflowJournalEventVersion }),
      IntegratorCandidateGitReadIntendedEvent.make({
        candidateText,
        correlation: integratorCorrelation,
        version: workflowJournalEventVersion
      }),
      IntegratorCandidateGitObservedEvent.make({
        candidateText,
        correlation: integratorCorrelation,
        observation: IntegratorGitObservation.cases.Missing.make({ candidateText }),
        version: workflowJournalEventVersion
      })
    ] as const
    expect(describeJournalEvent(integratorEvents[0]).expectedKey).toEqual(
      integratorResultRecordedRecordKey(integratorCorrelation)
    )
    expect(describeJournalEvent(integratorEvents[1]).expectedKey).toEqual(
      integratorCandidateGitReadIntendedRecordKey(integratorCorrelation, candidateText)
    )
    expect(describeJournalEvent(integratorEvents[2]).expectedKey).toEqual(
      integratorCandidateGitObservedRecordKey(integratorCorrelation, candidateText)
    )

    const candidateIntent = {
      correctionLimit: CandidateCorrectionLimit.make(1),
      continuationLimit: CandidateContinuationLimit.make(1),
      correlation: candidateCorrelation
    }
    const candidateEvents = [
      IntegrationCandidateGitValidationFailedEvent.make({
        attemptOrdinal: IntegrationCandidateGitValidationAttemptOrdinal.make(1),
        candidateCommit,
        correlation: candidateCorrelation,
        detail: "candidate object is missing",
        submissionAt,
        version: workflowJournalEventVersion
      }),
      IntegrationCandidateCorrectionLimitReachedEvent.make({
        ...candidateIntent,
        correctionCount: 1,
        invalidObservationAt: JournalPosition.make(13),
        version: workflowJournalEventVersion
      }),
      IntegrationCandidateContinuationLimitReachedEvent.make({
        ...candidateIntent,
        continuationCount: 1,
        lastReportAt: JournalPosition.make(13),
        version: workflowJournalEventVersion
      })
    ] as const
    expect(describeJournalEvent(candidateEvents[0]).expectedKey).toEqual(
      integrationCandidateGitValidationFailureRecordKey(
        candidateCorrelation,
        submissionAt,
        IntegrationCandidateGitValidationAttemptOrdinal.make(1)
      )
    )
    expect(describeJournalEvent(candidateEvents[1]).expectedKey).toEqual(
      integrationCandidateCorrectionLimitReachedRecordKey(candidateCorrelation)
    )
    expect(describeJournalEvent(candidateEvents[2]).expectedKey).toEqual(
      integrationCandidateContinuationLimitReachedRecordKey(candidateCorrelation)
    )

    const verificationEvents = [
      TargetVerificationIntendedEvent.make({
        correlation: candidateVerification,
        version: workflowJournalEventVersion
      }),
      TargetVerificationEvidenceSealedEvent.make({
        correlation: candidateVerification,
        manifest: reviewManifest,
        terminal: "Passed",
        version: workflowJournalEventVersion
      }),
      TargetVerificationCorrelationContradictedEvent.make({
        expected: candidateVerification,
        received: TargetVerificationCorrelation.make({
          ...candidateVerification,
          candidateCommit: GitCommitSha.make("f".repeat(40))
        }),
        version: workflowJournalEventVersion
      })
    ] as const
    expect(describeJournalEvent(verificationEvents[0]).expectedKey).toEqual(
      targetVerificationIntentRecordKey(candidateVerification.requestId)
    )
    expect(describeJournalEvent(verificationEvents[1]).expectedKey).toEqual(
      targetVerificationEvidenceSealedRecordKey(candidateVerification.requestId)
    )
    expect(describeJournalEvent(verificationEvents[2]).expectedKey).toEqual(
      targetVerificationCorrelationContradictedRecordKey(candidateVerification.requestId)
    )

    const request = integrationFinalityFixture.completionRequest
    const attemptOrdinal = CompletionTaskRequestOrdinal.make(1)
    const lookupEvents = [
      CompletionTaskRequestLookupIntendedEvent.make({
        attemptOrdinal,
        operationId: request.operationId,
        request,
        version: workflowJournalEventVersion
      }),
      CompletionTaskRequestLookupObservedEvent.make({
        attemptOrdinal,
        lookup: CompletionTaskRequestLookup.cases.Applied.make({ request }),
        operationId: request.operationId,
        request,
        version: workflowJournalEventVersion
      })
    ] as const
    expect(describeJournalEvent(lookupEvents[0]).expectedKey).toEqual(
      completionTaskRequestLookupIntentRecordKey(request, attemptOrdinal)
    )
    expect(describeJournalEvent(lookupEvents[1]).expectedKey).toEqual(
      completionTaskRequestLookupRecordKey(request, attemptOrdinal)
    )
  })

  it("constructs a candidate report fixture without widening event unions", () => {
    const report = IntegrationCandidateAgentReportedEvent.make({
      expectedCorrelation: candidateCorrelation,
      ordinal: IntegrationCandidateAgentReportOrdinal.make(1),
      report: IntegrationCandidateAgentReport.cases.Working.make({ correlation: candidateCorrelation }),
      version: workflowJournalEventVersion
    })
    expect(report._tag).toBe("IntegrationCandidateAgentReported")
    expect(
      IntegrationCandidateGitObservedEvent.make({
        candidateCommit,
        correlation: candidateCorrelation,
        observation: IntegrationCandidateGitObservation.cases.Missing.make({}),
        submissionAt,
        version: workflowJournalEventVersion
      }).candidateCommit
    ).toBe(candidateCommit)
  })
})
