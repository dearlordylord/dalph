import { plannedAttemptExecutorCorrelation, plannedTaskAttemptEquivalence, RunId } from "@dalph/contracts"
import { Context, Effect, Layer, Schema, Semaphore } from "effect"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import type { OperationId } from "../../identity.js"
import { type TaskClaimObservation } from "../../../authorities/task-tracker/claim-mutation.js"
import { taskTrackerTargetKey, type TrackerTarget } from "../../../authorities/task-tracker/target.js"
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
import { exactWorkflowRunTargetFor } from "../../../workflow-journal/run-target.js"
import {
  PlannedAttemptProtocolController,
  plannedAttemptProtocolControllerLayer
} from "../planned-attempt-executor-work/protocol-controller.js"
import {
  currentUnconsumedAcceptedSafeEvidence,
  latestAcceptedPlannedAttemptExecutorEvidence
} from "../planned-attempt-executor-work/evidence.js"
import { recordedTaskAttemptPlanFor } from "../task-attempt-planning/journal-evidence.js"
import {
  AttemptChoiceAppliedEvent,
  AttemptChoiceRequestId,
  sameAttemptChoiceRequestId,
  sameAttemptChoiceSubject,
  type AttemptChoiceSubject
} from "./events.js"
import { abandonmentFor, claimReleaseAfter, claimReleaseIntentAfter, noReleaseAfter } from "./control-settlement.js"
import { ApplyAttemptChoiceRequest } from "./request.js"

/** One request identity was already applied with different exact contents. */
export class AttemptChoiceRequestIdentityContradiction extends Schema.TaggedError<AttemptChoiceRequestIdentityContradiction>()(
  "AttemptChoiceRequestIdentityContradiction",
  { existingPosition: JournalPosition, requestId: AttemptChoiceRequestId, runId: RunId }
) {}

/** A self-bound request identity names a different Run than its requested attempt. */
export class AttemptChoiceRequestRunMismatch extends Schema.TaggedError<AttemptChoiceRequestRunMismatch>()(
  "AttemptChoiceRequestRunMismatch",
  { boundRunId: RunId, requestId: AttemptChoiceRequestId, subjectRunId: RunId }
) {}

/** Another valid Continue, Restart, or Stop request already won this exact changed-task choice. */
export class AttemptChoiceAlreadyApplied extends Schema.TaggedError<AttemptChoiceAlreadyApplied>()(
  "AttemptChoiceAlreadyApplied",
  {
    existingPosition: JournalPosition,
    requestId: AttemptChoiceRequestId,
    runId: RunId,
    winningRequestId: AttemptChoiceRequestId
  }
) {}

/** Current durable history does not expose the requested changed-task choice. */
export class AttemptChoiceNotAvailable extends Schema.TaggedError<AttemptChoiceNotAvailable>()(
  "AttemptChoiceNotAvailable",
  {
    reason: Schema.Literals([
      "AttemptNotPlanned",
      "AttemptSuperseded",
      "ExecutorNotSafelySuspended",
      "ObservedFingerprintNotCurrent",
      "TerminalChoiceAlreadyApplied"
    ]),
    requestId: AttemptChoiceRequestId,
    runId: RunId
  }
) {}

/** Integration already consumed this exact attempt's pre-integration choice capability. */
export class AttemptChoiceOutsidePreIntegrationPhase extends Schema.TaggedError<AttemptChoiceOutsidePreIntegrationPhase>()(
  "AttemptChoiceOutsidePreIntegrationPhase",
  { requestId: AttemptChoiceRequestId, runId: RunId }
) {}

/** No applied direction exists for this self-bound request identity. */
export class AttemptChoiceResultNotFound extends Schema.TaggedError<AttemptChoiceResultNotFound>()(
  "AttemptChoiceResultNotFound",
  { requestId: AttemptChoiceRequestId }
) {}

/** The latest durable phase reached only by an applied Stop direction. */
export type AttemptChoiceStopStatus =
  | { readonly _tag: "AwaitingQuiescence" }
  | { readonly _tag: "SupersededByTerminal" }
  | { readonly _tag: "ImplementationAbandonedClaimDispositionPending" }
  | { readonly _tag: "ImplementationAbandonedClaimReleasePending"; readonly operationId: OperationId }
  | { readonly _tag: "SettledReleased"; readonly operationId: OperationId }
  | {
      readonly _tag: "SettledNoRelease"
      readonly observation: TaskClaimObservation
      readonly observationOperationId: OperationId
    }

