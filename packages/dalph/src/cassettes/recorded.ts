/* eslint-disable max-lines -- Projection, inverse fold, and presentation share one exhaustive cassette boundary. */
import { Effect, Schema } from "effect"
import {
  ControlDirectionAppliedEvent,
  describeJournalEvent,
  IntegrationResponsibilityBeganEvent,
  IntegrationStartedEvent,
  IntegrationCandidateAgentReportedEvent,
  IntegrationCandidateConstructedEvent,
  IntegrationCandidateConstructionIntendedEvent,
  IntegrationCandidateGitObservedEvent,
  IntegrationCandidateGitValidationFailedEvent,
  IntegrationCandidateCorrectionLimitReachedEvent,
  IntegrationCandidateContinuationLimitReachedEvent,
  integrationCandidateCorrelationEquals,
  JournalPosition,
  type JournalRecord,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent,
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  TaskClaimAcquisitionRejectedEvent,
  taskTrackerReadIntent,
  taskTrackerFactsObservedEvent,
  type WorkflowJournalEvent,
  WorkflowActor,
  workflowJournalEventVersion,
  reduceWorkflowJournalHistory,
  TaskClaimReacquisitionDirectedEvent
} from "@dalph/orchestrator"
import {
  type CassetteIdentityRenaming,
  RecordedCassette,
  type RecordedCassette as RecordedCassetteType,
  type RecordedCassetteEntry,
  recordedCassetteVersion
} from "./recorded-domain.js"
import { renameRecordedCassette } from "./recorded-renaming.js"
import { appliedOccurrencePosition, semanticJson, semanticState } from "./recorded-semantic-state.js"
import {
  eventForGitObservationEntry,
  isRecordedGitObservationEntry,
  lyricForGitObservationEntry,
  recordGitObservationEntry,
  type RecordedGitObservationEntry
} from "./recorded-git-observation-mapping.js"
import {
  eventForRunEntry,
  isJournalRunEntry,
  isRecordedRunEntry,
  lyricForRunEntry,
  recordedRunEntryFor,
  type RecordedRunEntry
} from "./recorded-run-mapping.js"
import {
  eventForClaimReleaseEntry,
  eventForWorktreeEntry,
  isRecordedClaimReleaseEntry,
  isRecordedWorktreeEntry,
  lyricForClaimReleaseEntry,
  lyricForWorktreeEntry,
  recordClaimReleaseEntry,
  recordWorktreeEntry
} from "./recorded-task-boundary-mapping.js"

const coordinator = () => WorkflowActor.cases.DalphCoordinator.make({})

const recordTrackerEntry = (
  event: Extract<WorkflowJournalEvent, { readonly _tag: "TaskTrackerFactsObserved" | "TaskTrackerReadIntentRecorded" }>
): RecordedCassetteEntry =>
  event._tag === "TaskTrackerReadIntentRecorded" ? trackerReadEntry(event) : trackerFactsEntry(event)

// Separate constructors keep the exhaustive journal mapping small.
const trackerReadEntry = (
  event: Extract<WorkflowJournalEvent, { readonly _tag: "TaskTrackerReadIntentRecorded" }>
): RecordedCassetteEntry => ({
  _tag: "TaskTrackerReadInitiated",
  initiatedBy: coordinator(),
  occurrenceClassification: "InitiatedAction",
  operation: event.operation
})

const trackerFactsEntry = (
  event: Extract<WorkflowJournalEvent, { readonly _tag: "TaskTrackerFactsObserved" }>
): RecordedCassetteEntry => ({
  _tag: "TaskTrackerFactsObserved",
  evidence: event.observation,
  occurrenceClassification: "NonActionOccurrence",
  originatingActionOperationId: event.operationId
})

const recordExecutorEntry = (
  event: Extract<
    WorkflowJournalEvent,
    { readonly _tag: "PlannedAttemptExecutorWorkReported" | "PlannedAttemptExecutorWorkResponsibilityBegan" }
  >
): RecordedCassetteEntry =>
  event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan"
    ? {
        _tag: "PlannedAttemptExecutorWorkResponsibilityBegan",
        initiatedBy: coordinator(),
        occurrenceClassification: "InitiatedAction",
        plannedAttempt: event.plannedAttempt
      }
    : {
        _tag: "PlannedAttemptExecutorWorkReported",
        occurrenceClassification: "NonActionOccurrence",
        ordinal: event.ordinal,
        report: event.report
      }

