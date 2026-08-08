import { TraceItem, TraceOutput, WorkflowTrace } from "@dalph/orchestrator"
import { Effect, Layer, Schema } from "effect"

export const semanticTrace = (items: ReadonlyArray<TraceItem>): ReadonlyArray<TraceItem> =>
  Schema.decodeUnknownSync(Schema.Array(TraceItem))(Schema.encodeUnknownSync(Schema.Array(TraceItem))(items))

export const encodeTraceItem = (item: TraceItem): string => JSON.stringify(Schema.encodeUnknownSync(TraceItem)(item))

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
