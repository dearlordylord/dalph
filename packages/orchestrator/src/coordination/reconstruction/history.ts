/* eslint-disable functional/immutable-data, max-lines -- The chronological validator owns its local indexes and cross-event invariants. */
import { type AttemptId, type PlannedTaskAttempt, type RunId, type TaskId } from "@dalph/contracts"
import { type JournalPosition, type JournalRecordKey } from "../../workflow-journal/identity.js"
import { type OperationId } from "../../workflow/identity.js"
import { describeJournalEvent } from "../../workflow/registry/event-descriptor.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import type { WorkflowJournalEvent } from "../../workflow/registry/event.js"
import type { WorkflowOperation } from "../../workflow/registry/operation.js"
import {
  duplicateUnfinishedTaskAttemptIssue,
  type InvalidWorkflowJournalHistory,
  WorkflowJournalHistoryIdentityIssue,
  type WorkflowJournalHistoryIssue,
  WorkflowJournalHistorySemanticIssue,
  type ValidWorkflowJournalHistory
} from "./history-result.js"
import { deriveRunRecoveryFrontier } from "../frontier/recovery-frontier.js"
import { plannedTaskAttemptEquivalence } from "@dalph/contracts"
import { reconstructValidatedRunState } from "./reduce.js"
import {
  invalidTaskTrackerReconfirmationReference,
  makeTaskTrackerReconfirmationIndex,
  type TaskTrackerReconfirmationIndex
} from "../../workflow/task-tracker-facts/reconfirmation.js"
import { taskTrackerObservationMatchesRead } from "../../workflow/task-tracker-facts/observation-match.js"
import { validateRunPolicyHistory } from "./run-policy-history.js"
import { type IntegrationHistoryIndexes, validateIntegrationHistoryRecord } from "./integration-history.js"
import { validateTaskClaimRelease } from "./claim-release-history.js"
import {
  latestTaskClaimReacquisitionDirection,
  taskClaimReacquisitionOperationId
} from "../../workflow/protocols/task-claim-reacquisition/plan.js"
import { ActiveTaskClaim, isExactTaskClaim } from "../../authorities/task-tracker/claim-mutation.js"
import { plannedAttemptWorktreeObservationMatchesPlan } from "../../workflow/protocols/planned-attempt-worktree-observation/protocol.js"

const finalArrayElementOffset = -1

const identityIssue = (
  issues: Array<WorkflowJournalHistoryIssue>,
  runId: RunId,
  position: JournalPosition,
  detail: string
): void => {
  issues.push(new WorkflowJournalHistoryIdentityIssue({ detail, position, runId }))
}

const semanticIssue = (
  issues: Array<WorkflowJournalHistoryIssue>,
  runId: RunId,
  position: JournalPosition,
  detail: string
): void => {
  issues.push(new WorkflowJournalHistorySemanticIssue({ detail, position, runId }))
}

interface FoldIndexes extends IntegrationHistoryIndexes {
  latestControlDirectionOrdinal: number
  readonly executorReportOrdinals: Map<AttemptId, number>
  readonly executorResponsibilitiesBegan: Map<
    AttemptId,
    { readonly plannedAttempt: PlannedTaskAttempt; readonly position: JournalPosition }
  >
  readonly plans: Map<AttemptId, PlannedTaskAttempt>
  readonly gitReadIntents: Map<
    OperationId,
    Extract<WorkflowOperation, { readonly _tag: "ReadTargetLineage" | "ReadTaskWorktree" }>
  >
  latestRunPolicyRevision: number | undefined
  readonly seenEventKindsByOperation: Map<OperationId, ReadonlySet<WorkflowJournalEvent["_tag"]>>
  readonly seenKeys: Set<JournalRecordKey>
  readonly seenOperationIds: Set<OperationId>
  readonly terminalExecutorAttempts: Set<AttemptId>
  readonly trackerReconfirmations: TaskTrackerReconfirmationIndex
}

