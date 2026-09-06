import { type PlannedTaskAttempt, plannedTaskAttemptEquivalence } from "@dalph/contracts"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import type { JournalPosition } from "../../../workflow-journal/identity.js"
import { exactWorkflowRunTargetForRun } from "../../../workflow-journal/run-target.js"
import { appliedTerminalChoiceFor } from "../attempt-choice/terminal-choice-authority.js"
import { appliedContinueChoiceForExactRevision } from "../attempt-choice/continue-choice-authority.js"
import {
  currentUnconsumedAcceptedSafeEvidence,
  latestPlannedAttemptExecutorEvidence
} from "../planned-attempt-executor-work/evidence.js"
import {
  validateContinuationClaimWitness,
  validateContinuationGraphWitness,
  validateContinuationSpecificationWitness,
  validateContinuationTargetLineageWitness,
  validateContinuationWorktreeWitness,
  type WitnessValidation
} from "./authorization-witness-validation.js"
import type { PlannedAttemptContinuationWitness } from "./events.js"
import type {
  ContinuationAuthorizationReason,
  ContinuationAuthorizationWitness,
  PlannedAttemptContinuationAuthorizationEvaluation
} from "./protocol.js"

const exactAttempt = plannedTaskAttemptEquivalence
const reject = (
  witness: ContinuationAuthorizationWitness,
  reason: ContinuationAuthorizationReason,
  detail: string
): PlannedAttemptContinuationAuthorizationEvaluation => ({ _tag: "Rejected", detail, reason, witness })

const isRejected = (
  validation: WitnessValidation
): validation is Extract<WitnessValidation, { readonly _tag: "Rejected" }> => validation._tag === "Rejected"

type ValidExecutorAuthority = { readonly _tag: "ValidExecutorAuthority"; readonly observedAt: JournalPosition }

const continuationTaskAuthorityFor = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  witness: PlannedAttemptContinuationWitness,
  executorObservedAt: JournalPosition
) => {
  const operationId = witness.activeTaskContinuationRead.taskWorkSpecificationObservationOperationId
  const witnessedSpecification = records.findLast(
    ({ event }) =>
      event._tag === "TaskTrackerFactsObserved" &&
      event.operationId === operationId &&
      event.observation._tag === "FocusedTaskWorkSpecificationFacts"
  )
  const currentTaskRevision =
    witnessedSpecification?.event._tag === "TaskTrackerFactsObserved" &&
    witnessedSpecification.event.observation._tag === "FocusedTaskWorkSpecificationFacts"
      ? witnessedSpecification.event.observation.factFamily.fingerprint
      : plannedAttempt.taskRevision
  if (currentTaskRevision === plannedAttempt.taskRevision) {
    return { authorizedTaskRevision: plannedAttempt.taskRevision, freshnessBaseline: executorObservedAt }
  }
  const continueChoice = appliedContinueChoiceForExactRevision(records, plannedAttempt, currentTaskRevision)
  if (continueChoice === undefined) {
    return { authorizedTaskRevision: plannedAttempt.taskRevision, freshnessBaseline: executorObservedAt }
  }
  return {
    authorizedTaskRevision: continueChoice.event.subject.observedTaskRevision,
    freshnessBaseline: continueChoice.position > executorObservedAt ? continueChoice.position : executorObservedAt
  }
}

const validateExecutorAuthority = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt
): PlannedAttemptContinuationAuthorizationEvaluation | ValidExecutorAuthority => {
  const hasResponsibility = records.some(
    ({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
      exactAttempt(event.plannedAttempt, plannedAttempt)
  )
  if (!hasResponsibility) {
    return reject(
      "ActiveTaskContinuationGraph",
      "MissingWitness",
      "continuation authorization requires the exact prior executor-work responsibility"
    )
  }

  const terminalChoice = appliedTerminalChoiceFor(records, plannedAttempt)
  if (terminalChoice !== undefined) {
    return reject(
      "AcceptedSafeExecutorReport",
      "StaleWitness",
      `continuation authorization follows terminal choice ${terminalChoice.event.requestId.nonce}`
    )
  }

  const latestExecutorEvidence = latestPlannedAttemptExecutorEvidence(records, plannedAttempt)
  if (latestExecutorEvidence === undefined || latestExecutorEvidence.source._tag !== "AcceptedReport") {
    return reject(
      "AcceptedSafeExecutorReport",
      "StaleWitness",
      "continuation authorization requires the latest current executor evidence itself to be an accepted report"
    )
  }
  if (latestExecutorEvidence.report._tag !== "ExecutorWorkSafelySuspended") {
    return reject(
      "AcceptedSafeExecutorReport",
      "WrongAttemptWitness",
      "continuation authorization requires the latest accepted executor report to be safely suspended"
    )
  }

  const safeAuthority = currentUnconsumedAcceptedSafeEvidence(records, plannedAttempt)
  return safeAuthority === undefined
    ? reject(
        "AcceptedSafeExecutorReport",
        "StaleWitness",
        "continuation authorization requires an unconsumed accepted safe report and no unsettled executor command"
      )
    : { _tag: "ValidExecutorAuthority", observedAt: safeAuthority.observedAt }
}

export const evaluatePlannedAttemptContinuationAuthorization = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  witness: PlannedAttemptContinuationWitness
): PlannedAttemptContinuationAuthorizationEvaluation => {
  const immutableRunTarget = exactWorkflowRunTargetForRun(records, plannedAttempt.runId)
  if (immutableRunTarget === undefined) {
    return reject(
      "ActiveTaskContinuationGraph",
      "MissingWitness",
      "continuation authorization requires exactly one immutable WorkflowRunBegan target"
    )
  }
  const executorAuthority = validateExecutorAuthority(records, plannedAttempt)
  if (executorAuthority._tag !== "ValidExecutorAuthority") return executorAuthority
  const { authorizedTaskRevision, freshnessBaseline } = continuationTaskAuthorityFor(
    records,
    plannedAttempt,
    witness,
    executorAuthority.observedAt
  )

  const graph = validateContinuationGraphWitness(
    records,
    plannedAttempt,
    witness,
    freshnessBaseline,
    immutableRunTarget
  )
  if (isRejected(graph)) return graph

  const specification = validateContinuationSpecificationWitness(
    records,
    plannedAttempt,
    witness,
    graph.outcome.position,
    freshnessBaseline,
    authorizedTaskRevision,
    immutableRunTarget
  )
  if (isRejected(specification)) return specification

  const claim = validateContinuationClaimWitness(
    records,
    plannedAttempt,
    witness,
    specification.outcome.position,
    freshnessBaseline,
    immutableRunTarget
  )
  if (isRejected(claim)) return claim

  const worktree = validateContinuationWorktreeWitness(
    records,
    plannedAttempt,
    witness,
    claim.outcome.position,
    freshnessBaseline
  )
  if (isRejected(worktree)) return worktree

  const targetLineage = validateContinuationTargetLineageWitness(
    records,
    plannedAttempt,
    witness,
    worktree.outcome.position,
    freshnessBaseline
  )
  if (isRejected(targetLineage)) return targetLineage

  return { _tag: "Authorized" }
}
