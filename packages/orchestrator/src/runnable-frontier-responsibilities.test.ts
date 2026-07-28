import { it } from "@effect/vitest"
import { Effect, Option, Ref } from "effect"
import { expect } from "vitest"
import {
  AttemptId,
  ClaimOwner,
  ClaimToken,
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
  operationId: OperationId,
  subjectTaskId: TaskId,
  usesTaskWorkCapacity = true
) =>
  RunnableFrontierTransition.ContinueExecutorInvocation({
    capacityRequirement: usesTaskWorkCapacity
      ? oneTaskWorkCapacityRequirement
      : noTaskWorkCapacityRequirement,
    invocation: makeExecutorOuterInvocation(
      operationId,
      subjectTaskId
    )
  })

const executorResponsibility = (
  beganAt: typeof JournalPosition.Type,
  operationId: OperationId,
  usesTaskWorkCapacity = true
) =>
  WorkflowResponsibilityEntry.cases.ExecutorInvocationResponsibility.make({
    beganAt,
    capacityRequirement: usesTaskWorkCapacity
      ? oneTaskWorkCapacityRequirement
      : noTaskWorkCapacityRequirement,
    invocation: makeExecutorOuterInvocation(
      operationId,
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
      freshOccupiedInvocations: [
        {
          observationId: ProviderObservationId.make("capacity-D-observation"),
          operationId: OperationId.make("capacity-D-invocation"),
          taskId: taskD
        },
        {
          observationId: ProviderObservationId.make("capacity-B-observation"),
          operationId: OperationId.make("capacity-B-invocation"),
          taskId: taskB
        }
      ],
      reconstructedReservedPositions: [{
        operationId: OperationId.make("capacity-A-reserved"),
        taskId: taskA
      }]
    })
    expect(yield* controller.snapshot()).toEqual({
      capacity: 3,
      occupied: [
        {
          observationId: "capacity-B-observation",
          operationId: "capacity-B-invocation",
          taskId: taskB
        },
        {
          observationId: "capacity-D-observation",
          operationId: "capacity-D-invocation",
          taskId: taskD
        }
      ],
      reservedPositions: [{
        correlation: {
          _tag: "OperationReservation",
          operationId: "capacity-A-reserved"
        },
        taskId: taskA
      }],
      reservedTaskIds: [taskA],
      taskStates: expect.any(Array)
    })

    const admission = yield* controller.admit({
      explanations: [],
      transitions: [
        continuedExecutorInvocation(
          OperationId.make("capacity-B-invocation"),
          taskB
        ),
        continuedExecutorInvocation(
          OperationId.make("capacity-A-reserved"),
          taskA
        ),
        RunnableFrontierTransition.CheckTaskClaim({
          operationId: OperationId.make("capacity-A-claim"),
          taskId: taskA
        }),
        freshTransition(taskC),
        continuedExecutorInvocation(
          OperationId.make("capacity-C-review"),
          taskC
        ),
        continuedExecutorInvocation(
          OperationId.make("capacity-D-handback"),
          taskD
        )
      ]
    }, RunId.make("capacity-rebuild-run"))
    expect(admission).toEqual({
      explanations: [],
      transition: Option.some(continuedExecutorInvocation(
        OperationId.make("capacity-B-invocation"),
        taskB
      ))
    })
    expect((yield* controller.snapshot()).reservedTaskIds).toEqual([taskA])

    yield* controller.releaseTaskAdmissionPosition(
      OperationId.make("capacity-A-reserved")
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
      .reservedPositions.find(({ taskId }) => taskId === taskC)
    if (
      selectedReservation?.correlation._tag
        !== "SelectedTransitionReservation"
    ) {
      return yield* Effect.die("expected selected transition reservation")
    }
    yield* controller.bindReservedPosition(
      selectedReservation.correlation.selected,
      OperationId.make("capacity-C-invocation")
    )
    yield* controller.applyFreshInvocationObservation({
      _tag: "FreshCapacityConsumed",
      observationId: ProviderObservationId.make("capacity-C-observation"),
      operationId: OperationId.make("capacity-C-invocation"),
      taskId: taskC
    })
    yield* controller.applyFreshInvocationObservation({
      _tag: "FreshCapacityConsumed",
      observationId: ProviderObservationId.make("capacity-C-reobservation"),
      operationId: OperationId.make("capacity-C-reobserved"),
      taskId: taskC
    })
    yield* controller.applyFreshInvocationObservation({
      _tag: "FreshCapacityReleased",
      observationId: ProviderObservationId.make("capacity-C-stale-stop"),
      operationId: OperationId.make("capacity-C-invocation"),
      taskId: taskC
    })
    expect(
      (yield* controller.snapshot()).taskStates.some(
        (entry) => entry.taskId === taskC
      )
    ).toBe(false)
    yield* controller.applyFreshInvocationObservation({
      _tag: "FreshCapacityReleased",
      observationId: ProviderObservationId.make("capacity-C-stopped"),
      operationId: OperationId.make("capacity-C-reobserved"),
      taskId: taskC
    })
    expect((yield* controller.snapshot()).occupied).toEqual([
      {
        observationId: "capacity-B-observation",
        operationId: "capacity-B-invocation",
        taskId: taskB
      },
      {
        observationId: "capacity-D-observation",
        operationId: "capacity-D-invocation",
        taskId: taskD
      }
    ])
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
        operationId: OperationId.make(`${scenario.label}-operation-${index}`),
        taskId: TaskId.make(`${scenario.label}-occupied-${index}`)
      }))
      const controller = yield* makeTaskAdmissionController({
        capacity: TaskWorkCapacity.make(scenario.currentCapacity),
        freshOccupiedInvocations: occupied,
        reconstructedReservedPositions: []
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
      expect(snapshot.occupied, scenario.label).toHaveLength(scenario.occupied)
      expect(admissions, scenario.label).toBe(scenario.expectedAdmissions)
    }
  }))

