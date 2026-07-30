// @effect-diagnostics multipleEffectProvide:off
import { it } from "@effect/vitest"
import {
  controlledFakePlannedAttemptExecutorLayer,
  makeControlledFakePlannedAttemptExecutorLayer
} from "../../../test/controlled-planned-attempt-executor.js"
import { Effect, Layer, Ref } from "effect"
import { expect } from "vitest"
import {
  AttemptId,
  GitCommitSha,
  PlannedAttemptExecutorReport,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { OperationId } from "../../workflow/identity.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import {
  attemptPlanRecordKey,
  intentRecordKey,
  outcomeRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey
} from "../../workflow-journal/record-key.js"
import { JournalStore } from "../../workflow-journal/store.js"
import {
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  TaskClaimReleaseIntendedEvent,
  taskTrackerReadIntent,
  TaskWorktreeReconciliationIntendedEvent
} from "../../workflow/registry/event.js"
import { memoryJournalStoreLayer } from "../../workflow-journal/adapters/memory-store.js"
import {
  activateRecoveredResponsibilities,
  journaledFreshRunRecoveryActivationLayer,
  makeJournaledFreshRunRecoveryActivation,
  makeRunRecoveryActivation,
  RunRecoveryActivation
} from "../run/recovery-activation.js"
import { trustedPlannedAttemptRecoveryAuthorityLayer } from "../run/recovery-authority.js"
import { RunnableFrontierTransition } from "./frontier.js"
import { recoverRunnableTransition } from "./recovery.js"
import {
  makeTaskClaimAcquisitionOperation,
  makeTaskClaimReleaseOperation,
  makeTaskAttemptPlanOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTrackerGraphObservationOperation,
  makeTaskWorktreeReconciliationOperation
} from "../../workflow/registry/operation.js"
import {
  AuthoritativeTaskClaimAcquired,
  WorkflowInterpreter,
  WorkflowTrace
} from "../../workflow/interpretation/interpreter.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { TaskLifecycle, TrackerRevision } from "../../authorities/task-tracker/task.js"
import { projectTrackerSnapshot } from "../../authorities/task-tracker/graph.js"
import { taskTrackerGraphFactsObserved } from "../../../test/task-tracker-facts.js"
import {
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "../../workflow/protocols/planned-attempt-executor-work/events.js"
import { InitialControlPolicy } from "../../control/policy.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  makeFocusedTaskClaimFactsObserved,
  makeFocusedTaskWorkSpecificationFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../workflow/task-tracker-facts/observation.js"
import { makeTaskWorkSpecification } from "../../authorities/task-tracker/task-work-specification.js"
import { ActiveTaskClaim } from "../../authorities/task-tracker/claim-mutation.js"
import { AuthoritativeTaskClaimReleased } from "../../workflow/protocols/task-claim-release/protocol.js"
import { makeOwnedTransitionExecutionFixture, type OwnedTransitionExecution } from "../activation/coordinator.js"

const unused = () => Effect.die("empty history must not invoke an interpreter")

it.effect("routes generic recovery transitions including exact claim-release intent", () => {
  const runId = RunId.make("runnable-transition-routing")
  const taskId = TaskId.make("runnable-transition-task")
  const operationId = OperationId.make("runnable-transition-operation")
  return Effect.gen(function* () {
    const claim = ActiveTaskClaim.make({
      operationId: OperationId.make("runnable-transition-claim"),
      owner: ClaimOwner.make("dalph"),
      taskId,
      token: ClaimToken.make("runnable-transition-token")
    })
    const release = makeTaskClaimReleaseOperation({
      predecessorOperationIds: [claim.operationId],
      release: { claim, operationId: OperationId.make("runnable-transition-release") }
    })
    const journal = yield* JournalStore
    yield* journal.append(
      runId,
      intentRecordKey(release.release.operationId),
      TaskClaimReleaseIntendedEvent.make({ operation: release, version: workflowJournalEventVersion })
    )
    const transitions = [
      RunnableFrontierTransition.CheckTaskClaim({ operationId, taskId }),
      RunnableFrontierTransition.CommitFreshTaskClaimIntent({
        taskId,
        taskRevision: TaskRevision.make("runnable-transition-revision")
      }),
      RunnableFrontierTransition.ContinueFreshWorkflowOperation({ operationId, taskId }),
      RunnableFrontierTransition.ReconcileTaskClaim({ operationId, taskId }),
      RunnableFrontierTransition.ReconcileTaskClaimRelease({ operationId: release.release.operationId, taskId }),
      RunnableFrontierTransition.ReconcileTaskClaimRelease({
        operationId: OperationId.make("missing-release-intent"),
        taskId
      }),
      RunnableFrontierTransition.ReconcileTaskWorktree({ operationId, taskId })
    ]
    const results = yield* Effect.forEach(transitions, (transition) => recoverRunnableTransition(runId, transition))
    expect(results).toEqual(Array.from({ length: transitions.length }))
  }).pipe(
    Effect.provideService(
      WorkflowInterpreter,
      WorkflowInterpreter.of({
        acquireTaskClaim: unused,
        readTaskClaim: () => Effect.die("unexpected task claim read"),
        readTrackerGraph: unused,
        readTaskWorkSpecification: unused,
        reconcileTaskWorktree: unused,
        recordTaskAttemptPlan: unused,
        releaseTaskClaim: (operation) =>
          Effect.succeed(AuthoritativeTaskClaimReleased.make({ release: operation.release }))
      })
    ),
    Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })),
    Effect.provide(memoryJournalStoreLayer)
  )
})

