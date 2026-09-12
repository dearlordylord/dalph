/* eslint-disable max-lines -- Fresh selection reconstructs one journaled workflow and its complete eligibility relation together. */
import { Option } from "effect"
import {
  TaskWorkSpecification,
  plannedTaskAttemptEquivalence,
  type AttemptId,
  type PlannedTaskAttempt,
  type RunId,
  type TaskId
} from "@dalph/contracts"
import type { Task } from "../../authorities/task-tracker/task.js"
import { ActiveTaskClaim, isExactTaskClaim } from "../../authorities/task-tracker/claim-mutation.js"
import { taskTrackerTargetKey, type TrackerTarget } from "../../authorities/task-tracker/target.js"
import { taskRevisionFor } from "../../authorities/task-tracker/graph.js"
import {
  journalRecordByKey,
  journalRecordsForTask,
  journalRecordsOfKind,
  isJournalRecordEvidence,
  lastJournalRecordForAttemptKind,
  type JournalHistorySource
} from "../../workflow-journal/record-evidence.js"
import type { OperationId } from "../../workflow/identity.js"
import { RunnableFrontierTransition, type RunnableFrontierTransition as Transition } from "../frontier/frontier.js"
import type { WorkflowResponsibilityEntry } from "../reconstruction/state.js"
import type { CurrentDeliveryFrame } from "./current-delivery-frame.js"
import { reconstructedTaskGraphFromEvents } from "../reconstruction/graph-knowledge.js"
import { FreshWorkflowStep, type FreshWorkflowStep as FreshWorkflowStepType } from "../delivery/fresh-workflow-step.js"
import { recordedTaskAttemptPlans } from "../../workflow/protocols/task-attempt-planning/journal-evidence.js"
import {
  latestPlannedAttemptExecutorEvidence,
  latestPlannedAttemptExecutorProjectionIssue
} from "../../workflow/protocols/planned-attempt-executor-work/evidence.js"
import { intentRecordKey, outcomeRecordKey } from "../../workflow-journal/record-key.js"
import {
  causalPredecessorOperationIds,
  causalPredecessorOperationIdsFromEvidence
} from "../../workflow/causal-history.js"
import { rejectedFreshTaskClaimDisposition as rejectedClaim } from "./rejected-fresh-task-claim.js"
import { projectFreshTaskCommitments } from "../admission/fresh-task-admission-projection.js"
import { acceptedFreshAttemptLineage } from "../admission/fresh-attempt-lineage.js"
import {
  authorizeReplacementContinuationStep,
  replacementContinuationAuthorityFrom,
  type ReplacementContinuationStep
} from "../delivery/replacement-continuation-authority.js"

const postClaimGraphRank = 0
const claimRank = 1

/** Live accepted evidence stays indexed; only explicit cold diagnostic history enters through decoded arrays. */
const causalPredecessorsFromHistory = (
  records: JournalHistorySource,
  operation: Parameters<typeof causalPredecessorOperationIds>[1]
) =>
  isJournalRecordEvidence(records)
    ? causalPredecessorOperationIdsFromEvidence(records, operation)
    : causalPredecessorOperationIds(records, operation)
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
      : step._tag === "BeginPlannedAttemptExecutorWork" || step._tag === "ObservePlannedAttemptExecutorWork"
        ? step._tag === "BeginPlannedAttemptExecutorWork"
          ? RunnableFrontierTransition.BeginPlannedAttemptExecutorWork({ plannedAttempt: step.plannedAttempt })
          : RunnableFrontierTransition.ObservePlannedAttemptExecutorWork({
              acceptedProgress: step.acceptedProgress,
              plannedAttempt: step.plannedAttempt
            })
        : continued(step.task.id, step.predecessorOperationId)
})

const observedOperationIdsByPrefix = new WeakMap<object, ReadonlySet<OperationId>>()
const completeGraphObservationIdsByPrefix = new WeakMap<object, ReadonlySet<OperationId>>()

function* observedOperationIdValues(records: JournalHistorySource): Iterable<OperationId> {
  for (const { event } of journalRecordsOfKind(records, "TaskTrackerFactsObserved")) {
    if (event._tag === "TaskTrackerFactsObserved") yield event.operationId
  }
  for (const { event } of journalRecordsOfKind(records, "TaskWorktreeReady")) {
    if (event._tag === "TaskWorktreeReady") yield event.operationId
  }
}

