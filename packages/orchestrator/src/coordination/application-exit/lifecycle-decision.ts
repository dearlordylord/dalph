import {
  type PlannedAttemptExecutorCorrelation,
  type PlannedAttemptExecutorReport,
  plannedAttemptExecutorCorrelationKey
} from "@dalph/contracts"
import { Data, Duration, Match, Schema } from "effect"
import { applicationExitDrainDuration } from "../timing/control-plane-budgets.js"

const initialDrainTickValue = 0
/** The fixed V1 number of monotonic seconds and abstract model ticks in one Exit drain. */
export const applicationExitDrainLimitSeconds = Duration.toSeconds(applicationExitDrainDuration)
const finalDrainTickValue = applicationExitDrainLimitSeconds
const penultimateDrainTickValue = 4
const successfulProcessStatus = 0
const forcedProcessStatus = 1

/** One monotonic abstract second of the five-second application Exit drain. */
export const ApplicationExitDrainTick = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(initialDrainTickValue),
  Schema.isLessThanOrEqualTo(finalDrainTickValue)
).pipe(Schema.brand("ApplicationExitDrainTick"))
export type ApplicationExitDrainTick = typeof ApplicationExitDrainTick.Type

export const initialApplicationExitDrainTick = ApplicationExitDrainTick.make(initialDrainTickValue)
export const finalApplicationExitDrainTick = ApplicationExitDrainTick.make(finalDrainTickValue)

/** The number of live forward-progress owners observed at a decision boundary. */
export const ApplicationExitLiveForwardOwnerCount = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
  Schema.brand("ApplicationExitLiveForwardOwnerCount")
)
export type ApplicationExitLiveForwardOwnerCount = typeof ApplicationExitLiveForwardOwnerCount.Type

/** A diagnostic retained by the application lifecycle, never by a Run journal. */
export const ApplicationExitDiagnostic = Schema.NonEmptyString.pipe(Schema.brand("ApplicationExitDiagnostic"))
export type ApplicationExitDiagnostic = typeof ApplicationExitDiagnostic.Type

/** The one typed result shared by every request joined to an Exit drain. */
export const ApplicationExitResult = Schema.TaggedUnion({
  Failed: {
    diagnostics: Schema.NonEmptyArray(ApplicationExitDiagnostic),
    requestedStatus: Schema.Literal(forcedProcessStatus)
  },
  Succeeded: { requestedStatus: Schema.Literal(successfulProcessStatus) },
  TimedOut: {
    diagnostics: Schema.Array(ApplicationExitDiagnostic),
    requestedStatus: Schema.Literal(forcedProcessStatus)
  }
})
export type ApplicationExitResult = typeof ApplicationExitResult.Type

/**
 * Host-facing result after admission closes and the bounded Exit drain settles.
 * `ReadyForFinalization` deliberately says nothing about host scope resources
 * or coordinator ownership; those are finalized after this result is exposed.
 */
export const ApplicationExitPreFinalizationResult = Schema.TaggedUnion({
  DrainFailed: {
    diagnostics: Schema.NonEmptyArray(ApplicationExitDiagnostic),
    requestedStatus: Schema.Literal(forcedProcessStatus)
  },
  DrainTimedOut: {
    diagnostics: Schema.Array(ApplicationExitDiagnostic),
    requestedStatus: Schema.Literal(forcedProcessStatus)
  },
  ReadyForFinalization: { requestedStatus: Schema.Literal(successfulProcessStatus) }
})
export type ApplicationExitPreFinalizationResult = typeof ApplicationExitPreFinalizationResult.Type

/** A forward-progress request reached the shared boundary after Exit closed it. */
export class ApplicationExiting extends Schema.TaggedError<ApplicationExiting>()("ApplicationExiting", {}) {}

export type ForwardOwnerKind =
  | "AtomicBoundary"
  | "AuthorizedRunTerminationAppend"
  | "InterruptibleBoundary"
  /** The process-local activation scope that must close before the application releases its coordinator lock. */
  | "RunActivation"

/** One side of the indivisible permission-to-registration admission handoff. */
export type ForwardOwnerAdmission = Data.TaggedEnum<{
  NoForwardOwner: Record<never, never>
  PreparingForwardOwner: { readonly kind: ForwardOwnerKind }
  RegisteredForwardOwner: { readonly kind: ForwardOwnerKind }
}>

export const ForwardOwnerAdmission = Data.taggedEnum<ForwardOwnerAdmission>()

