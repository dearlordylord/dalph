import { RunId } from "@dalph/contracts"
import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import {
  encodeRunningHostWatchFrame,
  RequestId,
  SubscriptionId,
  WatchSequence,
  runningHostLimits,
  type RunningHostWatchFrame
} from "./running-host-contract.js"

it.effect("Both adapters accept the exact shared watch byte ceiling and reject the next byte without truncation", () =>
  Effect.gen(function* () {
    const runId = RunId.make("R")
    const base: RunningHostWatchFrame = {
      protocolVersion: 1,
      requestId: RequestId.make("x"),
      runId,
      subscriptionId: SubscriptionId.make("watch"),
      sequence: WatchSequence.make(0),
      frame: { _tag: "Snapshot", value: { _tag: "NotReady", runId } }
    }
    const overhead = new TextEncoder().encode(JSON.stringify(base)).byteLength
    const exact = { ...base, requestId: RequestId.make("x".repeat(runningHostLimits.resultBytes - overhead + 1)) }
    const encoded = yield* encodeRunningHostWatchFrame(exact)
    expect(new TextEncoder().encode(encoded).byteLength).toBe(2097152)
    expect(JSON.parse(encoded)).toEqual(exact)
    expect(
      yield* encodeRunningHostWatchFrame({ ...exact, requestId: RequestId.make(`${exact.requestId}x`) }).pipe(
        Effect.flip
      )
    ).toEqual({ _tag: "FrameTooLarge", direction: "Outgoing", maximumBytes: 2097152, measuredBytes: 2097153 })
  })
)
