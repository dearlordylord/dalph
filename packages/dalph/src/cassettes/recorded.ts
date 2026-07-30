import { Effect, Schema } from "effect"
import {
  ControlCommandRecordedEvent,
  describeJournalEvent,
  IntegrationResponsibilityBeganEvent,
  IntegrationStartedEvent,
  JournalPosition,
  type JournalRecord,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent,
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  taskTrackerReadIntent,
  taskTrackerFactsObservedEvent,
  TaskWorktreeReadyEvent,
  TaskWorktreeReconciliationIntendedEvent,
  type WorkflowJournalEvent,
  WorkflowActor,
  workflowJournalEventVersion,
  reduceWorkflowJournalHistory
} from "@dalph/orchestrator"
import {
  type CassetteIdentityRenaming,
  RecordedCassette,
  type RecordedCassette as RecordedCassetteType,
  type RecordedCassetteEntry,
  recordedCassetteVersion
} from "./recorded-domain.js"
import { renameRecordedCassette } from "./recorded-renaming.js"
import {
  eventForRunEntry,
  isJournalRunEntry,
  isRecordedRunEntry,
  lyricForRunEntry,
  recordedRunEntryFor,
  type RecordedRunEntry
} from "./recorded-run-mapping.js"

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

const recordTaskBoundaryEntry = (
  event: Exclude<
    WorkflowJournalEvent,
    {
      readonly _tag:
        | "ControlCommandRecorded"
        | "PlannedAttemptExecutorWorkReported"
        | "PlannedAttemptExecutorWorkResponsibilityBegan"
        | "TaskTrackerFactsObserved"
        | "TaskTrackerReadIntentRecorded"
        | "TaskWorkCapacityChanged"
        | "WorkflowRunBegan"
        | "WorkflowRunTerminated"
    }
  >
): RecordedCassetteEntry => {
  switch (event._tag) {
    case "IntegrationResponsibilityBegan":
    case "IntegrationStarted":
      return recordIntegrationEntry(event)
    case "TaskAttemptPlanned":
      return { _tag: "TaskAttemptPlanned", operation: event.operation }
    case "TaskClaimAcquired":
      return { _tag: "TaskClaimAcquired", claim: event.claim }
    case "TaskClaimAcquisitionIntended":
      return { _tag: "TaskClaimAcquisitionIntended", operation: event.operation }
    case "TaskWorktreeReady":
      return { _tag: "TaskWorktreeReady", operationId: event.operationId, proof: event.proof }
    case "TaskWorktreeReconciliationIntended":
      return { _tag: "TaskWorktreeReconciliationIntended", operation: event.operation }
  }
}

const recordedEntryFor = (event: WorkflowJournalEvent): RecordedCassetteEntry => {
  if (isJournalRunEntry(event)) return recordedRunEntryFor(event)
  if (event._tag === "ControlCommandRecorded") {
    return { _tag: "ControlCommandRecorded", command: event.command }
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
        | "IntegrationResponsibilityBegan"
        | "IntegrationStarted"
        | "TaskWorktreeReady"
        | "TaskWorktreeReconciliationIntended"
    }
  >,
  entries: ReadonlyArray<RecordedCassetteEntry>,
  index: number
): WorkflowJournalEvent => {
  switch (entry._tag) {
    case "IntegrationResponsibilityBegan":
    case "IntegrationStarted":
      return eventForIntegrationEntry(entry, entries, index)
    case "TaskAttemptPlanned":
      return TaskAttemptPlannedEvent.make({ operation: entry.operation, version: workflowJournalEventVersion })
    case "TaskClaimAcquired":
      return TaskClaimAcquiredEvent.make({ claim: entry.claim, version: workflowJournalEventVersion })
    case "TaskClaimAcquisitionIntended":
      return TaskClaimAcquisitionIntendedEvent.make({
        operation: entry.operation,
        version: workflowJournalEventVersion
      })
    case "TaskWorktreeReady":
      return TaskWorktreeReadyEvent.make({
        operationId: entry.operationId,
        proof: entry.proof,
        version: workflowJournalEventVersion
      })
    case "TaskWorktreeReconciliationIntended":
      return TaskWorktreeReconciliationIntendedEvent.make({
        operation: entry.operation,
        version: workflowJournalEventVersion
      })
  }
}

type RecordedExecutorEntry = Extract<
  RecordedCassetteEntry,
  { readonly _tag: "PlannedAttemptExecutorWorkReported" | "PlannedAttemptExecutorWorkResponsibilityBegan" }
>

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

const eventForRecordedEntry = (
  entry: RecordedCassetteEntry,
  entries: ReadonlyArray<RecordedCassetteEntry>,
  index: number
): WorkflowJournalEvent => {
  if (isRecordedRunEntry(entry)) return eventForRunEntry(entry)
  if (entry._tag === "ControlCommandRecorded") {
    return ControlCommandRecordedEvent.make({ command: entry.command, version: workflowJournalEventVersion })
  }
  if (
    entry._tag === "PlannedAttemptExecutorWorkReported" ||
    entry._tag === "PlannedAttemptExecutorWorkResponsibilityBegan"
  ) {
    return eventForExecutorEntry(entry)
  }
  if (entry._tag === "TaskTrackerFactsObserved" || entry._tag === "TaskTrackerReadInitiated") {
    return eventForTrackerEntry(entry)
  }
  return eventForTaskBoundaryEntry(entry, entries, index)
}

