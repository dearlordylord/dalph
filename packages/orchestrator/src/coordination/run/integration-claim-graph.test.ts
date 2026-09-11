import { it } from "@effect/vitest"
import { expect } from "vitest"
import { Effect } from "effect"
import { makeTaskWorkSpecification } from "@dalph/contracts"
import { makeAcceptedIntegrationHistory } from "../../../test/support/accepted-integration-history.js"
import { integrationFinalityFixture } from "../../workflow/protocols/integration-finality/fixtures.js"
import { liveJournalTestLayer } from "../delivery/live-journal-test-layer.js"
import { InRunJournal, type JournalRecord } from "../../workflow-journal/store.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { observeJournalRecordSequenceOperations } from "../../workflow-journal/record-sequence.js"
import { RunPolicyRevision } from "../../control/policy.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { makeIntegrationTargetResourceController } from "../admission/integration-target-resource.js"
import { TaskWorkCapacityChangedEvent, taskTrackerReadIntent } from "../../workflow/registry/event.js"
import { describeJournalEvent } from "../../workflow/registry/event-descriptor.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import {
  makeTrackerGraphObservationOperation,
  makeTaskClaimObservationOperation
} from "../../workflow/registry/operation.js"
import { OperationId } from "../../workflow/identity.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  makeFocusedTaskClaimFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../workflow/task-tracker-facts/observation.js"
import { makeRunRecoveryProjection } from "./recovery-activation.js"

for (const initiallyHeld of [true, false]) {
  it.effect(`rereads the post-claim graph with target initially ${initiallyHeld ? "held" : "released"}`, () =>
    Effect.gen(function* () {
      const costs: Array<number> = []
      for (const count of [64, 256]) {
        const fixture = integrationFinalityFixture
        const specification = makeTaskWorkSpecification({
          body: "integration graph",
          title: "Integration graph",
          taskId: fixture.taskId
        })
        const history = makeAcceptedIntegrationHistory({
          acceptedResult: fixture.qualifiedCandidate.run.session.acceptedResult,
          activeClaim: fixture.activeClaim,
          integrationTarget: fixture.integrationTarget,
          plannedAttempt: { ...fixture.plannedAttempt, taskRevision: specification.fingerprint },
          runId: fixture.runId,
          targetHeadSha: fixture.qualifiedCandidate.run.session.expectedTargetHead,
          taskSpecification: specification,
          trackerTarget: fixture.target
        })
        const records: Array<JournalRecord> = [...history.records]
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
          const writer = yield* InRunJournal
          const append = (event: Parameters<typeof writer.append>[2]) =>
            writer.append(fixture.runId, describeJournalEvent(event).expectedKey, event)
          const resources = yield* makeIntegrationTargetResourceController()
          const recovery = yield* makeRunRecoveryProjection(fixture.runId, fixture.integrationTarget, resources)
          if (initiallyHeld) {
            yield* resources.acquire(history.responsibility)
            yield* resources.publishAcceptedOwnership(history.responsibility)
          }
          const graph = makeTrackerGraphObservationOperation(
            { _tag: "WorkflowEstablishment" },
            OperationId.make("integration-current-graph"),
            fixture.target
          )
          yield* append(taskTrackerReadIntent(graph))
          yield* append(
            taskTrackerFactsObservedEvent(
              graph.operationId,
              makeCompleteTaskTrackerFactsObserved(graph, fixture.graphSnapshot)
            )
          )
          expect(
            (yield* recovery.readDeliveryProjection).frontier.transitions.some(
              (transition) =>
                transition._tag === "ObservePlannedAttemptContinuationGraph" &&
                transition.operation.operationId.startsWith("integration-candidate:")
            )
          ).toBe(false)
          const claim = makeTaskClaimObservationOperation(
            OperationId.make("integration-current-claim"),
            fixture.target,
            fixture.taskId,
            [graph.operationId]
          )
          yield* append(taskTrackerReadIntent(claim))
          const claimRecord = yield* append(
            taskTrackerFactsObservedEvent(
              claim.operationId,
              makeFocusedTaskClaimFactsObserved(claim, fixture.activeClaim)
            )
          )
          let visits = 0
          let materializations = 0
          const stop = observeJournalRecordSequenceOperations((operation) => {
            if (operation._tag === "IndexedRecordVisit") visits += 1
            if (operation._tag === "HistoricalMaterialization") materializations += 1
          })
          const projection = yield* recovery.readDeliveryProjection.pipe(Effect.ensuring(Effect.sync(stop)))
          const selected = projection.frontier.transitions.find(
            ({ _tag }) => _tag === "ObservePlannedAttemptContinuationGraph"
          )
          if (selected?._tag !== "ObservePlannedAttemptContinuationGraph")
            return yield* Effect.die("held integration requires graph after its claim check")
          expect(selected.operation.predecessorOperationIds).toContain(claim.operationId)
          expect((yield* resources.snapshot).heldResponsibilityPositions.has(history.responsibility.queuedAt)).toBe(
            initiallyHeld
          )
          expect(
            projection.frontier.transitions.some(
              ({ _tag }) =>
                _tag === "ObservePlannedAttemptContinuationTargetLineage" || _tag === "ReleaseStartedIntegrationTarget"
            )
          ).toBe(false)
          yield* append(taskTrackerReadIntent(selected.operation))
          const graphRecord = yield* append(
            taskTrackerFactsObservedEvent(
              selected.operation.operationId,
              makeCompleteTaskTrackerFactsObserved(selected.operation, fixture.graphSnapshot)
            )
          )
          expect(graphRecord.position).toBeGreaterThan(claimRecord.position)
          if (!initiallyHeld) {
            expect(
              (yield* recovery.readDeliveryProjection).frontier.transitions.some(
                ({ _tag }) => _tag === "ObservePlannedAttemptContinuationTargetLineage"
              )
            ).toBe(false)
            yield* resources.acquire(history.responsibility)
            yield* resources.publishAcceptedOwnership(history.responsibility)
          }
          const next = (yield* recovery.readDeliveryProjection).frontier.transitions
          expect(next.some(({ _tag }) => _tag === "ObservePlannedAttemptContinuationGraph")).toBe(false)
          expect(next.some(({ _tag }) => _tag === "ObservePlannedAttemptContinuationTargetLineage")).toBe(true)
          expect((yield* resources.snapshot).heldResponsibilityPositions.has(history.responsibility.queuedAt)).toBe(
            true
          )
          expect(materializations).toBe(0)
          return visits
        }).pipe(Effect.provide(liveJournalTestLayer({ records, runId: fixture.runId, target: fixture.target })))
        costs.push(cost)
      }
      expect(costs[0]).toBeGreaterThan(0)
      expect(costs[0]).toBe(costs[1])
    })
  )
}
