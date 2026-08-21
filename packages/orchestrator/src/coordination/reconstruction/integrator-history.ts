/* eslint-disable max-lines -- Outer Integrator chronology and its causal indexes form one audited boundary. */
import { plannedTaskAttemptEquivalence } from "@dalph/contracts"
import { HashMap, Option } from "effect"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import type { OperationId } from "../../workflow/identity.js"
import type { WorkflowJournalEvent } from "../../workflow/registry/event.js"
import type { WorkflowOperation } from "../../workflow/registry/operation.js"
import { integratorSuccessorSessionFixedRecordKey } from "../../workflow-journal/record-key.js"
import { acceptedResultEquivalence } from "../../workflow/protocols/integration-admission/responsibility.js"
import type {
  IntegratorSessionCorrelation,
  IntegratorSuccessorSessionFixedEvent
} from "../../workflow/protocols/integrator/events.js"
import { integratorCorrelationsEqual } from "../../workflow/protocols/integrator/state.js"
import { integratorSuccessorCorrelationFor } from "../../workflow/protocols/integrator/session.js"
import { setMapValue } from "./integration-history-run-binding.js"
import { type IntegratorRunHistoryIndexes, validateIntegratorRunHistoryEvent } from "./integrator-run-history.js"

/** Causal indexes owned by the generic outer Integrator history. */
export interface IntegratorHistoryIndexes extends IntegratorRunHistoryIndexes {
  readonly integrationStarted: HashMap.HashMap<
    JournalPosition,
    Extract<WorkflowJournalEvent, { readonly _tag: "IntegrationStarted" }>
  >
  readonly targetLineageReadIntents: HashMap.HashMap<
    OperationId,
    {
      readonly operation: Extract<WorkflowOperation, { readonly _tag: "ReadTargetLineage" }>
      readonly position: JournalPosition
    }
  >
  readonly targetLineageObservations: HashMap.HashMap<
    JournalPosition,
    Extract<WorkflowJournalEvent, { readonly _tag: "TargetLineageObserved" }>
  >
  readonly integratorSessionFixed: HashMap.HashMap<
    JournalPosition,
    Extract<WorkflowJournalEvent, { readonly _tag: "IntegratorSessionFixed" | "IntegratorSuccessorSessionFixed" }>
  >
  readonly integratorSessionsByStartedAt: HashMap.HashMap<JournalPosition, JournalPosition>
  readonly integratorSessionsBySessionId: HashMap.HashMap<string, JournalPosition>
  readonly integratorSessionsByCandidateResource: HashMap.HashMap<string, JournalPosition>
  readonly integratorSuccessorSessionFixed: HashMap.HashMap<JournalPosition, IntegratorSuccessorSessionFixedEvent>
  readonly integratorSuccessorSessionsByPredecessor: HashMap.HashMap<string, JournalPosition>
}

const mapGet = <Key, Value>(map: HashMap.HashMap<Key, Value>, key: Key): Value | undefined =>
  Option.getOrUndefined(HashMap.get(map, key))

interface IntegratorHistoryValidation<Indexes extends IntegratorHistoryIndexes = IntegratorHistoryIndexes> {
  readonly indexes: Indexes
  readonly detail: string | undefined
}

type IntegratorSessionFixed = Extract<WorkflowJournalEvent, { readonly _tag: "IntegratorSessionFixed" }>
type IntegratorSuccessorSessionFixed = Extract<
  WorkflowJournalEvent,
  { readonly _tag: "IntegratorSuccessorSessionFixed" }
>
const sameIntegrationTarget = (
  left: IntegratorSessionCorrelation["integrationTarget"],
  right: IntegratorSessionCorrelation["integrationTarget"]
): boolean => left.repository === right.repository && left.ref === right.ref

const sessionFactsMatchIntegrationStart = (
  event: IntegratorSessionFixed,
  started: Extract<WorkflowJournalEvent, { readonly _tag: "IntegrationStarted" }>
): boolean =>
  started.responsibilityBeganAt === event.correlation.queuedAt &&
  plannedTaskAttemptEquivalence(started.plannedAttempt, event.correlation.plannedAttempt) &&
  acceptedResultEquivalence(started.acceptedResult, event.correlation.acceptedResult) &&
  sameIntegrationTarget(started.integrationTarget, event.correlation.integrationTarget)

