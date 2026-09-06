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
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { InitialControlPolicy } from "../../control/policy.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import {
  integratorRunCandidateRecordKeyPrefix,
  targetPromotionAttemptIntentRecordKey,
  targetPromotionIntentRecordKey,
  targetPromotionReconciliationDeferredRecordKey,
  workflowRunBeganRecordKey
} from "../../workflow-journal/record-key.js"
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
  TargetPromotionReconciliationDeferredEvent,
  TargetPromotionReconciliationDeferral,
  TargetPromotionStaleEvent,
  TargetPromotionStaleObservation,
  TargetPromotionTerminalBasis,
  targetPromotionAttemptLimit,
  targetPromotionCorrelationFor,
  TargetPromotionObservedSuccessEvent,
  TargetPromotionSuccessObservation
} from "../../workflow/protocols/target-promotion/events.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import { WorkflowRunBeganEvent } from "../../workflow/registry/event.js"
import { invalidTargetPromotionHistory, makeTargetPromotionHistoryIndexes } from "./target-promotion-history.js"
import { reduceWorkflowJournalHistory } from "./history.js"
import {
  deriveTargetPromotionState,
  targetPromotionReconciliationDeferralIssueFor
} from "../../workflow/protocols/target-promotion/state.js"

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

it("accepts exact retry-authority and target-read-failure deferrals after the latest unresolved attempt", () => {
  const deferrals = [
    TargetPromotionReconciliationDeferral.cases.RetryAuthorityRequired.make({ observedHeadSha: expectedHead }),
    TargetPromotionReconciliationDeferral.cases.TargetReadFailed.make({ detail: "target read unavailable" })
  ] as const

  for (const deferral of deferrals) {
    const intent = TargetPromotionIntendedEvent.make({ correlation, version: workflowJournalEventVersion })
    const attemptOrdinal = TargetPromotionAttemptOrdinal.make(1)
    const attempt = TargetPromotionAttemptIntendedEvent.make({
      attemptOrdinal,
      correlation,
      reason: TargetPromotionAttemptReason.cases.Initial.make({ observedHeadSha: expectedHead }),
      version: workflowJournalEventVersion
    })
    const deferred = TargetPromotionReconciliationDeferredEvent.make({
      afterAttemptOrdinal: attemptOrdinal,
      correlation,
      deferral,
      version: workflowJournalEventVersion
    })
    let nextIndexes = acceptPromotionRecord(
      promotionRecord(6, intent),
      makeTargetPromotionHistoryIndexes(),
      integratorObservations
    )
    nextIndexes = acceptPromotionRecord(promotionRecord(7, attempt), nextIndexes, integratorObservations)
    acceptPromotionRecord(promotionRecord(8, deferred), nextIndexes, integratorObservations)
  }
})

it("rejects retry authority whose durable head differs from the fixed expected head", () => {
  const intent = TargetPromotionIntendedEvent.make({ correlation, version: workflowJournalEventVersion })
  const attemptOrdinal = TargetPromotionAttemptOrdinal.make(1)
  const attempt = TargetPromotionAttemptIntendedEvent.make({
    attemptOrdinal,
    correlation,
    reason: TargetPromotionAttemptReason.cases.Initial.make({ observedHeadSha: expectedHead }),
    version: workflowJournalEventVersion
  })
  const deferred = TargetPromotionReconciliationDeferredEvent.make({
    afterAttemptOrdinal: attemptOrdinal,
    correlation,
    deferral: TargetPromotionReconciliationDeferral.cases.RetryAuthorityRequired.make({
      observedHeadSha: GitCommitSha.make("d".repeat(40))
    }),
    version: workflowJournalEventVersion
  })
  let nextIndexes = acceptPromotionRecord(
    promotionRecord(6, intent),
    makeTargetPromotionHistoryIndexes(),
    integratorObservations
  )
  nextIndexes = acceptPromotionRecord(promotionRecord(7, attempt), nextIndexes, integratorObservations)

  expect(validationDetail(promotionRecord(8, deferred), nextIndexes, integratorObservations)).toContain(
    "instead of exact expected head"
  )
})

