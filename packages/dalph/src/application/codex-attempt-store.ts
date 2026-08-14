/* eslint-disable import/no-nodejs-modules -- the lease adapter owns the native descriptor lock. */
/* eslint-disable max-lines -- The private snapshot and crash-recoverable lease share one durable authority. */
import nodeFsPromises, { type FileHandle } from "node:fs/promises"
import nodeFs from "node:fs"
import { createHash } from "node:crypto"
import nodePath from "node:path"
import nodeProcess from "node:process"
import { flock, type FlockFlagString } from "fs-ext-extra-prebuilt"
import {
  AttemptId,
  EvidenceReference,
  GitCommitSha,
  RunId,
  WorktreeLocator,
  evidenceReferenceEquals
} from "@dalph/contracts"
import { Config, Context, Effect, Layer, Option, Path, Ref, Result, Schema, Semaphore } from "effect"

/** The opaque identity returned by one persisted Codex app-server thread. */
export const CodexThreadId = Schema.NonEmptyString.pipe(Schema.brand("CodexThreadId"))
export type CodexThreadId = typeof CodexThreadId.Type

/** The opaque identity returned by one Codex turn. */
export const CodexTurnId = Schema.NonEmptyString.pipe(Schema.brand("CodexTurnId"))
export type CodexTurnId = typeof CodexTurnId.Type

/** A fresh private token Dalph puts in one turn's user input to identify that owned turn after restart. */
export const CodexOwnedTurnToken = Schema.NonEmptyString.pipe(Schema.brand("CodexOwnedTurnToken"))
export type CodexOwnedTurnToken = typeof CodexOwnedTurnToken.Type

/** Identifies one launch incarnation of the application-owned app-server child. */
export const CodexServerIncarnation = Schema.NonEmptyString.pipe(Schema.brand("CodexServerIncarnation"))
export type CodexServerIncarnation = typeof CodexServerIncarnation.Type

/** Exact process-start identity persisted with a crash-recoverable server lease. */
export const CodexProcessIdentity = Schema.NonEmptyString.pipe(Schema.brand("CodexProcessIdentity"))
export type CodexProcessIdentity = typeof CodexProcessIdentity.Type

/** Fresh lease incarnation distinguishing one owner acquisition from its predecessors. */
export const CodexServerLeaseIncarnation = Schema.NonEmptyString.pipe(Schema.brand("CodexServerLeaseIncarnation"))
export type CodexServerLeaseIncarnation = typeof CodexServerLeaseIncarnation.Type

/** A sealed private terminal result; the generic executor deliberately has no Completed state here. */
export const CodexSealedTerminal = Schema.TaggedUnion({
  Accepted: { commit: GitCommitSha, evidenceManifest: EvidenceReference },
  Failed: {}
})
export type CodexSealedTerminal = typeof CodexSealedTerminal.Type

/**
 * Exact durable attempt/thread state. Each tag carries only the fields that
 * are valid at that boundary, so an unresolved turn always retains its fresh
 * token and its previous owned turn separately from a newly observed id.
 */
export const CodexAttemptRecord = Schema.TaggedUnion({
  /** The thread allocation intent before Codex returns a thread id. */
  EmptyPreTurn: {
    attemptId: AttemptId,
    correlationAttemptId: AttemptId,
    correlationRunId: RunId,
    worktree: WorktreeLocator
  },
  /** A returned idle thread is durably associated before any turn is sent. */
  AssociatedPreTurn: {
    attemptId: AttemptId,
    correlationAttemptId: AttemptId,
    correlationRunId: RunId,
    threadId: CodexThreadId,
    worktree: WorktreeLocator
  },
  /** A fresh token authorizes one first or continuation turn crossing. */
  TurnIntentRecorded: {
    attemptId: AttemptId,
    correlationAttemptId: AttemptId,
    correlationRunId: RunId,
    currentToken: CodexOwnedTurnToken,
    priorObservedTurnId: Schema.NullOr(CodexTurnId),
    threadId: CodexThreadId,
    worktree: WorktreeLocator
  },
  /** The app-server returned or later exposed this exact token-to-turn pair. */
  TurnObserved: {
    attemptId: AttemptId,
    correlationAttemptId: AttemptId,
    correlationRunId: RunId,
    currentToken: CodexOwnedTurnToken,
    observedTurnId: CodexTurnId,
    priorObservedTurnId: Schema.NullOr(CodexTurnId),
    threadId: CodexThreadId,
    worktree: WorktreeLocator
  },
  /** The exact owned turn remains active and retains its previous owned id. */
  Running: {
    attemptId: AttemptId,
    correlationAttemptId: AttemptId,
    correlationRunId: RunId,
    currentToken: CodexOwnedTurnToken,
    observedTurnId: CodexTurnId,
    priorObservedTurnId: Schema.NullOr(CodexTurnId),
    threadId: CodexThreadId,
    worktree: WorktreeLocator
  },
  /** The exact owned turn and every owned activity are quiescent. */
  SafelySuspended: {
    attemptId: AttemptId,
    correlationAttemptId: AttemptId,
    correlationRunId: RunId,
    currentToken: CodexOwnedTurnToken,
    observedTurnId: CodexTurnId,
    priorObservedTurnId: Schema.NullOr(CodexTurnId),
    threadId: CodexThreadId,
    worktree: WorktreeLocator
  },
  /** The exact owned turn has one sealed terminal result and correlation. */
  Terminal: {
    attemptId: AttemptId,
    correlationAttemptId: AttemptId,
    correlationRunId: RunId,
    currentToken: CodexOwnedTurnToken,
    evidenceManifest: Schema.NullOr(EvidenceReference),
    observedTurnId: CodexTurnId,
    priorObservedTurnId: Schema.NullOr(CodexTurnId),
    terminal: CodexSealedTerminal,
    threadId: CodexThreadId,
    worktree: WorktreeLocator
  }
}).check(
  Schema.makeFilter((record) =>
    record.attemptId !== record.correlationAttemptId
      ? "private association attempt and correlation attempt must be identical"
      : record._tag === "Terminal" && record.terminal._tag === "Accepted" && record.evidenceManifest === null
        ? "an accepted terminal attempt must retain its evidence reference"
        : record._tag === "Terminal" && record.terminal._tag === "Failed" && record.evidenceManifest !== null
          ? "a failed terminal attempt cannot retain accepted evidence"
          : record._tag !== "Terminal" && "evidenceManifest" in record
            ? "only a terminal attempt can retain accepted evidence"
            : record._tag === "Terminal" &&
                record.terminal._tag === "Accepted" &&
                record.evidenceManifest !== null &&
                !evidenceReferenceEquals(record.terminal.evidenceManifest, record.evidenceManifest)
              ? "the sealed and top-level evidence references must agree"
              : undefined
  )
)
export type CodexAttemptRecord = typeof CodexAttemptRecord.Type

