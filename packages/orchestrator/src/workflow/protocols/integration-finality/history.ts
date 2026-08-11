/* eslint-disable functional/immutable-data -- A chronological validator owns private indexes for one fold. */
import { type RunId } from "@dalph/contracts"
import { type JournalPosition } from "../../../workflow-journal/identity.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import type { OperationId } from "../../identity.js"
import type { WorkflowJournalEvent } from "../../registry/event.js"
import type { FocusedTaskCompletionFactsObserved } from "../../task-tracker-facts/focused-completion-observation.js"
import { plannedTaskAttemptEquivalence } from "@dalph/contracts"
import {
  completionTaskClaimEquals,
  completionSuccessObservationEquals,
  completionClaimRequestLimit,
  type CompletionClaimFinalityJournalEvent,
  type CompletionTaskClaim,
  type CompletionSuccessObservation
} from "./events.js"
import { targetPromotionCorrelationEquals } from "../target-promotion/events.js"
import { causalPredecessorOperationIds } from "../../causal-history.js"
import { authorizedClaimForAttempt } from "../../claim-authority-history.js"
import { isExactTaskClaim } from "../../../authorities/task-tracker/claim-mutation.js"
import { taskTrackerTargetKey } from "../../../authorities/task-tracker/target.js"
import { invalidCompletionTaskHistory } from "./completion-task-history.js"
import { taskTrackerObservationMatchesRead } from "../../task-tracker-facts/observation-match.js"

type ReplacementIntent = Extract<WorkflowJournalEvent, { readonly _tag: "CompletionClaimReplacementIntended" }>
type ReplacementAttempt = Extract<WorkflowJournalEvent, { readonly _tag: "CompletionClaimReplacementAttemptIntended" }>
type ReplacementOutcome = Extract<WorkflowJournalEvent, { readonly _tag: "CompletionClaimReplaced" }>
type DeletionIntent = Extract<WorkflowJournalEvent, { readonly _tag: "CompletionClaimDeletionIntended" }>
type DeletionAttempt = Extract<WorkflowJournalEvent, { readonly _tag: "CompletionClaimDeletionAttemptIntended" }>
type DeletionOutcome = Extract<WorkflowJournalEvent, { readonly _tag: "CompletionClaimDeleted" }>
type Settlement = Extract<WorkflowJournalEvent, { readonly _tag: "IntegrationFinalitySettled" }>
type IntegrationFinalityEvent = CompletionClaimFinalityJournalEvent

export interface IntegrationFinalityHistoryIndexes {
  readonly replacementIntents: Map<OperationId, JournalRecord & { readonly event: ReplacementIntent }>
  readonly replacementAttempts: Map<OperationId, Map<number, JournalRecord & { readonly event: ReplacementAttempt }>>
  readonly replacementTerminals: Set<OperationId>
  readonly deletionIntents: Map<OperationId, JournalRecord & { readonly event: DeletionIntent }>
  readonly deletionAttempts: Map<OperationId, Map<number, JournalRecord & { readonly event: DeletionAttempt }>>
  readonly deletionTerminals: Set<OperationId>
  readonly settlements: Set<string>
}

/** Creates an empty private history index; no authority or frontier is stored. */
export const makeIntegrationFinalityHistoryIndexes = (): IntegrationFinalityHistoryIndexes => ({
  deletionAttempts: new Map(),
  deletionIntents: new Map(),
  deletionTerminals: new Set(),
  replacementAttempts: new Map(),
  replacementIntents: new Map(),
  replacementTerminals: new Set(),
  settlements: new Set()
})

const prior = (records: ReadonlyArray<JournalRecord>, position: JournalPosition): ReadonlyArray<JournalRecord> =>
  records.filter((record) => record.position < position)

const exactPlanPrior = (
  records: ReadonlyArray<JournalRecord>,
  claim: CompletionTaskClaim,
  position: JournalPosition
): boolean =>
  prior(records, position).some(({ event }) => {
    if (
      event._tag !== "TaskAttemptPlanned" ||
      event.operation.plannedAttempt.attemptId !== claim.plannedAttempt.attemptId ||
      !plannedTaskAttemptEquivalence(event.operation.plannedAttempt, claim.plannedAttempt)
    )
      return false
    const accepted = prior(records, position)
    const originalIsCausal = causalPredecessorOperationIds(accepted, event.operation).has(
      claim.originalClaim.operationId
    )
    const authorized = authorizedClaimForAttempt(accepted, claim.plannedAttempt)
    return originalIsCausal || (authorized !== undefined && isExactTaskClaim(authorized.claim, claim.originalClaim))
  })

