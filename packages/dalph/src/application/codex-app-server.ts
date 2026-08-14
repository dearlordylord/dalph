/* eslint-disable import/no-nodejs-modules -- the process adapter is the one explicit execution-substrate boundary. */
/* eslint-disable max-lines -- The protocol transport and ownership gate form one audited application boundary. */
import nodeProcess from "node:process"
import { randomUUID } from "node:crypto"
import nodeFsPromises from "node:fs/promises"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { setTimeout as nodeSetTimeout } from "node:timers"
import nodePath from "node:path"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import type { ChildProcessHandle } from "effect/unstable/process/ChildProcessSpawner"
import { AttemptId, PlannedAttemptExecutorCorrelation, RunId } from "@dalph/contracts"
import { Context, Deferred, Duration, Effect, Layer, Option, Ref, Schema, Semaphore, Stream } from "effect"
import {
  CodexAttemptStore,
  CodexAttemptStoreFailure,
  CodexOwnedTurnToken,
  CodexServerIncarnation,
  CodexThreadId,
  CodexTurnId,
  type CodexAttemptStoreService,
  type CodexServerLaunchRecord
} from "./codex-attempt-store.js"

/** The process-owned status projection returned by one Codex thread read. */
export type CodexThreadStatus = "active" | "idle" | "notLoaded" | "systemError"

/** One persisted Codex turn. Items remain opaque except for private input identity and correlation. */
export interface CodexTurnSnapshot {
  readonly id: CodexTurnId
  readonly status: "completed" | "interrupted" | "failed" | "inProgress"
  readonly items: ReadonlyArray<unknown>
  /** Exact Dalph marker recovered from user input, when this is an owned turn. */
  readonly ownedTurnToken?: CodexOwnedTurnToken
  /** Controlled transports may expose a provider-side correlation for contradiction tests. */
  readonly correlation?: PlannedAttemptExecutorCorrelation
}

/** The exact thread state needed to reconcile a private attempt association. */
export interface CodexThreadSnapshot {
  readonly id: CodexThreadId
  readonly cwd: string
  readonly status: CodexThreadStatus
  readonly turns: ReadonlyArray<CodexTurnSnapshot>
  /** Controlled transports may expose this to prove a foreign correlation. */
  readonly correlation?: PlannedAttemptExecutorCorrelation
}

/** An implementation-owned background terminal associated with a Codex thread. */
export interface CodexBackgroundTerminal {
  readonly processId: string
  readonly itemId: string
  readonly command: string
  readonly cwd: string
  readonly osPid?: number | null
}

/** App-server request boundary failures are deliberately richer than generic executor failures. */
export const CodexAppServerOperation = Schema.Literals([
  "initialize",
  "thread/start",
  "thread/read",
  "thread/resume",
  "turn/start",
  "turn/interrupt",
  "thread/backgroundTerminals/list",
  "thread/backgroundTerminals/terminate",
  "close"
])
export type CodexAppServerOperation = typeof CodexAppServerOperation.Type

export const CodexAppServerFailureKind = Schema.Literals([
  "Unavailable",
  "NotFound",
  "Protocol",
  "Ownership",
  "Malformed"
])
export type CodexAppServerFailureKind = typeof CodexAppServerFailureKind.Type

export class CodexAppServerFailure extends Schema.TaggedError<CodexAppServerFailure>()("CodexAppServerFailure", {
  detail: Schema.String,
  kind: CodexAppServerFailureKind,
  operation: CodexAppServerOperation
}) {}

/** A process-incarnation projection used before an app-server replacement is admitted. */
export type CodexServerOwnershipProjection =
  | { readonly _tag: "Absent" }
  | { readonly _tag: "ExactLive"; readonly pid: number }
  | { readonly _tag: "Unreadable"; readonly detail: string }
  | { readonly _tag: "Contradictory"; readonly detail: string }

/** The minimum execution-substrate authority needed for the no-second-owner gate. */
export interface CodexProcessOwnershipService {
  readonly observe: (
    launch: CodexServerLaunchRecord
  ) => Effect.Effect<CodexServerOwnershipProjection, CodexAppServerFailure>
  readonly stop: (launch: CodexServerLaunchRecord) => Effect.Effect<void, CodexAppServerFailure>
}

export class CodexProcessOwnership extends Context.Service<CodexProcessOwnership, CodexProcessOwnershipService>()(
  "@dalph/CodexProcessOwnership"
) {}

/** JSON-RPC transport-neutral app-server capability used by the private executor. */
// eslint-disable-next-line functional/no-mixed-types -- The service carries one immutable process-incarnation fact alongside its effectful boundary methods.
export interface CodexAppServerService {
  readonly incarnation: CodexServerIncarnation
  readonly startThread: (cwd: string) => Effect.Effect<CodexThreadSnapshot, CodexAppServerFailure>
  readonly readThread: (threadId: CodexThreadId) => Effect.Effect<CodexThreadSnapshot, CodexAppServerFailure>
  readonly resumeThread: (
    threadId: CodexThreadId,
    cwd: string
  ) => Effect.Effect<CodexThreadSnapshot, CodexAppServerFailure>
  readonly startTurn: (
    threadId: CodexThreadId,
    cwd: string,
    text: string,
    ownedTurnToken?: CodexOwnedTurnToken
  ) => Effect.Effect<CodexTurnSnapshot, CodexAppServerFailure>
  readonly interruptTurn: (threadId: CodexThreadId, turnId: CodexTurnId) => Effect.Effect<void, CodexAppServerFailure>
  readonly listBackgroundTerminals: (
    threadId: CodexThreadId
  ) => Effect.Effect<ReadonlyArray<CodexBackgroundTerminal>, CodexAppServerFailure>
  readonly terminateBackgroundTerminal: (
    threadId: CodexThreadId,
    processId: string
  ) => Effect.Effect<boolean, CodexAppServerFailure>
  /** Idempotent app-scope close; no workflow report is fabricated by this operation. */
  readonly close: Effect.Effect<void, CodexAppServerFailure>
}

