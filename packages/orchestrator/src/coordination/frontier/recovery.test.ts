// @effect-diagnostics multipleEffectProvide:off
import { it } from "@effect/vitest"
import { controlledFakePlannedAttemptExecutorLayer } from "../../../test/controlled-planned-attempt-executor.js"
import { Effect, Layer, Ref } from "effect"
import { expect } from "vitest"
import {
  AttemptId,
  GitCommitSha,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorProjection,
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
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { OperationId } from "../../workflow/identity.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { plannedAttemptProtocolControllerLayer } from "../../workflow/protocols/planned-attempt-executor-work/protocol-controller.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import {
  attemptPlanRecordKey,
  intentRecordKey,
  outcomeRecordKey,
  plannedAttemptExecutorCommandIntendedRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey
} from "../../workflow-journal/record-key.js"
import { InRunJournal, JournalStore } from "../../workflow-journal/store.js"
import {
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  TaskClaimReleaseIntendedEvent,
  taskTrackerReadIntent,
  TaskWorktreeReconciliationIntendedEvent
} from "../../workflow/registry/event.js"
import { legacyMemoryJournalStoreLayer } from "../../workflow-journal/adapters/memory-store.js"
import { makeRunRecoveryProjection, RunRecoveryProjection } from "../run/recovery-activation.js"
import {
  recoverTaskClaimOperation,
  recoverTaskClaimReleaseOperation,
  recoverTaskWorktreeOperation
} from "./recovery.js"
import {
  makeTaskClaimAcquisitionOperation,
  makeTaskClaimObservationOperation,
  makeTaskClaimReleaseOperation,
  makeTaskAttemptPlanOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTrackerGraphObservationOperation,
  makeTaskWorktreeReconciliationOperation,
  TaskClaimReleaseAuthority
} from "../../workflow/registry/operation.js"
import {
  AuthoritativeTaskClaimObserved,
  AuthoritativeTaskClaimAcquired,
  WorkflowInterpreter,
  WorkflowTrace
} from "../../workflow/interpretation/interpreter.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { TaskLifecycle, TrackerRevision } from "../../authorities/task-tracker/task.js"
import { projectTrackerSnapshot } from "../../authorities/task-tracker/graph.js"
import { taskTrackerGraphFactsObserved } from "../../../test/task-tracker-facts.js"
import {
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "../../workflow/protocols/planned-attempt-executor-work/events.js"
import { requestPlannedAttemptExecutorSuspension } from "../../workflow/protocols/planned-attempt-executor-work/guarded-protocol.js"
import { InitialControlPolicy } from "../../control/policy.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  makeFocusedTaskClaimFactsObserved,
  makeFocusedTaskWorkSpecificationFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../workflow/task-tracker-facts/observation.js"
import { makeTaskWorkSpecification } from "../../authorities/task-tracker/task-work-specification.js"
import { ActiveTaskClaim, UnclaimedTask } from "../../authorities/task-tracker/claim-mutation.js"
import { PlannedWorktreeReady } from "../../authorities/git/worktree.js"
import { AuthoritativeTaskWorktreeReady } from "../../workflow/protocols/worktree-reconciliation/protocol.js"
import { AuthoritativeTaskClaimReleased } from "../../workflow/protocols/task-claim-release/protocol.js"
import { journaledWorkflowInterpreterLayer } from "../../workflow-journal/journaled-interpreter.js"

const unused = () => Effect.die("empty history must not invoke an interpreter")

it.effect("replays only the exact recorded claim-release intent", () => {
  const runId = RunId.make("runnable-transition-routing")
  const taskId = TaskId.make("runnable-transition-task")
  return Effect.gen(function* () {
    const claim = ActiveTaskClaim.make({
      operationId: OperationId.make("runnable-transition-claim"),
      owner: ClaimOwner.make("dalph"),
      taskId,
      token: ClaimToken.make("runnable-transition-token")
    })
    const release = makeTaskClaimReleaseOperation({
      authority: TaskClaimReleaseAuthority.cases.WorkflowClaimReleaseAuthority.make({}),
      predecessorOperationIds: [claim.operationId],
      release: { claim, operationId: OperationId.make("runnable-transition-release") }
    })
    const journal = yield* JournalStore
    yield* journal.append(
      runId,
      intentRecordKey(release.release.operationId),
      TaskClaimReleaseIntendedEvent.make({ operation: release, version: workflowJournalEventVersion })
    )
    const released = yield* Ref.make<ReadonlyArray<OperationId>>([])
    const interpreter = WorkflowInterpreter.of({
      acquireTaskClaim: unused,
      readTaskClaim: () => Effect.die("unexpected task claim read"),
      readTaskWorktree: () => Effect.die("unused worktree observation"),
      readTargetLineage: () => Effect.die("unused target-lineage observation"),
      readTrackerGraph: unused,
      readTaskWorkSpecification: unused,
      reconcileTaskWorktree: unused,
      recordTaskAttemptPlan: unused,
      releaseTaskClaim: (operation) =>
        Ref.update(released, (operationIds) => [...operationIds, operation.release.operationId]).pipe(
          Effect.as(AuthoritativeTaskClaimReleased.make({ release: operation.release }))
        )
    })
    yield* recoverTaskClaimReleaseOperation(runId, release.release.operationId).pipe(
      Effect.provideService(WorkflowInterpreter, interpreter)
    )
    yield* recoverTaskClaimReleaseOperation(runId, OperationId.make("missing-release-intent")).pipe(
      Effect.provideService(WorkflowInterpreter, interpreter)
    )
    expect(yield* Ref.get(released)).toEqual([release.release.operationId])
  }).pipe(Effect.provide(legacyMemoryJournalStoreLayer))
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
      readTaskWorktree: () => Effect.die("unused worktree observation"),
      readTargetLineage: () => Effect.die("unused target-lineage observation"),
      readTrackerGraph: unused,
      readTaskWorkSpecification: unused,
      reconcileTaskWorktree: unused,
      recordTaskAttemptPlan: unused,
      releaseTaskClaim: unused
    })
    yield* Effect.gen(function* () {
      const recovery = yield* makeRunRecoveryProjection(runId)
      const transition = (yield* recovery.readDeliveryProjection).frontier.transitions[0]
      if (transition === undefined) return yield* Effect.die("expected one claim recovery transition")
      if (transition._tag !== "CheckTaskClaim" && transition._tag !== "ReconcileTaskClaim") {
        return yield* Effect.die(`expected a claim recovery transition, received ${transition._tag}`)
      }
      yield* recoverTaskClaimOperation(runId, transition.operationId)
    }).pipe(
      Effect.provideService(WorkflowInterpreter, interpreter),
      Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })),
      Effect.provide(controlledFakePlannedAttemptExecutorLayer)
    )
  }).pipe(Effect.provide(legacyMemoryJournalStoreLayer))
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
    const recovery = yield* makeRunRecoveryProjection(runId)
    expect((yield* recovery.readDeliveryProjection).frontier).toEqual({
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
    Effect.provide(legacyMemoryJournalStoreLayer),
    Effect.provide(controlledFakePlannedAttemptExecutorLayer),
    Effect.provideService(
      WorkflowInterpreter,
      WorkflowInterpreter.of({
        acquireTaskClaim: unused,
        readTaskClaim: () => Effect.die("unexpected task claim read"),
        readTaskWorktree: () => Effect.die("unused worktree observation"),
        readTargetLineage: () => Effect.die("unused target-lineage observation"),
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

it.effect("keeps an unclaimed executor responsibility inert when no acquired claim authorized its plan", () =>
  Effect.gen(function* () {
    const runId = RunId.make("missing-acquired-claim-run")
    const taskId = TaskId.make("missing-acquired-claim-task")
    const plannedAttempt = PlannedTaskAttempt.make({
      attemptId: AttemptId.make("missing-acquired-claim-attempt"),
      baseSha: GitCommitSha.make("4".repeat(40)),
      branch: TaskBranchRef.make("refs/heads/dalph/missing-acquired-claim"),
      executor: TaskExecutorLocator.make("executor:controlled-fake"),
      runId,
      taskId,
      taskRevision: TaskRevision.make("missing-acquired-claim-revision"),
      worktree: WorktreeLocator.make("/tmp/missing-acquired-claim")
    })
    const plan = makeTaskAttemptPlanOperation({
      operationId: OperationId.make("missing-acquired-claim-plan"),
      plannedAttempt,
      predecessorOperationIds: []
    })
    const claimRead = makeTaskClaimObservationOperation(
      OperationId.make("missing-acquired-claim-read"),
      FixtureTarget.make("missing-acquired-claim-target"),
      taskId,
      []
    )
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
    yield* journal.append(runId, intentRecordKey(claimRead.operationId), taskTrackerReadIntent(claimRead))
    yield* journal.append(
      runId,
      outcomeRecordKey(claimRead.operationId),
      taskTrackerFactsObservedEvent(
        claimRead.operationId,
        makeFocusedTaskClaimFactsObserved(claimRead, UnclaimedTask.make({ taskId }))
      )
    )

    const recovery = yield* makeRunRecoveryProjection(runId)
    expect((yield* recovery.readDeliveryProjection).frontier).toMatchObject({ transitions: [] })
  }).pipe(
    Effect.provide(legacyMemoryJournalStoreLayer),
    Effect.provide(controlledFakePlannedAttemptExecutorLayer),
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

    const recovery = yield* makeRunRecoveryProjection(runId)
    const projection = yield* recovery.readDeliveryProjection
    expect(projection.evidence._tag).toBe("AvailableDeliveryProjectionEvidence")
    if (projection.evidence._tag === "AvailableDeliveryProjectionEvidence") {
      expect(projection.evidence.facts).toHaveLength(1)
    }
    expect(projection.frontier).toEqual({
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
    Effect.provide(legacyMemoryJournalStoreLayer),
    Effect.provide(controlledFakePlannedAttemptExecutorLayer),
    Effect.provideService(
      WorkflowInterpreter,
      WorkflowInterpreter.of({
        acquireTaskClaim: unused,
        readTaskClaim: () => Effect.die("unexpected task claim read"),
        readTaskWorktree: () => Effect.die("unused worktree observation"),
        readTargetLineage: () => Effect.die("unused target-lineage observation"),
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

    const recovery = yield* RunRecoveryProjection
    const projection = yield* recovery.readDeliveryProjection
    expect(projection.evidence._tag).toBe("AvailableDeliveryProjectionEvidence")
    if (projection.evidence._tag === "AvailableDeliveryProjectionEvidence") {
      expect(projection.evidence.facts).toHaveLength(1)
    }
    expect(projection.frontier).toEqual({
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
      Layer.effect(RunRecoveryProjection, makeRunRecoveryProjection(runId)).pipe(
        Layer.provide(controlledFakePlannedAttemptExecutorLayer)
      )
    ),
    Effect.provide(legacyMemoryJournalStoreLayer),
    Effect.provideService(
      WorkflowInterpreter,
      WorkflowInterpreter.of({
        acquireTaskClaim: unused,
        readTaskClaim: () => Effect.die("unexpected task claim read"),
        readTaskWorktree: () => Effect.die("unused worktree observation"),
        readTargetLineage: () => Effect.die("unused target-lineage observation"),
        readTrackerGraph: unused,
        readTaskWorkSpecification: unused,
        reconcileTaskWorktree: unused,
        recordTaskAttemptPlan: unused,
        releaseTaskClaim: unused
      })
    )
  )
})

it.effect("rechecks the tracker claim after same-process suspension and blocks continuation when it was replaced", () =>
  Effect.gen(function* () {
    const runId = RunId.make("same-process-replaced-claim-run")
    const taskId = TaskId.make("same-process-replaced-claim-task")
    const target = FixtureTarget.make("same-process-replaced-claim-target")
    const specification = makeTaskWorkSpecification({ body: "Body", taskId, title: "Title" })
    const plannedAttempt = PlannedTaskAttempt.make({
      attemptId: AttemptId.make("same-process-replaced-claim-attempt"),
      baseSha: GitCommitSha.make("7".repeat(40)),
      branch: TaskBranchRef.make("refs/heads/dalph/same-process-replaced-claim-attempt"),
      executor: TaskExecutorLocator.make("executor:controlled-fake"),
      runId,
      taskId,
      taskRevision: specification.fingerprint,
      worktree: WorktreeLocator.make("/worktrees/same-process-replaced-claim-attempt")
    })
    const acquiredClaim = makeTaskClaimAcquisitionOperation({
      acquisition: {
        operationId: OperationId.make("same-process-acquired-claim"),
        owner: ClaimOwner.make("dalph"),
        taskId,
        token: ClaimToken.make("same-process-acquired-token")
      },
      predecessorOperationIds: []
    })
    const replacementClaim = ActiveTaskClaim.make({
      operationId: OperationId.make("foreign-replacement-claim"),
      owner: ClaimOwner.make("another-dalph"),
      taskId,
      token: ClaimToken.make("foreign-replacement-token")
    })
    const plan = makeTaskAttemptPlanOperation({
      operationId: OperationId.make("same-process-replaced-claim-plan"),
      plannedAttempt,
      predecessorOperationIds: [acquiredClaim.acquisition.operationId]
    })
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      target,
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    yield* journal.append(
      runId,
      intentRecordKey(acquiredClaim.acquisition.operationId),
      TaskClaimAcquisitionIntendedEvent.make({ operation: acquiredClaim, version: workflowJournalEventVersion })
    )
    yield* journal.append(
      runId,
      outcomeRecordKey(acquiredClaim.acquisition.operationId),
      TaskClaimAcquiredEvent.make({
        claim: { _tag: "ActiveTaskClaim", ...acquiredClaim.acquisition },
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
    const startOrdinal = PlannedAttemptExecutorCommandOrdinal.make(1)
    yield* journal.append(
      runId,
      plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, startOrdinal),
      PlannedAttemptExecutorCommandIntendedEvent.make({
        command: "StartOrContinue",
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        ordinal: startOrdinal,
        plannedAttempt,
        version: workflowJournalEventVersion
      })
    )
    yield* journal.append(
      runId,
      plannedAttemptExecutorWorkReportedRecordKey(
        plannedAttempt.attemptId,
        PlannedAttemptExecutorReportOrdinal.make(1)
      ),
      PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
        report: PlannedAttemptExecutorReport.cases.Running.make({
          correlation: { attemptId: plannedAttempt.attemptId, runId }
        }),
        version: workflowJournalEventVersion
      })
    )

    const executorStarts = yield* Ref.make(0)
    const claimReads = yield* Ref.make(0)
    const currentClaim = yield* Ref.make(ActiveTaskClaim.make(acquiredClaim.acquisition))
    const executor = PlannedAttemptExecutor.of({
      project: () =>
        Effect.succeed(
          PlannedAttemptExecutorProjection.cases.NoReport.make({
            correlation: plannedAttemptExecutorCorrelation(plannedAttempt)
          })
        ),
      requestSuspension: () =>
        Effect.succeed(
          PlannedAttemptExecutorReport.cases.SafelySuspended.make({
            correlation: { attemptId: plannedAttempt.attemptId, runId }
          })
        ),
      startOrContinue: () =>
        Ref.updateAndGet(executorStarts, (count) => count + 1).pipe(
          Effect.as(
            PlannedAttemptExecutorReport.cases.Running.make({
              correlation: { attemptId: plannedAttempt.attemptId, runId }
            })
          )
        )
    })
    const provider = Layer.succeed(
      WorkflowInterpreter,
      WorkflowInterpreter.of({
        acquireTaskClaim: unused,
        readTaskClaim: () =>
          Ref.update(claimReads, (count) => count + 1).pipe(
            Effect.andThen(Ref.get(currentClaim)),
            Effect.map((observation) => AuthoritativeTaskClaimObserved.make({ observation }))
          ),
        readTaskWorktree: () => Effect.die("a replaced claim must block the worktree read"),
        readTargetLineage: () => Effect.die("a replaced claim must block the target-lineage read"),
        readTrackerGraph: () => Effect.die("the test records its complete graph observations directly"),
        readTaskWorkSpecification: () => Effect.succeed(specification),
        reconcileTaskWorktree: unused,
        recordTaskAttemptPlan: unused,
        releaseTaskClaim: unused
      })
    )
    const interpreter = journaledWorkflowInterpreterLayer(runId, provider).pipe(
      Layer.provide(Layer.succeed(InRunJournal, InRunJournal.of(journal)))
    )
    yield* Effect.gen(function* () {
      const activation = yield* makeRunRecoveryProjection(runId)
      const closedRead = makeTrackerGraphObservationOperation(OperationId.make("same-process-closed-read"), target)
      const closedGraph = projectTrackerSnapshot({
        revision: "same-process-closed-graph",
        tasks: [
          {
            id: taskId,
            lifecycle: TaskLifecycle.cases.TerminalWithoutSuccess.make({}),
            parentTaskId: null,
            prerequisiteIds: []
          }
        ]
      })
      if (closedGraph._tag !== "Valid") return yield* Effect.die("expected a valid closed graph")
      yield* journal.append(runId, intentRecordKey(closedRead.operationId), taskTrackerReadIntent(closedRead))
      yield* journal.append(
        runId,
        outcomeRecordKey(closedRead.operationId),
        taskTrackerFactsObservedEvent(
          closedRead.operationId,
          makeCompleteTaskTrackerFactsObserved(closedRead, closedGraph.snapshot)
        )
      )
      const suspension = (yield* activation.readDeliveryProjection).frontier.transitions[0]
      if (suspension?._tag !== "SuspendPlannedAttemptExecutorWork") {
        return yield* Effect.die("the closed task must suspend before any continuation")
      }
      yield* requestPlannedAttemptExecutorSuspension(suspension.plannedAttempt)

      yield* Ref.set(currentClaim, replacementClaim)
      const reopenedRead = makeTrackerGraphObservationOperation(OperationId.make("same-process-reopened-read"), target)
      const reopenedGraph = projectTrackerSnapshot({
        revision: "same-process-reopened-graph",
        tasks: [{ id: taskId, lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
      })
      if (reopenedGraph._tag !== "Valid") return yield* Effect.die("expected a valid reopened graph")
      yield* journal.append(runId, intentRecordKey(reopenedRead.operationId), taskTrackerReadIntent(reopenedRead))
      yield* journal.append(
        runId,
        outcomeRecordKey(reopenedRead.operationId),
        taskTrackerFactsObservedEvent(
          reopenedRead.operationId,
          makeCompleteTaskTrackerFactsObserved(reopenedRead, reopenedGraph.snapshot)
        )
      )

      const specificationRead = (yield* activation.readDeliveryProjection).frontier.transitions[0]
      if (specificationRead?._tag !== "ObservePlannedAttemptContinuationSpecification") {
        return yield* Effect.die("continuation must reread the task specification")
      }
      const boundary = yield* WorkflowInterpreter
      yield* boundary.readTaskWorkSpecification(specificationRead.operation)
      const claimRead = (yield* activation.readDeliveryProjection).frontier.transitions[0]
      if (claimRead?._tag !== "ObservePlannedAttemptContinuationClaim") {
        return yield* Effect.die("continuation must reread the tracker claim")
      }
      yield* boundary.readTaskClaim(claimRead.operation)

      const constrained = (yield* activation.readDeliveryProjection).frontier
      expect(constrained.explanations).toContainEqual({
        _tag: "PlannedAttemptTaskClaimConstraint",
        claimState: "Foreign",
        correlation: { attemptId: plannedAttempt.attemptId, runId },
        taskId,
        wakeCondition: "ExplicitAppliedTaskClaimReacquisitionDirection"
      })
      expect(constrained.transitions).toEqual([])
    }).pipe(Effect.provideService(PlannedAttemptExecutor, executor), Effect.provide(interpreter))

    expect(yield* Ref.get(claimReads)).toBe(1)
    expect(yield* Ref.get(executorStarts)).toBe(0)
    expect((yield* journal.read(runId)).map(({ event }) => event)).toContainEqual(
      expect.objectContaining({
        _tag: "TaskTrackerReadIntentRecorded",
        operation: expect.objectContaining({ _tag: "ReadTaskClaim", taskId })
      })
    )
  }).pipe(Effect.provide(legacyMemoryJournalStoreLayer), Effect.provide(plannedAttemptProtocolControllerLayer))
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

    const recovery = yield* makeRunRecoveryProjection(runId)
    const beforeSuspension = (yield* recovery.readDeliveryProjection).frontier
    expect(beforeSuspension).toEqual({
      explanations: [claimSettlement],
      transitions: [{ _tag: "SuspendPlannedAttemptExecutorWork", plannedAttempt }]
    })
    const reportOrdinal = PlannedAttemptExecutorReportOrdinal.make(1)
    const suspensionOrdinal = PlannedAttemptExecutorCommandOrdinal.make(1)
    yield* journal.append(
      runId,
      plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, suspensionOrdinal),
      PlannedAttemptExecutorCommandIntendedEvent.make({
        command: "Suspend",
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        ordinal: suspensionOrdinal,
        plannedAttempt,
        version: workflowJournalEventVersion
      })
    )
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
    expect((yield* recovery.readDeliveryProjection).frontier).toEqual({
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
    expect((yield* recovery.readDeliveryProjection).frontier).toEqual({
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
    expect((yield* recovery.readDeliveryProjection).frontier).toEqual({
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
    expect((yield* recovery.readDeliveryProjection).frontier).toEqual({
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
      authority: TaskClaimReleaseAuthority.cases.WorkflowClaimReleaseAuthority.make({}),
      predecessorOperationIds: [claim.acquisition.operationId],
      release: {
        claim: { _tag: "ActiveTaskClaim", ...claim.acquisition },
        operationId: OperationId.make(`external-success-release:${claim.acquisition.operationId}`)
      }
    })
    expect((yield* recovery.readDeliveryProjection).frontier).toEqual({
      explanations: [claimSettlement],
      transitions: [{ _tag: "ReleaseExternallyCompletedTaskClaim", operation: externalRelease, plannedAttempt }]
    })
    yield* journal.append(
      runId,
      intentRecordKey(externalRelease.release.operationId),
      TaskClaimReleaseIntendedEvent.make({ operation: externalRelease, version: workflowJournalEventVersion })
    )
    const releaseFrontier = (yield* recovery.readDeliveryProjection).frontier
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
    expect((yield* recovery.readDeliveryProjection).frontier.transitions).toEqual([
      { _tag: "ReconcileTaskClaimRelease", operationId: externalRelease.release.operationId, taskId }
    ])
  }).pipe(
    Effect.provide(legacyMemoryJournalStoreLayer),
    Effect.provide(controlledFakePlannedAttemptExecutorLayer),
    Effect.provideService(
      WorkflowInterpreter,
      WorkflowInterpreter.of({
        acquireTaskClaim: unused,
        readTaskClaim: () => Effect.die("unexpected task claim read"),
        readTaskWorktree: () => Effect.die("unused worktree observation"),
        readTargetLineage: () => Effect.die("unused target-lineage observation"),
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
          Effect.as(
            AuthoritativeTaskClaimAcquired.make({
              claim: ActiveTaskClaim.make({
                operationId: operation.acquisition.operationId,
                owner: operation.acquisition.owner,
                taskId: operation.acquisition.taskId,
                token: operation.acquisition.token
              })
            })
          )
        ),
      readTaskClaim: () => Effect.die("unexpected task claim read"),
      readTaskWorktree: () => Effect.die("unused worktree observation"),
      readTargetLineage: () => Effect.die("unused target-lineage observation"),
      readTrackerGraph: unused,
      readTaskWorkSpecification: unused,
      reconcileTaskWorktree: (operation) =>
        Ref.update(calls, (current) => [...current, `worktree:${operation.operationId}`]).pipe(
          Effect.as(
            AuthoritativeTaskWorktreeReady.make({
              proof: PlannedWorktreeReady.make({
                baseSha: operation.plannedAttempt.baseSha,
                branch: operation.plannedAttempt.branch,
                headSha: operation.plannedAttempt.baseSha,
                worktree: operation.plannedAttempt.worktree
              })
            })
          )
        ),
      recordTaskAttemptPlan: unused,
      releaseTaskClaim: unused
    })
    yield* recoverTaskClaimOperation(runId, claim.acquisition.operationId).pipe(
      Effect.provideService(WorkflowInterpreter, interpreter)
    )
    yield* recoverTaskClaimOperation(runId, claim.acquisition.operationId).pipe(
      Effect.provideService(WorkflowInterpreter, interpreter)
    )
    yield* recoverTaskWorktreeOperation(runId, worktree.operationId).pipe(
      Effect.provideService(WorkflowInterpreter, interpreter)
    )
    expect(yield* Ref.get(calls)).toEqual([
      "claim:recovered-claim",
      "claim:recovered-claim",
      "worktree:recovered-worktree"
    ])
  }).pipe(Effect.provide(legacyMemoryJournalStoreLayer))
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
    const recovery = yield* makeRunRecoveryProjection(runId).pipe(
      Effect.provideService(
        InRunJournal,
        InRunJournal.of({ append: changingJournal.append, read: changingJournal.read })
      )
    )
    expect((yield* recovery.readDeliveryProjection.pipe(Effect.flip))._tag).toBe("InvalidWorkflowJournalHistory")

    const initiallyInvalid = yield* makeRunRecoveryProjection(runId).pipe(
      Effect.provideService(
        InRunJournal,
        InRunJournal.of({ append: changingJournal.append, read: () => Effect.succeed([invalidRecord]) })
      ),
      Effect.flip
    )
    expect(initiallyInvalid._tag).toBe("InvalidWorkflowJournalHistory")
  }).pipe(
    Effect.provide(controlledFakePlannedAttemptExecutorLayer),
    Effect.provideService(
      WorkflowInterpreter,
      WorkflowInterpreter.of({
        acquireTaskClaim: unused,
        readTaskClaim: () => Effect.die("unexpected task claim read"),
        readTaskWorktree: () => Effect.die("unused worktree observation"),
        readTargetLineage: () => Effect.die("unused target-lineage observation"),
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
