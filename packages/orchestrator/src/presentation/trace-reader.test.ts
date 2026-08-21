import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Context, Effect, FileSystem, Layer, Option, Path, Ref, Schema, SubscriptionRef } from "effect"
import { expect } from "vitest"
import {
  AttemptId,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { acceptedResultFixture } from "../../test/support/evidence.js"
import { GitCommand } from "../authorities/git/command.js"
import { ClaimOwner, ClaimToken } from "../authorities/task-tracker/claim.js"
import { FixtureTarget } from "../authorities/task-tracker/fixture/target.js"
import { TrackerMutation } from "../authorities/task-tracker/claim-mutation.js"
import { TrackerAdapterReadFailureReason } from "../authorities/task-tracker/graph-reader.js"
import { projectTrackerSnapshot } from "../authorities/task-tracker/graph.js"
import { type TrackerTarget } from "../authorities/task-tracker/target.js"
import { TaskWorkCapacity } from "../coordination/admission/capacity.js"
import { InitialControlPolicy } from "../control/policy.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  TaskTrackerFactsReadFailed,
  taskTrackerFactsObservedEvent,
  TaskTrackerFactsObservedEvent
} from "../workflow/task-tracker-facts/observation.js"
import {
  integrationResponsibilityBeganRecordKey,
  integrationStartedRecordKey,
  intentRecordKey,
  outcomeRecordKey
} from "../workflow-journal/record-key.js"
import { memoryJournalStoreLayer } from "../workflow-journal/adapters/memory-store.js"
import { sqliteJournalStoreLayer } from "../workflow-journal/adapters/sqlite-store.js"
import { JournalDatabaseLocator, JournalPosition, JournalRecordKey } from "../workflow-journal/identity.js"
import { JournalReadSource } from "../workflow-journal/read-source.js"
import { InRunJournal, JournalStore, RunLifecycleJournal, type JournalRecord } from "../workflow-journal/store.js"
import { OperationId } from "../workflow/identity.js"
import {
  TaskClaimAcquisitionIntendedEvent,
  WorkflowRunBeganEvent,
  taskTrackerReadIntent
} from "../workflow/registry/event.js"
import {
  IntegrationResponsibilityBeganEvent,
  IntegrationStartedEvent
} from "../workflow/protocols/integration-admission/events.js"
import { workflowJournalEventVersion } from "../workflow/kernel/event.js"
import {
  makeTaskClaimAcquisitionOperation,
  makeTrackerGraphObservationOperation
} from "../workflow/registry/operation.js"
import { makeTaskTrackerFactsObservedFromRead } from "../workflow/protocols/task-tracker-read/protocol.js"
import {
  TraceCausalPredecessorMissing,
  TraceCausalPredecessorContradiction,
  TraceCausalPredecessorNotProjected,
  TraceAtCursor,
  TraceCursor,
  TraceCursorNotCommitted,
  TraceHistory,
  TraceHistoryItem,
  TraceItemIdentity,
  TraceJournalPrefixInvalid,
  TracePositionIdentity,
  TraceReader,
  TraceReaderLayer,
  TraceRunNotFound,
  makeTraceReader,
  makeTracePresentation,
  makeTracePresentationWithStatusSource,
  readTracePresentation,
  readTraceAt
} from "./trace-reader.js"
import {
  attachCurrentSignal,
  currentSignalFromCurrentFirstStream,
  currentSignalOf
} from "../coordination/delivery/relations.js"

type IsExactly<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type Assert<T extends true> = T

const runId = RunId.make("trace-reader-test-run")
const target = FixtureTarget.make("trace-reader-target")
const initialPolicy = InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
const integrationTarget = IntegrationTarget.make({
  ref: IntegrationTargetRef.make("refs/heads/main"),
  repository: GitRepositoryLocator.make("/repo/.git")
})
const integrationPlannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("trace-reader-integration-attempt"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/trace-reader-integration"),
  executor: TaskExecutorLocator.make("executor:trace-reader-test"),
  runId,
  taskId: TaskId.make("trace-reader-integration-task"),
  taskRevision: TaskRevision.make("trace-reader-integration-revision"),
  worktree: WorktreeLocator.make("/worktrees/trace-reader-integration")
})
const integrationAcceptedResult = acceptedResultFixture(GitCommitSha.make("a".repeat(40)))

const graphSnapshot = projectTrackerSnapshot({
  revision: "trace-reader-revision",
  tasks: [
    { id: TaskId.make("A"), lifecycle: { _tag: "Open" as const }, parentTaskId: null, prerequisiteIds: [] },
    {
      id: TaskId.make("B"),
      lifecycle: { _tag: "Open" as const },
      parentTaskId: null,
      prerequisiteIds: [TaskId.make("A")]
    }
  ]
})

