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
  IntegrationCandidateConstructionIntendedEvent,
  IntegrationCandidateConstructedEvent,
  IntegrationCandidateCorrelation,
  IntegrationCandidateGitObservation,
  IntegrationCandidateGitObservedEvent,
  IntegrationCandidateId,
  IntegrationCandidateResourceLocator,
  IntegrationSessionId,
  type ConstructedIntegrationCandidateOccurrence
} from "../../workflow/protocols/integration-candidate-construction/events.js"
import { IntegrationStartedEvent } from "../../workflow/protocols/integration-admission/events.js"
import { EvidenceDigest, EvidenceReference } from "../../workflow/protocols/target-verification/evidence-store.js"
import {
  TargetVerificationEvidenceSealedEvent,
  TargetVerificationIntendedEvent,
  TargetVerificationPlanId,
  targetVerificationCorrelationFor
} from "../../workflow/protocols/target-verification/events.js"
import {
  TargetPromotionAttemptIntendedEvent,
  TargetPromotionAttemptOrdinal,
  TargetPromotionAttemptReason,
  TargetPromotionCorrelation,
  TargetPromotionIntendedEvent,
  TargetPromotionNonConvergenceEvent,
  TargetPromotionNonConvergenceObservation,
  TargetPromotionObservedSuccessEvent,
  TargetPromotionSuccessObservation,
  TargetPromotionTerminalBasis,
  targetPromotionRequestFor
} from "../../workflow/protocols/target-promotion/events.js"
import { type IntegrationHistoryIndexes, validateIntegrationHistoryRecord } from "./integration-history.js"
import { describeJournalEvent } from "../../workflow/registry/event-descriptor.js"
import { makeTargetPromotionHistoryIndexes } from "./target-promotion-history.js"
import {
  targetPromotionAttemptIntentRecordKey,
  targetPromotionIntentRecordKey,
  targetPromotionNonConvergenceRecordKey
} from "../../workflow-journal/record-key.js"

const runId = RunId.make("promotion-history-run")
const candidate: ConstructedIntegrationCandidateOccurrence = {
  candidateCommit: GitCommitSha.make("4".repeat(40)),
  constructedAt: JournalPosition.make(11),
  correlation: {
    acceptanceManifest: evidenceReferenceFixture,
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
const verificationCorrelation = targetVerificationCorrelationFor(
  candidate,
  TargetVerificationPlanId.make("promotion-history-plan")
)
const manifest = EvidenceReference.make({ byteLength: 42, digest: EvidenceDigest.make("a".repeat(64)) })
const changedByteLength = (reference: EvidenceReference): EvidenceReference =>
  EvidenceReference.make({ byteLength: reference.byteLength + 1, digest: reference.digest })
const promotionCorrelation = targetPromotionRequestFor(candidate, { correlation: verificationCorrelation, manifest })
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
  integrationCandidateSubmissions: new Map(),
  integrationCandidatesConstructed: new Map([[candidate.constructedAt, constructed]]),
  integrationResponsibilitiesBegan: new Map(),
  integrationStarted: new Map(),
  restartChoicesAppliedAt: new Map(),
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
  for (const item of records) {
    validateIntegrationHistoryRecord(
      item,
      runId,
      historyIndexes,
      (detail) => identityIssues.push(detail),
      (detail) => semanticIssues.push(detail)
    )
  }
  return { identityIssues, semanticIssues }
}

const verificationRecords = (): ReadonlyArray<JournalRecord> => [
  record(
    12,
    TargetVerificationIntendedEvent.make({ correlation: verificationCorrelation, version: workflowJournalEventVersion })
  ),
  record(
    13,
    TargetVerificationEvidenceSealedEvent.make({
      correlation: verificationCorrelation,
      manifest,
      terminal: "Passed",
      version: workflowJournalEventVersion
    })
  )
]

const intentRecord = record(
  14,
  TargetPromotionIntendedEvent.make({ correlation: promotionCorrelation, version: workflowJournalEventVersion })
)
const attempt = (ordinal: number, position: number) =>
  record(
    position,
    TargetPromotionAttemptIntendedEvent.make({
      attemptOrdinal: TargetPromotionAttemptOrdinal.make(ordinal),
      correlation: promotionCorrelation,
      reason:
        ordinal === 1
          ? TargetPromotionAttemptReason.cases.Initial.make({
              observedHeadSha: promotionCorrelation.expectedTargetHead
            })
          : TargetPromotionAttemptReason.cases.ReconciledExpectedHead.make({
              observedHeadSha: promotionCorrelation.expectedTargetHead,
              previousAttemptOrdinal: TargetPromotionAttemptOrdinal.make(ordinal - 1)
            }),
      version: workflowJournalEventVersion
    })
  )

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
})

