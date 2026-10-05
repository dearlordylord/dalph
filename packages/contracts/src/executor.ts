import type {
  ExecutorGuidanceRequestId,
  ExecutorGuidanceSelection,
  ExecutorGuidanceTarget,
  ExecutorGuidanceTransmission
} from "./executor-guidance.js"
import type { Effect, Scope, Stream } from "effect"
import { Context, Schema } from "effect"
import { AttemptId, PlannedTaskAttempt } from "./planned-attempt.js"
import { RunId } from "./workflow-identity.js"
import { GitCommitSha } from "./git-locator.js"
import { EvidenceReference, evidenceReferenceEquals } from "./evidence.js"
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

/** Safe executor-observed causes; these codes carry no provider payload or retry authority. */
export const PlannedAttemptExecutorFailureCode = Schema.Literals([
  "ProviderFailed",
  "ResultEnvelopeInvalid",
  "CandidateHeadMismatch",
  "GitUnavailable",
  "LineageUnproven"
])
export type PlannedAttemptExecutorFailureCode = typeof PlannedAttemptExecutorFailureCode.Type

/** The normalized terminal result of all executor work for one planned attempt. */
export const PlannedAttemptExecutorResult = Schema.TaggedUnion({
  Accepted: { acceptedResult: AcceptedResult },
  Completed: {},
  /** Missing code is a retained legacy failure whose reason was never recorded. */
  Failed: {
    failureCode: Schema.optionalKey(PlannedAttemptExecutorFailureCode),
    /** HEAD actually read from the exact worktree; neither semantic acceptance nor current Git authority. */
    observedHead: Schema.optionalKey(GitCommitSha)
  }
})
export type PlannedAttemptExecutorResult = typeof PlannedAttemptExecutorResult.Type

/** Proven answer defects are distinct from genuine terminal provider failure. */
export const PlannedAttemptResultRejectionReason = Schema.Literals([
  "ResultEnvelopeInvalid",
  "CandidateHeadMismatch",
  "CandidateLineageInvalid"
])
export type PlannedAttemptResultRejectionReason = typeof PlannedAttemptResultRejectionReason.Type

/** Count of durably intended responses in one cycle, including its initial response. */
const firstCorrectedResponseCount = 2
const finalCorrectedResponseCount = 3
export const PlannedAttemptResultResponseCount = Schema.Literals([
  1,
  firstCorrectedResponseCount,
  finalCorrectedResponseCount
]).pipe(Schema.brand("PlannedAttemptResultResponseCount"))
export type PlannedAttemptResultResponseCount = typeof PlannedAttemptResultResponseCount.Type

/** The executor proves exact stopped writers; elapsed deadlines supply no such proof. */
export const PlannedAttemptRejectedResultCustody = Schema.TaggedUnion({ Stopped: {}, Unresolved: {} })
export type PlannedAttemptRejectedResultCustody = typeof PlannedAttemptRejectedResultCustody.Type

/** Why this cycle requires operator recovery; separate from the last proven answer defect. */
export const PlannedAttemptResultRecoveryCause = Schema.Literals([
  "CorrectionExhausted",
  "Deadline",
  "WriterCustodyUnresolved"
])
export type PlannedAttemptResultRecoveryCause = typeof PlannedAttemptResultRecoveryCause.Type

const rejectionCycleConsistency = (report: {
  readonly recoveryCause: PlannedAttemptResultRecoveryCause
  readonly responseCount: PlannedAttemptResultResponseCount
}): string | undefined => {
  if (report.recoveryCause === "CorrectionExhausted" && report.responseCount !== finalCorrectedResponseCount)
    return "Correction exhaustion requires all three responses"
  if (report.recoveryCause === "Deadline" && report.responseCount < firstCorrectedResponseCount)
    return "Only an additional correction response has a deadline"
  return undefined
}

/**
 * Pre-seal recovery observation. This is deliberately outside the terminal
 * result algebra. Lifecycle admission is added only with its Run composition;
 * neither custody case grants Continue authorization by itself.
 */
export const PlannedAttemptRejectedResultReport = Schema.TaggedStruct("ExecutorWorkResultRejected", {
  correlation: PlannedAttemptExecutorCorrelation,
  reason: PlannedAttemptResultRejectionReason,
  recoveryCause: PlannedAttemptResultRecoveryCause,
  responseCount: PlannedAttemptResultResponseCount,
  custody: PlannedAttemptRejectedResultCustody
}).check(Schema.makeFilter(rejectionCycleConsistency))
export type PlannedAttemptRejectedResultReport = typeof PlannedAttemptRejectedResultReport.Type

/**
 * The executor's current report for its complete work on one planned attempt.
 * Safe suspension proves that no executor-owned activity for the attempt remains
 * running and that the same attempt can resume.
 */
