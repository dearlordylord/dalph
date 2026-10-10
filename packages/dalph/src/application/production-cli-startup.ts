import { type ApplicationExitResult } from "@dalph/orchestrator"
import { Deferred, Effect, Schema } from "effect"
import type { ProductionHostStartup } from "./production-host.js"
import {
  installApplicationExitSignalAdapter,
  type ApplicationExitSignalBoundary,
  type InstalledApplicationExitSignalAdapter
} from "./supervisor-exit.js"
import { type CliExitOutputAbandoned, withCliExitOutputGrace } from "./cli-exit-output.js"

/** An application-only lifecycle failure has no selected Run identity. */
export class ProductionHostExitUnsuccessful extends Schema.TaggedError<ProductionHostExitUnsuccessful>()(
  "ProductionHostExitUnsuccessful",
  { disposition: Schema.Literals(["Failed", "TimedOut"]) }
) {}

/** One invocation installs its transport before acquisition and reuses it after selection. */
export const makeProductionCliStartup = <E, R>(
  signals: ApplicationExitSignalBoundary,
  report: (result: ApplicationExitResult) => Effect.Effect<void, E, R>
) =>
  Effect.gen(function* () {
    const installed = yield* Deferred.make<InstalledApplicationExitSignalAdapter>()
    const startup = {
      installTransport: (boundary) =>
        installApplicationExitSignalAdapter(boundary, signals, ["SIGINT", "SIGTERM"]).pipe(
          Effect.flatMap((adapter) => Deferred.succeed(installed, adapter)),
          Effect.asVoid
        ),
      presentResult: (result) =>
        Deferred.await(installed).pipe(
          Effect.flatMap((adapter) => withCliExitOutputGrace(adapter, () => report(result)))
        )
    } satisfies ProductionHostStartup<void, E | CliExitOutputAbandoned, R>
    return { startup, awaitAdapter: Deferred.await(installed) }
  })
