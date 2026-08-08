import {
  ControlledFakeExecutorMismatch,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorCorrelation,
  PlannedAttemptExecutorReport,
  plannedAttemptExecutorCorrelation,
  plannedAttemptExecutorCorrelationKey
} from "@dalph/contracts"
import type {
  PlannedAttemptExecutorCorrelation as PlannedAttemptExecutorCorrelationType,
  PlannedAttemptExecutorReport as PlannedAttemptExecutorReportType,
  PlannedTaskAttempt
} from "@dalph/contracts"
import { Effect, Layer, Option, Ref, Schema } from "effect"

const reportCorrelation = (report: PlannedAttemptExecutorReportType): PlannedAttemptExecutorCorrelationType =>
  report.correlation

const sameCorrelation = (
  left: PlannedAttemptExecutorCorrelationType,
  right: PlannedAttemptExecutorCorrelationType
): boolean => left.runId === right.runId && left.attemptId === right.attemptId

/** One expected request and deterministic response in the controlled fake. */
export const ControlledFakeExecutorStep = Schema.TaggedUnion({
  StartOrContinue: { correlation: PlannedAttemptExecutorCorrelation, report: PlannedAttemptExecutorReport },
  Suspend: { correlation: PlannedAttemptExecutorCorrelation, report: PlannedAttemptExecutorReport }
}).check(
  Schema.makeFilter((step) =>
    sameCorrelation(step.correlation, reportCorrelation(step.report))
      ? undefined
      : "controlled fake request and report must name the same planned attempt"
  )
)
export type ControlledFakeExecutorStep = typeof ControlledFakeExecutorStep.Type

interface ControlledFakeExecutorState {
  readonly remaining: ReadonlyArray<ControlledFakeExecutorStep>
  readonly reports: ReadonlyMap<string, PlannedAttemptExecutorReportType>
}

/**
 * Creates a same-process deterministic executor. Losing the Layer scope loses
 * every process-local report; a recreated Layer consumes only its new cassette.
 */
export const makeControlledFakePlannedAttemptExecutorLayer = (steps: ReadonlyArray<ControlledFakeExecutorStep>) =>
  Layer.effect(
    PlannedAttemptExecutor,
    Effect.gen(function* () {
      const state = yield* Ref.make<ControlledFakeExecutorState>({ remaining: steps, reports: new Map() })

      const consume = Effect.fn("ControlledFakeExecutor.consume")(function* (
        requestTag: ControlledFakeExecutorStep["_tag"],
        plannedAttempt: PlannedTaskAttempt
      ) {
        const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
        const step = yield* Ref.modify(
          state,
          (current) => [current.remaining[0], { ...current, remaining: current.remaining.slice(1) }] as const
        )
        if (step === undefined) {
          return yield* new ControlledFakeExecutorMismatch({
            detail: `${requestTag} for ${plannedAttemptExecutorCorrelationKey(correlation)} has no cassette entry`
          })
        }
        if (step._tag !== requestTag || !sameCorrelation(step.correlation, correlation)) {
          return yield* new ControlledFakeExecutorMismatch({
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
            Effect.map((current) =>
              Option.fromUndefinedOr(current.reports.get(plannedAttemptExecutorCorrelationKey(correlation)))
            )
          ),
        requestSuspension: (plannedAttempt) => consume("Suspend", plannedAttempt),
        startOrContinue: (plannedAttempt) => consume("StartOrContinue", plannedAttempt)
      })
    })
  )

/** Default milestone fake: first continuation runs, the next completes, and stop safely suspends. */
export const controlledFakePlannedAttemptExecutorLayer = Layer.effect(
  PlannedAttemptExecutor,
  Effect.gen(function* () {
    const reports = yield* Ref.make<ReadonlyMap<string, PlannedAttemptExecutorReportType>>(new Map())
    const record = (plannedAttempt: PlannedTaskAttempt, report: PlannedAttemptExecutorReportType) =>
      Ref.update(
        reports,
        (current) =>
          new Map([
            ...current,
            [plannedAttemptExecutorCorrelationKey(plannedAttemptExecutorCorrelation(plannedAttempt)), report]
          ])
      ).pipe(Effect.as(report))
    return PlannedAttemptExecutor.of({
      project: (correlation) =>
        Ref.get(reports).pipe(
          Effect.map((current) =>
            Option.fromUndefinedOr(current.get(plannedAttemptExecutorCorrelationKey(correlation)))
          )
        ),
      requestSuspension: (plannedAttempt) => {
        const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
        return record(plannedAttempt, PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation }))
      },
      startOrContinue: (plannedAttempt) => {
        const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
        return Ref.get(reports).pipe(
          Effect.flatMap((current) => {
            const prior = current.get(plannedAttemptExecutorCorrelationKey(correlation))
            return record(
              plannedAttempt,
              prior?._tag === "Running"
                ? PlannedAttemptExecutorReport.cases.Terminal.make({ correlation, result: { _tag: "Completed" } })
                : PlannedAttemptExecutorReport.cases.Running.make({ correlation })
            )
          })
        )
      }
    })
  })
)
