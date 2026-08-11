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

const executeAcceptedRecovery = (runId: RunId, transition: AcceptedRecoveryTransition) =>
  Match.valueTags(transition, {
    CheckTaskClaim: ({ operationId }) => recoverTaskClaimOperation(runId, operationId),
    ReconcileTaskClaim: ({ operationId }) => recoverTaskClaimOperation(runId, operationId),
    ReconcileTaskClaimRelease: ({ operationId }) => recoverTaskClaimReleaseOperation(runId, operationId),
    ReconcileTaskWorktree: ({ operationId }) => recoverTaskWorktreeOperation(runId, operationId)
  })

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
  return yield* Match.valueTags(action, {
    ReadTrackerGraph: (action) =>
      Effect.gen(function* () {
        const operation = { ...action.operation, operationId }
        yield* trace.emit(OperationSelected.make({ operation }))
        return yield* interpreter.readTrackerGraph(operation)
      }),
    ReadTaskClaim: (action) =>
      Effect.gen(function* () {
        const operation = { ...action.operation, operationId }
        yield* trace.emit(OperationSelected.make({ operation }))
        return yield* interpreter.readTaskClaim(operation)
      }),
    ReadTaskWorkSpecification: (action) =>
      Effect.gen(function* () {
        const operation = { ...action.operation, operationId }
        yield* trace.emit(OperationSelected.make({ operation }))
        return yield* interpreter.readTaskWorkSpecification(operation)
      }),
    ReadTaskWorktree: (action) =>
      Effect.gen(function* () {
        const operation = { ...action.operation, operationId }
        yield* trace.emit(OperationSelected.make({ operation }))
        return yield* interpreter.readTaskWorktree(operation)
      }),
    ReadTargetLineage: (action) =>
      Effect.gen(function* () {
        const operation = { ...action.operation, operationId }
        yield* trace.emit(OperationSelected.make({ operation }))
        return yield* interpreter.readTargetLineage(operation)
      })
  })
})

const executeAcceptedObservation = Effect.fn("DeliveryAction.executeAcceptedObservation")(function* (
  transition: AcceptedObservationTransition
) {
  const interpreter = yield* WorkflowInterpreter
  const trace = yield* WorkflowTrace
  yield* trace.emit(OperationSelected.make({ operation: transition.operation }))
  return yield* Match.valueTags(transition, {
    ObservePlannedAttemptContinuationClaim: ({ operation }) => interpreter.readTaskClaim(operation),
    ObserveResponsibleTaskClaim: ({ operation }) => interpreter.readTaskClaim(operation),
    ObserveStoppedAttemptClaim: ({ operation }) => interpreter.readTaskClaim(operation),
    ObservePlannedAttemptContinuationGraph: ({ operation }) => interpreter.readTrackerGraph(operation),
    ObservePlannedAttemptContinuationSpecification: ({ operation }) => interpreter.readTaskWorkSpecification(operation),
    ObservePlannedAttemptContinuationTargetLineage: ({ operation }) => interpreter.readTargetLineage(operation),
    ObservePlannedAttemptContinuationWorktree: ({ operation }) => interpreter.readTaskWorktree(operation)
  })
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
