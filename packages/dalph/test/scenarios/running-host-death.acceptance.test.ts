/* eslint-disable import/no-nodejs-modules -- Acceptance kills and separately restarts the actual production host. */
import { fileURLToPath } from "node:url"
import { GitCommitSha, RunId, type PlannedTaskAttempt } from "@dalph/contracts"
import { GitCommand, reduceWorkflowJournalHistory } from "@dalph/orchestrator"
import { it } from "@effect/vitest"
import { Context, Deferred, Effect, Fiber, FileSystem, Layer, Option, Ref, Schema } from "effect"
import { expect } from "vitest"
import { createHermeticFixture } from "../../test-support/production-hermetic-fixture.js"
import { runningHostFixtureLayer } from "../../test-support/production-running-host-fixture.js"
import { availableLocalHostAddress } from "../../test-support/running-host-read-probe.js"
import { makeHostDeathProvider } from "../../test-support/running-host-death-provider.js"
import { startDeathClient, startDeathHost } from "../../test-support/running-host-death-process.js"
import { readRunningHostDescriptor } from "../../src/application/running-host-client.js"
import { requiredPlannedAttemptPositionsOf } from "../../../orchestrator/src/coordination/run/required-planned-attempt-positions.js"
import { projectRecordedCassette, verifyRecordedCassetteRoundTrip } from "../../src/cassettes/recorded.js"
import { CodexAttemptStore, nodeCodexAttemptStoreLayer } from "../../src/application/codex-attempt-store.js"
import { attachWatchAdapters } from "../../test-support/running-host-watch-adapter-probe.js"

const builtEntry = fileURLToPath(new URL("../../dist/bin/dalph.js", import.meta.url))
const hostEntry = fileURLToPath(new URL("../../dist/bin/running-host-death-fixture.js", import.meta.url))

const readPrivateAttempt = (root: string, plan: PlannedTaskAttempt) =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const directories = yield* fs.readDirectory(`${root}/attempts`)
      expect(directories).toHaveLength(1)
      const context = yield* Layer.build(
        nodeCodexAttemptStoreLayer({ stateDirectory: `${root}/attempts/${directories[0]}` })
      )
      const record = yield* Context.get(context, CodexAttemptStore).readAttempt(plan.runId, plan.attemptId)
      if (Option.isNone(record) || !("observedTurnId" in record.value))
        return yield* Effect.die("retained executor association is missing")
      const value = record.value
      return {
        attemptId: value.attemptId,
        correlationAttemptId: value.correlationAttemptId,
        correlationRunId: value.correlationRunId,
        worktree: value.worktree,
        threadId: value.threadId,
        observedTurnId: value.observedTurnId,
        currentToken: value.currentToken
      }
    })
  )

