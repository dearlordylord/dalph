/* eslint-disable import/no-nodejs-modules -- this module owns the explicit durable-store and path boundary. */

import { createHash } from "node:crypto"
import nodePath from "node:path"
import { GitRepositoryLocator } from "@dalph/contracts"
import { Context, Effect, FileSystem, Layer, Option, Ref, Schema, Semaphore } from "effect"
import {
  CodexOwnedTurnToken,
  CodexServerIncarnation,
  CodexThreadId,
  CodexThreadOwnershipToken,
  CodexTurnId
} from "./codex-attempt-store.js"
import {
  GitCommonDirectoryLocator,
  type IntegratorCandidateResourceLocator,
  IntegratorResult,
  IntegratorRunCorrelation,
  IntegratorSessionCorrelation
} from "@dalph/orchestrator"

const sameSessionValue = Schema.toEquivalence(IntegratorSessionCorrelation)
const sameRunValue = Schema.toEquivalence(IntegratorRunCorrelation)
const firstPrivateRunOrdinal = 1
const maximumPrivateRunOrdinal = 2

/** A canonical absolute root under which provider worktrees may be materialized. */
export const IntegratorCandidateWorktreeRoot = Schema.String.check(
  Schema.makeFilter((value) => {
    if (!nodePath.isAbsolute(value)) return "candidate worktree root must be absolute"
    if (nodePath.normalize(value) !== value) return "candidate worktree root must be normalized"
    return undefined
  })
).pipe(Schema.brand("IntegratorCandidateWorktreeRoot"))
export type IntegratorCandidateWorktreeRoot = typeof IntegratorCandidateWorktreeRoot.Type

/** A canonical absolute path to the private store file, never a workflow-journal locator. */
export const IntegratorPrivateStoreLocator = Schema.String.check(
  Schema.makeFilter((value) => {
    if (!nodePath.isAbsolute(value)) return "private store locator must be absolute"
    if (nodePath.normalize(value) !== value) return "private store locator must be normalized"
    return undefined
  })
).pipe(Schema.brand("IntegratorPrivateStoreLocator"))
export type IntegratorPrivateStoreLocator = typeof IntegratorPrivateStoreLocator.Type

/** The exact candidate path derived from one canonical resource locator. */
export const IntegratorCandidateWorktreePath = Schema.String.check(
  Schema.makeFilter((value) => (nodePath.isAbsolute(value) ? undefined : "candidate worktree path must be absolute"))
).pipe(Schema.brand("IntegratorCandidateWorktreePath"))
export type IntegratorCandidateWorktreePath = typeof IntegratorCandidateWorktreePath.Type

/** Decoded provider facts accepted from the host composition; no raw CLI values cross this seam. */
export const CodexIntegratorConfiguration = Schema.Struct({
  candidateWorktreeRoot: IntegratorCandidateWorktreeRoot,
  commonDirectory: GitCommonDirectoryLocator,
  privateStoreLocator: IntegratorPrivateStoreLocator,
  repository: GitRepositoryLocator
})
export type CodexIntegratorConfiguration = typeof CodexIntegratorConfiguration.Type

/** Monotone private-record revision used to detect stale cleanup observations. */
const CodexIntegratorPrivateRevision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).pipe(
  Schema.brand("CodexIntegratorPrivateRevision")
)
type CodexIntegratorPrivateRevision = typeof CodexIntegratorPrivateRevision.Type

/** One exact private run; the token is allocated before the provider turn boundary. */
export const CodexIntegratorPrivateRun = Schema.Struct({
  correlation: IntegratorRunCorrelation,
  phase: Schema.Literals(["IntentRecorded", "TurnBoundaryCrossing", "TurnObserved", "Sealed"]),
  result: Schema.NullOr(IntegratorResult),
  token: CodexOwnedTurnToken,
  turnId: Schema.NullOr(CodexTurnId)
}).check(
  Schema.makeFilter((run) => {
    if (run.phase === "IntentRecorded" || run.phase === "TurnBoundaryCrossing") {
      return run.result !== null || run.turnId !== null
        ? "an unobserved provider turn cannot retain a result or turn id"
        : undefined
    }
    if (run.phase === "TurnObserved") {
      return run.result !== null || run.turnId === null
        ? "an observed provider turn must retain only its exact turn id"
        : undefined
    }
    return run.result === null || run.turnId === null
      ? "a sealed provider turn must retain its exact turn and terminal result"
      : undefined
  })
)
export type CodexIntegratorPrivateRun = typeof CodexIntegratorPrivateRun.Type

