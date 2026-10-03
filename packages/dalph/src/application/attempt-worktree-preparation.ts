/* eslint-disable import/no-nodejs-modules -- This adapter owns task-local process and durable file boundaries. */
/* eslint-disable dalph/no-throw-statement -- Native Promise operations throw into Effect.tryPromise, which maps them to typed custody failures. */
import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { constants } from "node:fs"
import { lstat, mkdir, open, readFile, realpath, rename, stat, unlink } from "node:fs/promises"
import { join } from "node:path"
import nodeProcess from "node:process"
import {
  PlannedAttemptExecutor,
  PlannedAttemptExecutorBeginProofId,
  PlannedAttemptExecutorCommandFailure,
  PlannedAttemptExecutorProjection,
  PlannedTaskAttempt,
  WorktreeLocator,
  plannedAttemptExecutorCorrelation,
  plannedAttemptExecutorCorrelationKey,
  samePlannedTaskAttempt,
  type PlannedAttemptExecutorCorrelation,
  type PlannedAttemptExecutorService
} from "@dalph/contracts"
import { Clock, Crypto, Effect, Exit, Ref, Schema } from "effect"

// eslint-disable-next-line no-magic-numbers -- One bounded preparation has a six-minute wall-clock budget.
const preparationTimeoutMilliseconds = 6 * 60 * 1_000
// eslint-disable-next-line no-magic-numbers -- Keep one final structured receipt below the child output cap.
const preparationOutputLimitBytes = 64 * 1_024
const preparationFileMode = 0o600
const preparationDirectoryMode = 0o700
const maximumReplacementTemporaryCandidates = 16

const PreparationStage = Schema.Literals([
  "git",
  "manifest",
  "node",
  "install",
  "unknown",
  "custody",
  "uncertain",
  "protocol"
])
type PreparationStage = typeof PreparationStage.Type
const PreparationToken = Schema.NonEmptyString.pipe(Schema.brand("PreparationToken"))
const PreparationCommandDigest = Schema.NonEmptyString.pipe(Schema.brand("PreparationCommandDigest"))
type PreparationCommandDigest = typeof PreparationCommandDigest.Type

const PreparationRecord = Schema.TaggedUnion({
  Intended: {
    attempt: PlannedTaskAttempt,
    commandDigest: PreparationCommandDigest,
    receiptToken: PreparationToken,
    startedAt: Schema.String,
    deadlineAt: Schema.String
  },
  Prepared: {
    attempt: PlannedTaskAttempt,
    commandDigest: PreparationCommandDigest,
    node: Schema.String,
    worktree: WorktreeLocator,
    worktreeDevice: Schema.Int,
    worktreeInode: Schema.Int
  },
  Failed: {
    attempt: PlannedTaskAttempt,
    commandDigest: PreparationCommandDigest,
    detail: Schema.String,
    stage: PreparationStage
  }
})
type PreparationRecord = typeof PreparationRecord.Type

const PreparationReceipt = Schema.TaggedUnion({
  AttemptWorktreePrepared: { node: Schema.String, token: PreparationToken, worktree: WorktreeLocator },
  AttemptWorktreePreparationFailed: { detail: Schema.String, stage: PreparationStage, token: PreparationToken }
})

export class AttemptWorktreePreparationFailure extends Schema.TaggedError<AttemptWorktreePreparationFailure>()(
  "AttemptWorktreePreparationFailure",
  { attempt: PlannedTaskAttempt, detail: Schema.String, stage: PreparationStage }
) {}

export interface AttemptWorktreePreparationService {
  readonly prepare: (attempt: PlannedTaskAttempt) => Effect.Effect<void, AttemptWorktreePreparationFailure>
  readonly inspect: (correlation: PlannedAttemptExecutorCorrelation) => Effect.Effect<"Absent" | "Ready" | "Blocked">
}

export interface AttemptWorktreePreparationCommand {
  readonly executable: string
  readonly args: ReadonlyArray<string>
}

const failure = (attempt: PlannedTaskAttempt, stage: PreparationStage, detail: string) =>
  new AttemptWorktreePreparationFailure({ attempt, detail, stage })

