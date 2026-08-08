import { Schema } from "effect"

/** The Run reached completion-claim work without a configured tracker boundary. */
export class IntegrationFinalityRuntimeUnavailable extends Schema.TaggedErrorClass<IntegrationFinalityRuntimeUnavailable>()(
  "IntegrationFinalityRuntimeUnavailable",
  {}
) {}
