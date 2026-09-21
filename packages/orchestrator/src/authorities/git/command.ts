/* eslint-disable import/no-nodejs-modules -- bounded Git execution proves POSIX process custody. */

import { readdir, readFile } from "node:fs/promises"
import nodeProcess from "node:process"
import { Cause, Context, Duration, Effect, Exit, Layer, Option, Schema, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"

import { GitSenderCustody, gitSenderTokenEnvironment, type GitCommandCustodySubject } from "./sender-custody.js"

export const GitCommandResult = Schema.Struct({ exitCode: Schema.Int, stderr: Schema.String, stdout: Schema.String })
export type GitCommandResult = typeof GitCommandResult.Type

export class GitCommandInvocationFailure extends Schema.TaggedError<GitCommandInvocationFailure>()(
  "GitCommandInvocationFailure",
  { detail: Schema.String }
) {}

/** The bounded Git child exceeded its response budget after custody cleanup. */
export class GitCommandResponseDeadline extends Schema.TaggedError<GitCommandResponseDeadline>()(
  "GitCommandResponseDeadline",
  {}
) {}

/** Git stopped responding, but the adapter could not prove all local children stopped. */
export class GitCommandSenderStopUnproven extends Schema.TaggedError<GitCommandSenderStopUnproven>()(
  "GitCommandSenderStopUnproven",
  {}
) {}

/** The bounded Git effect was interrupted while its child was active. */
export class GitCommandInterrupted extends Schema.TaggedError<GitCommandInterrupted>()("GitCommandInterrupted", {}) {}

export type GitCommandBoundedFailure =
  | GitCommandInvocationFailure
  | GitCommandInterrupted
  | GitCommandResponseDeadline
  | GitCommandSenderStopUnproven

export interface GitCommandService {
  readonly run: (
    gitDirectory: string,
    args: ReadonlyArray<string>
  ) => Effect.Effect<GitCommandResult, GitCommandInvocationFailure>
  readonly runInWorktree: (
    worktree: string,
    args: ReadonlyArray<string>
  ) => Effect.Effect<GitCommandResult, GitCommandInvocationFailure>
  readonly runBytesInWorktree: (
    worktree: string,
    args: ReadonlyArray<string>,
    environment?: Readonly<Record<string, string>>
  ) => Effect.Effect<GitCommandBytesResult, GitCommandInvocationFailure>
  /**
   * Runs one repository command with explicit process-group cleanup. The
   * optional member keeps existing controlled fixtures source-compatible;
   * Node production layers provide it and direct publication fails closed
   * when it is absent.
   */
  readonly runBoundedInRepository?: (
    gitDirectory: string,
    args: ReadonlyArray<string>,
    timeout: Duration.Input,
    subject?: GitCommandCustodySubject
  ) => Effect.Effect<GitCommandResult, GitCommandBoundedFailure>
  readonly prepareSenderCustody?: (
    subject: GitCommandCustodySubject
  ) => Effect.Effect<void, GitCommandSenderStopUnproven>
  readonly reconcileSenderCustody?: (
    subject: GitCommandCustodySubject
  ) => Effect.Effect<void, GitCommandSenderStopUnproven>
}

interface GitCommandBytesResult {
  readonly exitCode: number
  readonly stderr: string
  readonly stdout: Uint8Array
}

interface ProcessRecord {
  readonly pid: number
  readonly parentPid: number
  readonly processGroupId: number
  readonly startTime: string
}

interface ProcessCustodySnapshot {
  readonly rootPid: number
  readonly tracked: ReadonlySet<string>
}

const boundedKillGrace: Duration.Input = "1 second"
const boundedCustodyPoll: Duration.Input = "50 millis"
const boundedCustodyProofBudget: Duration.Input = "2 seconds"
const processStatCommandSeparatorLength = 2
const boundedInterruptedExitCode = -1

const processRecordFromStat = (stat: string): ProcessRecord | undefined => {
  const commandEnd = stat.lastIndexOf(") ")
  if (commandEnd < 0) return undefined
  const fields = stat
    .slice(commandEnd + processStatCommandSeparatorLength)
    .trim()
    .split(/\s+/u)
  const pid = Number(stat.slice(0, stat.indexOf(" ")))
  const parentPid = Number(fields[1])
  const processGroupId = Number(fields[2])
  const startTime = fields[19]
  return Number.isSafeInteger(pid) &&
    Number.isSafeInteger(parentPid) &&
    Number.isSafeInteger(processGroupId) &&
    startTime
    ? { parentPid, pid, processGroupId, startTime }
    : undefined
}

const readProcessCensus = async (): Promise<ReadonlyArray<ProcessRecord> | undefined> => {
  if (nodeProcess.platform !== "linux") return undefined
  try {
    const entries = await readdir("/proc", { withFileTypes: true })
    const records = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && /^\d+$/u.test(entry.name))
        .map(async (entry) => {
          try {
            const record = processRecordFromStat(await readFile(`/proc/${entry.name}/stat`, "utf8"))
            return record === undefined ? null : record
          } catch (error: unknown) {
            // A process can disappear between /proc enumeration and stat read.
            // Every other read failure leaves custody unproven; silently dropping
            // it would let an unreadable child escape the stop proof.
            const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined
            return code === "ENOENT" ? undefined : null
          }
        })
    )
    if (records.some((record) => record === null)) return undefined
    return records.filter((record): record is ProcessRecord => record !== undefined && record !== null)
  } catch {
    return undefined
  }
}

