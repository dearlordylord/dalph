import { NodeServices } from "@effect/platform-node"
import { Command } from "effect/unstable/cli"
import { makeRunningHostCommands, RunningHostCliOutput } from "./running-host-cli.js"
import { runRunningHostMcp } from "./running-host-mcp.js"
import { RunId } from "@dalph/contracts"
import {
  ApplyResultRecoveryRequest,
  FixtureTarget,
  JournalRecordKey,
  JournalPosition,
  ResultRecoveryDirectedEvent,
  ResultRecoveryDirectionNotFound,
  ResultRecoveryRequestId,
  TraceCursor
} from "@dalph/orchestrator"
import { it } from "@effect/vitest"
import { Effect, FileSystem, Layer, Ref, Schema, Stream } from "effect"
import { expect } from "vitest"
import { makeRunningHostReadProbe, availableLocalHostAddress } from "../../test-support/running-host-read-probe.js"
import { callRunningHost } from "./running-host-client.js"
import {
  decodeRunningHostRequest,
  HostInstanceId,
  RunningHostDescriptor,
  runningHostLimits
} from "./running-host-contract.js"
import { serveRunningHost } from "./running-host-http.js"

const recoveryInput = (runId: RunId) => ({
  direction: "ContinueRetainedAttempt",
  requestId: { nonce: "one-explicit-recovery", runId },
  subject: {
    _tag: "RejectedResult",
    reportOrdinal: 2,
    plannedAttempt: {
      attemptId: "attempt-A",
      runId,
      taskId: "A",
      taskRevision: "revision-A",
      executor: "executor:controlled-fake",
      baseSha: "a".repeat(40),
      branch: "refs/heads/dalph/A",
      worktree: "/tmp/dalph-A"
    }
  }
})

it.effect("binds recovery input to the selected Run and refuses legacy failure Continue", () =>
  Effect.gen(function* () {
    const runId = RunId.make("R")
    const descriptor = RunningHostDescriptor.make({
      protocolVersion: 1,
      hostInstanceId: HostInstanceId.make("host"),
      selectedRun: { runId, target: FixtureTarget.make("fixture") },
      limits: runningHostLimits
    })
    const request = { protocolVersion: 1, hostInstanceId: "host", requestId: "transport", runId }
    const recovery = recoveryInput(runId)
    expect(
      yield* decodeRunningHostRequest(
        { ...request, operation: { _tag: "ApplyResultRecoveryDirection", recovery } },
        descriptor
      )
    ).toMatchObject({ operation: { recovery } })
    for (const operation of [
      { _tag: "ReadResultRecoveryDirection", recoveryRequestId: { ...recovery.requestId, runId: "foreign" } },
      { _tag: "ApplyResultRecoveryDirection", recovery: recoveryInput(RunId.make("foreign")) },
      {
        _tag: "ApplyResultRecoveryDirection",
        recovery: { ...recovery, subject: { ...recovery.subject, _tag: "HistoricalUnknownFailure" } }
      },
      { _tag: "ApplyResultRecoveryDirection", recovery: { ...recovery, providerTurnId: "foreign" } }
    ])
      expect(yield* decodeRunningHostRequest({ ...request, operation }, descriptor).pipe(Effect.result)).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "InvalidRequest" }
      })
  })
)

