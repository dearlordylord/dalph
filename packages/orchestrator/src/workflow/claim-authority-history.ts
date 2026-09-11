import { type AttemptId, type PlannedTaskAttempt } from "@dalph/contracts"
import type { JournalRecord } from "../workflow-journal/store.js"
import type { OperationId } from "./identity.js"
import type { WorkflowJournalEvent } from "./registry/event.js"
import { causalPredecessorOperationIds, causalPredecessorOperationIdsFromEvidence } from "./causal-history.js"
import { taskClaimReacquisitionOperationId } from "./protocols/task-claim-reacquisition/plan.js"
import {
  isJournalRecordEvidence,
  journalRecordByKey,
  journalRecordsForAttemptKind,
  lastJournalRecordForTaskKind,
  type JournalHistorySource
} from "../workflow-journal/record-evidence.js"
import {
  attemptPlanRecordKey,
  intentRecordKey,
  outcomeRecordKey,
  plannedAttemptReplacedRecordKey,
  taskClaimReacquisitionDirectedRecordKey
} from "../workflow-journal/record-key.js"

type PlannedAttemptRecord = JournalRecord & {
  readonly event: Extract<WorkflowJournalEvent, { readonly _tag: "PlannedAttemptReplaced" | "TaskAttemptPlanned" }>
}

const isPlannedAttemptRecord = (record: JournalRecord): record is PlannedAttemptRecord =>
  record.event._tag === "TaskAttemptPlanned" || record.event._tag === "PlannedAttemptReplaced"

const exactPlanRecordForAttempt = (
  records: JournalHistorySource,
  attemptId: AttemptId
): PlannedAttemptRecord | undefined => {
  let exact: PlannedAttemptRecord | undefined
  const accept = (record: JournalRecord): boolean => {
    if (!isPlannedAttemptRecord(record)) return true
    const matches =
      (record.event._tag === "TaskAttemptPlanned" &&
        record.event.operation.plannedAttempt.attemptId === attemptId &&
        record.runId === record.event.operation.plannedAttempt.runId &&
        record.key === attemptPlanRecordKey(attemptId)) ||
      (record.event._tag === "PlannedAttemptReplaced" &&
        record.event.successorPlan.plannedAttempt.attemptId === attemptId &&
        record.runId === record.event.successorPlan.plannedAttempt.runId &&
        record.key === plannedAttemptReplacedRecordKey(record.event.subject.plannedAttempt.attemptId))
    if (!matches) return true
    if (exact !== undefined) return false
    exact = record
    return true
  }
  for (const record of journalRecordsForAttemptKind(records, attemptId, "TaskAttemptPlanned")) {
    if (!accept(record)) return undefined
  }
  for (const record of journalRecordsForAttemptKind(records, attemptId, "PlannedAttemptReplaced")) {
    if (!accept(record)) return undefined
  }
  return exact
}

const plannedOperationOf = (record: PlannedAttemptRecord) =>
  record.event._tag === "TaskAttemptPlanned" ? record.event.operation : record.event.successorPlan

const exactRecordByKey = (
  records: JournalHistorySource,
  key: Parameters<typeof journalRecordByKey>[1]
): JournalRecord | undefined => {
  if (isJournalRecordEvidence(records)) return journalRecordByKey(records, key)
  let exact: JournalRecord | undefined
  for (const record of records) {
    if (record.key !== key) continue
    if (exact !== undefined) return undefined
    exact = record
  }
  return exact
}

const exactClaimOutcomeForOperation = (
  records: JournalHistorySource,
  operationId: OperationId
): JournalRecord | undefined => {
  const exact = exactRecordByKey(records, outcomeRecordKey(operationId))
  return exact?.event._tag === "TaskClaimAcquired" ? exact : undefined
}

