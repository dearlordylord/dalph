/* eslint-disable max-lines -- Exact provider absence validation and reconciliation share one chronology owner. */
import { Effect, Schema } from "effect"
import { plannedTaskAttemptEquivalence } from "@dalph/contracts"
import {
  integrationProviderRunActivityAbsentRecordKey,
  integrationQuarantinedRecordKey,
  intentRecordKey,
  integratorRunStartedRecordKey,
  integratorSessionFixedRecordKey,
  integratorSuccessorSessionFixedRecordKey,
  outcomeRecordKey
} from "../../../workflow-journal/record-key.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import { InRunJournal } from "../../../workflow-journal/store.js"
import { exactJournalRecordAtKey } from "../../../workflow-journal/exact-record.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  IntegrationProviderRunActivityAbsentEvent,
  IntegrationQuarantineBasis,
  IntegrationQuarantineFailureDetail,
  IntegrationQuarantinedEvent
} from "./events.js"
import { type IntegratorProviderActivityAbsent, IntegratorJournalContradiction } from "../integrator/errors.js"
import {
  type IntegratorSessionCorrelation,
  IntegratorRunCorrelation,
  IntegratorRunOrdinal,
  integratorRetryRunOrdinal,
  integratorRunCorrelationsEqual
} from "../integrator/events.js"
import {
  integratorCorrelationsEqual,
  integratorResponsibilityFactsEqual,
  integratorResponsibilityFactsFromCorrelation
} from "../integrator/state.js"
import {
  evaluateIntegratorFullRerunAuthorization,
  evaluateIntegratorRetryAuthorization
} from "../integrator/retry-authorization.js"
import { validateProviderRunActivityAbsent } from "./canonical-provenance.js"
export { validateProviderRunActivityAbsent } from "./canonical-provenance.js"

/** Input used by both the provider boundary and restart recovery. */
export const ProviderRunFailureQuarantineInput = Schema.Struct({
  detail: IntegrationQuarantineFailureDetail,
  run: IntegratorRunCorrelation
})
export type ProviderRunFailureQuarantineInput = typeof ProviderRunFailureQuarantineInput.Type

/** The two durable records established for one provider-owned absence proof. */
interface ProviderRunFailureQuarantineResult {
  readonly absence: JournalRecord & { readonly event: IntegrationProviderRunActivityAbsentEvent }
  readonly quarantine: JournalRecord & { readonly event: IntegrationQuarantinedEvent }
}

type AbsenceRecord = ProviderRunFailureQuarantineResult["absence"]
type QuarantineRecord = ProviderRunFailureQuarantineResult["quarantine"]

const quarantineEventEquivalence = Schema.toEquivalence(IntegrationQuarantinedEvent)

const runIdFor = (run: IntegratorRunCorrelation) => run.session.plannedAttempt.runId

const reject = (run: IntegratorRunCorrelation, detail: string): Effect.Effect<never, IntegratorJournalContradiction> =>
  Effect.fail(new IntegratorJournalContradiction({ detail, runId: runIdFor(run) }))

const fixedSessionKey = (session: IntegratorSessionCorrelation) =>
  integratorSessionFixedRecordKey(integratorResponsibilityFactsFromCorrelation(session))

const initialRunOrdinal = IntegratorRunOrdinal.make(1)

const absenceKey = integrationProviderRunActivityAbsentRecordKey

const sameResponsibility = (left: IntegratorSessionCorrelation, right: IntegratorSessionCorrelation): boolean =>
  integratorResponsibilityFactsEqual(
    integratorResponsibilityFactsFromCorrelation(left),
    integratorResponsibilityFactsFromCorrelation(right)
  )

const absenceMatches = (
  record: JournalRecord,
  run: IntegratorRunCorrelation,
  detail: IntegrationQuarantineFailureDetail
): record is AbsenceRecord =>
  record.runId === runIdFor(run) &&
  record.event._tag === "IntegrationProviderRunActivityAbsent" &&
  integratorCorrelationsEqual(record.event.correlation, run.session) &&
  record.key === absenceKey(run) &&
  integratorRunCorrelationsEqual(record.event.run, run) &&
  record.event.detail === detail

const quarantineMatches = (
  record: JournalRecord,
  run: IntegratorRunCorrelation,
  event: IntegrationQuarantinedEvent,
  key: JournalRecord["key"]
): record is QuarantineRecord =>
  record.runId === runIdFor(run) &&
  record.key === key &&
  record.event._tag === "IntegrationQuarantined" &&
  quarantineEventEquivalence(record.event, event)

