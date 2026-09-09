/* eslint-disable import/no-nodejs-modules -- The test observes the shipped Node runner's host exit channel. */
import nodeProcess from "node:process"
import { it } from "@effect/vitest"
import { Deferred, Effect } from "effect"
import { expect } from "vitest"
import { runDalphNodeMain } from "./node-main.js"

it.effect("runs the Node main effect and reports its successful host exit status", () =>
  Effect.gen(function* () {
    const previousExitCode = nodeProcess.exitCode
    const completed = yield* Deferred.make<void>()

    try {
      runDalphNodeMain(Deferred.succeed(completed, undefined))
      yield* Deferred.await(completed)
      yield* Effect.yieldNow

      expect(nodeProcess.exitCode).toBe(0)
    } finally {
      // eslint-disable-next-line functional/immutable-data -- Restore the process-local test host state.
      nodeProcess.exitCode = previousExitCode
    }
  })
)
