import { Effect, Result, Schema } from "effect"
import type { FileSystem } from "effect"
import { GitCommitSha, TaskBranchRef, WorktreeLocator } from "@dalph/contracts"
import {
  CodexIntegratorPrivateRecord,
  nextPrivateRecordFields,
  type CodexIntegratorConfiguration,
  type CodexIntegratorPrivateStoreService,
  type IntegratorCandidateWorktreePath
} from "./codex-integrator-private-store.js"
import { boundary, errorDetail, providerFailure } from "./codex-integrator-runtime.js"
import type { CodexIntegratorProviderFailure } from "./codex-integrator-runtime.js"
import { type GitCommandService } from "@dalph/orchestrator"

/** Minimal guarded-mutation shape keeps the internal worktree helper portable in declarations. */
interface CoordinatorMutationGuard {
  readonly runMutation: <A, E, R>(mutation: Effect.Effect<A, E, R>) => Effect.Effect<A, unknown, R>
}

export type GitWorktreeRecord = {
  readonly worktree: WorktreeLocator
  readonly head: GitCommitSha
  readonly branch?: TaskBranchRef
  readonly detached: boolean
  readonly prunable: boolean
}

const GitWorktreePorcelainRecord = Schema.Struct({
  branch: Schema.optionalKey(TaskBranchRef),
  detached: Schema.Boolean,
  head: GitCommitSha,
  prunable: Schema.Boolean,
  worktree: WorktreeLocator
}).check(
  Schema.makeFilter((record) =>
    record.branch !== undefined || record.detached
      ? undefined
      : "worktree registration must name a branch or be detached"
  )
)

/** Git's `--porcelain -z` leaves path text unquoted and terminates every field and record with NUL. */
const gitPorcelainFieldTerminator = "\0"
const gitPorcelainRecordTerminator = `${gitPorcelainFieldTerminator}${gitPorcelainFieldTerminator}`

const gitPorcelainFieldEntry = (field: {
  readonly name: string
  readonly value: string
}): readonly [string, string] => [field.name, field.value]

const parseWorktreeFields = (block: string): Map<string, string> | undefined => {
  const fields = block.split(gitPorcelainFieldTerminator).map((field) => {
    const separator = field.indexOf(" ")
    return {
      name: separator < 0 ? field : field.slice(0, separator),
      value: separator < 0 ? "" : field.slice(separator + 1)
    }
  })
  const names = fields.map(({ name }) => name)
  if (
    names.some((name) => !["worktree", "HEAD", "branch", "bare", "detached", "locked", "prunable"].includes(name)) ||
    new Set(names).size !== names.length
  )
    return undefined
  return new Map(fields.map(gitPorcelainFieldEntry))
}

const worktreeRecordFromFields = (values: ReadonlyMap<string, string>): GitWorktreeRecord | undefined => {
  const branchValue = values.get("branch")
  const decoded = Schema.decodeUnknownResult(GitWorktreePorcelainRecord)({
    ...(branchValue === undefined ? {} : { branch: branchValue }),
    detached: values.has("detached"),
    head: values.get("HEAD"),
    prunable: values.has("prunable"),
    worktree: values.get("worktree")
  })
  return Result.isSuccess(decoded) ? decoded.success : undefined
}

const parseWorktreeBlock = (block: string): GitWorktreeRecord | undefined => {
  const fields = parseWorktreeFields(block)
  return fields === undefined ? undefined : worktreeRecordFromFields(fields)
}

const hasAmbiguousWorktreeRegistration = (records: ReadonlyArray<GitWorktreeRecord>): boolean =>
  records.some(
    (record, index) =>
      records.findIndex((candidate) => candidate.worktree === record.worktree) !== index ||
      (record.branch !== undefined && records.findIndex((candidate) => candidate.branch === record.branch) !== index)
  )

const parseWorktreeList = (
  stdout: string
):
  | { readonly _tag: "Valid"; readonly records: ReadonlyArray<GitWorktreeRecord> }
  | { readonly _tag: "Malformed"; readonly detail: string } => {
  if (stdout.length === 0) return { _tag: "Valid", records: [] }
  if (!stdout.endsWith(gitPorcelainRecordTerminator)) {
    return { _tag: "Malformed", detail: "git worktree list contained an unterminated porcelain record" }
  }
  const blocks = stdout.slice(0, -gitPorcelainRecordTerminator.length).split(gitPorcelainRecordTerminator)
  const records = blocks.map(parseWorktreeBlock)
  if (records.some((record) => record === undefined)) {
    return { _tag: "Malformed", detail: "git worktree list contained a malformed porcelain block" }
  }
  const validRecords = records.filter((record): record is NonNullable<typeof record> => record !== undefined)
  if (hasAmbiguousWorktreeRegistration(validRecords)) {
    return { _tag: "Malformed", detail: "git worktree list contained an ambiguous duplicate registration" }
  }
  return { _tag: "Valid", records: validRecords }
}

