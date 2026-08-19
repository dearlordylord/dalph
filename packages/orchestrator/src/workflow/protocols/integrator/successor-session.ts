import { plannedTaskAttemptEquivalence, type IntegrationTarget } from "@dalph/contracts"
import { Effect, Option, Schema } from "effect"
import { TargetLineageObservation } from "../../../authorities/git/target-lineage.js"
import {
  integrationQuarantineDirectionAppliedRecordKey,
  integrationQuarantinedRecordKey,
  integratorSessionFixedRecordKey,
  integratorSuccessorSessionFixedRecordKey
} from "../../../workflow-journal/record-key.js"
import type { JournalPosition } from "../../../workflow-journal/identity.js"
import type { InRunJournal, JournalRecord } from "../../../workflow-journal/store.js"
import { exactJournalRecordAtKey } from "../../../workflow-journal/exact-record.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import type { StartedIntegrationResponsibility } from "../integration-admission/protocol.js"
import { acceptedResultEquivalence } from "../integration-admission/responsibility.js"
import { IntegratorJournalContradiction } from "./errors.js"
import {
  firstFullRerunSuccessorGeneration,
  IntegratorSuccessorSessionFixedEvent,
  type IntegratorSessionCorrelation
} from "./events.js"
import {
  IntegratorSuccessorPreparationInput,
  integratorSuccessorCorrelationFor,
  readRecordedIntegratorSession
} from "./session.js"
import { integratorCorrelationsEqual, integratorResponsibilityFactsFromCorrelation } from "./state.js"
import { deriveIntegrationQuarantineState } from "../integration-quarantine/state.js"
import { integrationQuarantineDirectionSubject } from "../integration-quarantine/events.js"

/** The exact journal record that fixes one FullRerun successor. */
export type IntegratorSuccessorSessionFixedRecord = JournalRecord & {
  readonly event: IntegratorSuccessorSessionFixedEvent
}

const successorEventEquivalence = Schema.toEquivalence(IntegratorSuccessorSessionFixedEvent)
const targetLineageEquivalence = Schema.toEquivalence(TargetLineageObservation)

const runIdFor = (correlation: IntegratorSessionCorrelation) => correlation.plannedAttempt.runId

const reject = (
  correlation: IntegratorSessionCorrelation,
  detail: string
): Effect.Effect<never, IntegratorJournalContradiction> =>
  Effect.fail(new IntegratorJournalContradiction({ detail, runId: runIdFor(correlation) }))

const sameTarget = (left: IntegrationTarget, right: IntegrationTarget): boolean =>
  left.repository === right.repository && left.ref === right.ref

const exactRecordAt = (records: ReadonlyArray<JournalRecord>, position: JournalPosition): JournalRecord | undefined =>
  records.find((record) => record.position === position)

type TargetLineageObservedEvent = Extract<JournalRecord["event"], { readonly _tag: "TargetLineageObserved" }>

type SuccessorValidation = { readonly _tag: "Valid" } | { readonly _tag: "Invalid"; readonly detail: string }

const validSuccessor = (): SuccessorValidation => ({ _tag: "Valid" })
const invalidSuccessor = (detail: string): SuccessorValidation => ({ _tag: "Invalid", detail })

const targetLineageMatches = (
  records: ReadonlyArray<JournalRecord>,
  input: IntegratorSuccessorPreparationInput,
  correlation: IntegratorSessionCorrelation
): boolean => {
  const observationRecord = exactRecordAt(records, input.targetLineageObservedAt)
  if (observationRecord?.event._tag !== "TargetLineageObserved") return false
  const observation = observationRecord.event
  if (!targetLineageEquivalence(observation.observation, input.targetLineage)) return false
  const intent = targetLineageReadIntentFor(records, input, observation.operationId, observationRecord.position)
  return targetLineageFactsMatch(intent, observation, correlation)
}

const targetLineageReadIntentFor = (
  records: ReadonlyArray<JournalRecord>,
  input: IntegratorSuccessorPreparationInput,
  operationId: TargetLineageObservedEvent["operationId"],
  observationPosition: JournalPosition
): JournalRecord | undefined =>
  records.find((record) => {
    const event = record.event
    return (
      event._tag === "GitReadIntentRecorded" &&
      event.operation._tag === "ReadTargetLineage" &&
      event.operation.operationId === operationId &&
      record.position > input.directionAppliedAt &&
      record.position < observationPosition
    )
  })

