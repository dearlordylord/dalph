import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import { GitCommitSha, TaskBranchRef, WorktreeLocator } from "@dalph/contracts"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { InitialControlPolicy } from "../../../control/policy.js"
import { TaskWorkCapacity } from "../../../coordination/admission/capacity.js"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import { memoryJournalTestLayer } from "../../../workflow-journal/adapters/memory-store.js"
import { JournalStore } from "../../../workflow-journal/store.js"
import { OperationId } from "../../identity.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  WorktreeCleanupAbsenceConfirmedEvent,
  WorktreeCleanupAuthorizedEvent,
  WorktreeCleanupObservation,
  WorktreeCleanupObservationIntendedEvent,
  WorktreeCleanupObservedEvent,
  WorktreeCleanupSettledEvent
} from "./worktree.js"
import {
  BranchCleanupAuthorization,
  BranchCleanupEvidenceRevision,
  BranchCleanupOwner,
  CleanupObservationOrdinal
} from "./disposition.js"
import {
  BranchCleanupMutationResult,
  BranchCleanupObservation,
  BranchCleanupAuthorizedEvent,
  BranchCleanupObservationIntendedEvent,
  branchCleanupTestLayer,
  runBranchCleanup,
  TestBranchCleanupBoundary
} from "./branch.js"
import {
  worktreeCleanupAuthorizedRecordKey,
  branchCleanupAuthorizedRecordKey,
  worktreeCleanupAbsenceConfirmedRecordKey,
  worktreeCleanupObservationIntendedRecordKey,
  worktreeCleanupObservedRecordKey,
  worktreeCleanupSettledRecordKey,
  branchCleanupObservationIntendedRecordKey
} from "../../../workflow-journal/record-key.js"
import { authorization, attempt, disposition, runId, baseSha, successor } from "./fixtures.js"
import {
  appendReplacementProvenance,
  replacementPredecessorsFor,
  replacementWorktreeObservationOperationIdFor
} from "./provenance-fixtures.js"
import { activateDispositionCleanup } from "./loop.js"

const branchAuthorization = BranchCleanupAuthorization.make({
  causalPredecessors: [authorization.operationId, ...replacementPredecessorsFor(attempt)],
  disposition,
  evidenceRevision: BranchCleanupEvidenceRevision.make(1),
  expectedHead: baseSha,
  locator: attempt.branch,
  observationAt: JournalPosition.make(16),
  observationOperationId: replacementWorktreeObservationOperationIdFor(attempt),
  operationId: OperationId.make("issue-69-branch-cleanup"),
  owner: BranchCleanupOwner.make({ attemptId: attempt.attemptId }),
  worktreeCleanupOperationId: OperationId.make("issue-69-worktree-cleanup"),
  writerQuiescent: true
})

const begin = Effect.fn("Issue69BranchTest.begin")(function* () {
  const journal = yield* JournalStore
  yield* journal.beginRun(
    runId,
    FixtureTarget.make("issue-69-branch-target"),
    InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
  )
  yield* appendReplacementProvenance(attempt, successor)
  yield* journal.append(
    runId,
    worktreeCleanupAuthorizedRecordKey(authorization.operationId),
    WorktreeCleanupAuthorizedEvent.make({
      authorization,
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      version: workflowJournalEventVersion
    })
  )
  const observation = WorktreeCleanupObservation.cases.Absent.make({
    locator: authorization.locator,
    revision: authorization.evidenceRevision
  })
  const ordinal = CleanupObservationOrdinal.make(1)
  yield* journal.append(
    runId,
    worktreeCleanupObservationIntendedRecordKey(authorization.operationId, ordinal),
    WorktreeCleanupObservationIntendedEvent.make({
      authorization,
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      operationId: authorization.observationOperationId,
      ordinal,
      version: workflowJournalEventVersion
    })
  )
  yield* journal.append(
    runId,
    worktreeCleanupObservedRecordKey(authorization.operationId, ordinal),
    WorktreeCleanupObservedEvent.make({
      authorization,
      observation,
      occurrenceClassification: "NonActionOccurrence",
      operationId: authorization.observationOperationId,
      ordinal,
      version: workflowJournalEventVersion
    })
  )
  yield* journal.append(
    runId,
    worktreeCleanupAbsenceConfirmedRecordKey(authorization.operationId, ordinal),
    WorktreeCleanupAbsenceConfirmedEvent.make({
      authorization,
      cause: "InitialAbsence",
      observation,
      occurrenceClassification: "NonActionOccurrence",
      operationId: authorization.observationOperationId,
      ordinal,
      version: workflowJournalEventVersion
    })
  )
  yield* journal.append(
    runId,
    worktreeCleanupSettledRecordKey(authorization.operationId),
    WorktreeCleanupSettledEvent.make({
      authorization,
      occurrenceClassification: "NonActionOccurrence",
      result: {
        _tag: "AlreadyAbsent",
        branch: authorization.owner.branch,
        locator: authorization.locator,
        revision: authorization.evidenceRevision
      },
      version: workflowJournalEventVersion
    })
  )
})

