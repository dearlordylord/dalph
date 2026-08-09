import type { PlannedTaskAttempt, PlannedAttemptExecutorReport } from "@dalph/contracts"
import type { JournalPosition } from "../../../workflow-journal/identity.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import type {
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorCommandProjectionOrdinal,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorStateObservationOrdinal
} from "./events.js"

const latestElementOffset = -1

/** Provenance of one exact executor report, preserving command response vs read-only projection. */
export type PlannedAttemptExecutorEvidenceSource =
  | { readonly _tag: "CommandResponse"; readonly ordinal: PlannedAttemptExecutorReportOrdinal }
  | {
      readonly _tag: "CommandProjection"
      readonly commandOrdinal: PlannedAttemptExecutorCommandOrdinal
      readonly projectionOrdinal: PlannedAttemptExecutorCommandProjectionOrdinal
    }
  | { readonly _tag: "StateProjection"; readonly ordinal: PlannedAttemptExecutorStateObservationOrdinal }

export interface PlannedAttemptExecutorEvidence {
  readonly observedAt: JournalPosition
  readonly report: PlannedAttemptExecutorReport
  readonly source: PlannedAttemptExecutorEvidenceSource
}

const exactCorrelation = (report: PlannedAttemptExecutorReport, plannedAttempt: PlannedTaskAttempt): boolean =>
  report.correlation.runId === plannedAttempt.runId && report.correlation.attemptId === plannedAttempt.attemptId

/** Returns exact correlated executor authority while retaining how Dalph learned it. */
export const plannedAttemptExecutorEvidence = (
  records: ReadonlyArray<Pick<JournalRecord, "event" | "position">>,
  plannedAttempt: PlannedTaskAttempt,
  after?: JournalPosition
): ReadonlyArray<PlannedAttemptExecutorEvidence> =>
  records.flatMap<PlannedAttemptExecutorEvidence>(({ event, position }) => {
    if (after !== undefined && position <= after) return []
    if (event._tag === "PlannedAttemptExecutorWorkReported" && exactCorrelation(event.report, plannedAttempt)) {
      return [
        { observedAt: position, report: event.report, source: { _tag: "CommandResponse", ordinal: event.ordinal } }
      ]
    }
    if (
      event._tag === "PlannedAttemptExecutorCommandProjectionObserved" &&
      event.observation._tag === "ExactExecutorReport" &&
      exactCorrelation(event.observation.report, plannedAttempt)
    ) {
      return [
        {
          observedAt: position,
          report: event.observation.report,
          source: {
            _tag: "CommandProjection",
            commandOrdinal: event.commandOrdinal,
            projectionOrdinal: event.projectionOrdinal
          }
        }
      ]
    }
    if (
      event._tag === "PlannedAttemptExecutorStateObserved" &&
      event.observation._tag === "ExactExecutorReport" &&
      exactCorrelation(event.observation.report, plannedAttempt)
    ) {
      return [
        {
          observedAt: position,
          report: event.observation.report,
          source: { _tag: "StateProjection", ordinal: event.ordinal }
        }
      ]
    }
    return []
  })

/** Returns the newest exact executor authority evidence while preserving its provenance. */
export const latestPlannedAttemptExecutorEvidence = (
  records: ReadonlyArray<Pick<JournalRecord, "event" | "position">>,
  plannedAttempt: PlannedTaskAttempt,
  after?: JournalPosition
): PlannedAttemptExecutorEvidence | undefined =>
  plannedAttemptExecutorEvidence(records, plannedAttempt, after).at(latestElementOffset)

/** Latest exact executor command whose boundary response is still ambiguous. */
export const latestUnsettledPlannedAttemptExecutorCommand = (
  records: ReadonlyArray<Pick<JournalRecord, "event" | "position">>,
  plannedAttempt: PlannedTaskAttempt
) => {
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
      return exactCorrelation(event.report, plannedAttempt)
    }
    return (
      event._tag === "PlannedAttemptExecutorCommandProjectionObserved" &&
      event.commandOrdinal === commandEvent.ordinal &&
      event.observation._tag === "ExactExecutorReport" &&
      exactCorrelation(event.observation.report, plannedAttempt)
    )
  })
  return settled ? undefined : commandEvent
}
