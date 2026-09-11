import type { PlannedTaskAttempt, TaskWorkSpecification } from "@dalph/contracts"
import {
  FixtureTarget,
  InitialControlPolicy,
  JournalHistoryInvalid,
  JournalPosition,
  JournalStore,
  OperationId,
  TaskWorkCapacity,
  intentRecordKey,
  journalLayer,
  makeFocusedTaskWorkSpecificationFactsObserved,
  makeTaskWorkSpecificationObservationOperation,
  outcomeRecordKey,
  reduceWorkflowJournalHistory,
  sqliteJournalTestLayer,
  taskTrackerFactsObservedEvent,
  taskTrackerReadIntent,
  type JournalDatabaseLocator
} from "@dalph/orchestrator"
import { Effect, Layer } from "effect"

/**
 * Opens the qualification cassette's durable journal as one accepted live lifecycle.
 * An empty database is established before ownership; every later process cold-imports
 * the persisted chronology exactly once before crossing executor boundaries.
 */
export const qualificationWorkflowJournalLayer = (options: {
  readonly attempt: PlannedTaskAttempt
  readonly filename: JournalDatabaseLocator
  readonly specification: TaskWorkSpecification
}) => {
  const target = FixtureTarget.make("qualification")
  const storage = sqliteJournalTestLayer({ filename: options.filename })
  return Layer.unwrap(
    Effect.gen(function* () {
      const journal = yield* JournalStore
      let records = yield* journal.read(options.attempt.runId)
      if (records.length === 0) {
        yield* journal.beginRun(
          options.attempt.runId,
          target,
          InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
        )
        const read = makeTaskWorkSpecificationObservationOperation(
          OperationId.make("qualification-original-specification"),
          target,
          options.attempt.taskId,
          []
        )
        yield* journal.append(options.attempt.runId, intentRecordKey(read.operationId), taskTrackerReadIntent(read))
        yield* journal.append(
          options.attempt.runId,
          outcomeRecordKey(read.operationId),
          taskTrackerFactsObservedEvent(
            read.operationId,
            makeFocusedTaskWorkSpecificationFactsObserved(read, options.specification)
          )
        )
        records = yield* journal.read(options.attempt.runId)
      }
      const initial = reduceWorkflowJournalHistory(options.attempt.runId, records)
      if (initial._tag === "InvalidWorkflowJournalHistory") {
        const issue = initial.issues[0]
        return yield* new JournalHistoryInvalid({
          detail: JSON.stringify(initial.issues),
          position: issue !== undefined && "position" in issue ? issue.position : JournalPosition.make(1),
          runId: options.attempt.runId
        })
      }
      return journalLayer(options.attempt.runId, target, initial, journal)
    })
  ).pipe(Layer.provideMerge(storage))
}
