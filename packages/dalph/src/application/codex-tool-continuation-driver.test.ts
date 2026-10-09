/* eslint-disable import/no-nodejs-modules -- This internal test driver owns a disposable native controller. */
import nodeProcess from "node:process"
import { it } from "@effect/vitest"
import { NodeServices } from "@effect/platform-node"
import {
  AttemptId,
  GitCommitSha,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorRequest,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  WorktreeLocator,
  makeTaskWorkSpecification,
  passiveLifecycleObservationPurpose,
  plannedAttemptExecutorCorrelation
} from "@dalph/contracts"
import { GitCommand } from "@dalph/orchestrator"
import { Effect, FileSystem, Layer, Option } from "effect"
import { expect } from "vitest"
import { CodexAppServer, codexAppServerNodeLayer, codexOwnedActivityCensusLayer } from "./codex-app-server.js"
import {
  CodexAttemptStore,
  CodexToolEffectRecord,
  CodexToolItemId,
  nodeCodexAttemptStoreLayer
} from "./codex-attempt-store.js"
import { codexPlannedAttemptExecutorLayerWithOptions } from "./codex-planned-attempt-executor.js"
import { CodexToolEffectPolicy } from "./codex-tool-effect-policy.js"
import { isolatedCodexProcessNativeService } from "../../test-support/isolated-codex-process-native.js"

// The provider persists actual token-bearing turns through its native transport.
// No model, network, tracker or production history is involved.
const provider = String.raw`#!/usr/bin/env node
const fs = require("node:fs")
const filename = process.argv[1] + ".turns"
let thread = fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, "utf8")) :
  { id: "native-continuation-thread", cwd: "/unset", status: "idle", turns: [] }
const save = () => fs.writeFileSync(filename, JSON.stringify(thread))
const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n")
const receive = (m) => {
  if (m.method === "initialized") return
  if (m.method === "initialize") return reply(m.id, { userAgent: "custody-fixture", codexHome: process.env.CODEX_HOME, platformFamily: "unix", platformOs: "linux" })
  if (m.method === "thread/start") { thread.cwd = m.params.cwd; save(); return reply(m.id, { thread }) }
  if (m.method === "thread/read" || m.method === "thread/resume") return reply(m.id, { thread })
  if (m.method === "thread/turns/list") return reply(m.id, { data: thread.turns, nextCursor: null })
  if (m.method === "thread/list") return reply(m.id, { data: [thread], nextCursor: null })
  if (m.method === "thread/loaded/list") return reply(m.id, { data: [thread.id], nextCursor: null })
  if (m.method === "thread/backgroundTerminals/list") return reply(m.id, { data: [] })
  if (m.method === "turn/start") {
    const turn = { id: "native-turn-" + (thread.turns.length + 1), status: "inProgress", items: [{ type: "userMessage", content: m.params.input }] }
    thread.turns.push(turn); thread.status = "active"; save(); return reply(m.id, { turn })
  }
  if (m.method === "turn/interrupt") {
    const turn = thread.turns.find(t => t.id === m.params.turnId)
    if (turn) turn.status = "interrupted"
    thread.status = "idle"; save(); return reply(m.id, {})
  }
  reply(m.id, {})
}
let buffer = ""
process.stdin.setEncoding("utf8")
process.stdin.on("data", chunk => {
  buffer += chunk
  while (buffer.includes("\n")) {
    const end = buffer.indexOf("\n"); const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
    if (line.trim()) receive(JSON.parse(line))
  }
})
`

const phase = nodeProcess.env["DALPH_TOOL_CUSTODY_FIXTURE_PHASE"]
const disposition = nodeProcess.env["DALPH_TOOL_CUSTODY_FIXTURE_DISPOSITION"]
const directory = nodeProcess.env["DALPH_TOOL_CUSTODY_FIXTURE_DIRECTORY"]
const driverTest = it.live.skipIf(phase === undefined)