const closeForwardOwnerAdmission = (owner: ForwardOwnerAdmission): ForwardOwnerAdmission =>
  Match.valueTags(owner, {
    NoForwardOwner: () => owner,
    PreparingForwardOwner: () => ForwardOwnerAdmission.NoForwardOwner(),
    RegisteredForwardOwner: () => owner
  })

interface ApplicationExitCutoffDecision {
  readonly cutoffClosed: true
  readonly owners: ReadonlyArray<ForwardOwnerAdmission>
  readonly tick: ApplicationExitDrainTick
}

export const closeApplicationExitAdmission = (
  owners: ReadonlyArray<ForwardOwnerAdmission>
): ApplicationExitCutoffDecision => ({
  cutoffClosed: true,
  owners: owners.map(closeForwardOwnerAdmission),
  tick: initialApplicationExitDrainTick
})

export type ForwardOwnerRegistrationDecision = Data.TaggedEnum<{
  ForwardOwnerRegistered: { readonly kind: ForwardOwnerKind }
  ForwardOwnerRejected: { readonly error: ApplicationExiting }
}>

export const ForwardOwnerRegistrationDecision = Data.taggedEnum<ForwardOwnerRegistrationDecision>()

export const decideForwardOwnerRegistration = (
  cutoffClosed: boolean,
  kind: ForwardOwnerKind
): ForwardOwnerRegistrationDecision =>
  cutoffClosed
    ? ForwardOwnerRegistrationDecision.ForwardOwnerRejected({ error: new ApplicationExiting() })
    : ForwardOwnerRegistrationDecision.ForwardOwnerRegistered({ kind })

/** Redelivery joins the current drain without changing its original tick. */
export const joinApplicationExitDrain = (
  tick: ApplicationExitDrainTick
): { readonly joined: true; readonly tick: ApplicationExitDrainTick } => ({ joined: true, tick })

export type InterruptibleBoundaryObservation = "Ambiguous" | "KnownResult"

export type InterruptibleOwnerReleaseDecision = Data.TaggedEnum<{
  RecordKnownObservationAndRelease: Record<never, never>
  ReleaseRecoverableAmbiguity: Record<never, never>
  RetainOwnerForMissingIntent: Record<never, never>
}>

export const InterruptibleOwnerReleaseDecision = Data.taggedEnum<InterruptibleOwnerReleaseDecision>()

/** An interruptible owner may disappear into ambiguity only behind its exact acknowledged intent. */
export const decideInterruptibleOwnerRelease = (
  intentAcknowledged: boolean,
  observation: InterruptibleBoundaryObservation
): InterruptibleOwnerReleaseDecision => {
  if (!intentAcknowledged) return InterruptibleOwnerReleaseDecision.RetainOwnerForMissingIntent()
  return observation === "KnownResult"
    ? InterruptibleOwnerReleaseDecision.RecordKnownObservationAndRelease()
    : InterruptibleOwnerReleaseDecision.ReleaseRecoverableAmbiguity()
}

export type ExecutorPositionDecision = Data.TaggedEnum<{
  ReleasePosition: { readonly evidence: "ExecutorWorkSafelySuspended" | "ExecutorWorkTerminal" }
  RetainPosition: { readonly reason: "ForeignCorrelation" | "NoEvidence" | "ExecutingIsUnsafe" }
}>

export const ExecutorPositionDecision = Data.taggedEnum<ExecutorPositionDecision>()

/** Only the exact correlated safe-or-terminal executor report releases a task-work position. */
export const decideExecutorPosition = (
  expected: PlannedAttemptExecutorCorrelation,
  report: PlannedAttemptExecutorReport | undefined
): ExecutorPositionDecision => {
  if (report === undefined) return ExecutorPositionDecision.RetainPosition({ reason: "NoEvidence" })
  if (plannedAttemptExecutorCorrelationKey(report.correlation) !== plannedAttemptExecutorCorrelationKey(expected)) {
    return ExecutorPositionDecision.RetainPosition({ reason: "ForeignCorrelation" })
  }
  return Match.valueTags(report, {
    ExecutorWorkExecuting: () => ExecutorPositionDecision.RetainPosition({ reason: "ExecutingIsUnsafe" }),
    ExecutorWorkSafelySuspended: () =>
      ExecutorPositionDecision.ReleasePosition({ evidence: "ExecutorWorkSafelySuspended" }),
    ExecutorWorkTerminal: () => ExecutorPositionDecision.ReleasePosition({ evidence: "ExecutorWorkTerminal" })
  })
}

