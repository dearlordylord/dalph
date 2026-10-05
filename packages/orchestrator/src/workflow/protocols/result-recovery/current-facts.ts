import { evaluateResultRecoveryRestartFacts } from "./restart-authorization.js"
import { evaluateResultRecoveryContinueFacts } from "./authorization.js"
import { Schema } from "effect"
import type { IntegrationTarget } from "@dalph/contracts"
import { OperationId } from "../../identity.js"
import {
  WorkflowOperation,
  makeTrackerGraphObservationOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTaskClaimObservationOperation,
  makeTaskWorktreeObservationOperation,
  makeTargetLineageObservationOperation
} from "../../registry/operation.js"
import type { JournalHistorySource } from "../../../workflow-journal/record-evidence.js"
import { journalRecordByKey, journalRecordsOfKind } from "../../../workflow-journal/record-evidence.js"
import { resultRecoveryDirectedRecordKey, outcomeRecordKey } from "../../../workflow-journal/record-key.js"
import { exactWorkflowRunTargetForRun } from "../../../workflow-journal/run-target.js"
import { recordedTaskAttemptPlanFor } from "../task-attempt-planning/journal-evidence.js"
import type { ResultRecoveryRequestId } from "./events.js"
import { resultRecoveryDirectionProblem } from "./protocol.js"

/** Derives five ordinary authority reads from one exact committed direction; nothing is persisted here. */
const resultRecoveryReadPlan = (
  records: JournalHistorySource,
  requestId: ResultRecoveryRequestId,
  integrationTarget: IntegrationTarget,
  direction: "ContinueRetainedAttempt" | "RestartTaskImplementation"
) => {
  const directed = journalRecordByKey(records, resultRecoveryDirectedRecordKey(requestId))
  if (
    directed?.event._tag !== "ResultRecoveryDirected" ||
    directed.event.direction !== direction ||
    (direction === "ContinueRetainedAttempt" && directed.event.subject._tag !== "RejectedResult")
  )
    return undefined
  if (resultRecoveryDirectionProblem(directed.event, requestId.runId, records, requestId) !== undefined)
    return undefined
  const plannedAttempt = directed.event.subject.plannedAttempt
  const plan = recordedTaskAttemptPlanFor(records, plannedAttempt)
  const target = exactWorkflowRunTargetForRun(records, requestId.runId)
  if (plan === undefined || target === undefined) return undefined
  const operationId = (boundary: string) => OperationId.make(`result-recovery:${requestId.nonce}:${boundary}`)
  const intents = [
    ...journalRecordsOfKind(records, "TaskTrackerReadIntentRecorded"),
    ...journalRecordsOfKind(records, "GitReadIntentRecorded")
  ]
    .filter(({ position }) => position > directed.position)
    .sort((left, right) => left.position - right.position)
  const sameOperation = Schema.toEquivalence(WorkflowOperation)
  type ReadOperation = Extract<WorkflowOperation, { readonly operationId: OperationId }>
  function retainedRead<T extends ReadOperation>(proposed: T): T
  function retainedRead(proposed: ReadOperation): ReadOperation {
    const retained = intents.findLast(({ event }) => {
      if (event._tag !== "TaskTrackerReadIntentRecorded" && event._tag !== "GitReadIntentRecorded") return false
      return sameOperation({ ...proposed, operationId: event.operation.operationId }, event.operation)
    })
    return retained !== undefined &&
      (retained.event._tag === "TaskTrackerReadIntentRecorded" || retained.event._tag === "GitReadIntentRecorded")
      ? retained.event.operation
      : proposed
  }
  const graph = retainedRead(
    makeTrackerGraphObservationOperation(
      direction === "ContinueRetainedAttempt"
        ? { _tag: "AttemptContinuation" }
        : { _tag: "AttemptRestartAuthorityCheck" },
      operationId("graph"),
      target,
      [plan.operationId],
      [plannedAttempt.taskId]
    )
  )
  const specification = retainedRead(
    makeTaskWorkSpecificationObservationOperation(operationId("specification"), target, plannedAttempt.taskId, [
      plan.operationId,
      graph.operationId
    ])
  )
  const claim = retainedRead(
    makeTaskClaimObservationOperation(operationId("claim"), target, plannedAttempt.taskId, [
      plan.operationId,
      graph.operationId,
      specification.operationId
    ])
  )
  const worktree = retainedRead(
    makeTaskWorktreeObservationOperation({
      operationId: operationId("worktree"),
      plannedAttempt,
      predecessorOperationIds: [claim.operationId]
    })
  )
  const lineage = retainedRead(
    makeTargetLineageObservationOperation({
      operationId: operationId("target-lineage"),
      plannedAttempt,
      integrationTarget,
      predecessorOperationIds: [worktree.operationId]
    })
  )
  return {
    plannedAttempt,
    requestId,
    operations: [graph, specification, claim, worktree, lineage] as const,
    witness: {
      activeTaskContinuationRead: {
        graphObservationOperationId: graph.operationId,
        taskWorkSpecificationObservationOperationId: specification.operationId,
        taskClaimObservationOperationId: claim.operationId
      },
      worktreeObservationOperationId: worktree.operationId,
      targetLineageObservationOperationId: lineage.operationId
    }
  }
}
export const resultRecoveryContinueReadPlan = (
  records: JournalHistorySource,
  requestId: ResultRecoveryRequestId,
  integrationTarget: IntegrationTarget
) => resultRecoveryReadPlan(records, requestId, integrationTarget, "ContinueRetainedAttempt")
export const resultRecoveryRestartReadPlan = (
  records: JournalHistorySource,
  requestId: ResultRecoveryRequestId,
  integrationTarget: IntegrationTarget
) => resultRecoveryReadPlan(records, requestId, integrationTarget, "RestartTaskImplementation")
export type ResultRecoveryContinueReadPlan = NonNullable<ReturnType<typeof resultRecoveryContinueReadPlan>>

/** Reuses pending operation identity on activation; each later read waits for the preceding outcome. */
export const nextResultRecoveryContinueRead = (records: JournalHistorySource, plan: ResultRecoveryContinueReadPlan) => {
  const evaluation = evaluateResultRecoveryContinueFacts(records, plan.requestId, plan.witness)
  if (evaluation._tag !== "Rejected" || evaluation.reason !== "MissingWitness") return undefined
  return plan.operations.find(
    (operation) => journalRecordByKey(records, outcomeRecordKey(operation.operationId)) === undefined
  )
}

/** Restart advances only missing fresh evidence; a refusal never authorizes another boundary read. */
export const nextResultRecoveryRestartRead = (
  records: JournalHistorySource,
  plan: ResultRecoveryContinueReadPlan,
  integrationTarget: IntegrationTarget
) => {
  const evaluation = evaluateResultRecoveryRestartFacts(records, plan.requestId, plan.witness, integrationTarget)
  if (evaluation._tag !== "Rejected" || evaluation.reason !== "MissingWitness") return undefined
  return plan.operations.find(
    (operation) => journalRecordByKey(records, outcomeRecordKey(operation.operationId)) === undefined
  )
}