const emptyIndexes = (): FoldIndexes => ({
  acceptedExecutorResults: new Map(),
  executorReportOrdinals: new Map(),
  executorResponsibilitiesBegan: new Map(),
  integrationResponsibilitiesBegan: new Map(),
  integrationStarted: new Map(),
  integrationCandidateIntents: new Map(),
  integrationCandidateIntentsByStartedAt: new Map(),
  integrationCandidateSubmissions: new Map(),
  integrationCandidateGitObservations: new Map(),
  latestControlDirectionOrdinal: 0,
  plans: new Map(),
  gitReadIntents: new Map(),
  latestRunPolicyRevision: undefined,
  seenEventKindsByOperation: new Map(),
  seenKeys: new Set(),
  seenOperationIds: new Set(),
  terminalExecutorAttempts: new Set(),
  trackerReconfirmations: makeTaskTrackerReconfirmationIndex()
})

const validateRecordEnvelope = (
  record: JournalRecord,
  index: number,
  runId: RunId,
  indexes: FoldIndexes,
  issues: Array<WorkflowJournalHistoryIssue>
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
    identityIssue(issues, runId, record.position, `record belongs to run ${record.runId}`)
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
    semanticIssue(issues, runId, record.position, `duplicate journal record key ${record.key}`)
    return false
  }
  indexes.seenKeys.add(record.key)
  return true
}

const validateControlDirection = (
  record: JournalRecord,
  runId: RunId,
  indexes: FoldIndexes,
  issues: Array<WorkflowJournalHistoryIssue>
): void => {
  const descriptor = describeJournalEvent(record.event)
  if (descriptor._tag !== "ControlDirectionEventDescriptor") return
  if (descriptor.runId !== runId) {
    identityIssue(
      issues,
      runId,
      record.position,
      `control direction ${descriptor.ordinal} binds run ${descriptor.runId}`
    )
  }
  const expectedOrdinal = indexes.latestControlDirectionOrdinal + 1
  if (descriptor.ordinal !== expectedOrdinal) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `control direction expected ordinal ${expectedOrdinal}, found ${descriptor.ordinal}`
    )
  }
  indexes.latestControlDirectionOrdinal = descriptor.ordinal
}

const validateTaskClaimReacquisitionDirection = (
  record: JournalRecord,
  runId: RunId,
  issues: Array<WorkflowJournalHistoryIssue>
): void => {
  const descriptor = describeJournalEvent(record.event)
  if (descriptor._tag === "TaskClaimReacquisitionDirectionEventDescriptor" && descriptor.runId !== runId) {
    identityIssue(
      issues,
      runId,
      record.position,
      `task-claim reacquisition request ${descriptor.requestId} binds run ${descriptor.runId}`
    )
  }
}

const validateOperationEvent = (
  record: JournalRecord,
  runId: RunId,
  indexes: FoldIndexes,
  issues: Array<WorkflowJournalHistoryIssue>
): void => {
  if (record.event._tag === "GitReadIntentRecorded") {
    indexes.gitReadIntents.set(record.event.operation.operationId, record.event.operation)
  }
  if (record.event._tag === "PlannedAttemptWorktreeObserved") {
    const intent = indexes.gitReadIntents.get(record.event.operationId)
    if (
      intent?._tag !== "ReadTaskWorktree" ||
      !plannedAttemptWorktreeObservationMatchesPlan(record.event.observation, intent.plannedAttempt)
    ) {
      semanticIssue(
        issues,
        runId,
        record.position,
        `worktree observation ${record.event.operationId} requires its exact prior worktree-read intent and planned attempt`
      )
    }
  }
  if (record.event._tag === "TargetLineageObserved") {
    const intent = indexes.gitReadIntents.get(record.event.operationId)
    if (
      intent?._tag !== "ReadTargetLineage" ||
      !plannedTaskAttemptEquivalence(intent.plannedAttempt, record.event.plannedAttempt)
    ) {
      semanticIssue(
        issues,
        runId,
        record.position,
        `target-lineage observation ${record.event.operationId} requires its exact prior target-lineage-read intent and planned attempt`
      )
    }
  }
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
    const kinds = indexes.seenEventKindsByOperation.get(descriptor.operationId)
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
    descriptor.recordPredecessor._tag === "RequiredRecordPredecessor" &&
    !indexes.seenKeys.has(descriptor.recordPredecessor.key)
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
    new Set([...(indexes.seenEventKindsByOperation.get(descriptor.operationId) ?? []), record.event._tag])
  )
}

