#!/usr/bin/env node
/* eslint-disable import/no-nodejs-modules -- This executable fixture observes the real Node signal/runtime boundary. */
import nodeProcess from "node:process"
import { NodeStream } from "@effect/platform-node"
import { ApplicationExitDiagnostic, ApplicationExitResult } from "@dalph/orchestrator"
import { Effect, Option, Runtime, Schema, Stream } from "effect"
import { runDalphNodeMain } from "../src/application/node-main.js"
import {
  installApplicationExitSignalAdapter,
  nodeApplicationExitSignalBoundary
} from "../src/application/supervisor-exit.js"

const write = (event: string): Effect.Effect<void> =>
  Effect.sync(() => {
    nodeProcess.stdout.write(`${JSON.stringify({ event })}\n`)
  })

class NodeMainSignalFixtureFailure extends Schema.TaggedError<NodeMainSignalFixtureFailure>()(
  "NodeMainSignalFixtureFailure",
  { kind: Schema.Literals(["EndOfInput", "InvalidRelease", "ReadFailed", "ExitFailed"]) }
) {
  override readonly [Runtime.errorExitCode] = 1
  override readonly [Runtime.errorReported] = false
}

const awaitParentRelease = NodeStream.fromReadable<Uint8Array, NodeMainSignalFixtureFailure>({
  closeOnDone: false,
  evaluate: () => nodeProcess.stdin,
  onError: () => new NodeMainSignalFixtureFailure({ kind: "ReadFailed" })
}).pipe(
  Stream.decodeText(),
  Stream.splitLines,
  Stream.runHead,
  Effect.flatMap(
    Option.match({
      onNone: () => new NodeMainSignalFixtureFailure({ kind: "EndOfInput" }),
      onSome: (line) =>
        line === "release" ? write("release-received") : new NodeMainSignalFixtureFailure({ kind: "InvalidRelease" })
    })
  )
)

const releaseInputFailure = ApplicationExitResult.cases.Failed.make({
  diagnostics: [ApplicationExitDiagnostic.make("fixture release input unavailable")],
  requestedStatus: 1
})

const application = Effect.scoped(
  Effect.gen(function* () {
    yield* Effect.addFinalizer(() => write("scope-finalized"))
    const signals = yield* installApplicationExitSignalAdapter(
      {
        requestExit: write("exit-requested").pipe(
          Effect.andThen(awaitParentRelease),
          Effect.as(ApplicationExitResult.cases.Succeeded.make({ requestedStatus: 0 })),
          Effect.orElseSucceed(() => releaseInputFailure)
        )
      },
      nodeApplicationExitSignalBoundary,
      ["SIGINT", "SIGTERM"]
    )
    yield* write("ready")
    const result = yield* signals.awaitResult
    yield* write(`exit-result:${result._tag}`)
    if (result._tag !== "Succeeded") {
      return yield* new NodeMainSignalFixtureFailure({ kind: "ExitFailed" })
    }
  })
)

runDalphNodeMain(application)
