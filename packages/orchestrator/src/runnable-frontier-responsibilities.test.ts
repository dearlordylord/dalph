import { it } from "@effect/vitest"
import { Effect, Option, Ref } from "effect"
import { expect } from "vitest"
import {
  AttemptId,
  ClaimOwner,
  ClaimToken,
  ExecutorOuterInvocationId,
  GitCommitSha,
  ImplementationReviewRoundLimit,
  JournalPosition,
  OperationId,
  PlannedTaskAttempt,
  ProviderObservationId,
  ReviewerSessionId,
  RunId,
  SemanticReviewRound,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskLifecycle,
  TaskRevision,
  TaskWorkCapacity,
  TaskWorkSessionId,
  TaskWorkSessionLocator,
  TechnicalRetryNotBefore,
  WorktreeLocator
} from "./domain.js"
import { ExecutorOuterInvocationWait, makeExecutorOuterInvocation } from "./executor-boundary.js"
import { EvidenceDigest, EvidenceReference } from "./implementation-evidence.js"
import {
  ImplementationReviewDisposition,
  ImplementationReviewRequest,
  ReviewFindingsHandbackRequest,
  SealedImplementationReview
} from "./implementation-review.js"
import { WorkflowResponsibilityEntry, WorkflowResponsibilityState } from "./reconstructed-managed-run-state.js"
import { deriveRunnableFrontier, ResponsibilityDisposition, RunnableFrontierTransition } from "./runnable-frontier.js"
import { makeSelectedTransitionIdentity } from "./selected-transition.js"
import {
  makeTaskAdmissionController,
  type NextAdmissionDecision,
  validateCurrentTaskCapacityFacts
} from "./task-admission-controller.js"
import { taskRevisionFor } from "./task-dag.js"
import { TaskExecutionRequest, TaskExecutionSessionBinding } from "./task-execution.js"
import { noTaskWorkCapacityRequirement, oneTaskWorkCapacityRequirement } from "./task-work-capacity.js"
import { TaskWorkStartRequest } from "./task-work-start.js"
import { TaskClaimAcquisition } from "./tracker-mutation.js"
import {
  makeImplementationEvidenceSealingOperation,
  makeImplementationReviewOperation,
  makeReviewFindingsHandbackOperation,
  makeTaskExecutionOperation,
  makeTaskWorkSessionEstablishmentOperation,
  makeTaskWorktreeReconciliationOperation
} from "./workflow-operation.js"

const freshTransition = (taskId: TaskId) =>
  RunnableFrontierTransition.CommitFreshTaskClaimIntent({
    taskId,
    taskRevision: TaskRevision.make(`revision:${taskId}`)
  })

const continuedExecutorInvocation = (
  operationId: ExecutorOuterInvocationId | OperationId,
  subjectTaskId: TaskId,
  usesTaskWorkCapacity = true
) =>
  RunnableFrontierTransition.ContinueExecutorInvocation({
    capacityRequirement: usesTaskWorkCapacity
      ? oneTaskWorkCapacityRequirement
      : noTaskWorkCapacityRequirement,
    invocation: makeExecutorOuterInvocation(
      ExecutorOuterInvocationId.make(operationId),
      subjectTaskId
    )
  })

const executorResponsibility = (
  beganAt: typeof JournalPosition.Type,
  operationId: ExecutorOuterInvocationId | OperationId,
  usesTaskWorkCapacity = true
) =>
  WorkflowResponsibilityEntry.cases.ExecutorInvocationResponsibility.make({
    beganAt,
    capacityRequirement: usesTaskWorkCapacity
      ? oneTaskWorkCapacityRequirement
      : noTaskWorkCapacityRequirement,
    invocation: makeExecutorOuterInvocation(
      ExecutorOuterInvocationId.make(operationId),
      taskId
    )
  })

const admittedTransitions = (
  decision: NextAdmissionDecision
): ReadonlyArray<RunnableFrontierTransition> => Option.toArray(decision.transition)

const taskId = TaskId.make("responsibility-task")
const task = {
  id: taskId,
  lifecycle: TaskLifecycle.cases.Open.make({}),
  parentTaskId: null,
  prerequisiteIds: []
}
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("responsibility-attempt"),
  baseSha: GitCommitSha.make("0123456789abcdef0123456789abcdef01234567"),
  branch: TaskBranchRef.make("refs/heads/dalph/responsibility"),
  executor: TaskExecutorLocator.make("executor:responsibility"),
  runId: RunId.make("responsibility-run"),
  session: TaskWorkSessionLocator.make("session:responsibility"),
  taskId,
  taskRevision: taskRevisionFor(task),
  worktree: WorktreeLocator.make("/tmp/dalph-responsibility")
})
const sessionId = TaskWorkSessionId.make("responsibility-session")
const round = SemanticReviewRound.make(1)
const roundLimit = ImplementationReviewRoundLimit.make(2)
const evidenceReference = EvidenceReference.make({
  byteLength: 0,
  digest: EvidenceDigest.make("0".repeat(64))
})