const snapshot = Option.getOrThrow(graphSnapshot._tag === "Valid" ? Option.some(graphSnapshot.snapshot) : Option.none())

const appendGraphObservation = Effect.fn("TraceReaderTest.appendGraphObservation")(function* (
  journal: JournalStore["Service"],
  operationId: OperationId,
  predecessorOperationIds: ReadonlyArray<OperationId> = [],
  observationTarget: TrackerTarget = target
) {
  const operation = makeTrackerGraphObservationOperation(operationId, observationTarget, predecessorOperationIds)
  yield* journal.append(runId, intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
  yield* journal.append(
    runId,
    outcomeRecordKey(operation.operationId),
    taskTrackerFactsObservedEvent(operation.operationId, makeCompleteTaskTrackerFactsObserved(operation, snapshot))
  )
})

const appendIncompleteGraphObservation = Effect.fn("TraceReaderTest.appendIncompleteGraphObservation")(function* (
  journal: JournalStore["Service"],
  operationId: OperationId
) {
  const operation = makeTrackerGraphObservationOperation(operationId, target)
  const observation = TaskTrackerFactsReadFailed.make({
    completeness: "Unreadable",
    failure: {
      _tag: "TrackerAdapterReadError",
      detail: "tracker pages did not establish a complete target closure",
      reason: TrackerAdapterReadFailureReason.cases.IncompleteSnapshot.make({})
    },
    operationId: operation.operationId,
    target
  })
  yield* journal.append(runId, intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
  yield* journal.append(
    runId,
    outcomeRecordKey(operation.operationId),
    taskTrackerFactsObservedEvent(operation.operationId, observation)
  )
})

const appendIntegrationStart = Effect.fn("TraceReaderTest.appendIntegrationStart")(function* (
  journal: JournalStore["Service"]
) {
  yield* journal.append(
    runId,
    integrationResponsibilityBeganRecordKey(integrationPlannedAttempt.attemptId),
    IntegrationResponsibilityBeganEvent.make({
      acceptedResult: integrationAcceptedResult,
      integrationTarget,
      plannedAttempt: integrationPlannedAttempt,
      version: workflowJournalEventVersion
    })
  )
  yield* journal.append(
    runId,
    integrationStartedRecordKey(integrationPlannedAttempt.attemptId),
    IntegrationStartedEvent.make({
      acceptedResult: integrationAcceptedResult,
      integrationTarget,
      plannedAttempt: integrationPlannedAttempt,
      responsibilityBeganAt: JournalPosition.make(2),
      version: workflowJournalEventVersion
    })
  )
})

const readerOnlyLayer = TraceReaderLayer.pipe(Layer.provide(memoryJournalStoreLayer))
type ReaderOnlyLayerOutput = Assert<IsExactly<Layer.Success<typeof readerOnlyLayer>, TraceReader>>
const readerOnlyLayerOutput: ReaderOnlyLayerOutput = true
const readerLayer = Layer.merge(readerOnlyLayer, memoryJournalStoreLayer)
const sqliteReaderLayer = (filename: JournalDatabaseLocator) => {
  const storeLayer = sqliteJournalStoreLayer({ filename })
  return Layer.merge(TraceReaderLayer.pipe(Layer.provide(storeLayer)), storeLayer)
}

const readerFromRecords = (records: ReadonlyArray<JournalRecord>) =>
  makeTraceReader({ read: () => Effect.succeed(records) })

it.effect("maps projection failures consistently through complete and cursor trace reads", () =>
  Effect.gen(function* () {
    const records: ReadonlyArray<JournalRecord> = [
      {
        event: WorkflowRunBeganEvent.make({
          initialControlPolicy: initialPolicy,
          initiatedBy: { _tag: "DalphCoordinator" },
          occurrenceClassification: "InitiatedAction",
          target,
          version: workflowJournalEventVersion
        }),
        key: JournalRecordKey.make("trace-projection-invalid-begin"),
        position: JournalPosition.make(1),
        runId
      },
      {
        event: IntegrationStartedEvent.make({
          acceptedResult: integrationAcceptedResult,
          integrationTarget,
          plannedAttempt: integrationPlannedAttempt,
          responsibilityBeganAt: JournalPosition.make(1),
          version: workflowJournalEventVersion
        }),
        key: JournalRecordKey.make("trace-projection-invalid-start"),
        position: JournalPosition.make(2),
        runId
      }
    ]
    const reader = readerFromRecords(records)

    const historyFailure = yield* Effect.flip(reader.read(runId))
    expect(historyFailure).toMatchObject({ _tag: "TraceProjectionInvalid", runId })

    const cursorFailure = yield* Effect.flip(
      reader.readAt(TraceCursor.make({ position: JournalPosition.make(2), runId }))
    )
    expect(cursorFailure).toMatchObject({ _tag: "TraceProjectionInvalid", runId })
  })
)

it.effect("keeps the composed trace reader context read-only", () =>
  Effect.gen(function* () {
    const context = yield* Layer.build(readerOnlyLayer)
    expect(readerOnlyLayerOutput).toBe(true)
    expect(Context.getOption(context, TraceReader)).toSatisfy(Option.isSome)
    expect(Context.getOption(context, JournalStore)).toSatisfy(Option.isNone)
    expect(Context.getOption(context, JournalReadSource)).toSatisfy(Option.isNone)
    expect(Context.getOption(context, InRunJournal)).toSatisfy(Option.isNone)
    expect(Context.getOption(context, RunLifecycleJournal)).toSatisfy(Option.isNone)
    expect(Context.getOption(context, TrackerMutation)).toSatisfy(Option.isNone)
    expect(Context.getOption(context, GitCommand)).toSatisfy(Option.isNone)
  })
)

it.effect(
  "moves Alice through journal positions without reordering history and follows exact causal predecessors",
  () =>
    Effect.gen(function* () {
      const journal = yield* JournalStore
      yield* journal.beginRun(runId, target, initialPolicy)
      const firstOperationId = OperationId.make("first-graph-read")
      yield* appendGraphObservation(journal, firstOperationId)
      const unrelatedOperationId = OperationId.make("unrelated-graph-read")
      yield* appendGraphObservation(journal, unrelatedOperationId)
      const laterOperationId = OperationId.make("later-graph-read")
      yield* appendGraphObservation(journal, laterOperationId, [firstOperationId])
      yield* appendIncompleteGraphObservation(journal, OperationId.make("incomplete-graph-read"))

      const unprojectedOperation = makeTaskClaimAcquisitionOperation({
        acquisition: {
          operationId: OperationId.make("unprojected-predecessor"),
          owner: ClaimOwner.make("dalph"),
          taskId: TaskId.make("unprojected-predecessor-task"),
          token: ClaimToken.make("unprojected-predecessor-token")
        },
        predecessorOperationIds: []
      })
      yield* journal.append(
        runId,
        intentRecordKey(unprojectedOperation.acquisition.operationId),
        TaskClaimAcquisitionIntendedEvent.make({
          operation: unprojectedOperation,
          version: workflowJournalEventVersion
        })
      )
      const successorOfUnprojected = OperationId.make("successor-of-unprojected")
      yield* appendGraphObservation(journal, successorOfUnprojected, [unprojectedOperation.acquisition.operationId])

      const reader = yield* TraceReader
      const atFirst = yield* readTraceAt(reader, TraceCursor.make({ position: JournalPosition.make(3), runId }))
      const atEnd = yield* readTraceAt(reader, TraceCursor.make({ position: JournalPosition.make(7), runId }))
      const afterIncomplete = yield* readTraceAt(reader, TraceCursor.make({ position: JournalPosition.make(9), runId }))

      expect(atFirst.items.map(({ identity }) => Number(identity.position))).toEqual([2, 3])
      expect(atEnd.items.map(({ identity }) => Number(identity.position))).toEqual([2, 3, 4, 5, 6, 7])
      expect(atFirst.graph?.snapshot.tasks.map(({ id }) => id)).toEqual(["A", "B"])
      expect(atFirst.graph?.edges).toEqual([{ _tag: "Prerequisite", dependantTaskId: "B", prerequisiteTaskId: "A" }])
      expect(atEnd.derivedTaskOrder._tag).toBe("DerivedTaskOrder")
      expect(atEnd.items.map(({ identity }) => Number(identity.position))).toEqual([2, 3, 4, 5, 6, 7])
      expect(afterIncomplete.graph?.observation.recordedAt).toEqual(JournalPosition.make(7))
      expect(afterIncomplete.items.map(({ identity }) => Number(identity.position))).toEqual([2, 3, 4, 5, 6, 7, 8, 9])

      const notProjected = yield* Effect.flip(
        reader.causalPredecessor(
          TraceCursor.make({ position: JournalPosition.make(12), runId }),
          successorOfUnprojected,
          unprojectedOperation.acquisition.operationId
        )
      )
      expect(notProjected).toBeInstanceOf(TraceCausalPredecessorNotProjected)
      expect(notProjected).toMatchObject({
        predecessorOperationId: unprojectedOperation.acquisition.operationId,
        successorOperationId: successorOfUnprojected,
        runId
      })

      const predecessor = yield* reader.causalPredecessor(
        TraceCursor.make({ position: JournalPosition.make(7), runId }),
        laterOperationId,
        firstOperationId
      )
      expect(predecessor.identity).toEqual({ position: JournalPosition.make(2), runId })
      expect(predecessor.operationIds).toContain(firstOperationId)

      const missingEdge = yield* Effect.flip(
        reader.causalPredecessor(
          TraceCursor.make({ position: JournalPosition.make(7), runId }),
          laterOperationId,
          unrelatedOperationId
        )
      )
      expect(missingEdge).toBeInstanceOf(TraceCausalPredecessorMissing)
      expect(missingEdge).toMatchObject({
        predecessorOperationId: unrelatedOperationId,
        successorOperationId: laterOperationId,
        runId
      })
    }).pipe(Effect.provide(readerLayer))
)

it.effect(
  "rejects a causal predecessor absent from the validated Run prefix instead of using the previous record",
  () =>
    Effect.gen(function* () {
      const journal = yield* JournalStore
      yield* journal.beginRun(runId, target, initialPolicy)
      const missingOperationId = OperationId.make("missing-predecessor")
      yield* appendGraphObservation(journal, OperationId.make("operation-with-missing-predecessor"), [
        missingOperationId
      ])

      const reader = yield* TraceReader
      const failure = yield* Effect.flip(reader.read(runId))
      expect(failure).toBeInstanceOf(TraceCausalPredecessorMissing)
      expect(failure).toMatchObject({ predecessorOperationId: missingOperationId, runId })
    }).pipe(Effect.provide(readerLayer))
)

it.effect("reuses the immutable complete-prefix trace result for repeated reads", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(runId, target, initialPolicy)
    yield* appendGraphObservation(journal, OperationId.make("repeatable-prefix"))

    const records = yield* journal.read(runId)
    let reads = 0
    const reader = makeTraceReader({
      read: () =>
        Effect.sync(() => {
          reads += 1
          return records
        })
    })
    const cursor = TraceCursor.make({ position: JournalPosition.make(3), runId })
    const firstView = yield* reader.readAt(cursor)
    const repeatedView = yield* reader.readAt(cursor)
    const firstHistory = yield* reader.read(runId)
    const repeatedHistory = yield* reader.read(runId)

    expect(reads).toBe(4)
    expect(repeatedView).toBe(firstView)
    expect(repeatedHistory).toBe(firstHistory)
  }).pipe(Effect.provide(readerLayer))
)