const exactOriginalClaimPrior = (
  records: ReadonlyArray<JournalRecord>,
  claim: CompletionTaskClaim,
  position: JournalPosition
): boolean =>
  prior(records, position).some(
    ({ event }) =>
      event._tag === "TaskClaimAcquired" &&
      event.claim.taskId === claim.originalClaim.taskId &&
      event.claim.operationId === claim.originalClaim.operationId &&
      event.claim.owner === claim.originalClaim.owner &&
      event.claim.token === claim.originalClaim.token
  )

const exactPromotionPrior = (
  records: ReadonlyArray<JournalRecord>,
  claim: CompletionTaskClaim,
  position: JournalPosition
): boolean =>
  prior(records, position).some(
    ({ event }) =>
      event._tag === "TargetPromotionObservedSuccess" &&
      targetPromotionCorrelationEquals(event.correlation, claim.promotionCorrelation)
  )

type FocusedFactsObservedEvent = Extract<WorkflowJournalEvent, { readonly _tag: "TaskTrackerFactsObserved" }> & {
  readonly observation: FocusedTaskCompletionFactsObserved
}

const focusedFactsMatchSuccessObservation = (
  source: WorkflowJournalEvent | undefined,
  observation: CompletionSuccessObservation
): source is FocusedFactsObservedEvent => {
  if (source?._tag !== "TaskTrackerFactsObserved" || source.observation._tag !== "FocusedTaskCompletionFacts") {
    return false
  }
  const focused = source.observation
  return [
    source.operationId === observation.operationId,
    focused.facts.operationId === observation.operationId,
    completionTaskClaimEquals(focused.request.claim, observation.claim),
    focused.request.taskId === observation.taskId,
    focused.request.taskRevision === observation.taskRevision,
    focused.facts.lifecycle === "CompletedSuccessfully",
    focused.facts.targetMembership === "Member",
    focused.facts.taskId === observation.taskId,
    focused.facts.taskRevision === observation.taskRevision,
    focused.facts.trackerRevision === observation.trackerRevision,
    taskTrackerTargetKey(focused.target) === taskTrackerTargetKey(observation.target),
    taskTrackerTargetKey(focused.facts.target) === taskTrackerTargetKey(observation.target)
  ].every(Boolean)
}

const focusedTaskInObservation = (
  records: ReadonlyArray<JournalRecord>,
  observation: CompletionSuccessObservation,
  at: JournalPosition
): boolean => {
  const source = records.find(({ position }) => position === observation.observedAt && position < at)
  if (source === undefined || !focusedFactsMatchSuccessObservation(source.event, observation)) return false
  const sourceEvent = source.event
  return records.some(
    ({ event, position }) =>
      position < source.position &&
      event._tag === "TaskTrackerReadIntentRecorded" &&
      event.operation._tag === "ReadCompletionTaskFacts" &&
      event.operation.operationId === sourceEvent.operationId &&
      taskTrackerObservationMatchesRead(sourceEvent.observation, event.operation)
  )
}

const completeTaskInObservation = (
  records: ReadonlyArray<JournalRecord>,
  observation: CompletionSuccessObservation,
  at: JournalPosition
): boolean => {
  return focusedTaskInObservation(records, observation, at)
}

const attemptsFor = <A extends ReplacementAttempt | DeletionAttempt>(
  index: Map<OperationId, Map<number, JournalRecord & { readonly event: A }>>,
  operationId: OperationId
): Map<number, JournalRecord & { readonly event: A }> => {
  const existing = index.get(operationId)
  if (existing !== undefined) return existing
  const created = new Map<number, JournalRecord & { readonly event: A }>()
  index.set(operationId, created)
  return created
}

const invalidReplacementIntent = (
  record: JournalRecord,
  records: ReadonlyArray<JournalRecord>,
  indexes: IntegrationFinalityHistoryIndexes,
  event: ReplacementIntent
): string | undefined => {
  const duplicate = indexes.replacementIntents.has(event.operationId)
  indexes.replacementIntents.set(event.operationId, { ...record, event })
  return !duplicate &&
    exactPlanPrior(records, event.claim, record.position) &&
    exactOriginalClaimPrior(records, event.claim, record.position) &&
    exactPromotionPrior(records, event.claim, record.position)
    ? undefined
    : `completion-claim replacement intent ${event.operationId} has no exact claim-bound planned attempt, active claim, and promotion proof`
}

