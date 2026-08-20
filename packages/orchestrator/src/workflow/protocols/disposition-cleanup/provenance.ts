/* eslint-disable max-lines -- Family-specific provenance and history checks stay co-located for auditability. */

import { plannedTaskAttemptEquivalence } from "@dalph/contracts"
import { Schema } from "effect"
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
  integrationProviderRunActivityAbsentRecordKey,
  integrationQuarantineDirectionAppliedRecordKey,
  integrationQuarantinedRecordKey,
  integratorSuccessorSessionFixedRecordKey,
  integratorRunStartedRecordKey,
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
import { integratorCorrelationsEqual, validateIntegratorSuccessorSessionFixed } from "../integrator/state.js"
import {
  IntegratorRunCorrelation,
  IntegratorRunOrdinal,
  integratorSuccessorChronologyIsValid,
  integratorRunCorrelationsEqual
} from "../integrator/events.js"
import { integrationQuarantineDirectionSubject } from "../integration-quarantine/events.js"
import { plannedAttemptWorktreeObservationMatchesPlan } from "../planned-attempt-worktree-observation/protocol.js"
import {
  BranchCleanupAuthorization,
  IntegratorCandidateCleanupAuthorization,
  WorktreeCleanupAuthorization,
  branchCleanupAuthorizationEquals,
  integratorCandidateCleanupAuthorizationEquals,
  cleanupMutationRequestLimit,
  plannedAttemptCleanupDispositionEquals,
  worktreeCleanupAuthorizationEquals
} from "./disposition.js"
import type { PlannedAttemptCleanupDisposition } from "./disposition.js"

/** Result of checking the durable upstream facts before cleanup authorization. */
export type CleanupProvenanceValidation =
  | { readonly _tag: "Valid"; readonly detail: string }
  | { readonly _tag: "Invalid"; readonly detail: string }

const valid = (detail: string): CleanupProvenanceValidation => ({ _tag: "Valid", detail })
const invalid = (detail: string): CleanupProvenanceValidation => ({ _tag: "Invalid", detail })
const latestElementOffset = -1

const recordAt = (records: ReadonlyArray<JournalRecord>, position: JournalPosition): JournalRecord | undefined =>
  records.find((record) => record.position === position)

