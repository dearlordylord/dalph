import { expect, expectTypeOf, it } from "vitest"
import fc from "fast-check"
import { RunId } from "@dalph/contracts"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { InitialControlPolicy, RunPolicyRevision } from "../../control/policy.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { makeWorkflowRunBeganRecord } from "../../workflow-journal/run-lifecycle.js"
import { taskWorkCapacityPolicyRecordKey } from "../../workflow-journal/record-key.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { TaskWorkCapacityChangedEvent } from "../../workflow/registry/event.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import { advanceWorkflowJournalHistory, reduceWorkflowJournalHistory } from "./history.js"
import { exportWorkflowHistoryRecords, reconstructRunState } from "./reduce.js"
import type { ValidWorkflowJournalHistory } from "./history-result.js"
import type { AcceptedReconstructedWorkflowHistory } from "./state.js"
import { observeJournalRecordSequenceOperations } from "../../workflow-journal/record-sequence.js"

const runId = RunId.make("history-evidence-parity")
const accepted = (records: ReadonlyArray<JournalRecord>): ValidWorkflowJournalHistory => {
  const result = reduceWorkflowJournalHistory(runId, records)
  if (result._tag !== "ValidWorkflowJournalHistory") return expect.fail("generated history must validate")
  return result
}

it("keeps cold, live, and explicit raw diagnostic reconstruction equivalent without sharing acceptance capabilities", () => {
  fc.assert(
    fc.property(fc.array(fc.integer({ min: 1, max: 8 }), { maxLength: 24 }), (capacities) => {
      const began = makeWorkflowRunBeganRecord(
        runId,
        FixtureTarget.make("evidence-parity"),
        InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
      )
      const records = [
        began,
        ...capacities.map((capacity, offset): JournalRecord => {
          const position = offset + 2
          return {
            runId,
            position: JournalPosition.make(position),
            key: taskWorkCapacityPolicyRecordKey(RunPolicyRevision.make(position)),
            event: TaskWorkCapacityChangedEvent.make({
              capacity: TaskWorkCapacity.make(capacity),
              initiatedBy: { _tag: "Operator" },
              occurrenceClassification: "InitiatedAction",
              previousRevision: RunPolicyRevision.make(position - 1),
              revision: RunPolicyRevision.make(position),
              version: workflowJournalEventVersion
            })
          }
        })
      ]
      const cold = accepted(records)
      let live = accepted([began])
      for (const record of records.slice(1)) {
        const next = advanceWorkflowJournalHistory(live, record)
        if (next._tag !== "ValidWorkflowJournalHistory") return expect.fail("successor must validate")
        live = next
      }
      const diagnostic = reconstructRunState(runId, records)
      if (diagnostic._tag !== "ValidReconstructedRun") return expect.fail("diagnostic state must be consistent")
      expectTypeOf(diagnostic.state.workflowHistory).not.toExtend<AcceptedReconstructedWorkflowHistory>()
      expect(live.runState.controlPolicy).toEqual(cold.runState.controlPolicy)
      expect(diagnostic.state.controlPolicy).toEqual(cold.runState.controlPolicy)
      expect(exportWorkflowHistoryRecords(live.runState.workflowHistory)).toEqual(records)
      expect(exportWorkflowHistoryRecords(cold.runState.workflowHistory)).toEqual(records)
      expect(exportWorkflowHistoryRecords(diagnostic.state.workflowHistory)).toEqual(records)
      let operations = 0
      const stop = observeJournalRecordSequenceOperations(() => {
        operations += 1
      })
      try {
        expect(live.runState.workflowHistory.evidence).toBe(live.prefix)
        expect("records" in live.runState.workflowHistory).toBe(false)
        expect("records" in live).toBe(false)
      } finally {
        stop()
      }
      expect(operations).toBe(0)
    })
  )
})
