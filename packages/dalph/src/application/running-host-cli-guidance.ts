import { AttemptId, ExecutorGuidanceRequestId } from "@dalph/contracts"
import { NodeCrypto } from "@effect/platform-node"
import { Command, Flag } from "effect/unstable/cli"
import { Crypto, Effect, Encoding, Layer, Option, Schema } from "effect"
import { DalphCommandExit } from "./command-exit.js"
import type { RunningHostError } from "./running-host-contract.js"
import { runningHostFailureEnvelope } from "./running-host-contract.js"
import { callRunningHost } from "./running-host-client.js"
import { type RunningHostCliOutput, presentEnvelope, decodeClient } from "./running-host-cli-output.js"

/** Build the informational command separately from snapshot/watch presentation. */
export const makeRunningHostGuidanceCommand = (outputLayer: Layer.Layer<RunningHostCliOutput>) =>
  Command.make(
    "guide",
    {
      host: Flag.string("host"),
      run: Flag.string("run"),
      attempt: Flag.string("attempt"),
      message: Flag.string("message"),
      requestId: Flag.string("request-id").pipe(Flag.optional),
      json: Flag.boolean("json")
    },
    ({ attempt, host, json, message, requestId, run }) =>
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
        const crypto = yield* Crypto.Crypto
        const identity = Option.isSome(requestId)
          ? requestId.value
          : yield* crypto.randomUUIDv4.pipe(
              Effect.mapError(
                (): RunningHostError => ({
                  _tag: "InvalidRequest",
                  fieldPath: "/request-id",
                  code: "RequestIdentityUnavailable"
                })
              )
            )
        yield* presentEnvelope(
          yield* callRunningHost(decoded.address, decoded.runId, {
            _tag: "SendExecutorGuidance",
            attemptId: yield* Schema.decodeUnknownEffect(AttemptId)(attempt).pipe(
              Effect.mapError(
                (): RunningHostError => ({ _tag: "InvalidRequest", fieldPath: "/attempt", code: "AttemptInvalid" })
              )
            ),
            guidanceRequestId: yield* Schema.decodeUnknownEffect(ExecutorGuidanceRequestId)(identity).pipe(
              Effect.mapError(
                (): RunningHostError => ({
                  _tag: "InvalidRequest",
                  fieldPath: "/request-id",
                  code: "GuidanceRequestIdentityInvalid"
                })
              )
            ),
            textBase64: Encoding.encodeBase64(new TextEncoder().encode(message))
          })
        )
      }).pipe(
        Effect.catch((error) =>
          error instanceof DalphCommandExit
            ? Effect.fail(error)
            : presentEnvelope(runningHostFailureEnvelope(null, error))
        ),
        Effect.provide(Layer.merge(outputLayer, NodeCrypto.layer))
      )
  )