const targetLineageMatchesSession = (
  event: IntegratorSessionFixed,
  observed: Extract<WorkflowJournalEvent, { readonly _tag: "TargetLineageObserved" }>,
  observedAt: JournalPosition,
  indexes: IntegratorHistoryIndexes
): boolean => {
  const intent = mapGet(indexes.targetLineageReadIntents, observed.operationId)
  if (intent === undefined) return false
  return [
    intent.position < observedAt,
    intent.operation.operationId === observed.operationId,
    sameIntegrationTarget(intent.operation.integrationTarget, event.correlation.integrationTarget),
    plannedTaskAttemptEquivalence(observed.plannedAttempt, event.correlation.plannedAttempt),
    plannedTaskAttemptEquivalence(intent.operation.plannedAttempt, observed.plannedAttempt),
    observed.observation.plannedBaseSha === event.correlation.plannedAttempt.baseSha,
    observed.observation.targetHeadSha === event.correlation.expectedTargetHead,
    observed.observation.plannedBaseIsAncestorOfTargetHead
  ].every(Boolean)
}

const hasEarlierIntegrationStart = (
  record: JournalRecord,
  event: IntegratorSessionFixed,
  started: Extract<WorkflowJournalEvent, { readonly _tag: "IntegrationStarted" }> | undefined
): boolean =>
  started !== undefined &&
  event.correlation.startedAt < record.position &&
  sessionFactsMatchIntegrationStart(event, started)

const hasEarlierTargetLineage = (
  record: JournalRecord,
  event: IntegratorSessionFixed,
  targetLineage: Extract<WorkflowJournalEvent, { readonly _tag: "TargetLineageObserved" }> | undefined,
  indexes: IntegratorHistoryIndexes
): boolean =>
  targetLineage !== undefined &&
  event.correlation.targetLineageObservedAt < record.position &&
  targetLineageMatchesSession(event, targetLineage, event.correlation.targetLineageObservedAt, indexes)

const existingSessionIdentity = (
  correlation: IntegratorSessionCorrelation,
  indexes: IntegratorHistoryIndexes
): JournalPosition | undefined =>
  mapGet(indexes.integratorSessionsByStartedAt, correlation.startedAt) ??
  mapGet(indexes.integratorSessionsBySessionId, correlation.sessionId) ??
  mapGet(indexes.integratorSessionsByCandidateResource, correlation.candidateResource)

const integratorSessionIssue = (
  event: IntegratorSessionFixed,
  existing: JournalPosition | undefined,
  hasStart: boolean,
  hasLineage: boolean
): string | undefined => {
  if (existing !== undefined) {
    return `Integrator session reuses a responsibility, session, or candidate resource already fixed at ${existing}`
  }
  if (!hasStart) return `Integrator session has no exact earlier IntegrationStarted at ${event.correlation.startedAt}`
  if (!hasLineage) {
    return `Integrator session has no exact earlier TargetLineageObserved at ${event.correlation.targetLineageObservedAt}`
  }
  return undefined
}

const invalidIntegratorSession = (
  record: JournalRecord,
  event: IntegratorSessionFixed,
  indexes: IntegratorHistoryIndexes
): IntegratorHistoryValidation => {
  const started = mapGet(indexes.integrationStarted, event.correlation.startedAt)
  const targetLineage = mapGet(indexes.targetLineageObservations, event.correlation.targetLineageObservedAt)
  const existing = existingSessionIdentity(event.correlation, indexes)
  return {
    detail: integratorSessionIssue(
      event,
      existing,
      hasEarlierIntegrationStart(record, event, started),
      hasEarlierTargetLineage(record, event, targetLineage, indexes)
    ),
    indexes: {
      ...indexes,
      integratorSessionFixed: setMapValue(indexes.integratorSessionFixed, record.position, event),
      integratorSessionsByStartedAt: setMapValue(
        indexes.integratorSessionsByStartedAt,
        event.correlation.startedAt,
        record.position
      ),
      integratorSessionsBySessionId: setMapValue(
        indexes.integratorSessionsBySessionId,
        event.correlation.sessionId,
        record.position
      ),
      integratorSessionsByCandidateResource: setMapValue(
        indexes.integratorSessionsByCandidateResource,
        event.correlation.candidateResource,
        record.position
      )
    }
  }
}

const successorResponsibilityMatches = (
  predecessor: IntegratorSessionCorrelation,
  successor: IntegratorSessionCorrelation
): boolean =>
  plannedTaskAttemptEquivalence(predecessor.plannedAttempt, successor.plannedAttempt) &&
  acceptedResultEquivalence(predecessor.acceptedResult, successor.acceptedResult) &&
  sameIntegrationTarget(predecessor.integrationTarget, successor.integrationTarget) &&
  predecessor.queuedAt === successor.queuedAt &&
  predecessor.startedAt === successor.startedAt