const keyOf = (runId: RunId, attemptId: AttemptId): string => `${runId}\u0000${attemptId}`

/** Durable ownership intent and observation for one application-scoped app-server child. */
export const CodexServerLaunchRecord = Schema.Struct({
  command: Schema.Array(Schema.NonEmptyString),
  incarnation: CodexServerIncarnation,
  phase: Schema.Literals(["Launching", "Spawned", "Live"]),
  pid: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)))
}).check(
  Schema.makeFilter((record) =>
    record.phase === "Launching" && record.pid !== null
      ? "a launching server cannot claim a process identity"
      : (record.phase === "Spawned" || record.phase === "Live") && record.pid === null
        ? "a live server must claim a process identity"
        : undefined
  )
)
export type CodexServerLaunchRecord = typeof CodexServerLaunchRecord.Type

/** Durable identity of the process holding the app-server admission lease. */
export const CodexServerLeaseRecord = Schema.Struct({
  pid: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  processIdentity: CodexProcessIdentity,
  incarnation: CodexServerLeaseIncarnation
})
export type CodexServerLeaseRecord = typeof CodexServerLeaseRecord.Type

/** Execution-substrate result used while deciding whether a prior lease is stale. */
export type CodexServerLeaseOwnerProjection =
  | { readonly _tag: "Absent" }
  | { readonly _tag: "ExactLive" }
  | { readonly _tag: "Unreadable"; readonly detail: string }
  | { readonly _tag: "Contradictory"; readonly detail: string }

/** One private store snapshot. It is intentionally separate from the workflow Journal. */
const CodexAttemptStoreSnapshot = Schema.Struct({
  attempts: Schema.Array(CodexAttemptRecord),
  serverLaunch: Schema.NullOr(CodexServerLaunchRecord)
}).check(
  Schema.makeFilter((snapshot) => {
    const keys = new Set(snapshot.attempts.map((record) => keyOf(record.correlationRunId, record.correlationAttemptId)))
    if (keys.size !== snapshot.attempts.length) return "private attempt snapshot contains duplicate correlations"
    const associatedAttempts = snapshot.attempts.filter(
      (record): record is Exclude<CodexAttemptRecord, { readonly _tag: "EmptyPreTurn" }> =>
        record._tag !== "EmptyPreTurn"
    )
    const threadIds = new Set(associatedAttempts.map((record) => record.threadId))
    return threadIds.size === associatedAttempts.length
      ? undefined
      : "private attempt snapshot aliases one Codex thread to multiple attempts"
  })
)
type CodexAttemptStoreSnapshot = typeof CodexAttemptStoreSnapshot.Type

/** A private store operation could not prove its exact previous or next value. */
const CodexAttemptStoreOperation = Schema.Literals([
  "configure",
  "readAttempt",
  "writeAttempt",
  "readServerLaunch",
  "writeServerLaunch",
  "clearServerLaunch",
  "acquireServerLease",
  "releaseServerLease"
])
type CodexAttemptStoreOperation = typeof CodexAttemptStoreOperation.Type

export class CodexAttemptStoreFailure extends Schema.TaggedError<CodexAttemptStoreFailure>()(
  "CodexAttemptStoreFailure",
  { detail: Schema.String, operation: CodexAttemptStoreOperation }
) {}

/** Captures a native filesystem failure before the private-store adapter classifies it. */
class CodexAttemptStoreNativeFailure extends Schema.TaggedError<CodexAttemptStoreNativeFailure>()(
  "CodexAttemptStoreNativeFailure",
  { cause: Schema.Defect() }
) {}

/** Retains the detail text previously produced by wrapping native failures in Error. */
const nativeFailureDetail = (failure: CodexAttemptStoreNativeFailure): string => `Error: ${String(failure.cause)}`

/** Private durable state authority for Codex associations and app-server ownership. */
export interface CodexAttemptStoreService {
  readonly readAttempt: (
    runId: RunId,
    attemptId: AttemptId
  ) => Effect.Effect<Option.Option<CodexAttemptRecord>, CodexAttemptStoreFailure>
  readonly writeAttempt: (record: CodexAttemptRecord) => Effect.Effect<void, CodexAttemptStoreFailure>
  readonly readServerLaunch: () => Effect.Effect<Option.Option<CodexServerLaunchRecord>, CodexAttemptStoreFailure>
  readonly writeServerLaunch: (record: CodexServerLaunchRecord) => Effect.Effect<void, CodexAttemptStoreFailure>
  readonly clearServerLaunch: (incarnation: CodexServerIncarnation) => Effect.Effect<void, CodexAttemptStoreFailure>
  /** Cross-process exclusive admission lease for the application child. */
  readonly acquireServerLease: (
    owner: CodexServerLeaseRecord,
    observe: (owner: CodexServerLeaseRecord) => Effect.Effect<CodexServerLeaseOwnerProjection, CodexAttemptStoreFailure>
  ) => Effect.Effect<void, CodexAttemptStoreFailure>
  readonly releaseServerLease: (owner: CodexServerLeaseRecord) => Effect.Effect<void, CodexAttemptStoreFailure>
}

