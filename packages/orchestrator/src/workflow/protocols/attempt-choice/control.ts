import { plannedTaskAttemptEquivalence, RunId } from "@dalph/contracts"
import { Context, Effect, Layer, Schema, Semaphore } from "effect"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import { attemptChoiceAppliedRecordKey } from "../../../workflow-journal/record-key.js"
import {
  type JournalAppendError,
  type JournalRecord,
  type JournalStoreError,
  InRunJournal,
  type WorkflowRunAlreadyTerminated,
  WorkflowRunNotBegan
} from "../../../workflow-journal/store.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { AttemptChoiceAppliedEvent, AttemptChoiceRequestId, type AttemptChoiceSubject } from "./events.js"
import { ApplyAttemptChoiceRequest } from "./request.js"

/** One request identity was already applied with different exact contents. */
export class AttemptChoiceRequestIdentityContradiction extends Schema.TaggedErrorClass<AttemptChoiceRequestIdentityContradiction>()(
  "AttemptChoiceRequestIdentityContradiction",
  { existingPosition: JournalPosition, requestId: AttemptChoiceRequestId, runId: RunId }
) {}

/** Another valid Continue-or-Stop request already won this exact changed-task choice. */
export class AttemptChoiceAlreadyApplied extends Schema.TaggedErrorClass<AttemptChoiceAlreadyApplied>()(
  "AttemptChoiceAlreadyApplied",
  {
    existingPosition: JournalPosition,
    requestId: AttemptChoiceRequestId,
    runId: RunId,
    winningRequestId: AttemptChoiceRequestId
  }
) {}

/** Current durable history does not expose the requested changed-task choice. */
export class AttemptChoiceNotAvailable extends Schema.TaggedErrorClass<AttemptChoiceNotAvailable>()(
  "AttemptChoiceNotAvailable",
  {
    reason: Schema.Literals(["AttemptNotPlanned", "ExecutorNotSafelySuspended", "ObservedFingerprintNotCurrent"]),
    requestId: AttemptChoiceRequestId,
    runId: RunId
  }
) {}

/** Integration already consumed this exact attempt's pre-integration choice capability. */
export class AttemptChoiceOutsidePreIntegrationPhase extends Schema.TaggedErrorClass<AttemptChoiceOutsidePreIntegrationPhase>()(
  "AttemptChoiceOutsidePreIntegrationPhase",
  { requestId: AttemptChoiceRequestId, runId: RunId }
) {}

type AttemptChoiceControlError =
  | AttemptChoiceAlreadyApplied
  | AttemptChoiceNotAvailable
  | AttemptChoiceOutsidePreIntegrationPhase
  | AttemptChoiceRequestIdentityContradiction
  | JournalAppendError
  | JournalStoreError
  | Schema.SchemaError
  | WorkflowRunAlreadyTerminated
  | WorkflowRunNotBegan

interface AttemptChoiceControlService {
  readonly apply: (input: unknown) => Effect.Effect<JournalRecord, AttemptChoiceControlError>
}

/** Applies one exact pre-integration Continue-or-Stop request. */
export class AttemptChoiceControl extends Context.Service<AttemptChoiceControl, AttemptChoiceControlService>()(
  "@dalph/AttemptChoiceControl"
) {}

const sameSubject = (left: AttemptChoiceSubject, right: AttemptChoiceSubject): boolean =>
  left.observedTaskRevision === right.observedTaskRevision &&
  plannedTaskAttemptEquivalence(left.plannedAttempt, right.plannedAttempt)

const matchingChoice = (records: ReadonlyArray<JournalRecord>, subject: AttemptChoiceSubject) =>
  records.find((record) => record.event._tag === "AttemptChoiceApplied" && sameSubject(record.event.subject, subject))