const responsibilities = () => {
  const claimOperationId = OperationId.make("claim-responsibility")
  const worktreeOperation = makeTaskWorktreeReconciliationOperation({
    operationId: OperationId.make("worktree-responsibility"),
    plannedAttempt,
    predecessorOperationIds: [claimOperationId]
  })
  const sessionOperation = makeTaskWorkSessionEstablishmentOperation({
    predecessorOperationIds: [worktreeOperation.operationId],
    request: TaskWorkStartRequest.make({
      operationId: OperationId.make("session-responsibility"),
      plannedAttempt,
      task
    })
  })
  const executionOperation = makeTaskExecutionOperation({
    predecessorOperationIds: [sessionOperation.request.operationId],
    request: TaskExecutionRequest.make({
      operationId: OperationId.make("execution-responsibility"),
      plannedAttempt,
      session: TaskExecutionSessionBinding.cases.EstablishedSession.make({
        sessionId
      }),
      task
    })
  })
  const evidenceOperation = makeImplementationEvidenceSealingOperation({
    execution: {
      _tag: "SimulatedExecution",
      predecessorOperationId: executionOperation.request.operationId
    },
    operationId: OperationId.make("evidence-responsibility"),
    plannedAttempt
  })
  const reviewOperation = makeImplementationReviewOperation(
    ImplementationReviewRequest.make({
      _tag: "SimulatedImplementationReview",
      evidenceSealingOperationId: evidenceOperation.operationId,
      operationId: OperationId.make("review-responsibility"),
      round,
      roundLimit
    })
  )
  const sealedReview = SealedImplementationReview.make({
    manifest: {
      disposition: ImplementationReviewDisposition.cases.Accepted.make({}),
      findingHistory: [],
      implementationEvidenceReference: evidenceReference,
      implementerInvocationId: executionOperation.request.operationId,
      implementerSessionId: sessionId,
      operationId: reviewOperation.request.operationId,
      plannedAttempt,
      predecessorEvidenceReference: evidenceReference,
      reviewerSessionId: ReviewerSessionId.make("responsibility-reviewer"),
      round,
      roundLimit,
      stage: "ImplementationReview"
    },
    manifestReference: evidenceReference
  })
  const handbackOperation = makeReviewFindingsHandbackOperation(
    ReviewFindingsHandbackRequest.make({
      implementerInvocationId: executionOperation.request.operationId,
      implementerSessionId: sessionId,
      operationId: OperationId.make("handback-responsibility"),
      plannedAttempt,
      review: sealedReview,
      reviewOperationId: reviewOperation.request.operationId
    })
  )
  return [
    WorkflowResponsibilityEntry.cases.TaskClaimResponsibility.make({
      acquisition: TaskClaimAcquisition.make({
        operationId: claimOperationId,
        owner: ClaimOwner.make("responsibility-owner"),
        taskId,
        token: ClaimToken.make("responsibility-token")
      }),
      beganAt: JournalPosition.make(1),
      taskId
    }),
    WorkflowResponsibilityEntry.cases.TaskWorktreeResponsibility.make({
      beganAt: JournalPosition.make(2),
      operation: worktreeOperation,
      taskId
    }),
    WorkflowResponsibilityEntry.cases.TaskWorkSessionResponsibility.make({
      beganAt: JournalPosition.make(3),
      operation: sessionOperation,
      taskId
    }),
    executorResponsibility(
      JournalPosition.make(4),
      executionOperation.request.operationId
    ),
    executorResponsibility(
      JournalPosition.make(5),
      evidenceOperation.operationId,
      false
    ),
    executorResponsibility(
      JournalPosition.make(6),
      reviewOperation.request.operationId
    ),
    executorResponsibility(
      JournalPosition.make(7),
      handbackOperation.request.operationId
    )
  ] as const
}

it("derives the exact continuation for every reconstructed responsibility", () => {
  const entries = responsibilities()
  const frontier = deriveRunnableFrontier({
    freshEligibleTasks: [],
    responsibility: WorkflowResponsibilityState.make({ entries }),
    responsibilityFacts: entries.map((responsibility) => ({
      disposition: ResponsibilityDisposition.Ready(),
      responsibility
    }))
  })

  expect(frontier.transitions.map(({ _tag }) => _tag)).toEqual([
    "CheckTaskClaim",
    "ReconcileTaskWorktree",
    "CheckTaskWorkSession",
    "ContinueExecutorInvocation",
    "ContinueExecutorInvocation",
    "ContinueExecutorInvocation",
    "ContinueExecutorInvocation"
  ])
})

it("derives missing-claim reconciliation and exact fact issues", () => {
  const responsibility = responsibilities()[0]
  const state = WorkflowResponsibilityState.make({
    entries: [responsibility]
  })
  const missingClaim = {
    disposition: ResponsibilityDisposition.MissingClaim(),
    responsibility
  }
  expect(
    deriveRunnableFrontier({
      freshEligibleTasks: [],
      responsibility: state,
      responsibilityFacts: [missingClaim]
    }).transitions
  ).toEqual([{
    _tag: "ReconcileTaskClaim",
    operationId: "claim-responsibility",
    taskId
  }])
  expect(
    deriveRunnableFrontier({
      freshEligibleTasks: [{
        taskId,
        taskRevision: TaskRevision.make(`revision:${taskId}`)
      }],
      responsibility: state,
      responsibilityFacts: []
    })
  ).toEqual({
    explanations: [{
      _tag: "TypedIssue",
      operationId: "claim-responsibility",
      reason: "MissingFreshFacts"
    }],
    transitions: []
  })
  expect(
    deriveRunnableFrontier({
      freshEligibleTasks: [],
      responsibility: state,
      responsibilityFacts: [missingClaim, missingClaim]
    }).explanations
  ).toEqual([{
    _tag: "TypedIssue",
    operationId: "claim-responsibility",
    reason: "DuplicateFreshFacts"
  }])
})

