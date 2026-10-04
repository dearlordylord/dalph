/* eslint-disable import/no-nodejs-modules -- Qualification starts actual public client processes and allocates a local listener port. */
import { execFile, spawn } from "node:child_process"
import { createServer } from "node:net"
import process from "node:process"
import { fileURLToPath } from "node:url"
import { Context, Deferred, Effect, Fiber, FiberSet, FileSystem, Layer, Option, Ref, Schema, Stream } from "effect"
import { it } from "@effect/vitest"
import { expect } from "vitest"
import {
  JournalStore,
  GitCommand,
  completionOriginalTaskClaimReleaseFor,
  attachCurrentSignal,
  sqliteJournalStoreLayer,
  type DeliveryRuntimeReadyObservation
} from "@dalph/orchestrator"
import { withDecodedProductionRepositoryHost, type ProductionRunningHostObservation } from "./production-host.js"
import { LocalHostAddress, RunningHostDescriptor, RunningHostEnvelope } from "./running-host-contract.js"
import { serveRunningHost } from "./running-host-http.js"
import { makeRunningHostFixture, runningHostFixtureLayer } from "../../test-support/production-running-host-fixture.js"

import { projectRecordedCassette, verifyRecordedCassetteRoundTrip } from "../cassettes/recorded.js"

class RunningHostFixtureError extends Schema.TaggedError<RunningHostFixtureError>()("RunningHostFixtureError", {
  boundary: Schema.String,
  detail: Schema.String
}) {}

const builtEntry = fileURLToPath(new URL("../../dist/bin/dalph.js", import.meta.url))
const freeAddress = Effect.tryPromise({
  try: () =>
    new Promise<LocalHostAddress>((resolve, reject) => {
      const server = createServer()
      server.once("error", reject)
      server.listen(0, "127.0.0.1", () => {
        const bound = server.address()
        if (bound === null || typeof bound === "string") {
          server.close()
          reject(new Error("port allocation failed"))
          return
        }
        const address = LocalHostAddress.make(`http://127.0.0.1:${bound.port}`)
        server.close((error) => (error ? reject(error) : resolve(address)))
      })
    }),
  catch: (error) => new RunningHostFixtureError({ boundary: "LocalPort", detail: String(error) })
})
const childClient = (args: ReadonlyArray<string>, stdin = "") =>
  Effect.tryPromise({
    try: (signal) =>
      new Promise<{ stdout: string; stderr: string; failed: boolean; exitCode: number | null }>((resolve) => {
        const child = execFile(
          process.execPath,
          [builtEntry, ...args],
          { signal, timeout: 15000, maxBuffer: 8 * 1024 * 1024 },
          (error, stdout, stderr) =>
            resolve({
              stdout,
              stderr,
              failed: error !== null,
              exitCode: error === null ? 0 : typeof error.code === "number" ? error.code : null
            })
        )
        child.stdin?.end(stdin)
      }),
    catch: (error) => new RunningHostFixtureError({ boundary: "ChildClient", detail: String(error) })
  })
const readEnvelope = (text: string) =>
  Schema.decodeUnknownSync(RunningHostEnvelope)(JSON.parse(text), { onExcessProperty: "error" })
const mcpInput = (runId: string, operation: "snapshot" | "control") =>
  [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "production-fixture", version: "1" }
      }
    },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: operation === "snapshot" ? "dalph_read_snapshot" : "dalph_read_run_control",
        arguments: { runId }
      }
    }
  ]
    .map((message) => JSON.stringify(message))
    .join("\n") + "\n"
