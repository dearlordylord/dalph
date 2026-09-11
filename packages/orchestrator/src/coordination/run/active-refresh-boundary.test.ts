import { it } from "@effect/vitest"
import { expect } from "vitest"
import { Effect, Option } from "effect"
import {
  makeTaskWorkSpecification,
  PlannedAttemptExecutorReport,
  plannedAttemptExecutorCorrelation
} from "@dalph/contracts"
import { makeExecutingAttemptHistory } from "../../../test/support/executing-attempt-history.js"
import { integrationFinalityFixture } from "../../workflow/protocols/integration-finality/fixtures.js"
import { liveJournalTestLayer } from "../delivery/live-journal-test-layer.js"
import { Journal } from "../delivery/journal.js"
import { InRunJournal, type JournalRecord } from "../../workflow-journal/store.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { observeJournalRecordSequenceOperations } from "../../workflow-journal/record-sequence.js"
import { RunPolicyRevision } from "../../control/policy.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { TaskWorkCapacityChangedEvent, taskTrackerReadIntent } from "../../workflow/registry/event.js"
import { projectTrackerSnapshot } from "../../authorities/task-tracker/graph.js"
import { TaskLifecycle, TrackerRevision } from "../../authorities/task-tracker/task.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  makeFocusedTaskWorkSpecificationFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../workflow/task-tracker-facts/observation.js"
import { describeJournalEvent } from "../../workflow/registry/event-descriptor.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import {
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorCommandResponseObservedEvent,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent
} from "../../workflow/protocols/planned-attempt-executor-work/events.js"
import {
  activeWorkAuthorityRefreshForOwner,
  activeWorkAuthorityRefreshSubjectsForRunState
} from "./run-activation-opportunity.js"
import { makeRunRecoveryProjection } from "./recovery-activation.js"

it.effect(
  "recovers an unresolved focused read before G1 and resumes G1 after its outcome without scanning unrelated history",
  () =>
    Effect.gen(function* () {
      const costs: Array<number> = []
      for (const count of [64, 256]) {
        const fixture = integrationFinalityFixture
        const specification = makeTaskWorkSpecification({
          body: "pending focused",
          title: "Pending focused",
          taskId: fixture.taskId
        })
        const plannedAttempt = { ...fixture.plannedAttempt, taskRevision: specification.fingerprint }
        const { records: executing } = makeExecutingAttemptHistory({
          activeClaim: fixture.activeClaim,
          plannedAttempt,
          runId: fixture.runId,
          trackerTarget: fixture.target,
          taskSpecification: specification
        })
        const records: Array<JournalRecord> = [...executing]
        for (let ordinal = 2; ordinal <= count; ordinal += 1) {
          const event = TaskWorkCapacityChangedEvent.make({
            capacity: TaskWorkCapacity.make(1),
            initiatedBy: { _tag: "Operator" },
            occurrenceClassification: "InitiatedAction",
            previousRevision: RunPolicyRevision.make(ordinal - 1),
            revision: RunPolicyRevision.make(ordinal),
            version: workflowJournalEventVersion
          })
          records.push({
            event,
            key: describeJournalEvent(event).expectedKey,
            position: JournalPosition.make(records.length + 1),
            runId: fixture.runId
          })
        }
        const cost = yield* Effect.gen(function* () {
          const journal = yield* Journal
          const writer = yield* InRunJournal
          const append = (event: JournalRecord["event"]) =>
            writer.append(fixture.runId, describeJournalEvent(event).expectedKey, event)
          const subjects = activeWorkAuthorityRefreshSubjectsForRunState((yield* journal.state.get).reconstructed)
          const opportunity = activeWorkAuthorityRefreshForOwner("Timer", subjects)
          const acquire = () =>
            makeRunRecoveryProjection(
              fixture.runId,
              fixture.integrationTarget,
              undefined,
              undefined,
              false,
              false,
              opportunity
            )
          const first = yield* acquire()
          const graph = (yield* first.readDeliveryProjection).frontier.transitions.find(
            (transition) => transition._tag === "ObservePlannedAttemptContinuationGraph"
          )
          if (graph?._tag !== "ObservePlannedAttemptContinuationGraph") return yield* Effect.die("expected G1")
          const projected = projectTrackerSnapshot({
            revision: TrackerRevision.make("pending-focused-graph"),
            tasks: [
              {
                id: fixture.taskId,
                lifecycle: TaskLifecycle.cases.Open.make({}),
                parentTaskId: null,
                prerequisiteIds: []
              }
            ]
          })
          const snapshot = Option.getOrThrow(
            projected._tag === "Valid" ? Option.some(projected.snapshot) : Option.none()
          )
          yield* append(taskTrackerReadIntent(graph.operation))
          yield* append(
            taskTrackerFactsObservedEvent(
              graph.operation.operationId,
              makeCompleteTaskTrackerFactsObserved(graph.operation, snapshot)
            )
          )
          const focused = (yield* first.readDeliveryProjection).frontier.transitions.find(
            (transition) => transition._tag === "ObservePlannedAttemptContinuationSpecification"
          )
          if (focused?._tag !== "ObservePlannedAttemptContinuationSpecification")
            return yield* Effect.die("expected focused read")
          yield* append(taskTrackerReadIntent(focused.operation))
          const restarted = yield* acquire()
          let visits = 0
          let materializations = 0
          const stop = observeJournalRecordSequenceOperations((operation) => {
            if (operation._tag === "IndexedRecordVisit") visits += 1
            if (operation._tag === "HistoricalMaterialization") materializations += 1
          })
          try {
            const projection = yield* restarted.readDeliveryProjection
            expect(projection.frontier.transitions).toContainEqual(focused)
            expect(
              projection.frontier.transitions.some(({ _tag }) => _tag === "ObservePlannedAttemptContinuationGraph")
            ).toBe(false)
          } finally {
            stop()
          }
          expect(materializations).toBe(0)
          yield* append(
            taskTrackerFactsObservedEvent(
              focused.operation.operationId,
              makeFocusedTaskWorkSpecificationFactsObserved(focused.operation, specification)
            )
          )
          const next = yield* acquire()
          expect((yield* next.readDeliveryProjection).frontier.transitions[0]?._tag).toBe(
            "ObservePlannedAttemptContinuationGraph"
          )
          return visits
        }).pipe(Effect.provide(liveJournalTestLayer({ records, runId: fixture.runId, target: fixture.target })))
        costs.push(cost)
      }
      expect(costs[0]).toBeGreaterThan(0)
      expect(costs[0]).toBe(costs[1])
    })
)