it.effect("matches the prefix projection at every early cursor when a later immutable suffix is malformed", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(runId, target, initialPolicy)
    yield* appendGraphObservation(journal, OperationId.make("malformed-suffix-prefix"))
    const records = yield* journal.read(runId)
    const duplicated = records[1]
    if (duplicated === undefined) {
      return yield* Effect.die("malformed suffix fixture did not produce an operation intent")
    }
    const malformedRecords: ReadonlyArray<JournalRecord> = [
      ...records,
      {
        ...duplicated,
        key: JournalRecordKey.make("malformed-suffix-duplicate"),
        position: JournalPosition.make(records.length + 1)
      }
    ]
    const indexedReader = readerFromRecords(records)
    const fallbackReader = readerFromRecords(malformedRecords)

    for (const position of [1, 2, 3]) {
      const cursor = TraceCursor.make({ position: JournalPosition.make(position), runId })
      const indexedView = yield* indexedReader.readAt(cursor)
      const fallbackView = yield* fallbackReader.readAt(cursor)
      expect(fallbackView).toEqual(indexedView)
    }

    const repeatedCursor = TraceCursor.make({ position: JournalPosition.make(1), runId })
    const firstFallbackView = yield* fallbackReader.readAt(repeatedCursor)
    expect(yield* fallbackReader.readAt(repeatedCursor)).toBe(firstFallbackView)

    const malformedCursorFailure = yield* Effect.flip(
      fallbackReader.readAt(TraceCursor.make({ position: JournalPosition.make(4), runId }))
    )
    expect(malformedCursorFailure).toBeInstanceOf(TraceCausalPredecessorContradiction)
  }).pipe(Effect.provide(readerLayer))
)

