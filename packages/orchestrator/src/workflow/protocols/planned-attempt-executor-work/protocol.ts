import { Effect, Match } from "effect"
import {
  type PlannedTaskAttempt,
  PlannedAttemptExecutor,
  plannedAttemptExecutorCorrelation,
  type PlannedAttemptExecutorReport,
  plannedTaskAttemptEquivalence,
  samePlannedAttemptExecutorReport
} from "@dalph/contracts"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { plannedAttemptExecutorStateObservedRecordKey } from "../../../workflow-journal/record-key.js"
import { InRunJournal } from "../../../workflow-journal/store.js"
import {
  PlannedAttemptExecutorStateObservedEvent,
  PlannedAttemptExecutorStateObservation,
  PlannedAttemptExecutorStateObservationOrdinal
} from "./events.js"
import { latestUnsettledPlannedAttemptExecutorCommand } from "./evidence.js"
import { type PlannedAttemptProtocolPermit, withPlannedAttemptProtocolPermit } from "./protocol-controller.js"
import { reconcileUnsettledPlannedAttemptExecutorCommand } from "./command.js"
import {
  PlannedAttemptExecutorCommandReconciliationRequired,
  PlannedAttemptExecutorCorrelationMismatch,
  PlannedAttemptExecutorInitializationCorrelationContradiction,
  PlannedAttemptExecutorResponsibilityContradiction,
  PlannedAttemptExecutorResponsibilityMissing,
  PlannedAttemptExecutorStateNoCurrentReport,
  PlannedAttemptExecutorStateTemporarilyUnavailable,
  PlannedAttemptExecutorStateUnreadable,
  validatePlannedAttemptExecutorProjectionCorrelation
} from "./errors.js"
import {
  acceptedPlannedAttemptExecutorReportRecords,
  acceptDistinctPlannedAttemptExecutorReport,
  acceptPendingPlannedAttemptExecutorReport,
  plannedAttemptExecutorLifecycleTransitionError
} from "./report-acceptance.js"

export * from "./errors.js"
export { beginPlannedAttemptExecutorResponsibility } from "./responsibility.js"

const lastElementOffset = -1

/** Distinguishes a newly accepted lifecycle fact from an exact passive replay. */
export type PlannedAttemptExecutorAcceptedFacts = "Changed" | "UnchangedPassiveObservation"

type PlannedAttemptExecutorObservationResult = {
  readonly acceptedFacts: PlannedAttemptExecutorAcceptedFacts
  readonly report: PlannedAttemptExecutorReport
}

/** Reads current executor authority without issuing another Begin, Resume, or Suspend command. */
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
  const pendingReport = yield* acceptPendingPlannedAttemptExecutorReport(plannedAttempt)
  if (pendingReport !== undefined) {
    return {
      acceptedFacts: "Changed" as const,
      report: pendingReport
    } satisfies PlannedAttemptExecutorObservationResult
  }
  const observationOrdinal = PlannedAttemptExecutorStateObservationOrdinal.make(
    records.filter(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorStateObserved" &&
        event.plannedAttempt.attemptId === plannedAttempt.attemptId
    ).length + 1
  )
  const projected = yield* executor.observe(correlation, { _tag: "PassiveLifecycleObservation" })
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
      Effect.gen(function* () {
        const latestAccepted = acceptedPlannedAttemptExecutorReportRecords(records, plannedAttempt).at(
          lastElementOffset
        )
        if (
          latestAccepted?.event._tag === "PlannedAttemptExecutorWorkReported" &&
          samePlannedAttemptExecutorReport(latestAccepted.event.report, report)
        ) {
          return {
            acceptedFacts: "UnchangedPassiveObservation" as const,
            report
          } satisfies PlannedAttemptExecutorObservationResult
        }
        const transitionError = plannedAttemptExecutorLifecycleTransitionError(records, plannedAttempt, report)
        if (transitionError !== undefined) {
          if (transitionError._tag === "PlannedAttemptExecutorBeginReportContradiction") {
            return yield* transitionError
          }
          yield* recordObservation(
            transitionError._tag === "PlannedAttemptExecutorInitialReportCausalityContradiction"
              ? PlannedAttemptExecutorStateObservation.cases.ExecutorInitialReportCausalityContradiction.make({
                  observed: transitionError.observed
                })
              : PlannedAttemptExecutorStateObservation.cases.ExecutorLifecycleTransitionContradiction.make({
                  accepted: transitionError.accepted,
                  observed: transitionError.observed
                })
          )
          return yield* transitionError
        }
        yield* recordObservation(PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({ report }))
        yield* acceptDistinctPlannedAttemptExecutorReport(plannedAttempt, report)
        return { acceptedFacts: "Changed" as const, report } satisfies PlannedAttemptExecutorObservationResult
      }),
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
      ),
    InitializationCorrelationContradiction: ({ detail }) =>
      Effect.fail(new PlannedAttemptExecutorInitializationCorrelationContradiction({ correlation, detail }))
  })
})

export const observePlannedAttemptExecutorStateWithPermit = (
  permit: PlannedAttemptProtocolPermit,
  plannedAttempt: PlannedTaskAttempt
) =>
  withPlannedAttemptProtocolPermit(
    permit,
    plannedAttemptExecutorCorrelation(plannedAttempt),
    observePlannedAttemptExecutorStateUnserialized(plannedAttempt).pipe(Effect.map(({ report }) => report))
  )

/** Passively reads the executor and preserves whether the Journal accepted a distinct report. */
export const observePlannedAttemptExecutorStateResultWithPermit = (
  permit: PlannedAttemptProtocolPermit,
  plannedAttempt: PlannedTaskAttempt
) =>
  withPlannedAttemptProtocolPermit(
    permit,
    plannedAttemptExecutorCorrelation(plannedAttempt),
    observePlannedAttemptExecutorStateUnserialized(plannedAttempt)
  )

const reconcileOrObservePlannedAttemptExecutorStateResultUnserialized = Effect.fn(
  "PlannedAttemptExecutorWorkflow.reconcileOrObserveStateResultUnserialized"
)(function* (plannedAttempt: PlannedTaskAttempt) {
  const journal = yield* InRunJournal
  const records = yield* journal.read(plannedAttempt.runId)
  const unsettledCommand = latestUnsettledPlannedAttemptExecutorCommand(records, plannedAttempt)
  if (unsettledCommand === undefined) {
    return yield* observePlannedAttemptExecutorStateUnserialized(plannedAttempt)
  }
  const report = yield* reconcileUnsettledPlannedAttemptExecutorCommand(records, plannedAttempt, unsettledCommand)
  return { acceptedFacts: "Changed" as const, report } satisfies PlannedAttemptExecutorObservationResult
})

/** Reconciles an ambiguous command or passively reads, preserving whether accepted facts changed. */
export const reconcileOrObservePlannedAttemptExecutorStateResultWithPermit = (
  permit: PlannedAttemptProtocolPermit,
  plannedAttempt: PlannedTaskAttempt
) =>
  withPlannedAttemptProtocolPermit(
    permit,
    plannedAttemptExecutorCorrelation(plannedAttempt),
    reconcileOrObservePlannedAttemptExecutorStateResultUnserialized(plannedAttempt)
  )
