import { Context, type Effect } from "effect"
import type { RunId } from "@dalph/contracts"
import type { AcceptedJournalPrefix } from "./accepted-prefix.js"
import type { InRunJournalRunMismatch, JournalError } from "./store.js"

/** Reads the coordinator's exact semantically accepted live prefix without exporting its records as an array. */
export interface AcceptedJournalReaderService {
  readonly readAccepted: (
    runId: RunId
  ) => Effect.Effect<AcceptedJournalPrefix, JournalError | InRunJournalRunMismatch>
}

export class AcceptedJournalReader extends Context.Service<AcceptedJournalReader, AcceptedJournalReaderService>()(
  "@dalph/AcceptedJournalReader"
) {}
