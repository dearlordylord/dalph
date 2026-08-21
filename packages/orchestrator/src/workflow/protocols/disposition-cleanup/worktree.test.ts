import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import {
  AttemptId,
  GitRepositoryLocator,
  GitCommitSha,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskId,
  TaskRevision,
  TaskExecutorLocator,
  WorktreeLocator,
  encodeTaskRevisionFingerprint
} from "@dalph/contracts"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { InitialControlPolicy } from "../../../control/policy.js"
import { TaskWorkCapacity } from "../../../coordination/admission/capacity.js"
import { OperationId } from "../../identity.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import { JournalStore } from "../../../workflow-journal/store.js"
import { memoryJournalTestLayer } from "../../../workflow-journal/adapters/memory-store.js"
import {
  outcomeRecordKey,
  intentRecordKey,
  plannedAttemptExecutorCommandIntendedRecordKey,
  worktreeCleanupObservationIntendedRecordKey,
  worktreeCleanupAuthorizedRecordKey
} from "../../../workflow-journal/record-key.js"
import { GitReadIntentRecordedEvent, TargetLineageObservedEvent } from "../../registry/event.js"
import { makeTargetLineageObservationOperation } from "../../registry/operation.js"
import {
  CleanupObservationOrdinal,
  BranchCleanupEvidenceRevision,
  isCleanupEligibleDisposition,
  PlannedAttemptCleanupDisposition,
  WorktreeCleanupAuthorization,
  WorktreeCleanupEvidenceRevision,
  WorktreeCleanupOwner
} from "./disposition.js"
import {
  runWorktreeCleanup,
  TestWorktreeCleanupBoundary,
  worktreeCleanupTestLayer,
  WorktreeCleanupMutationResult,
  WorktreeCleanupObservationIntendedEvent,
  WorktreeCleanupObservation,
  WorktreeCleanupAuthorizedEvent
} from "./worktree.js"
import { BranchCleanupMutationResult, BranchCleanupObservation, branchCleanupTestLayer } from "./branch.js"
import { integratorCandidateCleanupTestLayer } from "./integrator-candidate.js"
import { activateDispositionCleanup, makeDispositionCleanupActivation, runDispositionCleanupLoop } from "./loop.js"
import {
  appendAbandonedProvenance,
  appendReplacementProvenance,
  replacementPredecessorsFor,
  replacementWorktreeObservationOperationIdFor
} from "./provenance-fixtures.js"
import { validateWorktreeCleanupHistory } from "./provenance.js"
import {
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal
} from "../planned-attempt-executor-work/events.js"

const runId = RunId.make("issue-69-worktree-run")
const baseSha = GitCommitSha.make("1111111111111111111111111111111111111111")
const attempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("issue-69-p1"),
  baseSha,
  branch: TaskBranchRef.make("refs/heads/task/issue-69-p1"),
  executor: TaskExecutorLocator.make("executor:issue-69"),
  runId,
  taskId: TaskId.make("issue-69-task"),
  taskRevision: TaskRevision.make("revision:1"),
  worktree: WorktreeLocator.make("/tmp/issue-69-p1")
})
const successor = PlannedTaskAttempt.make({
  ...attempt,
  attemptId: AttemptId.make("issue-69-p2"),
  branch: TaskBranchRef.make("refs/heads/task/issue-69-p2"),
  taskRevision: encodeTaskRevisionFingerprint(
    JSON.stringify({ body: "cleanup provenance witness", title: "cleanup provenance witness" })
  ),
  worktree: WorktreeLocator.make("/tmp/issue-69-p2")
})
const disposition = PlannedAttemptCleanupDisposition.cases.Superseded.make({
  dispositionAt: JournalPosition.make(19),
  plannedAttempt: attempt,
  successorAttempt: successor
})
const authorization = WorktreeCleanupAuthorization.make({
  causalPredecessors: replacementPredecessorsFor(attempt),
  disposition,
  evidenceRevision: WorktreeCleanupEvidenceRevision.make(1),
  expectedHead: baseSha,
  locator: attempt.worktree,
  observationAt: JournalPosition.make(16),
  observationOperationId: replacementWorktreeObservationOperationIdFor(attempt),
  operationId: OperationId.make("issue-69-worktree-cleanup"),
  owner: WorktreeCleanupOwner.make({ attemptId: attempt.attemptId, branch: attempt.branch }),
  writerQuiescent: true
})

