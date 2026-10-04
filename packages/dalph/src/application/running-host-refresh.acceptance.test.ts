/* eslint-disable import/no-nodejs-modules -- Acceptance exercises actual attached CLI/MCP processes against one production host. */
import { execFile } from "node:child_process"
import process from "node:process"
import { fileURLToPath } from "node:url"
import { RunId, TaskId } from "@dalph/contracts"
import { attachCurrentSignal, JournalPosition, TraceCursor, type JournalRecord } from "@dalph/orchestrator"
import { it } from "@effect/vitest"
import { Deferred, Duration, Effect, Fiber, Option, Queue, Ref, Schema, Stream } from "effect"
import { TestClock } from "effect/testing"
import { expect } from "vitest"
import { availableLocalHostAddress, makeRunningHostReadProbe } from "../../test-support/running-host-read-probe.js"
import { makeRunningHostFixture, runningHostFixtureLayer } from "../../test-support/production-running-host-fixture.js"
import { withDecodedProductionRepositoryHost, type ProductionRunningHostObservation } from "./production-host.js"
import { runningHostFailureEnvelope, RunningHostEnvelope, type RefreshInterest } from "./running-host-contract.js"
import { callRunningHost } from "./running-host-client.js"
import { serveRunningHost } from "./running-host-http.js"
import { projectRecordedCassette, verifyRecordedCassetteRoundTrip } from "../cassettes/recorded.js"
import { ProductionRunReactivationInterval } from "./production.js"

const builtEntry = fileURLToPath(new URL("../../dist/bin/dalph.js", import.meta.url))
class RefreshClientFailure extends Schema.TaggedError<RefreshClientFailure>()("RefreshClientFailure", {
  detail: Schema.String
}) {}
const invoke = (
  adapter: "CLI" | "MCP",
  address: string,
  runId: RunId,
  interest: RefreshInterest,
  configuredRunId: RunId = runId
) =>
  Effect.tryPromise({
    try: (signal) =>
      new Promise<string>((resolve, reject) => {
        const args =
          adapter === "CLI"
            ? [
                "attach",
                "refresh",
                "--host",
                address,
                "--run",
                runId,
                "--json",
                ...(interest._tag === "WholeGraph"
                  ? ["--whole-graph"]
                  : interest.taskIds.flatMap((id) => ["--task", id]))
              ]
            : ["mcp", "--host", address, "--run", configuredRunId]
        const child = execFile(
          process.execPath,
          [builtEntry, ...args],
          { signal, timeout: 15000 },
          (error, stdout, stderr) =>
            error === null || typeof error.code === "number"
              ? resolve(stdout)
              : reject(new Error(`${stderr}: ${stdout}`))
        )
        child.stdin?.end(
          adapter === "CLI"
            ? ""
            : [
                {
                  jsonrpc: "2.0",
                  id: 1,
                  method: "initialize",
                  params: {
                    protocolVersion: "2025-11-25",
                    capabilities: {},
                    clientInfo: { name: "refresh", version: "1" }
                  }
                },
                { jsonrpc: "2.0", method: "notifications/initialized" },
                {
                  jsonrpc: "2.0",
                  id: 2,
                  method: "tools/call",
                  params: { name: "dalph_refresh", arguments: { runId, interest } }
                }
              ]
                .map((message) => JSON.stringify(message))
                .join("\n") + "\n"
        )
      }),
    catch: (error) => new RefreshClientFailure({ detail: String(error) })
  }).pipe(
    Effect.map((stdout) => {
      const replies = stdout
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
      const reply =
        replies.find((reply) => reply.result?.structuredContent !== undefined || reply.error?.data !== undefined) ??
        replies.at(-1)
      return Schema.decodeUnknownSync(RunningHostEnvelope)(
        adapter === "CLI"
          ? reply
          : (reply.result?.structuredContent ??
              ("result" in reply.error.data ? reply.error.data : runningHostFailureEnvelope(null, reply.error.data)))
      )
    })
  )
const waitHistory = (
  observation: ProductionRunningHostObservation<unknown>,
  predicate: (tags: ReadonlyArray<string>) => boolean
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const history = yield* attachCurrentSignal(observation.acceptedHistory)
      const has = (cursor: typeof history.current) =>
        observation.traceReader
          .readAt(cursor)
          .pipe(Effect.map((trace) => predicate(trace.items.map(({ occurrence }) => occurrence._tag))))
      if (yield* has(history.current)) return
      yield* history.changes.pipe(Stream.filterEffect(has), Stream.runHead)
    })
  ).pipe(Effect.timeout("20 seconds"))