it.effect("keeps process-local integration serialization separate from other trace relationships", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(runId, target, initialPolicy)
    yield* appendIntegrationStart(journal)

    const reader = yield* TraceReader
    const view = yield* readTraceAt(reader, TraceCursor.make({ position: JournalPosition.make(3), runId }))

    expect(view.relationships.processLocalResourceSerializations).toEqual([
      {
        earlier: { position: JournalPosition.make(2), runId },
        later: { position: JournalPosition.make(3), runId },
        target: integrationTarget
      }
    ])
    expect(view.relationships.taskGraphEdges).toEqual([])
    expect(view.relationships.workflowCausalEdges).toEqual([])
    expect(view.relationships.outsideAuthorityAcknowledgements).toEqual([])
  }).pipe(Effect.provide(readerLayer))
)

it.effect("rejects duplicate OperationIds as visible causal contradictions", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(runId, target, initialPolicy)
    const duplicateOperationId = OperationId.make("duplicate-operation")
    const operation = makeTrackerGraphObservationOperation(duplicateOperationId, target)
    yield* journal.append(runId, JournalRecordKey.make("duplicate-operation-first"), taskTrackerReadIntent(operation))
    yield* journal.append(runId, JournalRecordKey.make("duplicate-operation-second"), taskTrackerReadIntent(operation))

    const failure = yield* Effect.flip((yield* TraceReader).read(runId))
    expect(failure).toBeInstanceOf(TraceCausalPredecessorContradiction)
    expect(failure).toMatchObject({
      predecessorOperationId: duplicateOperationId,
      reason: "DuplicateOperation",
      runId,
      successorOperationId: duplicateOperationId
    })
  }).pipe(Effect.provide(readerLayer))
)

