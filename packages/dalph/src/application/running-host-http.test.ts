/* eslint-disable import/no-nodejs-modules -- Tests exercise the exact local network boundary. */
import { RunId } from "@dalph/contracts"
import { ControlDirectionApplicationOrdinal, JournalPosition, TraceCursor } from "@dalph/orchestrator"
import { request as httpRequest } from "node:http"
import { networkInterfaces } from "node:os"
import { it } from "@effect/vitest"
import { Deferred, Effect, Fiber, Option, Ref } from "effect"
import { TestClock } from "effect/testing"
import { expect } from "vitest"
import { callRunningHost, readRunningHostDescriptor } from "./running-host-client.js"
import { runningHostLimits } from "./running-host-contract.js"
import {
  availableHostAddress,
  availableLocalHostAddress,
  makeRunningHostReadProbe
} from "../../test-support/running-host-read-probe.js"
import { serveRunningHost } from "./running-host-http.js"

it.live("HTTP reads remain passive, reject wrong identities and malformed bytes, and respect Exit admission", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { closing, current, failure, observation, reads, runId } = yield* makeRunningHostReadProbe()
      const address = yield* availableLocalHostAddress
      const listening = yield* serveRunningHost(address, observation)
      expect(yield* readRunningHostDescriptor(address)).toEqual(listening.descriptor)
      expect(yield* callRunningHost(address, runId, { _tag: "ReadSnapshot" })).toMatchObject({
        result: { _tag: "Success", value: { _tag: "NotReady", runId } }
      })
      expect(yield* callRunningHost(address, RunId.make("wrong"), { _tag: "ReadRunControl" })).toMatchObject({
        result: { _tag: "Failure", error: { _tag: "RunMismatch" } }
      })
      expect(yield* Ref.get(reads)).toBe(0)
      expect(yield* callRunningHost(address, runId, { _tag: "ReadRunControl" })).toMatchObject({
        result: { _tag: "Success", value: { _tag: "RunUnpaused", terminationEvidence: { _tag: "Pending" } } }
      })
      const post = (body: string | Uint8Array) =>
        Effect.promise(async () => {
          // eslint-disable-next-line no-restricted-globals -- This test sends deliberately malformed bytes across the real local HTTP boundary.
          const response = await fetch(`${address}/dalph/v1/request`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body
          })
          return response.json()
        })
      const request = {
        protocolVersion: 1,
        hostInstanceId: listening.descriptor.hostInstanceId,
        requestId: "request",
        runId,
        operation: { _tag: "ReadRunControl" }
      }
      for (const invalid of [
        { ...request, root: "override" },
        { ...request, hostInstanceId: "stale" },
        { ...request, protocolVersion: 2 }
      ]) {
        expect(yield* post(JSON.stringify(invalid))).toMatchObject({ result: { _tag: "Failure" } })
      }
      expect(yield* post(new Uint8Array([0xff]))).toMatchObject({
        result: { _tag: "Failure", error: { _tag: "InvalidRequest" } }
      })
      expect(yield* Ref.get(reads)).toBe(1)
      const sizingRequest = { ...request, requestId: "", operation: { _tag: "ReadSnapshot" } }
      const fixedBytes = new TextEncoder().encode(JSON.stringify(sizingRequest)).byteLength
      const exactRequest = { ...sizingRequest, requestId: "x".repeat(runningHostLimits.requestBytes - fixedBytes) }
      expect(yield* post(JSON.stringify(exactRequest))).toMatchObject({
        result: { _tag: "Success", value: { _tag: "NotReady" } }
      })
      expect(yield* post(JSON.stringify({ ...exactRequest, requestId: `${exactRequest.requestId}x` }))).toMatchObject({
        result: {
          _tag: "Failure",
          error: { _tag: "FrameTooLarge", direction: "Incoming", maximumBytes: runningHostLimits.requestBytes }
        }
      })
      expect(yield* Ref.get(reads)).toBe(1)
      yield* Ref.set(current, { _tag: "Closed", final: null })
      expect(yield* callRunningHost(address, runId, { _tag: "ReadSnapshot" })).toMatchObject({
        result: { _tag: "Success", value: { _tag: "Closed", runId, final: null } }
      })
      yield* Ref.set(failure, Option.some({ _tag: "WorkflowRunTerminationEvidenceInvalid", runId }))
      expect(yield* callRunningHost(address, runId, { _tag: "ReadRunControl" })).toMatchObject({
        result: { _tag: "Success", value: { _tag: "RunUnpaused", terminationEvidence: { _tag: "FinalityFailed" } } }
      })
      expect(yield* Ref.get(reads)).toBe(2)
      yield* Ref.set(failure, Option.some({ _tag: "IntegratorCallFailure" }))
      expect(yield* callRunningHost(address, runId, { _tag: "ReadSnapshot" })).toMatchObject({
        result: { _tag: "Failure", error: { _tag: "ReadFailed", causeTag: "IntegratorCallFailure" } }
      })
      expect(yield* callRunningHost(address, runId, { _tag: "ReadRunControl" })).toMatchObject({
        result: { _tag: "Success", value: { terminationEvidence: { _tag: "Pending" } } }
      })
      yield* Ref.set(closing, true)
      expect(yield* readRunningHostDescriptor(address)).toEqual(listening.descriptor)
      expect(yield* callRunningHost(address, runId, { _tag: "ReadSnapshot" })).toMatchObject({
        result: { _tag: "Failure", error: { _tag: "HostClosing" } }
      })
      expect(yield* Ref.get(reads)).toBe(3)
    })
  )
)

