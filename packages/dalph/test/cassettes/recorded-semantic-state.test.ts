import { RunId } from "@dalph/contracts"
import {
  InitialControlPolicy,
  JournalPosition,
  RunPolicyRevision,
  TaskWorkCapacity,
  TaskWorkCapacityChangedEvent,
  describeJournalEvent,
  initialRunPolicyRevision,
  reduceWorkflowJournalHistory,
  workflowJournalEventVersion
} from "@dalph/orchestrator"
import { expect, it } from "vitest"
import { FixtureTarget } from "../../../orchestrator/src/authorities/task-tracker/fixture/target.js"
import { observeJournalRecordSequenceOperations } from "../../../orchestrator/src/workflow-journal/record-sequence.js"
import { makeWorkflowRunBeganRecord } from "../../../orchestrator/src/workflow-journal/run-lifecycle.js"
import { appliedOccurrencePosition } from "../../src/cassettes/recorded-semantic-state.js"

it("reads exact accepted occurrence cardinality without materializing records or changing an earlier prefix", () => {
  const runId = RunId.make("recorded-semantic-count")
  const began = makeWorkflowRunBeganRecord(
    runId,
    FixtureTarget.make("recorded-semantic-count-target"),
    InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
  )
  const event = TaskWorkCapacityChangedEvent.make({
    capacity: TaskWorkCapacity.make(2),
    initiatedBy: { _tag: "Operator" },
    occurrenceClassification: "InitiatedAction",
    previousRevision: initialRunPolicyRevision,
    revision: RunPolicyRevision.make(initialRunPolicyRevision + 1),
    version: workflowJournalEventVersion
  })
  const earlier = reduceWorkflowJournalHistory(runId, [began])
  const later = reduceWorkflowJournalHistory(runId, [
    began,
    { event, key: describeJournalEvent(event).expectedKey, position: JournalPosition.make(2), runId }
  ])
  const invalid = reduceWorkflowJournalHistory(runId, [{ ...began, position: JournalPosition.make(2) }])
  expect(earlier._tag).toBe("ValidWorkflowJournalHistory")
  expect(later._tag).toBe("ValidWorkflowJournalHistory")
  expect(invalid._tag).toBe("InvalidWorkflowJournalHistory")
  const materializations: Array<number> = []
  const restore = observeJournalRecordSequenceOperations((operation) => {
    if (operation._tag === "HistoricalMaterialization") materializations.push(operation.length)
  })
  try {
    expect(appliedOccurrencePosition(earlier)).toBe(1)
    expect(appliedOccurrencePosition(later)).toBe(2)
    expect(appliedOccurrencePosition(earlier)).toBe(1)
    expect(appliedOccurrencePosition(invalid)).toBe(0)
    expect(materializations).toEqual([])
  } finally {
    restore()
  }
})