export class CodexAppServer extends Context.Service<CodexAppServer, CodexAppServerService>()("@dalph/CodexAppServer") {}

/** Controlled transport injection for implementation tests. */
export const controlledCodexAppServerLayer = (service: CodexAppServerService): Layer.Layer<CodexAppServer> =>
  Layer.succeed(CodexAppServer, service)

/** Controlled process projection injection for ownership-gate tests. */
export const controlledCodexProcessOwnershipLayer = (
  service: CodexProcessOwnershipService
): Layer.Layer<CodexProcessOwnership> => Layer.succeed(CodexProcessOwnership, service)

const operationFailure = (
  operation: CodexAppServerOperation,
  kind: CodexAppServerFailureKind,
  detail: unknown
): CodexAppServerFailure => new CodexAppServerFailure({ operation, kind, detail: String(detail) })

const ownershipStopPollAttempts = 50
const ownershipStopPollDelayMilliseconds = 20 // eslint-disable-line no-magic-numbers -- bounded process-stop polling interval
const waitForOwnershipPoll = Effect.promise(
  () => new Promise<void>((resolve) => nodeSetTimeout(resolve, ownershipStopPollDelayMilliseconds))
)

const processErrorCode = (error: unknown): string => {
  if (typeof error !== "object" || error === null) return ""
  if ("code" in error) return String(error.code)
  return "cause" in error ? processErrorCode(error.cause) : ""
}

const processIdentitySeparator = "|"
const processStatAfterCommandOffset = 2
const linuxProcessStatStartTimeFieldIndex = 19
const execFileAsync = promisify(execFile)

/** Reads the host's process-start identity, which distinguishes PID reuse. */
const readProcessStartIdentity = async (pid: number): Promise<string | undefined> => {
  if (nodeProcess.platform === "linux") {
    const stat = await nodeFsPromises.readFile(`/proc/${pid}/stat`, "utf8")
    const commandEnd = stat.lastIndexOf(")")
    const fields =
      commandEnd < 0
        ? []
        : stat
            .slice(commandEnd + processStatAfterCommandOffset)
            .trim()
            .split(/\s+/)
    const startTime = fields[linuxProcessStatStartTimeFieldIndex]
    return startTime === undefined || startTime.length === 0 ? undefined : `linux:${startTime}`
  }
  if (nodeProcess.platform === "win32") {
    const { stdout: startTime } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", `(Get-Process -Id ${pid}).StartTime.ToFileTimeUtc()`],
      { encoding: "utf8" }
    )
    return startTime.trim().length === 0 ? undefined : `windows:${startTime.trim()}`
  }
  return undefined
}

const incarnationWithProcessIdentity = async (
  base: CodexServerIncarnation,
  pid: number
): Promise<CodexServerIncarnation | undefined> => {
  const identity = await readProcessStartIdentity(pid)
  return identity === undefined
    ? undefined
    : CodexServerIncarnation.make(`${base}${processIdentitySeparator}${encodeURIComponent(identity)}`)
}

const processIdentityFromIncarnation = (incarnation: CodexServerIncarnation): string | undefined => {
  const separator = incarnation.lastIndexOf(processIdentitySeparator)
  if (separator <= 0 || separator === incarnation.length - 1) return undefined
  try {
    return decodeURIComponent(incarnation.slice(separator + 1))
  } catch {
    return undefined
  }
}

const stringValue = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined

type JsonObject = Record<string, unknown>

const isJsonObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null

/*
 * The current app-server input contract accepts text only; it has no supported
 * caller metadata field. This exact machine-readable marker therefore travels
 * in user input and is recovered from the user-input item in thread/read.
 * Agent prose and turn-list position are deliberately never consulted.
 */
const ownedTurnMarkerPrefix = "<!-- dalph-owned-turn-token:v1:"
const ownedTurnMarkerSuffix = " -->"
const ownedTurnMarkerPattern = /<!-- dalph-owned-turn-token:v1:([^\s>]+) -->/g

/** The private text marker used when the app-server has no input metadata field. */
export const codexOwnedTurnMarker = (token: CodexOwnedTurnToken): string =>
  `${ownedTurnMarkerPrefix}${token}${ownedTurnMarkerSuffix}`

/** Adds the exact private marker to one user turn without relying on agent output. */
export const codexOwnedTurnInput = (text: string, token: CodexOwnedTurnToken): string =>
  `${text}\n\n${codexOwnedTurnMarker(token)}`

const markerTokenFromText = (text: string): ReadonlyArray<string> =>
  Array.from(text.matchAll(ownedTurnMarkerPattern), (match) => match[1]).filter(
    (token): token is string => token !== undefined
  )

