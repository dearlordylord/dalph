/* eslint-disable import/no-nodejs-modules -- Acceptance drives actual public client processes. */
import { spawn } from "node:child_process"
import process from "node:process"
import { performance } from "node:perf_hooks"
import { fileURLToPath } from "node:url"
import { it } from "@effect/vitest"
import { Deferred, Effect, Fiber, Ref, FileSystem } from "effect"
import { expect } from "vitest"
import { TraceCursor } from "@dalph/orchestrator"
import { OccurrencePageCapacity } from "./running-host-occurrences-contract.js"
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
  operation: "start" | "unpause" | "pause" | "cancel" = "unpause"
) {
  const args =
    adapter === "CLI"
      ? ["attach", operation, "--host", address, "--run", runId, "--json"]
      : ["mcp", "--host", address, "--run", runId]
  let stdout = ""
  let stderr = ""
  const child = yield* Effect.acquireRelease(
    Effect.sync(() => spawn(process.execPath, [builtEntry, ...args], { stdio: ["pipe", "pipe", "pipe"] })),
    (child) =>
      Effect.sync(() => {
        child.kill("SIGTERM")
      })
  )
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8")
  })
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
            params: { name: operation === "start" ? "dalph_start_work" : `dalph_${operation}`, arguments: { runId } }
          }
        ]
          .map((message) => JSON.stringify(message))
          .join("\n") + "\n"
      )
    )
  return {
    output: Fiber.join(awaitClose).pipe(Effect.andThen(Effect.sync(() => stdout))),
    diagnostics: Effect.sync(() => ({ stdout, stderr })),
    stop: Effect.sync(() => {
      expect(child.kill("SIGTERM")).toBe(true)
    }).pipe(Effect.andThen(Fiber.join(awaitClose)))
  }
})