const setup = (
  observations: ReadonlyArray<WorktreeCleanupObservation>,
  mutations: ReadonlyArray<WorktreeCleanupMutationResult> = []
) =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("issue-69-target"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    yield* appendReplacementProvenance(attempt, successor)
    const result = yield* runWorktreeCleanup(authorization)
    const calls = yield* TestWorktreeCleanupBoundary
    return { calls: yield* calls.calls(), result }
  }).pipe(Effect.provide(worktreeCleanupTestLayer({ observations, mutations })), Effect.provide(memoryJournalTestLayer))

const present = WorktreeCleanupObservation.cases.Present.make({
  attemptId: attempt.attemptId,
  branch: attempt.branch,
  headSha: baseSha,
  locator: attempt.worktree,
  revision: WorktreeCleanupEvidenceRevision.make(1),
  writerQuiescent: true
})

const secondAttempt = PlannedTaskAttempt.make({
  ...attempt,
  attemptId: AttemptId.make("issue-69-p1-second"),
  branch: TaskBranchRef.make("refs/heads/task/issue-69-p1-second"),
  worktree: WorktreeLocator.make("/tmp/issue-69-p1-second")
})

const loopAttempt = (suffix: string) =>
  PlannedTaskAttempt.make({
    ...attempt,
    attemptId: AttemptId.make(`issue-69-${suffix}`),
    branch: TaskBranchRef.make(`refs/heads/task/issue-69-${suffix}`),
    taskRevision: TaskRevision.make(`revision:${suffix}`),
    worktree: WorktreeLocator.make(`/tmp/issue-69-${suffix}`)
  })

it.effect("removes the exact superseded worktree after fresh matching facts", () =>
  setup(
    [
      present,
      WorktreeCleanupObservation.cases.Absent.make({
        locator: attempt.worktree,
        revision: WorktreeCleanupEvidenceRevision.make(2)
      })
    ],
    [
      WorktreeCleanupMutationResult.cases.Removed.make({
        branch: attempt.branch,
        locator: attempt.worktree,
        revision: WorktreeCleanupEvidenceRevision.make(2)
      })
    ]
  ).pipe(
    Effect.tap(({ calls, result }) =>
      Effect.sync(() => {
        expect(result._tag).toBe("Settled")
        expect(calls.map((call) => call._tag)).toEqual(["Observe", "Remove", "Observe"])
      })
    )
  )
)