const inputTextValues = (
  value: unknown,
  forceInputShape: boolean = false,
  userMessageContext: boolean = false
): ReadonlyArray<string> => {
  if (!isJsonObject(value)) return []
  const type = value["type"]
  const role = value["role"]
  const userMessageContainer = role === "user" || type === "userMessage" || type === "user_message"
  const recognized = forceInputShape || userMessageContext || userMessageContainer || type === "input_text"
  if (!recognized) return []
  const text = typeof value["text"] === "string" ? [value["text"]] : []
  const content = Array.isArray(value["content"])
    ? value["content"].flatMap((item) => inputTextValues(item, false, userMessageContext || userMessageContainer))
    : []
  const input = Array.isArray(value["input"])
    ? value["input"].flatMap((item) => inputTextValues(item, true, userMessageContext || userMessageContainer))
    : []
  return [...text, ...content, ...input]
}

const normalizeTurnCorrelation = (
  value: unknown,
  operation: CodexAppServerOperation
): PlannedAttemptExecutorCorrelation | CodexAppServerFailure | undefined => {
  if (value === undefined || value === null) return undefined
  if (!isJsonObject(value)) return operationFailure(operation, "Malformed", "turn correlation is invalid")
  const candidate = value
  if (typeof candidate["runId"] !== "string" || typeof candidate["attemptId"] !== "string") {
    return operationFailure(operation, "Malformed", "turn correlation is incomplete")
  }
  try {
    return Schema.decodeUnknownSync(PlannedAttemptExecutorCorrelation)({
      runId: RunId.make(candidate["runId"]),
      attemptId: AttemptId.make(candidate["attemptId"])
    })
  } catch (error) {
    return operationFailure(operation, "Malformed", `turn correlation is invalid: ${String(error)}`)
  }
}

const normalizeOwnedTurnToken = (
  value: unknown,
  operation: CodexAppServerOperation
): CodexOwnedTurnToken | CodexAppServerFailure | undefined => {
  if (value === undefined || value === null) return undefined
  const token = stringValue(value)
  if (token === undefined) return operationFailure(operation, "Malformed", "owned turn token is invalid")
  try {
    return CodexOwnedTurnToken.make(token)
  } catch (error) {
    return operationFailure(operation, "Malformed", `owned turn token is invalid: ${String(error)}`)
  }
}

const normalizeTurn = (
  value: unknown,
  operation: CodexAppServerOperation
): CodexTurnSnapshot | CodexAppServerFailure => {
  if (!isJsonObject(value)) return operationFailure(operation, "Malformed", "missing turn object")
  const source = value
  const id = stringValue(source["id"])
  const status = source["status"]
  if (
    id === undefined ||
    (status !== "completed" && status !== "interrupted" && status !== "failed" && status !== "inProgress")
  ) {
    return operationFailure(operation, "Malformed", "turn id or status is invalid")
  }
  const items = source["items"]
  if (items !== undefined && !Array.isArray(items))
    return operationFailure(operation, "Malformed", "turn items are invalid")
  const normalizedCorrelation = normalizeTurnCorrelation(source["correlation"], operation)
  if (normalizedCorrelation instanceof CodexAppServerFailure) return normalizedCorrelation
  const rawInputTexts = Array.isArray(source["input"])
    ? source["input"].flatMap((item) => inputTextValues(item, true))
    : []
  const rawItemTexts = Array.isArray(items) ? items.flatMap((item) => inputTextValues(item)) : []
  const inputMarkerValues = rawInputTexts.flatMap(markerTokenFromText)
  const itemMarkerValues = rawItemTexts.flatMap(markerTokenFromText)
  const markerValues = [...inputMarkerValues, ...itemMarkerValues]
  const directToken = normalizeOwnedTurnToken(source["ownedTurnToken"], operation)
  if (directToken instanceof CodexAppServerFailure) return directToken
  const distinctMarkerValues = [...new Set(markerValues)]
  if (inputMarkerValues.length > 1 || itemMarkerValues.length > 1 || distinctMarkerValues.length > 1) {
    return operationFailure(operation, "Malformed", "owned turn token marker is duplicated")
  }
  const markerToken = distinctMarkerValues[0]
  let normalizedToken: CodexOwnedTurnToken | undefined
  if (markerToken !== undefined) {
    const decoded = normalizeOwnedTurnToken(markerToken, operation)
    if (decoded instanceof CodexAppServerFailure) return decoded
    normalizedToken = decoded
  }
  if (directToken !== undefined && normalizedToken !== undefined && directToken !== normalizedToken) {
    return operationFailure(operation, "Malformed", "owned turn token metadata contradicts its input marker")
  }
  const ownedTurnToken = directToken ?? normalizedToken
  return {
    id: CodexTurnId.make(id),
    status,
    items: Array.isArray(items) ? items : [],
    ...(ownedTurnToken === undefined ? {} : { ownedTurnToken }),
    ...(normalizedCorrelation === undefined ? {} : { correlation: normalizedCorrelation })
  }
}

