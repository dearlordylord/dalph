import { it } from "@effect/vitest"
import { expect } from "vitest"
import { HashMap } from "effect"
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
import { integratorRunCandidateRecordKeyPrefix } from "../../workflow-journal/record-key.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import {
  IntegratorCandidateResourceLocator,
  IntegratorCandidateText,
  IntegratorRunCandidateGitObservedEvent,
  IntegratorGitObservation,
  IntegratorRunOrdinal,
  IntegratorRunQualifiedCandidate,
  IntegratorSessionId
} from "../../workflow/protocols/integrator/events.js"
import {
  TargetPromotionAttemptIntendedEvent,
  TargetPromotionAttemptOrdinal,
  TargetPromotionAttemptReason,
  TargetPromotionIntendedEvent,
  TargetPromotionNonConvergenceEvent,
  TargetPromotionNonConvergenceObservation,
  TargetPromotionStaleEvent,
  TargetPromotionStaleObservation,
  TargetPromotionTerminalBasis,
  targetPromotionAttemptLimit,
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
const qualifiedCandidate = IntegratorRunQualifiedCandidate.make({
  candidateCommit,
  candidateText,
  run: {
    ordinal: IntegratorRunOrdinal.make(2),
    session: {
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
    }
  },
  directParents: [expectedHead, acceptedCommit],
  qualifiedAt: JournalPosition.make(5)
})
const correlation = targetPromotionCorrelationFor(qualifiedCandidate)

const qualification = IntegratorRunCandidateGitObservedEvent.make({
  candidateText,
  observation: IntegratorGitObservation.cases.Commit.make({
    candidateText,
    commit: candidateCommit,
    directParents: [expectedHead, acceptedCommit]
  }),
  run: qualifiedCandidate.run,
  version: workflowJournalEventVersion
})

const integratorObservations = HashMap.make([
  integratorRunCandidateRecordKeyPrefix(qualifiedCandidate.run, candidateText),
  { event: qualification, position: qualifiedCandidate.qualifiedAt }
])

const promotionRecord = (position: number, event: JournalRecord["event"]): JournalRecord => ({
  event,
  key: `${event._tag}:${position}` as JournalRecord["key"],
  position: JournalPosition.make(position),
  runId
})

const validationDetail = (
  record: JournalRecord,
  indexes: ReturnType<typeof makeTargetPromotionHistoryIndexes>,
  observations: typeof integratorObservations
): string | undefined => invalidTargetPromotionHistory(record, indexes, observations).detail

const acceptPromotionRecord = (
  record: JournalRecord,
  indexes: ReturnType<typeof makeTargetPromotionHistoryIndexes>,
  observations: typeof integratorObservations
): ReturnType<typeof makeTargetPromotionHistoryIndexes> => {
  const validation = invalidTargetPromotionHistory(record, indexes, observations)
  expect(validation.detail).toBeUndefined()
  return validation.indexes
}

it("accepts promotion intent only after the exact Integrator Git qualification", () => {
  const indexes = makeTargetPromotionHistoryIndexes()
  const intent = TargetPromotionIntendedEvent.make({ correlation, version: workflowJournalEventVersion })
  expect(validationDetail(promotionRecord(6, intent), indexes, integratorObservations)).toBeUndefined()
})

it("rejects promotion intent with no earlier Integrator Git result", () => {
  const indexes = makeTargetPromotionHistoryIndexes()
  const intent = TargetPromotionIntendedEvent.make({ correlation, version: workflowJournalEventVersion })
  expect(validationDetail(promotionRecord(6, intent), indexes, HashMap.empty())).toContain(
    "Integrator Git qualification"
  )
})

it("rejects altered or non-prior Integrator Git qualification evidence", () => {
  const changedCandidateText = IntegratorCandidateText.make("refs/candidates/foreign-promotion-history")
  const foreignRun = { ...qualifiedCandidate.run, ordinal: IntegratorRunOrdinal.make(1) }
  const samePositionCandidate = IntegratorRunQualifiedCandidate.make({
    ...qualifiedCandidate,
    qualifiedAt: JournalPosition.make(6)
  })
  const cases = [
    ["foreign qualification position", qualifiedCandidate, qualification, JournalPosition.make(4)],
    ["non-prior qualification", samePositionCandidate, qualification, JournalPosition.make(6)],
    [
      "foreign run",
      qualifiedCandidate,
      IntegratorRunCandidateGitObservedEvent.make({ ...qualification, run: foreignRun }),
      qualifiedCandidate.qualifiedAt
    ],
    [
      "foreign candidate text",
      qualifiedCandidate,
      IntegratorRunCandidateGitObservedEvent.make({
        ...qualification,
        candidateText: changedCandidateText,
        observation: IntegratorGitObservation.cases.Commit.make({
          candidateText: changedCandidateText,
          commit: candidateCommit,
          directParents: [expectedHead, acceptedCommit]
        })
      }),
      qualifiedCandidate.qualifiedAt
    ],
    [
      "non-commit observation",
      qualifiedCandidate,
      IntegratorRunCandidateGitObservedEvent.make({
        ...qualification,
        observation: IntegratorGitObservation.cases.Missing.make({ candidateText })
      }),
      qualifiedCandidate.qualifiedAt
    ]
  ] as const

  for (const [label, candidate, observationEvent, observedAt] of cases) {
    const intent = TargetPromotionIntendedEvent.make({
      correlation: targetPromotionCorrelationFor(candidate),
      version: workflowJournalEventVersion
    })
    const observations = HashMap.make([
      integratorRunCandidateRecordKeyPrefix(candidate.run, candidate.candidateText),
      { event: observationEvent, position: observedAt }
    ])
    expect(
      validationDetail(promotionRecord(6, intent), makeTargetPromotionHistoryIndexes(), observations),
      label
    ).toContain("Integrator Git qualification")
  }
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
  let nextIndexes = acceptPromotionRecord(promotionRecord(6, intent), indexes, integratorObservations)
  nextIndexes = acceptPromotionRecord(promotionRecord(7, attempt), nextIndexes, integratorObservations)
  acceptPromotionRecord(promotionRecord(8, success), nextIndexes, integratorObservations)
})

it("rejects a promotion attempt whose reason is not exact for its ordinal", () => {
  const indexes = makeTargetPromotionHistoryIndexes()
  const intent = TargetPromotionIntendedEvent.make({ correlation, version: workflowJournalEventVersion })
  const attempt = TargetPromotionAttemptIntendedEvent.make({
    attemptOrdinal: TargetPromotionAttemptOrdinal.make(1),
    correlation,
    reason: TargetPromotionAttemptReason.cases.ReconciledExpectedHead.make({
      observedHeadSha: expectedHead,
      previousAttemptOrdinal: TargetPromotionAttemptOrdinal.make(1)
    }),
    version: workflowJournalEventVersion
  })
  const nextIndexes = acceptPromotionRecord(promotionRecord(6, intent), indexes, integratorObservations)
  expect(validationDetail(promotionRecord(7, attempt), nextIndexes, integratorObservations)).toContain(
    "expected exact sequential ordinal"
  )
})

it("rejects terminal observations that contradict M, H, or their causal basis", () => {
  const invalidTerminals = [
    TargetPromotionObservedSuccessEvent.make({
      basis: TargetPromotionTerminalBasis.cases.BeforeFirstAttempt.make({}),
      correlation,
      observation: TargetPromotionSuccessObservation.cases.CompareAndSetApplied.make({
        candidateAncestry: "Current",
        targetHeadSha: candidateCommit
      }),
      version: workflowJournalEventVersion
    }),
    TargetPromotionObservedSuccessEvent.make({
      basis: TargetPromotionTerminalBasis.cases.BeforeFirstAttempt.make({}),
      correlation,
      observation: TargetPromotionSuccessObservation.cases.ReconciledCandidateAncestor.make({
        candidateAncestry: "Ancestor",
        targetHeadSha: candidateCommit
      }),
      version: workflowJournalEventVersion
    }),
    TargetPromotionObservedSuccessEvent.make({
      basis: TargetPromotionTerminalBasis.cases.BeforeFirstAttempt.make({}),
      correlation,
      observation: TargetPromotionSuccessObservation.cases.ReconciledCandidateAncestor.make({
        candidateAncestry: "Ancestor",
        targetHeadSha: expectedHead
      }),
      version: workflowJournalEventVersion
    }),
    TargetPromotionStaleEvent.make({
      basis: TargetPromotionTerminalBasis.cases.BeforeFirstAttempt.make({}),
      correlation,
      observation: TargetPromotionStaleObservation.cases.CompareAndSetRejected.make({
        observedHeadSha: candidateCommit
      }),
      version: workflowJournalEventVersion
    }),
    TargetPromotionNonConvergenceEvent.make({
      attemptLimit: targetPromotionAttemptLimit,
      attemptOrdinal: TargetPromotionAttemptOrdinal.make(targetPromotionAttemptLimit),
      correlation,
      lastObservation: TargetPromotionNonConvergenceObservation.cases.ExpectedHeadStillObserved.make({
        observedHeadSha: candidateCommit
      }),
      version: workflowJournalEventVersion
    })
  ] as const

  for (const terminal of invalidTerminals) {
    const indexes = makeTargetPromotionHistoryIndexes()
    const intent = TargetPromotionIntendedEvent.make({ correlation, version: workflowJournalEventVersion })
    const nextIndexes = acceptPromotionRecord(promotionRecord(6, intent), indexes, integratorObservations)
    expect(validationDetail(promotionRecord(7, terminal), nextIndexes, integratorObservations)).toContain(
      "no exact latest unresolved attempt"
    )
  }
})

it("accepts three exact attempts followed by bounded non-convergence", () => {
  const indexes = makeTargetPromotionHistoryIndexes()
  const intent = TargetPromotionIntendedEvent.make({ correlation, version: workflowJournalEventVersion })
  let nextIndexes = acceptPromotionRecord(promotionRecord(6, intent), indexes, integratorObservations)

  for (const ordinal of [1, 2, 3]) {
    const attemptOrdinal = TargetPromotionAttemptOrdinal.make(ordinal)
    const reason =
      ordinal === 1
        ? TargetPromotionAttemptReason.cases.Initial.make({ observedHeadSha: expectedHead })
        : TargetPromotionAttemptReason.cases.ReconciledExpectedHead.make({
            observedHeadSha: expectedHead,
            previousAttemptOrdinal: TargetPromotionAttemptOrdinal.make(ordinal - 1)
          })
    const attempt = TargetPromotionAttemptIntendedEvent.make({
      attemptOrdinal,
      correlation,
      reason,
      version: workflowJournalEventVersion
    })
    nextIndexes = acceptPromotionRecord(promotionRecord(6 + ordinal, attempt), nextIndexes, integratorObservations)
  }

  const nonConvergence = TargetPromotionNonConvergenceEvent.make({
    attemptLimit: targetPromotionAttemptLimit,
    attemptOrdinal: TargetPromotionAttemptOrdinal.make(targetPromotionAttemptLimit),
    correlation,
    lastObservation: TargetPromotionNonConvergenceObservation.cases.ExpectedHeadStillObserved.make({
      observedHeadSha: expectedHead
    }),
    version: workflowJournalEventVersion
  })
  acceptPromotionRecord(promotionRecord(10, nonConvergence), nextIndexes, integratorObservations)
})

it("ignores workflow events outside the promotion chronology", () => {
  expect(
    validationDetail(promotionRecord(5, qualification), makeTargetPromotionHistoryIndexes(), HashMap.empty())
  ).toBeUndefined()
})
