/* eslint-disable functional/immutable-data -- Process-local memo indexes mutate only private maps; projected values stay immutable. */
import { HashMap, Option, Schema } from "effect"
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

type ReconstructableGraphKnowledge = { readonly taskTrackerFacts: ReadonlyArray<TaskTrackerFactsObservation> }
interface GraphKnowledgeIndex {
  readonly observations: HashMap.HashMap<number, TaskTrackerFactsObservation>
  readonly length: number
  readonly completeByOperation: HashMap.HashMap<OperationId, CompleteTaskTrackerFactsObserved>
  readonly latestByTarget: HashMap.HashMap<string, GraphFactsObservation>
  readonly specifications: HashMap.HashMap<string, TaskTrackerFactsObservation>
  readonly latest: GraphFactsObservation | undefined
}
const graphIndexes = new WeakMap<ReconstructableGraphKnowledge, GraphKnowledgeIndex>()
const emptyGraphIndex = (): GraphKnowledgeIndex => ({
  observations: HashMap.empty(),
  length: 0,
  completeByOperation: HashMap.empty(),
  latestByTarget: HashMap.empty(),
  specifications: HashMap.empty(),
  latest: undefined
})
const addGraphObservation = (
  prior: GraphKnowledgeIndex,
  observation: TaskTrackerFactsObservation
): GraphKnowledgeIndex => ({
  observations: HashMap.set(prior.observations, prior.length, observation),
  length: prior.length + 1,
  completeByOperation:
    observation._tag === "CompleteTaskTrackerFacts" && !HashMap.has(prior.completeByOperation, observation.operationId)
      ? HashMap.set(prior.completeByOperation, observation.operationId, observation)
      : prior.completeByOperation,
  latestByTarget: isGraphFactsObservation(observation)
    ? HashMap.set(prior.latestByTarget, taskTrackerTargetKey(observation.target), observation)
    : prior.latestByTarget,
  specifications:
    observation._tag === "FocusedTaskWorkSpecificationFacts"
      ? HashMap.set(
          HashMap.set(
            prior.specifications,
            JSON.stringify([observation.factFamily.taskId, taskTrackerTargetKey(observation.target)]),
            observation
          ),
          JSON.stringify([observation.factFamily.taskId]),
          observation
        )
      : prior.specifications,
  latest: isGraphFactsObservation(observation) ? observation : prior.latest
})
const graphIndexFor = (knowledge: ReconstructableGraphKnowledge): GraphKnowledgeIndex => {
  const cached = graphIndexes.get(knowledge)
  if (cached !== undefined) return cached
  const index = knowledge.taskTrackerFacts.reduce(addGraphObservation, emptyGraphIndex())
  graphIndexes.set(knowledge, index)
  return index
}

/** Cold reconstruction builds these indexes before the first live successor. */
export const initializeDurableGraphKnowledge = (knowledge: ReconstructableGraphKnowledge): void => {
  graphIndexFor(knowledge)
}

/** Adds one observation using shared immutable indexes; historical arrays are explicit lazy exports. */
export const advanceDurableGraphKnowledge = (
  prior: ReconstructableGraphKnowledge,
  observation: TaskTrackerFactsObservation
): ReconstructableGraphKnowledge => {
  const index = addGraphObservation(graphIndexFor(prior), observation)
  return graphKnowledgeWithIndex(index)
}
const graphKnowledgeWithIndex = (index: GraphKnowledgeIndex): ReconstructableGraphKnowledge => {
  let exported: ReadonlyArray<TaskTrackerFactsObservation> | undefined
  const knowledge: ReconstructableGraphKnowledge = {
    get taskTrackerFacts() {
      return (exported ??= Array.from({ length: index.length }, (_, offset) =>
        Option.getOrThrow(HashMap.get(index.observations, offset))
      ))
    }
  }
  graphIndexes.set(knowledge, index)
  return knowledge
}
const reconstructedGraphsByKnowledge = new WeakMap<
  ReconstructableGraphKnowledge,
  Map<string, Option.Option<TaskDagSnapshot>>
