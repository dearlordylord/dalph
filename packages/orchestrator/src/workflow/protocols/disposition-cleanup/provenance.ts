/* eslint-disable max-lines -- Family-specific provenance and history checks stay co-located for auditability. */

import { plannedTaskAttemptEquivalence } from "@dalph/contracts"
import { Match, Option, Schema } from "effect"
import type { JournalPosition } from "../../../workflow-journal/identity.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import {
  branchCleanupAuthorizedRecordKey,
  branchCleanupAbsenceConfirmedRecordKey,
  branchCleanupContradictedRecordKey,
  branchCleanupMutationIntendedRecordKey,
  branchCleanupMutationResultRecordedRecordKey,
  branchCleanupObservationIntendedRecordKey,
  branchCleanupObservedRecordKey,
  branchCleanupSettledRecordKey,
  integratorCandidateCleanupAuthorizedRecordKey,
  integratorCandidateCleanupAbsenceConfirmedRecordKey,
  integratorCandidateCleanupContradictedRecordKey,
  integratorCandidateCleanupMutationIntendedRecordKey,
  integratorCandidateCleanupMutationResultRecordedRecordKey,
  integratorCandidateCleanupObservationIntendedRecordKey,
  integratorCandidateCleanupObservedRecordKey,
  integratorCandidateCleanupSettledRecordKey,
  integrationQuarantineDirectionAppliedRecordKey,
  integratorSuccessorSessionFixedRecordKey,
  attemptChoiceAppliedRecordKey,
  attemptImplementationAbandonedRecordKey,
  intentRecordKey,
  outcomeRecordKey,
  plannedAttemptReplacedRecordKey,
  worktreeCleanupAuthorizedRecordKey,
  worktreeCleanupAbsenceConfirmedRecordKey,
  worktreeCleanupContradictedRecordKey,
  worktreeCleanupMutationIntendedRecordKey,
  worktreeCleanupMutationResultRecordedRecordKey,
  worktreeCleanupObservationIntendedRecordKey,
  worktreeCleanupObservedRecordKey,
  worktreeCleanupSettledRecordKey
} from "../../../workflow-journal/record-key.js"
import { sameAttemptChoiceRequestId, sameAttemptChoiceSubject } from "../attempt-choice/events.js"
import {
  exactAppliedRestart,
  exactExecutorQuiescenceEvidence,
  recordedReplacement,
  restartClaimAuthorityAtApplication
} from "../attempt-choice/restart-authority-evidence.js"
import { ActiveTaskClaim } from "../../../authorities/task-tracker/claim-mutation.js"
import type { OperationId } from "../../identity.js"
import { integratorCorrelationsEqual, validateIntegratorSuccessorSessionFixed } from "../integrator/state.js"
import {
  IntegratorRunCorrelation,
  integratorRetryRunOrdinal,
  integratorSuccessorChronologyIsValid
} from "../integrator/events.js"
import { evaluateIntegratorFullRerunAuthorization } from "../integrator/retry-authorization.js"
import {
  IntegrationQuarantineDirectionFingerprint,
  integrationQuarantineDirectionSubject
} from "../integration-quarantine/events.js"
import {
  quarantineRecordForFingerprint,
  validateProviderRunActivityAbsent
} from "../integration-quarantine/canonical-provenance.js"
import { exactTargetLineageRecord } from "../integration-quarantine/canonical-lineage.js"
import { taskTrackerObservationMatchesRead } from "../../task-tracker-facts/observation-match.js"
import { authorizedClaimForAttempt } from "../../claim-authority-history.js"
import { plannedAttemptWorktreeObservationMatchesPlan } from "../planned-attempt-worktree-observation/protocol.js"
import {
  branchCleanupAuthorizationEquals,
  cleanupMutationRequestLimit,
  integratorCandidateCleanupAuthorizationEquals,
  plannedAttemptCleanupDispositionEquals,
  worktreeCleanupAuthorizationEquals,
  type BranchCleanupAuthorization,
  type IntegratorCandidateCleanupAuthorization,
  type PlannedAttemptCleanupDisposition,
  type WorktreeCleanupAuthorization
} from "./disposition.js"
import { validateCleanupHistory, type CleanupHistoryDescriptor } from "./cleanup-history.js"
import {
  BranchCleanupObservation,
  IntegratorCandidateCleanupObservation,
  WorktreeCleanupObservation
} from "./observations.js"

/** Result of checking the durable upstream facts before cleanup authorization. */
export type CleanupProvenanceValidation =
  | { readonly _tag: "Valid"; readonly detail: string }
  | { readonly _tag: "Invalid"; readonly detail: string }

const valid = (detail: string): CleanupProvenanceValidation => ({ _tag: "Valid", detail })
const invalid = (detail: string): CleanupProvenanceValidation => ({ _tag: "Invalid", detail })
const activeTaskClaimEquivalence = Schema.toEquivalence(ActiveTaskClaim)

const recordAt = (records: ReadonlyArray<JournalRecord>, position: JournalPosition): JournalRecord | undefined =>
  records.find((record) => record.position === position)

const operationIdsEqual = (left: ReadonlyArray<unknown>, right: ReadonlyArray<unknown>): boolean =>
  left.length === right.length && left.every((operationId, index) => operationId === right[index])

const operationIdSetsEqual = (left: ReadonlyArray<unknown>, right: ReadonlyArray<unknown>): boolean =>
  left.length === right.length &&
  new Set(left).size === left.length &&
  new Set(right).size === right.length &&
  left.every((operationId) => right.includes(operationId))

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** Compares decoded journal values without relying on object property order. */
const structuralEqual = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true
  if (!isRecord(left) || !isRecord(right)) return false
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && structuralEqual(left[key], right[key]))
  )
}

type SettlementContext = { readonly absence: JournalRecord; readonly mutationResult: JournalRecord | undefined }

/** Links terminal result identity to the exact successful mutation or absence reconciliation. */
const settlementResultMatches = (
  settledResult: unknown,
  context: SettlementContext,
  mutationResultTag: string,
  fallbackResult: (observation: Readonly<Record<string, unknown>>) => unknown
): boolean => {
  const absenceEvent = context.absence.event
  const absenceObservationValue: unknown = Reflect.get(absenceEvent, "observation")
  /* v8 ignore next -- @preserve Cleanup history stores context.absence only after a decoded family absence schema has supplied its structured observation. */
  if (!isRecord(absenceObservationValue)) return false
  const absenceObservation = absenceObservationValue
  if (
    !isRecord(settledResult) ||
    !Object.prototype.hasOwnProperty.call(settledResult, "revision") ||
    settledResult["revision"] !== absenceObservation["revision"]
  ) {
    return false
  }
  const recordedMutation = context.mutationResult?.event
  if (
    recordedMutation !== undefined &&
    recordedMutation._tag === mutationResultTag &&
    "result" in recordedMutation &&
    isRecord(recordedMutation.result)
  ) {
    const mutationResult = recordedMutation.result
    return ["Removed", "AlreadyAbsent"].includes(String(mutationResult._tag))
      ? structuralEqual(settledResult, mutationResult)
      : structuralEqual(settledResult, fallbackResult(absenceObservation))
  }
  return structuralEqual(settledResult, fallbackResult(absenceObservation))
}

const claimsEqual = activeTaskClaimEquivalence

const replacementWitnessOperationIds = (
  replacement: Extract<JournalRecord["event"], { readonly _tag: "PlannedAttemptReplaced" }>
) => [
  replacement.witness.expectedClaim.operationId,
  replacement.witness.claimObservationOperationId,
  replacement.witness.graphObservationOperationId,
  replacement.witness.oldWorktreeObservationOperationId,
  replacement.witness.specificationObservationOperationId,
  replacement.witness.targetLineageObservationOperationId
]

/**
 * Resolves every witness named by P2 to its own durable intent/outcome pair.
 * The atomic replacement event is not authority by itself: a forged event or
 * a copied operation id must fail when its upstream read chronology is absent.
 */
