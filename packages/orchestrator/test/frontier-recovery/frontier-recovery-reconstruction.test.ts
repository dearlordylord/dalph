import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Cause, Effect, Exit, FileSystem } from "effect"
import { expect } from "vitest"
import {
  JournalDatabaseLocator,
  OperationId,
  ProviderObservationId,
  RunId,
  TaskId,
  TaskRevision,
  TaskWorkCapacity
} from "../../src/domain.js"
import { JournalStore, memoryJournalStoreLayer } from "../../src/journal-store.js"
import { RunnableFrontierTransition } from "../../src/runnable-frontier.js"
import { sqliteJournalStoreLayer } from "../../src/sqlite-journal-store.js"
import { makeTaskAdmissionController } from "../../src/task-admission-controller.js"
import { FrontierRecoveryModelTaskId } from "./frontier-recovery-conformance.js"
import { frontierRecoveryRunId } from "./frontier-recovery-fixture-identities.js"
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
          capacity: TaskWorkCapacity.make(1),
          coordinatorRunning: true,
          journal
        })
        yield* beforeCrash.init()
        assertReconstructedPrefix(yield* beforeCrash.getState(), [])
        if (afterClaimIntent) {
          yield* beforeCrash.orchestratorCommitsFreshTaskClaimIntent(
            FrontierRecoveryModelTaskId.make(0n)
          )
        }
        if (afterClaimIntent) {
          assertReconstructedPrefix(yield* beforeCrash.getState(), [0n])
        }
        yield* beforeCrash.crash()
        expect((yield* beforeCrash.getState()).coordinatorRunning).toBe(false)

        const afterCrash = yield* makeFrontierRecoveryReconstructionControls({
          capacity: TaskWorkCapacity.make(1),
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

it.effect("selects the same bounded first intents before and after restart", () =>
  Effect.gen(function*() {
    for (const capacity of [1, 2]) {
      yield* Effect.gen(function*() {
        const journal = yield* JournalStore
        const beforeCrash = yield* makeFrontierRecoveryReconstructionControls({
          capacity: TaskWorkCapacity.make(capacity),
          coordinatorRunning: true,
          journal
        })
        yield* beforeCrash.init()
        expect(yield* beforeCrash.getState()).toMatchObject({
          admittedModelTaskIds: capacity === 1 ? [0n] : [0n, 2n],
          frontierModelTaskIds: [0n, 2n],
          responsibleModelTaskIds: []
        })
        for (let step = 0; step < capacity; step++) {
          yield* beforeCrash.orchestratorCommitsNextFreshTaskClaimIntent()
        }
        const uninterrupted = yield* beforeCrash.getState()
        expect(uninterrupted).toMatchObject({
          admittedModelTaskIds: capacity === 1 ? [0n] : [0n, 2n],
          frontierModelTaskIds: [0n, 2n],
          responsibleModelTaskIds: capacity === 1 ? [0n] : [0n, 2n]
        })
        yield* beforeCrash.crash()

        const afterCrash = yield* makeFrontierRecoveryReconstructionControls({
          capacity: TaskWorkCapacity.make(capacity),
          coordinatorRunning: false,
          journal
        })
        yield* afterCrash.restart()
        const restarted = yield* afterCrash.getState()
        expect({
          admittedModelTaskIds: restarted.admittedModelTaskIds,
          admittedTransitionTags: restarted.admittedTransitionTags,
          admissionExplanations: restarted.admissionExplanations,
          admissionReservedModelTaskIds: restarted.admissionReservedModelTaskIds,
          frontierModelTaskIds: restarted.frontierModelTaskIds,
          frontierTransitionTags: restarted.frontierTransitionTags,
          responsibleModelTaskIds: restarted.responsibleModelTaskIds
        }).toEqual({
          admittedModelTaskIds: uninterrupted.admittedModelTaskIds,
          admittedTransitionTags: uninterrupted.admittedTransitionTags,
          admissionExplanations: uninterrupted.admissionExplanations,
          admissionReservedModelTaskIds: uninterrupted.admissionReservedModelTaskIds,
          frontierModelTaskIds: uninterrupted.frontierModelTaskIds,
          frontierTransitionTags: uninterrupted.frontierTransitionTags,
          responsibleModelTaskIds: uninterrupted.responsibleModelTaskIds
        })
      }).pipe(Effect.provide(memoryJournalStoreLayer))
    }
  }))

it.effect("records a fresh target-closure observation after restart", () =>
  Effect.gen(function*() {
    const journal = yield* JournalStore
    const beforeCrash = yield* makeFrontierRecoveryReconstructionControls({
      capacity: TaskWorkCapacity.make(1),
      coordinatorRunning: true,
      journal
    })
    yield* beforeCrash.init()
    yield* beforeCrash.crash()

    const afterCrash = yield* makeFrontierRecoveryReconstructionControls({
      capacity: TaskWorkCapacity.make(1),
      coordinatorRunning: false,
      journal
    })
    yield* afterCrash.restart()
    yield* afterCrash.taskTrackerReturnsTargetClosureReadAtNextRevision()
    expect((yield* afterCrash.getState()).workflowEventTags).toEqual([
      "TrackerGraphObservationIntentRecorded",
      "TrackerGraphOutcomeObserved",
      "TrackerGraphObservationIntentRecorded",
      "TrackerGraphOutcomeObserved"
    ])

    const unsupported = yield* afterCrash.orchestratorCommitsFreshTaskClaimIntent(
      FrontierRecoveryModelTaskId.make(3n)
    ).pipe(Effect.exit)
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
      capacity: TaskWorkCapacity.make(1),
      coordinatorRunning: true,
      journal
    })
    yield* controls.init()
    yield* controls.taskTrackerReturnsTargetClosureReadWithExplicitAbsenceCoverage()

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

it.effect("derives no fresh transition when the fresh tracker read reports no eligible task", () =>
  Effect.gen(function*() {
    const journal = yield* JournalStore
    const controls = yield* makeFrontierRecoveryReconstructionControls({
      capacity: TaskWorkCapacity.make(2),
      coordinatorRunning: true,
      freshEligibleModelTaskIds: [],
      journal
    })
    yield* controls.init()

    expect(yield* controls.getState()).toMatchObject({
      admittedModelTaskIds: [],
      frontierModelTaskIds: []
    })
  }).pipe(Effect.provide(memoryJournalStoreLayer)))

it.effect("does not treat a causal predecessor as read coverage", () =>
  Effect.gen(function*() {
    const journal = yield* JournalStore
    const controls = yield* makeFrontierRecoveryReconstructionControls({
      capacity: TaskWorkCapacity.make(1),
      coordinatorRunning: true,
      journal
    })
    yield* controls.init()
    yield* controls.taskTrackerReturnsTargetClosureReadWithPredecessor()

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
      capacity: TaskWorkCapacity.make(1),
      coordinatorRunning: true,
      journal
    })
    yield* controls.init()
    yield* controls.taskTrackerReturnsTargetClosureReadAtNextRevision()

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
          capacity: TaskWorkCapacity.make(1),
          coordinatorRunning: true,
          journal
        })
        yield* controls.init()
        if (afterClaimIntent) {
          yield* controls.orchestratorCommitsFreshTaskClaimIntent(
            FrontierRecoveryModelTaskId.make(0n)
          )
        }
        yield* controls.crash()
      }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))

      const state = yield* Effect.gen(function*() {
        const journal = yield* JournalStore
        const controls = yield* makeFrontierRecoveryReconstructionControls({
          capacity: TaskWorkCapacity.make(1),
          coordinatorRunning: false,
          journal
        })
        yield* controls.restart()
        return yield* controls.getState()
      }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))
      assertReconstructedPrefix(state, afterClaimIntent ? [0n] : [])
    }
  }).pipe(Effect.provide(NodeServices.layer)))

