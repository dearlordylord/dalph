import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { InitialControlPolicy } from "../../../control/policy.js"
import { TaskWorkCapacity } from "../../../coordination/admission/capacity.js"
import { Effect, Layer } from "effect"
import { journalLayer } from "../../../coordination/delivery/journal.js"
import { liveJournalTestLayer } from "../../../coordination/delivery/live-journal-test-layer.js"
import { reduceWorkflowJournalHistory } from "../../../coordination/reconstruction/history.js"
import { sqliteJournalTestLayer } from "../../../workflow-journal/adapters/sqlite-store.js"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import { makeWorkflowRunBeganRecord } from "../../../workflow-journal/run-lifecycle.js"
import { JournalHistoryInvalid, JournalStore, type JournalRecord } from "../../../workflow-journal/store.js"
import type { JournalDatabaseLocator } from "../../../workflow-journal/identity.js"
import { runId } from "./fixtures.js"

const target = FixtureTarget.make("issue-69-disposition-cleanup")
const beginning = makeWorkflowRunBeganRecord(
  runId,
  target,
  InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
)

/** One real accepted Journal lifecycle for runtime-style disposition-cleanup tests. */
export const dispositionCleanupLiveJournalTestLayer = (records: ReadonlyArray<JournalRecord> = [beginning]) =>
  liveJournalTestLayer({ records, runId, target })

/** Reopens SQLite through one reconstructed Journal owner at each process-lifecycle boundary. */
export const dispositionCleanupSqliteLiveJournalTestLayer = (filename: JournalDatabaseLocator) => {
  const storage = sqliteJournalTestLayer({ filename })
  return Layer.unwrap(
    Effect.gen(function* () {
      const journalStore = yield* JournalStore
      if ((yield* journalStore.read(runId)).length === 0) {
        yield* journalStore.beginRun(
          runId,
          target,
          InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
        )
      }
      const records = yield* journalStore.read(runId)
      const initial = reduceWorkflowJournalHistory(runId, records)
      if (initial._tag === "InvalidWorkflowJournalHistory") {
        const issue = initial.issues[0]
        return yield* new JournalHistoryInvalid({
          detail: JSON.stringify(initial.issues),
          position: issue !== undefined && "position" in issue ? issue.position : JournalPosition.make(1),
          runId
        })
      }
      return journalLayer(runId, target, initial, journalStore)
    })
  ).pipe(Layer.provideMerge(storage))
}
