import { it } from "@effect/vitest"
import { Effect, Option } from "effect"
import { expect } from "vitest"
import {
  AttemptId,
  GitCommitSha,
  JournalPosition,
  OperationId,
  PlannedTaskAttempt,
  ProviderObservationId,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskLifecycle,
  TaskRevision,
  TaskWorkCapacity,
  TaskWorkSessionId,
  TaskWorkSessionLocator,
  WorktreeLocator
} from "./domain.js"
import { WorkflowResponsibilityEntry, WorkflowResponsibilityState } from "./reconstructed-managed-run-state.js"
import {
  deriveRunFinalityDecision,
  deriveRunnableFrontier,
  ResponsibilityDisposition,
  type RunnableFrontierTransition
} from "./runnable-frontier.js"
import { makeTaskAdmissionController, type NextAdmissionDecision } from "./task-admission-controller.js"
import { taskRevisionFor } from "./task-dag.js"
import { TaskExecutionRequest, TaskExecutionSessionBinding } from "./task-execution.js"
import { makeTaskExecutionOperation } from "./workflow-operation.js"

const taskA = TaskId.make("task-A")
const taskB = TaskId.make("task-B")
const taskC = TaskId.make("task-C")
const taskD = TaskId.make("task-D")
const frontierRunId = RunId.make("frontier-test-run")
const freshTask = (taskId: TaskId) => ({
  taskId,
  taskRevision: TaskRevision.make(`revision:${taskId}`)
})

const admittedTransitions = (
  decision: NextAdmissionDecision
): ReadonlyArray<RunnableFrontierTransition> => Option.toArray(decision.transition)

const executionResponsibilityFor = (
  taskId: TaskId,
  operationIdentity: string = taskId
) => {
  const task = {
    id: taskId,
    lifecycle: TaskLifecycle.cases.Open.make({}),
    parentTaskId: null,
    prerequisiteIds: []
  }
  const operationId = OperationId.make(`execute-${operationIdentity}`)
  const plannedAttempt = PlannedTaskAttempt.make({
    attemptId: AttemptId.make(`attempt-${taskId}`),
    baseSha: GitCommitSha.make("0123456789abcdef0123456789abcdef01234567"),
    branch: TaskBranchRef.make(`refs/heads/dalph/${taskId}`),
    executor: TaskExecutorLocator.make("executor:frontier-test"),
    runId: RunId.make("frontier-test-run"),
    session: TaskWorkSessionLocator.make(`session:${taskId}`),
    taskId,
    taskRevision: taskRevisionFor(task),
    worktree: WorktreeLocator.make(`/tmp/dalph-${taskId}`)
  })
  return WorkflowResponsibilityEntry.cases.TaskExecutionResponsibility.make({
    beganAt: JournalPosition.make(1),
    taskId,
    operation: makeTaskExecutionOperation({
      predecessorOperationIds: [OperationId.make(`session-${taskId}`)],
      request: TaskExecutionRequest.make({
        operationId,
        plannedAttempt,
        session: TaskExecutionSessionBinding.cases.EstablishedSession.make({
          sessionId: TaskWorkSessionId.make(`provider-session-${taskId}`)
        }),
        task
      })
    })
  })
}

it.effect("admits only the canonical first fresh task when one position is available", () =>
  Effect.gen(function*() {
    const frontier = deriveRunnableFrontier({
      freshEligibleTasks: [freshTask(taskB), freshTask(taskA)],
      responsibility: WorkflowResponsibilityState.make({ entries: [] }),
      responsibilityFacts: []
    })
    const controller = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(1),
      freshOccupiedInvocations: [],
      reconstructedReservedPositions: []
    })

    const admission = yield* controller.admit(frontier, frontierRunId)

    expect(frontier.transitions.map(({ taskId }) => taskId)).toEqual([
      taskA,
      taskB
    ])
    expect(admittedTransitions(admission)).toEqual([
      {
        _tag: "CommitFreshTaskClaimIntent",
        ...freshTask(taskA)
      }
    ])
    expect(yield* controller.snapshot()).toEqual({
      capacity: 1,
      occupied: [],
      reservedPositions: [{
        correlation: {
          _tag: "SelectedTransitionReservation",
          selected: expect.any(Object)
        },
        taskId: taskA
      }],
      reservedTaskIds: [taskA]
    })
  }))

