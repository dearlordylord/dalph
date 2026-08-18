import { describe, expect, it } from "vitest"
import { acceptedResultFixture, evidenceReferenceFixture } from "../../../test/support/evidence.js"
import {
  AttemptId,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { JournalPosition, JournalRecordKey } from "../../workflow-journal/identity.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import {
  CandidateContinuationLimit,
  CandidateCorrectionLimit,
  IntegrationCandidateAgentReport,
  IntegrationCandidateAgentReportedEvent,
  IntegrationCandidateAgentReportOrdinal,
  IntegrationCandidateContinuationLimitReachedEvent,
  IntegrationCandidateConstructionIntendedEvent,
  IntegrationCandidateConstructedEvent,
  IntegrationCandidateCorrelation,
  IntegrationCandidateCorrectionLimitReachedEvent,
  IntegrationCandidateGitObservation,
  IntegrationCandidateGitObservedEvent,
  IntegrationCandidateGitValidationAttemptOrdinal,
  IntegrationCandidateGitValidationFailedEvent,
  IntegrationCandidateId,
  IntegrationCandidateResourceLocator,
  IntegrationCandidateSessionSupersededEvent,
  IntegrationSessionId,
  type ConstructedIntegrationCandidateOccurrence
} from "../../workflow/protocols/integration-candidate-construction/events.js"
import {
  IntegrationResponsibilityBeganEvent,
  IntegrationStartedEvent
} from "../../workflow/protocols/integration-admission/events.js"
import { TargetLineageObservation } from "../../authorities/git/target-lineage.js"
import { OperationId } from "../../workflow/identity.js"
import { WorkflowActor } from "../../workflow/registry/actor.js"
import { GitReadIntentRecordedEvent, TargetLineageObservedEvent } from "../../workflow/registry/event.js"
import { WorkflowOperation } from "../../workflow/registry/operation.js"
import {
  IntegratorCandidateGitObservedEvent,
  IntegratorCandidateGitReadIntendedEvent,
  IntegratorCandidateResourceLocator,
  IntegratorCandidateText,
  IntegratorCorrelation,
  IntegratorGitObservation,
  IntegratorNotPreparedDetail,
  IntegratorResult,
  IntegratorResultRecordedEvent,
  IntegratorRunCorrelation,
  IntegratorRunOrdinal,
  IntegratorRunCandidateGitObservedEvent,
  IntegratorRunCandidateGitReadIntendedEvent,
  IntegratorRunQualifiedCandidate,
  IntegratorRunResultRecordedEvent,
  IntegratorRunStartedEvent,
  IntegratorSessionFixedEvent,
  IntegratorSessionId,
  IntegratorSuccessorSessionFixedEvent
} from "../../workflow/protocols/integrator/events.js"
import {
  TargetVerificationCorrelation,
  TargetVerificationCorrelationContradictedEvent,
  TargetVerificationEvidenceSealedEvent,
  TargetVerificationIntendedEvent,
  TargetVerificationPlanId,
  targetVerificationCorrelationFor
} from "../../workflow/protocols/target-verification/events.js"
import {
  TargetPromotionIntendedEvent,
  targetPromotionCorrelationFor
} from "../../workflow/protocols/target-promotion/events.js"
import {
  IntegrationProviderRunActivityAbsentEvent,
  IntegrationQuarantineDirectionAppliedEvent,
  IntegrationQuarantineDirectionFingerprint,
  IntegrationQuarantineDirectionRequestId,
  IntegrationQuarantineFailureDetail
} from "../../workflow/protocols/integration-quarantine/events.js"
import { EvidenceReference } from "../../workflow/protocols/target-verification/evidence-store.js"
import type { IntegrationHistoryIndexes } from "./integration-history.js"
import { validateIntegrationHistoryRecord } from "./integration-history-validation.js"
import { makeTargetPromotionHistoryIndexes } from "./target-promotion-history.js"
import { invalidIntegrationRunBinding } from "./integration-history-run-binding.js"

const runId = RunId.make("promotion-history-run")
const candidate: ConstructedIntegrationCandidateOccurrence = {
  candidateCommit: GitCommitSha.make("4".repeat(40)),
  constructedAt: JournalPosition.make(11),
  correlation: {
    acceptanceManifest: acceptedResultFixture(GitCommitSha.make("3".repeat(40))).evidenceManifest,
    acceptedResultCommit: GitCommitSha.make("3".repeat(40)),
    attemptId: AttemptId.make("promotion-history-attempt"),
    candidateId: IntegrationCandidateId.make("promotion-history-candidate"),
    candidateResource: IntegrationCandidateResourceLocator.make("/candidate/promotion-history"),
    expectedTargetHead: GitCommitSha.make("2".repeat(40)),
    integrationSessionId: IntegrationSessionId.make("promotion-history-session"),
    integrationTarget: IntegrationTarget.make({
      ref: IntegrationTargetRef.make("refs/heads/master"),
      repository: GitRepositoryLocator.make("/repositories/promotion-history.git")
    }),
    runId
  },
  reviewManifest: evidenceReferenceFixture
}
const changedByteLength = (reference: EvidenceReference): EvidenceReference =>
  EvidenceReference.make({ byteLength: reference.byteLength + 1, digest: reference.digest })
const constructed = IntegrationCandidateConstructedEvent.make({
  candidateCommit: candidate.candidateCommit,
  correlation: candidate.correlation,
  gitObservationAt: JournalPosition.make(10),
  reviewManifest: candidate.reviewManifest,
  version: workflowJournalEventVersion
})

