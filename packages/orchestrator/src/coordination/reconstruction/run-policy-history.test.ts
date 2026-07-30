import { it } from "@effect/vitest"
import { expect } from "vitest"
import { RunId } from "@dalph/contracts"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { RunPolicyRevision } from "../../control/policy.js"
import { JournalPosition, JournalRecordKey } from "../../workflow-journal/identity.js"
import { TaskWorkCapacityChangedEvent } from "../../workflow/registry/event.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import { validateRunPolicyHistory } from "./run-policy-history.js"

const record = {
  event: TaskWorkCapacityChangedEvent.make({
    capacity: TaskWorkCapacity.make(2),
    initiatedBy: { _tag: "Operator" },
    occurrenceClassification: "InitiatedAction",
    previousRevision: RunPolicyRevision.make(1),
    revision: RunPolicyRevision.make(3),
    version: workflowJournalEventVersion
  }),
  key: JournalRecordKey.make("run-policy-history-key"),
  position: JournalPosition.make(1),
  runId: RunId.make("run-policy-history-run")
}

it("reports missing, mismatched, and nonconsecutive task-work policy revisions", () => {
  expect(validateRunPolicyHistory(record, { latestRunPolicyRevision: undefined }).details).toEqual([
    "TaskWorkCapacityChanged requires prior WorkflowRunBegan",
    "task-work capacity revision 3 must immediately follow 1"
  ])
  expect(validateRunPolicyHistory(record, { latestRunPolicyRevision: 2 }).details).toEqual([
    "task-work capacity expected previous policy revision 2, found 1",
    "task-work capacity revision 3 must immediately follow 1"
  ])
})
