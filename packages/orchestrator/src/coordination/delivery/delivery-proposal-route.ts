import type { OperationId } from "../../workflow/identity.js"
import { runnableTransitionTaskId, type RunnableFrontierTransition } from "../frontier/frontier.js"
import type { NewRecoveredWorkflowAction } from "./delivery-action-proposal.js"
import { deliveryTransitionPolicy, type TransitionForRoute } from "./delivery-transition-policy.js"

export const isFreshProvenanceTransition = (
  transition: RunnableFrontierTransition
): transition is TransitionForRoute<"FreshProvenance"> =>
  deliveryTransitionPolicy[transition._tag].route === "FreshProvenance"

export const operationIdOf = (transition: RunnableFrontierTransition): OperationId | undefined => {
  if ("operationId" in transition) return transition.operationId
  if ("operation" in transition) {
    return transition.operation._tag === "ReleaseTaskClaim"
      ? transition.operation.release.operationId
      : transition.operation.operationId
  }
  return undefined
}

const withoutOperationId = <A extends { readonly operationId: OperationId }>({
  operationId: _operationId,
  ...operation
}: A): Omit<A, "operationId"> => operation

type ObservationTransition = TransitionForRoute<"Observation">

const isObservationTransition = (transition: RunnableFrontierTransition): transition is ObservationTransition =>
  deliveryTransitionPolicy[transition._tag].route === "Observation"

const recoveredObservationActionOf = (transition: ObservationTransition): NewRecoveredWorkflowAction => {
  switch (transition._tag) {
    case "ObservePlannedAttemptContinuationGraph":
      return {
        _tag: "ReadTrackerGraph",
        operation: withoutOperationId(transition.operation),
        plannedAttempt: transition.plannedAttempt
      }
    case "ObservePlannedAttemptContinuationClaim":
      return {
        _tag: "ReadTaskClaim",
        operation: withoutOperationId(transition.operation),
        plannedAttempt: transition.plannedAttempt,
        taskId: runnableTransitionTaskId(transition)
      }
    case "ObserveResponsibleTaskClaim":
      return {
        _tag: "ReadTaskClaim",
        operation: withoutOperationId(transition.operation),
        plannedAttempt: null,
        taskId: transition.taskId
      }
    case "ObserveStoppedAttemptClaim":
      return {
        _tag: "ReadTaskClaim",
        operation: withoutOperationId(transition.operation),
        plannedAttempt: transition.subject.plannedAttempt,
        taskId: transition.subject.plannedAttempt.taskId
      }
    case "ObservePlannedAttemptContinuationSpecification":
      return {
        _tag: "ReadTaskWorkSpecification",
        operation: withoutOperationId(transition.operation),
        plannedAttempt: transition.plannedAttempt
      }
    case "ObservePlannedAttemptContinuationWorktree":
      return {
        _tag: "ReadTaskWorktree",
        operation: withoutOperationId(transition.operation),
        plannedAttempt: transition.plannedAttempt
      }
    case "ObservePlannedAttemptContinuationTargetLineage":
      return {
        _tag: "ReadTargetLineage",
        operation: withoutOperationId(transition.operation),
        plannedAttempt: transition.plannedAttempt
      }
  }
}

export const newRecoveredActionOf = (
  transition: RunnableFrontierTransition
): NewRecoveredWorkflowAction | undefined => {
  if (transition._tag === "CommitTaskClaimReacquisitionIntent") {
    return {
      _tag: "TaskClaimReacquisition",
      plannedAttempt: transition.plannedAttempt,
      requestId: transition.requestId,
      taskId: transition.taskId
    }
  }
  if (transition._tag === "ReleaseExternallyCompletedTaskClaim") {
    const { operationId: _operationId, ...release } = transition.operation.release
    return {
      _tag: "ReleaseExternallyCompletedTaskClaim",
      operation: {
        _tag: "ReleaseTaskClaim",
        authority: transition.operation.authority,
        predecessorOperationIds: transition.operation.predecessorOperationIds,
        release
      },
      plannedAttempt: transition.plannedAttempt
    }
  }
  if (transition._tag === "ReleaseStoppedAttemptClaim") {
    const { operationId: _operationId, ...release } = transition.operation.release
    return {
      _tag: "ReleaseStoppedAttemptClaim",
      operation: {
        _tag: "ReleaseTaskClaim",
        authority: transition.operation.authority,
        predecessorOperationIds: transition.operation.predecessorOperationIds,
        release
      },
      plannedAttempt: transition.subject.plannedAttempt,
      requestId: transition.requestId
    }
  }
  return isObservationTransition(transition) ? recoveredObservationActionOf(transition) : undefined
}
