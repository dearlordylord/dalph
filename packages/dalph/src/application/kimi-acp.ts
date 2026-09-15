/* eslint-disable max-lines -- the ACP wire and process boundary stay co-located for auditability. */
/* eslint-disable import/no-nodejs-modules -- the ACP child process is an explicit execution-substrate boundary. */

import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import * as Scope from "effect/Scope"
import type { ChildProcessHandle } from "effect/unstable/process/ChildProcessSpawner"
import { Context, Deferred, Effect, Layer, Option, Ref, Schema, Semaphore, Stream } from "effect"
import { type ExecutorPermissionPolicy, type ExecutorProfile } from "./executor-profile.js"

/** Opaque ACP session identity; it never crosses the generic executor contract. */
export const KimiAcpSessionId = Schema.NonEmptyString.pipe(Schema.brand("KimiAcpSessionId"))
export type KimiAcpSessionId = typeof KimiAcpSessionId.Type

/** ACP operation labels used for typed, redacted diagnostics. */
export const KimiAcpOperation = Schema.Literals([
  "initialize",
  "authenticate",
  "session/new",
  "session/load",
  "session/resume",
  "session/prompt",
  "session/cancel",
  "session/set_model",
  "session/close",
  "close"
])
export type KimiAcpOperation = typeof KimiAcpOperation.Type

/** Failure kinds distinguish setup, protocol, permission, and provider outcomes. */
export const KimiAcpFailureKind = Schema.Literals([
  "Unavailable",
  "Authentication",
  "Unsupported",
  "Malformed",
  "Permission",
  "Provider",
  "Protocol"
])
export type KimiAcpFailureKind = typeof KimiAcpFailureKind.Type

export class KimiAcpFailure extends Schema.TaggedError<KimiAcpFailure>()("KimiAcpFailure", {
  detail: Schema.NonEmptyString,
  kind: KimiAcpFailureKind,
  operation: KimiAcpOperation
}) {}

/** Capabilities accepted from ACP initialize before a session can be started. */
export const KimiAcpCapabilities = Schema.Struct({
  loadSession: Schema.Boolean,
  resumeSession: Schema.Boolean,
  sessionClose: Schema.Boolean
})
export type KimiAcpCapabilities = typeof KimiAcpCapabilities.Type

/** Provider progress is reduced to safe text and counters, never raw wire history. */
export const KimiAcpSessionObservation = Schema.Struct({
  sessionId: KimiAcpSessionId,
  cwd: Schema.NonEmptyString,
  status: Schema.Literals(["executing", "idle", "terminal", "unavailable"]),
  updateCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  lastMessage: Schema.optionalKey(Schema.String),
  stopReason: Schema.optionalKey(Schema.String),
  permissionDenied: Schema.Boolean
})
export type KimiAcpSessionObservation = typeof KimiAcpSessionObservation.Type

/** Minimal process-neutral ACP surface used by the Kimi planned-attempt adapter. */
export interface KimiAcpClientService {
  /** Starts the provider in the exact worktree that will own the session. */
  readonly initialize: (cwd: string) => Effect.Effect<KimiAcpCapabilities, KimiAcpFailure>
  readonly newSession: (cwd: string) => Effect.Effect<KimiAcpSessionId, KimiAcpFailure>
  readonly loadSession: (sessionId: KimiAcpSessionId, cwd: string) => Effect.Effect<KimiAcpSessionId, KimiAcpFailure>
  readonly resumeSession: (sessionId: KimiAcpSessionId, cwd: string) => Effect.Effect<KimiAcpSessionId, KimiAcpFailure>
  /** Sends one prompt and returns when ACP accepts it; updates carry progress and completion. */
  readonly prompt: (sessionId: KimiAcpSessionId, text: string) => Effect.Effect<void, KimiAcpFailure>
  readonly observe: (sessionId: KimiAcpSessionId) => Effect.Effect<KimiAcpSessionObservation, KimiAcpFailure>
  readonly cancel: (sessionId: KimiAcpSessionId) => Effect.Effect<void, KimiAcpFailure>
  readonly close: () => Effect.Effect<void, KimiAcpFailure>
}