type ProviderRunPredecessors = { readonly session: JournalRecord; readonly runStart: JournalRecord }

type ProviderRunPredecessorValidation =
  | { readonly _tag: "Valid"; readonly value: ProviderRunPredecessors }
  | { readonly _tag: "Invalid"; readonly detail: string }

const invalidPredecessor = (detail: string): ProviderRunPredecessorValidation => ({ _tag: "Invalid", detail })

const validPredecessor = (value: ProviderRunPredecessors): ProviderRunPredecessorValidation => ({
  _tag: "Valid",
  value
})

type FixedSessionValidation =
  | { readonly _tag: "Valid"; readonly session: JournalRecord }
  | { readonly _tag: "Invalid"; readonly detail: string }

type DirectSessionRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "IntegratorSessionFixed" }>
}
type SuccessorSessionRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "IntegratorSuccessorSessionFixed" }>
}
type TargetLineageRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "TargetLineageObserved" }>
}
type QuarantineDirectionRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "IntegrationQuarantineDirectionApplied" }>
}

const directSessionsFor = (
  history: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation
): ReadonlyArray<DirectSessionRecord> =>
  history.filter(
    (record): record is DirectSessionRecord =>
      record.event._tag === "IntegratorSessionFixed" && sameResponsibility(record.event.correlation, run.session)
  )

const successorSessionsFor = (
  history: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation
): ReadonlyArray<SuccessorSessionRecord> =>
  history.filter(
    (record): record is SuccessorSessionRecord =>
      record.event._tag === "IntegratorSuccessorSessionFixed" &&
      integratorCorrelationsEqual(record.event.successor, run.session)
  )

const targetLineageAt = (
  history: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation
): TargetLineageRecord | undefined => {
  const observations = history.filter(
    (record): record is TargetLineageRecord =>
      record.event._tag === "TargetLineageObserved" &&
      record.position === run.session.targetLineageObservedAt &&
      record.runId === runIdFor(run) &&
      record.key === outcomeRecordKey(record.event.operationId) &&
      plannedTaskAttemptMatches(record.event.plannedAttempt, run.session.plannedAttempt) &&
      record.event.observation.plannedBaseSha === run.session.plannedAttempt.baseSha &&
      record.event.observation.targetHeadSha === run.session.expectedTargetHead &&
      record.event.observation.plannedBaseIsAncestorOfTargetHead
  )
  const observation = observations.find((candidate) => candidate.position === run.session.targetLineageObservedAt)
  if (observation === undefined || observations.length !== 1) return undefined
  const intents = history.filter(
    (record) =>
      record.event._tag === "GitReadIntentRecorded" &&
      record.runId === runIdFor(run) &&
      record.key === intentRecordKey(observation.event.operationId) &&
      record.position < observation.position &&
      record.event.operation._tag === "ReadTargetLineage" &&
      record.event.operation.operationId === observation.event.operationId &&
      plannedTaskAttemptMatches(record.event.operation.plannedAttempt, run.session.plannedAttempt) &&
      record.event.operation.integrationTarget.repository === run.session.integrationTarget.repository &&
      record.event.operation.integrationTarget.ref === run.session.integrationTarget.ref
  )
  return intents.length === 1 ? observation : undefined
}

const plannedTaskAttemptMatches = plannedTaskAttemptEquivalence

const directSessionHasForeignEvidence = (
  direct: ReadonlyArray<DirectSessionRecord>,
  run: IntegratorRunCorrelation,
  key: JournalRecord["key"]
): boolean =>
  direct.some(
    (record) =>
      !integratorCorrelationsEqual(record.event.correlation, run.session) ||
      record.runId !== runIdFor(run) ||
      record.key !== key
  )

const directSessionRecordIsExact = (session: JournalRecord, run: IntegratorRunCorrelation): boolean =>
  session.runId === runIdFor(run) &&
  session.event._tag === "IntegratorSessionFixed" &&
  integratorCorrelationsEqual(session.event.correlation, run.session) &&
  session.position > run.session.targetLineageObservedAt

