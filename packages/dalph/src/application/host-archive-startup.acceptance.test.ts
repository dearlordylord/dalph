/* eslint-disable import/no-nodejs-modules -- The physical host fixture starts the built CLI and reopens SQLite. */
import { fileURLToPath } from "node:url"
import { it } from "@effect/vitest"
import { RunId } from "@dalph/contracts"
import { Clock, Deferred, Duration, Effect, Fiber, Queue, Ref } from "effect"
import { expect } from "vitest"
import {
  JournalStore,
  sqliteJournalTestLayer,
  InitialControlPolicy,
  TaskWorkCapacity,
  intentRecordKey,
  outcomeRecordKey
} from "@dalph/orchestrator"
import { completedRunFinalityFixture } from "../../../orchestrator/test/run-finality.js"
import { makeRunningHostFixture, runningHostFixtureLayer } from "../../test-support/production-running-host-fixture.js"
import { ProductionRunReactivationInterval } from "./production.js"
import { withDecodedProductionRepositoryHost } from "./production-host.js"

const builtEntry = fileURLToPath(new URL("../../dist/bin/dalph.js", import.meta.url))

it.live(
  "the owning startup retires aged terminal Hot history before expiry and preserves unrelated unfinished work",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeRunningHostFixture(builtEntry)
        const oldRun = RunId.make("aged-startup-hot")
        const finality = completedRunFinalityFixture({ runId: oldRun, target: fixture.configuration.target })
        const clock = yield* Clock.Clock
        const oldTime = (yield* Clock.currentTimeMillis) - 31 * 24 * 60 * 60 * 1000
        yield* Effect.scoped(
          Effect.gen(function* () {
            const journal = yield* JournalStore
            yield* journal.beginRun(
              oldRun,
              fixture.configuration.target,
              InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }),
              fixture.configuration.remotePublicationTarget
            )
            yield* journal.append(oldRun, intentRecordKey(finality.operation.operationId), finality.intent)
            yield* journal.append(oldRun, outcomeRecordKey(finality.operation.operationId), finality.observation)
            yield* journal.terminateRun(oldRun, "Completed", finality.evidence)
            expect((yield* journal.scanHot()).runs.map(({ runId }) => runId)).toContain(oldRun)
          }).pipe(
            Effect.provide(sqliteJournalTestLayer({ filename: fixture.configuration.journalDatabase })),
            Effect.provideService(Clock.Clock, {
              currentTimeMillis: Effect.succeed(oldTime),
              currentTimeMillisUnsafe: () => oldTime,
              currentTimeNanos: clock.currentTimeNanos,
              currentTimeNanosUnsafe: () => clock.currentTimeNanosUnsafe(),
              monotonicTimeNanos: clock.monotonicTimeNanos,
              monotonicTimeNanosUnsafe: () => clock.monotonicTimeNanosUnsafe(),
              sleep: (duration) => clock.sleep(duration)
            })
          )
        )
        yield* withDecodedProductionRepositoryHost(
          fixture.configuration,
          fixture.graph,
          (observation) =>
            Effect.gen(function* () {
              yield* Effect.addFinalizer(() => fixture.release)
              expect(yield* fixture.readHistory(oldRun).pipe(Effect.flip)).toMatchObject({
                _tag: "JournalHistoryDeleted",
                completion: { runId: oldRun, disposition: "Completed", timing: { _tag: "Known", completedAt: oldTime } }
              })
              expect((yield* fixture.readHistory(observation.selection.runId)).length).toBeGreaterThan(0)
              expect(yield* observation.readRunControl).toMatchObject({ direction: "RunUnpaused" })
            }),
          "Run",
          "Listening"
        )
      })
    ).pipe(Effect.provide(runningHostFixtureLayer)),
  60000
)

