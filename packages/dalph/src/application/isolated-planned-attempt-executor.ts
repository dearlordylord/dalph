import {
  PlannedAttemptExecutor,
  PlannedAttemptExecutorLifecycleObservation,
  PlannedAttemptExecutorProjection,
  plannedAttemptExecutorCorrelation,
  plannedAttemptExecutorCorrelationKey,
  type PlannedAttemptExecutorCorrelation,
  type PlannedAttemptExecutorReport
} from "@dalph/contracts"
import { Context, Effect, Exit, Layer, Option, Ref, Scope, Semaphore, Stream } from "effect"
import { CodexProviderWorkUnitReplacement, preserveCommandFailure } from "./codex-planned-attempt-executor.js"
import { CodexAppServerFailure } from "./codex-app-server.js"

type AttemptServices = PlannedAttemptExecutor | PlannedAttemptExecutorLifecycleObservation

interface AttemptOwner {
  readonly context: Context.Context<AttemptServices>
  readonly close: Effect.Effect<void>
  readonly terminal: Ref.Ref<boolean>
  readonly users: Ref.Ref<number>
}

/** Constructs one scoped execution owner, not a new owner for each observation. */
export const isolatedPlannedAttemptExecutorLayer = <E>(
  acquire: (
    correlation: PlannedAttemptExecutorCorrelation
  ) => Effect.Effect<Context.Context<AttemptServices>, E, Scope.Scope>,
  failureDetail: (failure: E) => string
): Layer.Layer<AttemptServices | CodexProviderWorkUnitReplacement> =>
  Layer.effectContext(
    Effect.gen(function* () {
      const hostScope = yield* Effect.scope
      const acquisition = yield* Semaphore.make(1)
      const owners = yield* Ref.make<ReadonlyMap<string, AttemptOwner>>(new Map())
      const ownerFor = Effect.fn("IsolatedPlannedAttemptExecutor.ownerFor")(function* (
        correlation: PlannedAttemptExecutorCorrelation
      ) {
        return yield* acquisition.withPermit(
          Effect.gen(function* () {
            const key = plannedAttemptExecutorCorrelationKey(correlation)
            const current = yield* Ref.get(owners)
            const retained = current.get(key)
            if (retained !== undefined) {
              yield* Ref.update(retained.users, (users) => users + 1)
              return retained
            }
            const scope = yield* Scope.fork(hostScope)
            const context = yield* acquire(correlation).pipe(
              Effect.provideService(Scope.Scope, scope),
              Effect.onError((cause) => Scope.close(scope, Exit.failCause(cause)))
            )
            const owner: AttemptOwner = {
              context,
              close: yield* Effect.cached(Scope.close(scope, Exit.void)),
              terminal: yield* Ref.make(false),
              users: yield* Ref.make(1)
            }
            yield* Ref.set(owners, new Map(current).set(key, owner))
            return owner
          })
        )
      })
      const unreadable = (correlation: PlannedAttemptExecutorCorrelation, failure: E) =>
        PlannedAttemptExecutorProjection.cases.Unreadable.make({ correlation, detail: failureDetail(failure) })
      // A subscription disappearing or an unreadable projection is not stopped-writer proof.
      // Suspended owners remain available for Resume. Only an authoritative terminal
      // report permits retirement, after every attachment and in-flight call has left.
      const noteReport = (owner: AttemptOwner, report: PlannedAttemptExecutorReport) =>
        Ref.set(owner.terminal, report._tag === "ExecutorWorkTerminal")
      const noteProjection = (owner: AttemptOwner, projection: PlannedAttemptExecutorProjection) =>
        projection._tag === "Exact" ? noteReport(owner, projection.report) : Effect.void
      const release = (correlation: PlannedAttemptExecutorCorrelation, owner: AttemptOwner) =>
        acquisition.withPermit(
          Effect.gen(function* () {
            const users = yield* Ref.updateAndGet(owner.users, (count) => count - 1)
            if (users !== 0 || !(yield* Ref.get(owner.terminal))) return
            const key = plannedAttemptExecutorCorrelationKey(correlation)
            const current = yield* Ref.get(owners)
            if (current.get(key) !== owner) return
            // Keep the exact routing handle after its resources close. A later
            // passive poll must not allocate another provider for a terminal attempt.
            // This retains services, never a copied lifecycle report. Cached close
            // also preserves a failed finalizer instead of crediting a second no-op.
            yield* owner.close
          })
        )
      const withOwner = <A, E2, R>(
        correlation: PlannedAttemptExecutorCorrelation,
        use: (owner: AttemptOwner) => Effect.Effect<A, E2, R>
      ) => Effect.acquireUseRelease(ownerFor(correlation), use, (owner) => release(correlation, owner))
      const executor = PlannedAttemptExecutor.of({
        observe: (correlation, purpose) =>
          withOwner(correlation, (owner) =>
            Context.get(owner.context, PlannedAttemptExecutor)
              .observe(correlation, purpose)
              .pipe(Effect.tap((projection) => noteProjection(owner, projection)))
          ).pipe(Effect.catch((failure) => Effect.succeed(unreadable(correlation, failure)))),
        begin: (request, delivery) => {
          const correlation = plannedAttemptExecutorCorrelation(request.plannedAttempt)
          return withOwner(correlation, (owner) =>
            Context.get(owner.context, PlannedAttemptExecutor)
              .begin(request, delivery)
              .pipe(Effect.tap((report) => noteReport(owner, report)))
          ).pipe(Effect.mapError((failure) => preserveCommandFailure("Begin", correlation, failure)))
        },
        requestSuspension: (attempt) => {
          const correlation = plannedAttemptExecutorCorrelation(attempt)
          return withOwner(correlation, (owner) =>
            Context.get(owner.context, PlannedAttemptExecutor)
              .requestSuspension(attempt)
              .pipe(Effect.tap((report) => noteReport(owner, report)))
          ).pipe(Effect.mapError((failure) => preserveCommandFailure("Suspend", correlation, failure)))
        },
        resume: (request) => {
          const correlation = plannedAttemptExecutorCorrelation(request.plannedAttempt)
          return withOwner(correlation, (owner) =>
            Context.get(owner.context, PlannedAttemptExecutor)
              .resume(request)
              .pipe(Effect.tap((report) => noteReport(owner, report)))
          ).pipe(Effect.mapError((failure) => preserveCommandFailure("Resume", correlation, failure)))
        }
      })
      const observation = PlannedAttemptExecutorLifecycleObservation.of({
        attach: (correlation) =>
          Effect.gen(function* () {
            const releaseLease = (lease: { readonly owner: AttemptOwner; readonly released: Ref.Ref<boolean> }) =>
              Ref.getAndSet(lease.released, true).pipe(
                Effect.flatMap((alreadyReleased) => (alreadyReleased ? Effect.void : release(correlation, lease.owner)))
              )
            const lease = yield* Effect.acquireRelease(
              Effect.gen(function* () {
                const owner = yield* ownerFor(correlation)
                return { owner, released: yield* Ref.make(false) }
              }),
              releaseLease
            )
            const owner = lease.owner
            const attachment = yield* Context.get(owner.context, PlannedAttemptExecutorLifecycleObservation)
              .attach(correlation)
              .pipe(Effect.onExit((exit) => (Exit.isFailure(exit) ? releaseLease(lease) : Effect.void)))
            yield* noteProjection(owner, attachment.current)
            const closed = yield* Ref.make(false)
            const close = Ref.getAndSet(closed, true).pipe(
              Effect.flatMap((alreadyClosed) =>
                alreadyClosed ? Effect.void : attachment.close.pipe(Effect.ensuring(releaseLease(lease)))
              ),
              Effect.uninterruptible
            )
            yield* Effect.addFinalizer(() => close)
            return {
              current: attachment.current,
              changes: attachment.changes.pipe(Stream.tap((projection) => noteProjection(owner, projection))),
              close
            }
          }).pipe(
            Effect.catch((failure) =>
              Effect.succeed({ current: unreadable(correlation, failure), changes: Stream.empty, close: Effect.void })
            )
          )
      })
      const replacement = CodexProviderWorkUnitReplacement.of({
        replacePurgedProviderWorkUnit: (request) => {
          const correlation = plannedAttemptExecutorCorrelation(request.plannedAttempt)
          return Effect.acquireUseRelease(
            ownerFor(correlation).pipe(
              Effect.mapError(
                (failure) =>
                  new CodexAppServerFailure({
                    detail: failureDetail(failure),
                    kind: "Ownership",
                    operation: "initialize"
                  })
              )
            ),
            (owner) => {
              const service = Context.getOption(owner.context, CodexProviderWorkUnitReplacement)
              return Option.isNone(service)
                ? Effect.fail(
                    new CodexAppServerFailure({
                      detail: "isolated attempt owner does not expose work-unit replacement",
                      kind: "Protocol",
                      operation: "initialize"
                    })
                  )
                : service.value
                    .replacePurgedProviderWorkUnit(request)
                    .pipe(
                      Effect.tap((result) =>
                        result._tag === "Replaced" ? Ref.set(owner.terminal, false) : Effect.void
                      )
                    )
            },
            (owner) => release(correlation, owner)
          )
        }
      })
      return Context.make(PlannedAttemptExecutor, executor).pipe(
        Context.add(PlannedAttemptExecutorLifecycleObservation, observation),
        Context.add(CodexProviderWorkUnitReplacement, replacement)
      )
    })
  )
