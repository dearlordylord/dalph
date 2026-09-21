import type { TraceAtCursor } from "@dalph/orchestrator"
import type { DeliveryGraphTask } from "./delivery-graph-element.ts"
import type { AuthoredDeliveryFrame } from "../../../packages/dalph/src/cassettes/authored-runner.ts"

/** Uses existing delivery standings, without reconstructing another workflow state. */
export const deliveryTaskProgressLabels = (frame: AuthoredDeliveryFrame, taskId: string): ReadonlyArray<string> => {
  const delivery = frame.deliveries.find((entry) => entry.taskId === taskId)
  const standings = delivery?.standings.map(({ kind }) => kind) ?? []
  if (standings.includes("IntegrationFinalitySettled")) {
    return ["Git: integration confirmed", "Dalph: integration settled after tracker completion"]
  }
  const labels: string[] = []
  if (standings.includes("TargetPromotionSucceeded")) labels.push("Git: integration confirmed")
  if (delivery?.evidence.some(({ kind }) => kind === "FocusedTaskCompletionSuccess")) {
    labels.push("Tracker: completion confirmed by focused read")
  } else if (standings.includes("TargetPromotionSucceeded")) {
    labels.push("Tracker: completion not yet confirmed")
  }
  return labels
}

/** Presents observed facts at the selected cursor; never grants workflow permission. */
export const traceTaskProgress = (history: TraceAtCursor): ReadonlyArray<DeliveryGraphTask> => {
  const graph = history.graph
  if (graph === null) return []
  return graph.snapshot.tasks.map(({ id, lifecycle }) => {
    const promotion = history.facets.integration.facts.findLast((fact) =>
      fact._tag === "PromotionSucceeded" &&
      fact.correlation.qualifiedCandidate.run.session.plannedAttempt.taskId === id
    )
    const focused = history.items.findLast(({ occurrence, identity }) =>
      identity.position > graph.observation.recordedAt &&
      occurrence._tag === "TaskTrackerFactsObserved" &&
      occurrence.evidence._tag === "FocusedTaskCompletionFacts" &&
      occurrence.evidence.facts.taskId === id
    )
    const observation = focused?.occurrence
    const latestLifecycle = observation?._tag === "TaskTrackerFactsObserved" &&
        observation.evidence._tag === "FocusedTaskCompletionFacts"
      ? observation.evidence.facts.lifecycle
      : lifecycle._tag
    const labels: string[] = []
    if (promotion?._tag === "PromotionSucceeded") {
      const target = promotion.correlation.qualifiedCandidate.run.session.integrationTarget
      labels.push(`Git: integration confirmed into ${target.ref} · @${promotion.source.position}`)
    }
    if (focused !== undefined) {
      labels.push(`Tracker: ${latestLifecycle === "CompletedSuccessfully" ? "completion confirmed" : latestLifecycle} · focused read @${focused.identity.position}`)
      if (latestLifecycle !== lifecycle._tag) labels.push("Graph snapshot differs · awaiting refresh")
    } else if (promotion !== undefined && latestLifecycle === "Open") {
      labels.push("Tracker: completion not yet confirmed")
    }
    return {
      id,
      lifecycle: `Graph snapshot: ${lifecycle._tag}`,
      display: { labels }
    }
  })
}
