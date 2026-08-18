/* eslint-disable functional/immutable-data -- Local builder and traversal scratch never escapes the opaque snapshot. */
import { Graph, HashMap, HashSet, Option, Order, Result, Schema } from "effect"
import { encodeTaskRevisionFingerprint, TaskId, type TaskRevision } from "@dalph/contracts"
import {
  isDependencySatisfied,
  isTaskOpen,
  type Task,
  TaskLifecycle,
  TrackerRevision,
  TrackerSnapshot,
  type TrackerTask
} from "./task.js"

export const ProjectionIssue = Schema.TaggedUnion({
  BoundaryDecodeFailed: { detail: Schema.String },
  DuplicateTask: { taskId: TaskId },
  DuplicatePrerequisite: { dependant: TaskId, prerequisite: TaskId },
  MissingPrerequisite: { dependant: TaskId, prerequisite: TaskId },
  SelfPrerequisite: { taskId: TaskId },
  MissingParent: { child: TaskId, parent: TaskId },
  SelfParent: { taskId: TaskId },
  Cycle: { taskIds: Schema.Array(TaskId) },
  ContainmentCycle: { taskIds: Schema.Array(TaskId) }
})
export type ProjectionIssue = typeof ProjectionIssue.Type

export class GraphProjectionError extends Schema.TaggedError<GraphProjectionError>()("TaskDag.GraphProjectionError", {
  issues: Schema.Array(ProjectionIssue)
}) {}

const taskDagSchemaVersion = 1 as const

const TaskDagWireTaskV1 = Schema.Struct({
  id: TaskId,
  lifecycle: TaskLifecycle,
  parentTaskId: Schema.NullOr(TaskId),
  prerequisiteIds: Schema.Array(TaskId)
})

export const TaskDagWire = Schema.Struct({
  schemaVersion: Schema.Literal(taskDagSchemaVersion),
  revision: TrackerRevision,
  tasks: Schema.Array(TaskDagWireTaskV1)
})
export type TaskDagWire = typeof TaskDagWire.Type

type ProjectionResult =
  | { readonly _tag: "Invalid"; readonly issues: ReadonlyArray<ProjectionIssue> }
  | { readonly _tag: "Valid"; readonly snapshot: TaskDagSnapshot }

/** A tracker task represented as one node in the normalized task graph. */
interface TaskGraphNode {
  readonly id: TaskId
  readonly lifecycle: TaskLifecycle
}

/**
 * Distinguishes a prerequisite edge from a grouping edge in the one normalized
 * task graph. Prerequisite edges point prerequisite → dependant; grouping edges
 * point parent → child.
 */
const TaskGraphEdge = Schema.TaggedUnion({ Prerequisite: {}, Grouping: {} })
type TaskGraphEdge = typeof TaskGraphEdge.Type

const prerequisiteEdge = TaskGraphEdge.cases.Prerequisite.make({})
const groupingEdge = TaskGraphEdge.cases.Grouping.make({})

const taskProjectionRevision = (task: Task): TaskRevision =>
  encodeTaskRevisionFingerprint(
    JSON.stringify({
      id: task.id,
      lifecycle: task.lifecycle._tag,
      parentTaskId: task.parentTaskId,
      prerequisiteIds: sorted(HashSet.fromIterable(task.prerequisiteIds))
    })
  )

/**
 * Derives the opaque, diagnostically reversible task revision fingerprint bound
 * to an attempt. The contract covers every normalized task field: identity,
 * lifecycle, parent grouping edge, and the order-independent prerequisite set.
 * Adding normalized task meaning requires adding it to this projection.
 */
export const taskRevisionFor = taskProjectionRevision

const compareTaskIds: Order.Order<TaskId> = Order.String

const sorted = (taskIds: Iterable<TaskId>): ReadonlyArray<TaskId> => [...taskIds].sort(compareTaskIds)

const parentTaskIdOrder = Order.mapInput(
  Order.Tuple([Order.Boolean, Order.String]),
  (parentTaskId: TaskId | null) => [parentTaskId !== null, parentTaskId ?? ""] as const
)

const compareTrackerTasks = Order.mapInput(
  Order.Tuple([Order.String, parentTaskIdOrder, Order.Array(compareTaskIds)]),
  (record: TrackerTask) =>
    [record.lifecycle._tag, record.parentTaskId, [...record.prerequisiteIds].sort(compareTaskIds)] as const
)

const getMapValueOrThrow = <Key, Value>(values: ReadonlyMap<Key, Value>, key: Key): Value =>
  Option.getOrThrow(Option.fromUndefinedOr(values.get(key)))

