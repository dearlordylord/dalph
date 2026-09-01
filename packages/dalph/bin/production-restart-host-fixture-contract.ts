import { RunId, TaskId } from "@dalph/contracts"
import {
  GithubIssueTarget as GithubIssueTargetSchema,
  JournalDatabaseLocator,
  JournalPosition,
  OperationId,
  ProductionRunSelection,
  RunControlPolicy,
  TaskClaimCheckSelected as TaskClaimCheckSelectedSchema,
  TaskWorkCapacity,
  TrackerTarget,
  WorkflowResponsibilityEntry
} from "@dalph/orchestrator"
import { Schema } from "effect"

export const RestartFixtureInput = Schema.Struct({
  journalDatabase: JournalDatabaseLocator,
  label: Schema.String,
  root: Schema.String,
  runId: RunId,
  responsibilityOperationId: OperationId,
  target: GithubIssueTargetSchema,
  taskId: TaskId,
  taskWorkCapacity: TaskWorkCapacity
})
export type RestartFixtureInput = typeof RestartFixtureInput.Type

/** The operating-system process identity emitted by one restart fixture child. */
export const RestartChildProcessId = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).pipe(
  Schema.brand("RestartChildProcessId")
)
export type RestartChildProcessId = typeof RestartChildProcessId.Type

export const RestartChildStarted = Schema.TaggedStruct("RestartChildStarted", {
  label: Schema.String,
  pid: RestartChildProcessId
})
export const RecoveryReconstructed = Schema.TaggedStruct("RecoveryReconstructed", {
  acceptedPosition: JournalPosition,
  label: Schema.String,
  policy: RunControlPolicy,
  responsibilities: Schema.Array(WorkflowResponsibilityEntry),
  runId: RunId
})
export const TaskClaimCheckSelected = TaskClaimCheckSelectedSchema
export const GithubReadStarted = Schema.TaggedStruct("GithubReadStarted", {
  operationId: OperationId,
  target: TrackerTarget
})
export const HostCompleted = Schema.TaggedStruct("HostCompleted", {
  label: Schema.String,
  selection: ProductionRunSelection
})
export const RestartFixtureFailed = Schema.TaggedStruct("RestartFixtureFailed", { detail: Schema.String })
export const RestartFixtureEvent = Schema.Union([
  RestartChildStarted,
  RecoveryReconstructed,
  TaskClaimCheckSelected,
  GithubReadStarted,
  HostCompleted,
  RestartFixtureFailed
])
export type RestartFixtureEvent = typeof RestartFixtureEvent.Type
