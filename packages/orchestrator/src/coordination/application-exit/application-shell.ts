import { Clock, Context, Deferred, Duration, Effect, Option, Ref, Schema, type Scope } from "effect"
import type { PlannedAttemptExecutorCorrelation } from "@dalph/contracts"
import {
  ApplicationExitDiagnostic,
  ApplicationExitResult,
  applicationExitDrainLimitSeconds,
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

/** One application Exit drain boundary failed without creating a Run workflow fact. */
export class ApplicationExitDrainFailure extends Schema.TaggedError<ApplicationExitDrainFailure>()(
  "ApplicationExitDrainFailure",
  { diagnostics: Schema.NonEmptyArray(ApplicationExitDiagnostic) }
) {}

export interface ApplicationExitDrain {
  readonly suspendRunningExecutorWork: Effect.Effect<
    ReadonlyArray<PlannedAttemptExecutorCorrelation>,
    ApplicationExitDrainFailure
  >
  readonly flushProducedJournalWrites: Effect.Effect<void, ApplicationExitDrainFailure>
  readonly closeProcessLocalResources: Effect.Effect<void, ApplicationExitDrainFailure>
  readonly releaseCoordinatorLock: Effect.Effect<void, ApplicationExitDrainFailure>
}

export interface ApplicationProcessLifecycleService {
  readonly requestEnd: (decision: ApplicationProcessEndDecision) => Effect.Effect<void>
}

export type ApplicationExitTraceEvent =
  | { readonly _tag: "ExitRequested" }
  | { readonly _tag: "AdmissionCutoffClosed" }
  | {
      readonly _tag: "RunningExecutorWorkReachedSafeBoundary"
      readonly correlations: ReadonlyArray<PlannedAttemptExecutorCorrelation>
    }
  | { readonly _tag: "ProducedJournalWritesFlushed" }
  | { readonly _tag: "ProcessLocalResourcesClosed" }
  | { readonly _tag: "CoordinatorLockReleased" }
  | { readonly _tag: "ExitResultReported"; readonly result: ApplicationExitResultType }
  | { readonly _tag: "ProcessEndRequested"; readonly decision: ApplicationProcessEndDecision }

export interface ApplicationExitTraceService {
  readonly emit: (event: ApplicationExitTraceEvent) => Effect.Effect<void>
}

export interface ApplicationExitRequestBoundaryService {
  readonly requestExit: Effect.Effect<ApplicationExitResultType>
}

/** Transport-neutral boundary called by a future Operator or supervisor adapter. */
export class ApplicationExitRequestBoundary extends Context.Service<
  ApplicationExitRequestBoundary,
  ApplicationExitRequestBoundaryService
>()("@dalph/ApplicationExitRequestBoundary") {}

const applicationExitDrainLimit = Duration.seconds(applicationExitDrainLimitSeconds)
const applicationExitDrainLimitNanos = Duration.toNanosUnsafe(applicationExitDrainLimit)

const applicationExitDrainResult = (
  diagnostics: ReadonlyArray<ApplicationExitDiagnostic>
): ApplicationExitResultType => {
  const [first, ...remaining] = diagnostics
  return first === undefined
    ? ApplicationExitResult.cases.Succeeded.make({ requestedStatus: 0 })
    : ApplicationExitResult.cases.Failed.make({ diagnostics: [first, ...remaining], requestedStatus: 1 })
}

/**
 * Starts one monotonic five-second drain at the first request. Later requests
 * await its exact result and cannot restart either work or clock.
 */
export const makeApplicationExitRequestBoundary = Effect.fn("ApplicationExitRequestBoundary.make")(function* (
  lifecycle: ApplicationExitLifecycleService,
  drain: ApplicationExitDrain,
  processLifecycle: ApplicationProcessLifecycleService,
  trace: ApplicationExitTraceService = { emit: () => Effect.void }
) {
  const scope = yield* Effect.scope
  const recordedDiagnostics = yield* Ref.make<ReadonlyArray<ApplicationExitDiagnostic>>([])
  const runStep = Effect.fn("ApplicationExitRequestBoundary.runStep")(function* (
    operation: Effect.Effect<void, ApplicationExitDrainFailure>,
    successEvent: ApplicationExitTraceEvent
  ) {
    return yield* operation.pipe(
      Effect.matchEffect({
        onFailure: (failure) => Ref.update(recordedDiagnostics, (current) => [...current, ...failure.diagnostics]),
        onSuccess: () => trace.emit(successEvent)
      })
    )
  })

  const drainApplication = Effect.gen(function* () {
    const safeExecutorCorrelations = yield* drain.suspendRunningExecutorWork.pipe(
      Effect.matchEffect({
        onFailure: (failure) =>
          Ref.update(recordedDiagnostics, (current) => [...current, ...failure.diagnostics]).pipe(Effect.as([])),
        onSuccess: Effect.succeed
      })
    )
    if (safeExecutorCorrelations.length > 0) {
      yield* trace.emit({ _tag: "RunningExecutorWorkReachedSafeBoundary", correlations: safeExecutorCorrelations })
    }
    for (const [operation, event] of [
      [drain.flushProducedJournalWrites, { _tag: "ProducedJournalWritesFlushed" as const }],
      [drain.closeProcessLocalResources, { _tag: "ProcessLocalResourcesClosed" as const }],
      [drain.releaseCoordinatorLock, { _tag: "CoordinatorLockReleased" as const }]
    ] as const) {
      yield* runStep(operation, event)
    }
    return applicationExitDrainResult(yield* Ref.get(recordedDiagnostics))
  })

  const driver = (cutoffAt: bigint) =>
    Effect.gen(function* () {
      const now = yield* Clock.monotonicTimeNanos
      const elapsed = now - cutoffAt
      const remaining = elapsed >= applicationExitDrainLimitNanos ? 0n : applicationExitDrainLimitNanos - elapsed
      const withinLimit = yield* drainApplication.pipe(Effect.timeoutOption(Duration.nanos(remaining)))
      const result = Option.isSome(withinLimit)
        ? withinLimit.value
        : ApplicationExitResult.cases.TimedOut.make({
            diagnostics: yield* Ref.get(recordedDiagnostics),
            requestedStatus: 1
          })
      yield* trace.emit({ _tag: "ExitResultReported", result })
      yield* lifecycle.completeExit(result)
      const decision = decideApplicationProcessEnd(result)
      yield* trace.emit({ _tag: "ProcessEndRequested", decision })
      yield* processLifecycle.requestEnd(decision)
      yield* lifecycle.completeExitDriver
    }).pipe(Effect.ensuring(lifecycle.completeExitDriver))

  const requestExit = Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      yield* trace.emit({ _tag: "ExitRequested" })
      const request = yield* lifecycle.requestExit
      if (request.first) {
        yield* trace.emit({ _tag: "AdmissionCutoffClosed" })
        yield* driver(request.cutoffAt).pipe(Effect.forkIn(scope))
      }
      const completed = yield* restore(Deferred.await(request.result))
      yield* restore(lifecycle.awaitExitDriverFinished)
      return completed
    })
  )

  return ApplicationExitRequestBoundary.of({ requestExit })
})

