import { plannedAttemptExecutorCorrelation, plannedAttemptExecutorCorrelationKey } from "@dalph/contracts"
import { Data } from "effect"
import { workflowResponsibilityOperationId, type WorkflowResponsibilityState } from "../reconstruction/state.js"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { RunnableFrontier } from "./frontier.js"

export type RunFinalityDecision = Data.TaggedEnum<{
  RunMayTerminate: Record<never, never>
  RunMustRemainActive: { readonly reason: "RunnableTransition" | "TrackerTargetUnsettled" | "UnsettledResponsibility" }
}>

export const RunFinalityDecision = Data.taggedEnum<RunFinalityDecision>()

/** The journal prefix used by the exact relation evaluation that proved finality. */
export interface RunFinalityProof {
  readonly acceptedAt: JournalPosition | null
  readonly decision: RunFinalityDecision
}

const unsettledExplanationTags = new Set<RunnableFrontier["explanations"][number]["_tag"]>([
  "IntegrationDependencyWait",
  "IntegrationInProgress",
  "IntegrationTrackerFactsWait",
  "IntegrationTargetWait",
  "IntegrationConfigurationWait",
  "IntegrationFinalityConfigurationWait",
  "IntegrationFinalityTrackerSuccessWait",
  "IntegrationFinalityNonConvergence",
  "PlannedAttemptTaskExternalSuccessConstraint",
  "PlannedAttemptTaskLifecycleConstraint",
  "PlannedAttemptTaskSpecificationChangeConstraint"
])

/** Run termination requires tracker settlement and no runnable or unsettled responsibility. */
export const deriveRunFinalityDecision = (
  frontier: RunnableFrontier,
  responsibility: WorkflowResponsibilityState,
  trackerTargetSettled: boolean
): RunFinalityDecision => {
  if (frontier.transitions.length > 0) {
    return RunFinalityDecision.RunMustRemainActive({ reason: "RunnableTransition" })
  }
  if (frontier.explanations.some(({ _tag }) => unsettledExplanationTags.has(_tag))) {
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
