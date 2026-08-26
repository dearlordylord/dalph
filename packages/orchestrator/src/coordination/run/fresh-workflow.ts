import { Option } from "effect"
import type { AttemptId, PlannedTaskAttempt, TaskId } from "@dalph/contracts"
import type { Task } from "../../authorities/task-tracker/task.js"
import { taskRevisionFor } from "../../authorities/task-tracker/graph.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import type { OperationId } from "../../workflow/identity.js"
import { RunnableFrontierTransition, type RunnableFrontierTransition as Transition } from "../frontier/frontier.js"
import type { WorkflowResponsibilityEntry } from "../reconstruction/state.js"
import type { CurrentDeliveryFrame } from "./current-delivery-frame.js"
import { reconstructedTaskGraphFromEvents } from "../reconstruction/graph-knowledge.js"
import { FreshWorkflowStep, type FreshWorkflowStep as FreshWorkflowStepType } from "../delivery/fresh-workflow-step.js"
import { recordedTaskAttemptPlans } from "../../workflow/protocols/task-attempt-planning/journal-evidence.js"
import {
  latestPlannedAttemptExecutorEvidence,
  latestPlannedAttemptExecutorProjectionIssue,
  plannedAttemptExecutorTaskWorkSpecifications
} from "../../workflow/protocols/planned-attempt-executor-work/evidence.js"
import { journalPrefixPredecessorOf } from "../../workflow-journal/prefix-lineage.js"
import { specificationReadRequiredAfterProgressGraph } from "./fresh-workflow-progress.js"

const postClaimGraphRank = 0
const claimRank = 1
const specificationRank = 2
const otherWorkflowOperationRank = 3
const executorWorkRank = 4
const lastElementOffset = -1

export interface FreshWorkflowDecision {
  readonly step: FreshWorkflowStepType
  readonly transition: Transition
}

const responsibilityTaskId = (responsibility: WorkflowResponsibilityEntry): TaskId =>
  responsibility._tag === "PlannedAttemptExecutorWorkResponsibility"
    ? responsibility.plannedAttempt.taskId
    : responsibility.taskId

const continued = (taskId: TaskId, predecessorOperationId: OperationId): Transition =>
  RunnableFrontierTransition.ContinueFreshWorkflowOperation({ operationId: predecessorOperationId, taskId })

const decisionFor = (step: FreshWorkflowStepType): FreshWorkflowDecision => ({
  step,
  transition:
    step._tag === "AcquireTaskClaim"
      ? RunnableFrontierTransition.CommitFreshTaskClaimIntent({
          taskId: step.task.id,
          taskRevision: taskRevisionFor(step.task)
        })
      : step._tag === "StartPlannedAttemptExecutorWork" || step._tag === "ContinuePlannedAttemptExecutorWork"
        ? step._tag === "StartPlannedAttemptExecutorWork"
          ? RunnableFrontierTransition.StartPlannedAttemptExecutorWork({ plannedAttempt: step.plannedAttempt })
          : RunnableFrontierTransition.ContinuePlannedAttemptExecutorWork({
              acceptedProgress: step.acceptedProgress,
              plannedAttempt: step.plannedAttempt
            })
        : continued(step.task.id, step.predecessorOperationId)
})

const observedOperationIdsByPrefix = new WeakMap<ReadonlyArray<JournalRecord>, ReadonlySet<OperationId>>()

const observedOperationIds = (records: ReadonlyArray<JournalRecord>): ReadonlySet<OperationId> => {
  const cached = observedOperationIdsByPrefix.get(records)
  if (cached !== undefined) return cached
  const predecessor = journalPrefixPredecessorOf(records)
  const observed = (() => {
    if (predecessor === undefined)
      return new Set(
        records.flatMap(({ event }) =>
          event._tag === "TaskTrackerFactsObserved" || event._tag === "TaskWorktreeReady" ? [event.operationId] : []
        )
      )
    const event = predecessor.appended.event
    return event._tag === "TaskTrackerFactsObserved" || event._tag === "TaskWorktreeReady"
      ? new Set(observedOperationIds(predecessor.prior)).add(event.operationId)
      : observedOperationIds(predecessor.prior)
  })()
  observedOperationIdsByPrefix.set(records, observed)
  return observed
}

const plannedSpecificationFor = (records: ReadonlyArray<JournalRecord>, plannedAttempt: PlannedTaskAttempt) =>
  plannedAttemptExecutorTaskWorkSpecifications(records).findLast(
    (specification) =>
      specification.taskId === plannedAttempt.taskId && specification.fingerprint === plannedAttempt.taskRevision
  )

/** Returns the exact positioned Running report, or explicit absence; no synthetic journal position is possible. */
type PositionedRunningExecutorReport = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "PlannedAttemptExecutorWorkReported" }> & {
    readonly report: { readonly _tag: "Running" }
  }
}

