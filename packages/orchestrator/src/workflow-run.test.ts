import { it as effectIt } from "@effect/vitest"
import { Effect, Option, Ref } from "effect"
import { expect, it } from "vitest"
import {
  AttemptId,
  ClaimOwner,
  ClaimToken,
  FixtureTarget,
  GitCommitSha,
  OperationId,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  TaskWorkCapacity,
  WorktreeLocator
} from "./domain.js"
import type { FreshWorkflowStage } from "./fresh-workflow-stage.js"
import { ManagedRecoveryActivation } from "./managed-activation.js"
import { plannedAttemptExecutorCorrelation, PlannedAttemptExecutorReport } from "./planned-attempt-executor.js"
import { FrontierExplanation, RunnableFrontierTransition } from "./runnable-frontier.js"
import { TaskAttemptPlanRecordAcknowledged } from "./task-attempt-plan-recording.js"
import { TaskClaimAcquisitionPlanner } from "./task-claim-planning.js"
import { projectTrackerSnapshot, taskRevisionFor } from "./task-dag.js"
import { OperationIdAllocator, PlannedTaskAttemptPlanner } from "./task-work-planning.js"
import { ActiveTaskClaim } from "./tracker-mutation.js"
import { discardFreshStagesOwnedByRecovery, runWorkflow } from "./workflow-run.js"
import {
  AuthoritativeTaskClaimAcquired,
  AuthoritativeTaskWorktreeReady,
  WorkflowInterpreter,
  WorkflowTrace
} from "./workflow.js"

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

  expect(
    discardFreshStagesOwnedByRecovery(
      [stale, independent],
      new Set([TaskId.make("A")])
    )
  ).toEqual([independent])
})

effectIt.effect(
  "runs an authoritative recovered transition in the shared activation loop",
  () =>
    Effect.gen(function*() {
      const runId = RunId.make("workflow-recovered-run")
      const plannedAttempt = PlannedTaskAttempt.make({
        attemptId: AttemptId.make("workflow-recovered-attempt"),
        baseSha: GitCommitSha.make("4".repeat(40)),
        branch: TaskBranchRef.make(
          "refs/heads/dalph/workflow-recovered-attempt"
        ),
        executor: TaskExecutorLocator.make("executor:fake"),
        runId,
        taskId: TaskId.make("workflow-recovered-task"),
        taskRevision: TaskRevision.make("workflow-recovered-revision"),
        worktree: WorktreeLocator.make(
          "/worktrees/workflow-recovered-attempt"
        )
      })
      const active = yield* Ref.make(true)
      const ran = yield* Ref.make(0)
      const transition = RunnableFrontierTransition
        .ContinuePlannedAttemptExecutorWork({ plannedAttempt })
      const recovery = ManagedRecoveryActivation.of({
        _tag: "AuthoritativeManagedRunActivation",
        continuePlannedAttemptExecutorWork: () => Effect.die("unused"),
        readFrontier: Ref.get(active).pipe(
          Effect.map((isActive) => ({
            explanations: [],
            transitions: isActive ? [transition] : []
          }))
        ),
        reconstructedPlannedAttemptPositions: [{
          attemptId: plannedAttempt.attemptId,
          runId,
          taskId: plannedAttempt.taskId
        }],
        runId,
        runTransition: () =>
          Ref.set(active, false).pipe(
            Effect.andThen(Ref.update(ran, (count) => count + 1))
          ),
        waitForNextExecutorWake: Effect.void
      })
      const projected = projectTrackerSnapshot({
        revision: "workflow-recovered-snapshot",
        tasks: []
      })
      const snapshot = Option.getOrThrow(Option.fromUndefinedOr(
        projected._tag === "Valid" ? projected.snapshot : undefined
      ))
      const interpreter = WorkflowInterpreter.of({
        acquireTaskClaim: () => Effect.die("unused"),
        readTrackerGraph: () => Effect.succeed(snapshot),
        reconcileTaskWorktree: () => Effect.die("unused"),
        recordTaskAttemptPlan: () => Effect.die("unused")
      })

      yield* runWorkflow(
        FixtureTarget.make("workflow-recovered-target"),
        TaskWorkCapacity.make(1)
      ).pipe(
        Effect.provideService(ManagedRecoveryActivation, recovery),
        Effect.provideService(WorkflowInterpreter, interpreter),
        Effect.provideService(
          WorkflowTrace,
          WorkflowTrace.of({ emit: () => Effect.void })
        ),
        Effect.provideService(
          OperationIdAllocator,
          OperationIdAllocator.of({
            allocate: () => Effect.succeed(OperationId.make("initial-read"))
          })
        ),
        Effect.provideService(
          TaskClaimAcquisitionPlanner,
          TaskClaimAcquisitionPlanner.of({
            plan: () => Effect.die("unused")
          })
        ),
        Effect.provideService(
          PlannedTaskAttemptPlanner,
          PlannedTaskAttemptPlanner.of({
            plan: () => Effect.die("unused")
          })
        )
      )
      expect(yield* Ref.get(ran)).toBe(1)
    })
)

