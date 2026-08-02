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
import {
  TaskAttemptPlanAcknowledged,
  TaskAttemptPlanRecordingSimulated
} from "../../workflow/protocols/task-attempt-planning/record.js"
import {
  TaskWorktreeReadyTrace,
  TaskWorktreeReconciliationSimulatedTrace
} from "../../workflow/protocols/worktree-reconciliation/protocol.js"
import { executeTrackerGraphRead } from "./delivery-action-adapter-common.js"
import type { DeliveryActionExecutionLease, MaterializedDeliveryAction } from "./delivery-action-executor.js"
import type { FreshOperationOnlyRoute, FreshOperationStep } from "./delivery-action-proposal.js"
import { FreshWorkflowActionFact } from "../run/fresh-workflow-fact.js"

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
  if (result._tag === "AuthoritativeTaskClaimAcquired") {
    yield* trace.emit(TaskClaimAcquiredTrace.make({ claim: result.claim, operation }))
  }
  return FreshWorkflowActionFact.TaskClaimAcquisitionCompleted({ operation, taskId: step.task.id })
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
  yield* trace.emit(
    result._tag === "AuthoritativeTaskWorktreeReady"
      ? TaskWorktreeReadyTrace.make({ operation, proof: result.proof })
      : TaskWorktreeReconciliationSimulatedTrace.make({ operation })
  )
  return FreshWorkflowActionFact.TaskWorktreeReconciled({ plannedAttempt: step.plannedAttempt, taskId: step.task.id })
})

const freshWorkflowActionFactProduced = (
  proposalId: FreshOperationAction["proposal"]["id"],
  fact: FreshWorkflowActionFact
) => ({ _tag: "FreshWorkflowActionFactProduced" as const, fact, proposalId })

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
      const snapshot = yield* executeTrackerGraphRead(operation)
      return freshWorkflowActionFactProduced(
        action.proposal.id,
        FreshWorkflowActionFact.CurrentTaskGraphObserved({
          operationId: operation.operationId,
          snapshot,
          taskId: step.task.id
        })
      )
    }
    case "AcquireTaskClaim": {
      return freshWorkflowActionFactProduced(action.proposal.id, yield* acquireTaskClaim(action, step, lease))
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
      return freshWorkflowActionFactProduced(
        action.proposal.id,
        FreshWorkflowActionFact.PostClaimGraphObserved({
          operationId: operation.operationId,
          snapshot,
          taskId: step.task.id
        })
      )
    }
    case "ReadTaskWorkSpecification": {
      const operation = makeTaskWorkSpecificationObservationOperation(action.operationId, target, step.task.id, [
        step.predecessorOperationId
      ])
      yield* trace.emit(OperationSelected.make({ operation }))
      const specification = yield* interpreter.readTaskWorkSpecification(operation)
      return freshWorkflowActionFactProduced(
        action.proposal.id,
        FreshWorkflowActionFact.TaskWorkSpecificationObserved({
          operationId: operation.operationId,
          specification,
          taskId: step.task.id
        })
      )
    }
    case "ReconcileTaskWorktree": {
      return freshWorkflowActionFactProduced(action.proposal.id, yield* reconcileTaskWorktree(action, step))
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
  const result = yield* interpreter.recordTaskAttemptPlan(operation)
  yield* trace.emit(
    result._tag === "TaskAttemptPlanRecordAcknowledged"
      ? TaskAttemptPlanAcknowledged.make({ operation })
      : TaskAttemptPlanRecordingSimulated.make({ operation })
  )
  return {
    _tag: "FreshWorkflowActionFactProduced" as const,
    fact: FreshWorkflowActionFact.TaskAttemptPlanRecorded({
      operationId: operation.operationId,
      plannedAttempt: action.plannedAttempt,
      taskId: step.task.id
    }),
    proposalId: action.proposal.id
  }
})