type RecordedIntegrationEntry = Extract<
  RecordedCassetteEntry,
  { readonly _tag: "IntegrationResponsibilityBegan" | "IntegrationStarted" }
>

const isRecordedIntegrationEntry = <Value extends { readonly _tag: string }>(
  value: Value
): value is Extract<Value, { readonly _tag: "IntegrationResponsibilityBegan" | "IntegrationStarted" }> =>
  value._tag === "IntegrationResponsibilityBegan" || value._tag === "IntegrationStarted"

const recordIntegrationEntry = (
  event: Extract<WorkflowJournalEvent, { readonly _tag: "IntegrationResponsibilityBegan" | "IntegrationStarted" }>
): RecordedIntegrationEntry => ({
  _tag: event._tag,
  acceptedResult: event.acceptedResult,
  initiatedBy: coordinator(),
  integrationTarget: event.integrationTarget,
  occurrenceClassification: "InitiatedAction",
  plannedAttempt: event.plannedAttempt
})

type CandidateConstructionEvent = Extract<
  WorkflowJournalEvent,
  {
    readonly _tag:
      | "IntegrationCandidateAgentReported"
      | "IntegrationCandidateConstructed"
      | "IntegrationCandidateConstructionIntended"
      | "IntegrationCandidateGitObserved"
      | "IntegrationCandidateGitValidationFailed"
      | "IntegrationCandidateCorrectionLimitReached"
      | "IntegrationCandidateContinuationLimitReached"
  }
>

type RecordedCandidateConstructionEntry = Extract<
  RecordedCassetteEntry,
  { readonly _tag: CandidateConstructionEvent["_tag"] }
>

const isCandidateConstructionEvent = (event: WorkflowJournalEvent): event is CandidateConstructionEvent =>
  event._tag === "IntegrationCandidateAgentReported" ||
  event._tag === "IntegrationCandidateConstructed" ||
  event._tag === "IntegrationCandidateConstructionIntended" ||
  event._tag === "IntegrationCandidateGitObserved" ||
  event._tag === "IntegrationCandidateGitValidationFailed" ||
  event._tag === "IntegrationCandidateCorrectionLimitReached" ||
  event._tag === "IntegrationCandidateContinuationLimitReached"

const isRecordedCandidateConstructionEntry = (
  entry: RecordedCassetteEntry
): entry is RecordedCandidateConstructionEntry =>
  new Set([
    "IntegrationCandidateAgentReported",
    "IntegrationCandidateConstructed",
    "IntegrationCandidateConstructionIntended",
    "IntegrationCandidateGitObserved",
    "IntegrationCandidateGitValidationFailed",
    "IntegrationCandidateCorrectionLimitReached",
    "IntegrationCandidateContinuationLimitReached"
  ]).has(entry._tag)

const recordCandidateConstructionEntry = (event: CandidateConstructionEvent): RecordedCandidateConstructionEntry => {
  switch (event._tag) {
    case "IntegrationCandidateConstructionIntended":
      return {
        _tag: event._tag,
        correlation: event.correlation,
        correctionLimit: event.correctionLimit,
        continuationLimit: event.continuationLimit,
        initiatedBy: coordinator(),
        occurrenceClassification: "InitiatedAction",
        plannedAttempt: event.plannedAttempt
      }
    case "IntegrationCandidateAgentReported":
      return {
        _tag: event._tag,
        expectedCorrelation: event.expectedCorrelation,
        occurrenceClassification: "NonActionOccurrence",
        ordinal: event.ordinal,
        report: event.report
      }
    case "IntegrationCandidateGitObserved":
      return {
        _tag: event._tag,
        candidateCommit: event.candidateCommit,
        correlation: event.correlation,
        observation: event.observation,
        occurrenceClassification: "NonActionOccurrence"
      }
    case "IntegrationCandidateConstructed":
      return {
        _tag: event._tag,
        candidateCommit: event.candidateCommit,
        correlation: event.correlation,
        occurrenceClassification: "NonActionOccurrence"
      }
    case "IntegrationCandidateGitValidationFailed":
      return {
        _tag: event._tag,
        attemptOrdinal: event.attemptOrdinal,
        candidateCommit: event.candidateCommit,
        correlation: event.correlation,
        detail: event.detail,
        occurrenceClassification: "NonActionOccurrence"
      }
    case "IntegrationCandidateCorrectionLimitReached":
      return {
        _tag: event._tag,
        correctionCount: event.correctionCount,
        correctionLimit: event.correctionLimit,
        correlation: event.correlation,
        occurrenceClassification: "NonActionOccurrence"
      }
    case "IntegrationCandidateContinuationLimitReached":
      return {
        _tag: event._tag,
        continuationCount: event.continuationCount,
        continuationLimit: event.continuationLimit,
        correlation: event.correlation,
        occurrenceClassification: "NonActionOccurrence"
      }
  }
}

