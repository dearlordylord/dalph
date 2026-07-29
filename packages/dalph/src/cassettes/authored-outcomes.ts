import { Schema } from "effect"
import {
  AttemptId,
  GitCommitSha,
  PlannedAttemptExecutorReport,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import {
  ClaimOwner,
  type JournalRecord,
  PlannedWorktreeReady,
  TaskLifecycle,
  TrackerRevision,
  TrackerTarget,
  type TraceItem
} from "@dalph/orchestrator"

const AuthoredObservationCount = Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0)))

const AuthoredTrackerTask = Schema.Struct({
  id: TaskId,
  lifecycle: TaskLifecycle,
  parentTaskId: Schema.NullOr(TaskId),
  prerequisiteIds: Schema.Array(TaskId)
})

/** Provider-neutral tracker facts a domain specialist can read and author. */
export const AuthoredTrackerGraph = Schema.Struct({
  revision: TrackerRevision,
  tasks: Schema.Array(AuthoredTrackerTask)
})
export type AuthoredTrackerGraph = typeof AuthoredTrackerGraph.Type

/**
 * Domain outcomes an authored story requires Dalph or an authoritative
 * boundary to establish. These are assertions over production evidence, not a
 * second universal event vocabulary.
 */
export const AuthoredExpectedOutcomeAssertion = Schema.TaggedUnion({
  DalphClaimsTask: { owner: ClaimOwner, taskId: TaskId },
  DalphObservesTaskTrackerGraph: {
    graph: AuthoredTrackerGraph,
    observationCount: AuthoredObservationCount,
    target: TrackerTarget
  },
  DalphRecordsTaskAttemptPlan: {
    attemptId: AttemptId,
    baseSha: GitCommitSha,
    branch: TaskBranchRef,
    executor: TaskExecutorLocator,
    runId: RunId,
    taskId: TaskId,
    taskRevision: TaskRevision,
    worktree: WorktreeLocator
  },
  DalphRecordsExecutorReportsForAttempt: { attemptId: AttemptId, reports: Schema.Array(PlannedAttemptExecutorReport) },
  GitShowsWorktreeReadyForAttempt: { attemptId: AttemptId, proof: PlannedWorktreeReady, taskId: TaskId },
  DalphReconstructsValidWorkflowJournalHistory: {}
})
export type AuthoredExpectedOutcomeAssertion = typeof AuthoredExpectedOutcomeAssertion.Type

/** Domain outcomes the authored story expressly forbids. */
export const AuthoredForbiddenOutcomeAssertion = Schema.TaggedUnion({
  DalphMustNotAssumeExecutorWorkResponsibilityForAnyOtherAttempt: {
    allowedAttemptIds: Schema.Array(AttemptId).check(Schema.isUnique())
  },
  DalphMustNotClaimAnyOtherTask: { allowedTaskIds: Schema.Array(TaskId).check(Schema.isUnique()) },
  DalphMustNotRecordAnyOtherTaskAttemptPlan: { allowedAttemptIds: Schema.Array(AttemptId).check(Schema.isUnique()) },
  DalphMustNotReconcileAnyOtherAttemptWorktree: { allowedAttemptIds: Schema.Array(AttemptId).check(Schema.isUnique()) },
  DalphMustNotRecordControlCommand: {},
  DalphMustNotRecordExecutorReportsForAnyOtherAttempt: {
    allowedAttemptIds: Schema.Array(AttemptId).check(Schema.isUnique())
  }
})
export type AuthoredForbiddenOutcomeAssertion = typeof AuthoredForbiddenOutcomeAssertion.Type

export class AuthoredCassetteOutcomeAssertionMismatch extends Schema.TaggedErrorClass<AuthoredCassetteOutcomeAssertionMismatch>()(
  "AuthoredCassetteOutcomeAssertionMismatch",
  {
    unsatisfiedExpectedOutcomes: Schema.Array(AuthoredExpectedOutcomeAssertion),
    violatedForbiddenOutcomes: Schema.Array(AuthoredForbiddenOutcomeAssertion)
  }
) {}

const structurallyEqual = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right)

const graphFromTraceItem = (
  item: Extract<TraceItem, { readonly _tag: "TaskTrackerFactsObserved" }>
): AuthoredTrackerGraph | undefined => {
  const [identities, lifecycles, prerequisites, groupings] = item.observation.factFamilies
  const tasks = identities.taskIds.flatMap((id) => {
    const lifecycle = lifecycles.lifecycles.find(({ taskId }) => taskId === id)
    const prerequisite = prerequisites.prerequisites.find(({ taskId }) => taskId === id)
    const grouping = groupings.groupings.find(({ taskId }) => taskId === id)
    return lifecycle === undefined || prerequisite === undefined || grouping === undefined
      ? []
      : [
          {
            id,
            lifecycle: lifecycle.lifecycle,
            parentTaskId: grouping.parentTaskId,
            prerequisiteIds: prerequisite.prerequisiteTaskIds
          }
        ]
  })
  if (tasks.length !== identities.taskIds.length) return undefined
  return AuthoredTrackerGraph.make({ revision: identities.contentIdentity, tasks })
}

export interface AuthoredOutcomeEvidence {
  readonly historyIsValid: boolean
  readonly records: ReadonlyArray<JournalRecord>
  readonly traceItems: ReadonlyArray<TraceItem>
}

