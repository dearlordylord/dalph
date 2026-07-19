import { Option } from "effect"
import { expect, it } from "vitest"
import { validSnapshot } from "../test/task-dag.js"
import { TaskId } from "./domain.js"
import { projectTaskDagWire, projectTrackerSnapshot } from "./task-dag.js"

const open = { _tag: "Open" } as const

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
        parentTaskId: "task-b",
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
      },
      {
        id: "task-d",
        lifecycle: open,
        parentTaskId: null,
        prerequisiteIds: ["task-e"]
      },
      {
        id: "task-e",
        lifecycle: open,
        parentTaskId: null,
        prerequisiteIds: ["task-d"]
      },
      {
        id: "task-f",
        lifecycle: open,
        parentTaskId: "missing-parent",
        prerequisiteIds: []
      },
      {
        id: "task-g",
        lifecycle: open,
        parentTaskId: "task-g",
        prerequisiteIds: []
      },
      {
        id: "task-h",
        lifecycle: open,
        parentTaskId: "task-i",
        prerequisiteIds: []
      },
      {
        id: "task-i",
        lifecycle: open,
        parentTaskId: "task-h",
        prerequisiteIds: []
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
      {
        _tag: "MissingParent",
        child: "task-f",
        parent: "missing-parent"
      },
      { _tag: "SelfParent", taskId: "task-g" },
      { _tag: "Cycle", taskIds: ["task-a", "task-b"] },
      { _tag: "Cycle", taskIds: ["task-d", "task-e"] },
      { _tag: "ContainmentCycle", taskIds: ["task-h", "task-i"] }
    ]
  })
  expect(reversed).toEqual(result)
})

it("accumulates structural issues from every duplicate task record", () => {
  const result = projectTrackerSnapshot({
    revision: "duplicate-record-issues-v1",
    tasks: [
      {
        id: "task-a",
        lifecycle: open,
        parentTaskId: null,
        prerequisiteIds: []
      },
      {
        id: "task-a",
        lifecycle: open,
        parentTaskId: "missing-parent",
        prerequisiteIds: ["task-a", "task-a", "z-missing-prerequisite"]
      }
    ]
  })

  expect(result).toEqual({
    _tag: "Invalid",
    issues: [
      { _tag: "DuplicateTask", taskId: "task-a" },
      { _tag: "SelfPrerequisite", taskId: "task-a" },
      {
        _tag: "DuplicatePrerequisite",
        dependant: "task-a",
        prerequisite: "task-a"
      },
      {
        _tag: "MissingPrerequisite",
        dependant: "task-a",
        prerequisite: "z-missing-prerequisite"
      },
      {
        _tag: "MissingParent",
        child: "task-a",
        parent: "missing-parent"
      }
    ]
  })
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
  expect(
    projectTaskDagWire({ ...graph.toWire(), schemaVersion: 2 })
  ).toMatchObject({
    _tag: "Invalid",
    issues: [{ _tag: "BoundaryDecodeFailed" }]
  })

  const missing = TaskId.make("missing-task")
  expect(Option.isNone(graph.lifecycleOf(missing))).toBe(true)
  expect(Option.isNone(graph.parentTaskIdOf(missing))).toBe(true)
  expect(graph.childrenOf(missing)).toEqual([])
  expect(graph.prerequisitesOf(missing)).toEqual([])
})