it.effect("settles a recovered generic claim through run recovery activation", () =>
  Effect.gen(function* () {
    const runId = RunId.make("recovered-generic-recovery")
    const taskId = TaskId.make("recovered-generic-task")
    const claim = makeTaskClaimAcquisitionOperation({
      acquisition: {
        operationId: OperationId.make("recovered-generic-claim"),
        owner: ClaimOwner.make("dalph"),
        taskId,
        token: ClaimToken.make("recovered-generic-token")
      },
      predecessorOperationIds: []
    })
    const journal = yield* JournalStore
    yield* journal.append(
      runId,
      intentRecordKey(claim.acquisition.operationId),
      TaskClaimAcquisitionIntendedEvent.make({ operation: claim, version: workflowJournalEventVersion })
    )
    const interpreter = WorkflowInterpreter.of({
      acquireTaskClaim: (operation) =>
        journal
          .append(
            runId,
            outcomeRecordKey(operation.acquisition.operationId),
            TaskClaimAcquiredEvent.make({
              claim: { _tag: "ActiveTaskClaim", ...operation.acquisition },
              version: workflowJournalEventVersion
            })
          )
          .pipe(
            Effect.as({
              ...AuthoritativeTaskClaimAcquired.make({ claim: { _tag: "ActiveTaskClaim", ...operation.acquisition } })
            })
          ),
      readTaskClaim: () => Effect.die("unexpected task claim read"),
      readTrackerGraph: unused,
      readTaskWorkSpecification: unused,
      reconcileTaskWorktree: unused,
      recordTaskAttemptPlan: unused,
      releaseTaskClaim: unused
    })
    yield* activateRecoveredResponsibilities(runId, TaskWorkCapacity.make(1)).pipe(
      Effect.provideService(WorkflowInterpreter, interpreter),
      Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })),
      Effect.provide(controlledFakePlannedAttemptExecutorLayer),
      Effect.provide(trustedPlannedAttemptRecoveryAuthorityLayer)
    )
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect("keeps recovered executor work stopped when no tracker target can authorize a fresh read", () =>
  Effect.gen(function* () {
    const runId = RunId.make("missing-continuation-target-run")
    const plannedAttempt = PlannedTaskAttempt.make({
      attemptId: AttemptId.make("missing-continuation-target-attempt"),
      baseSha: GitCommitSha.make("3".repeat(40)),
      branch: TaskBranchRef.make("refs/heads/dalph/missing-continuation-target"),
      executor: TaskExecutorLocator.make("executor:controlled-fake"),
      runId,
      taskId: TaskId.make("missing-continuation-target-task"),
      taskRevision: TaskRevision.make("missing-continuation-target-revision"),
      worktree: WorktreeLocator.make("/tmp/missing-continuation-target")
    })
    const plan = makeTaskAttemptPlanOperation({
      operationId: OperationId.make("missing-continuation-target-plan"),
      plannedAttempt,
      predecessorOperationIds: []
    })
    const journal = yield* JournalStore
    yield* journal.append(
      runId,
      attemptPlanRecordKey(plannedAttempt.attemptId),
      TaskAttemptPlannedEvent.make({ operation: plan, version: workflowJournalEventVersion })
    )
    yield* journal.append(
      runId,
      plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
      PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({ plannedAttempt, version: workflowJournalEventVersion })
    )

    const recovery = yield* makeRunRecoveryActivation(runId)
    expect(yield* recovery.readFrontier).toEqual({
      explanations: [
        {
          _tag: "PlannedAttemptExecutorWorkTypedIssue",
          correlation: { attemptId: plannedAttempt.attemptId, runId },
          reason: "MissingFreshFacts"
        }
      ],
      transitions: []
    })
  }).pipe(
    Effect.provide(memoryJournalStoreLayer),
    Effect.provide(controlledFakePlannedAttemptExecutorLayer),
    Effect.provide(trustedPlannedAttemptRecoveryAuthorityLayer),
    Effect.provideService(
      WorkflowInterpreter,
      WorkflowInterpreter.of({
        acquireTaskClaim: unused,
        readTaskClaim: () => Effect.die("unexpected task claim read"),
        readTrackerGraph: unused,
        readTaskWorkSpecification: unused,
        reconcileTaskWorktree: unused,
        recordTaskAttemptPlan: unused,
        releaseTaskClaim: unused
      })
    ),
    Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void }))
  )
)