const normalizeThread = (
  value: unknown,
  operation: CodexAppServerOperation
): CodexThreadSnapshot | CodexAppServerFailure => {
  if (!isJsonObject(value)) return operationFailure(operation, "Malformed", "missing thread object")
  const source = value
  const id = stringValue(source["id"])
  const cwd = stringValue(source["cwd"])
  const statusValue = source["status"]
  const status = isJsonObject(statusValue) ? statusValue["type"] : statusValue
  if (
    id === undefined ||
    cwd === undefined ||
    (status !== "active" && status !== "idle" && status !== "notLoaded" && status !== "systemError")
  ) {
    return operationFailure(operation, "Malformed", "thread id, cwd, or status is invalid")
  }
  const rawTurns = source["turns"]
  if (rawTurns !== undefined && !Array.isArray(rawTurns))
    return operationFailure(operation, "Malformed", "thread turns are invalid")
  const turns = (rawTurns ?? []).map((rawTurn) => normalizeTurn(rawTurn, operation))
  const turnFailure = turns.find((turn): turn is CodexAppServerFailure => turn instanceof CodexAppServerFailure)
  if (turnFailure !== undefined) return turnFailure
  const normalizedTurns = turns.filter((turn): turn is CodexTurnSnapshot => !(turn instanceof CodexAppServerFailure))
  const correlationValue = source["correlation"]
  let correlation: PlannedAttemptExecutorCorrelation | undefined
  if (correlationValue !== undefined && correlationValue !== null) {
    if (!isJsonObject(correlationValue)) {
      return operationFailure(operation, "Malformed", "thread correlation is invalid")
    }
    const candidate = correlationValue
    if (typeof candidate["runId"] !== "string" || typeof candidate["attemptId"] !== "string") {
      return operationFailure(operation, "Malformed", "thread correlation is incomplete")
    }
    try {
      correlation = Schema.decodeUnknownSync(PlannedAttemptExecutorCorrelation)({
        runId: RunId.make(candidate["runId"]),
        attemptId: AttemptId.make(candidate["attemptId"])
      })
    } catch (error) {
      return operationFailure(operation, "Malformed", `thread correlation is invalid: ${String(error)}`)
    }
  }
  return {
    id: CodexThreadId.make(id),
    cwd,
    status,
    turns: normalizedTurns,
    ...(correlation === undefined ? {} : { correlation })
  }
}

const normalizeBackgroundTerminals = (
  value: unknown,
  operation: CodexAppServerOperation
): ReadonlyArray<CodexBackgroundTerminal> | CodexAppServerFailure => {
  if (!Array.isArray(value)) return operationFailure(operation, "Malformed", "background terminal list is invalid")
  const result = value.map((item) => {
    if (!isJsonObject(item)) return operationFailure(operation, "Malformed", "background terminal is invalid")
    const processId = stringValue(item["processId"])
    const itemId = stringValue(item["itemId"])
    const command = stringValue(item["command"])
    const cwd = stringValue(item["cwd"])
    const osPid = item["osPid"]
    if (processId === undefined || itemId === undefined || command === undefined || cwd === undefined) {
      return operationFailure(operation, "Malformed", "background terminal identity is invalid")
    }
    if (osPid !== undefined && osPid !== null && (typeof osPid !== "number" || !Number.isInteger(osPid) || osPid < 0)) {
      return operationFailure(operation, "Malformed", "background terminal process identity is invalid")
    }
    return { processId, itemId, command, cwd, osPid: typeof osPid === "number" ? osPid : null }
  })
  const failure = result.find(
    (terminal): terminal is CodexAppServerFailure => terminal instanceof CodexAppServerFailure
  )
  if (failure !== undefined) return failure
  return result.filter(
    (
      terminal
    ): terminal is {
      readonly processId: string
      readonly itemId: string
      readonly command: string
      readonly cwd: string
      readonly osPid: number | null
    } => !(terminal instanceof CodexAppServerFailure)
  )
}

// eslint-disable-next-line functional/no-mixed-types -- The private JSON-RPC transport closes as an effect value after request methods finish.
interface JsonRpcClient {
  readonly request: (
    operation: CodexAppServerOperation,
    method: string,
    params?: unknown
  ) => Effect.Effect<unknown, CodexAppServerFailure, never>
  readonly notify: (method: string, params?: unknown) => Effect.Effect<void, CodexAppServerFailure, never>
  readonly close: Effect.Effect<void, CodexAppServerFailure, never>
}

