import {
  TraceAtCursor,
  TraceControlDispositionFacet,
  TraceHistoryItem,
  TraceItem,
  TraceOutput,
  TraceReader,
  makeTracePresentation,
  readTracePresentation,
  WorkflowTrace,
  describeWorkflowOccurrence
} from "@dalph/orchestrator"
import type {
  CurrentSignal,
  JournalStoreError,
  TraceCursor,
  TraceOutputError,
  TracePresentation,
  TraceReaderError
} from "@dalph/orchestrator"
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

/** The passive status visible beside a fixed historical cursor; it is not journal evidence. */
export type TraceConsoleStatus =
  | { readonly _tag: "Waiting"; readonly reason: string }
  | { readonly _tag: "Running"; readonly reason: string }
  | { readonly _tag: "Unavailable"; readonly reason: string }

const unavailableTraceStatus: TraceConsoleStatus = {
  _tag: "Unavailable",
  reason: "no passive status source was supplied"
}

/** Renders only the current-status signal, keeping it separate from historical trace lines. */
export const renderTraceStatus = (status: TraceConsoleStatus): string => {
  switch (status._tag) {
    case "Waiting":
      return `Waiting · ${status.reason}`
    case "Running":
      return `Running · ${status.reason}`
    case "Unavailable":
      return `Unavailable · ${status.reason}`
  }
}

/** Renders one fixed historical cursor together with a separately read passive status value. */
export const renderTraceAtCursorWithStatus = (
  history: TraceAtCursor,
  status: TraceConsoleStatus
): ReadonlyArray<string> => {
  const canonical = semanticTraceAtCursor(history)
  return [
    `Historical snapshot · Run ${canonical.cursor.runId} · through journal position ${canonical.cursor.position}`,
    ...canonical.items.map(
      ({ identity, occurrence }) =>
        `Journal position ${identity.position} · ${describeWorkflowOccurrence(occurrence).text}`
    ),
    `Passive current status · ${renderTraceStatus(status)}.`
  ]
}

/** Renders one immutable committed cursor with truthful actors and no internal transcript. */
export const renderTraceAtCursor = (history: TraceAtCursor): ReadonlyArray<string> =>
  renderTraceAtCursorWithStatus(history, unavailableTraceStatus)

/** Writes only the passive current-status region; it never rereads or rewrites history. */
export const writeTraceStatus = (
  output: Pick<TraceOutput["Service"], "writeLine">,
  status: TraceConsoleStatus
): Effect.Effect<void, TraceOutputError> => output.writeLine(`Passive current status · ${renderTraceStatus(status)}.`)

/** Writes one fixed historical view and its separately sourced passive status. */
export const writeTraceAtCursorWithStatus = (
  output: Pick<TraceOutput["Service"], "writeLine">,
  presentation: TracePresentation<TraceConsoleStatus>
): Effect.Effect<void, TraceOutputError> =>
  Effect.forEach(renderTraceAtCursorWithStatus(presentation.history, presentation.currentStatus), output.writeLine, {
    discard: true
  })

/** Writes one read-only production historical view through the existing console output boundary. */
export const writeTraceAtCursor = (
  output: Pick<TraceOutput["Service"], "writeLine">,
  history: TraceAtCursor
): Effect.Effect<void, TraceOutputError> =>
  writeTraceAtCursorWithStatus(output, makeTracePresentation(history, unavailableTraceStatus))

/** Read-only production console service: one exact cursor is read and its view is written once. */
export interface HistoricalTraceConsoleService {
  readonly presentAt: (
    cursor: TraceCursor
  ) => Effect.Effect<TraceAtCursor, JournalStoreError | TraceOutputError | TraceReaderError>
  /** Reads one fixed cursor and a separate current-first passive status source. */
  readonly presentAtWithStatus: (
    cursor: TraceCursor,
    currentStatus: CurrentSignal<TraceConsoleStatus>
  ) => Effect.Effect<
    TracePresentation<CurrentSignal<TraceConsoleStatus>>,
    JournalStoreError | TraceOutputError | TraceReaderError
  >
  /** Writes a changed passive status without rereading or rewriting the selected history. */
  readonly refreshStatus: (
    presentation: TracePresentation<CurrentSignal<TraceConsoleStatus>>
  ) => Effect.Effect<void, TraceOutputError>
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
      presentAt: (cursor) => reader.readAt(cursor).pipe(Effect.tap((history) => writeTraceAtCursor(output, history))),
      presentAtWithStatus: (cursor, currentStatus) =>
        readTracePresentation({ currentStatus, traceReader: reader }, cursor).pipe(
          Effect.flatMap((presentation) =>
            Effect.gen(function* () {
              const status = yield* presentation.currentStatus.get
              yield* writeTraceAtCursorWithStatus(output, makeTracePresentation(presentation.history, status))
              return presentation
            })
          )
        ),
      refreshStatus: (presentation) =>
        presentation.currentStatus.get.pipe(Effect.flatMap((status) => writeTraceStatus(output, status)))
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
