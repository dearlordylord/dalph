/* eslint-disable max-lines -- One chronological validator owns its private indexes and exact causal checks. */
import { type RunId } from "@dalph/contracts"
import { HashMap, HashSet, Option } from "effect"
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
  completionOriginalTaskClaimReleaseFor,
  type CompletionClaimDeletionRequest,
  type CompletionClaimFinalityJournalEvent,
  type CompletionClaimRequestOrdinal,
  type CompletionTaskClaim,
  type CompletionSuccessObservation
} from "./events.js"
import { targetPromotionCorrelationEquals, targetPromotionRunIdOf } from "../target-promotion/events.js"
import { causalPredecessorOperationIds } from "../../causal-history.js"
import { authorizedClaimForAttempt } from "../../claim-authority-history.js"
import { isExactTaskClaim } from "../../../authorities/task-tracker/claim-mutation.js"
import { taskTrackerTargetKey } from "../../../authorities/task-tracker/target.js"
import { invalidCompletionTaskHistory } from "./completion-task-history.js"
import { taskTrackerObservationMatchesRead } from "../../task-tracker-facts/observation-match.js"
import { recordedTaskAttemptPlans } from "../task-attempt-planning/journal-evidence.js"

type ReplacementIntent = Extract<WorkflowJournalEvent, { readonly _tag: "CompletionClaimReplacementIntended" }>
type ReplacementAttempt = Extract<WorkflowJournalEvent, { readonly _tag: "CompletionClaimReplacementAttemptIntended" }>
type ReplacementOutcome = Extract<WorkflowJournalEvent, { readonly _tag: "CompletionClaimReplaced" }>
type DeletionIntent = Extract<WorkflowJournalEvent, { readonly _tag: "CompletionClaimDeletionIntended" }>
type DeletionAttempt = Extract<WorkflowJournalEvent, { readonly _tag: "CompletionClaimDeletionAttemptIntended" }>
type DeletionOutcome = Extract<WorkflowJournalEvent, { readonly _tag: "CompletionClaimDeleted" }>
type Settlement = Extract<WorkflowJournalEvent, { readonly _tag: "IntegrationFinalitySettled" }>
type DeletionRead = Extract<WorkflowJournalEvent, { readonly _tag: "CompletionClaimDeletionReadObserved" }>
type ClaimReleaseIntent = Extract<WorkflowJournalEvent, { readonly _tag: "TaskClaimReleaseIntended" }>
type IntegrationFinalityEvent = CompletionClaimFinalityJournalEvent
type MarkerReadPurpose = Extract<
  DeletionRead["purpose"],
  { readonly _tag: "BeforeOriginalClaimRelease" | "BeforeDeletionAttempt" | "AfterDeletionAttemptsExhausted" }
>
type ActiveReadPurpose = Extract<
  DeletionRead["purpose"],
  { readonly _tag: "ConfirmOriginalClaimReleased" | "ConfirmNoActiveClaimAfterMarkerAbsent" }
>
type ReplacementAttemptRecord = JournalRecord & { readonly event: ReplacementAttempt }
type DeletionIntentRecord = JournalRecord & { readonly event: DeletionIntent }
type DeletionAttemptRecord = JournalRecord & { readonly event: DeletionAttempt }
type MarkerReadRecord = JournalRecord & { readonly event: DeletionRead & { readonly purpose: MarkerReadPurpose } }
type ActiveReadRecord = JournalRecord & { readonly event: DeletionRead & { readonly purpose: ActiveReadPurpose } }

export interface IntegrationFinalityHistoryIndexes {
  readonly replacementIntents: HashMap.HashMap<OperationId, JournalRecord & { readonly event: ReplacementIntent }>
  readonly replacementAttempts: HashMap.HashMap<
    OperationId,
    HashMap.HashMap<number, JournalRecord & { readonly event: ReplacementAttempt }>
  >
  readonly replacementTerminals: HashMap.HashMap<OperationId, JournalRecord & { readonly event: ReplacementOutcome }>
  readonly deletionIntents: HashMap.HashMap<OperationId, JournalRecord & { readonly event: DeletionIntent }>
  readonly deletionAttempts: HashMap.HashMap<
    OperationId,
    HashMap.HashMap<number, JournalRecord & { readonly event: DeletionAttempt }>
  >
  readonly deletionTerminals: HashSet.HashSet<OperationId>
  readonly settlements: HashSet.HashSet<string>
}