it.effect("returns capacity waiting and signals when exact release may permit admission", () =>
  Effect.gen(function*() {
    const taskA = TaskId.make("capacity-return-A")
    const taskB = TaskId.make("capacity-return-B")
    const controller = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(1),
      freshOccupiedInvocations: [],
      reconstructedReservedPositions: [{
        operationId: OperationId.make("capacity-return-A-operation"),
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
        OperationId.make("capacity-return-A-operation")
      )
    ).toEqual({
      _tag: "AdmissionMayNowBePossible"
    })
  }))

it.effect("counts a mismatched provider operation once and admits another task at capacity two", () =>
  Effect.gen(function*() {
    const conflictedTaskId = TaskId.make("conflicted-capacity-task")
    const independentlyRunnableTaskId = TaskId.make(
      "independently-runnable-capacity-task"
    )
    const expectedOperationId = OperationId.make("expected-capacity-operation")
    const controller = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(2),
      freshOccupiedInvocations: [{
        observationId: ProviderObservationId.make(
          "mismatched-capacity-observation"
        ),
        operationId: OperationId.make("reported-capacity-operation"),
        taskId: conflictedTaskId
      }],
      reconstructedReservedPositions: [{
        operationId: expectedOperationId,
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
    expect(yield* controller.taskStates()).toEqual([
      {
        state: {
          _tag: "CorrelationConflict",
          expectedOperationId,
          observationId: "mismatched-capacity-observation",
          observedOperationId: "reported-capacity-operation"
        },
        taskId: conflictedTaskId
      },
      {
        state: {
          _tag: "Reserved",
          selected: expect.any(Object)
        },
        taskId: independentlyRunnableTaskId
      }
    ])
  }))

it.effect("keeps another task waiting behind one unresolved task at capacity one", () =>
  Effect.gen(function*() {
    const conflictedTaskId = TaskId.make("capacity-one-conflicted-task")
    const waitingTaskId = TaskId.make("capacity-one-waiting-task")
    const controller = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(1),
      freshOccupiedInvocations: [{
        observationId: ProviderObservationId.make("capacity-one-observation"),
        operationId: OperationId.make("capacity-one-observed-operation"),
        taskId: conflictedTaskId
      }],
      reconstructedReservedPositions: [{
        operationId: OperationId.make("capacity-one-expected-operation"),
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
    expect(yield* controller.taskStates()).toEqual([{
      state: {
        _tag: "CorrelationConflict",
        expectedOperationId: "capacity-one-expected-operation",
        observationId: "capacity-one-observation",
        observedOperationId: "capacity-one-observed-operation"
      },
      taskId: conflictedTaskId
    }])
  }))

it.effect("requires a matching fresh report before making a conflicted task available", () =>
  Effect.gen(function*() {
    const conflictedTaskId = TaskId.make("conflict-resolution-task")
    const waitingTaskId = TaskId.make("conflict-resolution-waiting-task")
    const expectedOperationId = OperationId.make("conflict-resolution-expected")
    const observedOperationId = OperationId.make("conflict-resolution-observed")
    const controller = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(1),
      freshOccupiedInvocations: [{
        observationId: ProviderObservationId.make("conflict-resolution-active"),
        operationId: observedOperationId,
        taskId: conflictedTaskId
      }],
      reconstructedReservedPositions: [{
        operationId: expectedOperationId,
        taskId: conflictedTaskId
      }]
    })

    expect(yield* controller.taskStates()).toEqual([{
      state: {
        _tag: "CorrelationConflict",
        expectedOperationId,
        observationId: "conflict-resolution-active",
        observedOperationId
      },
      taskId: conflictedTaskId
    }])
    yield* controller.applyFreshInvocationObservation({
      _tag: "FreshCapacityReleased",
      observationId: ProviderObservationId.make("conflict-resolution-terminal"),
      operationId: observedOperationId,
      taskId: conflictedTaskId
    })
    expect(yield* controller.taskStates()).toEqual([{
      state: {
        _tag: "AwaitingProviderEvidence",
        operationId: expectedOperationId
      },
      taskId: conflictedTaskId
    }])
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
      operationId: expectedOperationId,
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
    const observedOperationId = OperationId.make("repeated-conflict-observed")
    const controller = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(2),
      freshOccupiedInvocations: [],
      reconstructedReservedPositions: [{
        operationId: OperationId.make("repeated-conflict-expected"),
        taskId: conflictedTaskId
      }]
    })
    const report = {
      _tag: "FreshCapacityConsumed" as const,
      observationId: ProviderObservationId.make("repeated-conflict-observation"),
      operationId: observedOperationId,
      taskId: conflictedTaskId
    }

    yield* controller.applyFreshInvocationObservation(report)
    yield* controller.applyFreshInvocationObservation(report)
    expect(yield* controller.taskStates()).toHaveLength(1)
    expect(
      admittedTransitions(
        yield* controller.admit({
          explanations: [],
          transitions: [freshTransition(waitingTaskId)]
        }, RunId.make("repeated-conflict-run"))
      )
    ).toEqual([freshTransition(waitingTaskId)])
  }))