const validateReplacementWitnessRecords = (
  records: ReadonlyArray<JournalRecord>,
  replacement: Extract<JournalRecord["event"], { readonly _tag: "PlannedAttemptReplaced" }>,
  application: JournalRecord,
  replacementRecord: JournalRecord
): string | undefined => {
  const runId = replacement.subject.plannedAttempt.runId
  const after = application.position
  const before = replacementRecord.position
  const exactIntent = (operationId: OperationId, position: JournalPosition): JournalRecord | undefined => {
    const intents = records.filter(
      (candidate) =>
        candidate.event._tag === "TaskTrackerReadIntentRecorded" &&
        candidate.event.operation.operationId === operationId &&
        candidate.runId === runId &&
        candidate.key === intentRecordKey(operationId) &&
        candidate.position < position
    )
    return intents.length === 1 ? intents[0] : undefined
  }
  const exactGitIntent = (operationId: OperationId, position: JournalPosition): JournalRecord | undefined => {
    const intents = records.filter(
      (candidate) =>
        candidate.event._tag === "GitReadIntentRecorded" &&
        candidate.event.operation.operationId === operationId &&
        candidate.runId === runId &&
        candidate.key === intentRecordKey(operationId) &&
        candidate.position < position
    )
    return intents.length === 1 ? intents[0] : undefined
  }
  const exactClaimIntent = (position: JournalPosition): JournalRecord | undefined => {
    const intents = records.filter(
      (candidate) =>
        candidate.event._tag === "TaskClaimAcquisitionIntended" &&
        candidate.event.operation.acquisition.operationId === replacement.witness.expectedClaim.operationId &&
        candidate.runId === runId &&
        candidate.key === intentRecordKey(replacement.witness.expectedClaim.operationId) &&
        candidate.position < position
    )
    return intents.length === 1 ? intents[0] : undefined
  }
  const claimOutcomes = records.filter(
    (candidate) =>
      candidate.event._tag === "TaskClaimAcquired" &&
      candidate.event.claim.operationId === replacement.witness.expectedClaim.operationId
  )
  const claimOutcome = claimOutcomes.length === 1 ? claimOutcomes[0] : undefined
  if (
    claimOutcome === undefined ||
    claimOutcome.event._tag !== "TaskClaimAcquired" ||
    claimOutcome.runId !== runId ||
    claimOutcome.key !== outcomeRecordKey(replacement.witness.expectedClaim.operationId) ||
    claimOutcome.position >= before ||
    !activeTaskClaimEquivalence(claimOutcome.event.claim, replacement.witness.expectedClaim) ||
    exactClaimIntent(claimOutcome.position) === undefined
  ) {
    return "replacement provenance lacks the exact claim intent and acquired outcome witness"
  }

  const graphOperationId = replacement.witness.graphObservationOperationId
  const graphOutcomes = records.filter(
    (candidate) =>
      candidate.event._tag === "TaskTrackerFactsObserved" && candidate.event.operationId === graphOperationId
  )
  const graphOutcome = graphOutcomes.length === 1 ? graphOutcomes[0] : undefined
  const graphIntent = graphOutcome === undefined ? undefined : exactIntent(graphOperationId, graphOutcome.position)
  const graphIntentIsExact =
    graphIntent?.event._tag === "TaskTrackerReadIntentRecorded" &&
    graphIntent.event.operation._tag === "ReadTrackerGraph"
  const graphObservationMatchesRead =
    graphIntent?.event._tag === "TaskTrackerReadIntentRecorded" &&
    graphIntent.event.operation._tag === "ReadTrackerGraph" &&
    graphOutcome?.event._tag === "TaskTrackerFactsObserved" &&
    taskTrackerObservationMatchesRead(graphOutcome.event.observation, graphIntent.event.operation)
  if (
    graphOutcome === undefined ||
    graphOutcome.runId !== runId ||
    graphOutcome.key !== outcomeRecordKey(graphOperationId) ||
    graphOutcome.position <= after ||
    graphOutcome.position >= before ||
    graphOutcome.event._tag !== "TaskTrackerFactsObserved" ||
    graphOutcome.event.observation._tag !== "CompleteTaskTrackerFacts" ||
    !graphOutcome.event.observation.factFamilies[0].taskIds.includes(replacement.subject.plannedAttempt.taskId) ||
    !graphIntentIsExact ||
    !graphObservationMatchesRead
  ) {
    return "replacement provenance lacks the exact graph read intent and complete facts outcome"
  }

  const specificationOperationId = replacement.witness.specificationObservationOperationId
  const specificationOutcomes = records.filter(
    (candidate) =>
      candidate.event._tag === "TaskTrackerFactsObserved" && candidate.event.operationId === specificationOperationId
  )
  const specificationOutcome = specificationOutcomes.length === 1 ? specificationOutcomes[0] : undefined
  const specificationIntent =
    specificationOutcome === undefined
      ? undefined
      : exactIntent(specificationOperationId, specificationOutcome.position)
  const specificationIntentIsExact =
    specificationIntent?.event._tag === "TaskTrackerReadIntentRecorded" &&
    specificationIntent.event.operation._tag === "ReadTaskWorkSpecification"
  const specificationObservationMatchesRead =
    specificationIntent?.event._tag === "TaskTrackerReadIntentRecorded" &&
    specificationIntent.event.operation._tag === "ReadTaskWorkSpecification" &&
    specificationOutcome?.event._tag === "TaskTrackerFactsObserved" &&
    taskTrackerObservationMatchesRead(specificationOutcome.event.observation, specificationIntent.event.operation)
  if (
    specificationOutcome === undefined ||
    specificationOutcome.runId !== runId ||
    specificationOutcome.key !== outcomeRecordKey(specificationOperationId) ||
    specificationOutcome.position <= after ||
    specificationOutcome.position >= before ||
    specificationOutcome.event._tag !== "TaskTrackerFactsObserved" ||
    specificationOutcome.event.observation._tag !== "FocusedTaskWorkSpecificationFacts" ||
    specificationOutcome.event.observation.factFamily.taskId !== replacement.subject.plannedAttempt.taskId ||
    specificationOutcome.event.observation.factFamily.fingerprint !== replacement.subject.observedTaskRevision ||
    !specificationIntentIsExact ||
    !specificationObservationMatchesRead
  ) {
    return "replacement provenance lacks the exact authored specification read witness"
  }

  const claimObservationOperationId = replacement.witness.claimObservationOperationId
  const claimObservationOutcomes = records.filter(
    (candidate) =>
      candidate.event._tag === "TaskTrackerFactsObserved" && candidate.event.operationId === claimObservationOperationId
  )
  const claimObservationOutcome = claimObservationOutcomes.length === 1 ? claimObservationOutcomes[0] : undefined
  const claimObservationIntent =
    claimObservationOutcome === undefined
      ? undefined
      : exactIntent(claimObservationOperationId, claimObservationOutcome.position)
  const claimObservationIntentIsExact =
    claimObservationIntent?.event._tag === "TaskTrackerReadIntentRecorded" &&
    claimObservationIntent.event.operation._tag === "ReadTaskClaim"
  const claimObservationMatchesRead =
    claimObservationIntent?.event._tag === "TaskTrackerReadIntentRecorded" &&
    claimObservationIntent.event.operation._tag === "ReadTaskClaim" &&
    claimObservationOutcome?.event._tag === "TaskTrackerFactsObserved" &&
    taskTrackerObservationMatchesRead(claimObservationOutcome.event.observation, claimObservationIntent.event.operation)
  if (
    claimObservationOutcome === undefined ||
    claimObservationOutcome.runId !== runId ||
    claimObservationOutcome.key !== outcomeRecordKey(claimObservationOperationId) ||
    claimObservationOutcome.position <= after ||
    claimObservationOutcome.position >= before ||
    claimObservationOutcome.event._tag !== "TaskTrackerFactsObserved" ||
    claimObservationOutcome.event.observation._tag !== "FocusedTaskClaimFacts" ||
    !structuralEqual(claimObservationOutcome.event.observation.observation, replacement.witness.expectedClaim) ||
    !claimObservationIntentIsExact ||
    !claimObservationMatchesRead
  ) {
    return "replacement provenance lacks the exact claim observation read witness"
  }

  const worktreeOperationId = replacement.witness.oldWorktreeObservationOperationId
  const worktreeOutcomes = records.filter(
    (candidate) =>
      candidate.event._tag === "PlannedAttemptWorktreeObserved" && candidate.event.operationId === worktreeOperationId
  )
  const worktreeOutcome = worktreeOutcomes.length === 1 ? worktreeOutcomes[0] : undefined
  const worktreeIntent =
    worktreeOutcome === undefined ? undefined : exactGitIntent(worktreeOperationId, worktreeOutcome.position)
  const worktreeIntentIsExact =
    worktreeIntent?.event._tag === "GitReadIntentRecorded" && worktreeIntent.event.operation._tag === "ReadTaskWorktree"
  if (
    worktreeOutcome === undefined ||
    worktreeOutcome.runId !== runId ||
    worktreeOutcome.key !== outcomeRecordKey(worktreeOperationId) ||
    worktreeOutcome.position <= after ||
    worktreeOutcome.position >= before ||
    worktreeOutcome.event._tag !== "PlannedAttemptWorktreeObserved" ||
    !structuralEqual(worktreeOutcome.event.observation, replacement.witness.oldWorktreeProof) ||
    !worktreeIntentIsExact ||
    !plannedTaskAttemptEquivalence(worktreeIntent.event.operation.plannedAttempt, replacement.subject.plannedAttempt)
  ) {
    return "replacement provenance lacks the exact old-worktree read witness"
  }

  const lineageOperationId = replacement.witness.targetLineageObservationOperationId
  const lineageOutcomes = records.filter(
    (candidate) =>
      candidate.event._tag === "TargetLineageObserved" && candidate.event.operationId === lineageOperationId
  )
  const lineageOutcome = lineageOutcomes.length === 1 ? lineageOutcomes[0] : undefined
  const lineageIntent =
    lineageOutcome === undefined ? undefined : exactGitIntent(lineageOperationId, lineageOutcome.position)
  const lineageIntentIsExact =
    lineageIntent?.event._tag === "GitReadIntentRecorded" && lineageIntent.event.operation._tag === "ReadTargetLineage"
  if (
    lineageOutcome === undefined ||
    lineageOutcome.runId !== runId ||
    lineageOutcome.key !== outcomeRecordKey(lineageOperationId) ||
    lineageOutcome.position <= after ||
    lineageOutcome.position >= before ||
    lineageOutcome.event._tag !== "TargetLineageObserved" ||
    !plannedTaskAttemptEquivalence(lineageOutcome.event.plannedAttempt, replacement.subject.plannedAttempt) ||
    lineageOutcome.event.observation.plannedBaseSha !== replacement.subject.plannedAttempt.baseSha ||
    lineageOutcome.event.observation.targetHeadSha !== replacement.witness.targetHeadSha ||
    !lineageOutcome.event.observation.plannedBaseIsAncestorOfTargetHead ||
    !lineageIntentIsExact ||
    !plannedTaskAttemptEquivalence(lineageIntent.event.operation.plannedAttempt, replacement.subject.plannedAttempt)
  ) {
    return "replacement provenance lacks the exact target-lineage read witness"
  }
  return undefined
}