const mcpEnvelope = (text: string) => {
  const reply = Schema.decodeUnknownSync(
    Schema.Struct({ result: Schema.Struct({ structuredContent: RunningHostEnvelope }) })
  )(JSON.parse(text.trim().split("\n").at(-1) ?? ""))
  return reply.result.structuredContent
}
const loseWatchClient = (adapter: "CLI" | "MCP", address: string, runId: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const observed = yield* Deferred.make<void>()
      const closed = yield* Deferred.make<void>()
      const run = yield* FiberSet.makeRuntime<never, void, never>()
      const child = yield* Effect.acquireRelease(
        Effect.sync(() =>
          spawn(
            process.execPath,
            [
              builtEntry,
              ...(adapter === "CLI"
                ? ["attach", "watch", "--host", address, "--run", runId, "--json"]
                : ["mcp", "--host", address, "--run", runId])
            ],
            { stdio: ["pipe", "pipe", "pipe"] }
          )
        ),
        (child) =>
          Effect.sync(() => {
            child.kill("SIGTERM")
          })
      )
      let pending = ""
      child.stdout.on("data", (chunk: Buffer) => {
        pending += chunk.toString("utf8")
        while (pending.includes("\n")) {
          const end = pending.indexOf("\n")
          const value = JSON.parse(pending.slice(0, end))
          pending = pending.slice(end + 1)
          if (adapter === "CLI" && value.frame?._tag === "Snapshot")
            run(Deferred.succeed(observed, undefined).pipe(Effect.asVoid))
          const opened = value.result?.structuredContent?.result?.value
          if (opened?._tag === "WatchOpened")
            child.stdin.write(
              JSON.stringify({ jsonrpc: "2.0", id: 3, method: "resources/read", params: { uri: opened.uri } }) + "\n"
            )
          if (adapter === "MCP" && value.id === 3) run(Deferred.succeed(observed, undefined).pipe(Effect.asVoid))
        }
      })
      child.once("close", () => run(Deferred.succeed(closed, undefined).pipe(Effect.asVoid)))
      if (adapter === "MCP")
        child.stdin.write(
          [
            {
              jsonrpc: "2.0",
              id: 1,
              method: "initialize",
              params: {
                protocolVersion: "2025-11-25",
                capabilities: {},
                clientInfo: { name: "watch-loss", version: "1" }
              }
            },
            { jsonrpc: "2.0", method: "notifications/initialized" },
            {
              jsonrpc: "2.0",
              id: 2,
              method: "tools/call",
              params: { name: "dalph_watch_snapshots", arguments: { runId } }
            }
          ]
            .map((value) => JSON.stringify(value))
            .join("\n") + "\n"
        )
      yield* Deferred.await(observed).pipe(Effect.timeout("10 seconds"))
      child.kill("SIGTERM")
      yield* Deferred.await(closed).pipe(Effect.timeout("10 seconds"))
    })
  )

const awaitExecuting = (observation: ProductionRunningHostObservation<unknown>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const attached = yield* attachCurrentSignal(observation.current)
      const ready = (state: typeof attached.current): state is DeliveryRuntimeReadyObservation =>
        state._tag === "Ready" &&
        state.evaluation.current.trackerGraph._tag === "GraphEstablished" &&
        state.evaluation.taskWork.held.length === 1
      if (ready(attached.current)) return attached.current
      return Option.getOrThrow(yield* attached.changes.pipe(Stream.filter(ready), Stream.runHead))
    })
  ).pipe(Effect.timeout("20 seconds"))

