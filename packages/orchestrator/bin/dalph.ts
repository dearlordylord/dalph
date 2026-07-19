#!/usr/bin/env node
import { Effect, Layer } from "effect"
import { runCli } from "../src/cli.js"
import { TraceOutput, TraceOutputError } from "../src/trace-output.js"
import { trackerGraphReaderFileLayer } from "../src/tracker-graph-reader.js"

const USER_ARGUMENT_OFFSET = 2

const stdoutLayer = Layer.effect(
  TraceOutput,
  Effect.gen(function*() {
    const writeLine = Effect.fn("TraceOutput.writeLine")(function*(
      line: string
    ) {
      yield* Effect.try({
        try: () => process.stdout.write(`${line}\n`),
        catch: (cause) => new TraceOutputError({ detail: String(cause) })
      })
    })

    return TraceOutput.of({ writeLine })
  })
)

const program = runCli(process.argv.slice(USER_ARGUMENT_OFFSET)).pipe(
  Effect.provide(stdoutLayer),
  Effect.provide(trackerGraphReaderFileLayer)
)

Effect.runPromise(program).catch((cause: unknown) => {
  process.stderr.write(`${String(cause)}\n`)
  process.exit(1)
})