const exactDirectSession = (
  history: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation,
  direct: ReadonlyArray<DirectSessionRecord>
): FixedSessionValidation => {
  const key = fixedSessionKey(run.session)
  if (direct.length !== 1 || directSessionHasForeignEvidence(direct, run, key)) {
    return { _tag: "Invalid", detail: "fixed Integrator session evidence is foreign to the provider run" }
  }
  if (targetLineageAt(history, run) === undefined) {
    return { _tag: "Invalid", detail: "provider run lacks its exact target-lineage observation" }
  }
  const lookup = exactJournalRecordAtKey(history, key)
  if (lookup._tag === "Duplicate") return { _tag: "Invalid", detail: lookup.detail }
  /* v8 ignore next -- @preserve the sole direct fixed-session record was already proven to carry this canonical key, so exact lookup cannot be Missing. */
  if (lookup._tag === "Missing") {
    return { _tag: "Invalid", detail: "provider run lacks its exact fixed Integrator session" }
  }
  const session = lookup.record
  return directSessionRecordIsExact(session, run)
    ? { _tag: "Valid", session }
    : { _tag: "Invalid", detail: "provider run lacks its exact fixed Integrator session" }
}

interface SuccessorPredecessorEvidence {
  readonly predecessor: IntegratorSessionCorrelation
  readonly record: DirectSessionRecord
}

type SuccessorPredecessorValidation =
  | { readonly _tag: "Valid"; readonly value: SuccessorPredecessorEvidence }
  | { readonly _tag: "Invalid"; readonly detail: string }

const predecessorRecordIsExact = (
  record: JournalRecord | undefined,
  predecessorSessions: ReadonlyArray<DirectSessionRecord>,
  predecessor: IntegratorSessionCorrelation,
  run: IntegratorRunCorrelation,
  key: JournalRecord["key"]
): record is DirectSessionRecord =>
  record?.event._tag === "IntegratorSessionFixed" &&
  predecessorSessions.length === 1 &&
  !predecessorSessions.some((candidate) => candidate.runId !== runIdFor(run) || candidate.key !== key) &&
  record.runId === runIdFor(run) &&
  integratorCorrelationsEqual(record.event.correlation, predecessor) &&
  record.position > predecessor.targetLineageObservedAt

const directSessionsMatchOnlyPredecessor = (
  direct: ReadonlyArray<DirectSessionRecord>,
  predecessorSessions: ReadonlyArray<DirectSessionRecord>,
  predecessor: IntegratorSessionCorrelation
): boolean =>
  direct.length === predecessorSessions.length &&
  !direct.some((candidate) => !integratorCorrelationsEqual(candidate.event.correlation, predecessor))

const successorPredecessorEvidence = (
  history: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation,
  direct: ReadonlyArray<DirectSessionRecord>,
  successor: SuccessorSessionRecord
): SuccessorPredecessorValidation => {
  const predecessor = successor.event.predecessor
  const predecessorSessions = history.filter(
    (record): record is DirectSessionRecord =>
      record.event._tag === "IntegratorSessionFixed" &&
      integratorCorrelationsEqual(record.event.correlation, predecessor)
  )
  const key = fixedSessionKey(predecessor)
  const lookup = exactJournalRecordAtKey(history, key)
  const record = lookup._tag === "Found" ? lookup.record : undefined
  if (!predecessorRecordIsExact(record, predecessorSessions, predecessor, run, key)) {
    return { _tag: "Invalid", detail: "provider successor lacks the exact predecessor session" }
  }
  if (!directSessionsMatchOnlyPredecessor(direct, predecessorSessions, predecessor)) {
    return { _tag: "Invalid", detail: "provider successor has foreign fixed-session evidence" }
  }
  return { _tag: "Valid", value: { predecessor, record } }
}

const successorRecordIsExact = (
  run: IntegratorRunCorrelation,
  successor: SuccessorSessionRecord,
  predecessor: IntegratorSessionCorrelation
): boolean => {
  const key = integratorSuccessorSessionFixedRecordKey(
    predecessor,
    successor.event.quarantineAt,
    successor.event.directionAppliedAt
  )
  return (
    successor.runId === runIdFor(run) &&
    successor.key === key &&
    successor.position > run.session.targetLineageObservedAt
  )
}

const successorPredecessorChronologyIsExact = (
  history: ReadonlyArray<JournalRecord>,
  successor: SuccessorSessionRecord,
  evidence: SuccessorPredecessorEvidence
): boolean => {
  const quarantine = history.find(
    (record) => record.position === successor.event.quarantineAt && record.event._tag === "IntegrationQuarantined"
  )
  const direction = history.find(
    (record): record is QuarantineDirectionRecord =>
      record.position === successor.event.directionAppliedAt &&
      record.event._tag === "IntegrationQuarantineDirectionApplied"
  )
  if (quarantine?.event._tag !== "IntegrationQuarantined") return false
  if (direction?.event._tag !== "IntegrationQuarantineDirectionApplied") return false
  return (
    successorDirectionMatches(direction, successor, evidence.predecessor) &&
    integratorCorrelationsEqual(quarantine.event.correlation, evidence.predecessor) &&
    evidence.record.position < quarantine.position &&
    quarantine.position < direction.position
  )
}