it.effect("reopens bounded first-intent selection from SQLite at capacities one and two", () =>
  Effect.gen(function*() {
    const fileSystem = yield* FileSystem.FileSystem
    const directory = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "dalph-frontier-admission-"
    })
    for (const capacity of [1, 2]) {
      const filename = JournalDatabaseLocator.make(
        `${directory}/capacity-${capacity}.sqlite`
      )
      yield* Effect.gen(function*() {
        const journal = yield* JournalStore
        const controls = yield* makeFrontierRecoveryReconstructionControls({
          capacity: TaskWorkCapacity.make(capacity),
          coordinatorRunning: true,
          journal
        })
        yield* controls.init()
        for (let step = 0; step < capacity; step++) {
          yield* controls.orchestratorCommitsNextFreshTaskClaimIntent()
        }
        yield* controls.crash()
      }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))

      const restarted = yield* Effect.gen(function*() {
        const journal = yield* JournalStore
        const controls = yield* makeFrontierRecoveryReconstructionControls({
          capacity: TaskWorkCapacity.make(capacity),
          coordinatorRunning: false,
          journal
        })
        yield* controls.restart()
        return yield* controls.getState()
      }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))
      expect(restarted).toMatchObject({
        admittedModelTaskIds: capacity === 1 ? [0n] : [0n, 2n],
        frontierModelTaskIds: [0n, 2n],
        responsibleModelTaskIds: capacity === 1 ? [0n] : [0n, 2n]
      })
    }
  }).pipe(Effect.provide(NodeServices.layer)))

