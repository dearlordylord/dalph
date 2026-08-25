import { RunId } from "@dalph/contracts"
import { Context, Effect, Layer, Schema, Semaphore } from "effect"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import {
  type JournalAppendError,
  type JournalRecord,
  type JournalReadError,
  InRunJournal,
  WorkflowRunNotBegan
} from "../../../workflow-journal/store.js"
import {
  integrationProviderRunActivityAbsentRecordKey,
  integrationQuarantineDirectionAppliedRecordKey,
  integratorRunStartedRecordKey
} from "../../../workflow-journal/record-key.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  ApplyIntegrationQuarantineDirectionRequest,
  type IntegrationQuarantineBasis,
  IntegrationQuarantineDirectionAppliedEvent,
  type IntegrationQuarantinedEvent,
  IntegrationQuarantineDirectionRequestId,
  integrationQuarantineDirectionRunId,
  integrationQuarantineDirectionSubject,
  sameIntegrationQuarantineDirectionFingerprint,
  sameIntegrationQuarantineDirectionRequestId,
  sameIntegrationQuarantineDirectionSubject
} from "./events.js"
import { ReadIntegrationQuarantineDirectionRequest } from "./request.js"
import { quarantineRecordForFingerprint } from "./state.js"
import { IntegratorRunCorrelation, IntegratorRunOrdinal, integratorRunCorrelationsEqual } from "../integrator/events.js"
import { integratorCorrelationsEqual } from "../integrator/state.js"

/** A transport identity was redelivered with different exact direction content. */
export class IntegrationQuarantineDirectionRequestIdentityContradiction extends Schema.TaggedError<IntegrationQuarantineDirectionRequestIdentityContradiction>()(
  "IntegrationQuarantineDirectionRequestIdentityContradiction",
  { existingPosition: JournalPosition, requestId: IntegrationQuarantineDirectionRequestId, runId: RunId }
) {}

/** A request transport Run must match the Run bound to the quarantined responsibility. */
export class IntegrationQuarantineDirectionRequestRunMismatch extends Schema.TaggedError<IntegrationQuarantineDirectionRequestRunMismatch>()(
  "IntegrationQuarantineDirectionRequestRunMismatch",
  { boundRunId: RunId, requestId: IntegrationQuarantineDirectionRequestId, subjectRunId: RunId }
) {}

/** A different direction or transport request already won this quarantine occurrence. */
export class IntegrationQuarantineDirectionAlreadyApplied extends Schema.TaggedError<IntegrationQuarantineDirectionAlreadyApplied>()(
  "IntegrationQuarantineDirectionAlreadyApplied",
  {
    existingPosition: JournalPosition,
    requestId: IntegrationQuarantineDirectionRequestId,
    runId: RunId,
    winningFingerprint: ApplyIntegrationQuarantineDirectionRequest.fields.fingerprint,
    winningRequestId: IntegrationQuarantineDirectionRequestId
  }
) {}

/** The requested Journal position is not an exact quarantine for the named session. */
export class IntegrationQuarantineDirectionNotAvailable extends Schema.TaggedError<IntegrationQuarantineDirectionNotAvailable>()(
  "IntegrationQuarantineDirectionNotAvailable",
  {
    fingerprint: ApplyIntegrationQuarantineDirectionRequest.fields.fingerprint,
    reason: Schema.Literals([
      "MissingQuarantine",
      "SessionMismatch",
      "RetryLimitReached",
      "SuccessorGenerationLimitReached"
    ]),
    runId: RunId
  }
) {}

/** No durable applied direction exists for the requested transport identity. */
export class IntegrationQuarantineDirectionResultNotFound extends Schema.TaggedError<IntegrationQuarantineDirectionResultNotFound>()(
  "IntegrationQuarantineDirectionResultNotFound",
  { requestId: IntegrationQuarantineDirectionRequestId }
) {}

type AppliedRecord = JournalRecord & { readonly event: IntegrationQuarantineDirectionAppliedEvent }

export type IntegrationQuarantineDirectionApplicationResult = {
  readonly _tag: "DirectionApplied"
  readonly application: AppliedRecord
}

type IntegrationQuarantineDirectionControlError =
  | IntegrationQuarantineDirectionAlreadyApplied
  | IntegrationQuarantineDirectionNotAvailable
  | IntegrationQuarantineDirectionRequestRunMismatch
  | IntegrationQuarantineDirectionRequestIdentityContradiction
  | IntegrationQuarantineDirectionResultNotFound
  | JournalAppendError
  | JournalReadError
  | Schema.SchemaError
  | WorkflowRunNotBegan

