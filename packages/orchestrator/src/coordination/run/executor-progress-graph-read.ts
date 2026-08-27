import {
  PlannedAttemptExecutorCorrelation as PlannedAttemptExecutorCorrelationSchema,
  plannedAttemptExecutorCorrelation,
  samePlannedAttemptExecutorCorrelation,
  type PlannedAttemptExecutorCorrelation,
  type PlannedAttemptExecutorReport,
  type PlannedTaskAttempt,
  type RunId,
  type TaskId
} from "@dalph/contracts"
import { exactTaskIdSetKey, taskTrackerTargetKey, type TrackerTarget } from "../../authorities/task-tracker/target.js"
import { plannedAttemptExecutorContinuationDisposition } from "../../workflow/protocols/planned-attempt-executor-work/protocol.js"
import {
  defaultPlannedAttemptExecutorContinuationLimit,
  type PlannedAttemptExecutorContinuationLimit
} from "../../workflow/protocols/planned-attempt-executor-work/events.js"
import type { OperationId } from "../../workflow/identity.js"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { JournalRecord } from "../../workflow-journal/store.js"

/** One accepted Running report that a later complete graph read must cover. */
export interface ExecutorProgressReport {
  readonly acceptedAt: JournalPosition
  readonly correlation: PlannedAttemptExecutorCorrelation
  readonly taskId: TaskId
}

/** The only tracker outcomes that can be attached to a complete graph-read observation. */
export const executorProgressGraphReadOutcomeLiterals = ["Complete", "Unchanged", "Failed"] as const
export type ExecutorProgressGraphReadOutcome = (typeof executorProgressGraphReadOutcomeLiterals)[number]

/** The outcome of one complete-graph read intent, with its position inseparable from the outcome. */
export type ExecutorProgressGraphReadObservation =
  | { readonly _tag: "Unresolved" }
  | {
      readonly _tag: "Observed"
      readonly outcome: ExecutorProgressGraphReadOutcome
      readonly observedAt: JournalPosition
    }

/** One complete-graph read intent and its run-scoped observation envelope. */
export interface ExecutorProgressGraphRead {
  readonly explicitlyCoveredTaskIds: ReadonlyArray<TaskId>
  readonly intentAt: JournalPosition
  readonly observation: ExecutorProgressGraphReadObservation
  readonly operationId: OperationId
  /** Exact accepted reports named by the graph operation. */
  readonly pendingReports: ReadonlyArray<ExecutorProgressReport>
  readonly runId: RunId
  readonly target: TrackerTarget
}

/** One executor command intent used only to reconstruct the existing continuation budget. */
export interface ExecutorProgressCommand {
  readonly command: "StartOrContinue" | "Suspend"
  readonly correlation: PlannedAttemptExecutorCorrelation
  readonly intendedAt: JournalPosition
}

/** One accepted report retained as a journal-derived input to requirement reconstruction. */
export interface ExecutorProgressAcceptedReport {
  readonly acceptedAt: JournalPosition
  readonly correlation: PlannedAttemptExecutorCorrelation
  readonly report: PlannedAttemptExecutorReport
  readonly taskId: TaskId
}

/** Durable inputs from which the process-local progress-read requirement is rebuilt. */
export interface ExecutorProgressGraphReadDerivationInput {
  readonly commands: ReadonlyArray<ExecutorProgressCommand>
  readonly continuationLimit?: PlannedAttemptExecutorContinuationLimit
  readonly graphReads: ReadonlyArray<ExecutorProgressGraphRead>
  readonly reports: ReadonlyArray<ExecutorProgressAcceptedReport>
  readonly runId: RunId
  readonly target: TrackerTarget
}

/**
 * Process-local requirement to check current tracker facts before continuing
 * exact executor work. It is reconstructed from accepted journal facts and is
 * deliberately not a workflow-journal event or a provider wakeup.
 */