it.effect("rebuilds, updates, and releases exact process-local positions", () =>
  Effect.gen(function*() {
    const taskA = TaskId.make("capacity-A")
    const taskB = TaskId.make("capacity-B")
    const taskC = TaskId.make("capacity-C")
    const taskD = TaskId.make("capacity-D")
    const controller = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(3),
      latestExecutorActiveReports: [
        {
          observationId: ProviderObservationId.make("capacity-D-observation"),
          invocationId: ExecutorOuterInvocationId.make("capacity-D-invocation"),
          taskId: taskD
        },
        {
          observationId: ProviderObservationId.make("capacity-B-observation"),
          invocationId: ExecutorOuterInvocationId.make("capacity-B-invocation"),
          taskId: taskB
        }
      ],
      unfinishedRecordedExecutorInvocations: [
        {
          invocationId: ExecutorOuterInvocationId.make("capacity-A-reserved"),
          taskId: taskA
        },
        {
          invocationId: ExecutorOuterInvocationId.make("capacity-B-invocation"),
          taskId: taskB
        },
        {
          invocationId: ExecutorOuterInvocationId.make("capacity-D-invocation"),
          taskId: taskD
        }
      ]
    })
    expect(yield* controller.snapshot()).toEqual({
      capacity: 3,
      taskWorkPositions: new Map([
        [taskA, {
          _tag: "AwaitingExecutorReport",
          invocationId: "capacity-A-reserved"
        }],
        [taskB, {
          _tag: "Working",
          observationId: "capacity-B-observation",
          invocationId: "capacity-B-invocation"
        }],
        [taskD, {
          _tag: "Working",
          observationId: "capacity-D-observation",
          invocationId: "capacity-D-invocation"
        }]
      ])
    })

    const admission = yield* controller.admit({
      explanations: [],
      transitions: [
        continuedExecutorInvocation(
          ExecutorOuterInvocationId.make("capacity-B-invocation"),
          taskB
        ),
        continuedExecutorInvocation(
          ExecutorOuterInvocationId.make("capacity-A-reserved"),
          taskA
        ),
        RunnableFrontierTransition.CheckTaskClaim({
          operationId: OperationId.make("capacity-A-claim"),
          taskId: taskA
        }),
        freshTransition(taskC),
        continuedExecutorInvocation(
          ExecutorOuterInvocationId.make("capacity-C-review"),
          taskC
        ),
        continuedExecutorInvocation(
          ExecutorOuterInvocationId.make("capacity-D-handback"),
          taskD
        )
      ]
    }, RunId.make("capacity-rebuild-run"))
    expect(admission).toEqual({
      explanations: [],
      transition: Option.some(continuedExecutorInvocation(
        ExecutorOuterInvocationId.make("capacity-B-invocation"),
        taskB
      ))
    })
    expect([...(yield* controller.snapshot()).taskWorkPositions.keys()])
      .toEqual([taskA, taskB, taskD])

    yield* controller.releaseTaskAdmissionPosition(
      ExecutorOuterInvocationId.make("capacity-A-reserved")
    )
    const capacityRunId = RunId.make("capacity-run")
    expect(
      admittedTransitions(
        yield* controller.admit({
          explanations: [],
          transitions: [
            freshTransition(taskC)
          ]
        }, capacityRunId)
      )
    ).toHaveLength(1)
    const selectedReservation = (yield* controller.snapshot())
      .taskWorkPositions.get(taskC)
    if (selectedReservation?._tag !== "Reserved") {
      return yield* Effect.die("expected selected transition reservation")
    }
    yield* controller.bindReservedPosition(
      selectedReservation.selected,
      ExecutorOuterInvocationId.make("capacity-C-invocation")
    )
    yield* controller.applyFreshInvocationObservation({
      _tag: "FreshCapacityConsumed",
      observationId: ProviderObservationId.make("capacity-C-observation"),
      invocationId: ExecutorOuterInvocationId.make("capacity-C-invocation"),
      taskId: taskC
    })
    yield* controller.applyFreshInvocationObservation({
      _tag: "FreshCapacityConsumed",
      observationId: ProviderObservationId.make("capacity-C-reobservation"),
      invocationId: ExecutorOuterInvocationId.make("capacity-C-reobserved"),
      taskId: taskC
    })
    yield* controller.applyFreshInvocationObservation({
      _tag: "FreshCapacityReleased",
      observationId: ProviderObservationId.make("capacity-C-stale-stop"),
      invocationId: ExecutorOuterInvocationId.make("capacity-C-invocation"),
      taskId: taskC
    })
    expect((yield* controller.snapshot()).taskWorkPositions.has(taskC)).toBe(false)
    yield* controller.applyFreshInvocationObservation({
      _tag: "FreshCapacityReleased",
      observationId: ProviderObservationId.make("capacity-C-stopped"),
      invocationId: ExecutorOuterInvocationId.make("capacity-C-reobserved"),
      taskId: taskC
    })
    expect((yield* controller.snapshot()).taskWorkPositions).toEqual(
      new Map([
        [taskB, {
          _tag: "Working",
          observationId: "capacity-B-observation",
          invocationId: "capacity-B-invocation"
        }],
        [taskD, {
          _tag: "Working",
          observationId: "capacity-D-observation",
          invocationId: "capacity-D-invocation"
        }]
      ])
    )
  }))

it.effect("uses current restart capacity without preempting freshly observed invocations", () =>
  Effect.gen(function*() {
    const scenarios = [
      { label: "8-to-2", currentCapacity: 2, occupied: 5, expectedAdmissions: 0 },
      { label: "1-to-2", currentCapacity: 2, occupied: 1, expectedAdmissions: 1 },
      { label: "2-to-1", currentCapacity: 1, occupied: 2, expectedAdmissions: 0 }
    ] as const

    for (const scenario of scenarios) {
      const occupied = Array.from({ length: scenario.occupied }, (_, index) => ({
        observationId: ProviderObservationId.make(
          `${scenario.label}-observation-${index}`
        ),
        invocationId: ExecutorOuterInvocationId.make(`${scenario.label}-operation-${index}`),
        taskId: TaskId.make(`${scenario.label}-occupied-${index}`)
      }))
      const controller = yield* makeTaskAdmissionController({
        capacity: TaskWorkCapacity.make(scenario.currentCapacity),
        latestExecutorActiveReports: occupied,
        unfinishedRecordedExecutorInvocations: occupied.map(
          ({ invocationId, taskId }) => ({ invocationId, taskId })
        )
      })
      const freshTasks = [
        TaskId.make(`${scenario.label}-fresh-0`),
        TaskId.make(`${scenario.label}-fresh-1`)
      ]
      let admissions = 0
      for (const taskId of freshTasks) {
        const admission = yield* controller.admit(
          {
            explanations: [],
            transitions: [
              freshTransition(taskId)
            ]
          },
          RunId.make(`${scenario.label}-run`)
        )
        admissions += Option.isSome(admission.transition) ? 1 : 0
      }
      const snapshot = yield* controller.snapshot()
      expect(
        [...snapshot.taskWorkPositions.values()]
          .filter(({ _tag }) => _tag === "Working"),
        scenario.label
      ).toHaveLength(scenario.occupied)
      expect(admissions, scenario.label).toBe(scenario.expectedAdmissions)
    }
  }))

it.effect("returns capacity waiting and signals when exact release may permit admission", () =>
  Effect.gen(function*() {
    const taskA = TaskId.make("capacity-return-A")
    const taskB = TaskId.make("capacity-return-B")
    const controller = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(1),
      latestExecutorActiveReports: [],
      unfinishedRecordedExecutorInvocations: [{
        invocationId: ExecutorOuterInvocationId.make("capacity-return-A-operation"),
        taskId: taskA
      }]
    })

    expect(
      yield* controller.admit({
        explanations: [],
        transitions: [
          freshTransition(taskB)
        ]
      }, RunId.make("capacity-return-run"))
    ).toEqual({
      explanations: [{
        _tag: "CapacityWait",
        taskId: taskB,
        wakeCondition: "CapacityReleasedOrReconstructedStateChanged"
      }],
      transition: Option.none()
    })

    expect(
      yield* controller.releaseTaskAdmissionPosition(
        ExecutorOuterInvocationId.make("capacity-return-A-operation")
      )
    ).toEqual({
      _tag: "AdmissionMayNowBePossible"
    })
  }))

