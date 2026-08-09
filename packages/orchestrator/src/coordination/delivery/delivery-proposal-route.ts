import type { OperationId } from "../../workflow/identity.js"
import { runnableTransitionTaskId, type RunnableFrontierTransition } from "../frontier/frontier.js"
import type { NewRecoveredWorkflowAction } from "./delivery-action-proposal.js"

type TransitionRoutePolicy = "AcceptedOperation" | "FreshProvenance" | "IdentityFree" | "NewOperation" | "Observation"

/** Closed route policy: tags sharing a spelling may still be distinguished by accepted evidence and provenance. */
export const transitionRoutePolicy = {
  AcquireStartedIntegrationTarget: "IdentityFree",
  AdvanceAttemptStoppage: "IdentityFree",
  CheckTaskClaim: "AcceptedOperation",
  CommitFreshTaskClaimIntent: "FreshProvenance",
  CommitTaskClaimReacquisitionIntent: "NewOperation",
  ContinueFreshWorkflowOperation: "FreshProvenance",
  ContinuePlannedAttemptExecutorWork: "IdentityFree",
  ObservePlannedAttemptContinuationExecutor: "IdentityFree",
  ObserveAttemptStoppageExecutor: "IdentityFree",
  ContinueStartedIntegrationCandidate: "IdentityFree",
  RunTargetVerification: "IdentityFree",
  RunTargetPromotion: "IdentityFree",
  ReplacePromotedTaskClaim: "IdentityFree",
  DeleteCompletedTaskCompletionClaim: "IdentityFree",
  ObservePlannedAttemptContinuationClaim: "Observation",
  ObservePlannedAttemptContinuationGraph: "Observation",
  ObservePlannedAttemptContinuationSpecification: "Observation",
  ObservePlannedAttemptContinuationTargetLineage: "Observation",
  ObservePlannedAttemptContinuationWorktree: "Observation",
  ObserveResponsibleTaskClaim: "Observation",
  ObserveStoppedAttemptClaim: "Observation",
  QueueAcceptedResultIntegrationResponsibility: "IdentityFree",
  ReconcileTaskClaim: "AcceptedOperation",
  ReconcileTaskClaimRelease: "AcceptedOperation",
  ReconcileTaskWorktree: "AcceptedOperation",
  RecordStoppedAttemptClaimNoRelease: "IdentityFree",
  ReleaseExternallyCompletedTaskClaim: "NewOperation",
  ReleaseStoppedAttemptClaim: "NewOperation",
  ReleaseStartedIntegrationTarget: "IdentityFree",
  StartPlannedAttemptExecutorWork: "FreshProvenance",
  StartQueuedIntegration: "IdentityFree",
  SuspendPlannedAttemptExecutorWork: "IdentityFree"
} as const satisfies Record<RunnableFrontierTransition["_tag"], TransitionRoutePolicy>

export const isFreshProvenanceTransition = (
  transition: RunnableFrontierTransition
): transition is Extract<
  RunnableFrontierTransition,
  { readonly _tag: "CommitFreshTaskClaimIntent" | "ContinueFreshWorkflowOperation" | "StartPlannedAttemptExecutorWork" }
> => transitionRoutePolicy[transition._tag] === "FreshProvenance"

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

type ObservationTransition = Extract<
  RunnableFrontierTransition,
  {
    readonly _tag:
      | "ObservePlannedAttemptContinuationClaim"
      | "ObservePlannedAttemptContinuationGraph"
      | "ObservePlannedAttemptContinuationSpecification"
      | "ObservePlannedAttemptContinuationTargetLineage"
      | "ObservePlannedAttemptContinuationWorktree"
      | "ObserveResponsibleTaskClaim"
      | "ObserveStoppedAttemptClaim"
  }
>

const isObservationTransition = (transition: RunnableFrontierTransition): transition is ObservationTransition =>
  transitionRoutePolicy[transition._tag] === "Observation"

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
