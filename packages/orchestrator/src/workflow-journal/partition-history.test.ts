import { RunId } from "@dalph/contracts"
import { expect, it } from "vitest"
import { FixtureTarget } from "../authorities/task-tracker/fixture/target.js"
import { InitialControlPolicy } from "../control/policy.js"
import { TaskWorkCapacity } from "../coordination/admission/capacity.js"
import { decideJournalPartitionHistory } from "./partition-history.js"
import { makeWorkflowRunBeganRecord } from "./run-lifecycle.js"

const runId = RunId.make("cold-partition-export")
const records = [
  makeWorkflowRunBeganRecord(
    runId,
    FixtureTarget.make("cold-partition-export-target"),
    InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
  )
]

it("explicitly exports validated physical Hot history for startup without an implicit reduction getter", () => {
  const decision = decideJournalPartitionHistory("Hot", runId, records)
  expect(decision).toEqual({ _tag: "ValidPartitionHistory", isTerminal: false, records })
  if (decision._tag === "ValidPartitionHistory") expect(decision.records).not.toBe(records)
})

it("still refuses a nonterminal physical Cold history", () => {
  expect(decideJournalPartitionHistory("Cold", runId, records)).toMatchObject({
    _tag: "InvalidPartitionHistory",
    issue: { detail: "Cold history is not terminal" }
  })
})
