import { expect, it } from "vitest"
import { RunId } from "@dalph/contracts"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { InitialControlPolicy, RunPolicyRevision } from "../../control/policy.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { makeWorkflowRunBeganRecord } from "../../workflow-journal/run-lifecycle.js"
import { taskWorkCapacityPolicyRecordKey } from "../../workflow-journal/record-key.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { TaskWorkCapacityChangedEvent } from "../../workflow/registry/event.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import { advanceWorkflowJournalHistory, reduceWorkflowJournalHistory } from "./history.js"

it("Alice changes capacity without reading any record in the already accepted historical array", () => {
  const runId = RunId.make("capacity-scaling")
  const began = makeWorkflowRunBeganRecord(runId, FixtureTarget.make("capacity-scaling"), InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(2) }))
  const capacityRecord = (position: number) => ({
    event: TaskWorkCapacityChangedEvent.make({ capacity: TaskWorkCapacity.make(2), initiatedBy: { _tag: "Operator" }, occurrenceClassification: "InitiatedAction", previousRevision: RunPolicyRevision.make(position - 1), revision: RunPolicyRevision.make(position), version: workflowJournalEventVersion }),
    key: taskWorkCapacityPolicyRecordKey(RunPolicyRevision.make(position)),
    position: JournalPosition.make(position),
    runId
  })
  let historicalReads = 0
  const records = new Proxy([began, ...Array.from({ length: 63 }, (_, offset) => capacityRecord(offset + 2))], {
    get(target, property, receiver) {
      if (typeof property === "string" && /^\d+$/.test(property)) historicalReads += 1
      return Reflect.get(target, property, receiver)
    }
  })
  const prior = reduceWorkflowJournalHistory(runId, records)
  expect(prior._tag).toBe("ValidWorkflowJournalHistory")
  if (prior._tag !== "ValidWorkflowJournalHistory") return
  historicalReads = 0
  const next = advanceWorkflowJournalHistory(prior, capacityRecord(65))
  expect(next._tag).toBe("ValidWorkflowJournalHistory")
  expect(historicalReads).toBe(0)
})
