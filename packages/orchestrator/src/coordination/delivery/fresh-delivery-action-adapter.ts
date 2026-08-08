import { Effect } from "effect"
import type { TrackerTarget } from "../../authorities/task-tracker/target.js"
import {
  OperationSelected,
  TaskClaimAcquiredTrace,
  TaskClaimAcquisitionIntended,
  TrackerExecutionAdmitted
} from "../../presentation/tracker-workflow-trace.js"
import { WorkflowInterpreter, WorkflowTrace } from "../../workflow/interpretation/interpreter.js"
import {
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTaskWorktreeReconciliationOperation,
  makeTrackerGraphObservationOperation
} from "../../workflow/registry/operation.js"
import { TaskClaimAcquisitionPlanner } from "../../workflow/protocols/task-claim-acquisition/plan.js"
import { TaskAttemptPlanAcknowledged } from "../../workflow/protocols/task-attempt-planning/record.js"
import { TaskWorktreeReadyTrace } from "../../workflow/protocols/worktree-reconciliation/protocol.js"
import { deliveryActionCompleted, executeTrackerGraphRead } from "./delivery-action-adapter-common.js"
import type { DeliveryActionExecutionLease, MaterializedDeliveryAction } from "./delivery-action-executor.js"
import type { FreshOperationOnlyRoute, FreshOperationStep } from "./delivery-action-proposal.js"

type FreshOperationAction = Extract<MaterializedDeliveryAction, { readonly _tag: "FreshOperationAction" }>
type FreshWorkflowRoute = Extract<FreshOperationOnlyRoute, { readonly _tag: "FreshWorkflowRoute" }>

const acquireTaskClaim = Effect.fn("DeliveryAction.acquireTaskClaim")(function* (
  action: FreshOperationAction,
  step: Extract<FreshOperationStep, { readonly _tag: "AcquireTaskClaim" }>,
  lease: DeliveryActionExecutionLease
) {
  const planner = yield* TaskClaimAcquisitionPlanner
  const interpreter = yield* WorkflowInterpreter
  const trace = yield* WorkflowTrace
  const operation = makeTaskClaimAcquisitionOperation({
    acquisition: yield* planner.plan(action.operationId, step.task.id),
    predecessorOperationIds: [step.predecessorOperationId]
  })
  yield* trace.emit(OperationSelected.make({ operation }))
  yield* trace.emit(TaskClaimAcquisitionIntended.make({ operation }))
  const result = yield* interpreter.acquireTaskClaim(operation, lease.recordIntent(action.operationId))
  yield* trace.emit(TaskClaimAcquiredTrace.make({ claim: result.claim, operation }))
})

const reconcileTaskWorktree = Effect.fn("DeliveryAction.reconcileTaskWorktree")(function* (
  action: FreshOperationAction,
  step: Extract<FreshOperationStep, { readonly _tag: "ReconcileTaskWorktree" }>
) {
  const interpreter = yield* WorkflowInterpreter
  const trace = yield* WorkflowTrace
  const operation = makeTaskWorktreeReconciliationOperation({
    operationId: action.operationId,
    plannedAttempt: step.plannedAttempt,
    predecessorOperationIds: [step.predecessorOperationId]
  })
  yield* trace.emit(OperationSelected.make({ operation }))
  const result = yield* interpreter.reconcileTaskWorktree(operation)
  yield* trace.emit(TaskWorktreeReadyTrace.make({ operation, proof: result.proof }))
})

export const executeFreshWorkflowOperation = Effect.fn("DeliveryAction.executeFreshWorkflowOperation")(function* (
  action: FreshOperationAction,
  route: FreshWorkflowRoute,
  lease: DeliveryActionExecutionLease,
  target: TrackerTarget
) {
  const step = route.step
  const interpreter = yield* WorkflowInterpreter
  const trace = yield* WorkflowTrace
  switch (step._tag) {
    case "ReadCurrentTaskGraph": {
      const operation = makeTrackerGraphObservationOperation(action.operationId, target, [], [step.task.id])
      yield* executeTrackerGraphRead(operation)
      return deliveryActionCompleted(action.proposal.id)
    }
    case "AcquireTaskClaim": {
      yield* acquireTaskClaim(action, step, lease)
      return deliveryActionCompleted(action.proposal.id)
    }
    case "ReadPostClaimGraph": {
      const operation = makeTrackerGraphObservationOperation(
        action.operationId,
        target,
        [step.predecessorOperationId],
        [step.task.id]
      )
      const snapshot = yield* executeTrackerGraphRead(operation)
      if (snapshot.eligibleTasks().some(({ id }) => id === step.task.id)) {
        yield* trace.emit(
          TrackerExecutionAdmitted.make({ claimOperation: step.claimOperation, observationOperation: operation })
        )
      }
      return deliveryActionCompleted(action.proposal.id)
    }
    case "ReadTaskWorkSpecification": {
      const operation = makeTaskWorkSpecificationObservationOperation(action.operationId, target, step.task.id, [
        step.predecessorOperationId
      ])
      yield* trace.emit(OperationSelected.make({ operation }))
      yield* interpreter.readTaskWorkSpecification(operation)
      return deliveryActionCompleted(action.proposal.id)
    }
    case "ReconcileTaskWorktree": {
      yield* reconcileTaskWorktree(action, step)
      return deliveryActionCompleted(action.proposal.id)
    }
  }
})

export const executeFreshAttemptPlanning = Effect.fn("DeliveryAction.executeFreshAttemptPlanning")(function* (
  action: Extract<MaterializedDeliveryAction, { readonly _tag: "FreshAttemptAction" }>
) {
  const trace = yield* WorkflowTrace
  const interpreter = yield* WorkflowInterpreter
  const step = action.proposal.route.step
  const operation = makeTaskAttemptPlanOperation({
    operationId: action.operationId,
    plannedAttempt: action.plannedAttempt,
    predecessorOperationIds: [step.predecessorOperationId]
  })
  yield* trace.emit(OperationSelected.make({ operation }))
  yield* interpreter.recordTaskAttemptPlan(operation)
  yield* trace.emit(TaskAttemptPlanAcknowledged.make({ operation }))
  return deliveryActionCompleted(action.proposal.id)
})