it.effect("a responsible task leaving complete membership becomes a task-local constraint", () =>
  Effect.gen(function* () {
    const runId = RunId.make("membership-constraint-run")
    const taskId = TaskId.make("removed-responsible-task")
    const claim = makeTaskClaimAcquisitionOperation({
      acquisition: {
        operationId: OperationId.make("removed-task-claim"),
        owner: ClaimOwner.make("dalph"),
        taskId,
        token: ClaimToken.make("removed-task-token")
      },
      predecessorOperationIds: []
    })
    const graphRead = makeTrackerGraphObservationOperation(
      OperationId.make("membership-removal-read"),
      FixtureTarget.make("membership-constraint-target")
    )
    const journal = yield* JournalStore
    yield* journal.append(
      runId,
      intentRecordKey(claim.acquisition.operationId),
      TaskClaimAcquisitionIntendedEvent.make({ operation: claim, version: workflowJournalEventVersion })
    )
    yield* journal.append(runId, intentRecordKey(graphRead.operationId), taskTrackerReadIntent(graphRead))
    yield* journal.append(
      runId,
      outcomeRecordKey(graphRead.operationId),
      taskTrackerGraphFactsObserved(graphRead, {
        revision: TrackerRevision.make("task-removed-from-target"),
        taskIds: []
      })
    )

    const recovery = yield* makeRunRecoveryActivation(runId)
    expect((yield* recovery.readResponsibility).entries).toHaveLength(1)
    expect(yield* recovery.readFrontier).toEqual({
      explanations: [
        {
          _tag: "WorkflowOperationTaskMembershipConstraint",
          operationId: claim.acquisition.operationId,
          taskId,
          wakeCondition: "TaskTrackerFactsObserved"
        }
      ],
      transitions: []
    })
  }).pipe(
    Effect.provide(memoryJournalStoreLayer),
    Effect.provide(controlledFakePlannedAttemptExecutorLayer),
    Effect.provide(trustedPlannedAttemptRecoveryAuthorityLayer),
    Effect.provideService(
      WorkflowInterpreter,
      WorkflowInterpreter.of({
        acquireTaskClaim: unused,
        readTaskClaim: () => Effect.die("unexpected task claim read"),
        readTrackerGraph: unused,
        readTaskWorkSpecification: unused,
        reconcileTaskWorktree: unused,
        recordTaskAttemptPlan: unused,
        releaseTaskClaim: unused
      })
    ),
    Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void }))
  )
)

it.effect("fresh-run journal facts expose membership constraints without recovered transitions", () => {
  const runId = RunId.make("fresh-membership-constraint-run")
  const target = FixtureTarget.make("fresh-membership-constraint-target")
  const taskId = TaskId.make("fresh-removed-responsible-task")
  const claim = makeTaskClaimAcquisitionOperation({
    acquisition: {
      operationId: OperationId.make("fresh-removed-task-claim"),
      owner: ClaimOwner.make("dalph"),
      taskId,
      token: ClaimToken.make("fresh-removed-task-token")
    },
    predecessorOperationIds: []
  })
  const graphRead = makeTrackerGraphObservationOperation(OperationId.make("fresh-membership-removal-read"), target)

  return Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      target,
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    yield* journal.append(
      runId,
      intentRecordKey(claim.acquisition.operationId),
      TaskClaimAcquisitionIntendedEvent.make({ operation: claim, version: workflowJournalEventVersion })
    )
    yield* journal.append(runId, intentRecordKey(graphRead.operationId), taskTrackerReadIntent(graphRead))
    yield* journal.append(
      runId,
      outcomeRecordKey(graphRead.operationId),
      taskTrackerGraphFactsObserved(graphRead, {
        revision: TrackerRevision.make("fresh-task-removed-from-target"),
        taskIds: []
      })
    )

    const recovery = yield* RunRecoveryActivation
    expect((yield* recovery.readResponsibility).entries).toHaveLength(1)
    expect(yield* recovery.readFrontier).toEqual({
      explanations: [
        {
          _tag: "WorkflowOperationTaskMembershipConstraint",
          operationId: claim.acquisition.operationId,
          taskId,
          wakeCondition: "TaskTrackerFactsObserved"
        }
      ],
      transitions: []
    })
  }).pipe(
    Effect.provide(
      journaledFreshRunRecoveryActivationLayer(runId).pipe(Layer.provide(controlledFakePlannedAttemptExecutorLayer))
    ),
    Effect.provide(memoryJournalStoreLayer),
    Effect.provideService(
      WorkflowInterpreter,
      WorkflowInterpreter.of({
        acquireTaskClaim: unused,
        readTaskClaim: () => Effect.die("unexpected task claim read"),
        readTrackerGraph: unused,
        readTaskWorkSpecification: unused,
        reconcileTaskWorktree: unused,
        recordTaskAttemptPlan: unused,
        releaseTaskClaim: unused
      })
    )
  )
})

