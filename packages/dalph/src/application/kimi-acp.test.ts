import { it } from "@effect/vitest"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { Effect, Layer, Sink, Stream } from "effect"
import { expect } from "vitest"
import {
  ExecutorModelAlias,
  ExecutorProfile,
  ExecutorProfileId,
  ExecutorProviderConfigReference
} from "./executor-profile.js"
import { KimiAcpFailure, nodeKimiAcpClientLayer, preflightKimiExecutable } from "./kimi-acp.js"

const profile = ExecutorProfile.make({
  adapter: "kimi-acp",
  executable: "kimi",
  id: ExecutorProfileId.make("kimi/for-coding"),
  model: ExecutorModelAlias.make("kimi-for-coding"),
  permissionPolicy: "deny",
  provider: "kimi",
  providerConfigRef: ExecutorProviderConfigReference.make("kimi-for-coding")
})

const fakeHandle = (exitCode: number) =>
  ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(exitCode)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    stdin: Sink.drain,
    stdout: Stream.empty,
    stderr: Stream.empty,
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
    unref: Effect.succeed(Effect.void)
  })

const spawnerLayer = (exitCode: number, commands: Array<ChildProcess.Command>) =>
  Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) =>
      Effect.sync(() => {
        commands.push(command)
        return fakeHandle(exitCode)
      })
    )
  )

it.effect("checks the configured Kimi executable with --version in the requested directory", () => {
  const commands: Array<ChildProcess.Command> = []
  return Effect.gen(function* () {
    yield* preflightKimiExecutable(profile, "/srv/dalph/repository").pipe(Effect.provide(spawnerLayer(0, commands)))
    expect(commands).toHaveLength(1)
    const command = commands[0]
    expect(command).toBeDefined()
    if (command !== undefined && ChildProcess.isStandardCommand(command)) {
      expect(command.command).toBe("kimi")
      expect(command.args).toEqual(["--version"])
      expect(command.options).toMatchObject({
        cwd: "/srv/dalph/repository",
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
        extendEnv: true
      })
    }
  })
})

it.effect("fails Kimi layer construction when the configured executable exits unsuccessfully", () => {
  const commands: Array<ChildProcess.Command> = []
  return Effect.scoped(
    Layer.build(nodeKimiAcpClientLayer(profile, { preflightCwd: "/srv/dalph/repository" })).pipe(
      Effect.provide(spawnerLayer(1, commands)),
      Effect.flip,
      Effect.tap((error) =>
        Effect.sync(() => {
          expect(error).toBeInstanceOf(KimiAcpFailure)
          expect(error).toMatchObject({ operation: "initialize", kind: "Unavailable" })
          expect(commands).toHaveLength(1)
          const command = commands[0]
          if (command !== undefined && ChildProcess.isStandardCommand(command)) {
            expect(command.options).toMatchObject({ cwd: "/srv/dalph/repository" })
          }
        })
      )
    )
  )
})
