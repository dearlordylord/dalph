import { RunId } from "@dalph/contracts"
import { expect, it } from "vitest"
import { JournalPosition } from "./identity.js"
import { journalPrefixPredecessorOf, rememberValidatedJournalPrefixSuccessor } from "./prefix-lineage.js"
import { makeWorkflowRunTerminatedRecord } from "./run-lifecycle.js"
import { FixtureTarget } from "../authorities/task-tracker/fixture/target.js"
import { completedRunFinalityFixture } from "../../test/run-finality.js"

it("remembers only one exact same-run journal prefix successor", () => {
  const runId = RunId.make("prefix-lineage-test")
  const evidence = completedRunFinalityFixture({ runId, target: FixtureTarget.make("prefix-lineage-test") }).evidence
  const appended = makeWorkflowRunTerminatedRecord(runId, JournalPosition.make(1), "Completed", evidence)
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
