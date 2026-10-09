import {
  DeliveryDiagnosticAttemptBaseAdmission,
  DeliveryDiagnosticAuthorityEvidence,
  DeliveryDiagnosticExecutorEvidence
} from "./delivery-diagnostic-evidence.js"
import { plannedAttemptWorktreeObservationMatchesPlan } from "../../workflow/protocols/planned-attempt-worktree-observation/protocol.js"
import { acceptedAttemptBasePolicy } from "../admission/fresh-attempt-lineage.js"
import { intentRecordKey, outcomeRecordKey } from "../../workflow-journal/record-key.js"
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
  plannedTaskAttemptEquivalence,
  type PlannedAttemptExecutorReport
} from "@dalph/contracts"
import { Schema } from "effect"
import { TrackerReadRetryEvidence } from "../../authorities/task-tracker/graph-reader.js"
import { taskTrackerTargetKey, type TrackerTarget } from "../../authorities/task-tracker/target.js"
import { TrackerTaskDescriptor } from "../../authorities/task-tracker/task.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import {
  journalRecordByKey,
  journalRecordsOfKind,
  type JournalHistorySource
} from "../../workflow-journal/record-evidence.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import type { TrackerGraphState } from "./relations.js"

/** Transient descriptions of accepted history. These values authorize no action. */
export const DeliveryDiagnostics = Schema.Struct({
  runId: RunId,
  attemptBaseAdmission: Schema.optionalKey(DeliveryDiagnosticAttemptBaseAdmission),
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
      authorityEvidence: Schema.optionalKey(DeliveryDiagnosticAuthorityEvidence),
      executorEvidence: Schema.optionalKey(DeliveryDiagnosticExecutorEvidence),
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
  "PlannedAttemptExecutorStateObserved",
  "PlannedAttemptExecutorCommandProjectionObserved",
  "PlannedAttemptExecutorCommandResponseContradicted",
  "TaskTrackerFactsObserved",
  "PlannedAttemptWorktreeObserved",
  "TargetLineageObserved",
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
  type AuthorityEvidence = NonNullable<TaskDiagnostic["authorityEvidence"]>["gitWorktree"]
  const gitEvidence = new Map<string, AuthorityEvidence>()
  const claimEvidence = new Map<TaskId, Map<string, NonNullable<AuthorityEvidence>>>()
  const evidenceContent = new Map<string, string>()
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
      if (observation._tag === "FocusedTaskClaimFacts" || observation._tag === "FocusedTaskClaimFactsUnreadable") {
        const taskId = observation.coverage.taskId
        const kind = observation._tag === "FocusedTaskClaimFacts" ? observation.observation._tag : observation._tag
        const key = `claim:${taskId}:${observation.operationId}`
        const content =
          observation._tag === "FocusedTaskClaimFacts"
            ? JSON.stringify([observation.operationId, observation.observation])
            : JSON.stringify([observation.operationId, kind])
        if (evidenceContent.get(key) !== content) {
          evidenceContent.set(key, content)
          const reads = claimEvidence.get(taskId) ?? new Map<string, NonNullable<AuthorityEvidence>>()
          reads.set(observation.operationId, { kind, observedAt: position, operationId: observation.operationId })
          claimEvidence.set(taskId, reads)
        }
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
    if (event._tag === "PlannedAttemptWorktreeObserved" || event._tag === "TargetLineageObserved") {
      const intent = journalRecordByKey(history, intentRecordKey(event.operationId))
      if (intent?.runId !== runId || intent.event._tag !== "GitReadIntentRecorded") continue
      const planned = intent.event.operation.plannedAttempt
      if (
        event._tag === "PlannedAttemptWorktreeObserved" &&
        (intent.event.operation._tag !== "ReadTaskWorktree" ||
          !plannedAttemptWorktreeObservationMatchesPlan(event.observation, planned))
      )
        continue
      if (
        event._tag === "TargetLineageObserved" &&
        (intent.event.operation._tag !== "ReadTargetLineage" ||
          !plannedTaskAttemptEquivalence(event.plannedAttempt, planned) ||
          event.observation.plannedBaseSha !== planned.baseSha)
      )
        continue
      const key = `${plannedAttemptExecutorCorrelationKey(planned)}:${event._tag}`
      const kind =
        event._tag === "PlannedAttemptWorktreeObserved"
          ? event.observation._tag
          : event.observation.plannedBaseIsAncestorOfTargetHead
            ? "TargetDescendsFromPlannedBase"
            : "TargetRewrite"
      const content = JSON.stringify([event.operationId, event.observation])
      if (evidenceContent.get(key) !== content) {
        evidenceContent.set(key, content)
        gitEvidence.set(key, { kind, observedAt: position, operationId: event.operationId })
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
        executorEvidence: { kind: "ResponsibilityRecorded", observedAt: position },
        identity: { _tag: "Unavailable" },
        failure: { _tag: "None" },
        recovery: { _tag: "NotApplicable" }
      })
    } else if (
      event._tag === "PlannedAttemptExecutorStateObserved" ||
      event._tag === "PlannedAttemptExecutorCommandProjectionObserved" ||
      event._tag === "PlannedAttemptExecutorCommandResponseContradicted"
    ) {
      const key = plannedAttemptExecutorCorrelationKey(event.plannedAttempt)
      const task = attempts.get(key)
      const planned = plannedAttempts.get(key)
      if (task === undefined || planned === undefined || !plannedTaskAttemptEquivalence(planned, event.plannedAttempt))
        continue
      const kind =
        event._tag === "PlannedAttemptExecutorCommandResponseContradicted"
          ? "ExecutorReportContradiction"
          : event.observation._tag
      if (kind === "ExactExecutorReport" || kind === "ExecutorBeginNotCrossed") continue
      const content =
        event._tag === "PlannedAttemptExecutorCommandResponseContradicted"
          ? JSON.stringify({ kind, observed: event.observed })
          : JSON.stringify(event.observation)
      const evidenceKey = `executor:${key}`
      if (evidenceContent.get(evidenceKey) === content && task.executorEvidence?.kind === kind) continue
      evidenceContent.set(evidenceKey, content)
      attempts.set(key, { ...task, executorEvidence: { kind, observedAt: position } })
    } else if (event._tag === "PlannedAttemptExecutorWorkReported" && event.report.correlation.runId === runId) {
      const report = event.report
      const key = plannedAttemptExecutorCorrelationKey(report.correlation)
      const task = attempts.get(key)
      const previous = reports.get(key)
      if (task === undefined) continue
      if (previous !== undefined && samePlannedAttemptExecutorReport(previous, report)) {
        if (task.executorEvidence?.kind !== report._tag)
          attempts.set(key, { ...task, executorEvidence: { kind: report._tag, observedAt: position } })
        continue
      }
      reports.set(key, report)
      const result = report._tag === "ExecutorWorkTerminal" ? report.result : null
      const plannedAttempt = plannedAttempts.get(key)
      if (report._tag === "ExecutorWorkResultRejected") {
        if (plannedAttempt === undefined) continue
        attempts.set(key, {
          ...task,
          phase: "Rejected",
          executorEvidence: { kind: report._tag, observedAt: position },
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
        executorEvidence: { kind: report._tag, observedAt: position },
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
  const refused = Array.from(journalRecordsOfKind(history, "TaskAttemptBaseReadIntended")).flatMap(
    ({ event, runId: recordRunId }) => {
      if (event._tag !== "TaskAttemptBaseReadIntended" || recordRunId !== runId) return []
      const observed = journalRecordByKey(history, outcomeRecordKey(event.operation.operationId))
      return observed?.runId === runId &&
        observed.event._tag === "TaskAttemptBaseObserved" &&
        observed.event.observation._tag === "Refused"
        ? [
            {
              taskId: event.operation.taskId,
              operationId: event.operation.operationId,
              observedAt: observed.position,
              boundary: observed.event.observation.boundary,
              detail: "Exact attempt Base qualification refused"
            }
          ]
        : []
    }
  )
  return {
    runId,
    ...(acceptedAttemptBasePolicy(
      Array.from(journalRecordsOfKind(history, "WorkflowRunBegan")).filter((record) => record.runId === runId)
    ) === undefined
      ? { attemptBaseAdmission: { _tag: "HistoricalPolicyUnspecified" as const } }
      : refused.length === 0
        ? {}
        : { attemptBaseAdmission: { _tag: "QualificationRefused" as const, refusals: refused } }),
    trackerWait,
    tasks: [...attempts.values()]
      .map((task): TaskDiagnostic => {
        const descriptor = descriptors.find(({ id }) => id === task.taskId)?.descriptor
        const title = titles.get(task.taskId)
        const retainedDescriptor = retainedDescriptors.get(task.taskId)
        return {
          ...task,
          authorityEvidence: {
            gitWorktree:
              gitEvidence.get(
                `${plannedAttemptExecutorCorrelationKey(task.retainedAttempt)}:PlannedAttemptWorktreeObserved`
              ) ?? null,
            gitLineage:
              gitEvidence.get(`${plannedAttemptExecutorCorrelationKey(task.retainedAttempt)}:TargetLineageObserved`) ??
              null,
            claim: Array.from(claimEvidence.get(task.taskId)?.values() ?? [])
          },
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
