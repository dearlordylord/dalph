/* eslint-disable import/no-nodejs-modules -- This integration test controls a real Node child signal boundary. */
import nodeProcess from "node:process"
import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Deferred, Effect, Fiber, FileSystem, Path, Ref, Schema, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { expect } from "vitest"
import { runtimeDiagnosticByteLimit } from "./runtime-diagnostic.js"

const fixture = new URL("../../dist/bin/node-main-signal-fixture.js", import.meta.url).pathname
const dalphPackageDirectory = new URL("../../", import.meta.url).pathname
const FixtureEvent = Schema.Struct({ event: Schema.String })

const observeFailureChannels = (application: string, unavailable = false) =>
  Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const script = `
        import nodeProcess from "node:process";
        import { closeSync } from "node:fs";
        import { Effect } from "effect";
        import { OperationId, TaskTrackerMutationThrottled } from "@dalph/orchestrator";
        import { runDalphNodeMain } from "./dist/src/application/node-main.js";
        import { CodexAttemptStore, CodexAttemptStoreFailure, nodeCodexAttemptStoreLayer } from "./dist/src/application/codex-attempt-store.js";
        import { NodeServices } from "@effect/platform-node";
        import { CodexAppServerFailure } from "./dist/src/application/codex-app-server.js";
        import { DalphCommandExit } from "./dist/src/application/command-exit.js";
        const privateSentinel = "private-provider-payload-must-not-be-printed";
        ${unavailable ? 'nodeProcess.stderr.on("error", () => {}); closeSync(2);' : ""}
        runDalphNodeMain(${application});
      `
      const handle = yield* spawner.spawn(
        ChildProcess.make(nodeProcess.execPath, ["--input-type=module", "--eval", script], {
          cwd: dalphPackageDirectory,
          env: {
            ...nodeProcess.env,
            DALPH_LIVE_CONTROLLED_PROVIDER_CREDENTIAL: "controlled-codex-credential",
            GITHUB_TOKEN: "controlled-github-token"
          }
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
      return { exitCode, stderr, stdout }
    })
  ).pipe(Effect.provide(NodeServices.layer))

const assertFailureChannels = (application: string, expectedStderr: string, unavailable = false) =>
  observeFailureChannels(application, unavailable).pipe(
    Effect.tap(({ exitCode, stderr, stdout }) =>
      Effect.sync(() => {
        expect(stdout).toBe("")
        expect(stderr).toBe(expectedStderr)
        expect(exitCode).toBe(1)
      })
    )
  )

it.live(
  "a typed boundary failure emits a safe diagnostic without its private payload",
  () =>
    observeFailureChannels(
      'Effect.fail(new TaskTrackerMutationThrottled({ detail: privateSentinel, operation: "AcquireTaskClaim", operationId: OperationId.make("node-main-private-throttle"), retry: null }))'
    ).pipe(
      Effect.tap(({ exitCode, stderr, stdout }) =>
        Effect.sync(() => {
          expect(stdout).toBe("")
          expect(exitCode).toBe(1)
          expect(JSON.parse(stderr)).toMatchObject({
            boundary: "NodeMainExit",
            reasons: [
              { _tag: "Failure", error: { errorTag: "TaskTrackerMutationThrottled", operation: "AcquireTaskClaim" } }
            ]
          })
          expect(stderr).not.toContain("private-provider-payload-must-not-be-printed")
        })
      )
    ),
  30_000
)

it.live(
  "reports a private-store configuration failure before Run allocation",
  () =>
    observeFailureChannels(
      'Effect.fail(new CodexAttemptStoreFailure({ operation: "configure", detail: privateSentinel }))'
    ).pipe(
      Effect.tap(({ exitCode, stderr, stdout }) =>
        Effect.sync(() => {
          expect(stdout).toBe("")
          expect(exitCode).toBe(1)
          expect(JSON.parse(stderr)).toMatchObject({
            boundary: "NodeMainExit",
            reasons: [
              {
                _tag: "Failure",
                error: {
                  errorTag: "CodexAttemptStoreFailure",
                  operation: "configure",
                  safeMessage: expect.stringContaining("owner-only")
                }
              }
            ]
          })
          expect(stderr).not.toContain("private-provider-payload-must-not-be-printed")
          expect(stderr).not.toContain("controlled-github-token")
          expect(stderr).not.toContain("runId")
        })
      )
    ),
  30_000
)

