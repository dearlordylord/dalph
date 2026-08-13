import {
  Array as EffectArray,
  Clock,
  Context,
  Deferred,
  Duration,
  Effect,
  Option,
  Ref,
  Schema,
  type Scope
} from "effect"
import type { PlannedAttemptExecutorCorrelation } from "@dalph/contracts"
import {
  ApplicationExitDiagnostic,
  ApplicationExitResult,
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
      readonly correlations: readonly [PlannedAttemptExecutorCorrelation, ...Array<PlannedAttemptExecutorCorrelation>]
    }
  | { readonly _tag: "ProducedJournalWritesFlushed" }
  | { readonly _tag: "ProcessLocalResourcesClosed" }
  | { readonly _tag: "CoordinatorLockReleased" }
  | { readonly _tag: "ExitResultReported"; readonly result: ApplicationExitResultType }
  | { readonly _tag: "ProcessEndRequested"; readonly decision: ApplicationProcessEndDecision }

export interface ApplicationExitTraceService {
  readonly emit: (event: ApplicationExitTraceEvent) => Effect.Effect<void>
}

const emitSafeExecutorCorrelations = (
  trace: ApplicationExitTraceService,
  correlations: ReadonlyArray<PlannedAttemptExecutorCorrelation>
) => {
  const [first, ...remaining] = correlations
  return first === undefined
    ? Effect.void
    : trace.emit({ _tag: "RunningExecutorWorkReachedSafeBoundary", correlations: [first, ...remaining] })
}

export interface ApplicationExitRequestBoundaryService {
  readonly requestExit: Effect.Effect<ApplicationExitResultType>
}

/** Transport-neutral boundary called by a future Operator or supervisor adapter. */
export class ApplicationExitRequestBoundary extends Context.Service<
  ApplicationExitRequestBoundary,
  ApplicationExitRequestBoundaryService
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

/**
 * Starts one monotonic five-second drain at the first request. Later requests
 * await its exact result and cannot restart either work or clock.
 */
