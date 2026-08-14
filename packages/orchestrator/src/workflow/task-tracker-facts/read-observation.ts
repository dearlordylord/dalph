import { Schema } from "effect"
import { OperationId } from "../identity.js"
import { TrackerAdapterReadFailureReason } from "../../authorities/task-tracker/graph-reader.js"
import { TrackerTarget } from "../../authorities/task-tracker/target.js"

/** A complete graph read could not establish current tracker facts. */
export const TaskTrackerFactsReadFailure = Schema.TaggedUnion({
  FixtureReadError: { detail: Schema.String },
  GraphProjectionError: { detail: Schema.String },
  TrackerAdapterReadError: { detail: Schema.String, reason: TrackerAdapterReadFailureReason },
  TrackerReadError: { detail: Schema.String }
})

/** The tracker-read protocol durably recorded why one graph read was unreadable. */
export const TaskTrackerFactsReadFailed = Schema.TaggedStruct("TaskTrackerFactsReadFailed", {
  completeness: Schema.Literal("Unreadable"),
  failure: TaskTrackerFactsReadFailure,
  operationId: OperationId,
  target: TrackerTarget
})
export type TaskTrackerFactsReadFailed = typeof TaskTrackerFactsReadFailed.Type

/** A durable unreadable graph fact must defer a retry until later accepted facts reconcile it. */
export class TaskTrackerFactsReadUnavailable extends Schema.TaggedError<TaskTrackerFactsReadUnavailable>()(
  "TaskTrackerFactsReadUnavailable",
  { observation: TaskTrackerFactsReadFailed }
) {}
