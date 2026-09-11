import { RunId } from "@dalph/contracts"
import fc from "fast-check"
import { expect, it } from "vitest"
import { OperationId } from "../workflow/identity.js"
import { workflowJournalEventVersion } from "../workflow/kernel/event.js"
import { integrationFinalityFixture } from "../workflow/protocols/integration-finality/fixtures.js"
import {
  CompletionClaimReplacedEvent,
  CompletionClaimReplacementIntendedEvent,
  CompletionTaskClaim,
  completionTaskClaimEquals
} from "../workflow/protocols/integration-finality/events.js"
import { describeJournalEvent } from "../workflow/registry/event-descriptor.js"
import { JournalPosition } from "./identity.js"
import type { JournalRecord } from "./store.js"
import {
  appendSettledCompletionClaimReplacementEvidence,
  emptySettledCompletionClaimReplacements,
  inspectSettledCompletionClaimReplacementStorage,
  observeSettledCompletionClaimReplacementLookup,
  settledCompletionClaimReplacementAt
} from "./settled-completion-claim-replacement.js"

const fixture = integrationFinalityFixture
const claimFor = (id: number): CompletionTaskClaim =>
  CompletionTaskClaim.make({
    ...fixture.claim,
    originalClaim: { ...fixture.activeClaim, operationId: OperationId.make(`reacquired-claim-${id}`) }
  })
const occurrence = (
  kind: "Intent" | "Outcome",
  claim: CompletionTaskClaim,
  operationId: OperationId,
  position: number,
  runId = fixture.runId
): JournalRecord => {
  const event =
    kind === "Intent"
      ? CompletionClaimReplacementIntendedEvent.make({ claim, operationId, version: workflowJournalEventVersion })
      : CompletionClaimReplacedEvent.make({ claim, operationId, version: workflowJournalEventVersion })
  return { event, key: describeJournalEvent(event).expectedKey, position: JournalPosition.make(position), runId }
}

const oracle = (records: ReadonlyArray<JournalRecord>, claim: CompletionTaskClaim, cutoff: number) =>
  records.find((record) => {
    const event = record.event
    if (
      record.position > cutoff ||
      record.runId !== claim.plannedAttempt.runId ||
      event._tag !== "CompletionClaimReplaced" ||
      !completionTaskClaimEquals(event.claim, claim)
    )
      return false
    const intent = records.findLast(
      (prior) =>
        prior.position < record.position &&
        prior.runId === record.runId &&
        prior.event._tag === "CompletionClaimReplacementIntended" &&
        prior.event.claim.plannedAttempt.runId === prior.runId &&
        prior.event.operationId === event.operationId
    )
    return (
      intent?.event._tag === "CompletionClaimReplacementIntended" &&
      completionTaskClaimEquals(intent.event.claim, event.claim)
    )
  })

it("keeps reacquired exact claims for one promotion independently visible at older cutoffs", () => {
  const first = claimFor(0)
  const second = claimFor(1)
  const records = [
    occurrence("Intent", first, OperationId.make("custom-original-replacement"), 2),
    occurrence("Outcome", first, OperationId.make("custom-original-replacement"), 4),
    occurrence("Intent", second, OperationId.make("custom-reacquired-replacement"), 7),
    occurrence("Outcome", second, OperationId.make("custom-reacquired-replacement"), 9)
  ]
  const evidence = records.reduce(
    appendSettledCompletionClaimReplacementEvidence,
    emptySettledCompletionClaimReplacements()
  )
  expect(settledCompletionClaimReplacementAt(evidence, { claim: first, throughPosition: 9 })?.outcome).toBe(records[1])
  expect(settledCompletionClaimReplacementAt(evidence, { claim: second, throughPosition: 9 })?.outcome).toBe(records[3])
  expect(settledCompletionClaimReplacementAt(evidence, { claim: first, throughPosition: 3 })).toBeUndefined()
  expect(settledCompletionClaimReplacementAt(evidence, { claim: second, throughPosition: 8 })).toBeUndefined()
  const reordered = CompletionTaskClaim.make({
    promotionCorrelation: first.promotionCorrelation,
    plannedAttempt: first.plannedAttempt,
    originalClaim: first.originalClaim
  })
  expect(settledCompletionClaimReplacementAt(evidence, { claim: reordered, throughPosition: 9 })?.outcome).toBe(
    records[1]
  )
})

it("matches the chronological raw oracle for missing, mismatched, duplicate, and foreign occurrences", () => {
  const action = fc.record({
    claim: fc.integer({ min: 0, max: 3 }),
    foreign: fc.boolean(),
    gap: fc.integer({ min: 1, max: 4 }),
    kind: fc.constantFrom("Intent" as const, "Outcome" as const),
    operation: fc.integer({ min: 0, max: 4 })
  })
  fc.assert(
    fc.property(fc.array(action, { maxLength: 40 }), (actions) => {
      const records = actions.reduce<ReadonlyArray<JournalRecord>>(
        (prior, current) => [
          ...prior,
          occurrence(
            current.kind,
            claimFor(current.claim),
            OperationId.make(`arbitrary-operation-${current.operation}`),
            (prior.at(-1)?.position ?? 0) + current.gap,
            current.foreign ? RunId.make("foreign-replacement-run") : fixture.runId
          )
        ],
        []
      )
      const evidence = records.reduce(
        appendSettledCompletionClaimReplacementEvidence,
        emptySettledCompletionClaimReplacements()
      )
      for (const claimId of [0, 1, 2, 3]) {
        const claim = claimFor(claimId)
        for (const cutoff of [0, ...records.map(({ position }) => position)]) {
          expect(settledCompletionClaimReplacementAt(evidence, { claim, throughPosition: cutoff })?.outcome).toBe(
            oracle(records, claim, cutoff)
          )
        }
      }
    })
  )
})

it.each([64, 256])("looks up one settled claim after %i unrelated claims without visiting their histories", (count) => {
  const records = Array.from({ length: count }, (_, index) => {
    const claim = claimFor(index)
    const operationId = OperationId.make(`replacement-${index}`)
    return [
      occurrence("Intent", claim, operationId, index * 2 + 1),
      occurrence("Outcome", claim, operationId, index * 2 + 2)
    ]
  }).flat()
  const evidence = records.reduce(
    appendSettledCompletionClaimReplacementEvidence,
    emptySettledCompletionClaimReplacements()
  )
  const visits: Array<string> = []
  const stop = observeSettledCompletionClaimReplacementLookup((event) => visits.push(event))
  try {
    expect(
      settledCompletionClaimReplacementAt(evidence, { claim: claimFor(0), throughPosition: count * 2 })?.outcome
    ).toBe(records[1])
  } finally {
    stop()
  }
  expect(visits).toEqual(["SettlementLookup"])
  expect(inspectSettledCompletionClaimReplacementStorage(evidence)).toHaveLength(2)
})
