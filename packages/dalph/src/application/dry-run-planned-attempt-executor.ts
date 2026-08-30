import {
  PlannedAttemptExecutor,
  PlannedAttemptExecutorLifecycleObservation,
  PlannedAttemptExecutorProjection,
  PlannedAttemptExecutorReport,
  plannedAttemptExecutorCorrelation,
  plannedAttemptExecutorCorrelationKey,
  type PlannedAttemptExecutorCorrelation,
  type PlannedAttemptExecutorReport as PlannedAttemptExecutorReportType,
  type PlannedTaskAttempt
} from "@dalph/contracts"
import { Context, Effect, Layer, Ref, Stream } from "effect"

/**
 * Deterministic executor boundary used only by the fixture dry-run command.
 * Production composition receives its boundary implementation from its caller.
 */
export const dryRunPlannedAttemptExecutorLayer = Layer.effectContext(
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

    const projectionFor = (
      correlation: PlannedAttemptExecutorCorrelation,
      current: ReadonlyMap<string, PlannedAttemptExecutorReportType>
    ): PlannedAttemptExecutorProjection => {
      const report = current.get(plannedAttemptExecutorCorrelationKey(correlation))
      return report === undefined
        ? PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation })
        : PlannedAttemptExecutorProjection.cases.Exact.make({ report })
    }

    const executor = PlannedAttemptExecutor.of({
      observe: Effect.fn("DryRunPlannedAttemptExecutor.observe")((correlation) =>
        Ref.get(reports).pipe(Effect.map((current) => projectionFor(correlation, current)))
      ),
      requestSuspension: (attempt) => {
        const correlation = plannedAttemptExecutorCorrelation(attempt)
        return record(attempt, PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation }))
      },
      begin: Effect.fn("DryRunPlannedAttemptExecutor.begin")(function* (request) {
        const attempt = request.plannedAttempt
        const correlation = plannedAttemptExecutorCorrelation(attempt)
        const executing = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
        yield* record(attempt, executing)
        // A dry run has no outside process, so it autonomously completes during Begin; Observe remains a pure read.
        yield* record(
          attempt,
          PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({ correlation, result: { _tag: "Completed" } })
        )
        return executing
      }),
      resume: (request) =>
        record(
          request.plannedAttempt,
          PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
            correlation: plannedAttemptExecutorCorrelation(request.plannedAttempt)
          })
        )
    })
    const lifecycle = PlannedAttemptExecutorLifecycleObservation.of({
      attach: (correlation) =>
        Ref.get(reports).pipe(
          Effect.map((current) => ({
            // Dry-run commands complete synchronously and own no autonomous
            // provider process, so no later lifecycle notification can occur.
            changes: Stream.empty,
            close: Effect.void,
            current: projectionFor(correlation, current)
          }))
        )
    })
    return Context.empty().pipe(
      Context.add(PlannedAttemptExecutor, executor),
      Context.add(PlannedAttemptExecutorLifecycleObservation, lifecycle)
    )
  })
)