for (const adapter of ["CLI", "MCP"] as const) {
  it.live(
    `${adapter} public clients apply whole-Run controls while history remains busy`,
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fixture = yield* makeRunningHostFixture(builtEntry, false, {})
          const address = yield* availableLocalHostAddress
          yield* withDecodedProductionRepositoryHost(
            fixture.configuration,
            fixture.graph,
            (observation) =>
              Effect.scoped(
                Effect.gen(function* () {
                  const entered = yield* Deferred.make<void>()
                  const release = yield* Deferred.make<void>()
                  yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.asVoid))
                  const read = observation.traceReader.readOccurrencesAt
                  if (read === undefined) return expect.fail("production occurrence reader required")
                  const commands: Array<string> = []
                  yield* serveRunningHost(address, {
                    ...observation,
                    executeAttachedCommand: (request) =>
                      Effect.sync(() => commands.push(`Received:${request.operation._tag}`)).pipe(
                        Effect.andThen(observation.executeAttachedCommand(request)),
                        Effect.tap(() => Effect.sync(() => commands.push(`Applied:${request.operation._tag}`)))
                      ),
                    // Fail if command admission tries optional accepted-history control projection.
                    readRunControl: Effect.die("history projection cannot precede local admission"),
                    traceReader: {
                      ...observation.traceReader,
                      readOccurrencesAt: (...args) =>
                        Deferred.succeed(entered, undefined).pipe(
                          Effect.andThen(Deferred.await(release)),
                          Effect.andThen(read(...args))
                        )
                    }
                  })
                  const records = yield* fixture.readPausedHistory
                  const last = records.at(-1)
                  if (last === undefined) return expect.fail("established paused history required")
                  const runId = observation.selection.runId
                  const historyDone = yield* Deferred.make<void>()
                  const history = yield* callRunningHost(address, runId, {
                    _tag: "ReadOccurrencePage",
                    prefix: TraceCursor.make({ runId, position: last.position }),
                    continuation: null,
                    capacityBytes: OccurrencePageCapacity.make(8192)
                  }).pipe(Effect.ensuring(Deferred.succeed(historyDone, undefined)), Effect.forkScoped)
                  yield* Deferred.await(entered).pipe(Effect.timeout("5 seconds"))
                  yield* fixture.releaseObservationCut
                  for (const operation of ["pause", "cancel"] as const) {
                    const client = yield* startClient(adapter, address, runId, operation)
                    const output = yield* client.output.pipe(
                      Effect.timeout("20 seconds"),
                      Effect.tapError(() =>
                        client.diagnostics.pipe(Effect.tap((value) => Effect.logError({ ...value, commands })))
                      )
                    )
                    const reply = JSON.parse(output.trim().split("\n").at(-1) ?? "")
                    expect(adapter === "CLI" ? reply : reply.result.structuredContent).toMatchObject({
                      runId,
                      result: {
                        _tag: "Success",
                        value: { _tag: operation === "pause" ? "PauseApplied" : "CancelApplied", acceptedAt: { runId } }
                      }
                    })
                    expect(yield* Deferred.isDone(historyDone)).toBe(false)
                  }
                  yield* fixture.releaseObservationCut
                  const failure = observation.awaitActivationFailure
                  if (failure === undefined) return expect.fail("production failure observation required")
                  expect(yield* failure.pipe(Effect.flip, Effect.timeout("15 seconds"))).toMatchObject({
                    _tag: "ProductionCancellationBlocked",
                    blocker: "TrackerTargetUnsettled"
                  })
                  const settled = yield* fixture.readPausedHistory
                  expect(settled.some(({ event }) => event._tag === "WorkflowRunTerminated")).toBe(false)
                  expect(settled.filter(({ event }) => event._tag === "RunCancellationApplied")).toHaveLength(1)
                  expect(settled.filter(({ event }) => event._tag === "ControlDirectionApplied")).toHaveLength(2)
                  const cassette = yield* projectRecordedCassette(settled)
                  expect(
                    verifyRecordedCassetteRoundTrip(settled, cassette).every(
                      (checkpoint) => checkpoint.workflowHistoryEquivalent
                    )
                  ).toBe(true)
                  expect((yield* fixture.provider.snapshot()).activeTurnCount).toBe(0)
                  yield* Deferred.succeed(release, undefined)
                  expect(yield* Fiber.join(history)).toMatchObject({ result: { _tag: "Success" } })
                })
              ),
            "Run",
            "Listening"
          )
        })
      ).pipe(Effect.provide(runningHostFixtureLayer)),
    60000
  )

  for (const operation of ["pause", "cancel"] as const) {
    it.live(
      `${adapter} lost ${operation} replies retain the host command without replay`,
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const fixture = yield* makeRunningHostFixture(builtEntry, false, {})
            const address = yield* availableLocalHostAddress
            const entered = yield* Deferred.make<void>()
            const release = yield* Deferred.make<void>()
            yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.asVoid))
            yield* withDecodedProductionRepositoryHost(
              fixture.configuration,
              fixture.graph,
              (observation) =>
                Effect.scoped(
                  Effect.gen(function* () {
                    yield* serveRunningHost(address, {
                      ...observation,
                      executeAttachedCommand: (request) =>
                        observation.executeAttachedCommand(request).pipe(
                          Effect.tap(() => Deferred.succeed(entered, undefined)),
                          Effect.tap(() => Deferred.await(release))
                        )
                    })
                    const client = yield* startClient(adapter, address, observation.selection.runId, operation)
                    yield* Deferred.await(entered).pipe(Effect.timeout("20 seconds"))
                    yield* client.stop.pipe(Effect.timeout("5 seconds"))
                    yield* Deferred.succeed(release, undefined)
                    const records = yield* fixture.readPausedHistory
                    expect(
                      records.filter(
                        ({ event }) =>
                          event._tag === (operation === "pause" ? "ControlDirectionApplied" : "RunCancellationApplied")
                      )
                    ).toHaveLength(operation === "pause" ? 2 : 1)
                    expect(
                      yield* callRunningHost(address, observation.selection.runId, { _tag: "ReadRunControl" })
                    ).toMatchObject({ result: { _tag: "Success" } })
                    yield* fixture.releaseObservationCut
                  })
                ),
              "Run",
              "Listening"
            )
          })
        ).pipe(Effect.provide(runningHostFixtureLayer)),
      30000
    )
  }
}

