import {
  type PlannedAttemptExecutorCorrelation,
  PlannedAttemptExecutorProjection,
  type PlannedAttemptExecutorReport,
  plannedAttemptExecutorCorrelationKey,
  samePlannedAttemptExecutorCorrelation
} from "@dalph/contracts"
import { Effect, Ref } from "effect"
import { AuthoredCassetteInteractionMismatch, type StoryCursor } from "./authored-cursor.js"

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
