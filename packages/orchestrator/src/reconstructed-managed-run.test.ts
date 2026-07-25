import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect, FileSystem, Schema } from "effect"
import { expect } from "vitest"
import {
  ClaimOwner,
  ClaimToken,
  FixtureTarget,
  JournalDatabaseLocator,
  JournalPosition,
  OperationId,
  RunId,
  TaskId,
  TrackerRevision
} from "./domain.js"
import {
  intentRecordKey,
  type JournalRecord,
  JournalStore,
  memoryJournalStoreLayer,
  outcomeRecordKey,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  trackerGraphObservationIntent,
  trackerGraphOutcomeObserved
} from "./journal-store.js"
import { reduceManagedHistory } from "./managed-history.js"
import {
  TaskTrackerTargetClosureKnowledgeConflict,
  TaskTrackerTargetClosureObservation
} from "./reconstructed-managed-run-state.js"
import { reconstructManagedRunState } from "./reconstructed-managed-run.js"
import { sqliteJournalStoreLayer } from "./sqlite-journal-store.js"
import { ActiveTaskClaim } from "./tracker-mutation.js"
import { makeTaskClaimAcquisitionOperation, makeTrackerGraphObservationOperation } from "./workflow-operation.js"

const runId = RunId.make("reconstructed-run")
const target = FixtureTarget.make("reconstructed-run-target")
const taskA = TaskId.make("A")
const taskB = TaskId.make("B")

const records = (
  ...events: ReadonlyArray<Pick<JournalRecord, "event" | "key">>
): ReadonlyArray<JournalRecord> =>
  events.map((event, index) => ({
    ...event,
    position: JournalPosition.make(index + 1),
    runId
  }))

const graphObservation = makeTrackerGraphObservationOperation(
  OperationId.make("observe-A-and-B"),
  target
)
const observedGraph = [
  {
    event: trackerGraphObservationIntent(graphObservation),
    key: intentRecordKey(graphObservation.operationId)
  },
  {
    event: trackerGraphOutcomeObserved(graphObservation.operationId, {
      _tag: "TrackerGraphObserved",
      revision: TrackerRevision.make("revision-A-and-B"),
      taskIds: [taskA, taskB]
    }),
    key: outcomeRecordKey(graphObservation.operationId)
  }
] as const

const validTargetClosureObservation = {
  _tag: "TaskTrackerTargetClosureObserved" as const,
  completeness: "Complete" as const,
  consistency: "PotentiallyMixedTime" as const,
  explicitlyCoveredTaskIds: [taskA],
  factFamilies: ["TargetMembership"] as const,
  freshness: "FreshAtReadBoundary" as const,
  observedAt: JournalPosition.make(1),
  operationId: graphObservation.operationId,
  provenAbsentTaskIds: [],
  revision: TrackerRevision.make("schema-validation-revision"),
  target,
  taskIds: [taskA]
}

const claimA = makeTaskClaimAcquisitionOperation({
  acquisition: {
    operationId: OperationId.make("claim-A"),
    owner: ClaimOwner.make("owner"),
    taskId: taskA,
    token: ClaimToken.make("claim-A-token")
  },
  predecessorOperationIds: [graphObservation.operationId]
})
const claimIntent = {
  event: TaskClaimAcquisitionIntendedEvent.make({
    operation: claimA,
    version: 4
  }),
  key: intentRecordKey(claimA.acquisition.operationId)
} as const

const assertScenarioOnePrefix = (
  retainedRecords: ReadonlyArray<JournalRecord>,
  expectedResponsibleTaskIds: ReadonlyArray<TaskId>
): void => {
  const reduced = reduceManagedHistory(runId, retainedRecords)
  expect(reduced._tag).toBe("ValidManagedHistory")
  if (reduced._tag !== "ValidManagedHistory") return
  const targetClosure = reduced.managedRun.graphKnowledge.targetClosures[0]
  expect(targetClosure?._tag).toBe("TaskTrackerTargetClosureObserved")
  if (targetClosure?._tag !== "TaskTrackerTargetClosureObserved") return
  expect(targetClosure.taskIds).toEqual([taskA, taskB])
  expect(
    reduced.managedRun.responsibility.entries.flatMap((entry) =>
      entry._tag === "TaskClaimResponsibility" ? [entry.acquisition.taskId] : []
    )
  ).toEqual(expectedResponsibleTaskIds)
}