const deriveObservedOperationIds = (records: JournalHistorySource): ReadonlySet<OperationId> =>
  new Set(observedOperationIdValues(records))

const observedOperationIds = (records: JournalHistorySource): ReadonlySet<OperationId> => {
  if (!isJournalRecordEvidence(records)) return deriveObservedOperationIds(records)
  const cached = observedOperationIdsByPrefix.get(records)
  if (cached !== undefined) return cached
  const observed = deriveObservedOperationIds(records)
  observedOperationIdsByPrefix.set(records, observed)
  return observed
}

/** Only a complete current graph outcome can authorize a claim; a typed read failure merely settles its read. */
function* completeGraphObservationIdValues(records: JournalHistorySource): Iterable<OperationId> {
  for (const { event } of journalRecordsOfKind(records, "TaskTrackerFactsObserved")) {
    if (
      event._tag === "TaskTrackerFactsObserved" &&
      (event.observation._tag === "CompleteTaskTrackerFacts" ||
        event.observation._tag === "UnchangedTaskTrackerFactsReconfirmed")
    ) {
      yield event.operationId
    }
  }
}

const deriveCompleteGraphObservationIds = (records: JournalHistorySource): ReadonlySet<OperationId> =>
  new Set(completeGraphObservationIdValues(records))

/** Immutable accepted evidence is safe to memoize; mutable diagnostic arrays are deliberately recomputed. */
const completeGraphObservationIds = (records: JournalHistorySource): ReadonlySet<OperationId> => {
  if (!isJournalRecordEvidence(records)) return deriveCompleteGraphObservationIds(records)
  const cached = completeGraphObservationIdsByPrefix.get(records)
  if (cached !== undefined) return cached
  const observed = deriveCompleteGraphObservationIds(records)
  completeGraphObservationIdsByPrefix.set(records, observed)
  return observed
}

const plannedSpecificationFor = (
  records: JournalHistorySource,
  plannedAttempt: PlannedTaskAttempt,
  immutableRunTargetKey: string,
  operationId?: OperationId
) => {
  const specification = Array.from(journalRecordsForTask(records, plannedAttempt.taskId)).findLast(
    ({ event }) =>
      event._tag === "TaskTrackerFactsObserved" &&
      event.observation._tag === "FocusedTaskWorkSpecificationFacts" &&
      (operationId === undefined || event.operationId === operationId) &&
      taskTrackerTargetKey(event.observation.target) === immutableRunTargetKey &&
      event.observation.factFamily.taskId === plannedAttempt.taskId &&
      event.observation.factFamily.fingerprint === plannedAttempt.taskRevision
  )
  return specification?.event._tag === "TaskTrackerFactsObserved" &&
    specification.event.observation._tag === "FocusedTaskWorkSpecificationFacts"
    ? TaskWorkSpecification.make({
        body: specification.event.observation.factFamily.body,
        fingerprint: specification.event.observation.factFamily.fingerprint,
        taskId: specification.event.observation.factFamily.taskId,
        title: specification.event.observation.factFamily.title
      })
    : undefined
}