const indexes = (): IntegrationHistoryIndexes => ({
  acceptedExecutorResults: new Map(),
  acceptedExecutorResultPositions: new Map(),
  executorResponsibilitiesBegan: new Map(),
  integrationCandidateGitObservations: new Map(),
  integrationCandidateIntents: new Map(),
  integrationCandidateIntentsByStartedAt: new Map(),
  integrationCandidateSessionSupersessions: new Map(),
  integrationCandidateSessionSupersessionsByPrior: new Map(),
  integrationCandidateSubmissions: new Map(),
  integrationCandidatesConstructed: new Map([[candidate.constructedAt, constructed]]),
  integrationResponsibilitiesBegan: new Map(),
  integrationStarted: new Map(),
  targetLineageReadIntents: new Map(),
  targetLineageObservations: new Map(),
  integratorSessionFixed: new Map(),
  integratorSessionsByStartedAt: new Map(),
  integratorSessionsBySessionId: new Map(),
  integratorSessionsByCandidateResource: new Map(),
  integratorSuccessorSessionFixed: new Map(),
  integratorSuccessorSessionsByPredecessor: new Map(),
  integratorResultsByStartedAt: new Map(),
  integratorCandidateGitReadIntents: new Map(),
  integratorCandidateGitObservations: new Map(),
  integratorRunStarted: new Map(),
  integratorRunResults: new Map(),
  integratorRunCandidateGitReadIntents: new Map(),
  integratorRunCandidateGitObservations: new Map(),
  firstRestartChoiceAppliedAt: new Map(),
  targetPromotionHistory: makeTargetPromotionHistoryIndexes(),
  targetVerificationIntents: new Map(),
  targetVerificationTerminals: new Set()
})

const record = (position: number, event: JournalRecord["event"]): JournalRecord => ({
  event,
  key: JournalRecordKey.make(`promotion-history:${position}`),
  position: JournalPosition.make(position),
  runId
})

const validate = (historyIndexes: IntegrationHistoryIndexes, records: ReadonlyArray<JournalRecord>) => {
  const identityIssues: Array<string> = []
  const semanticIssues: Array<string> = []
  for (const [index, item] of records.entries()) {
    validateIntegrationHistoryRecord(
      item,
      runId,
      historyIndexes,
      (detail) => identityIssues.push(detail),
      (detail) => semanticIssues.push(detail),
      records.slice(0, index + 1)
    )
  }
  return { identityIssues, semanticIssues }
}