const recordTaskBoundaryEntry = (
  event: Exclude<
    WorkflowJournalEvent,
    {
      readonly _tag:
        | "ControlDirectionApplied"
        | "TaskClaimReacquisitionDirected"
        | "GitReadIntentRecorded"
        | "PlannedAttemptWorktreeObserved"
        | "TargetLineageObserved"
        | "PlannedAttemptExecutorWorkReported"
        | "PlannedAttemptExecutorWorkResponsibilityBegan"
        | "IntegrationCandidateAgentReported"
        | "IntegrationCandidateConstructed"
        | "IntegrationCandidateConstructionIntended"
        | "IntegrationCandidateGitObserved"
        | "IntegrationCandidateGitValidationFailed"
        | "IntegrationCandidateCorrectionLimitReached"
        | "IntegrationCandidateContinuationLimitReached"
        | "TaskTrackerFactsObserved"
        | "TaskTrackerReadIntentRecorded"
        | "TaskWorkCapacityChanged"
        | "WorkflowRunBegan"
        | "WorkflowRunTerminated"
    }
  >
): RecordedCassetteEntry => {
  if (isRecordedClaimReleaseEntry(event)) return recordClaimReleaseEntry(event)
  if (isRecordedIntegrationEntry(event)) return recordIntegrationEntry(event)
  if (isRecordedWorktreeEntry(event)) return recordWorktreeEntry(event)
  switch (event._tag) {
    case "TaskAttemptPlanned":
      return { _tag: "TaskAttemptPlanned", operation: event.operation }
    case "TaskClaimAcquired":
      return { _tag: "TaskClaimAcquired", claim: event.claim }
    case "TaskClaimAcquisitionIntended":
      return { _tag: "TaskClaimAcquisitionIntended", operation: event.operation }
    case "TaskClaimAcquisitionRejected":
      return {
        _tag: "TaskClaimAcquisitionRejected",
        observed: event.observed,
        operationId: event.operationId,
        reason: event.reason
      }
  }
}

type OperatorDirectionEvent = Extract<
  WorkflowJournalEvent,
  { readonly _tag: "ControlDirectionApplied" | "TaskClaimReacquisitionDirected" }
>

const isOperatorDirectionEvent = (event: WorkflowJournalEvent): event is OperatorDirectionEvent =>
  event._tag === "ControlDirectionApplied" || event._tag === "TaskClaimReacquisitionDirected"

const recordedOperatorDirectionEntryFor = (event: OperatorDirectionEvent): RecordedCassetteEntry => {
  if (event._tag === "ControlDirectionApplied") {
    return {
      _tag: "ControlDirectionApplied",
      direction: event.direction,
      initiatedBy: event.initiatedBy,
      occurrenceClassification: event.occurrenceClassification,
      ordinal: event.ordinal,
      subject: event.subject
    }
  }
  return {
    _tag: "TaskClaimReacquisitionDirected",
    initiatedBy: event.initiatedBy,
    occurrenceClassification: event.occurrenceClassification,
    requestId: event.requestId,
    taskId: event.subject.taskId
  }
}

// eslint-disable-next-line complexity -- The closed journal vocabulary has one total projection into recorded cassette entries.
const recordedEntryFor = (event: WorkflowJournalEvent): RecordedCassetteEntry => {
  if (isJournalRunEntry(event)) return recordedRunEntryFor(event)
  if (isOperatorDirectionEvent(event)) return recordedOperatorDirectionEntryFor(event)
  if (isCandidateConstructionEvent(event)) return recordCandidateConstructionEntry(event)
  if (
    event._tag === "GitReadIntentRecorded" ||
    event._tag === "PlannedAttemptWorktreeObserved" ||
    event._tag === "TargetLineageObserved"
  ) {
    return recordGitObservationEntry(event)
  }
  if (event._tag === "TaskTrackerReadIntentRecorded" || event._tag === "TaskTrackerFactsObserved") {
    return recordTrackerEntry(event)
  }
  if (
    event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" ||
    event._tag === "PlannedAttemptExecutorWorkReported"
  ) {
    return recordExecutorEntry(event)
  }
  return recordTaskBoundaryEntry(event)
}