export const expectedOutcomeIsSatisfied = (
  assertion: AuthoredExpectedOutcomeAssertion,
  evidence: AuthoredOutcomeEvidence
): boolean => {
  switch (assertion._tag) {
    case "DalphObservesTaskTrackerGraph":
      return (
        evidence.traceItems.filter(
          (item) =>
            item._tag === "TaskTrackerFactsObserved" &&
            structurallyEqual(item.observation.target, assertion.target) &&
            structurallyEqual(graphFromTraceItem(item), assertion.graph)
        ).length === assertion.observationCount
      )
    case "DalphClaimsTask":
      return evidence.traceItems.some(
        (item) =>
          item._tag === "TaskClaimAcquired" &&
          item.claim.owner === assertion.owner &&
          item.claim.taskId === assertion.taskId
      )
    case "DalphRecordsTaskAttemptPlan": {
      const { _tag: _assertionTag, ...expectedPlan } = assertion
      return evidence.traceItems.some((item) => {
        if (item._tag !== "TaskAttemptPlanAcknowledged") return false
        const { attemptId, baseSha, branch, executor, runId, taskId, taskRevision, worktree } =
          item.operation.plannedAttempt
        return structurallyEqual(
          { attemptId, baseSha, branch, executor, runId, taskId, taskRevision, worktree },
          expectedPlan
        )
      })
    }
    case "DalphRecordsExecutorReportsForAttempt": {
      const reports = evidence.records.flatMap(({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkReported" &&
        event.report.correlation.attemptId === assertion.attemptId
          ? [event.report]
          : []
      )
      return structurallyEqual(reports, assertion.reports)
    }
    case "GitShowsWorktreeReadyForAttempt":
      return evidence.traceItems.some(
        (item) =>
          item._tag === "TaskWorktreeReady" &&
          item.operation.plannedAttempt.attemptId === assertion.attemptId &&
          item.operation.plannedAttempt.taskId === assertion.taskId &&
          structurallyEqual(item.proof, assertion.proof)
      )
    case "DalphReconstructsValidWorkflowJournalHistory":
      return evidence.historyIsValid
  }
}

export const forbiddenOutcomeIsViolated = (
  assertion: AuthoredForbiddenOutcomeAssertion,
  evidence: AuthoredOutcomeEvidence
): boolean => {
  switch (assertion._tag) {
    case "DalphMustNotRecordControlCommand":
      return evidence.records.some(({ event }) => event._tag === "ControlCommandRecorded")
    case "DalphMustNotClaimAnyOtherTask":
      return evidence.traceItems.some(
        (item) => item._tag === "TaskClaimAcquired" && !assertion.allowedTaskIds.includes(item.claim.taskId)
      )
    case "DalphMustNotRecordAnyOtherTaskAttemptPlan":
      return evidence.traceItems.some(
        (item) =>
          item._tag === "TaskAttemptPlanAcknowledged" &&
          !assertion.allowedAttemptIds.includes(item.operation.plannedAttempt.attemptId)
      )
    case "DalphMustNotReconcileAnyOtherAttemptWorktree":
      return evidence.traceItems.some(
        (item) =>
          item._tag === "TaskWorktreeReady" &&
          !assertion.allowedAttemptIds.includes(item.operation.plannedAttempt.attemptId)
      )
    case "DalphMustNotAssumeExecutorWorkResponsibilityForAnyOtherAttempt":
      return evidence.records.some(({ event }) => {
        return (
          event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
          !assertion.allowedAttemptIds.includes(event.plannedAttempt.attemptId)
        )
      })
    case "DalphMustNotRecordExecutorReportsForAnyOtherAttempt":
      return evidence.records.some(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkReported" &&
          !assertion.allowedAttemptIds.includes(event.report.correlation.attemptId)
      )
  }
}

export const lyricForExpectedOutcome = (outcome: AuthoredExpectedOutcomeAssertion): string => {
  switch (outcome._tag) {
    case "DalphObservesTaskTrackerGraph":
      return `Dalph must observe graph revision ${outcome.graph.revision} for ${outcome.graph.tasks.length} tasks ${outcome.observationCount} times.`
    case "DalphClaimsTask":
      return `Dalph must claim task ${outcome.taskId} for ${outcome.owner}.`
    case "DalphRecordsTaskAttemptPlan":
      return `Dalph must durably record attempt plan ${outcome.attemptId} for task ${outcome.taskId} at revision ${outcome.taskRevision}.`
    case "DalphRecordsExecutorReportsForAttempt":
      return `Dalph must record ${outcome.reports.length} executor reports for attempt ${outcome.attemptId}.`
    case "GitShowsWorktreeReadyForAttempt":
      return `Git must show worktree ${outcome.proof.worktree} ready for attempt ${outcome.attemptId}.`
    case "DalphReconstructsValidWorkflowJournalHistory":
      return "Dalph must reconstruct a valid workflow-journal history."
  }
}

export const lyricForForbiddenOutcome = (outcome: AuthoredForbiddenOutcomeAssertion): string => {
  switch (outcome._tag) {
    case "DalphMustNotRecordControlCommand":
      return "Dalph must not record an operator control command."
    case "DalphMustNotClaimAnyOtherTask":
      return `Dalph must not claim a task outside ${outcome.allowedTaskIds.join(", ")}.`
    case "DalphMustNotRecordAnyOtherTaskAttemptPlan":
      return `Dalph must not durably record an attempt plan outside ${outcome.allowedAttemptIds.join(", ")}.`
    case "DalphMustNotReconcileAnyOtherAttemptWorktree":
      return `Dalph must not reconcile a worktree outside ${outcome.allowedAttemptIds.join(", ")}.`
    case "DalphMustNotAssumeExecutorWorkResponsibilityForAnyOtherAttempt":
      return `Dalph must not assume executor-work responsibility outside ${outcome.allowedAttemptIds.join(", ")}.`
    case "DalphMustNotRecordExecutorReportsForAnyOtherAttempt":
      return `Dalph must not record executor reports outside ${outcome.allowedAttemptIds.join(", ")}.`
  }
}