const validatePlannedAttemptDisposition = (
  records: ReadonlyArray<JournalRecord>,
  disposition: PlannedAttemptCleanupDisposition,
  causalPredecessors: ReadonlyArray<unknown>
): CleanupProvenanceValidation => {
  if (disposition._tag === "Superseded") {
    const record = recordAt(records, disposition.dispositionAt)
    if (
      record?.event._tag !== "PlannedAttemptReplaced" ||
      record.runId !== disposition.plannedAttempt.runId ||
      record.key !== plannedAttemptReplacedRecordKey(disposition.plannedAttempt.attemptId)
    ) {
      return invalid("cleanup requires the exact durable PlannedAttemptReplaced occurrence")
    }
    const replacement = record.event
    const canonicalReplacement = recordedReplacement(records, replacement.subject)
    const matchingReplacements = records.filter(
      (candidate) =>
        candidate.event._tag === "PlannedAttemptReplaced" &&
        plannedTaskAttemptEquivalence(candidate.event.subject.plannedAttempt, replacement.subject.plannedAttempt)
    )
    if (matchingReplacements.length !== 1 || matchingReplacements[0] !== record || canonicalReplacement !== record) {
      return invalid("replacement provenance does not resolve the exact canonical replacement record")
    }
    if (!plannedTaskAttemptEquivalence(replacement.subject.plannedAttempt, disposition.plannedAttempt)) {
      return invalid("replacement provenance names a foreign predecessor attempt")
    }
    if (!plannedTaskAttemptEquivalence(replacement.successorPlan.plannedAttempt, disposition.successorAttempt)) {
      return invalid("replacement provenance names a foreign successor attempt")
    }
    const appliedRestart = exactAppliedRestart(records, replacement.requestId, replacement.subject)
    if (appliedRestart === undefined) {
      return invalid("replacement provenance lacks the exact earlier applied Restart choice")
    }
    if (
      appliedRestart.position >= record.position ||
      appliedRestart.runId !== disposition.plannedAttempt.runId ||
      appliedRestart.key !== attemptChoiceAppliedRecordKey(appliedRestart.event.requestId)
    ) {
      return invalid("replacement provenance Restart choice has a foreign position, Run, or key")
    }
    if (
      !exactExecutorQuiescenceEvidence(
        records,
        disposition.plannedAttempt,
        record.position,
        replacement.witness.quiescenceProof
      )
    ) {
      return invalid("replacement provenance lacks the exact executor quiescence proof")
    }
    const retainedClaim = restartClaimAuthorityAtApplication(records, appliedRestart)
    if (retainedClaim === undefined || !claimsEqual(retainedClaim.claim, replacement.witness.expectedClaim)) {
      return invalid("replacement provenance lacks the exact claim authority at Restart application")
    }
    if (
      !operationIdSetsEqual(
        replacement.successorPlan.predecessorOperationIds,
        replacementWitnessOperationIds(replacement)
      )
    ) {
      return invalid("replacement provenance omits or invents a canonical witness operation")
    }
    if (!operationIdsEqual(causalPredecessors, replacement.successorPlan.predecessorOperationIds)) {
      return invalid("cleanup authorization omits or invents replacement authority predecessors")
    }
    const witnessIssue = validateReplacementWitnessRecords(records, replacement, appliedRestart, record)
    if (witnessIssue !== undefined) return invalid(witnessIssue)
    return valid("durable PlannedAttemptReplaced proves the exact successor disposition")
  }

  if (disposition._tag === "Abandoned") {
    const record = recordAt(records, disposition.dispositionAt)
    if (
      record?.event._tag !== "AttemptImplementationAbandoned" ||
      record.runId !== disposition.plannedAttempt.runId ||
      record.key !== attemptImplementationAbandonedRecordKey(disposition.requestId)
    ) {
      return invalid("cleanup requires the exact durable AttemptImplementationAbandoned occurrence")
    }
    if (
      !sameAttemptChoiceRequestId(record.event.requestId, disposition.requestId) ||
      !plannedTaskAttemptEquivalence(record.event.subject.plannedAttempt, disposition.plannedAttempt)
    ) {
      return invalid("abandonment provenance names a foreign request or attempt")
    }
    const abandonment = record.event
    const appliedChoice = records.find((candidate) => {
      if (candidate.position >= record.position || candidate.event._tag !== "AttemptChoiceApplied") return false
      return (
        candidate.runId === disposition.plannedAttempt.runId &&
        candidate.key === attemptChoiceAppliedRecordKey(candidate.event.requestId) &&
        candidate.event.choice === "StopTaskImplementation" &&
        sameAttemptChoiceRequestId(candidate.event.requestId, abandonment.requestId) &&
        sameAttemptChoiceSubject(candidate.event.subject, abandonment.subject)
      )
    })
    if (appliedChoice === undefined) return invalid("abandonment provenance lacks the applied Stop choice")
    if (!exactExecutorQuiescenceEvidence(records, disposition.plannedAttempt, record.position, record.event.proof)) {
      return invalid("abandonment provenance lacks the exact executor quiescence proof")
    }
    const retainedClaim = authorizedClaimForAttempt(
      records.filter(({ position }) => position <= record.position),
      disposition.plannedAttempt
    )
    if (retainedClaim === undefined || !claimsEqual(retainedClaim.claim, abandonment.expectedClaim)) {
      return invalid("abandonment provenance lacks the exact stopped claim authority")
    }
    if (!operationIdsEqual(causalPredecessors, [abandonment.expectedClaim.operationId])) {
      return invalid("cleanup authorization does not bind the exact stopped claim")
    }
    return valid("durable abandonment and quiescence evidence prove the exact disposition")
  }

  /*
   * There is deliberately no generic planned-attempt terminal-settlement
   * event.  `TargetLineageObserved`, executor reports, and cleanup settlement
   * events are observations/results of other protocols; matching an arbitrary
   * operationId or plannedAttempt would manufacture authority.  Keep this
   * constructor for decoding old callers, but make it un-authorizable until a
   * canonical terminal event with a run-bound key and causal witness exists.
   */
  return invalid(
    `planned-attempt Settled disposition ${disposition.settlementOperationId} has no canonical terminal settlement event`
  )
}

