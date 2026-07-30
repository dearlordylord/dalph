import { Option } from "effect"
import { type TaskId } from "@dalph/contracts"
import type { ReconstructedRunState } from "../reconstruction/state.js"
import { latestReconstructedTaskGraph } from "../reconstruction/graph-knowledge.js"
import {
  deriveIntegrationAdmission,
  selectStartableIntegrationResponsibilities,
  type QueuedIntegrationResponsibility,
  type StartedIntegrationResponsibility
} from "../../workflow/protocols/integration-admission/protocol.js"
import { FrontierExplanation, type RunnableFrontier, RunnableFrontierTransition } from "./frontier.js"

const unsatisfiedPrerequisites = (
  runState: ReconstructedRunState,
  responsibility: StartedIntegrationResponsibility
): ReadonlyArray<TaskId> => {
  const graph = latestReconstructedTaskGraph(runState.graphKnowledge)
  if (Option.isNone(graph)) return []
  return graph.value
    .prerequisitesOf(responsibility.plannedAttempt.taskId)
    .filter((taskId) => Option.getOrUndefined(graph.value.lifecycleOf(taskId))?._tag !== "CompletedSuccessfully")
}

/** Derives target serialization and blocker waits from journal order plus current tracker facts. */
export const deriveIntegrationFrontier = (runState: ReconstructedRunState): RunnableFrontier => {
  const responsibilities = deriveIntegrationAdmission(runState.workflowHistory.records).responsibilities
  const started = responsibilities.filter(
    (responsibility): responsibility is StartedIntegrationResponsibility =>
      responsibility._tag === "StartedIntegrationResponsibility"
  )
  const queued = responsibilities.filter(
    (responsibility): responsibility is QueuedIntegrationResponsibility =>
      responsibility._tag === "QueuedIntegrationResponsibility"
  )
  const startable = selectStartableIntegrationResponsibilities({ responsibilities })
  const transitions = startable.map((responsibility) =>
    RunnableFrontierTransition.StartQueuedIntegration({ responsibility })
  )
  return {
    explanations: [
      ...started.map((responsibility) => {
        const prerequisiteTaskIds = unsatisfiedPrerequisites(runState, responsibility)
        return prerequisiteTaskIds.length === 0
          ? FrontierExplanation.IntegrationInProgress({ taskId: responsibility.plannedAttempt.taskId })
          : FrontierExplanation.IntegrationDependencyWait({
              plannedAttempt: responsibility.plannedAttempt,
              prerequisiteTaskIds,
              wakeCondition: "TaskTrackerFactsObserved"
            })
      }),
      ...queued.flatMap((responsibility) =>
        transitions.some((transition) => transition.responsibility.queuedAt === responsibility.queuedAt)
          ? []
          : [
              FrontierExplanation.IntegrationTargetWait({
                taskId: responsibility.plannedAttempt.taskId,
                wakeCondition: "IntegrationTargetReleased"
              })
            ]
      )
    ],
    transitions
  }
}
