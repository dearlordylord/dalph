import type { RunId } from "@dalph/contracts"
import { HashMap, Match } from "effect"
import type { WorkflowJournalEvent } from "../../workflow/registry/event.js"
import { targetPromotionRunIdOf } from "../../workflow/protocols/target-promotion/events.js"

/** Adds one causal fact without mutating the accepted prefix's index. */
export const setMapValue = <K, V>(map: HashMap.HashMap<K, V>, key: K, value: V): HashMap.HashMap<K, V> =>
  HashMap.set(map, key, value)

type TargetPromotionRunBindingEvent = Extract<
  WorkflowJournalEvent,
  {
    readonly _tag:
      | "TargetPromotionIntended"
      | "TargetPromotionAttemptIntended"
      | "TargetPromotionObservedSuccess"
      | "TargetPromotionStale"
      | "TargetPromotionNonConvergence"
  }
>

const invalidTargetPromotionRunBinding = (event: TargetPromotionRunBindingEvent, runId: RunId): string | undefined =>
  targetPromotionRunIdOf(event.correlation) === runId
    ? undefined
    : `target promotion binds run ${targetPromotionRunIdOf(event.correlation)}`

const invalidNestedRunBinding = (
  label: string,
  nestedRunIds: ReadonlyArray<RunId>,
  runId: RunId
): string | undefined => {
  const foreignRunId = nestedRunIds.find((nestedRunId) => nestedRunId !== runId)
  return foreignRunId === undefined ? undefined : `${label} binds run ${foreignRunId}`
}

const invalidAttemptChoiceRunBinding = (
  event: {
    readonly requestId: { readonly runId: RunId }
    readonly subject: { readonly plannedAttempt: { readonly runId: RunId } }
  },
  runId: RunId,
  label: string
): string | undefined =>
  invalidNestedRunBinding(label, [event.requestId.runId, event.subject.plannedAttempt.runId], runId)

const invalidCompletionTaskClaimRunBinding = (
  claim: { readonly plannedAttempt: { readonly runId: RunId } },
  runId: RunId,
  label: string
): string | undefined => invalidNestedRunBinding(label, [claim.plannedAttempt.runId], runId)

const invalidCompletionTaskRunBinding = (
  event: { readonly request: { readonly claim: { readonly plannedAttempt: { readonly runId: RunId } } } },
  runId: RunId,
  label: string
): string | undefined => invalidCompletionTaskClaimRunBinding(event.request.claim, runId, label)

const invalidCompletionTaskRequestLookupRunBinding = (
  event: {
    readonly request: { readonly claim: { readonly plannedAttempt: { readonly runId: RunId } } }
    readonly lookup: { readonly request: { readonly claim: { readonly plannedAttempt: { readonly runId: RunId } } } }
  },
  runId: RunId,
  label: string
): string | undefined =>
  invalidNestedRunBinding(
    label,
    [event.request.claim.plannedAttempt.runId, event.lookup.request.claim.plannedAttempt.runId],
    runId
  )

type WorktreeCleanupBindingEvent = Extract<
  WorkflowJournalEvent,
  {
    readonly _tag:
      | "WorktreeCleanupAuthorized"
      | "WorktreeCleanupObservationIntended"
      | "WorktreeCleanupObserved"
      | "WorktreeCleanupAbsenceConfirmed"
      | "WorktreeCleanupMutationIntended"
      | "WorktreeCleanupMutationResultRecorded"
      | "WorktreeCleanupContradicted"
      | "WorktreeCleanupSettled"
  }
>

const worktreeCleanupBindingLabels = {
  WorktreeCleanupAuthorized: "worktree cleanup authorization",
  WorktreeCleanupObservationIntended: "worktree cleanup observation",
  WorktreeCleanupObserved: "worktree cleanup observation",
  WorktreeCleanupAbsenceConfirmed: "worktree cleanup absence",
  WorktreeCleanupMutationIntended: "worktree cleanup mutation",
  WorktreeCleanupMutationResultRecorded: "worktree cleanup mutation result",
  WorktreeCleanupContradicted: "worktree cleanup contradiction",
  WorktreeCleanupSettled: "worktree cleanup settlement"
} satisfies Record<WorktreeCleanupBindingEvent["_tag"], string>