/** Private durable ownership and recovery facts. Transcript and prompt bytes are intentionally absent. */
export const CodexIntegratorPrivateRecord = Schema.Struct({
  appServerIncarnation: CodexServerIncarnation,
  candidatePath: IntegratorCandidateWorktreePath,
  correlation: IntegratorSessionCorrelation,
  revision: CodexIntegratorPrivateRevision,
  runs: Schema.Array(CodexIntegratorPrivateRun),
  /** A durable marker left after exact Git absence was reread. */
  removed: Schema.optionalKey(Schema.Boolean),
  /** A durable removal request whose response may require rereading Git. */
  removalIntent: Schema.optionalKey(Schema.Boolean),
  threadId: Schema.NullOr(CodexThreadId),
  threadToken: CodexThreadOwnershipToken,
  threadStartIntent: Schema.Boolean,
  /** A durable candidate-materialization request preceding any Git add. */
  worktreeMaterializationIntent: Schema.optionalKey(Schema.Boolean),
  worktreeReady: Schema.Boolean
}).check(
  Schema.makeFilter((record) => {
    const runOrdinals = record.runs.map((run) => run.correlation.ordinal)
    if (new Set(runOrdinals).size !== runOrdinals.length) return "private record repeats a provider run ordinal"
    if (record.runs.length > maximumPrivateRunOrdinal)
      return "private record contains more than the initial and retry provider runs"
    /* v8 ignore next -- @preserve CodexIntegratorPrivateRun validates every ordinal before this record-level defensive check. */
    if (
      record.runs.some(
        (run) =>
          Number(run.correlation.ordinal) < firstPrivateRunOrdinal ||
          Number(run.correlation.ordinal) > maximumPrivateRunOrdinal
      )
    ) {
      return "private record contains an unsupported provider run ordinal"
    }
    if (runOrdinals.some((ordinal, index) => Number(ordinal) !== index + firstPrivateRunOrdinal)) {
      return "private record provider runs must be contiguous from initial run one"
    }
    const runTokens = record.runs.map((run) => run.token)
    if (new Set(runTokens).size !== runTokens.length) return "private record repeats a provider turn token"
    const retry = record.runs.find((run) => Number(run.correlation.ordinal) === maximumPrivateRunOrdinal)
    const initial = record.runs.find((run) => Number(run.correlation.ordinal) === firstPrivateRunOrdinal)
    if (
      retry !== undefined &&
      (initial === undefined || initial.phase !== "Sealed" || initial.result === null || initial.turnId === null)
    ) {
      return "private retry run requires a sealed initial run"
    }
    if (record.threadStartIntent && record.threadId !== null) {
      return "private record cannot retain a thread-start intent after recording a thread id"
    }
    if (record.removalIntent === true && record.removed === true) {
      return "private record cannot retain removal intent after recording removal"
    }
    if (record.worktreeMaterializationIntent === true && record.worktreeReady) {
      return "private record cannot retain worktree materialization intent after readiness"
    }
    if (record.removed === true && (record.worktreeReady || record.threadStartIntent || record.threadId !== null)) {
      return "a removed private record cannot retain live candidate ownership"
    }
    const sessions = record.runs.filter((run) => !sameSessionValue(record.correlation, run.correlation.session))
    if (sessions.length > 0) return "private run correlation belongs to another Integrator session"
    return record.runs.some((run) => run.result !== null && !sameRunValue(run.result.correlation, run.correlation))
      ? "private terminal result correlation does not match its provider run"
      : undefined
  })
)
export type CodexIntegratorPrivateRecord = typeof CodexIntegratorPrivateRecord.Type

export class CodexIntegratorStoreFailure extends Schema.TaggedError<CodexIntegratorStoreFailure>()(
  "CodexIntegratorStoreFailure",
  { detail: Schema.String }
) {}

/** The private provider store is deliberately narrower than the workflow journal. */
export interface CodexIntegratorPrivateStoreService {
  readonly read: (
    sessionId: IntegratorSessionCorrelation["sessionId"]
  ) => Effect.Effect<Option.Option<CodexIntegratorPrivateRecord>, CodexIntegratorStoreFailure>
  /** Finds an existing owner of the exact deterministic candidate path before a new session adopts it. */
  readonly findByCandidatePath: (
    candidatePath: IntegratorCandidateWorktreePath
  ) => Effect.Effect<Option.Option<CodexIntegratorPrivateRecord>, CodexIntegratorStoreFailure>
  readonly write: (record: CodexIntegratorPrivateRecord) => Effect.Effect<void, CodexIntegratorStoreFailure>
}

