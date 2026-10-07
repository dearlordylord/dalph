import { RunId } from "@dalph/contracts"
import { projectTrackerSnapshot } from "@dalph/orchestrator"
import { Effect } from "effect"
import { expect, test } from "vitest"
import { projectLiveTaskGraph } from "../../../packages/dalph/browser/live-task-graph-projection.ts"
import { projectRunningHostSnapshot } from "../../../packages/dalph/src/application/running-host-projection.js"
import { runningHostPageObservation } from "../../../packages/dalph/test-support/running-host-page-observation.js"

const runId = RunId.make("projection-run")
const graph = projectTrackerSnapshot({ revision: "projection", rootTaskId: "root", tasks: [
  { id: "root", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: ["prerequisite"] },
  { id: "child", lifecycle: { _tag: "Open" }, parentTaskId: "root", prerequisiteIds: [] },
  { id: "prerequisite", lifecycle: { _tag: "CompletedSuccessfully" }, parentTaskId: null, prerequisiteIds: [] }
] })

test("renders the complete Run graph without deriving settlement from tracker completion", async () => {
  if (graph._tag !== "Valid") return expect.fail("requires normalized graph")
  const run = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const observation = yield* runningHostPageObservation(runId, graph.snapshot, { paused: true })
    return yield* projectRunningHostSnapshot(runId, observation)
  })))
  if (run._tag === "Ready") {
    expect(projectLiveTaskGraph({ ...run, graph: { _tag: "GraphNotEstablished" } })).toBeNull()
  }
  const projected = projectLiveTaskGraph(run)
  expect(projected?.tasks.map(({ id }) => id)).toEqual(["child", "prerequisite", "root"])
  expect(projected?.edges).toEqual([
    { from: "root", to: "child", kind: "Grouping" },
    { from: "prerequisite", to: "root", kind: "Prerequisite" }
  ])
  expect(projected?.tasks.find(({ id }) => id === "prerequisite")).toMatchObject({
    lifecycle: "CompletedSuccessfully", display: { tone: "waiting", labels: ["CompletedSuccessfully"] }
  })
  expect(projected?.status).toContain("observed by the Run")
  expect(projectLiveTaskGraph({ _tag: "Closed", runId, final: run._tag === "Ready" ? run : null })).toEqual(projected)
})

test("has no graph before Run observation and retains only the Run final publication", () => {
  expect(projectLiveTaskGraph({ _tag: "NotReady", runId })).toBeNull()
  expect(projectLiveTaskGraph({ _tag: "Closed", runId, final: null })).toBeNull()
})
