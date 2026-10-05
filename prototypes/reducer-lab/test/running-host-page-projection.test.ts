import { RunId } from "@dalph/contracts"
import { projectTrackerSnapshot } from "@dalph/orchestrator"
import { expect, test } from "vitest"
import { projectLiveTaskGraph } from "../../../packages/dalph/browser/live-task-graph-projection.ts"
import { InspectionObservedAt } from "../../../packages/dalph/src/application/running-host-inspection.js"

const graph = projectTrackerSnapshot({ revision: "projection", rootTaskId: "root", tasks: [
  { id: "root", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: ["prerequisite"] },
  { id: "child", lifecycle: { _tag: "Open" }, parentTaskId: "root", prerequisiteIds: [] },
  { id: "prerequisite", lifecycle: { _tag: "CompletedSuccessfully" }, parentTaskId: null, prerequisiteIds: [] }
] })

test("keeps graph and Run freshness distinct and never derives Dalph settlement from tracker completion", () => {
  if (graph._tag !== "Valid") return expect.fail("requires normalized graph")
  const value = { graph: graph.snapshot.toWire(), observedAt: InspectionObservedAt.make(10) }
  const run = { _tag: "NotReady" as const, runId: RunId.make("projection-run") }
  const ready = projectLiveTaskGraph({ _tag: "InspectionSnapshot", run, inspection: { _tag: "Ready", value } })
  const stale = projectLiveTaskGraph({ _tag: "InspectionSnapshot", run, inspection: {
    _tag: "Stale", value, failedAt: InspectionObservedAt.make(20), reason: "Incomplete" } })
  expect(stale?.tasks).toEqual(ready?.tasks)
  expect(stale?.edges).toEqual([
    { from: "root", to: "child", kind: "Grouping" },
    { from: "prerequisite", to: "root", kind: "Prerequisite" }
  ])
  expect(stale?.status).toContain("refresh failed")
  expect(stale?.tasks.find((task) => task.id === "prerequisite")).toMatchObject({
    lifecycle: "CompletedSuccessfully", display: { tone: "waiting", labels: ["CompletedSuccessfully", "Outside the observed Run graph"] }
  })
  expect(projectLiveTaskGraph({ _tag: "InspectionSnapshot", run, inspection: {
    _tag: "Unavailable", failedAt: InspectionObservedAt.make(20), reason: "Incomplete" } })).toBeNull()
  expect(projectLiveTaskGraph({ _tag: "InspectionSnapshot", run: { _tag: "Closed", runId: run.runId, final: null },
    inspection: { _tag: "Ready", value } })?.tasks).toEqual(ready?.tasks)
})
