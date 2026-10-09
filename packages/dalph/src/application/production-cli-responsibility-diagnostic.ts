import type { DeliveryDiagnostics, DeliveryStatusEntry } from "@dalph/orchestrator"
import { OperationId, JournalPosition } from "@dalph/orchestrator"
import { PlannedAttemptExecutorCorrelation, plannedAttemptExecutorCorrelation } from "@dalph/contracts"
import { Schema } from "effect"

/** Safe descriptions only: never copy a prompt, adapter detail or executable operation. */
const PublicResponsibilityDiagnosticShape = Schema.Struct({
  boundary: Schema.Literals(["Executor", "Git", "TaskTracker", "Coordinator"]),
  correlation: Schema.NullOr(PlannedAttemptExecutorCorrelation),
  requiredOperation: Schema.TaggedUnion({ None: {}, ObservationRequired: { operationId: OperationId } }),
  lastAcceptedEvidence: Schema.TaggedUnion({
    ResponsibilityRecorded: { observedAt: JournalPosition },
    BoundaryEvidenceAccepted: { observedAt: JournalPosition, operationId: OperationId, kind: Schema.NonEmptyString },
    ExecutorEvidenceAccepted: { observedAt: JournalPosition, kind: Schema.NonEmptyString }
  }),
  constraint: Schema.NonEmptyString,
  missingProof: Schema.NonEmptyString,
  nextPermittedStep: Schema.Literals([
    "ObserveExactExecutor",
    "ReconcileExactClaimBeforeRelease",
    "ReadExactTrackerFacts",
    "ReadExactGitFacts",
    "ResolveExactConstraint",
    "ApplyNewExactAttemptChoice"
  ])
})
export type PublicResponsibilityDiagnostic = typeof PublicResponsibilityDiagnosticShape.Type
export const PublicResponsibilityDiagnostic: Schema.Codec<PublicResponsibilityDiagnostic, unknown> =
  PublicResponsibilityDiagnosticShape

type Facts = Extract<
  Extract<DeliveryStatusEntry, { readonly _tag: "EvidenceUnavailable" }>["evidence"],
  { readonly _tag: "ResponsibilityFacts" }
>["facts"]

/** The owning disposition selects a permitted observation or refusal, never generic retry permission. */
const constraintOf = (
  disposition: Facts["disposition"]
): Pick<PublicResponsibilityDiagnostic, "boundary" | "constraint" | "missingProof" | "nextPermittedStep"> => {
  const constraint = disposition._tag
  switch (disposition._tag) {
    case "PlannedAttemptExecutorProjectionWait":
    case "AttemptStoppageWait":
      return {
        boundary: "Executor",
        constraint,
        missingProof: disposition.reason,
        nextPermittedStep: "ObserveExactExecutor"
      }
    case "AttemptRestartRejected":
      return {
        boundary: "Executor",
        constraint,
        missingProof: disposition.reason,
        nextPermittedStep:
          disposition.reason === "NewFingerprintChoiceRequired"
            ? "ApplyNewExactAttemptChoice"
            : "ResolveExactConstraint"
      }
    case "AttemptRestartWait": {
      const reason = disposition.reason
      const boundary = reason.startsWith("Executor")
        ? "Executor"
        : reason.startsWith("OldWorktree") || reason === "TargetHeadUnreadable"
          ? "Git"
          : reason === "IntegrationTargetUnavailable"
            ? "Coordinator"
            : "TaskTracker"
      return {
        boundary,
        constraint,
        missingProof: reason,
        nextPermittedStep:
          boundary === "Executor"
            ? "ObserveExactExecutor"
            : boundary === "Git"
              ? "ReadExactGitFacts"
              : boundary === "TaskTracker"
                ? "ReadExactTrackerFacts"
                : "ResolveExactConstraint"
      }
    }
    case "CancelledAttemptClaimReleasePending":
    case "StoppedAttemptClaimReleasePending":
    case "CancelledAttemptClaimUnreadableWait":
    case "StoppedAttemptClaimUnreadableWait":
      return {
        boundary: "TaskTracker",
        constraint,
        missingProof: "ExactClaimReleaseObservationRequired",
        nextPermittedStep: "ReconcileExactClaimBeforeRelease"
      }
    case "CancelledAttemptClaimPlanningWait":
    case "StoppedAttemptClaimPlanningWait":
      return {
        boundary: "TaskTracker",
        constraint,
        missingProof: disposition.reason,
        nextPermittedStep: "ResolveExactConstraint"
      }
    case "PlannedAttemptGitConstraint":
    case "WorkflowOperationGitConstraint":
      return { boundary: "Git", constraint, missingProof: disposition.gitState, nextPermittedStep: "ReadExactGitFacts" }
    case "TaskExternalSuccessConstraint":
      return {
        boundary: "TaskTracker",
        constraint,
        missingProof: "ExactTaskClaimDispositionRequired",
        nextPermittedStep: "ReconcileExactClaimBeforeRelease"
      }
    case "TaskMembershipConstraint":
    case "TaskLifecycleConstraint":
      return {
        boundary: "TaskTracker",
        constraint,
        missingProof: constraint,
        nextPermittedStep: "ReadExactTrackerFacts"
      }
    case "TaskSpecificationChangeConstraint":
      return {
        boundary: "TaskTracker",
        constraint,
        missingProof: "ExactTaskResolutionRequired",
        nextPermittedStep: "ApplyNewExactAttemptChoice"
      }
    case "UnreadableFactWait":
      return {
        boundary: disposition.boundary,
        constraint,
        missingProof: "ExactBoundaryObservationRequired",
        nextPermittedStep:
          disposition.boundary === "Executor"
            ? "ObserveExactExecutor"
            : disposition.boundary === "Git"
              ? "ReadExactGitFacts"
              : "ReadExactTrackerFacts"
      }
    // These dispositions have their own descriptive status variants; no continuation is granted here.
    case "AppliedTaskClaimReacquisitionDirection":
    case "AttemptRestartRequired":
    case "AttemptStoppageExecutorObservationRequired":
    case "AttemptStoppageRequired":
    case "CancelledAttemptAbandonmentRequired":
    case "CancelledAttemptClaimNoReleaseRequired":
    case "CancelledAttemptClaimObservationRequired":
    case "CancelledAttemptClaimReleaseRequired":
    case "CancelledAttemptClaimReleaseRetryRequired":
    case "CancelledAttemptSettled":
    case "DependencyWait":
    case "FinalOutcome":
    case "ForeignClaimIsolation":
    case "MissingClaim":
    case "Paused":
    case "PlannedAttemptExecutorResultRejected":
    case "PlannedAttemptExecutorSuspensionRequested":
    case "PlannedAttemptExecutorWorkSafelySuspended":
    case "PlannedAttemptExecutorWorkTerminal":
    case "Ready":
    case "Relinquished":
    case "Settled":
    case "StoppedAttemptClaimNoReleaseRequired":
    case "StoppedAttemptClaimObservationRequired":
    case "StoppedAttemptClaimReleaseRequired":
    case "StoppedAttemptClaimReleaseRetryRequired":
    case "StoppedAttemptSettled":
    case "TaskClaimMissingConstraint":
    case "TaskClaimUnreadableWait":
    case "TaskDependencyConstraint":
    case "TaskExternalSuccessReleaseNeeded":
    case "TaskExternalSuccessSettled":
    case "TaskForeignClaimIsolation":
    case "WorkflowOperationTaskClaimConstraint":
      return {
        boundary: "TaskTracker",
        constraint,
        missingProof: constraint,
        nextPermittedStep: "ResolveExactConstraint"
      }
  }
}

