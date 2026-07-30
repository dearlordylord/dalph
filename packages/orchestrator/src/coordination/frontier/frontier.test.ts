import { it } from "@effect/vitest"
import { Effect, Option } from "effect"
import { expect } from "vitest"
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
  PlannedAttemptExecutorReport,
  PlannedAttemptExecutorResult
} from "@dalph/contracts"
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { OperationId } from "../../workflow/identity.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { WorkflowResponsibilityEntry, WorkflowResponsibilityState } from "../reconstruction/state.js"
import {
  deriveRunFinalityDecision,
  deriveRunnableFrontier,
  ResponsibilityDisposition,
  RunnableFrontierTransition,
  runnableTransitionTaskId
} from "./frontier.js"
import { makeSelectedTransitionIdentity } from "../activation/selected-transition.js"
import { makeTaskAdmissionController, type NextAdmissionDecision } from "../admission/controller.js"
import { TaskClaimAcquisition } from "../../authorities/task-tracker/claim-mutation.js"
import { makeTaskWorktreeReconciliationOperation } from "../../workflow/registry/operation.js"

const taskA = TaskId.make("task-A")
const taskB = TaskId.make("task-B")
const taskC = TaskId.make("task-C")
const taskD = TaskId.make("task-D")
const frontierRunId = RunId.make("frontier-test-run")
const freshTask = (taskId: TaskId) => ({ taskId, taskRevision: TaskRevision.make(`revision:${taskId}`) })

const admittedTransitions = (decision: NextAdmissionDecision): ReadonlyArray<RunnableFrontierTransition> =>
  Option.toArray(decision.transition)

const executionResponsibilityFor = (taskId: TaskId, operationIdentity: string = taskId) => {
  const plannedAttempt = PlannedTaskAttempt.make({
    attemptId: AttemptId.make(`attempt-${operationIdentity}`),
    baseSha: GitCommitSha.make("0123456789abcdef0123456789abcdef01234567"),
    branch: TaskBranchRef.make(`refs/heads/dalph/${operationIdentity}`),
    executor: TaskExecutorLocator.make("executor:controlled-fake"),
    runId: frontierRunId,
    taskId,
    taskRevision: TaskRevision.make(`revision:${taskId}`),
    worktree: WorktreeLocator.make(`/tmp/dalph-${operationIdentity}`)
  })
  return WorkflowResponsibilityEntry.cases.PlannedAttemptExecutorWorkResponsibility.make({
    beganAt: JournalPosition.make(1),
    plannedAttempt
  })
}

const operationResponsibilityFor = (taskId: TaskId) =>
  WorkflowResponsibilityEntry.cases.TaskClaimResponsibility.make({
    acquisition: TaskClaimAcquisition.make({
      operationId: OperationId.make(`execute-${taskId}`),
      owner: ClaimOwner.make("frontier-test-owner"),
      taskId,
      token: ClaimToken.make("frontier-test-token")
    }),
    beganAt: JournalPosition.make(1),
    taskId
  })

it.effect("admits only the canonical first fresh task when one position is available", () =>
  Effect.gen(function* () {
    const frontier = deriveRunnableFrontier({
      freshEligibleTasks: [freshTask(taskB), freshTask(taskA)],
      responsibility: WorkflowResponsibilityState.make({ entries: [] }),
      responsibilityFacts: []
    })
    const controller = yield* makeTaskAdmissionController({ capacity: TaskWorkCapacity.make(1) })

    const admission = yield* controller.admit(frontier, frontierRunId)

    expect(frontier.transitions.map(runnableTransitionTaskId)).toEqual([taskA, taskB])
    expect(admittedTransitions(admission)).toEqual([{ _tag: "CommitFreshTaskClaimIntent", ...freshTask(taskA) }])
    expect(yield* controller.snapshot()).toEqual({
      capacity: 1,
      reservedPositions: [
        { correlation: { _tag: "SelectedTransitionReservation", selected: expect.any(Object) }, taskId: taskA }
      ],
      reservedTaskIds: [taskA]
    })
  })
)

