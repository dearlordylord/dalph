import { Match, Schema } from "effect"
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

/**
 * The provider reported no matching session on all three fresh checks, so
 * Dalph stops trying to establish one instead of looping or guessing.
 */
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
  | { readonly _tag: "Failed"; readonly error: typeof TaskWorkSessionCorrelationConflict.Type }
  | { readonly _tag: "RepeatRequest"; readonly retry: TaskWorkSessionRetry }
  | { readonly _tag: "RetryLookup"; readonly retry: TaskWorkSessionRetry }

type RetryLookupDecision = Extract<TaskWorkSessionRecoveryDecision, { readonly _tag: "RetryLookup" }>
type ReportDecision = Exclude<TaskWorkSessionRecoveryDecision, RetryLookupDecision>
type EstablishedDecision = Extract<ReportDecision, { readonly _tag: "Established" }>
type FailedDecision = Extract<ReportDecision, { readonly _tag: "Failed" }>
type RepeatRequestDecision = Extract<ReportDecision, { readonly _tag: "RepeatRequest" }>

/** The total provider-observation decision shared by live recovery and MBT. */
export function decideTaskWorkSessionRecovery(
  operation: typeof WorkflowOperation.cases.EstablishTaskWorkSession.Type,
  observation: TaskWorkSessionLookupFailure
): RetryLookupDecision
export function decideTaskWorkSessionRecovery(
  operation: typeof WorkflowOperation.cases.EstablishTaskWorkSession.Type,
  observation: TaskWorkSessionReport
): ReportDecision
export function decideTaskWorkSessionRecovery(
  operation: typeof WorkflowOperation.cases.EstablishTaskWorkSession.Type,
  observation: TaskWorkSessionReport | TaskWorkSessionLookupFailure
): TaskWorkSessionRecoveryDecision {
  if (observation instanceof TaskWorkSessionLookupFailure) {
    const error = new TaskWorkSessionLookupDidNotConverge({
      failure: observation,
      operationId: operation.request.operationId,
      plannedAttempt: operation.request.plannedAttempt
    })
    return { _tag: "RetryLookup", retry: { _tag: "Retry", atBoundError: error } }
  }
  return Match.valueTags(observation, {
    MatchingTaskWorkSessionReported: (observation): EstablishedDecision => ({
      _tag: "Established",
      outcome: WorkflowOutcome.cases.TaskWorkSessionEstablished.make({
        operationId: operation.request.operationId,
        sessionId: observation.sessionId
      })
    }),
    TaskWorkSessionCorrelationConflict: (observation): FailedDecision => ({ _tag: "Failed", error: observation }),
    NoMatchingTaskWorkSessionReported: (observation): RepeatRequestDecision => {
      const error = new TaskWorkSessionEstablishmentDidNotConverge({
        operationId: operation.request.operationId,
        plannedAttempt: operation.request.plannedAttempt,
        report: observation
      })
      return { _tag: "RepeatRequest", retry: { _tag: "Retry", atBoundError: error } }
    }
  })
}
