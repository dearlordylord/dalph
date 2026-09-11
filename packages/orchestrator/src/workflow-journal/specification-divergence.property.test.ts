import { expect, it } from "vitest"
import fc from "fast-check"
import { makeTaskWorkSpecification, RunId, TaskId } from "@dalph/contracts"
import { FixtureTarget } from "../authorities/task-tracker/fixture/target.js"
import { OperationId } from "../workflow/identity.js"
import { makeTaskWorkSpecificationObservationOperation } from "../workflow/registry/operation.js"
import { describeJournalEvent } from "../workflow/registry/event-descriptor.js"
import {
  makeFocusedTaskWorkSpecificationFactsObserved,
  taskTrackerFactsObservedEvent
} from "../workflow/task-tracker-facts/observation.js"
import { JournalPosition } from "./identity.js"
import type { JournalRecord } from "./store.js"
import { observeJournalRecordSequenceOperations } from "./record-sequence.js"
import {
  appendSpecificationDivergence,
  emptySpecificationDivergence,
  specificationDivergedAfter
} from "./specification-divergence.js"

const taskId = TaskId.make("divergence-task")
const target = FixtureTarget.make("divergence-target")
const revision = (value: number) =>
  makeTaskWorkSpecification({ taskId, title: String(value), body: String(value) }).fingerprint
const record = (value: number, position: number): JournalRecord => {
  const operation = makeTaskWorkSpecificationObservationOperation(
    OperationId.make(`spec-${position}`),
    target,
    taskId,
    []
  )
  const event = taskTrackerFactsObservedEvent(
    operation.operationId,
    makeFocusedTaskWorkSpecificationFactsObserved(
      operation,
      makeTaskWorkSpecification({ taskId, title: String(value), body: String(value) })
    )
  )
  return {
    event,
    key: describeJournalEvent(event).expectedKey,
    position: JournalPosition.make(position),
    runId: RunId.make("divergence-run")
  }
}

it("keeps a differing observation invalidating after a later matching observation", () => {
  const index = [record(1, 1), record(2, 2), record(1, 3)].reduce(
    appendSpecificationDivergence,
    emptySpecificationDivergence()
  )
  expect(
    specificationDivergedAfter(index, { taskId, target, expected: revision(1), afterPosition: 1, throughPosition: 3 })
  ).toBe(true)
  expect(
    specificationDivergedAfter(index, { taskId, target, expected: revision(1), afterPosition: 1, throughPosition: 1 })
  ).toBe(false)
  expect(
    specificationDivergedAfter(index, { taskId, target, expected: revision(1), afterPosition: 2, throughPosition: 3 })
  ).toBe(false)
  expect(
    specificationDivergedAfter(index, {
      taskId,
      target: FixtureTarget.make("foreign"),
      expected: revision(1),
      afterPosition: 0,
      throughPosition: 3
    })
  ).toBe(false)
})

it("matches the chronological existential oracle at every generated window", () => {
  fc.assert(
    fc.property(
      fc.array(fc.integer({ min: 0, max: 3 }), { maxLength: 40 }),
      fc.nat(40),
      fc.nat(40),
      fc.integer({ min: 0, max: 3 }),
      (values, cutoff, baseline, expected) => {
        const index = values
          .map((value, offset) => record(value, offset + 1))
          .reduce(appendSpecificationDivergence, emptySpecificationDivergence())
        expect(
          specificationDivergedAfter(index, {
            taskId,
            target,
            expected: revision(expected),
            afterPosition: baseline,
            throughPosition: cutoff
          })
        ).toBe(values.some((value, offset) => offset + 1 > baseline && offset + 1 <= cutoff && value !== expected))
      }
    )
  )
})

it("bounds warm divergence lookup after 64 and 256 mixed revisions", () => {
  const visits = [64, 256].map((size) => {
    const index = Array.from({ length: size }, (_, offset) => record(offset % 3, offset + 1)).reduce(
      appendSpecificationDivergence,
      emptySpecificationDivergence()
    )
    let count = 0
    const stop = observeJournalRecordSequenceOperations((operation) => {
      expect(operation._tag).toBe("IndexedRecordVisit")
      count += 1
    })
    try {
      expect(
        specificationDivergedAfter(index, {
          taskId,
          target,
          expected: revision(0),
          afterPosition: 1,
          throughPosition: size
        })
      ).toBe(true)
    } finally {
      stop()
    }
    return count
  })
  expect(visits).toEqual([1, 1])
})
