import { type AttemptId } from "@dalph/contracts"
import { type OperationId } from "../workflow/identity.js"
import { JournalRecordKey } from "./identity.js"
import type { PlannedAttemptExecutorReportOrdinal } from "../workflow/protocols/planned-attempt-executor-work/events.js"
import type { RunPolicyRevision } from "../control/policy.js"
import type { ControlDirectionApplicationOrdinal } from "../workflow/protocols/control-direction-application/events.js"
import type { TaskClaimReacquisitionDirectionOrdinal } from "../workflow/protocols/task-claim-reacquisition/events.js"

export const workflowRunBeganRecordKey = JournalRecordKey.make("run:began")

export const workflowRunTerminatedRecordKey = JournalRecordKey.make("run:terminated")

export const controlDirectionAppliedRecordKey = (ordinal: ControlDirectionApplicationOrdinal): JournalRecordKey =>
  JournalRecordKey.make(`control-direction:${ordinal}:applied`)

export const taskClaimReacquisitionDirectedRecordKey = (
  ordinal: TaskClaimReacquisitionDirectionOrdinal
): JournalRecordKey => JournalRecordKey.make(`task-claim-reacquisition:${ordinal}:directed`)

export const taskWorkCapacityPolicyRecordKey = (revision: RunPolicyRevision): JournalRecordKey =>
  JournalRecordKey.make(`run-policy:${revision}:task-work-capacity`)

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

export const integrationResponsibilityBeganRecordKey = (attemptId: AttemptId): JournalRecordKey =>
  JournalRecordKey.make(`attempt:${attemptId}:integration-responsibility-began`)

export const integrationStartedRecordKey = (attemptId: AttemptId): JournalRecordKey =>
  JournalRecordKey.make(`attempt:${attemptId}:integration-started`)