it.effect("routes journaled fresh fact reads, exact claim release, and suspension through their boundaries", () =>
  Effect.gen(function* () {
    const runId = RunId.make("journaled-fresh-transition-routing")
    const taskId = TaskId.make("journaled-fresh-task")
    const plannedAttempt = PlannedTaskAttempt.make({
      attemptId: AttemptId.make("journaled-fresh-attempt"),
      baseSha: GitCommitSha.make("4".repeat(40)),
      branch: TaskBranchRef.make("refs/heads/dalph/journaled-fresh-attempt"),
      executor: TaskExecutorLocator.make("executor:controlled-fake"),
      runId,
      taskId,
      taskRevision: TaskRevision.make("journaled-fresh-revision"),
      worktree: WorktreeLocator.make("/tmp/journaled-fresh-attempt")
    })
    const target = FixtureTarget.make("journaled-fresh-target")
    const graph = projectTrackerSnapshot({
      revision: "journaled-fresh-graph",
      tasks: [{ id: taskId, lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
    })
    if (graph._tag !== "Valid") return yield* Effect.die("expected valid journaled fresh graph")
    const specification = makeTaskWorkSpecification({ body: "Body", taskId, title: "Title" })
    const claim = ActiveTaskClaim.make({
      operationId: OperationId.make("journaled-fresh-claim"),
      owner: ClaimOwner.make("dalph"),
      taskId,
      token: ClaimToken.make("journaled-fresh-token")
    })
    const release = makeTaskClaimReleaseOperation({
      predecessorOperationIds: [claim.operationId],
      release: { claim, operationId: OperationId.make("journaled-fresh-release") }
    })
    const graphOperation = makeTrackerGraphObservationOperation(OperationId.make("journaled-fresh-graph-read"), target)
    const specificationOperation = makeTaskWorkSpecificationObservationOperation(
      OperationId.make("journaled-fresh-specification-read"),
      target,
      taskId
    )
    const calls = yield* Ref.make<ReadonlyArray<string>>([])
    const releasedPositions = yield* Ref.make(0)
    const execution = makeOwnedTransitionExecutionFixture({
      bindPlannedAttemptExecutorPosition: () => Effect.void,
      recordIntent: () => Effect.void,
      releasePlannedAttemptExecutorWorkPosition: () => Ref.update(releasedPositions, (count) => count + 1)
    })
    yield* Effect.gen(function* () {
      const recovery = yield* makeJournaledFreshRunRecoveryActivation(runId)
      if (recovery._tag !== "JournaledFreshRunActivation") {
        return yield* Effect.die("expected journaled fresh activation")
      }
      yield* recovery.runTransition(
        RunnableFrontierTransition.ObservePlannedAttemptContinuationGraph({
          operation: graphOperation,
          plannedAttempt
        }),
        execution
      )
      yield* recovery.runTransition(
        RunnableFrontierTransition.ObservePlannedAttemptContinuationSpecification({
          operation: specificationOperation,
          plannedAttempt
        }),
        execution
      )
      yield* recovery.runTransition(
        RunnableFrontierTransition.ReleaseExternallyCompletedTaskClaim({ operation: release }),
        execution
      )
      yield* recovery.runTransition(
        RunnableFrontierTransition.SuspendPlannedAttemptExecutorWork({ plannedAttempt }),
        execution
      )
      yield* recovery.runTransition(
        RunnableFrontierTransition.SuspendPlannedAttemptExecutorWork({ plannedAttempt }),
        execution
      )
    }).pipe(
      Effect.provideService(
        WorkflowInterpreter,
        WorkflowInterpreter.of({
          acquireTaskClaim: unused,
          readTaskClaim: () => Effect.die("unexpected task claim read"),
          readTrackerGraph: () => Ref.update(calls, (items) => [...items, "graph"]).pipe(Effect.as(graph.snapshot)),
          readTaskWorkSpecification: () =>
            Ref.update(calls, (items) => [...items, "specification"]).pipe(Effect.as(specification)),
          reconcileTaskWorktree: unused,
          recordTaskAttemptPlan: unused,
          releaseTaskClaim: (operation) =>
            Ref.update(calls, (items) => [...items, "release"]).pipe(
              Effect.as(AuthoritativeTaskClaimReleased.make({ release: operation.release }))
            )
        })
      )
    )

    expect(yield* Ref.get(calls)).toEqual(["graph", "specification", "release"])
    expect(yield* Ref.get(releasedPositions)).toBe(1)
  }).pipe(
    Effect.provide(memoryJournalStoreLayer),
    Effect.provide(
      makeControlledFakePlannedAttemptExecutorLayer([
        {
          _tag: "Suspend",
          correlation: {
            attemptId: AttemptId.make("journaled-fresh-attempt"),
            runId: RunId.make("journaled-fresh-transition-routing")
          },
          report: PlannedAttemptExecutorReport.cases.SafelySuspended.make({
            correlation: {
              attemptId: AttemptId.make("journaled-fresh-attempt"),
              runId: RunId.make("journaled-fresh-transition-routing")
            }
          })
        },
        {
          _tag: "Suspend",
          correlation: {
            attemptId: AttemptId.make("journaled-fresh-attempt"),
            runId: RunId.make("journaled-fresh-transition-routing")
          },
          report: PlannedAttemptExecutorReport.cases.Running.make({
            correlation: {
              attemptId: AttemptId.make("journaled-fresh-attempt"),
              runId: RunId.make("journaled-fresh-transition-routing")
            }
          })
        }
      ])
    ),
    Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void }))
  )
)

