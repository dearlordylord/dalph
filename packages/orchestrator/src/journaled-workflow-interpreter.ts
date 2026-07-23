import { Effect, Layer } from "effect"
import type { RunId } from "./domain.js"
import {
  EvidenceStore,
  ImplementationEvidenceSource,
  testImplementationEvidenceServicesLayer
} from "./implementation-evidence.js"
import {
  ImplementationReviewer,
  implementationReviewTestLayer,
  ReviewFindingsHandback
} from "./implementation-review.js"
import { workflowJournalEventVersion } from "./journal-event-version.js"
import {
  attemptPlanRecordKey,
  intentRecordKey,
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
import { makeJournaledImplementationDisposition } from "./journaled-implementation-convergence.js"
import { makeJournaledImplementationEvidence } from "./journaled-implementation-evidence.js"
import {
  makeJournaledImplementationReview,
  makeJournaledReviewFindingsHandback
} from "./journaled-implementation-review.js"
import { makeJournaledTaskExecution } from "./journaled-task-execution.js"
import { requireAcknowledgedPlan } from "./task-attempt-plan-journal-evidence.js"
import { TaskAttemptPlanRecordAcknowledged, TaskAttemptPlanRunContradiction } from "./task-attempt-plan-recording.js"
import { TaskExecutor } from "./task-execution.js"
import { TaskRunner } from "./task-work-start.js"
import { requireReadyWorktree } from "./task-worktree-journal-evidence.js"
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

/** Adds durable intent, fresh-result checks, and outcomes to the live interpreter. */
export const journaledWorkflowInterpreterLayer = <
  E,
  R,
  ExecutorError,
  ExecutorRequirements,
  EvidenceError = never,
  EvidenceRequirements = never,
  ReviewError = never,
  ReviewRequirements = never
>(
  runId: RunId,
  interpreterLayer: Layer.Layer<WorkflowInterpreter, E, R>,
  taskExecutorLayer: Layer.Layer<TaskExecutor, ExecutorError, ExecutorRequirements>,
  evidenceServicesLayer?: Layer.Layer<
    EvidenceStore | ImplementationEvidenceSource,
    EvidenceError,
    EvidenceRequirements
  >,
  reviewServicesLayer?: Layer.Layer<
    ImplementationReviewer | ReviewFindingsHandback,
    ReviewError,
    ReviewRequirements
  >
) =>
  Layer.effect(
    WorkflowInterpreter,
    Effect.gen(function*() {
      const interpreter = yield* WorkflowInterpreter
      const journal = yield* JournalStore
      const taskExecutor = yield* TaskExecutor
      const taskRunner = yield* TaskRunner
      const trace = yield* WorkflowTrace
      const evidenceStore = yield* EvidenceStore
      const evidenceSource = yield* ImplementationEvidenceSource
      const reviewer = yield* ImplementationReviewer
      const handback = yield* ReviewFindingsHandback

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
          TaskClaimAcquisitionIntendedEvent.make({ operation, version: workflowJournalEventVersion })
        )
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
          TaskAttemptPlannedEvent.make({ operation, version: workflowJournalEventVersion })
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
          TaskWorktreeReconciliationIntendedEvent.make({ operation, version: workflowJournalEventVersion })
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
            version: workflowJournalEventVersion
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
                version: workflowJournalEventVersion
              })
            )
            yield* journal.append(
              runId,
              taskWorkSessionReportedRecordKey(operation.request.operationId, failure.observationId),
              TaskWorkSessionLookupFailed.make({
                failure,
                operationId: operation.request.operationId,
                version: workflowJournalEventVersion
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
                version: workflowJournalEventVersion
              })
            )
            yield* journal.append(
              runId,
              taskWorkSessionReportedRecordKey(operation.request.operationId, report.observationId),
              TaskWorkSessionReported.make({
                operationId: operation.request.operationId,
                report,
                version: workflowJournalEventVersion
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
                version: workflowJournalEventVersion
              })
            )
            yield* journal.append(
              runId,
              taskWorkStartFailedRecordKey(operation.request.operationId, failure.observationId),
              TaskWorkStartRequestFailed.make({ failure, request, version: workflowJournalEventVersion })
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
                version: workflowJournalEventVersion
              })
            )
            yield* journal.append(
              runId,
              taskWorkStartAcknowledgedRecordKey(operation.request.operationId, acknowledgement.observationId),
              TaskWorkStartRequestAcknowledged.make({
                acknowledgement,
                operationId: operation.request.operationId,
                version: workflowJournalEventVersion
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
          TaskWorkSessionEstablishedEvent.make({ outcome, version: workflowJournalEventVersion })
        )
        return outcome
      })

      const executeTaskWork = makeJournaledTaskExecution({
        executor: taskExecutor,
        journal,
        runId,
        trace
      })

      const sealEvidence = makeJournaledImplementationEvidence({
        evidenceSource,
        evidenceStore,
        journal,
        runId
      })
      const reviewOptions = {
        evidenceStore,
        handback,
        journal,
        reviewer,
        runId
      }
      const reviewImplementation = makeJournaledImplementationReview(reviewOptions)
      const handBackReviewFindings = makeJournaledReviewFindingsHandback(reviewOptions)
      const recordImplementationDisposition = makeJournaledImplementationDisposition(runId, journal)

      return WorkflowInterpreter.of({
        acquireTaskClaim,
        establishTaskWorkSession,
        executeTaskWork,
        handBackReviewFindings,
        recordTaskAttemptPlan,
        reconcileTaskWorktree,
        recordImplementationDisposition,
        readTrackerGraph,
        reviewImplementation,
        sealImplementationEvidence: sealEvidence,
        simulateTaskExecution: interpreter.simulateTaskExecution,
        simulateTaskWorkSession: interpreter.simulateTaskWorkSession
      })
    })
  ).pipe(
    Layer.provide(interpreterLayer),
    Layer.provide(taskExecutorLayer),
    Layer.provide(evidenceServicesLayer ?? testImplementationEvidenceServicesLayer),
    Layer.provide(reviewServicesLayer ?? implementationReviewTestLayer)
  )
