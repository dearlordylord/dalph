import { makeRunningHostBaseRetryCommand } from "./running-host-cli-base-retry.js"
import { makeRunningHostGuidanceCommand } from "./running-host-cli-guidance.js"
import { ApplyResultRecoveryRequest, ResultRecoveryRequestId } from "@dalph/orchestrator"
/* eslint-disable import/no-nodejs-modules -- This command owns only client stdout/stderr completion. */
import type { Layer } from "effect"
import { Effect, FileSystem, Schema, Stream } from "effect"
import { Argument, Command, Flag } from "effect/unstable/cli"
import type { ProductionRepositoryHostConfiguration } from "./production-configuration.js"
import type { ProductionRunningHostObservation } from "./production-host.js"
import { decodeRunInvocation, loadProductionConfiguration } from "./production-cli.js"
import { installApplicationExitSignalAdapter, type ApplicationExitSignalBoundary } from "./supervisor-exit.js"
import {
  RunningHostCapacityArguments,
  LocalHostAddress,
  RefreshInterest,
  type RunningHostError,
  runningHostFailureEnvelope,
  encodeRunningHostWatchFrame,
  RequestId,
  SubscriptionId,
  type RunningHostWatchFrame,
  WatchSequence,
  watchFrameEnds
} from "./running-host-contract.js"
import { watchRunningHost } from "./running-host-watch-client.js"
import { makeRunningHostWatchStage } from "./running-host-watch-stage.js"
import { callRunningHost, readRunningHostDescriptor } from "./running-host-client.js"
import { serveRunningHost } from "./running-host-http.js"
import { runRunningHostMcp } from "./running-host-mcp.js"
import { DalphCommandExit, requestFailureExitStatus, transportFailureExitStatus } from "./command-exit.js"

import {
  type RunningHostCliOutput,
  runningHostCliStdioLayer,
  writeLine,
  exitFor,
  presentEnvelope,
  decodeClient
} from "./running-host-cli-output.js"
export type ProductionListeningHostRunner<E, R> = <EUse>(
  configuration: ProductionRepositoryHostConfiguration,
  use: (observation: ProductionRunningHostObservation<E>) => Effect.Effect<void, EUse>
) => Effect.Effect<void, E | EUse, R>

export { RunningHostCliOutput, runningHostCliStdioLayer } from "./running-host-cli-output.js"

