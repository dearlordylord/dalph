import { Schema } from "effect"
import { OperationId } from "../../identity.js"
import type { JournalPosition } from "../../../workflow-journal/identity.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import {
  branchCleanupAuthorizedRecordKey,
  integratorCandidateCleanupAuthorizedRecordKey,
  outcomeRecordKey,
  worktreeCleanupAuthorizedRecordKey
} from "../../../workflow-journal/record-key.js"
import type { PlannedAttemptWorktreeObservedEvent } from "../../registry/event.js"
import { plannedAttemptWorktreeObservationMatchesPlan } from "../planned-attempt-worktree-observation/protocol.js"
import { exactTargetLineageRecord } from "../integration-quarantine/canonical-lineage.js"
import { IntegratorRunCorrelation, integratorRetryRunOrdinal } from "../integrator/events.js"
import { evaluateIntegratorFullRerunAuthorization } from "../integrator/retry-authorization.js"
import { AttemptImplementationAbandonedEvent } from "../attempt-choice/events.js"
import { PlannedAttemptReplacedEvent } from "../attempt-choice/replacement-events.js"
import {
  BranchCleanupEvidenceRevision,
  BranchCleanupAuthorization as BranchCleanupAuthorizationSchema,
  IntegratorCandidateCleanupDisposition,
  IntegratorCandidateCleanupEvidenceRevision,
  IntegratorCandidateCleanupOwner,
  IntegratorCandidateCleanupAuthorization as IntegratorCandidateCleanupAuthorizationSchema,
  PlannedAttemptCleanupDisposition,
  plannedAttemptCleanupDispositionEquals,
  WorktreeCleanupEvidenceRevision,
  WorktreeCleanupOwner,
  WorktreeCleanupAuthorization as WorktreeCleanupAuthorizationSchema
} from "./disposition.js"
import type {
  BranchCleanupAuthorization,
  IntegratorCandidateCleanupAuthorization,
  WorktreeCleanupAuthorization
} from "./disposition.js"
import {
  validateBranchCleanupHistory,
  validateIntegratorCandidateCleanupHistory,
  validateIntegratorCandidateCleanupProvenance,
  validateWorktreeCleanupHistory,
  validateWorktreeCleanupProvenance,
  validateSettledWorktreeForBranch
} from "./provenance.js"

/**
 * A terminal event is not itself a cleanup command.  These pure derivations
 * turn only canonical replacement, abandonment, worktree settlement, and
 * FullRerun successor facts into typed authorization subjects.  A caller-made
 * disposition or resource locator never enters this module.
 */

const operationFor = (family: string, identity: string, position: JournalPosition): OperationId =>
  OperationId.make(`disposition-cleanup:${family}:${identity}:${position}`)

const candidateDispositionEquals = Schema.toEquivalence(IntegratorCandidateCleanupDisposition)

const isPlannedAttemptReplacedRecord = (
  record: JournalRecord
): record is JournalRecord & { readonly event: PlannedAttemptReplacedEvent } =>
  Schema.is(PlannedAttemptReplacedEvent)(record.event)

const isAttemptImplementationAbandonedRecord = (
  record: JournalRecord
): record is JournalRecord & { readonly event: AttemptImplementationAbandonedEvent } =>
  Schema.is(AttemptImplementationAbandonedEvent)(record.event)

const exactWorktreeAuthorityRecord = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: Extract<
    JournalRecord["event"],
    { readonly _tag: "PlannedAttemptReplaced" }
  >["subject"]["plannedAttempt"],
  operationId: OperationId,
  afterPosition?: JournalPosition
): (JournalRecord & { readonly event: typeof PlannedAttemptWorktreeObservedEvent.Type }) | undefined => {
  const candidates = records.filter(
    (record): record is JournalRecord & { readonly event: typeof PlannedAttemptWorktreeObservedEvent.Type } =>
      record.event._tag === "PlannedAttemptWorktreeObserved" &&
      record.runId === plannedAttempt.runId &&
      record.key === outcomeRecordKey(operationId) &&
      record.event.operationId === operationId &&
      (afterPosition === undefined || record.position > afterPosition) &&
      record.event.observation._tag === "PlannedWorktreeReady" &&
      plannedAttemptWorktreeObservationMatchesPlan(record.event.observation, plannedAttempt)
  )
  return candidates.length === 1 ? candidates[0] : undefined
}

const decodeWorktreeAuthorization = (value: unknown): WorktreeCleanupAuthorization | undefined =>
  Schema.is(WorktreeCleanupAuthorizationSchema)(value) ? value : undefined

const decodeBranchAuthorization = (value: unknown): BranchCleanupAuthorization | undefined =>
  Schema.is(BranchCleanupAuthorizationSchema)(value) ? value : undefined

const decodeCandidateAuthorization = (value: unknown): IntegratorCandidateCleanupAuthorization | undefined =>
  Schema.is(IntegratorCandidateCleanupAuthorizationSchema)(value) ? value : undefined

