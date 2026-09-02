import { Duration, Effect, Option, Schema } from "effect"
import type { ActiveWorkAuthorityRefreshSource } from "./run-activation-opportunity.js"

/** A timer or cooldown input cannot drive the owner's bounded process-local loop. */
export class RunReactivationIntervalInvalid extends Schema.TaggedError<RunReactivationIntervalInvalid>()(
  "RunReactivationIntervalInvalid",
  { detail: Schema.String }
) {}

export const finitePositiveDuration = (input: Duration.Input, name: string) => {
  const duration = Duration.fromInput(input)
  if (Option.isNone(duration) || !Duration.isFinite(duration.value) || !Duration.isPositive(duration.value)) {
    return Effect.fail(new RunReactivationIntervalInvalid({ detail: `${name} must be finite and greater than zero` }))
  }
  return Effect.succeed(duration.value)
}

export type RunReactivationMessage<Hint> =
  | { readonly _tag: "Hint"; readonly hint: Hint }
  | { readonly _tag: "TrailingActivation"; readonly generation: number }

export type TrailingActivationKind =
  | { readonly _tag: "Ordinary" }
  | { readonly _tag: "ActiveWorkAuthorityRefresh"; readonly source: ActiveWorkAuthorityRefreshSource }

/** One process-local activation promised by a hint that crossed an activation handoff. */
export interface TrailingActivationObligation {
  readonly _tag: "PendingTrailingActivation"
  readonly generation: number
  readonly kind: TrailingActivationKind
}

/** The gated phase and generation that order hint arrival against activation handoff. */
export type ActivationPhase =
  | { readonly _tag: "Idle"; readonly generation: number }
  | { readonly _tag: "Running"; readonly generation: number }
  | { readonly _tag: "Finalizing"; readonly generation: number }
