import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { expect } from "vitest"
import { ControlCommand, ControlCommandRecordedEvent } from "./control-command.js"
import {
  AttemptId,
  AuthenticatedOperatorIdentity,
  ClaimOwner,
  ClaimToken,
  ControlCommandId,
  GitCommitSha,
  GithubIssueNumber,
  GithubIssueTarget,
  GithubRepositoryName,
  GithubRepositoryOwner,
  OperationId,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  TrackerRevision,
  WorktreeLocator
} from "./domain.js"
import {
  GitWorktree,
  GitWorktreeReadFailure,
  gitWorktreeTestLayer,
  PlannedWorktreeAbsent,
  PlannedWorktreeReady
} from "./git-worktree.js"
import { workflowJournalEventVersion } from "./journal-event-version.js"
import {
  controlCommandRecordKey,
  intentRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  plannedAttemptExecutorWorkStartedRecordKey
} from "./journal-record-key.js"
import {
  attemptPlanRecordKey,
  JournalStore,
  memoryJournalStoreLayer,
  outcomeRecordKey,
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  TaskWorktreeReadyEvent,
  TaskWorktreeReconciliationIntendedEvent,
  trackerGraphObservationIntent,
  trackerGraphOutcomeObserved
} from "./journal-store.js"
import {
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkStartedEvent
} from "./planned-attempt-executor-journal.js"
import { plannedAttemptExecutorCorrelation, PlannedAttemptExecutorReport } from "./planned-attempt-executor.js"
import {
  livePlannedAttemptRecoveryAuthorityLayer,
  PlannedAttemptRecoveryAuthority,
  PlannedAttemptRecoveryAuthorityMismatch,
  PlannedAttemptRecoveryAuthorityUnreadable
} from "./planned-attempt-recovery-authority.js"
import { controlledTrackerMutationLayer, TaskClaimReadFailure, TrackerMutation } from "./tracker-mutation.js"
import {
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskWorktreeReconciliationOperation,
  makeTrackerGraphObservationOperation
} from "./workflow-operation.js"

const runId = RunId.make("authority-run")
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("authority-attempt"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/authority-attempt"),
  executor: TaskExecutorLocator.make("executor:authority"),
  runId,
  taskId: TaskId.make("authority-task"),
  taskRevision: TaskRevision.make("authority-revision"),
  worktree: WorktreeLocator.make("/worktrees/authority-attempt")
})
const acquisition = {
  operationId: OperationId.make("authority-claim"),
  owner: ClaimOwner.make("dalph"),
  taskId: plannedAttempt.taskId,
  token: ClaimToken.make("authority-token")
}

const authorityLayer = (
  trackerLayer: Layer.Layer<TrackerMutation> = controlledTrackerMutationLayer,
  gitLayer: Layer.Layer<GitWorktree> = gitWorktreeTestLayer(
    PlannedWorktreeReady.make({
      baseSha: plannedAttempt.baseSha,
      branch: plannedAttempt.branch,
      headSha: plannedAttempt.baseSha,
      worktree: plannedAttempt.worktree
    })
  )
) =>
  livePlannedAttemptRecoveryAuthorityLayer.pipe(
    Layer.provideMerge(memoryJournalStoreLayer),
    Layer.provideMerge(trackerLayer),
    Layer.provideMerge(gitLayer)
  )
const layer = authorityLayer()

