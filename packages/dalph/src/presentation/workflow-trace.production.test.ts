/* eslint-disable import/no-nodejs-modules -- Source assertion guards the public console presentation seam. */
import { it } from "@effect/vitest"
import {
  AttemptId,
  GitCommitSha,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import {
  FixtureTarget,
  InitialControlPolicy,
  JournalPosition,
  JournalStore,
  OperationId,
  TaskWorkCapacity,
  TaskTrackerReadInitiated,
  TraceAtCursor,
  TraceCursor,
  TraceDerivedTaskOrder,
  TraceHistoryItem,
  TraceHistoricalFacets,
  TraceOutput,
  TracePositionIdentity,
  TraceReaderLayer,
  TraceRelationships,
  WorkflowActor,
  PlannedAttemptExecutorWorkResponsibilityBegan,
  intentRecordKey,
  makeTrackerGraphObservationOperation,
  memoryJournalStoreLayer,
  taskTrackerReadIntent,
  traceControlDispositionFacetVersion,
  traceReaderSchemaVersion
} from "@dalph/orchestrator"
import { Effect, Layer, Ref } from "effect"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { expect } from "vitest"
import {
  type encodeTraceAtCursor,
  encodeTraceControlDispositionFacet,
  type encodeTraceHistoryItem,
  HistoricalTraceConsole,
  historicalTraceConsoleLayer,
  renderTraceAtCursor,
  semanticTraceAtCursor,
  traceCursorAt,
  writeTraceAtCursor
} from "./workflow-trace.js"

type IsExactly<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
type Assert<T extends true> = T
type ConsoleViewUsesProductionView = Assert<IsExactly<Parameters<typeof encodeTraceAtCursor>[0], TraceAtCursor>>
type ConsoleItemUsesProductionUnion = Assert<IsExactly<Parameters<typeof encodeTraceHistoryItem>[0], TraceHistoryItem>>
type ConsoleCursorUsesProductionIdentity = Assert<IsExactly<ReturnType<typeof traceCursorAt>, TraceCursor>>
type HistoricalConsoleUsesProductionCursor = Assert<
  IsExactly<Parameters<HistoricalTraceConsole["Service"]["presentAt"]>[0], TraceCursor>
>

const consoleViewUsesProductionView: ConsoleViewUsesProductionView = true
const consoleItemUsesProductionUnion: ConsoleItemUsesProductionUnion = true
const consoleCursorUsesProductionIdentity: ConsoleCursorUsesProductionIdentity = true
const historicalConsoleUsesProductionCursor: HistoricalConsoleUsesProductionCursor = true

const runId = RunId.make("console-production-trace-run")
const target = FixtureTarget.make("console-production-trace-target")
const operation = makeTrackerGraphObservationOperation(OperationId.make("console-production-trace-operation"), target)
const occurrence = TaskTrackerReadInitiated.make({
  initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
  occurrenceClassification: "InitiatedAction",
  operation,
  recordedAt: JournalPosition.make(2),
  runId
})
const historyItem = TraceHistoryItem.make({
  identity: TracePositionIdentity.make({ position: JournalPosition.make(2), runId }),
  occurrence,
  operationIds: [operation.operationId],
  taskIds: []
})
const laterOperation = makeTrackerGraphObservationOperation(OperationId.make("console-production-trace-later"), target)
const laterHistoryItem = TraceHistoryItem.make({
  identity: TracePositionIdentity.make({ position: JournalPosition.make(3), runId }),
  occurrence: TaskTrackerReadInitiated.make({
    initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
    occurrenceClassification: "InitiatedAction",
    operation: laterOperation,
    recordedAt: JournalPosition.make(3),
    runId
  }),
  operationIds: [laterOperation.operationId],
  taskIds: []
})
const executorAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("console-production-trace-attempt"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/console-production-trace"),
  executor: TaskExecutorLocator.make("executor:console-production-trace"),
  runId,
  taskId: TaskId.make("console-production-trace-task"),
  taskRevision: TaskRevision.make("console-production-trace-revision"),
  worktree: WorktreeLocator.make("/worktrees/console-production-trace")
})
const executorResponsibilityItem = TraceHistoryItem.make({
  identity: TracePositionIdentity.make({ position: JournalPosition.make(4), runId }),
  occurrence: PlannedAttemptExecutorWorkResponsibilityBegan.make({
    initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
    occurrenceClassification: "InitiatedAction",
    plannedAttempt: executorAttempt,
    recordedAt: JournalPosition.make(4),
    runId
  }),
  operationIds: [],
  taskIds: [executorAttempt.taskId]
})
const traceAtCursor = TraceAtCursor.make({
  cursor: TraceCursor.make({ position: JournalPosition.make(4), runId }),
  derivedTaskOrder: TraceDerivedTaskOrder.make({ basis: "TaskIdCodeUnitAscending", taskIds: [] }),
  graph: null,
  items: [historyItem, laterHistoryItem, executorResponsibilityItem],
  relationships: TraceRelationships.make({
    outsideAuthorityAcknowledgements: [],
    processLocalResourceSerializations: [],
    taskGraphEdges: [],
    workflowCausalEdges: []
  }),
  facets: TraceHistoricalFacets.make({
    controlDisposition: { cleanup: [], controls: [], dispositions: [], version: traceControlDispositionFacetVersion },
    integration: { facts: [] },
    recovery: {
      observationGaps: [
        {
          _tag: "TrackerObservation",
          action: historyItem.identity,
          operationId: operation.operationId,
          required: "TaskTrackerFactsObserved",
          taskIds: []
        },
        {
          _tag: "TrackerObservation",
          action: laterHistoryItem.identity,
          operationId: laterOperation.operationId,
          required: "TaskTrackerFactsObserved",
          taskIds: []
        },
        { _tag: "ExecutorReport", action: executorResponsibilityItem.identity, attemptId: executorAttempt.attemptId }
      ],
      preservationDispositions: [],
      retainedResponsibilities: [
        { _tag: "ExecutorWork", plannedAttempt: executorAttempt, source: executorResponsibilityItem.identity }
      ]
    }
  }),
  version: traceReaderSchemaVersion
})