export class KimiAcpClient extends Context.Service<KimiAcpClient, KimiAcpClientService>()("@dalph/KimiAcpClient") {}

/** Controlled ACP transport for protocol and lifecycle tests. */
export const controlledKimiAcpClientLayer = (service: KimiAcpClientService): Layer.Layer<KimiAcpClient> =>
  Layer.succeed(KimiAcpClient, service)

type JsonRecord = Record<string, unknown>
const isJsonRecord = (value: unknown): value is JsonRecord => typeof value === "object" && value !== null
const asNonEmptyString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined

const failure = (operation: KimiAcpOperation, kind: KimiAcpFailureKind, detail: string): KimiAcpFailure =>
  new KimiAcpFailure({ detail, kind, operation })

const safeDetail = (value: unknown): string => {
  if (isJsonRecord(value) && typeof value["message"] === "string") return value["message"]
  if (value instanceof Error && value.message.length > 0) return value.message
  return "Kimi ACP boundary failed"
}

const responseError = (operation: KimiAcpOperation, error: unknown): KimiAcpFailure => {
  const authenticationErrorCode = -32000
  const methodNotFoundErrorCode = -32601
  const code = isJsonRecord(error) && typeof error["code"] === "number" ? error["code"] : undefined
  const detail = safeDetail(error)
  if (code === authenticationErrorCode || /auth(?:entication)? required|not logged in/iu.test(detail)) {
    return failure(operation, "Authentication", "Kimi authentication is unavailable")
  }
  if (code === methodNotFoundErrorCode || /method not found|unsupported/iu.test(detail)) {
    return failure(operation, "Unsupported", `Kimi ACP does not support ${operation}`)
  }
  return failure(operation, "Provider", "Kimi ACP provider returned an error")
}

type SessionState = {
  readonly sessionId: KimiAcpSessionId
  readonly cwd: string
  readonly status: "executing" | "idle" | "terminal" | "unavailable"
  readonly updateCount: number
  readonly lastMessage?: string
  readonly stopReason?: string
  readonly permissionDenied: boolean
}

const initialSessionState = (sessionId: KimiAcpSessionId, cwd: string): SessionState => ({
  sessionId,
  cwd,
  status: "idle",
  updateCount: 0,
  permissionDenied: false
})

const stateText = (update: JsonRecord): string | undefined => {
  const direct = asNonEmptyString(update["text"])
  if (direct !== undefined) return direct
  const content = update["content"]
  if (isJsonRecord(content)) return asNonEmptyString(content["text"])
  if (Array.isArray(content)) {
    const first = content.find((item) => isJsonRecord(item) && asNonEmptyString(item["text"]) !== undefined)
    return isJsonRecord(first) ? asNonEmptyString(first["text"]) : undefined
  }
  return undefined
}

const stateStatus = (update: JsonRecord): SessionState["status"] | undefined => {
  const raw = update["state"] ?? update["status"] ?? update["sessionState"]
  if (raw === "running" || raw === "active" || raw === "busy" || raw === "in_progress") return "executing"
  if (raw === "idle" || raw === "ready") return "idle"
  if (raw === "completed" || raw === "failed" || raw === "cancelled" || raw === "canceled") return "terminal"
  return undefined
}

