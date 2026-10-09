import { AttemptId, ExecutorGuidanceRequestId, RunId } from "@dalph/contracts"
import {
  FixtureTarget,
  ControlDirectionApplicationOrdinal,
  TraceCursor,
  JournalPosition,
  RunControlPolicy,
  RunPolicyRevision,
  TaskWorkCapacity
} from "@dalph/orchestrator"
import { it } from "@effect/vitest"
import { Deferred, Effect, Encoding, Fiber, Queue, Ref, Result, Schema, Stream } from "effect"
import { TestClock } from "effect/testing"
import { expect } from "vitest"
import {
  HostInstanceId,
  LocalHostAddress,
  RequestId,
  SubscriptionId,
  WatchSequence,
  RunningHostDescriptor,
  runningHostLimits,
  runningHostSuccessEnvelope,
  runningHostFailureEnvelope,
  type RunningHostError
} from "./running-host-contract.js"
import { runRunningHostMcp, type RunningHostMcpClient } from "./running-host-mcp.js"

const address = LocalHostAddress.make("http://127.0.0.1:43127")
const runId = RunId.make("R")
const descriptor = RunningHostDescriptor.make({
  protocolVersion: 1,
  hostInstanceId: HostInstanceId.make("host"),
  selectedRun: { runId, target: FixtureTarget.make("fixture") },
  limits: runningHostLimits
})
const init = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } }
}

it.live("MCP cancellation stops only the accepted command waiter and keeps processing requests", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const input = yield* Queue.unbounded<Uint8Array>()
      const entered = yield* Deferred.make<void>()
      const cancelled = yield* Deferred.make<void>()
      const ping = yield* Deferred.make<void>()
      const calls = yield* Ref.make(0)
      const bridge = yield* runRunningHostMcp(
        address,
        runId,
        {
          input: Stream.fromQueue(input),
          write: (line) =>
            line.includes('"id":3') ? Deferred.succeed(ping, undefined).pipe(Effect.asVoid) : Effect.void
        },
        {
          descriptor: () => Effect.succeed(descriptor),
          call: () =>
            Ref.update(calls, (count) => count + 1).pipe(
              Effect.andThen(Deferred.succeed(entered, undefined)),
              Effect.andThen(Effect.never),
              Effect.ensuring(Deferred.succeed(cancelled, undefined))
            )
        }
      ).pipe(Effect.forkScoped)
      const send = (...messages: ReadonlyArray<unknown>) =>
        Queue.offer(
          input,
          new TextEncoder().encode(messages.map((message) => JSON.stringify(message)).join("\n") + "\n")
        )
      yield* send(
        init,
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "dalph_unpause", arguments: { runId } } }
      )
      yield* Deferred.await(entered).pipe(Effect.timeout("1 second"))
      yield* send(
        { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 2 } },
        { jsonrpc: "2.0", id: 3, method: "ping" }
      )
      yield* Deferred.await(cancelled).pipe(Effect.timeout("1 second"))
      yield* Deferred.await(ping).pipe(Effect.timeout("1 second"))
      expect(yield* Ref.get(calls)).toBe(1)
      yield* Fiber.interrupt(bridge)
    })
  )
)

