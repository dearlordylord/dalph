import {
  type PlannedTaskAttempt,
  PlannedAttemptExecutor,
  type PlannedAttemptExecutorCorrelation,
  type PlannedAttemptExecutorRequest,
  plannedAttemptExecutorCorrelation,
  type PlannedAttemptExecutorReport,
  samePlannedAttemptExecutorCorrelation,
  type TaskWorkSpecification
} from "@dalph/contracts"
import { Effect } from "effect"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  plannedAttemptExecutorCommandIntendedRecordKey,
  plannedAttemptExecutorCommandProjectionObservedRecordKey,
  plannedAttemptExecutorCommandResponseContradictedRecordKey,
  plannedAttemptExecutorCommandResponseObservedRecordKey
} from "../../../workflow-journal/record-key.js"
import { InRunJournal, type JournalRecord } from "../../../workflow-journal/store.js"
import {
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorCommandProjectionObservedEvent,
  PlannedAttemptExecutorCommandProjectionObservation,
  PlannedAttemptExecutorCommandProjectionOrdinal,
  PlannedAttemptExecutorCommandResponseContradictedEvent,
  PlannedAttemptExecutorCommandResponseObservedEvent,
  type PlannedAttemptExecutorSuspensionLimit
} from "./events.js"
import {
  currentUnconsumedAcceptedSafeEvidence,
  latestPlannedAttemptExecutorEvidence,
  latestUnsettledPlannedAttemptExecutorCommand,
  plannedAttemptExecutorEvidence,
  plannedAttemptExecutorRequestFor
} from "./evidence.js"
import type { PlannedAttemptProtocolPermit } from "./protocol-controller.js"
import {
  PlannedAttemptExecutorAlreadyBegan,
  PlannedAttemptExecutorCorrelationMismatch,
  PlannedAttemptExecutorInitializationCorrelationContradiction,
  PlannedAttemptExecutorProjectionNoCurrentReport,
  PlannedAttemptExecutorProjectionTemporarilyUnavailable,
  PlannedAttemptExecutorProjectionUnreadable,
  PlannedAttemptExecutorResumeNotAuthorized,
  PlannedAttemptExecutorResumeInvalidatedByTerminalChoice,
  PlannedAttemptExecutorSuspensionNotAuthorized,
  PlannedAttemptExecutorSuspensionLimitReached,
  PlannedAttemptExecutorWorkAlreadyTerminal,
  validatePlannedAttemptExecutorProjectionCorrelation
} from "./errors.js"
import {
  acceptedPlannedAttemptExecutorReportRecords,
  acceptDistinctPlannedAttemptExecutorReport,
  acceptPendingPlannedAttemptExecutorReport
} from "./report-acceptance.js"
import { beginPlannedAttemptExecutorResponsibility } from "./responsibility.js"
import { appliedTerminalChoiceFor } from "../attempt-choice/terminal-choice-authority.js"

const lastElementOffset = -1

export const reconcileUnsettledPlannedAttemptExecutorCommand = Effect.fn(
  "PlannedAttemptExecutorWorkflow.reconcileUnsettledCommand"
)(function* (
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
  const projected = yield* executor.observe(correlation, { _tag: "ReconcileCommand", command: intent.command })
  const invalidProjection = validatePlannedAttemptExecutorProjectionCorrelation(projected, correlation)
  if (invalidProjection !== undefined) return yield* invalidProjection
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
  if (projected._tag === "InitializationCorrelationContradiction") {
    return yield* new PlannedAttemptExecutorInitializationCorrelationContradiction({
      correlation,
      detail: projected.detail
    })
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
  yield* acceptDistinctPlannedAttemptExecutorReport(plannedAttempt, projectedReport)
  return projectedReport
})

const commandLimitError = (
  command: "Begin" | "Resume" | "Suspend",
  correlation: PlannedAttemptExecutorCorrelation,
  suspensionCommandCount: number,
  suspensionLimit: PlannedAttemptExecutorSuspensionLimit
): PlannedAttemptExecutorSuspensionLimitReached | undefined =>
  command === "Suspend" && suspensionCommandCount >= suspensionLimit
    ? new PlannedAttemptExecutorSuspensionLimitReached({ correlation, limit: suspensionLimit })
    : undefined

type PlannedAttemptExecutorCommand = "Begin" | "Resume" | "Suspend"

const commandCountSinceLatestSafeSuspension = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  candidate: PlannedAttemptExecutorCommand
): number => {
  const latestSafeSuspensionPosition = plannedAttemptExecutorEvidence(records, plannedAttempt).findLast(
    ({ report, source }) => source._tag === "AcceptedReport" && report._tag === "ExecutorWorkSafelySuspended"
  )?.observedAt
  return records.filter(
    ({ event, position }) =>
      (latestSafeSuspensionPosition === undefined || position > latestSafeSuspensionPosition) &&
      event._tag === "PlannedAttemptExecutorCommandIntended" &&
      event.command === candidate &&
      event.plannedAttempt.runId === plannedAttempt.runId &&
      event.plannedAttempt.attemptId === plannedAttempt.attemptId
  ).length
}