export class CodexAttemptStore extends Context.Service<CodexAttemptStore, CodexAttemptStoreService>()(
  "@dalph/CodexAttemptStore"
) {}

const emptySnapshot: CodexAttemptStoreSnapshot = { attempts: [], serverLaunch: null }

const errorCode = (error: unknown): string =>
  typeof error === "object" && error !== null && "code" in error ? String(error.code) : ""

const memoryStore = (initial: CodexAttemptStoreSnapshot = emptySnapshot) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const attempts = yield* Ref.make<ReadonlyMap<string, CodexAttemptRecord>>(
        new Map(initial.attempts.map((record) => [keyOf(record.correlationRunId, record.correlationAttemptId), record]))
      )
      const launch = yield* Ref.make<Option.Option<CodexServerLaunchRecord>>(
        initial.serverLaunch === null ? Option.none() : Option.some(initial.serverLaunch)
      )
      const snapshotGate = yield* Semaphore.make(1)
      const readAttempt = Effect.fn("CodexAttemptStore.Memory.readAttempt")(function* (
        runId: RunId,
        attemptId: AttemptId
      ) {
        const value = (yield* Ref.get(attempts)).get(keyOf(runId, attemptId))
        return value === undefined ? Option.none() : Option.some(value)
      })
      const writeAttempt = Effect.fn("CodexAttemptStore.Memory.writeAttempt")(function* (record: CodexAttemptRecord) {
        yield* snapshotGate.withPermit(
          Effect.gen(function* () {
            const current = yield* Ref.get(attempts)
            const next = new Map([
              ...current,
              [keyOf(record.correlationRunId, record.correlationAttemptId), record] as const
            ])
            yield* validateSnapshot(next, yield* Ref.get(launch), "writeAttempt")
            yield* Ref.set(attempts, next)
          })
        )
      })
      const readServerLaunch = () => Ref.get(launch)
      const writeServerLaunch = Effect.fn("CodexAttemptStore.Memory.writeServerLaunch")(function* (
        record: CodexServerLaunchRecord
      ) {
        yield* snapshotGate.withPermit(
          Effect.gen(function* () {
            const next = Option.some(record)
            yield* validateSnapshot(yield* Ref.get(attempts), next, "writeServerLaunch")
            yield* Ref.set(launch, next)
          })
        )
      })
      const clearServerLaunch = Effect.fn("CodexAttemptStore.Memory.clearServerLaunch")(function* (
        incarnation: CodexServerIncarnation
      ) {
        yield* Ref.update(launch, (current) =>
          Option.isSome(current) && current.value.incarnation === incarnation ? Option.none() : current
        )
      })
      const lease = yield* Ref.make<Option.Option<CodexServerLeaseRecord>>(Option.none())
      const leaseGate = yield* Semaphore.make(1)
      const sameLeaseOwner = (left: CodexServerLeaseRecord, right: CodexServerLeaseRecord) =>
        left.pid === right.pid &&
        left.processIdentity === right.processIdentity &&
        left.incarnation === right.incarnation
      const acquireServerLease = Effect.fn("CodexAttemptStore.Memory.acquireServerLease")(function* (
        owner: CodexServerLeaseRecord,
        observe: (
          owner: CodexServerLeaseRecord
        ) => Effect.Effect<CodexServerLeaseOwnerProjection, CodexAttemptStoreFailure>
      ) {
        yield* leaseGate.withPermit(
          Effect.gen(function* () {
            const current = yield* Ref.get(lease)
            if (Option.isNone(current)) {
              yield* Ref.set(lease, Option.some(owner))
              return
            }
            if (sameLeaseOwner(current.value, owner)) return
            const projection = yield* observe(current.value)
            if (projection._tag === "Absent") {
              yield* Ref.set(lease, Option.some(owner))
              return
            }
            return yield* new CodexAttemptStoreFailure({
              detail:
                projection._tag === "ExactLive"
                  ? "server lease is held by a live owner"
                  : `server lease owner cannot be reclaimed: ${projection.detail}`,
              operation: "acquireServerLease"
            })
          })
        )
      })
      const releaseServerLease = Effect.fn("CodexAttemptStore.Memory.releaseServerLease")(function* (
        owner: CodexServerLeaseRecord
      ) {
        const current = yield* Ref.get(lease)
        if (Option.isNone(current)) return
        if (!sameLeaseOwner(current.value, owner)) {
          return yield* new CodexAttemptStoreFailure({
            detail: "server lease is owned by another process",
            operation: "releaseServerLease"
          })
        }
        yield* Ref.set(lease, Option.none())
      })
      return Context.make(CodexAttemptStore, {
        readAttempt,
        writeAttempt,
        readServerLaunch,
        writeServerLaunch,
        clearServerLaunch,
        acquireServerLease,
        releaseServerLease
      })
    })
  )

/** In-memory private state used by controlled app-server tests and dry compositions. */
export const memoryCodexAttemptStoreLayer = memoryStore

/**
 * Configuration for the private Codex state directory. The path is decoded
 * at the node boundary; callers cannot supply an arbitrary file locator or
 * bypass the private filename and filesystem ownership checks.
 */
export interface CodexAttemptStoreConfig {
  /** Absolute private state directory. Omit to read DALPH_STATE_DIRECTORY. */
  readonly stateDirectory?: string
}