type SuccessorTargetLineageReadIntent = {
  readonly operation: Extract<WorkflowOperation, { readonly _tag: "ReadTargetLineage" }>
  readonly position: JournalPosition
}

const successorTargetLineageIntentChronologyMatches = (
  intent: SuccessorTargetLineageReadIntent,
  event: IntegratorSuccessorSessionFixed
): boolean => intent.position > event.directionAppliedAt && intent.position < event.successor.targetLineageObservedAt

const successorTargetLineageFactsMatch = (
  intent: SuccessorTargetLineageReadIntent,
  event: IntegratorSuccessorSessionFixed,
  observed: Extract<WorkflowJournalEvent, { readonly _tag: "TargetLineageObserved" }>
): boolean =>
  sameIntegrationTarget(intent.operation.integrationTarget, event.successor.integrationTarget) &&
  plannedTaskAttemptEquivalence(intent.operation.plannedAttempt, event.successor.plannedAttempt) &&
  plannedTaskAttemptEquivalence(observed.plannedAttempt, event.successor.plannedAttempt) &&
  observed.observation.plannedBaseSha === event.successor.plannedAttempt.baseSha &&
  observed.observation.targetHeadSha === event.successor.expectedTargetHead &&
  observed.observation.plannedBaseIsAncestorOfTargetHead

const successorTargetLineageMatches = (
  event: IntegratorSuccessorSessionFixed,
  indexes: IntegratorHistoryIndexes
): boolean => {
  const observed = mapGet(indexes.targetLineageObservations, event.successor.targetLineageObservedAt)
  /* v8 ignore next -- @preserve the caller computes deterministicSuccessor only after this exact observation lookup succeeds. */
  if (observed === undefined) return false
  const intent = mapGet(indexes.targetLineageReadIntents, observed.operationId)
  return (
    intent !== undefined &&
    successorTargetLineageIntentChronologyMatches(intent, event) &&
    successorTargetLineageFactsMatch(intent, event, observed)
  )
}

type ValidSuccessorPredecessor = { readonly position: JournalPosition }

const validSuccessorPredecessorFor = (
  predecessorPosition: JournalPosition | undefined,
  predecessor: IntegratorSessionFixed | IntegratorSuccessorSessionFixed | undefined,
  event: IntegratorSuccessorSessionFixed
): ValidSuccessorPredecessor | undefined => {
  if (
    predecessorPosition === undefined ||
    predecessor === undefined ||
    predecessor._tag !== "IntegratorSessionFixed" ||
    predecessorPosition >= event.quarantineAt ||
    !integratorCorrelationsEqual(predecessor.correlation, event.predecessor)
  ) {
    return undefined
  }
  return { position: predecessorPosition }
}

const deterministicSuccessorFor = (
  event: IntegratorSuccessorSessionFixed,
  successorLineage: Extract<WorkflowJournalEvent, { readonly _tag: "TargetLineageObserved" }> | undefined
): IntegratorSessionCorrelation | undefined =>
  successorLineage === undefined
    ? undefined
    : integratorSuccessorCorrelationFor({
        directionAppliedAt: event.directionAppliedAt,
        predecessor: event.predecessor,
        quarantineAt: event.quarantineAt,
        targetLineage: successorLineage.observation,
        targetLineageObservedAt: event.successor.targetLineageObservedAt
      })

const successorQuarantineIsValid = (
  quarantine: JournalRecord | undefined,
  record: JournalRecord,
  event: IntegratorSuccessorSessionFixed
): boolean =>
  quarantine?.event._tag === "IntegrationQuarantined" &&
  quarantine.runId === record.runId &&
  integratorCorrelationsEqual(quarantine.event.correlation, event.predecessor)

const successorDirectionIsValid = (
  direction: JournalRecord | undefined,
  record: JournalRecord,
  event: IntegratorSuccessorSessionFixed
): boolean =>
  direction?.event._tag === "IntegrationQuarantineDirectionApplied" &&
  direction.runId === record.runId &&
  direction.event.fingerprint.direction === "FullRerun" &&
  direction.event.fingerprint.quarantineAt === event.quarantineAt &&
  direction.event.fingerprint.sessionId === event.predecessor.sessionId

type SuccessorIdentityValidation =
  | { readonly _tag: "Invalid"; readonly detail: string }
  | { readonly _tag: "Valid"; readonly predecessor: ValidSuccessorPredecessor }