/** Executor evidence, with a suspension-call failure inseparable from its diagnostic. */
export type ApplicationExitExecutorAttemptEvidence = Data.TaggedEnum<{
  FastSuspensionCalled: Record<never, never>
  NotStarted: Record<never, never>
  ExecutorWorkExecuting: Record<never, never>
  ExecutorWorkSafelySuspended: Record<never, never>
  SuspensionCallFailed: { readonly diagnostic: ApplicationExitDiagnostic }
  SuspensionIntentRecorded: Record<never, never>
  ExecutorWorkTerminal: Record<never, never>
}>

export const ApplicationExitExecutorAttemptEvidence = Data.taggedEnum<ApplicationExitExecutorAttemptEvidence>()

/** An already-produced journal write, with failure inseparable from its diagnostic. */
export type ApplicationExitProducedWriteEvidence = Data.TaggedEnum<{
  Acknowledged: Record<never, never>
  Failed: { readonly diagnostic: ApplicationExitDiagnostic }
  None: Record<never, never>
  Pending: Record<never, never>
}>

export const ApplicationExitProducedWriteEvidence = Data.taggedEnum<ApplicationExitProducedWriteEvidence>()

/** The read-only application snapshot from which the shell decides its next lifecycle result. */
export interface ApplicationExitDrainSnapshot {
  readonly attempts: ReadonlyArray<ApplicationExitExecutorAttemptEvidence>
  readonly coordinatorLockHeld: boolean
  readonly fiberOpen: boolean
  readonly liveForwardOwnerCount: ApplicationExitLiveForwardOwnerCount
  readonly producedWrite: ApplicationExitProducedWriteEvidence
  readonly reservationHeld: boolean
  readonly tick: ApplicationExitDrainTick
}

const applicationExitDiagnostics = (snapshot: ApplicationExitDrainSnapshot): Array<ApplicationExitDiagnostic> => [
  ...snapshot.attempts.flatMap((attempt) =>
    Match.valueTags(attempt, {
      FastSuspensionCalled: () => [],
      NotStarted: () => [],
      ExecutorWorkExecuting: () => [],
      ExecutorWorkSafelySuspended: () => [],
      SuspensionCallFailed: ({ diagnostic }) => [diagnostic],
      SuspensionIntentRecorded: () => [],
      ExecutorWorkTerminal: () => []
    })
  ),
  ...Match.valueTags(snapshot.producedWrite, {
    Acknowledged: () => [],
    Failed: ({ diagnostic }) => [diagnostic],
    None: () => [],
    Pending: () => []
  })
]

export type ApplicationExitDrainDecision = Data.TaggedEnum<{
  ContinueDraining: Record<never, never>
  ForceTimedOut: { readonly result: Extract<ApplicationExitResult, { readonly _tag: "TimedOut" }> }
  ReportFailed: { readonly result: Extract<ApplicationExitResult, { readonly _tag: "Failed" }> }
  ReportSucceeded: { readonly result: Extract<ApplicationExitResult, { readonly _tag: "Succeeded" }> }
}>

export const ApplicationExitDrainDecision = Data.taggedEnum<ApplicationExitDrainDecision>()

const attemptHasUsefulQuickWork = (attempt: ApplicationExitExecutorAttemptEvidence): boolean =>
  Match.valueTags(attempt, {
    FastSuspensionCalled: () => true,
    NotStarted: () => false,
    ExecutorWorkExecuting: () => true,
    ExecutorWorkSafelySuspended: () => false,
    SuspensionCallFailed: () => false,
    SuspensionIntentRecorded: () => true,
    ExecutorWorkTerminal: () => false
  })

const attemptIsSafe = (attempt: ApplicationExitExecutorAttemptEvidence): boolean =>
  Match.valueTags(attempt, {
    FastSuspensionCalled: () => false,
    NotStarted: () => true,
    ExecutorWorkExecuting: () => false,
    ExecutorWorkSafelySuspended: () => true,
    /* v8 ignore next -- @preserve SuspensionCallFailed contributes diagnostics, so successBoundaryReached short-circuits before attemptIsSafe. */
    SuspensionCallFailed: () => false,
    SuspensionIntentRecorded: () => false,
    ExecutorWorkTerminal: () => true
  })

const processLocalResourcesReleased = (snapshot: ApplicationExitDrainSnapshot): boolean =>
  !snapshot.reservationHeld && !snapshot.fiberOpen && !snapshot.coordinatorLockHeld

const usefulQuickWorkRemains = (snapshot: ApplicationExitDrainSnapshot): boolean =>
  snapshot.liveForwardOwnerCount > 0 ||
  snapshot.attempts.some(attemptHasUsefulQuickWork) ||
  snapshot.producedWrite._tag === "Pending" ||
  !processLocalResourcesReleased(snapshot)

