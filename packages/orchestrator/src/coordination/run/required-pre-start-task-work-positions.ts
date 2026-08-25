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

const latestClaimIntentByTask = (
  records: ReadonlyArray<JournalRecord>,
  runId: RunId
): ReadonlyMap<
  TaskId,
  Extract<WorkflowJournalEvent, { readonly _tag: "TaskClaimAcquisitionIntended" }> & {
    readonly _recordPosition: JournalRecord["position"]
  }
> => {
  const intents = new Map<
    TaskId,
    Extract<WorkflowJournalEvent, { readonly _tag: "TaskClaimAcquisitionIntended" }> & {
      readonly _recordPosition: JournalRecord["position"]
    }
  >()
  for (const record of records) {
    if (record.runId !== runId || record.event._tag !== "TaskClaimAcquisitionIntended") continue
    intents.set(record.event.operation.acquisition.taskId, { ...record.event, _recordPosition: record.position })
  }
  return intents
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
    if (event._tag === "TaskClaimReleased") return isExactTaskClaim(event.release.claim, claim)
    if (
      event._tag === "StoppedAttemptClaimNoReleaseObserved" ||
      event._tag === "CancelledAttemptClaimNoReleaseObserved"
    ) {
      if (!isExactTaskClaim(event.expectedClaim, claim)) return false
      return event.observation._tag === "UnclaimedTask"
        ? event.observation.taskId === taskId
        : !isExactTaskClaim(event.observation, claim)
    }
    if (event._tag === "AttemptImplementationAbandoned") {
      return isExactTaskClaim(event.expectedClaim, claim)
    }
    if (event._tag === "CompletionClaimReplaced" || event._tag === "IntegrationFinalitySettled") {
      return isExactTaskClaim(event.claim.originalClaim, claim)
    }
    return false
  })

const planAfterClaim = (
  records: ReadonlyArray<JournalRecord>,
  runId: RunId,
  taskId: TaskId,
  claimOperationId: OperationId,
  after: JournalRecord["position"]
): { readonly plannedAttempt: PlannedTaskAttempt; readonly position: JournalRecord["position"] } | undefined => {
  const plans = records.flatMap((record) => {
    if (record.runId !== runId || record.position <= after) return []
    const operation =
      record.event._tag === "TaskAttemptPlanned"
        ? record.event.operation
        : record.event._tag === "PlannedAttemptReplaced"
          ? record.event.successorPlan
          : undefined
    if (
      operation === undefined ||
      operation.plannedAttempt.runId !== runId ||
      operation.plannedAttempt.taskId !== taskId ||
      !causalPredecessorOperationIds(
        records.filter(({ runId: recordRunId }) => recordRunId === runId),
        operation
      ).has(claimOperationId)
    )
      return []
    return [{ plannedAttempt: operation.plannedAttempt, position: record.position }]
  })
  const latestPlanIndex = plans.length - 1
  return latestPlanIndex >= 0 ? plans[latestPlanIndex] : undefined
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
    const taskId = intent.operation.acquisition.taskId
    const operationId = intent.operation.acquisition.operationId
    const outcome = records.findLast(({ event, position, runId }) => {
      if (runId !== runState.runId || position <= intent._recordPosition) return false
      return (
        (event._tag === "TaskClaimAcquired" && event.claim.operationId === operationId) ||
        (event._tag === "TaskClaimAcquisitionRejected" && event.operationId === operationId)
      )
    })
    if (outcome?.event._tag === "TaskClaimAcquisitionRejected") continue
    if (outcome?.event._tag !== "TaskClaimAcquired") {
      positions.push({ _tag: "UnplannedPreStartTaskWorkPosition", claimOperationId: operationId, taskId })
      continue
    }
    if (taskClaimReleasedAfter(records, runState.runId, taskId, outcome.event.claim, outcome.position)) continue
    const plan = planAfterClaim(records, runState.runId, taskId, operationId, outcome.position)
    if (plan === undefined) {
      positions.push({ _tag: "UnplannedPreStartTaskWorkPosition", claimOperationId: operationId, taskId })
      continue
    }
    const executorBegan = records.some(
      ({ event, runId: recordRunId }) =>
        recordRunId === runState.runId &&
        event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
        plannedTaskAttemptEquivalence(event.plannedAttempt, plan.plannedAttempt)
    )
    if (!executorBegan) {
      positions.push({
        _tag: "PlannedPreStartTaskWorkPosition",
        claimOperationId: operationId,
        correlation: { attemptId: plan.plannedAttempt.attemptId, runId: plan.plannedAttempt.runId },
        taskId
      })
    }
  }
  return positions
}