effectIt.effect(
  "runs the authoritative fresh claim path through one complete attempt",
  () =>
    Effect.gen(function*() {
      const runId = RunId.make("workflow-fresh-run")
      const projected = projectTrackerSnapshot({
        revision: "workflow-fresh-snapshot",
        tasks: [{
          id: "workflow-fresh-task",
          lifecycle: { _tag: "Open" },
          parentTaskId: null,
          prerequisiteIds: []
        }, {
          id: "workflow-vanishing-task",
          lifecycle: { _tag: "Open" },
          parentTaskId: null,
          prerequisiteIds: []
        }]
      })
      const snapshot = Option.getOrThrow(Option.fromUndefinedOr(
        projected._tag === "Valid" ? projected.snapshot : undefined
      ))
      const task = Option.getOrThrow(
        Option.fromUndefinedOr(snapshot.eligibleTasks()[0])
      )
      const emptyProjection = projectTrackerSnapshot({
        revision: "workflow-empty-snapshot",
        tasks: []
      })
      const emptySnapshot = Option.getOrThrow(Option.fromUndefinedOr(
        emptyProjection._tag === "Valid"
          ? emptyProjection.snapshot
          : undefined
      ))
      const plannedAttempt = PlannedTaskAttempt.make({
        attemptId: AttemptId.make("workflow-fresh-attempt"),
        baseSha: GitCommitSha.make("5".repeat(40)),
        branch: TaskBranchRef.make(
          "refs/heads/dalph/workflow-fresh-attempt"
        ),
        executor: TaskExecutorLocator.make("executor:fake"),
        runId,
        taskId: task.id,
        taskRevision: taskRevisionFor(task),
        worktree: WorktreeLocator.make(
          "/worktrees/workflow-fresh-attempt"
        )
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
          Effect.succeed(
            AuthoritativeTaskClaimAcquired.make({
              claim: ActiveTaskClaim.make(operation.acquisition)
            })
          ),
        readTrackerGraph: (operation) =>
          Effect.succeed(
            operation.operationId === "fresh-operation-1"
              ? emptySnapshot
              : snapshot
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
        recordTaskAttemptPlan: () =>
          Effect.succeed(
            TaskAttemptPlanRecordAcknowledged.make({ plannedAttempt })
          )
      })
      const frontierReads = yield* Ref.make(0)
      const recovery = ManagedRecoveryActivation.of({
        _tag: "SyntheticFreshOnlyActivation",
        continuePlannedAttemptExecutorWork: () =>
          Effect.succeed(
            PlannedAttemptExecutorReport.cases.Terminal.make({
              correlation: plannedAttemptExecutorCorrelation(
                plannedAttempt
              ),
              result: { _tag: "Completed" }
            })
          ),
        readFrontier: Ref.getAndUpdate(
          frontierReads,
          (count) => count + 1
        ).pipe(
          Effect.map((count) =>
            count === 0
              ? {
                explanations: [
                  FrontierExplanation.Pause({
                    operationId: OperationId.make(
                      "recovered-fresh-boundary"
                    ),
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

      yield* runWorkflow(
        FixtureTarget.make("workflow-fresh-target"),
        TaskWorkCapacity.make(1)
      ).pipe(
        Effect.provideService(ManagedRecoveryActivation, recovery),
        Effect.provideService(WorkflowInterpreter, interpreter),
        Effect.provideService(
          WorkflowTrace,
          WorkflowTrace.of({ emit: () => Effect.void })
        ),
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
          PlannedTaskAttemptPlanner.of({
            plan: () => Effect.succeed(plannedAttempt)
          })
        )
      )
    })
)
