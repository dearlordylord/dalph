/* eslint-disable max-lines -- The application Exit chronology and its registries stay co-located for auditability. */
import {
  Array as EffectArray,
  Clock,
  Cause,
  Context,
  Deferred,
  Duration,
  Effect,
  Exit,
  Option,
  Ref,
  Schema,
  type Scope
} from "effect"
import type { PlannedAttemptExecutorCorrelation } from "@dalph/contracts"
import {
  ApplicationExitDiagnostic,
  ApplicationExitPreFinalizationResult,
  ApplicationExitResult,
  type ApplicationExitPreFinalizationResult as ApplicationExitPreFinalizationResultType,
  type ApplicationExitResult as ApplicationExitResultType,
  type ApplicationProcessEndDecision,
  decideApplicationProcessEnd
} from "./lifecycle-decision.js"
import {
  type ApplicationExitAdmissionService,
  type ApplicationExitLifecycleService,
  makeApplicationExitLifecycle
} from "./lifecycle.js"
import type { CoordinatorOwnershipCapability } from "../../authorities/coordinator-ownership/ownership.js"
import { applicationExitDrainDuration } from "../timing/control-plane-budgets.js"

/** One application Exit drain boundary failed without creating a Run workflow fact. */
export class ApplicationExitDrainFailure extends Schema.TaggedError<ApplicationExitDrainFailure>()(
  "ApplicationExitDrainFailure",
  { diagnostics: Schema.NonEmptyArray(ApplicationExitDiagnostic) }
) {}

export interface ApplicationExitDrain {
  readonly suspendExecutingExecutorWork: Effect.Effect<
    ReadonlyArray<PlannedAttemptExecutorCorrelation>,
    ApplicationExitDrainFailure
  >
  readonly flushProducedJournalWrites: Effect.Effect<void, ApplicationExitDrainFailure>
  readonly closeProcessLocalResources: Effect.Effect<void, ApplicationExitDrainFailure>
  /** The ordinary application shell's bounded drain releases its coordinator lock. */
  readonly releaseCoordinatorLock: Effect.Effect<void, ApplicationExitDrainFailure>
}

/** A host drain intentionally leaves resource and coordinator ownership to scope finalization. */
interface ApplicationExitPreFinalizationDrain extends Omit<ApplicationExitDrain, "releaseCoordinatorLock"> {
  readonly releaseCoordinatorLock?: never
}

type ApplicationExitBoundaryDrain = ApplicationExitDrain | ApplicationExitPreFinalizationDrain

export interface ApplicationProcessLifecycleService {
  readonly requestEnd: (decision: ApplicationProcessEndDecision) => Effect.Effect<void>
}

/**
 * Host-owned finalization signal. It is intentionally not a process-end port:
 * the host uses it to close its Run/foundation scopes after a report lease is
 * acknowledged, while the ordinary application shell retains the real process
 * lifecycle capability.
 */
export interface ApplicationExitHostFinalizationRequest {
  readonly request: Effect.Effect<void>
}

const applicationExitResultReportLeaseBrand: unique symbol = Symbol("ApplicationExitResultReportLease")

/**
 * The host-facing report lease binds acknowledgement to one exact lifecycle
 * result. Its private brand prevents callers from acknowledging a different
 * result; repeated acknowledgement joins the same idempotent lease.
 */
export interface ApplicationExitResultReportLease<TResult> {
  readonly [applicationExitResultReportLeaseBrand]: typeof applicationExitResultReportLeaseBrand
  readonly result: TResult
  readonly acknowledge: Effect.Effect<void>
}

