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
  TechnicalRetryNotBefore,
  WorkerProcessId,
  WorktreeLocator
} from "./domain.js"
import {
  intentRecordKey,
  outcomeRecordKey,
  TaskExecutionIntentRecorded,
  TaskExecutionOutcomeObservedEvent
} from "./journal-store.js"
import { reconstructManagedRunState } from "./reconstructed-managed-run.js"
import { deriveRunFinalityDecision, deriveRunnableFrontier, ResponsibilityDisposition } from "./runnable-frontier.js"
import { selectedExecutorProjectionFor, selectedExecutorReconstructionProtocol } from "./selected-executor-protocol.js"
import { makeTaskAdmissionController } from "./task-admission-controller.js"
import { taskRevisionFor } from "./task-dag.js"
import { TaskExecutionOutcome, TaskExecutionRequest, TaskExecutionSessionBinding } from "./task-execution.js"
import { makeTaskExecutionOperation } from "./workflow-operation.js"
import { WorkflowOutcome } from "./workflow-outcome.js"

it.effect("reconstructs hundreds of completed outer invocations idempotently without reserving capacity", () =>
  Effect.gen(function*() {
    const runId = RunId.make("high-cardinality-completed-invocations")
    const invocationCount = 512
    const records = Array.from({ length: invocationCount }, (_, index) => {
      const operationId = OperationId.make(`completed-invocation-${index}`)
      const taskId = TaskId.make(`high-cardinality-task-${index}`)
      const sessionId = TaskWorkSessionId.make(
        `high-cardinality-session-${index}`
      )
      const task = {
        id: taskId,
        lifecycle: TaskLifecycle.cases.Open.make({}),
        parentTaskId: null,
        prerequisiteIds: []
      }
      const plannedAttempt = PlannedTaskAttempt.make({
        attemptId: AttemptId.make(`high-cardinality-attempt-${index}`),
        baseSha: GitCommitSha.make(
          "0123456789abcdef0123456789abcdef01234567"
        ),
        branch: TaskBranchRef.make(
          `refs/heads/dalph/high-cardinality-${index}`
        ),
        executor: TaskExecutorLocator.make("executor:high-cardinality"),
        runId,
        session: TaskWorkSessionLocator.make(
          `session:high-cardinality-${index}`
        ),
        taskId,
        taskRevision: taskRevisionFor(task),
        worktree: WorktreeLocator.make(
          `/tmp/dalph-high-cardinality-${index}`
        )
      })
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
    expect(
      reconstructManagedRunState(
        runId,
        records,
        selectedExecutorReconstructionProtocol
      )
    ).toEqual(reconstructed)
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
            && transition.capacityRequirement._tag === "OneTaskWorkPosition"
            ? [{
              operationId: transition.invocation.correlation.invocationId,
              taskId: transition.invocation.correlation.taskId
            }]
            : []
      )
    })
    expect((yield* controller.snapshot()).reservedPositions).toEqual([])
  }))
