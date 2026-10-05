import type {
  JournalRecord,
  JournalAppendError,
  JournalError,
  InRunJournalRunMismatch
} from "../../../workflow-journal/store.js"
import { evaluateResultRecoveryContinueFacts } from "./authorization.js"
import { PlannedAttemptContinuationWitness } from "../planned-attempt-continuation/events.js"
import { plannedAttemptExecutorCorrelation, samePlannedAttemptExecutorCorrelation } from "@dalph/contracts"
import { Effect, Schema, Semaphore } from "effect"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import { AcceptedJournalReader } from "../../../workflow-journal/accepted-reader.js"
import { journalRecordByKey } from "../../../workflow-journal/record-evidence.js"
import {
  resultRecoveryDirectedRecordKey,
  resultRecoveryContinueAuthorizedRecordKey
} from "../../../workflow-journal/record-key.js"
import { InRunJournal, WorkflowRunNotBegan } from "../../../workflow-journal/store.js"
import { exactWorkflowRunTargetFor } from "../../../workflow-journal/run-target.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  PlannedAttemptProtocolController,
  type PlannedAttemptProtocolPermit
} from "../planned-attempt-executor-work/protocol-controller.js"
import {
  ApplyResultRecoveryRequest,
  ResultRecoveryDirectedEvent,
  ResultRecoveryRequestId,
  ResultRecoveryContinueAuthorizedEvent
} from "./events.js"
import { evaluateResultRecoveryDirectionApplication } from "./protocol.js"

export class ResultRecoveryNotAvailable extends Schema.TaggedError<ResultRecoveryNotAvailable>()(
  "ResultRecoveryNotAvailable",
  { requestId: ResultRecoveryRequestId, detail: Schema.NonEmptyString }
) {}
export class ResultRecoveryRequestIdentityContradiction extends Schema.TaggedError<ResultRecoveryRequestIdentityContradiction>()(
  "ResultRecoveryRequestIdentityContradiction",
  { requestId: ResultRecoveryRequestId, existingPosition: JournalPosition }
) {}
export class ResultRecoveryDirectionNotFound extends Schema.TaggedError<ResultRecoveryDirectionNotFound>()(
  "ResultRecoveryDirectionNotFound",
  { requestId: ResultRecoveryRequestId }
) {}

export const authorizeResultRecoveryContinueWithPermit: (
  permit: PlannedAttemptProtocolPermit,
  input: unknown,
  witness: unknown
) => Effect.Effect<
  ResultRecoveryContinueAuthorizationRecord,
  ResultRecoveryAuthorizationError,
  InRunJournal | AcceptedJournalReader
