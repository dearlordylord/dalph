import { NodeServices } from "@effect/platform-node"
import { RunId, TaskId } from "@dalph/contracts"
import { ApplyTaskAttemptBaseRetryRequest, FixtureTarget, JournalPosition, TraceCursor } from "@dalph/orchestrator"
import { it } from "@effect/vitest"
import { Effect, FileSystem, Layer, Ref, Schema, Stream } from "effect"
import { Command } from "effect/unstable/cli"
import { expect } from "vitest"
import { availableLocalHostAddress, makeRunningHostReadProbe } from "../../test-support/running-host-read-probe.js"
import { makeRunningHostCommands, RunningHostCliOutput } from "./running-host-cli.js"
import { callRunningHost } from "./running-host-client.js"
import {
  decodeRunningHostRequest,
  HostInstanceId,
  RunningHostDescriptor,
  runningHostLimits
} from "./running-host-contract.js"
import { serveRunningHost } from "./running-host-http.js"
import { runRunningHostMcp } from "./running-host-mcp.js"

const retryFor = (runId: RunId) =>
  Schema.decodeUnknownSync(ApplyTaskAttemptBaseRetryRequest)({
    requestId: "operator-retry-1",
    subject: { runId, taskId: TaskId.make("task"), refusedReadOperationId: "refused-read" }
  })

it.effect("binds the explicit Base retry to the selected Run and rejects extra input", () =>
  Effect.gen(function* () {
    const runId = RunId.make("R")
    const descriptor = RunningHostDescriptor.make({
      protocolVersion: 1,
      hostInstanceId: HostInstanceId.make("host"),
      selectedRun: { runId, target: FixtureTarget.make("fixture") },
      limits: runningHostLimits
    })
    const request = { protocolVersion: 1, hostInstanceId: "host", requestId: "transport", runId }
    const retry = retryFor(runId)
    expect(
      yield* decodeRunningHostRequest({ ...request, operation: { _tag: "RetryTaskAttemptBase", retry } }, descriptor)
    ).toMatchObject({ operation: { retry } })
    for (const input of [retryFor(RunId.make("foreign")), { ...retry, automatic: true }])
      expect(
        yield* decodeRunningHostRequest(
          { ...request, operation: { _tag: "RetryTaskAttemptBase", retry: input } },
          descriptor
        ).pipe(Effect.result)
      ).toMatchObject({ _tag: "Failure", failure: { _tag: "InvalidRequest" } })
  })
)

it.live("routes HTTP, CLI, and MCP retry submissions through command ownership and rejects a mismatched receipt", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const probe = yield* makeRunningHostReadProbe()
      const retry = retryFor(probe.runId)
      const calls = yield* Ref.make(0)
      const spoof = yield* Ref.make<"Request" | "Cursor" | undefined>(undefined)
      const address = yield* availableLocalHostAddress
      yield* serveRunningHost(address, {
        ...probe.observation,
        executeAttachedCommand: (request) =>
          Effect.gen(function* () {
            expect(request.operation).toEqual({ _tag: "RetryTaskAttemptBase", retry })
            expect((yield* probe.observation.commandAdmission.snapshot).registeredOwnerCount).toBe(1)
            yield* Ref.update(calls, (count) => count + 1)
            return {
              _tag: "TaskAttemptBaseRetryRecorded",
              retry:
                (yield* Ref.get(spoof)) === "Request"
                  ? {
                      ...retry,
                      requestId: Schema.decodeUnknownSync(ApplyTaskAttemptBaseRetryRequest)({
                        ...retry,
                        requestId: "foreign-receipt"
                      }).requestId
                    }
                  : retry,
              acceptedAt: TraceCursor.make({
                runId: (yield* Ref.get(spoof)) === "Cursor" ? RunId.make("foreign-cursor") : probe.runId,
                position: JournalPosition.make(17)
              })
            }
          })
      })
      expect(yield* callRunningHost(address, probe.runId, { _tag: "RetryTaskAttemptBase", retry })).toMatchObject({
        result: { _tag: "Success", value: { _tag: "TaskAttemptBaseRetryRecorded", retry } }
      })
      const fs = yield* FileSystem.FileSystem
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "dalph-base-retry-client-" })
      yield* fs.writeFileString(`${directory}/retry.json`, JSON.stringify(retry))
      const lines = yield* Ref.make<ReadonlyArray<string>>([])
      const cli = Command.runWith(
        Command.make("dalph").pipe(
          Command.withSubcommands(
            makeRunningHostCommands(
              () => Effect.die("retry client cannot start another host"),
              {
                addSignalListener: () => Effect.die("client cannot own host signals"),
                removeSignalListener: () => Effect.die("client cannot own host signals")
              },
              Layer.succeed(RunningHostCliOutput, {
                writeLine: (line) => Ref.update(lines, (prior) => [...prior, line])
              })
            )
          )
        ),
        { version: "test" }
      )
      yield* cli([
        "attach",
        "retry-base",
        "--host",
        address,
        "--run",
        probe.runId,
        "--json",
        "--request-file",
        `${directory}/retry.json`
      ])
      const line = (yield* Ref.get(lines))[0]
      if (line === undefined) return expect.fail("requires the CLI receipt")
      expect(JSON.parse(line)).toMatchObject({
        result: { _tag: "Success", value: { _tag: "TaskAttemptBaseRetryRecorded", retry } }
      })
      const messages = [
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } }
        },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "dalph_retry_task_attempt_base", arguments: { runId: probe.runId, retry } }
        }
      ]
      const mcpLines = yield* Ref.make<ReadonlyArray<string>>([])
      yield* runRunningHostMcp(address, probe.runId, {
        input: Stream.make(
          new TextEncoder().encode(messages.map((message) => JSON.stringify(message)).join("\n") + "\n")
        ),
        write: (line) => Ref.update(mcpLines, (prior) => [...prior, line])
      })
      expect((yield* Ref.get(mcpLines)).map((line) => JSON.parse(line)).find((reply) => reply.id === 2)).toMatchObject({
        result: {
          isError: false,
          structuredContent: { result: { _tag: "Success", value: { _tag: "TaskAttemptBaseRetryRecorded", retry } } }
        }
      })
      expect(yield* Ref.get(calls)).toBe(3)
      for (const mismatch of ["Request", "Cursor"] as const) {
        yield* Ref.set(spoof, mismatch)
        expect(yield* callRunningHost(address, probe.runId, { _tag: "RetryTaskAttemptBase", retry })).toMatchObject({
          result: {
            _tag: "Failure",
            error: {
              _tag: "CommandOutcomeUnknown",
              operation: "RetryTaskAttemptBase",
              phase: "AdmissionUnconfirmed",
              acceptedAt: null
            }
          }
        })
      }
      expect(yield* Ref.get(calls)).toBe(5)
      expect((yield* probe.observation.commandAdmission.snapshot).registeredOwnerCount).toBe(0)
    })
  ).pipe(Effect.provide(NodeServices.layer))
)