export interface ExecutorProgressGraphReadRequirement {
  readonly _tag: "ExecutorProgressGraphReadRequirement"
  /** Exact task subjects the one complete read must explicitly cover. */
  readonly explicitlyCoveredTaskIds: readonly [TaskId, ...ReadonlyArray<TaskId>]
  readonly pendingReports: readonly [ExecutorProgressReport, ...ReadonlyArray<ExecutorProgressReport>]
  readonly runId: RunId
  readonly target: TrackerTarget
  /** A prior unresolved read is a process-local overlap guard, not authority. */
  readonly unresolvedReadOperationId: OperationId | null
}

/** Reuses the durable executor command budget before any ordinary progress read. */
export const executorProgressContinuationAvailableFor = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt
): boolean => {
  const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
  const reports = records.flatMap(({ event }) =>
    event._tag === "PlannedAttemptExecutorWorkReported" &&
    samePlannedAttemptExecutorCorrelation(correlation, event.report.correlation)
      ? [event.report]
      : []
  )
  const latestSafeSuspensionPosition = records.findLast(
    ({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkReported" &&
      samePlannedAttemptExecutorCorrelation(correlation, event.report.correlation) &&
      event.report._tag === "SafelySuspended"
  )?.position
  const durableCommandCount = records.filter(
    ({ event, position }) =>
      (latestSafeSuspensionPosition === undefined || position > latestSafeSuspensionPosition) &&
      event._tag === "PlannedAttemptExecutorCommandIntended" &&
      event.command === "StartOrContinue" &&
      event.plannedAttempt.runId === plannedAttempt.runId &&
      event.plannedAttempt.attemptId === plannedAttempt.attemptId
  ).length
  return (
    plannedAttemptExecutorContinuationDisposition(correlation, reports, undefined, durableCommandCount)._tag ===
    "ExecutorContinuationAvailable"
  )
}

const positionOf = (position: JournalPosition): number => position

const correlationKeyOf = (correlation: PlannedAttemptExecutorCorrelation): string =>
  `${correlation.runId}:${correlation.attemptId}`

const sameTarget = (left: TrackerTarget, right: TrackerTarget): boolean =>
  taskTrackerTargetKey(left) === taskTrackerTargetKey(right)

/** True only when one accepted complete read explicitly covers this exact report subject. */
export const executorProgressGraphReadCoversReport = (
  report: ExecutorProgressReport,
  read: ExecutorProgressGraphRead
): boolean =>
  read.runId === report.correlation.runId &&
  read.explicitlyCoveredTaskIds.includes(report.taskId) &&
  read.intentAt > report.acceptedAt &&
  read.observation._tag === "Observed" &&
  read.observation.observedAt > read.intentAt &&
  (read.observation.outcome === "Complete" || read.observation.outcome === "Unchanged")

const readCoversReportAtTarget = (
  report: ExecutorProgressReport,
  read: ExecutorProgressGraphRead,
  target: TrackerTarget
): boolean => sameTarget(read.target, target) && executorProgressGraphReadCoversReport(report, read)

const unresolvedReadAfter = (
  report: ExecutorProgressReport,
  reads: ReadonlyArray<ExecutorProgressGraphRead>,
  target: TrackerTarget
): ExecutorProgressGraphRead | undefined =>
  reads
    .filter(
      (read) =>
        read.runId === report.correlation.runId &&
        sameTarget(read.target, target) &&
        read.explicitlyCoveredTaskIds.includes(report.taskId) &&
        read.intentAt > report.acceptedAt &&
        read.observation._tag === "Unresolved" &&
        !readCoversReportAtTarget(report, read, target)
    )
    .toSorted((left, right) => positionOf(right.intentAt) - positionOf(left.intentAt))[0]

const pendingReportsForCorrelation = (
  reports: ReadonlyArray<ExecutorProgressAcceptedReport>,
  reads: ReadonlyArray<ExecutorProgressGraphRead>,
  target: TrackerTarget,
  continuationLimit: PlannedAttemptExecutorContinuationLimit,
  commands: ReadonlyArray<ExecutorProgressCommand>,
  runId: RunId
): ReadonlyArray<ExecutorProgressReport> => {
  const groupedReports = reports
    .filter(({ correlation }) => correlation.runId === runId)
    .reduce<ReadonlyArray<{ readonly key: string; readonly reports: ReadonlyArray<ExecutorProgressAcceptedReport> }>>(
      (groups, report) => {
        const key = correlationKeyOf(report.correlation)
        return groups.some((group) => group.key === key)
          ? groups.map((group) => (group.key === key ? { ...group, reports: [...group.reports, report] } : group))
          : [...groups, { key, reports: [report] }]
      },
      []
    )
  return groupedReports.flatMap(({ reports: correlatedReports }) => {
    const orderedReports = [...correlatedReports].toSorted(
      (left, right) => positionOf(left.acceptedAt) - positionOf(right.acceptedAt)
    )
    const latestSafeIndex = orderedReports.findLastIndex(({ report }) => report._tag === "SafelySuspended")
    const reportsSinceSafe = orderedReports.slice(latestSafeIndex + 1)
    const latestSafeReport = latestSafeIndex < 0 ? undefined : orderedReports[latestSafeIndex]
    const correlation = orderedReports[0]?.correlation
    /* v8 ignore next -- the map is populated only by non-empty report groups. */
    if (correlation === undefined) return []
    const commandCount = commands.filter(
      (command) =>
        command.command === "StartOrContinue" &&
        command.correlation.runId === runId &&
        samePlannedAttemptExecutorCorrelation(command.correlation, correlation) &&
        (latestSafeReport === undefined || command.intendedAt > latestSafeReport.acceptedAt)
    ).length
    const disposition = plannedAttemptExecutorContinuationDisposition(
      correlation,
      orderedReports.map(({ report }) => report),
      continuationLimit,
      commandCount
    )
    if (disposition._tag === "ExecutorContinuationLimitReached") return []

    const latestNonRunningIndex = reportsSinceSafe.findLastIndex(({ report }) => report._tag !== "Running")
    return reportsSinceSafe.slice(latestNonRunningIndex + 1).flatMap(({ acceptedAt, report, taskId }) => {
      if (report._tag !== "Running") return []
      const pending = { acceptedAt, correlation, taskId }
      return reads.some((read) => readCoversReportAtTarget(pending, read, target)) ? [] : [pending]
    })
  })
}

/** Reconstructs one coalesced requirement from accepted journal-derived facts. */
export const executorProgressGraphReadRequirementOf = (
  input: ExecutorProgressGraphReadDerivationInput
): ExecutorProgressGraphReadRequirement | undefined => {
  const pendingReports = pendingReportsForCorrelation(
    input.reports,
    input.graphReads,
    input.target,
    input.continuationLimit ?? defaultPlannedAttemptExecutorContinuationLimit,
    input.commands,
    input.runId
  )
  if (pendingReports.length === 0) return undefined
  const [firstPendingReport, ...remainingPendingReports] = pendingReports
  /* v8 ignore next -- the length guard above guarantees one pending report. */
  if (firstPendingReport === undefined) return undefined
  const [firstTaskId, ...remainingTaskIds] = [...new Set(pendingReports.map(({ taskId }) => taskId))].toSorted(
    (left, right) => left.localeCompare(right)
  )
  /* v8 ignore next -- every pending report retains one exact task identity. */
  if (firstTaskId === undefined) return undefined
  const unresolvedReadOperationId = pendingReports
    .flatMap((report) => unresolvedReadAfter(report, input.graphReads, input.target) ?? [])
    .toSorted((left, right) => positionOf(right.intentAt) - positionOf(left.intentAt))[0]?.operationId
  return {
    _tag: "ExecutorProgressGraphReadRequirement",
    explicitlyCoveredTaskIds: [firstTaskId, ...remainingTaskIds],
    pendingReports: [firstPendingReport, ...remainingPendingReports],
    runId: input.runId,
    target: input.target,
    unresolvedReadOperationId: unresolvedReadOperationId ?? null
  }
}

/** True when a proposal's executor correlation is covered by this requirement. */
export const executorProgressRequirementCovers = (
  requirement: ExecutorProgressGraphReadRequirement,
  correlation: PlannedAttemptExecutorCorrelation
): boolean =>
  requirement.pendingReports.some((report) => samePlannedAttemptExecutorCorrelation(report.correlation, correlation))

/** Converts accepted report and command records into the normalized derivation input. */
type ExecutorProgressInputRecord = Pick<JournalRecord, "event" | "position" | "runId">

export const executorProgressGraphReadInputOf = (
  records: ReadonlyArray<ExecutorProgressInputRecord>,
  runId: RunId,
  target: TrackerTarget
): ExecutorProgressGraphReadDerivationInput => {
  const intents: ReadonlyArray<ExecutorProgressGraphRead> = records.flatMap(
    ({ event, position, runId: recordRunId }) =>
      recordRunId === runId &&
      event._tag === "TaskTrackerReadIntentRecorded" &&
      event.operation._tag === "ReadTrackerGraph" &&
      sameTarget(event.operation.target, target)
        ? [
            {
              explicitlyCoveredTaskIds: event.operation.readShape.explicitlyCoveredTaskIds,
              intentAt: position,
              observation: { _tag: "Unresolved" },
              operationId: event.operation.operationId,
              pendingReports: [],
              runId,
              target: event.operation.target
            }
          ]
        : []
  )
  const graphReads = intents.map((intent) => {
    const observation = records.find(
      ({ event, position, runId: observationRunId }) =>
        observationRunId === runId &&
        position > intent.intentAt &&
        event._tag === "TaskTrackerFactsObserved" &&
        event.operationId === intent.operationId &&
        (event.observation._tag === "CompleteTaskTrackerFacts" ||
          event.observation._tag === "UnchangedTaskTrackerFactsReconfirmed" ||
          event.observation._tag === "TaskTrackerFactsReadFailed")
    )
    if (observation === undefined || observation.event._tag !== "TaskTrackerFactsObserved") {
      return { ...intent, observation: { _tag: "Unresolved" } as const }
    }
    const observedFacts = observation.event.observation
    const outcome: ExecutorProgressGraphReadOutcome =
      observedFacts._tag === "CompleteTaskTrackerFacts" || observedFacts._tag === "UnchangedTaskTrackerFactsReconfirmed"
        ? exactTaskIdSetKey(observedFacts.factFamilies[0].coverage.explicitlyCoveredTaskIds) ===
          exactTaskIdSetKey(intent.explicitlyCoveredTaskIds)
          ? observedFacts._tag === "CompleteTaskTrackerFacts"
            ? "Complete"
            : "Unchanged"
          : "Failed"
        : "Failed"
    return { ...intent, observation: { _tag: "Observed", outcome, observedAt: observation.position } as const }
  })
  return {
    commands: records.flatMap(({ event, position, runId: recordRunId }) =>
      recordRunId === runId &&
      event._tag === "PlannedAttemptExecutorCommandIntended" &&
      event.plannedAttempt.runId === runId
        ? [
            {
              command: event.command,
              correlation: PlannedAttemptExecutorCorrelationSchema.make({
                attemptId: event.plannedAttempt.attemptId,
                runId: event.plannedAttempt.runId
              }),
              intendedAt: position
            }
          ]
        : []
    ),
    graphReads,
    reports: records.flatMap(({ event, position, runId: recordRunId }) => {
      if (
        recordRunId !== runId ||
        event._tag !== "PlannedAttemptExecutorWorkReported" ||
        event.report.correlation.runId !== runId
      )
        return []
      const plannedAttempt = records.findLast(
        ({ event: candidate, position: candidatePosition, runId: candidateRunId }) =>
          candidateRunId === runId &&
          candidatePosition < position &&
          candidate._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
          samePlannedAttemptExecutorCorrelation(
            event.report.correlation,
            plannedAttemptExecutorCorrelation(candidate.plannedAttempt)
          )
      )?.event
      return plannedAttempt?._tag === "PlannedAttemptExecutorWorkResponsibilityBegan"
        ? [
            {
              acceptedAt: position,
              correlation: event.report.correlation,
              report: event.report,
              taskId: plannedAttempt.plannedAttempt.taskId
            }
          ]
        : []
    }),
    runId,
    target
  }
}