export interface ApplicationExitProcessLocalDrain {
  readonly closeProcessLocalResources: Effect.Effect<void, ApplicationExitDrainFailure>
}

/** One active Run's fast, non-LLM executor-family Exit drain. */
export interface ApplicationExitExecutorDrain {
  readonly suspendRunningExecutorWork: Effect.Effect<
    ReadonlyArray<PlannedAttemptExecutorCorrelation>,
    ApplicationExitDrainFailure
  >
}

/** Exact registration whose completion keeps its active Run services alive through Exit draining. */
export interface ApplicationExitExecutorDrainRegistration {
  readonly awaitFinished: Effect.Effect<void>
}

/** Application-owned runtime capabilities shared by every Run bootstrap in this process. */
export interface ApplicationExitShellService {
  readonly admission: ApplicationExitAdmissionService
  readonly awaitExitRequested: Effect.Effect<void>
  readonly registerExecutorDrain: (
    drain: ApplicationExitExecutorDrain
  ) => Effect.Effect<ApplicationExitExecutorDrainRegistration, never, Scope.Scope>
  readonly registerProcessLocalDrain: (
    drain: ApplicationExitProcessLocalDrain
  ) => Effect.Effect<void, never, Scope.Scope>
  readonly requestBoundary: ApplicationExitRequestBoundaryService
}

