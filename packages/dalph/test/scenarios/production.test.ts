// @effect-diagnostics multipleEffectProvide:off
import {
  AttemptId,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedAttemptExecutorReport,
  PlannedTaskAttempt,
  plannedAttemptExecutorCorrelation,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  WorktreeLocator
} from "@dalph/contracts"
import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import {
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
  JournalPosition,
  JournaledRunBootstrap,
  JournalStore,
  InitialControlPolicy,
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskWorkSpecification,
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
  runRecoveredWorkflow,
  runWorkflow,
  legacySqliteJournalStoreLayer,
  RunFinalityDecision,
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  taskTrackerReadIntent,
  TaskWorkCapacity,
  TaskClaimAcquisitionPlanner,
  taskRevisionFor,
  TaskWorktreeReadyEvent,
  TaskWorktreeReconciliationIntendedEvent,
  TrackerGraphReader,
  TrackerMutation,
  TrackerRevision,
  WorkflowRunAlreadyBegan,
  workflowJournalEventVersion,
  WorkflowTrace
} from "@dalph/orchestrator"
import { ConfigProvider, Deferred, Effect, Fiber, FileSystem, Layer, Option, Ref } from "effect"
import { expect } from "vitest"
import { taskTrackerGraphFactsObserved } from "../../../orchestrator/test/task-tracker-facts.js"
import { productionWorkflowInterpreterLayer } from "../../src/application/production.js"

const productionIntegrationTarget = (repository: string): IntegrationTarget =>
  IntegrationTarget.make({
    repository: GitRepositoryLocator.make(repository),
    ref: IntegrationTargetRef.make("refs/heads/master")
  })

it.effect("continues a fresh production task after its claim is journaled", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-production-fresh-task-" })
      const git = yield* GitCommand
      yield* git.runInWorktree(directory, ["init"])
      yield* git.runInWorktree(directory, ["config", "user.email", "dalph@example.invalid"])
      yield* git.runInWorktree(directory, ["config", "user.name", "Dalph Test"])
      yield* fileSystem.writeFileString(`${directory}/README.md`, "fresh production task\n")
      yield* git.runInWorktree(directory, ["add", "README.md"])
      yield* git.runInWorktree(directory, ["commit", "-m", "initial"])
      const baseSha = GitCommitSha.make((yield* git.runInWorktree(directory, ["rev-parse", "HEAD"])).stdout.trim())
      const target = FixtureTarget.make("production-fresh-task-target")
      const runId = yield* freshWorkflowRunId(target)
      const projected = projectTrackerSnapshot({
        revision: "production-fresh-task-snapshot",
        tasks: [{ id: "A", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
      })
      const snapshot = Option.getOrThrow(
        Option.fromUndefinedOr(projected._tag === "Valid" ? projected.snapshot : undefined)
      )
      const task = Option.getOrThrow(Option.fromUndefinedOr(snapshot.eligibleTasks()[0]))
      const plannedAttempt = PlannedTaskAttempt.make({
        attemptId: AttemptId.make("production-fresh-task-attempt"),
        baseSha,
        branch: TaskBranchRef.make("refs/heads/dalph/production-fresh-task-attempt"),
        executor: TaskExecutorLocator.make("executor:production-controlled-fake"),
        runId,
        taskId: task.id,
        taskRevision: taskRevisionFor(task),
        worktree: WorktreeLocator.make(`${directory}/worktree`)
      })
      const specificationReads = yield* Ref.make(0)
      const trackerReaderLayer = Layer.succeed(
        TrackerGraphReader,
        TrackerGraphReader.of({
          read: () => Effect.succeed(snapshot),
          readTaskWorkSpecification: (_target, taskId) =>
            Ref.update(specificationReads, (count) => count + 1).pipe(
              Effect.as(makeTaskWorkSpecification({ body: "Complete A.", taskId, title: "Complete A" }))
            )
        })
      )
      const filename = JournalDatabaseLocator.make(`${directory}/journal.sqlite`)
      const application = productionWorkflowInterpreterLayer(
        runId,
        GitCommonDirectoryTarget.make(`${directory}/.git`),
        productionIntegrationTarget(`${directory}/.git`),
        controlledTrackerMutationLayer
      ).pipe(
        Layer.provide(trackerReaderLayer),
        Layer.provide(Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })))
      )
      const nextOperation = yield* Ref.make(0)

      yield* runWorkflow(
        target,
        InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }),
        runId
      ).pipe(
        Effect.provideService(
          OperationIdAllocator,
          OperationIdAllocator.of({
            allocate: () =>
              Ref.getAndUpdate(nextOperation, (value) => value + 1).pipe(
                Effect.map((value) => OperationId.make(`production-fresh-task-operation-${value}`))
              )
          })
        ),
        Effect.provideService(
          TaskClaimAcquisitionPlanner,
          TaskClaimAcquisitionPlanner.of({
            plan: (operationId, taskId) =>
              Effect.succeed({
                operationId,
                owner: ClaimOwner.make("dalph"),
                taskId,
                token: ClaimToken.make("production-fresh-task-token")
              })
          })
        ),
        Effect.provideService(
          PlannedTaskAttemptPlanner,
          PlannedTaskAttemptPlanner.of({ plan: () => Effect.succeed(plannedAttempt) })
        ),
        Effect.provide(application),
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ DALPH_JOURNAL_DATABASE: filename })))
      )

      expect(yield* Ref.get(specificationReads)).toBe(1)
    }).pipe(Effect.provide(nodeGitCommandLayer), Effect.provide(NodeServices.layer))
  )
)

