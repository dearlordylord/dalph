import { AttemptId, RunId } from "@dalph/contracts"
import { Schema } from "effect"

/** Monotonically numbers every matching Git read intent for one Running attempt. */
export const ActiveWorkAuthorityRefreshOrdinal = Schema.Int.check(Schema.isGreaterThan(0)).pipe(
  Schema.brand("ActiveWorkAuthorityRefreshOrdinal")
)
export type ActiveWorkAuthorityRefreshOrdinal = typeof ActiveWorkAuthorityRefreshOrdinal.Type

/** Identifies the owner source that minted one active-work refresh opportunity. */
export const ActiveWorkAuthorityRefreshAuthority = Schema.Struct({
  attemptId: AttemptId,
  runId: RunId,
  source: Schema.Literals(["TrackerNotification", "Timer"])
}).pipe(Schema.brand("ActiveWorkAuthorityRefreshAuthority"))
export type ActiveWorkAuthorityRefreshAuthority = typeof ActiveWorkAuthorityRefreshAuthority.Type

/** Durable purpose attached to the exact Git intent owned by an active refresh. */
export const ActiveWorkAuthorityRefreshGitReadPurpose = Schema.TaggedStruct("ActiveWorkAuthorityRefresh", {
  authority: ActiveWorkAuthorityRefreshAuthority,
  ordinal: ActiveWorkAuthorityRefreshOrdinal
})
export type ActiveWorkAuthorityRefreshGitReadPurpose = typeof ActiveWorkAuthorityRefreshGitReadPurpose.Type
