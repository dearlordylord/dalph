import { PlannedAttemptExecutorFailureCode, RunId, TaskId } from "@dalph/contracts"
import { TraceCursor } from "@dalph/orchestrator"
import { Effect, Schema } from "effect"
import { RequestId, type RunningHostEnvelope, type RunningHostError } from "./running-host-contract.js"
import type { RunningHostSnapshot } from "./running-host-snapshot.js"

/** Counts an observed presentation family; never grants workflow or resource authority. */
const ObservationCount = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
  Schema.brand("CompactObservationCount")
)
type ObservationCount = typeof ObservationCount.Type
const Counts = Schema.Record(Schema.String, ObservationCount)
const Example = Schema.Struct({
  taskId: Schema.NullOr(TaskId),
  kind: Schema.NonEmptyString,
  failureCode: Schema.NullOr(PlannedAttemptExecutorFailureCode)
})
type Example = typeof Example.Type
const Examples = Schema.Struct({ total: ObservationCount, items: Schema.Array(Example), omitted: ObservationCount })
const Delivery = Schema.TaggedUnion({
  Unavailable: {},
  Available: { byKind: Counts, byClassification: Counts, byFailure: Counts, blocked: Examples, waiting: Examples }
})
const Diagnostics = Schema.TaggedUnion({
  Unavailable: {},
  Available: {
    byPhase: Counts,
    byFailure: Counts,
    byRecovery: Counts,
    trackerWait: Schema.String,
    baseAdmission: Schema.String,
    baseRefusals: Counts,
    failures: Examples
  }
})
const Observation = Schema.TaggedUnion({
  Unavailable: {},
  Available: {
    acceptedAt: Schema.NullOr(TraceCursor),
    graph: Schema.TaggedUnion({ Unavailable: {}, Available: { byLifecycle: Counts, total: ObservationCount } }),
    delivery: Delivery,
    diagnostics: Diagnostics,
    held: Examples,
    retained: Examples,
    retainedByKind: Counts,
    cleanup: Schema.TaggedStruct("Unavailable", { reason: Schema.Literal("CleanupNotInSnapshot") })
  }
})
export const CompactRunningHostEnvelope = Schema.TaggedStruct("CompactRunSnapshot", {
  protocolVersion: Schema.Literal(1),
  requestId: Schema.NullOr(RequestId),
  runId: Schema.NullOr(RunId),
  fullInspection: Schema.Literal("Repeat the same snapshot command without --compact"),
  result: Schema.TaggedUnion({
    Failure: { category: Schema.NonEmptyString, phase: Schema.NullOr(Schema.String), detailsOmitted: Schema.Boolean },
    Success: { publication: Schema.Literals(["NotReady", "Ready", "Closed"]), observation: Observation }
  })
})
export type CompactRunningHostEnvelope = typeof CompactRunningHostEnvelope.Type
export const compactSnapshotMaximumBytes = 8192

const countBy = <A>(items: ReadonlyArray<A>, key: (item: A) => string): Readonly<Record<string, ObservationCount>> =>
  Object.fromEntries(
    [...new Set(items.map(key))].map((name) => [
      name,
      ObservationCount.make(items.filter((item) => key(item) === name).length)
    ])
  )
const maximumExampleTaskIdCharacters = 128
const defaultExampleLimit = 3
const examples = (items: ReadonlyArray<Example>, limit: number): typeof Examples.Type => {
  const selected = items
    .filter(({ taskId }) => taskId === null || taskId.length <= maximumExampleTaskIdCharacters)
    .slice(0, limit)
  return {
    total: ObservationCount.make(items.length),
    items: selected,
    omitted: ObservationCount.make(items.length - selected.length)
  }
}
const simpleExample = (taskId: TaskId | null, kind: string): Example => ({ taskId, kind, failureCode: null })
type Ready = Extract<RunningHostSnapshot, { readonly _tag: "Ready" }>

