import { exportWorkflowHistoryRecords, reduceWorkflowJournalHistory } from "@dalph/orchestrator"
import { expect, it } from "vitest"
import { exportWorkflowHistoryRecords as sourceExport } from "../../../orchestrator/src/coordination/reconstruction/reduce.js"
import { reduceWorkflowJournalHistory as sourceReducer } from "../../../orchestrator/src/coordination/reconstruction/history.js"

it("keeps opaque history producers and consumers in one implementation in the MBT project", () => {
  expect(exportWorkflowHistoryRecords).toBe(sourceExport)
  expect(reduceWorkflowJournalHistory).toBe(sourceReducer)
})