const operationIdsEqual = (left: ReadonlyArray<unknown>, right: ReadonlyArray<unknown>): boolean =>
  left.length === right.length && left.every((operationId, index) => operationId === right[index])

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
    if (!plannedTaskAttemptEquivalence(replacement.subject.plannedAttempt, disposition.plannedAttempt)) {
      return invalid("replacement provenance names a foreign predecessor attempt")
    }
    if (!plannedTaskAttemptEquivalence(replacement.successorPlan.plannedAttempt, disposition.successorAttempt)) {
      return invalid("replacement provenance names a foreign successor attempt")
    }
    const appliedRestart = records.find((candidate) => {
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
  const quarantine = recordAt(records, disposition.dispositionAt)
  if (
    quarantine?.event._tag !== "IntegrationQuarantined" ||
    quarantine.runId !== disposition.predecessor.plannedAttempt.runId ||
    quarantine.key !== integrationQuarantinedRecordKey(disposition.predecessor.sessionId, quarantine.event.basis) ||
    !integratorCorrelationsEqual(quarantine.event.correlation, disposition.predecessor)
  ) {
    return invalid("candidate cleanup requires the exact durable predecessor quarantine")
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
  if (quarantine.event.basis._tag !== "ProviderRunFailure") {
    return invalid("candidate cleanup requires canonical provider-activity absence evidence for the quarantine")
  }
  const providerFailureBasis = quarantine.event.basis
  const predecessorRun = IntegratorRunCorrelation.make({
    ordinal: IntegratorRunOrdinal.make(1),
    session: disposition.predecessor
  })
  const activityAbsence = records.find(
    (record) =>
      record.event._tag === "IntegrationProviderRunActivityAbsent" &&
      record.position === providerFailureBasis.ownedActivityProvenAbsentAt &&
      record.position < quarantine.position &&
      record.runId === disposition.predecessor.plannedAttempt.runId &&
      record.key === integrationProviderRunActivityAbsentRecordKey(predecessorRun) &&
      integratorRunCorrelationsEqual(record.event.run, predecessorRun) &&
      integratorCorrelationsEqual(record.event.correlation, disposition.predecessor) &&
      record.event.detail === providerFailureBasis.detail
  )
  if (activityAbsence === undefined) {
    return invalid("candidate cleanup quarantine lacks the exact provider activity-absence witness")
  }
  const predecessorRunStart = records.find(
    (record) =>
      record.event._tag === "IntegratorRunStarted" &&
      record.position < activityAbsence.position &&
      record.runId === disposition.predecessor.plannedAttempt.runId &&
      record.key === integratorRunStartedRecordKey(predecessorRun) &&
      integratorRunCorrelationsEqual(record.event.run, predecessorRun)
  )
  if (predecessorRunStart === undefined) {
    return invalid("candidate cleanup provider activity-absence witness lacks the exact predecessor run start")
  }
  const conflictingPredecessorRunEvidence = records.some(
    (record) =>
      (record.event._tag === "IntegratorRunResultRecorded" ||
        record.event._tag === "IntegratorRunCandidateGitReadIntended" ||
        record.event._tag === "IntegratorRunCandidateGitObserved") &&
      integratorRunCorrelationsEqual(record.event.run, predecessorRun)
  )
  if (conflictingPredecessorRunEvidence) {
    return invalid("candidate cleanup provider activity-absence contradicts predecessor run evidence")
  }
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
  const directionOperationId = direction.event.requestId.nonce
  if (!operationIdsEqual(authorization.causalPredecessors, [directionOperationId])) {
    return invalid("candidate authorization does not bind the exact FullRerun request")
  }
  const successorRecord = records.find(
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
  if (successorRecord?.event._tag !== "IntegratorSuccessorSessionFixed") {
    return invalid("candidate cleanup requires the exact durable predecessor-successor relation")
  }
  if (
    !integratorSuccessorChronologyIsValid({
      predecessor: disposition.predecessor,
      quarantineAt: disposition.dispositionAt,
      directionAppliedAt: disposition.directionAppliedAt,
      successor: disposition.successor
    })
  ) {
    return invalid("candidate cleanup successor chronology is not Q < D < fresh lineage")
  }
  if (successorRecord.position <= disposition.successor.targetLineageObservedAt) {
    return invalid("candidate cleanup successor settlement witness does not follow its fresh target-lineage read")
  }
  const canonical = validateIntegratorSuccessorSessionFixed(records, disposition.predecessor, disposition.successor)
  return canonical._tag === "Valid"
    ? valid("durable quarantine, FullRerun direction, and canonical successor prove candidate disposition")
    : invalid(canonical.detail)
}

const hasAbsenceCause = (
  records: ReadonlyArray<JournalRecord>,
  operationId: string,
  cause: "InitialAbsence" | "MutationResponseReconciliation",
  beforePosition: JournalPosition
): boolean => {
  const mutationExists = records.some((record) => {
    if (record.position >= beforePosition) return false
    const event = record.event
    if (event._tag === "WorktreeCleanupMutationIntended") return event.authorization.operationId === operationId
    if (event._tag === "BranchCleanupMutationIntended") return event.authorization.operationId === operationId
    if (event._tag === "IntegratorCandidateCleanupMutationIntended") {
      return event.authorization.operationId === operationId
    }
    return false
  })
  return cause === (mutationExists ? "MutationResponseReconciliation" : "InitialAbsence")
}

const eventAuthorization = (event: JournalRecord["event"]): unknown =>
  "authorization" in event ? event.authorization : undefined

const eventOperationId = (event: JournalRecord["event"]): string | undefined => {
  const authorization = eventAuthorization(event)
  if (typeof authorization !== "object" || authorization === null || !("operationId" in authorization)) return undefined
  return typeof authorization.operationId === "string" ? authorization.operationId : undefined
}

const validateAuthorizationPrefix = (input: {
  readonly records: ReadonlyArray<JournalRecord>
  readonly operationId: string
  readonly runId: string
  readonly familyTags: ReadonlyArray<string>
  readonly authorizedTag: string
  readonly authorizedKey: JournalRecord["key"]
  readonly authorization: unknown
  readonly equals: (candidate: unknown, expected: unknown) => boolean
}):
  | {
      readonly _tag: "Valid"
      readonly family: ReadonlyArray<JournalRecord>
      readonly authorizationAt?: JournalPosition
    }
  | { readonly _tag: "Invalid"; readonly detail: string } => {
  const family = input.records
    .filter(
      (record) => input.familyTags.includes(record.event._tag) && eventOperationId(record.event) === input.operationId
    )
    .toSorted((left, right) => Number(left.position) - Number(right.position))
  if (family.length === 0) return { _tag: "Valid", family }
  const authorized = family.filter(({ event }) => event._tag === input.authorizedTag)
  if (authorized.length === 0) {
    return {
      _tag: "Invalid",
      detail: "cleanup history contains family events without an earlier CleanupAuthorized event"
    }
  }
  if (authorized.length !== 1) {
    return { _tag: "Invalid", detail: "cleanup history contains duplicate authorization records for one operation" }
  }
  const record = authorized[0]
  if (record === undefined) {
    return { _tag: "Invalid", detail: "cleanup history authorization record disappeared during reconstruction" }
  }
  const recordAuthorization = eventAuthorization(record.event)
  if (
    record.runId !== input.runId ||
    record.key !== input.authorizedKey ||
    !input.equals(recordAuthorization, input.authorization)
  ) {
    return { _tag: "Invalid", detail: "cleanup history contains a foreign or mis-keyed authorization" }
  }
  if (family.some(({ position }) => position < record.position)) {
    return { _tag: "Invalid", detail: "cleanup history contains a family event before CleanupAuthorized" }
  }
  return { _tag: "Valid", family, authorizationAt: record.position }
}

const recordHasExactRunAndKey = (record: JournalRecord, runId: string, key: JournalRecord["key"]): boolean =>
  record.runId === runId && record.key === key

const mapWith = <K, V>(map: ReadonlyMap<K, V>, key: K, value: V): ReadonlyMap<K, V> =>
  new Map<K, V>([...map, [key, value]])

/** Reconstructs one operation-scoped worktree cleanup prefix before a retry. */
export const validateWorktreeCleanupHistory = (
  records: ReadonlyArray<JournalRecord>,
  authorization: WorktreeCleanupAuthorization
): CleanupProvenanceValidation => {
  const prefix = validateAuthorizationPrefix({
    records,
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
    authorizedTag: "WorktreeCleanupAuthorized",
    authorizedKey: worktreeCleanupAuthorizedRecordKey(authorization.operationId),
    authorization,
    equals: (candidate, expected) =>
      candidate !== undefined &&
      Schema.is(WorktreeCleanupAuthorization)(candidate) &&
      Schema.is(WorktreeCleanupAuthorization)(expected) &&
      worktreeCleanupAuthorizationEquals(candidate, expected)
  })
  if (prefix._tag === "Invalid") return prefix
  const family = prefix.family
  let intents: ReadonlyMap<string, JournalRecord> = new Map()
  let observations: ReadonlyMap<string, JournalRecord> = new Map()
  let mutations: ReadonlyMap<string, JournalRecord> = new Map()
  let settledPosition: JournalPosition | undefined
  for (const record of family) {
    const event = record.event
    if (event._tag === "WorktreeCleanupAuthorized") continue
    if (settledPosition !== undefined && event._tag !== "WorktreeCleanupContradicted") {
      return invalid("worktree cleanup history contains an event after terminal settlement")
    }
    if (event._tag === "WorktreeCleanupObservationIntended") {
      if (
        !recordHasExactRunAndKey(
          record,
          authorization.disposition.plannedAttempt.runId,
          worktreeCleanupObservationIntendedRecordKey(authorization.operationId, event.ordinal)
        ) ||
        !worktreeCleanupAuthorizationEquals(event.authorization, authorization) ||
        intents.has(`${event.operationId}:${event.ordinal}`)
      ) {
        return invalid("worktree observation intent has a foreign key, authorization, or duplicate ordinal")
      }
      intents = mapWith(intents, `${event.operationId}:${event.ordinal}`, record)
      continue
    }
    if (event._tag === "WorktreeCleanupObserved") {
      const key = `${event.operationId}:${event.ordinal}`
      const intent = intents.get(key)
      const observationIdentity =
        event.observation.locator === authorization.locator &&
        (event.observation._tag !== "Present" ||
          (event.observation.attemptId === authorization.owner.attemptId &&
            event.observation.branch === authorization.owner.branch &&
            event.observation.revision === authorization.evidenceRevision &&
            event.observation.writerQuiescent))
      if (
        intent === undefined ||
        !recordHasExactRunAndKey(
          record,
          authorization.disposition.plannedAttempt.runId,
          worktreeCleanupObservedRecordKey(authorization.operationId, event.ordinal)
        ) ||
        !worktreeCleanupAuthorizationEquals(event.authorization, authorization) ||
        !observationIdentity ||
        observations.has(key)
      ) {
        return invalid("worktree observation result has no exact preceding intent or subject identity")
      }
      observations = mapWith(observations, key, record)
      continue
    }
    if (event._tag === "WorktreeCleanupMutationIntended") {
      const latestObservation = [...observations.values()].at(latestElementOffset)
      if (
        event.attempt > cleanupMutationRequestLimit ||
        latestObservation?.event._tag !== "WorktreeCleanupObserved" ||
        latestObservation.event.observation._tag !== "Present" ||
        !worktreeCleanupAuthorizationEquals(event.authorization, authorization) ||
        !recordHasExactRunAndKey(
          record,
          authorization.disposition.plannedAttempt.runId,
          worktreeCleanupMutationIntendedRecordKey(authorization.operationId, event.attempt)
        ) ||
        mutations.has(String(event.attempt))
      ) {
        return invalid("worktree mutation intent is not preceded by exact present facts or has a foreign identity")
      }
      mutations = mapWith(mutations, String(event.attempt), record)
      continue
    }
    if (event._tag === "WorktreeCleanupMutationResultRecorded") {
      const intent = mutations.get(String(event.attempt))
      if (
        intent === undefined ||
        event.operationId !==
          (intent.event._tag === "WorktreeCleanupMutationIntended" ? intent.event.operationId : "") ||
        !recordHasExactRunAndKey(
          record,
          authorization.disposition.plannedAttempt.runId,
          worktreeCleanupMutationResultRecordedRecordKey(authorization.operationId, event.attempt)
        ) ||
        !worktreeCleanupAuthorizationEquals(event.authorization, authorization) ||
        event.result.locator !== authorization.locator ||
        event.result.branch !== authorization.owner.branch
      ) {
        return invalid("worktree mutation result has no exact preceding intent or subject identity")
      }
      continue
    }
    if (event._tag === "WorktreeCleanupAbsenceConfirmed") {
      const key = `${event.operationId}:${event.ordinal}`
      const observed = observations.get(key)
      const latestMutationResult = [...family]
        .reverse()
        .find(
          (candidate) =>
            candidate.position < record.position && candidate.event._tag === "WorktreeCleanupMutationResultRecorded"
        )
      if (
        observed?.event._tag !== "WorktreeCleanupObserved" ||
        observed.event.observation._tag !== "Absent" ||
        event.observation.locator !== authorization.locator ||
        (mutations.size > 0 &&
          (latestMutationResult === undefined || observed.position <= latestMutationResult.position)) ||
        !recordHasExactRunAndKey(
          record,
          authorization.disposition.plannedAttempt.runId,
          worktreeCleanupAbsenceConfirmedRecordKey(authorization.operationId, event.ordinal)
        ) ||
        !worktreeCleanupAuthorizationEquals(event.authorization, authorization) ||
        !hasAbsenceCause(family, authorization.operationId, event.cause, record.position)
      ) {
        return invalid("worktree absence confirmation lacks the exact fresh absence and cause")
      }
      continue
    }
    if (event._tag === "WorktreeCleanupContradicted") {
      if (
        !recordHasExactRunAndKey(
          record,
          authorization.disposition.plannedAttempt.runId,
          worktreeCleanupContradictedRecordKey(authorization.operationId)
        ) ||
        !worktreeCleanupAuthorizationEquals(event.authorization, authorization) ||
        event.observation.locator !== authorization.locator
      ) {
        return invalid("worktree contradiction has a foreign key, authorization, or locator")
      }
      continue
    }
    if (event._tag === "WorktreeCleanupSettled") {
      const absence = [...family]
        .reverse()
        .find(
          (candidate) =>
            candidate.position < record.position && candidate.event._tag === "WorktreeCleanupAbsenceConfirmed"
        )
      const latestMutationResult = [...family]
        .reverse()
        .find(
          (candidate) =>
            candidate.position < record.position && candidate.event._tag === "WorktreeCleanupMutationResultRecorded"
        )
      if (
        absence === undefined ||
        (mutations.size > 0 &&
          (latestMutationResult === undefined || absence.position <= latestMutationResult.position)) ||
        !recordHasExactRunAndKey(
          record,
          authorization.disposition.plannedAttempt.runId,
          worktreeCleanupSettledRecordKey(authorization.operationId)
        ) ||
        !worktreeCleanupAuthorizationEquals(event.authorization, authorization) ||
        event.result.locator !== authorization.locator ||
        event.result.branch !== authorization.owner.branch
      ) {
        return invalid("worktree settlement lacks the exact preceding absence and result identity")
      }
      settledPosition = record.position
    }
  }
  return valid("worktree cleanup history preserves the exact authorization and chronological subject prefix")
}

/** Reconstructs one operation-scoped branch cleanup prefix before a retry. */
export const validateBranchCleanupHistory = (
  records: ReadonlyArray<JournalRecord>,
  authorization: BranchCleanupAuthorization
): CleanupProvenanceValidation => {
  const prefix = validateAuthorizationPrefix({
    records,
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
    authorizedTag: "BranchCleanupAuthorized",
    authorizedKey: branchCleanupAuthorizedRecordKey(authorization.operationId),
    authorization,
    equals: (candidate, expected) =>
      candidate !== undefined &&
      Schema.is(BranchCleanupAuthorization)(candidate) &&
      Schema.is(BranchCleanupAuthorization)(expected) &&
      branchCleanupAuthorizationEquals(candidate, expected)
  })
  if (prefix._tag === "Invalid") return prefix
  const family = prefix.family
  let intents: ReadonlyMap<string, JournalRecord> = new Map()
  let observations: ReadonlyMap<string, JournalRecord> = new Map()
  let mutations: ReadonlyMap<string, JournalRecord> = new Map()
  let settledPosition: JournalPosition | undefined
  for (const record of family) {
    const event = record.event
    if (event._tag === "BranchCleanupAuthorized") continue
    if (settledPosition !== undefined && event._tag !== "BranchCleanupContradicted") {
      return invalid("branch cleanup history contains an event after terminal settlement")
    }
    if (event._tag === "BranchCleanupObservationIntended") {
      const key = `${event.operationId}:${event.ordinal}`
      if (
        !recordHasExactRunAndKey(
          record,
          authorization.disposition.plannedAttempt.runId,
          branchCleanupObservationIntendedRecordKey(authorization.operationId, event.ordinal)
        ) ||
        !branchCleanupAuthorizationEquals(event.authorization, authorization) ||
        intents.has(key)
      ) {
        return invalid("branch observation intent has a foreign key, authorization, or duplicate ordinal")
      }
      intents = mapWith(intents, key, record)
      continue
    }
    if (event._tag === "BranchCleanupObserved") {
      const key = `${event.operationId}:${event.ordinal}`
      const intent = intents.get(key)
      const identity =
        event.observation.branch === authorization.locator &&
        (event.observation._tag !== "Present" ||
          (event.observation.headSha === authorization.expectedHead &&
            event.observation.registeredWorktree === null &&
            event.observation.revision === authorization.evidenceRevision))
      if (
        intent === undefined ||
        !recordHasExactRunAndKey(
          record,
          authorization.disposition.plannedAttempt.runId,
          branchCleanupObservedRecordKey(authorization.operationId, event.ordinal)
        ) ||
        !branchCleanupAuthorizationEquals(event.authorization, authorization) ||
        !identity ||
        observations.has(key)
      ) {
        return invalid("branch observation result has no exact preceding intent or subject identity")
      }
      observations = mapWith(observations, key, record)
      continue
    }
    if (event._tag === "BranchCleanupMutationIntended") {
      const latestObservation = [...observations.values()].at(latestElementOffset)
      if (
        event.attempt > cleanupMutationRequestLimit ||
        latestObservation?.event._tag !== "BranchCleanupObserved" ||
        latestObservation.event.observation._tag !== "Present" ||
        !branchCleanupAuthorizationEquals(event.authorization, authorization) ||
        !recordHasExactRunAndKey(
          record,
          authorization.disposition.plannedAttempt.runId,
          branchCleanupMutationIntendedRecordKey(authorization.operationId, event.attempt)
        ) ||
        mutations.has(String(event.attempt))
      ) {
        return invalid("branch mutation intent is not preceded by exact present facts or has a foreign identity")
      }
      mutations = mapWith(mutations, String(event.attempt), record)
      continue
    }
    if (event._tag === "BranchCleanupMutationResultRecorded") {
      const intent = mutations.get(String(event.attempt))
      if (
        intent === undefined ||
        event.operationId !== (intent.event._tag === "BranchCleanupMutationIntended" ? intent.event.operationId : "") ||
        !recordHasExactRunAndKey(
          record,
          authorization.disposition.plannedAttempt.runId,
          branchCleanupMutationResultRecordedRecordKey(authorization.operationId, event.attempt)
        ) ||
        !branchCleanupAuthorizationEquals(event.authorization, authorization) ||
        event.result.branch !== authorization.locator
      ) {
        return invalid("branch mutation result has no exact preceding intent or subject identity")
      }
      continue
    }
    if (event._tag === "BranchCleanupAbsenceConfirmed") {
      const key = `${event.operationId}:${event.ordinal}`
      const observed = observations.get(key)
      const latestMutationResult = [...family]
        .reverse()
        .find(
          (candidate) =>
            candidate.position < record.position && candidate.event._tag === "BranchCleanupMutationResultRecorded"
        )
      if (
        observed?.event._tag !== "BranchCleanupObserved" ||
        observed.event.observation._tag !== "Absent" ||
        event.observation.branch !== authorization.locator ||
        (mutations.size > 0 &&
          (latestMutationResult === undefined || observed.position <= latestMutationResult.position)) ||
        !recordHasExactRunAndKey(
          record,
          authorization.disposition.plannedAttempt.runId,
          branchCleanupAbsenceConfirmedRecordKey(authorization.operationId, event.ordinal)
        ) ||
        !branchCleanupAuthorizationEquals(event.authorization, authorization) ||
        !hasAbsenceCause(family, authorization.operationId, event.cause, record.position)
      ) {
        return invalid("branch absence confirmation lacks the exact fresh absence and cause")
      }
      continue
    }
    if (event._tag === "BranchCleanupContradicted") {
      if (
        !recordHasExactRunAndKey(
          record,
          authorization.disposition.plannedAttempt.runId,
          branchCleanupContradictedRecordKey(authorization.operationId)
        ) ||
        !branchCleanupAuthorizationEquals(event.authorization, authorization) ||
        event.observation.branch !== authorization.locator
      ) {
        return invalid("branch contradiction has a foreign key, authorization, or branch")
      }
      continue
    }
    if (event._tag === "BranchCleanupSettled") {
      const absence = [...family]
        .reverse()
        .find(
          (candidate) =>
            candidate.position < record.position && candidate.event._tag === "BranchCleanupAbsenceConfirmed"
        )
      const latestMutationResult = [...family]
        .reverse()
        .find(
          (candidate) =>
            candidate.position < record.position && candidate.event._tag === "BranchCleanupMutationResultRecorded"
        )
      if (
        absence === undefined ||
        (mutations.size > 0 &&
          (latestMutationResult === undefined || absence.position <= latestMutationResult.position)) ||
        !recordHasExactRunAndKey(
          record,
          authorization.disposition.plannedAttempt.runId,
          branchCleanupSettledRecordKey(authorization.operationId)
        ) ||
        !branchCleanupAuthorizationEquals(event.authorization, authorization) ||
        event.result.branch !== authorization.locator
      ) {
        return invalid("branch settlement lacks the exact preceding absence and result identity")
      }
      settledPosition = record.position
    }
  }
  return valid("branch cleanup history preserves the exact authorization and chronological subject prefix")
}

/** Reconstructs one operation-scoped candidate cleanup prefix before a retry. */
export const validateIntegratorCandidateCleanupHistory = (
  records: ReadonlyArray<JournalRecord>,
  authorization: IntegratorCandidateCleanupAuthorization
): CleanupProvenanceValidation => {
  const prefix = validateAuthorizationPrefix({
    records,
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
    authorizedTag: "IntegratorCandidateCleanupAuthorized",
    authorizedKey: integratorCandidateCleanupAuthorizedRecordKey(authorization.operationId),
    authorization,
    equals: (candidate, expected) =>
      candidate !== undefined &&
      Schema.is(IntegratorCandidateCleanupAuthorization)(candidate) &&
      Schema.is(IntegratorCandidateCleanupAuthorization)(expected) &&
      integratorCandidateCleanupAuthorizationEquals(candidate, expected)
  })
  if (prefix._tag === "Invalid") return prefix
  const family = prefix.family
  let intents: ReadonlyMap<string, JournalRecord> = new Map()
  let observations: ReadonlyMap<string, JournalRecord> = new Map()
  let mutations: ReadonlyMap<string, JournalRecord> = new Map()
  let settledPosition: JournalPosition | undefined
  for (const record of family) {
    const event = record.event
    if (event._tag === "IntegratorCandidateCleanupAuthorized") continue
    if (settledPosition !== undefined && event._tag !== "IntegratorCandidateCleanupContradicted") {
      return invalid("candidate cleanup history contains an event after terminal settlement")
    }
    if (event._tag === "IntegratorCandidateCleanupObservationIntended") {
      const key = `${event.operationId}:${event.ordinal}`
      if (
        !recordHasExactRunAndKey(
          record,
          authorization.disposition.predecessor.plannedAttempt.runId,
          integratorCandidateCleanupObservationIntendedRecordKey(authorization.operationId, event.ordinal)
        ) ||
        !integratorCandidateCleanupAuthorizationEquals(event.authorization, authorization) ||
        intents.has(key)
      ) {
        return invalid("candidate observation intent has a foreign key, authorization, or duplicate ordinal")
      }
      intents = mapWith(intents, key, record)
      continue
    }
    if (event._tag === "IntegratorCandidateCleanupObserved") {
      const key = `${event.operationId}:${event.ordinal}`
      const intent = intents.get(key)
      const identity =
        event.observation.locator === authorization.locator &&
        (event.observation._tag !== "Present" ||
          (event.observation.sessionId === authorization.owner.sessionId &&
            event.observation.revision === authorization.evidenceRevision &&
            event.observation.writerQuiescent))
      if (
        intent === undefined ||
        !recordHasExactRunAndKey(
          record,
          authorization.disposition.predecessor.plannedAttempt.runId,
          integratorCandidateCleanupObservedRecordKey(authorization.operationId, event.ordinal)
        ) ||
        !integratorCandidateCleanupAuthorizationEquals(event.authorization, authorization) ||
        !identity ||
        observations.has(key)
      ) {
        return invalid("candidate observation result has no exact preceding intent or subject identity")
      }
      observations = mapWith(observations, key, record)
      continue
    }
    if (event._tag === "IntegratorCandidateCleanupMutationIntended") {
      const latestObservation = [...observations.values()].at(latestElementOffset)
      if (
        event.attempt > cleanupMutationRequestLimit ||
        latestObservation?.event._tag !== "IntegratorCandidateCleanupObserved" ||
        latestObservation.event.observation._tag !== "Present" ||
        !integratorCandidateCleanupAuthorizationEquals(event.authorization, authorization) ||
        !recordHasExactRunAndKey(
          record,
          authorization.disposition.predecessor.plannedAttempt.runId,
          integratorCandidateCleanupMutationIntendedRecordKey(authorization.operationId, event.attempt)
        ) ||
        mutations.has(String(event.attempt))
      ) {
        return invalid("candidate mutation intent is not preceded by exact present facts or has a foreign identity")
      }
      mutations = mapWith(mutations, String(event.attempt), record)
      continue
    }
    if (event._tag === "IntegratorCandidateCleanupMutationResultRecorded") {
      const intent = mutations.get(String(event.attempt))
      if (
        intent === undefined ||
        event.operationId !==
          (intent.event._tag === "IntegratorCandidateCleanupMutationIntended" ? intent.event.operationId : "") ||
        !recordHasExactRunAndKey(
          record,
          authorization.disposition.predecessor.plannedAttempt.runId,
          integratorCandidateCleanupMutationResultRecordedRecordKey(authorization.operationId, event.attempt)
        ) ||
        !integratorCandidateCleanupAuthorizationEquals(event.authorization, authorization) ||
        event.result.locator !== authorization.locator ||
        event.result.sessionId !== authorization.owner.sessionId
      ) {
        return invalid("candidate mutation result has no exact preceding intent or subject identity")
      }
      continue
    }
    if (event._tag === "IntegratorCandidateCleanupAbsenceConfirmed") {
      const key = `${event.operationId}:${event.ordinal}`
      const observed = observations.get(key)
      const latestMutationResult = [...family]
        .reverse()
        .find(
          (candidate) =>
            candidate.position < record.position &&
            candidate.event._tag === "IntegratorCandidateCleanupMutationResultRecorded"
        )
      if (
        observed?.event._tag !== "IntegratorCandidateCleanupObserved" ||
        observed.event.observation._tag !== "Absent" ||
        event.observation.locator !== authorization.locator ||
        (mutations.size > 0 &&
          (latestMutationResult === undefined || observed.position <= latestMutationResult.position)) ||
        !recordHasExactRunAndKey(
          record,
          authorization.disposition.predecessor.plannedAttempt.runId,
          integratorCandidateCleanupAbsenceConfirmedRecordKey(authorization.operationId, event.ordinal)
        ) ||
        !integratorCandidateCleanupAuthorizationEquals(event.authorization, authorization) ||
        !hasAbsenceCause(family, authorization.operationId, event.cause, record.position)
      ) {
        return invalid("candidate absence confirmation lacks the exact fresh absence and cause")
      }
      continue
    }
    if (event._tag === "IntegratorCandidateCleanupContradicted") {
      if (
        !recordHasExactRunAndKey(
          record,
          authorization.disposition.predecessor.plannedAttempt.runId,
          integratorCandidateCleanupContradictedRecordKey(authorization.operationId)
        ) ||
        !integratorCandidateCleanupAuthorizationEquals(event.authorization, authorization) ||
        event.observation.locator !== authorization.locator
      ) {
        return invalid("candidate contradiction has a foreign key, authorization, or locator")
      }
      continue
    }
    if (event._tag === "IntegratorCandidateCleanupSettled") {
      const absence = [...family]
        .reverse()
        .find(
          (candidate) =>
            candidate.position < record.position &&
            candidate.event._tag === "IntegratorCandidateCleanupAbsenceConfirmed"
        )
      const latestMutationResult = [...family]
        .reverse()
        .find(
          (candidate) =>
            candidate.position < record.position &&
            candidate.event._tag === "IntegratorCandidateCleanupMutationResultRecorded"
        )
      if (
        absence === undefined ||
        (mutations.size > 0 &&
          (latestMutationResult === undefined || absence.position <= latestMutationResult.position)) ||
        !recordHasExactRunAndKey(
          record,
          authorization.disposition.predecessor.plannedAttempt.runId,
          integratorCandidateCleanupSettledRecordKey(authorization.operationId)
        ) ||
        !integratorCandidateCleanupAuthorizationEquals(event.authorization, authorization) ||
        event.result.locator !== authorization.locator ||
        event.result.sessionId !== authorization.owner.sessionId
      ) {
        return invalid("candidate settlement lacks the exact preceding absence and result identity")
      }
      settledPosition = record.position
    }
  }
  return valid("candidate cleanup history preserves the exact authorization and chronological subject prefix")
}

/** The branch gate consumes this exact W1 settlement and its fresh absence proof. */
export const validateSettledWorktreeForBranch = (
  records: ReadonlyArray<JournalRecord>,
  authorization: BranchCleanupAuthorization
): CleanupProvenanceValidation => {
  const candidates = records.filter(
    (record) =>
      record.event._tag === "WorktreeCleanupSettled" &&
      record.event.authorization.operationId === authorization.worktreeCleanupOperationId
  )
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
  return history._tag === "Valid" ? history : invalid(history.detail)
}
