import { it } from "@effect/vitest"
import { expect } from "vitest"
import { Effect } from "effect"
import { makeTaskWorkSpecification, TaskId, IntegrationTarget, IntegrationTargetRef, RunId } from "@dalph/contracts"
import { projectTrackerSnapshot } from "../../authorities/task-tracker/graph.js"
import { TaskLifecycle, TrackerRevision } from "../../authorities/task-tracker/task.js"
import { taskTrackerTargetKey, type TrackerTarget } from "../../authorities/task-tracker/target.js"
import { makeAcceptedIntegrationHistory } from "../../../test/support/accepted-integration-history.js"
import { integrationFinalityFixture } from "../../workflow/protocols/integration-finality/fixtures.js"
import { liveJournalTestLayer } from "../delivery/live-journal-test-layer.js"
import { InRunJournal, type JournalRecord } from "../../workflow-journal/store.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { observeJournalRecordSequenceOperations } from "../../workflow-journal/record-sequence.js"
import { RunPolicyRevision } from "../../control/policy.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import {
  integrationTargetResourceSnapshotIncludes,
  acquireStartedIntegrationTarget,
  releaseStartedIntegrationTarget,
  makeIntegrationTargetResourceController
} from "../admission/integration-target-resource.js"
import {
  TargetLineageObservedEvent,
  TaskWorkCapacityChangedEvent,
  taskTrackerReadIntent
} from "../../workflow/registry/event.js"
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

const journaledPredecessorOperationIds = (
  records: ReadonlyArray<JournalRecord>,
  target: TrackerTarget
): ReadonlyArray<OperationId> => [
  ...new Set(
    records.flatMap(({ event }) =>
      event._tag === "TaskTrackerReadIntentRecorded" &&
      event.operation._tag === "ReadTrackerGraph" &&
      taskTrackerTargetKey(event.operation.target) === taskTrackerTargetKey(target)
        ? [event.operation.operationId]
        : []
    )
  )
]

