/* eslint-disable functional/immutable-data -- Build append values from immutable journal evidence. */
import { Effect, Schema } from "effect"
import { plannedTaskAttemptEquivalence } from "@dalph/contracts"
import { TargetLineageObservation } from "../../../authorities/git/target-lineage.js"
import type { JournalPosition } from "../../../workflow-journal/identity.js"
import {
  integratorAutomaticSuccessorSessionFixedRecordKey,
  intentRecordKey
} from "../../../workflow-journal/record-key.js"
import { exactJournalRecordAtKey } from "../../../workflow-journal/exact-record.js"
import {
  isJournalRecordEvidence,
  journalEvidenceBefore,
  journalRecordByPosition,
  journalRecordByKey,
  journalRecordsOfKind,
  type JournalHistorySource
} from "../../../workflow-journal/record-evidence.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  automaticCompetingHeadRemoteBaselineCorrelationFor,
  initialAutomaticCompetingHeadBaselineRound
} from "../direct-publication/baseline-events.js"
import { automaticRemoteBaselineRoundsFor } from "../direct-publication/baseline-rounds.js"
import { remotePublicationCorrelationEquals } from "../direct-publication/events.js"
import {
  IntegratorCandidateResourceLocator,
  IntegratorAutomaticSuccessorGeneration,
  IntegratorAutomaticSuccessorSessionFixedEvent,
  IntegratorSessionCorrelation,
  IntegratorSessionId
} from "./events.js"
import { integratorSessionCapacityForJournal } from "./session-capacity.js"
import type { IntegratorAutomaticSuccessorPreparationInput } from "./session.js"
import { IntegratorJournalContradiction } from "./journal-errors.js"

const runIdFor = (session: IntegratorSessionCorrelation) => session.plannedAttempt.runId
const lastElementOffset = -1
const eventEquivalence = Schema.toEquivalence(IntegratorAutomaticSuccessorSessionFixedEvent)
const lineageEquivalence = Schema.toEquivalence(TargetLineageObservation)
const integratorCorrelationsEqual = Schema.toEquivalence(IntegratorSessionCorrelation)

const integratorResponsibilityFactsFromCorrelation = (correlation: IntegratorSessionCorrelation) => ({
  acceptedResult: correlation.acceptedResult,
  integrationTarget: correlation.integrationTarget,
  plannedAttempt: correlation.plannedAttempt,
  queuedAt: correlation.queuedAt,
  startedAt: correlation.startedAt
})

const correlationKeyMaterial = (input: IntegratorAutomaticSuccessorPreparationInput): string =>
  [
    "automatic-competing-head-successor",
    input.predecessor.sessionId,
    input.predecessor.candidateResource,
    input.predecessor.plannedAttempt.runId,
    input.predecessor.plannedAttempt.attemptId,
    input.predecessor.startedAt,
    input.authorizationAt,
    input.targetLineageObservedAt,
    input.targetLineage.targetHeadSha,
    input.predecessor.acceptedResult.commit,
    input.predecessor.integrationTarget.repository,
    input.predecessor.integrationTarget.ref
  ].join(":")

/** Stable successor identity reused by the append validator and current-session reconstruction. */
export const integratorAutomaticSuccessorCorrelationFor = (
  input: IntegratorAutomaticSuccessorPreparationInput
): IntegratorSessionCorrelation => {
  const material = correlationKeyMaterial(input)
  return IntegratorSessionCorrelation.make({
    acceptedResult: input.predecessor.acceptedResult,
    candidateResource: IntegratorCandidateResourceLocator.make(`integrator-resource:${material}`),
    expectedTargetHead: input.targetLineage.targetHeadSha,
    integrationTarget: input.predecessor.integrationTarget,
    plannedAttempt: input.predecessor.plannedAttempt,
    queuedAt: input.predecessor.queuedAt,
    sessionId: IntegratorSessionId.make(`integrator-session:${material}`),
    startedAt: input.predecessor.startedAt,
    targetLineageObservedAt: input.targetLineageObservedAt
  })
}