describe("integration evidence history", () => {
  const plannedAttempt = PlannedTaskAttempt.make({
    attemptId: candidate.correlation.attemptId,
    baseSha: GitCommitSha.make("1".repeat(40)),
    branch: TaskBranchRef.make("refs/heads/dalph/promotion-history-attempt"),
    executor: TaskExecutorLocator.make("executor:controlled-fake"),
    runId,
    taskId: TaskId.make("promotion-history-task"),
    taskRevision: TaskRevision.make("promotion-history-revision"),
    worktree: WorktreeLocator.make("/worktrees/promotion-history-attempt")
  })
  const acceptedResult = acceptedResultFixture(candidate.correlation.acceptedResultCommit)
  const startedAt = JournalPosition.make(9)
  const responsibilityBeganAt = JournalPosition.make(8)

  const seedIntegrationStart = (historyIndexes: IntegrationHistoryIndexes) =>
    historyIndexes.integrationStarted.set(
      startedAt,
      IntegrationStartedEvent.make({
        acceptedResult,
        integrationTarget: candidate.correlation.integrationTarget,
        plannedAttempt,
        responsibilityBeganAt,
        version: workflowJournalEventVersion
      })
    )

  const candidateIntent = (correlation: IntegrationCandidateCorrelation) =>
    IntegrationCandidateConstructionIntendedEvent.make({
      continuationLimit: CandidateContinuationLimit.make(2),
      correctionLimit: CandidateCorrectionLimit.make(2),
      correlation,
      plannedAttempt,
      responsibilityBeganAt,
      startedAt,
      version: workflowJournalEventVersion
    })

  it("accepts the exact accepted and submitted evidence through candidate construction", () => {
    const historyIndexes = indexes()
    seedIntegrationStart(historyIndexes)
    const submissionAt = JournalPosition.make(11)
    const gitObservationAt = JournalPosition.make(12)
    const result = validate(historyIndexes, [
      record(10, candidateIntent(candidate.correlation)),
      record(
        11,
        IntegrationCandidateAgentReportedEvent.make({
          expectedCorrelation: candidate.correlation,
          ordinal: IntegrationCandidateAgentReportOrdinal.make(1),
          report: IntegrationCandidateAgentReport.cases.Submitted.make({
            candidateCommit: candidate.candidateCommit,
            correlation: candidate.correlation,
            reviewManifest: candidate.reviewManifest
          }),
          version: workflowJournalEventVersion
        })
      ),
      record(
        12,
        IntegrationCandidateGitObservedEvent.make({
          candidateCommit: candidate.candidateCommit,
          correlation: candidate.correlation,
          observation: IntegrationCandidateGitObservation.cases.Commit.make({
            directParents: [candidate.correlation.expectedTargetHead, candidate.correlation.acceptedResultCommit]
          }),
          submissionAt,
          version: workflowJournalEventVersion
        })
      ),
      record(
        13,
        IntegrationCandidateConstructedEvent.make({
          candidateCommit: candidate.candidateCommit,
          correlation: candidate.correlation,
          gitObservationAt,
          reviewManifest: candidate.reviewManifest,
          version: workflowJournalEventVersion
        })
      )
    ])

    expect(result).toEqual({ identityIssues: [], semanticIssues: [] })
  })

  it("accepts one exact target-verification intent and genuine terminal, rejecting missing or repeated terminals", () => {
    const verification = targetVerificationCorrelationFor(candidate, TargetVerificationPlanId.make("history-boundary"))
    const intended = TargetVerificationIntendedEvent.make({
      correlation: verification,
      version: workflowJournalEventVersion
    })
    const sealed = TargetVerificationEvidenceSealedEvent.make({
      correlation: verification,
      manifest: candidate.reviewManifest,
      terminal: "Passed",
      version: workflowJournalEventVersion
    })
    const contradicted = TargetVerificationCorrelationContradictedEvent.make({
      expected: verification,
      received: TargetVerificationCorrelation.make({
        ...verification,
        candidateCommit: GitCommitSha.make("9".repeat(40))
      }),
      version: workflowJournalEventVersion
    })

    const validSealed = validate(indexes(), [record(12, intended), record(13, sealed)])
    expect(validSealed).toEqual({ identityIssues: [], semanticIssues: [] })

    const validContradiction = validate(indexes(), [record(12, intended), record(13, contradicted)])
    expect(validContradiction).toEqual({ identityIssues: [], semanticIssues: [] })

    const duplicateIntent = validate(indexes(), [record(12, intended), record(13, intended)])
    expect(duplicateIntent).toEqual({ identityIssues: [], semanticIssues: [] })

    const missingIntent = validate(indexes(), [record(13, sealed)])
    expect(missingIntent.semanticIssues).toEqual([expect.stringContaining("no one exact earlier intent")])

    const repeatedTerminal = validate(indexes(), [record(12, intended), record(13, sealed), record(14, sealed)])
    expect(repeatedTerminal.semanticIssues).toEqual([expect.stringContaining("no one exact earlier intent")])

    const nonGenuineContradiction = validate(indexes(), [
      record(12, intended),
      record(13, { ...contradicted, received: verification })
    ])
    expect(nonGenuineContradiction.semanticIssues).toEqual([expect.stringContaining("no one exact earlier intent")])
  })

  it("rejects a candidate intent that substitutes the accepted evidence byte length", () => {
    const historyIndexes = indexes()
    seedIntegrationStart(historyIndexes)
    const correlation = IntegrationCandidateCorrelation.make({
      ...candidate.correlation,
      acceptanceManifest: changedByteLength(acceptedResult.evidenceManifest)
    })
    const result = validate(historyIndexes, [record(10, candidateIntent(correlation))])

    expect(result.semanticIssues).toEqual([expect.stringContaining("no exact earlier integration start")])
  })

  it("rejects a constructed candidate that substitutes the submitted review evidence byte length", () => {
    const historyIndexes = indexes()
    const submissionAt = JournalPosition.make(9)
    const gitObservationAt = JournalPosition.make(10)
    historyIndexes.integrationCandidateSubmissions.set(
      submissionAt,
      IntegrationCandidateAgentReportedEvent.make({
        expectedCorrelation: candidate.correlation,
        ordinal: IntegrationCandidateAgentReportOrdinal.make(1),
        report: IntegrationCandidateAgentReport.cases.Submitted.make({
          candidateCommit: candidate.candidateCommit,
          correlation: candidate.correlation,
          reviewManifest: candidate.reviewManifest
        }),
        version: workflowJournalEventVersion
      })
    )
    historyIndexes.integrationCandidateGitObservations.set(
      gitObservationAt,
      IntegrationCandidateGitObservedEvent.make({
        candidateCommit: candidate.candidateCommit,
        correlation: candidate.correlation,
        observation: IntegrationCandidateGitObservation.cases.Commit.make({
          directParents: [candidate.correlation.expectedTargetHead, candidate.correlation.acceptedResultCommit]
        }),
        submissionAt,
        version: workflowJournalEventVersion
      })
    )
    const result = validate(historyIndexes, [
      record(
        11,
        IntegrationCandidateConstructedEvent.make({
          candidateCommit: candidate.candidateCommit,
          correlation: candidate.correlation,
          gitObservationAt,
          reviewManifest: changedByteLength(candidate.reviewManifest),
          version: workflowJournalEventVersion
        })
      )
    ])

    expect(result.semanticIssues).toEqual([expect.stringContaining("no exact Git observation")])
  })

  it("rejects two different successors for one prior candidate session", () => {
    const historyIndexes = indexes()
    seedIntegrationStart(historyIndexes)
    const successor = (suffix: string) =>
      IntegrationCandidateCorrelation.make({
        ...candidate.correlation,
        candidateId: IntegrationCandidateId.make(`promotion-history-successor-${suffix}`),
        candidateResource: IntegrationCandidateResourceLocator.make(`/candidate/promotion-history-successor-${suffix}`),
        expectedTargetHead: GitCommitSha.make("8".repeat(40)),
        integrationSessionId: IntegrationSessionId.make(`promotion-history-successor-session-${suffix}`)
      })
    const supersession = (correlation: IntegrationCandidateCorrelation, position: number) =>
      record(
        position,
        IntegrationCandidateSessionSupersededEvent.make({
          observedTargetHead: correlation.expectedTargetHead,
          priorCandidateCommit: candidate.candidateCommit,
          priorCorrelation: candidate.correlation,
          responsibilityBeganAt,
          startedAt,
          successorCorrelation: correlation,
          version: workflowJournalEventVersion
        })
      )

    const result = validate(historyIndexes, [
      record(10, candidateIntent(candidate.correlation)),
      supersession(successor("one"), 12),
      supersession(successor("two"), 13)
    ])

    expect(result.identityIssues).toEqual([])
    expect(result.semanticIssues).toEqual([expect.stringContaining("no exact earlier constructed candidate")])
    expect(historyIndexes.integrationCandidateSessionSupersessionsByPrior.size).toBe(1)
  })

  it("rejects supersession correlations that cross a resource, repository, result, or evidence boundary", () => {
    const successor = IntegrationCandidateCorrelation.make({
      ...candidate.correlation,
      candidateId: IntegrationCandidateId.make("supersession-boundary-successor"),
      candidateResource: IntegrationCandidateResourceLocator.make("/candidate/supersession-boundary-successor"),
      expectedTargetHead: GitCommitSha.make("8".repeat(40)),
      integrationSessionId: IntegrationSessionId.make("supersession-boundary-successor-session")
    })
    const supersession = (successorCorrelation: IntegrationCandidateCorrelation) =>
      IntegrationCandidateSessionSupersededEvent.make({
        observedTargetHead: successorCorrelation.expectedTargetHead,
        priorCandidateCommit: candidate.candidateCommit,
        priorCorrelation: candidate.correlation,
        responsibilityBeganAt: JournalPosition.make(8),
        startedAt: JournalPosition.make(9),
        successorCorrelation,
        version: workflowJournalEventVersion
      })

    expect(() => supersession({ ...successor, candidateResource: candidate.correlation.candidateResource })).toThrow()
    expect(() =>
      supersession({
        ...successor,
        integrationTarget: IntegrationTarget.make({
          ref: candidate.correlation.integrationTarget.ref,
          repository: GitRepositoryLocator.make("/repositories/another.git")
        })
      })
    ).toThrow()
    expect(() => supersession({ ...successor, acceptedResultCommit: GitCommitSha.make("9".repeat(40)) })).toThrow()
    expect(() =>
      supersession({ ...successor, acceptanceManifest: changedByteLength(successor.acceptanceManifest) })
    ).toThrow()
  })

  it("accepts correction and continuation limits only when their causal counts reach the bound", () => {
    const correctionIndexes = indexes()
    seedIntegrationStart(correctionIndexes)
    const correctionIntent = IntegrationCandidateConstructionIntendedEvent.make({
      ...candidateIntent(candidate.correlation),
      correctionLimit: CandidateCorrectionLimit.make(1)
    })
    const invalidObservation = (submissionAt: number) =>
      IntegrationCandidateGitObservedEvent.make({
        candidateCommit: candidate.candidateCommit,
        correlation: candidate.correlation,
        observation: IntegrationCandidateGitObservation.cases.Commit.make({
          directParents: [GitCommitSha.make("8".repeat(40)), GitCommitSha.make("9".repeat(40))]
        }),
        submissionAt: JournalPosition.make(submissionAt),
        version: workflowJournalEventVersion
      })
    const submitted = IntegrationCandidateAgentReportedEvent.make({
      expectedCorrelation: candidate.correlation,
      ordinal: IntegrationCandidateAgentReportOrdinal.make(1),
      report: IntegrationCandidateAgentReport.cases.Submitted.make({
        candidateCommit: candidate.candidateCommit,
        correlation: candidate.correlation,
        reviewManifest: candidate.reviewManifest
      }),
      version: workflowJournalEventVersion
    })
    const correction = IntegrationCandidateCorrectionLimitReachedEvent.make({
      correctionCount: 1,
      correctionLimit: CandidateCorrectionLimit.make(1),
      correlation: candidate.correlation,
      invalidObservationAt: JournalPosition.make(14),
      version: workflowJournalEventVersion
    })
    const correctionResult = validate(correctionIndexes, [
      record(10, correctionIntent),
      record(11, submitted),
      record(12, invalidObservation(11)),
      record(13, submitted),
      record(14, invalidObservation(13)),
      record(15, correction)
    ])
    expect(correctionResult).toEqual({ identityIssues: [], semanticIssues: [] })

    const continuationIndexes = indexes()
    seedIntegrationStart(continuationIndexes)
    const continuationIntent = IntegrationCandidateConstructionIntendedEvent.make({
      ...candidateIntent(candidate.correlation),
      continuationLimit: CandidateContinuationLimit.make(1)
    })
    const report = IntegrationCandidateAgentReportedEvent.make({
      expectedCorrelation: candidate.correlation,
      ordinal: IntegrationCandidateAgentReportOrdinal.make(1),
      report: IntegrationCandidateAgentReport.cases.Conflict.make({ correlation: candidate.correlation }),
      version: workflowJournalEventVersion
    })
    const continuation = IntegrationCandidateContinuationLimitReachedEvent.make({
      continuationCount: 1,
      continuationLimit: CandidateContinuationLimit.make(1),
      correlation: candidate.correlation,
      lastReportAt: JournalPosition.make(11),
      version: workflowJournalEventVersion
    })
    const continuationResult = validate(continuationIndexes, [
      record(10, continuationIntent),
      record(11, report),
      record(12, continuation)
    ])
    expect(continuationResult).toEqual({ identityIssues: [], semanticIssues: [] })
  })

  it("binds terminal candidate and verification events to the exact executor run", () => {
    const verification = targetVerificationCorrelationFor(candidate, TargetVerificationPlanId.make("plan-boundary"))
    const sealed = TargetVerificationEvidenceSealedEvent.make({
      correlation: verification,
      manifest: candidate.reviewManifest,
      terminal: "Passed",
      version: workflowJournalEventVersion
    })
    const contradicted = TargetVerificationCorrelationContradictedEvent.make({
      expected: verification,
      received: TargetVerificationCorrelation.make({
        ...verification,
        candidateCommit: GitCommitSha.make("9".repeat(40))
      }),
      version: workflowJournalEventVersion
    })
    expect(invalidIntegrationRunBinding(sealed, runId)).toBeUndefined()
    expect(invalidIntegrationRunBinding(contradicted, runId)).toBeUndefined()

    const foreignRunId = RunId.make("promotion-history-foreign-run")
    const foreignCandidateCorrelation = IntegrationCandidateCorrelation.make({
      ...candidate.correlation,
      runId: foreignRunId
    })
    const foreignVerification = TargetVerificationCorrelation.make({
      ...verification,
      candidateCorrelation: foreignCandidateCorrelation
    })
    const foreignSealed = TargetVerificationEvidenceSealedEvent.make({ ...sealed, correlation: foreignVerification })
    expect(invalidIntegrationRunBinding(foreignSealed, runId)).toContain("target verification binds run")

    const validationFailed = IntegrationCandidateGitValidationFailedEvent.make({
      attemptOrdinal: IntegrationCandidateGitValidationAttemptOrdinal.make(1),
      candidateCommit: candidate.candidateCommit,
      correlation: candidate.correlation,
      detail: "candidate object could not be read",
      submissionAt: JournalPosition.make(12),
      version: workflowJournalEventVersion
    })
    const correctionLimit = IntegrationCandidateCorrectionLimitReachedEvent.make({
      correctionCount: 1,
      correctionLimit: CandidateCorrectionLimit.make(1),
      correlation: candidate.correlation,
      invalidObservationAt: JournalPosition.make(12),
      version: workflowJournalEventVersion
    })
    const continuationLimit = IntegrationCandidateContinuationLimitReachedEvent.make({
      continuationCount: 1,
      continuationLimit: CandidateContinuationLimit.make(1),
      correlation: candidate.correlation,
      lastReportAt: JournalPosition.make(12),
      version: workflowJournalEventVersion
    })
    expect(invalidIntegrationRunBinding(validationFailed, runId)).toBeUndefined()
    expect(invalidIntegrationRunBinding(correctionLimit, runId)).toBeUndefined()
    expect(invalidIntegrationRunBinding(continuationLimit, runId)).toBeUndefined()
    expect(
      invalidIntegrationRunBinding({ ...validationFailed, correlation: foreignCandidateCorrelation }, runId)
    ).toContain("candidate event binds run")
  })
})

