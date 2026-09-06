/* eslint-disable max-lines -- The five exact witness validators share one closed authorization boundary. */

import { type PlannedTaskAttempt, plannedTaskAttemptEquivalence, type TaskRevision } from "@dalph/contracts"
import { taskTrackerTargetKey, type TrackerTarget } from "../../../authorities/task-tracker/target.js"
import type { JournalPosition } from "../../../workflow-journal/identity.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import { authorizedClaimForAttempt } from "../../claim-authority-history.js"
import type { WorkflowJournalEvent } from "../../registry/event.js"
import { plannedAttemptWorktreeObservationMatchesPlan } from "../planned-attempt-worktree-observation/protocol.js"
import { graphKeepsTaskEligible } from "./authorization-graph.js"
import {
  claimWitnessMatchesExactClaim,
  graphIntentPrecedesOutcome,
  graphReadMatchesOutcome,
  isCompleteGraphObservation,
  presentWitnessPair,
  specificationIntentMatches,
  specificationOutcomeMatches,
  targetLineageIntentMatches,
  targetLineageOutcomeMatches,
  worktreeWitnessMatches
} from "./authorization-witness-predicates.js"
import {
  continuationTrackerReadHasExactPlanPredecessor,
  latestContinuationTrackerReadStatusAfter
} from "./tracker-read-freshness.js"
import type { PlannedAttemptContinuationWitness } from "./events.js"
import type {
  ContinuationAuthorizationReason,
  ContinuationAuthorizationWitness,
  PlannedAttemptContinuationAuthorizationEvaluation
} from "./protocol.js"

type Rejected = Extract<PlannedAttemptContinuationAuthorizationEvaluation, { readonly _tag: "Rejected" }>
type ValidWitness = { readonly _tag: "ValidWitness"; readonly outcome: JournalRecord }
export type WitnessValidation = Rejected | ValidWitness

const exactAttempt = plannedTaskAttemptEquivalence
const valid = (outcome: JournalRecord): ValidWitness => ({ _tag: "ValidWitness", outcome })
const reject = (
  witness: ContinuationAuthorizationWitness,
  reason: ContinuationAuthorizationReason,
  detail: string
): Rejected => ({ _tag: "Rejected", detail, reason, witness })

const trackerReadTargetMatchesRun = (target: TrackerTarget, immutableRunTarget: TrackerTarget): boolean =>
  taskTrackerTargetKey(target) === taskTrackerTargetKey(immutableRunTarget)

const trackerOutcomeTargetMatchesRun = (record: JournalRecord, immutableRunTarget: TrackerTarget): boolean =>
  record.event._tag === "TaskTrackerFactsObserved" &&
  trackerReadTargetMatchesRun(record.event.observation.target, immutableRunTarget)

