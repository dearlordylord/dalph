import { Option, Schema } from "effect"
import { type TaskId } from "@dalph/contracts"
import { OperationId } from "../../workflow/identity.js"
import { type TrackerTask } from "../../authorities/task-tracker/task.js"
import { type TrackerTarget } from "../../authorities/task-tracker/target.js"
import type {
  CompleteTaskTrackerFactsObserved,
  TaskTrackerFactsObservation
} from "../../workflow/task-tracker-facts/observation.js"
import { TaskTrackerFactsObservedEvent } from "../../workflow/task-tracker-facts/observation.js"
import { TaskWorkSpecification } from "@dalph/contracts"
import { reconfirmationMatchesPriorFullObservation } from "../../workflow/task-tracker-facts/reconfirmation.js"
import { taskTrackerTargetKey } from "../../authorities/task-tracker/target.js"
import { projectTrackerSnapshot, type TaskDagSnapshot } from "../../authorities/task-tracker/graph.js"

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

type GraphFactsObservation = Extract<
  TaskTrackerFactsObservation,
  { readonly _tag: "CompleteTaskTrackerFacts" | "UnchangedTaskTrackerFactsReconfirmed" }
>

const isGraphFactsObservation = (observation: TaskTrackerFactsObservation): observation is GraphFactsObservation =>
  observation._tag === "CompleteTaskTrackerFacts" || observation._tag === "UnchangedTaskTrackerFactsReconfirmed"

/** Journaled tracker facts cannot reconstruct the knowledge promised by one completed read. */
export class TaskTrackerKnowledgeUnavailable extends Schema.TaggedError<TaskTrackerKnowledgeUnavailable>()(
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
  target: TrackerTarget
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

/** Reconstructs the latest complete graph regardless of its one Run's provider-neutral target shape. */
export const latestReconstructedTaskGraph = (knowledge: {
  readonly taskTrackerFacts: ReadonlyArray<TaskTrackerFactsObservation>
}): Option.Option<TaskDagSnapshot> => {
  const latest = knowledge.taskTrackerFacts.findLast(isGraphFactsObservation)
  return latest === undefined ? Option.none() : reconstructedTaskGraphFor(knowledge, latest.target)
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
  target: TrackerTarget
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
