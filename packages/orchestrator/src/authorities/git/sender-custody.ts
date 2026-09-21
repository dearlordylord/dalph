import type { Effect } from "effect"
import { Context, Schema } from "effect"

/** Exact workflow push intent whose local sender is owned by the execution substrate. */
export const GitCommandCustodySubject = Schema.Struct({
  requestId: Schema.NonEmptyString,
  attemptOrdinal: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))
})
export type GitCommandCustodySubject = typeof GitCommandCustodySubject.Type

/** Pre-spawn execution token inherited by the Git sender and its helper processes. */
export const GitSenderToken = Schema.NonEmptyString.pipe(Schema.brand("GitSenderToken"))
export type GitSenderToken = typeof GitSenderToken.Type

export class GitSenderCustodyFailure extends Schema.TaggedError<GitSenderCustodyFailure>()(
  "GitSenderCustodyFailure",
  {}
) {}

export const gitSenderTokenEnvironment = "DALPH_GIT_SENDER_TOKEN"

/** Durable local process ownership; these facts never enter the workflow journal. */
export class GitSenderCustody extends Context.Service<
  GitSenderCustody,
  {
    readonly reserve: (subject: GitCommandCustodySubject) => Effect.Effect<void, GitSenderCustodyFailure>
    readonly begin: (subject: GitCommandCustodySubject) => Effect.Effect<GitSenderToken, GitSenderCustodyFailure>
    readonly spawned: (
      subject: GitCommandCustodySubject,
      token: GitSenderToken,
      pid: number
    ) => Effect.Effect<void, GitSenderCustodyFailure>
    readonly reconcile: (subject: GitCommandCustodySubject) => Effect.Effect<void, GitSenderCustodyFailure>
  }
>()("@dalph/GitSenderCustody") {}