const seedScenarioOnePrefix = Effect.fn("ReconstructedManagedRunTest.seedScenarioOnePrefix")(
  function*(prefix: ReadonlyArray<Pick<JournalRecord, "event" | "key">>) {
    const journal = yield* JournalStore
    for (const { event, key } of prefix) {
      yield* journal.append(runId, key, event)
    }
  }
)

const readScenarioOnePrefix = Effect.fn("ReconstructedManagedRunTest.readScenarioOnePrefix")(
  function*() {
    const journal = yield* JournalStore
    return yield* journal.read(runId)
  }
)

it("rejects contradictory target-closure coverage and malformed local conflicts", () => {
  const decodeObservation = Schema.decodeUnknownSync(TaskTrackerTargetClosureObservation)
  expect(() =>
    decodeObservation({
      ...validTargetClosureObservation,
      provenAbsentTaskIds: [taskA]
    })
  ).toThrow("one task cannot be both observed and proven absent")
  expect(() =>
    decodeObservation({
      ...validTargetClosureObservation,
      explicitlyCoveredTaskIds: [],
      provenAbsentTaskIds: [taskB]
    })
  ).toThrow("every proven-absent task must be explicitly covered")
  expect(() =>
    decodeObservation({
      ...validTargetClosureObservation,
      explicitlyCoveredTaskIds: [taskA, taskB]
    })
  ).toThrow("every explicitly covered task must be observed or proven absent")

  const decodeConflict = Schema.decodeUnknownSync(TaskTrackerTargetClosureKnowledgeConflict)
  expect(() =>
    decodeConflict({
      _tag: "TaskTrackerTargetClosureKnowledgeConflict",
      observations: [
        validTargetClosureObservation,
        {
          ...validTargetClosureObservation,
          explicitlyCoveredTaskIds: [],
          target: FixtureTarget.make("another-target"),
          taskIds: [taskB]
        }
      ],
      target
    })
  ).toThrow("every conflicting observation must cover the conflict target")
  expect(() =>
    decodeConflict({
      _tag: "TaskTrackerTargetClosureKnowledgeConflict",
      observations: [
        validTargetClosureObservation,
        {
          ...validTargetClosureObservation,
          operationId: OperationId.make("same-membership")
        }
      ],
      target
    })
  ).toThrow("a conflict requires at least two different target memberships")
})

it("reports malformed direct reducer inputs without inventing authority", () => {
  expect(reconstructManagedRunState(runId, [])).toMatchObject({
    _tag: "ValidReconstructedManagedRun",
    state: { appliedThrough: null }
  })

  expect(reconstructManagedRunState(runId, records(observedGraph[1]))).toMatchObject({
    _tag: "ValidReconstructedManagedRun",
    state: { graphKnowledge: { targetClosures: [] } }
  })

  const mispositionedGraph = records(...observedGraph).map((record) => ({
    ...record,
    position: JournalPosition.make(record.position + 1)
  }))
  expect(reconstructManagedRunState(runId, mispositionedGraph)).toMatchObject({
    _tag: "InvalidReconstructedManagedRun",
    issues: [{ _tag: "GraphKnowledgeHistoryMismatch" }]
  })

  const missingResponsibilityRecord = [{
    ...records(claimIntent)[0] as JournalRecord,
    position: JournalPosition.make(2)
  }]
  expect(reconstructManagedRunState(runId, missingResponsibilityRecord)).toMatchObject({
    _tag: "InvalidReconstructedManagedRun",
    issues: [{ _tag: "ResponsibilityHistoryMismatch" }]
  })

  const mismatchedResponsibilityRecord = [
    { ...records(observedGraph[0])[0] as JournalRecord, position: JournalPosition.make(2) },
    { ...records(claimIntent)[0] as JournalRecord, position: JournalPosition.make(1) }
  ]
  expect(reconstructManagedRunState(runId, mismatchedResponsibilityRecord)).toMatchObject({
    _tag: "InvalidReconstructedManagedRun",
    issues: [{ _tag: "ResponsibilityHistoryMismatch" }]
  })
})

