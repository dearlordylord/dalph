import { expect, it } from "vitest"
import { RunId } from "@dalph/contracts"
import fc from "fast-check"
import { integrationFinalityFixture as fixture } from "../workflow/protocols/integration-finality/fixtures.js"
import {
  CompletionTaskAuthorizationReadOrdinal,
  CompletionTaskConfirmationReadOrdinal,
  CompletionTaskFocusedReadPurpose,
  CompletionTaskRequestOrdinal,
  completionTaskRequestFor
} from "../workflow/protocols/integration-finality/events.js"
import { makeCompletionTaskFactsObservationOperation } from "../workflow/registry/operation.js"
import { taskTrackerReadIntent } from "../workflow/registry/event.js"
import {
  makeFocusedTaskCompletionFactsObserved,
  taskTrackerFactsObservedEvent
} from "../workflow/task-tracker-facts/observation.js"
import { JournalPosition, JournalRecordKey } from "./identity.js"
import type { JournalRecord } from "./store.js"
import {
  appendCompletionReadCycleEvidence,
  completionReadCycleAt,
  emptyCompletionReadCycles,
  inspectCompletionReadCycleStorage,
  observeCompletionReadCycleOperations
} from "./completion-read-cycles.js"

const request = completionTaskRequestFor(fixture.claim)
const attemptOrdinal = CompletionTaskRequestOrdinal.make(1)
const events = (purpose: "Authorization" | "Confirmation", ordinal: number) => {
  const cycle =
    purpose === "Authorization"
      ? CompletionTaskFocusedReadPurpose.cases.Authorization.make({
          attemptOrdinal,
          authorizationOrdinal: CompletionTaskAuthorizationReadOrdinal.make(ordinal)
        })
      : CompletionTaskFocusedReadPurpose.cases.Confirmation.make({
          attemptOrdinal,
          confirmationOrdinal: CompletionTaskConfirmationReadOrdinal.make(ordinal)
        })
  const operation = makeCompletionTaskFactsObservationOperation(request, fixture.target, cycle)
  const observation = makeFocusedTaskCompletionFactsObserved(operation, {
    currentClaim: fixture.claim,
    lifecycle: "Open",
    operationId: operation.operationId,
    target: fixture.target,
    targetMembership: "Member",
    taskId: fixture.taskId,
    taskRevision: fixture.plannedAttempt.taskRevision,
    trackerRevision: fixture.trackerRevision,
    unfinishedPrerequisiteTaskIds: []
  })
  return [taskTrackerReadIntent(operation), taskTrackerFactsObservedEvent(operation.operationId, observation)] as const
}
const record = (position: number, event: JournalRecord["event"]): JournalRecord => ({
  event,
  key: JournalRecordKey.make(`completion-cycle:${position}`),
  position: JournalPosition.make(position),
  runId: fixture.runId
})
const project = (records: ReadonlyArray<JournalRecord>) =>
  records.reduce(appendCompletionReadCycleEvidence, emptyCompletionReadCycles())
const query = (purpose: "Authorization" | "Confirmation", throughPosition: number) => ({
  request,
  attemptOrdinal,
  purpose,
  throughPosition
})

it("retains independent authorization and confirmation counts, noncontiguous maxima, and unresolved reads", () => {
  const first = events("Authorization", 7)
  const second = events("Authorization", 2)
  const confirmation = events("Confirmation", 4)
  const records = [record(1, first[0]), record(2, confirmation[0]), record(3, second[0]), record(4, second[1])]
  const evidence = project(records)
  expect(completionReadCycleAt(evidence, query("Authorization", 4))).toMatchObject({
    intentCount: 2,
    maximumOrdinal: 7,
    latestIntent: records[2],
    latestUnresolvedIntent: records[0],
    latestOutcome: records[3]
  })
  expect(completionReadCycleAt(evidence, query("Confirmation", 4))).toMatchObject({
    intentCount: 1,
    maximumOrdinal: 4,
    latestUnresolvedIntent: records[1]
  })
  expect(completionReadCycleAt(evidence, query("Authorization", 2))).toMatchObject({
    intentCount: 1,
    maximumOrdinal: 7,
    latestUnresolvedIntent: records[0]
  })
})

it("matches chronological intent/outcome presence at every sparse cutoff without assuming contiguous cycles", () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.record({ ordinal: fc.integer({ min: 1, max: 12 }), outcome: fc.boolean(), confirmation: fc.boolean() }),
        { maxLength: 60 }
      ),
      (items) => {
        const records = items.map((item, offset) =>
          record(
            (offset + 1) * 2,
            events(item.confirmation ? "Confirmation" : "Authorization", item.ordinal)[item.outcome ? 1 : 0]
          )
        )
        const evidence = project(records)
        for (let cutoff = 0; cutoff <= records.length * 2; cutoff += 1) {
          for (const purpose of ["Authorization", "Confirmation"] as const) {
            const visible = records.filter((candidate) => candidate.position <= cutoff)
            const intents = visible.filter(
              (candidate) =>
                candidate.event._tag === "TaskTrackerReadIntentRecorded" &&
                candidate.event.operation._tag === "ReadCompletionTaskFacts" &&
                candidate.event.operation.purpose._tag === purpose
            )
            const outcomes = visible.filter(
              (candidate) =>
                candidate.event._tag === "TaskTrackerFactsObserved" &&
                candidate.event.observation._tag === "FocusedTaskCompletionFacts" &&
                candidate.event.observation.purpose._tag === purpose
            )
            const unresolved = intents.findLast(
              ({ event }) =>
                event._tag === "TaskTrackerReadIntentRecorded" &&
                !outcomes.some(
                  (outcome) =>
                    outcome.event._tag === "TaskTrackerFactsObserved" &&
                    outcome.event.operationId === event.operation.operationId
                )
            )
            const ordinals = intents.map((candidate) => {
              if (
                candidate.event._tag !== "TaskTrackerReadIntentRecorded" ||
                candidate.event.operation._tag !== "ReadCompletionTaskFacts"
              )
                throw new Error("fixture intent mismatch")
              const value = candidate.event.operation.purpose
              return value._tag === "Authorization" ? value.authorizationOrdinal : value.confirmationOrdinal
            })
            const actual = completionReadCycleAt(evidence, query(purpose, cutoff))
            expect(actual.intentCount).toBe(intents.length)
            expect(actual.maximumOrdinal).toBe(Math.max(0, ...ordinals))
            expect(actual.latestIntent).toBe(intents.at(-1))
            expect(actual.latestOutcome).toBe(outcomes.at(-1))
            expect(actual.latestUnresolvedIntent).toBe(unresolved)
          }
        }
      }
    ),
    { numRuns: 40 }
  )
})

