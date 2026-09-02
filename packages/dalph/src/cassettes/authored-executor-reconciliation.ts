import {
  type PlannedAttemptExecutorCorrelation,
  PlannedAttemptExecutorProjection,
  type PlannedAttemptExecutorReport,
  type PlannedTaskAttempt,
  type RunId,
  plannedAttemptExecutorCorrelationKey,
  samePlannedAttemptExecutorCorrelation
} from "@dalph/contracts"
import { Effect, Ref } from "effect"
import {
  AuthoredCassetteInteractionMismatch,
  type AuthoredSafelySuspendedExecutorReportItem,
  type StoryCursor
} from "./authored-cursor.js"

type ControlledExecutorRequest = "Begin" | "Resume" | "Suspend"

interface ControlledExecutorCallbacks {
  readonly beforeExecutorReport: (
    plannedAttempt: PlannedTaskAttempt,
    request: ControlledExecutorRequest
  ) => Effect.Effect<void>
  readonly prepareReport?: (report: PlannedAttemptExecutorReport) => Effect.Effect<PlannedAttemptExecutorReport>
  readonly reportMismatch?: (failure: AuthoredCassetteInteractionMismatch) => Effect.Effect<void>
  readonly reserveAcceptedSafeReport?: (item: AuthoredSafelySuspendedExecutorReportItem) => Effect.Effect<void>
}

interface ControlledExecutorState {
  readonly cursor: StoryCursor
  readonly runId: RunId
  readonly survivingReports: Ref.Ref<ReadonlyMap<string, PlannedAttemptExecutorReport>>
  readonly unresolvedLostResponses: Ref.Ref<ReadonlySet<string>>
}

/** Correlated state and controlled boundary callbacks for one exact executor/Run adapter. */
export type ControlledExecutorConfig = ControlledExecutorCallbacks & ControlledExecutorState

/** Reconciles one accepted Safe fact whose ordinary publication response was cut off by process death. */
export const reconcileReservedSafelySuspendedExecutorReport = Effect.fn(
  "AuthoredCassette.PlannedAttemptExecutor.reconcileReservedSafe"
)(function* (request: {
  readonly correlation: PlannedAttemptExecutorCorrelation
  readonly cursor: StoryCursor
  readonly reportInteractionMismatch: (failure: AuthoredCassetteInteractionMismatch) => Effect.Effect<void>
  readonly reports: Ref.Ref<ReadonlyMap<string, PlannedAttemptExecutorReport>>
  readonly unresolvedLostResponses: Ref.Ref<ReadonlySet<string>>
}) {
  const key = plannedAttemptExecutorCorrelationKey(request.correlation)
  const unresolved = (yield* Ref.get(request.unresolvedLostResponses)).has(key)
  const report = (yield* Ref.get(request.reports)).get(key)
  if (
    unresolved ||
    report?._tag !== "ExecutorWorkSafelySuspended" ||
    !samePlannedAttemptExecutorCorrelation(report.correlation, request.correlation)
  ) {
    const failure = new AuthoredCassetteInteractionMismatch({
      actual: JSON.stringify({
        correlation: report?.correlation ?? null,
        report: report?._tag ?? "NoReport",
        unresolved
      }),
      expected: `committed ExecutorWorkSafelySuspended for ${request.correlation.attemptId}`,
      storyPosition: yield* request.cursor.storyPosition
    })
    yield* request.reportInteractionMismatch(failure)
    return yield* Effect.die(failure)
  }
  return PlannedAttemptExecutorProjection.cases.Exact.make({ report })
})
