/* eslint-disable import/no-nodejs-modules -- this adapter is the explicit provider and filesystem boundary. */
/* eslint-disable max-lines -- provider recovery and its ownership authority are one audited boundary. */

import { createHash, randomUUID } from "node:crypto"
import nodePath from "node:path"
import { GitRepositoryLocator } from "@dalph/contracts"
import { Context, Effect, FileSystem, Layer, Option, Ref, Schema, Semaphore } from "effect"
import {
  CodexAppServer,
  CodexOwnedActivityCensus,
  type CodexOwnedActivityCensusProjection,
  type CodexThreadSnapshot,
  type CodexTurnSnapshot
} from "./codex-app-server.js"
import { collectText, isTerminalTurn } from "./codex-planned-attempt-executor.js"
import { CodexOwnedTurnToken, CodexServerIncarnation, CodexThreadId, CodexTurnId } from "./codex-attempt-store.js"
import {
  Integrator,
  IntegratorCandidateCleanupMutationResult,
  IntegratorCandidateProviderAuthority,
  type IntegratorCandidateCleanupAuthorization,
  IntegratorCandidateCleanupObservation,
  IntegratorCallFailure,
  type IntegratorRequest,
  IntegratorResult,
  IntegratorRunCorrelation,
  IntegratorSessionCorrelation,
  type IntegratorCandidateResourceLocator,
  IntegratorCandidateText,
  IntegratorNotPreparedDetail,
  GitCommand,
  type GitCommandService,
  CoordinatorOwnership,
  GitCommonDirectoryLocator
} from "@dalph/orchestrator"

const runCorrelationEquals = Schema.toEquivalence(IntegratorRunCorrelation)
const firstProviderRunOrdinal = 1
const maximumProviderRunOrdinal = 2
const lastElementOffset = -1

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
export const CodexIntegratorPrivateRevision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).pipe(
  Schema.brand("CodexIntegratorPrivateRevision")
)
export type CodexIntegratorPrivateRevision = typeof CodexIntegratorPrivateRevision.Type

/** One exact private run; the token is allocated before the provider turn boundary. */
export const CodexIntegratorPrivateRun = Schema.Struct({
  correlation: IntegratorRunCorrelation,
  phase: Schema.Literals(["IntentRecorded", "TurnBoundaryCrossing", "TurnObserved", "Sealed"]),
  result: Schema.NullOr(IntegratorResult),
  token: CodexOwnedTurnToken,
  turnId: Schema.NullOr(CodexTurnId)
})
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
  threadStartIntent: Schema.Boolean,
  /** A durable candidate-materialization request preceding any Git add. */
  worktreeMaterializationIntent: Schema.optionalKey(Schema.Boolean),
  worktreeReady: Schema.Boolean
})
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