const present = BranchCleanupObservation.cases.Present.make({
  branch: attempt.branch,
  headSha: baseSha,
  registeredWorktree: null,
  revision: BranchCleanupEvidenceRevision.make(1)
})

it.effect("table-reconciles changed branch owner, head, and revision without a branch mutation", () =>
  Effect.gen(function* () {
    const cases = [
      BranchCleanupObservation.cases.Foreign.make({
        branch: attempt.branch,
        observedHead: GitCommitSha.make("2".repeat(40)),
        observedWorktree: WorktreeLocator.make("/tmp/foreign-branch-worktree"),
        reason: "DifferentHead",
        revision: BranchCleanupEvidenceRevision.make(2)
      }),
      BranchCleanupObservation.cases.Foreign.make({
        branch: attempt.branch,
        observedHead: baseSha,
        observedWorktree: WorktreeLocator.make("/tmp/foreign-branch-worktree"),
        reason: "RegisteredWorktree",
        revision: BranchCleanupEvidenceRevision.make(2)
      }),
      BranchCleanupObservation.cases.Unreadable.make({ branch: attempt.branch, detail: "provider read failed" })
    ]
    for (const observation of cases) {
      const result = yield* Effect.gen(function* () {
        yield* begin()
        const outcome = yield* runBranchCleanup(branchAuthorization)
        const calls = yield* (yield* TestBranchCleanupBoundary).calls()
        return { calls, outcome }
      }).pipe(
        Effect.provide(branchCleanupTestLayer({ observations: [observation] })),
        Effect.provide(memoryJournalTestLayer)
      )
      expect(result.outcome._tag).toBe("Preserved")
      expect(result.calls.map(({ _tag }) => _tag)).toEqual(["Observe"])
    }
  })
)