for (const lifecycle of ["Safe", "Terminal"] as const) {
  it.effect(
    `retains the captured G2 boundary after accepted ${lifecycle} with constant unrelated-history lookup work`,
    () =>
      Effect.gen(function* () {
        const costs: Array<number> = []
        for (const count of [64, 256]) {
          const fixture = integrationFinalityFixture
          const specification = makeTaskWorkSpecification({
            body: "active boundary",
            title: "Active boundary",
            taskId: fixture.taskId
          })
          const plannedAttempt = { ...fixture.plannedAttempt, taskRevision: specification.fingerprint }
          const { records: executing } = makeExecutingAttemptHistory({
            activeClaim: fixture.activeClaim,
            plannedAttempt,
            runId: fixture.runId,
            trackerTarget: fixture.target,
            taskSpecification: specification
          })
          const records: Array<JournalRecord> = [...executing]
          for (let ordinal = 2; ordinal <= count; ordinal += 1) {
            const event = TaskWorkCapacityChangedEvent.make({
              capacity: TaskWorkCapacity.make(1),
              initiatedBy: { _tag: "Operator" },
              occurrenceClassification: "InitiatedAction",
              previousRevision: RunPolicyRevision.make(ordinal - 1),
              revision: RunPolicyRevision.make(ordinal),
              version: workflowJournalEventVersion
            })
            records.push({
              event,
              key: describeJournalEvent(event).expectedKey,
              position: JournalPosition.make(records.length + 1),
              runId: fixture.runId
            })
          }
          const cost = yield* Effect.gen(function* () {
            const journal = yield* Journal
            const writer = yield* InRunJournal
            const subjects = activeWorkAuthorityRefreshSubjectsForRunState((yield* journal.state.get).reconstructed)
            const opportunity = activeWorkAuthorityRefreshForOwner("Timer", subjects)
            const recovery = yield* makeRunRecoveryProjection(
              fixture.runId,
              fixture.integrationTarget,
              undefined,
              undefined,
              false,
              false,
              opportunity
            )
            const append = (event: Parameters<typeof writer.append>[2]) =>
              writer.append(fixture.runId, describeJournalEvent(event).expectedKey, event)
            const commandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(2)
            const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
            const report =
              lifecycle === "Safe"
                ? PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })
                : PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
                    correlation,
                    result: { _tag: "Completed" }
                  })
            yield* append(
              PlannedAttemptExecutorCommandIntendedEvent.make({
                command: "Suspend",
                initiatedBy: { _tag: "DalphCoordinator" },
                occurrenceClassification: "InitiatedAction",
                ordinal: commandOrdinal,
                plannedAttempt,
                version: workflowJournalEventVersion
              })
            )
            yield* append(
              PlannedAttemptExecutorCommandResponseObservedEvent.make({
                commandOrdinal,
                occurrenceClassification: "NonActionOccurrence",
                plannedAttempt,
                report,
                version: workflowJournalEventVersion
              })
            )
            yield* append(
              PlannedAttemptExecutorWorkReportedEvent.make({
                ordinal: PlannedAttemptExecutorReportOrdinal.make(2),
                report,
                version: workflowJournalEventVersion
              })
            )
            // New active reads are no longer permitted, but the captured activation
            // still owes its separate post-quiescence graph boundary.
            expect([
              ...activeWorkAuthorityRefreshSubjectsForRunState((yield* journal.state.get).reconstructed)
            ]).toEqual([])
            let visits = 0
            let materializations = 0
            const stop = observeJournalRecordSequenceOperations((operation) => {
              if (operation._tag === "HistoricalMaterialization") materializations += 1
              else visits += 1
            })
            const projection = yield* recovery.readDeliveryProjection.pipe(Effect.ensuring(Effect.sync(stop)))
            expect(projection.activeRefreshBoundary).toEqual({
              _tag: "ActiveRefreshRuntimeBoundary",
              runId: fixture.runId,
              reconciledAttempts: [correlation]
            })
            expect(materializations).toBe(0)
            return visits
          }).pipe(Effect.provide(liveJournalTestLayer({ records, runId: fixture.runId, target: fixture.target })))
          costs.push(cost)
        }
        expect(costs[0]).toBeGreaterThan(0)
        expect(costs[1]).toBe(costs[0])
      })
  )
}
