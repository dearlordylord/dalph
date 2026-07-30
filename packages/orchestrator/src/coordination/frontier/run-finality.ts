import { plannedAttemptExecutorCorrelation, plannedAttemptExecutorCorrelationKey } from "@dalph/contracts"
import { Data } from "effect"
import { workflowResponsibilityOperationId, type WorkflowResponsibilityState } from "../reconstruction/state.js"
import type { RunnableFrontier } from "./frontier.js"

export type RunFinalityDecision = Data.TaggedEnum<{
  RunMayTerminate: Record<never, never>
  RunMustRemainActive: { readonly reason: "RunnableTransition" | "TrackerTargetUnsettled" | "UnsettledResponsibility" }
}>

export const RunFinalityDecision = Data.taggedEnum<RunFinalityDecision>()

/** Run termination requires tracker settlement and no runnable or unsettled responsibility. */
export const deriveRunFinalityDecision = (
  frontier: RunnableFrontier,
  responsibility: WorkflowResponsibilityState,
  trackerTargetSettled: boolean
): RunFinalityDecision => {
  if (frontier.transitions.length > 0) {
    return RunFinalityDecision.RunMustRemainActive({ reason: "RunnableTransition" })
  }
  if (
    frontier.explanations.some(
      ({ _tag }) =>
        _tag === "IntegrationDependencyWait" ||
        _tag === "IntegrationInProgress" ||
        _tag === "IntegrationTrackerFactsWait" ||
        _tag === "IntegrationTargetWait" ||
        _tag === "IntegrationConfigurationWait" ||
        _tag === "PlannedAttemptTaskExternalSuccessConstraint" ||
        _tag === "PlannedAttemptTaskLifecycleConstraint" ||
        _tag === "PlannedAttemptTaskSpecificationChangeConstraint"
    )
  ) {
    return RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })
  }
  const terminalOperationIds = new Set(
    frontier.explanations.flatMap((explanation) =>
      explanation._tag === "FinalOutcome" || explanation._tag === "Relinquishment" || explanation._tag === "Settlement"
        ? [explanation.operationId]
        : []
    )
  )
  const terminalPlannedAttempts = new Set(
    frontier.explanations.flatMap((explanation) =>
      explanation._tag === "PlannedAttemptExecutorWorkTerminal"
        ? [plannedAttemptExecutorCorrelationKey(explanation.report.correlation)]
        : []
    )
  )
  if (
    responsibility.entries.some((entry) =>
      entry._tag === "PlannedAttemptExecutorWorkResponsibility"
        ? !terminalPlannedAttempts.has(
            plannedAttemptExecutorCorrelationKey(plannedAttemptExecutorCorrelation(entry.plannedAttempt))
          ) &&
          !frontier.explanations.some(
            (explanation) =>
              explanation._tag === "PlannedAttemptTaskExternalSuccessSettled" &&
              plannedAttemptExecutorCorrelationKey(explanation.correlation) ===
                plannedAttemptExecutorCorrelationKey(plannedAttemptExecutorCorrelation(entry.plannedAttempt))
          )
        : !terminalOperationIds.has(workflowResponsibilityOperationId(entry))
    )
  ) {
    return RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })
  }
  return trackerTargetSettled
    ? RunFinalityDecision.RunMayTerminate()
    : RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })
}
