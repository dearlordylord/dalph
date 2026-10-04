/* eslint-disable import/no-nodejs-modules -- The MCP adapter owns its process-local byte streams. */
import process from "node:process"
import { Effect, Stream } from "effect"
import type { RunningHostError } from "./running-host-contract.js"
import type { RunningHostMcpPorts } from "./running-host-mcp.js"
import { runningHostNodeOutput } from "./running-host-output.js"
const transportFailure = (reason: string): RunningHostError => ({ _tag: "TransportFailed", phase: "Write", reason })
export const runningHostMcpStdioPorts: RunningHostMcpPorts = {
  input: Stream.fromAsyncIterable(process.stdin, () => ({
    _tag: "TransportFailed",
    phase: "Response",
    reason: "MCP input stream failed."
  })),
  write: (line) =>
    Effect.try({
      try: () => runningHostNodeOutput("stdout"),
      catch: () => transportFailure("MCP output descriptor is unavailable.")
    }).pipe(
      Effect.flatMap((destination) =>
        Effect.callback<void, RunningHostError>((resume) => {
          let settled = false
          const onError = () => {
            settled = true
            destination.destroy()
            resume(Effect.fail(transportFailure("MCP output stream failed.")))
          }
          destination.once("error", onError)
          destination.write(line, (error) => {
            settled = true
            destination.removeListener("error", onError)
            if (error) destination.destroy()
            resume(error ? Effect.fail(transportFailure("MCP output stream failed.")) : Effect.void)
          })
          return Effect.sync(() => {
            // A timed-out Effect must also cancel its queued Node write. Otherwise
            // pipe backpressure retains the client process after the deadline.
            if (!settled) destination.destroy()
            destination.removeListener("error", onError)
          })
        })
      )
    )
}
