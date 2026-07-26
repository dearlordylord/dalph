import { it } from "@effect/vitest"
import { Effect } from "effect"
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
  TaskWorkCapacity,
  TaskWorkSessionId,
  TaskWorkSessionLocator,
  WorktreeLocator
} from "./domain.js"
import { WorkflowResponsibilityEntry, WorkflowResponsibilityState } from "./reconstructed-managed-run-state.js"
import { deriveRunFinalityDecision, deriveRunnableFrontier, ResponsibilityDisposition } from "./runnable-frontier.js"
import { makeTaskAdmissionController } from "./task-admission-controller.js"
import { taskRevisionFor } from "./task-dag.js"
import { TaskExecutionRequest, TaskExecutionSessionBinding } from "./task-execution.js"
import { makeTaskExecutionOperation } from "./workflow-operation.js"

const taskA = TaskId.make("task-A")
const taskB = TaskId.make("task-B")
const taskC = TaskId.make("task-C")
const taskD = TaskId.make("task-D")

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
      freshEligibleTaskIds: [taskB, taskA],
      responsibility: WorkflowResponsibilityState.make({ entries: [] }),
      responsibilityFacts: []
    })
    const controller = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(1),
      freshOccupiedInvocations: [],
      reconstructedReservedTaskIds: []
    })

    const admission = yield* controller.admit(frontier)

    expect(frontier.transitions.map(({ taskId }) => taskId)).toEqual([
      taskA,
      taskB
    ])
    expect(admission.transitions).toEqual([
      {
        _tag: "CommitFreshTaskClaimIntent",
        taskId: taskA
      }
    ])
    expect(yield* controller.snapshot()).toEqual({
      capacity: 1,
      occupied: [],
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
    freshEligibleTaskIds: [],
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
      freshEligibleTaskIds: [taskD],
      responsibility: responsibilityState,
      responsibilityFacts: [{
        disposition: ResponsibilityDisposition.Paused(),
        responsibility
      }]
    })
    const resumedFrontier = deriveRunnableFrontier({
      freshEligibleTaskIds: [taskD],
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
        reconstructedReservedTaskIds: []
      })
      const restartedController = yield* makeTaskAdmissionController({
        capacity: TaskWorkCapacity.make(occupiedTaskIds.length),
        freshOccupiedInvocations: occupiedTaskIds.map((occupiedTaskId) => ({
          observationId: ProviderObservationId.make(`${occupiedTaskId}-running`),
          operationId: OperationId.make(`execute-${occupiedTaskId}`),
          taskId: occupiedTaskId
        })),
        reconstructedReservedTaskIds: []
      })
      expect((yield* controller.admit(pausedFrontier)).transitions).toEqual([])
      const whileBusy = yield* controller.admit(resumedFrontier)
      const restartedWhileBusy = yield* restartedController.admit(resumedFrontier)
      expect(restartedWhileBusy).toEqual(whileBusy)
      expect(whileBusy.transitions).toEqual([])
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
      const afterInterruption = yield* controller.admit(resumedFrontier)
      expect(yield* restartedController.admit(resumedFrontier)).toEqual(afterInterruption)
      expect(afterInterruption.transitions).toEqual([
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
          freshEligibleTaskIds: [taskC],
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
          reconstructedReservedTaskIds: []
        })
        expect((yield* controller.admit(frontier)).transitions).toEqual([
          { _tag: "CommitFreshTaskClaimIntent", taskId: taskC }
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
      freshEligibleTaskIds: [],
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
        taskId: taskA
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
