import { plannedTaskAttemptEquivalence } from "@dalph/contracts"
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
    Extract<WorkflowJournalEvent, { readonly _tag: "IntegratorSessionFixed" | "IntegratorSuccessorSessionFixed" }>
  >
  readonly integratorSessionsByStartedAt: Map<JournalPosition, JournalPosition>
  readonly integratorSessionsBySessionId: Map<string, JournalPosition>
  readonly integratorSessionsByCandidateResource: Map<string, JournalPosition>
  readonly integratorSuccessorSessionFixed: Map<JournalPosition, IntegratorSuccessorSessionFixedEvent>
  readonly integratorSuccessorSessionsByPredecessor: Map<string, JournalPosition>
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
  correlation: IntegratorSessionCorrelation,
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

const successorResponsibilityMatches = (
  predecessor: IntegratorSessionCorrelation,
  successor: IntegratorSessionCorrelation
): boolean =>
  plannedTaskAttemptEquivalence(predecessor.plannedAttempt, successor.plannedAttempt) &&
  acceptedResultEquivalence(predecessor.acceptedResult, successor.acceptedResult) &&
  sameIntegrationTarget(predecessor.integrationTarget, successor.integrationTarget) &&
  predecessor.queuedAt === successor.queuedAt &&
  predecessor.startedAt === successor.startedAt

const successorTargetLineageMatches = (
  event: IntegratorSuccessorSessionFixed,
  indexes: IntegratorHistoryIndexes
): boolean => {
  const observed = indexes.targetLineageObservations.get(event.successor.targetLineageObservedAt)
  /* v8 ignore next -- @preserve the caller computes deterministicSuccessor only after this exact observation lookup succeeds. */
  if (observed === undefined) return false
  const intent = indexes.targetLineageReadIntents.get(observed.operationId)
  return (
    intent !== undefined &&
    intent.position > event.directionAppliedAt &&
    intent.position < event.successor.targetLineageObservedAt &&
    sameIntegrationTarget(intent.operation.integrationTarget, event.successor.integrationTarget) &&
    plannedTaskAttemptEquivalence(intent.operation.plannedAttempt, event.successor.plannedAttempt) &&
    plannedTaskAttemptEquivalence(observed.plannedAttempt, event.successor.plannedAttempt) &&
    observed.observation.plannedBaseSha === event.successor.plannedAttempt.baseSha &&
    observed.observation.targetHeadSha === event.successor.expectedTargetHead &&
    observed.observation.plannedBaseIsAncestorOfTargetHead
  )
}

