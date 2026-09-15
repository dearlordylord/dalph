import { it } from "@effect/vitest"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { Cause, Context, Effect, Exit, Layer, Option, Queue, Sink, Stream } from "effect"
import { expect } from "vitest"
import {
  ExecutorModelAlias,
  ExecutorProfile,
  ExecutorProfileId,
  ExecutorProviderConfigReference
} from "./executor-profile.js"
import {
  KimiAcpClient,
  KimiAcpFailure,
  KimiAcpSessionId,
  nodeKimiAcpClientLayer,
  preflightKimiExecutable
} from "./kimi-acp.js"

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

it.effect("performs the ACP authentication and model-selection handshake in order", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const commands: Array<ChildProcess.Command> = []
      const requests: Array<string> = []
      const output = yield* Queue.unbounded<Uint8Array>()
      const encoder = new TextEncoder()
      const decoder = new TextDecoder()
      const interactiveHandle = ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(2),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
        isRunning: Effect.succeed(true),
        kill: () => Effect.void,
        stdin: Sink.forEach((chunk: Uint8Array) =>
          Effect.gen(function* () {
            const message = JSON.parse(decoder.decode(chunk)) as { id?: number; method?: string }
            if (message.method !== undefined) requests.push(message.method)
            if (message.id === undefined) return
            const result =
              message.method === "initialize"
                ? { agentCapabilities: { sessionCapabilities: { loadSession: true, resume: true, close: true } } }
                : message.method === "session/new"
                  ? { sessionId: "kimi-session" }
                  : {}
            yield* Queue.offer(
              output,
              encoder.encode(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n`)
            )
          })
        ),
        stdout: Stream.fromQueue(output),
        stderr: Stream.empty,
        all: Stream.empty,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void)
      })
      const spawner = ChildProcessSpawner.make((command) =>
        Effect.sync(() => {
          commands.push(command)
          const isPreflight = ChildProcess.isStandardCommand(command) && command.options.stdin === "ignore"
          return isPreflight ? fakeHandle(0) : interactiveHandle
        })
      )
      const services = yield* Effect.provide(
        Layer.build(nodeKimiAcpClientLayer(profile, { preflightCwd: "/srv/dalph/repository" })),
        Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)
      )
      const client = Context.get(services, KimiAcpClient)
      const sessionId = yield* client.newSession("/srv/dalph/repository")
      expect(sessionId).toBe("kimi-session")
      expect(requests).toEqual(["initialize", "initialized", "authenticate", "session/new", "session/set_model"])
      expect(commands).toHaveLength(2)
    })
  )
)

it.effect("records ACP progress and rejects a permission request under the deny policy", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const commands: Array<ChildProcess.Command> = []
      const requests: Array<string> = []
      const permissionReplies: Array<unknown> = []
      const output = yield* Queue.unbounded<Uint8Array>()
      const encoder = new TextEncoder()
      const decoder = new TextDecoder()
      const session = KimiAcpSessionId.make("kimi-progress-session")
      const interactiveHandle = ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(3),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
        isRunning: Effect.succeed(true),
        kill: () => Effect.void,
        stdin: Sink.forEach((chunk: Uint8Array) =>
          Effect.gen(function* () {
            const message = JSON.parse(decoder.decode(chunk)) as { id?: number; method?: string; result?: unknown }
            if (message.method !== undefined) requests.push(message.method)
            if (message.id === 99) {
              permissionReplies.push(message.result)
              return
            }
            if (message.id === undefined) return
            const result =
              message.method === "initialize"
                ? { agentCapabilities: { sessionCapabilities: { loadSession: true, resume: true, close: true } } }
                : message.method === "session/new"
                  ? { sessionId: session }
                  : {}
            if (message.method === "session/prompt") {
              yield* Queue.offer(
                output,
                encoder.encode(
                  `${JSON.stringify({
                    jsonrpc: "2.0",
                    method: "session/update",
                    params: { sessionId: session, update: { state: "running", text: "working" } }
                  })}\n`
                )
              )
              yield* Queue.offer(
                output,
                encoder.encode(
                  `${JSON.stringify({
                    jsonrpc: "2.0",
                    id: 99,
                    method: "session/request_permission",
                    params: { sessionId: session, options: [{ optionId: "allow" }] }
                  })}\n`
                )
              )
            }
            yield* Queue.offer(
              output,
              encoder.encode(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n`)
            )
          })
        ),
        stdout: Stream.fromQueue(output),
        stderr: Stream.empty,
        all: Stream.empty,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void)
      })
      const spawner = ChildProcessSpawner.make((command) =>
        Effect.sync(() => {
          commands.push(command)
          const isPreflight = ChildProcess.isStandardCommand(command) && command.options.stdin === "ignore"
          return isPreflight ? fakeHandle(0) : interactiveHandle
        })
      )
      const services = yield* Effect.provide(
        Layer.build(nodeKimiAcpClientLayer(profile, { preflightCwd: "/srv/dalph/repository" })),
        Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)
      )
      const client = Context.get(services, KimiAcpClient)
      yield* client.newSession("/srv/dalph/repository")
      yield* client.prompt(session, "do work")
      const observation = yield* client.observe(session)
      expect(observation).toMatchObject({
        sessionId: session,
        status: "executing",
        updateCount: 1,
        lastMessage: "working",
        permissionDenied: true
      })
      expect(permissionReplies).toEqual([{ outcome: { outcome: "cancelled" } }])
      expect(requests).toContain("session/prompt")
      expect(commands).toHaveLength(2)
    })
  )
)