export const publicResponsibilityDiagnosticOf = (facts: Facts): PublicResponsibilityDiagnostic => ({
  ...constraintOf(facts.disposition),
  correlation:
    facts.responsibility._tag === "PlannedAttemptExecutorWorkResponsibility"
      ? plannedAttemptExecutorCorrelation(facts.responsibility.plannedAttempt)
      : null,
  requiredOperation:
    facts.disposition._tag === "CancelledAttemptClaimReleasePending" ||
    facts.disposition._tag === "StoppedAttemptClaimReleasePending"
      ? { _tag: "ObservationRequired", operationId: facts.disposition.operationId }
      : facts.disposition._tag === "CancelledAttemptClaimUnreadableWait" ||
          facts.disposition._tag === "StoppedAttemptClaimUnreadableWait"
        ? { _tag: "ObservationRequired", operationId: facts.disposition.observationOperationId }
        : { _tag: "None" },
  lastAcceptedEvidence: { _tag: "ResponsibilityRecorded", observedAt: facts.responsibility.beganAt }
})

/** Joins evidence only to the immutable plan and boundary family of this responsibility. */
export const withRelevantAcceptedEvidence = (
  facts: Facts,
  diagnostic: PublicResponsibilityDiagnostic,
  diagnostics: DeliveryDiagnostics | undefined
): PublicResponsibilityDiagnostic => {
  const responsibility = facts.responsibility
  if (responsibility._tag !== "PlannedAttemptExecutorWorkResponsibility") return diagnostic
  const planned = responsibility.plannedAttempt
  const task =
    diagnostics?.runId === planned.runId
      ? diagnostics.tasks.find((task) => {
          const retained = task.retainedAttempt
          return (
            task.taskId === planned.taskId &&
            retained.taskId === planned.taskId &&
            retained.runId === planned.runId &&
            retained.attemptId === planned.attemptId &&
            retained.baseSha === planned.baseSha &&
            retained.branch === planned.branch &&
            retained.worktree === planned.worktree
          )
        })
      : undefined
  const authority =
    diagnostic.boundary === "Git"
      ? diagnostic.missingProof === "TargetRewrite" || diagnostic.missingProof === "TargetHeadUnreadable"
        ? task?.authorityEvidence?.gitLineage
        : task?.authorityEvidence?.gitWorktree
      : diagnostic.boundary === "TaskTracker"
        ? task?.authorityEvidence?.claim
        : null
  const required = diagnostic.requiredOperation
  if (
    authority !== undefined &&
    authority !== null &&
    (required._tag === "None" || authority.operationId === required.operationId)
  ) {
    return { ...diagnostic, lastAcceptedEvidence: { _tag: "BoundaryEvidenceAccepted", ...authority } }
  }
  return task?.executorEvidence === undefined || diagnostic.boundary !== "Executor"
    ? diagnostic
    : { ...diagnostic, lastAcceptedEvidence: { _tag: "ExecutorEvidenceAccepted", ...task.executorEvidence } }
}
