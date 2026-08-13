import {
  PlannedAttemptExecutor,
  PlannedAttemptExecutorReport,
  plannedAttemptExecutorCorrelation,
  plannedAttemptExecutorCorrelationKey,
  type PlannedAttemptExecutorReport as PlannedAttemptExecutorReportType,
  type PlannedTaskAttempt
} from "@dalph/contracts"
import { Effect, Layer, Option, Ref } from "effect"

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
          Effect.map((current) =>
            Option.fromUndefinedOr(current.get(plannedAttemptExecutorCorrelationKey(correlation)))
          )
        ),
      requestSuspension: (attempt) => {
        const correlation = plannedAttemptExecutorCorrelation(attempt)
        return record(attempt, PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation }))
      },
      startOrContinue: (attempt) => {
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