it.effect("runs a journaled fresh read when no optional trace output is installed", () =>
  Effect.gen(function* () {
    const runId = RunId.make("journaled-fresh-without-trace")
    const taskId = TaskId.make("journaled-fresh-without-trace-task")
    const plannedAttempt = PlannedTaskAttempt.make({
      attemptId: AttemptId.make("journaled-fresh-without-trace-attempt"),
      baseSha: GitCommitSha.make("5".repeat(40)),
      branch: TaskBranchRef.make("refs/heads/dalph/journaled-fresh-without-trace"),
      executor: TaskExecutorLocator.make("executor:controlled-fake"),
      runId,
      taskId,
      taskRevision: TaskRevision.make("journaled-fresh-without-trace-revision"),
      worktree: WorktreeLocator.make("/tmp/journaled-fresh-without-trace")
    })
    const recovery = yield* makeJournaledFreshRunRecoveryActivation(runId)
    if (recovery._tag !== "JournaledFreshRunActivation") {
      return yield* Effect.die("expected journaled fresh activation")
    }
    yield* recovery.runTransition(
      RunnableFrontierTransition.ObservePlannedAttemptContinuationGraph({
        operation: makeTrackerGraphObservationOperation(
          OperationId.make("journaled-fresh-without-trace-read"),
          FixtureTarget.make("journaled-fresh-without-trace-target")
        ),
        plannedAttempt
      }),
      makeOwnedTransitionExecutionFixture({
        bindPlannedAttemptExecutorPosition: () => Effect.void,
        recordIntent: () => Effect.void,
        releasePlannedAttemptExecutorWorkPosition: () => Effect.void
      })
    )
  }).pipe(
    Effect.provide(memoryJournalStoreLayer),
    Effect.provide(controlledFakePlannedAttemptExecutorLayer),
    Effect.provideService(
      WorkflowInterpreter,
      WorkflowInterpreter.of({
        acquireTaskClaim: unused,
        readTaskClaim: () => Effect.die("unexpected task claim read"),
        readTrackerGraph: () =>
          Effect.suspend(() => {
            const projection = projectTrackerSnapshot({ revision: "journaled-fresh-without-trace-graph", tasks: [] })
            return projection._tag === "Valid" ? Effect.succeed(projection.snapshot) : Effect.die("invalid empty graph")
          }),
        readTaskWorkSpecification: unused,
        reconcileTaskWorktree: unused,
        recordTaskAttemptPlan: unused,
        releaseTaskClaim: unused
      })
    )
  )
)

it.effect("fails closed when journaled fresh recovery has no interpreter for a selected read", () =>
  Effect.gen(function* () {
    const runId = RunId.make("journaled-fresh-without-interpreter")
    const plannedAttempt = PlannedTaskAttempt.make({
      attemptId: AttemptId.make("journaled-fresh-without-interpreter-attempt"),
      baseSha: GitCommitSha.make("6".repeat(40)),
      branch: TaskBranchRef.make("refs/heads/dalph/journaled-fresh-without-interpreter"),
      executor: TaskExecutorLocator.make("executor:controlled-fake"),
      runId,
      taskId: TaskId.make("journaled-fresh-without-interpreter-task"),
      taskRevision: TaskRevision.make("journaled-fresh-without-interpreter-revision"),
      worktree: WorktreeLocator.make("/tmp/journaled-fresh-without-interpreter")
    })
    const recovery = yield* makeJournaledFreshRunRecoveryActivation(runId)
    if (recovery._tag !== "JournaledFreshRunActivation") {
      return yield* Effect.die("expected journaled fresh activation")
    }
    const exit = yield* recovery
      .runTransition(
        RunnableFrontierTransition.ObservePlannedAttemptContinuationGraph({
          operation: makeTrackerGraphObservationOperation(
            OperationId.make("journaled-fresh-without-interpreter-read"),
            FixtureTarget.make("journaled-fresh-without-interpreter-target")
          ),
          plannedAttempt
        }),
        {} as OwnedTransitionExecution
      )
      .pipe(Effect.exit)
    expect(exit._tag).toBe("Failure")
  }).pipe(Effect.provide(memoryJournalStoreLayer), Effect.provide(controlledFakePlannedAttemptExecutorLayer))
)

