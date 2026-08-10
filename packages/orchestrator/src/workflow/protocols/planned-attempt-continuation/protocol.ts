import { PlannedTaskAttempt, plannedTaskAttemptEquivalence } from "@dalph/contracts"
import { Effect, Schema } from "effect"
import { authorizedClaimForAttempt } from "../../claim-authority-history.js"
import { isExactTaskClaim } from "../../../authorities/task-tracker/claim-mutation.js"
import { InRunJournal, type JournalRecord } from "../../../workflow-journal/store.js"
import type { WorkflowJournalEvent } from "../../registry/event.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { PlannedAttemptContinuationAuthorizedEvent, type PlannedAttemptContinuationWitness } from "./events.js"
import { plannedAttemptContinuationAuthorizedRecordKey } from "../../../workflow-journal/record-key.js"
import { taskTrackerObservationMatchesRead } from "../../task-tracker-facts/observation-match.js"
import { plannedAttemptWorktreeObservationMatchesPlan } from "../planned-attempt-worktree-observation/protocol.js"
import { latestPlannedAttemptExecutorEvidence } from "../planned-attempt-executor-work/evidence.js"

/** The exact current-fact family named by a failed continuation authorization. */
export const ContinuationAuthorizationWitness = Schema.Literals([
  "ActiveTaskContinuationGraph",
  "ActiveTaskContinuationSpecification",
  "ActiveTaskContinuationClaim",
  "PlannedAttemptWorktree"
])
export type ContinuationAuthorizationWitness = typeof ContinuationAuthorizationWitness.Type
export type ContinuationAuthorizationReason = "MissingWitness" | "StaleWitness" | "LaterWitness" | "WrongAttemptWitness"

/**
 * A continuation may contact the executor only after all named observations
 * are present, current, and correlated to the retained responsibility.
 */
export class PlannedAttemptContinuationAuthorizationRejected extends Schema.TaggedError<PlannedAttemptContinuationAuthorizationRejected>()(
  "PlannedAttemptContinuationAuthorizationRejected",
  {
    detail: Schema.String,
    plannedAttempt: PlannedTaskAttempt,
    reason: Schema.Literals(["MissingWitness", "StaleWitness", "LaterWitness", "WrongAttemptWitness"]),
    witness: ContinuationAuthorizationWitness
  }
) {}

const exactAttempt = (left: PlannedTaskAttempt, right: PlannedTaskAttempt): boolean =>
  plannedTaskAttemptEquivalence(left, right)

export type PlannedAttemptContinuationAuthorizationEvaluation =
  | { readonly _tag: "Authorized" }
  | {
      readonly _tag: "Rejected"
      readonly detail: string
      readonly reason: ContinuationAuthorizationReason
      readonly witness: ContinuationAuthorizationWitness
    }

const reject = (
  witness: ContinuationAuthorizationWitness,
  reason: ContinuationAuthorizationReason,
  detail: string
) => ({ _tag: "Rejected" as const, detail, reason, witness })