it("canonicalizes the production cursor view without changing its committed identities", () => {
  const canonical = semanticTraceAtCursor(traceAtCursor)

  expect(canonical).toEqual(traceAtCursor)
  expect(traceCursorAt(canonical)).toEqual(traceAtCursor.cursor)
  expect(canonical.cursor).toEqual(TraceCursor.make({ position: JournalPosition.make(4), runId }))
  expect(canonical.items.map(({ identity }) => identity.position)).toEqual([
    JournalPosition.make(2),
    JournalPosition.make(3),
    JournalPosition.make(4)
  ])
  expect(canonical.items[0]?.identity).toEqual({ position: JournalPosition.make(2), runId })
  expect(JSON.parse(encodeTraceControlDispositionFacet(traceAtCursor))).toEqual(traceAtCursor.facets.controlDisposition)
  expect(renderTraceAtCursor(traceAtCursor)).toEqual([
    "Historical snapshot · Run console-production-trace-run · through journal position 4",
    "Journal position 2 · Dalph coordinator initiated tracker read",
    "Journal position 3 · Dalph coordinator initiated tracker read",
    "Journal position 4 · Dalph coordinator initiated executor activity",
    "Current status is separate and is not included in this historical snapshot."
  ])
})

it.effect("writes one read-only production view through the existing stdout boundary", () =>
  Effect.gen(function* () {
    const lines = yield* Ref.make<ReadonlyArray<string>>([])
    const output = TraceOutput.of({ writeLine: (line) => Ref.update(lines, (current) => [...current, line]) })

    yield* writeTraceAtCursor(output, traceAtCursor)

    expect(yield* Ref.get(lines)).toEqual(renderTraceAtCursor(traceAtCursor))
  })
)

