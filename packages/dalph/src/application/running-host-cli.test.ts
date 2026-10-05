import { NodeServices } from "@effect/platform-node"
import {
  currentSignalFromCurrentFirstStream,
  type DeliveryRuntimeObservationState,
  ControlDirectionApplicationOrdinal,
  JournalPosition,
  TraceCursor,
  RunControlPolicy,
  RunPolicyRevision,
  TaskWorkCapacity
} from "@dalph/orchestrator"
import { it } from "@effect/vitest"
import { Cause, Deferred, Effect, Encoding, Fiber, Layer, Option, Ref, Result, Stream, SubscriptionRef } from "effect"
import { TestClock } from "effect/testing"
import { Command } from "effect/unstable/cli"
import { expect } from "vitest"
import { availableLocalHostAddress, makeRunningHostReadProbe } from "../../test-support/running-host-read-probe.js"
import { DalphCommandExit } from "./command-exit.js"
import { makeRunningHostCommands, RunningHostCliOutput } from "./running-host-cli.js"
import { writeRunningHostWatchFrame } from "./running-host-http-watch.js"
import type { RunningHostWatchFrame } from "./running-host-contract.js"
import { serveRunningHost } from "./running-host-http.js"

it.live("the attached CLI reads capacity and sends the original expected revision exactly once", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const probe = yield* makeRunningHostReadProbe()
      const address = yield* availableLocalHostAddress
      const policy = RunControlPolicy.make({
        revision: RunPolicyRevision.make(7),
        taskExecutionCapacity: TaskWorkCapacity.make(1)
      })
      const calls = yield* Ref.make<ReadonlyArray<unknown>>([])
      yield* serveRunningHost(address, {
        ...probe.observation,
        readAttachedCapacity: Effect.succeed({ _tag: "CapacityRead", policy }),
        executeAttachedCommand: (request) =>
          Ref.update(calls, (all) => [...all, request.operation]).pipe(
            Effect.andThen(
              Effect.succeed({
                _tag: "CapacityApplied" as const,
                policy: RunControlPolicy.make({
                  revision: RunPolicyRevision.make(8),
                  taskExecutionCapacity: TaskWorkCapacity.make(2)
                })
              })
            )
          )
      })
      const lines = yield* Ref.make<ReadonlyArray<string>>([])
      const run = application(
        Layer.succeed(RunningHostCliOutput, { writeLine: (text) => Ref.update(lines, (all) => [...all, text]) })
      )
      const flags = ["--host", address, "--run", probe.runId, "--json"]
      yield* run(["attach", "capacity", ...flags])
      yield* run(["attach", "set-capacity", ...flags, "--capacity", "2", "--expected-revision", "7"])
      expect(yield* Ref.get(calls)).toEqual([{ _tag: "SetCapacity", capacity: 2, expectedRevision: 7 }])
      expect((yield* Ref.get(lines)).map((line) => JSON.parse(line).result)).toEqual([
        { _tag: "Success", value: { _tag: "CapacityRead", policy: { revision: 7, taskExecutionCapacity: 1 } } },
        { _tag: "Success", value: { _tag: "CapacityApplied", policy: { revision: 8, taskExecutionCapacity: 2 } } }
      ])
    })
  ).pipe(Effect.provide(NodeServices.layer))
)

const noSignals = {
  addSignalListener: () => Effect.die("attached clients cannot install host signals"),
  removeSignalListener: () => Effect.die("attached clients cannot remove host signals")
}
const application = (output: Layer.Layer<RunningHostCliOutput>) =>
  Command.runWith(
    Command.make("dalph").pipe(
      Command.withSubcommands(
        makeRunningHostCommands(
          () => Effect.die("attached clients cannot acquire a production host"),
          noSignals,
          output
        )
      )
    ),
    { version: "test" }
  )