it.live(
  "an already reported command exit adds no duplicate failure diagnostic",
  () =>
    observeFailureChannels("Effect.fail(new DalphCommandExit({ status: 2 }))").pipe(
      Effect.tap(({ exitCode, stderr, stdout }) =>
        Effect.sync(() => {
          expect(stdout).toBe("")
          expect(stderr).toBe("")
          expect(exitCode).toBe(2)
        })
      )
    ),
  30_000
)

it.live(
  "unsafe private-directory startup reports its boundary without repairing permissions",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-startup-diagnostic-" })
        const directory = path.join(root, "private")
        yield* fileSystem.makeDirectory(directory)
        yield* fileSystem.chmod(directory, 0o755)
        const observed = yield* observeFailureChannels(`Effect.gen(function* () {
      yield* CodexAttemptStore;
      nodeProcess.stdout.write("configuration-crossed");
    }).pipe(Effect.provide(nodeCodexAttemptStoreLayer({ stateDirectory: ${JSON.stringify(directory)} })), Effect.provide(NodeServices.layer))`)
        expect(observed.stdout).toBe("")
        expect(observed.exitCode).toBe(1)
        expect(JSON.parse(observed.stderr)).toMatchObject({
          reasons: [{ _tag: "Failure", error: { errorTag: "CodexAttemptStoreFailure", operation: "configure" } }]
        })
        expect(observed.stderr).not.toContain(directory)
        expect((yield* fileSystem.stat(directory)).mode & 0o777).toBe(0o755)
        expect(yield* fileSystem.readDirectory(directory)).toEqual([])
      })
    ).pipe(Effect.provide(NodeServices.layer)),
  30_000
)

it.live(
  "an unexpected defect retains useful structured cause facts without credentials or provider-private payload",
  () =>
    Effect.gen(function* () {
      const observed = yield* observeFailureChannels(`Effect.die({
        _tag: "QualificationTransportDefect",
        kind: "Unavailable",
        operation: "QualificationTransport.connect",
        safeMessage: "provider-private safe-message claim controlled-github-token",
        detail: privateSentinel,
        body: privateSentinel,
        cause: {
          _tag: "SystemError",
          code: "EAGAIN",
          syscall: "spawn",
          message: privateSentinel
        }
      })`)
      expect(observed.stdout).toBe("")
      expect(observed.exitCode).toBe(1)
      expect(new TextEncoder().encode(observed.stderr).byteLength).toBeLessThanOrEqual(runtimeDiagnosticByteLimit)
      expect(JSON.parse(observed.stderr)).toMatchObject({
        _tag: "DalphRuntimeDiagnostic",
        boundary: "NodeMainExit",
        omitted: false,
        reasons: [
          {
            _tag: "Defect",
            error: {
              category: "Unavailable",
              errorTag: "QualificationTransportDefect",
              operation: "QualificationTransport.connect",
              safeMessage: "QualificationTransport.connect failed",
              causes: [
                {
                  code: "EAGAIN",
                  errorTag: "SystemError",
                  operation: "spawn",
                  safeMessage: "spawn failed with EAGAIN",
                  syscall: "spawn"
                }
              ]
            }
          }
        ],
        version: 1
      })
      expect(observed.stderr).not.toContain("controlled-github-token")
      expect(observed.stderr).not.toContain("private-provider-payload-must-not-be-printed")
    }),
  30_000
)

