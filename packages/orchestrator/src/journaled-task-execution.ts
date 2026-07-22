import { Effect, Schema } from "effect"
import type { RunId } from "./domain.js"
import {
  intentRecordKey,
  type JournalRecord,
  type JournalStoreService,
  outcomeRecordKey,
  TaskExecutionIntentRecorded,
  TaskExecutionObservationFailed,
  taskExecutionObservationFailedRecordKey,
  TaskExecutionOutcomeObservedEvent,
  TaskExecutionReported,
  taskExecutionReportedRecordKey,
  TaskExecutionRequestAttemptRecorded,
  taskExecutionRequestAttemptRecordKey,
  TaskExecutionRequestFailed,
  taskExecutionRequestFailedRecordKey,
  TaskExecutionRequestReturned,
  taskExecutionRequestReturnedRecordKey
} from "./journal-store.js"
import { samePlannedTaskAttempt } from "./task-attempt-plan-recording.js"
import { runTaskExecutionProtocol, taskExecutionTraceObserver } from "./task-execution-workflow.js"
import {
  TaskExecutionHistoryContradiction,
  TaskExecutionReport,
  TaskExecutionReportContradiction,
  TaskExecutionRunContradiction,
  type TaskExecutorService
} from "./task-execution.js"
import { WorkflowOperation } from "./workflow-operation.js"
import { WorkflowOutcome } from "./workflow-outcome.js"

type ExecuteTaskWorkOperation = typeof WorkflowOperation.cases.ExecuteTaskWork.Type

const sameExecutionOperation = (
  left: ExecuteTaskWorkOperation,
  right: ExecuteTaskWorkOperation
): boolean =>
  JSON.stringify(Schema.encodeUnknownSync(WorkflowOperation.cases.ExecuteTaskWork)(left))
    === JSON.stringify(Schema.encodeUnknownSync(WorkflowOperation.cases.ExecuteTaskWork)(right))

const stabilizedReportEvidence = (report: TaskExecutionReport) => {
  const { observationId: _observation, ...evidence } = Schema.encodeUnknownSync(TaskExecutionReport)(report)
  return evidence
}

const sameExecutionReport = (left: TaskExecutionReport, right: TaskExecutionReport): boolean =>
  JSON.stringify(stabilizedReportEvidence(left))
    === JSON.stringify(stabilizedReportEvidence(right))

const isTerminalExecutionReport = (report: TaskExecutionReport): boolean =>
  report._tag === "SuccessfulTaskExecutionReported"
  || report._tag === "FailedTaskExecutionReported"
  || report._tag === "InterruptedTaskExecutionReported"

const hasWorkerProcess = (
  report: TaskExecutionReport
): report is Exclude<
  TaskExecutionReport,
  { readonly _tag: "NoTaskExecutionReported" | "TaskExecutionSessionConflictReported" }
> => "processId" in report

const requireExactIntent = Effect.fn("WorkflowJournal.requireExactTaskExecutionIntent")(
  function*(records: ReadonlyArray<JournalRecord>, operation: ExecuteTaskWorkOperation) {
    const intents = records.flatMap(({ event }) =>
      event._tag === "TaskExecutionIntentRecorded"
        && event.operation.request.operationId === operation.request.operationId
        ? [event.operation]
        : []
    )
    if (intents.length > 1) {
      return yield* new TaskExecutionHistoryContradiction({
        operationId: operation.request.operationId,
        reason: "MultipleIntents"
      })
    }
    const intent = intents[0]
    if (intent === undefined) return false
    if (!sameExecutionOperation(intent, operation)) {
      return yield* new TaskExecutionHistoryContradiction({
        operationId: operation.request.operationId,
        reason: "IntentMismatch"
      })
    }
    return true
  }
)

const requestAmbiguityBegan = (records: ReadonlyArray<JournalRecord>, operationId: string): boolean =>
  records.some(({ event }) =>
    event._tag === "TaskExecutionRequestAttemptRecorded"
      ? event.request.operationId === operationId
      : event._tag === "TaskExecutionRequestReturned"
          || event._tag === "TaskExecutionObservationFailed"
          || event._tag === "TaskExecutionReported"
      ? event.operationId === operationId
      : event._tag === "TaskExecutionRequestFailed"
      ? event.request.operationId === operationId
      : false
  )