const invalidWorktreeCleanupRunBinding = (event: WorktreeCleanupBindingEvent, runId: RunId): string | undefined =>
  invalidNestedRunBinding(
    worktreeCleanupBindingLabels[event._tag],
    [event.authorization.disposition.plannedAttempt.runId],
    runId
  )

type BranchCleanupBindingEvent = Extract<
  WorkflowJournalEvent,
  {
    readonly _tag:
      | "BranchCleanupAuthorized"
      | "BranchCleanupObservationIntended"
      | "BranchCleanupObserved"
      | "BranchCleanupAbsenceConfirmed"
      | "BranchCleanupMutationIntended"
      | "BranchCleanupMutationResultRecorded"
      | "BranchCleanupContradicted"
      | "BranchCleanupSettled"
  }
>

const branchCleanupBindingLabels = {
  BranchCleanupAuthorized: "branch cleanup authorization",
  BranchCleanupObservationIntended: "branch cleanup observation",
  BranchCleanupObserved: "branch cleanup observation",
  BranchCleanupAbsenceConfirmed: "branch cleanup absence",
  BranchCleanupMutationIntended: "branch cleanup mutation",
  BranchCleanupMutationResultRecorded: "branch cleanup mutation result",
  BranchCleanupContradicted: "branch cleanup contradiction",
  BranchCleanupSettled: "branch cleanup settlement"
} satisfies Record<BranchCleanupBindingEvent["_tag"], string>

const invalidBranchCleanupRunBinding = (event: BranchCleanupBindingEvent, runId: RunId): string | undefined =>
  invalidNestedRunBinding(
    branchCleanupBindingLabels[event._tag],
    [event.authorization.disposition.plannedAttempt.runId],
    runId
  )

type IntegratorCandidateCleanupBindingEvent = Extract<
  WorkflowJournalEvent,
  {
    readonly _tag:
      | "IntegratorCandidateCleanupAuthorized"
      | "IntegratorCandidateCleanupObservationIntended"
      | "IntegratorCandidateCleanupObserved"
      | "IntegratorCandidateCleanupAbsenceConfirmed"
      | "IntegratorCandidateCleanupMutationIntended"
      | "IntegratorCandidateCleanupMutationResultRecorded"
      | "IntegratorCandidateCleanupContradicted"
      | "IntegratorCandidateCleanupSettled"
  }
>

const integratorCandidateCleanupBindingLabels = {
  IntegratorCandidateCleanupAuthorized: "candidate cleanup authorization",
  IntegratorCandidateCleanupObservationIntended: "candidate cleanup observation",
  IntegratorCandidateCleanupObserved: "candidate cleanup observation",
  IntegratorCandidateCleanupAbsenceConfirmed: "candidate cleanup absence",
  IntegratorCandidateCleanupMutationIntended: "candidate cleanup mutation",
  IntegratorCandidateCleanupMutationResultRecorded: "candidate cleanup mutation result",
  IntegratorCandidateCleanupContradicted: "candidate cleanup contradiction",
  IntegratorCandidateCleanupSettled: "candidate cleanup settlement"
} satisfies Record<IntegratorCandidateCleanupBindingEvent["_tag"], string>

const invalidIntegratorCandidateCleanupRunBinding = (
  event: IntegratorCandidateCleanupBindingEvent,
  runId: RunId
): string | undefined =>
  invalidNestedRunBinding(
    integratorCandidateCleanupBindingLabels[event._tag],
    [
      event.authorization.disposition.predecessor.plannedAttempt.runId,
      event.authorization.disposition.successor.plannedAttempt.runId
    ],
    runId
  )