const validatePlan = (
  record: JournalRecord,
  runId: RunId,
  indexes: FoldIndexes,
  issues: Array<WorkflowJournalHistoryIssue>
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
  issues: Array<WorkflowJournalHistoryIssue>
): void => {
  if (record.event._tag !== "TaskClaimAcquired") return
  const acquired = record.event.claim
  const intent = records.find(
    ({ event }) =>
      event._tag === "TaskClaimAcquisitionIntended" && event.operation.acquisition.operationId === acquired.operationId
  )?.event
  const intended = intent?._tag === "TaskClaimAcquisitionIntended" ? intent.operation.acquisition : undefined
  if (
    intended === undefined ||
    acquired.operationId !== intended.operationId ||
    acquired.owner !== intended.owner ||
    acquired.taskId !== intended.taskId ||
    acquired.token !== intended.token
  ) {
    identityIssue(issues, runId, record.position, `acquired task claim contradicts operation ${acquired.operationId}`)
  }
}

const validateClaimRejection = (
  record: JournalRecord,
  runId: RunId,
  records: ReadonlyArray<JournalRecord>,
  issues: Array<WorkflowJournalHistoryIssue>
): void => {
  if (record.event._tag !== "TaskClaimAcquisitionRejected") return
  const rejected = record.event
  const intent = records.find(
    ({ event, position }) =>
      position < record.position &&
      event._tag === "TaskClaimAcquisitionIntended" &&
      event.operation.acquisition.operationId === rejected.operationId
  )?.event
  /* v8 ignore next -- @preserve The event descriptor separately reports a rejection without its required intent. */
  if (intent?._tag !== "TaskClaimAcquisitionIntended") return
  const attempted = ActiveTaskClaim.make(intent.operation.acquisition)
  if (rejected.observed.taskId !== attempted.taskId || isExactTaskClaim(rejected.observed, attempted)) {
    identityIssue(
      issues,
      runId,
      record.position,
      `rejected task claim ${rejected.operationId} does not prove a foreign claim for ${attempted.taskId}`
    )
  }
}

const matchingReacquisitionDirection = (record: JournalRecord, runId: RunId, records: ReadonlyArray<JournalRecord>) => {
  /* v8 ignore next -- @preserve The caller invokes this helper only for an explicit acquisition intent. */
  if (record.event._tag !== "TaskClaimAcquisitionIntended") return undefined
  const { acquisition } = record.event.operation
  const expectedClaim = records.findLast(
    ({ event, position }) =>
      position < record.position && event._tag === "TaskClaimAcquired" && event.claim.taskId === acquisition.taskId
  )?.event
  /* v8 ignore start -- @preserve Missing prior acquisition authority is rejected by the caller's undefined direction result. */
  const direction =
    expectedClaim?._tag === "TaskClaimAcquired"
      ? latestTaskClaimReacquisitionDirection(records, runId, acquisition.taskId, expectedClaim.claim, record.position)
      : undefined
  /* v8 ignore stop -- @preserve */
  return direction?._tag === "TaskClaimReacquisitionDirected" ? direction : undefined
}

const validateClaimReacquisitionIntent = (
  record: JournalRecord,
  runId: RunId,
  records: ReadonlyArray<JournalRecord>,
  issues: Array<WorkflowJournalHistoryIssue>
): void => {
  if (record.event._tag !== "TaskClaimAcquisitionIntended") return
  const { acquisition, authority } = record.event.operation
  if (authority._tag !== "ExplicitTaskClaimReacquisitionAuthority") return
  const direction = matchingReacquisitionDirection(record, runId, records)
  const matchesAuthority =
    direction?.requestId === authority.requestId &&
    taskClaimReacquisitionOperationId(direction.requestId) === acquisition.operationId
  if (!matchesAuthority) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `task-claim reacquisition ${acquisition.operationId} has no prior matching applied Operator direction`
    )
  }
}

