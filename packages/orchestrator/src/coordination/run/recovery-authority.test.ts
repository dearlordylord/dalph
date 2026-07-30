import { taskTrackerGraphFactsObserved } from "../../../test/task-tracker-facts.js"
import { it } from "@effect/vitest"
import { Effect, Layer, Ref } from "effect"
import { expect } from "vitest"
import { ControlCommand, ControlCommandRecordedEvent } from "../../control/command.js"
import {
  AttemptId,
  GitCommitSha,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator,
  plannedAttemptExecutorCorrelation,
  PlannedAttemptExecutorReport
} from "@dalph/contracts"
import { AuthenticatedOperatorIdentity, ControlCommandId } from "../../control/identity.js"
import { TrackerRevision } from "../../authorities/task-tracker/task.js"
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import {
  GithubIssueNumber,
  GithubIssueTarget,
  GithubRepositoryName,
  GithubRepositoryOwner
} from "../../authorities/task-tracker/github/target.js"
import { OperationId } from "../../workflow/identity.js"
import {
  GitWorktree,
  GitWorktreeReadFailure,
  gitWorktreeTestLayer,
  PlannedWorktreeAbsent,
  PlannedWorktreeReady
} from "../../authorities/git/worktree.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import {
  controlCommandRecordKey,
  intentRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey,
  attemptPlanRecordKey,
  outcomeRecordKey
} from "../../workflow-journal/record-key.js"
import { JournalStore } from "../../workflow-journal/store.js"
import {
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  TaskWorktreeReadyEvent,
  TaskWorktreeReconciliationIntendedEvent,
  taskTrackerReadIntent
} from "../../workflow/registry/event.js"
import { memoryJournalStoreLayer } from "../../workflow-journal/adapters/memory-store.js"
import {
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "../../workflow/protocols/planned-attempt-executor-work/events.js"
import {
  livePlannedAttemptRecoveryAuthorityLayer,
  PlannedAttemptRecoveryAuthority,
  PlannedAttemptRecoveryAuthorityMismatch,
  PlannedAttemptRecoveryAuthorityUnreadable
} from "./recovery-authority.js"
import { taskClaimReacquisitionOperationId } from "../../workflow/protocols/task-claim-reacquisition/plan.js"
import {
  controlledTrackerMutationLayer,
  TaskClaimReadFailure,
  TrackerMutation
} from "../../authorities/task-tracker/claim-mutation.js"
import {
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskWorktreeReconciliationOperation,
  makeTrackerGraphObservationOperation
} from "../../workflow/registry/operation.js"

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

const recordCausalHistory = Effect.gen(function* () {
  const journal = yield* JournalStore
  yield* journal.append(
    runId,
    intentRecordKey(acquisition.operationId),
    TaskClaimAcquisitionIntendedEvent.make({
      operation: makeTaskClaimAcquisitionOperation({ acquisition, predecessorOperationIds: [] }),
      version: workflowJournalEventVersion
    })
  )
  yield* journal.append(
    runId,
    outcomeRecordKey(acquisition.operationId),
    TaskClaimAcquiredEvent.make({
      claim: { _tag: "ActiveTaskClaim", ...acquisition },
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
  yield* journal.append(runId, intentRecordKey(observation.operationId), taskTrackerReadIntent(observation))
  yield* journal.append(
    runId,
    outcomeRecordKey(observation.operationId),
    taskTrackerGraphFactsObserved(observation, {
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
    TaskAttemptPlannedEvent.make({ operation: planOperation, version: workflowJournalEventVersion })
  )
  const worktreeOperation = makeTaskWorktreeReconciliationOperation({
    operationId: OperationId.make("authority-worktree"),
    plannedAttempt,
    predecessorOperationIds: [planOperation.operationId]
  })
  yield* journal.append(
    runId,
    intentRecordKey(worktreeOperation.operationId),
    TaskWorktreeReconciliationIntendedEvent.make({ operation: worktreeOperation, version: workflowJournalEventVersion })
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
    ControlCommandRecordedEvent.make({ command, version: workflowJournalEventVersion })
  )
  yield* journal.append(
    runId,
    plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
    PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({ plannedAttempt, version: workflowJournalEventVersion })
  )
  const ordinal = PlannedAttemptExecutorReportOrdinal.make(1)
  yield* journal.append(
    runId,
    plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, ordinal),
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
  Effect.gen(function* () {
    yield* (yield* TrackerMutation).acquireTaskClaim(acquisition)
    yield* recordCausalHistory

    yield* (yield* PlannedAttemptRecoveryAuthority).verify(plannedAttempt)
  }).pipe(Effect.provide(layer))
)

it.effect("uses only a replacement claim authorized by a prior authenticated reacquisition command", () =>
  Effect.gen(function* () {
    const tracker = yield* TrackerMutation
    yield* tracker.acquireTaskClaim(acquisition)
    yield* recordCausalHistory
    yield* tracker.releaseTaskClaim({
      claim: { _tag: "ActiveTaskClaim", ...acquisition },
      operationId: acquisition.operationId
    })

    const command = ControlCommand.cases.RequestTaskClaimReacquisition.make({
      commandId: ControlCommandId.make("authority-reacquire"),
      operatorId: AuthenticatedOperatorIdentity.make("authority-operator"),
      runId,
      taskId: plannedAttempt.taskId
    })
    const replacement = {
      operationId: taskClaimReacquisitionOperationId(command.commandId),
      owner: ClaimOwner.make("dalph"),
      taskId: plannedAttempt.taskId,
      token: ClaimToken.make("authority-replacement-token")
    }
    const journal = yield* JournalStore
    yield* journal.append(
      runId,
      controlCommandRecordKey(command.commandId),
      ControlCommandRecordedEvent.make({ command, version: workflowJournalEventVersion })
    )
    yield* journal.append(
      runId,
      intentRecordKey(replacement.operationId),
      TaskClaimAcquisitionIntendedEvent.make({
        operation: makeTaskClaimAcquisitionOperation({
          acquisition: replacement,
          authority: { _tag: "ExplicitTaskClaimReacquisitionAuthority", commandId: command.commandId },
          predecessorOperationIds: [acquisition.operationId]
        }),
        version: workflowJournalEventVersion
      })
    )
    yield* tracker.acquireTaskClaim(replacement)
    yield* journal.append(
      runId,
      outcomeRecordKey(replacement.operationId),
      TaskClaimAcquiredEvent.make({
        claim: { _tag: "ActiveTaskClaim", ...replacement },
        version: workflowJournalEventVersion
      })
    )

    yield* (yield* PlannedAttemptRecoveryAuthority).verify(plannedAttempt)
  }).pipe(Effect.provide(layer))
)

it.effect("rejects a changed tracker claim and an absent planned worktree", () =>
  Effect.gen(function* () {
    yield* recordCausalHistory
    const trackerMismatch = yield* (yield* PlannedAttemptRecoveryAuthority).verify(plannedAttempt).pipe(Effect.flip)
    expect(trackerMismatch).toBeInstanceOf(PlannedAttemptRecoveryAuthorityMismatch)
    expect(trackerMismatch).toMatchObject({ boundary: "TaskTracker" })

    yield* (yield* TrackerMutation).acquireTaskClaim(acquisition)
    const gitMismatch = yield* (yield* PlannedAttemptRecoveryAuthority).verify(plannedAttempt).pipe(Effect.flip)
    expect(gitMismatch).toMatchObject({ boundary: "Git" })
  }).pipe(
    Effect.provide(
      authorityLayer(
        controlledTrackerMutationLayer,
        Layer.succeed(
          GitWorktree,
          GitWorktree.of({
            createPlannedWorktree: () => Effect.void,
            readPlannedWorktree: () => Effect.succeed(PlannedWorktreeAbsent.make({}))
          })
        )
      )
    )
  )
)

it.effect("preserves tracker read failures as unreadable authority", () =>
  Effect.gen(function* () {
    yield* recordCausalHistory
    const trackerFailure = yield* (yield* PlannedAttemptRecoveryAuthority).verify(plannedAttempt).pipe(Effect.flip)
    expect(trackerFailure).toBeInstanceOf(PlannedAttemptRecoveryAuthorityUnreadable)
    expect(trackerFailure).toMatchObject({ detail: "tracker unavailable" })
  }).pipe(
    Effect.provide(
      authorityLayer(
        Layer.succeed(
          TrackerMutation,
          TrackerMutation.of({
            acquireTaskClaim: () => Effect.die("unused"),
            readTaskClaim: (taskId) => Effect.fail(new TaskClaimReadFailure({ detail: "tracker unavailable", taskId })),
            releaseTaskClaim: () => Effect.die("unused")
          })
        )
      )
    )
  )
)

it.effect("recovers after two transient tracker claim read failures", () =>
  Effect.gen(function* () {
    yield* recordCausalHistory
    yield* (yield* PlannedAttemptRecoveryAuthority).verify(plannedAttempt)
  }).pipe(
    Effect.provide(
      authorityLayer(
        Layer.effect(
          TrackerMutation,
          Ref.make(0).pipe(
            Effect.map((reads) =>
              TrackerMutation.of({
                acquireTaskClaim: () => Effect.die("unused"),
                readTaskClaim: (taskId) =>
                  Ref.getAndUpdate(reads, (count) => count + 1).pipe(
                    Effect.flatMap((count) =>
                      count < 2
                        ? new TaskClaimReadFailure({ detail: `transient-${count + 1}`, taskId })
                        : Effect.succeed({ _tag: "ActiveTaskClaim" as const, ...acquisition })
                    )
                  ),
                releaseTaskClaim: () => Effect.die("unused")
              })
            )
          )
        )
      )
    )
  )
)

it.effect("preserves Git read failures as unreadable authority", () =>
  Effect.gen(function* () {
    yield* recordCausalHistory
    yield* (yield* TrackerMutation).acquireTaskClaim(acquisition)
    const gitFailure = yield* (yield* PlannedAttemptRecoveryAuthority).verify(plannedAttempt).pipe(Effect.flip)
    expect(gitFailure).toMatchObject({ detail: "GitWorktreeReadFailure" })
  }).pipe(
    Effect.provide(
      authorityLayer(
        controlledTrackerMutationLayer,
        Layer.succeed(
          GitWorktree,
          GitWorktree.of({
            createPlannedWorktree: () => Effect.die("unused"),
            readPlannedWorktree: () =>
              Effect.fail(new GitWorktreeReadFailure({ detail: "Git unavailable", worktree: plannedAttempt.worktree }))
          })
        )
      )
    )
  )
)

it.effect("rejects recovery without a causal durable claim", () =>
  Effect.gen(function* () {
    const missingPlan = yield* (yield* PlannedAttemptRecoveryAuthority).verify(plannedAttempt).pipe(Effect.flip)
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
    const mismatch = yield* (yield* PlannedAttemptRecoveryAuthority).verify(plannedAttempt).pipe(Effect.flip)

    expect(mismatch).toMatchObject({
      _tag: "PlannedAttemptRecoveryAuthorityMismatch",
      attemptId: plannedAttempt.attemptId,
      boundary: "TaskTracker"
    })
  }).pipe(Effect.provide(layer))
)
