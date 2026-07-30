import {
  plannedTaskAttemptEquivalence,
  type AcceptedResult,
  type AttemptId,
  type PlannedTaskAttempt,
  type RunId
} from "@dalph/contracts"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import type { WorkflowJournalEvent } from "../../workflow/registry/event.js"
import { integrationResponsibilityEquivalence } from "../../workflow/protocols/integration-admission/responsibility.js"

export interface IntegrationHistoryIndexes {
  readonly acceptedExecutorResults: Map<AttemptId, AcceptedResult>
  readonly executorResponsibilitiesBegan: ReadonlyMap<
    AttemptId,
    { readonly plannedAttempt: PlannedTaskAttempt; readonly position: JournalPosition }
  >
  readonly integrationResponsibilitiesBegan: Map<
    JournalPosition,
    Extract<WorkflowJournalEvent, { readonly _tag: "IntegrationResponsibilityBegan" }>
  >
}

const sameAcceptedResult = (left: AcceptedResult, right: AcceptedResult): boolean => left.commit === right.commit

const invalidResponsibilityBeginning = (
  event: Extract<WorkflowJournalEvent, { readonly _tag: "IntegrationResponsibilityBegan" }>,
  indexes: IntegrationHistoryIndexes
): string | undefined => {
  const accepted = indexes.acceptedExecutorResults.get(event.plannedAttempt.attemptId)
  const executorResponsibility = indexes.executorResponsibilitiesBegan.get(event.plannedAttempt.attemptId)
  return accepted === undefined ||
    !sameAcceptedResult(accepted, event.acceptedResult) ||
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

/** Validates causal integration links while advancing the fold's private index. */
export const invalidIntegrationHistoryEvent = (
  record: JournalRecord,
  indexes: IntegrationHistoryIndexes
): string | undefined => {
  const event = record.event
  if (event._tag === "IntegrationResponsibilityBegan") {
    const issue = invalidResponsibilityBeginning(event, indexes)
    indexes.integrationResponsibilitiesBegan.set(record.position, event)
    return issue
  }
  if (event._tag !== "IntegrationStarted") return undefined
  return invalidIntegrationStart(event, record.position, indexes)
}

export const invalidIntegrationRunBinding = (event: WorkflowJournalEvent, runId: RunId): string | undefined =>
  (event._tag === "IntegrationResponsibilityBegan" || event._tag === "IntegrationStarted") &&
  event.plannedAttempt.runId !== runId
    ? `integration work for attempt ${event.plannedAttempt.attemptId} binds run ${event.plannedAttempt.runId}`
    : undefined

export const validateIntegrationHistoryRecord = (
  record: JournalRecord,
  runId: RunId,
  indexes: IntegrationHistoryIndexes,
  recordIdentityIssue: (detail: string) => void,
  recordSemanticIssue: (detail: string) => void
): void => {
  const bindingIssue = invalidIntegrationRunBinding(record.event, runId)
  if (bindingIssue !== undefined) recordIdentityIssue(bindingIssue)
  const historyIssue = invalidIntegrationHistoryEvent(record, indexes)
  if (historyIssue !== undefined) recordSemanticIssue(historyIssue)
}
