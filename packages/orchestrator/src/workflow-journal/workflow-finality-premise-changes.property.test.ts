import { RunId } from "@dalph/contracts"
import fc from "fast-check"
import { expect, it } from "vitest"
import { TaskWorkCapacity } from "../coordination/admission/capacity.js"
import { RunPolicyRevision } from "../control/policy.js"
import { workflowJournalEventVersion } from "../workflow/kernel/event.js"
import { TaskWorkCapacityChangedEvent } from "../workflow/registry/event.js"
import { describeJournalEvent } from "../workflow/registry/event-descriptor.js"
import { integrationFinalityFixture } from "../workflow/protocols/integration-finality/fixtures.js"
import { JournalPosition } from "./identity.js"
import type { JournalRecord } from "./store.js"
import {
  appendWorkflowFinalityPremiseChanges,
  emptyWorkflowFinalityPremiseChanges,
  lastWorkflowFinalityPremiseChangeAt,
  observeWorkflowFinalityPremiseChangeLookup
} from "./workflow-finality-premise-changes.js"
import { journalEvidenceFrom, journalWorkflowFinalityPremiseChangeAt } from "./record-evidence.js"

const runId = integrationFinalityFixture.runId
const foreignRunId = RunId.make("foreign-finality-premise-run")
const occurrence = (position: number, capacityOnly: boolean, run = runId): JournalRecord => {
  const event = capacityOnly
    ? TaskWorkCapacityChangedEvent.make({
        capacity: TaskWorkCapacity.make(2),
        initiatedBy: { _tag: "Operator" },
        occurrenceClassification: "InitiatedAction",
        previousRevision: RunPolicyRevision.make(position - 1),
        revision: RunPolicyRevision.make(position),
        version: workflowJournalEventVersion
      })
    : integrationFinalityFixture.graphRecordEvent
  return { event, key: describeJournalEvent(event).expectedKey, position: JournalPosition.make(position), runId: run }
}

it("does not let a capacity-only or foreign tail hide an earlier finality-premise change", () => {
  const records = [
    occurrence(2, false),
    occurrence(5, true),
    occurrence(9, false),
    occurrence(12, true),
    occurrence(15, false, foreignRunId)
  ]
  const evidence = records.reduce(appendWorkflowFinalityPremiseChanges, emptyWorkflowFinalityPremiseChanges())
  expect(lastWorkflowFinalityPremiseChangeAt(evidence, { runId, throughPosition: 15 })).toBe(9)
  expect(lastWorkflowFinalityPremiseChangeAt(evidence, { runId, throughPosition: 8 })).toBe(2)
  expect(lastWorkflowFinalityPremiseChangeAt(evidence, { runId, throughPosition: 1 })).toBeUndefined()
  expect(lastWorkflowFinalityPremiseChangeAt(evidence, { runId: foreignRunId, throughPosition: 15 })).toBe(15)
})

it("matches the exact raw non-capacity predicate at every sparse cutoff", () => {
  fc.assert(
    fc.property(
      fc.array(fc.record({ capacityOnly: fc.boolean(), foreign: fc.boolean(), gap: fc.integer({ min: 1, max: 8 }) }), {
        maxLength: 50
      }),
      (actions) => {
        const records = actions.reduce<ReadonlyArray<JournalRecord>>(
          (prior, action) => [
            ...prior,
            occurrence(
              (prior.at(-1)?.position ?? 1) + action.gap,
              action.capacityOnly,
              action.foreign ? foreignRunId : runId
            )
          ],
          []
        )
        const evidence = records.reduce(appendWorkflowFinalityPremiseChanges, emptyWorkflowFinalityPremiseChanges())
        for (const cutoff of [0, ...records.map(({ position }) => position)]) {
          const expected = records.findLast(
            (record) =>
              record.runId === runId && record.position <= cutoff && record.event._tag !== "TaskWorkCapacityChanged"
          )
          expect(lastWorkflowFinalityPremiseChangeAt(evidence, { runId, throughPosition: cutoff })).toBe(
            expected?.position
          )
        }
      }
    )
  )
})

it.each([64, 256])("shares a %i-record capacity-only tail and performs one warm position lookup", (size) => {
  const first = Array.from({ length: size }, (_, offset) => occurrence(offset + 1, false)).reduce(
    appendWorkflowFinalityPremiseChanges,
    emptyWorkflowFinalityPremiseChanges()
  )
  const tail = Array.from({ length: size }, (_, offset) => occurrence(size + offset + 1, true))
  const evidence = tail.reduce(appendWorkflowFinalityPremiseChanges, first)
  expect(evidence).toBe(first)
  const visits: Array<string> = []
  const stop = observeWorkflowFinalityPremiseChangeLookup((event) => visits.push(event))
  try {
    expect(lastWorkflowFinalityPremiseChangeAt(evidence, { runId, throughPosition: size * 2 })).toBe(size)
  } finally {
    stop()
  }
  expect(visits).toEqual(["PositionLookup"])
})

it.each([64, 256])("serves a mixed %i-record bootstrap tail through one indexed lookup", (size) => {
  const prefix = Array.from({ length: size }, (_, offset) => occurrence(offset + 1, offset % 2 === 1))
  const premiseChange = occurrence(size + 1, false)
  const capacityTail = Array.from({ length: size }, (_, offset) => occurrence(size + offset + 2, true))
  const evidence = journalEvidenceFrom([...prefix, premiseChange, ...capacityTail])
  const visits: Array<string> = []
  const stop = observeWorkflowFinalityPremiseChangeLookup((event) => visits.push(event))
  try {
    expect(journalWorkflowFinalityPremiseChangeAt(evidence, runId)).toBe(premiseChange.position)
  } finally {
    stop()
  }
  expect(visits).toEqual(["PositionLookup"])
})
