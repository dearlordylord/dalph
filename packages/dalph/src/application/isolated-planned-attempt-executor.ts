import {
  ExecutorGuidanceSelection,
  ExecutorGuidanceTransmission,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorLifecycleObservation,
  PlannedAttemptExecutorProjection,
  PlannedAttemptExecutorWriterCustody,
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
  readonly rejectedStopped: Ref.Ref<boolean>
  readonly recoveryNonce: Ref.Ref<string | undefined>
  readonly users: Ref.Ref<number>
}

/** Constructs one scoped execution owner, not a new owner for each observation. */
export const isolatedPlannedAttemptExecutorLayer = <E>(
  acquire: (
    correlation: PlannedAttemptExecutorCorrelation
  ) => Effect.Effect<Context.Context<AttemptServices>, E, Scope.Scope>,
  failureDetail: (failure: E) => string,
  acquireRetiredWriterCustody?: (
    plannedAttempt: Parameters<NonNullable<PlannedAttemptExecutor["Service"]["observeWriterCustody"]>>[0]
  ) => Effect.Effect<PlannedAttemptExecutorWriterCustody, E, Scope.Scope>
): Layer.Layer<AttemptServices | CodexProviderWorkUnitReplacement> =>
  Layer.effectContext(
    Effect.gen(function* () {
      const hostScope = yield* Effect.scope
      const acquisition = yield* Semaphore.make(1)
      const owners = yield* Ref.make<ReadonlyMap<string, AttemptOwner>>(new Map())
      const ownerFor = Effect.fn("IsolatedPlannedAttemptExecutor.ownerFor")(function* (
        correlation: PlannedAttemptExecutorCorrelation,
        recoveryNonce?: string
      ) {
        return yield* acquisition.withPermit(
          Effect.gen(function* () {
            const key = plannedAttemptExecutorCorrelationKey(correlation)
            const current = yield* Ref.get(owners)
            const retained = current.get(key)
            if (retained !== undefined) {
              const renew =
                recoveryNonce !== undefined &&
                recoveryNonce !== (yield* Ref.get(retained.recoveryNonce)) &&
                (yield* Ref.get(retained.rejectedStopped)) &&
                (yield* Ref.get(retained.users)) === 0
              if (!renew) {
                yield* Ref.update(retained.users, (users) => users + 1)
                return retained
              }
              // A new explicit permission may acquire a new incarnation only after
              // exact stopped custody and all old calls/attachments have left.
              yield* retained.close
              yield* Ref.set(owners, new Map([...current].filter(([entry]) => entry !== key)))
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
              rejectedStopped: yield* Ref.make(false),
              recoveryNonce: yield* Ref.make(recoveryNonce),
              users: yield* Ref.make(1)
            }
            yield* Ref.update(owners, (entries) => new Map(entries).set(key, owner))
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
        Effect.all(
          [
            Ref.set(owner.terminal, report._tag === "ExecutorWorkTerminal"),
            Ref.set(
              owner.rejectedStopped,
              report._tag === "ExecutorWorkResultRejected" && report.custody._tag === "Stopped"
            )
          ],
          { discard: true }
        )
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
        use: (owner: AttemptOwner) => Effect.Effect<A, E2, R>,
        recoveryNonce?: string
      ) => Effect.acquireUseRelease(ownerFor(correlation, recoveryNonce), use, (owner) => release(correlation, owner))
      const withExistingOwner = <A>(
        correlation: PlannedAttemptExecutorCorrelation,
        unavailable: A,
        use: (owner: AttemptOwner) => Effect.Effect<A>
      ): Effect.Effect<A> =>
        Effect.acquireUseRelease(
          acquisition.withPermit(
            Effect.gen(function* () {
              const owner = (yield* Ref.get(owners)).get(plannedAttemptExecutorCorrelationKey(correlation))
              if (owner === undefined || (yield* Ref.get(owner.terminal))) return Option.none<AttemptOwner>()
              yield* Ref.update(owner.users, (users) => users + 1)
              return Option.some(owner)
            })
          ),
          (owner) => (Option.isNone(owner) ? Effect.succeed(unavailable) : use(owner.value)),
          (owner) => (Option.isNone(owner) ? Effect.void : release(correlation, owner.value))
        )
      const executor = PlannedAttemptExecutor.of({
        selectGuidanceTarget: (plannedAttempt) =>
          withExistingOwner<ExecutorGuidanceSelection>(
            plannedAttemptExecutorCorrelation(plannedAttempt),
            ExecutorGuidanceSelection.cases.Refused.make({ reason: "OwnerUnavailable" }),
            (owner) => {
              const select = Context.get(owner.context, PlannedAttemptExecutor).selectGuidanceTarget
              return select === undefined
                ? Effect.succeed(ExecutorGuidanceSelection.cases.Refused.make({ reason: "CapabilityUnavailable" }))
                : select(plannedAttempt)
            }
          ),
        sendGuidance: (target, requestId, text) =>
          withExistingOwner<ExecutorGuidanceTransmission>(
            plannedAttemptExecutorCorrelation(target.plannedAttempt),
            ExecutorGuidanceTransmission.cases.Refused.make({ reason: "OwnerUnavailable" }),
            (owner) => {
              const send = Context.get(owner.context, PlannedAttemptExecutor).sendGuidance
              return send === undefined
                ? Effect.succeed(ExecutorGuidanceTransmission.cases.Refused.make({ reason: "CapabilityUnavailable" }))
                : send(target, requestId, text)
            }
          ),
        observeWriterCustody: (plannedAttempt) => {
          const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
          return withOwner(correlation, (owner) =>
            Effect.gen(function* () {
              if ((yield* Ref.get(owner.terminal)) && acquireRetiredWriterCustody !== undefined) {
                // Explicit recovery obtains fresh substrate evidence in a separate
                // scope. Passive lifecycle reads retain their original routing owner.
                return yield* acquisition.withPermit(
                  Effect.gen(function* () {
                    if ((yield* Ref.get(owner.users)) !== 1)
                      return PlannedAttemptExecutorWriterCustody.cases.Unresolved.make({
                        plannedAttempt,
                        detail: "terminal attempt still has active calls or lifecycle attachments"
                      })
                    yield* owner.close
                    return yield* Effect.scoped(acquireRetiredWriterCustody(plannedAttempt))
                  })
                )
              }
              const observe = Context.get(owner.context, PlannedAttemptExecutor).observeWriterCustody
              return yield* observe === undefined
                ? Effect.succeed(
                    PlannedAttemptExecutorWriterCustody.cases.Unresolved.make({
                      plannedAttempt,
                      detail: "isolated attempt owner does not expose writer custody observation"
                    })
                  )
                : observe(plannedAttempt)
            })
          ).pipe(
            Effect.catch((failure) =>
              Effect.succeed(
                PlannedAttemptExecutorWriterCustody.cases.Unresolved.make({
                  plannedAttempt,
                  detail: failureDetail(failure)
                })
              )
            )
          )
        },
        continueRejectedResult: (request, authorization) => {
          const correlation = plannedAttemptExecutorCorrelation(request.plannedAttempt)
          if (
            authorization.correlation.runId !== correlation.runId ||
            authorization.correlation.attemptId !== correlation.attemptId
          )
            return Effect.fail(
              preserveCommandFailure(
                "ContinueRejectedResult",
                correlation,
                new CodexAppServerFailure({
                  detail: "result recovery authorization names another attempt",
                  kind: "Ownership",
                  operation: "initialize"
                })
              )
            )
          return withOwner(
            correlation,
            (owner) =>
              Effect.gen(function* () {
                if (
                  (yield* Ref.get(owner.rejectedStopped)) &&
                  (yield* Ref.get(owner.recoveryNonce)) !== authorization.nonce
                )
                  return yield* new CodexAppServerFailure({
                    detail: "stopped attempt owner still has active calls or lifecycle attachments",
                    kind: "Ownership",
                    operation: "initialize"
                  })
                const continueResult = Context.get(owner.context, PlannedAttemptExecutor).continueRejectedResult
                return yield* continueResult === undefined
                  ? Effect.fail(
                      new CodexAppServerFailure({
                        detail: "isolated attempt owner does not expose result recovery",
                        kind: "Protocol",
                        operation: "initialize"
                      })
                    )
                  : continueResult(request, authorization).pipe(Effect.tap((report) => noteReport(owner, report)))
              }),
            authorization.nonce
          ).pipe(Effect.mapError((failure) => preserveCommandFailure("ContinueRejectedResult", correlation, failure)))
        },
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