it.effect("ticket delivery checks the tracker after a lost claim response and reuses the exact claim", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-production-lost-claim-" })
      const git = yield* GitCommand
      yield* git.runInWorktree(directory, ["init"])
      const filename = JournalDatabaseLocator.make(`${directory}/journal.sqlite`)
      const runId = RunId.make("production-lost-claim-run")
      const target = FixtureTarget.make("production-lost-claim-target")
      const taskId = TaskId.make("A")
      const graphRead = makeTrackerGraphObservationOperation(OperationId.make("production-lost-claim-graph"), target)
      const acquisition = {
        operationId: OperationId.make("production-lost-claim-operation"),
        owner: ClaimOwner.make("dalph"),
        taskId,
        token: ClaimToken.make("production-lost-claim-token")
      }
      const claim = ActiveTaskClaim.make(acquisition)
      const claimOperation = makeTaskClaimAcquisitionOperation({
        acquisition,
        predecessorOperationIds: [graphRead.operationId]
      })
      yield* Effect.gen(function* () {
        const journal = yield* JournalStore
        yield* journal.beginRun(
          runId,
          target,
          InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
        )
        yield* journal.append(runId, intentRecordKey(graphRead.operationId), taskTrackerReadIntent(graphRead))
        yield* journal.append(
          runId,
          outcomeRecordKey(graphRead.operationId),
          taskTrackerGraphFactsObserved(graphRead, {
            revision: TrackerRevision.make("production-lost-claim-before-crash"),
            taskIds: [taskId]
          })
        )
        yield* journal.append(
          runId,
          intentRecordKey(acquisition.operationId),
          TaskClaimAcquisitionIntendedEvent.make({ operation: claimOperation, version: workflowJournalEventVersion })
        )
      }).pipe(Effect.provide(legacySqliteJournalStoreLayer({ filename })))

      const current = projectTrackerSnapshot({ revision: "production-lost-claim-current", tasks: [] })
      if (current._tag === "Invalid") return yield* Effect.die("current graph must be valid")
      const acquireCalls = yield* Ref.make(0)
      const claimReads = yield* Ref.make(0)
      const nextOperation = yield* Ref.make(0)
      const trackerLayer = Layer.succeed(
        TrackerMutation,
        TrackerMutation.of({
          acquireTaskClaim: () => Ref.update(acquireCalls, (count) => count + 1).pipe(Effect.as(claim)),
          readTaskClaim: () => Ref.update(claimReads, (count) => count + 1).pipe(Effect.as(claim)),
          releaseTaskClaim: () => Effect.void
        })
      )
      const application = productionWorkflowInterpreterLayer(
        runId,
        GitCommonDirectoryTarget.make(`${directory}/.git`),
        productionIntegrationTarget(`${directory}/.git`),
        trackerLayer
      ).pipe(
        Layer.provide(
          Layer.succeed(
            TrackerGraphReader,
            TrackerGraphReader.of({
              read: () => Effect.succeed(current.snapshot),
              readTaskWorkSpecification: () => Effect.die("removed task has no specification")
            })
          )
        ),
        Layer.provide(Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })))
      )

      yield* runRecoveredWorkflow(target).pipe(
        Effect.provideService(
          OperationIdAllocator,
          OperationIdAllocator.of({
            allocate: () =>
              Ref.getAndUpdate(nextOperation, (value) => value + 1).pipe(
                Effect.map((value) => OperationId.make(`production-lost-claim-operation-${value}`))
              )
          })
        ),
        Effect.provideService(
          TaskClaimAcquisitionPlanner,
          TaskClaimAcquisitionPlanner.of({ plan: () => Effect.die("recovery must reuse the accepted claim identity") })
        ),
        Effect.provideService(
          PlannedTaskAttemptPlanner,
          PlannedTaskAttemptPlanner.of({ plan: () => Effect.die("removed task must not plan an attempt") })
        ),
        Effect.provide(application),
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ DALPH_JOURNAL_DATABASE: filename })))
      )

      expect(yield* Ref.get(acquireCalls)).toBe(0)
      expect(yield* Ref.get(claimReads)).toBeGreaterThan(0)
      const records = yield* Effect.gen(function* () {
        return yield* (yield* JournalStore).read(runId)
      }).pipe(Effect.provide(legacySqliteJournalStoreLayer({ filename })))
      expect(records.filter(({ event }) => event._tag === "TaskClaimAcquisitionIntended")).toHaveLength(1)
      expect(records.find(({ event }) => event._tag === "TaskClaimAcquired")?.event).toMatchObject({
        _tag: "TaskClaimAcquired",
        claim: { operationId: acquisition.operationId }
      })
    }).pipe(Effect.provide(nodeGitCommandLayer), Effect.provide(NodeServices.layer))
  )
)