const firstCleanupAuthorizationPosition = (
  records: ReadonlyArray<JournalRecord>,
  operationId: string,
  tags: ReadonlyArray<string>
): JournalPosition | undefined =>
  records
    .filter(
      (record) =>
        tags.includes(record.event._tag) &&
        record.event._tag !== "WorkflowRunBegan" &&
        eventOperationId(record.event) === operationId
    )
    .map(({ position }) => position)
    .toSorted((left, right) => Number(left) - Number(right))[0]

const validateWorktreeAuthorityObservation = (
  records: ReadonlyArray<JournalRecord>,
  authorization: WorktreeCleanupAuthorization | BranchCleanupAuthorization,
  family: "worktree" | "branch"
): CleanupProvenanceValidation => {
  const plannedAttempt = authorization.disposition.plannedAttempt
  const observations = records.filter((record) => record.position === authorization.observationAt)
  const observation = observations.length === 1 ? observations[0] : undefined
  if (
    observation?.event._tag !== "PlannedAttemptWorktreeObserved" ||
    observation.runId !== plannedAttempt.runId ||
    observation.key !== outcomeRecordKey(authorization.observationOperationId) ||
    observation.event.operationId !== authorization.observationOperationId ||
    !plannedAttemptWorktreeObservationMatchesPlan(observation.event.observation, plannedAttempt) ||
    observation.event.observation._tag !== "PlannedWorktreeReady" ||
    observation.event.observation.worktree !== plannedAttempt.worktree ||
    observation.event.observation.branch !==
      (family === "worktree" && "branch" in authorization.owner ? authorization.owner.branch : authorization.locator) ||
    observation.event.observation.headSha !== authorization.expectedHead
  ) {
    return invalid(`${family} cleanup authorization does not bind an exact preceding planned-worktree observation`)
  }
  const intents = records.filter(
    (record) =>
      record.position < observation.position &&
      record.runId === plannedAttempt.runId &&
      record.key === intentRecordKey(authorization.observationOperationId) &&
      record.event._tag === "GitReadIntentRecorded" &&
      record.event.operation._tag === "ReadTaskWorktree" &&
      record.event.operation.operationId === authorization.observationOperationId &&
      plannedTaskAttemptEquivalence(record.event.operation.plannedAttempt, plannedAttempt)
  )
  if (intents.length !== 1) {
    return invalid(`${family} cleanup authorization lacks the exact preceding planned-worktree read intent`)
  }
  const authorizationPosition = firstCleanupAuthorizationPosition(
    records,
    authorization.operationId,
    family === "worktree"
      ? [
          "WorktreeCleanupAuthorized",
          "WorktreeCleanupObservationIntended",
          "WorktreeCleanupObserved",
          "WorktreeCleanupMutationIntended",
          "WorktreeCleanupMutationResultRecorded",
          "WorktreeCleanupAbsenceConfirmed",
          "WorktreeCleanupContradicted",
          "WorktreeCleanupSettled"
        ]
      : [
          "BranchCleanupAuthorized",
          "BranchCleanupObservationIntended",
          "BranchCleanupObserved",
          "BranchCleanupMutationIntended",
          "BranchCleanupMutationResultRecorded",
          "BranchCleanupAbsenceConfirmed",
          "BranchCleanupContradicted",
          "BranchCleanupSettled"
        ]
  )
  return authorizationPosition === undefined || observation.position < authorizationPosition
    ? valid(`exact ${family} authority observation and read intent precede cleanup authorization`)
    : invalid(`${family} cleanup authority observation occurs after its cleanup authorization`)
}

const validateCandidateAuthorityObservation = (
  records: ReadonlyArray<JournalRecord>,
  authorization: IntegratorCandidateCleanupAuthorization
): CleanupProvenanceValidation => {
  const predecessor = authorization.disposition.predecessor
  const lineage = exactTargetLineageRecord(records, {
    expectedTargetHead: predecessor.expectedTargetHead,
    integrationTarget: predecessor.integrationTarget,
    plannedAttempt: predecessor.plannedAttempt,
    targetLineageObservedAt: authorization.observationAt
  })
  const observation = lineage?.observation
  if (
    observation === undefined ||
    observation.event.operationId !== authorization.observationOperationId ||
    observation.key !== outcomeRecordKey(authorization.observationOperationId)
  ) {
    return invalid("candidate cleanup authorization does not bind the exact predecessor target-lineage observation")
  }
  const authorizationPosition = firstCleanupAuthorizationPosition(records, authorization.operationId, [
    "IntegratorCandidateCleanupAuthorized",
    "IntegratorCandidateCleanupObservationIntended",
    "IntegratorCandidateCleanupObserved",
    "IntegratorCandidateCleanupMutationIntended",
    "IntegratorCandidateCleanupMutationResultRecorded",
    "IntegratorCandidateCleanupAbsenceConfirmed",
    "IntegratorCandidateCleanupContradicted",
    "IntegratorCandidateCleanupSettled"
  ])
  return authorizationPosition === undefined || observation.position < authorizationPosition
    ? valid("exact candidate authority observation and read intent precede cleanup authorization")
    : invalid("candidate authority observation occurs after its cleanup authorization")
}

/** Validates the authority observation fields before a family appends CleanupAuthorized. */
export const validateCleanupAuthorizationObservation = (
  records: ReadonlyArray<JournalRecord>,
  authorization: WorktreeCleanupAuthorization | BranchCleanupAuthorization | IntegratorCandidateCleanupAuthorization
): CleanupProvenanceValidation =>
  "worktreeCleanupOperationId" in authorization
    ? validateWorktreeAuthorityObservation(records, authorization, "branch")
    : "expectedHead" in authorization
      ? validateWorktreeAuthorityObservation(records, authorization, "worktree")
      : validateCandidateAuthorityObservation(records, authorization)

/** Validates the terminal worktree/branch disposition before any authorization event is appended. */
export const validateWorktreeCleanupProvenance = (
  records: ReadonlyArray<JournalRecord>,
  authorization: WorktreeCleanupAuthorization | BranchCleanupAuthorization
): CleanupProvenanceValidation => {
  const observation = validateCleanupAuthorizationObservation(records, authorization)
  if (observation._tag === "Invalid") return observation
  if ("worktreeCleanupOperationId" in authorization) {
    if (authorization.causalPredecessors[0] !== authorization.worktreeCleanupOperationId) {
      return invalid("branch cleanup does not bind the exact settled worktree operation")
    }
    return validatePlannedAttemptDisposition(
      records,
      authorization.disposition,
      authorization.causalPredecessors.slice(1)
    )
  }
  return validatePlannedAttemptDisposition(records, authorization.disposition, authorization.causalPredecessors)
}

