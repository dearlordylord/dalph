import {
  type PlannedAttemptExecutorReport,
  type PlannedTaskAttempt,
  plannedTaskAttemptEquivalence,
  samePlannedAttemptExecutorReport
} from "@dalph/contracts"
import type { JournalPosition } from "../../../workflow-journal/identity.js"
import {
  plannedAttemptExecutorCommandIntendedRecordKey,
  plannedAttemptExecutorCommandProjectionObservedRecordKey,
  plannedAttemptExecutorCommandResponseObservedRecordKey,
  plannedAttemptExecutorStateObservedRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey
} from "../../../workflow-journal/record-key.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import {
  PlannedAttemptExecutorBeginReportContradiction,
  PlannedAttemptExecutorInitialReportCausalityContradiction,
  PlannedAttemptExecutorLifecycleTransitionContradiction,
  PlannedAttemptExecutorTerminalReportContradiction
} from "./errors.js"
import type { PlannedAttemptExecutorCommandOrdinal } from "./events.js"

const lastElementOffset = -1

type PlannedAttemptExecutorWorkReportedRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "PlannedAttemptExecutorWorkReported" }>
}

export const acceptedPlannedAttemptExecutorReportRecords = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt
) =>
  records.filter(
    (record): record is PlannedAttemptExecutorWorkReportedRecord =>
      record.event._tag === "PlannedAttemptExecutorWorkReported" &&
      record.event.report.correlation.runId === plannedAttempt.runId &&
      record.event.report.correlation.attemptId === plannedAttempt.attemptId
  )

const exactAttemptCommand = (
  record: JournalRecord,
  plannedAttempt: PlannedTaskAttempt,
  commandOrdinal: PlannedAttemptExecutorCommandOrdinal,
  command: "Begin" | "Resume"
): boolean => {
  const event = record.event
  return (
    record.runId === plannedAttempt.runId &&
    event._tag === "PlannedAttemptExecutorCommandIntended" &&
    record.key === plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, commandOrdinal) &&
    event.command === command &&
    event.ordinal === commandOrdinal &&
    plannedTaskAttemptEquivalence(event.plannedAttempt, plannedAttempt)
  )
}

interface ExactCommandSettlement {
  readonly commandOrdinal: PlannedAttemptExecutorCommandOrdinal
  readonly report: PlannedAttemptExecutorReport
}

const exactCommandResponseSettlement = (
  record: JournalRecord,
  plannedAttempt: PlannedTaskAttempt
): ExactCommandSettlement | undefined => {
  const event = record.event
  return record.runId === plannedAttempt.runId &&
    event._tag === "PlannedAttemptExecutorCommandResponseObserved" &&
    plannedTaskAttemptEquivalence(event.plannedAttempt, plannedAttempt) &&
    record.key ===
      plannedAttemptExecutorCommandResponseObservedRecordKey(plannedAttempt.attemptId, event.commandOrdinal)
    ? { commandOrdinal: event.commandOrdinal, report: event.report }
    : undefined
}

const exactCommandProjectionSettlement = (
  record: JournalRecord,
  plannedAttempt: PlannedTaskAttempt
): ExactCommandSettlement | undefined => {
  const event = record.event
  return record.runId === plannedAttempt.runId &&
    event._tag === "PlannedAttemptExecutorCommandProjectionObserved" &&
    plannedTaskAttemptEquivalence(event.plannedAttempt, plannedAttempt) &&
    record.key ===
      plannedAttemptExecutorCommandProjectionObservedRecordKey(
        plannedAttempt.attemptId,
        event.commandOrdinal,
        event.projectionOrdinal
      ) &&
    event.observation._tag === "ExactExecutorReport"
    ? { commandOrdinal: event.commandOrdinal, report: event.observation.report }
    : undefined
}

const exactCommandSettlement = (
  record: JournalRecord,
  plannedAttempt: PlannedTaskAttempt
): ExactCommandSettlement | undefined =>
  exactCommandResponseSettlement(record, plannedAttempt) ?? exactCommandProjectionSettlement(record, plannedAttempt)

const exactCommandSettledWith = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  after: JournalPosition | undefined,
  command: "Begin" | "Resume",
  observed: PlannedAttemptExecutorReport
): boolean => {
  const settlement = records.findLast((record) => {
    if (after !== undefined && record.position <= after) return false
    const exact = exactCommandSettlement(record, plannedAttempt)
    return exact !== undefined && samePlannedAttemptExecutorReport(exact.report, observed)
  })
  if (settlement === undefined) return false
  const commandOrdinal = exactCommandSettlement(settlement, plannedAttempt)?.commandOrdinal
  if (commandOrdinal === undefined) return false
  return records.some(
    (record) =>
      (after === undefined || record.position > after) &&
      record.position < settlement.position &&
      exactAttemptCommand(record, plannedAttempt, commandOrdinal, command)
  )
}

const exactSuspendIntendedAfter = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  acceptedExecutingAt: JournalPosition
): boolean =>
  records.some(
    (record) =>
      record.position > acceptedExecutingAt &&
      record.runId === plannedAttempt.runId &&
      record.event._tag === "PlannedAttemptExecutorCommandIntended" &&
      record.key === plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, record.event.ordinal) &&
      record.event.command === "Suspend" &&
      plannedTaskAttemptEquivalence(record.event.plannedAttempt, plannedAttempt)
  )

type PlannedAttemptExecutorLifecycleTransitionError =
  | PlannedAttemptExecutorBeginReportContradiction
  | PlannedAttemptExecutorInitialReportCausalityContradiction
  | PlannedAttemptExecutorLifecycleTransitionContradiction
  | PlannedAttemptExecutorTerminalReportContradiction

