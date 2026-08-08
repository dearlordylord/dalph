import { Schema } from "effect"

/** A planned verification action reached a composition without its required application boundary. */
export class TargetVerificationBoundaryUnavailable extends Schema.TaggedErrorClass<TargetVerificationBoundaryUnavailable>()(
  "TargetVerificationBoundaryUnavailable",
  { boundary: Schema.Literals(["EvidenceStore", "PublicWrapper"]) }
) {}