/** Validates the exact quarantine, applied FullRerun, and successor relation for candidate cleanup. */
export const validateIntegratorCandidateCleanupProvenance = (
  records: ReadonlyArray<JournalRecord>,
  authorization: IntegratorCandidateCleanupAuthorization
): CleanupProvenanceValidation => {
  const observation = validateCandidateAuthorityObservation(records, authorization)
  if (observation._tag === "Invalid") return observation
  const disposition = authorization.disposition
  const direction = recordAt(records, disposition.directionAppliedAt)
  if (
    direction?.event._tag !== "IntegrationQuarantineDirectionApplied" ||
    direction.runId !== disposition.predecessor.plannedAttempt.runId ||
    direction.event.fingerprint.direction !== "FullRerun" ||
    direction.event.fingerprint.quarantineAt !== disposition.dispositionAt ||
    direction.event.fingerprint.sessionId !== disposition.predecessor.sessionId ||
    direction.event.requestId.runId !== disposition.predecessor.plannedAttempt.runId ||
    direction.key !==
      integrationQuarantineDirectionAppliedRecordKey(integrationQuarantineDirectionSubject(direction.event.fingerprint))
  ) {
    return invalid("candidate cleanup requires the exact applied FullRerun direction")
  }

  const matchingDirections = records.filter(
    (record) =>
      record.event._tag === "IntegrationQuarantineDirectionApplied" &&
      record.event.fingerprint.sessionId === disposition.predecessor.sessionId &&
      record.event.fingerprint.quarantineAt === disposition.dispositionAt
  )
  if (matchingDirections.length !== 1 || matchingDirections[0] !== direction) {
    return invalid("candidate cleanup direction reconstruction is duplicate or contradictory")
  }

  const fingerprint = IntegrationQuarantineDirectionFingerprint.make({
    direction: "FullRerun",
    quarantineAt: disposition.dispositionAt,
    sessionId: disposition.predecessor.sessionId
  })
  const quarantine = quarantineRecordForFingerprint(records, fingerprint)
  if (
    quarantine === undefined ||
    quarantine.runId !== disposition.predecessor.plannedAttempt.runId ||
    !integratorCorrelationsEqual(quarantine.event.correlation, disposition.predecessor)
  ) {
    return invalid("candidate cleanup requires the canonical predecessor quarantine and evidence")
  }
  /* v8 ignore next -- @preserve IntegratorCandidateCleanupDisposition's schema check requires dispositionAt < directionAppliedAt before this validator receives the authorization. */
  if (direction.position <= quarantine.position) {
    return invalid("candidate cleanup FullRerun direction must follow the canonical predecessor quarantine")
  }
  if (
    records.some(
      (record) =>
        record.event._tag === "IntegrationQuarantined" &&
        record.event.correlation.sessionId === disposition.predecessor.sessionId &&
        record.position > quarantine.position
    )
  ) {
    return invalid("candidate cleanup quarantine is not the latest canonical predecessor quarantine")
  }
  const providerFailure = quarantine.event.basis
  /* v8 ignore next -- @preserve quarantineRecordForFingerprint returns only a quarantine whose basis passed its explicit ProviderRunFailure tag check above. */
  if (providerFailure._tag !== "ProviderRunFailure") {
    return invalid("candidate cleanup requires canonical provider-activity absence evidence for the quarantine")
  }

  const absence = records.find(
    (
      record
    ): record is JournalRecord & {
      readonly event: Extract<JournalRecord["event"], { readonly _tag: "IntegrationProviderRunActivityAbsent" }>
    } =>
      record.position === providerFailure.ownedActivityProvenAbsentAt &&
      record.event._tag === "IntegrationProviderRunActivityAbsent"
  )
  /* v8 ignore next -- @preserve quarantineRecordForFingerprint selects this same position only after validating it as IntegrationProviderRunActivityAbsent. */
  const absenceValidation = absence === undefined ? undefined : validateProviderRunActivityAbsent(records, absence)
  if (
    absenceValidation?._tag !== "Valid" ||
    absenceValidation.record.position >= quarantine.position ||
    !integratorCorrelationsEqual(absenceValidation.run.session, disposition.predecessor) ||
    absenceValidation.record.event.detail !== providerFailure.detail
  ) {
    return invalid("candidate cleanup quarantine lacks the exact provider activity-absence witness")
  }

  if (!operationIdsEqual(authorization.causalPredecessors, [direction.event.requestId.nonce])) {
    return invalid("candidate authorization does not bind the exact FullRerun request")
  }

  const matchingSuccessors = records.filter(
    (record) =>
      record.event._tag === "IntegratorSuccessorSessionFixed" &&
      record.runId === disposition.predecessor.plannedAttempt.runId &&
      record.key ===
        integratorSuccessorSessionFixedRecordKey(
          disposition.predecessor,
          disposition.dispositionAt,
          disposition.directionAppliedAt
        ) &&
      integratorCorrelationsEqual(record.event.predecessor, disposition.predecessor) &&
      record.event.quarantineAt === disposition.dispositionAt &&
      record.event.directionAppliedAt === disposition.directionAppliedAt &&
      integratorCorrelationsEqual(record.event.successor, disposition.successor)
  )
  const successorRecord = matchingSuccessors[0]
  if (matchingSuccessors.length !== 1 || successorRecord?.event._tag !== "IntegratorSuccessorSessionFixed") {
    return invalid("candidate cleanup requires the exact durable predecessor-successor relation")
  }
  if (
    !integratorSuccessorChronologyIsValid({
      predecessor: disposition.predecessor,
      quarantineAt: disposition.dispositionAt,
      directionAppliedAt: disposition.directionAppliedAt,
      successor: disposition.successor
    }) ||
    successorRecord.position <= disposition.directionAppliedAt ||
    successorRecord.position <= disposition.successor.targetLineageObservedAt
  ) {
    return invalid("candidate cleanup successor settlement witness does not follow its fresh target-lineage read")
  }
  const successorRun = IntegratorRunCorrelation.make({
    ordinal: integratorRetryRunOrdinal,
    session: disposition.successor
  })
  const canonicalSuccessorAuthorization = evaluateIntegratorFullRerunAuthorization(
    records,
    successorRun,
    disposition.predecessor,
    disposition.successor.targetLineageObservedAt
  )
  if (canonicalSuccessorAuthorization._tag === "Rejected") {
    return invalid(`candidate cleanup successor retry reconstruction failed: ${canonicalSuccessorAuthorization.detail}`)
  }
  const canonical = validateIntegratorSuccessorSessionFixed(records, disposition.predecessor, disposition.successor)
  return canonical._tag === "Valid"
    ? valid("durable S1, canonical provider absence, FullRerun direction, and S2 prove candidate disposition")
    : invalid(canonical.detail)
}

const worktreeAuthorizationOf = (event: JournalRecord["event"]): WorktreeCleanupAuthorization | undefined =>
  Match.value(event).pipe(
    Match.tags({
      WorktreeCleanupAuthorized: (candidate) => candidate.authorization,
      WorktreeCleanupObservationIntended: (candidate) => candidate.authorization,
      WorktreeCleanupObserved: (candidate) => candidate.authorization,
      WorktreeCleanupMutationIntended: (candidate) => candidate.authorization,
      WorktreeCleanupMutationResultRecorded: (candidate) => candidate.authorization,
      WorktreeCleanupAbsenceConfirmed: (candidate) => candidate.authorization,
      WorktreeCleanupContradicted: (candidate) => candidate.authorization,
      WorktreeCleanupSettled: (candidate) => candidate.authorization
    }),
    Match.option,
    Option.getOrUndefined
  )

const branchAuthorizationOf = (event: JournalRecord["event"]): BranchCleanupAuthorization | undefined =>
  Match.value(event).pipe(
    Match.tags({
      BranchCleanupAuthorized: (candidate) => candidate.authorization,
      BranchCleanupObservationIntended: (candidate) => candidate.authorization,
      BranchCleanupObserved: (candidate) => candidate.authorization,
      BranchCleanupMutationIntended: (candidate) => candidate.authorization,
      BranchCleanupMutationResultRecorded: (candidate) => candidate.authorization,
      BranchCleanupAbsenceConfirmed: (candidate) => candidate.authorization,
      BranchCleanupContradicted: (candidate) => candidate.authorization,
      BranchCleanupSettled: (candidate) => candidate.authorization
    }),
    Match.option,
    Option.getOrUndefined
  )

