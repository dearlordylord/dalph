/* eslint-disable import/no-nodejs-modules -- This fixture kills exact CLI/MCP children at controlled real SQLite cuts. */
import { spawn } from "node:child_process"
import process from "node:process"
import { fileURLToPath } from "node:url"
import { it } from "@effect/vitest"
import { Deferred, Effect, Fiber, Ref } from "effect"
import { expect } from "vitest"
import { availableLocalHostAddress } from "../../test-support/running-host-read-probe.js"
import { makeRunningHostFixture, runningHostFixtureLayer } from "../../test-support/production-running-host-fixture.js"
import { withDecodedProductionRepositoryHost } from "./production-host.js"
import { callRunningHost } from "./running-host-client.js"
import { serveRunningHost } from "./running-host-http.js"
import { projectRecordedCassette, verifyRecordedCassetteRoundTrip } from "../cassettes/recorded.js"

const builtEntry = fileURLToPath(new URL("../../dist/bin/dalph.js", import.meta.url))
const startClient = Effect.fn("RunningHostCommandTest.startClient")(function* (
  adapter: "CLI" | "MCP",
  address: string,
  runId: string,
  operation: "start" | "unpause" = "unpause"
) {
  const args =
    adapter === "CLI"
      ? ["attach", operation, "--host", address, "--run", runId, "--json"]
      : ["mcp", "--host", address, "--run", runId]
  let stdout = ""
  const child = yield* Effect.acquireRelease(
    Effect.sync(() => spawn(process.execPath, [builtEntry, ...args], { stdio: ["pipe", "pipe", "pipe"] })),
    (child) =>
      Effect.sync(() => {
        child.kill("SIGTERM")
      })
  )
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString("utf8")
  })
  const awaitClose = yield* Effect.callback<void>((resume) => {
    child.once("close", () => resume(Effect.void))
  }).pipe(Effect.forkScoped)
  if (adapter === "MCP")
    yield* Effect.sync(() =>
      child.stdin.end(
        [
          {
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "cut", version: "1" } }
          },
          { jsonrpc: "2.0", method: "notifications/initialized" },
          {
            jsonrpc: "2.0",
            id: 2,
            method: "tools/call",
            params: { name: operation === "start" ? "dalph_start_work" : "dalph_unpause", arguments: { runId } }
          }
        ]
          .map((message) => JSON.stringify(message))
          .join("\n") + "\n"
      )
    )
  return {
    output: Fiber.join(awaitClose).pipe(Effect.andThen(Effect.sync(() => stdout))),
    stop: Effect.sync(() => {
      expect(child.kill("SIGTERM")).toBe(true)
    }).pipe(Effect.andThen(Fiber.join(awaitClose)))
  }
})