const graphIntents = (records: ReadonlyArray<JournalRecord>) =>
  records.filter(
    ({ event }) => event._tag === "TaskTrackerReadIntentRecorded" && event.operation._tag === "ReadTrackerGraph"
  )

for (const adapter of ["CLI", "MCP"] as const) {
  it.effect(
    `${adapter} public refresh preserves durable Pause without timer, polling, journal append or fresh work`,
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const timers = yield* Ref.make<ReadonlyArray<string>>([])
          const fixture = yield* makeRunningHostFixture(builtEntry, true, {
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
                  const before = yield* fixture.readPausedHistory
                  for (const interest of [
                    { _tag: "WholeGraph" as const },
                    {
                      _tag: "AdvisoryTasks" as const,
                      taskIds: [TaskId.make("outside-root"), TaskId.make("E")] as const
                    }
                  ]) {
                    expect(yield* invoke(adapter, address, observation.selection.runId, interest)).toMatchObject({
                      result: { _tag: "Success", value: { _tag: "RefreshSubmitted", interest } }
                    })
                  }
                  expect(
                    yield* callRunningHost(address, observation.selection.runId, { _tag: "ReadRunControl" })
                  ).toMatchObject({ result: { value: { _tag: "RunPaused" } } })
                  yield* TestClock.adjust("2 hours")
                  expect(yield* fixture.readPausedHistory).toEqual(before)
                  expect(yield* Ref.get(timers)).toEqual([])
                  expect(yield* Ref.get(fixture.trackerCalls)).toBe(0)
                  expect(yield* Ref.get(fixture.gitCalls)).toBe(0)
                  expect(yield* Deferred.isDone(fixture.turnEntered)).toBe(false)
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

for (const source of ["CLIWhole", "CLIAdvisory", "MCPWhole", "MCPAdvisory", "Timer", "Startup", "Coalesced"] as const) {
  it.effect(
    `tracker edits appear through ${source} as complete qualified E-to-C facts, independently of submission`,
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const armed = yield* Ref.make(false)
          const entered = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          const idle = yield* Queue.unbounded<void>()
          const fixture = yield* makeRunningHostFixture(builtEntry, true, undefined, {
            startupIncludesE: source === "Startup",
            onActivationIdle: () => Queue.offer(idle, undefined).pipe(Effect.asVoid),
            onRootGraphRead: () =>
              Ref.getAndSet(armed, false).pipe(
                Effect.flatMap((hold) =>
                  hold
                    ? Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)))
                    : Effect.void
                )
              )
          })
          const address = yield* availableLocalHostAddress
          yield* withDecodedProductionRepositoryHost(
            { ...fixture.configuration, activationInterval: ProductionRunReactivationInterval.make(Duration.hours(1)) },
            fixture.graph,
            (observation) =>
              Effect.scoped(
                Effect.gen(function* () {
                  yield* serveRunningHost(address, observation)
                  yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.asVoid))
                  yield* Deferred.await(fixture.turnEntered).pipe(Effect.timeout("20 seconds"))
                  yield* waitHistory(observation, (tags) => tags.includes("PlannedAttemptExecutorWorkReported"))
                  yield* Deferred.await(fixture.activationFinalizing).pipe(Effect.timeout("20 seconds"))
                  yield* fixture.releaseObservationCut
                  yield* Queue.take(idle).pipe(Effect.timeout("20 seconds"))
                  const before = yield* fixture.readHistory(observation.selection.runId)
                  if (source !== "Startup") {
                    yield* fixture.authorE
                    yield* Ref.set(armed, true)
                    if (source === "Timer") yield* TestClock.adjust("1 hour")
                    else {
                      const interest: RefreshInterest = source.endsWith("Whole")
                        ? { _tag: "WholeGraph" }
                        : {
                            _tag: "AdvisoryTasks",
                            taskIds: [
                              fixture.taskIds[2] ?? TaskId.make("C"),
                              fixture.taskIds[3] ?? TaskId.make("E"),
                              TaskId.make("outside-root")
                            ]
                          }
                      const result = yield* invoke(
                        source.startsWith("CLI") ? "CLI" : "MCP",
                        address,
                        observation.selection.runId,
                        interest
                      )
                      expect(result).toMatchObject({
                        result: { _tag: "Success", value: { _tag: "RefreshSubmitted", interest } }
                      })
                    }
                    yield* Deferred.await(entered).pipe(Effect.timeout("20 seconds"))
                    const held = yield* fixture.readHistory(observation.selection.runId)
                    expect(graphIntents(held).length).toBeGreaterThan(graphIntents(before).length)
                    const snapshot = yield* callRunningHost(address, observation.selection.runId, {
                      _tag: "ReadSnapshot"
                    })
                    expect(JSON.stringify(snapshot)).not.toContain("running-host-E")
                    if (source === "Coalesced") {
                      for (const adapter of ["CLI", "MCP", "CLI", "MCP"] as const)
                        expect(
                          yield* invoke(adapter, address, observation.selection.runId, { _tag: "WholeGraph" })
                        ).toMatchObject({ result: { value: { _tag: "RefreshSubmitted" } } })
                      expect(graphIntents(yield* fixture.readHistory(observation.selection.runId))).toHaveLength(
                        graphIntents(held).length
                      )
                    }
                    yield* Deferred.succeed(release, undefined)
                    yield* Queue.take(idle).pipe(Effect.timeout("20 seconds"))
                  }
                  const publications = yield* attachCurrentSignal(observation.current)
                  const includesE = (state: typeof publications.current) =>
                    state._tag === "Ready" &&
                    state.evaluation.current.trackerGraph._tag === "GraphEstablished" &&
                    state.evaluation.current.trackerGraph.observation.snapshot
                      .taskIds()
                      .includes(fixture.taskIds[3] ?? TaskId.make("missing"))
                  const snapshots = Stream.concat(Stream.make(publications.current), publications.changes).pipe(
                    Stream.filter(includesE),
                    Stream.mapEffect(() =>
                      callRunningHost(address, observation.selection.runId, { _tag: "ReadSnapshot" })
                    ),
                    Stream.filter(
                      (envelope) =>
                        envelope.result._tag === "Success" &&
                        envelope.result.value._tag === "Ready" &&
                        envelope.result.value.graph._tag === "GraphEstablished" &&
                        envelope.result.value.graph.snapshot.tasks.some(({ id }) => id === fixture.taskIds[3])
                    )
                  )
                  const snapshot = Option.getOrThrow(
                    yield* snapshots.pipe(Stream.runHead, Effect.timeout("20 seconds"))
                  )
                  const records = yield* fixture.readHistory(observation.selection.runId)
                  const observations = records.filter(
                    ({ event }) =>
                      event._tag === "TaskTrackerFactsObserved" && event.observation._tag === "CompleteTaskTrackerFacts"
                  )
                  expect(observations.length).toBeGreaterThan(0)
                  const discovered = observations.find(
                    ({ event }) =>
                      event._tag === "TaskTrackerFactsObserved" &&
                      event.observation._tag === "CompleteTaskTrackerFacts" &&
                      event.observation.factFamilies[0].taskIds.includes(fixture.taskIds[3] ?? TaskId.make("missing"))
                  )
                  if (
                    discovered?.event._tag !== "TaskTrackerFactsObserved" ||
                    discovered.event.observation._tag !== "CompleteTaskTrackerFacts"
                  )
                    return yield* Effect.die("complete E observation was not recorded")
                  expect(discovered.event.observation.rootTaskId).toBe(fixture.taskIds[0])
                  expect(discovered.event.observation.target).toEqual(fixture.configuration.target)
                  const operationId = discovered.event.observation.operationId
                  const intent = graphIntents(records).find(
                    ({ event }) =>
                      event._tag === "TaskTrackerReadIntentRecorded" && event.operation.operationId === operationId
                  )
                  expect(intent?.position).toBeLessThan(discovered.position)
                  for (const family of discovered.event.observation.factFamilies)
                    expect(family.coverage).toMatchObject({
                      _tag: "CompleteTargetClosure",
                      target: fixture.configuration.target
                    })
                  expect(discovered.event.observation.factFamilies[2].prerequisites).toContainEqual({
                    taskId: fixture.taskIds[2],
                    prerequisiteTaskIds: expect.arrayContaining([fixture.taskIds[3]])
                  })
                  if (source === "Coalesced")
                    expect(
                      graphIntents(records).filter(
                        ({ event }) =>
                          event._tag === "TaskTrackerReadIntentRecorded" &&
                          event.operation._tag === "ReadTrackerGraph" &&
                          event.operation.cause._tag === "ExecutingWorkAuthorityCheck"
                      ).length
                    ).toBeLessThanOrEqual(2)
                  expect(snapshot).toMatchObject({
                    result: {
                      value: {
                        _tag: "Ready",
                        graph: {
                          _tag: "GraphEstablished",
                          snapshot: {
                            tasks: expect.arrayContaining([
                              expect.objectContaining({
                                id: fixture.taskIds[2],
                                prerequisiteIds: expect.arrayContaining([fixture.taskIds[3]])
                              }),
                              expect.objectContaining({ id: fixture.taskIds[3] })
                            ])
                          }
                        }
                      }
                    }
                  })
                  expect(JSON.stringify(snapshot)).not.toContain("outside-root")
                  expect(
                    records.filter(
                      ({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended" && event.command === "Begin"
                    )
                  ).toHaveLength(1)
                  expect(records.some(({ event }) => event._tag === "WorkflowRunTerminated")).toBe(false)
                  const trackerRefreshDiscoveryPrefix = yield* projectRecordedCassette(records)
                  expect(
                    verifyRecordedCassetteRoundTrip(records, trackerRefreshDiscoveryPrefix).every(
                      (checkpoint) =>
                        checkpoint.workflowHistoryEquivalent &&
                        checkpoint.operationalStateEquivalent &&
                        checkpoint.pureSelectionEquivalent &&
                        checkpoint.appliedOccurrencePositionEquivalent
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
}

it.live(
  "both refresh clients reject wrong Run, closing and known terminal before notification, including exact terminal position",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const probe = yield* makeRunningHostReadProbe()
        const address = yield* availableLocalHostAddress
        const effects = yield* Ref.make(0)
        const terminal = yield* Ref.make(false)
        const terminatedAt = TraceCursor.make({ runId: probe.runId, position: JournalPosition.make(7) })
        yield* serveRunningHost(address, {
          ...probe.observation,
          readRunControl: Ref.get(terminal).pipe(
            Effect.map((closed) => ({
              direction: closed ? ("RunTerminated" as const) : ("RunUnpaused" as const),
              observedAt: terminatedAt,
              termination: closed ? { disposition: "Completed" as const, terminatedAt } : null
            }))
          ),
          executeAttachedCommand: (request) =>
            Ref.update(effects, (count) => count + 1).pipe(
              Effect.as(
                request.operation._tag === "Refresh"
                  ? { _tag: "RefreshSubmitted" as const, interest: request.operation.interest }
                  : { _tag: "WakeSubmitted" as const }
              )
            )
        })
        for (const interest of [
          { _tag: "WholeGraph" as const },
          { _tag: "AdvisoryTasks" as const, taskIds: [TaskId.make("C"), TaskId.make("E")] as const }
        ]) {
          for (const adapter of ["CLI", "MCP"] as const) {
            expect(yield* invoke(adapter, address, RunId.make("wrong"), interest, probe.runId)).toMatchObject({
              result: { error: { _tag: "RunMismatch" } }
            })
            yield* Ref.set(terminal, true)
            expect(yield* invoke(adapter, address, probe.runId, interest)).toMatchObject({
              result: { error: { _tag: "RunClosed", disposition: "Completed", terminatedAt } }
            })
            yield* Ref.set(terminal, false)
            yield* Ref.set(probe.closing, true)
            expect(yield* invoke(adapter, address, probe.runId, interest)).toMatchObject({
              result: { error: { _tag: "HostClosing" } }
            })
            yield* Ref.set(probe.closing, false)
          }
        }
        expect(yield* Ref.get(effects)).toBe(0)
      })
    ),
  60000
)

it.live(
  "native refresh clients reject malformed interest, task IDs and extra graph or root input before commands",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const probe = yield* makeRunningHostReadProbe()
        const address = yield* availableLocalHostAddress
        const commands = yield* Ref.make(0)
        yield* serveRunningHost(address, {
          ...probe.observation,
          executeAttachedCommand: () =>
            Ref.update(commands, (count) => count + 1).pipe(Effect.as({ _tag: "WakeSubmitted" as const }))
        })
        const runRaw = (args: ReadonlyArray<string>, input = "") =>
          Effect.tryPromise({
            try: (signal) =>
              new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
                const child = execFile(
                  process.execPath,
                  [builtEntry, ...args],
                  { signal, timeout: 10000 },
                  (error, stdout, stderr) =>
                    resolve({
                      status: error === null ? 0 : typeof error.code === "number" ? error.code : null,
                      stdout,
                      stderr
                    })
                )
                child.stdin?.end(input)
              }),
            catch: (error) => new RefreshClientFailure({ detail: String(error) })
          })
        for (const flags of [
          [],
          ["--whole-graph", "--task", "C"],
          ["--task", ""],
          ["--task", "C", "--task", "C"],
          ["--whole-graph", "--root", "E"],
          ["--whole-graph", "--graph", "{}"]
        ]) {
          const reply = yield* runRaw([
            "attach",
            "refresh",
            "--host",
            address,
            "--run",
            probe.runId,
            "--json",
            ...flags
          ])
          expect(reply.status).not.toBe(0)
          if (!flags.includes("--root") && !flags.includes("--graph"))
            expect(JSON.parse(reply.stdout)).toMatchObject({ result: { error: { _tag: "InvalidRequest" } } })
          expect(yield* Ref.get(commands)).toBe(0)
          expect(yield* Ref.get(probe.reads)).toBe(0)
        }
        for (const args of [
          { runId: probe.runId, interest: { _tag: "Unknown" } },
          { runId: probe.runId, interest: { _tag: "AdvisoryTasks", taskIds: [""] } },
          { runId: probe.runId, interest: { _tag: "AdvisoryTasks", taskIds: [1] } },
          { runId: probe.runId, interest: { _tag: "AdvisoryTasks", taskIds: [] } },
          { runId: probe.runId, interest: { _tag: "AdvisoryTasks", taskIds: ["C", "C"] } },
          { runId: probe.runId, interest: { _tag: "WholeGraph", taskIds: ["C"] } },
          { runId: probe.runId, interest: { _tag: "WholeGraph" }, root: "E" },
          { runId: probe.runId, interest: { _tag: "WholeGraph" }, graph: {} },
          { runId: "", interest: { _tag: "WholeGraph" } }
        ]) {
          const input =
            [
              {
                jsonrpc: "2.0",
                id: 1,
                method: "initialize",
                params: {
                  protocolVersion: "2025-11-25",
                  capabilities: {},
                  clientInfo: { name: "invalid", version: "1" }
                }
              },
              { jsonrpc: "2.0", method: "notifications/initialized" },
              { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "dalph_refresh", arguments: args } }
            ]
              .map((message) => JSON.stringify(message))
              .join("\n") + "\n"
          const reply = yield* runRaw(["mcp", "--host", address, "--run", probe.runId], input)
          expect(reply.status).toBe(0)
          expect(JSON.parse(reply.stdout.trim().split("\n").at(-1) ?? "")).toMatchObject({ error: { code: -32602 } })
          expect(yield* Ref.get(commands)).toBe(0)
          expect(yield* Ref.get(probe.reads)).toBe(0)
        }
      })
    ),
  60000
)

