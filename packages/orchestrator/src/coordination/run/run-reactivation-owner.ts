import {
  Context,
  Data,
  Deferred,
  Duration,
  Effect,
  Fiber,
  Layer,
  Option,
  Queue,
  Ref,
  Schedule,
  Schema,
  Semaphore,
  Stream
} from "effect"
import type { RunId } from "@dalph/contracts"
import type { RunFinalityDecision as RunFinalityDecisionValue } from "../frontier/frontier.js"
import { ApplicationExitShell } from "../application-exit/application-shell.js"
import { attachCurrentSignal, type CurrentSignal } from "../delivery/relations.js"
import type { AcceptedRunControlDirection, AcceptedRunControlObserver, RunReactivationControlState } from "./run.js"
import { type ActiveWorkAuthorityRefreshSource, RunActivationOpportunity } from "./run-activation-opportunity.js"

/** A non-authoritative request to ask the ordinary Run entry for current facts. */
export type RunReactivationHint = Data.TaggedEnum<{
  Startup: Record<never, never>
  TrackerNotification: Record<never, never>
  AcceptedFactPublication: Record<never, never>
  OperatorWake: Record<never, never>
  Timer: Record<never, never>
}>

export const RunReactivationHint = Data.taggedEnum<RunReactivationHint>()

/**
 * A fresh establishment/activation effect is rerunnable only at its narrow
 * boundary. The owner initializes its local control projection from durable
 * Run history once, then changes it only after an accepted Run control fact;
 * a failed activation is observed and cooled down, never retried.
 */
// eslint-disable-next-line functional/no-mixed-types -- The application seam intentionally groups the repeatable activation, durable control read, timing, and typed failure observer.
export interface RunReactivationOwnerOptions<E, R = never, EInstall = E> {
  /** Exact workflow Run whose Journal-backed control state this owner serves. */
  readonly runId: RunId
  readonly activate: (opportunity: RunActivationOpportunity) => Effect.Effect<RunFinalityDecisionValue, E, R>
  /** Establishes the Run and captures its validated-prefix Running subjects before active reads. */
  readonly activateActiveWorkAuthorityRefresh: (
    source: ActiveWorkAuthorityRefreshSource
  ) => Effect.Effect<RunFinalityDecisionValue, E, R>
  readonly readControl: Effect.Effect<RunReactivationControlState, E, R>
  readonly activationInterval: Duration.Input
  /** Finite positive delay after a failed read/activation before a later hint is considered. */
  readonly failureCooldown: Duration.Input
  /** The application must observe every typed read/activation failure here. */
  readonly onFailure: (failure: E | EInstall) => Effect.Effect<void>
  /** Terminates the owner for a typed activation failure caused by durable Run closure. */
  readonly isTerminationFailure: (failure: E) => boolean
  /** Optional host-owned current-first adapter for tracker notifications; values remain hints. */
  readonly trackerNotificationSource?: CurrentSignal<unknown>
  /** Installs the Journal callbacks before the worker can consume its startup hint. */
  readonly installAcceptedRunReactivationObservers: (observers: {
    readonly control: AcceptedRunControlObserver
    readonly acceptedFactPublication: Effect.Effect<void>
  }) => Effect.Effect<void, EInstall, R>
  /** Optional process-local timer lifecycle observation for diagnostics. */
  readonly onTimerStateChange?: (state: "Started" | "Stopped") => Effect.Effect<void>
  /** Optional process-local activation-finalization observation for deterministic lifecycle tests. */
  readonly onActivationFinalizationStart?: (kind: "Ordinary" | "ActiveWorkAuthorityRefresh") => Effect.Effect<void>
  /** Optional process-local trailing-obligation observation for deterministic lifecycle tests. */
  readonly onTrailingOrdinaryRecorded?: (generation: number) => Effect.Effect<void>
  /** Optional process-local idle-handoff observation for deterministic lifecycle tests. */
  readonly onActivationHandoffIdle?: () => Effect.Effect<void>
}

/** Only ephemeral hints are public; ownership, pause state, and shutdown stay in the scoped Layer. */
export interface RunReactivationOwnerService {
  readonly hint: (hint: RunReactivationHint) => Effect.Effect<void>
}

/** The application supplied a timer or cooldown that cannot drive a bounded local loop. */
export class RunReactivationIntervalInvalid extends Schema.TaggedError<RunReactivationIntervalInvalid>()(
  "RunReactivationIntervalInvalid",
  { detail: Schema.String }
) {}

/** Public application seam for one exact unterminated Run's process-local owner. */
export class RunReactivationOwner extends Context.Service<RunReactivationOwner, RunReactivationOwnerService>()(
  "@dalph/RunReactivationOwner"
) {}