// eslint-disable-next-line complexity -- The exact graph witness gate must reject every stale, foreign, and malformed read state.
export const validateContinuationGraphWitness = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  witness: PlannedAttemptContinuationWitness,
  freshnessBaseline: JournalPosition,
  immutableRunTarget: TrackerTarget
): WitnessValidation => {
  const observation = witness.activeTaskContinuationRead
  const intent = records.findLast(
    ({ event }) =>
      event._tag === "TaskTrackerReadIntentRecorded" &&
      event.operation._tag === "ReadTrackerGraph" &&
      event.operation.operationId === observation.graphObservationOperationId
  )
  const outcome = records.findLast(
    ({ event }) =>
      event._tag === "TaskTrackerFactsObserved" && event.operationId === observation.graphObservationOperationId
  )
  const pair = presentWitnessPair(intent, outcome)
  if (pair === undefined) {
    return reject(
      "ActiveTaskContinuationGraph",
      "MissingWitness",
      `active-task continuation graph observation ${observation.graphObservationOperationId} is missing`
    )
  }
  const [currentIntent, currentOutcome] = pair
  if (currentOutcome.position <= freshnessBaseline) {
    return reject(
      "ActiveTaskContinuationGraph",
      "StaleWitness",
      `active-task continuation graph observation ${observation.graphObservationOperationId} predates executor evidence at ${freshnessBaseline}`
    )
  }
  if (!graphIntentPrecedesOutcome(currentIntent, currentOutcome)) {
    return reject(
      "ActiveTaskContinuationGraph",
      "LaterWitness",
      `active-task continuation graph observation ${observation.graphObservationOperationId} is not after its read intent`
    )
  }
  if (
    currentIntent.event._tag !== "TaskTrackerReadIntentRecorded" ||
    currentIntent.event.operation._tag !== "ReadTrackerGraph" ||
    !trackerReadTargetMatchesRun(currentIntent.event.operation.target, immutableRunTarget) ||
    !trackerOutcomeTargetMatchesRun(currentOutcome, immutableRunTarget) ||
    !continuationTrackerReadHasExactPlanPredecessor(records, currentIntent.event.operation, plannedAttempt) ||
    !currentIntent.event.operation.readShape.explicitlyCoveredTaskIds.includes(plannedAttempt.taskId)
  ) {
    return reject(
      "ActiveTaskContinuationGraph",
      "WrongAttemptWitness",
      `active-task continuation graph observation ${observation.graphObservationOperationId} is not causally bound to the exact planned attempt and covered task`
    )
  }
  if (!graphReadMatchesOutcome(currentIntent, currentOutcome)) {
    return reject(
      "ActiveTaskContinuationGraph",
      "WrongAttemptWitness",
      `active-task continuation graph observation ${observation.graphObservationOperationId} does not match its read`
    )
  }
  if (!isCompleteGraphObservation(currentOutcome)) {
    return reject(
      "ActiveTaskContinuationGraph",
      "WrongAttemptWitness",
      `active-task continuation graph observation ${observation.graphObservationOperationId} is not complete or unchanged`
    )
  }
  if (
    !graphKeepsTaskEligible(records, currentOutcome.event.observation, currentOutcome.position, plannedAttempt.taskId)
  ) {
    return reject(
      "ActiveTaskContinuationGraph",
      "WrongAttemptWitness",
      `active-task continuation graph observation ${observation.graphObservationOperationId} does not keep task ${plannedAttempt.taskId} eligible`
    )
  }
  if (
    latestContinuationTrackerReadStatusAfter(
      records,
      currentOutcome.position,
      "ReadTrackerGraph",
      currentOutcome.event.observation.target,
      plannedAttempt.taskId,
      plannedAttempt
    ) !== undefined
  ) {
    return reject(
      "ActiveTaskContinuationGraph",
      "StaleWitness",
      `active-task continuation graph observation ${observation.graphObservationOperationId} was superseded by a later graph observation`
    )
  }
  return valid(currentOutcome)
}

// eslint-disable-next-line complexity -- The exact specification witness gate must reject every stale or malformed read state.
export const validateContinuationSpecificationWitness = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  witness: PlannedAttemptContinuationWitness,
  after: JournalPosition,
  freshnessBaseline: JournalPosition,
  authorizedTaskRevision: TaskRevision,
  immutableRunTarget: TrackerTarget
): WitnessValidation => {
  const operationId = witness.activeTaskContinuationRead.taskWorkSpecificationObservationOperationId
  const intent = records.findLast(
    ({ event }) =>
      event._tag === "TaskTrackerReadIntentRecorded" &&
      event.operation._tag === "ReadTaskWorkSpecification" &&
      event.operation.operationId === operationId
  )
  const outcome = records.findLast(
    ({ event }) => event._tag === "TaskTrackerFactsObserved" && event.operationId === operationId
  )
  const pair = presentWitnessPair(intent, outcome)
  if (pair === undefined) {
    return reject(
      "ActiveTaskContinuationSpecification",
      "MissingWitness",
      `active-task continuation specification observation ${operationId} is missing`
    )
  }
  const [currentIntent, currentOutcome] = pair
  if (currentOutcome.position <= after || currentOutcome.position <= freshnessBaseline) {
    return reject(
      "ActiveTaskContinuationSpecification",
      "StaleWitness",
      `active-task continuation specification observation ${operationId} is not after the current graph and executor evidence`
    )
  }
  if (currentIntent.position >= currentOutcome.position) {
    return reject(
      "ActiveTaskContinuationSpecification",
      "LaterWitness",
      `active-task continuation specification observation ${operationId} is not after its read intent`
    )
  }
  if (
    currentIntent.event._tag !== "TaskTrackerReadIntentRecorded" ||
    currentIntent.event.operation._tag !== "ReadTaskWorkSpecification" ||
    !trackerReadTargetMatchesRun(currentIntent.event.operation.target, immutableRunTarget) ||
    !trackerOutcomeTargetMatchesRun(currentOutcome, immutableRunTarget) ||
    !continuationTrackerReadHasExactPlanPredecessor(records, currentIntent.event.operation, plannedAttempt)
  ) {
    return reject(
      "ActiveTaskContinuationSpecification",
      "WrongAttemptWitness",
      `active-task continuation specification observation ${operationId} is not causally bound to the exact planned attempt`
    )
  }
  if (
    !specificationIntentMatches(currentIntent, plannedAttempt) ||
    !specificationOutcomeMatches(currentIntent, currentOutcome, plannedAttempt, authorizedTaskRevision)
  ) {
    return reject(
      "ActiveTaskContinuationSpecification",
      "WrongAttemptWitness",
      `active-task continuation specification observation ${operationId} does not prove the currently authorized task revision`
    )
  }
  if (currentOutcome.event._tag !== "TaskTrackerFactsObserved") {
    return reject(
      "ActiveTaskContinuationSpecification",
      "WrongAttemptWitness",
      `active-task continuation specification observation ${operationId} has no tracker facts outcome`
    )
  }
  if (
    latestContinuationTrackerReadStatusAfter(
      records,
      currentOutcome.position,
      "ReadTaskWorkSpecification",
      currentOutcome.event.observation.target,
      plannedAttempt.taskId,
      plannedAttempt
    ) !== undefined
  ) {
    return reject(
      "ActiveTaskContinuationSpecification",
      "StaleWitness",
      `active-task continuation specification observation ${operationId} was superseded by a later specification observation`
    )
  }
  return valid(currentOutcome)
}

