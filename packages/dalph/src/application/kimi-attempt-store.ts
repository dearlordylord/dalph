/* eslint-disable import/no-nodejs-modules -- the adapter owns its private path boundary. */

import nodePath from "node:path"
import { AttemptId, RunId, TaskExecutorLocator, WorktreeLocator } from "@dalph/contracts"
import { Context, Effect, FileSystem, Layer, Option, Path, Ref, Schema, Semaphore } from "effect"
import { KimiAcpSessionId } from "./kimi-acp.js"

/** The provider-private phase retained for one Kimi session association. */
export const KimiAttemptPrivatePhase = Schema.Literals([
  "SessionCreated",
  "PromptIntentRecorded",
  "ResumeIntentRecorded",
  "Executing",
  "Suspended",
  "Terminal",
  "Unavailable"
])
export type KimiAttemptPrivatePhase = typeof KimiAttemptPrivatePhase.Type

/**
 * One provider-private Kimi association. It contains only opaque session
 * identity and the exact attempt resource; credentials and ACP envelopes are
 * intentionally not representable here.
 */
export const KimiAttemptPrivateRecord = Schema.Struct({
  attemptId: AttemptId,
  executor: TaskExecutorLocator,
  phase: KimiAttemptPrivatePhase,
  runId: RunId,
  sessionId: KimiAcpSessionId,
  worktree: WorktreeLocator
})
export type KimiAttemptPrivateRecord = typeof KimiAttemptPrivateRecord.Type

const keyOf = (runId: RunId, attemptId: AttemptId): string => `${runId}\u0000${attemptId}`

const duplicateRecordError = (records: ReadonlyArray<KimiAttemptPrivateRecord>): string | undefined => {
  const attemptKeys = records.map((record) => keyOf(record.runId, record.attemptId))
  if (new Set(attemptKeys).size !== attemptKeys.length) return "Kimi private store repeats an attempt association"
  const sessionIds = records.map((record) => record.sessionId)
  if (new Set(sessionIds).size !== sessionIds.length)
    return "Kimi private store aliases one session to multiple attempts"
  return undefined
}

const KimiAttemptPrivateSnapshot = Schema.Struct({ records: Schema.Array(KimiAttemptPrivateRecord) }).check(
  Schema.makeFilter((snapshot) => duplicateRecordError(snapshot.records))
)
type KimiAttemptPrivateSnapshot = typeof KimiAttemptPrivateSnapshot.Type

/** Failure at the provider-private state boundary; no raw ACP value is carried. */
const KimiAttemptStoreOperation = Schema.Literals(["configure", "read", "write"])
type KimiAttemptStoreOperation = typeof KimiAttemptStoreOperation.Type

export class KimiAttemptStoreFailure extends Schema.TaggedError<KimiAttemptStoreFailure>()("KimiAttemptStoreFailure", {
  detail: Schema.String,
  operation: KimiAttemptStoreOperation
}) {}

export interface KimiAttemptPrivateStoreService {
  readonly read: (
    runId: RunId,
    attemptId: AttemptId
  ) => Effect.Effect<Option.Option<KimiAttemptPrivateRecord>, KimiAttemptStoreFailure>
  readonly write: (record: KimiAttemptPrivateRecord) => Effect.Effect<void, KimiAttemptStoreFailure>
}

export class KimiAttemptPrivateStore extends Context.Service<KimiAttemptPrivateStore, KimiAttemptPrivateStoreService>()(
  "@dalph/KimiAttemptPrivateStore"
) {}

const decodeSnapshot = (
  value: unknown,
  operation: KimiAttemptStoreOperation
): Effect.Effect<KimiAttemptPrivateSnapshot, KimiAttemptStoreFailure> =>
  Schema.decodeUnknownEffect(KimiAttemptPrivateSnapshot, { onExcessProperty: "error" })(value).pipe(
    Effect.mapError(
      (error) => new KimiAttemptStoreFailure({ detail: `Kimi private store is malformed: ${String(error)}`, operation })
    )
  )

const recordFor = (
  records: ReadonlyArray<KimiAttemptPrivateRecord>,
  runId: RunId,
  attemptId: AttemptId
): Option.Option<KimiAttemptPrivateRecord> => {
  const found = records.find((record) => record.runId === runId && record.attemptId === attemptId)
  return found === undefined ? Option.none() : Option.some(found)
}

/** Controlled provider-private store used by restart/reconnect tests. */
export const memoryKimiAttemptPrivateStoreLayer = (
  initial: ReadonlyArray<KimiAttemptPrivateRecord> = [],
  observeWrite?: (record: KimiAttemptPrivateRecord) => void
): Layer.Layer<KimiAttemptPrivateStore> =>
  Layer.effect(
    KimiAttemptPrivateStore,
    Effect.gen(function* () {
      // The controlled constructor accepts already typed records; every
      // successor is still validated through the same snapshot schema.
      const records = yield* Ref.make<ReadonlyArray<KimiAttemptPrivateRecord>>(initial)
      const mutex = yield* Semaphore.make(1)
      return KimiAttemptPrivateStore.of({
        read: (runId, attemptId) =>
          Ref.get(records).pipe(Effect.map((current) => recordFor(current, runId, attemptId))),
        write: (record) =>
          mutex.withPermit(
            Effect.gen(function* () {
              const current = yield* Ref.get(records)
              const next = [
                record,
                ...current.filter((item) => keyOf(item.runId, item.attemptId) !== keyOf(record.runId, record.attemptId))
              ]
              yield* decodeSnapshot({ records: next }, "write")
              yield* Ref.set(records, next)
              if (observeWrite !== undefined) yield* Effect.sync(() => observeWrite(record))
            })
          )
      })
    })
  )

