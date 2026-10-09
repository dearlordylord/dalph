import { OccurrencePageCapacity, type OccurrencePage } from "./running-host-occurrences-contract.js"
/* eslint-disable import/no-nodejs-modules -- The physical production host fixture consumes the built executable. */
import { fileURLToPath } from "node:url"
import { RunId, TaskId } from "@dalph/contracts"
import {
  ControlDirectionAppliedEvent,
  ControlDirectionApplicationOrdinal,
  JournalStore,
  JournalPosition,
  TraceCursor,
  makeTraceReader,
  type TraceHistoryItem
} from "@dalph/orchestrator"
import { completedRunFinalityFixture } from "../../../orchestrator/test/run-finality.js"
import {
  intentRecordKey,
  outcomeRecordKey,
  controlDirectionAppliedRecordKey
} from "../../../orchestrator/src/workflow-journal/record-key.js"
import { workflowJournalEventVersion } from "../../../orchestrator/src/workflow/kernel/event.js"
import { it } from "@effect/vitest"
import { NodeHttpClient } from "@effect/platform-node"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import type { Duration } from "effect"
import { Clock, Context, Deferred, Effect, Fiber, Layer, Ref } from "effect"
import { expect } from "vitest"
import { makeRunningHostFixture, runningHostFixtureLayer } from "../../test-support/production-running-host-fixture.js"
import { availableLocalHostAddress } from "../../test-support/running-host-read-probe.js"
import { withDecodedProductionRepositoryHost } from "./production-host.js"
import { serveRunningHost } from "./running-host-http.js"
import { callRunningHost, readRunningHostDescriptor, decodeRunningHostResponseJson } from "./running-host-client.js"
import { type RunningHostRequest, type RunningHostEnvelope } from "./running-host-contract.js"

const builtEntry = fileURLToPath(new URL("../../dist/bin/dalph.js", import.meta.url))
const encodedBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength

