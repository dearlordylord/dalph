import { Effect, Layer, Schema } from "effect"
import { TraceOutput } from "./trace-output.js"
import { TraceItem, WorkflowTrace } from "./workflow.js"

export const semanticTrace = (items: ReadonlyArray<TraceItem>): ReadonlyArray<TraceItem> =>
  Schema.decodeUnknownSync(Schema.Array(TraceItem))(
    Schema.encodeUnknownSync(Schema.Array(TraceItem))(items)
  )

export const encodeTraceItem = (item: TraceItem): string => JSON.stringify(Schema.encodeUnknownSync(TraceItem)(item))

export const workflowTraceOutputLayer = Layer.effect(
  WorkflowTrace,
  Effect.gen(function*() {
    const output = yield* TraceOutput
    return WorkflowTrace.of({
      emit: Effect.fn("WorkflowTrace.Output.emit")(function*(item) {
        yield* output.writeLine(encodeTraceItem(item))
      })
    })
  })
)