it.effect("rejects a predecessor recorded after its successor as a visible causal contradiction", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(runId, target, initialPolicy)
    const predecessorOperationId = OperationId.make("recorded-later")
    const successorOperationId = OperationId.make("recorded-first")
    const successor = makeTrackerGraphObservationOperation(successorOperationId, target, [predecessorOperationId])
    const predecessor = makeTrackerGraphObservationOperation(predecessorOperationId, target)
    yield* journal.append(runId, JournalRecordKey.make("non-earlier-successor"), taskTrackerReadIntent(successor))
    yield* journal.append(runId, JournalRecordKey.make("non-earlier-predecessor"), taskTrackerReadIntent(predecessor))

    const failure = yield* Effect.flip((yield* TraceReader).read(runId))
    expect(failure).toBeInstanceOf(TraceCausalPredecessorContradiction)
    expect(failure).toMatchObject({ predecessorOperationId, reason: "NotEarlier", runId, successorOperationId })
  }).pipe(Effect.provide(readerLayer))
)

it.effect("rejects trace identities and observations outside their committed prefix", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(runId, target, initialPolicy)
    yield* appendGraphObservation(journal, OperationId.make("schema-invariants"))

    const reader = yield* TraceReader
    const history = yield* reader.read(runId)
    const cursor = TraceCursor.make({ position: JournalPosition.make(3), runId })
    const view = yield* readTraceAt(reader, cursor)
    const firstItem = view.items[0]
    const secondItem = view.items[1]
    const graph = view.graph
    const acknowledgement = view.relationships.outsideAuthorityAcknowledgements[0]
    if (firstItem === undefined || secondItem === undefined || graph === null || acknowledgement === undefined) {
      return yield* Effect.die("trace-reader schema fixture did not produce the expected projected values")
    }

    expect(TracePositionIdentity).toBe(TraceCursor)
    expect(TracePositionIdentity).toBe(TraceItemIdentity)
    expect(() =>
      Schema.decodeUnknownSync(TraceHistoryItem)({
        ...firstItem,
        identity: { ...firstItem.identity, position: JournalPosition.make(1) }
      })
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(TraceHistory)({
        ...history,
        items: [{ ...firstItem, identity: { ...firstItem.identity, runId: RunId.make("other-run") } }]
      })
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(TraceHistory)({
        ...history,
        items: [{ ...firstItem, identity: { ...firstItem.identity, position: JournalPosition.make(4) } }]
      })
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(TraceHistory)({ ...history, runId: RunId.make("foreign-history-run") })
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(TraceHistory)({ ...history, committedThrough: JournalPosition.make(1) })
    ).toThrow()
    expect(() => Schema.decodeUnknownSync(TraceHistory)({ ...history, items: [firstItem, firstItem] })).toThrow()
    expect(() => Schema.decodeUnknownSync(TraceHistory)({ ...history, items: [secondItem, firstItem] })).toThrow()
    expect(() => Schema.decodeUnknownSync(TraceAtCursor)({ ...view, items: [firstItem, firstItem] })).toThrow()
    expect(() => Schema.decodeUnknownSync(TraceAtCursor)({ ...view, items: [secondItem, firstItem] })).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(TraceAtCursor)({
        ...view,
        derivedTaskOrder: {
          ...view.derivedTaskOrder,
          taskIds: [...view.derivedTaskOrder.taskIds, TaskId.make("ghost-derived-task")]
        }
      })
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(TraceAtCursor)({
        ...view,
        graph: null,
        derivedTaskOrder: { ...view.derivedTaskOrder, taskIds: [TaskId.make("ghost-without-graph")] }
      })
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(TraceAtCursor)({
        ...view,
        graph: { ...graph, observation: { ...graph.observation, recordedAt: JournalPosition.make(4) } }
      })
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(TraceAtCursor)({
        ...view,
        graph: { ...graph, observation: { ...graph.observation, recordedAt: JournalPosition.make(1) } }
      })
    ).toThrow()
    expect(() => Schema.decodeUnknownSync(TraceAtCursor)({ ...view, graph: { ...graph, edges: [] } })).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(TraceAtCursor)({
        ...view,
        graph: {
          ...graph,
          edges: [{ _tag: "Grouping", childTaskId: TaskId.make("B"), parentTaskId: TaskId.make("A") }]
        }
      })
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(TraceAtCursor)({ ...view, relationships: { ...view.relationships, taskGraphEdges: [] } })
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(TraceAtCursor)({
        ...view,
        graph: null,
        derivedTaskOrder: { ...view.derivedTaskOrder, taskIds: [] },
        relationships: { ...view.relationships, taskGraphEdges: graph.edges }
      })
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(TraceAtCursor)({
        ...view,
        graph: { ...graph, observation: { ...graph.observation, operationId: OperationId.make("foreign-graph") } }
      })
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(TraceAtCursor)({
        ...view,
        relationships: {
          ...view.relationships,
          outsideAuthorityAcknowledgements: [
            { ...acknowledgement, actionOperationId: OperationId.make("foreign-action") }
          ]
        }
      })
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(TraceAtCursor)({
        ...view,
        relationships: {
          ...view.relationships,
          outsideAuthorityAcknowledgements: [
            { ...acknowledgement, action: { ...acknowledgement.action, position: JournalPosition.make(1) } }
          ]
        }
      })
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(TraceAtCursor)({
        ...view,
        relationships: {
          ...view.relationships,
          outsideAuthorityAcknowledgements: [
            { ...acknowledgement, observation: { ...acknowledgement.observation, position: JournalPosition.make(4) } }
          ]
        }
      })
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(TraceAtCursor)({
        ...view,
        relationships: {
          ...view.relationships,
          processLocalResourceSerializations: [
            { earlier: secondItem.identity, later: firstItem.identity, target: integrationTarget }
          ]
        }
      })
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(TraceAtCursor)({
        ...view,
        relationships: {
          ...view.relationships,
          processLocalResourceSerializations: [
            {
              earlier: { ...firstItem.identity, runId: RunId.make("foreign-run") },
              later: secondItem.identity,
              target: integrationTarget
            }
          ]
        }
      })
    ).toThrow()
    expect(() =>
      Schema.decodeUnknownSync(TraceAtCursor)({
        ...view,
        relationships: {
          ...view.relationships,
          processLocalResourceSerializations: [
            {
              earlier: { runId, position: JournalPosition.make(1) },
              later: secondItem.identity,
              target: integrationTarget
            }
          ]
        }
      })
    ).toThrow()
  }).pipe(Effect.provide(readerLayer))
)

