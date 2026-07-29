import { Effect, Layer } from "effect"
import type { RunId } from "./domain.js"
import { workflowJournalEventVersion } from "./journal-event-version.js"
import {
  attemptPlanRecordKey,
  intentRecordKey,
  JournalStore,
  outcomeRecordKey,
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  TaskWorktreeReadyEvent,
  TaskWorktreeReconciliationIntendedEvent,
  trackerGraphObservationIntent,
  trackerGraphOutcomeObserved
} from "./journal-store.js"
import { requireAcknowledgedPlan } from "./task-attempt-plan-journal-evidence.js"
import { TaskAttemptPlanRecordAcknowledged, TaskAttemptPlanRunContradiction } from "./task-attempt-plan-recording.js"
import { makeTrackerGraphObservedOutcome, WorkflowInterpreter } from "./workflow.js"

/** Adds durable intent and outcomes to the generic pre-executor operations. */
export const journaledWorkflowInterpreterLayer = <E, R>(
  runId: RunId,
  interpreterLayer: Layer.Layer<WorkflowInterpreter, E, R>
) =>
  Layer.effect(
    WorkflowInterpreter,
    Effect.gen(function*() {
      const interpreter = yield* WorkflowInterpreter
      const journal = yield* JournalStore

      const readTrackerGraph = Effect.fn(
        "WorkflowInterpreter.Journaled.readTrackerGraph"
      )(function*(operation) {
        const key = intentRecordKey(operation.operationId)
        yield* journal.append(
          runId,
          key,
          trackerGraphObservationIntent(operation)
        )
        const snapshot = yield* interpreter.readTrackerGraph(operation)
        yield* journal.append(
          runId,
          outcomeRecordKey(operation.operationId),
          trackerGraphOutcomeObserved(
            operation.operationId,
            makeTrackerGraphObservedOutcome(snapshot)
          )
        )
        return snapshot
      })

      const acquireTaskClaim = Effect.fn(
        "WorkflowInterpreter.Journaled.acquireTaskClaim"
      )(function*(
        operation,
        onIntentRecorded: Effect.Effect<void> = Effect.void
      ) {
        yield* Effect.uninterruptible(Effect.gen(function*() {
          yield* journal.append(
            runId,
            intentRecordKey(operation.acquisition.operationId),
            TaskClaimAcquisitionIntendedEvent.make({
              operation,
              version: workflowJournalEventVersion
            })
          )
          yield* onIntentRecorded
        }))
        const result = yield* interpreter.acquireTaskClaim(operation)
        if (result._tag === "AuthoritativeTaskClaimAcquired") {
          yield* journal.append(
            runId,
            outcomeRecordKey(operation.acquisition.operationId),
            TaskClaimAcquiredEvent.make({
              claim: result.claim,
              version: workflowJournalEventVersion
            })
          )
        }
        return result
      })

      const recordTaskAttemptPlan = Effect.fn(
        "WorkflowInterpreter.Journaled.recordTaskAttemptPlan"
      )(function*(operation) {
        if (operation.plannedAttempt.runId !== runId) {
          return yield* new TaskAttemptPlanRunContradiction({
            journalRunId: runId,
            operationId: operation.operationId,
            plannedAttemptRunId: operation.plannedAttempt.runId
          })
        }
        yield* journal.append(
          runId,
          attemptPlanRecordKey(operation.plannedAttempt.attemptId),
          TaskAttemptPlannedEvent.make({
            operation,
            version: workflowJournalEventVersion
          })
        )
        return TaskAttemptPlanRecordAcknowledged.make({
          plannedAttempt: operation.plannedAttempt
        })
      })

      const reconcileTaskWorktree = Effect.fn(
        "WorkflowInterpreter.Journaled.reconcileTaskWorktree"
      )(function*(operation) {
        if (operation.plannedAttempt.runId !== runId) {
          return yield* new TaskAttemptPlanRunContradiction({
            journalRunId: runId,
            operationId: operation.operationId,
            plannedAttemptRunId: operation.plannedAttempt.runId
          })
        }
        const records = yield* journal.read(runId)
        yield* requireAcknowledgedPlan(
          records,
          operation.plannedAttempt,
          operation.operationId,
          operation.predecessorOperationIds
        )
        yield* journal.append(
          runId,
          intentRecordKey(operation.operationId),
          TaskWorktreeReconciliationIntendedEvent.make({
            operation,
            version: workflowJournalEventVersion
          })
        )
        const result = yield* interpreter.reconcileTaskWorktree(operation)
        if (result._tag === "AuthoritativeTaskWorktreeReady") {
          yield* journal.append(
            runId,
            outcomeRecordKey(operation.operationId),
            TaskWorktreeReadyEvent.make({
              operationId: operation.operationId,
              proof: result.proof,
              version: workflowJournalEventVersion
            })
          )
        }
        return result
      })

      return WorkflowInterpreter.of({
        acquireTaskClaim,
        readTrackerGraph,
        reconcileTaskWorktree,
        recordTaskAttemptPlan
      })
    })
  ).pipe(Layer.provide(interpreterLayer))
