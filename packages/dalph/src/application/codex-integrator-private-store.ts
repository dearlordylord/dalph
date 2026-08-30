/* eslint-disable import/no-nodejs-modules -- this module owns the explicit durable-store and path boundary. */

import { createHash } from "node:crypto"
import nodePath from "node:path"
import { GitRepositoryLocator } from "@dalph/contracts"
import { Context, Effect, FileSystem, Layer, Option, Ref, Schema, Semaphore } from "effect"
import { CodexServerIncarnation, CodexThreadId, CodexThreadOwnershipToken } from "./codex-attempt-store.js"
import {
  GitCommonDirectoryLocator,
  type IntegratorCandidateResourceLocator,
  IntegratorRunCorrelation,
  IntegratorSessionCorrelation
} from "@dalph/orchestrator"
import {
  appendPrivateRunHistory,
  codexIntegratorProviderRunOrdinals,
  type CodexIntegratorPrivateRun,
  CodexIntegratorPrivateRunHistory,
  CodexIntegratorSealedPrivateRunHistory,
  expectedProviderRunOrdinalAt,
  isInitialProviderRun,
  isRetryProviderRun,
  isSealedPrivateRun,
  isSupportedProviderRun,
  providerRunAdmissionError,
  sealedPrivateRunHistoryFrom
} from "./codex-integrator-private-lifecycle.js"

export { CodexIntegratorPrivateRun } from "./codex-integrator-private-lifecycle.js"

const sameSessionValue = Schema.toEquivalence(IntegratorSessionCorrelation)
const sameRunValue = Schema.toEquivalence(IntegratorRunCorrelation)

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

const privateRecordFields = {
  appServerIncarnation: CodexServerIncarnation,
  candidatePath: IntegratorCandidateWorktreePath,
  correlation: IntegratorSessionCorrelation,
  /** Exact initial provider run bound before the candidate-worktree boundary is crossed. */
  initialRun: IntegratorRunCorrelation,
  revision: CodexIntegratorPrivateRevision,
  threadToken: CodexThreadOwnershipToken
}

type CodexIntegratorPrivateRecordShape = {
  readonly correlation: IntegratorSessionCorrelation
  readonly initialRun: IntegratorRunCorrelation
  readonly revision: CodexIntegratorPrivateRevision
  readonly runs?: ReadonlyArray<CodexIntegratorPrivateRun>
}

const validatedRuns = (record: CodexIntegratorPrivateRecordShape): ReadonlyArray<CodexIntegratorPrivateRun> =>
  record.runs ?? []

const validatePrivateRunOrdinals = (record: CodexIntegratorPrivateRecordShape): string | undefined => {
  const runs = validatedRuns(record)
  const runOrdinals = runs.map((run) => run.correlation.ordinal)
  if (new Set(runOrdinals).size !== runOrdinals.length) return "private record repeats a provider run ordinal"
  if (runs.length > codexIntegratorProviderRunOrdinals.length) {
    return "private record contains more than the initial and retry provider runs"
  }
  /* v8 ignore next -- @preserve CodexIntegratorPrivateRun validates every ordinal before this record-level defensive check. */
  if (runs.some((run) => !isSupportedProviderRun(run.correlation))) {
    return "private record contains an unsupported provider run ordinal"
  }
  return runOrdinals.some((ordinal, index) => Number(ordinal) !== expectedProviderRunOrdinalAt(index))
    ? "private record provider runs must be contiguous from initial run one"
    : undefined
}

const validatePrivateRunTokens = (record: CodexIntegratorPrivateRecordShape): string | undefined => {
  const runs = validatedRuns(record)
  const runTokens = runs.map((run) => run.token)
  if (new Set(runTokens).size !== runTokens.length) return "private record repeats a provider turn token"
  const retry = runs.find((run) => isRetryProviderRun(run.correlation))
  const initial = runs.find((run) => isInitialProviderRun(run.correlation))
  const hasSealedInitialRun = isSealedPrivateRun(initial)
  return retry !== undefined && providerRunAdmissionError(retry.correlation, hasSealedInitialRun) !== undefined
    ? "private retry run requires a sealed initial run"
    : undefined
}

const validatePrivateRecordCorrelations = (record: CodexIntegratorPrivateRecordShape): string | undefined => {
  if (!sameSessionValue(record.correlation, record.initialRun.session) || !isInitialProviderRun(record.initialRun)) {
    return "private record must bind exact initial run one for its Integrator session"
  }
  const runs = validatedRuns(record)
  const sessions = runs.filter((run) => !sameSessionValue(record.correlation, run.correlation.session))
  if (sessions.length > 0) return "private run correlation belongs to another Integrator session"
  if (runs[0] !== undefined && !sameRunValue(runs[0].correlation, record.initialRun)) {
    return "private run history does not begin with the durably bound initial run"
  }
  return runs.some((run) => isSealedPrivateRun(run) && !sameRunValue(run.result.correlation, run.correlation))
    ? "private terminal result correlation does not match its provider run"
    : undefined
}

const validatePrivateRecord = (record: CodexIntegratorPrivateRecordShape): string | undefined => {
  const ordinalError = validatePrivateRunOrdinals(record)
  if (ordinalError !== undefined) return ordinalError
  const tokenError = validatePrivateRunTokens(record)
  if (tokenError !== undefined) return tokenError
  return validatePrivateRecordCorrelations(record)
}

