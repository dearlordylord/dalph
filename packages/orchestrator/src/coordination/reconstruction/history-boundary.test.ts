/* eslint-disable import/no-nodejs-modules -- Source-boundary checks read only the neighboring reconstruction modules. */
import { readFileSync } from "node:fs"
import { expect, it } from "vitest"
import * as publicApi from "../../index.js"
import { advanceWorkflowJournalHistory, reduceWorkflowJournalHistory } from "./history.js"

it("exports production reconstruction without exposing test probes or the diagnostic oracle", () => {
  const reduce: typeof reduceWorkflowJournalHistory = publicApi.reduceWorkflowJournalHistory
  const advance: typeof advanceWorkflowJournalHistory = publicApi.advanceWorkflowJournalHistory
  expect(reduce).toBe(reduceWorkflowJournalHistory)
  expect(advance).toBe(advanceWorkflowJournalHistory)
  expect(publicApi).not.toHaveProperty("observeWorkflowJournalValidationSteps")
  expect(publicApi).not.toHaveProperty("inspectWorkflowJournalHistoryValidationPath")
  expect(publicApi).not.toHaveProperty("reduceUnindexedWorkflowJournalHistoryForTesting")
})

it("keeps live reconstruction on the supplied accepted history instead of exporting the predecessor", () => {
  const source = readFileSync(new URL("./reduce.ts", import.meta.url), "utf8")
  expect(source).not.toContain("prior.workflowHistory.records")
  expect(source).not.toContain("materializeJournalRecords")
})

it("does not restore array-based predecessor lineage in the shared journal kernel", () => {
  for (const file of ["./history.ts", "./reduce.ts", "../../workflow-journal/accepted-prefix.ts"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8")
    expect(source).not.toContain("prefix-lineage")
  }
})
