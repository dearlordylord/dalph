import type { TaskId } from "@dalph/contracts"
import { Schema } from "effect"
import type { JournalPosition } from "../../../workflow-journal/identity.js"
import { reconfirmationMatchesPriorFullObservation } from "../../task-tracker-facts/reconfirmation.js"
import {
  TaskTrackerFactsObservedEvent,
  type CompleteTaskTrackerFactsObserved,
  type TaskTrackerFactsObservedEvent as TaskTrackerFactsObservedEventType
} from "../../task-tracker-facts/observation.js"
import {
  CompletionClaimDeletionAttemptIntendedEvent,
  CompletionClaimDeletedEvent,
  CompletionClaimDeletionIntendedEvent,
  CompletionClaimReplacedEvent,
  CompletionClaimReplacementAttemptIntendedEvent,
  CompletionClaimReplacementIntendedEvent,
  CompletionTaskClaim,
  FreshCompletedTaskObservation,
  freshCompletedTaskObservationEquals,
  completionTaskClaimEquals,
  IntegrationFinalityJournalEvent,
  IntegrationFinalitySettledEvent
} from "./events.js"

/** The exact durable evidence currently owned by one completion-finality protocol. */
export const IntegrationFinalityState = Schema.TaggedUnion({
  ReplacementPending: {
    claim: CompletionTaskClaim,
    replacementAttempts: Schema.Array(CompletionClaimReplacementAttemptIntendedEvent),
    replacementIntent: CompletionClaimReplacementIntendedEvent
  },
  CompletionClaimReplaced: { claim: CompletionTaskClaim, replacement: CompletionClaimReplacedEvent },
  DeletionPending: {
    claim: CompletionTaskClaim,
    deletionAttempts: Schema.Array(CompletionClaimDeletionAttemptIntendedEvent),
    deletionIntent: CompletionClaimDeletionIntendedEvent,
    replacement: CompletionClaimReplacedEvent,
    successObservation: FreshCompletedTaskObservation
  },
  CompletionClaimDeleted: {
    claim: CompletionTaskClaim,
    deletion: CompletionClaimDeletedEvent,
    replacement: CompletionClaimReplacedEvent,
    successObservation: CompletionClaimDeletedEvent.fields.successObservation
  },
  IntegrationFinalitySettled: {
    claim: CompletionTaskClaim,
    deletion: CompletionClaimDeletedEvent,
    replacement: CompletionClaimReplacedEvent,
    settlement: IntegrationFinalitySettledEvent,
    successObservation: IntegrationFinalitySettledEvent.fields.successObservation
  }
})
export type IntegrationFinalityState = typeof IntegrationFinalityState.Type

/** Minimal journal occurrence accepted by the pure finality-state projector. */
export type IntegrationFinalityJournalOccurrence = { readonly event: unknown; readonly position: JournalPosition }

/**
 * Returns the latest exact successful task proof after a journal baseline.
 * Complete graph facts are checked directly; unchanged reconfirmations are
 * accepted only when their referenced full payload is already valid and names
 * the same task as successfully completed.
 */
export const latestFreshCompletedTaskObservationFor = (
  records: ReadonlyArray<IntegrationFinalityJournalOccurrence>,
  taskId: TaskId,
  afterPosition: JournalPosition
): FreshCompletedTaskObservation | undefined => {
  const completeByOperation = new Map<string, CompleteTaskTrackerFactsObserved>()
  let latestObservation: FreshCompletedTaskObservation | undefined
  for (const record of records.toSorted((left, right) => left.position - right.position)) {
    const decoded = Schema.decodeUnknownOption(TaskTrackerFactsObservedEvent)(record.event)
    /* v8 ignore next -- @preserve The negative-history test exercises this skip, but V8 does not attribute a transpiled continue branch. */
    if (decoded._tag === "None") continue
    const event = decoded.value
    /* v8 ignore next -- @preserve TaskTrackerFactsObserved's Schema requires its event and observation operation identities to match. */
    if (event.observation.operationId !== event.operationId) continue
    if (event.observation._tag === "CompleteTaskTrackerFacts") {
      completeByOperation.set(String(event.observation.operationId), event.observation)
      const candidate = freshSuccessFromCompleteObservation(record, event, taskId, afterPosition)
      if (candidate !== undefined) latestObservation = candidate
      continue
    }
    const candidate = freshSuccessFromReconfirmation(record, event, taskId, afterPosition, completeByOperation)
    if (candidate !== undefined) latestObservation = candidate
  }
  return latestObservation
}

const isFinalityOccurrence = (
  occurrence: IntegrationFinalityJournalOccurrence
): occurrence is IntegrationFinalityJournalOccurrence & { readonly event: IntegrationFinalityJournalEvent } =>
  Schema.is(IntegrationFinalityJournalEvent)(occurrence.event)

const taskCompletedSuccessfully = (
  factFamilies: CompleteTaskTrackerFactsObserved["factFamilies"],
  taskId: TaskId
): boolean =>
  factFamilies[1].lifecycles.some(({ lifecycle, taskId: observedTaskId }) =>
    [observedTaskId === taskId, lifecycle._tag === "CompletedSuccessfully"].every(Boolean)
  )

const makeFreshSuccessObservation = (
  record: IntegrationFinalityJournalOccurrence,
  operationId: TaskTrackerFactsObservedEventType["operationId"],
  taskId: TaskId,
  trackerRevision: CompleteTaskTrackerFactsObserved["factFamilies"][0]["contentIdentity"]
): FreshCompletedTaskObservation =>
  FreshCompletedTaskObservation.make({
    lifecycle: "CompletedSuccessfully",
    observedAt: record.position,
    operationId,
    taskId,
    trackerRevision
  })