type AttemptChoiceAppliedRecord<
  Choice extends "ContinueExistingAttempt" | "RestartTaskImplementation" | "StopTaskImplementation"
> = Omit<JournalRecord, "event"> & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "AttemptChoiceApplied" }> & {
    readonly choice: Choice
  }
}

/** Public application/query result: the winning record plus a choice-valid current phase. */
export type AttemptChoiceApplicationResult =
  | { readonly _tag: "ContinueApplied"; readonly application: AttemptChoiceAppliedRecord<"ContinueExistingAttempt"> }
  | { readonly _tag: "RestartApplied"; readonly application: AttemptChoiceAppliedRecord<"RestartTaskImplementation"> }
  | {
      readonly _tag: "StopApplied"
      readonly application: AttemptChoiceAppliedRecord<"StopTaskImplementation">
      readonly status: AttemptChoiceStopStatus
    }

type AttemptChoiceControlError =
  | AttemptChoiceAlreadyApplied
  | AttemptChoiceNotAvailable
  | AttemptChoiceOutsidePreIntegrationPhase
  | AttemptChoiceRequestIdentityContradiction
  | AttemptChoiceRequestRunMismatch
  | AttemptChoiceResultNotFound
  | JournalAppendError
  | JournalStoreError
  | Schema.SchemaError
  | WorkflowRunAlreadyTerminated
  | WorkflowRunNotBegan

interface AttemptChoiceControlService {
  readonly apply: (input: unknown) => Effect.Effect<AttemptChoiceApplicationResult, AttemptChoiceControlError>
  readonly read: (input: unknown) => Effect.Effect<AttemptChoiceApplicationResult, AttemptChoiceControlError>
}

/** Applies one exact pre-integration Continue, Restart, or Stop request. */
export class AttemptChoiceControl extends Context.Service<AttemptChoiceControl, AttemptChoiceControlService>()(
  "@dalph/AttemptChoiceControl"
) {}

const matchingChoice = (records: ReadonlyArray<JournalRecord>, subject: AttemptChoiceSubject) =>
  records.find(
    (record) =>
      record.event._tag === "AttemptChoiceApplied" &&
      (sameAttemptChoiceSubject(record.event.subject, subject) ||
        (record.event.choice === "StopTaskImplementation" &&
          plannedTaskAttemptEquivalence(record.event.subject.plannedAttempt, subject.plannedAttempt)))
  )

const currentResultFor = (
  records: ReadonlyArray<JournalRecord>,
  application: Extract<JournalRecord["event"], { readonly _tag: "AttemptChoiceApplied" }> & {
    readonly choice: "StopTaskImplementation"
  },
  immutableRunTarget: TrackerTarget
): AttemptChoiceStopStatus => {
  const currentExecutorEvidence = latestAcceptedPlannedAttemptExecutorEvidence(
    records,
    application.subject.plannedAttempt
  )
  if (currentExecutorEvidence?.report._tag === "ExecutorWorkTerminal") {
    return { _tag: "SupersededByTerminal" }
  }
  const abandonment = abandonmentFor(records, application)
  if (abandonment === undefined) {
    return { _tag: "AwaitingQuiescence" }
  }
  const expectedClaim = abandonment.event.expectedClaim
  const noRelease = noReleaseAfter(records, abandonment, application, immutableRunTarget)
  if (noRelease !== undefined) {
    return {
      _tag: "SettledNoRelease",
      observation: noRelease.event.observation,
      observationOperationId: noRelease.event.observationOperationId
    }
  }
  const released = claimReleaseAfter(
    records,
    abandonment,
    expectedClaim,
    application.subject.plannedAttempt.taskId,
    immutableRunTarget
  )
  if (released !== undefined) {
    return { _tag: "SettledReleased", operationId: released.event.release.operationId }
  }
  const releaseIntent = claimReleaseIntentAfter(
    records,
    abandonment,
    expectedClaim,
    application.subject.plannedAttempt.taskId,
    immutableRunTarget
  )
  return releaseIntent !== undefined
    ? {
        _tag: "ImplementationAbandonedClaimReleasePending",
        operationId: releaseIntent.event.operation.release.operationId
      }
    : { _tag: "ImplementationAbandonedClaimDispositionPending" }
}