/** Explicit service-level default; no HOME or ambient process environment is inferred. */
export const defaultCodexStateDirectory = "/var/lib/dalph"
const privateStateFilename = "executor-private-state.json"
const privateDirectoryMode = 0o700
const privateFileMode = 0o600
const privatePermissionMask = 0o077
const privateReadOnlyFlags = nodeFs.constants.O_RDONLY | nodeFs.constants.O_NOFOLLOW
const privateAppendFlags =
  nodeFs.constants.O_RDWR | nodeFs.constants.O_APPEND | nodeFs.constants.O_CREAT | nodeFs.constants.O_NOFOLLOW
const privateAppendCreateFlags = privateAppendFlags | nodeFs.constants.O_EXCL
const privateLeaseFlags = nodeFs.constants.O_RDWR | nodeFs.constants.O_NOFOLLOW
const privateLeaseCreateFlags = privateLeaseFlags | nodeFs.constants.O_CREAT | nodeFs.constants.O_EXCL

/** Validated absolute file locator for the one private Codex state record. */
const CodexAttemptStoreLocator = Schema.String.pipe(Schema.brand("CodexAttemptStoreLocator"))
type CodexAttemptStoreLocator = typeof CodexAttemptStoreLocator.Type

const configurationFailure = (detail: string): CodexAttemptStoreFailure =>
  new CodexAttemptStoreFailure({ detail, operation: "configure" })

const processUid = (): number | undefined =>
  typeof nodeProcess.getuid === "function" ? nodeProcess.getuid() : undefined

const nativeErrorCode = (error: unknown): string =>
  typeof error === "object" && error !== null && "code" in error ? String(error.code) : ""

type PrivateFilesystemObservation =
  | { readonly _tag: "Present" }
  | { readonly _tag: "Absent" }
  | { readonly _tag: "Failure"; readonly detail: string }

/**
 * The node adapter owns the exact path authority. It rejects traversal and
 * canonicalization changes before touching the host filesystem; the
 * platform Path service remains the source of path semantics at this
 * configuration boundary.
 */
const decodeStateDirectory = (raw: string, path: Path.Path): Effect.Effect<string, CodexAttemptStoreFailure> => {
  if (
    raw.length === 0 ||
    raw.trim() !== raw ||
    raw.includes("\u0000") ||
    !path.isAbsolute(raw) ||
    path.normalize(raw) !== raw ||
    path.basename(raw) === "." ||
    path.basename(raw) === ".."
  ) {
    return Effect.fail(
      configurationFailure("Codex private state directory must be an absolute, normalized path without traversal")
    )
  }
  return Effect.succeed(raw)
}

const decodeStateFileLocator = (
  stateDirectory: string,
  path: Path.Path
): Effect.Effect<CodexAttemptStoreLocator, CodexAttemptStoreFailure> =>
  Schema.decodeUnknownEffect(CodexAttemptStoreLocator)(path.join(stateDirectory, privateStateFilename)).pipe(
    Effect.mapError(() => configurationFailure("Codex private state file locator is malformed"))
  )

const ensurePrivateDirectory = async (directory: string): Promise<PrivateFilesystemObservation> => {
  try {
    const parsed = nodePath.parse(directory)
    const components = directory
      .slice(parsed.root.length)
      .split(nodePath.sep)
      .filter((component) => component.length > 0)
    if (components.length === 0)
      return { _tag: "Failure", detail: "private state directory cannot be a filesystem root" }
    let current = parsed.root
    const uid = processUid()
    for (const [index, component] of components.entries()) {
      current = nodePath.join(current, component)
      let stat
      try {
        stat = await nodeFsPromises.lstat(current)
      } catch (error) {
        if (nativeErrorCode(error) !== "ENOENT") return { _tag: "Failure", detail: String(error) }
        await nodeFsPromises.mkdir(current, { mode: privateDirectoryMode })
        stat = await nodeFsPromises.lstat(current)
      }
      if (stat.isSymbolicLink()) return { _tag: "Failure", detail: `private state path is a symlink: ${current}` }
      if (!stat.isDirectory()) return { _tag: "Failure", detail: `private state path is not a directory: ${current}` }
      if (index === components.length - 1) {
        if (uid !== undefined && stat.uid !== uid)
          return { _tag: "Failure", detail: `private state directory is foreign: ${current}` }
        if ((stat.mode & privatePermissionMask) !== 0) {
          return { _tag: "Failure", detail: `private state directory is not owner-only: ${current}` }
        }
      }
    }
    return { _tag: "Present" }
  } catch (error) {
    return { _tag: "Failure", detail: String(error) }
  }
}

const inspectPrivateFile = async (filename: string): Promise<PrivateFilesystemObservation> => {
  try {
    const stat = await nodeFsPromises.lstat(filename)
    if (stat.isSymbolicLink()) return { _tag: "Failure", detail: `private state file is a symlink: ${filename}` }
    if (!stat.isFile()) return { _tag: "Failure", detail: `private state path is not a regular file: ${filename}` }
    const uid = processUid()
    if (uid !== undefined && stat.uid !== uid)
      return { _tag: "Failure", detail: `private state file is foreign: ${filename}` }
    if ((stat.mode & privatePermissionMask) !== 0) {
      return { _tag: "Failure", detail: `private state file is not owner-only: ${filename}` }
    }
    return { _tag: "Present" }
  } catch (error) {
    return nativeErrorCode(error) === "ENOENT" ? { _tag: "Absent" } : { _tag: "Failure", detail: String(error) }
  }
}