const reject = (predecessor: IntegratorSessionCorrelation, detail: string) =>
  Effect.fail(new IntegratorJournalContradiction({ detail, runId: runIdFor(predecessor) }))

const historyBefore = (records: JournalHistorySource, position: JournalPosition): JournalHistorySource =>
  isJournalRecordEvidence(records)
    ? journalEvidenceBefore(records, Number(position))
    : records.filter((record) => record.position < position)

/** Confirms exact authorization, completed catch-up, and later fresh lineage remain in accepted history. */
export const integratorAutomaticSuccessorPreparationIsCurrent = (
  records: JournalHistorySource,
  input: IntegratorAutomaticSuccessorPreparationInput
): boolean => {
  const authRecord = journalRecordByPosition(records, input.authorizationAt)
  if (authRecord?.event._tag !== "IntegratorCompetingHeadSuccessorAuthorized") return false
  const authorization = authRecord.event
  const predecessor = input.predecessor
  const authorizedSession = authorization.correlation.qualifiedCandidate.run.session
  if (authRecord.runId !== runIdFor(predecessor) || !integratorCorrelationsEqual(predecessor, authorizedSession)) {
    return false
  }
  const retained = journalRecordByPosition(records, authorization.remotePublicationRetainedAt)
  if (
    retained?.event._tag !== "RemotePublicationRetained" ||
    retained.position >= authRecord.position ||
    !remotePublicationCorrelationEquals(retained.event.correlation, authorization.correlation) ||
    retained.event.cause._tag !== "CompatibleCompetingHead" ||
    retained.event.cause.mergeBase !== authorization.mergeBase ||
    retained.event.cause.remoteHead !== authorization.remoteHead
  ) {
    return false
  }
  const baselineCorrelation = automaticCompetingHeadRemoteBaselineCorrelationFor(
    runIdFor(predecessor),
    integratorResponsibilityFactsFromCorrelation(predecessor),
    predecessor.integrationTarget,
    authorization.correlation.target,
    authRecord.position,
    initialAutomaticCompetingHeadBaselineRound
  )
  const latestBaselineRound = automaticRemoteBaselineRoundsFor(records, baselineCorrelation).at(lastElementOffset)
  if (latestBaselineRound === undefined || latestBaselineRound.state._tag !== "Ready") return false
  const completedAt = latestBaselineRound.completedAt
  if (completedAt === undefined) return false
  const lineageRecord = journalRecordByPosition(records, input.targetLineageObservedAt)
  if (
    lineageRecord?.event._tag !== "TargetLineageObserved" ||
    lineageRecord.position <= completedAt ||
    !plannedTaskAttemptEquivalence(lineageRecord.event.plannedAttempt, predecessor.plannedAttempt) ||
    !lineageEquivalence(lineageRecord.event.observation, input.targetLineage) ||
    input.targetLineage.plannedBaseSha !== predecessor.plannedAttempt.baseSha ||
    !input.targetLineage.plannedBaseIsAncestorOfTargetHead ||
    input.targetLineage.targetHeadSha !== latestBaselineRound.state.remoteHead
  ) {
    return false
  }
  const intent = journalRecordByKey(records, intentRecordKey(lineageRecord.event.operationId))
  return (
    intent?.event._tag === "GitReadIntentRecorded" &&
    intent.event.operation._tag === "ReadTargetLineage" &&
    intent.position > completedAt &&
    intent.position < lineageRecord.position &&
    plannedTaskAttemptEquivalence(intent.event.operation.plannedAttempt, predecessor.plannedAttempt) &&
    intent.event.operation.integrationTarget.repository === predecessor.integrationTarget.repository &&
    intent.event.operation.integrationTarget.ref === predecessor.integrationTarget.ref
  )
}

