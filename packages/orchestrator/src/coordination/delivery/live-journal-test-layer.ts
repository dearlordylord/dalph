import type { RunId } from "@dalph/contracts"
import { Effect, Layer } from "effect"
import type { TrackerTarget } from "../../authorities/task-tracker/target.js"
import { reduceWorkflowJournalHistory } from "../reconstruction/history.js"
import { memoryJournalStoreLayerFromPartitionRecords } from "../../workflow-journal/adapters/memory-store.js"
import { JournalHistoryInvalid, JournalStore, type JournalRecord } from "../../workflow-journal/store.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { journalLayer } from "./journal.js"

/**
 * A test Run has the same scoped publication owner as production. Initial rows
 * cross the cold validation boundary once; all later accepted reads and appends
 * use that one Journal. Resetting a driver must close and acquire a new layer,
 * never replace the rows underneath an established accepted prefix.
 */
export const liveJournalTestLayer = (input: {
  readonly runId: RunId
  readonly target: TrackerTarget
  readonly records: ReadonlyArray<JournalRecord>
}) => {
  const storage = memoryJournalStoreLayerFromPartitionRecords({ hot: input.records })
  return Layer.unwrap(
    Effect.gen(function* () {
      const journalStore = yield* JournalStore
      const initial = reduceWorkflowJournalHistory(input.runId, input.records)
      if (initial._tag === "InvalidWorkflowJournalHistory") {
        const issue = initial.issues[0]
        return yield* new JournalHistoryInvalid({
          detail: JSON.stringify(initial.issues),
          position: issue !== undefined && "position" in issue ? issue.position : JournalPosition.make(1),
          runId: input.runId
        })
      }
      return journalLayer(input.runId, input.target, initial, journalStore)
    })
  ).pipe(Layer.provideMerge(storage))
}
