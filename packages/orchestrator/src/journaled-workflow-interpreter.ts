import { Effect, Layer } from "effect"
import type { RunId } from "./domain.js"
import {
  intentRecordKey,
  JournalStore,
  managedWorkflowIntent,
  managedWorkflowOutcome,
  outcomeRecordKey,
  TaskWorkSessionEstablishedEvent,
  TaskWorkSessionEstablishmentIntentRecorded,
  TaskWorkSessionLookupFailed,
  TaskWorkSessionLookupRequested,
  taskWorkSessionLookupRequestedRecordKey,
  TaskWorkSessionReported,
  taskWorkSessionReportedRecordKey,
  taskWorkStartAcknowledgedRecordKey,
  taskWorkStartFailedRecordKey,
  TaskWorkStartRequestAcknowledged,
  TaskWorkStartRequested,
  taskWorkStartRequestedRecordKey,
  TaskWorkStartRequestFailed
} from "./journal-store.js"
import { TaskRunner } from "./task-work-start.js"
import {
  emitTaskWorkSessionNonConvergence,
  makeTrackerGraphObservedOutcome,
  runTaskWorkSessionEstablishmentProtocol,
  TaskWorkSessionEstablishedTrace,
  TaskWorkSessionEvidenceContradiction,
  TaskWorkSessionRunContradiction,
  taskWorkSessionTraceObserver,
  WorkflowInterpreter,
  WorkflowTrace
} from "./workflow.js"

/** Reconstructs unresolved session-establishment operations from ordered journal history. */
export const recoverTaskWorkSessionEstablishments = Effect.fn(
  "WorkflowRecovery.recoverTaskWorkSessionEstablishments"
)(function*(runId: RunId) {
  const interpreter = yield* WorkflowInterpreter
  const journal = yield* JournalStore
  const trace = yield* WorkflowTrace
  const records = yield* journal.read(runId)
  // Issue #50 owns total validation/upcasting of ordered managed history. This
  // issue consumes records that already crossed the JournalStore schema boundary.
  const established = new Set(
    records.flatMap(({ event }) =>
      event._tag === "TaskWorkSessionEstablished"
        ? [event.outcome.operationId]
        : []
    )
  )
  const unresolved = records.flatMap(({ event }) =>
    event._tag === "TaskWorkSessionEstablishmentIntentRecorded"
      && !established.has(event.operation.request.operationId)
      ? [event.operation]
      : []
  )
  return yield* Effect.forEach(
    unresolved,
    (operation) =>
      interpreter.establishTaskWorkSession(operation).pipe(
        Effect.tap((outcome) => trace.emit(TaskWorkSessionEstablishedTrace.make({ operation, outcome })))
      )
  )
})