it("keeps graph knowledge separate from workflow responsibility before and after claim intent", () => {
  const beforeIntent = reduceManagedHistory(runId, records(...observedGraph))
  expect(beforeIntent._tag).toBe("ValidManagedHistory")
  if (beforeIntent._tag !== "ValidManagedHistory") return

  expect(beforeIntent.managedRun.graphKnowledge.targetClosures).toEqual([
    {
      _tag: "TaskTrackerTargetClosureObserved",
      completeness: "Complete",
      consistency: "PotentiallyMixedTime",
      explicitlyCoveredTaskIds: [],
      factFamilies: ["TargetMembership"],
      freshness: "FreshAtReadBoundary",
      observedAt: JournalPosition.make(2),
      operationId: graphObservation.operationId,
      provenAbsentTaskIds: [],
      revision: TrackerRevision.make("revision-A-and-B"),
      target,
      taskIds: [taskA, taskB]
    }
  ])
  expect(beforeIntent.managedRun.responsibility.entries).toEqual([])
  expect(beforeIntent.managedRun.pause).toEqual({
    run: { _tag: "RunUnpaused" },
    tasks: { _tag: "NoTaskPauses" }
  })
  expect(beforeIntent.managedRun.workflowHistory.records).toEqual(records(...observedGraph))

  const afterIntent = reduceManagedHistory(runId, records(...observedGraph, claimIntent))
  expect(afterIntent._tag).toBe("ValidManagedHistory")
  if (afterIntent._tag !== "ValidManagedHistory") return

  expect(afterIntent.managedRun.responsibility.entries).toEqual([
    {
      _tag: "TaskClaimResponsibility",
      acquisition: claimA.acquisition,
      beganAt: JournalPosition.make(3)
    }
  ])
  expect(
    afterIntent.managedRun.responsibility.entries.some((entry) =>
      entry._tag === "TaskClaimResponsibility" && entry.acquisition.taskId === taskB
    )
  ).toBe(false)
})

it.effect("reconstructs scenario 1 at P0 and P1 from fresh in-memory state", () =>
  Effect.gen(function*() {
    for (
      const [prefix, expectedResponsibleTaskIds] of [
        [observedGraph, []],
        [[...observedGraph, claimIntent], [taskA]]
      ] as const
    ) {
      yield* Effect.gen(function*() {
        yield* seedScenarioOnePrefix(prefix)
        assertScenarioOnePrefix(yield* readScenarioOnePrefix(), expectedResponsibleTaskIds)
      }).pipe(Effect.provide(memoryJournalStoreLayer))
    }
  }))

it.effect("reconstructs scenario 1 at P0 and P1 after closing and reopening SQLite", () =>
  Effect.gen(function*() {
    const fileSystem = yield* FileSystem.FileSystem
    const directory = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "dalph-reconstructed-managed-run-"
    })
    for (
      const [name, prefix, expectedResponsibleTaskIds] of [
        ["P0", observedGraph, []],
        ["P1", [...observedGraph, claimIntent], [taskA]]
      ] as const
    ) {
      const filename = JournalDatabaseLocator.make(`${directory}/${name}.sqlite`)
      yield* seedScenarioOnePrefix(prefix).pipe(
        Effect.provide(sqliteJournalStoreLayer({ filename }))
      )
      const reopened = yield* readScenarioOnePrefix().pipe(
        Effect.provide(sqliteJournalStoreLayer({ filename }))
      )
      assertScenarioOnePrefix(reopened, expectedResponsibleTaskIds)
    }
  }).pipe(Effect.provide(NodeServices.layer)))

