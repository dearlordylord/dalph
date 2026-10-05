import { ResultRecoverySubject } from "../../workflow/protocols/result-recovery/events.js"
/* eslint-disable functional/immutable-data -- Local reconstruction scratch is never persisted or exposed. */
import {
  AttemptId,
  GitCommitSha,
  TaskBranchRef,
  WorktreeLocator,
  PlannedAttemptExecutorFailureCode,
  PlannedAttemptRejectedResultReport,
  type PlannedTaskAttempt,
  RunId,
  TaskId,
  plannedAttemptExecutorCorrelationKey,
  samePlannedAttemptExecutorReport,
  type PlannedAttemptExecutorReport
} from "@dalph/contracts"
import { Schema } from "effect"
import { TrackerReadRetryEvidence } from "../../authorities/task-tracker/graph-reader.js"
import { taskTrackerTargetKey, type TrackerTarget } from "../../authorities/task-tracker/target.js"
import { TrackerTaskDescriptor } from "../../authorities/task-tracker/task.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { journalRecordsOfKind, type JournalHistorySource } from "../../workflow-journal/record-evidence.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import type { TrackerGraphState } from "./relations.js"

/** Transient descriptions of accepted history. These values authorize no action. */
export const DeliveryDiagnostics = Schema.Struct({
  runId: RunId,
  trackerWait: Schema.TaggedUnion({
    None: {},
    Throttled: { observedAt: JournalPosition, retry: TrackerReadRetryEvidence },
    CircuitOpen: { observedAt: JournalPosition, retry: TrackerReadRetryEvidence },
    ReadUnavailable: { observedAt: JournalPosition }
  }),
  tasks: Schema.Array(
    Schema.Struct({
      taskId: TaskId,
      identity: Schema.TaggedUnion({
        Unavailable: {},
        Known: { descriptor: TrackerTaskDescriptor, observedAt: JournalPosition }
      }),
      phase: Schema.Literals([
        "Preparing",
        "Executing",
        "Suspended",
        "Rejected",
        "Failed",
        "ExecutorCompleted",
        "Accepted",
        "Integrating",
        "Delivered"
      ]),
      lastSubstantiveAt: JournalPosition,
      retainedAttempt: Schema.Struct({
        attemptId: AttemptId,
        runId: RunId,
        taskId: TaskId,
        baseSha: GitCommitSha,
        branch: TaskBranchRef,
        worktree: WorktreeLocator
      }),
      candidateHead: Schema.TaggedUnion({
        Unavailable: {},
        Observed: { commit: GitCommitSha, observedAt: JournalPosition }
      }),
      failure: Schema.TaggedUnion({ None: {}, Unavailable: {}, Known: { code: PlannedAttemptExecutorFailureCode } }),
      recovery: Schema.TaggedUnion({
        NotApplicable: {},
        RestartOnly: { subject: ResultRecoverySubject.cases.HistoricalUnknownFailure },
        ExplicitDirectionRequired: {
          rejection: PlannedAttemptRejectedResultReport,
          subject: ResultRecoverySubject.cases.RejectedResult
        },
        Unavailable: { reason: Schema.Literal("ExecutorFailureRecoveryNotImplemented") }
      })
    })
  )
}).check(
  Schema.makeFilter(({ tasks }) =>
    tasks.every((task) => {
      const recovery = task.recovery
      if (recovery._tag !== "RestartOnly" && recovery._tag !== "ExplicitDirectionRequired") return true
      const attempt = recovery.subject.plannedAttempt
      const retained = task.retainedAttempt
      const bound =
        attempt.attemptId === retained.attemptId &&
        attempt.runId === retained.runId &&
        attempt.taskId === task.taskId &&
        attempt.taskId === retained.taskId &&
        attempt.baseSha === retained.baseSha &&
        attempt.branch === retained.branch &&
        attempt.worktree === retained.worktree
      return (
        bound &&
        (recovery._tag === "RestartOnly"
          ? task.phase === "Failed" && task.failure._tag === "Unavailable"
          : task.phase === "Rejected" &&
            task.failure._tag === "None" &&
            recovery.rejection.correlation.attemptId === retained.attemptId &&
            recovery.rejection.correlation.runId === retained.runId)
      )
    })
      ? undefined
      : "recovery diagnostics must belong to the retained attempt and failure kind"
  )
)
export type DeliveryDiagnostics = typeof DeliveryDiagnostics.Type

