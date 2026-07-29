import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { ConfigProvider, Effect, FileSystem, Layer } from "effect"
import { expect } from "vitest"
import {
  AttemptId,
  ClaimOwner,
  ClaimToken,
  FixtureTarget,
  GitCommitSha,
  GitCommonDirectoryTarget,
  JournalDatabaseLocator,
  OperationId,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  TaskWorkCapacity,
  TrackerRevision,
  WorktreeLocator
} from "./domain.js"
import { GitCommand, nodeGitCommandLayer } from "./git-command.js"
import { PlannedWorktreeReady } from "./git-worktree.js"
import { workflowJournalEventVersion } from "./journal-event-version.js"
import {
  attemptPlanRecordKey,
  intentRecordKey,
  outcomeRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  plannedAttemptExecutorWorkStartedRecordKey
} from "./journal-record-key.js"
import {
  JournalStore,
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  TaskWorktreeReadyEvent,
  TaskWorktreeReconciliationIntendedEvent,
  trackerGraphObservationIntent,
  trackerGraphOutcomeObserved
} from "./journal-store.js"
import { activateRecoveredResponsibilities } from "./run-recovery-activation.js"
import {
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkStartedEvent
} from "./planned-attempt-executor-journal.js"
import {
  PlannedAttemptExecutor,
  plannedAttemptExecutorCorrelation,
  PlannedAttemptExecutorReport
} from "./planned-attempt-executor.js"
import { productionWorkflowInterpreterLayer } from "./production-application.js"
import { sqliteJournalStoreLayer } from "./sqlite-journal-store.js"
import { TrackerGraphReader } from "./tracker-graph-reader.js"
import { ActiveTaskClaim, controlledTrackerMutationLayer, TrackerMutation } from "./tracker-mutation.js"
import {
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskWorktreeReconciliationOperation,
  makeTrackerGraphObservationOperation,
  WorkflowInterpreter,
  WorkflowTrace
} from "./workflow.js"

