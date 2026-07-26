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
    readonly graphKnowledge: {
      readonly targetClosures: ReadonlyArray<{ readonly _tag: string }>
    }
    readonly knownModelTaskIds: ReadonlyArray<bigint>
    readonly pause: unknown
    readonly responsibility: { readonly entries: ReadonlyArray<unknown> }
    readonly responsibleModelTaskIds: ReadonlyArray<bigint>
    readonly workflowHistory: ReadonlyArray<{
      readonly event: { readonly _tag: string }
    }>
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
  expect(state.workflowHistory.map(({ event }) => event._tag)).toEqual(
    state.workflowEventTags
  )
  expect(state.graphKnowledge.targetClosures).toHaveLength(1)
  expect(state.graphKnowledge.targetClosures[0]?._tag).toBe(
    "TaskTrackerTargetClosureObserved"
  )
  expect(state.responsibility.entries).toHaveLength(
    responsibleModelTaskIds.length
  )
  expect(state.pause).toEqual({
    run: { _tag: "RunUnpaused" },
    tasks: { _tag: "NoTaskPauses" }
  })
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
        assertReconstructedPrefix(yield* beforeCrash.getState(), [])
        if (afterClaimIntent) yield* beforeCrash.commitFirstIntent(0n)
        if (afterClaimIntent) {
          assertReconstructedPrefix(yield* beforeCrash.getState(), [0n])
        }
        yield* beforeCrash.crash()
        expect((yield* beforeCrash.getState()).coordinatorRunning).toBe(false)

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
    yield* afterCrash.observeCompatibleReplacement()
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

it.effect("replays coverage evidence through the production graph-knowledge reducer", () =>
  Effect.gen(function*() {
    const journal = yield* JournalStore
    const controls = yield* makeFrontierRecoveryReconstructionControls({
      coordinatorRunning: true,
      journal
    })
    yield* controls.init()
    yield* controls.observeProvenAbsence()

    const state = yield* controls.getState()
    expect(state.graphKnowledge.targetClosures).toEqual([
      expect.objectContaining({
        _tag: "TaskTrackerTargetClosureObserved",
        completeness: "Complete",
        consistency: "PotentiallyMixedTime",
        explicitlyCoveredTaskIds: ["frontier-recovery-task-B"],
        factFamilies: ["TargetMembership"],
        freshness: "FreshAtReadBoundary",
        operationId: "frontier-recovery-graph-observation-2",
        provenAbsentTaskIds: ["frontier-recovery-task-B"],
        revision: "frontier-recovery-revision-1",
        taskIds: [
          "frontier-recovery-task-A",
          "frontier-recovery-task-C",
          "frontier-recovery-task-D"
        ]
      })
    ])
    expect(state.workflowHistory.map(({ event }) => event._tag)).toEqual([
      "TrackerGraphObservationIntentRecorded",
      "TrackerGraphOutcomeObserved",
      "TrackerGraphObservationIntentRecorded",
      "TrackerGraphOutcomeObserved"
    ])
    expect(state.responsibility.entries).toEqual([])
  }).pipe(Effect.provide(memoryJournalStoreLayer)))

it.effect("does not treat a causal predecessor as read coverage", () =>
  Effect.gen(function*() {
    const journal = yield* JournalStore
    const controls = yield* makeFrontierRecoveryReconstructionControls({
      coordinatorRunning: true,
      journal
    })
    yield* controls.init()
    yield* controls.observeIncomparableMembership()

    const state = yield* controls.getState()
    expect(state.graphKnowledge.targetClosures[0]).toMatchObject({
      _tag: "TaskTrackerTargetClosureKnowledgeConflict",
      observations: [
        {
          explicitlyCoveredTaskIds: [],
          operationId: "frontier-recovery-graph-observation-0",
          taskIds: [
            "frontier-recovery-task-A",
            "frontier-recovery-task-B",
            "frontier-recovery-task-C",
            "frontier-recovery-task-D"
          ]
        },
        {
          explicitlyCoveredTaskIds: [],
          operationId: "frontier-recovery-graph-observation-2",
          provenAbsentTaskIds: [],
          taskIds: [
            "frontier-recovery-task-A",
            "frontier-recovery-task-C",
            "frontier-recovery-task-D"
          ]
        }
      ]
    })
  }).pipe(Effect.provide(memoryJournalStoreLayer)))

it.effect("replaces compatible membership knowledge with the fresh observation", () =>
  Effect.gen(function*() {
    const journal = yield* JournalStore
    const controls = yield* makeFrontierRecoveryReconstructionControls({
      coordinatorRunning: true,
      journal
    })
    yield* controls.init()
    yield* controls.observeCompatibleReplacement()

    expect((yield* controls.getState()).graphKnowledge.targetClosures).toEqual([
      expect.objectContaining({
        _tag: "TaskTrackerTargetClosureObserved",
        operationId: "frontier-recovery-graph-observation-2",
        revision: "frontier-recovery-revision-1"
      })
    ])
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
