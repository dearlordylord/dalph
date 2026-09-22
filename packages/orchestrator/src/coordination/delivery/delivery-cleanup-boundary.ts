import { Context, type Effect } from "effect"
import type { JournalError } from "../../workflow-journal/store.js"

/**
 * Run-owned phase cutoff derived from accepted finality since the last cleanup
 * pass. It is process-local scheduling, never a second cleanup authority.
 */
export class DeliveryCleanupBoundary extends Context.Service<
  DeliveryCleanupBoundary,
  { readonly pending: Effect.Effect<boolean, JournalError> }
>()("@dalph/DeliveryCleanupBoundary") {}
