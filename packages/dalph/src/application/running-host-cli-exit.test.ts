import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Cause, ConfigProvider, Deferred, Effect, Exit, Fiber, FileSystem, Layer, Option, Ref } from "effect"
import { TestClock } from "effect/testing"
import { Command } from "effect/unstable/cli"
import { expect } from "vitest"
import { makeProductionHostApplicationExitShell } from "@dalph/orchestrator"
import { availableLocalHostAddress, makeRunningHostReadProbe } from "../../test-support/running-host-read-probe.js"
import { DalphCommandExit, transportFailureExitStatus } from "./command-exit.js"
import { CliExitOutputAbandoned } from "./cli-exit-output.js"
import { makeRunningHostCommands, RunningHostCliOutput } from "./running-host-cli.js"
import { readRunningHostDescriptor } from "./running-host-client.js"
import type { ApplicationExitSignal } from "./supervisor-exit.js"
import type { ProductionListeningHostRunner } from "./running-host-cli.js"

const configuration = {
  activationInterval: "1 minute",
  claimOwner: "dalph:production",
  codexClientName: "dalph",
  codexClientVersion: "0.0.0",
  codexExecutable: "/usr/local/bin/codex",
  codexExecutorPrivateStateDirectory: "/var/lib/dalph/executor-private",
  commonDirectory: "/srv/dalph/repository.git",
  evidenceStoreRoot: "/var/lib/dalph/evidence",
  failureCooldown: "5 seconds",
  integrationRef: "refs/heads/master",
  integratorCandidateWorktreeRoot: "/srv/dalph/integrator-candidates",
  integratorPrivateStore: "/var/lib/dalph/integrator-private.json",
  journalDatabase: "/var/lib/dalph/journal.sqlite",
  plannedAttemptBaseSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  plannedAttemptExecutor: "codex:production",
  plannedAttemptWorktreeRoot: "/srv/dalph/planned-attempts",
  remotePublicationTarget: { branch: "refs/heads/main", endpoint: "ssh://git@example.invalid/repository.git" },
  repository: "/srv/dalph/repository.git",
  taskWorkCapacity: 2
}

