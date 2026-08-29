import { plannedAttemptExecutorCorrelation, type PlannedTaskAttempt } from "@dalph/contracts"
import { Effect, Schema } from "effect"
import { isExactTaskClaim, TaskClaimObservation } from "../../../authorities/task-tracker/claim-mutation.js"
import { authorizedClaimForAttempt } from "../../claim-authority-history.js"
import { OperationId } from "../../identity.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  attemptImplementationAbandonedRecordKey,
  stoppedAttemptClaimNoReleaseRecordKey
} from "../../../workflow-journal/record-key.js"
import { InRunJournal, type JournalRecord } from "../../../workflow-journal/store.js"
import { claimReadMatchesTarget, exactWorkflowRunTargetFor } from "../../../workflow-journal/run-target.js"
import { taskTrackerTargetKey, type TrackerTarget } from "../../../authorities/task-tracker/target.js"
import {
  latestPlannedAttemptExecutorEvidence,
  isAcceptedPlannedAttemptExecutorEvidence,
  type AcceptedPlannedAttemptExecutorEvidence
} from "../planned-attempt-executor-work/evidence.js"
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
  | { readonly _tag: "AttemptStoppageAwaitingLifecycleAcceptance" }
  | { readonly _tag: "AttemptStoppageChoiceInvalidated"; readonly reason: "ExecutingAccepted" | "LaterCommandRecorded" }
  | { readonly _tag: "AttemptStoppageSupersededByTerminal" }

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

const evidenceProof = (evidence: AcceptedPlannedAttemptExecutorEvidence): AttemptQuiescenceProof =>
  AttemptQuiescenceProof.cases.AcceptedReport.make({ reportOrdinal: evidence.source.ordinal })

