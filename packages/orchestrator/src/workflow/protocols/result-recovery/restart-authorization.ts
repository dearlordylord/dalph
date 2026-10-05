import { IntegrationTarget, plannedTaskAttemptEquivalence } from "@dalph/contracts"
import { Schema } from "effect"
import type { JournalHistorySource } from "../../../workflow-journal/record-evidence.js"
import { journalRecordByKey, journalRecordsForAttemptKind } from "../../../workflow-journal/record-evidence.js"
import {
  intentRecordKey,
  outcomeRecordKey,
  resultRecoveryDirectedRecordKey
} from "../../../workflow-journal/record-key.js"
import { evaluatePlannedAttemptCurrentTrackerAndWorktreeFacts } from "../planned-attempt-continuation/authorization-evaluation.js"
import type { PlannedAttemptContinuationWitness } from "../planned-attempt-continuation/events.js"
import type {
  ContinuationAuthorizationReason,
  ContinuationAuthorizationWitness
} from "../planned-attempt-continuation/protocol.js"
import type { ResultRecoveryRequestId } from "./events.js"
import { resultRecoveryDirectionProblem } from "./protocol.js"

const reject = (
  witness: ContinuationAuthorizationWitness,
  reason: ContinuationAuthorizationReason,
  detail: string
) => ({ _tag: "Rejected" as const, witness, reason, detail })

/** Fresh replacement facts only: this neither allocates a successor nor grants executor effects. */
export const evaluateResultRecoveryRestartFacts = (
  records: JournalHistorySource,
  requestId: ResultRecoveryRequestId,
  witness: PlannedAttemptContinuationWitness,
  integrationTarget: IntegrationTarget
) => {
  const directed = journalRecordByKey(records, resultRecoveryDirectedRecordKey(requestId))
  if (directed?.event._tag !== "ResultRecoveryDirected" || directed.event.direction !== "RestartTaskImplementation")
    return { _tag: "DirectionRejected" as const, detail: "no exact applied result recovery Restart direction" }
  const problem = resultRecoveryDirectionProblem(directed.event, requestId.runId, records, requestId)
  if (problem !== undefined) return { _tag: "DirectionRejected" as const, detail: problem }
  const plannedAttempt = directed.event.subject.plannedAttempt
  for (const [operationId, boundary] of [
    [witness.activeTaskContinuationRead.graphObservationOperationId, "ActiveTaskContinuationGraph"],
    [
      witness.activeTaskContinuationRead.taskWorkSpecificationObservationOperationId,
      "ActiveTaskContinuationSpecification"
    ],
    [witness.activeTaskContinuationRead.taskClaimObservationOperationId, "ActiveTaskContinuationClaim"],
    [witness.worktreeObservationOperationId, "PlannedAttemptWorktree"],
    [witness.targetLineageObservationOperationId, "PlannedAttemptTargetLineage"]
  ] as const) {
    const intent = journalRecordByKey(records, intentRecordKey(operationId))
    if (intent !== undefined && intent.position <= directed.position)
      return reject(boundary, "StaleWitness", "Restart requires reads started after its exact applied direction")
  }
  const specification = journalRecordByKey(
    records,
    outcomeRecordKey(witness.activeTaskContinuationRead.taskWorkSpecificationObservationOperationId)
  )
  const taskRevision =
    specification?.event._tag === "TaskTrackerFactsObserved" &&
    specification.event.observation._tag === "FocusedTaskWorkSpecificationFacts"
      ? specification.event.observation.factFamily.fingerprint
      : plannedAttempt.taskRevision
  const current = evaluatePlannedAttemptCurrentTrackerAndWorktreeFacts(
    records,
    plannedAttempt,
    witness,
    directed.position,
    taskRevision,
    "Restart"
  )
  if (current._tag === "Rejected") return current
  const operationId = witness.targetLineageObservationOperationId
  const intent = journalRecordByKey(records, intentRecordKey(operationId))
  const outcome = journalRecordByKey(records, outcomeRecordKey(operationId))
  if (intent === undefined || outcome === undefined)
    return reject("PlannedAttemptTargetLineage", "MissingWitness", "Restart requires a newly observed target head")
  if (intent.position <= current.outcome.position || outcome.position <= intent.position)
    return reject(
      "PlannedAttemptTargetLineage",
      "LaterWitness",
      "Restart target read must follow its retained worktree proof"
    )
  if (
    intent.event._tag !== "GitReadIntentRecorded" ||
    intent.event.operation._tag !== "ReadTargetLineage" ||
    !plannedTaskAttemptEquivalence(intent.event.operation.plannedAttempt, plannedAttempt) ||
    !Schema.toEquivalence(IntegrationTarget)(intent.event.operation.integrationTarget, integrationTarget) ||
    !intent.event.operation.predecessorOperationIds.includes(witness.worktreeObservationOperationId) ||
    outcome.event._tag !== "TargetLineageObserved" ||
    !plannedTaskAttemptEquivalence(outcome.event.plannedAttempt, plannedAttempt) ||
    outcome.event.observation.plannedBaseSha !== plannedAttempt.baseSha
  )
    return reject(
      "PlannedAttemptTargetLineage",
      "WrongAttemptWitness",
      "Restart target read must name its exact target and retained attempt"
    )
  if (
    Array.from(journalRecordsForAttemptKind(records, plannedAttempt.attemptId, "TargetLineageObserved")).some(
      (record) => record.position > outcome.position
    )
  )
    return reject(
      "PlannedAttemptTargetLineage",
      "StaleWitness",
      "Restart target head was superseded by a later observation"
    )
  return {
    _tag: "FreshRestartFactsVerified" as const,
    plannedAttempt,
    taskRevision,
    baseSha: outcome.event.observation.targetHeadSha,
    witness,
    custody:
      directed.event.subject._tag === "RejectedResult"
        ? ("AcceptedStoppedRejection" as const)
        : ("RequiresExecutorReconciliation" as const)
  }
}
