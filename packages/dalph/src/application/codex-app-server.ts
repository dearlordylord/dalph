/* eslint-disable import/no-nodejs-modules -- the process adapter is the one explicit execution-substrate boundary. */
/* eslint-disable max-lines -- The protocol transport and ownership gate form one audited application boundary. */
import { randomUUID } from "node:crypto"
import nodePath from "node:path"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import type { ChildProcessHandle } from "effect/unstable/process/ChildProcessSpawner"
import { PlannedAttemptExecutorCorrelation } from "@dalph/contracts"
import { Context, Deferred, Duration, Effect, Layer, Option, Ref, Result, Schema, Semaphore, Stream } from "effect"
import {
  ApplicationExitDiagnostic,
  ApplicationExitDrainFailure,
  ApplicationExitShell,
  type ApplicationExitShellService
} from "@dalph/orchestrator"
import {
  CodexAttemptStore,
  CodexAttemptStoreFailure,
  CodexOwnedTurnToken,
  CodexProcessIdentity,
  CodexServerIncarnation,
  CodexServerLeaseIncarnation,
  type CodexServerLeaseOwnerProjection,
  CodexServerLeaseRecord,
  CodexThreadId,
  CodexThreadOwnershipToken,
  CodexTurnId,
  type CodexAttemptStoreService,
  type CodexServerLaunchRecord
} from "./codex-attempt-store.js"
import {
  CodexProcessNative,
  nodeCodexProcessNativeLayer,
  nodeCodexProcessNativeService,
  type CodexProcessNativeService
} from "./codex-process-native.js"

/** The process-owned status projection returned by one Codex thread read. */
const CodexThreadStatus = Schema.Literals(["active", "idle", "notLoaded", "systemError"])
type CodexThreadStatus = typeof CodexThreadStatus.Type

/** The exact filesystem resource locator returned for one Codex thread. */
export const CodexThreadWorkingDirectory = Schema.NonEmptyString.pipe(Schema.brand("CodexThreadWorkingDirectory"))
export type CodexThreadWorkingDirectory = typeof CodexThreadWorkingDirectory.Type

/** Opaque continuation identity returned by the Codex thread-list boundary. */
const CodexThreadListCursor = Schema.NonEmptyString.pipe(Schema.brand("CodexThreadListCursor"))
type CodexThreadListCursor = typeof CodexThreadListCursor.Type

const CodexTurnStatus = Schema.Literals(["completed", "interrupted", "failed", "inProgress"])

const CodexExternalItem = Schema.Record(Schema.String, Schema.Json)
type CodexExternalItem = typeof CodexExternalItem.Type

/** User-authored request text returned through the Codex turn input field. */
const CodexTurnInputItem = Schema.Struct({ type: Schema.Literal("text"), text: Schema.String })

/** User-authored text nested inside a Codex user-message item. */
const CodexUserMessageInputText = Schema.Struct({ type: Schema.Literal("input_text"), text: Schema.String })

const CodexUserMessageByType = Schema.Struct({
  type: Schema.Literals(["userMessage", "user_message"]),
  role: Schema.optionalKey(Schema.Literal("user")),
  content: Schema.Array(CodexExternalItem)
})

const CodexUserMessageByRole = Schema.Struct({
  type: Schema.optionalKey(Schema.Literals(["userMessage", "user_message"])),
  role: Schema.Literal("user"),
  content: Schema.Array(CodexExternalItem)
})

const CodexUserMessage = Schema.Union([CodexUserMessageByType, CodexUserMessageByRole])

const CodexExternalItemDiscriminator = Schema.Struct({
  type: Schema.optionalKey(Schema.String),
  role: Schema.optionalKey(Schema.String)
})
type CodexExternalItemDiscriminator = typeof CodexExternalItemDiscriminator.Type

const CodexTurnItems = Schema.Array(CodexExternalItem)

const CodexThreadStatusBoundary = Schema.Union([CodexThreadStatus, Schema.Struct({ type: CodexThreadStatus })])

const CodexTurnBoundary = Schema.Struct({
  correlation: Schema.optionalKey(Schema.NullOr(PlannedAttemptExecutorCorrelation)),
  id: CodexTurnId,
  input: Schema.optionalKey(Schema.Array(CodexTurnInputItem)),
  items: Schema.optionalKey(CodexTurnItems),
  ownedTurnToken: Schema.optionalKey(Schema.NullOr(CodexOwnedTurnToken)),
  status: CodexTurnStatus
})
type CodexTurnBoundary = typeof CodexTurnBoundary.Type

const CodexThreadBoundaryMetadata = Schema.Struct({
  dalphOwnedThreadToken: Schema.optionalKey(Schema.NullOr(CodexThreadOwnershipToken))
})

const CodexThreadBoundaryFields = {
  correlation: Schema.optionalKey(Schema.NullOr(PlannedAttemptExecutorCorrelation)),
  cwd: CodexThreadWorkingDirectory,
  id: CodexThreadId,
  metadata: Schema.optionalKey(CodexThreadBoundaryMetadata),
  ownedThreadToken: Schema.optionalKey(Schema.NullOr(CodexThreadOwnershipToken)),
  status: Schema.optionalKey(CodexThreadStatusBoundary)
}

/** A Codex thread summary that does not claim complete turn coverage. */
const CodexThreadSummaryBoundary = Schema.Struct({
  ...CodexThreadBoundaryFields,
  turns: Schema.optionalKey(Schema.Array(CodexTurnBoundary))
})
type CodexThreadSummaryBoundary = typeof CodexThreadSummaryBoundary.Type

/** A Codex thread observation whose required turns field is a complete turn census. */
const CodexThreadTurnCensusBoundary = Schema.Struct({
  ...CodexThreadBoundaryFields,
  turns: Schema.Array(CodexTurnBoundary)
})
type CodexThreadTurnCensusBoundary = typeof CodexThreadTurnCensusBoundary.Type

const CodexThreadListValues = Schema.Array(CodexThreadSummaryBoundary)

const sameCodexThreadListValues = Schema.toEquivalence(CodexThreadListValues)

const CodexThreadListEnvelopeFields = Schema.Struct({
  data: Schema.optionalKey(CodexThreadListValues),
  threads: Schema.optionalKey(CodexThreadListValues),
  nextCursor: Schema.optionalKey(Schema.NullOr(CodexThreadListCursor)),
  next_cursor: Schema.optionalKey(Schema.NullOr(CodexThreadListCursor))
})

const threadListValuesPresent = Schema.makeFilter<typeof CodexThreadListEnvelopeFields.Type>((response) =>
  response.data === undefined && response.threads === undefined ? "thread list values are missing" : undefined
)

const threadListAliasesAgree = Schema.makeFilter<typeof CodexThreadListEnvelopeFields.Type>((response) => {
  if (
    response.data !== undefined &&
    response.threads !== undefined &&
    !sameCodexThreadListValues(response.data, response.threads)
  ) {
    return "thread list value aliases contradict each other"
  }
  if (
    response.nextCursor !== undefined &&
    response.next_cursor !== undefined &&
    response.nextCursor !== response.next_cursor
  ) {
    return "thread list cursor aliases contradict each other"
  }
})

const CodexThreadListEnvelope = CodexThreadListEnvelopeFields.pipe(
  Schema.check(threadListValuesPresent, threadListAliasesAgree)
)
type CodexThreadListEnvelope = typeof CodexThreadListEnvelope.Type

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
  readonly cwd: CodexThreadWorkingDirectory
  readonly status: CodexThreadStatus
  readonly turns: ReadonlyArray<CodexTurnSnapshot>
  /** Exact private marker returned by a thread-start request, when supplied. */
  readonly ownedThreadToken?: CodexThreadOwnershipToken
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
const CodexAppServerOperation = Schema.Literals([
  "initialize",
  "thread/start",
  "thread/list",
  "thread/read",
  "thread/resume",
  "turn/start",
  "turn/interrupt",
  "thread/backgroundTerminals/list",
  "thread/backgroundTerminals/terminate",
  "thread/ownedActivity/census",
  "thread/ownedActivity/terminate",
  "close"
])
type CodexAppServerOperation = typeof CodexAppServerOperation.Type

const CodexAppServerFailureKind = Schema.Literals([
  "Unavailable",
  "NotFound",
  "Protocol",
  "Ownership",
  "Malformed",
  "CorrelationContradiction"
])
type CodexAppServerFailureKind = typeof CodexAppServerFailureKind.Type

export class CodexAppServerFailure extends Schema.TaggedError<CodexAppServerFailure>()("CodexAppServerFailure", {
  detail: Schema.String,
  kind: CodexAppServerFailureKind,
  operation: CodexAppServerOperation
}) {}

/** Captures a native process-signal failure before the app-server adapter classifies it. */
class CodexProcessSignalFailure extends Schema.TaggedError<CodexProcessSignalFailure>()("CodexProcessSignalFailure", {
  cause: Schema.Defect()
}) {}

/** Process-start identity read from the execution substrate; a PID alone is not an owner identity. */
export const CodexProcessStartIdentity = Schema.NonEmptyString.pipe(Schema.brand("CodexProcessStartIdentity"))
export type CodexProcessStartIdentity = typeof CodexProcessStartIdentity.Type

/** One freshly observed member of an implementation-owned process tree. */
export interface CodexOwnedProcessIdentity {
  readonly pid: number
  readonly parentPid: number
  readonly processGroupId: number
  readonly startIdentity: CodexProcessStartIdentity
}

/** Typed census of the app-server process group and descendants. */
type CodexProcessGroupProjection =
  | { readonly _tag: "Absent" }
  | { readonly _tag: "ExactLive"; readonly members: ReadonlyArray<CodexOwnedProcessIdentity> }
  | { readonly _tag: "Unreadable"; readonly detail: string }
  | { readonly _tag: "Contradictory"; readonly detail: string }

/** Execution-substrate capability for observing every owned group member before and after a signal. */
interface CodexProcessGroupCensusService {
  readonly observe: (
    launch: CodexServerLaunchRecord
  ) => Effect.Effect<CodexProcessGroupProjection, CodexAppServerFailure>
}

class CodexProcessGroupCensus extends Context.Service<CodexProcessGroupCensus, CodexProcessGroupCensusService>()(
  "@dalph/CodexProcessGroupCensus"
) {}

/**
 * One activity that can still mutate a planned attempt. The app-server
 * process itself is deliberately not an activity in this algebra; its
 * application-scoped lifecycle is owned by CodexProcessGroupCensus instead.
 */
export type CodexOwnedActivity =
  | { readonly _tag: "ActiveTurn"; readonly turnId: CodexTurnId }
  | { readonly _tag: "BackgroundTerminal"; readonly terminal: CodexBackgroundTerminal }
  | { readonly _tag: "ProcessGroupDescendant"; readonly identity: CodexOwnedProcessIdentity }

/** Fresh, typed census of every known activity that can mutate one attempt. */
export type CodexOwnedActivityCensusProjection =
  | { readonly _tag: "Absent" }
  | { readonly _tag: "ExactLive"; readonly activities: ReadonlyArray<CodexOwnedActivity> }
  | { readonly _tag: "Unreadable"; readonly detail: string }
  | { readonly _tag: "Contradictory"; readonly detail: string }

/**
 * Selects which process facts one activity observation may own.
 *
 * An Integrator session owns only the exact thread and its reported terminal
 * processes. A planned task attempt additionally owns descendants carrying
 * the app-server's exact launch token, which is required to recover escaped
 * task processes after the app-server leader disappears.
 */
type CodexOwnedActivityScope = "IntegratorSession" | "PlannedAttempt"

/**
 * Activity authority. It accepts a thread and its fresh app-server activity
 * list, then observes execution-substrate descendants under the requested
 * ownership scope without accepting the app-server launch record itself as an
 * activity.
 */
interface CodexOwnedActivityCensusService {
  readonly observe: (
    thread: CodexThreadSnapshot,
    backgroundTerminals: ReadonlyArray<CodexBackgroundTerminal>,
    scope: CodexOwnedActivityScope
  ) => Effect.Effect<CodexOwnedActivityCensusProjection, CodexAppServerFailure>
  readonly terminateDescendants: (
    descendants: ReadonlyArray<CodexOwnedProcessIdentity>,
    scope: CodexOwnedActivityScope
  ) => Effect.Effect<void, CodexAppServerFailure>
}

export class CodexOwnedActivityCensus extends Context.Service<
  CodexOwnedActivityCensus,
  CodexOwnedActivityCensusService
>()("@dalph/CodexOwnedActivityCensus") {}

/** A process-incarnation projection used before an app-server replacement is admitted. */
type CodexServerOwnershipProjection =
  | { readonly _tag: "Absent" }
  | { readonly _tag: "ExactLive"; readonly pid: number }
  | { readonly _tag: "Unreadable"; readonly detail: string }
  | { readonly _tag: "Contradictory"; readonly detail: string }

/** Recovery census for a durable launch intent that has no acknowledged PID yet. */
type CodexServerDiscoveryProjection =
  | { readonly _tag: "Absent" }
  | { readonly _tag: "ExactLive"; readonly pid: number; readonly processIdentity: CodexProcessStartIdentity }
  | { readonly _tag: "Unreadable"; readonly detail: string }
  | { readonly _tag: "Contradictory"; readonly detail: string }

/** The minimum execution-substrate authority needed for the no-second-owner gate. */
interface CodexProcessOwnershipService {
  readonly observe: (
    target: CodexServerLaunchRecord | CodexServerLeaseRecord
  ) => Effect.Effect<CodexServerOwnershipProjection, CodexAppServerFailure>
  /** Finds only a child carrying the exact durable pre-spawn incarnation token. */
  readonly discover: (
    incarnation: CodexServerIncarnation
  ) => Effect.Effect<CodexServerDiscoveryProjection, CodexAppServerFailure>
  readonly stop: (launch: CodexServerLaunchRecord) => Effect.Effect<void, CodexAppServerFailure>
}

class CodexProcessOwnership extends Context.Service<CodexProcessOwnership, CodexProcessOwnershipService>()(
  "@dalph/CodexProcessOwnership"
) {}

