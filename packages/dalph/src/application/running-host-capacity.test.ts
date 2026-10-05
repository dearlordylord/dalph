import { RunId } from "@dalph/contracts"
import {
  JournaledRunNotActive,
  JournalPosition,
  TraceCursor,
  RunPolicyRevision,
  TaskWorkCapacity
} from "@dalph/orchestrator"
import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import { makeRunningHostCapacity } from "./running-host-capacity.js"
import { HostInstanceId, RequestId, type RunningHostCommandRequest } from "./running-host-contract.js"
import type { ProductionPassiveRunControl } from "./production-host.js"

const runId = RunId.make("capacity-race")
const cursor = TraceCursor.make({ runId, position: JournalPosition.make(3) })
const controls = {
  readTaskWorkCapacity: () => Effect.fail(new JournaledRunNotActive()),
  setTaskWorkCapacity: () => Effect.fail(new JournaledRunNotActive())
}
const request: RunningHostCommandRequest & {
  operation: { _tag: "SetCapacity"; capacity: TaskWorkCapacity; expectedRevision: RunPolicyRevision }
} = {
  protocolVersion: 1,
  hostInstanceId: HostInstanceId.make("capacity-host"),
  requestId: RequestId.make("capacity-request"),
  runId,
  operation: { _tag: "SetCapacity", capacity: TaskWorkCapacity.make(2), expectedRevision: RunPolicyRevision.make(1) }
}
for (const terminal of [false, true])
  it.effect(
    `capacity lease loss preserves ${terminal ? "established terminal evidence" : "the concrete inactive race"}`,
    () =>
      Effect.gen(function* () {
        const termination = terminal ? { disposition: "Completed" as const, terminatedAt: cursor } : null
        const readRunControl = Effect.succeed<ProductionPassiveRunControl>({
          direction: terminal ? "RunTerminated" : "RunUnpaused",
          observedAt: cursor,
          termination
        })
        const boundary = makeRunningHostCapacity(runId, controls, readRunControl)
        expect(yield* boundary.read.pipe(Effect.flip)).toEqual(
          terminal
            ? { _tag: "RunClosed", runId, ...termination }
            : { _tag: "RunInactive", runId, operation: "ReadCapacity" }
        )
        expect(yield* boundary.set(request).pipe(Effect.flip)).toEqual(
          terminal
            ? { _tag: "RunClosed", runId, ...termination }
            : { _tag: "RunInactive", runId, operation: "SetCapacity" }
        )
      })
  )
it.effect("capacity lease loss preserves a failed terminal recheck without inventing inactive evidence", () =>
  Effect.gen(function* () {
    const boundary = makeRunningHostCapacity(runId, controls, Effect.fail({ _tag: "JournalReadFailed" }))
    expect(yield* boundary.read.pipe(Effect.flip)).toMatchObject({
      _tag: "ReadFailed",
      causeTag: "RunControlUnavailable"
    })
    expect(yield* boundary.set(request).pipe(Effect.flip)).toMatchObject({
      _tag: "CommandFailed",
      operation: "SetCapacity",
      stage: "BeforeApplication",
      causeTag: "RunControlUnavailable"
    })
  })
)