export type ApplicationExitTraceEvent =
  | { readonly _tag: "ExitRequested" }
  | { readonly _tag: "AdmissionCutoffClosed" }
  | {
      readonly _tag: "ExecutingExecutorWorkReachedSafeBoundary"
      readonly correlations: readonly [PlannedAttemptExecutorCorrelation, ...Array<PlannedAttemptExecutorCorrelation>]
    }
  | { readonly _tag: "ProducedJournalWritesFlushed" }
  | { readonly _tag: "ProcessLocalResourcesClosed" }
  | { readonly _tag: "CoordinatorLockReleased" }
  | { readonly _tag: "ExitResultReported"; readonly result: ApplicationExitResultType }
  /** The host-facing drain result precedes scope/resource finalization. */
  | { readonly _tag: "ExitDrainResultReported"; readonly result: ApplicationExitPreFinalizationResultType }
  /** The host caller confirmed visible reporting before scope finalization. */
  | { readonly _tag: "ExitDrainReportAcknowledged"; readonly result: ApplicationExitPreFinalizationResultType }
  | { readonly _tag: "ProcessEndRequested"; readonly decision: ApplicationProcessEndDecision }

export interface ApplicationExitTraceService {
  readonly emit: (event: ApplicationExitTraceEvent) => Effect.Effect<void>
}

/**
 * Maps one bounded-drain outcome to the result promised by a shell mode.
 * Host mode reports readiness before scope finalizers; ordinary mode reports
 * only the result whose success includes coordinator-lock release.
 */
// eslint-disable-next-line functional/no-mixed-types -- A shell policy intentionally groups one mode flag with its typed result and process adapters.
interface ApplicationExitResultPolicy<TResult, TBoundaryResult = TResult> {
  readonly releaseCoordinatorLock: boolean
  readonly fromDiagnostics: (diagnostics: ReadonlyArray<ApplicationExitDiagnostic>) => TResult
  readonly timedOut: (diagnostics: ReadonlyArray<ApplicationExitDiagnostic>) => TResult
  readonly report: (trace: ApplicationExitTraceService, result: TResult) => Effect.Effect<void>
  readonly makeBoundaryResult: (result: TResult, acknowledge: Effect.Effect<void>) => TBoundaryResult
  readonly acknowledgeReport: (
    trace: ApplicationExitTraceService,
    result: TResult,
    hostFinalizationRequest: ApplicationExitHostFinalizationRequest | undefined
  ) => Effect.Effect<void>
  readonly processEnd?: (
    trace: ApplicationExitTraceService,
    processLifecycle: ApplicationProcessLifecycleService,
    result: TResult
  ) => Effect.Effect<void>
}

const emitSafeExecutorCorrelations = (
  trace: ApplicationExitTraceService,
  correlations: ReadonlyArray<PlannedAttemptExecutorCorrelation>
) => {
  const [first, ...remaining] = correlations
  return first === undefined
    ? Effect.void
    : trace.emit({ _tag: "ExecutingExecutorWorkReachedSafeBoundary", correlations: [first, ...remaining] })
}

export interface ApplicationExitRequestBoundaryService<TResult = ApplicationExitResultType> {
  readonly requestExit: Effect.Effect<TResult>
}

/** Transport-neutral boundary called by a future Operator or supervisor adapter. */
export class ApplicationExitRequestBoundary extends Context.Service<
  ApplicationExitRequestBoundary,
  ApplicationExitRequestBoundaryService<
    ApplicationExitResultType | ApplicationExitResultReportLease<ApplicationExitPreFinalizationResultType>
  >
>()("@dalph/ApplicationExitRequestBoundary") {}

const applicationExitDrainLimit = applicationExitDrainDuration
const applicationExitDrainLimitNanos = Duration.toNanosUnsafe(applicationExitDrainLimit)

/** One independently useful quick-work family whose diagnostic order remains stable under concurrent Exit drain. */
type ApplicationExitQuickDrainFamily =
  | "CoordinatorLockRelease"
  | "ExecutorSuspension"
  | "ProcessLocalResourceRelease"
  | "ProducedJournalWriteFlush"

const applicationExitQuickDrainFamilyOrder: ReadonlyArray<ApplicationExitQuickDrainFamily> = [
  "ExecutorSuspension",
  "ProducedJournalWriteFlush",
  "ProcessLocalResourceRelease",
  "CoordinatorLockRelease"
]

const applicationExitDrainResult = (
  diagnostics: ReadonlyArray<ApplicationExitDiagnostic>
): ApplicationExitResultType => {
  const [first, ...remaining] = diagnostics
  return first === undefined
    ? ApplicationExitResult.cases.Succeeded.make({ requestedStatus: 0 })
    : ApplicationExitResult.cases.Failed.make({ diagnostics: [first, ...remaining], requestedStatus: 1 })
}