it("does not settle an exact read with a foreign Run outcome", () => {
  const pair = events("Authorization", 1)
  const intent = record(1, pair[0])
  const foreign = { ...record(2, pair[1]), runId: RunId.make("foreign-completion-cycle") }
  expect(completionReadCycleAt(project([intent, foreign]), query("Authorization", 2)).latestUnresolvedIntent).toBe(
    intent
  )
})

it("keeps a colliding operation from another purpose separate and shares across graph changes", () => {
  const authorization = events("Authorization", 1)
  const confirmation = events("Confirmation", 1)
  const intent = record(1, authorization[0])
  const collision = record(2, { ...confirmation[1], operationId: authorization[1].operationId })
  const first = project([intent, collision])
  expect(completionReadCycleAt(first, query("Authorization", 2)).latestUnresolvedIntent).toBe(intent)
  expect(completionReadCycleAt(first, query("Confirmation", 2)).latestOutcome).toBe(collision)
  const unchanged = appendCompletionReadCycleEvidence(first, record(3, fixture.graphRecordEvent))
  expect(unchanged).toBe(first)
  const nextIntent = record(4, confirmation[0])
  const advanced = appendCompletionReadCycleEvidence(unchanged, nextIntent)
  expect(completionReadCycleAt(advanced, query("Confirmation", 4)).latestUnresolvedIntent).toBe(nextIntent)
  expect(completionReadCycleAt(advanced, query("Confirmation", 2)).latestIntent).toBeUndefined()
})

it("settles one older unresolved operation with logarithmic work while retaining the latest pending read", () => {
  const visits = [64, 256].map((size) => {
    const records = Array.from({ length: size }, (_, offset) =>
      record(offset + 1, events("Authorization", offset + 1)[0])
    )
    const evidence = project(records)
    let count = 0
    const stop = observeCompletionReadCycleOperations((operation) => {
      if (operation === "UnresolvedNodeRead") count += 1
    })
    try {
      const next = appendCompletionReadCycleEvidence(evidence, record(size + 1, events("Authorization", 1)[1]))
      expect(completionReadCycleAt(next, query("Authorization", size + 1)).latestUnresolvedIntent).toBe(records.at(-1))
    } finally {
      stop()
    }
    return count
  })
  expect(visits).toEqual([7, 9])
})

const reachableObjects = (roots: ReadonlyArray<object>): number => {
  const seen = new Set<object>()
  const visit = (value: unknown): void => {
    if (typeof value !== "object" || value === null || seen.has(value)) return
    seen.add(value)
    for (const field of Object.values(value)) visit(field)
  }
  for (const root of roots) visit(root)
  return seen.size
}

it("retains shared cutoff structure rather than a chain of copied unresolved histories", () => {
  const sizes = [64, 256].map((size) => {
    const records = Array.from({ length: size }, (_, offset) =>
      record(offset + 1, events("Authorization", offset + 1)[0])
    )
    const evidence = project(records)
    expect(completionReadCycleAt(evidence, query("Authorization", 1)).latestUnresolvedIntent).toBe(records[0])
    return reachableObjects(inspectCompletionReadCycleStorage(evidence))
  })
  const [small, large] = sizes
  if (small === undefined || large === undefined) throw new Error("fixture requires both retained sizes")
  expect(small).toBeGreaterThan(64)
  expect(large).toBeLessThan(small * 8)
})

it("keeps warm read-cycle lookup constant after 64 and 256 interleaved settled cycles", () => {
  const visits = [64, 256].map((size) => {
    const records = Array.from({ length: size }, (_, offset) =>
      events(offset % 2 === 0 ? "Authorization" : "Confirmation", offset + 1)
    ).flatMap((pair, offset) => [record(offset * 2 + 1, pair[0]), record(offset * 2 + 2, pair[1])])
    const evidence = project(records)
    let count = 0
    const stop = observeCompletionReadCycleOperations(() => {
      count += 1
    })
    try {
      expect(completionReadCycleAt(evidence, query("Authorization", size * 2)).latestUnresolvedIntent).toBeUndefined()
      expect(completionReadCycleAt(evidence, query("Confirmation", size * 2)).latestUnresolvedIntent).toBeUndefined()
    } finally {
      stop()
    }
    return count
  })
  expect(visits).toEqual([2, 2])
})
