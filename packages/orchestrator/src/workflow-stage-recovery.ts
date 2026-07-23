import { Effect, Schema } from "effect"
import { AttemptId, OperationId, RunId, type Task, type TaskId, type TaskRevision } from "./domain.js"
import { claimForPlannedAttempt } from "./implementation-convergence-history.js"
import { describeJournalEvent } from "./journal-event-descriptor.js"
import type { JournalRecord } from "./journal-store.js"
import type { PlannedTaskAttemptRecoveryStage } from "./managed-run-recovery-stage.js"
import { taskRevisionFor } from "./task-dag.js"
import { TaskExecutionAdmitted, TaskExecutionOutcomeObserved } from "./task-execution-trace.js"
import { TaskExecutionRequest, TaskExecutionSessionBinding } from "./task-execution.js"
import { TaskWorkStartRequest } from "./task-work-start.js"
import { isExactTaskClaim, TrackerMutation } from "./tracker-mutation.js"
import {
  makeTaskExecutionOperation,
  makeTaskWorkSessionEstablishmentOperation,
  makeTaskWorktreeReconciliationOperation,
  makeTrackerGraphObservationOperation
} from "./workflow-operation.js"
import {
  makeTrackerGraphObservedOutcome,
  OperationSelected,
  TaskWorkSessionEstablishedTrace,
  TaskWorktreeExecutionModeContradiction,
  TaskWorktreeReadyTrace,
  TrackerGraphOutcomeObserved,
  WorkflowInterpreter,
  WorkflowTrace
} from "./workflow.js"

/** Fresh tracker or claim evidence cannot authorize the next operation for the durable attempt. */
export class RecoveryTaskEligibilityIssue extends Schema.TaggedErrorClass<RecoveryTaskEligibilityIssue>()(
  "RecoveryTaskEligibilityIssue",
  {
    attemptId: AttemptId,
    detail: Schema.String,
    reason: Schema.Literals([
      "ClaimChanged",
      "MissingClaim",
      "MissingEligibilityObservation",
      "TaskNotEligible",
      "TaskRevisionChanged"
    ]),
    runId: RunId
  }
) {}

interface FreshEligibleTask {
  readonly observationOperationId: OperationId
  readonly task: Task
}

export type MissingPlannedTaskAttemptOperationStage = Extract<
  PlannedTaskAttemptRecoveryStage,
  {
    readonly _tag:
      | "TaskExecutionNeeded"
      | "TaskWorkSessionEstablishmentNeeded"
      | "TaskWorktreeReconciliationNeeded"
  }
>

const issue = (
  runId: RunId,
  attemptId: AttemptId,
  reason: RecoveryTaskEligibilityIssue["reason"],
  detail: string
) => new RecoveryTaskEligibilityIssue({ attemptId, detail, reason, runId })

const usedOperationIds = (records: ReadonlyArray<JournalRecord>): ReadonlySet<OperationId> =>
  new Set(records.flatMap(({ event }) => {
    const descriptor = describeJournalEvent(event)
    return descriptor._tag === "OperationEventDescriptor" ? [descriptor.operationId] : []
  }))

const recoveryOperationId = (
  runId: RunId,
  attemptId: AttemptId,
  records: ReadonlyArray<JournalRecord>,
  purpose: string,
  reserved: ReadonlySet<OperationId> = new Set()
): OperationId => {
  const used = usedOperationIds(records)
  for (let ordinal = 0;; ordinal += 1) {
    const candidate = OperationId.make(
      `recovery:${runId}:${attemptId}:${records.length}:${purpose}:${ordinal}`
    )
    if (!used.has(candidate) && !reserved.has(candidate)) return candidate
  }
}

const freshEligibleTask = Effect.fn("WorkflowRecovery.freshEligibleTask")(function*(
  runId: RunId,
  records: ReadonlyArray<JournalRecord>,
  stage: MissingPlannedTaskAttemptOperationStage
) {
  const interpreter = yield* WorkflowInterpreter
  const trace = yield* WorkflowTrace
  const tracker = yield* TrackerMutation
  const planOperation = stage.planOperation
  const plannedAttempt = planOperation.plannedAttempt
  const priorObservation = records.find(({ event }) =>
    event._tag === "TrackerGraphObservationIntentRecorded"
    && planOperation.predecessorOperationIds.includes(event.operation.operationId)
  )?.event
  if (priorObservation?._tag !== "TrackerGraphObservationIntentRecorded") {
    return yield* issue(
      runId,
      plannedAttempt.attemptId,
      "MissingEligibilityObservation",
      `planned attempt ${plannedAttempt.attemptId} has no causal tracker eligibility observation`
    )
  }
  const durableClaim = claimForPlannedAttempt(records, plannedAttempt)
  if (durableClaim === undefined) {
    return yield* issue(
      runId,
      plannedAttempt.attemptId,
      "MissingClaim",
      `planned attempt ${plannedAttempt.attemptId} has no exact acquired task claim`
    )
  }
  const currentClaim = yield* tracker.readTaskClaim(plannedAttempt.taskId)
  if (currentClaim._tag !== "ActiveTaskClaim" || !isExactTaskClaim(currentClaim, durableClaim)) {
    return yield* issue(
      runId,
      plannedAttempt.attemptId,
      "ClaimChanged",
      `task claim changed for task ${plannedAttempt.taskId}`
    )
  }

  const observationOperationId = recoveryOperationId(
    runId,
    plannedAttempt.attemptId,
    records,
    "tracker"
  )
  const observationOperation = makeTrackerGraphObservationOperation(
    observationOperationId,
    priorObservation.operation.target,
    [planOperation.operationId]
  )
  yield* trace.emit(OperationSelected.make({ operation: observationOperation }))
  const snapshot = yield* interpreter.readTrackerGraph(observationOperation)
  yield* trace.emit(TrackerGraphOutcomeObserved.make({
    operation: observationOperation,
    outcome: makeTrackerGraphObservedOutcome(snapshot)
  }))
  const task = snapshot.eligibleTasks().find((candidate) => candidate.id === plannedAttempt.taskId)
  if (task === undefined) {
    return yield* issue(
      runId,
      plannedAttempt.attemptId,
      "TaskNotEligible",
      `task ${plannedAttempt.taskId} is not open, in the target closure, and free of unsatisfied prerequisites`
    )
  }
  const currentRevision = taskRevisionFor(task)
  if (currentRevision !== plannedAttempt.taskRevision) {
    return yield* issue(
      runId,
      plannedAttempt.attemptId,
      "TaskRevisionChanged",
      taskRevisionDetail(plannedAttempt.taskId, plannedAttempt.taskRevision, currentRevision)
    )
  }
  return { observationOperationId, task } satisfies FreshEligibleTask
})