const makeJsonRpcClient = Effect.fn("CodexAppServer.makeJsonRpcClient")(function* (
  handle: ChildProcessHandle,
  incarnation: CodexServerIncarnation
) {
  const nextId = yield* Ref.make(1)
  const writes = yield* Semaphore.make(1)
  const closed = yield* Ref.make(false)
  const pending = yield* Ref.make<ReadonlyMap<number, Deferred.Deferred<unknown, CodexAppServerFailure>>>(new Map())
  const encoder = new TextEncoder()
  const failPending = (failure: CodexAppServerFailure) =>
    Ref.modify(
      pending,
      (current) => [[...current.values()].map((deferred) => Deferred.fail(deferred, failure)), new Map()] as const
    ).pipe(Effect.flatMap((effects) => Effect.forEach(effects, (effect) => effect, { discard: true })))
  const reader = handle.stdout.pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.runForEach((line: string) => {
      if (line.trim() === "") return Effect.void
      return Effect.try({
        try: () => {
          const parsed: unknown = JSON.parse(line)
          return parsed
        },
        catch: (error) => operationFailure("initialize", "Protocol", error)
      }).pipe(
        Effect.flatMap((parsed) =>
          isJsonObject(parsed)
            ? Effect.succeed(parsed)
            : Effect.fail(operationFailure("initialize", "Protocol", "JSON-RPC message is not an object"))
        ),
        Effect.flatMap((message) => {
          const id = message["id"]
          if (id === undefined) return Effect.void
          if (typeof id !== "number") {
            return failPending(operationFailure("initialize", "Protocol", "JSON-RPC response id is invalid"))
          }
          const result = Ref.modify(pending, (current) => {
            const deferred = current.get(id)
            if (deferred === undefined)
              return [Option.none<Deferred.Deferred<unknown, CodexAppServerFailure>>(), current] as const
            const next = new Map([...current].filter(([key]) => key !== id))
            return [Option.some(deferred), next] as const
          })
          return result.pipe(
            Effect.flatMap((maybeDeferred) => {
              if (Option.isNone(maybeDeferred)) return Effect.void
              if (typeof message["error"] === "object" && message["error"] !== null) {
                return Deferred.fail(
                  maybeDeferred.value,
                  operationFailure("initialize", "Protocol", JSON.stringify(message["error"]))
                )
              }
              return Deferred.succeed(maybeDeferred.value, message["result"])
            })
          )
        }),
        Effect.catch((error) =>
          failPending(
            error instanceof CodexAppServerFailure ? error : operationFailure("initialize", "Protocol", error)
          )
        )
      )
    })
  )
  yield* reader.pipe(
    Effect.ensuring(failPending(operationFailure("initialize", "Unavailable", "app-server stdout closed"))),
    Effect.forkScoped
  )
  // A noisy child must not block on stderr while the JSON-RPC reader waits on
  // stdout. Stderr is diagnostic-only and never participates in protocol state.
  yield* handle.stderr.pipe(
    Stream.runDrain,
    Effect.catch(() => Effect.void),
    Effect.forkScoped
  )

  const write = (message: Record<string, unknown>) =>
    writes.withPermit(
      Stream.run(Stream.succeed(encoder.encode(`${JSON.stringify(message)}\n`)), handle.stdin).pipe(
        Effect.mapError((error) => operationFailure("initialize", "Unavailable", error))
      )
    )
  const notify: JsonRpcClient["notify"] = Effect.fn("CodexAppServer.notify")(function* (
    method: string,
    params?: unknown
  ) {
    const isClosed = yield* Ref.get(closed)
    if (isClosed) return yield* Effect.fail(operationFailure("close", "Unavailable", "app-server is closed"))
    yield* write({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) })
  })
  const request: JsonRpcClient["request"] = Effect.fn("CodexAppServer.request")(function* (
    operation: CodexAppServerOperation,
    method: string,
    params?: unknown
  ) {
    const isClosed = yield* Ref.get(closed)
    if (isClosed) return yield* Effect.fail(operationFailure(operation, "Unavailable", "app-server is closed"))
    const id = yield* Ref.modify(nextId, (current) => [current, current + 1] as const)
    const deferred = yield* Deferred.make<unknown, CodexAppServerFailure>()
    yield* Ref.update(pending, (current) => new Map([...current, [id, deferred] as const]))
    yield* write({ jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) }).pipe(
      Effect.catch((error) =>
        Ref.update(pending, (current) => {
          return new Map([...current].filter(([key]) => key !== id))
        }).pipe(
          Effect.andThen(
            error instanceof CodexAppServerFailure
              ? Effect.fail(error)
              : Effect.fail(operationFailure(operation, "Unavailable", error))
          )
        )
      )
    )
    return yield* Deferred.await(deferred).pipe(
      Effect.mapError((error) =>
        error.operation === "initialize" ? operationFailure(operation, error.kind, error.detail) : error
      )
    )
  })
  const close = Effect.gen(function* () {
    const shouldClose = yield* Ref.modify(closed, (current) => [!current, true] as const)
    if (!shouldClose) return
    yield* failPending(operationFailure("close", "Unavailable", `app-server ${incarnation} closed`))
  })
  return { request, notify, close } satisfies JsonRpcClient
})

const responseObject = (
  value: unknown,
  operation: CodexAppServerOperation
): Record<string, unknown> | CodexAppServerFailure => {
  if (!isJsonObject(value)) return operationFailure(operation, "Malformed", "RPC response is not an object")
  return value
}

const CodexInitializeResponse = Schema.Struct({})

const normalizeInitializeResponse = (value: unknown): CodexAppServerFailure | true => {
  try {
    Schema.decodeUnknownSync(CodexInitializeResponse)(value)
    return true
  } catch (error) {
    return operationFailure("initialize", "Malformed", error)
  }
}

/** Default app-server executable and ambient-only protocol options. */
export interface CodexAppServerLayerConfig {
  readonly executable?: string
  readonly clientName?: string
  readonly clientVersion?: string
}

const defaultConfig: Required<CodexAppServerLayerConfig> = {
  executable: "codex",
  clientName: "dalph",
  clientVersion: "0.0.0"
}

const newIncarnation = (): CodexServerIncarnation => CodexServerIncarnation.make(randomUUID())

const unavailableAppServer = (failure: CodexAppServerFailure): CodexAppServerService => {
  const fail = (operation: CodexAppServerOperation) =>
    Effect.fail(new CodexAppServerFailure({ operation, kind: failure.kind, detail: failure.detail }))
  return {
    incarnation: newIncarnation(),
    startThread: () => fail("thread/start"),
    readThread: () => fail("thread/read"),
    resumeThread: () => fail("thread/resume"),
    startTurn: () => fail("turn/start"),
    interruptTurn: () => fail("turn/interrupt"),
    listBackgroundTerminals: () => fail("thread/backgroundTerminals/list"),
    terminateBackgroundTerminal: () => fail("thread/backgroundTerminals/terminate"),
    close: Effect.void
  }
}

