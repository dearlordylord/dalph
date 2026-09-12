import { Option } from "effect"
import {
  type PlannedAttemptExecutorCorrelation,
  type PlannedTaskAttempt,
  plannedTaskAttemptEquivalence
} from "@dalph/contracts"
import type { TaskDagSnapshot } from "../../authorities/task-tracker/graph.js"
import { taskTrackerTargetKey, type TrackerTarget } from "../../authorities/task-tracker/target.js"
import { immutableSnapshot } from "../immutable-snapshot.js"
import type { RunActivationOpportunity } from "../run/run-activation-opportunity.js"
import { intentRecordKey, outcomeRecordKey } from "../../workflow-journal/record-key.js"
import { exactWorkflowRunTargetFor } from "../../workflow-journal/run-target.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import {
  journalEvidenceBefore,
  journalGraphObservationAt,
  journalGraphSnapshotForObservation,
  journalRecordByKey,
  journalRecordsForAttemptKind,
  type JournalRecordEvidence
} from "../../workflow-journal/record-evidence.js"
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
import { acceptedExecutingAttemptsForAuthorityCheckIntent } from "../../workflow/protocols/planned-attempt-continuation/tracker-read-freshness.js"

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
  records: JournalRecordEvidence,
  graphObservation: CompleteGraphObservationRecord
): TaskDagSnapshot | undefined =>
  Option.getOrUndefined(journalGraphSnapshotForObservation(records, graphObservation.position))

const graphShowsTaskLifecycle = (
  records: JournalRecordEvidence,
  observation: CompleteGraphObservationRecord,
  plannedAttempt: PlannedTaskAttempt,
  lifecycle: "Open" | "TerminalWithoutSuccess"
): boolean => {
  const graph = graphReconstructedAt(records, observation)
  return Option.getOrUndefined(graph?.lifecycleOf(plannedAttempt.taskId) ?? Option.none())?._tag === lifecycle
}

const taskWasClosedAtAcceptedSafe = (
  records: JournalRecordEvidence,
  plannedAttempt: PlannedTaskAttempt,
  acceptedSafe: AcceptedPlannedAttemptExecutorEvidence,
  immutableRunTarget: TrackerTarget
): boolean => {
  const graphBeforeSafe = journalGraphObservationAt(journalEvidenceBefore(records, acceptedSafe.observedAt + 1), {
    target: immutableRunTarget
  })
  if (graphBeforeSafe === undefined || !isCompleteGraphObservationRecord(graphBeforeSafe)) return false
  return graphShowsTaskLifecycle(records, graphBeforeSafe, plannedAttempt, "TerminalWithoutSuccess")
}

/**
 * Finds the latest global tracker observation after accepted Safe only when
 * the same task was closed at Safe and is Open in that latest observation.
 * This is lifecycle-reopen evidence, not exact continuation-read eligibility.
 */
const latestTaskReopenAfterAcceptedSafe = (
  records: JournalRecordEvidence,
  plannedAttempt: PlannedTaskAttempt,
  acceptedSafe: AcceptedPlannedAttemptExecutorEvidence
): CompleteGraphObservationRecord | undefined => {
  const immutableRunTarget = exactWorkflowRunTargetFor(records)
  if (immutableRunTarget === undefined) return undefined
  if (!taskWasClosedAtAcceptedSafe(records, plannedAttempt, acceptedSafe, immutableRunTarget)) return undefined
  const reopened = journalGraphObservationAt(records, { target: immutableRunTarget })
  if (
    reopened === undefined ||
    reopened.position <= acceptedSafe.observedAt ||
    !isCompleteGraphObservationRecord(reopened)
  )
    return undefined
  return graphShowsTaskLifecycle(records, reopened, plannedAttempt, "Open") ? reopened : undefined
}

type GraphReadIntentRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "TaskTrackerReadIntentRecorded" }> & {
    readonly operation: Extract<
      Extract<JournalRecord["event"], { readonly _tag: "TaskTrackerReadIntentRecorded" }>["operation"],
      { readonly _tag: "ReadTrackerGraph" }
    >
  }
}

const isGraphReadIntent = (record: JournalRecord | undefined): record is GraphReadIntentRecord =>
  record?.event._tag === "TaskTrackerReadIntentRecorded" && record.event.operation._tag === "ReadTrackerGraph"

const reopenMatchesExecutingAuthorityRead = (
  records: JournalRecordEvidence,
  intent: GraphReadIntentRecord,
  reopened: CompleteGraphObservationRecord,
  plannedAttempt: PlannedTaskAttempt
): boolean => {
  const operation = intent.event.operation
  return (
    intent.runId === plannedAttempt.runId &&
    operation.operationId === reopened.event.operationId &&
    intent.position < reopened.position &&
    acceptedExecutingAttemptsForAuthorityCheckIntent(records, intent) !== undefined &&
    taskTrackerTargetKey(operation.target) === taskTrackerTargetKey(reopened.event.observation.target) &&
    !operation.readShape.explicitlyCoveredTaskIds.includes(plannedAttempt.taskId)
  )
}

