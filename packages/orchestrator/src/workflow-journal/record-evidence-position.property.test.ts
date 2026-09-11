import { AttemptId } from "@dalph/contracts"
import * as fc from "fast-check"
import { expect, it } from "vitest"
import { integrationFinalityFixture } from "../workflow/protocols/integration-finality/fixtures.js"
import { PlannedAttemptExecutorWorkResponsibilityBeganEvent } from "../workflow/protocols/planned-attempt-executor-work/events.js"
import { workflowJournalEventVersion } from "../workflow/kernel/event.js"
import { describeJournalEvent } from "../workflow/registry/event-descriptor.js"
import { JournalPosition } from "./identity.js"
import type { JournalRecord } from "./store.js"
import {
  journalEvidenceBefore,
  journalEvidenceFrom,
  journalGraphObservationAt,
  journalGraphSnapshotForObservation,
  journalRecordByKey,
  journalRecordByPosition,
  journalRecordsAfter,
  journalRecordsForAttempt,
  journalRecordsOfKind,
  journalRetainedExecutorResponsibilitySubjects,
  lastJournalRecordOfKind
} from "./record-evidence.js"

it("preserves actual positions in sparse diagnostic evidence and every earlier window", () => {
  fc.assert(
    fc.property(fc.array(fc.integer({ min: 1, max: 9 }), { minLength: 1, maxLength: 16 }), (gaps) => {
      const fixture = integrationFinalityFixture
      const records = gaps.reduce<ReadonlyArray<JournalRecord>>((prior, gap, index) => {
        const event = PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
          plannedAttempt: { ...fixture.plannedAttempt, attemptId: AttemptId.make(`sparse-attempt-${index}`) },
          version: workflowJournalEventVersion
        })
        return [
          ...prior,
          {
            event,
            key: describeJournalEvent(event).expectedKey,
            position: JournalPosition.make((prior.at(-1)?.position ?? 0) + gap),
            runId: fixture.runId
          }
        ]
      }, [])
      const evidence = journalEvidenceFrom(records)
      for (const record of records) {
        const cutoff = record.position + 1
        const expected = records.filter((candidate) => candidate.position < cutoff)
        const window = journalEvidenceBefore(evidence, cutoff)
        expect(journalRecordByKey(window, record.key)).toBe(record)
        expect(journalRecordByPosition(window, record.position)).toBe(record)
        expect(Array.from(journalRecordsOfKind(window, record.event._tag))).toEqual(expected)
        expect(lastJournalRecordOfKind(window, record.event._tag)).toBe(record)
        expect(Array.from(journalRecordsAfter(window, record.position))).toEqual([])
        expect(
          journalRetainedExecutorResponsibilitySubjects(window, fixture.runId).map(({ beganAt }) => beganAt)
        ).toEqual(expected.map(({ position }) => position))
        if (record.event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan") {
          expect(Array.from(journalRecordsForAttempt(window, record.event.plannedAttempt.attemptId))).toEqual([record])
        }
        const before = journalEvidenceBefore(evidence, record.position)
        expect(journalRecordByKey(before, record.key)).toBeUndefined()
        expect(journalRecordByPosition(before, record.position)).toBeUndefined()
        expect(Array.from(journalRecordsAfter(evidence, record.position))).toEqual(
          records.filter((candidate) => candidate.position > record.position)
        )
      }
    })
  )
})

it("exposes a graph observation at position seven when it is the only decoded record", () => {
  const fixture = integrationFinalityFixture
  const position = JournalPosition.make(7)
  const event = fixture.graphRecordEvent
  const record = { event, key: describeJournalEvent(event).expectedKey, position, runId: fixture.runId }
  const evidence = journalEvidenceFrom([record])
  expect(journalGraphObservationAt(evidence, { target: fixture.target })?.position).toBe(position)
  expect(journalGraphSnapshotForObservation(evidence, position)._tag).toBe("Some")
  const before = journalEvidenceBefore(evidence, position)
  expect(journalGraphObservationAt(before, { target: fixture.target })).toBeUndefined()
  expect(journalGraphSnapshotForObservation(before, position)._tag).toBe("None")
})

it("retains duplicate-key diagnostic occurrences without confusing a duplicate position with its array offset", () => {
  const fixture = integrationFinalityFixture
  const event = PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
    plannedAttempt: fixture.plannedAttempt,
    version: workflowJournalEventVersion
  })
  const first = {
    event,
    key: describeJournalEvent(event).expectedKey,
    position: JournalPosition.make(2),
    runId: fixture.runId
  }
  const duplicatePosition = { ...first }
  const later = { ...first, position: JournalPosition.make(9) }
  const records = [first, duplicatePosition, later]
  const evidence = journalEvidenceFrom(records)
  expect(journalRecordByKey(evidence, first.key)).toBe(first)
  expect(journalRecordByPosition(evidence, first.position)).toBe(first)
  expect(Array.from(journalRecordsForAttempt(evidence, fixture.plannedAttempt.attemptId))).toEqual(records)
  expect(lastJournalRecordOfKind(evidence, event._tag)).toBe(later)
  expect(Array.from(journalRecordsAfter(evidence, first.position))).toEqual([later])
  const beforeLater = journalEvidenceBefore(evidence, later.position)
  expect(Array.from(journalRecordsOfKind(beforeLater, event._tag))).toEqual([first, duplicatePosition])
  expect(journalEvidenceBefore(beforeLater, later.position + 1)).toBe(beforeLater)
})