export interface IntegrationQuarantineDirectionControlService {
  readonly apply: (
    input: unknown
  ) => Effect.Effect<IntegrationQuarantineDirectionApplicationResult, IntegrationQuarantineDirectionControlError>
  readonly read: (
    input: unknown
  ) => Effect.Effect<IntegrationQuarantineDirectionApplicationResult, IntegrationQuarantineDirectionControlError>
}

/** Applies one Journal-backed Retry or FullRerun choice without starting runtime work. */
export class IntegrationQuarantineDirectionControl extends Context.Service<
  IntegrationQuarantineDirectionControl,
  IntegrationQuarantineDirectionControlService
>()("@dalph/IntegrationQuarantineDirectionControl") {}

const runHasBegan = (records: ReadonlyArray<JournalRecord>): boolean =>
  records.some(({ event }) => event._tag === "WorkflowRunBegan")

const resultFor = (record: AppliedRecord): IntegrationQuarantineDirectionApplicationResult => ({
  _tag: "DirectionApplied",
  application: record
})

const appliedRecordsForRequest = (
  records: ReadonlyArray<JournalRecord>,
  requestId: IntegrationQuarantineDirectionRequestId
): ReadonlyArray<AppliedRecord> =>
  records.filter(
    (record): record is AppliedRecord =>
      record.event._tag === "IntegrationQuarantineDirectionApplied" &&
      sameIntegrationQuarantineDirectionRequestId(record.event.requestId, requestId)
  )

const appliedRecordsForSubject = (
  records: ReadonlyArray<JournalRecord>,
  fingerprint: ApplyIntegrationQuarantineDirectionRequest["fingerprint"]
): ReadonlyArray<AppliedRecord> => {
  const subject = integrationQuarantineDirectionSubject(fingerprint)
  return records.filter(
    (record): record is AppliedRecord =>
      record.event._tag === "IntegrationQuarantineDirectionApplied" &&
      sameIntegrationQuarantineDirectionSubject(
        integrationQuarantineDirectionSubject(record.event.fingerprint),
        subject
      )
  )
}

type QuarantineRecord = JournalRecord & { readonly event: IntegrationQuarantinedEvent }

const runOneFor = (quarantine: QuarantineRecord): IntegratorRunCorrelation =>
  IntegratorRunCorrelation.make({ ordinal: IntegratorRunOrdinal.make(1), session: quarantine.event.correlation })

const runStartFor = (
  records: ReadonlyArray<JournalRecord>,
  run: IntegratorRunCorrelation,
  before: JournalPosition
): JournalRecord | undefined => {
  const starts = records.filter(
    (record) =>
      record.event._tag === "IntegratorRunStarted" &&
      record.position < before &&
      record.position > run.session.targetLineageObservedAt &&
      integratorRunCorrelationsEqual(record.event.run, run)
  )
  const start = starts[0]
  return start !== undefined &&
    starts.length === 1 &&
    start.runId === run.session.plannedAttempt.runId &&
    start.key === integratorRunStartedRecordKey(run)
    ? start
    : undefined
}

const conclusiveResultIsFromRunOne = (
  records: ReadonlyArray<JournalRecord>,
  quarantine: QuarantineRecord,
  basis: Extract<IntegrationQuarantineBasis, { readonly _tag: "ConclusiveResult" }>
): boolean => {
  const record = records.find(({ position }) => position === basis.evidence.resultRecordedAt)
  /* v8 ignore next -- @preserve quarantineRecordForFingerprint admits only evidence records before Q; an absent or post-Q result is rejected before this eligibility helper. */
  if (record === undefined || record.position >= quarantine.position) return false

  /* v8 ignore next -- @preserve quarantineRecordForFingerprint admits only the exact conclusive-result event selected by this basis. */
  if (record.event._tag !== "IntegratorRunResultRecorded") return false
  const run = runOneFor(quarantine)
  return (
    record.runId === run.session.plannedAttempt.runId &&
    integratorRunCorrelationsEqual(record.event.run, run) &&
    integratorCorrelationsEqual(record.event.result.correlation, quarantine.event.correlation) &&
    runStartFor(records, run, record.position) !== undefined
  )
}

const providerFailureIsFromRunOne = (
  records: ReadonlyArray<JournalRecord>,
  quarantine: QuarantineRecord,
  basis: Extract<IntegrationQuarantineBasis, { readonly _tag: "ProviderRunFailure" }>
): boolean => {
  const run = runOneFor(quarantine)
  const absence = records.find(({ position }) => position === basis.ownedActivityProvenAbsentAt)
  if (absence === undefined || absence.position >= quarantine.position) return false
  return providerAbsenceMatchesRunOne(absence, run, basis) && runStartFor(records, run, absence.position) !== undefined
}

