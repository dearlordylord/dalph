import {
  plannedTaskAttemptEquivalence,
  type AcceptedResult,
  type AttemptId,
  type PlannedTaskAttempt
} from "@dalph/contracts"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import type { WorkflowJournalEvent } from "../../workflow/registry/event.js"
import {
  acceptedResultEquivalence,
  integrationResponsibilityEquivalence
} from "../../workflow/protocols/integration-admission/responsibility.js"
import { invalidTargetPromotionHistory, type TargetPromotionHistoryIndexes } from "./target-promotion-history.js"
import { setMapValue } from "./integration-history-run-binding.js"
import { type IntegratorHistoryIndexes, validateIntegratorHistoryEvent } from "./integrator-history.js"
import { deriveIntegrationQuarantineState } from "../../workflow/protocols/integration-quarantine/state.js"
import { validateProviderRunActivityAbsent } from "../../workflow/protocols/integration-quarantine/provider-failure.js"

export interface IntegrationHistoryIndexes extends IntegratorHistoryIndexes {
  readonly acceptedExecutorResults: Map<AttemptId, AcceptedResult>
  readonly acceptedExecutorResultPositions: Map<AttemptId, JournalPosition>
  readonly executorResponsibilitiesBegan: ReadonlyMap<
    AttemptId,
    { readonly plannedAttempt: PlannedTaskAttempt; readonly position: JournalPosition }
  >
  readonly integrationResponsibilitiesBegan: Map<
    JournalPosition,
    Extract<WorkflowJournalEvent, { readonly _tag: "IntegrationResponsibilityBegan" }>
  >
  readonly integrationStarted: Map<
    JournalPosition,
    Extract<WorkflowJournalEvent, { readonly _tag: "IntegrationStarted" }>
  >
  readonly firstRestartChoiceAppliedAt: Map<AttemptId, JournalPosition>
  readonly targetPromotionHistory: TargetPromotionHistoryIndexes
}

const invalidResponsibilityBeginning = (
  event: Extract<WorkflowJournalEvent, { readonly _tag: "IntegrationResponsibilityBegan" }>,
  indexes: IntegrationHistoryIndexes
): string | undefined => {
  const accepted = indexes.acceptedExecutorResults.get(event.plannedAttempt.attemptId)
  const acceptedAt = indexes.acceptedExecutorResultPositions.get(event.plannedAttempt.attemptId)
  const restartAt = indexes.firstRestartChoiceAppliedAt.get(event.plannedAttempt.attemptId)
  const executorResponsibility = indexes.executorResponsibilitiesBegan.get(event.plannedAttempt.attemptId)
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
  const began = indexes.integrationResponsibilitiesBegan.get(event.responsibilityBeganAt)
  return began === undefined ||
    event.responsibilityBeganAt >= position ||
    !integrationResponsibilityEquivalence(began, event)
    ? `integration start for attempt ${event.plannedAttempt.attemptId} has no exact earlier responsibility at ${event.responsibilityBeganAt}`
    : undefined
}

const invalidIntegrationQuarantineHistory = (
  record: JournalRecord,
  records: ReadonlyArray<JournalRecord>
): string | undefined => {
  const event = record.event
  if (
    event._tag !== "IntegrationProviderRunActivityAbsent" &&
    event._tag !== "IntegrationQuarantined" &&
    event._tag !== "IntegrationQuarantineDirectionApplied"
  ) {
    return undefined
  }
  const prefix = records.filter(({ position }) => position <= record.position)
  if (event._tag === "IntegrationProviderRunActivityAbsent") {
    const validation = validateProviderRunActivityAbsent(prefix, record)
    return validation._tag === "Valid"
      ? undefined
      : `Integration provider-activity absence is not justified by exact earlier history: ${validation.detail}`
  }
  const sessionId = event._tag === "IntegrationQuarantined" ? event.correlation.sessionId : event.fingerprint.sessionId
  const state = deriveIntegrationQuarantineState(prefix, sessionId)
  if (event._tag === "IntegrationQuarantined") {
    return state._tag === "Quarantined" && state.quarantineAt === record.position
      ? undefined
      : `Integration quarantine is not justified by exact earlier history: ${state._tag}`
  }
  return state._tag === "DirectionApplied" &&
    state.applicationAt === record.position &&
    state.quarantineAt === event.fingerprint.quarantineAt
    ? undefined
    : `Integration quarantine direction is not the exact first direction for its subject: ${state._tag}`
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

export const invalidIntegrationHistoryEvent = (
  record: JournalRecord,
  indexes: IntegrationHistoryIndexes,
  records: ReadonlyArray<JournalRecord> = [record]
): string | undefined => {
  const integrator = validateIntegratorHistoryEvent(record, indexes, records)
  if (integrator.handled) return integrator.issue
  const event = record.event
  if (event._tag === "IntegrationResponsibilityBegan") {
    setMapValue(indexes.integrationResponsibilitiesBegan, record.position, event)
    return invalidResponsibilityBeginning(event, indexes)
  }
  if (event._tag === "IntegrationStarted") {
    setMapValue(indexes.integrationStarted, record.position, event)
    return invalidIntegrationStart(event, record.position, indexes)
  }
  const quarantineIssue = invalidIntegrationQuarantineHistory(record, records)
  if (quarantineIssue !== undefined) return quarantineIssue
  return isTargetPromotionEvent(event)
    ? invalidTargetPromotionHistory(
        record,
        indexes.targetPromotionHistory,
        indexes.integratorRunCandidateGitObservations
      )
    : undefined
}