for (const adapter of ["CLI", "MCP"] as const) {
  for (const operation of ["pause", "cancel"] as const) {
    it.live(
      `${adapter} reports an ambiguous ${operation} reply without retransmission`,
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const fixture = yield* makeRunningHostFixture(builtEntry, false, {})
            const address = yield* availableLocalHostAddress
            yield* withDecodedProductionRepositoryHost(
              fixture.configuration,
              fixture.graph,
              (observation) =>
                Effect.scoped(
                  Effect.gen(function* () {
                    let loseReply = () => {}
                    const listener = yield* serveRunningHost(address, {
                      ...observation,
                      executeAttachedCommand: (request) =>
                        observation
                          .executeAttachedCommand(request)
                          .pipe(Effect.tap(() => Effect.sync(() => loseReply())))
                    })
                    loseReply = () => listener.server.closeAllConnections()
                    const client = yield* startClient(adapter, address, observation.selection.runId, operation)
                    const output = yield* client.output.pipe(Effect.timeout("20 seconds"))
                    const reply = JSON.parse(output.trim().split("\n").at(-1) ?? "")
                    expect(adapter === "CLI" ? reply : reply.result.structuredContent).toMatchObject({
                      runId: observation.selection.runId,
                      requestId: expect.any(String),
                      result: {
                        _tag: "Failure",
                        error: {
                          _tag: "CommandOutcomeUnknown",
                          operation: operation === "pause" ? "Pause" : "Cancel",
                          phase: "AdmissionUnconfirmed"
                        }
                      }
                    })
                    const records = yield* fixture.readPausedHistory
                    expect(
                      records.filter(
                        ({ event }) =>
                          event._tag === (operation === "pause" ? "ControlDirectionApplied" : "RunCancellationApplied")
                      )
                    ).toHaveLength(operation === "pause" ? 2 : 1)
                    yield* fixture.releaseObservationCut
                  })
                ),
              "Run",
              "Listening"
            )
          })
        ).pipe(Effect.provide(runningHostFixtureLayer)),
      30000
    )
  }
}

