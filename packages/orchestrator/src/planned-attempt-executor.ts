import { Context, Effect, Layer, Option, Ref, Schema } from "effect"
import { AttemptId, RunId } from "./domain.js"
import type { PlannedTaskAttempt as PlannedTaskAttemptType } from "./domain.js"

/**
 * Identifies the executor's complete work for one planned task attempt.
 * No executor-owned identity supplements this pair.
 */
export const PlannedAttemptExecutorCorrelation = Schema.Struct({ attemptId: AttemptId, runId: RunId })
export type PlannedAttemptExecutorCorrelation = typeof PlannedAttemptExecutorCorrelation.Type

/** The normalized terminal result of all executor work for one planned attempt. */
export const PlannedAttemptExecutorResult = Schema.TaggedUnion({ Completed: {}, Failed: {} })
export type PlannedAttemptExecutorResult = typeof PlannedAttemptExecutorResult.Type

/**
 * The executor's current report for its complete work on one planned attempt.
 * Safe suspension proves that no executor-owned activity for the attempt remains
 * running and that the same attempt can resume.
 */
export const PlannedAttemptExecutorReport = Schema.TaggedUnion({
  Running: { correlation: PlannedAttemptExecutorCorrelation },
  SafelySuspended: { correlation: PlannedAttemptExecutorCorrelation },
  Terminal: { correlation: PlannedAttemptExecutorCorrelation, result: PlannedAttemptExecutorResult }
})
export type PlannedAttemptExecutorReport = typeof PlannedAttemptExecutorReport.Type

export const plannedAttemptExecutorCorrelation = (
  plannedAttempt: PlannedTaskAttemptType
): PlannedAttemptExecutorCorrelation =>
  PlannedAttemptExecutorCorrelation.make({ attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId })

const reportCorrelation = (report: PlannedAttemptExecutorReport): PlannedAttemptExecutorCorrelation =>
  report.correlation

const sameCorrelation = (left: PlannedAttemptExecutorCorrelation, right: PlannedAttemptExecutorCorrelation): boolean =>
  left.runId === right.runId && left.attemptId === right.attemptId

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

/** The controlled fake received a request other than the next cassette entry. */
export class ControlledFakeExecutorMismatch extends Schema.TaggedErrorClass<ControlledFakeExecutorMismatch>()(
  "ControlledFakeExecutorMismatch",
  { detail: Schema.String }
) {}

export interface PlannedAttemptExecutorService {
  readonly project: (
    correlation: PlannedAttemptExecutorCorrelation
  ) => Effect.Effect<Option.Option<PlannedAttemptExecutorReport>>
  readonly requestSuspension: (
    plannedAttempt: PlannedTaskAttemptType
  ) => Effect.Effect<PlannedAttemptExecutorReport, ControlledFakeExecutorMismatch>
  readonly startOrContinue: (
    plannedAttempt: PlannedTaskAttemptType
  ) => Effect.Effect<PlannedAttemptExecutorReport, ControlledFakeExecutorMismatch>
}

/** The injected boundary for all executor work on one exact planned attempt. */
export class PlannedAttemptExecutor extends Context.Service<PlannedAttemptExecutor, PlannedAttemptExecutorService>()(
  "@dalph/PlannedAttemptExecutor"
) {}

interface ControlledFakeExecutorState {
  readonly remaining: ReadonlyArray<ControlledFakeExecutorStep>
  readonly reports: ReadonlyMap<string, PlannedAttemptExecutorReport>
}

export const plannedAttemptExecutorCorrelationKey = (correlation: PlannedAttemptExecutorCorrelation): string =>
  JSON.stringify({ attemptId: correlation.attemptId, runId: correlation.runId })

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
        plannedAttempt: PlannedTaskAttemptType
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
    const reports = yield* Ref.make<ReadonlyMap<string, PlannedAttemptExecutorReport>>(new Map())
    const record = (plannedAttempt: PlannedTaskAttemptType, report: PlannedAttemptExecutorReport) =>
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