const processIdentity = (record: ProcessRecord): string => `${record.pid}:${record.startTime}`

const recordsOwnedByProcess = (
  records: ReadonlyArray<ProcessRecord>,
  rootPid: number
): ReadonlyArray<ProcessRecord> => {
  const byPid = new Map(records.map((record) => [record.pid, record] as const))
  const isDescendant = (record: ProcessRecord): boolean => {
    const visited = new Set<number>()
    let current: ProcessRecord | undefined = record
    while (current !== undefined && !visited.has(current.pid)) {
      if (current.pid === rootPid) return true
      visited.add(current.pid)
      current = byPid.get(current.parentPid)
    }
    return false
  }
  return records.filter((record) => record.processGroupId === rootPid || isDescendant(record))
}

const custodyIsClear = (
  records: ReadonlyArray<ProcessRecord>,
  rootPid: number,
  tracked: ReadonlySet<string>
): boolean => !records.some((record) => record.processGroupId === rootPid || tracked.has(processIdentity(record)))

const captureProcessCustody = (rootPid: number): Effect.Effect<ProcessCustodySnapshot | undefined> =>
  Effect.promise(async () => {
    const records = await readProcessCensus()
    if (records === undefined) return undefined
    const root = records.find((record) => record.pid === rootPid)
    if (root === undefined || root.processGroupId !== rootPid) return undefined
    return { rootPid, tracked: new Set(recordsOwnedByProcess(records, rootPid).map(processIdentity)) }
  })

const proveProcessCustody = (snapshot: ProcessCustodySnapshot): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    const deadline = yield* Effect.clockWith((clock) => clock.currentTimeMillis).pipe(
      Effect.map((start) => start + Duration.toMillis(boundedCustodyProofBudget))
    )
    let proved = false
    let done = false
    while (!done) {
      const current = yield* Effect.promise(readProcessCensus)
      if (current === undefined) {
        done = true
      } else if (custodyIsClear(current, snapshot.rootPid, snapshot.tracked)) {
        proved = true
        done = true
      } else {
        const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis)
        if (now >= deadline) {
          done = true
        } else {
          yield* Effect.sleep(boundedCustodyPoll)
        }
      }
    }
    return proved
  })