it.effect("MCP exposes reads and explicit wake and Unpause with shared results", () =>
  Effect.gen(function* () {
    const calls: Array<string> = []
    const output: Array<string> = []
    const client: RunningHostMcpClient = {
      descriptor: () => Effect.succeed(descriptor),
      call: (_address, selected, operation) =>
        Effect.sync(() => {
          calls.push(operation._tag)
          return runningHostSuccessEnvelope(
            {
              protocolVersion: 1,
              hostInstanceId: descriptor.hostInstanceId,
              requestId: RequestId.make("req"),
              runId: selected,
              operation
            },
            operation._tag === "ReadCapacity" || operation._tag === "SetCapacity"
              ? {
                  _tag: operation._tag === "ReadCapacity" ? "CapacityRead" : "CapacityApplied",
                  policy: RunControlPolicy.make({
                    revision: RunPolicyRevision.make(operation._tag === "ReadCapacity" ? 1 : 2),
                    taskExecutionCapacity: TaskWorkCapacity.make(operation._tag === "ReadCapacity" ? 1 : 2)
                  })
                }
              : operation._tag === "StartWork"
                ? { _tag: "WakeSubmitted" }
                : operation._tag === "Unpause"
                  ? {
                      _tag: "UnpauseApplied",
                      ordinal: ControlDirectionApplicationOrdinal.make(2),
                      acceptedAt: TraceCursor.make({ runId: selected, position: JournalPosition.make(3) })
                    }
                  : { _tag: "NotReady", runId: selected }
          )
        })
    }
    const messages = [
      init,
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
      { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "dalph_read_snapshot", arguments: { runId } } },
      { jsonrpc: "2.0", id: 4, method: "resources/read", params: { uri: "dalph://runs/R/snapshot" } },
      { jsonrpc: "2.0", id: 5, method: "resources/subscribe", params: { uri: "dalph://runs/R/snapshot" } },
      { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "dalph_start_work", arguments: { runId } } },
      { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "dalph_unpause", arguments: { runId } } },
      { jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "dalph_read_capacity", arguments: { runId } } },
      {
        jsonrpc: "2.0",
        id: 9,
        method: "tools/call",
        params: { name: "dalph_set_capacity", arguments: { runId, capacity: 2, expectedRevision: 1 } }
      }
    ]
    const encoded = new TextEncoder().encode(messages.map((message) => JSON.stringify(message)).join("\n") + "\n")
    yield* runRunningHostMcp(
      address,
      runId,
      {
        input: Stream.make(encoded.subarray(0, 19), encoded.subarray(19)),
        write: (line) =>
          Effect.sync(() => {
            output.push(line)
          })
      },
      client
    )
    const replies = output.map((line) => JSON.parse(line))
    expect(replies[0].result).toMatchObject({
      protocolVersion: "2025-11-25",
      capabilities: { tools: {}, resources: {} }
    })
    expect(replies[1].result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      "dalph_retry_task_attempt_base",
      "dalph_read_capacity",
      "dalph_set_capacity",
      "dalph_guide_executor",
      "dalph_apply_result_recovery",
      "dalph_read_result_recovery",
      "dalph_refresh",
      "dalph_watch_snapshots",
      "dalph_close_watch",
      "dalph_read_snapshot",
      "dalph_read_run_control",
      "dalph_start_work",
      "dalph_pause",
      "dalph_cancel",
      "dalph_unpause"
    ])
    expect(replies[1].result.tools[0].outputSchema.type).toBe("object")
    expect(replies[2].result.structuredContent).toEqual(JSON.parse(replies[2].result.content[0].text))
    expect(replies[2].result.structuredContent).toEqual(JSON.parse(replies[3].result.contents[0].text))
    expect(replies[4].error.code).toBe(-32002)
    expect(replies.find(({ id }) => id === 6).result.structuredContent.result.value).toEqual({ _tag: "WakeSubmitted" })
    expect(replies.find(({ id }) => id === 7).result.structuredContent.result.value).toMatchObject({
      _tag: "UnpauseApplied",
      ordinal: 2,
      acceptedAt: { runId, position: 3 }
    })
    expect(replies.find(({ id }) => id === 8).result.structuredContent.result.value).toMatchObject({
      _tag: "CapacityRead",
      policy: { revision: 1, taskExecutionCapacity: 1 }
    })
    expect(replies.find(({ id }) => id === 9).result.structuredContent.result.value).toMatchObject({
      _tag: "CapacityApplied",
      policy: { revision: 2, taskExecutionCapacity: 2 }
    })
    expect(calls).toEqual(["ReadSnapshot", "ReadSnapshot", "StartWork", "Unpause", "ReadCapacity", "SetCapacity"])
  })
)