const applicationExitPreFinalizationDrainResult = (
  diagnostics: ReadonlyArray<ApplicationExitDiagnostic>
): ApplicationExitPreFinalizationResultType => {
  const [first, ...remaining] = diagnostics
  return first === undefined
    ? ApplicationExitPreFinalizationResult.cases.ReadyForFinalization.make({ requestedStatus: 0 })
    : ApplicationExitPreFinalizationResult.cases.DrainFailed.make({
        diagnostics: [first, ...remaining],
        requestedStatus: 1
      })
}

const ordinaryApplicationExitResultPolicy: ApplicationExitResultPolicy<ApplicationExitResultType> = {
  releaseCoordinatorLock: true,
  fromDiagnostics: applicationExitDrainResult,
  timedOut: (diagnostics) => ApplicationExitResult.cases.TimedOut.make({ diagnostics, requestedStatus: 1 }),
  report: (trace, result) => trace.emit({ _tag: "ExitResultReported", result }),
  makeBoundaryResult: (result) => result,
  acknowledgeReport: () => Effect.void,
  processEnd: (trace, processLifecycle, result) => {
    const decision = decideApplicationProcessEnd(result)
    return trace
      .emit({ _tag: "ProcessEndRequested", decision })
      .pipe(Effect.andThen(processLifecycle.requestEnd(decision)))
  }
}

const makeApplicationExitResultReportLease = <TResult>(result: TResult, acknowledge: Effect.Effect<void>) =>
  ({
    [applicationExitResultReportLeaseBrand]: applicationExitResultReportLeaseBrand,
    result,
    acknowledge
  }) satisfies ApplicationExitResultReportLease<TResult>

const preFinalizationApplicationExitResultPolicy: ApplicationExitResultPolicy<
  ApplicationExitPreFinalizationResultType,
  ApplicationExitResultReportLease<ApplicationExitPreFinalizationResultType>
> = {
  releaseCoordinatorLock: false,
  fromDiagnostics: applicationExitPreFinalizationDrainResult,
  timedOut: (diagnostics) =>
    ApplicationExitPreFinalizationResult.cases.DrainTimedOut.make({ diagnostics, requestedStatus: 1 }),
  report: (trace, result) => trace.emit({ _tag: "ExitDrainResultReported", result }),
  makeBoundaryResult: makeApplicationExitResultReportLease,
  acknowledgeReport: (trace, result, hostFinalizationRequest) =>
    hostFinalizationRequest === undefined
      ? Effect.die("host Exit report acknowledgement has no host finalization request")
      : trace
          .emit({ _tag: "ExitDrainReportAcknowledged", result })
          .pipe(Effect.andThen(hostFinalizationRequest.request))
}

/**
 * Starts one monotonic five-second drain at the first request. Later requests
 * await its exact result and cannot restart either work or clock.
 */
