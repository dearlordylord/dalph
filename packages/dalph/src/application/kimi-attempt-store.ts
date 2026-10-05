/* eslint-disable import/no-nodejs-modules -- the adapter owns its private path boundary. */

import nodePath from "node:path"
import {
  AttemptId,
  GitCommitSha,
  PlannedAttemptExecutorResult,
  PlannedAttemptRejectedResultReport,
  RunId,
  TaskExecutorLocator,
  WorktreeLocator
} from "@dalph/contracts"
import { Context, Effect, FileSystem, Layer, Option, Path, Ref, Schema, Semaphore } from "effect"
import { CodexAttemptStoreNative, nodeCodexAttemptStoreNativeLayer } from "./codex-attempt-store-native.js"
import {
  ensurePrivateDirectory,
  nativeErrorCode,
  openPrivateLeaseDescriptor,
  validatePrivateDescriptor
} from "./codex-attempt-store.js"
import { KimiResultCycle, kimiResultCycleTransitionProblem } from "./kimi-result-cycle.js"
import { KimiPromptRequestHistory, kimiPromptHistoryTransitionProblem } from "./kimi-prompt-history.js"
import { KimiAcpSessionId } from "./kimi-acp.js"
import {
  ProviderResultCycle,
  ProviderResultRequestToken,
  providerResultCycleTransitionProblem
} from "./provider-result-correction.js"

/** The provider-private phase retained for one Kimi session association. */
export const KimiAttemptPrivatePhase = Schema.Literals([
  "SessionCreated",
  "PromptIntentRecorded",
  "ResumeIntentRecorded",
  "Executing",
  "Suspended",
  "Terminal",
  "Unavailable",
  "ResultStopIntended",
  "ResultRejected"
])
export type KimiAttemptPrivatePhase = typeof KimiAttemptPrivatePhase.Type

/**
 * One provider-private Kimi association. It contains only opaque session
 * identity and the exact attempt resource; credentials and ACP envelopes are
 * intentionally not representable here.
 */
export const KimiAttemptPrivateRecord = Schema.Struct({
  attemptId: AttemptId,
  /** Exact planned Base used to distinguish a real executor commit on recovery. */
  baseSha: GitCommitSha,
  executor: TaskExecutorLocator,
  phase: KimiAttemptPrivatePhase,
  runId: RunId,
  sessionId: KimiAcpSessionId,
  worktree: WorktreeLocator,
  /** Sealed terminal result retained so recovery never needs a live provider session. */
  terminal: Schema.optionalKey(PlannedAttemptExecutorResult),
  /** Exact private response intents; omission preserves legacy records without inventing a budget. */
  resultCycle: Schema.optionalKey(ProviderResultCycle),
  /** Application-owned ACP intents and acknowledged responses, never synthetic provider turns. */
  promptRequests: Schema.optionalKey(KimiPromptRequestHistory),
  /** Response budget bound to ACP prompt acknowledgement, without a fabricated turn identity. */
  kimiResultCycle: Schema.optionalKey(KimiResultCycle),
  /** Durable recoverable rejection; it never becomes a semantic terminal seal. */
  resultRejection: Schema.optionalKey(PlannedAttemptRejectedResultReport),
  /** Set only after the terminal ACP session-close boundary is acknowledged. */
  sessionClosed: Schema.Boolean
}).check(
  Schema.makeFilter((record) => {
    if (record.resultRejection !== undefined) {
      if (record.terminal !== undefined || (record.phase !== "ResultStopIntended" && record.phase !== "ResultRejected"))
        return "recoverable rejection cannot acquire a terminal seal or ordinary executor phase"
      if (
        record.resultRejection.correlation.runId !== record.runId ||
        record.resultRejection.correlation.attemptId !== record.attemptId ||
        record.resultRejection.responseCount !== record.kimiResultCycle?.responses.length
      )
        return "recoverable rejection requires the exact retained attempt response cycle"
    }
    const cycle = record.kimiResultCycle
    if (cycle === undefined) return undefined
    if (cycle.plannedBaseSha !== record.baseSha) return "ACP response cycle must retain the exact attempt Base"
    for (const response of cycle.responses) {
      const prompt = record.promptRequests?.find(
        (entry) => ProviderResultRequestToken.make(entry.token) === response.intent.token
      )
      if (prompt === undefined || prompt.intendedAt !== response.intent.intendedAt)
        return "ACP result response requires its exact durable prompt intent"
      if ((response._tag === "RequestIntended") !== (prompt.response === "Pending"))
        return "ACP response ownership and prompt acknowledgement must agree"
    }
    return undefined
  })
)
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

