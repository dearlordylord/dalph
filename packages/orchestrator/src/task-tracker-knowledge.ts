import { Option, Schema } from "effect"
import { OperationId, type TaskId, type TrackerTarget, type TrackerTask } from "./domain.js"
import type { CompleteTaskTrackerFactsObserved, TaskTrackerFactsObservation } from "./task-tracker-facts.js"
import { TaskTrackerFactsObservedEvent, TaskWorkSpecification } from "./task-tracker-facts.js"
import { reconfirmationMatchesPriorFullObservation } from "./task-tracker-reconfirmation.js"
import { taskTrackerTargetKey } from "./task-tracker-target.js"
import { projectTrackerSnapshot, type TaskDagSnapshot } from "./task-dag.js"

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

type GraphFactsObservation = Exclude<
  TaskTrackerFactsObservation,
  { readonly _tag: "FocusedTaskWorkSpecificationFacts" }
>

const isGraphFactsObservation = (observation: TaskTrackerFactsObservation): observation is GraphFactsObservation =>
  observation._tag !== "FocusedTaskWorkSpecificationFacts"

/** Journaled tracker facts cannot reconstruct the knowledge promised by one completed read. */
export class TaskTrackerKnowledgeUnavailable extends Schema.TaggedErrorClass<TaskTrackerKnowledgeUnavailable>()(
  "TaskTrackerKnowledgeUnavailable",
  { knowledge: Schema.Literals(["TaskGraph", "TaskWorkSpecification"]), operationId: OperationId }
) {}

const fullObservationForReconfirmation = (
  observations: ReadonlyArray<TaskTrackerFactsObservation>,
  reconfirmation: Extract<TaskTrackerFactsObservation, { readonly _tag: "UnchangedTaskTrackerFactsReconfirmed" }>
): CompleteTaskTrackerFactsObserved | undefined => {
  const full = observations.find(
    (candidate) =>
      candidate._tag === "CompleteTaskTrackerFacts" &&
      candidate.operationId === reconfirmation.priorFullObservationOperationId
  )
  if (full?._tag !== "CompleteTaskTrackerFacts") return undefined
  return reconfirmationMatchesPriorFullObservation(reconfirmation, full) ? full : undefined
}

/** Projects only complete journal-reconstructed facts into the graph selector input. */
export const reconstructedTaskGraphFor = (
  knowledge: { readonly taskTrackerFacts: ReadonlyArray<TaskTrackerFactsObservation> },
  target: typeof TrackerTarget.Type
): Option.Option<TaskDagSnapshot> => {
  const latest = knowledge.taskTrackerFacts.findLast(
    (candidate): candidate is GraphFactsObservation =>
      isGraphFactsObservation(candidate) && taskTrackerTargetKey(candidate.target) === taskTrackerTargetKey(target)
  )
  if (latest === undefined) return Option.none()
  const observation =
    latest._tag === "CompleteTaskTrackerFacts"
      ? latest
      : fullObservationForReconfirmation(knowledge.taskTrackerFacts, latest)
  if (observation?._tag !== "CompleteTaskTrackerFacts") return Option.none()
  const projected = projectTrackerSnapshot({
    revision: observation.factFamilies[0].contentIdentity,
    tasks: graphTasksFrom(observation)
  })
  return projected._tag === "Valid" ? Option.some(projected.snapshot) : Option.none()
}

/** Selects exact authored instructions only from a focused journaled observation. */
export const reconstructedTaskWorkSpecificationFor = (
  knowledge: { readonly taskTrackerFacts: ReadonlyArray<TaskTrackerFactsObservation> },
  taskId: TaskId
): Option.Option<TaskWorkSpecification> => {
  const observation = knowledge.taskTrackerFacts.findLast(
    (candidate) => candidate._tag === "FocusedTaskWorkSpecificationFacts" && candidate.factFamily.taskId === taskId
  )
  if (observation?._tag !== "FocusedTaskWorkSpecificationFacts") return Option.none()
  return Option.some(
    TaskWorkSpecification.make({
      body: observation.factFamily.body,
      fingerprint: observation.factFamily.fingerprint,
      taskId: observation.factFamily.taskId,
      title: observation.factFamily.title
    })
  )
}

/** Reconstructs usable graph knowledge only from decoded journal-event meanings. */
export const reconstructedTaskGraphFromEvents = (
  events: ReadonlyArray<unknown>,
  target: typeof TrackerTarget.Type
): Option.Option<TaskDagSnapshot> =>
  reconstructedTaskGraphFor(
    {
      taskTrackerFacts: events.flatMap((event) =>
        Option.toArray(
          Option.map(Schema.decodeUnknownOption(TaskTrackerFactsObservedEvent)(event), ({ observation }) => observation)
        )
      )
    },
    target
  )
