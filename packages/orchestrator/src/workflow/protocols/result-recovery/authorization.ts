import type { PlannedAttemptExecutorCommandIntendedEvent } from "../planned-attempt-executor-work/events.js"
import { plannedTaskAttemptEquivalence } from "@dalph/contracts"
import type { ResultRecoveryContinueAuthorizedEvent } from "./events.js"
import { ResultRecoveryRequestId } from "./events.js"
import type { JournalHistorySource } from "../../../workflow-journal/record-evidence.js"
import { journalRecordByKey, journalRecordsForAttemptKind } from "../../../workflow-journal/record-evidence.js"
import {
  intentRecordKey,
  resultRecoveryDirectedRecordKey,
  resultRecoveryContinueAuthorizedRecordKey
} from "../../../workflow-journal/record-key.js"
import { evaluatePlannedAttemptCurrentFactsAuthorization } from "../planned-attempt-continuation/authorization-evaluation.js"
import type { PlannedAttemptContinuationWitness } from "../planned-attempt-continuation/events.js"
import { resultRecoveryDirectionProblem } from "./protocol.js"

/** Inspect current facts only; this result grants no cycle reset or executor effect. */
export const evaluateResultRecoveryContinueFacts = (
  records: JournalHistorySource,
  requestId: ResultRecoveryRequestId,
  witness: PlannedAttemptContinuationWitness
) => {
  const directed = journalRecordByKey(records, resultRecoveryDirectedRecordKey(requestId))
  if (directed?.event._tag !== "ResultRecoveryDirected" || directed.event.requestId.runId !== requestId.runId)
    return { _tag: "DirectionRejected" as const, detail: "no exact applied result recovery direction" }
  const event = directed.event
  if (event.direction !== "ContinueRetainedAttempt" || event.subject._tag !== "RejectedResult")
    return {
      _tag: "DirectionRejected" as const,
      detail: "the applied direction does not authorize retained-work Continue"
    }
  const selectionProblem = resultRecoveryDirectionProblem(event, requestId.runId, records, requestId)
  if (selectionProblem !== undefined) return { _tag: "DirectionRejected" as const, detail: selectionProblem }
  // A pre-direction read completing later is not a newly requested verification.
  const reads = [
    [witness.activeTaskContinuationRead.graphObservationOperationId, "ActiveTaskContinuationGraph"],
    [
      witness.activeTaskContinuationRead.taskWorkSpecificationObservationOperationId,
      "ActiveTaskContinuationSpecification"
    ],
    [witness.activeTaskContinuationRead.taskClaimObservationOperationId, "ActiveTaskContinuationClaim"],
    [witness.worktreeObservationOperationId, "PlannedAttemptWorktree"],
    [witness.targetLineageObservationOperationId, "PlannedAttemptTargetLineage"]
  ] as const
  for (const [operationId, boundary] of reads) {
    const intent = journalRecordByKey(records, intentRecordKey(operationId))
    if (intent !== undefined && intent.position <= directed.position)
      return {
        _tag: "Rejected" as const,
        reason: "StaleWitness" as const,
        witness: boundary,
        detail: `result recovery requires a fresh read intent after direction: ${operationId}`
      }
  }
  return evaluatePlannedAttemptCurrentFactsAuthorization(
    records,
    event.subject.plannedAttempt,
    witness,
    directed.position,
    event.subject.plannedAttempt.taskRevision
  )
}

/** Native chronological validation uses only the prefix preceding this permission. */
export const resultRecoveryContinueAuthorizationProblem = (
  records: JournalHistorySource,
  event: ResultRecoveryContinueAuthorizedEvent
): string | undefined => {
  const direction = journalRecordByKey(records, resultRecoveryDirectedRecordKey(event.requestId))
  if (
    direction?.event._tag !== "ResultRecoveryDirected" ||
    !plannedTaskAttemptEquivalence(direction.event.subject.plannedAttempt, event.plannedAttempt)
  )
    return "result recovery authorization does not match its exact applied attempt"
  const evaluation = evaluateResultRecoveryContinueFacts(records, event.requestId, event.witness)
  return evaluation._tag === "Authorized" ? undefined : evaluation.detail
}

/** A semantic recovery command consumes one exact durable permission; it cannot allocate another command on replay. */
export const resultRecoveryContinueCommandProblem = (
  records: JournalHistorySource,
  command: PlannedAttemptExecutorCommandIntendedEvent
): string | undefined => {
  if (command.command !== "ContinueRejectedResult") return undefined
  const permission = command.recoveryAuthorization
  if (permission === undefined) return "result recovery command lacks permission identity"
  const requestId = ResultRecoveryRequestId.make({ nonce: permission.nonce, runId: permission.correlation.runId })
  const authorized = journalRecordByKey(records, resultRecoveryContinueAuthorizedRecordKey(requestId))
  if (
    authorized?.event._tag !== "ResultRecoveryContinueAuthorized" ||
    !plannedTaskAttemptEquivalence(authorized.event.plannedAttempt, command.plannedAttempt)
  )
    return "result recovery command lacks exact durable authorization"
  for (const prior of journalRecordsForAttemptKind(
    records,
    command.plannedAttempt.attemptId,
    "PlannedAttemptExecutorCommandIntended"
  )) {
    if (
      prior.event._tag === "PlannedAttemptExecutorCommandIntended" &&
      prior.event.recoveryAuthorization?.nonce === permission.nonce
    )
      return "one result recovery permission cannot allocate another semantic command"
  }
  return resultRecoveryContinueAuthorizationProblem(records, authorized.event)
}
