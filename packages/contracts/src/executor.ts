import type { Effect } from "effect"
import { Context, Schema } from "effect"
import { AttemptId, PlannedTaskAttempt } from "./planned-attempt.js"
import { RunId } from "./workflow-identity.js"
import { GitCommitSha } from "./git-locator.js"
import { EvidenceReference } from "./evidence.js"
import { TaskWorkSpecification } from "./task-work-specification.js"

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

/**
 * The normalized result of asking the opaque executor for current state.
 * Every outcome carries the executor-observed correlation so the outer
 * protocol never has to infer identity from the request. NoReport means the
 * executor returned no current normalized report for that exact correlation;
 * it does not prove that the attempt is absent or replaceable. The opaque
 * boundary exposes only this algebra, never executor-owned sessions,
 * processes, or provider identities.
 *
 * The check below makes a contradictory encoding invalid when the outcome is
 * decoded: a CorrelationContradiction must contain a genuinely foreign
 * observed report. Exact identity is carried by the report itself.
 */
export const samePlannedAttemptExecutorCorrelation = (
  left: PlannedAttemptExecutorCorrelation,
  right: PlannedAttemptExecutorCorrelation
): boolean => left.attemptId === right.attemptId && left.runId === right.runId

const PlannedAttemptExecutorProjectionShape = Schema.TaggedUnion({
  Exact: { report: PlannedAttemptExecutorReport },
  NoReport: { correlation: PlannedAttemptExecutorCorrelation },
  TemporarilyUnavailable: { correlation: PlannedAttemptExecutorCorrelation },
  Unreadable: { correlation: PlannedAttemptExecutorCorrelation },
  CorrelationContradiction: { expected: PlannedAttemptExecutorCorrelation, observed: PlannedAttemptExecutorReport }
}).check(
  Schema.makeFilter((projection) => {
    if (projection._tag === "CorrelationContradiction") {
      return samePlannedAttemptExecutorCorrelation(projection.expected, projection.observed.correlation)
        ? "Correlation contradiction must contain a foreign observed report"
        : undefined
    }
    return undefined
  })
)

export const PlannedAttemptExecutorProjection = PlannedAttemptExecutorProjectionShape
export type PlannedAttemptExecutorProjection = typeof PlannedAttemptExecutorProjection.Type

export const plannedAttemptExecutorCorrelation = (
  plannedAttempt: PlannedTaskAttempt
): PlannedAttemptExecutorCorrelation =>
  PlannedAttemptExecutorCorrelation.make({ attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId })

export const plannedAttemptExecutorCorrelationKey = (correlation: PlannedAttemptExecutorCorrelation): string =>
  JSON.stringify({ attemptId: correlation.attemptId, runId: correlation.runId })

/** The exact tracker-authored instructions supplied for one planned attempt's task turn. */
export const PlannedAttemptExecutorRequest = Schema.Struct({
  plannedAttempt: PlannedTaskAttempt,
  specification: TaskWorkSpecification
}).check(
  Schema.makeFilter(({ plannedAttempt, specification }) =>
    specification.taskId !== plannedAttempt.taskId
      ? "executor work request specification task must match the planned attempt"
      : specification.fingerprint !== plannedAttempt.taskRevision
        ? "executor work request specification fingerprint must match the planned attempt"
        : undefined
  )
)
export type PlannedAttemptExecutorRequest = typeof PlannedAttemptExecutorRequest.Type

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
  readonly project: (correlation: PlannedAttemptExecutorCorrelation) => Effect.Effect<PlannedAttemptExecutorProjection>
  readonly requestSuspension: (
    plannedAttempt: PlannedTaskAttempt
  ) => Effect.Effect<PlannedAttemptExecutorReport, PlannedAttemptExecutorCommandFailure>
  readonly startOrContinue: (
    request: PlannedAttemptExecutorRequest
  ) => Effect.Effect<PlannedAttemptExecutorReport, PlannedAttemptExecutorCommandFailure>
}

/** The injected boundary for all executor work on one exact planned attempt. */
export class PlannedAttemptExecutor extends Context.Service<PlannedAttemptExecutor, PlannedAttemptExecutorService>()(
  "@dalph/PlannedAttemptExecutor"
) {}
