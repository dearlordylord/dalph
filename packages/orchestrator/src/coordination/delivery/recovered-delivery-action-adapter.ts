import type { RunId } from "@dalph/contracts"
import { Effect, Match, Option } from "effect"
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
import { type DeliveryActionExecutionLease, interruptibleBoundaryOf } from "./delivery-action-executor.js"
import type { AcceptedWorkflowTransition, NewRecoveredWorkflowAction } from "./delivery-action-proposal.js"
import type { OperationId } from "../../workflow/identity.js"

type AcceptedRecoveryTransition = Extract<
  AcceptedWorkflowTransition,
  { readonly _tag: "CheckTaskClaim" | "ReconcileTaskClaim" | "ReconcileTaskClaimRelease" | "ReconcileTaskWorktree" }
>

type AcceptedObservationTransition = Extract<
  AcceptedWorkflowTransition,
  {
    readonly _tag:
      | "ObservePlannedAttemptContinuationClaim"
      | "ObserveResponsibleTaskClaim"
      | "ObserveStoppedAttemptClaim"
      | "ObserveCancelledAttemptClaim"
      | "ObservePlannedAttemptContinuationGraph"
      | "ObservePlannedAttemptContinuationSpecification"
      | "ObservePlannedAttemptContinuationTargetLineage"
      | "ObservePlannedAttemptContinuationWorktree"
  }
>
type BoundaryExecutionLease = Pick<DeliveryActionExecutionLease, "forwardBoundary" | "recordIntent">

/** Executes the protocol carried by each accepted transition without consulting planning policy. */
const executeAcceptedRecovery = (runId: RunId, transition: AcceptedRecoveryTransition, lease: BoundaryExecutionLease) =>
  Match.valueTags(transition, {
    CheckTaskClaim: ({ operationId }) => recoverTaskClaimOperation(runId, operationId, lease),
    ReconcileTaskClaim: ({ operationId }) => recoverTaskClaimOperation(runId, operationId, lease),
    ReconcileTaskClaimRelease: ({ operationId }) => recoverTaskClaimReleaseOperation(runId, operationId, lease),
    ReconcileTaskWorktree: ({ operationId }) => recoverTaskWorktreeOperation(runId, operationId, lease)
  })

const executeRecoveredObservation = Effect.fn("DeliveryAction.executeRecoveredObservation")(function* (
  action: Exclude<
    NewRecoveredWorkflowAction,
    Extract<
      NewRecoveredWorkflowAction,
      {
        readonly _tag:
          | "TaskClaimReacquisition"
          | "ReleaseExternallyCompletedTaskClaim"
          | "ReleaseStoppedAttemptClaim"
          | "ReleaseCancelledAttemptClaim"
      }
    >
  >,
  operationId: OperationId,
  lease: BoundaryExecutionLease
) {
  const interpreter = yield* WorkflowInterpreter
  const trace = yield* WorkflowTrace
  return yield* Match.valueTags(action, {
    ReadTrackerGraph: (action) =>
      Effect.gen(function* () {
        const operation = { ...action.operation, operationId }
        yield* trace.emit(OperationSelected.make({ operation }))
        return yield* interpreter.readTrackerGraph(
          operation,
          lease.recordIntent(operationId),
          interruptibleBoundaryOf(lease)
        )
      }),
    ReadTaskClaim: (action) =>
      Effect.gen(function* () {
        const operation = { ...action.operation, operationId }
        yield* trace.emit(OperationSelected.make({ operation }))
        return yield* interpreter.readTaskClaim(
          operation,
          lease.recordIntent(operationId),
          interruptibleBoundaryOf(lease)
        )
      }),
    ReadTaskWorkSpecification: (action) =>
      Effect.gen(function* () {
        const operation = { ...action.operation, operationId }
        yield* trace.emit(OperationSelected.make({ operation }))
        return yield* interpreter.readTaskWorkSpecification(
          operation,
          lease.recordIntent(operationId),
          interruptibleBoundaryOf(lease)
        )
      }),
    ReadTaskWorktree: (action) =>
      Effect.gen(function* () {
        const operation = { ...action.operation, operationId }
        yield* trace.emit(OperationSelected.make({ operation }))
        return yield* interpreter.readTaskWorktree(
          operation,
          lease.recordIntent(operationId),
          interruptibleBoundaryOf(lease)
        )
      }),
    ReadTargetLineage: (action) =>
      Effect.gen(function* () {
        const operation = { ...action.operation, operationId }
        yield* trace.emit(OperationSelected.make({ operation }))
        return yield* interpreter.readTargetLineage(
          operation,
          lease.recordIntent(operationId),
          interruptibleBoundaryOf(lease)
        )
      })
  })
})