export const PlannedAttemptExecutorReport = Schema.TaggedUnion({
  ExecutorWorkExecuting: { correlation: PlannedAttemptExecutorCorrelation },
  ExecutorWorkSafelySuspended: { correlation: PlannedAttemptExecutorCorrelation },
  ExecutorWorkResultRejected: {
    correlation: PlannedAttemptExecutorCorrelation,
    reason: PlannedAttemptResultRejectionReason,
    recoveryCause: PlannedAttemptResultRecoveryCause,
    responseCount: PlannedAttemptResultResponseCount,
    custody: PlannedAttemptRejectedResultCustody
  },
  ExecutorWorkTerminal: { correlation: PlannedAttemptExecutorCorrelation, result: PlannedAttemptExecutorResult }
}).check(
  Schema.makeFilter((report) =>
    report._tag === "ExecutorWorkResultRejected" ? rejectionCycleConsistency(report) : undefined
  )
)
export type PlannedAttemptExecutorReport = typeof PlannedAttemptExecutorReport.Type

const samePlannedAttemptExecutorResult = (
  left: PlannedAttemptExecutorResult,
  right: PlannedAttemptExecutorResult
): boolean => {
  if (left._tag !== right._tag) return false
  if (left._tag === "Failed" && right._tag === "Failed") {
    return left.failureCode === right.failureCode && left.observedHead === right.observedHead
  }
  if (left._tag !== "Accepted" || right._tag !== "Accepted") return true
  return (
    left.acceptedResult.commit === right.acceptedResult.commit &&
    evidenceReferenceEquals(left.acceptedResult.evidenceManifest, right.acceptedResult.evidenceManifest)
  )
}

/** Exact equality for one normalized executor lifecycle report. */
export const samePlannedAttemptExecutorReport = (
  left: PlannedAttemptExecutorReport,
  right: PlannedAttemptExecutorReport
): boolean => {
  if (!samePlannedAttemptExecutorCorrelation(left.correlation, right.correlation) || left._tag !== right._tag) {
    return false
  }
  if (left._tag === "ExecutorWorkResultRejected" && right._tag === "ExecutorWorkResultRejected")
    return (
      left.reason === right.reason &&
      left.recoveryCause === right.recoveryCause &&
      left.responseCount === right.responseCount &&
      left.custody._tag === right.custody._tag
    )
  if (left._tag !== "ExecutorWorkTerminal" || right._tag !== "ExecutorWorkTerminal") return true
  return samePlannedAttemptExecutorResult(left.result, right.result)
}

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

/** Identifies one process-local, single-use exact pre-turn read; it carries no provider identity. */
export const PlannedAttemptExecutorBeginProofId = Schema.NonEmptyString.pipe(
  Schema.brand("PlannedAttemptExecutorBeginProofId")
)
export type PlannedAttemptExecutorBeginProofId = typeof PlannedAttemptExecutorBeginProofId.Type

/** Distinguishes first delivery from completion of the same semantic Begin after reconciliation. */
export const PlannedAttemptExecutorBeginDelivery = Schema.TaggedUnion({
  InitialDelivery: {},
  ReconciledDelivery: { proofId: PlannedAttemptExecutorBeginProofId }
})
export type PlannedAttemptExecutorBeginDelivery = typeof PlannedAttemptExecutorBeginDelivery.Type

const PlannedAttemptExecutorProjectionShape = Schema.TaggedUnion({
  Exact: { report: PlannedAttemptExecutorReport },
  /** Fresh exact pre-turn authority, available only while reconciling Begin; never a lifecycle report. */
  BeginNotCrossed: { correlation: PlannedAttemptExecutorCorrelation, proofId: PlannedAttemptExecutorBeginProofId },
  NoReport: { correlation: PlannedAttemptExecutorCorrelation },
  TemporarilyUnavailable: { correlation: PlannedAttemptExecutorCorrelation },
  /** The executor could not prove a current state; detail is process-local diagnostic context. */
  Unreadable: { correlation: PlannedAttemptExecutorCorrelation, detail: Schema.optionalKey(Schema.String) },
  /** The pre-attempt app initialization response contradicted the requested host/protocol identity. */
  InitializationCorrelationContradiction: { correlation: PlannedAttemptExecutorCorrelation, detail: Schema.String },
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

/** Exact equality for normalized lifecycle projections, including foreign evidence. */
export const samePlannedAttemptExecutorProjection = Schema.toEquivalence(PlannedAttemptExecutorProjection)

/** Distinguishes a passive lifecycle read from reconciliation of one exact ambiguous command. */
export const PlannedAttemptExecutorObservationPurpose = Schema.TaggedUnion({
  PassiveLifecycleObservation: {},
  ReconcileCommand: { command: Schema.Literals(["Begin", "Resume", "Suspend", "ContinueRejectedResult"]) }
})
export type PlannedAttemptExecutorObservationPurpose = typeof PlannedAttemptExecutorObservationPurpose.Type
export const passiveLifecycleObservationPurpose =
  PlannedAttemptExecutorObservationPurpose.cases.PassiveLifecycleObservation.make({})

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
    command: Schema.Literals(["Begin", "Resume", "Suspend", "ContinueRejectedResult"]),
    correlation: PlannedAttemptExecutorCorrelation,
    detail: Schema.String
  }
) {}