const initialLifecycleReportError = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  observed: PlannedAttemptExecutorReport
):
  | PlannedAttemptExecutorBeginReportContradiction
  | PlannedAttemptExecutorInitialReportCausalityContradiction
  | undefined => {
  if (!exactCommandSettledWith(records, plannedAttempt, undefined, "Begin", observed)) {
    return new PlannedAttemptExecutorInitialReportCausalityContradiction({ observed })
  }
  return observed._tag === "ExecutorWorkExecuting"
    ? undefined
    : new PlannedAttemptExecutorBeginReportContradiction({ observed })
}

const distinctAcceptedLifecycleReportError = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  latest: PlannedAttemptExecutorWorkReportedRecord,
  observed: PlannedAttemptExecutorReport
):
  | PlannedAttemptExecutorLifecycleTransitionContradiction
  | PlannedAttemptExecutorTerminalReportContradiction
  | undefined => {
  if (latest.event.report._tag === "ExecutorWorkTerminal") {
    return new PlannedAttemptExecutorTerminalReportContradiction({ accepted: latest.event.report, observed })
  }
  const lacksCausalCommand =
    (latest.event.report._tag === "ExecutorWorkExecuting" &&
      observed._tag === "ExecutorWorkSafelySuspended" &&
      !exactSuspendIntendedAfter(records, plannedAttempt, latest.position)) ||
    (latest.event.report._tag === "ExecutorWorkSafelySuspended" &&
      observed._tag === "ExecutorWorkExecuting" &&
      !exactCommandSettledWith(records, plannedAttempt, latest.position, "Resume", observed))
  return lacksCausalCommand
    ? new PlannedAttemptExecutorLifecycleTransitionContradiction({ accepted: latest.event.report, observed })
    : undefined
}

/** Validates a distinct report against accepted lifecycle authority and exact command causality. */
export const plannedAttemptExecutorLifecycleTransitionError = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  observed: PlannedAttemptExecutorReport
): PlannedAttemptExecutorLifecycleTransitionError | undefined => {
  const latest = acceptedPlannedAttemptExecutorReportRecords(records, plannedAttempt).at(lastElementOffset)
  if (latest?.event._tag !== "PlannedAttemptExecutorWorkReported") {
    return initialLifecycleReportError(records, plannedAttempt, observed)
  }
  if (samePlannedAttemptExecutorReport(latest.event.report, observed)) return undefined
  return distinctAcceptedLifecycleReportError(records, plannedAttempt, latest, observed)
}

const exactReportFromUnacceptedEvidence = (
  record: JournalRecord | undefined,
  plannedAttempt: PlannedTaskAttempt
): PlannedAttemptExecutorReport | undefined => {
  if (record === undefined) return undefined
  const command = exactCommandSettlement(record, plannedAttempt)
  if (command !== undefined) return command.report
  const event = record.event
  return record.runId === plannedAttempt.runId &&
    event._tag === "PlannedAttemptExecutorStateObserved" &&
    plannedTaskAttemptEquivalence(event.plannedAttempt, plannedAttempt) &&
    record.key === plannedAttemptExecutorStateObservedRecordKey(plannedAttempt.attemptId, event.ordinal) &&
    event.observation._tag === "ExactExecutorReport"
    ? event.observation.report
    : undefined
}

const isExecutorEvidenceFor = (record: JournalRecord, plannedAttempt: PlannedTaskAttempt): boolean => {
  const event = record.event
  return (
    (event._tag === "PlannedAttemptExecutorCommandResponseObserved" ||
      event._tag === "PlannedAttemptExecutorCommandResponseContradicted" ||
      event._tag === "PlannedAttemptExecutorCommandProjectionObserved" ||
      event._tag === "PlannedAttemptExecutorStateObserved") &&
    event.plannedAttempt.runId === plannedAttempt.runId &&
    event.plannedAttempt.attemptId === plannedAttempt.attemptId
  )
}

/** Proves every accepted lifecycle report has exact preceding evidence and valid command causality. */
export const hasValidAcceptedPlannedAttemptExecutorLifecycleHistory = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt
): boolean => {
  const accepted = acceptedPlannedAttemptExecutorReportRecords(records, plannedAttempt)
  const firstAccepted = accepted[0]
  if (firstAccepted === undefined) return false
  const responsibilities = records.filter(
    (record) =>
      record.position < firstAccepted.position &&
      record.runId === plannedAttempt.runId &&
      record.key === plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId) &&
      record.event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
      plannedTaskAttemptEquivalence(record.event.plannedAttempt, plannedAttempt)
  )
  if (responsibilities.length !== 1) return false
  return accepted.every((record, index) => {
    const priorAccepted = accepted[index - 1]
    if (
      record.event.ordinal !== index + 1 ||
      record.runId !== plannedAttempt.runId ||
      record.key !== plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, record.event.ordinal)
    ) {
      return false
    }
    const evidence = records.findLast(
      (candidate) =>
        candidate.position < record.position &&
        (priorAccepted === undefined || candidate.position > priorAccepted.position) &&
        isExecutorEvidenceFor(candidate, plannedAttempt)
    )
    const evidenceReport = exactReportFromUnacceptedEvidence(evidence, plannedAttempt)
    if (evidenceReport === undefined || !samePlannedAttemptExecutorReport(evidenceReport, record.event.report)) {
      return false
    }
    const priorRecords = records.filter(({ position }) => position < record.position)
    return (
      plannedAttemptExecutorLifecycleTransitionError(priorRecords, plannedAttempt, record.event.report) === undefined
    )
  })
}
