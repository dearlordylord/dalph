import type { RunId } from "@dalph/contracts"
import { Effect, Option } from "effect"
import { OperationSelected } from "../../presentation/tracker-workflow-trace.js"
import { WorkflowInterpreter, WorkflowTrace } from "../../workflow/interpretation/interpreter.js"
import { makeTaskClaimReleaseOperation } from "../../workflow/registry/operation.js"
import { TaskClaimAcquisitionPlanner } from "../../workflow/protocols/task-claim-acquisition/plan.js"
import { InRunJournal } from "../../workflow-journal/store.js"
import { RunnableFrontierTransition } from "../frontier/frontier.js"
import {
  recoverTaskClaimOperation,
  recoverTaskClaimReleaseOperation,
  recoverTaskWorktreeOperation
} from "../frontier/recovery.js"
import { runTaskClaimReacquisition } from "../run/recovery-activation.js"
import type { DeliveryActionExecutionLease } from "./delivery-action-executor.js"
import type { AcceptedWorkflowTransition, NewRecoveredWorkflowAction } from "./delivery-action-proposal.js"
import type { OperationId } from "../../workflow/identity.js"

type AcceptedRecoveryTransition = Extract<
  AcceptedWorkflowTransition,
  { readonly _tag: "CheckTaskClaim" | "ReconcileTaskClaim" | "ReconcileTaskClaimRelease" | "ReconcileTaskWorktree" }
>

const isAcceptedRecoveryTransition = (
  transition: AcceptedWorkflowTransition
): transition is AcceptedRecoveryTransition =>
  transition._tag === "CheckTaskClaim" ||
  transition._tag === "ReconcileTaskClaim" ||
  transition._tag === "ReconcileTaskClaimRelease" ||
  transition._tag === "ReconcileTaskWorktree"

const executeAcceptedRecovery = (runId: RunId, transition: AcceptedRecoveryTransition) => {
  switch (transition._tag) {
    case "CheckTaskClaim":
    case "ReconcileTaskClaim":
      return recoverTaskClaimOperation(runId, transition.operationId)
    case "ReconcileTaskClaimRelease":
      return recoverTaskClaimReleaseOperation(runId, transition.operationId)
    case "ReconcileTaskWorktree":
      return recoverTaskWorktreeOperation(runId, transition.operationId)
  }
}

export const executeNewRecoveredAction = Effect.fn("DeliveryAction.executeNewRecoveredAction")(function* (
  action: NewRecoveredWorkflowAction,
  operationId: OperationId,
  lease: DeliveryActionExecutionLease,
  runId: RunId
) {
  const interpreter = yield* WorkflowInterpreter
  const trace = yield* WorkflowTrace
  if (action._tag === "TaskClaimReacquisition") {
    const journal = yield* InRunJournal
    const planner = yield* TaskClaimAcquisitionPlanner
    yield* runTaskClaimReacquisition({
      execution: lease,
      interpreter,
      journal,
      planner: Option.some(planner),
      runId,
      trace: Option.some(trace),
      transition: RunnableFrontierTransition.CommitTaskClaimReacquisitionIntent({
        plannedAttempt: action.plannedAttempt,
        requestId: action.requestId,
        taskId: action.taskId
      })
    })
    return
  }
  if (action._tag === "ReleaseExternallyCompletedTaskClaim") {
    const operation = makeTaskClaimReleaseOperation({
      predecessorOperationIds: action.operation.predecessorOperationIds,
      release: { ...action.operation.release, operationId }
    })
    yield* trace.emit(OperationSelected.make({ operation }))
    yield* interpreter.releaseTaskClaim(operation)
    return
  }
  switch (action._tag) {
    case "ReadTrackerGraph": {
      const operation = { ...action.operation, operationId }
      yield* trace.emit(OperationSelected.make({ operation }))
      yield* interpreter.readTrackerGraph(operation)
      return
    }
    case "ReadTaskClaim": {
      const operation = { ...action.operation, operationId }
      yield* trace.emit(OperationSelected.make({ operation }))
      yield* interpreter.readTaskClaim(operation)
      return
    }
    case "ReadTaskWorkSpecification": {
      const operation = { ...action.operation, operationId }
      yield* trace.emit(OperationSelected.make({ operation }))
      yield* interpreter.readTaskWorkSpecification(operation)
      return
    }
    case "ReadTaskWorktree": {
      const operation = { ...action.operation, operationId }
      yield* trace.emit(OperationSelected.make({ operation }))
      yield* interpreter.readTaskWorktree(operation)
      return
    }
    case "ReadTargetLineage": {
      const operation = { ...action.operation, operationId }
      yield* trace.emit(OperationSelected.make({ operation }))
      yield* interpreter.readTargetLineage(operation)
      return
    }
  }
})

export const executeAcceptedWorkflowAction = Effect.fn("DeliveryAction.executeAcceptedWorkflow")(function* (
  runId: RunId,
  transition: AcceptedWorkflowTransition
) {
  if (isAcceptedRecoveryTransition(transition)) return yield* executeAcceptedRecovery(runId, transition)
  const interpreter = yield* WorkflowInterpreter
  const trace = yield* WorkflowTrace
  yield* trace.emit(OperationSelected.make({ operation: transition.operation }))
  switch (transition._tag) {
    case "ObservePlannedAttemptContinuationClaim":
    case "ObserveResponsibleTaskClaim":
      yield* interpreter.readTaskClaim(transition.operation)
      return
    case "ObservePlannedAttemptContinuationGraph":
      yield* interpreter.readTrackerGraph(transition.operation)
      return
    case "ObservePlannedAttemptContinuationSpecification":
      yield* interpreter.readTaskWorkSpecification(transition.operation)
      return
    case "ObservePlannedAttemptContinuationTargetLineage":
      yield* interpreter.readTargetLineage(transition.operation)
      return
    case "ObservePlannedAttemptContinuationWorktree":
      yield* interpreter.readTaskWorktree(transition.operation)
      return
  }
})
