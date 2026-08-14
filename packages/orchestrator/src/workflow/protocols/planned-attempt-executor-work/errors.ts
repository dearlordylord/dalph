import {
  type PlannedAttemptExecutorCorrelation,
  type PlannedAttemptExecutorProjection,
  PlannedAttemptExecutorCorrelation as PlannedAttemptExecutorCorrelationSchema,
  samePlannedAttemptExecutorCorrelation,
  PlannedTaskAttempt as PlannedTaskAttemptSchema,
  TaskWorkSpecification as TaskWorkSpecificationSchema
} from "@dalph/contracts"
import { Schema } from "effect"
import {
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorContinuationLimit,
  PlannedAttemptExecutorSuspensionLimit
} from "./events.js"

/** An executor response named a different planned attempt than Dalph requested. */
export class PlannedAttemptExecutorCorrelationMismatch extends Schema.TaggedError<PlannedAttemptExecutorCorrelationMismatch>()(
  "PlannedAttemptExecutorCorrelationMismatch",
  { expected: PlannedAttemptExecutorCorrelationSchema, observed: PlannedAttemptExecutorCorrelationSchema }
) {}

/** The exact attempt consumed its durable start-or-continue budget while the executor still reported Running. */
export class PlannedAttemptExecutorContinuationLimitReached extends Schema.TaggedError<PlannedAttemptExecutorContinuationLimitReached>()(
  "PlannedAttemptExecutorContinuationLimitReached",
  { correlation: PlannedAttemptExecutorCorrelationSchema, limit: PlannedAttemptExecutorContinuationLimit }
) {}

/** Executor work cannot restart after Dalph durably abandoned the exact planned attempt. */
export class PlannedAttemptExecutorResponsibilityAbandoned extends Schema.TaggedError<PlannedAttemptExecutorResponsibilityAbandoned>()(
  "PlannedAttemptExecutorResponsibilityAbandoned",
  { correlation: PlannedAttemptExecutorCorrelationSchema }
) {}

/** The exact attempt consumed its durable suspension-command budget without proving quiescence. */
export class PlannedAttemptExecutorSuspensionLimitReached extends Schema.TaggedError<PlannedAttemptExecutorSuspensionLimitReached>()(
  "PlannedAttemptExecutorSuspensionLimitReached",
  { correlation: PlannedAttemptExecutorCorrelationSchema, limit: PlannedAttemptExecutorSuspensionLimit }
) {}

/** Read-only reconciliation found no current executor report for one unmatched command intent. */
export class PlannedAttemptExecutorProjectionNoCurrentReport extends Schema.TaggedError<PlannedAttemptExecutorProjectionNoCurrentReport>()(
  "PlannedAttemptExecutorProjectionNoCurrentReport",
  { commandOrdinal: PlannedAttemptExecutorCommandOrdinal, correlation: PlannedAttemptExecutorCorrelationSchema }
) {}

/** The executor authority could not currently be reached while reconciling one command. */
export class PlannedAttemptExecutorProjectionTemporarilyUnavailable extends Schema.TaggedError<PlannedAttemptExecutorProjectionTemporarilyUnavailable>()(
  "PlannedAttemptExecutorProjectionTemporarilyUnavailable",
  { commandOrdinal: PlannedAttemptExecutorCommandOrdinal, correlation: PlannedAttemptExecutorCorrelationSchema }
) {}

/** The executor returned state that the outer protocol could not trust while reconciling one command. */
export class PlannedAttemptExecutorProjectionUnreadable extends Schema.TaggedError<PlannedAttemptExecutorProjectionUnreadable>()(
  "PlannedAttemptExecutorProjectionUnreadable",
  { commandOrdinal: PlannedAttemptExecutorCommandOrdinal, correlation: PlannedAttemptExecutorCorrelationSchema }
) {}

/** App initialization contradicted the exact host/protocol identity before a provider attempt report existed. */
export class PlannedAttemptExecutorInitializationCorrelationContradiction extends Schema.TaggedError<PlannedAttemptExecutorInitializationCorrelationContradiction>()(
  "PlannedAttemptExecutorInitializationCorrelationContradiction",
  { correlation: PlannedAttemptExecutorCorrelationSchema, detail: Schema.String }
) {}

/** The normalized projection carried a different outer correlation than requested. */
export class PlannedAttemptExecutorProjectionCorrelationMismatch extends Schema.TaggedError<PlannedAttemptExecutorProjectionCorrelationMismatch>()(
  "PlannedAttemptExecutorProjectionCorrelationMismatch",
  { expected: PlannedAttemptExecutorCorrelationSchema, observed: PlannedAttemptExecutorCorrelationSchema }
) {}

