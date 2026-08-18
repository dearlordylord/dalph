import { plannedTaskAttemptEquivalence } from "@dalph/contracts"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import type { OperationId } from "../../workflow/identity.js"
import type { WorkflowJournalEvent } from "../../workflow/registry/event.js"
import type { WorkflowOperation } from "../../workflow/registry/operation.js"
import { integratorCandidateRecordKeyPrefix } from "../../workflow-journal/record-key.js"
import { acceptedResultEquivalence } from "../../workflow/protocols/integration-admission/responsibility.js"
import type { IntegratorCorrelation } from "../../workflow/protocols/integrator/events.js"
import { integratorCorrelationsEqual } from "../../workflow/protocols/integrator/state.js"
import { setMapValue } from "./integration-history-run-binding.js"
import { type IntegratorRunHistoryIndexes, validateIntegratorRunHistoryEvent } from "./integrator-run-history.js"

/** Causal indexes owned by the generic outer Integrator history. */
export interface IntegratorHistoryIndexes extends IntegratorRunHistoryIndexes {
  readonly integrationStarted: Map<
    JournalPosition,
    Extract<WorkflowJournalEvent, { readonly _tag: "IntegrationStarted" }>
  >
  readonly targetLineageReadIntents: Map<
    OperationId,
    {
      readonly operation: Extract<WorkflowOperation, { readonly _tag: "ReadTargetLineage" }>
      readonly position: JournalPosition
    }
  >
  readonly targetLineageObservations: Map<
    JournalPosition,
    Extract<WorkflowJournalEvent, { readonly _tag: "TargetLineageObserved" }>
  >
  readonly integratorSessionFixed: Map<
    JournalPosition,
    Extract<WorkflowJournalEvent, { readonly _tag: "IntegratorSessionFixed" }>
  >
  readonly integratorSessionsByStartedAt: Map<JournalPosition, JournalPosition>
  readonly integratorSessionsBySessionId: Map<string, JournalPosition>
  readonly integratorSessionsByCandidateResource: Map<string, JournalPosition>
  readonly integratorResultsByStartedAt: Map<
    JournalPosition,
    {
      readonly event: Extract<WorkflowJournalEvent, { readonly _tag: "IntegratorResultRecorded" }>
      readonly position: JournalPosition
    }
  >
  readonly integratorCandidateGitReadIntents: Map<
    string,
    {
      readonly event: Extract<WorkflowJournalEvent, { readonly _tag: "IntegratorCandidateGitReadIntended" }>
      readonly position: JournalPosition
    }
  >
  readonly integratorCandidateGitObservations: Map<
    string,
    {
      readonly event: Extract<WorkflowJournalEvent, { readonly _tag: "IntegratorCandidateGitObserved" }>
      readonly position: JournalPosition
    }
  >
}

type IntegratorSessionFixed = Extract<WorkflowJournalEvent, { readonly _tag: "IntegratorSessionFixed" }>
type IntegratorResultRecorded = Extract<WorkflowJournalEvent, { readonly _tag: "IntegratorResultRecorded" }>
type IntegratorCandidateGitReadIntended = Extract<
  WorkflowJournalEvent,
  { readonly _tag: "IntegratorCandidateGitReadIntended" }
>
type IntegratorCandidateGitObserved = Extract<WorkflowJournalEvent, { readonly _tag: "IntegratorCandidateGitObserved" }>
type PositionedIntegratorEvent<Event> = { readonly event: Event; readonly position: JournalPosition }

const sameIntegrationTarget = (
  left: IntegratorCorrelation["integrationTarget"],
  right: IntegratorCorrelation["integrationTarget"]
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
  const intent = indexes.targetLineageReadIntents.get(observed.operationId)
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
  correlation: IntegratorCorrelation,
  indexes: IntegratorHistoryIndexes
): JournalPosition | undefined =>
  indexes.integratorSessionsByStartedAt.get(correlation.startedAt) ??
  indexes.integratorSessionsBySessionId.get(correlation.sessionId) ??
  indexes.integratorSessionsByCandidateResource.get(correlation.candidateResource)

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
): string | undefined => {
  const started = indexes.integrationStarted.get(event.correlation.startedAt)
  const targetLineage = indexes.targetLineageObservations.get(event.correlation.targetLineageObservedAt)
  const existing = existingSessionIdentity(event.correlation, indexes)
  setMapValue(indexes.integratorSessionFixed, record.position, event)
  setMapValue(indexes.integratorSessionsByStartedAt, event.correlation.startedAt, record.position)
  setMapValue(indexes.integratorSessionsBySessionId, event.correlation.sessionId, record.position)
  setMapValue(indexes.integratorSessionsByCandidateResource, event.correlation.candidateResource, record.position)
  return integratorSessionIssue(
    event,
    existing,
    hasEarlierIntegrationStart(record, event, started),
    hasEarlierTargetLineage(record, event, targetLineage, indexes)
  )
}

const exactSessionForCorrelation = (
  correlation: IntegratorCorrelation,
  record: JournalRecord,
  indexes: IntegratorHistoryIndexes
): PositionedIntegratorEvent<IntegratorSessionFixed> | undefined => {
  const sessionPosition = indexes.integratorSessionsByStartedAt.get(correlation.startedAt)
  const session = sessionPosition === undefined ? undefined : indexes.integratorSessionFixed.get(sessionPosition)
  return sessionPosition !== undefined &&
    session !== undefined &&
    sessionPosition < record.position &&
    integratorCorrelationsEqual(session.correlation, correlation)
    ? { event: session, position: sessionPosition }
    : undefined
}

