import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import type { WorkflowJournalEvent } from "../../workflow/registry/event.js"
import { HashMap, HashSet, Option } from "effect"
import { integratorRunCandidateRecordKeyPrefix } from "../../workflow-journal/record-key.js"
import {
  integratorCandidateHasExactParents,
  integratorRunCorrelationsEqual,
  type IntegratorRunQualifiedCandidate
} from "../../workflow/protocols/integrator/events.js"
import {
  targetPromotionAttemptLimit,
  targetPromotionCorrelationEquals,
  targetPromotionRequestIdForCandidate,
  type TargetPromotionRequestId
} from "../../workflow/protocols/target-promotion/events.js"

type IntegratorRunQualifiedObservation = HashMap.HashMap<
  string,
  {
    readonly event: Extract<WorkflowJournalEvent, { readonly _tag: "IntegratorRunCandidateGitObserved" }>
    readonly position: JournalPosition
  }
>

type QualifiedCandidateObservation = Extract<
  WorkflowJournalEvent,
  { readonly _tag: "IntegratorRunCandidateGitObserved" }
>

export interface TargetPromotionHistoryIndexes {
  readonly intents: HashMap.HashMap<
    TargetPromotionRequestId,
    Extract<WorkflowJournalEvent, { readonly _tag: "TargetPromotionIntended" }>
  >
  readonly attempts: HashMap.HashMap<
    TargetPromotionRequestId,
    HashMap.HashMap<number, Extract<WorkflowJournalEvent, { readonly _tag: "TargetPromotionAttemptIntended" }>>
  >
  readonly terminals: HashSet.HashSet<TargetPromotionRequestId>
}
/** Creates one explicit per-history causal index; it is never authority or persisted state. */
export const makeTargetPromotionHistoryIndexes = (): TargetPromotionHistoryIndexes => ({
  attempts: HashMap.empty(),
  intents: HashMap.empty(),
  terminals: HashSet.empty()
})

const mapGet = <Key, Value>(map: HashMap.HashMap<Key, Value>, key: Key): Value | undefined =>
  Option.getOrUndefined(HashMap.get(map, key))

const exactQualifiedCandidatePrior = (
  record: JournalRecord,
  candidate: IntegratorRunQualifiedCandidate,
  observations: IntegratorRunQualifiedObservation
): boolean => {
  const key = integratorRunCandidateRecordKeyPrefix(candidate.run, candidate.candidateText)
  const observed = mapGet(observations, key)
  if (observed === undefined) return false
  if (observed.position !== candidate.qualifiedAt) return false
  if (observed.position >= record.position) return false
  return exactQualifiedCandidateObservationFor(candidate, observed.event)
}

const exactQualifiedCandidateObservationFor = (
  candidate: IntegratorRunQualifiedCandidate,
  event: QualifiedCandidateObservation
): boolean => {
  if (!integratorRunCorrelationsEqual(event.run, candidate.run)) return false
  if (event.candidateText !== candidate.candidateText) return false
  if (event.observation._tag !== "Commit") return false
  return (
    event.observation.commit === candidate.candidateCommit &&
    integratorCandidateHasExactParents(
      event.observation,
      candidate.run.session.expectedTargetHead,
      candidate.run.session.acceptedResult.commit
    ) &&
    event.observation.directParents[0] === candidate.directParents[0] &&
    event.observation.directParents[1] === candidate.directParents[1]
  )
}

// The intent binds only the durable Integrator Git qualification; no candidate-agent or verification event is an input.
interface TargetPromotionHistoryValidation {
  readonly indexes: TargetPromotionHistoryIndexes
  readonly detail: string | undefined
}

const invalidTargetPromotionIntent = (
  record: JournalRecord,
  event: Extract<WorkflowJournalEvent, { readonly _tag: "TargetPromotionIntended" }>,
  indexes: TargetPromotionHistoryIndexes,
  integratorObservations: IntegratorRunQualifiedObservation
): TargetPromotionHistoryValidation => {
  const correlation = event.correlation
  const candidate = correlation.qualifiedCandidate
  const duplicate = HashMap.has(indexes.intents, correlation.requestId)
  const exactCandidate =
    !duplicate &&
    correlation.requestId === targetPromotionRequestIdForCandidate(candidate) &&
    exactQualifiedCandidatePrior(record, candidate, integratorObservations)
  return {
    detail: exactCandidate
      ? undefined
      : `target promotion intent has no exact earlier Integrator Git qualification for request ${correlation.requestId}`,
    indexes: { ...indexes, intents: HashMap.set(indexes.intents, correlation.requestId, event) }
  }
}

type PromotionAttempt = Extract<WorkflowJournalEvent, { readonly _tag: "TargetPromotionAttemptIntended" }>