type ReadTargetLineageOperation = Extract<
  Extract<JournalRecord["event"], { readonly _tag: "GitReadIntentRecorded" }>["operation"],
  { readonly _tag: "ReadTargetLineage" }
>

const targetLineageIntentFactsMatch = (
  operation: ReadTargetLineageOperation,
  observation: TargetLineageObservedEvent,
  correlation: IntegratorSessionCorrelation
): boolean =>
  sameTarget(operation.integrationTarget, correlation.integrationTarget) &&
  plannedTaskAttemptEquivalence(operation.plannedAttempt, correlation.plannedAttempt) &&
  plannedTaskAttemptEquivalence(observation.plannedAttempt, correlation.plannedAttempt) &&
  observation.observation.plannedBaseSha === correlation.plannedAttempt.baseSha &&
  observation.observation.targetHeadSha === correlation.expectedTargetHead &&
  observation.observation.plannedBaseIsAncestorOfTargetHead

const targetLineageFactsMatch = (
  intent: JournalRecord | undefined,
  observation: TargetLineageObservedEvent,
  correlation: IntegratorSessionCorrelation
): boolean =>
  intent?.event._tag === "GitReadIntentRecorded" &&
  intent.event.operation._tag === "ReadTargetLineage" &&
  targetLineageIntentFactsMatch(intent.event.operation, observation, correlation)

const predecessorFixedAt = (
  records: ReadonlyArray<JournalRecord>,
  predecessor: IntegratorSessionCorrelation
): JournalRecord | undefined => {
  const key = integratorSessionFixedRecordKey(integratorResponsibilityFactsFromCorrelation(predecessor))
  const record = records.find((candidate) => candidate.key === key)
  return record?.event._tag === "IntegratorSessionFixed" &&
    integratorCorrelationsEqual(record.event.correlation, predecessor)
    ? record
    : undefined
}

const integrationStartedMatches = (
  record: JournalRecord | undefined,
  predecessor: IntegratorSessionCorrelation
): boolean =>
  record?.event._tag === "IntegrationStarted" &&
  record.position === predecessor.startedAt &&
  record.event.responsibilityBeganAt === predecessor.queuedAt &&
  plannedTaskAttemptEquivalence(record.event.plannedAttempt, predecessor.plannedAttempt) &&
  acceptedResultEquivalence(record.event.acceptedResult, predecessor.acceptedResult) &&
  sameTarget(record.event.integrationTarget, predecessor.integrationTarget)

const quarantineMatches = (
  record: JournalRecord | undefined,
  predecessor: IntegratorSessionCorrelation,
  quarantineAt: JournalPosition
): boolean =>
  record?.event._tag === "IntegrationQuarantined" &&
  record.position === quarantineAt &&
  record.runId === runIdFor(predecessor) &&
  record.key === integrationQuarantinedRecordKey(predecessor.sessionId, record.event.basis) &&
  integratorCorrelationsEqual(record.event.correlation, predecessor)

const directionMatches = (
  record: JournalRecord | undefined,
  predecessor: IntegratorSessionCorrelation,
  quarantineAt: JournalPosition,
  directionAppliedAt: JournalPosition
): boolean =>
  record?.event._tag === "IntegrationQuarantineDirectionApplied" &&
  record.position === directionAppliedAt &&
  record.runId === runIdFor(predecessor) &&
  record.event.fingerprint.direction === "FullRerun" &&
  record.event.fingerprint.quarantineAt === quarantineAt &&
  record.event.fingerprint.sessionId === predecessor.sessionId &&
  record.key ===
    integrationQuarantineDirectionAppliedRecordKey(integrationQuarantineDirectionSubject(record.event.fingerprint))

const freshSuccessorQuarantineStateMatches = (
  state: ReturnType<typeof deriveIntegrationQuarantineState>,
  input: IntegratorSuccessorPreparationInput
): boolean =>
  state._tag === "DirectionApplied" &&
  state.quarantineAt === input.quarantineAt &&
  state.applicationAt === input.directionAppliedAt &&
  state.application.fingerprint.direction === "FullRerun"

type FreshSuccessorEvidence =
  | { readonly _tag: "Valid"; readonly fixed: JournalRecord }
  | { readonly _tag: "Invalid"; readonly detail: string }

const invalidFreshSuccessor = (detail: string): FreshSuccessorEvidence => ({ _tag: "Invalid", detail })

