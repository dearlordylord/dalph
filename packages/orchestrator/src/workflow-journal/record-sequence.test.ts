import { describe, expect, it } from "vitest"
import { RunId } from "@dalph/contracts"
import { JournalPosition } from "./identity.js"
import { makeWorkflowRunBeganRecord } from "./run-lifecycle.js"
import { FixtureTarget } from "../authorities/task-tracker/fixture/target.js"
import { InitialControlPolicy, RunPolicyRevision } from "../control/policy.js"
import { TaskWorkCapacity } from "../coordination/admission/capacity.js"
import {
  acceptedJournalPrefixFromValidatedHistory,
  acceptedJournalRecordForKey,
  acceptedJournalRecordsForKind,
  acceptedJournalSuccessorProvenance,
  appendValidatedJournalRecord,
  inspectAcceptedPrefixStorage
} from "./accepted-prefix.js"
import { TaskWorkCapacityChangedEvent } from "../workflow/registry/event.js"
import { taskWorkCapacityPolicyRecordKey } from "./record-key.js"
import { workflowJournalEventVersion } from "../workflow/kernel/event.js"
import {
  appendJournalRecord,
  emptyJournalRecords,
  journalRecordAt,
  journalRecordsBefore,
  inspectJournalRecordStorage,
  observeJournalRecordSequenceOperations,
  materializeJournalRecords
} from "./record-sequence.js"

const initial = makeWorkflowRunBeganRecord(
  RunId.make("retained-prefix"),
  FixtureTarget.make("retained-prefix"),
  InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(2) })
)

describe("Alice retains an earlier journal observation", () => {
  it("counts explicit historical export and indexed lookup at the actual sequence boundary", () => {
    const operations: Array<string> = []
    const stop = observeJournalRecordSequenceOperations((operation) => operations.push(operation._tag))
    try {
      const records = appendJournalRecord(emptyJournalRecords(), initial)
      journalRecordAt(records, 0)
      materializeJournalRecords(records)
    } finally {
      stop()
    }
    expect(operations).toEqual(["IndexedRecordVisit", "HistoricalMaterialization"])
  })
  const retainedSlotCount = (roots: ReadonlyArray<unknown>): number => {
    const retained = new Set<object>()
    let slots = 0
    const visit = (value: unknown): void => {
      if (typeof value !== "object" || value === null || retained.has(value)) return
      retained.add(value)
      const keys = Reflect.ownKeys(value)
      slots += keys.length
      for (const key of keys) visit(Reflect.get(value, key))
    }
    for (const root of roots) visit(root)
    return slots
  }

  const retainedPrefixes = (count: number) => {
    const prefixes = [emptyJournalRecords()]
    let latest = prefixes[0] ?? emptyJournalRecords()
    for (let position = 1; position <= count; position += 1) {
      latest = appendJournalRecord(latest, { ...initial, position: JournalPosition.make(position) })
      prefixes.push(latest)
    }
    return prefixes
  }

  it("shares retained storage across increasing histories instead of retaining every full array", () => {
    const small = retainedSlotCount(
      retainedPrefixes(256).flatMap((prefix) => [prefix, inspectJournalRecordStorage(prefix)])
    )
    const large = retainedSlotCount(
      retainedPrefixes(1024).flatMap((prefix) => [prefix, inspectJournalRecordStorage(prefix)])
    )
    // Four times the records may grow HAMT paths, but not sixteen times the
    // retained full-prefix storage. This counts the reachable structure, not GC.
    expect(large).toBeLessThan(small * 6)
  })

  const acceptedPrefixes = (count: number) => {
    let latest = acceptedJournalPrefixFromValidatedHistory(initial.runId, [initial])
    const prefixes = [latest]
    for (let position = 2; position <= count; position += 1) {
      const revision = RunPolicyRevision.make(position)
      latest = appendValidatedJournalRecord(latest, {
        event: TaskWorkCapacityChangedEvent.make({
          capacity: TaskWorkCapacity.make(2),
          initiatedBy: { _tag: "Operator" },
          occurrenceClassification: "InitiatedAction",
          previousRevision: RunPolicyRevision.make(position - 1),
          revision,
          version: workflowJournalEventVersion
        }),
        key: taskWorkCapacityPolicyRecordKey(revision),
        position: JournalPosition.make(position),
        runId: initial.runId
      })
      prefixes.push(latest)
    }
    return { latest, prefixes }
  }

  it("keeps only shared accepted storage and an opaque predecessor identity in provenance", () => {
    const small = acceptedPrefixes(256).latest
    const large = acceptedPrefixes(1024).latest
    const smallSlots = retainedSlotCount([
      ...inspectAcceptedPrefixStorage(small),
      acceptedJournalSuccessorProvenance(small)
    ])
    const largeSlots = retainedSlotCount([
      ...inspectAcceptedPrefixStorage(large),
      acceptedJournalSuccessorProvenance(large)
    ])
    expect(largeSlots).toBeLessThan(smallSlots * 5)
    expect(acceptedJournalSuccessorProvenance(large)?.predecessor).not.toHaveProperty("records")
    expect(acceptedJournalRecordForKey(large, initial.key)).toBe(initial)
    expect(acceptedJournalRecordsForKind(large, "TaskWorkCapacityChanged").length).toBe(1023)
  })

  it("shares every accepted publication's evidence roots while an observer retains all prefixes", () => {
    const rootsFor = (count: number) =>
      acceptedPrefixes(count).prefixes.flatMap((prefix) => [
        prefix,
        ...inspectAcceptedPrefixStorage(prefix),
        acceptedJournalSuccessorProvenance(prefix)
      ])
    expect(retainedSlotCount(rootsFor(1024))).toBeLessThan(retainedSlotCount(rootsFor(256)) * 6)
  })

  it("keeps each earlier sequence unchanged when a successor and sibling are appended", () => {
    const first = appendJournalRecord(emptyJournalRecords(), initial)
    const nextRecord = { ...initial, position: JournalPosition.make(2) }
    const next = appendJournalRecord(first, nextRecord)
    const siblingRecord = { ...nextRecord, runId: RunId.make("sibling") }
    const sibling = appendJournalRecord(first, siblingRecord)

    expect(materializeJournalRecords(first)).toEqual([initial])
    expect(materializeJournalRecords(next)).toEqual([initial, nextRecord])
    expect(materializeJournalRecords(sibling)).toEqual([initial, siblingRecord])
    expect(journalRecordAt(first, 1)).toBeUndefined()
    expect(journalRecordAt(next, -1)).toBe(nextRecord)
  })

  it("takes an earlier prefix without allocating a complete record array", () => {
    const first = appendJournalRecord(emptyJournalRecords(), initial)
    const next = appendJournalRecord(first, { ...initial, position: JournalPosition.make(2) })
    const earlier = journalRecordsBefore(next, 1)
    expect(earlier.length).toBe(1)
    expect(materializeJournalRecords(earlier)).toEqual([initial])
    expect(journalRecordAt(earlier, 1)).toBeUndefined()
  })
})