it.effect("a task leaving complete membership safely suspends its executor work before the local constraint", () =>
  Effect.gen(function* () {
    const runId = RunId.make("executor-membership-constraint-run")
    const taskId = TaskId.make("removed-executor-task")
    const plannedAttempt = PlannedTaskAttempt.make({
      attemptId: AttemptId.make("removed-executor-attempt"),
      baseSha: GitCommitSha.make("4".repeat(40)),
      branch: TaskBranchRef.make("refs/heads/dalph/removed-executor-attempt"),
      executor: TaskExecutorLocator.make("executor:controlled-fake"),
      runId,
      taskId,
      taskRevision: TaskRevision.make("removed-executor-revision"),
      worktree: WorktreeLocator.make("/worktrees/removed-executor-attempt")
    })
    const claim = makeTaskClaimAcquisitionOperation({
      acquisition: {
        operationId: OperationId.make("removed-executor-claim"),
        owner: ClaimOwner.make("dalph"),
        taskId,
        token: ClaimToken.make("removed-executor-token")
      },
      predecessorOperationIds: []
    })
    const plan = makeTaskAttemptPlanOperation({
      operationId: OperationId.make("removed-executor-plan"),
      plannedAttempt,
      predecessorOperationIds: [claim.acquisition.operationId]
    })
    const claimSettlement = {
      _tag: "Settlement" as const,
      operationId: claim.acquisition.operationId,
      outcome: "ResponsibilityCompleted" as const,
      taskId
    }
    const graphRead = makeTrackerGraphObservationOperation(
      OperationId.make("executor-membership-removal-read"),
      FixtureTarget.make("executor-membership-constraint-target")
    )
    const journal = yield* JournalStore
    yield* journal.append(
      runId,
      intentRecordKey(claim.acquisition.operationId),
      TaskClaimAcquisitionIntendedEvent.make({ operation: claim, version: workflowJournalEventVersion })
    )
    yield* journal.append(
      runId,
      outcomeRecordKey(claim.acquisition.operationId),
      TaskClaimAcquiredEvent.make({
        claim: { _tag: "ActiveTaskClaim", ...claim.acquisition },
        version: workflowJournalEventVersion
      })
    )
    yield* journal.append(
      runId,
      attemptPlanRecordKey(plannedAttempt.attemptId),
      TaskAttemptPlannedEvent.make({ operation: plan, version: workflowJournalEventVersion })
    )
    yield* journal.append(
      runId,
      plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
      PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({ plannedAttempt, version: workflowJournalEventVersion })
    )
    yield* journal.append(runId, intentRecordKey(graphRead.operationId), taskTrackerReadIntent(graphRead))
    yield* journal.append(
      runId,
      outcomeRecordKey(graphRead.operationId),
      taskTrackerGraphFactsObserved(graphRead, {
        revision: TrackerRevision.make("executor-task-removed-from-target"),
        taskIds: []
      })
    )

    const recovery = yield* makeRunRecoveryActivation(runId)
    const beforeSuspension = yield* recovery.readFrontier
    expect(beforeSuspension).toEqual({
      explanations: [claimSettlement],
      transitions: [{ _tag: "SuspendPlannedAttemptExecutorWork", plannedAttempt }]
    })
    const reportOrdinal = PlannedAttemptExecutorReportOrdinal.make(1)
    yield* journal.append(
      runId,
      plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, reportOrdinal),
      PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: reportOrdinal,
        report: PlannedAttemptExecutorReport.cases.SafelySuspended.make({
          correlation: { attemptId: plannedAttempt.attemptId, runId }
        }),
        version: workflowJournalEventVersion
      })
    )
    expect(yield* recovery.readFrontier).toEqual({
      explanations: [
        claimSettlement,
        {
          _tag: "PlannedAttemptTaskMembershipConstraint",
          correlation: { attemptId: plannedAttempt.attemptId, runId },
          taskId,
          wakeCondition: "TaskTrackerFactsObserved"
        }
      ],
      transitions: []
    })
    const closedRead = makeTrackerGraphObservationOperation(
      OperationId.make("executor-lifecycle-close-read"),
      FixtureTarget.make("executor-membership-constraint-target")
    )
    const closedProjection = projectTrackerSnapshot({
      revision: TrackerRevision.make("executor-task-terminal-without-success"),
      tasks: [
        {
          id: taskId,
          lifecycle: TaskLifecycle.cases.TerminalWithoutSuccess.make({}),
          parentTaskId: null,
          prerequisiteIds: []
        }
      ]
    })
    if (closedProjection._tag !== "Valid") return yield* Effect.die("expected valid closed task graph")
    yield* journal.append(runId, intentRecordKey(closedRead.operationId), taskTrackerReadIntent(closedRead))
    yield* journal.append(
      runId,
      outcomeRecordKey(closedRead.operationId),
      taskTrackerFactsObservedEvent(
        closedRead.operationId,
        makeCompleteTaskTrackerFactsObserved(closedRead, closedProjection.snapshot)
      )
    )
    expect(yield* recovery.readFrontier).toEqual({
      explanations: [
        claimSettlement,
        {
          _tag: "PlannedAttemptTaskLifecycleConstraint",
          correlation: { attemptId: plannedAttempt.attemptId, runId },
          lifecycle: "TerminalWithoutSuccess",
          taskId,
          wakeCondition: "TaskTrackerFactsObserved"
        }
      ],
      transitions: []
    })
    const reopenedRead = makeTrackerGraphObservationOperation(
      OperationId.make("executor-lifecycle-reopen-read"),
      FixtureTarget.make("executor-membership-constraint-target")
    )
    yield* journal.append(runId, intentRecordKey(reopenedRead.operationId), taskTrackerReadIntent(reopenedRead))
    const reopenedObservation = yield* journal.append(
      runId,
      outcomeRecordKey(reopenedRead.operationId),
      taskTrackerGraphFactsObserved(reopenedRead, {
        revision: TrackerRevision.make("executor-task-reopened"),
        taskIds: [taskId]
      })
    )
    expect(yield* recovery.readFrontier).toEqual({
      explanations: [claimSettlement],
      transitions: [
        {
          _tag: "ObservePlannedAttemptContinuationSpecification",
          operation: {
            _tag: "ReadTaskWorkSpecification",
            operationId: OperationId.make(
              `continuation:${plannedAttempt.attemptId}:after:${reopenedObservation.position}:specification`
            ),
            predecessorOperationIds: [reopenedRead.operationId, plan.operationId],
            target: FixtureTarget.make("executor-membership-constraint-target"),
            taskId
          },
          plannedAttempt
        }
      ]
    })
    const changedSpecificationRead = makeTaskWorkSpecificationObservationOperation(
      OperationId.make("executor-changed-specification-read"),
      FixtureTarget.make("executor-membership-constraint-target"),
      taskId
    )
    const changedSpecification = makeTaskWorkSpecification({
      body: "Use the newly authored implementation instructions.",
      taskId,
      title: "Changed implementation"
    })
    yield* journal.append(
      runId,
      intentRecordKey(changedSpecificationRead.operationId),
      taskTrackerReadIntent(changedSpecificationRead)
    )
    yield* journal.append(
      runId,
      outcomeRecordKey(changedSpecificationRead.operationId),
      taskTrackerFactsObservedEvent(
        changedSpecificationRead.operationId,
        makeFocusedTaskWorkSpecificationFactsObserved(changedSpecificationRead, changedSpecification)
      )
    )
    expect(yield* recovery.readFrontier).toEqual({
      explanations: [
        claimSettlement,
        {
          _tag: "PlannedAttemptTaskSpecificationChangeConstraint",
          availableResolutions: ["ContinueExistingAttempt", "RestartTaskImplementation", "StopTaskImplementation"],
          correlation: { attemptId: plannedAttempt.attemptId, runId },
          observedFingerprint: changedSpecification.fingerprint,
          plannedFingerprint: plannedAttempt.taskRevision,
          taskId,
          wakeCondition: "TaskResolutionApplied"
        }
      ],
      transitions: []
    })
    const externallyCompletedRead = makeTrackerGraphObservationOperation(
      OperationId.make("executor-external-success-read"),
      FixtureTarget.make("executor-membership-constraint-target")
    )
    const externallyCompletedProjection = projectTrackerSnapshot({
      revision: TrackerRevision.make("executor-task-completed-externally"),
      tasks: [
        {
          id: taskId,
          lifecycle: TaskLifecycle.cases.CompletedSuccessfully.make({}),
          parentTaskId: null,
          prerequisiteIds: []
        }
      ]
    })
    if (externallyCompletedProjection._tag !== "Valid") {
      return yield* Effect.die("expected valid externally completed task graph")
    }
    yield* journal.append(
      runId,
      intentRecordKey(externallyCompletedRead.operationId),
      taskTrackerReadIntent(externallyCompletedRead)
    )
    yield* journal.append(
      runId,
      outcomeRecordKey(externallyCompletedRead.operationId),
      taskTrackerFactsObservedEvent(
        externallyCompletedRead.operationId,
        makeCompleteTaskTrackerFactsObserved(externallyCompletedRead, externallyCompletedProjection.snapshot)
      )
    )
    const externalRelease = makeTaskClaimReleaseOperation({
      predecessorOperationIds: [claim.acquisition.operationId],
      release: {
        claim: { _tag: "ActiveTaskClaim", ...claim.acquisition },
        operationId: OperationId.make(`external-success-release:${claim.acquisition.operationId}`)
      }
    })
    expect(yield* recovery.readFrontier).toEqual({
      explanations: [claimSettlement],
      transitions: [{ _tag: "ReleaseExternallyCompletedTaskClaim", operation: externalRelease }]
    })
    yield* journal.append(
      runId,
      intentRecordKey(externalRelease.release.operationId),
      TaskClaimReleaseIntendedEvent.make({ operation: externalRelease, version: workflowJournalEventVersion })
    )
    const releaseFrontier = yield* recovery.readFrontier
    expect(releaseFrontier).toEqual({
      explanations: [
        claimSettlement,
        {
          _tag: "PlannedAttemptTaskExternalSuccessConstraint",
          correlation: { attemptId: plannedAttempt.attemptId, runId },
          taskId,
          wakeCondition: "ExactTaskClaimDispositionApplied"
        },
        {
          _tag: "WorkflowOperationTaskClaimConstraint",
          claimState: "Unobserved",
          operationId: externalRelease.release.operationId,
          taskId,
          wakeCondition: "TaskClaimFactsObserved"
        }
      ],
      transitions: [
        expect.objectContaining({
          _tag: "ObserveResponsibleTaskClaim",
          operation: expect.objectContaining({ taskId }),
          taskId
        })
      ]
    })
    const selectedRead = releaseFrontier.transitions[0]
    if (selectedRead?._tag !== "ObserveResponsibleTaskClaim") {
      return yield* Effect.die("expected exact claim reread before release")
    }
    yield* journal.append(
      runId,
      intentRecordKey(selectedRead.operation.operationId),
      taskTrackerReadIntent(selectedRead.operation)
    )
    yield* journal.append(
      runId,
      outcomeRecordKey(selectedRead.operation.operationId),
      taskTrackerFactsObservedEvent(
        selectedRead.operation.operationId,
        makeFocusedTaskClaimFactsObserved(selectedRead.operation, { _tag: "ActiveTaskClaim", ...claim.acquisition })
      )
    )
    expect((yield* recovery.readFrontier).transitions).toEqual([
      { _tag: "ReconcileTaskClaimRelease", operationId: externalRelease.release.operationId, taskId }
    ])
  }).pipe(
    Effect.provide(memoryJournalStoreLayer),
    Effect.provide(controlledFakePlannedAttemptExecutorLayer),
    Effect.provide(trustedPlannedAttemptRecoveryAuthorityLayer),
    Effect.provideService(
      WorkflowInterpreter,
      WorkflowInterpreter.of({
        acquireTaskClaim: unused,
        readTaskClaim: () => Effect.die("unexpected task claim read"),
        readTrackerGraph: unused,
        readTaskWorkSpecification: unused,
        reconcileTaskWorktree: unused,
        recordTaskAttemptPlan: unused,
        releaseTaskClaim: unused
      })
    ),
    Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void }))
  )
)

