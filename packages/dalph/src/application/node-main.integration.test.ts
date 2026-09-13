/* eslint-disable import/no-nodejs-modules -- This integration test controls a real Node child signal boundary. */
import nodeProcess from "node:process"
import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Deferred, Effect, Fiber, Ref, Schema, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { expect } from "vitest"

const fixture = new URL("../../dist/bin/node-main-signal-fixture.js", import.meta.url).pathname
const dalphPackageDirectory = new URL("../../", import.meta.url).pathname
const FixtureEvent = Schema.Struct({ event: Schema.String })

const assertFailureChannels = (application: string, expectedStderr: string, unavailable = false) =>
  Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const script = `
        import nodeProcess from "node:process";
        import { closeSync } from "node:fs";
        import { Effect } from "effect";
        import { OperationId, TaskTrackerMutationThrottled } from "@dalph/orchestrator";
        import { runDalphNodeMain } from "./dist/src/application/node-main.js";
        const privateSentinel = "private-provider-payload-must-not-be-printed";
        ${unavailable ? 'nodeProcess.stderr.on("error", () => {}); closeSync(2);' : ""}
        runDalphNodeMain(${application});
      `
      const handle = yield* spawner.spawn(
        ChildProcess.make(nodeProcess.execPath, ["--input-type=module", "--eval", script], {
          cwd: dalphPackageDirectory
        })
      )
      const [stdout, stderr, exitCode] = yield* Effect.all(
        [
          handle.stdout.pipe(Stream.decodeText(), Stream.mkString),
          handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
          handle.exitCode
        ],
        { concurrency: "unbounded" }
      )
      expect(stdout).toBe("")
      expect(stderr).toBe(expectedStderr)
      expect(exitCode).toBe(1)
    })
  ).pipe(Effect.provide(NodeServices.layer))

const safeDiagnostic = "Dalph failed because of an unexpected runtime defect.\n"

it.live(
  "a known typed command failure adds no terminal cause dump or private payload",
  () =>
    assertFailureChannels(
      'Effect.fail(new TaskTrackerMutationThrottled({ detail: privateSentinel, operation: "AcquireTaskClaim", operationId: OperationId.make("node-main-private-throttle"), retry: null }))',
      ""
    ),
  30_000
)

it.live(
  "an unexpected defect writes only a static stderr diagnostic and fails the process",
  () => assertFailureChannels("Effect.die(new Error(privateSentinel))", safeDiagnostic),
  30_000
)

it.live(
  "a failing scoped finalizer writes only a static stderr diagnostic and fails the process",
  () =>
    assertFailureChannels(
      "Effect.scoped(Effect.addFinalizer(() => Effect.die(new Error(privateSentinel))))",
      safeDiagnostic
    ),
  30_000
)

it.live(
  "an unavailable defect diagnostic does not prevent the original failed host result",
  () => assertFailureChannels("Effect.die(new Error(privateSentinel))", "", true),
  30_000
)

it.live(
  "the shipped Node runner leaves SIGTERM to the host Exit boundary until result and scope finalization",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
        const handle = yield* spawner.spawn(
          ChildProcess.make(nodeProcess.execPath, [fixture], { cwd: dalphPackageDirectory })
        )
        const events = yield* Ref.make<ReadonlyArray<string>>([])
        const ready = yield* Deferred.make<void>()
        const exitRequested = yield* Deferred.make<void>()
        const collector = yield* handle.stdout.pipe(
          Stream.decodeText(),
          Stream.splitLines,
          Stream.mapEffect((line) => Schema.decodeUnknownEffect(Schema.fromJsonString(FixtureEvent))(line)),
          Stream.runForEach(({ event }) =>
            Ref.update(events, (current) => [...current, event]).pipe(
              Effect.andThen(
                event === "ready"
                  ? Deferred.succeed(ready, undefined)
                  : event === "exit-requested"
                    ? Deferred.succeed(exitRequested, undefined)
                    : Effect.void
              )
            )
          ),
          Effect.forkScoped
        )

        yield* Deferred.await(ready)
        yield* Effect.sync(() => {
          nodeProcess.kill(handle.pid, "SIGTERM")
        })
        yield* Deferred.await(exitRequested)
        expect(yield* handle.isRunning).toBe(true)
        yield* Stream.run(Stream.succeed(new TextEncoder().encode("release\n")), handle.stdin)
        expect(yield* handle.exitCode).toBe(0)
        yield* Fiber.join(collector)
        expect(yield* Ref.get(events)).toEqual([
          "ready",
          "exit-requested",
          "release-received",
          "exit-result:Succeeded",
          "scope-finalized"
        ])
      })
    ).pipe(Effect.provide(NodeServices.layer)),
  30_000
)

it.live(
  "the shipped Node runner fails closed when the parent ends release input",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
        const handle = yield* spawner.spawn(
          ChildProcess.make(nodeProcess.execPath, [fixture], { cwd: dalphPackageDirectory })
        )
        const events = yield* Ref.make<ReadonlyArray<string>>([])
        const ready = yield* Deferred.make<void>()
        const exitRequested = yield* Deferred.make<void>()
        const collector = yield* handle.stdout.pipe(
          Stream.decodeText(),
          Stream.splitLines,
          Stream.mapEffect((line) => Schema.decodeUnknownEffect(Schema.fromJsonString(FixtureEvent))(line)),
          Stream.runForEach(({ event }) =>
            Ref.update(events, (current) => [...current, event]).pipe(
              Effect.andThen(
                event === "ready"
                  ? Deferred.succeed(ready, undefined)
                  : event === "exit-requested"
                    ? Deferred.succeed(exitRequested, undefined)
                    : Effect.void
              )
            )
          ),
          Effect.forkScoped
        )

        yield* Deferred.await(ready)
        yield* Effect.sync(() => {
          nodeProcess.kill(handle.pid, "SIGTERM")
        })
        yield* Deferred.await(exitRequested)
        yield* Stream.run(Stream.empty, handle.stdin)
        expect(yield* handle.exitCode).toBe(1)
        yield* Fiber.join(collector)
        expect(yield* Ref.get(events)).toEqual(["ready", "exit-requested", "exit-result:Failed", "scope-finalized"])
      })
    ).pipe(Effect.provide(NodeServices.layer)),
  30_000
)
