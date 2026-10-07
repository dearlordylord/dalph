import "./live-task-graph.css"
import { TaskId } from "@dalph/contracts"
import { Clock, Context, Effect, Fiber, Layer, Schedule, Schema } from "effect"
import { registerDeliveryGraph } from "../../../prototypes/reducer-lab/src/delivery-graph-renderer.ts"
import {
  deliveryGraphEncoding,
  type DeliveryGraphElement
} from "../../../prototypes/reducer-lab/src/delivery-graph-element.ts"
import {
  RunningHostDescriptor,
  RunningHostEnvelope,
  RunningHostWatchFrame,
  RunningHostRequest,
  runningHostLimits,
  type RunningHostInspectionSnapshot
} from "../src/application/running-host-contract.js"
import { projectLiveTaskGraph } from "./live-task-graph-projection.ts"
import { browserRequestId } from "./request-id.ts"

class PageEnvironment extends Context.Service<
  PageEnvironment,
  { readonly fetch: typeof window.fetch; readonly randomUuid: () => string }
>()("@dalph/PageEnvironment") {}
const pageEnvironment = Layer.succeed(PageEnvironment, {
  fetch: window.fetch.bind(window),
  randomUuid: () => browserRequestId(window.crypto)
})
const jsonIndentSpaces = 2
const millisecondsPerSecond = 1000
registerDeliveryGraph()
const element = (id: string): HTMLElement => {
  const found = document.getElementById(id)
  if (found === null) throw new Error(`Page element missing: ${id}`)
  return found
}
const requireGraph = (): DeliveryGraphElement => {
  const found = document.querySelector<DeliveryGraphElement>("dalph-delivery-graph")
  if (found === null) throw new Error("Graph widget missing")
  return found
}
const graph = requireGraph()
const connection = element("connection")
const freshness = element("freshness")
const requireRefresh = (): HTMLButtonElement => {
  const found = element("refresh")
  if (!(found instanceof HTMLButtonElement)) throw new Error("Refresh button missing")
  return found
}
const refresh = requireRefresh()
const taskFacts = element("task")
const runFacts = element("run")
const trackerFacts = element("tracker")
element("legend").textContent = Object.values(deliveryGraphEncoding)
  .map((encoding) => encoding.legend)
  .join(" · ")
let descriptor: typeof RunningHostDescriptor.Type | null = null
let current: RunningHostInspectionSnapshot | null = null
let selected: TaskId | null = null

