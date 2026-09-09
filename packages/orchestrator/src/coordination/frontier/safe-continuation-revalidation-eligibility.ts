import { Option } from "effect"
import {
  type PlannedAttemptExecutorCorrelation,
  type PlannedTaskAttempt,
  plannedTaskAttemptEquivalence
} from "@dalph/contracts"
import type { TaskDagSnapshot } from "../../authorities/task-tracker/graph.js"
import { taskTrackerTargetKey } from "../../authorities/task-tracker/target.js"
import { immutableSnapshot } from "../immutable-snapshot.js"
import { reconstructedTaskGraphFromEvents } from "../reconstruction/graph-knowledge.js"
import type { RunActivationOpportunity } from "../run/run-activation-opportunity.js"
import { intentRecordKey } from "../../workflow-journal/record-key.js"
import { exactWorkflowRunTargetFor } from "../../workflow-journal/run-target.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import {
  currentUnconsumedAcceptedSafeEvidence,
  latestAcceptedPlannedAttemptExecutorEvidence,
  type AcceptedPlannedAttemptExecutorEvidence
} from "../../workflow/protocols/planned-attempt-executor-work/evidence.js"
import type {
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorCommandProjectionOrdinal,
  PlannedAttemptExecutorReportOrdinal
} from "../../workflow/protocols/planned-attempt-executor-work/events.js"
import {
  continuationTrackerReadHasExactPlanPredecessor,
  type ContinuationTrackerReadOperation
} from "../../workflow/protocols/planned-attempt-continuation/tracker-read-freshness.js"

const SafeContinuationRevalidationEligibilityTypeId: unique symbol = Symbol(
  "@dalph/SafeContinuationRevalidationEligibility"
)
const issuedSafeContinuationRevalidationEligibilities = new WeakSet<object>()

/**
 * Process-local permission for one safely suspended responsibility to reserve
 * capacity while it rereads current continuation authority. It is not final
 * Resume authorization and cannot be reconstructed from its public fields.
 */
export type SafeContinuationRevalidationEligibility = {
  readonly [SafeContinuationRevalidationEligibilityTypeId]: typeof SafeContinuationRevalidationEligibilityTypeId
  readonly acceptedSafe: {
    readonly correlation: PlannedAttemptExecutorCorrelation
    readonly reportOrdinal: PlannedAttemptExecutorReportOrdinal
  }
  readonly plannedAttempt: PlannedTaskAttempt
  readonly responsibilityBeganAt: JournalPosition
  /** Distinguishes first lifecycle-reopen admission from retry after an exact Resume-stayed-Safe reconciliation. */
  readonly basis:
    | { readonly _tag: "LifecycleReopenAfterAcceptedSafe" }
    | {
        readonly _tag: "ReconciledResumeStillSafe"
        readonly observedAt: JournalPosition
        readonly projectionOrdinal: PlannedAttemptExecutorCommandProjectionOrdinal
        readonly resumeCommandOrdinal: PlannedAttemptExecutorCommandOrdinal
      }
}

/** Runtime guard for the private exact Safe-continuation eligibility. */
export const isSafeContinuationRevalidationEligibility = (
  value: unknown
): value is SafeContinuationRevalidationEligibility =>
  typeof value === "object" && value !== null && issuedSafeContinuationRevalidationEligibilities.has(value)

type CompleteGraphObservation = Extract<
  Extract<JournalRecord["event"], { readonly _tag: "TaskTrackerFactsObserved" }>["observation"],
  { readonly _tag: "CompleteTaskTrackerFacts" | "UnchangedTaskTrackerFactsReconfirmed" }
>
type CompleteGraphObservationRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "TaskTrackerFactsObserved" }> & {
    readonly observation: CompleteGraphObservation
  }
}

const isCompleteGraphObservationRecord = (record: JournalRecord): record is CompleteGraphObservationRecord =>
  record.event._tag === "TaskTrackerFactsObserved" &&
  (record.event.observation._tag === "CompleteTaskTrackerFacts" ||
    record.event.observation._tag === "UnchangedTaskTrackerFactsReconfirmed")