it.effect("installs the running-then-terminal coarse fake in the production-shaped composition", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-production-fake-" })
      const git = yield* GitCommand
      yield* git.runInWorktree(directory, ["init"])
      yield* git.runInWorktree(directory, ["config", "user.email", "dalph@example.invalid"])
      yield* git.runInWorktree(directory, ["config", "user.name", "Dalph Test"])
      yield* fileSystem.writeFileString(`${directory}/README.md`, "production-shaped fake\n")
      yield* git.runInWorktree(directory, ["add", "README.md"])
      yield* git.runInWorktree(directory, ["commit", "-m", "initial"])
      const baseSha = GitCommitSha.make((yield* git.runInWorktree(directory, ["rev-parse", "HEAD"])).stdout.trim())
      const runId = RunId.make("production-fake-run")
      const plannedAttempt = PlannedTaskAttempt.make({
        attemptId: AttemptId.make("production-fake-attempt"),
        baseSha,
        branch: TaskBranchRef.make("refs/heads/dalph/production-fake-attempt"),
        executor: TaskExecutorLocator.make("executor:production-controlled-fake"),
        runId,
        taskId: TaskId.make("A"),
        taskRevision: TaskRevision.make("revision-A"),
        worktree: WorktreeLocator.make(`${directory}/worktree`)
      })
      const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
      const filename = JournalDatabaseLocator.make(`${directory}/journal.sqlite`)
      yield* git.runInWorktree(directory, [
        "worktree",
        "add",
        "-b",
        "dalph/production-fake-attempt",
        plannedAttempt.worktree,
        plannedAttempt.baseSha
      ])
      const acquisition = {
        operationId: OperationId.make("production-claim"),
        owner: ClaimOwner.make("dalph"),
        taskId: plannedAttempt.taskId,
        token: ClaimToken.make("production-token")
      }
      const claimOperation = makeTaskClaimAcquisitionOperation({ acquisition, predecessorOperationIds: [] })
      const observation = makeTrackerGraphObservationOperation(
        OperationId.make("production-observation"),
        FixtureTarget.make("production-target"),
        [claimOperation.acquisition.operationId],
        [plannedAttempt.taskId]
      )
      const plan = makeTaskAttemptPlanOperation({
        operationId: OperationId.make("production-plan"),
        plannedAttempt,
        predecessorOperationIds: [observation.operationId]
      })
      const worktree = makeTaskWorktreeReconciliationOperation({
        operationId: OperationId.make("production-worktree"),
        plannedAttempt,
        predecessorOperationIds: [plan.operationId]
      })
      const runningOrdinal = PlannedAttemptExecutorReportOrdinal.make(1)
      yield* Effect.gen(function* () {
        const journal = yield* JournalStore
        yield* journal.append(
          runId,
          intentRecordKey(acquisition.operationId),
          TaskClaimAcquisitionIntendedEvent.make({ operation: claimOperation, version: workflowJournalEventVersion })
        )
        yield* journal.append(
          runId,
          outcomeRecordKey(acquisition.operationId),
          TaskClaimAcquiredEvent.make({
            claim: ActiveTaskClaim.make(acquisition),
            version: workflowJournalEventVersion
          })
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
            revision: TrackerRevision.make("production-observation"),
            taskIds: [plannedAttempt.taskId]
          })
        )
        yield* journal.append(
          runId,
          attemptPlanRecordKey(plannedAttempt.attemptId),
          TaskAttemptPlannedEvent.make({ operation: plan, version: workflowJournalEventVersion })
        )
        yield* journal.append(
          runId,
          intentRecordKey(worktree.operationId),
          TaskWorktreeReconciliationIntendedEvent.make({ operation: worktree, version: workflowJournalEventVersion })
        )
        yield* journal.append(
          runId,
          outcomeRecordKey(worktree.operationId),
          TaskWorktreeReadyEvent.make({
            operationId: worktree.operationId,
            proof: PlannedWorktreeReady.make({
              baseSha: plannedAttempt.baseSha,
              branch: plannedAttempt.branch,
              headSha: plannedAttempt.baseSha,
              worktree: plannedAttempt.worktree
            }),
            version: workflowJournalEventVersion
          })
        )
        yield* journal.append(
          runId,
          plannedAttemptExecutorWorkStartedRecordKey(plannedAttempt.attemptId),
          PlannedAttemptExecutorWorkStartedEvent.make({ plannedAttempt, version: workflowJournalEventVersion })
        )
        yield* journal.append(
          runId,
          plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, runningOrdinal),
          PlannedAttemptExecutorWorkReportedEvent.make({
            ordinal: runningOrdinal,
            report: PlannedAttemptExecutorReport.cases.Running.make({ correlation }),
            version: workflowJournalEventVersion
          })
        )
      }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))
      const trackerLayer = Layer.succeed(
        TrackerMutation,
        TrackerMutation.of({
          acquireTaskClaim: () => Effect.succeed(ActiveTaskClaim.make(acquisition)),
          readTaskClaim: () => Effect.succeed(ActiveTaskClaim.make(acquisition)),
          releaseTaskClaim: () => Effect.void
        })
      )
      const application = productionWorkflowInterpreterLayer(
        runId,
        GitCommonDirectoryTarget.make(`${directory}/.git`),
        trackerLayer
      ).pipe(
        Layer.provide(Layer.succeed(TrackerGraphReader, TrackerGraphReader.of({ read: () => Effect.die("unused") }))),
        Layer.provide(Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })))
      )
      yield* Effect.gen(function* () {
        yield* (yield* WorkflowInterpreter).reconcileTaskWorktree(worktree)
        yield* activateRecoveredResponsibilities(runId, TaskWorkCapacity.make(1))
      }).pipe(
        Effect.provide(application),
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ DALPH_JOURNAL_DATABASE: filename })))
      )
      const records = yield* Effect.gen(function* () {
        return yield* (yield* JournalStore).read(runId)
      }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))
      expect(records.at(-1)?.event).toMatchObject({
        _tag: "PlannedAttemptExecutorWorkReported",
        report: { _tag: "Terminal", correlation, result: { _tag: "Completed" } }
      })
    }).pipe(Effect.provide(nodeGitCommandLayer), Effect.provide(NodeServices.layer))
  )
)