const stopReason = (update: JsonRecord): string | undefined => {
  const value = update["stopReason"] ?? update["stop_reason"]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

const responseId = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined

type Pending = { readonly deferred: Deferred.Deferred<unknown, KimiAcpFailure>; readonly operation: KimiAcpOperation }

interface KimiAcpRpc {
  readonly request: (
    operation: KimiAcpOperation,
    method: string,
    params?: unknown
  ) => Effect.Effect<unknown, KimiAcpFailure>
  readonly notify: (
    operation: KimiAcpOperation,
    method: string,
    params?: unknown
  ) => Effect.Effect<void, KimiAcpFailure>
  readonly close: Effect.Effect<void, KimiAcpFailure>
}

const requestTimeout = 60
const maximumDiagnosticBytes = 65536

/**
 * Creates one ACP JSON-RPC client. stdout is parsed exclusively as protocol;
 * stderr is drained into a private bounded diagnostic sink and is never mixed
 * into protocol state.
 */
const makeRpc = Effect.fn("KimiAcp.makeRpc")(function* (
  handle: ChildProcessHandle,
  permissionPolicy: ExecutorPermissionPolicy,
  updateState: (params: unknown) => Effect.Effect<void>,
  onPermissionDenied: () => Effect.Effect<void>
): Effect.fn.Return<KimiAcpRpc, KimiAcpFailure> {
  const nextId = yield* Ref.make(1)
  const pending = yield* Ref.make<ReadonlyMap<number, Pending>>(new Map())
  const writes = yield* Semaphore.make(1)
  const closed = yield* Ref.make(false)
  const diagnostics = yield* Ref.make("")
  const encoder = new TextEncoder()

  const failPending = (cause: KimiAcpFailure) =>
    Ref.modify(pending, (current) => [[...current.values()], new Map()] as const).pipe(
      Effect.flatMap((requests) =>
        Effect.forEach(requests, (request) => Deferred.fail(request.deferred, cause), { discard: true })
      )
    )

  const send = (message: JsonRecord) =>
    writes.withPermit(
      Stream.run(Stream.succeed(encoder.encode(`${JSON.stringify(message)}\n`)), handle.stdin).pipe(
        Effect.mapError((error) => failure("close", "Unavailable", safeDetail(error)))
      )
    )

  const replyPermission = (id: number, params: JsonRecord) => {
    const options = params["options"]
    const first = Array.isArray(options)
      ? options.find((option) => isJsonRecord(option) && (option["optionId"] ?? option["option_id"]) !== undefined)
      : undefined
    const optionId = isJsonRecord(first) ? asNonEmptyString(first["optionId"] ?? first["option_id"]) : undefined
    const selected =
      permissionPolicy === "unattended" && optionId !== undefined
        ? { outcome: { outcome: "selected", optionId } }
        : { outcome: { outcome: "cancelled" } }
    return send({ jsonrpc: "2.0", id, result: selected }).pipe(
      Effect.andThen(permissionPolicy === "unattended" && optionId !== undefined ? Effect.void : onPermissionDenied())
    )
  }

  const onMessage = (message: JsonRecord) => {
    const id = message["id"]
    const method = message["method"]
    if (typeof method === "string" && id !== undefined) {
      if (method === "session/request_permission" && typeof id === "number") {
        return isJsonRecord(message["params"])
          ? replyPermission(id, message["params"])
          : send({ jsonrpc: "2.0", id, error: { code: -32602, message: "permission request is malformed" } })
      }
      return typeof id === "number"
        ? send({ jsonrpc: "2.0", id, error: { code: -32601, message: `unsupported client method ${method}` } })
        : Effect.void
    }
    if (typeof method === "string" && method === "session/update") return updateState(message["params"])
    if (id === undefined) return Effect.void
    const numericId = responseId(id)
    if (numericId === undefined) return failPending(failure("initialize", "Protocol", "ACP response id is invalid"))
    return Ref.modify(pending, (current) => {
      const request = current.get(numericId)
      if (request === undefined) return [Option.none<Pending>(), current] as const
      return [Option.some(request), new Map([...current].filter(([key]) => key !== numericId))] as const
    }).pipe(
      Effect.flatMap((request) => {
        if (Option.isNone(request)) return Effect.void
        return isJsonRecord(message["error"])
          ? Deferred.fail(request.value.deferred, responseError(request.value.operation, message["error"]))
          : Deferred.succeed(request.value.deferred, message["result"])
      })
    )
  }

  const reader = handle.stdout.pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.runForEach((line) => {
      if (line.trim() === "") return Effect.void
      return Effect.try({
        try: () => JSON.parse(line),
        catch: () => failure("initialize", "Protocol", "Kimi ACP emitted malformed JSON")
      }).pipe(
        Effect.flatMap((value) =>
          isJsonRecord(value)
            ? onMessage(value)
            : Effect.fail(failure("initialize", "Protocol", "Kimi ACP message is not an object"))
        ),
        Effect.catch((error) =>
          failPending(error instanceof KimiAcpFailure ? error : failure("initialize", "Protocol", safeDetail(error)))
        )
      )
    }),
    Effect.ensuring(failPending(failure("close", "Unavailable", "Kimi ACP stdout closed")))
  )
  yield* reader.pipe(Effect.forkDetach)
  // Drain stderr independently. It is intentionally never exposed through the ACP message parser.
  yield* handle.stderr.pipe(
    Stream.decodeText(),
    Stream.runForEach((chunk) =>
      Ref.update(diagnostics, (current) => `${current}${chunk}`.slice(-maximumDiagnosticBytes))
    ),
    Effect.catch(() => Effect.void),
    Effect.forkDetach
  )

  const request = Effect.fn("KimiAcp.request")(function* (
    operation: KimiAcpOperation,
    method: string,
    params?: unknown
  ) {
    const isClosed = yield* Ref.get(closed)
    if (isClosed) return yield* Effect.fail(failure(operation, "Unavailable", "Kimi ACP process is closed"))
    const id = yield* Ref.modify(nextId, (current) => [current, current + 1] as const)
    const deferred = yield* Deferred.make<unknown, KimiAcpFailure>()
    yield* Ref.update(pending, (current) => new Map([...current, [id, { deferred, operation }] as const]))
    yield* send({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) })
    return yield* Deferred.await(deferred).pipe(
      Effect.timeoutOrElse({
        duration: `${requestTimeout} seconds`,
        orElse: () => Effect.fail(failure(operation, "Unavailable", "Kimi ACP response deadline exceeded"))
      }),
      Effect.ensuring(Ref.update(pending, (current) => new Map([...current].filter(([key]) => key !== id))))
    )
  })
  const notify = Effect.fn("KimiAcp.notify")(function* (operation: KimiAcpOperation, method: string, params?: unknown) {
    const isClosed = yield* Ref.get(closed)
    if (isClosed) return yield* Effect.fail(failure(operation, "Unavailable", "Kimi ACP process is closed"))
    yield* send({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) })
  })
  const close = Effect.gen(function* () {
    const shouldClose = yield* Ref.modify(closed, (current) => [!current, true] as const)
    if (!shouldClose) return
    yield* failPending(failure("close", "Unavailable", "Kimi ACP process closed"))
    yield* handle.kill({ killSignal: "SIGTERM", forceKillAfter: "1 second" }).pipe(
      Effect.mapError((error) => failure("close", "Unavailable", safeDetail(error))),
      Effect.catch(() => Effect.void)
    )
  })
  return { request, notify, close }
})

