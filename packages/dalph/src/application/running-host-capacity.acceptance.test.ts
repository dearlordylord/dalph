/* eslint-disable import/no-nodejs-modules -- Acceptance kills exact client processes at real SQLite cuts. */
import { spawn } from "node:child_process"
import process from "node:process"
import { fileURLToPath } from "node:url"
import { RunPolicyRevision, TaskWorkCapacity } from "@dalph/orchestrator"
import { it } from "@effect/vitest"
import { Deferred, Effect, Fiber, Ref } from "effect"
import { expect } from "vitest"
import { makeRunningHostFixture, runningHostFixtureLayer } from "../../test-support/production-running-host-fixture.js"
import { availableLocalHostAddress } from "../../test-support/running-host-read-probe.js"
import { withDecodedProductionRepositoryHost } from "./production-host.js"
import { callRunningHost } from "./running-host-client.js"
import { serveRunningHost } from "./running-host-http.js"
import { projectRecordedCassette, verifyRecordedCassetteRoundTrip } from "../cassettes/recorded.js"

const builtEntry = fileURLToPath(new URL("../../dist/bin/dalph.js", import.meta.url))
const startCapacityClient = Effect.fn("CapacityTest.startClient")(function* (
  adapter: "CLI" | "MCP",
  address: string,
  runId: string
) {
  const args =
    adapter === "CLI"
      ? [
          "attach",
          "set-capacity",
          "--host",
          address,
          "--run",
          runId,
          "--capacity",
          "2",
          "--expected-revision",
          "1",
          "--json"
        ]
      : ["mcp", "--host", address, "--run", runId]
  const child = spawn(process.execPath, [builtEntry, ...args], { stdio: ["pipe", "pipe", "pipe"] })
  const closed = yield* Deferred.make<void>()
  child.once("close", () => Effect.runSync(Deferred.succeed(closed, undefined)))
  child.stdout.resume()
  child.stderr.resume()
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM")
    }).pipe(Effect.andThen(Deferred.await(closed)))
  )
  if (adapter === "MCP")
    child.stdin.write(
      [
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-11-25",
            capabilities: {},
            clientInfo: { name: "capacity-test", version: "1" }
          }
        },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "dalph_set_capacity", arguments: { runId, capacity: 2, expectedRevision: 1 } }
        }
      ]
        .map((value) => JSON.stringify(value))
        .join("\n") + "\n"
    )
  return Effect.sync(() => {
    expect(child.kill("SIGTERM")).toBe(true)
  }).pipe(Effect.andThen(Deferred.await(closed)))
})

const waitForCapacityBoundary =
  (boundary: string, duration: "5 seconds" | "10 seconds" | "20 seconds") =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.timeoutOrElse({
        duration,
        orElse: () => Effect.fail({ _tag: "CapacityAcceptanceWaitTimedOut" as const, boundary })
      })
    )

const request = {
  _tag: "SetCapacity" as const,
  capacity: TaskWorkCapacity.make(2),
  expectedRevision: RunPolicyRevision.make(1)
}

