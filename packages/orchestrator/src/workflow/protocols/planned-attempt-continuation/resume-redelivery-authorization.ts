import { type PlannedTaskAttempt, plannedTaskAttemptEquivalence } from "@dalph/contracts"
import type { JournalPosition } from "../../../workflow-journal/identity.js"
import { exactWorkflowRunTargetForRun } from "../../../workflow-journal/run-target.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import {
  isSafeContinuationRevalidationEligibility,
  type SafeContinuationRevalidationEligibility
} from "../../../coordination/frontier/fresh-facts.js"
import { immutableSnapshot } from "../../../coordination/immutable-snapshot.js"
import { appliedTerminalChoiceFor } from "../attempt-choice/terminal-choice-authority.js"
import { plannedAttemptExecutorEvidence } from "../planned-attempt-executor-work/evidence.js"
import {
  validateContinuationClaimWitness,
  validateContinuationGraphWitness,
  validateContinuationSpecificationWitness,
  validateContinuationTargetLineageWitness,
  validateContinuationWorktreeWitness
} from "./authorization-witness-validation.js"
import { continuationTaskAuthorityFor } from "./authorization-evaluation.js"
import type { PlannedAttemptContinuationWitness } from "./events.js"
import type { ContinuationAuthorizationReason, ContinuationAuthorizationWitness } from "./protocol.js"

const PlannedAttemptResumeRedeliveryAuthorizationTypeId: unique symbol = Symbol(
  "@dalph/PlannedAttemptResumeRedeliveryAuthorization"
)
const issuedResumeRedeliveryAuthorizations = new WeakSet<object>()

/** Exact process-local authority to redeliver one already-intended Resume command. */
type PlannedAttemptResumeRedeliveryAuthorization = {
  readonly [PlannedAttemptResumeRedeliveryAuthorizationTypeId]: typeof PlannedAttemptResumeRedeliveryAuthorizationTypeId
  readonly plannedAttempt: PlannedTaskAttempt
  readonly resumeCommandOrdinal: Extract<
    SafeContinuationRevalidationEligibility["basis"],
    { readonly _tag: "ReconciledResumeStillSafe" }
  >["resumeCommandOrdinal"]
  readonly projectionOrdinal: Extract<
    SafeContinuationRevalidationEligibility["basis"],
    { readonly _tag: "ReconciledResumeStillSafe" }
  >["projectionOrdinal"]
  readonly safeProjectionObservedAt: JournalPosition
  readonly witness: PlannedAttemptContinuationWitness
}

export const isPlannedAttemptResumeRedeliveryAuthorization = (
  value: unknown
): value is PlannedAttemptResumeRedeliveryAuthorization =>
  typeof value === "object" && value !== null && issuedResumeRedeliveryAuthorizations.has(value)

type ResumeRedeliveryAuthorizationReason =
  | ContinuationAuthorizationReason
  | "ConsumedProjection"
  | "InvalidEligibility"
  | "MissingResumeIntent"
  | "StaleExecutorEvidence"

type PlannedAttemptResumeRedeliveryAuthorizationEvaluation =
  | { readonly _tag: "Authorized"; readonly authorization: PlannedAttemptResumeRedeliveryAuthorization }
  | {
      readonly _tag: "Rejected"
      readonly detail: string
      readonly reason: ResumeRedeliveryAuthorizationReason
      readonly witness?: ContinuationAuthorizationWitness | "ResumeRedeliveryBasis"
    }

type RejectedResumeRedeliveryAuthorization = Extract<
  PlannedAttemptResumeRedeliveryAuthorizationEvaluation,
  { readonly _tag: "Rejected" }
>

type ReconciledResumeStillSafeBasis = Extract<
  SafeContinuationRevalidationEligibility["basis"],
  { readonly _tag: "ReconciledResumeStillSafe" }
>

type PlannedAttemptResumeRedeliveryProofEvaluation =
  | { readonly _tag: "ValidResumeRedeliveryProof" }
  | RejectedResumeRedeliveryAuthorization

