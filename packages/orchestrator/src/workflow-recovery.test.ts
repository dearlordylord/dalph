import { it } from "@effect/vitest"
import { Effect, Ref } from "effect"
import { expect } from "vitest"
import { CoordinatorOwnershipLost } from "./coordinator-lock.js"
import {
  AttemptId,
  FixtureTarget,
  GitCommitSha,
  GitCommonDirectoryLocator,
  JournalPosition,
  OperationId,
  ProviderObservationId,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  TaskWorkSessionId,
  TaskWorkSessionLocator,
  TrackerRevision,
  TrackerSnapshot,
  WorktreeLocator
} from "./domain.js"
import { ForeignWorktreeRegistration, GitWorktree } from "./git-worktree.js"
import { EvidenceStore, EvidenceStoreFailure } from "./implementation-evidence.js"
import {
  intentRecordKey,
  JournalStore,
  memoryJournalStoreLayer,
  outcomeRecordKey,
  trackerGraphObservationIntent,
  trackerGraphOutcomeObserved
} from "./journal-store.js"
import { TaskDagSnapshot } from "./task-dag.js"
import { NoTaskExecutionReported, TaskExecutor } from "./task-execution.js"
import { NoMatchingTaskWorkSessionReported, TaskRunner } from "./task-work-start.js"
import { TrackerGraphReader, TrackerReadError } from "./tracker-graph-reader.js"
import { TrackerMutation, UnclaimedTask } from "./tracker-mutation.js"
import { makeTrackerGraphObservationOperation } from "./workflow-operation.js"
import {
  classifyRecoveryIssue,
  observeManagedRunAuthorities,
  recoverExactRunAfterCoordinatorDeath
} from "./workflow-recovery.js"
import { WorkflowInterpreter, WorkflowTrace } from "./workflow.js"

const runId = RunId.make("startup-recovery-test")
const operation = makeTrackerGraphObservationOperation(
  OperationId.make("startup-tracker-refresh"),
  FixtureTarget.make("startup-target")
)
const secondOperation = makeTrackerGraphObservationOperation(
  OperationId.make("second-startup-tracker-refresh"),
  FixtureTarget.make("second-startup-target")
)
type ReadTrackerGraph = Parameters<typeof WorkflowInterpreter.of>[0]["readTrackerGraph"]

const emptySnapshotProjection = TaskDagSnapshot.project(TrackerSnapshot.make({
  revision: TrackerRevision.make("startup-revision"),
  tasks: []
}))
const emptySnapshot = emptySnapshotProjection._tag === "Valid"
  ? Effect.succeed(emptySnapshotProjection.snapshot)
  : Effect.die("empty tracker snapshot must be valid")

const interpreter = (
  readTrackerGraph: ReadTrackerGraph
) => {
  const unused = () => Effect.die("unused recovery method")
  return WorkflowInterpreter.of({
    acquireTaskClaim: unused,
    establishTaskWorkSession: unused,
    executeTaskWork: unused,
    handBackReviewFindings: unused,
    readTrackerGraph,
    recordImplementationDisposition: unused,
    reconcileTaskWorktree: unused,
    recordTaskAttemptPlan: unused,
    reviewImplementation: unused,
    sealImplementationEvidence: unused,
    simulateTaskExecution: unused,
    simulateTaskWorkSession: unused
  })
}

const unclaimedTracker = TrackerMutation.of({
  acquireTaskClaim: () => Effect.die("tracker claim acquisition is unused"),
  readTaskClaim: (taskId) => Effect.succeed(UnclaimedTask.make({ taskId })),
  releaseTaskClaim: () => Effect.die("tracker claim release is unused")
})

const runRecovery = (
  readTrackerGraph: ReadTrackerGraph
) =>
  Effect.gen(function*() {
    const journal = yield* JournalStore
    yield* journal.append(runId, intentRecordKey(operation.operationId), trackerGraphObservationIntent(operation))
    const records = yield* journal.read(runId)
    return yield* recoverExactRunAfterCoordinatorDeath(runId, records)
  }).pipe(
    Effect.provideService(WorkflowInterpreter, interpreter(readTrackerGraph)),
    Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })),
    Effect.provideService(TrackerMutation, unclaimedTracker),
    Effect.provide(memoryJournalStoreLayer)
  )

it.effect("refreshes every authority for a valid discovered run and emits the tracker observation", () =>
  Effect.gen(function*() {
    const emitted = yield* Ref.make(0)
    const issues = yield* Effect.gen(function*() {
      const journal = yield* JournalStore
      yield* journal.append(runId, intentRecordKey(operation.operationId), trackerGraphObservationIntent(operation))
      yield* journal.append(
        runId,
        outcomeRecordKey(operation.operationId),
        trackerGraphOutcomeObserved(operation.operationId, {
          _tag: "TrackerGraphObserved",
          revision: TrackerRevision.make("already-observed-revision"),
          taskIds: []
        })
      )
      yield* journal.append(
        runId,
        intentRecordKey(secondOperation.operationId),
        trackerGraphObservationIntent(secondOperation)
      )
      return yield* recoverExactRunAfterCoordinatorDeath(runId)
    }).pipe(
      Effect.provideService(WorkflowInterpreter, interpreter(() => emptySnapshot)),
      Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Ref.update(emitted, (count) => count + 1) })),
      Effect.provideService(TrackerMutation, unclaimedTracker),
      Effect.provide(memoryJournalStoreLayer)
    )
    expect(issues).toEqual([])
    expect(yield* Ref.get(emitted)).toBe(1)
  }))

