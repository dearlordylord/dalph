/* eslint-disable functional/immutable-data -- Chronological validation owns one private per-fold causal index. */
import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import type { WorkflowJournalEvent } from "../../workflow/registry/event.js"
import { integrationCandidateCorrelationEquals } from "../../workflow/protocols/integration-candidate-construction/events.js"
import { targetVerificationCorrelationEquals } from "../../workflow/protocols/target-verification/events.js"
import {
  targetPromotionAttemptLimit,
  targetPromotionCorrelationEquals,
  targetPromotionRequestIdForCandidate,
  type TargetPromotionRequestId
} from "../../workflow/protocols/target-promotion/events.js"

type ConstructedCandidates = ReadonlyMap<
  JournalPosition,
  Extract<WorkflowJournalEvent, { readonly _tag: "IntegrationCandidateConstructed" }>
>

export interface TargetPromotionHistoryIndexes {
  readonly passedVerification: Map<
    string,
    {
      readonly event: Extract<WorkflowJournalEvent, { readonly _tag: "TargetVerificationEvidenceSealed" }>
      readonly position: JournalPosition
    }
  >
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
  passedVerification: new Map(),
  terminals: new Set()
})

/** Retains only a causally valid sealed Passed result as promotion authority. */
export const rememberPassedTargetVerification = (
  indexes: TargetPromotionHistoryIndexes,
  record: JournalRecord,
  event: Extract<WorkflowJournalEvent, { readonly _tag: "TargetVerificationEvidenceSealed" }>
): void => {
  indexes.passedVerification.set(event.correlation.requestId, { event, position: record.position })
}

const sameEvidenceReference = (
  left: { readonly byteLength: number; readonly digest: string },
  right: { readonly byteLength: number; readonly digest: string }
): boolean => left.byteLength === right.byteLength && left.digest === right.digest

// eslint-disable-next-line complexity -- Promotion intent binds candidate, verification, Git target, and deterministic request identity at once.
const invalidTargetPromotionIntent = (
  record: JournalRecord,
  event: Extract<WorkflowJournalEvent, { readonly _tag: "TargetPromotionIntended" }>,
  indexes: TargetPromotionHistoryIndexes,
  constructedCandidates: ConstructedCandidates
): string | undefined => {
  const correlation = event.correlation
  const constructed = constructedCandidates.get(correlation.candidateConstructedAt)
  const verification = indexes.passedVerification.get(correlation.verificationCorrelation.requestId)
  const duplicate = indexes.intents.has(correlation.requestId)
  indexes.intents.set(correlation.requestId, event)
  const exactCandidate =
    constructed !== undefined &&
    correlation.candidateConstructedAt < record.position &&
    constructed.candidateCommit === correlation.candidateCommit &&
    integrationCandidateCorrelationEquals(constructed.correlation, correlation.candidateCorrelation) &&
    correlation.expectedTargetHead === constructed.correlation.expectedTargetHead &&
    JSON.stringify(correlation.integrationTarget) === JSON.stringify(constructed.correlation.integrationTarget) &&
    correlation.requestId === targetPromotionRequestIdForCandidate(constructed.correlation.candidateId)
  const exactPassedVerification =
    verification !== undefined &&
    verification.position < record.position &&
    targetVerificationCorrelationEquals(verification.event.correlation, correlation.verificationCorrelation) &&
    verification.event.correlation.candidateCommit === correlation.candidateCommit &&
    verification.event.correlation.candidateConstructedAt === correlation.candidateConstructedAt &&
    integrationCandidateCorrelationEquals(
      verification.event.correlation.candidateCorrelation,
      correlation.candidateCorrelation
    ) &&
    sameEvidenceReference(verification.event.manifest, correlation.verificationManifest)
  return !duplicate && exactCandidate && exactPassedVerification
    ? undefined
    : `target promotion intent has no exact constructed candidate and earlier sealed Passed verification for request ${correlation.requestId}`
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
  if (ordinal === 1) {
    return event.reason._tag === "Initial" && event.reason.observedHeadSha === event.correlation.expectedTargetHead
  }
  return (
    event.reason._tag === "ReconciledExpectedHead" &&
    Number(event.reason.previousAttemptOrdinal) === ordinal - 1 &&
    event.reason.observedHeadSha === event.correlation.expectedTargetHead
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

const validPromotionSuccessObservation = (event: PromotionSuccess): boolean => {
  const exactObservation =
    event.observation._tag === "ReconciledCandidateAncestor"
      ? [
          event.observation.targetHeadSha !== event.correlation.candidateCommit,
          event.observation.targetHeadSha !== event.correlation.expectedTargetHead
        ].every(Boolean)
      : event.observation.targetHeadSha === event.correlation.candidateCommit
  const causalBasis = event.basis._tag === "AfterAttempt" || event.observation._tag !== "CompareAndSetApplied"
  return exactObservation && causalBasis
}

const validPromotionStaleObservation = (event: PromotionStale): boolean =>
  [
    event.observation.observedHeadSha !== event.correlation.expectedTargetHead,
    event.observation.observedHeadSha !== event.correlation.candidateCommit,
    event.basis._tag === "AfterAttempt" || event.observation._tag === "ReconciledCandidateNotInAncestry"
  ].every(Boolean)

const validPromotionNonConvergenceObservation = (event: PromotionNonConvergence): boolean =>
  Number(event.attemptOrdinal) === targetPromotionAttemptLimit &&
  (event.lastObservation._tag !== "ExpectedHeadStillObserved" ||
    event.lastObservation.observedHeadSha === event.correlation.expectedTargetHead)

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

/** Validates one promotion event against exact candidate, verification, attempt, and terminal chronology. */
export const invalidTargetPromotionHistory = (
  record: JournalRecord,
  indexes: TargetPromotionHistoryIndexes,
  constructedCandidates: ConstructedCandidates
): string | undefined => {
  const event = record.event
  if (event._tag === "TargetPromotionIntended") {
    return invalidTargetPromotionIntent(record, event, indexes, constructedCandidates)
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