const resultFor = (
  records: ReadonlyArray<JournalRecord>,
  application: JournalRecord,
  event: Extract<JournalRecord["event"], { readonly _tag: "AttemptChoiceApplied" }>,
  immutableRunTarget: TrackerTarget
): AttemptChoiceApplicationResult =>
  event.choice === "StopTaskImplementation"
    ? {
        _tag: "StopApplied",
        application: { ...application, event: { ...event, choice: "StopTaskImplementation" } },
        status: currentResultFor(records, { ...event, choice: "StopTaskImplementation" }, immutableRunTarget)
      }
    : event.choice === "RestartTaskImplementation"
      ? {
          _tag: "RestartApplied",
          application: { ...application, event: { ...event, choice: "RestartTaskImplementation" } }
        }
      : {
          _tag: "ContinueApplied",
          application: { ...application, event: { ...event, choice: "ContinueExistingAttempt" } }
        }

const choiceIsExposed = (
  records: ReadonlyArray<JournalRecord>,
  request: ApplyAttemptChoiceRequest,
  immutableRunTarget: TrackerTarget
):
  | "AttemptNotPlanned"
  | "AttemptSuperseded"
  | "ExecutorNotSafelySuspended"
  | "ObservedFingerprintNotCurrent"
  | "TerminalChoiceAlreadyApplied"
  | undefined => {
  if (recordedTaskAttemptPlanFor(records, request.subject.plannedAttempt) === undefined) return "AttemptNotPlanned"
  if (
    records.some(
      ({ event }) =>
        event._tag === "PlannedAttemptReplaced" &&
        plannedTaskAttemptEquivalence(event.subject.plannedAttempt, request.subject.plannedAttempt)
    )
  ) {
    return "AttemptSuperseded"
  }
  if (
    request.choice === "ContinueExistingAttempt" &&
    records.some(
      ({ event }) =>
        event._tag === "AttemptChoiceApplied" &&
        (event.choice === "RestartTaskImplementation" || event.choice === "StopTaskImplementation") &&
        plannedTaskAttemptEquivalence(event.subject.plannedAttempt, request.subject.plannedAttempt)
    )
  ) {
    return "TerminalChoiceAlreadyApplied"
  }
  if (currentUnconsumedAcceptedSafeEvidence(records, request.subject.plannedAttempt) === undefined) {
    return "ExecutorNotSafelySuspended"
  }
  const latestSpecification = records.findLast(
    ({ event }) =>
      event._tag === "TaskTrackerFactsObserved" &&
      event.observation._tag === "FocusedTaskWorkSpecificationFacts" &&
      event.observation.factFamily.taskId === request.subject.plannedAttempt.taskId &&
      taskTrackerTargetKey(event.observation.target) === taskTrackerTargetKey(immutableRunTarget)
  )?.event
  return latestSpecificationMatches(latestSpecification, request) ? undefined : "ObservedFingerprintNotCurrent"
}

const latestSpecificationMatches = (
  latestSpecification: JournalRecord["event"] | undefined,
  request: ApplyAttemptChoiceRequest
): boolean =>
  latestSpecification?._tag === "TaskTrackerFactsObserved" &&
  latestSpecification.observation._tag === "FocusedTaskWorkSpecificationFacts" &&
  latestSpecification.observation.factFamily.fingerprint === request.subject.observedTaskRevision

const redeliveryMatchesRequest = (
  redelivered: Extract<JournalRecord["event"], { readonly _tag: "AttemptChoiceApplied" }>,
  request: ApplyAttemptChoiceRequest
): boolean => redelivered.choice === request.choice && sameAttemptChoiceSubject(redelivered.subject, request.subject)

const integrationStartedFor = (records: ReadonlyArray<JournalRecord>, request: ApplyAttemptChoiceRequest): boolean =>
  records.some(
    ({ event }) =>
      event._tag === "IntegrationStarted" &&
      event.plannedAttempt.attemptId === request.subject.plannedAttempt.attemptId &&
      event.plannedAttempt.runId === request.subject.plannedAttempt.runId
  )

