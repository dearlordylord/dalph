import { PlannedTaskAttempt, RunId, TaskRevision } from "@dalph/contracts"
import { Schema } from "effect"
import { ActiveTaskClaim, TaskClaimObservation } from "../../../authorities/task-tracker/claim-mutation.js"
import { OperationId } from "../../identity.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { WorkflowActor } from "../../registry/actor.js"
import {
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorCommandProjectionOrdinal,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorStateObservationOrdinal
} from "../planned-attempt-executor-work/events.js"

/** Non-person identity bound to the Run whose journal can decide exact redelivery. */
export const AttemptChoiceRequestId = Schema.Struct({ nonce: Schema.NonEmptyString, runId: RunId }).pipe(
  Schema.brand("AttemptChoiceRequestId")
)
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

/** Durable intent recorded before Stop may need to request suspension from the executor. */
export const AttemptStoppageIntendedEvent = Schema.TaggedStruct("AttemptStoppageIntended", {
  initiatedBy: WorkflowActor.cases.DalphCoordinator,
  occurrenceClassification: Schema.Literal("InitiatedAction"),
  requestId: AttemptChoiceRequestId,
  subject: AttemptChoiceSubject,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type AttemptStoppageIntendedEvent = typeof AttemptStoppageIntendedEvent.Type

/** Exact journal provenance that proved no executor-owned writer remained. */
export const AttemptQuiescenceProof = Schema.TaggedUnion({
  CommandProjection: {
    commandOrdinal: PlannedAttemptExecutorCommandOrdinal,
    projectionOrdinal: PlannedAttemptExecutorCommandProjectionOrdinal
  },
  CommandResponse: { reportOrdinal: PlannedAttemptExecutorReportOrdinal },
  StateProjection: { observationOrdinal: PlannedAttemptExecutorStateObservationOrdinal }
})
export type AttemptQuiescenceProof = typeof AttemptQuiescenceProof.Type

/** Quiescence was proved and the exact implementation responsibility is no longer retained. */
export const AttemptImplementationAbandonedEvent = Schema.TaggedStruct("AttemptImplementationAbandoned", {
  expectedClaim: ActiveTaskClaim,
  initiatedBy: WorkflowActor.cases.DalphCoordinator,
  occurrenceClassification: Schema.Literal("InitiatedAction"),
  proof: AttemptQuiescenceProof,
  requestId: AttemptChoiceRequestId,
  subject: AttemptChoiceSubject,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type AttemptImplementationAbandonedEvent = typeof AttemptImplementationAbandonedEvent.Type

/** A fresh tracker read proved that Stop must leave an absent or foreign current claim unchanged. */
export const StoppedAttemptClaimNoReleaseObservedEvent = Schema.TaggedStruct("StoppedAttemptClaimNoReleaseObserved", {
  expectedClaim: ActiveTaskClaim,
  observation: TaskClaimObservation,
  observationOperationId: OperationId,
  occurrenceClassification: Schema.Literal("NonActionOccurrence"),
  requestId: AttemptChoiceRequestId,
  subject: AttemptChoiceSubject,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type StoppedAttemptClaimNoReleaseObservedEvent = typeof StoppedAttemptClaimNoReleaseObservedEvent.Type

export const attemptChoiceRunId = (subject: AttemptChoiceSubject): RunId => subject.plannedAttempt.runId