it.live(
  "routes explicit recovery through command admission and reads its exact durable identity without applying again",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const probe = yield* makeRunningHostReadProbe()
        const recovery = yield* Schema.decodeUnknownEffect(ApplyResultRecoveryRequest)(recoveryInput(probe.runId))
        const calls = yield* Ref.make(0)
        const spoofReply = yield* Ref.make(false)
        const recorded = ResultRecoveryDirectedEvent.make({
          ...recovery,
          initiatedBy: { _tag: "Operator" },
          occurrenceClassification: "InitiatedAction",
          version: 15
        })
        const address = yield* availableLocalHostAddress
        yield* serveRunningHost(address, {
          ...probe.observation,
          resultRecoveryControl: {
            applyResultRecoveryDirection: () => Effect.die("HTTP command must use its admitted owner"),
            readResultRecoveryDirection: (input) =>
              Effect.gen(function* () {
                const id = yield* Schema.decodeUnknownEffect(ResultRecoveryRequestId)(input)
                if (id.nonce === "not-applied") return yield* new ResultRecoveryDirectionNotFound({ requestId: id })
                expect(id).toEqual(recovery.requestId)
                const event = (yield* Ref.get(spoofReply))
                  ? ResultRecoveryDirectedEvent.make({
                      ...recorded,
                      requestId: ResultRecoveryRequestId.make({ ...recovery.requestId, nonce: "another-record" })
                    })
                  : recorded
                return {
                  runId: probe.runId,
                  position: JournalPosition.make(17),
                  key: JournalRecordKey.make("result-recovery"),
                  event
                }
              })
          },
          executeAttachedCommand: (request) =>
            Effect.gen(function* () {
              expect(request.operation).toEqual({ _tag: "ApplyResultRecoveryDirection", recovery })
              expect((yield* probe.observation.commandAdmission.snapshot).registeredOwnerCount).toBe(1)
              yield* Ref.update(calls, (count) => count + 1)
              return {
                _tag: "ResultRecoveryDirectionRecorded",
                recovery,
                acceptedAt: TraceCursor.make({ runId: probe.runId, position: JournalPosition.make(17) })
              }
            })
        })
        expect(
          yield* callRunningHost(address, probe.runId, { _tag: "ApplyResultRecoveryDirection", recovery })
        ).toMatchObject({ result: { _tag: "Success", value: { _tag: "ResultRecoveryDirectionRecorded", recovery } } })
        expect(
          yield* callRunningHost(address, probe.runId, {
            _tag: "ReadResultRecoveryDirection",
            recoveryRequestId: recovery.requestId
          })
        ).toMatchObject({ result: { _tag: "Success", value: { _tag: "ResultRecoveryDirectionRecorded", recovery } } })
        expect(yield* Ref.get(calls)).toBe(1)
        const fs = yield* FileSystem.FileSystem
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "dalph-recovery-client-" })
        yield* fs.writeFileString(`${directory}/apply.json`, JSON.stringify(recovery))
        yield* fs.writeFileString(`${directory}/read.json`, JSON.stringify(recovery.requestId))
        const lines = yield* Ref.make<ReadonlyArray<string>>([])
        const cli = Command.runWith(
          Command.make("dalph").pipe(
            Command.withSubcommands(
              makeRunningHostCommands(
                () => Effect.die("recovery client cannot start another production host"),
                {
                  addSignalListener: () => Effect.die("recovery client cannot own host signals"),
                  removeSignalListener: () => Effect.die("recovery client cannot own host signals")
                },
                Layer.succeed(RunningHostCliOutput, {
                  writeLine: (line) => Ref.update(lines, (prior) => [...prior, line])
                })
              )
            )
          ),
          { version: "test" }
        )
        for (const mode of ["apply", "read"])
          yield* cli([
            "attach",
            `recovery-${mode}`,
            "--host",
            address,
            "--run",
            probe.runId,
            "--json",
            "--request-file",
            `${directory}/${mode}.json`
          ])
        expect(yield* Ref.get(lines)).toHaveLength(2)
        for (const line of yield* Ref.get(lines))
          expect(JSON.parse(line)).toMatchObject({
            result: { _tag: "Success", value: { _tag: "ResultRecoveryDirectionRecorded", recovery } }
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
            params: { name: "dalph_apply_result_recovery", arguments: { runId: probe.runId, recovery } }
          },
          {
            jsonrpc: "2.0",
            id: 3,
            method: "tools/call",
            params: {
              name: "dalph_read_result_recovery",
              arguments: { runId: probe.runId, recoveryRequestId: recovery.requestId }
            }
          }
        ]
        const mcpLines = yield* Ref.make<ReadonlyArray<string>>([])
        yield* runRunningHostMcp(address, probe.runId, {
          input: Stream.make(
            new TextEncoder().encode(messages.map((message) => JSON.stringify(message)).join("\n") + "\n")
          ),
          write: (line) => Ref.update(mcpLines, (prior) => [...prior, line])
        })
        const replies = (yield* Ref.get(mcpLines)).map((line) => JSON.parse(line))
        for (const id of [2, 3])
          expect(replies.find((reply) => reply.id === id)).toMatchObject({
            result: {
              isError: false,
              structuredContent: {
                result: { _tag: "Success", value: { _tag: "ResultRecoveryDirectionRecorded", recovery } }
              }
            }
          })
        const missingId = ResultRecoveryRequestId.make({ ...recovery.requestId, nonce: "not-applied" })
        expect(
          yield* callRunningHost(address, probe.runId, {
            _tag: "ReadResultRecoveryDirection",
            recoveryRequestId: missingId
          })
        ).toMatchObject({
          result: {
            _tag: "Success",
            value: { _tag: "ResultRecoveryDirectionNotRecorded", recoveryRequestId: missingId }
          }
        })
        yield* Ref.set(spoofReply, true)
        expect(
          yield* callRunningHost(address, probe.runId, {
            _tag: "ReadResultRecoveryDirection",
            recoveryRequestId: recovery.requestId
          })
        ).toMatchObject({
          result: { _tag: "Failure", error: { _tag: "TransportFailed", reason: "RecoveryResponseCorrelationMismatch" } }
        })
        expect(yield* Ref.get(calls)).toBe(3)
        expect((yield* probe.observation.commandAdmission.snapshot).registeredOwnerCount).toBe(0)
      })
    ).pipe(Effect.provide(NodeServices.layer))
)