/** JSON-RPC transport-neutral app-server capability used by the private executor. */
// eslint-disable-next-line functional/no-mixed-types -- The service carries one immutable process-incarnation fact alongside its effectful boundary methods.
export interface CodexAppServerService {
  readonly incarnation: CodexServerIncarnation
  /** Exact process root used only by the Node execution-substrate activity census. */
  readonly serverPid?: number
  readonly startThread: (
    cwd: string,
    ownedThreadToken?: CodexThreadOwnershipToken
  ) => Effect.Effect<CodexThreadSnapshot, CodexAppServerFailure>
  /** Complete persistent-thread identity read used to reconcile an ambiguous thread/start. */
  readonly listThreads?: () => Effect.Effect<ReadonlyArray<CodexThreadSnapshot>, CodexAppServerFailure>
  /** True only when the server completed the full persistent-thread listing. */
  readonly listThreadsComplete?: boolean
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

/** Controlled attempt-activity census injection for executor tests. */
export const controlledCodexOwnedActivityCensusLayer = (
  service: CodexOwnedActivityCensusService
): Layer.Layer<CodexOwnedActivityCensus> => Layer.succeed(CodexOwnedActivityCensus, service)

const operationFailure = (
  operation: CodexAppServerOperation,
  kind: CodexAppServerFailureKind,
  detail: unknown
): CodexAppServerFailure => new CodexAppServerFailure({ operation, kind, detail: String(detail) })

const initializeOwnershipFailure = (error: unknown): CodexAppServerFailure =>
  operationFailure("initialize", "Ownership", error)
const initializeProtocolFailure = (error: unknown): CodexAppServerFailure =>
  operationFailure("initialize", "Protocol", error)
const initializeUnavailableFailure = (error: unknown): CodexAppServerFailure =>
  operationFailure("initialize", "Unavailable", error)
const closeOwnershipFailure = (error: unknown): CodexAppServerFailure => operationFailure("close", "Ownership", error)
const processSignalFailure = (cause: unknown): CodexProcessSignalFailure => new CodexProcessSignalFailure({ cause })
export const ignoreEffectFailure = (): Effect.Effect<void> => Effect.void
export const preserveAppServerFailure =
  (operation: CodexAppServerOperation, kind: CodexAppServerFailureKind) =>
  (error: unknown): CodexAppServerFailure =>
    error instanceof CodexAppServerFailure ? error : operationFailure(operation, kind, error)

export const failAfterInitializationCleanup = (
  cleanup: Effect.Effect<void, unknown>,
  subject: string,
  error: CodexAppServerFailure | CodexAttemptStoreFailure
): Effect.Effect<never, CodexAppServerFailure | CodexAttemptStoreFailure> =>
  cleanup.pipe(
    Effect.matchEffect({
      onFailure: (cleanupError) =>
        Effect.fail(
          operationFailure(
            "initialize",
            "Ownership",
            `${error.detail}; ${subject} cleanup failed: ${String(cleanupError)}`
          )
        ),
      onSuccess: () => Effect.fail(error)
    })
  )

export const failAfterClose = (
  close: Effect.Effect<void, CodexAppServerFailure>,
  error: CodexAttemptStoreFailure
): Effect.Effect<never, CodexAppServerFailure | CodexAttemptStoreFailure> =>
  close.pipe(Effect.andThen(Effect.fail(error)))

const ownershipStopPollAttempts = 50
const ownershipStopPollDelayMilliseconds = 20 // eslint-disable-line no-magic-numbers -- bounded process-stop polling interval
const waitForOwnershipPoll = (native: CodexProcessNativeService): Effect.Effect<void> =>
  native.wait(ownershipStopPollDelayMilliseconds)

export const processErrorCode = (error: unknown): string => {
  if (typeof error !== "object" || error === null) return ""
  if ("code" in error) return String(error.code)
  return "cause" in error ? processErrorCode(error.cause) : ""
}

export const processWasAbsent = (error: unknown): boolean => {
  const code = processErrorCode(error)
  return code === "ENOENT" || code === "ESRCH" || /\b(?:ENOENT|ESRCH)\b/.test(String(error))
}

const processIdentitySeparator = "|"
const codexServerIncarnationEnvironment = "DALPH_CODEX_SERVER_INCARNATION"
const processStatAfterCommandOffset = 2
const linuxProcessStatStartTimeFieldIndex = 19

/** Reads the host's process-start identity, which distinguishes PID reuse. */
// eslint-disable-next-line complexity -- One platform adapter classifies exact Linux, Darwin, Windows, and unsupported identity observations.
const readProcessStartIdentity = async (
  pid: number,
  native: CodexProcessNativeService = nodeCodexProcessNativeService
): Promise<string | undefined> => {
  if (native.platform === "linux") {
    const stat = await native.readFile(`/proc/${pid}/stat`)
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
  /* v8 ignore start -- @preserve Darwin identity is exercised by the process-policy property suite and macOS qualification host. */
  if (native.platform === "darwin") {
    const { stdout } = await native.execFile("ps", ["-o", "lstart=", "-p", String(pid)])
    const started = stdout.trim()
    return started.length === 0 ? undefined : `darwin:${started}`
  }
  if (native.platform === "win32") {
    const { stdout: startTime } = await native.execFile("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `(Get-Process -Id ${pid}).StartTime.ToFileTimeUtc()`
    ])
    return windowsProcessIdentity(startTime)
  }
  return undefined
  /* v8 ignore stop -- @preserve */
}

export const incarnationWithProcessIdentity = async (
  base: CodexServerIncarnation,
  pid: number,
  native: CodexProcessNativeService = nodeCodexProcessNativeService
): Promise<CodexServerIncarnation | undefined> => {
  const identity = await readProcessStartIdentity(pid, native)
  return identity === undefined
    ? undefined
    : CodexServerIncarnation.make(`${base}${processIdentitySeparator}${encodeURIComponent(identity)}`)
}

/** Returns the durable token written before spawn, excluding the later PID identity suffix. */
export const durableIncarnationToken = (incarnation: CodexServerIncarnation): CodexServerIncarnation => {
  const separator = incarnation.indexOf(processIdentitySeparator)
  return CodexServerIncarnation.make(separator < 0 ? incarnation : incarnation.slice(0, separator))
}

export const processIdentityFromIncarnation = (incarnation: CodexServerIncarnation): string | undefined => {
  const separator = incarnation.lastIndexOf(processIdentitySeparator)
  if (separator <= 0 || separator === incarnation.length - 1) return undefined
  try {
    return decodeURIComponent(incarnation.slice(separator + 1))
  } catch {
    return undefined
  }
}

export const windowsProcessIdentity = (startTime: string): CodexProcessStartIdentity | undefined => {
  const normalized = startTime.trim()
  return normalized.length === 0 ? undefined : CodexProcessStartIdentity.make(`windows:${normalized}`)
}

/** Observes the current process owner identity for crash-recoverable lease reconciliation. */
// eslint-disable-next-line complexity -- Lease observation keeps platform support, absence, PID reuse, and unreadability fail-closed in one boundary.
export const observeLeaseOwner = async (
  owner: CodexServerLeaseRecord,
  native: CodexProcessNativeService = nodeCodexProcessNativeService
): Promise<CodexServerOwnershipProjection> => {
  /* v8 ignore next -- @preserve Unsupported-host identity is defensive; supported-host policies cover Linux, Darwin, and Windows. */
  if (native.platform !== "linux" && native.platform !== "darwin" && native.platform !== "win32") {
    return { _tag: "Unreadable", detail: "process-start identity is unsupported on this platform" }
  }
  try {
    /* v8 ignore else -- @preserve Windows lease fallback is defensive; issue #75 qualifies Linux and Darwin. */
    if (native.platform === "linux" || native.platform === "darwin") {
      const observed = await readProcessStatObservation(owner.pid, native)
      if (observed._tag === "Absent") return observed
      if (observed._tag === "Unreadable") return observed
      return String(observed.stat.startIdentity) === String(owner.processIdentity)
        ? { _tag: "ExactLive", pid: owner.pid }
        : { _tag: "Contradictory", detail: `lease pid ${owner.pid} belongs to a different process incarnation` }
    }
    /* v8 ignore start -- @preserve Windows lease fallback is outside the supported-host qualification contract. */
    native.kill(owner.pid, 0)
    const observedProcessIdentity = await readProcessStartIdentity(owner.pid, native)
    if (observedProcessIdentity === undefined) {
      return { _tag: "Unreadable", detail: "observed lease owner has no process-start identity" }
    }
    return observedProcessIdentity === owner.processIdentity
      ? { _tag: "ExactLive", pid: owner.pid }
      : { _tag: "Contradictory", detail: `lease pid ${owner.pid} belongs to a different process incarnation` }
  } catch (error) {
    return processErrorCode(error) === "ESRCH"
      ? { _tag: "Absent" }
      : { _tag: "Unreadable", detail: `cannot observe lease owner ${owner.pid}: ${String(error)}` }
    /* v8 ignore stop -- @preserve */
  }
}

export interface LinuxProcessStat {
  readonly pid: number
  readonly parentPid: number
  readonly processGroupId: number
  /** Linux `Z` processes are inert and count as absent at execution boundaries. */
  readonly processState?: string
  readonly startIdentity: CodexProcessStartIdentity
}

type LinuxProcessStatObservation =
  | { readonly _tag: "Absent" }
  | { readonly _tag: "Read"; readonly stat: LinuxProcessStat }
  | { readonly _tag: "Unreadable"; readonly detail: string }

const isNonnegativeInteger = (value: number): boolean => Number.isSafeInteger(value) && value >= 0
const isNonempty = (value: string | undefined): value is string => value !== undefined && value.length > 0

const parseLinuxProcessStat = (pid: number, text: string): LinuxProcessStat | undefined => {
  const commandEnd = text.lastIndexOf(")")
  if (commandEnd < 0) return undefined
  const fields = text
    .slice(commandEnd + processStatAfterCommandOffset)
    .trim()
    .split(/\s+/)
  const parentPid = Number(fields[1])
  const processGroupId = Number(fields[2])
  const processState = fields[0]
  const startTime = fields[linuxProcessStatStartTimeFieldIndex]
  if (
    !isNonnegativeInteger(parentPid) ||
    !isNonnegativeInteger(processGroupId) ||
    !isNonempty(processState) ||
    !isNonempty(startTime)
  ) {
    return undefined
  }
  return {
    pid,
    parentPid,
    processGroupId,
    processState,
    startIdentity: CodexProcessStartIdentity.make(`linux:${startTime}`)
  }
}

const readLinuxProcessStat = async (
  pid: number,
  native: CodexProcessNativeService
): Promise<LinuxProcessStat | undefined> => {
  const text = await native.readFile(`/proc/${pid}/stat`)
  return parseLinuxProcessStat(pid, text)
}

const readLinuxProcessStatObservation = async (
  pid: number,
  native: CodexProcessNativeService = nodeCodexProcessNativeService
): Promise<LinuxProcessStatObservation> => {
  try {
    const stat = await readLinuxProcessStat(pid, native)
    if (stat === undefined) {
      try {
        native.kill(pid, 0)
      } catch (error) {
        if (processWasAbsent(error)) return { _tag: "Absent" }
      }
      return { _tag: "Unreadable", detail: `process ${pid} stat is malformed` }
    }
    return stat.processState === "Z" ? { _tag: "Absent" } : { _tag: "Read", stat }
  } catch (error) {
    return processWasAbsent(error)
      ? { _tag: "Absent" }
      : { _tag: "Unreadable", detail: `cannot read process ${pid}: ${String(error)}` }
  }
}

/* v8 ignore start -- @preserve Darwin ps parsing is exercised by process-policy properties and macOS qualification. */
// eslint-disable-next-line complexity -- Every Darwin ps field is validated before it becomes one exact process identity.
const parseDarwinProcessStat = (line: string): LinuxProcessStat | undefined => {
  const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+?)\s*$/.exec(line)
  if (match === null) return undefined
  const pid = Number(match[1])
  const parentPid = Number(match[2])
  const processGroupId = Number(match[3])
  const processState = match[4]
  const started = match[5]
  if (
    !Number.isSafeInteger(pid) ||
    pid <= 0 ||
    !Number.isSafeInteger(parentPid) ||
    parentPid < 0 ||
    !Number.isSafeInteger(processGroupId) ||
    processGroupId <= 0 ||
    !isNonempty(processState) ||
    started === undefined ||
    started.length === 0
  ) {
    return undefined
  }
  return {
    pid,
    parentPid,
    processGroupId,
    processState,
    startIdentity: CodexProcessStartIdentity.make(`darwin:${started}`)
  }
}

const readDarwinProcessStats = async (
  native: CodexProcessNativeService
): Promise<
  | { readonly stats: ReadonlyArray<LinuxProcessStat> }
  | { readonly failure: Extract<LinuxProcessStatObservation, { readonly _tag: "Unreadable" }> }
> => {
  const { stdout } = await native.execFile("ps", ["-axo", "pid=,ppid=,pgid=,stat=,lstart="])
  const rows = stdout.split("\n").filter((line) => line.trim().length > 0)
  if (rows.length === 0) {
    return { failure: { _tag: "Unreadable", detail: "Darwin process census returned no processes" } }
  }
  const stats = rows.map(parseDarwinProcessStat)
  const malformedIndex = stats.findIndex((stat) => stat === undefined)
  if (malformedIndex >= 0) {
    return { failure: { _tag: "Unreadable", detail: `Darwin process census row ${malformedIndex + 1} is malformed` } }
  }
  return {
    stats: stats.filter(
      (stat): stat is LinuxProcessStat => stat !== undefined && stat.processState?.startsWith("Z") !== true
    )
  }
}
/* v8 ignore stop -- @preserve */

/* v8 ignore start -- @preserve Darwin live/absent probe outcomes are exercised by process-policy properties and the macOS qualification. */
const probeDarwinProcessAfterUnreadableStat = async (
  pid: number,
  detail: string,
  native: CodexProcessNativeService
): Promise<LinuxProcessStatObservation> => {
  try {
    native.kill(pid, 0)
    return { _tag: "Unreadable", detail }
  } catch (error) {
    return processWasAbsent(error)
      ? { _tag: "Absent" }
      : { _tag: "Unreadable", detail: `${detail}; process probe failed: ${String(error)}` }
  }
}
/* v8 ignore stop -- @preserve */

const readProcessStatObservation = async (
  pid: number,
  native: CodexProcessNativeService = nodeCodexProcessNativeService
): Promise<LinuxProcessStatObservation> => {
  if (native.platform === "linux") return readLinuxProcessStatObservation(pid, native)
  /* v8 ignore start -- @preserve Darwin exact-stat failures are exercised by process-policy properties outside coverage mode. */
  if (native.platform !== "darwin") return { _tag: "Unreadable", detail: "process stat is unsupported" }
  try {
    const { stdout } = await native.execFile("ps", ["-o", "pid=,ppid=,pgid=,stat=,lstart=", "-p", String(pid)])
    const stat = parseDarwinProcessStat(stdout.trim())
    if (stat !== undefined)
      return stat.processState?.startsWith("Z") === true ? { _tag: "Absent" } : { _tag: "Read", stat }
    return probeDarwinProcessAfterUnreadableStat(pid, `process ${pid} stat is malformed`, native)
  } catch (error) {
    return probeDarwinProcessAfterUnreadableStat(pid, `cannot read process ${pid}: ${String(error)}`, native)
  }
  /* v8 ignore stop -- @preserve */
}

type OwnedActivityProcessProjection =
  | { readonly _tag: "Absent" }
  | { readonly _tag: "ExactLive"; readonly members: ReadonlyArray<CodexOwnedProcessIdentity> }
  | { readonly _tag: "Unreadable"; readonly detail: string }
  | { readonly _tag: "Contradictory"; readonly detail: string }

