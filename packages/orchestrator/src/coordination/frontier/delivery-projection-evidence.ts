import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { ResponsibilityFreshFacts } from "./fresh-facts.js"
import type { IntegrationDeliveryWait } from "./integration-frontier.js"

/** Exact lower evidence captured in the same turn as its scheduler frontier. */
export type DeliveryProjectionEvidence =
  | {
      readonly _tag: "AvailableDeliveryProjectionEvidence"
      readonly acceptedAt: JournalPosition | null
      readonly facts: ReadonlyArray<ResponsibilityFreshFacts>
      readonly integrationWaits: ReadonlyArray<IntegrationDeliveryWait>
    }
  | { readonly _tag: "UnavailableDeliveryProjectionEvidence" }
