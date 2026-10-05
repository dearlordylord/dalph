import { GitCommitSha, TaskBranchRef, WorktreeLocator } from "@dalph/contracts"
import { Effect, Schema } from "effect"

const Registration = Schema.Struct({
  worktree: WorktreeLocator,
  HEAD: Schema.optionalKey(GitCommitSha),
  branch: Schema.optionalKey(TaskBranchRef),
  bare: Schema.optionalKey(Schema.Literal("")),
  detached: Schema.optionalKey(Schema.Literal("")),
  locked: Schema.optionalKey(Schema.String)
})

/** Git did not supply a complete, internally consistent registered-worktree inventory. */
export class GitWorktreeInventoryInvalid extends Schema.TaggedError<GitWorktreeInventoryInvalid>()(
  "GitWorktreeInventoryInvalid",
  { detail: Schema.String }
) {}

const terminalSeparatorLength = 2

const invalid = (detail: string) => new GitWorktreeInventoryInvalid({ detail })

/** Decode Git's NUL-delimited inventory without treating missing or ambiguous rows as absence. */
export const decodeGitWorktreeRegistrations = Effect.fn("Git.decodeWorktreeRegistrations")(function* (output: string) {
  if (!output.endsWith("\0\0")) return yield* invalid("worktree inventory has no complete terminal separator")
  const paths = new Set<string>()
  const registrations: Array<typeof Registration.Type> = []
  for (const record of output.slice(0, -terminalSeparatorLength).split("\0\0")) {
    const fields: Record<string, string> = {}
    for (const field of record.split("\0")) {
      const separator = field.indexOf(" ")
      const name = separator < 0 ? field : field.slice(0, separator)
      if (Object.hasOwn(fields, name)) return yield* invalid(`duplicate worktree field: ${name}`)
      fields[name] = separator < 0 ? "" : field.slice(separator + 1)
    }
    const registration = yield* Schema.decodeUnknownEffect(Registration)(fields, { onExcessProperty: "error" }).pipe(
      Effect.mapError((failure) => invalid(`invalid worktree registration: ${String(failure)}`))
    )
    const modes = [registration.bare, registration.detached, registration.branch].filter((value) => value !== undefined)
    if (modes.length !== 1 || (registration.bare === undefined && registration.HEAD === undefined)) {
      return yield* invalid("worktree registration does not prove one supported checkout mode")
    }
    if (paths.has(registration.worktree)) return yield* invalid(`duplicate worktree path: ${registration.worktree}`)
    paths.add(registration.worktree)
    registrations.push(registration)
  }
  return registrations
})
