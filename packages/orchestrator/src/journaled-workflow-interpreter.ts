import { Effect, Layer } from "effect"
import type { RunId } from "./domain.js"
import {
  intentRecordKey,
  JournalReconciliationRequired,
  JournalStore,
  managedWorkflowIntent,
  managedWorkflowOutcome,
  outcomeRecordKey
} from "./journal-store.js"
import { makeTrackerGraphObservedOutcome, WorkflowInterpreter } from "./workflow.js"

/**
 * Adds durable intent/observation choreography to a workflow interpreter.
 * An unresolved task intent fails closed so callers must reconcile execution
 * substrate authority before any retry can repeat the external effect.
 */
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
        const records = yield* journal.read(runId)
        const hasIntent = records.some(
          ({ key }) => key === intentRecordKey(operation.operationId)
        )
        if (!hasIntent) {
          yield* journal.append(
            runId,
            intentRecordKey(operation.operationId),
            managedWorkflowIntent(operation)
          )
        }

        // Tracker reads are reconciled against current tracker authority. An
        // existing equal outcome re-appends idempotently; a change contradicts.
        const snapshot = yield* interpreter.readTrackerGraph(operation)
        yield* journal.append(
          runId,
          outcomeRecordKey(operation.operationId),
          managedWorkflowOutcome(
            operation.operationId,
            makeTrackerGraphObservedOutcome(snapshot)
          )
        )
        return snapshot
      })

      const executeTask = Effect.fn(
        "WorkflowInterpreter.Journaled.executeTask"
      )(function*(operation) {
        const records = yield* journal.read(runId)
        const intentKey = intentRecordKey(operation.operationId)
        const outcomeKey = outcomeRecordKey(operation.operationId)
        const existingOutcome = records.find(({ key }) => key === outcomeKey)
        if (
          existingOutcome?.event._tag === "ManagedTaskExecutionOutcomeObserved"
          && existingOutcome.event.operationId === operation.operationId
        ) {
          return existingOutcome.event.outcome
        }
        if (records.some(({ key }) => key === intentKey)) {
          // Issue #39 deliberately stops here. Do not retry the effect or treat
          // this temporary error as Dalph's recovery protocol: issue #41 must
          // first specify, through Wayfinder, how the same OperationId is
          // reconciled against external authority before an outcome is added.
          // https://github.com/dearlordylord/dalph/issues/39
          // https://github.com/dearlordylord/dalph/issues/41
          return yield* new JournalReconciliationRequired({
            operationId: operation.operationId,
            runId
          })
        }

        yield* journal.append(
          runId,
          intentKey,
          managedWorkflowIntent(operation)
        )
        const outcome = yield* interpreter.executeTask(operation)
        yield* journal.append(
          runId,
          outcomeKey,
          managedWorkflowOutcome(operation.operationId, outcome)
        )
        return outcome
      })

      return WorkflowInterpreter.of({ executeTask, readTrackerGraph })
    })
  ).pipe(Layer.provide(interpreterLayer))
