import { GitCommitSha, type IntegrationTarget, TaskBranchRef, WorktreeLocator } from "@dalph/contracts"
import { Effect, Schema } from "effect"
import { RemoteBaselineFailure } from "../../workflow/protocols/direct-publication/baseline-events.js"
import type { GitCommandService } from "./command.js"
import { failureReasonForCommand, runBounded, type RemoteOperationDeadline } from "./direct-publication-command.js"

const Registration = Schema.Struct({
  worktree: WorktreeLocator,
  HEAD: Schema.optionalKey(GitCommitSha),
  branch: Schema.optionalKey(TaskBranchRef),
  bare: Schema.optionalKey(Schema.Literal("")),
  detached: Schema.optionalKey(Schema.Literal("")),
  locked: Schema.optionalKey(Schema.String)
})
const registrationSeparatorSuffixLength = 2

const decodeRegistration = Effect.fn("RemoteBaselineGit.decodeRegistration")(function* (record: string) {
  const fields: Record<string, string> = {}
  for (const field of record.split("\0")) {
    const separator = field.indexOf(" ")
    const name = separator < 0 ? field : field.slice(0, separator)
    if (Object.hasOwn(fields, name)) return yield* new RemoteBaselineFailure({ reason: "TargetUnreadable" })
    fields[name] = separator < 0 ? "" : field.slice(separator + 1)
  }
  const registration = yield* Schema.decodeUnknownEffect(Registration)(fields, { onExcessProperty: "error" }).pipe(
    Effect.mapError(() => new RemoteBaselineFailure({ reason: "TargetUnreadable" }))
  )
  const modes = [registration.bare, registration.detached, registration.branch].filter((value) => value !== undefined)
  if (modes.length !== 1 || (registration.bare === undefined && registration.HEAD === undefined)) {
    return yield* new RemoteBaselineFailure({ reason: "TargetUnreadable" })
  }
  return registration
})

const proveUnoccupied = Effect.fn("RemoteBaselineGit.proveUnoccupied")(function* (
  output: string,
  target: IntegrationTarget
) {
  if (!output.endsWith("\0\0")) return yield* new RemoteBaselineFailure({ reason: "TargetUnreadable" })
  const paths = new Set<string>()
  for (const record of output.slice(0, -registrationSeparatorSuffixLength).split("\0\0")) {
    const registration = yield* decodeRegistration(record)
    if (paths.has(registration.worktree) || String(registration.branch) === String(target.ref)) {
      return yield* new RemoteBaselineFailure({ reason: "TargetUnreadable" })
    }
    paths.add(registration.worktree)
  }
})

/**
 * update-ref does not protect a checked-out branch's index or files. Under the
 * coordinator's cooperative Git ownership, admit only a direct, unoccupied ref;
 * dirty/clean occupied targets and ambiguous registrations both fail closed.
 */
export const proveLocalCatchUpSafe = Effect.fn("RemoteBaselineGit.proveLocalCatchUpSafe")(function* (
  commands: GitCommandService,
  target: IntegrationTarget,
  expectedLocalHead: GitCommitSha,
  remoteHead: GitCommitSha,
  deadline: RemoteOperationDeadline
) {
  const read = (args: ReadonlyArray<string>) =>
    runBounded(commands, target.repository, args, deadline).pipe(
      Effect.mapError(
        (failure) => new RemoteBaselineFailure({ reason: failureReasonForCommand(failure, "TargetUnreadable") })
      )
    )
  const symbolic = yield* read(["symbolic-ref", "--quiet", target.ref])
  if (symbolic.exitCode !== 1 || symbolic.stdout.length !== 0) {
    return yield* new RemoteBaselineFailure({ reason: "TargetUnreadable" })
  }
  const registrations = yield* read(["worktree", "list", "--porcelain", "-z"])
  if (registrations.exitCode !== 0) return yield* new RemoteBaselineFailure({ reason: "TargetUnreadable" })
  yield* proveUnoccupied(registrations.stdout, target)
  const ancestry = yield* read(["merge-base", "--is-ancestor", expectedLocalHead, remoteHead])
  if (ancestry.exitCode !== 0) return yield* new RemoteBaselineFailure({ reason: "AncestryUnavailable" })
})
