import {
  type PlannedAttemptExecutorCorrelation,
  type PlannedAttemptExecutorProjection,
  PlannedAttemptExecutorCorrelation as PlannedAttemptExecutorCorrelationSchema,
  PlannedAttemptExecutorReport as PlannedAttemptExecutorReportSchema,
  samePlannedAttemptExecutorCorrelation,
  PlannedTaskAttempt as PlannedTaskAttemptSchema,
  TaskWorkSpecification as TaskWorkSpecificationSchema
} from "@dalph/contracts"
import { Schema } from "effect"
import { PlannedAttemptExecutorCommandOrdinal, PlannedAttemptExecutorSuspensionLimit } from "./events.js"

/** An executor response named a different planned attempt than Dalph requested. */
export class PlannedAttemptExecutorCorrelationMismatch extends Schema.TaggedError<PlannedAttemptExecutorCorrelationMismatch>()(
  "PlannedAttemptExecutorCorrelationMismatch",
  { expected: PlannedAttemptExecutorCorrelationSchema, observed: PlannedAttemptExecutorCorrelationSchema }
) {}

/** Begin is a once-only command and this exact attempt already has a durable begin intent. */
export class PlannedAttemptExecutorAlreadyBegan extends Schema.TaggedError<PlannedAttemptExecutorAlreadyBegan>()(
  "PlannedAttemptExecutorAlreadyBegan",
  { correlation: PlannedAttemptExecutorCorrelationSchema }
) {}

/** Resume requires a distinct accepted safe-suspension report not consumed by another begin or resume. */
export class PlannedAttemptExecutorResumeNotAuthorized extends Schema.TaggedError<PlannedAttemptExecutorResumeNotAuthorized>()(
  "PlannedAttemptExecutorResumeNotAuthorized",
  { correlation: PlannedAttemptExecutorCorrelationSchema }
) {}

/** A durable Stop or Restart choice consumed the accepted Safe report before Resume reached the executor. */
export class PlannedAttemptExecutorResumeInvalidatedByTerminalChoice extends Schema.TaggedError<PlannedAttemptExecutorResumeInvalidatedByTerminalChoice>()(
  "PlannedAttemptExecutorResumeInvalidatedByTerminalChoice",
  {
    choice: Schema.Literals(["RestartTaskImplementation", "StopTaskImplementation"]),
    correlation: PlannedAttemptExecutorCorrelationSchema
  }
) {}

/** Suspend requires the latest current lifecycle authority to be an accepted executing-work report. */
export class PlannedAttemptExecutorSuspensionNotAuthorized extends Schema.TaggedError<PlannedAttemptExecutorSuspensionNotAuthorized>()(
  "PlannedAttemptExecutorSuspensionNotAuthorized",
  { correlation: PlannedAttemptExecutorCorrelationSchema }
) {}

/** No work-changing executor command is valid after the exact attempt reached a terminal lifecycle condition. */
export class PlannedAttemptExecutorWorkAlreadyTerminal extends Schema.TaggedError<PlannedAttemptExecutorWorkAlreadyTerminal>()(
  "PlannedAttemptExecutorWorkAlreadyTerminal",
  { correlation: PlannedAttemptExecutorCorrelationSchema }
) {}

/** An executor projection contradicted the terminal lifecycle condition already accepted for the exact attempt. */
export class PlannedAttemptExecutorTerminalReportContradiction extends Schema.TaggedError<PlannedAttemptExecutorTerminalReportContradiction>()(
  "PlannedAttemptExecutorTerminalReportContradiction",
  { accepted: PlannedAttemptExecutorReportSchema, observed: PlannedAttemptExecutorReportSchema }
) {}

/** A passive executor projection attempted to create lifecycle authority before an exact Begin settlement. */
export class PlannedAttemptExecutorInitialReportCausalityContradiction extends Schema.TaggedError<PlannedAttemptExecutorInitialReportCausalityContradiction>()(
  "PlannedAttemptExecutorInitialReportCausalityContradiction",
  { observed: PlannedAttemptExecutorReportSchema }
) {}

/** A settled Begin returned a lifecycle report other than the required first Executing report. */
export class PlannedAttemptExecutorBeginReportContradiction extends Schema.TaggedError<PlannedAttemptExecutorBeginReportContradiction>()(
  "PlannedAttemptExecutorBeginReportContradiction",
  { observed: PlannedAttemptExecutorReportSchema }
) {}

/** A passive executor projection attempted a lifecycle transition that requires an exact work-changing command. */
export class PlannedAttemptExecutorLifecycleTransitionContradiction extends Schema.TaggedError<PlannedAttemptExecutorLifecycleTransitionContradiction>()(
  "PlannedAttemptExecutorLifecycleTransitionContradiction",
  { accepted: PlannedAttemptExecutorReportSchema, observed: PlannedAttemptExecutorReportSchema }
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