it.effect("counts a mismatched executor invocation once and admits another task at capacity two", () =>
  Effect.gen(function*() {
    const conflictedTaskId = TaskId.make("conflicted-capacity-task")
    const independentlyRunnableTaskId = TaskId.make(
      "independently-runnable-capacity-task"
    )
    const expectedInvocationId = ExecutorOuterInvocationId.make("expected-capacity-operation")
    const controller = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(2),
      latestExecutorActiveReports: [{
        observationId: ProviderObservationId.make(
          "mismatched-capacity-observation"
        ),
        invocationId: ExecutorOuterInvocationId.make("reported-capacity-operation"),
        taskId: conflictedTaskId
      }],
      unfinishedRecordedExecutorInvocations: [{
        invocationId: expectedInvocationId,
        taskId: conflictedTaskId
      }]
    })

    expect(
      admittedTransitions(
        yield* controller.admit({
          explanations: [],
          transitions: [freshTransition(independentlyRunnableTaskId)]
        }, RunId.make("mismatched-capacity-run"))
      )
    ).toEqual([freshTransition(independentlyRunnableTaskId)])
    expect(yield* controller.taskWorkPositions()).toEqual(
      new Map([
        [conflictedTaskId, {
          _tag: "ExecutorInvocationMismatch",
          expectedInvocationId,
          observationId: "mismatched-capacity-observation",
          reportedInvocationId: "reported-capacity-operation"
        }],
        [independentlyRunnableTaskId, {
          _tag: "Reserved",
          selected: expect.any(Object)
        }]
      ])
    )
  }))

it.effect("keeps another task waiting behind one unresolved task at capacity one", () =>
  Effect.gen(function*() {
    const conflictedTaskId = TaskId.make("capacity-one-conflicted-task")
    const waitingTaskId = TaskId.make("capacity-one-waiting-task")
    const controller = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(1),
      latestExecutorActiveReports: [{
        observationId: ProviderObservationId.make("capacity-one-observation"),
        invocationId: ExecutorOuterInvocationId.make("capacity-one-observed-operation"),
        taskId: conflictedTaskId
      }],
      unfinishedRecordedExecutorInvocations: [{
        invocationId: ExecutorOuterInvocationId.make("capacity-one-expected-operation"),
        taskId: conflictedTaskId
      }]
    })

    expect(
      yield* controller.admit({
        explanations: [],
        transitions: [freshTransition(waitingTaskId)]
      }, RunId.make("capacity-one-run"))
    ).toEqual({
      explanations: [{
        _tag: "CapacityWait",
        taskId: waitingTaskId,
        wakeCondition: "CapacityReleasedOrReconstructedStateChanged"
      }],
      transition: Option.none()
    })
    expect(yield* controller.taskWorkPositions()).toEqual(
      new Map([[
        conflictedTaskId,
        {
          _tag: "ExecutorInvocationMismatch",
          expectedInvocationId: "capacity-one-expected-operation",
          observationId: "capacity-one-observation",
          reportedInvocationId: "capacity-one-observed-operation"
        }
      ]])
    )
  }))

it.effect("requires a matching fresh report before making a conflicted task available", () =>
  Effect.gen(function*() {
    const conflictedTaskId = TaskId.make("conflict-resolution-task")
    const waitingTaskId = TaskId.make("conflict-resolution-waiting-task")
    const expectedInvocationId = ExecutorOuterInvocationId.make("conflict-resolution-expected")
    const reportedInvocationId = ExecutorOuterInvocationId.make("conflict-resolution-observed")
    const controller = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(1),
      latestExecutorActiveReports: [{
        observationId: ProviderObservationId.make("conflict-resolution-active"),
        invocationId: reportedInvocationId,
        taskId: conflictedTaskId
      }],
      unfinishedRecordedExecutorInvocations: [{
        invocationId: expectedInvocationId,
        taskId: conflictedTaskId
      }]
    })

    expect(yield* controller.taskWorkPositions()).toEqual(
      new Map([[
        conflictedTaskId,
        {
          _tag: "ExecutorInvocationMismatch",
          expectedInvocationId,
          observationId: "conflict-resolution-active",
          reportedInvocationId
        }
      ]])
    )
    yield* controller.applyFreshInvocationObservation({
      _tag: "FreshCapacityReleased",
      observationId: ProviderObservationId.make("conflict-resolution-terminal"),
      invocationId: reportedInvocationId,
      taskId: conflictedTaskId
    })
    expect(yield* controller.taskWorkPositions()).toEqual(
      new Map([[
        conflictedTaskId,
        {
          _tag: "AwaitingExecutorReport",
          invocationId: expectedInvocationId
        }
      ]])
    )
    expect(
      yield* controller.admit({
        explanations: [],
        transitions: [freshTransition(waitingTaskId)]
      }, RunId.make("conflict-resolution-run"))
    ).toEqual({
      explanations: [{
        _tag: "CapacityWait",
        taskId: waitingTaskId,
        wakeCondition: "CapacityReleasedOrReconstructedStateChanged"
      }],
      transition: Option.none()
    })
    yield* controller.applyFreshInvocationObservation({
      _tag: "FreshCapacityAbsent",
      observationId: ProviderObservationId.make("conflict-resolution-absent"),
      invocationId: expectedInvocationId,
      taskId: conflictedTaskId
    })
    expect(
      admittedTransitions(
        yield* controller.admit({
          explanations: [],
          transitions: [freshTransition(waitingTaskId)]
        }, RunId.make("conflict-resolution-run"))
      )
    ).toEqual([freshTransition(waitingTaskId)])
  }))

it.effect("repeated mismatched reports do not increase capacity usage", () =>
  Effect.gen(function*() {
    const conflictedTaskId = TaskId.make("repeated-conflict-task")
    const waitingTaskId = TaskId.make("repeated-conflict-waiting-task")
    const reportedInvocationId = ExecutorOuterInvocationId.make("repeated-conflict-observed")
    const controller = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(2),
      latestExecutorActiveReports: [],
      unfinishedRecordedExecutorInvocations: [{
        invocationId: ExecutorOuterInvocationId.make("repeated-conflict-expected"),
        taskId: conflictedTaskId
      }]
    })
    const report = {
      _tag: "FreshCapacityConsumed" as const,
      observationId: ProviderObservationId.make("repeated-conflict-observation"),
      invocationId: reportedInvocationId,
      taskId: conflictedTaskId
    }

    yield* controller.applyFreshInvocationObservation(report)
    yield* controller.applyFreshInvocationObservation(report)
    expect(yield* controller.taskWorkPositions()).toHaveLength(1)
    expect(
      admittedTransitions(
        yield* controller.admit({
          explanations: [],
          transitions: [freshTransition(waitingTaskId)]
        }, RunId.make("repeated-conflict-run"))
      )
    ).toEqual([freshTransition(waitingTaskId)])
  }))