const invalidSuccessorIdentity = (
  record: JournalRecord,
  expectedKey: JournalRecord["key"],
  existingSuccessorPosition: JournalPosition | undefined,
  existingSessionIdentity: JournalPosition | undefined,
  predecessor: ValidSuccessorPredecessor | undefined
): SuccessorIdentityValidation => {
  if (record.key !== expectedKey)
    return { _tag: "Invalid", detail: `FullRerun successor requires record key ${expectedKey}` }
  if (existingSuccessorPosition !== undefined) {
    return { _tag: "Invalid", detail: `Integrator predecessor already has a successor at ${existingSuccessorPosition}` }
  }
  if (existingSessionIdentity !== undefined) {
    return {
      _tag: "Invalid",
      detail: `Integrator successor reuses a session or resource at ${existingSessionIdentity}`
    }
  }
  return predecessor === undefined
    ? { _tag: "Invalid", detail: "Integrator successor has no exact earlier predecessor session" }
    : { _tag: "Valid", predecessor }
}

const invalidSuccessorCorrelation = (
  event: IntegratorSuccessorSessionFixed,
  deterministicSuccessor: IntegratorSessionCorrelation | undefined
): string | undefined => {
  if (deterministicSuccessor === undefined || !integratorCorrelationsEqual(deterministicSuccessor, event.successor)) {
    return "Integrator successor identity is not the deterministic result of its Q, D, and fresh lineage"
  }
  /* v8 ignore next -- @preserve deterministic successor construction copies every responsibility field from its predecessor. */
  if (!successorResponsibilityMatches(event.predecessor, event.successor)) {
    return "Integrator successor changes the accepted result, target, attempt, queue position, or start position"
  }
  /* v8 ignore next -- @preserve deterministic successor identities derive distinct session and resource locators from the predecessor. */
  if (
    event.predecessor.sessionId === event.successor.sessionId ||
    event.predecessor.candidateResource === event.successor.candidateResource
  ) {
    return "Integrator successor must use distinct session and resource identities"
  }
  return undefined
}

const invalidSuccessorChronology = (
  record: JournalRecord,
  event: IntegratorSuccessorSessionFixed,
  indexes: IntegratorHistoryIndexes,
  predecessor: ValidSuccessorPredecessor,
  validQuarantine: boolean,
  validDirection: boolean
): string | undefined => {
  if (!validQuarantine || event.quarantineAt <= predecessor.position) {
    return "Integrator successor has no exact predecessor quarantine after S1"
  }
  if (!validDirection || event.directionAppliedAt <= event.quarantineAt) {
    return "Integrator successor has no exact FullRerun direction after Q"
  }
  /* v8 ignore next -- @preserve IntegratorSuccessorSessionFixedEvent's schema requires Q < D < fresh L before this validator. */
  if (event.successor.targetLineageObservedAt <= event.directionAppliedAt) {
    return "Integrator successor fresh lineage must be observed after D"
  }
  if (!successorTargetLineageMatches(event, indexes)) {
    return "Integrator successor has no exact fresh target-lineage observation"
  }
  if (record.position <= event.successor.targetLineageObservedAt) {
    return "Integrator successor must be fixed after its fresh target-lineage observation"
  }
  return undefined
}

const invalidSuccessorRecord = (
  record: JournalRecord,
  event: IntegratorSuccessorSessionFixed,
  indexes: IntegratorHistoryIndexes,
  expectedKey: JournalRecord["key"],
  existingSuccessorPosition: JournalPosition | undefined,
  existingSessionIdentity: JournalPosition | undefined,
  predecessor: ValidSuccessorPredecessor | undefined,
  deterministicSuccessor: IntegratorSessionCorrelation | undefined,
  validQuarantine: boolean,
  validDirection: boolean
): string | undefined => {
  const identityValidation = invalidSuccessorIdentity(
    record,
    expectedKey,
    existingSuccessorPosition,
    existingSessionIdentity,
    predecessor
  )
  if (identityValidation._tag === "Invalid") return identityValidation.detail
  const correlationIssue = invalidSuccessorCorrelation(event, deterministicSuccessor)
  if (correlationIssue !== undefined) return correlationIssue
  return invalidSuccessorChronology(
    record,
    event,
    indexes,
    identityValidation.predecessor,
    validQuarantine,
    validDirection
  )
}