export interface KimiAttemptPrivateStoreConfig {
  /** Absolute, normalized directory shared only with other Dalph private state files. */
  readonly stateDirectory: string
}

const privateStateFilename = "kimi-executor-private-state.json"
const privateFileMode = 0o600
const privateDirectoryMode = 0o700

const stateDirectoryFailure = (detail: string): KimiAttemptStoreFailure =>
  new KimiAttemptStoreFailure({ detail, operation: "configure" })

const decodeStateDirectory = (raw: string, path: Path.Path): Effect.Effect<string, KimiAttemptStoreFailure> => {
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
      stateDirectoryFailure("Kimi private state directory must be an absolute, normalized path without traversal")
    )
  }
  return Effect.succeed(raw)
}

const encodeSnapshot = (records: ReadonlyArray<KimiAttemptPrivateRecord>): string => `${JSON.stringify({ records })}\n`

const decodeDocument = (
  value: string
): Effect.Effect<ReadonlyArray<KimiAttemptPrivateRecord>, KimiAttemptStoreFailure> =>
  Effect.try({
    try: (): unknown => JSON.parse(value),
    catch: (error) =>
      new KimiAttemptStoreFailure({ detail: `Kimi private store is malformed: ${String(error)}`, operation: "read" })
  }).pipe(
    Effect.flatMap((parsed) => decodeSnapshot(parsed, "read")),
    Effect.map((snapshot) => snapshot.records)
  )

/** Node-backed state is rewritten through a sibling temporary file atomically. */
export const nodeKimiAttemptPrivateStoreLayer = (
  config: KimiAttemptPrivateStoreConfig
): Layer.Layer<KimiAttemptPrivateStore, KimiAttemptStoreFailure, FileSystem.FileSystem | Path.Path> =>
  Layer.effect(
    KimiAttemptPrivateStore,
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const stateDirectory = yield* decodeStateDirectory(config.stateDirectory, path)
      const filename = nodePath.join(stateDirectory, privateStateFilename)
      const temporary = `${filename}.next`
      const readAll = Effect.fn("KimiAttemptPrivateStore.Node.readAll")(function* () {
        const exists = yield* fileSystem
          .exists(filename)
          .pipe(Effect.mapError((error) => new KimiAttemptStoreFailure({ detail: String(error), operation: "read" })))
        if (!exists) return []
        const text = yield* fileSystem
          .readFileString(filename)
          .pipe(Effect.mapError((error) => new KimiAttemptStoreFailure({ detail: String(error), operation: "read" })))
        return yield* decodeDocument(text)
      })
      const initial = yield* readAll()
      const records = yield* Ref.make<ReadonlyArray<KimiAttemptPrivateRecord>>(initial)
      const mutex = yield* Semaphore.make(1)
      const persist = (next: ReadonlyArray<KimiAttemptPrivateRecord>) =>
        Effect.gen(function* () {
          yield* fileSystem
            .makeDirectory(stateDirectory, { recursive: true, mode: privateDirectoryMode })
            .pipe(
              Effect.mapError((error) => new KimiAttemptStoreFailure({ detail: String(error), operation: "write" }))
            )
          yield* fileSystem
            .writeFileString(temporary, encodeSnapshot(next), { mode: privateFileMode })
            .pipe(
              Effect.mapError((error) => new KimiAttemptStoreFailure({ detail: String(error), operation: "write" }))
            )
          yield* fileSystem
            .chmod(temporary, privateFileMode)
            .pipe(
              Effect.mapError((error) => new KimiAttemptStoreFailure({ detail: String(error), operation: "write" }))
            )
          yield* fileSystem
            .rename(temporary, filename)
            .pipe(
              Effect.mapError((error) => new KimiAttemptStoreFailure({ detail: String(error), operation: "write" }))
            )
        })
      return KimiAttemptPrivateStore.of({
        read: (runId, attemptId) =>
          Ref.get(records).pipe(Effect.map((current) => recordFor(current, runId, attemptId))),
        write: (record) =>
          mutex.withPermit(
            Effect.gen(function* () {
              const current = yield* Ref.get(records)
              const next = [
                record,
                ...current.filter((item) => keyOf(item.runId, item.attemptId) !== keyOf(record.runId, record.attemptId))
              ]
              yield* decodeSnapshot({ records: next }, "write")
              yield* persist(next)
              yield* Ref.set(records, next)
            })
          )
      })
    })
  )
