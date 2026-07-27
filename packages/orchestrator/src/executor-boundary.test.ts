import { it } from "@effect/vitest"
import { Effect, Option } from "effect"
import { expect } from "vitest"
import {
  AttemptId,
  FailedProcessExitCode,
  GitCommitSha,
  JournalPosition,
  JournalRecordKey,
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
  TechnicalRetryDelayMillis,
  TechnicalRetryNotBefore,
  TechnicalRetryOrdinal,
  WorkerProcessId,
  WorktreeLocator
} from "./domain.js"
import { makeExecutorOuterInvocation, noTaskWorkCapacityUse, oneTaskWorkCapacityPosition } from "./executor-boundary.js"
import {
  intentRecordKey,
  type JournalRecord,
  outcomeRecordKey,
  TaskExecutionIntentRecorded,
  TaskExecutionOutcomeObservedEvent
} from "./journal-store.js"
import { WorkflowResponsibilityState } from "./reconstructed-managed-run-state.js"
import { reconstructManagedRunState } from "./reconstructed-managed-run.js"
import {
  deriveRunFinalityDecision,
  deriveRunnableFrontier,
  ResponsibilityDisposition,
  RunnableFrontierTransition
} from "./runnable-frontier.js"
import {
  selectedExecutorProjectionFor,
  selectedExecutorReconstructionProtocol,
  selectedExecutorTaskExecutionLookup,
  selectedExecutorTerminalFailureForTag,
  selectedExecutorTerminalFailureOutcome
} from "./selected-executor-protocol.js"
import { makeTaskAdmissionController } from "./task-admission-controller.js"
import { taskRevisionFor } from "./task-dag.js"
import { TaskExecutionOutcome, TaskExecutionRequest, TaskExecutionSessionBinding } from "./task-execution.js"
import {
  TechnicalRetryDeferralSupersededEvent,
  TechnicalRetryScheduledEvent,
  technicalRetryScheduledRecordKey,
  TechnicalRetryScope
} from "./technical-retry.js"
import { makeTaskExecutionOperation } from "./workflow-operation.js"
import { WorkflowOutcome } from "./workflow-outcome.js"

it.effect("admits executor invocations from declared capacity use, independent of protocol operation names", () =>
  Effect.gen(function*() {
    const occupiedTaskId = TaskId.make("occupied-task")
    const waitingTaskId = TaskId.make("waiting-task")
    const freeTaskId = TaskId.make("free-task")
    const controller = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(1),
      freshOccupiedInvocations: [{
        observationId: ProviderObservationId.make("occupied-observation"),
        operationId: OperationId.make("occupied-invocation"),
        taskId: occupiedTaskId
      }],
      reconstructedReservedPositions: []
    })
    const consumesCapacity = RunnableFrontierTransition
      .ContinueExecutorInvocation({
        invocation: makeExecutorOuterInvocation(
          OperationId.make("opaque-capacity-user"),
          waitingTaskId,
          oneTaskWorkCapacityPosition
        )
      })
    const doesNotConsumeCapacity = RunnableFrontierTransition
      .ContinueExecutorInvocation({
        invocation: makeExecutorOuterInvocation(
          OperationId.make("opaque-capacity-free"),
          freeTaskId,
          noTaskWorkCapacityUse
        )
      })

    const decision = yield* controller.admit(
      {
        explanations: [],
        transitions: [consumesCapacity, doesNotConsumeCapacity]
      },
      RunId.make("declared-resource-use-run")
    )

    expect(decision.transition).toEqual(Option.some(doesNotConsumeCapacity))
    expect(decision.explanations).toContainEqual({
      _tag: "CapacityWait",
      taskId: waitingTaskId,
      wakeCondition: "CapacityReleasedOrReconstructedStateChanged"
    })
  }))

it.effect("keeps two tasks within capacity as opaque invocation purposes change", () =>
  Effect.gen(function*() {
    const runId = RunId.make("two-task-declared-resource-use")
    const tasks = [
      TaskId.make("two-task-A"),
      TaskId.make("two-task-B")
    ] as const
    const controller = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(2),
      freshOccupiedInvocations: [],
      reconstructedReservedPositions: []
    })
    const capacityUsing = tasks.map((taskId, index) =>
      RunnableFrontierTransition.ContinueExecutorInvocation({
        invocation: makeExecutorOuterInvocation(
          OperationId.make(
            index === 0
              ? "name-that-looks-like-evidence-but-is-opaque"
              : "name-that-looks-like-handback-but-is-opaque"
          ),
          taskId,
          oneTaskWorkCapacityPosition
        )
      })
    )

    for (const transition of capacityUsing) {
      expect(
        (yield* controller.admit({
          explanations: [],
          transitions: [transition]
        }, runId)).transition
      ).toEqual(Option.some(transition))
    }
    expect((yield* controller.snapshot()).reservedTaskIds).toEqual(tasks)

    const capacityFree = tasks.map((taskId, index) =>
      RunnableFrontierTransition.ContinueExecutorInvocation({
        invocation: makeExecutorOuterInvocation(
          OperationId.make(
            index === 0
              ? "name-that-looks-like-execution-but-is-free"
              : "name-that-looks-like-review-but-is-free"
          ),
          taskId,
          noTaskWorkCapacityUse
        )
      })
    )
    for (const transition of capacityFree) {
      expect(
        (yield* controller.admit({
          explanations: [],
          transitions: [transition]
        }, runId)).transition
      ).toEqual(Option.some(transition))
    }
    expect((yield* controller.snapshot()).reservedTaskIds).toEqual(tasks)
  }))