const eventFor = (
  input: IntegratorAutomaticSuccessorPreparationInput,
  successor: IntegratorSessionCorrelation,
  generation: number
) =>
  IntegratorAutomaticSuccessorSessionFixedEvent.make({
    authorizationAt: input.authorizationAt,
    predecessor: input.predecessor,
    successor,
    successorGeneration: IntegratorAutomaticSuccessorGeneration.make(generation),
    version: workflowJournalEventVersion
  })

export type IntegratorAutomaticSuccessorSessionFixedRecord = JournalRecord & {
  readonly event: IntegratorAutomaticSuccessorSessionFixedEvent
}

export const integratorAutomaticSuccessorAppendRecordMatches = (
  record: JournalRecord,
  key: JournalRecord["key"],
  event: IntegratorAutomaticSuccessorSessionFixedEvent
): record is IntegratorAutomaticSuccessorSessionFixedRecord =>
  record.key === key &&
  record.event._tag === "IntegratorAutomaticSuccessorSessionFixed" &&
  eventEquivalence(record.event, event)

const exactFixedSessionExists = (records: JournalHistorySource, correlation: IntegratorSessionCorrelation): boolean => {
  let matchCount = 0
  for (const { event } of journalRecordsOfKind(records, "IntegratorSessionFixed")) {
    if (event._tag === "IntegratorSessionFixed" && integratorCorrelationsEqual(event.correlation, correlation)) {
      matchCount += 1
    }
  }
  for (const { event } of journalRecordsOfKind(records, "IntegratorSuccessorSessionFixed")) {
    if (event._tag === "IntegratorSuccessorSessionFixed" && integratorCorrelationsEqual(event.successor, correlation)) {
      matchCount += 1
    }
  }
  for (const { event } of journalRecordsOfKind(records, "IntegratorAutomaticSuccessorSessionFixed")) {
    if (
      event._tag === "IntegratorAutomaticSuccessorSessionFixed" &&
      integratorCorrelationsEqual(event.successor, correlation)
    ) {
      matchCount += 1
    }
  }
  return matchCount === 1
}

export const validateAutomaticSuccessorSessionFixedRecord = (
  records: JournalHistorySource,
  record: JournalRecord,
  predecessor: IntegratorSessionCorrelation
): { readonly _tag: "Valid" } | { readonly _tag: "Invalid"; readonly detail: string } => {
  if (
    record.event._tag !== "IntegratorAutomaticSuccessorSessionFixed" ||
    !integratorCorrelationsEqual(record.event.predecessor, predecessor)
  ) {
    return { _tag: "Invalid", detail: "automatic successor predecessor does not match the active session" }
  }
  const priorRecords = historyBefore(records, record.position)
  const lineage = journalRecordByPosition(priorRecords, record.event.successor.targetLineageObservedAt)
  if (lineage?.event._tag !== "TargetLineageObserved") {
    return { _tag: "Invalid", detail: "automatic successor lacks its exact fresh target-lineage observation" }
  }
  const input: IntegratorAutomaticSuccessorPreparationInput = {
    authorizationAt: record.event.authorizationAt,
    predecessor,
    targetLineage: lineage.event.observation,
    targetLineageObservedAt: lineage.position
  }
  const successor = integratorAutomaticSuccessorCorrelationFor(input)
  const capacity = integratorSessionCapacityForJournal(priorRecords, predecessor)
  if (capacity._tag === "Exhausted") {
    return {
      _tag: "Invalid",
      detail: "automatic successor event exceeds the fixed-session capacity"
    }
  }
  const expectedEvent = eventFor(input, successor, capacity.nextGeneration)
  const expectedKey = integratorAutomaticSuccessorSessionFixedRecordKey(predecessor, record.event.authorizationAt)
  if (
    !exactFixedSessionExists(priorRecords, predecessor) ||
    !integratorAutomaticSuccessorPreparationIsCurrent(priorRecords, input) ||
    record.position <= lineage.position ||
    !integratorAutomaticSuccessorAppendRecordMatches(record, expectedKey, expectedEvent)
  ) {
    return {
      _tag: "Invalid",
      detail: "automatic successor event does not match its exact authorization/baseline/lineage chronology"
    }
  }
  return { _tag: "Valid" }
}

