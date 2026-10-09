import { TaskId } from "@dalph/contracts"
import {
  currentSignalOf,
  currentSignalFromCurrentFirstStream,
  FixtureTarget,
  JournalPosition,
  JournalRecordKey,
  OperationId,
  projectDeliveryDiagnostics,
  TaskDagSnapshot,
  TrackerRevision,
  TrackerSnapshot,
  type JournalRecord
} from "@dalph/orchestrator"
import { it } from "@effect/vitest"
import { Effect, Ref, Stream } from "effect"
import { expect } from "vitest"
import { workflowJournalEventVersion } from "../../../orchestrator/src/workflow/kernel/event.js"
import { taskTrackerFactsObservedEvent } from "../../../orchestrator/src/workflow/task-tracker-facts/observation.js"
import { acceptedJournalPrefixFromValidatedHistory } from "../../../orchestrator/src/workflow-journal/accepted-prefix.js"
import { runningHostPageObservation } from "../../test-support/running-host-page-observation.js"
import { availableLocalHostAddress, makeRunningHostReadProbe } from "../../test-support/running-host-read-probe.js"
import { serveRunningHost } from "./running-host-http.js"
import { watchRunningHost } from "./running-host-watch-client.js"
import { projectRunningHostSnapshot } from "./running-host-projection.js"
import { readRunningHostWatchCurrent } from "./running-host-watch-diagnostics.js"
import { observerRetentionLimits } from "./running-host-observer-budget.js"

it.live(
  "A Ready watch refuses large diagnostic preparation before materialization despite small current output, then reconnects passively",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const probe = yield* makeRunningHostReadProbe()
        const graph = TaskDagSnapshot.project(
          TrackerSnapshot.make({
            revision: TrackerRevision.make("budget-graph"),
            tasks: [{ id: TaskId.make("root"), lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
          })
        )
        if (graph._tag === "Invalid") return yield* Effect.die("invalid budget graph")
        const state = yield* runningHostPageObservation(probe.runId, graph.snapshot)
        const target = FixtureTarget.make("budget-graph")
        // The canonical prefix boundary is controlled here; journal semantic
        // qualification belongs to its existing tests. No observer exports it.
        const records: ReadonlyArray<JournalRecord> = Array.from({ length: 2200 }, (_, index) => {
          const operationId = OperationId.make(`read-${index}`)
          return {
            runId: probe.runId,
            position: JournalPosition.make(index + 1),
            key: JournalRecordKey.make(`record-${index}`),
            event: {
              ...taskTrackerFactsObservedEvent(operationId, {
                _tag: "TaskTrackerFactsReadFailed",
                completeness: "Unreadable",
                operationId,
                target,
                failure: { _tag: "TrackerAdapterReadError", detail: "x".repeat(4096), reason: { _tag: "CircuitOpen" } }
              }),
              version: workflowJournalEventVersion
            }
          }
        })
        const large = acceptedJournalPrefixFromValidatedHistory(probe.runId, records)
        const small = acceptedJournalPrefixFromValidatedHistory(probe.runId, records.slice(-1))
        const canonical = yield* Ref.make(large)
        const raw = currentSignalOf(state)
        const diagnostic = projectDeliveryDiagnostics(probe.runId, large, undefined, target)
        const snapshot = yield* projectRunningHostSnapshot(probe.runId, {
          ...state,
          evaluation: { ...state.evaluation, diagnostics: diagnostic }
        })
        expect(JSON.stringify(snapshot).length).toBeLessThan(10000)
        const read = readRunningHostWatchCurrent(raw, { readAccepted: () => Ref.get(canonical) }, probe.runId, target)
        expect(yield* read.pipe(Effect.flip)).toEqual({
          _tag: "ObserverRetentionExceeded",
          boundary: "Preparation",
          maximumBytes: observerRetentionLimits.preparationBytes
        })
        const address = yield* availableLocalHostAddress
        yield* serveRunningHost(address, {
          ...probe.observation,
          current: raw,
          watchCurrent: currentSignalFromCurrentFirstStream(Stream.concat(Stream.fromEffect(read), Stream.never))
        })
        const refused = yield* watchRunningHost(address, probe.runId).pipe(Stream.runCollect)
        expect(refused).toHaveLength(1)
        expect(refused[0]?.frame).toMatchObject({
          _tag: "Failure",
          error: { _tag: "ObserverRetentionExceeded", boundary: "Preparation" }
        })
        yield* Ref.set(canonical, small)
        const reconnected = yield* watchRunningHost(address, probe.runId).pipe(Stream.take(1), Stream.runCollect)
        expect(reconnected[0]?.frame).toMatchObject({ _tag: "Snapshot", value: { _tag: "Ready", runId: probe.runId } })
        expect(yield* raw.get).toEqual(state)
        expect(yield* Ref.get(probe.reads)).toBe(0)
        expect(yield* Ref.get(canonical)).toBe(small)
      })
    )
)