const providerAbsenceMatchesRunOne = (
  absence: JournalRecord,
  run: IntegratorRunCorrelation,
  basis: Extract<IntegrationQuarantineBasis, { readonly _tag: "ProviderRunFailure" }>
): boolean =>
  absence.runId === run.session.plannedAttempt.runId &&
  absence.event._tag === "IntegrationProviderRunActivityAbsent" &&
  absence.event.detail === basis.detail &&
  integratorCorrelationsEqual(absence.event.correlation, run.session) &&
  absence.key === integrationProviderRunActivityAbsentRecordKey(run) &&
  integratorRunCorrelationsEqual(absence.event.run, run)

/** Retry is allowed only from the first quarantine's exact run-one evidence. */
const retryIsEligible = (records: ReadonlyArray<JournalRecord>, quarantine: QuarantineRecord): boolean => {
  const { basis } = quarantine.event
  if (basis._tag === "ConclusiveResult") return conclusiveResultIsFromRunOne(records, quarantine, basis)
  if (basis._tag === "ProviderRunFailure") return providerFailureIsFromRunOne(records, quarantine, basis)
  return false
}

/** Issue #68 permits one FullRerun successor generation; S2 cannot create S3. */
const quarantineBelongsToSuccessor = (records: ReadonlyArray<JournalRecord>, quarantine: QuarantineRecord): boolean =>
  records.some(
    ({ event, position, runId }) =>
      event._tag === "IntegratorSuccessorSessionFixed" &&
      runId === quarantine.runId &&
      position < quarantine.position &&
      integratorCorrelationsEqual(event.successor, quarantine.event.correlation)
  )

const reconcileExistingRequest = (
  records: ReadonlyArray<JournalRecord>,
  request: ApplyIntegrationQuarantineDirectionRequest
): Effect.Effect<
  IntegrationQuarantineDirectionApplicationResult | void,
  IntegrationQuarantineDirectionRequestIdentityContradiction
> => {
  const existing = appliedRecordsForRequest(records, request.requestId)[0]
  if (existing === undefined) return Effect.void
  return sameIntegrationQuarantineDirectionFingerprint(existing.event.fingerprint, request.fingerprint)
    ? Effect.succeed(resultFor(existing))
    : Effect.fail(
        new IntegrationQuarantineDirectionRequestIdentityContradiction({
          existingPosition: existing.position,
          requestId: request.requestId,
          runId: request.requestId.runId
        })
      )
}

const requireQuarantine = (
  records: ReadonlyArray<JournalRecord>,
  request: ApplyIntegrationQuarantineDirectionRequest
): Effect.Effect<QuarantineRecord, IntegrationQuarantineDirectionNotAvailable> => {
  const quarantine = quarantineRecordForFingerprint(records, request.fingerprint)
  if (quarantine !== undefined) return Effect.succeed(quarantine)
  const samePosition = records.some(({ position }) => position === request.fingerprint.quarantineAt)
  return Effect.fail(
    new IntegrationQuarantineDirectionNotAvailable({
      fingerprint: request.fingerprint,
      reason: samePosition ? "SessionMismatch" : "MissingQuarantine",
      runId: request.requestId.runId
    })
  )
}

const ensureDirectionAvailable = (
  records: ReadonlyArray<JournalRecord>,
  request: ApplyIntegrationQuarantineDirectionRequest,
  quarantine: QuarantineRecord
): Effect.Effect<
  void,
  | IntegrationQuarantineDirectionAlreadyApplied
  | IntegrationQuarantineDirectionNotAvailable
  | IntegrationQuarantineDirectionRequestRunMismatch
> => {
  const runId = request.requestId.runId
  const subjectRunId = integrationQuarantineDirectionRunId(quarantine.event.correlation)
  if (subjectRunId !== runId) {
    return Effect.fail(
      new IntegrationQuarantineDirectionRequestRunMismatch({
        requestId: request.requestId,
        boundRunId: runId,
        subjectRunId
      })
    )
  }
  const existingSubject = appliedRecordsForSubject(records, request.fingerprint)[0]
  if (existingSubject !== undefined) {
    return Effect.fail(
      new IntegrationQuarantineDirectionAlreadyApplied({
        existingPosition: existingSubject.position,
        requestId: request.requestId,
        runId,
        winningFingerprint: existingSubject.event.fingerprint,
        winningRequestId: existingSubject.event.requestId
      })
    )
  }
  if (quarantineBelongsToSuccessor(records, quarantine)) {
    return Effect.fail(
      new IntegrationQuarantineDirectionNotAvailable({
        fingerprint: request.fingerprint,
        reason: "SuccessorGenerationLimitReached",
        runId
      })
    )
  }
  return request.fingerprint.direction === "Retry" && !retryIsEligible(records, quarantine)
    ? Effect.fail(
        new IntegrationQuarantineDirectionNotAvailable({
          fingerprint: request.fingerprint,
          reason: "RetryLimitReached",
          runId
        })
      )
    : Effect.void
}