const successorDirectionMatches = (
  direction: QuarantineDirectionRecord,
  successor: SuccessorSessionRecord,
  predecessor: IntegratorSessionCorrelation
): boolean =>
  direction.event.fingerprint.direction === "FullRerun" &&
  direction.event.fingerprint.quarantineAt === successor.event.quarantineAt &&
  direction.event.fingerprint.sessionId === predecessor.sessionId

const successorLineageIssue = (
  history: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation,
  successor: SuccessorSessionRecord
): string | undefined => {
  const authorization = evaluateIntegratorFullRerunAuthorization(
    history,
    run,
    successor.event.predecessor,
    run.session.targetLineageObservedAt
  )
  return authorization._tag === "Authorized"
    ? undefined
    : `provider successor lacks the canonical FullRerun chronology: ${authorization.detail}`
}

const exactSuccessorSession = (
  history: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation,
  direct: ReadonlyArray<DirectSessionRecord>,
  successor: SuccessorSessionRecord
): FixedSessionValidation => {
  const predecessor = successorPredecessorEvidence(history, run, direct, successor)
  if (predecessor._tag === "Invalid") return predecessor
  if (!successorRecordIsExact(run, successor, predecessor.value.predecessor)) {
    return { _tag: "Invalid", detail: "provider successor session has a foreign key or chronology" }
  }
  if (!successorPredecessorChronologyIsExact(history, successor, predecessor.value)) {
    return { _tag: "Invalid", detail: "provider successor lacks the exact Q/D predecessor chronology" }
  }
  const lineageIssue = successorLineageIssue(history, run, successor)
  return lineageIssue === undefined ? { _tag: "Valid", session: successor } : { _tag: "Invalid", detail: lineageIssue }
}

const fixedSessionForRun = (
  history: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation
): FixedSessionValidation => {
  const direct = directSessionsFor(history, run)
  const successors = successorSessionsFor(history, run)
  if (successors.length > 1) {
    return { _tag: "Invalid", detail: "provider run has duplicate FullRerun successor session evidence" }
  }
  const successor = successors[0]
  return successor === undefined
    ? exactDirectSession(history, run, direct)
    : exactSuccessorSession(history, run, direct, successor)
}

/** Returns the exact durable start for a run after its fixed session relation. */
export const providerRunStartFor = (
  records: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation
): JournalRecord | undefined => {
  const fixedSession = fixedSessionForRun(records, run)
  if (fixedSession._tag === "Invalid") return undefined
  const key = integratorRunStartedRecordKey(run)
  const starts = records.filter(
    (
      record
    ): record is JournalRecord & {
      readonly event: Extract<JournalRecord["event"], { readonly _tag: "IntegratorRunStarted" }>
    } => record.event._tag === "IntegratorRunStarted" && integratorRunCorrelationsEqual(record.event.run, run)
  )
  if (starts.length !== 1 || starts.some((record) => record.runId !== runIdFor(run) || record.key !== key)) {
    return undefined
  }
  const start = starts[0]
  return start !== undefined && start.position > fixedSession.session.position ? start : undefined
}

const retryAuthorizationIssue = (
  history: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation,
  runStart: JournalRecord
): string | undefined => {
  if (run.ordinal !== integratorRetryRunOrdinal) return undefined
  const successor = history.find(
    (record) =>
      record.event._tag === "IntegratorSuccessorSessionFixed" &&
      integratorCorrelationsEqual(record.event.successor, run.session)
  )
  if (successor?.event._tag === "IntegratorSuccessorSessionFixed") return undefined
  const authorization = evaluateIntegratorRetryAuthorization(history, run, { beforePosition: runStart.position })
  if (authorization._tag === "Rejected") return authorization.detail
  return authorization.authorization.lineage.observation.event.observation.targetHeadSha ===
    run.session.expectedTargetHead
    ? undefined
    : "Retry provider-run quarantine requires an unchanged fresh target head"
}

