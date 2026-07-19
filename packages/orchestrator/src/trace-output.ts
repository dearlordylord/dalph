import type { Effect } from "effect"
import { Context, Schema } from "effect"

export class TraceOutputError extends Schema.TaggedErrorClass<TraceOutputError>()(
  "TraceOutput.TraceOutputError",
  { detail: Schema.String }
) {}

interface Interface {
  readonly writeLine: (
    line: string
  ) => Effect.Effect<void, TraceOutputError>
}

export class TraceOutput extends Context.Service<TraceOutput, Interface>()(
  "@dalph/TraceOutput"
) {}
