import { Schema } from "effect"
import { OperationId, PlannedTaskAttempt } from "./domain.js"
import type { TaskWorkSessionCorrelationConflict, TaskWorkSessionReport } from "./task-work-start.js"
import { NoMatchingTaskWorkSessionReported, TaskWorkSessionLookupFailure } from "./task-work-start.js"
import type { WorkflowOperation } from "./workflow-operation.js"
import { WorkflowOutcome } from "./workflow-outcome.js"

/** Three fresh lookups completed without readable provider evidence. */
export class TaskWorkSessionLookupDidNotConverge extends Schema.TaggedErrorClass<TaskWorkSessionLookupDidNotConverge>()(
  "TaskWorkSessionLookupDidNotConverge",
  {
    failure: TaskWorkSessionLookupFailure,
    operationId: OperationId,
    plannedAttempt: PlannedTaskAttempt
  }
) {}

/** Three fresh lookups proved absence without establishing a session. */
export class TaskWorkSessionEstablishmentDidNotConverge
  extends Schema.TaggedErrorClass<TaskWorkSessionEstablishmentDidNotConverge>()(
    "TaskWorkSessionEstablishmentDidNotConverge",
    {
      operationId: OperationId,
      plannedAttempt: PlannedTaskAttempt,
      report: NoMatchingTaskWorkSessionReported
    }
  )
{}

type TaskWorkSessionRetry = {
  readonly _tag: "Retry"
  readonly atBoundError:
    | TaskWorkSessionEstablishmentDidNotConverge
    | TaskWorkSessionLookupDidNotConverge
}

type TaskWorkSessionRecoveryDecision =
  | {
    readonly _tag: "Established"
    readonly outcome: typeof WorkflowOutcome.cases.TaskWorkSessionEstablished.Type
  }
  | {
    readonly _tag: "Failed"
    readonly error:
      | typeof TaskWorkSessionCorrelationConflict.Type
      | TaskWorkSessionEstablishmentDidNotConverge
      | TaskWorkSessionLookupDidNotConverge
  }
  | { readonly _tag: "RepeatRequest"; readonly retry: TaskWorkSessionRetry }
  | { readonly _tag: "RetryLookup"; readonly retry: TaskWorkSessionRetry }

type RetryLookupDecision = Extract<TaskWorkSessionRecoveryDecision, { readonly _tag: "RetryLookup" }>
type ReportDecision = Exclude<TaskWorkSessionRecoveryDecision, RetryLookupDecision>

/** The total provider-observation decision shared by live recovery and MBT. */
export function decideTaskWorkSessionRecovery(
  operation: typeof WorkflowOperation.cases.EstablishTaskWorkSession.Type,
  observation: TaskWorkSessionLookupFailure,
  atLookupBound: false
): RetryLookupDecision
export function decideTaskWorkSessionRecovery(
  operation: typeof WorkflowOperation.cases.EstablishTaskWorkSession.Type,
  observation: TaskWorkSessionReport,
  atLookupBound: false
): ReportDecision
export function decideTaskWorkSessionRecovery(
  operation: typeof WorkflowOperation.cases.EstablishTaskWorkSession.Type,
  observation: TaskWorkSessionReport | TaskWorkSessionLookupFailure,
  atLookupBound: boolean
): TaskWorkSessionRecoveryDecision
export function decideTaskWorkSessionRecovery(
  operation: typeof WorkflowOperation.cases.EstablishTaskWorkSession.Type,
  observation: TaskWorkSessionReport | TaskWorkSessionLookupFailure,
  atLookupBound: boolean
): TaskWorkSessionRecoveryDecision {
  if (observation instanceof TaskWorkSessionLookupFailure) {
    const error = new TaskWorkSessionLookupDidNotConverge({
      failure: observation,
      operationId: operation.request.operationId,
      plannedAttempt: operation.request.plannedAttempt
    })
    return atLookupBound
      ? { _tag: "Failed", error }
      : { _tag: "RetryLookup", retry: { _tag: "Retry", atBoundError: error } }
  }
  switch (observation._tag) {
    case "MatchingTaskWorkSessionReported":
      return {
        _tag: "Established",
        outcome: WorkflowOutcome.cases.TaskWorkSessionEstablished.make({
          operationId: operation.request.operationId,
          sessionId: observation.sessionId
        })
      }
    case "TaskWorkSessionCorrelationConflict":
      return { _tag: "Failed", error: observation }
    case "NoMatchingTaskWorkSessionReported": {
      const error = new TaskWorkSessionEstablishmentDidNotConverge({
        operationId: operation.request.operationId,
        plannedAttempt: operation.request.plannedAttempt,
        report: observation
      })
      return atLookupBound
        ? { _tag: "Failed", error }
        : { _tag: "RepeatRequest", retry: { _tag: "Retry", atBoundError: error } }
    }
  }
}