const hasRecordedRunResult = (history: ReadonlyArray<JournalRecord>, run: IntegratorRunCorrelation): boolean =>
  history.some(
    (record) =>
      record.event._tag === "IntegratorRunResultRecorded" &&
      record.runId === runIdFor(run) &&
      integratorRunCorrelationsEqual(record.event.run, run)
  )

const hasRecordedRunCandidateEvidence = (
  history: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation
): boolean =>
  history.some(
    (record) =>
      (record.event._tag === "IntegratorRunCandidateGitReadIntended" ||
        record.event._tag === "IntegratorRunCandidateGitObserved") &&
      record.runId === runIdFor(run) &&
      integratorRunCorrelationsEqual(record.event.run, run)
  )

const providerRunStartedAfterSession = (
  history: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation
): ProviderRunPredecessorValidation => {
  const fixedSession = fixedSessionForRun(history, run)
  if (fixedSession._tag === "Invalid") return invalidPredecessor(fixedSession.detail)
  const runStart = providerRunStartFor(history, run)
  return runStart === undefined || runStart.position <= fixedSession.session.position
    ? invalidPredecessor("provider-run quarantine requires one exact run start after the fixed session")
    : validPredecessor({ runStart, session: fixedSession.session })
}

const validateRunOnePredecessors = (
  records: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation
): ProviderRunPredecessorValidation => {
  if (![initialRunOrdinal, integratorRetryRunOrdinal].includes(run.ordinal)) {
    return invalidPredecessor("provider-run quarantine accepts only Integrator runs 1 and 2")
  }
  const predecessors = providerRunStartedAfterSession(records, run)
  if (predecessors._tag === "Invalid") return predecessors
  const { runStart, session } = predecessors.value

  const authorizationIssue = retryAuthorizationIssue(records, run, runStart)
  if (authorizationIssue !== undefined) return invalidPredecessor(authorizationIssue)

  // A provider absence is only valid before any result or candidate evidence
  // for the same run. A lost/ambiguous call is not converted into absence.
  if (hasRecordedRunResult(records, run)) {
    return invalidPredecessor("provider-run absence contradicts an already recorded Integrator result")
  }
  if (hasRecordedRunCandidateEvidence(records, run)) {
    return invalidPredecessor("provider-run absence contradicts run-bound candidate evidence")
  }
  return validPredecessor({ session, runStart })
}

const appendOrReconcileAbsence = Effect.fn("IntegrationQuarantine.appendOrReconcileProviderActivityAbsence")(function* (
  run: IntegratorRunCorrelation,
  detail: IntegrationQuarantineFailureDetail,
  records: ReadonlyArray<JournalRecord>
) {
  const key = absenceKey(run)
  const expected = IntegrationProviderRunActivityAbsentEvent.make({
    correlation: run.session,
    detail,
    occurrenceClassification: "NonActionOccurrence",
    run,
    version: workflowJournalEventVersion
  })
  const related = records.filter(
    (record) =>
      record.event._tag === "IntegrationProviderRunActivityAbsent" &&
      integratorCorrelationsEqual(record.event.correlation, run.session) &&
      integratorRunCorrelationsEqual(record.event.run, run)
  )
  if (related.some((record) => !absenceMatches(record, run, detail))) {
    return yield* reject(run, "provider-activity absence evidence is duplicate or contradictory")
  }
  const existingAtKey = exactJournalRecordAtKey(records, key)
  if (existingAtKey._tag === "Duplicate") return yield* reject(run, existingAtKey.detail)
  if (existingAtKey._tag === "Found") {
    const existing = existingAtKey.record
    if (!absenceMatches(existing, run, detail)) {
      return yield* reject(run, "provider-activity absence key contains a foreign event")
    }
    const validation = validateProviderRunActivityAbsent(records, existing)
    return validation._tag === "Valid" ? existing : yield* reject(run, validation.detail)
  }
  const appended = yield* (yield* InRunJournal).append(runIdFor(run), key, expected).pipe(
    Effect.catchTag("JournalStoreContradiction", ({ existingPosition }) =>
      Effect.gen(function* () {
        const refreshed = yield* (yield* InRunJournal).read(runIdFor(run))
        const winner = refreshed.find((record) => record.position === existingPosition)
        if (winner !== undefined && absenceMatches(winner, run, detail)) {
          const validation = validateProviderRunActivityAbsent(refreshed, winner)
          if (validation._tag === "Valid") return winner
        }
        return yield* reject(run, "provider-activity absence append contradicted existing Journal history")
      })
    )
  )
  if (!absenceMatches(appended, run, detail)) {
    return yield* reject(run, "provider-activity absence append returned a foreign Journal record")
  }
  const refreshed = yield* (yield* InRunJournal).read(runIdFor(run))
  const validation = validateProviderRunActivityAbsent(refreshed, appended)
  return validation._tag === "Valid" ? appended : yield* reject(run, validation.detail)
})