it.effect("ticket delivery reads Git after ambiguous worktree creation and preserves the exact registration", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-production-ambiguous-worktree-" })
      const git = yield* GitCommand
      yield* git.runInWorktree(directory, ["init"])
      yield* git.runInWorktree(directory, ["config", "user.email", "dalph@example.invalid"])
      yield* git.runInWorktree(directory, ["config", "user.name", "Dalph Test"])
      yield* fileSystem.writeFileString(`${directory}/README.md`, "ambiguous worktree\n")
      yield* git.runInWorktree(directory, ["add", "README.md"])
      yield* git.runInWorktree(directory, ["commit", "-m", "initial"])
      const baseSha = GitCommitSha.make((yield* git.runInWorktree(directory, ["rev-parse", "HEAD"])).stdout.trim())
      const filename = JournalDatabaseLocator.make(`${directory}/journal.sqlite`)
      const runId = RunId.make("production-ambiguous-worktree-run")
      const target = FixtureTarget.make("production-ambiguous-worktree-target")
      const specification = makeTaskWorkSpecification({
        body: "Complete A.",
        taskId: TaskId.make("A"),
        title: "Complete A"
      })
      const projected = projectTrackerSnapshot({
        revision: "production-ambiguous-worktree-current",
        tasks: [{ id: "A", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
      })
      if (projected._tag === "Invalid") return yield* Effect.die("current graph must be valid")
      const plannedAttempt = PlannedTaskAttempt.make({
        attemptId: AttemptId.make("production-ambiguous-worktree-attempt"),
        baseSha,
        branch: TaskBranchRef.make("refs/heads/dalph/production-ambiguous-worktree"),
        executor: TaskExecutorLocator.make("executor:production-controlled-fake"),
        runId,
        taskId: specification.taskId,
        taskRevision: specification.fingerprint,
        worktree: WorktreeLocator.make(`${directory}/worktree`)
      })
      yield* git.runInWorktree(directory, [
        "worktree",
        "add",
        "-b",
        "dalph/production-ambiguous-worktree",
        plannedAttempt.worktree,
        plannedAttempt.baseSha
      ])
      const worktreesBefore = (yield* git.runInWorktree(directory, ["worktree", "list", "--porcelain"])).stdout
      const acquisition = {
        operationId: OperationId.make("production-ambiguous-worktree-claim"),
        owner: ClaimOwner.make("dalph"),
        taskId: plannedAttempt.taskId,
        token: ClaimToken.make("production-ambiguous-worktree-token")
      }
      const claim = ActiveTaskClaim.make(acquisition)
      const graphRead = makeTrackerGraphObservationOperation(
        OperationId.make("production-ambiguous-worktree-graph"),
        target
      )
      const claimOperation = makeTaskClaimAcquisitionOperation({
        acquisition,
        predecessorOperationIds: [graphRead.operationId]
      })
      const plan = makeTaskAttemptPlanOperation({
        operationId: OperationId.make("production-ambiguous-worktree-plan"),
        plannedAttempt,
        predecessorOperationIds: [claimOperation.acquisition.operationId]
      })
      const worktree = makeTaskWorktreeReconciliationOperation({
        operationId: OperationId.make("production-ambiguous-worktree-operation"),
        plannedAttempt,
        predecessorOperationIds: [plan.operationId]
      })
      yield* Effect.gen(function* () {
        const journal = yield* JournalStore
        yield* journal.beginRun(
          runId,
          target,
          InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
        )
        yield* journal.append(runId, intentRecordKey(graphRead.operationId), taskTrackerReadIntent(graphRead))
        yield* journal.append(
          runId,
          outcomeRecordKey(graphRead.operationId),
          taskTrackerGraphFactsObserved(graphRead, {
            revision: TrackerRevision.make("production-ambiguous-worktree-before-crash"),
            taskIds: [plannedAttempt.taskId]
          })
        )
        yield* journal.append(
          runId,
          intentRecordKey(acquisition.operationId),
          TaskClaimAcquisitionIntendedEvent.make({ operation: claimOperation, version: workflowJournalEventVersion })
        )
        yield* journal.append(
          runId,
          outcomeRecordKey(acquisition.operationId),
          TaskClaimAcquiredEvent.make({ claim, version: workflowJournalEventVersion })
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
      }).pipe(Effect.provide(legacySqliteJournalStoreLayer({ filename })))

      const trackerLayer = Layer.succeed(
        TrackerMutation,
        TrackerMutation.of({
          acquireTaskClaim: () => Effect.die("recovery must not acquire another claim"),
          readTaskClaim: () => Effect.succeed(claim),
          releaseTaskClaim: () => Effect.void
        })
      )
      const application = productionWorkflowInterpreterLayer(
        runId,
        GitCommonDirectoryTarget.make(`${directory}/.git`),
        productionIntegrationTarget(`${directory}/.git`),
        trackerLayer
      ).pipe(
        Layer.provide(
          Layer.succeed(
            TrackerGraphReader,
            TrackerGraphReader.of({
              read: () => Effect.succeed(projected.snapshot),
              readTaskWorkSpecification: () => Effect.succeed(specification)
            })
          )
        ),
        Layer.provide(Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })))
      )
      const nextOperation = yield* Ref.make(0)
      yield* runRecoveredWorkflow(target).pipe(
        Effect.provideService(
          OperationIdAllocator,
          OperationIdAllocator.of({
            allocate: () =>
              Ref.getAndUpdate(nextOperation, (value) => value + 1).pipe(
                Effect.map((value) => OperationId.make(`production-ambiguous-worktree-recovery-${value}`))
              )
          })
        ),
        Effect.provideService(
          TaskClaimAcquisitionPlanner,
          TaskClaimAcquisitionPlanner.of({ plan: () => Effect.die("recovery must reuse the exact claim") })
        ),
        Effect.provideService(
          PlannedTaskAttemptPlanner,
          PlannedTaskAttemptPlanner.of({ plan: () => Effect.die("recovery must reuse the exact attempt") })
        ),
        Effect.provide(application),
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ DALPH_JOURNAL_DATABASE: filename })))
      )

      const worktreesAfter = (yield* git.runInWorktree(directory, ["worktree", "list", "--porcelain"])).stdout
      expect(worktreesAfter).toBe(worktreesBefore)
      const records = yield* Effect.gen(function* () {
        return yield* (yield* JournalStore).read(runId)
      }).pipe(Effect.provide(legacySqliteJournalStoreLayer({ filename })))
      expect(records.filter(({ event }) => event._tag === "TaskWorktreeReconciliationIntended")).toHaveLength(1)
      expect(records.find(({ event }) => event._tag === "TaskWorktreeReady")?.event).toMatchObject({
        _tag: "TaskWorktreeReady",
        operationId: worktree.operationId,
        proof: {
          baseSha: plannedAttempt.baseSha,
          branch: plannedAttempt.branch,
          headSha: plannedAttempt.baseSha,
          worktree: plannedAttempt.worktree
        }
      })
    }).pipe(Effect.provide(nodeGitCommandLayer), Effect.provide(NodeServices.layer))
  )
)

