/* eslint-disable functional/immutable-data -- Local builder and traversal scratch never escapes the opaque snapshot. */
import { HashMap, HashSet, Option, Order, Result, Schema } from "effect"
import {
  isDependencySatisfied,
  isTaskOpen,
  type Task,
  TaskId,
  TaskLifecycle,
  TrackerRevision,
  TrackerSnapshot,
  type TrackerTask
} from "./domain.js"

export const ProjectionIssue = Schema.TaggedUnion({
  BoundaryDecodeFailed: { detail: Schema.String },
  DuplicateTask: { taskId: TaskId },
  DuplicatePrerequisite: {
    dependant: TaskId,
    prerequisite: TaskId
  },
  MissingPrerequisite: {
    dependant: TaskId,
    prerequisite: TaskId
  },
  SelfPrerequisite: { taskId: TaskId },
  MissingParent: {
    child: TaskId,
    parent: TaskId
  },
  SelfParent: { taskId: TaskId },
  Cycle: { taskIds: Schema.Array(TaskId) },
  ContainmentCycle: { taskIds: Schema.Array(TaskId) }
})
export type ProjectionIssue = typeof ProjectionIssue.Type

export class GraphProjectionError extends Schema.TaggedErrorClass<GraphProjectionError>()(
  "TaskDag.GraphProjectionError",
  { issues: Schema.Array(ProjectionIssue) }
) {}

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
  | {
    readonly _tag: "Invalid"
    readonly issues: ReadonlyArray<ProjectionIssue>
  }
  | { readonly _tag: "Valid"; readonly snapshot: TaskDagSnapshot }

interface TaskProjection {
  readonly lifecycle: TaskLifecycle
  readonly parentTaskId: TaskId | null
  readonly prerequisiteIds: HashSet.HashSet<TaskId>
}

const compareTaskIds: Order.Order<TaskId> = Order.String

const sorted = (taskIds: Iterable<TaskId>): ReadonlyArray<TaskId> => [...taskIds].sort(compareTaskIds)

const parentTaskIdOrder = Order.mapInput(
  Order.Tuple([Order.Boolean, Order.String]),
  (parentTaskId: TaskId | null) =>
    [
      parentTaskId !== null,
      parentTaskId ?? ""
    ] as const
)

const compareTrackerTasks = Order.mapInput(
  Order.Tuple([Order.String, parentTaskIdOrder, Order.Array(compareTaskIds)]),
  (record: TrackerTask) =>
    [
      record.lifecycle._tag,
      record.parentTaskId,
      [...record.prerequisiteIds].sort(compareTaskIds)
    ] as const
)

const taskProjection = (
  tasks: HashMap.HashMap<TaskId, TaskProjection>,
  taskId: TaskId
): Option.Option<TaskProjection> => HashMap.get(tasks, taskId)

const getMapValueOrThrow = <Key, Value>(
  values: Map<Key, Value>,
  key: Key
): Value => Option.getOrThrow(Option.fromUndefinedOr(values.get(key)))