it("renders an exact historical cursor without a transcript or internal executor payload", () => {
  const lines = renderTraceAtCursor(traceAtCursor)
  expect(lines[0]).toContain("Historical snapshot")
  expect(lines[0]).toContain("Run console-production-trace-run")
  expect(lines[0]).toContain("journal position 4")
  expect(lines.at(-1)).toBe("Current status is separate and is not included in this historical snapshot.")
  expect(lines.join("\n")).not.toMatch(/(?:transcript|session|turn|expectedTargetHead|acceptedResult)/iu)
  expect(lines.filter((line) => line.includes("Journal position 4"))).toHaveLength(1)
})

it.effect("reads one exact production cursor through TraceReader and writes its schema-versioned view", () =>
  Effect.gen(function* () {
    const lines = yield* Ref.make<ReadonlyArray<string>>([])
    const output = TraceOutput.of({ writeLine: (line) => Ref.update(lines, (current) => [...current, line]) })
    const presentationLayer = historicalTraceConsoleLayer.pipe(
      Layer.provide(TraceReaderLayer.pipe(Layer.provide(memoryJournalStoreLayer))),
      Layer.provide(Layer.succeed(TraceOutput, output))
    )
    type PresentationLayerOutput = Assert<IsExactly<Layer.Success<typeof presentationLayer>, HistoricalTraceConsole>>
    const presentationLayerOutput: PresentationLayerOutput = true
    const consoleLayer = Layer.merge(presentationLayer, memoryJournalStoreLayer)
    const { historyAfterPresentation, historyBeforePresentation, renderedLines, view } = yield* Effect.gen(
      function* () {
        const journal = yield* JournalStore
        yield* journal.beginRun(
          runId,
          target,
          InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
        )
        const operation = makeTrackerGraphObservationOperation(OperationId.make("console-e2e-operation"), target)
        yield* journal.append(runId, intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
        const historyBeforePresentation = yield* journal.read(runId)
        const console = yield* HistoricalTraceConsole
        const view = yield* console.presentAt(TraceCursor.make({ position: JournalPosition.make(2), runId }))
        const renderedLines = yield* Ref.get(lines)
        expect(renderedLines[0]).toBeDefined()
        const historyAfterPresentation = yield* journal.read(runId)
        return { historyAfterPresentation, historyBeforePresentation, renderedLines, view }
      }
    ).pipe(Effect.provide(consoleLayer))

    expect(view.cursor).toEqual({ position: JournalPosition.make(2), runId })
    expect(view.items[0]?.identity).toEqual({ position: JournalPosition.make(2), runId })
    expect(view.items[0]?.occurrence._tag).toBe("TaskTrackerReadInitiated")
    expect(renderedLines).toEqual(renderTraceAtCursor(view))
    expect(renderedLines[0]).toContain("Historical snapshot")
    expect(renderedLines.join("\n")).toContain("Dalph coordinator initiated tracker read")
    expect(JSON.parse(encodeTraceControlDispositionFacet(view))).toEqual(view.facets.controlDisposition)
    expect(historyAfterPresentation).toEqual(historyBeforePresentation)
    expect(presentationLayerOutput).toBe(true)
  })
)

it("keeps console and other presentation consumers on the exact production schema surface", () => {
  const source = readFileSync(fileURLToPath(new URL("./workflow-trace.ts", import.meta.url)), "utf8")

  expect(consoleViewUsesProductionView).toBe(true)
  expect(consoleItemUsesProductionUnion).toBe(true)
  expect(consoleCursorUsesProductionIdentity).toBe(true)
  expect(historicalConsoleUsesProductionCursor).toBe(true)
  expect(source).toContain("TraceAtCursor")
  expect(source).toContain("TraceCursor")
  expect(source).toContain("TraceHistoryItem")
  expect(source).toContain("TraceReader")
  expect(source).toContain("historicalTraceConsoleLayer")
  expect(source).toContain("Legacy transient")
  expect(source).not.toContain("Schema.TaggedUnion")
  expect(source).not.toMatch(/\b(?:JournalStore|TrackerMutation|GitCommand|PlannedAttemptExecutor|Cleanup)\b/)
})
