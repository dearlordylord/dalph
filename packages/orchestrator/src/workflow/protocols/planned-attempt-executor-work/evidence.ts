import { Effect } from "effect"
import {
  PlannedAttemptExecutorRequest,
  TaskWorkSpecification,
  type PlannedTaskAttempt,
  type PlannedAttemptExecutorReport,
  type TaskWorkSpecification as TaskWorkSpecificationType,
  plannedAttemptExecutorCorrelation
} from "@dalph/contracts"
import {
  PlannedAttemptExecutorTaskWorkSpecificationMissing,
  PlannedAttemptExecutorTaskWorkSpecificationMismatch
} from "./errors.js"
import type { JournalPosition } from "../../../workflow-journal/identity.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import type {
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorCommandProjectionOrdinal,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorStateObservationOrdinal
} from "./events.js"

const latestElementOffset = -1

/** Builds the exact executor request from fresh selection or accepted recovery evidence. */
export const plannedAttemptExecutorRequestFor = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  selectedSpecification?: TaskWorkSpecificationType
): Effect.Effect<
  PlannedAttemptExecutorRequest,
  PlannedAttemptExecutorTaskWorkSpecificationMissing | PlannedAttemptExecutorTaskWorkSpecificationMismatch
> => {
  if (selectedSpecification !== undefined) {
    return selectedSpecification.taskId === plannedAttempt.taskId &&
      selectedSpecification.fingerprint === plannedAttempt.taskRevision
      ? Effect.succeed(PlannedAttemptExecutorRequest.make({ plannedAttempt, specification: selectedSpecification }))
      : Effect.fail(
          new PlannedAttemptExecutorTaskWorkSpecificationMismatch({
            plannedAttempt,
            specification: selectedSpecification
          })
        )
  }
  const specifications = plannedAttemptExecutorTaskWorkSpecifications(records)
  const exact = specifications.findLast(
    (specification) =>
      specification.taskId === plannedAttempt.taskId && specification.fingerprint === plannedAttempt.taskRevision
  )
  if (exact !== undefined) {
    return Effect.succeed(PlannedAttemptExecutorRequest.make({ plannedAttempt, specification: exact }))
  }
  const observed =
    specifications.findLast((specification) => specification.taskId === plannedAttempt.taskId) ??
    specifications.at(latestElementOffset)
  return observed === undefined
    ? Effect.fail(
        new PlannedAttemptExecutorTaskWorkSpecificationMissing({
          correlation: plannedAttemptExecutorCorrelation(plannedAttempt)
        })
      )
    : Effect.fail(new PlannedAttemptExecutorTaskWorkSpecificationMismatch({ plannedAttempt, specification: observed }))
}

/** Reconstructs accepted focused task-work observations without substituting later tracker text. */
export const plannedAttemptExecutorTaskWorkSpecifications = (
  records: ReadonlyArray<Pick<JournalRecord, "event">>
): ReadonlyArray<TaskWorkSpecificationType> =>
  records.flatMap(({ event }) => {
    if (event._tag !== "TaskTrackerFactsObserved" || event.observation._tag !== "FocusedTaskWorkSpecificationFacts") {
      return []
    }
    return [
      TaskWorkSpecification.make({
        body: event.observation.factFamily.body,
        fingerprint: event.observation.factFamily.fingerprint,
        taskId: event.observation.factFamily.taskId,
        title: event.observation.factFamily.title
      })
    ]
  })

/** Provenance of one exact executor report, preserving command response vs read-only projection. */
type PlannedAttemptExecutorEvidenceSource =
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

/** The closed reasons why one normalized executor projection cannot authorize work. */
export type PlannedAttemptExecutorProjectionWaitReason =
  | "NoCurrentReport"
  | "TemporarilyUnavailable"
  | "Unreadable"
  | "CorrelationContradiction"

/** A normalized projection outcome that must remain nonterminal until reread. */
type PlannedAttemptExecutorProjectionIssue = {
  readonly observedAt: JournalPosition
  readonly reason: PlannedAttemptExecutorProjectionWaitReason
}

const exactCorrelation = (report: PlannedAttemptExecutorReport, plannedAttempt: PlannedTaskAttempt): boolean =>
  report.correlation.runId === plannedAttempt.runId && report.correlation.attemptId === plannedAttempt.attemptId