it.effect("restart rereads the provider and recreates the exact task-work operation mismatch", () =>
  Effect.gen(function*() {
    const taskId = TaskId.make("restart-conflict-task")
    const expectedInvocationId = ExecutorOuterInvocationId.make("restart-conflict-expected")
    const providerReports = yield* Ref.make([
      {
        observationId: ProviderObservationId.make("restart-before-observation"),
        invocationId: ExecutorOuterInvocationId.make("restart-before-observed-operation"),
        taskId
      },
      {
        observationId: ProviderObservationId.make("restart-after-observation"),
        invocationId: ExecutorOuterInvocationId.make("restart-after-observed-operation"),
        taskId
      }
    ])
    const readProvider = Ref.modify(providerReports, ([next, ...remaining]) =>
      [
        next,
        remaining
      ] as const)
    const beforeCrashReport = yield* readProvider
    if (beforeCrashReport === undefined) {
      return yield* Effect.die("expected pre-crash provider report")
    }
    const controllerBeforeCrash = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(1),
      latestExecutorActiveReports: [beforeCrashReport],
      unfinishedRecordedExecutorInvocations: [{
        invocationId: expectedInvocationId,
        taskId
      }]
    })
    expect((yield* controllerBeforeCrash.taskWorkPositions()).get(taskId)).toMatchObject({
      reportedInvocationId: "restart-before-observed-operation"
    })

    const afterRestartReport = yield* readProvider
    if (afterRestartReport === undefined) {
      return yield* Effect.die("restart must reread the provider")
    }
    const controllerAfterRestart = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(1),
      latestExecutorActiveReports: [afterRestartReport],
      unfinishedRecordedExecutorInvocations: [{
        invocationId: expectedInvocationId,
        taskId
      }]
    })

    expect(yield* controllerAfterRestart.taskWorkPositions()).toEqual(
      new Map([[
        taskId,
        {
          _tag: "ExecutorInvocationMismatch",
          expectedInvocationId,
          observationId: "restart-after-observation",
          reportedInvocationId: "restart-after-observed-operation"
        }
      ]])
    )
    expect(yield* Ref.get(providerReports)).toEqual([])
  }))

it.effect("unknown evidence holds one position while absence releases it", () =>
  Effect.gen(function*() {
    const unresolvedTaskId = TaskId.make("unknown-capacity-task")
    const waitingTaskId = TaskId.make("unknown-capacity-waiting-task")
    const expectedInvocationId = ExecutorOuterInvocationId.make("unknown-capacity-operation")
    const controller = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(1),
      latestExecutorActiveReports: [],
      unfinishedRecordedExecutorInvocations: [{
        invocationId: expectedInvocationId,
        taskId: unresolvedTaskId
      }]
    })

    yield* controller.applyFreshInvocationObservation({
      _tag: "FreshCapacityUnknown",
      observationId: ProviderObservationId.make("unknown-capacity-unreadable"),
      invocationId: expectedInvocationId,
      taskId: unresolvedTaskId
    })
    expect(
      Option.isNone(
        (yield* controller.admit({
          explanations: [],
          transitions: [freshTransition(waitingTaskId)]
        }, RunId.make("unknown-capacity-run"))).transition
      )
    ).toBe(true)
    yield* controller.applyFreshInvocationObservation({
      _tag: "FreshCapacityAbsent",
      observationId: ProviderObservationId.make("unknown-capacity-absent"),
      invocationId: expectedInvocationId,
      taskId: unresolvedTaskId
    })
    expect(
      admittedTransitions(
        yield* controller.admit({
          explanations: [],
          transitions: [freshTransition(waitingTaskId)]
        }, RunId.make("unknown-capacity-run"))
      )
    ).toEqual([freshTransition(waitingTaskId)])
  }))

it.effect("unknown evidence does not erase a task-work operation mismatch", () =>
  Effect.gen(function*() {
    const taskId = TaskId.make("unknown-conflict-task")
    const expectedInvocationId = ExecutorOuterInvocationId.make("unknown-conflict-expected")
    const reportedInvocationId = ExecutorOuterInvocationId.make("unknown-conflict-observed")
    const controller = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(1),
      latestExecutorActiveReports: [{
        observationId: ProviderObservationId.make("unknown-conflict-active"),
        invocationId: reportedInvocationId,
        taskId
      }],
      unfinishedRecordedExecutorInvocations: [{
        invocationId: expectedInvocationId,
        taskId
      }]
    })
    const conflict = yield* controller.taskWorkPositions()

    yield* controller.applyFreshInvocationObservation({
      _tag: "FreshCapacityUnknown",
      observationId: ProviderObservationId.make("unknown-conflict-unreadable"),
      invocationId: expectedInvocationId,
      taskId
    })

    expect(yield* controller.taskWorkPositions()).toEqual(conflict)
  }))

it.effect("matching interrupted evidence releases the task position", () =>
  Effect.gen(function*() {
    const interruptedTaskId = TaskId.make("interrupted-capacity-task")
    const waitingTaskId = TaskId.make("interrupted-capacity-waiting-task")
    const invocationId = ExecutorOuterInvocationId.make("interrupted-capacity-operation")
    const controller = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(1),
      latestExecutorActiveReports: [],
      unfinishedRecordedExecutorInvocations: [{
        invocationId,
        taskId: interruptedTaskId
      }]
    })

    yield* controller.applyFreshInvocationObservation({
      _tag: "FreshCapacityInterrupted",
      observationId: ProviderObservationId.make(
        "interrupted-capacity-observation"
      ),
      invocationId,
      taskId: interruptedTaskId
    })
    expect(
      admittedTransitions(
        yield* controller.admit({
          explanations: [],
          transitions: [freshTransition(waitingTaskId)]
        }, RunId.make("interrupted-capacity-run"))
      )
    ).toEqual([freshTransition(waitingTaskId)])
  }))

it.effect("reconstruction applies matching absence before reserving capacity", () =>
  Effect.gen(function*() {
    const taskId = TaskId.make("reconstructed-absence-task")
    const invocationId = ExecutorOuterInvocationId.make("reconstructed-absence-operation")
    const controller = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(1),
      latestExecutorActiveReports: [],
      freshlyReleasedInvocationIds: new Set([invocationId]),
      unfinishedRecordedExecutorInvocations: [{ invocationId, taskId }]
    })

    expect(yield* controller.taskWorkPositions()).toEqual(new Map())
  }))