export class CodexIntegratorPrivateStore extends Context.Service<
  CodexIntegratorPrivateStore,
  CodexIntegratorPrivateStoreService
>()("@dalph/CodexIntegratorPrivateStore") {}

const recordFor = (
  records: ReadonlyArray<CodexIntegratorPrivateRecord>,
  sessionId: IntegratorSessionCorrelation["sessionId"]
): Option.Option<CodexIntegratorPrivateRecord> => {
  const found = records.find((record) => record.correlation.sessionId === sessionId)
  return found === undefined ? Option.none() : Option.some(found)
}

const decodeRecords = (
  value: unknown
): Effect.Effect<ReadonlyArray<CodexIntegratorPrivateRecord>, CodexIntegratorStoreFailure> =>
  Schema.decodeUnknownEffect(Schema.Array(CodexIntegratorPrivateRecord))(value).pipe(
    Effect.flatMap((records) => {
      const sessionIds = records.map((record) => record.correlation.sessionId)
      if (new Set(sessionIds).size !== sessionIds.length) {
        return Effect.fail(new CodexIntegratorStoreFailure({ detail: "private store repeats a session record" }))
      }
      const candidatePaths = records.map((record) => record.candidatePath)
      return new Set(candidatePaths).size === candidatePaths.length
        ? Effect.succeed(records)
        : Effect.fail(new CodexIntegratorStoreFailure({ detail: "private store aliases a candidate path" }))
    }),
    Effect.mapError((error) =>
      error instanceof CodexIntegratorStoreFailure
        ? error
        : new CodexIntegratorStoreFailure({ detail: `private store is malformed: ${String(error)}` })
    )
  )

/** Controlled private store used by provider contract and prefix-recovery tests. */
export const memoryCodexIntegratorPrivateStoreLayer = (
  initial: ReadonlyArray<CodexIntegratorPrivateRecord> = []
): Layer.Layer<CodexIntegratorPrivateStore> =>
  Layer.effect(
    CodexIntegratorPrivateStore,
    Effect.gen(function* () {
      // Keep the initial value opaque until the first operation.  Controlled
      // fixtures can therefore prove malformed durable state fails through
      // the same typed store boundary as a corrupted node file.
      const records = yield* Ref.make<ReadonlyArray<unknown>>(initial)
      const mutex = yield* Semaphore.make(1)
      return CodexIntegratorPrivateStore.of({
        read: (sessionId) =>
          Ref.get(records).pipe(
            Effect.flatMap(decodeRecords),
            Effect.map((current) => recordFor(current, sessionId))
          ),
        findByCandidatePath: (candidatePath) =>
          Ref.get(records).pipe(
            Effect.flatMap(decodeRecords),
            Effect.map((current) => {
              const found = current.find((record) => record.candidatePath === candidatePath)
              return found === undefined ? Option.none() : Option.some(found)
            })
          ),
        write: (record) =>
          mutex.withPermits(1)(
            Effect.gen(function* () {
              const current = yield* decodeRecords(yield* Ref.get(records))
              const next = [
                record,
                ...current.filter((item) => item.correlation.sessionId !== record.correlation.sessionId)
              ]
              yield* decodeRecords(next)
              yield* Ref.set(records, next)
            })
          )
      })
    })
  )

const encodeStore = (records: ReadonlyArray<CodexIntegratorPrivateRecord>): string => `${JSON.stringify(records)}\n`

const decodeStore = (
  value: string
): Effect.Effect<ReadonlyArray<CodexIntegratorPrivateRecord>, CodexIntegratorStoreFailure> =>
  Effect.try({
    try: (): unknown => JSON.parse(value),
    catch: (error) => new CodexIntegratorStoreFailure({ detail: `private store is malformed: ${String(error)}` })
  }).pipe(Effect.flatMap(decodeRecords))