it.effect("restart rereads the provider and recreates the exact correlation conflict", () =>
  Effect.gen(function*() {
    const taskId = TaskId.make("restart-conflict-task")
    const expectedOperationId = OperationId.make("restart-conflict-expected")
    const providerReports = yield* Ref.make([
      {
        observationId: ProviderObservationId.make("restart-before-observation"),
        operationId: OperationId.make("restart-before-observed-operation"),
        taskId
      },
      {
        observationId: ProviderObservationId.make("restart-after-observation"),
        operationId: OperationId.make("restart-after-observed-operation"),
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
      freshOccupiedInvocations: [beforeCrashReport],
      reconstructedReservedPositions: [{
        operationId: expectedOperationId,
        taskId
      }]
    })
    expect((yield* controllerBeforeCrash.taskStates())[0]?.state).toMatchObject({
      observedOperationId: "restart-before-observed-operation"
    })

    const afterRestartReport = yield* readProvider
    if (afterRestartReport === undefined) {
      return yield* Effect.die("restart must reread the provider")
    }
    const controllerAfterRestart = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(1),
      freshOccupiedInvocations: [afterRestartReport],
      reconstructedReservedPositions: [{
        operationId: expectedOperationId,
        taskId
      }]
    })

    expect(yield* controllerAfterRestart.taskStates()).toEqual([{
      state: {
        _tag: "CorrelationConflict",
        expectedOperationId,
        observationId: "restart-after-observation",
        observedOperationId: "restart-after-observed-operation"
      },
      taskId
    }])
    expect(yield* Ref.get(providerReports)).toEqual([])
  }))

