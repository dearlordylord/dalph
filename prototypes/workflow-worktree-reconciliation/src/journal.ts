import { join } from "node:path"
import { Effect } from "effect"
import {
  ActiveTaskClaim,
  ClaimOwner,
  ClaimToken,
  InitialControlPolicy,
  JournalDatabaseLocator,
  JournalStore,
  makeTaskClaimObservationOperation,
  type JournalRecord,
  OperationId,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  TaskWorkCapacity,
  workflowJournalEventVersion,
  sqliteJournalStoreLayer
} from "@dalph/orchestrator"
import type { JournalStoreService } from "../../../packages/orchestrator/dist/src/workflow-journal/store.js"
import { makeFocusedTaskClaimFactsObserved } from "../../../packages/orchestrator/dist/src/workflow/task-tracker-facts/observation.js"
import { FixtureTarget } from "../../../packages/orchestrator/dist/src/authorities/task-tracker/fixture/target.js"
import {
  TaskAttemptPlannedEvent,
  TaskWorktreeReadyEvent,
  TaskWorktreeReconciliationIntendedEvent
} from "@dalph/orchestrator"
import { attemptPlanRecordKey, intentRecordKey, outcomeRecordKey } from "../../../packages/orchestrator/dist/src/workflow-journal/record-key.js"
import {
  makeTaskClaimAcquisitionOperation,
  makeTaskAttemptPlanOperation,
  makeTaskWorktreeReconciliationOperation
} from "@dalph/orchestrator"
import { taskTrackerFactsObservedEvent, taskTrackerReadIntent } from "@dalph/orchestrator"
import { fixture, plannedAttempt } from "./contracts.ts"

const target = FixtureTarget.make("issue-234-controlled-worktree")
const claim = ActiveTaskClaim.make({
  operationId: OperationId.make("operation-234-task-claim-0001"),
  owner: ClaimOwner.make("owner-234-worktree-reconciliation"),
  taskId: fixture.taskId,
  token: ClaimToken.make("token-234-worktree-reconciliation")
})
const claimOperation = makeTaskClaimAcquisitionOperation({
  acquisition: claim,
  predecessorOperationIds: []
})
const claimObservationOperation = makeTaskClaimObservationOperation(
  OperationId.make("operation-234-task-claim-read-0001"),
  target,
  fixture.taskId,
  [claim.operationId]
)
const planOperation = makeTaskAttemptPlanOperation({
  operationId: OperationId.make("operation-234-plan-0001"),
  plannedAttempt,
  predecessorOperationIds: [claimObservationOperation.operationId]
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
          intentRecordKey(claim.operationId),
          TaskClaimAcquisitionIntendedEvent.make({ operation: claimOperation, version: workflowJournalEventVersion })
        )
        yield* journal.append(
          fixture.runId,
          outcomeRecordKey(claim.operationId),
          TaskClaimAcquiredEvent.make({ claim, version: workflowJournalEventVersion })
        )
        yield* journal.append(
          fixture.runId,
          intentRecordKey(claimObservationOperation.operationId),
          taskTrackerReadIntent(claimObservationOperation)
        )
        yield* journal.append(
          fixture.runId,
          outcomeRecordKey(claimObservationOperation.operationId),
          taskTrackerFactsObservedEvent(
            claimObservationOperation.operationId,
            makeFocusedTaskClaimFactsObserved(claimObservationOperation, claim)
          )
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
