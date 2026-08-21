/* eslint-disable import/no-nodejs-modules -- Source assertion guards the public console presentation seam. */
import { it } from "@effect/vitest"
import { RunId } from "@dalph/contracts"
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
  TraceOutput,
  TracePositionIdentity,
  TraceReaderLayer,
  TraceRelationships,
  WorkflowActor,
  intentRecordKey,
  makeTrackerGraphObservationOperation,
  memoryJournalStoreLayer,
  taskTrackerReadIntent,
  traceReaderSchemaVersion
} from "@dalph/orchestrator"
import { Effect, Layer, Ref, Schema } from "effect"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { expect } from "vitest"
import {
  encodeTraceAtCursor,
  encodeTraceHistoryItem,
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
const traceAtCursor = TraceAtCursor.make({
  cursor: TraceCursor.make({ position: JournalPosition.make(3), runId }),
  derivedTaskOrder: TraceDerivedTaskOrder.make({ basis: "TaskIdCodeUnitAscending", taskIds: [] }),
  graph: null,
  items: [historyItem, laterHistoryItem],
  relationships: TraceRelationships.make({
    outsideAuthorityAcknowledgements: [],
    processLocalResourceSerializations: [],
    taskGraphEdges: [],
    workflowCausalEdges: []
  }),
  version: traceReaderSchemaVersion
})

it("canonicalizes the production cursor view without changing its committed identities", () => {
  const canonical = semanticTraceAtCursor(traceAtCursor)

  expect(canonical).toEqual(traceAtCursor)
  expect(traceCursorAt(canonical)).toEqual(traceAtCursor.cursor)
  expect(canonical.cursor).toEqual(TraceCursor.make({ position: JournalPosition.make(3), runId }))
  expect(canonical.items.map(({ identity }) => identity.position)).toEqual([
    JournalPosition.make(2),
    JournalPosition.make(3)
  ])
  expect(canonical.items[0]?.identity).toEqual({ position: JournalPosition.make(2), runId })
  expect(renderTraceAtCursor(traceAtCursor)).toEqual([
    encodeTraceHistoryItem(historyItem),
    encodeTraceHistoryItem(laterHistoryItem)
  ])
})

it.effect("writes one read-only production view through the existing stdout boundary", () =>
  Effect.gen(function* () {
    const lines = yield* Ref.make<ReadonlyArray<string>>([])
    const output = TraceOutput.of({ writeLine: (line) => Ref.update(lines, (current) => [...current, line]) })

    yield* writeTraceAtCursor(output, traceAtCursor)

    expect(yield* Ref.get(lines)).toEqual([encodeTraceAtCursor(traceAtCursor)])
  })
)

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
    const { encoded, historyAfterPresentation, historyBeforePresentation, view } = yield* Effect.gen(function* () {
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
      const [line] = yield* Ref.get(lines)
      expect(line).toBeDefined()
      const historyAfterPresentation = yield* journal.read(runId)
      const encoded = yield* Schema.decodeUnknownEffect(TraceAtCursor)(JSON.parse(line ?? ""))
      return { encoded, historyAfterPresentation, historyBeforePresentation, view }
    }).pipe(Effect.provide(consoleLayer))

    expect(view.cursor).toEqual({ position: JournalPosition.make(2), runId })
    expect(view.items[0]?.identity).toEqual({ position: JournalPosition.make(2), runId })
    expect(view.items[0]?.occurrence._tag).toBe("TaskTrackerReadInitiated")
    expect(encoded).toEqual(view)
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