it.effect("unknown evidence holds one position while absence releases it", () =>
  Effect.gen(function*() {
    const unresolvedTaskId = TaskId.make("unknown-capacity-task")
    const waitingTaskId = TaskId.make("unknown-capacity-waiting-task")
    const expectedOperationId = OperationId.make("unknown-capacity-operation")
    const controller = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(1),
      freshOccupiedInvocations: [],
      reconstructedReservedPositions: [{
        operationId: expectedOperationId,
        taskId: unresolvedTaskId
      }]
    })

    yield* controller.applyFreshInvocationObservation({
      _tag: "FreshCapacityUnknown",
      observationId: ProviderObservationId.make("unknown-capacity-unreadable"),
      operationId: expectedOperationId,
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
      operationId: expectedOperationId,
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

it.effect("unknown evidence does not erase a correlation conflict", () =>
  Effect.gen(function*() {
    const taskId = TaskId.make("unknown-conflict-task")
    const expectedOperationId = OperationId.make("unknown-conflict-expected")
    const observedOperationId = OperationId.make("unknown-conflict-observed")
    const controller = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(1),
      freshOccupiedInvocations: [{
        observationId: ProviderObservationId.make("unknown-conflict-active"),
        operationId: observedOperationId,
        taskId
      }],
      reconstructedReservedPositions: [{
        operationId: expectedOperationId,
        taskId
      }]
    })
    const conflict = yield* controller.taskStates()

    yield* controller.applyFreshInvocationObservation({
      _tag: "FreshCapacityUnknown",
      observationId: ProviderObservationId.make("unknown-conflict-unreadable"),
      operationId: expectedOperationId,
      taskId
    })

    expect(yield* controller.taskStates()).toEqual(conflict)
  }))

it.effect("matching interrupted evidence releases the task position", () =>
  Effect.gen(function*() {
    const interruptedTaskId = TaskId.make("interrupted-capacity-task")
    const waitingTaskId = TaskId.make("interrupted-capacity-waiting-task")
    const operationId = OperationId.make("interrupted-capacity-operation")
    const controller = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(1),
      freshOccupiedInvocations: [],
      reconstructedReservedPositions: [{
        operationId,
        taskId: interruptedTaskId
      }]
    })

    yield* controller.applyFreshInvocationObservation({
      _tag: "FreshCapacityInterrupted",
      observationId: ProviderObservationId.make(
        "interrupted-capacity-observation"
      ),
      operationId,
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
    const operationId = OperationId.make("reconstructed-absence-operation")
    const controller = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(1),
      freshOccupiedInvocations: [],
      freshlyReleasedOperationIds: new Set([operationId]),
      reconstructedReservedPositions: [{ operationId, taskId }]
    })

    expect(yield* controller.taskStates()).toEqual([])
  }))

it.effect("releasing the differently correlated operation keeps the expected operation held", () =>
  Effect.gen(function*() {
    const taskId = TaskId.make("direct-conflict-release-task")
    const expectedOperationId = OperationId.make(
      "direct-conflict-release-expected"
    )
    const observedOperationId = OperationId.make(
      "direct-conflict-release-observed"
    )
    const controller = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(1),
      freshOccupiedInvocations: [{
        observationId: ProviderObservationId.make(
          "direct-conflict-release-observation"
        ),
        operationId: observedOperationId,
        taskId
      }],
      reconstructedReservedPositions: [{
        operationId: expectedOperationId,
        taskId
      }]
    })

    yield* controller.releaseTaskAdmissionPosition(observedOperationId)

    expect(yield* controller.taskStates()).toEqual([{
      state: {
        _tag: "AwaitingProviderEvidence",
        operationId: expectedOperationId
      },
      taskId
    }])
  }))

it.effect("provider evidence requires a recorded operation identity", () =>
  Effect.gen(function*() {
    const taskId = TaskId.make("pre-intent-capacity-task")
    const runId = RunId.make("pre-intent-capacity-run")
    const controller = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(1),
      freshOccupiedInvocations: [],
      reconstructedReservedPositions: []
    })
    yield* controller.admit({
      explanations: [],
      transitions: [freshTransition(taskId)]
    }, runId)
    const before = yield* controller.taskStates()

    yield* controller.applyFreshInvocationObservation({
      _tag: "FreshCapacityUnknown",
      observationId: ProviderObservationId.make("pre-intent-unknown"),
      operationId: OperationId.make("pre-intent-unrecorded-operation"),
      taskId
    })

    expect(yield* controller.taskStates()).toEqual(before)
    expect(before[0]?.state._tag).toBe("Reserved")
  }))