it.effect("releasing the differently correlated operation keeps the expected operation held", () =>
  Effect.gen(function*() {
    const taskId = TaskId.make("direct-conflict-release-task")
    const expectedInvocationId = ExecutorOuterInvocationId.make(
      "direct-conflict-release-expected"
    )
    const reportedInvocationId = ExecutorOuterInvocationId.make(
      "direct-conflict-release-observed"
    )
    const controller = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(1),
      latestExecutorActiveReports: [{
        observationId: ProviderObservationId.make(
          "direct-conflict-release-observation"
        ),
        invocationId: reportedInvocationId,
        taskId
      }],
      unfinishedRecordedExecutorInvocations: [{
        invocationId: expectedInvocationId,
        taskId
      }]
    })

    yield* controller.releaseTaskAdmissionPosition(reportedInvocationId)

    expect(yield* controller.taskWorkPositions()).toEqual(
      new Map([[
        taskId,
        {
          _tag: "AwaitingExecutorReport",
          invocationId: expectedInvocationId
        }
      ]])
    )
  }))

it.effect("provider evidence requires a recorded operation identity", () =>
  Effect.gen(function*() {
    const taskId = TaskId.make("pre-intent-capacity-task")
    const runId = RunId.make("pre-intent-capacity-run")
    const controller = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(1),
      latestExecutorActiveReports: [],
      unfinishedRecordedExecutorInvocations: []
    })
    yield* controller.admit({
      explanations: [],
      transitions: [freshTransition(taskId)]
    }, runId)
    const before = yield* controller.taskWorkPositions()

    yield* controller.applyFreshInvocationObservation({
      _tag: "FreshCapacityUnknown",
      observationId: ProviderObservationId.make("pre-intent-unknown"),
      invocationId: ExecutorOuterInvocationId.make("pre-intent-unrecorded-operation"),
      taskId
    })

    expect(yield* controller.taskWorkPositions()).toEqual(before)
    expect(before.get(taskId)?._tag).toBe("Reserved")
  }))

it.effect("keeps exact task and operation correlation across every fresh provider result", () =>
  Effect.gen(function*() {
    const runId = RunId.make("exact-provider-correlation-run")
    const taskId = TaskId.make("exact-provider-correlation-task")
    const expectedInvocationId = ExecutorOuterInvocationId.make(
      "exact-provider-correlation-expected"
    )
    const reportedInvocationId = ExecutorOuterInvocationId.make(
      "exact-provider-correlation-observed"
    )
    const unrelatedOperationId = ExecutorOuterInvocationId.make(
      "exact-provider-correlation-unrelated"
    )
    const controller = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(2),
      latestExecutorActiveReports: [],
      unfinishedRecordedExecutorInvocations: []
    })

    yield* controller.applyFreshInvocationObservation({
      _tag: "FreshCapacityReleased",
      observationId: ProviderObservationId.make("missing-terminal"),
      invocationId: unrelatedOperationId,
      taskId
    })
    yield* controller.applyFreshInvocationObservation({
      _tag: "FreshCapacityUnknown",
      observationId: ProviderObservationId.make("missing-unknown"),
      invocationId: unrelatedOperationId,
      taskId
    })
    expect(yield* controller.taskWorkPositions()).toEqual(new Map())
    yield* controller.applyFreshInvocationObservation({
      _tag: "FreshCapacityConsumed",
      observationId: ProviderObservationId.make("unrecorded-active"),
      invocationId: expectedInvocationId,
      taskId
    })
    expect(yield* controller.taskWorkPositions()).toEqual(new Map())

    yield* controller.admit({
      explanations: [],
      transitions: [continuedExecutorInvocation(expectedInvocationId, taskId)]
    }, runId)
    expect((yield* controller.taskWorkPositions()).get(taskId)?._tag)
      .toBe("AwaitingExecutorReport")
    yield* controller.applyFreshInvocationObservation({
      _tag: "FreshCapacityConsumed",
      observationId: ProviderObservationId.make("recorded-active"),
      invocationId: expectedInvocationId,
      taskId
    })
    expect((yield* controller.taskWorkPositions()).get(taskId)?._tag).toBe("Working")
    yield* controller.applyFreshInvocationObservation({
      _tag: "FreshCapacityReleased",
      observationId: ProviderObservationId.make("wrong-terminal"),
      invocationId: unrelatedOperationId,
      taskId
    })
    expect((yield* controller.taskWorkPositions()).get(taskId)?._tag).toBe("Working")
    yield* controller.applyFreshInvocationObservation({
      _tag: "FreshCapacityUnknown",
      observationId: ProviderObservationId.make("working-unknown"),
      invocationId: expectedInvocationId,
      taskId
    })
    expect((yield* controller.taskWorkPositions()).get(taskId)?._tag)
      .toBe("AwaitingExecutorReport")

    yield* controller.applyFreshInvocationObservation({
      _tag: "FreshCapacityConsumed",
      observationId: ProviderObservationId.make("conflicting-active"),
      invocationId: reportedInvocationId,
      taskId
    })
    yield* controller.applyFreshInvocationObservation({
      _tag: "FreshCapacityReleased",
      observationId: ProviderObservationId.make("unrelated-terminal"),
      invocationId: unrelatedOperationId,
      taskId
    })
    expect((yield* controller.taskWorkPositions()).get(taskId)?._tag)
      .toBe("ExecutorInvocationMismatch")
    yield* controller.applyFreshInvocationObservation({
      _tag: "FreshCapacityConsumed",
      observationId: ProviderObservationId.make("expected-active"),
      invocationId: expectedInvocationId,
      taskId
    })
    expect((yield* controller.taskWorkPositions()).get(taskId)?._tag).toBe("Working")
    yield* controller.applyFreshInvocationObservation({
      _tag: "FreshCapacityConsumed",
      observationId: ProviderObservationId.make("second-conflicting-active"),
      invocationId: reportedInvocationId,
      taskId
    })
    yield* controller.applyFreshInvocationObservation({
      _tag: "FreshCapacityReleased",
      observationId: ProviderObservationId.make("expected-terminal"),
      invocationId: expectedInvocationId,
      taskId
    })
    expect(yield* controller.taskWorkPositions()).toEqual(new Map())

    const reservedTaskId = TaskId.make("reserved-provider-correlation-task")
    yield* controller.admit({
      explanations: [],
      transitions: [freshTransition(reservedTaskId)]
    }, runId)
    yield* controller.applyFreshInvocationObservation({
      _tag: "FreshCapacityConsumed",
      observationId: ProviderObservationId.make("reserved-active"),
      invocationId: expectedInvocationId,
      taskId: reservedTaskId
    })
    yield* controller.admit({
      explanations: [],
      transitions: [
        continuedExecutorInvocation(expectedInvocationId, reservedTaskId)
      ]
    }, runId)
    expect((yield* controller.taskWorkPositions()).get(reservedTaskId)?._tag)
      .toBe("Reserved")
  }))

