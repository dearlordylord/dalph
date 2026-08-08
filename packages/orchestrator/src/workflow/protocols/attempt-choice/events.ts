import type { RunId } from "@dalph/contracts"
import { PlannedTaskAttempt, TaskRevision } from "@dalph/contracts"
import { Schema } from "effect"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { WorkflowActor } from "../../registry/actor.js"

/** Non-person identity of one exactly redeliverable Continue-or-Stop request. */
export const AttemptChoiceRequestId = Schema.NonEmptyString.pipe(Schema.brand("AttemptChoiceRequestId"))
export type AttemptChoiceRequestId = typeof AttemptChoiceRequestId.Type

export const AttemptChoice = Schema.Literals(["ContinueExistingAttempt", "StopTaskImplementation"])
export type AttemptChoice = typeof AttemptChoice.Type

/** The immutable attempt and changed authored fingerprint governed by one choice. */
export const AttemptChoiceSubject = Schema.Struct({
  observedTaskRevision: TaskRevision,
  plannedAttempt: PlannedTaskAttempt
}).check(
  Schema.makeFilter((subject) =>
    subject.observedTaskRevision === subject.plannedAttempt.taskRevision
      ? "an attempt choice requires distinct planned and observed task fingerprints"
      : undefined
  )
)
export type AttemptChoiceSubject = typeof AttemptChoiceSubject.Type

/** Operator durably chose how one exact pre-integration attempt may proceed. */
export const AttemptChoiceAppliedEvent = Schema.TaggedStruct("AttemptChoiceApplied", {
  choice: AttemptChoice,
  initiatedBy: WorkflowActor.cases.Operator,
  occurrenceClassification: Schema.Literal("InitiatedAction"),
  requestId: AttemptChoiceRequestId,
  subject: AttemptChoiceSubject,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type AttemptChoiceAppliedEvent = typeof AttemptChoiceAppliedEvent.Type

export const attemptChoiceRunId = (subject: AttemptChoiceSubject): RunId => subject.plannedAttempt.runId