for (const adapter of ["CLI", "MCP"] as const) {
  for (const cut of ["AfterInsert", "AfterCommit", "AfterCompletion"] as const) {
    it.live(
      `${adapter} loses capacity response at SQLite ${cut} and exact retry conflicts without another change`,
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const holdGraph = yield* Ref.make(false)
            const graphEntered = yield* Deferred.make<void>()
            const graphRelease = yield* Deferred.make<void>()
            const idleCalls = yield* Ref.make(0)
            const settled = yield* Deferred.make<void>()
            const armed = yield* Ref.make(false)
            const entered = yield* Deferred.make<void>()
            const completed = yield* Deferred.make<void>()
            const release = yield* Deferred.make<void>()
            const storageCut = Ref.get(armed).pipe(
              Effect.flatMap((active) =>
                active
                  ? Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)))
                  : Effect.void
              )
            )
            const fixture = yield* makeRunningHostFixture(
              builtEntry,
              false,
              {
                ...(cut === "AfterInsert" ? { afterInsert: () => storageCut } : {}),
                ...(cut === "AfterCommit" ? { afterCommit: () => storageCut } : {})
              },
              {
                onActivationIdle: () =>
                  Ref.updateAndGet(idleCalls, (count) => count + 1).pipe(
                    Effect.flatMap((count) =>
                      count === 2 ? Deferred.succeed(settled, undefined).pipe(Effect.asVoid) : Effect.void
                    )
                  ),
                onRootGraphRead: () =>
                  Ref.get(holdGraph).pipe(
                    Effect.flatMap((hold) =>
                      hold
                        ? Deferred.succeed(graphEntered, undefined).pipe(Effect.andThen(Deferred.await(graphRelease)))
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
                    yield* Effect.addFinalizer(() =>
                      Deferred.succeed(graphRelease, undefined).pipe(
                        Effect.andThen(fixture.releaseObservationCut),
                        Effect.andThen(observation.applicationExitRequestBoundary.requestExit),
                        Effect.asVoid
                      )
                    )

                    yield* serveRunningHost(address, {
                      ...observation,
                      executeAttachedCommand: (command) =>
                        Effect.gen(function* () {
                          if (command.operation._tag === "SetCapacity") {
                            yield* Ref.set(armed, true)
                          }
                          const result = yield* observation.executeAttachedCommand(command)
                          if (command.operation._tag === "SetCapacity") {
                            if (cut === "AfterCompletion") yield* storageCut
                            yield* Deferred.succeed(completed, undefined)
                          }
                          return result
                        })
                    })
                    yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.asVoid))
                    const runId = observation.selection.runId

                    expect(yield* callRunningHost(address, runId, { _tag: "Unpause" })).toMatchObject({
                      result: { _tag: "Success" }
                    })

                    yield* Deferred.await(fixture.turnEntered).pipe(
                      waitForCapacityBoundary("ExecutorBegin", "20 seconds")
                    )

                    const before = yield* fixture.readHistory(runId)

                    yield* Deferred.await(fixture.activationFinalizing).pipe(
                      waitForCapacityBoundary("InitialActivationFinalization", "10 seconds")
                    )
                    yield* fixture.releaseObservationCut
                    yield* Deferred.await(fixture.activationIdle).pipe(
                      waitForCapacityBoundary("InitialActivationIdle", "10 seconds")
                    )
                    yield* Ref.set(holdGraph, true)
                    expect(yield* callRunningHost(address, runId, { _tag: "StartWork" })).toMatchObject({
                      result: { value: { _tag: "WakeSubmitted" } }
                    })
                    yield* Deferred.await(graphEntered).pipe(
                      waitForCapacityBoundary("ActiveCapacityLease", "10 seconds")
                    )

                    const stop = yield* startCapacityClient(adapter, address, runId)

                    yield* Deferred.await(entered).pipe(waitForCapacityBoundary("RequestedStorageCut", "10 seconds"))

                    yield* stop.pipe(waitForCapacityBoundary("ClientExit", "5 seconds"))

                    yield* Ref.set(armed, false)
                    yield* Deferred.succeed(release, undefined)

                    yield* Deferred.await(completed).pipe(
                      waitForCapacityBoundary("CapacityCommandCompletion", "10 seconds")
                    )
                    // A read is current evidence, not a receipt for the lost command.
                    expect(yield* callRunningHost(address, runId, { _tag: "ReadCapacity" })).toMatchObject({
                      result: { value: { _tag: "CapacityRead", policy: { revision: 2, taskExecutionCapacity: 2 } } }
                    })
                    expect(yield* callRunningHost(address, runId, request)).toMatchObject({
                      result: {
                        error: {
                          _tag: "PolicyRevisionConflict",
                          runId,
                          expectedRevision: 1,
                          current: { revision: 2, taskExecutionCapacity: 2 }
                        }
                      }
                    })

                    const records = yield* fixture.readHistory(runId)
                    expect(records.filter(({ event }) => event._tag === "TaskWorkCapacityChanged")).toHaveLength(1)
                    expect(records.filter(({ event }) => event._tag === "TaskAttemptPlanned")).toEqual(
                      before.filter(({ event }) => event._tag === "TaskAttemptPlanned")
                    )
                    expect(yield* Ref.get(fixture.exitCalls)).toBe(0)
                    const runningHostCapacityResponseLossPrefix = yield* projectRecordedCassette(records)
                    expect(
                      verifyRecordedCassetteRoundTrip(records, runningHostCapacityResponseLossPrefix).every(
                        (checkpoint) =>
                          checkpoint.workflowHistoryEquivalent &&
                          checkpoint.operationalStateEquivalent &&
                          checkpoint.pureSelectionEquivalent &&
                          checkpoint.appliedOccurrencePositionEquivalent
                      )
                    ).toBe(true)
                    yield* Ref.set(holdGraph, false)
                    yield* Deferred.succeed(graphRelease, undefined)
                    yield* Deferred.await(settled).pipe(
                      waitForCapacityBoundary("ActivationSettledBeforeExit", "10 seconds")
                    )
                    expect(yield* observation.applicationExitRequestBoundary.requestExit).toMatchObject({
                      _tag: "Succeeded"
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
}

it.live(
  "two capacity writers at one revision receive one accepted change and one complete conflict",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const holdGraph = yield* Ref.make(false)
        const graphEntered = yield* Deferred.make<void>()
        const graphRelease = yield* Deferred.make<void>()
        const idleCalls = yield* Ref.make(0)
        const settled = yield* Deferred.make<void>()
        const fixture = yield* makeRunningHostFixture(
          builtEntry,
          false,
          undefined,
          {
            onActivationIdle: () =>
              Ref.updateAndGet(idleCalls, (count) => count + 1).pipe(
                Effect.flatMap((count) =>
                  count === 2 ? Deferred.succeed(settled, undefined).pipe(Effect.asVoid) : Effect.void
                )
              ),
            onRootGraphRead: () =>
              Ref.get(holdGraph).pipe(
                Effect.flatMap((hold) =>
                  hold
                    ? Deferred.succeed(graphEntered, undefined).pipe(Effect.andThen(Deferred.await(graphRelease)))
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
                yield* Effect.addFinalizer(() =>
                  Deferred.succeed(graphRelease, undefined).pipe(
                    Effect.andThen(fixture.releaseObservationCut),
                    Effect.andThen(observation.applicationExitRequestBoundary.requestExit),
                    Effect.asVoid
                  )
                )
                yield* serveRunningHost(address, observation)
                yield* Deferred.await(fixture.turnEntered).pipe(waitForCapacityBoundary("ExecutorBegin", "20 seconds"))
                const runId = observation.selection.runId
                yield* Deferred.await(fixture.activationFinalizing).pipe(
                  waitForCapacityBoundary("InitialActivationFinalization", "10 seconds")
                )
                yield* fixture.releaseObservationCut
                yield* Deferred.await(fixture.activationIdle).pipe(
                  waitForCapacityBoundary("InitialActivationIdle", "10 seconds")
                )
                yield* Ref.set(holdGraph, true)
                yield* callRunningHost(address, runId, { _tag: "StartWork" })
                yield* Deferred.await(graphEntered).pipe(waitForCapacityBoundary("ActiveCapacityLease", "10 seconds"))
                const first = yield* callRunningHost(address, runId, request).pipe(Effect.forkScoped)
                const second = yield* callRunningHost(address, runId, {
                  ...request,
                  capacity: TaskWorkCapacity.make(3)
                }).pipe(Effect.forkScoped)
                const replies = yield* Effect.all([Fiber.join(first), Fiber.join(second)])
                const winners = replies.filter((reply) => reply.result._tag === "Success")
                expect(winners).toHaveLength(1)
                const winner = winners[0]
                if (winner?.result._tag !== "Success" || winner.result.value._tag !== "CapacityApplied")
                  return yield* Effect.die("missing capacity winner")
                expect(replies.filter((reply) => reply.result._tag === "Failure")).toMatchObject([
                  {
                    result: {
                      error: {
                        _tag: "PolicyRevisionConflict",
                        runId,
                        expectedRevision: 1,
                        current: winner.result.value.policy
                      }
                    }
                  }
                ])
                expect(
                  (yield* fixture.readHistory(runId)).filter(({ event }) => event._tag === "TaskWorkCapacityChanged")
                ).toHaveLength(1)
                yield* Ref.set(holdGraph, false)
                yield* Deferred.succeed(graphRelease, undefined)
                yield* Deferred.await(settled).pipe(
                  waitForCapacityBoundary("ActivationSettledBeforeExit", "10 seconds")
                )
                expect(yield* observation.applicationExitRequestBoundary.requestExit).toMatchObject({
                  _tag: "Succeeded"
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
