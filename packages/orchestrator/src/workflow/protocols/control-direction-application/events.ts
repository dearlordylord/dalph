import { Schema } from "effect"
import { RunId, TaskId } from "@dalph/contracts"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { WorkflowActor } from "../../registry/actor.js"

/** One exact Run or task whose future workflow direction the Operator changed. */
export const ControlDirectionSubject = Schema.TaggedUnion({
  Run: { runId: RunId },
  Task: { runId: RunId, taskId: TaskId }
})
export type ControlDirectionSubject = typeof ControlDirectionSubject.Type

export const ControlDirection = Schema.Literals(["Pause", "Unpause"])
export type ControlDirection = typeof ControlDirection.Type

/** Monotonic position among one Run's durably applied Pause and Unpause directions. */
export const ControlDirectionApplicationOrdinal = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).pipe(
  Schema.brand("ControlDirectionApplicationOrdinal")
)
export type ControlDirectionApplicationOrdinal = typeof ControlDirectionApplicationOrdinal.Type

/** Operator applied one Pause or Unpause direction to the exact subject. */
export const ControlDirectionAppliedEvent = Schema.TaggedStruct("ControlDirectionApplied", {
  direction: ControlDirection,
  initiatedBy: WorkflowActor.cases.Operator,
  occurrenceClassification: Schema.Literal("InitiatedAction"),
  ordinal: ControlDirectionApplicationOrdinal,
  subject: ControlDirectionSubject,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type ControlDirectionAppliedEvent = typeof ControlDirectionAppliedEvent.Type

export const controlDirectionRunId = (subject: ControlDirectionSubject): RunId => subject.runId
