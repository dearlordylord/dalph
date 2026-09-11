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
import {
  advanceWorkflowJournalHistory,
  reduceWorkflowJournalHistory,
  inspectWorkflowJournalHistoryValidationPath,
  observeWorkflowJournalValidationSteps
} from "./history.js"
import { observeJournalRecordSequenceOperations } from "../../workflow-journal/record-sequence.js"

it("exposes accepted reconstruction only as indexed evidence, with no implicit record export", () => {
  const runId = RunId.make("explicit-history-export")
  const began = makeWorkflowRunBeganRecord(
    runId,
    FixtureTarget.make("explicit-history-export"),
    InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
  )
  const valid = reduceWorkflowJournalHistory(runId, [began])
  if (valid._tag !== "ValidWorkflowJournalHistory") return expect.fail("fixture must validate")
  expect("records" in valid).toBe(false)
  expect("records" in valid.runState.workflowHistory).toBe(false)
  expect("prefix" in valid.runState.workflowHistory).toBe(false)
})

it("rejects a fabricated valid-history shape without replaying its accepted prefix", () => {
  const runId = RunId.make("fabricated-history")
  const began = makeWorkflowRunBeganRecord(
    runId,
    FixtureTarget.make("fabricated-history"),
    InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
  )
  const valid = reduceWorkflowJournalHistory(runId, [began])
  if (valid._tag !== "ValidWorkflowJournalHistory") return expect.fail("fixture prefix must validate")
  const fabricated = { _tag: valid._tag, runId, prefix: valid.prefix, runState: valid.runState }
  let visits = 0
  const stop = observeJournalRecordSequenceOperations(() => {
    visits += 1
  })
  try {
    // @ts-expect-error A structural imitation cannot carry the private validated kernel state.
    expect(() => advanceWorkflowJournalHistory(fabricated, began)).toThrow(
      "validated journal history lacks its private kernel state"
    )
  } finally {
    stop()
  }
  expect(visits).toBe(0)
})

it.each([64, 256])(
  "Alice changes capacity after %i accepted records without materializing or traversing the prefix",
  (size) => {
    const runId = RunId.make("capacity-scaling")
    const began = makeWorkflowRunBeganRecord(
      runId,
      FixtureTarget.make("capacity-scaling"),
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(2) })
    )
    const capacityRecord = (position: number) => ({
      event: TaskWorkCapacityChangedEvent.make({
        capacity: TaskWorkCapacity.make(2),
        initiatedBy: { _tag: "Operator" },
        occurrenceClassification: "InitiatedAction",
        previousRevision: RunPolicyRevision.make(position - 1),
        revision: RunPolicyRevision.make(position),
        version: workflowJournalEventVersion
      }),
      key: taskWorkCapacityPolicyRecordKey(RunPolicyRevision.make(position)),
      position: JournalPosition.make(position),
      runId
    })
    let historicalReads = 0
    let coldSlices = 0
    const records = new Proxy([began, ...Array.from({ length: size - 1 }, (_, offset) => capacityRecord(offset + 2))], {
      get(target, property, receiver) {
        if (typeof property === "string" && /^\d+$/.test(property)) historicalReads += 1
        if (property === "slice") coldSlices += 1
        return Reflect.get(target, property, receiver)
      }
    })
    let coldIndexedVisits = 0
    let coldMaterializations = 0
    let coldValidationSteps = 0
    const stopColdSteps = observeWorkflowJournalValidationSteps(() => {
      coldValidationSteps += 1
    })
    const stopCold = observeJournalRecordSequenceOperations((operation) => {
      if (operation._tag === "IndexedRecordVisit") coldIndexedVisits += 1
      else coldMaterializations += 1
    })
    const prior = (() => {
      try {
        return reduceWorkflowJournalHistory(runId, records)
      } finally {
        stopCold()
        stopColdSteps()
      }
    })()
    expect(prior._tag).toBe("ValidWorkflowJournalHistory")
    expect(inspectWorkflowJournalHistoryValidationPath(prior)).toBe("IndexedCold")
    expect(coldSlices).toBe(0)
    expect(coldValidationSteps).toBe(size)
    expect(coldMaterializations).toBe(0)
    expect(coldIndexedVisits).toBeLessThanOrEqual(size * 32)
    expect(historicalReads).toBeLessThanOrEqual(size * 20)
    if (prior._tag !== "ValidWorkflowJournalHistory") return
    historicalReads = 0
    let indexedVisits = 0
    let materializations = 0
    let validationSteps = 0
    const stopSteps = observeWorkflowJournalValidationSteps(() => {
      validationSteps += 1
    })
    const stop = observeJournalRecordSequenceOperations((operation) => {
      if (operation._tag === "IndexedRecordVisit") indexedVisits += 1
      else materializations += 1
    })
    try {
      const next = advanceWorkflowJournalHistory(prior, capacityRecord(size + 1))
      expect(next._tag).toBe("ValidWorkflowJournalHistory")
    } finally {
      stop()
      stopSteps()
    }
    expect(historicalReads).toBe(0)
    expect(validationSteps).toBe(1)
    expect(materializations).toBe(0)
    expect(indexedVisits).toBeLessThanOrEqual(16)
  }
)
