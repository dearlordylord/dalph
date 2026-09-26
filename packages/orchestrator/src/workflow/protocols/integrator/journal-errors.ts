import { RunId } from "@dalph/contracts"
import { Schema } from "effect"

/** Durable event identity conflicted with the exact Integrator append request. */
export class IntegratorJournalContradiction extends Schema.TaggedError<IntegratorJournalContradiction>()(
  "IntegratorJournalContradiction",
  { detail: Schema.String, runId: RunId }
) {}
