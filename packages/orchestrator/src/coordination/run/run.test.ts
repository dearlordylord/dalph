import { it as effectIt } from "@effect/vitest"
import { NodeCrypto } from "@effect/platform-node"
import { Effect, Option, Ref } from "effect"
import { expect, it } from "vitest"
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
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { OperationId } from "../../workflow/identity.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { InitialControlPolicy } from "../../control/policy.js"
import type { FreshWorkflowStage } from "./fresh-activation.js"
import { RunRecoveryActivation } from "./recovery-activation.js"
import { FrontierExplanation, RunnableFrontierTransition } from "../frontier/frontier.js"
import { TaskAttemptPlanRecordAcknowledged } from "../../workflow/protocols/task-attempt-planning/record.js"
import { TaskClaimAcquisitionPlanner } from "../../workflow/protocols/task-claim-acquisition/plan.js"
import { projectTrackerSnapshot, taskRevisionFor } from "../../authorities/task-tracker/graph.js"
import { OperationIdAllocator, PlannedTaskAttemptPlanner } from "../../workflow/protocols/task-attempt-planning/plan.js"
import { ActiveTaskClaim } from "../../authorities/task-tracker/claim-mutation.js"
import { makeTaskWorkSpecification } from "../../authorities/task-tracker/task-work-specification.js"
import { discardFreshStagesOwnedByRecovery, runRecoveredWorkflow, runWorkflow, runSyntheticWorkflow } from "./run.js"
import { freshWorkflowRunId } from "./fresh-run-identity.js"
import {
  AuthoritativeTaskClaimAcquired,
  WorkflowInterpreter,
  WorkflowTrace
} from "../../workflow/interpretation/interpreter.js"
import { AuthoritativeTaskWorktreeReady } from "../../workflow/protocols/worktree-reconciliation/protocol.js"
import { JournalStore, WorkflowRunAlreadyBegan, WorkflowRunAlreadyTerminated } from "../../workflow-journal/store.js"
import { memoryJournalStoreLayer } from "../../workflow-journal/adapters/memory-store.js"

const stage = (taskId: string): FreshWorkflowStage => ({
  run: () => Effect.die("projection test does not run stages"),
  transition: RunnableFrontierTransition.ContinueFreshWorkflowOperation({
    operationId: OperationId.make(`operation-${taskId}`),
    taskId: TaskId.make(taskId)
  })
})

it("drops a stale process-local stage when journal reconstruction owns its task", () => {
  const stale = stage("A")
  const independent = stage("B")

  expect(discardFreshStagesOwnedByRecovery([stale, independent], new Set([TaskId.make("A")]))).toEqual([independent])
})

effectIt.effect("starts a production Run by recording its identity before reading the task tracker", () =>
  Effect.gen(function* () {
    const target = FixtureTarget.make("first-record-target")
    const runId = yield* freshWorkflowRunId(target)
    const trackerReads = yield* Ref.make(0)
    const projected = projectTrackerSnapshot({ revision: "first-record-snapshot", tasks: [] })
    const snapshot = Option.getOrThrow(
      Option.fromUndefinedOr(projected._tag === "Valid" ? projected.snapshot : undefined)
    )

    yield* runWorkflow(
      target,
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }),
      runId
    ).pipe(
      Effect.provideService(RunRecoveryActivation, {
        _tag: "SyntheticFreshOnlyActivation",
        continuePlannedAttemptExecutorWork: () => Effect.die("unused"),
        readFrontier: Effect.succeed({ explanations: [], transitions: [] }),
        reconstructedPlannedAttemptPositions: [],
        waitForNextExecutorWake: Effect.void
      }),
      Effect.provideService(
        WorkflowInterpreter,
        WorkflowInterpreter.of({
          acquireTaskClaim: () => Effect.die("unused"),
          readTrackerGraph: () => Ref.update(trackerReads, (count) => count + 1).pipe(Effect.as(snapshot)),
          readTaskWorkSpecification: () => Effect.die("unused"),
          reconcileTaskWorktree: () => Effect.die("unused"),
          recordTaskAttemptPlan: () => Effect.die("unused")
        })
      ),
      Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })),
      Effect.provideService(
        OperationIdAllocator,
        OperationIdAllocator.of({ allocate: () => Effect.succeed(OperationId.make("first-record-read")) })
      ),
      Effect.provideService(
        TaskClaimAcquisitionPlanner,
        TaskClaimAcquisitionPlanner.of({ plan: () => Effect.die("unused") })
      ),
      Effect.provideService(
        PlannedTaskAttemptPlanner,
        PlannedTaskAttemptPlanner.of({ plan: () => Effect.die("unused") })
      )
    )

    expect(yield* Ref.get(trackerReads)).toBe(1)
    expect((yield* (yield* JournalStore).read(runId)).map(({ event }) => event._tag)).toEqual([
      "WorkflowRunBegan",
      "WorkflowRunTerminated"
    ])
  }).pipe(Effect.provide(memoryJournalStoreLayer), Effect.provide(NodeCrypto.layer))
)