for (const blockedChannel of ["stdout", "stderr", undefined, "failed"] as const) {
  it.effect(`host Exit preserves the shared allowance with ${blockedChannel ?? "draining"} output`, () =>
    Effect.scoped(
      Effect.gen(function* () {
        const probe = yield* makeRunningHostReadProbe()
        const address = yield* availableLocalHostAddress
        const fileSystem = yield* FileSystem.FileSystem
        const directory = yield* fileSystem.makeTempDirectoryScoped()
        const configPath = `${directory}/configuration.json`
        yield* fileSystem.writeFileString(configPath, JSON.stringify(configuration))
        const listeners = yield* Ref.make<ReadonlyMap<ApplicationExitSignal, () => void>>(new Map())
        const ready = yield* Deferred.make<void>()
        const resultReported = yield* Deferred.make<void>()
        const finalized = yield* Ref.make(false)
        const writes = yield* Ref.make<ReadonlyArray<{ channel: string; text: string }>>([])
        const runHost: ProductionListeningHostRunner<unknown, never> = (_configuration, use) =>
          Effect.scoped(
            Effect.gen(function* () {
              yield* Effect.addFinalizer(() => Ref.set(finalized, true))
              const shell = yield* makeProductionHostApplicationExitShell({
                emit: (event) =>
                  event._tag === "ExitResultReported"
                    ? Deferred.succeed(resultReported, undefined).pipe(Effect.asVoid)
                    : Effect.void
              })
              return yield* use({
                ...probe.observation,
                applicationExitRequestBoundary: shell.requestBoundary,
                commandAdmission: shell.admission,
                closing: shell.admission.snapshot.pipe(Effect.map((state) => state.cutoffClosed)),
                awaitExitResult: shell.awaitExitResult.pipe(Effect.asVoid),
                registerObservationDrain: shell.registerProcessLocalDrain
              })
            })
          )
        const output = Layer.succeed(RunningHostCliOutput, {
          writeLine: (text, channel) =>
            Ref.update(writes, (all) => [...all, { text, channel }]).pipe(
              Effect.andThen(channel === "stdout" ? Deferred.succeed(ready, undefined) : Effect.void),
              Effect.andThen(
                blockedChannel === "failed" && channel === "stderr"
                  ? Effect.fail(new DalphCommandExit({ status: transportFailureExitStatus }))
                  : channel === blockedChannel
                    ? Effect.never
                    : Effect.void
              )
            )
        })
        const commands = makeRunningHostCommands(
          runHost,
          {
            addSignalListener: (signal, listener) =>
              Ref.update(listeners, (current) => new Map([...current, [signal, listener]])),
            removeSignalListener: (signal) =>
              Ref.update(listeners, (current) => new Map([...current].filter(([registered]) => registered !== signal)))
          },
          output
        )
        const run = Command.runWith(Command.make("dalph").pipe(Command.withSubcommands(commands)), { version: "test" })
        const running = yield* run([
          "host",
          "github:octo/dalph#42",
          "--production",
          "--listen",
          address,
          "--config",
          configPath
        ]).pipe(Effect.exit, Effect.forkChild)
        yield* Deferred.await(ready)
        expect(yield* readRunningHostDescriptor(address)).toMatchObject({ selectedRun: { runId: probe.runId } })
        const listener = (yield* Ref.get(listeners)).get("SIGTERM")
        if (listener === undefined) return yield* Effect.die("host signal transport was not installed")
        yield* Effect.sync(listener)
        yield* Deferred.await(resultReported)
        if (blockedChannel === "stdout" || blockedChannel === "stderr") {
          yield* TestClock.adjust("499 millis")
          expect(yield* Ref.get(finalized)).toBe(false)
          yield* TestClock.adjust("1 millis")
        }
        const outcome = yield* Fiber.join(running)
        if (blockedChannel === undefined) expect(Exit.isSuccess(outcome)).toBe(true)
        else {
          if (Exit.isSuccess(outcome)) return yield* Effect.die("stalled host output must be abandoned")
          const failure = Cause.findErrorOption(outcome.cause)
          if (blockedChannel === "failed") {
            expect(Option.getOrThrow(failure)).toBeInstanceOf(DalphCommandExit)
            expect(Option.getOrThrow(failure)).toMatchObject({ status: transportFailureExitStatus })
          } else {
            expect(Option.isSome(failure) && failure.value instanceof CliExitOutputAbandoned).toBe(true)
            expect(Option.getOrThrow(failure)).toMatchObject({ requestedStatus: 0 })
          }
        }
        expect(yield* Ref.get(finalized)).toBe(true)
        expect((yield* Ref.get(listeners)).size).toBe(0)
        expect(yield* readRunningHostDescriptor(address).pipe(Effect.flip)).toMatchObject({ _tag: "HostUnavailable" })
        const published = yield* Ref.get(writes)
        expect(JSON.parse(published[0]?.text ?? "null")).toMatchObject({ _tag: "HostReady" })
        expect(published.map((write) => write.channel)).toEqual(
          blockedChannel === "stdout" ? ["stdout"] : ["stdout", "stderr"]
        )
        if (blockedChannel === undefined)
          expect(JSON.parse(published[1]?.text ?? "null")).toEqual({
            applicationExit: { _tag: "Succeeded", requestedStatus: 0 }
          })
      })
    ).pipe(
      Effect.provide(NodeServices.layer),
      Effect.provide(
        ConfigProvider.layer(
          ConfigProvider.fromUnknown({
            GITHUB_TOKEN: "controlled-fixture",
            DALPH_CODEX_PROVIDER_CREDENTIAL: "controlled-fixture"
          })
        )
      )
    )
  )
}
