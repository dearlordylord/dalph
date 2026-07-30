import { Schema } from "effect"
import { RunId, TaskId } from "@dalph/contracts"
import { AuthenticatedOperatorIdentity, ControlCommandId } from "./identity.js"
import { workflowJournalEventVersion } from "../workflow/kernel/event.js"

/**
 * A transport-decoded request to change one run's requested pause direction.
 * It records no derived pause phase and selects no workflow action.
 */
export const ControlCommandRequest = Schema.TaggedUnion({
  RequestRunPause: { commandId: ControlCommandId, runId: RunId },
  RequestRunUnpause: { commandId: ControlCommandId, runId: RunId },
  RequestTaskClaimReacquisition: { commandId: ControlCommandId, runId: RunId, taskId: TaskId },
  RequestTaskPause: { commandId: ControlCommandId, runId: RunId, taskId: TaskId },
  RequestTaskUnpause: { commandId: ControlCommandId, runId: RunId, taskId: TaskId }
})
export type ControlCommandRequest = typeof ControlCommandRequest.Type

/**
 * One immutable user command after the authenticating transport binds the
 * exact operator who requested it.
 */
export const ControlCommand = Schema.TaggedUnion({
  RequestRunPause: { commandId: ControlCommandId, operatorId: AuthenticatedOperatorIdentity, runId: RunId },
  RequestRunUnpause: { commandId: ControlCommandId, operatorId: AuthenticatedOperatorIdentity, runId: RunId },
  RequestTaskClaimReacquisition: {
    commandId: ControlCommandId,
    operatorId: AuthenticatedOperatorIdentity,
    runId: RunId,
    taskId: TaskId
  },
  RequestTaskPause: {
    commandId: ControlCommandId,
    operatorId: AuthenticatedOperatorIdentity,
    runId: RunId,
    taskId: TaskId
  },
  RequestTaskUnpause: {
    commandId: ControlCommandId,
    operatorId: AuthenticatedOperatorIdentity,
    runId: RunId,
    taskId: TaskId
  }
})
export type ControlCommand = typeof ControlCommand.Type

/** Records the exact authenticated command before later workflow selection. */
export const ControlCommandRecordedEvent = Schema.TaggedStruct("ControlCommandRecorded", {
  command: ControlCommand,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type ControlCommandRecordedEvent = typeof ControlCommandRecordedEvent.Type
