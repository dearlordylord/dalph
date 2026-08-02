import { Context, Effect, Option } from "effect"
import type { DeliveryShadowComparison } from "./delivery-shadow.js"

export interface DeliveryShadowDiagnosticsService {
  /** Records immediately into a bounded process-local sink; it must not perform an Effect or boundary call. */
  readonly record: (comparison: DeliveryShadowComparison) => void
}

/** Optional process-local diagnostic sink; absence means the shadow remains silent. */
export class DeliveryShadowDiagnostics extends Context.Service<
  DeliveryShadowDiagnostics,
  DeliveryShadowDiagnosticsService
>()("@dalph/DeliveryShadowDiagnostics") {}

export const recordDeliveryShadowComparison = (comparison: DeliveryShadowComparison) =>
  Effect.context<never>().pipe(
    Effect.flatMap((context) =>
      Option.match(Context.getOption(context, DeliveryShadowDiagnostics), {
        onNone: () => Effect.void,
        onSome: ({ record }) => Effect.sync(() => record(comparison))
      })
    )
  )