const initialResumeAuthorityError = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  command: PlannedAttemptExecutorCommand,
  correlation: PlannedAttemptExecutorCorrelation
): PlannedAttemptExecutorResumeInvalidatedByTerminalChoice | undefined => {
  if (command !== "Resume") return undefined
  const terminalChoice = appliedTerminalChoiceFor(records, plannedAttempt)
  return terminalChoice === undefined
    ? undefined
    : new PlannedAttemptExecutorResumeInvalidatedByTerminalChoice({ choice: terminalChoice.event.choice, correlation })
}

const terminalCommandAuthorityError = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  correlation: PlannedAttemptExecutorCorrelation
): PlannedAttemptExecutorWorkAlreadyTerminal | undefined => {
  const latestAcceptedReport = acceptedPlannedAttemptExecutorReportRecords(records, plannedAttempt).at(
    lastElementOffset
  )
  return latestAcceptedReport?.event._tag === "PlannedAttemptExecutorWorkReported" &&
    latestAcceptedReport.event.report._tag === "ExecutorWorkTerminal"
    ? new PlannedAttemptExecutorWorkAlreadyTerminal({ correlation })
    : undefined
}

const repeatedBeginCommandError = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  command: PlannedAttemptExecutorCommand,
  correlation: PlannedAttemptExecutorCorrelation
): PlannedAttemptExecutorAlreadyBegan | undefined =>
  command === "Begin" &&
  records.some(
    ({ event }) =>
      event._tag === "PlannedAttemptExecutorCommandIntended" &&
      event.command === "Begin" &&
      event.plannedAttempt.attemptId === plannedAttempt.attemptId
  )
    ? new PlannedAttemptExecutorAlreadyBegan({ correlation })
    : undefined

const resumeCommandAuthorityError = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  command: PlannedAttemptExecutorCommand,
  correlation: PlannedAttemptExecutorCorrelation
): PlannedAttemptExecutorResumeNotAuthorized | undefined =>
  command === "Resume" && currentUnconsumedAcceptedSafeEvidence(records, plannedAttempt) === undefined
    ? new PlannedAttemptExecutorResumeNotAuthorized({ correlation })
    : undefined

const suspendCommandAuthorityError = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  command: PlannedAttemptExecutorCommand,
  correlation: PlannedAttemptExecutorCorrelation
): PlannedAttemptExecutorSuspensionNotAuthorized | undefined => {
  if (command !== "Suspend") return undefined
  const latestExecutorEvidence = latestPlannedAttemptExecutorEvidence(records, plannedAttempt)
  return latestExecutorEvidence?.source._tag !== "AcceptedReport" ||
    latestExecutorEvidence.report._tag !== "ExecutorWorkExecuting"
    ? new PlannedAttemptExecutorSuspensionNotAuthorized({ correlation })
    : undefined
}

const settledCommandAuthorityError = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  command: PlannedAttemptExecutorCommand,
  correlation: PlannedAttemptExecutorCorrelation,
  suspensionLimit: PlannedAttemptExecutorSuspensionLimit
) =>
  terminalCommandAuthorityError(records, plannedAttempt, correlation) ??
  repeatedBeginCommandError(records, plannedAttempt, command, correlation) ??
  resumeCommandAuthorityError(records, plannedAttempt, command, correlation) ??
  suspendCommandAuthorityError(records, plannedAttempt, command, correlation) ??
  commandLimitError(
    command,
    correlation,
    commandCountSinceLatestSafeSuspension(records, plannedAttempt, "Suspend"),
    suspensionLimit
  )

const nextCommandOrdinal = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt
): PlannedAttemptExecutorCommandOrdinal =>
  PlannedAttemptExecutorCommandOrdinal.make(
    records.filter(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorCommandIntended" &&
        event.plannedAttempt.attemptId === plannedAttempt.attemptId
    ).length + 1
  )

