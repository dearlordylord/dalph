import { Effect, Fiber, Schedule, type Scope } from "effect"

/** The existing host owns one pass at startup, then one minute after each completed pass.
 * The callback uses its already-acquired Journal; this scheduler acquires no writer.
 */
export const makeHostArchiveMaintenance = Effect.fn("HostArchiveMaintenance.make")(function* (
  pass: () => Effect.Effect<void>
): Effect.fn.Return<{ readonly stop: Effect.Effect<void> }, never, Scope.Scope> {
  yield* pass()
  const periodic = yield* Effect.suspend(pass).pipe(
    Effect.repeat(Schedule.spaced("1 minute")),
    Effect.delay("1 minute"),
    Effect.forkScoped
  )
  return { stop: Fiber.interrupt(periodic).pipe(Effect.asVoid) }
})