/** Validates one exact authorization/catch-up/fresh-lineage append or recovers its existing fixed event. */
export const prepareIntegratorAutomaticSuccessorSessionAppend = Effect.fn(
  "IntegratorProtocol.prepareAutomaticSuccessorSessionAppend"
)(function* (input: IntegratorAutomaticSuccessorPreparationInput, records: JournalHistorySource) {
  const predecessor = input.predecessor
  const successor = integratorAutomaticSuccessorCorrelationFor(input)
  const key = integratorAutomaticSuccessorSessionFixedRecordKey(predecessor, input.authorizationAt)
  const existing = exactJournalRecordAtKey(records, key)
  if (existing._tag === "Duplicate") return yield* reject(predecessor, existing.detail)
  const premiseRecords = existing._tag === "Found" ? historyBefore(records, existing.record.position) : records
  if (
    !exactFixedSessionExists(premiseRecords, predecessor) ||
    !integratorAutomaticSuccessorPreparationIsCurrent(premiseRecords, input)
  ) {
    return yield* reject(
      predecessor,
      "automatic successor requires its exact fixed predecessor, authorization, ready baseline, and fresh lineage"
    )
  }
  const capacity = integratorSessionCapacityForJournal(premiseRecords, predecessor)
  if (existing._tag === "Found") {
    if (capacity._tag === "Exhausted") {
      return yield* reject(predecessor, "Integrator responsibility has reached its three-session aggregate bound")
    }
    const existingEvent = eventFor(input, successor, capacity.nextGeneration)
    return integratorAutomaticSuccessorAppendRecordMatches(existing.record, key, existingEvent)
      ? ({ _tag: "Existing", record: existing.record } as const)
      : yield* reject(predecessor, "automatic successor key contains a foreign or contradictory fixed event")
  }
  if (capacity._tag === "Exhausted") {
    return yield* reject(predecessor, "Integrator responsibility has reached its three-session aggregate bound")
  }
  const event = eventFor(input, successor, capacity.nextGeneration)
  const predecessorAlreadyHasSuccessor = [
    ...journalRecordsOfKind(records, "IntegratorSuccessorSessionFixed"),
    ...journalRecordsOfKind(records, "IntegratorAutomaticSuccessorSessionFixed")
  ].some(
    ({ event: prior }) =>
      (prior._tag === "IntegratorSuccessorSessionFixed" || prior._tag === "IntegratorAutomaticSuccessorSessionFixed") &&
      prior.predecessor.sessionId === predecessor.sessionId
  )
  const fixedRecords = [
    ...journalRecordsOfKind(records, "IntegratorSessionFixed"),
    ...journalRecordsOfKind(records, "IntegratorSuccessorSessionFixed"),
    ...journalRecordsOfKind(records, "IntegratorAutomaticSuccessorSessionFixed")
  ]
  const identityCollision = fixedRecords.some(({ event: fixed }) => {
    if (fixed._tag === "IntegratorSessionFixed") {
      return (
        fixed.correlation.sessionId === successor.sessionId ||
        fixed.correlation.candidateResource === successor.candidateResource
      )
    }
    if (fixed._tag === "IntegratorSuccessorSessionFixed" || fixed._tag === "IntegratorAutomaticSuccessorSessionFixed") {
      return (
        fixed.successor.sessionId === successor.sessionId ||
        fixed.successor.candidateResource === successor.candidateResource
      )
    }
    return false
  })
  if (predecessorAlreadyHasSuccessor || identityCollision) {
    return yield* reject(
      predecessor,
      "automatic predecessor already has a successor or the deterministic identity is occupied"
    )
  }
  return { _tag: "Append", event, key } as const
})