/** Adds durable intent, fresh-result checks, and outcomes to the live interpreter. */
export const journaledWorkflowInterpreterLayer = <E, R>(
  runId: RunId,
  interpreterLayer: Layer.Layer<WorkflowInterpreter, E, R>
) =>
  Layer.effect(
    WorkflowInterpreter,
    Effect.gen(function*() {
      const interpreter = yield* WorkflowInterpreter
      const journal = yield* JournalStore
      const taskRunner = yield* TaskRunner
      const trace = yield* WorkflowTrace

      const readTrackerGraph = Effect.fn(
        "WorkflowInterpreter.Journaled.readTrackerGraph"
      )(function*(operation) {
        const records = yield* journal.read(runId)
        const key = intentRecordKey(operation.operationId)
        if (!records.some((record) => record.key === key)) {
          yield* journal.append(runId, key, managedWorkflowIntent(operation))
        }
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

      const establishTaskWorkSession = Effect.fn(
        "WorkflowInterpreter.Journaled.establishTaskWorkSession"
      )(function*(operation) {
        if (operation.request.plannedAttempt.runId !== runId) {
          return yield* new TaskWorkSessionRunContradiction({
            journalRunId: runId,
            operationId: operation.request.operationId,
            plannedAttemptRunId: operation.request.plannedAttempt.runId
          })
        }
        const records = yield* journal.read(runId)
        const intentKey = intentRecordKey(operation.request.operationId)
        const hasIntent = records.some(({ key }) => key === intentKey)
        const previousMatchingEvent = records.findLast(({ event }) =>
          event._tag === "TaskWorkSessionReported"
          && event.operationId === operation.request.operationId
          && event.report._tag === "MatchingTaskWorkSessionReported"
        )?.event
        const previousMatchingReport = previousMatchingEvent?._tag === "TaskWorkSessionReported"
            && previousMatchingEvent.report._tag === "MatchingTaskWorkSessionReported"
          ? previousMatchingEvent.report
          : undefined
        yield* journal.append(
          runId,
          intentKey,
          TaskWorkSessionEstablishmentIntentRecorded.make({
            operation,
            version: 2
          })
        )
        const existing = records.find(
          ({ event }) =>
            event._tag === "TaskWorkSessionEstablished"
            && event.outcome.operationId === operation.request.operationId
        )
        if (existing?.event._tag === "TaskWorkSessionEstablished") {
          return existing.event.outcome
        }

        const traceObserver = taskWorkSessionTraceObserver(operation, trace)
        const observer = {
          lookupFailed: Effect.fn("WorkflowJournal.lookupFailed")(function*(lookup, failure) {
            yield* journal.append(
              runId,
              taskWorkSessionLookupRequestedRecordKey(failure.observationId),
              TaskWorkSessionLookupRequested.make({
                lookup,
                observationId: failure.observationId,
                version: 2
              })
            )
            yield* journal.append(
              runId,
              taskWorkSessionReportedRecordKey(operation.request.operationId, failure.observationId),
              TaskWorkSessionLookupFailed.make({
                failure,
                operationId: operation.request.operationId,
                version: 2
              })
            )
            yield* traceObserver.lookupFailed(lookup, failure)
          }),
          sessionReported: Effect.fn("WorkflowJournal.sessionReported")(function*(lookup, report) {
            yield* journal.append(
              runId,
              taskWorkSessionLookupRequestedRecordKey(report.observationId),
              TaskWorkSessionLookupRequested.make({
                lookup,
                observationId: report.observationId,
                version: 2
              })
            )
            yield* journal.append(
              runId,
              taskWorkSessionReportedRecordKey(operation.request.operationId, report.observationId),
              TaskWorkSessionReported.make({
                operationId: operation.request.operationId,
                report,
                version: 2
              })
            )
            yield* traceObserver.sessionReported(lookup, report)
            if (
              previousMatchingReport !== undefined
              && (
                report._tag === "NoMatchingTaskWorkSessionReported"
                || (
                  report._tag === "MatchingTaskWorkSessionReported"
                  && report.sessionId !== previousMatchingReport.sessionId
                )
              )
            ) {
              return yield* new TaskWorkSessionEvidenceContradiction({
                currentReport: report,
                operationId: operation.request.operationId,
                previousReport: previousMatchingReport
              })
            }
          }),
          startFailed: Effect.fn("WorkflowJournal.startFailed")(function*(request, failure) {
            yield* journal.append(
              runId,
              taskWorkStartRequestedRecordKey(failure.observationId),
              TaskWorkStartRequested.make({
                observationId: failure.observationId,
                request,
                version: 2
              })
            )
            yield* journal.append(
              runId,
              taskWorkStartFailedRecordKey(operation.request.operationId, failure.observationId),
              TaskWorkStartRequestFailed.make({ failure, request, version: 2 })
            )
            yield* traceObserver.startFailed(request, failure)
          }),
          startRequested: Effect.fn("WorkflowJournal.startRequested")(function*(request, acknowledgement) {
            yield* journal.append(
              runId,
              taskWorkStartRequestedRecordKey(acknowledgement.observationId),
              TaskWorkStartRequested.make({
                observationId: acknowledgement.observationId,
                request,
                version: 2
              })
            )
            yield* journal.append(
              runId,
              taskWorkStartAcknowledgedRecordKey(operation.request.operationId, acknowledgement.observationId),
              TaskWorkStartRequestAcknowledged.make({
                acknowledgement,
                operationId: operation.request.operationId,
                version: 2
              })
            )
            yield* traceObserver.startRequested(request, acknowledgement)
          })
        }
        const outcome = yield* runTaskWorkSessionEstablishmentProtocol(
          taskRunner,
          operation,
          !hasIntent,
          observer
        ).pipe(
          Effect.tapError((failure) => emitTaskWorkSessionNonConvergence(failure, operation, trace))
        )
        yield* journal.append(
          runId,
          outcomeRecordKey(operation.request.operationId),
          TaskWorkSessionEstablishedEvent.make({ outcome, version: 2 })
        )
        return outcome
      })

      return WorkflowInterpreter.of({ establishTaskWorkSession, readTrackerGraph })
    })
  ).pipe(Layer.provide(interpreterLayer))