const makeApplicationExitRequestBoundaryWithPolicy = Effect.fn("ApplicationExitRequestBoundary.make")(function* <
  TResult,
  TBoundaryResult = TResult
>(
  lifecycle: ApplicationExitLifecycleService<TResult>,
  drain: ApplicationExitBoundaryDrain,
  processLifecycle: ApplicationProcessLifecycleService | undefined,
  trace: ApplicationExitTraceService = { emit: () => Effect.void },
  beginExecutorDrainHandoff: Effect.Effect<void> = Effect.void,
  readSettledQuickDrainDiagnostics: Effect.Effect<
    ReadonlyMap<ApplicationExitQuickDrainFamily, ReadonlyArray<ApplicationExitDiagnostic>>
  > = Effect.succeed(new Map()),
  hostFinalizationRequest: ApplicationExitHostFinalizationRequest | undefined,
  policy: ApplicationExitResultPolicy<TResult, TBoundaryResult>
) {
  const scope = yield* Effect.scope
  const reportAcknowledged = yield* Deferred.make<void>()
  const recordedDiagnostics = yield* Ref.make<
    ReadonlyMap<ApplicationExitQuickDrainFamily, ReadonlyArray<ApplicationExitDiagnostic>>
  >(new Map())
  const currentDiagnostics = Effect.all([Ref.get(recordedDiagnostics), readSettledQuickDrainDiagnostics]).pipe(
    Effect.map(([recorded, settled]) =>
      applicationExitQuickDrainFamilyOrder.flatMap((family) => recorded.get(family) ?? settled.get(family) ?? [])
    )
  )
  const runQuickDrain = Effect.fn("ApplicationExitRequestBoundary.runQuickDrain")(function* <A>(
    family: ApplicationExitQuickDrainFamily,
    operation: Effect.Effect<A, ApplicationExitDrainFailure>,
    onSuccess: (value: A) => Effect.Effect<void>
  ) {
    return yield* operation.pipe(
      Effect.matchEffect({
        onFailure: ({ diagnostics }) =>
          Ref.update(recordedDiagnostics, (current) => new Map(current).set(family, diagnostics)),
        onSuccess
      })
    )
  })

  const drainApplication = Effect.gen(function* () {
    yield* Effect.all(
      [
        runQuickDrain("ExecutorSuspension", drain.suspendExecutingExecutorWork, (correlations) =>
          emitSafeExecutorCorrelations(trace, correlations)
        ),
        runQuickDrain("ProducedJournalWriteFlush", drain.flushProducedJournalWrites, () =>
          trace.emit({ _tag: "ProducedJournalWritesFlushed" })
        ),
        runQuickDrain(
          "ProcessLocalResourceRelease",
          lifecycle.awaitForwardOwnersReleased.pipe(Effect.andThen(drain.closeProcessLocalResources)),
          () => trace.emit({ _tag: "ProcessLocalResourcesClosed" })
        )
      ],
      { concurrency: "unbounded" }
    )
    if (drain.releaseCoordinatorLock !== undefined) {
      yield* runQuickDrain("CoordinatorLockRelease", drain.releaseCoordinatorLock, () =>
        trace.emit({ _tag: "CoordinatorLockReleased" })
      )
    }
    return policy.fromDiagnostics(yield* currentDiagnostics)
  })

  const driver = (cutoffAt: bigint) =>
    Effect.gen(function* () {
      const now = yield* Clock.monotonicTimeNanos
      const elapsed = now - cutoffAt
      const remaining = elapsed >= applicationExitDrainLimitNanos ? 0n : applicationExitDrainLimitNanos - elapsed
      const withinLimit = yield* drainApplication.pipe(Effect.timeoutOption(Duration.nanos(remaining)))
      const result = Option.isSome(withinLimit) ? withinLimit.value : policy.timedOut(yield* currentDiagnostics)
      yield* policy.report(trace, result)
      yield* lifecycle.completeExit(result)
      if (processLifecycle !== undefined && policy.processEnd !== undefined) {
        yield* policy.processEnd(trace, processLifecycle, result)
      }
      yield* lifecycle.completeExitDriver
    }).pipe(Effect.ensuring(lifecycle.completeExitDriver))

  const requestExit = Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      yield* trace.emit({ _tag: "ExitRequested" })
      yield* beginExecutorDrainHandoff
      const request = yield* lifecycle.requestExit
      if (request.first) {
        yield* trace.emit({ _tag: "AdmissionCutoffClosed" })
        yield* driver(request.cutoffAt).pipe(Effect.forkIn(scope))
      }
      const completed = yield* restore(Deferred.await(request.result))
      yield* Effect.uninterruptible(lifecycle.awaitExitDriverFinished)
      const acknowledge = Effect.uninterruptible(
        Deferred.succeed(reportAcknowledged, undefined).pipe(
          Effect.flatMap((first) =>
            first ? policy.acknowledgeReport(trace, completed, hostFinalizationRequest) : Effect.void
          )
        )
      )
      return policy.makeBoundaryResult(completed, acknowledge)
    })
  )

  return { requestExit } satisfies ApplicationExitRequestBoundaryService<TBoundaryResult>
})