it.live(
  "Alice and two public clients observe one Run without starting work and reconnect after delivery",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeRunningHostFixture(builtEntry)
        const address = yield* freeAddress
        const ready = yield* Deferred.make<{
          observation: ProductionRunningHostObservation<unknown>
          descriptor: RunningHostDescriptor
        }>()
        const releaseHost = yield* Deferred.make<void>()
        const host = yield* withDecodedProductionRepositoryHost(
          fixture.configuration,
          fixture.graph,
          (observation) =>
            Effect.scoped(
              Effect.gen(function* () {
                const listening = yield* serveRunningHost(address, observation)
                yield* Deferred.succeed(ready, { observation, descriptor: listening.descriptor })
                yield* Deferred.await(releaseHost)
              })
            ),
          "Run",
          "Listening"
        ).pipe(Effect.forkScoped)
        const { descriptor, observation } = yield* Deferred.await(ready).pipe(
          Effect.raceFirst(Fiber.join(host).pipe(Effect.andThen(Effect.die("host closed before listening")))),
          Effect.timeout("20 seconds")
        )
        yield* Deferred.await(fixture.turnEntered).pipe(Effect.timeout("20 seconds"))
        const executing = yield* awaitExecuting(observation)
        yield* Effect.scoped(
          Effect.gen(function* () {
            const history = yield* attachCurrentSignal(observation.acceptedHistory)
            const accepted = yield* observation.traceReader.readAt(history.current)
            const executingWasAccepted = (view: typeof accepted) =>
              view.items.some(
                ({ occurrence }) =>
                  occurrence._tag === "PlannedAttemptExecutorWorkReported" &&
                  occurrence.report._tag === "ExecutorWorkExecuting"
              )
            if (!executingWasAccepted(accepted))
              yield* history.changes.pipe(
                Stream.mapEffect((cursor) => observation.traceReader.readAt(cursor)),
                Stream.filter(executingWasAccepted),
                Stream.runHead
              )
          })
        ).pipe(Effect.timeout("20 seconds"))
        yield* Deferred.await(fixture.activationFinalizing).pipe(Effect.timeout("20 seconds"))
        const runId = observation.selection.runId
        const historyBefore = yield* observation.acceptedHistory.get
        const trackerBefore = yield* Ref.get(fixture.trackerCalls)
        const gitBefore = yield* Ref.get(fixture.gitCalls)

        const described = yield* childClient(["attach", "descriptor", "--host", address, "--json"])
        expect(described.failed, described.stderr).toBe(false)
        expect(Schema.decodeUnknownSync(RunningHostDescriptor)(JSON.parse(described.stdout))).toEqual(descriptor)
        const cli = yield* childClient(["attach", "snapshot", "--host", address, "--run", runId, "--json"])
        expect(cli.failed, cli.stderr).toBe(false)
        const cliEnvelope = readEnvelope(cli.stdout)
        expect(cliEnvelope.result._tag).toBe("Success")
        if (cliEnvelope.result._tag !== "Success" || cliEnvelope.result.value._tag !== "Ready")
          return expect.fail("CLI must return the executing Ready publication")
        expect(cliEnvelope.result.value.graph).toMatchObject({
          _tag: "GraphEstablished",
          snapshot: { schemaVersion: 1, tasks: expect.any(Array) }
        })
        expect(cliEnvelope.result.value.held).toEqual(executing.evaluation.taskWork.held)
        expect(cliEnvelope.result.value.retained.some(({ plannedAttempt }) => plannedAttempt !== null)).toBe(true)

        const mcp = yield* childClient(["mcp", "--host", address, "--run", runId], mcpInput(runId, "snapshot"))
        expect(mcp.failed, mcp.stderr).toBe(false)
        expect(mcpEnvelope(mcp.stdout).result).toEqual(cliEnvelope.result)
        const replacement = yield* childClient(["attach", "control", "--host", address, "--run", runId, "--json"])
        expect(replacement.failed, replacement.stderr).toBe(false)
        expect(readEnvelope(replacement.stdout).result).toMatchObject({
          _tag: "Success",
          value: { _tag: "RunUnpaused", terminationEvidence: { _tag: "Pending" } }
        })
        const wrongCli = yield* childClient(["attach", "snapshot", "--host", address, "--run", "wrong-Run", "--json"])
        expect(wrongCli.exitCode).toBe(2)
        expect(readEnvelope(wrongCli.stdout).result).toMatchObject({
          _tag: "Failure",
          error: { _tag: "RunMismatch", selectedRunId: runId }
        })
        const wrongMcp = yield* childClient(
          ["mcp", "--host", address, "--run", runId],
          mcpInput("wrong-Run", "snapshot")
        )
        expect(mcpEnvelope(wrongMcp.stdout).result).toMatchObject({
          _tag: "Failure",
          error: { _tag: "RunMismatch", selectedRunId: runId }
        })
        const absentAddress = yield* freeAddress
        const absentCli = yield* childClient(["attach", "descriptor", "--host", absentAddress, "--json"])
        expect(absentCli.exitCode).toBe(3)
        expect(readEnvelope(absentCli.stdout).result).toMatchObject({
          _tag: "Failure",
          error: { _tag: "HostUnavailable" }
        })
        const absentMcp = yield* childClient(
          ["mcp", "--host", absentAddress, "--run", runId],
          mcpInput(runId, "snapshot")
        )
        expect(JSON.parse(absentMcp.stdout.trim().split("\n")[0] ?? "")).toMatchObject({
          error: { data: { _tag: "HostUnavailable" } }
        })
        expect(yield* observation.acceptedHistory.get).toEqual(historyBefore)
        expect(yield* Ref.get(fixture.trackerCalls)).toBe(trackerBefore)
        expect(yield* Ref.get(fixture.gitCalls)).toBe(gitBefore)
        for (const adapter of ["CLI", "MCP"] as const) {
          yield* loseWatchClient(adapter, address, runId)
          expect(yield* observation.acceptedHistory.get).toEqual(historyBefore)
          const afterWatch = yield* observation.current.get
          expect(afterWatch._tag).toBe("Ready")
          if (afterWatch._tag === "Ready")
            expect(afterWatch.evaluation.taskWork.held).toEqual(executing.evaluation.taskWork.held)
          expect(yield* Ref.get(fixture.trackerCalls)).toBe(trackerBefore)
          expect(yield* Ref.get(fixture.gitCalls)).toBe(gitBefore)
          expect(yield* Ref.get(fixture.exitCalls)).toBe(0)
        }
        expect(yield* Ref.get(fixture.exitCalls)).toBe(0)
        expect(
          (yield* fixture.provider.snapshot()).operationCounts.find(({ tag }) => tag === "CodexStartTurn")?.count
        ).toBe(1)

        yield* fixture.release
        const termination = yield* observation.runTermination.await.pipe(Effect.timeout("20 seconds"))
        expect(termination.disposition).toBe("Completed")
        const terminalCli = yield* childClient(["attach", "control", "--host", address, "--run", runId, "--json"])
        const terminalMcp = yield* childClient(["mcp", "--host", address, "--run", runId], mcpInput(runId, "control"))
        expect(terminalCli.failed, terminalCli.stderr).toBe(false)
        expect(terminalMcp.failed, terminalMcp.stderr).toBe(false)
        const expected = {
          _tag: "Success",
          value: { _tag: "RunTerminated", terminationEvidence: { _tag: "Accepted", ...termination } }
        }
        expect(readEnvelope(terminalCli.stdout).result).toEqual(expected)
        expect(mcpEnvelope(terminalMcp.stdout).result).toEqual(expected)
        expect(yield* Ref.get(fixture.failures)).toEqual([])
        expect(yield* Ref.get(fixture.exitCalls)).toBe(0)
        yield* Deferred.succeed(releaseHost, undefined)
        yield* Fiber.join(host).pipe(Effect.timeout("20 seconds"))

        const records = yield* Effect.scoped(
          Effect.gen(function* () {
            const context = yield* Layer.build(
              sqliteJournalStoreLayer({ filename: fixture.configuration.journalDatabase })
            )
            return yield* Context.get(context, JournalStore).read(runId)
          })
        )
        expect(records.filter(({ event }) => event._tag === "WorkflowRunBegan")).toHaveLength(1)
        expect(records.filter(({ event }) => event._tag === "TaskAttemptPlanned")).toHaveLength(1)
        expect(records.filter(({ event }) => event._tag === "TargetPromotionObservedSuccess")).toHaveLength(1)
        expect(records.filter(({ event }) => event._tag === "IntegrationFinalitySettled")).toHaveLength(1)
        const planned = records.find(({ event }) => event._tag === "TaskAttemptPlanned")
        if (planned?.event._tag !== "TaskAttemptPlanned") return expect.fail("requires exact accepted attempt plan")
        const plannedAttempt = planned.event.operation.plannedAttempt
        expect(executing.evaluation.taskWork.held[0]).toMatchObject({
          taskId: plannedAttempt.taskId,
          correlation: { runId: plannedAttempt.runId, attemptId: plannedAttempt.attemptId }
        })
        const fileSystem = yield* FileSystem.FileSystem
        const git = yield* GitCommand
        const worktrees = records.flatMap(({ event }) => (event._tag === "WorktreeCleanupSettled" ? [event] : []))
        expect(worktrees).toHaveLength(1)
        expect(worktrees[0]?.authorization).toMatchObject({
          locator: plannedAttempt.worktree,
          owner: { attemptId: plannedAttempt.attemptId, branch: plannedAttempt.branch },
          disposition: { _tag: "Settled", plannedAttempt }
        })
        expect(yield* fileSystem.exists(plannedAttempt.worktree)).toBe(false)
        const branches = records.flatMap(({ event }) => (event._tag === "BranchCleanupSettled" ? [event] : []))
        expect(branches).toHaveLength(1)
        expect(branches[0]?.authorization).toMatchObject({
          locator: plannedAttempt.branch,
          owner: { attemptId: plannedAttempt.attemptId },
          disposition: { _tag: "Settled", plannedAttempt }
        })
        expect(
          (yield* git.runInWorktree(fixture.configuration.repository, [
            "show-ref",
            "--verify",
            "--quiet",
            plannedAttempt.branch
          ])).exitCode
        ).toBe(1)
        const candidates = records.flatMap(({ event }) =>
          event._tag === "IntegratorCandidateCleanupSettled" ? [event] : []
        )
        expect(candidates).toHaveLength(1)
        const candidate = candidates[0]
        if (candidate === undefined) return expect.fail("requires exact integrator candidate settlement")
        expect(candidate.authorization.disposition._tag).toBe("Settled")
        const gitWorktrees = yield* git.runInWorktree(fixture.configuration.repository, [
          "worktree",
          "list",
          "--porcelain"
        ])
        expect(gitWorktrees.exitCode).toBe(0)
        expect(gitWorktrees.stdout).not.toContain(fixture.configuration.integratorCandidateWorktreeRoot)
        expect(gitWorktrees.stdout).not.toContain(plannedAttempt.worktree)
        const deletion = records.find(({ event }) => event._tag === "CompletionClaimDeleted")
        if (deletion?.event._tag !== "CompletionClaimDeleted")
          return expect.fail("requires exact completion claim deletion")
        const deletionEvent = deletion.event
        expect(deletionEvent.claim.plannedAttempt).toEqual(plannedAttempt)
        const release = completionOriginalTaskClaimReleaseFor(deletionEvent.claim)
        const releaseIntent = records.find(
          ({ event }) =>
            event._tag === "TaskClaimReleaseIntended" && event.operation.release.operationId === release.operationId
        )
        const releaseObserved = records.find(
          ({ event }) => event._tag === "TaskClaimReleased" && event.release.operationId === release.operationId
        )
        expect(releaseIntent).toMatchObject({ event: { operation: { release } } })
        expect(releaseObserved).toMatchObject({ event: { release } })
        expect(releaseIntent?.position).toBeLessThan(releaseObserved?.position ?? 0)
        expect(releaseObserved?.position).toBeLessThan(deletion.position)
        expect(
          records.find(
            ({ event }) =>
              event._tag === "CompletionClaimDeletionIntended" && event.operationId === deletionEvent.operationId
          )
        ).toMatchObject({ event: { claim: deletionEvent.claim } })
        expect(yield* fixture.provider.snapshot()).toMatchObject({ activeClaimCount: 0, completionClaimCount: 0 })
        expect((yield* fixture.provider.finalTrackerFacts).claims).toEqual([])
        const cassette = yield* projectRecordedCassette(records)
        expect(cassette.entries.at(-1)).toMatchObject({ _tag: "WorkflowRunTerminated", disposition: "Completed" })
        const checkpoints = verifyRecordedCassetteRoundTrip(records, cassette)
        expect(checkpoints.length).toBeGreaterThan(0)
        expect(
          checkpoints.every(
            (checkpoint) =>
              checkpoint.operationalStateEquivalent &&
              checkpoint.workflowHistoryEquivalent &&
              checkpoint.pureSelectionEquivalent &&
              checkpoint.appliedOccurrencePositionEquivalent
          )
        ).toBe(true)
        expect(records.filter(({ event }) => event._tag === "WorkflowRunTerminated")).toEqual([
          expect.objectContaining({
            position: termination.terminatedAt.position,
            event: expect.objectContaining({ disposition: "Completed" })
          })
        ])
        expect(
          records.some(
            ({ event }) =>
              event._tag === "TaskTrackerFactsObserved" &&
              event.observation._tag === "FocusedTaskCompletionFacts" &&
              event.observation.purpose._tag === "Confirmation" &&
              event.observation.facts.lifecycle === "CompletedSuccessfully"
          )
        ).toBe(true)
      })
    ).pipe(Effect.provide(runningHostFixtureLayer)),
  60000
)