it.live(
  "the SQLite host yields between archive units and graceful Exit stops at an atomic boundary",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const commits = yield* Ref.make(0)
        const entered = yield* Queue.unbounded<number>()
        const release = yield* Queue.unbounded<void>()
        const readFinished = yield* Ref.make(false)
        const fixture = yield* makeRunningHostFixture(
          builtEntry,
          false,
          {},
          {
            beforeArchiveCommit: () =>
              Effect.gen(function* () {
                const unit = yield* Ref.updateAndGet(commits, (count) => count + 1)
                if (unit === 2) expect(yield* Ref.get(readFinished)).toBe(true)
                yield* Queue.offer(entered, unit)
                yield* Queue.take(release)
              })
          }
        )
        const histories = [RunId.make("yield-a"), RunId.make("yield-b"), RunId.make("yield-c")]
        const clock = yield* Clock.Clock
        yield* Effect.scoped(
          Effect.gen(function* () {
            const journal = yield* JournalStore
            for (const runId of histories) {
              const finality = completedRunFinalityFixture({ runId, target: fixture.configuration.target })
              yield* journal.beginRun(
                runId,
                fixture.configuration.target,
                InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }),
                fixture.configuration.remotePublicationTarget
              )
              yield* journal.append(runId, intentRecordKey(finality.operation.operationId), finality.intent)
              yield* journal.append(runId, outcomeRecordKey(finality.operation.operationId), finality.observation)
              yield* journal.terminateRun(runId, "Completed", finality.evidence)
              yield* journal.retireTerminalRun(runId)
            }
          }).pipe(Effect.provide(sqliteJournalTestLayer({ filename: fixture.configuration.journalDatabase })))
        )
        const offset = yield* Ref.make(0)
        const wake = yield* Deferred.make<void>()
        const sleeping = yield* Deferred.make<void>()
        const hostClock = {
          currentTimeMillis: clock.currentTimeMillis.pipe(
            Effect.flatMap((now) => Ref.get(offset).pipe(Effect.map((delta) => now + delta)))
          ),
          currentTimeMillisUnsafe: () => clock.currentTimeMillisUnsafe() + Ref.getUnsafe(offset),
          currentTimeNanos: clock.currentTimeNanos,
          currentTimeNanosUnsafe: () => clock.currentTimeNanosUnsafe(),
          monotonicTimeNanos: clock.monotonicTimeNanos,
          monotonicTimeNanosUnsafe: () => clock.monotonicTimeNanosUnsafe(),
          sleep: (duration: Duration.Duration) =>
            Duration.toMillis(duration) === 60000
              ? Deferred.succeed(sleeping, undefined).pipe(Effect.andThen(Deferred.await(wake)), Effect.asVoid)
              : clock.sleep(duration)
        }
        yield* withDecodedProductionRepositoryHost(
          { ...fixture.configuration, activationInterval: ProductionRunReactivationInterval.make(Duration.minutes(2)) },
          fixture.graph,
          (observation) =>
            Effect.gen(function* () {
              yield* Effect.addFinalizer(() =>
                Queue.offer(release, undefined).pipe(Effect.andThen(fixture.release), Effect.asVoid)
              )
              yield* Deferred.await(sleeping)
              yield* Ref.set(offset, 31 * 24 * 60 * 60 * 1000)
              yield* Deferred.succeed(wake, undefined)
              expect(yield* Queue.take(entered)).toBe(1)
              const reading = yield* fixture.readHistory(observation.selection.runId).pipe(
                Effect.tap(() => Ref.set(readFinished, true)),
                Effect.forkChild({ startImmediately: true })
              )
              yield* Queue.offer(release, undefined)
              expect(yield* Queue.take(entered)).toBe(2)
              expect((yield* Fiber.join(reading)).length).toBeGreaterThan(0)
              const exiting = yield* observation.applicationExitRequestBoundary.requestExit.pipe(
                Effect.forkChild({ startImmediately: true })
              )
              yield* Effect.yieldNow
              expect(yield* observation.closing).toBe(true)
              yield* Queue.offer(release, undefined)
              expect(yield* Fiber.join(exiting)).toMatchObject({ _tag: "Succeeded" })
              expect(yield* Ref.get(commits)).toBe(2)
              expect(yield* fixture.readHistory(RunId.make("yield-a")).pipe(Effect.flip)).toMatchObject({
                _tag: "JournalHistoryDeleted"
              })
              const interrupted = yield* fixture.readHistory(RunId.make("yield-b")).pipe(Effect.result)
              if (interrupted._tag === "Success") expect(interrupted.success.length).toBe(4)
              else
                expect(interrupted.failure).toMatchObject({
                  _tag: "JournalHistoryDeleted",
                  completion: { runId: "yield-b", disposition: "Completed" }
                })
              expect((yield* fixture.readHistory(RunId.make("yield-c"))).length).toBe(4)
            }),
          "Run",
          "Listening"
        ).pipe(Effect.provideService(Clock.Clock, hostClock))
      })
    ).pipe(Effect.provide(runningHostFixtureLayer)),
  60000
)