const candidateAuthorizationOf = (event: JournalRecord["event"]): IntegratorCandidateCleanupAuthorization | undefined =>
  Match.value(event).pipe(
    Match.tags({
      IntegratorCandidateCleanupAuthorized: (candidate) => candidate.authorization,
      IntegratorCandidateCleanupObservationIntended: (candidate) => candidate.authorization,
      IntegratorCandidateCleanupObserved: (candidate) => candidate.authorization,
      IntegratorCandidateCleanupMutationIntended: (candidate) => candidate.authorization,
      IntegratorCandidateCleanupMutationResultRecorded: (candidate) => candidate.authorization,
      IntegratorCandidateCleanupAbsenceConfirmed: (candidate) => candidate.authorization,
      IntegratorCandidateCleanupContradicted: (candidate) => candidate.authorization,
      IntegratorCandidateCleanupSettled: (candidate) => candidate.authorization
    }),
    Match.option,
    Option.getOrUndefined
  )

const worktreeObservationEqual = Schema.toEquivalence(WorktreeCleanupObservation)

const branchObservationEqual = Schema.toEquivalence(BranchCleanupObservation)

const candidateObservationEqual = (
  left: IntegratorCandidateCleanupObservation,
  right: IntegratorCandidateCleanupObservation
): boolean => Schema.toEquivalence(IntegratorCandidateCleanupObservation)(left, right)

const worktreeObservationIdentityMatches = (
  observation: WorktreeCleanupObservation,
  authorization: WorktreeCleanupAuthorization
): boolean =>
  observation._tag === "Present"
    ? worktreeObservationEqual(
        observation,
        WorktreeCleanupObservation.cases.Present.make({
          attemptId: authorization.owner.attemptId,
          branch: authorization.owner.branch,
          headSha: authorization.expectedHead,
          locator: authorization.locator,
          revision: authorization.evidenceRevision,
          writerQuiescent: true
        })
      )
    : observation.locator === authorization.locator

const branchObservationIdentityMatches = (
  observation: BranchCleanupObservation,
  authorization: BranchCleanupAuthorization
): boolean =>
  observation._tag === "Present"
    ? branchObservationEqual(
        observation,
        BranchCleanupObservation.cases.Present.make({
          branch: authorization.locator,
          headSha: authorization.expectedHead,
          registeredWorktree: null,
          revision: authorization.evidenceRevision
        })
      )
    : observation.branch === authorization.locator

const candidateObservationIdentityMatches = (
  observation: IntegratorCandidateCleanupObservation,
  authorization: IntegratorCandidateCleanupAuthorization
): boolean =>
  observation._tag === "Present"
    ? candidateObservationEqual(
        observation,
        IntegratorCandidateCleanupObservation.cases.Present.make({
          locator: authorization.locator,
          revision: authorization.evidenceRevision,
          sessionId: authorization.owner.sessionId,
          writerQuiescent: true
        })
      )
    : observation.locator === authorization.locator

const eventOperationId = (event: JournalRecord["event"]): string | undefined => {
  /* v8 ignore next -- @preserve firstCleanupAuthorizationPosition passes only closed family-tag event schemas, each of which carries authorization. */
  if (!("authorization" in event)) return undefined
  const authorization = event.authorization
  /* v8 ignore next -- @preserve Every decoded cleanup-family authorization schema carries its deterministic operationId. */
  if (!("operationId" in authorization)) return undefined
  return authorization.operationId
}

const worktreeHistoryDescriptor = (
  authorization: WorktreeCleanupAuthorization
): CleanupHistoryDescriptor<WorktreeCleanupAuthorization> => ({
  data: {
    operationId: authorization.operationId,
    runId: authorization.disposition.plannedAttempt.runId,
    familyTags: [
      "WorktreeCleanupAuthorized",
      "WorktreeCleanupObservationIntended",
      "WorktreeCleanupObserved",
      "WorktreeCleanupMutationIntended",
      "WorktreeCleanupMutationResultRecorded",
      "WorktreeCleanupAbsenceConfirmed",
      "WorktreeCleanupContradicted",
      "WorktreeCleanupSettled"
    ],
    authorizationTag: "WorktreeCleanupAuthorized",
    observationIntentTag: "WorktreeCleanupObservationIntended",
    observedTag: "WorktreeCleanupObserved",
    mutationIntentTag: "WorktreeCleanupMutationIntended",
    mutationResultTag: "WorktreeCleanupMutationResultRecorded",
    maxMutationAttempts: cleanupMutationRequestLimit,
    absenceTag: "WorktreeCleanupAbsenceConfirmed",
    contradictionTag: "WorktreeCleanupContradicted",
    settledTag: "WorktreeCleanupSettled",
    authorizedKey: worktreeCleanupAuthorizedRecordKey(authorization.operationId),
    authorization,
    successDetail: "worktree cleanup history preserves the exact authorization and chronological subject prefix"
  },
  strategies: {
    authorizationOf: worktreeAuthorizationOf,
    authorizationEquals: worktreeCleanupAuthorizationEquals,
    observationIntent: (event) =>
      Match.value(event).pipe(
        Match.tags({
          WorktreeCleanupObservationIntended: (matched) => ({
            key: matched.operationId + ":" + matched.ordinal,
            recordKey: worktreeCleanupObservationIntendedRecordKey(authorization.operationId, matched.ordinal)
          })
        }),
        Match.option,
        Option.getOrUndefined
      ),
    observationResult: (event) =>
      Match.value(event).pipe(
        Match.tags({
          WorktreeCleanupObserved: (matched) => ({
            key: matched.operationId + ":" + matched.ordinal,
            operationId: matched.operationId,
            recordKey: worktreeCleanupObservedRecordKey(authorization.operationId, matched.ordinal),
            identityMatches: worktreeObservationIdentityMatches(matched.observation, authorization)
          })
        }),
        Match.option,
        Option.getOrUndefined
      ),
    mutationIntent: (event) =>
      Match.value(event).pipe(
        Match.tags({
          WorktreeCleanupMutationIntended: (matched) => ({
            attempt: String(matched.attempt),
            operationId: matched.operationId,
            recordKey: worktreeCleanupMutationIntendedRecordKey(authorization.operationId, matched.attempt)
          })
        }),
        Match.option,
        Option.getOrUndefined
      ),
    mutationResult: (event) =>
      Match.value(event).pipe(
        Match.tags({
          WorktreeCleanupMutationResultRecorded: (matched) => ({
            attempt: String(matched.attempt),
            operationId: matched.operationId,
            recordKey: worktreeCleanupMutationResultRecordedRecordKey(authorization.operationId, matched.attempt),
            identityMatches:
              matched.result.locator === authorization.locator && matched.result.branch === authorization.owner.branch
          })
        }),
        Match.option,
        Option.getOrUndefined
      ),
    absence: (event, observations) =>
      Match.value(event).pipe(
        Match.tags({
          WorktreeCleanupAbsenceConfirmed: (matched) => {
            const key = matched.operationId + ":" + matched.ordinal
            const observedObservation = Option.fromNullishOr(observations.get(key)).pipe(
              Option.flatMap((record) =>
                Match.value(record.event).pipe(
                  Match.tags({ WorktreeCleanupObserved: (observed) => observed.observation }),
                  Match.option
                )
              ),
              Option.getOrUndefined
            )
            const absenceObservation: unknown = matched.observation
            return {
              key,
              recordKey: worktreeCleanupAbsenceConfirmedRecordKey(authorization.operationId, matched.ordinal),
              cause: matched.cause,
              identityMatches: isRecord(absenceObservation) && absenceObservation["locator"] === authorization.locator,
              observationMatches:
                observedObservation !== undefined &&
                isRecord(absenceObservation) &&
                worktreeObservationEqual(matched.observation, observedObservation)
            }
          }
        }),
        Match.option,
        Option.getOrUndefined
      ),
    contradiction: (event) =>
      Match.value(event).pipe(
        Match.tags({
          WorktreeCleanupContradicted: (matched) => ({
            recordKey: worktreeCleanupContradictedRecordKey(authorization.operationId),
            identityMatches: matched.observation.locator === authorization.locator,
            observationOperationId: matched.operationId
          })
        }),
        Match.option,
        Option.getOrUndefined
      ),
    settled: (event, context) =>
      Match.value(event).pipe(
        Match.tags({
          WorktreeCleanupSettled: (matched) => ({
            recordKey: worktreeCleanupSettledRecordKey(authorization.operationId),
            identityMatches:
              isRecord(matched.result) &&
              matched.result["locator"] === authorization.locator &&
              matched.result["branch"] === authorization.owner.branch,
            resultMatches: settlementResultMatches(
              matched.result,
              context,
              "WorktreeCleanupMutationResultRecorded",
              (observation) => ({
                _tag: "AlreadyAbsent",
                branch: authorization.owner.branch,
                locator: authorization.locator,
                revision: observation["revision"]
              })
            )
          })
        }),
        Match.option,
        Option.getOrUndefined
      ),
    isPresentObservation: (event) => event._tag === "WorktreeCleanupObserved" && event.observation._tag === "Present",
    isAbsentObservation: (event) => event._tag === "WorktreeCleanupObserved" && event.observation._tag === "Absent"
  }
})