// eslint-disable-next-line complexity -- The exact claim witness gate must reject every stale or malformed read state.
export const validateContinuationClaimWitness = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  witness: PlannedAttemptContinuationWitness,
  after: JournalPosition,
  freshnessBaseline: JournalPosition,
  immutableRunTarget: TrackerTarget
): WitnessValidation => {
  const operationId = witness.activeTaskContinuationRead.taskClaimObservationOperationId
  const intent = records.findLast(
    ({ event }) =>
      event._tag === "TaskTrackerReadIntentRecorded" &&
      event.operation._tag === "ReadTaskClaim" &&
      event.operation.operationId === operationId
  )
  const outcome = records.findLast(
    ({ event }) => event._tag === "TaskTrackerFactsObserved" && event.operationId === operationId
  )
  const authorizedClaim = authorizedClaimForAttempt(records, plannedAttempt)
  const pair = presentWitnessPair(intent, outcome)
  if (pair === undefined || authorizedClaim === undefined) {
    return reject(
      "ActiveTaskContinuationClaim",
      "MissingWitness",
      `active-task continuation claim observation ${operationId} is missing`
    )
  }
  const [currentIntent, currentOutcome] = pair
  if (currentOutcome.position <= after || currentOutcome.position <= freshnessBaseline) {
    return reject(
      "ActiveTaskContinuationClaim",
      "StaleWitness",
      `active-task continuation claim observation ${operationId} is not after the current specification and executor evidence`
    )
  }
  if (currentIntent.position >= currentOutcome.position) {
    return reject(
      "ActiveTaskContinuationClaim",
      "LaterWitness",
      `active-task continuation claim observation ${operationId} is not after its read intent`
    )
  }
  if (
    currentIntent.event._tag !== "TaskTrackerReadIntentRecorded" ||
    currentIntent.event.operation._tag !== "ReadTaskClaim" ||
    !trackerReadTargetMatchesRun(currentIntent.event.operation.target, immutableRunTarget) ||
    !trackerOutcomeTargetMatchesRun(currentOutcome, immutableRunTarget) ||
    !continuationTrackerReadHasExactPlanPredecessor(records, currentIntent.event.operation, plannedAttempt)
  ) {
    return reject(
      "ActiveTaskContinuationClaim",
      "WrongAttemptWitness",
      `active-task continuation claim observation ${operationId} is not causally bound to the exact planned attempt`
    )
  }
  if (!claimWitnessMatchesExactClaim(currentIntent, currentOutcome, plannedAttempt, authorizedClaim)) {
    return reject(
      "ActiveTaskContinuationClaim",
      "WrongAttemptWitness",
      `active-task continuation claim observation ${operationId} does not prove the authorized claim`
    )
  }
  if (currentOutcome.event._tag !== "TaskTrackerFactsObserved") {
    return reject(
      "ActiveTaskContinuationClaim",
      "WrongAttemptWitness",
      `active-task continuation claim observation ${operationId} has no tracker facts outcome`
    )
  }
  if (
    latestContinuationTrackerReadStatusAfter(
      records,
      currentOutcome.position,
      "ReadTaskClaim",
      currentOutcome.event.observation.target,
      plannedAttempt.taskId,
      plannedAttempt
    ) !== undefined
  ) {
    return reject(
      "ActiveTaskContinuationClaim",
      "StaleWitness",
      `active-task continuation claim observation ${operationId} was superseded by a later claim observation`
    )
  }
  return valid(currentOutcome)
}