driverTest(
  "native tool continuation custody driver",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        if (
          (phase !== "seed" && phase !== "recover" && phase !== "proveStopped") ||
          (disposition !== "Started" && disposition !== "LimitReached") ||
          directory === undefined
        )
          return yield* Effect.die("driver requires an exact phase, disposition and directory")
        const fs = yield* FileSystem.FileSystem
        const executable = `${directory}/fixture-codex`
        yield* fs.writeFileString(executable, provider)
        yield* fs.chmod(executable, 0o755)
        const specification = makeTaskWorkSpecification({
          taskId: TaskId.make("native-tool-task"),
          title: "continue",
          body: "continue the same attempt"
        })
        const attempt = PlannedTaskAttempt.make({
          runId: RunId.make("native-tool-run"),
          attemptId: AttemptId.make("native-tool-attempt"),
          taskId: specification.taskId,
          taskRevision: specification.fingerprint,
          baseSha: GitCommitSha.make("a".repeat(40)),
          branch: TaskBranchRef.make("refs/heads/native-tool-continuation"),
          executor: TaskExecutorLocator.make("executor:codex"),
          worktree: WorktreeLocator.make(directory)
        })
        const request = PlannedAttemptExecutorRequest.make({ plannedAttempt: attempt, specification })
        const correlation = plannedAttemptExecutorCorrelation(attempt)
        const appLayer = codexAppServerNodeLayer(
          { executable, environment: { CODEX_HOME: `${directory}/provider-home` } },
          isolatedCodexProcessNativeService
        ).pipe(Layer.provideMerge(nodeCodexAttemptStoreLayer({ stateDirectory: `${directory}/private` })))
        const layer = codexPlannedAttemptExecutorLayerWithOptions({
          toolEffectPolicy: CodexToolEffectPolicy.make({ defaultLimitMilliseconds: 1_000, longCommands: [] })
        }).pipe(
          Layer.provideMerge(
            codexOwnedActivityCensusLayer(isolatedCodexProcessNativeService).pipe(Layer.provideMerge(appLayer))
          ),
          Layer.provide(
            Layer.succeed(GitCommand, {
              run: () => Effect.succeed({ exitCode: 0, stdout: "", stderr: "" }),
              runInWorktree: () => Effect.succeed({ exitCode: 0, stdout: `${attempt.baseSha}\n`, stderr: "" }),
              runBytesInWorktree: () => Effect.succeed({ exitCode: 0, stdout: new Uint8Array(), stderr: "" })
            })
          )
        )
        yield* Effect.gen(function* () {
          const executor = yield* PlannedAttemptExecutor
          const app = yield* CodexAppServer
          const store = yield* CodexAttemptStore
          if (
            store.writeToolEffect === undefined ||
            store.listToolEffects === undefined ||
            store.readRetainedServerLaunch === undefined ||
            app.serverLaunch === undefined ||
            app.verifyStoppedLaunch === undefined ||
            app.listThreadTurns === undefined
          )
            return yield* Effect.die("native custody capabilities absent")
          if (phase === "seed") {
            yield* executor.begin(request, { _tag: "InitialDelivery" })
            const original = Option.getOrThrow(yield* store.readAttempt(attempt.runId, attempt.attemptId))
            if (original._tag !== "Running") return yield* Effect.die("native original turn absent")
            const startedAtMilliseconds = yield* Effect.clockWith((clock) => clock.currentTimeMillis)
            const started = CodexToolEffectRecord.cases.Started.make({
              runId: attempt.runId,
              attemptId: attempt.attemptId,
              threadId: original.threadId,
              turnId: original.observedTurnId,
              itemId: CodexToolItemId.make("lost-original-item"),
              incarnation: app.incarnation,
              worktree: attempt.worktree,
              startedAtMilliseconds,
              deadlineMilliseconds: startedAtMilliseconds + 1_000
            })
            expect(yield* executor.requestSuspension(attempt)).toMatchObject({ _tag: "ExecutorWorkSafelySuspended" })
            expect(yield* executor.resume(request)).toMatchObject({ _tag: "ExecutorWorkExecuting" })
            const executing = Option.getOrThrow(yield* store.readAttempt(attempt.runId, attempt.attemptId))
            if (executing._tag !== "Running") return yield* Effect.die("native continuation absent")
            expect(executing).toMatchObject({ observedTurnId: "native-turn-2", priorObservedTurnId: started.turnId })
            // Seed the released-format lost notification after continuation, without
            // editing frames or manufacturing a completed item. Its budget is original.
            yield* store.writeToolEffect(started)
            const now = yield* Effect.clockWith((clock) => clock.currentTimeMillis)
            yield* Effect.sleep(Math.max(0, started.deadlineMilliseconds - now))
            const intended = CodexToolEffectRecord.cases.StopIntended.make({
              ...started,
              _tag: "StopIntended",
              serverLaunch: app.serverLaunch,
              reason: "Elapsed",
              stopIntentAtMilliseconds: yield* Effect.clockWith((clock) => clock.currentTimeMillis)
            })
            if (disposition === "LimitReached") yield* store.writeToolEffect(intended)
            yield* app.interruptTurn(executing.threadId, executing.observedTurnId)
            yield* app.close
            if (disposition === "LimitReached")
              yield* store.writeToolEffect(
                CodexToolEffectRecord.cases.LimitReached.make({
                  ...intended,
                  _tag: "LimitReached",
                  stoppedAtMilliseconds: yield* Effect.clockWith((clock) => clock.currentTimeMillis)
                })
              )
            expect(yield* store.readAttempt(attempt.runId, attempt.attemptId)).toEqual(Option.some(executing))
            return
          }
          if (phase === "proveStopped") {
            const record = yield* store.readAttempt(attempt.runId, attempt.attemptId)
            if (
              Option.isNone(record) ||
              record.value._tag !== "SuspensionStopIntended" ||
              record.value.turnStartIncarnation === undefined ||
              app.stopOwnedLaunch === undefined ||
              app.verifyStorageOwnership === undefined
            )
              return yield* Effect.die("retained exact Suspend stop intent missing")
            const launch = yield* store.readRetainedServerLaunch(record.value.turnStartIncarnation)
            if (Option.isNone(launch)) return yield* Effect.die("retained current launch missing")
            yield* app.verifyStorageOwnership
            for (const item of yield* store.listToolEffects(attempt.runId, attempt.attemptId)) {
              if (!("suspensionCustody" in item) || item.suspensionCustody._tag !== "Stopped")
                return yield* Effect.die("original item custody remains unresolved")
              yield* app.verifyStoppedLaunch(item.suspensionCustody.serverLaunch)
            }
            yield* app.stopOwnedLaunch(launch.value)
            yield* app.verifyStoppedLaunch(launch.value)
            yield* app.verifyStorageOwnership
            yield* app.close
            return
          }
          const item = (yield* store.listToolEffects(attempt.runId, attempt.attemptId))[0]
          if (item === undefined) return yield* Effect.die("original tool evidence absent")
          const launch =
            item._tag === "LimitReached"
              ? item.serverLaunch
              : Option.getOrUndefined(yield* store.readRetainedServerLaunch(item.incarnation))
          if (launch === undefined) return yield* Effect.die("original launch observation absent")
          expect(item._tag).toBe(disposition)
          expect(app.incarnation).not.toBe(launch.incarnation)
          const executing = yield* store.readAttempt(attempt.runId, attempt.attemptId)
          expect(executing).toMatchObject({ _tag: "Some", value: { _tag: "Running", observedTurnId: "native-turn-2" } })
          yield* app.verifyStoppedLaunch(launch)
          expect(yield* executor.observe(correlation, passiveLifecycleObservationPurpose)).toMatchObject({
            _tag: "Unreadable"
          })
          expect(yield* executor.observe(correlation, { _tag: "ReconcileCommand", command: "Suspend" })).toMatchObject({
            _tag: "Exact",
            report: { _tag: "ExecutorWorkSafelySuspended", correlation }
          })
          const preserved = yield* store.listToolEffects(attempt.runId, attempt.attemptId)
          expect(preserved).toMatchObject([{ ...item, suspensionCustody: { _tag: "Stopped", serverLaunch: launch } }])
          expect(yield* executor.resume(request)).toMatchObject({ _tag: "ExecutorWorkExecuting", correlation })
          expect(yield* store.readAttempt(attempt.runId, attempt.attemptId)).toMatchObject({
            _tag: "Some",
            value: {
              _tag: "Running",
              correlationRunId: attempt.runId,
              correlationAttemptId: attempt.attemptId,
              worktree: attempt.worktree,
              observedTurnId: "native-turn-3",
              priorObservedTurnId: "native-turn-2",
              toolEffectPolicy: { defaultLimitMilliseconds: 1_000 }
            }
          })
          expect(yield* store.listToolEffects(attempt.runId, attempt.attemptId)).toEqual(preserved)
          expect((yield* app.listThreadTurns(item.threadId)).map((turn) => turn.id)).toEqual([
            "native-turn-1",
            "native-turn-2",
            "native-turn-3"
          ])
          expect(yield* executor.requestSuspension(attempt)).toMatchObject({
            _tag: "ExecutorWorkSafelySuspended",
            correlation
          })
        }).pipe(Effect.provide(layer))
      })
    ).pipe(Effect.provide(NodeServices.layer)),
  40_000
)