/** Exact identity of a committed Run-owned permission; only the application supplies it. */
export const PlannedAttemptResultRecoveryAuthorization = Schema.Struct({
  nonce: Schema.NonEmptyString,
  correlation: PlannedAttemptExecutorCorrelation
}).pipe(Schema.brand("PlannedAttemptResultRecoveryAuthorization"))
export type PlannedAttemptResultRecoveryAuthorization = typeof PlannedAttemptResultRecoveryAuthorization.Type

/** Fresh execution-substrate observation; a terminal report alone never proves writer absence. */
export const PlannedAttemptExecutorWriterCustody = Schema.TaggedUnion({
  Stopped: { plannedAttempt: PlannedTaskAttempt },
  Unresolved: { plannedAttempt: PlannedTaskAttempt, detail: Schema.NonEmptyString }
})
export type PlannedAttemptExecutorWriterCustody = typeof PlannedAttemptExecutorWriterCustody.Type

export interface PlannedAttemptExecutorService {
  /** Selects only the existing owner and active turn; this performs no provider mutation. */
  readonly selectGuidanceTarget?: (plannedAttempt: PlannedTaskAttempt) => Effect.Effect<ExecutorGuidanceSelection>
  /** Rechecks the retained target before one transmission; no implicit creation, Resume or retry. */
  readonly sendGuidance?: (
    target: ExecutorGuidanceTarget,
    requestId: ExecutorGuidanceRequestId,
    text: string
  ) => Effect.Effect<ExecutorGuidanceTransmission>
  /** Reconciles exact retained writers without rewriting any accepted result or terminal seal. */
  readonly observeWriterCustody?: (
    plannedAttempt: PlannedTaskAttempt
  ) => Effect.Effect<PlannedAttemptExecutorWriterCustody>
  /** Passively reads the executor-owned lifecycle report without changing work. */
  readonly observe: (
    correlation: PlannedAttemptExecutorCorrelation,
    purpose: PlannedAttemptExecutorObservationPurpose
  ) => Effect.Effect<PlannedAttemptExecutorProjection>
  /** Begins the complete work for an exact planned attempt once. */
  readonly begin: (
    request: PlannedAttemptExecutorRequest,
    delivery: PlannedAttemptExecutorBeginDelivery
  ) => Effect.Effect<PlannedAttemptExecutorReport, PlannedAttemptExecutorCommandFailure>
  readonly requestSuspension: (
    plannedAttempt: PlannedTaskAttempt
  ) => Effect.Effect<PlannedAttemptExecutorReport, PlannedAttemptExecutorCommandFailure>
  /** Opens one explicitly authorized result cycle; exact redelivery reconciles without replenishing it. */
  readonly continueRejectedResult?: (
    request: PlannedAttemptExecutorRequest,
    authorization: PlannedAttemptResultRecoveryAuthorization
  ) => Effect.Effect<PlannedAttemptExecutorReport, PlannedAttemptExecutorCommandFailure>
  /** Resumes the same exact attempt only after it was safely suspended. */
  readonly resume: (
    request: PlannedAttemptExecutorRequest
  ) => Effect.Effect<PlannedAttemptExecutorReport, PlannedAttemptExecutorCommandFailure>
}

/** The injected boundary for all executor work on one exact planned attempt. */
export class PlannedAttemptExecutor extends Context.Service<PlannedAttemptExecutor, PlannedAttemptExecutorService>()(
  "@dalph/PlannedAttemptExecutor"
) {}

/**
 * One loss-free process-local lifecycle attachment. `current` is read only
 * after the provider change source is attached; every value in `changes` is a
 * fresh authoritative projection, never a provider notification payload.
 */
export interface PlannedAttemptExecutorLifecycleAttachment {
  readonly current: PlannedAttemptExecutorProjection
  readonly changes: Stream.Stream<PlannedAttemptExecutorProjection>
  /** Detaches the provider subscription; safe to call after completion or interruption. */
  readonly close: Effect.Effect<void>
}

export interface PlannedAttemptExecutorLifecycleObservationService {
  /** Opens one read-only current-first attachment for an exact correlation. */
  readonly attach: (
    correlation: PlannedAttemptExecutorCorrelation
  ) => Effect.Effect<PlannedAttemptExecutorLifecycleAttachment, never, Scope.Scope>
}

/** Read-only lifecycle authority kept separate from executor command authority. */
export class PlannedAttemptExecutorLifecycleObservation extends Context.Service<
  PlannedAttemptExecutorLifecycleObservation,
  PlannedAttemptExecutorLifecycleObservationService
>()("@dalph/PlannedAttemptExecutorLifecycleObservation") {}
