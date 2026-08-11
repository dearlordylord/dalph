import { plannedAttemptExecutorCorrelation, type PlannedTaskAttempt } from "@dalph/contracts"
import { Effect, Match, Schema } from "effect"
import { isExactTaskClaim, TaskClaimObservation } from "../../../authorities/task-tracker/claim-mutation.js"
import { authorizedClaimForAttempt } from "../../claim-authority-history.js"
import { OperationId } from "../../identity.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  attemptImplementationAbandonedRecordKey,
  attemptStoppageIntentRecordKey,
  stoppedAttemptClaimNoReleaseRecordKey
} from "../../../workflow-journal/record-key.js"
import { InRunJournal, type JournalRecord } from "../../../workflow-journal/store.js"
import {
  latestPlannedAttemptExecutorEvidence,
  type PlannedAttemptExecutorEvidence
} from "../planned-attempt-executor-work/evidence.js"
import {
  observePlannedAttemptExecutorStateWithPermit,
  requestPlannedAttemptExecutorSuspensionWithPermit
} from "../planned-attempt-executor-work/protocol.js"
import {
  PlannedAttemptProtocolController,
  type PlannedAttemptProtocolPermit,
  withPlannedAttemptProtocolPermit
} from "../planned-attempt-executor-work/protocol-controller.js"
import {
  AttemptChoiceRequestId,
  AttemptChoiceSubject,
  AttemptImplementationAbandonedEvent,
  AttemptQuiescenceProof,
  AttemptStoppageIntendedEvent,
  sameAttemptChoiceRequestId,
  sameAttemptChoiceSubject,
  StoppedAttemptClaimNoReleaseObservedEvent
} from "./events.js"

/** Stop cannot advance because its exact applied operator choice is absent or contradictory. */
export class AttemptStopChoiceContradiction extends Schema.TaggedError<AttemptStopChoiceContradiction>()(
  "AttemptStopChoiceContradiction",
  { requestId: AttemptChoiceRequestId, subject: AttemptChoiceSubject }
) {}

/** Stop cannot abandon responsibility without the exact claim that authorized the immutable attempt. */
export class AttemptStopClaimAuthorityMissing extends Schema.TaggedError<AttemptStopClaimAuthorityMissing>()(
  "AttemptStopClaimAuthorityMissing",
  { requestId: AttemptChoiceRequestId, subject: AttemptChoiceSubject }
) {}

/** A no-release result contradicted the exact stopped-attempt claim or its focused tracker read. */
export class StoppedAttemptClaimObservationContradiction extends Schema.TaggedError<StoppedAttemptClaimObservationContradiction>()(
  "StoppedAttemptClaimObservationContradiction",
  {
    observation: TaskClaimObservation,
    observationOperationId: OperationId,
    requestId: AttemptChoiceRequestId,
    subject: AttemptChoiceSubject
  }
) {}

/** No journaled focused claim observation owns the requested no-release conclusion. */
export class StoppedAttemptClaimObservationMissing extends Schema.TaggedError<StoppedAttemptClaimObservationMissing>()(
  "StoppedAttemptClaimObservationMissing",
  { observationOperationId: OperationId, requestId: AttemptChoiceRequestId, subject: AttemptChoiceSubject }
) {}

export type AttemptStoppageAdvanceResult =
  | { readonly _tag: "AttemptImplementationAbandoned" }
  | { readonly _tag: "AttemptStoppagePending"; readonly executorState: "Running" }

const exactAppliedStop = (
  records: ReadonlyArray<JournalRecord>,
  requestId: AttemptChoiceRequestId,
  subject: AttemptChoiceSubject
) =>
  records.find(
    ({ event }) =>
      event._tag === "AttemptChoiceApplied" &&
      event.choice === "StopTaskImplementation" &&
      sameAttemptChoiceRequestId(event.requestId, requestId) &&
      sameAttemptChoiceSubject(event.subject, subject)
  )

type AttemptAbandonmentRecord = Omit<JournalRecord, "event"> & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "AttemptImplementationAbandoned" }>
}

const exactAbandonment = (
  records: ReadonlyArray<JournalRecord>,
  requestId: AttemptChoiceRequestId,
  subject: AttemptChoiceSubject
) =>
  records.find(
    (record): record is AttemptAbandonmentRecord =>
      record.event._tag === "AttemptImplementationAbandoned" &&
      sameAttemptChoiceRequestId(record.event.requestId, requestId) &&
      sameAttemptChoiceSubject(record.event.subject, subject)
  )