const commandProjectionEvidence = (
  event: Extract<JournalRecord["event"], { readonly _tag: "PlannedAttemptExecutorCommandProjectionObserved" }>,
  position: JournalPosition,
  plannedAttempt: PlannedTaskAttempt
): ReadonlyArray<PlannedAttemptExecutorEvidence> => {
  if (event.observation._tag === "ExactExecutorReport" && exactCorrelation(event.observation.report, plannedAttempt)) {
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
  return []
}

const stateProjectionEvidence = (
  event: Extract<JournalRecord["event"], { readonly _tag: "PlannedAttemptExecutorStateObserved" }>,
  position: JournalPosition,
  plannedAttempt: PlannedTaskAttempt
): ReadonlyArray<PlannedAttemptExecutorEvidence> => {
  if (event.observation._tag === "ExactExecutorReport" && exactCorrelation(event.observation.report, plannedAttempt)) {
    return [
      {
        observedAt: position,
        report: event.observation.report,
        source: { _tag: "StateProjection", ordinal: event.ordinal }
      }
    ]
  }
  return []
}

const evidenceFromRecord = (
  { event, position }: Pick<JournalRecord, "event" | "position">,
  plannedAttempt: PlannedTaskAttempt
): ReadonlyArray<PlannedAttemptExecutorEvidence> => {
  if (event._tag === "PlannedAttemptExecutorWorkReported") {
    return exactCorrelation(event.report, plannedAttempt)
      ? [{ observedAt: position, report: event.report, source: { _tag: "CommandResponse", ordinal: event.ordinal } }]
      : []
  }
  if (event._tag === "PlannedAttemptExecutorCommandProjectionObserved") {
    return commandProjectionEvidence(event, position, plannedAttempt)
  }
  return event._tag === "PlannedAttemptExecutorStateObserved"
    ? stateProjectionEvidence(event, position, plannedAttempt)
    : []
}

/** Returns exact correlated executor authority while retaining how Dalph learned it. */
export const plannedAttemptExecutorEvidence = (
  records: ReadonlyArray<Pick<JournalRecord, "event" | "position">>,
  plannedAttempt: PlannedTaskAttempt,
  after?: JournalPosition
): ReadonlyArray<PlannedAttemptExecutorEvidence> =>
  records.flatMap((record) =>
    after !== undefined && record.position <= after ? [] : evidenceFromRecord(record, plannedAttempt)
  )

const projectionIssueReason = (
  observation:
    | Extract<
        JournalRecord["event"],
        { readonly _tag: "PlannedAttemptExecutorCommandProjectionObserved" }
      >["observation"]
    | Extract<JournalRecord["event"], { readonly _tag: "PlannedAttemptExecutorStateObserved" }>["observation"]
): PlannedAttemptExecutorProjectionIssue["reason"] | undefined => {
  if (observation._tag === "ExecutorStateNoCurrentReport") return "NoCurrentReport"
  if (observation._tag === "ExecutorStateTemporarilyUnavailable") return "TemporarilyUnavailable"
  if (observation._tag === "ExecutorStateUnreadable") return "Unreadable"
  if (observation._tag === "ExecutorReportContradiction") return "CorrelationContradiction"
  return undefined
}

/** Returns the latest non-exact projection outcome for this exact responsibility. */
export const latestPlannedAttemptExecutorProjectionIssue = (
  records: ReadonlyArray<Pick<JournalRecord, "event" | "position">>,
  plannedAttempt: PlannedTaskAttempt
): PlannedAttemptExecutorProjectionIssue | undefined => {
  for (const { event, position } of [...records].reverse()) {
    if (
      (event._tag === "PlannedAttemptExecutorCommandProjectionObserved" ||
        event._tag === "PlannedAttemptExecutorStateObserved") &&
      event.plannedAttempt.runId === plannedAttempt.runId &&
      event.plannedAttempt.attemptId === plannedAttempt.attemptId
    ) {
      const reason = projectionIssueReason(event.observation)
      if (reason !== undefined) return { observedAt: position, reason }
    }
  }
  return undefined
}

/**
 * Returns the newest exact executor authority that remains current.
 * A later non-exact projection invalidates the report as authority without
 * erasing its historical evidence; Dalph must reread before using it again.
 */
export const latestPlannedAttemptExecutorEvidence = (
  records: ReadonlyArray<Pick<JournalRecord, "event" | "position">>,
  plannedAttempt: PlannedTaskAttempt,
  after?: JournalPosition
): PlannedAttemptExecutorEvidence | undefined => {
  const evidence = plannedAttemptExecutorEvidence(records, plannedAttempt, after).at(latestElementOffset)
  if (evidence === undefined) return undefined
  const issue = latestPlannedAttemptExecutorProjectionIssue(records, plannedAttempt)
  return issue === undefined || evidence.observedAt > issue.observedAt ? evidence : undefined
}

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