it("orders owned work by earliest outstanding journal position before task identity", () => {
  const laterA = {
    ...executionResponsibilityFor(taskA, "task-A-later"),
    beganAt: JournalPosition.make(3)
  }
  const earliestA = executionResponsibilityFor(taskA, "task-A-earliest")
  const middleB = {
    ...executionResponsibilityFor(taskB),
    beganAt: JournalPosition.make(1)
  }
  const frontier = deriveRunnableFrontier({
    freshEligibleTasks: [],
    responsibility: WorkflowResponsibilityState.make({
      entries: [laterA, earliestA, middleB]
    }),
    responsibilityFacts: [laterA, earliestA, middleB].map((responsibility) => ({
      disposition: ResponsibilityDisposition.Ready(),
      responsibility
    }))
  })

  expect(frontier.transitions.map(({ taskId }) => taskId)).toEqual([
    taskA,
    taskB,
    taskA
  ])
})

it.effect("gives a resumed responsibility the next released position before fresh work", () =>
  Effect.gen(function*() {
    const responsibility = executionResponsibilityFor(taskA)
    const responsibilityState = WorkflowResponsibilityState.make({
      entries: [responsibility]
    })
    const pausedFrontier = deriveRunnableFrontier({
      freshEligibleTasks: [freshTask(taskD)],
      responsibility: responsibilityState,
      responsibilityFacts: [{
        disposition: ResponsibilityDisposition.Paused(),
        responsibility
      }]
    })
    const resumedFrontier = deriveRunnableFrontier({
      freshEligibleTasks: [freshTask(taskD)],
      responsibility: responsibilityState,
      responsibilityFacts: [{
        disposition: ResponsibilityDisposition.Ready(),
        responsibility
      }]
    })
    for (const occupiedTaskIds of [[taskB], [taskB, taskC]]) {
      const controller = yield* makeTaskAdmissionController({
        capacity: TaskWorkCapacity.make(occupiedTaskIds.length),
        freshOccupiedInvocations: occupiedTaskIds.map((occupiedTaskId) => ({
          observationId: ProviderObservationId.make(`${occupiedTaskId}-running`),
          operationId: OperationId.make(`execute-${occupiedTaskId}`),
          taskId: occupiedTaskId
        })),
        reconstructedReservedPositions: []
      })
      const restartedController = yield* makeTaskAdmissionController({
        capacity: TaskWorkCapacity.make(occupiedTaskIds.length),
        freshOccupiedInvocations: occupiedTaskIds.map((occupiedTaskId) => ({
          observationId: ProviderObservationId.make(`${occupiedTaskId}-running`),
          operationId: OperationId.make(`execute-${occupiedTaskId}`),
          taskId: occupiedTaskId
        })),
        reconstructedReservedPositions: []
      })
      expect(
        admittedTransitions(yield* controller.admit(pausedFrontier, frontierRunId))
      ).toEqual([])
      const whileBusy = yield* controller.admit(resumedFrontier, frontierRunId)
      const restartedWhileBusy = yield* restartedController.admit(resumedFrontier, frontierRunId)
      expect(restartedWhileBusy).toEqual(whileBusy)
      expect(admittedTransitions(whileBusy)).toEqual([])
      expect(whileBusy.explanations).toContainEqual({
        _tag: "CapacityWait",
        taskId: taskA,
        wakeCondition: "CapacityReleasedOrReconstructedStateChanged"
      })

      yield* controller.applyFreshInvocationObservation({
        _tag: "FreshCapacityReleased",
        observationId: ProviderObservationId.make("task-B-stopped"),
        operationId: OperationId.make("execute-task-B"),
        taskId: taskB
      })
      yield* restartedController.applyFreshInvocationObservation({
        _tag: "FreshCapacityReleased",
        observationId: ProviderObservationId.make("task-B-stopped"),
        operationId: OperationId.make("execute-task-B"),
        taskId: taskB
      })
      const afterInterruption = yield* controller.admit(resumedFrontier, frontierRunId)
      expect(yield* restartedController.admit(resumedFrontier, frontierRunId)).toEqual(afterInterruption)
      expect(admittedTransitions(afterInterruption)).toEqual([
        {
          _tag: "ContinueTaskExecution",
          operationId: "execute-task-A",
          taskId: taskA
        }
      ])
    }
  }))