const graphReconstructedAt = (
  records: ReadonlyArray<JournalRecord>,
  graphObservation: CompleteGraphObservationRecord
): TaskDagSnapshot | undefined =>
  Option.getOrUndefined(
    reconstructedTaskGraphFromEvents(
      records.filter(({ position }) => position <= graphObservation.position).map(({ event }) => event),
      graphObservation.event.observation.target
    )
  )

const exactContinuationGraphReadIntentFor = (
  records: ReadonlyArray<JournalRecord>,
  operationId: CompleteGraphObservationRecord["event"]["operationId"],
  plannedAttempt: PlannedTaskAttempt
): Extract<ContinuationTrackerReadOperation, { readonly _tag: "ReadTrackerGraph" }> | undefined => {
  const intent = records.findLast((record) => {
    if (record.event._tag !== "TaskTrackerReadIntentRecorded") return false
    const operation = record.event.operation
    return (
      operation._tag === "ReadTrackerGraph" &&
      operation.operationId === operationId &&
      record.key === intentRecordKey(operationId) &&
      continuationTrackerReadHasExactPlanPredecessor(records, operation, plannedAttempt)
    )
  })
  return intent?.event._tag === "TaskTrackerReadIntentRecorded" && intent.event.operation._tag === "ReadTrackerGraph"
    ? intent.event.operation
    : undefined
}

const exactTaskWasReopenedAfterAcceptedSafe = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  acceptedSafe: AcceptedPlannedAttemptExecutorEvidence
): boolean => {
  const immutableRunTarget = exactWorkflowRunTargetFor(records)
  if (immutableRunTarget === undefined) return false
  const graphBeforeSafe = records.findLast(
    (record): record is CompleteGraphObservationRecord =>
      record.position <= acceptedSafe.observedAt &&
      isCompleteGraphObservationRecord(record) &&
      taskTrackerTargetKey(record.event.observation.target) === taskTrackerTargetKey(immutableRunTarget)
  )
  if (graphBeforeSafe === undefined) return false
  const before = graphReconstructedAt(records, graphBeforeSafe)
  if (
    Option.getOrUndefined(before?.lifecycleOf(plannedAttempt.taskId) ?? Option.none())?._tag !==
    "TerminalWithoutSuccess"
  ) {
    return false
  }
  const reopened = records.findLast(
    (record): record is CompleteGraphObservationRecord =>
      record.position > acceptedSafe.observedAt &&
      isCompleteGraphObservationRecord(record) &&
      taskTrackerTargetKey(record.event.observation.target) === taskTrackerTargetKey(immutableRunTarget) &&
      exactContinuationGraphReadIntentFor(
        records,
        record.event.operationId,
        plannedAttempt
      )?.readShape.explicitlyCoveredTaskIds.includes(plannedAttempt.taskId) === true
  )
  if (reopened === undefined) return false
  const after = graphReconstructedAt(records, reopened)
  return Option.getOrUndefined(after?.lifecycleOf(plannedAttempt.taskId) ?? Option.none())?._tag === "Open"
}