const sessionIdFrom = (operation: KimiAcpOperation, value: unknown): KimiAcpSessionId | KimiAcpFailure => {
  if (!isJsonRecord(value)) return failure(operation, "Malformed", "Kimi ACP response is not an object")
  const candidate = value["sessionId"] ?? value["session_id"]
  if (typeof candidate !== "string" || candidate.length === 0) {
    return failure(operation, "Malformed", "Kimi ACP response has no session id")
  }
  return KimiAcpSessionId.make(candidate)
}

const capabilityBoolean = (value: unknown, keys: ReadonlyArray<string>): boolean => {
  let current: unknown = value
  for (const key of keys) {
    if (!isJsonRecord(current)) return false
    current = current[key]
  }
  return isJsonRecord(current) ? true : current === true
}

const initializeCapabilities = (value: unknown): KimiAcpCapabilities | KimiAcpFailure => {
  if (!isJsonRecord(value)) return failure("initialize", "Malformed", "Kimi initialize response is not an object")
  const agent = value["agentCapabilities"]
  const sessions = isJsonRecord(agent) ? agent["sessionCapabilities"] : undefined
  const loadSession = capabilityBoolean(sessions, ["loadSession"]) || capabilityBoolean(agent, ["loadSession"])
  const resumeSession = capabilityBoolean(sessions, ["resume"]) || capabilityBoolean(agent, ["sessionResume"])
  const sessionClose = capabilityBoolean(sessions, ["close"]) || capabilityBoolean(agent, ["sessionClose"])
  if (!loadSession || !resumeSession || !sessionClose) {
    return failure("initialize", "Unsupported", "Kimi ACP does not advertise load, resume, and close sessions")
  }
  return KimiAcpCapabilities.make({ loadSession, resumeSession, sessionClose })
}

const nodeConfig = { clientName: "dalph", clientVersion: "0.0.0" } as const