export class EmptyJournalCannotBeRecorded extends Schema.TaggedErrorClass<EmptyJournalCannotBeRecorded>()(
  "EmptyJournalCannotBeRecorded",
  {}
) {}

/** Projects a valid one-run journal without exposing a partial cassette. */
export const projectRecordedCassette = Effect.fn("ScenarioCassette.projectRecorded")(function* (
  records: ReadonlyArray<JournalRecord>
) {
  const runId = records[0]?.runId
  if (runId === undefined) return yield* new EmptyJournalCannotBeRecorded({})
  const history = reduceWorkflowJournalHistory(runId, records)
  if (history._tag === "InvalidWorkflowJournalHistory") return yield* Effect.fail(history)
  return RecordedCassette.make({
    entries: records.map(({ event }) => recordedEntryFor(event)),
    runId,
    schemaVersion: recordedCassetteVersion
  })
})

const eventForTaskBoundaryEntry = (
  entry: Extract<
    RecordedCassetteEntry,
    {
      readonly _tag:
        | "TaskAttemptPlanned"
        | "TaskClaimAcquired"
        | "TaskClaimAcquisitionIntended"
        | "TaskClaimAcquisitionRejected"
        | "TaskClaimReleaseIntended"
        | "TaskClaimReleased"
        | "IntegrationResponsibilityBegan"
        | "IntegrationStarted"
        | "TaskWorktreeReady"
        | "TaskWorktreeReconciliationIntended"
    }
  >,
  entries: ReadonlyArray<RecordedCassetteEntry>,
  index: number
): WorkflowJournalEvent => {
  if (isRecordedClaimReleaseEntry(entry)) return eventForClaimReleaseEntry(entry)
  if (isRecordedIntegrationEntry(entry)) return eventForIntegrationEntry(entry, entries, index)
  if (isRecordedWorktreeEntry(entry)) return eventForWorktreeEntry(entry)
  switch (entry._tag) {
    case "TaskAttemptPlanned":
      return TaskAttemptPlannedEvent.make({ operation: entry.operation, version: workflowJournalEventVersion })
    case "TaskClaimAcquired":
      return TaskClaimAcquiredEvent.make({ claim: entry.claim, version: workflowJournalEventVersion })
    case "TaskClaimAcquisitionIntended":
      return TaskClaimAcquisitionIntendedEvent.make({
        operation: entry.operation,
        version: workflowJournalEventVersion
      })
    case "TaskClaimAcquisitionRejected":
      return TaskClaimAcquisitionRejectedEvent.make({
        observed: entry.observed,
        operationId: entry.operationId,
        reason: entry.reason,
        version: workflowJournalEventVersion
      })
  }
}

type RecordedExecutorEntry = Extract<
  RecordedCassetteEntry,
  { readonly _tag: "PlannedAttemptExecutorWorkReported" | "PlannedAttemptExecutorWorkResponsibilityBegan" }
>
const isRecordedExecutorEntry = (entry: RecordedCassetteEntry): entry is RecordedExecutorEntry =>
  new Set(["PlannedAttemptExecutorWorkReported", "PlannedAttemptExecutorWorkResponsibilityBegan"]).has(entry._tag)

const eventForExecutorEntry = (entry: RecordedExecutorEntry): WorkflowJournalEvent =>
  entry._tag === "PlannedAttemptExecutorWorkReported"
    ? PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: entry.ordinal,
        report: entry.report,
        version: workflowJournalEventVersion
      })
    : PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
        plannedAttempt: entry.plannedAttempt,
        version: workflowJournalEventVersion
      })

type RecordedTrackerEntry = Extract<
  RecordedCassetteEntry,
  { readonly _tag: "TaskTrackerFactsObserved" | "TaskTrackerReadInitiated" }
>
const isRecordedTrackerEntry = (entry: RecordedCassetteEntry): entry is RecordedTrackerEntry =>
  new Set(["TaskTrackerFactsObserved", "TaskTrackerReadInitiated"]).has(entry._tag)

const eventForTrackerEntry = (entry: RecordedTrackerEntry): WorkflowJournalEvent =>
  entry._tag === "TaskTrackerFactsObserved"
    ? taskTrackerFactsObservedEvent(entry.originatingActionOperationId, entry.evidence)
    : taskTrackerReadIntent(entry.operation)