it.live(
  "the public CLI reads, wakes and explicitly unpauses the selected host without acquiring production services",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const probe = yield* makeRunningHostReadProbe()
        const address = yield* availableLocalHostAddress
        const commands = yield* Ref.make<ReadonlyArray<string>>([])
        yield* serveRunningHost(address, {
          ...probe.observation,
          executeAttachedCommand: (request) =>
            Ref.update(commands, (all) => [...all, request.operation._tag]).pipe(
              Effect.andThen(
                Effect.succeed(
                  request.operation._tag === "StartWork"
                    ? { _tag: "WakeSubmitted" as const }
                    : {
                        _tag: "UnpauseApplied" as const,
                        ordinal: ControlDirectionApplicationOrdinal.make(1),
                        acceptedAt: TraceCursor.make({ runId: probe.runId, position: JournalPosition.make(2) })
                      }
                )
              )
            )
        })
        const lines = yield* Ref.make<ReadonlyArray<{ text: string; channel: string }>>([])
        const run = application(
          Layer.succeed(RunningHostCliOutput, {
            writeLine: (text, channel) => Ref.update(lines, (prior) => [...prior, { text, channel }])
          })
        )
        for (const name of ["descriptor", "snapshot", "control", "start", "unpause", "resume"]) {
          yield* run([
            "attach",
            name,
            "--host",
            address,
            ...(name === "descriptor" ? [] : ["--run", probe.runId]),
            "--json"
          ])
        }
        const successful = yield* Ref.get(lines)
        expect(successful).toHaveLength(6)
        expect(JSON.parse(successful[0]?.text ?? "")).toMatchObject({
          _tag: "HostDescriptor",
          selectedRun: { runId: probe.runId }
        })
        expect(JSON.parse(successful[1]?.text ?? "")).toMatchObject({
          result: { _tag: "Success", value: { _tag: "NotReady" } }
        })
        expect(JSON.parse(successful[2]?.text ?? "")).toMatchObject({
          result: { _tag: "Success", value: { _tag: "RunUnpaused" } }
        })
        expect(JSON.parse(successful[3]?.text ?? "")).toMatchObject({ result: { value: { _tag: "WakeSubmitted" } } })
        for (const line of successful.slice(4))
          expect(JSON.parse(line.text)).toMatchObject({
            result: { value: { _tag: "UnpauseApplied", ordinal: 1, acceptedAt: { runId: probe.runId, position: 2 } } }
          })
        for (const args of [
          ["attach", "descriptor", "--host", address],
          ["attach", "snapshot", "--host", address, "--run", probe.runId],
          ["attach", "control", "--host", "http://localhost:1234", "--run", probe.runId, "--json"],
          ["attach", "control", "--host", address, "--run", "wrong", "--json"],
          ["attach", "start", "--host", address, "--run", "wrong", "--json"],
          ["attach", "unpause", "--host", address, "--run", "wrong", "--json"],
          ["attach", "start", "--host", address, "--run", "", "--json"],
          ["attach", "unpause", "--host", address, "--run", "", "--json"],
          ["mcp", "--host", "http://localhost:1234", "--run", probe.runId]
        ]) {
          const failure = yield* run(args).pipe(Effect.flip)
          expect(failure).toBeInstanceOf(DalphCommandExit)
          expect(failure).toMatchObject({ status: 2 })
        }
        expect(yield* Ref.get(probe.reads)).toBe(4)
        expect(yield* Ref.get(commands)).toEqual(["StartWork", "Unpause", "Unpause"])
        expect((yield* Ref.get(lines)).at(-1)?.channel).toBe("stderr")
      })
    ).pipe(Effect.provide(NodeServices.layer))
)

it.effect("a blocked CLI writer is interrupted at five seconds with transport exit status", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>()
      const cancelled = yield* Ref.make(0)
      const run = application(
        Layer.succeed(RunningHostCliOutput, {
          writeLine: () =>
            Deferred.succeed(entered, undefined).pipe(
              Effect.andThen(Effect.never),
              Effect.ensuring(Ref.update(cancelled, (count) => count + 1))
            )
        })
      )
      const pending = yield* run(["attach", "descriptor", "--host", "http://127.0.0.1:43127"]).pipe(
        Effect.exit,
        Effect.forkScoped
      )
      yield* Deferred.await(entered)
      yield* TestClock.adjust("5 seconds")
      const result = yield* Fiber.join(pending)
      expect(result._tag).toBe("Failure")
      const error = result._tag === "Failure" ? Cause.findErrorOption(result.cause) : Option.none()
      expect(Option.getOrThrow(error)).toMatchObject({ _tag: "DalphCommandExit", status: 3 })
      expect(yield* Ref.get(cancelled)).toBe(1)
    })
  ).pipe(Effect.provide(NodeServices.layer))
)