const validateFreshSuccessorEvidence = (
  records: ReadonlyArray<JournalRecord>,
  input: IntegratorSuccessorPreparationInput
): FreshSuccessorEvidence => {
  const predecessor = input.predecessor
  const fixed = predecessorFixedAt(records, predecessor)
  const started = exactRecordAt(records, predecessor.startedAt)
  const quarantine = exactRecordAt(records, input.quarantineAt)
  const direction = exactRecordAt(records, input.directionAppliedAt)
  const quarantineState = deriveIntegrationQuarantineState(records, predecessor.sessionId)
  if (fixed === undefined) return invalidFreshSuccessor("FullRerun successor lacks the exact predecessor session")
  if (fixed.position <= predecessor.targetLineageObservedAt) {
    return invalidFreshSuccessor(
      "FullRerun successor predecessor session does not follow its target-lineage observation"
    )
  }
  if (!integrationStartedMatches(started, predecessor)) {
    return invalidFreshSuccessor("FullRerun successor lacks the exact earlier IntegrationStarted responsibility")
  }
  if (!quarantineMatches(quarantine, predecessor, input.quarantineAt)) {
    return invalidFreshSuccessor("FullRerun successor lacks the exact predecessor quarantine")
  }
  if (!directionMatches(direction, predecessor, input.quarantineAt, input.directionAppliedAt)) {
    return invalidFreshSuccessor("FullRerun successor lacks the exact applied FullRerun direction")
  }
  if (!freshSuccessorQuarantineStateMatches(quarantineState, input)) {
    return invalidFreshSuccessor(
      "FullRerun successor requires one valid reconstructed Q and exact winning FullRerun direction"
    )
  }
  return { _tag: "Valid", fixed }
}

const validateFreshSuccessorPreconditions = (
  records: ReadonlyArray<JournalRecord>,
  input: IntegratorSuccessorPreparationInput,
  successor: IntegratorSessionCorrelation
): SuccessorValidation => {
  const predecessor = input.predecessor
  const evidence = validateFreshSuccessorEvidence(records, input)
  if (evidence._tag === "Invalid") return evidence
  if (!(evidence.fixed.position < input.quarantineAt && input.quarantineAt < input.directionAppliedAt)) {
    return invalidSuccessor("FullRerun successor requires predecessor session < Q < D")
  }
  if (!(input.directionAppliedAt < input.targetLineageObservedAt)) {
    return invalidSuccessor("FullRerun successor fresh target-lineage observation must follow D")
  }
  if (
    input.targetLineage.plannedBaseSha !== predecessor.plannedAttempt.baseSha ||
    !input.targetLineage.plannedBaseIsAncestorOfTargetHead
  ) {
    return invalidSuccessor("FullRerun successor target lineage is incompatible with the planned base")
  }
  if (!targetLineageMatches(records, input, successor)) {
    return invalidSuccessor("FullRerun successor lacks the exact fresh TargetLineageObserved and read intent")
  }
  return validSuccessor()
}

const existingSuccessorFor = (
  records: ReadonlyArray<JournalRecord>,
  predecessor: IntegratorSessionCorrelation
): ReadonlyArray<IntegratorSuccessorSessionFixedRecord> =>
  records.filter(
    (record): record is IntegratorSuccessorSessionFixedRecord =>
      record.event._tag === "IntegratorSuccessorSessionFixed" &&
      record.event.predecessor.sessionId === predecessor.sessionId
  )

const validateExistingSuccessor = (
  existing: IntegratorSuccessorSessionFixedRecord,
  input: IntegratorSuccessorPreparationInput,
  successor: IntegratorSessionCorrelation,
  expectedKey: JournalRecord["key"]
):
  | { readonly _tag: "Existing"; readonly record: IntegratorSuccessorSessionFixedRecord }
  | { readonly _tag: "Invalid"; readonly detail: string } => {
  if (
    !integratorCorrelationsEqual(existing.event.predecessor, input.predecessor) ||
    existing.event.quarantineAt !== input.quarantineAt ||
    existing.event.directionAppliedAt !== input.directionAppliedAt
  ) {
    return { _tag: "Invalid", detail: "FullRerun predecessor already has a different successor subject" }
  }
  /* v8 ignore next -- @preserve fresh-successor precondition validation rejects a related successor under a foreign key before uniqueness reconstruction. */
  if (existing.key !== expectedKey) return { _tag: "Invalid", detail: "FullRerun successor exists under a foreign key" }
  /* v8 ignore next -- @preserve a related successor at the expected key is returned by the earlier exact-key lookup. */
  return successorEventEquivalence(existing.event, {
    _tag: "IntegratorSuccessorSessionFixed",
    direction: "FullRerun",
    directionAppliedAt: input.directionAppliedAt,
    predecessor: input.predecessor,
    quarantineAt: input.quarantineAt,
    successor,
    successorGeneration: firstFullRerunSuccessorGeneration,
    version: workflowJournalEventVersion
  })
    ? { _tag: "Existing", record: existing }
    : { _tag: "Invalid", detail: "FullRerun successor key contains contradictory successor identity" }
}