it.effect("replays the exact durable claim and worktree intents", () => {
  const runId = RunId.make("runnable-transition-intents")
  const taskId = TaskId.make("runnable-transition-task")
  const claim = makeTaskClaimAcquisitionOperation({
    acquisition: {
      operationId: OperationId.make("recovered-claim"),
      owner: ClaimOwner.make("dalph"),
      taskId,
      token: ClaimToken.make("recovered-token")
    },
    predecessorOperationIds: []
  })
  const plannedAttempt = PlannedTaskAttempt.make({
    attemptId: AttemptId.make("recovered-attempt"),
    baseSha: GitCommitSha.make("3".repeat(40)),
    branch: TaskBranchRef.make("refs/heads/dalph/recovered-attempt"),
    executor: TaskExecutorLocator.make("executor:fake"),
    runId,
    taskId,
    taskRevision: TaskRevision.make("recovered-revision"),
    worktree: WorktreeLocator.make("/worktrees/recovered-attempt")
  })
  const worktree = makeTaskWorktreeReconciliationOperation({
    operationId: OperationId.make("recovered-worktree"),
    plannedAttempt,
    predecessorOperationIds: []
  })

  return Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.append(
      runId,
      intentRecordKey(claim.acquisition.operationId),
      TaskClaimAcquisitionIntendedEvent.make({ operation: claim, version: workflowJournalEventVersion })
    )
    yield* journal.append(
      runId,
      intentRecordKey(worktree.operationId),
      TaskWorktreeReconciliationIntendedEvent.make({ operation: worktree, version: workflowJournalEventVersion })
    )
    const calls = yield* Ref.make<ReadonlyArray<string>>([])
    const interpreter = WorkflowInterpreter.of({
      acquireTaskClaim: (operation) =>
        Ref.update(calls, (current) => [...current, `claim:${operation.acquisition.operationId}`]).pipe(
          Effect.as({ _tag: "TaskClaimAcquisitionSimulated", operation })
        ),
      readTaskClaim: () => Effect.die("unexpected task claim read"),
      readTrackerGraph: unused,
      readTaskWorkSpecification: unused,
      reconcileTaskWorktree: (operation) =>
        Ref.update(calls, (current) => [...current, `worktree:${operation.operationId}`]).pipe(
          Effect.as({ _tag: "TaskWorktreeReconciliationSimulated", operation })
        ),
      recordTaskAttemptPlan: unused,
      releaseTaskClaim: unused
    })
    yield* recoverRunnableTransition(
      runId,
      RunnableFrontierTransition.CheckTaskClaim({ operationId: claim.acquisition.operationId, taskId })
    ).pipe(Effect.provideService(WorkflowInterpreter, interpreter))
    yield* recoverRunnableTransition(
      runId,
      RunnableFrontierTransition.ReconcileTaskClaim({ operationId: claim.acquisition.operationId, taskId })
    ).pipe(Effect.provideService(WorkflowInterpreter, interpreter))
    yield* recoverRunnableTransition(
      runId,
      RunnableFrontierTransition.ReconcileTaskWorktree({ operationId: worktree.operationId, taskId })
    ).pipe(Effect.provideService(WorkflowInterpreter, interpreter))
    expect(yield* Ref.get(calls)).toEqual([
      "claim:recovered-claim",
      "claim:recovered-claim",
      "worktree:recovered-worktree"
    ])
  }).pipe(Effect.provide(memoryJournalStoreLayer))
})