const ioFailure = (attempt: PlannedTaskAttempt, error: unknown) => failure(attempt, "custody", String(error))

const commandDigest = (command: AttemptWorktreePreparationCommand): PreparationCommandDigest =>
  PreparationCommandDigest.make(
    createHash("sha256")
      .update(JSON.stringify([command.executable, ...command.args]))
      .digest("hex")
  )

const recordPath = (directory: string, attempt: Pick<PlannedTaskAttempt, "runId" | "attemptId">): string => {
  const key = createHash("sha256")
    .update(JSON.stringify([attempt.runId, attempt.attemptId]))
    .digest("hex")
  return join(directory, `${key}.json`)
}

const syncDirectory = async (directory: string) => {
  const handle = await open(directory, constants.O_RDONLY)
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

const writeNewRecord = async (path: string, directory: string, record: PreparationRecord) => {
  const handle = await open(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    preparationFileMode
  )
  try {
    await handle.writeFile(`${JSON.stringify(record)}\n`)
    await handle.sync()
  } finally {
    await handle.close()
  }
  await syncDirectory(directory)
}

const replaceRecord = async (path: string, directory: string, record: PreparationRecord) => {
  for (let candidate = 0; candidate < maximumReplacementTemporaryCandidates; candidate += 1) {
    const temporary = `${path}.${candidate}.next`
    try {
      await writeNewRecord(temporary, directory, record)
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST") continue
      throw error
    }
    try {
      await rename(temporary, path)
      await syncDirectory(directory)
      return
    } finally {
      await unlink(temporary).catch(() => undefined)
    }
  }
  throw new Error("preparation record has too many retained incomplete replacement files")
}

const readRecord = async (path: string): Promise<PreparationRecord | undefined> => {
  let raw: string
  try {
    raw = await readFile(path, "utf8")
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return undefined
    throw error
  }
  return Schema.decodeUnknownSync(PreparationRecord)(JSON.parse(raw))
}

const preparationEnvironment = (): NodeJS.ProcessEnv => {
  const allowed = [
    "PATH",
    "HOME",
    "USER",
    "TMPDIR",
    "MISE_DATA_DIR",
    "MISE_CONFIG_DIR",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "PNPM_HOME",
    "CI"
  ]
  return Object.fromEntries(
    allowed.flatMap((key) => (nodeProcess.env[key] === undefined ? [] : [[key, nodeProcess.env[key]]]))
  )
}

type CommandResult =
  | { readonly _tag: "Exited"; readonly exitCode: number }
  | { readonly _tag: "Uncertain"; readonly detail: string }

const runCommand = (
  command: AttemptWorktreePreparationCommand,
  cwd: string,
  signal: AbortSignal,
  receiptPath: string,
  receiptToken: string,
  environment: NodeJS.ProcessEnv
): Promise<CommandResult> =>
  new Promise((resolve) => {
    execFile(
      command.executable,
      [...command.args],
      {
        cwd,
        env: {
          ...environment,
          DALPH_ATTEMPT_PREPARATION_RECEIPT: receiptPath,
          DALPH_ATTEMPT_PREPARATION_TOKEN: receiptToken
        },
        maxBuffer: preparationOutputLimitBytes,
        signal,
        timeout: preparationTimeoutMilliseconds
      },
      (error) => {
        if (error === null) {
          resolve({ _tag: "Exited", exitCode: 0 })
          return
        }
        if (typeof error.code === "number") {
          resolve({ _tag: "Exited", exitCode: error.code })
          return
        }
        resolve({ _tag: "Uncertain", detail: error.message })
      }
    )
  })

/** One opt-in production boundary; an unresolved intent never starts another installer. */
export const nodeAttemptWorktreePreparationService = (
  stateDirectory: string,
  command: AttemptWorktreePreparationCommand,
  environment: NodeJS.ProcessEnv = preparationEnvironment()
): AttemptWorktreePreparationService => {
  const prepare: AttemptWorktreePreparationService["prepare"] = (attempt) =>
    Effect.gen(function* () {
      const startedAtMilliseconds = yield* Clock.currentTimeMillis
      return yield* Effect.tryPromise({
        try: async (signal) => {
          const directory = join(stateDirectory, "worktree-preparations")
          await mkdir(directory, { recursive: true, mode: preparationDirectoryMode })
          const observedDirectory = await lstat(directory)
          if (!observedDirectory.isDirectory() || observedDirectory.isSymbolicLink()) {
            throw failure(attempt, "custody", "preparation state directory is not a directory")
          }
          const path = recordPath(directory, attempt)
          const receiptPath = `${path}.receipt`
          const digest = commandDigest(command)
          let record = await readRecord(path)
          let createdHere = false
          if (record === undefined) {
            const intent = PreparationRecord.cases.Intended.make({
              attempt,
              commandDigest: digest,
              receiptToken: PreparationToken.make(
                createHash("sha256")
                  .update(JSON.stringify([attempt, digest]))
                  .digest("hex")
              ),
              startedAt: new Date(startedAtMilliseconds).toISOString(),
              deadlineAt: new Date(startedAtMilliseconds + preparationTimeoutMilliseconds).toISOString()
            })
            try {
              await writeNewRecord(path, directory, intent)
              record = intent
              createdHere = true
            } catch (error) {
              if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "EEXIST")
                throw error
              record = await readRecord(path)
            }
          }
          if (
            record === undefined ||
            !samePlannedTaskAttempt(record.attempt, attempt) ||
            record.commandDigest !== digest
          ) {
            throw failure(attempt, "custody", "preparation record does not match the exact attempt and command")
          }
          if (record._tag === "Prepared") {
            const currentWorktree = await realpath(attempt.worktree)
            const worktreeStat = await stat(currentWorktree)
            const dependencyStore = await stat(join(currentWorktree, "node_modules", ".pnpm")).catch(() => undefined)
            if (
              record.worktree !== currentWorktree ||
              record.worktreeDevice !== worktreeStat.dev ||
              record.worktreeInode !== worktreeStat.ino ||
              !dependencyStore?.isDirectory()
            ) {
              throw failure(attempt, "custody", "prepared worktree identity or dependency store has changed")
            }
            return
          }
          if (record._tag === "Failed") throw failure(attempt, record.stage, record.detail)
          // Only the process which created the intent may cross the command boundary.
          // A recovered intent may adopt a receipt, but cannot launch a second installer.
          const result = createdHere
            ? await runCommand(command, attempt.worktree, signal, receiptPath, record.receiptToken, environment)
            : undefined
          let receipt: typeof PreparationReceipt.Type | undefined
          try {
            const raw = await readFile(receiptPath, "utf8")
            receipt = Schema.decodeUnknownSync(PreparationReceipt)(JSON.parse(raw))
          } catch (error) {
            if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "ENOENT") {
              throw failure(attempt, "custody", `preparation receipt is unreadable: ${String(error)}`)
            }
          }
          if (receipt === undefined) {
            throw failure(
              attempt,
              "uncertain",
              result?._tag === "Uncertain"
                ? result.detail
                : "preparation intent has no terminal receipt; stopped writers are unproven"
            )
          }
          if (receipt.token !== record.receiptToken) {
            throw failure(attempt, "custody", "preparation receipt token does not match the intended operation")
          }
          if (receipt._tag === "AttemptWorktreePreparationFailed") {
            await replaceRecord(
              path,
              directory,
              PreparationRecord.cases.Failed.make({
                attempt,
                commandDigest: digest,
                detail: receipt.detail,
                stage: receipt.stage
              })
            )
            throw failure(attempt, receipt.stage, receipt.detail)
          }
          const actualWorktree = WorktreeLocator.make(await realpath(attempt.worktree))
          if (receipt.worktree !== actualWorktree) {
            throw failure(attempt, "protocol", "preparation did not report the exact worktree and selected Node")
          }
          const worktreeStat = await stat(actualWorktree)
          const dependencyStore = await stat(join(actualWorktree, "node_modules", ".pnpm")).catch(() => undefined)
          if (!dependencyStore?.isDirectory()) {
            throw failure(attempt, "protocol", "preparation receipt lacks a worktree-local dependency store")
          }
          await replaceRecord(
            path,
            directory,
            PreparationRecord.cases.Prepared.make({
              attempt,
              commandDigest: digest,
              node: receipt.node,
              worktree: actualWorktree,
              worktreeDevice: worktreeStat.dev,
              worktreeInode: worktreeStat.ino
            })
          )
        },
        catch: (error) => (error instanceof AttemptWorktreePreparationFailure ? error : ioFailure(attempt, error))
      })
    })
  return {
    prepare,
    inspect: (correlation) =>
      Effect.gen(function* () {
        const path = recordPath(join(stateDirectory, "worktree-preparations"), correlation)
        const read = yield* Effect.tryPromise({ try: () => readRecord(path), catch: () => undefined }).pipe(Effect.exit)
        if (Exit.isFailure(read)) return "Blocked" as const
        const record = read.value
        if (record === undefined) return "Absent" as const
        if (record.attempt.runId !== correlation.runId || record.attempt.attemptId !== correlation.attemptId) {
          return "Blocked" as const
        }
        const result = yield* prepare(record.attempt).pipe(Effect.exit)
        return Exit.isSuccess(result) ? ("Ready" as const) : ("Blocked" as const)
      })
  }
}