it.effect("continues independent work for each local constraint at capacities one and two", () =>
  Effect.gen(function*() {
    const responsibility = executionResponsibilityFor(taskA)
    const constraints = [
      ResponsibilityDisposition.Paused(),
      ResponsibilityDisposition.DependencyWait({
        prerequisiteTaskIds: [taskB]
      }),
      ResponsibilityDisposition.ForeignClaimIsolation(),
      ResponsibilityDisposition.UnreadableFactWait({
        boundary: "TaskTracker"
      })
    ]
    for (const capacity of [1, 2]) {
      for (const disposition of constraints) {
        const frontier = deriveRunnableFrontier({
          freshEligibleTasks: [freshTask(taskC)],
          responsibility: WorkflowResponsibilityState.make({
            entries: [responsibility]
          }),
          responsibilityFacts: [{
            disposition,
            responsibility
          }]
        })
        const controller = yield* makeTaskAdmissionController({
          capacity: TaskWorkCapacity.make(capacity),
          freshOccupiedInvocations: [],
          reconstructedReservedPositions: []
        })
        expect(
          admittedTransitions(yield* controller.admit(frontier, frontierRunId))
        ).toEqual([
          { _tag: "CommitFreshTaskClaimIntent", ...freshTask(taskC) }
        ])
      }
    }
  }))

it("explains every non-runnable responsibility without treating quiescence as termination", () => {
  const responsibility = executionResponsibilityFor(taskA)
  const state = WorkflowResponsibilityState.make({
    entries: [responsibility]
  })
  const dispositions = [
    ResponsibilityDisposition.Paused(),
    ResponsibilityDisposition.DependencyWait({
      prerequisiteTaskIds: [taskB]
    }),
    ResponsibilityDisposition.ForeignClaimIsolation(),
    ResponsibilityDisposition.UnreadableFactWait({
      boundary: "TaskWorkProvider"
    }),
    ResponsibilityDisposition.Relinquished({ reason: "AuthorizedHandoff" }),
    ResponsibilityDisposition.Settled({ outcome: "TrackerCompleted" }),
    ResponsibilityDisposition.FinalOutcome({ outcome: "Failed" })
  ]

  const frontiers = dispositions.map((disposition) =>
    deriveRunnableFrontier({
      freshEligibleTasks: [],
      responsibility: state,
      responsibilityFacts: [{
        disposition,
        responsibility
      }]
    })
  )
  expect(frontiers).toEqual([
    expect.objectContaining({
      explanations: [{
        _tag: "Pause",
        operationId: "execute-task-A",
        taskId: taskA
      }]
    }),
    expect.objectContaining({
      explanations: [{
        _tag: "DependencyWait",
        operationId: "execute-task-A",
        prerequisiteTaskIds: [taskB],
        taskId: taskA,
        wakeCondition: "TaskGraphFactsUpdated"
      }]
    }),
    expect.objectContaining({
      explanations: [{
        _tag: "Isolation",
        operationId: "execute-task-A",
        reason: "ForeignClaim",
        taskId: taskA
      }]
    }),
    expect.objectContaining({
      explanations: [{
        _tag: "UnreadableFactWait",
        boundary: "TaskWorkProvider",
        operationId: "execute-task-A",
        taskId: taskA,
        wakeCondition: "BoundaryRereadSucceeded"
      }]
    }),
    expect.objectContaining({
      explanations: [{
        _tag: "Relinquishment",
        operationId: "execute-task-A",
        reason: "AuthorizedHandoff",
        taskId: taskA
      }]
    }),
    expect.objectContaining({
      explanations: [{
        _tag: "Settlement",
        operationId: "execute-task-A",
        outcome: "TrackerCompleted",
        taskId: taskA
      }]
    }),
    expect.objectContaining({
      explanations: [{
        _tag: "FinalOutcome",
        operationId: "execute-task-A",
        outcome: "Failed",
        taskId: taskA
      }]
    })
  ])
  expect(frontiers.map((frontier) => deriveRunFinalityDecision(frontier, state, true))).toEqual([
    ...dispositions.slice(0, 4).map(() => ({
      _tag: "RunMustRemainActive",
      reason: "UnsettledResponsibility"
    })),
    ...dispositions.slice(4).map(() => ({ _tag: "RunMayTerminate" }))
  ])
  expect(deriveRunFinalityDecision(
    { explanations: [], transitions: [] },
    WorkflowResponsibilityState.make({ entries: [] }),
    false
  )).toEqual({
    _tag: "RunMustRemainActive",
    reason: "TrackerTargetUnsettled"
  })
  expect(deriveRunFinalityDecision(
    {
      explanations: [],
      transitions: [{
        _tag: "CommitFreshTaskClaimIntent",
        ...freshTask(taskA)
      }]
    },
    WorkflowResponsibilityState.make({ entries: [] }),
    true
  )).toEqual({
    _tag: "RunMustRemainActive",
    reason: "RunnableTransition"
  })
  expect(deriveRunFinalityDecision(
    { explanations: [], transitions: [] },
    WorkflowResponsibilityState.make({ entries: [] }),
    true
  )).toEqual({ _tag: "RunMayTerminate" })
})