for (const adapter of ["CLI", "MCP"] as const) {
  for (const cut of ["AfterInsert", "AfterCommit", "AfterCallback"] as const) {
    it.live(
      `${adapter} loss at SQLite ${cut} preserves one Unpause callback and ordinary delivery`,
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const armed = yield* Ref.make(false)
            const entered = yield* Deferred.make<void>()
            const release = yield* Deferred.make<void>()
            const timers = yield* Ref.make<ReadonlyArray<string>>([])
            const callbacks = yield* Ref.make<ReadonlyArray<string>>([])
            const storageCut = Ref.getAndSet(armed, false).pipe(
              Effect.flatMap((active) =>
                active
                  ? Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)))
                  : Effect.void
              )
            )
            const fixture = yield* makeRunningHostFixture(builtEntry, false, {
              ...(cut === "AfterInsert"
                ? { afterInsert: () => storageCut }
                : cut === "AfterCommit"
                  ? { afterCommit: () => storageCut }
                  : {}),
              onTimerStateChange: (state) => Ref.update(timers, (all) => [...all, state]),
              onAcceptedRunControl: (direction) => Ref.update(callbacks, (all) => [...all, direction])
            })
            const address = yield* availableLocalHostAddress
            yield* withDecodedProductionRepositoryHost(
              fixture.configuration,
              fixture.graph,
              (observation) =>
                Effect.scoped(
                  Effect.gen(function* () {
                    yield* serveRunningHost(
                      address,
                      cut === "AfterCallback"
                        ? {
                            ...observation,
                            executeAttachedCommand: (request) =>
                              observation.executeAttachedCommand(request).pipe(Effect.tap(() => storageCut))
                          }
                        : observation
                    )
                    yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.asVoid))
                    const wake = yield* startClient(adapter, address, observation.selection.runId, "start")
                    const wakeOutput = yield* wake.output.pipe(Effect.timeout("10 seconds"))
                    const wakeReply = JSON.parse(wakeOutput.trim().split("\n").at(-1) ?? "")
                    expect(adapter === "CLI" ? wakeReply : wakeReply.result.structuredContent).toMatchObject({
                      result: { _tag: "Success", value: { _tag: "WakeSubmitted" } }
                    })
                    expect(
                      yield* callRunningHost(address, observation.selection.runId, { _tag: "ReadRunControl" })
                    ).toMatchObject({ result: { value: { _tag: "RunPaused" } } })
                    expect(yield* Ref.get(timers)).toEqual([])
                    expect(yield* Ref.get(fixture.trackerCalls)).toBe(0)
                    yield* Ref.set(armed, true)
                    const client = yield* startClient(adapter, address, observation.selection.runId)
                    yield* Deferred.await(entered).pipe(Effect.timeout("10 seconds"))
                    yield* client.stop.pipe(Effect.timeout("5 seconds"))
                    yield* Deferred.succeed(release, undefined)
                    yield* Deferred.await(fixture.turnEntered).pipe(Effect.timeout("20 seconds"))
                    expect(yield* Ref.get(timers)).toEqual(["Started"])
                    expect(yield* Ref.get(callbacks)).toEqual(["Unpause"])
                    expect(yield* Ref.get(fixture.trackerCalls)).toBeGreaterThan(0)
                    const controls = (yield* fixture.readPausedHistory).filter(
                      ({ event }) => event._tag === "ControlDirectionApplied"
                    )
                    expect(controls).toHaveLength(2)
                    expect(controls[1]).toMatchObject({ position: 3, event: { direction: "Unpause", ordinal: 2 } })
                    yield* fixture.release
                    expect(yield* observation.runTermination.await.pipe(Effect.timeout("20 seconds"))).toMatchObject({
                      disposition: "Completed"
                    })
                    const records = yield* fixture.readPausedHistory
                    const cassette = yield* projectRecordedCassette(records)
                    expect(cassette.entries.some((entry) => entry._tag === "ControlDirectionApplied")).toBe(true)
                    expect(
                      verifyRecordedCassetteRoundTrip(records, cassette).every(
                        (checkpoint) => checkpoint.workflowHistoryEquivalent
                      )
                    ).toBe(true)
                    expect(yield* Ref.get(fixture.exitCalls)).toBe(0)
                  })
                ),
              "Run",
              "Listening"
            )
          })
        ).pipe(Effect.provide(runningHostFixtureLayer)),
      60000
    )
  }
  it.live(
    `${adapter} receives exact partial Unpause evidence after the real owner callback fails and never replays over Pause`,
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fixture = yield* makeRunningHostFixture(builtEntry, false, {
            onTimerStateChange: (state) =>
              state === "Started" ? Effect.die("controlled owner callback failure") : Effect.void
          })
          const address = yield* availableLocalHostAddress
          yield* withDecodedProductionRepositoryHost(
            fixture.configuration,
            fixture.graph,
            (observation) =>
              Effect.scoped(
                Effect.gen(function* () {
                  yield* serveRunningHost(address, observation)
                  const client = yield* startClient(adapter, address, observation.selection.runId)
                  const output = yield* client.output.pipe(Effect.timeout("10 seconds"))
                  const reply = JSON.parse(output.trim().split("\n").at(-1) ?? "")
                  expect(adapter === "CLI" ? reply : reply.result.structuredContent).toMatchObject({
                    result: {
                      _tag: "Failure",
                      error: {
                        _tag: "UnpausePartiallyApplied",
                        ordinal: 2,
                        acceptedAt: { runId: observation.selection.runId, position: 3 }
                      }
                    }
                  })
                  expect(
                    yield* callRunningHost(address, observation.selection.runId, { _tag: "ReadRunControl" })
                  ).toMatchObject({ result: { value: { _tag: "RunUnpaused" } } })
                  expect(yield* Ref.get(fixture.trackerCalls)).toBe(0)
                  const bootstrap = yield* fixture.bootstrap
                  yield* bootstrap.operatorControl.applyControlDirection({
                    direction: "Pause",
                    subject: { _tag: "Run", runId: observation.selection.runId }
                  })
                  for (let read = 0; read < 2; read += 1)
                    expect(
                      yield* callRunningHost(address, observation.selection.runId, { _tag: "ReadRunControl" })
                    ).toMatchObject({ result: { value: { _tag: "RunPaused" } } })
                  expect((yield* fixture.readPausedHistory).map(({ event }) => event._tag)).toEqual([
                    "WorkflowRunBegan",
                    "ControlDirectionApplied",
                    "ControlDirectionApplied",
                    "ControlDirectionApplied"
                  ])
                  const deliberate = yield* startClient(adapter, address, observation.selection.runId)
                  const deliberateOutput = yield* deliberate.output.pipe(Effect.timeout("10 seconds"))
                  const deliberateReply = JSON.parse(deliberateOutput.trim().split("\n").at(-1) ?? "")
                  expect(adapter === "CLI" ? deliberateReply : deliberateReply.result.structuredContent).toMatchObject({
                    result: { error: { _tag: "UnpausePartiallyApplied", ordinal: 4, acceptedAt: { position: 5 } } }
                  })
                  expect(yield* fixture.readPausedHistory).toHaveLength(5)
                })
              ),
            "Run",
            "Listening"
          )
        })
      ).pipe(Effect.provide(runningHostFixtureLayer)),
    60000
  )
  it.live(
    `${adapter} retains durable Unpause when the real callback exceeds the original Exit drain`,
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const entered = yield* Deferred.make<void>()
          const stopped = yield* Deferred.make<void>()
          const callbacks = yield* Ref.make(0)
          const fixture = yield* makeRunningHostFixture(builtEntry, false, {
            onAcceptedRunControl: () => Ref.update(callbacks, (count) => count + 1),
            onTimerStateChange: (state) =>
              state === "Started"
                ? Deferred.succeed(entered, undefined).pipe(
                    Effect.andThen(Effect.never),
                    Effect.ensuring(Deferred.succeed(stopped, undefined))
                  )
                : Effect.void
          })
          const address = yield* availableLocalHostAddress
          yield* withDecodedProductionRepositoryHost(
            fixture.configuration,
            fixture.graph,
            (observation) =>
              Effect.scoped(
                Effect.gen(function* () {
                  yield* serveRunningHost(address, observation)
                  const client = yield* startClient(adapter, address, observation.selection.runId)
                  yield* Deferred.await(entered).pipe(
                    Effect.timeout("10 seconds"),
                    Effect.catchTag("TimeoutError", () =>
                      Effect.die("CLI/MCP did not reach actual callback within 10 seconds")
                    )
                  )
                  expect((yield* fixture.readPausedHistory).at(-1)).toMatchObject({
                    position: 3,
                    event: { _tag: "ControlDirectionApplied", direction: "Unpause", ordinal: 2 }
                  })
                  const exiting = yield* observation.applicationExitRequestBoundary.requestExit.pipe(Effect.forkChild)
                  expect(
                    yield* Fiber.join(exiting).pipe(
                      Effect.timeout("8 seconds"),
                      Effect.catchTag("TimeoutError", () => Effect.die("original Exit did not report within 8 seconds"))
                    )
                  ).toMatchObject({ _tag: "TimedOut" })
                  const output = yield* client.output.pipe(
                    Effect.timeout("10 seconds"),
                    Effect.catchTag("TimeoutError", () =>
                      Effect.die("client did not report admitted timeout within 10 seconds")
                    )
                  )
                  const reply = JSON.parse(output.trim().split("\n").at(-1) ?? "")
                  expect(adapter === "CLI" ? reply : reply.result.structuredContent).toMatchObject({
                    result: {
                      error: {
                        _tag: "CommandOutcomeUnknown",
                        operation: "Unpause",
                        phase: "AdmittedCompletionUnconfirmed"
                      }
                    }
                  })
                  yield* Deferred.await(stopped).pipe(
                    Effect.timeout("1 second"),
                    Effect.catchTag("TimeoutError", () => Effect.die("real callback writer did not stop"))
                  )
                  expect(yield* Ref.get(callbacks)).toBe(1)
                  expect(yield* Ref.get(fixture.trackerCalls)).toBe(0)
                  expect((yield* fixture.readPausedHistory).map(({ event }) => event._tag)).toEqual([
                    "WorkflowRunBegan",
                    "ControlDirectionApplied",
                    "ControlDirectionApplied"
                  ])
                })
              ),
            "Run",
            "Listening"
          )
        })
      ).pipe(Effect.provide(runningHostFixtureLayer)),
    60000
  )
  it.live(
    `${adapter} reports unknown after a lost SQLite commit acknowledgement without claiming rollback or callback completion`,
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const armed = yield* Ref.make(false)
          const callbacks = yield* Ref.make(0)
          const fixture = yield* makeRunningHostFixture(builtEntry, false, {
            afterCommit: () =>
              Ref.getAndSet(armed, false).pipe(
                Effect.flatMap((active) =>
                  active ? Effect.fail("controlled lost SQLite acknowledgement") : Effect.void
                )
              ),
            onAcceptedRunControl: () => Ref.update(callbacks, (count) => count + 1)
          })
          const address = yield* availableLocalHostAddress
          yield* withDecodedProductionRepositoryHost(
            fixture.configuration,
            fixture.graph,
            (observation) =>
              Effect.scoped(
                Effect.gen(function* () {
                  yield* serveRunningHost(address, observation)
                  yield* Ref.set(armed, true)
                  const client = yield* startClient(adapter, address, observation.selection.runId)
                  const output = yield* client.output.pipe(Effect.timeout("10 seconds"))
                  const reply = JSON.parse(output.trim().split("\n").at(-1) ?? "")
                  expect(adapter === "CLI" ? reply : reply.result.structuredContent).toMatchObject({
                    result: {
                      _tag: "Failure",
                      error: {
                        _tag: "CommandOutcomeUnknown",
                        operation: "Unpause",
                        phase: "AdmittedCompletionUnconfirmed",
                        acceptedAt: null
                      }
                    }
                  })
                  expect(
                    yield* callRunningHost(address, observation.selection.runId, { _tag: "ReadRunControl" })
                  ).toMatchObject({ result: { value: { _tag: "RunPaused", controlObservedAt: { position: 2 } } } })
                  expect(
                    yield* callRunningHost(address, observation.selection.runId, { _tag: "Unpause" })
                  ).toMatchObject({
                    result: {
                      _tag: "Failure",
                      error: { _tag: "CommandFailed", stage: "BeforeApplication", causeTag: "UnreconciledRunControl" }
                    }
                  })
                  expect(yield* Ref.get(callbacks)).toBe(0)
                  expect(yield* Ref.get(fixture.trackerCalls)).toBe(0)
                  expect((yield* fixture.readPausedHistory).map(({ event }) => event._tag)).toEqual([
                    "WorkflowRunBegan",
                    "ControlDirectionApplied",
                    "ControlDirectionApplied"
                  ])
                })
              ),
            "Run",
            "Listening"
          )
        })
      ).pipe(Effect.provide(runningHostFixtureLayer)),
    60000
  )
  it.live(
    `${adapter} Unpause admitted before Exit completes its callback inside the existing drain and rejects later work`,
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const armed = yield* Ref.make(false)
          const entered = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          const callbacks = yield* Ref.make<ReadonlyArray<string>>([])
          const timers = yield* Ref.make<ReadonlyArray<string>>([])
          const fixture = yield* makeRunningHostFixture(builtEntry, false, {
            afterInsert: () =>
              Ref.getAndSet(armed, false).pipe(
                Effect.flatMap((active) =>
                  active
                    ? Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)))
                    : Effect.void
                )
              ),
            onAcceptedRunControl: (direction) => Ref.update(callbacks, (all) => [...all, direction]),
            onTimerStateChange: (state) => Ref.update(timers, (all) => [...all, state])
          })
          const address = yield* availableLocalHostAddress
          yield* withDecodedProductionRepositoryHost(
            fixture.configuration,
            fixture.graph,
            (observation) =>
              Effect.scoped(
                Effect.gen(function* () {
                  yield* serveRunningHost(address, observation)
                  yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.asVoid))
                  yield* Ref.set(armed, true)
                  const client = yield* startClient(adapter, address, observation.selection.runId)
                  yield* Deferred.await(entered).pipe(Effect.timeout("10 seconds"))
                  const exiting = yield* observation.applicationExitRequestBoundary.requestExit.pipe(Effect.forkChild)
                  const awaitCutoff = (): Effect.Effect<void> =>
                    observation.closing.pipe(
                      Effect.flatMap((closing) =>
                        closing ? Effect.void : Effect.yieldNow.pipe(Effect.andThen(Effect.suspend(awaitCutoff)))
                      )
                    )
                  yield* awaitCutoff().pipe(Effect.timeout("1 second"))
                  expect(
                    yield* callRunningHost(address, observation.selection.runId, { _tag: "StartWork" })
                  ).toMatchObject({ result: { _tag: "Failure", error: { _tag: "HostClosing" } } })
                  yield* Deferred.succeed(release, undefined)
                  const output = yield* client.output.pipe(Effect.timeout("10 seconds"))
                  const reply = JSON.parse(output.trim().split("\n").at(-1) ?? "")
                  expect(adapter === "CLI" ? reply : reply.result.structuredContent).toMatchObject({
                    result: {
                      value: {
                        _tag: "UnpauseApplied",
                        ordinal: 2,
                        acceptedAt: { runId: observation.selection.runId, position: 3 }
                      }
                    }
                  })
                  expect(yield* Fiber.join(exiting)).toMatchObject({ _tag: "Succeeded" })
                  expect(yield* Ref.get(callbacks)).toEqual(["Unpause"])
                  expect(yield* Ref.get(timers)).toEqual(["Started", "Stopped"])
                  expect(yield* Ref.get(fixture.trackerCalls)).toBe(0)
                  expect((yield* fixture.readPausedHistory).map(({ event }) => event._tag)).toEqual([
                    "WorkflowRunBegan",
                    "ControlDirectionApplied",
                    "ControlDirectionApplied"
                  ])
                })
              ),
            "Run",
            "Listening"
          )
        })
      ).pipe(Effect.provide(runningHostFixtureLayer)),
    60000
  )
}