const recordCausalHistory = Effect.gen(function*() {
  const journal = yield* JournalStore
  yield* journal.append(
    runId,
    intentRecordKey(acquisition.operationId),
    TaskClaimAcquisitionIntendedEvent.make({
      operation: makeTaskClaimAcquisitionOperation({
        acquisition,
        predecessorOperationIds: []
      }),
      version: workflowJournalEventVersion
    })
  )
  yield* journal.append(
    runId,
    outcomeRecordKey(acquisition.operationId),
    TaskClaimAcquiredEvent.make({
      claim: {
        _tag: "ActiveTaskClaim",
        ...acquisition
      },
      version: workflowJournalEventVersion
    })
  )
  const observation = makeTrackerGraphObservationOperation(
    OperationId.make("authority-admission-observation"),
    GithubIssueTarget.make({
      issueNumber: GithubIssueNumber.make(158),
      owner: GithubRepositoryOwner.make("dalph"),
      repository: GithubRepositoryName.make("dalph")
    }),
    [acquisition.operationId],
    [plannedAttempt.taskId]
  )
  yield* journal.append(
    runId,
    intentRecordKey(observation.operationId),
    trackerGraphObservationIntent(observation)
  )
  yield* journal.append(
    runId,
    outcomeRecordKey(observation.operationId),
    trackerGraphOutcomeObserved(observation.operationId, {
      _tag: "TrackerGraphObserved",
      revision: TrackerRevision.make("authority-observation"),
      taskIds: [plannedAttempt.taskId]
    })
  )
  const planOperation = makeTaskAttemptPlanOperation({
    operationId: OperationId.make("authority-plan"),
    plannedAttempt,
    predecessorOperationIds: [observation.operationId]
  })
  yield* journal.append(
    runId,
    attemptPlanRecordKey(plannedAttempt.attemptId),
    TaskAttemptPlannedEvent.make({
      operation: planOperation,
      version: workflowJournalEventVersion
    })
  )
  const worktreeOperation = makeTaskWorktreeReconciliationOperation({
    operationId: OperationId.make("authority-worktree"),
    plannedAttempt,
    predecessorOperationIds: [planOperation.operationId]
  })
  yield* journal.append(
    runId,
    intentRecordKey(worktreeOperation.operationId),
    TaskWorktreeReconciliationIntendedEvent.make({
      operation: worktreeOperation,
      version: workflowJournalEventVersion
    })
  )
  yield* journal.append(
    runId,
    outcomeRecordKey(worktreeOperation.operationId),
    TaskWorktreeReadyEvent.make({
      operationId: worktreeOperation.operationId,
      proof: PlannedWorktreeReady.make({
        baseSha: plannedAttempt.baseSha,
        branch: plannedAttempt.branch,
        headSha: plannedAttempt.baseSha,
        worktree: plannedAttempt.worktree
      }),
      version: workflowJournalEventVersion
    })
  )
  const command = ControlCommand.cases.RequestRunPause.make({
    commandId: ControlCommandId.make("authority-control"),
    operatorId: AuthenticatedOperatorIdentity.make("authority-operator"),
    runId
  })
  yield* journal.append(
    runId,
    controlCommandRecordKey(command.commandId),
    ControlCommandRecordedEvent.make({
      command,
      version: workflowJournalEventVersion
    })
  )
  yield* journal.append(
    runId,
    plannedAttemptExecutorWorkStartedRecordKey(plannedAttempt.attemptId),
    PlannedAttemptExecutorWorkStartedEvent.make({
      plannedAttempt,
      version: workflowJournalEventVersion
    })
  )
  const ordinal = PlannedAttemptExecutorReportOrdinal.make(1)
  yield* journal.append(
    runId,
    plannedAttemptExecutorWorkReportedRecordKey(
      plannedAttempt.attemptId,
      ordinal
    ),
    PlannedAttemptExecutorWorkReportedEvent.make({
      ordinal,
      report: PlannedAttemptExecutorReport.cases.Running.make({
        correlation: plannedAttemptExecutorCorrelation(plannedAttempt)
      }),
      version: workflowJournalEventVersion
    })
  )
})

it.effect("rereads the exact tracker claim and Git worktree before recovery", () =>
  Effect.gen(function*() {
    yield* (yield* TrackerMutation).acquireTaskClaim(
      acquisition
    )
    yield* recordCausalHistory

    yield* (yield* PlannedAttemptRecoveryAuthority).verify(
      plannedAttempt
    )
  }).pipe(Effect.provide(layer)))