const readNumericLinuxProcessStat = (
  entry: string,
  native: CodexProcessNativeService = nodeCodexProcessNativeService
): ReadonlyArray<Promise<LinuxProcessStatObservation>> => {
  if (!/^[0-9]+$/.test(entry)) return []
  const pid = Number(entry)
  if (!Number.isSafeInteger(pid) || pid <= 0) return []
  return [readLinuxProcessStatObservation(pid, native)]
}

type HostProcessStatsObservation =
  | { readonly stats: ReadonlyArray<LinuxProcessStat> }
  | { readonly failure: Extract<LinuxProcessStatObservation, { readonly _tag: "Unreadable" }> }

const readHostProcessStats = async (native: CodexProcessNativeService): Promise<HostProcessStatsObservation> => {
  /* v8 ignore next -- @preserve Darwin selection runs in process-policy properties and the macOS matrix. */
  if (native.platform === "darwin") return readDarwinProcessStats(native)
  const entries = await native.readdir("/proc")
  const observations: ReadonlyArray<LinuxProcessStatObservation> = await Promise.all(
    entries.flatMap((entry) => readNumericLinuxProcessStat(entry, native))
  )
  const unreadable = observations.find((result) => result._tag === "Unreadable")
  return unreadable === undefined
    ? { stats: observations.flatMap((result) => (result._tag === "Read" ? [result.stat] : [])) }
    : { failure: unreadable }
}

export const linuxProcessEffectiveUid = (status: string): string | undefined =>
  /^Uid:\s+\d+\s+(\d+)(?:\s|$)/m.exec(status)?.[1]

/** An unreadable environment may be skipped only after proving it belongs to another OS user. */
const linuxEnvironmentBelongsToForeignUser = async (
  pid: number,
  native: CodexProcessNativeService
): Promise<boolean> => {
  try {
    const [candidateStatus, ownerStatus] = await Promise.all([
      native.readFile(`/proc/${pid}/status`),
      native.readFile(`/proc/${native.pid}/status`)
    ])
    const candidateUid = linuxProcessEffectiveUid(candidateStatus)
    const ownerUid = linuxProcessEffectiveUid(ownerStatus)
    return candidateUid !== undefined && ownerUid !== undefined && candidateUid !== ownerUid
  } catch {
    return false
  }
}

type TokenMemberObservation = CodexOwnedProcessIdentity | { readonly detail: string } | undefined

const environmentCarriesToken = (
  environment: string,
  tokenEntry: string,
  platform: CodexProcessNativeService["platform"]
): boolean =>
  /* v8 ignore next -- @preserve Darwin token parsing is exercised by process-policy properties and the macOS qualification. */
  platform === "linux"
    ? environment.split("\u0000").includes(tokenEntry)
    : environment.split(/\s+/).includes(tokenEntry)

type DarwinProcessCommandsObservation =
  | { readonly commands: ReadonlyMap<number, string> }
  | { readonly failure: { readonly detail: string } }

const parseDarwinProcessCommand = (row: string): readonly [number, string] | undefined => {
  const match = /^\s*(\d+)\s+(.+?)\s*$/.exec(row)
  const pid = match === null ? Number.NaN : Number(match[1])
  const command = match?.[2]
  return Number.isSafeInteger(pid) && pid > 0 && command !== undefined && command.length > 0
    ? [pid, command]
    : undefined
}

/** Reads every Darwin command/environment row in one bounded host observation. */
const readDarwinProcessCommands = async (
  native: CodexProcessNativeService
): Promise<DarwinProcessCommandsObservation> => {
  try {
    const { stdout } = await native.execFile("ps", ["eww", "-axo", "pid=,command="])
    const rows = stdout.split("\n").filter((line) => line.trim().length > 0)
    if (rows.length === 0) return { failure: { detail: "Darwin process command census returned no processes" } }
    const parsed = rows.map(parseDarwinProcessCommand)
    const malformedIndex = parsed.findIndex((row) => row === undefined)
    if (malformedIndex >= 0) {
      return { failure: { detail: `Darwin process command census row ${malformedIndex + 1} is malformed` } }
    }
    const commands = new Map(parsed.filter((row): row is readonly [number, string] => row !== undefined))
    if (commands.size !== rows.length) return { failure: { detail: "Darwin process command census repeats a pid" } }
    return { commands }
  } catch (error) {
    return { failure: { detail: `cannot read Darwin process command census: ${String(error)}` } }
  }
}

const tokenReadFailure = async (
  pid: number,
  error: unknown,
  native: CodexProcessNativeService
): Promise<TokenMemberObservation> => {
  /* v8 ignore next -- @preserve Vanished token candidates are exercised by the controlled process-policy suite. */
  if (processWasAbsent(error)) return undefined
  const becameInert =
    processErrorCode(error) === "EACCES" &&
    native.platform === "linux" &&
    (await readLinuxProcessStatObservation(pid, native))._tag === "Absent"
  const provenForeign =
    processErrorCode(error) === "EACCES" &&
    native.platform === "linux" &&
    (await linuxEnvironmentBelongsToForeignUser(pid, native))
  return becameInert || provenForeign
    ? undefined
    : { detail: `cannot read process ${pid} launch token: ${String(error)}` }
}

const readTokenMember = async (
  stat: LinuxProcessStat,
  token: CodexServerIncarnation,
  native: CodexProcessNativeService
): Promise<TokenMemberObservation> => {
  try {
    const environment =
      /* v8 ignore next -- @preserve Darwin token reads are exercised by process-policy properties and the macOS qualification. */
      native.platform === "linux"
        ? await native.readFile(`/proc/${stat.pid}/environ`)
        : (await native.execFile("ps", ["eww", "-o", "command=", "-p", String(stat.pid)])).stdout
    if (!environmentCarriesToken(environment, `${codexServerIncarnationEnvironment}=${token}`, native.platform)) {
      return undefined
    }
    return {
      pid: stat.pid,
      parentPid: stat.parentPid,
      processGroupId: stat.processGroupId,
      startIdentity: stat.startIdentity
    }
  } catch (error) {
    return tokenReadFailure(stat.pid, error, native)
  }
}

/* v8 ignore start -- @preserve Darwin batch token census is exercised by process-policy properties and macOS qualification. */
const readDarwinTokenMembers = async (
  stats: ReadonlyArray<LinuxProcessStat>,
  token: CodexServerIncarnation,
  native: CodexProcessNativeService
): Promise<ReadonlyArray<TokenMemberObservation>> => {
  const observation = await readDarwinProcessCommands(native)
  if ("failure" in observation) return [observation.failure]
  const tokenEntry = `${codexServerIncarnationEnvironment}=${token}`
  return stats.flatMap((stat) => {
    const command = observation.commands.get(stat.pid)
    return command !== undefined && environmentCarriesToken(command, tokenEntry, "darwin")
      ? [
          {
            pid: stat.pid,
            parentPid: stat.parentPid,
            processGroupId: stat.processGroupId,
            startIdentity: stat.startIdentity
          }
        ]
      : []
  })
}
/* v8 ignore stop -- @preserve */

export const isLinuxProcessDescendant = (
  rootPid: number,
  byPid: ReadonlyMap<number, LinuxProcessStat>,
  candidate: LinuxProcessStat
): boolean => {
  let parentPid = candidate.parentPid
  const seen = new Set<number>()
  while (parentPid !== 0 && !seen.has(parentPid)) {
    if (parentPid === rootPid) return true
    // This local visited set is an observation guard, not mutable domain state.
    // eslint-disable-next-line functional/immutable-data -- process-tree traversal needs one local visited marker.
    seen.add(parentPid)
    const parent = byPid.get(parentPid)
    if (parent === undefined) return false
    parentPid = parent.parentPid
  }
  return false
}

const isOwnedActivityMember = (
  rootPid: number,
  root: LinuxProcessStat,
  byPid: ReadonlyMap<number, LinuxProcessStat>,
  candidate: LinuxProcessStat
): boolean =>
  candidate.processGroupId === root.processGroupId ||
  candidate.pid === rootPid ||
  isLinuxProcessDescendant(rootPid, byPid, candidate)

const collectOwnedActivityMembers = (
  roots: ReadonlyArray<number>,
  byPid: ReadonlyMap<number, LinuxProcessStat>
): OwnedActivityProcessProjection => {
  const members = new Map<number, CodexOwnedProcessIdentity>()
  for (const rootPid of roots) {
    const root = byPid.get(rootPid)
    if (root === undefined) continue
    if (root.processGroupId <= 0) {
      return { _tag: "Contradictory", detail: `attempt activity ${rootPid} has no valid process group` }
    }
    for (const candidate of byPid.values()) {
      if (!isOwnedActivityMember(rootPid, root, byPid, candidate)) continue
      // This local map is an observation accumulator, not mutable domain state.
      // eslint-disable-next-line functional/immutable-data -- process census deduplicates one fresh snapshot.
      members.set(candidate.pid, {
        pid: candidate.pid,
        parentPid: candidate.parentPid,
        processGroupId: candidate.processGroupId,
        startIdentity: candidate.startIdentity
      })
    }
  }
  return members.size === 0 ? { _tag: "Absent" } : { _tag: "ExactLive", members: [...members.values()] }
}

/**
 * Reads only process trees rooted at app-server-reported attempt activities.
 * The app-server launch process is never an input to this capability and is
 * therefore never silently folded into an attempt census.
 */
// eslint-disable-next-line complexity -- The fresh census joins roots, durable tokens, process groups, and fail-closed host observations once.
const observeOwnedActivityProcesses = async (
  roots: ReadonlyArray<number>,
  native: CodexProcessNativeService = nodeCodexProcessNativeService,
  incarnation?: CodexServerIncarnation,
  appServerPid?: number
): Promise<OwnedActivityProcessProjection> => {
  if (roots.length === 0 && incarnation === undefined) return { _tag: "Absent" }
  if (native.platform !== "linux" && native.platform !== "darwin") {
    return { _tag: "Unreadable", detail: "owned attempt process census is not qualified on this host" }
  }
  const uniqueRoots = [...new Set(roots)]
  const hostObservation = await readHostProcessStats(native)
  if ("failure" in hostObservation) return hostObservation.failure
  const hostStats = hostObservation.stats
  const byPid = new Map<number, LinuxProcessStat>(hostStats.map((stat) => [stat.pid, stat]))
  /* v8 ignore next -- @preserve Standalone controlled census and production app-scoped composition exercise opposite sides in separate gates. */
  const appServerProcessGroupId = appServerPid === undefined ? undefined : byPid.get(appServerPid)?.processGroupId
  const projection = collectOwnedActivityMembers(uniqueRoots, byPid)
  if (projection._tag === "Unreadable" || projection._tag === "Contradictory") return projection
  const projectedMembers = projection._tag === "ExactLive" ? projection.members : []
  /* v8 ignore start -- @preserve Durable-token and escaped-child branches run in the real Linux/macOS qualification gate. */
  const token = incarnation === undefined ? undefined : durableIncarnationToken(incarnation)
  const tokenMembers =
    token === undefined
      ? []
      : native.platform === "darwin"
        ? await readDarwinTokenMembers([...byPid.values()], token, native)
        : await Promise.all([...byPid.values()].map((stat) => readTokenMember(stat, token, native)))
  const tokenFailure = tokenMembers.find((member) => member !== undefined && "detail" in member)
  if (tokenFailure !== undefined && "detail" in tokenFailure) return { _tag: "Unreadable", detail: tokenFailure.detail }
  const exactTokenMembers = tokenMembers.filter(
    (member): member is CodexOwnedProcessIdentity => member !== undefined && "pid" in member
  )
  const allMembers = [
    ...new Map([...projectedMembers, ...exactTokenMembers].map((member) => [member.pid, member])).values()
  ]
  const members = await Promise.all(
    allMembers.map(async (member) => {
      if (
        appServerPid !== undefined &&
        (member.pid === appServerPid || member.processGroupId === appServerProcessGroupId)
      ) {
        return undefined
      }
      try {
        const commandLine =
          native.platform === "linux"
            ? (await native.readFile(`/proc/${member.pid}/cmdline`)).split("\u0000").filter(Boolean)
            : (await native.execFile("ps", ["-o", "command=", "-p", String(member.pid)])).stdout.trim().split(/\s+/)
        return commandLine.includes("app-server") ? undefined : member
      } catch (error) {
        return processWasAbsent(error) ? {} : { detail: `cannot read process ${member.pid} command: ${String(error)}` }
      }
    })
  )
  const commandFailure = members.find((member) => member !== undefined && "detail" in member)
  if (commandFailure !== undefined && "detail" in commandFailure) {
    return { _tag: "Unreadable", detail: commandFailure.detail }
  }
  const attemptMembers = members.filter(
    (member): member is CodexOwnedProcessIdentity => member !== undefined && "pid" in member
  )
  return attemptMembers.length === 0 ? { _tag: "Absent" } : { _tag: "ExactLive", members: attemptMembers }
  /* v8 ignore stop -- @preserve */
}

// eslint-disable-next-line complexity -- Exact cleanup revalidates absence, identity, group, Darwin token, and signal outcome before acting.
const terminateExactOwnedActivityMember = async (
  member: CodexOwnedProcessIdentity,
  native: CodexProcessNativeService = nodeCodexProcessNativeService,
  incarnation?: CodexServerIncarnation
): Promise<CodexAppServerFailure | undefined> => {
  const observed = await readProcessStatObservation(member.pid, native)
  if (observed._tag === "Absent") return
  if (observed._tag === "Unreadable") {
    return operationFailure("thread/ownedActivity/terminate", "Ownership", observed.detail)
  }
  if (observed.stat.startIdentity !== member.startIdentity || observed.stat.processGroupId !== member.processGroupId) {
    return operationFailure(
      "thread/ownedActivity/terminate",
      "Ownership",
      `attempt descendant ${member.pid} changed identity before signal`
    )
  }
  /* v8 ignore start -- @preserve Darwin same-second PID-reuse revalidation is exercised by process-policy properties. */
  if (incarnation !== undefined) {
    const token = await observeDarwinIncarnationToken(member.pid, incarnation, native)
    if (token._tag === "Absent") return
    if (token._tag === "Unreadable" || token._tag === "Contradictory") {
      return operationFailure("thread/ownedActivity/terminate", "Ownership", token.detail)
    }
  }
  /* v8 ignore stop -- @preserve */
  try {
    native.kill(member.pid, "SIGTERM")
  } catch (error) {
    if (!processWasAbsent(error)) return operationFailure("thread/ownedActivity/terminate", "Ownership", error)
  }
}