const awaitOwnedProcessAbsent = (
  ownership: CodexProcessOwnershipService,
  launch: CodexServerLaunchRecord,
  remaining: number = ownershipStopPollAttempts
): Effect.Effect<void, CodexAppServerFailure> =>
  Effect.suspend(() =>
    ownership.observe(launch).pipe(
      Effect.flatMap((observed) => {
        if (observed._tag === "Absent") return Effect.void
        if (observed._tag === "Unreadable" || observed._tag === "Contradictory") {
          return Effect.fail(operationFailure("initialize", "Ownership", observed.detail))
        }
        if (observed.pid !== launch.pid) {
          return Effect.fail(operationFailure("initialize", "Ownership", "app-server process identity changed"))
        }
        if (remaining <= 0) {
          return Effect.fail(operationFailure("initialize", "Ownership", "previous app-server did not become absent"))
        }
        return waitForOwnershipPoll.pipe(Effect.andThen(awaitOwnedProcessAbsent(ownership, launch, remaining - 1)))
      })
    )
  )

const ownershipGate = Effect.fn("CodexAppServer.ownershipGate")(function* (
  store: CodexAttemptStoreService,
  ownership: CodexProcessOwnershipService,
  incarnation: CodexServerIncarnation,
  command: ReadonlyArray<string>
) {
  yield* store.acquireServerLease()
  const prior = yield* store.readServerLaunch()
  if (Option.isSome(prior)) {
    const observed = yield* ownership.observe(prior.value)
    if (observed._tag === "Unreadable" || observed._tag === "Contradictory") {
      return yield* Effect.fail(operationFailure("initialize", "Ownership", observed.detail))
    }
    if (observed._tag === "ExactLive") {
      if (prior.value.pid === null || observed.pid !== prior.value.pid) {
        return yield* Effect.fail(operationFailure("initialize", "Ownership", "app-server process identity changed"))
      }
      yield* ownership.stop(prior.value)
      yield* awaitOwnedProcessAbsent(ownership, prior.value)
    }
  }
  yield* store.writeServerLaunch({ command, incarnation, phase: "Launching", pid: null })
})

/**
 * Real application-scoped app-server layer. It deliberately sends no model,
 * provider, sandbox, approval, instruction, skill, or MCP options: Codex owns
 * those ambient choices. The exact worktree is supplied per thread and turn.
 */
export const codexAppServerLayer = (
  config: CodexAppServerLayerConfig = {}
): Layer.Layer<
  CodexAppServer,
  CodexAppServerFailure | CodexAttemptStoreFailure,
  CodexAttemptStore | CodexProcessOwnership | ChildProcessSpawner.ChildProcessSpawner