it("retains incomparable target-closure membership as a local conflict", () => {
  const laterObservation = makeTrackerGraphObservationOperation(
    OperationId.make("observe-only-A"),
    target
  )
  const thirdObservation = makeTrackerGraphObservationOperation(
    OperationId.make("observe-only-B"),
    target
  )
  const reduced = reduceManagedHistory(
    runId,
    records(
      ...observedGraph,
      {
        event: trackerGraphObservationIntent(laterObservation),
        key: intentRecordKey(laterObservation.operationId)
      },
      {
        event: trackerGraphOutcomeObserved(laterObservation.operationId, {
          _tag: "TrackerGraphObserved",
          revision: TrackerRevision.make("revision-only-A"),
          taskIds: [taskA]
        }),
        key: outcomeRecordKey(laterObservation.operationId)
      },
      {
        event: trackerGraphObservationIntent(thirdObservation),
        key: intentRecordKey(thirdObservation.operationId)
      },
      {
        event: trackerGraphOutcomeObserved(thirdObservation.operationId, {
          _tag: "TrackerGraphObserved",
          revision: TrackerRevision.make("revision-only-B"),
          taskIds: [taskB]
        }),
        key: outcomeRecordKey(thirdObservation.operationId)
      }
    )
  )
  expect(reduced._tag).toBe("ValidManagedHistory")
  if (reduced._tag !== "ValidManagedHistory") return

  expect(reduced.managedRun.graphKnowledge.targetClosures).toEqual([
    {
      _tag: "TaskTrackerTargetClosureKnowledgeConflict",
      observations: [
        {
          _tag: "TaskTrackerTargetClosureObserved",
          completeness: "Complete",
          consistency: "PotentiallyMixedTime",
          explicitlyCoveredTaskIds: [],
          factFamilies: ["TargetMembership"],
          freshness: "FreshAtReadBoundary",
          observedAt: JournalPosition.make(2),
          operationId: graphObservation.operationId,
          provenAbsentTaskIds: [],
          revision: TrackerRevision.make("revision-A-and-B"),
          target,
          taskIds: [taskA, taskB]
        },
        {
          _tag: "TaskTrackerTargetClosureObserved",
          completeness: "Complete",
          consistency: "PotentiallyMixedTime",
          explicitlyCoveredTaskIds: [],
          factFamilies: ["TargetMembership"],
          freshness: "FreshAtReadBoundary",
          observedAt: JournalPosition.make(4),
          operationId: laterObservation.operationId,
          provenAbsentTaskIds: [],
          revision: TrackerRevision.make("revision-only-A"),
          target,
          taskIds: [taskA]
        },
        {
          _tag: "TaskTrackerTargetClosureObserved",
          completeness: "Complete",
          consistency: "PotentiallyMixedTime",
          explicitlyCoveredTaskIds: [],
          factFamilies: ["TargetMembership"],
          freshness: "FreshAtReadBoundary",
          observedAt: JournalPosition.make(6),
          operationId: thirdObservation.operationId,
          provenAbsentTaskIds: [],
          revision: TrackerRevision.make("revision-only-B"),
          target,
          taskIds: [taskB]
        }
      ],
      target
    }
  ])
})

it("does not infer graph coverage from causal predecessors", () => {
  const claimB = makeTaskClaimAcquisitionOperation({
    acquisition: {
      operationId: OperationId.make("claim-B-without-read-coverage"),
      owner: ClaimOwner.make("owner"),
      taskId: taskB,
      token: ClaimToken.make("claim-B-without-read-coverage-token")
    },
    predecessorOperationIds: [graphObservation.operationId]
  })
  const causalObservation = makeTrackerGraphObservationOperation(
    OperationId.make("observe-after-claim-B"),
    target,
    [claimB.acquisition.operationId]
  )
  const reduced = reduceManagedHistory(
    runId,
    records(
      ...observedGraph,
      {
        event: TaskClaimAcquisitionIntendedEvent.make({
          operation: claimB,
          version: 4
        }),
        key: intentRecordKey(claimB.acquisition.operationId)
      },
      {
        event: TaskClaimAcquiredEvent.make({
          claim: ActiveTaskClaim.make(claimB.acquisition),
          version: 4
        }),
        key: outcomeRecordKey(claimB.acquisition.operationId)
      },
      {
        event: trackerGraphObservationIntent(causalObservation),
        key: intentRecordKey(causalObservation.operationId)
      },
      {
        event: trackerGraphOutcomeObserved(causalObservation.operationId, {
          _tag: "TrackerGraphObserved",
          revision: TrackerRevision.make("revision-B-missing-without-coverage"),
          taskIds: [taskA]
        }),
        key: outcomeRecordKey(causalObservation.operationId)
      }
    )
  )
  expect(reduced._tag).toBe("ValidManagedHistory")
  if (reduced._tag !== "ValidManagedHistory") return
  expect(reduced.managedRun.graphKnowledge.targetClosures[0]).toMatchObject({
    _tag: "TaskTrackerTargetClosureKnowledgeConflict",
    observations: [
      {
        explicitlyCoveredTaskIds: [],
        provenAbsentTaskIds: [],
        taskIds: [taskA, taskB]
      },
      {
        explicitlyCoveredTaskIds: [],
        provenAbsentTaskIds: [],
        taskIds: [taskA]
      }
    ]
  })
})