it.live("a missing explicit host fails without discovery or a production acquisition", () =>
  Effect.gen(function* () {
    const { runId } = yield* makeRunningHostReadProbe()
    const address = yield* availableLocalHostAddress
    expect(yield* readRunningHostDescriptor(address).pipe(Effect.flip)).toMatchObject({
      _tag: "HostUnavailable",
      address
    })
    expect(yield* callRunningHost(address, runId, { _tag: "ReadSnapshot" })).toMatchObject({
      result: { _tag: "Failure", error: { _tag: "HostUnavailable" } }
    })
  })
)

it.live("a completed command with a lost HTTP reply is unknown and is never automatically replayed", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const probe = yield* makeRunningHostReadProbe()
      const calls = yield* Ref.make(0)
      const address = yield* availableLocalHostAddress
      let loseReply = () => {}
      const listening = yield* serveRunningHost(address, {
        ...probe.observation,
        executeAttachedCommand: (request) =>
          Ref.update(calls, (count) => count + 1).pipe(
            Effect.andThen(Effect.sync(() => loseReply())),
            Effect.as(
              request.operation._tag === "StartWork"
                ? { _tag: "WakeSubmitted" as const }
                : {
                    _tag: "UnpauseApplied" as const,
                    ordinal: ControlDirectionApplicationOrdinal.make(1),
                    acceptedAt: TraceCursor.make({ runId: probe.runId, position: JournalPosition.make(2) })
                  }
            )
          )
      })
      loseReply = () => listening.server.closeAllConnections()
      for (const operation of ["StartWork", "Unpause", "Pause", "Cancel"] as const) {
        expect(yield* callRunningHost(address, probe.runId, { _tag: operation })).toMatchObject({
          result: {
            _tag: "Failure",
            error: { _tag: "CommandOutcomeUnknown", operation, phase: "AdmissionUnconfirmed", acceptedAt: null }
          }
        })
      }
      expect(yield* Ref.get(calls)).toBe(4)
      expect(yield* callRunningHost(address, probe.runId, { _tag: "ReadRunControl" })).toMatchObject({
        result: { value: { _tag: "RunUnpaused" } }
      })
      expect(yield* Ref.get(calls)).toBe(4)
    })
  )
)

it.live("a client cancelled before sending a complete request performs no command", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const probe = yield* makeRunningHostReadProbe()
      const calls = yield* Ref.make(0)
      const address = yield* availableLocalHostAddress
      yield* serveRunningHost(address, {
        ...probe.observation,
        executeAttachedCommand: () =>
          Ref.update(calls, (count) => count + 1).pipe(Effect.as({ _tag: "WakeSubmitted" as const }))
      })
      yield* Effect.promise(
        () =>
          new Promise<void>((resolve) => {
            const pending = httpRequest(`${address}/dalph/v1/request`, {
              method: "POST",
              headers: { "content-type": "application/json", "content-length": "1000" }
            })
            pending.on("error", () => {})
            pending.once("close", resolve)
            pending.flushHeaders()
            pending.write('{"protocolVersion":1', () => pending.destroy())
          })
      )
      yield* readRunningHostDescriptor(address)
      expect(yield* Ref.get(calls)).toBe(0)
      expect((yield* probe.observation.commandAdmission.snapshot).registeredOwnerCount).toBe(0)
    })
  )
)

