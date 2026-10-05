/* eslint-disable import/no-nodejs-modules -- Production qualification allocates an actual HTTP listener. */
import { createServer } from "node:net"
import { fileURLToPath } from "node:url"
import { it } from "@effect/vitest"
import { expect } from "vitest"
import { Deferred, Effect, Option, Stream } from "effect"
import { makeTaskWorkSpecification } from "@dalph/contracts"
import {
  attachCurrentSignal,
  GitCommand,
  ResultRecoveryRequestId,
  type DeliveryRuntimeReadyObservation
} from "@dalph/orchestrator"
import { makeRunningHostFixture, runningHostFixtureLayer } from "../../test-support/production-running-host-fixture.js"
import { seedProductionHistoricalFailure } from "../../test-support/production-legacy-result-recovery.js"
import { withDecodedProductionRepositoryHost } from "./production-host.js"
import { LocalHostAddress } from "./running-host-contract.js"
import { serveRunningHost } from "./running-host-http.js"
import { callRunningHost } from "./running-host-client.js"

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
          reject(new Error("missing port"))
          return
        }
        const address = LocalHostAddress.make(`http://127.0.0.1:${bound.port}`)
        server.close((error) => (error === undefined ? resolve(address) : reject(error)))
      })
    }),
  catch: String
})

