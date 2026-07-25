import { it } from "@effect/vitest"
import { Effect, Exit, Fiber } from "effect"
import { expect } from "vitest"
import { FixtureTarget, OperationId, RunId } from "./domain.js"
import { intentRecordKey } from "./journal-record-key.js"
import { type JournalRecord, trackerGraphObservationIntent } from "./journal-store.js"
import { makeTaskWorkSessionRecoveryModelControls } from "./task-work-session-recovery-model-controls.js"
import { makeTaskWorkSessionRecoveryModelJournal } from "./task-work-session-recovery-model-journal.js"
import { makeTrackerGraphObservationOperation } from "./workflow.js"

it.effect("projects a production correlation-conflict return through the M1 controls", () =>
  Effect.gen(function*() {
    const controls = makeTaskWorkSessionRecoveryModelControls()
    yield* controls.init()
    yield* controls.selectIdentity()
    yield* controls.commitIntent()
    yield* controls.requestCreatesNothing()
    yield* controls.lookupConflict()
    yield* controls.recordLookup()

    expect(yield* controls.getState()).toMatchObject({
      recordedEvidence: "Conflict",
      status: "CorrelationConflict"
    })
  }))

it.effect("projects both bounded production non-convergence returns", () =>
  Effect.gen(function*() {
    const unreadable = makeTaskWorkSessionRecoveryModelControls()
    yield* unreadable.init()
    yield* unreadable.selectIdentity()
    yield* unreadable.commitIntent()
    yield* unreadable.requestCreatesNothing()
    for (let attempt = 0; attempt < 3; attempt += 1) {
      yield* unreadable.lookupUnreadable()
      yield* unreadable.recordLookup()
    }
    expect(yield* unreadable.getState()).toMatchObject({ status: "LookupDidNotConverge" })

    const absent = makeTaskWorkSessionRecoveryModelControls()
    yield* absent.init()
    yield* absent.selectIdentity()
    yield* absent.commitIntent()
    yield* absent.requestCreatesNothing()
    for (let attempt = 0; attempt < 3; attempt += 1) {
      yield* absent.lookupAbsent()
      yield* absent.recordLookup()
      if (attempt < 2) yield* absent.requestCreatesNothing()
    }
    expect(yield* absent.getState()).toMatchObject({ status: "EstablishmentDidNotConverge" })
  }))

it.effect("fails closed when asked to record a lookup that is not pending", () =>
  Effect.scoped(Effect.gen(function*() {
    const controls = makeTaskWorkSessionRecoveryModelControls()
    yield* controls.init()
    expect(Exit.isFailure(yield* Effect.exit(controls.commitIntent()))).toBe(true)
    expect(Exit.isFailure(yield* Effect.exit(controls.recordLookup()))).toBe(true)
    const contradictoryLookup = yield* controls.lookupContradictoryAbsence().pipe(Effect.forkScoped)
    yield* Fiber.interrupt(contradictoryLookup)
  })))

it.effect("keeps the model journal idempotent and rejects contradictory appends", () =>
  Effect.gen(function*() {
    const runId = RunId.make("model-journal-run")
    const operationId = OperationId.make("model-journal-operation")
    const records = new Array<JournalRecord>()
    let afterAppendCount = 0
    let beforeAppendCount = 0
    const journal = makeTaskWorkSessionRecoveryModelJournal(
      records,
      runId,
      () => Effect.sync(() => beforeAppendCount += 1),
      () => Effect.sync(() => afterAppendCount += 1)
    )
    const key = intentRecordKey(operationId)
    const event = trackerGraphObservationIntent(
      makeTrackerGraphObservationOperation(operationId, FixtureTarget.make("model-journal-target"))
    )
    yield* journal.append(runId, key, event)
    yield* journal.append(runId, key, event)
    const contradiction = yield* journal.append(
      runId,
      key,
      trackerGraphObservationIntent(makeTrackerGraphObservationOperation(
        OperationId.make("contradictory-operation"),
        FixtureTarget.make("model-journal-target")
      ))
    ).pipe(Effect.exit)

    expect(Exit.isFailure(contradiction)).toBe(true)
    expect(yield* journal.read(runId)).toHaveLength(1)
    expect(yield* journal.read(RunId.make("other-run"))).toHaveLength(0)
    expect((yield* journal.scan()).runs).toHaveLength(1)
    expect({ afterAppendCount, beforeAppendCount }).toEqual({
      afterAppendCount: 2,
      beforeAppendCount: 3
    })
  }))
