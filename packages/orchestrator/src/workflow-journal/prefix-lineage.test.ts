import { RunId } from "@dalph/contracts"
import { expect, it } from "vitest"
import { JournalPosition } from "./identity.js"
import { journalPrefixPredecessorOf, rememberValidatedJournalPrefixSuccessor } from "./prefix-lineage.js"
import { makeWorkflowRunTerminatedRecord } from "./run-lifecycle.js"

it("remembers only one exact same-run journal prefix successor", () => {
  const runId = RunId.make("prefix-lineage-test")
  const appended = makeWorkflowRunTerminatedRecord(runId, JournalPosition.make(1))
  const prior = { records: [], runId }
  const validRecords = [appended]
  rememberValidatedJournalPrefixSuccessor(prior, { records: validRecords, runId }, appended)
  expect(journalPrefixPredecessorOf(validRecords)).toEqual({ appended, prior: [] })

  const invalidRecords = [appended]
  rememberValidatedJournalPrefixSuccessor(
    prior,
    { records: invalidRecords, runId: RunId.make("foreign-prefix-run") },
    appended
  )
  expect(journalPrefixPredecessorOf(invalidRecords)).toBeUndefined()
})