/** Decorates only Begin; no preparation path can start or stop the app-server. */
export const preparedPlannedAttemptExecutor = (
  executor: PlannedAttemptExecutorService,
  preparation: AttemptWorktreePreparationService
): Effect.Effect<PlannedAttemptExecutorService, never, Crypto.Crypto> =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto
    const proofs = yield* Ref.make<ReadonlyMap<string, PlannedAttemptExecutorBeginProofId>>(new Map())
    return PlannedAttemptExecutor.of({
      ...executor,
      observe: (correlation, purpose) =>
        Effect.gen(function* () {
          if (purpose._tag !== "ReconcileCommand" || purpose.command !== "Begin") {
            return yield* executor.observe(correlation, purpose)
          }
          const key = plannedAttemptExecutorCorrelationKey(correlation)
          yield* Ref.update(proofs, (current) => new Map([...current].filter(([entry]) => entry !== key)))
          const observed = yield* executor.observe(correlation, purpose)
          if (observed._tag !== "NoReport") return observed
          const state = yield* preparation.inspect(correlation)
          if (state === "Blocked") {
            return PlannedAttemptExecutorProjection.cases.Unreadable.make({
              correlation,
              detail: "attempt worktree preparation is unresolved"
            })
          }
          const generated = yield* crypto.randomUUIDv4.pipe(Effect.exit)
          if (Exit.isFailure(generated)) {
            return PlannedAttemptExecutorProjection.cases.Unreadable.make({
              correlation,
              detail: "cannot allocate a fresh preparation Begin proof"
            })
          }
          const proofId = PlannedAttemptExecutorBeginProofId.make(generated.value)
          yield* Ref.update(proofs, (current) => new Map([...current, [key, proofId] as const]))
          return PlannedAttemptExecutorProjection.cases.BeginNotCrossed.make({ correlation, proofId })
        }),
      begin: (request, delivery) =>
        Effect.gen(function* () {
          const correlation = plannedAttemptExecutorCorrelation(request.plannedAttempt)
          const key = plannedAttemptExecutorCorrelationKey(correlation)
          const ownProof = yield* Ref.modify(
            proofs,
            (current) => [current.get(key), new Map([...current].filter(([entry]) => entry !== key))] as const
          )
          const innerDelivery =
            delivery._tag === "ReconciledDelivery" && ownProof === delivery.proofId
              ? { _tag: "InitialDelivery" as const }
              : delivery
          yield* preparation
            .prepare(request.plannedAttempt)
            .pipe(
              Effect.mapError(
                (error) =>
                  new PlannedAttemptExecutorCommandFailure({
                    command: "Begin",
                    correlation,
                    detail: `worktree preparation ${error.stage}: ${error.detail}`
                  })
              )
            )
          return yield* executor.begin(request, innerDelivery)
        })
    })
  })
