/* eslint-disable max-lines -- Family-specific provenance and history checks stay co-located for auditability. */

import { plannedTaskAttemptEquivalence, type PlannedTaskAttempt } from "@dalph/contracts"
import { Match } from "effect"
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
import { latestPlannedAttemptExecutorEvidence } from "../planned-attempt-executor-work/evidence.js"
import type { ActiveTaskClaim } from "../../../authorities/task-tracker/claim-mutation.js"
import type { AttemptChoiceRequestId, AttemptChoiceSubject, AttemptQuiescenceProof } from "../attempt-choice/events.js"
import { integratorCorrelationsEqual, validateIntegratorSuccessorSessionFixed } from "../integrator/state.js"
import { integratorSuccessorChronologyIsValid } from "../integrator/events.js"
import {
  IntegrationQuarantineDirectionFingerprint,
  integrationQuarantineDirectionSubject
} from "../integration-quarantine/events.js"
import {
  quarantineRecordForFingerprint,
  validateProviderRunActivityAbsent
} from "../integration-quarantine/canonical-provenance.js"
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
import type { BranchCleanupObservation } from "./branch.js"
import type { IntegratorCandidateCleanupObservation } from "./integrator-candidate.js"
import type { WorktreeCleanupObservation } from "./worktree.js"

/** Result of checking the durable upstream facts before cleanup authorization. */
export type CleanupProvenanceValidation =
  | { readonly _tag: "Valid"; readonly detail: string }
  | { readonly _tag: "Invalid"; readonly detail: string }

const valid = (detail: string): CleanupProvenanceValidation => ({ _tag: "Valid", detail })
const invalid = (detail: string): CleanupProvenanceValidation => ({ _tag: "Invalid", detail })

const recordAt = (records: ReadonlyArray<JournalRecord>, position: JournalPosition): JournalRecord | undefined =>
  records.find((record) => record.position === position)

const operationIdsEqual = (left: ReadonlyArray<unknown>, right: ReadonlyArray<unknown>): boolean =>
  left.length === right.length && left.every((operationId, index) => operationId === right[index])

const operationIdSetsEqual = (left: ReadonlyArray<unknown>, right: ReadonlyArray<unknown>): boolean =>
  left.length === right.length &&
  new Set(left).size === left.length &&
  new Set(right).size === right.length &&
  left.every((operationId) => right.includes(operationId))

type RestartApplicationRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "AttemptChoiceApplied" }>
}

type ReplacementRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "PlannedAttemptReplaced" }>
}

type ClaimRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "TaskClaimAcquired" }>
}

const exactAppliedRestart = (
  records: ReadonlyArray<JournalRecord>,
  requestId: AttemptChoiceRequestId,
  subject: AttemptChoiceSubject
): RestartApplicationRecord | undefined =>
  records.find(
    (record): record is RestartApplicationRecord =>
      record.event._tag === "AttemptChoiceApplied" &&
      record.event.choice === "RestartTaskImplementation" &&
      sameAttemptChoiceRequestId(record.event.requestId, requestId) &&
      sameAttemptChoiceSubject(record.event.subject, subject)
  )

const recordedReplacement = (
  records: ReadonlyArray<JournalRecord>,
  subject: AttemptChoiceSubject
): ReplacementRecord | undefined => {
  const replacements = records.filter(
    (record): record is ReplacementRecord =>
      record.event._tag === "PlannedAttemptReplaced" &&
      plannedTaskAttemptEquivalence(record.event.subject.plannedAttempt, subject.plannedAttempt)
  )
  return replacements.length === 1 ? replacements[0] : undefined
}

const claimAuthorityAtApplication = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  application: RestartApplicationRecord
): ActiveTaskClaim | undefined => {
  const claim = records.findLast(
    (record): record is ClaimRecord =>
      record.position <= application.position &&
      record.event._tag === "TaskClaimAcquired" &&
      record.event.claim.taskId === plannedAttempt.taskId
  )
  return claim?.event.claim
}

