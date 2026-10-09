/* eslint-disable import/no-nodejs-modules -- Production fixtures identify the built executable and retain real SQLite history. */
import { fileURLToPath } from "node:url"
import { it } from "@effect/vitest"
import { RunPolicyRevision, TaskWorkCapacity } from "@dalph/orchestrator"
import { Clock, Deferred, Effect, Ref } from "effect"
import { expect } from "vitest"
import { makeRunningHostFixture, runningHostFixtureLayer } from "../../test-support/production-running-host-fixture.js"
import { availableLocalHostAddress } from "../../test-support/running-host-read-probe.js"
import { withDecodedProductionRepositoryHost } from "./production-host.js"
import { callRunningHost } from "./running-host-client.js"
import { serveRunningHost } from "./running-host-http.js"

const builtEntry = fileURLToPath(new URL("../../dist/bin/dalph.js", import.meta.url))
const operations = [
  { _tag: "ReadCapacity" as const },
  { _tag: "SetCapacity" as const, capacity: TaskWorkCapacity.make(2), expectedRevision: RunPolicyRevision.make(1) }
]

it.live(
  "capacity reads and writes between active leases return RunInactive without reviving an unfinished Run",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const idleEntered = yield* Deferred.make<void>()
        const releaseIdle = yield* Deferred.make<void>()
        const holdIdle = yield* Ref.make(false)
        yield* Effect.addFinalizer(() => Deferred.succeed(releaseIdle, undefined).pipe(Effect.asVoid))
        const fixture = yield* makeRunningHostFixture(
          builtEntry,
          false,
          undefined,
          {
            onActivationIdle: () =>
              Ref.get(holdIdle).pipe(
                Effect.flatMap((hold) =>
                  hold
                    ? Deferred.succeed(idleEntered, undefined).pipe(Effect.andThen(Deferred.await(releaseIdle)))
                    : Effect.void
                )
              )
          },
          true
        )
        const address = yield* availableLocalHostAddress
        yield* withDecodedProductionRepositoryHost(
          fixture.configuration,
          fixture.graph,
          (observation) =>
            Effect.scoped(
              Effect.gen(function* () {
                yield* Effect.addFinalizer(() =>
                  Deferred.succeed(releaseIdle, undefined).pipe(
                    Effect.andThen(fixture.releaseObservationCut),
                    Effect.andThen(observation.applicationExitRequestBoundary.requestExit),
                    Effect.asVoid
                  )
                )
                yield* serveRunningHost(address, observation)
                const runId = observation.selection.runId
                yield* Deferred.await(fixture.turnEntered).pipe(Effect.timeout("20 seconds"))
                yield* Deferred.await(fixture.activationFinalizing).pipe(Effect.timeout("10 seconds"))
                yield* Ref.set(holdIdle, true)
                yield* fixture.releaseObservationCut
                yield* Deferred.await(idleEntered).pipe(Effect.timeout("10 seconds"))
                const before = yield* fixture.readHistory(runId)
                const trackerCalls = yield* Ref.get(fixture.trackerCalls)
                const gitCalls = yield* Ref.get(fixture.gitCalls)
                for (const operation of operations) {
                  const reply = yield* callRunningHost(address, runId, operation)
                  expect(reply, JSON.stringify(reply)).toMatchObject({
                    result: { _tag: "Failure", error: { _tag: "RunInactive", runId, operation: operation._tag } }
                  })
                }
                expect(yield* fixture.readHistory(runId)).toEqual(before)
                expect(yield* Ref.get(fixture.trackerCalls)).toBe(trackerCalls)
                expect(yield* Ref.get(fixture.gitCalls)).toBe(gitCalls)
                expect(yield* Deferred.isDone(fixture.turnEntered)).toBe(true)
                expect(yield* callRunningHost(address, runId, { _tag: "ReadRunControl" })).toMatchObject({
                  result: { value: { _tag: "RunUnpaused" } }
                })
                yield* Deferred.succeed(releaseIdle, undefined)
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

it.live(
  "capacity reads and writes on a terminal Run return its accepted position without another append",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeRunningHostFixture(builtEntry)
        const address = yield* availableLocalHostAddress
        yield* withDecodedProductionRepositoryHost(
          fixture.configuration,
          fixture.graph,
          (observation) =>
            Effect.scoped(
              Effect.gen(function* () {
                yield* Effect.addFinalizer(() => fixture.release)
                yield* serveRunningHost(address, observation)
                const runId = observation.selection.runId
                yield* Deferred.await(fixture.turnEntered).pipe(Effect.timeout("20 seconds"))
                yield* Deferred.await(fixture.activationFinalizing).pipe(Effect.timeout("10 seconds"))
                yield* fixture.releaseObservationCut
                yield* Deferred.await(fixture.activationIdle).pipe(Effect.timeout("10 seconds"))
                yield* fixture.release
                const terminal = yield* observation.runTermination.await.pipe(
                  Effect.timeoutOrElse({
                    duration: "20 seconds",
                    orElse: () =>
                      Effect.gen(function* () {
                        const history = yield* fixture.readHistory(runId)
                        return yield* Effect.fail({
                          _tag: "CapacityTerminalWaitFailed",
                          lastEvents: history.slice(-8).map(({ event }) => event._tag),
                          failures: yield* Ref.get(fixture.failures),
                          state: yield* observation.current.get
                        })
                      })
                  })
                )
                const before = yield* fixture.readHistory(runId)
                const record = before.find(({ event }) => event._tag === "WorkflowRunTerminated")
                expect(record?.position).toBe(terminal.terminatedAt.position)
                const trackerCalls = yield* Ref.get(fixture.trackerCalls)
                const gitCalls = yield* Ref.get(fixture.gitCalls)
                const publication = before.findLast(({ event }) => event._tag === "RemotePublicationSucceeded")
                if (publication?.event._tag !== "RemotePublicationSucceeded")
                  return yield* Effect.die("terminal fixture requires recorded publication")
                const result = yield* callRunningHost(address, runId, { _tag: "ReadRunControl" })
                expect(result).toMatchObject({
                  result: {
                    _tag: "Success",
                    value: {
                      _tag: "RunTerminated",
                      completionResult: {
                        _tag: "CompletedRun",
                        history: "Available",
                        completion: {
                          runId,
                          disposition: terminal.disposition,
                          terminatedAt: terminal.terminatedAt.position,
                          timing: { _tag: "Known" },
                          publication: {
                            _tag: "RecordedPublication",
                            candidateCommit: publication.event.correlation.qualifiedCandidate.candidateCommit,
                            target: publication.event.correlation.target,
                            proof: publication.event.proof,
                            recordedAt: publication.position
                          }
                        }
                      }
                    }
                  }
                })
                for (const operation of operations)
                  expect(yield* callRunningHost(address, runId, operation)).toMatchObject({
                    result: { _tag: "Failure", error: { _tag: "RunClosed", runId, ...terminal } }
                  })
                expect(yield* fixture.readHistory(runId)).toEqual(before)
                expect(yield* Ref.get(fixture.trackerCalls)).toBe(trackerCalls)
                expect(yield* Ref.get(fixture.gitCalls)).toBe(gitCalls)
              })
            ),
          "Run",
          "Listening"
        )
      })
    ).pipe(Effect.provide(runningHostFixtureLayer)),
  60000
)

it.live(
  "public terminal inspection keeps the exact result after owned expiry while the host remains open",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeRunningHostFixture(builtEntry)
        const address = yield* availableLocalHostAddress
        yield* withDecodedProductionRepositoryHost(
          fixture.configuration,
          fixture.graph,
          (observation) =>
            Effect.scoped(
              Effect.gen(function* () {
                yield* Effect.addFinalizer(() => fixture.release)
                yield* serveRunningHost(address, observation)
                const runId = observation.selection.runId
                yield* Deferred.await(fixture.turnEntered).pipe(Effect.timeout("20 seconds"))
                yield* Deferred.await(fixture.activationFinalizing).pipe(Effect.timeout("10 seconds"))
                yield* fixture.releaseObservationCut
                yield* Deferred.await(fixture.activationIdle).pipe(Effect.timeout("10 seconds"))
                yield* fixture.release
                const terminal = yield* observation.runTermination.await.pipe(
                  Effect.timeoutOrElse({
                    duration: "20 seconds",
                    orElse: () =>
                      Effect.gen(function* () {
                        const history = yield* fixture.readHistory(runId)
                        return yield* Effect.fail({
                          _tag: "CapacityTerminalWaitFailed",
                          lastEvents: history.slice(-8).map(({ event }) => event._tag),
                          failures: yield* Ref.get(fixture.failures),
                          state: yield* observation.current.get
                        })
                      })
                  })
                )
                const before = yield* fixture.readHistory(runId)
                const record = before.find(({ event }) => event._tag === "WorkflowRunTerminated")
                expect(record?.position).toBe(terminal.terminatedAt.position)
                const trackerCalls = yield* Ref.get(fixture.trackerCalls)
                const gitCalls = yield* Ref.get(fixture.gitCalls)
                const publication = before.findLast(({ event }) => event._tag === "RemotePublicationSucceeded")
                if (publication?.event._tag !== "RemotePublicationSucceeded")
                  return yield* Effect.die("terminal fixture requires recorded publication")
                yield* fixture.retireHistory(runId)
                const clock = yield* Clock.Clock
                const future = (yield* Clock.currentTimeMillis) + 30 * 24 * 60 * 60 * 1000
                yield* fixture.maintainArchive.pipe(
                  Effect.provideService(Clock.Clock, {
                    monotonicTimeNanos: clock.monotonicTimeNanos,
                    monotonicTimeNanosUnsafe: () => clock.monotonicTimeNanosUnsafe(),
                    currentTimeNanos: clock.currentTimeNanos,
                    currentTimeNanosUnsafe: () => clock.currentTimeNanosUnsafe(),
                    sleep: (duration) => clock.sleep(duration),
                    currentTimeMillis: Effect.succeed(future),
                    currentTimeMillisUnsafe: () => future
                  })
                )
                expect(yield* fixture.readHistory(runId).pipe(Effect.flip)).toMatchObject({
                  _tag: "JournalHistoryDeleted"
                })
                const result = yield* callRunningHost(address, runId, { _tag: "ReadRunControl" })
                expect(result).toMatchObject({
                  result: {
                    _tag: "Success",
                    value: {
                      _tag: "RunTerminated",
                      completionResult: {
                        _tag: "CompletedRun",
                        history: "Deleted",
                        completion: {
                          runId,
                          disposition: terminal.disposition,
                          terminatedAt: terminal.terminatedAt.position,
                          timing: { _tag: "Known" },
                          publication: {
                            _tag: "RecordedPublication",
                            candidateCommit: publication.event.correlation.qualifiedCandidate.candidateCommit,
                            target: publication.event.correlation.target,
                            proof: publication.event.proof,
                            recordedAt: publication.position
                          }
                        }
                      }
                    }
                  }
                })
                for (const operation of operations)
                  expect(yield* callRunningHost(address, runId, operation)).toMatchObject({
                    result: { _tag: "Failure", error: { _tag: "RunClosed", runId, ...terminal } }
                  })
                expect(yield* fixture.readHistory(runId).pipe(Effect.flip)).toMatchObject({
                  _tag: "JournalHistoryDeleted"
                })
                expect(yield* Ref.get(fixture.trackerCalls)).toBe(trackerCalls)
                expect(yield* Ref.get(fixture.gitCalls)).toBe(gitCalls)
              })
            ),
          "Run",
          "Listening"
        )
      })
    ).pipe(Effect.provide(runningHostFixtureLayer)),
  60000
)
