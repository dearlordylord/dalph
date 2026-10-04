/* eslint-disable import/no-nodejs-modules -- This adapter owns one exact observation response. */
import type { ServerResponse } from "node:http"
import { NodeCrypto } from "@effect/platform-node"
import { Crypto, Deferred, Effect, Ref, Stream } from "effect"
import type { ProductionRunningHostObservation } from "./production-host.js"
import {
  encodeRunningHostWatchFrame,
  type RunningHostError,
  type RunningHostRequest,
  type RunningHostWatchFrame,
  SubscriptionId,
  WatchSequence,
  runningHostLimits,
  watchFrameEnds
} from "./running-host-contract.js"
import { projectRunningHostSnapshot } from "./running-host-projection.js"
import { makeRunningHostWatchStage } from "./running-host-watch-stage.js"

const httpOk = 200

export const writeRunningHostWatchFrame = Effect.fn("RunningHostWatch.write")(function* (
  response: ServerResponse,
  value: RunningHostWatchFrame
) {
  const text = `${yield* encodeRunningHostWatchFrame(value)}\n`
  yield* Effect.callback<void, RunningHostError>((resume) => {
    const cleanup = () => {
      response.removeListener("error", fail)
      response.removeListener("close", fail)
    }
    const fail = () => {
      cleanup()
      resume(Effect.fail({ _tag: "TransportFailed", phase: "Write", reason: "WatchConnectionClosed" }))
    }
    response.once("error", fail)
    response.once("close", fail)
    response.write(text, (error) => {
      cleanup()
      resume(
        error
          ? Effect.fail<RunningHostError>({ _tag: "TransportFailed", phase: "Write", reason: "WatchWriteFailed" })
          : Effect.void
      )
    })
    return Effect.sync(cleanup)
  }).pipe(
    Effect.timeoutOrElse({
      duration: runningHostLimits.writeDeadlineMillis,
      orElse: () =>
        Effect.fail<RunningHostError>({
          _tag: "WriteTimedOut",
          subject: { _tag: "Subscription", subscriptionId: value.subscriptionId },
          deadlineMillis: runningHostLimits.writeDeadlineMillis
        })
    })
  )
})

/** Source leases end independently of response flush. The lifecycle drain waits
 * for admitted response fibers; its existing absolute budget interrupts them. */
export const makeRunningHostHttpWatch = Effect.fn("RunningHostWatch.makeHttp")(function* <E>(
  observation: ProductionRunningHostObservation<E>,
  write: typeof writeRunningHostWatchFrame = writeRunningHostWatchFrame
) {
  const count = yield* Ref.make(0)
  const writers = yield* Ref.make<ReadonlyMap<SubscriptionId, Deferred.Deferred<void>>>(new Map())
  yield* observation.registerObservationDrain({
    closeProcessLocalResources: Effect.gen(function* () {
      yield* Effect.forEach([...(yield* Ref.get(writers)).values()], Deferred.await, {
        concurrency: "unbounded",
        discard: true
      })
    })
  })
  return Effect.fn("RunningHostWatch.http")(function* (request: RunningHostRequest, response: ServerResponse) {
    const subscriptionId = SubscriptionId.make(yield* (yield* Crypto.Crypto).randomUUIDv4.pipe(Effect.orDie))
    const done = yield* Deferred.make<void>()
    yield* Effect.acquireRelease(
      Effect.uninterruptible(
        Effect.gen(function* () {
          const admission = yield* observation.commandAdmission
            .acquireForwardOwner("InterruptibleBoundary")
            .pipe(
              Effect.mapError(
                (): RunningHostError => ({
                  _tag: "HostClosing",
                  hostInstanceId: request.hostInstanceId,
                  cutoff: "AdmissionClosed"
                })
              )
            )
          yield* Ref.update(writers, (current) => new Map(current).set(subscriptionId, done)).pipe(
            Effect.ensuring(admission.release)
          )
        })
      ),
      () =>
        Ref.update(writers, (current) => new Map([...current].filter(([id]) => id !== subscriptionId))).pipe(
          Effect.andThen(Deferred.succeed(done, undefined))
        )
    )
    const frame = (payload: RunningHostWatchFrame["frame"], sequence = 0): RunningHostWatchFrame => ({
      protocolVersion: 1,
      requestId: request.requestId,
      runId: request.runId,
      subscriptionId,
      sequence: WatchSequence.make(sequence),
      frame: payload
    })
    const source = Stream.unwrap(
      Effect.gen(function* () {
        yield* Effect.acquireRelease(
          Ref.modify(
            count,
            (current) => [current, current < runningHostLimits.hostSubscriptions ? current + 1 : current] as const
          ).pipe(
            Effect.flatMap((current) =>
              current < runningHostLimits.hostSubscriptions
                ? Effect.void
                : Effect.fail<RunningHostError>({
                    _tag: "SubscriptionLimitExceeded",
                    scope: "Host",
                    limit: runningHostLimits.hostSubscriptions,
                    current
                  })
            )
          ),
          () => Ref.update(count, (current) => current - 1)
        )
        const attachment = yield* observation.current.attach.pipe(
          Effect.mapError(
            (): RunningHostError => ({
              _tag: "ReadFailed",
              causeTag: "ObservationUnavailable",
              detail: "The current source is unavailable."
            })
          )
        )
        return Stream.concat(Stream.make(attachment.current), attachment.changes).pipe(
          Stream.mapEffect((state) =>
            projectRunningHostSnapshot(request.runId, state).pipe(
              Effect.map((value) => frame({ _tag: "Snapshot", value })),
              Effect.tap(encodeRunningHostWatchFrame)
            )
          )
        )
      })
    )
    const stage = yield* makeRunningHostWatchStage(source, watchFrameEnds, (error) => frame({ _tag: "Failure", error }))
    response.writeHead(httpOk, { "content-type": "application/x-ndjson", connection: "close" })
    const disconnected = Effect.callback<never, RunningHostError>((resume) => {
      const closed = () => resume(Effect.fail({ _tag: "TransportFailed", phase: "Watch", reason: "WatchDisconnected" }))
      response.once("close", closed)
      return Effect.sync(() => response.removeListener("close", closed))
    })
    yield* Effect.gen(function* () {
      let value = yield* stage.takeInitial
      let sequence = 0
      for (;;) {
        yield* write(response, { ...value, sequence: WatchSequence.make(sequence) }).pipe(
          Effect.timeoutOrElse({
            duration: runningHostLimits.writeDeadlineMillis,
            orElse: () =>
              Effect.fail<RunningHostError>({
                _tag: "WriteTimedOut",
                subject: { _tag: "Subscription", subscriptionId },
                deadlineMillis: runningHostLimits.writeDeadlineMillis
              })
          })
        )
        if (watchFrameEnds(value)) break
        sequence += 1
        value = yield* stage.take
      }
      response.end()
    }).pipe(
      Effect.raceFirst(disconnected),
      Effect.raceFirst(
        observation.awaitExitResult.pipe(
          Effect.andThen(
            Effect.fail<RunningHostError>({ _tag: "TransportFailed", phase: "Watch", reason: "HostExitBudgetEnded" })
          )
        )
      ),
      Effect.ensuring(stage.stop),
      Effect.onExit((exit) =>
        Effect.sync(() => {
          if (exit._tag === "Failure") response.destroy()
        })
      )
    )
  }, Effect.provide(NodeCrypto.layer))
})