for (const evidence of ["Unavailable", "Foreign"] as const) {
  it.live(
    `attached cancellation retains ${evidence} executor responsibility`,
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const failed = yield* Deferred.make<void>()
          const fixture = yield* makeRunningHostFixture(builtEntry, false, undefined, {
            onActivationFailure: () => Deferred.succeed(failed, undefined).pipe(Effect.asVoid)
          })
          const address = yield* availableLocalHostAddress
          yield* withDecodedProductionRepositoryHost(
            fixture.configuration,
            fixture.graph,
            (observation) =>
              Effect.scoped(
                Effect.gen(function* () {
                  yield* serveRunningHost(address, observation)
                  yield* Deferred.await(fixture.turnEntered).pipe(Effect.timeout("15 seconds"))
                  yield* Deferred.await(fixture.activationFinalizing).pipe(Effect.timeout("15 seconds"))
                  const runId = observation.selection.runId
                  yield* fixture.releaseObservationCut
                  const before = yield* fixture.provider.snapshot()
                  expect(before.activeClaimCount).toBe(1)
                  yield* fixture.setExecutorEvidence(evidence)
                  expect(yield* callRunningHost(address, runId, { _tag: "Cancel" })).toMatchObject({
                    result: { _tag: "Success", value: { _tag: "CancelApplied", acceptedAt: { runId } } }
                  })
                  yield* fixture.releaseObservationCut
                  yield* Deferred.await(failed).pipe(Effect.timeout("15 seconds"))
                  const records = yield* fixture.readHistory(runId)
                  expect(records.filter(({ event }) => event._tag === "RunCancellationApplied")).toHaveLength(1)
                  expect(records.some(({ event }) => event._tag === "CancelledAttemptImplementationAbandoned")).toBe(
                    false
                  )
                  expect(records.some(({ event }) => event._tag === "WorkflowRunTerminated")).toBe(false)
                  expect((yield* fixture.provider.snapshot()).activeClaimCount).toBe(1)
                  expect(yield* callRunningHost(address, runId, { _tag: "ReadSnapshot" })).toMatchObject({
                    result: {
                      _tag: "Success",
                      value: { _tag: "Ready", retained: expect.any(Array), held: expect.any(Array) }
                    }
                  })
                  yield* fixture.setExecutorEvidence("Ordinary")
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
  "native repeated profiles measure local admission separately from provider settlement",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const profileResults: Array<Record<string, unknown>> = []
        const fixture = yield* makeRunningHostFixture(builtEntry)
        const address = yield* availableLocalHostAddress
        yield* withDecodedProductionRepositoryHost(
          fixture.configuration,
          fixture.graph,
          (observation) =>
            Effect.scoped(
              Effect.gen(function* () {
                yield* Deferred.await(fixture.turnEntered).pipe(Effect.timeout("15 seconds"))
                yield* Deferred.await(fixture.activationFinalizing).pipe(Effect.timeout("15 seconds"))
                yield* fixture.releaseObservationCut
                yield* fixture.setExecutorEvidence("Foreign")
                const entered = yield* Deferred.make<void>()
                const release = yield* Deferred.make<void>()
                yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.asVoid))
                const read = observation.traceReader.readOccurrencesAt
                if (read === undefined) return expect.fail("production history reader required")
                let holdHistory = false
                const samples: Array<number> = []
                const clientSamples: Array<number> = []
                const receivedAt = new Map<string, number>()
                const listener = yield* serveRunningHost(address, {
                  ...observation,
                  traceReader: {
                    ...observation.traceReader,
                    readOccurrencesAt: (...args) =>
                      (holdHistory
                        ? Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)))
                        : Effect.void
                      ).pipe(Effect.andThen(read(...args)))
                  },
                  executeAttachedCommand: (request) =>
                    Effect.sync(() => {
                      const received = receivedAt.get(request.requestId)
                      if (received === undefined) throw new Error("Missing exact server receipt timing")
                      samples.push(performance.now() - received)
                    }).pipe(Effect.andThen(observation.executeAttachedCommand(request)))
                })
                // Observe headers/body without replacing the production handler. Correlation
                // uses the exact request ID; historical requests cannot overwrite this clock.
                listener.server.prependListener("request", (incoming) => {
                  const received = performance.now()
                  if (incoming.method !== "POST" || incoming.url !== "/dalph/v1/request") return
                  let input = ""
                  incoming.on("data", (chunk: Buffer) => {
                    input += chunk.toString("utf8")
                  })
                  incoming.on("end", () => {
                    const request = JSON.parse(input) as { requestId: string }
                    receivedAt.set(request.requestId, received)
                  })
                })
                const runId = observation.selection.runId
                const records = yield* fixture.readHistory(runId)
                let last = records.at(-1)
                if (last === undefined) return expect.fail("paused history required")
                const evidencePath = process.env["DALPH_RUN_CONTROL_PROFILE_OUTPUT"]
                const recordProgress = (phase: string) =>
                  evidencePath === undefined
                    ? Effect.void
                    : fileSystem.writeFileString(evidencePath + ".progress", JSON.stringify({ phase, profileResults }))
                for (const profile of ["Idle", "BusyHistory", "ExpandingHistory"] as const) {
                  yield* recordProgress(profile + ": starting")
                  if (profile === "BusyHistory") {
                    holdHistory = true
                    yield* callRunningHost(address, runId, {
                      _tag: "ReadOccurrencePage",
                      prefix: TraceCursor.make({ runId, position: last.position }),
                      continuation: null,
                      capacityBytes: OccurrencePageCapacity.make(8192)
                    }).pipe(Effect.forkScoped)
                    yield* Deferred.await(entered).pipe(Effect.timeout("5 seconds"))
                  }
                  if (profile === "ExpandingHistory") {
                    holdHistory = false
                    yield* Deferred.succeed(release, undefined)
                    const bootstrap = yield* fixture.bootstrap
                    for (let record = 0; record < 256; record++)
                      yield* bootstrap.operatorControl.applyControlDirection({
                        direction: "Pause",
                        subject: { _tag: "Run", runId }
                      })
                    last = (yield* fixture.readHistory(runId)).at(-1)
                    if (last === undefined) return expect.fail("expanded history required")
                  }
                  for (const operation of ["Pause", "Cancel"] as const) {
                    yield* recordProgress(profile + ": " + operation)
                    samples.length = 0
                    clientSamples.length = 0
                    for (let sample = 0; sample < 20; sample++) {
                      if (profile === "ExpandingHistory")
                        yield* callRunningHost(address, runId, {
                          _tag: "ReadOccurrencePage",
                          prefix: TraceCursor.make({ runId, position: last.position }),
                          continuation: null,
                          capacityBytes: OccurrencePageCapacity.make(8192)
                        }).pipe(Effect.forkScoped)
                      const began = performance.now()
                      expect(yield* callRunningHost(address, runId, { _tag: operation })).toMatchObject({
                        result: { value: { _tag: operation === "Pause" ? "PauseApplied" : "CancelApplied" } }
                      })
                      clientSamples.push(performance.now() - began)
                    }
                    const ordered = samples.toSorted((a, b) => a - b)
                    expect(ordered).toHaveLength(20)
                    const p95 = ordered[18]
                    if (p95 === undefined) return expect.fail("twenty admission measurements required")
                    profileResults.push({
                      profile,
                      operation,
                      runtime: process.version,
                      platform: process.platform,
                      architecture: process.arch,
                      sampleCount: 20,
                      historicalRead:
                        profile === "Idle"
                          ? "None"
                          : profile === "BusyHistory"
                            ? "HeldBeforePreparation"
                            : "ConcurrentNativePreparation",
                      historicalControlRecordsAdded: profile === "ExpandingHistory" ? 256 : 0,
                      historyCapacityBytes: 8192,
                      localAdmissionMillis: [...samples],
                      clientHandshakeThroughApplicationMillis: [...clientSamples],
                      timingBoundary:
                        "Server request headers received to host-owned command entry; excludes client handshake and durable application",
                      localAdmissionP95Millis: p95,
                      provisionalTargetMillis: 100,
                      targetMet: p95 <= 100,
                      providerLatency:
                        "Excluded from admission timing; foreign executor responsibility remains retained",
                      provisionalCooperativeQuantumMillis: 10
                    })
                  }
                }
                expect((yield* fixture.provider.snapshot()).activeClaimCount).toBe(1)
                expect(profileResults).toHaveLength(6)
                if (evidencePath !== undefined)
                  yield* fileSystem.writeFileString(evidencePath, JSON.stringify(profileResults, null, 2) + "\n")
                yield* recordProgress("Complete")
                expect(profileResults.every((result) => result["targetMet"] === true)).toBe(true)
                yield* fixture.setExecutorEvidence("Ordinary")
                yield* Deferred.succeed(release, undefined)
              })
            ),
          "Run",
          "Listening"
        )
      })
    ).pipe(Effect.provide(runningHostFixtureLayer)),
  180000
)