const collectTaskRecords = (
  records: ReadonlyArray<TrackerTask>,
  issues: Array<ProjectionIssue>
): Map<TaskId, TrackerTask> => {
  const recordsById = new Map<TaskId, TrackerTask>()
  for (const record of records) {
    if (recordsById.has(record.id)) {
      issues.push(ProjectionIssue.cases.DuplicateTask.make({ taskId: record.id }))
    } else {
      recordsById.set(record.id, record)
    }
  }
  return recordsById
}

const validatePrerequisites = (
  record: TrackerTask,
  recordsById: ReadonlyMap<TaskId, TrackerTask>,
  issues: Array<ProjectionIssue>
): void => {
  const prerequisiteIds = [...record.prerequisiteIds].sort(compareTaskIds)
  for (const [index, prerequisite] of prerequisiteIds.entries()) {
    if (prerequisite === prerequisiteIds[index - 1]) {
      issues.push(ProjectionIssue.cases.DuplicatePrerequisite.make({ dependant: record.id, prerequisite }))
      continue
    }
    if (prerequisite === record.id) {
      issues.push(ProjectionIssue.cases.SelfPrerequisite.make({ taskId: record.id }))
    } else if (!recordsById.has(prerequisite)) {
      issues.push(ProjectionIssue.cases.MissingPrerequisite.make({ dependant: record.id, prerequisite }))
    }
  }
}

const validateParent = (
  record: TrackerTask,
  recordsById: ReadonlyMap<TaskId, TrackerTask>,
  issues: Array<ProjectionIssue>
): void => {
  if (record.parentTaskId === record.id) {
    issues.push(ProjectionIssue.cases.SelfParent.make({ taskId: record.id }))
  } else if (record.parentTaskId !== null && !recordsById.has(record.parentTaskId)) {
    issues.push(ProjectionIssue.cases.MissingParent.make({ child: record.id, parent: record.parentTaskId }))
  }
}

interface TaskGraphRepresentation {
  readonly graph: Graph.DirectedGraph<TaskGraphNode, TaskGraphEdge>
  readonly nodeIndexByTaskId: HashMap.HashMap<TaskId, Graph.NodeIndex>
}

const taskGraphRepresentationFrom = (recordsById: ReadonlyMap<TaskId, TrackerTask>): TaskGraphRepresentation => {
  const indexesByTaskId = new Map<TaskId, Graph.NodeIndex>()
  const taskIds = sorted(recordsById.keys())
  const graph = Graph.directed<TaskGraphNode, TaskGraphEdge>((mutable) => {
    for (const taskId of taskIds) {
      const task = getMapValueOrThrow(recordsById, taskId)
      indexesByTaskId.set(taskId, Graph.addNode(mutable, { id: taskId, lifecycle: task.lifecycle }))
    }

    for (const taskId of taskIds) {
      const task = getMapValueOrThrow(recordsById, taskId)
      const taskIndex = getMapValueOrThrow(indexesByTaskId, taskId)
      for (const prerequisiteId of sorted(task.prerequisiteIds)) {
        const prerequisiteIndex = indexesByTaskId.get(prerequisiteId)
        if (prerequisiteIndex !== undefined) {
          Graph.addEdge(mutable, prerequisiteIndex, taskIndex, prerequisiteEdge)
        }
      }
      if (task.parentTaskId !== null) {
        const parentIndex = indexesByTaskId.get(task.parentTaskId)
        if (parentIndex !== undefined) Graph.addEdge(mutable, parentIndex, taskIndex, groupingEdge)
      }
    }
  })
  return { graph, nodeIndexByTaskId: HashMap.fromIterable(indexesByTaskId) }
}

const graphForRelation = (
  graph: Graph.DirectedGraph<TaskGraphNode, TaskGraphEdge>,
  relation: TaskGraphEdge["_tag"]
): Graph.DirectedGraph<TaskGraphNode, TaskGraphEdge> =>
  Graph.mutate(graph, (mutable) => {
    Graph.filterEdges(mutable, (edge) => edge._tag === relation)
    return undefined
  })

const taskNodeAt = (
  graph: Graph.DirectedGraph<TaskGraphNode, TaskGraphEdge>,
  nodeIndex: Graph.NodeIndex
): TaskGraphNode => Option.getOrThrow(Graph.getNode(graph, nodeIndex))

const taskIdsForRelation = (
  graph: Graph.DirectedGraph<TaskGraphNode, TaskGraphEdge>,
  relation: TaskGraphEdge["_tag"],
  nodeIndex: Graph.NodeIndex,
  direction: Graph.Direction
): ReadonlyArray<TaskId> =>
  sorted(
    Array.from(Graph.values(Graph.edges(graph))).flatMap((edge) => {
      if (edge.data._tag !== relation) return []
      if (direction === "outgoing" && edge.source === nodeIndex) return [taskNodeAt(graph, edge.target).id]
      if (direction === "incoming" && edge.target === nodeIndex) return [taskNodeAt(graph, edge.source).id]
      return []
    })
  )