it.effect("keeps exact task and operation correlation across every fresh provider result", () =>
  Effect.gen(function*() {
    const runId = RunId.make("exact-provider-correlation-run")
    const taskId = TaskId.make("exact-provider-correlation-task")
    const expectedOperationId = OperationId.make(
      "exact-provider-correlation-expected"
    )
    const observedOperationId = OperationId.make(
      "exact-provider-correlation-observed"
    )
    const unrelatedOperationId = OperationId.make(
      "exact-provider-correlation-unrelated"
    )
    const controller = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(2),
      freshOccupiedInvocations: [],
      reconstructedReservedPositions: []
    })

    yield* controller.applyFreshInvocationObservation({
      _tag: "FreshCapacityReleased",
      observationId: ProviderObservationId.make("missing-terminal"),
      operationId: unrelatedOperationId,
      taskId
    })
    yield* controller.applyFreshInvocationObservation({
      _tag: "FreshCapacityUnknown",
      observationId: ProviderObservationId.make("missing-unknown"),
      operationId: unrelatedOperationId,
      taskId
    })
    expect(yield* controller.taskStates()).toEqual([])
    yield* controller.applyFreshInvocationObservation({
      _tag: "FreshCapacityConsumed",
      observationId: ProviderObservationId.make("unrecorded-active"),
      operationId: expectedOperationId,
      taskId
    })
    expect((yield* controller.taskStates())[0]?.state._tag).toBe("Working")
    yield* controller.applyFreshInvocationObservation({
      _tag: "FreshCapacityReleased",
      observationId: ProviderObservationId.make("wrong-terminal"),
      operationId: unrelatedOperationId,
      taskId
    })
    expect((yield* controller.taskStates())[0]?.state._tag).toBe("Working")
    yield* controller.applyFreshInvocationObservation({
      _tag: "FreshCapacityUnknown",
      observationId: ProviderObservationId.make("working-unknown"),
      operationId: expectedOperationId,
      taskId
    })
    expect((yield* controller.taskStates())[0]?.state._tag)
      .toBe("AwaitingProviderEvidence")

    yield* controller.applyFreshInvocationObservation({
      _tag: "FreshCapacityConsumed",
      observationId: ProviderObservationId.make("conflicting-active"),
      operationId: observedOperationId,
      taskId
    })
    yield* controller.applyFreshInvocationObservation({
      _tag: "FreshCapacityReleased",
      observationId: ProviderObservationId.make("unrelated-terminal"),
      operationId: unrelatedOperationId,
      taskId
    })
    expect((yield* controller.taskStates())[0]?.state._tag)
      .toBe("CorrelationConflict")
    yield* controller.applyFreshInvocationObservation({
      _tag: "FreshCapacityConsumed",
      observationId: ProviderObservationId.make("expected-active"),
      operationId: expectedOperationId,
      taskId
    })
    expect((yield* controller.taskStates())[0]?.state._tag).toBe("Working")
    yield* controller.applyFreshInvocationObservation({
      _tag: "FreshCapacityConsumed",
      observationId: ProviderObservationId.make("second-conflicting-active"),
      operationId: observedOperationId,
      taskId
    })
    yield* controller.applyFreshInvocationObservation({
      _tag: "FreshCapacityReleased",
      observationId: ProviderObservationId.make("expected-terminal"),
      operationId: expectedOperationId,
      taskId
    })
    expect(yield* controller.taskStates()).toEqual([])

    const reservedTaskId = TaskId.make("reserved-provider-correlation-task")
    yield* controller.admit({
      explanations: [],
      transitions: [freshTransition(reservedTaskId)]
    }, runId)
    yield* controller.applyFreshInvocationObservation({
      _tag: "FreshCapacityConsumed",
      observationId: ProviderObservationId.make("reserved-active"),
      operationId: expectedOperationId,
      taskId: reservedTaskId
    })
    yield* controller.admit({
      explanations: [],
      transitions: [
        continuedExecutorInvocation(expectedOperationId, reservedTaskId)
      ]
    }, runId)
    expect(
      (yield* controller.taskStates()).find(
        (entry) => entry.taskId === reservedTaskId
      )?.state._tag
    ).toBe("Reserved")
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
          OperationId.make("capacity-free-validation-operation"),
          false
        )
      }
    ])
  }))