/** Builds the narrow Journal-backed control for use both during and between Run activations. */
export const makeIntegrationQuarantineDirectionControl = Effect.fn("IntegrationQuarantineDirectionControl.make")(
  function* (journal: InRunJournal["Service"]) {
    const applications = yield* Semaphore.make(1)
    const applyUnserialized = Effect.fn("IntegrationQuarantineDirectionControl.apply")(function* (input: unknown) {
      const request = yield* Schema.decodeUnknownEffect(ApplyIntegrationQuarantineDirectionRequest, {
        onExcessProperty: "error"
      })(input)
      const runId = request.requestId.runId
      const records = yield* journal.read(runId)
      if (!runHasBegan(records)) return yield* new WorkflowRunNotBegan({ runId })

      const existingRequest = yield* reconcileExistingRequest(records, request)
      if (existingRequest !== undefined) return existingRequest
      const quarantine = yield* requireQuarantine(records, request)
      yield* ensureDirectionAvailable(records, request, quarantine)

      const event = IntegrationQuarantineDirectionAppliedEvent.make({
        fingerprint: request.fingerprint,
        initiatedBy: { _tag: "Operator" },
        occurrenceClassification: "InitiatedAction",
        requestId: request.requestId,
        version: workflowJournalEventVersion
      })
      return yield* journal
        .append(
          runId,
          integrationQuarantineDirectionAppliedRecordKey(integrationQuarantineDirectionSubject(request.fingerprint)),
          event
        )
        .pipe(
          Effect.flatMap((appended) =>
            appended.event._tag === "IntegrationQuarantineDirectionApplied"
              ? Effect.succeed(resultFor({ ...appended, event }))
              : Effect.fail(
                  new IntegrationQuarantineDirectionRequestIdentityContradiction({
                    existingPosition: appended.position,
                    requestId: request.requestId,
                    runId
                  })
                )
          ),
          Effect.catchTag("JournalStoreContradiction", ({ existingPosition }) =>
            Effect.gen(function* () {
              const refreshed = yield* journal.read(runId)
              const redelivered = appliedRecordsForRequest(refreshed, request.requestId)[0]
              if (redelivered !== undefined) {
                if (sameIntegrationQuarantineDirectionFingerprint(redelivered.event.fingerprint, request.fingerprint)) {
                  return resultFor(redelivered)
                }
                return yield* new IntegrationQuarantineDirectionRequestIdentityContradiction({
                  existingPosition: redelivered.position,
                  requestId: request.requestId,
                  runId
                })
              }
              const winner = appliedRecordsForSubject(refreshed, request.fingerprint)[0]
              if (winner !== undefined) {
                return yield* new IntegrationQuarantineDirectionAlreadyApplied({
                  existingPosition: winner.position,
                  requestId: request.requestId,
                  runId,
                  winningFingerprint: winner.event.fingerprint,
                  winningRequestId: winner.event.requestId
                })
              }
              return yield* new IntegrationQuarantineDirectionRequestIdentityContradiction({
                existingPosition,
                requestId: request.requestId,
                runId
              })
            })
          )
        )
    })
    const readUnserialized = Effect.fn("IntegrationQuarantineDirectionControl.read")(function* (input: unknown) {
      const request = yield* Schema.decodeUnknownEffect(ReadIntegrationQuarantineDirectionRequest, {
        onExcessProperty: "error"
      })(input)
      const records = yield* journal.read(request.requestId.runId)
      const application = appliedRecordsForRequest(records, request.requestId)[0]
      if (application === undefined) {
        return yield* new IntegrationQuarantineDirectionResultNotFound({ requestId: request.requestId })
      }
      return resultFor(application)
    })
    return IntegrationQuarantineDirectionControl.of({
      apply: (input) => applications.withPermit(applyUnserialized(input)),
      read: (input) => applications.withPermit(readUnserialized(input))
    })
  }
)

export const integrationQuarantineDirectionControlLayer = Layer.effect(
  IntegrationQuarantineDirectionControl,
  InRunJournal.pipe(Effect.flatMap(makeIntegrationQuarantineDirectionControl))
)
