import {
  TraceAtCursor,
  TraceControlDispositionFacet,
  TraceHistoryItem,
  TraceItem,
  TraceOutput,
  TraceReader,
  WorkflowTrace,
  describeWorkflowOccurrence
} from "@dalph/orchestrator"
import type { JournalStoreError, TraceCursor, TraceOutputError, TraceReaderError } from "@dalph/orchestrator"
import { Context, Effect, Layer, Schema } from "effect"

/** Legacy transient dry-run items emitted by WorkflowTrace; they are not durable historical trace views. */
export const semanticTrace = (items: ReadonlyArray<TraceItem>): ReadonlyArray<TraceItem> =>
  Schema.decodeUnknownSync(Schema.Array(TraceItem))(Schema.encodeUnknownSync(Schema.Array(TraceItem))(items))

/** Legacy transient dry-run encoding retained separately from the production historical console surface. */
export const encodeTraceItem = (item: TraceItem): string => JSON.stringify(Schema.encodeUnknownSync(TraceItem)(item))

/** Canonicalizes one production historical view without introducing a console cursor or item schema. */
export const semanticTraceAtCursor = (history: TraceAtCursor): TraceAtCursor =>
  Schema.decodeUnknownSync(TraceAtCursor)(Schema.encodeUnknownSync(TraceAtCursor)(history))

/** Retains the committed Run and JournalPosition identity used by every presentation consumer. */
export const traceCursorAt = (history: TraceAtCursor): TraceCursor => history.cursor

/** Encodes one production history item using the schema-versioned occurrence union. */
export const encodeTraceHistoryItem = (item: TraceHistoryItem): string =>
  JSON.stringify(Schema.encodeUnknownSync(TraceHistoryItem)(item))

/** Encodes the complete production view, including its graph and distinct relationship sets. */
export const encodeTraceAtCursor = (history: TraceAtCursor): string =>
  JSON.stringify(Schema.encodeUnknownSync(TraceAtCursor)(semanticTraceAtCursor(history)))

/** Encodes the shared control/disposition/cleanup facet without adding presentation-specific state. */
export const encodeTraceControlDispositionFacet = (history: TraceAtCursor): string =>
  JSON.stringify(
    Schema.encodeUnknownSync(TraceControlDispositionFacet)(semanticTraceAtCursor(history).facets.controlDisposition)
  )

/** Renders one immutable committed cursor with truthful actors and no internal transcript. */
export const renderTraceAtCursor = (history: TraceAtCursor): ReadonlyArray<string> => {
  const canonical = semanticTraceAtCursor(history)
  return [
    `Historical snapshot · Run ${canonical.cursor.runId} · through journal position ${canonical.cursor.position}`,
    ...canonical.items.map(
      ({ identity, occurrence }) =>
        `Journal position ${identity.position} · ${describeWorkflowOccurrence(occurrence).text}`
    ),
    "Current status is separate and is not included in this historical snapshot."
  ]
}

/** Writes one read-only production historical view through the existing console output boundary. */
export const writeTraceAtCursor = (
  output: Pick<TraceOutput["Service"], "writeLine">,
  history: TraceAtCursor
): Effect.Effect<void, TraceOutputError> =>
  Effect.forEach(renderTraceAtCursor(history), output.writeLine, { discard: true })

/** Read-only production console service: one exact cursor is read and its view is written once. */
export interface HistoricalTraceConsoleService {
  readonly presentAt: (
    cursor: TraceCursor
  ) => Effect.Effect<TraceAtCursor, JournalStoreError | TraceOutputError | TraceReaderError>
}

/** Presentation receives only the production TraceReader read capability and TraceOutput sink. */
export class HistoricalTraceConsole extends Context.Service<HistoricalTraceConsole, HistoricalTraceConsoleService>()(
  "@dalph/HistoricalTraceConsole"
) {}

/** Installs historical console presentation without exposing journal or provider mutation capabilities. */
export const historicalTraceConsoleLayer = Layer.effect(
  HistoricalTraceConsole,
  Effect.gen(function* () {
    const reader = yield* TraceReader
    const output = yield* TraceOutput
    return HistoricalTraceConsole.of({
      presentAt: (cursor) => reader.readAt(cursor).pipe(Effect.tap((history) => writeTraceAtCursor(output, history)))
    })
  })
)

/** Legacy transient dry-run WorkflowTrace output; production historical presentation uses historicalTraceConsoleLayer. */
export const workflowTraceOutputLayer = Layer.effect(
  WorkflowTrace,
  Effect.gen(function* () {
    const output = yield* TraceOutput
    return WorkflowTrace.of({
      emit: Effect.fn("WorkflowTrace.Output.emit")(function* (item) {
        yield* output.writeLine(encodeTraceItem(item))
      })
    })
  })
)