const evidenceProof = (evidence: PlannedAttemptExecutorEvidence): AttemptQuiescenceProof =>
  Match.valueTags(evidence.source, {
    CommandResponse: ({ ordinal }) => AttemptQuiescenceProof.cases.CommandResponse.make({ reportOrdinal: ordinal }),
    CommandProjection: ({ commandOrdinal, projectionOrdinal }) =>
      AttemptQuiescenceProof.cases.CommandProjection.make({ commandOrdinal, projectionOrdinal }),
    StateProjection: ({ ordinal }) => AttemptQuiescenceProof.cases.StateProjection.make({ observationOrdinal: ordinal })
  })

const unbrokenQuiescenceEvidence = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt
): PlannedAttemptExecutorEvidence | undefined => {
  const evidence = latestPlannedAttemptExecutorEvidence(records, plannedAttempt)
  if (evidence === undefined || (evidence.report._tag !== "SafelySuspended" && evidence.report._tag !== "Terminal")) {
    return undefined
  }
  const laterCommandExists = records.some(
    ({ event, position }) =>
      position > evidence.observedAt &&
      event._tag === "PlannedAttemptExecutorCommandIntended" &&
      event.plannedAttempt.runId === plannedAttempt.runId &&
      event.plannedAttempt.attemptId === plannedAttempt.attemptId
  )
  return laterCommandExists ? undefined : evidence
}

const recordAbandonment = Effect.fn("AttemptStop.recordAbandonment")(function* (
  requestId: AttemptChoiceRequestId,
  subject: AttemptChoiceSubject,
  evidence: PlannedAttemptExecutorEvidence
) {
  const journal = yield* InRunJournal
  const records = yield* journal.read(subject.plannedAttempt.runId)
  if (exactAbandonment(records, requestId, subject) !== undefined) return
  const expectedClaim = authorizedClaimForAttempt(records, subject.plannedAttempt)?.claim
  if (expectedClaim === undefined) return yield* new AttemptStopClaimAuthorityMissing({ requestId, subject })
  yield* journal.append(
    subject.plannedAttempt.runId,
    attemptImplementationAbandonedRecordKey(requestId),
    AttemptImplementationAbandonedEvent.make({
      expectedClaim,
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      proof: evidenceProof(evidence),
      requestId,
      subject,
      version: workflowJournalEventVersion
    })
  )
})

/** Advances at most one executor suspension or reconciliation call for one applied Stop. */
const advanceAttemptStoppageUnserialized = Effect.fn("AttemptStop.advanceStoppageUnserialized")(function* (
  requestId: AttemptChoiceRequestId,
  subject: AttemptChoiceSubject,
  permit: PlannedAttemptProtocolPermit
) {
  const journal = yield* InRunJournal
  const records = yield* journal.read(subject.plannedAttempt.runId)
  if (exactAppliedStop(records, requestId, subject) === undefined) {
    return yield* new AttemptStopChoiceContradiction({ requestId, subject })
  }
  if (exactAbandonment(records, requestId, subject) !== undefined) {
    return { _tag: "AttemptImplementationAbandoned" }
  }
  const retainedProof = unbrokenQuiescenceEvidence(records, subject.plannedAttempt)
  if (retainedProof !== undefined) {
    yield* recordAbandonment(requestId, subject, retainedProof)
    return { _tag: "AttemptImplementationAbandoned" }
  }
  if (
    !records.some(
      ({ event }) =>
        event._tag === "AttemptStoppageIntended" &&
        sameAttemptChoiceRequestId(event.requestId, requestId) &&
        sameAttemptChoiceSubject(event.subject, subject)
    )
  ) {
    yield* journal.append(
      subject.plannedAttempt.runId,
      attemptStoppageIntentRecordKey(requestId),
      AttemptStoppageIntendedEvent.make({
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        requestId,
        subject,
        version: workflowJournalEventVersion
      })
    )
  }
  const report = yield* requestPlannedAttemptExecutorSuspensionWithPermit(permit, subject.plannedAttempt)
  if (report._tag === "Running") return { _tag: "AttemptStoppagePending", executorState: "Running" }
  const currentRecords = yield* journal.read(subject.plannedAttempt.runId)
  const proof = unbrokenQuiescenceEvidence(currentRecords, subject.plannedAttempt)
  /* v8 ignore start -- a non-Running command result is returned only after the same protocol appends its exact safe or terminal report. */
  if (proof === undefined) return yield* new AttemptStopChoiceContradiction({ requestId, subject })
  /* v8 ignore stop */
  yield* recordAbandonment(requestId, subject, proof)
  return { _tag: "AttemptImplementationAbandoned" }
})