const successorIdentityCollision = (
  records: ReadonlyArray<JournalRecord>,
  successor: IntegratorSessionCorrelation
): boolean =>
  records.some((record) => {
    if (record.event._tag === "IntegratorSessionFixed") {
      return (
        record.event.correlation.sessionId === successor.sessionId ||
        record.event.correlation.candidateResource === successor.candidateResource
      )
    }
    if (record.event._tag === "IntegratorSuccessorSessionFixed") {
      return (
        record.event.successor.sessionId === successor.sessionId ||
        record.event.successor.candidateResource === successor.candidateResource
      )
    }
    return false
  })

const validateSuccessorUniqueness = (
  records: ReadonlyArray<JournalRecord>,
  input: IntegratorSuccessorPreparationInput,
  successor: IntegratorSessionCorrelation,
  expectedKey: JournalRecord["key"]
):
  | { readonly _tag: "Available" }
  | { readonly _tag: "Existing"; readonly record: IntegratorSuccessorSessionFixedRecord }
  | { readonly _tag: "Invalid"; readonly detail: string } => {
  const related = existingSuccessorFor(records, input.predecessor)
  if (related.length > 1) {
    return { _tag: "Invalid", detail: "Journal history contains multiple FullRerun successors for one predecessor" }
  }
  const existing = related[0]
  if (existing !== undefined) return validateExistingSuccessor(existing, input, successor, expectedKey)
  const identityCollision = successorIdentityCollision(records, successor)
  return identityCollision
    ? { _tag: "Invalid", detail: "FullRerun successor reuses an existing session or resource identity" }
    : { _tag: "Available" }
}

const successorEventFor = (
  input: IntegratorSuccessorPreparationInput,
  successor: IntegratorSessionCorrelation
): IntegratorSuccessorSessionFixedEvent =>
  IntegratorSuccessorSessionFixedEvent.make({
    direction: "FullRerun",
    directionAppliedAt: input.directionAppliedAt,
    predecessor: input.predecessor,
    quarantineAt: input.quarantineAt,
    successor,
    successorGeneration: firstFullRerunSuccessorGeneration,
    version: workflowJournalEventVersion
  })

const successorRecordMatches = (
  record: JournalRecord,
  key: JournalRecord["key"],
  event: IntegratorSuccessorSessionFixedEvent
): record is IntegratorSuccessorSessionFixedRecord =>
  record.key === key &&
  record.event._tag === "IntegratorSuccessorSessionFixed" &&
  successorEventEquivalence(record.event, event)

const validateActiveIntegratorSuccessorRecord = (
  records: ReadonlyArray<JournalRecord>,
  fixed: IntegratorSuccessorSessionFixedRecord,
  predecessor: IntegratorSessionCorrelation
):
  | { readonly _tag: "Invalid"; readonly detail: string }
  | { readonly _tag: "Valid"; readonly successor: IntegratorSessionCorrelation } => {
  if (!integratorCorrelationsEqual(fixed.event.predecessor, predecessor)) {
    return { _tag: "Invalid", detail: "Integrator successor predecessor is foreign to the responsibility" }
  }
  const lineageRecord = exactRecordAt(records, fixed.event.successor.targetLineageObservedAt)
  if (lineageRecord?.event._tag !== "TargetLineageObserved") {
    return { _tag: "Invalid", detail: "Integrator successor lacks its exact fresh target-lineage observation" }
  }
  const input = IntegratorSuccessorPreparationInput.make({
    directionAppliedAt: fixed.event.directionAppliedAt,
    predecessor,
    quarantineAt: fixed.event.quarantineAt,
    targetLineage: lineageRecord.event.observation,
    targetLineageObservedAt: lineageRecord.position
  })
  const expectedSuccessor = integratorSuccessorCorrelationFor(input)
  const expectedKey = integratorSuccessorSessionFixedRecordKey(
    predecessor,
    input.quarantineAt,
    input.directionAppliedAt
  )
  const preconditionIssue = validateFreshSuccessorPreconditions(records, input, expectedSuccessor)
  if (preconditionIssue._tag === "Invalid") return preconditionIssue
  if (fixed.position <= input.targetLineageObservedAt) {
    return { _tag: "Invalid", detail: "Integrator successor must be fixed after its fresh target-lineage observation" }
  }
  return successorRecordMatches(fixed, expectedKey, successorEventFor(input, expectedSuccessor))
    ? { _tag: "Valid", successor: expectedSuccessor }
    : { _tag: "Invalid", detail: "Integrator successor record has a foreign key or non-deterministic identity" }
}