const renderTask = (): void => {
  const inspection = current?.inspection
  if (selected === null || inspection === undefined || (inspection._tag !== "Ready" && inspection._tag !== "Stale"))
    return
  const task = inspection.value.graph.tasks.find((candidate) => candidate.id === selected)
  const run = current?.run._tag === "Closed" ? current.run.final : current?.run
  const diagnostic =
    run?._tag === "Ready" && run.delivery._tag === "DeliveryStatusAvailable"
      ? run.delivery.diagnostics?.tasks.find((candidate) => candidate.taskId === selected)
      : undefined
  taskFacts.textContent =
    task === undefined
      ? "Task no longer appears in the current graph."
      : JSON.stringify({ task, runObservation: diagnostic ?? null }, null, jsonIndentSpaces)
}
const renderFreshness = (now: number): void => {
  const inspection = current?.inspection
  if (inspection === undefined) return
  if (inspection._tag === "Ready" || inspection._tag === "Stale") {
    const age = Math.max(0, Math.floor((now - inspection.value.observedAt) / millisecondsPerSecond))
    freshness.textContent = `Last complete graph: ${new Date(inspection.value.observedAt).toLocaleString()} (${age}s ago).${inspection._tag === "Stale" ? ` Refresh failed: ${inspection.reason}.` : ""}`
  } else
    freshness.textContent =
      inspection._tag === "Loading"
        ? "Waiting for a complete tracker observation."
        : `Graph unavailable: ${inspection.reason}.`
}
const render = Effect.fn("LiveGraph.render")(function* (value: RunningHostInspectionSnapshot) {
  current = value
  graph.projection = projectLiveTaskGraph(value)
  renderFreshness(yield* Clock.currentTimeMillis)
  const run = value.run._tag === "Closed" ? value.run.final : value.run
  runFacts.textContent = `Run ${value.run.runId} · ${value.run._tag}${run?._tag === "Ready" ? ` · observed journal position ${run.acceptedAt?.position ?? "unavailable"}` : ""}. Tracker and Run observations have separate freshness.`
  trackerFacts.textContent =
    run?._tag === "Ready" && run.delivery._tag === "DeliveryStatusAvailable"
      ? JSON.stringify(run.delivery.diagnostics?.trackerWait ?? { _tag: "None" })
      : "Run tracker diagnostics unavailable."
  renderTask()
})
class PageObservationFailure extends Schema.TaggedError<PageObservationFailure>()("PageObservationFailure", {
  phase: Schema.Literals(["Descriptor", "Read", "Watch"]),
  reason: Schema.NonEmptyString
}) {}
const failed = (phase: PageObservationFailure["phase"], reason: string) => new PageObservationFailure({ phase, reason })
const request = Effect.fn("LiveGraph.request")(function* (operation: RunningHostRequest["operation"]) {
  if (descriptor === null) return yield* failed("Descriptor", "HostDescriptorUnavailable")
  const environment = yield* PageEnvironment
  return {
    protocolVersion: 1 as const,
    hostInstanceId: descriptor.hostInstanceId,
    runId: descriptor.selectedRun.runId,
    requestId: yield* Schema.decodeUnknownEffect(RunningHostRequest.fields.requestId)(environment.randomUuid()),
    operation
  }
})
const fetchResponse = Effect.fn("LiveGraph.fetch")(function* (
  path: string,
  init: RequestInit,
  phase: PageObservationFailure["phase"]
) {
  const environment = yield* PageEnvironment
  return yield* Effect.tryPromise({
    try: (signal) =>
      environment.fetch(path, {
        ...init,
        signal: init.signal === undefined || init.signal === null ? signal : AbortSignal.any([signal, init.signal])
      }),
    catch: () => failed(phase, "ConnectionFailed")
  }).pipe(
    Effect.timeoutOrElse({
      duration: runningHostLimits.connectDeadlineMillis,
      orElse: () => Effect.fail(failed(phase, "ConnectionTimedOut"))
    })
  )
})
const responseJson = Effect.fn("LiveGraph.responseJson")(function* (
  response: Response,
  phase: PageObservationFailure["phase"]
) {
  const text = yield* Effect.tryPromise({
    try: () => response.text(),
    catch: () => failed(phase, "ResponseReadFailed")
  }).pipe(
    Effect.timeoutOrElse({
      duration: runningHostLimits.responseDeadlineMillis,
      orElse: () => Effect.fail(failed(phase, "ResponseTimedOut"))
    })
  )
  return yield* Effect.try({ try: (): unknown => JSON.parse(text), catch: () => failed(phase, "ResponseJsonInvalid") })
})
const read = Effect.fn("LiveGraph.read")(function* (operation: RunningHostRequest["operation"]) {
  const input = yield* request(operation)
  const response = yield* fetchResponse(
    "/dalph/v1/request",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) },
    "Read"
  )
  const value = yield* Schema.decodeUnknownEffect(RunningHostEnvelope)(yield* responseJson(response, "Read"))
  if (value.requestId !== input.requestId || value.runId !== input.runId)
    return yield* failed("Read", "ResponseCorrelationInvalid")
  if (value.result._tag === "Failure") return yield* Effect.fail(value.result.error)
  if (value.result.value._tag !== "InspectionSnapshot") return yield* failed("Read", "InspectionSnapshotRequired")
  // Initial read precedes watch. A manual response never overwrites a newer
  // watch observation received while its refresh request was in flight.
  if (operation._tag === "ReadInspectionSnapshot") yield* render(value.result.value)
})
const watch = Effect.fn("LiveGraph.watch")(function* () {
  const input = yield* request({ _tag: "WatchInspection" })
  const controller = yield* Effect.acquireRelease(
    Effect.sync(() => new AbortController()),
    (owned) => Effect.sync(() => owned.abort())
  )
  const response = yield* fetchResponse(
    "/dalph/v1/watch",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: controller.signal
    },
    "Watch"
  )
  if (!response.ok || response.body === null) return yield* failed("Watch", "WatchStreamUnavailable")
  const body = response.body
  const reader = yield* Effect.acquireRelease(
    Effect.sync(() => body.getReader()),
    (owned) =>
      Effect.tryPromise({ try: () => owned.cancel(), catch: () => failed("Watch", "ReaderCloseFailed") }).pipe(
        Effect.ignore,
        Effect.andThen(Effect.sync(() => owned.releaseLock()))
      )
  )
  const decoder = new TextDecoder("utf-8", { fatal: true })
  let pending = ""
  let sequence = 0
  let subscription: string | null = null
  for (;;) {
    const chunk = yield* Effect.tryPromise({ try: () => reader.read(), catch: () => failed("Watch", "ReadFailed") })
    if (chunk.done) return yield* failed("Watch", "WatchEnded")
    pending += yield* Effect.try({
      try: () => decoder.decode(chunk.value, { stream: true }),
      catch: () => failed("Watch", "Utf8Invalid")
    })
    let newline = pending.indexOf("\n")
    while (newline >= 0) {
      if (new TextEncoder().encode(pending.slice(0, newline)).byteLength + 1 > runningHostLimits.frameBytes)
        return yield* failed("Watch", "FrameTooLarge")
      const json = yield* Effect.try({
        try: (): unknown => JSON.parse(pending.slice(0, newline)),
        catch: () => failed("Watch", "FrameJsonInvalid")
      })
      const value = yield* Schema.decodeUnknownEffect(RunningHostWatchFrame)(json)
      pending = pending.slice(newline + 1)
      if (
        value.requestId !== input.requestId ||
        value.runId !== input.runId ||
        value.sequence !== sequence ||
        (subscription !== null && subscription !== value.subscriptionId)
      )
        return yield* failed("Watch", "FrameCorrelationInvalid")
      subscription = value.subscriptionId
      sequence += 1
      if (value.frame._tag === "Failure") return yield* Effect.fail(value.frame.error)
      if (value.frame._tag !== "Inspection") return yield* failed("Watch", "InspectionFrameRequired")
      yield* render(value.frame.value)
      newline = pending.indexOf("\n")
    }
    if (new TextEncoder().encode(pending).byteLength + 1 > runningHostLimits.frameBytes)
      return yield* failed("Watch", "FrameTooLarge")
  }
})
const connect = Effect.gen(function* () {
  const response = yield* fetchResponse("/dalph/v1/descriptor", {}, "Descriptor")
  descriptor = yield* Schema.decodeUnknownEffect(RunningHostDescriptor)(yield* responseJson(response, "Descriptor"))
  yield* read({ _tag: "ReadInspectionSnapshot" })
  connection.textContent = `Connected to ${location.host}`
  connection.dataset["state"] = "connected"
  refresh.disabled = false
  yield* watch()
}).pipe(
  Effect.scoped,
  Effect.catch((error) =>
    Effect.sync(() => {
      descriptor = null
      connection.textContent = `Connection unavailable: ${JSON.stringify(error)}. Reconnecting…`
      connection.dataset["state"] = "failed"
      refresh.disabled = true
    })
  ),
  Effect.andThen(Effect.sleep("3 seconds"))
)
refresh.addEventListener("click", () => {
  refresh.disabled = true
  Effect.runFork(
    read({ _tag: "RefreshInspection" }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          connection.textContent = `Refresh unavailable: ${JSON.stringify(error)}`
        })
      ),
      Effect.ensuring(
        Effect.sync(() => {
          refresh.disabled = descriptor === null
        })
      ),
      Effect.provide(pageEnvironment)
    )
  )
})
graph.addEventListener("task-selected", (event) => {
  const detail = Schema.decodeUnknownOption(Schema.Struct({ taskId: TaskId }))(event.detail)
  if (detail._tag === "None") return
  selected = detail.value.taskId
  renderTask()
})
const freshnessUpdates = Effect.runFork(
  Clock.currentTimeMillis.pipe(
    Effect.tap((now) => Effect.sync(() => renderFreshness(now))),
    Effect.repeat(Schedule.spaced("1 second"))
  )
)
// Reconnect only through this origin's descriptor. No scheduling command or
// tracker mutation is replayed by this process-local observation loop.
const observation = Effect.runFork(connect.pipe(Effect.forever, Effect.provide(pageEnvironment)))
window.addEventListener(
  "pagehide",
  () => {
    Effect.runFork(Fiber.interruptAll([observation, freshnessUpdates]))
  },
  { once: true }
)