const invalidReplacementAttempt = (
  record: JournalRecord,
  indexes: IntegrationFinalityHistoryIndexes,
  event: ReplacementAttempt
): string | undefined => {
  const intent = indexes.replacementIntents.get(event.operationId)
  const attempts = attemptsFor(indexes.replacementAttempts, event.operationId)
  const ordinal = Number(event.attemptOrdinal)
  const valid =
    intent !== undefined &&
    completionTaskClaimEquals(intent.event.claim, event.claim) &&
    !indexes.replacementTerminals.has(event.operationId) &&
    ordinal === attempts.size + 1 &&
    ordinal <= completionClaimRequestLimit &&
    !attempts.has(ordinal)
  attempts.set(ordinal, { ...record, event })
  return valid ? undefined : `completion-claim replacement attempt ${event.operationId} is not the next exact request`
}

const invalidReplacementOutcome = (
  _record: JournalRecord,
  indexes: IntegrationFinalityHistoryIndexes,
  event: ReplacementOutcome
): string | undefined => {
  const intent = indexes.replacementIntents.get(event.operationId)
  const duplicate = indexes.replacementTerminals.has(event.operationId)
  indexes.replacementTerminals.add(event.operationId)
  return !duplicate && intent !== undefined && completionTaskClaimEquals(intent.event.claim, event.claim)
    ? undefined
    : `completion-claim replacement outcome ${event.operationId} has no unique matching intent`
}

const invalidDeletionIntent = (
  record: JournalRecord,
  records: ReadonlyArray<JournalRecord>,
  indexes: IntegrationFinalityHistoryIndexes,
  event: DeletionIntent
): string | undefined => {
  const duplicate = indexes.deletionIntents.has(event.operationId)
  const replacement = [...indexes.replacementTerminals]
    .map((operationId) => indexes.replacementIntents.get(operationId))
    .find((intent) => intent !== undefined && completionTaskClaimEquals(intent.event.claim, event.claim))
  indexes.deletionIntents.set(event.operationId, { ...record, event })
  const replacementRecord = prior(records, record.position).find(
    (candidate) =>
      candidate.event._tag === "CompletionClaimReplaced" &&
      completionTaskClaimEquals(candidate.event.claim, event.claim)
  )
  return [
    !duplicate,
    completionTaskClaimEquals(event.claim, event.successObservation.claim),
    replacement !== undefined,
    replacementRecord !== undefined,
    replacementRecord !== undefined && replacementRecord.position < event.successObservation.observedAt,
    completeTaskInObservation(records, event.successObservation, record.position)
  ].every(Boolean)
    ? undefined
    : `completion-claim deletion intent ${event.operationId} lacks replacement and focused task-completion success`
}

const invalidDeletionAttempt = (
  record: JournalRecord,
  indexes: IntegrationFinalityHistoryIndexes,
  event: DeletionAttempt
): string | undefined => {
  const intent = indexes.deletionIntents.get(event.operationId)
  const attempts = attemptsFor(indexes.deletionAttempts, event.operationId)
  const ordinal = Number(event.attemptOrdinal)
  const valid = [
    intent !== undefined,
    completionTaskClaimEquals(event.claim, event.successObservation.claim),
    intent !== undefined && completionTaskClaimEquals(intent.event.claim, event.claim),
    intent !== undefined &&
      completionSuccessObservationEquals(intent.event.successObservation, event.successObservation),
    !indexes.deletionTerminals.has(event.operationId),
    ordinal === attempts.size + 1,
    ordinal <= completionClaimRequestLimit,
    !attempts.has(ordinal)
  ].every(Boolean)
  attempts.set(ordinal, { ...record, event })
  return valid ? undefined : `completion-claim deletion attempt ${event.operationId} is not the next exact request`
}

const invalidDeletionOutcome = (
  record: JournalRecord,
  records: ReadonlyArray<JournalRecord>,
  indexes: IntegrationFinalityHistoryIndexes,
  event: DeletionOutcome
): string | undefined => {
  const intent = indexes.deletionIntents.get(event.operationId)
  const duplicate = indexes.deletionTerminals.has(event.operationId)
  indexes.deletionTerminals.add(event.operationId)
  return !duplicate &&
    intent !== undefined &&
    completionTaskClaimEquals(event.claim, event.successObservation.claim) &&
    completionTaskClaimEquals(intent.event.claim, event.claim) &&
    completionSuccessObservationEquals(intent.event.successObservation, event.successObservation) &&
    completeTaskInObservation(records, event.successObservation, record.position)
    ? undefined
    : `completion-claim deletion outcome ${event.operationId} has no exact intent and fresh success`
}