it.live(
  "restarts a historical unknown Failed seal through public recovery and the ordinary production Run",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeRunningHostFixture(builtEntry, false, undefined, undefined, false, {
          rejectResult: true
        })
        // The modern source supplies real Git/SQLite resources and provider-thread
        // provenance. The legacy fixture owns a separate journal and private store;
        // none of these modern accepted reports or private records are rewritten.
        const source = yield* withDecodedProductionRepositoryHost(
          fixture.configuration,
          fixture.graph,
          (observation) =>
            Effect.scoped(
              Effect.gen(function* () {
                yield* Deferred.await(fixture.turnEntered).pipe(Effect.timeout("20 seconds"))
                const attached = yield* attachCurrentSignal(observation.current)
                yield* fixture.release
                const rejected = (state: typeof attached.current): state is DeliveryRuntimeReadyObservation =>
                  state._tag === "Ready" &&
                  state.evaluation.diagnostics?.tasks.some(
                    (task) =>
                      task.phase === "Rejected" &&
                      task.recovery._tag === "ExplicitDirectionRequired" &&
                      task.recovery.rejection.custody._tag === "Stopped"
                  ) === true
                const state = rejected(attached.current)
                  ? attached.current
                  : Option.getOrThrow(
                      yield* attached.changes.pipe(
                        Stream.filter(rejected),
                        Stream.runHead,
                        Effect.timeout("20 seconds")
                      )
                    )
                const task = state.evaluation.diagnostics?.tasks.find(
                  (task) => task.recovery._tag === "ExplicitDirectionRequired"
                )
                if (task?.recovery._tag !== "ExplicitDirectionRequired")
                  return yield* Effect.die("source rejection required")
                return {
                  plannedAttempt: task.recovery.subject.plannedAttempt,
                  records: yield* fixture.readHistory(observation.selection.runId)
                }
              })
            ),
          "Run",
          "Listening"
        )
        const legacy = yield* seedProductionHistoricalFailure(
          fixture.configuration,
          source.records,
          source.plannedAttempt
        )
        const git = yield* GitCommand
        const oldHead = (yield* git.runInWorktree(source.plannedAttempt.worktree, ["rev-parse", "HEAD"])).stdout.trim()
        const freshSpecification = makeTaskWorkSpecification({
          taskId: source.plannedAttempt.taskId,
          body: "Fresh historical Restart F2",
          title: "Fresh F2"
        })
        yield* fixture.provider.setPublicTaskSpecification(freshSpecification)
        const freshBase = (yield* git.runInWorktree(fixture.configuration.repository, [
          "-c",
          "user.name=Recovery fixture",
          "-c",
          "user.email=recovery@example.invalid",
          "commit-tree",
          (yield* git.runInWorktree(fixture.configuration.repository, [
            "rev-parse",
            `${source.plannedAttempt.baseSha}^{tree}`
          ])).stdout.trim(),
          "-p",
          source.plannedAttempt.baseSha,
          "-m",
          "Fresh H2 for historical Restart"
        ])).stdout.trim()
        expect(
          (yield* git.runInWorktree(fixture.configuration.repository, [
            "update-ref",
            fixture.configuration.integrationRef,
            freshBase,
            source.plannedAttempt.baseSha
          ])).exitCode
        ).toBe(0)
        yield* fixture.allowValidResult
        const address = yield* freeAddress
        yield* withDecodedProductionRepositoryHost(
          legacy.configuration,
          fixture.graph,
          (observation) =>
            Effect.scoped(
              Effect.gen(function* () {
                yield* serveRunningHost(address, observation)
                const attached = yield* attachCurrentSignal(observation.current)
                const failed = (state: typeof attached.current): state is DeliveryRuntimeReadyObservation =>
                  state._tag === "Ready" &&
                  state.evaluation.diagnostics?.tasks.some(
                    (task) => task.phase === "Failed" && task.recovery._tag === "RestartOnly"
                  ) === true
                if (!failed(attached.current))
                  yield* attached.changes.pipe(Stream.filter(failed), Stream.runHead, Effect.timeout("20 seconds"))
                const snapshot = yield* callRunningHost(address, observation.selection.runId, { _tag: "ReadSnapshot" })
                if (
                  snapshot.result._tag !== "Success" ||
                  snapshot.result.value._tag !== "Ready" ||
                  snapshot.result.value.delivery._tag !== "DeliveryStatusAvailable"
                )
                  return yield* Effect.die("historical public status required")
                const entry = snapshot.result.value.delivery.entries.find((entry) => entry._tag === "ExecutorFailure")
                if (entry?._tag !== "ExecutorFailure" || entry.recovery._tag !== "RestartOnly")
                  return yield* Effect.die("historical public Restart subject required")
                expect(entry.recovery.subject).toMatchObject({
                  _tag: "HistoricalUnknownFailure",
                  plannedAttempt: source.plannedAttempt,
                  reportOrdinal: legacy.reportOrdinal
                })
                const recovery = {
                  direction: "RestartTaskImplementation" as const,
                  requestId: ResultRecoveryRequestId.make({
                    nonce: "public-historical-restart",
                    runId: observation.selection.runId
                  }),
                  subject: entry.recovery.subject
                }
                const receipt = yield* callRunningHost(address, observation.selection.runId, {
                  _tag: "ApplyResultRecoveryDirection",
                  recovery
                })
                expect(receipt.result).toMatchObject({
                  _tag: "Success",
                  value: { _tag: "ResultRecoveryDirectionRecorded", recovery }
                })
                yield* attached.changes.pipe(
                  Stream.filter(
                    (state) =>
                      state._tag === "Ready" &&
                      state.evaluation.diagnostics?.tasks.some(
                        (task) =>
                          task.taskId === source.plannedAttempt.taskId &&
                          (task.phase === "Accepted" || task.phase === "Integrating" || task.phase === "Delivered")
                      ) === true
                  ),
                  Stream.runHead,
                  Effect.timeout("20 seconds")
                )
                const duplicate = yield* callRunningHost(address, observation.selection.runId, {
                  _tag: "ApplyResultRecoveryDirection",
                  recovery
                })
                expect(duplicate.result).toEqual(receipt.result)
              })
            ),
          "Run",
          "Listening"
        )
        const records = yield* legacy.readHistory
        expect(records.filter(({ event }) => event._tag === "ResultRecoveryDirected")).toHaveLength(1)
        expect(
          records.some(
            ({ event }) =>
              event._tag === "ResultRecoveryContinueAuthorized" ||
              (event._tag === "PlannedAttemptExecutorCommandIntended" && event.command === "ContinueRejectedResult")
          )
        ).toBe(false)
        const replacements = records.filter(({ event }) => event._tag === "ResultRecoveryAttemptReplaced")
        expect(replacements).toHaveLength(1)
        const replacement = replacements[0]?.event
        if (replacement?._tag !== "ResultRecoveryAttemptReplaced")
          return yield* Effect.die("historical successor required")
        const successor = replacement.successorPlan.plannedAttempt
        expect(successor).toMatchObject({ baseSha: freshBase, taskRevision: freshSpecification.fingerprint })
        expect(successor.worktree).not.toBe(source.plannedAttempt.worktree)
        expect(successor.attemptId).not.toBe(source.plannedAttempt.attemptId)
        expect(replacement.writerCustody).toEqual({ _tag: "Stopped", plannedAttempt: source.plannedAttempt })
        expect(
          records.filter(
            ({ event }) =>
              event._tag === "PlannedAttemptExecutorCommandIntended" &&
              event.command === "Begin" &&
              event.plannedAttempt.attemptId === successor.attemptId
          )
        ).toHaveLength(1)
        expect(
          records.some(
            ({ event }) =>
              event._tag === "PlannedAttemptExecutorWorkReported" &&
              event.report._tag === "ExecutorWorkTerminal" &&
              event.report.correlation.attemptId === successor.attemptId &&
              event.report.result._tag === "Accepted"
          )
        ).toBe(true)
        expect((yield* git.runInWorktree(source.plannedAttempt.worktree, ["rev-parse", "HEAD"])).stdout.trim()).toBe(
          oldHead
        )
        expect(yield* legacy.readSeal(legacy.legacyDirectory)).toEqual(Option.some(legacy.legacySeal))
        expect(yield* legacy.readSeal(legacy.originalDirectory)).toEqual(Option.some(legacy.modernRecord))
      })
    ).pipe(Effect.provide(runningHostFixtureLayer)),
  60_000
)
