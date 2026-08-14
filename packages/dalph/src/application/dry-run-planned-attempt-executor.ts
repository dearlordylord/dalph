import {
  PlannedAttemptExecutor,
  PlannedAttemptExecutorProjection,
  PlannedAttemptExecutorReport,
  plannedAttemptExecutorCorrelation,
  plannedAttemptExecutorCorrelationKey,
  type PlannedAttemptExecutorReport as PlannedAttemptExecutorReportType,
  type PlannedTaskAttempt
} from "@dalph/contracts"
import { Effect, Layer, Ref } from "effect"

/**
 * Deterministic executor boundary used only by the fixture dry-run command.
 * Production composition receives its boundary implementation from its caller.
 */
export const dryRunPlannedAttemptExecutorLayer = Layer.effect(
  PlannedAttemptExecutor,
  Effect.gen(function* () {
    const reports = yield* Ref.make<ReadonlyMap<string, PlannedAttemptExecutorReportType>>(new Map())
    const record = (attempt: PlannedTaskAttempt, report: PlannedAttemptExecutorReportType) =>
      Ref.update(
        reports,
        (current) =>
          new Map([
            ...current,
            [plannedAttemptExecutorCorrelationKey(plannedAttemptExecutorCorrelation(attempt)), report]
          ])
      ).pipe(Effect.as(report))

    return PlannedAttemptExecutor.of({
      project: (correlation) =>
        Ref.get(reports).pipe(
          Effect.map((current) => {
            const report = current.get(plannedAttemptExecutorCorrelationKey(correlation))
            return report === undefined
              ? PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation })
              : PlannedAttemptExecutorProjection.cases.Exact.make({ report })
          })
        ),
      requestSuspension: (attempt) => {
        const correlation = plannedAttemptExecutorCorrelation(attempt)
        return record(attempt, PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation }))
      },
      startOrContinue: (request) => {
        const attempt = request.plannedAttempt
        const correlation = plannedAttemptExecutorCorrelation(attempt)
        return Ref.get(reports).pipe(
          Effect.flatMap((current) =>
            record(
              attempt,
              current.get(plannedAttemptExecutorCorrelationKey(correlation))?._tag === "Running"
                ? PlannedAttemptExecutorReport.cases.Terminal.make({ correlation, result: { _tag: "Completed" } })
                : PlannedAttemptExecutorReport.cases.Running.make({ correlation })
            )
          )
        )
      }
    })
  })
)
