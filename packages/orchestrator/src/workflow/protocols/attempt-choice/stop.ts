import { type PlannedTaskAttempt } from "@dalph/contracts"
import { Effect, Schema } from "effect"
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
  observePlannedAttemptExecutorState,
  requestPlannedAttemptExecutorSuspension
} from "../planned-attempt-executor-work/protocol.js"
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
export class AttemptStopChoiceContradiction extends Schema.TaggedErrorClass<AttemptStopChoiceContradiction>()(
  "AttemptStopChoiceContradiction",
  { requestId: AttemptChoiceRequestId, subject: AttemptChoiceSubject }
) {}

/** Stop cannot abandon responsibility without the exact claim that authorized the immutable attempt. */
export class AttemptStopClaimAuthorityMissing extends Schema.TaggedErrorClass<AttemptStopClaimAuthorityMissing>()(
  "AttemptStopClaimAuthorityMissing",
  { requestId: AttemptChoiceRequestId, subject: AttemptChoiceSubject }
) {}

/** A no-release result contradicted the exact stopped-attempt claim or its focused tracker read. */
export class StoppedAttemptClaimObservationContradiction extends Schema.TaggedErrorClass<StoppedAttemptClaimObservationContradiction>()(
  "StoppedAttemptClaimObservationContradiction",
  {
    observation: TaskClaimObservation,
    observationOperationId: OperationId,
    requestId: AttemptChoiceRequestId,
    subject: AttemptChoiceSubject
  }
) {}

/** No journaled focused claim observation owns the requested no-release conclusion. */
export class StoppedAttemptClaimObservationMissing extends Schema.TaggedErrorClass<StoppedAttemptClaimObservationMissing>()(
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

const exactAbandonment = (
  records: ReadonlyArray<JournalRecord>,
  requestId: AttemptChoiceRequestId,
  subject: AttemptChoiceSubject
) =>
  records.find(
    ({ event }) =>
      event._tag === "AttemptImplementationAbandoned" &&
      sameAttemptChoiceRequestId(event.requestId, requestId) &&
      sameAttemptChoiceSubject(event.subject, subject)
  )

const evidenceProof = (evidence: PlannedAttemptExecutorEvidence): AttemptQuiescenceProof => {
  switch (evidence.source._tag) {
    case "CommandResponse":
      return AttemptQuiescenceProof.cases.CommandResponse.make({ reportOrdinal: evidence.source.ordinal })
    case "CommandProjection":
      return AttemptQuiescenceProof.cases.CommandProjection.make({
        commandOrdinal: evidence.source.commandOrdinal,
        projectionOrdinal: evidence.source.projectionOrdinal
      })
    case "StateProjection":
      return AttemptQuiescenceProof.cases.StateProjection.make({ observationOrdinal: evidence.source.ordinal })
  }
}

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
export const advanceAttemptStoppage = Effect.fn("AttemptStop.advanceStoppage")(function* (
  requestId: AttemptChoiceRequestId,
  subject: AttemptChoiceSubject
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
  const report = yield* requestPlannedAttemptExecutorSuspension(subject.plannedAttempt)
  if (report._tag === "Running") return { _tag: "AttemptStoppagePending", executorState: "Running" }
  const currentRecords = yield* journal.read(subject.plannedAttempt.runId)
  const proof = unbrokenQuiescenceEvidence(currentRecords, subject.plannedAttempt)
  if (proof === undefined) return yield* new AttemptStopChoiceContradiction({ requestId, subject })
  yield* recordAbandonment(requestId, subject, proof)
  return { _tag: "AttemptImplementationAbandoned" }
})

/** Rechecks executor authority without issuing a fourth or duplicate suspension command. */
export const observeAttemptStoppageExecutor = Effect.fn("AttemptStop.observeExecutor")(function* (
  requestId: AttemptChoiceRequestId,
  subject: AttemptChoiceSubject
) {
  const journal = yield* InRunJournal
  const records = yield* journal.read(subject.plannedAttempt.runId)
  if (exactAppliedStop(records, requestId, subject) === undefined) {
    return yield* new AttemptStopChoiceContradiction({ requestId, subject })
  }
  if (exactAbandonment(records, requestId, subject) !== undefined) {
    return { _tag: "AttemptImplementationAbandoned" } as const
  }
  const report = yield* observePlannedAttemptExecutorState(subject.plannedAttempt)
  if (report._tag === "Running") {
    return { _tag: "AttemptStoppagePending", executorState: "Running" } as const
  }
  const currentRecords = yield* journal.read(subject.plannedAttempt.runId)
  const proof = unbrokenQuiescenceEvidence(currentRecords, subject.plannedAttempt)
  if (proof === undefined) return yield* new AttemptStopChoiceContradiction({ requestId, subject })
  yield* recordAbandonment(requestId, subject, proof)
  return { _tag: "AttemptImplementationAbandoned" } as const
})

/** Records why a stopped attempt left an absent or foreign current tracker claim unchanged. */
export const recordStoppedAttemptClaimNoRelease = Effect.fn("AttemptStop.recordClaimNoRelease")(function* (
  requestId: AttemptChoiceRequestId,
  subject: AttemptChoiceSubject,
  observationOperationId: OperationId
) {
  const journal = yield* InRunJournal
  const records = yield* journal.read(subject.plannedAttempt.runId)
  const abandonmentRecord = exactAbandonment(records, requestId, subject)
  const abandonment = abandonmentRecord?.event
  if (abandonmentRecord === undefined || abandonment?._tag !== "AttemptImplementationAbandoned") {
    return yield* new AttemptStopChoiceContradiction({ requestId, subject })
  }
  const abandonmentPosition = abandonmentRecord.position
  const observationRecord = records.findLast(
    ({ event, position }) =>
      position > abandonmentPosition &&
      event._tag === "TaskTrackerFactsObserved" &&
      event.operationId === observationOperationId &&
      event.observation._tag === "FocusedTaskClaimFacts" &&
      event.observation.coverage.taskId === subject.plannedAttempt.taskId
  )
  if (
    observationRecord?.event._tag !== "TaskTrackerFactsObserved" ||
    observationRecord.event.observation._tag !== "FocusedTaskClaimFacts"
  ) {
    return yield* new StoppedAttemptClaimObservationMissing({ observationOperationId, requestId, subject })
  }
  const observation = observationRecord.event.observation.observation
  const observationIsForTask = observation.taskId === subject.plannedAttempt.taskId
  if (
    !observationIsForTask ||
    (observation._tag === "ActiveTaskClaim" && isExactTaskClaim(observation, abandonment.expectedClaim))
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
