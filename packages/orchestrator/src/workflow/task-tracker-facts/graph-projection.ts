import { Option } from "effect"
import type { TrackerTask } from "../../authorities/task-tracker/task.js"
import { projectTrackerSnapshot, type TaskDagSnapshot } from "../../authorities/task-tracker/graph.js"
import type { CompleteTaskTrackerFactsObserved } from "./observation.js"

const graphTasksFrom = (observation: CompleteTaskTrackerFactsObserved): ReadonlyArray<TrackerTask> => {
  const [, lifecycles, prerequisites, groupings] = observation.factFamilies
  const lifecycleByTaskId = new Map(lifecycles.lifecycles.map(({ lifecycle, taskId }) => [taskId, lifecycle]))
  const prerequisitesByTaskId = new Map(
    prerequisites.prerequisites.map(({ prerequisiteTaskIds, taskId }) => [taskId, prerequisiteTaskIds])
  )
  const parentByTaskId = new Map(groupings.groupings.map(({ parentTaskId, taskId }) => [taskId, parentTaskId]))
  return observation.factFamilies[0].taskIds.map((id) => ({
    id,
    lifecycle: Option.getOrThrow(Option.fromUndefinedOr(lifecycleByTaskId.get(id))),
    parentTaskId: Option.getOrThrow(Option.fromUndefinedOr(parentByTaskId.get(id))),
    prerequisiteIds: Option.getOrThrow(Option.fromUndefinedOr(prerequisitesByTaskId.get(id)))
  }))
}

/** Derives selector input from one complete tracker observation, without introducing tracker authority. */
export const projectCompleteTaskGraph = (
  observation: CompleteTaskTrackerFactsObserved
): Option.Option<TaskDagSnapshot> => {
  const projected = projectTrackerSnapshot({
    revision: observation.factFamilies[0].contentIdentity,
    ...(observation.rootTaskId === undefined ? {} : { rootTaskId: observation.rootTaskId }),
    tasks: graphTasksFrom(observation)
  })
  return projected._tag === "Valid" ? Option.some(projected.snapshot) : Option.none()
}