for (const exit of ["Cancel", "BrokenStdout"] as const)
  it.live(`CLI watch ${exit} releases its source and causes no application Exit or task effect`, () =>
    Effect.scoped(
      Effect.gen(function* () {
        const probe = yield* makeRunningHostReadProbe()
        const state = yield* SubscriptionRef.make<DeliveryRuntimeObservationState>({ _tag: "NotReady" })
        const released = yield* Deferred.make<void>()
        const writing = yield* Deferred.make<void>()
        const source = currentSignalFromCurrentFirstStream(
          SubscriptionRef.changes(state).pipe(Stream.ensuring(Deferred.succeed(released, undefined)))
        )
        const address = yield* availableLocalHostAddress
        yield* serveRunningHost(address, { ...probe.observation, current: source })
        const output = Layer.succeed(RunningHostCliOutput, {
          writeLine: () =>
            Deferred.succeed(writing, undefined).pipe(
              Effect.andThen(exit === "Cancel" ? Effect.never : Effect.fail(new DalphCommandExit({ status: 3 })))
            )
        })
        const client = yield* application(output)([
          "attach",
          "watch",
          "--host",
          address,
          "--run",
          probe.runId,
          "--json"
        ]).pipe(Effect.provide(NodeServices.layer), Effect.exit, Effect.forkChild)
        yield* Deferred.await(writing)
        if (exit === "Cancel") yield* Fiber.interrupt(client)
        else {
          const result = yield* Fiber.join(client)
          expect(result._tag).toBe("Failure")
          if (result._tag === "Failure") expect(Cause.squash(result.cause)).toMatchObject({ status: 3 })
        }
        yield* Deferred.await(released).pipe(Effect.timeout("2 seconds"))
        expect(yield* Ref.get(probe.reads)).toBe(0)
        yield* SubscriptionRef.set(state, { _tag: "Closed", final: null })
        expect((yield* source.get)._tag).toBe("Closed")
      })
    )
  )

it.live("CLI emits a correlated Failure after initial current and abrupt host disconnect", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const probe = yield* makeRunningHostReadProbe()
      const address = yield* availableLocalHostAddress
      const first = yield* Deferred.make<void>()
      const frames = yield* Ref.make<ReadonlyArray<RunningHostWatchFrame>>([])
      const disconnect = yield* Ref.make<() => void>(() => undefined)
      yield* serveRunningHost(address, probe.observation, (response, frame) =>
        Ref.set(disconnect, () => {
          response.destroy()
        }).pipe(Effect.andThen(writeRunningHostWatchFrame(response, frame)))
      )
      const output = Layer.succeed(RunningHostCliOutput, {
        writeLine: (text) =>
          Effect.sync(() => JSON.parse(text) as RunningHostWatchFrame).pipe(
            Effect.flatMap((frame) => Ref.update(frames, (all) => [...all, frame])),
            Effect.andThen(Deferred.succeed(first, undefined)),
            Effect.asVoid
          )
      })
      const client = yield* application(output)([
        "attach",
        "watch",
        "--host",
        address,
        "--run",
        probe.runId,
        "--json"
      ]).pipe(Effect.provide(NodeServices.layer), Effect.exit, Effect.forkChild)
      yield* Deferred.await(first)
      yield* Effect.sync(yield* Ref.get(disconnect))
      yield* Fiber.join(client)
      const values = yield* Ref.get(frames)
      expect(values).toHaveLength(2)
      expect(values[1]?.frame).toMatchObject({ _tag: "Failure", error: { _tag: "TransportFailed" } })
      expect(values[1]?.requestId).toBe(values[0]?.requestId)
      expect(values[1]?.subscriptionId).toBe(values[0]?.subscriptionId)
      expect(values[1]?.sequence).toBe(1)
    })
  ).pipe(Effect.provide(NodeServices.layer))
)

it.live("public guidance CLI routes one exact message through host command admission", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const probe = yield* makeRunningHostReadProbe()
      const address = yield* availableLocalHostAddress
      const message = "Unicode: Привет\nexact guidance"
      const calls: Array<string> = []
      yield* serveRunningHost(address, {
        ...probe.observation,
        executeAttachedCommand: (request) =>
          Effect.sync(() => {
            expect(request.operation._tag).toBe("SendExecutorGuidance")
            if (request.operation._tag !== "SendExecutorGuidance") throw new Error("Unexpected command")
            calls.push(Result.getOrThrow(Encoding.decodeBase64String(request.operation.textBase64)))
            expect(request.operation.attemptId).toBe("selected-attempt")
            expect(request.operation.guidanceRequestId).toMatch(/^[0-9a-f-]{36}$/)
            return {
              _tag: "ExecutorGuidanceResult" as const,
              guidanceRequestId: request.operation.guidanceRequestId,
              disposition: { _tag: "Accepted" as const }
            }
          })
      })
      const lines: Array<string> = []
      const run = application(
        Layer.succeed(RunningHostCliOutput, {
          writeLine: (text) =>
            Effect.sync(() => {
              lines.push(text)
            })
        })
      )
      yield* run([
        "attach",
        "guide",
        "--host",
        address,
        "--run",
        probe.runId,
        "--attempt",
        "selected-attempt",
        "--message",
        message,
        "--json"
      ])
      expect(calls).toEqual([message])
      expect(lines).toHaveLength(1)
      expect(JSON.parse(lines[0] ?? "missing response")).toMatchObject({
        result: { _tag: "Success", value: { _tag: "ExecutorGuidanceResult", disposition: { _tag: "Accepted" } } }
      })
    })
  ).pipe(Effect.provide(NodeServices.layer))
)