effectIt.effect("rejects a second fresh start for the same Run before any tracker read", () =>
  Effect.gen(function* () {
    const target = FixtureTarget.make("duplicate-fresh-target")
    const runId = yield* freshWorkflowRunId(target)
    const journal = yield* JournalStore
    yield* journal.beginRun(runId, target)
    const trackerReads = yield* Ref.make(0)
    const projected = projectTrackerSnapshot({ revision: "duplicate-fresh-snapshot", tasks: [] })
    const snapshot = Option.getOrThrow(
      Option.fromUndefinedOr(projected._tag === "Valid" ? projected.snapshot : undefined)
    )

    const failure = yield* runWorkflow(
      target,
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }),
      runId
    ).pipe(
      Effect.provideService(RunRecoveryActivation, {
        _tag: "SyntheticFreshOnlyActivation",
        continuePlannedAttemptExecutorWork: () => Effect.die("unused"),
        readFrontier: Effect.succeed({ explanations: [], transitions: [] }),
        reconstructedPlannedAttemptPositions: [],
        waitForNextExecutorWake: Effect.void
      }),
      Effect.provideService(
        WorkflowInterpreter,
        WorkflowInterpreter.of({
          acquireTaskClaim: () => Effect.die("unused"),
          readTrackerGraph: () => Ref.update(trackerReads, (count) => count + 1).pipe(Effect.as(snapshot)),
          readTaskWorkSpecification: () => Effect.die("unused"),
          reconcileTaskWorktree: () => Effect.die("unused"),
          recordTaskAttemptPlan: () => Effect.die("unused")
        })
      ),
      Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })),
      Effect.provideService(
        OperationIdAllocator,
        OperationIdAllocator.of({ allocate: () => Effect.succeed(OperationId.make("duplicate-fresh-read")) })
      ),
      Effect.provideService(
        TaskClaimAcquisitionPlanner,
        TaskClaimAcquisitionPlanner.of({ plan: () => Effect.die("unused") })
      ),
      Effect.provideService(
        PlannedTaskAttemptPlanner,
        PlannedTaskAttemptPlanner.of({ plan: () => Effect.die("unused") })
      ),
      Effect.flip
    )

    expect(failure).toBeInstanceOf(WorkflowRunAlreadyBegan)
    expect(yield* Ref.get(trackerReads)).toBe(0)
  }).pipe(Effect.provide(memoryJournalStoreLayer), Effect.provide(NodeCrypto.layer))
)

