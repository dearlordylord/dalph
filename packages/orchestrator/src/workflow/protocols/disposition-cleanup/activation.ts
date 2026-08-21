import { Schema } from "effect"
import { OperationId } from "../../identity.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import {
  branchCleanupAuthorizedRecordKey,
  integratorCandidateCleanupAuthorizedRecordKey,
  outcomeRecordKey,
  worktreeCleanupAuthorizedRecordKey
} from "../../../workflow-journal/record-key.js"
import type { PlannedWorktreeReady } from "../../../authorities/git/worktree.js"
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

const operationFor = (family: string, identity: string): OperationId =>
  // The subject identity is durable across a store reopen.  Journal positions
  // are local append coordinates and therefore cannot participate in an
  // authorization identity: SQLite recovery legitimately assigns new ones.
  OperationId.make(`disposition-cleanup:${family}:${identity}`)

const candidateAuthorizationEquals = Schema.toEquivalence(IntegratorCandidateCleanupAuthorizationSchema)

const worktreeAuthorizationEquals = Schema.toEquivalence(WorktreeCleanupAuthorizationSchema)
const branchAuthorizationEquals = Schema.toEquivalence(BranchCleanupAuthorizationSchema)

type PlannedWorktreeReadyObservedEvent = Omit<typeof PlannedAttemptWorktreeObservedEvent.Type, "observation"> & {
  readonly observation: PlannedWorktreeReady
}

type AuthorizationEventTag = { readonly eventTag: string }

type AuthorizationValidationStrategy<Authorization> = AuthorizationEventTag & {
  readonly authorizationOf: (event: JournalRecord["event"]) => Authorization | undefined
  readonly equals: (candidate: Authorization, expected: Authorization) => boolean
  readonly runIdOf: (authorization: Authorization) => JournalRecord["runId"]
  readonly keyOf: (authorization: Authorization) => JournalRecord["key"]
  readonly provenance: (
    records: ReadonlyArray<JournalRecord>,
    authorization: Authorization
  ) => { readonly _tag: string }
  readonly history: (records: ReadonlyArray<JournalRecord>, authorization: Authorization) => { readonly _tag: string }
}

const hasValidatedAuthorization = <Authorization>(
  records: ReadonlyArray<JournalRecord>,
  authorization: Authorization,
  strategy: AuthorizationValidationStrategy<Authorization>
): boolean =>
  records.some((candidate) => {
    if (candidate.event._tag !== strategy.eventTag) return false
    const candidateAuthorization = strategy.authorizationOf(candidate.event)
    return (
      candidateAuthorization !== undefined &&
      strategy.equals(candidateAuthorization, authorization) &&
      candidate.runId === strategy.runIdOf(candidateAuthorization) &&
      candidate.key === strategy.keyOf(candidateAuthorization) &&
      strategy.provenance(records, candidateAuthorization)._tag === "Valid" &&
      strategy.history(records, candidateAuthorization)._tag === "Valid"
    )
  })

const worktreeAuthorizationOf = (event: JournalRecord["event"]): WorktreeCleanupAuthorization | undefined =>
  event._tag === "WorktreeCleanupAuthorized" ? event.authorization : undefined

const branchAuthorizationOf = (event: JournalRecord["event"]): BranchCleanupAuthorization | undefined =>
  event._tag === "BranchCleanupAuthorized" ? event.authorization : undefined

const candidateAuthorizationOf = (
  event: JournalRecord["event"]
): IntegratorCandidateCleanupAuthorization | undefined =>
  event._tag === "IntegratorCandidateCleanupAuthorized" ? event.authorization : undefined

const worktreeAuthorizationValidation: AuthorizationValidationStrategy<WorktreeCleanupAuthorization> = {
  eventTag: "WorktreeCleanupAuthorized",
  authorizationOf: worktreeAuthorizationOf,
  equals: worktreeAuthorizationEquals,
  runIdOf: (authorization) => authorization.disposition.plannedAttempt.runId,
  keyOf: (authorization) => worktreeCleanupAuthorizedRecordKey(authorization.operationId),
  provenance: validateWorktreeCleanupProvenance,
  history: validateWorktreeCleanupHistory
}

const branchAuthorizationValidation: AuthorizationValidationStrategy<BranchCleanupAuthorization> = {
  eventTag: "BranchCleanupAuthorized",
  authorizationOf: branchAuthorizationOf,
  equals: branchAuthorizationEquals,
  runIdOf: (authorization) => authorization.disposition.plannedAttempt.runId,
  keyOf: (authorization) => branchCleanupAuthorizedRecordKey(authorization.operationId),
  provenance: validateWorktreeCleanupProvenance,
  history: validateBranchCleanupHistory
}

