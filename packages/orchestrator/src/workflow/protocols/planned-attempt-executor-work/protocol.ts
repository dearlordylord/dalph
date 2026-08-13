import { Effect, Match } from "effect"
import {
  type PlannedTaskAttempt,
  PlannedAttemptExecutor,
  type PlannedAttemptExecutorCorrelation,
  plannedAttemptExecutorCorrelation,
  type PlannedAttemptExecutorReport,
  plannedTaskAttemptEquivalence,
  samePlannedAttemptExecutorCorrelation
} from "@dalph/contracts"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  plannedAttemptExecutorCommandIntendedRecordKey,
  plannedAttemptExecutorCommandProjectionObservedRecordKey,
  plannedAttemptExecutorCommandResponseContradictedRecordKey,
  plannedAttemptExecutorStateObservedRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey
} from "../../../workflow-journal/record-key.js"
import { InRunJournal, type JournalRecord } from "../../../workflow-journal/store.js"
import {
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorCommandProjectionObservedEvent,
  PlannedAttemptExecutorCommandProjectionObservation,
  PlannedAttemptExecutorCommandProjectionOrdinal,
  PlannedAttemptExecutorCommandResponseContradictedEvent,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorStateObservedEvent,
  PlannedAttemptExecutorStateObservation,
  PlannedAttemptExecutorStateObservationOrdinal,
  type PlannedAttemptExecutorContinuationLimit,
  defaultPlannedAttemptExecutorContinuationLimit,
  type PlannedAttemptExecutorSuspensionLimit,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "./events.js"
import { latestUnsettledPlannedAttemptExecutorCommand, plannedAttemptExecutorEvidence } from "./evidence.js"
import { type PlannedAttemptProtocolPermit, withPlannedAttemptProtocolPermit } from "./protocol-controller.js"
import {
  PlannedAttemptExecutorCommandReconciliationRequired,
  PlannedAttemptExecutorContinuationLimitReached,
  PlannedAttemptExecutorCorrelationMismatch,
  PlannedAttemptExecutorProjectionNoCurrentReport,
  PlannedAttemptExecutorProjectionTemporarilyUnavailable,
  PlannedAttemptExecutorProjectionUnreadable,
  PlannedAttemptExecutorResponsibilityAbandoned,
  PlannedAttemptExecutorResponsibilityContradiction,
  PlannedAttemptExecutorResponsibilityMissing,
  PlannedAttemptExecutorStateNoCurrentReport,
  PlannedAttemptExecutorStateTemporarilyUnavailable,
  PlannedAttemptExecutorStateUnreadable,
  PlannedAttemptExecutorSuspensionLimitReached,
  validatePlannedAttemptExecutorProjectionCorrelation
} from "./errors.js"

export * from "./errors.js"

/** Records ownership before any adapter records a command intent or crosses the executor boundary. */
export const beginPlannedAttemptExecutorResponsibility = Effect.fn(
  "PlannedAttemptExecutorWorkflow.beginResponsibility"
)(function* (plannedAttempt: PlannedTaskAttempt) {
  const journal = yield* InRunJournal
  const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
  const records = yield* journal.read(plannedAttempt.runId)
  if (
    records.some(
      ({ event }) =>
        event._tag === "AttemptImplementationAbandoned" &&
        event.subject.plannedAttempt.runId === plannedAttempt.runId &&
        event.subject.plannedAttempt.attemptId === plannedAttempt.attemptId
    )
  ) {
    return yield* new PlannedAttemptExecutorResponsibilityAbandoned({ correlation })
  }
  const responsibilityBegan = records.find(
    ({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
      event.plannedAttempt.attemptId === plannedAttempt.attemptId
  )
  if (responsibilityBegan?.event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan") {
    if (!plannedTaskAttemptEquivalence(responsibilityBegan.event.plannedAttempt, plannedAttempt)) {
      return yield* new PlannedAttemptExecutorResponsibilityContradiction({
        accepted: responsibilityBegan.event.plannedAttempt,
        requested: plannedAttempt
      })
    }
  } else {
    yield* journal.append(
      plannedAttempt.runId,
      plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
      PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({ plannedAttempt, version: workflowJournalEventVersion })
    )
  }
})

export type PlannedAttemptExecutorContinuationDisposition =
  | { readonly _tag: "ExecutorContinuationAvailable" }
  | { readonly _tag: "ExecutorContinuationLimitReached"; readonly limit: PlannedAttemptExecutorContinuationLimit }

/** Pure durable-budget decision shared by all conforming interpreter Layers. */
export const plannedAttemptExecutorContinuationDisposition = (
  correlation: PlannedAttemptExecutorCorrelation,
  reports: ReadonlyArray<PlannedAttemptExecutorReport>,
  continuationLimit = defaultPlannedAttemptExecutorContinuationLimit,
  durableCommandCount?: number
): PlannedAttemptExecutorContinuationDisposition => {
  const acceptedReports = reports.filter((report) =>
    samePlannedAttemptExecutorCorrelation(correlation, report.correlation)
  )
  const lastSafeSuspension = acceptedReports.findLastIndex(({ _tag }) => _tag === "SafelySuspended")
  const runningSinceSafeSuspension = acceptedReports
    .slice(lastSafeSuspension + 1)
    .filter(({ _tag }) => _tag === "Running")
  return (durableCommandCount ?? runningSinceSafeSuspension.length) >= continuationLimit
    ? { _tag: "ExecutorContinuationLimitReached", limit: continuationLimit }
    : { _tag: "ExecutorContinuationAvailable" }
}

const reconcileUnsettledCommand = Effect.fn("PlannedAttemptExecutorWorkflow.reconcileUnsettledCommand")(function* (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  intent: Extract<JournalRecord["event"], { readonly _tag: "PlannedAttemptExecutorCommandIntended" }>
) {
  const journal = yield* InRunJournal
  const executor = yield* PlannedAttemptExecutor
  const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
  const projectionOrdinal = PlannedAttemptExecutorCommandProjectionOrdinal.make(
    records.filter(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorCommandProjectionObserved" &&
        event.plannedAttempt.attemptId === plannedAttempt.attemptId &&
        event.commandOrdinal === intent.ordinal
    ).length + 1
  )
  const projected = yield* executor.project(correlation)
  const invalidProjection = validatePlannedAttemptExecutorProjectionCorrelation(projected, correlation)
  if (invalidProjection !== undefined) {
    return yield* invalidProjection
  }
  const recordProjection = (observation: PlannedAttemptExecutorCommandProjectionObservation) =>
    journal.append(
      plannedAttempt.runId,
      plannedAttemptExecutorCommandProjectionObservedRecordKey(
        plannedAttempt.attemptId,
        intent.ordinal,
        projectionOrdinal
      ),
      PlannedAttemptExecutorCommandProjectionObservedEvent.make({
        commandOrdinal: intent.ordinal,
        observation,
        occurrenceClassification: "NonActionOccurrence",
        plannedAttempt,
        projectionOrdinal,
        version: workflowJournalEventVersion
      })
    )
  if (projected._tag === "NoReport") {
    yield* recordProjection(
      PlannedAttemptExecutorCommandProjectionObservation.cases.ExecutorStateNoCurrentReport.make({})
    )
    return yield* new PlannedAttemptExecutorProjectionNoCurrentReport({ commandOrdinal: intent.ordinal, correlation })
  }
  if (projected._tag === "TemporarilyUnavailable") {
    yield* recordProjection(
      PlannedAttemptExecutorCommandProjectionObservation.cases.ExecutorStateTemporarilyUnavailable.make({})
    )
    return yield* new PlannedAttemptExecutorProjectionTemporarilyUnavailable({
      commandOrdinal: intent.ordinal,
      correlation
    })
  }
  if (projected._tag === "Unreadable") {
    yield* recordProjection(PlannedAttemptExecutorCommandProjectionObservation.cases.ExecutorStateUnreadable.make({}))
    return yield* new PlannedAttemptExecutorProjectionUnreadable({ commandOrdinal: intent.ordinal, correlation })
  }
  const projectedReport = projected._tag === "Exact" ? projected.report : projected.observed
  if (!samePlannedAttemptExecutorCorrelation(correlation, projectedReport.correlation)) {
    yield* recordProjection(
      PlannedAttemptExecutorCommandProjectionObservation.cases.ExecutorReportContradiction.make({
        observed: projectedReport
      })
    )
    return yield* new PlannedAttemptExecutorCorrelationMismatch({
      expected: correlation,
      observed: projectedReport.correlation
    })
  }
  yield* recordProjection(
    PlannedAttemptExecutorCommandProjectionObservation.cases.ExactExecutorReport.make({ report: projectedReport })
  )
  return projectedReport
})

const commandLimitError = (
  command: "StartOrContinue" | "Suspend",
  correlation: PlannedAttemptExecutorCorrelation,
  continuation: PlannedAttemptExecutorContinuationDisposition,
  suspensionCommandCount: number,
  suspensionLimit: PlannedAttemptExecutorSuspensionLimit
): PlannedAttemptExecutorContinuationLimitReached | PlannedAttemptExecutorSuspensionLimitReached | undefined => {
  if (command === "StartOrContinue" && continuation._tag === "ExecutorContinuationLimitReached") {
    return new PlannedAttemptExecutorContinuationLimitReached({ correlation, limit: continuation.limit })
  }
  if (command === "Suspend" && suspensionCommandCount >= suspensionLimit) {
    return new PlannedAttemptExecutorSuspensionLimitReached({ correlation, limit: suspensionLimit })
  }
  return undefined
}

/** Journal-first executor command primitive used by guarded protocol entry points. */
export const runPlannedAttemptExecutorCommand = Effect.fn("PlannedAttemptExecutorWorkflow.runCommand")(function* (
  plannedAttempt: PlannedTaskAttempt,
  command: "StartOrContinue" | "Suspend",
  continuationLimit: PlannedAttemptExecutorContinuationLimit,
  suspensionLimit: PlannedAttemptExecutorSuspensionLimit
) {
  const journal = yield* InRunJournal
  const executor = yield* PlannedAttemptExecutor
  const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
  yield* beginPlannedAttemptExecutorResponsibility(plannedAttempt)
  const records = yield* journal.read(plannedAttempt.runId)
  const acceptedReportRecords = records.filter(
    ({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkReported" &&
      samePlannedAttemptExecutorCorrelation(correlation, event.report.correlation)
  )
  const acceptedReports = acceptedReportRecords.flatMap(({ event }) =>
    /* v8 ignore next -- acceptedReportRecords is closed by the immediately preceding exact-tag and exact-correlation filter. */
    event._tag === "PlannedAttemptExecutorWorkReported" &&
    samePlannedAttemptExecutorCorrelation(correlation, event.report.correlation)
      ? [event.report]
      : []
  )
  const latestSafeSuspensionPosition = plannedAttemptExecutorEvidence(records, plannedAttempt).findLast(
    ({ report }) => report._tag === "SafelySuspended"
  )?.observedAt
  const commandCountSinceSafeSuspension = (candidate: "StartOrContinue" | "Suspend") =>
    records.filter(
      ({ event, position }) =>
        (latestSafeSuspensionPosition === undefined || position > latestSafeSuspensionPosition) &&
        event._tag === "PlannedAttemptExecutorCommandIntended" &&
        event.command === candidate &&
        event.plannedAttempt.runId === plannedAttempt.runId &&
        event.plannedAttempt.attemptId === plannedAttempt.attemptId
    ).length
  const unsettledCommand = latestUnsettledPlannedAttemptExecutorCommand(records, plannedAttempt)
  if (unsettledCommand !== undefined) {
    return yield* reconcileUnsettledCommand(records, plannedAttempt, unsettledCommand)
  }
  const continuation = plannedAttemptExecutorContinuationDisposition(
    correlation,
    acceptedReports,
    continuationLimit,
    commandCountSinceSafeSuspension("StartOrContinue")
  )
  const suspensionCommandCount = commandCountSinceSafeSuspension("Suspend")
  const limitError = commandLimitError(command, correlation, continuation, suspensionCommandCount, suspensionLimit)
  if (limitError !== undefined) return yield* limitError
  const commandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(
    records.filter(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorCommandIntended" &&
        event.plannedAttempt.attemptId === plannedAttempt.attemptId
    ).length + 1
  )
  yield* journal.append(
    plannedAttempt.runId,
    plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, commandOrdinal),
    PlannedAttemptExecutorCommandIntendedEvent.make({
      command,
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      ordinal: commandOrdinal,
      plannedAttempt,
      version: workflowJournalEventVersion
    })
  )

  const report: PlannedAttemptExecutorReport =
    command === "StartOrContinue"
      ? yield* executor.startOrContinue(plannedAttempt)
      : yield* executor.requestSuspension(plannedAttempt)
  if (!samePlannedAttemptExecutorCorrelation(correlation, report.correlation)) {
    yield* journal.append(
      plannedAttempt.runId,
      plannedAttemptExecutorCommandResponseContradictedRecordKey(plannedAttempt.attemptId, commandOrdinal),
      PlannedAttemptExecutorCommandResponseContradictedEvent.make({
        commandOrdinal,
        observed: report,
        occurrenceClassification: "NonActionOccurrence",
        plannedAttempt,
        version: workflowJournalEventVersion
      })
    )
    return yield* new PlannedAttemptExecutorCorrelationMismatch({ expected: correlation, observed: report.correlation })
  }

  const ordinal = PlannedAttemptExecutorReportOrdinal.make(acceptedReports.length + 1)
  yield* journal.append(
    plannedAttempt.runId,
    plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, ordinal),
    PlannedAttemptExecutorWorkReportedEvent.make({ ordinal, report, version: workflowJournalEventVersion })
  )
  return report
})

/** Reads current executor authority without issuing another start, continuation, or suspension command. */
const observePlannedAttemptExecutorStateUnserialized = Effect.fn(
  "PlannedAttemptExecutorWorkflow.observeStateUnserialized"
)(function* (plannedAttempt: PlannedTaskAttempt) {
  const journal = yield* InRunJournal
  const executor = yield* PlannedAttemptExecutor
  const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
  const records = yield* journal.read(plannedAttempt.runId)
  const responsibility = records.find(
    ({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
      event.plannedAttempt.attemptId === plannedAttempt.attemptId
  )
  if (responsibility?.event._tag !== "PlannedAttemptExecutorWorkResponsibilityBegan") {
    return yield* new PlannedAttemptExecutorResponsibilityMissing({ correlation })
  }
  if (!plannedTaskAttemptEquivalence(responsibility.event.plannedAttempt, plannedAttempt)) {
    return yield* new PlannedAttemptExecutorResponsibilityContradiction({
      accepted: responsibility.event.plannedAttempt,
      requested: plannedAttempt
    })
  }
  const unsettledCommand = latestUnsettledPlannedAttemptExecutorCommand(records, plannedAttempt)
  if (unsettledCommand !== undefined) {
    return yield* new PlannedAttemptExecutorCommandReconciliationRequired({
      commandOrdinal: unsettledCommand.ordinal,
      correlation
    })
  }
  const observationOrdinal = PlannedAttemptExecutorStateObservationOrdinal.make(
    records.filter(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorStateObserved" &&
        event.plannedAttempt.attemptId === plannedAttempt.attemptId
    ).length + 1
  )
  const projected = yield* executor.project(correlation)
  const invalidProjection = validatePlannedAttemptExecutorProjectionCorrelation(projected, correlation)
  if (invalidProjection !== undefined) {
    return yield* invalidProjection
  }
  const recordObservation = (observation: PlannedAttemptExecutorStateObservation) =>
    journal.append(
      plannedAttempt.runId,
      plannedAttemptExecutorStateObservedRecordKey(plannedAttempt.attemptId, observationOrdinal),
      PlannedAttemptExecutorStateObservedEvent.make({
        observation,
        occurrenceClassification: "NonActionOccurrence",
        ordinal: observationOrdinal,
        plannedAttempt,
        version: workflowJournalEventVersion
      })
    )
  return yield* Match.valueTags(projected, {
    CorrelationContradiction: ({ observed }) =>
      recordObservation(
        PlannedAttemptExecutorStateObservation.cases.ExecutorReportContradiction.make({ observed })
      ).pipe(
        Effect.andThen(
          new PlannedAttemptExecutorCorrelationMismatch({ expected: correlation, observed: observed.correlation })
        )
      ),
    Exact: ({ report }) =>
      recordObservation(PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({ report })).pipe(
        Effect.as(report)
      ),
    NoReport: () =>
      recordObservation(PlannedAttemptExecutorStateObservation.cases.ExecutorStateNoCurrentReport.make({})).pipe(
        Effect.andThen(new PlannedAttemptExecutorStateNoCurrentReport({ correlation }))
      ),
    TemporarilyUnavailable: () =>
      recordObservation(PlannedAttemptExecutorStateObservation.cases.ExecutorStateTemporarilyUnavailable.make({})).pipe(
        Effect.andThen(new PlannedAttemptExecutorStateTemporarilyUnavailable({ correlation }))
      ),
    Unreadable: () =>
      recordObservation(PlannedAttemptExecutorStateObservation.cases.ExecutorStateUnreadable.make({})).pipe(
        Effect.andThen(new PlannedAttemptExecutorStateUnreadable({ correlation }))
      )
  })
})

export const observePlannedAttemptExecutorStateWithPermit = (
  permit: PlannedAttemptProtocolPermit,
  plannedAttempt: PlannedTaskAttempt
) =>
  withPlannedAttemptProtocolPermit(
    permit,
    plannedAttemptExecutorCorrelation(plannedAttempt),
    observePlannedAttemptExecutorStateUnserialized(plannedAttempt)
  )

/** Reconciles one ambiguous command first; otherwise observes the executor without issuing a command. */
export const reconcileOrObservePlannedAttemptExecutorStateWithPermit = (
  permit: PlannedAttemptProtocolPermit,
  plannedAttempt: PlannedTaskAttempt
) =>
  withPlannedAttemptProtocolPermit(
    permit,
    plannedAttemptExecutorCorrelation(plannedAttempt),
    Effect.gen(function* () {
      const journal = yield* InRunJournal
      const records = yield* journal.read(plannedAttempt.runId)
      const unsettledCommand = latestUnsettledPlannedAttemptExecutorCommand(records, plannedAttempt)
      return unsettledCommand === undefined
        ? yield* observePlannedAttemptExecutorStateUnserialized(plannedAttempt)
        : yield* reconcileUnsettledCommand(records, plannedAttempt, unsettledCommand)
    })
  )