const appendPlannedAttemptExecutorCommandIntent = Effect.fn("PlannedAttemptExecutorWorkflow.appendCommandIntent")(
  function* (
    plannedAttempt: PlannedTaskAttempt,
    command: PlannedAttemptExecutorCommand,
    commandOrdinal: PlannedAttemptExecutorCommandOrdinal
  ) {
    const journal = yield* InRunJournal
    const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
    if (command === "Resume") {
      const currentRecords = yield* journal.read(plannedAttempt.runId)
      const currentTerminalChoice = appliedTerminalChoiceFor(currentRecords, plannedAttempt)
      if (currentTerminalChoice !== undefined) {
        return yield* new PlannedAttemptExecutorResumeInvalidatedByTerminalChoice({
          choice: currentTerminalChoice.event.choice,
          correlation
        })
      }
      if (currentUnconsumedAcceptedSafeEvidence(currentRecords, plannedAttempt) === undefined) {
        return yield* new PlannedAttemptExecutorResumeNotAuthorized({ correlation })
      }
    }
    return yield* journal.append(
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
  }
)

type PlannedAttemptExecutorCommandInvocation =
  | { readonly _tag: "Begin"; readonly request: PlannedAttemptExecutorRequest }
  | { readonly _tag: "Resume"; readonly request: PlannedAttemptExecutorRequest }
  | { readonly _tag: "Suspend" }

const issuePlannedAttemptExecutorCommand = Effect.fn("PlannedAttemptExecutorWorkflow.issueCommand")(function* (
  plannedAttempt: PlannedTaskAttempt,
  invocation: PlannedAttemptExecutorCommandInvocation
) {
  const executor = yield* PlannedAttemptExecutor
  if (invocation._tag === "Suspend") return yield* executor.requestSuspension(plannedAttempt)
  return invocation._tag === "Begin"
    ? yield* executor.begin(invocation.request)
    : yield* executor.resume(invocation.request)
})

const recordPlannedAttemptExecutorCommandResponse = Effect.fn("PlannedAttemptExecutorWorkflow.recordCommandResponse")(
  function* (
    plannedAttempt: PlannedTaskAttempt,
    commandOrdinal: PlannedAttemptExecutorCommandOrdinal,
    report: PlannedAttemptExecutorReport
  ) {
    const journal = yield* InRunJournal
    const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
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
      return yield* new PlannedAttemptExecutorCorrelationMismatch({
        expected: correlation,
        observed: report.correlation
      })
    }
    yield* journal.append(
      plannedAttempt.runId,
      plannedAttemptExecutorCommandResponseObservedRecordKey(plannedAttempt.attemptId, commandOrdinal),
      PlannedAttemptExecutorCommandResponseObservedEvent.make({
        commandOrdinal,
        occurrenceClassification: "NonActionOccurrence",
        plannedAttempt,
        report,
        version: workflowJournalEventVersion
      })
    )
    yield* acceptDistinctPlannedAttemptExecutorReport(plannedAttempt, report)
    return report
  }
)

/** Journal-first executor command primitive used by guarded protocol entry points. */
export const runPlannedAttemptExecutorCommand = Effect.fn("PlannedAttemptExecutorWorkflow.runCommand")(function* (
  permit: PlannedAttemptProtocolPermit,
  plannedAttempt: PlannedTaskAttempt,
  command: "Begin" | "Resume" | "Suspend",
  suspensionLimit: PlannedAttemptExecutorSuspensionLimit,
  selectedSpecification?: TaskWorkSpecification
) {
  const journal = yield* InRunJournal
  const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
  yield* beginPlannedAttemptExecutorResponsibility(plannedAttempt)
  const records = yield* journal.read(plannedAttempt.runId)
  const initialResumeError = initialResumeAuthorityError(records, plannedAttempt, command, correlation)
  if (initialResumeError !== undefined) return yield* initialResumeError
  const unsettledCommand = latestUnsettledPlannedAttemptExecutorCommand(records, plannedAttempt)
  if (unsettledCommand !== undefined) {
    return yield* reconcileUnsettledPlannedAttemptExecutorCommand(records, plannedAttempt, unsettledCommand)
  }
  const pendingReport = yield* acceptPendingPlannedAttemptExecutorReport(plannedAttempt)
  if (pendingReport !== undefined) return pendingReport
  const authorityError = settledCommandAuthorityError(records, plannedAttempt, command, correlation, suspensionLimit)
  if (authorityError !== undefined) return yield* authorityError
  const commandOrdinal = nextCommandOrdinal(records, plannedAttempt)
  const invocation: PlannedAttemptExecutorCommandInvocation =
    command === "Suspend"
      ? { _tag: "Suspend" }
      : {
          _tag: command,
          request: yield* plannedAttemptExecutorRequestFor(records, plannedAttempt, selectedSpecification)
        }
  yield* permit.commitIntent(appendPlannedAttemptExecutorCommandIntent(plannedAttempt, command, commandOrdinal))
  const report = yield* issuePlannedAttemptExecutorCommand(plannedAttempt, invocation)
  return yield* recordPlannedAttemptExecutorCommandResponse(plannedAttempt, commandOrdinal, report)
})