const cycleTaskIds = (
  graph: Graph.DirectedGraph<TaskGraphNode, TaskGraphEdge>,
  relation: TaskGraphEdge["_tag"]
): ReadonlyArray<ReadonlyArray<TaskId>> => {
  const components = Graph.stronglyConnectedComponents(graphForRelation(graph, relation))
    .filter((component) => component.length > 1)
    .map((component) => sorted(component.map((nodeIndex) => taskNodeAt(graph, nodeIndex).id)))

  const nodeIndexByTaskId = HashMap.fromIterable(
    Array.from(Graph.nodes(graph), ([nodeIndex, node]) => [node.id, nodeIndex] as const)
  )
  const componentByTaskId = new Map<TaskId, ReadonlyArray<TaskId>>()
  for (const component of components) {
    for (const taskId of component) componentByTaskId.set(taskId, component)
  }

  const emitted = new Set<ReadonlyArray<TaskId>>()
  const ordered: Array<ReadonlyArray<TaskId>> = []
  const visit = (component: ReadonlyArray<TaskId>): void => {
    if (emitted.has(component)) return
    emitted.add(component)
    const precedingComponents = sorted(
      new Set(
        component.flatMap((taskId) =>
          taskIdsForRelation(graph, relation, HashMap.getUnsafe(nodeIndexByTaskId, taskId), "incoming")
        )
      )
    ).flatMap((taskId) => {
      const preceding = componentByTaskId.get(taskId)
      return preceding === undefined || preceding === component ? [] : [preceding]
    })
    for (const preceding of precedingComponents) visit(preceding)
    ordered.push(component)
  }

  const head = (component: ReadonlyArray<TaskId>): TaskId => Option.getOrThrow(Option.fromUndefinedOr(component[0]))
  for (const component of [...components].sort((left, right) => compareTaskIds(head(left), head(right))))
    visit(component)
  return ordered
}

export class TaskDagSnapshot {
  private constructor(
    readonly revision: TrackerRevision,
    private readonly graph: Graph.DirectedGraph<TaskGraphNode, TaskGraphEdge>,
    private readonly nodeIndexByTaskId: HashMap.HashMap<TaskId, Graph.NodeIndex>
  ) {}

  static project(decoded: TrackerSnapshot): ProjectionResult {
    const issues: Array<ProjectionIssue> = []
    const records = [...decoded.tasks].sort((left, right) => {
      const idOrder = compareTaskIds(left.id, right.id)
      return idOrder === 0 ? compareTrackerTasks(left, right) : idOrder
    })
    const recordsById = collectTaskRecords(records, issues)

    for (const record of records) {
      validatePrerequisites(record, recordsById, issues)
      validateParent(record, recordsById, issues)
    }

    const representation = taskGraphRepresentationFrom(recordsById)

    issues.push(
      ...cycleTaskIds(representation.graph, "Prerequisite").map((taskIds) =>
        ProjectionIssue.cases.Cycle.make({ taskIds })
      ),
      ...cycleTaskIds(representation.graph, "Grouping").map((taskIds) =>
        ProjectionIssue.cases.ContainmentCycle.make({ taskIds })
      )
    )
    return issues.length > 0
      ? { _tag: "Invalid", issues }
      : {
          _tag: "Valid",
          snapshot: new TaskDagSnapshot(decoded.revision, representation.graph, representation.nodeIndexByTaskId)
        }
  }

  /** Returns normalized runnable task values, never provider-specific records. */
  eligibleTasks(): ReadonlyArray<Task> {
    return this.eligibleTaskIds().map((taskId) => {
      const node = taskNodeAt(this.graph, HashMap.getUnsafe(this.nodeIndexByTaskId, taskId))
      return {
        id: taskId,
        lifecycle: node.lifecycle,
        parentTaskId: Option.getOrNull(this.parentTaskIdOf(taskId)),
        prerequisiteIds: this.prerequisitesOf(taskId)
      }
    })
  }

  taskIds(): ReadonlyArray<TaskId> {
    return Array.from(Graph.values(Graph.nodes(this.graph)), (node) => node.id)
  }

  lifecycleOf(taskId: TaskId): Option.Option<TaskLifecycle> {
    return Option.flatMap(HashMap.get(this.nodeIndexByTaskId, taskId), (nodeIndex) =>
      Option.map(Graph.getNode(this.graph, nodeIndex), (node) => node.lifecycle)
    )
  }