> =>
  Layer.effect(
    CodexAppServer,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const store = yield* CodexAttemptStore
      const ownership = yield* CodexProcessOwnership
      const selected = { ...defaultConfig, ...config }
      const command = [selected.executable, "app-server"] as const
      const incarnation = newIncarnation()
      yield* ownershipGate(store, ownership, incarnation, command)
      yield* Effect.addFinalizer(() => store.releaseServerLease().pipe(Effect.orDie))
      const handle = yield* spawner
        .spawn(
          ChildProcess.make(selected.executable, ["app-server"], {
            stdin: { stream: "pipe", endOnDone: false },
            stdout: "pipe",
            stderr: "pipe"
          })
        )
        .pipe(Effect.mapError((error) => operationFailure("initialize", "Unavailable", error)))
      // A spawned child is acknowledged durably before any identity lookup or
      // protocol turn. A restart can therefore reconcile this owner instead
      // of treating the old Launching intent as permission to spawn again.
      const spawnedLaunch: CodexServerLaunchRecord = { command, incarnation, phase: "Spawned", pid: Number(handle.pid) }
      yield* store.writeServerLaunch(spawnedLaunch).pipe(
        Effect.catch((error) =>
          handle.kill({ killSignal: "SIGTERM", forceKillAfter: Duration.seconds(1) }).pipe(
            Effect.catch((_: unknown) => Effect.void),
            Effect.andThen(Effect.fail(error))
          )
        )
      )
      const liveIncarnation = yield* Effect.tryPromise({
        try: () => incarnationWithProcessIdentity(incarnation, Number(handle.pid)),
        catch: (error) => operationFailure("initialize", "Ownership", error)
      })
      if (liveIncarnation === undefined) {
        return yield* Effect.fail(operationFailure("initialize", "Ownership", "process-start identity is missing"))
      }
      const liveLaunch: CodexServerLaunchRecord = {
        command,
        incarnation: liveIncarnation,
        phase: "Live",
        pid: Number(handle.pid)
      }
      const closeHandle = Effect.gen(function* () {
        // The managed child is detached on POSIX; dispose its owned process
        // group first so app-server descendants cannot outlive the scope.
        yield* ownership.stop(liveLaunch)
        yield* handle.isRunning.pipe(
          Effect.flatMap((running) =>
            running ? handle.kill({ killSignal: "SIGTERM", forceKillAfter: Duration.seconds(1) }) : Effect.void
          )
        )
        yield* store.clearServerLaunch(liveIncarnation)
      }).pipe(
        Effect.mapError((error) =>
          error instanceof CodexAttemptStoreFailure
            ? operationFailure("close", "Ownership", error)
            : operationFailure("close", "Unavailable", error)
        )
      )
      yield* Effect.addFinalizer(() => closeHandle.pipe(Effect.catch(() => Effect.void)))
      yield* store
        .writeServerLaunch(liveLaunch)
        .pipe(Effect.catch((error) => closeHandle.pipe(Effect.andThen(Effect.fail(error)))))
      const rpc = yield* makeJsonRpcClient(handle, liveIncarnation)
      const initializeResponse = yield* rpc.request("initialize", "initialize", {
        clientInfo: { name: selected.clientName, version: selected.clientVersion }
      })
      const normalizedInitialize = normalizeInitializeResponse(initializeResponse)
      if (normalizedInitialize !== true) return yield* Effect.fail(normalizedInitialize)
      yield* rpc.notify("initialized")
      const startThread = Effect.fn("CodexAppServer.startThread")(function* (cwd: string) {
        const response = responseObject(
          yield* rpc.request("thread/start", "thread/start", { cwd, ephemeral: false }),
          "thread/start"
        )
        if (response instanceof CodexAppServerFailure) return yield* Effect.fail(response)
        const thread = normalizeThread(response["thread"], "thread/start")
        return thread instanceof CodexAppServerFailure ? yield* Effect.fail(thread) : thread
      })
      const readThread = Effect.fn("CodexAppServer.readThread")(function* (threadId: CodexThreadId) {
        const response = responseObject(
          yield* rpc.request("thread/read", "thread/read", { threadId, includeTurns: true }),
          "thread/read"
        )
        if (response instanceof CodexAppServerFailure) return yield* Effect.fail(response)
        const thread = normalizeThread(response["thread"], "thread/read")
        return thread instanceof CodexAppServerFailure ? yield* Effect.fail(thread) : thread
      })
      const resumeThread = Effect.fn("CodexAppServer.resumeThread")(function* (threadId: CodexThreadId, cwd: string) {
        const response = responseObject(
          yield* rpc.request("thread/resume", "thread/resume", { threadId, cwd }),
          "thread/resume"
        )
        if (response instanceof CodexAppServerFailure) return yield* Effect.fail(response)
        const thread = normalizeThread(response["thread"], "thread/resume")
        return thread instanceof CodexAppServerFailure ? yield* Effect.fail(thread) : thread
      })
      const startTurn = Effect.fn("CodexAppServer.startTurn")(function* (
        threadId: CodexThreadId,
        cwd: string,
        text: string,
        ownedTurnToken?: CodexOwnedTurnToken
      ) {
        const response = responseObject(
          yield* rpc.request("turn/start", "turn/start", {
            threadId,
            cwd,
            input: [
              { type: "text", text: ownedTurnToken === undefined ? text : codexOwnedTurnInput(text, ownedTurnToken) }
            ]
          }),
          "turn/start"
        )
        if (response instanceof CodexAppServerFailure) return yield* Effect.fail(response)
        const turn = normalizeTurn(response["turn"], "turn/start")
        if (turn instanceof CodexAppServerFailure) return yield* Effect.fail(turn)
        if (ownedTurnToken === undefined) return turn
        if (turn.ownedTurnToken !== undefined && turn.ownedTurnToken !== ownedTurnToken) {
          return yield* Effect.fail(
            operationFailure("turn/start", "Malformed", "turn response token contradicts the requested token")
          )
        }
        return { ...turn, ownedTurnToken }
      })
      const interruptTurn = Effect.fn("CodexAppServer.interruptTurn")(function* (
        threadId: CodexThreadId,
        turnId: CodexTurnId
      ) {
        yield* rpc.request("turn/interrupt", "turn/interrupt", { threadId, turnId })
        return undefined
      })
      const listBackgroundTerminals = Effect.fn("CodexAppServer.listBackgroundTerminals")(function* (
        threadId: CodexThreadId
      ) {
        const response = responseObject(
          yield* rpc.request("thread/backgroundTerminals/list", "thread/backgroundTerminals/list", { threadId }),
          "thread/backgroundTerminals/list"
        )
        if (response instanceof CodexAppServerFailure) return yield* Effect.fail(response)
        const terminals = normalizeBackgroundTerminals(response["data"], "thread/backgroundTerminals/list")
        return terminals instanceof CodexAppServerFailure ? yield* terminals : terminals
      })
      const terminateBackgroundTerminal = Effect.fn("CodexAppServer.terminateBackgroundTerminal")(function* (
        threadId: CodexThreadId,
        processId: string
      ) {
        const response = responseObject(
          yield* rpc.request("thread/backgroundTerminals/terminate", "thread/backgroundTerminals/terminate", {
            threadId,
            processId
          }),
          "thread/backgroundTerminals/terminate"
        )
        if (response instanceof CodexAppServerFailure) return yield* Effect.fail(response)
        if (typeof response["terminated"] !== "boolean") {
          return yield* Effect.fail(
            operationFailure("thread/backgroundTerminals/terminate", "Malformed", "termination response is invalid")
          )
        }
        return response["terminated"]
      })
      let closed = false
      const close = Effect.suspend(() => {
        if (closed) return Effect.void
        closed = true
        return rpc.close.pipe(Effect.andThen(closeHandle))
      })
      return {
        incarnation: liveIncarnation,
        startThread,
        readThread,
        resumeThread,
        startTurn,
        interruptTurn,
        listBackgroundTerminals,
        terminateBackgroundTerminal,
        close
      } satisfies CodexAppServerService
    }).pipe(
      Effect.catch((error) =>
        error instanceof CodexAppServerFailure ? Effect.succeed(unavailableAppServer(error)) : Effect.fail(error)
      )
    )
  )

