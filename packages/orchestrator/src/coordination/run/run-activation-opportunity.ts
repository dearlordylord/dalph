import { Data } from "effect"

/** The external event that permits one ordinary entry or an authority refresh of already Running work. */
export type RunActivationOpportunity = Data.TaggedEnum<{
  OrdinaryRunEntry: Record<never, never>
  ActiveWorkAuthorityRefresh: { readonly source: "TrackerNotification" | "Timer" }
}>

export const RunActivationOpportunity = Data.taggedEnum<RunActivationOpportunity>()