export const readWorktrees = (
  commands: GitCommandService,
  config: CodexIntegratorConfiguration
): Effect.Effect<ReadonlyArray<GitWorktreeRecord>, CodexIntegratorProviderFailure> =>
  boundary(commands.run(config.commonDirectory, ["worktree", "list", "--porcelain", "-z"])).pipe(
    Effect.flatMap((result) => {
      if (result.exitCode !== 0)
        return Effect.fail(providerFailure(`git worktree list failed: ${result.stderr.trim()}`))
      const parsed = parseWorktreeList(result.stdout)
      return parsed._tag === "Valid" ? Effect.succeed(parsed.records) : Effect.fail(providerFailure(parsed.detail))
    })
  )

const reconcileExistingCandidateWorktree = Effect.fn("CodexIntegrator.reconcileExistingCandidateWorktree")(function* (
  exact: GitWorktreeRecord,
  intended: CodexIntegratorPrivateRecord,
  record: CodexIntegratorPrivateRecord,
  candidatePath: IntegratorCandidateWorktreePath,
  fileSystem: FileSystem.FileSystem,
  store: CodexIntegratorPrivateStoreService
) {
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
  if (intended._tag !== "CandidateUnmaterialized" && intended._tag !== "WorktreeMaterializationIntentRecorded") {
    return intended
  }
  const ready = CodexIntegratorPrivateRecord.cases.CandidateReady.make(nextPrivateRecordFields(intended))
  yield* boundary(store.write(ready))
  return ready
})

const createdWorktreeValidation = (
  result: { readonly exitCode: number; readonly stderr: string },
  exact: GitWorktreeRecord | undefined,
  expectedHead: GitCommitSha
):
  | { readonly _tag: "Valid"; readonly exact: GitWorktreeRecord }
  | { readonly _tag: "Invalid"; readonly detail: string } => {
  if (exact === undefined) {
    return {
      _tag: "Invalid",
      detail:
        result.exitCode === 0
          ? "Git acknowledged candidate worktree creation but reread found no registration"
          : result.stderr.trim() || "candidate worktree creation failed"
    }
  }
  return exact.head !== expectedHead || exact.branch !== undefined || !exact.detached
    ? { _tag: "Invalid", detail: "candidate worktree creation produced a foreign registration" }
    : { _tag: "Valid", exact }
}

const materializeCandidateWorktree = Effect.fn("CodexIntegrator.materializeCandidateWorktree")(function* (
  commands: GitCommandService,
  fileSystem: FileSystem.FileSystem,
  config: CodexIntegratorConfiguration,
  record: CodexIntegratorPrivateRecord,
  intended: CodexIntegratorPrivateRecord,
  candidatePath: IntegratorCandidateWorktreePath,
  store: CodexIntegratorPrivateStoreService,
  ownership: CoordinatorMutationGuard
) {
  const exists = yield* boundary(fileSystem.exists(candidatePath))
  if (record._tag !== "CandidateUnmaterialized" && record._tag !== "WorktreeMaterializationIntentRecorded") {
    return yield* Effect.fail(providerFailure("ready candidate worktree registration disappeared"))
  }
  if (exists) return yield* Effect.fail(providerFailure("candidate path exists without the exact Git registration"))
  const created = yield* ownership
    .runMutation(
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
    .pipe(Effect.mapError((error) => providerFailure(errorDetail(error))))
  const records = yield* readWorktrees(commands, config)
  const exact = records.find((item) => item.worktree === WorktreeLocator.make(candidatePath))
  const validation = createdWorktreeValidation(created, exact, record.correlation.expectedTargetHead)
  if (validation._tag === "Invalid") return yield* Effect.fail(providerFailure(validation.detail))
  const createdPathExists = yield* boundary(fileSystem.exists(candidatePath))
  if (validation.exact.prunable || !createdPathExists) {
    return yield* Effect.fail(providerFailure("candidate worktree registration is prunable or missing on disk"))
  }
  const next = CodexIntegratorPrivateRecord.cases.CandidateReady.make(nextPrivateRecordFields(intended))
  yield* boundary(store.write(next))
  return next
})

export const ensureCandidateWorktree = Effect.fn("CodexIntegrator.ensureCandidateWorktree")(function* (
  commands: GitCommandService,
  fileSystem: FileSystem.FileSystem,
  config: CodexIntegratorConfiguration,
  record: CodexIntegratorPrivateRecord,
  store: CodexIntegratorPrivateStoreService,
  ownership: CoordinatorMutationGuard
) {
  const candidatePath = record.candidatePath
  const intended =
    record._tag !== "CandidateUnmaterialized"
      ? record
      : CodexIntegratorPrivateRecord.cases.WorktreeMaterializationIntentRecorded.make(nextPrivateRecordFields(record))
  if (intended !== record) yield* boundary(store.write(intended))
  const records = yield* readWorktrees(commands, config)
  const exact = records.find((item) => item.worktree === WorktreeLocator.make(candidatePath))
  if (exact !== undefined) {
    return yield* reconcileExistingCandidateWorktree(exact, intended, record, candidatePath, fileSystem, store)
  }
  return yield* materializeCandidateWorktree(
    commands,
    fileSystem,
    config,
    record,
    intended,
    candidatePath,
    store,
    ownership
  )
})