const executeAcceptedObservation = Effect.fn("DeliveryAction.executeAcceptedObservation")(function* (
  transition: AcceptedObservationTransition,
  lease: BoundaryExecutionLease
) {
  const interpreter = yield* WorkflowInterpreter
  const trace = yield* WorkflowTrace
  yield* trace.emit(OperationSelected.make({ operation: transition.operation }))
  return yield* Match.valueTags(transition, {
    ObservePlannedAttemptContinuationClaim: ({ operation }) =>
      interpreter.readTaskClaim(operation, lease.recordIntent(operation.operationId), interruptibleBoundaryOf(lease)),
    ObserveResponsibleTaskClaim: ({ operation }) =>
      interpreter.readTaskClaim(operation, lease.recordIntent(operation.operationId), interruptibleBoundaryOf(lease)),
    ObserveStoppedAttemptClaim: ({ operation }) =>
      interpreter.readTaskClaim(operation, lease.recordIntent(operation.operationId), interruptibleBoundaryOf(lease)),
    ObserveCancelledAttemptClaim: ({ operation }) =>
      interpreter.readTaskClaim(operation, lease.recordIntent(operation.operationId), interruptibleBoundaryOf(lease)),
    ObservePlannedAttemptContinuationGraph: ({ operation }) =>
      interpreter.readTrackerGraph(
        operation,
        lease.recordIntent(operation.operationId),
        interruptibleBoundaryOf(lease)
      ),
    ObservePlannedAttemptContinuationSpecification: ({ operation }) =>
      interpreter.readTaskWorkSpecification(
        operation,
        lease.recordIntent(operation.operationId),
        interruptibleBoundaryOf(lease)
      ),
    ObservePlannedAttemptContinuationTargetLineage: ({ operation }) =>
      interpreter.readTargetLineage(
        operation,
        lease.recordIntent(operation.operationId),
        interruptibleBoundaryOf(lease)
      ),
    ObservePlannedAttemptContinuationWorktree: ({ operation }) =>
      interpreter.readTaskWorktree(operation, lease.recordIntent(operation.operationId), interruptibleBoundaryOf(lease))
  })
})

const executeClaimReleaseRetry = Effect.fn("DeliveryAction.executeClaimReleaseRetry")(function* (
  transition: Extract<
    AcceptedWorkflowTransition,
    { readonly _tag: "RetryStoppedAttemptClaimRelease" | "RetryCancelledAttemptClaimRelease" }
  >,
  lease: BoundaryExecutionLease
) {
  const interpreter = yield* WorkflowInterpreter
  const trace = yield* WorkflowTrace
  yield* trace.emit(OperationSelected.make({ operation: transition.operation }))
  return yield* interpreter.releaseTaskClaim(
    transition.operation,
    lease.recordIntent(transition.operation.release.operationId),
    interruptibleBoundaryOf(lease)
  )
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
  if (
    action._tag === "ReleaseExternallyCompletedTaskClaim" ||
    action._tag === "ReleaseStoppedAttemptClaim" ||
    action._tag === "ReleaseCancelledAttemptClaim"
  ) {
    const interpreter = yield* WorkflowInterpreter
    const trace = yield* WorkflowTrace
    const operation = makeTaskClaimReleaseOperation({
      authority: action.operation.authority,
      predecessorOperationIds: action.operation.predecessorOperationIds,
      release: { ...action.operation.release, operationId }
    })
    yield* trace.emit(OperationSelected.make({ operation }))
    yield* interpreter.releaseTaskClaim(operation, lease.recordIntent(operationId), interruptibleBoundaryOf(lease))
    return
  }
  return yield* executeRecoveredObservation(action, operationId, lease)
})

export const executeAcceptedWorkflowAction = Effect.fn("DeliveryAction.executeAcceptedWorkflow")(function* (
  runId: RunId,
  transition: AcceptedWorkflowTransition,
  lease: BoundaryExecutionLease
) {
  // Exhaustive transition matching keeps route/scheduling policy in planning and leaves this adapter protocol-only.
  return yield* Match.valueTags(transition, {
    CheckTaskClaim: (transition) => executeAcceptedRecovery(runId, transition, lease),
    ReconcileTaskClaim: (transition) => executeAcceptedRecovery(runId, transition, lease),
    ReconcileTaskClaimRelease: (transition) => executeAcceptedRecovery(runId, transition, lease),
    ReconcileTaskWorktree: (transition) => executeAcceptedRecovery(runId, transition, lease),
    RetryStoppedAttemptClaimRelease: (transition) => executeClaimReleaseRetry(transition, lease),
    RetryCancelledAttemptClaimRelease: (transition) => executeClaimReleaseRetry(transition, lease),
    ObservePlannedAttemptContinuationClaim: (transition) => executeAcceptedObservation(transition, lease),
    ObserveResponsibleTaskClaim: (transition) => executeAcceptedObservation(transition, lease),
    ObserveStoppedAttemptClaim: (transition) => executeAcceptedObservation(transition, lease),
    ObserveCancelledAttemptClaim: (transition) => executeAcceptedObservation(transition, lease),
    ObservePlannedAttemptContinuationGraph: (transition) => executeAcceptedObservation(transition, lease),
    ObservePlannedAttemptContinuationSpecification: (transition) => executeAcceptedObservation(transition, lease),
    ObservePlannedAttemptContinuationTargetLineage: (transition) => executeAcceptedObservation(transition, lease),
    ObservePlannedAttemptContinuationWorktree: (transition) => executeAcceptedObservation(transition, lease)
  })
})
