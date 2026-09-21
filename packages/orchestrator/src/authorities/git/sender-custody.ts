import type { Effect } from "effect"
import { Context, Schema } from "effect"
import {
  RemotePublicationAttemptOrdinal,
  RemotePublicationRequestId
} from "../../workflow/protocols/direct-publication/events.js"

/** Exact workflow push intent whose local sender is owned by the execution substrate. */
export const GitCommandCustodySubject = Schema.Struct({
  requestId: RemotePublicationRequestId,
  attemptOrdinal: RemotePublicationAttemptOrdinal
})
export type GitCommandCustodySubject = typeof GitCommandCustodySubject.Type

/** Positive operating-system process identity for the exact local Git sender. */
export const GitSenderProcessId = Schema.Int.check(Schema.isGreaterThan(0)).pipe(Schema.brand("GitSenderProcessId"))
export type GitSenderProcessId = typeof GitSenderProcessId.Type

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
      pid: GitSenderProcessId
    ) => Effect.Effect<void, GitSenderCustodyFailure>
    readonly reconcile: (subject: GitCommandCustodySubject) => Effect.Effect<void, GitSenderCustodyFailure>
  }
>()("@dalph/GitSenderCustody") {}