for (const adapter of ["CLI", "MCP"] as const) {
  it.live(
    `${adapter} refresh racing a stopped owner may remain Submitted without terminal append or tracker effect`,
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const entered = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          const stopped = yield* Deferred.make<void>()
          const fixture = yield* makeRunningHostFixture(builtEntry, false, undefined, {
            onTimerStateChange: (state) =>
              state === "Stopped" ? Deferred.succeed(stopped, undefined).pipe(Effect.asVoid) : Effect.void
          })
          const address = yield* availableLocalHostAddress
          yield* withDecodedProductionRepositoryHost(
            fixture.configuration,
            fixture.graph,
            (observation) =>
              Effect.scoped(
                Effect.gen(function* () {
                  yield* serveRunningHost(address, {
                    ...observation,
                    readRunControl: observation.readRunControl.pipe(
                      Effect.tap(() =>
                        Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)))
                      )
                    )
                  })
                  yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.asVoid))
                  yield* Deferred.await(fixture.turnEntered).pipe(Effect.timeout("20 seconds"))
                  const client = yield* invoke(adapter, address, observation.selection.runId, {
                    _tag: "WholeGraph"
                  }).pipe(Effect.forkChild)
                  yield* Deferred.await(entered).pipe(Effect.timeout("10 seconds"))
                  yield* fixture.release
                  expect(yield* observation.runTermination.await.pipe(Effect.timeout("20 seconds"))).toMatchObject({
                    disposition: "Completed"
                  })
                  yield* Deferred.await(stopped).pipe(Effect.timeout("5 seconds"))
                  const before = yield* fixture.readHistory(observation.selection.runId)
                  const calls = yield* Ref.get(fixture.trackerCalls)
                  yield* Deferred.succeed(release, undefined)
                  expect(yield* Fiber.join(client)).toMatchObject({
                    result: { value: { _tag: "RefreshSubmitted", interest: { _tag: "WholeGraph" } } }
                  })
                  expect(yield* fixture.readHistory(observation.selection.runId)).toEqual(before)
                  expect(yield* Ref.get(fixture.trackerCalls)).toBe(calls)
                  expect(before.at(-1)).toMatchObject({
                    event: { _tag: "WorkflowRunTerminated", disposition: "Completed" }
                  })
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
