/* eslint-disable import/no-nodejs-modules -- the lease adapter owns the native descriptor lock. */
/* eslint-disable max-lines -- The private snapshot and crash-recoverable lease share one durable authority. */
import nodeFsPromises, { type FileHandle } from "node:fs/promises"
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
import { Config, Context, Effect, FileSystem, Layer, Option, Path, Ref, Result, Schema, Semaphore } from "effect"

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
      const readAttempt = Effect.fn("CodexAttemptStore.Memory.readAttempt")(function* (
        runId: RunId,
        attemptId: AttemptId
      ) {
        const value = (yield* Ref.get(attempts)).get(keyOf(runId, attemptId))
        return value === undefined ? Option.none() : Option.some(value)
      })
      const writeAttempt = Effect.fn("CodexAttemptStore.Memory.writeAttempt")(function* (record: CodexAttemptRecord) {
        yield* Ref.update(attempts, (current) => {
          return new Map([...current, [keyOf(record.correlationRunId, record.correlationAttemptId), record] as const])
        })
      })
      const readServerLaunch = () => Ref.get(launch)
      const writeServerLaunch = Effect.fn("CodexAttemptStore.Memory.writeServerLaunch")(function* (
        record: CodexServerLaunchRecord
      ) {
        yield* Ref.set(launch, Option.some(record))
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

const encodeSnapshot = (
  attempts: ReadonlyMap<string, CodexAttemptRecord>,
  serverLaunch: Option.Option<CodexServerLaunchRecord>
): string =>
  JSON.stringify({
    attempts: [...attempts.values()],
    serverLaunch: Option.isSome(serverLaunch) ? serverLaunch.value : null
  })

/**
 * Node filesystem implementation. Writes use a same-directory temporary file
 * and rename, so a restart observes either the previous complete snapshot or
 * the next complete snapshot, never a partially written association.
 */
export const nodeCodexAttemptStoreLayer = (config: CodexAttemptStoreConfig = {}) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
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
      const initial = yield* Effect.gen(function* () {
        if (privateFiles.mainExists) return yield* fs.readFileString(filename)
        return privateFiles.temporaryExists ? yield* fs.readFileString(temporary) : JSON.stringify(emptySnapshot)
      }).pipe(
        Effect.map((text) => {
          try {
            return { snapshot: parseSnapshot(text), failure: Option.none<CodexAttemptStoreFailure>() }
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
          (error) => new CodexAttemptStoreFailure({ detail: String(error), operation: "readAttempt" as const })
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
              yield* fs.writeFileString(temporary, text, { mode: privateFileMode })
              yield* fs.chmod(temporary, privateFileMode)
              yield* fs.rename(temporary, filename)
              yield* validatePrivateFilesystem(parent, filename, temporary, leaseFilename)
            }).pipe(Effect.mapError((error) => new CodexAttemptStoreFailure({ detail: String(error), operation })))
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
          Ref.update(attempts, (current) => {
            return new Map([...current, [keyOf(record.correlationRunId, record.correlationAttemptId), record] as const])
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
        guard("writeServerLaunch", Ref.set(launch, Option.some(record))).pipe(
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
          catch: (error) => error
        })
      const closeDescriptor = (file: FileHandle, operation: CodexAttemptStoreOperation) =>
        Effect.tryPromise({ try: () => file.close(), catch: (error) => new Error(String(error)) }).pipe(
          Effect.mapError((error) => new CodexAttemptStoreFailure({ detail: String(error), operation }))
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
                        detail: `lease unlock failed: ${String(unlockFailure)}; close failed: ${String(closeFailure)}`,
                        operation: "releaseServerLease"
                      })
                    ),
                  onSuccess: () =>
                    Effect.fail(
                      new CodexAttemptStoreFailure({
                        detail: `lease unlock failed: ${String(unlockFailure)}`,
                        operation: "releaseServerLease"
                      })
                    )
                })
              ),
            onSuccess: () => closeDescriptor(file, "releaseServerLease")
          })
        )
      const readLeaseRecord = Effect.tryPromise({
        try: () => nodeFsPromises.readFile(leaseFilename, "utf8"),
        catch: (error) => new Error(String(error))
      }).pipe(
        Effect.flatMap((text) => {
          if (text.trim().length === 0) return Effect.succeed(Option.none<CodexServerLeaseRecord>())
          try {
            return Effect.succeed(Option.some(Schema.decodeUnknownSync(CodexServerLeaseRecord)(JSON.parse(text))))
          } catch (error) {
            return Effect.fail(new CodexAttemptStoreFailure({ detail: String(error), operation: "acquireServerLease" }))
          }
        }),
        Effect.mapError((error) =>
          error instanceof CodexAttemptStoreFailure
            ? error
            : new CodexAttemptStoreFailure({ detail: String(error), operation: "acquireServerLease" })
        )
      )
      const writeLeaseRecord = (owner: CodexServerLeaseRecord) =>
        Effect.tryPromise({
          try: () => nodeFsPromises.writeFile(leaseFilename, JSON.stringify(owner), "utf8"),
          catch: (error) => new Error(String(error))
        })
          .pipe(
            Effect.mapError(
              (error) => new CodexAttemptStoreFailure({ detail: String(error), operation: "acquireServerLease" })
            )
          )
          .pipe(
            Effect.andThen(
              Effect.tryPromise({
                try: () => nodeFsPromises.chmod(leaseFilename, privateFileMode),
                catch: (error) =>
                  new CodexAttemptStoreFailure({ detail: String(error), operation: "acquireServerLease" })
              })
            )
          )
      const releaseAfterAcquireFailure = (file: FileHandle, failure: CodexAttemptStoreFailure) =>
        closeLeaseFile(file).pipe(
          Effect.matchEffect({
            onFailure: (cleanupFailure) =>
              Effect.fail(
                new CodexAttemptStoreFailure({
                  detail: `${failure.detail}; lease cleanup failed: ${cleanupFailure.detail}`,
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
            const file = yield* Effect.tryPromise({
              try: () => nodeFsPromises.open(leaseFilename, "a+", privateFileMode),
              catch: (error) => new CodexAttemptStoreFailure({ detail: String(error), operation: "acquireServerLease" })
            })
            const leaseFileValid = yield* Effect.tryPromise({
              try: () => inspectPrivateFile(leaseFilename),
              catch: (error) => new CodexAttemptStoreFailure({ detail: String(error), operation: "acquireServerLease" })
            })
            if (leaseFileValid._tag !== "Present")
              return yield* releaseAfterAcquireFailure(
                file,
                new CodexAttemptStoreFailure({
                  detail: "lease file disappeared after open",
                  operation: "acquireServerLease"
                })
              )
            const lock = yield* nativeLock(file, "exnb").pipe(Effect.result)
            if (Result.isFailure(lock)) {
              const lockCode = errorCode(lock.failure)
              const lockFailure = new CodexAttemptStoreFailure({
                detail: `server lease lock failed: ${String(lock.failure)}`,
                operation: "acquireServerLease"
              })
              if (lockCode !== "EACCES" && lockCode !== "EAGAIN" && lockCode !== "EWOULDBLOCK") {
                return yield* releaseAfterAcquireFailure(file, lockFailure)
              }
              const existing = yield* readLeaseRecord.pipe(Effect.result)
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
              const existing = yield* readLeaseRecord
              if (Option.isNone(existing)) {
                yield* writeLeaseRecord(owner)
              } else {
                const projection = yield* observe(existing.value)
                if (projection._tag === "Absent") {
                  yield* writeLeaseRecord(owner)
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
          yield* closeLeaseFile(held.value.file)
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