it.live("known terminal evidence rejects wake and Unpause before host command admission", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const probe = yield* makeRunningHostReadProbe()
      const calls = yield* Ref.make(0)
      const address = yield* availableLocalHostAddress
      const terminatedAt = TraceCursor.make({ runId: probe.runId, position: JournalPosition.make(4) })
      yield* serveRunningHost(address, {
        ...probe.observation,
        readRunControl: Effect.succeed({
          direction: "RunTerminated" as const,
          observedAt: terminatedAt,
          termination: { disposition: "Completed" as const, terminatedAt }
        }),
        executeAttachedCommand: () =>
          Ref.update(calls, (count) => count + 1).pipe(Effect.as({ _tag: "WakeSubmitted" as const }))
      })
      for (const operation of ["StartWork", "Unpause", "Pause", "Cancel"] as const)
        expect(yield* callRunningHost(address, probe.runId, { _tag: operation })).toMatchObject({
          result: {
            _tag: "Failure",
            error: { _tag: "RunClosed", runId: probe.runId, disposition: "Completed", terminatedAt }
          }
        })
      expect(yield* Ref.get(calls)).toBe(0)
      expect((yield* probe.observation.commandAdmission.snapshot).registeredOwnerCount).toBe(0)
    })
  )
)

it.effect("the client's response deadline stops its wait while the host completes the admitted command", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const probe = yield* makeRunningHostReadProbe()
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const completed = yield* Deferred.make<void>()
      const address = yield* availableLocalHostAddress
      yield* serveRunningHost(address, {
        ...probe.observation,
        executeAttachedCommand: () =>
          Deferred.succeed(entered, undefined).pipe(
            Effect.andThen(Deferred.await(release)),
            Effect.andThen(Deferred.succeed(completed, undefined)),
            Effect.as({ _tag: "WakeSubmitted" as const })
          )
      })
      yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.asVoid))
      const client = yield* callRunningHost(address, probe.runId, { _tag: "StartWork" }).pipe(Effect.forkChild)
      yield* Deferred.await(entered)
      yield* TestClock.adjust(runningHostLimits.responseDeadlineMillis)
      expect(yield* Fiber.join(client)).toMatchObject({
        result: { _tag: "Failure", error: { _tag: "CommandOutcomeUnknown" } }
      })
      expect((yield* probe.observation.commandAdmission.snapshot).registeredOwnerCount).toBe(1)
      yield* Deferred.succeed(release, undefined)
      yield* Deferred.await(completed)
    })
  )
)

const configuredIpv4 = Object.values(networkInterfaces())
  .flat()
  .find((entry) => entry?.family === "IPv4" && !entry.internal)?.address

it.live.skipIf(configuredIpv4 === undefined)(
  "HTTP binds the configured interface and serves passive attachment reads",
  () =>
    Effect.gen(function* () {
      if (configuredIpv4 === undefined) return yield* Effect.die("No assigned non-loopback IPv4 interface")
      const probe = yield* makeRunningHostReadProbe()
      const address = yield* availableHostAddress(configuredIpv4)
      const listening = yield* Effect.scoped(
        Effect.gen(function* () {
          const host = yield* serveRunningHost(address, probe.observation)
          expect(host.server.address()).toMatchObject({ address: configuredIpv4, port: Number(new URL(address).port) })
          expect(yield* readRunningHostDescriptor(address)).toEqual(host.descriptor)
          expect(yield* callRunningHost(address, probe.runId, { _tag: "ReadSnapshot" })).toMatchObject({
            result: { _tag: "Success", value: { _tag: "NotReady" } }
          })
          expect(yield* Ref.get(probe.reads)).toBe(0)
          for (const headers of [{ host: "127.0.0.1:1" }, { origin: "http://foreign.example" }]) {
            const rejected = yield* Effect.promise(
              () =>
                new Promise<unknown>((resolve, reject) => {
                  const request = httpRequest(`${address}/dalph/v1/descriptor`, { headers }, (response) => {
                    let text = ""
                    response.setEncoding("utf8")
                    response.on("data", (chunk: string) => {
                      text += chunk
                    })
                    response.on("end", () => resolve(JSON.parse(text)))
                    response.on("error", reject)
                  })
                  request.on("error", reject)
                  request.end()
                })
            )
            expect(rejected).toMatchObject({
              result: { _tag: "Failure", error: { _tag: "InvalidRequest", code: "LocalOriginRequired" } }
            })
          }
          expect(yield* Ref.get(probe.reads)).toBe(0)
          return host
        })
      )
      expect(listening.server.listening).toBe(false)
    })
)