/** Builds the ordinary application Exit boundary whose success includes lock release. */
export const makeApplicationExitRequestBoundary = (
  lifecycle: ApplicationExitLifecycleService<ApplicationExitResultType>,
  drain: ApplicationExitDrain,
  processLifecycle: ApplicationProcessLifecycleService,
  trace: ApplicationExitTraceService = { emit: () => Effect.void },
  beginExecutorDrainHandoff: Effect.Effect<void> = Effect.void,
  readSettledQuickDrainDiagnostics: Effect.Effect<
    ReadonlyMap<ApplicationExitQuickDrainFamily, ReadonlyArray<ApplicationExitDiagnostic>>
  > = Effect.succeed(new Map())
) =>
  makeApplicationExitRequestBoundaryWithPolicy(
    lifecycle,
    drain,
    processLifecycle,
    trace,
    beginExecutorDrainHandoff,
    readSettledQuickDrainDiagnostics,
    undefined,
    ordinaryApplicationExitResultPolicy
  )

export interface ApplicationExitProcessLocalDrain {
  readonly closeProcessLocalResources: Effect.Effect<void, ApplicationExitDrainFailure>
}

/** One active Run's fast, non-LLM executor-family Exit drain. */
export interface ApplicationExitExecutorDrain {
  readonly suspendExecutingExecutorWork: Effect.Effect<
    ReadonlyArray<PlannedAttemptExecutorCorrelation>,
    ApplicationExitDrainFailure
  >
}

interface ApplicationExitExecutorDrainResult {
  readonly correlations: ReadonlyArray<PlannedAttemptExecutorCorrelation>
  readonly diagnostics: ReadonlyArray<ApplicationExitDiagnostic>
}

interface RegisteredApplicationExitExecutorDrain {
  readonly drainId: number
  readonly drain: ApplicationExitExecutorDrain
  readonly finished: Deferred.Deferred<ApplicationExitExecutorDrainResult>
  readonly resultCollected: Ref.Ref<boolean>
  readonly started: boolean
}

/** Coordinates exact drain membership with the application Exit admission cutoff. */
interface ApplicationExitExecutorDrainRegistry {
  readonly nextId: number
  readonly phase: "Serving" | "CutoffPending" | "Draining" | "Settled"
  /** Number of registered executor drains whose result has not settled. */
  readonly activity: number
  readonly registered: ReadonlyMap<number, RegisteredApplicationExitExecutorDrain>
}

/** Application-owned runtime capabilities shared by every Run bootstrap in this process. */
export interface ApplicationExitShellService<TResult = ApplicationExitResultType> {
  readonly admission: ApplicationExitAdmissionService
  readonly awaitExitRequested: Effect.Effect<void>
  /** Every admitted executor drain has settled, including registrations that raced the cutoff. */
  readonly awaitExecutorDrains: Effect.Effect<void, ApplicationExitDrainFailure>
  readonly registerExecutorDrain: (drain: ApplicationExitExecutorDrain) => Effect.Effect<void, never, Scope.Scope>
  readonly registerProcessLocalDrain: (
    drain: ApplicationExitProcessLocalDrain
  ) => Effect.Effect<void, never, Scope.Scope>
  readonly requestBoundary: ApplicationExitRequestBoundaryService<TResult>
}

/** Application-scoped Exit capability shared by every Run bootstrap and executor resource. */
export class ApplicationExitShell extends Context.Service<
  ApplicationExitShell,
  ApplicationExitShellService<
    ApplicationExitResultType | ApplicationExitResultReportLease<ApplicationExitPreFinalizationResultType>
  >
>()("@dalph/ApplicationExitShell") {}

/**
 * Owns the one process-wide Exit lifecycle, driver, optional process port,
 * drain registry, and exact coordinator-lock release independently of any Run bootstrap.
 */