effectIt.effect("recovers a Run that crashed immediately after its beginning was recorded", () =>
  Effect.gen(function* () {
    const target = FixtureTarget.make("beginning-only-target")
    const runId = RunId.make("beginning-only-run")
    const journal = yield* JournalStore
    yield* journal.beginRun(runId, target)
    const projected = projectTrackerSnapshot({ revision: "beginning-only-snapshot", tasks: [] })
    const snapshot = Option.getOrThrow(
      Option.fromUndefinedOr(projected._tag === "Valid" ? projected.snapshot : undefined)
    )
    const trackerReads = yield* Ref.make(0)

    yield* runRecoveredWorkflow(
      target,
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    ).pipe(
      Effect.provideService(RunRecoveryActivation, {
        _tag: "AuthoritativeRunRecoveryActivation",
        continuePlannedAttemptExecutorWork: () => Effect.die("unused"),
        readFrontier: Effect.succeed({ explanations: [], transitions: [] }),
        reconstructedPlannedAttemptPositions: [],
        runId,
        runTransition: () => Effect.die("unused"),
        waitForNextExecutorWake: Effect.void
      }),
      Effect.provideService(
        WorkflowInterpreter,
        WorkflowInterpreter.of({
          acquireTaskClaim: () => Effect.die("unused"),
          readTrackerGraph: () => Ref.update(trackerReads, (count) => count + 1).pipe(Effect.as(snapshot)),
          readTaskWorkSpecification: () => Effect.die("unused"),
          reconcileTaskWorktree: () => Effect.die("unused"),
          recordTaskAttemptPlan: () => Effect.die("unused")
        })
      ),
      Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })),
      Effect.provideService(
        OperationIdAllocator,
        OperationIdAllocator.of({ allocate: () => Effect.succeed(OperationId.make("beginning-only-read")) })
      ),
      Effect.provideService(
        TaskClaimAcquisitionPlanner,
        TaskClaimAcquisitionPlanner.of({ plan: () => Effect.die("unused") })
      ),
      Effect.provideService(
        PlannedTaskAttemptPlanner,
        PlannedTaskAttemptPlanner.of({ plan: () => Effect.die("unused") })
      )
    )

    expect(yield* Ref.get(trackerReads)).toBe(1)
    expect((yield* journal.read(runId)).map(({ event }) => event._tag)).toEqual([
      "WorkflowRunBegan",
      "WorkflowRunTerminated"
    ])
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)

effectIt.effect("rejects recovery of a terminated Run before any tracker read", () =>
  Effect.gen(function* () {
    const target = FixtureTarget.make("terminated-recovery-target")
    const runId = RunId.make("terminated-recovery-run")
    const journal = yield* JournalStore
    yield* journal.beginRun(runId, target)
    yield* journal.terminateRun(runId)
    const trackerReads = yield* Ref.make(0)

    const failure = yield* runRecoveredWorkflow(
      target,
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    ).pipe(
      Effect.provideService(RunRecoveryActivation, {
        _tag: "AuthoritativeRunRecoveryActivation",
        continuePlannedAttemptExecutorWork: () => Effect.die("unused"),
        readFrontier: Effect.succeed({ explanations: [], transitions: [] }),
        reconstructedPlannedAttemptPositions: [],
        runId,
        runTransition: () => Effect.die("unused"),
        waitForNextExecutorWake: Effect.void
      }),
      Effect.provideService(
        WorkflowInterpreter,
        WorkflowInterpreter.of({
          acquireTaskClaim: () => Effect.die("unused"),
          readTrackerGraph: () =>
            Ref.update(trackerReads, (count) => count + 1).pipe(
              Effect.andThen(Effect.die("tracker read occurred after Run termination"))
            ),
          readTaskWorkSpecification: () => Effect.die("unused"),
          reconcileTaskWorktree: () => Effect.die("unused"),
          recordTaskAttemptPlan: () => Effect.die("unused")
        })
      ),
      Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })),
      Effect.provideService(
        OperationIdAllocator,
        OperationIdAllocator.of({ allocate: () => Effect.succeed(OperationId.make("terminated-recovery-read")) })
      ),
      Effect.provideService(
        TaskClaimAcquisitionPlanner,
        TaskClaimAcquisitionPlanner.of({ plan: () => Effect.die("unused") })
      ),
      Effect.provideService(
        PlannedTaskAttemptPlanner,
        PlannedTaskAttemptPlanner.of({ plan: () => Effect.die("unused") })
      ),
      Effect.flip
    )

    expect(failure).toBeInstanceOf(WorkflowRunAlreadyTerminated)
    expect(yield* Ref.get(trackerReads)).toBe(0)
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)