it.effect("rejects unsupported ACP session capabilities during protocol preflight", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const commands: Array<ChildProcess.Command> = []
      const output = yield* Queue.unbounded<Uint8Array>()
      const encoder = new TextEncoder()
      const decoder = new TextDecoder()
      const probeHandle = ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(4),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
        isRunning: Effect.succeed(true),
        kill: () => Effect.void,
        stdin: Sink.forEach((chunk: Uint8Array) =>
          Effect.gen(function* () {
            const message = JSON.parse(decoder.decode(chunk)) as { id?: number }
            if (message.id === undefined) return
            yield* Queue.offer(
              output,
              encoder.encode(
                `${JSON.stringify({
                  jsonrpc: "2.0",
                  id: message.id,
                  result: {
                    agentCapabilities: { sessionCapabilities: { loadSession: false, resume: true, close: true } }
                  }
                })}\n`
              )
            )
          })
        ),
        stdout: Stream.fromQueue(output),
        stderr: Stream.empty,
        all: Stream.empty,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void)
      })
      const spawner = ChildProcessSpawner.make((command) =>
        Effect.sync(() => {
          commands.push(command)
          const isPreflight = ChildProcess.isStandardCommand(command) && command.options.stdin === "ignore"
          return isPreflight ? fakeHandle(0) : probeHandle
        })
      )
      const result = yield* Layer.build(
        nodeKimiAcpClientLayer(profile, { preflightCwd: "/srv/dalph/repository", preflightProtocol: true })
      ).pipe(Effect.provide(Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)), Effect.exit)
      expect(Exit.isFailure(result)).toBe(true)
      if (Exit.isFailure(result)) {
        const error = Cause.findErrorOption(result.cause)
        expect(Option.isSome(error) && error.value).toMatchObject({ operation: "initialize", kind: "Unsupported" })
      }
      expect(commands).toHaveLength(2)
    })
  )
)

it.effect("rejects missing Kimi authentication during protocol preflight", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const commands: Array<ChildProcess.Command> = []
      const output = yield* Queue.unbounded<Uint8Array>()
      const encoder = new TextEncoder()
      const decoder = new TextDecoder()
      const probeHandle = ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(5),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
        isRunning: Effect.succeed(true),
        kill: () => Effect.void,
        stdin: Sink.forEach((chunk: Uint8Array) =>
          Effect.gen(function* () {
            const message = JSON.parse(decoder.decode(chunk)) as { id?: number; method?: string }
            if (message.id === undefined) return
            const response =
              message.method === "initialize"
                ? {
                    jsonrpc: "2.0",
                    id: message.id,
                    result: {
                      agentCapabilities: { sessionCapabilities: { loadSession: true, resume: true, close: true } }
                    }
                  }
                : { jsonrpc: "2.0", id: message.id, error: { code: -32000, message: "authentication required" } }
            yield* Queue.offer(output, encoder.encode(`${JSON.stringify(response)}\n`))
          })
        ),
        stdout: Stream.fromQueue(output),
        stderr: Stream.empty,
        all: Stream.empty,
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void)
      })
      const spawner = ChildProcessSpawner.make((command) =>
        Effect.sync(() => {
          commands.push(command)
          const isPreflight = ChildProcess.isStandardCommand(command) && command.options.stdin === "ignore"
          return isPreflight ? fakeHandle(0) : probeHandle
        })
      )
      const result = yield* Layer.build(
        nodeKimiAcpClientLayer(profile, { preflightCwd: "/srv/dalph/repository", preflightProtocol: true })
      ).pipe(Effect.provide(Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)), Effect.exit)
      expect(Exit.isFailure(result)).toBe(true)
      if (Exit.isFailure(result)) {
        const error = Cause.findErrorOption(result.cause)
        expect(Option.isSome(error) && error.value).toMatchObject({ operation: "authenticate", kind: "Authentication" })
      }
      expect(commands).toHaveLength(2)
    })
  )
)