it.effect("reports empty, mismatched, gapped, and non-beginning committed prefixes", () =>
  Effect.gen(function* () {
    const emptyFailure = yield* Effect.flip(readerFromRecords([]).read(runId))
    expect(emptyFailure).toBeInstanceOf(TraceRunNotFound)

    const journal = yield* JournalStore
    yield* journal.beginRun(runId, target, initialPolicy)
    yield* appendGraphObservation(journal, OperationId.make("prefix-validation"))
    const records = yield* journal.read(runId)
    const first = records[0]
    const second = records[1]
    if (first === undefined || second === undefined) {
      return yield* Effect.die("prefix fixture did not produce two committed records")
    }

    const runMismatch = yield* Effect.flip(
      readerFromRecords(
        records.map((record) =>
          record.position === first.position ? { ...record, runId: RunId.make("foreign-prefix-run") } : record
        )
      ).read(runId)
    )
    expect(runMismatch).toBeInstanceOf(TraceJournalPrefixInvalid)

    const positionGap = yield* Effect.flip(
      readerFromRecords(
        records.map((record) =>
          record.position === second.position ? { ...record, position: JournalPosition.make(4) } : record
        )
      ).read(runId)
    )
    expect(positionGap).toBeInstanceOf(TraceJournalPrefixInvalid)

    const wrongBeginning = yield* Effect.flip(readerFromRecords([{ ...first, event: second.event }]).read(runId))
    expect(wrongBeginning).toBeInstanceOf(TraceJournalPrefixInvalid)

    const absentCursor = yield* Effect.flip(
      readerFromRecords(records).readAt(TraceCursor.make({ position: JournalPosition.make(99), runId }))
    )
    expect(absentCursor).toBeInstanceOf(TraceCursorNotCommitted)
  }).pipe(Effect.provide(readerLayer))
)

