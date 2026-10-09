import type { RunId } from "@dalph/contracts"
import { Effect } from "effect"
import type { TrackerTarget } from "../../authorities/task-tracker/target.js"
import { completedRunRecoveryFailure } from "../completion.js"
import { readRecoverableRunBeginning } from "../run-lifecycle.js"
import { classifyJournalMethodFailure } from "./sqlite-store-errors.js"
import type { SqliteJournalQueries } from "./sqlite-store-queries.js"
import type { makeSqliteCompletions } from "./sqlite-completion.js"
import type { SqliteStorageCheckpoint } from "./sqlite-storage-checkpoint.js"

/** Completion-only identities are rejected before reconstructing or publishing a recoverable prefix. */
export const makeSqliteRunRecovery = (
  completions: ReturnType<typeof makeSqliteCompletions>,
  queries: SqliteJournalQueries,
  publish: (checkpoint: SqliteStorageCheckpoint) => Effect.Effect<void>
) =>
  Effect.fn("JournalStore.Sqlite.readRunForRecovery")(function* (runId: RunId, target: TrackerTarget) {
    const completion = yield* completions.read(runId)
    const failure = completedRunRecoveryFailure(runId, target, completion)
    if (failure !== undefined) return yield* failure
    const snapshot = yield* queries
      .loadRunSnapshot(runId, "JournalStore.readRunForRecovery")
      .pipe(Effect.mapError((cause) => classifyJournalMethodFailure("JournalStore.readRunForRecovery", cause)))
    yield* publish(snapshot.checkpoint)
    return yield* readRecoverableRunBeginning(snapshot.records, runId, target)
  })