const candidateAuthorizationValidation: AuthorizationValidationStrategy<IntegratorCandidateCleanupAuthorization> = {
  eventTag: "IntegratorCandidateCleanupAuthorized",
  authorizationOf: candidateAuthorizationOf,
  equals: candidateAuthorizationEquals,
  runIdOf: (authorization) => authorization.disposition.predecessor.plannedAttempt.runId,
  keyOf: (authorization) => integratorCandidateCleanupAuthorizedRecordKey(authorization.operationId),
  provenance: validateIntegratorCandidateCleanupProvenance,
  history: validateIntegratorCandidateCleanupHistory
}

const recordsWithoutAuthorizationTag = (
  records: ReadonlyArray<JournalRecord>,
  authorizationTag: "WorktreeCleanupAuthorized" | "BranchCleanupAuthorized" | "IntegratorCandidateCleanupAuthorized"
): ReadonlyArray<JournalRecord> => records.filter(({ event }) => event._tag !== authorizationTag)

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
  operationId: OperationId
): (JournalRecord & { readonly event: PlannedWorktreeReadyObservedEvent }) | undefined => {
  const candidates = records.filter(
    (record): record is JournalRecord & { readonly event: PlannedWorktreeReadyObservedEvent } =>
      record.event._tag === "PlannedAttemptWorktreeObserved" &&
      record.runId === plannedAttempt.runId &&
      record.key === outcomeRecordKey(operationId) &&
      record.event.operationId === operationId &&
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
    event.witness.oldWorktreeObservationOperationId
  )
  if (observationRecord === undefined || observationRecord.position >= record.position) return undefined
  const observation = observationRecord.event.observation
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
    operationId: operationFor("worktree", plannedAttempt.attemptId),
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
      (candidate): candidate is JournalRecord & { readonly event: PlannedWorktreeReadyObservedEvent } =>
        candidate.event._tag === "PlannedAttemptWorktreeObserved" &&
        candidate.runId === plannedAttempt.runId &&
        candidate.event.observation._tag === "PlannedWorktreeReady" &&
        plannedAttemptWorktreeObservationMatchesPlan(candidate.event.observation, plannedAttempt)
    )
    .toSorted((left, right) => Number(right.position) - Number(left.position))
  const observationRecord = observations.find((candidate) => {
    return candidate.key === outcomeRecordKey(candidate.event.operationId)
  })
  if (observationRecord === undefined) return undefined
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
    operationId: operationFor("worktree", plannedAttempt.attemptId),
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
    if (hasValidatedAuthorization(records, authorization, worktreeAuthorizationValidation)) return []
    const canonicalRecords = recordsWithoutAuthorizationTag(records, "WorktreeCleanupAuthorized")
    const provenance = validateWorktreeCleanupProvenance(canonicalRecords, authorization)
    const history = validateWorktreeCleanupHistory(canonicalRecords, authorization)
    if (provenance._tag !== "Valid" || history._tag !== "Valid") return []
    return [authorization]
  })

const branchAuthorizationsFromSettledWorktrees = (
  records: ReadonlyArray<JournalRecord>
): ReadonlyArray<BranchCleanupAuthorization> =>
  records.flatMap((record) => {
    if (record.event._tag !== "WorktreeCleanupSettled") return []
    const worktree = record.event.authorization
    const operationId = operationFor("branch", worktree.disposition.plannedAttempt.attemptId)
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
    if (hasValidatedAuthorization(records, authorization, branchAuthorizationValidation)) return []
    const canonicalRecords = recordsWithoutAuthorizationTag(records, "BranchCleanupAuthorized")
    const provenance = validateWorktreeCleanupProvenance(canonicalRecords, authorization)
    const history = validateBranchCleanupHistory(canonicalRecords, authorization)
    if (provenance._tag !== "Valid" || history._tag !== "Valid") return []
    return [authorization]
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
      operationId: operationFor("integrator-candidate", event.predecessor.sessionId),
      owner: IntegratorCandidateCleanupOwner.make({ sessionId: event.predecessor.sessionId }),
      writerQuiescent: true
    })
    if (authorization === undefined) return []
    if (hasValidatedAuthorization(records, authorization, candidateAuthorizationValidation)) return []
    const canonicalRecords = recordsWithoutAuthorizationTag(records, "IntegratorCandidateCleanupAuthorized")
    const provenance = validateIntegratorCandidateCleanupProvenance(canonicalRecords, authorization)
    const history = validateIntegratorCandidateCleanupHistory(canonicalRecords, authorization)
    if (provenance._tag !== "Valid" || history._tag !== "Valid") return []
    return [authorization]
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