it.effect("fails closed when a complete tracker observation addresses another target", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(runId, target, initialPolicy)
    const otherTarget = FixtureTarget.make("trace-reader-other-target")
    yield* appendGraphObservation(journal, OperationId.make("irrelevant-target-graph"), [], otherTarget)

    const view = yield* readTraceAt(yield* TraceReader, TraceCursor.make({ position: JournalPosition.make(3), runId }))
    expect(view.graph).toBeNull()
    expect(view.relationships.taskGraphEdges).toEqual([])
  }).pipe(Effect.provide(readerLayer))
)

it.effect("does not reconstruct a graph from a reconfirmation with no earlier full observation", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(runId, target, initialPolicy)
    const firstOperation = makeTrackerGraphObservationOperation(OperationId.make("reconfirmation-first"), target)
    yield* journal.append(runId, intentRecordKey(firstOperation.operationId), taskTrackerReadIntent(firstOperation))
    yield* journal.append(
      runId,
      outcomeRecordKey(firstOperation.operationId),
      taskTrackerFactsObservedEvent(
        firstOperation.operationId,
        makeCompleteTaskTrackerFactsObserved(firstOperation, snapshot)
      )
    )
    const laterOperation = makeTrackerGraphObservationOperation(OperationId.make("reconfirmation-later"), target, [
      firstOperation.operationId
    ])
    const reconfirmed = makeTaskTrackerFactsObservedFromRead(yield* journal.read(runId), laterOperation, snapshot)
    if (reconfirmed.observation._tag !== "UnchangedTaskTrackerFactsReconfirmed") {
      return yield* Effect.die("reconfirmation fixture did not produce compact unchanged facts")
    }
    const missingPrior = Schema.decodeUnknownSync(TaskTrackerFactsObservedEvent)({
      ...reconfirmed,
      observation: {
        ...reconfirmed.observation,
        priorFullObservationOperationId: OperationId.make("missing-full-observation")
      }
    })
    yield* journal.append(runId, intentRecordKey(laterOperation.operationId), taskTrackerReadIntent(laterOperation))
    yield* journal.append(runId, outcomeRecordKey(laterOperation.operationId), missingPrior)

    const view = yield* readTraceAt(yield* TraceReader, TraceCursor.make({ position: JournalPosition.make(5), runId }))
    expect(view.graph).toBeNull()
    expect(view.relationships.taskGraphEdges).toEqual([])
  }).pipe(Effect.provide(readerLayer))
)

it.effect("combines a fixed historical trace with a newer passive current status without rewriting either", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(runId, target, initialPolicy)
    yield* appendGraphObservation(journal, OperationId.make("fixed-history"))

    const reader = yield* TraceReader
    const history = yield* readTraceAt(reader, TraceCursor.make({ position: JournalPosition.make(3), runId }))
    const presentation = makeTracePresentation(history, { _tag: "Waiting", reason: "live owner" })

    expect(presentation.history.cursor).toEqual({ position: 3, runId })
    expect(presentation.currentStatus).toEqual({ _tag: "Waiting", reason: "live owner" })
    expect(presentation.history.items).toHaveLength(2)
  }).pipe(Effect.provide(readerLayer))
)

it.effect("keeps the fixed cursor when the passive current status is explicitly unavailable", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(runId, target, initialPolicy)
    yield* appendGraphObservation(journal, OperationId.make("unavailable-status"))
    const reader = yield* TraceReader
    const cursor = TraceCursor.make({ position: JournalPosition.make(3), runId })
    type UnavailableStatus = { readonly _tag: "Unavailable"; readonly reason: string }
    const unavailableStatus = currentSignalOf<UnavailableStatus>({
      _tag: "Unavailable",
      reason: "passive status source disconnected"
    })

    const presentation = yield* readTracePresentation({ currentStatus: unavailableStatus, traceReader: reader }, cursor)
    expect((yield* attachCurrentSignal(presentation.currentStatus)).current).toEqual({
      _tag: "Unavailable",
      reason: "passive status source disconnected"
    })
    expect(presentation.history.cursor).toEqual(cursor)
    expect(presentation.history.items.map(({ identity }) => identity.position)).toEqual([
      JournalPosition.make(2),
      JournalPosition.make(3)
    ])
  }).pipe(Effect.provide(readerLayer))
)

const nodeFileSystemAndPath = Layer.merge(NodeFileSystem.layer, NodePath.layer)