/** Pure, fail-closed lookup used before reconstruction or delivery selects S2. */
const activeIntegratorSuccessorFor = (
  records: ReadonlyArray<JournalRecord>,
  predecessor: IntegratorSessionCorrelation
):
  | { readonly _tag: "Absent" }
  | { readonly _tag: "Invalid"; readonly detail: string }
  | { readonly _tag: "Valid"; readonly successor: IntegratorSessionCorrelation } => {
  const related = existingSuccessorFor(records, predecessor)
  if (related.length > 1) {
    return { _tag: "Invalid", detail: "Journal history contains multiple successors for one Integrator session" }
  }
  const fixed = related[0]
  if (fixed === undefined) return { _tag: "Absent" }
  return validateActiveIntegratorSuccessorRecord(records, fixed, predecessor)
}

/**
 * Appends or recovers the one deterministic successor relation after Q/D/L.
 * A journal key collision is reconciled by rereading the winning record.
 */
export const appendIntegratorSuccessorSessionIfNeeded = Effect.fn("IntegratorProtocol.appendSuccessorSessionIfNeeded")(
  function* (
    journal: InRunJournal["Service"],
    input: IntegratorSuccessorPreparationInput,
    records: ReadonlyArray<JournalRecord>
  ) {
    const successor = integratorSuccessorCorrelationFor(input)
    const key = integratorSuccessorSessionFixedRecordKey(
      input.predecessor,
      input.quarantineAt,
      input.directionAppliedAt
    )
    const preconditionIssue = validateFreshSuccessorPreconditions(records, input, successor)
    if (preconditionIssue._tag === "Invalid") return yield* reject(input.predecessor, preconditionIssue.detail)
    const event = successorEventFor(input, successor)
    const existingAtKey = exactJournalRecordAtKey(records, key)
    if (existingAtKey._tag === "Duplicate") return yield* reject(input.predecessor, existingAtKey.detail)
    if (existingAtKey._tag === "Found") {
      return successorRecordMatches(existingAtKey.record, key, event)
        ? existingAtKey.record
        : yield* reject(input.predecessor, "FullRerun successor key contains a foreign or contradictory event")
    }

    const uniqueness = validateSuccessorUniqueness(records, input, successor, key)
    if (uniqueness._tag === "Invalid") return yield* reject(input.predecessor, uniqueness.detail)
    /* v8 ignore next -- @preserve an existing related successor is found by exact key before uniqueness validation; only Available can follow a missing exact key. */
    if (uniqueness._tag === "Existing") return uniqueness.record

    const appended = yield* journal.append(runIdFor(input.predecessor), key, event).pipe(
      Effect.catchTag("JournalStoreContradiction", ({ existingPosition }) =>
        Effect.gen(function* () {
          const refreshed = yield* journal.read(runIdFor(input.predecessor))
          const winner = refreshed.find((record) => record.position === existingPosition)
          if (winner !== undefined && successorRecordMatches(winner, key, event)) return winner
          return yield* reject(input.predecessor, "FullRerun successor append contradicted existing Journal history")
        })
      )
    )
    return successorRecordMatches(appended, key, event)
      ? appended
      : yield* reject(input.predecessor, "FullRerun successor append returned a foreign Journal record")
  }
)

/**
 * Returns the active session for ordinary delivery. S1 remains in the
 * journal, but a valid S2 relation makes S2 the active session.
 */
export const readActiveIntegratorSession = Effect.fn("IntegratorProtocol.readActiveIntegratorSession")(function* (
  records: ReadonlyArray<JournalRecord>,
  responsibility: StartedIntegrationResponsibility
) {
  const predecessor = yield* readRecordedIntegratorSession(records, responsibility)
  if (Option.isNone(predecessor)) return predecessor
  const successor = activeIntegratorSuccessorFor(records, predecessor.value)
  if (successor._tag === "Invalid") return yield* reject(predecessor.value, successor.detail)
  return Option.some(successor._tag === "Valid" ? successor.successor : predecessor.value)
})
