/* eslint-disable import/no-nodejs-modules -- Acceptance starts the actual public CLI and MCP children and reads real Git worktrees. */
import { execFile } from "node:child_process"
import process from "node:process"
import { fileURLToPath } from "node:url"
import { type RunId } from "@dalph/contracts"
import { GitCommand, TaskWorkCapacity } from "@dalph/orchestrator"
import { it } from "@effect/vitest"
import { Deferred, Duration, Effect, Queue, Ref, Schema } from "effect"
import { TestClock } from "effect/testing"
import { expect } from "vitest"
import { makeRunningHostFixture, runningHostFixtureLayer } from "../../test-support/production-running-host-fixture.js"
import { availableLocalHostAddress } from "../../test-support/running-host-read-probe.js"
import { projectRecordedCassette, verifyRecordedCassetteRoundTrip } from "../cassettes/recorded.js"
import { withDecodedProductionRepositoryHost } from "./production-host.js"
import { ProductionRunReactivationInterval } from "./production.js"
import { RunningHostEnvelope } from "./running-host-contract.js"
import { serveRunningHost } from "./running-host-http.js"

const builtEntry = fileURLToPath(new URL("../../dist/bin/dalph.js", import.meta.url))
class IntermediateClientFailure extends Schema.TaggedError<IntermediateClientFailure>()("IntermediateClientFailure", {
  detail: Schema.String
}) {}
const snapshotClient = (adapter: "CLI" | "MCP", address: string, runId: RunId) =>
  Effect.tryPromise({
    try: (signal) =>
      new Promise<string>((resolve, reject) => {
        const child = execFile(
          process.execPath,
          [
            builtEntry,
            ...(adapter === "CLI"
              ? ["attach", "snapshot", "--host", address, "--run", runId, "--json"]
              : ["mcp", "--host", address, "--run", runId])
          ],
          { signal, timeout: 10000 },
          (error, stdout, stderr) => {
            if (error === null) resolve(stdout)
            else reject(new Error(`${stderr}: ${stdout}`))
          }
        )
        child.stdin?.end(
          adapter === "CLI"
            ? ""
            : [
                {
                  jsonrpc: "2.0",
                  id: 1,
                  method: "initialize",
                  params: {
                    protocolVersion: "2025-11-25",
                    capabilities: {},
                    clientInfo: { name: "intermediate", version: "1" }
                  }
                },
                { jsonrpc: "2.0", method: "notifications/initialized" },
                {
                  jsonrpc: "2.0",
                  id: 2,
                  method: "tools/call",
                  params: { name: "dalph_read_snapshot", arguments: { runId } }
                }
              ]
                .map((message) => JSON.stringify(message))
                .join("\n") + "\n"
        )
      }),
    catch: (error) => new IntermediateClientFailure({ detail: String(error) })
  }).pipe(
    Effect.flatMap((stdout) => {
      const reply = JSON.parse(stdout.trim().split("\n").at(-1) ?? "")
      return Schema.decodeUnknownEffect(RunningHostEnvelope)(adapter === "CLI" ? reply : reply.result.structuredContent)
    }),
    Effect.map((envelope) => envelope.result)
  )

