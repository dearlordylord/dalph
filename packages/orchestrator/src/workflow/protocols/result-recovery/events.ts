import { PlannedAttemptContinuationWitness } from "../planned-attempt-continuation/events.js"
import { PlannedTaskAttempt, RunId } from "@dalph/contracts"
import { Schema } from "effect"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { WorkflowActor } from "../../registry/actor.js"
import { PlannedAttemptExecutorReportOrdinal } from "../planned-attempt-executor-work/events.js"

/** Exact redeliverable Operator input, distinct from instruction-change choices. */
export const ResultRecoveryRequestId = Schema.Struct({ nonce: Schema.NonEmptyString, runId: RunId }).pipe(
  Schema.brand("ResultRecoveryRequestId")
)
export type ResultRecoveryRequestId = typeof ResultRecoveryRequestId.Type

/** The accepted report selected by the Operator; no provider-private identity crosses this boundary. */
export const ResultRecoverySubject = Schema.TaggedUnion({
  RejectedResult: { plannedAttempt: PlannedTaskAttempt, reportOrdinal: PlannedAttemptExecutorReportOrdinal },
  HistoricalUnknownFailure: { plannedAttempt: PlannedTaskAttempt, reportOrdinal: PlannedAttemptExecutorReportOrdinal }
})
export type ResultRecoverySubject = typeof ResultRecoverySubject.Type

export const ResultRecoveryDirection = Schema.Literals(["ContinueRetainedAttempt", "RestartTaskImplementation"])
export type ResultRecoveryDirection = typeof ResultRecoveryDirection.Type

const directionBindingProblem = (request: {
  readonly direction: ResultRecoveryDirection
  readonly requestId: ResultRecoveryRequestId
  readonly subject: ResultRecoverySubject
}): string | undefined => {
  if (request.requestId.runId !== request.subject.plannedAttempt.runId) return "recovery request names another Run"
  if (request.subject._tag === "HistoricalUnknownFailure" && request.direction !== "RestartTaskImplementation")
    return "historical unknown failure permits Restart only"
  return undefined
}

export const ApplyResultRecoveryRequest = Schema.Struct({
  direction: ResultRecoveryDirection,
  requestId: ResultRecoveryRequestId,
  subject: ResultRecoverySubject
}).check(Schema.makeFilter(directionBindingProblem))
export type ApplyResultRecoveryRequest = typeof ApplyResultRecoveryRequest.Type

/** Operator direction precedes fresh authority checks and executor effects; it is not a new result cycle. */
export const ResultRecoveryDirectedEvent = Schema.TaggedStruct("ResultRecoveryDirected", {
  direction: ResultRecoveryDirection,
  requestId: ResultRecoveryRequestId,
  subject: ResultRecoverySubject,
  initiatedBy: WorkflowActor.cases.Operator,
  occurrenceClassification: Schema.Literal("InitiatedAction"),
  version: Schema.Literal(workflowJournalEventVersion)
}).check(Schema.makeFilter(directionBindingProblem))
export type ResultRecoveryDirectedEvent = typeof ResultRecoveryDirectedEvent.Type

/** One durable permission for a new retained-work result cycle, bound to its applied direction. */
export const ResultRecoveryContinueAuthorizedEvent = Schema.TaggedStruct("ResultRecoveryContinueAuthorized", {
  requestId: ResultRecoveryRequestId,
  plannedAttempt: PlannedTaskAttempt,
  witness: PlannedAttemptContinuationWitness,
  version: Schema.Literal(workflowJournalEventVersion)
}).check(
  Schema.makeFilter((event) =>
    event.requestId.runId === event.plannedAttempt.runId ? undefined : "result recovery authorization names another Run"
  )
)
export type ResultRecoveryContinueAuthorizedEvent = typeof ResultRecoveryContinueAuthorizedEvent.Type
