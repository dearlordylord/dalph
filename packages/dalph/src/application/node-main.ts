/* eslint-disable import/no-nodejs-modules -- The shipped executable delegates its exact Node process lifecycle here. */
import nodeProcess from "node:process"
import { Cause, Effect, Option, Runtime } from "effect"
import { TraceOutputError } from "@dalph/orchestrator"
import { TraceOutputDelivery } from "../presentation/stdio-trace-output.js"
import { DalphCommandExit } from "./command-exit.js"
import {
  abandonedCliOutputProcessStatus,
  CliExitOutputAbandoned,
  retainCliExitOutputCompletion
} from "./cli-exit-output.js"
import { encodeRuntimeDiagnostic, projectRuntimeCause } from "./runtime-diagnostic.js"

const configuredSensitiveValues = () => [
  nodeProcess.env["GITHUB_TOKEN"] ?? "",
  nodeProcess.env["DALPH_LIVE_CONTROLLED_PROVIDER_CREDENTIAL"] ?? "",
  nodeProcess.env["OPENAI_API_KEY"] ?? ""
]

const runMainWithoutSignalInterruption = Runtime.makeRunMain(({ fiber, teardown }) => {
  fiber.addObserver((exit) => {
    if (
      exit._tag === "Failure" &&
      exit.cause.reasons.some(
        (reason) =>
          Cause.isDieReason(reason) ||
          (Cause.isFailReason(reason) &&
            !(reason.error instanceof DalphCommandExit) &&
            !(reason.error instanceof CliExitOutputAbandoned))
      )
    ) {
      try {
        nodeProcess.stderr.write(encodeRuntimeDiagnostic(projectRuntimeCause(exit.cause, configuredSensitiveValues())))
      } catch {
        // Diagnostic output is best-effort; the original exit still selects the host result.
      }
    }
    teardown(exit, (status) => {
      const failure = exit._tag === "Failure" ? Cause.findErrorOption(exit.cause) : Option.none()
      const outputStatus = exit._tag === "Failure" ? abandonedCliOutputProcessStatus(exit.cause) : Option.none()
      if (Option.isSome(outputStatus)) {
        // The main fiber has completed its host finalizers. Natural Node exit
        // can still wait forever for accepted stdout bytes with no reader.
        nodeProcess.exit(outputStatus.value)
      }
      // eslint-disable-next-line functional/immutable-data -- Node's process exitCode is the host-visible result channel.
      nodeProcess.exitCode =
        Option.isSome(failure) && failure.value instanceof DalphCommandExit ? failure.value.status : status
    })
  })
})

/** Runs Dalph while leaving SIGINT and SIGTERM exclusively owned by its application Exit transport. */
export const runDalphNodeMain = <A, E>(application: Effect.Effect<A, E>): void => {
  const settle = Effect.callback<void, TraceOutputError>((resume) => {
    let completed = false
    const onError = (error: unknown) => {
      completed = true
      nodeProcess.stdout.off("error", onError)
      resume(Effect.fail(new TraceOutputError({ detail: String(error) })))
    }
    nodeProcess.stdout.once("error", onError)
    // An empty write is a callback barrier for previously accepted bytes. It
    // emits no record and still waits when the queue is below highWaterMark.
    nodeProcess.stdout.write("", (error) => {
      // Writable reports callback failures through its subsequent error event;
      // keep that listener until it observes the typed failure.
      if (!error) {
        completed = true
        nodeProcess.stdout.off("error", onError)
        resume(Effect.void)
      }
    })
    return Effect.sync(() => {
      // Grace cancellation abandons delivery, not the pending Node callback.
      // Keep its error listener until completion or process end so a later
      // EPIPE cannot bypass the host finalizers with an unhandled event.
      if (completed) nodeProcess.stdout.off("error", onError)
    })
  })
  runMainWithoutSignalInterruption(
    retainCliExitOutputCompletion(application.pipe(Effect.provideService(TraceOutputDelivery, { settle }))),
    { disableErrorReporting: true }
  )
}
