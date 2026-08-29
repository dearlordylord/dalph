import { AttemptId, RunId } from "@dalph/contracts"
import { Schema } from "effect"

/** Monotonically numbers every matching Git read intent for one Running attempt. */
export const ActiveWorkAuthorityRefreshOrdinal = Schema.Int.check(Schema.isGreaterThan(0)).pipe(
  Schema.brand("ActiveWorkAuthorityRefreshOrdinal")
)
export type ActiveWorkAuthorityRefreshOrdinal = typeof ActiveWorkAuthorityRefreshOrdinal.Type

/** The process-local event source that asked the owner to reread one Running attempt. */
export const ActiveWorkAuthorityRefreshSource = Schema.Literals(["TrackerNotification", "Timer"])
export type ActiveWorkAuthorityRefreshSource = typeof ActiveWorkAuthorityRefreshSource.Type

/** Identifies one exact Running attempt whose Git facts are being reread. */
export const ActiveWorkAuthorityRefreshAuthority = Schema.Struct({ attemptId: AttemptId, runId: RunId }).pipe(
  Schema.brand("ActiveWorkAuthorityRefreshAuthority")
)
export type ActiveWorkAuthorityRefreshAuthority = typeof ActiveWorkAuthorityRefreshAuthority.Type
