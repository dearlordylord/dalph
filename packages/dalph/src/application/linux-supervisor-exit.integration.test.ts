/* eslint-disable import/no-nodejs-modules -- Linux qualification deliberately controls real Node child processes. */
import { NodeFileSystem, NodePath, NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { Deferred, Effect, Fiber, FileSystem, Layer, Path, Ref, Schema, Stream } from "effect"
import nodeProcess from "node:process"
import { expect } from "vitest"

const LifecycleLine = Schema.Struct({
  lifecycle: Schema.optionalKey(
    Schema.Struct({
      _tag: Schema.optionalKey(Schema.String),
      result: Schema.optionalKey(
        Schema.Struct({ _tag: Schema.optionalKey(Schema.String), requestedStatus: Schema.optionalKey(Schema.Finite) })
      )
    })
  ),
  controlledExecutor: Schema.optionalKey(Schema.String),
  journalEvents: Schema.optionalKey(Schema.Array(Schema.String)),
  llmRequests: Schema.optionalKey(Schema.Finite),
  lockAcquired: Schema.optionalKey(Schema.Boolean),
  observedAt: Schema.optionalKey(Schema.Finite),
  ready: Schema.optionalKey(Schema.Boolean),
  repeatedSignalSent: Schema.optionalKey(Schema.Boolean)
})
type LifecycleLine = typeof LifecycleLine.Type

const nodeLayer = Layer.merge(NodeFileSystem.layer, NodePath.layer)
const fixture = new URL("../../test/fixtures/linux-application-exit-host.ts", import.meta.url).pathname
const loader = new URL("../../test/fixtures/typescript-source-loader.mjs", import.meta.url).pathname
const dalphPackageDirectory = new URL("../../", import.meta.url).pathname

type HostFixtureMode = "acquire-once" | "failed" | "idle" | "running" | "stuck" | "stuck-repeat"

const childCommand = (mode: HostFixtureMode, directory: string, journal?: string) =>
  ChildProcess.make(
    nodeProcess.execPath,
    [
      "--experimental-transform-types",
      "--import",
      loader,
      fixture,
      mode,
      directory,
      ...(journal === undefined ? [] : [journal])
    ],
    { cwd: dalphPackageDirectory }
  )

const readJsonLines = (handle: ChildProcessSpawner.ChildProcessHandle) =>
  handle.stdout.pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.mapEffect((line) => Schema.decodeUnknownEffect(Schema.fromJsonString(LifecycleLine))(line))
  )

const spawnReadyChild = Effect.fn("LinuxSupervisorExit.Test.spawnReadyChild")(function* (
  mode: HostFixtureMode,
  directory: string,
  journal?: string
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const handle = yield* spawner.spawn(childCommand(mode, directory, journal))
  const observed = yield* Ref.make<ReadonlyArray<LifecycleLine>>([])
  const exitRequested = yield* Deferred.make<void>()
  const ready = yield* Deferred.make<void>()
  const collector = yield* readJsonLines(handle).pipe(
    Stream.runForEach((line) =>
      Ref.update(observed, (current) => [...current, line]).pipe(
        Effect.andThen(line.ready === true ? Deferred.succeed(ready, undefined) : Effect.void),
        Effect.andThen(
          line.lifecycle?._tag === "ExitRequested" ? Deferred.succeed(exitRequested, undefined) : Effect.void
        )
      )
    ),
    Effect.forkScoped
  )
  yield* Deferred.await(ready)
  return { collector, exitRequested: Deferred.await(exitRequested), handle, observed }
})

const temporaryDirectory = <A, E, R>(use: (directory: string, journal: string) => Effect.Effect<A, E, R>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-linux-exit-host-" })
      const directory = path.join(root, "git-common-directory")
      const journal = path.join(root, "run-journal.txt")
      yield* fileSystem.makeDirectory(directory)
      return yield* use(directory, journal)
    })
  ).pipe(Effect.provide(nodeLayer))

const signal = (handle: ChildProcessSpawner.ChildProcessHandle, killSignal: "SIGKILL" | "SIGTERM") =>
  Effect.sync(() => {
    nodeProcess.kill(handle.pid, killSignal)
  })

it.live(
  "an idle Linux child reports successful Exit and status zero after SIGTERM",
  () =>
    temporaryDirectory((directory) =>
      Effect.gen(function* () {
        const { collector, handle, observed } = yield* spawnReadyChild("idle", directory)
        yield* signal(handle, "SIGTERM")
        expect(yield* handle.exitCode).toBe(0)
        yield* Fiber.join(collector)
        const lifecycle = yield* Ref.get(observed)

        expect(lifecycle.find(({ lifecycle }) => lifecycle?._tag === "ExitResultReported")).toMatchObject({
          lifecycle: { _tag: "ExitResultReported", result: { _tag: "Succeeded", requestedStatus: 0 } }
        })
      })
    ).pipe(Effect.provide(NodeServices.layer)),
  120_000
)