const stronglyConnectedComponents = (
  tasks: HashMap.HashMap<TaskId, TaskProjection>,
  adjacentTaskIds: (
    taskId: TaskId,
    projection: TaskProjection
  ) => Iterable<TaskId>
): ReadonlyArray<ReadonlyArray<TaskId>> => {
  let nextIndex = 0
  const indexes = new Map<TaskId, number>()
  const lowLinks = new Map<TaskId, number>()
  const stack: Array<TaskId> = []
  const onStack = new Set<TaskId>()
  const components: Array<ReadonlyArray<TaskId>> = []

  const visit = (taskId: TaskId): void => {
    const index = nextIndex++
    indexes.set(taskId, index)
    lowLinks.set(taskId, index)
    stack.push(taskId)
    onStack.add(taskId)

    const projection = HashMap.getUnsafe(tasks, taskId)
    for (const adjacentTaskId of sorted(adjacentTaskIds(taskId, projection))) {
      if (!HashMap.has(tasks, adjacentTaskId)) continue
      if (!indexes.has(adjacentTaskId)) {
        visit(adjacentTaskId)
        lowLinks.set(
          taskId,
          Math.min(
            getMapValueOrThrow(lowLinks, taskId),
            getMapValueOrThrow(lowLinks, adjacentTaskId)
          )
        )
      } else if (onStack.has(adjacentTaskId)) {
        lowLinks.set(
          taskId,
          Math.min(
            getMapValueOrThrow(lowLinks, taskId),
            getMapValueOrThrow(indexes, adjacentTaskId)
          )
        )
      }
    }

    if (
      getMapValueOrThrow(lowLinks, taskId)
        !== getMapValueOrThrow(indexes, taskId)
    ) return

    const component: Array<TaskId> = []
    while (stack.length > 0) {
      const member = Option.getOrThrow(Option.fromUndefinedOr(stack.pop()))
      onStack.delete(member)
      component.push(member)
      if (member === taskId) break
    }
    if (component.length > 1) components.push(sorted(component))
  }

  for (const taskId of sorted(HashMap.keys(tasks))) {
    if (!indexes.has(taskId)) visit(taskId)
  }

  return components
}

export class TaskDagSnapshot {
  private constructor(
    readonly revision: TrackerRevision,
    private readonly tasks: HashMap.HashMap<TaskId, TaskProjection>
  ) {}

  static project(decoded: typeof TrackerSnapshot.Type): ProjectionResult {
    const issues: Array<ProjectionIssue> = []
    const recordsById = new Map<TaskId, TrackerTask>()
    const records = [...decoded.tasks].sort((left, right) => {
      const idOrder = compareTaskIds(left.id, right.id)
      return idOrder === 0 ? compareTrackerTasks(left, right) : idOrder
    })

    for (const record of records) {
      if (recordsById.has(record.id)) {
        issues.push(
          ProjectionIssue.cases.DuplicateTask.make({ taskId: record.id })
        )
      } else {
        recordsById.set(record.id, record)
      }
    }

    for (const record of records) {
      const taskId = record.id
      const prerequisiteIds = [...record.prerequisiteIds].sort(compareTaskIds)
      let previous: TaskId | undefined

      for (const prerequisite of prerequisiteIds) {
        if (prerequisite === previous) {
          issues.push(
            ProjectionIssue.cases.DuplicatePrerequisite.make({
              dependant: taskId,
              prerequisite
            })
          )
          continue
        }
        previous = prerequisite
        if (prerequisite === taskId) {
          issues.push(
            ProjectionIssue.cases.SelfPrerequisite.make({ taskId })
          )
        } else if (!recordsById.has(prerequisite)) {
          issues.push(
            ProjectionIssue.cases.MissingPrerequisite.make({
              dependant: taskId,
              prerequisite
            })
          )
        }
      }

      if (record.parentTaskId === taskId) {
        issues.push(ProjectionIssue.cases.SelfParent.make({ taskId }))
      } else if (
        record.parentTaskId !== null
        && !recordsById.has(record.parentTaskId)
      ) {
        issues.push(
          ProjectionIssue.cases.MissingParent.make({
            child: taskId,
            parent: record.parentTaskId
          })
        )
      }
    }

    let tasks = HashMap.empty<TaskId, TaskProjection>()
    for (const [taskId, record] of recordsById) {
      tasks = HashMap.set(tasks, taskId, {
        lifecycle: record.lifecycle,
        parentTaskId: record.parentTaskId,
        prerequisiteIds: HashSet.fromIterable(record.prerequisiteIds)
      })
    }

    issues.push(
      ...stronglyConnectedComponents(
        tasks,
        (_taskId, projection) => projection.prerequisiteIds
      ).map((taskIds) => ProjectionIssue.cases.Cycle.make({ taskIds })),
      ...stronglyConnectedComponents(
        tasks,
        (_taskId, projection) =>
          projection.parentTaskId === null
            ? []
            : [projection.parentTaskId]
      ).map((taskIds) => ProjectionIssue.cases.ContainmentCycle.make({ taskIds }))
    )
    return issues.length > 0
      ? { _tag: "Invalid", issues }
      : {
        _tag: "Valid",
        snapshot: new TaskDagSnapshot(decoded.revision, tasks)
      }
  }