const reconciledResumeStillSafeBasis = (records: ReadonlyArray<JournalRecord>, plannedAttempt: PlannedTaskAttempt) => {
  const resume = records.findLast(
    ({ event }) =>
      event._tag === "PlannedAttemptExecutorCommandIntended" &&
      event.command === "Resume" &&
      plannedTaskAttemptEquivalence(event.plannedAttempt, plannedAttempt)
  )
  if (resume?.event._tag !== "PlannedAttemptExecutorCommandIntended") return undefined
  const lifecycleSafe = latestAcceptedPlannedAttemptExecutorEvidence(
    records.filter(({ position }) => position < resume.position),
    plannedAttempt
  )
  if (lifecycleSafe?.report._tag !== "ExecutorWorkSafelySuspended") return undefined
  const resumeCommandOrdinal = resume.event.ordinal
  const reconciled = records.findLast(
    ({ event, position }) =>
      position > resume.position &&
      event._tag === "PlannedAttemptExecutorCommandProjectionObserved" &&
      event.commandOrdinal === resumeCommandOrdinal &&
      plannedTaskAttemptEquivalence(event.plannedAttempt, plannedAttempt) &&
      event.observation._tag === "ExactExecutorReport" &&
      event.observation.report._tag === "ExecutorWorkSafelySuspended" &&
      event.observation.report.correlation.runId === plannedAttempt.runId &&
      event.observation.report.correlation.attemptId === plannedAttempt.attemptId
  )
  if (reconciled?.event._tag !== "PlannedAttemptExecutorCommandProjectionObserved") return undefined
  const projectionOrdinal = reconciled.event.projectionOrdinal
  const consumed = records.some(
    ({ event, position }) =>
      position > reconciled.position &&
      event._tag === "PlannedAttemptExecutorResumeRedeliveryIntended" &&
      plannedTaskAttemptEquivalence(event.plannedAttempt, plannedAttempt) &&
      event.commandOrdinal === resumeCommandOrdinal &&
      event.projectionOrdinal === projectionOrdinal &&
      event.authorization.safeProjectionObservedAt === reconciled.position
  )
  const superseded = records.some(
    ({ event, position }) =>
      position > reconciled.position &&
      event._tag === "PlannedAttemptExecutorCommandIntended" &&
      (event.command === "Begin" || event.command === "Resume") &&
      plannedTaskAttemptEquivalence(event.plannedAttempt, plannedAttempt)
  )
  return consumed || superseded
    ? undefined
    : {
        basis: {
          _tag: "ReconciledResumeStillSafe" as const,
          observedAt: reconciled.position,
          projectionOrdinal,
          resumeCommandOrdinal
        },
        lifecycleSafe
      }
}

const issueSafeContinuationRevalidationEligibility = (
  plannedAttempt: PlannedTaskAttempt,
  responsibilityBeganAt: JournalPosition,
  acceptedSafe: AcceptedPlannedAttemptExecutorEvidence,
  basis: SafeContinuationRevalidationEligibility["basis"]
): SafeContinuationRevalidationEligibility => {
  const eligibility: SafeContinuationRevalidationEligibility = Object.freeze({
    [SafeContinuationRevalidationEligibilityTypeId]: SafeContinuationRevalidationEligibilityTypeId,
    acceptedSafe: Object.freeze({
      correlation: immutableSnapshot(acceptedSafe.report.correlation),
      reportOrdinal: acceptedSafe.source.ordinal
    }),
    plannedAttempt: immutableSnapshot(plannedAttempt),
    responsibilityBeganAt,
    basis: immutableSnapshot(basis)
  })
  issuedSafeContinuationRevalidationEligibilities.add(eligibility)
  return eligibility
}

/**
 * Derives the private capacity permission only from complete recovery history.
 * Structural Ready facts or accepted-report values cannot call the issuer.
 */
export const safeContinuationRevalidationEligibilityFromRecoveryHistory = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  responsibilityBeganAt: JournalPosition,
  acceptedProgress: { readonly _tag: "ExecutorReportAccepted"; readonly ordinal: PlannedAttemptExecutorReportOrdinal },
  opportunity: RunActivationOpportunity
): SafeContinuationRevalidationEligibility | undefined => {
  if (opportunity._tag === "ActiveWorkAuthorityRefresh") return undefined
  const currentAcceptedSafe = latestAcceptedPlannedAttemptExecutorEvidence(records, plannedAttempt)
  const unconsumedAcceptedSafe = currentUnconsumedAcceptedSafeEvidence(records, plannedAttempt)
  const retry =
    currentAcceptedSafe?.report._tag === "ExecutorWorkSafelySuspended"
      ? reconciledResumeStillSafeBasis(records, plannedAttempt)
      : undefined
  const acceptedSafe = retry === undefined ? unconsumedAcceptedSafe : currentAcceptedSafe
  const lifecycleSafe = retry?.lifecycleSafe ?? unconsumedAcceptedSafe
  if (
    acceptedSafe?.report._tag !== "ExecutorWorkSafelySuspended" ||
    acceptedSafe.source.ordinal !== acceptedProgress.ordinal ||
    lifecycleSafe === undefined ||
    !exactTaskWasReopenedAfterAcceptedSafe(records, plannedAttempt, lifecycleSafe)
  ) {
    return undefined
  }
  return issueSafeContinuationRevalidationEligibility(
    plannedAttempt,
    responsibilityBeganAt,
    acceptedSafe,
    retry?.basis ?? { _tag: "LifecycleReopenAfterAcceptedSafe" }
  )
}
