import { Effect, Match, Schema } from "effect"
import type { WorkflowJournalEvent } from "../../src/journal-store.js"
import type { TaskWorkSessionRecoveryConformanceCutPoint } from "./recovery-conformance-cut-point.js"

/**
 * The closed set of M1 model actions. Each action names one driver-facing test
 * control; the model driver does not choose workflow state or implement
 * scheduling.
 */
export const taskWorkSessionRecoveryActions = [
  "init",
  "selectIdentity",
  "commitIntent",
  "requestCreatesSession",
  "requestCreatesNothing",
  "lookupMatching",
  "lookupAbsent",
  "lookupContradictoryAbsence",
  "lookupUnreadable",
  "lookupConflict",
  "recordLookup",
  "recordOutcome",
  "crash",
  "restart"
] as const

export const TaskWorkSessionRecoveryAction = Schema.Literals(taskWorkSessionRecoveryActions)
export type TaskWorkSessionRecoveryAction = typeof TaskWorkSessionRecoveryAction.Type

export interface TaskWorkSessionRecoveryControls<A, E, R> {
  readonly commitIntent: () => Effect.Effect<A, E, R>
  readonly crash: () => Effect.Effect<A, E, R>
  readonly init: () => Effect.Effect<A, E, R>
  readonly lookupAbsent: () => Effect.Effect<A, E, R>
  readonly lookupConflict: () => Effect.Effect<A, E, R>
  readonly lookupContradictoryAbsence: () => Effect.Effect<A, E, R>
  readonly lookupMatching: () => Effect.Effect<A, E, R>
  readonly lookupUnreadable: () => Effect.Effect<A, E, R>
  readonly recordLookup: () => Effect.Effect<A, E, R>
  readonly recordOutcome: () => Effect.Effect<A, E, R>
  readonly requestCreatesNothing: () => Effect.Effect<A, E, R>
  readonly requestCreatesSession: () => Effect.Effect<A, E, R>
  readonly restart: () => Effect.Effect<A, E, R>
  readonly selectIdentity: () => Effect.Effect<A, E, R>
}

/** A model action or identity mapping cannot cross the conformance boundary. */
export class TaskWorkSessionRecoveryConformanceIssue
  extends Schema.TaggedErrorClass<TaskWorkSessionRecoveryConformanceIssue>()(
    "TaskWorkSessionRecoveryConformanceIssue",
    {
      detail: Schema.String,
      reason: Schema.Literals([
        "DuplicateBrandedIdentity",
        "DuplicateModelIdentity",
        "LossyProjection",
        "UnknownAction",
        "UnknownModelIdentity"
      ])
    }
  )
{}

/** Decodes one model action before invoking its matching deterministic test control. */
export const runTaskWorkSessionRecoveryAction = Effect.fn(
  "TaskWorkSessionRecoveryConformance.runAction"
)(function*<A, E, R>(
  input: unknown,
  controls: TaskWorkSessionRecoveryControls<A, E, R>
) {
  const action = yield* Schema.decodeUnknownEffect(TaskWorkSessionRecoveryAction)(input).pipe(
    Effect.mapError(() =>
      new TaskWorkSessionRecoveryConformanceIssue({
        detail: `unknown M1 action ${String(input)}`,
        reason: "UnknownAction"
      })
    )
  )
  return yield* Match.value(action).pipe(
    Match.when("commitIntent", controls.commitIntent),
    Match.when("crash", controls.crash),
    Match.when("init", controls.init),
    Match.when("lookupAbsent", controls.lookupAbsent),
    Match.when("lookupConflict", controls.lookupConflict),
    Match.when("lookupContradictoryAbsence", controls.lookupContradictoryAbsence),
    Match.when("lookupMatching", controls.lookupMatching),
    Match.when("lookupUnreadable", controls.lookupUnreadable),
    Match.when("recordLookup", controls.recordLookup),
    Match.when("recordOutcome", controls.recordOutcome),
    Match.when("requestCreatesNothing", controls.requestCreatesNothing),
    Match.when("requestCreatesSession", controls.requestCreatesSession),
    Match.when("restart", controls.restart),
    Match.when("selectIdentity", controls.selectIdentity),
    Match.exhaustive
  )
})

/**
 * Driver-facing test controls generated from the closed action inventory. All
 * calls pass through the same boundary decoder before the control invokes the
 * production workflow seam.
 */
