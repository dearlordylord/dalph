import { it } from "@effect/vitest"
import { Effect, Fiber, Schema } from "effect"
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
  TaskWorkCapacity,
  TaskWorkSessionId,
  TaskWorkSessionLocator,
  WorktreeLocator
} from "./domain.js"
import { EvidenceDigest, EvidenceReference, SealedImplementationEvidence } from "./implementation-evidence.js"
import {
  AuthorizedImplementationReviewRequest,
  ImplementationReviewDisposition,
  ImplementationReviewRequest,
  ReviewFindingsHandbackRequest,
  SealedImplementationReview
} from "./implementation-review.js"
import { WorkflowResponsibilityEntry, WorkflowResponsibilityState } from "./reconstructed-managed-run-state.js"
import { deriveRunnableFrontier, ResponsibilityDisposition, RunnableFrontierTransition } from "./runnable-frontier.js"
import { makeTaskAdmissionController } from "./task-admission-controller.js"
import { taskRevisionFor } from "./task-dag.js"
import { TaskExecutionRequest, TaskExecutionSessionBinding } from "./task-execution.js"
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
    WorkflowResponsibilityEntry.cases.TaskExecutionResponsibility.make({
      beganAt: JournalPosition.make(4),
      operation: executionOperation,
      taskId
    }),
    WorkflowResponsibilityEntry.cases.ImplementationEvidenceResponsibility.make({
      beganAt: JournalPosition.make(5),
      operation: evidenceOperation,
      taskId
    }),
    WorkflowResponsibilityEntry.cases.ImplementationReviewResponsibility.make({
      beganAt: JournalPosition.make(6),
      operation: reviewOperation,
      plannedAttempt,
      taskId
    }),
    WorkflowResponsibilityEntry.cases.ReviewFindingsHandbackResponsibility.make({
      beganAt: JournalPosition.make(7),
      operation: handbackOperation,
      taskId
    })
  ] as const
}

it("derives the exact continuation for every reconstructed responsibility", () => {
  const entries = responsibilities()
  const frontier = deriveRunnableFrontier({
    freshEligibleTaskIds: [],
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
    "ContinueTaskExecution",
    "ContinueImplementationEvidenceSealing",
    "ContinueImplementationReview",
    "ContinueReviewFindingsHandback"
  ])
})

it("rejects a responsibility whose routing task disagrees with its operation", () => {
  const responsibility = responsibilities()[3]
  expect(() =>
    Schema.decodeUnknownSync(WorkflowResponsibilityEntry)({
      ...responsibility,
      taskId: TaskId.make("different-task")
    })
  ).toThrow("responsibility task identity must match its exact operation subject")
})

