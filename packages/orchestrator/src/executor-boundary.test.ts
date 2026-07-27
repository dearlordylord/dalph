import { it } from "@effect/vitest"
import { Effect, Option } from "effect"
import { expect } from "vitest"
import {
  FailedProcessExitCode,
  JournalPosition,
  JournalRecordKey,
  OperationId,
  ProviderObservationId,
  ReviewerSessionId,
  RunId,
  SemanticReviewRound,
  TaskId,
  TaskWorkCapacity,
  TaskWorkSessionId,
  TechnicalRetryDelayMillis,
  TechnicalRetryNotBefore,
  TechnicalRetryOrdinal,
  WorkerProcessId
} from "./domain.js"
import { makeExecutorOuterInvocation, noTaskWorkCapacityUse, oneTaskWorkCapacityPosition } from "./executor-boundary.js"
import { type JournalRecord, TaskExecutionOutcomeObservedEvent } from "./journal-store.js"
import { RunnableFrontierTransition } from "./runnable-frontier.js"
import {
  selectedExecutorProjectionFor,
  selectedExecutorTaskExecutionLookup,
  selectedExecutorTerminalFailureForTag,
  selectedExecutorTerminalFailureOutcome
} from "./selected-executor-protocol.js"
import { makeTaskAdmissionController } from "./task-admission-controller.js"
import { TaskExecutionOutcome } from "./task-execution.js"
import {
  TechnicalRetryDeferralSupersededEvent,
  TechnicalRetryScheduledEvent,
  technicalRetryScheduledRecordKey,
  TechnicalRetryScope
} from "./technical-retry.js"
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
