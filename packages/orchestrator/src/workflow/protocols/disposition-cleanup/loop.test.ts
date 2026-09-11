import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import {
  AcceptedResult,
  AttemptId,
  EvidenceDigest,
  EvidenceReference,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskId,
  WorktreeLocator
} from "@dalph/contracts"
import { InRunJournal } from "../../../workflow-journal/in-run-journal.js"
import { dispositionCleanupLiveJournalTestLayer } from "./live-journal-test.js"
import { authorization, attempt, runId, successor } from "./fixtures.js"
import { appendAbandonedProvenance } from "./provenance-fixtures.js"
import {
  activateDispositionCleanup,
  appendDerivedCleanupAuthorizations,
  runDispositionCleanupLoop,
  selectCleanupResponsibilities
} from "./loop.js"
import { branchCleanupTestLayer, TestBranchCleanupBoundary } from "./branch.js"
import { integratorCandidateCleanupTestLayer, TestIntegratorCandidateCleanupBoundary } from "./integrator-candidate.js"
import { TestWorktreeCleanupBoundary, worktreeCleanupTestLayer } from "./worktree.js"
import {
  BranchCleanupAuthorization,
  BranchCleanupEvidenceRevision,
  BranchCleanupOwner,
  IntegratorCandidateCleanupAuthorization,
  IntegratorCandidateCleanupDisposition,
  IntegratorCandidateCleanupEvidenceRevision,
  IntegratorCandidateCleanupOwner,
  PlannedAttemptCleanupDisposition
} from "./disposition.js"
import {
  IntegratorCandidateResourceLocator,
  IntegratorSessionCorrelation,
  IntegratorSessionId
} from "../integrator/events.js"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import { OperationId } from "../../identity.js"

const begin = Effect.fn("DispositionCleanupLoopTest.begin")(function* (_target?: string) {
  const journal = yield* InRunJournal
  return journal
})

const foreignRunId = RunId.make("issue-69-foreign-run")
const foreignAttempt = PlannedTaskAttempt.make({
  ...attempt,
  attemptId: AttemptId.make("issue-69-foreign-p1"),
  branch: TaskBranchRef.make("refs/heads/task/issue-69-foreign-p1"),
  runId: foreignRunId,
  taskId: TaskId.make("issue-69-foreign-task"),
  worktree: WorktreeLocator.make("/tmp/issue-69-foreign-p1")
})
const foreignSuccessorAttempt = PlannedTaskAttempt.make({
  ...successor,
  attemptId: AttemptId.make("issue-69-foreign-p2"),
  branch: TaskBranchRef.make("refs/heads/task/issue-69-foreign-p2"),
  runId: foreignRunId,
  taskId: foreignAttempt.taskId,
  worktree: WorktreeLocator.make("/tmp/issue-69-foreign-p2")
})
const foreignAttemptDisposition = PlannedAttemptCleanupDisposition.cases.Superseded.make({
  dispositionAt: JournalPosition.make(33),
  plannedAttempt: foreignAttempt,
  successorAttempt: foreignSuccessorAttempt
})
const foreignBranchAuthorization = BranchCleanupAuthorization.make({
  causalPredecessors: [OperationId.make("issue-69-foreign-branch-source")],
  disposition: foreignAttemptDisposition,
  evidenceRevision: BranchCleanupEvidenceRevision.make(1),
  expectedHead: foreignAttempt.baseSha,
  locator: foreignAttempt.branch,
  observationAt: JournalPosition.make(30),
  observationOperationId: OperationId.make("issue-69-foreign-branch-observation"),
  operationId: OperationId.make("issue-69-foreign-branch-cleanup"),
  owner: BranchCleanupOwner.make({ attemptId: foreignAttempt.attemptId }),
  worktreeCleanupOperationId: OperationId.make("issue-69-foreign-worktree-cleanup"),
  writerQuiescent: true
})
const foreignCandidatePredecessor = IntegratorSessionCorrelation.make({
  acceptedResult: AcceptedResult.make({
    commit: foreignAttempt.baseSha,
    evidenceManifest: EvidenceReference.make({ byteLength: 1, digest: EvidenceDigest.make("f".repeat(64)) })
  }),
  candidateResource: IntegratorCandidateResourceLocator.make("candidate:issue-69-foreign-p1"),
  expectedTargetHead: foreignAttempt.baseSha,
  integrationTarget: IntegrationTarget.make({
    repository: GitRepositoryLocator.make("repo:issue-69-foreign"),
    ref: IntegrationTargetRef.make("refs/heads/main")
  }),
  plannedAttempt: foreignAttempt,
  queuedAt: JournalPosition.make(2),
  sessionId: IntegratorSessionId.make("session:issue-69-foreign-p1"),
  startedAt: JournalPosition.make(6),
  targetLineageObservedAt: JournalPosition.make(4)
})
const foreignCandidateSuccessor = IntegratorSessionCorrelation.make({
  ...foreignCandidatePredecessor,
  candidateResource: IntegratorCandidateResourceLocator.make("candidate:issue-69-foreign-p2"),
  sessionId: IntegratorSessionId.make("session:issue-69-foreign-p2"),
  targetLineageObservedAt: JournalPosition.make(12)
})
const foreignCandidateAuthorization = IntegratorCandidateCleanupAuthorization.make({
  causalPredecessors: [OperationId.make("issue-69-foreign-candidate-source")],
  disposition: IntegratorCandidateCleanupDisposition.make({
    directionAppliedAt: JournalPosition.make(10),
    dispositionAt: JournalPosition.make(9),
    predecessor: foreignCandidatePredecessor,
    successor: foreignCandidateSuccessor
  }),
  evidenceRevision: IntegratorCandidateCleanupEvidenceRevision.make(1),
  locator: foreignCandidatePredecessor.candidateResource,
  observationAt: foreignCandidatePredecessor.targetLineageObservedAt,
  observationOperationId: OperationId.make("issue-69-foreign-candidate-observation"),
  operationId: OperationId.make("issue-69-foreign-candidate-cleanup"),
  owner: IntegratorCandidateCleanupOwner.make({ sessionId: foreignCandidatePredecessor.sessionId }),
  writerQuiescent: true
})

