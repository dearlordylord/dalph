/* eslint-disable max-lines -- Family-specific provenance and history checks stay co-located for auditability. */

import { plannedTaskAttemptEquivalence } from "@dalph/contracts"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import { sameAttemptChoiceRequestId, sameAttemptChoiceSubject } from "../attempt-choice/events.js"
import { integratorCorrelationsEqual, validateIntegratorSuccessorSessionFixed } from "../integrator/state.js"
import { integratorSuccessorChronologyIsValid } from "../integrator/events.js"
import {
  BranchCleanupAuthorization,
  IntegratorCandidateCleanupAuthorization,
  PlannedAttemptCleanupDisposition,
  WorktreeCleanupAuthorization,
  branchCleanupAuthorizationEquals,
  integratorCandidateCleanupAuthorizationEquals,
  plannedAttemptCleanupDispositionEquals,
  worktreeCleanupAuthorizationEquals
} from "./disposition.js"

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

const validatePlannedAttemptDisposition = (
  records: ReadonlyArray<JournalRecord>,
  disposition: PlannedAttemptCleanupDisposition,
  causalPredecessors: ReadonlyArray<unknown>
): CleanupProvenanceValidation => {
  if (disposition._tag === "Superseded") {
    const record = recordAt(records, disposition.dispositionAt)
    if (record?.event._tag !== "PlannedAttemptReplaced") {
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
    if (record?.event._tag !== "AttemptImplementationAbandoned") {
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

  const record = recordAt(records, disposition.dispositionAt)
  const operationId = record?.event && "operationId" in record.event ? record.event.operationId : undefined
  const plannedAttempt = record?.event && "plannedAttempt" in record.event ? record.event.plannedAttempt : undefined
  if (
    operationId !== disposition.settlementOperationId ||
    plannedAttempt === undefined ||
    !plannedTaskAttemptEquivalence(plannedAttempt, disposition.plannedAttempt)
  ) {
    return invalid("cleanup requires the exact durable terminal settlement occurrence")
  }
  return valid("durable terminal settlement proves the exact disposition")
}

/** Validates the terminal worktree/branch disposition before any authorization event is appended. */
export const validateWorktreeCleanupProvenance = (
  records: ReadonlyArray<JournalRecord>,
  authorization:
    | Pick<WorktreeCleanupAuthorization, "disposition" | "causalPredecessors" | "writerQuiescent">
    | Pick<
      BranchCleanupAuthorization,
      "disposition" | "causalPredecessors" | "writerQuiescent" | "worktreeCleanupOperationId"
    >
): CleanupProvenanceValidation => {
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
  authorization: Pick<IntegratorCandidateCleanupAuthorization, "disposition" | "causalPredecessors" | "writerQuiescent">
): CleanupProvenanceValidation => {
  const disposition = authorization.disposition
  const quarantine = recordAt(records, disposition.dispositionAt)
  if (
    quarantine?.event._tag !== "IntegrationQuarantined" ||
    !integratorCorrelationsEqual(quarantine.event.correlation, disposition.predecessor)
  ) {
    return invalid("candidate cleanup requires the exact durable predecessor quarantine")
  }
  const direction = recordAt(records, disposition.directionAppliedAt)
  if (
    direction?.event._tag !== "IntegrationQuarantineDirectionApplied" ||
    direction.event.fingerprint.direction !== "FullRerun" ||
    direction.event.fingerprint.quarantineAt !== disposition.dispositionAt ||
    direction.event.fingerprint.sessionId !== disposition.predecessor.sessionId
  ) {
    return invalid("candidate cleanup requires the exact applied FullRerun direction")
  }
  const directionOperationId = direction.event.requestId.nonce
  if (!operationIdsEqual(authorization.causalPredecessors, [directionOperationId])) {
    return invalid("candidate authorization does not bind the exact FullRerun request")
  }
  const successorRecord = records.find(
    (record) =>
      record.event._tag === "IntegratorSuccessorSessionFixed" &&
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

/** Reconstructs one family-specific worktree cleanup prefix before a retry. */
export const validateWorktreeCleanupHistory = (
  records: ReadonlyArray<JournalRecord>,
  authorization: WorktreeCleanupAuthorization
): CleanupProvenanceValidation => {
  const family = records.filter(({ event }) => event._tag.startsWith("WorktreeCleanup"))
  const authRecords = family.filter(
    ({ event }) =>
      event._tag === "WorktreeCleanupAuthorized" && event.authorization.operationId === authorization.operationId
  )
  if (
    authRecords.some(
      ({ event }) =>
        event._tag === "WorktreeCleanupAuthorized" &&
        !worktreeCleanupAuthorizationEquals(event.authorization, authorization)
    )
  ) {
    return invalid("worktree cleanup history contains a foreign authorization")
  }
  for (const record of family) {
    const event = record.event
    if (event._tag === "WorktreeCleanupObserved") {
      const intent = family.find(
        (candidate) =>
          candidate.event._tag === "WorktreeCleanupObservationIntended" &&
          candidate.position < record.position &&
          worktreeCleanupAuthorizationEquals(candidate.event.authorization, authorization) &&
          candidate.event.operationId === event.operationId &&
          candidate.event.ordinal === event.ordinal
      )
      if (intent === undefined || !worktreeCleanupAuthorizationEquals(event.authorization, authorization)) {
        return invalid("worktree observation result has no exact preceding intent")
      }
    }
    if (event._tag === "WorktreeCleanupMutationResultRecorded") {
      const intent = family.find(
        (candidate) =>
          candidate.event._tag === "WorktreeCleanupMutationIntended" &&
          candidate.position < record.position &&
          worktreeCleanupAuthorizationEquals(candidate.event.authorization, authorization) &&
          candidate.event.operationId === event.operationId &&
          candidate.event.attempt === event.attempt
      )
      if (
        intent === undefined ||
        !worktreeCleanupAuthorizationEquals(event.authorization, authorization) ||
        event.result.locator !== authorization.locator ||
        event.result.branch !== authorization.owner.branch
      ) {
        return invalid("worktree mutation result has no exact intent or subject identity")
      }
    }
    if (event._tag === "WorktreeCleanupAbsenceConfirmed") {
      const observed = family.find(
        (candidate) =>
          candidate.event._tag === "WorktreeCleanupObserved" &&
          worktreeCleanupAuthorizationEquals(candidate.event.authorization, authorization) &&
          candidate.event.operationId === event.operationId &&
          candidate.event.ordinal === event.ordinal &&
          candidate.event.observation._tag === "Absent"
      )
      if (observed === undefined || !hasAbsenceCause(family, authorization.operationId, event.cause, record.position)) {
        return invalid("worktree absence confirmation is not backed by the exact fresh observation and cause")
      }
    }
    if (event._tag === "WorktreeCleanupSettled") {
      const absence = family.some(
        (candidate) =>
          candidate.event._tag === "WorktreeCleanupAbsenceConfirmed" &&
          candidate.position < record.position &&
          worktreeCleanupAuthorizationEquals(candidate.event.authorization, authorization)
      )
      if (!absence || !worktreeCleanupAuthorizationEquals(event.authorization, authorization)) {
        return invalid("worktree settlement is missing its exact absence confirmation")
      }
    }
  }
  return valid("worktree cleanup history preserves intent, observation, mutation, absence, and settlement order")
}

/** Reconstructs one family-specific branch cleanup prefix before a retry. */
export const validateBranchCleanupHistory = (
  records: ReadonlyArray<JournalRecord>,
  authorization: BranchCleanupAuthorization
): CleanupProvenanceValidation => {
  const family = records.filter(({ event }) => event._tag.startsWith("BranchCleanup"))
  for (const record of family) {
    const event = record.event
    if (event._tag === "BranchCleanupObserved") {
      const intent = family.some(
        (candidate) =>
          candidate.event._tag === "BranchCleanupObservationIntended" &&
          candidate.position < record.position &&
          branchCleanupAuthorizationEquals(candidate.event.authorization, authorization) &&
          candidate.event.operationId === event.operationId &&
          candidate.event.ordinal === event.ordinal
      )
      if (!intent || !branchCleanupAuthorizationEquals(event.authorization, authorization)) {
        return invalid("branch observation result has no exact preceding intent")
      }
    }
    if (event._tag === "BranchCleanupMutationResultRecorded") {
      const intent = family.some(
        (candidate) =>
          candidate.event._tag === "BranchCleanupMutationIntended" &&
          candidate.position < record.position &&
          branchCleanupAuthorizationEquals(candidate.event.authorization, authorization) &&
          candidate.event.operationId === event.operationId &&
          candidate.event.attempt === event.attempt
      )
      if (
        !intent ||
        !branchCleanupAuthorizationEquals(event.authorization, authorization) ||
        event.result.branch !== authorization.locator
      ) {
        return invalid("branch mutation result has no exact intent or subject identity")
      }
    }
    if (event._tag === "BranchCleanupAbsenceConfirmed") {
      const observed = family.some(
        (candidate) =>
          candidate.event._tag === "BranchCleanupObserved" &&
          branchCleanupAuthorizationEquals(candidate.event.authorization, authorization) &&
          candidate.event.operationId === event.operationId &&
          candidate.event.ordinal === event.ordinal &&
          candidate.event.observation._tag === "Absent"
      )
      if (!observed || !hasAbsenceCause(family, authorization.operationId, event.cause, record.position)) {
        return invalid("branch absence confirmation is not backed by the exact fresh observation and cause")
      }
    }
    if (event._tag === "BranchCleanupSettled") {
      const absence = family.some(
        (candidate) =>
          candidate.event._tag === "BranchCleanupAbsenceConfirmed" &&
          candidate.position < record.position &&
          branchCleanupAuthorizationEquals(candidate.event.authorization, authorization)
      )
      if (!absence || !branchCleanupAuthorizationEquals(event.authorization, authorization)) {
        return invalid("branch settlement is missing its exact absence confirmation")
      }
    }
  }
  return valid("branch cleanup history preserves intent, observation, mutation, absence, and settlement order")
}

/** Reconstructs one family-specific candidate cleanup prefix before a retry. */
export const validateIntegratorCandidateCleanupHistory = (
  records: ReadonlyArray<JournalRecord>,
  authorization: IntegratorCandidateCleanupAuthorization
): CleanupProvenanceValidation => {
  const family = records.filter(({ event }) => event._tag.startsWith("IntegratorCandidateCleanup"))
  for (const record of family) {
    const event = record.event
    if (event._tag === "IntegratorCandidateCleanupObserved") {
      const intent = family.some(
        (candidate) =>
          candidate.event._tag === "IntegratorCandidateCleanupObservationIntended" &&
          candidate.position < record.position &&
          integratorCandidateCleanupAuthorizationEquals(candidate.event.authorization, authorization) &&
          candidate.event.operationId === event.operationId &&
          candidate.event.ordinal === event.ordinal
      )
      if (!intent || !integratorCandidateCleanupAuthorizationEquals(event.authorization, authorization)) {
        return invalid("candidate observation result has no exact preceding intent")
      }
    }
    if (event._tag === "IntegratorCandidateCleanupMutationResultRecorded") {
      const intent = family.some(
        (candidate) =>
          candidate.event._tag === "IntegratorCandidateCleanupMutationIntended" &&
          candidate.position < record.position &&
          integratorCandidateCleanupAuthorizationEquals(candidate.event.authorization, authorization) &&
          candidate.event.operationId === event.operationId &&
          candidate.event.attempt === event.attempt
      )
      if (
        !intent ||
        !integratorCandidateCleanupAuthorizationEquals(event.authorization, authorization) ||
        event.result.locator !== authorization.locator ||
        event.result.sessionId !== authorization.owner.sessionId
      ) {
        return invalid("candidate mutation result has no exact intent or subject identity")
      }
    }
    if (event._tag === "IntegratorCandidateCleanupAbsenceConfirmed") {
      const observed = family.some(
        (candidate) =>
          candidate.event._tag === "IntegratorCandidateCleanupObserved" &&
          integratorCandidateCleanupAuthorizationEquals(candidate.event.authorization, authorization) &&
          candidate.event.operationId === event.operationId &&
          candidate.event.ordinal === event.ordinal &&
          candidate.event.observation._tag === "Absent"
      )
      if (!observed || !hasAbsenceCause(family, authorization.operationId, event.cause, record.position)) {
        return invalid("candidate absence confirmation is not backed by the exact fresh observation and cause")
      }
    }
    if (event._tag === "IntegratorCandidateCleanupSettled") {
      const absence = family.some(
        (candidate) =>
          candidate.event._tag === "IntegratorCandidateCleanupAbsenceConfirmed" &&
          candidate.position < record.position &&
          integratorCandidateCleanupAuthorizationEquals(candidate.event.authorization, authorization)
      )
      if (!absence || !integratorCandidateCleanupAuthorizationEquals(event.authorization, authorization)) {
        return invalid("candidate settlement is missing its exact absence confirmation")
      }
    }
  }
  return valid("candidate cleanup history preserves intent, observation, mutation, absence, and settlement order")
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