it.effect("blocks startup when any preserved run has an invalid causal history", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-production-invalid-history-" })
      const filename = JournalDatabaseLocator.make(`${directory}/journal.sqlite`)
      const invalidRunId = RunId.make("invalid-preserved-run")
      const missingIntent = OperationId.make("missing-observation-intent")
      yield* Effect.gen(function* () {
        const journal = yield* JournalStore
        const validObservation = makeTrackerGraphObservationOperation(
          OperationId.make("valid-preserved-observation"),
          FixtureTarget.make("valid-preserved-target")
        )
        yield* journal.append(
          RunId.make("valid-preserved-run"),
          intentRecordKey(validObservation.operationId),
          trackerGraphObservationIntent(validObservation)
        )
        yield* journal.append(
          invalidRunId,
          outcomeRecordKey(missingIntent),
          trackerGraphOutcomeObserved(missingIntent, {
            _tag: "TrackerGraphObserved",
            revision: TrackerRevision.make("invalid-revision"),
            taskIds: []
          })
        )
      }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))

      const application = productionWorkflowInterpreterLayer(
        RunId.make("current-production-run"),
        GitCommonDirectoryTarget.make(directory),
        controlledTrackerMutationLayer
      ).pipe(
        Layer.provide(Layer.succeed(TrackerGraphReader, TrackerGraphReader.of({ read: () => Effect.die("unused") }))),
        Layer.provide(Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })))
      )
      const blocked = yield* PlannedAttemptExecutor.pipe(
        Effect.provide(application),
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ DALPH_JOURNAL_DATABASE: filename }))),
        Effect.flip
      )
      expect(blocked._tag).toBe("StartupRecoveryBlocked")
      if (blocked._tag !== "StartupRecoveryBlocked") {
        return yield* Effect.die(`unexpected startup error ${blocked._tag}`)
      }
      expect(blocked.issues).not.toHaveLength(0)
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("blocks startup instead of ignoring another run's unfinished responsibility", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-production-other-run-" })
      const filename = JournalDatabaseLocator.make(`${directory}/journal.sqlite`)
      const unfinishedRunId = RunId.make("other-unfinished-run")
      const unfinishedAcquisition = {
        operationId: OperationId.make("other-unfinished-claim"),
        owner: ClaimOwner.make("dalph"),
        taskId: TaskId.make("other-unfinished-task"),
        token: ClaimToken.make("other-unfinished-token")
      }
      yield* Effect.gen(function* () {
        yield* (yield* JournalStore).append(
          unfinishedRunId,
          intentRecordKey(unfinishedAcquisition.operationId),
          TaskClaimAcquisitionIntendedEvent.make({
            operation: makeTaskClaimAcquisitionOperation({
              acquisition: unfinishedAcquisition,
              predecessorOperationIds: []
            }),
            version: workflowJournalEventVersion
          })
        )
      }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))

      const requestedRunId = RunId.make("requested-production-run")
      const application = productionWorkflowInterpreterLayer(
        requestedRunId,
        GitCommonDirectoryTarget.make(directory),
        controlledTrackerMutationLayer
      ).pipe(
        Layer.provide(Layer.succeed(TrackerGraphReader, TrackerGraphReader.of({ read: () => Effect.die("unused") }))),
        Layer.provide(Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })))
      )
      const blocked = yield* PlannedAttemptExecutor.pipe(
        Effect.provide(application),
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ DALPH_JOURNAL_DATABASE: filename }))),
        Effect.flip
      )
      expect(blocked).toMatchObject({
        _tag: "StartupRecoveryBlocked",
        issues: [{ _tag: "OtherUnfinishedRunIssue", requestedRunId, unfinishedRunId }]
      })
    }).pipe(Effect.provide(NodeServices.layer))
  )
)

it.effect("does not block startup for another run's completed responsibility", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-production-completed-run-" })
      const filename = JournalDatabaseLocator.make(`${directory}/journal.sqlite`)
      const completedRunId = RunId.make("other-completed-run")
      const completedAcquisition = {
        operationId: OperationId.make("other-completed-claim"),
        owner: ClaimOwner.make("dalph"),
        taskId: TaskId.make("other-completed-task"),
        token: ClaimToken.make("other-completed-token")
      }
      const operation = makeTaskClaimAcquisitionOperation({
        acquisition: completedAcquisition,
        predecessorOperationIds: []
      })
      yield* Effect.gen(function* () {
        const journal = yield* JournalStore
        yield* journal.append(
          completedRunId,
          intentRecordKey(completedAcquisition.operationId),
          TaskClaimAcquisitionIntendedEvent.make({ operation, version: workflowJournalEventVersion })
        )
        yield* journal.append(
          completedRunId,
          outcomeRecordKey(completedAcquisition.operationId),
          TaskClaimAcquiredEvent.make({
            claim: ActiveTaskClaim.make(completedAcquisition),
            version: workflowJournalEventVersion
          })
        )
      }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))

      const application = productionWorkflowInterpreterLayer(
        RunId.make("requested-after-completed-run"),
        GitCommonDirectoryTarget.make(directory),
        controlledTrackerMutationLayer
      ).pipe(
        Layer.provide(Layer.succeed(TrackerGraphReader, TrackerGraphReader.of({ read: () => Effect.die("unused") }))),
        Layer.provide(Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })))
      )
      expect(
        yield* PlannedAttemptExecutor.pipe(
          Effect.provide(application),
          Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ DALPH_JOURNAL_DATABASE: filename })))
        )
      ).toBeDefined()
    }).pipe(Effect.provide(NodeServices.layer))
  )
)
