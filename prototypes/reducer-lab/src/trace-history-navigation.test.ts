import { strict as assert } from "node:assert"
import type { TraceHistoryItem } from "@dalph/orchestrator"
import { foldRepeatedTraceItems } from "./trace-history-navigation.ts"

const item = (
  position: number,
  tag: string,
  classification: "InitiatedAction" | "NonActionOccurrence"
): TraceHistoryItem => ({
  identity: { runId: "run:large-navigation", position },
  occurrence: { _tag: tag, recordedAt: position },
  operationIds: [],
  taskIds: [],
  __classificationForTest: classification
} as unknown as TraceHistoryItem)

const observedReports = [
  item(17, "PlannedAttemptExecutorWorkReported", "NonActionOccurrence"),
  item(18, "PlannedAttemptExecutorWorkReported", "NonActionOccurrence"),
  item(19, "PlannedAttemptExecutorWorkReported", "NonActionOccurrence")
]
const initiated = item(20, "TargetPromotionAttemptRequested", "InitiatedAction")
const folded = foldRepeatedTraceItems([...observedReports, initiated], (candidate) =>
  (candidate as unknown as { readonly __classificationForTest: "InitiatedAction" | "NonActionOccurrence" })
    .__classificationForTest
)

assert.equal(folded.length, 2, "classification changes must start a distinct history entry")
assert.equal(folded[0]?._tag, "FoldedTraceItems")
if (folded[0]?._tag === "FoldedTraceItems") {
  assert.equal(folded[0].count, 3)
  assert.equal(folded[0].first.position, 17)
  assert.equal(folded[0].last.position, 19)
  assert.deepEqual(folded[0].items, observedReports, "expansion must retain every exact item and payload")
}
assert.equal(folded[1]?._tag, "ExactTraceItem", "initiated actions must remain exact")

const firstPromotionAttempt = item(17, "TargetPromotionAttemptRequested", "InitiatedAction")
const laterPromotionAttempt = item(18, "TargetPromotionAttemptRequested", "InitiatedAction")
const separatedPromotionAttempts = foldRepeatedTraceItems(
  [firstPromotionAttempt, laterPromotionAttempt],
  (candidate) =>
    (candidate as unknown as { readonly __classificationForTest: "InitiatedAction" | "NonActionOccurrence" })
      .__classificationForTest
)
assert.equal(
  separatedPromotionAttempts.length,
  2,
  "each initiated promotion attempt must remain exact"
)
assert.ok(
  separatedPromotionAttempts.every(({ _tag }) => _tag === "ExactTraceItem"),
  "each promotion attempt must retain its exact identity"
)

console.log("✓ folds repeated observed reports without losing occurrence identity")