/** Signals only a freshly revalidated attempt descendant identity. */
const terminateExactOwnedActivityProcesses = async (
  members: ReadonlyArray<CodexOwnedProcessIdentity>,
  native: CodexProcessNativeService = nodeCodexProcessNativeService,
  incarnation?: CodexServerIncarnation
): Promise<CodexAppServerFailure | undefined> => {
  if (members.length === 0) return
  if (native.platform !== "linux" && native.platform !== "darwin") {
    return operationFailure(
      "thread/ownedActivity/terminate",
      "Ownership",
      "owned attempt process stop is not qualified"
    )
  }
  for (const member of members) {
    const failure = await terminateExactOwnedActivityMember(member, native, incarnation)
    if (failure !== undefined) return failure
  }
}

type OwnedActivityTurnObservation =
  | { readonly _tag: "Valid"; readonly activeTurns: ReadonlyArray<CodexTurnSnapshot> }
  | { readonly _tag: "Contradictory"; readonly detail: string }

/** Rejects an active thread that cannot identify exactly one in-progress turn. */
const observeOwnedActivityTurns = (thread: CodexThreadSnapshot): OwnedActivityTurnObservation => {
  const activeTurns = thread.turns.filter((turn) => turn.status === "inProgress")
  if (thread.status === "active" && activeTurns.length === 0) {
    return { _tag: "Contradictory", detail: "active thread has no in-progress turn" }
  }
  if (activeTurns.length > 1) {
    return { _tag: "Contradictory", detail: "thread has multiple in-progress turns" }
  }
  return { _tag: "Valid", activeTurns }
}

/** Selects process roots reported by the app-server without treating the app-server itself as activity. */
const processRootsForBackgroundTerminals = (
  backgroundTerminals: ReadonlyArray<CodexBackgroundTerminal>
): ReadonlyArray<number> =>
  backgroundTerminals.flatMap((terminal) =>
    terminal.osPid === null || terminal.osPid === undefined ? [] : [terminal.osPid]
  )

/** Node attempt-activity authority; server launch ownership remains separate. */
export const makeNodeCodexOwnedActivityCensusService = (
  native: CodexProcessNativeService = nodeCodexProcessNativeService,
  appServerPid?: number,
  incarnation?: CodexServerIncarnation
): CodexOwnedActivityCensusService => ({
  observe: (thread, backgroundTerminals, scope) =>
    Effect.tryPromise({
      try: async (): Promise<CodexOwnedActivityCensusProjection> => {
        const turnObservation = observeOwnedActivityTurns(thread)
        if (turnObservation._tag === "Contradictory") return turnObservation
        const processProjection = await observeOwnedActivityProcesses(
          processRootsForBackgroundTerminals(backgroundTerminals),
          native,
          scope === "PlannedAttempt" ? incarnation : undefined,
          appServerPid
        )
        if (processProjection._tag === "Unreadable" || processProjection._tag === "Contradictory") {
          return processProjection
        }
        const activities: Array<CodexOwnedActivity> = [
          ...turnObservation.activeTurns.map((turn) => ({ _tag: "ActiveTurn" as const, turnId: turn.id })),
          ...backgroundTerminals.map((terminal) => ({ _tag: "BackgroundTerminal" as const, terminal })),
          ...(processProjection._tag === "ExactLive"
            ? processProjection.members
                .filter((identity) => identity.pid !== appServerPid)
                .map((identity) => ({ _tag: "ProcessGroupDescendant" as const, identity }))
            : [])
        ]
        return activities.length === 0 ? { _tag: "Absent" } : { _tag: "ExactLive", activities }
      },
      catch: preserveAppServerFailure("thread/ownedActivity/census", "Ownership")
    }),
  terminateDescendants: (descendants, scope) =>
    Effect.tryPromise({
      try: () =>
        terminateExactOwnedActivityProcesses(descendants, native, scope === "PlannedAttempt" ? incarnation : undefined),
      catch: preserveAppServerFailure("thread/ownedActivity/terminate", "Ownership")
    }).pipe(
      Effect.flatMap((failure) =>
        failure === undefined
          ? awaitExactMembersAbsent(descendants, ownershipStopPollAttempts, native)
          : Effect.fail(failure)
      )
    )
})

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
const codexOwnedTurnMarker = (token: CodexOwnedTurnToken): string =>
  `${ownedTurnMarkerPrefix}${token}${ownedTurnMarkerSuffix}`

/** Adds the exact private marker to one user turn without relying on agent output. */
const codexOwnedTurnInput = (text: string, token: CodexOwnedTurnToken): string =>
  `${text}\n\n${codexOwnedTurnMarker(token)}`

const markerTokenFromText = (text: string): ReadonlyArray<string> =>
  Array.from(text.matchAll(ownedTurnMarkerPattern), (match) => match[1]).filter(
    (token): token is string => token !== undefined
  )

const isUserMessageDiscriminator = (discriminator: CodexExternalItemDiscriminator): boolean =>
  discriminator.role === "user" || discriminator.type === "userMessage" || discriminator.type === "user_message"

const userMessageContentText = (
  content: CodexExternalItem,
  operation: CodexAppServerOperation
): string | CodexAppServerFailure | undefined => {
  const discriminator = Schema.decodeUnknownResult(CodexExternalItemDiscriminator)(content)
  if (Result.isFailure(discriminator)) {
    return operationFailure(
      operation,
      "Malformed",
      `user-authored turn content discriminator is invalid: ${String(discriminator.failure)}`
    )
  }
  if (discriminator.success.type !== "input_text") return undefined
  const inputText = Schema.decodeUnknownResult(CodexUserMessageInputText)(content)
  return Result.isSuccess(inputText)
    ? inputText.success.text
    : operationFailure(operation, "Malformed", `user-authored input text is invalid: ${String(inputText.failure)}`)
}

const userMessageInputTexts = (
  item: CodexExternalItem,
  operation: CodexAppServerOperation
): ReadonlyArray<string> | CodexAppServerFailure => {
  const discriminator = Schema.decodeUnknownResult(CodexExternalItemDiscriminator)(item)
  if (Result.isFailure(discriminator)) {
    return operationFailure(
      operation,
      "Malformed",
      `turn item discriminator is invalid: ${String(discriminator.failure)}`
    )
  }
  if (!isUserMessageDiscriminator(discriminator.success)) return []
  const userMessage = Schema.decodeUnknownResult(CodexUserMessage)(item)
  if (Result.isFailure(userMessage)) {
    return operationFailure(
      operation,
      "Malformed",
      `user-authored turn item is invalid: ${String(userMessage.failure)}`
    )
  }
  const texts = userMessage.success.content.map((content) => userMessageContentText(content, operation))
  const failure = texts.find((text): text is CodexAppServerFailure => text instanceof CodexAppServerFailure)
  return failure ?? texts.filter((text): text is string => typeof text === "string")
}

const normalizeOwnedTurnToken = (
  value: unknown,
  operation: CodexAppServerOperation
): CodexOwnedTurnToken | CodexAppServerFailure | undefined => {
  if (value === undefined || value === null) return undefined
  const decoded = Schema.decodeUnknownResult(CodexOwnedTurnToken)(value)
  return Result.isSuccess(decoded)
    ? decoded.success
    : operationFailure(operation, "Malformed", `owned turn token is invalid: ${String(decoded.failure)}`)
}

const hasDuplicateOwnedTurnMarkers = (
  inputMarkerValues: ReadonlyArray<string>,
  itemMarkerValues: ReadonlyArray<string>,
  distinctMarkerValues: ReadonlyArray<string>
): boolean => inputMarkerValues.length > 1 || itemMarkerValues.length > 1 || distinctMarkerValues.length > 1

type TurnMarkerValues = {
  readonly inputMarkerValues: ReadonlyArray<string>
  readonly itemMarkerValues: ReadonlyArray<string>
  readonly distinctMarkerValues: ReadonlyArray<string>
}

const userMessageTexts = (
  items: ReadonlyArray<CodexExternalItem>,
  operation: CodexAppServerOperation
): ReadonlyArray<string> | CodexAppServerFailure => {
  const itemTexts = items.map((item) => userMessageInputTexts(item, operation))
  const failure = itemTexts.find((texts): texts is CodexAppServerFailure => texts instanceof CodexAppServerFailure)
  return failure ?? itemTexts.flatMap((texts) => (texts instanceof CodexAppServerFailure ? [] : texts))
}

const turnMarkerValues = (
  source: CodexTurnBoundary,
  operation: CodexAppServerOperation
): TurnMarkerValues | CodexAppServerFailure => {
  const rawInputTexts = source.input?.map((item) => item.text) ?? []
  const rawItemTexts = userMessageTexts(source.items ?? [], operation)
  if (rawItemTexts instanceof CodexAppServerFailure) return rawItemTexts
  const inputMarkerValues = rawInputTexts.flatMap(markerTokenFromText)
  const itemMarkerValues = rawItemTexts.flatMap(markerTokenFromText)
  return {
    inputMarkerValues,
    itemMarkerValues,
    distinctMarkerValues: [...new Set([...inputMarkerValues, ...itemMarkerValues])]
  }
}

const normalizeOwnedTurnTokenFromMarkers = (
  markerValues: TurnMarkerValues,
  directToken: CodexOwnedTurnToken | undefined,
  operation: CodexAppServerOperation
): CodexOwnedTurnToken | CodexAppServerFailure | undefined => {
  const { distinctMarkerValues, inputMarkerValues, itemMarkerValues } = markerValues
  if (hasDuplicateOwnedTurnMarkers(inputMarkerValues, itemMarkerValues, distinctMarkerValues)) {
    return operationFailure(operation, "Malformed", "owned turn token marker is duplicated")
  }
  const markerToken = distinctMarkerValues[0]
  if (markerToken === undefined) return directToken
  const normalizedToken = normalizeOwnedTurnToken(markerToken, operation)
  /* v8 ignore next -- @preserve Marker extraction returns only a non-empty branded-token candidate. */
  if (normalizedToken instanceof CodexAppServerFailure) return normalizedToken
  if (directToken !== undefined && directToken !== normalizedToken) {
    return operationFailure(operation, "Malformed", "owned turn token metadata contradicts its input marker")
  }
  return directToken ?? normalizedToken
}

const normalizeOwnedTurnTokenFromTurnSource = (
  source: CodexTurnBoundary,
  operation: CodexAppServerOperation
): CodexOwnedTurnToken | CodexAppServerFailure | undefined => {
  const markerValues = turnMarkerValues(source, operation)
  return markerValues instanceof CodexAppServerFailure
    ? markerValues
    : normalizeOwnedTurnTokenFromMarkers(markerValues, source.ownedTurnToken ?? undefined, operation)
}

const normalizedTurnSnapshot = (
  id: CodexTurnId,
  status: CodexTurnSnapshot["status"],
  items: ReadonlyArray<unknown>,
  ownedTurnToken: CodexOwnedTurnToken | undefined,
  correlation: PlannedAttemptExecutorCorrelation | undefined
): CodexTurnSnapshot => ({
  id,
  status,
  items,
  ...(ownedTurnToken === undefined ? {} : { ownedTurnToken }),
  ...(correlation === undefined ? {} : { correlation })
})

const normalizeTurnBoundary = (
  source: CodexTurnBoundary,
  operation: CodexAppServerOperation
): CodexTurnSnapshot | CodexAppServerFailure => {
  const ownedTurnToken = normalizeOwnedTurnTokenFromTurnSource(source, operation)
  if (ownedTurnToken instanceof CodexAppServerFailure) return ownedTurnToken
  return normalizedTurnSnapshot(
    source.id,
    source.status,
    source.items ?? [],
    ownedTurnToken,
    source.correlation ?? undefined
  )
}

const normalizeTurn = (
  value: unknown,
  operation: CodexAppServerOperation
): CodexTurnSnapshot | CodexAppServerFailure => {
  const decoded = Schema.decodeUnknownResult(CodexTurnBoundary)(value)
  return Result.isSuccess(decoded)
    ? normalizeTurnBoundary(decoded.success, operation)
    : operationFailure(operation, "Malformed", `turn payload is invalid: ${String(decoded.failure)}`)
}

const normalizeThreadTurns = (
  rawTurns: ReadonlyArray<CodexTurnBoundary> | undefined,
  operation: CodexAppServerOperation
): ReadonlyArray<CodexTurnSnapshot> | CodexAppServerFailure => {
  const turns = (rawTurns ?? []).map((rawTurn) => normalizeTurnBoundary(rawTurn, operation))
  const failure = turns.find((turn): turn is CodexAppServerFailure => turn instanceof CodexAppServerFailure)
  if (failure !== undefined) return failure
  return turns.filter((turn): turn is CodexTurnSnapshot => !(turn instanceof CodexAppServerFailure))
}

const threadStatusValue = (value: CodexThreadSummaryBoundary["status"]): CodexThreadStatus | undefined =>
  typeof value === "string" ? value : value?.type

const threadStatusForOperation = (
  source: CodexThreadSummaryBoundary,
  operation: CodexAppServerOperation
): CodexThreadStatus | undefined =>
  source.status === undefined && operation === "thread/list" ? "idle" : threadStatusValue(source.status)

const normalizeThreadOwnership = (
  source: CodexThreadSummaryBoundary,
  operation: CodexAppServerOperation
): CodexThreadOwnershipToken | CodexAppServerFailure | undefined => {
  const directToken = source.ownedThreadToken ?? undefined
  const metadataToken = source.metadata?.dalphOwnedThreadToken ?? undefined
  if (directToken !== undefined && metadataToken !== undefined && directToken !== metadataToken) {
    return operationFailure(operation, "Malformed", "thread ownership token fields contradict each other")
  }
  return directToken ?? metadataToken
}

const normalizedThreadSnapshot = (
  source: CodexThreadSummaryBoundary,
  status: CodexThreadStatus,
  turns: ReadonlyArray<CodexTurnSnapshot>,
  ownedThreadToken: CodexThreadOwnershipToken | undefined
): CodexThreadSnapshot => {
  const correlation = source.correlation ?? undefined
  return {
    id: source.id,
    cwd: source.cwd,
    status,
    turns,
    ...(ownedThreadToken === undefined ? {} : { ownedThreadToken }),
    ...(correlation === undefined ? {} : { correlation })
  }
}

const normalizeThreadBoundary = (
  source: CodexThreadSummaryBoundary,
  operation: CodexAppServerOperation
): CodexThreadSnapshot | CodexAppServerFailure => {
  const status = threadStatusForOperation(source, operation)
  // `thread/list` summaries may omit a live status while still carrying the
  // durable id and cwd needed to resume and complete the identity read.
  if (status === undefined) {
    return operationFailure(operation, "Malformed", "thread id, cwd, or status is invalid")
  }
  const normalizedTurns = normalizeThreadTurns(source.turns, operation)
  if (normalizedTurns instanceof CodexAppServerFailure) return normalizedTurns
  const ownedThreadToken = normalizeThreadOwnership(source, operation)
  if (ownedThreadToken instanceof CodexAppServerFailure) return ownedThreadToken
  return normalizedThreadSnapshot(source, status, normalizedTurns, ownedThreadToken)
}

