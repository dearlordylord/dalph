import { RunId } from "@dalph/contracts"
import { Clock, Deferred, Effect, Exit, Queue, Ref, Scope, Semaphore, Stream } from "effect"
import { makeRunningHostWatchStage } from "./running-host-watch-stage.js"
import { watchRunningHost } from "./running-host-watch-client.js"
import {
  type LocalHostAddress,
  RequestId,
  SubscriptionId,
  WatchSequence,
  type RunningHostWatchFrame,
  type RunningHostError,
  runningHostLimits,
  watchFrameEnds
} from "./running-host-contract.js"

type Stage = Effect.Success<ReturnType<typeof makeRunningHostWatchStage<RunningHostWatchFrame>>>
interface WatchResource {
  readonly id: SubscriptionId
  readonly uri: string
  readonly scope: Scope.Closeable
  readonly stage: Stage
  readonly timerWake: Queue.Queue<void>
  readonly hint: Queue.Queue<void>
  readonly lock: Semaphore.Semaphore
  readonly disposed: Deferred.Deferred<void>
  readonly correlation: Pick<RunningHostWatchFrame, "protocolVersion" | "requestId" | "runId" | "subscriptionId">
  initial: RunningHostWatchFrame | null
  last: RunningHostWatchFrame | null
  failure: RunningHostWatchFrame | null
  subscribed: boolean
  closed: boolean
  pendingSince: number | null
  finalSince: number | null
  sequence: number
}

/** Resources retain bounded presentation bytes, not authority or replay state.
 * Their source scopes and session reservations have separate release points. */