const eventForIntegrationEntry = (
  entry: RecordedIntegrationEntry,
  entries: ReadonlyArray<RecordedCassetteEntry>,
  index: number
): WorkflowJournalEvent => {
  if (entry._tag === "IntegrationResponsibilityBegan") {
    return IntegrationResponsibilityBeganEvent.make({
      acceptedResult: entry.acceptedResult,
      integrationTarget: entry.integrationTarget,
      plannedAttempt: entry.plannedAttempt,
      version: workflowJournalEventVersion
    })
  }
  const beganIndex = entries.findLastIndex(
    (candidate, candidateIndex) =>
      candidateIndex < index &&
      candidate._tag === "IntegrationResponsibilityBegan" &&
      candidate.plannedAttempt.attemptId === entry.plannedAttempt.attemptId &&
      candidate.acceptedResult.commit === entry.acceptedResult.commit &&
      candidate.integrationTarget.repository === entry.integrationTarget.repository &&
      candidate.integrationTarget.ref === entry.integrationTarget.ref
  )
  return IntegrationStartedEvent.make({
    acceptedResult: entry.acceptedResult,
    integrationTarget: entry.integrationTarget,
    plannedAttempt: entry.plannedAttempt,
    responsibilityBeganAt: JournalPosition.make((beganIndex < 0 ? index : beganIndex) + 1),
    version: workflowJournalEventVersion
  })
}

type RecordedOperatorDirectionEntry = Extract<
  RecordedCassetteEntry,
  { readonly _tag: "ControlDirectionApplied" | "TaskClaimReacquisitionDirected" }
>

const isRecordedOperatorDirectionEntry = (entry: RecordedCassetteEntry): entry is RecordedOperatorDirectionEntry =>
  entry._tag === "ControlDirectionApplied" || entry._tag === "TaskClaimReacquisitionDirected"

const eventForRecordedOperatorDirectionEntry = (
  entry: RecordedOperatorDirectionEntry,
  runId: RecordedCassetteType["runId"]
): WorkflowJournalEvent => {
  if (entry._tag === "ControlDirectionApplied") {
    return ControlDirectionAppliedEvent.make({ ...entry, version: workflowJournalEventVersion })
  }
  return TaskClaimReacquisitionDirectedEvent.make({
    initiatedBy: entry.initiatedBy,
    occurrenceClassification: entry.occurrenceClassification,
    requestId: entry.requestId,
    subject: { runId, taskId: entry.taskId },
    version: workflowJournalEventVersion
  })
}

const priorEntryPosition = (
  entries: ReadonlyArray<RecordedCassetteEntry>,
  index: number,
  matches: (entry: RecordedCassetteEntry) => boolean
): JournalPosition => {
  const priorIndex = entries.findLastIndex((entry, candidateIndex) => candidateIndex < index && matches(entry))
  return JournalPosition.make((priorIndex < 0 ? index : priorIndex) + 1)
}