it.effect("records an Operator capacity change through the production composition before scheduling continues", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-production-capacity-change-" })
      const git = yield* GitCommand
      yield* git.runInWorktree(directory, ["init"])
      const filename = JournalDatabaseLocator.make(`${directory}/journal.sqlite`)
      const target = FixtureTarget.make("production-capacity-change-target")
      const runId = yield* freshWorkflowRunId(target)
      const projected = projectTrackerSnapshot({ revision: "production-capacity-change-snapshot", tasks: [] })
      const snapshot = Option.getOrThrow(
        Option.fromUndefinedOr(projected._tag === "Valid" ? projected.snapshot : undefined)
      )
      const initialReadStarted = yield* Deferred.make<void>()
      const returnInitialRead = yield* Deferred.make<void>()
      const reads = yield* Ref.make(0)
      const nextOperation = yield* Ref.make(0)
      const trackerReaderLayer = Layer.succeed(
        TrackerGraphReader,
        TrackerGraphReader.of({
          read: () =>
            Ref.getAndUpdate(reads, (count) => count + 1).pipe(
              Effect.flatMap((count) =>
                count === 0
                  ? Deferred.succeed(initialReadStarted, undefined).pipe(
                      Effect.andThen(Deferred.await(returnInitialRead)),
                      Effect.as(snapshot)
                    )
                  : Effect.succeed(snapshot)
              )
            ),
          readTaskWorkSpecification: () => Effect.die("empty tracker has no task-work specification")
        })
      )
      const application = productionWorkflowInterpreterLayer(
        runId,
        GitCommonDirectoryTarget.make(`${directory}/.git`),
        productionIntegrationTarget(`${directory}/.git`),
        controlledTrackerMutationLayer
      ).pipe(
        Layer.provide(trackerReaderLayer),
        Layer.provide(Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })))
      )
      yield* Effect.gen(function* () {
        const bootstrap = yield* JournaledRunBootstrap
        const running = yield* runWorkflow(
          target,
          InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(2) }),
          runId
        ).pipe(
          Effect.provideService(
            OperationIdAllocator,
            OperationIdAllocator.of({
              allocate: () =>
                Ref.getAndUpdate(nextOperation, (value) => value + 1).pipe(
                  Effect.map((value) => OperationId.make(`production-capacity-change-operation-${value}`))
                )
            })
          ),
          Effect.provideService(
            TaskClaimAcquisitionPlanner,
            TaskClaimAcquisitionPlanner.of({ plan: () => Effect.die("empty tracker has no claim") })
          ),
          Effect.provideService(
            PlannedTaskAttemptPlanner,
            PlannedTaskAttemptPlanner.of({ plan: () => Effect.die("empty tracker has no attempt") })
          ),
          Effect.forkScoped
        )
        yield* Deferred.await(initialReadStarted)
        const current = yield* bootstrap.operatorControl.readTaskWorkCapacity(runId)
        yield* bootstrap.operatorControl.setTaskWorkCapacity({ capacity: 1, expectedRevision: current.revision, runId })
        yield* bootstrap.operatorControl.applyControlDirection({ direction: "Pause", subject: { _tag: "Run", runId } })
        yield* bootstrap.operatorControl.applyControlDirection({
          direction: "Unpause",
          subject: { _tag: "Run", runId }
        })
        yield* Deferred.succeed(returnInitialRead, undefined)
        yield* Fiber.join(running)
      }).pipe(
        Effect.provide(application),
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ DALPH_JOURNAL_DATABASE: filename })))
      )
      const records = yield* Effect.gen(function* () {
        return yield* (yield* JournalStore).read(runId)
      }).pipe(Effect.provide(legacySqliteJournalStoreLayer({ filename })))

      expect(records.find(({ event }) => event._tag === "WorkflowRunBegan")?.event).toMatchObject({
        initialControlPolicy: { taskExecutionCapacity: 2 }
      })
      expect(records.find(({ event }) => event._tag === "TaskWorkCapacityChanged")?.event).toMatchObject({
        capacity: 1,
        previousRevision: 1,
        revision: 2
      })
      expect(
        records
          .filter(({ event }) => event._tag === "ControlDirectionApplied")
          .map(({ event }) => (event._tag === "ControlDirectionApplied" ? event.direction : undefined))
      ).toEqual(["Pause", "Unpause"])
    }).pipe(Effect.provide(nodeGitCommandLayer), Effect.provide(NodeServices.layer))
  )
)

