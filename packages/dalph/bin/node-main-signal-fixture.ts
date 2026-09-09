#!/usr/bin/env node
/* eslint-disable import/no-nodejs-modules -- This executable fixture observes the real Node signal/runtime boundary. */
import nodeProcess from "node:process"
import { ApplicationExitResult } from "@dalph/orchestrator"
import { Effect } from "effect"
import { runDalphNodeMain } from "../src/application/node-main.js"
import {
  installApplicationExitSignalAdapter,
  nodeApplicationExitSignalBoundary
} from "../src/application/supervisor-exit.js"

const write = (event: string): Effect.Effect<void> =>
  Effect.sync(() => {
    nodeProcess.stdout.write(`${JSON.stringify({ event })}\n`)
  })

const application = Effect.scoped(
  Effect.gen(function* () {
    yield* Effect.addFinalizer(() => write("scope-finalized"))
    const signals = yield* installApplicationExitSignalAdapter(
      {
        requestExit: write("exit-requested").pipe(
          Effect.andThen(Effect.sleep("200 millis")),
          Effect.as(ApplicationExitResult.cases.Succeeded.make({ requestedStatus: 0 }))
        )
      },
      nodeApplicationExitSignalBoundary,
      ["SIGINT", "SIGTERM"]
    )
    yield* write("ready")
    const result = yield* signals.awaitResult
    yield* write(`exit-result:${result._tag}`)
  })
)

runDalphNodeMain(application)