describe("target promotion history", () => {
  it("assigns stable registry keys to promotion chronology", () => {
    const intended = intentRecord.event
    const attempted = attempt(1, 15).event
    const nonConvergent = TargetPromotionNonConvergenceEvent.make({
      attemptLimit: 3,
      attemptOrdinal: TargetPromotionAttemptOrdinal.make(3),
      correlation: promotionCorrelation,
      lastObservation: TargetPromotionNonConvergenceObservation.cases.TargetReadFailed.make({ detail: "unreadable" }),
      version: workflowJournalEventVersion
    })

    expect(describeJournalEvent(intended).expectedKey).toBe(
      targetPromotionIntentRecordKey(promotionCorrelation.requestId)
    )
    expect(describeJournalEvent(attempted).expectedKey).toBe(
      targetPromotionAttemptIntentRecordKey(promotionCorrelation.requestId, TargetPromotionAttemptOrdinal.make(1))
    )
    expect(describeJournalEvent(nonConvergent).expectedKey).toBe(
      targetPromotionNonConvergenceRecordKey(promotionCorrelation.requestId)
    )
  })

  it("accepts exact Passed evidence, three sequential attempts, and terminal non-convergence", () => {
    const result = validate(indexes(), [
      ...verificationRecords(),
      intentRecord,
      attempt(1, 15),
      attempt(2, 16),
      attempt(3, 17),
      record(
        18,
        TargetPromotionNonConvergenceEvent.make({
          attemptLimit: 3,
          attemptOrdinal: TargetPromotionAttemptOrdinal.make(3),
          correlation: promotionCorrelation,
          lastObservation: TargetPromotionNonConvergenceObservation.cases.ExpectedHeadStillObserved.make({
            observedHeadSha: promotionCorrelation.expectedTargetHead
          }),
          version: workflowJournalEventVersion
        })
      )
    ])

    expect(result).toEqual({ identityIssues: [], semanticIssues: [] })
  })

  it("accepts a reconciliation terminal before the first compare-and-set attempt", () => {
    const result = validate(indexes(), [
      ...verificationRecords(),
      intentRecord,
      record(
        15,
        TargetPromotionObservedSuccessEvent.make({
          basis: TargetPromotionTerminalBasis.cases.BeforeFirstAttempt.make({}),
          correlation: promotionCorrelation,
          observation: TargetPromotionSuccessObservation.cases.ReconciledCandidateCurrent.make({
            candidateAncestry: "Current",
            targetHeadSha: promotionCorrelation.candidateCommit
          }),
          version: workflowJournalEventVersion
        })
      )
    ])

    expect(result).toEqual({ identityIssues: [], semanticIssues: [] })
  })

  it("accepts a reconciliation that finds the candidate in the current head's ancestry", () => {
    const result = validate(indexes(), [
      ...verificationRecords(),
      intentRecord,
      record(
        15,
        TargetPromotionObservedSuccessEvent.make({
          basis: TargetPromotionTerminalBasis.cases.BeforeFirstAttempt.make({}),
          correlation: promotionCorrelation,
          observation: TargetPromotionSuccessObservation.cases.ReconciledCandidateAncestor.make({
            candidateAncestry: "Ancestor",
            targetHeadSha: GitCommitSha.make("5".repeat(40))
          }),
          version: workflowJournalEventVersion
        })
      )
    ])

    expect(result).toEqual({ identityIssues: [], semanticIssues: [] })
  })

  it("rejects promotion without the exact earlier sealed Passed verification", () => {
    const result = validate(indexes(), [intentRecord])

    expect(result.semanticIssues).toEqual([
      expect.stringContaining("no exact constructed candidate and earlier sealed Passed verification")
    ])
  })

  it("rejects a promotion that substitutes the constructed review evidence byte length", () => {
    const substituted = TargetPromotionCorrelation.make({
      ...promotionCorrelation,
      reviewManifest: changedByteLength(candidate.reviewManifest)
    })
    const result = validate(indexes(), [
      ...verificationRecords(),
      record(14, TargetPromotionIntendedEvent.make({ correlation: substituted, version: workflowJournalEventVersion }))
    ])

    expect(result.semanticIssues).toEqual([
      expect.stringContaining("no exact constructed candidate and earlier sealed Passed verification")
    ])
  })

  it("rejects promotion correlation bound to another run", () => {
    const foreignRunId = RunId.make("another-promotion-run")
    const foreignCandidate = { ...candidate, correlation: { ...candidate.correlation, runId: foreignRunId } }
    const foreignCorrelation = targetPromotionRequestFor(foreignCandidate, {
      correlation: targetVerificationCorrelationFor(
        foreignCandidate,
        TargetVerificationPlanId.make("promotion-history-plan")
      ),
      manifest
    })
    const result = validate(indexes(), [
      record(
        14,
        TargetPromotionIntendedEvent.make({ correlation: foreignCorrelation, version: workflowJournalEventVersion })
      )
    ])

    expect(result.identityIssues).toEqual([expect.stringContaining("binds run another-promotion-run")])
  })

  it("rejects skipped and fourth compare-and-set attempt ordinals", () => {
    const historyIndexes = indexes()
    const result = validate(historyIndexes, [
      ...verificationRecords(),
      intentRecord,
      attempt(1, 15),
      attempt(3, 16),
      attempt(4, 17)
    ])

    expect(result.semanticIssues).toHaveLength(2)
    expect(result.semanticIssues[0]).toContain("expected exact sequential ordinal 2")
    expect(result.semanticIssues[1]).toContain("at or below 3")
  })

  it("rejects a terminal that does not reference the latest attempt and rejects a second terminal", () => {
    const historyIndexes = indexes()
    const success = (position: number, ordinal: number) =>
      record(
        position,
        TargetPromotionObservedSuccessEvent.make({
          basis: TargetPromotionTerminalBasis.cases.AfterAttempt.make({
            attemptOrdinal: TargetPromotionAttemptOrdinal.make(ordinal)
          }),
          correlation: promotionCorrelation,
          observation: TargetPromotionSuccessObservation.cases.ReconciledCandidateCurrent.make({
            candidateAncestry: "Current",
            targetHeadSha: promotionCorrelation.candidateCommit
          }),
          version: workflowJournalEventVersion
        })
      )
    const result = validate(historyIndexes, [
      ...verificationRecords(),
      intentRecord,
      attempt(1, 15),
      attempt(2, 16),
      success(17, 1),
      success(18, 2)
    ])

    expect(result.semanticIssues).toHaveLength(2)
    expect(result.semanticIssues.every((issue) => issue.includes("no exact latest unresolved attempt"))).toBe(true)
  })
})