it.effect("terminates once only after G2 proves the target complete and responsibilities settled", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-production-single-start-" })
      const git = yield* GitCommand
      yield* git.runInWorktree(directory, ["init"])
      const filename = JournalDatabaseLocator.make(`${directory}/journal.sqlite`)
      const target = FixtureTarget.make("production-single-start-target")
      const runId = yield* freshWorkflowRunId(target)
      const projected = projectTrackerSnapshot({
        revision: "production-single-start-snapshot",
        tasks: [
          {
            id: TaskId.make("A"),
            lifecycle: { _tag: "CompletedSuccessfully" },
            parentTaskId: null,
            prerequisiteIds: []
          }
        ]
      })
      const snapshot = Option.getOrThrow(
        Option.fromUndefinedOr(projected._tag === "Valid" ? projected.snapshot : undefined)
      )
      const trackerReads = yield* Ref.make(0)
      const nextOperation = yield* Ref.make(0)
      const trackerReaderLayer = Layer.succeed(
        TrackerGraphReader,
        TrackerGraphReader.of({
          read: () => Ref.update(trackerReads, (count) => count + 1).pipe(Effect.as(snapshot)),
          readTaskWorkSpecification: () => Effect.die("completed tracker task needs no task-work specification")
        })
      )
      const application = productionWorkflowInterpreterLayer(
        runId,
        GitCommonDirectoryTarget.make(`${directory}/.git`),
        productionIntegrationTarget(`${directory}/.git`),
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
          OperationIdAllocator.of({
            allocate: () =>
              Ref.getAndUpdate(nextOperation, (value) => value + 1).pipe(
                Effect.map((value) => OperationId.make(`production-single-start-operation-${value}`))
              )
          })
        ),
        Effect.provideService(
          TaskClaimAcquisitionPlanner,
          TaskClaimAcquisitionPlanner.of({ plan: () => Effect.die("completed tracker task has no claim") })
        ),
        Effect.provideService(
          PlannedTaskAttemptPlanner,
          PlannedTaskAttemptPlanner.of({ plan: () => Effect.die("completed tracker task has no attempt") })
        ),
        Effect.provide(application),
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ DALPH_JOURNAL_DATABASE: filename })))
      )

      yield* execute
      const readsAfterFirstRun = yield* Ref.get(trackerReads)
      const repeated = yield* execute.pipe(Effect.flip)

      expect(repeated).toBeInstanceOf(WorkflowRunAlreadyBegan)
      expect(readsAfterFirstRun).toBe(2)
      expect(yield* Ref.get(trackerReads)).toBe(readsAfterFirstRun)
      const records = yield* Effect.gen(function* () {
        return yield* (yield* JournalStore).read(runId)
      }).pipe(Effect.provide(legacySqliteJournalStoreLayer({ filename })))
      expect(records[0]?.event._tag).toBe("WorkflowRunBegan")
      expect(records.at(-1)?.event._tag).toBe("WorkflowRunTerminated")
    }).pipe(Effect.provide(nodeGitCommandLayer), Effect.provide(NodeServices.layer))
  )
)