/** Node process ownership projection used by the default app-server layer. */
const nodeCodexProcessOwnershipService: CodexProcessOwnershipService = {
  observe: (launch) =>
    Effect.tryPromise({
      try: async () => {
        if (launch.pid === null) return { _tag: "Unreadable", detail: "launch intent has no process identity" } as const
        try {
          nodeProcess.kill(launch.pid, 0)
          const expectedExecutable = launch.command[0]
          const expectedMode = launch.command[1]
          if (expectedExecutable === undefined || expectedMode !== "app-server") {
            return { _tag: "Unreadable", detail: "server launch command is incomplete" } as const
          }
          if (nodeProcess.platform !== "linux" && nodeProcess.platform !== "win32") {
            return { _tag: "Unreadable", detail: "process command identity is unsupported on this platform" } as const
          }
          const commandLine =
            nodeProcess.platform === "linux"
              ? (await nodeFsPromises.readFile(`/proc/${launch.pid}/cmdline`, "utf8")).split("\u0000").filter(Boolean)
              : (
                  await execFileAsync("powershell.exe", [
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    `(Get-Process -Id ${launch.pid}).Path`
                  ])
                ).stdout
                  .trim()
                  .split(/\s+/)
          const executableName = nodePath.basename(expectedExecutable)
          const executableHasPath = nodePath.isAbsolute(expectedExecutable) || expectedExecutable.includes(nodePath.sep)
          const executableMatches = commandLine.some((argument) =>
            executableHasPath
              ? argument === expectedExecutable || argument === nodePath.resolve(expectedExecutable)
              : nodePath.basename(argument) === executableName
          )
          if (!executableMatches) {
            return { _tag: "Contradictory", detail: `pid ${launch.pid} is not the recorded Codex executable` } as const
          }
          if (!commandLine.includes(expectedMode)) {
            return { _tag: "Contradictory", detail: `pid ${launch.pid} is not an app-server command` } as const
          }
          const expectedProcessIdentity = processIdentityFromIncarnation(launch.incarnation)
          if (expectedProcessIdentity === undefined) {
            return { _tag: "Unreadable", detail: "server launch incarnation has no process-start identity" } as const
          }
          const observedProcessIdentity = await readProcessStartIdentity(launch.pid)
          if (observedProcessIdentity === undefined) {
            return { _tag: "Unreadable", detail: "observed process has no process-start identity" } as const
          }
          if (observedProcessIdentity !== expectedProcessIdentity) {
            return {
              _tag: "Contradictory",
              detail: `pid ${launch.pid} belongs to a different process incarnation`
            } as const
          }
          return { _tag: "ExactLive", pid: launch.pid } as const
        } catch (error) {
          const code = processErrorCode(error)
          return code === "ESRCH"
            ? ({ _tag: "Absent" } as const)
            : ({ _tag: "Unreadable", detail: `cannot observe app-server pid ${launch.pid}: ${String(error)}` } as const)
        }
      },
      catch: (error) => operationFailure("initialize", "Ownership", error)
    }),
  stop: (launch) => {
    if (launch.pid === null) return Effect.void
    const pid = launch.pid
    // The signal is authorized only after a fresh identity observation.
    const service = nodeCodexProcessOwnershipService
    return service.observe(launch).pipe(
      Effect.flatMap((observed) =>
        observed._tag === "ExactLive" && observed.pid === pid
          ? Effect.void
          : observed._tag === "Absent"
            ? Effect.void
            : Effect.fail(operationFailure("close", "Ownership", "process identity changed before signal"))
      ),
      Effect.andThen(
        Effect.suspend(() => {
          const groupSignal =
            nodeProcess.platform === "win32"
              ? Effect.tryPromise({
                  try: () => execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"]),
                  catch: (error) => error
                }).pipe(Effect.as(true))
              : Effect.try({ try: () => nodeProcess.kill(-pid, "SIGTERM"), catch: (error) => error }).pipe(
                  Effect.as(true)
                )
          return groupSignal
            .pipe(
              Effect.catch((error) =>
                processErrorCode(error) === "ESRCH"
                  ? Effect.try({ try: () => nodeProcess.kill(pid, "SIGTERM"), catch: (fallbackError) => fallbackError })
                  : Effect.fail(error)
              )
            )
            .pipe(Effect.catch((error) => (processErrorCode(error) === "ESRCH" ? Effect.void : Effect.fail(error))))
            .pipe(Effect.mapError((error) => operationFailure("close", "Ownership", error)))
        })
      )
    )
  }
}

export const nodeCodexProcessOwnershipLayer: Layer.Layer<CodexProcessOwnership> = Layer.succeed(
  CodexProcessOwnership,
  nodeCodexProcessOwnershipService
)

/** Convenience composition for the real app-server layer's process gate. */
export const codexAppServerNodeLayer = (
  config: CodexAppServerLayerConfig = {}
): Layer.Layer<
  CodexAppServer,
  CodexAppServerFailure | CodexAttemptStoreFailure,
  CodexAttemptStore | ChildProcessSpawner.ChildProcessSpawner
> => codexAppServerLayer(config).pipe(Layer.provide(nodeCodexProcessOwnershipLayer))

/** Conventional node-prefixed alias used by application composition. */
export const nodeCodexAppServerLayer = codexAppServerNodeLayer
