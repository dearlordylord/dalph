import { RunId } from "@dalph/contracts"
import { Schema } from "effect"

export const RestartFixtureInput = Schema.Struct({
  journalDatabase: Schema.String,
  label: Schema.String,
  root: Schema.String,
  taskWorkCapacity: Schema.Int
})
export type RestartFixtureInput = typeof RestartFixtureInput.Type

export const RestartChildStarted = Schema.TaggedStruct("RestartChildStarted", { label: Schema.String, pid: Schema.Int })
export const RecoveryReconstructed = Schema.TaggedStruct("RecoveryReconstructed", {
  acceptedPosition: Schema.Int,
  initialPolicyTaskWorkCapacity: Schema.Int,
  label: Schema.String,
  responsibilities: Schema.Array(Schema.String),
  runId: RunId
})
export const OperationSelected = Schema.TaggedStruct("OperationSelected", {
  operationId: Schema.String,
  operationTag: Schema.String,
  targetIssueNumber: Schema.Int
})
export const GithubReadStarted = Schema.TaggedStruct("GithubReadStarted", { label: Schema.String })
export const HostCompleted = Schema.TaggedStruct("HostCompleted", {
  label: Schema.String,
  runId: RunId,
  selectionTag: Schema.String
})
export const RestartFixtureFailed = Schema.TaggedStruct("RestartFixtureFailed", { detail: Schema.String })
export const RestartFixtureEvent = Schema.Union([
  RestartChildStarted,
  RecoveryReconstructed,
  OperationSelected,
  GithubReadStarted,
  HostCompleted,
  RestartFixtureFailed
])
export type RestartFixtureEvent = typeof RestartFixtureEvent.Type