type ValidatedResumeRedeliveryProof = {
  readonly _tag: "ValidResumeRedeliveryProof"
  readonly basis: ReconciledResumeStillSafeBasis
  readonly witness: PlannedAttemptContinuationWitness
}

const reject = (
  reason: ResumeRedeliveryAuthorizationReason,
  detail: string
): RejectedResumeRedeliveryAuthorization => ({ _tag: "Rejected", detail, reason })

const evaluateResumeRedeliveryProof = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  basis: ReconciledResumeStillSafeBasis,
  witness: PlannedAttemptContinuationWitness
): ValidatedResumeRedeliveryProof | RejectedResumeRedeliveryAuthorization => {
  const immutableRunTarget = exactWorkflowRunTargetForRun(records, plannedAttempt.runId)
  if (immutableRunTarget === undefined) {
    return reject("MissingWitness", "Resume redelivery requires exactly one immutable WorkflowRunBegan target")
  }
  if (appliedTerminalChoiceFor(records, plannedAttempt) !== undefined) {
    return reject("StaleExecutorEvidence", "Resume redelivery follows an applied terminal choice")
  }
  const intended = records.findLast(
    ({ event, position }) =>
      position < basis.observedAt &&
      event._tag === "PlannedAttemptExecutorCommandIntended" &&
      event.command === "Resume" &&
      event.ordinal === basis.resumeCommandOrdinal &&
      plannedTaskAttemptEquivalence(event.plannedAttempt, plannedAttempt)
  )
  if (intended?.event._tag !== "PlannedAttemptExecutorCommandIntended") {
    return reject("MissingResumeIntent", "Resume redelivery requires its exact accepted Resume intent")
  }
  const supersededBeforeProjection =
    records.some(
      ({ event, position }) =>
        position > intended.position &&
        position < basis.observedAt &&
        plannedTaskAttemptEquivalence(
          "plannedAttempt" in event ? event.plannedAttempt : plannedAttempt,
          plannedAttempt
        ) &&
        (event._tag === "PlannedAttemptExecutorCommandIntended" ||
          event._tag === "PlannedAttemptExecutorCommandResponseObserved" ||
          event._tag === "PlannedAttemptExecutorCommandResponseContradicted")
    ) ||
    plannedAttemptExecutorEvidence(records, plannedAttempt).some(
      ({ observedAt, report }) =>
        observedAt > intended.position && observedAt < basis.observedAt && report._tag !== "ExecutorWorkSafelySuspended"
    )
  if (supersededBeforeProjection) {
    return reject("StaleExecutorEvidence", "Resume redelivery follows intervening executor command evidence")
  }
  const projection = records.find(
    ({ event, position }) =>
      position === basis.observedAt &&
      event._tag === "PlannedAttemptExecutorCommandProjectionObserved" &&
      event.commandOrdinal === basis.resumeCommandOrdinal &&
      event.projectionOrdinal === basis.projectionOrdinal &&
      plannedTaskAttemptEquivalence(event.plannedAttempt, plannedAttempt) &&
      event.observation._tag === "ExactExecutorReport" &&
      event.observation.report._tag === "ExecutorWorkSafelySuspended" &&
      event.observation.report.correlation.runId === plannedAttempt.runId &&
      event.observation.report.correlation.attemptId === plannedAttempt.attemptId
  )
  if (projection === undefined) {
    return reject("StaleExecutorEvidence", "Resume redelivery requires the exact Safe command projection")
  }
  if (
    plannedAttemptExecutorEvidence(records, plannedAttempt).some(({ observedAt }) => observedAt > basis.observedAt) ||
    records.some(
      ({ event, position }) =>
        position > basis.observedAt &&
        event._tag === "PlannedAttemptExecutorCommandIntended" &&
        (event.command === "Begin" || event.command === "Resume") &&
        plannedTaskAttemptEquivalence(event.plannedAttempt, plannedAttempt)
    )
  ) {
    return reject("StaleExecutorEvidence", "Resume redelivery eligibility was superseded by later executor evidence")
  }
  if (
    records.some(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorResumeRedeliveryIntended" &&
        plannedTaskAttemptEquivalence(event.plannedAttempt, plannedAttempt) &&
        event.commandOrdinal === basis.resumeCommandOrdinal &&
        event.projectionOrdinal === basis.projectionOrdinal &&
        event.authorization.safeProjectionObservedAt === basis.observedAt
    )
  ) {
    return reject("ConsumedProjection", "the exact reconciled Safe projection already authorized a redelivery")
  }

  const { authorizedTaskRevision, freshnessBaseline } = continuationTaskAuthorityFor(
    records,
    plannedAttempt,
    witness,
    basis.observedAt
  )
  const graph = validateContinuationGraphWitness(
    records,
    plannedAttempt,
    witness,
    freshnessBaseline,
    immutableRunTarget
  )
  if (graph._tag === "Rejected") return graph
  const specification = validateContinuationSpecificationWitness(
    records,
    plannedAttempt,
    witness,
    graph.outcome.position,
    freshnessBaseline,
    authorizedTaskRevision,
    immutableRunTarget
  )
  if (specification._tag === "Rejected") return specification
  const claim = validateContinuationClaimWitness(
    records,
    plannedAttempt,
    witness,
    specification.outcome.position,
    freshnessBaseline,
    immutableRunTarget
  )
  if (claim._tag === "Rejected") return claim
  const worktree = validateContinuationWorktreeWitness(
    records,
    plannedAttempt,
    witness,
    claim.outcome.position,
    freshnessBaseline
  )
  if (worktree._tag === "Rejected") return worktree
  const targetLineage = validateContinuationTargetLineageWitness(
    records,
    plannedAttempt,
    witness,
    worktree.outcome.position,
    freshnessBaseline
  )
  if (targetLineage._tag === "Rejected") return targetLineage

  return { _tag: "ValidResumeRedeliveryProof", basis, witness }
}

