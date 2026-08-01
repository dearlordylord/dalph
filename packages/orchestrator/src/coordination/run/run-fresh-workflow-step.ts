import { Effect, Option, type PlatformError } from "effect"
import {
  plannedAttemptExecutorCorrelation,
  type AcceptedResult,
  type IntegrationTarget,
  type PlannedAttemptExecutorReport,
  type PlannedTaskAttempt
} from "@dalph/contracts"
import type { OwnedTransitionExecution } from "../activation/coordinator.js"
import type { TraceItem, WorkflowInterpreterService } from "../../workflow/interpretation/interpreter.js"
import type {
  OperationIdAllocatorService,
  PlannedTaskAttemptError,
  PlannedTaskAttemptPlannerService
} from "../../workflow/protocols/task-attempt-planning/plan.js"
import type { TaskClaimAcquisitionPlanner } from "../../workflow/protocols/task-claim-acquisition/plan.js"
import {
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTaskWorktreeReconciliationOperation,
  makeTrackerGraphObservationOperation
} from "../../workflow/registry/operation.js"
import {
  OperationSelected,
  TaskClaimAcquiredTrace,
  TaskClaimAcquisitionIntended,
  TaskTrackerFactsObservedTrace,
  TrackerExecutionAdmitted
} from "../../presentation/tracker-workflow-trace.js"
import { makeCompleteTaskTrackerFactsObserved } from "../../workflow/task-tracker-facts/observation.js"
import {
  TaskAttemptPlanAcknowledged,
  TaskAttemptPlanRecordingSimulated
} from "../../workflow/protocols/task-attempt-planning/record.js"
import {
  TaskWorktreeReadyTrace,
  TaskWorktreeReconciliationSimulatedTrace,
  type TaskWorktreeExecutionModeContradiction
} from "../../workflow/protocols/worktree-reconciliation/protocol.js"
import {
  type IntegrationJournalUnavailable,
  IntegrationTargetUnavailable,
  type queueAcceptedResultIntegrationResponsibility
} from "../../workflow/protocols/integration-admission/protocol.js"
import type { FreshWorkflowStep } from "./fresh-workflow.js"
import { SyntheticWorkflowFact } from "./fresh-workflow-fact.js"
import type { RunRecoveryActivationError } from "./recovery-activation.js"
import type { TraceOutputError } from "../../presentation/trace-output.js"

type InterpreterError = {
  [Key in keyof WorkflowInterpreterService]-?: Effect.Error<ReturnType<NonNullable<WorkflowInterpreterService[Key]>>>
}[keyof WorkflowInterpreterService]

export type FreshWorkflowExecutionError =
  | InterpreterError
  | Effect.Error<ReturnType<typeof queueAcceptedResultIntegrationResponsibility>>
  | IntegrationJournalUnavailable
  | IntegrationTargetUnavailable
  | RunRecoveryActivationError
  | PlannedTaskAttemptError
  | PlatformError.PlatformError
  | TaskWorktreeExecutionModeContradiction
  | TraceOutputError

/** Accepted facts become visible to the next activation only after the current handoff completes. */
export interface FreshWorkflowStepResult {
  readonly acceptedFact: SyntheticWorkflowFact
}

// eslint-disable-next-line functional/no-mixed-types -- One interpreter input names the exact boundaries used by the fresh-workflow story.
interface FreshWorkflowStepRuntime<EEmit, EQueue, EExecutor> {
  readonly allocator: OperationIdAllocatorService
  readonly claimPlanner: TaskClaimAcquisitionPlanner["Service"]
  readonly emit: (item: TraceItem) => Effect.Effect<void, EEmit>
  readonly integrationTarget: Option.Option<IntegrationTarget>
  readonly interpreter: WorkflowInterpreterService
  readonly planner: PlannedTaskAttemptPlannerService
  readonly queueAcceptedResult: (
    plannedAttempt: PlannedTaskAttempt,
    acceptedResult: AcceptedResult,
    integrationTarget: IntegrationTarget
  ) => Effect.Effect<void, EQueue>
  readonly target: Parameters<typeof makeTrackerGraphObservationOperation>[1]
  readonly continuePlannedAttemptExecutorWork: (
    plannedAttempt: PlannedTaskAttempt
  ) => Effect.Effect<PlannedAttemptExecutorReport, EExecutor>
}

