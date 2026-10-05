/* eslint-disable import/no-nodejs-modules -- The composed fixture uses the built CLI location and real Git worktrees. */
import { fileURLToPath } from "node:url"
import { it } from "@effect/vitest"
import { GitCommand, RunPolicyRevision, TaskWorkCapacity } from "@dalph/orchestrator"
import { Deferred, Effect, Ref } from "effect"
import { expect } from "vitest"
import { makeRunningHostFixture, runningHostFixtureLayer } from "../../test-support/production-running-host-fixture.js"
import { availableLocalHostAddress } from "../../test-support/running-host-read-probe.js"
import { withDecodedProductionRepositoryHost } from "./production-host.js"
import { callRunningHost } from "./running-host-client.js"
import { serveRunningHost } from "./running-host-http.js"
import { projectRecordedCassette, verifyRecordedCassetteRoundTrip } from "../cassettes/recorded.js"

const builtEntry = fileURLToPath(new URL("../../dist/bin/dalph.js", import.meta.url))

it.live(
  "the agent raises and lowers capacity, admits B through actual claim worktree and Begin, and retains both exact attempts",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const holdGraph = yield* Ref.make(false)
        const graphEntered = yield* Deferred.make<void>()
        const graphRelease = yield* Deferred.make<void>()
        const secondBegin = yield* Deferred.make<void>()
        const returnSecondBegin = yield* Deferred.make<void>()
        const turnCalls = yield* Ref.make(0)
        const idleCalls = yield* Ref.make(0)
        const secondIdle = yield* Deferred.make<void>()
        const fixture = yield* makeRunningHostFixture(
          builtEntry,
          true,
          undefined,
          {
            independentB: true,
            onActivationIdle: () =>
              Ref.updateAndGet(idleCalls, (count) => count + 1).pipe(
                Effect.flatMap((count) =>
                  count === 2 ? Deferred.succeed(secondIdle, undefined).pipe(Effect.asVoid) : Effect.void
                )
              ),
            onRootGraphRead: () =>
              Ref.get(holdGraph).pipe(
                Effect.flatMap((hold) =>
                  hold
                    ? Deferred.succeed(graphEntered, undefined).pipe(Effect.andThen(Deferred.await(graphRelease)))
                    : Effect.void
                )
              ),
            onExecutorTurnStarted: () =>
              Ref.updateAndGet(turnCalls, (count) => count + 1).pipe(
                Effect.flatMap((count) =>
                  count === 2
                    ? Deferred.succeed(secondBegin, undefined).pipe(Effect.andThen(Deferred.await(returnSecondBegin)))
                    : Effect.void
                )
              )
          },
          true
        )
        const address = yield* availableLocalHostAddress
        const git = yield* GitCommand
        yield* withDecodedProductionRepositoryHost(
          fixture.configuration,
          fixture.graph,
          (observation) =>
            Effect.scoped(
              Effect.gen(function* () {
                yield* Effect.addFinalizer(() =>
                  Effect.all([
                    Deferred.succeed(graphRelease, undefined),
                    Deferred.succeed(returnSecondBegin, undefined)
                  ]).pipe(
                    Effect.andThen(fixture.releaseObservationCut),
                    Effect.andThen(observation.applicationExitRequestBoundary.requestExit),
                    Effect.asVoid
                  )
                )
                yield* serveRunningHost(address, observation)
                const runId = observation.selection.runId
                yield* Deferred.await(fixture.turnEntered).pipe(Effect.timeout("20 seconds"))
                yield* Deferred.await(fixture.activationFinalizing).pipe(Effect.timeout("10 seconds"))
                const initial = yield* fixture.readHistory(runId)
                expect(initial.filter(({ event }) => event._tag === "TaskAttemptPlanned")).toHaveLength(1)
                yield* fixture.releaseObservationCut
                yield* Deferred.await(fixture.activationIdle).pipe(Effect.timeout("10 seconds"))
                yield* Ref.set(holdGraph, true)
                expect(yield* callRunningHost(address, runId, { _tag: "StartWork" })).toMatchObject({
                  result: { value: { _tag: "WakeSubmitted" } }
                })
                yield* Deferred.await(graphEntered).pipe(Effect.timeout("10 seconds"))
                expect(yield* callRunningHost(address, runId, { _tag: "ReadCapacity" })).toMatchObject({
                  result: { value: { policy: { revision: 1, taskExecutionCapacity: 1 } } }
                })
                expect(
                  yield* callRunningHost(address, runId, {
                    _tag: "SetCapacity",
                    capacity: TaskWorkCapacity.make(2),
                    expectedRevision: RunPolicyRevision.make(1)
                  })
                ).toMatchObject({
                  result: { value: { _tag: "CapacityApplied", policy: { revision: 2, taskExecutionCapacity: 2 } } }
                })
                yield* Ref.set(holdGraph, false)
                yield* Deferred.succeed(graphRelease, undefined)
                yield* Deferred.await(secondBegin).pipe(Effect.timeout("20 seconds"))
                const beforeContraction = yield* fixture.readHistory(runId)
                const plans = beforeContraction.flatMap(({ event }) =>
                  event._tag === "TaskAttemptPlanned" ? [event.operation.plannedAttempt] : []
                )
                // The tracker identities sort the dependant first: it is A; the grouping root is B.
                expect(
                  initial.flatMap(({ event }) =>
                    event._tag === "TaskAttemptPlanned" ? [event.operation.plannedAttempt.taskId] : []
                  )
                ).toEqual([fixture.taskIds[1]])
                expect(plans.map((plan) => plan.taskId)).toEqual([fixture.taskIds[1], fixture.taskIds[0]])
                const claims = beforeContraction.filter(({ event }) => event._tag === "TaskClaimAcquired")
                expect(claims).toHaveLength(2)
                const begins = beforeContraction.flatMap((record) =>
                  record.event._tag === "PlannedAttemptExecutorCommandIntended" && record.event.command === "Begin"
                    ? [record]
                    : []
                )
                expect(begins).toHaveLength(2)
                for (const plan of plans) {
                  expect(plan.baseSha).toBe(fixture.configuration.plannedAttemptBaseSha)
                  const head = yield* git.runInWorktree(plan.worktree, ["rev-parse", "HEAD"])
                  expect(head.exitCode).toBe(0)
                  // The controlled provider may already have created its task result commit.
                  const base = yield* git.runInWorktree(plan.worktree, [
                    "merge-base",
                    "--is-ancestor",
                    plan.baseSha,
                    "HEAD"
                  ])
                  expect(base.exitCode).toBe(0)
                  const claimIndex = beforeContraction.findIndex(
                    ({ event }) => event._tag === "TaskClaimAcquired" && event.claim.taskId === plan.taskId
                  )
                  const planIndex = beforeContraction.findIndex(
                    ({ event }) =>
                      event._tag === "TaskAttemptPlanned" && event.operation.plannedAttempt.attemptId === plan.attemptId
                  )
                  const beginIndex = beforeContraction.findIndex(
                    ({ event }) =>
                      event._tag === "PlannedAttemptExecutorCommandIntended" &&
                      event.command === "Begin" &&
                      event.plannedAttempt.attemptId === plan.attemptId
                  )
                  expect(claimIndex).toBeGreaterThanOrEqual(0)
                  const acquired = beforeContraction.flatMap(({ event }) =>
                    event._tag === "TaskClaimAcquired" && event.claim.taskId === plan.taskId ? [event.claim] : []
                  )[0]
                  if (acquired === undefined) return yield* Effect.die("missing exact tracker claim")
                  const claimIntentIndex = beforeContraction.findIndex(
                    ({ event }) =>
                      event._tag === "TaskClaimAcquisitionIntended" &&
                      event.operation.acquisition.operationId === acquired.operationId
                  )
                  expect(claimIntentIndex).toBeGreaterThanOrEqual(0)
                  expect(claimIndex).toBeGreaterThan(claimIntentIndex)
                  const graphIntentIndex = beforeContraction.findIndex(
                    ({ event }) =>
                      event._tag === "TaskTrackerReadIntentRecorded" &&
                      event.operation._tag === "ReadTrackerGraph" &&
                      event.operation.predecessorOperationIds.includes(acquired.operationId)
                  )
                  expect(graphIntentIndex).toBeGreaterThan(claimIndex)
                  const graphIntent = beforeContraction[graphIntentIndex]
                  if (graphIntent?.event._tag !== "TaskTrackerReadIntentRecorded")
                    return yield* Effect.die("missing post-claim tracker intent")
                  const graphOperationId = graphIntent.event.operation.operationId
                  const graphObservedIndex = beforeContraction.findIndex(
                    ({ event }) => event._tag === "TaskTrackerFactsObserved" && event.operationId === graphOperationId
                  )
                  expect(graphObservedIndex).toBeGreaterThan(graphIntentIndex)
                  expect(planIndex).toBeGreaterThan(graphObservedIndex)
                  expect(planIndex).toBeGreaterThan(claimIndex)
                  const worktreeIntentIndex = beforeContraction.findIndex(
                    ({ event }) =>
                      event._tag === "TaskWorktreeReconciliationIntended" &&
                      event.operation.plannedAttempt.attemptId === plan.attemptId
                  )
                  const worktreeReadyIndex = beforeContraction.findIndex(
                    ({ event }) => event._tag === "TaskWorktreeReady" && event.proof.worktree === plan.worktree
                  )
                  expect(worktreeIntentIndex).toBeGreaterThan(planIndex)
                  expect(worktreeReadyIndex).toBeGreaterThan(worktreeIntentIndex)
                  expect(beginIndex).toBeGreaterThan(worktreeReadyIndex)
                  expect(beginIndex).toBeGreaterThan(planIndex)
                }
                const graph = beforeContraction.flatMap(({ event }) =>
                  event._tag === "TaskTrackerFactsObserved" && event.observation._tag === "CompleteTaskTrackerFacts"
                    ? [event.observation]
                    : []
                )[0]
                if (graph === undefined) return yield* Effect.die("missing complete tracker graph")
                expect(
                  graph.factFamilies[2].prerequisites.find((row) => row.taskId === fixture.taskIds[2])
                    ?.prerequisiteTaskIds
                ).toEqual(expect.arrayContaining(fixture.taskIds.slice(0, 2)))
                const providerBefore = yield* fixture.provider.snapshot()
                expect(
                  yield* callRunningHost(address, runId, {
                    _tag: "SetCapacity",
                    capacity: TaskWorkCapacity.make(1),
                    expectedRevision: RunPolicyRevision.make(2)
                  })
                ).toMatchObject({
                  result: { value: { _tag: "CapacityApplied", policy: { revision: 3, taskExecutionCapacity: 1 } } }
                })
                const afterContraction = yield* fixture.readHistory(runId)
                expect(afterContraction.filter(({ event }) => event._tag === "TaskAttemptPlanned")).toEqual(
                  beforeContraction.filter(({ event }) => event._tag === "TaskAttemptPlanned")
                )
                expect(afterContraction.filter(({ event }) => event._tag === "TaskClaimAcquired")).toEqual(claims)
                expect(afterContraction.slice(beforeContraction.length).map(({ event }) => event._tag)).toEqual([
                  "TaskWorkCapacityChanged"
                ])
                expect((yield* fixture.provider.snapshot()).operationCounts).toEqual(providerBefore.operationCounts)
                expect(yield* Ref.get(turnCalls)).toBe(2)
                const runningHostCapacityAdmissionPrefix = yield* projectRecordedCassette(afterContraction)
                expect(
                  verifyRecordedCassetteRoundTrip(afterContraction, runningHostCapacityAdmissionPrefix).every(
                    (checkpoint) =>
                      checkpoint.workflowHistoryEquivalent &&
                      checkpoint.operationalStateEquivalent &&
                      checkpoint.pureSelectionEquivalent &&
                      checkpoint.appliedOccurrencePositionEquivalent
                  )
                ).toBe(true)
                yield* Deferred.succeed(returnSecondBegin, undefined)
                yield* Deferred.await(secondIdle).pipe(Effect.timeout("10 seconds"))
                expect(yield* observation.applicationExitRequestBoundary.requestExit).toMatchObject({
                  _tag: "Succeeded"
                })
              })
            ),
          "Run",
          "Listening"
        )
      })
    ).pipe(Effect.provide(runningHostFixtureLayer)),
  60000
)