const requestAttemptCanBeCompletedAfterAbsence = (
  records: ReadonlyArray<JournalRecord>,
  operationId: string
): boolean => {
  const hasAttempt = records.some(({ event }) =>
    event._tag === "TaskExecutionRequestAttemptRecorded"
    && event.request.operationId === operationId
  )
  const hasCrossingEvidence = records.some(({ event }) =>
    event._tag === "TaskExecutionRequestReturned"
      ? event.operationId === operationId
      : event._tag === "TaskExecutionRequestFailed"
      ? event.request.operationId === operationId
      : event._tag === "TaskExecutionReported"
      ? event.operationId === operationId && event.report._tag !== "NoTaskExecutionReported"
      : false
  )
  return hasAttempt && !hasCrossingEvidence
}

const durableExecutionReports = Effect.fn("WorkflowJournal.requireConsistentExecutionReports")(
  function*(records: ReadonlyArray<JournalRecord>, operationId: ExecuteTaskWorkOperation["request"]["operationId"]) {
    const reports = records.flatMap(({ event }) =>
      event._tag === "TaskExecutionReported"
        && event.operationId === operationId
        ? [event.report]
        : []
    )
    const processReports = reports.filter(hasWorkerProcess)
    const processReport = processReports[0]
    if (processReport !== undefined) {
      const replacement = processReports.find((report) => report.processId !== processReport.processId)
      if (replacement !== undefined) {
        return yield* new TaskExecutionReportContradiction({
          durableReport: processReport,
          freshReport: replacement,
          operationId
        })
      }
    }
    const terminalReports = reports.filter(isTerminalExecutionReport)
    const terminalReport = terminalReports[0]
    if (terminalReport !== undefined) {
      const conflicting = terminalReports.find((report) => !sameExecutionReport(terminalReport, report))
      if (conflicting !== undefined) {
        return yield* new TaskExecutionReportContradiction({
          durableReport: terminalReport,
          freshReport: conflicting,
          operationId
        })
      }
    }
    return { processReport, terminalReport }
  }
)

const requireEstablishedSession = Effect.fn("WorkflowJournal.requireEstablishedSession")(
  function*(
    records: ReadonlyArray<JournalRecord>,
    operation: ExecuteTaskWorkOperation
  ) {
    if (operation.request.session._tag !== "EstablishedSession") return
    const establishments = records.flatMap(({ event }) =>
      event._tag === "TaskWorkSessionEstablishmentIntentRecorded"
        && operation.predecessorOperationIds.includes(event.operation.request.operationId)
        ? [event.operation]
        : []
    )
    const establishment = establishments[0]
    if (establishment === undefined || establishments.length !== 1) {
      return yield* new TaskExecutionHistoryContradiction({
        operationId: operation.request.operationId,
        reason: establishment === undefined ? "MissingSessionIntent" : "MultipleSessionIntents"
      })
    }
    if (!samePlannedTaskAttempt(establishment.request.plannedAttempt, operation.request.plannedAttempt)) {
      return yield* new TaskExecutionHistoryContradiction({
        operationId: operation.request.operationId,
        reason: "AttemptMismatch"
      })
    }
    const outcomes = records.flatMap(({ event }) =>
      event._tag === "TaskWorkSessionEstablished"
        && event.outcome.operationId === establishment.request.operationId
        ? [event.outcome]
        : []
    )
    if (outcomes.length !== 1) {
      return yield* new TaskExecutionHistoryContradiction({
        operationId: operation.request.operationId,
        reason: outcomes.length === 0 ? "MissingSessionOutcome" : "MultipleSessionOutcomes"
      })
    }
    if (outcomes[0]?.sessionId !== operation.request.session.sessionId) {
      return yield* new TaskExecutionHistoryContradiction({
        operationId: operation.request.operationId,
        reason: "SessionMismatch"
      })
    }
  }
)

interface JournaledTaskExecutionDependencies {
  readonly executor: TaskExecutorService
  readonly journal: JournalStoreService
  readonly runId: RunId
  readonly trace: Parameters<typeof taskExecutionTraceObserver>[1]
}

