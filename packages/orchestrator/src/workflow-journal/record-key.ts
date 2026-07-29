import { type AttemptId } from "@dalph/contracts"
import { type ControlCommandId } from "../control/identity.js"
import { type OperationId } from "../workflow/identity.js"
import { JournalRecordKey } from "./identity.js"
import type { PlannedAttemptExecutorReportOrdinal } from "../workflow/protocols/planned-attempt-executor-work/events.js"

export const controlCommandRecordKey = (commandId: ControlCommandId): JournalRecordKey =>
  JournalRecordKey.make(`control-command:${commandId}`)

export const intentRecordKey = (operationId: OperationId): JournalRecordKey =>
  JournalRecordKey.make(`operation:${operationId}:intent`)

export const outcomeRecordKey = (operationId: OperationId): JournalRecordKey =>
  JournalRecordKey.make(`operation:${operationId}:outcome`)

export const attemptPlanRecordKey = (attemptId: AttemptId): JournalRecordKey =>
  JournalRecordKey.make(`attempt:${attemptId}:plan`)

export const plannedAttemptExecutorWorkResponsibilityBeganRecordKey = (attemptId: AttemptId): JournalRecordKey =>
  JournalRecordKey.make(`attempt:${attemptId}:executor-work-responsibility-began`)

export const plannedAttemptExecutorWorkReportedRecordKey = (
  attemptId: AttemptId,
  ordinal: PlannedAttemptExecutorReportOrdinal
): JournalRecordKey => JournalRecordKey.make(`attempt:${attemptId}:executor-work-report:${ordinal}`)
