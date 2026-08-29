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
  PlannedAttemptExecutorReport,
  PlannedAttemptExecutorResult,
  plannedAttemptExecutorCorrelation
} from "@dalph/contracts"
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { OperationId } from "../../workflow/identity.js"
import { WorkflowResponsibilityEntry, WorkflowResponsibilityState } from "../reconstruction/state.js"
import {
  deriveRunFinalityDecision,
  deriveRunnableFrontier,
  ResponsibilityDisposition,
  RunnableFrontierTransition,
  runnableTransitionTaskId
} from "./frontier.js"
import { ActiveTaskClaim, TaskClaimAcquisition } from "../../authorities/task-tracker/claim-mutation.js"
import {
  makeTaskClaimReleaseOperation,
  makeTaskWorktreeReconciliationOperation,
  TaskClaimReleaseAuthority
} from "../../workflow/registry/operation.js"

const taskA = TaskId.make("task-A")
const taskB = TaskId.make("task-B")
const taskC = TaskId.make("task-C")
const frontierRunId = RunId.make("frontier-test-run")
const freshTask = (taskId: TaskId) => ({ taskId, taskRevision: TaskRevision.make(`revision:${taskId}`) })

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

it("orders fresh tasks canonically before runtime admission", () => {
  const frontier = deriveRunnableFrontier({
    freshEligibleTasks: [freshTask(taskB), freshTask(taskA)],
    responsibility: WorkflowResponsibilityState.make({ entries: [] }),
    responsibilityFacts: []
  })

  expect(frontier.transitions.map(runnableTransitionTaskId)).toEqual([taskA, taskB])
})

it("orders owned work by earliest outstanding journal position before task identity", () => {
  const laterA = { ...executionResponsibilityFor(taskA, "task-A-later"), beganAt: JournalPosition.make(3) }
  const earliestA = executionResponsibilityFor(taskA, "task-A-earliest")
  const middleB = { ...executionResponsibilityFor(taskB), beganAt: JournalPosition.make(1) }
  const frontier = deriveRunnableFrontier({
    freshEligibleTasks: [],
    responsibility: WorkflowResponsibilityState.make({ entries: [laterA, earliestA, middleB] }),
    responsibilityFacts: [laterA, earliestA, middleB].map((responsibility) => ({
      _tag: "PlannedAttemptExecutorFreshFacts" as const,
      disposition: {
        _tag: "Ready" as const,
        acceptedProgress: { _tag: "ExecutorResponsibilityBegan" as const, acceptedAt: responsibility.beganAt }
      },
      responsibility
    }))
  })

  expect(frontier.transitions.map(runnableTransitionTaskId)).toEqual([taskA, taskB, taskA])
})

it("reconciles an already-intended exact claim release as its own responsibility", () => {
  const claim = ActiveTaskClaim.make({
    operationId: OperationId.make("frontier-release-acquisition"),
    owner: ClaimOwner.make("frontier-release-owner"),
    taskId: taskA,
    token: ClaimToken.make("frontier-release-token")
  })
  const operation = makeTaskClaimReleaseOperation({
    authority: TaskClaimReleaseAuthority.cases.WorkflowClaimReleaseAuthority.make({}),
    predecessorOperationIds: [claim.operationId],
    release: { claim, operationId: OperationId.make("frontier-release") }
  })
  const responsibility = WorkflowResponsibilityEntry.cases.TaskClaimReleaseResponsibility.make({
    beganAt: JournalPosition.make(2),
    operation,
    taskId: taskA
  })

  expect(
    deriveRunnableFrontier({
      freshEligibleTasks: [],
      responsibility: WorkflowResponsibilityState.make({ entries: [responsibility] }),
      responsibilityFacts: [
        { _tag: "WorkflowOperationFreshFacts", disposition: ResponsibilityDisposition.Ready(), responsibility }
      ]
    }).transitions
  ).toEqual([
    RunnableFrontierTransition.ReconcileTaskClaimRelease({ operationId: operation.release.operationId, taskId: taskA })
  ])
})

