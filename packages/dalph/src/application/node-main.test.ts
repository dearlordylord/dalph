/* eslint-disable import/no-nodejs-modules -- The test observes the shipped Node runner's host exit channel. */
import nodeProcess from "node:process"
import { it } from "@effect/vitest"
import { OperationId, TaskTrackerMutationThrottled } from "@dalph/orchestrator"
import { Deferred, Effect } from "effect"
import { expect } from "vitest"
import { runDalphNodeMain } from "./node-main.js"
import { ProductionCliOutputError } from "./production-cli.js"

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

it.effect("a typed tracker throttle command failure is mapped by the shipped Node runner to status one", () =>
  Effect.gen(function* () {
    const previousExitCode = nodeProcess.exitCode
    const completed = yield* Deferred.make<void>()
    const throttle = new TaskTrackerMutationThrottled({
      detail: "provider rejected one mutation",
      operation: "AcquireTaskClaim",
      operationId: OperationId.make("node-main-throttle"),
      retry: null
    })

    try {
      runDalphNodeMain(Effect.fail(throttle).pipe(Effect.ensuring(Deferred.succeed(completed, undefined))))
      yield* Deferred.await(completed)
      yield* Effect.yieldNow

      expect(nodeProcess.exitCode).toBe(1)
    } finally {
      // eslint-disable-next-line functional/immutable-data -- Restore the process-local test host state.
      nodeProcess.exitCode = previousExitCode
    }
  })
)

it.effect("a typed public output failure is mapped by the shipped Node runner to status one", () =>
  Effect.gen(function* () {
    const previousExitCode = nodeProcess.exitCode
    const completed = yield* Deferred.make<void>()
    const failure = new ProductionCliOutputError({
      code: "output.write_failed",
      detail: "production stdout could not be written",
      subject: "production stdout"
    })

    try {
      runDalphNodeMain(Effect.fail(failure).pipe(Effect.ensuring(Deferred.succeed(completed, undefined))))
      yield* Deferred.await(completed)
      yield* Effect.yieldNow

      expect(nodeProcess.exitCode).toBe(1)
    } finally {
      // eslint-disable-next-line functional/immutable-data -- Restore the process-local test host state.
      nodeProcess.exitCode = previousExitCode
    }
  })
)
