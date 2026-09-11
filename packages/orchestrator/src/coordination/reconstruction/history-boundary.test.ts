/* eslint-disable import/no-nodejs-modules -- Source-boundary checks read only the neighboring reconstruction modules. */
import { readFileSync } from "node:fs"
import { expect, it } from "vitest"

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