const eventForCandidateConstructionEntry = (
  entry: RecordedCandidateConstructionEntry,
  entries: ReadonlyArray<RecordedCassetteEntry>,
  index: number
): WorkflowJournalEvent => {
  switch (entry._tag) {
    case "IntegrationCandidateConstructionIntended":
      return IntegrationCandidateConstructionIntendedEvent.make({
        correlation: entry.correlation,
        correctionLimit: entry.correctionLimit,
        continuationLimit: entry.continuationLimit,
        plannedAttempt: entry.plannedAttempt,
        responsibilityBeganAt: priorEntryPosition(
          entries,
          index,
          (candidate) =>
            candidate._tag === "IntegrationResponsibilityBegan" &&
            candidate.plannedAttempt.attemptId === entry.correlation.attemptId
        ),
        startedAt: priorEntryPosition(
          entries,
          index,
          (candidate) =>
            candidate._tag === "IntegrationStarted" &&
            candidate.plannedAttempt.attemptId === entry.correlation.attemptId
        ),
        version: workflowJournalEventVersion
      })
    case "IntegrationCandidateAgentReported":
      return IntegrationCandidateAgentReportedEvent.make({
        expectedCorrelation: entry.expectedCorrelation,
        ordinal: entry.ordinal,
        report: entry.report,
        version: workflowJournalEventVersion
      })
    case "IntegrationCandidateGitObserved":
      return IntegrationCandidateGitObservedEvent.make({
        candidateCommit: entry.candidateCommit,
        correlation: entry.correlation,
        observation: entry.observation,
        submissionAt: priorEntryPosition(
          entries,
          index,
          (candidate) =>
            candidate._tag === "IntegrationCandidateAgentReported" &&
            candidate.report._tag === "Submitted" &&
            candidate.report.candidateCommit === entry.candidateCommit &&
            candidate.report.correlation.candidateId === entry.correlation.candidateId
        ),
        version: workflowJournalEventVersion
      })
    case "IntegrationCandidateConstructed":
      return IntegrationCandidateConstructedEvent.make({
        candidateCommit: entry.candidateCommit,
        correlation: entry.correlation,
        gitObservationAt: priorEntryPosition(
          entries,
          index,
          (candidate) =>
            candidate._tag === "IntegrationCandidateGitObserved" &&
            candidate.candidateCommit === entry.candidateCommit &&
            candidate.correlation.candidateId === entry.correlation.candidateId
        ),
        version: workflowJournalEventVersion
      })
    case "IntegrationCandidateGitValidationFailed":
      return IntegrationCandidateGitValidationFailedEvent.make({
        attemptOrdinal: entry.attemptOrdinal,
        candidateCommit: entry.candidateCommit,
        correlation: entry.correlation,
        detail: entry.detail,
        submissionAt: priorEntryPosition(
          entries,
          index,
          (candidate) =>
            candidate._tag === "IntegrationCandidateAgentReported" &&
            candidate.report._tag === "Submitted" &&
            candidate.report.candidateCommit === entry.candidateCommit &&
            candidate.report.correlation.candidateId === entry.correlation.candidateId
        ),
        version: workflowJournalEventVersion
      })
    case "IntegrationCandidateCorrectionLimitReached":
      return IntegrationCandidateCorrectionLimitReachedEvent.make({
        correctionCount: entry.correctionCount,
        correctionLimit: entry.correctionLimit,
        correlation: entry.correlation,
        invalidObservationAt: priorEntryPosition(
          entries,
          index,
          (candidate) =>
            candidate._tag === "IntegrationCandidateGitObserved" &&
            candidate.correlation.candidateId === entry.correlation.candidateId
        ),
        version: workflowJournalEventVersion
      })
    case "IntegrationCandidateContinuationLimitReached":
      return IntegrationCandidateContinuationLimitReachedEvent.make({
        continuationCount: entry.continuationCount,
        continuationLimit: entry.continuationLimit,
        correlation: entry.correlation,
        lastReportAt: priorEntryPosition(
          entries,
          index,
          (candidate) =>
            candidate._tag === "IntegrationCandidateAgentReported" &&
            candidate.report._tag !== "Submitted" &&
            candidate.report.correlation.candidateId === entry.correlation.candidateId
        ),
        version: workflowJournalEventVersion
      })
  }
}

const eventForRecordedEntry = (
  entry: RecordedCassetteEntry,
  entries: ReadonlyArray<RecordedCassetteEntry>,
  index: number,
  runId: RecordedCassetteType["runId"]
): WorkflowJournalEvent => {
  if (isRecordedRunEntry(entry)) return eventForRunEntry(entry)
  if (isRecordedOperatorDirectionEntry(entry)) return eventForRecordedOperatorDirectionEntry(entry, runId)
  if (isRecordedCandidateConstructionEntry(entry)) {
    return eventForCandidateConstructionEntry(entry, entries, index)
  }
  if (isRecordedGitObservationEntry(entry)) return eventForGitObservationEntry(entry)
  if (isRecordedExecutorEntry(entry)) return eventForExecutorEntry(entry)
  if (isRecordedTrackerEntry(entry)) return eventForTrackerEntry(entry)
  return eventForTaskBoundaryEntry(entry, entries, index)
}

const recordsFor = (cassette: RecordedCassetteType): ReadonlyArray<JournalRecord> =>
  cassette.entries.map((entry, index) => {
    const event = eventForRecordedEntry(entry, cassette.entries, index, cassette.runId)
    return {
      event,
      key: describeJournalEvent(event).expectedKey,
      position: JournalPosition.make(index + 1),
      runId: cassette.runId
    }
  })

/** Folds recorded meanings as workflow history; it never drives boundary implementations. */
export const foldRecordedCassette = (cassette: RecordedCassetteType) =>
  reduceWorkflowJournalHistory(cassette.runId, recordsFor(cassette))

const semanticWorkflowHistory = (history: ReturnType<typeof reduceWorkflowJournalHistory>): unknown =>
  history._tag === "InvalidWorkflowJournalHistory"
    ? { _tag: history._tag, issueKinds: history.issues.map(({ _tag }) => _tag) }
    : history.runState.workflowHistory.records.map(({ event }) => recordedEntryFor(event))

export interface RecordedCassetteCheckpoint {
  readonly appliedOccurrencePositionEquivalent: boolean
  readonly checkpoint: number
  readonly operationalStateEquivalent: boolean
  readonly pureSelectionEquivalent: boolean
  readonly workflowHistoryEquivalent: boolean
}

