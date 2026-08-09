import { Schema } from "effect"

/** A planned verification action reached a composition without its coherent plan, wrapper, and evidence capability. */
export class TargetVerificationRuntimeUnavailable extends Schema.TaggedError<TargetVerificationRuntimeUnavailable>()(
  "TargetVerificationRuntimeUnavailable",
  {}
) {}
