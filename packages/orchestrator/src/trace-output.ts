import type { Effect } from "effect"
import { Context, Schema } from "effect"

// eslint-disable-next-line functional/no-class-inheritance -- Effect typed errors use Schema.TaggedErrorClass inheritance.
export class TraceOutputError extends Schema.TaggedErrorClass<TraceOutputError>()(
  "TraceOutput.TraceOutputError",
  { detail: Schema.String }
) {}

interface TraceOutputService {
  readonly writeLine: (
    line: string
  ) => Effect.Effect<void, TraceOutputError>
}

// eslint-disable-next-line functional/no-class-inheritance -- Effect service tags use Context.Service inheritance.
export class TraceOutput extends Context.Service<TraceOutput, TraceOutputService>()(
  "@dalph/TraceOutput"
) {}