it.effect("accepts a later recovered invocation after quiescent incomplete return", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-production-incomplete-" })
      const git = yield* GitCommand
      yield* git.runInWorktree(directory, ["init"])
      const filename = JournalDatabaseLocator.make(`${directory}/journal.sqlite`)
      const target = FixtureTarget.make("production-incomplete-target")
      const runId = yield* freshWorkflowRunId(target)
      const projected = projectTrackerSnapshot({
        revision: "production-incomplete-snapshot",
        tasks: [
          {
            id: TaskId.make("A"),
            lifecycle: { _tag: "TerminalWithoutSuccess" },
            parentTaskId: null,
            prerequisiteIds: []
          },
          { id: TaskId.make("B"), lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [TaskId.make("A")] }
        ]
      })
      const snapshot = Option.getOrThrow(
        Option.fromUndefinedOr(projected._tag === "Valid" ? projected.snapshot : undefined)
      )
      const trackerReads = yield* Ref.make(0)
      const nextOperation = yield* Ref.make(0)
      const trackerReaderLayer = Layer.succeed(
        TrackerGraphReader,
        TrackerGraphReader.of({
          read: () => Ref.update(trackerReads, (count) => count + 1).pipe(Effect.as(snapshot)),
          readTaskWorkSpecification: () => Effect.die("incomplete tracker has no selected task")
        })
      )
      const application = productionWorkflowInterpreterLayer(
        runId,
        GitCommonDirectoryTarget.make(`${directory}/.git`),
        productionIntegrationTarget(`${directory}/.git`),
        controlledTrackerMutationLayer
      ).pipe(
        Layer.provide(trackerReaderLayer),
        Layer.provide(Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })))
      )
      const operationAllocator = OperationIdAllocator.of({
        allocate: () =>
          Ref.getAndUpdate(nextOperation, (value) => value + 1).pipe(
            Effect.map((value) => OperationId.make(`production-incomplete-operation-${value}`))
          )
      })
      const claimPlanner = TaskClaimAcquisitionPlanner.of({ plan: () => Effect.die("incomplete tracker has no claim") })
      const attemptPlanner = PlannedTaskAttemptPlanner.of({
        plan: () => Effect.die("incomplete tracker has no attempt")
      })
      const provideRunEnvironment = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        effect.pipe(
          Effect.provideService(OperationIdAllocator, operationAllocator),
          Effect.provideService(TaskClaimAcquisitionPlanner, claimPlanner),
          Effect.provideService(PlannedTaskAttemptPlanner, attemptPlanner),
          Effect.provide(application),
          Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ DALPH_JOURNAL_DATABASE: filename })))
        )

      const fresh = yield* runWorkflow(
        target,
        InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }),
        runId
      ).pipe(provideRunEnvironment)
      const recovered = yield* runRecoveredWorkflow(target).pipe(provideRunEnvironment)
      const records = yield* Effect.gen(function* () {
        return yield* (yield* JournalStore).read(runId)
      }).pipe(Effect.provide(legacySqliteJournalStoreLayer({ filename })))

      expect(fresh).toEqual({ _tag: "RunMustRemainActive", reason: "TrackerTargetUnsettled" })
      expect(recovered).toEqual({ _tag: "RunMustRemainActive", reason: "TrackerTargetUnsettled" })
      expect(yield* Ref.get(trackerReads)).toBe(4)
      expect(records.some(({ event }) => event._tag === "WorkflowRunTerminated")).toBe(false)
    }).pipe(Effect.provide(nodeGitCommandLayer), Effect.provide(NodeServices.layer))
  )
)

