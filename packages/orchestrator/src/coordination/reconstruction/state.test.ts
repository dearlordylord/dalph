import { expect, it } from "vitest"
import { TaskId } from "@dalph/contracts"
import { validSnapshot } from "../../../test/task-dag.js"
import { ReconstructedPauseState, reconstructedTaskIsPaused } from "./state.js"

const open = { _tag: "Open" } as const

it("covers a paused task and current grouping descendants without pausing graph neighbours", () => {
  const graph = validSnapshot({
    revision: "reconstructed-grouping-pause-v1",
    tasks: [
      { id: "A", lifecycle: open, parentTaskId: null, prerequisiteIds: ["P"] },
      { id: "D", lifecycle: open, parentTaskId: "A", prerequisiteIds: [] },
      { id: "E", lifecycle: open, parentTaskId: "D", prerequisiteIds: [] },
      { id: "P", lifecycle: open, parentTaskId: null, prerequisiteIds: [] },
      { id: "B", lifecycle: open, parentTaskId: null, prerequisiteIds: ["A"] },
      { id: "S", lifecycle: open, parentTaskId: null, prerequisiteIds: [] },
      { id: "C", lifecycle: open, parentTaskId: null, prerequisiteIds: [] }
    ]
  })
  const pause = ReconstructedPauseState.make({
    run: { _tag: "RunUnpaused" },
    tasks: { _tag: "TaskPauses", taskIds: [TaskId.make("A")] }
  })

  expect(
    ["A", "D", "E", "P", "B", "S", "C"].filter((taskId) => reconstructedTaskIsPaused(pause, TaskId.make(taskId), graph))
  ).toEqual(["A", "D", "E"])
})