/** Controlled private store used by provider contract and prefix-recovery tests. */
export const memoryCodexIntegratorPrivateStoreLayer = (
  initial: ReadonlyArray<CodexIntegratorPrivateRecord> = []
): Layer.Layer<CodexIntegratorPrivateStore> =>
  Layer.effect(
    CodexIntegratorPrivateStore,
    Effect.gen(function* () {
      const records = yield* Ref.make<ReadonlyArray<CodexIntegratorPrivateRecord>>(initial)
      const mutex = yield* Semaphore.make(1)
      return CodexIntegratorPrivateStore.of({
        read: (sessionId) => Ref.get(records).pipe(Effect.map((current) => recordFor(current, sessionId))),
        findByCandidatePath: (candidatePath) =>
          Ref.get(records).pipe(
            Effect.map((current) => {
              const found = current.find((record) => record.candidatePath === candidatePath)
              return found === undefined ? Option.none() : Option.some(found)
            })
          ),
        write: (record) =>
          mutex.withPermits(1)(
            Ref.update(records, (current) => [
              record,
              ...current.filter((item) => item.correlation.sessionId !== record.correlation.sessionId)
            ])
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
  }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(CodexIntegratorPrivateRecord))),
    Effect.flatMap((records) => {
      const sessionIds = records.map((record) => record.correlation.sessionId)
      return new Set(sessionIds).size === sessionIds.length
        ? Effect.succeed(records)
        : Effect.fail(new CodexIntegratorStoreFailure({ detail: "private store repeats a session record" }))
    }),
    Effect.mapError((error) =>
      error instanceof CodexIntegratorStoreFailure
        ? error
        : new CodexIntegratorStoreFailure({ detail: `private store is malformed: ${String(error)}` })
    )
  )

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

const sameSession = Schema.toEquivalence(IntegratorSessionCorrelation)

const providerFailure = (detail: string): CodexIntegratorProviderFailure =>
  new CodexIntegratorProviderFailure({ detail })

class CodexIntegratorProviderFailure extends Schema.TaggedError<CodexIntegratorProviderFailure>()(
  "CodexIntegratorProviderFailure",
  { detail: Schema.String }
) {}

const boundary = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, CodexIntegratorProviderFailure, R> =>
  effect.pipe(Effect.mapError((error) => providerFailure(errorDetail(error))))

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const isAgentMessage = (value: unknown): boolean => {
  if (!isRecord(value)) return false
  return value["type"] === "agentMessage"
}

const malformedEnvelope = (run: IntegratorRunCorrelation): IntegratorResult =>
  IntegratorResult.cases.NotPrepared.make({
    correlation: run,
    detail: IntegratorNotPreparedDetail.make("Codex returned a malformed result envelope")
  })

const exactEnvelope = (turn: CodexTurnSnapshot, run: IntegratorRunCorrelation): Effect.Effect<IntegratorResult> =>
  Effect.gen(function* () {
    const messages = turn.items.filter(isAgentMessage)
    const finalMessage = messages.at(lastElementOffset)
    if (finalMessage === undefined) {
      return IntegratorResult.cases.NotPrepared.make({
        correlation: run,
        detail: IntegratorNotPreparedDetail.make("Codex returned no unique result envelope")
      })
    }
    const parsed = yield* Effect.try({
      try: (): unknown => JSON.parse(collectText(finalMessage)),
      catch: () => undefined
    }).pipe(Effect.option)
    if (Option.isNone(parsed) || !isRecord(parsed.value)) return malformedEnvelope(run)
    const value = parsed.value
    const keys = Object.keys(value).sort().join(",")
    if (keys !== "candidate,outcome,version" && keys !== "detail,outcome,version") return malformedEnvelope(run)
    if (value["version"] !== 1 || (value["outcome"] !== "PreparedCandidate" && value["outcome"] !== "NotPrepared")) {
      return malformedEnvelope(run)
    }
    if (value["outcome"] === "PreparedCandidate") {
      const candidate = Schema.decodeUnknownOption(IntegratorCandidateText)(value["candidate"])
      return Option.isSome(candidate)
        ? IntegratorResult.cases.PreparedCandidate.make({ correlation: run, candidateText: candidate.value })
        : malformedEnvelope(run)
    }
    const detail = Schema.decodeUnknownOption(IntegratorNotPreparedDetail)(value["detail"])
    return Option.isSome(detail)
      ? IntegratorResult.cases.NotPrepared.make({ correlation: run, detail: detail.value })
      : malformedEnvelope(run)
  })

const errorDetail = (error: unknown): string => {
  if (isRecord(error) && typeof error["detail"] === "string" && error["detail"].length > 0) {
    return error["detail"]
  }
  if (error instanceof Error && error.message.length > 0) return error.message
  const rendered = String(error)
  return rendered.length > 0 ? rendered : "provider boundary failed without detail"
}

const promptFor = (run: IntegratorRunCorrelation, candidatePath: IntegratorCandidateWorktreePath): string =>
  [
    "You are the Dalph integration provider.",
    `Target repository: ${run.session.integrationTarget.repository}`,
    `Target ref: ${run.session.integrationTarget.ref}`,
    `Unchanged target head H: ${run.session.expectedTargetHead}`,
    `Accepted commit C: ${run.session.acceptedResult.commit}`,
    `Candidate worktree: ${candidatePath}`,
    `Exact integration run: ${run.session.sessionId}/${run.ordinal}`,
    "Work only inside the candidate worktree. Do not update the target ref.",
    'Return exactly one terminal JSON object: {"version":1,"outcome":"PreparedCandidate","candidate":"<git commit text>"} or {"version":1,"outcome":"NotPrepared","detail":"<safe non-empty detail>"}.'
  ].join("\n")

const activityIsAbsent = (
  projection: CodexOwnedActivityCensusProjection
): Effect.Effect<void, CodexIntegratorProviderFailure> =>
  projection._tag === "Absent"
    ? Effect.void
    : Effect.fail(
        providerFailure(
          projection._tag === "ExactLive"
            ? "provider-owned activity is still live"
            : `provider-owned activity census is ${projection._tag.toLowerCase()}`
        )
      )

const observedThread = (
  app: CodexAppServer["Service"],
  threadId: CodexThreadId,
  candidatePath: IntegratorCandidateWorktreePath
): Effect.Effect<CodexThreadSnapshot, CodexIntegratorProviderFailure> =>
  boundary(app.resumeThread(threadId, candidatePath)).pipe(
    Effect.flatMap((thread) =>
      thread.id !== threadId || thread.cwd !== candidatePath || thread.correlation !== undefined
        ? Effect.fail(providerFailure("Codex thread identity or cwd is foreign"))
        : Effect.succeed(thread)
    )
  )

const observeQuiescence = (
  app: CodexAppServer["Service"],
  census: CodexOwnedActivityCensus["Service"],
  thread: CodexThreadSnapshot
): Effect.Effect<void, CodexIntegratorProviderFailure> =>
  boundary(app.listBackgroundTerminals(thread.id)).pipe(
    Effect.flatMap((terminals) => boundary(census.observe(thread, terminals))),
    Effect.flatMap(activityIsAbsent)
  )

const revision = (value: number): CodexIntegratorPrivateRevision => CodexIntegratorPrivateRevision.make(value)

const bump = (
  record: CodexIntegratorPrivateRecord,
  update: Partial<CodexIntegratorPrivateRecord>
): CodexIntegratorPrivateRecord =>
  CodexIntegratorPrivateRecord.make({ ...record, ...update, revision: revision(Number(record.revision) + 1) })

const updateRun = (
  record: CodexIntegratorPrivateRecord,
  run: CodexIntegratorPrivateRun,
  update: Partial<CodexIntegratorPrivateRun>
): CodexIntegratorPrivateRecord => {
  const next = CodexIntegratorPrivateRun.make({ ...run, ...update })
  return bump(record, {
    runs: record.runs.map((item) => (item.correlation.ordinal === run.correlation.ordinal ? next : item))
  })
}

const configError = (config: CodexIntegratorConfiguration): string | undefined => {
  const root = config.candidateWorktreeRoot
  return nodePath.isAbsolute(root) && nodePath.normalize(root) === root ? undefined : "candidate root is not canonical"
}

const parseWorktreeList = (
  stdout: string
):
  | {
      readonly _tag: "Valid"
      readonly records: ReadonlyArray<{
        readonly worktree: string
        readonly head: string
        readonly branch?: string
        readonly detached: boolean
        readonly prunable: boolean
      }>
    }
  | { readonly _tag: "Malformed"; readonly detail: string } => {
  const blocks = stdout
    .split(/\n\s*\n/u)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
  const records = blocks.map((block) => {
    const fields = block.split("\n").map((line) => {
      const separator = line.indexOf(" ")
      const name = separator < 0 ? line : line.slice(0, separator)
      const value = separator < 0 ? "" : line.slice(separator + 1)
      return [name, value] as const
    })
    const names = fields.map(([name]) => name)
    if (
      names.some((name) => !["worktree", "HEAD", "branch", "bare", "detached", "locked", "prunable"].includes(name)) ||
      new Set(names).size !== names.length
    )
      return undefined
    const values = new Map(fields)
    const worktree = values.get("worktree")
    const head = values.get("HEAD")
    const branch = values.get("branch")
    const detached = values.has("detached")
    const prunable = values.has("prunable")
    return worktree !== undefined && head !== undefined && (branch !== undefined || detached)
      ? branch === undefined
        ? { worktree, head, detached, prunable }
        : { worktree, head, branch, detached, prunable }
      : undefined
  })
  if (records.some((record) => record === undefined)) {
    return { _tag: "Malformed", detail: "git worktree list contained a malformed porcelain block" }
  }
  const validRecords = records.filter((record): record is NonNullable<typeof record> => record !== undefined)
  if (
    validRecords.some(
      (record, index) =>
        validRecords.findIndex((candidate) => candidate.worktree === record.worktree) !== index ||
        (record.branch !== undefined &&
          validRecords.findIndex((candidate) => candidate.branch === record.branch) !== index)
    )
  ) {
    return { _tag: "Malformed", detail: "git worktree list contained an ambiguous duplicate registration" }
  }
  return { _tag: "Valid", records: validRecords }
}

const readWorktrees = (
  commands: GitCommandService,
  config: CodexIntegratorConfiguration
): Effect.Effect<
  ReadonlyArray<{
    readonly worktree: string
    readonly head: string
    readonly branch?: string
    readonly detached: boolean
    readonly prunable: boolean
  }>,
  CodexIntegratorProviderFailure
> =>
  boundary(commands.run(config.commonDirectory, ["worktree", "list", "--porcelain"])).pipe(
    Effect.flatMap((result) => {
      if (result.exitCode !== 0)
        return Effect.fail(providerFailure(`git worktree list failed: ${result.stderr.trim()}`))
      const parsed = parseWorktreeList(result.stdout)
      return parsed._tag === "Valid" ? Effect.succeed(parsed.records) : Effect.fail(providerFailure(parsed.detail))
    })
  )

const ensureCandidateWorktree = Effect.fn("CodexIntegrator.ensureCandidateWorktree")(function* (
  commands: GitCommandService,
  fileSystem: FileSystem.FileSystem,
  config: CodexIntegratorConfiguration,
  record: CodexIntegratorPrivateRecord,
  store: CodexIntegratorPrivateStoreService,
  ownership: CoordinatorOwnership["Service"]
) {
  const candidatePath = record.candidatePath
  const intended =
    record.worktreeReady || record.worktreeMaterializationIntent === true
      ? record
      : bump(record, { worktreeMaterializationIntent: true })
  if (intended !== record) yield* boundary(store.write(intended))
  const locate = (
    records: ReadonlyArray<{
      readonly worktree: string
      readonly head: string
      readonly branch?: string
      readonly detached: boolean
      readonly prunable: boolean
    }>
  ) => records.find((item) => item.worktree === candidatePath)
  let records = yield* readWorktrees(commands, config)
  let exact = locate(records)
  if (exact !== undefined) {
    const exists = yield* boundary(fileSystem.exists(candidatePath))
    if (
      exact.head !== record.correlation.expectedTargetHead ||
      exact.branch !== undefined ||
      !exact.detached ||
      exact.prunable ||
      !exists
    ) {
      return yield* Effect.fail(providerFailure("candidate worktree registration is foreign or at the wrong head"))
    }
    if (intended.worktreeReady && intended.worktreeMaterializationIntent !== true) return intended
    const ready = bump(intended, { worktreeMaterializationIntent: false, worktreeReady: true })
    yield* boundary(store.write(ready))
    return ready
  }
  const exists = yield* boundary(fileSystem.exists(candidatePath))
  if (record.worktreeReady && record.worktreeMaterializationIntent !== true) {
    return yield* Effect.fail(providerFailure("ready candidate worktree registration disappeared"))
  }
  if (exists) return yield* Effect.fail(providerFailure("candidate path exists without the exact Git registration"))
  const created = yield* ownership.runMutation(
    boundary(
      commands.run(config.commonDirectory, [
        "worktree",
        "add",
        "--detach",
        "--",
        candidatePath,
        record.correlation.expectedTargetHead
      ])
    )
  )
  records = yield* readWorktrees(commands, config)
  exact = locate(records)
  if (exact === undefined) {
    return yield* Effect.fail(
      providerFailure(
        created.exitCode === 0
          ? "Git acknowledged candidate worktree creation but reread found no registration"
          : created.stderr.trim() || "candidate worktree creation failed"
      )
    )
  }
  if (exact.head !== record.correlation.expectedTargetHead || exact.branch !== undefined || !exact.detached) {
    return yield* Effect.fail(providerFailure("candidate worktree creation produced a foreign registration"))
  }
  const createdPathExists = yield* boundary(fileSystem.exists(candidatePath))
  if (exact.prunable || !createdPathExists) {
    return yield* Effect.fail(providerFailure("candidate worktree registration is prunable or missing on disk"))
  }
  const next = bump(intended, { worktreeMaterializationIntent: false, worktreeReady: true })
  yield* boundary(store.write(next))
  return next
})

const ensureThread = Effect.fn("CodexIntegrator.ensureThread")(function* (
  app: CodexAppServer["Service"],
  record: CodexIntegratorPrivateRecord,
  store: CodexIntegratorPrivateStoreService
) {
  if (record.threadId !== null) {
    const thread = yield* observedThread(app, record.threadId, record.candidatePath)
    return { record, thread }
  }
  if (app.listThreads !== undefined) {
    const listed = yield* boundary(app.listThreads())
    const matches = listed.filter((thread) => thread.cwd === record.candidatePath)
    if (matches.length > 1)
      return yield* Effect.fail(providerFailure("persistent thread list has duplicate candidate cwd"))
    const matching = matches[0]
    if (matching !== undefined) {
      if (!record.threadStartIntent) {
        return yield* Effect.fail(providerFailure("persistent candidate thread is unowned"))
      }
      const thread = yield* observedThread(app, matching.id, record.candidatePath)
      const attached = bump(record, {
        appServerIncarnation: app.incarnation,
        threadId: thread.id,
        threadStartIntent: false
      })
      yield* boundary(store.write(attached))
      return { record: attached, thread }
    }
  } else if (record.threadStartIntent) {
    return yield* Effect.fail(
      providerFailure("thread/start response is unresolved and persistent thread read is unavailable")
    )
  }
  const intent =
    record.threadStartIntent && record.appServerIncarnation === app.incarnation
      ? record
      : bump(record, { threadStartIntent: true, appServerIncarnation: app.incarnation })
  if (intent !== record) yield* boundary(store.write(intent))
  const started = yield* boundary(app.startThread(record.candidatePath))
  if (started.cwd !== record.candidatePath || started.correlation !== undefined) {
    return yield* Effect.fail(providerFailure("thread/start returned a foreign candidate cwd"))
  }
  const next = bump(intent, { threadId: started.id, threadStartIntent: false })
  yield* boundary(store.write(next))
  return { record: next, thread: started }
})

const runFor = (
  record: CodexIntegratorPrivateRecord,
  run: IntegratorRunCorrelation
): CodexIntegratorPrivateRun | undefined => record.runs.find((item) => runCorrelationEquals(item.correlation, run))

const newToken = (): CodexOwnedTurnToken => CodexOwnedTurnToken.make(`dalph-integrator-${randomUUID()}`)

const ensureRun = Effect.fn("CodexIntegrator.ensureRun")(function* (
  store: CodexIntegratorPrivateStoreService,
  record: CodexIntegratorPrivateRecord,
  run: IntegratorRunCorrelation,
  app: CodexAppServer["Service"]
) {
  const existing = runFor(record, run)
  if (existing !== undefined) return { record, run: existing }
  const ordinalCollision = record.runs.find((item) => item.correlation.ordinal === run.ordinal)
  if (ordinalCollision !== undefined)
    return yield* Effect.fail(providerFailure("private run ordinal is bound to another session"))
  if (run.ordinal === maximumProviderRunOrdinal) {
    const first = record.runs.find((item) => item.correlation.ordinal === firstProviderRunOrdinal)
    if (first === undefined || first.result === null)
      return yield* Effect.fail(providerFailure("Retry run two has no sealed run-one result"))
  }
  if (Number(run.ordinal) > maximumProviderRunOrdinal)
    return yield* Effect.fail(providerFailure("provider run ordinal exceeds Retry"))
  const created = CodexIntegratorPrivateRun.make({
    correlation: run,
    phase: "IntentRecorded",
    result: null,
    token: newToken(),
    turnId: null
  })
  const next = bump(record, { appServerIncarnation: app.incarnation, runs: [...record.runs, created] })
  yield* boundary(store.write(next))
  return { record: next, run: created }
})

const executeRun = Effect.fn("CodexIntegrator.executeRun")(function* (
  app: CodexAppServer["Service"],
  census: CodexOwnedActivityCensus["Service"],
  store: CodexIntegratorPrivateStoreService,
  record: CodexIntegratorPrivateRecord,
  run: CodexIntegratorPrivateRun,
  thread: CodexThreadSnapshot
) {
  if (run.result !== null) {
    if (!runCorrelationEquals(run.result.correlation, run.correlation))
      return yield* Effect.fail(providerFailure("private result has a foreign run correlation"))
    return run.result
  }
  let currentRecord = record
  let currentRun = run
  let turn: CodexTurnSnapshot
  const matchingTurns = thread.turns.filter((item) => item.ownedTurnToken === currentRun.token)
  if (matchingTurns.length > 1) return yield* Effect.fail(providerFailure("owned turn token is duplicated"))
  if (matchingTurns.length === 1) {
    const matchingTurn = matchingTurns[0]
    if (matchingTurn === undefined) return yield* Effect.fail(providerFailure("owned turn token lookup was incomplete"))
    turn = matchingTurn
  } else {
    if (currentRun.phase !== "IntentRecorded" && currentRun.phase !== "TurnBoundaryCrossing") {
      return yield* Effect.fail(providerFailure("owned turn token is not readable after a sealed turn"))
    }
    // A missing token after the request boundary is retryable only after a
    // fresh complete census proves that no unknown turn or descendant can
    // still write the candidate worktree.
    yield* observeQuiescence(app, census, thread)
    if (currentRun.phase === "IntentRecorded") {
      const intent = updateRun(currentRecord, currentRun, { phase: "TurnBoundaryCrossing" })
      currentRecord = intent
      const intentRun = runFor(intent, currentRun.correlation)
      if (intentRun === undefined) return yield* Effect.fail(providerFailure("private turn intent disappeared"))
      currentRun = intentRun
      yield* boundary(store.write(intent))
    }
    const started = yield* boundary(
      app.startTurn(
        thread.id,
        currentRecord.candidatePath,
        promptFor(currentRun.correlation, currentRecord.candidatePath),
        currentRun.token
      )
    )
    if (started.ownedTurnToken !== undefined && started.ownedTurnToken !== currentRun.token)
      return yield* Effect.fail(providerFailure("turn/start returned a foreign token"))
    turn = started
    const observed = updateRun(currentRecord, currentRun, { phase: "TurnObserved", turnId: turn.id })
    currentRecord = observed
    const observedRun = runFor(observed, currentRun.correlation)
    if (observedRun === undefined) return yield* Effect.fail(providerFailure("private turn observation disappeared"))
    currentRun = observedRun
    yield* boundary(store.write(observed))
  }
  if (turn.ownedTurnToken !== undefined && turn.ownedTurnToken !== currentRun.token)
    return yield* Effect.fail(providerFailure("turn carries a foreign token"))
  if (!isTerminalTurn(turn)) return yield* Effect.fail(providerFailure("exact provider turn remains active"))
  yield* observeQuiescence(app, census, thread)
  const result = yield* exactEnvelope(turn, currentRun.correlation)
  const sealed = updateRun(currentRecord, currentRun, { phase: "Sealed", result, turnId: turn.id })
  yield* boundary(store.write(sealed))
  return result
})

const checkConfigAndRecord = Effect.fn("CodexIntegrator.checkConfigAndRecord")(function* (
  config: CodexIntegratorConfiguration,
  store: CodexIntegratorPrivateStoreService,
  run: IntegratorRunCorrelation,
  app: CodexAppServer["Service"]
) {
  const invalidConfig = configError(config)
  if (invalidConfig !== undefined) return yield* Effect.fail(providerFailure(invalidConfig))
  if (run.session.integrationTarget.repository !== config.repository)
    return yield* Effect.fail(providerFailure("request repository is not the configured canonical repository"))
  const candidatePath = candidateWorktreePathFor(config, run.session.candidateResource)
  const found = yield* boundary(store.read(run.session.sessionId))
  if (Option.isSome(found)) {
    if (!sameSession(found.value.correlation, run.session) || found.value.candidatePath !== candidatePath) {
      return yield* Effect.fail(providerFailure("private record belongs to another session or candidate path"))
    }
    if (found.value.removed === true)
      return yield* Effect.fail(providerFailure("private candidate record is tombstoned"))
    const current =
      found.value.appServerIncarnation === app.incarnation
        ? found.value
        : bump(found.value, { appServerIncarnation: app.incarnation })
    if (current !== found.value) yield* boundary(store.write(current))
    return current
  }
  const occupied = yield* boundary(store.findByCandidatePath(candidatePath))
  if (Option.isSome(occupied)) {
    return yield* Effect.fail(providerFailure("candidate path is already owned by another integration session"))
  }
  const created = CodexIntegratorPrivateRecord.make({
    appServerIncarnation: app.incarnation,
    candidatePath,
    correlation: run.session,
    revision: revision(1),
    removed: false,
    removalIntent: false,
    runs: [],
    threadId: null,
    threadStartIntent: false,
    worktreeMaterializationIntent: false,
    worktreeReady: false
  })
  yield* boundary(store.write(created))
  return created
})

const integratorServiceFor = (
  config: CodexIntegratorConfiguration,
  app: CodexAppServer["Service"],
  census: CodexOwnedActivityCensus["Service"],
  commands: GitCommandService,
  fileSystem: FileSystem.FileSystem,
  store: CodexIntegratorPrivateStoreService,
  gate: Semaphore.Semaphore,
  ownership: CoordinatorOwnership["Service"]
) =>
  Integrator.of({
    prepare: (request: IntegratorRequest) =>
      gate
        .withPermits(1)(
          Effect.gen(function* () {
            const run = request.correlation
            const initial = yield* checkConfigAndRecord(config, store, run, app)
            // The exact run token is durable before any candidate or thread boundary.
            const ensured = yield* ensureRun(store, initial, run, app)
            const materialized = yield* ensureCandidateWorktree(
              commands,
              fileSystem,
              config,
              ensured.record,
              store,
              ownership
            )
            const threaded = yield* ensureThread(app, materialized, store)
            return yield* executeRun(app, census, store, threaded.record, ensured.run, threaded.thread)
          })
        )
        .pipe(
          Effect.mapError(
            (error) => new IntegratorCallFailure({ correlation: request.correlation, detail: errorDetail(error) })
          )
        )
  })

const cleanupObservationFor = Effect.fn("CodexIntegrator.cleanupObservationFor")(function* (
  config: CodexIntegratorConfiguration,
  authorization: IntegratorCandidateCleanupAuthorization,
  app: CodexAppServer["Service"],
  census: CodexOwnedActivityCensus["Service"],
  commands: GitCommandService,
  fileSystem: FileSystem.FileSystem,
  store: CodexIntegratorPrivateStoreService
) {
  const predecessor = authorization.disposition.predecessor
  const candidatePath = candidateWorktreePathFor(config, predecessor.candidateResource)
  if (candidatePath === "" || authorization.locator !== predecessor.candidateResource) {
    return IntegratorCandidateCleanupObservation.cases.Foreign.make({
      locator: authorization.locator,
      observedSessionId: predecessor.sessionId,
      reason: "Transferred",
      revision: authorization.evidenceRevision
    })
  }
  const found = yield* boundary(store.read(predecessor.sessionId))
  if (Option.isNone(found)) {
    const occupied = yield* boundary(store.findByCandidatePath(candidatePath))
    if (Option.isSome(occupied)) {
      return IntegratorCandidateCleanupObservation.cases.Foreign.make({
        locator: authorization.locator,
        observedSessionId: occupied.value.correlation.sessionId,
        reason: "OtherSession",
        revision: authorization.evidenceRevision
      })
    }
    return IntegratorCandidateCleanupObservation.cases.Unreadable.make({
      detail: "private predecessor record is absent; absence cannot be inferred",
      locator: authorization.locator
    })
  }
  const record = found.value
  if (!sameSession(record.correlation, predecessor) || record.candidatePath !== candidatePath) {
    return IntegratorCandidateCleanupObservation.cases.Foreign.make({
      locator: authorization.locator,
      observedSessionId: record.correlation.sessionId,
      reason: "OtherSession",
      revision: authorization.evidenceRevision
    })
  }
  const records = yield* readWorktrees(commands, config)
  const registration = records.find((item) => item.worktree === candidatePath)
  const pathExists = yield* boundary(fileSystem.exists(candidatePath))
  if (registration === undefined) {
    if (!pathExists && record.removed === true) {
      return IntegratorCandidateCleanupObservation.cases.Absent.make({
        locator: authorization.locator,
        revision: authorization.evidenceRevision
      })
    }
    if (!pathExists && record.removalIntent === true) {
      yield* boundary(store.write(bump(record, { removalIntent: false, removed: true })))
      return IntegratorCandidateCleanupObservation.cases.Absent.make({
        locator: authorization.locator,
        revision: authorization.evidenceRevision
      })
    }
    if (!pathExists && record.threadId === null) {
      return IntegratorCandidateCleanupObservation.cases.Absent.make({
        locator: authorization.locator,
        revision: authorization.evidenceRevision
      })
    }
    return IntegratorCandidateCleanupObservation.cases.Foreign.make({
      locator: authorization.locator,
      observedSessionId: predecessor.sessionId,
      reason: "Transferred",
      revision: authorization.evidenceRevision
    })
  }
  if (record.removed === true || record.removalIntent === true) {
    return IntegratorCandidateCleanupObservation.cases.Foreign.make({
      locator: authorization.locator,
      observedSessionId: predecessor.sessionId,
      reason: "Transferred",
      revision: authorization.evidenceRevision
    })
  }
  if (
    registration.head !== predecessor.expectedTargetHead ||
    registration.branch !== undefined ||
    !registration.detached ||
    registration.prunable
  ) {
    return IntegratorCandidateCleanupObservation.cases.Foreign.make({
      locator: authorization.locator,
      observedSessionId: predecessor.sessionId,
      reason: "Transferred",
      revision: authorization.evidenceRevision
    })
  }
  if (!pathExists) {
    return IntegratorCandidateCleanupObservation.cases.Unreadable.make({
      detail: "candidate is registered by Git but its filesystem path is absent",
      locator: authorization.locator
    })
  }
  if (record.threadId === null)
    return IntegratorCandidateCleanupObservation.cases.Unreadable.make({
      detail: "candidate has no durable provider thread",
      locator: authorization.locator
    })
  const thread = yield* observedThread(app, record.threadId, candidatePath)
  const terminals = yield* boundary(app.listBackgroundTerminals(thread.id))
  const projection = yield* boundary(census.observe(thread, terminals))
  if (projection._tag === "ExactLive")
    return IntegratorCandidateCleanupObservation.cases.Foreign.make({
      locator: authorization.locator,
      observedSessionId: predecessor.sessionId,
      reason: "LiveWriter",
      revision: authorization.evidenceRevision
    })
  if (projection._tag === "Unreadable" || projection._tag === "Contradictory") {
    return IntegratorCandidateCleanupObservation.cases.Unreadable.make({
      detail: projection.detail,
      locator: authorization.locator
    })
  }
  return IntegratorCandidateCleanupObservation.cases.Present.make({
    locator: authorization.locator,
    revision: authorization.evidenceRevision,
    sessionId: predecessor.sessionId,
    writerQuiescent: true
  })
})

const providerAuthorityFor = (
  config: CodexIntegratorConfiguration,
  app: CodexAppServer["Service"],
  census: CodexOwnedActivityCensus["Service"],
  commands: GitCommandService,
  fileSystem: FileSystem.FileSystem,
  store: CodexIntegratorPrivateStoreService,
  ownership: CoordinatorOwnership["Service"]
) => {
  const observe = (authorization: IntegratorCandidateCleanupAuthorization) =>
    cleanupObservationFor(config, authorization, app, census, commands, fileSystem, store).pipe(
      Effect.catch((error) =>
        Effect.succeed(
          IntegratorCandidateCleanupObservation.cases.Unreadable.make({
            detail: errorDetail(error),
            locator: authorization.locator
          })
        )
      )
    )
  const remove = (
    authorization: IntegratorCandidateCleanupAuthorization,
    _attempt: Parameters<IntegratorCandidateProviderAuthority["Service"]["remove"]>[1]
  ) =>
    Effect.gen(function* () {
      const initial = yield* observe(authorization)
      if (initial._tag === "Absent")
        return IntegratorCandidateCleanupMutationResult.cases.AlreadyAbsent.make({
          locator: authorization.locator,
          revision: authorization.evidenceRevision,
          sessionId: authorization.owner.sessionId
        })
      if (initial._tag !== "Present")
        return IntegratorCandidateCleanupMutationResult.cases.DefinitelyNotApplied.make({
          detail: "fresh provider ownership observation did not permit removal",
          locator: authorization.locator,
          sessionId: authorization.owner.sessionId
        })
      const found = yield* boundary(store.read(authorization.owner.sessionId))
      if (Option.isNone(found)) {
        return IntegratorCandidateCleanupMutationResult.cases.Unknown.make({
          detail: "private predecessor record disappeared before removal intent",
          locator: authorization.locator,
          sessionId: authorization.owner.sessionId
        })
      }
      yield* boundary(store.write(bump(found.value, { removalIntent: true, removed: false })))
      const mutation = boundary(
        commands.run(config.commonDirectory, [
          "worktree",
          "remove",
          "--force",
          "--",
          candidateWorktreePathFor(config, authorization.locator)
        ])
      )
      const result = yield* ownership.runMutation(mutation)
      if (result.exitCode !== 0) {
        const reconciled = yield* observe(authorization)
        if (reconciled._tag === "Absent")
          return IntegratorCandidateCleanupMutationResult.cases.AlreadyAbsent.make({
            locator: authorization.locator,
            revision: authorization.evidenceRevision,
            sessionId: authorization.owner.sessionId
          })
        return IntegratorCandidateCleanupMutationResult.cases.Unknown.make({
          detail: result.stderr.trim() || `git exited ${result.exitCode}`,
          locator: authorization.locator,
          sessionId: authorization.owner.sessionId
        })
      }
      const settled = yield* observe(authorization)
      if (settled._tag === "Absent") {
        const foundAfter = yield* boundary(store.read(authorization.owner.sessionId))
        if (Option.isSome(foundAfter)) {
          yield* boundary(store.write(bump(foundAfter.value, { removalIntent: false, removed: true })))
        }
        return IntegratorCandidateCleanupMutationResult.cases.Removed.make({
          locator: authorization.locator,
          revision: authorization.evidenceRevision,
          sessionId: authorization.owner.sessionId
        })
      }
      return IntegratorCandidateCleanupMutationResult.cases.Unknown.make({
        detail: "Git remove returned but exact candidate remains registered",
        locator: authorization.locator,
        sessionId: authorization.owner.sessionId
      })
    }).pipe(
      Effect.catch((error) =>
        Effect.succeed(
          IntegratorCandidateCleanupMutationResult.cases.Unknown.make({
            detail: errorDetail(error),
            locator: authorization.locator,
            sessionId: authorization.owner.sessionId
          })
        )
      )
    )
  return IntegratorCandidateProviderAuthority.of({ observe, remove })
}

/** Controlled/production provider layer; #259 supplies the shared app server and coordinator ownership. */
export const codexIntegratorLayer = (
  config: CodexIntegratorConfiguration
): Layer.Layer<
  Integrator | IntegratorCandidateProviderAuthority,
  never,
  | CodexAppServer
  | CodexOwnedActivityCensus
  | GitCommand
  | FileSystem.FileSystem
  | CodexIntegratorPrivateStore
  | CoordinatorOwnership
> =>
  Layer.effectContext(
    Effect.gen(function* () {
      const app = yield* CodexAppServer
      const census = yield* CodexOwnedActivityCensus
      const commands = yield* GitCommand
      const fileSystem = yield* FileSystem.FileSystem
      const store = yield* CodexIntegratorPrivateStore
      const ownership = yield* CoordinatorOwnership
      const gate = yield* Semaphore.make(1)
      return Context.empty().pipe(
        Context.add(
          Integrator,
          integratorServiceFor(config, app, census, commands, fileSystem, store, gate, ownership)
        ),
        Context.add(
          IntegratorCandidateProviderAuthority,
          providerAuthorityFor(config, app, census, commands, fileSystem, store, ownership)
        )
      )
    })
  )

/** Node-backed provider composition with private durable storage. */
export const nodeCodexIntegratorLayer = (
  config: CodexIntegratorConfiguration
): Layer.Layer<
  Integrator | IntegratorCandidateProviderAuthority,
  never,
  CodexAppServer | CodexOwnedActivityCensus | GitCommand | FileSystem.FileSystem | CoordinatorOwnership
> => codexIntegratorLayer(config).pipe(Layer.provide(nodeCodexIntegratorPrivateStoreLayer(config)))

// Compatibility aliases make the seam discoverable without exposing provider-private records as workflow API.
export const codexIntegratorProviderLayer = codexIntegratorLayer
export const nodeCodexIntegratorProviderLayer = nodeCodexIntegratorLayer