effectIt.effect("runs an authoritative recovered transition in the shared activation loop", () =>
  Effect.gen(function* () {
    const runId = RunId.make("workflow-recovered-run")
    const target = FixtureTarget.make("workflow-recovered-target")
    yield* (yield* JournalStore).beginRun(runId, target)
    const plannedAttempt = PlannedTaskAttempt.make({
      attemptId: AttemptId.make("workflow-recovered-attempt"),
      baseSha: GitCommitSha.make("4".repeat(40)),
      branch: TaskBranchRef.make("refs/heads/dalph/workflow-recovered-attempt"),
      executor: TaskExecutorLocator.make("executor:fake"),
      runId,
      taskId: TaskId.make("workflow-recovered-task"),
      taskRevision: TaskRevision.make("workflow-recovered-revision"),
      worktree: WorktreeLocator.make("/worktrees/workflow-recovered-attempt")
    })
    const active = yield* Ref.make(true)
    const ran = yield* Ref.make(0)
    const transition = RunnableFrontierTransition.ContinuePlannedAttemptExecutorWork({ plannedAttempt })
    const recovery = RunRecoveryActivation.of({
      _tag: "AuthoritativeRunRecoveryActivation",
      continuePlannedAttemptExecutorWork: () => Effect.die("unused"),
      readFrontier: Ref.get(active).pipe(
        Effect.map((isActive) => ({ explanations: [], transitions: isActive ? [transition] : [] }))
      ),
      reconstructedPlannedAttemptPositions: [
        { attemptId: plannedAttempt.attemptId, runId, taskId: plannedAttempt.taskId }
      ],
      runId,
      runTransition: () => Ref.set(active, false).pipe(Effect.andThen(Ref.update(ran, (count) => count + 1))),
      waitForNextExecutorWake: Effect.void
    })
    const projected = projectTrackerSnapshot({ revision: "workflow-recovered-snapshot", tasks: [] })
    const snapshot = Option.getOrThrow(
      Option.fromUndefinedOr(projected._tag === "Valid" ? projected.snapshot : undefined)
    )
    const interpreter = WorkflowInterpreter.of({
      acquireTaskClaim: () => Effect.die("unused"),
      readTrackerGraph: () => Effect.succeed(snapshot),
      readTaskWorkSpecification: (operation) =>
        Effect.succeed(
          makeTaskWorkSpecification({ body: "Workflow task body", taskId: operation.taskId, title: "Workflow task" })
        ),
      reconcileTaskWorktree: () => Effect.die("unused"),
      recordTaskAttemptPlan: () => Effect.die("unused")
    })

    yield* runRecoveredWorkflow(
      target,
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    ).pipe(
      Effect.provideService(RunRecoveryActivation, recovery),
      Effect.provideService(WorkflowInterpreter, interpreter),
      Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })),
      Effect.provideService(
        OperationIdAllocator,
        OperationIdAllocator.of({ allocate: () => Effect.succeed(OperationId.make("initial-read")) })
      ),
      Effect.provideService(
        TaskClaimAcquisitionPlanner,
        TaskClaimAcquisitionPlanner.of({ plan: () => Effect.die("unused") })
      ),
      Effect.provideService(
        PlannedTaskAttemptPlanner,
        PlannedTaskAttemptPlanner.of({ plan: () => Effect.die("unused") })
      )
    )
    expect(yield* Ref.get(ran)).toBe(1)
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)