/**
 * Owns the one process-wide Exit lifecycle, driver, process port, drain registry,
 * and exact coordinator-lock release independently of any Run bootstrap.
 */
export const makeApplicationExitShell = Effect.fn("ApplicationExitShell.make")(function* (
  ownership: CoordinatorOwnershipCapability,
  processLifecycle: ApplicationProcessLifecycleService,
  trace: ApplicationExitTraceService = { emit: () => Effect.void }
) {
  const lifecycle = yield* makeApplicationExitLifecycle()
  const executorDrains = yield* Ref.make({
    nextId: 0,
    registered: new Map<
      number,
      { readonly drain: ApplicationExitExecutorDrain; readonly finished: Deferred.Deferred<void> }
    >()
  })
  const processLocalDrains = yield* Ref.make({
    nextId: 0,
    registered: new Map<number, ApplicationExitProcessLocalDrain>()
  })
  const requestBoundary = yield* makeApplicationExitRequestBoundary(
    lifecycle,
    {
      suspendRunningExecutorWork: Effect.gen(function* () {
        const drains = [...(yield* Ref.get(executorDrains)).registered.values()]
        const results = yield* Effect.forEach(
          drains,
          ({ drain, finished }) =>
            drain.suspendRunningExecutorWork.pipe(
              Effect.match({
                onFailure: ({ diagnostics }) => ({ correlations: [], diagnostics }),
                onSuccess: (correlations) => ({ correlations, diagnostics: [] })
              }),
              Effect.ensuring(Deferred.succeed(finished, undefined))
            ),
          { concurrency: Math.max(drains.length, 1) }
        )
        const diagnostics = results.flatMap(({ diagnostics }) => diagnostics)
        const [first, ...remaining] = diagnostics
        if (first !== undefined) {
          return yield* new ApplicationExitDrainFailure({ diagnostics: [first, ...remaining] })
        }
        return results.flatMap(({ correlations }) => correlations)
      }),
      flushProducedJournalWrites: lifecycle.awaitForwardOwnersReleased,
      closeProcessLocalResources: Effect.gen(function* () {
        const drains = [...(yield* Ref.get(processLocalDrains)).registered.values()]
        const diagnostics = yield* Effect.forEach(drains, ({ closeProcessLocalResources }) =>
          closeProcessLocalResources.pipe(
            Effect.match({ onFailure: ({ diagnostics }) => diagnostics, onSuccess: () => [] })
          )
        ).pipe(Effect.map((results) => results.flat()))
        const [first, ...remaining] = diagnostics
        if (first !== undefined) {
          return yield* new ApplicationExitDrainFailure({ diagnostics: [first, ...remaining] })
        }
      }),
      releaseCoordinatorLock: ownership.release
    },
    processLifecycle,
    trace
  )
  return {
    admission: lifecycle.admission,
    awaitExitRequested: lifecycle.awaitExitRequested,
    registerExecutorDrain: (drain) =>
      Effect.gen(function* () {
        const finished = yield* Deferred.make<void>()
        const drainId = yield* Ref.modify(executorDrains, (current) => {
          const registered = new Map(current.registered).set(current.nextId, { drain, finished })
          return [current.nextId, { nextId: current.nextId + 1, registered }] as const
        })
        yield* Effect.addFinalizer(() =>
          Ref.update(executorDrains, (current) => {
            const registered = new Map(current.registered)
            registered.delete(drainId)
            return { ...current, registered }
          })
        )
        return { awaitFinished: Deferred.await(finished) } satisfies ApplicationExitExecutorDrainRegistration
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
  } satisfies ApplicationExitShellService
})