it.effect("MCP rejects incompatible versions, extra tool arguments and wrong Runs without host operation calls", () =>
  Effect.gen(function* () {
    let calls = 0
    const output: Array<string> = []
    const client: RunningHostMcpClient = {
      descriptor: () => Effect.succeed(descriptor),
      call: () =>
        Effect.sync(() => {
          calls += 1
          throw new Error("must not dispatch")
        })
    }
    const messages = [
      { ...init, params: { ...init.params, protocolVersion: "unsupported" } },
      init,
      { jsonrpc: "2.0", method: "notifications/initialized" },
      {
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "dalph_read_snapshot", arguments: { runId, root: "other" } }
      },
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "dalph_read_snapshot", arguments: { runId: "X" } }
      },
      ...["dalph_start_work", "dalph_unpause"].flatMap((name, index) => [
        {
          jsonrpc: "2.0",
          id: 4 + index * 2,
          method: "tools/call",
          params: { name, arguments: { runId, root: "other" } }
        },
        { jsonrpc: "2.0", id: 5 + index * 2, method: "tools/call", params: { name, arguments: { runId: "X" } } }
      ])
    ]
    yield* runRunningHostMcp(
      address,
      runId,
      {
        input: Stream.make(
          new TextEncoder().encode(messages.map((message) => JSON.stringify(message)).join("\n") + "\n")
        ),
        write: (line) =>
          Effect.sync(() => {
            output.push(line)
          })
      },
      client
    )
    const replies = output.map((line) => JSON.parse(line))
    expect(replies[0].error.code).toBe(-32602)
    expect(replies[2].error.code).toBe(-32602)
    expect(replies[3].result).toMatchObject({
      isError: true,
      structuredContent: { result: { _tag: "Failure", error: { _tag: "RunMismatch" } } }
    })
    for (const id of [4, 6]) expect(replies.find((reply) => reply.id === id).error.code).toBe(-32602)
    for (const id of [5, 7])
      expect(replies.find((reply) => reply.id === id).result.structuredContent.result.error._tag).toBe("RunMismatch")
    expect(calls).toBe(0)
  })
)

it.effect("MCP input limits and truncated framing never dispatch a host operation", () =>
  Effect.gen(function* () {
    let calls = 0
    const client: RunningHostMcpClient = {
      descriptor: () =>
        Effect.sync(() => {
          calls += 1
          return descriptor
        }),
      call: () => Effect.die("must not dispatch")
    }
    const run = (bytes: Uint8Array) =>
      runRunningHostMcp(address, runId, { input: Stream.make(bytes), write: () => Effect.void }, client).pipe(
        Effect.flip
      )
    expect(yield* run(new Uint8Array(runningHostLimits.requestBytes + 1).fill(32))).toMatchObject({
      _tag: "FrameTooLarge",
      direction: "Incoming"
    })
    expect(yield* run(new TextEncoder().encode(JSON.stringify(init)))).toMatchObject({
      _tag: "TransportFailed",
      phase: "Response"
    })
    expect(yield* run(new Uint8Array([255, 10]))).toMatchObject({ _tag: "InvalidRequest", code: "InvalidUtf8" })
    expect(calls).toBe(0)
  })
)

it.effect("MCP preserves every shared passive failure through both read tools and resources", () =>
  Effect.gen(function* () {
    const requestId = RequestId.make("req")
    const errors: ReadonlyArray<RunningHostError> = [
      { _tag: "InvalidRequest", fieldPath: "operation", code: "Invalid" },
      { _tag: "RunMismatch", requestedRunId: RunId.make("other"), selectedRunId: runId },
      {
        _tag: "HostInstanceMismatch",
        requestedHostInstanceId: HostInstanceId.make("old"),
        actualHostInstanceId: descriptor.hostInstanceId
      },
      { _tag: "HostUnavailable", address, reason: "NoListener" },
      { _tag: "ProtocolVersionUnsupported", requestedVersion: 2, supportedVersions: [1] },
      { _tag: "HostClosing", hostInstanceId: descriptor.hostInstanceId, cutoff: "AdmissionClosed" },
      { _tag: "ReadFailed", causeTag: "JournalRead", detail: "unavailable" },
      { _tag: "ProjectionFailed", causeTag: "Projection", detail: "invalid" },
      {
        _tag: "FrameTooLarge",
        direction: "Outgoing",
        maximumBytes: runningHostLimits.resultBytes,
        measuredBytes: runningHostLimits.resultBytes + 1
      },
      {
        _tag: "WriteTimedOut",
        subject: { _tag: "Request", requestId },
        deadlineMillis: runningHostLimits.writeDeadlineMillis
      },
      { _tag: "TransportFailed", phase: "Response", reason: "ConnectionLost" }
    ]
    for (const error of errors) {
      const expected = runningHostFailureEnvelope({ requestId, runId }, error)
      const output: Array<string> = []
      const messages = [
        init,
        { jsonrpc: "2.0", method: "notifications/initialized" },
        ...["snapshot", "run_control"].flatMap((name, index) => [
          {
            jsonrpc: "2.0",
            id: index * 2 + 2,
            method: "tools/call",
            params: { name: `dalph_read_${name}`, arguments: { runId } }
          },
          {
            jsonrpc: "2.0",
            id: index * 2 + 3,
            method: "resources/read",
            params: { uri: `dalph://runs/R/${name === "snapshot" ? "snapshot" : "control"}` }
          }
        ])
      ]
      yield* runRunningHostMcp(
        address,
        runId,
        {
          input: Stream.make(
            new TextEncoder().encode(messages.map((message) => JSON.stringify(message)).join("\n") + "\n")
          ),
          write: (line) =>
            Effect.sync(() => {
              output.push(line)
            })
        },
        { descriptor: () => Effect.succeed(descriptor), call: () => Effect.succeed(expected) }
      )
      const replies = output.slice(1).map((line) => JSON.parse(line))
      expect(replies[0].result).toMatchObject({ isError: true, structuredContent: expected })
      expect(JSON.parse(replies[1].result.contents[0].text)).toEqual(expected)
      expect(replies[2].result).toMatchObject({ isError: true, structuredContent: expected })
      expect(JSON.parse(replies[3].result.contents[0].text)).toEqual(expected)
    }
  })
)