it.effect("accumulates reconciliation and ownership failures as distinct typed issues", () =>
  Effect.gen(function*() {
    const reconciliation = yield* runRecovery(() =>
      Effect.fail(
        new TrackerReadError({
          detail: "tracker unavailable",
          operation: "TrackerGraphReader.decode"
        })
      )
    )
    const ownership = classifyRecoveryIssue(
      "Git",
      runId,
      new CoordinatorOwnershipLost({
        gitCommonDirectory: GitCommonDirectoryLocator.make("/tmp/startup-lock")
      })
    )
    expect(reconciliation.map(({ _tag }) => _tag)).toEqual(["RecoveryReconciliationIssue"])
    expect(ownership._tag).toBe("RecoveryOwnershipIssue")
  }))

it.effect("returns semantic issues before refreshing authorities", () => {
  const orphanOutcome = {
    event: trackerGraphOutcomeObserved(operation.operationId, {
      _tag: "TrackerGraphObserved" as const,
      revision: TrackerRevision.make("orphan-recovery-revision"),
      taskIds: []
    }),
    key: outcomeRecordKey(operation.operationId),
    position: JournalPosition.make(1),
    runId
  }
  return recoverExactRunAfterCoordinatorDeath(runId, [orphanOutcome]).pipe(
    Effect.provideService(WorkflowInterpreter, interpreter(() => Effect.die("invalid history must not refresh"))),
    Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })),
    Effect.provideService(TrackerMutation, unclaimedTracker),
    Effect.provide(memoryJournalStoreLayer),
    Effect.tap((issues) =>
      Effect.sync(() => {
        expect(issues.map(({ _tag }) => _tag)).toEqual(["ManagedHistorySemanticIssue"])
      })
    )
  )
})