  parentTaskIdOf(taskId: TaskId): Option.Option<TaskId | null> {
    return Option.map(HashMap.get(this.nodeIndexByTaskId, taskId), (nodeIndex) =>
      Option.getOrNull(Option.fromUndefinedOr(taskIdsForRelation(this.graph, "Grouping", nodeIndex, "incoming")[0]))
    )
  }

  childrenOf(parentTaskId: TaskId): ReadonlyArray<TaskId> {
    const parentIndex = HashMap.get(this.nodeIndexByTaskId, parentTaskId)
    return Option.isSome(parentIndex) ? taskIdsForRelation(this.graph, "Grouping", parentIndex.value, "outgoing") : []
  }

  /** The selected task and every current descendant reached only through tracker grouping edges. */
  groupingSubtreeOf(taskId: TaskId): ReadonlyArray<TaskId> {
    const start = HashMap.get(this.nodeIndexByTaskId, taskId)
    if (Option.isNone(start)) return []
    return Array.from(
      Graph.values(Graph.bfs(graphForRelation(this.graph, "Grouping"), { start: [start.value] })),
      (node) => node.id
    )
  }

  prerequisitesOf(taskId: TaskId): ReadonlyArray<TaskId> {
    const taskIndex = HashMap.get(this.nodeIndexByTaskId, taskId)
    return Option.isSome(taskIndex) ? taskIdsForRelation(this.graph, "Prerequisite", taskIndex.value, "incoming") : []
  }

  dependantsOf(prerequisite: TaskId): ReadonlyArray<TaskId> {
    const prerequisiteIndex = HashMap.get(this.nodeIndexByTaskId, prerequisite)
    return Option.isSome(prerequisiteIndex)
      ? taskIdsForRelation(this.graph, "Prerequisite", prerequisiteIndex.value, "outgoing")
      : []
  }

  topologicalOrder(): ReadonlyArray<TaskId> {
    const taskIds = this.taskIds()
    const remainingPrerequisites = new Map<TaskId, number>(
      taskIds.map((taskId) => [taskId, this.prerequisitesOf(taskId).length])
    )
    const ready = taskIds.filter((taskId) => remainingPrerequisites.get(taskId) === 0)
    const order: Array<TaskId> = []

    while (ready.length > 0) {
      const taskId = Option.getOrThrow(Option.fromUndefinedOr(ready.shift()))
      order.push(taskId)
      for (const dependant of this.dependantsOf(taskId)) {
        const remaining = getMapValueOrThrow(remainingPrerequisites, dependant) - 1
        remainingPrerequisites.set(dependant, remaining)
        if (remaining === 0) {
          ready.push(dependant)
          ready.sort(compareTaskIds)
        }
      }
    }

    return order
  }

  eligibleTaskIds(): ReadonlyArray<TaskId> {
    return this.taskIds().filter((taskId) => {
      const lifecycle = this.lifecycleOf(taskId)
      if (!Option.isSome(lifecycle) || !isTaskOpen(lifecycle.value)) {
        return false
      }
      return this.prerequisitesOf(taskId).every((prerequisite) => {
        const prerequisiteLifecycle = this.lifecycleOf(prerequisite)
        return Option.isSome(prerequisiteLifecycle) && isDependencySatisfied(prerequisiteLifecycle.value)
      })
    })
  }

  toWire(): TaskDagWire {
    return {
      schemaVersion: taskDagSchemaVersion,
      revision: this.revision,
      tasks: this.taskIds().map((id) => {
        const node = taskNodeAt(this.graph, HashMap.getUnsafe(this.nodeIndexByTaskId, id))
        return {
          id,
          lifecycle: node.lifecycle,
          parentTaskId: Option.getOrNull(this.parentTaskIdOf(id)),
          prerequisiteIds: this.prerequisitesOf(id)
        }
      })
    }
  }

  canonicalJson(): string {
    return JSON.stringify(Schema.encodeUnknownSync(TaskDagWire)(this.toWire()))
  }
}

const projectDecodedSnapshot = (decoded: Result.Result<TrackerSnapshot, unknown>): ProjectionResult =>
  Result.isFailure(decoded)
    ? {
        _tag: "Invalid",
        issues: [ProjectionIssue.cases.BoundaryDecodeFailed.make({ detail: String(decoded.failure) })]
      }
    : TaskDagSnapshot.project(decoded.success)

export const projectTrackerSnapshot = (input: unknown): ProjectionResult =>
  projectDecodedSnapshot(Schema.decodeUnknownResult(TrackerSnapshot)(input))

export const projectTaskDagWire = (input: unknown): ProjectionResult =>
  projectDecodedSnapshot(Schema.decodeUnknownResult(TaskDagWire)(input))