const taskRevisionDetail = (
  taskId: TaskId,
  planned: TaskRevision,
  current: TaskRevision
): string => `task revision fingerprint changed for task ${taskId}: planned ${planned}, current ${current}`

/** Selects the exact next missing operation for one derived attempt stage. */
export const continuePlannedTaskAttemptStage = Effect.fn(
  "WorkflowRecovery.continuePlannedTaskAttemptStage"
)(function*(
  runId: RunId,
  records: ReadonlyArray<JournalRecord>,
  stage: MissingPlannedTaskAttemptOperationStage
) {
  const interpreter = yield* WorkflowInterpreter
  const trace = yield* WorkflowTrace
  switch (stage._tag) {
    case "TaskWorktreeReconciliationNeeded": {
      const eligible = yield* freshEligibleTask(runId, records, stage)
      const operation = makeTaskWorktreeReconciliationOperation({
        operationId: recoveryOperationId(
          runId,
          stage.planOperation.plannedAttempt.attemptId,
          records,
          "worktree",
          new Set([eligible.observationOperationId])
        ),
        plannedAttempt: stage.planOperation.plannedAttempt,
        predecessorOperationIds: [
          stage.planOperation.operationId,
          eligible.observationOperationId
        ]
      })
      yield* trace.emit(OperationSelected.make({ operation }))
      const result = yield* interpreter.reconcileTaskWorktree(operation)
      if (result._tag !== "AuthoritativeTaskWorktreeReady") {
        return yield* new TaskWorktreeExecutionModeContradiction({ operationId: operation.operationId })
      }
      yield* trace.emit(TaskWorktreeReadyTrace.make({ operation, proof: result.proof }))
      return true
    }
    case "TaskWorkSessionEstablishmentNeeded": {
      const eligible = yield* freshEligibleTask(runId, records, stage)
      const request = TaskWorkStartRequest.make({
        operationId: recoveryOperationId(
          runId,
          stage.planOperation.plannedAttempt.attemptId,
          records,
          "session",
          new Set([eligible.observationOperationId])
        ),
        plannedAttempt: stage.planOperation.plannedAttempt,
        task: eligible.task
      })
      const operation = makeTaskWorkSessionEstablishmentOperation({
        predecessorOperationIds: [
          stage.planOperation.operationId,
          stage.worktreeOperation.operationId,
          eligible.observationOperationId
        ],
        request
      })
      yield* trace.emit(OperationSelected.make({ operation }))
      const outcome = yield* interpreter.establishTaskWorkSession(operation)
      yield* trace.emit(TaskWorkSessionEstablishedTrace.make({ operation, outcome }))
      return true
    }
    case "TaskExecutionNeeded": {
      const eligible = yield* freshEligibleTask(runId, records, stage)
      const plannedAttempt = stage.sessionEstablishmentOperation.request.plannedAttempt
      const operation = makeTaskExecutionOperation({
        predecessorOperationIds: [
          stage.sessionEstablishmentOperation.request.operationId,
          eligible.observationOperationId
        ],
        request: TaskExecutionRequest.make({
          operationId: recoveryOperationId(
            runId,
            plannedAttempt.attemptId,
            records,
            "execution",
            new Set([eligible.observationOperationId])
          ),
          plannedAttempt,
          session: TaskExecutionSessionBinding.cases.EstablishedSession.make({
            sessionId: stage.sessionId
          }),
          task: eligible.task
        })
      })
      yield* trace.emit(OperationSelected.make({ operation }))
      yield* trace.emit(TaskExecutionAdmitted.make({ operation }))
      const outcome = yield* interpreter.executeTaskWork(operation)
      yield* trace.emit(TaskExecutionOutcomeObserved.make({ operation, outcome }))
      return true
    }
  }
})
