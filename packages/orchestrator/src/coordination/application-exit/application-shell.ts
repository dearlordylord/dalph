import { Clock, Context, Deferred, Duration, Effect, Option, Ref, Schema } from "effect"
import {
  ApplicationExitDiagnostic,
  ApplicationExitResult,
  type ApplicationExitResult as ApplicationExitResultType,
  type ApplicationProcessEndDecision,
  decideApplicationProcessEnd
} from "./lifecycle-decision.js"
import type { ApplicationExitLifecycleService } from "./lifecycle.js"

/** One idle-drain boundary failed without creating a Run workflow fact. */
export class ApplicationExitDrainFailure extends Schema.TaggedError<ApplicationExitDrainFailure>()(
  "ApplicationExitDrainFailure",
  { diagnostic: ApplicationExitDiagnostic }
) {}

export interface ApplicationExitIdleDrain {
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

const applicationExitDrainLimitSeconds = 5
const applicationExitDrainLimit = Duration.seconds(applicationExitDrainLimitSeconds)
const applicationExitDrainLimitNanos = Duration.toNanosUnsafe(applicationExitDrainLimit)

const idleDrainResult = (diagnostics: ReadonlyArray<ApplicationExitDiagnostic>): ApplicationExitResultType => {
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
  drain: ApplicationExitIdleDrain,
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
        onFailure: (failure) => Ref.update(recordedDiagnostics, (current) => [...current, failure.diagnostic]),
        onSuccess: () => trace.emit(successEvent)
      })
    )
  })

  const idleDrain = Effect.gen(function* () {
    for (const [operation, event] of [
      [drain.flushProducedJournalWrites, { _tag: "ProducedJournalWritesFlushed" as const }],
      [drain.closeProcessLocalResources, { _tag: "ProcessLocalResourcesClosed" as const }],
      [drain.releaseCoordinatorLock, { _tag: "CoordinatorLockReleased" as const }]
    ] as const) {
      yield* runStep(operation, event)
    }
    return idleDrainResult(yield* Ref.get(recordedDiagnostics))
  })

  const driver = (cutoffAt: bigint) =>
    Effect.gen(function* () {
      const now = yield* Clock.monotonicTimeNanos
      const elapsed = now - cutoffAt
      const remaining = elapsed >= applicationExitDrainLimitNanos ? 0n : applicationExitDrainLimitNanos - elapsed
      const withinLimit = yield* idleDrain.pipe(Effect.timeoutOption(Duration.nanos(remaining)))
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