it.effect("reconstructs hundreds of completed outer invocations idempotently without reserving capacity", () =>
  Effect.gen(function*() {
    const runId = RunId.make("high-cardinality-completed-invocations")
    const taskId = TaskId.make("high-cardinality-task")
    const sessionId = TaskWorkSessionId.make("high-cardinality-session")
    const task = {
      id: taskId,
      lifecycle: TaskLifecycle.cases.Open.make({}),
      parentTaskId: null,
      prerequisiteIds: []
    }
    const plannedAttempt = PlannedTaskAttempt.make({
      attemptId: AttemptId.make("high-cardinality-attempt"),
      baseSha: GitCommitSha.make("0123456789abcdef0123456789abcdef01234567"),
      branch: TaskBranchRef.make("refs/heads/dalph/high-cardinality"),
      executor: TaskExecutorLocator.make("executor:high-cardinality"),
      runId,
      session: TaskWorkSessionLocator.make("session:high-cardinality"),
      taskId,
      taskRevision: taskRevisionFor(task),
      worktree: WorktreeLocator.make("/tmp/dalph-high-cardinality")
    })
    const invocationCount = 512
    const records = Array.from({ length: invocationCount }, (_, index) => {
      const operationId = OperationId.make(`completed-invocation-${index}`)
      const operation = makeTaskExecutionOperation({
        predecessorOperationIds: [],
        request: TaskExecutionRequest.make({
          operationId,
          plannedAttempt,
          session: TaskExecutionSessionBinding.cases.EstablishedSession.make({
            sessionId
          }),
          task
        })
      })
      return [
        {
          event: TaskExecutionIntentRecorded.make({ operation, version: 4 }),
          key: intentRecordKey(operationId),
          position: JournalPosition.make(index * 2 + 1),
          runId
        },
        {
          event: TaskExecutionOutcomeObservedEvent.make({
            outcome: WorkflowOutcome.cases.TaskExecutionObserved.make({
              outcome: TaskExecutionOutcome.cases.Succeeded.make({
                observationId: ProviderObservationId.make(
                  `completed-observation-${index}`
                ),
                operationId,
                output: "completed",
                processId: WorkerProcessId.make(index + 1),
                sessionId
              })
            }),
            version: 4
          }),
          key: outcomeRecordKey(operationId),
          position: JournalPosition.make(index * 2 + 2),
          runId
        }
      ] as const
    }).flat()
    const reconstructed = reconstructManagedRunState(
      runId,
      records,
      selectedExecutorReconstructionProtocol
    )
    expect(reconstructed._tag).toBe("ValidReconstructedManagedRun")
    if (reconstructed._tag !== "ValidReconstructedManagedRun") return
    expect(reconstructed.state.responsibility.entries).toHaveLength(
      invocationCount
    )
    const responsibilityFacts = reconstructed.state.responsibility.entries.flatMap(
      (responsibility) => {
        if (responsibility._tag !== "ExecutorInvocationResponsibility") {
          return []
        }
        const projection = selectedExecutorProjectionFor(
          records,
          responsibility.invocation,
          TechnicalRetryNotBefore.make(0)
        )
        if (projection._tag !== "Completed") {
          return []
        }
        return [{
          disposition: ResponsibilityDisposition.ExecutorInvocationSettled({
            outcome: projection.outcome
          }),
          responsibility
        }]
      }
    )
    expect(responsibilityFacts).toHaveLength(invocationCount)
    const derive = () =>
      deriveRunnableFrontier({
        freshEligibleTasks: [],
        responsibility: reconstructed.state.responsibility,
        responsibilityFacts
      })
    const first = derive()
    const second = derive()
    expect(second).toEqual(first)
    expect(first.transitions).toEqual([])
    expect(first.explanations).toHaveLength(invocationCount)
    expect(
      deriveRunFinalityDecision(
        first,
        reconstructed.state.responsibility,
        true
      )
    ).toEqual({ _tag: "RunMayTerminate" })

    const controller = yield* makeTaskAdmissionController({
      capacity: TaskWorkCapacity.make(2),
      freshOccupiedInvocations: [],
      reconstructedReservedPositions: first.transitions.flatMap(
        (transition) =>
          transition._tag === "ContinueExecutorInvocation"
            && transition.invocation.resourceUse._tag
              === "UsesTaskWorkCapacity"
            ? [{
              operationId: transition.invocation.correlation.invocationId,
              taskId: transition.invocation.correlation.taskId
            }]
            : []
      )
    })
    expect((yield* controller.snapshot()).reservedPositions).toEqual([])
    expect(
      WorkflowResponsibilityState.make({
        entries: reconstructed.state.responsibility.entries
      })
    ).toEqual(reconstructed.state.responsibility)
  }))

