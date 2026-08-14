import type { TaskId } from "@dalph/contracts"
import { Schema } from "effect"
import type { JournalPosition } from "../../../workflow-journal/identity.js"
import { taskTrackerTargetKey } from "../../../authorities/task-tracker/target.js"
import {
  CompletionClaimDeletionAttemptIntendedEvent,
  CompletionClaimFinalityJournalEvent,
  CompletionClaimDeletedEvent,
  CompletionClaimDeletionIntendedEvent,
  CompletionClaimReplacedEvent,
  CompletionClaimReplacementAttemptIntendedEvent,
  CompletionClaimReplacementIntendedEvent,
  CompletionTaskClaim,
  CompletionTaskIntendedEvent,
  CompletionSuccessObservation,
  FocusedCompletedTaskObservation,
  completionSuccessObservationEquals,
  completionTaskClaimEquals,
  completionTaskRequestEquals,
  IntegrationFinalityJournalEvent,
  IntegrationFinalitySettledEvent
} from "./events.js"
import { TaskTrackerFactsObservedEvent } from "../../task-tracker-facts/observation.js"
import { taskTrackerObservationMatchesRead } from "../../task-tracker-facts/observation-match.js"
import { TaskTrackerReadIntentRecordedEvent } from "../../registry/event.js"

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
    successObservation: CompletionSuccessObservation
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

/** Returns the latest exact focused success after one replacement occurrence. */
export const latestFocusedCompletedTaskObservationFor = (
  records: ReadonlyArray<IntegrationFinalityJournalOccurrence>,
  taskId: TaskId,
  afterPosition: JournalPosition,
  claim: CompletionTaskClaim
): FocusedCompletedTaskObservation | undefined => {
  let latestObservation: FocusedCompletedTaskObservation | undefined
  const chronological = records.toSorted((left, right) => left.position - right.position)
  for (const record of chronological) {
    const decoded = Schema.decodeUnknownOption(TaskTrackerFactsObservedEvent)(record.event)
    if (decoded._tag === "None" || record.position <= afterPosition) continue
    const focused = decoded.value.observation
    if (focused._tag !== "FocusedTaskCompletionFacts") continue
    const matchingIntent = chronological.some((candidate) => {
      if (candidate.position >= record.position) return false
      const decodedIntent = Schema.decodeUnknownOption(TaskTrackerReadIntentRecordedEvent)(candidate.event)
      return (
        decodedIntent._tag === "Some" &&
        decodedIntent.value.operation._tag === "ReadCompletionTaskFacts" &&
        decodedIntent.value.operation.operationId === decoded.value.operationId &&
        taskTrackerObservationMatchesRead(focused, decodedIntent.value.operation)
      )
    })
    if (!matchingIntent) continue
    const { facts, operationId, request, target } = focused
    const matchingRequestIntent = chronological.some((candidate) => {
      if (candidate.position >= record.position) return false
      const decodedIntent = Schema.decodeUnknownOption(CompletionTaskIntendedEvent)(candidate.event)
      return decodedIntent._tag === "Some" && completionTaskRequestEquals(decodedIntent.value.request, request)
    })
    if (!matchingRequestIntent) continue
    if (
      [
        facts.lifecycle === "CompletedSuccessfully",
        facts.targetMembership === "Member",
        facts.operationId === operationId,
        facts.taskId === taskId,
        request.taskId === taskId,
        facts.taskRevision === request.taskRevision,
        taskTrackerTargetKey(facts.target) === taskTrackerTargetKey(target),
        completionTaskClaimEquals(request.claim, claim)
      ].every(Boolean)
    ) {
      latestObservation = FocusedCompletedTaskObservation.make({
        claim: request.claim,
        lifecycle: "CompletedSuccessfully",
        observedAt: record.position,
        operationId,
        taskId,
        taskRevision: facts.taskRevision,
        target: facts.target,
        trackerRevision: facts.trackerRevision
      })
    }
  }
  return latestObservation
}

/** The exact runtime tags whose schemas make up one integration-finality occurrence. */
const integrationFinalityJournalEventTags = {
  CompletionClaimReplacementIntended: true,
  CompletionClaimReplacementAttemptIntended: true,
  CompletionClaimReplaced: true,
  CompletionClaimDeletionIntended: true,
  CompletionClaimDeletionAttemptIntended: true,
  CompletionClaimDeleted: true,
  IntegrationFinalitySettled: true,
  CompletionClaimDeletionReadObserved: true,
  CompletionTaskIntended: true,
  CompletionTaskAttemptIntended: true,
  CompletionTaskAcknowledged: true,
  CompletionTaskResponseLost: true,
  CompletionTaskRejected: true,
  CompletionTaskCandidateAncestryReadIntended: true,
  CompletionTaskCandidateAncestryObserved: true,
  CompletionTaskRequestLookupIntended: true,
  CompletionTaskRequestLookupObserved: true
} as const satisfies Record<IntegrationFinalityJournalEvent["_tag"], true>

export const isFinalityOccurrence = (
  occurrence: IntegrationFinalityJournalOccurrence
): occurrence is IntegrationFinalityJournalOccurrence & { readonly event: IntegrationFinalityJournalEvent } => {
  const event = occurrence.event
  if (typeof event !== "object" || event === null || !("_tag" in event)) return false
  const tag = event._tag
  return (
    typeof tag === "string" &&
    Object.hasOwn(integrationFinalityJournalEventTags, tag) &&
    Schema.is(IntegrationFinalityJournalEvent)(event)
  )
}

type ClaimFinalityEvent = CompletionClaimFinalityJournalEvent
type ClaimFinalityOccurrence = IntegrationFinalityJournalOccurrence & { readonly event: ClaimFinalityEvent }

const isClaimFinalityEvent = (event: IntegrationFinalityJournalEvent): event is ClaimFinalityEvent =>
  Schema.is(CompletionClaimFinalityJournalEvent)(event)

const exactOccurrencesFor = (
  records: ReadonlyArray<IntegrationFinalityJournalOccurrence>,
  claim: CompletionTaskClaim
): ReadonlyArray<ClaimFinalityOccurrence> =>
  records
    .filter(isFinalityOccurrence)
    .filter(
      (record): record is ClaimFinalityOccurrence =>
        isClaimFinalityEvent(record.event) && completionTaskClaimEquals(record.event.claim, claim)
    )
    .toSorted((left, right) => left.position - right.position)

const latest = <A>(values: ReadonlyArray<A>): A | undefined => values[values.length - 1]

const successProofOf = (
  event: CompletionClaimDeletionIntendedEvent | CompletionClaimDeletedEvent | IntegrationFinalitySettledEvent
): CompletionSuccessObservation => event.successObservation

const settlementMatches = (
  settlement: IntegrationFinalitySettledEvent | undefined,
  replacement: CompletionClaimReplacedEvent,
  deleted: CompletionClaimDeletedEvent
): settlement is IntegrationFinalitySettledEvent =>
  settlement !== undefined &&
  [
    settlement.replacementOperationId === replacement.operationId,
    settlement.deletionOperationId === deleted.operationId,
    completionSuccessObservationEquals(settlement.successObservation, deleted.successObservation)
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
