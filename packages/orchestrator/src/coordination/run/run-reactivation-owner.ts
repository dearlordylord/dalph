import { Context, Data, Duration, Effect, Layer, Option, Queue, Ref, Schedule, Schema, Stream } from "effect"
import type { RunFinalityDecision as RunFinalityDecisionValue } from "../frontier/frontier.js"
import { attachCurrentSignal, type CurrentSignal } from "../delivery/relations.js"

/** A non-authoritative request to ask the ordinary Run entry for current facts. */
export type RunReactivationHint = Data.TaggedEnum<{
  TrackerNotification: Record<never, never>
  AcceptedFactPublication: Record<never, never>
  OperatorWake: Record<never, never>
  Timer: Record<never, never>
}>

export const RunReactivationHint = Data.taggedEnum<RunReactivationHint>()

/** A descriptive current-first source that can request a fresh check. */
export interface RunReactivationHintSource<E = never> {
  readonly signal: CurrentSignal<unknown, E>
  readonly hint: RunReactivationHint
}

/** The process-local owner state; it is never written to the workflow Journal. */
type RunReactivationOwnerState = "Running" | "Paused" | "Terminated" | "Stopped"

type RunReactivationMessage = { readonly _tag: "Hint"; readonly hint: RunReactivationHint } | { readonly _tag: "Stop" }

/**
 * A fresh establishment/activation effect is rerunnable: each execution must
 * read the accepted Journal and outside authority through its ordinary public
 * boundaries instead of retaining a prior observation.
 */
// eslint-disable-next-line functional/no-mixed-types -- The application seam intentionally groups the activation effect, timer, retry policy, and failure observer.
export interface RunReactivationOwnerOptions<E, R = never> {
  readonly activate: Effect.Effect<RunFinalityDecisionValue, E, R>
  readonly activationInterval: Duration.Input
  readonly retrySchedule?: Schedule.Schedule<unknown, E>
  readonly onFailure?: (failure: E) => Effect.Effect<void>
}

// eslint-disable-next-line functional/no-mixed-types -- The owner boundary intentionally exposes coordinated commands together with its scoped run effect.
export interface RunReactivationOwnerService<R = never> {
  /** Queues one non-authoritative request; duplicate requests are coalesced before activation. */
  readonly hint: (hint: RunReactivationHint) => Effect.Effect<void>
  /** Suppresses timer and hint-driven activation until `unpause` is called. */
  readonly pause: () => Effect.Effect<void>
  /** Performs one fresh current check after resuming a paused Run. */
  readonly unpause: () => Effect.Effect<void>
  /** Stops later reactivation; this is idempotent. */
  readonly stop: () => Effect.Effect<void>
  /** Runs the one process-local owner until it is stopped or the Run terminates. */
  readonly run: Effect.Effect<void, never, R>
}

/** The application supplied a timer interval that cannot drive a bounded local loop. */
export class RunReactivationIntervalInvalid extends Schema.TaggedError<RunReactivationIntervalInvalid>()(
  "RunReactivationIntervalInvalid",
  { detail: Schema.String }
) {}

/** Public application seam for one exact unterminated Run's process-local owner. */
export class RunReactivationOwner extends Context.Service<RunReactivationOwner, RunReactivationOwnerService>()(
  "@dalph/RunReactivationOwner"
) {}

const defaultRetrySchedule = Schedule.exponential("100 millis").pipe(Schedule.upTo({ times: 3 }))

