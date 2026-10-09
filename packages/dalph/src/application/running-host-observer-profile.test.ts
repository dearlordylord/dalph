/* eslint-disable import/no-nodejs-modules -- Native paused-reader resource profile. */
import * as profileProcess from "node:process"
import { createServer, type ServerResponse } from "node:http"
import { connect } from "node:net"
import { mkdirSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { RunId } from "@dalph/contracts"
import { it } from "@effect/vitest"
import { Deferred, Effect, Fiber, Queue, Ref, Stream } from "effect"
import { expect } from "vitest"
import { makeRunningHostWatchStage } from "./running-host-watch-stage.js"
import { writeRunningHostWatchFrame } from "./running-host-http-watch.js"
import { observerRetentionLimits, observerStructuralBytes } from "./running-host-observer-budget.js"
import {
  encodeRunningHostWatchFrame,
  RequestId,
  SubscriptionId,
  WatchSequence,
  runningHostLimits,
  type RunningHostWatchFrame
} from "./running-host-contract.js"

for (const payloadBytes of [256 * 1024, 1792 * 1024]) {
  it.live(
    `Native paused TCP reader times out an admitted write, retains charged latest and releases exactly (${payloadBytes} bytes)`,
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const responseReady = yield* Deferred.make<ServerResponse>()
          const server = createServer((_request, response) => {
            response.writeHead(200, { "content-type": "application/x-ndjson" })
            Effect.runSync(Deferred.succeed(responseReady, response))
          })
          yield* Effect.acquireRelease(
            Effect.promise(() => new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))),
            () =>
              Effect.sync(() => {
                server.closeAllConnections()
                server.close()
              })
          )
          const address = server.address()
          if (address === null || typeof address === "string") return yield* Effect.die("missing native address")
          const peer = yield* Effect.acquireRelease(
            Effect.sync(() => connect(address.port, "127.0.0.1")),
            (socket) => Effect.sync(() => socket.destroy())
          )
          peer.on("error", () => {})
          peer.pause()
          peer.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n")
          const response = yield* Deferred.await(responseReady)
          const runId = RunId.make("native-profile")
          const value = (ordinal: number): RunningHostWatchFrame => ({
            protocolVersion: 1,
            requestId: RequestId.make(`${ordinal}:${"x".repeat(payloadBytes)}`),
            subscriptionId: SubscriptionId.make("native-observer"),
            runId,
            sequence: WatchSequence.make(0),
            frame: { _tag: "Snapshot", value: { _tag: "NotReady", runId } }
          })
          const changes = yield* Queue.bounded<RunningHostWatchFrame>(1)
          const consumed = yield* Queue.bounded<void>(1)
          const releases = yield* Ref.make(0)
          const stage = yield* makeRunningHostWatchStage(
            Stream.concat(Stream.make(value(0)), Stream.fromQueue(changes)).pipe(
              Stream.ensuring(Ref.update(releases, (count) => count + 1))
            ),
            () => false,
            (error) => ({
              ...value(0),
              requestId: RequestId.make("refusal"),
              frame: { _tag: "Failure" as const, error }
            }),
            (frame) => encodeRunningHostWatchFrame(frame).pipe(Effect.andThen(Queue.offer(consumed, undefined)))
          )
          yield* Queue.take(consumed)
          const started = yield* Queue.bounded<void>(1)
          const admitted = yield* Ref.make<RunningHostWatchFrame | null>(null)
          const published = yield* Ref.make(0)
          const writer = yield* Effect.gen(function* () {
            let current = yield* stage.takeInitial
            let sequence = 0
            for (;;) {
              yield* Ref.set(admitted, current)
              yield* Queue.offer(started, undefined)
              yield* writeRunningHostWatchFrame(response, { ...current, sequence: WatchSequence.make(sequence) })
              sequence += 1
              current = yield* stage.take
            }
          }).pipe(Effect.result, Effect.forkChild)
          const publisher = yield* Effect.gen(function* () {
            let ordinal = 0
            while (ordinal < 4096) {
              yield* Queue.take(started)
              for (let replacement = 0; replacement < 64; replacement += 1) {
                ordinal += 1
                yield* Queue.offer(changes, value(ordinal))
                yield* Queue.take(consumed)
                yield* Ref.set(published, ordinal)
              }
            }
          }).pipe(Effect.forkChild)
          const result = yield* Fiber.join(writer)
          expect(result).toMatchObject({ _tag: "Failure", failure: { _tag: "WriteTimedOut" } })
          yield* Fiber.interrupt(publisher)
          const inFlight = yield* Ref.get(admitted)
          if (inFlight === null) return yield* Effect.die("requires an admitted native write")
          const retained = yield* stage.retained
          expect(retained.initial).toBeNull()
          expect(retained.pending).not.toBeNull()
          expect(response.writableLength).toBeGreaterThan(0)
          const inFlightCharge = yield* observerStructuralBytes(
            inFlight,
            observerRetentionLimits.presentationBytes,
            "Presentation"
          )
          const pendingCharge = yield* observerStructuralBytes(
            retained.pending,
            observerRetentionLimits.presentationBytes,
            "Presentation"
          )
          const encodedBytes = new TextEncoder().encode(yield* encodeRunningHostWatchFrame(inFlight)).byteLength + 1
          expect(encodedBytes).toBeLessThanOrEqual(runningHostLimits.resultBytes + 1)
          expect(response.writableLength).toBeLessThanOrEqual(encodedBytes + 512)
          mkdirSync(".scratch", { recursive: true })
          writeFileSync(
            `.scratch/observer-profile-${payloadBytes}.json`,
            JSON.stringify(
              {
                profile:
                  "paused-loopback-tcp/64-replacements-per-write/max4096-updates/one-observer/zero-workflow-records",
                candidate: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
                candidateDiff: execFileSync("git", ["diff", "--no-ext-diff", "--", "packages/dalph/src/application"], {
                  encoding: "utf8"
                }).length,
                node: profileProcess.version,
                platform: profileProcess.platform,
                arch: profileProcess.arch,
                payloadBytes,
                observerCount: 1,
                publishedValues: (yield* Ref.get(published)) + 1,
                optional: {
                  inFlightCharge,
                  pendingCharge,
                  admittedWriteBytes: encodedBytes,
                  nativeWritableBytes: response.writableLength
                },
                sharedCanonicalBytes: 0,
                rssBytes: profileProcess.memoryUsage().rss,
                heapUsedBytes: profileProcess.memoryUsage().heapUsed,
                peakRssBytes: profileProcess.resourceUsage().maxRSS * 1024,
                safetyCeilingIsHeapCap: false
              },
              null,
              2
            )
          )
          const closed = yield* Deferred.make<void>()
          response.once("close", () => Effect.runSync(Deferred.succeed(closed, undefined)))
          peer.destroy()
          response.destroy()
          yield* Deferred.await(closed)
          expect(response.writableLength).toBe(0)
          yield* Ref.set(admitted, null)
          yield* stage.stop
          expect(yield* stage.retained).toEqual({ initial: null, pending: null })
          expect(yield* Ref.get(releases)).toBe(1)
          yield* stage.stop
          expect(yield* Ref.get(releases)).toBe(1)
        })
      ),
    20000
  )
}