const unbrokenQuiescenceEvidence = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt
): AcceptedPlannedAttemptExecutorEvidence | undefined => {
  const evidence = latestPlannedAttemptExecutorEvidence(records, plannedAttempt)
  if (
    evidence === undefined ||
    !isAcceptedPlannedAttemptExecutorEvidence(evidence) ||
    evidence.report._tag !== "ExecutorWorkSafelySuspended"
  ) {
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
  evidence: AcceptedPlannedAttemptExecutorEvidence
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

type AttemptStoppageEvidenceDisposition =
  | { readonly _tag: "AwaitingLifecycleAcceptance" }
  | { readonly _tag: "ExecutingAccepted" }
  | { readonly _tag: "Safe"; readonly evidence: AcceptedPlannedAttemptExecutorEvidence }
  | { readonly _tag: "SupersededByTerminal" }
  | { readonly _tag: "LaterCommandRecorded" }

const attemptStoppageEvidenceDisposition = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt
): AttemptStoppageEvidenceDisposition => {
  const latestEvidence = latestPlannedAttemptExecutorEvidence(records, plannedAttempt)
  if (latestEvidence !== undefined && !isAcceptedPlannedAttemptExecutorEvidence(latestEvidence)) {
    return { _tag: "AwaitingLifecycleAcceptance" }
  }
  if (latestEvidence?.report._tag === "ExecutorWorkTerminal") return { _tag: "SupersededByTerminal" }
  if (latestEvidence?.report._tag === "ExecutorWorkExecuting") return { _tag: "ExecutingAccepted" }
  const retainedProof = unbrokenQuiescenceEvidence(records, plannedAttempt)
  return retainedProof === undefined ? { _tag: "LaterCommandRecorded" } : { _tag: "Safe", evidence: retainedProof }
}

/** Applies Stop only when the latest accepted report is the same unbroken Safe evidence that exposed the choice. */
const advanceAttemptStoppageUnserialized = Effect.fn("AttemptStop.advanceStoppageUnserialized")(function* (
  requestId: AttemptChoiceRequestId,
  subject: AttemptChoiceSubject,
  _permit: PlannedAttemptProtocolPermit
) {
  const journal = yield* InRunJournal
  const records = yield* journal.read(subject.plannedAttempt.runId)
  if (exactAppliedStop(records, requestId, subject) === undefined) {
    return yield* new AttemptStopChoiceContradiction({ requestId, subject })
  }
  if (exactAbandonment(records, requestId, subject) !== undefined) {
    return { _tag: "AttemptImplementationAbandoned" }
  }
  const disposition = attemptStoppageEvidenceDisposition(records, subject.plannedAttempt)
  if (disposition._tag === "AwaitingLifecycleAcceptance") {
    return { _tag: "AttemptStoppageAwaitingLifecycleAcceptance" } as const
  }
  if (disposition._tag === "SupersededByTerminal") {
    return { _tag: "AttemptStoppageSupersededByTerminal" } as const
  }
  if (disposition._tag === "ExecutingAccepted") {
    return { _tag: "AttemptStoppageChoiceInvalidated", reason: "ExecutingAccepted" } as const
  }
  if (disposition._tag === "Safe") {
    yield* recordAbandonment(requestId, subject, disposition.evidence)
    return { _tag: "AttemptImplementationAbandoned" }
  }
  return { _tag: "AttemptStoppageChoiceInvalidated", reason: "LaterCommandRecorded" } as const
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

/** Rechecks accepted lifecycle authority without contacting the executor. */
const observeAttemptStoppageExecutorUnserialized = Effect.fn("AttemptStop.observeExecutorUnserialized")(function* (
  requestId: AttemptChoiceRequestId,
  subject: AttemptChoiceSubject,
  permit: PlannedAttemptProtocolPermit
) {
  return yield* advanceAttemptStoppageUnserialized(requestId, subject, permit)
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
      { readonly _tag: "FocusedTaskClaimFacts" | "FocusedTaskClaimFactsUnreadable" }
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
  subject: AttemptChoiceSubject,
  immutableRunTarget: TrackerTarget | undefined
) =>
  records.findLast(
    (record): record is FocusedClaimObservationRecord =>
      record.position > observationBaseline &&
      immutableRunTarget !== undefined &&
      record.event._tag === "TaskTrackerFactsObserved" &&
      (record.event.observation._tag === "FocusedTaskClaimFacts" ||
        record.event.observation._tag === "FocusedTaskClaimFactsUnreadable") &&
      record.event.observation.coverage.taskId === subject.plannedAttempt.taskId &&
      taskTrackerTargetKey(record.event.observation.target) === taskTrackerTargetKey(immutableRunTarget)
  )

const focusedClaimReadIntent = (
  records: ReadonlyArray<JournalRecord>,
  observationBaseline: JournalRecord["position"],
  observationRecord: FocusedClaimObservationRecord,
  subject: AttemptChoiceSubject,
  immutableRunTarget: TrackerTarget | undefined
) =>
  records.find(
    ({ event, position }) =>
      position > observationBaseline &&
      position < observationRecord.position &&
      event._tag === "TaskTrackerReadIntentRecorded" &&
      event.operation._tag === "ReadTaskClaim" &&
      event.operation.operationId === observationRecord.event.operationId &&
      event.operation.taskId === subject.plannedAttempt.taskId &&
      immutableRunTarget !== undefined &&
      taskTrackerTargetKey(event.operation.target) === taskTrackerTargetKey(immutableRunTarget)
  )

const noReleaseObservationContradicts = (
  observationRecord: FocusedClaimObservationRecord,
  observationIntent: JournalRecord | undefined,
  observationReadMatchesRunTarget: boolean,
  observationOperationId: OperationId,
  subject: AttemptChoiceSubject,
  expectedClaim: Extract<JournalRecord["event"], { readonly _tag: "AttemptImplementationAbandoned" }>["expectedClaim"]
): boolean => {
  if (observationRecord.event.observation._tag !== "FocusedTaskClaimFacts") return true
  const observation = observationRecord.event.observation.observation
  return (
    observationRecord.event.operationId !== observationOperationId ||
    observationIntent?.event._tag !== "TaskTrackerReadIntentRecorded" ||
    !observationReadMatchesRunTarget ||
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
  const immutableRunTarget = exactWorkflowRunTargetFor(records)
  const latestReleaseIntent = latestStoppedReleaseIntent(records, abandonmentPosition, requestId)
  const observationBaseline = latestReleaseIntent?.position ?? abandonmentPosition
  const observationRecord = latestFocusedClaimObservation(records, observationBaseline, subject, immutableRunTarget)
  if (observationRecord === undefined) {
    return yield* new StoppedAttemptClaimObservationMissing({ observationOperationId, requestId, subject })
  }
  if (observationRecord.event.observation._tag !== "FocusedTaskClaimFacts") {
    return yield* new StoppedAttemptClaimObservationMissing({ observationOperationId, requestId, subject })
  }
  const observation = observationRecord.event.observation.observation
  const observationIntent = focusedClaimReadIntent(
    records,
    observationBaseline,
    observationRecord,
    subject,
    immutableRunTarget
  )
  const observationReadMatchesRunTarget = claimReadMatchesTarget(
    records,
    observationOperationId,
    subject.plannedAttempt.taskId,
    observationBaseline,
    observationRecord.position,
    immutableRunTarget
  )
  if (
    noReleaseObservationContradicts(
      observationRecord,
      observationIntent,
      observationReadMatchesRunTarget,
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