/** Finds the exact acquired claim in one planned attempt's causal history. */
export const causalClaimForAttempt = (
  records: JournalHistorySource,
  attemptId: AttemptId
): Extract<WorkflowJournalEvent, { readonly _tag: "TaskClaimAcquired" }> | undefined => {
  const planRecord = exactPlanRecordForAttempt(records, attemptId)
  if (planRecord === undefined) return undefined
  const operation = plannedOperationOf(planRecord)
  const predecessors = isJournalRecordEvidence(records)
    ? causalPredecessorOperationIdsFromEvidence(records, operation)
    : causalPredecessorOperationIds(records, operation)
  let claimOutcome: JournalRecord | undefined
  for (const predecessor of predecessors) {
    const candidate = exactClaimOutcomeForOperation(records, predecessor)
    if (
      candidate?.event._tag !== "TaskClaimAcquired" ||
      candidate.runId !== planRecord.runId ||
      candidate.event.claim.taskId !== operation.plannedAttempt.taskId ||
      candidate.position >= planRecord.position
    )
      continue
    if (claimOutcome !== undefined) return undefined
    claimOutcome = candidate
  }
  if (claimOutcome?.event._tag !== "TaskClaimAcquired") return undefined
  const claim = claimOutcome.event.claim
  const claimIntent = exactRecordByKey(records, intentRecordKey(claim.operationId))
  return claimIntent?.event._tag === "TaskClaimAcquisitionIntended" &&
    claimIntent.runId === planRecord.runId &&
    claimIntent.event.operation.acquisition.operationId === claim.operationId &&
    claimIntent.event.operation.acquisition.owner === claim.owner &&
    claimIntent.event.operation.acquisition.taskId === claim.taskId &&
    claimIntent.event.operation.acquisition.token === claim.token &&
    claimIntent.position < claimOutcome.position
    ? claimOutcome.event
    : undefined
}

/** Finds the original planned claim or the latest claim authorized by an exact accepted reacquisition direction. */
type AcquiredClaimEvent = Extract<WorkflowJournalEvent, { readonly _tag: "TaskClaimAcquired" }>
const deriveAuthorizedClaimForAttempt = (
  records: JournalHistorySource,
  plannedAttempt: PlannedTaskAttempt
): AcquiredClaimEvent | undefined => {
  const plannedRecord = exactPlanRecordForAttempt(records, plannedAttempt.attemptId)
  if (plannedRecord === undefined || plannedRecord.runId !== plannedAttempt.runId) return undefined
  const claimRecord = lastJournalRecordForTaskKind(records, plannedAttempt.taskId, "TaskClaimAcquired")
  if (
    claimRecord?.event._tag !== "TaskClaimAcquired" ||
    claimRecord.runId !== plannedAttempt.runId ||
    claimRecord.key !== outcomeRecordKey(claimRecord.event.claim.operationId)
  )
    return causalClaimForAttempt(records, plannedAttempt.attemptId)
  const event = claimRecord.event
  const intent = exactRecordByKey(records, intentRecordKey(event.claim.operationId))
  if (
    intent?.event._tag !== "TaskClaimAcquisitionIntended" ||
    intent.position >= claimRecord.position ||
    intent.runId !== plannedAttempt.runId ||
    intent.event.operation.authority._tag !== "ExplicitTaskClaimReacquisitionAuthority" ||
    intent.event.operation.acquisition.operationId !== event.claim.operationId ||
    intent.event.operation.acquisition.owner !== event.claim.owner ||
    intent.event.operation.acquisition.taskId !== event.claim.taskId ||
    intent.event.operation.acquisition.token !== event.claim.token
  )
    return causalClaimForAttempt(records, plannedAttempt.attemptId)
  const authority = intent.event.operation.authority
  const direction = exactRecordByKey(records, taskClaimReacquisitionDirectedRecordKey(authority.requestId))
  return direction?.event._tag === "TaskClaimReacquisitionDirected" &&
    direction.position < intent.position &&
    direction.position > plannedRecord.position &&
    direction.runId === plannedAttempt.runId &&
    direction.event.subject.runId === plannedAttempt.runId &&
    direction.event.subject.taskId === plannedAttempt.taskId &&
    direction.event.requestId === authority.requestId &&
    taskClaimReacquisitionOperationId(direction.event.requestId) === event.claim.operationId
    ? event
    : causalClaimForAttempt(records, plannedAttempt.attemptId)
}

export const authorizedClaimForAttempt = (
  records: JournalHistorySource,
  plannedAttempt: PlannedTaskAttempt
): AcquiredClaimEvent | undefined => {
  return deriveAuthorizedClaimForAttempt(records, plannedAttempt)
}