>()
const latestGraphByKnowledge = new WeakMap<ReconstructableGraphKnowledge, Option.Option<TaskDagSnapshot>>()

/** Projects only complete journal-reconstructed facts into the graph selector input. */
export const reconstructedTaskGraphFor = (
  knowledge: ReconstructableGraphKnowledge,
  target: TrackerTarget
): Option.Option<TaskDagSnapshot> => {
  const targetKey = taskTrackerTargetKey(target)
  const cachedByTarget = reconstructedGraphsByKnowledge.get(knowledge)
  const cached = cachedByTarget?.get(targetKey)
  if (cached !== undefined) return cached
  const index = graphIndexFor(knowledge)
  const latest = Option.getOrUndefined(HashMap.get(index.latestByTarget, targetKey))
  if (latest === undefined) {
    const result = Option.none<TaskDagSnapshot>()
    const cache = cachedByTarget ?? new Map<string, Option.Option<TaskDagSnapshot>>()
    cache.set(targetKey, result)
    reconstructedGraphsByKnowledge.set(knowledge, cache)
    return result
  }
  const observation =
    latest._tag === "CompleteTaskTrackerFacts"
      ? latest
      : Option.getOrUndefined(
          Option.filter(HashMap.get(index.completeByOperation, latest.priorFullObservationOperationId), (full) =>
            reconfirmationMatchesPriorFullObservation(latest, full)
          )
        )
  const result = (() => {
    if (observation?._tag !== "CompleteTaskTrackerFacts") return Option.none<TaskDagSnapshot>()
    const projected = projectTrackerSnapshot({
      revision: observation.factFamilies[0].contentIdentity,
      ...(observation.rootTaskId === undefined ? {} : { rootTaskId: observation.rootTaskId }),
      tasks: graphTasksFrom(observation)
    })
    return projected._tag === "Valid" ? Option.some(projected.snapshot) : Option.none<TaskDagSnapshot>()
  })()
  const cache = cachedByTarget ?? new Map<string, Option.Option<TaskDagSnapshot>>()
  cache.set(targetKey, result)
  reconstructedGraphsByKnowledge.set(knowledge, cache)
  return result
}

/** Reconstructs the latest complete graph regardless of its one Run's provider-neutral target shape. */
export const latestReconstructedTaskGraph = (
  knowledge: ReconstructableGraphKnowledge
): Option.Option<TaskDagSnapshot> => {
  const cached = latestGraphByKnowledge.get(knowledge)
  if (cached !== undefined) return cached
  const latest = graphIndexFor(knowledge).latest
  const result =
    latest === undefined ? Option.none<TaskDagSnapshot>() : reconstructedTaskGraphFor(knowledge, latest.target)
  latestGraphByKnowledge.set(knowledge, result)
  return result
}

/** Selects exact authored instructions only from a focused journaled observation. */
export const reconstructedTaskWorkSpecificationFor = (
  knowledge: { readonly taskTrackerFacts: ReadonlyArray<TaskTrackerFactsObservation> },
  taskId: TaskId,
  immutableRunTarget?: TrackerTarget
): Option.Option<TaskWorkSpecification> => {
  const key =
    immutableRunTarget === undefined
      ? JSON.stringify([taskId])
      : JSON.stringify([taskId, taskTrackerTargetKey(immutableRunTarget)])
  const observation = Option.getOrUndefined(HashMap.get(graphIndexFor(knowledge).specifications, key))
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
        typeof event === "object" && event !== null && "_tag" in event && event._tag === "TaskTrackerFactsObserved"
          ? Option.toArray(
              Option.map(
                Schema.decodeUnknownOption(TaskTrackerFactsObservedEvent)(event),
                ({ observation }) => observation
              )
            )
          : []
      )
    },
    target
  )
