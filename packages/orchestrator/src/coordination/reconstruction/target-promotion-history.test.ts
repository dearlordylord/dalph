import { it } from "@effect/vitest"
import { expect } from "vitest"
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
import { acceptedResultFixture } from "../../../test/support/evidence.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { integratorCandidateRecordKeyPrefix } from "../../workflow-journal/record-key.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import {
  IntegratorCandidateResourceLocator,
  IntegratorCandidateText,
  IntegratorCandidateGitObservedEvent,
  IntegratorGitObservation,
  IntegratorQualifiedCandidate,
  IntegratorSessionId
} from "../../workflow/protocols/integrator/events.js"
import {
  TargetPromotionAttemptIntendedEvent,
  TargetPromotionAttemptOrdinal,
  TargetPromotionAttemptReason,
  TargetPromotionIntendedEvent,
  TargetPromotionTerminalBasis,
  targetPromotionCorrelationFor,
  TargetPromotionObservedSuccessEvent,
  TargetPromotionSuccessObservation
} from "../../workflow/protocols/target-promotion/events.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import { invalidTargetPromotionHistory, makeTargetPromotionHistoryIndexes } from "./target-promotion-history.js"

const runId = RunId.make("promotion-history-run")
const target = IntegrationTarget.make({
  repository: GitRepositoryLocator.make("/repositories/promotion-history.git"),
  ref: IntegrationTargetRef.make("refs/heads/main")
})
const expectedHead = GitCommitSha.make("a".repeat(40))
const acceptedCommit = GitCommitSha.make("b".repeat(40))
const candidateCommit = GitCommitSha.make("c".repeat(40))
const candidateText = IntegratorCandidateText.make("refs/candidates/promotion-history")
const qualifiedCandidate = IntegratorQualifiedCandidate.make({
  candidateCommit,
  candidateText,
  correlation: {
    acceptedResult: acceptedResultFixture(acceptedCommit),
    candidateResource: IntegratorCandidateResourceLocator.make("resource:promotion-history"),
    expectedTargetHead: expectedHead,
    integrationTarget: target,
    plannedAttempt: PlannedTaskAttempt.make({
      attemptId: AttemptId.make("promotion-history-attempt"),
      baseSha: expectedHead,
      branch: TaskBranchRef.make("refs/heads/dalph/promotion-history"),
      executor: TaskExecutorLocator.make("executor:promotion-history"),
      runId,
      taskId: TaskId.make("promotion-history-task"),
      taskRevision: TaskRevision.make("promotion-history-revision"),
      worktree: WorktreeLocator.make("/worktrees/promotion-history")
    }),
    queuedAt: JournalPosition.make(3),
    sessionId: IntegratorSessionId.make("session:promotion-history"),
    startedAt: JournalPosition.make(4),
    targetLineageObservedAt: JournalPosition.make(2)
  },
  directParents: [expectedHead, acceptedCommit],
  qualifiedAt: JournalPosition.make(5)
})
const correlation = targetPromotionCorrelationFor(qualifiedCandidate)

const qualification = IntegratorCandidateGitObservedEvent.make({
  candidateText,
  correlation: qualifiedCandidate.correlation,
  observation: IntegratorGitObservation.cases.Commit.make({
    candidateText,
    commit: candidateCommit,
    directParents: [expectedHead, acceptedCommit]
  }),
  version: workflowJournalEventVersion
})

const integratorObservations = new Map([
  [
    integratorCandidateRecordKeyPrefix(qualifiedCandidate.correlation, candidateText),
    { event: qualification, position: qualifiedCandidate.qualifiedAt }
  ]
])

const promotionRecord = (position: number, event: JournalRecord["event"]): JournalRecord => ({
  event,
  key: `${event._tag}:${position}` as JournalRecord["key"],
  position: JournalPosition.make(position),
  runId
})

it("accepts promotion intent only after the exact Integrator Git qualification", () => {
  const indexes = makeTargetPromotionHistoryIndexes()
  const intent = TargetPromotionIntendedEvent.make({ correlation, version: workflowJournalEventVersion })
  expect(invalidTargetPromotionHistory(promotionRecord(6, intent), indexes, integratorObservations)).toBeUndefined()
})

it("rejects promotion intent with no earlier Integrator Git result", () => {
  const indexes = makeTargetPromotionHistoryIndexes()
  const intent = TargetPromotionIntendedEvent.make({ correlation, version: workflowJournalEventVersion })
  expect(invalidTargetPromotionHistory(promotionRecord(6, intent), indexes, new Map())).toContain(
    "Integrator Git qualification"
  )
})

it("requires numbered attempts and terminal proof to follow the same outer request", () => {
  const indexes = makeTargetPromotionHistoryIndexes()
  const intent = TargetPromotionIntendedEvent.make({ correlation, version: workflowJournalEventVersion })
  const attempt = TargetPromotionAttemptIntendedEvent.make({
    attemptOrdinal: TargetPromotionAttemptOrdinal.make(1),
    correlation,
    reason: TargetPromotionAttemptReason.cases.Initial.make({ observedHeadSha: expectedHead }),
    version: workflowJournalEventVersion
  })
  const success = TargetPromotionObservedSuccessEvent.make({
    basis: TargetPromotionTerminalBasis.cases.AfterAttempt.make({
      attemptOrdinal: TargetPromotionAttemptOrdinal.make(1)
    }),
    correlation,
    observation: TargetPromotionSuccessObservation.cases.CompareAndSetApplied.make({
      candidateAncestry: "Current",
      targetHeadSha: candidateCommit
    }),
    version: workflowJournalEventVersion
  })
  expect(invalidTargetPromotionHistory(promotionRecord(6, intent), indexes, integratorObservations)).toBeUndefined()
  expect(invalidTargetPromotionHistory(promotionRecord(7, attempt), indexes, integratorObservations)).toBeUndefined()
  expect(invalidTargetPromotionHistory(promotionRecord(8, success), indexes, integratorObservations)).toBeUndefined()
})
