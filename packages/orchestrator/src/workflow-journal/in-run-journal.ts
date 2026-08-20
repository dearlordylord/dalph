import { Context } from "effect"
import type { Effect } from "effect"
import type { AppendableWorkflowJournalEvent, JournalAppendError, JournalReadError, JournalRecord } from "./store.js"
import type { JournalRecordKey } from "./identity.js"
import type { RunId } from "@dalph/contracts"

/** Fixed-process access to ordinary Run history; it cannot begin, recover, scan, or terminate a Run. */
export interface InRunJournalService {
  readonly append: (
    runId: RunId,
    key: JournalRecordKey,
    event: AppendableWorkflowJournalEvent
  ) => Effect.Effect<JournalRecord, JournalAppendError>
  readonly read: (runId: RunId) => Effect.Effect<ReadonlyArray<JournalRecord>, JournalReadError>
}

/** Process-local capability for appending and reading one established Run. */
export class InRunJournal extends Context.Service<InRunJournal, InRunJournalService>()("@dalph/InRunJournal") {}