const worktreeAuthorizationFromReplacement = (
  records: ReadonlyArray<JournalRecord>,
  record: JournalRecord & {
    readonly event: Extract<JournalRecord["event"], { readonly _tag: "PlannedAttemptReplaced" }>
  }
): WorktreeCleanupAuthorization | undefined => {
  const event = record.event
  const plannedAttempt = event.subject.plannedAttempt
  const observationRecord = exactWorktreeAuthorityRecord(
    records,
    plannedAttempt,
    event.witness.oldWorktreeObservationOperationId,
    undefined
  )
  if (observationRecord === undefined || observationRecord.position >= record.position) return undefined
  const observation = observationRecord.event.observation
  if (observation._tag !== "PlannedWorktreeReady") return undefined
  const disposition = PlannedAttemptCleanupDisposition.cases.Superseded.make({
    dispositionAt: record.position,
    plannedAttempt,
    successorAttempt: event.successorPlan.plannedAttempt
  })
  return decodeWorktreeAuthorization({
    causalPredecessors: event.successorPlan.predecessorOperationIds,
    disposition,
    evidenceRevision: WorktreeCleanupEvidenceRevision.make(1),
    expectedHead: observation.headSha,
    locator: observation.worktree,
    observationAt: observationRecord.position,
    observationOperationId: event.witness.oldWorktreeObservationOperationId,
    operationId: operationFor("worktree", plannedAttempt.attemptId, record.position),
    owner: WorktreeCleanupOwner.make({ attemptId: plannedAttempt.attemptId, branch: plannedAttempt.branch }),
    writerQuiescent: true
  })
}

const worktreeAuthorizationFromAbandonment = (
  records: ReadonlyArray<JournalRecord>,
  record: JournalRecord & {
    readonly event: Extract<JournalRecord["event"], { readonly _tag: "AttemptImplementationAbandoned" }>
  }
): WorktreeCleanupAuthorization | undefined => {
  const event = record.event
  const plannedAttempt = event.subject.plannedAttempt
  const observations = records
    .filter(
      (candidate) =>
        candidate.event._tag === "PlannedAttemptWorktreeObserved" &&
        candidate.runId === plannedAttempt.runId &&
        candidate.event.observation._tag === "PlannedWorktreeReady" &&
        plannedAttemptWorktreeObservationMatchesPlan(candidate.event.observation, plannedAttempt)
    )
    .toSorted((left, right) => Number(right.position) - Number(left.position))
  const observationRecord = observations.find((candidate) => {
    if (candidate.event._tag !== "PlannedAttemptWorktreeObserved") return false
    return candidate.key === outcomeRecordKey(candidate.event.operationId)
  })
  if (observationRecord?.event._tag !== "PlannedAttemptWorktreeObserved") return undefined
  if (observationRecord.event.observation._tag !== "PlannedWorktreeReady") return undefined
  const disposition = PlannedAttemptCleanupDisposition.cases.Abandoned.make({
    dispositionAt: record.position,
    plannedAttempt,
    requestId: event.requestId
  })
  return decodeWorktreeAuthorization({
    causalPredecessors: [event.expectedClaim.operationId],
    disposition,
    evidenceRevision: WorktreeCleanupEvidenceRevision.make(1),
    expectedHead: observationRecord.event.observation.headSha,
    locator: plannedAttempt.worktree,
    observationAt: observationRecord.position,
    observationOperationId: observationRecord.event.operationId,
    operationId: operationFor("worktree", plannedAttempt.attemptId, record.position),
    owner: WorktreeCleanupOwner.make({ attemptId: plannedAttempt.attemptId, branch: plannedAttempt.branch }),
    writerQuiescent: true
  })
}

const worktreeAuthorizationsFromTerminalFacts = (
  records: ReadonlyArray<JournalRecord>
): ReadonlyArray<WorktreeCleanupAuthorization> =>
  records.flatMap((record) => {
    const authorization = isPlannedAttemptReplacedRecord(record)
      ? worktreeAuthorizationFromReplacement(records, record)
      : isAttemptImplementationAbandonedRecord(record)
        ? worktreeAuthorizationFromAbandonment(records, record)
        : undefined
    if (authorization === undefined) return []
    if (
      records.some(
        (candidate) =>
          candidate.event._tag === "WorktreeCleanupAuthorized" &&
          plannedAttemptCleanupDispositionEquals(candidate.event.authorization.disposition, authorization.disposition)
      )
    ) {
      return []
    }
    return validateWorktreeCleanupProvenance(records, authorization)._tag === "Valid" &&
      validateWorktreeCleanupHistory(records, authorization)._tag === "Valid"
      ? [authorization]
      : []
  })

