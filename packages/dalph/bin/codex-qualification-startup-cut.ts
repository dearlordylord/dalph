import { Effect } from "effect"
import type { CodexAttemptStoreService } from "../src/application/codex-attempt-store.js"

/** Qualification-only crash seam: retain acknowledged launch and pending startup before initialize. */
export const startupCutStore = (
  durable: CodexAttemptStoreService,
  observe: (serverPid: number) => Effect.Effect<void>
): CodexAttemptStoreService => ({
  ...durable,
  writeServerLaunch: (record) => {
    const pid = record.pid
    return durable
      .writeServerLaunch(record)
      .pipe(
        Effect.andThen(
          record.phase === "Live" && pid !== null ? observe(pid).pipe(Effect.andThen(Effect.never)) : Effect.void
        )
      )
  }
})

/** Qualification crash cuts wrap the same durable store used by the production adapter. */
export const qualificationCutStore = (
  durable: CodexAttemptStoreService,
  action: string,
  observe: (event: unknown) => Effect.Effect<void>
): CodexAttemptStoreService => {
  if (action === "startup-cut")
    return startupCutStore(durable, (serverPid) => observe({ event: "startup-cut", serverPid }))
  if (action === "initialize-response-cut" || action === "initialize-observed-cut")
    return {
      ...durable,
      writeServerStartup: (record) =>
        record._tag === "Initialized"
          ? (action === "initialize-observed-cut" ? durable.writeServerStartup(record) : Effect.void).pipe(
              Effect.andThen(
                observe({
                  event: "initialize-cut",
                  observation: action === "initialize-observed-cut" ? "DurableInitialized" : "ResponseOnly"
                })
              ),
              Effect.andThen(Effect.never)
            )
          : durable.writeServerStartup(record)
    }
  if (action !== "association-cut" && action !== "workflow-association-cut") return durable
  return {
    ...durable,
    writeAttempt: (record) =>
      record._tag === "AssociatedPreTurn"
        ? (action === "workflow-association-cut"
            ? durable
                .writeAttempt(record)
                .pipe(
                  Effect.andThen(observe({ event: "associated", threadMaterialized: true, worktree: record.worktree }))
                )
            : observe({ event: "association-write-started" })
          ).pipe(Effect.andThen(Effect.never))
        : durable.writeAttempt(record)
  }
}
