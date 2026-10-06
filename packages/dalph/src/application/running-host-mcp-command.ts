import {
  ApplyTaskAttemptBaseRetryRequest,
  ApplyResultRecoveryRequest,
  ResultRecoveryRequestId
} from "@dalph/orchestrator"
import { ExecutorGuidanceRequestId, RunId } from "@dalph/contracts"
import { NodeCrypto } from "@effect/platform-node"
import { Crypto, Effect, Encoding, Schema } from "effect"
import { RefreshInterest, type RunningHostRequest } from "./running-host-contract.js"
import { CapacityToolArguments, ExecutorGuidanceToolArguments } from "./running-host-mcp-tools.js"

/** The client builds one deliberate command; provider identifiers stay inside the host. */
export const makeRunningHostMcpOperation = Effect.fn("RunningHostMcp.operation")(function* (
  name: string,
  input: unknown
) {
  if (name === "dalph_set_capacity") {
    const args = yield* Schema.decodeUnknownEffect(CapacityToolArguments)(input, { onExcessProperty: "error" })
    return { _tag: "SetCapacity" as const, capacity: args.capacity, expectedRevision: args.expectedRevision }
  }
  if (name === "dalph_guide_executor") {
    const guidance = yield* Schema.decodeUnknownEffect(ExecutorGuidanceToolArguments)(input, {
      onExcessProperty: "error"
    })
    const identity =
      guidance.guidanceRequestId ??
      (yield* Effect.gen(function* () {
        const crypto = yield* Crypto.Crypto
        return yield* crypto.randomUUIDv4
      }).pipe(Effect.provide(NodeCrypto.layer)))
    return {
      _tag: "SendExecutorGuidance" as const,
      attemptId: guidance.attemptId,
      guidanceRequestId: ExecutorGuidanceRequestId.make(identity),
      textBase64: Encoding.encodeBase64(new TextEncoder().encode(guidance.message))
    }
  }
  if (name === "dalph_retry_task_attempt_base") {
    const args = yield* Schema.decodeUnknownEffect(
      Schema.Struct({ runId: RunId, retry: ApplyTaskAttemptBaseRetryRequest })
    )(input, { onExcessProperty: "error" })
    return { _tag: "RetryTaskAttemptBase" as const, retry: args.retry }
  }
  if (name === "dalph_apply_result_recovery") {
    const args = yield* Schema.decodeUnknownEffect(
      Schema.Struct({ runId: RunId, recovery: ApplyResultRecoveryRequest })
    )(input)
    return { _tag: "ApplyResultRecoveryDirection" as const, recovery: args.recovery }
  }
  if (name === "dalph_read_result_recovery") {
    const args = yield* Schema.decodeUnknownEffect(
      Schema.Struct({ runId: RunId, recoveryRequestId: ResultRecoveryRequestId })
    )(input)
    return { _tag: "ReadResultRecoveryDirection" as const, recoveryRequestId: args.recoveryRequestId }
  }
  if (name === "dalph_refresh") {
    const args = yield* Schema.decodeUnknownEffect(Schema.Struct({ runId: RunId, interest: RefreshInterest }))(input)
    return { _tag: "Refresh" as const, interest: args.interest }
  }
  const operations: Readonly<Record<string, RunningHostRequest["operation"]>> = {
    dalph_read_snapshot: { _tag: "ReadSnapshot" },
    dalph_read_run_control: { _tag: "ReadRunControl" },
    dalph_read_capacity: { _tag: "ReadCapacity" },
    dalph_start_work: { _tag: "StartWork" },
    dalph_unpause: { _tag: "Unpause" }
  }
  return operations[name] ?? null
})
