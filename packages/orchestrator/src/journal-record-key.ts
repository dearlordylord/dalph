import type { AttemptId, OperationId, ProviderObservationId } from "./domain.js"
import { JournalRecordKey } from "./domain.js"

export const intentRecordKey = (operationId: OperationId): JournalRecordKey =>
  JournalRecordKey.make(`operation:${operationId}:intent`)

export const outcomeRecordKey = (operationId: OperationId): JournalRecordKey =>
  JournalRecordKey.make(`operation:${operationId}:outcome`)

export const attemptPlanRecordKey = (attemptId: AttemptId): JournalRecordKey =>
  JournalRecordKey.make(`attempt:${attemptId}:plan`)

export const providerObservationRequestRecordKey = (
  observationId: ProviderObservationId
): JournalRecordKey => JournalRecordKey.make(`provider-observation:${observationId}:request`)

export const taskWorkStartAcknowledgedRecordKey = (
  operationId: OperationId,
  observationId: ProviderObservationId
): JournalRecordKey => JournalRecordKey.make(`operation:${operationId}:task-work-start-acknowledged:${observationId}`)

export const taskWorkStartFailedRecordKey = (
  operationId: OperationId,
  observationId: ProviderObservationId
): JournalRecordKey => JournalRecordKey.make(`operation:${operationId}:task-work-start-failed:${observationId}`)

export const taskWorkSessionReportedRecordKey = (
  operationId: OperationId,
  observationId: ProviderObservationId
): JournalRecordKey => JournalRecordKey.make(`operation:${operationId}:task-work-session-reported:${observationId}`)

export const taskWorkSessionResultRecordKey = (
  observationId: ProviderObservationId
): JournalRecordKey => JournalRecordKey.make(`provider-observation:${observationId}:task-work-session-result`)

export const taskExecutionRequestReturnedRecordKey = (
  operationId: OperationId,
  observationId: ProviderObservationId
) => JournalRecordKey.make(`operation:${operationId}:task-execution-request-returned:${observationId}`)

export const taskExecutionRequestAttemptRecordKey = (
  operationId: OperationId
): JournalRecordKey => JournalRecordKey.make(`operation:${operationId}:task-execution-request-attempt`)

export const taskExecutionRequestFailedRecordKey = (
  operationId: OperationId,
  observationId: ProviderObservationId
): JournalRecordKey => JournalRecordKey.make(`operation:${operationId}:task-execution-request-failed:${observationId}`)

export const taskExecutionReportedRecordKey = (
  operationId: OperationId,
  observationId: ProviderObservationId
): JournalRecordKey => JournalRecordKey.make(`operation:${operationId}:task-execution-reported:${observationId}`)

export const taskExecutionObservationFailedRecordKey = (
  operationId: OperationId,
  observationId: ProviderObservationId
): JournalRecordKey =>
  JournalRecordKey.make(`operation:${operationId}:task-execution-observation-failed:${observationId}`)