const findTrackerReadIntent = (
  records: ReadonlyArray<JournalRecord>,
  observedEvent: Extract<WorkflowJournalEvent, { readonly _tag: "TaskTrackerFactsObserved" }>,
  observedAt: JournalPosition
) =>
  records.find(
    ({ event, position }) =>
      position < observedAt &&
      event._tag === "TaskTrackerReadIntentRecorded" &&
      event.operation.operationId === observedEvent.operationId
  )?.event

const validateReconfirmationReference = (
  record: JournalRecord,
  runId: RunId,
  indexes: FoldIndexes,
  issues: Array<WorkflowJournalHistoryIssue>
): void => {
  const detail = invalidTaskTrackerReconfirmationReference(record, runId, indexes.trackerReconfirmations)
  if (detail !== undefined) semanticIssue(issues, runId, record.position, detail)
}

const validateTrackerObservation = (
  record: JournalRecord,
  runId: RunId,
  records: ReadonlyArray<JournalRecord>,
  issues: Array<WorkflowJournalHistoryIssue>
): void => {
  if (record.event._tag !== "TaskTrackerFactsObserved") return
  const observedEvent = record.event
  const intent = findTrackerReadIntent(records, observedEvent, record.position)
  if (
    intent?._tag === "TaskTrackerReadIntentRecorded" &&
    !taskTrackerObservationMatchesRead(observedEvent.observation, intent.operation)
  ) {
    identityIssue(
      issues,
      runId,
      record.position,
      `task-tracker facts contradict initiating read ${observedEvent.operationId}`
    )
  }
}

const validateExecutorEvent = (
  record: JournalRecord,
  runId: RunId,
  indexes: FoldIndexes,
  issues: Array<WorkflowJournalHistoryIssue>
): void => {
  const event = record.event
  if (event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan") {
    const attemptId = event.plannedAttempt.attemptId
    const plan = indexes.plans.get(attemptId)
    if (plan === undefined || !plannedTaskAttemptEquivalence(plan, event.plannedAttempt)) {
      semanticIssue(
        issues,
        runId,
        record.position,
        `executor work for attempt ${attemptId} has no prior matching planned task attempt`
      )
    }
    const priorResponsibility = indexes.executorResponsibilitiesBegan.get(attemptId)
    if (priorResponsibility !== undefined) {
      issues.push(
        duplicateUnfinishedTaskAttemptIssue(
          runId,
          priorResponsibility.plannedAttempt,
          priorResponsibility.position,
          event.plannedAttempt,
          record.position
        )
      )
    } else {
      indexes.executorResponsibilitiesBegan.set(attemptId, {
        plannedAttempt: event.plannedAttempt,
        position: record.position
      })
    }
    return
  }
  if (event._tag !== "PlannedAttemptExecutorWorkReported") return
  const attemptId = event.report.correlation.attemptId
  const responsibility = indexes.executorResponsibilitiesBegan.get(attemptId)
  if (responsibility === undefined || event.report.correlation.runId !== responsibility.plannedAttempt.runId) {
    semanticIssue(
      issues,
      runId,
      record.position,
      `executor report for attempt ${attemptId} has no prior matching executor-work responsibility`
    )
  }
  const expectedOrdinal = (indexes.executorReportOrdinals.get(attemptId) ?? 0) + 1
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
    if (event.report.result._tag === "Accepted") {
      indexes.acceptedExecutorResults.set(attemptId, event.report.result.acceptedResult)
    }
  }
}

const validateOneUnfinishedAttemptPerTask = (
  runId: RunId,
  indexes: FoldIndexes,
  issues: Array<WorkflowJournalHistoryIssue>
): void => {
  const unfinishedByTask = new Map<
    TaskId,
    { readonly plannedAttempt: PlannedTaskAttempt; readonly position: JournalPosition }
  >()
  for (const [attemptId, responsibility] of indexes.executorResponsibilitiesBegan) {
    if (indexes.terminalExecutorAttempts.has(attemptId)) continue
    const taskId = responsibility.plannedAttempt.taskId
    const prior = unfinishedByTask.get(taskId)
    if (prior === undefined) {
      unfinishedByTask.set(taskId, { plannedAttempt: responsibility.plannedAttempt, position: responsibility.position })
      continue
    }
    issues.push(
      duplicateUnfinishedTaskAttemptIssue(
        runId,
        prior.plannedAttempt,
        prior.position,
        responsibility.plannedAttempt,
        responsibility.position
      )
    )
  }
}