for (const evidence of ["Complete", "MissingPage", "MissingBlocker", "Contradictory", "Unreadable"] as const) {
  it.effect(
    `timer reads ${evidence} authored D evidence before later edits and both clients preserve its exact meaning`,
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const idle = yield* Queue.unbounded<void>()
          const armed = yield* Ref.make(false)
          const entered = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          const fixture = yield* makeRunningHostFixture(
            builtEntry,
            true,
            undefined,
            {
              independentB: true,
              authoredIntermediateD: true,
              onActivationIdle: () => Queue.offer(idle, undefined).pipe(Effect.asVoid),
              onRootGraphRead: () =>
                Ref.getAndSet(armed, false).pipe(
                  Effect.flatMap((hold) =>
                    hold
                      ? Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)))
                      : Effect.void
                  )
                )
            },
            true
          )
          const address = yield* availableLocalHostAddress
          const git = yield* GitCommand
          yield* withDecodedProductionRepositoryHost(
            {
              ...fixture.configuration,
              taskWorkCapacity: TaskWorkCapacity.make(2),
              activationInterval: ProductionRunReactivationInterval.make(Duration.hours(1))
            },
            fixture.graph,
            (observation) =>
              Effect.scoped(
                Effect.gen(function* () {
                  yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.asVoid))
                  yield* serveRunningHost(address, observation)
                  const runId = observation.selection.runId
                  yield* Deferred.await(fixture.turnEntered).pipe(Effect.timeout("20 seconds"))
                  yield* Deferred.await(fixture.activationFinalizing).pipe(Effect.timeout("20 seconds"))
                  yield* fixture.releaseObservationCut
                  yield* Queue.take(idle).pipe(Effect.timeout("20 seconds"))
                  const initial = yield* fixture.readHistory(runId)
                  const initialGit = yield* Ref.get(fixture.gitInvocations)
                  expect(initial.filter(({ event }) => event._tag === "TaskAttemptPlanned")).toHaveLength(1)
                  const initialCli = yield* snapshotClient("CLI", address, runId)
                  expect(initialCli).toEqual(yield* snapshotClient("MCP", address, runId))
                  expect(initialCli).toMatchObject({
                    value: {
                      graph: {
                        _tag: "GraphEstablished",
                        snapshot: { tasks: [expect.objectContaining({ id: fixture.taskIds[0] })] }
                      }
                    }
                  })
                  yield* fixture.authorD
                  if (evidence !== "Complete") {
                    yield* fixture.authorE
                    yield* fixture.setIncompleteEvidence(evidence)
                  }
                  yield* Ref.set(armed, true)
                  yield* TestClock.adjust("1 hour")
                  yield* Deferred.await(entered).pipe(Effect.timeout("20 seconds"))
                  const heldHistory = yield* fixture.readHistory(runId)
                  const heldGit = yield* Ref.get(fixture.gitCalls)
                  const heldProvider = yield* fixture.provider.snapshot()
                  const cli = yield* snapshotClient("CLI", address, runId)
                  const mcp = yield* snapshotClient("MCP", address, runId)
                  expect(cli).toEqual(mcp)
                  expect(cli).toMatchObject({
                    _tag: "Success",
                    value: { _tag: "Ready", graph: { _tag: "GraphNotEstablished" } }
                  })
                  expect(yield* fixture.readHistory(runId)).toEqual(heldHistory)
                  expect(yield* Ref.get(fixture.gitCalls)).toBe(heldGit)
                  expect((yield* fixture.provider.snapshot()).operationCounts).toEqual(heldProvider.operationCounts)
                  yield* Queue.clear(idle)
                  yield* Deferred.succeed(release, undefined)
                  if (evidence !== "Complete") yield* TestClock.adjust("1 minute")
                  yield* Queue.take(idle).pipe(Effect.timeout("20 seconds"))
                  const observed = yield* fixture.readHistory(runId)
                  expect(observed.slice(initial.length)).toContainEqual(
                    expect.objectContaining({
                      event: expect.objectContaining({
                        _tag: "TaskTrackerReadIntentRecorded",
                        operation: expect.objectContaining({
                          _tag: "ReadTrackerGraph",
                          cause: { _tag: "ExecutingWorkAuthorityCheck" }
                        })
                      })
                    })
                  )
                  const plans = observed.flatMap(({ event }) =>
                    event._tag === "TaskAttemptPlanned" ? [event.operation.plannedAttempt] : []
                  )
                  if (evidence === "Complete") {
                    expect(plans).toHaveLength(2)
                    const d = plans.find((plan) => plan.taskId === fixture.taskIds[1])
                    if (d === undefined) return yield* Effect.die("timer must admit authored D")
                    const completeDIndex = observed.findIndex(
                      ({ event }) =>
                        event._tag === "TaskTrackerFactsObserved" &&
                        event.observation._tag === "CompleteTaskTrackerFacts" &&
                        event.observation.factFamilies[2].prerequisites.some(
                          (row) => row.taskId === d.taskId && row.prerequisiteTaskIds.length === 0
                        )
                    )
                    const dPlanIndex = observed.findIndex(
                      ({ event }) =>
                        event._tag === "TaskAttemptPlanned" && event.operation.plannedAttempt.attemptId === d.attemptId
                    )
                    const dBeginIndex = observed.findIndex(
                      ({ event }) =>
                        event._tag === "PlannedAttemptExecutorCommandIntended" &&
                        event.command === "Begin" &&
                        event.plannedAttempt.attemptId === d.attemptId
                    )
                    expect(completeDIndex).toBeGreaterThanOrEqual(initial.length)
                    expect(dPlanIndex).toBeGreaterThan(completeDIndex)
                    expect(dBeginIndex).toBeGreaterThan(dPlanIndex)
                    expect(d.baseSha).toBe(fixture.configuration.plannedAttemptBaseSha)
                    const beforeHead = yield* git.runInWorktree(d.worktree, ["rev-parse", "HEAD"])
                    const beforeBranch = yield* git.runInWorktree(d.worktree, ["symbolic-ref", "HEAD"])
                    expect(beforeHead.exitCode).toBe(0)
                    expect(beforeBranch.stdout.trim()).toBe(d.branch)
                    expect(
                      (yield* git.runInWorktree(d.worktree, ["merge-base", "--is-ancestor", d.baseSha, "HEAD"]))
                        .exitCode
                    ).toBe(0)
                    expect(observed).toContainEqual(
                      expect.objectContaining({
                        event: expect.objectContaining({
                          _tag: "TaskClaimAcquired",
                          claim: expect.objectContaining({ taskId: d.taskId })
                        })
                      })
                    )
                    expect(observed).toContainEqual(
                      expect.objectContaining({
                        event: expect.objectContaining({
                          _tag: "PlannedAttemptExecutorCommandIntended",
                          command: "Begin",
                          plannedAttempt: d
                        })
                      })
                    )
                    const orderBefore = yield* Ref.get(fixture.observationOrder)
                    expect(orderBefore.filter((step) => step === "ExecutorBegin")).toHaveLength(2)
                    expect(orderBefore.indexOf("AuthoredD")).toBeLessThan(orderBefore.lastIndexOf("ExecutorBegin"))
                    const dBlockerRead = orderBefore.indexOf(
                      "ReadBlockedBy:hermetic-dependant-issue",
                      orderBefore.indexOf("AuthoredD")
                    )
                    expect(dBlockerRead).toBeGreaterThan(orderBefore.indexOf("AuthoredD"))
                    expect(dBlockerRead).toBeLessThan(orderBefore.lastIndexOf("ExecutorBegin"))
                    const beforeEdit = yield* fixture.provider.snapshot()
                    const beforeEditGit = yield* Ref.get(fixture.gitInvocations)
                    yield* fixture.authorE
                    yield* TestClock.adjust("1 hour")
                    yield* Queue.take(idle).pipe(Effect.timeout("20 seconds"))
                    const after = yield* fixture.readHistory(runId)
                    expect(after.filter(({ event }) => event._tag === "TaskAttemptPlanned")).toEqual(
                      observed.filter(({ event }) => event._tag === "TaskAttemptPlanned")
                    )
                    expect(after.filter(({ event }) => event._tag === "TaskClaimAcquired")).toEqual(
                      observed.filter(({ event }) => event._tag === "TaskClaimAcquired")
                    )
                    const forbidden = [
                      "CodexInterruptTurn",
                      "CodexStartTurn",
                      "CodexStartThread",
                      "CreateClaimLabel",
                      "DeleteClaimLabel"
                    ]
                    expect(
                      (yield* fixture.provider.snapshot()).operationCounts.filter(({ tag }) => forbidden.includes(tag))
                    ).toEqual(beforeEdit.operationCounts.filter(({ tag }) => forbidden.includes(tag)))
                    expect((yield* Ref.get(fixture.observationOrder)).indexOf("AuthoredE")).toBeGreaterThan(
                      orderBefore.lastIndexOf("ExecutorBegin")
                    )
                    const afterGit = (yield* Ref.get(fixture.gitInvocations)).slice(beforeEditGit.length)
                    expect(
                      afterGit.every(
                        ({ args }) =>
                          ["rev-parse", "merge-base", "worktree"].includes(args[0] ?? "") &&
                          (args[0] !== "worktree" || args[1] === "list")
                      )
                    ).toBe(true)
                    expect(
                      after
                        .slice(observed.length)
                        .some(({ event }) =>
                          [
                            "WorktreeCleanupMutationIntended",
                            "BranchCleanupMutationIntended",
                            "IntegratorCandidateCleanupMutationIntended",
                            "AttemptImplementationAbandoned",
                            "TaskClaimReleaseIntended"
                          ].includes(event._tag)
                        )
                    ).toBe(false)
                    const afterHead = yield* git.runInWorktree(d.worktree, ["rev-parse", "HEAD"])
                    const afterBranch = yield* git.runInWorktree(d.worktree, ["symbolic-ref", "HEAD"])
                    expect(afterHead).toEqual(beforeHead)
                    expect(afterBranch).toEqual(beforeBranch)
                    const afterCli = yield* snapshotClient("CLI", address, runId)
                    expect(afterCli).toEqual(yield* snapshotClient("MCP", address, runId))
                    expect(afterCli).toMatchObject({
                      value: {
                        _tag: "Ready",
                        graph: {
                          _tag: "GraphEstablished",
                          snapshot: {
                            tasks: expect.arrayContaining([
                              expect.objectContaining({ id: d.taskId, prerequisiteIds: [fixture.taskIds[3]] })
                            ])
                          }
                        },
                        held: expect.arrayContaining([
                          expect.objectContaining({ taskId: d.taskId, correlation: { runId, attemptId: d.attemptId } })
                        ])
                      }
                    })
                  } else {
                    expect(plans).toHaveLength(1)
                    expect(observed.filter(({ event }) => event._tag === "TaskClaimAcquired")).toEqual(
                      initial.filter(({ event }) => event._tag === "TaskClaimAcquired")
                    )
                    expect(
                      (yield* Ref.get(fixture.observationOrder)).filter((step) => step === "ExecutorBegin")
                    ).toHaveLength(1)
                    expect(
                      observed
                        .slice(initial.length)
                        .some(
                          ({ event }) =>
                            event._tag === "TaskTrackerFactsObserved" &&
                            event.observation._tag === "CompleteTaskTrackerFacts"
                        )
                    ).toBe(false)
                    expect(
                      observed.slice(initial.length).some(({ event }) => event._tag === "TaskTrackerFactsObserved")
                    ).toBe(true)
                    const failedCli = yield* snapshotClient("CLI", address, runId)
                    expect(failedCli).toEqual(yield* snapshotClient("MCP", address, runId))
                    const a = plans[0]
                    if (a === undefined) return yield* Effect.die("failed reads must retain A")
                    expect(failedCli).toMatchObject({
                      value: {
                        _tag: "Ready",
                        graph: { _tag: "GraphNotEstablished" },
                        held: [
                          expect.objectContaining({ taskId: a.taskId, correlation: { runId, attemptId: a.attemptId } })
                        ]
                      }
                    })
                    expect(
                      (yield* Ref.get(fixture.gitInvocations))
                        .slice(initialGit.length)
                        .every(
                          ({ args }) =>
                            ["rev-parse", "merge-base", "worktree"].includes(args[0] ?? "") &&
                            (args[0] !== "worktree" || args[1] === "list")
                        )
                    ).toBe(true)
                    yield* fixture.setIncompleteEvidence(null)
                    yield* TestClock.adjust("1 hour")
                    yield* Queue.take(idle).pipe(Effect.timeout("20 seconds"))
                    const recoveredCli = yield* snapshotClient("CLI", address, runId)
                    expect(recoveredCli).toEqual(yield* snapshotClient("MCP", address, runId))
                    expect(recoveredCli).toMatchObject({
                      value: {
                        graph: {
                          _tag: "GraphEstablished",
                          snapshot: {
                            tasks: expect.arrayContaining([
                              expect.objectContaining({ id: fixture.taskIds[1], prerequisiteIds: [fixture.taskIds[3]] })
                            ])
                          }
                        }
                      }
                    })
                    expect(
                      (yield* fixture.readHistory(runId)).filter(({ event }) => event._tag === "TaskAttemptPlanned")
                    ).toHaveLength(1)
                  }
                  const records = yield* fixture.readHistory(runId)
                  const cassette = yield* projectRecordedCassette(records)
                  expect(
                    verifyRecordedCassetteRoundTrip(records, cassette).every(
                      (checkpoint) =>
                        checkpoint.workflowHistoryEquivalent &&
                        checkpoint.operationalStateEquivalent &&
                        checkpoint.pureSelectionEquivalent &&
                        checkpoint.appliedOccurrencePositionEquivalent
                    )
                  ).toBe(true)
                  expect(yield* Ref.get(fixture.exitCalls)).toBe(0)
                }).pipe(Effect.ensuring(observation.applicationExitRequestBoundary.requestExit.pipe(Effect.asVoid)))
              ),
            "Run",
            "Listening"
          )
        })
      ).pipe(Effect.provide(runningHostFixtureLayer)),
    60000
  )
}
