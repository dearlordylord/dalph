import { strict as assert } from "node:assert"
import { Result } from "effect"
import { runMaintainedCassette } from "./cassette-lab.ts"
import { deliveryTaskProgressLabels, traceTaskProgress } from "./trace-task-progress.ts"

const result = await runMaintainedCassette("authored:productionShapedFiveTaskDiamond")
assert.equal(result._tag, "Completed")
if (result._tag !== "Completed" || result.preparedTrace === null) throw new Error("Diamond trace unavailable")
const prepared = result.preparedTrace
const histories = prepared.cursors.map((cursor) => Result.getOrThrow(prepared.select(cursor)))
const rows = histories.map(traceTaskProgress)
const labels = (index: number, task: string) => rows[index]?.find(({ id }) => id === task)?.display?.labels ?? []
const promoted = rows.findIndex((_, index) => labels(index, "B").some((label) => label.startsWith("Git:")))
assert.ok(promoted > 0, "B has a confirmed promotion")
assert.ok(!labels(promoted - 1, "B").some((label) => label.startsWith("Git:")), "No promotion before Git proof")
assert.ok(labels(promoted, "B").includes("Tracker: completion not yet confirmed"))
const completed = rows.findIndex((_, index) => labels(index, "B").some((label) => label.startsWith("Tracker: completion confirmed")))
assert.ok(completed > promoted)
assert.equal(rows[completed]?.find(({ id }) => id === "B")?.lifecycle, "Graph snapshot: Open")
assert.ok(labels(completed, "B").includes("Graph snapshot differs · awaiting refresh"))
assert.ok(!labels(completed, "C").some((label) => label.startsWith("Git:")), "B completion is visible before C promotion")
const refreshed = rows.findIndex((tasks) => tasks.some(({ id, lifecycle }) => id === "B" && lifecycle === "Graph snapshot: CompletedSuccessfully"))
assert.ok(refreshed > completed)
assert.ok(!labels(refreshed, "B").includes("Graph snapshot differs · awaiting refresh"))
const beforePromotion = histories[promoted - 1]
assert.ok(beforePromotion)
assert.deepEqual(traceTaskProgress(beforePromotion), rows[promoted - 1], "Rewind cannot retain future facts")

assert.ok(result.deliveryFrames?.some((frame) =>
  frame.graph._tag === "Established" &&
  frame.graph.tasks.some(({ id, lifecycle }) => id === "B" && lifecycle === "Open") &&
  deliveryTaskProgressLabels(frame, "B").includes("Git: integration confirmed")
), "Delivery timeline shows B integration while the graph still says Open")