const invalidSettlement = (
  record: JournalRecord,
  records: ReadonlyArray<JournalRecord>,
  indexes: IntegrationFinalityHistoryIndexes,
  event: Settlement
): string | undefined => {
  const key = event.claim.promotionCorrelation.requestId
  const duplicate = indexes.settlements.has(key)
  indexes.settlements.add(key)
  const deleted = prior(records, record.position).some(
    (candidate) =>
      candidate.event._tag === "CompletionClaimDeleted" &&
      candidate.event.operationId === event.deletionOperationId &&
      completionTaskClaimEquals(candidate.event.claim, event.claim) &&
      completionSuccessObservationEquals(candidate.event.successObservation, event.successObservation) &&
      completeTaskInObservation(records, event.successObservation, record.position)
  )
  const replaced = prior(records, record.position).some(
    (candidate) =>
      candidate.event._tag === "CompletionClaimReplaced" &&
      candidate.event.operationId === event.replacementOperationId &&
      completionTaskClaimEquals(candidate.event.claim, event.claim)
  )
  return !duplicate && completionTaskClaimEquals(event.claim, event.successObservation.claim) && replaced && deleted
    ? undefined
    : `integration finality settlement ${key} requires one exact deleted completion claim and fresh success`
}

const integrationFinalityEventTags: ReadonlyArray<IntegrationFinalityEvent["_tag"]> = [
  "CompletionClaimReplacementIntended",
  "CompletionClaimReplacementAttemptIntended",
  "CompletionClaimReplaced",
  "CompletionClaimDeletionIntended",
  "CompletionClaimDeletionAttemptIntended",
  "CompletionClaimDeleted",
  "IntegrationFinalitySettled"
]

const isIntegrationFinalityEvent = (event: WorkflowJournalEvent): event is IntegrationFinalityEvent =>
  integrationFinalityEventTags.some((tag) => tag === event._tag)

const integrationFinalityEventBindsRun = (event: IntegrationFinalityEvent, runId: RunId): boolean =>
  [
    event.claim.plannedAttempt.runId === runId,
    event.claim.promotionCorrelation.candidateCorrelation.runId === runId,
    event.claim.promotionCorrelation.verificationCorrelation.candidateCorrelation.runId === runId
  ].every(Boolean)

/** Validates one finality event against exact promotion, claim, and tracker chronology. */
export const invalidIntegrationFinalityHistory = (
  record: JournalRecord,
  records: ReadonlyArray<JournalRecord>,
  indexes: IntegrationFinalityHistoryIndexes
): string | undefined => {
  const event = record.event
  if (event._tag === "CompletionClaimReplacementIntended")
    return invalidReplacementIntent(record, records, indexes, event)
  if (event._tag === "CompletionClaimReplacementAttemptIntended")
    return invalidReplacementAttempt(record, indexes, event)
  if (event._tag === "CompletionClaimReplaced") return invalidReplacementOutcome(record, indexes, event)
  if (event._tag === "CompletionClaimDeletionIntended") return invalidDeletionIntent(record, records, indexes, event)
  if (event._tag === "CompletionClaimDeletionAttemptIntended") return invalidDeletionAttempt(record, indexes, event)
  if (event._tag === "CompletionClaimDeleted") return invalidDeletionOutcome(record, records, indexes, event)
  if (event._tag === "IntegrationFinalitySettled") return invalidSettlement(record, records, indexes, event)
  return undefined
}

/** Applies run binding and causal validation for one finality event. */
export const invalidIntegrationFinalityRunBinding = (event: WorkflowJournalEvent, runId: RunId): string | undefined => {
  if (!isIntegrationFinalityEvent(event)) return undefined
  return integrationFinalityEventBindsRun(event, runId)
    ? undefined
    : `completion claim binds run ${event.claim.plannedAttempt.runId}`
}

export const validateIntegrationFinalityHistoryRecord = (
  record: JournalRecord,
  runId: RunId,
  records: ReadonlyArray<JournalRecord>,
  indexes: IntegrationFinalityHistoryIndexes,
  recordIdentityIssue: (detail: string) => void,
  recordSemanticIssue: (detail: string) => void
): void => {
  const completionTaskIssue = invalidCompletionTaskHistory(record, records, runId)
  if (completionTaskIssue?.kind === "Identity") recordIdentityIssue(completionTaskIssue.detail)
  if (completionTaskIssue?.kind === "Semantic") recordSemanticIssue(completionTaskIssue.detail)
  const bindingIssue = invalidIntegrationFinalityRunBinding(record.event, runId)
  if (bindingIssue !== undefined) recordIdentityIssue(bindingIssue)
  const historyIssue = invalidIntegrationFinalityHistory(record, records, indexes)
  if (historyIssue !== undefined) recordSemanticIssue(historyIssue)
}
