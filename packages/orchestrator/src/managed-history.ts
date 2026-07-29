/* eslint-disable functional/immutable-data -- The total fold mutates only local validation indexes. */
import {
  type AttemptId,
  type JournalPosition,
  type JournalRecordKey,
  type OperationId,
  type PlannedTaskAttempt,
  type RunId,
  type TaskId
} from "./domain.js"
import { describeJournalEvent } from "./journal-event-descriptor.js"
import type { JournalRecord, WorkflowJournalEvent } from "./journal-store.js"
import {
  duplicateUnfinishedTaskAttemptIssue,
  type InvalidManagedHistory,
  ManagedHistoryIdentityIssue,
  type ManagedHistoryIssue,
  ManagedHistorySemanticIssue,
  type ValidManagedHistory
} from "./managed-history-result.js"
import { deriveManagedRunRecoveryStage } from "./managed-run-recovery-stage.js"
import { plannedTaskAttemptEquivalence } from "./planned-task-attempt.js"
import { reconstructValidatedManagedRunState } from "./reconstructed-managed-run.js"

const identityIssue = (
  issues: Array<ManagedHistoryIssue>,
  runId: RunId,
  position: JournalPosition,
  detail: string
): void => {
  issues.push(
    new ManagedHistoryIdentityIssue({
      detail,
      position,
      runId
    })
  )
}

const semanticIssue = (
  issues: Array<ManagedHistoryIssue>,
  runId: RunId,
  position: JournalPosition,
  detail: string
): void => {
  issues.push(
    new ManagedHistorySemanticIssue({
      detail,
      position,
      runId
    })
  )
}

interface FoldIndexes {
  readonly executorReportOrdinals: Map<AttemptId, number>
  readonly executorStarts: Map<AttemptId, {
    readonly plannedAttempt: PlannedTaskAttempt
    readonly position: JournalPosition
  }>
  readonly plans: Map<AttemptId, PlannedTaskAttempt>
  readonly seenEventKindsByOperation: Map<
    OperationId,
    ReadonlySet<WorkflowJournalEvent["_tag"]>
  >
  readonly seenKeys: Set<JournalRecordKey>
  readonly seenOperationIds: Set<OperationId>
  readonly terminalExecutorAttempts: Set<AttemptId>
}

const emptyIndexes = (): FoldIndexes => ({
  executorReportOrdinals: new Map(),
  executorStarts: new Map(),
  plans: new Map(),
  seenEventKindsByOperation: new Map(),
  seenKeys: new Set(),
  seenOperationIds: new Set(),
  terminalExecutorAttempts: new Set()
})

const validateRecordEnvelope = (
  record: JournalRecord,
  index: number,
  runId: RunId,
  indexes: FoldIndexes,
  issues: Array<ManagedHistoryIssue>
): boolean => {
  const expectedPosition = index + 1
  if (record.position !== expectedPosition) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `expected canonical position ${expectedPosition}, found ${record.position}`
    )
  }
  if (record.runId !== runId) {
    identityIssue(
      issues,
      runId,
      record.position,
      `record belongs to run ${record.runId}`
    )
  }
  const descriptor = describeJournalEvent(record.event)
  if (record.key !== descriptor.expectedKey) {
    identityIssue(
      issues,
      runId,
      record.position,
      `event ${record.event._tag} requires record key ${descriptor.expectedKey}, found ${record.key}`
    )
  }
  if (indexes.seenKeys.has(record.key)) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `duplicate journal record key ${record.key}`
    )
    return false
  }
  indexes.seenKeys.add(record.key)
  return true
}

