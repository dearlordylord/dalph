import { acceptedResultFixture } from "../../../test/support/evidence.js"
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
import { expect, it } from "vitest"
import { JournalPosition, JournalRecordKey } from "../../workflow-journal/identity.js"
import { JournalRecord } from "../../workflow-journal/store.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import {
  CandidateContinuationLimit,
  CandidateCorrectionLimit,
  IntegrationCandidateAgentReportedEvent,
  IntegrationCandidateAgentReportOrdinal,
  IntegrationCandidateConstructionIntendedEvent,
  IntegrationCandidateAgentReport
} from "../../workflow/protocols/integration-candidate-construction/events.js"
import {
  IntegrationCandidateId,
  IntegrationCandidateResourceLocator,
  IntegrationSessionId
} from "../../workflow/protocols/integration-candidate-construction/protocol.js"
import { StartedIntegrationResponsibility } from "../../workflow/protocols/integration-admission/protocol.js"
import { acceptedCandidateProgressAt } from "./integration-candidate-progress.js"

const runId = RunId.make("candidate-progress-run")
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("candidate-progress-attempt"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/candidate-progress"),
  executor: TaskExecutorLocator.make("executor:candidate-progress"),
  runId,
  taskId: TaskId.make("candidate-progress-task"),
  taskRevision: TaskRevision.make("candidate-progress-revision"),
  worktree: WorktreeLocator.make("/worktrees/candidate-progress")
})
const integrationTarget = IntegrationTarget.make({
  repository: GitRepositoryLocator.make("/repositories/candidate-progress.git"),
  ref: IntegrationTargetRef.make("refs/heads/main")
})
const acceptedResult = acceptedResultFixture(GitCommitSha.make("2".repeat(40)))
const responsibility = StartedIntegrationResponsibility.make({
  acceptedResult,
  integrationTarget,
  plannedAttempt,
  queuedAt: JournalPosition.make(8),
  startedAt: JournalPosition.make(9)
})
const correlation = {
  acceptanceManifest: acceptedResult.evidenceManifest,
  acceptedResultCommit: acceptedResult.commit,
  attemptId: plannedAttempt.attemptId,
  candidateId: IntegrationCandidateId.make("candidate-progress-id"),
  candidateResource: IntegrationCandidateResourceLocator.make("candidate-resource:candidate-progress"),
  expectedTargetHead: GitCommitSha.make("3".repeat(40)),
  integrationSessionId: IntegrationSessionId.make("candidate-progress-session"),
  integrationTarget,
  runId
}
const record = (position: number, event: JournalRecord["event"]): JournalRecord =>
  JournalRecord.make({
    event,
    key: JournalRecordKey.make(`candidate-progress:${position}`),
    position: JournalPosition.make(position),
    runId
  })
const intent = record(
  10,
  IntegrationCandidateConstructionIntendedEvent.make({
    continuationLimit: CandidateContinuationLimit.make(2),
    correctionLimit: CandidateCorrectionLimit.make(1),
    correlation,
    plannedAttempt,
    responsibilityBeganAt: responsibility.queuedAt,
    startedAt: responsibility.startedAt,
    version: workflowJournalEventVersion
  })
)

it("advances accepted candidate progress only after a later exactly correlated event", () => {
  expect(acceptedCandidateProgressAt([intent], responsibility)).toBeNull()

  const foreignCorrelation = {
    ...correlation,
    integrationSessionId: IntegrationSessionId.make("foreign-candidate-progress-session")
  }
  const foreign = record(
    11,
    IntegrationCandidateAgentReportedEvent.make({
      expectedCorrelation: foreignCorrelation,
      ordinal: IntegrationCandidateAgentReportOrdinal.make(1),
      report: IntegrationCandidateAgentReport.cases.Working.make({ correlation: foreignCorrelation }),
      version: workflowJournalEventVersion
    })
  )
  expect(acceptedCandidateProgressAt([intent, foreign], responsibility)).toBeNull()

  const exact = record(
    12,
    IntegrationCandidateAgentReportedEvent.make({
      expectedCorrelation: correlation,
      ordinal: IntegrationCandidateAgentReportOrdinal.make(1),
      report: IntegrationCandidateAgentReport.cases.Working.make({ correlation }),
      version: workflowJournalEventVersion
    })
  )
  expect(acceptedCandidateProgressAt([intent, foreign, exact], responsibility)).toBe(JournalPosition.make(12))
})