it.effect("publishes each accepted executor report before continuing and stops after Terminal", () =>
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
      const currentSpecification = makeTaskWorkSpecification({
        body: "Complete A.",
        taskId: TaskId.make("A"),
        title: "Complete A"
      })
      const plannedAttempt = PlannedTaskAttempt.make({
        attemptId: AttemptId.make("production-fake-attempt"),
        baseSha,
        branch: TaskBranchRef.make("refs/heads/dalph/production-fake-attempt"),
        executor: TaskExecutorLocator.make("executor:production-controlled-fake"),
        runId,
        taskId: TaskId.make("A"),
        taskRevision: currentSpecification.fingerprint,
        worktree: WorktreeLocator.make(`${directory}/worktree`)
      })
      const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
      const projected = projectTrackerSnapshot({
        revision: "production-current-observation",
        tasks: [{ id: "A", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
      })
      const currentSnapshot = Option.getOrThrow(
        Option.fromUndefinedOr(projected._tag === "Valid" ? projected.snapshot : undefined)
      )
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
      const trackerTarget = FixtureTarget.make("production-target")
      const observation = makeTrackerGraphObservationOperation(
        OperationId.make("production-observation"),
        trackerTarget,
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
        yield* journal.beginRun(
          runId,
          trackerTarget,
          InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
        )
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
      }).pipe(Effect.provide(legacySqliteJournalStoreLayer({ filename })))
      const trackerLayer = Layer.succeed(
        TrackerMutation,
        TrackerMutation.of({
          acquireTaskClaim: () => Effect.succeed(ActiveTaskClaim.make(acquisition)),
          readTaskClaim: () => Effect.succeed(ActiveTaskClaim.make(acquisition)),
          releaseTaskClaim: () => Effect.void
        })
      )
      const retryTarget = IntegrationTarget.make({
        repository: GitRepositoryLocator.make(`${directory}/.git`),
        ref: IntegrationTargetRef.make("refs/heads/recovery-target")
      })
      const application = productionWorkflowInterpreterLayer(
        runId,
        GitCommonDirectoryTarget.make(`${directory}/.git`),
        retryTarget,
        trackerLayer
      ).pipe(
        Layer.provide(
          Layer.succeed(
            TrackerGraphReader,
            TrackerGraphReader.of({
              read: () => Effect.succeed(currentSnapshot),
              readTaskWorkSpecification: () => Effect.succeed(currentSpecification)
            })
          )
        ),
        Layer.provide(Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })))
      )
      const nextOperation = yield* Ref.make(0)
      const runRecovered = runRecoveredWorkflow(trackerTarget).pipe(
        Effect.provideService(
          OperationIdAllocator,
          OperationIdAllocator.of({
            allocate: () =>
              Ref.getAndUpdate(nextOperation, (value) => value + 1).pipe(
                Effect.map((value) => OperationId.make(`production-recovery-operation-${value}`))
              )
          })
        ),
        Effect.provideService(
          TaskClaimAcquisitionPlanner,
          TaskClaimAcquisitionPlanner.of({ plan: () => Effect.die("recovery must not acquire another claim") })
        ),
        Effect.provideService(
          PlannedTaskAttemptPlanner,
          PlannedTaskAttemptPlanner.of({ plan: () => Effect.die("recovery must not plan another attempt") })
        ),
        Effect.provide(application),
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ DALPH_JOURNAL_DATABASE: filename })))
      )
      const failure = yield* runRecovered.pipe(Effect.flip)
      expect(failure._tag).toBe("GitTargetLineageReadFailure")
      const failedRecords = yield* Effect.gen(function* () {
        return yield* (yield* JournalStore).read(runId)
      }).pipe(Effect.provide(legacySqliteJournalStoreLayer({ filename })))
      const targetReadIntents = failedRecords.filter(
        ({ event }) => event._tag === "GitReadIntentRecorded" && event.operation._tag === "ReadTargetLineage"
      )
      expect(targetReadIntents).toHaveLength(1)
      expect(failedRecords.some(({ event }) => event._tag === "TargetLineageObserved")).toBe(false)

      yield* git.runInWorktree(directory, ["update-ref", retryTarget.ref, plannedAttempt.baseSha])
      yield* runRecovered
      const records = yield* Effect.gen(function* () {
        return yield* (yield* JournalStore).read(runId)
      }).pipe(Effect.provide(legacySqliteJournalStoreLayer({ filename })))
      const originalTargetReadOperationId =
        targetReadIntents[0]?.event._tag === "GitReadIntentRecorded"
          ? targetReadIntents[0].event.operation.operationId
          : undefined
      expect(
        records.some(
          ({ event }) => event._tag === "TargetLineageObserved" && event.operationId === originalTargetReadOperationId
        )
      ).toBe(true)
      expect(records.findLast(({ event }) => event._tag === "PlannedAttemptExecutorWorkReported")?.event).toMatchObject(
        {
          _tag: "PlannedAttemptExecutorWorkReported",
          report: { _tag: "Terminal", correlation, result: { _tag: "Completed" } }
        }
      )
      expect(
        records.flatMap(({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkReported"
            ? [{ ordinal: event.ordinal, report: event.report._tag }]
            : []
        )
      ).toEqual([
        { ordinal: 1, report: "Running" },
        { ordinal: 2, report: "Running" },
        { ordinal: 3, report: "Terminal" }
      ])
      const terminal = records.findLast(
        ({ event }) => event._tag === "PlannedAttemptExecutorWorkReported" && event.report._tag === "Terminal"
      )
      const stabilizationRead = records.findLast(({ event }) => event._tag === "TaskTrackerReadIntentRecorded")
      expect(terminal).toBeDefined()
      expect(stabilizationRead).toBeDefined()
      expect(terminal?.position).toBeLessThan(stabilizationRead?.position ?? JournalPosition.make(0))
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
      }).pipe(Effect.provide(legacySqliteJournalStoreLayer({ filename })))

      const application = productionWorkflowInterpreterLayer(
        RunId.make("current-production-run"),
        GitCommonDirectoryTarget.make(directory),
        productionIntegrationTarget(directory),
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
      const blocked = yield* JournaledRunBootstrap.pipe(
        Effect.flatMap((bootstrap) =>
          bootstrap.recovered(
            FixtureTarget.make("current-production-target"),
            Effect.succeed({
              acceptedAt: null,
              decision: RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })
            })
          )
        ),
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
      }).pipe(Effect.provide(legacySqliteJournalStoreLayer({ filename })))

      const requestedRunId = RunId.make("requested-production-run")
      const application = productionWorkflowInterpreterLayer(
        requestedRunId,
        GitCommonDirectoryTarget.make(directory),
        productionIntegrationTarget(directory),
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
      const blocked = yield* JournaledRunBootstrap.pipe(
        Effect.flatMap((bootstrap) =>
          bootstrap.recovered(
            FixtureTarget.make("requested-production-target"),
            Effect.succeed({
              acceptedAt: null,
              decision: RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })
            })
          )
        ),
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
        yield* (yield* JournalStore).beginRun(
          unfinishedRunId,
          FixtureTarget.make("began-only-target"),
          InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
        )
      }).pipe(Effect.provide(legacySqliteJournalStoreLayer({ filename })))

      const requestedRunId = RunId.make("new-run-after-began-only")
      const application = productionWorkflowInterpreterLayer(
        requestedRunId,
        GitCommonDirectoryTarget.make(directory),
        productionIntegrationTarget(directory),
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
      const blocked = yield* JournaledRunBootstrap.pipe(
        Effect.flatMap((bootstrap) =>
          bootstrap.recovered(
            FixtureTarget.make("new-run-after-began-only-target"),
            Effect.succeed({
              acceptedAt: null,
              decision: RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })
            })
          )
        ),
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
      }).pipe(Effect.provide(legacySqliteJournalStoreLayer({ filename })))

      const requestedTarget = FixtureTarget.make("requested-after-completed-run-target")
      const requestedRunId = yield* freshWorkflowRunId(requestedTarget)
      const application = productionWorkflowInterpreterLayer(
        requestedRunId,
        GitCommonDirectoryTarget.make(directory),
        productionIntegrationTarget(directory),
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
        yield* JournaledRunBootstrap.pipe(
          Effect.flatMap((bootstrap) =>
            bootstrap.fresh(
              requestedTarget,
              InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }),
              requestedRunId,
              Effect.succeed({
                acceptedAt: null,
                decision: RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })
              })
            )
          ),
          Effect.provide(application),
          Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ DALPH_JOURNAL_DATABASE: filename })))
        )
      ).toEqual({ _tag: "RunMustRemainActive", reason: "TrackerTargetUnsettled" })
    }).pipe(Effect.provide(NodeServices.layer))
  )
)