it.effect("replays a committed occurrence at its original Run and JournalPosition after output is lost", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-trace-reader-" })
      const filename = JournalDatabaseLocator.make(path.join(directory, "journal.sqlite"))
      const inMemoryReplay = yield* Effect.scoped(
        Effect.gen(function* () {
          const journal = yield* JournalStore
          yield* journal.beginRun(runId, target, initialPolicy)
          yield* appendGraphObservation(journal, OperationId.make("memory-replay"))
          const reader = yield* TraceReader
          const first = yield* reader.read(runId)
          const replayed = yield* reader.read(runId)
          return { first, replayed }
        }).pipe(Effect.provide(readerLayer))
      )
      expect(inMemoryReplay.replayed).toEqual(inMemoryReplay.first)
      expect(inMemoryReplay.replayed.items.map(({ identity }) => identity)).toEqual(
        inMemoryReplay.first.items.map(({ identity }) => identity)
      )

      const firstRead = yield* Effect.scoped(
        Effect.gen(function* () {
          const journal = yield* JournalStore
          yield* journal.beginRun(runId, target, initialPolicy)
          yield* appendGraphObservation(journal, OperationId.make("sqlite-replay"))
          const history = yield* (yield* TraceReader).read(runId)
          const records = yield* journal.read(runId)
          return { history, records }
        }).pipe(Effect.provide(sqliteReaderLayer(filename)))
      )
      const sink = yield* Ref.make(new Map<string, (typeof firstRead.history.items)[number]>())
      const applyToSink = (item: (typeof firstRead.history.items)[number]) =>
        Ref.update(sink, (items) => new Map(items).set(`${item.identity.runId}:${item.identity.position}`, item))
      const firstItem = firstRead.history.items[0]
      if (firstItem === undefined) return yield* Effect.die("SQLite replay fixture did not produce an occurrence")
      const lostAcknowledgement = yield* Effect.exit(
        Effect.gen(function* () {
          yield* applyToSink(firstItem)
          return yield* Effect.fail({ _tag: "SinkAcknowledgementLost" as const })
        })
      )
      expect(lostAcknowledgement._tag).toBe("Failure")
      expect((yield* Ref.get(sink)).size).toBe(1)

      const restartedRead = yield* Effect.scoped(
        Effect.gen(function* () {
          const journal = yield* JournalStore
          const history = yield* (yield* TraceReader).read(runId)
          const records = yield* journal.read(runId)
          return { history, records }
        }).pipe(Effect.provide(sqliteReaderLayer(filename)))
      )

      expect(restartedRead.history).toEqual(firstRead.history)
      const redelivered = restartedRead.history.items.find(
        ({ identity }) =>
          identity.runId === firstItem.identity.runId && identity.position === firstItem.identity.position
      )
      if (redelivered === undefined) return yield* Effect.die("SQLite restart lost the original occurrence identity")
      expect(redelivered).toEqual(firstItem)
      yield* applyToSink(redelivered)
      expect((yield* Ref.get(sink)).size).toBe(1)
      expect((yield* Ref.get(sink)).get(`${firstItem.identity.runId}:${firstItem.identity.position}`)).toEqual(
        firstItem
      )
      expect(restartedRead.records).toEqual(firstRead.records)
      expect(restartedRead.records.map(({ position }) => position)).toEqual(
        firstRead.records.map(({ position }) => position)
      )
    }).pipe(Effect.provide(nodeFileSystemAndPath))
  )
)

it.effect("reconnects current status while retaining the same historical cursor", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const journal = yield* JournalStore
      yield* journal.beginRun(runId, target, initialPolicy)
      yield* appendGraphObservation(journal, OperationId.make("status-reconnect"))
      const reader = yield* TraceReader
      const history = yield* readTraceAt(reader, TraceCursor.make({ position: JournalPosition.make(3), runId }))
      type CurrentStatus = { readonly _tag: "Waiting" | "Running"; readonly reason: string }
      const statusState = yield* SubscriptionRef.make<CurrentStatus>({ _tag: "Waiting", reason: "live owner" })
      const status = currentSignalFromCurrentFirstStream(SubscriptionRef.changes(statusState))
      const presentation = makeTracePresentationWithStatusSource(history, status)

      yield* SubscriptionRef.set<CurrentStatus>(statusState, { _tag: "Running", reason: "owner settled" })
      expect(presentation.history.cursor).toEqual({ position: 3, runId })
      expect((yield* attachCurrentSignal(presentation.currentStatus)).current).toEqual({
        _tag: "Running",
        reason: "owner settled"
      })
      const reconnected = yield* attachCurrentSignal(presentation.currentStatus)
      expect(reconnected.current).toEqual({ _tag: "Running", reason: "owner settled" })
      expect(presentation.history.items.map(({ identity }) => Number(identity.position))).toEqual([2, 3])
    }).pipe(Effect.provide(readerLayer))
  )
)