/**
 * Appends or recovers provider-absence evidence and its dependent quarantine.
 * The detail input is intentionally usable after a crash between the two
 * appends, when no provider call should be repeated.
 */
export const reconcileProviderRunFailureQuarantine = Effect.fn(
  "IntegrationQuarantine.reconcileProviderRunFailureQuarantine"
)(function* (input: ProviderRunFailureQuarantineInput) {
  const journal = yield* InRunJournal
  const run = input.run
  const runId = runIdFor(run)
  const records = yield* journal.read(runId)
  const predecessors = validateRunOnePredecessors(records, run)
  if (predecessors._tag === "Invalid") return yield* reject(run, predecessors.detail)

  const detail = input.detail
  const absence = yield* appendOrReconcileAbsence(run, detail, records)
  const afterAbsence = yield* journal.read(runId)
  const basis = IntegrationQuarantineBasis.cases.ProviderRunFailure.make({
    detail,
    ownedActivityProvenAbsentAt: absence.position
  })
  const key = integrationQuarantinedRecordKey(run.session.sessionId, basis)
  const expected = IntegrationQuarantinedEvent.make({
    basis,
    correlation: run.session,
    occurrenceClassification: "NonActionOccurrence",
    version: workflowJournalEventVersion
  })
  const sessionQuarantines = afterAbsence.filter(
    (record) =>
      record.event._tag === "IntegrationQuarantined" &&
      integratorCorrelationsEqual(record.event.correlation, run.session)
  )
  const retryPriorQuarantineAt =
    run.ordinal === integratorRetryRunOrdinal
      ? (() => {
          const authorization = evaluateIntegratorRetryAuthorization(afterAbsence, run, {
            beforePosition: predecessors.value.runStart.position
          })
          return authorization._tag === "Authorized" ? authorization.authorization.quarantine.position : undefined
        })()
      : undefined
  if (
    sessionQuarantines.some(
      (record) =>
        !quarantineMatches(record, run, expected, key) &&
        !(retryPriorQuarantineAt !== undefined && record.position === retryPriorQuarantineAt)
    )
  ) {
    return yield* reject(run, "provider-run quarantine contradicts an existing quarantine occurrence")
  }
  const existingAtKey = exactJournalRecordAtKey(afterAbsence, key)
  if (existingAtKey._tag === "Duplicate") return yield* reject(run, existingAtKey.detail)
  if (existingAtKey._tag === "Found") {
    const existing = existingAtKey.record
    if (!quarantineMatches(existing, run, expected, key)) {
      return yield* reject(run, "provider-run quarantine key contains a foreign event")
    }
    return { absence, quarantine: existing }
  }
  const appended = yield* journal.append(runId, key, expected).pipe(
    Effect.catchTag("JournalStoreContradiction", ({ existingPosition }) =>
      Effect.gen(function* () {
        const refreshed = yield* journal.read(runId)
        const winner = refreshed.find((record) => record.position === existingPosition)
        if (winner !== undefined && quarantineMatches(winner, run, expected, key)) return winner
        return yield* reject(run, "provider-run quarantine append contradicted existing Journal history")
      })
    )
  )
  if (!quarantineMatches(appended, run, expected, key)) {
    return yield* reject(run, "provider-run quarantine append returned a foreign Journal record")
  }
  return { absence, quarantine: appended }
})

/** Provider-boundary entry point; ordinary IntegratorCallFailure never reaches this path. */
export const appendProviderRunFailureQuarantine = Effect.fn("IntegrationQuarantine.appendProviderRunFailureQuarantine")(
  function* (input: { readonly run: IntegratorRunCorrelation; readonly failure: IntegratorProviderActivityAbsent }) {
    if (!integratorRunCorrelationsEqual(input.failure.correlation, input.run)) {
      return yield* reject(input.run, "provider-activity absence is bound to a foreign Integrator run")
    }
    return yield* reconcileProviderRunFailureQuarantine({
      detail: IntegrationQuarantineFailureDetail.make(input.failure.detail),
      run: input.run
    })
  }
)