it.effect("collects completed stale, foreign, and unreadable authority facts without authorizing mutation", () =>
  Effect.gen(function*() {
    const plannedAttempt = {
      attemptId: AttemptId.make("observer-attempt"),
      baseSha: GitCommitSha.make("0000000000000000000000000000000000000000"),
      branch: TaskBranchRef.make("refs/heads/observer-attempt"),
      executor: TaskExecutorLocator.make("executor:observer"),
      runId,
      session: TaskWorkSessionLocator.make("session:observer"),
      taskId: TaskId.make("observer-task"),
      taskRevision: TaskRevision.make("observer-revision"),
      worktree: WorktreeLocator.make("/tmp/observer-attempt")
    }
    const sessionId = TaskWorkSessionId.make("observer-session")
    const claimOperationId = OperationId.make("observer-claim")
    const worktreeOperationId = OperationId.make("observer-worktree")
    const sessionOperationId = OperationId.make("observer-session-operation")
    const executionOperationId = OperationId.make("observer-execution")
    const events = [
      {
        _tag: "TrackerGraphObservationIntentRecorded",
        operation: { operationId: "observer-graph", target: FixtureTarget.make("observer-target") }
      },
      {
        _tag: "TrackerGraphOutcomeObserved",
        operationId: "observer-graph",
        outcome: { revision: TrackerRevision.make("historical-revision"), taskIds: [] }
      },
      {
        _tag: "TaskClaimAcquisitionIntended",
        operation: {
          acquisition: { operationId: claimOperationId, owner: "owner", taskId: plannedAttempt.taskId, token: "token" }
        }
      },
      {
        _tag: "TaskClaimAcquired",
        claim: { operationId: claimOperationId, owner: "owner", taskId: plannedAttempt.taskId, token: "token" }
      },
      {
        _tag: "TaskClaimAcquisitionIntended",
        operation: {
          acquisition: {
            operationId: "observer-unresolved-claim",
            owner: "owner",
            taskId: "observer-unresolved-task",
            token: "token"
          }
        }
      },
      {
        _tag: "TaskClaimAcquisitionIntended",
        operation: {
          acquisition: {
            operationId: "observer-exact-claim",
            owner: "owner",
            taskId: "observer-exact-task",
            token: "token"
          }
        }
      },
      {
        _tag: "TaskClaimAcquired",
        claim: {
          operationId: "observer-exact-claim",
          owner: "owner",
          taskId: "observer-exact-task",
          token: "token"
        }
      },
      {
        _tag: "TaskWorktreeReconciliationIntended",
        operation: { operationId: worktreeOperationId, plannedAttempt }
      },
      { _tag: "TaskWorktreeReady", operationId: worktreeOperationId, proof: {} },
      {
        _tag: "TaskWorkSessionEstablishmentIntentRecorded",
        operation: { request: { operationId: sessionOperationId, plannedAttempt } }
      },
      { _tag: "TaskWorkSessionEstablished", outcome: { operationId: sessionOperationId, sessionId } },
      {
        _tag: "TaskWorkSessionEstablishmentIntentRecorded",
        operation: { request: { operationId: "observer-unresolved-session", plannedAttempt } }
      },
      {
        _tag: "TaskExecutionIntentRecorded",
        operation: {
          request: {
            operationId: executionOperationId,
            plannedAttempt,
            session: { _tag: "EstablishedSession", sessionId }
          }
        }
      },
      {
        _tag: "TaskExecutionIntentRecorded",
        operation: {
          request: {
            operationId: "observer-exact-execution",
            plannedAttempt,
            session: { _tag: "EstablishedSession", sessionId }
          }
        }
      },
      {
        _tag: "TaskExecutionOutcomeObserved",
        outcome: {
          outcome: {
            _tag: "Succeeded",
            operationId: "observer-exact-execution",
            output: "done",
            processId: "observer-exact-process",
            sessionId
          }
        }
      },
      {
        _tag: "TaskExecutionOutcomeObserved",
        outcome: {
          outcome: {
            _tag: "Succeeded",
            operationId: executionOperationId,
            output: "done",
            processId: "observer-process",
            sessionId
          }
        }
      },
      {
        _tag: "TaskExecutionIntentRecorded",
        operation: {
          request: {
            operationId: "observer-unresolved-execution",
            plannedAttempt,
            session: { _tag: "EstablishedSession", sessionId }
          }
        }
      },
      {
        _tag: "TaskExecutionIntentRecorded",
        operation: {
          request: {
            operationId: "observer-planned-execution",
            plannedAttempt,
            session: { _tag: "PlannedSession", session: plannedAttempt.session }
          }
        }
      },
      { _tag: "ImplementationEvidenceSealed", sealed: {}, operationId: "observer-evidence" },
      {
        _tag: "ReviewFindingsHandbackCompleted",
        acknowledgement: {
          operationId: "observer-handback",
          reviewEvidenceReference: { byteLength: 1, digest: "0".repeat(64) }
        }
      }
    ] as const
    const records = events.map((event, index) => ({ event, index })) as never
    const issues = yield* observeManagedRunAuthorities(runId, records).pipe(
      Effect.provideService(TrackerGraphReader, TrackerGraphReader.of({ read: () => emptySnapshot })),
      Effect.provideService(
        TrackerMutation,
        TrackerMutation.of({
          acquireTaskClaim: () => Effect.die("observation must not acquire a claim"),
          readTaskClaim: (taskId) =>
            taskId === "observer-exact-task"
              ? Effect.succeed({
                _tag: "ActiveTaskClaim" as const,
                operationId: "observer-exact-claim" as never,
                owner: "owner" as never,
                taskId,
                token: "token" as never
              })
              : Effect.succeed(UnclaimedTask.make({ taskId })),
          releaseTaskClaim: () => Effect.die("observation must not release a claim")
        })
      ),
      Effect.provideService(
        GitWorktree,
        GitWorktree.of({
          createPlannedWorktree: () => Effect.die("observation must not create a worktree"),
          readPlannedWorktree: () =>
            Effect.fail(
              new ForeignWorktreeRegistration({
                branch: plannedAttempt.branch,
                plannedWorktree: plannedAttempt.worktree,
                registeredWorktree: WorktreeLocator.make("/tmp/foreign-observer-attempt")
              })
            )
        })
      ),
      Effect.provideService(
        TaskRunner,
        TaskRunner.of({
          lookupTaskWorkSession: () =>
            Effect.succeed(NoMatchingTaskWorkSessionReported.make({
              observationId: ProviderObservationId.make("observer-session-absence")
            })),
          requestTaskWorkStart: () => Effect.die("observation must not start work")
        })
      ),
      Effect.provideService(
        TaskExecutor,
        TaskExecutor.of({
          observeTaskExecution: (lookup) =>
            lookup.operationId === "observer-exact-execution"
              ? Effect.succeed({
                _tag: "SuccessfulTaskExecutionReported" as const,
                observationId: ProviderObservationId.make("observer-execution-success"),
                operationId: lookup.operationId,
                output: "done",
                processId: "observer-exact-process" as never,
                sessionId: lookup.sessionId
              })
              : Effect.succeed(NoTaskExecutionReported.make({
                observationId: ProviderObservationId.make("observer-execution-absence"),
                operationId: lookup.operationId,
                sessionId: lookup.sessionId
              })),
          requestTaskExecution: () => Effect.die("observation must not start execution")
        })
      ),
      Effect.provideService(
        EvidenceStore,
        EvidenceStore.of({
          put: () => Effect.die("observation must not publish evidence"),
          read: () =>
            Effect.fail(
              new EvidenceStoreFailure({
                detail: "authority bytes are unreadable",
                operation: "EvidenceStore.read"
              })
            )
        })
      )
    )
    expect(issues.map((issue) => issue._tag === "RecoveryReconciliationIssue" ? issue.authority : "Ownership")).toEqual(
      [
        "Tracker",
        "Git",
        "TaskRunner",
        "TaskExecutor",
        "Evidence",
        "Reviewer"
      ]
    )
  }))
