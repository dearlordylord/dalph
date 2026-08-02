import { Effect } from "effect"

const deliveryShadowTurnBudget = "100 millis"

/** Makes a non-authoritative shadow unable to fail or indefinitely delay its authoritative caller. */
export const observeDeliveryShadowWithinTurn = <A, E, R>(
  shadow: Effect.Effect<A, E, R>
): Effect.Effect<void, never, R> => shadow.pipe(Effect.timeout(deliveryShadowTurnBudget), Effect.ignoreCause)
