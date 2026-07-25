import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect, FileSystem } from "effect"
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
        }
      ],
      target
    }
  ])
})

it("records proven absence when a claim predecessor names the covered task", () => {
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
    [claimB.acquisition.operationId]
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
