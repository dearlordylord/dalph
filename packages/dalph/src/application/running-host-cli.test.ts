import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Cause, Deferred, Effect, Fiber, Layer, Option, Ref } from "effect"
import { TestClock } from "effect/testing"
import { Command } from "effect/unstable/cli"
import { expect } from "vitest"
import { availableLocalHostAddress, makeRunningHostReadProbe } from "../../test-support/running-host-read-probe.js"
import { DalphCommandExit } from "./command-exit.js"
import { makeRunningHostCommands, RunningHostCliOutput } from "./running-host-cli.js"
import { serveRunningHost } from "./running-host-http.js"

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

it.live("the public CLI reads the selected host and emits failures without acquiring production services", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const probe = yield* makeRunningHostReadProbe()
      const address = yield* availableLocalHostAddress
      yield* serveRunningHost(address, probe.observation)
      const lines = yield* Ref.make<ReadonlyArray<{ text: string; channel: string }>>([])
      const run = application(
        Layer.succeed(RunningHostCliOutput, {
          writeLine: (text, channel) => Ref.update(lines, (prior) => [...prior, { text, channel }])
        })
      )
      for (const name of ["descriptor", "snapshot", "control"]) {
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
      expect(successful).toHaveLength(3)
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
      for (const args of [
        ["attach", "descriptor", "--host", address],
        ["attach", "snapshot", "--host", address, "--run", probe.runId],
        ["attach", "control", "--host", "http://localhost:1234", "--run", probe.runId, "--json"],
        ["attach", "control", "--host", address, "--run", "wrong", "--json"],
        ["mcp", "--host", "http://localhost:1234", "--run", probe.runId]
      ]) {
        const failure = yield* run(args).pipe(Effect.flip)
        expect(failure).toBeInstanceOf(DalphCommandExit)
        expect(failure).toMatchObject({ status: 2 })
      }
      expect(yield* Ref.get(probe.reads)).toBe(1)
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
