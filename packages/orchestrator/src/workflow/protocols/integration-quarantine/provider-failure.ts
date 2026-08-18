/* eslint-disable max-lines -- Exact provider absence validation and reconciliation share one chronology owner. */
import { Effect, Schema } from "effect"
import { plannedTaskAttemptEquivalence } from "@dalph/contracts"
import {
  integrationProviderRunActivityAbsentRecordKey,
  integrationQuarantinedRecordKey,
  integratorRunStartedRecordKey,
  integratorSessionFixedRecordKey,
  integratorSuccessorSessionFixedRecordKey
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
  type IntegratorCorrelation,
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
import { evaluateIntegratorRetryAuthorization } from "../integrator/retry-authorization.js"

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

const fixedSessionKey = (session: IntegratorCorrelation) =>
  integratorSessionFixedRecordKey(integratorResponsibilityFactsFromCorrelation(session))

const initialRunOrdinal = IntegratorRunOrdinal.make(1)

const absenceKey = integrationProviderRunActivityAbsentRecordKey

const sameResponsibility = (left: IntegratorCorrelation, right: IntegratorCorrelation): boolean =>
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

const fixedSessionForRun = (
  history: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation
): FixedSessionValidation => {
  const direct = history.filter(
    (
      record
    ): record is JournalRecord & {
      readonly event: Extract<JournalRecord["event"], { readonly _tag: "IntegratorSessionFixed" }>
    } => record.event._tag === "IntegratorSessionFixed" && sameResponsibility(record.event.correlation, run.session)
  )
  const successors = history.filter(
    (
      record
    ): record is JournalRecord & {
      readonly event: Extract<JournalRecord["event"], { readonly _tag: "IntegratorSuccessorSessionFixed" }>
    } =>
      record.event._tag === "IntegratorSuccessorSessionFixed" &&
      integratorCorrelationsEqual(record.event.successor, run.session)
  )
  if (successors.length > 1) {
    return { _tag: "Invalid", detail: "provider run has duplicate FullRerun successor session evidence" }
  }
  const successor = successors[0]
  if (successor === undefined) {
    const key = fixedSessionKey(run.session)
    if (
      direct.length !== 1 ||
      direct.some(
        (record) =>
          !integratorCorrelationsEqual(record.event.correlation, run.session) ||
          record.runId !== runIdFor(run) ||
          record.key !== key
      )
    ) {
      return { _tag: "Invalid", detail: "fixed Integrator session evidence is foreign to the provider run" }
    }
    const lineage = history.find(
      (
        record
      ): record is JournalRecord & {
        readonly event: Extract<JournalRecord["event"], { readonly _tag: "TargetLineageObserved" }>
      } => record.position === run.session.targetLineageObservedAt && record.event._tag === "TargetLineageObserved"
    )
    if (
      lineage === undefined ||
      !plannedTaskAttemptEquivalence(lineage.event.plannedAttempt, run.session.plannedAttempt) ||
      lineage.event.observation.plannedBaseSha !== run.session.plannedAttempt.baseSha ||
      !lineage.event.observation.plannedBaseIsAncestorOfTargetHead ||
      lineage.event.observation.targetHeadSha !== run.session.expectedTargetHead
    ) {
      return { _tag: "Invalid", detail: "provider run lacks its exact target-lineage observation" }
    }
    const sessionLookup = exactJournalRecordAtKey(history, key)
    if (sessionLookup._tag === "Duplicate") return { _tag: "Invalid", detail: sessionLookup.detail }
    /* v8 ignore next -- @preserve the sole direct fixed-session record was already proven to carry this canonical key, so exact lookup cannot be Missing. */
    if (sessionLookup._tag === "Missing") {
      return { _tag: "Invalid", detail: "provider run lacks its exact fixed Integrator session" }
    }
    const session = sessionLookup.record
    return session.runId === runIdFor(run) &&
      session.event._tag === "IntegratorSessionFixed" &&
      integratorCorrelationsEqual(session.event.correlation, run.session) &&
      session.position > run.session.targetLineageObservedAt
      ? { _tag: "Valid", session }
      : { _tag: "Invalid", detail: "provider run lacks its exact fixed Integrator session" }
  }

  const predecessor = successor.event.predecessor
  const predecessorSessions = history.filter(
    (record) =>
      record.event._tag === "IntegratorSessionFixed" &&
      integratorCorrelationsEqual(record.event.correlation, predecessor)
  )
  const predecessorKey = fixedSessionKey(predecessor)
  const predecessorLookup = exactJournalRecordAtKey(history, predecessorKey)
  if (
    predecessorLookup._tag !== "Found" ||
    predecessorSessions.length !== 1 ||
    predecessorSessions.some((record) => record.runId !== runIdFor(run) || record.key !== predecessorKey) ||
    predecessorLookup.record.runId !== runIdFor(run) ||
    predecessorLookup.record.event._tag !== "IntegratorSessionFixed" ||
    !integratorCorrelationsEqual(predecessorLookup.record.event.correlation, predecessor) ||
    predecessorLookup.record.position <= predecessor.targetLineageObservedAt
  ) {
    return { _tag: "Invalid", detail: "provider successor lacks the exact predecessor session" }
  }
  if (
    direct.length !== predecessorSessions.length ||
    direct.some((record) => !integratorCorrelationsEqual(record.event.correlation, predecessor))
  ) {
    return { _tag: "Invalid", detail: "provider successor has foreign fixed-session evidence" }
  }
  const successorKey = integratorSuccessorSessionFixedRecordKey(
    predecessor,
    successor.event.quarantineAt,
    successor.event.directionAppliedAt
  )
  if (
    successor.runId !== runIdFor(run) ||
    successor.key !== successorKey ||
    successor.position <= run.session.targetLineageObservedAt
  ) {
    return { _tag: "Invalid", detail: "provider successor session has a foreign key or chronology" }
  }
  const quarantine = history.find(
    (
      record
    ): record is JournalRecord & {
      readonly event: Extract<JournalRecord["event"], { readonly _tag: "IntegrationQuarantined" }>
    } => record.position === successor.event.quarantineAt && record.event._tag === "IntegrationQuarantined"
  )
  const direction = history.find(
    (
      record
    ): record is JournalRecord & {
      readonly event: Extract<JournalRecord["event"], { readonly _tag: "IntegrationQuarantineDirectionApplied" }>
    } =>
      record.position === successor.event.directionAppliedAt &&
      record.event._tag === "IntegrationQuarantineDirectionApplied"
  )
  if (
    quarantine === undefined ||
    !integratorCorrelationsEqual(quarantine.event.correlation, predecessor) ||
    direction === undefined ||
    direction.event.fingerprint.direction !== "FullRerun" ||
    direction.event.fingerprint.quarantineAt !== successor.event.quarantineAt ||
    direction.event.fingerprint.sessionId !== predecessor.sessionId ||
    !(predecessorLookup.record.position < quarantine.position && quarantine.position < direction.position)
  ) {
    return { _tag: "Invalid", detail: "provider successor lacks the exact Q/D predecessor chronology" }
  }
  const lineage = history.find(
    (
      record
    ): record is JournalRecord & {
      readonly event: Extract<JournalRecord["event"], { readonly _tag: "TargetLineageObserved" }>
    } => record.position === run.session.targetLineageObservedAt && record.event._tag === "TargetLineageObserved"
  )
  if (
    lineage === undefined ||
    !plannedTaskAttemptEquivalence(lineage.event.plannedAttempt, run.session.plannedAttempt) ||
    lineage.event.observation.plannedBaseSha !== run.session.plannedAttempt.baseSha ||
    !lineage.event.observation.plannedBaseIsAncestorOfTargetHead ||
    lineage.event.observation.targetHeadSha !== run.session.expectedTargetHead ||
    lineage.position <= direction.position
  ) {
    return { _tag: "Invalid", detail: "provider successor lacks its exact fresh target-lineage observation" }
  }
  const lineageIntent = history.some(
    (record) =>
      record.event._tag === "GitReadIntentRecorded" &&
      record.event.operation._tag === "ReadTargetLineage" &&
      record.event.operation.operationId === lineage.event.operationId &&
      record.position > direction.position &&
      record.position < lineage.position &&
      plannedTaskAttemptEquivalence(record.event.operation.plannedAttempt, run.session.plannedAttempt) &&
      record.event.operation.integrationTarget.repository === run.session.integrationTarget.repository &&
      record.event.operation.integrationTarget.ref === run.session.integrationTarget.ref
  )
  return lineageIntent
    ? { _tag: "Valid", session: successor }
    : { _tag: "Invalid", detail: "provider successor Git intent does not follow FullRerun direction" }
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

const validateRunOnePredecessors = (
  records: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation,
  beforePosition?: JournalRecord["position"]
): ProviderRunPredecessorValidation => {
  if (run.ordinal !== initialRunOrdinal && run.ordinal !== integratorRetryRunOrdinal) {
    return invalidPredecessor("provider-run quarantine accepts only Integrator runs 1 and 2")
  }
  const history = beforePosition === undefined ? records : records.filter((record) => record.position < beforePosition)

  const fixedSession = fixedSessionForRun(history, run)
  if (fixedSession._tag === "Invalid") return invalidPredecessor(fixedSession.detail)
  const session = fixedSession.session

  const runStart = providerRunStartFor(history, run)
  if (runStart === undefined || runStart.position <= session.position) {
    return invalidPredecessor("provider-run quarantine requires one exact run start after the fixed session")
  }

  if (run.ordinal === integratorRetryRunOrdinal) {
    const authorization = evaluateIntegratorRetryAuthorization(history, run, { beforePosition: runStart.position })
    if (authorization._tag === "Rejected") return invalidPredecessor(authorization.detail)
    if (
      authorization.authorization.lineage.observation.event.observation.targetHeadSha !== run.session.expectedTargetHead
    ) {
      return invalidPredecessor("Retry provider-run quarantine requires an unchanged fresh target head")
    }
  }

  // A provider absence is only valid before any result or candidate evidence
  // for the same run. A lost/ambiguous call is not converted into absence.
  if (
    history.some(
      (record) =>
        record.event._tag === "IntegratorRunResultRecorded" &&
        record.runId === runIdFor(run) &&
        integratorRunCorrelationsEqual(record.event.run, run)
    )
  ) {
    return invalidPredecessor("provider-run absence contradicts an already recorded Integrator result")
  }
  if (
    history.some(
      (record) =>
        (record.event._tag === "IntegratorRunCandidateGitReadIntended" ||
          record.event._tag === "IntegratorRunCandidateGitObserved") &&
        record.runId === runIdFor(run) &&
        integratorRunCorrelationsEqual(record.event.run, run)
    )
  ) {
    return invalidPredecessor("provider-run absence contradicts run-bound candidate evidence")
  }
  if (
    run.ordinal === initialRunOrdinal &&
    history.some(
      (record) =>
        (record.event._tag === "IntegratorResultRecorded" ||
          record.event._tag === "IntegratorCandidateGitReadIntended" ||
          record.event._tag === "IntegratorCandidateGitObserved") &&
        ((record.event._tag === "IntegratorResultRecorded" &&
          integratorCorrelationsEqual(record.event.result.correlation, run.session)) ||
          ((record.event._tag === "IntegratorCandidateGitReadIntended" ||
            record.event._tag === "IntegratorCandidateGitObserved") &&
            integratorCorrelationsEqual(record.event.correlation, run.session)))
    )
  ) {
    return invalidPredecessor("legacy session-only Integrator evidence cannot establish provider-run absence")
  }
  return validPredecessor({ session, runStart })
}

/** Pure validation used by reconstruction and recovery to prove one exact provider absence. */
export const validateProviderRunActivityAbsent = (
  records: ReadonlyArray<JournalRecord>,
  record: JournalRecord
):
  | {
      readonly _tag: "Valid"
      readonly run: IntegratorRunCorrelation
      readonly record: AbsenceRecord
      readonly runStart: JournalRecord
    }
  | { readonly _tag: "Invalid"; readonly detail: string } => {
  if (record.event._tag !== "IntegrationProviderRunActivityAbsent") {
    return { _tag: "Invalid", detail: "record is not provider-activity absence evidence" }
  }
  const run = record.event.run
  if (!integratorCorrelationsEqual(record.event.correlation, run.session)) {
    return { _tag: "Invalid", detail: "provider-activity absence has a foreign session correlation" }
  }
  const predecessors = validateRunOnePredecessors(records, run, record.position)
  if (predecessors._tag === "Invalid") return predecessors
  if (!absenceMatches(record, run, record.event.detail)) {
    return { _tag: "Invalid", detail: "provider-activity absence has a foreign key or Journal Run" }
  }
  const runStartKey = integratorRunStartedRecordKey(run)
  const exactRunStarts = records.filter(
    (candidate) =>
      candidate.event._tag === "IntegratorRunStarted" && integratorRunCorrelationsEqual(candidate.event.run, run)
  )
  if (
    exactRunStarts.length !== 1 ||
    exactRunStarts.some((candidate) => candidate.runId !== runIdFor(run) || candidate.key !== runStartKey)
  ) {
    return { _tag: "Invalid", detail: "provider run-start evidence is duplicate or wrongly keyed" }
  }
  const exactRunAbsences = records.filter(
    (candidate) =>
      candidate.event._tag === "IntegrationProviderRunActivityAbsent" &&
      integratorRunCorrelationsEqual(candidate.event.run, run)
  )
  if (exactRunAbsences.length !== 1 || exactRunAbsences[0] !== record) {
    return { _tag: "Invalid", detail: "provider-activity absence is duplicate or contradictory" }
  }
  const exactRunResultOrCandidate = records.some(
    (candidate) =>
      (candidate.event._tag === "IntegratorRunResultRecorded" &&
        integratorRunCorrelationsEqual(candidate.event.run, run)) ||
      ((candidate.event._tag === "IntegratorRunCandidateGitReadIntended" ||
        candidate.event._tag === "IntegratorRunCandidateGitObserved") &&
        integratorRunCorrelationsEqual(candidate.event.run, run))
  )
  if (exactRunResultOrCandidate) {
    return { _tag: "Invalid", detail: "provider-activity absence contradicts exact run evidence" }
  }
  return { _tag: "Valid", record, run, runStart: predecessors.value.runStart }
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
    if (!integratorCorrelationsEqual(input.failure.correlation, input.run.session)) {
      return yield* reject(input.run, "provider-activity absence is bound to a foreign Integrator session")
    }
    return yield* reconcileProviderRunFailureQuarantine({
      detail: IntegrationQuarantineFailureDetail.make(input.failure.detail),
      run: input.run
    })
  }
)