it.live(
  "a failing scoped finalizer writes a structured stderr diagnostic and fails the process",
  () =>
    observeFailureChannels("Effect.scoped(Effect.addFinalizer(() => Effect.die(new Error(privateSentinel))))").pipe(
      Effect.tap(({ exitCode, stderr, stdout }) =>
        Effect.sync(() => {
          expect(stdout).toBe("")
          expect(exitCode).toBe(1)
          expect(JSON.parse(stderr)).toMatchObject({
            _tag: "DalphRuntimeDiagnostic",
            boundary: "NodeMainExit",
            reasons: [{ _tag: "Defect", error: { errorTag: "Error", safeMessage: "Error failed" } }]
          })
          expect(stderr).not.toContain("private-provider-payload-must-not-be-printed")
        })
      )
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

for (const disposition of ["Completed", "Cancelled"] as const)
  it.live(`keeps JSON Run ${disposition} visible when provider close makes process exit nonzero`, () =>
    Effect.gen(function* () {
      const observed = yield* observeFailureChannels(`Effect.scoped(Effect.gen(function* () {
        yield* Effect.addFinalizer(() => Effect.die(new CodexAppServerFailure({ operation: "close", kind: "Ownership", detail: privateSentinel })));
        yield* Effect.sync(() => nodeProcess.stdout.write(JSON.stringify({ _tag: "RunDisposition", runId: "retained-run", disposition: "${disposition}", version: 1 }) + "\\n"));
      }))`)
      expect(observed.exitCode).toBe(1)
      expect(JSON.parse(observed.stdout)).toMatchObject({ _tag: "RunDisposition", disposition })
      expect(JSON.parse(observed.stderr)).toMatchObject({
        boundary: "NodeMainExit",
        outcome: "Failed",
        reasons: [{ error: { errorTag: "CodexAppServerFailure", operation: "close", category: "Ownership" } }]
      })
      expect(observed.stderr).not.toContain("private-provider-payload")
    }).pipe(Effect.provide(NodeServices.layer))
  )

for (const outcome of ["Succeeded", "TimedOut", "FinalizationFailed"] as const) {
  it.live(
    `stalled Exit output ends the Node process after finalization with ${outcome} status`,
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
          const result =
            outcome !== "TimedOut"
              ? "ApplicationExitResult.cases.Succeeded.make({ requestedStatus: 0 })"
              : "ApplicationExitResult.cases.TimedOut.make({ diagnostics: [], requestedStatus: 1 })"
          const script = `
        import { Effect } from "effect";
        import { ApplicationExitResult, TraceOutput } from "@dalph/orchestrator";
        import { NodeStdio } from "@effect/platform-node";
        import { runDalphNodeMain } from "./dist/src/application/node-main.js";
        import { withCliExitOutputGrace } from "./dist/src/application/cli-exit-output.js";
        import { traceOutputStdioLayer } from "./dist/src/presentation/stdio-trace-output.js";
        import { writeSync } from "node:fs";
        const report = (event) => Effect.sync(() => writeSync(2, JSON.stringify({ event }) + "\\n"));
        const application = Effect.scoped(Effect.gen(function* () {
          yield* Effect.addFinalizer(() => report("host-finalized")${outcome === "FinalizationFailed" ? '.pipe(Effect.andThen(Effect.die({ _tag: "ControlledFinalizationDefect" })))' : ""});
          const output = yield* TraceOutput;
          yield* withCliExitOutputGrace({ awaitRequest: Effect.void, awaitResult: Effect.succeed(${result}) },
            () => output.writeLine(JSON.stringify({ payload: "x".repeat(4 * 1024 * 1024) })));
        })).pipe(Effect.provide(traceOutputStdioLayer), Effect.provide(NodeStdio.layer));
        runDalphNodeMain(application);
      `
          const child = yield* spawner.spawn(
            ChildProcess.make(nodeProcess.execPath, ["--input-type=module", "--eval", script], {
              cwd: dalphPackageDirectory
            })
          )
          // Deliberately do not subscribe to stdout before the child has ended.
          // Setting exitCode alone leaves Node waiting for this pending pipe.
          const [exitCode, stderr] = yield* Effect.all(
            [child.exitCode, child.stderr.pipe(Stream.decodeText(), Stream.mkString)],
            { concurrency: "unbounded" }
          ).pipe(Effect.timeout("10 seconds"))
          expect(exitCode).toBe(outcome === "Succeeded" ? 0 : 1)
          if (outcome === "FinalizationFailed") {
            const events = stderr
              .trim()
              .split("\n")
              .map((line) => JSON.parse(line))
            expect(events[0]).toEqual({ event: "host-finalized" })
            expect(events[1]).toMatchObject({ boundary: "NodeMainExit", outcome: "Failed" })
          } else expect(stderr).toBe(JSON.stringify({ event: "host-finalized" }) + "\n")
          const partial = yield* child.stdout.pipe(Stream.decodeText(), Stream.mkString)
          expect(Buffer.byteLength(partial)).toBeLessThan(4 * 1024 * 1024)
        })
      ).pipe(Effect.provide(NodeServices.layer)),
    15_000
  )
}