export const makeApplicationExitRequestBoundary = Effect.fn("ApplicationExitRequestBoundary.make")(function* (
  lifecycle: ApplicationExitLifecycleService,
  drain: ApplicationExitDrain,
  processLifecycle: ApplicationProcessLifecycleService,
  trace: ApplicationExitTraceService = { emit: () => Effect.void },
  beginExecutorDrainHandoff: Effect.Effect<void> = Effect.void,
  readSettledQuickDrainDiagnostics: Effect.Effect<
    ReadonlyMap<ApplicationExitQuickDrainFamily, ReadonlyArray<ApplicationExitDiagnostic>>
  > = Effect.succeed(new Map())
) {
  const scope = yield* Effect.scope
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
        runQuickDrain("ExecutorSuspension", drain.suspendRunningExecutorWork, (correlations) =>
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
    yield* runQuickDrain("CoordinatorLockRelease", drain.releaseCoordinatorLock, () =>
      trace.emit({ _tag: "CoordinatorLockReleased" })
    )
    return applicationExitDrainResult(yield* currentDiagnostics)
  })

  const driver = (cutoffAt: bigint) =>
    Effect.gen(function* () {
      const now = yield* Clock.monotonicTimeNanos
      const elapsed = now - cutoffAt
      const remaining = elapsed >= applicationExitDrainLimitNanos ? 0n : applicationExitDrainLimitNanos - elapsed
      const withinLimit = yield* drainApplication.pipe(Effect.timeoutOption(Duration.nanos(remaining)))
      const result = Option.isSome(withinLimit)
        ? withinLimit.value
        : ApplicationExitResult.cases.TimedOut.make({ diagnostics: yield* currentDiagnostics, requestedStatus: 1 })
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
      yield* beginExecutorDrainHandoff
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
  readonly phase: "Serving" | "CutoffPending" | "Draining"
  readonly registered: ReadonlyMap<number, RegisteredApplicationExitExecutorDrain>
}

/** Application-owned runtime capabilities shared by every Run bootstrap in this process. */
export interface ApplicationExitShellService {
  readonly admission: ApplicationExitAdmissionService
  readonly awaitExitRequested: Effect.Effect<void>
  readonly registerExecutorDrain: (drain: ApplicationExitExecutorDrain) => Effect.Effect<void, never, Scope.Scope>
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
  const scope = yield* Effect.scope
  const lifecycle = yield* makeApplicationExitLifecycle()
  const executorDrains = yield* Ref.make<ApplicationExitExecutorDrainRegistry>({
    nextId: 0,
    phase: "Serving",
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
  const runExecutorDrain = Effect.fn("ApplicationExitShell.runExecutorDrain")(function* (
    entry: RegisteredApplicationExitExecutorDrain
  ) {
    const result = yield* entry.drain.suspendRunningExecutorWork.pipe(
      Effect.match({
        onFailure: ({ diagnostics }): ApplicationExitExecutorDrainResult => ({ correlations: [], diagnostics }),
        onSuccess: (correlations): ApplicationExitExecutorDrainResult => ({ correlations, diagnostics: [] })
      })
    )
    if (result.diagnostics.length > 0) {
      yield* Ref.update(settledExecutorDiagnostics, (current) =>
        new Map(current).set(entry.drainId, result.diagnostics)
      )
    }
    yield* emitSafeExecutorCorrelations(trace, result.correlations)
    yield* Deferred.succeed(entry.finished, result)
  })

  const startExecutorDrains = (entries: ReadonlyArray<RegisteredApplicationExitExecutorDrain>) =>
    Effect.forEach(entries, (entry) => runExecutorDrain(entry).pipe(Effect.forkIn(scope)), { discard: true })

  const claimExecutorDrainResult = Effect.fn("ApplicationExitShell.claimExecutorDrainResult")(function* (
    entry: RegisteredApplicationExitExecutorDrain
  ) {
    const result = yield* Deferred.await(entry.finished)
    return yield* Ref.modify(entry.resultCollected, (collected) => [
      collected ? Option.none() : Option.some(result),
      true
    ])
  })

  const beginExecutorDrainHandoff = Ref.update(executorDrains, (current) =>
    current.phase === "Serving" ? { ...current, phase: "CutoffPending" as const } : current
  )

  const activateExecutorDrains = Effect.gen(function* () {
    const entries = yield* Ref.modify(executorDrains, (current) => {
      const pending = [...current.registered.values()].filter(({ started }) => !started)
      const registered = new Map([...current.registered].map(([id, entry]) => [id, { ...entry, started: true }]))
      return [pending, { ...current, phase: "Draining" as const, registered }] as const
    })
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

  const requestBoundary = yield* makeApplicationExitRequestBoundary(
    lifecycle,
    {
      suspendRunningExecutorWork: activateExecutorDrains,
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
      releaseCoordinatorLock: ownership.release
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
    )
  )
  return {
    admission: lifecycle.admission,
    awaitExitRequested: lifecycle.awaitExitRequested,
    registerExecutorDrain: (drain) =>
      Effect.gen(function* () {
        const finished = yield* Deferred.make<ApplicationExitExecutorDrainResult>()
        const resultCollected = yield* Ref.make(false)
        const registration = yield* Ref.modify(executorDrains, (current) => {
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
            { drainId: current.nextId, entry, started },
            { ...current, nextId: current.nextId + 1, registered }
          ] as const
        })
        if (registration.started) yield* startExecutorDrains([registration.entry])
        yield* Effect.addFinalizer(() =>
          Ref.modify(executorDrains, (current) => {
            if (current.phase !== "Serving") {
              return [
                Effect.raceFirst(Deferred.await(finished).pipe(Effect.asVoid), lifecycle.awaitExitDriverFinished),
                current
              ] as const
            }
            const registered = new Map(current.registered)
            registered.delete(registration.drainId)
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
  } satisfies ApplicationExitShellService
})
