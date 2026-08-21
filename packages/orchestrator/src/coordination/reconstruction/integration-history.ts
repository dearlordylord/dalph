import {
  plannedTaskAttemptEquivalence,
  type AcceptedResult,
  type AttemptId,
  type PlannedTaskAttempt
} from "@dalph/contracts"
import { HashMap, Option } from "effect"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import type { WorkflowJournalEvent } from "../../workflow/registry/event.js"
import {
  acceptedResultEquivalence,
  integrationResponsibilityEquivalence
} from "../../workflow/protocols/integration-admission/responsibility.js"
import {
  invalidTargetPromotionHistory,
  makeTargetPromotionHistoryIndexes,
  type TargetPromotionHistoryIndexes
} from "./target-promotion-history.js"
import { setMapValue } from "./integration-history-run-binding.js"
import { type IntegratorHistoryIndexes, validateIntegratorHistoryEvent } from "./integrator-history.js"
import { deriveIntegrationQuarantineState } from "../../workflow/protocols/integration-quarantine/state.js"
import { validateProviderRunActivityAbsent } from "../../workflow/protocols/integration-quarantine/provider-failure.js"

export interface IntegrationHistoryIndexes extends IntegratorHistoryIndexes {
  readonly acceptedExecutorResults: HashMap.HashMap<AttemptId, AcceptedResult>
  readonly acceptedExecutorResultPositions: HashMap.HashMap<AttemptId, JournalPosition>
  readonly executorResponsibilitiesBegan: HashMap.HashMap<
    AttemptId,
    { readonly plannedAttempt: PlannedTaskAttempt; readonly position: JournalPosition }
  >
  readonly integrationResponsibilitiesBegan: HashMap.HashMap<
    JournalPosition,
    Extract<WorkflowJournalEvent, { readonly _tag: "IntegrationResponsibilityBegan" }>
  >
  readonly integrationStarted: HashMap.HashMap<
    JournalPosition,
    Extract<WorkflowJournalEvent, { readonly _tag: "IntegrationStarted" }>
  >
  readonly firstRestartChoiceAppliedAt: HashMap.HashMap<AttemptId, JournalPosition>
  readonly targetPromotionHistory: TargetPromotionHistoryIndexes
}

/** Creates one fresh in-memory index for validating a trace prefix. */
export const makeIntegrationHistoryIndexes = (): IntegrationHistoryIndexes => ({
  acceptedExecutorResults: HashMap.empty(),
  acceptedExecutorResultPositions: HashMap.empty(),
  executorResponsibilitiesBegan: HashMap.empty(),
  integrationResponsibilitiesBegan: HashMap.empty(),
  integrationStarted: HashMap.empty(),
  firstRestartChoiceAppliedAt: HashMap.empty(),
  targetPromotionHistory: makeTargetPromotionHistoryIndexes(),
  targetLineageReadIntents: HashMap.empty(),
  targetLineageObservations: HashMap.empty(),
  integratorSessionFixed: HashMap.empty(),
  integratorSessionsByStartedAt: HashMap.empty(),
  integratorSessionsBySessionId: HashMap.empty(),
  integratorSessionsByCandidateResource: HashMap.empty(),
  integratorSuccessorSessionFixed: HashMap.empty(),
  integratorSuccessorSessionsByPredecessor: HashMap.empty(),
  integratorRunStarted: HashMap.empty(),
  integratorRunResults: HashMap.empty(),
  integratorRunCandidateGitReadIntents: HashMap.empty(),
  integratorRunCandidateGitObservations: HashMap.empty()
})

const mapGet = <Key, Value>(map: HashMap.HashMap<Key, Value>, key: Key): Value | undefined =>
  Option.getOrUndefined(HashMap.get(map, key))

interface IntegrationHistoryValidation<Indexes extends IntegrationHistoryIndexes = IntegrationHistoryIndexes> {
  readonly indexes: Indexes
  readonly detail: string | undefined
}

const invalidResponsibilityBeginning = (
  event: Extract<WorkflowJournalEvent, { readonly _tag: "IntegrationResponsibilityBegan" }>,
  indexes: IntegrationHistoryIndexes
): string | undefined => {
  const accepted = mapGet(indexes.acceptedExecutorResults, event.plannedAttempt.attemptId)
  const acceptedAt = mapGet(indexes.acceptedExecutorResultPositions, event.plannedAttempt.attemptId)
  const restartAt = mapGet(indexes.firstRestartChoiceAppliedAt, event.plannedAttempt.attemptId)
  const executorResponsibility = mapGet(indexes.executorResponsibilitiesBegan, event.plannedAttempt.attemptId)
  return restartAt !== undefined && acceptedAt !== undefined && restartAt < acceptedAt
    ? `integration responsibility for attempt ${event.plannedAttempt.attemptId} follows an Accepted result suppressed by prior Restart`
    : accepted === undefined ||
        !acceptedResultEquivalence(accepted, event.acceptedResult) ||
        executorResponsibility === undefined ||
        !plannedTaskAttemptEquivalence(executorResponsibility.plannedAttempt, event.plannedAttempt)
      ? `integration responsibility for attempt ${event.plannedAttempt.attemptId} has no prior matching accepted terminal result`
      : undefined
}

