import {
  AttemptId,
  EvidenceReference,
  GitCommitSha,
  RunId,
  WorktreeLocator,
  evidenceReferenceEquals
} from "@dalph/contracts"
import { Context, Effect, FileSystem, Layer, Option, Path, Ref, Schema, Semaphore } from "effect"

/** The opaque identity returned by one persisted Codex app-server thread. */
export const CodexThreadId = Schema.NonEmptyString.pipe(Schema.brand("CodexThreadId"))
export type CodexThreadId = typeof CodexThreadId.Type

/** The opaque identity returned by one Codex turn. */
export const CodexTurnId = Schema.NonEmptyString.pipe(Schema.brand("CodexTurnId"))
export type CodexTurnId = typeof CodexTurnId.Type

/** Identifies one launch incarnation of the application-owned app-server child. */
export const CodexServerIncarnation = Schema.NonEmptyString.pipe(Schema.brand("CodexServerIncarnation"))
export type CodexServerIncarnation = typeof CodexServerIncarnation.Type

/** The private phases needed to distinguish an empty allocation from a turn boundary. */
export const CodexAttemptPhase = Schema.Literals([
  "EmptyPreTurn",
  "AssociatedPreTurn",
  "TurnMayHaveStarted",
  "Running",
  "SafelySuspended",
  "Terminal"
])
export type CodexAttemptPhase = typeof CodexAttemptPhase.Type

/** A sealed private terminal result; the generic executor deliberately has no Completed state here. */
export const CodexSealedTerminal = Schema.TaggedUnion({
  Accepted: { commit: GitCommitSha, evidenceManifest: EvidenceReference },
  Failed: {}
})
export type CodexSealedTerminal = typeof CodexSealedTerminal.Type

/** Exact durable attempt/thread association and the protocol state required for restart reconciliation. */
export const CodexAttemptRecord = Schema.Struct({
  attemptId: AttemptId,
  correlationAttemptId: AttemptId,
  correlationRunId: RunId,
  evidenceManifest: Schema.NullOr(EvidenceReference),
  phase: CodexAttemptPhase,
  terminal: Schema.NullOr(CodexSealedTerminal),
  threadId: Schema.NullOr(CodexThreadId),
  turnId: Schema.NullOr(CodexTurnId),
  turnMayHaveStarted: Schema.Boolean,
  worktree: WorktreeLocator
}).check(
  Schema.makeFilter((record) =>
    record.attemptId !== record.correlationAttemptId
      ? "private association attempt and correlation attempt must be identical"
      : record.phase === "EmptyPreTurn" && record.threadId !== null
        ? "an empty pre-turn allocation cannot contain a thread association"
        : record.phase !== "EmptyPreTurn" && record.threadId === null
          ? "an associated attempt must contain a Codex thread"
          : record.phase === "Terminal" && record.terminal === null
            ? "a terminal attempt must contain a sealed terminal result"
            : record.phase !== "Terminal" && record.terminal !== null
              ? "a non-terminal attempt cannot contain a sealed terminal result"
              : record.phase === "Terminal" && record.terminal?._tag === "Accepted" && record.evidenceManifest === null
                ? "an accepted terminal attempt must retain its evidence reference"
                : record.phase === "Terminal" && record.terminal?._tag === "Failed" && record.evidenceManifest !== null
                  ? "a failed terminal attempt cannot retain accepted evidence"
                  : record.phase !== "Terminal" && record.evidenceManifest !== null
                    ? "a non-terminal attempt cannot retain accepted evidence"
                    : record.phase === "Terminal" &&
                        record.terminal?._tag === "Accepted" &&
                        record.evidenceManifest !== null &&
                        !evidenceReferenceEquals(record.terminal.evidenceManifest, record.evidenceManifest)
                      ? "the sealed and top-level evidence references must agree"
                      : record.phase === "EmptyPreTurn" && (record.turnId !== null || record.turnMayHaveStarted)
                        ? "an empty pre-turn allocation cannot contain turn intent"
                        : record.phase === "AssociatedPreTurn" && (record.turnId !== null || record.turnMayHaveStarted)
                          ? "an associated pre-turn thread cannot contain turn intent"
                          : record.phase !== "EmptyPreTurn" &&
                              record.phase !== "AssociatedPreTurn" &&
                              !record.turnMayHaveStarted
                            ? "a post-association attempt must retain turn intent"
                            : undefined
  )
)
export type CodexAttemptRecord = typeof CodexAttemptRecord.Type

