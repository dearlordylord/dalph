import type { AttemptId, ControlCommandId, OperationId } from "./domain.js"
import { JournalRecordKey } from "./domain.js"
import type { PlannedAttemptExecutorReportOrdinal } from "./planned-attempt-executor-journal.js"

export const controlCommandRecordKey = (
  commandId: ControlCommandId
): JournalRecordKey => JournalRecordKey.make(`control-command:${commandId}`)

export const intentRecordKey = (operationId: OperationId): JournalRecordKey =>
  JournalRecordKey.make(`operation:${operationId}:intent`)

export const outcomeRecordKey = (operationId: OperationId): JournalRecordKey =>
  JournalRecordKey.make(`operation:${operationId}:outcome`)

export const attemptPlanRecordKey = (attemptId: AttemptId): JournalRecordKey =>
  JournalRecordKey.make(`attempt:${attemptId}:plan`)

export const plannedAttemptExecutorWorkStartedRecordKey = (
  attemptId: AttemptId
): JournalRecordKey => JournalRecordKey.make(`attempt:${attemptId}:executor-work-started`)

export const plannedAttemptExecutorWorkReportedRecordKey = (
  attemptId: AttemptId,
  ordinal: PlannedAttemptExecutorReportOrdinal
): JournalRecordKey => JournalRecordKey.make(`attempt:${attemptId}:executor-work-report:${ordinal}`)