it.effect("validates only current capacity-holding executor operations", () =>
  Effect.gen(function*() {
    const entries = responsibilities()
    yield* validateCurrentTaskCapacityFacts([
      {
        disposition: ResponsibilityDisposition.Ready(),
        responsibility: entries[0]
      },
      {
        disposition: ResponsibilityDisposition.Settled({
          outcome: "ResponsibilityCompleted"
        }),
        responsibility: entries[3]
      },
      {
        disposition: ResponsibilityDisposition.Ready(),
        responsibility: executorResponsibility(
          JournalPosition.make(20),
          ExecutorOuterInvocationId.make("capacity-free-validation-operation"),
          false
        )
      }
    ])
  }))

it.effect("rejects two waiting unfinished executor invocations for one task", () =>
  Effect.gen(function*() {
    const firstOperationId = ExecutorOuterInvocationId.make("waiting-capacity-first")
    const secondOperationId = ExecutorOuterInvocationId.make("waiting-capacity-second")
    const waitFor = (invocationId: ExecutorOuterInvocationId) =>
      ResponsibilityDisposition.ExecutorInvocationWait({
        wait: ExecutorOuterInvocationWait.cases.RetryScheduled.make({
          correlation: {
            invocationId,
            taskId
          },
          notBefore: TechnicalRetryNotBefore.make(20)
        })
      })
    const result = yield* Effect.result(validateCurrentTaskCapacityFacts([
      {
        disposition: waitFor(firstOperationId),
        responsibility: executorResponsibility(
          JournalPosition.make(20),
          firstOperationId
        )
      },
      {
        disposition: waitFor(secondOperationId),
        responsibility: executorResponsibility(
          JournalPosition.make(21),
          secondOperationId
        )
      }
    ]))

    expect(result._tag).toBe("Failure")
    if (result._tag === "Success") return
    expect(result.failure).toMatchObject({
      _tag: "MultipleUnfinishedExecutorInvocationsForTask",
      invocationIds: [firstOperationId, secondOperationId],
      taskId
    })
  }))

it.effect("rejects two unfinished executor invocations for one task during reconstruction", () =>
  Effect.gen(function*() {
    const taskId = TaskId.make("invalid-capacity-history-task")
    const result = yield* Effect.result(makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(2),
      latestExecutorActiveReports: [],
      unfinishedRecordedExecutorInvocations: [
        {
          invocationId: ExecutorOuterInvocationId.make("invalid-capacity-history-first"),
          taskId
        },
        {
          invocationId: ExecutorOuterInvocationId.make("invalid-capacity-history-second"),
          taskId
        }
      ]
    }))

    expect(result._tag).toBe("Failure")
    if (result._tag === "Success") return
    expect(result.failure._tag).toBe("MultipleUnfinishedExecutorInvocationsForTask")
    expect(result.failure.invocationIds).toEqual([
      "invalid-capacity-history-first",
      "invalid-capacity-history-second"
    ])
    expect(result.failure.taskId).toBe(taskId)
  }))

it.effect("rejects multiple fresh active observations for one task", () =>
  Effect.gen(function*() {
    const result = yield* Effect.result(makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(2),
      latestExecutorActiveReports: [
        {
          observationId: ProviderObservationId.make("duplicate-active-first"),
          invocationId: ExecutorOuterInvocationId.make("duplicate-active-first"),
          taskId
        },
        {
          observationId: ProviderObservationId.make("duplicate-active-second"),
          invocationId: ExecutorOuterInvocationId.make("duplicate-active-second"),
          taskId
        }
      ],
      unfinishedRecordedExecutorInvocations: []
    }))

    expect(result._tag).toBe("Failure")
    if (result._tag === "Success") return
    expect(result.failure).toMatchObject({
      _tag: "MultipleLatestExecutorReportsForTask",
      invocationIds: ["duplicate-active-first", "duplicate-active-second"],
      taskId
    })
  }))