/** Starts `kimi acp` lazily at the first exact worktree boundary. */
export const nodeKimiAcpClientLayer = (
  profile: ExecutorProfile,
  config: Partial<typeof nodeConfig> = {}
): Layer.Layer<KimiAcpClient, KimiAcpFailure, ChildProcessSpawner.ChildProcessSpawner> =>
  Layer.effect(
    KimiAcpClient,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const layerScope = yield* Scope.Scope
      const rpc = yield* Ref.make<Option.Option<KimiAcpRpc>>(Option.none())
      const sessions = yield* Ref.make<ReadonlyMap<KimiAcpSessionId, SessionState>>(new Map())
      const initialized = yield* Ref.make<Option.Option<KimiAcpCapabilities>>(Option.none())
      const permissionDenied = yield* Ref.make(false)
      const states = (params: unknown) => {
        if (!isJsonRecord(params)) return Effect.void
        const id = params["sessionId"] ?? params["session_id"]
        if (typeof id !== "string") return Effect.void
        const sessionId = KimiAcpSessionId.make(id)
        return Ref.update(sessions, (current) => {
          const prior = current.get(sessionId)
          if (prior === undefined) return current
          const update = isJsonRecord(params["update"]) ? params["update"] : params
          const text = stateText(update)
          const nextStatus = stateStatus(update)
          const nextBase: SessionState = { ...prior, updateCount: prior.updateCount + 1 }
          const nextStatusReason = stopReason(update)
          const next: SessionState = {
            ...nextBase,
            ...(nextStatus === undefined ? {} : { status: nextStatus }),
            ...(text === undefined ? {} : { lastMessage: text }),
            ...(nextStatusReason === undefined ? {} : { stopReason: nextStatusReason })
          }
          return new Map([...current, [sessionId, next] as const])
        })
      }
      const ensure = Effect.fn("KimiAcp.ensureProcess")(function* (cwd: string) {
        const existing = yield* Ref.get(rpc)
        if (Option.isSome(existing)) return existing.value
        const handle = yield* spawner
          .spawn(
            ChildProcess.make(profile.executable, ["acp"], {
              cwd,
              stdin: { stream: "pipe", endOnDone: false },
              stdout: "pipe",
              stderr: "pipe",
              extendEnv: true
            })
          )
          .pipe(Effect.provideService(Scope.Scope, layerScope))
          .pipe(Effect.mapError((error) => failure("initialize", "Unavailable", safeDetail(error))))
        const client = yield* makeRpc(handle, profile.permissionPolicy, states, () => Ref.set(permissionDenied, true))
        yield* Ref.set(rpc, Option.some(client))
        return client
      })
      const requireRpc = Effect.fn("KimiAcp.requireRpc")(function* () {
        const current = yield* Ref.get(rpc)
        return Option.isSome(current)
          ? current.value
          : yield* Effect.fail(failure("initialize", "Unavailable", "Kimi ACP has not been started"))
      })
      const initialize = Effect.fn("KimiAcp.initialize")(function* (cwd: string) {
        const current = yield* Ref.get(initialized)
        if (Option.isSome(current)) return current.value
        yield* ensure(cwd)
        const client = yield* requireRpc()
        const response = yield* client
          .request("initialize", "initialize", {
            protocolVersion: 1,
            clientInfo: {
              name: config.clientName ?? nodeConfig.clientName,
              version: config.clientVersion ?? nodeConfig.clientVersion
            },
            clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }
          })
          .pipe(Effect.catch((error) => Effect.fail(error)))
        const capabilities = initializeCapabilities(response)
        if (capabilities instanceof KimiAcpFailure) return yield* Effect.fail(capabilities)
        yield* Ref.set(initialized, Option.some(capabilities))
        return capabilities
      })
      const afterSession = (operation: KimiAcpOperation, response: unknown, cwd: string) => {
        const sessionId = sessionIdFrom(operation, response)
        if (sessionId instanceof KimiAcpFailure) return Effect.fail(sessionId)
        return Ref.update(
          sessions,
          (current) => new Map([...current, [sessionId, initialSessionState(sessionId, cwd)] as const])
        ).pipe(Effect.as(sessionId))
      }
      const newSession = Effect.fn("KimiAcp.newSession")(function* (cwd: string) {
        const client = yield* ensure(cwd)
        yield* initialize(cwd)
        const response = yield* client.request("session/new", "session/new", {
          cwd,
          mcpServers: [],
          _meta: { dalph: { model: profile.model, provider: profile.provider } }
        })
        return yield* afterSession("session/new", response, cwd)
      })
      const restore = (operation: "session/load" | "session/resume", sessionId: KimiAcpSessionId, cwd: string) =>
        Effect.gen(function* () {
          const client = yield* ensure(cwd)
          yield* initialize(cwd)
          const response = yield* client.request(operation, operation, { sessionId, cwd, mcpServers: [] })
          const restored = yield* afterSession(operation, response, cwd)
          if (restored !== sessionId)
            return yield* Effect.fail(failure(operation, "Protocol", "Kimi resumed a different session"))
          return restored
        })
      const loadSession = Effect.fn("KimiAcp.loadSession")(function* (sessionId: KimiAcpSessionId, cwd: string) {
        return yield* restore("session/load", sessionId, cwd)
      })
      const resumeSession = Effect.fn("KimiAcp.resumeSession")(function* (sessionId: KimiAcpSessionId, cwd: string) {
        return yield* restore("session/resume", sessionId, cwd)
      })
      const prompt = Effect.fn("KimiAcp.prompt")(function* (sessionId: KimiAcpSessionId, text: string) {
        const client = yield* requireRpc()
        yield* Ref.update(sessions, (current) => {
          const state = current.get(sessionId)
          return state === undefined
            ? current
            : new Map([...current, [sessionId, { ...state, status: "executing" }] as const])
        })
        const response = yield* client.request("session/prompt", "session/prompt", {
          sessionId,
          prompt: [{ type: "text", text }]
        })
        // Some ACP servers return the final stop reason in the response; retain it as terminal evidence.
        const responseStopReason = isJsonRecord(response) ? asNonEmptyString(response["stopReason"]) : undefined
        if (responseStopReason !== undefined) {
          yield* Ref.update(sessions, (current) => {
            const state = current.get(sessionId)
            return state === undefined
              ? current
              : new Map([
                  ...current,
                  [sessionId, { ...state, status: "terminal", stopReason: responseStopReason }] as const
                ])
          })
        }
      })
      const observe = Effect.fn("KimiAcp.observe")(function* (sessionId: KimiAcpSessionId) {
        const denied = yield* Ref.get(permissionDenied)
        const state = (yield* Ref.get(sessions)).get(sessionId)
        if (state === undefined)
          return yield* Effect.fail(failure("session/resume", "Unavailable", "Kimi session is unknown"))
        return KimiAcpSessionObservation.make({
          sessionId: state.sessionId,
          cwd: state.cwd,
          status: state.status,
          updateCount: state.updateCount,
          ...(state.lastMessage === undefined ? {} : { lastMessage: state.lastMessage }),
          ...(state.stopReason === undefined ? {} : { stopReason: state.stopReason }),
          permissionDenied: denied || state.permissionDenied
        })
      })
      const cancel = Effect.fn("KimiAcp.cancel")(function* (sessionId: KimiAcpSessionId) {
        const client = yield* requireRpc()
        yield* client.notify("session/cancel", "session/cancel", { sessionId })
        yield* Ref.update(sessions, (current) => {
          const state = current.get(sessionId)
          return state === undefined
            ? current
            : new Map([...current, [sessionId, { ...state, status: "idle" }] as const])
        })
      })
      const close = Effect.gen(function* () {
        const current = yield* Ref.get(rpc)
        if (Option.isSome(current)) yield* current.value.close
      })
      yield* Effect.addFinalizer(() =>
        Ref.get(rpc).pipe(
          Effect.flatMap((current) => (Option.isSome(current) ? current.value.close : Effect.void)),
          Effect.orDie
        )
      )
      return KimiAcpClient.of({
        initialize,
        newSession,
        loadSession,
        resumeSession,
        prompt,
        observe,
        cancel,
        close: () => close
      })
    })
  )

export const kimiAcpProfileArguments = (_profile: ExecutorProfile): ReadonlyArray<string> => ["acp"]