const freshSuccessFromCompleteObservation = (
  record: IntegrationFinalityJournalOccurrence,
  event: TaskTrackerFactsObservedEventType,
  taskId: TaskId,
  afterPosition: JournalPosition
): FreshCompletedTaskObservation | undefined => {
  const observation = event.observation
  if (observation._tag !== "CompleteTaskTrackerFacts" || record.position <= afterPosition) return undefined
  return taskCompletedSuccessfully(observation.factFamilies, taskId)
    ? makeFreshSuccessObservation(record, event.operationId, taskId, observation.factFamilies[0].contentIdentity)
    : undefined
}

const freshSuccessFromReconfirmation = (
  record: IntegrationFinalityJournalOccurrence,
  event: TaskTrackerFactsObservedEventType,
  taskId: TaskId,
  afterPosition: JournalPosition,
  completeByOperation: ReadonlyMap<string, CompleteTaskTrackerFactsObserved>
): FreshCompletedTaskObservation | undefined => {
  const observation = event.observation
  if (observation._tag !== "UnchangedTaskTrackerFactsReconfirmed" || record.position <= afterPosition) return undefined
  const prior = completeByOperation.get(String(observation.priorFullObservationOperationId))
  if (prior === undefined || !reconfirmationMatchesPriorFullObservation(observation, prior)) return undefined
  return taskCompletedSuccessfully(prior.factFamilies, taskId)
    ? makeFreshSuccessObservation(record, event.operationId, taskId, prior.factFamilies[0].contentIdentity)
    : undefined
}

const exactOccurrencesFor = (
  records: ReadonlyArray<IntegrationFinalityJournalOccurrence>,
  claim: CompletionTaskClaim
): ReadonlyArray<IntegrationFinalityJournalOccurrence & { readonly event: IntegrationFinalityJournalEvent }> =>
  records
    .filter(isFinalityOccurrence)
    .filter((record) => completionTaskClaimEquals(record.event.claim, claim))
    .toSorted((left, right) => left.position - right.position)

const latest = <A>(values: ReadonlyArray<A>): A | undefined => values[values.length - 1]

const successProofOf = (
  event: CompletionClaimDeletionIntendedEvent | CompletionClaimDeletedEvent | IntegrationFinalitySettledEvent
): FreshCompletedTaskObservation => event.successObservation

const settlementMatches = (
  settlement: IntegrationFinalitySettledEvent | undefined,
  replacement: CompletionClaimReplacedEvent,
  deleted: CompletionClaimDeletedEvent
): settlement is IntegrationFinalitySettledEvent =>
  settlement !== undefined &&
  [
    settlement.replacementOperationId === replacement.operationId,
    settlement.deletionOperationId === deleted.operationId,
    freshCompletedTaskObservationEquals(settlement.successObservation, deleted.successObservation)
  ].every(Boolean)

/**
 * Reconstructs one exact completion-finality state from durable journal evidence.
 * Invalid duplicate or contradictory histories are rejected by reconstruction;
 * this projector therefore exposes only evidence-backed protocol phases.
 */
export const deriveIntegrationFinalityStateFor = (
  records: ReadonlyArray<IntegrationFinalityJournalOccurrence>,
  claim: CompletionTaskClaim
): IntegrationFinalityState | undefined => {
  const relevant = exactOccurrencesFor(records, claim)
  const replacementIntent = relevant.find(
    (record): record is typeof record & { readonly event: CompletionClaimReplacementIntendedEvent } =>
      record.event._tag === "CompletionClaimReplacementIntended"
  )
  if (replacementIntent === undefined) return undefined
  const replacementAttempts = relevant.flatMap((record) =>
    record.event._tag === "CompletionClaimReplacementAttemptIntended" ? [record.event] : []
  )
  const replacement = relevant.find(
    (record): record is typeof record & { readonly event: CompletionClaimReplacedEvent } =>
      record.event._tag === "CompletionClaimReplaced"
  )
  if (replacement === undefined) {
    return IntegrationFinalityState.cases.ReplacementPending.make({
      claim,
      replacementAttempts,
      replacementIntent: replacementIntent.event
    })
  }
  const deletionIntent = relevant.find(
    (record): record is typeof record & { readonly event: CompletionClaimDeletionIntendedEvent } =>
      record.event._tag === "CompletionClaimDeletionIntended"
  )
  if (deletionIntent === undefined) {
    return IntegrationFinalityState.cases.CompletionClaimReplaced.make({ claim, replacement: replacement.event })
  }
  const deletionAttempts = relevant.flatMap((record) =>
    record.event._tag === "CompletionClaimDeletionAttemptIntended" ? [record.event] : []
  )
  const deleted = relevant.find(
    (record): record is typeof record & { readonly event: CompletionClaimDeletedEvent } =>
      record.event._tag === "CompletionClaimDeleted"
  )
  if (deleted === undefined) {
    return IntegrationFinalityState.cases.DeletionPending.make({
      claim,
      deletionAttempts,
      deletionIntent: deletionIntent.event,
      replacement: replacement.event,
      successObservation: successProofOf(deletionIntent.event)
    })
  }
  const settlement = latest(
    relevant.flatMap((record) => (record.event._tag === "IntegrationFinalitySettled" ? [record.event] : []))
  )
  if (!settlementMatches(settlement, replacement.event, deleted.event)) {
    return IntegrationFinalityState.cases.CompletionClaimDeleted.make({
      claim,
      deletion: deleted.event,
      replacement: replacement.event,
      successObservation: deleted.event.successObservation
    })
  }
  return IntegrationFinalityState.cases.IntegrationFinalitySettled.make({
    claim,
    deletion: deleted.event,
    replacement: replacement.event,
    settlement,
    successObservation: settlement.successObservation
  })
}
