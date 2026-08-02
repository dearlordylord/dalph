import { Option } from "effect"
import type { AttemptId, TaskId } from "@dalph/contracts"
import type { Task } from "../../authorities/task-tracker/task.js"
import { taskRevisionFor } from "../../authorities/task-tracker/graph.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import type { OperationId } from "../../workflow/identity.js"
import { RunnableFrontierTransition, type RunnableFrontierTransition as Transition } from "../frontier/frontier.js"
import type { WorkflowResponsibilityEntry } from "../reconstruction/state.js"
import type { CurrentDeliveryFrame } from "./current-delivery-relation.js"
import type { SyntheticWorkflowFact } from "./fresh-workflow-fact.js"
import { reconstructedTaskGraphFromEvents } from "../reconstruction/graph-knowledge.js"
import { FreshWorkflowStep, type FreshWorkflowStep as FreshWorkflowStepType } from "../delivery/fresh-workflow-step.js"

const postClaimGraphRank = 0
const claimRank = 1
const specificationRank = 2
const otherWorkflowOperationRank = 3
const executorWorkRank = 4

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
          : RunnableFrontierTransition.ContinuePlannedAttemptExecutorWork({ plannedAttempt: step.plannedAttempt })
        : continued(step.task.id, step.predecessorOperationId)
})

const observedOperationIds = (records: ReadonlyArray<JournalRecord>): ReadonlySet<OperationId> =>
  new Set(
    records.flatMap(({ event }) =>
      event._tag === "TaskTrackerFactsObserved" || event._tag === "TaskWorktreeReady" ? [event.operationId] : []
    )
  )

