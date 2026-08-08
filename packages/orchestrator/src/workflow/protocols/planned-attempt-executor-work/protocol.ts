import { Effect, Option, Schema } from "effect"
import {
  type PlannedTaskAttempt,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorCorrelation,
  plannedAttemptExecutorCorrelation,
  type PlannedAttemptExecutorReport,
  plannedTaskAttemptEquivalence,
  PlannedTaskAttempt as PlannedTaskAttemptSchema
} from "@dalph/contracts"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  plannedAttemptExecutorCommandIntendedRecordKey,
  plannedAttemptExecutorCommandProjectionObservedRecordKey,
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
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorStateObservedEvent,
  PlannedAttemptExecutorStateObservation,
  PlannedAttemptExecutorStateObservationOrdinal,
  PlannedAttemptExecutorContinuationLimit,
  defaultPlannedAttemptExecutorContinuationLimit,
  defaultPlannedAttemptExecutorSuspensionLimit,
  PlannedAttemptExecutorSuspensionLimit,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "./events.js"
import { plannedAttemptExecutorEvidence } from "./evidence.js"

/** An executor response named a different planned attempt than Dalph requested. */
export class PlannedAttemptExecutorCorrelationMismatch extends Schema.TaggedErrorClass<PlannedAttemptExecutorCorrelationMismatch>()(
  "PlannedAttemptExecutorCorrelationMismatch",
  { expected: PlannedAttemptExecutorCorrelation, observed: PlannedAttemptExecutorCorrelation }
) {}

/** The exact attempt consumed its durable start-or-continue budget while the executor still reported Running. */
export class PlannedAttemptExecutorContinuationLimitReached extends Schema.TaggedErrorClass<PlannedAttemptExecutorContinuationLimitReached>()(
  "PlannedAttemptExecutorContinuationLimitReached",
  { correlation: PlannedAttemptExecutorCorrelation, limit: PlannedAttemptExecutorContinuationLimit }
) {}

/** The exact attempt consumed its durable suspension-command budget without proving quiescence. */
export class PlannedAttemptExecutorSuspensionLimitReached extends Schema.TaggedErrorClass<PlannedAttemptExecutorSuspensionLimitReached>()(
  "PlannedAttemptExecutorSuspensionLimitReached",
  { correlation: PlannedAttemptExecutorCorrelation, limit: PlannedAttemptExecutorSuspensionLimit }
) {}

/** Read-only reconciliation could not find authoritative state for one unmatched command intent. */
export class PlannedAttemptExecutorProjectionUnavailable extends Schema.TaggedErrorClass<PlannedAttemptExecutorProjectionUnavailable>()(
  "PlannedAttemptExecutorProjectionUnavailable",
  { commandOrdinal: PlannedAttemptExecutorCommandOrdinal, correlation: PlannedAttemptExecutorCorrelation }
) {}

/** A generic current-state read cannot bypass reconciliation of an ambiguous executor command. */
export class PlannedAttemptExecutorCommandReconciliationRequired extends Schema.TaggedErrorClass<PlannedAttemptExecutorCommandReconciliationRequired>()(
  "PlannedAttemptExecutorCommandReconciliationRequired",
  { commandOrdinal: PlannedAttemptExecutorCommandOrdinal, correlation: PlannedAttemptExecutorCorrelation }
) {}

/** A current-state read found no authoritative executor state for the exact attempt. */
export class PlannedAttemptExecutorStateUnavailable extends Schema.TaggedErrorClass<PlannedAttemptExecutorStateUnavailable>()(
  "PlannedAttemptExecutorStateUnavailable",
  { correlation: PlannedAttemptExecutorCorrelation }
) {}

/** A journaled responsibility uses this identity for a different immutable attempt plan. */
export class PlannedAttemptExecutorResponsibilityContradiction extends Schema.TaggedErrorClass<PlannedAttemptExecutorResponsibilityContradiction>()(
  "PlannedAttemptExecutorResponsibilityContradiction",
  { accepted: PlannedTaskAttemptSchema, requested: PlannedTaskAttemptSchema }
) {}

/** A read-only executor observation has no exact journaled workflow responsibility to observe. */
export class PlannedAttemptExecutorResponsibilityMissing extends Schema.TaggedErrorClass<PlannedAttemptExecutorResponsibilityMissing>()(
  "PlannedAttemptExecutorResponsibilityMissing",
  { correlation: PlannedAttemptExecutorCorrelation }
) {}

const sameCorrelation = (left: PlannedAttemptExecutorCorrelation, right: PlannedAttemptExecutorCorrelation): boolean =>
  left.attemptId === right.attemptId && left.runId === right.runId

