/* eslint-disable import/no-nodejs-modules -- The shipped executable delegates its exact Node process lifecycle here. */
import nodeProcess from "node:process"
import { type Effect, Runtime } from "effect"

const runMainWithoutSignalInterruption = Runtime.makeRunMain(({ fiber, teardown }) => {
  fiber.addObserver((exit) => {
    teardown(exit, (status) => {
      // eslint-disable-next-line functional/immutable-data -- Node's process exitCode is the host-visible result channel.
      nodeProcess.exitCode = status
    })
  })
})

/** Runs Dalph while leaving SIGINT and SIGTERM exclusively owned by its application Exit transport. */
export const runDalphNodeMain = <A, E>(application: Effect.Effect<A, E>): void => {
  runMainWithoutSignalInterruption(application)
}