const validateOperationEvent = (
  record: JournalRecord,
  runId: RunId,
  indexes: FoldIndexes,
  issues: Array<ManagedHistoryIssue>
): void => {
  const descriptor = describeJournalEvent(record.event)
  if (descriptor._tag !== "OperationEventDescriptor") return
  for (const requiredOperationId of descriptor.requiredOperationIds) {
    if (!indexes.seenOperationIds.has(requiredOperationId)) {
      semanticIssue(
        issues,
        runId,
        record.position,
        `event ${record.event._tag} requires prior operation ${requiredOperationId}`
      )
    }
  }
  for (const requiredKind of descriptor.requiredPredecessorKinds) {
    const kinds = indexes.seenEventKindsByOperation.get(
      descriptor.operationId
    )
    if (!kinds?.has(requiredKind)) {
      semanticIssue(
        issues,
        runId,
        record.position,
        `event ${record.event._tag} requires prior ${requiredKind} for operation ${descriptor.operationId}`
      )
    }
  }
  if (
    descriptor.recordPredecessor._tag === "RequiredRecordPredecessor"
    && !indexes.seenKeys.has(descriptor.recordPredecessor.key)
  ) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `event ${record.event._tag} has no prior record ${descriptor.recordPredecessor.key}`
    )
  }
  indexes.seenOperationIds.add(descriptor.operationId)
  indexes.seenEventKindsByOperation.set(
    descriptor.operationId,
    new Set([
      ...(indexes.seenEventKindsByOperation.get(
        descriptor.operationId
      ) ?? []),
      record.event._tag
    ])
  )
}

const validatePlan = (
  record: JournalRecord,
  runId: RunId,
  indexes: FoldIndexes,
  issues: Array<ManagedHistoryIssue>
): void => {
  if (record.event._tag !== "TaskAttemptPlanned") return
  const plannedAttempt = record.event.operation.plannedAttempt
  const prior = indexes.plans.get(plannedAttempt.attemptId)
  if (prior !== undefined) {
    semanticIssue(
      issues,
      runId,
      record.position,
      plannedTaskAttemptEquivalence(prior, plannedAttempt)
        ? `duplicate planned task attempt for attempt ${plannedAttempt.attemptId}`
        : `contradictory planned task attempts for attempt ${plannedAttempt.attemptId}`
    )
    return
  }
  indexes.plans.set(plannedAttempt.attemptId, plannedAttempt)
}

const validateClaim = (
  record: JournalRecord,
  runId: RunId,
  records: ReadonlyArray<JournalRecord>,
  issues: Array<ManagedHistoryIssue>
): void => {
  if (record.event._tag !== "TaskClaimAcquired") return
  const acquired = record.event.claim
  const intent = records.find(({ event }) =>
    event._tag === "TaskClaimAcquisitionIntended"
    && event.operation.acquisition.operationId
      === acquired.operationId
  )?.event
  const intended = intent?._tag === "TaskClaimAcquisitionIntended"
    ? intent.operation.acquisition
    : undefined
  if (
    intended === undefined
    || acquired.operationId !== intended.operationId
    || acquired.owner !== intended.owner
    || acquired.taskId !== intended.taskId
    || acquired.token !== intended.token
  ) {
    identityIssue(
      issues,
      runId,
      record.position,
      `acquired task claim contradicts operation ${acquired.operationId}`
    )
  }
}

const validateExecutorEvent = (
  record: JournalRecord,
  runId: RunId,
  indexes: FoldIndexes,
  issues: Array<ManagedHistoryIssue>
): void => {
  const event = record.event
  if (event._tag === "PlannedAttemptExecutorWorkStarted") {
    const attemptId = event.plannedAttempt.attemptId
    const plan = indexes.plans.get(attemptId)
    if (
      plan === undefined
      || !plannedTaskAttemptEquivalence(plan, event.plannedAttempt)
    ) {
      semanticIssue(
        issues,
        runId,
        record.position,
        `executor work for attempt ${attemptId} has no prior matching planned task attempt`
      )
    }
    const priorStart = indexes.executorStarts.get(attemptId)
    if (priorStart !== undefined) {
      issues.push(duplicateUnfinishedTaskAttemptIssue(
        runId,
        priorStart.plannedAttempt,
        priorStart.position,
        event.plannedAttempt,
        record.position
      ))
    } else {
      indexes.executorStarts.set(attemptId, {
        plannedAttempt: event.plannedAttempt,
        position: record.position
      })
    }
    return
  }
  if (event._tag !== "PlannedAttemptExecutorWorkReported") return
  const attemptId = event.report.correlation.attemptId
  const start = indexes.executorStarts.get(attemptId)
  if (
    start === undefined
    || event.report.correlation.runId !== start.plannedAttempt.runId
  ) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `executor report for attempt ${attemptId} has no prior matching executor-work start`
    )
  }
  const expectedOrdinal = (
    indexes.executorReportOrdinals.get(attemptId) ?? 0
  ) + 1
  if (event.ordinal !== expectedOrdinal) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `executor report for attempt ${attemptId} expected ordinal ${expectedOrdinal}, found ${event.ordinal}`
    )
  }
  indexes.executorReportOrdinals.set(attemptId, event.ordinal)
  if (indexes.terminalExecutorAttempts.has(attemptId)) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `executor report follows the terminal result for attempt ${attemptId}`
    )
  }
  if (event.report._tag === "Terminal") {
    indexes.terminalExecutorAttempts.add(attemptId)
  }
}