const isPositionedRunningExecutorReport = (
  record: JournalRecord | undefined
): record is PositionedRunningExecutorReport =>
  record?.event._tag === "PlannedAttemptExecutorWorkReported" && record.event.report._tag === "Running"

export const latestRunningExecutorReportRecordFor = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt
): PositionedRunningExecutorReport | undefined => {
  const record = records.findLast(
    ({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkReported" &&
      event.report.correlation.runId === plannedAttempt.runId &&
      event.report.correlation.attemptId === plannedAttempt.attemptId
  )
  return isPositionedRunningExecutorReport(record) ? record : undefined
}

// eslint-disable-next-line complexity -- Closed journal occurrence families route to one next workflow operation.
const journaledStepFor = (
  task: Task,
  records: ReadonlyArray<JournalRecord>,
  recoveredAttemptIds: ReadonlySet<AttemptId>,
  observed: ReadonlySet<OperationId>
): FreshWorkflowStepType => {
  const executorResponsibility = records.findLast(
    ({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" && event.plannedAttempt.taskId === task.id
  )?.event
  if (
    executorResponsibility?._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
    !recoveredAttemptIds.has(executorResponsibility.plannedAttempt.attemptId)
  ) {
    const reportRecord = latestRunningExecutorReportRecordFor(records, executorResponsibility.plannedAttempt)
    const specification = plannedSpecificationFor(records, executorResponsibility.plannedAttempt)
    /* v8 ignore start -- A fresh non-running report already transfers the task to terminal or integration responsibility. */
    if (reportRecord !== undefined && specification !== undefined) {
      const progressGraphOperationId = specificationReadRequiredAfterProgressGraph(
        records,
        executorResponsibility.plannedAttempt,
        reportRecord.position
      )
      if (progressGraphOperationId !== undefined) {
        return FreshWorkflowStep.ReadTaskWorkSpecification({ predecessorOperationId: progressGraphOperationId, task })
      }
      return FreshWorkflowStep.ContinuePlannedAttemptExecutorWork({
        acceptedProgress: { _tag: "ExecutorReportAccepted", ordinal: reportRecord.event.ordinal },
        plannedAttempt: executorResponsibility.plannedAttempt,
        specification,
        task
      })
    }
    /* v8 ignore stop */
  }
  const plan = recordedTaskAttemptPlans(records)
    .filter(({ plannedAttempt }) => plannedAttempt.taskId === task.id)
    .at(lastElementOffset)
  if (plan !== undefined) {
    const worktree = records.findLast(
      ({ event }) =>
        event._tag === "TaskWorktreeReconciliationIntended" &&
        event.operation.plannedAttempt.attemptId === plan.plannedAttempt.attemptId
    )?.event
    const specification = plannedSpecificationFor(records, plan.plannedAttempt)
    if (worktree?._tag === "TaskWorktreeReconciliationIntended" && observed.has(worktree.operation.operationId)) {
      if (specification !== undefined) {
        return FreshWorkflowStep.StartPlannedAttemptExecutorWork({
          plannedAttempt: plan.plannedAttempt,
          specification,
          task
        })
      }
      return FreshWorkflowStep.ReadTaskWorkSpecification({ predecessorOperationId: plan.operationId, task })
    }
    return FreshWorkflowStep.ReconcileTaskWorktree({
      plannedAttempt: plan.plannedAttempt,
      predecessorOperationId: plan.operationId,
      task
    })
  }

  const specification = records.findLast(
    ({ event }) =>
      event._tag === "TaskTrackerFactsObserved" &&
      event.observation._tag === "FocusedTaskWorkSpecificationFacts" &&
      event.observation.factFamily.taskId === task.id
  )?.event
  if (
    specification?._tag === "TaskTrackerFactsObserved" &&
    specification.observation._tag === "FocusedTaskWorkSpecificationFacts"
  ) {
    return FreshWorkflowStep.RecordTaskAttemptPlan({
      predecessorOperationId: specification.operationId,
      specification: {
        body: specification.observation.factFamily.body,
        fingerprint: specification.observation.factFamily.fingerprint,
        taskId: specification.observation.factFamily.taskId,
        title: specification.observation.factFamily.title
      },
      task
    })
  }

  const claimIntentRecord = records.findLast(
    ({ event }) => event._tag === "TaskClaimAcquisitionIntended" && event.operation.acquisition.taskId === task.id
  )
  if (claimIntentRecord?.event._tag === "TaskClaimAcquisitionIntended") {
    const claimOperationId = claimIntentRecord.event.operation.acquisition.operationId
    const acquired = records.some(
      ({ event, position }) =>
        position > claimIntentRecord.position && event._tag === "TaskClaimAcquired" && event.claim.taskId === task.id
    )
    /* v8 ignore start -- Maintained fresh stories acquire here; rejection is retried from a new current-task read. */
    if (acquired) {
      const postClaimGraph = records.findLast(
        ({ event }) =>
          event._tag === "TaskTrackerReadIntentRecorded" &&
          event.operation._tag === "ReadTrackerGraph" &&
          event.operation.predecessorOperationIds.includes(claimOperationId) &&
          observed.has(event.operation.operationId)
      )?.event
      if (postClaimGraph?._tag === "TaskTrackerReadIntentRecorded") {
        return FreshWorkflowStep.ReadTaskWorkSpecification({
          predecessorOperationId: postClaimGraph.operation.operationId,
          task
        })
      }
      return FreshWorkflowStep.ReadPostClaimGraph({
        claimOperation: claimIntentRecord.event.operation,
        predecessorOperationId: claimOperationId,
        task
      })
    }
    /* v8 ignore stop */
  }

  const currentTaskGraph = records.findLast(
    ({ event }) =>
      event._tag === "TaskTrackerReadIntentRecorded" &&
      event.operation._tag === "ReadTrackerGraph" &&
      event.operation.predecessorOperationIds.length === 0 &&
      event.operation.readShape.explicitlyCoveredTaskIds.includes(task.id) &&
      observed.has(event.operation.operationId)
  )?.event
  if (currentTaskGraph?._tag === "TaskTrackerReadIntentRecorded") {
    return FreshWorkflowStep.AcquireTaskClaim({ predecessorOperationId: currentTaskGraph.operation.operationId, task })
  }
  // A validated journaled frame has an accepted complete read covering every task it contains.
  const latestGraphCoveringTask = Option.getOrThrow(
    Option.fromUndefinedOr(
      records
        .flatMap(({ event }) =>
          event._tag === "TaskTrackerReadIntentRecorded" &&
          event.operation._tag === "ReadTrackerGraph" &&
          observed.has(event.operation.operationId) &&
          (event.operation.readShape.explicitlyCoveredTaskIds.length === 0 ||
            event.operation.readShape.explicitlyCoveredTaskIds.includes(task.id))
            ? [event.operation]
            : []
        )
        .at(lastElementOffset)
    )
  )
  return FreshWorkflowStep.ReadCurrentTaskGraph({ predecessorOperationId: latestGraphCoveringTask.operationId, task })
}

const executorResponsibilityStillOwnsTask = (
  responsibility: Extract<WorkflowResponsibilityEntry, { readonly _tag: "PlannedAttemptExecutorWorkResponsibility" }>,
  records: ReadonlyArray<JournalRecord>,
  recoveredAttemptIds: ReadonlySet<AttemptId>
): boolean => {
  if (recoveredAttemptIds.has(responsibility.plannedAttempt.attemptId)) return true
  const latestReport = records.findLast(
    ({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkReported" &&
      event.report.correlation.attemptId === responsibility.plannedAttempt.attemptId
  )
  const exactEvidence = latestPlannedAttemptExecutorEvidence(records, responsibility.plannedAttempt)
  const projectionIssue = latestPlannedAttemptExecutorProjectionIssue(records, responsibility.plannedAttempt)
  if (
    projectionIssue !== undefined &&
    (exactEvidence === undefined || projectionIssue.observedAt > exactEvidence.observedAt)
  ) {
    return true
  }
  if (
    latestReport?.event._tag === "PlannedAttemptExecutorWorkReported" &&
    latestReport.event.report._tag === "Running"
  ) {
    const latestSpecification = records.findLast(
      ({ event }) =>
        event._tag === "TaskTrackerFactsObserved" &&
        event.observation._tag === "FocusedTaskWorkSpecificationFacts" &&
        event.observation.factFamily.taskId === responsibility.plannedAttempt.taskId
    )
    if (
      latestSpecification?.event._tag === "TaskTrackerFactsObserved" &&
      latestSpecification.event.observation._tag === "FocusedTaskWorkSpecificationFacts"
    ) {
      if (latestSpecification.event.observation.factFamily.fingerprint !== responsibility.plannedAttempt.taskRevision) {
        return true
      }
    }
    if (
      specificationReadRequiredAfterProgressGraph(records, responsibility.plannedAttempt, latestReport.position) !==
      undefined
    ) {
      return true
    }
  }
  return (
    latestReport !== undefined &&
    latestReport.event._tag === "PlannedAttemptExecutorWorkReported" &&
    latestReport.event.report._tag !== "Running"
  )
}

export const responsibilityStillOwnsTask = (
  responsibility: WorkflowResponsibilityEntry,
  records: ReadonlyArray<JournalRecord>,
  recoveredAttemptIds: ReadonlySet<AttemptId>
): boolean => {
  if (responsibility._tag === "PlannedAttemptExecutorWorkResponsibility") {
    return executorResponsibilityStillOwnsTask(responsibility, records, recoveredAttemptIds)
  }
  if (responsibility._tag === "TaskClaimReleaseResponsibility") return true
  if (responsibility._tag === "TaskClaimResponsibility") {
    return !records.some(
      ({ event, position }) =>
        position > responsibility.beganAt &&
        ((event._tag === "TaskClaimAcquired" && event.claim.taskId === responsibility.taskId) ||
          (event._tag === "TaskClaimAcquisitionRejected" &&
            event.operationId === responsibility.acquisition.operationId))
    )
  }
  return !records.some(
    ({ event, position }) =>
      position > responsibility.beganAt &&
      event._tag === "TaskWorktreeReady" &&
      event.operationId === responsibility.operation.operationId
  )
}

/** Derives fresh work only for eligible tasks with no reconstructed responsibility. */
// eslint-disable-next-line complexity -- Delivery selection combines the accepted pause, responsibility, graph, and source variants.
export const deriveFreshWorkflowDecisions = (
  frame: CurrentDeliveryFrame,
  recoveredAttemptIds: ReadonlySet<AttemptId> = new Set()
): ReadonlyArray<FreshWorkflowDecision> => {
  if (frame.pause.run._tag === "RunPaused") return []
  const records = frame.workflowHistory.records
  const responsibleTaskIds = new Set(
    frame.responsibility.entries
      .filter((responsibility) => responsibilityStillOwnsTask(responsibility, records, recoveredAttemptIds))
      .map(responsibilityTaskId)
  )
  const pauseCoveredTaskIds =
    frame.pause.tasks._tag === "NoTaskPauses"
      ? new Set<TaskId>()
      : new Set(frame.pause.tasks.taskIds.flatMap((taskId) => frame.currentGraph.groupingSubtreeOf(taskId)))
  const observed = observedOperationIds(records)
  const latestGlobalGraphRead = records.findLast(
    ({ event }) =>
      event._tag === "TaskTrackerReadIntentRecorded" &&
      event.operation._tag === "ReadTrackerGraph" &&
      event.operation.readShape.explicitlyCoveredTaskIds.length === 0 &&
      observed.has(event.operation.operationId)
  )
  const latestGlobalGraphOperation =
    latestGlobalGraphRead?.event._tag === "TaskTrackerReadIntentRecorded" &&
    latestGlobalGraphRead.event.operation._tag === "ReadTrackerGraph"
      ? latestGlobalGraphRead.event.operation
      : undefined
  const latestGlobalGraphObservationPosition =
    latestGlobalGraphOperation === undefined
      ? undefined
      : records.find(
          ({ event }) =>
            event._tag === "TaskTrackerFactsObserved" && event.operationId === latestGlobalGraphOperation.operationId
        )?.position
  /* v8 ignore start -- Accepted global observations always retain an outcome position and reconstruct under validated history. */
  const candidateGraph =
    latestGlobalGraphOperation !== undefined
      ? Option.getOrElse(
          reconstructedTaskGraphFromEvents(
            records
              .filter(
                ({ position }) =>
                  position <= (latestGlobalGraphObservationPosition ?? latestGlobalGraphRead?.position ?? 0)
              )
              .map(({ event }) => event),
            latestGlobalGraphOperation.target
          ),
          () => frame.currentGraph
        )
      : frame.currentGraph
  /* v8 ignore stop */
  const currentlyEligibleTaskIds = new Set(frame.currentGraph.eligibleTasks().map(({ id }) => id))
  const decisions = candidateGraph
    .eligibleTasks()
    .filter(({ id }) => currentlyEligibleTaskIds.has(id) && !responsibleTaskIds.has(id) && !pauseCoveredTaskIds.has(id))
    .map((task) => decisionFor(journaledStepFor(task, records, recoveredAttemptIds, observed)))
  if (decisions.some(({ step }) => step._tag === "ReadCurrentTaskGraph")) {
    return decisions.filter(({ step }) => step._tag === "ReadCurrentTaskGraph")
  }
  const rank = (step: FreshWorkflowStepType): number =>
    step._tag === "ReadPostClaimGraph"
      ? postClaimGraphRank
      : step._tag === "AcquireTaskClaim"
        ? claimRank
        : step._tag === "ReadTaskWorkSpecification"
          ? specificationRank
          : step._tag === "StartPlannedAttemptExecutorWork" || step._tag === "ContinuePlannedAttemptExecutorWork"
            ? executorWorkRank
            : otherWorkflowOperationRank
  return decisions.toSorted((left, right) => rank(left.step) - rank(right.step))
}
