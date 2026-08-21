import {
  TraceAtCursor,
  TraceHistoryItem,
  TraceItem,
  TraceOutput,
  TraceReader,
  WorkflowTrace
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

/** Renders recorded occurrences in their committed order; task ordering remains a separate derived view. */
export const renderTraceAtCursor = (history: TraceAtCursor): ReadonlyArray<string> =>
  semanticTraceAtCursor(history).items.map(encodeTraceHistoryItem)

/** Writes one read-only production historical view through the existing console output boundary. */
export const writeTraceAtCursor = (
  output: Pick<TraceOutput["Service"], "writeLine">,
  history: TraceAtCursor
): Effect.Effect<void, TraceOutputError> => output.writeLine(encodeTraceAtCursor(history))

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