export const makeRunningHostMcpWatches = Effect.fn("RunningHostMcp.makeWatches")(function* (
  address: LocalHostAddress,
  runId: RunId,
  notify: (uri: string) => Effect.Effect<void, RunningHostError>,
  source: (
    address: LocalHostAddress,
    runId: RunId
  ) => Stream.Stream<RunningHostWatchFrame, RunningHostError> = watchRunningHost
) {
  const session = yield* Effect.scope
  const transportFailed = yield* Deferred.make<never, RunningHostError>()
  const resources = new Map<string, WatchResource>()
  const closedIds = new Set<SubscriptionId>()
  const reservations = yield* Ref.make(0)
  let ordinal = 0
  const missing = (): RunningHostError => ({
    _tag: "InvalidRequest",
    fieldPath: "/subscriptionId",
    code: "WatchResourceNotFound"
  })
  const uriFailure = (uri: string) =>
    Effect.try({
      try: () => decodeURIComponent(/^dalph:\/\/runs\/([^/]+)\/watches\//.exec(uri)?.[1] ?? ""),
      catch: missing
    }).pipe(
      Effect.map(
        (requested): RunningHostError =>
          requested.length > 0 && requested !== runId
            ? { _tag: "RunMismatch", requestedRunId: RunId.make(requested), selectedRunId: runId }
            : missing()
      ),
      Effect.flatMap(Effect.fail)
    )
  const drop = (watch: WatchResource) =>
    Effect.gen(function* () {
      resources.delete(watch.id)
      yield* Deferred.succeed(watch.disposed, undefined)
      yield* Scope.close(watch.scope, Exit.void)
    }).pipe(Effect.uninterruptible)
  yield* Effect.addFinalizer(() => Effect.forEach([...resources.values()], drop, { discard: true }))
  const poke = (watch: WatchResource) =>
    Effect.all([Queue.offer(watch.hint, undefined), Queue.offer(watch.timerWake, undefined)], { discard: true })
  const pending = (watch: WatchResource) =>
    watch.initial !== null || watch.failure !== null ? Effect.succeed(true) : watch.stage.hasPending
  const end = (resource: WatchResource, error?: RunningHostError) =>
    Effect.gen(function* () {
      const watch = resource
      yield* watch.stage.stop
      watch.closed = true
      watch.finalSince ??= yield* Clock.currentTimeMillis
      if (error !== undefined) {
        yield* watch.stage.poll
        watch.initial = null
        watch.failure = { ...watch.correlation, sequence: WatchSequence.make(0), frame: { _tag: "Failure", error } }
        watch.pendingSince = null
        yield* poke(watch)
      }
    })
  const open = Effect.fn("RunningHostMcp.openWatch")(function* () {
    // Reserve before starting a host connection, including creation cancellation.
    ordinal += 1
    const id = SubscriptionId.make(`mcp-watch-${ordinal}`)
    const uri = `dalph://runs/${encodeURIComponent(runId)}/watches/${id}`
    const scope = yield* Effect.acquireRelease(Scope.make(), (scope) => Scope.close(scope, Exit.void))
    yield* Effect.acquireRelease(
      Ref.modify(
        reservations,
        (count) => [count, count < runningHostLimits.mcpSessionWatches ? count + 1 : count] as const
      ).pipe(
        Effect.flatMap((count) =>
          count < runningHostLimits.mcpSessionWatches
            ? Effect.void
            : Effect.fail<RunningHostError>({
                _tag: "SubscriptionLimitExceeded",
                scope: "McpSession",
                limit: runningHostLimits.mcpSessionWatches,
                current: count
              })
        )
      ),
      () => Ref.update(reservations, (count) => count - 1)
    ).pipe(
      Scope.provide(scope),
      Effect.onError(() => Scope.close(scope, Exit.void))
    )
    const timerWake = yield* Queue.sliding<void>(1)
    const hint = yield* Queue.sliding<void>(1)
    const lock = yield* Semaphore.make(1)
    const disposed = yield* Deferred.make<void>()
    let requestId = RequestId.make(id)
    const failure = (error: RunningHostError): RunningHostWatchFrame => ({
      protocolVersion: 1,
      requestId,
      runId,
      subscriptionId: id,
      sequence: WatchSequence.make(0),
      frame: { _tag: "Failure", error }
    })
    // MCP dispatch serializes opens, so acquisition cannot overbook the reservation.
    const stage = yield* makeRunningHostWatchStage(
      source(address, runId).pipe(
        Stream.tap((frame) =>
          Effect.sync(() => {
            requestId = frame.requestId
          })
        )
      ),
      watchFrameEnds,
      failure
    ).pipe(
      Scope.provide(scope),
      Effect.onExit((exit) => (exit._tag === "Failure" ? Scope.close(scope, exit) : Effect.void))
    )
    const current = yield* stage.takeInitial
    if (current.frame._tag === "Failure") {
      yield* Scope.close(scope, Exit.void)
      return yield* Effect.fail(current.frame.error)
    }
    const now = yield* Clock.currentTimeMillis
    const watch: WatchResource = {
      id,
      uri,
      scope,
      stage,
      timerWake,
      hint,
      lock,
      disposed,
      correlation: { protocolVersion: 1, requestId: current.requestId, runId, subscriptionId: id },
      initial: current,
      last: null,
      failure: null,
      subscribed: false,
      closed: false,
      pendingSince: now,
      finalSince: watchFrameEnds(current) ? now : null,
      sequence: 0
    }
    resources.set(id, watch)
    yield* Effect.gen(function* () {
      while (resources.has(id)) {
        yield* stage.changed
        if (resources.get(id) !== watch || watch.closed) return
        if (watch.pendingSince === null) watch.pendingSince = yield* Clock.currentTimeMillis
        yield* poke(watch)
      }
    }).pipe(Effect.raceFirst(Deferred.await(disposed)), Effect.forkIn(session))
    yield* stage.awaitReleased.pipe(
      Effect.andThen(
        Effect.gen(function* () {
          if (!watch.closed) {
            watch.finalSince ??= yield* Clock.currentTimeMillis
            yield* poke(watch)
          }
        })
      ),
      Effect.raceFirst(Deferred.await(disposed)),
      Effect.forkIn(session)
    )
    yield* Effect.gen(function* () {
      while (resources.has(id)) {
        yield* Queue.take(hint)
        if (watch.subscribed && (yield* pending(watch))) yield* notify(uri)
      }
    }).pipe(
      Effect.catch((error) => end(watch, error).pipe(Effect.andThen(Deferred.fail(transportFailed, error)))),
      Effect.raceFirst(Deferred.await(disposed)),
      Effect.forkIn(session)
    )
    yield* Effect.gen(function* () {
      while (resources.has(id)) {
        const now = yield* Clock.currentTimeMillis
        if (watch.finalSince === null) {
          if (!(yield* pending(watch))) watch.pendingSince = null
          else watch.pendingSince ??= now
        }
        if (watch.finalSince !== null && now >= watch.finalSince + runningHostLimits.closedResourceMillis) {
          yield* drop(watch)
          return
        }
        if (
          watch.finalSince === null &&
          watch.pendingSince !== null &&
          now >= watch.pendingSince + runningHostLimits.unreadWatchMillis &&
          (yield* pending(watch))
        )
          yield* end(watch, { _tag: "TransportFailed", phase: "Watch", reason: "WatchExpired" })
        const deadline =
          watch.finalSince !== null
            ? watch.finalSince + runningHostLimits.closedResourceMillis
            : watch.pendingSince !== null
              ? watch.pendingSince + runningHostLimits.unreadWatchMillis
              : null
        yield* deadline === null
          ? Queue.take(timerWake)
          : Effect.raceFirst(
              Queue.take(timerWake),
              Effect.sleep(Math.max(0, deadline - (yield* Clock.currentTimeMillis)))
            )
      }
    }).pipe(Effect.raceFirst(Deferred.await(disposed)), Effect.forkIn(session))
    return { _tag: "WatchOpened" as const, subscriptionId: id, uri }
  }, Scope.provide(session))
  const find = (uri: string) => [...resources.values()].find((watch) => watch.uri === uri)
  const read = Effect.fn("RunningHostMcp.readWatch")(function* (uri: string) {
    const watch = find(uri)
    if (watch === undefined) return yield* uriFailure(uri)
    return yield* watch.lock.withPermit(
      Effect.gen(function* () {
        const value = watch.initial ?? watch.failure ?? (yield* watch.stage.poll)
        watch.initial = null
        watch.failure = null
        if (value !== null) {
          watch.last = { ...value, subscriptionId: watch.id, sequence: WatchSequence.make(watch.sequence) }
          watch.sequence += 1
          if (watchFrameEnds(value)) yield* end(watch)
          watch.pendingSince = (yield* pending(watch)) ? yield* Clock.currentTimeMillis : null
          yield* poke(watch)
        }
        if (watch.last === null) return yield* Effect.fail(missing())
        return watch.last
      })
    )
  })
  const close = Effect.fn("RunningHostMcp.closeWatch")(function* (id: SubscriptionId) {
    if (closedIds.has(id)) return { _tag: "WatchClosed" as const, subscriptionId: id }
    const watch = resources.get(id)
    if (watch === undefined) return yield* Effect.fail(missing())
    yield* drop(watch)
    closedIds.add(id)
    yield* Effect.sleep(runningHostLimits.closedResourceMillis).pipe(
      Effect.andThen(Effect.sync(() => closedIds.delete(id))),
      Effect.forkIn(session)
    )
    return { _tag: "WatchClosed" as const, subscriptionId: id }
  })
  const subscribe = Effect.fn("RunningHostMcp.subscribeWatch")(function* (uri: string) {
    const watch = find(uri)
    if (watch === undefined) return yield* uriFailure(uri)
    watch.subscribed = true
    yield* poke(watch)
  })
  return {
    failure: Deferred.await(transportFailed),
    open,
    read,
    close,
    subscribe,
    unsubscribe: (uri: string) => {
      const watch = find(uri)
      return watch === undefined ? uriFailure(uri) : close(watch.id).pipe(Effect.asVoid)
    }
  }
})