// eslint-disable-next-line complexity -- Closed journal occurrence families route to one next workflow operation.
const journaledStepFor = (
  task: Task,
  records: ReadonlyArray<JournalRecord>,
  currentGraphOperationId: OperationId,
  recoveredAttemptIds: ReadonlySet<AttemptId>
): FreshWorkflowStepType => {
  const executorResponsibility = records.findLast(
    ({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" && event.plannedAttempt.taskId === task.id
  )?.event
  if (
    executorResponsibility?._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
    !recoveredAttemptIds.has(executorResponsibility.plannedAttempt.attemptId)
  ) {
    const report = records.findLast(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkReported" &&
        event.report.correlation.attemptId === executorResponsibility.plannedAttempt.attemptId
    )?.event
    /* v8 ignore start -- A fresh non-running report already transfers the task to terminal or integration responsibility. */
    if (report?._tag === "PlannedAttemptExecutorWorkReported" && report.report._tag === "Running") {
      return FreshWorkflowStep.ContinuePlannedAttemptExecutorWork({
        plannedAttempt: executorResponsibility.plannedAttempt,
        task
      })
    }
    /* v8 ignore stop */
  }
  const observed = observedOperationIds(records)
  const plan = records.findLast(
    ({ event }) => event._tag === "TaskAttemptPlanned" && event.operation.plannedAttempt.taskId === task.id
  )?.event
  if (plan?._tag === "TaskAttemptPlanned") {
    const worktree = records.findLast(
      ({ event }) =>
        event._tag === "TaskWorktreeReconciliationIntended" &&
        event.operation.plannedAttempt.attemptId === plan.operation.plannedAttempt.attemptId
    )?.event
    if (worktree?._tag === "TaskWorktreeReconciliationIntended" && observed.has(worktree.operation.operationId)) {
      return FreshWorkflowStep.StartPlannedAttemptExecutorWork({ plannedAttempt: plan.operation.plannedAttempt, task })
    }
    return FreshWorkflowStep.ReconcileTaskWorktree({
      plannedAttempt: plan.operation.plannedAttempt,
      predecessorOperationId: plan.operation.operationId,
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
  return FreshWorkflowStep.ReadCurrentTaskGraph({ predecessorOperationId: currentGraphOperationId, task })
}

// eslint-disable-next-line complexity -- Accepted non-durable facts derive the same next workflow operation families.
const syntheticStepFor = (
  task: Task,
  facts: ReadonlyArray<SyntheticWorkflowFact>,
  currentGraphOperationId: OperationId
): FreshWorkflowStepType | undefined => {
  const fact = facts.findLast(({ taskId }) => taskId === task.id)
  if (fact === undefined) {
    return FreshWorkflowStep.ReadCurrentTaskGraph({ predecessorOperationId: currentGraphOperationId, task })
  }
  switch (fact._tag) {
    case "CurrentTaskGraphObserved":
      return fact.snapshot.eligibleTasks().some(({ id }) => id === task.id)
        ? FreshWorkflowStep.AcquireTaskClaim({ predecessorOperationId: fact.operationId, task })
        : undefined
    case "TaskClaimAcquisitionCompleted":
      return FreshWorkflowStep.ReadPostClaimGraph({
        claimOperation: fact.operation,
        predecessorOperationId: fact.operation.acquisition.operationId,
        task
      })
    case "PostClaimGraphObserved":
      /* v8 ignore start -- Maintained dry-run graphs retain the just-claimed eligible task. */
      return fact.snapshot.eligibleTasks().some(({ id }) => id === task.id)
        ? FreshWorkflowStep.ReadTaskWorkSpecification({ predecessorOperationId: fact.operationId, task })
        : undefined
    /* v8 ignore stop */
    case "TaskWorkSpecificationObserved":
      return FreshWorkflowStep.RecordTaskAttemptPlan({
        predecessorOperationId: fact.operationId,
        specification: fact.specification,
        task
      })
    case "TaskAttemptPlanRecorded":
      return FreshWorkflowStep.ReconcileTaskWorktree({
        plannedAttempt: fact.plannedAttempt,
        predecessorOperationId: fact.operationId,
        task
      })
    case "TaskWorktreeReconciled":
      return FreshWorkflowStep.StartPlannedAttemptExecutorWork({ plannedAttempt: fact.plannedAttempt, task })
    case "PlannedAttemptExecutorWorkReported":
      return fact.report._tag === "Running"
        ? FreshWorkflowStep.ContinuePlannedAttemptExecutorWork({ plannedAttempt: fact.plannedAttempt, task })
        : undefined
  }
}

const responsibilityStillOwnsTask = (
  responsibility: WorkflowResponsibilityEntry,
  records: ReadonlyArray<JournalRecord>,
  recoveredAttemptIds: ReadonlySet<AttemptId>
): boolean => {
  if (responsibility._tag === "PlannedAttemptExecutorWorkResponsibility") {
    if (recoveredAttemptIds.has(responsibility.plannedAttempt.attemptId)) return true
    const report = records.findLast(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkReported" &&
        event.report.correlation.attemptId === responsibility.plannedAttempt.attemptId
    )?.event
    return report?._tag === "PlannedAttemptExecutorWorkReported" && report.report._tag !== "Running"
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
  const records = frame._tag === "JournaledCurrentDeliveryFrame" ? frame.workflowHistory.records : []
  const responsibleTaskIds = new Set(
    frame.responsibility.entries
      .filter((responsibility) => responsibilityStillOwnsTask(responsibility, records, recoveredAttemptIds))
      .map(responsibilityTaskId)
  )
  const pauseCoveredTaskIds =
    frame.pause.tasks._tag === "NoTaskPauses"
      ? new Set<TaskId>()
      : new Set(frame.pause.tasks.taskIds.flatMap((taskId) => frame.currentGraph.groupingSubtreeOf(taskId)))
  const observedOperationIds = new Set(
    records.flatMap(({ event }) => (event._tag === "TaskTrackerFactsObserved" ? [event.operationId] : []))
  )
  const latestGlobalGraphRead = records.findLast(
    ({ event }) =>
      event._tag === "TaskTrackerReadIntentRecorded" &&
      event.operation._tag === "ReadTrackerGraph" &&
      event.operation.predecessorOperationIds.length === 0 &&
      event.operation.readShape.explicitlyCoveredTaskIds.length === 0 &&
      observedOperationIds.has(event.operation.operationId)
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
    .flatMap((task) => {
      const step =
        frame._tag === "SyntheticCurrentDeliveryFrame"
          ? syntheticStepFor(task, frame.workflowFacts, frame.currentGraphOperationId)
          : journaledStepFor(task, records, frame.currentGraphOperationId, recoveredAttemptIds)
      return step === undefined ? [] : [decisionFor(step)]
    })
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