const successBoundaryReached = (snapshot: ApplicationExitDrainSnapshot): boolean =>
  applicationExitDiagnostics(snapshot).length === 0 &&
  snapshot.liveForwardOwnerCount === 0 &&
  snapshot.attempts.every(attemptIsSafe) &&
  (snapshot.producedWrite._tag === "None" || snapshot.producedWrite._tag === "Acknowledged") &&
  processLocalResourcesReleased(snapshot)

export const decideApplicationExitDrain = (snapshot: ApplicationExitDrainSnapshot): ApplicationExitDrainDecision => {
  const diagnostics = applicationExitDiagnostics(snapshot)
  const [firstDiagnostic, ...remainingDiagnostics] = diagnostics
  if (snapshot.tick === finalApplicationExitDrainTick) {
    return ApplicationExitDrainDecision.ForceTimedOut({
      result: ApplicationExitResult.cases.TimedOut.make({ diagnostics, requestedStatus: forcedProcessStatus })
    })
  }
  if (firstDiagnostic !== undefined && !usefulQuickWorkRemains(snapshot)) {
    return ApplicationExitDrainDecision.ReportFailed({
      result: ApplicationExitResult.cases.Failed.make({
        diagnostics: [firstDiagnostic, ...remainingDiagnostics],
        requestedStatus: forcedProcessStatus
      })
    })
  }
  return successBoundaryReached(snapshot)
    ? ApplicationExitDrainDecision.ReportSucceeded({
        result: ApplicationExitResult.cases.Succeeded.make({ requestedStatus: successfulProcessStatus })
      })
    : ApplicationExitDrainDecision.ContinueDraining()
}

export type ApplicationExitTickDecision = Data.TaggedEnum<{
  AdvanceToTick: { readonly tick: ApplicationExitDrainTick }
  AlreadyTimedOut: Record<never, never>
  ForceTimedOut: {
    readonly result: Extract<ApplicationExitResult, { readonly _tag: "TimedOut" }>
    readonly tick: ApplicationExitDrainTick
  }
}>

export const ApplicationExitTickDecision = Data.taggedEnum<ApplicationExitTickDecision>()

/** The fifth monotonic tick and timed-out forced-termination result are one decision. */
export const advanceApplicationExitTick = (
  tick: ApplicationExitDrainTick,
  diagnostics: ReadonlyArray<ApplicationExitDiagnostic>
): ApplicationExitTickDecision => {
  if (tick === finalApplicationExitDrainTick) return ApplicationExitTickDecision.AlreadyTimedOut()
  if (tick === ApplicationExitDrainTick.make(penultimateDrainTickValue)) {
    return ApplicationExitTickDecision.ForceTimedOut({
      result: ApplicationExitResult.cases.TimedOut.make({ diagnostics, requestedStatus: forcedProcessStatus }),
      tick: finalApplicationExitDrainTick
    })
  }
  return ApplicationExitTickDecision.AdvanceToTick({ tick: ApplicationExitDrainTick.make(tick + 1) })
}

export type ApplicationProcessEndDecision = Data.TaggedEnum<{
  RequestForcedTermination: { readonly status: 1 }
  RequestGracefulTermination: { readonly status: 0 }
}>

export const ApplicationProcessEndDecision = Data.taggedEnum<ApplicationProcessEndDecision>()

export const decideApplicationProcessEnd = (result: ApplicationExitResult): ApplicationProcessEndDecision =>
  Match.valueTags(result, {
    Failed: () => ApplicationProcessEndDecision.RequestForcedTermination({ status: forcedProcessStatus }),
    Succeeded: () => ApplicationProcessEndDecision.RequestGracefulTermination({ status: successfulProcessStatus }),
    TimedOut: () => ApplicationProcessEndDecision.RequestForcedTermination({ status: forcedProcessStatus })
  })

/** A host may request graceful process ending only after its bounded drain is ready. */
export const decideApplicationPreFinalizationProcessEnd = (
  result: ApplicationExitPreFinalizationResult
): ApplicationProcessEndDecision =>
  result._tag === "ReadyForFinalization"
    ? ApplicationProcessEndDecision.RequestGracefulTermination({ status: successfulProcessStatus })
    : ApplicationProcessEndDecision.RequestForcedTermination({ status: forcedProcessStatus })

/** Startup always constructs fresh serving state; it accepts no prior Exit mode or result. */
export const freshApplicationExitState = (): {
  readonly cutoffClosed: false
  readonly result: undefined
  readonly tick: ApplicationExitDrainTick
} => ({ cutoffClosed: false, result: undefined, tick: initialApplicationExitDrainTick })
