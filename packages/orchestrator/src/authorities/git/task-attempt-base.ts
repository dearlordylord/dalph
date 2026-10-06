import { GitCommitSha } from "@dalph/contracts"
import { Context, Duration, Effect, Layer, Schema } from "effect"
import {
  type AttemptBasePolicy,
  TaskAttemptBaseObservation
} from "../../workflow/protocols/task-attempt-planning/base.js"
import {
  GitCommand,
  GitCommandInterrupted,
  GitCommandResponseDeadline,
  GitCommandSenderStopUnproven
} from "./command.js"

/** No settled Git observation is safe yet; retain the recorded read intent for reconciliation. */
export class GitTaskAttemptBaseUnsettled extends Schema.TaggedError<GitTaskAttemptBaseUnsettled>()(
  "GitTaskAttemptBaseUnsettled",
  { reason: Schema.Literals(["BoundedExecutionUnavailable", "SenderStopUnproven", "Interrupted"]) }
) {}

export interface GitTaskAttemptBaseService {
  readonly read: (policy: AttemptBasePolicy) => Effect.Effect<TaskAttemptBaseObservation, GitTaskAttemptBaseUnsettled>
}

/** Read-only qualification before any planned-attempt identity or worktree exists. */
export class GitTaskAttemptBase extends Context.Service<GitTaskAttemptBase, GitTaskAttemptBaseService>()(
  "@dalph/GitTaskAttemptBase"
) {}

const baseReadResponseBudgetMillis = 30_000

export const nodeGitTaskAttemptBaseLayer = Layer.effect(
  GitTaskAttemptBase,
  Effect.gen(function* () {
    const commands = yield* GitCommand
    return GitTaskAttemptBase.of({
      read: Effect.fn("GitTaskAttemptBase.Node.read")(function* (policy) {
        if (policy._tag === "ExplicitFixedBase") {
          return TaskAttemptBaseObservation.cases.Qualified.make({ baseSha: policy.baseSha })
        }
        const refuse = (boundary: (typeof TaskAttemptBaseObservation.cases.Refused.Type)["boundary"], detail: string) =>
          TaskAttemptBaseObservation.cases.Refused.make({ boundary, detail })
        const bounded = commands.runBoundedInRepository
        const boundedWorktree = commands.runBoundedInWorktree
        if (bounded === undefined || boundedWorktree === undefined)
          return yield* new GitTaskAttemptBaseUnsettled({ reason: "BoundedExecutionUnavailable" })
        const deadline = (yield* Effect.clockWith((clock) => clock.currentTimeMillis)) + baseReadResponseBudgetMillis
        const run = (repository: string, args: ReadonlyArray<string>, inWorktree = false) =>
          Effect.gen(function* () {
            const remaining = deadline - (yield* Effect.clockWith((clock) => clock.currentTimeMillis))
            if (remaining <= 0) return yield* new GitCommandResponseDeadline()
            return yield* (inWorktree ? boundedWorktree : bounded)(repository, args, Duration.millis(remaining))
          }).pipe(
            Effect.catchIf(
              (failure) => failure instanceof GitCommandSenderStopUnproven || failure instanceof GitCommandInterrupted,
              (failure) =>
                Effect.fail(
                  new GitTaskAttemptBaseUnsettled({
                    reason: failure instanceof GitCommandInterrupted ? "Interrupted" : "SenderStopUnproven"
                  })
                )
            ),
            Effect.result,
            Effect.flatMap((result) =>
              result._tag === "Failure" && result.failure instanceof GitTaskAttemptBaseUnsettled
                ? Effect.fail(result.failure)
                : Effect.succeed(result)
            )
          )
        const detail = (failure: { readonly _tag: string; readonly detail?: string }) =>
          failure.detail ?? "Git read response deadline exceeded after stopped-child proof"
        const head = yield* run(policy.integrationTarget.repository, [
          "rev-parse",
          "--verify",
          "--quiet",
          `${policy.integrationTarget.ref}^{commit}`
        ])
        if (head._tag === "Failure") return refuse("TargetHead", detail(head.failure))
        if (head.success.exitCode !== 0) {
          return refuse("TargetHead", head.success.stderr.trim() || `git exited ${head.success.exitCode}`)
        }
        const decoded = yield* Schema.decodeUnknownEffect(GitCommitSha)(head.success.stdout.trim()).pipe(Effect.result)
        if (decoded._tag === "Failure") return refuse("TargetHead", String(decoded.failure))
        const baseSha = decoded.success
        const ancestry = yield* run(policy.integrationTarget.repository, [
          "merge-base",
          "--is-ancestor",
          policy.lineageAnchor,
          baseSha
        ])
        if (ancestry._tag === "Failure") return refuse("AnchorAncestry", detail(ancestry.failure))
        if (ancestry.success.exitCode !== 0) {
          return refuse(
            "AnchorAncestry",
            ancestry.success.stderr.trim() || "the lineage anchor is not an ancestor of the selected head"
          )
        }
        const available = yield* run(policy.executionRepository, ["cat-file", "-e", `${baseSha}^{commit}`], true)
        if (available._tag === "Failure") return refuse("ExecutionCommit", detail(available.failure))
        if (available.success.exitCode !== 0) {
          return refuse(
            "ExecutionCommit",
            available.success.stderr.trim() || "the selected commit is unavailable in the execution repository"
          )
        }
        return TaskAttemptBaseObservation.cases.Qualified.make({ baseSha })
      })
    })
  })
)