type TaskDiagnostic = DeliveryDiagnostics["tasks"][number]
const kinds: ReadonlyArray<JournalRecord["event"]["_tag"]> = [
  "PlannedAttemptExecutorWorkResponsibilityBegan",
  "PlannedAttemptExecutorWorkReported",
  "TaskTrackerFactsObserved",
  "IntegratorSessionFixed",
  "IntegrationFinalitySettled"
]
/** Reads accepted facts only; repeated executor reports cannot manufacture substantive progress. */
export const projectDeliveryDiagnostics = (
  runId: RunId,
  history: JournalHistorySource,
  graph?: TrackerGraphState,
  target?: TrackerTarget
): DeliveryDiagnostics => {
  const matchesTarget = (observed: TrackerTarget) =>
    target === undefined || taskTrackerTargetKey(observed) === taskTrackerTargetKey(target)
  let trackerWait: DeliveryDiagnostics["trackerWait"] = { _tag: "None" }
  const attempts = new Map<string, TaskDiagnostic>()
  const plannedAttempts = new Map<string, PlannedTaskAttempt>()
  const reports = new Map<string, PlannedAttemptExecutorReport>()
  const retainedDescriptors = new Map<
    TaskId,
    { readonly descriptor: TrackerTaskDescriptor; readonly observedAt: JournalPosition }
  >()
  const titles = new Map<TaskId, { readonly title: string; readonly observedAt: JournalPosition }>()
  const records = kinds
    .flatMap((kind) => Array.from(journalRecordsOfKind(history, kind)))
    .filter((record) => record.runId === runId)
    .toSorted((left, right) => left.position - right.position)
  for (const { event, position } of records) {
    if (event._tag === "TaskTrackerFactsObserved" && matchesTarget(event.observation.target)) {
      const observation = event.observation
      if (observation._tag === "CompleteTaskTrackerFacts") {
        for (const { descriptor, taskId } of observation.factFamilies[0].descriptors ?? [])
          retainedDescriptors.set(taskId, { descriptor, observedAt: position })
      }
      if (observation._tag === "TaskTrackerFactsReadFailed") {
        const reason = observation.failure._tag === "TrackerAdapterReadError" ? observation.failure.reason : null
        trackerWait =
          reason?._tag === "Throttled"
            ? { _tag: "Throttled", observedAt: position, retry: reason.retry ?? { _tag: "Unavailable" } }
            : reason?._tag === "CircuitOpen"
              ? { _tag: "CircuitOpen", observedAt: position, retry: { _tag: "Unavailable" } }
              : { _tag: "ReadUnavailable", observedAt: position }
      } else if (
        observation._tag === "CompleteTaskTrackerFacts" ||
        observation._tag === "UnchangedTaskTrackerFactsReconfirmed"
      ) {
        trackerWait = { _tag: "None" }
      }
    }
    if (
      event._tag === "TaskTrackerFactsObserved" &&
      matchesTarget(event.observation.target) &&
      event.observation._tag === "FocusedTaskWorkSpecificationFacts"
    ) {
      const fact = event.observation.factFamily
      titles.set(fact.taskId, { title: fact.title, observedAt: position })
    } else if (event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" && event.plannedAttempt.runId === runId) {
      const attempt = event.plannedAttempt
      plannedAttempts.set(plannedAttemptExecutorCorrelationKey(attempt), attempt)
      attempts.set(plannedAttemptExecutorCorrelationKey(attempt), {
        taskId: attempt.taskId,
        retainedAttempt: {
          attemptId: attempt.attemptId,
          runId: attempt.runId,
          taskId: attempt.taskId,
          baseSha: attempt.baseSha,
          branch: attempt.branch,
          worktree: attempt.worktree
        },
        candidateHead: { _tag: "Unavailable" },
        phase: "Preparing",
        lastSubstantiveAt: position,
        identity: { _tag: "Unavailable" },
        failure: { _tag: "None" },
        recovery: { _tag: "NotApplicable" }
      })
    } else if (event._tag === "PlannedAttemptExecutorWorkReported" && event.report.correlation.runId === runId) {
      const report = event.report
      const key = plannedAttemptExecutorCorrelationKey(report.correlation)
      const task = attempts.get(key)
      const previous = reports.get(key)
      if (task === undefined || (previous !== undefined && samePlannedAttemptExecutorReport(previous, report))) continue
      reports.set(key, report)
      const result = report._tag === "ExecutorWorkTerminal" ? report.result : null
      const plannedAttempt = plannedAttempts.get(key)
      if (report._tag === "ExecutorWorkResultRejected") {
        if (plannedAttempt === undefined) continue
        attempts.set(key, {
          ...task,
          phase: "Rejected",
          lastSubstantiveAt: position,
          failure: { _tag: "None" },
          recovery: {
            _tag: "ExplicitDirectionRequired",
            rejection: report,
            subject: ResultRecoverySubject.cases.RejectedResult.make({ plannedAttempt, reportOrdinal: event.ordinal })
          }
        })
        continue
      }
      attempts.set(key, {
        ...task,
        lastSubstantiveAt: position,
        phase:
          result === null
            ? report._tag === "ExecutorWorkExecuting"
              ? "Executing"
              : "Suspended"
            : result._tag === "Completed"
              ? "ExecutorCompleted"
              : result._tag,
        candidateHead:
          result?._tag === "Failed" && result.observedHead !== undefined
            ? { _tag: "Observed", commit: result.observedHead, observedAt: position }
            : task.candidateHead,
        recovery:
          result?._tag === "Failed"
            ? result.failureCode === undefined && plannedAttempt !== undefined
              ? {
                  _tag: "RestartOnly",
                  subject: ResultRecoverySubject.cases.HistoricalUnknownFailure.make({
                    plannedAttempt,
                    reportOrdinal: event.ordinal
                  })
                }
              : { _tag: "Unavailable", reason: "ExecutorFailureRecoveryNotImplemented" }
            : { _tag: "NotApplicable" },
        failure:
          result?._tag === "Failed"
            ? result.failureCode === undefined
              ? { _tag: "Unavailable" }
              : { _tag: "Known", code: result.failureCode }
            : { _tag: "None" }
      })
    } else if (event._tag === "IntegratorSessionFixed" && event.correlation.plannedAttempt.runId === runId) {
      const key = plannedAttemptExecutorCorrelationKey(event.correlation.plannedAttempt)
      const task = attempts.get(key)
      if (task !== undefined) attempts.set(key, { ...task, phase: "Integrating", lastSubstantiveAt: position })
    } else if (event._tag === "IntegrationFinalitySettled" && event.claim.plannedAttempt.runId === runId) {
      const key = plannedAttemptExecutorCorrelationKey(event.claim.plannedAttempt)
      const task = attempts.get(key)
      if (task !== undefined) attempts.set(key, { ...task, phase: "Delivered", lastSubstantiveAt: position })
    }
  }
  const descriptors = graph?._tag === "GraphEstablished" ? graph.observation.snapshot.toWire().tasks : []
  return {
    runId,
    trackerWait,
    tasks: [...attempts.values()]
      .map((task): TaskDiagnostic => {
        const descriptor = descriptors.find(({ id }) => id === task.taskId)?.descriptor
        const title = titles.get(task.taskId)
        const retainedDescriptor = retainedDescriptors.get(task.taskId)
        return {
          ...task,
          identity:
            descriptor !== undefined && graph?._tag === "GraphEstablished"
              ? { _tag: "Known", descriptor, observedAt: graph.observation.recordedAt }
              : retainedDescriptor !== undefined
                ? { _tag: "Known", ...retainedDescriptor }
                : title === undefined
                  ? { _tag: "Unavailable" }
                  : { _tag: "Known", descriptor: { title: title.title }, observedAt: title.observedAt }
        }
      })
      .toSorted(
        (left, right) =>
          left.taskId.localeCompare(right.taskId) ||
          left.retainedAttempt.attemptId.localeCompare(right.retainedAttempt.attemptId)
      )
  }
}