for (const initiallyHeld of [true, false]) {
  it.effect(
    `waits for a prerequisite before preparing integration lineage with target initially ${initiallyHeld ? "held" : "released"}`,
    () =>
      Effect.gen(function* () {
        const fixture = integrationFinalityFixture
        const specification = makeTaskWorkSpecification({
          body: "blocked integration",
          title: "Blocked integration",
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
        const prerequisiteId = TaskId.make("integration-prerequisite")
        yield* Effect.gen(function* () {
          const writer = yield* InRunJournal
          const append = (event: Parameters<typeof writer.append>[2]) =>
            writer.append(fixture.runId, describeJournalEvent(event).expectedKey, event)
          const resources = yield* makeIntegrationTargetResourceController()
          const recovery = yield* makeRunRecoveryProjection(fixture.runId, fixture.integrationTarget, resources)
          if (initiallyHeld) {
            yield* resources.acquire(history.responsibility)
            yield* resources.publishAcceptedOwnership(history.responsibility)
          }
          for (const prerequisiteComplete of [false, true]) {
            const projected = projectTrackerSnapshot({
              revision: TrackerRevision.make(prerequisiteComplete ? "prerequisite-complete" : "prerequisite-open"),
              tasks: [
                {
                  id: fixture.taskId,
                  lifecycle: TaskLifecycle.cases.Open.make({}),
                  parentTaskId: null,
                  prerequisiteIds: [prerequisiteId]
                },
                {
                  id: prerequisiteId,
                  lifecycle: prerequisiteComplete
                    ? TaskLifecycle.cases.CompletedSuccessfully.make({})
                    : TaskLifecycle.cases.Open.make({}),
                  parentTaskId: null,
                  prerequisiteIds: []
                }
              ]
            })
            if (projected._tag !== "Valid") return yield* Effect.die("acyclic prerequisite fixture must be valid")
            const graph = makeTrackerGraphObservationOperation(
              { _tag: "WorkflowEstablishment" },
              OperationId.make(prerequisiteComplete ? "cleared-graph" : "blocked-graph"),
              fixture.target
            )
            yield* append(taskTrackerReadIntent(graph))
            yield* append(
              taskTrackerFactsObservedEvent(
                graph.operationId,
                makeCompleteTaskTrackerFactsObserved(graph, projected.snapshot)
              )
            )
            const claim = makeTaskClaimObservationOperation(
              OperationId.make(prerequisiteComplete ? "cleared-claim" : "blocked-claim"),
              fixture.target,
              fixture.taskId,
              [graph.operationId]
            )
            yield* append(taskTrackerReadIntent(claim))
            yield* append(
              taskTrackerFactsObservedEvent(
                claim.operationId,
                makeFocusedTaskClaimFactsObserved(claim, fixture.activeClaim)
              )
            )
            const beforeRelease = yield* recovery.readDeliveryProjection
            if (!prerequisiteComplete) {
              expect(beforeRelease.frontier.explanations).toContainEqual(
                expect.objectContaining({
                  _tag: "IntegrationDependencyWait",
                  plannedAttempt: history.responsibility.plannedAttempt,
                  prerequisiteTaskIds: [prerequisiteId]
                })
              )
              expect(
                beforeRelease.frontier.transitions.some(({ _tag }) => _tag === "ReleaseStartedIntegrationTarget")
              ).toBe(initiallyHeld)
              yield* resources.release(history.responsibility)
              const waiting = yield* recovery.readDeliveryProjection
              expect(
                waiting.frontier.transitions.some(
                  (transition) =>
                    (transition._tag === "ObservePlannedAttemptContinuationGraph" ||
                      transition._tag === "ObservePlannedAttemptContinuationTargetLineage") &&
                    transition.plannedAttempt.attemptId === history.responsibility.plannedAttempt.attemptId
                )
              ).toBe(false)
            } else {
              expect(
                beforeRelease.frontier.transitions.some(({ _tag }) => _tag === "ObservePlannedAttemptContinuationGraph")
              ).toBe(false)
              expect(
                beforeRelease.frontier.transitions.some(
                  ({ _tag }) => _tag === "ObservePlannedAttemptContinuationTargetLineage"
                )
              ).toBe(false)
              expect(
                beforeRelease.frontier.transitions.some(({ _tag }) => _tag === "ReleaseStartedIntegrationTarget")
              ).toBe(false)
              const predecessorOperationIds = [
                ...new Set([
                  ...journaledPredecessorOperationIds(yield* writer.read(fixture.runId), fixture.target),
                  graph.operationId
                ])
              ]
              const ordinaryG2 = makeTrackerGraphObservationOperation(
                { _tag: "PostQuiescenceReconfirmation", quiescentGraphOperationId: graph.operationId },
                OperationId.make("cleared-g2"),
                fixture.target,
                predecessorOperationIds
              )
              yield* append(taskTrackerReadIntent(ordinaryG2))
              yield* append(
                taskTrackerFactsObservedEvent(
                  ordinaryG2.operationId,
                  makeCompleteTaskTrackerFactsObserved(ordinaryG2, projected.snapshot)
                )
              )
              yield* resources.acquire(history.responsibility)
              yield* resources.publishAcceptedOwnership(history.responsibility)
              expect(
                (yield* recovery.readDeliveryProjection).frontier.transitions.some(
                  ({ _tag }) => _tag === "ObservePlannedAttemptContinuationGraph"
                )
              ).toBe(false)
              expect(
                (yield* recovery.readDeliveryProjection).frontier.transitions.some(
                  ({ _tag }) => _tag === "ObservePlannedAttemptContinuationTargetLineage"
                )
              ).toBe(true)
            }
          }
        }).pipe(
          Effect.provide(
            liveJournalTestLayer({ records: history.records, runId: fixture.runId, target: fixture.target })
          )
        )
      })
  )
  it.effect(`rereads the post-claim graph with target initially ${initiallyHeld ? "held" : "released"}`, () =>
    Effect.gen(function* () {
      const costs: Array<number> = []
      for (const count of [64, 256]) {
        const fixture = integrationFinalityFixture
        const projected = projectTrackerSnapshot({
          revision: TrackerRevision.make("integration-current-open"),
          tasks: [
            {
              id: fixture.taskId,
              lifecycle: TaskLifecycle.cases.Open.make({}),
              parentTaskId: null,
              prerequisiteIds: []
            }
          ]
        })
        if (projected._tag !== "Valid") return yield* Effect.die("open current-task fixture must be valid")
        const currentOpenGraph = projected.snapshot
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
              makeCompleteTaskTrackerFactsObserved(graph, currentOpenGraph)
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
          expect(
            projection.frontier.transitions.some(({ _tag }) => _tag === "ObservePlannedAttemptContinuationGraph")
          ).toBe(false)
          expect(
            projection.frontier.transitions.some(
              ({ _tag }) => _tag === "ObservePlannedAttemptContinuationTargetLineage"
            )
          ).toBe(false)
          expect(projection.frontier.transitions.some(({ _tag }) => _tag === "ReleaseStartedIntegrationTarget")).toBe(
            false
          )
          expect(
            integrationTargetResourceSnapshotIncludes(
              (yield* resources.snapshot).heldResponsibilities,
              history.responsibility
            )
          ).toBe(initiallyHeld)
          const predecessorOperationIds = [
            ...new Set([
              ...journaledPredecessorOperationIds(yield* writer.read(fixture.runId), fixture.target),
              graph.operationId
            ])
          ]
          const ordinaryG2 = makeTrackerGraphObservationOperation(
            { _tag: "PostQuiescenceReconfirmation", quiescentGraphOperationId: graph.operationId },
            OperationId.make(`integration-post-quiescence-graph:${count}`),
            fixture.target,
            predecessorOperationIds
          )
          yield* append(taskTrackerReadIntent(ordinaryG2))
          const graphRecord = yield* append(
            taskTrackerFactsObservedEvent(
              ordinaryG2.operationId,
              makeCompleteTaskTrackerFactsObserved(ordinaryG2, currentOpenGraph)
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
          expect(
            integrationTargetResourceSnapshotIncludes(
              (yield* resources.snapshot).heldResponsibilities,
              history.responsibility
            )
          ).toBe(true)
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

for (const initiallyHeld of [true, false]) {
  it.effect(
    initiallyHeld
      ? "does not re-acquire a started integration target while its durable lineage is non-descendant"
      : "reconstructs a non-descendant started integration as a blocked wait without reacquiring the target",
    () =>
      Effect.gen(function* () {
        const fixture = integrationFinalityFixture
        const specification = makeTaskWorkSpecification({
          body: "rewritten target",
          title: "Rewritten target",
          taskId: fixture.taskId
        })
        const history = makeAcceptedIntegrationHistory({
          acceptedResult: fixture.qualifiedCandidate.run.session.acceptedResult,
          activeClaim: fixture.activeClaim,
          integrationTarget: fixture.integrationTarget,
          plannedAttempt: { ...fixture.plannedAttempt, taskRevision: specification.fingerprint },
          taskSpecification: specification,
          runId: fixture.runId,
          targetHeadSha: fixture.qualifiedCandidate.run.session.expectedTargetHead,
          trackerTarget: fixture.target
        })
        const records = history.records.map((record) =>
          record.event._tag === "TargetLineageObserved"
            ? {
                ...record,
                event: TargetLineageObservedEvent.make({
                  ...record.event,
                  observation: { ...record.event.observation, plannedBaseIsAncestorOfTargetHead: false }
                })
              }
            : record
        )
        yield* Effect.gen(function* () {
          const writer = yield* InRunJournal
          const resources = yield* makeIntegrationTargetResourceController()
          const recovery = yield* makeRunRecoveryProjection(fixture.runId, fixture.integrationTarget, resources)
          if (initiallyHeld) {
            yield* resources.acquire(history.responsibility)
            yield* resources.publishAcceptedOwnership(history.responsibility)
          }
          // An independent Run/target shares this production resource controller.
          const independent = {
            ...history.responsibility,
            plannedAttempt: { ...history.plannedAttempt, runId: RunId.make("independent-lineage-run") },
            integrationTarget: IntegrationTarget.make({
              ...fixture.integrationTarget,
              ref: IntegrationTargetRef.make("refs/heads/independent")
            })
          }
          yield* resources.acquire(independent)
          yield* resources.publishAcceptedOwnership(independent)
          const projected = projectTrackerSnapshot({
            revision: TrackerRevision.make("rewrite-current-open"),
            tasks: [
              {
                id: fixture.taskId,
                lifecycle: TaskLifecycle.cases.Open.make({}),
                parentTaskId: null,
                prerequisiteIds: []
              }
            ]
          })
          if (projected._tag !== "Valid") return yield* Effect.die("open graph must be valid")
          const append = (event: Parameters<typeof writer.append>[2]) =>
            writer.append(fixture.runId, describeJournalEvent(event).expectedKey, event)
          const graph = makeTrackerGraphObservationOperation(
            { _tag: "WorkflowEstablishment" },
            OperationId.make("rewrite-current-graph"),
            fixture.target
          )
          yield* append(taskTrackerReadIntent(graph))
          yield* append(
            taskTrackerFactsObservedEvent(
              graph.operationId,
              makeCompleteTaskTrackerFactsObserved(graph, projected.snapshot)
            )
          )
          const claim = makeTaskClaimObservationOperation(
            OperationId.make("rewrite-current-claim"),
            fixture.target,
            fixture.taskId,
            [graph.operationId]
          )
          yield* append(taskTrackerReadIntent(claim))
          yield* append(
            taskTrackerFactsObservedEvent(
              claim.operationId,
              makeFocusedTaskClaimFactsObserved(claim, fixture.activeClaim)
            )
          )
          const prefix = yield* writer.read(fixture.runId)
          let releases = 0
          let acquires = 0
          let integratorCalls = 0
          for (let projectionNumber = 0; projectionNumber < 5; projectionNumber += 1) {
            const projection = yield* recovery.readDeliveryProjection
            for (const transition of projection.frontier.transitions) {
              if (transition._tag === "ReleaseStartedIntegrationTarget") {
                releases += 1
                yield* releaseStartedIntegrationTarget(resources, transition)
              }
              if (transition._tag === "AcquireStartedIntegrationTarget") {
                acquires += 1
                yield* acquireStartedIntegrationTarget(resources, transition)
              }
              if (transition._tag === "RunIntegrator") integratorCalls += 1
            }
            expect(yield* resources.isHeld(independent)).toBe(true)
            let independentCalls = 0
            yield* resources.withPermit(
              independent,
              Effect.sync(() => {
                independentCalls += 1
              })
            )
            expect(independentCalls).toBe(1)
          }
          expect(releases).toBe(initiallyHeld ? 1 : 0)
          expect(acquires).toBe(0)
          expect(integratorCalls).toBe(0)
          expect(yield* resources.isHeld(history.responsibility)).toBe(false)
          expect(yield* writer.read(fixture.runId)).toEqual(prefix)
        }).pipe(Effect.provide(liveJournalTestLayer({ records, runId: fixture.runId, target: fixture.target })))
      })
  )
}