/**
 * Bootstrap authority for the ordinary activation queued by an accepted
 * active-work refresh: the latest global reopen must be the exact accepted
 * B/D-style authority read, not a general bootstrap or C continuation read.
 */
export const hasUnconsumedAcceptedSafeTaskReopenFromExecutingWorkAuthorityCheck = (
  records: JournalRecordEvidence,
  plannedAttempt: PlannedTaskAttempt
): boolean => {
  const acceptedSafe = currentUnconsumedAcceptedSafeEvidence(records, plannedAttempt)
  if (acceptedSafe?.report._tag !== "ExecutorWorkSafelySuspended") return false
  const reopened = latestTaskReopenAfterAcceptedSafe(records, plannedAttempt, acceptedSafe)
  if (
    reopened === undefined ||
    reopened.runId !== plannedAttempt.runId ||
    reopened.key !== outcomeRecordKey(reopened.event.operationId)
  ) {
    return false
  }
  const intent = journalRecordByKey(records, intentRecordKey(reopened.event.operationId))
  return isGraphReadIntent(intent) && reopenMatchesExecutingAuthorityRead(records, intent, reopened, plannedAttempt)
}

const exactTaskWasReopenedAfterAcceptedSafe = (
  records: JournalRecordEvidence,
  plannedAttempt: PlannedTaskAttempt,
  acceptedSafe: AcceptedPlannedAttemptExecutorEvidence
): boolean => {
  const immutableRunTarget = exactWorkflowRunTargetFor(records)
  if (immutableRunTarget === undefined) return false
  if (!taskWasClosedAtAcceptedSafe(records, plannedAttempt, acceptedSafe, immutableRunTarget)) return false
  const reopened = journalGraphObservationAt(records, { plannedAttempt, target: immutableRunTarget })
  if (
    reopened === undefined ||
    reopened.position <= acceptedSafe.observedAt ||
    !isCompleteGraphObservationRecord(reopened)
  )
    return false
  return graphShowsTaskLifecycle(records, reopened, plannedAttempt, "Open")
}

type ResumeIntentRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "PlannedAttemptExecutorCommandIntended" }>
}

const isResumeForAttempt = (record: JournalRecord, plannedAttempt: PlannedTaskAttempt): record is ResumeIntentRecord =>
  record.event._tag === "PlannedAttemptExecutorCommandIntended" &&
  record.event.command === "Resume" &&
  plannedTaskAttemptEquivalence(record.event.plannedAttempt, plannedAttempt)

const latestResumeForAttempt = (records: JournalRecordEvidence, plannedAttempt: PlannedTaskAttempt) => {
  let resume: ResumeIntentRecord | undefined
  for (const record of journalRecordsForAttemptKind(
    records,
    plannedAttempt.attemptId,
    "PlannedAttemptExecutorCommandIntended"
  )) {
    if (isResumeForAttempt(record, plannedAttempt)) resume = record
  }
  return resume
}

const projectionReportsExactSafeForAttempt = (
  event: JournalRecord["event"],
  plannedAttempt: PlannedTaskAttempt
): event is Extract<JournalRecord["event"], { readonly _tag: "PlannedAttemptExecutorCommandProjectionObserved" }> =>
  event._tag === "PlannedAttemptExecutorCommandProjectionObserved" &&
  plannedTaskAttemptEquivalence(event.plannedAttempt, plannedAttempt) &&
  event.observation._tag === "ExactExecutorReport" &&
  event.observation.report._tag === "ExecutorWorkSafelySuspended" &&
  event.observation.report.correlation.runId === plannedAttempt.runId &&
  event.observation.report.correlation.attemptId === plannedAttempt.attemptId

const latestSafeResumeProjection = (
  records: JournalRecordEvidence,
  plannedAttempt: PlannedTaskAttempt,
  resumePosition: JournalPosition,
  resumeCommandOrdinal: PlannedAttemptExecutorCommandOrdinal
) => {
  let reconciled: JournalRecord | undefined
  for (const record of journalRecordsForAttemptKind(
    records,
    plannedAttempt.attemptId,
    "PlannedAttemptExecutorCommandProjectionObserved"
  )) {
    const event = record.event
    if (
      record.position > resumePosition &&
      projectionReportsExactSafeForAttempt(event, plannedAttempt) &&
      event.commandOrdinal === resumeCommandOrdinal
    )
      reconciled = record
  }
  return reconciled
}

