/* eslint-disable functional/immutable-data -- Derivation mutates only private scratch collections before returning immutable values. */
import type { PlannedTaskAttempt, RunId, TaskId } from "@dalph/contracts"
import { plannedTaskAttemptEquivalence } from "@dalph/contracts"
import { isExactTaskClaim } from "../../authorities/task-tracker/claim-mutation.js"
import { causalPredecessorOperationIds } from "../../workflow/causal-history.js"
import type { OperationId } from "../../workflow/identity.js"
import type { ReconstructedRunState } from "../reconstruction/state.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import type { WorkflowJournalEvent } from "../../workflow/registry/event.js"
import type { RequiredPreStartTaskWorkPosition } from "../delivery/task-work-position.js"

type ClaimIntentRecord = Extract<WorkflowJournalEvent, { readonly _tag: "TaskClaimAcquisitionIntended" }> & {
  readonly _recordPosition: JournalRecord["position"]
}

type ClaimOutcomeRecord = JournalRecord & {
  readonly event: Extract<WorkflowJournalEvent, { readonly _tag: "TaskClaimAcquired" | "TaskClaimAcquisitionRejected" }>
}

type ClaimNoReleaseObservation = Extract<
  WorkflowJournalEvent,
  { readonly _tag: "StoppedAttemptClaimNoReleaseObserved" | "CancelledAttemptClaimNoReleaseObserved" }
>

const latestClaimIntentByTask = (
  records: ReadonlyArray<JournalRecord>,
  runId: RunId
): ReadonlyMap<TaskId, ClaimIntentRecord> => {
  const intents = new Map<TaskId, ClaimIntentRecord>()
  for (const record of records) {
    if (record.runId !== runId || record.event._tag !== "TaskClaimAcquisitionIntended") continue
    intents.set(record.event.operation.acquisition.taskId, { ...record.event, _recordPosition: record.position })
  }
  return intents
}

const claimNoReleaseObservationMatches = (
  event: ClaimNoReleaseObservation,
  taskId: TaskId,
  claim: Extract<WorkflowJournalEvent, { readonly _tag: "TaskClaimAcquired" }>["claim"]
): boolean => {
  if (!isExactTaskClaim(event.expectedClaim, claim)) return false
  return event.observation._tag === "UnclaimedTask"
    ? event.observation.taskId === taskId
    : !isExactTaskClaim(event.observation, claim)
}

const taskClaimReleaseEventMatches = (
  event: WorkflowJournalEvent,
  taskId: TaskId,
  claim: Extract<WorkflowJournalEvent, { readonly _tag: "TaskClaimAcquired" }>["claim"]
): boolean => {
  if (event._tag === "TaskClaimReleased") return isExactTaskClaim(event.release.claim, claim)
  if (
    event._tag === "StoppedAttemptClaimNoReleaseObserved" ||
    event._tag === "CancelledAttemptClaimNoReleaseObserved"
  ) {
    return claimNoReleaseObservationMatches(event, taskId, claim)
  }
  if (event._tag === "AttemptImplementationAbandoned") return isExactTaskClaim(event.expectedClaim, claim)
  if (event._tag === "CompletionClaimReplaced" || event._tag === "IntegrationFinalitySettled") {
    return isExactTaskClaim(event.claim.originalClaim, claim)
  }
  return false
}

const taskClaimReleasedAfter = (
  records: ReadonlyArray<JournalRecord>,
  runId: RunId,
  taskId: TaskId,
  claim: Extract<WorkflowJournalEvent, { readonly _tag: "TaskClaimAcquired" }>["claim"],
  after: JournalRecord["position"]
): boolean =>
  records.some(({ event, position, runId: recordRunId }) => {
    if (recordRunId !== runId || position <= after) return false
    return taskClaimReleaseEventMatches(event, taskId, claim)
  })

const plannedAttemptOperationFor = (
  event: WorkflowJournalEvent
): Extract<WorkflowJournalEvent, { readonly _tag: "TaskAttemptPlanned" }>["operation"] | undefined =>
  event._tag === "TaskAttemptPlanned"
    ? event.operation
    : event._tag === "PlannedAttemptReplaced"
      ? event.successorPlan
      : undefined