it("retains a terminal executor report for the exact planned attempt", () => {
  const responsibility = executionResponsibilityFor(taskA)
  const report = PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
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

it("keeps stopped-attempt claim release waits visible without proposing another boundary call", () => {
  const responsibility = executionResponsibilityFor(taskA)
  const operationId = OperationId.make("stopped-attempt-release")

  const releasePending = deriveRunnableFrontier({
    freshEligibleTasks: [],
    responsibility: WorkflowResponsibilityState.make({ entries: [responsibility] }),
    responsibilityFacts: [
      {
        _tag: "PlannedAttemptExecutorFreshFacts",
        disposition: ResponsibilityDisposition.StoppedAttemptClaimReleasePending({ operationId }),
        responsibility
      }
    ]
  })
  const planningWait = deriveRunnableFrontier({
    freshEligibleTasks: [],
    responsibility: WorkflowResponsibilityState.make({ entries: [responsibility] }),
    responsibilityFacts: [
      {
        _tag: "PlannedAttemptExecutorFreshFacts",
        disposition: ResponsibilityDisposition.StoppedAttemptClaimPlanningWait({ reason: "TrackerTargetUnavailable" }),
        responsibility
      }
    ]
  })

  expect(releasePending).toMatchObject({
    explanations: [{ _tag: "StoppedAttemptClaimReleasePending", operationId }],
    transitions: []
  })
  expect(planningWait).toMatchObject({
    explanations: [{ _tag: "StoppedAttemptClaimPlanningWait", reason: "TrackerTargetUnavailable" }],
    transitions: []
  })
})

it("keeps delivery active for a non-terminal wait but accepts an externally settled attempt", () => {
  const responsibility = executionResponsibilityFor(taskA)
  const state = WorkflowResponsibilityState.make({ entries: [responsibility] })
  expect(
    deriveRunFinalityDecision(
      {
        explanations: [
          {
            _tag: "PlannedAttemptTaskLifecycleConstraint",
            correlation: plannedAttemptExecutorCorrelation(responsibility.plannedAttempt),
            lifecycle: "TerminalWithoutSuccess",
            taskId: taskA,
            wakeCondition: "TaskTrackerFactsObserved"
          }
        ],
        transitions: []
      },
      state,
      true
    )
  ).toEqual({ _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" })
  expect(
    deriveRunFinalityDecision(
      {
        explanations: [
          {
            _tag: "PlannedAttemptTaskExternalSuccessSettled",
            correlation: plannedAttemptExecutorCorrelation(responsibility.plannedAttempt),
            taskId: taskA
          }
        ],
        transitions: []
      },
      state,
      true
    )
  ).toEqual({ _tag: "RunMayTerminate" })
})

it("does not terminate an empty frontier while completion settlement is pending", () => {
  const responsibility = executionResponsibilityFor(taskA)
  const state = WorkflowResponsibilityState.make({ entries: [responsibility] })

  expect(
    deriveRunFinalityDecision(
      {
        explanations: [
          {
            _tag: "IntegrationFinalityTrackerSuccessWait",
            plannedAttempt: responsibility.plannedAttempt,
            reason: { _tag: "FocusedConfirmationNotObserved" },
            wakeCondition: "TaskTrackerFactsObserved"
          }
        ],
        transitions: []
      },
      state,
      true
    )
  ).toEqual({ _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" })
})

it("keeps independent fresh work runnable beside each local constraint", () => {
  const responsibility = operationResponsibilityFor(taskA)
  const constraints = [
    ResponsibilityDisposition.Paused(),
    ResponsibilityDisposition.DependencyWait({ prerequisiteTaskIds: [taskB] }),
    ResponsibilityDisposition.ForeignClaimIsolation(),
    ResponsibilityDisposition.UnreadableFactWait({ boundary: "TaskTracker" })
  ]
  for (const disposition of constraints) {
    const frontier = deriveRunnableFrontier({
      freshEligibleTasks: [freshTask(taskC)],
      responsibility: WorkflowResponsibilityState.make({ entries: [responsibility] }),
      responsibilityFacts: [{ _tag: "WorkflowOperationFreshFacts", disposition, responsibility }]
    })
    expect(frontier.transitions).toContainEqual({ _tag: "CommitFreshTaskClaimIntent", ...freshTask(taskC) })
  }
})

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
            disposition: {
              _tag: "Ready" as const,
              acceptedProgress: { _tag: "ExecutorResponsibilityBegan" as const, acceptedAt: responsibility.beganAt }
            },
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

it("explains missing, foreign, and unreadable claims without selecting task work", () => {
  const responsibility = executionResponsibilityFor(taskA)
  const dispositions = [
    ResponsibilityDisposition.TaskClaimMissingConstraint(),
    ResponsibilityDisposition.TaskForeignClaimIsolation(),
    ResponsibilityDisposition.TaskClaimUnreadableWait()
  ]
  expect(
    dispositions.map((disposition) =>
      deriveRunnableFrontier({
        freshEligibleTasks: [freshTask(taskC)],
        responsibility: WorkflowResponsibilityState.make({ entries: [responsibility] }),
        responsibilityFacts: [{ _tag: "PlannedAttemptExecutorFreshFacts", disposition, responsibility }]
      })
    )
  ).toEqual([
    {
      explanations: [
        {
          _tag: "PlannedAttemptTaskClaimConstraint",
          claimState: "Missing",
          correlation: plannedAttemptExecutorCorrelation(responsibility.plannedAttempt),
          taskId: taskA,
          wakeCondition: "ExplicitAppliedTaskClaimReacquisitionDirection"
        }
      ],
      transitions: [{ _tag: "CommitFreshTaskClaimIntent", ...freshTask(taskC) }]
    },
    {
      explanations: [
        {
          _tag: "PlannedAttemptTaskClaimConstraint",
          claimState: "Foreign",
          correlation: plannedAttemptExecutorCorrelation(responsibility.plannedAttempt),
          taskId: taskA,
          wakeCondition: "ExplicitAppliedTaskClaimReacquisitionDirection"
        }
      ],
      transitions: [{ _tag: "CommitFreshTaskClaimIntent", ...freshTask(taskC) }]
    },
    {
      explanations: [
        {
          _tag: "PlannedAttemptTaskClaimConstraint",
          claimState: "Unreadable",
          correlation: plannedAttemptExecutorCorrelation(responsibility.plannedAttempt),
          taskId: taskA,
          wakeCondition: "TaskClaimFactsObserved"
        }
      ],
      transitions: [{ _tag: "CommitFreshTaskClaimIntent", ...freshTask(taskC) }]
    }
  ])
})

it("explains each task-authority constraint without changing the planned attempt", () => {
  const responsibility = executionResponsibilityFor(taskA)
  const state = WorkflowResponsibilityState.make({ entries: [responsibility] })
  const correlation = { attemptId: responsibility.plannedAttempt.attemptId, runId: responsibility.plannedAttempt.runId }
  const changedFingerprint = TaskRevision.make("changed-authored-fingerprint")
  const cases = [
    {
      disposition: ResponsibilityDisposition.TaskLifecycleConstraint({ lifecycle: "TerminalWithoutSuccess" }),
      explanation: {
        _tag: "PlannedAttemptTaskLifecycleConstraint",
        correlation,
        lifecycle: "TerminalWithoutSuccess",
        taskId: taskA,
        wakeCondition: "TaskTrackerFactsObserved"
      }
    },
    {
      disposition: ResponsibilityDisposition.TaskExternalSuccessConstraint(),
      explanation: {
        _tag: "PlannedAttemptTaskExternalSuccessConstraint",
        correlation,
        taskId: taskA,
        wakeCondition: "ExactTaskClaimDispositionApplied"
      }
    },
    {
      disposition: ResponsibilityDisposition.TaskSpecificationChangeConstraint({
        observedFingerprint: changedFingerprint,
        plannedFingerprint: responsibility.plannedAttempt.taskRevision
      }),
      explanation: {
        _tag: "PlannedAttemptTaskSpecificationChangeConstraint",
        availableResolutions: ["ContinueExistingAttempt", "RestartTaskImplementation", "StopTaskImplementation"],
        correlation,
        observedFingerprint: changedFingerprint,
        plannedFingerprint: responsibility.plannedAttempt.taskRevision,
        taskId: taskA,
        wakeCondition: "TaskResolutionApplied"
      }
    }
  ] as const

  for (const { disposition, explanation } of cases) {
    expect(
      deriveRunnableFrontier({
        freshEligibleTasks: [],
        responsibility: state,
        responsibilityFacts: [{ _tag: "PlannedAttemptExecutorFreshFacts", disposition, responsibility }]
      })
    ).toEqual({ explanations: [explanation], transitions: [] })
  }
})
