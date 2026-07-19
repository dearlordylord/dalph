/* eslint-disable functional/immutable-data -- Local builder and traversal scratch never escapes the opaque snapshot. */
import { HashMap, HashSet, Option, Result, Schema } from "effect"
import { TaskId, type TaskLifecycle, type TrackerRevision, TrackerSnapshot, type TrackerTask } from "./domain.js"

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
  Cycle: { taskIds: Schema.Array(TaskId) }
})
export type ProjectionIssue = typeof ProjectionIssue.Type

export class GraphProjectionError extends Schema.TaggedErrorClass<GraphProjectionError>()(
  "TaskDag.GraphProjectionError",
  { issues: Schema.Array(ProjectionIssue) }
) {}

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

const before = -1
const compareCodeUnits = (left: string, right: string): number => left < right ? before : left > right ? 1 : 0

const compareTaskIds = compareCodeUnits

const sorted = (taskIds: Iterable<TaskId>): ReadonlyArray<TaskId> => [...taskIds].sort(compareTaskIds)

const recordSignature = (record: TrackerTask): string =>
  JSON.stringify({
    lifecycle: record.lifecycle,
    parentTaskId: record.parentTaskId,
    prerequisiteIds: [...record.prerequisiteIds].sort(compareTaskIds)
  })

const taskProjection = (
  tasks: HashMap.HashMap<TaskId, TaskProjection>,
  taskId: TaskId
): Option.Option<TaskProjection> => HashMap.get(tasks, taskId)

const stronglyConnectedCycles = (
  tasks: HashMap.HashMap<TaskId, TaskProjection>
): ReadonlyArray<ProjectionIssue> => {
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

    const projection = taskProjection(tasks, taskId)
    if (Option.isSome(projection)) {
      for (const prerequisite of sorted(projection.value.prerequisiteIds)) {
        if (!HashMap.has(tasks, prerequisite)) continue
        if (!indexes.has(prerequisite)) {
          visit(prerequisite)
          lowLinks.set(
            taskId,
            Math.min(
              lowLinks.get(taskId) ?? index,
              lowLinks.get(prerequisite) ?? index
            )
          )
        } else if (onStack.has(prerequisite)) {
          lowLinks.set(
            taskId,
            Math.min(
              lowLinks.get(taskId) ?? index,
              indexes.get(prerequisite) ?? index
            )
          )
        }
      }
    }

    if (lowLinks.get(taskId) !== indexes.get(taskId)) return

    const component: Array<TaskId> = []
    while (stack.length > 0) {
      const member = stack.pop()
      if (member === undefined) break
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
    .sort((left, right) => {
      const leftFirst = left[0]
      const rightFirst = right[0]
      if (leftFirst === undefined) return rightFirst === undefined ? 0 : before
      if (rightFirst === undefined) return 1
      return compareTaskIds(leftFirst, rightFirst)
    })
    .map((taskIds) => ProjectionIssue.cases.Cycle.make({ taskIds }))
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
      return idOrder === 0
        ? compareCodeUnits(recordSignature(left), recordSignature(right))
        : idOrder
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

    let tasks = HashMap.empty<TaskId, TaskProjection>()
    for (const [taskId, record] of recordsById) {
      const prerequisiteIds = [...record.prerequisiteIds].sort(compareTaskIds)
      const uniquePrerequisites: Array<TaskId> = []
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
        uniquePrerequisites.push(prerequisite)
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

      tasks = HashMap.set(tasks, taskId, {
        lifecycle: record.lifecycle,
        parentTaskId: record.parentTaskId,
        prerequisiteIds: HashSet.fromIterable(uniquePrerequisites)
      })
    }

    issues.push(...stronglyConnectedCycles(tasks))
    return issues.length > 0
      ? { _tag: "Invalid", issues }
      : {
        _tag: "Valid",
        snapshot: new TaskDagSnapshot(decoded.revision, tasks)
      }
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
    return this.taskIds().filter((taskId) => {
      const projection = taskProjection(this.tasks, taskId)
      return (
        Option.isSome(projection)
        && projection.value.parentTaskId === parentTaskId
      )
    })
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
      const taskId = ready.shift()
      if (taskId === undefined) break
      order.push(taskId)
      for (const dependant of this.dependantsOf(taskId)) {
        const remaining = (remainingPrerequisites.get(dependant) ?? 0) - 1
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
      if (!Option.isSome(lifecycle) || lifecycle.value._tag !== "Open") {
        return false
      }
      return this.prerequisitesOf(taskId).every((prerequisite) => {
        const prerequisiteLifecycle = this.lifecycleOf(prerequisite)
        return (
          Option.isSome(prerequisiteLifecycle)
          && prerequisiteLifecycle.value._tag === "CompletedSuccessfully"
        )
      })
    })
  }

  toWire(): typeof TrackerSnapshot.Type {
    return {
      revision: this.revision,
      tasks: this.taskIds().flatMap((id) => {
        const projection = taskProjection(this.tasks, id)
        return Option.isSome(projection)
          ? [
            {
              id,
              lifecycle: projection.value.lifecycle,
              parentTaskId: projection.value.parentTaskId,
              prerequisiteIds: sorted(projection.value.prerequisiteIds)
            }
          ]
          : []
      })
    }
  }

  canonicalJson(): string {
    return JSON.stringify(
      Schema.encodeUnknownSync(TrackerSnapshot)(this.toWire())
    )
  }
}

export const projectTrackerSnapshot = (input: unknown): ProjectionResult => {
  const decoded = Schema.decodeUnknownResult(TrackerSnapshot)(input)
  return Result.isFailure(decoded)
    ? {
      _tag: "Invalid",
      issues: [
        ProjectionIssue.cases.BoundaryDecodeFailed.make({
          detail: String(decoded.failure)
        })
      ]
    }
    : TaskDagSnapshot.project(decoded.success)
}
