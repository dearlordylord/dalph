import { ApplyTaskAttemptBaseRetryRequest } from "@dalph/orchestrator"
import { Effect, FileSystem, Schema, type Layer } from "effect"
import { Command, Flag } from "effect/unstable/cli"
import { type RunningHostError, runningHostFailureEnvelope } from "./running-host-contract.js"
import { callRunningHost } from "./running-host-client.js"
import { DalphCommandExit } from "./command-exit.js"
import { type RunningHostCliOutput, decodeClient, presentEnvelope } from "./running-host-cli-output.js"

/** An operator submits one exact retry identity through the separately acquired host. */
export const makeRunningHostBaseRetryCommand = (outputLayer: Layer.Layer<RunningHostCliOutput>) => {
  return Command.make(
    "retry-base",
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
                code: "BaseRetryRequestFileUnreadable"
              })
            )
          )
        const retry = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(ApplyTaskAttemptBaseRetryRequest))(
          input,
          { onExcessProperty: "error" }
        ).pipe(
          Effect.mapError(
            (): RunningHostError => ({
              _tag: "InvalidRequest",
              fieldPath: "/request-file",
              code: "BaseRetryRequestInvalid"
            })
          )
        )
        yield* presentEnvelope(
          yield* callRunningHost(decoded.address, decoded.runId, { _tag: "RetryTaskAttemptBase", retry })
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
}
