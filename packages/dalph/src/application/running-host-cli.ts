/* eslint-disable import/no-nodejs-modules -- This command owns only client stdout/stderr completion. */
import { RunId } from "@dalph/contracts"
import { Context, Effect, FileSystem, Layer, Schema } from "effect"
import { Argument, Command, Flag } from "effect/unstable/cli"
import type { ProductionRepositoryHostConfiguration } from "./production-configuration.js"
import type { ProductionRunningHostObservation } from "./production-host.js"
import { decodeRunInvocation, loadProductionConfiguration } from "./production-cli.js"
import { installApplicationExitSignalAdapter, type ApplicationExitSignalBoundary } from "./supervisor-exit.js"
import {
  encodeRunningHostEnvelope,
  LocalHostAddress,
  type RunningHostError,
  type RunningHostEnvelope,
  runningHostFailureEnvelope
} from "./running-host-contract.js"
import { callRunningHost, readRunningHostDescriptor } from "./running-host-client.js"
import { serveRunningHost } from "./running-host-http.js"
import { runRunningHostMcp } from "./running-host-mcp.js"
import { runningHostNodeOutput } from "./running-host-output.js"
import { DalphCommandExit, requestFailureExitStatus, transportFailureExitStatus } from "./command-exit.js"

export type ProductionListeningHostRunner<E, R> = <EUse>(
  configuration: ProductionRepositoryHostConfiguration,
  use: (observation: ProductionRunningHostObservation<E>) => Effect.Effect<void, EUse>
) => Effect.Effect<void, E | EUse, R>

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
const writeLine = Effect.fn("RunningHostCli.write")(function* (text: string, channel: "stdout" | "stderr" = "stdout") {
  const output = yield* RunningHostCliOutput
  yield* output.writeLine(text, channel).pipe(
    Effect.timeout("5 seconds"),
    Effect.catchTag("TimeoutError", () => new DalphCommandExit({ status: transportFailureExitStatus }))
  )
})
const exitFor = (error: RunningHostError): typeof requestFailureExitStatus | typeof transportFailureExitStatus =>
  error._tag === "HostUnavailable" || error._tag === "TransportFailed" || error._tag === "WriteTimedOut"
    ? transportFailureExitStatus
    : requestFailureExitStatus
const presentEnvelope = Effect.fn("RunningHostCli.present")(function* (envelope: RunningHostEnvelope) {
  yield* encodeRunningHostEnvelope(envelope).pipe(Effect.flatMap((text) => writeLine(text)))
  if (envelope.result._tag === "Failure") return yield* new DalphCommandExit({ status: exitFor(envelope.result.error) })
})
const decodeClient = Effect.fn("RunningHostCli.decode")((host: string, run?: string) =>
  Schema.decodeUnknownEffect(Schema.Struct({ address: LocalHostAddress, runId: Schema.NullOr(RunId) }))({
    address: host,
    runId: run ?? null
  }).pipe(
    Effect.mapError(
      (): RunningHostError => ({ _tag: "InvalidRequest", fieldPath: "", code: "ClientConfigurationInvalid" })
    )
  )
)