const invalidIntegratorResult = (
  record: JournalRecord,
  event: IntegratorResultRecorded,
  indexes: IntegratorHistoryIndexes
): string | undefined => {
  const existing = indexes.integratorResultsByStartedAt.get(event.result.correlation.startedAt)
  const session = exactSessionForCorrelation(event.result.correlation, record, indexes)
  setMapValue(indexes.integratorResultsByStartedAt, event.result.correlation.startedAt, {
    event,
    position: record.position
  })
  return existing !== undefined
    ? `Integrator result repeats the exact session at ${event.result.correlation.startedAt}`
    : session === undefined
      ? `Integrator result has no exact earlier fixed session at ${event.result.correlation.startedAt}`
      : undefined
}

const exactPreparedResultFor = (
  correlation: IntegratorCorrelation,
  candidateText: string,
  record: JournalRecord,
  indexes: IntegratorHistoryIndexes
): PositionedIntegratorEvent<IntegratorResultRecorded> | undefined => {
  const result = indexes.integratorResultsByStartedAt.get(correlation.startedAt)
  return result !== undefined &&
    result.position < record.position &&
    result.event.result._tag === "PreparedCandidate" &&
    integratorCorrelationsEqual(result.event.result.correlation, correlation) &&
    result.event.result.candidateText === candidateText
    ? result
    : undefined
}

const invalidIntegratorCandidateGitReadIntent = (
  record: JournalRecord,
  event: IntegratorCandidateGitReadIntended,
  indexes: IntegratorHistoryIndexes
): string | undefined => {
  const key = integratorCandidateRecordKeyPrefix(event.correlation, event.candidateText)
  const existing = indexes.integratorCandidateGitReadIntents.get(key)
  const result = exactPreparedResultFor(event.correlation, event.candidateText, record, indexes)
  setMapValue(indexes.integratorCandidateGitReadIntents, key, { event, position: record.position })
  return existing !== undefined
    ? `Integrator candidate Git-read intent repeats candidate text ${event.candidateText}`
    : result === undefined
      ? `Integrator candidate Git-read intent has no exact earlier PreparedCandidate result`
      : undefined
}

const invalidIntegratorCandidateGitObservation = (
  record: JournalRecord,
  event: IntegratorCandidateGitObserved,
  indexes: IntegratorHistoryIndexes
): string | undefined => {
  const key = integratorCandidateRecordKeyPrefix(event.correlation, event.candidateText)
  const existing = indexes.integratorCandidateGitObservations.get(key)
  const intent = indexes.integratorCandidateGitReadIntents.get(key)
  const result = exactPreparedResultFor(event.correlation, event.candidateText, record, indexes)
  const exactEarlierIntent =
    intent !== undefined &&
    intent.position < record.position &&
    intent.event.candidateText === event.candidateText &&
    integratorCorrelationsEqual(intent.event.correlation, event.correlation)
  const matchingCandidateText = event.observation.candidateText === event.candidateText
  setMapValue(indexes.integratorCandidateGitObservations, key, { event, position: record.position })
  return existing !== undefined
    ? `Integrator candidate Git observation repeats candidate text ${event.candidateText}`
    : !exactEarlierIntent || result === undefined || !matchingCandidateText
      ? `Integrator candidate Git observation has no exact earlier intent, result, and candidate text`
      : undefined
}

type IntegratorHistoryValidationResult =
  | { readonly handled: true; readonly issue: string | undefined }
  | { readonly handled: false }

const validateNonRunIntegratorHistoryEvent = (
  record: JournalRecord,
  indexes: IntegratorHistoryIndexes
): IntegratorHistoryValidationResult => {
  const event = record.event
  if (event._tag === "GitReadIntentRecorded" && event.operation._tag === "ReadTargetLineage") {
    setMapValue(indexes.targetLineageReadIntents, event.operation.operationId, {
      operation: event.operation,
      position: record.position
    })
    return { handled: true, issue: undefined }
  }
  if (event._tag === "TargetLineageObserved") {
    setMapValue(indexes.targetLineageObservations, record.position, event)
    return { handled: true, issue: undefined }
  }
  if (event._tag === "IntegratorSessionFixed") {
    return { handled: true, issue: invalidIntegratorSession(record, event, indexes) }
  }
  if (event._tag === "IntegratorResultRecorded") {
    return { handled: true, issue: invalidIntegratorResult(record, event, indexes) }
  }
  if (event._tag === "IntegratorCandidateGitReadIntended") {
    return { handled: true, issue: invalidIntegratorCandidateGitReadIntent(record, event, indexes) }
  }
  if (event._tag === "IntegratorCandidateGitObserved") {
    return { handled: true, issue: invalidIntegratorCandidateGitObservation(record, event, indexes) }
  }
  return { handled: false }
}

/** Validates and indexes only the events owned by the outer Integrator protocol. */
export const validateIntegratorHistoryEvent = (
  record: JournalRecord,
  indexes: IntegratorHistoryIndexes,
  records: ReadonlyArray<JournalRecord> = [record]
): IntegratorHistoryValidationResult => {
  const runHistory = validateIntegratorRunHistoryEvent(record, indexes, records)
  return runHistory.handled ? runHistory : validateNonRunIntegratorHistoryEvent(record, indexes)
}
