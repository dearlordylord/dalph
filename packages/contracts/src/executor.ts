import type { Effect, Option } from "effect"
import { Context, Schema } from "effect"
import type { PlannedTaskAttempt } from "./planned-attempt.js"
import { AttemptId } from "./planned-attempt.js"
import { RunId } from "./workflow-identity.js"
import { GitCommitSha } from "./git-locator.js"

/**
 * Identifies the executor's complete work for one planned task attempt.
 * No executor-owned identity supplements this pair.
 */
export const PlannedAttemptExecutorCorrelation = Schema.Struct({ attemptId: AttemptId, runId: RunId })
export type PlannedAttemptExecutorCorrelation = typeof PlannedAttemptExecutorCorrelation.Type

/**
 * The exact immutable result accepted by the executor's whole bounded workflow.
 * Git and later verification still have to prove its lineage and target facts.
 */
export const AcceptedResult = Schema.Struct({ commit: GitCommitSha })
export type AcceptedResult = typeof AcceptedResult.Type

/** The normalized terminal result of all executor work for one planned attempt. */
export const PlannedAttemptExecutorResult = Schema.TaggedUnion({
  Accepted: { acceptedResult: AcceptedResult },
  Completed: {},
  Failed: {}
})
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
  plannedAttempt: PlannedTaskAttempt
): PlannedAttemptExecutorCorrelation =>
  PlannedAttemptExecutorCorrelation.make({ attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId })

export const plannedAttemptExecutorCorrelationKey = (correlation: PlannedAttemptExecutorCorrelation): string =>
  JSON.stringify({ attemptId: correlation.attemptId, runId: correlation.runId })

/** The controlled milestone executor received a request that did not match its next expected step. */
export class ControlledFakeExecutorMismatch extends Schema.TaggedError<ControlledFakeExecutorMismatch>()(
  "ControlledFakeExecutorMismatch",
  { detail: Schema.String }
) {}

export interface PlannedAttemptExecutorService {
  readonly project: (
    correlation: PlannedAttemptExecutorCorrelation
  ) => Effect.Effect<Option.Option<PlannedAttemptExecutorReport>>
  readonly requestSuspension: (
    plannedAttempt: PlannedTaskAttempt
  ) => Effect.Effect<PlannedAttemptExecutorReport, ControlledFakeExecutorMismatch>
  readonly startOrContinue: (
    plannedAttempt: PlannedTaskAttempt
  ) => Effect.Effect<PlannedAttemptExecutorReport, ControlledFakeExecutorMismatch>
}

/** The injected boundary for all executor work on one exact planned attempt. */
export class PlannedAttemptExecutor extends Context.Service<PlannedAttemptExecutor, PlannedAttemptExecutorService>()(
  "@dalph/PlannedAttemptExecutor"
) {}
