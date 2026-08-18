/* eslint-disable functional/immutable-data -- Chronological validation owns one private per-fold causal index. */
import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import type { WorkflowJournalEvent } from "../../workflow/registry/event.js"
import { integratorCandidateRecordKeyPrefix } from "../../workflow-journal/record-key.js"
import { integratorCandidateHasExactParents } from "../../workflow/protocols/integrator/events.js"
import type { IntegratorQualifiedCandidate } from "../../workflow/protocols/integrator/events.js"
import { integratorCorrelationsEqual } from "../../workflow/protocols/integrator/state.js"
import {
  targetPromotionAttemptLimit,
  targetPromotionCorrelationEquals,
  targetPromotionRequestIdForCandidate,
  type TargetPromotionRequestId
} from "../../workflow/protocols/target-promotion/events.js"

type IntegratorQualifiedObservation = ReadonlyMap<
  string,
  {
    readonly event: Extract<WorkflowJournalEvent, { readonly _tag: "IntegratorCandidateGitObserved" }>
    readonly position: JournalPosition
  }
>

type QualifiedCandidateObservation = Extract<WorkflowJournalEvent, { readonly _tag: "IntegratorCandidateGitObserved" }>

export interface TargetPromotionHistoryIndexes {
  readonly intents: Map<
    TargetPromotionRequestId,
    Extract<WorkflowJournalEvent, { readonly _tag: "TargetPromotionIntended" }>
  >
  readonly attempts: Map<
    TargetPromotionRequestId,
    Map<number, Extract<WorkflowJournalEvent, { readonly _tag: "TargetPromotionAttemptIntended" }>>
  >
  readonly terminals: Set<TargetPromotionRequestId>
}
/** Creates one explicit per-history causal index; it is never authority or persisted state. */
export const makeTargetPromotionHistoryIndexes = (): TargetPromotionHistoryIndexes => ({
  attempts: new Map(),
  intents: new Map(),
  terminals: new Set()
})

const exactQualifiedCandidatePrior = (
  record: JournalRecord,
  candidate: IntegratorQualifiedCandidate,
  observations: IntegratorQualifiedObservation
): boolean => {
  const key = integratorCandidateRecordKeyPrefix(candidate.correlation, candidate.candidateText)
  const observed = observations.get(key)
  if (observed === undefined) return false
  if (observed.position !== candidate.qualifiedAt) return false
  if (observed.position >= record.position) return false
  return exactQualifiedCandidateObservationFor(candidate, observed.event)
}

const exactQualifiedCandidateObservationFor = (
  candidate: IntegratorQualifiedCandidate,
  event: QualifiedCandidateObservation
): boolean => {
  if (!integratorCorrelationsEqual(event.correlation, candidate.correlation)) return false
  if (event.candidateText !== candidate.candidateText) return false
  if (event.observation._tag !== "Commit") return false
  return (
    event.observation.commit === candidate.candidateCommit &&
    integratorCandidateHasExactParents(
      event.observation,
      candidate.correlation.expectedTargetHead,
      candidate.correlation.acceptedResult.commit
    ) &&
    event.observation.directParents[0] === candidate.directParents[0] &&
    event.observation.directParents[1] === candidate.directParents[1]
  )
}

// The intent binds only the durable Integrator Git qualification; no candidate-agent or verification event is an input.
const invalidTargetPromotionIntent = (
  record: JournalRecord,
  event: Extract<WorkflowJournalEvent, { readonly _tag: "TargetPromotionIntended" }>,
  indexes: TargetPromotionHistoryIndexes,
  integratorObservations: IntegratorQualifiedObservation
): string | undefined => {
  const correlation = event.correlation
  const candidate = correlation.qualifiedCandidate
  const duplicate = indexes.intents.has(correlation.requestId)
  indexes.intents.set(correlation.requestId, event)
  const exactCandidate =
    !duplicate &&
    correlation.requestId === targetPromotionRequestIdForCandidate(candidate) &&
    exactQualifiedCandidatePrior(record, candidate, integratorObservations)
  return exactCandidate
    ? undefined
    : `target promotion intent has no exact earlier Integrator Git qualification for request ${correlation.requestId}`
}