const makeApplicationExitShellWithPolicy = Effect.fn("ApplicationExitShell.make")(function* <
  TResult,
  TBoundaryResult = TResult
>(
  ownership: CoordinatorOwnershipCapability,
  processLifecycle: ApplicationProcessLifecycleService | undefined,
  trace: ApplicationExitTraceService = { emit: () => Effect.void },
  hostFinalizationRequest: ApplicationExitHostFinalizationRequest | undefined,
  policy: ApplicationExitResultPolicy<TResult, TBoundaryResult>
) {
  const scope = yield* Effect.scope
  const lifecycle = yield* makeApplicationExitLifecycle<TResult>()
  const executorDrains = yield* Ref.make<ApplicationExitExecutorDrainRegistry>({
    nextId: 0,
    phase: "Serving",
    activity: 0,
    registered: new Map()
  })
  const processLocalDrains = yield* Ref.make({
    nextId: 0,
    registered: new Map<number, ApplicationExitProcessLocalDrain>()
  })
  const settledExecutorDiagnostics = yield* Ref.make<ReadonlyMap<number, ReadonlyArray<ApplicationExitDiagnostic>>>(
    new Map()
  )
  const settledProcessLocalDiagnostics = yield* Ref.make<ReadonlyMap<number, ReadonlyArray<ApplicationExitDiagnostic>>>(
    new Map()
  )
  const executorDrainsSettled = yield* Deferred.make<void>()
  const finishExecutorDrain = Effect.fn("ApplicationExitShell.finishExecutorDrain")(function* () {
    const settled = yield* Ref.modify(executorDrains, (current) => {
      const activity = Math.max(0, current.activity - 1)
      const nowSettled = current.phase === "Draining" && activity === 0
      return [nowSettled, { ...current, activity, phase: nowSettled ? ("Settled" as const) : current.phase }] as const
    })
    if (settled) yield* Deferred.succeed(executorDrainsSettled, undefined)
  })

  const runExecutorDrain = Effect.fn("ApplicationExitShell.runExecutorDrain")(function* (
    entry: RegisteredApplicationExitExecutorDrain
  ) {
    // Keep the settlement protocol uninterruptible after the actual drain has
    // been restored. An interrupted drain is still a typed, terminal outcome
    // for this registry entry; leaving `finished` pending would make every
    // later Exit join wait forever.
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const outcome = yield* Effect.exit(
          restore(
            entry.drain.suspendExecutingExecutorWork.pipe(
              Effect.catchDefect((defect) =>
                Effect.fail(
                  new ApplicationExitDrainFailure({
                    diagnostics: [ApplicationExitDiagnostic.make(`Executor Exit drain failed: ${String(defect)}`)]
                  })
                )
              )
            )
          )
        )
        const result: ApplicationExitExecutorDrainResult = Exit.isSuccess(outcome)
          ? { correlations: outcome.value, diagnostics: [] }
          : (() => {
              const typedFailure = Cause.findErrorOption(outcome.cause)
              if (Option.isSome(typedFailure) && typedFailure.value instanceof ApplicationExitDrainFailure) {
                return { correlations: [], diagnostics: typedFailure.value.diagnostics }
              }
              return {
                correlations: [],
                diagnostics: [
                  ApplicationExitDiagnostic.make(`Executor Exit drain interrupted: ${Cause.pretty(outcome.cause)}`)
                ]
              }
            })()
        if (result.diagnostics.length > 0) {
          yield* Ref.update(settledExecutorDiagnostics, (current) =>
            new Map(current).set(entry.drainId, result.diagnostics)
          )
        }
        yield* emitSafeExecutorCorrelations(trace, result.correlations)
        yield* Deferred.succeed(entry.finished, result)
        yield* finishExecutorDrain()
        return result
      })
    )
  })

  const startExecutorDrains = (entries: ReadonlyArray<RegisteredApplicationExitExecutorDrain>) =>
    Effect.forEach(entries, (entry) => runExecutorDrain(entry).pipe(Effect.forkIn(scope)), { discard: true })

  const claimExecutorDrainResult = Effect.fn("ApplicationExitShell.claimExecutorDrainResult")(function* (
    entry: RegisteredApplicationExitExecutorDrain
  ) {
    const result = yield* Deferred.await(entry.finished)
    const claimed = yield* Ref.modify(entry.resultCollected, (collected) => [
      collected ? Option.none() : Option.some(result),
      true
    ])
    return claimed
  })

  const beginExecutorDrainHandoff = Ref.update(executorDrains, (current) =>
    current.phase === "Serving" ? { ...current, phase: "CutoffPending" as const } : current
  )

  const activateExecutorDrains = Effect.gen(function* () {
    const activation = yield* Ref.modify(executorDrains, (current) => {
      const pending = [...current.registered.values()].filter(({ started }) => !started)
      const registered = new Map([...current.registered].map(([id, entry]) => [id, { ...entry, started: true }]))
      const settled = pending.length === 0 && current.activity === 0
      return [
        { entries: pending, settled },
        {
          ...current,
          phase: settled ? ("Settled" as const) : ("Draining" as const),
          activity: current.activity + pending.length,
          registered
        }
      ] as const
    })
    if (activation.settled) yield* Deferred.succeed(executorDrainsSettled, undefined)
    const entries = activation.entries
    yield* startExecutorDrains(entries)
    const results = yield* Effect.forEach(entries, claimExecutorDrainResult)
    const diagnostics = EffectArray.getSomes(results).flatMap(({ diagnostics }) => diagnostics)
    const [first, ...remaining] = diagnostics
    if (first !== undefined) {
      return yield* new ApplicationExitDrainFailure({ diagnostics: [first, ...remaining] })
    }
    return []
  })

  const awaitExecutorDrainResults = Effect.gen(function* () {
    const entries = [...(yield* Ref.get(executorDrains)).registered.values()]
    const results = yield* Effect.forEach(entries, claimExecutorDrainResult)
    const diagnostics = EffectArray.getSomes(results).flatMap(({ diagnostics }) => diagnostics)
    const [first, ...remaining] = diagnostics
    if (first !== undefined) {
      return yield* new ApplicationExitDrainFailure({ diagnostics: [first, ...remaining] })
    }
  })

  const awaitExecutorDrains = Effect.gen(function* () {
    yield* Deferred.await(executorDrainsSettled)
    const entries = [...(yield* Ref.get(executorDrains)).registered.values()]
    const results = yield* Effect.forEach(entries, claimExecutorDrainResult)
    const diagnostics = EffectArray.getSomes(results).flatMap(({ diagnostics }) => diagnostics)
    const [first, ...remaining] = diagnostics
    if (first !== undefined) {
      return yield* new ApplicationExitDrainFailure({ diagnostics: [first, ...remaining] })
    }
  })

  const requestBoundary = yield* makeApplicationExitRequestBoundaryWithPolicy(
    lifecycle,
    {
      suspendExecutingExecutorWork: activateExecutorDrains,
      flushProducedJournalWrites: lifecycle.awaitForwardOwnersReleased.pipe(Effect.andThen(awaitExecutorDrainResults)),
      closeProcessLocalResources: Effect.gen(function* () {
        const drains = [...(yield* Ref.get(processLocalDrains)).registered.entries()]
        const diagnostics = yield* Effect.forEach(
          drains,
          ([drainId, { closeProcessLocalResources }]) =>
            closeProcessLocalResources.pipe(
              Effect.matchEffect({
                onFailure: ({ diagnostics }) =>
                  Ref.update(settledProcessLocalDiagnostics, (current) =>
                    new Map(current).set(drainId, diagnostics)
                  ).pipe(Effect.as(diagnostics)),
                onSuccess: () => Effect.succeed([])
              })
            ),
          { concurrency: "unbounded" }
        ).pipe(Effect.map((results) => results.flat()))
        const [first, ...remaining] = diagnostics
        if (first !== undefined) {
          return yield* new ApplicationExitDrainFailure({ diagnostics: [first, ...remaining] })
        }
      }),
      ...(policy.releaseCoordinatorLock ? { releaseCoordinatorLock: ownership.release } : {})
    },
    processLifecycle,
    trace,
    beginExecutorDrainHandoff,
    Effect.all([Ref.get(settledExecutorDiagnostics), Ref.get(settledProcessLocalDiagnostics)]).pipe(
      Effect.map(([executor, processLocal]) => {
        const byFamily = new Map<ApplicationExitQuickDrainFamily, ReadonlyArray<ApplicationExitDiagnostic>>()
        const inRegistrationOrder = (
          diagnostics: ReadonlyMap<number, ReadonlyArray<ApplicationExitDiagnostic>>
        ): ReadonlyArray<ApplicationExitDiagnostic> =>
          [...diagnostics.entries()].sort(([left], [right]) => left - right).flatMap(([, values]) => values)
        const executorDiagnostics = inRegistrationOrder(executor)
        const processLocalDiagnostics = inRegistrationOrder(processLocal)
        if (executorDiagnostics.length > 0) byFamily.set("ExecutorSuspension", executorDiagnostics)
        if (processLocalDiagnostics.length > 0) byFamily.set("ProcessLocalResourceRelease", processLocalDiagnostics)
        return byFamily
      })
    ),
    hostFinalizationRequest,
    policy
  )
  return {
    admission: lifecycle.admission,
    awaitExitRequested: lifecycle.awaitExitRequested,
    awaitExecutorDrains,
    registerExecutorDrain: (drain) =>
      Effect.gen(function* () {
        const finished = yield* Deferred.make<ApplicationExitExecutorDrainResult>()
        const resultCollected = yield* Ref.make(false)
        const registration = yield* Ref.modify(executorDrains, (current) => {
          if (current.phase === "Settled") {
            return [Option.none(), current] as const
          }
          const started = current.phase === "Draining"
          const entry = {
            drainId: current.nextId,
            drain,
            finished,
            resultCollected,
            started
          } satisfies RegisteredApplicationExitExecutorDrain
          const registered = new Map(current.registered).set(current.nextId, entry)
          return [
            Option.some({ drainId: current.nextId, entry, started }),
            { ...current, nextId: current.nextId + 1, activity: current.activity + (started ? 1 : 0), registered }
          ] as const
        })
        if (Option.isNone(registration)) return
        if (registration.value.started) {
          yield* startExecutorDrains([registration.value.entry])
        }
        yield* Effect.addFinalizer(() =>
          Ref.modify(executorDrains, (current) => {
            if (current.phase !== "Serving") {
              return [
                Effect.raceFirst(Deferred.await(finished).pipe(Effect.asVoid), lifecycle.awaitExitDriverFinished),
                current
              ] as const
            }
            const registered = new Map(current.registered)
            registered.delete(registration.value.drainId)
            return [Effect.void, { ...current, registered }] as const
          }).pipe(Effect.flatten)
        )
      }),
    registerProcessLocalDrain: (drain) =>
      Effect.gen(function* () {
        const drainId = yield* Ref.modify(processLocalDrains, (current) => {
          const registered = new Map(current.registered).set(current.nextId, drain)
          return [current.nextId, { nextId: current.nextId + 1, registered }] as const
        })
        yield* Effect.addFinalizer(() =>
          Ref.update(processLocalDrains, (current) => {
            const registered = new Map(current.registered)
            registered.delete(drainId)
            return { ...current, registered }
          })
        )
      }),
    requestBoundary
  } satisfies ApplicationExitShellService<TBoundaryResult>
})

/** Builds the ordinary application shell whose success includes lock release. */
export const makeApplicationExitShell = Effect.fn("ApplicationExitShell.makeOrdinary")(function* (
  ownership: CoordinatorOwnershipCapability,
  processLifecycle: ApplicationProcessLifecycleService,
  trace: ApplicationExitTraceService = { emit: () => Effect.void }
) {
  return yield* makeApplicationExitShellWithPolicy(
    ownership,
    processLifecycle,
    trace,
    undefined,
    ordinaryApplicationExitResultPolicy
  )
})

/**
 * Builds the host shell whose result only says that bounded Exit work is ready
 * for host scope finalization; it never claims that finalization released the
 * process resources or coordinator lock.
 */
export const makeApplicationExitPreFinalizationShell = Effect.fn("ApplicationExitShell.makePreFinalization")(function* (
  ownership: CoordinatorOwnershipCapability,
  hostFinalizationRequest: ApplicationExitHostFinalizationRequest,
  trace: ApplicationExitTraceService = { emit: () => Effect.void }
) {
  return yield* makeApplicationExitShellWithPolicy(
    ownership,
    undefined,
    trace,
    hostFinalizationRequest,
    preFinalizationApplicationExitResultPolicy
  )
})
