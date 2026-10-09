/* eslint-disable import/no-nodejs-modules -- The physical host fixture starts the built CLI and reopens SQLite. */
import { fileURLToPath } from "node:url"
import { it } from "@effect/vitest"
import { RunId } from "@dalph/contracts"
import { Clock, Effect } from "effect"
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