const safeResumeProjectionWasConsumed = (
  records: JournalRecordEvidence,
  plannedAttempt: PlannedTaskAttempt,
  reconciledPosition: JournalPosition,
  resumeCommandOrdinal: PlannedAttemptExecutorCommandOrdinal,
  projectionOrdinal: PlannedAttemptExecutorCommandProjectionOrdinal
): boolean => {
  let consumed = false
  for (const record of journalRecordsForAttemptKind(
    records,
    plannedAttempt.attemptId,
    "PlannedAttemptExecutorResumeRedeliveryIntended"
  )) {
    const event = record.event
    if (
      record.position > reconciledPosition &&
      event._tag === "PlannedAttemptExecutorResumeRedeliveryIntended" &&
      plannedTaskAttemptEquivalence(event.plannedAttempt, plannedAttempt) &&
      event.commandOrdinal === resumeCommandOrdinal &&
      event.projectionOrdinal === projectionOrdinal &&
      event.authorization.safeProjectionObservedAt === reconciledPosition
    )
      consumed = true
  }
  return consumed
}

const safeResumeProjectionWasSuperseded = (
  records: JournalRecordEvidence,
  plannedAttempt: PlannedTaskAttempt,
  reconciledPosition: JournalPosition
): boolean => {
  let superseded = false
  for (const record of journalRecordsForAttemptKind(
    records,
    plannedAttempt.attemptId,
    "PlannedAttemptExecutorCommandIntended"
  )) {
    const event = record.event
    if (
      record.position > reconciledPosition &&
      event._tag === "PlannedAttemptExecutorCommandIntended" &&
      (event.command === "Begin" || event.command === "Resume") &&
      plannedTaskAttemptEquivalence(event.plannedAttempt, plannedAttempt)
    )
      superseded = true
  }
  return superseded
}

const reconciledResumeStillSafeBasis = (records: JournalRecordEvidence, plannedAttempt: PlannedTaskAttempt) => {
  const resume = latestResumeForAttempt(records, plannedAttempt)
  if (resume === undefined) return undefined
  const lifecycleSafe = latestAcceptedPlannedAttemptExecutorEvidence(
    journalEvidenceBefore(records, resume.position),
    plannedAttempt
  )
  if (lifecycleSafe?.report._tag !== "ExecutorWorkSafelySuspended") return undefined
  const resumeCommandOrdinal = resume.event.ordinal
  const reconciled = latestSafeResumeProjection(records, plannedAttempt, resume.position, resumeCommandOrdinal)
  if (reconciled?.event._tag !== "PlannedAttemptExecutorCommandProjectionObserved") return undefined
  const projectionOrdinal = reconciled.event.projectionOrdinal
  const consumed = safeResumeProjectionWasConsumed(
    records,
    plannedAttempt,
    reconciled.position,
    resumeCommandOrdinal,
    projectionOrdinal
  )
  const superseded = safeResumeProjectionWasSuperseded(records, plannedAttempt, reconciled.position)
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

const safeEvidenceForRevalidation = (records: JournalRecordEvidence, plannedAttempt: PlannedTaskAttempt) => {
  const currentAcceptedSafe = latestAcceptedPlannedAttemptExecutorEvidence(records, plannedAttempt)
  const unconsumedAcceptedSafe = currentUnconsumedAcceptedSafeEvidence(records, plannedAttempt)
  const retry =
    currentAcceptedSafe?.report._tag === "ExecutorWorkSafelySuspended"
      ? reconciledResumeStillSafeBasis(records, plannedAttempt)
      : undefined
  return retry === undefined
    ? {
        acceptedSafe: unconsumedAcceptedSafe,
        lifecycleSafe: unconsumedAcceptedSafe,
        basis: { _tag: "LifecycleReopenAfterAcceptedSafe" as const }
      }
    : { acceptedSafe: currentAcceptedSafe, lifecycleSafe: retry.lifecycleSafe, basis: retry.basis }
}

/**
 * Derives the private capacity permission only from complete recovery history.
 * Structural Ready facts or accepted-report values cannot call the issuer.
 */
export const safeContinuationRevalidationEligibilityFromRecoveryHistory = (
  records: JournalRecordEvidence,
  plannedAttempt: PlannedTaskAttempt,
  responsibilityBeganAt: JournalPosition,
  acceptedProgress: { readonly _tag: "ExecutorReportAccepted"; readonly ordinal: PlannedAttemptExecutorReportOrdinal },
  opportunity: RunActivationOpportunity
): SafeContinuationRevalidationEligibility | undefined => {
  if (opportunity._tag === "ActiveWorkAuthorityRefresh") return undefined
  const { acceptedSafe, basis, lifecycleSafe } = safeEvidenceForRevalidation(records, plannedAttempt)
  if (
    acceptedSafe?.report._tag !== "ExecutorWorkSafelySuspended" ||
    acceptedSafe.source.ordinal !== acceptedProgress.ordinal ||
    lifecycleSafe === undefined ||
    !exactTaskWasReopenedAfterAcceptedSafe(records, plannedAttempt, lifecycleSafe)
  ) {
    return undefined
  }
  return issueSafeContinuationRevalidationEligibility(plannedAttempt, responsibilityBeganAt, acceptedSafe, basis)
}
