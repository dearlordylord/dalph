import { Effect, Option, Schema, type FileSystem } from "effect"
import { GitCommitSha, TaskBranchRef, WorktreeLocator } from "@dalph/contracts"
import {
  type GitCommandInvocationFailure,
  type GitCommandResult,
  type GitCommandService
} from "../../../authorities/git/command.js"

const GitWorktreeRecord = Schema.Struct({
  branch: Schema.optionalKey(TaskBranchRef),
  head: GitCommitSha,
  worktree: WorktreeLocator
})
type GitWorktreeRecord = typeof GitWorktreeRecord.Type

export type WorktreeListRead =
  | { readonly _tag: "Valid"; readonly records: ReadonlyArray<GitWorktreeRecord> }
  | { readonly _tag: "Malformed"; readonly detail: string }

const worktreeListFields = new Set(["HEAD", "bare", "branch", "detached", "locked", "prunable", "worktree"])

/** Decode every porcelain block; silently dropping one block would make a live registration look absent. */
export const parseWorktreeRecords = (stdout: string): WorktreeListRead => {
  const blocks = stdout
    .split(/\n\s*\n/u)
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
  const decoded = blocks.map((block): GitWorktreeRecord | undefined => {
    const lines = block.split("\n").map((line) => line.trimEnd())
    const fields = lines.map((line) => {
      const separator = line.indexOf(" ")
      return separator < 0 ? ([line, ""] as const) : ([line.slice(0, separator), line.slice(separator + 1)] as const)
    })
    if (fields.some(([name]) => !worktreeListFields.has(name))) return undefined
    if (["worktree", "HEAD", "branch"].some((name) => fields.filter(([field]) => field === name).length > 1)) {
      return undefined
    }
    const values = Object.fromEntries(fields)
    return Option.getOrUndefined(
      Schema.decodeUnknownOption(GitWorktreeRecord)({
        ...(values["branch"] === undefined ? {} : { branch: values["branch"] }),
        head: values["HEAD"],
        worktree: values["worktree"]
      })
    )
  })
  if (decoded.some((record) => record === undefined)) {
    return { _tag: "Malformed", detail: "git worktree list contained a malformed porcelain block" }
  }
  const records = decoded.filter((record): record is GitWorktreeRecord => record !== undefined)
  if (
    records.some(
      (record, index) =>
        records.findIndex((candidate) => candidate.worktree === record.worktree) !== index ||
        (record.branch !== undefined && records.findIndex((candidate) => candidate.branch === record.branch) !== index)
    )
  ) {
    return { _tag: "Malformed", detail: "git worktree list contained an ambiguous duplicate registration" }
  }
  return { _tag: "Valid", records }
}

export const commandFailure = (failure: GitCommandInvocationFailure): string => failure.detail
export const resultDetail = (stderr: string, exitCode: number): string => stderr.trim() || `git exited ${exitCode}`
export const missingReference = (stderr: string): boolean =>
  /(?:unknown revision|needed a single revision|not a valid object name|not a valid ref|does not exist|not found)/iu.test(
    stderr
  )
export const nonGitPath = (stderr: string): boolean =>
  /(?:not a git repository|does not appear to be a git repository)/iu.test(stderr)

type PathInspection =
  | { readonly _tag: "Absent" }
  | { readonly _tag: "Present" }
  | { readonly _tag: "Unreadable"; readonly detail: string }

export type PathProbe =
  | { readonly _tag: "Absent" }
  | { readonly _tag: "Present"; readonly result: GitCommandResult | { readonly failure: string } }
  | { readonly _tag: "Unreadable"; readonly detail: string }

const inspectPath = (fileSystem: FileSystem.FileSystem, path: string): Effect.Effect<PathInspection> =>
  fileSystem.stat(path).pipe(
    Effect.as<PathInspection>({ _tag: "Present" }),
    Effect.catchTag("PlatformError", (failure) =>
      Effect.succeed(
        failure.reason._tag === "NotFound"
          ? { _tag: "Absent" as const }
          : { _tag: "Unreadable" as const, detail: failure.message }
      )
    )
  )

/** Stat a path before asking Git to interpret it, preserving plain directories and read failures. */
export const probePath = (
  fileSystem: FileSystem.FileSystem,
  commands: GitCommandService,
  path: string,
  args: ReadonlyArray<string>
): Effect.Effect<PathProbe> =>
  Effect.gen(function* () {
    const pathInspection = yield* inspectPath(fileSystem, path)
    if (pathInspection._tag === "Absent") return pathInspection
    if (pathInspection._tag === "Unreadable") return pathInspection
    const command = yield* commands.runInWorktree(path, args).pipe(
      Effect.map((result) => ({ result })),
      Effect.catchTag("GitCommandInvocationFailure", (failure) =>
        Effect.succeed({ result: { failure: commandFailure(failure) } })
      )
    )
    return { _tag: "Present", result: command.result } as const
  })