/** Attached reads and explicit wake/Unpause reuse the separately acquired host. */
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
  const attached = (name: "snapshot" | "control" | "capacity" | "start" | "unpause" | "resume") =>
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
              _tag:
                name === "snapshot"
                  ? "ReadSnapshot"
                  : name === "control"
                    ? "ReadRunControl"
                    : name === "capacity"
                      ? "ReadCapacity"
                      : name === "start"
                        ? "StartWork"
                        : "Unpause"
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
  const guide = makeRunningHostGuidanceCommand(outputLayer)
  const setCapacity = Command.make(
    "set-capacity",
    {
      host: Flag.string("host"),
      run: Flag.string("run"),
      json: Flag.boolean("json"),
      capacity: Flag.string("capacity"),
      expectedRevision: Flag.string("expected-revision")
    },
    ({ capacity, expectedRevision, host, json, run }) =>
      Effect.gen(function* () {
        if (!json)
          return yield* Effect.fail<RunningHostError>({
            _tag: "InvalidRequest",
            fieldPath: "/json",
            code: "JsonRequired"
          })
        const operation = yield* Schema.decodeUnknownEffect(RunningHostCapacityArguments)({
          capacity: Number(capacity),
          expectedRevision: Number(expectedRevision)
        }).pipe(
          Effect.mapError(
            (): RunningHostError => ({ _tag: "InvalidRequest", fieldPath: "/operation", code: "RequestSchemaInvalid" })
          )
        )
        const decoded = yield* decodeClient(host, run)
        if (decoded.runId === null)
          return yield* Effect.fail<RunningHostError>({
            _tag: "InvalidRequest",
            fieldPath: "/run",
            code: "RunRequired"
          })
        yield* presentEnvelope(
          yield* callRunningHost(decoded.address, decoded.runId, { _tag: "SetCapacity", ...operation })
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
  const refresh = Command.make(
    "refresh",
    {
      host: Flag.string("host"),
      run: Flag.string("run"),
      json: Flag.boolean("json"),
      wholeGraph: Flag.boolean("whole-graph"),
      tasks: Flag.string("task").pipe(Flag.atLeast(0))
    },
    ({ host, json, run, tasks, wholeGraph }) =>
      Effect.gen(function* () {
        if (!json)
          return yield* Effect.fail<RunningHostError>({
            _tag: "InvalidRequest",
            fieldPath: "/json",
            code: "JsonRequired"
          })
        if (wholeGraph === tasks.length > 0)
          return yield* Effect.fail<RunningHostError>({
            _tag: "InvalidRequest",
            fieldPath: "/interest",
            code: "RefreshInterestRequired"
          })
        const interest = yield* Schema.decodeUnknownEffect(RefreshInterest)(
          wholeGraph ? { _tag: "WholeGraph" } : { _tag: "AdvisoryTasks", taskIds: tasks },
          { onExcessProperty: "error" }
        ).pipe(
          Effect.mapError(
            (): RunningHostError => ({ _tag: "InvalidRequest", fieldPath: "/interest", code: "RequestSchemaInvalid" })
          )
        )
        const decoded = yield* decodeClient(host, run)
        if (decoded.runId === null)
          return yield* Effect.fail<RunningHostError>({
            _tag: "InvalidRequest",
            fieldPath: "/run",
            code: "RunRequired"
          })
        yield* presentEnvelope(yield* callRunningHost(decoded.address, decoded.runId, { _tag: "Refresh", interest }))
      }).pipe(
        Effect.catch((error) =>
          error instanceof DalphCommandExit
            ? Effect.fail(error)
            : presentEnvelope(runningHostFailureEnvelope(null, error))
        ),
        Effect.provide(outputLayer)
      )
  )
  const resultRecovery = (mode: "apply" | "read") =>
    Command.make(
      `recovery-${mode}`,
      {
        host: Flag.string("host"),
        run: Flag.string("run"),
        json: Flag.boolean("json"),
        requestFile: Flag.string("request-file")
      },
      ({ host, json, requestFile, run }) =>
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
          const fs = yield* FileSystem.FileSystem
          const input = yield* fs
            .readFileString(requestFile)
            .pipe(
              Effect.mapError(
                (): RunningHostError => ({
                  _tag: "InvalidRequest",
                  fieldPath: "/request-file",
                  code: "RecoveryRequestFileUnreadable"
                })
              )
            )
          const operation =
            mode === "apply"
              ? {
                  _tag: "ApplyResultRecoveryDirection" as const,
                  recovery: yield* Schema.decodeUnknownEffect(Schema.fromJsonString(ApplyResultRecoveryRequest))(
                    input,
                    { onExcessProperty: "error" }
                  ).pipe(
                    Effect.mapError(
                      (): RunningHostError => ({
                        _tag: "InvalidRequest",
                        fieldPath: "/request-file",
                        code: "RecoveryRequestInvalid"
                      })
                    )
                  )
                }
              : {
                  _tag: "ReadResultRecoveryDirection" as const,
                  recoveryRequestId: yield* Schema.decodeUnknownEffect(Schema.fromJsonString(ResultRecoveryRequestId))(
                    input,
                    { onExcessProperty: "error" }
                  ).pipe(
                    Effect.mapError(
                      (): RunningHostError => ({
                        _tag: "InvalidRequest",
                        fieldPath: "/request-file",
                        code: "RecoveryRequestInvalid"
                      })
                    )
                  )
                }
          yield* presentEnvelope(yield* callRunningHost(decoded.address, decoded.runId, operation))
        }).pipe(
          Effect.catch((error) =>
            error instanceof DalphCommandExit
              ? Effect.fail(error)
              : presentEnvelope(runningHostFailureEnvelope(null, error))
          ),
          Effect.provide(outputLayer)
        )
    )
  const retryBase = makeRunningHostBaseRetryCommand(outputLayer)
  const attach = Command.make("attach").pipe(
    Command.withSubcommands([
      guide,
      retryBase,
      setCapacity,
      resultRecovery("apply"),
      resultRecovery("read"),
      Command.make(
        "watch",
        { host: Flag.string("host"), run: Flag.string("run"), json: Flag.boolean("json") },
        ({ host, json, run }) =>
          Effect.scoped(
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
              const watchRunId = decoded.runId
              let correlation = {
                requestId: RequestId.make("client-watch"),
                subscriptionId: SubscriptionId.make("client-watch")
              }
              const stage = yield* makeRunningHostWatchStage(
                watchRunningHost(decoded.address, watchRunId).pipe(
                  Stream.tap((frame) =>
                    Effect.sync(() => {
                      correlation = { requestId: frame.requestId, subscriptionId: frame.subscriptionId }
                    })
                  )
                ),
                watchFrameEnds,
                (error): RunningHostWatchFrame => ({
                  protocolVersion: 1,
                  ...correlation,
                  runId: watchRunId,
                  sequence: WatchSequence.make(0),
                  frame: { _tag: "Failure", error }
                })
              )
              let value = yield* stage.takeInitial
              let sequence = 0
              for (;;) {
                yield* encodeRunningHostWatchFrame({ ...value, sequence: WatchSequence.make(sequence) }).pipe(
                  Effect.flatMap((text) => writeLine(text))
                )
                if (value.frame._tag === "Failure")
                  return yield* new DalphCommandExit({ status: exitFor(value.frame.error) })
                if (value.frame.value._tag === "Closed") return
                sequence += 1
                value = yield* stage.take
              }
            })
          ).pipe(
            Effect.catch((error) =>
              error instanceof DalphCommandExit
                ? Effect.fail(error)
                : presentEnvelope(runningHostFailureEnvelope(null, error))
            ),
            Effect.provide(outputLayer)
          )
      ),
      descriptor,
      refresh,
      attached("snapshot"),
      attached("control"),
      attached("capacity"),
      attached("start"),
      attached("unpause"),
      attached("resume")
    ])
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