it("orders owned work by earliest outstanding journal position before task identity", () => {
  const laterA = { ...executionResponsibilityFor(taskA, "task-A-later"), beganAt: JournalPosition.make(3) }
  const earliestA = executionResponsibilityFor(taskA, "task-A-earliest")
  const middleB = { ...executionResponsibilityFor(taskB), beganAt: JournalPosition.make(1) }
  const frontier = deriveRunnableFrontier({
    freshEligibleTasks: [],
    responsibility: WorkflowResponsibilityState.make({ entries: [laterA, earliestA, middleB] }),
    responsibilityFacts: [laterA, earliestA, middleB].map((responsibility) => ({
      _tag: "PlannedAttemptExecutorFreshFacts" as const,
      disposition: ResponsibilityDisposition.Ready(),
      responsibility
    }))
  })

  expect(frontier.transitions.map(runnableTransitionTaskId)).toEqual([taskA, taskB, taskA])
})

it("retains a terminal executor report for the exact planned attempt", () => {
  const responsibility = executionResponsibilityFor(taskA)
  const report = PlannedAttemptExecutorReport.cases.Terminal.make({
    correlation: { attemptId: responsibility.plannedAttempt.attemptId, runId: responsibility.plannedAttempt.runId },
    result: PlannedAttemptExecutorResult.cases.Failed.make({})
  })
  const frontier = deriveRunnableFrontier({
    freshEligibleTasks: [],
    responsibility: WorkflowResponsibilityState.make({ entries: [responsibility] }),
    responsibilityFacts: [
      {
        _tag: "PlannedAttemptExecutorFreshFacts",
        disposition: ResponsibilityDisposition.PlannedAttemptExecutorWorkTerminal({ report }),
        responsibility
      }
    ]
  })

  expect(frontier).toEqual({
    explanations: [{ _tag: "PlannedAttemptExecutorWorkTerminal", report, taskId: taskA }],
    transitions: []
  })
  expect(
    deriveRunFinalityDecision(frontier, WorkflowResponsibilityState.make({ entries: [responsibility] }), true)
  ).toEqual({ _tag: "RunMayTerminate" })
})

it.effect("gives a resumed responsibility the next released position before fresh work", () =>
  Effect.gen(function* () {
    const responsibility = executionResponsibilityFor(taskA)
    const responsibilityState = WorkflowResponsibilityState.make({ entries: [responsibility] })
    const pausedFrontier = deriveRunnableFrontier({
      freshEligibleTasks: [freshTask(taskD)],
      responsibility: responsibilityState,
      responsibilityFacts: [
        {
          _tag: "PlannedAttemptExecutorFreshFacts",
          disposition: ResponsibilityDisposition.PlannedAttemptExecutorWorkSafelySuspended({
            correlation: {
              attemptId: responsibility.plannedAttempt.attemptId,
              runId: responsibility.plannedAttempt.runId
            }
          }),
          responsibility
        }
      ]
    })
    const resumedFrontier = deriveRunnableFrontier({
      freshEligibleTasks: [freshTask(taskD)],
      responsibility: responsibilityState,
      responsibilityFacts: [
        { _tag: "PlannedAttemptExecutorFreshFacts", disposition: ResponsibilityDisposition.Ready(), responsibility }
      ]
    })
    for (const occupiedTaskIds of [[taskB], [taskB, taskC]]) {
      const controller = yield* makeTaskAdmissionController({
        capacity: TaskWorkCapacity.make(occupiedTaskIds.length),
        reconstructedPlannedAttemptPositions: occupiedTaskIds.map((taskId) => ({
          attemptId: AttemptId.make(`occupied-${taskId}`),
          runId: frontierRunId,
          taskId
        }))
      })
      const restartedController = yield* makeTaskAdmissionController({
        capacity: TaskWorkCapacity.make(occupiedTaskIds.length),
        reconstructedPlannedAttemptPositions: occupiedTaskIds.map((taskId) => ({
          attemptId: AttemptId.make(`occupied-${taskId}`),
          runId: frontierRunId,
          taskId
        }))
      })
      expect(admittedTransitions(yield* controller.admit(pausedFrontier, frontierRunId))).toEqual([])
      const whileBusy = yield* controller.admit(resumedFrontier, frontierRunId)
      const restartedWhileBusy = yield* restartedController.admit(resumedFrontier, frontierRunId)
      expect(restartedWhileBusy).toEqual(whileBusy)
      expect(admittedTransitions(whileBusy)).toEqual([])
      expect(whileBusy.explanations).toContainEqual({
        _tag: "CapacityWait",
        taskId: taskA,
        wakeCondition: "CapacityReleasedOrReconstructedStateChanged"
      })

      yield* controller.releasePlannedAttemptPosition({
        attemptId: AttemptId.make(`occupied-${taskB}`),
        runId: frontierRunId
      })
      yield* restartedController.releasePlannedAttemptPosition({
        attemptId: AttemptId.make(`occupied-${taskB}`),
        runId: frontierRunId
      })
      const afterInterruption = yield* controller.admit(resumedFrontier, frontierRunId)
      expect(yield* restartedController.admit(resumedFrontier, frontierRunId)).toEqual(afterInterruption)
      expect(admittedTransitions(afterInterruption)).toEqual([
        { _tag: "ContinuePlannedAttemptExecutorWork", plannedAttempt: responsibility.plannedAttempt }
      ])
    }
  })
)