export const advanceAttemptStoppageWithPermit = (
  permit: PlannedAttemptProtocolPermit,
  requestId: AttemptChoiceRequestId,
  subject: AttemptChoiceSubject
) =>
  withPlannedAttemptProtocolPermit(
    permit,
    plannedAttemptExecutorCorrelation(subject.plannedAttempt),
    advanceAttemptStoppageUnserialized(requestId, subject, permit)
  )

export const advanceAttemptStoppage = Effect.fn("AttemptStop.advanceStoppage")(function* (
  requestId: AttemptChoiceRequestId,
  subject: AttemptChoiceSubject
) {
  const controller = yield* PlannedAttemptProtocolController
  return yield* controller.withPermit(plannedAttemptExecutorCorrelation(subject.plannedAttempt), (permit) =>
    advanceAttemptStoppageUnserialized(requestId, subject, permit)
  )
})

/** Rechecks executor authority without issuing a fourth or duplicate suspension command. */
const observeAttemptStoppageExecutorUnserialized = Effect.fn("AttemptStop.observeExecutorUnserialized")(function* (
  requestId: AttemptChoiceRequestId,
  subject: AttemptChoiceSubject,
  permit: PlannedAttemptProtocolPermit
) {
  const journal = yield* InRunJournal
  const records = yield* journal.read(subject.plannedAttempt.runId)
  if (exactAppliedStop(records, requestId, subject) === undefined) {
    return yield* new AttemptStopChoiceContradiction({ requestId, subject })
  }
  if (exactAbandonment(records, requestId, subject) !== undefined) {
    return { _tag: "AttemptImplementationAbandoned" } as const
  }
  const report = yield* observePlannedAttemptExecutorStateWithPermit(permit, subject.plannedAttempt)
  if (report._tag === "Running") {
    return { _tag: "AttemptStoppagePending", executorState: "Running" } as const
  }
  const currentRecords = yield* journal.read(subject.plannedAttempt.runId)
  const proof = unbrokenQuiescenceEvidence(currentRecords, subject.plannedAttempt)
  /* v8 ignore start -- a non-Running state observation is returned only after the same protocol appends its exact safe or terminal projection. */
  if (proof === undefined) return yield* new AttemptStopChoiceContradiction({ requestId, subject })
  /* v8 ignore stop */
  yield* recordAbandonment(requestId, subject, proof)
  return { _tag: "AttemptImplementationAbandoned" } as const
})

export const observeAttemptStoppageExecutorWithPermit = (
  permit: PlannedAttemptProtocolPermit,
  requestId: AttemptChoiceRequestId,
  subject: AttemptChoiceSubject
) =>
  withPlannedAttemptProtocolPermit(
    permit,
    plannedAttemptExecutorCorrelation(subject.plannedAttempt),
    observeAttemptStoppageExecutorUnserialized(requestId, subject, permit)
  )

export const observeAttemptStoppageExecutor = Effect.fn("AttemptStop.observeExecutor")(function* (
  requestId: AttemptChoiceRequestId,
  subject: AttemptChoiceSubject
) {
  const controller = yield* PlannedAttemptProtocolController
  return yield* controller.withPermit(plannedAttemptExecutorCorrelation(subject.plannedAttempt), (permit) =>
    observeAttemptStoppageExecutorUnserialized(requestId, subject, permit)
  )
})

type FocusedClaimObservationRecord = Omit<JournalRecord, "event"> & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "TaskTrackerFactsObserved" }> & {
    readonly observation: Extract<
      Extract<JournalRecord["event"], { readonly _tag: "TaskTrackerFactsObserved" }>["observation"],
      { readonly _tag: "FocusedTaskClaimFacts" }
    >
  }
}