const proofFor = (
  evidence: ReturnType<typeof latestPlannedAttemptExecutorEvidence>
): AttemptQuiescenceProof | undefined => {
  if (evidence === undefined) return undefined
  switch (evidence.source._tag) {
    case "CommandResponse":
      return { _tag: "CommandResponse", reportOrdinal: evidence.source.ordinal }
    case "CommandProjection":
      return {
        _tag: "CommandProjection",
        commandOrdinal: evidence.source.commandOrdinal,
        projectionOrdinal: evidence.source.projectionOrdinal
      }
    case "StateProjection":
      return { _tag: "StateProjection", observationOrdinal: evidence.source.ordinal }
  }
}

const terminalRestartQuiescence = (
  evidence: NonNullable<ReturnType<typeof latestPlannedAttemptExecutorEvidence>>,
  application: RestartApplicationRecord
): boolean =>
  evidence.report._tag === "Terminal" &&
  evidence.report.result._tag !== "Completed" &&
  evidence.report.result._tag !== "Failed" &&
  evidence.observedAt > application.position

const claimsEqual = (left: ActiveTaskClaim, right: ActiveTaskClaim): boolean =>
  left.operationId === right.operationId &&
  left.owner === right.owner &&
  left.taskId === right.taskId &&
  left.token === right.token

const quiescenceProofsEqual = (left: AttemptQuiescenceProof, right: AttemptQuiescenceProof): boolean => {
  if (left._tag !== right._tag) return false
  switch (left._tag) {
    case "CommandResponse":
      return right._tag === "CommandResponse" && right.reportOrdinal === left.reportOrdinal
    case "CommandProjection":
      return (
        right._tag === "CommandProjection" &&
        right.commandOrdinal === left.commandOrdinal &&
        right.projectionOrdinal === left.projectionOrdinal
      )
    case "StateProjection":
      return right._tag === "StateProjection" && right.observationOrdinal === left.observationOrdinal
  }
}