const readGraph = Effect.fn("DeliveryActivation.readFreshGraph")(function* <EEmit, EQueue, EExecutor>(
  runtime: FreshWorkflowStepRuntime<EEmit, EQueue, EExecutor>,
  operation: ReturnType<typeof makeTrackerGraphObservationOperation>
) {
  yield* runtime.emit(OperationSelected.make({ operation }))
  const snapshot = yield* runtime.interpreter.readTrackerGraph(operation)
  yield* runtime.emit(
    TaskTrackerFactsObservedTrace.make({
      observation: makeCompleteTaskTrackerFactsObserved(operation, snapshot),
      operation
    })
  )
  return snapshot
})

/** Interprets exactly one history-derived fresh-workflow step. */
// eslint-disable-next-line complexity -- Closed workflow-step tags route to their matching typed authority boundary.
export const runFreshWorkflowStep = Effect.fn("DeliveryActivation.runFreshWorkflowStep")(function* <
  EEmit,
  EQueue,
  EExecutor
>(
  runtime: FreshWorkflowStepRuntime<EEmit, EQueue, EExecutor>,
  step: FreshWorkflowStep,
  execution: OwnedTransitionExecution
) {
  switch (step._tag) {
    case "ReadCurrentTaskGraph": {
      const operation = makeTrackerGraphObservationOperation(
        yield* runtime.allocator.allocate(),
        runtime.target,
        [],
        [step.task.id]
      )
      const snapshot = yield* readGraph(runtime, operation)
      return {
        acceptedFact: SyntheticWorkflowFact.CurrentTaskGraphObserved({
          operationId: operation.operationId,
          snapshot,
          taskId: step.task.id
        })
      }
    }
    case "AcquireTaskClaim": {
      const operationId = yield* runtime.allocator.allocate()
      const operation = makeTaskClaimAcquisitionOperation({
        acquisition: yield* runtime.claimPlanner.plan(operationId, step.task.id),
        predecessorOperationIds: [step.predecessorOperationId]
      })
      yield* runtime.emit(OperationSelected.make({ operation }))
      yield* runtime.emit(TaskClaimAcquisitionIntended.make({ operation }))
      const result = yield* runtime.interpreter.acquireTaskClaim(
        operation,
        execution.recordIntent(operation.acquisition.operationId)
      )
      if (result._tag === "AuthoritativeTaskClaimAcquired") {
        yield* runtime.emit(TaskClaimAcquiredTrace.make({ claim: result.claim, operation }))
      }
      return { acceptedFact: SyntheticWorkflowFact.TaskClaimAcquisitionCompleted({ operation, taskId: step.task.id }) }
    }
    case "ReadPostClaimGraph": {
      const operation = makeTrackerGraphObservationOperation(
        yield* runtime.allocator.allocate(),
        runtime.target,
        [step.predecessorOperationId],
        [step.task.id]
      )
      const snapshot = yield* readGraph(runtime, operation)
      const admittedTask = snapshot.eligibleTasks().find(({ id }) => id === step.task.id)
      /* v8 ignore start -- Maintained graph-change scenarios remove only unstarted work; this defensive claimed-task path is unchanged. */
      if (admittedTask === undefined) {
        return {
          acceptedFact: SyntheticWorkflowFact.PostClaimGraphObserved({
            operationId: operation.operationId,
            snapshot,
            taskId: step.task.id
          })
        }
      }
      /* v8 ignore stop */
      yield* runtime.emit(
        TrackerExecutionAdmitted.make({ claimOperation: step.claimOperation, observationOperation: operation })
      )
      return {
        acceptedFact: SyntheticWorkflowFact.PostClaimGraphObserved({
          operationId: operation.operationId,
          snapshot,
          taskId: step.task.id
        })
      }
    }
    case "ReadTaskWorkSpecification": {
      const operation = makeTaskWorkSpecificationObservationOperation(
        yield* runtime.allocator.allocate(),
        runtime.target,
        step.task.id,
        [step.predecessorOperationId]
      )
      yield* runtime.emit(OperationSelected.make({ operation }))
      const specification = yield* runtime.interpreter.readTaskWorkSpecification(operation)
      return {
        acceptedFact: SyntheticWorkflowFact.TaskWorkSpecificationObserved({
          operationId: operation.operationId,
          specification,
          taskId: step.task.id
        })
      }
    }
    case "RecordTaskAttemptPlan": {
      const plannedAttempt = yield* runtime.planner.plan(step.specification)
      const operation = makeTaskAttemptPlanOperation({
        operationId: yield* runtime.allocator.allocate(),
        plannedAttempt,
        predecessorOperationIds: [step.predecessorOperationId]
      })
      yield* runtime.emit(OperationSelected.make({ operation }))
      const result = yield* runtime.interpreter.recordTaskAttemptPlan(operation)
      yield* runtime.emit(
        result._tag === "TaskAttemptPlanRecordAcknowledged"
          ? TaskAttemptPlanAcknowledged.make({ operation })
          : TaskAttemptPlanRecordingSimulated.make({ operation })
      )
      return {
        acceptedFact: SyntheticWorkflowFact.TaskAttemptPlanRecorded({
          operationId: operation.operationId,
          plannedAttempt,
          taskId: step.task.id
        })
      }
    }
    case "ReconcileTaskWorktree": {
      const operation = makeTaskWorktreeReconciliationOperation({
        operationId: yield* runtime.allocator.allocate(),
        plannedAttempt: step.plannedAttempt,
        predecessorOperationIds: [step.predecessorOperationId]
      })
      yield* runtime.emit(OperationSelected.make({ operation }))
      const result = yield* runtime.interpreter.reconcileTaskWorktree(operation)
      yield* runtime.emit(
        result._tag === "AuthoritativeTaskWorktreeReady"
          ? TaskWorktreeReadyTrace.make({ operation, proof: result.proof })
          : TaskWorktreeReconciliationSimulatedTrace.make({ operation })
      )
      return {
        acceptedFact: SyntheticWorkflowFact.TaskWorktreeReconciled({
          plannedAttempt: step.plannedAttempt,
          taskId: step.task.id
        })
      }
    }
    case "StartPlannedAttemptExecutorWork":
    case "ContinuePlannedAttemptExecutorWork": {
      const correlation = plannedAttemptExecutorCorrelation(step.plannedAttempt)
      yield* execution.bindPlannedAttemptExecutorPosition(correlation)
      const report = yield* runtime.continuePlannedAttemptExecutorWork(step.plannedAttempt)
      if (report._tag === "Running") {
        return {
          acceptedFact: SyntheticWorkflowFact.PlannedAttemptExecutorWorkReported({
            plannedAttempt: step.plannedAttempt,
            reportTag: report._tag,
            taskId: step.task.id
          })
        }
      }
      yield* execution.releasePlannedAttemptExecutorWorkPosition(correlation)
      if (report._tag === "Terminal" && report.result._tag === "Accepted") {
        const integrationTarget = Option.getOrUndefined(runtime.integrationTarget)
        /* v8 ignore start -- Production and maintained dry/live compositions always configure the accepted-result target. */
        if (integrationTarget === undefined) {
          return yield* new IntegrationTargetUnavailable({
            attemptId: step.plannedAttempt.attemptId,
            runId: step.plannedAttempt.runId
          })
        }
        /* v8 ignore stop */
        yield* runtime.queueAcceptedResult(step.plannedAttempt, report.result.acceptedResult, integrationTarget)
      }
      return {
        acceptedFact: SyntheticWorkflowFact.PlannedAttemptExecutorWorkReported({
          plannedAttempt: step.plannedAttempt,
          reportTag: report._tag,
          taskId: step.task.id
        })
      }
    }
  }
})