it.effect("fails closed when initial or reread workflow-journal history is invalid", () =>
  Effect.gen(function* () {
    const runId = RunId.make("invalid-workflow-journal-history-recovery")
    const operation = makeTaskClaimAcquisitionOperation({
      acquisition: {
        operationId: OperationId.make("invalid-workflow-journal-history-claim"),
        owner: ClaimOwner.make("dalph"),
        taskId: TaskId.make("invalid-workflow-journal-history-task"),
        token: ClaimToken.make("invalid-workflow-journal-history-token")
      },
      predecessorOperationIds: []
    })
    const invalidRecord = {
      event: TaskClaimAcquisitionIntendedEvent.make({ operation, version: workflowJournalEventVersion }),
      key: intentRecordKey(operation.acquisition.operationId),
      position: JournalPosition.make(2),
      runId
    }
    const reads = yield* Ref.make(0)
    const changingJournal = JournalStore.of({
      append: () => Effect.die("unused"),
      beginRun: () => Effect.die("unused"),
      read: () =>
        Ref.getAndUpdate(reads, (count) => count + 1).pipe(Effect.map((count) => (count === 0 ? [] : [invalidRecord]))),
      readRunForRecovery: () => Effect.die("unused"),
      scan: () => Effect.succeed({ issues: [], runs: [] }),
      terminateRun: () => Effect.die("unused")
    })
    const recovery = yield* makeRunRecoveryActivation(runId).pipe(Effect.provideService(JournalStore, changingJournal))
    expect((yield* recovery.readFrontier.pipe(Effect.flip))._tag).toBe("InvalidWorkflowJournalHistory")

    const initiallyInvalid = yield* makeRunRecoveryActivation(runId).pipe(
      Effect.provideService(
        JournalStore,
        JournalStore.of({ ...changingJournal, read: () => Effect.succeed([invalidRecord]) })
      ),
      Effect.flip
    )
    expect(initiallyInvalid._tag).toBe("InvalidWorkflowJournalHistory")
  }).pipe(
    Effect.provide(controlledFakePlannedAttemptExecutorLayer),
    Effect.provide(trustedPlannedAttemptRecoveryAuthorityLayer),
    Effect.provideService(
      WorkflowInterpreter,
      WorkflowInterpreter.of({
        acquireTaskClaim: unused,
        readTaskClaim: () => Effect.die("unexpected task claim read"),
        readTrackerGraph: unused,
        readTaskWorkSpecification: unused,
        reconcileTaskWorktree: unused,
        recordTaskAttemptPlan: unused,
        releaseTaskClaim: unused
      })
    ),
    Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void }))
  )
)