const normalizeThreadSummary = (
  value: unknown,
  operation: "thread/start"
): CodexThreadSnapshot | CodexAppServerFailure => {
  const decoded = Schema.decodeUnknownResult(CodexThreadSummaryBoundary)(value)
  return Result.isSuccess(decoded)
    ? normalizeThreadBoundary(decoded.success, operation)
    : operationFailure(operation, "Malformed", `thread payload is invalid: ${String(decoded.failure)}`)
}

const normalizeThreadTurnCensus = (
  value: unknown,
  operation: "thread/read" | "thread/resume"
): CodexThreadSnapshot | CodexAppServerFailure => {
  const decoded = Schema.decodeUnknownResult(CodexThreadTurnCensusBoundary)(value)
  return Result.isSuccess(decoded)
    ? normalizeThreadBoundary(decoded.success, operation)
    : operationFailure(operation, "Malformed", `thread turn census is invalid: ${String(decoded.failure)}`)
}

const normalizedThreadEffect = (
  thread: CodexThreadSnapshot | CodexAppServerFailure
): Effect.Effect<CodexThreadSnapshot, CodexAppServerFailure> =>
  thread instanceof CodexAppServerFailure ? Effect.fail(thread) : Effect.succeed(thread)

const maximumThreadListPages = 100

const normalizeThreadListThreads = (
  rawThreads: ReadonlyArray<CodexThreadSummaryBoundary>
): ReadonlyArray<CodexThreadSnapshot> | CodexAppServerFailure => {
  const normalizedThreads = rawThreads.map((thread) => normalizeThreadBoundary(thread, "thread/list"))
  const failure = normalizedThreads.find(
    (thread): thread is CodexAppServerFailure => thread instanceof CodexAppServerFailure
  )
  if (failure !== undefined) return failure
  return normalizedThreads.filter((thread): thread is CodexThreadSnapshot => !(thread instanceof CodexAppServerFailure))
}

const normalizedThreadListEnvelope = (
  response: CodexThreadListEnvelope
):
  | {
      readonly threads: ReadonlyArray<CodexThreadSnapshot>
      readonly nextCursor: CodexThreadListCursor | null | undefined
    }
  | CodexAppServerFailure => {
  const rawThreads = response.data ?? response.threads
  /* v8 ignore next -- @preserve The envelope Schema requires one decoded values alias. */
  if (rawThreads === undefined) return operationFailure("thread/list", "Malformed", "thread list values are missing")
  const threads = normalizeThreadListThreads(rawThreads)
  if (threads instanceof CodexAppServerFailure) return threads
  return { threads, nextCursor: response.nextCursor ?? response.next_cursor }
}

const threadListPage = (
  response: unknown
):
  | {
      readonly threads: ReadonlyArray<CodexThreadSnapshot>
      readonly nextCursor: CodexThreadListCursor | null | undefined
    }
  | CodexAppServerFailure => {
  const decoded = Schema.decodeUnknownResult(CodexThreadListEnvelope)(response)
  return Result.isSuccess(decoded)
    ? normalizedThreadListEnvelope(decoded.success)
    : operationFailure("thread/list", "Malformed", `thread list response is invalid: ${String(decoded.failure)}`)
}

type NormalizedBackgroundTerminal = {
  readonly processId: string
  readonly itemId: string
  readonly command: string
  readonly cwd: string
  readonly osPid: number | null
}

type BackgroundTerminalIdentity = {
  readonly processId: string
  readonly itemId: string
  readonly command: string
  readonly cwd: string
}

const backgroundTerminalIdentity = (item: JsonObject): BackgroundTerminalIdentity | undefined => {
  const processId = stringValue(item["processId"])
  const itemId = stringValue(item["itemId"])
  const command = stringValue(item["command"])
  const cwd = stringValue(item["cwd"])
  return processId === undefined || itemId === undefined || command === undefined || cwd === undefined
    ? undefined
    : { processId, itemId, command, cwd }
}

const isBackgroundTerminalProcessIdentity = (value: unknown): boolean =>
  value === undefined || value === null || (typeof value === "number" && Number.isInteger(value) && value >= 0)

const normalizeBackgroundTerminal = (
  item: unknown,
  operation: CodexAppServerOperation
): NormalizedBackgroundTerminal | CodexAppServerFailure => {
  if (!isJsonObject(item)) return operationFailure(operation, "Malformed", "background terminal is invalid")
  const identity = backgroundTerminalIdentity(item)
  const osPid = item["osPid"]
  if (identity === undefined) {
    return operationFailure(operation, "Malformed", "background terminal identity is invalid")
  }
  if (!isBackgroundTerminalProcessIdentity(osPid)) {
    return operationFailure(operation, "Malformed", "background terminal process identity is invalid")
  }
  return { ...identity, osPid: typeof osPid === "number" ? osPid : null }
}