/** Decorates exact process execution with durable intent and fresh observations. */
export const makeJournaledTaskExecution = (
  dependencies: JournaledTaskExecutionDependencies
) =>
  Effect.fn("WorkflowInterpreter.Journaled.executeTaskWork")(function*(operation) {
    const { executor, journal, runId, trace } = dependencies
    if (operation.request.plannedAttempt.runId !== runId) {
      return yield* new TaskExecutionRunContradiction({
        journalRunId: runId,
        operationId: operation.request.operationId,
        plannedAttemptRunId: operation.request.plannedAttempt.runId
      })
    }
    const records = yield* journal.read(runId)
    yield* requireEstablishedSession(records, operation)
    const hasIntent = yield* requireExactIntent(records, operation)
    const existing = records.find(({ event }) =>
      event._tag === "TaskExecutionOutcomeObserved"
      && event.outcome.outcome.operationId === operation.request.operationId
    )?.event
    if (existing?._tag === "TaskExecutionOutcomeObserved") {
      if (!hasIntent) {
        return yield* new TaskExecutionHistoryContradiction({
          operationId: operation.request.operationId,
          reason: "OutcomeWithoutIntent"
        })
      }
      return existing.outcome
    }

    const key = intentRecordKey(operation.request.operationId)
    yield* journal.append(
      runId,
      key,
      TaskExecutionIntentRecorded.make({ operation, version: 3 })
    )
    const durableReports = yield* durableExecutionReports(records, operation.request.operationId)
    const traceObserver = taskExecutionTraceObserver(operation, trace)
    const observer = {
      requestAttempted: Effect.fn("WorkflowJournal.taskExecutionRequestAttempted")(
        function*(request) {
          yield* journal.append(
            runId,
            taskExecutionRequestAttemptRecordKey(request.operationId),
            TaskExecutionRequestAttemptRecorded.make({ request, version: 3 })
          )
        }
      ),
      observationFailed: Effect.fn("WorkflowJournal.taskExecutionObservationFailed")(
        function*(lookup, failure) {
          yield* journal.append(
            runId,
            taskExecutionObservationFailedRecordKey(lookup.operationId, failure.observationId),
            TaskExecutionObservationFailed.make({
              failure,
              operationId: lookup.operationId,
              version: 3
            })
          )
          yield* traceObserver.observationFailed(lookup, failure)
        }
      ),
      outcomeReported: Effect.fn("WorkflowJournal.taskExecutionReported")(
        function*(lookup, report) {
          if (
            durableReports.processReport !== undefined
            && hasWorkerProcess(report)
            && durableReports.processReport.processId !== report.processId
          ) {
            return yield* new TaskExecutionReportContradiction({
              durableReport: durableReports.processReport,
              freshReport: report,
              operationId: lookup.operationId
            })
          }
          if (
            durableReports.terminalReport !== undefined
            && !sameExecutionReport(durableReports.terminalReport, report)
          ) {
            return yield* new TaskExecutionReportContradiction({
              durableReport: durableReports.terminalReport,
              freshReport: report,
              operationId: lookup.operationId
            })
          }
          yield* journal.append(
            runId,
            taskExecutionReportedRecordKey(lookup.operationId, report.observationId),
            TaskExecutionReported.make({
              operationId: lookup.operationId,
              report,
              version: 3
            })
          )
          yield* traceObserver.outcomeReported(lookup, report)
        }
      ),
      requestFailed: Effect.fn("WorkflowJournal.taskExecutionRequestFailed")(
        function*(request, failure) {
          yield* journal.append(
            runId,
            taskExecutionRequestFailedRecordKey(request.operationId, failure.observationId),
            TaskExecutionRequestFailed.make({ failure, request, version: 3 })
          )
          yield* traceObserver.requestFailed(request, failure)
        }
      ),
      requestReturned: Effect.fn("WorkflowJournal.taskExecutionRequestReturned")(
        function*(request, acknowledgement) {
          yield* journal.append(
            runId,
            taskExecutionRequestReturnedRecordKey(request.operationId, acknowledgement.observationId),
            TaskExecutionRequestReturned.make({
              acknowledgement,
              operationId: request.operationId,
              version: 3
            })
          )
          yield* traceObserver.requestReturned(request, acknowledgement)
        }
      )
    }
    const observed = yield* runTaskExecutionProtocol(
      executor,
      operation,
      !hasIntent || !requestAmbiguityBegan(records, operation.request.operationId),
      observer,
      hasIntent
        && requestAttemptCanBeCompletedAfterAbsence(records, operation.request.operationId)
    )
    const outcome = WorkflowOutcome.cases.TaskExecutionObserved.make({ outcome: observed })
    yield* journal.append(
      runId,
      outcomeRecordKey(operation.request.operationId),
      TaskExecutionOutcomeObservedEvent.make({ outcome, version: 3 })
    )
    return outcome
  })