// eslint-disable-next-line complexity -- Closed journal occurrence families route to one next workflow operation.
const journaledStepFor = (
  task: Task,
  runId: RunId,
  records: JournalHistorySource,
  recoveredAttemptIds: ReadonlySet<AttemptId>,
  observed: ReadonlySet<OperationId>,
  completeGraphObserved: ReadonlySet<OperationId>,
  immutableRunTargetKey: string
): FreshWorkflowStepType | undefined => {
  const taskRecords = Array.from(journalRecordsForTask(records, task.id))
  const commitment = projectFreshTaskCommitments(runId, records).find(
    (candidate) => candidate.commitment.operation.acquisition.taskId === task.id
  )?.commitment
  const executorResponsibility = taskRecords.findLast(
    ({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" && event.plannedAttempt.taskId === task.id
  )?.event
  if (
    executorResponsibility?._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
    !recoveredAttemptIds.has(executorResponsibility.plannedAttempt.attemptId)
  ) {
    const report = lastJournalRecordForAttemptKind(
      records,
      executorResponsibility.plannedAttempt.attemptId,
      "PlannedAttemptExecutorWorkReported"
    )?.event
    const specification = plannedSpecificationFor(records, executorResponsibility.plannedAttempt, immutableRunTargetKey)
    /* v8 ignore start -- A fresh non-running report already transfers the task to terminal or integration responsibility. */
    if (
      report?._tag === "PlannedAttemptExecutorWorkReported" &&
      report.report._tag === "ExecutorWorkExecuting" &&
      specification !== undefined
    ) {
      return FreshWorkflowStep.ObservePlannedAttemptExecutorWork({
        acceptedProgress: { _tag: "ExecutorReportAccepted", ordinal: report.ordinal },
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
    const ordinaryPlanWasRecorded = taskRecords.some(
      ({ event }) =>
        event._tag === "TaskAttemptPlanned" &&
        event.operation.operationId === plan.operationId &&
        plannedTaskAttemptEquivalence(event.operation.plannedAttempt, plan.plannedAttempt)
    )
    if (ordinaryPlanWasRecorded) {
      const lineage = acceptedFreshAttemptLineage(records, plan.plannedAttempt, "Plan")
      if (
        lineage === undefined ||
        commitment === undefined ||
        commitment.operation.acquisition.operationId !== lineage.claimOperationId
      ) {
        return undefined
      }
      const specification = plannedSpecificationFor(
        records,
        plan.plannedAttempt,
        immutableRunTargetKey,
        lineage.specificationOperationId
      )
      if (specification === undefined) return undefined
      const worktree = taskRecords.findLast(
        ({ event }) =>
          event._tag === "TaskWorktreeReconciliationIntended" &&
          plannedTaskAttemptEquivalence(event.operation.plannedAttempt, plan.plannedAttempt) &&
          causalPredecessorsFromHistory(records, event.operation).has(lineage.planOperationId)
      )?.event
      const readyLineage = acceptedFreshAttemptLineage(records, plan.plannedAttempt, "WorktreeReady")
      if (readyLineage !== undefined) {
        return FreshWorkflowStep.BeginPlannedAttemptExecutorWork({
          claimOperationId: lineage.claimOperationId,
          plannedAttempt: plan.plannedAttempt,
          specification,
          task
        })
      }
      if (worktree?._tag === "TaskWorktreeReconciliationIntended" && observed.has(worktree.operation.operationId)) {
        return undefined
      }
      return FreshWorkflowStep.ReconcileTaskWorktree({
        claimOperationId: lineage.claimOperationId,
        plannedAttempt: plan.plannedAttempt,
        predecessorOperationId: lineage.planOperationId,
        task
      })
    }

    // Replacement attempts retain their dedicated F2/K1/W1/H2 authority path.
    const replacementAuthority = replacementContinuationAuthorityFrom(
      records,
      runId,
      plan.plannedAttempt,
      plan.operationId
    )
    // No plan-stage continuation may cross Git, tracker, or executor boundaries
    // unless the exact acquired claim is in the plan's causal history.
    if (replacementAuthority === undefined) {
      return undefined
    }
    const replacementStep = <Step extends ReplacementContinuationStep>(step: Step): Step | undefined =>
      authorizeReplacementContinuationStep(replacementAuthority, step)
    const worktree = taskRecords.findLast(
      ({ event }) =>
        event._tag === "TaskWorktreeReconciliationIntended" &&
        plannedTaskAttemptEquivalence(event.operation.plannedAttempt, plan.plannedAttempt) &&
        causalPredecessorsFromHistory(records, event.operation).has(plan.operationId)
    )?.event
    if (worktree?._tag === "TaskWorktreeReconciliationIntended" && observed.has(worktree.operation.operationId)) {
      return replacementStep(
        FreshWorkflowStep.BeginPlannedAttemptExecutorWork({
          claimOperationId: replacementAuthority.claim.operationId,
          plannedAttempt: plan.plannedAttempt,
          specification: replacementAuthority.specification,
          task
        })
      )
    }
    return replacementStep(
      FreshWorkflowStep.ReconcileTaskWorktree({
        claimOperationId: replacementAuthority.claim.operationId,
        plannedAttempt: plan.plannedAttempt,
        predecessorOperationId: plan.operationId,
        task
      })
    )
  }

  const specification = taskRecords.findLast(
    ({ event }) =>
      event._tag === "TaskTrackerFactsObserved" &&
      event.observation._tag === "FocusedTaskWorkSpecificationFacts" &&
      taskTrackerTargetKey(event.observation.target) === immutableRunTargetKey &&
      event.observation.factFamily.taskId === task.id
  )?.event
  if (
    specification?._tag === "TaskTrackerFactsObserved" &&
    specification.observation._tag === "FocusedTaskWorkSpecificationFacts"
  ) {
    if (commitment === undefined) return undefined
    const specificationIntent = taskRecords.find(
      ({ event }) =>
        event._tag === "TaskTrackerReadIntentRecorded" &&
        event.operation._tag === "ReadTaskWorkSpecification" &&
        event.operation.operationId === specification.operationId
    )?.event
    if (
      specificationIntent?._tag !== "TaskTrackerReadIntentRecorded" ||
      !causalPredecessorsFromHistory(records, specificationIntent.operation).has(
        commitment.operation.acquisition.operationId
      )
    ) {
      return undefined
    }
    return FreshWorkflowStep.RecordTaskAttemptPlan({
      claimOperationId: commitment.operation.acquisition.operationId,
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

  const claimIntentRecord = taskRecords.findLast(
    ({ event, key }) =>
      event._tag === "TaskClaimAcquisitionIntended" &&
      event.operation.authority._tag === "TaskSelectionAuthority" &&
      event.operation.acquisition.taskId === task.id &&
      key === intentRecordKey(event.operation.acquisition.operationId)
  )
  if (claimIntentRecord?.event._tag === "TaskClaimAcquisitionIntended") {
    const acquisition = claimIntentRecord.event.operation.acquisition
    const claimOperationId = acquisition.operationId
    const expectedClaim = ActiveTaskClaim.make(acquisition)
    const acquired = taskRecords.some(
      ({ event, key, position, runId }) =>
        runId === claimIntentRecord.runId &&
        position > claimIntentRecord.position &&
        key === outcomeRecordKey(claimOperationId) &&
        event._tag === "TaskClaimAcquired" &&
        isExactTaskClaim(event.claim, expectedClaim)
    )
    /* v8 ignore start -- Maintained fresh stories acquire here; rejection is retried from a new current-task read. */
    if (acquired) {
      const postClaimGraph = taskRecords.findLast(
        ({ event }) =>
          event._tag === "TaskTrackerReadIntentRecorded" &&
          event.operation._tag === "ReadTrackerGraph" &&
          taskTrackerTargetKey(event.operation.target) === immutableRunTargetKey &&
          event.operation.predecessorOperationIds.includes(claimOperationId) &&
          observed.has(event.operation.operationId)
      )?.event
      if (postClaimGraph?._tag === "TaskTrackerReadIntentRecorded") {
        return FreshWorkflowStep.ReadTaskWorkSpecification({
          claimOperationId,
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

    const rejection = rejectedClaim(records, task, claimIntentRecord, completeGraphObserved, immutableRunTargetKey)
    if (rejection._tag === "ObserveConstraint") return rejection.step
    if (rejection._tag === "ConstraintRetained") return undefined
  }

  const currentTaskGraph = taskRecords.findLast(
    ({ event }) =>
      event._tag === "TaskTrackerReadIntentRecorded" &&
      event.operation._tag === "ReadTrackerGraph" &&
      taskTrackerTargetKey(event.operation.target) === immutableRunTargetKey &&
      event.operation.predecessorOperationIds.length === 0 &&
      event.operation.readShape.explicitlyCoveredTaskIds.includes(task.id) &&
      completeGraphObserved.has(event.operation.operationId)
  )?.event
  if (currentTaskGraph?._tag === "TaskTrackerReadIntentRecorded") {
    return FreshWorkflowStep.AcquireTaskClaim({ predecessorOperationId: currentTaskGraph.operation.operationId, task })
  }
  // A validated complete target-closure observation covers every returned task;
  // explicitlyCoveredTaskIds names causal subjects, not an exhaustive result set.
  const latestGraphCoveringTask = Option.getOrThrow(
    Option.fromUndefinedOr(
      Array.from(journalRecordsOfKind(records, "TaskTrackerReadIntentRecorded"))
        .flatMap(({ event }) =>
          event._tag === "TaskTrackerReadIntentRecorded" &&
          event.operation._tag === "ReadTrackerGraph" &&
          taskTrackerTargetKey(event.operation.target) === immutableRunTargetKey &&
          observed.has(event.operation.operationId)
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
  records: JournalHistorySource,
  recoveredAttemptIds: ReadonlySet<AttemptId>
): boolean => {
  if (recoveredAttemptIds.has(responsibility.plannedAttempt.attemptId)) return true
  const latestReport = lastJournalRecordForAttemptKind(
    records,
    responsibility.plannedAttempt.attemptId,
    "PlannedAttemptExecutorWorkReported"
  )
  const exactEvidence = latestPlannedAttemptExecutorEvidence(records, responsibility.plannedAttempt)
  const projectionIssue = latestPlannedAttemptExecutorProjectionIssue(records, responsibility.plannedAttempt)
  if (
    projectionIssue !== undefined &&
    (exactEvidence === undefined || projectionIssue.observedAt > exactEvidence.observedAt)
  ) {
    return true
  }
  return (
    latestReport !== undefined &&
    latestReport.event._tag === "PlannedAttemptExecutorWorkReported" &&
    latestReport.event.report._tag !== "ExecutorWorkExecuting"
  )
}

const claimResponsibilityStillOwnsTask = (
  responsibility: Extract<WorkflowResponsibilityEntry, { readonly _tag: "TaskClaimResponsibility" }>,
  records: JournalHistorySource
): boolean => {
  const outcome = journalRecordByKey(records, outcomeRecordKey(responsibility.acquisition.operationId))
  return !(
    outcome !== undefined &&
    outcome.position > responsibility.beganAt &&
    ((outcome.event._tag === "TaskClaimAcquired" && outcome.event.claim.taskId === responsibility.taskId) ||
      (outcome.event._tag === "TaskClaimAcquisitionRejected" &&
        outcome.event.operationId === responsibility.acquisition.operationId))
  )
}

export const responsibilityStillOwnsTask = (
  responsibility: WorkflowResponsibilityEntry,
  records: JournalHistorySource,
  recoveredAttemptIds: ReadonlySet<AttemptId>
): boolean => {
  if (responsibility._tag === "PlannedAttemptExecutorWorkResponsibility") {
    return executorResponsibilityStillOwnsTask(responsibility, records, recoveredAttemptIds)
  }
  if (responsibility._tag === "TaskClaimReleaseResponsibility") return true
  if (responsibility._tag === "TaskClaimResponsibility") {
    return claimResponsibilityStillOwnsTask(responsibility, records)
  }
  const outcome = journalRecordByKey(records, outcomeRecordKey(responsibility.operation.operationId))
  return !(
    outcome !== undefined &&
    outcome.position > responsibility.beganAt &&
    outcome.event._tag === "TaskWorktreeReady" &&
    outcome.event.operationId === responsibility.operation.operationId
  )
}

/**
 * Tasks that the complete current tracker graph still permits to enter fresh work.
 *
 * This is deliberately independent of the particular next workflow action that
 * happens to be proposed for a task. Runtime admission may retire an idle
 * pre-intent reservation only when this complete set omits the task.
 */
export const deriveFreshWorkflowEntryCapableTaskIds = (
  frame: CurrentDeliveryFrame,
  immutableRunTarget: TrackerTarget,
  recoveredAttemptIds: ReadonlySet<AttemptId> = new Set()
): ReadonlySet<TaskId> => {
  if (frame.pause.run._tag === "RunPaused") return new Set()
  const { completeGraphObserved, immutableRunTargetKey, pauseCoveredTaskIds, records, responsibleTaskIds } =
    freshWorkflowEligibilityContext(frame, recoveredAttemptIds, immutableRunTarget)
  return new Set(
    frame.currentGraph
      .eligibleTasks()
      .filter((task) => {
        const taskId = task.id
        if (responsibleTaskIds.has(taskId) || pauseCoveredTaskIds.has(taskId)) return false
        const latestClaimIntent = Array.from(journalRecordsForTask(records, taskId)).findLast(
          ({ event }) =>
            event._tag === "TaskClaimAcquisitionIntended" &&
            event.operation.authority._tag === "TaskSelectionAuthority" &&
            event.operation.acquisition.taskId === taskId
        )
        if (latestClaimIntent === undefined) return true
        const rejection = rejectedClaim(records, task, latestClaimIntent, completeGraphObserved, immutableRunTargetKey)
        return rejection._tag === "ConstraintAbsent" || rejection._tag === "ConstraintCleared"
      })
      .map(({ id }) => id)
  )
}

const freshWorkflowEligibilityContext = (
  frame: CurrentDeliveryFrame,
  recoveredAttemptIds: ReadonlySet<AttemptId>,
  immutableRunTarget: TrackerTarget
) => {
  const records: JournalHistorySource = frame.workflowHistory.evidence
  return {
    completeGraphObserved: completeGraphObservationIds(records),
    immutableRunTargetKey: taskTrackerTargetKey(immutableRunTarget),
    pauseCoveredTaskIds:
      frame.pause.tasks._tag === "NoTaskPauses"
        ? new Set<TaskId>()
        : new Set(frame.pause.tasks.taskIds.flatMap((taskId) => frame.currentGraph.groupingSubtreeOf(taskId))),
    records,
    responsibleTaskIds: new Set(
      frame.responsibility.entries
        .filter((responsibility) => responsibilityStillOwnsTask(responsibility, records, recoveredAttemptIds))
        .map(responsibilityTaskId)
    )
  }
}

/** Derives fresh work only for eligible tasks with no reconstructed responsibility. */
// eslint-disable-next-line complexity -- Delivery selection combines the accepted pause, responsibility, graph, and source variants.
export const deriveFreshWorkflowDecisions = (
  frame: CurrentDeliveryFrame,
  recoveredAttemptIds: ReadonlySet<AttemptId> = new Set(),
  immutableRunTarget: TrackerTarget
): ReadonlyArray<FreshWorkflowDecision> => {
  if (frame.pause.run._tag === "RunPaused") return []
  const { completeGraphObserved, immutableRunTargetKey, pauseCoveredTaskIds, records, responsibleTaskIds } =
    freshWorkflowEligibilityContext(frame, recoveredAttemptIds, immutableRunTarget)
  const observed = observedOperationIds(records)
  const latestGlobalGraphRead = Array.from(journalRecordsOfKind(records, "TaskTrackerReadIntentRecorded")).findLast(
    ({ event }) =>
      event._tag === "TaskTrackerReadIntentRecorded" &&
      event.operation._tag === "ReadTrackerGraph" &&
      taskTrackerTargetKey(event.operation.target) === immutableRunTargetKey &&
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
      : journalRecordByKey(records, outcomeRecordKey(latestGlobalGraphOperation.operationId))?.position
  /* v8 ignore start -- Accepted global observations always retain an outcome position and reconstruct under validated history. */
  const candidateGraph =
    latestGlobalGraphOperation !== undefined
      ? Option.getOrElse(
          reconstructedTaskGraphFromEvents(
            Array.from(journalRecordsOfKind(records, "TaskTrackerFactsObserved"))
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
      const step = journaledStepFor(
        task,
        frame.runId,
        records,
        recoveredAttemptIds,
        observed,
        completeGraphObserved,
        immutableRunTargetKey
      )
      return step === undefined ? [] : [decisionFor(step)]
    })
  const rank = (step: FreshWorkflowStepType): number =>
    step._tag === "ReadPostClaimGraph"
      ? postClaimGraphRank
      : step._tag === "AcquireTaskClaim"
        ? claimRank
        : step._tag === "ReadTaskWorkSpecification"
          ? specificationRank
          : step._tag === "BeginPlannedAttemptExecutorWork" || step._tag === "ObservePlannedAttemptExecutorWork"
            ? executorWorkRank
            : otherWorkflowOperationRank
  return decisions.toSorted((left, right) => rank(left.step) - rank(right.step))
}