const choiceIsExposed = (
  records: ReadonlyArray<JournalRecord>,
  request: ApplyAttemptChoiceRequest
): "AttemptNotPlanned" | "ExecutorNotSafelySuspended" | "ObservedFingerprintNotCurrent" | undefined => {
  const planned = records.some(
    ({ event }) =>
      event._tag === "TaskAttemptPlanned" &&
      plannedTaskAttemptEquivalence(event.operation.plannedAttempt, request.subject.plannedAttempt)
  )
  if (!planned) return "AttemptNotPlanned"
  const latestReport = records.findLast(
    ({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkReported" &&
      event.report.correlation.runId === request.subject.plannedAttempt.runId &&
      event.report.correlation.attemptId === request.subject.plannedAttempt.attemptId
  )?.event
  if (latestReport?._tag !== "PlannedAttemptExecutorWorkReported" || latestReport.report._tag !== "SafelySuspended") {
    return "ExecutorNotSafelySuspended"
  }
  const latestSpecification = records.findLast(
    ({ event }) =>
      event._tag === "TaskTrackerFactsObserved" &&
      event.observation._tag === "FocusedTaskWorkSpecificationFacts" &&
      event.observation.factFamily.taskId === request.subject.plannedAttempt.taskId
  )?.event
  return latestSpecification?._tag === "TaskTrackerFactsObserved" &&
    latestSpecification.observation._tag === "FocusedTaskWorkSpecificationFacts" &&
    latestSpecification.observation.factFamily.fingerprint === request.subject.observedTaskRevision
    ? undefined
    : "ObservedFingerprintNotCurrent"
}

export const attemptChoiceControlLayer = Layer.effect(
  AttemptChoiceControl,
  Effect.gen(function* () {
    const journal = yield* InRunJournal
    const applications = yield* Semaphore.make(1)
    const applyUnserialized = Effect.fn("AttemptChoiceControl.apply")(function* (input: unknown) {
      const request = yield* Schema.decodeUnknownEffect(ApplyAttemptChoiceRequest, { onExcessProperty: "error" })(input)
      const runId = request.subject.plannedAttempt.runId
      const records = yield* journal.read(runId)
      if (!records.some(({ event }) => event._tag === "WorkflowRunBegan")) {
        return yield* new WorkflowRunNotBegan({ runId })
      }
      const redelivered = records.find(
        ({ event }) => event._tag === "AttemptChoiceApplied" && event.requestId === request.requestId
      )
      if (redelivered?.event._tag === "AttemptChoiceApplied") {
        if (redelivered.event.choice === request.choice && sameSubject(redelivered.event.subject, request.subject)) {
          return redelivered
        }
        return yield* new AttemptChoiceRequestIdentityContradiction({
          existingPosition: redelivered.position,
          requestId: request.requestId,
          runId
        })
      }
      if (
        records.some(
          ({ event }) =>
            event._tag === "IntegrationStarted" &&
            event.plannedAttempt.attemptId === request.subject.plannedAttempt.attemptId &&
            event.plannedAttempt.runId === runId
        )
      ) {
        return yield* new AttemptChoiceOutsidePreIntegrationPhase({ requestId: request.requestId, runId })
      }
      const existingChoice = matchingChoice(records, request.subject)
      if (existingChoice?.event._tag === "AttemptChoiceApplied") {
        return yield* new AttemptChoiceAlreadyApplied({
          existingPosition: existingChoice.position,
          requestId: request.requestId,
          runId,
          winningRequestId: existingChoice.event.requestId
        })
      }
      const unavailable = choiceIsExposed(records, request)
      if (unavailable !== undefined) {
        return yield* new AttemptChoiceNotAvailable({ reason: unavailable, requestId: request.requestId, runId })
      }
      return yield* journal.append(
        runId,
        attemptChoiceAppliedRecordKey(request.requestId),
        AttemptChoiceAppliedEvent.make({
          choice: request.choice,
          initiatedBy: { _tag: "Operator" },
          occurrenceClassification: "InitiatedAction",
          requestId: request.requestId,
          subject: request.subject,
          version: workflowJournalEventVersion
        })
      )
    })
    return AttemptChoiceControl.of({ apply: (input) => applications.withPermit(applyUnserialized(input)) })
  })
)