const invalidIntegratorSuccessorSession = (
  record: JournalRecord,
  event: IntegratorSuccessorSessionFixed,
  indexes: IntegratorHistoryIndexes,
  records: ReadonlyArray<JournalRecord>
): IntegratorHistoryValidation => {
  const predecessorPosition = mapGet(indexes.integratorSessionsBySessionId, event.predecessor.sessionId)
  const predecessor =
    predecessorPosition === undefined ? undefined : mapGet(indexes.integratorSessionFixed, predecessorPosition)
  const existingSuccessorPosition = mapGet(
    indexes.integratorSuccessorSessionsByPredecessor,
    event.predecessor.sessionId
  )
  const existingSessionIdentity =
    mapGet(indexes.integratorSessionsBySessionId, event.successor.sessionId) ??
    mapGet(indexes.integratorSessionsByCandidateResource, event.successor.candidateResource)
  const quarantine = records.find((candidate) => candidate.position === event.quarantineAt)
  const direction = records.find((candidate) => candidate.position === event.directionAppliedAt)
  const expectedKey = integratorSuccessorSessionFixedRecordKey(
    event.predecessor,
    event.quarantineAt,
    event.directionAppliedAt
  )
  const successorLineage = mapGet(indexes.targetLineageObservations, event.successor.targetLineageObservedAt)
  const deterministicSuccessor = deterministicSuccessorFor(event, successorLineage)
  const validPredecessor = validSuccessorPredecessorFor(predecessorPosition, predecessor, event)
  const validQuarantine = successorQuarantineIsValid(quarantine, record, event)
  const validDirection = successorDirectionIsValid(direction, record, event)
  const issue = invalidSuccessorRecord(
    record,
    event,
    indexes,
    expectedKey,
    existingSuccessorPosition,
    existingSessionIdentity,
    validPredecessor,
    deterministicSuccessor,
    validQuarantine,
    validDirection
  )

  return {
    detail: issue,
    indexes: {
      ...indexes,
      integratorSessionFixed: setMapValue(indexes.integratorSessionFixed, record.position, event),
      integratorSuccessorSessionFixed: setMapValue(indexes.integratorSuccessorSessionFixed, record.position, event),
      integratorSuccessorSessionsByPredecessor: setMapValue(
        indexes.integratorSuccessorSessionsByPredecessor,
        event.predecessor.sessionId,
        record.position
      ),
      integratorSessionsBySessionId: setMapValue(
        indexes.integratorSessionsBySessionId,
        event.successor.sessionId,
        record.position
      ),
      integratorSessionsByCandidateResource: setMapValue(
        indexes.integratorSessionsByCandidateResource,
        event.successor.candidateResource,
        record.position
      )
    }
  }
}

type IntegratorHistoryValidationResult<Indexes extends IntegratorHistoryIndexes> =
  | { readonly handled: true; readonly issue: string | undefined; readonly indexes: Indexes }
  | { readonly handled: false; readonly indexes: Indexes }

const validateNonRunIntegratorHistoryEvent = <Indexes extends IntegratorHistoryIndexes>(
  record: JournalRecord,
  indexes: Indexes,
  records: ReadonlyArray<JournalRecord> = [record]
): IntegratorHistoryValidationResult<Indexes> => {
  const event = record.event
  if (event._tag === "GitReadIntentRecorded" && event.operation._tag === "ReadTargetLineage") {
    return {
      handled: true,
      issue: undefined,
      indexes: {
        ...indexes,
        targetLineageReadIntents: setMapValue(indexes.targetLineageReadIntents, event.operation.operationId, {
          operation: event.operation,
          position: record.position
        })
      }
    }
  }
  if (event._tag === "TargetLineageObserved") {
    return {
      handled: true,
      issue: undefined,
      indexes: {
        ...indexes,
        targetLineageObservations: setMapValue(indexes.targetLineageObservations, record.position, event)
      }
    }
  }
  if (event._tag === "IntegratorSessionFixed") {
    const validation = invalidIntegratorSession(record, event, indexes)
    return { handled: true, issue: validation.detail, indexes: { ...indexes, ...validation.indexes } }
  }
  if (event._tag === "IntegratorSuccessorSessionFixed") {
    const validation = invalidIntegratorSuccessorSession(record, event, indexes, records)
    return { handled: true, issue: validation.detail, indexes: { ...indexes, ...validation.indexes } }
  }
  return { handled: false, indexes }
}

/** Validates and indexes only the events owned by the outer Integrator protocol. */
export const validateIntegratorHistoryEvent = <Indexes extends IntegratorHistoryIndexes>(
  record: JournalRecord,
  indexes: Indexes,
  records: ReadonlyArray<JournalRecord> = [record]
): IntegratorHistoryValidationResult<Indexes> => {
  const runHistory = validateIntegratorRunHistoryEvent(record, indexes, records)
  return runHistory.handled
    ? { handled: true, issue: runHistory.issue, indexes: runHistory.indexes }
    : validateNonRunIntegratorHistoryEvent(record, indexes, records)
}