it.effect("MCP rejects non-finite JSON-RPC identities before touching the host", () =>
  Effect.gen(function* () {
    const output: Array<string> = []
    yield* runRunningHostMcp(
      address,
      runId,
      {
        input: Stream.make(new TextEncoder().encode('{"jsonrpc":"2.0","id":1e309,"method":"initialize"}\n')),
        write: (line) =>
          Effect.sync(() => {
            output.push(line)
          })
      },
      {
        descriptor: () => Effect.die("invalid identity must not dispatch"),
        call: () => Effect.die("must not dispatch")
      }
    )
    expect(JSON.parse(output[0] ?? "")).toMatchObject({ id: null, error: { code: -32600 } })
  })
)

it.effect("MCP write deadline cancels the pending sink and returns typed failure", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>()
    const cancellations = yield* Ref.make(0)
    const fiber = yield* runRunningHostMcp(
      address,
      runId,
      {
        input: Stream.make(new TextEncoder().encode(JSON.stringify(init) + "\n")),
        write: () =>
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() => Ref.update(cancellations, (count) => count + 1))
          )
      },
      { descriptor: () => Effect.succeed(descriptor), call: () => Effect.die("initialize must not call") }
    ).pipe(Effect.flip, Effect.forkChild)
    yield* Deferred.await(started)
    yield* TestClock.adjust(runningHostLimits.writeDeadlineMillis)
    expect(yield* Fiber.join(fiber)).toEqual({
      _tag: "WriteTimedOut",
      subject: { _tag: "Request", requestId: "mcp-write-1" },
      deadlineMillis: runningHostLimits.writeDeadlineMillis
    })
    expect(yield* Ref.get(cancellations)).toBe(1)
  })
)