/** Observes the descriptor opened with O_NOFOLLOW, never a second path lookup. */
const inspectPrivateDescriptor = async (file: FileHandle, filename: string): Promise<PrivateFilesystemObservation> => {
  try {
    const stat = await file.stat()
    if (!stat.isFile()) return { _tag: "Failure", detail: `private state path is not a regular file: ${filename}` }
    const uid = processUid()
    if (uid !== undefined && stat.uid !== uid) {
      return { _tag: "Failure", detail: `private state file is foreign: ${filename}` }
    }
    if ((stat.mode & privatePermissionMask) !== 0) {
      return { _tag: "Failure", detail: `private state file is not owner-only: ${filename}` }
    }
    return { _tag: "Present" }
  } catch (error) {
    return { _tag: "Failure", detail: String(error) }
  }
}

/** Converts descriptor observation into one typed private-store failure. */
const validatePrivateDescriptor = (file: FileHandle, filename: string): Effect.Effect<void, CodexAttemptStoreFailure> =>
  Effect.promise(() => inspectPrivateDescriptor(file, filename)).pipe(
    Effect.flatMap((observation) =>
      observation._tag === "Failure" ? Effect.fail(configurationFailure(observation.detail)) : Effect.void
    )
  )

/** Opens the private snapshot once; an existing file is reopened only with O_NOFOLLOW. */
const openPrivateAppendDescriptor = async (filename: string): Promise<FileHandle> => {
  try {
    return await nodeFsPromises.open(filename, privateAppendCreateFlags, privateFileMode)
  } catch (error) {
    return nativeErrorCode(error) === "EEXIST"
      ? await nodeFsPromises.open(filename, privateAppendFlags)
      : await Promise.reject(error)
  }
}

/** Opens the crash-recoverable lease once; creation and every reopen reject symlinks. */
const openPrivateLeaseDescriptor = async (filename: string): Promise<FileHandle> => {
  try {
    return await nodeFsPromises.open(filename, privateLeaseCreateFlags, privateFileMode)
  } catch (error) {
    return nativeErrorCode(error) === "EEXIST"
      ? await nodeFsPromises.open(filename, privateLeaseFlags)
      : await Promise.reject(error)
  }
}

/** Reads a retained descriptor from offset zero without resolving its path again. */
const readPrivateDescriptor = async (file: FileHandle): Promise<string> => {
  const size = (await file.stat()).size
  const bytes = Buffer.alloc(size)
  let offset = 0
  while (offset < size) {
    const result = await file.read(bytes, offset, size - offset, offset)
    if (result.bytesRead === 0) break
    offset += result.bytesRead
  }
  return bytes.subarray(0, offset).toString("utf8")
}

/** Reads one private file through the no-follow descriptor that owns the read. */
const readPrivateFile = (filename: string): Effect.Effect<string, CodexAttemptStoreNativeFailure> =>
  Effect.tryPromise({
    try: async () => {
      const file = await nodeFsPromises.open(filename, privateReadOnlyFlags)
      try {
        const observation = await inspectPrivateDescriptor(file, filename)
        return observation._tag === "Failure"
          ? { _tag: "Failure" as const, detail: observation.detail }
          : { _tag: "Read" as const, text: await file.readFile("utf8") }
      } finally {
        await file.close()
      }
    },
    catch: (cause) => new CodexAttemptStoreNativeFailure({ cause })
  }).pipe(
    Effect.flatMap((result) =>
      result._tag === "Failure"
        ? Effect.fail(new CodexAttemptStoreNativeFailure({ cause: result.detail }))
        : Effect.succeed(result.text)
    )
  )

/** Appends one checksummed complete snapshot; a torn final line leaves the prior record readable. */
const appendPrivateSnapshot = (
  file: FileHandle,
  payload: string
): Effect.Effect<void, CodexAttemptStoreNativeFailure> =>
  Effect.tryPromise({
    try: async () => {
      const digest = createHash("sha256").update(payload, "utf8").digest("hex")
      await file.writeFile(`\n${JSON.stringify({ digest, formatVersion: 1, payload })}\n`, "utf8")
      await file.chmod(privateFileMode)
      await file.sync()
    },
    catch: (cause) => new CodexAttemptStoreNativeFailure({ cause })
  })

const validatePrivateFilesystem = (parent: string, filename: string, temporary: string, lease: string) =>
  Effect.tryPromise({
    try: async () => {
      const directory = await ensurePrivateDirectory(parent)
      if (directory._tag === "Failure") return directory
      const main = await inspectPrivateFile(filename)
      if (main._tag === "Failure") return main
      const next = await inspectPrivateFile(temporary)
      if (next._tag === "Failure") return next
      const leaseFile = await inspectPrivateFile(lease)
      if (leaseFile._tag === "Failure") return leaseFile
      return { _tag: "Valid" as const, mainExists: main._tag === "Present", temporaryExists: next._tag === "Present" }
    },
    catch: (error) => configurationFailure(String(error))
  }).pipe(
    Effect.flatMap((observation) =>
      observation._tag === "Failure"
        ? Effect.fail(configurationFailure(observation.detail))
        : Effect.succeed(observation)
    )
  )

const parseSnapshot = (text: string): CodexAttemptStoreSnapshot => {
  const parsed: unknown = JSON.parse(text)
  return Schema.decodeUnknownSync(CodexAttemptStoreSnapshot)(parsed)
}

const parseSnapshotDocument = (text: string): CodexAttemptStoreSnapshot => {
  const lines = text.split("\n").filter((line) => line.trim().length > 0)
  for (const line of [...lines].reverse()) {
    try {
      const parsed: unknown = JSON.parse(line)
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "formatVersion" in parsed &&
        parsed.formatVersion === 1 &&
        "payload" in parsed &&
        typeof parsed.payload === "string" &&
        "digest" in parsed &&
        typeof parsed.digest === "string" &&
        createHash("sha256").update(parsed.payload, "utf8").digest("hex") === parsed.digest
      ) {
        return parseSnapshot(parsed.payload)
      }
    } catch {
      // A torn or corrupt newest line is ignored only when an earlier complete
      // checksummed record remains available; a plain legacy document still
      // falls through to the strict parser below.
    }
  }
  return parseSnapshot(text)
}

