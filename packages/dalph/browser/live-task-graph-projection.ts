import type { RunningHostInspectionSnapshot } from "../src/application/running-host-contract.js"
import {
  deliveryGraphEncoding,
  type DeliveryGraphProjection,
  type DeliveryGraphTaskTone
} from "../../../prototypes/reducer-lab/src/delivery-graph-element.ts"

/** Presentation joins independently observed tracker and Run facts. No selector
 * consumes this projection and no workflow permission is derived here. */
export const projectLiveTaskGraph = (snapshot: RunningHostInspectionSnapshot): DeliveryGraphProjection | null => {
  const inspection = snapshot.inspection
  if (inspection._tag !== "Ready" && inspection._tag !== "Stale") return null
  const graph = inspection.value.graph
  const run = snapshot.run._tag === "Closed" ? snapshot.run.final : snapshot.run
  const ready = run?._tag === "Ready" ? run : null
  const observedRunTasks = new Set(
    ready?.graph._tag === "GraphEstablished" ? ready.graph.snapshot.tasks.map((task) => task.id) : []
  )
  const frontier = new Set(
    ready?.frontier.standings.filter((standing) => standing._tag === "Eligible").map((standing) => standing.taskId) ??
      []
  )
  const held = new Set(ready?.held.map((position) => position.taskId) ?? [])
  const retained = new Set(ready?.retained.map((standing) => standing.taskId) ?? [])
  const phases: Readonly<Record<string, DeliveryGraphTaskTone>> = {
    Preparing: "desired",
    Executing: "running",
    Suspended: "paused",
    Rejected: "blocked",
    Failed: "blocked",
    ExecutorCompleted: "waiting",
    Accepted: "desired",
    Integrating: "integrating",
    Delivered: "settled"
  }
  const tasks = graph.tasks.map((task) => {
    const diagnostic =
      ready?.delivery._tag === "DeliveryStatusAvailable"
        ? ready.delivery.diagnostics?.tasks.find((entry) => entry.taskId === task.id)
        : undefined
    const labels = [
      task.lifecycle._tag,
      ...(observedRunTasks.has(task.id) ? [] : ["Outside the observed Run graph"]),
      ...(diagnostic === undefined ? [] : [diagnostic.phase]),
      ...(diagnostic?.failure._tag === "Known" ? [diagnostic.failure.code] : [])
    ]
    return {
      id: task.id,
      lifecycle: task.lifecycle._tag,
      ...(task.descriptor === undefined ? {} : { title: task.descriptor.title }),
      display: {
        classes: [
          ...(frontier.has(task.id) ? [deliveryGraphEncoding.frontierEligible.className] : []),
          ...(held.has(task.id) ? [deliveryGraphEncoding.heldPosition.className] : []),
          ...(retained.has(task.id) ? [deliveryGraphEncoding.retainedStanding.className] : [])
        ],
        labels,
        tone: diagnostic === undefined ? ("waiting" as const) : (phases[diagnostic.phase] ?? "waiting")
      }
    }
  })
  return {
    key: `live:${snapshot.run.runId}`,
    fingerprint: `${graph.revision}:${JSON.stringify(tasks)}`,
    status: inspection._tag === "Stale" ? "Last complete graph; refresh failed." : "Complete tracker observation.",
    tasks,
    edges: graph.tasks.flatMap((task) => [
      ...task.prerequisiteIds.map((prerequisite) => ({
        from: prerequisite,
        to: task.id,
        kind: "Prerequisite" as const
      })),
      ...(task.parentTaskId === null ? [] : [{ from: task.parentTaskId, to: task.id, kind: "Grouping" as const }])
    ])
  }
}
