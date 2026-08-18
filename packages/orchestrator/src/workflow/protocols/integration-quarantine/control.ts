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
  integrationQuarantineDirectionAppliedRecordKey
} from "../../../workflow-journal/record-key.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  ApplyIntegrationQuarantineDirectionRequest,
  IntegrationQuarantineDirectionAppliedEvent,
  IntegrationQuarantineDirectionRequestId,
  integrationQuarantineDirectionRunId,
  integrationQuarantineDirectionSubject,
  sameIntegrationQuarantineDirectionFingerprint,
  sameIntegrationQuarantineDirectionRequestId,
  sameIntegrationQuarantineDirectionSubject
} from "./events.js"
import { ReadIntegrationQuarantineDirectionRequest } from "./request.js"
import { quarantineRecordForFingerprint } from "./state.js"

/** A transport identity was redelivered with different exact direction content. */
export class IntegrationQuarantineDirectionRequestIdentityContradiction extends Schema.TaggedError<
  IntegrationQuarantineDirectionRequestIdentityContradiction
>()("IntegrationQuarantineDirectionRequestIdentityContradiction", {
  existingPosition: JournalPosition,
  requestId: IntegrationQuarantineDirectionRequestId,
  runId: RunId
}) {}

/** A request transport Run must match the Run bound to the quarantined responsibility. */
export class IntegrationQuarantineDirectionRequestRunMismatch extends Schema.TaggedError<
  IntegrationQuarantineDirectionRequestRunMismatch
>()("IntegrationQuarantineDirectionRequestRunMismatch", {
  boundRunId: RunId,
  requestId: IntegrationQuarantineDirectionRequestId,
  subjectRunId: RunId
}) {}

/** A different direction or transport request already won this quarantine occurrence. */
export class IntegrationQuarantineDirectionAlreadyApplied extends Schema.TaggedError<
  IntegrationQuarantineDirectionAlreadyApplied
>()("IntegrationQuarantineDirectionAlreadyApplied", {
  existingPosition: JournalPosition,
  requestId: IntegrationQuarantineDirectionRequestId,
  runId: RunId,
  winningFingerprint: ApplyIntegrationQuarantineDirectionRequest.fields.fingerprint,
  winningRequestId: IntegrationQuarantineDirectionRequestId
}) {}

/** The requested Journal position is not an exact quarantine for the named session. */
export class IntegrationQuarantineDirectionNotAvailable extends Schema.TaggedError<
  IntegrationQuarantineDirectionNotAvailable
>()("IntegrationQuarantineDirectionNotAvailable", {
  fingerprint: ApplyIntegrationQuarantineDirectionRequest.fields.fingerprint,
  reason: Schema.Literals(["MissingQuarantine", "SessionMismatch"]),
  runId: RunId
}) {}

/** No durable applied direction exists for the requested transport identity. */
export class IntegrationQuarantineDirectionResultNotFound extends Schema.TaggedError<
  IntegrationQuarantineDirectionResultNotFound
>()("IntegrationQuarantineDirectionResultNotFound", {
  requestId: IntegrationQuarantineDirectionRequestId
}) {}

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

interface IntegrationQuarantineDirectionControlService {
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
      sameIntegrationQuarantineDirectionSubject(integrationQuarantineDirectionSubject(record.event.fingerprint), subject)
  )
}

export const integrationQuarantineDirectionControlLayer = Layer.effect(
  IntegrationQuarantineDirectionControl,
  Effect.gen(function* () {
    const journal = yield* InRunJournal
    const applications = yield* Semaphore.make(1)
    const applyUnserialized = Effect.fn("IntegrationQuarantineDirectionControl.apply")(function* (input: unknown) {
      const request = yield* Schema.decodeUnknownEffect(ApplyIntegrationQuarantineDirectionRequest, {
        onExcessProperty: "error"
      })(input)
      const runId = request.requestId.runId
      const records = yield* journal.read(runId)
      if (!runHasBegan(records)) return yield* new WorkflowRunNotBegan({ runId })

      const existingRequest = appliedRecordsForRequest(records, request.requestId)[0]
      if (existingRequest !== undefined) {
        if (sameIntegrationQuarantineDirectionFingerprint(existingRequest.event.fingerprint, request.fingerprint)) {
          return resultFor(existingRequest)
        }
        return yield* new IntegrationQuarantineDirectionRequestIdentityContradiction({
          existingPosition: existingRequest.position,
          requestId: request.requestId,
          runId
        })
      }

      const quarantine = quarantineRecordForFingerprint(records, request.fingerprint)
      if (quarantine === undefined) {
        const samePosition = records.find(({ position }) => position === request.fingerprint.quarantineAt)
        return yield* new IntegrationQuarantineDirectionNotAvailable({
          fingerprint: request.fingerprint,
          reason: samePosition === undefined ? "MissingQuarantine" : "SessionMismatch",
          runId
        })
      }
      const subjectRunId = integrationQuarantineDirectionRunId(quarantine.event.correlation)
      if (subjectRunId !== runId) {
        return yield* new IntegrationQuarantineDirectionRequestRunMismatch({
          boundRunId: runId,
          requestId: request.requestId,
          subjectRunId
        })
      }

      const existingSubject = appliedRecordsForSubject(records, request.fingerprint)[0]
      if (existingSubject !== undefined) {
        return yield* new IntegrationQuarantineDirectionAlreadyApplied({
          existingPosition: existingSubject.position,
          requestId: request.requestId,
          runId,
          winningFingerprint: existingSubject.event.fingerprint,
          winningRequestId: existingSubject.event.requestId
        })
      }

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
  })
)