const encodeSnapshot = (
  attempts: ReadonlyMap<string, CodexAttemptRecord>,
  serverLaunch: Option.Option<CodexServerLaunchRecord>
): string =>
  JSON.stringify({
    attempts: [...attempts.values()],
    serverLaunch: Option.isSome(serverLaunch) ? serverLaunch.value : null
  })

/** Validates the complete next snapshot before one store operation crosses persistence. */
const validateSnapshot = (
  attempts: ReadonlyMap<string, CodexAttemptRecord>,
  serverLaunch: Option.Option<CodexServerLaunchRecord>,
  operation: CodexAttemptStoreOperation
): Effect.Effect<void, CodexAttemptStoreFailure> =>
  Effect.try({
    try: () => {
      Schema.decodeUnknownSync(CodexAttemptStoreSnapshot)({
        attempts: [...attempts.values()],
        serverLaunch: Option.isSome(serverLaunch) ? serverLaunch.value : null
      })
    },
    catch: (error) => new CodexAttemptStoreFailure({ detail: String(error), operation })
  }).pipe(Effect.asVoid)

/**
 * Node filesystem implementation. Writes append one checksummed complete
 * record through an O_NOFOLLOW descriptor, so a restart can retain the last
 * complete record even when a process dies during a later append.
 */