const summarizeReady = (ready: Ready, limit: number): typeof Observation.Type => {
  const delivery = ready.delivery._tag === "DeliveryStatusAvailable" ? ready.delivery : undefined
  const diagnostics = delivery?.diagnostics
  const base = diagnostics?.attemptBaseAdmission
  return {
    _tag: "Available",
    acceptedAt: ready.acceptedAt,
    graph:
      ready.graph._tag === "GraphNotEstablished"
        ? { _tag: "Unavailable" }
        : {
            _tag: "Available",
            total: ObservationCount.make(ready.graph.snapshot.tasks.length),
            byLifecycle: countBy(ready.graph.snapshot.tasks, (task) => task.lifecycle._tag)
          },
    delivery:
      delivery === undefined
        ? { _tag: "Unavailable" }
        : {
            _tag: "Available",
            byKind: countBy(delivery.entries, (entry) => entry._tag),
            byClassification: countBy(delivery.entries, (entry) => entry.classification),
            byFailure: countBy(
              delivery.entries.filter((entry) => entry._tag === "ExecutorFailure"),
              (entry) => (entry.reason._tag === "Known" ? entry.reason.code : "Unavailable")
            ),
            blocked: examples(
              delivery.entries
                .filter((entry) => entry.classification === "Blocked")
                .map((entry) => simpleExample(entry.subject._tag === "Task" ? entry.subject.taskId : null, entry._tag)),
              limit
            ),
            waiting: examples(
              delivery.entries
                .filter((entry) => entry.classification === "Waiting")
                .map((entry) => simpleExample(entry.subject._tag === "Task" ? entry.subject.taskId : null, entry._tag)),
              limit
            )
          },
    diagnostics:
      diagnostics === undefined
        ? { _tag: "Unavailable" }
        : {
            _tag: "Available",
            byPhase: countBy(diagnostics.tasks, (task) => task.phase),
            byFailure: countBy(diagnostics.tasks, (task) =>
              task.failure._tag === "Known" ? task.failure.code : task.failure._tag
            ),
            byRecovery: countBy(diagnostics.tasks, (task) => task.recovery._tag),
            trackerWait: diagnostics.trackerWait._tag,
            baseAdmission: base?._tag ?? "NotObserved",
            baseRefusals: countBy(
              base?._tag === "QualificationRefused" ? base.refusals : [],
              (refusal) => refusal.boundary
            ),
            failures: examples(
              diagnostics.tasks
                .filter((task) => task.phase === "Failed" || task.phase === "Rejected")
                .map((task) => ({
                  taskId: task.taskId,
                  kind: task.phase,
                  failureCode: task.failure._tag === "Known" ? task.failure.code : null
                })),
              limit
            )
          },
    held: examples(
      ready.held.map(({ taskId }) => simpleExample(taskId, "HeldResponsibility")),
      limit
    ),
    retained: examples(
      ready.retained.map(({ kind, taskId }) => simpleExample(taskId, kind)),
      limit
    ),
    retainedByKind: countBy(ready.retained, (item) => item.kind),
    cleanup: { _tag: "Unavailable", reason: "CleanupNotInSnapshot" }
  }
}

/** Projects only decoded public facts, retaining unavailable state and explicit omissions. */
export const compactRunningHostEnvelope = (
  envelope: RunningHostEnvelope,
  exampleLimit = defaultExampleLimit
): CompactRunningHostEnvelope => {
  const common = {
    _tag: "CompactRunSnapshot" as const,
    protocolVersion: 1 as const,
    requestId: envelope.requestId,
    runId: envelope.runId,
    fullInspection: "Repeat the same snapshot command without --compact" as const
  }
  if (envelope.result._tag === "Failure")
    return {
      ...common,
      result: {
        _tag: "Failure",
        category: envelope.result.error._tag,
        phase: envelope.result.error._tag === "TransportFailed" ? envelope.result.error.phase : null,
        detailsOmitted: true
      }
    }
  const value = envelope.result.value
  if (value._tag !== "Ready" && value._tag !== "NotReady" && value._tag !== "Closed")
    return { ...common, result: { _tag: "Failure", category: "InvalidRequest", phase: null, detailsOmitted: true } }
  const ready = value._tag === "Ready" ? value : value._tag === "Closed" ? value.final : null
  return {
    ...common,
    result: {
      _tag: "Success",
      publication: value._tag,
      observation: ready === null ? { _tag: "Unavailable" } : summarizeReady(ready, exampleLimit)
    }
  }
}

/** Bound examples without truncating identities or category/count evidence. */
export const encodeCompactRunningHostEnvelope = Effect.fn("RunningHostCli.encodeCompactSnapshot")(function* (
  envelope: RunningHostEnvelope
) {
  for (let limit = defaultExampleLimit; limit >= 0; limit--) {
    const text = yield* Schema.encodeUnknownEffect(CompactRunningHostEnvelope)(
      compactRunningHostEnvelope(envelope, limit)
    ).pipe(
      Effect.map((value) => JSON.stringify(value)),
      Effect.mapError(
        (): RunningHostError => ({
          _tag: "ProjectionFailed",
          causeTag: "CompactSnapshotEncoding",
          detail: "compact snapshot could not be encoded"
        })
      )
    )
    if (new TextEncoder().encode(text).byteLength + 1 <= compactSnapshotMaximumBytes) return text
  }
  return yield* Effect.fail<RunningHostError>({
    _tag: "FrameTooLarge",
    direction: "Outgoing",
    maximumBytes: compactSnapshotMaximumBytes,
    measuredBytes: null
  })
})