const choicePreconditionError = (
  records: ReadonlyArray<JournalRecord>,
  request: ApplyAttemptChoiceRequest,
  immutableRunTarget: NonNullable<ReturnType<typeof exactWorkflowRunTargetFor>>
): AttemptChoiceOutsidePreIntegrationPhase | AttemptChoiceAlreadyApplied | AttemptChoiceNotAvailable | undefined => {
  const runId = request.subject.plannedAttempt.runId
  if (integrationStartedFor(records, request)) {
    return new AttemptChoiceOutsidePreIntegrationPhase({ requestId: request.requestId, runId })
  }
  const existingChoice = matchingChoice(records, request.subject)
  if (existingChoice?.event._tag === "AttemptChoiceApplied") {
    return new AttemptChoiceAlreadyApplied({
      existingPosition: existingChoice.position,
      requestId: request.requestId,
      runId,
      winningRequestId: existingChoice.event.requestId
    })
  }
  const unavailable = choiceIsExposed(records, request, immutableRunTarget)
  return unavailable === undefined
    ? undefined
    : new AttemptChoiceNotAvailable({ reason: unavailable, requestId: request.requestId, runId })
}

const attemptChoiceControlFromProtocolLayer = Layer.effect(
  AttemptChoiceControl,
  Effect.gen(function* () {
    const journal = yield* InRunJournal
    const protocolController = yield* PlannedAttemptProtocolController
    const applications = yield* Semaphore.make(1)
    const applyUnserialized = Effect.fn("AttemptChoiceControl.apply")(function* (input: unknown) {
      const request = yield* Schema.decodeUnknownEffect(ApplyAttemptChoiceRequest, { onExcessProperty: "error" })(input)
      const runId = request.subject.plannedAttempt.runId
      if (request.requestId.runId !== runId) {
        return yield* new AttemptChoiceRequestRunMismatch({
          boundRunId: request.requestId.runId,
          requestId: request.requestId,
          subjectRunId: runId
        })
      }
      const withChoicePermit =
        request.choice === "ContinueExistingAttempt"
          ? protocolController.withPermit
          : protocolController.withTerminalPermit
      return yield* withChoicePermit(plannedAttemptExecutorCorrelation(request.subject.plannedAttempt), () =>
        Effect.gen(function* () {
          const records = yield* journal.read(runId)
          const immutableRunTarget = exactWorkflowRunTargetFor(records)
          if (immutableRunTarget === undefined) {
            return yield* new WorkflowRunNotBegan({ runId })
          }
          const redelivered = records.find(
            ({ event }) =>
              event._tag === "AttemptChoiceApplied" && sameAttemptChoiceRequestId(event.requestId, request.requestId)
          )
          if (redelivered?.event._tag === "AttemptChoiceApplied") {
            if (redeliveryMatchesRequest(redelivered.event, request)) {
              return resultFor(records, redelivered, redelivered.event, immutableRunTarget)
            }
            return yield* new AttemptChoiceRequestIdentityContradiction({
              existingPosition: redelivered.position,
              requestId: request.requestId,
              runId
            })
          }
          const preconditionError = choicePreconditionError(records, request, immutableRunTarget)
          if (preconditionError !== undefined) return yield* preconditionError
          const event = AttemptChoiceAppliedEvent.make({
            choice: request.choice,
            initiatedBy: { _tag: "Operator" },
            occurrenceClassification: "InitiatedAction",
            requestId: request.requestId,
            subject: request.subject,
            version: workflowJournalEventVersion
          })
          const application = yield* journal.append(runId, attemptChoiceAppliedRecordKey(request.requestId), event)
          return resultFor([...records, application], application, event, immutableRunTarget)
        })
      )
    })
    const read = Effect.fn("AttemptChoiceControl.read")(function* (input: unknown) {
      const requestId = yield* Schema.decodeUnknownEffect(AttemptChoiceRequestId, { onExcessProperty: "error" })(input)
      const records = yield* journal.read(requestId.runId)
      const application = records.find(
        ({ event }) => event._tag === "AttemptChoiceApplied" && sameAttemptChoiceRequestId(event.requestId, requestId)
      )
      if (application?.event._tag !== "AttemptChoiceApplied") {
        return yield* new AttemptChoiceResultNotFound({ requestId })
      }
      const immutableRunTarget = exactWorkflowRunTargetFor(records)
      if (immutableRunTarget === undefined) {
        return yield* new WorkflowRunNotBegan({ runId: requestId.runId })
      }
      return resultFor(records, application, application.event, immutableRunTarget)
    })
    return AttemptChoiceControl.of({
      apply: (input) => applications.withPermit(applyUnserialized(input)),
      read: (input) => applications.withPermit(read(input))
    })
  })
)

/** One process-local exact-attempt guard shared by Operator choices and executor commands. */
export const attemptChoiceControlLayer = attemptChoiceControlFromProtocolLayer.pipe(
  Layer.provideMerge(plannedAttemptProtocolControllerLayer)
)