it.effect("ordinary activation selects two exact worktree operations independently and excludes a contradiction", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("issue-69-ordinary-cleanup-activation"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    const firstAuthorization = yield* appendAbandonedProvenance(attempt, OperationId.make("issue-69-valid-cleanup-1"))
    const secondAuthorization = yield* appendAbandonedProvenance(
      secondAttempt,
      OperationId.make("issue-69-valid-cleanup-2")
    )
    const contradictoryAuthorization = WorktreeCleanupAuthorization.make({
      ...firstAuthorization,
      expectedHead: GitCommitSha.make("2".repeat(40)),
      operationId: OperationId.make("issue-69-contradictory-cleanup")
    })
    yield* journal.append(
      runId,
      worktreeCleanupAuthorizedRecordKey(firstAuthorization.operationId),
      WorktreeCleanupAuthorizedEvent.make({
        authorization: firstAuthorization,
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        version: workflowJournalEventVersion
      })
    )
    yield* journal.append(
      runId,
      worktreeCleanupAuthorizedRecordKey(secondAuthorization.operationId),
      WorktreeCleanupAuthorizedEvent.make({
        authorization: secondAuthorization,
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        version: workflowJournalEventVersion
      })
    )
    yield* journal.append(
      runId,
      worktreeCleanupAuthorizedRecordKey(contradictoryAuthorization.operationId),
      WorktreeCleanupAuthorizedEvent.make({
        authorization: contradictoryAuthorization,
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        version: workflowJournalEventVersion
      })
    )
    const activated = yield* activateDispositionCleanup(runId)
    expect(activated.worktree.map(({ operationId }) => operationId)).toEqual([
      firstAuthorization.operationId,
      secondAuthorization.operationId
    ])
    const loop = yield* runDispositionCleanupLoop(runId)
    expect(loop.worktreeOutcomes.map(({ _tag }) => _tag)).toEqual(["Settled", "Settled"])
    expect(loop.worktreeOutcomes.map(({ authorization }) => authorization.operationId)).toEqual([
      firstAuthorization.operationId,
      secondAuthorization.operationId
    ])
    expect((yield* (yield* TestWorktreeCleanupBoundary).calls()).map(({ operationId }) => operationId)).not.toContain(
      contradictoryAuthorization.operationId
    )
  }).pipe(
    Effect.provide(
      worktreeCleanupTestLayer({
        observations: [
          present,
          WorktreeCleanupObservation.cases.Absent.make({
            locator: attempt.worktree,
            revision: WorktreeCleanupEvidenceRevision.make(2)
          }),
          WorktreeCleanupObservation.cases.Present.make({
            attemptId: secondAttempt.attemptId,
            branch: secondAttempt.branch,
            headSha: secondAttempt.baseSha,
            locator: secondAttempt.worktree,
            revision: WorktreeCleanupEvidenceRevision.make(1),
            writerQuiescent: true
          }),
          WorktreeCleanupObservation.cases.Absent.make({
            locator: secondAttempt.worktree,
            revision: WorktreeCleanupEvidenceRevision.make(2)
          })
        ],
        mutations: [
          WorktreeCleanupMutationResult.cases.Removed.make({
            branch: attempt.branch,
            locator: attempt.worktree,
            revision: WorktreeCleanupEvidenceRevision.make(2)
          }),
          WorktreeCleanupMutationResult.cases.Removed.make({
            branch: secondAttempt.branch,
            locator: secondAttempt.worktree,
            revision: WorktreeCleanupEvidenceRevision.make(2)
          })
        ]
      })
    ),
    Effect.provide(branchCleanupTestLayer({ observations: [] })),
    Effect.provide(integratorCandidateCleanupTestLayer({ observations: [] })),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("ordinary activation derives authorization from terminal facts before crossing the boundary", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("issue-69-terminal-facts-activation"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    yield* appendAbandonedProvenance(attempt, OperationId.make("issue-69-terminal-facts"))
    const before = yield* journal.read(runId)
    expect(before.some(({ event }) => event._tag === "WorktreeCleanupAuthorized")).toBe(false)

    const activated = yield* makeDispositionCleanupActivation(runId)
    const authorization = activated.responsibilities.worktree[0]
    expect(authorization).toBeDefined()
    if (authorization === undefined) return
    const afterAuthorization = yield* journal.read(runId)
    expect(afterAuthorization.map(({ event }) => event._tag)).toContain("WorktreeCleanupAuthorized")

    const result = yield* activated.run
    expect(result.worktreeOutcomes.map(({ _tag }) => _tag)).toEqual(["Settled"])
    expect(result.worktreeOutcomes[0]?.authorization.operationId).toBe(authorization.operationId)
    expect((yield* (yield* TestWorktreeCleanupBoundary).calls()).map(({ _tag }) => _tag)).toEqual([
      "Observe",
      "Remove",
      "Observe"
    ])
    const finalRecords = yield* journal.read(runId)
    expect(finalRecords.map(({ event }) => event._tag)).toContain("WorktreeCleanupSettled")
  }).pipe(
    Effect.provide(
      worktreeCleanupTestLayer({
        observations: [
          present,
          WorktreeCleanupObservation.cases.Absent.make({
            locator: attempt.worktree,
            revision: WorktreeCleanupEvidenceRevision.make(2)
          })
        ],
        mutations: [
          WorktreeCleanupMutationResult.cases.Removed.make({
            branch: attempt.branch,
            locator: attempt.worktree,
            revision: WorktreeCleanupEvidenceRevision.make(2)
          })
        ]
      })
    ),
    Effect.provide(branchCleanupTestLayer({ observations: [] })),
    Effect.provide(integratorCandidateCleanupTestLayer({ observations: [] })),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("ordinary activation runs two terminal responsibilities and excludes a forged authorization", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("issue-69-two-terminal-facts"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    yield* appendAbandonedProvenance(attempt, OperationId.make("issue-69-two-terminal-first"))
    yield* appendAbandonedProvenance(secondAttempt, OperationId.make("issue-69-two-terminal-second"))
    const activation = yield* makeDispositionCleanupActivation(runId)
    const validAuthorizations = activation.responsibilities.worktree
    expect(validAuthorizations).toHaveLength(2)
    const first = validAuthorizations[0]
    if (first === undefined) return
    const forged = WorktreeCleanupAuthorization.make({
      ...first,
      expectedHead: GitCommitSha.make("2".repeat(40)),
      operationId: OperationId.make("issue-69-forged-terminal-authorization")
    })
    yield* journal.append(
      runId,
      worktreeCleanupAuthorizedRecordKey(forged.operationId),
      WorktreeCleanupAuthorizedEvent.make({
        authorization: forged,
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        version: workflowJournalEventVersion
      })
    )
    const result = yield* activation.run
    expect(result.worktreeOutcomes.map(({ _tag }) => _tag)).toEqual(["Settled", "Settled"])
    expect(result.worktreeOutcomes.map(({ authorization }) => authorization.operationId)).toEqual(
      validAuthorizations.map(({ operationId }) => operationId)
    )
    const calls = yield* (yield* TestWorktreeCleanupBoundary).calls()
    expect(calls.filter(({ operationId }) => operationId === forged.operationId)).toEqual([])
    expect(calls.filter(({ _tag }) => _tag === "Remove")).toHaveLength(2)
  }).pipe(
    Effect.provide(
      worktreeCleanupTestLayer({
        observations: [
          present,
          WorktreeCleanupObservation.cases.Absent.make({
            locator: attempt.worktree,
            revision: WorktreeCleanupEvidenceRevision.make(2)
          }),
          WorktreeCleanupObservation.cases.Present.make({
            attemptId: secondAttempt.attemptId,
            branch: secondAttempt.branch,
            headSha: secondAttempt.baseSha,
            locator: secondAttempt.worktree,
            revision: WorktreeCleanupEvidenceRevision.make(1),
            writerQuiescent: true
          }),
          WorktreeCleanupObservation.cases.Absent.make({
            locator: secondAttempt.worktree,
            revision: WorktreeCleanupEvidenceRevision.make(2)
          })
        ],
        mutations: [
          WorktreeCleanupMutationResult.cases.Removed.make({
            branch: attempt.branch,
            locator: attempt.worktree,
            revision: WorktreeCleanupEvidenceRevision.make(2)
          }),
          WorktreeCleanupMutationResult.cases.Removed.make({
            branch: secondAttempt.branch,
            locator: secondAttempt.worktree,
            revision: WorktreeCleanupEvidenceRevision.make(2)
          })
        ]
      })
    ),
    Effect.provide(branchCleanupTestLayer({ observations: [] })),
    Effect.provide(integratorCandidateCleanupTestLayer({ observations: [] })),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("converges past the three-responsibility activation cap", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("issue-69-more-than-three-responsibilities"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    const attempts = [attempt, secondAttempt, loopAttempt("p3"), loopAttempt("p4")]
    for (const [index, plannedAttempt] of attempts.entries()) {
      yield* appendAbandonedProvenance(plannedAttempt, OperationId.make(`issue-69-fourth-cap-${index + 1}`))
    }

    const first = yield* runDispositionCleanupLoop(runId)
    expect(first.worktreeOutcomes).toHaveLength(3)
    expect(first.branchOutcomes).toHaveLength(3)
    expect(first.worktreeOutcomes.every(({ _tag }) => _tag === "Settled")).toBe(true)
    expect(first.branchOutcomes.every(({ _tag }) => _tag === "Settled")).toBe(true)

    const second = yield* runDispositionCleanupLoop(runId)
    expect(second.worktreeOutcomes).toHaveLength(1)
    expect(second.branchOutcomes).toHaveLength(1)
    expect(second.worktreeOutcomes[0]?._tag).toBe("Settled")
    expect(second.branchOutcomes[0]?._tag).toBe("Settled")

    const records = yield* journal.read(runId)
    expect(records.filter(({ event }) => event._tag === "WorktreeCleanupSettled")).toHaveLength(4)
    expect(records.filter(({ event }) => event._tag === "BranchCleanupSettled")).toHaveLength(4)
    expect((yield* (yield* TestWorktreeCleanupBoundary).calls()).filter(({ _tag }) => _tag === "Remove")).toHaveLength(
      4
    )
  }).pipe(
    Effect.provide(
      worktreeCleanupTestLayer({
        observations: [
          ...[attempt, secondAttempt, loopAttempt("p3"), loopAttempt("p4")].flatMap((plannedAttempt) => [
            WorktreeCleanupObservation.cases.Present.make({
              attemptId: plannedAttempt.attemptId,
              branch: plannedAttempt.branch,
              headSha: plannedAttempt.baseSha,
              locator: plannedAttempt.worktree,
              revision: WorktreeCleanupEvidenceRevision.make(1),
              writerQuiescent: true
            }),
            WorktreeCleanupObservation.cases.Absent.make({
              locator: plannedAttempt.worktree,
              revision: WorktreeCleanupEvidenceRevision.make(1)
            })
          ])
        ],
        mutations: [
          ...[attempt, secondAttempt, loopAttempt("p3"), loopAttempt("p4")].map((plannedAttempt) =>
            WorktreeCleanupMutationResult.cases.Removed.make({
              branch: plannedAttempt.branch,
              locator: plannedAttempt.worktree,
              revision: WorktreeCleanupEvidenceRevision.make(1)
            })
          )
        ]
      })
    ),
    Effect.provide(
      branchCleanupTestLayer({
        observations: [
          ...[attempt, secondAttempt, loopAttempt("p3"), loopAttempt("p4")].flatMap((plannedAttempt) => [
            BranchCleanupObservation.cases.Present.make({
              branch: plannedAttempt.branch,
              headSha: plannedAttempt.baseSha,
              registeredWorktree: null,
              revision: BranchCleanupEvidenceRevision.make(1)
            }),
            BranchCleanupObservation.cases.Absent.make({
              branch: plannedAttempt.branch,
              revision: BranchCleanupEvidenceRevision.make(1)
            })
          ])
        ],
        mutations: [
          ...[attempt, secondAttempt, loopAttempt("p3"), loopAttempt("p4")].map((plannedAttempt) =>
            BranchCleanupMutationResult.cases.Removed.make({
              branch: plannedAttempt.branch,
              revision: BranchCleanupEvidenceRevision.make(1)
            })
          )
        ]
      })
    ),
    Effect.provide(integratorCandidateCleanupTestLayer({ observations: [] })),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("removes an abandoned worktree only after the durable Stop and executor witness", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("issue-69-abandoned-worktree"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    const abandonedAuthorization = yield* appendAbandonedProvenance(attempt)
    const result = yield* runWorktreeCleanup(abandonedAuthorization)
    expect(result._tag).toBe("Settled")
    expect((yield* (yield* TestWorktreeCleanupBoundary).calls()).map((call) => call._tag)).toEqual([
      "Observe",
      "Remove",
      "Observe"
    ])
  }).pipe(
    Effect.provide(
      worktreeCleanupTestLayer({
        observations: [
          present,
          WorktreeCleanupObservation.cases.Absent.make({
            locator: attempt.worktree,
            revision: WorktreeCleanupEvidenceRevision.make(2)
          })
        ],
        mutations: [
          WorktreeCleanupMutationResult.cases.Removed.make({
            branch: attempt.branch,
            locator: attempt.worktree,
            revision: WorktreeCleanupEvidenceRevision.make(2)
          })
        ]
      })
    ),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("preserves an abandoned cleanup when a later executor command follows the safe report", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("issue-69-abandoned-later-command"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    const abandonedAuthorization = yield* appendAbandonedProvenance(attempt)
    const laterOrdinal = PlannedAttemptExecutorCommandOrdinal.make(2)
    yield* journal.append(
      runId,
      plannedAttemptExecutorCommandIntendedRecordKey(attempt.attemptId, laterOrdinal),
      PlannedAttemptExecutorCommandIntendedEvent.make({
        command: "StartOrContinue",
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        ordinal: laterOrdinal,
        plannedAttempt: attempt,
        version: workflowJournalEventVersion
      })
    )
    const result = yield* runWorktreeCleanup(abandonedAuthorization)
    expect(result._tag).toBe("Preserved")
    expect(yield* (yield* TestWorktreeCleanupBoundary).calls()).toEqual([])
  }).pipe(Effect.provide(worktreeCleanupTestLayer({ observations: [present] })), Effect.provide(memoryJournalTestLayer))
)

it.effect("replays a settled worktree twice without a boundary call or journal write", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("issue-69-worktree-settled-replay"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    yield* appendReplacementProvenance(attempt, successor)
    const first = yield* runWorktreeCleanup(authorization)
    const afterFirst = yield* journal.read(runId)
    const second = yield* runWorktreeCleanup(authorization)
    const afterSecond = yield* journal.read(runId)
    const third = yield* runWorktreeCleanup(authorization)
    const afterThird = yield* journal.read(runId)
    const calls = yield* (yield* TestWorktreeCleanupBoundary).calls()
    expect([first, second, third].map((result) => result._tag)).toEqual(["Settled", "Settled", "Settled"])
    expect(afterSecond).toEqual(afterFirst)
    expect(afterThird).toEqual(afterFirst)
    expect(calls.map((call) => call._tag)).toEqual(["Observe", "Remove", "Observe"])
  }).pipe(
    Effect.provide(
      worktreeCleanupTestLayer({
        observations: [
          present,
          WorktreeCleanupObservation.cases.Absent.make({
            locator: attempt.worktree,
            revision: WorktreeCleanupEvidenceRevision.make(2)
          })
        ],
        mutations: [
          WorktreeCleanupMutationResult.cases.Removed.make({
            branch: attempt.branch,
            locator: attempt.worktree,
            revision: WorktreeCleanupEvidenceRevision.make(2)
          })
        ]
      })
    ),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("does not call a boundary when a replayed operation has different authorization facts", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("issue-69-authorization-replay"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    yield* appendReplacementProvenance(attempt, successor)
    const first = yield* runWorktreeCleanup(authorization)
    const replayedAuthorization = WorktreeCleanupAuthorization.make({
      ...authorization,
      expectedHead: GitCommitSha.make("2".repeat(40))
    })
    const second = yield* runWorktreeCleanup(replayedAuthorization)
    const calls = yield* (yield* TestWorktreeCleanupBoundary).calls()
    expect(first._tag).toBe("Pending")
    expect(second._tag).toBe("Preserved")
    expect(calls.map((call) => call._tag)).toEqual(["Observe", "Remove"])
  }).pipe(
    Effect.provide(
      worktreeCleanupTestLayer({
        observations: [present],
        mutations: [
          WorktreeCleanupMutationResult.cases.Unknown.make({
            branch: attempt.branch,
            detail: "lost",
            locator: attempt.worktree
          })
        ]
      })
    ),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("records initial absence as reconciliation, never as a mutation result", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("issue-69-initial-absence"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    yield* appendReplacementProvenance(attempt, successor)
    const result = yield* runWorktreeCleanup(authorization)
    const records = yield* journal.read(runId)
    expect(result._tag).toBe("Settled")
    expect(records.map(({ event }) => event._tag)).not.toContain("WorktreeCleanupMutationResultRecorded")
    expect(records.map(({ event }) => event._tag)).toContain("WorktreeCleanupAbsenceConfirmed")
  }).pipe(
    Effect.provide(
      worktreeCleanupTestLayer({
        observations: [
          WorktreeCleanupObservation.cases.Absent.make({
            locator: attempt.worktree,
            revision: WorktreeCleanupEvidenceRevision.make(2)
          })
        ]
      })
    ),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("preserves a caller-made disposition when durable terminal provenance is missing", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("issue-69-missing-provenance"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    const result = yield* runWorktreeCleanup(authorization)
    const calls = yield* (yield* TestWorktreeCleanupBoundary).calls()
    expect(result._tag).toBe("Preserved")
    expect(calls).toEqual([])
  }).pipe(Effect.provide(worktreeCleanupTestLayer({ observations: [present] })), Effect.provide(memoryJournalTestLayer))
)

it.effect("preserves an invalid successful mutation response instead of settling", () =>
  setup(
    [present],
    [
      WorktreeCleanupMutationResult.cases.Removed.make({
        branch: attempt.branch,
        locator: WorktreeLocator.make("/tmp/foreign-worktree"),
        revision: WorktreeCleanupEvidenceRevision.make(2)
      })
    ]
  ).pipe(
    Effect.tap(({ calls, result }) =>
      Effect.sync(() => {
        expect(result._tag).toBe("Preserved")
        expect(calls.map((call) => call._tag)).toEqual(["Observe", "Remove"])
      })
    )
  )
)

it("rejects a superseded disposition that reuses predecessor identity", () => {
  expect(() =>
    PlannedAttemptCleanupDisposition.cases.Superseded.make({
      dispositionAt: JournalPosition.make(3),
      plannedAttempt: attempt,
      successorAttempt: attempt
    })
  ).toThrow()
})

it.effect("preserves changed or unreadable worktree facts without a remove call", () =>
  setup([
    WorktreeCleanupObservation.cases.Foreign.make({
      locator: attempt.worktree,
      observedBranch: TaskBranchRef.make("refs/heads/other"),
      observedHead: baseSha,
      reason: "OtherBranch",
      revision: WorktreeCleanupEvidenceRevision.make(2)
    })
  ]).pipe(
    Effect.tap(({ calls, result }) =>
      Effect.sync(() => {
        expect(result._tag).toBe("Preserved")
        expect(calls.map((call) => call._tag)).toEqual(["Observe"])
      })
    )
  )
)

it.effect("reconciles an applied response loss with a fresh absence and never duplicates remove", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("issue-69-target-loss"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    yield* appendReplacementProvenance(attempt, successor)
    const first = yield* runWorktreeCleanup(authorization).pipe(
      Effect.provide(
        worktreeCleanupTestLayer({
          observations: [
            present,
            WorktreeCleanupObservation.cases.Absent.make({
              locator: attempt.worktree,
              revision: WorktreeCleanupEvidenceRevision.make(2)
            })
          ],
          mutations: [
            WorktreeCleanupMutationResult.cases.Unknown.make({
              branch: attempt.branch,
              detail: "response lost",
              locator: attempt.worktree
            })
          ]
        })
      )
    )
    const second = yield* runWorktreeCleanup(authorization).pipe(
      Effect.provide(
        worktreeCleanupTestLayer({
          observations: [
            WorktreeCleanupObservation.cases.Absent.make({
              locator: attempt.worktree,
              revision: WorktreeCleanupEvidenceRevision.make(2)
            })
          ]
        })
      )
    )
    expect(first._tag).toBe("Pending")
    expect(second._tag).toBe("Settled")
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

const boundBoundaryLayer = worktreeCleanupTestLayer({
  observations: [present],
  mutations: [
    WorktreeCleanupMutationResult.cases.Unknown.make({
      branch: attempt.branch,
      detail: "unknown",
      locator: attempt.worktree
    }),
    WorktreeCleanupMutationResult.cases.Unknown.make({
      branch: attempt.branch,
      detail: "unknown",
      locator: attempt.worktree
    }),
    WorktreeCleanupMutationResult.cases.Unknown.make({
      branch: attempt.branch,
      detail: "unknown",
      locator: attempt.worktree
    })
  ]
})

it.effect("stops after the three-request cleanup bound", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("issue-69-target-bound"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    yield* appendReplacementProvenance(attempt, successor)
    const first = yield* runWorktreeCleanup(authorization)
    const second = yield* runWorktreeCleanup(authorization)
    const third = yield* runWorktreeCleanup(authorization)
    const fourth = yield* runWorktreeCleanup(authorization)
    expect([first, second, third].map((value) => value._tag)).toEqual(["Pending", "Pending", "Pending"])
    expect(fourth._tag).toBe("Pending")
    const boundary = yield* TestWorktreeCleanupBoundary
    expect((yield* boundary.calls()).filter((call) => call._tag === "Remove")).toHaveLength(3)
  }).pipe(Effect.provide(boundBoundaryLayer), Effect.provide(memoryJournalTestLayer))
)

it.effect("rejects a settlement whose result names a foreign worktree", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("issue-69-foreign-settlement"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    yield* appendReplacementProvenance(attempt, successor)
    const settled = yield* runWorktreeCleanup(authorization)
    expect(settled._tag).toBe("Settled")
    const records = yield* journal.read(runId)
    const foreign = records.map((record) =>
      record.event._tag === "WorktreeCleanupSettled"
        ? {
            ...record,
            event: {
              ...record.event,
              result: { ...record.event.result, locator: WorktreeLocator.make("/tmp/foreign-settlement") }
            }
          }
        : record
    )
    expect(validateWorktreeCleanupHistory(foreign, authorization)._tag).toBe("Invalid")
  }).pipe(
    Effect.provide(
      worktreeCleanupTestLayer({
        observations: [
          present,
          WorktreeCleanupObservation.cases.Absent.make({
            locator: attempt.worktree,
            revision: WorktreeCleanupEvidenceRevision.make(2)
          })
        ],
        mutations: [
          WorktreeCleanupMutationResult.cases.Removed.make({
            branch: attempt.branch,
            locator: attempt.worktree,
            revision: WorktreeCleanupEvidenceRevision.make(2)
          })
        ]
      })
    ),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("preserves a cleanup family event that has no authorization prefix", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("issue-69-missing-authorization-prefix"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    yield* appendReplacementProvenance(attempt, successor)
    const ordinal = CleanupObservationOrdinal.make(1)
    const operationId = OperationId.make(`${authorization.operationId}:observe:${ordinal}`)
    yield* journal.append(
      runId,
      worktreeCleanupObservationIntendedRecordKey(authorization.operationId, ordinal),
      WorktreeCleanupObservationIntendedEvent.make({
        authorization,
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        operationId,
        ordinal,
        version: workflowJournalEventVersion
      })
    )
    const result = yield* runWorktreeCleanup(authorization)
    expect(result._tag).toBe("Preserved")
    expect(yield* (yield* TestWorktreeCleanupBoundary).calls()).toEqual([])
  }).pipe(Effect.provide(worktreeCleanupTestLayer({ observations: [present] })), Effect.provide(memoryJournalTestLayer))
)

it.effect("ignores malformed cleanup history for an unrelated operation", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("issue-69-unrelated-operation"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    yield* appendReplacementProvenance(attempt, successor)
    const unrelated = WorktreeCleanupAuthorization.make({
      ...authorization,
      operationId: OperationId.make("issue-69-unrelated-cleanup")
    })
    const ordinal = CleanupObservationOrdinal.make(1)
    yield* journal.append(
      runId,
      worktreeCleanupObservationIntendedRecordKey(unrelated.operationId, ordinal),
      WorktreeCleanupObservationIntendedEvent.make({
        authorization: unrelated,
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        operationId: OperationId.make(`${unrelated.operationId}:observe:${ordinal}`),
        ordinal,
        version: workflowJournalEventVersion
      })
    )
    const result = yield* runWorktreeCleanup(authorization)
    expect(result._tag).toBe("Settled")
  }).pipe(
    Effect.provide(
      worktreeCleanupTestLayer({
        observations: [
          present,
          WorktreeCleanupObservation.cases.Absent.make({
            locator: attempt.worktree,
            revision: WorktreeCleanupEvidenceRevision.make(2)
          })
        ],
        mutations: [
          WorktreeCleanupMutationResult.cases.Removed.make({
            branch: attempt.branch,
            locator: attempt.worktree,
            revision: WorktreeCleanupEvidenceRevision.make(2)
          })
        ]
      })
    ),
    Effect.provide(memoryJournalTestLayer)
  )
)

it("does not authorize cleanup for a current quarantine without a terminal disposal", () => {
  expect(isCleanupEligibleDisposition({ _tag: "CurrentQuarantine", sessionId: "live-session" })).toBe(false)
})

it.effect("does not treat nonterminal TargetLineageObserved as a planned-attempt settlement", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("issue-69-nonterminal-settlement"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    const settlementOperationId = OperationId.make("issue-69-nonterminal-settlement-read")
    const operation = makeTargetLineageObservationOperation({
      integrationTarget: IntegrationTarget.make({
        ref: IntegrationTargetRef.make("refs/heads/main"),
        repository: GitRepositoryLocator.make("repo:issue-69")
      }),
      operationId: settlementOperationId,
      plannedAttempt: attempt,
      predecessorOperationIds: []
    })
    yield* journal.append(
      runId,
      intentRecordKey(settlementOperationId),
      GitReadIntentRecordedEvent.make({
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        operation,
        version: workflowJournalEventVersion
      })
    )
    yield* journal.append(
      runId,
      outcomeRecordKey(settlementOperationId),
      TargetLineageObservedEvent.make({
        observation: {
          plannedBaseIsAncestorOfTargetHead: true,
          plannedBaseSha: attempt.baseSha,
          targetHeadSha: attempt.baseSha
        },
        occurrenceClassification: "NonActionOccurrence",
        operationId: settlementOperationId,
        plannedAttempt: attempt,
        version: workflowJournalEventVersion
      })
    )
    const settledAuthorization = WorktreeCleanupAuthorization.make({
      ...authorization,
      disposition: PlannedAttemptCleanupDisposition.cases.Settled.make({
        dispositionAt: JournalPosition.make(3),
        plannedAttempt: attempt,
        settlementOperationId
      }),
      observationAt: JournalPosition.make(2),
      observationOperationId: settlementOperationId
    })
    const result = yield* runWorktreeCleanup(settledAuthorization)
    expect(result._tag).toBe("Preserved")
    expect(yield* (yield* TestWorktreeCleanupBoundary).calls()).toEqual([])
  }).pipe(Effect.provide(worktreeCleanupTestLayer({ observations: [present] })), Effect.provide(memoryJournalTestLayer))
)

it.effect("preserves an authorization whose observation provenance is forged", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("issue-69-forged-observation"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    yield* appendReplacementProvenance(attempt, successor)
    const forged = WorktreeCleanupAuthorization.make({
      ...authorization,
      observationAt: authorization.disposition.dispositionAt,
      observationOperationId: OperationId.make("issue-69-fake-observation")
    })
    const result = yield* runWorktreeCleanup(forged)
    expect(result._tag).toBe("Preserved")
    expect(yield* (yield* TestWorktreeCleanupBoundary).calls()).toEqual([])
  }).pipe(Effect.provide(worktreeCleanupTestLayer({ observations: [present] })), Effect.provide(memoryJournalTestLayer))
)