it.effect("selects the same typed worktree responsibility with and without an operation filter", () =>
  Effect.gen(function* () {
    const journal = yield* begin()
    yield* appendAbandonedProvenance(attempt)
    const activated = yield* activateDispositionCleanup(runId)
    const selected = activated.worktree[0]
    expect(selected).toBeDefined()
    if (selected === undefined) return
    const records = yield* journal.read(runId)
    expect(selectCleanupResponsibilities(records).worktree?.operationId).toBe(selected.operationId)
    expect(selectCleanupResponsibilities(records, selected.operationId).worktree?.operationId).toBe(
      selected.operationId
    )
  }).pipe(
    Effect.provide(worktreeCleanupTestLayer({ observations: [] })),
    Effect.provide(dispositionCleanupLiveJournalTestLayer())
  )
)

it.effect("deduplicates duplicate typed proposals before crossing a cleanup boundary", () =>
  Effect.gen(function* () {
    yield* begin()
    const result = yield* runDispositionCleanupLoop(runId, {
      branch: [],
      candidate: [],
      worktree: [authorization, authorization]
    })
    expect(result.worktreeOutcomes).toHaveLength(1)
    expect(result.worktreeOutcomes[0]?._tag).toBe("Preserved")
  }).pipe(
    Effect.provide(worktreeCleanupTestLayer({ observations: [] })),
    Effect.provide(branchCleanupTestLayer({ observations: [] })),
    Effect.provide(integratorCandidateCleanupTestLayer({ observations: [] })),
    Effect.provide(dispositionCleanupLiveJournalTestLayer())
  )
)

it.effect("does not append a duplicate derived authorization when its key is already durable", () =>
  Effect.gen(function* () {
    yield* begin()
    yield* appendAbandonedProvenance(attempt)
    yield* appendDerivedCleanupAuthorizations(runId, ["worktree"])
    const before = yield* (yield* InRunJournal).read(runId)
    yield* appendDerivedCleanupAuthorizations(runId, ["worktree"])
    const after = yield* (yield* InRunJournal).read(runId)
    expect(after).toEqual(before)
  }).pipe(
    Effect.provide(worktreeCleanupTestLayer({ observations: [] })),
    Effect.provide(dispositionCleanupLiveJournalTestLayer())
  )
)

it.effect("filters foreign branch and candidate proposals before crossing their cleanup boundaries", () =>
  Effect.gen(function* () {
    yield* begin()
    yield* appendAbandonedProvenance(attempt)
    const branchBoundary = yield* TestBranchCleanupBoundary
    const candidateBoundary = yield* TestIntegratorCandidateCleanupBoundary
    const worktreeBoundary = yield* TestWorktreeCleanupBoundary

    const result = yield* runDispositionCleanupLoop(runId, {
      branch: [foreignBranchAuthorization],
      candidate: [foreignCandidateAuthorization],
      worktree: [authorization]
    })

    expect(result.branchOutcomes).toEqual([])
    expect(result.candidateOutcomes).toEqual([])
    expect(yield* branchBoundary.calls()).toEqual([])
    expect(yield* candidateBoundary.calls()).toEqual([])
    // The same-run worktree proposal is allowed to reach its own boundary,
    // proving the empty branch/candidate calls are due to run scoping.
    expect(yield* worktreeBoundary.calls()).not.toEqual([])
  }).pipe(
    Effect.provide(worktreeCleanupTestLayer({ observations: [] })),
    Effect.provide(branchCleanupTestLayer({ observations: [] })),
    Effect.provide(integratorCandidateCleanupTestLayer({ observations: [] })),
    Effect.provide(dispositionCleanupLiveJournalTestLayer())
  )
)

it.effect("ignores a malformed tagged authorization record at the journal boundary", () =>
  Effect.gen(function* () {
    const journal = yield* begin()
    const records = yield* journal.read(runId)
    const beginning = records[0]
    expect(beginning).toBeDefined()
    if (beginning === undefined) return

    // This is the one deliberately malformed boundary value in this test:
    // persisted decoding normally supplies JournalRecord, while this fixture
    // proves selector recovery when a legacy/corrupt row has only the tag.
    const malformed = { ...beginning, event: { _tag: "WorktreeCleanupAuthorized" } }

    expect(() => selectCleanupResponsibilities([...records, malformed])).not.toThrow()
    expect(selectCleanupResponsibilities([...records, malformed]).worktree).toBeUndefined()
  }).pipe(Effect.provide(dispositionCleanupLiveJournalTestLayer()))
)

it.effect("refuses cleanup selection from a no-begin journal", () =>
  Effect.sync(() => {
    expect(selectCleanupResponsibilities([])).toEqual({ branch: undefined, candidate: undefined, worktree: undefined })
  })
)