const latestUnsettledExecutorCommand = (records: ReadonlyArray<JournalRecord>, plannedAttempt: PlannedTaskAttempt) => {
  const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
  const command = records.findLast(
    ({ event }) =>
      event._tag === "PlannedAttemptExecutorCommandIntended" &&
      event.plannedAttempt.runId === plannedAttempt.runId &&
      event.plannedAttempt.attemptId === plannedAttempt.attemptId
  )
  if (command?.event._tag !== "PlannedAttemptExecutorCommandIntended") return undefined
  const commandEvent = command.event
  const settled = records.some(({ event, position }) => {
    if (position <= command.position) return false
    if (event._tag === "PlannedAttemptExecutorWorkReported") {
      return sameCorrelation(correlation, event.report.correlation)
    }
    return (
      event._tag === "PlannedAttemptExecutorCommandProjectionObserved" &&
      event.commandOrdinal === commandEvent.ordinal &&
      event.observation._tag === "ExactExecutorReport" &&
      sameCorrelation(correlation, event.observation.report.correlation)
    )
  })
  return settled ? undefined : commandEvent
}

/** Records ownership before any adapter records a command intent or crosses the executor boundary. */
export const beginPlannedAttemptExecutorResponsibility = Effect.fn(
  "PlannedAttemptExecutorWorkflow.beginResponsibility"
)(function* (plannedAttempt: PlannedTaskAttempt) {
  const journal = yield* InRunJournal
  const records = yield* journal.read(plannedAttempt.runId)
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
  const acceptedReports = reports.filter((report) => sameCorrelation(correlation, report.correlation))
  const lastSafeSuspension = acceptedReports.findLastIndex(({ _tag }) => _tag === "SafelySuspended")
  const runningSinceSafeSuspension = acceptedReports
    .slice(lastSafeSuspension + 1)
    .filter(({ _tag }) => _tag === "Running")
  return (durableCommandCount ?? runningSinceSafeSuspension.length) >= continuationLimit
    ? { _tag: "ExecutorContinuationLimitReached", limit: continuationLimit }
    : { _tag: "ExecutorContinuationAvailable" }
}

const runCommand = Effect.fn("PlannedAttemptExecutorWorkflow.runCommand")(function* (
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
      event._tag === "PlannedAttemptExecutorWorkReported" && sameCorrelation(correlation, event.report.correlation)
  )
  const acceptedReports = acceptedReportRecords.flatMap(({ event }) =>
    event._tag === "PlannedAttemptExecutorWorkReported" && sameCorrelation(correlation, event.report.correlation)
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
  const unsettledCommand = latestUnsettledExecutorCommand(records, plannedAttempt)
  if (unsettledCommand !== undefined) {
    const intent = unsettledCommand
    const projectionOrdinal = PlannedAttemptExecutorCommandProjectionOrdinal.make(
      records.filter(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorCommandProjectionObserved" &&
          event.plannedAttempt.attemptId === plannedAttempt.attemptId &&
          event.commandOrdinal === intent.ordinal
      ).length + 1
    )
    const projected = yield* executor.project(correlation)
    if (Option.isNone(projected)) {
      yield* journal.append(
        plannedAttempt.runId,
        plannedAttemptExecutorCommandProjectionObservedRecordKey(
          plannedAttempt.attemptId,
          intent.ordinal,
          projectionOrdinal
        ),
        PlannedAttemptExecutorCommandProjectionObservedEvent.make({
          commandOrdinal: intent.ordinal,
          observation: PlannedAttemptExecutorCommandProjectionObservation.cases.ExecutorStateUnavailable.make({}),
          occurrenceClassification: "NonActionOccurrence",
          plannedAttempt,
          projectionOrdinal,
          version: workflowJournalEventVersion
        })
      )
      return yield* new PlannedAttemptExecutorProjectionUnavailable({ commandOrdinal: intent.ordinal, correlation })
    }
    const projectedReport = projected.value
    if (!sameCorrelation(correlation, projectedReport.correlation)) {
      yield* journal.append(
        plannedAttempt.runId,
        plannedAttemptExecutorCommandProjectionObservedRecordKey(
          plannedAttempt.attemptId,
          intent.ordinal,
          projectionOrdinal
        ),
        PlannedAttemptExecutorCommandProjectionObservedEvent.make({
          commandOrdinal: intent.ordinal,
          observation: PlannedAttemptExecutorCommandProjectionObservation.cases.ExecutorReportContradiction.make({
            observed: projectedReport
          }),
          occurrenceClassification: "NonActionOccurrence",
          plannedAttempt,
          projectionOrdinal,
          version: workflowJournalEventVersion
        })
      )
      return yield* new PlannedAttemptExecutorCorrelationMismatch({
        expected: correlation,
        observed: projectedReport.correlation
      })
    }
    yield* journal.append(
      plannedAttempt.runId,
      plannedAttemptExecutorCommandProjectionObservedRecordKey(
        plannedAttempt.attemptId,
        intent.ordinal,
        projectionOrdinal
      ),
      PlannedAttemptExecutorCommandProjectionObservedEvent.make({
        commandOrdinal: intent.ordinal,
        observation: PlannedAttemptExecutorCommandProjectionObservation.cases.ExactExecutorReport.make({
          report: projectedReport
        }),
        occurrenceClassification: "NonActionOccurrence",
        plannedAttempt,
        projectionOrdinal,
        version: workflowJournalEventVersion
      })
    )
    return projectedReport
  }
  const continuation = plannedAttemptExecutorContinuationDisposition(
    correlation,
    acceptedReports,
    continuationLimit,
    commandCountSinceSafeSuspension("StartOrContinue")
  )
  if (command === "StartOrContinue" && continuation._tag === "ExecutorContinuationLimitReached") {
    return yield* new PlannedAttemptExecutorContinuationLimitReached({ correlation, limit: continuation.limit })
  }
  const suspensionCommandCount = commandCountSinceSafeSuspension("Suspend")
  if (command === "Suspend" && suspensionCommandCount >= suspensionLimit) {
    return yield* new PlannedAttemptExecutorSuspensionLimitReached({ correlation, limit: suspensionLimit })
  }
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
  if (!sameCorrelation(correlation, report.correlation)) {
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
export const observePlannedAttemptExecutorState = Effect.fn("PlannedAttemptExecutorWorkflow.observeState")(function* (
  plannedAttempt: PlannedTaskAttempt
) {
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
  const unsettledCommand = latestUnsettledExecutorCommand(records, plannedAttempt)
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
  if (Option.isNone(projected)) {
    yield* journal.append(
      plannedAttempt.runId,
      plannedAttemptExecutorStateObservedRecordKey(plannedAttempt.attemptId, observationOrdinal),
      PlannedAttemptExecutorStateObservedEvent.make({
        observation: PlannedAttemptExecutorStateObservation.cases.ExecutorStateUnavailable.make({}),
        occurrenceClassification: "NonActionOccurrence",
        ordinal: observationOrdinal,
        plannedAttempt,
        version: workflowJournalEventVersion
      })
    )
    return yield* new PlannedAttemptExecutorStateUnavailable({ correlation })
  }
  const report = projected.value
  if (!sameCorrelation(correlation, report.correlation)) {
    yield* journal.append(
      plannedAttempt.runId,
      plannedAttemptExecutorStateObservedRecordKey(plannedAttempt.attemptId, observationOrdinal),
      PlannedAttemptExecutorStateObservedEvent.make({
        observation: PlannedAttemptExecutorStateObservation.cases.ExecutorReportContradiction.make({
          observed: report
        }),
        occurrenceClassification: "NonActionOccurrence",
        ordinal: observationOrdinal,
        plannedAttempt,
        version: workflowJournalEventVersion
      })
    )
    return yield* new PlannedAttemptExecutorCorrelationMismatch({ expected: correlation, observed: report.correlation })
  }
  yield* journal.append(
    plannedAttempt.runId,
    plannedAttemptExecutorStateObservedRecordKey(plannedAttempt.attemptId, observationOrdinal),
    PlannedAttemptExecutorStateObservedEvent.make({
      observation: PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({ report }),
      occurrenceClassification: "NonActionOccurrence",
      ordinal: observationOrdinal,
      plannedAttempt,
      version: workflowJournalEventVersion
    })
  )
  return report
})

/** Starts or resumes all executor work for the exact planned attempt. */
export const continuePlannedAttemptExecutorWork = (
  plannedAttempt: PlannedTaskAttempt,
  continuationLimit = defaultPlannedAttemptExecutorContinuationLimit
) => runCommand(plannedAttempt, "StartOrContinue", continuationLimit, defaultPlannedAttemptExecutorSuspensionLimit)

/** Asks the executor to stop all work while preserving the exact attempt for resume. */
export const requestPlannedAttemptExecutorSuspension = (
  plannedAttempt: PlannedTaskAttempt,
  suspensionLimit = defaultPlannedAttemptExecutorSuspensionLimit
) => runCommand(plannedAttempt, "Suspend", defaultPlannedAttemptExecutorContinuationLimit, suspensionLimit)