const promotionAttemptsFor = (
  requestId: TargetPromotionRequestId,
  indexes: TargetPromotionHistoryIndexes
): Map<number, Extract<WorkflowJournalEvent, { readonly _tag: "TargetPromotionAttemptIntended" }>> => {
  const existing = indexes.attempts.get(requestId)
  if (existing !== undefined) return existing
  const created = new Map<number, Extract<WorkflowJournalEvent, { readonly _tag: "TargetPromotionAttemptIntended" }>>()
  indexes.attempts.set(requestId, created)
  return created
}

type PromotionAttempt = Extract<WorkflowJournalEvent, { readonly _tag: "TargetPromotionAttemptIntended" }>

const exactPromotionAttemptReason = (event: PromotionAttempt, ordinal: number): boolean => {
  const expectedHead = event.correlation.qualifiedCandidate.correlation.expectedTargetHead
  if (ordinal === 1) {
    return event.reason._tag === "Initial" && event.reason.observedHeadSha === expectedHead
  }
  return (
    event.reason._tag === "ReconciledExpectedHead" &&
    Number(event.reason.previousAttemptOrdinal) === ordinal - 1 &&
    event.reason.observedHeadSha === expectedHead
  )
}

const validPromotionAttempt = (
  event: PromotionAttempt,
  intent: Extract<WorkflowJournalEvent, { readonly _tag: "TargetPromotionIntended" }> | undefined,
  attempts: ReadonlyMap<number, PromotionAttempt>,
  terminalExists: boolean
): boolean => {
  const ordinal = Number(event.attemptOrdinal)
  return [
    intent !== undefined && targetPromotionCorrelationEquals(intent.correlation, event.correlation),
    !terminalExists,
    ordinal === attempts.size + 1,
    ordinal <= targetPromotionAttemptLimit,
    !attempts.has(ordinal),
    exactPromotionAttemptReason(event, ordinal)
  ].every(Boolean)
}

const invalidTargetPromotionAttempt = (
  event: Extract<WorkflowJournalEvent, { readonly _tag: "TargetPromotionAttemptIntended" }>,
  indexes: TargetPromotionHistoryIndexes
): string | undefined => {
  const requestId = event.correlation.requestId
  const intent = indexes.intents.get(requestId)
  const attempts = promotionAttemptsFor(requestId, indexes)
  const ordinal = Number(event.attemptOrdinal)
  const expectedOrdinal = attempts.size + 1
  const valid = validPromotionAttempt(event, intent, attempts, indexes.terminals.has(requestId))
  attempts.set(ordinal, event)
  return valid
    ? undefined
    : `target promotion attempt for request ${requestId} expected exact sequential ordinal ${expectedOrdinal} at or below ${targetPromotionAttemptLimit}`
}

type PromotionSuccess = Extract<WorkflowJournalEvent, { readonly _tag: "TargetPromotionObservedSuccess" }>
type PromotionStale = Extract<WorkflowJournalEvent, { readonly _tag: "TargetPromotionStale" }>
type PromotionNonConvergence = Extract<WorkflowJournalEvent, { readonly _tag: "TargetPromotionNonConvergence" }>
type PromotionTerminal = PromotionSuccess | PromotionStale | PromotionNonConvergence

const candidateCommitOf = (event: PromotionTerminal): string => event.correlation.qualifiedCandidate.candidateCommit
const expectedHeadOf = (event: PromotionTerminal): string =>
  event.correlation.qualifiedCandidate.correlation.expectedTargetHead

const validPromotionSuccessObservation = (event: PromotionSuccess): boolean => {
  const exactObservation =
    event.observation._tag === "ReconciledCandidateAncestor"
      ? [
          event.observation.targetHeadSha !== candidateCommitOf(event),
          event.observation.targetHeadSha !== expectedHeadOf(event)
        ].every(Boolean)
      : event.observation.targetHeadSha === candidateCommitOf(event)
  const causalBasis = event.basis._tag === "AfterAttempt" || event.observation._tag !== "CompareAndSetApplied"
  return exactObservation && causalBasis
}

