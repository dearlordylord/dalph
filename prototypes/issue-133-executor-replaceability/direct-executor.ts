import { Effect } from "effect"
import type { OperationId } from "../../packages/orchestrator/src/domain.js"
import {
  ExecutorOuterInvocationOutcome,
  ExecutorOuterInvocationProjection,
  makeExecutorOuterInvocation,
  oneTaskWorkCapacityPosition
} from "../../packages/orchestrator/src/executor-boundary.js"
import type { JournalRecord } from "../../packages/orchestrator/src/journal-store.js"
import { WorkflowResponsibilityEntry } from "../../packages/orchestrator/src/reconstructed-managed-run-state.js"
import { recoverTaskExecutions } from "../../packages/orchestrator/src/workflow-operation-recovery.js"
import type { ExecutorProtocol } from "./executor-protocol.js"

const responsibilityFor = (
  _records: ReadonlyArray<JournalRecord>,
  record: JournalRecord,
  _hasOutcome: (records: ReadonlyArray<JournalRecord>, operationId: OperationId) => boolean
) => {
  const event = record.event
  return event._tag === "TaskExecutionIntentRecorded"
    ? WorkflowResponsibilityEntry.cases.ExecutorInvocationResponsibility.make({
      beganAt: record.position,
      invocation: makeExecutorOuterInvocation(
        event.operation.request.operationId,
        event.operation.request.plannedAttempt.taskId,
        oneTaskWorkCapacityPosition
      )
    })
    : undefined
}

/**
 * PROTOTYPE: a materially different executor ends after its implementer exits.
 * It owns no evidence sealing, reviewer, findings handback, retry deadline, or
 * convergence stages.
 */
export const directExecutor = {
  name: "direct",
  project: (records, invocation) => {
    const event = records.find(({ event: candidate }) =>
      candidate._tag === "TaskExecutionOutcomeObserved"
      && candidate.outcome.outcome.operationId === invocation.correlation.invocationId
    )?.event
    if (event?._tag !== "TaskExecutionOutcomeObserved") {
      return ExecutorOuterInvocationProjection.cases.Ready.make({})
    }
    const outcome = event.outcome.outcome
    return ExecutorOuterInvocationProjection.cases.Completed.make({
      outcome: outcome._tag === "Interrupted"
        ? ExecutorOuterInvocationOutcome.cases.Interrupted.make({
          interruption: {
            correlation: invocation.correlation,
            observationId: outcome.observationId
          }
        })
        : outcome._tag === "Succeeded"
        ? ExecutorOuterInvocationOutcome.cases.Completed.make({
          correlation: invocation.correlation
        })
        : ExecutorOuterInvocationOutcome.cases.Failed.make({
          correlation: invocation.correlation
        })
    })
  },
  reconstruction: {
    responsibilityFor,
    unresolvedSubjects: () => []
  },
  recoverInvocation: recoverTaskExecutions,
  recoveredStages: () => Effect.succeed([])
} satisfies ExecutorProtocol