it("projects a pending selected-executor retry as an exact outer wait", () => {
  const operationId = OperationId.make("retrying-outer-invocation")
  const invocation = makeExecutorOuterInvocation(
    operationId,
    TaskId.make("retrying-task"),
    oneTaskWorkCapacityPosition
  )
  const scope = TechnicalRetryScope.cases.ImplementationReviewInvocation.make({
    operationId,
    reviewerSessionId: ReviewerSessionId.make("retrying-reviewer"),
    semanticRound: SemanticReviewRound.make(1)
  })
  const retryOrdinal = TechnicalRetryOrdinal.make(1)
  const notBefore = TechnicalRetryNotBefore.make(250)
  const event = TechnicalRetryScheduledEvent.make({
    delayMillis: TechnicalRetryDelayMillis.make(100),
    notBefore,
    retryOrdinal,
    scope,
    version: 4
  })

  const records = [{
    event,
    key: technicalRetryScheduledRecordKey(scope, retryOrdinal),
    position: JournalPosition.make(1),
    runId: RunId.make("retrying-run")
  }]
  expect(selectedExecutorProjectionFor(
    records,
    invocation,
    TechnicalRetryNotBefore.make(249)
  )).toEqual({
    _tag: "Waiting",
    wait: {
      _tag: "RetryScheduled",
      correlation: invocation.correlation,
      notBefore
    }
  })
  expect(selectedExecutorProjectionFor(
    records,
    invocation,
    TechnicalRetryNotBefore.make(250)
  )).toEqual({
    _tag: "Ready"
  })

  const superseded = TechnicalRetryDeferralSupersededEvent.make({
    retryOrdinal,
    scope,
    version: 4
  })
  expect(selectedExecutorProjectionFor(
    [
      ...records,
      {
        event: superseded,
        key: JournalRecordKey.make("retry-superseded"),
        position: JournalPosition.make(2),
        runId: RunId.make("retrying-run")
      }
    ],
    invocation,
    TechnicalRetryNotBefore.make(249)
  )).toEqual({ _tag: "Ready" })
})

it("normalizes terminal worker outcomes without inspecting output", () => {
  const operationId = OperationId.make("terminal-outer-invocation")
  const taskId = TaskId.make("terminal-task")
  const invocation = makeExecutorOuterInvocation(
    operationId,
    taskId,
    oneTaskWorkCapacityPosition
  )
  const sessionId = TaskWorkSessionId.make("terminal-session")
  const processId = WorkerProcessId.make(42)
  const outcomes = [
    TaskExecutionOutcome.cases.Succeeded.make({
      observationId: ProviderObservationId.make("success-observation"),
      operationId,
      output: "ignored success output",
      processId,
      sessionId
    }),
    TaskExecutionOutcome.cases.Failed.make({
      exitCode: FailedProcessExitCode.make(1),
      observationId: ProviderObservationId.make("failure-observation"),
      operationId,
      partialOutput: "ignored failure output",
      processId,
      sessionId,
      wipPreserved: true
    }),
    TaskExecutionOutcome.cases.Interrupted.make({
      observationId: ProviderObservationId.make("interruption-observation"),
      operationId,
      partialOutput: "ignored interruption output",
      processId,
      sessionId,
      wipPreserved: true
    })
  ]
  const expectedTags = ["Completed", "Failed", "Interrupted"]

  expect(outcomes.map((outcome, index) => {
    const event = TaskExecutionOutcomeObservedEvent.make({
      outcome: WorkflowOutcome.cases.TaskExecutionObserved.make({ outcome }),
      version: 4
    })
    const records: ReadonlyArray<JournalRecord> = [{
      event,
      key: JournalRecordKey.make(`terminal-outcome:${index}`),
      position: JournalPosition.make(1),
      runId: RunId.make("terminal-run")
    }]
    const projection = selectedExecutorProjectionFor(
      records,
      invocation,
      TechnicalRetryNotBefore.make(0)
    )
    return projection._tag === "Completed"
      ? projection.outcome._tag
      : "unexpected"
  })).toEqual(expectedTags)

  expect(
    selectedExecutorTaskExecutionLookup([], operationId)
  ).toBeUndefined()
  expect([
    selectedExecutorTerminalFailureForTag("ImplementationNonConvergent"),
    selectedExecutorTerminalFailureForTag("ReviewTechnicalRetryExhausted"),
    selectedExecutorTerminalFailureForTag("Accepted")
  ]).toEqual(["NonConvergent", "Failed", undefined])
  expect([
    selectedExecutorTerminalFailureOutcome(
      invocation.correlation,
      "NonConvergent"
    )._tag,
    selectedExecutorTerminalFailureOutcome(
      invocation.correlation,
      "Failed"
    )._tag
  ]).toEqual(["NonConvergent", "Failed"])
})