it.live(
  "attached cancellation settles an executing attempt through exact stop abandonment and claim release",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const armed = yield* Ref.make(false)
        const providerEntered = yield* Deferred.make<void>()
        const providerRelease = yield* Deferred.make<void>()
        yield* Effect.addFinalizer(() => Deferred.succeed(providerRelease, undefined).pipe(Effect.asVoid))
        const fixture = yield* makeRunningHostFixture(
          builtEntry,
          false,
          undefined,
          {
            beforeExecutorRead: () =>
              Ref.get(armed).pipe(
                Effect.flatMap((hold) =>
                  hold
                    ? Deferred.succeed(providerEntered, undefined).pipe(Effect.andThen(Deferred.await(providerRelease)))
                    : Effect.void
                )
              )
          },
          true
        )
        const address = yield* availableLocalHostAddress
        yield* withDecodedProductionRepositoryHost(
          fixture.configuration,
          fixture.graph,
          (observation) =>
            Effect.scoped(
              Effect.gen(function* () {
                yield* serveRunningHost(address, observation)
                yield* Deferred.await(fixture.turnEntered).pipe(Effect.timeout("15 seconds"))
                yield* Deferred.await(fixture.activationFinalizing).pipe(Effect.timeout("15 seconds"))
                yield* fixture.releaseObservationCut
                const runId = observation.selection.runId
                expect(yield* callRunningHost(address, runId, { _tag: "Pause" })).toMatchObject({
                  result: { value: { _tag: "PauseApplied" } }
                })
                yield* Ref.set(armed, true)
                const received = yield* Deferred.make<void>()
                const apply = yield* Deferred.make<void>()
                const applied = yield* Deferred.make<void>()
                const reply = yield* Deferred.make<void>()
                // Admission, durable application and settlement are separately observed.
                const secondAddress = yield* availableLocalHostAddress
                yield* serveRunningHost(secondAddress, {
                  ...observation,
                  executeAttachedCommand: (request) =>
                    Deferred.succeed(received, undefined).pipe(
                      Effect.andThen(Deferred.await(apply)),
                      Effect.andThen(observation.executeAttachedCommand(request)),
                      Effect.tap(() => Deferred.succeed(applied, undefined)),
                      Effect.tap(() => Deferred.await(reply))
                    )
                })
                yield* Effect.addFinalizer(() =>
                  Effect.all([Deferred.succeed(apply, undefined), Deferred.succeed(reply, undefined)]).pipe(
                    Effect.asVoid
                  )
                )
                const command = yield* callRunningHost(secondAddress, runId, { _tag: "Cancel" }).pipe(Effect.forkScoped)
                yield* Deferred.await(received).pipe(Effect.timeout("5 seconds"))
                expect(
                  (yield* fixture.readHistory(runId)).some(({ event }) => event._tag === "RunCancellationApplied")
                ).toBe(false)
                yield* Deferred.succeed(apply, undefined)
                yield* Deferred.await(applied).pipe(Effect.timeout("5 seconds"))
                const pending = yield* fixture.readHistory(runId)
                expect(pending.some(({ event }) => event._tag === "RunCancellationApplied")).toBe(true)
                expect(pending.some(({ event }) => event._tag === "WorkflowRunTerminated")).toBe(false)
                expect((yield* fixture.provider.snapshot()).activeClaimCount).toBe(1)
                yield* Deferred.succeed(reply, undefined)
                expect(yield* Fiber.join(command)).toMatchObject({ result: { value: { _tag: "CancelApplied" } } })
                yield* Deferred.await(providerEntered).pipe(Effect.timeout("5 seconds"))
                yield* Deferred.succeed(providerRelease, undefined)
                expect(yield* observation.runTermination.await.pipe(Effect.timeout("15 seconds"))).toMatchObject({
                  disposition: "Cancelled"
                })
                const settled = yield* fixture.readHistory(runId)
                const tags = settled.map(({ event }) => event._tag)
                const stoppedAt = tags.indexOf("PlannedAttemptExecutorWorkReported")
                const abandonedAt = tags.indexOf("CancelledAttemptImplementationAbandoned")
                const releasedAt = tags.lastIndexOf("TaskClaimReleased")
                expect(stoppedAt).toBeGreaterThan(-1)
                expect(abandonedAt).toBeGreaterThan(stoppedAt)
                expect(releasedAt).toBeGreaterThan(abandonedAt)
                expect(tags.indexOf("WorkflowRunTerminated")).toBeGreaterThan(releasedAt)
                expect((yield* fixture.provider.snapshot()).activeClaimCount).toBe(0)
                const cassette = yield* projectRecordedCassette(settled)
                expect(
                  verifyRecordedCassetteRoundTrip(settled, cassette).every(
                    (checkpoint) => checkpoint.workflowHistoryEquivalent
                  )
                ).toBe(true)
              })
            ),
          "Run",
          "Listening"
        )
      })
    ).pipe(Effect.provide(runningHostFixtureLayer)),
  60000
)