export const mapTaskWorkSessionRecoveryControls = <A, E, R>(
  controls: TaskWorkSessionRecoveryControls<A, E, R>
): TaskWorkSessionRecoveryControls<A, E | TaskWorkSessionRecoveryConformanceIssue, R> => ({
  commitIntent: () => runTaskWorkSessionRecoveryAction("commitIntent", controls),
  crash: () => runTaskWorkSessionRecoveryAction("crash", controls),
  init: () => runTaskWorkSessionRecoveryAction("init", controls),
  lookupAbsent: () => runTaskWorkSessionRecoveryAction("lookupAbsent", controls),
  lookupConflict: () => runTaskWorkSessionRecoveryAction("lookupConflict", controls),
  lookupContradictoryAbsence: () => runTaskWorkSessionRecoveryAction("lookupContradictoryAbsence", controls),
  lookupMatching: () => runTaskWorkSessionRecoveryAction("lookupMatching", controls),
  lookupUnreadable: () => runTaskWorkSessionRecoveryAction("lookupUnreadable", controls),
  recordLookup: () => runTaskWorkSessionRecoveryAction("recordLookup", controls),
  recordOutcome: () => runTaskWorkSessionRecoveryAction("recordOutcome", controls),
  requestCreatesNothing: () => runTaskWorkSessionRecoveryAction("requestCreatesNothing", controls),
  requestCreatesSession: () => runTaskWorkSessionRecoveryAction("requestCreatesSession", controls),
  restart: () => runTaskWorkSessionRecoveryAction("restart", controls),
  selectIdentity: () => runTaskWorkSessionRecoveryAction("selectIdentity", controls)
})

/**
 * Resolves one event to a conformance-test cut-point label.
 *
 * @internal P0–P6 are test vocabulary. They are not production workflow
 * stages, states, events, priorities, or runtime terminology.
 */
export const taskWorkSessionRecoveryConformanceCutPointFor = (
  event: WorkflowJournalEvent
): TaskWorkSessionRecoveryConformanceCutPoint | undefined => {
  const noConformanceCutPoint = (): undefined => undefined
  return Match.valueTags(event, {
    ImplementationConvergenceDispositionRecorded: noConformanceCutPoint,
    ImplementationEvidenceSealed: noConformanceCutPoint,
    ImplementationEvidenceSealingIntended: noConformanceCutPoint,
    ImplementationReviewCompleted: noConformanceCutPoint,
    ImplementationReviewIntended: noConformanceCutPoint,
    ReviewFindingsHandbackCompleted: noConformanceCutPoint,
    ReviewFindingsHandbackIntended: noConformanceCutPoint,
    TaskAttemptPlanned: noConformanceCutPoint,
    TaskClaimAcquired: noConformanceCutPoint,
    TaskClaimAcquisitionIntended: noConformanceCutPoint,
    TaskExecutionIntentRecorded: noConformanceCutPoint,
    TaskExecutionObservationFailed: noConformanceCutPoint,
    TaskExecutionOutcomeObserved: noConformanceCutPoint,
    TaskExecutionReported: noConformanceCutPoint,
    TaskExecutionRequestAttemptRecorded: noConformanceCutPoint,
    TaskExecutionRequestFailed: noConformanceCutPoint,
    TaskExecutionRequestReturned: noConformanceCutPoint,
    TaskWorkSessionEstablished: (): TaskWorkSessionRecoveryConformanceCutPoint => "P6",
    TaskWorkSessionEstablishmentIntentRecorded: (): TaskWorkSessionRecoveryConformanceCutPoint => "P1",
    TaskWorkSessionLookupFailed: (): TaskWorkSessionRecoveryConformanceCutPoint => "P5",
    TaskWorkSessionLookupRequested: (): TaskWorkSessionRecoveryConformanceCutPoint => "P4",
    TaskWorkSessionReported: (): TaskWorkSessionRecoveryConformanceCutPoint => "P5",
    TaskWorkSessionResultReported: noConformanceCutPoint,
    TaskWorkStartRequestAcknowledged: (): TaskWorkSessionRecoveryConformanceCutPoint => "P3",
    TaskWorkStartRequestFailed: (): TaskWorkSessionRecoveryConformanceCutPoint => "P3",
    TaskWorkStartRequested: (): TaskWorkSessionRecoveryConformanceCutPoint => "P2",
    TaskWorktreeReady: noConformanceCutPoint,
    TaskWorktreeReconciliationIntended: noConformanceCutPoint,
    TechnicalRetryDeferralSuperseded: noConformanceCutPoint,
    TechnicalRetryPolicyCaptured: noConformanceCutPoint,
    TechnicalRetryScheduled: noConformanceCutPoint,
    TrackerGraphObservationIntentRecorded: noConformanceCutPoint,
    TrackerGraphOutcomeObserved: noConformanceCutPoint
  })
}