> = Effect.fn("ResultRecoveryControl.authorizeContinue")(function* (
  providedPermit: PlannedAttemptProtocolPermit,
  input: unknown,
  witnessInput: unknown
) {
  const journal = yield* InRunJournal
  const accepted = yield* AcceptedJournalReader
  const requestId = yield* Schema.decodeUnknownEffect(ResultRecoveryRequestId, { onExcessProperty: "error" })(input)
  const witness = yield* Schema.decodeUnknownEffect(PlannedAttemptContinuationWitness, { onExcessProperty: "error" })(
    witnessInput
  )
  const initial = yield* accepted.readAccepted(requestId.runId)
  const direction = journalRecordByKey(initial, resultRecoveryDirectedRecordKey(requestId))
  if (direction?.event._tag !== "ResultRecoveryDirected")
    return yield* new ResultRecoveryDirectionNotFound({ requestId })
  const plannedAttempt = direction.event.subject.plannedAttempt
  const underPermit = (permit: PlannedAttemptProtocolPermit) =>
    permit.recordFact(
      Effect.gen(function* () {
        const records = yield* accepted.readAccepted(requestId.runId)
        const key = resultRecoveryContinueAuthorizedRecordKey(requestId)
        const existing = journalRecordByKey(records, key)
        if (existing?.event._tag === "ResultRecoveryContinueAuthorized") {
          if (!Schema.toEquivalence(PlannedAttemptContinuationWitness)(existing.event.witness, witness))
            return yield* new ResultRecoveryRequestIdentityContradiction({
              requestId,
              existingPosition: existing.position
            })
          return { ...existing, event: existing.event }
        }
        const evaluation = evaluateResultRecoveryContinueFacts(records, requestId, witness)
        if (evaluation._tag !== "Authorized")
          return yield* new ResultRecoveryNotAvailable({ requestId, detail: evaluation.detail })
        const recorded = yield* journal.append(
          requestId.runId,
          key,
          ResultRecoveryContinueAuthorizedEvent.make({
            requestId,
            plannedAttempt,
            witness,
            version: workflowJournalEventVersion
          })
        )
        return {
          ...recorded,
          event: yield* Schema.decodeUnknownEffect(ResultRecoveryContinueAuthorizedEvent)(recorded.event)
        }
      })
    )
  if (
    !samePlannedAttemptExecutorCorrelation(
      providedPermit.correlation,
      plannedAttemptExecutorCorrelation(plannedAttempt)
    )
  )
    return yield* new ResultRecoveryNotAvailable({
      requestId,
      detail: "Continue authorization requires its exact protocol permit"
    })
  return yield* underPermit(providedPermit)
})

export type ResultRecoveryDirectionRecord = Omit<JournalRecord, "event"> & {
  readonly event: ResultRecoveryDirectedEvent
}
export type ResultRecoveryContinueAuthorizationRecord = Omit<JournalRecord, "event"> & {
  readonly event: ResultRecoveryContinueAuthorizedEvent
}
type ResultRecoveryReadError =
  | Schema.SchemaError
  | JournalError
  | InRunJournalRunMismatch
  | ResultRecoveryDirectionNotFound
type ResultRecoveryWriteError =
  | Schema.SchemaError
  | JournalAppendError
  | WorkflowRunNotBegan
  | ResultRecoveryNotAvailable
  | ResultRecoveryRequestIdentityContradiction
type ResultRecoveryAuthorizationError =
  | Schema.SchemaError
  | JournalAppendError
  | ResultRecoveryDirectionNotFound
  | ResultRecoveryNotAvailable
  | ResultRecoveryRequestIdentityContradiction

/** Public control results name one exact event instead of exporting the entire journal vocabulary. */
export interface ResultRecoveryControlService {
  readonly apply: (input: unknown) => Effect.Effect<ResultRecoveryDirectionRecord, ResultRecoveryWriteError>
  readonly read: (input: unknown) => Effect.Effect<ResultRecoveryDirectionRecord, ResultRecoveryReadError>
  readonly inspectContinueFacts: (
    input: unknown,
    witness: unknown
  ) => Effect.Effect<
    ReturnType<typeof evaluateResultRecoveryContinueFacts>,
    Schema.SchemaError | JournalError | InRunJournalRunMismatch
  >
  readonly authorizeContinue: (
    input: unknown,
    witness: unknown
  ) => Effect.Effect<ResultRecoveryContinueAuthorizationRecord, ResultRecoveryAuthorizationError>
  readonly authorizeContinueWithPermit: (
    permit: PlannedAttemptProtocolPermit,
    input: unknown,
    witness: unknown
  ) => Effect.Effect<ResultRecoveryContinueAuthorizationRecord, ResultRecoveryAuthorizationError>
}

/** Constructs one Run-owned control; durable direction precedes fresh authority and provider effects. */
export const makeResultRecoveryControl: () => Effect.Effect<
  ResultRecoveryControlService,
  never,
  InRunJournal | AcceptedJournalReader | PlannedAttemptProtocolController