type RunReactivationMessage =
  | { readonly _tag: "Hint"; readonly hint: RunReactivationHint }
  /** A hint that arrived while an activation was crossing its handoff boundary. */
  | { readonly _tag: "TrailingOrdinary"; readonly generation: number }

/**
 * One ordinary activation promised by a hint that crossed an activation
 * handoff. This obligation remains process-local until the worker admits it;
 * it is not represented only by the one-slot wake queue.
 */
type TrailingOrdinaryObligation = { readonly _tag: "PendingTrailingOrdinary"; readonly generation: number }

/**
 * The owner gate's activation phase. Finalizing remains visible until the
 * worker either admits the trailing ordinary activation or returns to its
 * idle wait. A generation changes at that handoff, so a producer that
 * observed the old phase cannot be mistaken for a producer arriving after it.
 */
type ActivationPhase =
  | { readonly _tag: "Idle"; readonly generation: number }
  | { readonly _tag: "Running"; readonly generation: number }
  | { readonly _tag: "Finalizing"; readonly generation: number }

const finitePositiveDuration = (input: Duration.Input, name: string) => {
  const duration = Duration.fromInput(input)
  if (Option.isNone(duration) || !Duration.isFinite(duration.value) || !Duration.isPositive(duration.value)) {
    return Effect.fail(new RunReactivationIntervalInvalid({ detail: `${name} must be finite and greater than zero` }))
  }
  return Effect.succeed(duration.value)
}

/**
 * Builds one scoped owner and starts its worker during Layer acquisition. A
 * caller composes this Layer once so every consumer shares the same owner;
 * there is no public `run`, `start`, `pause`, `unpause`, or `stop` method.
 */