const exactExecutorQuiescence = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  after: JournalPosition,
  before: JournalPosition,
  expected: AttemptQuiescenceProof,
  application?: ReturnType<typeof exactAppliedRestart>
): boolean => {
  const evidence = latestPlannedAttemptExecutorEvidence(
    records.filter((record) => record.position < before),
    plannedAttempt
  )
  if (evidence === undefined || evidence.observedAt <= after || evidence.observedAt >= before) return false
  const quiescent =
    evidence.report._tag === "SafelySuspended" ||
    (evidence.report._tag === "Terminal" && application === undefined) ||
    (application !== undefined && terminalRestartQuiescence(evidence, application))
  const proof = proofFor(evidence)
  return quiescent && proof !== undefined && quiescenceProofsEqual(proof, expected)
}

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
    if (canonicalReplacement !== record) {
      return invalid("replacement provenance does not resolve the exact canonical replacement record")
    }
    if (!plannedTaskAttemptEquivalence(replacement.subject.plannedAttempt, disposition.plannedAttempt)) {
      return invalid("replacement provenance names a foreign predecessor attempt")
    }
    if (!plannedTaskAttemptEquivalence(replacement.successorPlan.plannedAttempt, disposition.successorAttempt)) {
      return invalid("replacement provenance names a foreign successor attempt")
    }
    const appliedRestart = records.find((candidate): candidate is RestartApplicationRecord => {
      if (candidate.position >= record.position || candidate.event._tag !== "AttemptChoiceApplied") return false
      return (
        candidate.runId === disposition.plannedAttempt.runId &&
        candidate.key === attemptChoiceAppliedRecordKey(candidate.event.requestId) &&
        candidate.event.choice === "RestartTaskImplementation" &&
        sameAttemptChoiceRequestId(candidate.event.requestId, replacement.requestId) &&
        sameAttemptChoiceSubject(candidate.event.subject, replacement.subject)
      )
    })
    if (appliedRestart === undefined) {
      return invalid("replacement provenance lacks the exact earlier applied Restart choice")
    }
    if (
      !exactExecutorQuiescence(
        records,
        disposition.plannedAttempt,
        appliedRestart.position,
        record.position,
        replacement.witness.quiescenceProof,
        appliedRestart
      )
    ) {
      return invalid("replacement provenance lacks the exact executor quiescence proof")
    }
    const retainedClaim = claimAuthorityAtApplication(records, disposition.plannedAttempt, appliedRestart)
    if (retainedClaim === undefined || !claimsEqual(retainedClaim, replacement.witness.expectedClaim)) {
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
    if (
      record.event.proof._tag === "CommandResponse" &&
      !exactExecutorQuiescence(
        records,
        disposition.plannedAttempt,
        appliedChoice.position,
        record.position,
        record.event.proof
      )
    ) {
      return invalid("abandonment provenance lacks the exact executor quiescence proof")
    }
    if (
      record.event.proof._tag !== "CommandResponse" &&
      !exactExecutorQuiescence(
        records,
        disposition.plannedAttempt,
        appliedChoice.position,
        record.position,
        record.event.proof
      )
    ) {
      return invalid("abandonment provenance lacks the exact executor quiescence proof")
    }
    const retainedClaim = records.findLast(
      (candidate) =>
        candidate.position <= record.position &&
        candidate.event._tag === "TaskClaimAcquired" &&
        candidate.event.claim.taskId === disposition.plannedAttempt.taskId
    )
    if (
      retainedClaim?.event._tag !== "TaskClaimAcquired" ||
      !claimsEqual(retainedClaim.event.claim, abandonment.expectedClaim)
    ) {
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
  const observation = recordAt(records, authorization.observationAt)
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
  const intent = records.find(
    (record) =>
      record.position < observation.position &&
      record.runId === plannedAttempt.runId &&
      record.key === intentRecordKey(authorization.observationOperationId) &&
      record.event._tag === "GitReadIntentRecorded" &&
      record.event.operation._tag === "ReadTaskWorktree" &&
      record.event.operation.operationId === authorization.observationOperationId &&
      plannedTaskAttemptEquivalence(record.event.operation.plannedAttempt, plannedAttempt)
  )
  if (intent === undefined) {
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
  const observation = recordAt(records, authorization.observationAt)
  if (
    observation?.event._tag !== "TargetLineageObserved" ||
    observation.runId !== predecessor.plannedAttempt.runId ||
    observation.key !== outcomeRecordKey(authorization.observationOperationId) ||
    observation.event.operationId !== authorization.observationOperationId ||
    !plannedTaskAttemptEquivalence(observation.event.plannedAttempt, predecessor.plannedAttempt) ||
    observation.event.observation.plannedBaseSha !== predecessor.plannedAttempt.baseSha ||
    observation.event.observation.targetHeadSha !== predecessor.expectedTargetHead ||
    !observation.event.observation.plannedBaseIsAncestorOfTargetHead
  ) {
    return invalid("candidate cleanup authorization does not bind the exact predecessor target-lineage observation")
  }
  const intent = records.find(
    (record) =>
      record.position < observation.position &&
      record.runId === predecessor.plannedAttempt.runId &&
      record.key === intentRecordKey(authorization.observationOperationId) &&
      record.event._tag === "GitReadIntentRecorded" &&
      record.event.operation._tag === "ReadTargetLineage" &&
      record.event.operation.operationId === authorization.observationOperationId &&
      plannedTaskAttemptEquivalence(record.event.operation.plannedAttempt, predecessor.plannedAttempt) &&
      record.event.operation.integrationTarget.repository === predecessor.integrationTarget.repository &&
      record.event.operation.integrationTarget.ref === predecessor.integrationTarget.ref
  )
  if (intent === undefined) {
    return invalid("candidate cleanup authorization lacks the exact predecessor target-lineage read intent")
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
    Match.orElse(() => undefined)
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
    Match.orElse(() => undefined)
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
    Match.orElse(() => undefined)
  )

const worktreeObservationEqual = (left: WorktreeCleanupObservation, right: WorktreeCleanupObservation): boolean => {
  switch (left._tag) {
    case "Present":
      return (
        right._tag === "Present" &&
        right.attemptId === left.attemptId &&
        right.branch === left.branch &&
        right.headSha === left.headSha &&
        right.locator === left.locator &&
        right.revision === left.revision &&
        right.writerQuiescent
      )
    case "Absent":
      return right._tag === "Absent" && right.locator === left.locator && right.revision === left.revision
    case "Foreign":
      return (
        right._tag === "Foreign" &&
        right.locator === left.locator &&
        right.observedBranch === left.observedBranch &&
        right.observedHead === left.observedHead &&
        right.reason === left.reason &&
        right.revision === left.revision
      )
    case "Unregistered":
      return right._tag === "Unregistered" && right.locator === left.locator && right.revision === left.revision
    case "Unreadable":
      return right._tag === "Unreadable" && right.locator === left.locator && right.detail === left.detail
  }
}

const branchObservationEqual = (left: BranchCleanupObservation, right: BranchCleanupObservation): boolean => {
  switch (left._tag) {
    case "Present":
      return (
        right._tag === "Present" &&
        right.branch === left.branch &&
        right.headSha === left.headSha &&
        right.registeredWorktree === left.registeredWorktree &&
        right.revision === left.revision
      )
    case "Absent":
      return right._tag === "Absent" && right.branch === left.branch && right.revision === left.revision
    case "Foreign":
      return (
        right._tag === "Foreign" &&
        right.branch === left.branch &&
        right.observedHead === left.observedHead &&
        right.observedWorktree === left.observedWorktree &&
        right.reason === left.reason &&
        right.revision === left.revision
      )
    case "Unreadable":
      return right._tag === "Unreadable" && right.branch === left.branch && right.detail === left.detail
  }
}

const candidateObservationEqual = (
  left: IntegratorCandidateCleanupObservation,
  right: IntegratorCandidateCleanupObservation
): boolean => {
  switch (left._tag) {
    case "Present":
      return (
        right._tag === "Present" &&
        right.locator === left.locator &&
        right.revision === left.revision &&
        right.sessionId === left.sessionId &&
        right.writerQuiescent
      )
    case "Absent":
      return right._tag === "Absent" && right.locator === left.locator && right.revision === left.revision
    case "Foreign":
      return (
        right._tag === "Foreign" &&
        right.locator === left.locator &&
        right.observedSessionId === left.observedSessionId &&
        right.reason === left.reason &&
        right.revision === left.revision
      )
    case "Unreadable":
      return right._tag === "Unreadable" && right.locator === left.locator && right.detail === left.detail
  }
}

const eventOperationId = (event: JournalRecord["event"]): string | undefined => {
  if (!("authorization" in event)) return undefined
  const authorization = event.authorization
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
      event._tag === "WorktreeCleanupObservationIntended"
        ? {
            key: event.operationId + ":" + event.ordinal,
            recordKey: worktreeCleanupObservationIntendedRecordKey(authorization.operationId, event.ordinal)
          }
        : undefined,
    observationResult: (event) =>
      event._tag === "WorktreeCleanupObserved"
        ? {
            key: event.operationId + ":" + event.ordinal,
            operationId: event.operationId,
            recordKey: worktreeCleanupObservedRecordKey(authorization.operationId, event.ordinal),
            identityMatches:
              event.observation.locator === authorization.locator &&
              (event.observation._tag !== "Present" ||
                (event.observation.attemptId === authorization.owner.attemptId &&
                  event.observation.branch === authorization.owner.branch &&
                  event.observation.headSha === authorization.expectedHead &&
                  event.observation.revision === authorization.evidenceRevision &&
                  event.observation.writerQuiescent))
          }
        : undefined,
    mutationIntent: (event) =>
      event._tag === "WorktreeCleanupMutationIntended"
        ? {
            attempt: String(event.attempt),
            operationId: event.operationId,
            recordKey: worktreeCleanupMutationIntendedRecordKey(authorization.operationId, event.attempt)
          }
        : undefined,
    mutationResult: (event) =>
      event._tag === "WorktreeCleanupMutationResultRecorded"
        ? {
            attempt: String(event.attempt),
            operationId: event.operationId,
            recordKey: worktreeCleanupMutationResultRecordedRecordKey(authorization.operationId, event.attempt),
            identityMatches:
              event.result.locator === authorization.locator && event.result.branch === authorization.owner.branch
          }
        : undefined,
    absence: (event, observations) => {
      if (event._tag !== "WorktreeCleanupAbsenceConfirmed") return undefined
      const key = event.operationId + ":" + event.ordinal
      const observed = observations.get(key)
      const observedObservation =
        observed?.event._tag === "WorktreeCleanupObserved" ? observed.event.observation : undefined
      return {
        key,
        recordKey: worktreeCleanupAbsenceConfirmedRecordKey(authorization.operationId, event.ordinal),
        cause: event.cause,
        identityMatches: event.observation.locator === authorization.locator,
        observationMatches:
          observedObservation !== undefined && worktreeObservationEqual(event.observation, observedObservation)
      }
    },
    contradiction: (event) =>
      event._tag === "WorktreeCleanupContradicted"
        ? {
            recordKey: worktreeCleanupContradictedRecordKey(authorization.operationId),
            identityMatches: event.observation.locator === authorization.locator
          }
        : undefined,
    settled: (event) =>
      event._tag === "WorktreeCleanupSettled"
        ? {
            recordKey: worktreeCleanupSettledRecordKey(authorization.operationId),
            identityMatches:
              event.result.locator === authorization.locator && event.result.branch === authorization.owner.branch
          }
        : undefined,
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
      event._tag === "BranchCleanupObservationIntended"
        ? {
            key: event.operationId + ":" + event.ordinal,
            recordKey: branchCleanupObservationIntendedRecordKey(authorization.operationId, event.ordinal)
          }
        : undefined,
    observationResult: (event) =>
      event._tag === "BranchCleanupObserved"
        ? {
            key: event.operationId + ":" + event.ordinal,
            operationId: event.operationId,
            recordKey: branchCleanupObservedRecordKey(authorization.operationId, event.ordinal),
            identityMatches:
              event.observation.branch === authorization.locator &&
              (event.observation._tag !== "Present" ||
                (event.observation.headSha === authorization.expectedHead &&
                  event.observation.registeredWorktree === null &&
                  event.observation.revision === authorization.evidenceRevision))
          }
        : undefined,
    mutationIntent: (event) =>
      event._tag === "BranchCleanupMutationIntended"
        ? {
            attempt: String(event.attempt),
            operationId: event.operationId,
            recordKey: branchCleanupMutationIntendedRecordKey(authorization.operationId, event.attempt)
          }
        : undefined,
    mutationResult: (event) =>
      event._tag === "BranchCleanupMutationResultRecorded"
        ? {
            attempt: String(event.attempt),
            operationId: event.operationId,
            recordKey: branchCleanupMutationResultRecordedRecordKey(authorization.operationId, event.attempt),
            identityMatches: event.result.branch === authorization.locator
          }
        : undefined,
    absence: (event, observations) => {
      if (event._tag !== "BranchCleanupAbsenceConfirmed") return undefined
      const key = event.operationId + ":" + event.ordinal
      const observed = observations.get(key)
      const observedObservation =
        observed?.event._tag === "BranchCleanupObserved" ? observed.event.observation : undefined
      return {
        key,
        recordKey: branchCleanupAbsenceConfirmedRecordKey(authorization.operationId, event.ordinal),
        cause: event.cause,
        identityMatches: event.observation.branch === authorization.locator,
        observationMatches:
          observedObservation !== undefined && branchObservationEqual(event.observation, observedObservation)
      }
    },
    contradiction: (event) =>
      event._tag === "BranchCleanupContradicted"
        ? {
            recordKey: branchCleanupContradictedRecordKey(authorization.operationId),
            identityMatches: event.observation.branch === authorization.locator
          }
        : undefined,
    settled: (event) =>
      event._tag === "BranchCleanupSettled"
        ? {
            recordKey: branchCleanupSettledRecordKey(authorization.operationId),
            identityMatches: event.result.branch === authorization.locator
          }
        : undefined,
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
      event._tag === "IntegratorCandidateCleanupObservationIntended"
        ? {
            key: event.operationId + ":" + event.ordinal,
            recordKey: integratorCandidateCleanupObservationIntendedRecordKey(authorization.operationId, event.ordinal)
          }
        : undefined,
    observationResult: (event) =>
      event._tag === "IntegratorCandidateCleanupObserved"
        ? {
            key: event.operationId + ":" + event.ordinal,
            operationId: event.operationId,
            recordKey: integratorCandidateCleanupObservedRecordKey(authorization.operationId, event.ordinal),
            identityMatches:
              event.observation.locator === authorization.locator &&
              (event.observation._tag !== "Present" ||
                (event.observation.sessionId === authorization.owner.sessionId &&
                  event.observation.revision === authorization.evidenceRevision &&
                  event.observation.writerQuiescent))
          }
        : undefined,
    mutationIntent: (event) =>
      event._tag === "IntegratorCandidateCleanupMutationIntended"
        ? {
            attempt: String(event.attempt),
            operationId: event.operationId,
            recordKey: integratorCandidateCleanupMutationIntendedRecordKey(authorization.operationId, event.attempt)
          }
        : undefined,
    mutationResult: (event) =>
      event._tag === "IntegratorCandidateCleanupMutationResultRecorded"
        ? {
            attempt: String(event.attempt),
            operationId: event.operationId,
            recordKey: integratorCandidateCleanupMutationResultRecordedRecordKey(
              authorization.operationId,
              event.attempt
            ),
            identityMatches:
              event.result.locator === authorization.locator && event.result.sessionId === authorization.owner.sessionId
          }
        : undefined,
    absence: (event, observations) => {
      if (event._tag !== "IntegratorCandidateCleanupAbsenceConfirmed") return undefined
      const key = event.operationId + ":" + event.ordinal
      const observed = observations.get(key)
      const observedObservation =
        observed?.event._tag === "IntegratorCandidateCleanupObserved" ? observed.event.observation : undefined
      return {
        key,
        recordKey: integratorCandidateCleanupAbsenceConfirmedRecordKey(authorization.operationId, event.ordinal),
        cause: event.cause,
        identityMatches: event.observation.locator === authorization.locator,
        observationMatches:
          observedObservation !== undefined && candidateObservationEqual(event.observation, observedObservation)
      }
    },
    contradiction: (event) =>
      event._tag === "IntegratorCandidateCleanupContradicted"
        ? {
            recordKey: integratorCandidateCleanupContradictedRecordKey(authorization.operationId),
            identityMatches: event.observation.locator === authorization.locator
          }
        : undefined,
    settled: (event) =>
      event._tag === "IntegratorCandidateCleanupSettled"
        ? {
            recordKey: integratorCandidateCleanupSettledRecordKey(authorization.operationId),
            identityMatches:
              event.result.locator === authorization.locator && event.result.sessionId === authorization.owner.sessionId
          }
        : undefined,
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