const branchAuthorizationsFromSettledWorktrees = (
  records: ReadonlyArray<JournalRecord>
): ReadonlyArray<BranchCleanupAuthorization> =>
  records.flatMap((record) => {
    if (record.event._tag !== "WorktreeCleanupSettled") return []
    const worktree = record.event.authorization
    const operationId = operationFor("branch", worktree.disposition.plannedAttempt.attemptId, record.position)
    const authorization = decodeBranchAuthorization({
      causalPredecessors: [worktree.operationId, ...worktree.causalPredecessors],
      disposition: worktree.disposition,
      evidenceRevision: BranchCleanupEvidenceRevision.make(1),
      expectedHead: worktree.expectedHead,
      locator: worktree.disposition.plannedAttempt.branch,
      observationAt: worktree.observationAt,
      observationOperationId: worktree.observationOperationId,
      operationId,
      owner: { attemptId: worktree.owner.attemptId },
      worktreeCleanupOperationId: worktree.operationId,
      writerQuiescent: true
    })
    if (authorization === undefined) return []
    if (validateSettledWorktreeForBranch(records, authorization)._tag === "Invalid") return []
    if (
      records.some(
        (candidate) =>
          candidate.event._tag === "BranchCleanupAuthorized" &&
          plannedAttemptCleanupDispositionEquals(candidate.event.authorization.disposition, authorization.disposition)
      )
    ) {
      return []
    }
    return validateWorktreeCleanupProvenance(records, authorization)._tag === "Valid" &&
      validateBranchCleanupHistory(records, authorization)._tag === "Valid"
      ? [authorization]
      : []
  })

const candidateAuthorizationsFromSuccessors = (
  records: ReadonlyArray<JournalRecord>
): ReadonlyArray<IntegratorCandidateCleanupAuthorization> =>
  records.flatMap((record) => {
    if (record.event._tag !== "IntegratorSuccessorSessionFixed") return []
    const event = record.event
    const successorRun = IntegratorRunCorrelation.make({ ordinal: integratorRetryRunOrdinal, session: event.successor })
    const lineage = exactTargetLineageRecord(records, {
      expectedTargetHead: event.predecessor.expectedTargetHead,
      integrationTarget: event.predecessor.integrationTarget,
      plannedAttempt: event.predecessor.plannedAttempt,
      targetLineageObservedAt: event.predecessor.targetLineageObservedAt
    })
    if (lineage === undefined) return []
    const fullRerun = evaluateIntegratorFullRerunAuthorization(
      records,
      successorRun,
      event.predecessor,
      event.successor.targetLineageObservedAt
    )
    if (fullRerun._tag === "Rejected") return []
    const disposition = IntegratorCandidateCleanupDisposition.make({
      directionAppliedAt: event.directionAppliedAt,
      dispositionAt: event.quarantineAt,
      predecessor: event.predecessor,
      successor: event.successor
    })
    const direction = records.find(
      (candidate) =>
        candidate.event._tag === "IntegrationQuarantineDirectionApplied" &&
        candidate.position === event.directionAppliedAt
    )
    if (direction?.event._tag !== "IntegrationQuarantineDirectionApplied") return []
    const authorization = decodeCandidateAuthorization({
      causalPredecessors: [OperationId.make(direction.event.requestId.nonce)],
      disposition,
      evidenceRevision: IntegratorCandidateCleanupEvidenceRevision.make(1),
      locator: event.predecessor.candidateResource,
      observationAt: lineage.observation.position,
      observationOperationId: lineage.observation.event.operationId,
      operationId: operationFor("integrator-candidate", event.predecessor.sessionId, record.position),
      owner: IntegratorCandidateCleanupOwner.make({ sessionId: event.predecessor.sessionId }),
      writerQuiescent: true
    })
    if (authorization === undefined) return []
    if (
      records.some(
        (candidate) =>
          candidate.event._tag === "IntegratorCandidateCleanupAuthorized" &&
          candidateDispositionEquals(candidate.event.authorization.disposition, authorization.disposition)
      )
    ) {
      return []
    }
    return validateIntegratorCandidateCleanupProvenance(records, authorization)._tag === "Valid" &&
      validateIntegratorCandidateCleanupHistory(records, authorization)._tag === "Valid"
      ? [authorization]
      : []
  })

const uniqueByOperation = <Authorization extends { readonly operationId: OperationId }>(
  values: ReadonlyArray<Authorization>
): ReadonlyArray<Authorization> =>
  values.reduce<ReadonlyArray<Authorization>>(
    (unique, value) =>
      unique.some((candidate) => candidate.operationId === value.operationId) ? unique : [...unique, value],
    []
  )

export const deriveCleanupAuthorizations = (records: ReadonlyArray<JournalRecord>) => ({
  branch: uniqueByOperation(branchAuthorizationsFromSettledWorktrees(records)),
  candidate: uniqueByOperation(candidateAuthorizationsFromSuccessors(records)),
  worktree: uniqueByOperation(worktreeAuthorizationsFromTerminalFacts(records))
})

export const cleanupAuthorizationKey = (
  authorization: WorktreeCleanupAuthorization | BranchCleanupAuthorization | IntegratorCandidateCleanupAuthorization
) =>
  "worktreeCleanupOperationId" in authorization
    ? branchCleanupAuthorizedRecordKey(authorization.operationId)
    : "expectedHead" in authorization
      ? worktreeCleanupAuthorizedRecordKey(authorization.operationId)
      : integratorCandidateCleanupAuthorizedRecordKey(authorization.operationId)