it.effect(
  "Blocked MCP notification stdout ends the bridge at its deadline and releases every session source with stdin open",
  () =>
    Effect.gen(function* () {
      const input = yield* Queue.unbounded<Uint8Array>()
      const replies = yield* Queue.unbounded<string>()
      const entered = yield* Deferred.make<void>()
      const acquired = yield* Ref.make(0)
      const released = yield* Ref.make(0)
      const frame = {
        protocolVersion: 1 as const,
        requestId: RequestId.make("host-request"),
        runId,
        subscriptionId: SubscriptionId.make("host-subscription"),
        sequence: WatchSequence.make(0),
        frame: { _tag: "Snapshot" as const, value: { _tag: "NotReady" as const, runId } }
      }
      const bridge = yield* runRunningHostMcp(
        address,
        runId,
        {
          input: Stream.fromQueue(input),
          write: (line) =>
            line.includes('"notifications/resources/updated"')
              ? Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never))
              : Queue.offer(replies, line).pipe(Effect.asVoid)
        },
        {
          descriptor: () => Effect.succeed(descriptor),
          call: () => Effect.die("watch cannot mutate"),
          watch: () =>
            Stream.unwrap(
              Ref.update(acquired, (n) => n + 1).pipe(Effect.as(Stream.concat(Stream.make(frame), Stream.never)))
            ).pipe(Stream.ensuring(Ref.update(released, (n) => n + 1)))
        }
      ).pipe(Effect.result, Effect.forkChild)
      const send = (message: unknown) => Queue.offer(input, new TextEncoder().encode(JSON.stringify(message) + "\n"))
      yield* send(init)
      yield* Queue.take(replies)
      yield* send({ jsonrpc: "2.0", method: "notifications/initialized" })
      for (const id of [2, 3]) {
        yield* send({
          jsonrpc: "2.0",
          id,
          method: "tools/call",
          params: { name: "dalph_watch_snapshots", arguments: { runId } }
        })
        yield* Queue.take(replies)
      }
      expect(yield* Ref.get(acquired)).toBe(2)
      yield* send({
        jsonrpc: "2.0",
        id: 4,
        method: "resources/subscribe",
        params: { uri: "dalph://runs/R/watches/mcp-watch-1" }
      })
      yield* Deferred.await(entered)
      yield* TestClock.adjust(runningHostLimits.writeDeadlineMillis - 1)
      expect(yield* Ref.get(released)).toBe(0)
      yield* TestClock.adjust(1)
      expect(yield* Fiber.join(bridge)).toMatchObject({ _tag: "Failure", failure: { _tag: "WriteTimedOut" } })
      expect(yield* Ref.get(released)).toBe(2)
      expect(yield* Queue.offer(input, new Uint8Array(0))).toBe(true)
    })
)

it.live("MCP generates guidance identity and sends exact UTF-8 text without provider identifiers", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const input = yield* Queue.unbounded<Uint8Array>()
      const completed = yield* Deferred.make<string>()
      const operations: Array<Parameters<RunningHostMcpClient["call"]>[2]> = []
      const message = "Проверь границу\n<turn_token>ordinary text</turn_token>"
      const bridge = yield* runRunningHostMcp(
        address,
        runId,
        {
          input: Stream.fromQueue(input),
          write: (line) =>
            line.includes('"id":2') ? Deferred.succeed(completed, line).pipe(Effect.asVoid) : Effect.void
        },
        {
          descriptor: () => Effect.succeed(descriptor),
          call: (_address, selected, operation) =>
            Effect.sync(() => {
              operations.push(operation)
              if (operation._tag !== "SendExecutorGuidance") throw new Error("Unexpected operation")
              return runningHostSuccessEnvelope(
                {
                  protocolVersion: 1,
                  hostInstanceId: descriptor.hostInstanceId,
                  requestId: RequestId.make("transport"),
                  runId: selected,
                  operation
                },
                {
                  _tag: "ExecutorGuidanceResult",
                  guidanceRequestId: operation.guidanceRequestId,
                  disposition: { _tag: "Accepted" }
                }
              )
            })
        }
      ).pipe(Effect.forkScoped)
      yield* Queue.offer(
        input,
        new TextEncoder().encode(
          [
            init,
            { jsonrpc: "2.0", method: "notifications/initialized" },
            {
              jsonrpc: "2.0",
              id: 2,
              method: "tools/call",
              params: { name: "dalph_guide_executor", arguments: { runId, attemptId: AttemptId.make("A"), message } }
            }
          ]
            .map((value) => JSON.stringify(value))
            .join("\n") + "\n"
        )
      )
      const response = JSON.parse(yield* Deferred.await(completed).pipe(Effect.timeout("2 seconds")))
      expect(operations).toHaveLength(1)
      const operation = operations[0]
      if (operation === undefined) return yield* Effect.die("guidance operation must be present")
      expect(operation._tag).toBe("SendExecutorGuidance")
      if (operation._tag !== "SendExecutorGuidance") return
      expect(Schema.is(ExecutorGuidanceRequestId)(operation.guidanceRequestId)).toBe(true)
      expect(operation.guidanceRequestId).toMatch(/^[0-9a-f-]{36}$/)
      expect(Result.getOrThrow(Encoding.decodeBase64String(operation.textBase64))).toBe(message)
      expect(response.result.structuredContent.result.value.guidanceRequestId).toBe(operation.guidanceRequestId)
      expect(Object.keys(operation).sort()).toEqual(["_tag", "attemptId", "guidanceRequestId", "textBase64"])
      yield* Fiber.interrupt(bridge)
    })
  )
)