it("records proven absence only when the named read shape covers the task", () => {
  const claimB = makeTaskClaimAcquisitionOperation({
    acquisition: {
      operationId: OperationId.make("claim-B-for-absence"),
      owner: ClaimOwner.make("owner"),
      taskId: taskB,
      token: ClaimToken.make("claim-B-for-absence-token")
    },
    predecessorOperationIds: [graphObservation.operationId]
  })
  const absenceObservation = makeTrackerGraphObservationOperation(
    OperationId.make("observe-B-absence"),
    target,
    [claimB.acquisition.operationId],
    [taskB]
  )
  const reduced = reduceManagedHistory(
    runId,
    records(
      ...observedGraph,
      {
        event: TaskClaimAcquisitionIntendedEvent.make({
          operation: claimB,
          version: 4
        }),
        key: intentRecordKey(claimB.acquisition.operationId)
      },
      {
        event: TaskClaimAcquiredEvent.make({
          claim: ActiveTaskClaim.make(claimB.acquisition),
          version: 4
        }),
        key: outcomeRecordKey(claimB.acquisition.operationId)
      },
      {
        event: trackerGraphObservationIntent(absenceObservation),
        key: intentRecordKey(absenceObservation.operationId)
      },
      {
        event: trackerGraphOutcomeObserved(absenceObservation.operationId, {
          _tag: "TrackerGraphObserved",
          revision: TrackerRevision.make("revision-B-absent"),
          taskIds: [taskA]
        }),
        key: outcomeRecordKey(absenceObservation.operationId)
      }
    )
  )
  expect(reduced._tag).toBe("ValidManagedHistory")
  if (reduced._tag !== "ValidManagedHistory") return

  expect(reduced.managedRun.graphKnowledge.targetClosures[0]).toMatchObject({
    _tag: "TaskTrackerTargetClosureObserved",
    explicitlyCoveredTaskIds: [taskB],
    operationId: absenceObservation.operationId,
    provenAbsentTaskIds: [taskB],
    taskIds: [taskA]
  })
})

it("normalizes target membership independently of tracker enumeration order", () => {
  const laterObservation = makeTrackerGraphObservationOperation(
    OperationId.make("observe-reordered-membership"),
    target
  )
  const reorderedInitial = {
    event: trackerGraphOutcomeObserved(graphObservation.operationId, {
      _tag: "TrackerGraphObserved" as const,
      revision: TrackerRevision.make("revision-B-then-A"),
      taskIds: [taskB, taskA, taskA]
    }),
    key: outcomeRecordKey(graphObservation.operationId)
  }
  const reduced = reduceManagedHistory(
    runId,
    records(
      observedGraph[0],
      reorderedInitial,
      {
        event: trackerGraphObservationIntent(laterObservation),
        key: intentRecordKey(laterObservation.operationId)
      },
      {
        event: trackerGraphOutcomeObserved(laterObservation.operationId, {
          _tag: "TrackerGraphObserved",
          revision: TrackerRevision.make("revision-A-then-B"),
          taskIds: [taskA, taskB, taskB]
        }),
        key: outcomeRecordKey(laterObservation.operationId)
      }
    )
  )
  expect(reduced._tag).toBe("ValidManagedHistory")
  if (reduced._tag !== "ValidManagedHistory") return
  expect(reduced.managedRun.graphKnowledge.targetClosures).toHaveLength(1)
  expect(reduced.managedRun.graphKnowledge.targetClosures[0]?._tag)
    .toBe("TaskTrackerTargetClosureObserved")
})