export const validateContinuationWorktreeWitness = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  witness: PlannedAttemptContinuationWitness,
  after: JournalPosition,
  freshnessBaseline: JournalPosition
): WitnessValidation => {
  const operationId = witness.worktreeObservationOperationId
  const intent = records.findLast(
    ({ event }) =>
      event._tag === "GitReadIntentRecorded" &&
      event.operation._tag === "ReadTaskWorktree" &&
      event.operation.operationId === operationId
  )
  const outcome = records.findLast(
    (
      record
    ): record is JournalRecord & {
      readonly event: Extract<WorkflowJournalEvent, { readonly _tag: "PlannedAttemptWorktreeObserved" }>
    } => record.event._tag === "PlannedAttemptWorktreeObserved" && record.event.operationId === operationId
  )
  const pair = presentWitnessPair(intent, outcome)
  if (pair === undefined) {
    return reject(
      "PlannedAttemptWorktree",
      "MissingWitness",
      `planned-attempt worktree observation ${operationId} is missing`
    )
  }
  const [currentIntent, currentOutcome] = pair
  if (currentOutcome.position <= after || currentOutcome.position <= freshnessBaseline) {
    return reject(
      "PlannedAttemptWorktree",
      "StaleWitness",
      `planned-attempt worktree observation ${operationId} is not after the current claim and executor evidence`
    )
  }
  if (currentIntent.position >= currentOutcome.position) {
    return reject(
      "PlannedAttemptWorktree",
      "LaterWitness",
      `planned-attempt worktree observation ${operationId} is not after its read intent`
    )
  }
  if (!worktreeWitnessMatches(currentIntent, currentOutcome, plannedAttempt)) {
    return reject(
      "PlannedAttemptWorktree",
      "WrongAttemptWitness",
      `planned-attempt worktree observation ${operationId} does not prove the exact planned worktree`
    )
  }
  if (
    records.some(
      ({ event, position }) =>
        position > currentOutcome.position &&
        event._tag === "PlannedAttemptWorktreeObserved" &&
        plannedAttemptWorktreeObservationMatchesPlan(event.observation, plannedAttempt)
    )
  ) {
    return reject(
      "PlannedAttemptWorktree",
      "StaleWitness",
      `planned-attempt worktree observation ${operationId} was superseded by a later worktree observation`
    )
  }
  return valid(currentOutcome)
}

export const validateContinuationTargetLineageWitness = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  witness: PlannedAttemptContinuationWitness,
  after: JournalPosition,
  freshnessBaseline: JournalPosition
): WitnessValidation => {
  const operationId = witness.targetLineageObservationOperationId
  const intent = records.findLast(
    ({ event }) =>
      event._tag === "GitReadIntentRecorded" &&
      event.operation._tag === "ReadTargetLineage" &&
      event.operation.operationId === operationId
  )
  const outcome = records.findLast(
    ({ event }) => event._tag === "TargetLineageObserved" && event.operationId === operationId
  )
  const pair = presentWitnessPair(intent, outcome)
  if (pair === undefined) {
    return reject(
      "PlannedAttemptTargetLineage",
      "MissingWitness",
      `planned-attempt target-lineage observation ${operationId} is missing`
    )
  }
  const [currentIntent, currentOutcome] = pair
  if (currentOutcome.position <= after || currentOutcome.position <= freshnessBaseline) {
    return reject(
      "PlannedAttemptTargetLineage",
      "StaleWitness",
      `planned-attempt target-lineage observation ${operationId} is not after the current worktree and executor evidence`
    )
  }
  if (currentIntent.position >= currentOutcome.position) {
    return reject(
      "PlannedAttemptTargetLineage",
      "LaterWitness",
      `planned-attempt target-lineage observation ${operationId} is not after its read intent`
    )
  }
  if (
    !targetLineageIntentMatches(currentIntent, plannedAttempt) ||
    !targetLineageOutcomeMatches(currentOutcome, plannedAttempt)
  ) {
    return reject(
      "PlannedAttemptTargetLineage",
      "WrongAttemptWitness",
      `planned-attempt target-lineage observation ${operationId} does not prove compatible lineage for the exact planned attempt`
    )
  }
  if (
    records.some(
      ({ event, position }) =>
        position > currentOutcome.position &&
        event._tag === "TargetLineageObserved" &&
        exactAttempt(event.plannedAttempt, plannedAttempt)
    )
  ) {
    return reject(
      "PlannedAttemptTargetLineage",
      "StaleWitness",
      `planned-attempt target-lineage observation ${operationId} was superseded by a later target-lineage observation`
    )
  }
  return valid(currentOutcome)
}