effectIt.effect("runs the authoritative fresh claim path through one complete attempt", () =>
  Effect.gen(function* () {
    const runId = RunId.make("workflow-fresh-run")
    const projected = projectTrackerSnapshot({
      revision: "workflow-fresh-snapshot",
      tasks: [
        { id: "workflow-fresh-task", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] },
        { id: "workflow-vanishing-task", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }
      ]
    })
    const snapshot = Option.getOrThrow(
      Option.fromUndefinedOr(projected._tag === "Valid" ? projected.snapshot : undefined)
    )
    const task = Option.getOrThrow(Option.fromUndefinedOr(snapshot.eligibleTasks()[0]))
    const emptyProjection = projectTrackerSnapshot({ revision: "workflow-empty-snapshot", tasks: [] })
    const emptySnapshot = Option.getOrThrow(
      Option.fromUndefinedOr(emptyProjection._tag === "Valid" ? emptyProjection.snapshot : undefined)
    )
    const plannedAttempt = PlannedTaskAttempt.make({
      attemptId: AttemptId.make("workflow-fresh-attempt"),
      baseSha: GitCommitSha.make("5".repeat(40)),
      branch: TaskBranchRef.make("refs/heads/dalph/workflow-fresh-attempt"),
      executor: TaskExecutorLocator.make("executor:fake"),
      runId,
      taskId: task.id,
      taskRevision: taskRevisionFor(task),
      worktree: WorktreeLocator.make("/worktrees/workflow-fresh-attempt")
    })
    const nextId = yield* Ref.make(0)
    const allocator = OperationIdAllocator.of({
      allocate: () =>
        Ref.getAndUpdate(nextId, (value) => value + 1).pipe(
          Effect.map((value) => OperationId.make(`fresh-operation-${value}`))
        )
    })
    const interpreter = WorkflowInterpreter.of({
      acquireTaskClaim: (operation) =>
        Effect.succeed(AuthoritativeTaskClaimAcquired.make({ claim: ActiveTaskClaim.make(operation.acquisition) })),
      readTrackerGraph: (operation) =>
        Effect.succeed(operation.operationId === "fresh-operation-1" ? emptySnapshot : snapshot),
      readTaskWorkSpecification: (operation) =>
        Effect.succeed(
          makeTaskWorkSpecification({ body: "Workflow task body", taskId: operation.taskId, title: "Workflow task" })
        ),
      reconcileTaskWorktree: () =>
        Effect.succeed(
          AuthoritativeTaskWorktreeReady.make({
            proof: {
              _tag: "PlannedWorktreeReady",
              baseSha: plannedAttempt.baseSha,
              branch: plannedAttempt.branch,
              headSha: plannedAttempt.baseSha,
              worktree: plannedAttempt.worktree
            }
          })
        ),
      recordTaskAttemptPlan: () => Effect.succeed(TaskAttemptPlanRecordAcknowledged.make({ plannedAttempt }))
    })
    const frontierReads = yield* Ref.make(0)
    const recovery = RunRecoveryActivation.of({
      _tag: "SyntheticFreshOnlyActivation",
      continuePlannedAttemptExecutorWork: () =>
        Effect.succeed(
          PlannedAttemptExecutorReport.cases.Terminal.make({
            correlation: plannedAttemptExecutorCorrelation(plannedAttempt),
            result: { _tag: "Completed" }
          })
        ),
      readFrontier: Ref.getAndUpdate(frontierReads, (count) => count + 1).pipe(
        Effect.map((count) =>
          count === 0
            ? {
                explanations: [
                  FrontierExplanation.Pause({
                    operationId: OperationId.make("recovered-fresh-boundary"),
                    taskId: task.id
                  })
                ],
                transitions: []
              }
            : { explanations: [], transitions: [] }
        )
      ),
      reconstructedPlannedAttemptPositions: [],
      waitForNextExecutorWake: Effect.void
    })

    yield* runSyntheticWorkflow(
      FixtureTarget.make("workflow-fresh-target"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }),
      runId
    ).pipe(
      Effect.provideService(RunRecoveryActivation, recovery),
      Effect.provideService(WorkflowInterpreter, interpreter),
      Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })),
      Effect.provideService(OperationIdAllocator, allocator),
      Effect.provideService(
        TaskClaimAcquisitionPlanner,
        TaskClaimAcquisitionPlanner.of({
          plan: (operationId, taskId) =>
            Effect.succeed({
              operationId,
              owner: ClaimOwner.make("dalph"),
              taskId,
              token: ClaimToken.make("workflow-fresh-token")
            })
        })
      ),
      Effect.provideService(
        PlannedTaskAttemptPlanner,
        PlannedTaskAttemptPlanner.of({ plan: () => Effect.succeed(plannedAttempt) })
      )
    )
  })
)