const validPromotionStaleObservation = (event: PromotionStale): boolean =>
  [
    event.observation.observedHeadSha !== expectedHeadOf(event),
    event.observation.observedHeadSha !== candidateCommitOf(event),
    event.basis._tag === "AfterAttempt" || event.observation._tag === "ReconciledCandidateNotInAncestry"
  ].every(Boolean)

const validPromotionNonConvergenceObservation = (event: PromotionNonConvergence): boolean =>
  Number(event.attemptOrdinal) === targetPromotionAttemptLimit &&
  (event.lastObservation._tag !== "ExpectedHeadStillObserved" ||
    event.lastObservation.observedHeadSha === expectedHeadOf(event))

const validTargetPromotionTerminalObservation = (event: PromotionTerminal): boolean => {
  if (event._tag === "TargetPromotionObservedSuccess") return validPromotionSuccessObservation(event)
  if (event._tag === "TargetPromotionStale") return validPromotionStaleObservation(event)
  return validPromotionNonConvergenceObservation(event)
}

const terminalBasisAttempt = (
  event: PromotionTerminal,
  attempts: ReadonlyMap<number, PromotionAttempt> | undefined
): PromotionAttempt | undefined => {
  if (event._tag === "TargetPromotionNonConvergence") return attempts?.get(Number(event.attemptOrdinal))
  if (event.basis._tag === "AfterAttempt") return attempts?.get(Number(event.basis.attemptOrdinal))
  return undefined
}

const terminalBasisIsCausal = (
  event: PromotionTerminal,
  latestOrdinal: number,
  attempts: ReadonlyMap<number, PromotionAttempt> | undefined
): boolean => {
  if (event._tag === "TargetPromotionNonConvergence") {
    const ordinal = Number(event.attemptOrdinal)
    return ordinal === latestOrdinal && attempts?.has(ordinal) === true
  }
  if (event.basis._tag === "BeforeFirstAttempt") return latestOrdinal === 0
  const ordinal = Number(event.basis.attemptOrdinal)
  return ordinal === latestOrdinal && attempts?.has(ordinal) === true
}

const invalidTargetPromotionTerminal = (
  event: PromotionTerminal,
  indexes: TargetPromotionHistoryIndexes
): string | undefined => {
  const requestId = event.correlation.requestId
  const intent = indexes.intents.get(requestId)
  const attempts = indexes.attempts.get(requestId)
  const latestOrdinal = attempts?.size ?? 0
  const duplicate = indexes.terminals.has(requestId)
  indexes.terminals.add(requestId)
  const basisAttempt = terminalBasisAttempt(event, attempts)
  const valid = [
    !duplicate,
    intent !== undefined && targetPromotionCorrelationEquals(intent.correlation, event.correlation),
    basisAttempt === undefined || targetPromotionCorrelationEquals(basisAttempt.correlation, event.correlation),
    terminalBasisIsCausal(event, latestOrdinal, attempts),
    validTargetPromotionTerminalObservation(event)
  ].every(Boolean)
  return valid ? undefined : `target promotion terminal has no exact latest unresolved attempt for request ${requestId}`
}

/** Validates one promotion event against the earlier Integrator Git qualification and CAS chronology. */
export const invalidTargetPromotionHistory = (
  record: JournalRecord,
  indexes: TargetPromotionHistoryIndexes,
  integratorObservations: IntegratorQualifiedObservation
): string | undefined => {
  const event = record.event
  if (event._tag === "TargetPromotionIntended") {
    return invalidTargetPromotionIntent(record, event, indexes, integratorObservations)
  }
  if (event._tag === "TargetPromotionAttemptIntended") return invalidTargetPromotionAttempt(event, indexes)
  if (
    event._tag === "TargetPromotionObservedSuccess" ||
    event._tag === "TargetPromotionStale" ||
    event._tag === "TargetPromotionNonConvergence"
  ) {
    return invalidTargetPromotionTerminal(event, indexes)
  }
  return undefined
}