const terminateAndProve = (
  handle: ChildProcessSpawner.ChildProcessHandle,
  snapshot: ProcessCustodySnapshot | undefined
): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    // A Git child may create a detached helper after the initial census. Refresh
    // while the root is still alive, then preserve both identity sets through
    // termination and proof.
    const refreshed = snapshot === undefined ? undefined : yield* captureProcessCustody(snapshot.rootPid)
    const merged =
      snapshot === undefined || refreshed === undefined
        ? undefined
        : { rootPid: snapshot.rootPid, tracked: new Set([...snapshot.tracked, ...refreshed.tracked]) }
    yield* handle.kill({ killSignal: "SIGTERM", forceKillAfter: boundedKillGrace }).pipe(Effect.ignore)
    return merged === undefined ? false : yield* proveProcessCustody(merged)
  })

export class GitCommand extends Context.Service<GitCommand, GitCommandService>()("@dalph/GitCommand") {}

export const nodeGitCommandLayer = Layer.effect(
  GitCommand,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const senderCustody = yield* Effect.serviceOption(GitSenderCustody)
    const collectBytes = (values: ReadonlyArray<Uint8Array>): Uint8Array => {
      const output = new Uint8Array(values.reduce((size, bytes) => size + bytes.byteLength, 0))
      let offset = 0
      for (const bytes of values) {
        output.set(bytes, offset)
        offset += bytes.byteLength
      }
      return output
    }
    const runBytesCommand = Effect.fn("GitCommand.Node.runBytesCommand")(function* (
      args: ReadonlyArray<string>,
      environment?: Readonly<Record<string, string>>
    ) {
      return yield* Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* spawner.spawn(
            ChildProcess.make(
              "git",
              args,
              environment === undefined ? undefined : { env: { ...environment }, extendEnv: true }
            )
          )
          const [exitCode, stderr, stdout] = yield* Effect.all(
            [
              handle.exitCode,
              handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
              handle.stdout.pipe(Stream.runCollect, Effect.map(collectBytes))
            ],
            { concurrency: "unbounded" }
          )
          return { exitCode, stderr, stdout }
        })
      ).pipe(Effect.mapError((failure) => new GitCommandInvocationFailure({ detail: String(failure) })))
    })
    const runCommand = Effect.fn("GitCommand.Node.runCommand")(function* (args: ReadonlyArray<string>) {
      const result = yield* runBytesCommand(args)
      return GitCommandResult.make({
        exitCode: result.exitCode,
        stderr: result.stderr,
        stdout: new TextDecoder().decode(result.stdout)
      })
    })
    const runBoundedCommand = Effect.fn("GitCommand.Node.runBoundedCommand")(function* (
      args: ReadonlyArray<string>,
      timeout: Duration.Input,
      subject?: GitCommandCustodySubject
    ) {
      return yield* Effect.scoped(
        Effect.uninterruptibleMask((restore) =>
          Effect.gen(function* () {
            const responseDeadline =
              (yield* Effect.clockWith((clock) => clock.currentTimeMillis)) + Duration.toMillis(timeout)
            const persistent = subject === undefined || Option.isNone(senderCustody) ? undefined : senderCustody.value
            if (subject !== undefined && persistent === undefined) return yield* new GitCommandSenderStopUnproven()
            const token =
              subject === undefined || persistent === undefined
                ? undefined
                : yield* persistent.begin(subject).pipe(Effect.mapError(() => new GitCommandSenderStopUnproven()))
            const handle = yield* spawner.spawn(
              ChildProcess.make("git", args, {
                detached: true,
                ...(token === undefined ? {} : { env: { [gitSenderTokenEnvironment]: token }, extendEnv: true }),
                forceKillAfter: boundedKillGrace,
                killSignal: "SIGTERM"
              })
            )
            if (subject !== undefined && persistent !== undefined && token !== undefined) {
              yield* persistent
                .spawned(subject, token, Number(handle.pid))
                .pipe(Effect.mapError(() => new GitCommandSenderStopUnproven()))
            }
            const custody = yield* captureProcessCustody(Number(handle.pid))
            const stop =
              subject === undefined || persistent === undefined
                ? terminateAndProve(handle, custody)
                : handle.kill({ killSignal: "SIGTERM", forceKillAfter: boundedKillGrace }).pipe(
                    Effect.ignore,
                    Effect.andThen(persistent.reconcile(subject)),
                    Effect.as(true),
                    Effect.orElseSucceed(() => false)
                  )
            const readResult = Effect.all(
              [
                handle.exitCode.pipe(Effect.orElseSucceed(() => boundedInterruptedExitCode)),
                handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
                handle.stdout.pipe(Stream.decodeText(), Stream.mkString)
              ],
              { concurrency: "unbounded" }
            ).pipe(Effect.map(([exitCode, stderr, stdout]) => GitCommandResult.make({ exitCode, stderr, stdout })))
            const responseRemaining = Math.max(
              0,
              responseDeadline - (yield* Effect.clockWith((clock) => clock.currentTimeMillis))
            )
            const bounded = readResult.pipe(
              Effect.timeoutOrElse({
                duration: Duration.millis(responseRemaining),
                // Win the race before stopping the child: killing inside the
                // fallback lets readResult win with its interrupted exit code.
                orElse: () => Effect.fail(new GitCommandResponseDeadline())
              })
            )
            const completed = yield* Effect.exit(restore(bounded))
            if (Exit.isSuccess(completed)) {
              if (completed.value.exitCode !== boundedInterruptedExitCode) {
                if (subject !== undefined && persistent !== undefined) {
                  yield* persistent.reconcile(subject).pipe(Effect.mapError(() => new GitCommandSenderStopUnproven()))
                }
                return completed.value
              }
              const proved = yield* stop
              const failure: GitCommandResponseDeadline | GitCommandSenderStopUnproven = proved
                ? new GitCommandResponseDeadline()
                : new GitCommandSenderStopUnproven()
              return yield* failure
            }
            if (Cause.hasFails(completed.cause)) {
              const reason = Cause.findErrorOption(completed.cause)
              if (reason._tag === "Some" && reason.value instanceof GitCommandResponseDeadline) {
                const proved = yield* stop
                return yield* proved ? new GitCommandResponseDeadline() : new GitCommandSenderStopUnproven()
              }
            }
            if (Cause.hasInterruptsOnly(completed.cause)) {
              const proved = yield* stop
              return yield* proved ? new GitCommandInterrupted() : new GitCommandSenderStopUnproven()
            }
            if (!(yield* stop)) return yield* new GitCommandSenderStopUnproven()
            return yield* Effect.failCause(completed.cause)
          })
        )
      ).pipe(
        Effect.mapError((failure) =>
          failure instanceof GitCommandResponseDeadline ||
          failure instanceof GitCommandSenderStopUnproven ||
          failure instanceof GitCommandInterrupted
            ? failure
            : new GitCommandInvocationFailure({ detail: "bounded Git invocation failed" })
        )
      )
    })
    return GitCommand.of({
      run: Effect.fn("GitCommand.Node.run")(function* (gitDirectory, args) {
        return yield* runCommand([`--git-dir=${gitDirectory}`, ...args])
      }),
      runInWorktree: Effect.fn("GitCommand.Node.runInWorktree")(function* (worktree, args) {
        return yield* runCommand(["-C", worktree, ...args])
      }),
      runBytesInWorktree: Effect.fn("GitCommand.Node.runBytesInWorktree")(function* (worktree, args, environment) {
        return yield* runBytesCommand(["-C", worktree, ...args], environment)
      }),
      prepareSenderCustody: (subject) =>
        Option.isNone(senderCustody)
          ? Effect.fail(new GitCommandSenderStopUnproven())
          : senderCustody.value.reserve(subject).pipe(Effect.mapError(() => new GitCommandSenderStopUnproven())),
      reconcileSenderCustody: (subject) =>
        Option.isNone(senderCustody)
          ? Effect.fail(new GitCommandSenderStopUnproven())
          : senderCustody.value.reconcile(subject).pipe(Effect.mapError(() => new GitCommandSenderStopUnproven())),
      runBoundedInRepository: Effect.fn("GitCommand.Node.runBoundedInRepository")(
        function* (gitDirectory, args, timeout, subject) {
          return yield* runBoundedCommand([`--git-dir=${gitDirectory}`, ...args], timeout, subject)
        }
      )
    })
  })
)