const checkpointComparison = (
  checkpoint: number,
  expected: ReturnType<typeof reduceWorkflowJournalHistory>,
  actual: ReturnType<typeof reduceWorkflowJournalHistory>
): RecordedCassetteCheckpoint => ({
  appliedOccurrencePositionEquivalent: appliedOccurrencePosition(expected) === appliedOccurrencePosition(actual),
  checkpoint,
  pureSelectionEquivalent:
    expected._tag === "ValidWorkflowJournalHistory" &&
    actual._tag === "ValidWorkflowJournalHistory" &&
    semanticJson(expected.recoveryFrontier) === semanticJson(actual.recoveryFrontier),
  operationalStateEquivalent: semanticJson(semanticState(expected)) === semanticJson(semanticState(actual)),
  workflowHistoryEquivalent:
    semanticJson(semanticWorkflowHistory(expected)) === semanticJson(semanticWorkflowHistory(actual))
})

/** Compares source and recorded folds after every corresponding occurrence. */
export const verifyRecordedCassetteRoundTrip = (
  records: ReadonlyArray<JournalRecord>,
  cassette: RecordedCassetteType
): ReadonlyArray<RecordedCassetteCheckpoint> =>
  records.map((_record, index) => {
    const checkpoint = index + 1
    return checkpointComparison(
      checkpoint,
      reduceWorkflowJournalHistory(cassette.runId, records.slice(0, checkpoint)),
      foldRecordedCassette(RecordedCassette.make({ ...cassette, entries: cassette.entries.slice(0, checkpoint) }))
    )
  })

/** Applies one declared alpha-renaming before the ordinary prefix comparison. */
export const verifyRecordedCassetteRoundTripWithRenaming = Effect.fn(
  "ScenarioCassette.verifyRecordedRoundTripWithRenaming"
)(function* (
  records: ReadonlyArray<JournalRecord>,
  cassette: RecordedCassetteType,
  recordedToJournal: CassetteIdentityRenaming
) {
  return verifyRecordedCassetteRoundTrip(records, yield* renameRecordedCassette(cassette, recordedToJournal))
})

/** Compares two recorded histories occurrence by occurrence with the same selector. */
export const compareRecordedCassetteCheckpoints = (
  expected: RecordedCassetteType,
  actual: RecordedCassetteType
): ReadonlyArray<RecordedCassetteCheckpoint> =>
  expected.entries.map((_entry, index) => {
    const checkpoint = index + 1
    const prefix = (cassette: RecordedCassetteType) =>
      foldRecordedCassette(RecordedCassette.make({ ...cassette, entries: cassette.entries.slice(0, checkpoint) }))
    return checkpointComparison(checkpoint, prefix(expected), prefix(actual))
  })

const lyricForExecutorEntry = (entry: RecordedExecutorEntry): string =>
  entry._tag === "PlannedAttemptExecutorWorkReported"
    ? `The executor reported ${entry.report._tag} for attempt ${entry.report.correlation.attemptId}.`
    : `Dalph coordinator began executor-work responsibility for task ${entry.plannedAttempt.taskId}, attempt ${entry.plannedAttempt.attemptId}.`

const lyricForTrackerEntry = (entry: RecordedTrackerEntry): string =>
  entry._tag === "TaskTrackerFactsObserved"
    ? `Dalph observed ${entry.evidence._tag} through tracker read ${entry.originatingActionOperationId}.`
    : `Dalph coordinator initiated ${entry.operation._tag} for the task tracker.`

// eslint-disable-next-line complexity -- Every closed candidate occurrence receives one concrete actor-first lyric.
const lyricForCandidateConstructionEntry = (entry: RecordedCandidateConstructionEntry): string => {
  switch (entry._tag) {
    case "IntegrationCandidateConstructionIntended":
      return `Dalph coordinator began candidate ${entry.correlation.candidateId} in session ${entry.correlation.integrationSessionId}.`
    case "IntegrationCandidateAgentReported":
      return integrationCandidateCorrelationEquals(entry.expectedCorrelation, entry.report.correlation)
        ? `The integration agent reported ${entry.report._tag} for session ${entry.report.correlation.integrationSessionId}.`
        : `The integration agent returned an infrastructure correlation contradiction for expected session ${entry.expectedCorrelation.integrationSessionId}; Dalph preserved the involved candidate resources.`
    case "IntegrationCandidateGitObserved":
      return `Git reported ${entry.observation._tag} for submitted commit ${entry.candidateCommit}.`
    case "IntegrationCandidateConstructed":
      return `Git proved candidate ${entry.candidateCommit} has the exact ordered parents selected for the session.`
    case "IntegrationCandidateGitValidationFailed":
      return `Git could not validate submitted commit ${entry.candidateCommit}: ${entry.detail}`
    case "IntegrationCandidateCorrectionLimitReached":
      return `Candidate session ${entry.correlation.integrationSessionId} stopped after ${entry.correctionCount} correction attempts.`
    case "IntegrationCandidateContinuationLimitReached":
      return `Candidate session ${entry.correlation.integrationSessionId} stopped after ${entry.continuationCount} automatic agent continuations.`
  }
}

