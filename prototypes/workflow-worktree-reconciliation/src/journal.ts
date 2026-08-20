import { join } from "node:path"
import { Effect } from "effect"
import {
  InitialControlPolicy,
  JournalDatabaseLocator,
  JournalStore,
  type JournalRecord,
  OperationId,
  TaskWorkCapacity,
  workflowJournalEventVersion,
  sqliteJournalStoreLayer
} from "@dalph/orchestrator"
import type { JournalStoreService } from "../../../packages/orchestrator/dist/src/workflow-journal/store.js"
import { FixtureTarget } from "../../../packages/orchestrator/dist/src/authorities/task-tracker/fixture/target.js"
import {
  TaskAttemptPlannedEvent,
  TaskWorktreeReadyEvent,
  TaskWorktreeReconciliationIntendedEvent
} from "@dalph/orchestrator"
import { attemptPlanRecordKey, intentRecordKey, outcomeRecordKey } from "../../../packages/orchestrator/dist/src/workflow-journal/record-key.js"
import {
  makeTaskAttemptPlanOperation,
  makeTaskWorktreeReconciliationOperation
} from "@dalph/orchestrator"
import { fixture, plannedAttempt } from "./contracts.ts"

const target = FixtureTarget.make("issue-234-controlled-worktree")
const planOperation = makeTaskAttemptPlanOperation({
  operationId: OperationId.make("operation-234-plan-0001"),
  plannedAttempt,
  predecessorOperationIds: []
})
export const reconciliationOperation = makeTaskWorktreeReconciliationOperation({
  operationId: fixture.operationId,
  plannedAttempt,
  predecessorOperationIds: [planOperation.operationId]
})

const journalLayerFor = (workspace: string) =>
  sqliteJournalStoreLayer({ filename: JournalDatabaseLocator.make(join(workspace, "journal.sqlite")) })

/** Opens the persistent local Journal and installs only the immutable starting facts. */
export const establishJournal = (workspace: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const journal = yield* JournalStore
      let records = yield* journal.read(fixture.runId)
      if (records.length === 0) {
        yield* journal.beginRun(
          fixture.runId,
          target,
          InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
        )
        yield* journal.append(
          fixture.runId,
          attemptPlanRecordKey(plannedAttempt.attemptId),
          TaskAttemptPlannedEvent.make({ operation: planOperation, version: workflowJournalEventVersion })
        )
        records = yield* journal.read(fixture.runId)
      }
      if (!records.some(({ event }) => event._tag === "TaskWorktreeReconciliationIntended")) {
        yield* journal.append(
          fixture.runId,
          intentRecordKey(fixture.operationId),
          TaskWorktreeReconciliationIntendedEvent.make({
            operation: reconciliationOperation,
            version: workflowJournalEventVersion
          })
        )
      }
      return yield* journal.read(fixture.runId)
    }).pipe(Effect.provide(journalLayerFor(workspace)))
  )

export const runJournalEffect = <A, E, R>(workspace: string, effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provide(journalLayerFor(workspace)))

/** The only accepted Journal outcome written by the candidate. */
export const appendReady = (journal: JournalStoreService, proof: Parameters<typeof TaskWorktreeReadyEvent.make>[0]) =>
  journal.append(fixture.runId, outcomeRecordKey(fixture.operationId), TaskWorktreeReadyEvent.make(proof))

export const hasReadyOutcome = (records: ReadonlyArray<JournalRecord>): boolean =>
  records.some(
    ({ event }) =>
      event._tag === "TaskWorktreeReady" &&
      event.operationId === fixture.operationId &&
      event.proof.baseSha === fixture.baseSha &&
      event.proof.branch === fixture.branch &&
      event.proof.worktree === fixture.worktree
  )

export const loadJournalRecords = (workspace: string): Promise<ReadonlyArray<JournalRecord>> =>
  Effect.runPromise(
    Effect.scoped(
      runJournalEffect(
        workspace,
        Effect.gen(function* () {
          return yield* (yield* JournalStore).read(fixture.runId)
        })
      )
    )
  )