it.live(
  "a running controlled executor suspends before its Linux child exits zero",
  () =>
    temporaryDirectory((directory) =>
      Effect.gen(function* () {
        const { collector, handle, observed } = yield* spawnReadyChild("running", directory)
        yield* signal(handle, "SIGTERM")
        expect(yield* handle.exitCode).toBe(0)
        yield* Fiber.join(collector)
        const lifecycle = yield* Ref.get(observed)
        const fastRequest = lifecycle.find(({ controlledExecutor }) => controlledExecutor === "FastSuspensionRequested")
        const journal = lifecycle.find(({ journalEvents }) => journalEvents !== undefined)
        const result = lifecycle.findIndex(({ lifecycle }) => lifecycle?._tag === "ExitResultReported")
        expect(fastRequest).toEqual({ controlledExecutor: "FastSuspensionRequested", llmRequests: 0 })
        expect(journal?.journalEvents).toEqual([
          "PlannedAttemptExecutorWorkResponsibilityBegan",
          "PlannedAttemptExecutorWorkReported",
          "PlannedAttemptExecutorCommandIntended",
          "PlannedAttemptExecutorWorkReported"
        ])
        expect(journal === undefined ? -1 : lifecycle.indexOf(journal)).toBeLessThan(result)
      })
    ).pipe(Effect.provide(NodeServices.layer)),
  120_000
)

it.live(
  "repeated SIGTERM joins the original stuck Linux child drain and exits nonzero at five seconds",
  () =>
    temporaryDirectory((directory) =>
      Effect.gen(function* () {
        const { collector, handle, observed } = yield* spawnReadyChild("stuck-repeat", directory)
        yield* signal(handle, "SIGTERM")
        expect(yield* handle.exitCode).toBe(1)
        yield* Fiber.join(collector)
        const lifecycle = yield* Ref.get(observed)
        const requests = lifecycle.filter(({ lifecycle }) => lifecycle?._tag === "ExitRequested")
        const cutoff = lifecycle.findIndex(({ lifecycle }) => lifecycle?._tag === "AdmissionCutoffClosed")
        const repeatedRequest = lifecycle.findLastIndex(({ lifecycle }) => lifecycle?._tag === "ExitRequested")
        const result = lifecycle.find(({ lifecycle }) => lifecycle?.result?._tag === "TimedOut")
        const firstRequestedAt = requests[0]?.observedAt
        const repeatedAt = requests[1]?.observedAt
        const resultAt = result?.observedAt

        expect(requests).toHaveLength(2)
        expect(cutoff).toBeGreaterThanOrEqual(0)
        expect(cutoff).toBeLessThan(repeatedRequest)
        expect(lifecycle.find(({ repeatedSignalSent }) => repeatedSignalSent === true)).toBeDefined()
        expect(result).toBeDefined()
        expect(firstRequestedAt).toBeTypeOf("number")
        expect(repeatedAt).toBeTypeOf("number")
        expect(resultAt).toBeTypeOf("number")
        if (firstRequestedAt === undefined || repeatedAt === undefined || resultAt === undefined) {
          return yield* Effect.die("the child did not report complete lifecycle timing evidence")
        }
        expect(resultAt - firstRequestedAt).toBeGreaterThanOrEqual(4_500)
        expect(resultAt - firstRequestedAt).toBeLessThan(5_750)
        expect(repeatedAt).toBeGreaterThanOrEqual(firstRequestedAt)
      })
    ).pipe(Effect.provide(NodeServices.layer)),
  120_000
)

it.live(
  "signal receipt, scope closure, and unexpected death leave only the ordinary journal prefix",
  () =>
    Effect.forEach(["SIGTERM", "SIGKILL"] as const, (killSignal) =>
      temporaryDirectory((directory, journal) =>
        Effect.gen(function* () {
          const fileSystem = yield* FileSystem.FileSystem
          const { collector, handle, observed } = yield* spawnReadyChild("idle", directory, journal)
          yield* signal(handle, killSignal)
          const status = yield* Effect.exit(handle.exitCode)
          yield* Fiber.join(collector)

          expect(status).toMatchObject(killSignal === "SIGTERM" ? { _tag: "Success", value: 0 } : { _tag: "Failure" })
          expect(yield* fileSystem.readFileString(journal)).toBe("WorkflowRunBegan\n")
          const lifecycle = (yield* Ref.get(observed)).filter(({ lifecycle }) => lifecycle !== undefined)
          expect(lifecycle.length > 0).toBe(killSignal === "SIGTERM")
        })
      )
    ).pipe(Effect.provide(NodeServices.layer)),
  120_000
)

it.live(
  "a successor Linux child acquires the coordinator lock after zero success and nonzero failed or timed-out Exit",
  () =>
    Effect.forEach(["idle", "failed", "stuck"] as const, (mode) =>
      temporaryDirectory((directory) =>
        Effect.gen(function* () {
          const { collector, handle, observed } = yield* spawnReadyChild(mode, directory)
          yield* signal(handle, "SIGTERM")
          const exitCode = yield* handle.exitCode
          yield* Fiber.join(collector)
          const expectedResult = mode === "idle" ? "Succeeded" : mode === "failed" ? "Failed" : "TimedOut"
          expect(exitCode).toBe(mode === "idle" ? 0 : 1)
          expect(
            (yield* Ref.get(observed)).find(({ lifecycle }) => lifecycle?.result?._tag === expectedResult)
          ).toBeDefined()

          const successor = yield* spawnReadyChild("acquire-once", directory)
          expect(yield* successor.handle.exitCode).toBe(0)
          yield* Fiber.join(successor.collector)
          expect((yield* Ref.get(successor.observed)).find(({ lockAcquired }) => lockAcquired === true)).toBeDefined()
        }).pipe(Effect.provide(NodeServices.layer))
      )
    ),
  180_000
)