/* eslint-disable complexity -- one closed causal gate validates each exact read family before executor contact. */
export const evaluatePlannedAttemptContinuationAuthorization = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  witness: PlannedAttemptContinuationWitness
): PlannedAttemptContinuationAuthorizationEvaluation => {
  const responsibility = records.findLast(
    ({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
      exactAttempt(event.plannedAttempt, plannedAttempt)
  )
  if (responsibility === undefined) {
    return reject(
      "ActiveTaskContinuationGraph",
      "MissingWitness",
      "continuation authorization requires the exact prior executor-work responsibility"
    )
  }

  const latestExecutorEvidence = latestPlannedAttemptExecutorEvidence(records, plannedAttempt)
  const freshnessBaseline = latestExecutorEvidence?.observedAt ?? responsibility.position
  const observation = witness.activeTaskContinuationRead

  const graphIntent = records.findLast(
    ({ event }) =>
      event._tag === "TaskTrackerReadIntentRecorded" &&
      event.operation._tag === "ReadTrackerGraph" &&
      event.operation.operationId === observation.graphObservationOperationId
  )
  const graphOutcome = records.findLast(
    ({ event }) =>
      event._tag === "TaskTrackerFactsObserved" && event.operationId === observation.graphObservationOperationId
  )
  if (graphIntent === undefined || graphOutcome === undefined) {
    return reject(
      "ActiveTaskContinuationGraph",
      "MissingWitness",
      `active-task continuation graph observation ${observation.graphObservationOperationId} is missing`
    )
  }
  if (graphOutcome.position <= freshnessBaseline) {
    return reject(
      "ActiveTaskContinuationGraph",
      "StaleWitness",
      `active-task continuation graph observation ${observation.graphObservationOperationId} predates executor evidence at ${freshnessBaseline}`
    )
  }
  if (graphIntent.position >= graphOutcome.position || graphIntent.event._tag !== "TaskTrackerReadIntentRecorded") {
    return reject(
      "ActiveTaskContinuationGraph",
      "LaterWitness",
      `active-task continuation graph observation ${observation.graphObservationOperationId} is not after its read intent`
    )
  }
  if (
    graphIntent.event.operation._tag !== "ReadTrackerGraph" ||
    graphOutcome.event._tag !== "TaskTrackerFactsObserved" ||
    !taskTrackerObservationMatchesRead(graphOutcome.event.observation, graphIntent.event.operation)
  ) {
    return reject(
      "ActiveTaskContinuationGraph",
      "WrongAttemptWitness",
      `active-task continuation graph observation ${observation.graphObservationOperationId} does not match its read`
    )
  }
  if (
    graphOutcome.event.observation._tag !== "CompleteTaskTrackerFacts" &&
    graphOutcome.event.observation._tag !== "UnchangedTaskTrackerFactsReconfirmed"
  ) {
    return reject(
      "ActiveTaskContinuationGraph",
      "WrongAttemptWitness",
      `active-task continuation graph observation ${observation.graphObservationOperationId} is not complete or unchanged`
    )
  }

  const specificationIntent = records.findLast(
    ({ event }) =>
      event._tag === "TaskTrackerReadIntentRecorded" &&
      event.operation._tag === "ReadTaskWorkSpecification" &&
      event.operation.operationId === observation.taskWorkSpecificationObservationOperationId
  )
  const specificationOutcome = records.findLast(
    ({ event }) =>
      event._tag === "TaskTrackerFactsObserved" &&
      event.operationId === observation.taskWorkSpecificationObservationOperationId
  )
  if (specificationIntent === undefined || specificationOutcome === undefined) {
    return reject(
      "ActiveTaskContinuationSpecification",
      "MissingWitness",
      `active-task continuation specification observation ${observation.taskWorkSpecificationObservationOperationId} is missing`
    )
  }
  if (specificationOutcome.position <= graphOutcome.position || specificationOutcome.position <= freshnessBaseline) {
    return reject(
      "ActiveTaskContinuationSpecification",
      "StaleWitness",
      `active-task continuation specification observation ${observation.taskWorkSpecificationObservationOperationId} is not after the current graph and executor evidence`
    )
  }
  if (
    specificationIntent.position >= specificationOutcome.position ||
    specificationIntent.event._tag !== "TaskTrackerReadIntentRecorded" ||
    specificationIntent.event.operation._tag !== "ReadTaskWorkSpecification" ||
    specificationIntent.event.operation.taskId !== plannedAttempt.taskId ||
    specificationOutcome.event._tag !== "TaskTrackerFactsObserved" ||
    specificationOutcome.event.observation._tag !== "FocusedTaskWorkSpecificationFacts" ||
    specificationOutcome.event.observation.factFamily.taskId !== plannedAttempt.taskId ||
    !taskTrackerObservationMatchesRead(specificationOutcome.event.observation, specificationIntent.event.operation)
  ) {
    return reject(
      "ActiveTaskContinuationSpecification",
      "WrongAttemptWitness",
      `active-task continuation specification observation ${observation.taskWorkSpecificationObservationOperationId} names another task or read`
    )
  }

  const claimIntent = records.findLast(
    ({ event }) =>
      event._tag === "TaskTrackerReadIntentRecorded" &&
      event.operation._tag === "ReadTaskClaim" &&
      event.operation.operationId === observation.taskClaimObservationOperationId
  )
  const claimOutcome = records.findLast(
    ({ event }) =>
      event._tag === "TaskTrackerFactsObserved" && event.operationId === observation.taskClaimObservationOperationId
  )
  const authorizedClaim = authorizedClaimForAttempt(records, plannedAttempt)
  if (claimIntent === undefined || claimOutcome === undefined || authorizedClaim === undefined) {
    return reject(
      "ActiveTaskContinuationClaim",
      "MissingWitness",
      `active-task continuation claim observation ${observation.taskClaimObservationOperationId} is missing`
    )
  }
  if (claimOutcome.position <= specificationOutcome.position || claimOutcome.position <= freshnessBaseline) {
    return reject(
      "ActiveTaskContinuationClaim",
      "StaleWitness",
      `active-task continuation claim observation ${observation.taskClaimObservationOperationId} is not after the current specification and executor evidence`
    )
  }
  if (
    claimIntent.position >= claimOutcome.position ||
    claimIntent.event._tag !== "TaskTrackerReadIntentRecorded" ||
    claimIntent.event.operation._tag !== "ReadTaskClaim" ||
    claimIntent.event.operation.taskId !== plannedAttempt.taskId ||
    claimOutcome.event._tag !== "TaskTrackerFactsObserved" ||
    claimOutcome.event.observation._tag !== "FocusedTaskClaimFacts" ||
    claimOutcome.event.observation.coverage.taskId !== plannedAttempt.taskId ||
    claimOutcome.event.observation.observation._tag !== "ActiveTaskClaim" ||
    !taskTrackerObservationMatchesRead(claimOutcome.event.observation, claimIntent.event.operation) ||
    !isExactTaskClaim(claimOutcome.event.observation.observation, authorizedClaim.claim)
  ) {
    return reject(
      "ActiveTaskContinuationClaim",
      "WrongAttemptWitness",
      `active-task continuation claim observation ${observation.taskClaimObservationOperationId} does not prove the authorized claim`
    )
  }

  const worktreeIntent = records.findLast(
    ({ event }) =>
      event._tag === "GitReadIntentRecorded" &&
      event.operation._tag === "ReadTaskWorktree" &&
      event.operation.operationId === witness.worktreeObservationOperationId
  )
  const worktreeOutcome = records.findLast(
    (
      record
    ): record is JournalRecord & {
      readonly event: Extract<WorkflowJournalEvent, { readonly _tag: "PlannedAttemptWorktreeObserved" }>
    } =>
      record.event._tag === "PlannedAttemptWorktreeObserved" &&
      record.event.operationId === witness.worktreeObservationOperationId
  )
  if (worktreeIntent === undefined || worktreeOutcome === undefined) {
    return reject(
      "PlannedAttemptWorktree",
      "MissingWitness",
      `planned-attempt worktree observation ${witness.worktreeObservationOperationId} is missing`
    )
  }
  if (worktreeOutcome.position <= claimOutcome.position || worktreeOutcome.position <= freshnessBaseline) {
    return reject(
      "PlannedAttemptWorktree",
      "StaleWitness",
      `planned-attempt worktree observation ${witness.worktreeObservationOperationId} is not after the current claim and executor evidence`
    )
  }
  if (
    worktreeIntent.position >= worktreeOutcome.position ||
    worktreeIntent.event._tag !== "GitReadIntentRecorded" ||
    worktreeIntent.event.operation._tag !== "ReadTaskWorktree" ||
    !exactAttempt(worktreeIntent.event.operation.plannedAttempt, plannedAttempt) ||
    worktreeOutcome.event.observation._tag !== "PlannedWorktreeReady" ||
    !plannedAttemptWorktreeObservationMatchesPlan(worktreeOutcome.event.observation, plannedAttempt)
  ) {
    return reject(
      "PlannedAttemptWorktree",
      "WrongAttemptWitness",
      `planned-attempt worktree observation ${witness.worktreeObservationOperationId} does not prove the exact planned worktree`
    )
  }

  return { _tag: "Authorized" }
}
/* eslint-enable complexity */

export const authorizePlannedAttemptContinuation = Effect.fn("PlannedAttemptContinuation.authorize")(function* (
  plannedAttempt: PlannedTaskAttempt,
  witness: PlannedAttemptContinuationWitness
) {
  const journal = yield* InRunJournal
  const records = yield* journal.read(plannedAttempt.runId)
  const evaluation = evaluatePlannedAttemptContinuationAuthorization(records, plannedAttempt, witness)
  if (evaluation._tag === "Rejected") {
    return yield* new PlannedAttemptContinuationAuthorizationRejected({
      detail: evaluation.detail,
      plannedAttempt,
      reason: evaluation.reason,
      witness: evaluation.witness
    })
  }
  const observation = witness.activeTaskContinuationRead
  const witnessOperationIds = [
    observation.graphObservationOperationId,
    observation.taskClaimObservationOperationId,
    observation.taskWorkSpecificationObservationOperationId,
    witness.worktreeObservationOperationId
  ]
  const key = plannedAttemptContinuationAuthorizedRecordKey(plannedAttempt.attemptId, witnessOperationIds)
  const existing = records.find(({ key: recordKey }) => recordKey === key)
  if (existing !== undefined) return existing
  return yield* journal.append(
    plannedAttempt.runId,
    key,
    PlannedAttemptContinuationAuthorizedEvent.make({ plannedAttempt, version: workflowJournalEventVersion, witness })
  )
})