for (const adapter of ["CLI", "MCP"] as const)
  it.live(
    `${adapter} host loss reconstructs durable Unpause and exact work without retry`,
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const git = yield* GitCommand
          const fixture = yield* createHermeticFixture(
            builtEntry,
            GitCommitSha.make("a33de193e5a7976693502a34188d1a1a45b8f837")
          )
          const custody = yield* Ref.make(true)
          yield* Effect.addFinalizer(() =>
            Ref.get(custody).pipe(
              Effect.flatMap((proved) =>
                proved
                  ? fs.remove(fixture.container, { recursive: true, force: true }).pipe(Effect.orDie)
                  : Effect.logError(`Stopped writers unproved; retained fixture ${fixture.container}`)
              )
            )
          )
          const raw = yield* Schema.decodeUnknownEffect(
            Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown))
          )(yield* fs.readFileString(fixture.configurationPath))
          const configurationPath = `${fixture.container}/host.json`
          yield* fs.writeFileString(
            configurationPath,
            JSON.stringify({
              target: fixture.configuration.target,
              configuration: {
                ...raw,
                target: fixture.configuration.target,
                githubToken: "controlled-token",
                activationInterval: "1 minute"
              }
            })
          )
          const provider = yield* makeHostDeathProvider(fixture)
          const address = yield* availableLocalHostAddress
          const input = { address, provider: provider.endpoint, configurationPath }
          const host = yield* startDeathHost(hostEntry, input, custody)
          yield* Effect.addFinalizer(() =>
            Effect.gen(function* () {
              yield* fs
                .writeFileString(
                  `/tmp/dalph-374-${adapter}-observations.json`,
                  JSON.stringify(
                    {
                      events: yield* Ref.get(host.log),
                      calls: yield* Ref.get(provider.calls),
                      stdout: yield* host.stdout,
                      stderr: yield* host.stderr
                    },
                    null,
                    2
                  )
                )
                .pipe(Effect.orDie)
            })
          )
          const ready = yield* host.take("Ready")
          if (ready._tag !== "Ready") return yield* Effect.die("missing ready")
          const runId = ready.selection.runId
          const descriptor = yield* readRunningHostDescriptor(address)
          yield* Deferred.await(provider.started).pipe(
            Effect.timeout("15 seconds"),
            Effect.catchTag("TimeoutError", () => Effect.die("provider StartTurn was not entered"))
          )
          yield* host.take("Idle")
          yield* host.send("Pause")
          yield* host.take("Paused")
          yield* Deferred.await(provider.interruptEntered).pipe(
            Effect.timeout("15 seconds"),
            Effect.catchTag("TimeoutError", () => Effect.die("Pause did not reach the actual interrupt boundary"))
          )
          yield* host.send("History")
          const before = yield* host.take("History")
          if (before._tag !== "History") return yield* Effect.die("missing history")
          const plans = before.records.filter(({ event }) => event._tag === "TaskAttemptPlanned")
          expect(plans).toHaveLength(1)
          expect(
            before.records.filter(({ event }) => event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan")
          ).toHaveLength(1)
          const original = reduceWorkflowJournalHistory(runId, before.records)
          if (original._tag !== "ValidWorkflowJournalHistory") return yield* Effect.die("original history is invalid")
          expect(requiredPlannedAttemptPositionsOf(original.runState)).toHaveLength(1)
          const plannedEvent = plans[0]?.event
          if (plannedEvent?._tag !== "TaskAttemptPlanned") return yield* Effect.die("missing plan")
          const privateBefore = yield* readPrivateAttempt(
            fixture.configuration.codexExecutorPrivateStateDirectory,
            plannedEvent.operation.plannedAttempt
          )
          const worktreesBefore = yield* git.runInWorktree(fixture.configuration.repository, [
            "worktree",
            "list",
            "--porcelain"
          ])
          const watches = yield* attachWatchAdapters(address, runId)
          const rejected = yield* startDeathClient(builtEntry, adapter, address, RunId.make("other-run"), custody)
          expect(yield* rejected.reply).toMatchObject(
            adapter === "CLI"
              ? { result: { _tag: "Failure", error: { _tag: "RunMismatch" } } }
              : { error: { data: { _tag: "RunMismatch" } } }
          )
          if (adapter === "CLI") expect((yield* Fiber.join(rejected.closed)).code).toBe(2)
          yield* host.send("Arm")
          yield* host.take("Armed")
          const client = yield* startDeathClient(builtEntry, adapter, address, runId, custody)
          const cut = yield* host.take("CommittedBeforeCallback")
          if (cut._tag !== "CommittedBeforeCallback") return yield* Effect.die("missing exact committed cut")
          expect(cut.record).toMatchObject({
            runId,
            event: { _tag: "ControlDirectionApplied", direction: "Unpause", ordinal: 2 }
          })
          expect((yield* Ref.get(host.log)).filter((event) => event._tag === "Callback")).toEqual([
            { _tag: "Callback", direction: "Pause" }
          ])
          expect(yield* host.kill).toEqual({ code: null, signal: "SIGKILL" })
          expect(yield* client.reply).toMatchObject({
            result: { _tag: "Failure", error: { _tag: "CommandOutcomeUnknown", operation: "Unpause" } }
          })
          if (adapter === "CLI") expect((yield* Fiber.join(client.closed)).code).toBe(3)
          expect((yield* watches.readTerminal().pipe(Effect.timeout("5 seconds"))).frame).toMatchObject({
            _tag: "Failure",
            error: { _tag: "TransportFailed", phase: "Watch" }
          })
          expect((yield* Ref.get(watches.cliFrames)).at(-1)?.frame).toMatchObject({
            _tag: "Failure",
            error: { _tag: "TransportFailed", phase: "Watch" }
          })
          expect((yield* Fiber.join(watches.cli))._tag).toBe("Failure")
          yield* watches.stop
          expect(host.child.signalCode).toBe("SIGKILL")
          const unavailable = yield* startDeathClient(builtEntry, adapter, address, runId, custody, "control")
          expect(yield* unavailable.reply).toMatchObject(
            adapter === "CLI"
              ? { result: { _tag: "Failure", error: { _tag: "HostUnavailable" } } }
              : { error: { data: { _tag: "HostUnavailable" } } }
          )
          yield* provider.gateReconciliation
          const recovered = yield* startDeathHost(hostEntry, input, custody)
          yield* Effect.addFinalizer(() =>
            Effect.gen(function* () {
              yield* fs
                .writeFileString(
                  `/tmp/dalph-374-${adapter}-recovered.json`,
                  JSON.stringify(
                    {
                      events: yield* Ref.get(recovered.log),
                      stdout: yield* recovered.stdout,
                      stderr: yield* recovered.stderr
                    },
                    null,
                    2
                  )
                )
                .pipe(Effect.orDie)
            })
          )
          const recoveredReady = yield* recovered.take("Ready")
          expect(recoveredReady).toMatchObject({ selection: { _tag: "Recovered", runId } })
          const replacementDescriptor = yield* readRunningHostDescriptor(address)
          expect(replacementDescriptor.selectedRun).toEqual(descriptor.selectedRun)
          expect(replacementDescriptor.hostInstanceId).not.toBe(descriptor.hostInstanceId)
          yield* Deferred.await(provider.reconciliationEntered).pipe(
            Effect.timeout("15 seconds"),
            Effect.catchTag("TimeoutError", () => Effect.die("recovered owner did not enter executor reconciliation"))
          )
          const passiveCodexCalls = yield* Ref.get(provider.calls)
          const passiveGithubCalls = yield* Ref.get(provider.githubCalls)
          const passive = yield* startDeathClient(builtEntry, adapter, address, runId, custody, "control")
          expect(yield* passive.reply).toMatchObject({
            result: { _tag: "Success", value: { _tag: "RunUnpaused", terminationEvidence: { _tag: "Pending" } } }
          })
          const snapshot = yield* startDeathClient(builtEntry, adapter, address, runId, custody, "snapshot")
          expect(yield* snapshot.reply).toMatchObject({ result: { _tag: "Success" } })
          expect(yield* Ref.get(provider.calls)).toEqual(passiveCodexCalls)
          expect(yield* Ref.get(provider.githubCalls)).toEqual(passiveGithubCalls)
          yield* recovered.send("History")
          const history = yield* recovered.take("History")
          if (history._tag !== "History") return yield* Effect.die("missing recovered history")
          const reconstructed = reduceWorkflowJournalHistory(runId, history.records)
          if (reconstructed._tag !== "ValidWorkflowJournalHistory")
            return yield* Effect.die("recovered history is invalid")
          expect(reconstructed.runState.responsibility).toEqual(original.runState.responsibility)
          expect(requiredPlannedAttemptPositionsOf(reconstructed.runState)).toEqual(
            requiredPlannedAttemptPositionsOf(original.runState)
          )
          expect(
            history.records.filter(({ event }) => event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan")
          ).toEqual(
            before.records.filter(({ event }) => event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan")
          )
          expect(history.records.filter(({ event }) => event._tag === "WorkflowRunBegan")).toHaveLength(1)
          expect(history.records.filter(({ event }) => event._tag === "TaskAttemptPlanned")).toEqual(plans)
          expect(
            history.records.filter(({ event }) => event._tag === "ControlDirectionApplied").map(({ event }) => event)
          ).toMatchObject([
            { direction: "Pause", ordinal: 1 },
            { direction: "Unpause", ordinal: 2 }
          ])
          expect(history.records.filter(({ event }) => event._tag === "WorkflowRunTerminated")).toEqual([])
          expect(history.records.find(({ position }) => position === cut.record.position)).toEqual(cut.record)
          expect(history.records.filter(({ event }) => event._tag === "ControlDirectionApplied").at(-1)?.position).toBe(
            cut.record.position
          )
          expect((yield* Ref.get(recovered.log)).filter((event) => event._tag === "Timer")).toEqual([
            { _tag: "Timer", state: "Started" }
          ])
          expect((yield* Ref.get(recovered.log)).filter((event) => event._tag === "Callback")).toEqual([])
          const plan = plans[0]?.event
          if (plan?._tag !== "TaskAttemptPlanned") return yield* Effect.die("missing exact plan")
          expect(plan.operation.plannedAttempt.baseSha).toBe(fixture.manifest.baseSha)
          expect(
            yield* readPrivateAttempt(
              fixture.configuration.codexExecutorPrivateStateDirectory,
              plan.operation.plannedAttempt
            )
          ).toEqual(privateBefore)
          expect(
            (yield* git.runInWorktree(fixture.configuration.repository, ["worktree", "list", "--porcelain"])).stdout
          ).toBe(worktreesBefore.stdout)
          expect(yield* fs.exists(plan.operation.plannedAttempt.worktree)).toBe(true)
          expect(
            (yield* git.runInWorktree(plan.operation.plannedAttempt.worktree, ["rev-parse", "HEAD"])).exitCode
          ).toBe(0)
          expect((yield* Ref.get(provider.calls)).filter((request) => request._tag === "StartTurn")).toHaveLength(1)
          expect(history.records.some(({ event }) => /Cleanup|Released|Abandoned/.test(event._tag))).toBe(false)
          const suspends = history.records.filter(
            ({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended" && event.command === "Suspend"
          )
          expect(suspends).toHaveLength(1)
          const suspend = suspends[0]?.event
          if (suspend?._tag !== "PlannedAttemptExecutorCommandIntended")
            return yield* Effect.die("missing ambiguous suspend intent")
          expect(
            history.records.some(
              ({ event }) =>
                event._tag === "PlannedAttemptExecutorCommandResponseObserved" &&
                event.commandOrdinal === suspend.ordinal
            )
          ).toBe(false)
          const privateHeld = yield* readPrivateAttempt(
            fixture.configuration.codexExecutorPrivateStateDirectory,
            plan.operation.plannedAttempt
          )
          expect(privateHeld).toEqual(privateBefore)
          yield* provider.releaseReconciliation
          yield* recovered.take("Idle")
          yield* recovered.send("History")
          const settled = yield* recovered.take("History")
          if (settled._tag !== "History") return yield* Effect.die("missing settled history")
          expect(settled.records.filter(({ event }) => event._tag === "TaskAttemptPlanned")).toEqual(plans)
          expect((yield* Ref.get(recovered.log)).filter((event) => event._tag === "ActivationFailed")).toEqual([])
          expect(
            settled.records.filter(
              ({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended" && event.command === "Begin"
            )
          ).toHaveLength(1)
          expect((yield* Ref.get(provider.calls)).filter((request) => request._tag === "StartTurn")).toHaveLength(2)
          expect((yield* Ref.get(provider.calls)).filter((request) => request._tag === "InterruptTurn")).toEqual([
            { _tag: "InterruptTurn", threadId: privateBefore.threadId, turnId: privateBefore.observedTurnId }
          ])
          expect((yield* Ref.get(provider.calls)).filter((request) => request._tag === "ResumeThread")).toContainEqual({
            _tag: "ResumeThread",
            threadId: privateBefore.threadId,
            cwd: privateBefore.worktree
          })
          expect(
            settled.records
              .filter(({ event }) => event._tag === "PlannedAttemptExecutorWorkReported")
              .map(({ event }) => event)
          ).toMatchObject([
            {
              report: {
                _tag: "ExecutorWorkExecuting",
                correlation: { runId, attemptId: plan.operation.plannedAttempt.attemptId }
              }
            },
            {
              report: {
                _tag: "ExecutorWorkSafelySuspended",
                correlation: { runId, attemptId: plan.operation.plannedAttempt.attemptId }
              }
            },
            {
              report: {
                _tag: "ExecutorWorkExecuting",
                correlation: { runId, attemptId: plan.operation.plannedAttempt.attemptId }
              }
            }
          ])
          const privateAfter = yield* readPrivateAttempt(
            fixture.configuration.codexExecutorPrivateStateDirectory,
            plan.operation.plannedAttempt
          )
          expect(privateAfter.threadId).toBe(privateBefore.threadId)
          expect(privateAfter.correlationAttemptId).toBe(privateBefore.correlationAttemptId)
          expect(privateAfter.correlationRunId).toBe(privateBefore.correlationRunId)
          expect(privateAfter.observedTurnId).not.toBe(privateBefore.observedTurnId)
          expect(settled.records.some(({ event }) => /Cleanup|Released|Abandoned/.test(event._tag))).toBe(false)
          expect(settled.records.filter(({ event }) => event._tag === "ControlDirectionApplied")).toHaveLength(2)
          const cassette = yield* projectRecordedCassette(settled.records)
          expect(
            verifyRecordedCassetteRoundTrip(settled.records, cassette).every(
              (checkpoint) => checkpoint.workflowHistoryEquivalent
            )
          ).toBe(true)
          expect(yield* recovered.kill).toEqual({ code: null, signal: "SIGKILL" })
        })
      ).pipe(Effect.provide(runningHostFixtureLayer)),
    60000
  )
