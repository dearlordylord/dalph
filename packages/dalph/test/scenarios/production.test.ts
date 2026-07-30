// @effect-diagnostics multipleEffectProvide:off
import {
  AttemptId,
  GitCommitSha,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorReport,
  PlannedTaskAttempt,
  plannedAttemptExecutorCorrelation,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import {
  activateRecoveredResponsibilities,
  ActiveTaskClaim,
  attemptPlanRecordKey,
  ClaimOwner,
  ClaimToken,
  controlledTrackerMutationLayer,
  FixtureTarget,
  freshWorkflowRunId,
  GitCommand,
  GitCommonDirectoryTarget,
  intentRecordKey,
  JournalDatabaseLocator,
  JournalStore,
  InitialControlPolicy,
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskWorktreeReconciliationOperation,
  makeTrackerGraphObservationOperation,
  nodeGitCommandLayer,
  OperationId,
  OperationIdAllocator,
  outcomeRecordKey,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  plannedAttemptExecutorWorkReportedRecordKey,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey,
  PlannedWorktreeReady,
  PlannedTaskAttemptPlanner,
  projectTrackerSnapshot,
  runWorkflow,
  sqliteJournalStoreLayer,
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  taskTrackerReadIntent,
  TaskWorkCapacity,
  TaskClaimAcquisitionPlanner,
  TaskWorktreeReadyEvent,
  TaskWorktreeReconciliationIntendedEvent,
  TrackerGraphReader,
  TrackerMutation,
  TrackerRevision,
  WorkflowInterpreter,
  WorkflowRunAlreadyBegan,
  workflowJournalEventVersion,
  WorkflowTrace
} from "@dalph/orchestrator"
import { ConfigProvider, Effect, FileSystem, Layer, Option, Ref } from "effect"
import { expect } from "vitest"
import { taskTrackerGraphFactsObserved } from "../../../orchestrator/test/task-tracker-facts.js"
import { productionWorkflowInterpreterLayer } from "../../src/application/production.js"

it.effect("rejects a second fresh production start for the same Run before any tracker read", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-production-single-start-" })
      const git = yield* GitCommand
      yield* git.runInWorktree(directory, ["init"])
      const filename = JournalDatabaseLocator.make(`${directory}/journal.sqlite`)
      const target = FixtureTarget.make("production-single-start-target")
      const runId = yield* freshWorkflowRunId(target)
      const projected = projectTrackerSnapshot({ revision: "production-single-start-snapshot", tasks: [] })
      const snapshot = Option.getOrThrow(
        Option.fromUndefinedOr(projected._tag === "Valid" ? projected.snapshot : undefined)
      )
      const trackerReads = yield* Ref.make(0)
      const trackerReaderLayer = Layer.succeed(
        TrackerGraphReader,
        TrackerGraphReader.of({
          read: () => Ref.update(trackerReads, (count) => count + 1).pipe(Effect.as(snapshot)),
          readTaskWorkSpecification: () => Effect.die("empty tracker has no task-work specification")
        })
      )
      const application = productionWorkflowInterpreterLayer(
        runId,
        GitCommonDirectoryTarget.make(`${directory}/.git`),
        controlledTrackerMutationLayer
      ).pipe(
        Layer.provide(trackerReaderLayer),
        Layer.provide(Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })))
      )
      const execute = runWorkflow(
        target,
        InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }),
        runId
      ).pipe(
        Effect.provideService(
          OperationIdAllocator,
          OperationIdAllocator.of({ allocate: () => Effect.succeed(OperationId.make("production-single-start-read")) })
        ),
        Effect.provideService(
          TaskClaimAcquisitionPlanner,
          TaskClaimAcquisitionPlanner.of({ plan: () => Effect.die("empty tracker has no claim") })
        ),
        Effect.provideService(
          PlannedTaskAttemptPlanner,
          PlannedTaskAttemptPlanner.of({ plan: () => Effect.die("empty tracker has no attempt") })
        ),
        Effect.provide(application),
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ DALPH_JOURNAL_DATABASE: filename })))
      )

      yield* execute
      const repeated = yield* execute.pipe(Effect.flip)

      expect(repeated).toBeInstanceOf(WorkflowRunAlreadyBegan)
      expect(yield* Ref.get(trackerReads)).toBe(1)
      const records = yield* Effect.gen(function* () {
        return yield* (yield* JournalStore).read(runId)
      }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))
      expect(records[0]?.event._tag).toBe("WorkflowRunBegan")
      expect(records.at(-1)?.event._tag).toBe("WorkflowRunTerminated")
    }).pipe(Effect.provide(nodeGitCommandLayer), Effect.provide(NodeServices.layer))
  )
)

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
        yield* journal.append(runId, intentRecordKey(observation.operationId), taskTrackerReadIntent(observation))
        yield* journal.append(
          runId,
          outcomeRecordKey(observation.operationId),
          taskTrackerGraphFactsObserved(observation, {
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
          plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
          PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
            plannedAttempt,
            version: workflowJournalEventVersion
          })
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
        Layer.provide(
          Layer.succeed(
            TrackerGraphReader,
            TrackerGraphReader.of({
              read: () => Effect.die("unused"),
              readTaskWorkSpecification: () => Effect.die("unused")
            })
          )
        ),
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
      const missingIntentOperation = makeTrackerGraphObservationOperation(
        missingIntent,
        FixtureTarget.make("missing-observation-target")
      )
      yield* Effect.gen(function* () {
        const journal = yield* JournalStore
        const validObservation = makeTrackerGraphObservationOperation(
          OperationId.make("valid-preserved-observation"),
          FixtureTarget.make("valid-preserved-target")
        )
        yield* journal.append(
          RunId.make("valid-preserved-run"),
          intentRecordKey(validObservation.operationId),
          taskTrackerReadIntent(validObservation)
        )
        yield* journal.append(
          invalidRunId,
          outcomeRecordKey(missingIntent),
          taskTrackerGraphFactsObserved(missingIntentOperation, {
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
        Layer.provide(
          Layer.succeed(
            TrackerGraphReader,
            TrackerGraphReader.of({
              read: () => Effect.die("unused"),
              readTaskWorkSpecification: () => Effect.die("unused")
            })
          )
        ),
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
        Layer.provide(
          Layer.succeed(
            TrackerGraphReader,
            TrackerGraphReader.of({
              read: () => Effect.die("unused"),
              readTaskWorkSpecification: () => Effect.die("unused")
            })
          )
        ),
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

it.effect("blocks a new Run when another Run crashed immediately after recording its beginning", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-production-began-only-run-" })
      const filename = JournalDatabaseLocator.make(`${directory}/journal.sqlite`)
      const unfinishedRunId = RunId.make("began-only-unfinished-run")
      yield* Effect.gen(function* () {
        yield* (yield* JournalStore).beginRun(unfinishedRunId, FixtureTarget.make("began-only-target"))
      }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))

      const requestedRunId = RunId.make("new-run-after-began-only")
      const application = productionWorkflowInterpreterLayer(
        requestedRunId,
        GitCommonDirectoryTarget.make(directory),
        controlledTrackerMutationLayer
      ).pipe(
        Layer.provide(
          Layer.succeed(
            TrackerGraphReader,
            TrackerGraphReader.of({
              read: () => Effect.die("startup must stop before reading the tracker"),
              readTaskWorkSpecification: () => Effect.die("startup must stop before reading task work")
            })
          )
        ),
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
        Layer.provide(
          Layer.succeed(
            TrackerGraphReader,
            TrackerGraphReader.of({
              read: () => Effect.die("unused"),
              readTaskWorkSpecification: () => Effect.die("unused")
            })
          )
        ),
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