describe("outer Integrator history", () => {
  const integratorAcceptedResult = acceptedResultFixture(candidate.correlation.acceptedResultCommit)
  const integratorPlannedAttempt = PlannedTaskAttempt.make({
    attemptId: candidate.correlation.attemptId,
    baseSha: GitCommitSha.make("1".repeat(40)),
    branch: TaskBranchRef.make("refs/heads/dalph/integrator-history-attempt"),
    executor: TaskExecutorLocator.make("executor:controlled-fake"),
    runId,
    taskId: TaskId.make("integrator-history-task"),
    taskRevision: TaskRevision.make("integrator-history-revision"),
    worktree: WorktreeLocator.make("/worktrees/integrator-history-attempt")
  })
  const integratorResponsibilityBeganAt = JournalPosition.make(8)
  const integratorLineageAt = JournalPosition.make(7)
  const integratorStartedAt = JournalPosition.make(9)
  const integratorSessionAt = JournalPosition.make(10)
  const integratorResultAt = JournalPosition.make(11)
  const integratorGitIntentAt = JournalPosition.make(12)
  const integratorGitObservationAt = JournalPosition.make(13)
  const integratorCandidateText = IntegratorCandidateText.make("refs/heads/dalph/integrator-candidate")
  const integratorLineageOperationId = OperationId.make("integrator-history-lineage-read")
  const integratorLineageOperation = WorkflowOperation.cases.ReadTargetLineage.make({
    integrationTarget: candidate.correlation.integrationTarget,
    operationId: integratorLineageOperationId,
    plannedAttempt: integratorPlannedAttempt,
    predecessorOperationIds: []
  })
  const integratorLineageIntent = GitReadIntentRecordedEvent.make({
    initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
    occurrenceClassification: "InitiatedAction",
    operation: integratorLineageOperation,
    version: workflowJournalEventVersion
  })
  const integratorCorrelation = IntegratorCorrelation.make({
    acceptedResult: integratorAcceptedResult,
    candidateResource: IntegratorCandidateResourceLocator.make("resource:integrator-history"),
    expectedTargetHead: candidate.correlation.expectedTargetHead,
    integrationTarget: candidate.correlation.integrationTarget,
    plannedAttempt: integratorPlannedAttempt,
    queuedAt: integratorResponsibilityBeganAt,
    sessionId: IntegratorSessionId.make("session:integrator-history"),
    startedAt: integratorStartedAt,
    targetLineageObservedAt: integratorLineageAt
  })
  const integratorStarted = IntegrationStartedEvent.make({
    acceptedResult: integratorAcceptedResult,
    integrationTarget: candidate.correlation.integrationTarget,
    plannedAttempt: integratorPlannedAttempt,
    responsibilityBeganAt: integratorResponsibilityBeganAt,
    version: workflowJournalEventVersion
  })
  const integratorLineage = TargetLineageObservedEvent.make({
    observation: TargetLineageObservation.make({
      plannedBaseIsAncestorOfTargetHead: true,
      plannedBaseSha: integratorPlannedAttempt.baseSha,
      targetHeadSha: integratorCorrelation.expectedTargetHead
    }),
    occurrenceClassification: "NonActionOccurrence",
    operationId: integratorLineageOperationId,
    plannedAttempt: integratorPlannedAttempt,
    version: workflowJournalEventVersion
  })
  const integratorSession = IntegratorSessionFixedEvent.make({
    correlation: integratorCorrelation,
    version: workflowJournalEventVersion
  })
  const integratorResult = IntegratorResultRecordedEvent.make({
    result: IntegratorResult.cases.PreparedCandidate.make({
      candidateText: integratorCandidateText,
      correlation: integratorCorrelation
    }),
    version: workflowJournalEventVersion
  })
  const integratorGitIntent = IntegratorCandidateGitReadIntendedEvent.make({
    candidateText: integratorCandidateText,
    correlation: integratorCorrelation,
    version: workflowJournalEventVersion
  })

  const historyRecords = (observation: typeof IntegratorGitObservation.Type): ReadonlyArray<JournalRecord> => [
    record(JournalPosition.make(6), integratorLineageIntent),
    record(integratorLineageAt, integratorLineage),
    record(integratorSessionAt, integratorSession),
    record(integratorResultAt, integratorResult),
    record(integratorGitIntentAt, integratorGitIntent),
    record(
      integratorGitObservationAt,
      IntegratorCandidateGitObservedEvent.make({
        candidateText: integratorCandidateText,
        correlation: integratorCorrelation,
        observation,
        version: workflowJournalEventVersion
      })
    )
  ]

  it("rejects foreign run bindings at every outer-integrator boundary", () => {
    const foreignRunId = RunId.make("integrator-history-foreign-boundary-run")
    const foreignAttempt = PlannedTaskAttempt.make({ ...integratorPlannedAttempt, runId: foreignRunId })
    const foreignSession = IntegratorCorrelation.make({ ...integratorCorrelation, plannedAttempt: foreignAttempt })
    const foreignRun = IntegratorRunCorrelation.make({ ordinal: IntegratorRunOrdinal.make(1), session: foreignSession })
    const foreignCandidateCorrelation = IntegrationCandidateCorrelation.make({
      ...candidate.correlation,
      runId: foreignRunId
    })
    const verification = targetVerificationCorrelationFor(candidate, TargetVerificationPlanId.make("foreign-boundary"))
    const foreignVerification = TargetVerificationCorrelation.make({
      ...verification,
      candidateCorrelation: foreignCandidateCorrelation
    })
    const qualifiedCandidate = IntegratorRunQualifiedCandidate.make({
      candidateCommit: GitCommitSha.make("9".repeat(40)),
      candidateText: integratorCandidateText,
      directParents: [foreignRun.session.expectedTargetHead, foreignRun.session.acceptedResult.commit],
      qualifiedAt: JournalPosition.make(20),
      run: foreignRun
    })
    const foreignObservation = IntegratorGitObservation.cases.Missing.make({ candidateText: integratorCandidateText })
    const events: ReadonlyArray<JournalRecord["event"]> = [
      IntegrationResponsibilityBeganEvent.make({
        acceptedResult: integratorAcceptedResult,
        integrationTarget: integratorCorrelation.integrationTarget,
        plannedAttempt: foreignAttempt,
        version: workflowJournalEventVersion
      }),
      IntegrationStartedEvent.make({ ...integratorStarted, plannedAttempt: foreignAttempt }),
      TargetPromotionIntendedEvent.make({
        correlation: targetPromotionCorrelationFor(qualifiedCandidate),
        version: workflowJournalEventVersion
      }),
      TargetVerificationIntendedEvent.make({ correlation: foreignVerification, version: workflowJournalEventVersion }),
      TargetVerificationCorrelationContradictedEvent.make({
        expected: foreignVerification,
        received: verification,
        version: workflowJournalEventVersion
      }),
      IntegrationCandidateConstructionIntendedEvent.make({
        continuationLimit: CandidateContinuationLimit.make(2),
        correctionLimit: CandidateCorrectionLimit.make(2),
        correlation: candidate.correlation,
        plannedAttempt: foreignAttempt,
        responsibilityBeganAt: integratorResponsibilityBeganAt,
        startedAt: integratorStartedAt,
        version: workflowJournalEventVersion
      }),
      IntegrationCandidateAgentReportedEvent.make({
        expectedCorrelation: foreignCandidateCorrelation,
        ordinal: IntegrationCandidateAgentReportOrdinal.make(1),
        report: IntegrationCandidateAgentReport.cases.Conflict.make({ correlation: candidate.correlation }),
        version: workflowJournalEventVersion
      }),
      IntegratorSessionFixedEvent.make({ correlation: foreignSession, version: workflowJournalEventVersion }),
      IntegratorRunStartedEvent.make({ run: foreignRun, version: workflowJournalEventVersion }),
      IntegratorResultRecordedEvent.make({
        result: IntegratorResult.cases.PreparedCandidate.make({
          candidateText: integratorCandidateText,
          correlation: foreignSession
        }),
        version: workflowJournalEventVersion
      }),
      IntegratorRunResultRecordedEvent.make({
        result: IntegratorResult.cases.PreparedCandidate.make({
          candidateText: integratorCandidateText,
          correlation: foreignSession
        }),
        run: foreignRun,
        version: workflowJournalEventVersion
      }),
      IntegratorCandidateGitReadIntendedEvent.make({
        candidateText: integratorCandidateText,
        correlation: foreignSession,
        version: workflowJournalEventVersion
      }),
      IntegratorRunCandidateGitReadIntendedEvent.make({
        candidateText: integratorCandidateText,
        run: foreignRun,
        version: workflowJournalEventVersion
      }),
      IntegratorCandidateGitObservedEvent.make({
        candidateText: integratorCandidateText,
        correlation: foreignSession,
        observation: foreignObservation,
        version: workflowJournalEventVersion
      }),
      IntegratorRunCandidateGitObservedEvent.make({
        candidateText: integratorCandidateText,
        observation: foreignObservation,
        run: foreignRun,
        version: workflowJournalEventVersion
      }),
      IntegrationQuarantineDirectionAppliedEvent.make({
        fingerprint: IntegrationQuarantineDirectionFingerprint.make({
          direction: "Retry",
          quarantineAt: JournalPosition.make(30),
          sessionId: foreignSession.sessionId
        }),
        initiatedBy: { _tag: "Operator" },
        occurrenceClassification: "InitiatedAction",
        requestId: IntegrationQuarantineDirectionRequestId.make({ nonce: "foreign-run", runId: foreignRunId }),
        version: workflowJournalEventVersion
      })
    ]

    expect(events.map((event) => invalidIntegrationRunBinding(event, runId))).toEqual([
      "integration work for attempt promotion-history-attempt binds run integrator-history-foreign-boundary-run",
      "integration work for attempt promotion-history-attempt binds run integrator-history-foreign-boundary-run",
      "target promotion binds run integrator-history-foreign-boundary-run",
      "target verification binds run integrator-history-foreign-boundary-run",
      "target verification contradiction expectation binds a foreign run",
      "integration work for attempt promotion-history-attempt binds run integrator-history-foreign-boundary-run",
      "candidate report expectation binds run integrator-history-foreign-boundary-run",
      "Integrator session binds run integrator-history-foreign-boundary-run",
      "Integrator run start binds run integrator-history-foreign-boundary-run",
      "Integrator result binds run integrator-history-foreign-boundary-run",
      "Integrator run result binds run integrator-history-foreign-boundary-run",
      "Integrator candidate Git-read intent binds run integrator-history-foreign-boundary-run",
      "Integrator run candidate Git-read intent binds run integrator-history-foreign-boundary-run",
      "Integrator candidate Git observation binds run integrator-history-foreign-boundary-run",
      "Integrator run candidate Git observation binds run integrator-history-foreign-boundary-run",
      "integration quarantine direction binds run integrator-history-foreign-boundary-run"
    ])

    const validRun = IntegratorRunCorrelation.make({
      ordinal: IntegratorRunOrdinal.make(1),
      session: integratorCorrelation
    })
    const validQualifiedCandidate = IntegratorRunQualifiedCandidate.make({
      candidateCommit: GitCommitSha.make("9".repeat(40)),
      candidateText: integratorCandidateText,
      directParents: [validRun.session.expectedTargetHead, validRun.session.acceptedResult.commit],
      qualifiedAt: JournalPosition.make(20),
      run: validRun
    })
    const successorSession = IntegratorCorrelation.make({
      ...integratorCorrelation,
      candidateResource: IntegratorCandidateResourceLocator.make("resource:integrator-history-successor"),
      sessionId: IntegratorSessionId.make("session:integrator-history-successor"),
      targetLineageObservedAt: JournalPosition.make(16)
    })
    const successor = IntegratorSuccessorSessionFixedEvent.make({
      direction: "FullRerun",
      directionAppliedAt: JournalPosition.make(14),
      predecessor: integratorCorrelation,
      quarantineAt: JournalPosition.make(13),
      successor: successorSession,
      successorGeneration: 2,
      version: workflowJournalEventVersion
    })
    const candidateSuccessorCorrelation = IntegrationCandidateCorrelation.make({
      ...candidate.correlation,
      candidateId: IntegrationCandidateId.make("promotion-history-successor"),
      candidateResource: IntegrationCandidateResourceLocator.make("/candidate/promotion-history-successor"),
      integrationSessionId: IntegrationSessionId.make("promotion-history-successor-session")
    })
    const validEvents: ReadonlyArray<JournalRecord["event"]> = [
      IntegrationResponsibilityBeganEvent.make({
        acceptedResult: integratorAcceptedResult,
        integrationTarget: integratorCorrelation.integrationTarget,
        plannedAttempt: integratorPlannedAttempt,
        version: workflowJournalEventVersion
      }),
      integratorStarted,
      TargetPromotionIntendedEvent.make({
        correlation: targetPromotionCorrelationFor(validQualifiedCandidate),
        version: workflowJournalEventVersion
      }),
      TargetVerificationIntendedEvent.make({ correlation: verification, version: workflowJournalEventVersion }),
      TargetVerificationCorrelationContradictedEvent.make({
        expected: verification,
        received: verification,
        version: workflowJournalEventVersion
      }),
      IntegrationCandidateConstructionIntendedEvent.make({
        continuationLimit: CandidateContinuationLimit.make(2),
        correctionLimit: CandidateCorrectionLimit.make(2),
        correlation: candidate.correlation,
        plannedAttempt: integratorPlannedAttempt,
        responsibilityBeganAt: integratorResponsibilityBeganAt,
        startedAt: integratorStartedAt,
        version: workflowJournalEventVersion
      }),
      IntegrationCandidateSessionSupersededEvent.make({
        observedTargetHead: candidate.correlation.expectedTargetHead,
        priorCandidateCommit: candidate.candidateCommit,
        priorCorrelation: candidate.correlation,
        responsibilityBeganAt: integratorResponsibilityBeganAt,
        startedAt: integratorStartedAt,
        successorCorrelation: candidateSuccessorCorrelation,
        version: workflowJournalEventVersion
      }),
      IntegrationCandidateAgentReportedEvent.make({
        expectedCorrelation: candidate.correlation,
        ordinal: IntegrationCandidateAgentReportOrdinal.make(1),
        report: IntegrationCandidateAgentReport.cases.Conflict.make({ correlation: candidate.correlation }),
        version: workflowJournalEventVersion
      }),
      IntegratorSessionFixedEvent.make({ correlation: integratorCorrelation, version: workflowJournalEventVersion }),
      successor,
      IntegratorRunStartedEvent.make({ run: validRun, version: workflowJournalEventVersion }),
      IntegratorResultRecordedEvent.make({ result: integratorResult.result, version: workflowJournalEventVersion }),
      IntegratorRunResultRecordedEvent.make({
        result: integratorResult.result,
        run: validRun,
        version: workflowJournalEventVersion
      }),
      IntegratorCandidateGitReadIntendedEvent.make({
        candidateText: integratorCandidateText,
        correlation: integratorCorrelation,
        version: workflowJournalEventVersion
      }),
      IntegratorRunCandidateGitReadIntendedEvent.make({
        candidateText: integratorCandidateText,
        run: validRun,
        version: workflowJournalEventVersion
      }),
      IntegratorCandidateGitObservedEvent.make({
        candidateText: integratorCandidateText,
        correlation: integratorCorrelation,
        observation: foreignObservation,
        version: workflowJournalEventVersion
      }),
      IntegratorRunCandidateGitObservedEvent.make({
        candidateText: integratorCandidateText,
        observation: foreignObservation,
        run: validRun,
        version: workflowJournalEventVersion
      })
    ]
    expect(validEvents.every((event) => invalidIntegrationRunBinding(event, runId) === undefined)).toBe(true)
  })

  const seedStarted = (historyIndexes: IntegrationHistoryIndexes): void => {
    historyIndexes.integrationStarted.set(integratorStartedAt, integratorStarted)
  }

  it("accepts an exact session, result, Git intent, and any durable Git observation", () => {
    for (const observation of [
      IntegratorGitObservation.cases.Missing.make({ candidateText: integratorCandidateText }),
      IntegratorGitObservation.cases.NonCommit.make({ candidateText: integratorCandidateText, objectType: "tree" }),
      IntegratorGitObservation.cases.Commit.make({
        candidateText: integratorCandidateText,
        commit: GitCommitSha.make("5".repeat(40)),
        directParents: [GitCommitSha.make("6".repeat(40))]
      })
    ]) {
      const historyIndexes = indexes()
      seedStarted(historyIndexes)
      const result = validate(historyIndexes, historyRecords(observation))
      expect(result).toEqual({ identityIssues: [], semanticIssues: [] })
    }
  })

  it("indexes the exact earlier target lineage and rejects a session with missing lineage", () => {
    const historyIndexes = indexes()
    seedStarted(historyIndexes)
    const result = validate(historyIndexes, [record(integratorSessionAt, integratorSession)])

    expect(result.semanticIssues).toEqual([expect.stringContaining(`TargetLineageObserved at ${integratorLineageAt}`)])
  })

  it("rejects a session when its predecessor facts or session position are not exact", () => {
    const changedBaseAttempt = PlannedTaskAttempt.make({
      ...integratorPlannedAttempt,
      baseSha: GitCommitSha.make("7".repeat(40))
    })
    const cases = [
      {
        expected: "IntegrationStarted",
        event: IntegratorSessionFixedEvent.make({
          correlation: IntegratorCorrelation.make({ ...integratorCorrelation, plannedAttempt: changedBaseAttempt }),
          version: workflowJournalEventVersion
        })
      },
      {
        expected: "TargetLineageObserved",
        event: IntegratorSessionFixedEvent.make({
          correlation: IntegratorCorrelation.make({
            ...integratorCorrelation,
            expectedTargetHead: GitCommitSha.make("8".repeat(40))
          }),
          version: workflowJournalEventVersion
        })
      },
      {
        expected: "TargetLineageObserved",
        event: IntegratorSessionFixedEvent.make({
          correlation: integratorCorrelation,
          version: workflowJournalEventVersion
        }),
        lineage: TargetLineageObservedEvent.make({
          ...integratorLineage,
          observation: TargetLineageObservation.make({
            plannedBaseIsAncestorOfTargetHead: false,
            plannedBaseSha: integratorPlannedAttempt.baseSha,
            targetHeadSha: integratorCorrelation.expectedTargetHead
          })
        })
      },
      {
        expected: "TargetLineageObserved",
        event: IntegratorSessionFixedEvent.make({
          correlation: IntegratorCorrelation.make({
            ...integratorCorrelation,
            targetLineageObservedAt: integratorSessionAt
          }),
          version: workflowJournalEventVersion
        }),
        lineage: integratorLineage,
        lineageAt: integratorSessionAt,
        sessionAt: integratorSessionAt
      }
    ]

    for (const item of cases) {
      const historyIndexes = indexes()
      seedStarted(historyIndexes)
      const lineage = item.lineage ?? integratorLineage
      const lineageAt = item.lineageAt ?? integratorLineageAt
      const sessionAt = item.sessionAt ?? integratorSessionAt
      const result = validate(historyIndexes, [record(lineageAt, lineage), record(sessionAt, item.event)])
      expect(result.semanticIssues).toEqual([expect.stringContaining(item.expected)])
    }
  })

  it("rejects a session when the earlier lineage read intent names a foreign target", () => {
    const foreignOperation = WorkflowOperation.cases.ReadTargetLineage.make({
      integrationTarget: IntegrationTarget.make({
        ref: candidate.correlation.integrationTarget.ref,
        repository: GitRepositoryLocator.make("/repositories/foreign-integrator-history.git")
      }),
      operationId: integratorLineageOperationId,
      plannedAttempt: integratorPlannedAttempt,
      predecessorOperationIds: []
    })
    const historyIndexes = indexes()
    seedStarted(historyIndexes)
    const result = validate(historyIndexes, [
      record(
        JournalPosition.make(6),
        GitReadIntentRecordedEvent.make({
          initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
          occurrenceClassification: "InitiatedAction",
          operation: foreignOperation,
          version: workflowJournalEventVersion
        })
      ),
      record(integratorLineageAt, integratorLineage),
      record(integratorSessionAt, integratorSession)
    ])

    expect(result.semanticIssues).toEqual([expect.stringContaining(`TargetLineageObserved at ${integratorLineageAt}`)])
  })

  it("rejects session identity reuse and one responsibility starting two sessions", () => {
    const historyIndexes = indexes()
    seedStarted(historyIndexes)
    const first = validate(historyIndexes, [
      record(JournalPosition.make(6), integratorLineageIntent),
      record(integratorLineageAt, integratorLineage),
      record(integratorSessionAt, integratorSession)
    ])
    const second = validate(historyIndexes, [
      record(
        JournalPosition.make(14),
        IntegratorSessionFixedEvent.make({
          correlation: IntegratorCorrelation.make({
            ...integratorCorrelation,
            candidateResource: IntegratorCandidateResourceLocator.make("resource:other"),
            sessionId: IntegratorSessionId.make("session:other")
          }),
          version: workflowJournalEventVersion
        })
      )
    ])

    expect(first).toEqual({ identityIssues: [], semanticIssues: [] })
    expect(second.semanticIssues).toEqual([expect.stringContaining("reuses a responsibility")])
  })

  it("rejects a result without its exact earlier session and a second result", () => {
    const historyIndexes = indexes()
    seedStarted(historyIndexes)
    const missingSession = validate(historyIndexes, [record(integratorResultAt, integratorResult)])
    expect(missingSession.semanticIssues).toEqual([expect.stringContaining("no exact earlier fixed session")])

    const validIndexes = indexes()
    seedStarted(validIndexes)
    const first = validate(validIndexes, [
      record(JournalPosition.make(6), integratorLineageIntent),
      record(integratorLineageAt, integratorLineage),
      record(integratorSessionAt, integratorSession),
      record(integratorResultAt, integratorResult)
    ])
    const second = validate(validIndexes, [record(JournalPosition.make(14), integratorResult)])
    expect(first).toEqual({ identityIssues: [], semanticIssues: [] })
    expect(second.semanticIssues).toEqual([expect.stringContaining("repeats the exact session")])
  })

  it("requires a PreparedCandidate result and exact candidate text before a Git-read intent", () => {
    const historyIndexes = indexes()
    seedStarted(historyIndexes)
    const result = validate(historyIndexes, [
      record(JournalPosition.make(6), integratorLineageIntent),
      record(integratorLineageAt, integratorLineage),
      record(integratorSessionAt, integratorSession),
      record(
        integratorResultAt,
        IntegratorResultRecordedEvent.make({
          result: IntegratorResult.cases.NotPrepared.make({
            correlation: integratorCorrelation,
            detail: IntegratorNotPreparedDetail.make("not ready")
          }),
          version: workflowJournalEventVersion
        })
      ),
      record(integratorGitIntentAt, integratorGitIntent)
    ])

    expect(result.semanticIssues).toEqual([expect.stringContaining("no exact earlier PreparedCandidate result")])
  })

  it("requires an exact earlier Git-read intent and matching observation text", () => {
    const historyIndexes = indexes()
    seedStarted(historyIndexes)
    const result = validate(historyIndexes, [
      record(JournalPosition.make(6), integratorLineageIntent),
      record(integratorLineageAt, integratorLineage),
      record(integratorSessionAt, integratorSession),
      record(integratorResultAt, integratorResult),
      record(
        integratorGitObservationAt,
        IntegratorCandidateGitObservedEvent.make({
          candidateText: integratorCandidateText,
          correlation: integratorCorrelation,
          observation: IntegratorGitObservation.cases.Missing.make({
            candidateText: IntegratorCandidateText.make("refs/heads/other")
          }),
          version: workflowJournalEventVersion
        })
      )
    ])

    expect(result.semanticIssues).toEqual([
      expect.stringContaining("no exact earlier intent, result, and candidate text")
    ])
  })

  it("rejects standalone provider-activity absence without its exact run history", () => {
    const providerRun = IntegratorRunCorrelation.make({
      ordinal: IntegratorRunOrdinal.make(1),
      session: integratorCorrelation
    })
    const result = validate(indexes(), [
      record(
        JournalPosition.make(20),
        IntegrationProviderRunActivityAbsentEvent.make({
          correlation: integratorCorrelation,
          detail: IntegrationQuarantineFailureDetail.make("provider activity absent"),
          occurrenceClassification: "NonActionOccurrence",
          run: providerRun,
          version: workflowJournalEventVersion
        })
      )
    ])

    expect(result.semanticIssues).toEqual([
      expect.stringContaining("provider-activity absence is not justified by exact earlier history")
    ])

    const foreignSession = IntegratorCorrelation.make({
      ...integratorCorrelation,
      plannedAttempt: PlannedTaskAttempt.make({
        ...integratorCorrelation.plannedAttempt,
        runId: RunId.make("foreign-provider-absence-run")
      })
    })
    const foreign = validate(indexes(), [
      record(
        JournalPosition.make(21),
        IntegrationProviderRunActivityAbsentEvent.make({
          correlation: foreignSession,
          detail: IntegrationQuarantineFailureDetail.make("foreign provider activity absent"),
          occurrenceClassification: "NonActionOccurrence",
          run: IntegratorRunCorrelation.make({ ordinal: IntegratorRunOrdinal.make(1), session: foreignSession }),
          version: workflowJournalEventVersion
        })
      )
    ])
    expect(foreign.identityIssues).toEqual([expect.stringContaining("provider-activity absence binds run")])
  })
})