it.effect("fails closed for stale reservation mutations and retains conflicting provider evidence", () =>
  Effect.gen(function*() {
    const runId = RunId.make("stale-reservation-run")
    const taskId = TaskId.make("stale-reservation-task")
    const waitingTaskId = TaskId.make("stale-reservation-waiting-task")
    const originalOperationId = ExecutorOuterInvocationId.make("stale-reservation-original")
    const controller = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(1),
      latestExecutorActiveReports: [],
      unfinishedRecordedExecutorInvocations: [{
        invocationId: originalOperationId,
        taskId
      }]
    })

    expect(
      yield* controller.applyFreshInvocationObservation({
        _tag: "FreshCapacityConsumed",
        observationId: ProviderObservationId.make("conflicting-observation"),
        invocationId: ExecutorOuterInvocationId.make("conflicting-operation"),
        taskId
      })
    ).toEqual({ _tag: "AdmissionAvailabilityUnchanged" })
    expect(yield* controller.snapshot()).toEqual({
      capacity: 1,
      taskWorkPositions: new Map([[
        taskId,
        {
          _tag: "ExecutorInvocationMismatch",
          expectedInvocationId: originalOperationId,
          observationId: "conflicting-observation",
          reportedInvocationId: "conflicting-operation"
        }
      ]])
    })

    const selected = makeSelectedTransitionIdentity(
      runId,
      freshTransition(taskId)
    )
    expect(
      (yield* Effect.exit(
        controller.bindReservedPosition(selected, ExecutorOuterInvocationId.make("missing-bind"))
      ))._tag
    ).toBe("Failure")
    expect(
      (yield* Effect.exit(
        controller.cancelReservedPosition(selected)
      ))._tag
    ).toBe("Failure")
    expect(
      (yield* Effect.exit(
        controller.releaseTaskAdmissionPosition(
          ExecutorOuterInvocationId.make("missing-release")
        )
      ))._tag
    ).toBe("Failure")

    expect(
      yield* controller.releaseTaskAdmissionPosition(originalOperationId)
    ).toEqual({ _tag: "AdmissionMayNowBePossible" })
    expect((yield* controller.snapshot()).taskWorkPositions).toEqual(new Map())
    expect(
      yield* controller.releaseTaskAdmissionPosition(originalOperationId)
    ).toEqual({ _tag: "AdmissionAvailabilityUnchanged" })
    expect(
      yield* controller.applyFreshInvocationObservation({
        _tag: "FreshCapacityReleased",
        observationId: ProviderObservationId.make("conflicting-release"),
        invocationId: ExecutorOuterInvocationId.make("conflicting-operation"),
        taskId
      })
    ).toEqual({ _tag: "AdmissionAvailabilityUnchanged" })
    expect(
      admittedTransitions(
        yield* controller.admit({
          explanations: [],
          transitions: [freshTransition(waitingTaskId)]
        }, runId)
      )
    ).toEqual([freshTransition(waitingTaskId)])

    const reconstructed = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(1),
      latestExecutorActiveReports: [{
        observationId: ProviderObservationId.make(
          "reconstructed-conflicting-observation"
        ),
        invocationId: ExecutorOuterInvocationId.make("conflicting-operation"),
        taskId
      }],
      unfinishedRecordedExecutorInvocations: [{
        invocationId: originalOperationId,
        taskId
      }]
    })
    yield* reconstructed.applyFreshInvocationObservation({
      _tag: "FreshCapacityConsumed",
      observationId: ProviderObservationId.make(
        "repeated-conflicting-observation"
      ),
      invocationId: ExecutorOuterInvocationId.make("conflicting-operation"),
      taskId
    })
    expect(yield* reconstructed.snapshot()).toEqual({
      capacity: 1,
      taskWorkPositions: new Map([[
        taskId,
        {
          _tag: "ExecutorInvocationMismatch",
          expectedInvocationId: originalOperationId,
          observationId: "repeated-conflicting-observation",
          reportedInvocationId: "conflicting-operation"
        }
      ]])
    })
    yield* reconstructed.applyFreshInvocationObservation({
      _tag: "FreshCapacityReleased",
      observationId: ProviderObservationId.make(
        "reconstructed-conflicting-release"
      ),
      invocationId: ExecutorOuterInvocationId.make("conflicting-operation"),
      taskId
    })
    expect(
      yield* reconstructed.applyFreshInvocationObservation({
        _tag: "FreshCapacityReleased",
        observationId: ProviderObservationId.make(
          "repeated-conflicting-release"
        ),
        invocationId: ExecutorOuterInvocationId.make("conflicting-operation"),
        taskId
      })
    ).toEqual({ _tag: "AdmissionAvailabilityUnchanged" })
    expect(yield* reconstructed.snapshot()).toEqual({
      capacity: 1,
      taskWorkPositions: new Map([[
        taskId,
        {
          _tag: "AwaitingExecutorReport",
          invocationId: originalOperationId
        }
      ]])
    })
  }))

it.effect("cancels one exact fresh reservation and rejects stale repeats", () =>
  Effect.gen(function*() {
    const runId = RunId.make("cancel-reservation-run")
    const taskId = TaskId.make("cancel-reservation-task")
    const transition = freshTransition(taskId)
    const controller = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(1),
      latestExecutorActiveReports: [],
      unfinishedRecordedExecutorInvocations: []
    })
    yield* controller.admit({ explanations: [], transitions: [transition] }, runId)
    const reservation = (yield* controller.snapshot()).taskWorkPositions.get(taskId)
    if (reservation?._tag !== "Reserved") {
      return yield* Effect.die("fresh admission must retain its selection identity")
    }

    expect(
      yield* controller.cancelReservedPosition(reservation.selected)
    ).toEqual({ _tag: "AdmissionMayNowBePossible" })
    expect(
      (yield* Effect.exit(
        controller.cancelReservedPosition(reservation.selected)
      ))._tag
    ).toBe("Failure")
  }))

it.effect("reserves at most one exact operation for a task in one admission decision", () =>
  Effect.gen(function*() {
    const taskId = TaskId.make("same-task")
    const first = continuedExecutorInvocation(
      ExecutorOuterInvocationId.make("same-task-review"),
      taskId
    )
    const second = continuedExecutorInvocation(
      ExecutorOuterInvocationId.make("same-task-handback"),
      taskId
    )
    const controller = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(2),
      latestExecutorActiveReports: [],
      unfinishedRecordedExecutorInvocations: []
    })

    expect(
      admittedTransitions(
        yield* controller.admit({
          explanations: [],
          transitions: [first, second]
        }, RunId.make("same-task-run"))
      )
    ).toEqual([first])

    yield* controller.releaseTaskAdmissionPosition(
      ExecutorOuterInvocationId.make(first.invocation.correlation.invocationId)
    )
    expect(
      admittedTransitions(
        yield* controller.admit({
          explanations: [],
          transitions: [second]
        }, RunId.make("same-task-run"))
      )
    ).toEqual([second])
  }))

it.effect("correlates both operation-backed and pre-intent reservations exactly", () =>
  Effect.gen(function*() {
    const runId = RunId.make("reservation-correlation-run")
    const taskId = TaskId.make("reservation-correlation-task")
    const reservedOperationId = ExecutorOuterInvocationId.make(
      "reservation-correlation-operation"
    )
    const operationController = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(1),
      latestExecutorActiveReports: [],
      unfinishedRecordedExecutorInvocations: [{
        invocationId: reservedOperationId,
        taskId
      }]
    })
    const exactOperation = continuedExecutorInvocation(
      reservedOperationId,
      taskId
    )
    const differentOperation = continuedExecutorInvocation(
      ExecutorOuterInvocationId.make("reservation-correlation-other-operation"),
      taskId
    )
    expect(
      admittedTransitions(
        yield* operationController.admit(
          { explanations: [], transitions: [exactOperation] },
          runId
        )
      )
    ).toEqual([exactOperation])
    expect(
      admittedTransitions(
        yield* operationController.admit(
          { explanations: [], transitions: [differentOperation] },
          runId
        )
      )
    ).toEqual([])

    const selectedController = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(1),
      latestExecutorActiveReports: [],
      unfinishedRecordedExecutorInvocations: []
    })
    const selected = freshTransition(taskId)
    const differentSelection = RunnableFrontierTransition
      .CommitFreshTaskClaimIntent({
        taskId,
        taskRevision: TaskRevision.make(
          "reservation-correlation-other-revision"
        )
      })
    yield* selectedController.admit(
      { explanations: [], transitions: [selected] },
      runId
    )
    expect(
      admittedTransitions(
        yield* selectedController.admit(
          { explanations: [], transitions: [selected] },
          runId
        )
      )
    ).toEqual([selected])
    expect(
      admittedTransitions(
        yield* selectedController.admit(
          { explanations: [], transitions: [differentSelection] },
          runId
        )
      )
    ).toEqual([])
  }))