it("rejects a review responsibility that combines two attempts for one task", () => {
  const alternateAttempt = PlannedTaskAttempt.make({
    ...plannedAttempt,
    attemptId: AttemptId.make("different-review-attempt")
  })
  const operation = makeImplementationReviewOperation(
    AuthorizedImplementationReviewRequest.make({
      evidenceSealingOperationId: OperationId.make("review-evidence-operation"),
      findingHistory: [],
      implementationEvidence: SealedImplementationEvidence.make({
        manifest: {
          diff: evidenceReference,
          implementationOutput: evidenceReference,
          plannedBaseSha: plannedAttempt.baseSha,
          predecessorOperationId: OperationId.make("review-execution-operation"),
          runId: plannedAttempt.runId,
          stage: "Implementation",
          taskId
        },
        manifestReference: evidenceReference
      }),
      implementerInvocationId: OperationId.make("review-execution-operation"),
      implementerSessionId: sessionId,
      operationId: OperationId.make("authorized-review-responsibility"),
      plannedAttempt,
      predecessorEvidenceReference: evidenceReference,
      reviewerSessionId: ReviewerSessionId.make("authorized-responsibility-reviewer"),
      round,
      roundLimit
    })
  )

  expect(() =>
    Schema.decodeUnknownSync(WorkflowResponsibilityEntry)({
      _tag: "ImplementationReviewResponsibility",
      beganAt: JournalPosition.make(6),
      operation,
      plannedAttempt: alternateAttempt,
      taskId
    })
  ).toThrow("review responsibility attempt must match its exact operation subject")
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
      freshEligibleTaskIds: [],
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
      freshEligibleTaskIds: [taskId],
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
      freshEligibleTaskIds: [],
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
      reconstructedReservedTaskIds: [taskB, taskA, taskA]
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
      reservedTaskIds: [taskA]
    })

    const admission = yield* controller.admit({
      explanations: [],
      transitions: [
        RunnableFrontierTransition.ContinueTaskExecution({
          operationId: OperationId.make("capacity-B-invocation"),
          taskId: taskB
        }),
        RunnableFrontierTransition.CommitFreshTaskClaimIntent({
          taskId: taskA
        }),
        RunnableFrontierTransition.CheckTaskClaim({
          operationId: OperationId.make("capacity-A-claim"),
          taskId: taskA
        }),
        RunnableFrontierTransition.CommitFreshTaskClaimIntent({
          taskId: taskC
        }),
        RunnableFrontierTransition.ContinueImplementationReview({
          operationId: OperationId.make("capacity-C-review"),
          taskId: taskC
        }),
        RunnableFrontierTransition.ContinueReviewFindingsHandback({
          operationId: OperationId.make("capacity-D-handback"),
          taskId: taskD
        })
      ]
    })
    expect(admission.transitions).toEqual([
      {
        _tag: "CommitFreshTaskClaimIntent",
        taskId: taskA
      },
      {
        _tag: "CheckTaskClaim",
        operationId: "capacity-A-claim",
        taskId: taskA
      }
    ])
    expect(admission.explanations).toEqual([
      {
        _tag: "CapacityWait",
        taskId: taskB,
        wakeCondition: "CapacityReleasedOrReconstructedStateChanged"
      },
      {
        _tag: "CapacityWait",
        taskId: taskC,
        wakeCondition: "CapacityReleasedOrReconstructedStateChanged"
      },
      {
        _tag: "CapacityWait",
        taskId: taskC,
        wakeCondition: "CapacityReleasedOrReconstructedStateChanged"
      },
      {
        _tag: "CapacityWait",
        taskId: taskD,
        wakeCondition: "CapacityReleasedOrReconstructedStateChanged"
      }
    ])

    yield* controller.releaseReservation(taskA, null)
    expect(
      (yield* controller.admit({
        explanations: [],
        transitions: [
          RunnableFrontierTransition.CommitFreshTaskClaimIntent({
            taskId: taskC
          })
        ]
      })).transitions
    ).toHaveLength(1)
    yield* controller.bindReservation(
      taskC,
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
    expect((yield* controller.snapshot()).occupied).toContainEqual({
      observationId: "capacity-C-reobservation",
      operationId: "capacity-C-reobserved",
      taskId: taskC
    })
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

it.effect("waits for an exact later invocation position without accepting a stale observation", () =>
  Effect.scoped(Effect.gen(function*() {
    const taskA = TaskId.make("waiting-A")
    const taskB = TaskId.make("waiting-B")
    const controller = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(1),
      freshOccupiedInvocations: [],
      reconstructedReservedTaskIds: []
    })
    yield* controller.admit({
      explanations: [],
      transitions: [
        RunnableFrontierTransition.CommitFreshTaskClaimIntent({ taskId: taskA })
      ]
    })
    yield* controller.bindReservation(
      taskB,
      OperationId.make("not-yet-reserved")
    )
    yield* controller.bindReservation(
      taskA,
      OperationId.make("waiting-A-execution")
    )
    expect(
      (yield* controller.admit({
        explanations: [],
        transitions: [
          RunnableFrontierTransition.ContinueTaskExecution({
            operationId: OperationId.make("different-A-execution"),
            taskId: taskA
          })
        ]
      })).transitions
    ).toEqual([])
    yield* controller.applyFreshInvocationObservation({
      _tag: "FreshCapacityConsumed",
      observationId: ProviderObservationId.make("stale-A-running"),
      operationId: OperationId.make("stale-A-execution"),
      taskId: taskA
    })
    expect(yield* controller.snapshot()).toEqual({
      capacity: 1,
      occupied: [],
      reservedTaskIds: [taskA]
    })

    const transition = RunnableFrontierTransition.ContinueImplementationReview({
      operationId: OperationId.make("waiting-B-review"),
      taskId: taskB
    })
    const waiting = yield* controller.awaitAdmission(transition).pipe(Effect.forkScoped)
    yield* Effect.yieldNow
    yield* controller.releaseReservation(
      taskA,
      OperationId.make("waiting-A-execution")
    )
    yield* Fiber.join(waiting)
    expect(yield* controller.snapshot()).toEqual({
      capacity: 1,
      occupied: [],
      reservedTaskIds: [taskB]
    })
  })))

it.effect("removes an interrupted capacity waiter before a later release", () =>
  Effect.scoped(Effect.gen(function*() {
    const taskA = TaskId.make("interrupt-wait-A")
    const taskB = TaskId.make("interrupt-wait-B")
    const controller = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(1),
      freshOccupiedInvocations: [],
      reconstructedReservedTaskIds: []
    })
    yield* controller.admit({
      explanations: [],
      transitions: [
        RunnableFrontierTransition.CommitFreshTaskClaimIntent({ taskId: taskA })
      ]
    })
    const waiting = yield* controller.awaitAdmission(
      RunnableFrontierTransition.ContinueImplementationReview({
        operationId: OperationId.make("interrupt-wait-B-review"),
        taskId: taskB
      })
    ).pipe(Effect.forkScoped)
    yield* Effect.yieldNow

    yield* Fiber.interrupt(waiting)
    yield* controller.releaseReservation(taskA, null)

    expect((yield* controller.snapshot()).reservedTaskIds).toEqual([])
  })))