/** Reconstructs one operation-scoped worktree cleanup prefix before a retry. */
export const validateWorktreeCleanupHistory = (
  records: ReadonlyArray<JournalRecord>,
  authorization: WorktreeCleanupAuthorization
): CleanupProvenanceValidation => validateCleanupHistory(records, worktreeHistoryDescriptor(authorization))

const branchHistoryDescriptor = (
  authorization: BranchCleanupAuthorization
): CleanupHistoryDescriptor<BranchCleanupAuthorization> => ({
  data: {
    operationId: authorization.operationId,
    runId: authorization.disposition.plannedAttempt.runId,
    familyTags: [
      "BranchCleanupAuthorized",
      "BranchCleanupObservationIntended",
      "BranchCleanupObserved",
      "BranchCleanupMutationIntended",
      "BranchCleanupMutationResultRecorded",
      "BranchCleanupAbsenceConfirmed",
      "BranchCleanupContradicted",
      "BranchCleanupSettled"
    ],
    authorizationTag: "BranchCleanupAuthorized",
    observationIntentTag: "BranchCleanupObservationIntended",
    observedTag: "BranchCleanupObserved",
    mutationIntentTag: "BranchCleanupMutationIntended",
    mutationResultTag: "BranchCleanupMutationResultRecorded",
    maxMutationAttempts: cleanupMutationRequestLimit,
    absenceTag: "BranchCleanupAbsenceConfirmed",
    contradictionTag: "BranchCleanupContradicted",
    settledTag: "BranchCleanupSettled",
    authorizedKey: branchCleanupAuthorizedRecordKey(authorization.operationId),
    authorization,
    successDetail: "branch cleanup history preserves the exact authorization and chronological subject prefix"
  },
  strategies: {
    authorizationOf: branchAuthorizationOf,
    authorizationEquals: branchCleanupAuthorizationEquals,
    observationIntent: (event) =>
      Match.value(event).pipe(
        Match.tags({
          BranchCleanupObservationIntended: (matched) => ({
            key: matched.operationId + ":" + matched.ordinal,
            recordKey: branchCleanupObservationIntendedRecordKey(authorization.operationId, matched.ordinal)
          })
        }),
        Match.option,
        Option.getOrUndefined
      ),
    observationResult: (event) =>
      Match.value(event).pipe(
        Match.tags({
          BranchCleanupObserved: (matched) => ({
            key: matched.operationId + ":" + matched.ordinal,
            operationId: matched.operationId,
            recordKey: branchCleanupObservedRecordKey(authorization.operationId, matched.ordinal),
            identityMatches: branchObservationIdentityMatches(matched.observation, authorization)
          })
        }),
        Match.option,
        Option.getOrUndefined
      ),
    mutationIntent: (event) =>
      Match.value(event).pipe(
        Match.tags({
          BranchCleanupMutationIntended: (matched) => ({
            attempt: String(matched.attempt),
            operationId: matched.operationId,
            recordKey: branchCleanupMutationIntendedRecordKey(authorization.operationId, matched.attempt)
          })
        }),
        Match.option,
        Option.getOrUndefined
      ),
    mutationResult: (event) =>
      Match.value(event).pipe(
        Match.tags({
          BranchCleanupMutationResultRecorded: (matched) => ({
            attempt: String(matched.attempt),
            operationId: matched.operationId,
            recordKey: branchCleanupMutationResultRecordedRecordKey(authorization.operationId, matched.attempt),
            identityMatches: matched.result.branch === authorization.locator
          })
        }),
        Match.option,
        Option.getOrUndefined
      ),
    absence: (event, observations) =>
      Match.value(event).pipe(
        Match.tags({
          BranchCleanupAbsenceConfirmed: (matched) => {
            const key = matched.operationId + ":" + matched.ordinal
            const observedObservation = Option.fromNullishOr(observations.get(key)).pipe(
              Option.flatMap((record) =>
                Match.value(record.event).pipe(
                  Match.tags({ BranchCleanupObserved: (observed) => observed.observation }),
                  Match.option
                )
              ),
              Option.getOrUndefined
            )
            const absenceObservation: unknown = matched.observation
            return {
              key,
              recordKey: branchCleanupAbsenceConfirmedRecordKey(authorization.operationId, matched.ordinal),
              cause: matched.cause,
              identityMatches: isRecord(absenceObservation) && absenceObservation["branch"] === authorization.locator,
              observationMatches:
                observedObservation !== undefined &&
                isRecord(absenceObservation) &&
                branchObservationEqual(matched.observation, observedObservation)
            }
          }
        }),
        Match.option,
        Option.getOrUndefined
      ),
    contradiction: (event) =>
      Match.value(event).pipe(
        Match.tags({
          BranchCleanupContradicted: (matched) => ({
            recordKey: branchCleanupContradictedRecordKey(authorization.operationId),
            identityMatches: matched.observation.branch === authorization.locator,
            observationOperationId: matched.operationId
          })
        }),
        Match.option,
        Option.getOrUndefined
      ),
    settled: (event, context) =>
      Match.value(event).pipe(
        Match.tags({
          BranchCleanupSettled: (matched) => ({
            recordKey: branchCleanupSettledRecordKey(authorization.operationId),
            identityMatches: isRecord(matched.result) && matched.result["branch"] === authorization.locator,
            resultMatches: settlementResultMatches(
              matched.result,
              context,
              "BranchCleanupMutationResultRecorded",
              (observation) => ({
                _tag: "AlreadyAbsent",
                branch: authorization.locator,
                revision: observation["revision"]
              })
            )
          })
        }),
        Match.option,
        Option.getOrUndefined
      ),
    isPresentObservation: (event) => event._tag === "BranchCleanupObserved" && event.observation._tag === "Present",
    isAbsentObservation: (event) => event._tag === "BranchCleanupObserved" && event.observation._tag === "Absent"
  }
})

/** Reconstructs one operation-scoped branch cleanup prefix before a retry. */
export const validateBranchCleanupHistory = (
  records: ReadonlyArray<JournalRecord>,
  authorization: BranchCleanupAuthorization
): CleanupProvenanceValidation => validateCleanupHistory(records, branchHistoryDescriptor(authorization))