const keyOf = (runId: RunId, attemptId: AttemptId): string => `${runId}\u0000${attemptId}`

/** Durable ownership intent and observation for one application-scoped app-server child. */
export const CodexServerLaunchRecord = Schema.Struct({
  command: Schema.Array(Schema.NonEmptyString),
  incarnation: CodexServerIncarnation,
  phase: Schema.Literals(["Launching", "Live"]),
  pid: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)))
}).check(
  Schema.makeFilter((record) =>
    record.phase === "Launching" && record.pid !== null
      ? "a launching server cannot claim a process identity"
      : record.phase === "Live" && record.pid === null
        ? "a live server must claim a process identity"
        : undefined
  )
)
export type CodexServerLaunchRecord = typeof CodexServerLaunchRecord.Type

/** One private store snapshot. It is intentionally separate from the workflow Journal. */
export const CodexAttemptStoreSnapshot = Schema.Struct({
  attempts: Schema.Array(CodexAttemptRecord),
  serverLaunch: Schema.NullOr(CodexServerLaunchRecord)
}).check(
  Schema.makeFilter((snapshot) => {
    const keys = new Set(snapshot.attempts.map((record) => keyOf(record.correlationRunId, record.correlationAttemptId)))
    if (keys.size !== snapshot.attempts.length) return "private attempt snapshot contains duplicate correlations"
    const threadIds = new Set(
      snapshot.attempts.flatMap((record) => (record.threadId === null ? [] : [record.threadId]))
    )
    return threadIds.size === snapshot.attempts.filter((record) => record.threadId !== null).length
      ? undefined
      : "private attempt snapshot aliases one Codex thread to multiple attempts"
  })
)
export type CodexAttemptStoreSnapshot = typeof CodexAttemptStoreSnapshot.Type

/** A private store operation could not prove its exact previous or next value. */
export const CodexAttemptStoreOperation = Schema.Literals([
  "readAttempt",
  "writeAttempt",
  "readServerLaunch",
  "writeServerLaunch",
  "clearServerLaunch"
])
export type CodexAttemptStoreOperation = typeof CodexAttemptStoreOperation.Type

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
}

export class CodexAttemptStore extends Context.Service<CodexAttemptStore, CodexAttemptStoreService>()(
  "@dalph/CodexAttemptStore"
) {}

const emptySnapshot: CodexAttemptStoreSnapshot = { attempts: [], serverLaunch: null }

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
      return Context.make(CodexAttemptStore, {
        readAttempt,
        writeAttempt,
        readServerLaunch,
        writeServerLaunch,
        clearServerLaunch
      })
    })
  )

/** In-memory private state used by controlled app-server tests and dry compositions. */
export const memoryCodexAttemptStoreLayer = memoryStore

/** Filesystem locator for the private executor store; it is never the workflow Journal path. */
export const CodexAttemptStoreLocator = Schema.NonEmptyString.pipe(Schema.brand("CodexAttemptStoreLocator"))
export type CodexAttemptStoreLocator = typeof CodexAttemptStoreLocator.Type

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
export const nodeCodexAttemptStoreLayer = (locator: CodexAttemptStoreLocator | string) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const filename = String(locator)
      const temporary = `${filename}.next`
      const parent = path.dirname(filename)
      const initial = yield* Effect.gen(function* () {
        const mainExists = yield* fs.exists(filename)
        if (mainExists) return yield* fs.readFileString(filename)
        const temporaryExists = yield* fs.exists(temporary)
        return temporaryExists ? yield* fs.readFileString(temporary) : JSON.stringify(emptySnapshot)
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
              yield* fs.makeDirectory(parent, { recursive: true })
              const text = encodeSnapshot(yield* Ref.get(attempts), yield* Ref.get(launch))
              yield* fs.writeFileString(temporary, text)
              yield* fs.rename(temporary, filename)
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
      return Context.make(CodexAttemptStore, {
        readAttempt,
        writeAttempt,
        readServerLaunch,
        writeServerLaunch,
        clearServerLaunch
      })
    })
  )

/** Short name used by production composition code. */
export const codexAttemptStoreLayer = nodeCodexAttemptStoreLayer