it.effect("drains blocked waiters in canonical task and operation order", () =>
  Effect.scoped(Effect.gen(function*() {
    const taskA = TaskId.make("drain-A")
    const taskB = TaskId.make("drain-B")
    const taskC = TaskId.make("drain-C")
    const operationBFirst = OperationId.make("drain-B-1")
    const operationBSecond = OperationId.make("drain-B-2")
    const operationC = OperationId.make("drain-C-1")
    const controller = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(1),
      freshOccupiedInvocations: [],
      reconstructedReservedTaskIds: [taskA]
    })
    const waitC = yield* controller.awaitAdmission(
      RunnableFrontierTransition.ContinueImplementationReview({
        operationId: operationC,
        taskId: taskC
      })
    ).pipe(Effect.forkScoped)
    const waitBSecond = yield* controller.awaitAdmission(
      RunnableFrontierTransition.ContinueImplementationReview({
        operationId: operationBSecond,
        taskId: taskB
      })
    ).pipe(Effect.forkScoped)
    const waitBFirst = yield* controller.awaitAdmission(
      RunnableFrontierTransition.ContinueImplementationReview({
        operationId: operationBFirst,
        taskId: taskB
      })
    ).pipe(Effect.forkScoped)
    yield* Effect.yieldNow

    yield* controller.releaseReservation(taskA, null)
    yield* Fiber.join(waitBFirst)
    expect((yield* controller.snapshot()).reservedTaskIds).toEqual([taskB])

    yield* Fiber.interrupt(waitBSecond)
    yield* controller.releaseReservation(taskB, operationBFirst)
    yield* Fiber.join(waitC)
    expect((yield* controller.snapshot()).reservedTaskIds).toEqual([taskC])
  })))

it.effect("hands one exact reservation to one of two duplicate waiters", () =>
  Effect.scoped(Effect.gen(function*() {
    const taskA = TaskId.make("duplicate-wait-A")
    const taskB = TaskId.make("duplicate-wait-B")
    const operationB = OperationId.make("duplicate-wait-B-review")
    const transition = RunnableFrontierTransition.ContinueImplementationReview({
      operationId: operationB,
      taskId: taskB
    })
    const controller = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(1),
      freshOccupiedInvocations: [],
      reconstructedReservedTaskIds: [taskA]
    })
    const first = yield* controller.awaitAdmission(transition).pipe(Effect.forkScoped)
    yield* Effect.yieldNow
    const duplicate = yield* Effect.exit(controller.awaitAdmission(transition))
    expect(duplicate._tag).toBe("Failure")

    yield* controller.releaseReservation(taskA, null)
    yield* Fiber.join(first)
    expect((yield* controller.snapshot()).reservedTaskIds).toEqual([taskB])

    yield* controller.releaseReservation(taskB, operationB)
    expect((yield* controller.snapshot()).reservedTaskIds).toEqual([])
  })))

it.effect("hands an exact reconstructed reservation to its first waiter", () =>
  Effect.gen(function*() {
    const taskId = TaskId.make("reconstructed-wait")
    const controller = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(1),
      freshOccupiedInvocations: [],
      reconstructedReservedTaskIds: [taskId]
    })

    yield* controller.awaitAdmission(
      RunnableFrontierTransition.CommitFreshTaskClaimIntent({ taskId })
    )
    expect((yield* controller.snapshot()).reservedTaskIds).toEqual([taskId])
    yield* controller.releaseReservation(taskId, null)
  }))

it.effect("reserves at most one exact operation for a task in one admission decision", () =>
  Effect.gen(function*() {
    const taskId = TaskId.make("same-task")
    const first = RunnableFrontierTransition.ContinueImplementationReview({
      operationId: OperationId.make("same-task-review"),
      taskId
    })
    const second = RunnableFrontierTransition.ContinueReviewFindingsHandback({
      operationId: OperationId.make("same-task-handback"),
      taskId
    })
    const controller = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(2),
      freshOccupiedInvocations: [],
      reconstructedReservedTaskIds: []
    })

    expect(
      (yield* controller.admit({
        explanations: [],
        transitions: [first, second]
      })).transitions
    ).toEqual([first])

    yield* controller.releaseReservation(taskId, first.operationId)
    expect(
      (yield* controller.admit({
        explanations: [],
        transitions: [second]
      })).transitions
    ).toEqual([second])
  }))