it("full history reduction rejects retry authority whose observed head contradicts exact H", () => {
  const attemptOrdinal = TargetPromotionAttemptOrdinal.make(1)
  const malformedHead = GitCommitSha.make("d".repeat(40))
  const intent = TargetPromotionIntendedEvent.make({ correlation, version: workflowJournalEventVersion })
  const attempt = TargetPromotionAttemptIntendedEvent.make({
    attemptOrdinal,
    correlation,
    reason: TargetPromotionAttemptReason.cases.Initial.make({ observedHeadSha: expectedHead }),
    version: workflowJournalEventVersion
  })
  const deferred = TargetPromotionReconciliationDeferredEvent.make({
    afterAttemptOrdinal: attemptOrdinal,
    correlation,
    deferral: TargetPromotionReconciliationDeferral.cases.RetryAuthorityRequired.make({
      observedHeadSha: malformedHead
    }),
    version: workflowJournalEventVersion
  })
  const target = FixtureTarget.make("promotion-history-reduction-target")
  const records: ReadonlyArray<JournalRecord> = [
    {
      event: WorkflowRunBeganEvent.make({
        initialControlPolicy: InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }),
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        target,
        version: workflowJournalEventVersion
      }),
      key: workflowRunBeganRecordKey,
      position: JournalPosition.make(1),
      runId
    },
    {
      event: intent,
      key: targetPromotionIntentRecordKey(correlation.requestId),
      position: JournalPosition.make(2),
      runId
    },
    {
      event: attempt,
      key: targetPromotionAttemptIntentRecordKey(correlation.requestId, attemptOrdinal),
      position: JournalPosition.make(3),
      runId
    },
    {
      event: deferred,
      key: targetPromotionReconciliationDeferredRecordKey(correlation.requestId, attemptOrdinal),
      position: JournalPosition.make(4),
      runId
    }
  ]
  const reduction = reduceWorkflowJournalHistory(runId, records)

  expect(malformedHead).not.toBe(expectedHead)
  expect(reduction).toMatchObject({
    _tag: "InvalidWorkflowJournalHistory",
    issues: expect.arrayContaining([
      expect.objectContaining({
        detail: expect.stringContaining("instead of exact expected head"),
        position: JournalPosition.make(4)
      })
    ])
  })
})

it("rejects deferral without the latest attempt, after the final attempt, or twice for one attempt", () => {
  const intent = TargetPromotionIntendedEvent.make({ correlation, version: workflowJournalEventVersion })
  const deferredFor = (ordinal: number) =>
    TargetPromotionReconciliationDeferredEvent.make({
      afterAttemptOrdinal: TargetPromotionAttemptOrdinal.make(ordinal),
      correlation,
      deferral: TargetPromotionReconciliationDeferral.cases.TargetReadFailed.make({
        detail: "target read unavailable"
      }),
      version: workflowJournalEventVersion
    })
  let nextIndexes = acceptPromotionRecord(
    promotionRecord(6, intent),
    makeTargetPromotionHistoryIndexes(),
    integratorObservations
  )
  expect(validationDetail(promotionRecord(7, deferredFor(1)), nextIndexes, integratorObservations)).toContain(
    "no exact latest unresolved attempt"
  )

  for (const ordinal of [1, 2, 3]) {
    const attemptOrdinal = TargetPromotionAttemptOrdinal.make(ordinal)
    const attempt = TargetPromotionAttemptIntendedEvent.make({
      attemptOrdinal,
      correlation,
      reason:
        ordinal === 1
          ? TargetPromotionAttemptReason.cases.Initial.make({ observedHeadSha: expectedHead })
          : TargetPromotionAttemptReason.cases.ReconciledExpectedHead.make({
              observedHeadSha: expectedHead,
              previousAttemptOrdinal: TargetPromotionAttemptOrdinal.make(ordinal - 1)
            }),
      version: workflowJournalEventVersion
    })
    nextIndexes = acceptPromotionRecord(promotionRecord(6 + ordinal, attempt), nextIndexes, integratorObservations)
  }
  expect(validationDetail(promotionRecord(10, deferredFor(3)), nextIndexes, integratorObservations)).toContain(
    "cannot defer after final attempt"
  )

  let duplicateIndexes = acceptPromotionRecord(
    promotionRecord(6, intent),
    makeTargetPromotionHistoryIndexes(),
    integratorObservations
  )
  const firstAttempt = TargetPromotionAttemptIntendedEvent.make({
    attemptOrdinal: TargetPromotionAttemptOrdinal.make(1),
    correlation,
    reason: TargetPromotionAttemptReason.cases.Initial.make({ observedHeadSha: expectedHead }),
    version: workflowJournalEventVersion
  })
  duplicateIndexes = acceptPromotionRecord(promotionRecord(7, firstAttempt), duplicateIndexes, integratorObservations)
  duplicateIndexes = acceptPromotionRecord(promotionRecord(8, deferredFor(1)), duplicateIndexes, integratorObservations)
  expect(validationDetail(promotionRecord(9, deferredFor(1)), duplicateIndexes, integratorObservations)).toContain(
    "no exact latest unresolved attempt"
  )
})

