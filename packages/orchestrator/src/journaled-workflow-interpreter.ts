import { Effect, Layer } from "effect"
import type { OperationId, PlannedTaskAttempt, RunId } from "./domain.js"
import {
  attemptPlanRecordKey,
  intentRecordKey,
  type JournalRecord,
  JournalStore,
  outcomeRecordKey,
  providerObservationRequestRecordKey,
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  TaskWorkSessionEstablishedEvent,
  TaskWorkSessionEstablishmentIntentRecorded,
  TaskWorkSessionLookupFailed,
  TaskWorkSessionLookupRequested,
  TaskWorkSessionReported,
  taskWorkSessionReportedRecordKey,
  taskWorkStartAcknowledgedRecordKey,
  taskWorkStartFailedRecordKey,
  TaskWorkStartRequestAcknowledged,
  TaskWorkStartRequested,
  TaskWorkStartRequestFailed,
  TaskWorktreeReadyEvent,
  TaskWorktreeReconciliationIntendedEvent,
  trackerGraphObservationIntent,
  trackerGraphOutcomeObserved
} from "./journal-store.js"
import {
  samePlannedTaskAttempt,
  TaskAttemptPlanHistoryContradiction,
  TaskAttemptPlanRecordAcknowledged,
  TaskAttemptPlanRunContradiction
} from "./task-attempt-plan-recording.js"
import { TaskRunner } from "./task-work-start.js"
import { TaskWorktreeHistoryContradiction } from "./task-worktree-reconciliation.js"
import {
  emitTaskWorkSessionNonConvergence,
  makeTrackerGraphObservedOutcome,
  runTaskWorkSessionEstablishmentProtocol,
  TaskWorkSessionEvidenceContradiction,
  TaskWorkSessionRunContradiction,
  taskWorkSessionTraceObserver,
  WorkflowInterpreter,
  WorkflowTrace
} from "./workflow.js"

const requireAcknowledgedPlan = Effect.fn(
  "WorkflowJournal.requireAcknowledgedPlan"
)(function*(
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  operationId: OperationId,
  predecessorOperationIds: ReadonlyArray<OperationId>
) {
  const plans = records.flatMap(({ event }) =>
    event._tag === "TaskAttemptPlanned"
      && event.operation.plannedAttempt.attemptId === plannedAttempt.attemptId
      ? [event]
      : []
  )
  const plan = plans[0]
  if (plan === undefined || plans.length !== 1) {
    return yield* new TaskAttemptPlanHistoryContradiction({
      attemptId: plannedAttempt.attemptId,
      operationId,
      reason: plans.length === 0 ? "Missing" : "MultiplePlans"
    })
  }
  if (!predecessorOperationIds.includes(plan.operation.operationId)) {
    return yield* new TaskAttemptPlanHistoryContradiction({
      attemptId: plannedAttempt.attemptId,
      operationId,
      reason: "CausalPredecessorMissing"
    })
  }
  if (!samePlannedTaskAttempt(plan.operation.plannedAttempt, plannedAttempt)) {
    return yield* new TaskAttemptPlanHistoryContradiction({
      attemptId: plannedAttempt.attemptId,
      operationId,
      reason: "PlanMismatch"
    })
  }
})

const requireReadyWorktree = Effect.fn("WorkflowJournal.requireReadyWorktree")(
  function*(
    records: ReadonlyArray<JournalRecord>,
    plannedAttempt: PlannedTaskAttempt,
    operationId: OperationId,
    predecessorOperationIds: ReadonlyArray<OperationId>
  ) {
    const intents = records.flatMap(({ event }) =>
      event._tag === "TaskWorktreeReconciliationIntended"
        && predecessorOperationIds.includes(event.operation.operationId)
        ? [event]
        : []
    )
    const intent = intents[0]
    if (intent === undefined || intents.length !== 1) {
      return yield* new TaskWorktreeHistoryContradiction({
        attemptId: plannedAttempt.attemptId,
        operationId,
        reason: intents.length === 0 ? "MissingIntent" : "MultipleIntents"
      })
    }
    if (!samePlannedTaskAttempt(intent.operation.plannedAttempt, plannedAttempt)) {
      return yield* new TaskWorktreeHistoryContradiction({
        attemptId: plannedAttempt.attemptId,
        operationId,
        reason: "PlanMismatch"
      })
    }
    const proofs = records.flatMap(({ event }) =>
      event._tag === "TaskWorktreeReady"
        && event.operationId === intent.operation.operationId
        ? [event.proof]
        : []
    )
    const proof = proofs[0]
    if (proof === undefined || proofs.length !== 1) {
      return yield* new TaskWorktreeHistoryContradiction({
        attemptId: plannedAttempt.attemptId,
        operationId,
        reason: proofs.length === 0 ? "MissingProof" : "MultipleProofs"
      })
    }
    if (
      proof.baseSha !== plannedAttempt.baseSha
      || proof.branch !== plannedAttempt.branch
      || proof.worktree !== plannedAttempt.worktree
    ) {
      return yield* new TaskWorktreeHistoryContradiction({
        attemptId: plannedAttempt.attemptId,
        operationId,
        reason: "ProofMismatch"
      })
    }
  }
)

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
          yield* journal.append(runId, key, trackerGraphObservationIntent(operation))
        }
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
      )(function*(operation) {
        const key = intentRecordKey(operation.acquisition.operationId)
        yield* journal.append(
          runId,
          key,
          TaskClaimAcquisitionIntendedEvent.make({ operation, version: 2 })
        )
        const result = yield* interpreter.acquireTaskClaim(operation)
        if (result._tag === "AuthoritativeTaskClaimAcquired") {
          yield* journal.append(
            runId,
            outcomeRecordKey(operation.acquisition.operationId),
            TaskClaimAcquiredEvent.make({
              claim: result.claim,
              version: 2
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
          TaskAttemptPlannedEvent.make({ operation, version: 2 })
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
          TaskWorktreeReconciliationIntendedEvent.make({ operation, version: 2 })
        )
        const result = yield* interpreter.reconcileTaskWorktree(operation)
        if (result._tag === "AuthoritativeTaskWorktreeReady") {
          yield* journal.append(
            runId,
            outcomeRecordKey(operation.operationId),
            TaskWorktreeReadyEvent.make({
              operationId: operation.operationId,
              proof: result.proof,
              version: 2
            })
          )
        }
        return result
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
        const plannedAttempt = operation.request.plannedAttempt
        yield* requireAcknowledgedPlan(
          records,
          plannedAttempt,
          operation.request.operationId,
          operation.predecessorOperationIds
        )
        yield* requireReadyWorktree(
          records,
          plannedAttempt,
          operation.request.operationId,
          operation.predecessorOperationIds
        )
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
              providerObservationRequestRecordKey(failure.observationId),
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
              providerObservationRequestRecordKey(report.observationId),
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
              providerObservationRequestRecordKey(failure.observationId),
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
              providerObservationRequestRecordKey(acknowledgement.observationId),
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

      return WorkflowInterpreter.of({
        acquireTaskClaim,
        establishTaskWorkSession,
        recordTaskAttemptPlan,
        reconcileTaskWorktree,
        readTrackerGraph,
        simulateTaskWorkSession: interpreter.simulateTaskWorkSession
      })
    })
  ).pipe(Layer.provide(interpreterLayer))