it.effect("rejects two waiting current capacity operations for one task", () =>
  Effect.gen(function*() {
    const firstOperationId = OperationId.make("waiting-capacity-first")
    const secondOperationId = OperationId.make("waiting-capacity-second")
    const waitFor = (operationId: OperationId) =>
      ResponsibilityDisposition.ExecutorInvocationWait({
        wait: ExecutorOuterInvocationWait.cases.RetryScheduled.make({
          correlation: {
            invocationId: operationId,
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
      _tag: "MultipleCurrentTaskCapacityOperations",
      operationIds: [firstOperationId, secondOperationId],
      taskId
    })
  }))

it.effect("rejects two current capacity operations for one task during reconstruction", () =>
  Effect.gen(function*() {
    const taskId = TaskId.make("invalid-capacity-history-task")
    const result = yield* Effect.result(makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(2),
      freshOccupiedInvocations: [],
      reconstructedReservedPositions: [
        {
          operationId: OperationId.make("invalid-capacity-history-first"),
          taskId
        },
        {
          operationId: OperationId.make("invalid-capacity-history-second"),
          taskId
        }
      ]
    }))

    expect(result._tag).toBe("Failure")
    if (result._tag === "Success") return
    expect(result.failure._tag).toBe("MultipleCurrentTaskCapacityOperations")
    expect(result.failure.operationIds).toEqual([
      "invalid-capacity-history-first",
      "invalid-capacity-history-second"
    ])
    expect(result.failure.taskId).toBe(taskId)
  }))

it.effect("rejects multiple fresh active observations for one task", () =>
  Effect.gen(function*() {
    const result = yield* Effect.result(makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(2),
      freshOccupiedInvocations: [
        {
          observationId: ProviderObservationId.make("duplicate-active-first"),
          operationId: OperationId.make("duplicate-active-first"),
          taskId
        },
        {
          observationId: ProviderObservationId.make("duplicate-active-second"),
          operationId: OperationId.make("duplicate-active-second"),
          taskId
        }
      ],
      reconstructedReservedPositions: []
    }))

    expect(result._tag).toBe("Failure")
    if (result._tag === "Success") return
    expect(result.failure).toMatchObject({
      _tag: "MultipleFreshTaskCapacityObservations",
      operationIds: ["duplicate-active-first", "duplicate-active-second"],
      taskId
    })
  }))

it.effect("fails closed for stale reservation mutations and retains conflicting provider evidence", () =>
  Effect.gen(function*() {
    const runId = RunId.make("stale-reservation-run")
    const taskId = TaskId.make("stale-reservation-task")
    const waitingTaskId = TaskId.make("stale-reservation-waiting-task")
    const originalOperationId = OperationId.make("stale-reservation-original")
    const controller = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(1),
      freshOccupiedInvocations: [],
      reconstructedReservedPositions: [{
        operationId: originalOperationId,
        taskId
      }]
    })

    expect(
      yield* controller.applyFreshInvocationObservation({
        _tag: "FreshCapacityConsumed",
        observationId: ProviderObservationId.make("conflicting-observation"),
        operationId: OperationId.make("conflicting-operation"),
        taskId
      })
    ).toEqual({ _tag: "AdmissionAvailabilityUnchanged" })
    expect(yield* controller.snapshot()).toEqual({
      capacity: 1,
      occupied: [],
      reservedPositions: [{
        correlation: {
          _tag: "OperationReservation",
          operationId: originalOperationId
        },
        taskId
      }],
      reservedTaskIds: [taskId],
      taskStates: [{
        state: {
          _tag: "CorrelationConflict",
          expectedOperationId: originalOperationId,
          observationId: "conflicting-observation",
          observedOperationId: "conflicting-operation"
        },
        taskId
      }]
    })

    const selected = makeSelectedTransitionIdentity(
      runId,
      freshTransition(taskId)
    )
    expect(
      (yield* Effect.exit(
        controller.bindReservedPosition(selected, OperationId.make("missing-bind"))
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
          OperationId.make("missing-release")
        )
      ))._tag
    ).toBe("Failure")

    expect(
      yield* controller.releaseTaskAdmissionPosition(originalOperationId)
    ).toEqual({ _tag: "AdmissionMayNowBePossible" })
    expect((yield* controller.snapshot()).taskStates).toEqual([])
    expect(
      yield* controller.releaseTaskAdmissionPosition(originalOperationId)
    ).toEqual({ _tag: "AdmissionAvailabilityUnchanged" })
    expect(
      yield* controller.applyFreshInvocationObservation({
        _tag: "FreshCapacityReleased",
        observationId: ProviderObservationId.make("conflicting-release"),
        operationId: OperationId.make("conflicting-operation"),
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
      freshOccupiedInvocations: [{
        observationId: ProviderObservationId.make(
          "reconstructed-conflicting-observation"
        ),
        operationId: OperationId.make("conflicting-operation"),
        taskId
      }],
      reconstructedReservedPositions: [{
        operationId: originalOperationId,
        taskId
      }]
    })
    yield* reconstructed.applyFreshInvocationObservation({
      _tag: "FreshCapacityConsumed",
      observationId: ProviderObservationId.make(
        "repeated-conflicting-observation"
      ),
      operationId: OperationId.make("conflicting-operation"),
      taskId
    })
    expect(yield* reconstructed.snapshot()).toEqual({
      capacity: 1,
      occupied: [],
      reservedPositions: [{
        correlation: {
          _tag: "OperationReservation",
          operationId: originalOperationId
        },
        taskId
      }],
      reservedTaskIds: [taskId],
      taskStates: [{
        state: {
          _tag: "CorrelationConflict",
          expectedOperationId: originalOperationId,
          observationId: "repeated-conflicting-observation",
          observedOperationId: "conflicting-operation"
        },
        taskId
      }]
    })
    yield* reconstructed.applyFreshInvocationObservation({
      _tag: "FreshCapacityReleased",
      observationId: ProviderObservationId.make(
        "reconstructed-conflicting-release"
      ),
      operationId: OperationId.make("conflicting-operation"),
      taskId
    })
    expect(
      yield* reconstructed.applyFreshInvocationObservation({
        _tag: "FreshCapacityReleased",
        observationId: ProviderObservationId.make(
          "repeated-conflicting-release"
        ),
        operationId: OperationId.make("conflicting-operation"),
        taskId
      })
    ).toEqual({ _tag: "AdmissionAvailabilityUnchanged" })
    expect(yield* reconstructed.snapshot()).toEqual({
      capacity: 1,
      occupied: [],
      reservedPositions: [{
        correlation: {
          _tag: "OperationReservation",
          operationId: originalOperationId
        },
        taskId
      }],
      reservedTaskIds: [taskId],
      taskStates: [{
        state: {
          _tag: "AwaitingProviderEvidence",
          operationId: originalOperationId
        },
        taskId
      }]
    })
  }))