/** Node-backed store. Every read reopens the file so a later process can recover the same private session. */
export const nodeCodexIntegratorPrivateStoreLayer = (
  config: Pick<CodexIntegratorConfiguration, "privateStoreLocator">
): Layer.Layer<CodexIntegratorPrivateStore, never, FileSystem.FileSystem> =>
  Layer.effect(
    CodexIntegratorPrivateStore,
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const mutex = yield* Semaphore.make(1)
      const readAll = Effect.fn("CodexIntegratorPrivateStore.Node.readAll")(function* () {
        const exists = yield* fileSystem
          .exists(config.privateStoreLocator)
          .pipe(Effect.mapError((error) => new CodexIntegratorStoreFailure({ detail: String(error) })))
        if (!exists) return []
        const encoded = yield* fileSystem
          .readFileString(config.privateStoreLocator)
          .pipe(Effect.mapError((error) => new CodexIntegratorStoreFailure({ detail: String(error) })))
        return yield* decodeStore(encoded)
      })
      const writeAll = (records: ReadonlyArray<CodexIntegratorPrivateRecord>) =>
        Effect.gen(function* () {
          const parent = nodePath.dirname(config.privateStoreLocator)
          yield* fileSystem
            .makeDirectory(parent, { recursive: true })
            .pipe(Effect.mapError((error) => new CodexIntegratorStoreFailure({ detail: String(error) })))
          const temporary = `${config.privateStoreLocator}.next`
          yield* fileSystem
            .writeFileString(temporary, encodeStore(records), { mode: 0o600 })
            .pipe(Effect.mapError((error) => new CodexIntegratorStoreFailure({ detail: String(error) })))
          yield* fileSystem
            .rename(temporary, config.privateStoreLocator)
            .pipe(Effect.mapError((error) => new CodexIntegratorStoreFailure({ detail: String(error) })))
        })
      return CodexIntegratorPrivateStore.of({
        read: (sessionId) => readAll().pipe(Effect.map((records) => recordFor(records, sessionId))),
        findByCandidatePath: (candidatePath) =>
          readAll().pipe(
            Effect.map((records) => {
              const found = records.find((record) => record.candidatePath === candidatePath)
              return found === undefined ? Option.none() : Option.some(found)
            })
          ),
        write: (record) =>
          mutex.withPermits(1)(
            Effect.gen(function* () {
              const records = yield* readAll()
              yield* writeAll([
                record,
                ...records.filter((item) => item.correlation.sessionId !== record.correlation.sessionId)
              ])
            })
          )
      })
    })
  )

const hashLocator = (config: CodexIntegratorConfiguration, locator: IntegratorCandidateResourceLocator): string =>
  createHash("sha256")
    .update(`${config.repository}\u0000${config.commonDirectory}\u0000${locator}`, "utf8")
    .digest("hex")

/** Pure deterministic resource mapping used by both provider and cleanup authority. */
export const candidateWorktreePathFor = (
  config: CodexIntegratorConfiguration,
  locator: IntegratorCandidateResourceLocator
): IntegratorCandidateWorktreePath => {
  const root = nodePath.resolve(config.candidateWorktreeRoot)
  const candidate = nodePath.resolve(root, `dalph-integrator-${hashLocator(config, locator)}`)
  return IntegratorCandidateWorktreePath.make(candidate)
}
/** Shared equality for exact session ownership and cleanup reconciliation. */
export const sameSession = sameSessionValue

/** Shared equality for one exact provider run across a restart. */
export const runCorrelationEquals = sameRunValue

export const revision = (value: number): CodexIntegratorPrivateRevision => CodexIntegratorPrivateRevision.make(value)

export const bump = (
  record: CodexIntegratorPrivateRecord,
  update: Partial<CodexIntegratorPrivateRecord>
): CodexIntegratorPrivateRecord =>
  CodexIntegratorPrivateRecord.make({ ...record, ...update, revision: revision(Number(record.revision) + 1) })

/** Applies a private lifecycle marker without changing the external evidence revision. */
export const preserveRevision = (
  record: CodexIntegratorPrivateRecord,
  update: Partial<CodexIntegratorPrivateRecord>
): CodexIntegratorPrivateRecord => CodexIntegratorPrivateRecord.make({ ...record, ...update })

export const updateRun = (
  record: CodexIntegratorPrivateRecord,
  run: CodexIntegratorPrivateRun,
  update: Partial<CodexIntegratorPrivateRun>
): CodexIntegratorPrivateRecord => {
  const next = CodexIntegratorPrivateRun.make({ ...run, ...update })
  return bump(record, {
    runs: record.runs.map((item) => (item.correlation.ordinal === run.correlation.ordinal ? next : item))
  })
}
