import {
  PlannedAttemptExecutorCommandFailure,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorCorrelation,
  PlannedAttemptExecutorProjection,
  PlannedAttemptExecutorReport,
  type PlannedAttemptExecutorRequest,
  plannedAttemptExecutorCorrelation,
  plannedAttemptExecutorCorrelationKey,
  type PlannedAttemptExecutorCorrelation as PlannedAttemptExecutorCorrelationType,
  type PlannedAttemptExecutorReport as PlannedAttemptExecutorReportType,
  type PlannedTaskAttempt
} from "@dalph/contracts"
import { Effect, Layer, Ref, Schema } from "effect"

const sameCorrelation = (
  left: PlannedAttemptExecutorCorrelationType,
  right: PlannedAttemptExecutorCorrelationType
): boolean => left.runId === right.runId && left.attemptId === right.attemptId

/** One expected request and deterministic response in the contract-only test adapter. */
export const ControlledFakeExecutorStep = Schema.TaggedUnion({
  StartOrContinue: { correlation: PlannedAttemptExecutorCorrelation, report: PlannedAttemptExecutorReport },
  Suspend: { correlation: PlannedAttemptExecutorCorrelation, report: PlannedAttemptExecutorReport }
}).check(
  Schema.makeFilter((step) =>
    sameCorrelation(step.correlation, step.report.correlation)
      ? undefined
      : "controlled fake request and report must name the same planned attempt"
  )
)
export type ControlledFakeExecutorStep = typeof ControlledFakeExecutorStep.Type

interface State {
  readonly remaining: ReadonlyArray<ControlledFakeExecutorStep>
  readonly reports: ReadonlyMap<string, PlannedAttemptExecutorReportType>
}

export const makeControlledFakePlannedAttemptExecutorLayer = (steps: ReadonlyArray<ControlledFakeExecutorStep>) =>
  Layer.effect(
    PlannedAttemptExecutor,
    Effect.gen(function* () {
      const state = yield* Ref.make<State>({ remaining: steps, reports: new Map() })
      const consume = Effect.fn("PlannedAttemptExecutor.Test.consume")(function* (
        requestTag: ControlledFakeExecutorStep["_tag"],
        request: PlannedAttemptExecutorRequest | PlannedTaskAttempt
      ) {
        const plannedAttempt = "plannedAttempt" in request ? request.plannedAttempt : request
        const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
        const step = yield* Ref.modify(
          state,
          (current) => [current.remaining[0], { ...current, remaining: current.remaining.slice(1) }] as const
        )
        if (step === undefined) {
          return yield* new PlannedAttemptExecutorCommandFailure({
            command: requestTag,
            correlation,
            detail: `${requestTag} for ${plannedAttemptExecutorCorrelationKey(correlation)} has no cassette entry`
          })
        }
        if (step._tag !== requestTag || !sameCorrelation(step.correlation, correlation)) {
          return yield* new PlannedAttemptExecutorCommandFailure({
            command: requestTag,
            correlation,
            detail: `expected ${step._tag} for ${plannedAttemptExecutorCorrelationKey(
              step.correlation
            )}, received ${requestTag} for ${plannedAttemptExecutorCorrelationKey(correlation)}`
          })
        }
        yield* Ref.update(state, (current) => ({
          ...current,
          reports: new Map([...current.reports, [plannedAttemptExecutorCorrelationKey(correlation), step.report]])
        }))
        return step.report
      })
      return PlannedAttemptExecutor.of({
        project: (correlation) =>
          Ref.get(state).pipe(
            Effect.map((current) => {
              const report = current.reports.get(plannedAttemptExecutorCorrelationKey(correlation))
              return report === undefined
                ? PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation })
                : PlannedAttemptExecutorProjection.cases.Exact.make({ report })
            })
          ),
        requestSuspension: (attempt) => consume("Suspend", attempt),
        startOrContinue: (request) => consume("StartOrContinue", request)
      })
    })
  )

export const controlledFakePlannedAttemptExecutorLayer = Layer.effect(
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