it.live(
  "pages the canonical fixed prefix across an append with no read mutations and refuses exact oversized occurrences",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeRunningHostFixture(builtEntry, true, {})
        const storeReady = yield* Deferred.make<JournalStore["Service"]>()
        const graph = {
          ...fixture.graph,
          foundation: (...args: Parameters<typeof fixture.graph.foundation>) =>
            fixture.graph
              .foundation(...args)
              .pipe(Layer.tap((context) => Deferred.succeed(storeReady, Context.get(context, JournalStore))))
        }
        const address = yield* availableLocalHostAddress
        yield* withDecodedProductionRepositoryHost(
          fixture.configuration,
          graph,
          (observation) =>
            Effect.scoped(
              Effect.gen(function* () {
                const store = yield* Deferred.await(storeReady)
                const runId = observation.selection.runId
                const appendPause = (n: number, taskId?: TaskId) => {
                  const ordinal = ControlDirectionApplicationOrdinal.make(n)
                  return store.append(
                    runId,
                    controlDirectionAppliedRecordKey(ordinal),
                    ControlDirectionAppliedEvent.make({
                      direction: "Pause",
                      initiatedBy: { _tag: "Operator" },
                      occurrenceClassification: "InitiatedAction",
                      ordinal,
                      subject: taskId === undefined ? { _tag: "Run", runId } : { _tag: "Task", taskId, runId },
                      version: workflowJournalEventVersion
                    })
                  )
                }
                for (let n = 2; n <= 20; n++) yield* appendPause(n)
                const records = yield* store.read(runId)
                const last = records.at(-1)
                if (last === undefined) return expect.fail("committed history required")
                const prefix = TraceCursor.make({ runId, position: last.position })
                const canonical = yield* observation.traceReader.readAt(prefix)
                yield* serveRunningHost(address, observation)
                const request = (
                  continuation: Extract<
                    RunningHostRequest["operation"],
                    { _tag: "ReadOccurrencePage" }
                  >["continuation"],
                  capacity = 1600
                ) =>
                  callRunningHost(address, runId, {
                    _tag: "ReadOccurrencePage",
                    prefix,
                    continuation,
                    capacityBytes: OccurrencePageCapacity.make(capacity)
                  })
                let continuation: Extract<
                  RunningHostRequest["operation"],
                  { _tag: "ReadOccurrencePage" }
                >["continuation"] = null
                const items: Array<TraceHistoryItem> = []
                let pages = 0
                for (let remainingPages = 30; remainingPages > 0; remainingPages--) {
                  const result: RunningHostEnvelope = yield* request(continuation)
                  expect(encodedBytes(result)).toBeLessThanOrEqual(1600)
                  if (result.result._tag !== "Success" || result.result.value._tag !== "OccurrencePage")
                    return expect.fail(JSON.stringify(result))
                  const page: OccurrencePage = result.result.value
                  expect(page.prefix).toEqual(prefix)
                  expect(page.covered).toEqual({ first: page.items[0]?.identity, last: page.items.at(-1)?.identity })
                  items.push(...page.items)
                  pages++
                  if (pages === 1) yield* appendPause(21)
                  if (page.progress._tag === "Complete") break
                  continuation = page.progress.continuation
                  if (pages > 30) return expect.fail("continuation must progress")
                }
                expect(pages).toBeGreaterThan(1)
                expect(items).toEqual(canonical.items)
                const beforeOversized = yield* store.read(runId)
                const oversized = yield* appendPause(22, TaskId.make("🦮".repeat(2048)))
                const oversizedPrefix = TraceCursor.make({ runId, position: oversized.position })
                const oversizedRequest = {
                  _tag: "ReadOccurrencePage" as const,
                  prefix: oversizedPrefix,
                  continuation: { prefix: oversizedPrefix, next: oversizedPrefix },
                  capacityBytes: OccurrencePageCapacity.make(1024)
                }
                const first = yield* callRunningHost(address, runId, oversizedRequest)
                expect(first).toMatchObject({
                  result: {
                    _tag: "Success",
                    value: {
                      _tag: "OccurrenceTooLarge",
                      identity: oversizedPrefix,
                      continuation: { prefix: oversizedPrefix, next: oversizedPrefix },
                      requiredResponseBytes: expect.any(Number),
                      occurrenceBytes: expect.any(Number)
                    }
                  }
                })
                expect(encodedBytes(first)).toBeLessThanOrEqual(1024)
                if (first.result._tag === "Success" && first.result.value._tag === "OccurrenceTooLarge") {
                  expect(first.result.value.requiredResponseBytes).toBeGreaterThan(1024)
                  expect(first.result.value.occurrenceBytes).toBeGreaterThan(8192)
                }
                expect((yield* callRunningHost(address, runId, oversizedRequest)).result).toEqual(first.result)
                expect(
                  yield* callRunningHost(address, runId, {
                    ...oversizedRequest,
                    capacityBytes: OccurrencePageCapacity.make(32768)
                  })
                ).toMatchObject({
                  result: {
                    value: {
                      _tag: "OccurrencePage",
                      covered: { first: oversizedPrefix, last: oversizedPrefix },
                      progress: { _tag: "Complete" }
                    }
                  }
                })
                expect(yield* request(null, 1048576)).toMatchObject({
                  result: { value: { _tag: "OccurrencePage", items: canonical.items, progress: { _tag: "Complete" } } }
                })
                expect(
                  yield* request({ prefix, next: TraceCursor.make({ runId, position: JournalPosition.make(1) }) })
                ).toMatchObject({
                  result: { error: { _tag: "InvalidRequest", code: "OccurrenceContinuationInvalid" } }
                })
                const foreign = TraceCursor.make({ runId: RunId.make("foreign"), position: prefix.position })
                expect(yield* request({ prefix: foreign, next: foreign })).toMatchObject({
                  result: { error: { _tag: "InvalidRequest" } }
                })
                expect(
                  yield* callRunningHost(address, runId, {
                    _tag: "ReadOccurrencePage",
                    prefix: TraceCursor.make({ runId, position: JournalPosition.make(9999) }),
                    continuation: null,
                    capacityBytes: OccurrencePageCapacity.make(1600)
                  })
                ).toMatchObject({ result: { error: { _tag: "ReadFailed", causeTag: "TraceCursorNotCommitted" } } })
                // Runtime misuse deliberately crosses the JSON schema boundary.
                const descriptor = yield* readRunningHostDescriptor(address)
                const unsupported = yield* Effect.gen(function* () {
                  const raw = yield* HttpClientRequest.bodyJson(HttpClientRequest.post(`${address}/dalph/v1/request`), {
                    protocolVersion: 1,
                    hostInstanceId: descriptor.hostInstanceId,
                    requestId: "invalid-capacity",
                    runId,
                    operation: { _tag: "ReadOccurrencePage", prefix, continuation: null, capacityBytes: 1048577 }
                  })
                  const response = yield* HttpClient.execute(raw)
                  return yield* decodeRunningHostResponseJson(response)
                }).pipe(Effect.provide(NodeHttpClient.layerUndici))
                expect(unsupported).toMatchObject({ result: { error: { _tag: "InvalidRequest" } } })
                expect((yield* store.read(runId)).slice(0, -1)).toEqual(beforeOversized)
                expect(yield* Ref.get(fixture.trackerCalls)).toBe(0)
                expect(yield* Ref.get(fixture.gitCalls)).toBe(0)
                expect(yield* Deferred.isDone(fixture.turnEntered)).toBe(false)
                const corruptAddress = yield* availableLocalHostAddress
                yield* serveRunningHost(corruptAddress, {
                  ...observation,
                  traceReader: {
                    ...observation.traceReader,
                    readOccurrencesAt: makeTraceReader({
                      read: () => Effect.succeed(records.filter((record) => record.position !== 2))
                    }).readOccurrencesAt
                  }
                })
                expect(
                  yield* callRunningHost(corruptAddress, runId, {
                    _tag: "ReadOccurrencePage",
                    prefix,
                    continuation: null,
                    capacityBytes: OccurrencePageCapacity.make(1024)
                  })
                ).toMatchObject({
                  result: { _tag: "Failure", error: { _tag: "ReadFailed", causeTag: "TraceJournalPrefixInvalid" } }
                })
                // A gated optional history preparation cannot acquire the current-status reader.
                const entered = yield* Deferred.make<void>()
                const release = yield* Deferred.make<void>()
                const secondAddress = yield* availableLocalHostAddress
                yield* serveRunningHost(secondAddress, {
                  ...observation,
                  traceReader: {
                    ...observation.traceReader,
                    readOccurrencesAt: (cursor) =>
                      Deferred.succeed(entered, undefined).pipe(
                        Effect.andThen(Deferred.await(release)),
                        Effect.andThen(makeTraceReader({ read: store.read }).readOccurrencesAt(cursor))
                      )
                  }
                })
                const pending = yield* callRunningHost(secondAddress, runId, {
                  _tag: "ReadOccurrencePage",
                  prefix,
                  continuation: null,
                  capacityBytes: OccurrencePageCapacity.make(1600)
                }).pipe(Effect.forkScoped)
                yield* Deferred.await(entered)
                expect(yield* callRunningHost(secondAddress, runId, { _tag: "ReadSnapshot" })).toMatchObject({
                  result: { _tag: "Success" }
                })
                yield* Deferred.succeed(release, undefined)
                yield* Fiber.join(pending)
                expect((yield* store.read(runId)).slice(0, -1)).toEqual(beforeOversized)
                expect(yield* Ref.get(fixture.trackerCalls)).toBe(0)
                expect(yield* Ref.get(fixture.gitCalls)).toBe(0)
                expect(yield* Deferred.isDone(fixture.turnEntered)).toBe(false)
              })
            ),
          "Run",
          "Listening"
        )
      })
    ).pipe(Effect.provide(runningHostFixtureLayer), Effect.timeout("25 seconds")),
  30000
)