const validateOneUnfinishedAttemptPerTask = (
  runId: RunId,
  indexes: FoldIndexes,
  issues: Array<ManagedHistoryIssue>
): void => {
  const unfinishedByTask = new Map<
    TaskId,
    {
      readonly plannedAttempt: PlannedTaskAttempt
      readonly position: JournalPosition
    }
  >()
  for (const [attemptId, start] of indexes.executorStarts) {
    if (indexes.terminalExecutorAttempts.has(attemptId)) continue
    const taskId = start.plannedAttempt.taskId
    const prior = unfinishedByTask.get(taskId)
    if (prior === undefined) {
      unfinishedByTask.set(taskId, {
        plannedAttempt: start.plannedAttempt,
        position: start.position
      })
      continue
    }
    issues.push(duplicateUnfinishedTaskAttemptIssue(
      runId,
      prior.plannedAttempt,
      prior.position,
      start.plannedAttempt,
      start.position
    ))
  }
}

/**
 * Validates all decoded records before reconstruction or any outside call.
 * The fold retains every issue it can establish from the immutable history.
 */
export const reduceManagedHistory = (
  runId: RunId,
  records: ReadonlyArray<JournalRecord>
): ValidManagedHistory | InvalidManagedHistory => {
  const issues = new Array<ManagedHistoryIssue>()
  const indexes = emptyIndexes()
  records.forEach((record, index) => {
    const unique = validateRecordEnvelope(
      record,
      index,
      runId,
      indexes,
      issues
    )
    const descriptor = describeJournalEvent(record.event)
    if (
      descriptor._tag === "ControlCommandEventDescriptor"
      && descriptor.runId !== runId
    ) {
      identityIssue(
        issues,
        runId,
        record.position,
        `control command ${descriptor.commandId} binds run ${descriptor.runId}`
      )
    }
    if (
      descriptor._tag === "PlannedAttemptExecutorEventDescriptor"
      && descriptor.correlation.runId !== runId
    ) {
      identityIssue(
        issues,
        runId,
        record.position,
        `executor work for attempt ${descriptor.correlation.attemptId} binds run ${descriptor.correlation.runId}`
      )
    }
    if (!unique) {
      if (record.event._tag === "PlannedAttemptExecutorWorkStarted") {
        validateExecutorEvent(record, runId, indexes, issues)
      }
      return
    }
    validateOperationEvent(record, runId, indexes, issues)
    validatePlan(record, runId, indexes, issues)
    validateClaim(record, runId, records, issues)
    validateExecutorEvent(record, runId, indexes, issues)
  })
  validateOneUnfinishedAttemptPerTask(runId, indexes, issues)
  if (issues.length > 0) {
    return {
      _tag: "InvalidManagedHistory",
      issues,
      records,
      runId
    }
  }
  return {
    _tag: "ValidManagedHistory",
    managedRun: reconstructValidatedManagedRunState(runId, records),
    records,
    recoveryStage: deriveManagedRunRecoveryStage(records),
    runId
  }
}
