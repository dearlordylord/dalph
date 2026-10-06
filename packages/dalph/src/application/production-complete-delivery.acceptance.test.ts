/* eslint-disable import/no-nodejs-modules -- Acceptance records the actual built CLI locator. */
import { fileURLToPath } from "node:url"
import { TaskWorkCapacity, attachCurrentSignal, GitCommand } from "@dalph/orchestrator"
import { it } from "@effect/vitest"
import { Deferred, Duration, Effect, FileSystem, Ref, Stream } from "effect"
import { expect } from "vitest"
import { makeRunningHostFixture, runningHostFixtureLayer } from "../../test-support/production-running-host-fixture.js"
import { publicDeliveryClient, losePublicDeliveryWatchClient } from "../../test-support/public-delivery-client.js"
import { availableLocalHostAddress } from "../../test-support/running-host-read-probe.js"
import { projectRecordedCassette, verifyRecordedCassetteRoundTrip } from "../cassettes/recorded.js"
import { withDecodedProductionRepositoryHost } from "./production-host.js"
import { ProductionRunReactivationInterval } from "./production.js"
import { serveRunningHost } from "./running-host-http.js"
const lastRecordOffset = -1
const builtEntry = fileURLToPath(new URL("../../dist/bin/dalph.js", import.meta.url))
it.live.each(["CLIWhole", "CLIAdvisory", "MCPWhole", "MCPAdvisory", "Timer"] as const)(
  "public clients follow A, B and E discovered by %s through delivery before C completes",
  (discovery) =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeRunningHostFixture(builtEntry, true, undefined, { completeDelivery: true })
        const address = yield* availableLocalHostAddress
        yield* withDecodedProductionRepositoryHost(
          {
            ...fixture.configuration,
            taskWorkCapacity: TaskWorkCapacity.make(1),
            activationInterval: ProductionRunReactivationInterval.make(Duration.seconds(1))
          },
          fixture.graph,
          (observation) =>
            Effect.scoped(
              Effect.gen(function* () {
                yield* serveRunningHost(address, observation)
                yield* Deferred.await(fixture.turnEntered).pipe(Effect.timeout("20 seconds"))
                yield* Deferred.await(fixture.activationFinalizing).pipe(Effect.timeout("20 seconds"))
                const runId = observation.selection.runId
                const [c, a, b, e] = fixture.taskIds
                if (c === undefined || a === undefined || b === undefined || e === undefined)
                  return expect.fail("requires authored E identity")
                const before = yield* fixture.readHistory(runId)
                const plansBefore = before.filter(({ event }) => event._tag === "TaskAttemptPlanned")
                expect(plansBefore).toHaveLength(1)
                expect(plansBefore[0]).toMatchObject({ event: { operation: { plannedAttempt: { taskId: a } } } })
                const cli = yield* publicDeliveryClient("CLI", address, runId)
                expect(cli).toEqual(yield* publicDeliveryClient("MCP", address, runId))
                expect(yield* fixture.readHistory(runId)).toEqual(before)
                expect(yield* Ref.get(fixture.exitCalls)).toBe(0)
                for (const adapter of ["CLI", "MCP"] as const) {
                  yield* losePublicDeliveryWatchClient(adapter, address, runId)
                  expect(yield* fixture.readHistory(runId)).toEqual(before)
                  expect(yield* Ref.get(fixture.exitCalls)).toBe(0)
                }
                yield* fixture.releaseObservationCut
                const operatorAdapter = discovery.startsWith("MCP") ? "MCP" : "CLI"
                expect(yield* publicDeliveryClient(operatorAdapter, address, runId, "set-capacity")).toMatchObject({
                  _tag: "Success",
                  value: { _tag: "CapacityApplied" }
                })
                expect(yield* publicDeliveryClient(operatorAdapter, address, runId, "start")).toMatchObject({
                  _tag: "Success",
                  value: { _tag: "WakeSubmitted" }
                })
                expect(yield* publicDeliveryClient(operatorAdapter, address, runId, "unpause")).toMatchObject({
                  _tag: "Success",
                  value: { _tag: "UnpauseApplied" }
                })
                yield* Effect.scoped(
                  Effect.gen(function* () {
                    const signal = yield* attachCurrentSignal(observation.current)
                    const holdsBoth = (state: typeof signal.current) =>
                      state._tag === "Ready" && state.evaluation.taskWork.held.length === 2
                    if (!holdsBoth(signal.current)) yield* signal.changes.pipe(Stream.filter(holdsBoth), Stream.runHead)
                  })
                ).pipe(Effect.timeout("20 seconds"))
                const afterCapacityPlans = (yield* fixture.readHistory(runId)).filter(
                  ({ event }) => event._tag === "TaskAttemptPlanned"
                )
                expect(afterCapacityPlans).toHaveLength(2)
                expect(
                  afterCapacityPlans.map(({ event }) =>
                    event._tag === "TaskAttemptPlanned" ? event.operation.plannedAttempt.taskId : null
                  )
                ).toEqual([a, b])
                yield* fixture.authorE
                if (discovery !== "Timer") {
                  const interest = discovery.endsWith("Advisory")
                    ? { _tag: "AdvisoryTasks" as const, taskIds: [c, e] as const }
                    : { _tag: "WholeGraph" as const }
                  expect(
                    yield* publicDeliveryClient(operatorAdapter, address, runId, "refresh", interest)
                  ).toMatchObject({ _tag: "Success", value: { _tag: "RefreshSubmitted", interest } })
                }
                yield* Effect.scoped(
                  Effect.gen(function* () {
                    const signal = yield* attachCurrentSignal(observation.current)
                    const includesE = (state: typeof signal.current) =>
                      state._tag === "Ready" &&
                      state.evaluation.current.trackerGraph._tag === "GraphEstablished" &&
                      state.evaluation.current.trackerGraph.observation.snapshot.taskIds().includes(e)
                    if (!includesE(signal.current)) yield* signal.changes.pipe(Stream.filter(includesE), Stream.runHead)
                  })
                ).pipe(Effect.timeout("20 seconds"))
                expect(
                  (yield* fixture.readHistory(runId)).filter(({ event }) => event._tag === "TaskAttemptPlanned")
                ).toEqual(afterCapacityPlans)
                // The ordinary owner's timer reads the authored tracker graph; no client controls task selection.
                yield* fixture.release
                const termination = yield* observation.runTermination.await.pipe(Effect.timeout("30 seconds"))
                expect(termination.disposition).toBe("Completed")
                const expected = {
                  _tag: "Success",
                  value: { _tag: "RunTerminated", terminationEvidence: { _tag: "Accepted", ...termination } }
                }
                expect(yield* publicDeliveryClient("CLI", address, runId, "control")).toEqual(expected)
                expect(yield* publicDeliveryClient("MCP", address, runId, "control")).toEqual(expected)
                const records = yield* fixture.readHistory(runId)
                expect(records.filter(({ event }) => event._tag === "WorkflowRunBegan")).toHaveLength(1)
                const plans = records.flatMap(({ event, position }) =>
                  event._tag === "TaskAttemptPlanned" ? [{ planned: event.operation.plannedAttempt, position }] : []
                )
                expect(plans.map(({ planned }) => planned.taskId)).toEqual([a, b, e, c])
                for (const tag of [
                  "TargetPromotionObservedSuccess",
                  "IntegrationFinalitySettled",
                  "WorktreeCleanupSettled",
                  "BranchCleanupSettled",
                  "IntegratorCandidateCleanupSettled",
                  "CompletionClaimDeleted"
                ] as const)
                  expect(records.filter(({ event }) => event._tag === tag)).toHaveLength(4)
                const cPlan = plans.at(lastRecordOffset)
                expect(cPlan).toBeDefined()
                const confirmed = records.filter(
                  ({ event }) =>
                    event._tag === "TaskTrackerFactsObserved" &&
                    event.observation._tag === "FocusedTaskCompletionFacts" &&
                    event.observation.purpose._tag === "Confirmation" &&
                    event.observation.facts.lifecycle === "CompletedSuccessfully"
                )
                expect(confirmed).toHaveLength(4)
                expect(confirmed.slice(0, 3).every(({ position }) => position < (cPlan?.position ?? 0))).toBe(true)
                const fs = yield* FileSystem.FileSystem
                const git = yield* GitCommand
                for (const { planned, position } of plans) {
                  expect(planned.runId).toBe(runId)
                  const claims = records.filter(
                    ({ event }) => event._tag === "TaskClaimAcquired" && event.claim.taskId === planned.taskId
                  )
                  expect(claims).toHaveLength(1)
                  expect(claims[0]?.position).toBeLessThan(position)
                  const confirmations = confirmed.filter(
                    ({ event }) =>
                      event._tag === "TaskTrackerFactsObserved" &&
                      event.observation._tag === "FocusedTaskCompletionFacts" &&
                      event.observation.facts.taskId === planned.taskId
                  )
                  expect(confirmations).toHaveLength(1)
                  expect(confirmations[0]?.position).toBeGreaterThan(position)
                  const completionDeleted = records.filter(
                    ({ event }) =>
                      event._tag === "CompletionClaimDeleted" &&
                      event.claim.plannedAttempt.attemptId === planned.attemptId
                  )
                  expect(completionDeleted).toHaveLength(1)
                  expect(completionDeleted[0]).toMatchObject({ event: { claim: { plannedAttempt: planned } } })
                  expect(planned.baseSha).toBe(fixture.configuration.plannedAttemptBaseSha)
                  expect(yield* fs.exists(planned.worktree)).toBe(false)
                  expect(
                    (yield* git.runInWorktree(fixture.configuration.repository, [
                      "show-ref",
                      "--verify",
                      "--quiet",
                      planned.branch
                    ])).exitCode
                  ).toBe(1)
                  const worktreeCleanup = records.find(
                    ({ event }) =>
                      event._tag === "WorktreeCleanupSettled" && event.authorization.locator === planned.worktree
                  )
                  expect(worktreeCleanup).toMatchObject({
                    event: {
                      authorization: {
                        owner: { attemptId: planned.attemptId, branch: planned.branch },
                        disposition: { _tag: "Settled", plannedAttempt: planned }
                      }
                    }
                  })
                  const branchCleanup = records.find(
                    ({ event }) =>
                      event._tag === "BranchCleanupSettled" && event.authorization.locator === planned.branch
                  )
                  expect(branchCleanup).toMatchObject({
                    event: {
                      authorization: {
                        owner: { attemptId: planned.attemptId },
                        disposition: { _tag: "Settled", plannedAttempt: planned }
                      }
                    }
                  })
                  const begins = records.filter(
                    ({ event }) =>
                      event._tag === "PlannedAttemptExecutorCommandIntended" &&
                      event.command === "Begin" &&
                      event.plannedAttempt.attemptId === planned.attemptId
                  )
                  expect(begins).toHaveLength(1)
                  expect(begins[0]?.position).toBeGreaterThan(position)
                  const accepted = records.filter(
                    ({ event }) =>
                      event._tag === "PlannedAttemptExecutorWorkReported" &&
                      event.report.correlation.attemptId === planned.attemptId &&
                      event.report._tag === "ExecutorWorkTerminal" &&
                      event.report.result._tag === "Accepted"
                  )
                  expect(accepted).toHaveLength(1)
                  const terminal = accepted[0]?.event
                  if (
                    terminal?._tag !== "PlannedAttemptExecutorWorkReported" ||
                    terminal.report._tag !== "ExecutorWorkTerminal" ||
                    terminal.report.result._tag !== "Accepted"
                  )
                    return expect.fail("requires the exact accepted task commit")
                  const commit = terminal.report.result.acceptedResult.commit
                  expect(
                    (yield* git.runInWorktree(fixture.configuration.repository, [
                      "merge-base",
                      "--is-ancestor",
                      planned.baseSha,
                      commit
                    ])).exitCode
                  ).toBe(0)
                  expect(
                    (yield* git.runInWorktree(fixture.configuration.repository, [
                      "merge-base",
                      "--is-ancestor",
                      commit,
                      fixture.configuration.integrationRef
                    ])).exitCode
                  ).toBe(0)
                  expect(accepted.at(lastRecordOffset)?.position).toBeLessThan(worktreeCleanup?.position ?? 0)
                }
                const worktrees = yield* git.runInWorktree(fixture.configuration.repository, [
                  "worktree",
                  "list",
                  "--porcelain"
                ])
                expect(worktrees.stdout).not.toContain(fixture.configuration.plannedAttemptWorktreeRoot)
                expect(worktrees.stdout).not.toContain(fixture.configuration.integratorCandidateWorktreeRoot)
                expect(yield* Ref.get(fixture.failures)).toEqual([])
                expect(yield* Ref.get(fixture.exitCalls)).toBe(0)
                expect(yield* fixture.provider.snapshot()).toMatchObject({
                  activeClaimCount: 0,
                  completionClaimCount: 0
                })
                const cassette = yield* projectRecordedCassette(records)
                expect(cassette.entries.at(lastRecordOffset)).toMatchObject({
                  _tag: "WorkflowRunTerminated",
                  disposition: "Completed"
                })
                expect(
                  verifyRecordedCassetteRoundTrip(records, cassette).every(
                    (checkpoint) =>
                      checkpoint.operationalStateEquivalent &&
                      checkpoint.workflowHistoryEquivalent &&
                      checkpoint.pureSelectionEquivalent &&
                      checkpoint.appliedOccurrencePositionEquivalent
                  )
                ).toBe(true)
              })
            ).pipe(Effect.ensuring(fixture.releaseObservationCut)),
          "Run",
          "Listening"
        )
      })
    ).pipe(Effect.provide(runningHostFixtureLayer)),
  60000
)
