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

const invalidCandidateCleanupRunBinding = (
  authorization: {
    readonly disposition: {
      readonly predecessor: { readonly plannedAttempt: { readonly runId: RunId } }
      readonly successor: { readonly plannedAttempt: { readonly runId: RunId } }
    }
  },
  runId: RunId,
  label: string
): string | undefined =>
  invalidNestedRunBinding(
    label,
    [
      authorization.disposition.predecessor.plannedAttempt.runId,
      authorization.disposition.successor.plannedAttempt.runId
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
      WorktreeCleanupAuthorized: (candidate) =>
        invalidNestedRunBinding(
          "worktree cleanup authorization",
          [candidate.authorization.disposition.plannedAttempt.runId],
          runId
        ),
      WorktreeCleanupObservationIntended: (candidate) =>
        invalidNestedRunBinding(
          "worktree cleanup observation",
          [candidate.authorization.disposition.plannedAttempt.runId],
          runId
        ),
      WorktreeCleanupObserved: (candidate) =>
        invalidNestedRunBinding(
          "worktree cleanup observation",
          [candidate.authorization.disposition.plannedAttempt.runId],
          runId
        ),
      WorktreeCleanupAbsenceConfirmed: (candidate) =>
        invalidNestedRunBinding(
          "worktree cleanup absence",
          [candidate.authorization.disposition.plannedAttempt.runId],
          runId
        ),
      WorktreeCleanupMutationIntended: (candidate) =>
        invalidNestedRunBinding(
          "worktree cleanup mutation",
          [candidate.authorization.disposition.plannedAttempt.runId],
          runId
        ),
      WorktreeCleanupMutationResultRecorded: (candidate) =>
        invalidNestedRunBinding(
          "worktree cleanup mutation result",
          [candidate.authorization.disposition.plannedAttempt.runId],
          runId
        ),
      WorktreeCleanupContradicted: (candidate) =>
        invalidNestedRunBinding(
          "worktree cleanup contradiction",
          [candidate.authorization.disposition.plannedAttempt.runId],
          runId
        ),
      WorktreeCleanupSettled: (candidate) =>
        invalidNestedRunBinding(
          "worktree cleanup settlement",
          [candidate.authorization.disposition.plannedAttempt.runId],
          runId
        ),
      BranchCleanupAuthorized: (candidate) =>
        invalidNestedRunBinding(
          "branch cleanup authorization",
          [candidate.authorization.disposition.plannedAttempt.runId],
          runId
        ),
      BranchCleanupObservationIntended: (candidate) =>
        invalidNestedRunBinding(
          "branch cleanup observation",
          [candidate.authorization.disposition.plannedAttempt.runId],
          runId
        ),
      BranchCleanupObserved: (candidate) =>
        invalidNestedRunBinding(
          "branch cleanup observation",
          [candidate.authorization.disposition.plannedAttempt.runId],
          runId
        ),
      BranchCleanupAbsenceConfirmed: (candidate) =>
        invalidNestedRunBinding(
          "branch cleanup absence",
          [candidate.authorization.disposition.plannedAttempt.runId],
          runId
        ),
      BranchCleanupMutationIntended: (candidate) =>
        invalidNestedRunBinding(
          "branch cleanup mutation",
          [candidate.authorization.disposition.plannedAttempt.runId],
          runId
        ),
      BranchCleanupMutationResultRecorded: (candidate) =>
        invalidNestedRunBinding(
          "branch cleanup mutation result",
          [candidate.authorization.disposition.plannedAttempt.runId],
          runId
        ),
      BranchCleanupContradicted: (candidate) =>
        invalidNestedRunBinding(
          "branch cleanup contradiction",
          [candidate.authorization.disposition.plannedAttempt.runId],
          runId
        ),
      BranchCleanupSettled: (candidate) =>
        invalidNestedRunBinding(
          "branch cleanup settlement",
          [candidate.authorization.disposition.plannedAttempt.runId],
          runId
        ),
      IntegratorCandidateCleanupAuthorized: (candidate) =>
        invalidCandidateCleanupRunBinding(candidate.authorization, runId, "candidate cleanup authorization"),
      IntegratorCandidateCleanupObservationIntended: (candidate) =>
        invalidCandidateCleanupRunBinding(candidate.authorization, runId, "candidate cleanup observation"),
      IntegratorCandidateCleanupObserved: (candidate) =>
        invalidCandidateCleanupRunBinding(candidate.authorization, runId, "candidate cleanup observation"),
      IntegratorCandidateCleanupAbsenceConfirmed: (candidate) =>
        invalidCandidateCleanupRunBinding(candidate.authorization, runId, "candidate cleanup absence"),
      IntegratorCandidateCleanupMutationIntended: (candidate) =>
        invalidCandidateCleanupRunBinding(candidate.authorization, runId, "candidate cleanup mutation"),
      IntegratorCandidateCleanupMutationResultRecorded: (candidate) =>
        invalidCandidateCleanupRunBinding(candidate.authorization, runId, "candidate cleanup mutation result"),
      IntegratorCandidateCleanupContradicted: (candidate) =>
        invalidCandidateCleanupRunBinding(candidate.authorization, runId, "candidate cleanup contradiction"),
      IntegratorCandidateCleanupSettled: (candidate) =>
        invalidCandidateCleanupRunBinding(candidate.authorization, runId, "candidate cleanup settlement")
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
