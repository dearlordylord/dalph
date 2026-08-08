import { plannedTaskAttemptEquivalence, type PlannedTaskAttempt } from "@dalph/contracts"
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
import { requestPlannedAttemptExecutorSuspension } from "../planned-attempt-executor-work/protocol.js"
import {
  AttemptChoiceRequestId,
  AttemptChoiceSubject,
  AttemptImplementationAbandonedEvent,
  AttemptQuiescenceProof,
  AttemptStoppageIntendedEvent,
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

export type AttemptStoppageAdvanceResult =
  | { readonly _tag: "AttemptImplementationAbandoned" }
  | { readonly _tag: "AttemptStoppagePending"; readonly executorState: "Running" }

const sameSubject = (left: AttemptChoiceSubject, right: AttemptChoiceSubject): boolean =>
  left.observedTaskRevision === right.observedTaskRevision &&
  plannedTaskAttemptEquivalence(left.plannedAttempt, right.plannedAttempt)

const exactAppliedStop = (
  records: ReadonlyArray<JournalRecord>,
  requestId: AttemptChoiceRequestId,
  subject: AttemptChoiceSubject
) =>
  records.find(
    ({ event }) =>
      event._tag === "AttemptChoiceApplied" &&
      event.choice === "StopTaskImplementation" &&
      event.requestId.nonce === requestId.nonce &&
      event.requestId.runId === requestId.runId &&
      sameSubject(event.subject, subject)
  )

const exactAbandonment = (
  records: ReadonlyArray<JournalRecord>,
  requestId: AttemptChoiceRequestId,
  subject: AttemptChoiceSubject
) =>
  records.find(
    ({ event }) =>
      event._tag === "AttemptImplementationAbandoned" &&
      event.requestId.nonce === requestId.nonce &&
      event.requestId.runId === requestId.runId &&
      sameSubject(event.subject, subject)
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
        event.requestId.nonce === requestId.nonce &&
        event.requestId.runId === requestId.runId &&
        sameSubject(event.subject, subject)
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

/** Records why a stopped attempt left an absent or foreign current tracker claim unchanged. */
export const recordStoppedAttemptClaimNoRelease = Effect.fn("AttemptStop.recordClaimNoRelease")(function* (
  requestId: AttemptChoiceRequestId,
  subject: AttemptChoiceSubject,
  observationOperationId: OperationId,
  observation: TaskClaimObservation
) {
  const journal = yield* InRunJournal
  const records = yield* journal.read(subject.plannedAttempt.runId)
  const abandonment = exactAbandonment(records, requestId, subject)?.event
  if (abandonment?._tag !== "AttemptImplementationAbandoned") {
    return yield* new AttemptStopChoiceContradiction({ requestId, subject })
  }
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
