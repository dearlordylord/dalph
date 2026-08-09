import { Schema } from "effect"

/** Candidate continuation cannot cross an application boundary that has no configured adapter. */
export class IntegrationCandidateBoundaryUnavailable extends Schema.TaggedError<IntegrationCandidateBoundaryUnavailable>()(
  "IntegrationCandidateBoundaryUnavailable",
  { boundary: Schema.Literals(["Agent", "Git"]) }
) {}