/** Adds only the passive #368 slice; watches and mutating tools have later owners. */
export const makeRunningHostCommands = <E, R>(
  runHost: ProductionListeningHostRunner<E, R>,
  signals: ApplicationExitSignalBoundary,
  outputLayer: Layer.Layer<RunningHostCliOutput> = runningHostCliStdioLayer
) => {
  const host = Command.make(
    "host",
    {
      config: Flag.string("config"),
      listen: Flag.string("listen"),
      production: Flag.boolean("production"),
      target: Argument.string("target")
    },
    ({ config, listen, production, target }) =>
      Effect.gen(function* () {
        const address = yield* Schema.decodeUnknownEffect(LocalHostAddress)(listen)
        const invocation = yield* decodeRunInvocation({ config, production, dry: false, target })
        if (invocation._tag !== "Production") return yield* new DalphCommandExit({ status: requestFailureExitStatus })
        const fileSystem = yield* FileSystem.FileSystem
        const configuration = yield* loadProductionConfiguration(invocation.configuration, invocation.target, (path) =>
          fileSystem.readFileString(path)
        )
        yield* runHost(configuration, (observation) =>
          Effect.scoped(
            Effect.gen(function* () {
              const signalsInstalled = yield* installApplicationExitSignalAdapter(
                observation.applicationExitRequestBoundary,
                signals,
                ["SIGINT", "SIGTERM"]
              )
              const listening = yield* serveRunningHost(address, observation)
              yield* writeLine(JSON.stringify({ _tag: "HostReady", address, descriptor: listening.descriptor }))
              const result = yield* signalsInstalled.awaitResult
              yield* writeLine(JSON.stringify({ applicationExit: result }), "stderr")
              if (result._tag !== "Succeeded")
                return yield* new DalphCommandExit({ status: transportFailureExitStatus })
            })
          ).pipe(Effect.provide(outputLayer))
        )
      }).pipe(Effect.provide(outputLayer))
  )
  const descriptor = Command.make(
    "descriptor",
    { host: Flag.string("host"), json: Flag.boolean("json") },
    ({ host, json }) =>
      Effect.gen(function* () {
        if (!json)
          return yield* Effect.fail<RunningHostError>({
            _tag: "InvalidRequest",
            fieldPath: "/json",
            code: "JsonRequired"
          })
        const { address } = yield* decodeClient(host)
        yield* readRunningHostDescriptor(address).pipe(Effect.flatMap((value) => writeLine(JSON.stringify(value))))
      }).pipe(
        Effect.catch((error) =>
          error instanceof DalphCommandExit
            ? Effect.fail(error)
            : presentEnvelope(runningHostFailureEnvelope(null, error))
        ),
        Effect.provide(outputLayer)
      )
  )
  const passive = (name: "snapshot" | "control") =>
    Command.make(
      name,
      { host: Flag.string("host"), run: Flag.string("run"), json: Flag.boolean("json") },
      ({ host, json, run }) =>
        Effect.gen(function* () {
          if (!json)
            return yield* Effect.fail<RunningHostError>({
              _tag: "InvalidRequest",
              fieldPath: "/json",
              code: "JsonRequired"
            })
          const decoded = yield* decodeClient(host, run)
          if (decoded.runId === null)
            return yield* Effect.fail<RunningHostError>({
              _tag: "InvalidRequest",
              fieldPath: "/run",
              code: "RunRequired"
            })
          yield* presentEnvelope(
            yield* callRunningHost(decoded.address, decoded.runId, {
              _tag: name === "snapshot" ? "ReadSnapshot" : "ReadRunControl"
            })
          )
        }).pipe(
          Effect.catch((error) =>
            error instanceof DalphCommandExit
              ? Effect.fail(error)
              : presentEnvelope(runningHostFailureEnvelope(null, error))
          ),
          Effect.provide(outputLayer)
        )
    )
  const attach = Command.make("attach").pipe(
    Command.withSubcommands([descriptor, passive("snapshot"), passive("control")])
  )
  const mcp = Command.make("mcp", { host: Flag.string("host"), run: Flag.string("run") }, ({ host, run }) =>
    Effect.gen(function* () {
      const decoded = yield* decodeClient(host, run)
      if (decoded.runId === null)
        return yield* Effect.fail<RunningHostError>({ _tag: "InvalidRequest", fieldPath: "/run", code: "RunRequired" })
      yield* runRunningHostMcp(decoded.address, decoded.runId)
    }).pipe(
      Effect.catch((error) =>
        writeLine(JSON.stringify(error), "stderr").pipe(
          Effect.andThen(new DalphCommandExit({ status: exitFor(error) }))
        )
      ),
      Effect.provide(outputLayer)
    )
  )
  return [host, attach, mcp]
}