interface KimiAttemptPrivateStoreService {
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

const validateResultCycleTransition = (
  previous: Option.Option<KimiAttemptPrivateRecord>,
  next: KimiAttemptPrivateRecord
): Effect.Effect<void, KimiAttemptStoreFailure> => {
  const prior = Option.getOrUndefined(previous)
  if (
    prior !== undefined &&
    (prior.baseSha !== next.baseSha ||
      prior.executor !== next.executor ||
      prior.worktree !== next.worktree ||
      prior.sessionId !== next.sessionId)
  )
    return Effect.fail(
      new KimiAttemptStoreFailure({ operation: "write", detail: "retained Kimi attempt ownership cannot change" })
    )
  if (
    prior?.terminal !== undefined &&
    (next.phase !== "Terminal" || JSON.stringify(prior.terminal) !== JSON.stringify(next.terminal))
  )
    return Effect.fail(
      new KimiAttemptStoreFailure({ operation: "write", detail: "retained Kimi terminal seal cannot change" })
    )
  if (
    prior?.resultRejection !== undefined &&
    (next.resultRejection === undefined ||
      JSON.stringify(prior.resultRejection) !== JSON.stringify(next.resultRejection))
  )
    return Effect.fail(
      new KimiAttemptStoreFailure({
        operation: "write",
        detail: "retained rejection requires explicit recovery authorization"
      })
    )

  const kimiCycleProblem =
    prior?.kimiResultCycle !== undefined && next.kimiResultCycle === undefined
      ? "retained ACP result budget cannot be removed"
      : next.kimiResultCycle === undefined
        ? undefined
        : prior?.terminal !== undefined && prior.kimiResultCycle === undefined
          ? "historical terminal seal cannot acquire an ACP correction cycle"
          : kimiResultCycleTransitionProblem(prior?.kimiResultCycle, next.kimiResultCycle)
  if (kimiCycleProblem !== undefined)
    return Effect.fail(new KimiAttemptStoreFailure({ operation: "write", detail: kimiCycleProblem }))

  const promptProblem =
    prior?.terminal !== undefined && prior.promptRequests === undefined && next.promptRequests !== undefined
      ? "historical terminal seal cannot acquire prompt history"
      : kimiPromptHistoryTransitionProblem(prior?.promptRequests, next.promptRequests)
  if (promptProblem !== undefined)
    return Effect.fail(new KimiAttemptStoreFailure({ operation: "write", detail: promptProblem }))
  const before = Option.isSome(previous) ? previous.value.resultCycle : undefined
  const after = next.resultCycle
  const problem =
    before !== undefined && after === undefined
      ? "retained result cycle cannot be removed"
      : after === undefined
        ? undefined
        : Option.isSome(previous) && previous.value.terminal !== undefined && before === undefined
          ? "historical terminal seal cannot acquire a result correction cycle"
          : providerResultCycleTransitionProblem(before, after)
  return problem === undefined
    ? Effect.void
    : Effect.fail(new KimiAttemptStoreFailure({ operation: "write", detail: problem }))
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
              yield* validateResultCycleTransition(recordFor(current, record.runId, record.attemptId), record)
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

interface KimiAttemptPrivateStoreConfig {
  /** Absolute, normalized directory shared only with other Dalph private state files. */
  readonly stateDirectory: string
}

const privateStateFilename = "kimi-executor-private-state.json"
const privateLeaseFilename = `${privateStateFilename}.lease`
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
export const kimiAttemptPrivateStoreLayer = (
  config: KimiAttemptPrivateStoreConfig
): Layer.Layer<
  KimiAttemptPrivateStore,
  KimiAttemptStoreFailure,
  CodexAttemptStoreNative | FileSystem.FileSystem | Path.Path
> =>
  Layer.effect(
    KimiAttemptPrivateStore,
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const native = yield* CodexAttemptStoreNative
      const stateDirectory = yield* decodeStateDirectory(config.stateDirectory, path)
      const filename = nodePath.join(stateDirectory, privateStateFilename)
      const temporary = `${filename}.next`
      const leaseFilename = nodePath.join(stateDirectory, privateLeaseFilename)
      const directory = yield* Effect.tryPromise({
        try: () => ensurePrivateDirectory(stateDirectory, native),
        catch: (error) => new KimiAttemptStoreFailure({ detail: String(error), operation: "configure" })
      })
      if (directory._tag === "Failure") {
        return yield* Effect.fail(new KimiAttemptStoreFailure({ detail: directory.detail, operation: "configure" }))
      }
      const lease = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: () => openPrivateLeaseDescriptor(leaseFilename, native),
          catch: (error) => new KimiAttemptStoreFailure({ detail: String(error), operation: "configure" })
        }),
        (file) =>
          Effect.tryPromise({
            try: async () => {
              // The shared Codex native adapter exposes the same descriptor
              // lock boundary; release before closing to make the lease
              // disposition explicit on every platform it supports.
              await native.lock(file, "un")
              await file.close()
            },
            catch: (error) => new KimiAttemptStoreFailure({ detail: String(error), operation: "configure" })
          }).pipe(Effect.orDie)
      )
      yield* validatePrivateDescriptor(lease, leaseFilename, native).pipe(
        Effect.mapError((error) => new KimiAttemptStoreFailure({ detail: error.detail, operation: "configure" }))
      )
      yield* Effect.tryPromise({
        try: () => native.lock(lease, "exnb"),
        catch: (error) =>
          new KimiAttemptStoreFailure({
            detail:
              nativeErrorCode(error) === "EACCES" ||
              nativeErrorCode(error) === "EAGAIN" ||
              nativeErrorCode(error) === "EWOULDBLOCK"
                ? "Kimi private store is already owned by another process"
                : String(error),
            operation: "configure"
          })
      })
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
              yield* validateResultCycleTransition(recordFor(current, record.runId, record.attemptId), record)
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

/** Production Kimi private store with the Node descriptor and lock boundary. */
export const nodeKimiAttemptPrivateStoreLayer = (
  config: KimiAttemptPrivateStoreConfig
): Layer.Layer<KimiAttemptPrivateStore, KimiAttemptStoreFailure, FileSystem.FileSystem | Path.Path> =>
  kimiAttemptPrivateStoreLayer(config).pipe(Layer.provide(nodeCodexAttemptStoreNativeLayer))