const recordsFor = (cassette: RecordedCassetteType): ReadonlyArray<JournalRecord> =>
  cassette.entries.map((entry, index) => {
    const event = eventForRecordedEntry(entry, cassette.entries, index)
    return {
      event,
      key: describeJournalEvent(event).expectedKey,
      position: JournalPosition.make(index + 1),
      runId: cassette.runId
    }
  })

/** Folds recorded meanings as workflow history; it never drives fake providers. */
export const foldRecordedCassette = (cassette: RecordedCassetteType) =>
  reduceWorkflowJournalHistory(cassette.runId, recordsFor(cassette))

const semanticJson = (value: unknown): string => JSON.stringify(value)

const semanticResponsibility = (
  history: Extract<ReturnType<typeof reduceWorkflowJournalHistory>, { readonly _tag: "ValidWorkflowJournalHistory" }>
) =>
  history.runState.responsibility.entries
    .map((entry) => {
      switch (entry._tag) {
        case "PlannedAttemptExecutorWorkResponsibility":
          return { _tag: entry._tag, plannedAttempt: entry.plannedAttempt }
        case "TaskClaimResponsibility":
          return { _tag: entry._tag, acquisition: entry.acquisition, taskId: entry.taskId }
        case "TaskWorktreeResponsibility":
          return { _tag: entry._tag, operation: entry.operation, taskId: entry.taskId }
      }
    })
    .toSorted((left, right) => semanticJson(left).localeCompare(semanticJson(right)))

const semanticState = (history: ReturnType<typeof reduceWorkflowJournalHistory>): unknown =>
  history._tag === "InvalidWorkflowJournalHistory"
    ? { _tag: history._tag, issueKinds: history.issues.map(({ _tag }) => _tag) }
    : {
        graphKnowledge: history.runState.graphKnowledge,
        pause: history.runState.pause,
        responsibility: semanticResponsibility(history),
        runId: history.runId
      }

const semanticWorkflowHistory = (history: ReturnType<typeof reduceWorkflowJournalHistory>): unknown =>
  history._tag === "InvalidWorkflowJournalHistory"
    ? { _tag: history._tag, issueKinds: history.issues.map(({ _tag }) => _tag) }
    : history.runState.workflowHistory.records.map(({ event }) => recordedEntryFor(event))

const appliedOccurrencePosition = (history: ReturnType<typeof reduceWorkflowJournalHistory>): number =>
  history._tag === "InvalidWorkflowJournalHistory" ? 0 : history.runState.workflowHistory.records.length

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

const lyricForTaskBoundaryEntry = (
  entry: Exclude<
    RecordedCassetteEntry,
    RecordedExecutorEntry | RecordedRunEntry | RecordedTrackerEntry | { readonly _tag: "ControlCommandRecorded" }
  >
): string => {
  switch (entry._tag) {
    case "TaskAttemptPlanned":
      return `Dalph planned attempt ${entry.operation.plannedAttempt.attemptId} for task ${entry.operation.plannedAttempt.taskId}.`
    case "TaskClaimAcquired":
      return `The task tracker showed Dalph's exact claim for task ${entry.claim.taskId}.`
    case "TaskClaimAcquisitionIntended":
      return `Dalph intended to claim task ${entry.operation.acquisition.taskId}.`
    case "TaskWorktreeReady":
      return `Git showed worktree ${entry.proof.worktree} ready at ${entry.proof.headSha}.`
    case "TaskWorktreeReconciliationIntended":
      return `Dalph recorded its intent to reconcile the worktree for attempt ${entry.operation.plannedAttempt.attemptId}.`
    case "IntegrationResponsibilityBegan":
      return `Dalph coordinator queued accepted commit ${entry.acceptedResult.commit} for integration.`
    case "IntegrationStarted":
      return `Dalph coordinator started integrating accepted commit ${entry.acceptedResult.commit}.`
  }
}

const lyricForRecordedEntry = (entry: RecordedCassetteEntry): string => {
  if (entry._tag === "ControlCommandRecorded") {
    return `Dalph recorded the operator's ${entry.command._tag} command.`
  }
  if (
    entry._tag === "PlannedAttemptExecutorWorkReported" ||
    entry._tag === "PlannedAttemptExecutorWorkResponsibilityBegan"
  ) {
    return lyricForExecutorEntry(entry)
  }
  if (entry._tag === "TaskTrackerFactsObserved" || entry._tag === "TaskTrackerReadInitiated") {
    return lyricForTrackerEntry(entry)
  }
  if (isRecordedRunEntry(entry)) return lyricForRunEntry(entry)
  return lyricForTaskBoundaryEntry(entry)
}

/** Human-readable prose derived from structured entries, never parsed as a contract. */
export const renderRecordedCassetteLyrics = (cassette: RecordedCassetteType): string =>
  cassette.entries.map(lyricForRecordedEntry).join("\n")