it.effect("cancels one exact fresh reservation and rejects stale repeats", () =>
  Effect.gen(function*() {
    const runId = RunId.make("cancel-reservation-run")
    const taskId = TaskId.make("cancel-reservation-task")
    const transition = freshTransition(taskId)
    const controller = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(1),
      freshOccupiedInvocations: [],
      reconstructedReservedPositions: []
    })
    yield* controller.admit({ explanations: [], transitions: [transition] }, runId)
    const reservation = (yield* controller.snapshot()).reservedPositions[0]
    if (reservation?.correlation._tag !== "SelectedTransitionReservation") {
      return yield* Effect.die("fresh admission must retain its selection identity")
    }

    expect(
      yield* controller.cancelReservedPosition(reservation.correlation.selected)
    ).toEqual({ _tag: "AdmissionMayNowBePossible" })
    expect(
      (yield* Effect.exit(
        controller.cancelReservedPosition(reservation.correlation.selected)
      ))._tag
    ).toBe("Failure")
  }))

it.effect("reserves at most one exact operation for a task in one admission decision", () =>
  Effect.gen(function*() {
    const taskId = TaskId.make("same-task")
    const first = continuedExecutorInvocation(
      OperationId.make("same-task-review"),
      taskId
    )
    const second = continuedExecutorInvocation(
      OperationId.make("same-task-handback"),
      taskId
    )
    const controller = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(2),
      freshOccupiedInvocations: [],
      reconstructedReservedPositions: []
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
      first.invocation.correlation.invocationId
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
    const reservedOperationId = OperationId.make(
      "reservation-correlation-operation"
    )
    const operationController = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(1),
      freshOccupiedInvocations: [],
      reconstructedReservedPositions: [{
        operationId: reservedOperationId,
        taskId
      }]
    })
    const exactOperation = continuedExecutorInvocation(
      reservedOperationId,
      taskId
    )
    const differentOperation = continuedExecutorInvocation(
      OperationId.make("reservation-correlation-other-operation"),
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
      freshOccupiedInvocations: [],
      reconstructedReservedPositions: []
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