it("resolves a local conflict after a focused read covers every disputed task", () => {
  const conflictingObservation = makeTrackerGraphObservationOperation(
    OperationId.make("observe-conflicting-only-A"),
    target
  )
  const claimB = makeTaskClaimAcquisitionOperation({
    acquisition: {
      operationId: OperationId.make("claim-B-for-conflict-resolution"),
      owner: ClaimOwner.make("owner"),
      taskId: taskB,
      token: ClaimToken.make("claim-B-for-conflict-resolution-token")
    },
    predecessorOperationIds: [conflictingObservation.operationId]
  })
  const focusedObservation = makeTrackerGraphObservationOperation(
    OperationId.make("focused-observe-B-absence"),
    target,
    [claimB.acquisition.operationId],
    [taskB]
  )
  const reduced = reduceManagedHistory(
    runId,
    records(
      ...observedGraph,
      {
        event: trackerGraphObservationIntent(conflictingObservation),
        key: intentRecordKey(conflictingObservation.operationId)
      },
      {
        event: trackerGraphOutcomeObserved(conflictingObservation.operationId, {
          _tag: "TrackerGraphObserved",
          revision: TrackerRevision.make("conflicting-revision-only-A"),
          taskIds: [taskA]
        }),
        key: outcomeRecordKey(conflictingObservation.operationId)
      },
      {
        event: TaskClaimAcquisitionIntendedEvent.make({
          operation: claimB,
          version: 4
        }),
        key: intentRecordKey(claimB.acquisition.operationId)
      },
      {
        event: TaskClaimAcquiredEvent.make({
          claim: ActiveTaskClaim.make(claimB.acquisition),
          version: 4
        }),
        key: outcomeRecordKey(claimB.acquisition.operationId)
      },
      {
        event: trackerGraphObservationIntent(focusedObservation),
        key: intentRecordKey(focusedObservation.operationId)
      },
      {
        event: trackerGraphOutcomeObserved(focusedObservation.operationId, {
          _tag: "TrackerGraphObserved",
          revision: TrackerRevision.make("focused-revision-B-absent"),
          taskIds: [taskA]
        }),
        key: outcomeRecordKey(focusedObservation.operationId)
      }
    )
  )
  expect(reduced._tag).toBe("ValidManagedHistory")
  if (reduced._tag !== "ValidManagedHistory") return
  expect(reduced.managedRun.graphKnowledge.targetClosures[0]).toMatchObject({
    _tag: "TaskTrackerTargetClosureObserved",
    explicitlyCoveredTaskIds: [taskB],
    operationId: focusedObservation.operationId,
    provenAbsentTaskIds: [taskB],
    taskIds: [taskA]
  })
})

it.effect("reopens a target-membership conflict from SQLite", () =>
  Effect.gen(function*() {
    const fileSystem = yield* FileSystem.FileSystem
    const directory = yield* fileSystem.makeTempDirectoryScoped({
      prefix: "dalph-target-membership-conflict-"
    })
    const filename = JournalDatabaseLocator.make(`${directory}/conflict.sqlite`)
    const laterObservation = makeTrackerGraphObservationOperation(
      OperationId.make("sqlite-observe-only-A"),
      target
    )
    const prefix = [
      ...observedGraph,
      {
        event: trackerGraphObservationIntent(laterObservation),
        key: intentRecordKey(laterObservation.operationId)
      },
      {
        event: trackerGraphOutcomeObserved(laterObservation.operationId, {
          _tag: "TrackerGraphObserved" as const,
          revision: TrackerRevision.make("sqlite-revision-only-A"),
          taskIds: [taskA]
        }),
        key: outcomeRecordKey(laterObservation.operationId)
      }
    ]
    yield* seedScenarioOnePrefix(prefix).pipe(
      Effect.provide(sqliteJournalStoreLayer({ filename }))
    )
    const reopened = yield* readScenarioOnePrefix().pipe(
      Effect.provide(sqliteJournalStoreLayer({ filename }))
    )
    const reduced = reduceManagedHistory(runId, reopened)
    expect(reduced._tag).toBe("ValidManagedHistory")
    if (reduced._tag !== "ValidManagedHistory") return
    expect(reduced.managedRun.graphKnowledge.targetClosures[0]?._tag)
      .toBe("TaskTrackerTargetClosureKnowledgeConflict")
  }).pipe(Effect.provide(NodeServices.layer)))