const latestStoppedReleaseIntent = (
  records: ReadonlyArray<JournalRecord>,
  abandonmentPosition: JournalRecord["position"],
  requestId: AttemptChoiceRequestId
) =>
  records.findLast(
    ({ event, position }) =>
      position > abandonmentPosition &&
      event._tag === "TaskClaimReleaseIntended" &&
      event.operation.authority._tag === "StoppedAttemptClaimReleaseAuthority" &&
      sameAttemptChoiceRequestId(event.operation.authority.requestId, requestId)
  )

const latestFocusedClaimObservation = (
  records: ReadonlyArray<JournalRecord>,
  observationBaseline: JournalRecord["position"],
  subject: AttemptChoiceSubject
) =>
  records.findLast(
    (record): record is FocusedClaimObservationRecord =>
      record.position > observationBaseline &&
      record.event._tag === "TaskTrackerFactsObserved" &&
      record.event.observation._tag === "FocusedTaskClaimFacts" &&
      record.event.observation.coverage.taskId === subject.plannedAttempt.taskId
  )

const focusedClaimReadIntent = (
  records: ReadonlyArray<JournalRecord>,
  observationBaseline: JournalRecord["position"],
  observationRecord: FocusedClaimObservationRecord,
  subject: AttemptChoiceSubject
) =>
  records.find(
    ({ event, position }) =>
      position > observationBaseline &&
      position < observationRecord.position &&
      event._tag === "TaskTrackerReadIntentRecorded" &&
      event.operation._tag === "ReadTaskClaim" &&
      event.operation.operationId === observationRecord.event.operationId &&
      event.operation.taskId === subject.plannedAttempt.taskId
  )

const noReleaseObservationContradicts = (
  observationRecord: FocusedClaimObservationRecord,
  observationIntent: JournalRecord | undefined,
  observationOperationId: OperationId,
  subject: AttemptChoiceSubject,
  expectedClaim: Extract<JournalRecord["event"], { readonly _tag: "AttemptImplementationAbandoned" }>["expectedClaim"]
): boolean => {
  const observation = observationRecord.event.observation.observation
  return (
    observationRecord.event.operationId !== observationOperationId ||
    observationIntent?.event._tag !== "TaskTrackerReadIntentRecorded" ||
    observation.taskId !== subject.plannedAttempt.taskId ||
    (observation._tag === "ActiveTaskClaim" && isExactTaskClaim(observation, expectedClaim))
  )
}

/** Records why a stopped attempt left an absent or foreign current tracker claim unchanged. */
export const recordStoppedAttemptClaimNoRelease = Effect.fn("AttemptStop.recordClaimNoRelease")(function* (
  requestId: AttemptChoiceRequestId,
  subject: AttemptChoiceSubject,
  observationOperationId: OperationId
) {
  const journal = yield* InRunJournal
  const records = yield* journal.read(subject.plannedAttempt.runId)
  const abandonmentRecord = exactAbandonment(records, requestId, subject)
  if (abandonmentRecord === undefined) {
    return yield* new AttemptStopChoiceContradiction({ requestId, subject })
  }
  const abandonment = abandonmentRecord.event
  const abandonmentPosition = abandonmentRecord.position
  const latestReleaseIntent = latestStoppedReleaseIntent(records, abandonmentPosition, requestId)
  const observationBaseline = latestReleaseIntent?.position ?? abandonmentPosition
  const observationRecord = latestFocusedClaimObservation(records, observationBaseline, subject)
  if (observationRecord === undefined) {
    return yield* new StoppedAttemptClaimObservationMissing({ observationOperationId, requestId, subject })
  }
  const observationEvent = observationRecord.event
  const observation = observationEvent.observation.observation
  const observationIntent = focusedClaimReadIntent(records, observationBaseline, observationRecord, subject)
  if (
    noReleaseObservationContradicts(
      observationRecord,
      observationIntent,
      observationOperationId,
      subject,
      abandonment.expectedClaim
    )
  ) {
    return yield* new StoppedAttemptClaimObservationContradiction({
      observation,
      observationOperationId,
      requestId,
      subject
    })
  }
  yield* journal.append(
    subject.plannedAttempt.runId,
    stoppedAttemptClaimNoReleaseRecordKey(requestId),
    StoppedAttemptClaimNoReleaseObservedEvent.make({
      expectedClaim: abandonment.expectedClaim,
      observation,
      observationOperationId,
      occurrenceClassification: "NonActionOccurrence",
      requestId,
      subject,
      version: workflowJournalEventVersion
    })
  )
})
