import { RunId } from "@dalph/contracts"
import { Context, Effect, Layer, Schema } from "effect"
import {
  LocalHostAddress,
  encodeRunningHostEnvelope,
  type RunningHostError,
  type RunningHostEnvelope
} from "./running-host-contract.js"
import { runningHostNodeOutput } from "./running-host-output.js"
import { DalphCommandExit, requestFailureExitStatus, transportFailureExitStatus } from "./command-exit.js"

/** The client owns these output streams; no workflow capability crosses this boundary. */
export class RunningHostCliOutput extends Context.Service<
  RunningHostCliOutput,
  { readonly writeLine: (text: string, channel: "stdout" | "stderr") => Effect.Effect<void, DalphCommandExit> }
>()("@dalph/RunningHostCliOutput") {}

export const runningHostCliStdioLayer = Layer.succeed(RunningHostCliOutput, {
  writeLine: (text, channel) =>
    Effect.try({
      try: () => runningHostNodeOutput(channel),
      catch: () => new DalphCommandExit({ status: transportFailureExitStatus })
    }).pipe(
      Effect.flatMap((destination) =>
        Effect.callback<void, DalphCommandExit>((resume) => {
          let pending = true
          const failed = () => {
            pending = false
            destination.destroy()
            resume(Effect.fail(new DalphCommandExit({ status: transportFailureExitStatus })))
          }
          destination.once("error", failed)
          destination.write(`${text}\n`, (error) => {
            pending = false
            destination.removeListener("error", failed)
            if (error) failed()
            else resume(Effect.void)
          })
          return Effect.sync(() => {
            destination.removeListener("error", failed)
            if (pending) destination.destroy()
          })
        })
      )
    )
})
export const writeLine = Effect.fn("RunningHostCli.write")(function* (
  text: string,
  channel: "stdout" | "stderr" = "stdout"
) {
  const output = yield* RunningHostCliOutput
  yield* output.writeLine(text, channel).pipe(
    Effect.timeout("5 seconds"),
    Effect.catchTag("TimeoutError", () => new DalphCommandExit({ status: transportFailureExitStatus }))
  )
})
export const exitFor = (
  error: RunningHostError
): typeof requestFailureExitStatus | typeof transportFailureExitStatus =>
  error._tag === "HostUnavailable" ||
  error._tag === "TransportFailed" ||
  error._tag === "WriteTimedOut" ||
  error._tag === "CommandOutcomeUnknown"
    ? transportFailureExitStatus
    : requestFailureExitStatus
export const presentEnvelope = Effect.fn("RunningHostCli.present")(function* (envelope: RunningHostEnvelope) {
  yield* encodeRunningHostEnvelope(envelope).pipe(Effect.flatMap((text) => writeLine(text)))
  if (envelope.result._tag === "Failure") return yield* new DalphCommandExit({ status: exitFor(envelope.result.error) })
})
export const decodeClient = Effect.fn("RunningHostCli.decode")((host: string, run?: string) =>
  Schema.decodeUnknownEffect(Schema.Struct({ address: LocalHostAddress, runId: Schema.NullOr(RunId) }))({
    address: host,
    runId: run ?? null
  }).pipe(
    Effect.mapError(
      (): RunningHostError => ({ _tag: "InvalidRequest", fieldPath: "", code: "ClientConfigurationInvalid" })
    )
  )
)