const exactPromotionAttemptReason = (event: PromotionAttempt, ordinal: number): boolean => {
  const expectedHead = event.correlation.qualifiedCandidate.run.session.expectedTargetHead
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
  attempts: HashMap.HashMap<number, PromotionAttempt>,
  terminalExists: boolean
): boolean => {
  const ordinal = Number(event.attemptOrdinal)
  return [
    intent !== undefined && targetPromotionCorrelationEquals(intent.correlation, event.correlation),
    !terminalExists,
    ordinal === HashMap.size(attempts) + 1,
    ordinal <= targetPromotionAttemptLimit,
    !HashMap.has(attempts, ordinal),
    exactPromotionAttemptReason(event, ordinal)
  ].every(Boolean)
}

const invalidTargetPromotionAttempt = (
  event: Extract<WorkflowJournalEvent, { readonly _tag: "TargetPromotionAttemptIntended" }>,
  indexes: TargetPromotionHistoryIndexes
): TargetPromotionHistoryValidation => {
  const requestId = event.correlation.requestId
  const intent = mapGet(indexes.intents, requestId)
  const attempts = mapGet(indexes.attempts, requestId) ?? HashMap.empty<number, PromotionAttempt>()
  const ordinal = Number(event.attemptOrdinal)
  const expectedOrdinal = HashMap.size(attempts) + 1
  const valid = validPromotionAttempt(event, intent, attempts, HashSet.has(indexes.terminals, requestId))
  return {
    detail: valid
      ? undefined
      : `target promotion attempt for request ${requestId} expected exact sequential ordinal ${expectedOrdinal} at or below ${targetPromotionAttemptLimit}`,
    indexes: { ...indexes, attempts: HashMap.set(indexes.attempts, requestId, HashMap.set(attempts, ordinal, event)) }
  }
}

type PromotionSuccess = Extract<WorkflowJournalEvent, { readonly _tag: "TargetPromotionObservedSuccess" }>
type PromotionStale = Extract<WorkflowJournalEvent, { readonly _tag: "TargetPromotionStale" }>
type PromotionNonConvergence = Extract<WorkflowJournalEvent, { readonly _tag: "TargetPromotionNonConvergence" }>
type PromotionTerminal = PromotionSuccess | PromotionStale | PromotionNonConvergence

const candidateCommitOf = (event: PromotionTerminal): string => event.correlation.qualifiedCandidate.candidateCommit
const expectedHeadOf = (event: PromotionTerminal): string =>
  event.correlation.qualifiedCandidate.run.session.expectedTargetHead

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
  attempts: HashMap.HashMap<number, PromotionAttempt> | undefined
): PromotionAttempt | undefined => {
  if (event._tag === "TargetPromotionNonConvergence")
    return attempts === undefined ? undefined : mapGet(attempts, Number(event.attemptOrdinal))
  if (event.basis._tag === "AfterAttempt")
    return attempts === undefined ? undefined : mapGet(attempts, Number(event.basis.attemptOrdinal))
  return undefined
}

const terminalBasisIsCausal = (
  event: PromotionTerminal,
  latestOrdinal: number,
  attempts: HashMap.HashMap<number, PromotionAttempt> | undefined
): boolean => {
  if (event._tag === "TargetPromotionNonConvergence") {
    const ordinal = Number(event.attemptOrdinal)
    return ordinal === latestOrdinal && attempts !== undefined && HashMap.has(attempts, ordinal)
  }
  if (event.basis._tag === "BeforeFirstAttempt") return latestOrdinal === 0
  const ordinal = Number(event.basis.attemptOrdinal)
  return ordinal === latestOrdinal && attempts !== undefined && HashMap.has(attempts, ordinal)
}

const invalidTargetPromotionTerminal = (
  event: PromotionTerminal,
  indexes: TargetPromotionHistoryIndexes
): TargetPromotionHistoryValidation => {
  const requestId = event.correlation.requestId
  const intent = mapGet(indexes.intents, requestId)
  const attempts = mapGet(indexes.attempts, requestId)
  const latestOrdinal = attempts === undefined ? 0 : HashMap.size(attempts)
  const duplicate = HashSet.has(indexes.terminals, requestId)
  const basisAttempt = terminalBasisAttempt(event, attempts)
  const valid = [
    !duplicate,
    intent !== undefined && targetPromotionCorrelationEquals(intent.correlation, event.correlation),
    basisAttempt === undefined || targetPromotionCorrelationEquals(basisAttempt.correlation, event.correlation),
    terminalBasisIsCausal(event, latestOrdinal, attempts),
    validTargetPromotionTerminalObservation(event)
  ].every(Boolean)
  return {
    detail: valid
      ? undefined
      : `target promotion terminal has no exact latest unresolved attempt for request ${requestId}`,
    indexes: { ...indexes, terminals: HashSet.add(indexes.terminals, requestId) }
  }
}

/** Validates one promotion event against the earlier Integrator Git qualification and CAS chronology. */
export const invalidTargetPromotionHistory = (
  record: JournalRecord,
  indexes: TargetPromotionHistoryIndexes,
  integratorObservations: IntegratorRunQualifiedObservation
): TargetPromotionHistoryValidation => {
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
  return { detail: undefined, indexes }
}