it.live(
  "CLI and MCP preserve grouping, prerequisites and blocked tasks without executor attempts",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeRunningHostFixture(builtEntry, true)
        const address = yield* freeAddress
        yield* withDecodedProductionRepositoryHost(
          fixture.configuration,
          fixture.graph,
          (observation) =>
            Effect.scoped(
              Effect.gen(function* () {
                yield* serveRunningHost(address, observation)
                yield* Deferred.await(fixture.turnEntered).pipe(Effect.timeout("20 seconds"))
                yield* awaitExecuting(observation)
                yield* Deferred.await(fixture.activationFinalizing).pipe(Effect.timeout("20 seconds"))
                const historyBefore = yield* observation.acceptedHistory.get
                const trackerBefore = yield* Ref.get(fixture.trackerCalls)
                const gitBefore = yield* Ref.get(fixture.gitCalls)
                const runId = observation.selection.runId
                const cli = yield* childClient(["attach", "snapshot", "--host", address, "--run", runId, "--json"])
                const mcp = yield* childClient(["mcp", "--host", address, "--run", runId], mcpInput(runId, "snapshot"))
                expect(cli.failed, cli.stderr).toBe(false)
                expect(mcp.failed, mcp.stderr).toBe(false)
                const envelope = readEnvelope(cli.stdout)
                expect(mcpEnvelope(mcp.stdout).result).toEqual(envelope.result)
                if (
                  envelope.result._tag !== "Success" ||
                  envelope.result.value._tag !== "Ready" ||
                  envelope.result.value.graph._tag !== "GraphEstablished"
                )
                  return expect.fail("Both adapters must project the established three-task graph")
                const snapshot = envelope.result.value
                const graph = envelope.result.value.graph.snapshot
                const [a, b, c] = fixture.taskIds
                expect(graph.tasks).toEqual(
                  expect.arrayContaining([
                    { id: a, lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] },
                    { id: b, lifecycle: { _tag: "Open" }, parentTaskId: a, prerequisiteIds: [] },
                    {
                      id: c,
                      lifecycle: { _tag: "Open" },
                      parentTaskId: a,
                      prerequisiteIds: expect.arrayContaining([a, b])
                    }
                  ])
                )
                expect(graph.tasks).toHaveLength(3)
                expect(snapshot.frontier.standings).toContainEqual(
                  expect.objectContaining({
                    _tag: "Excluded",
                    taskId: c,
                    reasons: [expect.objectContaining({ _tag: "PrerequisitesIncomplete" })]
                  })
                )
                for (const child of [b, c]) {
                  expect(snapshot.held.some(({ taskId }) => taskId === child)).toBe(false)
                  expect(snapshot.retained.some(({ taskId }) => taskId === child)).toBe(false)
                }
                expect(snapshot.frontier.standings).toContainEqual(
                  expect.objectContaining({ _tag: "Eligible", taskId: b })
                )
                expect(snapshot.frontier.placements).toContainEqual(
                  expect.objectContaining({
                    taskId: b,
                    placement: expect.objectContaining({ _tag: "EligibleOutsideBound" })
                  })
                )
                expect(snapshot.held).toHaveLength(1)
                expect(snapshot.held[0]?.taskId).toBe(a)
                expect(yield* observation.acceptedHistory.get).toEqual(historyBefore)
                expect(yield* Ref.get(fixture.trackerCalls)).toBe(trackerBefore)
                expect(yield* Ref.get(fixture.gitCalls)).toBe(gitBefore)
                expect(
                  (yield* fixture.provider.snapshot()).operationCounts.find(({ tag }) => tag === "CodexStartTurn")
                    ?.count
                ).toBe(1)
                expect(yield* Ref.get(fixture.exitCalls)).toBe(0)
              })
            ).pipe(Effect.ensuring(fixture.releaseObservationCut)),
          "Run",
          "Listening"
        )
      })
    ).pipe(Effect.provide(runningHostFixtureLayer)),
  60000
)
