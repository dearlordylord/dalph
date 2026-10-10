import { Effect, type Layer } from "effect"
import { Command, Flag } from "effect/unstable/cli"
import { DalphCommandExit } from "./command-exit.js"
import { callRunningHost } from "./running-host-client.js"
import { runningHostFailureEnvelope, type RunningHostError } from "./running-host-contract.js"
import {
  decodeClient,
  presentCompactEnvelope,
  presentEnvelope,
  type RunningHostCliOutput
} from "./running-host-cli-output.js"

/** Attached reads and explicit wake commands share the existing host protocol. */
export const makeRunningHostAttachedCommand = (
  name: "owners" | "snapshot" | "control" | "capacity" | "start" | "unpause" | "resume" | "pause" | "cancel",
  outputLayer: Layer.Layer<RunningHostCliOutput>
) =>
  Command.make(
    name,
    {
      host: Flag.string("host"),
      run: Flag.string("run"),
      json: Flag.boolean("json"),
      compact: Flag.boolean("compact")
    },
    ({ compact, host, json, run }) =>
      Effect.gen(function* () {
        if (!json)
          return yield* Effect.fail<RunningHostError>({
            _tag: "InvalidRequest",
            fieldPath: "/json",
            code: "JsonRequired"
          })
        if (compact && name !== "snapshot")
          return yield* Effect.fail<RunningHostError>({
            _tag: "InvalidRequest",
            fieldPath: "/compact",
            code: "CompactSnapshotRequired"
          })
        const decoded = yield* decodeClient(host, run)
        if (decoded.runId === null)
          return yield* Effect.fail<RunningHostError>({
            _tag: "InvalidRequest",
            fieldPath: "/run",
            code: "RunRequired"
          })
        const envelope = yield* callRunningHost(decoded.address, decoded.runId, {
          _tag:
            name === "owners"
              ? "ReadExitOwners"
              : name === "snapshot"
                ? "ReadSnapshot"
                : name === "control"
                  ? "ReadRunControl"
                  : name === "capacity"
                    ? "ReadCapacity"
                    : name === "start"
                      ? "StartWork"
                      : name === "pause"
                        ? "Pause"
                        : name === "cancel"
                          ? "Cancel"
                          : "Unpause"
        })
        yield* (compact ? presentCompactEnvelope : presentEnvelope)(envelope)
      }).pipe(
        Effect.catch((error) =>
          error instanceof DalphCommandExit
            ? Effect.fail(error)
            : (compact ? presentCompactEnvelope : presentEnvelope)(runningHostFailureEnvelope(null, error))
        ),
        Effect.provide(outputLayer)
      )
  )