const invalidTaskTrackerObservationRunBinding = (
  event: Extract<WorkflowJournalEvent, { readonly _tag: "TaskTrackerFactsObserved" }>,
  runId: RunId
): string | undefined => {
  if (event.observation._tag !== "FocusedTaskCompletionFacts") return undefined
  const currentClaim = event.observation.facts.currentClaim
  return invalidNestedRunBinding(
    "focused task-completion observation",
    [
      event.observation.request.claim.plannedAttempt.runId,
      ...(currentClaim._tag === "CompletionTaskClaim" ? [currentClaim.plannedAttempt.runId] : [])
    ],
    runId
  )
}

const invalidRunBinding = (event: WorkflowJournalEvent, runId: RunId): string | undefined =>
  Match.value(event).pipe(
    Match.tags({
      ControlDirectionApplied: (candidate) =>
        invalidNestedRunBinding("control direction", [candidate.subject.runId], runId),
      RunCancellationApplied: () => undefined,
      CancelledAttemptImplementationResponsibilityRelinquished: (candidate) =>
        invalidNestedRunBinding("cancelled-attempt responsibility", [candidate.plannedAttempt.runId], runId),
      CancelledAttemptClaimNoReleaseObserved: (candidate) =>
        invalidNestedRunBinding("cancelled-attempt claim observation", [candidate.plannedAttempt.runId], runId),
      AttemptChoiceApplied: (candidate) => invalidAttemptChoiceRunBinding(candidate, runId, "attempt choice"),
      AttemptImplementationAbandoned: (candidate) =>
        invalidAttemptChoiceRunBinding(candidate, runId, "attempt implementation abandonment"),
      AttemptRestartAuthorityReadFailed: (candidate) =>
        invalidAttemptChoiceRunBinding(candidate, runId, "Restart authority read failure"),
      AttemptStoppageIntended: (candidate) => invalidAttemptChoiceRunBinding(candidate, runId, "attempt stoppage"),
      TargetPromotionIntended: (candidate) => invalidTargetPromotionRunBinding(candidate, runId),
      TargetPromotionAttemptIntended: (candidate) => invalidTargetPromotionRunBinding(candidate, runId),
      TargetPromotionObservedSuccess: (candidate) => invalidTargetPromotionRunBinding(candidate, runId),
      TargetPromotionStale: (candidate) => invalidTargetPromotionRunBinding(candidate, runId),
      TargetPromotionNonConvergence: (candidate) => invalidTargetPromotionRunBinding(candidate, runId),
      PlannedAttemptReplaced: (candidate) => {
        const choiceIssue = invalidAttemptChoiceRunBinding(candidate, runId, "planned-attempt replacement")
        const successorRunId = candidate.successorPlan.plannedAttempt.runId
        return choiceIssue ?? invalidNestedRunBinding("planned-attempt replacement successor", [successorRunId], runId)
      },
      StoppedAttemptClaimNoReleaseObserved: (candidate) =>
        invalidAttemptChoiceRunBinding(candidate, runId, "stopped-attempt claim observation"),
      TaskClaimReacquisitionDirected: (candidate) =>
        invalidNestedRunBinding("task-claim reacquisition direction", [candidate.subject.runId], runId),
      TaskClaimAcquisitionIntended: (candidate) => {
        if (candidate.operation.authority._tag !== "ExplicitTaskClaimReacquisitionAuthority") return undefined
        // The exact reacquisition request is a branded transport identity and
        // carries no RunId; the correlated direction event validates its Run.
        return undefined
      },
      TaskClaimReleaseIntended: (candidate) =>
        candidate.operation.authority._tag === "StoppedAttemptClaimReleaseAuthority"
          ? invalidNestedRunBinding(
              "task-claim release authority",
              [candidate.operation.authority.requestId.runId],
              runId
            )
          : undefined,
      TaskAttemptPlanned: (candidate) =>
        invalidNestedRunBinding("task-attempt plan", [candidate.operation.plannedAttempt.runId], runId),
      TaskWorktreeReconciliationIntended: (candidate) =>
        invalidNestedRunBinding("task-worktree reconciliation", [candidate.operation.plannedAttempt.runId], runId),
      GitReadIntentRecorded: (candidate) =>
        invalidNestedRunBinding("Git read", [candidate.operation.plannedAttempt.runId], runId),
      TargetLineageObserved: (candidate) =>
        invalidNestedRunBinding("target-lineage observation", [candidate.plannedAttempt.runId], runId),
      PlannedAttemptWorktreeObserved: (candidate) =>
        candidate.observation._tag === "AttemptWorktreeLost"
          ? invalidNestedRunBinding(
              "planned-attempt worktree observation",
              [candidate.observation.plannedAttempt.runId],
              runId
            )
          : undefined,
      PlannedAttemptContinuationAuthorized: (candidate) =>
        invalidNestedRunBinding("planned-attempt continuation", [candidate.plannedAttempt.runId], runId),
      PlannedAttemptExecutorCommandIntended: (candidate) =>
        invalidNestedRunBinding("executor command intent", [candidate.plannedAttempt.runId], runId),
      PlannedAttemptExecutorCommandProjectionObserved: (candidate) =>
        invalidNestedRunBinding(
          "executor command projection",
          [
            candidate.plannedAttempt.runId,
            ...(candidate.observation._tag === "ExactExecutorReport"
              ? [candidate.observation.report.correlation.runId]
              : candidate.observation._tag === "ExecutorReportContradiction"
                ? [candidate.observation.observed.correlation.runId]
                : [])
          ],
          runId
        ),
      PlannedAttemptExecutorCommandResponseContradicted: (candidate) =>
        invalidNestedRunBinding(
          "executor command response",
          [candidate.plannedAttempt.runId, candidate.observed.correlation.runId],
          runId
        ),
      PlannedAttemptExecutorStateObserved: (candidate) =>
        invalidNestedRunBinding(
          "executor state observation",
          [
            candidate.plannedAttempt.runId,
            ...(candidate.observation._tag === "ExactExecutorReport"
              ? [candidate.observation.report.correlation.runId]
              : candidate.observation._tag === "ExecutorReportContradiction"
                ? [candidate.observation.observed.correlation.runId]
                : [])
          ],
          runId
        ),
      PlannedAttemptExecutorWorkResponsibilityBegan: (candidate) =>
        invalidNestedRunBinding("executor responsibility", [candidate.plannedAttempt.runId], runId),
      PlannedAttemptExecutorWorkReported: (candidate) =>
        invalidNestedRunBinding("executor report", [candidate.report.correlation.runId], runId),
      TaskTrackerReadIntentRecorded: (candidate) =>
        candidate.operation._tag === "ReadCompletionTaskFacts"
          ? invalidCompletionTaskRunBinding(candidate.operation, runId, "completion-task read intent")
          : undefined,
      TaskTrackerFactsObserved: (candidate) => invalidTaskTrackerObservationRunBinding(candidate, runId),
      CompletionTaskIntended: (candidate) => invalidCompletionTaskRunBinding(candidate, runId, "completion request"),
      CompletionTaskAttemptIntended: (candidate) =>
        invalidCompletionTaskRunBinding(candidate, runId, "completion attempt"),
      CompletionTaskAcknowledged: (candidate) =>
        invalidCompletionTaskRunBinding(candidate, runId, "completion acknowledgement"),
      CompletionTaskResponseLost: (candidate) =>
        invalidCompletionTaskRunBinding(candidate, runId, "completion response loss"),
      CompletionTaskRejected: (candidate) => invalidCompletionTaskRunBinding(candidate, runId, "completion rejection"),
      CompletionTaskCandidateAncestryReadIntended: (candidate) =>
        invalidCompletionTaskRunBinding(candidate, runId, "completion ancestry read intent"),
      CompletionTaskCandidateAncestryObserved: (candidate) =>
        invalidCompletionTaskRunBinding(candidate, runId, "completion ancestry observation"),
      CompletionTaskRequestLookupIntended: (candidate) =>
        invalidCompletionTaskRunBinding(candidate, runId, "completion request lookup intent"),
      CompletionTaskRequestLookupObserved: (candidate) =>
        invalidCompletionTaskRequestLookupRunBinding(candidate, runId, "completion request lookup observation"),
      PostPromotionBlockerCandidateAncestryReadIntended: (candidate) =>
        invalidNestedRunBinding(
          "post-promotion blocker ancestry read intent",
          [candidate.authorization.claim.plannedAttempt.runId],
          runId
        ),
      PostPromotionBlockerCandidateAncestryObserved: (candidate) =>
        invalidNestedRunBinding(
          "post-promotion blocker ancestry observation",
          [candidate.authorization.claim.plannedAttempt.runId],
          runId
        ),
      CompletionClaimReplacementIntended: (candidate) =>
        invalidNestedRunBinding("completion claim replacement intent", [candidate.claim.plannedAttempt.runId], runId),
      CompletionClaimReplacementAttemptIntended: (candidate) =>
        invalidNestedRunBinding("completion claim replacement attempt", [candidate.claim.plannedAttempt.runId], runId),
      CompletionClaimReplaced: (candidate) =>
        invalidNestedRunBinding("completion claim replacement outcome", [candidate.claim.plannedAttempt.runId], runId),
      CompletionClaimDeletionIntended: (candidate) =>
        invalidNestedRunBinding("completion claim deletion intent", [candidate.claim.plannedAttempt.runId], runId),
      CompletionClaimDeletionAttemptIntended: (candidate) =>
        invalidNestedRunBinding("completion claim deletion attempt", [candidate.claim.plannedAttempt.runId], runId),
      CompletionClaimDeleted: (candidate) =>
        invalidNestedRunBinding("completion claim deletion outcome", [candidate.claim.plannedAttempt.runId], runId),
      CompletionClaimDeletionReadObserved: (candidate) =>
        invalidNestedRunBinding(
          "completion claim deletion read",
          [
            candidate.request.claim.plannedAttempt.runId,
            candidate.request.successObservation.claim.plannedAttempt.runId,
            ...(candidate.observation._tag === "CompletionTaskClaim"
              ? [candidate.observation.plannedAttempt.runId]
              : [])
          ],
          runId
        ),
      IntegrationFinalitySettled: (candidate) =>
        invalidNestedRunBinding(
          "integration finality settlement",
          [candidate.claim.plannedAttempt.runId, candidate.successObservation.claim.plannedAttempt.runId],
          runId
        ),
      IntegratorSessionFixed: (candidate) =>
        candidate.correlation.plannedAttempt.runId === runId
          ? undefined
          : `Integrator session binds run ${candidate.correlation.plannedAttempt.runId}`,
      IntegratorSuccessorSessionFixed: (candidate) =>
        candidate.predecessor.plannedAttempt.runId === runId && candidate.successor.plannedAttempt.runId === runId
          ? undefined
          : "Integrator successor session binds a foreign run",
      IntegratorRunStarted: (candidate) =>
        candidate.run.session.plannedAttempt.runId === runId
          ? undefined
          : `Integrator run start binds run ${candidate.run.session.plannedAttempt.runId}`,
      IntegratorRunResultRecorded: (candidate) =>
        candidate.run.session.plannedAttempt.runId === runId
          ? undefined
          : `Integrator run result binds run ${candidate.run.session.plannedAttempt.runId}`,
      IntegratorRunCandidateGitReadIntended: (candidate) =>
        candidate.run.session.plannedAttempt.runId === runId
          ? undefined
          : `Integrator run candidate Git-read intent binds run ${candidate.run.session.plannedAttempt.runId}`,
      IntegratorRunCandidateGitObserved: (candidate) =>
        candidate.run.session.plannedAttempt.runId === runId
          ? undefined
          : `Integrator run candidate Git observation binds run ${candidate.run.session.plannedAttempt.runId}`,
      IntegrationQuarantineDirectionApplied: (candidate) =>
        candidate.requestId.runId === runId
          ? undefined
          : `integration quarantine direction binds run ${candidate.requestId.runId}`,
      IntegrationProviderRunActivityAbsent: (candidate) => {
        const correlationRunId = candidate.correlation.plannedAttempt.runId
        const exactRunId = candidate.run.session.plannedAttempt.runId
        return correlationRunId === runId && exactRunId === runId
          ? undefined
          : `Integrator provider-activity absence binds run ${exactRunId}`
      },
      IntegrationQuarantined: (candidate) =>
        invalidNestedRunBinding("integration quarantine", [candidate.correlation.plannedAttempt.runId], runId),
      WorktreeCleanupAuthorized: (candidate) => invalidWorktreeCleanupRunBinding(candidate, runId),
      WorktreeCleanupObservationIntended: (candidate) => invalidWorktreeCleanupRunBinding(candidate, runId),
      WorktreeCleanupObserved: (candidate) => invalidWorktreeCleanupRunBinding(candidate, runId),
      WorktreeCleanupAbsenceConfirmed: (candidate) => invalidWorktreeCleanupRunBinding(candidate, runId),
      WorktreeCleanupMutationIntended: (candidate) => invalidWorktreeCleanupRunBinding(candidate, runId),
      WorktreeCleanupMutationResultRecorded: (candidate) => invalidWorktreeCleanupRunBinding(candidate, runId),
      WorktreeCleanupContradicted: (candidate) => invalidWorktreeCleanupRunBinding(candidate, runId),
      WorktreeCleanupSettled: (candidate) => invalidWorktreeCleanupRunBinding(candidate, runId),
      BranchCleanupAuthorized: (candidate) => invalidBranchCleanupRunBinding(candidate, runId),
      BranchCleanupObservationIntended: (candidate) => invalidBranchCleanupRunBinding(candidate, runId),
      BranchCleanupObserved: (candidate) => invalidBranchCleanupRunBinding(candidate, runId),
      BranchCleanupAbsenceConfirmed: (candidate) => invalidBranchCleanupRunBinding(candidate, runId),
      BranchCleanupMutationIntended: (candidate) => invalidBranchCleanupRunBinding(candidate, runId),
      BranchCleanupMutationResultRecorded: (candidate) => invalidBranchCleanupRunBinding(candidate, runId),
      BranchCleanupContradicted: (candidate) => invalidBranchCleanupRunBinding(candidate, runId),
      BranchCleanupSettled: (candidate) => invalidBranchCleanupRunBinding(candidate, runId),
      IntegratorCandidateCleanupAuthorized: (candidate) =>
        invalidIntegratorCandidateCleanupRunBinding(candidate, runId),
      IntegratorCandidateCleanupObservationIntended: (candidate) =>
        invalidIntegratorCandidateCleanupRunBinding(candidate, runId),
      IntegratorCandidateCleanupObserved: (candidate) => invalidIntegratorCandidateCleanupRunBinding(candidate, runId),
      IntegratorCandidateCleanupAbsenceConfirmed: (candidate) =>
        invalidIntegratorCandidateCleanupRunBinding(candidate, runId),
      IntegratorCandidateCleanupMutationIntended: (candidate) =>
        invalidIntegratorCandidateCleanupRunBinding(candidate, runId),
      IntegratorCandidateCleanupMutationResultRecorded: (candidate) =>
        invalidIntegratorCandidateCleanupRunBinding(candidate, runId),
      IntegratorCandidateCleanupContradicted: (candidate) =>
        invalidIntegratorCandidateCleanupRunBinding(candidate, runId),
      IntegratorCandidateCleanupSettled: (candidate) => invalidIntegratorCandidateCleanupRunBinding(candidate, runId)
    }),
    Match.orElse(() => undefined)
  )

/** Validates every nested workflow identity before a historical trace is exposed. */
export const invalidWorkflowRunBinding = (event: WorkflowJournalEvent, runId: RunId): string | undefined => {
  if (event._tag === "IntegrationResponsibilityBegan" || event._tag === "IntegrationStarted") {
    return event.plannedAttempt.runId === runId
      ? undefined
      : `integration work for attempt ${event.plannedAttempt.attemptId} binds run ${event.plannedAttempt.runId}`
  }
  return invalidRunBinding(event, runId)
}