const normalizeBackgroundTerminals = (
  value: unknown,
  operation: CodexAppServerOperation
): ReadonlyArray<CodexBackgroundTerminal> | CodexAppServerFailure => {
  if (!Array.isArray(value)) return operationFailure(operation, "Malformed", "background terminal list is invalid")
  const result = value.map((item) => normalizeBackgroundTerminal(item, operation))
  const failure = result.find(
    (terminal): terminal is CodexAppServerFailure => terminal instanceof CodexAppServerFailure
  )
  if (failure !== undefined) return failure
  return result.filter(
    (terminal): terminal is NormalizedBackgroundTerminal => !(terminal instanceof CodexAppServerFailure)
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

type PendingJsonRpcRequest = {
  readonly deferred: Deferred.Deferred<unknown, CodexAppServerFailure>
  readonly operation: CodexAppServerOperation
}

const jsonRpcInvalidRequestCode = -32600

const jsonRpcResponseFailure = (operation: CodexAppServerOperation, error: unknown): CodexAppServerFailure => {
  const detail = JSON.stringify(error)
  if (
    (operation === "thread/read" || operation === "thread/resume") &&
    isJsonObject(error) &&
    error["code"] === jsonRpcInvalidRequestCode &&
    typeof error["message"] === "string" &&
    error["message"].includes("no rollout found for thread id")
  ) {
    return operationFailure(operation, "NotFound", detail)
  }
  return operationFailure(operation, "Protocol", detail)
}

const makeJsonRpcClient = Effect.fn("CodexAppServer.makeJsonRpcClient")(function* (
  handle: ChildProcessHandle,
  incarnation: CodexServerIncarnation
) {
  const nextId = yield* Ref.make(1)
  const writes = yield* Semaphore.make(1)
  const closed = yield* Ref.make(false)
  const pending = yield* Ref.make<ReadonlyMap<number, PendingJsonRpcRequest>>(new Map())
  const encoder = new TextEncoder()
  const failPending = (failure: CodexAppServerFailure) =>
    Ref.modify(
      pending,
      (current) =>
        [[...current.values()].map((request) => Deferred.fail(request.deferred, failure)), new Map()] as const
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
        catch: initializeProtocolFailure
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
            const request = current.get(id)
            if (request === undefined) return [Option.none<PendingJsonRpcRequest>(), current] as const
            const next = new Map([...current].filter(([key]) => key !== id))
            return [Option.some(request), next] as const
          })
          return result.pipe(
            Effect.flatMap((maybeDeferred) => {
              if (Option.isNone(maybeDeferred)) return Effect.void
              if (typeof message["error"] === "object" && message["error"] !== null) {
                return Deferred.fail(
                  maybeDeferred.value.deferred,
                  jsonRpcResponseFailure(maybeDeferred.value.operation, message["error"])
                )
              }
              return Deferred.succeed(maybeDeferred.value.deferred, message["result"])
            })
          )
        }),
        Effect.catch((error) =>
          failPending(
            /* v8 ignore next -- @preserve Reader parsing and protocol validation normalize every failure into CodexAppServerFailure before this catch. */
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
  yield* handle.stderr.pipe(Stream.runDrain, Effect.catch(ignoreEffectFailure), Effect.forkScoped)

  const write = (message: Record<string, unknown>) =>
    writes.withPermit(
      Stream.run(Stream.succeed(encoder.encode(`${JSON.stringify(message)}\n`)), handle.stdin).pipe(
        Effect.mapError(initializeUnavailableFailure)
      )
    )
  const notify: JsonRpcClient["notify"] = Effect.fn("CodexAppServer.notify")(function* (
    method: string,
    params?: unknown
  ) {
    const isClosed = yield* Ref.get(closed)
    /* v8 ignore next -- @preserve The initialized notification is emitted only during scoped startup before close is published. */
    if (isClosed) return yield* Effect.fail(operationFailure("close", "Unavailable", "app-server is closed"))
    /* v8 ignore next -- @preserve The sole initialized notification always supplies its initialization parameters. */
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
    yield* Ref.update(pending, (current) => new Map([...current, [id, { deferred, operation }] as const]))
    /* v8 ignore next -- @preserve Every Codex request method in this adapter supplies its protocol parameter object. */
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
        /* v8 ignore next -- @preserve Pending request failures originate in the shared reader and therefore carry initialize until remapped here. */
        error.operation === "initialize" ? operationFailure(operation, error.kind, error.detail) : error
      )
    )
  })
  const close = Effect.gen(function* () {
    const shouldClose = yield* Ref.modify(closed, (current) => [!current, true] as const)
    /* v8 ignore next -- @preserve The outer scoped close latch invokes the private RPC close exactly once. */
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

/** The stable handshake facts emitted by the Codex app-server protocol. */
const CodexInitializeResponse = Schema.Struct({
  userAgent: Schema.NonEmptyString,
  codexHome: Schema.NonEmptyString,
  platformFamily: Schema.Literals(["unix", "windows"]),
  platformOs: Schema.Literals(["linux", "macos", "windows"])
})

export const normalizeInitializeResponse = (
  value: unknown,
  native: CodexProcessNativeService = nodeCodexProcessNativeService
): CodexAppServerFailure | true => {
  try {
    const response = Schema.decodeUnknownSync(CodexInitializeResponse)(value)
    const familyMatches =
      response.platformOs === "windows" ? response.platformFamily === "windows" : response.platformFamily === "unix"
    if (!familyMatches) {
      return operationFailure(
        "initialize",
        "CorrelationContradiction",
        `server platform family ${response.platformFamily} contradicts ${response.platformOs}`
      )
    }
    const expectedPlatformOs =
      native.platform === "win32" ? "windows" : native.platform === "darwin" ? "macos" : "linux"
    if (response.platformOs !== expectedPlatformOs) {
      return operationFailure(
        "initialize",
        "CorrelationContradiction",
        `server platform ${response.platformOs} does not match host ${expectedPlatformOs}`
      )
    }
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
  /**
   * Process-local environment additions for an explicitly isolated host.
   * Production keeps the ambient environment; qualification fixtures use this
   * field to bind one Codex home and deterministic provider credential.
   */
  readonly environment?: Readonly<Record<string, string>>
}

const defaultConfig: Required<Omit<CodexAppServerLayerConfig, "environment">> &
  Pick<CodexAppServerLayerConfig, "environment"> = {
  executable: "codex",
  clientName: "dalph",
  clientVersion: "0.0.0",
  environment: {}
}

const newIncarnation = (): CodexServerIncarnation => CodexServerIncarnation.make(randomUUID())

const unavailableAppServer = (failure: CodexAppServerFailure): CodexAppServerService => {
  const fail = (operation: CodexAppServerOperation) =>
    Effect.fail(
      new CodexAppServerFailure({
        // Keep a rejected initialize handshake distinguishable from a later
        // request that merely happens to observe the unavailable service.
        operation: failure.operation === "initialize" ? "initialize" : operation,
        kind: failure.kind,
        detail: failure.detail
      })
    )
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
  remaining: number = ownershipStopPollAttempts,
  operation: CodexAppServerOperation = "initialize",
  native: CodexProcessNativeService = nodeCodexProcessNativeService
): Effect.Effect<void, CodexAppServerFailure> =>
  Effect.suspend(() =>
    ownership.observe(launch).pipe(
      Effect.flatMap((observed) => {
        if (observed._tag === "Absent") return Effect.void
        if (observed._tag === "Unreadable" || observed._tag === "Contradictory") {
          return Effect.fail(operationFailure(operation, "Ownership", observed.detail))
        }
        if (observed.pid !== launch.pid) {
          return Effect.fail(operationFailure(operation, "Ownership", "app-server process identity changed"))
        }
        if (remaining <= 0) {
          return Effect.fail(operationFailure(operation, "Ownership", "previous app-server did not become absent"))
        }
        return waitForOwnershipPoll(native).pipe(
          Effect.andThen(awaitOwnedProcessAbsent(ownership, launch, remaining - 1, operation, native))
        )
      })
    )
  )

export const awaitOwnedGroupAbsent = (
  census: CodexProcessGroupCensusService,
  launch: CodexServerLaunchRecord,
  remaining: number = ownershipStopPollAttempts,
  native: CodexProcessNativeService = nodeCodexProcessNativeService
): Effect.Effect<void, CodexAppServerFailure> =>
  Effect.suspend(() =>
    census.observe(launch).pipe(
      Effect.flatMap((observed) => {
        if (observed._tag === "Absent") return Effect.void
        if (observed._tag === "Unreadable" || observed._tag === "Contradictory") {
          return Effect.fail(operationFailure("close", "Ownership", observed.detail))
        }
        if (remaining <= 0) {
          return Effect.fail(operationFailure("close", "Ownership", "owned app-server group did not become absent"))
        }
        return waitForOwnershipPoll(native).pipe(
          Effect.andThen(awaitOwnedGroupAbsent(census, launch, remaining - 1, native))
        )
      })
    )
  )

export const processGroupLeaderFailure = (
  leader: LinuxProcessStat | undefined,
  launchPid: number,
  expectedIdentity: string
): string | undefined => {
  if (leader === undefined) return undefined
  if (leader.startIdentity !== expectedIdentity) return "owned process group leader incarnation changed"
  if (leader.processGroupId !== launchPid) return "owned app-server is not its detached process-group leader"
  return undefined
}

export const collectOwnedProcessGroupMembers = (
  launchPid: number,
  expectedIdentity: string,
  byPid: ReadonlyMap<number, LinuxProcessStat>
): CodexProcessGroupProjection => {
  const leader = byPid.get(launchPid)
  const leaderFailure = processGroupLeaderFailure(leader, launchPid, expectedIdentity)
  if (leaderFailure !== undefined) return { _tag: "Contradictory", detail: leaderFailure }
  const members = [...byPid.values()].filter(
    (candidate) =>
      candidate.processGroupId === launchPid ||
      candidate.pid === launchPid ||
      isLinuxProcessDescendant(launchPid, byPid, candidate)
  )
  // Once the leader exits, /proc no longer contains its start identity.
  // Keep observing same-group members (and direct children that escaped
  // the group) until every owned process is gone; treating a surviving
  // member as Absent would close the transport while work still runs.
  if (leader === undefined && members.length === 0) return { _tag: "Absent" }
  return { _tag: "ExactLive", members }
}

/* v8 ignore start -- @preserve Darwin omission outcomes run in the controlled process-policy suite and macOS matrix. */
const darwinCensusOmission = async (
  launchPid: number,
  byPid: ReadonlyMap<number, LinuxProcessStat>,
  native: CodexProcessNativeService
): Promise<Extract<LinuxProcessStatObservation, { readonly _tag: "Unreadable" }> | undefined> => {
  if (native.platform !== "darwin" || byPid.has(launchPid)) return undefined
  const targeted = await readProcessStatObservation(launchPid, native)
  if (targeted._tag === "Unreadable") return targeted
  return targeted._tag === "Read"
    ? { _tag: "Unreadable", detail: `Darwin process census omitted recorded app-server pid ${launchPid}` }
    : undefined
}
/* v8 ignore stop -- @preserve */

export const makeNodeCodexProcessGroupCensusService = (
  native: CodexProcessNativeService = nodeCodexProcessNativeService
): CodexProcessGroupCensusService => ({
  observe: (launch) =>
    Effect.tryPromise({
      try: async () => {
        /* v8 ignore next -- @preserve Only accepted Linux and Darwin adapters construct this production census. */
        if (native.platform !== "linux" && native.platform !== "darwin") {
          return { _tag: "Unreadable" as const, detail: "owned process-group census is not qualified on this host" }
        }
        if (launch.pid === null) return { _tag: "Unreadable" as const, detail: "launch has no process identity" }
        const expectedIdentity = processIdentityFromIncarnation(launch.incarnation)
        if (expectedIdentity === undefined) {
          return { _tag: "Unreadable" as const, detail: "launch has no process-start identity" }
        }
        const hostObservation = await readHostProcessStats(native)
        /* v8 ignore next -- @preserve Malformed Darwin and Linux host snapshots are exercised by process-policy properties. */
        if ("failure" in hostObservation) return hostObservation.failure
        const hostStats = hostObservation.stats
        const byPid = new Map<number, LinuxProcessStat>(hostStats.map((stat) => [stat.pid, stat]))
        const omission = await darwinCensusOmission(launch.pid, byPid, native)
        if (omission !== undefined) return omission
        return collectOwnedProcessGroupMembers(launch.pid, expectedIdentity, byPid)
      },
      catch: closeOwnershipFailure
    })
})

type ExactMembersProjection =
  | { readonly _tag: "Absent" }
  | { readonly _tag: "ExactLive" }
  | { readonly _tag: "Unreadable"; readonly detail: string }
  | { readonly _tag: "Contradictory"; readonly detail: string }

const observeExactMembers = async (
  members: ReadonlyArray<CodexOwnedProcessIdentity>,
  native: CodexProcessNativeService = nodeCodexProcessNativeService
): Promise<ExactMembersProjection> => {
  const observations = await Promise.all(
    members.map(async (member): Promise<ExactMembersProjection> => {
      const observed = await readProcessStatObservation(member.pid, native)
      if (observed._tag === "Absent") return observed
      if (observed._tag === "Unreadable") return observed
      return observed.stat.startIdentity === member.startIdentity
        ? { _tag: "ExactLive" as const }
        : { _tag: "Contradictory" as const, detail: `owned descendant ${member.pid} incarnation changed` }
    })
  )
  const failure = observations.find(
    (observed): observed is Extract<ExactMembersProjection, { readonly _tag: "Unreadable" | "Contradictory" }> =>
      observed._tag === "Unreadable" || observed._tag === "Contradictory"
  )
  if (failure !== undefined) return failure
  return observations.some((observed) => observed._tag === "ExactLive") ? { _tag: "ExactLive" } : { _tag: "Absent" }
}

export const awaitExactMembersAbsent = (
  members: ReadonlyArray<CodexOwnedProcessIdentity>,
  remaining: number = ownershipStopPollAttempts,
  native: CodexProcessNativeService = nodeCodexProcessNativeService
): Effect.Effect<void, CodexAppServerFailure> =>
  Effect.suspend(() =>
    Effect.tryPromise({ try: () => observeExactMembers(members, native), catch: closeOwnershipFailure }).pipe(
      Effect.flatMap((observed) => {
        if (observed._tag === "Absent") return Effect.void
        if (observed._tag === "Unreadable" || observed._tag === "Contradictory") {
          return Effect.fail(operationFailure("close", "Ownership", observed.detail))
        }
        if (remaining <= 0) {
          return Effect.fail(operationFailure("close", "Ownership", "owned descendant did not become absent"))
        }
        return waitForOwnershipPoll(native).pipe(
          Effect.andThen(awaitExactMembersAbsent(members, remaining - 1, native))
        )
      })
    )
  )

/** Signal descendants that escaped the detached process group only after a fresh start-identity reread. */
export const signalExactDetachedDescendants = (
  launch: CodexServerLaunchRecord,
  group: Extract<CodexProcessGroupProjection, { readonly _tag: "ExactLive" }>,
  native: CodexProcessNativeService = nodeCodexProcessNativeService
): Effect.Effect<void, CodexAppServerFailure> => {
  /* v8 ignore next -- @preserve Only Linux and Darwin reach exact detached-descendant cleanup in production. */
  if (native.platform !== "linux" && native.platform !== "darwin") return Effect.void
  const pid = launch.pid
  if (pid === null) return Effect.void
  const escapedMembers = group.members.filter((member) => member.pid !== pid && member.processGroupId !== pid)
  return Effect.forEach(escapedMembers, (member) =>
    Effect.tryPromise({
      // eslint-disable-next-line complexity -- Escaped cleanup revalidates identity and the durable Darwin incarnation before one signal.
      try: async (): Promise<CodexAppServerFailure | undefined> => {
        const observed = await readProcessStatObservation(member.pid, native)
        if (observed._tag === "Absent") return
        if (observed._tag === "Unreadable") return operationFailure("close", "Ownership", observed.detail)
        if (observed.stat.startIdentity !== member.startIdentity) {
          return operationFailure("close", "Ownership", `owned descendant ${member.pid} incarnation changed`)
        }
        const token = await observeDarwinIncarnationToken(member.pid, launch.incarnation, native)
        /* v8 ignore next -- @preserve Darwin token disappearance is exercised by the process-policy property suite. */
        if (token._tag === "Absent") return
        if (token._tag === "Unreadable" || token._tag === "Contradictory") {
          return operationFailure("close", "Ownership", token.detail)
        }
        try {
          native.kill(member.pid, "SIGTERM")
        } catch (error) {
          if (!processWasAbsent(error)) return operationFailure("close", "Ownership", error)
        }
        return undefined
      },
      catch: closeOwnershipFailure
    }).pipe(Effect.flatMap((failure) => (failure === undefined ? Effect.void : Effect.fail(failure))))
  ).pipe(Effect.asVoid, Effect.andThen(awaitExactMembersAbsent(escapedMembers, ownershipStopPollAttempts, native)))
}

/** The app-server layer is process scoped; its close is registered once with the shared application shell. */
export const applicationServerCloseAfterExecutorDrains = (
  awaitExecutorDrains: ApplicationExitShellService["awaitExecutorDrains"],
  close: Effect.Effect<void, CodexAppServerFailure>
) => {
  const closeDiagnostic = (error: CodexAppServerFailure) =>
    ApplicationExitDiagnostic.make(`Codex app-server cleanup failed: ${error.detail}`)
  return awaitExecutorDrains.pipe(
    Effect.matchEffect({
      onFailure: (executorFailure) =>
        close.pipe(
          Effect.matchEffect({
            onFailure: (closeFailure) =>
              Effect.fail(
                new ApplicationExitDrainFailure({
                  diagnostics: [...executorFailure.diagnostics, closeDiagnostic(closeFailure)]
                })
              ),
            // Closing the server is still attempted, but a failed executor
            // drain remains a typed Exit failure rather than being ignored.
            onSuccess: () => Effect.fail(executorFailure)
          })
        ),
      onSuccess: () =>
        close.pipe(
          Effect.mapError((error) => new ApplicationExitDrainFailure({ diagnostics: [closeDiagnostic(error)] }))
        )
    })
  )
}

const registerApplicationServerDrain = (
  shell: ApplicationExitShellService,
  close: Effect.Effect<void, CodexAppServerFailure>
) =>
  shell.registerProcessLocalDrain({
    closeProcessLocalResources: applicationServerCloseAfterExecutorDrains(shell.awaitExecutorDrains, close)
  })

const makeApplicationLeaseOwner = (
  native: CodexProcessNativeService = nodeCodexProcessNativeService
): Effect.Effect<CodexServerLeaseRecord, CodexAppServerFailure> =>
  Effect.tryPromise({
    try: () => readProcessStartIdentity(native.pid, native),
    catch: initializeOwnershipFailure
  }).pipe(
    Effect.flatMap((processIdentity) =>
      processIdentity === undefined
        ? Effect.fail(operationFailure("initialize", "Ownership", "current process-start identity is unreadable"))
        : Effect.succeed(
            CodexServerLeaseRecord.make({
              pid: native.pid,
              processIdentity: CodexProcessIdentity.make(processIdentity),
              incarnation: CodexServerLeaseIncarnation.make(randomUUID())
            })
          )
    )
  )

const priorLaunchObservationFailure = (
  projection: CodexServerOwnershipProjection | CodexServerDiscoveryProjection
): CodexAppServerFailure | undefined =>
  projection._tag === "Unreadable" || projection._tag === "Contradictory"
    ? operationFailure("initialize", "Ownership", projection.detail)
    : undefined

export const reconcileLaunchingPriorServer = (
  store: CodexAttemptStoreService,
  ownership: CodexProcessOwnershipService,
  prior: CodexServerLaunchRecord,
  native: CodexProcessNativeService = nodeCodexProcessNativeService
): Effect.Effect<void, CodexAppServerFailure | CodexAttemptStoreFailure> =>
  Effect.gen(function* () {
    const discovered = yield* ownership.discover(prior.incarnation)
    const discoveryFailure = priorLaunchObservationFailure(discovered)
    if (discoveryFailure !== undefined) return yield* Effect.fail(discoveryFailure)
    if (discovered._tag === "ExactLive") {
      const recoveredLaunch: CodexServerLaunchRecord = {
        command: prior.command,
        incarnation: CodexServerIncarnation.make(
          `${durableIncarnationToken(prior.incarnation)}${processIdentitySeparator}${encodeURIComponent(
            discovered.processIdentity
          )}`
        ),
        phase: "Spawned",
        pid: discovered.pid
      }
      yield* ownership.stop(recoveredLaunch)
      yield* awaitOwnedProcessAbsent(ownership, recoveredLaunch)
    }
    yield* reconcilePriorTokenOwnedActivities(prior, native)
    yield* store.clearServerLaunch(prior.incarnation)
  })

/**
 * After a prior app-server leader disappears, its exact durable launch token
 * remains the authority for work processes that escaped the leader's group.
 * Replacement admission waits until those processes are proven absent.
 */
export const reconcilePriorTokenOwnedActivities = (
  prior: CodexServerLaunchRecord,
  native: CodexProcessNativeService = nodeCodexProcessNativeService,
  remaining: number = ownershipStopPollAttempts
): Effect.Effect<void, CodexAppServerFailure> =>
  Effect.suspend(() =>
    Effect.tryPromise({
      /* v8 ignore next -- @preserve Null pre-spawn records use the separate launch-intent reconciliation; controlled policy tests exercise this defensive form. */
      try: () => observeOwnedActivityProcesses([], native, prior.incarnation, prior.pid ?? undefined),
      catch: initializeOwnershipFailure
    }).pipe(
      Effect.flatMap((observed) => {
        if (observed._tag === "Absent") return Effect.void
        if (observed._tag === "Unreadable" || observed._tag === "Contradictory") {
          return Effect.fail(operationFailure("initialize", "Ownership", observed.detail))
        }
        if (remaining <= 0) {
          return Effect.fail(
            operationFailure("initialize", "Ownership", "durable-token activity did not become quiescent")
          )
        }
        return Effect.tryPromise({
          try: () => terminateExactOwnedActivityProcesses(observed.members, native, prior.incarnation),
          catch: initializeOwnershipFailure
        }).pipe(
          /* v8 ignore next -- @preserve Exact termination failures are exercised by the controlled process-policy negative cases. */
          Effect.flatMap((failure) =>
            failure === undefined
              ? awaitExactMembersAbsent(observed.members, ownershipStopPollAttempts, native).pipe(
                  Effect.mapError((error) => operationFailure("initialize", "Ownership", error.detail)),
                  Effect.andThen(reconcilePriorTokenOwnedActivities(prior, native, remaining - 1))
                )
              : Effect.fail(operationFailure("initialize", "Ownership", failure.detail))
          )
        )
      })
    )
  )

const reconcileExistingPriorServer = (
  ownership: CodexProcessOwnershipService,
  prior: CodexServerLaunchRecord,
  native: CodexProcessNativeService = nodeCodexProcessNativeService
): Effect.Effect<void, CodexAppServerFailure | CodexAttemptStoreFailure> =>
  Effect.gen(function* () {
    const observed = yield* ownership.observe(prior)
    const observationFailure = priorLaunchObservationFailure(observed)
    if (observationFailure !== undefined) return yield* Effect.fail(observationFailure)
    if (observed._tag === "ExactLive") {
      if (prior.pid === null || observed.pid !== prior.pid) {
        return yield* Effect.fail(operationFailure("initialize", "Ownership", "app-server process identity changed"))
      }
      yield* ownership.stop(prior)
      yield* awaitOwnedProcessAbsent(ownership, prior)
    }
    yield* reconcilePriorTokenOwnedActivities(prior, native)
  })

const reconcilePriorServerLaunch = (
  store: CodexAttemptStoreService,
  ownership: CodexProcessOwnershipService,
  prior: CodexServerLaunchRecord,
  native: CodexProcessNativeService = nodeCodexProcessNativeService
): Effect.Effect<void, CodexAppServerFailure | CodexAttemptStoreFailure> =>
  Effect.gen(function* () {
    if (prior.phase === "Launching" && prior.pid === null) {
      return yield* reconcileLaunchingPriorServer(store, ownership, prior, native)
    }
    yield* reconcileExistingPriorServer(ownership, prior, native)
  })

const ownershipGate = Effect.fn("CodexAppServer.ownershipGate")(function* (
  store: CodexAttemptStoreService,
  ownership: CodexProcessOwnershipService,
  incarnation: CodexServerIncarnation,
  command: ReadonlyArray<string>,
  native: CodexProcessNativeService = nodeCodexProcessNativeService
) {
  const leaseOwner = yield* makeApplicationLeaseOwner(native)
  const observeLease = (
    owner: CodexServerLeaseRecord
  ): Effect.Effect<CodexServerLeaseOwnerProjection, CodexAttemptStoreFailure> =>
    ownership.observe(owner).pipe(
      Effect.map((observed) => {
        if (observed._tag === "ExactLive") return { _tag: "ExactLive" as const }
        return observed
      }),
      Effect.mapError(
        (error) => new CodexAttemptStoreFailure({ detail: error.detail, operation: "acquireServerLease" })
      )
    )
  yield* store.acquireServerLease(leaseOwner, observeLease)
  // Register immediately after acquisition so every later startup failure
  // releases only this exact owner, including failures while reading launch state.
  yield* Effect.addFinalizer(() => store.releaseServerLease(leaseOwner).pipe(Effect.orDie))
  const prior = yield* store.readServerLaunch()
  if (Option.isSome(prior)) yield* reconcilePriorServerLaunch(store, ownership, prior.value, native)
  yield* store.writeServerLaunch({ command, incarnation, phase: "Launching", pid: null })
  return leaseOwner
})

type LaunchCommandFacts = { readonly expectedExecutable: string; readonly expectedMode: string }

export const launchCommandFacts = (
  launch: CodexServerLaunchRecord,
  native: CodexProcessNativeService = nodeCodexProcessNativeService
): LaunchCommandFacts | CodexServerOwnershipProjection => {
  const expectedExecutable = launch.command[0]
  const expectedMode = launch.command[1]
  if (expectedExecutable === undefined || expectedMode !== "app-server") {
    return { _tag: "Unreadable", detail: "server launch command is incomplete" }
  }
  /* v8 ignore next -- @preserve Supported-host launch policies exhaust Linux, Darwin, and Windows. */
  if (native.platform !== "linux" && native.platform !== "darwin" && native.platform !== "win32") {
    return { _tag: "Unreadable", detail: "process command identity is unsupported on this platform" }
  }
  return { expectedExecutable, expectedMode }
}

/* v8 ignore next -- @preserve The Windows PowerShell branch requires a Windows host and is paired with platform-policy tests. */
const readLaunchCommandLine = async (
  pid: number,
  native: CodexProcessNativeService = nodeCodexProcessNativeService
): Promise<ReadonlyArray<string>> =>
  native.platform === "linux"
    ? (await native.readFile(`/proc/${pid}/cmdline`)).split("\u0000").filter(Boolean)
    : native.platform === "darwin"
      ? (await native.execFile("ps", ["-o", "command=", "-p", String(pid)])).stdout.trim().split(/\s+/)
      : (
          await native.execFile("powershell.exe", [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            `(Get-Process -Id ${pid}).Path`
          ])
        ).stdout
          .trim()
          .split(/\s+/)

type DarwinIncarnationTokenObservation =
  | { readonly _tag: "Exact" }
  | { readonly _tag: "Absent" }
  | { readonly _tag: "Contradictory"; readonly detail: string }
  | { readonly _tag: "Unreadable"; readonly detail: string }

/* v8 ignore start -- @preserve Darwin token revalidation is exercised by process-policy properties and the macOS matrix. */
const observeDarwinIncarnationToken = async (
  pid: number,
  incarnation: CodexServerIncarnation,
  native: CodexProcessNativeService
): Promise<DarwinIncarnationTokenObservation> => {
  if (native.platform !== "darwin") return { _tag: "Exact" }
  try {
    const command = (await native.execFile("ps", ["eww", "-o", "command=", "-p", String(pid)])).stdout
    if (command.trim().length === 0) return { _tag: "Absent" }
    const tokenEntry = command.split(/\s+/).find((value) => value.startsWith(`${codexServerIncarnationEnvironment}=`))
    if (tokenEntry === undefined) return { _tag: "Contradictory", detail: `pid ${pid} has no launch token` }
    return tokenEntry.slice(codexServerIncarnationEnvironment.length + 1) === durableIncarnationToken(incarnation)
      ? { _tag: "Exact" }
      : { _tag: "Contradictory", detail: `pid ${pid} carries a different launch token` }
  } catch (error) {
    try {
      native.kill(pid, 0)
    } catch (signalError) {
      if (processWasAbsent(signalError)) return { _tag: "Absent" }
    }
    return { _tag: "Unreadable", detail: `cannot revalidate pid ${pid} launch token: ${String(error)}` }
  }
}
/* v8 ignore stop -- @preserve */

export const launchExecutableMatches = (expectedExecutable: string, commandLine: ReadonlyArray<string>): boolean => {
  const executableName = nodePath.basename(expectedExecutable)
  const executableHasPath = nodePath.isAbsolute(expectedExecutable) || expectedExecutable.includes(nodePath.sep)
  // Package-manager launchers commonly replace an absolute `.../bin/codex`
  // symlink with `node .../bin/codex.js` in the observed argv. The durable
  // process-start identity and launch token still prove the exact incarnation;
  // this check accepts only Codex's corresponding JavaScript entry-point name.
  const isJavaScriptLauncherTarget = (argument: string): boolean =>
    nodePath.basename(argument) === `${executableName}.js`
  return commandLine.some((argument) =>
    executableHasPath
      ? argument === expectedExecutable ||
        argument === nodePath.resolve(expectedExecutable) ||
        isJavaScriptLauncherTarget(argument)
      : nodePath.basename(argument) === executableName || isJavaScriptLauncherTarget(argument)
  )
}

export const processLaunchObservationFailure = (error: unknown, pid: number): CodexServerOwnershipProjection =>
  processErrorCode(error) === "ESRCH"
    ? { _tag: "Absent" }
    : { _tag: "Unreadable", detail: `cannot observe app-server pid ${pid}: ${String(error)}` }

// eslint-disable-next-line complexity -- Launch admission validates executable, mode, PID, process group, start identity, and Darwin token together.
export const validateLaunchedProcessObservation = async (
  launch: CodexServerLaunchRecord,
  pid: number,
  facts: LaunchCommandFacts,
  commandLine: ReadonlyArray<string>,
  native: CodexProcessNativeService = nodeCodexProcessNativeService
): Promise<CodexServerOwnershipProjection> => {
  if (!launchExecutableMatches(facts.expectedExecutable, commandLine)) {
    return { _tag: "Contradictory", detail: `pid ${pid} is not the recorded Codex executable` }
  }
  if (!commandLine.includes(facts.expectedMode)) {
    return { _tag: "Contradictory", detail: `pid ${pid} is not an app-server command` }
  }
  const expectedProcessIdentity = processIdentityFromIncarnation(launch.incarnation)
  if (expectedProcessIdentity === undefined) {
    return { _tag: "Unreadable", detail: "server launch incarnation has no process-start identity" }
  }
  const observedProcessIdentity = await readProcessStartIdentity(pid, native)
  /* v8 ignore next -- @preserve Missing Darwin start identity is exercised by the controlled process-policy negative cases. */
  if (observedProcessIdentity === undefined) {
    return { _tag: "Unreadable", detail: "observed process has no process-start identity" }
  }
  if (observedProcessIdentity !== expectedProcessIdentity) {
    return { _tag: "Contradictory", detail: `pid ${pid} belongs to a different process incarnation` }
  }
  /* v8 ignore start -- @preserve Darwin same-second PID reuse is covered by the controlled process-policy negative test. */
  const token = await observeDarwinIncarnationToken(pid, launch.incarnation, native)
  if (token._tag === "Absent") return { _tag: "Absent" }
  if (token._tag === "Unreadable" || token._tag === "Contradictory") return token
  return { _tag: "ExactLive", pid }
  /* v8 ignore stop -- @preserve */
}

const preflightSupportedProcess = async (
  pid: number,
  native: CodexProcessNativeService
): Promise<Extract<LinuxProcessStatObservation, { readonly _tag: "Absent" | "Unreadable" }> | undefined> => {
  /* v8 ignore next -- @preserve Unsupported-host launch observation is defensive; production qualification is Linux/Darwin. */
  if (native.platform !== "linux" && native.platform !== "darwin") return undefined
  const observed = await readProcessStatObservation(pid, native)
  return observed._tag === "Read" ? undefined : observed
}

const observeLaunchedProcess = async (
  launch: CodexServerLaunchRecord,
  native: CodexProcessNativeService = nodeCodexProcessNativeService
): Promise<CodexServerOwnershipProjection> => {
  if (launch.pid === null) return { _tag: "Unreadable", detail: "launch intent has no process identity" }
  try {
    const preflight = await preflightSupportedProcess(launch.pid, native)
    if (preflight !== undefined) return preflight
    native.kill(launch.pid, 0)
    const facts = launchCommandFacts(launch, native)
    if (!("expectedExecutable" in facts)) return facts
    const commandLine = await readLaunchCommandLine(launch.pid, native)
    return validateLaunchedProcessObservation(launch, launch.pid, facts, commandLine, native)
  } catch (error) {
    return processLaunchObservationFailure(error, launch.pid)
  }
}

type DiscoveredProcessCandidate =
  | { readonly _tag: "Skip" }
  | { readonly _tag: "Exact"; readonly pid: number; readonly processIdentity: CodexProcessStartIdentity }
  | { readonly _tag: "Foreign"; readonly detail: string }
  | { readonly _tag: "Unreadable"; readonly detail: string }

export const numericProcessId = (entry: string): number | undefined => {
  if (!/^[0-9]+$/.test(entry)) return undefined
  const pid = Number(entry)
  return Number.isSafeInteger(pid) && pid > 0 ? pid : undefined
}

type ProcessTextObservation =
  | { readonly _tag: "Read"; readonly text: string }
  | { readonly _tag: "Skip" }
  | { readonly _tag: "Unreadable"; readonly detail: string }

const readProcessText = async (
  pid: number,
  file: string,
  description: string,
  native: CodexProcessNativeService = nodeCodexProcessNativeService
): Promise<ProcessTextObservation> => {
  try {
    return { _tag: "Read", text: await native.readFile(`/proc/${pid}/${file}`) }
  } catch (error) {
    if (processWasAbsent(error)) return { _tag: "Skip" }
    return { _tag: "Unreadable", detail: `cannot read process ${pid} ${description}: ${String(error)}` }
  }
}

const discoverProcessCandidate = async (
  pid: number,
  expectedToken: CodexServerIncarnation,
  native: CodexProcessNativeService = nodeCodexProcessNativeService
): Promise<DiscoveredProcessCandidate> => {
  const commandObservation = await readProcessText(pid, "cmdline", "command identity", native)
  if (commandObservation._tag !== "Read") return commandObservation
  const commandLine = commandObservation.text.split("\u0000").filter(Boolean)
  if (!commandLine.includes("app-server")) return { _tag: "Skip" }
  const environmentObservation = await readProcessText(pid, "environ", "launch token", native)
  if (environmentObservation._tag !== "Read") return environmentObservation
  const environment = environmentObservation.text
  const tokenEntry = environment
    .split("\u0000")
    .find((value) => value.startsWith(`${codexServerIncarnationEnvironment}=`))
  if (tokenEntry === undefined) return { _tag: "Skip" }
  const token = tokenEntry.slice(codexServerIncarnationEnvironment.length + 1)
  const processIdentity = await readProcessStartIdentity(pid, native)
  if (processIdentity === undefined) {
    return { _tag: "Unreadable", detail: `process ${pid} launch token has no start identity` }
  }
  return token === expectedToken
    ? { _tag: "Exact", pid, processIdentity: CodexProcessStartIdentity.make(processIdentity) }
    : { _tag: "Foreign", detail: `pid ${pid} carries a different launch token` }
}

/* v8 ignore start -- @preserve Darwin launch-token discovery is exercised by process-policy properties and macOS qualification. */
const discoverDarwinProcessCandidate = async (
  pid: number,
  command: string,
  expectedToken: CodexServerIncarnation,
  native: CodexProcessNativeService
): Promise<DiscoveredProcessCandidate> => {
  if (!command.split(/\s+/).includes("app-server")) return { _tag: "Skip" }
  const tokenEntry = command.split(/\s+/).find((value) => value.startsWith(`${codexServerIncarnationEnvironment}=`))
  if (tokenEntry === undefined) return { _tag: "Skip" }
  try {
    const processIdentity = await readProcessStartIdentity(pid, native)
    if (processIdentity === undefined) {
      return { _tag: "Unreadable", detail: `process ${pid} launch token has no start identity` }
    }
    return tokenEntry.slice(codexServerIncarnationEnvironment.length + 1) === expectedToken
      ? { _tag: "Exact", pid, processIdentity: CodexProcessStartIdentity.make(processIdentity) }
      : { _tag: "Foreign", detail: `pid ${pid} carries a different launch token` }
  } catch (error) {
    try {
      native.kill(pid, 0)
    } catch (signalError) {
      if (processWasAbsent(signalError)) return { _tag: "Skip" }
    }
    return { _tag: "Unreadable", detail: `cannot inspect process ${pid}: ${String(error)}` }
  }
}
/* v8 ignore stop -- @preserve */

type ExactDiscoveredProcess = { readonly pid: number; readonly processIdentity: CodexProcessStartIdentity }

export const appendDiscoveredProcessCandidate = (
  candidate: DiscoveredProcessCandidate,
  exact: Array<ExactDiscoveredProcess>,
  foreign: Array<string>
): void => {
  if (candidate._tag === "Exact") {
    // The census is one local observation assembled before any
    // signal; it is not shared domain state.
    // eslint-disable-next-line functional/immutable-data
    exact.push({ pid: candidate.pid, processIdentity: candidate.processIdentity })
  } else if (candidate._tag === "Foreign") {
    // eslint-disable-next-line functional/immutable-data
    foreign.push(candidate.detail)
  }
}

export const projectDiscoveredProcesses = (
  exact: ReadonlyArray<ExactDiscoveredProcess>,
  foreign: ReadonlyArray<string>
): CodexServerDiscoveryProjection => {
  if (exact.length > 1) {
    return { _tag: "Contradictory", detail: "multiple app-server children carry the exact launch token" }
  }
  const only = exact[0]
  if (only === undefined) {
    return foreign.length > 0 ? { _tag: "Contradictory", detail: foreign.join("; ") } : { _tag: "Absent" }
  }
  return foreign.length > 0 ? { _tag: "Contradictory", detail: foreign.join("; ") } : { _tag: "ExactLive", ...only }
}

type DiscoveryCandidatesObservation =
  | { readonly candidates: ReadonlyArray<DiscoveredProcessCandidate> }
  | Extract<DiscoveredProcessCandidate, { readonly _tag: "Unreadable" }>

const discoverLinuxProcessCandidates = async (
  expectedToken: CodexServerIncarnation,
  native: CodexProcessNativeService
): Promise<DiscoveryCandidatesObservation> => {
  const pids = (await native.readdir("/proc")).flatMap((entry) => {
    const pid = numericProcessId(entry)
    return pid === undefined ? [] : [pid]
  })
  const candidates: Array<DiscoveredProcessCandidate> = []
  for (const pid of pids) {
    // The census is a bounded local observation; sequential reads avoid one
    // file descriptor and promise per host process.
    // eslint-disable-next-line functional/immutable-data
    candidates.push(await discoverProcessCandidate(pid, expectedToken, native))
  }
  return { candidates }
}

/* v8 ignore start -- @preserve Darwin batch discovery is exercised by process-policy properties and macOS qualification. */
const discoverDarwinProcessCandidates = async (
  expectedToken: CodexServerIncarnation,
  native: CodexProcessNativeService
): Promise<DiscoveryCandidatesObservation> => {
  const observation = await readDarwinProcessCommands(native)
  if ("failure" in observation) return { _tag: "Unreadable", detail: observation.failure.detail }
  return {
    candidates: await Promise.all(
      [...observation.commands].map(([pid, command]) =>
        discoverDarwinProcessCandidate(pid, command, expectedToken, native)
      )
    )
  }
}
/* v8 ignore stop -- @preserve */

/* v8 ignore start -- @preserve Darwin launch-token discovery is exercised by process-policy properties and macOS qualification. */
export const discoverAppServerProcesses = async (
  incarnation: CodexServerIncarnation,
  native: CodexProcessNativeService = nodeCodexProcessNativeService
): Promise<CodexServerDiscoveryProjection> => {
  if (native.platform !== "linux" && native.platform !== "darwin") {
    return { _tag: "Unreadable", detail: "launch-token process discovery is not qualified on this host" }
  }
  const expectedToken = durableIncarnationToken(incarnation)
  const observation =
    native.platform === "linux"
      ? await discoverLinuxProcessCandidates(expectedToken, native)
      : await discoverDarwinProcessCandidates(expectedToken, native)
  if ("_tag" in observation) return observation
  const exact: Array<ExactDiscoveredProcess> = []
  const foreign: Array<string> = []
  for (const candidate of observation.candidates) {
    if (candidate._tag === "Unreadable") return candidate
    appendDiscoveredProcessCandidate(candidate, exact, foreign)
  }
  return projectDiscoveredProcesses(exact, foreign)
}
/* v8 ignore stop -- @preserve */

export const signalOwnedProcessGroup = (
  pid: number,
  native: CodexProcessNativeService = nodeCodexProcessNativeService
): Effect.Effect<void, CodexAppServerFailure> =>
  Effect.suspend(() => {
    const groupSignal =
      native.platform === "win32"
        ? Effect.tryPromise({
            try: () => native.execFile("taskkill", ["/PID", String(pid), "/T", "/F"]),
            catch: processSignalFailure
          }).pipe(Effect.asVoid)
        : Effect.try({ try: () => native.kill(-pid, "SIGTERM"), catch: processSignalFailure }).pipe(Effect.asVoid)
    return groupSignal.pipe(
      // A failed group signal never falls back to an unverified PID: that
      // PID may already identify a different process incarnation.
      Effect.catch((failure) => (processWasAbsent(failure.cause) ? Effect.void : Effect.fail(failure))),
      Effect.mapError((failure) => operationFailure("close", "Ownership", failure.cause))
    )
  })

const isExactOwnedServerProcess = (
  observed: CodexServerOwnershipProjection,
  pid: number
): observed is Extract<CodexServerOwnershipProjection, { readonly _tag: "ExactLive" }> =>
  observed._tag === "ExactLive" && observed.pid === pid

const isUnusableProcessGroup = (
  group: CodexProcessGroupProjection
): group is Extract<CodexProcessGroupProjection, { readonly _tag: "Unreadable" | "Contradictory" }> =>
  group._tag === "Unreadable" || group._tag === "Contradictory"

export const stopOwnedAppServer = (
  service: CodexProcessOwnershipService,
  groupCensus: CodexProcessGroupCensusService,
  launch: CodexServerLaunchRecord,
  native: CodexProcessNativeService = nodeCodexProcessNativeService
): Effect.Effect<void, CodexAppServerFailure> =>
  Effect.gen(function* () {
    if (launch.pid === null) return
    const pid = launch.pid
    // The signal is authorized only after a fresh identity observation.
    const observed = yield* service.observe(launch)
    if (observed._tag === "Absent") return
    if (!isExactOwnedServerProcess(observed, pid)) {
      return yield* Effect.fail(operationFailure("close", "Ownership", "process identity changed before signal"))
    }
    const group = yield* groupCensus.observe(launch)
    if (isUnusableProcessGroup(group)) {
      return yield* Effect.fail(operationFailure("close", "Ownership", group.detail))
    }
    if (group._tag === "ExactLive") yield* signalExactDetachedDescendants(launch, group, native)
    yield* signalOwnedProcessGroup(pid, native)
    if (group._tag === "ExactLive") yield* awaitExactMembersAbsent(group.members, ownershipStopPollAttempts, native)
  })

export const closeHandleFailure = (error: unknown): CodexAppServerFailure =>
  error instanceof CodexAppServerFailure
    ? error
    : error instanceof CodexAttemptStoreFailure
      ? operationFailure("close", "Ownership", error)
      : operationFailure("close", "Unavailable", error)

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
  CodexAttemptStore | CodexProcessNative | CodexProcessOwnership | ChildProcessSpawner.ChildProcessSpawner
> =>
  Layer.effect(
    CodexAppServer,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const store = yield* CodexAttemptStore
      const ownership = yield* CodexProcessOwnership
      const native = yield* CodexProcessNative
      const applicationExit = yield* Effect.serviceOption(ApplicationExitShell)
      const processGroupCensus = yield* Effect.serviceOption(CodexProcessGroupCensus)
      const selected = { ...defaultConfig, ...config }
      const command = [selected.executable, "app-server"] as const
      const incarnation = newIncarnation()
      const leaseOwner = yield* ownershipGate(store, ownership, incarnation, command, native)
      const handle = yield* spawner
        .spawn(
          ChildProcess.make(selected.executable, ["app-server"], {
            stdin: { stream: "pipe", endOnDone: false },
            stdout: "pipe",
            stderr: "pipe",
            detached: true,
            env: { ...selected.environment, [codexServerIncarnationEnvironment]: durableIncarnationToken(incarnation) },
            extendEnv: true
          })
        )
        .pipe(Effect.mapError(initializeUnavailableFailure))
      const childPid = Number(handle.pid)
      const liveIncarnation = yield* Effect.tryPromise({
        try: () => incarnationWithProcessIdentity(incarnation, childPid, native),
        catch: initializeOwnershipFailure
      }).pipe(
        Effect.flatMap((observed) =>
          /* v8 ignore next -- @preserve Production launch proceeds only after the platform helper has returned an exact process-start identity. */
          observed === undefined
            ? Effect.fail(operationFailure("initialize", "Ownership", "process-start identity is missing"))
            : Effect.succeed(observed)
        ),
        Effect.catch(
          failAfterInitializationCleanup.bind(
            undefined,
            handle.kill({ killSignal: "SIGTERM", forceKillAfter: Duration.seconds(1) }),
            "process identity"
          )
        )
      )
      // The detached handoff is not durable until the child has an exact
      // process-start identity. A restart can therefore never treat a
      // pid-only acknowledgement as an owned Codex process.
      const spawnedLaunch: CodexServerLaunchRecord = {
        command,
        incarnation: liveIncarnation,
        phase: "Spawned",
        pid: childPid
      }
      yield* store
        .writeServerLaunch(spawnedLaunch)
        .pipe(
          Effect.catch(
            failAfterInitializationCleanup.bind(
              undefined,
              handle.kill({ killSignal: "SIGTERM", forceKillAfter: Duration.seconds(1) }),
              "spawned process"
            )
          )
        )
      const liveLaunch: CodexServerLaunchRecord = {
        command,
        incarnation: liveIncarnation,
        phase: "Live",
        pid: childPid
      }
      const closeHandle = Effect.gen(function* () {
        // Re-read the exact process identity before disposing the detached
        // group. The census is optional only for controlled transport tests;
        // the Node production layer supplies it and proves descendants gone.
        yield* ownership.stop(liveLaunch)
        if (Option.isSome(processGroupCensus)) {
          yield* awaitOwnedGroupAbsent(processGroupCensus.value, liveLaunch, ownershipStopPollAttempts, native)
          yield* reconcilePriorTokenOwnedActivities(liveLaunch, native)
        }
        yield* awaitOwnedProcessAbsent(ownership, liveLaunch, ownershipStopPollAttempts, "close", native)
        yield* store.clearServerLaunch(liveIncarnation)
      }).pipe(Effect.mapError(closeHandleFailure))
      yield* store.writeServerLaunch(liveLaunch).pipe(Effect.catch(failAfterClose.bind(undefined, closeHandle)))
      const rpc = yield* makeJsonRpcClient(handle, liveIncarnation)
      const releaseLease = store
        .releaseServerLease(leaseOwner)
        .pipe(Effect.mapError((error) => operationFailure("close", "Ownership", error.detail)))
      const close = yield* Effect.cached(closeHandle.pipe(Effect.andThen(rpc.close), Effect.andThen(releaseLease)))
      // The application shell owns the only graceful Exit close. The scope
      // finalizer is a process-death fallback and cannot synthesize executor
      // safety or terminal evidence.
      yield* Effect.addFinalizer(() => close.pipe(Effect.orDie))
      if (Option.isSome(applicationExit)) yield* registerApplicationServerDrain(applicationExit.value, close)
      const initializeResponse = yield* rpc.request("initialize", "initialize", {
        clientInfo: { name: selected.clientName, version: selected.clientVersion },
        capabilities: { experimentalApi: true }
      })
      const normalizedInitialize = normalizeInitializeResponse(initializeResponse, native)
      if (normalizedInitialize !== true) return yield* Effect.fail(normalizedInitialize)
      yield* rpc.notify("initialized")
      const startThread = Effect.fn("CodexAppServer.startThread")(function* (
        cwd: string,
        ownedThreadToken?: CodexThreadOwnershipToken
      ) {
        const response = responseObject(
          yield* rpc.request("thread/start", "thread/start", {
            cwd,
            ephemeral: false,
            ...(ownedThreadToken === undefined ? {} : { metadata: { dalphOwnedThreadToken: ownedThreadToken } })
          }),
          "thread/start"
        )
        if (response instanceof CodexAppServerFailure) return yield* Effect.fail(response)
        return yield* normalizedThreadEffect(normalizeThreadSummary(response["thread"], "thread/start"))
      })
      const listThreads = Effect.fn("CodexAppServer.listThreads")(function* () {
        let pages: ReadonlyArray<ReadonlyArray<CodexThreadSnapshot>> = []
        let cursors: ReadonlySet<CodexThreadListCursor> = new Set<CodexThreadListCursor>()
        let cursor: CodexThreadListCursor | undefined
        for (let page = 0; page < maximumThreadListPages; page += 1) {
          const response = yield* rpc.request(
            "thread/list",
            "thread/list",
            cursor === undefined ? { includeTurns: false } : { includeTurns: false, cursor }
          )
          const parsed = threadListPage(response)
          if (parsed instanceof CodexAppServerFailure) return yield* Effect.fail(parsed)
          pages = [...pages, parsed.threads]
          if (parsed.nextCursor === undefined || parsed.nextCursor === null) {
            return pages.flatMap((items) => items)
          }
          if (cursors.has(parsed.nextCursor)) {
            return yield* Effect.fail(operationFailure("thread/list", "Malformed", "thread list cursor repeated"))
          }
          cursors = new Set([...cursors, parsed.nextCursor])
          cursor = parsed.nextCursor
        }
        return yield* Effect.fail(operationFailure("thread/list", "Malformed", "thread list exceeded page bound"))
      })
      const readThread = Effect.fn("CodexAppServer.readThread")(function* (threadId: CodexThreadId) {
        const response = responseObject(
          yield* rpc.request("thread/read", "thread/read", { threadId, includeTurns: true }),
          "thread/read"
        )
        if (response instanceof CodexAppServerFailure) return yield* Effect.fail(response)
        return yield* normalizedThreadEffect(normalizeThreadTurnCensus(response["thread"], "thread/read"))
      })
      const resumeThread = Effect.fn("CodexAppServer.resumeThread")(function* (threadId: CodexThreadId, cwd: string) {
        const response = responseObject(
          yield* rpc.request("thread/resume", "thread/resume", { threadId, cwd }),
          "thread/resume"
        )
        if (response instanceof CodexAppServerFailure) return yield* Effect.fail(response)
        return yield* normalizedThreadEffect(normalizeThreadTurnCensus(response["thread"], "thread/resume"))
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
      return {
        incarnation: liveIncarnation,
        serverPid: childPid,
        startThread,
        listThreads,
        listThreadsComplete: true,
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
export const makeNodeCodexProcessOwnershipService = (
  groupCensus: CodexProcessGroupCensusService,
  native: CodexProcessNativeService = nodeCodexProcessNativeService
): CodexProcessOwnershipService => {
  const service: CodexProcessOwnershipService = {
    observe: (target) =>
      Effect.tryPromise({
        try: () =>
          "processIdentity" in target ? observeLeaseOwner(target, native) : observeLaunchedProcess(target, native),
        catch: initializeOwnershipFailure
      }),
    discover: (incarnation) =>
      Effect.tryPromise({
        try: () => discoverAppServerProcesses(incarnation, native),
        catch: initializeOwnershipFailure
      }),
    stop: (launch) => stopOwnedAppServer(service, groupCensus, launch, native)
  }
  return service
}

/** Convenience composition for the attempt-owned activity census. */
export const nodeCodexOwnedActivityCensusLayer: Layer.Layer<CodexOwnedActivityCensus, never, CodexAppServer> =
  Layer.effect(
    CodexOwnedActivityCensus,
    /* v8 ignore next -- @preserve Production composition is exercised by the separate built-host qualification runner. */
    Effect.map(CodexAppServer, (app) =>
      // The app-server incarnation is available to the planned-attempt scope,
      // while the default Integrator-session scope remains exact-thread-only.
      makeNodeCodexOwnedActivityCensusService(nodeCodexProcessNativeService, app.serverPid, app.incarnation)
    )
  )

/** Convenience composition for the real app-server layer's process gate. */
export const codexAppServerNodeLayer = (
  config: CodexAppServerLayerConfig = {},
  native: CodexProcessNativeService = nodeCodexProcessNativeService
): Layer.Layer<
  CodexAppServer,
  CodexAppServerFailure | CodexAttemptStoreFailure,
  CodexAttemptStore | ChildProcessSpawner.ChildProcessSpawner
> =>
  codexAppServerLayer(config).pipe(
    Layer.provide(
      native === nodeCodexProcessNativeService ? nodeCodexProcessNativeLayer : Layer.succeed(CodexProcessNative, native)
    ),
    Layer.provide(
      Layer.effect(
        CodexProcessOwnership,
        Effect.map(CodexProcessGroupCensus, (groupCensus) => makeNodeCodexProcessOwnershipService(groupCensus, native))
      )
    ),
    Layer.provide(Layer.succeed(CodexProcessGroupCensus, makeNodeCodexProcessGroupCensusService(native)))
  )