it.effect("rejects a changed tracker claim and an absent planned worktree", () =>
  Effect.gen(function*() {
    yield* recordCausalHistory
    const trackerMismatch = yield* (yield* PlannedAttemptRecoveryAuthority)
      .verify(plannedAttempt).pipe(Effect.flip)
    expect(trackerMismatch).toBeInstanceOf(
      PlannedAttemptRecoveryAuthorityMismatch
    )
    expect(trackerMismatch).toMatchObject({ boundary: "TaskTracker" })

    yield* (yield* TrackerMutation).acquireTaskClaim(acquisition)
    const gitMismatch = yield* (yield* PlannedAttemptRecoveryAuthority)
      .verify(plannedAttempt).pipe(Effect.flip)
    expect(gitMismatch).toMatchObject({ boundary: "Git" })
  }).pipe(Effect.provide(authorityLayer(
    controlledTrackerMutationLayer,
    Layer.succeed(
      GitWorktree,
      GitWorktree.of({
        createPlannedWorktree: () => Effect.void,
        readPlannedWorktree: () => Effect.succeed(PlannedWorktreeAbsent.make({}))
      })
    )
  ))))

it.effect("preserves tracker read failures as unreadable authority", () =>
  Effect.gen(function*() {
    yield* recordCausalHistory
    const trackerFailure = yield* (yield* PlannedAttemptRecoveryAuthority)
      .verify(plannedAttempt).pipe(Effect.flip)
    expect(trackerFailure).toBeInstanceOf(
      PlannedAttemptRecoveryAuthorityUnreadable
    )
    expect(trackerFailure).toMatchObject({ detail: "tracker unavailable" })
  }).pipe(Effect.provide(authorityLayer(
    Layer.succeed(
      TrackerMutation,
      TrackerMutation.of({
        acquireTaskClaim: () => Effect.die("unused"),
        readTaskClaim: (taskId) =>
          Effect.fail(
            new TaskClaimReadFailure({
              detail: "tracker unavailable",
              taskId
            })
          ),
        releaseTaskClaim: () => Effect.die("unused")
      })
    )
  ))))

it.effect("preserves Git read failures as unreadable authority", () =>
  Effect.gen(function*() {
    yield* recordCausalHistory
    yield* (yield* TrackerMutation).acquireTaskClaim(acquisition)
    const gitFailure = yield* (yield* PlannedAttemptRecoveryAuthority)
      .verify(plannedAttempt).pipe(Effect.flip)
    expect(gitFailure).toMatchObject({ detail: "GitWorktreeReadFailure" })
  }).pipe(Effect.provide(authorityLayer(
    controlledTrackerMutationLayer,
    Layer.succeed(
      GitWorktree,
      GitWorktree.of({
        createPlannedWorktree: () => Effect.die("unused"),
        readPlannedWorktree: () =>
          Effect.fail(
            new GitWorktreeReadFailure({
              detail: "Git unavailable",
              worktree: plannedAttempt.worktree
            })
          )
      })
    )
  ))))

it.effect("rejects recovery without a causal durable claim", () =>
  Effect.gen(function*() {
    const missingPlan = yield* (yield* PlannedAttemptRecoveryAuthority)
      .verify(plannedAttempt).pipe(Effect.flip)
    expect(missingPlan).toMatchObject({ boundary: "TaskTracker" })

    yield* (yield* JournalStore).append(
      runId,
      attemptPlanRecordKey(plannedAttempt.attemptId),
      TaskAttemptPlannedEvent.make({
        operation: makeTaskAttemptPlanOperation({
          operationId: OperationId.make("authority-orphan-plan"),
          plannedAttempt,
          predecessorOperationIds: [acquisition.operationId]
        }),
        version: workflowJournalEventVersion
      })
    )
    const mismatch = yield* (yield* PlannedAttemptRecoveryAuthority)
      .verify(plannedAttempt).pipe(Effect.flip)

    expect(mismatch).toMatchObject({
      _tag: "PlannedAttemptRecoveryAuthorityMismatch",
      attemptId: plannedAttempt.attemptId,
      boundary: "TaskTracker"
    })
  }).pipe(Effect.provide(layer)))