/**
 * One durable Integrator candidate state. Each tag carries exactly the thread
 * and provider-run evidence established by that chronological boundary.
 */
export const CodexIntegratorPrivateRecord = Schema.TaggedUnion({
  CandidateUnmaterialized: privateRecordFields,
  WorktreeMaterializationIntentRecorded: privateRecordFields,
  CandidateReady: privateRecordFields,
  ThreadStartIntentRecorded: privateRecordFields,
  /** Codex returned the owned thread; the initial run is bound, but no turn token or intent exists yet. */
  ThreadReady: { ...privateRecordFields, threadId: CodexThreadId },
  /** At least one provider-run intent is durable for the exact owned thread. */
  ThreadWithRuns: { ...privateRecordFields, runs: CodexIntegratorPrivateRunHistory, threadId: CodexThreadId },
  /** Cleanup may cross the Git removal boundary only with sealed terminal evidence. */
  RemovalIntentRecorded: {
    ...privateRecordFields,
    runs: CodexIntegratorSealedPrivateRunHistory,
    threadId: CodexThreadId
  },
  /** The removed candidate retains sealed terminal evidence but no live thread ownership fact. */
  Removed: { ...privateRecordFields, runs: CodexIntegratorSealedPrivateRunHistory }
}).check(Schema.makeFilter(validatePrivateRecord))
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
  Schema.decodeUnknownEffect(Schema.Array(CodexIntegratorPrivateRecord), { onExcessProperty: "error" })(value).pipe(
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
  initial: ReadonlyArray<CodexIntegratorPrivateRecord> = [],
  observeWrite?: (record: CodexIntegratorPrivateRecord) => void
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
              if (observeWrite !== undefined) yield* Effect.sync(() => observeWrite(record))
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

type PrivateRecordCommonUpdate = { readonly appServerIncarnation?: CodexServerIncarnation }

export const bump = (
  record: CodexIntegratorPrivateRecord,
  update: PrivateRecordCommonUpdate
): CodexIntegratorPrivateRecord =>
  Schema.decodeUnknownSync(CodexIntegratorPrivateRecord)({
    ...record,
    ...update,
    revision: revision(Number(record.revision) + 1)
  })

export const nextPrivateRecordFields = (record: CodexIntegratorPrivateRecord) => ({
  appServerIncarnation: record.appServerIncarnation,
  candidatePath: record.candidatePath,
  correlation: record.correlation,
  initialRun: record.initialRun,
  revision: revision(Number(record.revision) + 1),
  threadToken: record.threadToken
})

export const preservedPrivateRecordFields = (record: CodexIntegratorPrivateRecord) => ({
  appServerIncarnation: record.appServerIncarnation,
  candidatePath: record.candidatePath,
  correlation: record.correlation,
  initialRun: record.initialRun,
  revision: record.revision,
  threadToken: record.threadToken
})

export const privateRuns = (record: CodexIntegratorPrivateRecord): ReadonlyArray<CodexIntegratorPrivateRun> =>
  "runs" in record ? record.runs : []

export const recordRunIntent = (
  record: CodexIntegratorPrivateRecord,
  run: Extract<CodexIntegratorPrivateRun, { readonly _tag: "IntentRecorded" }>,
  appServerIncarnation: CodexServerIncarnation
): Extract<CodexIntegratorPrivateRecord, { readonly _tag: "ThreadWithRuns" }> | undefined => {
  if (record._tag !== "ThreadReady" && record._tag !== "ThreadWithRuns") return undefined
  const runs = appendPrivateRunHistory(privateRuns(record), run)
  return runs === undefined
    ? undefined
    : CodexIntegratorPrivateRecord.cases.ThreadWithRuns.make({
        ...nextPrivateRecordFields(record),
        appServerIncarnation,
        runs,
        threadId: record.threadId
      })
}

export const removalIntentRecordFor = (
  record: CodexIntegratorPrivateRecord
): Extract<CodexIntegratorPrivateRecord, { readonly _tag: "RemovalIntentRecorded" }> | undefined => {
  if (record._tag !== "ThreadWithRuns") return undefined
  const runs = sealedPrivateRunHistoryFrom(privateRuns(record))
  return runs === undefined
    ? undefined
    : CodexIntegratorPrivateRecord.cases.RemovalIntentRecorded.make({
        ...preservedPrivateRecordFields(record),
        runs,
        threadId: record.threadId
      })
}

export const removedRecordFor = (
  record: CodexIntegratorPrivateRecord
): Extract<CodexIntegratorPrivateRecord, { readonly _tag: "Removed" }> | undefined => {
  const runs = sealedPrivateRunHistoryFrom(privateRuns(record))
  return runs === undefined
    ? undefined
    : CodexIntegratorPrivateRecord.cases.Removed.make({ ...preservedPrivateRecordFields(record), runs })
}

export const updateRun = (
  record: CodexIntegratorPrivateRecord,
  run: CodexIntegratorPrivateRun,
  next: CodexIntegratorPrivateRun
): CodexIntegratorPrivateRecord => {
  return Schema.decodeUnknownSync(CodexIntegratorPrivateRecord)({
    ...record,
    revision: revision(Number(record.revision) + 1),
    runs: privateRuns(record).map((item) => (item.correlation.ordinal === run.correlation.ordinal ? next : item))
  })
}