// Control the OS write boundary, while keeping the real request, platform
// response encoder, Node response lifecycle and host scope.
for (const path of ["/dalph/v1/descriptor", "/"]) {
  it.effect(`a stalled ${path} flush closes its exact socket at five seconds and releases the host scope`, () =>
    Effect.gen(function* () {
      const writing = yield* Deferred.make<void>()
      const closed = yield* Deferred.make<void>()
      const clientClosed = yield* Deferred.make<void>()
      const finished = yield* Deferred.make<void>()
      const stalled = yield* Effect.scoped(
        Effect.gen(function* () {
          const probe = yield* makeRunningHostReadProbe()
          const address = yield* availableLocalHostAddress
          const host = yield* serveRunningHost(address, probe.observation)
          host.server.prependOnceListener("request", (_request, response) => {
            const socket = response.socket
            if (socket === null) return
            const write = socket.write.bind(socket)
            socket.write = () => {
              Deferred.doneUnsafe(writing, Effect.void)
              return false
            }
            response.once("finish", () => Deferred.doneUnsafe(finished, Effect.void))
            response.once("close", () => {
              socket.write = write
              Deferred.doneUnsafe(closed, Effect.void)
            })
          })
          const client = httpRequest(`${address}${path}`)
          client.on("error", () => Deferred.doneUnsafe(clientClosed, Effect.void))
          client.end()
          yield* Deferred.await(writing)
          yield* TestClock.adjust(4999)
          expect(yield* Deferred.isDone(closed)).toBe(false)
          expect(yield* Deferred.isDone(finished)).toBe(false)
          yield* TestClock.adjust(1)
          yield* Deferred.await(closed)
          yield* Deferred.await(clientClosed)
          expect(yield* Deferred.isDone(finished)).toBe(false)
          // A separate connection remains usable after the stalled one closes.
          expect(yield* readRunningHostDescriptor(address)).toEqual(host.descriptor)
          return host.server
        })
      )
      expect(stalled.listening).toBe(false)
    })
  )
}

for (const path of ["/dalph/v1/descriptor", "/"]) {
  it.effect(`a completed ${path} flush cancels its socket deadline`, () =>
    Effect.scoped(
      Effect.gen(function* () {
        const probe = yield* makeRunningHostReadProbe()
        const address = yield* availableLocalHostAddress
        const host = yield* serveRunningHost(address, probe.observation)
        const flushed = yield* Deferred.make<void>()
        const observed = yield* Deferred.make<Effect.Effect<void>>()
        host.server.prependOnceListener("request", (_request, response) => {
          const destroy = response.destroy.bind(response)
          let destroyed = false
          response.destroy = (error) => {
            destroyed = true
            return destroy(error)
          }
          response.once("finish", () => {
            Deferred.doneUnsafe(flushed, Effect.void)
          })
          Deferred.doneUnsafe(
            observed,
            Effect.succeed(
              Effect.sync(() => {
                expect(destroyed).toBe(false)
                response.destroy = destroy
              })
            )
          )
        })
        const status = yield* Effect.promise(
          () =>
            new Promise<number | undefined>((resolve, reject) => {
              const request = httpRequest(`${address}${path}`, (response) => {
                response.resume()
                response.on("end", () => resolve(response.statusCode))
                response.on("error", reject)
              })
              request.on("error", reject)
              request.end()
            })
        )
        expect(status).toBe(200)
        yield* Deferred.await(flushed)
        yield* TestClock.adjust(5000)
        yield* yield* Deferred.await(observed)
        expect(yield* readRunningHostDescriptor(address)).toEqual(host.descriptor)
      })
    )
  )
}