const validateRunLifecycle = (
  runId: RunId,
  records: ReadonlyArray<JournalRecord>,
  issues: Array<WorkflowJournalHistoryIssue>
): void => {
  const began = records.find(({ event }) => event._tag === "WorkflowRunBegan")
  const terminated = records.find(({ event }) => event._tag === "WorkflowRunTerminated")
  if (began !== undefined && began.position !== 1) {
    semanticIssue(issues, runId, began.position, "WorkflowRunBegan must be the first record")
  }
  if (terminated !== undefined && began === undefined) {
    semanticIssue(issues, runId, terminated.position, "WorkflowRunTerminated requires prior WorkflowRunBegan")
  }
  if (terminated !== undefined && terminated !== records.at(finalArrayElementOffset)) {
    semanticIssue(issues, runId, terminated.position, "WorkflowRunTerminated must be the final record")
  }
}

/**
 * Validates all decoded records before reconstruction or any outside call.
 * The fold retains every issue it can establish from the immutable history.
 */
export const reduceWorkflowJournalHistory = (
  runId: RunId,
  records: ReadonlyArray<JournalRecord>
): ValidWorkflowJournalHistory | InvalidWorkflowJournalHistory => {
  const issues = new Array<WorkflowJournalHistoryIssue>()
  const indexes = emptyIndexes()
  records.forEach((record, index) => {
    const unique = validateRecordEnvelope(record, index, runId, indexes, issues)
    const descriptor = describeJournalEvent(record.event)
    validateControlDirection(record, runId, indexes, issues)
    validateTaskClaimReacquisitionDirection(record, runId, issues)
    if (descriptor._tag === "PlannedAttemptExecutorEventDescriptor" && descriptor.correlation.runId !== runId) {
      identityIssue(
        issues,
        runId,
        record.position,
        `executor work for attempt ${descriptor.correlation.attemptId} binds run ${descriptor.correlation.runId}`
      )
    }
    if (!unique) {
      if (record.event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan") {
        validateExecutorEvent(record, runId, indexes, issues)
      }
      return
    }
    validateOperationEvent(record, runId, indexes, issues)
    validatePlan(record, runId, indexes, issues)
    validateClaimReacquisitionIntent(record, runId, records, issues)
    validateClaim(record, runId, records, issues)
    validateClaimRejection(record, runId, records, issues)
    validateTaskClaimRelease(record, records, (detail) => identityIssue(issues, runId, record.position, detail))
    validateTrackerObservation(record, runId, records, issues)
    validateReconfirmationReference(record, runId, indexes, issues)
    validateExecutorEvent(record, runId, indexes, issues)
    validateIntegrationHistoryRecord(
      record,
      runId,
      indexes,
      (detail) => identityIssue(issues, runId, record.position, detail),
      (detail) => semanticIssue(issues, runId, record.position, detail)
    )
    const policyValidation = validateRunPolicyHistory(record, indexes)
    indexes.latestRunPolicyRevision = policyValidation.latestRunPolicyRevision
    for (const detail of policyValidation.details) {
      semanticIssue(issues, runId, record.position, detail)
    }
  })
  validateOneUnfinishedAttemptPerTask(runId, indexes, issues)
  validateRunLifecycle(runId, records, issues)
  if (issues.length > 0) {
    return { _tag: "InvalidWorkflowJournalHistory", issues, records, runId }
  }
  return {
    _tag: "ValidWorkflowJournalHistory",
    runState: reconstructValidatedRunState(runId, records),
    records,
    recoveryFrontier: deriveRunRecoveryFrontier(records),
    runId
  }
}