it.live(
  "reports the SQLite archive owner's historical deletion without mutating authorities or losing compact Run control",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* makeRunningHostFixture(builtEntry, true, {})
        const storeReady = yield* Deferred.make<JournalStore["Service"]>()
        const graph = {
          ...fixture.graph,
          foundation: (...args: Parameters<typeof fixture.graph.foundation>) =>
            fixture.graph
              .foundation(...args)
              .pipe(Layer.tap((context) => Deferred.succeed(storeReady, Context.get(context, JournalStore))))
        }
        const offset = yield* Ref.make(0)
        const clock = yield* Clock.Clock
        const archiveClock = {
          monotonicTimeNanos: clock.monotonicTimeNanos,
          monotonicTimeNanosUnsafe: () => clock.monotonicTimeNanosUnsafe(),
          currentTimeNanos: clock.currentTimeNanos,
          currentTimeNanosUnsafe: () => clock.currentTimeNanosUnsafe(),
          currentTimeMillisUnsafe: () => clock.currentTimeMillisUnsafe(),
          sleep: (duration: Duration.Duration) => clock.sleep(duration),
          currentTimeMillis: clock.currentTimeMillis.pipe(
            Effect.flatMap((now) => Ref.get(offset).pipe(Effect.map((delta) => now + delta)))
          )
        }
        const address = yield* availableLocalHostAddress
        yield* withDecodedProductionRepositoryHost(
          fixture.configuration,
          graph,
          (observation) =>
            Effect.scoped(
              Effect.gen(function* () {
                const store = yield* Deferred.await(storeReady)
                const runId = observation.selection.runId
                const finality = completedRunFinalityFixture({
                  runId,
                  target: observation.target,
                  observedAt: JournalPosition.make(4)
                })
                yield* store.append(runId, intentRecordKey(finality.operation.operationId), finality.intent)
                yield* store.append(runId, outcomeRecordKey(finality.operation.operationId), finality.observation)
                const terminal = yield* store.terminateRun(runId, "Completed", finality.evidence)
                const prefix = TraceCursor.make({ runId, position: terminal.position })
                yield* serveRunningHost(address, observation)
                const read = () =>
                  callRunningHost(address, runId, {
                    _tag: "ReadOccurrencePage",
                    prefix,
                    continuation: null,
                    capacityBytes: OccurrencePageCapacity.make(1048576)
                  })
                expect(yield* read()).toMatchObject({
                  result: { value: { _tag: "OccurrencePage", progress: { _tag: "Complete" } } }
                })
                yield* fixture.retireHistory(runId)
                expect(yield* read()).toMatchObject({
                  result: { value: { _tag: "OccurrencePage", progress: { _tag: "Complete" } } }
                })
                yield* Ref.set(offset, 30 * 24 * 60 * 60 * 1000)
                yield* fixture.maintainArchive
                expect(yield* read()).toMatchObject({
                  result: { _tag: "Failure", error: { _tag: "ReadFailed", causeTag: "JournalHistoryDeleted" } }
                })
                expect(yield* callRunningHost(address, runId, { _tag: "ReadRunControl" })).toMatchObject({
                  result: { value: { _tag: "RunTerminated", completionResult: { history: "Deleted" } } }
                })
                expect(yield* Ref.get(fixture.trackerCalls)).toBe(0)
                expect(yield* Ref.get(fixture.gitCalls)).toBe(0)
                expect(yield* Deferred.isDone(fixture.turnEntered)).toBe(false)
                expect(yield* fixture.readHistory(runId).pipe(Effect.flip)).toMatchObject({
                  _tag: "JournalHistoryDeleted"
                })
              })
            ),
          "Run",
          "Listening"
        ).pipe(Effect.provideService(Clock.Clock, archiveClock))
      })
    ).pipe(Effect.provide(runningHostFixtureLayer), Effect.timeout("15 seconds")),
  20000
)