const invalidIntegrationStart = (
  event: Extract<WorkflowJournalEvent, { readonly _tag: "IntegrationStarted" }>,
  position: JournalPosition,
  indexes: IntegrationHistoryIndexes
): string | undefined => {
  const began = mapGet(indexes.integrationResponsibilitiesBegan, event.responsibilityBeganAt)
  return began === undefined ||
    event.responsibilityBeganAt >= position ||
    !integrationResponsibilityEquivalence(began, event)
    ? `integration start for attempt ${event.plannedAttempt.attemptId} has no exact earlier responsibility at ${event.responsibilityBeganAt}`
    : undefined
}

const invalidProviderAbsenceHistory = (
  prefix: ReadonlyArray<JournalRecord>,
  record: JournalRecord
): string | undefined => {
  const validation = validateProviderRunActivityAbsent(prefix, record)
  return validation._tag === "Valid"
    ? undefined
    : `Integration provider-activity absence is not justified by exact earlier history: ${validation.detail}`
}

const invalidQuarantineHistory = (
  prefix: ReadonlyArray<JournalRecord>,
  record: JournalRecord & { readonly event: Extract<WorkflowJournalEvent, { readonly _tag: "IntegrationQuarantined" }> }
): string | undefined => {
  const state = deriveIntegrationQuarantineState(prefix, record.event.correlation.sessionId)
  return state._tag === "Quarantined" && state.quarantineAt === record.position
    ? undefined
    : `Integration quarantine is not justified by exact earlier history: ${state._tag}`
}

const invalidQuarantineDirectionHistory = (
  prefix: ReadonlyArray<JournalRecord>,
  record: JournalRecord & {
    readonly event: Extract<WorkflowJournalEvent, { readonly _tag: "IntegrationQuarantineDirectionApplied" }>
  }
): string | undefined => {
  const state = deriveIntegrationQuarantineState(prefix, record.event.fingerprint.sessionId)
  return state._tag === "DirectionApplied" &&
    state.applicationAt === record.position &&
    state.quarantineAt === record.event.fingerprint.quarantineAt
    ? undefined
    : `Integration quarantine direction is not the exact first direction for its subject: ${state._tag}`
}

const isQuarantineRecord = (
  record: JournalRecord
): record is JournalRecord & {
  readonly event: Extract<WorkflowJournalEvent, { readonly _tag: "IntegrationQuarantined" }>
} => record.event._tag === "IntegrationQuarantined"

const isQuarantineDirectionRecord = (
  record: JournalRecord
): record is JournalRecord & {
  readonly event: Extract<WorkflowJournalEvent, { readonly _tag: "IntegrationQuarantineDirectionApplied" }>
} => record.event._tag === "IntegrationQuarantineDirectionApplied"

const invalidIntegrationQuarantineHistory = (
  record: JournalRecord,
  records: ReadonlyArray<JournalRecord>
): string | undefined => {
  if (
    record.event._tag !== "IntegrationProviderRunActivityAbsent" &&
    !isQuarantineRecord(record) &&
    !isQuarantineDirectionRecord(record)
  ) {
    return undefined
  }
  const prefix = records.filter(({ position }) => position <= record.position)
  if (record.event._tag === "IntegrationProviderRunActivityAbsent") {
    return invalidProviderAbsenceHistory(prefix, record)
  }
  if (isQuarantineRecord(record)) return invalidQuarantineHistory(prefix, record)
  if (isQuarantineDirectionRecord(record)) {
    return invalidQuarantineDirectionHistory(prefix, record)
  }
  return undefined
}

type TargetPromotionEvent = Extract<
  WorkflowJournalEvent,
  {
    readonly _tag:
      | "TargetPromotionIntended"
      | "TargetPromotionAttemptIntended"
      | "TargetPromotionObservedSuccess"
      | "TargetPromotionStale"
      | "TargetPromotionNonConvergence"
  }
>

const isTargetPromotionEvent = (event: WorkflowJournalEvent): event is TargetPromotionEvent =>
  event._tag === "TargetPromotionIntended" ||
  event._tag === "TargetPromotionAttemptIntended" ||
  event._tag === "TargetPromotionObservedSuccess" ||
  event._tag === "TargetPromotionStale" ||
  event._tag === "TargetPromotionNonConvergence"

export const invalidIntegrationHistoryEvent = <Indexes extends IntegrationHistoryIndexes>(
  record: JournalRecord,
  indexes: Indexes,
  records: ReadonlyArray<JournalRecord> = [record]
): IntegrationHistoryValidation<Indexes> => {
  const integrator = validateIntegratorHistoryEvent(record, indexes, records)
  if (integrator.handled) return { detail: integrator.issue, indexes: integrator.indexes }
  const event = record.event
  if (event._tag === "IntegrationResponsibilityBegan") {
    return {
      detail: invalidResponsibilityBeginning(event, indexes),
      indexes: {
        ...indexes,
        integrationResponsibilitiesBegan: setMapValue(indexes.integrationResponsibilitiesBegan, record.position, event)
      }
    }
  }
  if (event._tag === "IntegrationStarted") {
    return {
      detail: invalidIntegrationStart(event, record.position, indexes),
      indexes: { ...indexes, integrationStarted: setMapValue(indexes.integrationStarted, record.position, event) }
    }
  }
  const quarantineIssue = invalidIntegrationQuarantineHistory(record, records)
  if (quarantineIssue !== undefined) return { detail: quarantineIssue, indexes }
  if (!isTargetPromotionEvent(event)) return { detail: undefined, indexes }
  const validation = invalidTargetPromotionHistory(
    record,
    indexes.targetPromotionHistory,
    indexes.integratorRunCandidateGitObservations
  )
  return { detail: validation.detail, indexes: { ...indexes, targetPromotionHistory: validation.indexes } }
}