/** Creates an empty private history index; no authority or frontier is stored. */
export const makeIntegrationFinalityHistoryIndexes = (): IntegrationFinalityHistoryIndexes => ({
  deletionAttempts: HashMap.empty(),
  deletionIntents: HashMap.empty(),
  deletionTerminals: HashSet.empty(),
  replacementAttempts: HashMap.empty(),
  replacementIntents: HashMap.empty(),
  replacementTerminals: HashMap.empty(),
  settlements: HashSet.empty()
})

const mapGet = <Key, Value>(map: HashMap.HashMap<Key, Value>, key: Key): Value | undefined =>
  Option.getOrUndefined(HashMap.get(map, key))

export interface IntegrationFinalityHistoryValidation {
  readonly indexes: IntegrationFinalityHistoryIndexes
  readonly detail: string | undefined
}

const prior = (records: ReadonlyArray<JournalRecord>, position: JournalPosition): ReadonlyArray<JournalRecord> =>
  records.filter((record) => record.position < position)

const exactPlanPrior = (
  records: ReadonlyArray<JournalRecord>,
  claim: CompletionTaskClaim,
  position: JournalPosition
): boolean =>
  recordedTaskAttemptPlans(prior(records, position)).some((operation) => {
    if (
      operation.plannedAttempt.attemptId !== claim.plannedAttempt.attemptId ||
      !plannedTaskAttemptEquivalence(operation.plannedAttempt, claim.plannedAttempt)
    )
      return false
    const accepted = prior(records, position)
    const originalIsCausal = causalPredecessorOperationIds(accepted, operation).has(claim.originalClaim.operationId)
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

const completeTaskInObservation = focusedTaskInObservation

const invalidReplacementIntent = (
  record: JournalRecord,
  records: ReadonlyArray<JournalRecord>,
  indexes: IntegrationFinalityHistoryIndexes,
  event: ReplacementIntent
): IntegrationFinalityHistoryValidation => {
  const duplicate = HashMap.has(indexes.replacementIntents, event.operationId)
  const valid =
    !duplicate &&
    exactPlanPrior(records, event.claim, record.position) &&
    exactOriginalClaimPrior(records, event.claim, record.position) &&
    exactPromotionPrior(records, event.claim, record.position)
  return {
    detail: valid
      ? undefined
      : `completion-claim replacement intent ${event.operationId} has no exact claim-bound planned attempt, active claim, and promotion proof`,
    indexes: {
      ...indexes,
      replacementIntents: HashMap.set(indexes.replacementIntents, event.operationId, { ...record, event })
    }
  }
}

const invalidReplacementAttempt = (
  record: JournalRecord,
  indexes: IntegrationFinalityHistoryIndexes,
  event: ReplacementAttempt
): IntegrationFinalityHistoryValidation => {
  const intent = mapGet(indexes.replacementIntents, event.operationId)
  const attempts =
    mapGet(indexes.replacementAttempts, event.operationId) ?? HashMap.empty<number, ReplacementAttemptRecord>()
  const ordinal = Number(event.attemptOrdinal)
  const valid =
    intent !== undefined &&
    completionTaskClaimEquals(intent.event.claim, event.claim) &&
    !HashMap.has(indexes.replacementTerminals, event.operationId) &&
    ordinal === HashMap.size(attempts) + 1 &&
    ordinal <= completionClaimRequestLimit &&
    !HashMap.has(attempts, ordinal)
  return {
    detail: valid
      ? undefined
      : `completion-claim replacement attempt ${event.operationId} is not the next exact request`,
    indexes: {
      ...indexes,
      replacementAttempts: HashMap.set(
        indexes.replacementAttempts,
        event.operationId,
        HashMap.set(attempts, ordinal, { ...record, event })
      )
    }
  }
}

const invalidReplacementOutcome = (
  _record: JournalRecord,
  indexes: IntegrationFinalityHistoryIndexes,
  event: ReplacementOutcome
): IntegrationFinalityHistoryValidation => {
  const intent = mapGet(indexes.replacementIntents, event.operationId)
  const duplicate = HashMap.has(indexes.replacementTerminals, event.operationId)
  const valid = !duplicate && intent !== undefined && completionTaskClaimEquals(intent.event.claim, event.claim)
  return {
    detail: valid
      ? undefined
      : `completion-claim replacement outcome ${event.operationId} has no unique matching intent`,
    indexes: {
      ...indexes,
      replacementTerminals: HashMap.set(indexes.replacementTerminals, event.operationId, { ..._record, event })
    }
  }
}

const invalidDeletionIntent = (
  record: JournalRecord,
  records: ReadonlyArray<JournalRecord>,
  indexes: IntegrationFinalityHistoryIndexes,
  event: DeletionIntent
): IntegrationFinalityHistoryValidation => {
  const duplicate = HashMap.has(indexes.deletionIntents, event.operationId)
  const replacement = [...HashMap.keys(indexes.replacementTerminals)]
    .map((operationId) => mapGet(indexes.replacementIntents, operationId))
    .find((intent) => intent !== undefined && completionTaskClaimEquals(intent.event.claim, event.claim))
  const replacementRecord = prior(records, record.position).find(
    (candidate) =>
      candidate.event._tag === "CompletionClaimReplaced" &&
      completionTaskClaimEquals(candidate.event.claim, event.claim)
  )
  const valid = [
    !duplicate,
    completionTaskClaimEquals(event.claim, event.successObservation.claim),
    replacement !== undefined,
    replacementRecord !== undefined,
    replacementRecord !== undefined && replacementRecord.position < event.successObservation.observedAt,
    completeTaskInObservation(records, event.successObservation, record.position)
  ].every(Boolean)
  return {
    detail: valid
      ? undefined
      : `completion-claim deletion intent ${event.operationId} lacks replacement and focused task-completion success`,
    indexes: {
      ...indexes,
      deletionIntents: HashMap.set(indexes.deletionIntents, event.operationId, { ...record, event })
    }
  }
}

const isMarkerReadPurpose = (purpose: DeletionRead["purpose"]): purpose is MarkerReadPurpose =>
  purpose._tag === "BeforeOriginalClaimRelease" ||
  purpose._tag === "BeforeDeletionAttempt" ||
  purpose._tag === "AfterDeletionAttemptsExhausted"

const isActiveReadPurpose = (purpose: DeletionRead["purpose"]): purpose is ActiveReadPurpose =>
  purpose._tag === "ConfirmOriginalClaimReleased" || purpose._tag === "ConfirmNoActiveClaimAfterMarkerAbsent"

const latestMarkerCleanupRead = (
  records: ReadonlyArray<JournalRecord>,
  position: JournalPosition,
  operationId: OperationId
): MarkerReadRecord | undefined =>
  prior(records, position).findLast(
    (candidate): candidate is MarkerReadRecord =>
      candidate.event._tag === "CompletionClaimDeletionReadObserved" &&
      candidate.event.request.operationId === operationId &&
      isMarkerReadPurpose(candidate.event.purpose)
  )

const latestActiveCleanupRead = (
  records: ReadonlyArray<JournalRecord>,
  position: JournalPosition,
  operationId: OperationId
): ActiveReadRecord | undefined =>
  prior(records, position).findLast(
    (candidate): candidate is ActiveReadRecord =>
      candidate.event._tag === "CompletionClaimDeletionReadObserved" &&
      candidate.event.request.operationId === operationId &&
      isActiveReadPurpose(candidate.event.purpose)
  )

const markerReadAuthorizesDeletionAttempt = (markerRead: MarkerReadRecord, event: DeletionAttempt): boolean =>
  markerRead.event.purpose._tag === "BeforeDeletionAttempt" &&
  markerRead.event.purpose.attemptOrdinal === event.attemptOrdinal &&
  markerRead.event.observation._tag === "CompletionTaskClaim" &&
  completionTaskClaimEquals(markerRead.event.observation, event.claim)

const activeReadAuthorizesDeletionAttempt = (activeRead: ActiveReadRecord, event: DeletionAttempt): boolean =>
  activeRead.event.purpose._tag === "ConfirmOriginalClaimReleased" &&
  activeRead.event.purpose.attemptOrdinal === event.attemptOrdinal &&
  activeRead.event.observation._tag === "UnclaimedTask"

const latestCleanupReadsAuthorizeDeletionAttempt = (
  originalReleaseRecord: JournalRecord | undefined,
  markerRead: MarkerReadRecord | undefined,
  activeRead: ActiveReadRecord | undefined,
  event: DeletionAttempt
): boolean => {
  if (originalReleaseRecord === undefined) return false
  if (markerRead === undefined) return false
  if (activeRead === undefined) return false
  return [
    markerReadAuthorizesDeletionAttempt(markerRead, event),
    activeReadAuthorizesDeletionAttempt(activeRead, event),
    originalReleaseRecord.position < markerRead.position,
    markerRead.position < activeRead.position
  ].every(Boolean)
}

const deletionAttemptMatchesIntent = (
  intent: DeletionIntentRecord | undefined,
  event: Pick<DeletionAttempt, "claim" | "successObservation">
): boolean => {
  if (intent === undefined) return false
  return (
    completionTaskClaimEquals(intent.event.claim, event.claim) &&
    completionSuccessObservationEquals(intent.event.successObservation, event.successObservation)
  )
}

const invalidDeletionAttempt = (
  record: JournalRecord,
  records: ReadonlyArray<JournalRecord>,
  indexes: IntegrationFinalityHistoryIndexes,
  event: DeletionAttempt
): IntegrationFinalityHistoryValidation => {
  const intent = mapGet(indexes.deletionIntents, event.operationId)
  const attempts = mapGet(indexes.deletionAttempts, event.operationId) ?? HashMap.empty<number, DeletionAttemptRecord>()
  const ordinal = Number(event.attemptOrdinal)
  const originalRelease = completionOriginalTaskClaimReleaseFor(event.claim)
  const originalReleaseRecord = prior(records, record.position).findLast(
    ({ event: priorEvent }) =>
      priorEvent._tag === "TaskClaimReleased" &&
      priorEvent.release.operationId === originalRelease.operationId &&
      isExactTaskClaim(priorEvent.release.claim, originalRelease.claim)
  )
  const latestMarkerRead = latestMarkerCleanupRead(records, record.position, event.operationId)
  const latestActiveRead = latestActiveCleanupRead(records, record.position, event.operationId)
  const originalClaimReleaseConfirmed = latestCleanupReadsAuthorizeDeletionAttempt(
    originalReleaseRecord,
    latestMarkerRead,
    latestActiveRead,
    event
  )
  const valid = [
    intent !== undefined,
    completionTaskClaimEquals(event.claim, event.successObservation.claim),
    deletionAttemptMatchesIntent(intent, event),
    !HashSet.has(indexes.deletionTerminals, event.operationId),
    originalClaimReleaseConfirmed,
    latestMarkerRead,
    ordinal === HashMap.size(attempts) + 1,
    ordinal <= completionClaimRequestLimit,
    !HashMap.has(attempts, ordinal)
  ].every(Boolean)
  return {
    detail: valid ? undefined : `completion-claim deletion attempt ${event.operationId} is not the next exact request`,
    indexes: {
      ...indexes,
      deletionAttempts: HashMap.set(
        indexes.deletionAttempts,
        event.operationId,
        HashMap.set(attempts, ordinal, { ...record, event })
      )
    }
  }
}

const latestCleanupReadsProveDeletion = (
  deletionAttempt: JournalRecord | undefined,
  markerRead: MarkerReadRecord | undefined,
  activeRead: ActiveReadRecord | undefined
): boolean => {
  if (deletionAttempt === undefined) return false
  if (markerRead === undefined) return false
  if (activeRead === undefined) return false
  if (markerRead.event.purpose._tag === "BeforeOriginalClaimRelease") return false
  if (markerRead.event.observation._tag !== "CompletionClaimMarkerAbsent") return false
  if (activeRead.event.purpose._tag !== "ConfirmNoActiveClaimAfterMarkerAbsent") return false
  if (activeRead.event.observation._tag !== "UnclaimedTask") return false
  return [
    deletionAttempt.position < markerRead.position,
    markerRead.position < activeRead.position,
    activeRead.event.purpose.attemptOrdinal === markerRead.event.purpose.attemptOrdinal
  ].every(Boolean)
}

const invalidDeletionOutcome = (
  record: JournalRecord,
  records: ReadonlyArray<JournalRecord>,
  indexes: IntegrationFinalityHistoryIndexes,
  event: DeletionOutcome
): IntegrationFinalityHistoryValidation => {
  const intent = mapGet(indexes.deletionIntents, event.operationId)
  const duplicate = HashSet.has(indexes.deletionTerminals, event.operationId)
  const originalRelease = completionOriginalTaskClaimReleaseFor(event.claim)
  const originalClaimReleased = prior(records, record.position).some(
    ({ event: priorEvent }) =>
      priorEvent._tag === "TaskClaimReleased" &&
      priorEvent.release.operationId === originalRelease.operationId &&
      isExactTaskClaim(priorEvent.release.claim, originalRelease.claim)
  )
  const deletionAttempt = prior(records, record.position).findLast(
    ({ event: priorEvent }) =>
      priorEvent._tag === "CompletionClaimDeletionAttemptIntended" && priorEvent.operationId === event.operationId
  )
  const latestMarkerRead = latestMarkerCleanupRead(records, record.position, event.operationId)
  const latestActiveRead = latestActiveCleanupRead(records, record.position, event.operationId)
  const deletionWasObservedAbsent = latestCleanupReadsProveDeletion(deletionAttempt, latestMarkerRead, latestActiveRead)
  const valid = [
    !duplicate,
    originalClaimReleased,
    deletionWasObservedAbsent,
    completionTaskClaimEquals(event.claim, event.successObservation.claim),
    deletionAttemptMatchesIntent(intent, event),
    completeTaskInObservation(records, event.successObservation, record.position)
  ].every(Boolean)
  return {
    detail: valid
      ? undefined
      : `completion-claim deletion outcome ${event.operationId} has no exact intent and fresh success`,
    indexes: { ...indexes, deletionTerminals: HashSet.add(indexes.deletionTerminals, event.operationId) }
  }
}

const invalidSettlement = (
  record: JournalRecord,
  records: ReadonlyArray<JournalRecord>,
  indexes: IntegrationFinalityHistoryIndexes,
  event: Settlement
): IntegrationFinalityHistoryValidation => {
  const key = event.claim.promotionCorrelation.requestId
  const duplicate = HashSet.has(indexes.settlements, key)
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
  const valid =
    !duplicate && completionTaskClaimEquals(event.claim, event.successObservation.claim) && replaced && deleted
  return {
    detail: valid
      ? undefined
      : `integration finality settlement ${key} requires one exact deleted completion claim and fresh success`,
    indexes: { ...indexes, settlements: HashSet.add(indexes.settlements, key) }
  }
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
    targetPromotionRunIdOf(event.claim.promotionCorrelation) === runId
  ].every(Boolean)

const invalidDeletionRead = (
  record: JournalRecord,
  indexes: IntegrationFinalityHistoryIndexes,
  event: DeletionRead,
  runId: RunId,
  records: ReadonlyArray<JournalRecord>
): string | undefined => {
  const request = event.request
  if (request.claim.plannedAttempt.runId !== runId) {
    return `completion claim cleanup read binds run ${request.claim.plannedAttempt.runId}`
  }
  if (!deletionReadObservationMatchesPurpose(event)) {
    return `completion claim cleanup read observation kind contradicts ${event.purpose._tag}`
  }
  const intent = mapGet(indexes.deletionIntents, request.operationId)?.event
  const priorAttemptIndex = mapGet(indexes.deletionAttempts, request.operationId)
  const priorAttempts = priorAttemptIndex === undefined ? 0 : HashMap.size(priorAttemptIndex)
  const priorReads = countPriorDeletionReads(records, record.position, event)
  return deletionReadIsValid(intent, indexes, event, priorAttempts, priorReads) &&
    confirmationReadHasReleaseAndMarker(records, record, event)
    ? undefined
    : `completion claim cleanup read ${record.key} lacks its exact deletion intent, replacement, or ordinal`
}

const deletionReadObservationMatchesPurpose = (event: DeletionRead): boolean => {
  const readsActiveRecord =
    event.purpose._tag === "ConfirmOriginalClaimReleased" ||
    event.purpose._tag === "ConfirmNoActiveClaimAfterMarkerAbsent"
  const observedActiveRecord =
    event.observation._tag === "ActiveTaskClaim" || event.observation._tag === "UnclaimedTask"
  return readsActiveRecord === observedActiveRecord
}

const exactMarkerPrecedesOriginalReleaseConfirmation = (
  candidate: JournalRecord,
  event: DeletionRead,
  attemptOrdinal: CompletionClaimRequestOrdinal
): boolean =>
  candidate.event._tag === "CompletionClaimDeletionReadObserved" &&
  candidate.event.request.operationId === event.request.operationId &&
  candidate.event.purpose._tag === "BeforeDeletionAttempt" &&
  candidate.event.purpose.attemptOrdinal === attemptOrdinal &&
  candidate.event.observation._tag === "CompletionTaskClaim" &&
  completionTaskClaimEquals(candidate.event.observation, event.request.claim)

const markerAbsencePrecedesActiveAbsenceConfirmation = (
  candidate: JournalRecord,
  event: DeletionRead,
  attemptOrdinal: CompletionClaimRequestOrdinal
): boolean =>
  candidate.event._tag === "CompletionClaimDeletionReadObserved" &&
  candidate.event.request.operationId === event.request.operationId &&
  (candidate.event.purpose._tag === "BeforeDeletionAttempt" ||
    candidate.event.purpose._tag === "AfterDeletionAttemptsExhausted") &&
  candidate.event.purpose.attemptOrdinal === attemptOrdinal &&
  candidate.event.observation._tag === "CompletionClaimMarkerAbsent"

const confirmationReadHasReleaseAndMarker = (
  records: ReadonlyArray<JournalRecord>,
  record: JournalRecord,
  event: DeletionRead
): boolean => {
  if (
    event.purpose._tag !== "ConfirmOriginalClaimReleased" &&
    event.purpose._tag !== "ConfirmNoActiveClaimAfterMarkerAbsent"
  ) {
    return true
  }
  const attemptOrdinal = event.purpose.attemptOrdinal
  const expected = completionOriginalTaskClaimReleaseFor(event.request.claim)
  const release = prior(records, record.position).findLast(
    (candidate) =>
      candidate.event._tag === "TaskClaimReleased" &&
      candidate.event.release.operationId === expected.operationId &&
      isExactTaskClaim(candidate.event.release.claim, expected.claim)
  )
  const marker =
    event.purpose._tag === "ConfirmOriginalClaimReleased"
      ? prior(records, record.position).findLast((candidate) =>
          exactMarkerPrecedesOriginalReleaseConfirmation(candidate, event, attemptOrdinal)
        )
      : prior(records, record.position).findLast((candidate) =>
          markerAbsencePrecedesActiveAbsenceConfirmation(candidate, event, attemptOrdinal)
        )
  return release !== undefined && marker !== undefined && release.position < marker.position
}

const deletionReadIsValid = (
  intent: DeletionIntent | undefined,
  indexes: IntegrationFinalityHistoryIndexes,
  event: DeletionRead,
  priorAttempts: number,
  priorReads: number
): boolean =>
  [
    intent !== undefined && deletionIntentMatches(intent, event.request),
    replacementOutcomeMatches(indexes, event),
    deletionReadPurposeMatches(event, priorAttempts),
    Number(event.purpose.readOrdinal) === priorReads + 1
  ].every(Boolean)

const replacementOutcomeMatches = (indexes: IntegrationFinalityHistoryIndexes, event: DeletionRead): boolean => {
  const outcome = mapGet(indexes.replacementTerminals, event.replacementOperationId)?.event
  return outcome !== undefined && completionTaskClaimEquals(outcome.claim, event.request.claim)
}

const countPriorDeletionReads = (
  records: ReadonlyArray<JournalRecord>,
  position: JournalPosition,
  event: DeletionRead
): number => prior(records, position).filter((candidate) => matchesDeletionRead(candidate.event, event)).length

const matchesDeletionRead = (candidate: WorkflowJournalEvent, expected: DeletionRead): boolean =>
  candidate._tag === "CompletionClaimDeletionReadObserved" &&
  candidate.request.operationId === expected.request.operationId &&
  candidate.purpose._tag === expected.purpose._tag &&
  (candidate.purpose._tag === "BeforeOriginalClaimRelease" ||
    expected.purpose._tag === "BeforeOriginalClaimRelease" ||
    candidate.purpose.attemptOrdinal === expected.purpose.attemptOrdinal)

const deletionIntentMatches = (intent: DeletionIntent, request: CompletionClaimDeletionRequest): boolean =>
  completionTaskClaimEquals(intent.claim, request.claim) &&
  completionSuccessObservationEquals(intent.successObservation, request.successObservation)

const completionCleanupForReleaseIntent = (
  records: ReadonlyArray<JournalRecord>,
  position: JournalPosition,
  event: ClaimReleaseIntent
): (JournalRecord & { readonly event: DeletionIntent }) | undefined =>
  prior(records, position).findLast(
    (candidate): candidate is JournalRecord & { readonly event: DeletionIntent } =>
      candidate.event._tag === "CompletionClaimDeletionIntended" &&
      completionOriginalTaskClaimReleaseFor(candidate.event.claim).operationId === event.operation.release.operationId
  )

const cleanupReleaseIntentMatches = (
  event: ClaimReleaseIntent,
  expectedRelease: ReturnType<typeof completionOriginalTaskClaimReleaseFor>
): boolean =>
  event.operation.authority._tag === "WorkflowClaimReleaseAuthority" &&
  isExactTaskClaim(event.operation.release.claim, expectedRelease.claim) &&
  event.operation.release.operationId === expectedRelease.operationId

const cleanupReleaseIntentHasPredecessors = (event: ClaimReleaseIntent, cleanup: DeletionIntent): boolean => {
  const predecessors = new Set(event.operation.predecessorOperationIds)
  return (
    predecessors.has(cleanup.claim.originalClaim.operationId) &&
    predecessors.has(cleanup.successObservation.operationId)
  )
}

const originalClaimReleaseMarkerObservation = (
  records: ReadonlyArray<JournalRecord>,
  position: JournalPosition,
  cleanup: JournalRecord & { readonly event: DeletionIntent }
): DeletionRead["observation"] | undefined =>
  prior(records, position).findLast(
    (candidate): candidate is JournalRecord & { readonly event: DeletionRead } =>
      candidate.position > cleanup.position &&
      candidate.event._tag === "CompletionClaimDeletionReadObserved" &&
      candidate.event.request.operationId === cleanup.event.operationId &&
      candidate.event.purpose._tag === "BeforeOriginalClaimRelease"
  )?.event.observation

const invalidCompletionCleanupReleaseIntent = (
  record: JournalRecord,
  records: ReadonlyArray<JournalRecord>,
  event: ClaimReleaseIntent
): string | undefined => {
  const cleanup = completionCleanupForReleaseIntent(records, record.position, event)
  if (cleanup === undefined) return undefined
  const expectedRelease = completionOriginalTaskClaimReleaseFor(cleanup.event.claim)
  if (!cleanupReleaseIntentMatches(event, expectedRelease)) {
    return "completion cleanup release intent contradicts its exact original claim"
  }
  if (!cleanupReleaseIntentHasPredecessors(event, cleanup.event)) {
    return "completion cleanup release intent requires its exact claim and focused-success predecessors"
  }
  const observation = originalClaimReleaseMarkerObservation(records, record.position, cleanup)
  return observation?._tag === "CompletionTaskClaim" && completionTaskClaimEquals(observation, cleanup.event.claim)
    ? undefined
    : "completion cleanup release intent requires a fresh exact completion-marker observation"
}

export const deletionReadPurposeMatches = (event: DeletionRead, priorAttempts: number): boolean =>
  event.purpose._tag === "BeforeOriginalClaimRelease"
    ? true
    : event.purpose._tag === "BeforeDeletionAttempt" || event.purpose._tag === "ConfirmOriginalClaimReleased"
      ? Number(event.purpose.attemptOrdinal) === priorAttempts + 1
      : event.purpose._tag === "ConfirmNoActiveClaimAfterMarkerAbsent"
        ? Number(event.purpose.attemptOrdinal) === Math.min(priorAttempts + 1, completionClaimRequestLimit)
        : Number(event.purpose.attemptOrdinal) === completionClaimRequestLimit &&
          priorAttempts === completionClaimRequestLimit

const recordCompletionTaskIssue = (
  issue: ReturnType<typeof invalidCompletionTaskHistory>,
  recordIdentityIssue: (detail: string) => void,
  recordSemanticIssue: (detail: string) => void
): void => {
  if (issue?.kind === "Identity") recordIdentityIssue(issue.detail)
  if (issue?.kind === "Semantic") recordSemanticIssue(issue.detail)
}

const invalidReplacementHistory = (
  record: JournalRecord,
  records: ReadonlyArray<JournalRecord>,
  indexes: IntegrationFinalityHistoryIndexes
): IntegrationFinalityHistoryValidation | undefined => {
  const event = record.event
  if (event._tag === "CompletionClaimReplacementIntended")
    return invalidReplacementIntent(record, records, indexes, event)
  if (event._tag === "CompletionClaimReplacementAttemptIntended")
    return invalidReplacementAttempt(record, indexes, event)
  if (event._tag === "CompletionClaimReplaced") return invalidReplacementOutcome(record, indexes, event)
  return undefined
}

const invalidDeletionHistory = (
  record: JournalRecord,
  records: ReadonlyArray<JournalRecord>,
  indexes: IntegrationFinalityHistoryIndexes
): IntegrationFinalityHistoryValidation | undefined => {
  const event = record.event
  if (event._tag === "CompletionClaimDeletionIntended") return invalidDeletionIntent(record, records, indexes, event)
  if (event._tag === "CompletionClaimDeletionAttemptIntended")
    return invalidDeletionAttempt(record, records, indexes, event)
  if (event._tag === "CompletionClaimDeleted") return invalidDeletionOutcome(record, records, indexes, event)
  return undefined
}

/** Validates one finality event against exact promotion, claim, and tracker chronology. */
export const invalidIntegrationFinalityHistory = (
  record: JournalRecord,
  records: ReadonlyArray<JournalRecord>,
  indexes: IntegrationFinalityHistoryIndexes
): IntegrationFinalityHistoryValidation => {
  const event = record.event
  if (event._tag === "TaskClaimReleaseIntended") {
    return { detail: invalidCompletionCleanupReleaseIntent(record, records, event), indexes }
  }
  const replacement = invalidReplacementHistory(record, records, indexes)
  if (replacement !== undefined) return replacement
  const deletion = invalidDeletionHistory(record, records, indexes)
  if (deletion !== undefined) return deletion
  if (event._tag === "IntegrationFinalitySettled") return invalidSettlement(record, records, indexes, event)
  return { detail: undefined, indexes }
}

/** Applies run binding and causal validation for one finality event. */
export const invalidIntegrationFinalityRunBinding = (event: WorkflowJournalEvent, runId: RunId): string | undefined => {
  if (event._tag === "CompletionClaimDeletionReadObserved") {
    return event.request.claim.plannedAttempt.runId === runId
      ? undefined
      : `completion claim cleanup read binds run ${event.request.claim.plannedAttempt.runId}`
  }
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
): IntegrationFinalityHistoryIndexes => {
  recordCompletionTaskIssue(
    invalidCompletionTaskHistory(record, records, runId),
    recordIdentityIssue,
    recordSemanticIssue
  )
  const bindingIssue = invalidIntegrationFinalityRunBinding(record.event, runId)
  if (bindingIssue !== undefined) recordIdentityIssue(bindingIssue)
  if (record.event._tag === "CompletionClaimDeletionReadObserved") {
    const readIssue = invalidDeletionRead(record, indexes, record.event, runId, records)
    if (readIssue !== undefined) recordSemanticIssue(readIssue)
  }
  const historyValidation = invalidIntegrationFinalityHistory(record, records, indexes)
  if (historyValidation.detail !== undefined) recordSemanticIssue(historyValidation.detail)
  return historyValidation.indexes
}