const invalidIntegratorSuccessorSession = (
  record: JournalRecord,
  event: IntegratorSuccessorSessionFixed,
  indexes: IntegratorHistoryIndexes,
  records: ReadonlyArray<JournalRecord>
): string | undefined => {
  const predecessorPosition = indexes.integratorSessionsBySessionId.get(event.predecessor.sessionId)
  const predecessor =
    predecessorPosition === undefined ? undefined : indexes.integratorSessionFixed.get(predecessorPosition)
  const existingSuccessorPosition = indexes.integratorSuccessorSessionsByPredecessor.get(event.predecessor.sessionId)
  const existingSessionIdentity =
    indexes.integratorSessionsBySessionId.get(event.successor.sessionId) ??
    indexes.integratorSessionsByCandidateResource.get(event.successor.candidateResource)
  const quarantine = records.find((candidate) => candidate.position === event.quarantineAt)
  const direction = records.find((candidate) => candidate.position === event.directionAppliedAt)
  const expectedKey = integratorSuccessorSessionFixedRecordKey(
    event.predecessor,
    event.quarantineAt,
    event.directionAppliedAt
  )
  const successorLineage = indexes.targetLineageObservations.get(event.successor.targetLineageObservedAt)
  const deterministicSuccessor =
    successorLineage === undefined
      ? undefined
      : integratorSuccessorCorrelationFor({
          directionAppliedAt: event.directionAppliedAt,
          predecessor: event.predecessor,
          quarantineAt: event.quarantineAt,
          targetLineage: successorLineage.observation,
          targetLineageObservedAt: event.successor.targetLineageObservedAt
        })
  const validPredecessor =
    predecessorPosition !== undefined &&
    predecessor !== undefined &&
    predecessor._tag === "IntegratorSessionFixed" &&
    predecessorPosition < event.quarantineAt &&
    integratorCorrelationsEqual(predecessor.correlation, event.predecessor)
  const validQuarantine =
    quarantine?.event._tag === "IntegrationQuarantined" &&
    quarantine.runId === record.runId &&
    integratorCorrelationsEqual(quarantine.event.correlation, event.predecessor)
  const validDirection =
    direction?.event._tag === "IntegrationQuarantineDirectionApplied" &&
    direction.runId === record.runId &&
    direction.event.fingerprint.direction === "FullRerun" &&
    direction.event.fingerprint.quarantineAt === event.quarantineAt &&
    direction.event.fingerprint.sessionId === event.predecessor.sessionId
  const issue =
    record.key !== expectedKey
      ? `FullRerun successor requires record key ${expectedKey}`
      : existingSuccessorPosition !== undefined
        ? `Integrator predecessor already has a successor at ${existingSuccessorPosition}`
        : existingSessionIdentity !== undefined
          ? `Integrator successor reuses a session or resource at ${existingSessionIdentity}`
          : !validPredecessor
            ? "Integrator successor has no exact earlier predecessor session"
            : deterministicSuccessor === undefined ||
                !integratorCorrelationsEqual(deterministicSuccessor, event.successor)
              ? "Integrator successor identity is not the deterministic result of its Q, D, and fresh lineage"
              : /* v8 ignore next -- @preserve deterministic successor construction copies every responsibility field from its predecessor. */
                !successorResponsibilityMatches(event.predecessor, event.successor)
                ? "Integrator successor changes the accepted result, target, attempt, queue position, or start position"
                : /* v8 ignore next -- @preserve deterministic successor identities derive distinct session and resource locators from the predecessor. */
                  event.predecessor.sessionId === event.successor.sessionId ||
                    event.predecessor.candidateResource === event.successor.candidateResource
                  ? "Integrator successor must use distinct session and resource identities"
                  : !validQuarantine || event.quarantineAt <= predecessorPosition
                    ? "Integrator successor has no exact predecessor quarantine after S1"
                    : !validDirection || event.directionAppliedAt <= event.quarantineAt
                      ? "Integrator successor has no exact FullRerun direction after Q"
                      : /* v8 ignore next -- @preserve IntegratorSuccessorSessionFixedEvent's schema requires Q < D < fresh L before this validator. */
                        event.successor.targetLineageObservedAt <= event.directionAppliedAt
                        ? "Integrator successor fresh lineage must be observed after D"
                        : !successorTargetLineageMatches(event, indexes)
                          ? "Integrator successor has no exact fresh target-lineage observation"
                          : record.position <= event.successor.targetLineageObservedAt
                            ? "Integrator successor must be fixed after its fresh target-lineage observation"
                            : undefined

  setMapValue(indexes.integratorSessionFixed, record.position, event)
  setMapValue(indexes.integratorSuccessorSessionFixed, record.position, event)
  setMapValue(indexes.integratorSuccessorSessionsByPredecessor, event.predecessor.sessionId, record.position)
  setMapValue(indexes.integratorSessionsBySessionId, event.successor.sessionId, record.position)
  setMapValue(indexes.integratorSessionsByCandidateResource, event.successor.candidateResource, record.position)
  return issue
}

type IntegratorHistoryValidationResult =
  | { readonly handled: true; readonly issue: string | undefined }
  | { readonly handled: false }

const validateNonRunIntegratorHistoryEvent = (
  record: JournalRecord,
  indexes: IntegratorHistoryIndexes,
  records: ReadonlyArray<JournalRecord> = [record]
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
  if (event._tag === "IntegratorSuccessorSessionFixed") {
    return { handled: true, issue: invalidIntegratorSuccessorSession(record, event, indexes, records) }
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
  return runHistory.handled ? runHistory : validateNonRunIntegratorHistoryEvent(record, indexes, records)
}