/** A generic current-state read cannot bypass reconciliation of an ambiguous executor command. */
export class PlannedAttemptExecutorCommandReconciliationRequired extends Schema.TaggedError<PlannedAttemptExecutorCommandReconciliationRequired>()(
  "PlannedAttemptExecutorCommandReconciliationRequired",
  { commandOrdinal: PlannedAttemptExecutorCommandOrdinal, correlation: PlannedAttemptExecutorCorrelationSchema }
) {}

/** A current-state read found no current executor report for the exact attempt. */
export class PlannedAttemptExecutorStateNoCurrentReport extends Schema.TaggedError<PlannedAttemptExecutorStateNoCurrentReport>()(
  "PlannedAttemptExecutorStateNoCurrentReport",
  { correlation: PlannedAttemptExecutorCorrelationSchema }
) {}

/** The executor authority could not currently be reached for a current-state read. */
export class PlannedAttemptExecutorStateTemporarilyUnavailable extends Schema.TaggedError<PlannedAttemptExecutorStateTemporarilyUnavailable>()(
  "PlannedAttemptExecutorStateTemporarilyUnavailable",
  { correlation: PlannedAttemptExecutorCorrelationSchema }
) {}

/** The executor returned state that the outer protocol could not trust for a current-state read. */
export class PlannedAttemptExecutorStateUnreadable extends Schema.TaggedError<PlannedAttemptExecutorStateUnreadable>()(
  "PlannedAttemptExecutorStateUnreadable",
  { correlation: PlannedAttemptExecutorCorrelationSchema }
) {}

/** A journaled responsibility uses this identity for a different immutable attempt plan. */
export class PlannedAttemptExecutorResponsibilityContradiction extends Schema.TaggedError<PlannedAttemptExecutorResponsibilityContradiction>()(
  "PlannedAttemptExecutorResponsibilityContradiction",
  { accepted: PlannedTaskAttemptSchema, requested: PlannedTaskAttemptSchema }
) {}

/** A read-only executor observation has no exact journaled workflow responsibility to observe. */
export class PlannedAttemptExecutorResponsibilityMissing extends Schema.TaggedError<PlannedAttemptExecutorResponsibilityMissing>()(
  "PlannedAttemptExecutorResponsibilityMissing",
  { correlation: PlannedAttemptExecutorCorrelationSchema }
) {}

/** No accepted authored instructions exist for the task named by the planned attempt. */
export class PlannedAttemptExecutorTaskWorkSpecificationMissing extends Schema.TaggedError<PlannedAttemptExecutorTaskWorkSpecificationMissing>()(
  "PlannedAttemptExecutorTaskWorkSpecificationMissing",
  { correlation: PlannedAttemptExecutorCorrelationSchema }
) {}

/** Accepted authored instructions for the planned task have a different immutable fingerprint. */
export class PlannedAttemptExecutorTaskWorkSpecificationMismatch extends Schema.TaggedError<PlannedAttemptExecutorTaskWorkSpecificationMismatch>()(
  "PlannedAttemptExecutorTaskWorkSpecificationMismatch",
  { plannedAttempt: PlannedTaskAttemptSchema, specification: TaskWorkSpecificationSchema }
) {}

const projectionCorrelation = (projection: PlannedAttemptExecutorProjection): PlannedAttemptExecutorCorrelation =>
  projection._tag === "CorrelationContradiction"
    ? projection.expected
    : projection._tag === "Exact"
      ? projection.report.correlation
      : projection.correlation

/** Rejects a malformed adapter result before the protocol journals or acts on it. */
export const validatePlannedAttemptExecutorProjectionCorrelation = (
  projection: PlannedAttemptExecutorProjection,
  requested: PlannedAttemptExecutorCorrelation
): PlannedAttemptExecutorProjectionCorrelationMismatch | undefined => {
  const observed = projectionCorrelation(projection)
  if (!samePlannedAttemptExecutorCorrelation(requested, observed)) {
    return new PlannedAttemptExecutorProjectionCorrelationMismatch({ expected: requested, observed })
  }
  if (
    projection._tag === "CorrelationContradiction" &&
    samePlannedAttemptExecutorCorrelation(projection.expected, projection.observed.correlation)
  ) {
    return new PlannedAttemptExecutorProjectionCorrelationMismatch({
      expected: projection.expected,
      observed: projection.observed.correlation
    })
  }
  return undefined
}
