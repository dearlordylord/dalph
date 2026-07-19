import { Option } from "effect"
import { expect, it } from "vitest"
import { TaskId } from "./domain.js"
import { projectTrackerSnapshot, type TaskDagSnapshot } from "./task-dag.js"

const open = { _tag: "Open" } as const

const validSnapshot = (input: unknown): TaskDagSnapshot => {
  const result = projectTrackerSnapshot(input)
  if (result._tag === "Invalid") {
    return expect.fail(`invalid test snapshot: ${JSON.stringify(result.issues)}`)
  }
  return result.snapshot
}

it("rejects an invalid snapshot as a whole with every structural issue", () => {
  const wire = {
    revision: "invalid-graph-v1",
    tasks: [
      {
        id: "task-a",
        lifecycle: open,
        parentTaskId: null,
        prerequisiteIds: ["task-b"]
      },
      {
        id: "task-a",
        lifecycle: open,
        parentTaskId: null,
        prerequisiteIds: []
      },
      {
        id: "task-b",
        lifecycle: open,
        parentTaskId: null,
        prerequisiteIds: ["task-a"]
      },
      {
        id: "task-c",
        lifecycle: open,
        parentTaskId: null,
        prerequisiteIds: ["task-c", "missing", "missing"]
      }
    ]
  }
  const result = projectTrackerSnapshot(wire)
  const reversed = projectTrackerSnapshot({
    ...wire,
    tasks: [...wire.tasks].reverse()
  })

  expect(result).toEqual({
    _tag: "Invalid",
    issues: [
      { _tag: "DuplicateTask", taskId: "task-a" },
      {
        _tag: "MissingPrerequisite",
        dependant: "task-c",
        prerequisite: "missing"
      },
      {
        _tag: "DuplicatePrerequisite",
        dependant: "task-c",
        prerequisite: "missing"
      },
      { _tag: "SelfPrerequisite", taskId: "task-c" },
      { _tag: "Cycle", taskIds: ["task-a", "task-b"] }
    ]
  })
  expect(reversed).toEqual(result)
})

it("keeps grouping independent while traversing and deriving diamond eligibility", () => {
  const wire = {
    revision: "diamond-v1",
    tasks: [
      {
        id: "join",
        lifecycle: open,
        parentTaskId: "group",
        prerequisiteIds: ["right", "left"]
      },
      {
        id: "right",
        lifecycle: { _tag: "TerminalWithoutSuccess" },
        parentTaskId: "group",
        prerequisiteIds: ["root"]
      },
      {
        id: "group",
        lifecycle: open,
        parentTaskId: null,
        prerequisiteIds: []
      },
      {
        id: "left",
        lifecycle: { _tag: "CompletedSuccessfully" },
        parentTaskId: "group",
        prerequisiteIds: ["root"]
      },
      {
        id: "root",
        lifecycle: { _tag: "CompletedSuccessfully" },
        parentTaskId: null,
        prerequisiteIds: []
      }
    ]
  }
  const graph = validSnapshot(wire)
  const permuted = validSnapshot({ ...wire, tasks: [...wire.tasks].reverse() })

  expect(graph.topologicalOrder()).toEqual([
    "group",
    "root",
    "left",
    "right",
    "join"
  ])
  expect(graph.childrenOf(TaskId.make("group"))).toEqual([
    "join",
    "left",
    "right"
  ])
  expect(graph.prerequisitesOf(TaskId.make("group"))).toEqual([])
  expect(graph.prerequisitesOf(TaskId.make("join"))).toEqual([
    "left",
    "right"
  ])
  expect(Option.getOrNull(graph.parentTaskIdOf(TaskId.make("join")))).toBe(
    "group"
  )
  expect(graph.eligibleTaskIds()).toEqual(["group"])
  const satisfied = validSnapshot({
    ...wire,
    tasks: wire.tasks.map((task) =>
      task.id === "right"
        ? { ...task, lifecycle: { _tag: "CompletedSuccessfully" } }
        : task
    )
  })
  expect(satisfied.eligibleTaskIds()).toEqual(["group", "join"])
  expect(permuted.canonicalJson()).toBe(graph.canonicalJson())
})