const planAfterClaim = (
  records: ReadonlyArray<JournalRecord>,
  runId: RunId,
  taskId: TaskId,
  claimOperationId: OperationId,
  after: JournalRecord["position"]
): { readonly plannedAttempt: PlannedTaskAttempt; readonly position: JournalRecord["position"] } | undefined => {
  const runRecords = records.filter(({ runId: recordRunId }) => recordRunId === runId)
  const plans = records.flatMap((record) => {
    if (record.runId !== runId || record.position <= after) return []
    const operation = plannedAttemptOperationFor(record.event)
    if (
      operation === undefined ||
      operation.plannedAttempt.runId !== runId ||
      operation.plannedAttempt.taskId !== taskId ||
      !causalPredecessorOperationIds(runRecords, operation).has(claimOperationId)
    )
      return []
    return [{ plannedAttempt: operation.plannedAttempt, position: record.position }]
  })
  const latestPlanIndex = plans.length - 1
  return latestPlanIndex >= 0 ? plans[latestPlanIndex] : undefined
}

const claimOutcomeFor = (
  records: ReadonlyArray<JournalRecord>,
  runId: RunId,
  intent: ClaimIntentRecord
): ClaimOutcomeRecord | undefined =>
  records.findLast(
    (record): record is ClaimOutcomeRecord =>
      record.runId === runId &&
      record.position > intent._recordPosition &&
      ((record.event._tag === "TaskClaimAcquired" &&
        record.event.claim.operationId === intent.operation.acquisition.operationId) ||
        (record.event._tag === "TaskClaimAcquisitionRejected" &&
          record.event.operationId === intent.operation.acquisition.operationId))
  )

const executorBeganFor = (
  records: ReadonlyArray<JournalRecord>,
  runId: RunId,
  plannedAttempt: PlannedTaskAttempt
): boolean =>
  records.some(
    ({ event, runId: recordRunId }) =>
      recordRunId === runId &&
      event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
      plannedTaskAttemptEquivalence(event.plannedAttempt, plannedAttempt)
  )

const requiredPositionForClaimIntent = (
  records: ReadonlyArray<JournalRecord>,
  runId: RunId,
  intent: ClaimIntentRecord
): RequiredPreStartTaskWorkPosition | undefined => {
  const taskId = intent.operation.acquisition.taskId
  const operationId = intent.operation.acquisition.operationId
  const outcome = claimOutcomeFor(records, runId, intent)
  if (outcome?.event._tag === "TaskClaimAcquisitionRejected") return undefined
  if (outcome?.event._tag !== "TaskClaimAcquired") {
    return { _tag: "UnplannedPreStartTaskWorkPosition", claimOperationId: operationId, taskId }
  }
  if (taskClaimReleasedAfter(records, runId, taskId, outcome.event.claim, outcome.position)) return undefined
  const plan = planAfterClaim(records, runId, taskId, operationId, outcome.position)
  if (plan === undefined) {
    return { _tag: "UnplannedPreStartTaskWorkPosition", claimOperationId: operationId, taskId }
  }
  return executorBeganFor(records, runId, plan.plannedAttempt)
    ? undefined
    : {
        _tag: "PlannedPreStartTaskWorkPosition",
        claimOperationId: operationId,
        correlation: { attemptId: plan.plannedAttempt.attemptId, runId: plan.plannedAttempt.runId },
        taskId
      }
}

/**
 * Derives pre-start positions from the exact current-run claim chronology.
 * The claim operation identity prevents an old or foreign acquisition result
 * from reserving a current task; a recorded plan upgrades the position to its
 * exact Run/Attempt pair until executor responsibility begins.
 */
export const requiredPreStartTaskWorkPositionsOf = (
  runState: Pick<ReconstructedRunState, "runId" | "responsibility" | "workflowHistory">
): ReadonlyArray<RequiredPreStartTaskWorkPosition> => {
  const records = runState.workflowHistory.records
  const positions: Array<RequiredPreStartTaskWorkPosition> = []
  for (const intent of latestClaimIntentByTask(records, runState.runId).values()) {
    const position = requiredPositionForClaimIntent(records, runState.runId, intent)
    if (position !== undefined) positions.push(position)
  }
  return positions
}