/**
 * Replay-safe proof for the raw durable redelivery identity. Callers validate
 * an existing event against only the journal prefix that precedes that event.
 */
export const evaluatePlannedAttemptResumeRedeliveryProof = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  basis: ReconciledResumeStillSafeBasis,
  witness: PlannedAttemptContinuationWitness
): PlannedAttemptResumeRedeliveryProofEvaluation => {
  const proof = evaluateResumeRedeliveryProof(records, plannedAttempt, basis, witness)
  return proof._tag === "Rejected" ? proof : { _tag: "ValidResumeRedeliveryProof" }
}

/** Proves that one issued, reserved retry eligibility may redeliver its exact original Resume. */
export const evaluatePlannedAttemptResumeRedeliveryAuthorization = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  eligibility: SafeContinuationRevalidationEligibility,
  witness: PlannedAttemptContinuationWitness
): PlannedAttemptResumeRedeliveryAuthorizationEvaluation => {
  if (
    !isSafeContinuationRevalidationEligibility(eligibility) ||
    eligibility.basis._tag !== "ReconciledResumeStillSafe" ||
    !plannedTaskAttemptEquivalence(eligibility.plannedAttempt, plannedAttempt)
  ) {
    return reject("InvalidEligibility", "Resume redelivery requires the exact issued reconciled-Safe eligibility")
  }
  const proof = evaluateResumeRedeliveryProof(records, plannedAttempt, eligibility.basis, witness)
  if (proof._tag === "Rejected") return proof
  const authorization: PlannedAttemptResumeRedeliveryAuthorization = Object.freeze({
    [PlannedAttemptResumeRedeliveryAuthorizationTypeId]: PlannedAttemptResumeRedeliveryAuthorizationTypeId,
    plannedAttempt: immutableSnapshot(plannedAttempt),
    projectionOrdinal: proof.basis.projectionOrdinal,
    resumeCommandOrdinal: proof.basis.resumeCommandOrdinal,
    safeProjectionObservedAt: proof.basis.observedAt,
    witness: immutableSnapshot(proof.witness)
  })
  issuedResumeRedeliveryAuthorizations.add(authorization)
  return { _tag: "Authorized", authorization }
}