it.effect("deletes a planned branch only after the exact worktree settlement", () =>
  Effect.gen(function* () {
    yield* begin()
    const result = yield* runBranchCleanup(branchAuthorization)
    const boundary = yield* TestBranchCleanupBoundary
    expect(result._tag).toBe("Settled")
    expect((yield* boundary.calls()).map((call) => call._tag)).toEqual(["Observe", "Remove", "Observe"])
  }).pipe(
    Effect.provide(
      branchCleanupTestLayer({
        observations: [
          present,
          BranchCleanupObservation.cases.Absent.make({
            branch: attempt.branch,
            revision: BranchCleanupEvidenceRevision.make(2)
          })
        ],
        mutations: [
          BranchCleanupMutationResult.cases.Removed.make({
            branch: attempt.branch,
            revision: BranchCleanupEvidenceRevision.make(2)
          })
        ]
      })
    ),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("does not let a self-consistent forged branch authorization suppress canonical derivation", () =>
  Effect.gen(function* () {
    yield* begin()
    const journal = yield* JournalStore
    const forged = BranchCleanupAuthorization.make({
      ...branchAuthorization,
      causalPredecessors: [OperationId.make("issue-69-foreign-branch-causal")],
      operationId: OperationId.make("issue-69-forged-branch-authorization")
    })
    yield* journal.append(
      runId,
      branchCleanupAuthorizedRecordKey(forged.operationId),
      BranchCleanupAuthorizedEvent.make({
        authorization: forged,
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        version: workflowJournalEventVersion
      })
    )
    const activation = yield* activateDispositionCleanup(runId)
    expect(activation.branch.map(({ operationId }) => operationId)).toEqual(["disposition-cleanup:branch:issue-69-p1"])
    expect((yield* journal.read(runId)).filter(({ event }) => event._tag === "BranchCleanupAuthorized")).toHaveLength(2)
  }).pipe(Effect.provide(branchCleanupTestLayer({ observations: [] })), Effect.provide(memoryJournalTestLayer))
)

it.effect("does not settle a branch removal with a stale revision", () =>
  Effect.gen(function* () {
    yield* begin()
    const result = yield* runBranchCleanup(branchAuthorization)
    const journal = yield* JournalStore
    const records = yield* journal.read(runId)
    expect(result._tag).toBe("Preserved")
    expect(records.map(({ event }) => event._tag)).toContain("BranchCleanupContradicted")
    expect(records.map(({ event }) => event._tag)).not.toContain("BranchCleanupSettled")
  }).pipe(
    Effect.provide(
      branchCleanupTestLayer({
        observations: [
          present,
          BranchCleanupObservation.cases.Absent.make({
            branch: attempt.branch,
            revision: BranchCleanupEvidenceRevision.make(2)
          })
        ],
        mutations: [
          BranchCleanupMutationResult.cases.Removed.make({
            branch: attempt.branch,
            revision: BranchCleanupEvidenceRevision.make(1)
          })
        ]
      })
    ),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("settles an already-absent branch without issuing a mutation", () =>
  Effect.gen(function* () {
    yield* begin()
    const result = yield* runBranchCleanup(branchAuthorization)
    const records = yield* (yield* JournalStore).read(runId)
    expect(result._tag).toBe("Settled")
    expect(records.map(({ event }) => event._tag)).toContain("BranchCleanupAbsenceConfirmed")
    expect((yield* (yield* TestBranchCleanupBoundary).calls()).map((call) => call._tag)).toEqual(["Observe"])
  }).pipe(
    Effect.provide(
      branchCleanupTestLayer({
        observations: [
          BranchCleanupObservation.cases.Absent.make({
            branch: attempt.branch,
            revision: BranchCleanupEvidenceRevision.make(1)
          })
        ]
      })
    ),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("preserves a post-mutation branch observation that is not absent", () =>
  Effect.gen(function* () {
    yield* begin()
    const result = yield* runBranchCleanup(branchAuthorization)
    const calls = yield* (yield* TestBranchCleanupBoundary).calls()
    expect(result._tag).toBe("Preserved")
    expect(calls.map((call) => call._tag)).toEqual(["Observe", "Remove", "Observe"])
  }).pipe(
    Effect.provide(
      branchCleanupTestLayer({
        observations: [
          present,
          BranchCleanupObservation.cases.Foreign.make({
            branch: attempt.branch,
            observedHead: baseSha,
            observedWorktree: WorktreeLocator.make("/tmp/other-branch-worktree"),
            reason: "RegisteredWorktree",
            revision: BranchCleanupEvidenceRevision.make(2)
          })
        ],
        mutations: [
          BranchCleanupMutationResult.cases.Removed.make({
            branch: attempt.branch,
            revision: BranchCleanupEvidenceRevision.make(2)
          })
        ]
      })
    ),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("uses the explicit unreadable fallback when the branch mutation script is exhausted", () =>
  Effect.gen(function* () {
    yield* begin()
    const result = yield* runBranchCleanup(branchAuthorization)
    const calls = yield* (yield* TestBranchCleanupBoundary).calls()
    expect(result).toMatchObject({ _tag: "Pending", reason: "script exhausted" })
    expect(calls.map((call) => call._tag)).toEqual(["Observe", "Remove"])
  }).pipe(Effect.provide(branchCleanupTestLayer({ observations: [present] })), Effect.provide(memoryJournalTestLayer))
)

it.effect("replays a contradicted branch without rereading or appending", () =>
  Effect.gen(function* () {
    yield* begin()
    const first = yield* runBranchCleanup(branchAuthorization)
    const second = yield* runBranchCleanup(branchAuthorization)
    const calls = yield* (yield* TestBranchCleanupBoundary).calls()
    expect(first._tag).toBe("Preserved")
    expect(second._tag).toBe("Preserved")
    expect(calls.map((call) => call._tag)).toEqual(["Observe"])
  }).pipe(
    Effect.provide(
      branchCleanupTestLayer({
        observations: [
          BranchCleanupObservation.cases.Foreign.make({
            branch: attempt.branch,
            observedHead: baseSha,
            observedWorktree: WorktreeLocator.make("/tmp/other-branch-worktree"),
            reason: "RegisteredWorktree",
            revision: BranchCleanupEvidenceRevision.make(1)
          })
        ]
      })
    ),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("replays a settled branch twice without a boundary call or journal write", () =>
  Effect.gen(function* () {
    yield* begin()
    const first = yield* runBranchCleanup(branchAuthorization)
    const journal = yield* JournalStore
    const afterFirst = yield* journal.read(runId)
    const second = yield* runBranchCleanup(branchAuthorization)
    const afterSecond = yield* journal.read(runId)
    const third = yield* runBranchCleanup(branchAuthorization)
    const afterThird = yield* journal.read(runId)
    const calls = yield* (yield* TestBranchCleanupBoundary).calls()
    expect([first, second, third].map((result) => result._tag)).toEqual(["Settled", "Settled", "Settled"])
    expect(afterSecond).toEqual(afterFirst)
    expect(afterThird).toEqual(afterFirst)
    expect(calls.map((call) => call._tag)).toEqual(["Observe", "Remove", "Observe"])
  }).pipe(
    Effect.provide(
      branchCleanupTestLayer({
        observations: [
          present,
          BranchCleanupObservation.cases.Absent.make({
            branch: attempt.branch,
            revision: BranchCleanupEvidenceRevision.make(2)
          })
        ],
        mutations: [
          BranchCleanupMutationResult.cases.Removed.make({
            branch: attempt.branch,
            revision: BranchCleanupEvidenceRevision.make(2)
          })
        ]
      })
    ),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("does not read or mutate a branch before worktree cleanup settles", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("issue-69-branch-gate"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    const result = yield* runBranchCleanup(branchAuthorization)
    const boundary = yield* TestBranchCleanupBoundary
    expect(result._tag).toBe("Preserved")
    expect(yield* boundary.calls()).toEqual([])
  }).pipe(Effect.provide(branchCleanupTestLayer({ observations: [present] })), Effect.provide(memoryJournalTestLayer))
)

it.effect("preserves a branch whose fresh observation still has a registered worktree", () =>
  Effect.gen(function* () {
    yield* begin()
    const result = yield* runBranchCleanup(branchAuthorization)
    const boundary = yield* TestBranchCleanupBoundary
    expect(result._tag).toBe("Preserved")
    expect((yield* boundary.calls()).map((call) => call._tag)).toEqual(["Observe"])
  }).pipe(
    Effect.provide(
      branchCleanupTestLayer({
        observations: [
          BranchCleanupObservation.cases.Present.make({
            branch: attempt.branch,
            headSha: baseSha,
            registeredWorktree: attempt.worktree,
            revision: BranchCleanupEvidenceRevision.make(1)
          })
        ]
      })
    ),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("does not call a branch boundary when the journaled authorization is replayed with changed facts", () =>
  Effect.gen(function* () {
    yield* begin()
    const first = yield* runBranchCleanup(branchAuthorization)
    const replay = BranchCleanupAuthorization.make({
      ...branchAuthorization,
      expectedHead: GitCommitSha.make("2".repeat(40))
    })
    const second = yield* runBranchCleanup(replay)
    const boundary = yield* TestBranchCleanupBoundary
    expect(first._tag).toBe("Pending")
    expect(second._tag).toBe("Preserved")
    expect((yield* boundary.calls()).map((call) => call._tag)).toEqual(["Observe", "Remove"])
  }).pipe(
    Effect.provide(
      branchCleanupTestLayer({
        observations: [present],
        mutations: [BranchCleanupMutationResult.cases.Unknown.make({ branch: attempt.branch, detail: "lost" })]
      })
    ),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("reconciles a lost branch response after restart without duplicate removal", () =>
  Effect.gen(function* () {
    yield* begin()
    const first = yield* runBranchCleanup(branchAuthorization)
    const second = yield* runBranchCleanup(branchAuthorization)
    const boundary = yield* TestBranchCleanupBoundary
    expect(first._tag).toBe("Pending")
    expect(second._tag).toBe("Settled")
    expect((yield* boundary.calls()).map((call) => call._tag)).toEqual(["Observe", "Remove", "Observe"])
  }).pipe(
    Effect.provide(
      branchCleanupTestLayer({
        observations: [
          present,
          BranchCleanupObservation.cases.Absent.make({
            branch: attempt.branch,
            revision: BranchCleanupEvidenceRevision.make(2)
          })
        ],
        mutations: [
          BranchCleanupMutationResult.cases.Unknown.make({
            branch: attempt.branch,
            detail: "response lost after apply"
          })
        ]
      })
    ),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("preserves a branch when the mutation response names a foreign branch", () =>
  Effect.gen(function* () {
    yield* begin()
    const result = yield* runBranchCleanup(branchAuthorization)
    const boundary = yield* TestBranchCleanupBoundary
    const records = yield* (yield* JournalStore).read(runId)
    expect(result._tag).toBe("Preserved")
    expect((yield* boundary.calls()).map((call) => call._tag)).toEqual(["Observe", "Remove"])
    expect(records.map(({ event }) => event._tag)).toContain("BranchCleanupContradicted")
  }).pipe(
    Effect.provide(
      branchCleanupTestLayer({
        observations: [present],
        mutations: [
          BranchCleanupMutationResult.cases.Removed.make({
            branch: TaskBranchRef.make("refs/heads/foreign-branch"),
            revision: BranchCleanupEvidenceRevision.make(1)
          })
        ]
      })
    ),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("stops branch mutation retries at the exact three-request bound", () =>
  Effect.gen(function* () {
    yield* begin()
    const results = [
      yield* runBranchCleanup(branchAuthorization),
      yield* runBranchCleanup(branchAuthorization),
      yield* runBranchCleanup(branchAuthorization),
      yield* runBranchCleanup(branchAuthorization)
    ]
    const boundary = yield* TestBranchCleanupBoundary
    expect(results.map((result) => result._tag)).toEqual(["Pending", "Pending", "Pending", "Pending"])
    expect(results.at(-1)).toMatchObject({ attempts: 3 })
    expect((yield* boundary.calls()).map((call) => call._tag)).toEqual([
      "Observe",
      "Remove",
      "Observe",
      "Remove",
      "Observe",
      "Remove",
      "Observe"
    ])
  }).pipe(
    Effect.provide(
      branchCleanupTestLayer({
        observations: [present, present, present, present],
        mutations: [
          BranchCleanupMutationResult.cases.Unknown.make({ branch: attempt.branch, detail: "response lost: 1" }),
          BranchCleanupMutationResult.cases.DefinitelyNotApplied.make({ branch: attempt.branch, detail: "retry: 2" }),
          BranchCleanupMutationResult.cases.Unknown.make({ branch: attempt.branch, detail: "response lost: 3" })
        ]
      })
    ),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("preserves a branch when its cleanup history has no authorization prefix", () =>
  Effect.gen(function* () {
    yield* begin()
    const journal = yield* JournalStore
    const ordinal = CleanupObservationOrdinal.make(1)
    yield* journal.append(
      runId,
      branchCleanupObservationIntendedRecordKey(branchAuthorization.operationId, ordinal),
      BranchCleanupObservationIntendedEvent.make({
        authorization: branchAuthorization,
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        operationId: OperationId.make(`${branchAuthorization.operationId}:observe:${ordinal}`),
        ordinal,
        version: workflowJournalEventVersion
      })
    )
    const result = yield* runBranchCleanup(branchAuthorization)
    expect(result._tag).toBe("Preserved")
    expect(yield* (yield* TestBranchCleanupBoundary).calls()).toEqual([])
  }).pipe(Effect.provide(branchCleanupTestLayer({ observations: [present] })), Effect.provide(memoryJournalTestLayer))
)