type RecordedClaimAcquisitionEntry = Extract<
  RecordedCassetteEntry,
  { readonly _tag: "TaskClaimAcquired" | "TaskClaimAcquisitionIntended" | "TaskClaimAcquisitionRejected" }
>

const isRecordedClaimAcquisitionEntry = (entry: RecordedCassetteEntry): entry is RecordedClaimAcquisitionEntry =>
  entry._tag === "TaskClaimAcquired" ||
  entry._tag === "TaskClaimAcquisitionIntended" ||
  entry._tag === "TaskClaimAcquisitionRejected"

const lyricForClaimAcquisitionEntry = (entry: RecordedClaimAcquisitionEntry): string => {
  switch (entry._tag) {
    case "TaskClaimAcquired":
      return `The task tracker showed Dalph's exact claim for task ${entry.claim.taskId}.`
    case "TaskClaimAcquisitionIntended":
      return `Dalph intended to claim task ${entry.operation.acquisition.taskId}.`
    case "TaskClaimAcquisitionRejected":
      return `The task tracker preserved foreign claim ${entry.observed.operationId} for task ${entry.observed.taskId}.`
  }
}

const lyricForTaskBoundaryEntry = (
  entry: Exclude<
    RecordedCassetteEntry,
    | RecordedCandidateConstructionEntry
    | RecordedExecutorEntry
    | RecordedGitObservationEntry
    | RecordedRunEntry
    | RecordedTrackerEntry
    | { readonly _tag: "ControlDirectionApplied" | "TaskClaimReacquisitionDirected" }
  >
): string => {
  if (isRecordedClaimAcquisitionEntry(entry)) return lyricForClaimAcquisitionEntry(entry)
  if (isRecordedClaimReleaseEntry(entry)) return lyricForClaimReleaseEntry(entry)
  if (isRecordedIntegrationEntry(entry)) {
    return entry._tag === "IntegrationResponsibilityBegan"
      ? `Dalph coordinator queued accepted commit ${entry.acceptedResult.commit} for integration.`
      : `Dalph coordinator started integrating accepted commit ${entry.acceptedResult.commit}.`
  }
  if (isRecordedWorktreeEntry(entry)) return lyricForWorktreeEntry(entry)
  return `Dalph planned attempt ${entry.operation.plannedAttempt.attemptId} for task ${entry.operation.plannedAttempt.taskId}.`
}

const lyricForRecordedOperatorDirectionEntry = (entry: RecordedOperatorDirectionEntry): string => {
  if (entry._tag === "ControlDirectionApplied") {
    return `Operator applied ${entry.direction} to ${entry.subject._tag === "Run" ? "the Run" : `task ${entry.subject.taskId}`}.`
  }
  return `Operator directed Dalph to reacquire the claim for task ${entry.taskId}.`
}

const lyricForRecordedEntry = (entry: RecordedCassetteEntry): string => {
  if (isRecordedOperatorDirectionEntry(entry)) return lyricForRecordedOperatorDirectionEntry(entry)
  if (isRecordedCandidateConstructionEntry(entry)) return lyricForCandidateConstructionEntry(entry)
  if (isRecordedGitObservationEntry(entry)) return lyricForGitObservationEntry(entry)
  if (isRecordedExecutorEntry(entry)) return lyricForExecutorEntry(entry)
  if (isRecordedTrackerEntry(entry)) return lyricForTrackerEntry(entry)
  if (isRecordedRunEntry(entry)) return lyricForRunEntry(entry)
  return lyricForTaskBoundaryEntry(entry)
}

/** Human-readable prose derived from structured entries, never parsed as a contract. */
export const renderRecordedCassetteLyrics = (cassette: RecordedCassetteType): string =>
  cassette.entries.map(lyricForRecordedEntry).join("\n")
