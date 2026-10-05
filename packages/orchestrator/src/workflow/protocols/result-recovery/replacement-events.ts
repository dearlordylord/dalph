import { IntegrationTarget, PlannedAttemptExecutorWriterCustody, plannedTaskAttemptEquivalence } from "@dalph/contracts"
import { Schema } from "effect"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { WorkflowActor } from "../../registry/actor.js"
import { WorkflowOperation } from "../../registry/operation.js"
import { PlannedAttemptContinuationWitness } from "../planned-attempt-continuation/events.js"
import { ResultRecoveryRequestId, ResultRecoverySubject } from "./events.js"

/** One atomic workflow record retains the rejected predecessor and acknowledges its exact new plan. */
export const ResultRecoveryAttemptReplacedEvent = Schema.TaggedStruct("ResultRecoveryAttemptReplaced", {
  requestId: ResultRecoveryRequestId,
  subject: ResultRecoverySubject,
  integrationTarget: IntegrationTarget,
  witness: PlannedAttemptContinuationWitness,
  writerCustody: Schema.optionalKey(PlannedAttemptExecutorWriterCustody.cases.Stopped),
  successorPlan: WorkflowOperation.cases.RecordTaskAttemptPlan,
  initiatedBy: WorkflowActor.cases.DalphCoordinator,
  occurrenceClassification: Schema.Literal("InitiatedAction"),
  version: Schema.Literal(workflowJournalEventVersion)
}).check(
  Schema.makeFilter((event) => {
    const prior = event.subject.plannedAttempt
    const next = event.successorPlan.plannedAttempt
    if (event.writerCustody !== undefined && !plannedTaskAttemptEquivalence(event.writerCustody.plannedAttempt, prior))
      return "writer custody must name the exact retained predecessor plan"
    if (event.requestId.runId !== prior.runId || next.runId !== prior.runId || next.taskId !== prior.taskId)
      return "result replacement must name one exact Run and task"
    if (next.attemptId === prior.attemptId || next.branch === prior.branch || next.worktree === prior.worktree)
      return "result replacement must preserve its predecessor and use a distinct attempt, branch and worktree"
    const reads = [
      event.witness.activeTaskContinuationRead.graphObservationOperationId,
      event.witness.activeTaskContinuationRead.taskWorkSpecificationObservationOperationId,
      event.witness.activeTaskContinuationRead.taskClaimObservationOperationId,
      event.witness.worktreeObservationOperationId,
      event.witness.targetLineageObservationOperationId
    ]
    return reads.every((id) => event.successorPlan.predecessorOperationIds.includes(id))
      ? undefined
      : "result replacement plan must name every fresh authority read"
  })
)
export type ResultRecoveryAttemptReplacedEvent = typeof ResultRecoveryAttemptReplacedEvent.Type