const candidateHistoryDescriptor = (
  authorization: IntegratorCandidateCleanupAuthorization
): CleanupHistoryDescriptor<IntegratorCandidateCleanupAuthorization> => ({
  data: {
    operationId: authorization.operationId,
    runId: authorization.disposition.predecessor.plannedAttempt.runId,
    familyTags: [
      "IntegratorCandidateCleanupAuthorized",
      "IntegratorCandidateCleanupObservationIntended",
      "IntegratorCandidateCleanupObserved",
      "IntegratorCandidateCleanupMutationIntended",
      "IntegratorCandidateCleanupMutationResultRecorded",
      "IntegratorCandidateCleanupAbsenceConfirmed",
      "IntegratorCandidateCleanupContradicted",
      "IntegratorCandidateCleanupSettled"
    ],
    authorizationTag: "IntegratorCandidateCleanupAuthorized",
    observationIntentTag: "IntegratorCandidateCleanupObservationIntended",
    observedTag: "IntegratorCandidateCleanupObserved",
    mutationIntentTag: "IntegratorCandidateCleanupMutationIntended",
    mutationResultTag: "IntegratorCandidateCleanupMutationResultRecorded",
    maxMutationAttempts: cleanupMutationRequestLimit,
    absenceTag: "IntegratorCandidateCleanupAbsenceConfirmed",
    contradictionTag: "IntegratorCandidateCleanupContradicted",
    settledTag: "IntegratorCandidateCleanupSettled",
    authorizedKey: integratorCandidateCleanupAuthorizedRecordKey(authorization.operationId),
    authorization,
    successDetail: "candidate cleanup history preserves the exact authorization and chronological subject prefix"
  },
  strategies: {
    authorizationOf: candidateAuthorizationOf,
    authorizationEquals: integratorCandidateCleanupAuthorizationEquals,
    observationIntent: (event) =>
      Match.value(event).pipe(
        Match.tags({
          IntegratorCandidateCleanupObservationIntended: (matched) => ({
            key: matched.operationId + ":" + matched.ordinal,
            recordKey: integratorCandidateCleanupObservationIntendedRecordKey(
              authorization.operationId,
              matched.ordinal
            )
          })
        }),
        Match.option,
        Option.getOrUndefined
      ),
    observationResult: (event) =>
      Match.value(event).pipe(
        Match.tags({
          IntegratorCandidateCleanupObserved: (matched) => ({
            key: matched.operationId + ":" + matched.ordinal,
            operationId: matched.operationId,
            recordKey: integratorCandidateCleanupObservedRecordKey(authorization.operationId, matched.ordinal),
            identityMatches: candidateObservationIdentityMatches(matched.observation, authorization)
          })
        }),
        Match.option,
        Option.getOrUndefined
      ),
    mutationIntent: (event) =>
      Match.value(event).pipe(
        Match.tags({
          IntegratorCandidateCleanupMutationIntended: (matched) => ({
            attempt: String(matched.attempt),
            operationId: matched.operationId,
            recordKey: integratorCandidateCleanupMutationIntendedRecordKey(authorization.operationId, matched.attempt)
          })
        }),
        Match.option,
        Option.getOrUndefined
      ),
    mutationResult: (event) =>
      Match.value(event).pipe(
        Match.tags({
          IntegratorCandidateCleanupMutationResultRecorded: (matched) => ({
            attempt: String(matched.attempt),
            operationId: matched.operationId,
            recordKey: integratorCandidateCleanupMutationResultRecordedRecordKey(
              authorization.operationId,
              matched.attempt
            ),
            identityMatches:
              matched.result.locator === authorization.locator &&
              matched.result.sessionId === authorization.owner.sessionId
          })
        }),
        Match.option,
        Option.getOrUndefined
      ),
    absence: (event, observations) =>
      Match.value(event).pipe(
        Match.tags({
          IntegratorCandidateCleanupAbsenceConfirmed: (matched) => {
            const key = matched.operationId + ":" + matched.ordinal
            const observedObservation = Option.fromNullishOr(observations.get(key)).pipe(
              Option.flatMap((record) =>
                Match.value(record.event).pipe(
                  Match.tags({ IntegratorCandidateCleanupObserved: (observed) => observed.observation }),
                  Match.option
                )
              ),
              Option.getOrUndefined
            )
            const absenceObservation: unknown = matched.observation
            return {
              key,
              recordKey: integratorCandidateCleanupAbsenceConfirmedRecordKey(
                authorization.operationId,
                matched.ordinal
              ),
              cause: matched.cause,
              identityMatches: isRecord(absenceObservation) && absenceObservation["locator"] === authorization.locator,
              observationMatches:
                observedObservation !== undefined &&
                isRecord(absenceObservation) &&
                candidateObservationEqual(matched.observation, observedObservation)
            }
          }
        }),
        Match.option,
        Option.getOrUndefined
      ),
    contradiction: (event) =>
      Match.value(event).pipe(
        Match.tags({
          IntegratorCandidateCleanupContradicted: (matched) => ({
            recordKey: integratorCandidateCleanupContradictedRecordKey(authorization.operationId),
            identityMatches: matched.observation.locator === authorization.locator,
            observationOperationId: matched.operationId
          })
        }),
        Match.option,
        Option.getOrUndefined
      ),
    settled: (event, context) =>
      Match.value(event).pipe(
        Match.tags({
          IntegratorCandidateCleanupSettled: (matched) => ({
            recordKey: integratorCandidateCleanupSettledRecordKey(authorization.operationId),
            identityMatches:
              isRecord(matched.result) &&
              matched.result["locator"] === authorization.locator &&
              matched.result["sessionId"] === authorization.owner.sessionId,
            resultMatches: settlementResultMatches(
              matched.result,
              context,
              "IntegratorCandidateCleanupMutationResultRecorded",
              (observation) => ({
                _tag: "AlreadyAbsent",
                locator: authorization.locator,
                revision: observation["revision"],
                sessionId: authorization.owner.sessionId
              })
            )
          })
        }),
        Match.option,
        Option.getOrUndefined
      ),
    isPresentObservation: (event) =>
      event._tag === "IntegratorCandidateCleanupObserved" && event.observation._tag === "Present",
    isAbsentObservation: (event) =>
      event._tag === "IntegratorCandidateCleanupObserved" && event.observation._tag === "Absent"
  }
})

/** Reconstructs one operation-scoped candidate cleanup prefix before a retry. */
export const validateIntegratorCandidateCleanupHistory = (
  records: ReadonlyArray<JournalRecord>,
  authorization: IntegratorCandidateCleanupAuthorization
): CleanupProvenanceValidation => validateCleanupHistory(records, candidateHistoryDescriptor(authorization))
export const validateSettledWorktreeForBranch = (
  records: ReadonlyArray<JournalRecord>,
  authorization: BranchCleanupAuthorization
): CleanupProvenanceValidation => {
  const candidates = records.filter(
    (record) =>
      record.event._tag === "WorktreeCleanupSettled" &&
      record.event.authorization.operationId === authorization.worktreeCleanupOperationId
  )
  if (candidates.length !== 1) {
    return invalid("branch cleanup requires one exact settled worktree record")
  }
  const settled = candidates[0]
  if (settled?.event._tag !== "WorktreeCleanupSettled") {
    return invalid("branch cleanup cannot begin before the exact worktree settlement")
  }
  const worktreeAuthorization = settled.event.authorization
  if (
    !plannedAttemptCleanupDispositionEquals(worktreeAuthorization.disposition, authorization.disposition) ||
    worktreeAuthorization.locator !== authorization.disposition.plannedAttempt.worktree ||
    worktreeAuthorization.owner.attemptId !== authorization.owner.attemptId ||
    worktreeAuthorization.owner.branch !== authorization.disposition.plannedAttempt.branch ||
    worktreeAuthorization.expectedHead !== authorization.expectedHead
  ) {
    return invalid("branch cleanup found a foreign worktree authorization")
  }
  const provenance = validateWorktreeCleanupProvenance(records, worktreeAuthorization)
  if (provenance._tag === "Invalid") return invalid(provenance.detail)
  const history = validateWorktreeCleanupHistory(records, settled.event.authorization)
  if (history._tag === "Invalid") return invalid(history.detail)
  const branchEvents = records.filter((record) => {
    const branchAuthorization = branchAuthorizationOf(record.event)
    return branchAuthorization?.operationId === authorization.operationId
  })
  return branchEvents.every((record) => record.position > settled.position)
    ? history
    : invalid("branch cleanup authorization or event precedes exact worktree settlement")
}