> = Effect.fn("ResultRecoveryControl.make")(function* () {
  const journal = yield* InRunJournal
  const accepted = yield* AcceptedJournalReader
  const protocols = yield* PlannedAttemptProtocolController
  const applications = yield* Semaphore.make(1)
  const apply = Effect.fn("ResultRecoveryControl.apply")(function* (input: unknown) {
    const request = yield* Schema.decodeUnknownEffect(ApplyResultRecoveryRequest, { onExcessProperty: "error" })(input)
    const runId = request.subject.plannedAttempt.runId
    return yield* protocols.withPermit(plannedAttemptExecutorCorrelation(request.subject.plannedAttempt), (permit) =>
      permit.recordFact(
        Effect.gen(function* () {
          const records = yield* accepted.readAccepted(runId)
          if (exactWorkflowRunTargetFor(records) === undefined) return yield* new WorkflowRunNotBegan({ runId })
          const key = resultRecoveryDirectedRecordKey(request.requestId)
          const decision = evaluateResultRecoveryDirectionApplication(request, runId, records)
          if (decision._tag === "ExactRedelivery") return decision.record
          if (decision._tag === "IdentityContradiction")
            return yield* new ResultRecoveryRequestIdentityContradiction({
              requestId: request.requestId,
              existingPosition: decision.record.position
            })
          if (decision._tag === "Unavailable")
            return yield* new ResultRecoveryNotAvailable({ requestId: request.requestId, detail: decision.detail })
          const event = ResultRecoveryDirectedEvent.make({
            ...request,
            initiatedBy: { _tag: "Operator" },
            occurrenceClassification: "InitiatedAction",
            version: workflowJournalEventVersion
          })
          const recorded = yield* journal.append(runId, key, event)
          return { ...recorded, event: yield* Schema.decodeUnknownEffect(ResultRecoveryDirectedEvent)(recorded.event) }
        })
      )
    )
  })
  const read = Effect.fn("ResultRecoveryControl.read")(function* (input: unknown) {
    const requestId = yield* Schema.decodeUnknownEffect(ResultRecoveryRequestId, { onExcessProperty: "error" })(input)
    const records = yield* accepted.readAccepted(requestId.runId)
    const record = journalRecordByKey(records, resultRecoveryDirectedRecordKey(requestId))
    if (record?.event._tag !== "ResultRecoveryDirected")
      return yield* new ResultRecoveryDirectionNotFound({ requestId })
    return { ...record, event: record.event }
  })
  const inspectContinueFacts = Effect.fn("ResultRecoveryControl.inspectContinueFacts")(function* (
    input: unknown,
    witnessInput: unknown
  ) {
    const requestId = yield* Schema.decodeUnknownEffect(ResultRecoveryRequestId, { onExcessProperty: "error" })(input)
    const witness = yield* Schema.decodeUnknownEffect(PlannedAttemptContinuationWitness, { onExcessProperty: "error" })(
      witnessInput
    )
    const records = yield* accepted.readAccepted(requestId.runId)
    return evaluateResultRecoveryContinueFacts(records, requestId, witness)
  })
  const authorize = (permit: PlannedAttemptProtocolPermit, input: unknown, witness: unknown) =>
    authorizeResultRecoveryContinueWithPermit(permit, input, witness).pipe(
      Effect.provideService(InRunJournal, journal),
      Effect.provideService(AcceptedJournalReader, accepted)
    )
  return {
    authorizeContinueWithPermit: (permit: PlannedAttemptProtocolPermit, input: unknown, witness: unknown) =>
      applications.withPermit(authorize(permit, input, witness)),
    authorizeContinue: (input: unknown, witness: unknown) =>
      applications.withPermit(
        Effect.gen(function* () {
          const directed = yield* read(input)
          return yield* protocols.withPermit(
            plannedAttemptExecutorCorrelation(directed.event.subject.plannedAttempt),
            (permit) => authorize(permit, input, witness)
          )
        })
      ),
    inspectContinueFacts,
    apply: (input: unknown) => applications.withPermit(apply(input)),
    read: (input: unknown) => applications.withPermit(read(input))
  }
})