it.effect("uses current capacity and fresh provider evidence after reopening SQLite", () =>
  Effect.gen(function*() {
    const fileSystem = yield* FileSystem.FileSystem
    const directory = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "dalph-frontier-current-capacity-"
    })
    const scenarios = [
      { label: "8-to-2", capacity: 2, occupied: 5, expectedAdmissions: 0 },
      { label: "1-to-2", capacity: 2, occupied: 1, expectedAdmissions: 1 },
      { label: "2-to-1", capacity: 1, occupied: 2, expectedAdmissions: 0 }
    ] as const

    for (const scenario of scenarios) {
      const filename = JournalDatabaseLocator.make(
        `${directory}/${scenario.label}.sqlite`
      )
      yield* Effect.gen(function*() {
        const controls = yield* makeFrontierRecoveryReconstructionControls({
          capacity: TaskWorkCapacity.make(8),
          coordinatorRunning: true,
          journal: yield* JournalStore
        })
        yield* controls.init()
        yield* controls.crash()
      }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))

      yield* Effect.gen(function*() {
        const journal = yield* JournalStore
        expect(yield* journal.read(frontierRecoveryRunId))
          .not.toEqual([])
        const occupied = Array.from(
          { length: scenario.occupied },
          (_, index) => ({
            observationId: ProviderObservationId.make(
              `${scenario.label}-observation-${index}`
            ),
            operationId: OperationId.make(
              `${scenario.label}-operation-${index}`
            ),
            taskId: TaskId.make(`${scenario.label}-task-${index}`)
          })
        )
        const controller = yield* makeTaskAdmissionController({
          capacity: TaskWorkCapacity.make(scenario.capacity),
          freshOccupiedInvocations: occupied,
          reconstructedReservedPositions: []
        })
        const freshTaskId = TaskId.make(`${scenario.label}-fresh`)
        const admission = yield* controller.admit(
          {
            explanations: [],
            transitions: [
              RunnableFrontierTransition.CommitFreshTaskClaimIntent({
                taskId: freshTaskId,
                taskRevision: TaskRevision.make(
                  `${scenario.label}-fresh-revision`
                )
              })
            ]
          },
          RunId.make(`${scenario.label}-run`)
        )
        expect((yield* controller.snapshot()).occupied)
          .toHaveLength(scenario.occupied)
        expect(admission.transitions).toHaveLength(
          scenario.expectedAdmissions
        )
      }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))
    }
  }).pipe(Effect.provide(NodeServices.layer)))