  /** Returns normalized runnable task values, never provider-specific records. */
  eligibleTasks(): ReadonlyArray<Task> {
    return this.eligibleTaskIds().map((taskId) => {
      const projection = HashMap.getUnsafe(this.tasks, taskId)
      return {
        id: taskId,
        lifecycle: projection.lifecycle,
        parentTaskId: projection.parentTaskId,
        prerequisiteIds: sorted(projection.prerequisiteIds)
      }
    })
  }

  taskIds(): ReadonlyArray<TaskId> {
    return sorted(HashMap.keys(this.tasks))
  }

  lifecycleOf(taskId: TaskId): Option.Option<TaskLifecycle> {
    return Option.map(
      taskProjection(this.tasks, taskId),
      (projection) => projection.lifecycle
    )
  }

  parentTaskIdOf(taskId: TaskId): Option.Option<TaskId | null> {
    return Option.map(
      taskProjection(this.tasks, taskId),
      (projection) => projection.parentTaskId
    )
  }

  childrenOf(parentTaskId: TaskId): ReadonlyArray<TaskId> {
    return this.taskIds().filter(
      (taskId) => HashMap.getUnsafe(this.tasks, taskId).parentTaskId === parentTaskId
    )
  }

  prerequisitesOf(taskId: TaskId): ReadonlyArray<TaskId> {
    const projection = taskProjection(this.tasks, taskId)
    return Option.isSome(projection)
      ? sorted(projection.value.prerequisiteIds)
      : []
  }

  dependantsOf(prerequisite: TaskId): ReadonlyArray<TaskId> {
    return this.taskIds().filter((taskId) => this.prerequisitesOf(taskId).includes(prerequisite))
  }

  topologicalOrder(): ReadonlyArray<TaskId> {
    const taskIds = this.taskIds()
    const remainingPrerequisites = new Map<TaskId, number>(
      taskIds.map((taskId) => [taskId, this.prerequisitesOf(taskId).length])
    )
    const ready = taskIds.filter(
      (taskId) => remainingPrerequisites.get(taskId) === 0
    )
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
        return (
          Option.isSome(prerequisiteLifecycle)
          && isDependencySatisfied(prerequisiteLifecycle.value)
        )
      })
    })
  }

  toWire(): TaskDagWire {
    return {
      schemaVersion: taskDagSchemaVersion,
      revision: this.revision,
      tasks: this.taskIds().map((id) => {
        const projection = HashMap.getUnsafe(this.tasks, id)
        return {
          id,
          lifecycle: projection.lifecycle,
          parentTaskId: projection.parentTaskId,
          prerequisiteIds: sorted(projection.prerequisiteIds)
        }
      })
    }
  }

  canonicalJson(): string {
    return JSON.stringify(
      Schema.encodeUnknownSync(TaskDagWire)(this.toWire())
    )
  }
}

const projectDecodedSnapshot = (
  decoded: Result.Result<typeof TrackerSnapshot.Type, unknown>
): ProjectionResult =>
  Result.isFailure(decoded)
    ? {
      _tag: "Invalid",
      issues: [
        ProjectionIssue.cases.BoundaryDecodeFailed.make({
          detail: String(decoded.failure)
        })
      ]
    }
    : TaskDagSnapshot.project(decoded.success)

export const projectTrackerSnapshot = (input: unknown): ProjectionResult =>
  projectDecodedSnapshot(Schema.decodeUnknownResult(TrackerSnapshot)(input))

export const projectTaskDagWire = (input: unknown): ProjectionResult =>
  projectDecodedSnapshot(Schema.decodeUnknownResult(TaskDagWire)(input))
