import {
  plannedAttemptExecutorCorrelation,
  plannedAttemptExecutorCorrelationKey,
  samePlannedTaskAttempt,
  type PlannedAttemptExecutorCorrelation,
  type PlannedAttemptExecutorObservationPurpose,
  type PlannedTaskAttempt
} from "@dalph/contracts"
import {
  deliveryProposalOrderTaskId,
  type DeliveryRelationInputBundle,
  type JournalRecord,
  type MaterializedDeliveryAction
} from "@dalph/orchestrator"

export interface Issue268Ds02PassiveActionCapture {
  readonly action: MaterializedDeliveryAction
  readonly publication: DeliveryRelationInputBundle | undefined
  readonly records: ReadonlyArray<JournalRecord>
}

export interface Issue268Ds02PassiveReadCapture {
  readonly correlation: PlannedAttemptExecutorCorrelation
  readonly purpose: PlannedAttemptExecutorObservationPurpose
}

const startupStages = [
  "ReadCurrentTaskGraph",
  "AcquireTaskClaim",
  "ReadPostClaimGraph",
  "ReadTaskWorkSpecification",
  "RecordTaskAttemptPlan",
  "ReconcileTaskWorktree",
  "BeginPlannedAttemptExecutorWork"
]

/** The checkpoint includes the exact startup prefix, never an arbitrary later action. */
export const isIssue268Ds02StageSequence = (stages: ReadonlyArray<string>): boolean =>
  startupStages.every((stage, index) => stages[index] === stage) &&
  stages.length <= startupStages.length + 1 &&
  stages.slice(startupStages.length).every((stage) => stage === "ObservePlannedAttemptExecutorWork")

export const isIssue268Ds02ActionInventory = (
  actions: ReadonlyArray<{ readonly stage: string; readonly taskId: string }>
): boolean =>
  actions.every(({ taskId }) => ["A", "B", "C"].includes(taskId)) &&
  ["A", "B", "C"].every((taskId) =>
    isIssue268Ds02StageSequence(actions.filter((action) => action.taskId === taskId).map(({ stage }) => stage))
  )

const exactExecutingBasis = (records: ReadonlyArray<JournalRecord>, plan: PlannedTaskAttempt) => {
  const intent = records.findLast(
    ({ event }) =>
      event._tag === "PlannedAttemptExecutorCommandIntended" && samePlannedTaskAttempt(event.plannedAttempt, plan)
  )
  const response = records.findLast(
    ({ event }) =>
      event._tag === "PlannedAttemptExecutorCommandResponseObserved" &&
      samePlannedTaskAttempt(event.plannedAttempt, plan)
  )
  const report = records.findLast(
    ({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkReported" &&
      event.report.correlation.attemptId === plan.attemptId &&
      event.report.correlation.runId === plan.runId
  )
  if (
    intent?.event._tag !== "PlannedAttemptExecutorCommandIntended" ||
    response?.event._tag !== "PlannedAttemptExecutorCommandResponseObserved" ||
    report?.event._tag !== "PlannedAttemptExecutorWorkReported"
  )
    return undefined
  const valid = [
    intent.event.command === "Begin",
    intent.event.ordinal === 1,
    response.position > intent.position,
    response.event.commandOrdinal === intent.event.ordinal,
    response.event.report._tag === "ExecutorWorkExecuting",
    report.position > response.position,
    report.event.report._tag === "ExecutorWorkExecuting"
  ].every(Boolean)
  return valid ? report.event.ordinal : undefined
}

export const isIssue268Ds02PassiveAction = (
  capture: Issue268Ds02PassiveActionCapture,
  plan: PlannedTaskAttempt
): boolean => {
  const { action, publication, records } = capture
  if (action._tag !== "IdentityFreeAction" || action.proposal.route._tag !== "FreshExecutorWorkflowRoute") return false
  const step = action.proposal.route.step
  if (step._tag !== "ObservePlannedAttemptExecutorWork" || step.acceptedProgress._tag !== "ExecutorReportAccepted")
    return false
  const admission = action.proposal.admission
  if (
    admission.taskWorkPosition._tag !== "TaskWorkPositionRequired" ||
    admission.plannedAttemptProtocol._tag !== "PlannedAttemptProtocolRequired"
  )
    return false
  const correlation = plannedAttemptExecutorCorrelation(plan)
  return [
    samePlannedTaskAttempt(step.plannedAttempt, plan),
    step.task.id === plan.taskId,
    deliveryProposalOrderTaskId(action.proposal.order) === plan.taskId,
    step.acceptedProgress.ordinal === exactExecutingBasis(records, plan),
    admission.taskWorkPosition.mode === "ReserveOrReuse",
    admission.taskWorkPosition.taskId === plan.taskId,
    plannedAttemptExecutorCorrelationKey(admission.plannedAttemptProtocol.correlation) ===
      plannedAttemptExecutorCorrelationKey(correlation),
    publication?.actionInputs.runtimeFacts.taskWork.held.some(
      ({ correlation: held }) =>
        plannedAttemptExecutorCorrelationKey(held) === plannedAttemptExecutorCorrelationKey(correlation)
    ) === true
  ].every(Boolean)
}

export const isIssue268Ds02PassiveRead = (
  capture: Issue268Ds02PassiveReadCapture,
  plans: ReadonlyArray<PlannedTaskAttempt>
): boolean =>
  capture.purpose._tag === "PassiveLifecycleObservation" &&
  plans.some(
    (plan) =>
      plannedAttemptExecutorCorrelationKey(capture.correlation) ===
      plannedAttemptExecutorCorrelationKey(plannedAttemptExecutorCorrelation(plan))
  )
