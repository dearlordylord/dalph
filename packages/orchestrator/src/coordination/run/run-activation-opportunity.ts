import { Schema } from "effect"

/** The ordinary process boundary that may select new work or continue accepted work. */
type OrdinaryRunEntry = { readonly _tag: "OrdinaryRunEntry" }

/**
 * A tracker notification or timer is allowed to refresh authority for work
 * already proven `Running`; the brand prevents callers from manufacturing
 * that privilege by merely spelling the discriminant and source fields.
 */
const ActiveWorkAuthorityRefresh = Schema.TaggedStruct("ActiveWorkAuthorityRefresh", {
  source: Schema.Literals(["TrackerNotification", "Timer"])
}).pipe(Schema.brand("RunActivationActiveWorkAuthorityRefresh"))

type ActiveWorkAuthorityRefresh = typeof ActiveWorkAuthorityRefresh.Type

/** The external event that permits one ordinary entry or an owner-minted authority refresh. */
export type RunActivationOpportunity = OrdinaryRunEntry | ActiveWorkAuthorityRefresh

export const RunActivationOpportunity = {
  OrdinaryRunEntry: (): OrdinaryRunEntry => ({ _tag: "OrdinaryRunEntry" })
} as const

/**
 * Internal owner seam. The package surface exports only the ordinary
 * constructor; `RunReactivationOwner` is the sole production caller that
 * mints this branded opportunity.
 */
export const activeWorkAuthorityRefreshForOwner = (
  source: "TrackerNotification" | "Timer"
): ActiveWorkAuthorityRefresh => ActiveWorkAuthorityRefresh.make({ _tag: "ActiveWorkAuthorityRefresh", source })
