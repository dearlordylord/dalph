import type { RunId } from "@dalph/contracts"
import { Effect, Option } from "effect"
import { OperationSelected } from "../../presentation/tracker-workflow-trace.js"
import { WorkflowInterpreter, WorkflowTrace } from "../../workflow/interpretation/interpreter.js"
import { makeTaskClaimReleaseOperation } from "../../workflow/registry/operation.js"
import { TaskClaimAcquisitionPlanner } from "../../workflow/protocols/task-claim-acquisition/plan.js"
import { InRunJournal } from "../../workflow-journal/store.js"
import {
  recoverTaskClaimOperation,
  recoverTaskClaimReleaseOperation,
  recoverTaskWorktreeOperation
} from "../frontier/recovery.js"
import { runTaskClaimReacquisition } from "../../workflow/protocols/task-claim-reacquisition/execute.js"
import type { DeliveryActionExecutionLease } from "./delivery-action-executor.js"
import type { AcceptedWorkflowTransition, NewRecoveredWorkflowAction } from "./delivery-action-proposal.js"
import type { OperationId } from "../../workflow/identity.js"
import { acceptedTransitionExecutionOf, type TransitionForAcceptedExecution } from "./delivery-transition-policy.js"

type AcceptedRecoveryTransition = TransitionForAcceptedExecution<"Recovery">

type AcceptedObservationTransition = TransitionForAcceptedExecution<"Observation">
type StoppedClaimReleaseRetryTransition = TransitionForAcceptedExecution<"StoppedClaimReleaseRetry">

const isAcceptedRecoveryTransition = (
  transition: AcceptedWorkflowTransition
): transition is AcceptedRecoveryTransition => acceptedTransitionExecutionOf(transition) === "Recovery"

const isStoppedClaimReleaseRetryTransition = (
  transition: AcceptedWorkflowTransition
): transition is StoppedClaimReleaseRetryTransition =>
  acceptedTransitionExecutionOf(transition) === "StoppedClaimReleaseRetry"

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

const executeRecoveredObservation = Effect.fn("DeliveryAction.executeRecoveredObservation")(function* (
  action: Exclude<
    NewRecoveredWorkflowAction,
    Extract<
      NewRecoveredWorkflowAction,
      { readonly _tag: "TaskClaimReacquisition" | "ReleaseExternallyCompletedTaskClaim" | "ReleaseStoppedAttemptClaim" }
    >
  >,
  operationId: OperationId
) {
  const interpreter = yield* WorkflowInterpreter
  const trace = yield* WorkflowTrace
  switch (action._tag) {
    case "ReadTrackerGraph": {
      const operation = { ...action.operation, operationId }
      yield* trace.emit(OperationSelected.make({ operation }))
      return yield* interpreter.readTrackerGraph(operation)
    }
    case "ReadTaskClaim": {
      const operation = { ...action.operation, operationId }
      yield* trace.emit(OperationSelected.make({ operation }))
      return yield* interpreter.readTaskClaim(operation)
    }
    case "ReadTaskWorkSpecification": {
      const operation = { ...action.operation, operationId }
      yield* trace.emit(OperationSelected.make({ operation }))
      return yield* interpreter.readTaskWorkSpecification(operation)
    }
    case "ReadTaskWorktree": {
      const operation = { ...action.operation, operationId }
      yield* trace.emit(OperationSelected.make({ operation }))
      return yield* interpreter.readTaskWorktree(operation)
    }
    case "ReadTargetLineage": {
      const operation = { ...action.operation, operationId }
      yield* trace.emit(OperationSelected.make({ operation }))
      return yield* interpreter.readTargetLineage(operation)
    }
  }
})

const executeAcceptedObservation = Effect.fn("DeliveryAction.executeAcceptedObservation")(function* (
  transition: AcceptedObservationTransition
) {
  const interpreter = yield* WorkflowInterpreter
  const trace = yield* WorkflowTrace
  yield* trace.emit(OperationSelected.make({ operation: transition.operation }))
  switch (transition._tag) {
    case "ObservePlannedAttemptContinuationClaim":
    case "ObserveResponsibleTaskClaim":
    case "ObserveStoppedAttemptClaim":
      return yield* interpreter.readTaskClaim(transition.operation)
    case "ObservePlannedAttemptContinuationGraph":
      return yield* interpreter.readTrackerGraph(transition.operation)
    case "ObservePlannedAttemptContinuationSpecification":
      return yield* interpreter.readTaskWorkSpecification(transition.operation)
    case "ObservePlannedAttemptContinuationTargetLineage":
      return yield* interpreter.readTargetLineage(transition.operation)
    case "ObservePlannedAttemptContinuationWorktree":
      return yield* interpreter.readTaskWorktree(transition.operation)
  }
})

export const executeNewRecoveredAction = Effect.fn("DeliveryAction.executeNewRecoveredAction")(function* (
  action: NewRecoveredWorkflowAction,
  operationId: OperationId,
  lease: DeliveryActionExecutionLease,
  runId: RunId
) {
  if (action._tag === "TaskClaimReacquisition") {
    const interpreter = yield* WorkflowInterpreter
    const trace = yield* WorkflowTrace
    const journal = yield* InRunJournal
    const planner = yield* TaskClaimAcquisitionPlanner
    yield* runTaskClaimReacquisition({
      execution: lease,
      interpreter,
      journal,
      planner: Option.some(planner),
      requestId: action.requestId,
      runId,
      taskId: action.taskId,
      trace: Option.some(trace)
    })
    return
  }
  if (action._tag === "ReleaseExternallyCompletedTaskClaim" || action._tag === "ReleaseStoppedAttemptClaim") {
    const interpreter = yield* WorkflowInterpreter
    const trace = yield* WorkflowTrace
    const operation = makeTaskClaimReleaseOperation({
      authority: action.operation.authority,
      predecessorOperationIds: action.operation.predecessorOperationIds,
      release: { ...action.operation.release, operationId }
    })
    yield* trace.emit(OperationSelected.make({ operation }))
    yield* interpreter.releaseTaskClaim(operation)
    return
  }
  return yield* executeRecoveredObservation(action, operationId)
})

export const executeAcceptedWorkflowAction = Effect.fn("DeliveryAction.executeAcceptedWorkflow")(function* (
  runId: RunId,
  transition: AcceptedWorkflowTransition
) {
  if (isStoppedClaimReleaseRetryTransition(transition)) {
    const interpreter = yield* WorkflowInterpreter
    const trace = yield* WorkflowTrace
    yield* trace.emit(OperationSelected.make({ operation: transition.operation }))
    return yield* interpreter.releaseTaskClaim(transition.operation)
  }
  if (isAcceptedRecoveryTransition(transition)) return yield* executeAcceptedRecovery(runId, transition)
  return yield* executeAcceptedObservation(transition)
})
