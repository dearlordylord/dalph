import type { Effect, Option } from "effect"
import { Context, Schema } from "effect"
import type { PlannedTaskAttempt } from "./planned-attempt.js"
import { AttemptId } from "./planned-attempt.js"
import { RunId } from "./workflow-identity.js"
import { GitCommitSha } from "./git-locator.js"
import { EvidenceReference } from "./evidence.js"

/**
 * Identifies the executor's complete work for one planned task attempt.
 * No executor-owned identity supplements this pair.
 */
export const PlannedAttemptExecutorCorrelation = Schema.Struct({ attemptId: AttemptId, runId: RunId })
export type PlannedAttemptExecutorCorrelation = typeof PlannedAttemptExecutorCorrelation.Type

/** Immutable executor-produced proof that one exact attempt accepted one exact commit. */
export const AcceptedResultEvidenceManifest = Schema.Struct({
  commit: GitCommitSha,
  correlation: PlannedAttemptExecutorCorrelation,
  formatVersion: Schema.Literal(1),
  outcome: Schema.Literal("Accepted"),
  /** The acceptance envelope is the root of the sealed workflow evidence chain. */
  predecessor: Schema.Null
})
export type AcceptedResultEvidenceManifest = typeof AcceptedResultEvidenceManifest.Type

/**
 * The exact immutable result accepted by the executor's whole bounded workflow.
 * Git and later verification still have to prove its lineage and target facts.
 */
export const AcceptedResult = Schema.Struct({ commit: GitCommitSha, evidenceManifest: EvidenceReference })
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

/** An injected executor could not complete the requested outer command. */
export class PlannedAttemptExecutorCommandFailure extends Schema.TaggedError<PlannedAttemptExecutorCommandFailure>()(
  "PlannedAttemptExecutorCommandFailure",
  {
    command: Schema.Literals(["StartOrContinue", "Suspend"]),
    correlation: PlannedAttemptExecutorCorrelation,
    detail: Schema.String
  }
) {}

export interface PlannedAttemptExecutorService {
  readonly project: (
    correlation: PlannedAttemptExecutorCorrelation
  ) => Effect.Effect<Option.Option<PlannedAttemptExecutorReport>>
  readonly requestSuspension: (
    plannedAttempt: PlannedTaskAttempt
  ) => Effect.Effect<PlannedAttemptExecutorReport, PlannedAttemptExecutorCommandFailure>
  readonly startOrContinue: (
    plannedAttempt: PlannedTaskAttempt
  ) => Effect.Effect<PlannedAttemptExecutorReport, PlannedAttemptExecutorCommandFailure>
}

/** The injected boundary for all executor work on one exact planned attempt. */
export class PlannedAttemptExecutor extends Context.Service<PlannedAttemptExecutor, PlannedAttemptExecutorService>()(
  "@dalph/PlannedAttemptExecutor"
) {}
