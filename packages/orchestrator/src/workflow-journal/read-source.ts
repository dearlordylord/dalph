import { Context, Effect, Layer } from "effect"
import { JournalStore, type JournalStoreService } from "./store.js"

/** Read-only committed Run-prefix access for descriptive consumers. */
export interface JournalReadSourceService {
  readonly read: JournalStoreService["read"]
}

/** Capability boundary that exposes committed journal reads without append or lifecycle authority. */
export class JournalReadSource extends Context.Service<JournalReadSource, JournalReadSourceService>()(
  "@dalph/JournalReadSource"
) {}

/** Adapts the authoritative journal store to the presentation-safe read capability. */
export const journalReadSourceLayer = Layer.effect(
  JournalReadSource,
  Effect.gen(function* () {
    const journal = yield* JournalStore
    return JournalReadSource.of({ read: journal.read })
  })
)
