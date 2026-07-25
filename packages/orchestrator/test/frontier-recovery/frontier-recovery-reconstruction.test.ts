import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Cause, Effect, Exit, FileSystem } from "effect"
import { expect } from "vitest"
import { JournalDatabaseLocator } from "../../src/domain.js"
import { JournalStore, memoryJournalStoreLayer } from "../../src/journal-store.js"
import { sqliteJournalStoreLayer } from "../../src/sqlite-journal-store.js"
import { makeFrontierRecoveryReconstructionControls } from "./frontier-recovery-reconstruction.js"

const assertReconstructedPrefix = (
  state: {
    readonly coordinatorRunning: boolean
    readonly knownModelTaskIds: ReadonlyArray<bigint>
    readonly responsibleModelTaskIds: ReadonlyArray<bigint>
    readonly workflowEventTags: ReadonlyArray<string>
  },
  responsibleModelTaskIds: ReadonlyArray<bigint>
) => {
  expect(state).toMatchObject({
    coordinatorRunning: true,
    knownModelTaskIds: [0n, 1n, 2n, 3n],
    responsibleModelTaskIds
  })
  expect(state.workflowEventTags).toEqual(
    responsibleModelTaskIds.length === 0
      ? [
        "TrackerGraphObservationIntentRecorded",
        "TrackerGraphOutcomeObserved"
      ]
      : [
        "TrackerGraphObservationIntentRecorded",
        "TrackerGraphOutcomeObserved",
        "TaskClaimAcquisitionIntended"
      ]
  )
}

it.effect("reconstructs M2 P0 and P1 through fresh in-memory controls", () =>
  Effect.gen(function*() {
    for (const afterClaimIntent of [false, true]) {
      yield* Effect.gen(function*() {
        const journal = yield* JournalStore
        const beforeCrash = yield* makeFrontierRecoveryReconstructionControls({
          coordinatorRunning: true,
          journal
        })
        yield* beforeCrash.init()
        if (afterClaimIntent) yield* beforeCrash.commitFirstIntent(0n)
        yield* beforeCrash.crash()

        const afterCrash = yield* makeFrontierRecoveryReconstructionControls({
          coordinatorRunning: false,
          journal
        })
        yield* afterCrash.restart()
        assertReconstructedPrefix(
          yield* afterCrash.getState(),
          afterClaimIntent ? [0n] : []
        )
      }).pipe(Effect.provide(memoryJournalStoreLayer))
    }
  }))

it.effect("records a fresh target-closure observation after restart", () =>
  Effect.gen(function*() {
    const journal = yield* JournalStore
    const beforeCrash = yield* makeFrontierRecoveryReconstructionControls({
      coordinatorRunning: true,
      journal
    })
    yield* beforeCrash.init()
    yield* beforeCrash.crash()

    const afterCrash = yield* makeFrontierRecoveryReconstructionControls({
      coordinatorRunning: false,
      journal
    })
    yield* afterCrash.restart()
    yield* afterCrash.observeTask(0n)
    expect((yield* afterCrash.getState()).workflowEventTags).toEqual([
      "TrackerGraphObservationIntentRecorded",
      "TrackerGraphOutcomeObserved",
      "TrackerGraphObservationIntentRecorded",
      "TrackerGraphOutcomeObserved"
    ])

    const unsupported = yield* afterCrash.commitFirstIntent(2n).pipe(Effect.exit)
    expect(Exit.isFailure(unsupported)).toBe(true)
    if (Exit.isFailure(unsupported)) {
      expect(Cause.squash(unsupported.cause)).toMatchObject({
        _tag: "FrontierRecoveryConformanceIssue",
        reason: "MissingMapping"
      })
    }
  }).pipe(Effect.provide(memoryJournalStoreLayer)))

it.effect("reconstructs M2 P0 and P1 after closing and reopening SQLite", () =>
  Effect.gen(function*() {
    const fileSystem = yield* FileSystem.FileSystem
    const directory = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "dalph-frontier-recovery-reconstruction-"
    })
    for (const afterClaimIntent of [false, true]) {
      const filename = JournalDatabaseLocator.make(
        `${directory}/${afterClaimIntent ? "P1" : "P0"}.sqlite`
      )
      yield* Effect.gen(function*() {
        const journal = yield* JournalStore
        const controls = yield* makeFrontierRecoveryReconstructionControls({
          coordinatorRunning: true,
          journal
        })
        yield* controls.init()
        if (afterClaimIntent) yield* controls.commitFirstIntent(0n)
        yield* controls.crash()
      }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))

      const state = yield* Effect.gen(function*() {
        const journal = yield* JournalStore
        const controls = yield* makeFrontierRecoveryReconstructionControls({
          coordinatorRunning: false,
          journal
        })
        yield* controls.restart()
        return yield* controls.getState()
      }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))
      assertReconstructedPrefix(state, afterClaimIntent ? [0n] : [])
    }
  }).pipe(Effect.provide(NodeServices.layer)))