export const runReactivationOwnerLayer = <E, R, EInstall>(options: RunReactivationOwnerOptions<E, R, EInstall>) =>
  Layer.effect(
    RunReactivationOwner,
    Effect.gen(function* () {
      const ownerScope = yield* Effect.scope
      const activationInterval = yield* finitePositiveDuration(options.activationInterval, "reactivation interval")
      const failureCooldown = yield* finitePositiveDuration(options.failureCooldown, "failure cooldown")
      const applicationExit = yield* ApplicationExitShell
      // A preparing owner closes the race between application Exit's cutoff
      // and this Layer's process-local drain registration. Exit waits for the
      // preparation to disappear before it snapshots and runs local drains.
      const startupPreparation = yield* applicationExit.admission.prepareForwardOwner("InterruptibleBoundary")
      yield* Effect.addFinalizer(() => startupPreparation.cancel)
      const messages = yield* Queue.sliding<RunReactivationMessage>(1)
      const commandGate = yield* Semaphore.make(1)
      const shutdown = yield* Deferred.make<void>()
      const stopped = yield* Ref.make(false)
      /** One tagged phase closes the producer/finalization handoff race. */
      const activationPhase = yield* Ref.make<ActivationPhase>({ _tag: "Idle", generation: 0 })
      /** A trailing activation cannot be displaced by later one-slot hints. */
      const trailingOrdinaryObligation = yield* Ref.make<Option.Option<TrailingOrdinaryObligation>>(Option.none())
      // Registration precedes the authoritative read below. The callback can
      // therefore capture a Pause accepted in the attach/read interval; the
      // mandatory reread then current-first replays the durable state.
      const controlState = yield* Ref.make<RunReactivationControlState>("RunUnpaused")
      const controlRevision = yield* Ref.make(0)
      const timerFiber = yield* Ref.make<Option.Option<Fiber.Fiber<void, never>>>(Option.none())
      const trackerNotificationFiber = yield* Ref.make<Option.Option<Fiber.Fiber<void, never>>>(Option.none())

      const observeTimerState = (state: "Started" | "Stopped") =>
        options.onTimerStateChange === undefined ? Effect.void : options.onTimerStateChange(state)

      const stopTimerFiber = Effect.fn("RunReactivationOwner.stopTimer")(() =>
        Ref.getAndSet(timerFiber, Option.none()).pipe(
          Effect.flatMap((current) =>
            Option.match(current, {
              onNone: () => Effect.void,
              onSome: (fiber) => Fiber.interrupt(fiber).pipe(Effect.andThen(observeTimerState("Stopped")))
            })
          )
        )
      )

      const stopTrackerNotificationFiber = Effect.fn("RunReactivationOwner.stopTrackerNotification")(() =>
        Ref.getAndSet(trackerNotificationFiber, Option.none()).pipe(
          Effect.flatMap((current) =>
            Option.match(current, { onNone: () => Effect.void, onSome: (fiber) => Fiber.interrupt(fiber) })
          )
        )
      )

      const startTimerFiber = Effect.fn("RunReactivationOwner.startTimer")(() =>
        Ref.get(stopped).pipe(
          Effect.flatMap((isStopped) =>
            /* v8 ignore next -- @preserve Every timer-start caller holds commandGate and has already rejected stopped; the guard remains fail-closed against future callers. */
            isStopped
              ? Effect.void
              : Ref.get(timerFiber).pipe(
                  Effect.flatMap((current) =>
                    Option.match(current, {
                      onSome: () => Effect.void,
                      onNone: () =>
                        Stream.fromSchedule(Schedule.spaced(activationInterval)).pipe(
                          Stream.runForEach(() => offerHint(RunReactivationHint.Timer())),
                          Effect.forkIn(ownerScope),
                          Effect.tap((fiber) => Ref.set(timerFiber, Option.some(fiber))),
                          Effect.andThen(observeTimerState("Started"))
                        )
                    })
                  )
                )
          )
        )
      )

      // Stop is a separate Deferred, not a sliding queue value. Thus a hint
      // offered concurrently with Exit cannot overwrite shutdown, while the
      // worker is allowed to finish an activation already admitted before the
      // Deferred was completed.
      const requestStop = Effect.fn("RunReactivationOwner.requestStop")(() =>
        commandGate.withPermit(
          Effect.gen(function* () {
            yield* Ref.set(stopped, true)
            yield* Deferred.succeed(shutdown, undefined)
            yield* stopTimerFiber()
            yield* stopTrackerNotificationFiber()
          })
        )
      )

      /**
       * Records one trailing ordinary activation and leaves its wake message
       * in the bounded queue. Later hints observe the obligation and coalesce
       * into it instead of sliding the wake message out of the queue.
       */
      const recordTrailingOrdinaryInsideGate = (generation: number) =>
        Effect.gen(function* () {
          if (Option.isSome(yield* Ref.get(trailingOrdinaryObligation))) return
          // A normal hint can have won the take/admission race just before
          // this obligation was recorded. It is covered by the ordinary
          // trailing activation, so remove any queued normal wake first.
          yield* Queue.clear(messages)
          const obligation: TrailingOrdinaryObligation = { _tag: "PendingTrailingOrdinary", generation }
          yield* Ref.set(trailingOrdinaryObligation, Option.some(obligation))
          yield* Queue.offer(messages, { _tag: "TrailingOrdinary", generation })
          if (options.onTrailingOrdinaryRecorded !== undefined) {
            yield* options.onTrailingOrdinaryRecorded(generation)
          }
        })

      /**
       * Offers one process-local hint while holding the owner gate. A hint
       * arriving during an activation is deliberately reduced to one
       * ordinary trailing marker: the active handoff has already crossed its
       * only active boundary, so a second active handoff would duplicate the
       * refresh rather than establish a fresh current view.
       */
      const offerHintInsideGate = (hint: RunReactivationHint, arrivalPhase?: ActivationPhase) =>
        Effect.gen(function* () {
          if (yield* Ref.get(stopped)) return
          const current = yield* Ref.get(controlState)
          if (current !== "RunUnpaused") return
          // Once the handoff has promised one ordinary activation, later
          // hints are already covered. In particular, they must not slide its
          // marker out of Queue.sliding(1) before the worker takes it.
          if (Option.isSome(yield* Ref.get(trailingOrdinaryObligation))) return
          const phase = yield* Ref.get(activationPhase)
          const arrivedBeforeActivationHandoff =
            arrivalPhase !== undefined &&
            (arrivalPhase._tag !== "Idle" || phase._tag !== "Idle" || arrivalPhase.generation !== phase.generation)
          if (phase._tag !== "Idle" || arrivedBeforeActivationHandoff) {
            yield* recordTrailingOrdinaryInsideGate(phase.generation)
            return
          }
          yield* Queue.offer(messages, { _tag: "Hint", hint })
        })

      const offerHint = Effect.fn("RunReactivationOwner.hint")(function* (hint: RunReactivationHint) {
        // Capture the phase before waiting for the gate. If finalization wins
        // the permit while this producer waits, the generation mismatch keeps
        // the hint in the one trailing ordinary activation.
        const arrivalPhase = yield* Ref.get(activationPhase)
        yield* commandGate.withPermit(offerHintInsideGate(hint, arrivalPhase))
      })

      const startTrackerNotificationSource = Effect.fn("RunReactivationOwner.startTrackerNotificationSource")(() =>
        options.trackerNotificationSource === undefined
          ? Effect.void
          : Effect.gen(function* () {
              const source = options.trackerNotificationSource
              /* v8 ignore next -- @preserve The exact optional property was narrowed by the immediately enclosing condition and cannot change during Layer acquisition. */
              if (source === undefined) return
              const attachment = yield* attachCurrentSignal(source)
              yield* commandGate.withPermit(
                Effect.gen(function* () {
                  if (yield* Ref.get(stopped)) return
                  yield* offerHintInsideGate(RunReactivationHint.TrackerNotification())
                  const fiber = yield* attachment.changes.pipe(
                    Stream.runForEach(() => offerHint(RunReactivationHint.TrackerNotification())),
                    Effect.forkIn(ownerScope)
                  )
                  yield* Ref.set(trackerNotificationFiber, Option.some(fiber))
                })
              )
            })
      )

      const acceptedControl = Effect.fn("RunReactivationOwner.acceptedControl")(function* (
        direction: AcceptedRunControlDirection
      ) {
        yield* commandGate.withPermit(
          Effect.gen(function* () {
            if (yield* Ref.get(stopped)) return
            const changed = yield* Ref.modify(controlState, (current) => {
              /* v8 ignore next -- @preserve Initial terminal history stops before callbacks can run, and accepted controls cannot create RunTerminated. */
              if (current === "RunTerminated") return [false, current] as const
              const next = direction === "Pause" ? ("RunPaused" as const) : ("RunUnpaused" as const)
              return [current !== next, next] as const
            })
            yield* Ref.update(controlRevision, (revision) => revision + 1)
            if (!changed) return
            if (direction === "Pause") {
              yield* stopTimerFiber()
            } else {
              yield* startTimerFiber()
              yield* offerHintInsideGate(RunReactivationHint.OperatorWake())
            }
          })
        )
      })

      const observeFailure = (failure: E) =>
        options
          .onFailure(failure)
          .pipe(
            Effect.andThen(
              Effect.raceFirst(Effect.sleep(failureCooldown), Deferred.await(shutdown).pipe(Effect.asVoid))
            )
          )

      const nextMessage = Effect.raceFirst(
        Queue.take(messages).pipe(Effect.map(Option.some)),
        Deferred.await(shutdown).pipe(Effect.as(Option.none()))
      )

      const processHintAttempt = Effect.fn("RunReactivationOwner.processHint")(function* (hint?: RunReactivationHint) {
        if (yield* Ref.get(stopped)) return
        if ((yield* Ref.get(controlState)) === "RunPaused") return
        /* v8 ignore next -- @preserve Initial terminal history stops before queue consumption, and no process-local command can create RunTerminated. */
        if ((yield* Ref.get(controlState)) === "RunTerminated") {
          yield* requestStop()
          return
        }

        const decision = yield* (
          hint !== undefined && (hint._tag === "TrackerNotification" || hint._tag === "Timer")
            ? options.activateActiveWorkAuthorityRefresh(hint._tag)
            : options.activate(RunActivationOpportunity.OrdinaryRunEntry())
        ).pipe(Effect.mapError((failure) => ({ _tag: "Activate" as const, failure })))
        if (decision._tag === "RunMayTerminate") yield* requestStop()
      })
      const processHint = (hint?: RunReactivationHint) =>
        processHintAttempt(hint).pipe(
          Effect.catchTag("Activate", ({ failure }) =>
            options.isTerminationFailure(failure)
              ? options.onFailure(failure).pipe(Effect.andThen(requestStop()))
              : observeFailure(failure)
          )
        )

      yield* applicationExit.registerProcessLocalDrain({ closeProcessLocalResources: requestStop() })
      yield* startupPreparation.cancel
      yield* options.installAcceptedRunReactivationObservers({
        control: acceptedControl,
        acceptedFactPublication: offerHint(RunReactivationHint.AcceptedFactPublication())
      })
      const control = yield* options.readControl.pipe(Effect.tapError(options.onFailure))
      // A callback may win while the Journal read is in flight. Do not let a
      // stale read overwrite that later accepted fact; otherwise the read is
      // the current-first replay for the observer just attached.
      yield* commandGate.withPermit(
        Ref.get(controlRevision).pipe(
          Effect.flatMap((revision) => (revision === 0 ? Ref.set(controlState, control) : Effect.void))
        )
      )
      yield* startTrackerNotificationSource()

      const worker = Effect.gen(function* () {
        if ((yield* Ref.get(controlState)) === "RunTerminated") {
          yield* requestStop()
          return
        }
        yield* commandGate.withPermit(
          Effect.gen(function* () {
            if (yield* Ref.get(stopped)) return
            if ((yield* Ref.get(controlState)) === "RunUnpaused") {
              // A current-first tracker notification is a stronger startup
              // ordering fact than the synthetic Startup hint. The check and
              // offer are serialized with the source attachment so Queue's
              // sliding capacity cannot replace that first active refresh.
              if ((yield* Queue.size(messages)) === 0) {
                yield* Queue.offer(messages, { _tag: "Hint", hint: RunReactivationHint.Startup() })
              }
              yield* startTimerFiber()
            }
          })
        )
        const loop = (): Effect.Effect<void, never, R> =>
          Effect.gen(function* () {
            // Keep Finalizing visible while the post-activation handoff is
            // still being admitted. A producer that began during that phase
            // enqueues a trailing message even if this worker wins the gate
            // first and returns to the idle wait.
            const enteredIdle = yield* commandGate.withPermit(
              Effect.gen(function* () {
                const phase = yield* Ref.get(activationPhase)
                const hasTrailingObligation = Option.isSome(yield* Ref.get(trailingOrdinaryObligation))
                if (phase._tag === "Finalizing" && ((yield* Queue.size(messages)) === 0 || hasTrailingObligation)) {
                  yield* Ref.set(activationPhase, { _tag: "Idle" as const, generation: phase.generation + 1 })
                  return true
                }
                return false
              })
            )
            if (enteredIdle && options.onActivationHandoffIdle !== undefined) {
              yield* options.onActivationHandoffIdle()
            }
            const message = yield* nextMessage
            if (Option.isNone(message)) return
            const next = message.value
            const activation = yield* commandGate.withPermit(
              Effect.gen(function* () {
                const phase = yield* Ref.get(activationPhase)
                if (phase._tag === "Running") {
                  return yield* Effect.die("Run reactivation entered Running before activation admission")
                }
                const pending = yield* Ref.get(trailingOrdinaryObligation)
                if (Option.isSome(pending)) {
                  if (next._tag === "TrailingOrdinary" && next.generation !== pending.value.generation) {
                    return yield* Effect.die("Run reactivation trailing obligation generation changed before admission")
                  }
                  // The pending obligation is now beginning. Clear it before
                  // releasing the gate so later hints follow the ordinary
                  // active-phase coalescing rules for this new activation.
                  yield* Ref.set(trailingOrdinaryObligation, Option.none())
                  yield* Ref.set(activationPhase, {
                    _tag: "Running" as const,
                    generation: phase._tag === "Finalizing" ? phase.generation + 1 : phase.generation
                  })
                  return { hint: undefined, activationKind: "Ordinary" as const }
                }
                if (next._tag === "TrailingOrdinary") {
                  return yield* Effect.die("Run reactivation consumed an unrecorded trailing obligation")
                }
                const hint = next.hint
                yield* Ref.set(activationPhase, {
                  _tag: "Running" as const,
                  generation: phase._tag === "Finalizing" ? phase.generation + 1 : phase.generation
                })
                return {
                  hint,
                  activationKind:
                    hint._tag === "TrackerNotification" || hint._tag === "Timer"
                      ? ("ActiveWorkAuthorityRefresh" as const)
                      : ("Ordinary" as const)
                }
              })
            )
            yield* processHint(activation.hint).pipe(
              Effect.ensuring(
                commandGate.withPermit(
                  Effect.gen(function* () {
                    const phase = yield* Ref.get(activationPhase)
                    if (phase._tag !== "Running") {
                      return yield* Effect.die(`Run reactivation finalized from ${phase._tag}`)
                    }
                    yield* Ref.set(activationPhase, { _tag: "Finalizing" as const, generation: phase.generation })
                    if (options.onActivationFinalizationStart !== undefined) {
                      yield* options.onActivationFinalizationStart(activation.activationKind)
                    }
                    // A producer can win the tiny take/admission interval
                    // before the Running phase is recorded. Normalize that
                    // one-slot queue to one durable trailing ordinary
                    // obligation so it cannot become a second active refresh.
                    if (
                      Option.isNone(yield* Ref.get(trailingOrdinaryObligation)) &&
                      (yield* Queue.size(messages)) > 0
                    ) {
                      yield* recordTrailingOrdinaryInsideGate(phase.generation)
                    }
                  })
                )
              )
            )
            yield* loop()
          })
        yield* loop()
      })

      // Application Exit invokes this registered drain after forward owners
      // (including an active Run activation) have reached their boundaries.
      yield* Effect.forkScoped(worker)

      return RunReactivationOwner.of({ hint: offerHint })
    })
  )