export const nodeCodexAttemptStoreLayer = (config: CodexAttemptStoreConfig = {}) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const path = yield* Path.Path
      const stateDirectory = yield* decodeStateDirectory(
        config.stateDirectory ??
          (yield* Config.string("DALPH_STATE_DIRECTORY").pipe(Config.withDefault(defaultCodexStateDirectory))),
        path
      )
      const filename = yield* decodeStateFileLocator(stateDirectory, path)
      const temporary = `${filename}.next`
      const leaseFilename = `${filename}.lease`
      const parent = stateDirectory
      const privateFiles = yield* validatePrivateFilesystem(parent, filename, temporary, leaseFilename)
      const snapshotFile = yield* Effect.tryPromise({
        try: () => openPrivateAppendDescriptor(filename),
        catch: (error) => configurationFailure(String(error))
      })
      yield* Effect.addFinalizer(() =>
        Effect.tryPromise({ try: () => snapshotFile.close(), catch: () => undefined }).pipe(Effect.orDie)
      )
      yield* validatePrivateDescriptor(snapshotFile, filename).pipe(
        Effect.mapError((error) => configurationFailure(error.detail))
      )
      const initial = yield* Effect.gen(function* () {
        if (privateFiles.mainExists) {
          const text = yield* Effect.tryPromise({
            try: () => readPrivateDescriptor(snapshotFile),
            catch: (cause) => new CodexAttemptStoreNativeFailure({ cause })
          })
          return text.trim().length === 0 ? JSON.stringify(emptySnapshot) : text
        }
        return privateFiles.temporaryExists ? yield* readPrivateFile(temporary) : JSON.stringify(emptySnapshot)
      }).pipe(
        Effect.map((text) => {
          try {
            return { snapshot: parseSnapshotDocument(text), failure: Option.none<CodexAttemptStoreFailure>() }
          } catch (error) {
            return {
              snapshot: emptySnapshot,
              failure: Option.some(
                new CodexAttemptStoreFailure({ detail: String(error), operation: "readAttempt" as const })
              )
            }
          }
        }),
        Effect.mapError(
          (error) =>
            new CodexAttemptStoreFailure({ detail: nativeFailureDetail(error), operation: "readAttempt" as const })
        )
      )
      const attempts = yield* Ref.make<ReadonlyMap<string, CodexAttemptRecord>>(
        new Map(
          initial.snapshot.attempts.map((record) => [
            keyOf(record.correlationRunId, record.correlationAttemptId),
            record
          ])
        )
      )
      const launch = yield* Ref.make<Option.Option<CodexServerLaunchRecord>>(
        initial.snapshot.serverLaunch === null ? Option.none() : Option.some(initial.snapshot.serverLaunch)
      )
      const loadFailure = yield* Ref.make<Option.Option<CodexAttemptStoreFailure>>(initial.failure)
      const persistence = yield* Semaphore.make(1)
      const guard = <A>(
        operation: CodexAttemptStoreOperation,
        effect: Effect.Effect<A, CodexAttemptStoreFailure>
      ): Effect.Effect<A, CodexAttemptStoreFailure> =>
        Ref.get(loadFailure).pipe(
          Effect.flatMap((failure) =>
            Option.isSome(failure)
              ? Effect.fail(new CodexAttemptStoreFailure({ detail: failure.value.detail, operation }))
              : effect
          )
        )
      const persist = (operation: CodexAttemptStoreOperation) =>
        persistence.withPermit(
          guard(
            operation,
            Effect.gen(function* () {
              yield* validatePrivateFilesystem(parent, filename, temporary, leaseFilename)
              const text = encodeSnapshot(yield* Ref.get(attempts), yield* Ref.get(launch))
              // The private state file is an append-only checksummed boundary.
              // It never re-resolves a validated temporary path for rename;
              // O_NOFOLLOW + one descriptor owns the write and fsync.
              yield* appendPrivateSnapshot(snapshotFile, text)
            }).pipe(
              Effect.mapError((error) =>
                error instanceof CodexAttemptStoreNativeFailure
                  ? new CodexAttemptStoreFailure({ detail: nativeFailureDetail(error), operation })
                  : new CodexAttemptStoreFailure({ detail: String(error), operation })
              )
            )
          )
        )
      const readAttempt: CodexAttemptStoreService["readAttempt"] = (runId, attemptId) =>
        guard(
          "readAttempt",
          Ref.get(attempts).pipe(
            Effect.map((current) => {
              const value = current.get(keyOf(runId, attemptId))
              return value === undefined ? Option.none<CodexAttemptRecord>() : Option.some(value)
            })
          )
        )
      const writeAttempt: CodexAttemptStoreService["writeAttempt"] = (record) =>
        guard(
          "writeAttempt",
          Effect.gen(function* () {
            const current = yield* Ref.get(attempts)
            const next = new Map([
              ...current,
              [keyOf(record.correlationRunId, record.correlationAttemptId), record] as const
            ])
            yield* validateSnapshot(next, yield* Ref.get(launch), "writeAttempt")
            yield* Ref.set(attempts, next)
          })
        ).pipe(
          Effect.andThen(persist("writeAttempt")),
          Effect.tapError((error) =>
            Ref.set(
              loadFailure,
              Option.some(
                error instanceof CodexAttemptStoreFailure
                  ? error
                  : new CodexAttemptStoreFailure({ detail: String(error), operation: "writeAttempt" })
              )
            )
          )
        )
      const readServerLaunch: CodexAttemptStoreService["readServerLaunch"] = () =>
        guard("readServerLaunch", Ref.get(launch))
      const writeServerLaunch: CodexAttemptStoreService["writeServerLaunch"] = (record) =>
        guard(
          "writeServerLaunch",
          Effect.gen(function* () {
            const next = Option.some(record)
            yield* validateSnapshot(yield* Ref.get(attempts), next, "writeServerLaunch")
            yield* Ref.set(launch, next)
          })
        ).pipe(
          Effect.andThen(persist("writeServerLaunch")),
          Effect.tapError((error) =>
            Ref.set(
              loadFailure,
              Option.some(
                error instanceof CodexAttemptStoreFailure
                  ? error
                  : new CodexAttemptStoreFailure({ detail: String(error), operation: "writeServerLaunch" })
              )
            )
          )
        )
      const clearServerLaunch: CodexAttemptStoreService["clearServerLaunch"] = (incarnation) =>
        guard(
          "clearServerLaunch",
          Ref.update(launch, (current) =>
            Option.isSome(current) && current.value.incarnation === incarnation ? Option.none() : current
          )
        ).pipe(
          Effect.andThen(persist("clearServerLaunch")),
          Effect.tapError((error) =>
            Ref.set(
              loadFailure,
              Option.some(
                error instanceof CodexAttemptStoreFailure
                  ? error
                  : new CodexAttemptStoreFailure({ detail: String(error), operation: "clearServerLaunch" })
              )
            )
          )
        )
      const heldLease = yield* Ref.make<
        Option.Option<{ readonly file: FileHandle; readonly owner: CodexServerLeaseRecord }>
      >(Option.none())
      const sameLeaseOwner = (left: CodexServerLeaseRecord, right: CodexServerLeaseRecord) =>
        left.pid === right.pid &&
        left.processIdentity === right.processIdentity &&
        left.incarnation === right.incarnation
      const nativeLock = (file: FileHandle, flags: FlockFlagString) =>
        Effect.tryPromise({
          try: () =>
            new Promise<void>((resolve, reject) => {
              flock(file.fd, flags, (failure) => (failure === null ? resolve() : reject(failure)))
            }),
          catch: (cause) => new CodexAttemptStoreNativeFailure({ cause })
        })
      const closeDescriptor = (file: FileHandle, operation: CodexAttemptStoreOperation) =>
        Effect.tryPromise({
          try: () => file.close(),
          catch: (cause) => new CodexAttemptStoreNativeFailure({ cause })
        }).pipe(
          Effect.mapError((error) => new CodexAttemptStoreFailure({ detail: nativeFailureDetail(error), operation }))
        )
      const closeLeaseFile = (file: FileHandle) =>
        nativeLock(file, "un").pipe(
          Effect.matchEffect({
            onFailure: (unlockFailure) =>
              closeDescriptor(file, "releaseServerLease").pipe(
                Effect.matchEffect({
                  onFailure: (closeFailure) =>
                    Effect.fail(
                      new CodexAttemptStoreFailure({
                        detail: `lease unlock failed: ${String(unlockFailure.cause)}; close failed: ${String(closeFailure)}`,
                        operation: "releaseServerLease"
                      })
                    ),
                  onSuccess: () =>
                    Effect.fail(
                      new CodexAttemptStoreFailure({
                        detail: `lease unlock failed: ${String(unlockFailure.cause)}`,
                        operation: "releaseServerLease"
                      })
                    )
                })
              ),
            onSuccess: () => closeDescriptor(file, "releaseServerLease")
          })
        )
      const leaseFile = yield* Effect.tryPromise({
        try: () => openPrivateLeaseDescriptor(leaseFilename),
        catch: (error) => configurationFailure(String(error))
      })
      yield* Effect.addFinalizer(() => closeLeaseFile(leaseFile).pipe(Effect.orDie))
      yield* validatePrivateDescriptor(leaseFile, leaseFilename).pipe(
        Effect.mapError((error) => configurationFailure(error.detail))
      )
      const readLeaseRecord = (file: FileHandle) =>
        Effect.tryPromise({
          try: () => readPrivateDescriptor(file),
          catch: (cause) => new CodexAttemptStoreNativeFailure({ cause })
        }).pipe(
          Effect.flatMap((text) => {
            if (text.trim().length === 0) return Effect.succeed(Option.none<CodexServerLeaseRecord>())
            try {
              return Effect.succeed(Option.some(Schema.decodeUnknownSync(CodexServerLeaseRecord)(JSON.parse(text))))
            } catch (error) {
              return Effect.fail(
                new CodexAttemptStoreFailure({ detail: String(error), operation: "acquireServerLease" })
              )
            }
          }),
          Effect.mapError((error) =>
            error instanceof CodexAttemptStoreFailure
              ? error
              : new CodexAttemptStoreFailure({ detail: nativeFailureDetail(error), operation: "acquireServerLease" })
          )
        )
      const writeLeaseRecord = (file: FileHandle, owner: CodexServerLeaseRecord) =>
        Effect.tryPromise({
          try: async () => {
            const bytes = Buffer.from(JSON.stringify(owner), "utf8")
            await file.truncate(0)
            await file.write(bytes, 0, bytes.byteLength, 0)
            await file.chmod(privateFileMode)
            await file.sync()
          },
          catch: (cause) => new CodexAttemptStoreNativeFailure({ cause })
        }).pipe(
          Effect.mapError(
            (error) =>
              new CodexAttemptStoreFailure({ detail: nativeFailureDetail(error), operation: "acquireServerLease" })
          )
        )
      const releaseAfterAcquireFailure = (file: FileHandle, failure: CodexAttemptStoreFailure) =>
        nativeLock(file, "un").pipe(
          Effect.matchEffect({
            onFailure: (cleanupFailure) =>
              Effect.fail(
                new CodexAttemptStoreFailure({
                  detail: `${failure.detail}; lease unlock failed: ${String(cleanupFailure.cause)}`,
                  operation: "acquireServerLease"
                })
              ),
            onSuccess: () => Effect.fail(failure)
          })
        )
      const acquireServerLease: CodexAttemptStoreService["acquireServerLease"] = (owner, observe) =>
        guard(
          "acquireServerLease",
          Effect.gen(function* () {
            const held = yield* Ref.get(heldLease)
            if (Option.isSome(held)) {
              if (sameLeaseOwner(held.value.owner, owner)) return
              return yield* new CodexAttemptStoreFailure({
                detail: "server lease is already held by this process for another incarnation",
                operation: "acquireServerLease"
              })
            }
            yield* validatePrivateFilesystem(parent, filename, temporary, leaseFilename)
            const file = leaseFile
            yield* validatePrivateDescriptor(file, leaseFilename).pipe(
              Effect.mapError(
                (error) => new CodexAttemptStoreFailure({ detail: error.message, operation: "acquireServerLease" })
              )
            )
            const lock = yield* nativeLock(file, "exnb").pipe(Effect.result)
            if (Result.isFailure(lock)) {
              const lockCode = errorCode(lock.failure.cause)
              const lockFailure = new CodexAttemptStoreFailure({
                detail: `server lease lock failed: ${String(lock.failure.cause)}`,
                operation: "acquireServerLease"
              })
              if (lockCode !== "EACCES" && lockCode !== "EAGAIN" && lockCode !== "EWOULDBLOCK") {
                return yield* releaseAfterAcquireFailure(file, lockFailure)
              }
              const existing = yield* readLeaseRecord(file).pipe(Effect.result)
              yield* closeDescriptor(file, "acquireServerLease")
              if (Result.isFailure(existing)) return yield* existing.failure
              if (Option.isNone(existing.success)) {
                return yield* new CodexAttemptStoreFailure({
                  detail: "server lease is locked but has no readable owner",
                  operation: "acquireServerLease"
                })
              }
              const projection = yield* observe(existing.success.value)
              return yield* new CodexAttemptStoreFailure({
                detail:
                  projection._tag === "ExactLive"
                    ? "server lease is held by a live owner"
                    : projection._tag === "Absent"
                      ? "server lease lock is held by an absent owner"
                      : `server lease owner cannot be reclaimed: ${projection.detail}`,
                operation: "acquireServerLease"
              })
            }
            const inspected = yield* Effect.gen(function* () {
              const existing = yield* readLeaseRecord(file)
              if (Option.isNone(existing)) {
                yield* writeLeaseRecord(file, owner)
              } else {
                const projection = yield* observe(existing.value)
                if (projection._tag === "Absent") {
                  yield* writeLeaseRecord(file, owner)
                } else if (projection._tag === "ExactLive" && sameLeaseOwner(existing.value, owner)) {
                  // The exact owner may be re-entering from one application
                  // scope; retain the newly acquired descriptor below.
                } else {
                  return yield* new CodexAttemptStoreFailure({
                    detail:
                      projection._tag === "ExactLive"
                        ? "server lease is held by a live owner"
                        : `server lease owner cannot be reclaimed: ${projection.detail}`,
                    operation: "acquireServerLease"
                  })
                }
              }
              yield* Ref.set(heldLease, Option.some({ file, owner }))
            }).pipe(Effect.result)
            if (Result.isFailure(inspected)) return yield* releaseAfterAcquireFailure(file, inspected.failure)
          })
        )
      const releaseServerLease: CodexAttemptStoreService["releaseServerLease"] = (owner) =>
        Effect.gen(function* () {
          const held = yield* Ref.get(heldLease)
          if (Option.isNone(held)) return
          if (!sameLeaseOwner(held.value.owner, owner)) {
            return yield* new CodexAttemptStoreFailure({
              detail: "server lease is owned by another process",
              operation: "releaseServerLease"
            })
          }
          yield* nativeLock(held.value.file, "un").pipe(
            Effect.mapError(
              (error) => new CodexAttemptStoreFailure({ detail: String(error.cause), operation: "releaseServerLease" })
            )
          )
          yield* Ref.set(heldLease, Option.none())
        })
      return Context.make(CodexAttemptStore, {
        readAttempt,
        writeAttempt,
        readServerLaunch,
        writeServerLaunch,
        clearServerLaunch,
        acquireServerLease,
        releaseServerLease
      })
    })
  )
