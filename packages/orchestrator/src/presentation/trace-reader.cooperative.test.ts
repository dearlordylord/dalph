/* eslint-disable functional/immutable-data -- The controlled scheduler and source counters are test observations. */
import { Effect, Fiber, type Scheduler } from "effect"
import { expect, it } from "vitest"
import { JournalPosition } from "../workflow-journal/identity.js"
import { TraceCursor, TraceHistory } from "./trace-reader.js"
import { capacitiesThrough, readerFor, runId } from "./trace-reader.prepared-fixtures.js"

const controlledScheduler = () => {
  const tasks: Array<() => void> = []
  const scheduler: Scheduler.Scheduler = {
    executionMode: "async",
    shouldYield: () => false,
    makeDispatcher: () => ({
      scheduleTask: (task) => {
        tasks.push(task)
      },
      flush: () => {
        while (tasks.length > 0) tasks.shift()?.()
      }
    })
  }
  return {
    scheduler,
    step: () => tasks.shift()?.(),
    flush: () => {
      while (tasks.length > 0) tasks.shift()?.()
    }
  }
}

it("yields during complete validation, admits another fiber, and returns exact canonical history", async () => {
  const source = capacitiesThrough(Array.from({ length: 64 }, () => 2))
  const cursor = TraceCursor.make({ runId, position: JournalPosition.make(source.length) })
  let eventReads = 0
  const records = source.map((record) => ({
    ...record,
    get event() {
      eventReads += 1
      return record.event
    }
  }))
  const scheduler = controlledScheduler()
  const fiber = Effect.runFork(readerFor(records).readOccurrencesAt(cursor), { scheduler: scheduler.scheduler })
  // The selected-prefix identity walk finishes before nested/semantic validation.
  // Count its exact source inspections independently using a gapped envelope.
  let prefixReads = 0
  const invalid = source.map((record, index) => ({
    ...record,
    position: JournalPosition.make(index === source.length - 1 ? source.length + 1 : index + 1),
    get event() {
      prefixReads += 1
      return record.event
    }
  }))
  const invalidCursor = TraceCursor.make({ runId, position: JournalPosition.make(source.length + 1) })
  await Effect.runPromise(Effect.result(readerFor(invalid).readOccurrencesAt(invalidCursor)))
  while (eventReads <= prefixReads && fiber.pollUnsafe() === undefined) scheduler.step()
  expect(eventReads).toBeGreaterThan(prefixReads)
  expect(fiber.pollUnsafe()).toBeUndefined()
  let admitted = false
  const control = Effect.runFork(
    Effect.sync(() => {
      admitted = true
    }),
    { scheduler: scheduler.scheduler }
  )
  while (control.pollUnsafe() === undefined) scheduler.step()
  expect(admitted).toBe(true)
  expect(fiber.pollUnsafe()).toBeUndefined()
  scheduler.flush()
  const history = await Effect.runPromise(Fiber.join(fiber))
  await Effect.runPromise(Fiber.join(control))
  const canonical = Effect.runSync(readerFor(source).read(runId))
  expect(history).toEqual(canonical)
  expect(TraceHistory.make(history)).toEqual(history)
})

it("discards an interrupted validation and rebuilds before publishing a successful cache", async () => {
  const source = capacitiesThrough(Array.from({ length: 64 }, () => 2))
  let eventReads = 0
  const records = source.map((record) => ({
    ...record,
    get event() {
      eventReads += 1
      return record.event
    }
  }))
  const reader = readerFor(records)
  const cursor = TraceCursor.make({ runId, position: JournalPosition.make(records.length) })
  const scheduler = controlledScheduler()
  const pending = Effect.runFork(reader.readOccurrencesAt(cursor), { scheduler: scheduler.scheduler })
  while (eventReads === 0) scheduler.step()
  const stopped = Effect.runFork(Fiber.interrupt(pending), { scheduler: scheduler.scheduler })
  scheduler.flush()
  await Effect.runPromise(Fiber.join(stopped))
  expect(pending.pollUnsafe()?._tag).toBe("Failure")
  eventReads = 0
  const history = await Effect.runPromise(reader.readOccurrencesAt(cursor))
  expect(eventReads).toBeGreaterThan(records.length)
  eventReads = 0
  expect(await Effect.runPromise(reader.readOccurrencesAt(cursor))).toBe(history)
  expect(eventReads).toBe(0)
})

it("preserves fixed-prefix parity and error precedence across appended malformed envelopes", async () => {
  const source = capacitiesThrough([2, 3, 4])
  const early = TraceCursor.make({ runId, position: JournalPosition.make(2) })
  const reader = readerFor(source)
  const canonical = Effect.runSync(reader.readAt(early))
  expect(await Effect.runPromise(reader.readOccurrencesAt(early))).toEqual(
    TraceHistory.make({ runId, committedThrough: early.position, items: canonical.items, version: 4 })
  )
  const second = source[1]
  if (second === undefined) return expect.fail("second record required")
  const duplicate = [...source, second]
  const failure = await Effect.runPromise(
    Effect.result(
      readerFor(duplicate).readOccurrencesAt(TraceCursor.make({ runId, position: JournalPosition.make(4) }))
    )
  )
  expect(failure).toMatchObject({ _tag: "Failure", failure: { _tag: "TraceJournalPrefixInvalid" } })
})