/** Creates one owner around an ordinary, repeatable Run establishment/activation effect. */
export const makeRunReactivationOwner = Effect.fn("RunReactivationOwner.make")(function* <E, R>(
  options: RunReactivationOwnerOptions<E, R>
) {
  const intervalOption = Duration.fromInput(options.activationInterval)
  if (Option.isNone(intervalOption)) {
    return yield* new RunReactivationIntervalInvalid({ detail: "reactivation interval must be a valid duration" })
  }
  if (!Duration.isFinite(intervalOption.value) || !Duration.isPositive(intervalOption.value)) {
    return yield* new RunReactivationIntervalInvalid({
      detail: "reactivation interval must be finite and greater than zero"
    })
  }
  const activationInterval = intervalOption.value
  // A sliding one-slot trigger preserves only the fact that some current
  // check is wanted. It cannot accumulate notification storms or lose a Stop
  // request behind stale hints.
  const messages = yield* Queue.sliding<RunReactivationMessage>(1)
  const state = yield* Ref.make<RunReactivationOwnerState>("Running")
  const started = yield* Ref.make(false)
  const retrySchedule = options.retrySchedule ?? defaultRetrySchedule

  const offerHint = (hint: RunReactivationHint) =>
    Effect.gen(function* () {
      const accepted = yield* Ref.get(state).pipe(Effect.map((current) => current === "Running"))
      if (accepted) yield* Queue.offer(messages, { _tag: "Hint", hint })
    })

  const hint = Effect.fn("RunReactivationOwner.hint")(offerHint)

  const pause = Effect.fn("RunReactivationOwner.pause")(() =>
    Ref.update(state, (current) => (current === "Running" ? "Paused" : current))
  )

  const unpause = Effect.fn("RunReactivationOwner.unpause")(() =>
    Effect.gen(function* () {
      const resumed = yield* Ref.modify(state, (current) =>
        current === "Paused" ? [true, "Running" as const] : [false, current]
      )
      if (resumed) yield* offerHint(RunReactivationHint.OperatorWake())
    })
  )

  const stop = Effect.fn("RunReactivationOwner.stop")(() =>
    Effect.gen(function* () {
      const stopRequested = yield* Ref.modify(state, (current) =>
        current === "Stopped" || current === "Terminated" ? [false, current] : [true, "Stopped" as const]
      )
      if (stopRequested) {
        yield* Queue.offer(messages, { _tag: "Stop" })
      }
    })
  )

  const runActivation = Effect.gen(function* () {
    const result = yield* options.activate.pipe(
      Effect.retry(retrySchedule),
      Effect.map(Option.some),
      Effect.catch((failure) =>
        (options.onFailure === undefined ? Effect.void : options.onFailure(failure)).pipe(Effect.as(Option.none()))
      )
    )
    if (Option.isNone(result)) return
    if (result.value._tag === "RunMayTerminate") {
      yield* Ref.set(state, "Terminated")
      yield* Queue.offer(messages, { _tag: "Stop" })
    }
  })

  const processHint = Effect.fn("RunReactivationOwner.processHint")(() =>
    Effect.gen(function* () {
      if ((yield* Ref.get(state)) !== "Running") return
      yield* runActivation
      if ((yield* Ref.get(state)) !== "Running") return

      // Hints received while activation was crossing a boundary become one
      // trailing check. The hint value itself is deliberately discarded.
      const pending = yield* Queue.takeAll(messages)
      if (pending.some((message) => message._tag === "Stop")) {
        yield* Queue.offer(messages, { _tag: "Stop" })
      } else if (pending.some((message) => message._tag === "Hint")) {
        yield* Queue.offer(messages, { _tag: "Hint", hint: RunReactivationHint.Timer() })
      }
    })
  )

  const run = Effect.scoped(
    Effect.gen(function* () {
      const claimed = yield* Ref.modify(started, (current) => [!current, true] as const)
      if (!claimed || (yield* Ref.get(state)) !== "Running") return

      yield* offerHint(RunReactivationHint.Timer())
      yield* Stream.fromSchedule(Schedule.spaced(activationInterval)).pipe(
        Stream.runForEach(() => offerHint(RunReactivationHint.Timer())),
        Effect.forkScoped
      )

      yield* Stream.fromQueue(messages).pipe(
        Stream.takeWhile((message) => message._tag !== "Stop"),
        Stream.runForEach(() => processHint())
      )
    })
  )

  return { hint, pause, run, stop, unpause } satisfies RunReactivationOwnerService<R>
})

/**
 * Attaches one current-first source in the caller's scope. The initial value
 * and every later publication are only hints; source failure ends this
 * subscription while the owner's timer remains responsible for recovery.
 */
export const attachRunReactivationHintSource = Effect.fn("RunReactivationOwner.attachHintSource")(function* <E, R>(
  owner: RunReactivationOwnerService<R>,
  source: RunReactivationHintSource<E>
) {
  const attachment = yield* attachCurrentSignal(source.signal).pipe(Effect.option)
  if (Option.isNone(attachment)) return
  yield* owner.hint(source.hint)
  yield* attachment.value.changes.pipe(
    Stream.runForEach(() => owner.hint(source.hint)),
    Effect.ignore,
    Effect.forkScoped
  )
})

/** Installs a caller-provided owner as an ordinary Effect service. */
export const runReactivationOwnerLayer = (owner: RunReactivationOwnerService) =>
  Layer.succeed(RunReactivationOwner, RunReactivationOwner.of(owner))