it.effect("continues independent work for each local constraint at capacities one and two", () =>
  Effect.gen(function* () {
    const responsibility = operationResponsibilityFor(taskA)
    const constraints = [
      ResponsibilityDisposition.Paused(),
      ResponsibilityDisposition.DependencyWait({ prerequisiteTaskIds: [taskB] }),
      ResponsibilityDisposition.ForeignClaimIsolation(),
      ResponsibilityDisposition.UnreadableFactWait({ boundary: "TaskTracker" })
    ]
    for (const capacity of [1, 2]) {
      for (const disposition of constraints) {
        const frontier = deriveRunnableFrontier({
          freshEligibleTasks: [freshTask(taskC)],
          responsibility: WorkflowResponsibilityState.make({ entries: [responsibility] }),
          responsibilityFacts: [{ _tag: "WorkflowOperationFreshFacts", disposition, responsibility }]
        })
        const controller = yield* makeTaskAdmissionController({ capacity: TaskWorkCapacity.make(capacity) })
        expect(admittedTransitions(yield* controller.admit(frontier, frontierRunId))).toEqual([
          { _tag: "CommitFreshTaskClaimIntent", ...freshTask(taskC) }
        ])
      }
    }
  })
)

it("explains every non-runnable responsibility without treating quiescence as termination", () => {
  const responsibility = operationResponsibilityFor(taskA)
  const state = WorkflowResponsibilityState.make({ entries: [responsibility] })
  const dispositions = [
    ResponsibilityDisposition.Paused(),
    ResponsibilityDisposition.DependencyWait({ prerequisiteTaskIds: [taskB] }),
    ResponsibilityDisposition.ForeignClaimIsolation(),
    ResponsibilityDisposition.UnreadableFactWait({ boundary: "Executor" }),
    ResponsibilityDisposition.Relinquished({ reason: "AuthorizedHandoff" }),
    ResponsibilityDisposition.Settled({ outcome: "TrackerCompleted" }),
    ResponsibilityDisposition.FinalOutcome({ outcome: "Failed" })
  ]

  const frontiers = dispositions.map((disposition) =>
    deriveRunnableFrontier({
      freshEligibleTasks: [],
      responsibility: state,
      responsibilityFacts: [{ _tag: "WorkflowOperationFreshFacts", disposition, responsibility }]
    })
  )
  expect(frontiers).toEqual([
    expect.objectContaining({ explanations: [{ _tag: "Pause", operationId: "execute-task-A", taskId: taskA }] }),
    expect.objectContaining({
      explanations: [
        {
          _tag: "DependencyWait",
          operationId: "execute-task-A",
          prerequisiteTaskIds: [taskB],
          taskId: taskA,
          wakeCondition: "TaskTrackerFactsObserved"
        }
      ]
    }),
    expect.objectContaining({
      explanations: [{ _tag: "Isolation", operationId: "execute-task-A", reason: "ForeignClaim", taskId: taskA }]
    }),
    expect.objectContaining({
      explanations: [
        {
          _tag: "UnreadableFactWait",
          boundary: "Executor",
          operationId: "execute-task-A",
          taskId: taskA,
          wakeCondition: "BoundaryRereadSucceeded"
        }
      ]
    }),
    expect.objectContaining({
      explanations: [
        { _tag: "Relinquishment", operationId: "execute-task-A", reason: "AuthorizedHandoff", taskId: taskA }
      ]
    }),
    expect.objectContaining({
      explanations: [{ _tag: "Settlement", operationId: "execute-task-A", outcome: "TrackerCompleted", taskId: taskA }]
    }),
    expect.objectContaining({
      explanations: [{ _tag: "FinalOutcome", operationId: "execute-task-A", outcome: "Failed", taskId: taskA }]
    })
  ])
  expect(frontiers.map((frontier) => deriveRunFinalityDecision(frontier, state, true))).toEqual([
    ...dispositions.slice(0, 4).map(() => ({ _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" })),
    ...dispositions.slice(4).map(() => ({ _tag: "RunMayTerminate" }))
  ])
  expect(
    deriveRunFinalityDecision(
      { explanations: [], transitions: [] },
      WorkflowResponsibilityState.make({ entries: [] }),
      false
    )
  ).toEqual({ _tag: "RunMustRemainActive", reason: "TrackerTargetUnsettled" })
  expect(
    deriveRunFinalityDecision(
      { explanations: [], transitions: [{ _tag: "CommitFreshTaskClaimIntent", ...freshTask(taskA) }] },
      WorkflowResponsibilityState.make({ entries: [] }),
      true
    )
  ).toEqual({ _tag: "RunMustRemainActive", reason: "RunnableTransition" })
  expect(
    deriveRunFinalityDecision(
      { explanations: [], transitions: [] },
      WorkflowResponsibilityState.make({ entries: [] }),
      true
    )
  ).toEqual({ _tag: "RunMayTerminate" })
})

it("maps every journaled responsibility and executor pause disposition", () => {
  const claimResponsibility = operationResponsibilityFor(taskA)
  const executorResponsibility = executionResponsibilityFor(taskB)
  const worktreeResponsibility = WorkflowResponsibilityEntry.cases.TaskWorktreeResponsibility.make({
    beganAt: JournalPosition.make(2),
    operation: makeTaskWorktreeReconciliationOperation({
      operationId: OperationId.make("worktree-task-C"),
      plannedAttempt: executionResponsibilityFor(taskC).plannedAttempt,
      predecessorOperationIds: []
    }),
    taskId: taskC
  })
  const facts = [
    {
      _tag: "WorkflowOperationFreshFacts" as const,
      disposition: ResponsibilityDisposition.Ready(),
      responsibility: claimResponsibility
    },
    {
      _tag: "WorkflowOperationFreshFacts" as const,
      disposition: ResponsibilityDisposition.Ready(),
      responsibility: worktreeResponsibility
    },
    {
      _tag: "PlannedAttemptExecutorFreshFacts" as const,
      disposition: ResponsibilityDisposition.PlannedAttemptExecutorSuspensionRequested(),
      responsibility: executorResponsibility
    }
  ]
  expect(
    deriveRunnableFrontier({
      freshEligibleTasks: [],
      responsibility: WorkflowResponsibilityState.make({ entries: facts.map(({ responsibility }) => responsibility) }),
      responsibilityFacts: facts
    }).transitions.map(({ _tag }) => _tag)
  ).toEqual(["CheckTaskClaim", "SuspendPlannedAttemptExecutorWork", "ReconcileTaskWorktree"])

  expect(
    deriveRunnableFrontier({
      freshEligibleTasks: [],
      responsibility: WorkflowResponsibilityState.make({ entries: [claimResponsibility] }),
      responsibilityFacts: [
        {
          _tag: "WorkflowOperationFreshFacts",
          disposition: ResponsibilityDisposition.MissingClaim(),
          responsibility: claimResponsibility
        }
      ]
    }).transitions
  ).toEqual([{ _tag: "ReconcileTaskClaim", operationId: claimResponsibility.acquisition.operationId, taskId: taskA }])
})

it("reports missing and duplicate fresh facts for operation and executor responsibilities", () => {
  const claim = operationResponsibilityFor(taskA)
  const executor = executionResponsibilityFor(taskB)
  for (const responsibility of [claim, executor]) {
    const state = WorkflowResponsibilityState.make({ entries: [responsibility] })
    const missing = deriveRunnableFrontier({ freshEligibleTasks: [], responsibility: state, responsibilityFacts: [] })
    const fact =
      responsibility._tag === "PlannedAttemptExecutorWorkResponsibility"
        ? {
            _tag: "PlannedAttemptExecutorFreshFacts" as const,
            disposition: ResponsibilityDisposition.Ready(),
            responsibility
          }
        : {
            _tag: "WorkflowOperationFreshFacts" as const,
            disposition: ResponsibilityDisposition.Ready(),
            responsibility
          }
    const duplicate = deriveRunnableFrontier({
      freshEligibleTasks: [],
      responsibility: state,
      responsibilityFacts: [fact, fact]
    })
    expect(missing.explanations[0]).toMatchObject({ reason: "MissingFreshFacts" })
    expect(duplicate.explanations[0]).toMatchObject({ reason: "DuplicateFreshFacts" })
  }
})

it("keeps a removed task's executor responsibility behind a task-membership constraint", () => {
  const responsibility = executionResponsibilityFor(taskA)
  expect(
    deriveRunnableFrontier({
      freshEligibleTasks: [],
      responsibility: WorkflowResponsibilityState.make({ entries: [responsibility] }),
      responsibilityFacts: [
        {
          _tag: "PlannedAttemptExecutorFreshFacts",
          disposition: ResponsibilityDisposition.TaskMembershipConstraint(),
          responsibility
        }
      ]
    })
  ).toEqual({
    explanations: [
      {
        _tag: "PlannedAttemptTaskMembershipConstraint",
        correlation: { attemptId: responsibility.plannedAttempt.attemptId, runId: responsibility.plannedAttempt.runId },
        taskId: taskA,
        wakeCondition: "TaskTrackerFactsObserved"
      }
    ],
    transitions: []
  })
})

it.effect("rejects binding, cancellation, and release for positions it does not own", () =>
  Effect.gen(function* () {
    const controller = yield* makeTaskAdmissionController({ capacity: TaskWorkCapacity.make(1) })
    const responsibility = executionResponsibilityFor(taskA)
    const transition = RunnableFrontierTransition.ContinuePlannedAttemptExecutorWork({
      plannedAttempt: responsibility.plannedAttempt
    })
    const selected = makeSelectedTransitionIdentity(frontierRunId, transition)
    expect(
      (yield* controller
        .bindPlannedAttemptPosition(selected, {
          attemptId: responsibility.plannedAttempt.attemptId,
          runId: frontierRunId
        })
        .pipe(Effect.flip))._tag
    ).toBe("PlannedAttemptPositionBindingIssue")
    expect((yield* controller.cancelReservedPosition(selected).pipe(Effect.flip))._tag).toBe(
      "TaskAdmissionPositionCancellationIssue"
    )
    expect(
      (yield* controller
        .releasePlannedAttemptPosition({ attemptId: responsibility.plannedAttempt.attemptId, runId: frontierRunId })
        .pipe(Effect.flip))._tag
    ).toBe("PlannedAttemptPositionReleaseIssue")
  })
)

it.effect("binds the selected task when another task already names the same planned attempt", () =>
  Effect.gen(function* () {
    const correlation = { attemptId: AttemptId.make("shared-attempt"), runId: frontierRunId }
    const controller = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(2),
      reconstructedPlannedAttemptPositions: [{ ...correlation, taskId: taskB }]
    })
    const transition = RunnableFrontierTransition.CommitFreshTaskClaimIntent({
      taskId: taskA,
      taskRevision: TaskRevision.make("task-A-revision")
    })
    yield* controller.admit({ explanations: [], transitions: [transition] }, frontierRunId)
    yield* controller.bindPlannedAttemptPosition(makeSelectedTransitionIdentity(frontierRunId, transition), correlation)

    expect((yield* controller.snapshot()).reservedPositions).toEqual([
      { correlation: { _tag: "PlannedAttemptReservation", ...correlation }, taskId: taskA },
      { correlation: { _tag: "PlannedAttemptReservation", ...correlation }, taskId: taskB }
    ])
  })
)