it("pure reconstruction rejects every causally impossible promotion reconciliation deferral", () => {
  const intent = TargetPromotionIntendedEvent.make({ correlation, version: workflowJournalEventVersion })
  const attemptFor = (ordinal: number) =>
    TargetPromotionAttemptIntendedEvent.make({
      attemptOrdinal: TargetPromotionAttemptOrdinal.make(ordinal),
      correlation,
      reason:
        ordinal === 1
          ? TargetPromotionAttemptReason.cases.Initial.make({ observedHeadSha: expectedHead })
          : TargetPromotionAttemptReason.cases.ReconciledExpectedHead.make({
              observedHeadSha: expectedHead,
              previousAttemptOrdinal: TargetPromotionAttemptOrdinal.make(ordinal - 1)
            }),
      version: workflowJournalEventVersion
    })
  const deferredFor = (ordinal: number) =>
    TargetPromotionReconciliationDeferredEvent.make({
      afterAttemptOrdinal: TargetPromotionAttemptOrdinal.make(ordinal),
      correlation,
      deferral: TargetPromotionReconciliationDeferral.cases.TargetReadFailed.make({
        detail: "target read unavailable"
      }),
      version: workflowJournalEventVersion
    })
  const terminal = TargetPromotionStaleEvent.make({
    basis: TargetPromotionTerminalBasis.cases.AfterAttempt.make({
      attemptOrdinal: TargetPromotionAttemptOrdinal.make(1)
    }),
    correlation,
    observation: TargetPromotionStaleObservation.cases.CompareAndSetRejected.make({
      observedHeadSha: GitCommitSha.make("d".repeat(40))
    }),
    version: workflowJournalEventVersion
  })

  expect(targetPromotionReconciliationDeferralIssueFor([promotionRecord(7, deferredFor(1))], correlation)).toContain(
    "no prior exact promotion intent"
  )
  expect(
    targetPromotionReconciliationDeferralIssueFor(
      [promotionRecord(6, intent), promotionRecord(7, deferredFor(1))],
      correlation
    )
  ).toContain("no exact latest unresolved attempt")
  expect(
    targetPromotionReconciliationDeferralIssueFor(
      [
        promotionRecord(6, intent),
        promotionRecord(7, attemptFor(1)),
        promotionRecord(8, terminal),
        promotionRecord(9, deferredFor(1))
      ],
      correlation
    )
  ).toContain("follows a terminal promotion result")
  expect(
    targetPromotionReconciliationDeferralIssueFor(
      [
        promotionRecord(6, intent),
        promotionRecord(7, attemptFor(1)),
        promotionRecord(8, attemptFor(2)),
        promotionRecord(9, deferredFor(1))
      ],
      correlation
    )
  ).toContain("no exact latest unresolved attempt")
  expect(
    targetPromotionReconciliationDeferralIssueFor(
      [
        promotionRecord(6, intent),
        promotionRecord(7, attemptFor(1)),
        promotionRecord(8, deferredFor(1)),
        promotionRecord(9, deferredFor(1))
      ],
      correlation
    )
  ).toContain("duplicates the same promotion attempt")

  const validPrefix = [
    promotionRecord(6, intent),
    promotionRecord(7, attemptFor(1)),
    promotionRecord(8, deferredFor(1))
  ]
  expect(targetPromotionReconciliationDeferralIssueFor(validPrefix, correlation)).toBeUndefined()
  expect(deriveTargetPromotionState(validPrefix, correlation)).toMatchObject({
    _tag: "PromotionReconciliationDeferred",
    afterAttemptOrdinal: 1,
    deferral: { _tag: "TargetReadFailed", detail: "target read unavailable" }
  })
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
