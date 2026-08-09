import { it } from "@effect/vitest"
import {
  AttemptId,
  GitCommitSha,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { Cause, Deferred, Effect, Fiber, Option, Ref, Stream } from "effect"
import { expect } from "vitest"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import { ActiveTaskClaim } from "../../authorities/task-tracker/claim-mutation.js"
import { projectTrackerSnapshot } from "../../authorities/task-tracker/graph.js"
import { InitialControlPolicy } from "../../control/policy.js"
import { TrackerRevision } from "../../authorities/task-tracker/task.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import { OperationId } from "../../workflow/identity.js"
import { taskTrackerReadIntent } from "../../workflow/registry/event.js"
import {
  makeTaskClaimReleaseOperation,
  makeTrackerGraphObservationOperation
} from "../../workflow/registry/operation.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../workflow/task-tracker-facts/observation.js"
import { makeTaskTrackerFactsObservedFromRead } from "../../workflow/protocols/task-tracker-read/protocol.js"
import { memoryJournalStoreLayer } from "../../workflow-journal/adapters/memory-store.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import {
  controlDirectionAppliedRecordKey,
  intentRecordKey,
  outcomeRecordKey
} from "../../workflow-journal/record-key.js"
import { JournalHistoryInvalid, JournalStore } from "../../workflow-journal/store.js"
import {
  ControlDirectionApplicationOrdinal,
  ControlDirectionAppliedEvent
} from "../../workflow/protocols/control-direction-application/events.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { makeIntegrationTargetResourceController } from "../admission/integration-target-resource.js"
import { RunnableFrontierTransition } from "../frontier/frontier.js"
import { reduceWorkflowJournalHistory } from "../reconstruction/history.js"
import type { InvalidWorkflowJournalHistory } from "../reconstruction/history-result.js"
import { type JournalState, makeJournal } from "./journal.js"
import { delivery } from "./delivery.js"
import { DeliveryAcceptedFactPublication } from "./delivery-accepted-fact-publication.js"
import {
  DeliveryRelationPublicationObserver,
  evaluateDeliveryRelationInputBundle
} from "./delivery-publication-observer.js"
import { deliveryRuntime } from "./delivery-runtime-adapter.js"
import {
  DeliveryControlPolicyMissing,
  makeReactiveDeliveryRelationsLayer as makeProductionReactiveDeliveryRelationsLayer
} from "./reactive-delivery-relations.js"
import { DeliveryRelationReconciliationError } from "./relations.js"
import type { DeliveryRelationInputBundle } from "./relations.js"

const runId = RunId.make("reactive-delivery-coherent-reconstruction")
const target = FixtureTarget.make("reactive-delivery-coherent-reconstruction-target")
const policy = InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
const recoveredAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("reactive-delivery-recovered-attempt"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/reactive-delivery-recovered"),
  executor: TaskExecutorLocator.make("executor:reactive-delivery-test"),
  runId,
  taskId: TaskId.make("recovered-task"),
  taskRevision: TaskRevision.make("reactive-delivery-recovered-revision"),
  worktree: WorktreeLocator.make("/worktrees/reactive-delivery-recovered")
})

const makeJournalService = Effect.gen(function* () {
  const storage = yield* JournalStore
  yield* storage.beginRun(runId, target, policy)
  const initial = reduceWorkflowJournalHistory(runId, yield* storage.read(runId))
  if (initial._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(initial)
  return yield* makeJournal(runId, target, initial, storage)
})

const currentProjection = (stateGet: Effect.Effect<JournalState>) => ({
  readDeliveryProjection: stateGet.pipe(
    Effect.map((journalState) => ({
      evidence: {
        _tag: "AvailableDeliveryProjectionEvidence" as const,
        acceptedAt: journalState.position,
        facts: [],
        integrationWaits: []
      },
      frontier: { explanations: [], transitions: [] }
    }))
  ),
  reconstructedPlannedAttemptPositions: []
})

const unavailableProjection = {
  readDeliveryProjection: Effect.succeed({
    evidence: { _tag: "UnavailableDeliveryProjectionEvidence" as const },
    frontier: { explanations: [], transitions: [] }
  }),
  reconstructedPlannedAttemptPositions: []
}

const makeReactiveDeliveryRelationsLayer = (
  runId: Parameters<typeof makeProductionReactiveDeliveryRelationsLayer>[0],
  target: Parameters<typeof makeProductionReactiveDeliveryRelationsLayer>[1],
  journal: Parameters<typeof makeProductionReactiveDeliveryRelationsLayer>[2],
  recovery: Parameters<typeof makeProductionReactiveDeliveryRelationsLayer>[3]
) =>
  Effect.gen(function* () {
    const integrationTargets = yield* makeIntegrationTargetResourceController()
    return yield* makeProductionReactiveDeliveryRelationsLayer(runId, target, journal, recovery, integrationTargets)
  })

it.effect("records the initial and later exact production bundles without changing their delivery source chain", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const journal = yield* makeJournalService
      const observed = yield* Ref.make<ReadonlyArray<DeliveryRelationInputBundle>>([])
      const establishedSeen = yield* Deferred.make<void>()
      const observer = DeliveryRelationPublicationObserver.of({
        observe: (bundle) =>
          Ref.update(observed, (bundles) => [...bundles, bundle]).pipe(
            Effect.andThen(
              bundle.publication.graph._tag === "GraphEstablished"
                ? Deferred.succeed(establishedSeen, undefined)
                : Effect.void
            )
          )
      })
      const layer = yield* makeReactiveDeliveryRelationsLayer(
        runId,
        target,
        journal,
        currentProjection(journal.state.get.pipe(Effect.orDie))
      ).pipe(Effect.provideService(DeliveryRelationPublicationObserver, observer))
      const operation = makeTrackerGraphObservationOperation(OperationId.make("observed-production-bundle"), target)
      const projected = projectTrackerSnapshot({
        revision: "observed-production-revision",
        tasks: [{ id: TaskId.make("A"), lifecycle: { _tag: "Open" as const }, parentTaskId: null, prerequisiteIds: [] }]
      })
      if (projected._tag === "Invalid") return yield* Effect.die(projected)

      yield* journal.append(runId, intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
      yield* journal.append(
        runId,
        outcomeRecordKey(operation.operationId),
        taskTrackerFactsObservedEvent(
          operation.operationId,
          makeCompleteTaskTrackerFactsObserved(operation, projected.snapshot)
        )
      )
      yield* Deferred.await(establishedSeen)

      const bundles = yield* Ref.get(observed)
      expect(bundles[0]?.publication.graph._tag).toBe("GraphNotEstablished")
      const established = bundles.find(({ publication }) => publication.graph._tag === "GraphEstablished")
      if (established === undefined) return expect.fail("expected established production bundle")
      const consequences = yield* evaluateDeliveryRelationInputBundle(established)
      expect(consequences.graph).toBe(established.publication.graph)
      expect(consequences.frontier.source).toBe(consequences.graph)
      expect(consequences.tickets.source).toBe(consequences.frontier)
      expect(consequences.ticketDeliveries.source).toBe(consequences.tickets)
      expect(consequences.settlements.source).toBe(consequences.ticketDeliveries)
      expect(consequences.trackerConsequences.source).toBe(consequences.settlements)
      const current = yield* delivery.pipe(
        Effect.provide(layer),
        Effect.flatMap((signal) => signal.get)
      )
      expect(current.graph._tag).toBe("GraphEstablished")
    }).pipe(Effect.provide(memoryJournalStoreLayer))
  )
)

it.effect("publishes journaled G1 and equal-content G2 through one reactive delivery", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const journal = yield* makeJournalService
      const layer = yield* makeReactiveDeliveryRelationsLayer(
        runId,
        target,
        journal,
        currentProjection(journal.state.get.pipe(Effect.orDie))
      )
      const signal = yield* delivery.pipe(Effect.provide(layer))
      const current = yield* signal.get
      expect(current.graph._tag).toBe("GraphNotEstablished")
      const firstDeliverySeen = yield* Deferred.make<void>()
      const first = makeTrackerGraphObservationOperation(OperationId.make("integrated-G1"), target)
      const second = makeTrackerGraphObservationOperation(OperationId.make("integrated-G2"), target)
      const observed = yield* signal.changes.pipe(
        Stream.tap((value) =>
          value.graph._tag === "GraphEstablished" && value.graph.observation.operationId === first.operationId
            ? Deferred.succeed(firstDeliverySeen, undefined)
            : Effect.void
        ),
        Stream.filter(({ graph }) => graph._tag === "GraphEstablished"),
        Stream.take(2),
        Stream.runCollect,
        Effect.forkChild
      )
      const projected = projectTrackerSnapshot({
        revision: "integrated-equal-content",
        tasks: [{ id: TaskId.make("A"), lifecycle: { _tag: "Open" as const }, parentTaskId: null, prerequisiteIds: [] }]
      })
      if (projected._tag === "Invalid") return yield* Effect.die(projected)

      yield* journal.append(runId, intentRecordKey(first.operationId), taskTrackerReadIntent(first))
      yield* journal.append(
        runId,
        outcomeRecordKey(first.operationId),
        taskTrackerFactsObservedEvent(
          first.operationId,
          makeCompleteTaskTrackerFactsObserved(first, projected.snapshot)
        )
      )
      yield* Deferred.await(firstDeliverySeen)
      yield* journal.append(runId, intentRecordKey(second.operationId), taskTrackerReadIntent(second))
      const records = yield* journal.read(runId)
      yield* journal.append(
        runId,
        outcomeRecordKey(second.operationId),
        makeTaskTrackerFactsObservedFromRead(
          records.map(({ event }) => ({ event })),
          second,
          projected.snapshot
        )
      )

      const values = Array.from(yield* Fiber.join(observed))
      expect(values).toHaveLength(2)
      expect(
        values.map((value) => (value.graph._tag === "GraphEstablished" ? value.graph.observation.operationId : null))
      ).toEqual([first.operationId, second.operationId])
      expect(
        values.map((value) => (value.graph._tag === "GraphEstablished" ? value.graph.observation.recordedAt : null))
      ).toEqual([JournalPosition.make(3), JournalPosition.make(5)])
      expect(
        values.map((value) =>
          value.graph._tag === "GraphEstablished" ? value.graph.observation.contentIdentity : null
        )
      ).toEqual([TrackerRevision.make("integrated-equal-content"), TrackerRevision.make("integrated-equal-content")])
    }).pipe(Effect.provide(memoryJournalStoreLayer))
  )
)

it.effect("waits for the accepted journal position to reach delivery planning before returning", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const journal = yield* makeJournalService
      const projectionBlocked = yield* Deferred.make<void>()
      const refreshStarted = yield* Deferred.make<void>()
      const projectionReads = yield* Ref.make(0)
      const baseProjection = currentProjection(journal.state.get.pipe(Effect.orDie))
      const recovery = {
        ...baseProjection,
        readDeliveryProjection: Ref.getAndUpdate(projectionReads, (count) => count + 1).pipe(
          Effect.flatMap((read) =>
            read === 0
              ? baseProjection.readDeliveryProjection
              : Deferred.succeed(refreshStarted, undefined).pipe(
                  Effect.andThen(Deferred.await(projectionBlocked)),
                  Effect.andThen(baseProjection.readDeliveryProjection)
                )
          )
        )
      }
      const layer = yield* makeReactiveDeliveryRelationsLayer(runId, target, journal, recovery)
      const publication = yield* DeliveryAcceptedFactPublication.pipe(Effect.provide(layer))
      const operation = makeTrackerGraphObservationOperation(OperationId.make("publication-handshake"), target)

      yield* journal.append(runId, intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
      yield* Deferred.await(refreshStarted)
      const waiting = yield* publication.awaitCurrent.pipe(Effect.forkChild)
      yield* Effect.yieldNow
      expect(waiting.pollUnsafe()).toBeUndefined()
      yield* Deferred.succeed(projectionBlocked, undefined)
      yield* Fiber.join(waiting)
    }).pipe(Effect.provide(memoryJournalStoreLayer))
  )
)

it.effect("keeps a recovered paused Run passive before its first current graph", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const journal = yield* makeJournalService
      const ordinal = ControlDirectionApplicationOrdinal.make(1)
      yield* journal.append(
        runId,
        controlDirectionAppliedRecordKey(ordinal),
        ControlDirectionAppliedEvent.make({
          direction: "Pause",
          initiatedBy: { _tag: "Operator" },
          occurrenceClassification: "InitiatedAction",
          ordinal,
          subject: { _tag: "Run", runId },
          version: workflowJournalEventVersion
        })
      )
      const layer = yield* makeReactiveDeliveryRelationsLayer(
        runId,
        target,
        journal,
        currentProjection(journal.state.get.pipe(Effect.orDie))
      )
      const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))
      const evaluation = Option.getOrThrow(yield* relation.changes.pipe(Stream.runHead))

      expect(evaluation.current.trackerGraph._tag).toBe("GraphNotEstablished")
      expect(evaluation.proposedActions).toEqual({
        _tag: "DeliveryProposalsAvailable",
        isolatedIssues: [],
        proposals: []
      })
      expect(evaluation.quiescence).toEqual({ _tag: "QuiescencePassive", reason: "RunPaused" })
    }).pipe(Effect.provide(memoryJournalStoreLayer))
  )
)

it.effect("retries reconstruction when a journal append lands during recovery projection", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const journal = yield* makeJournalService
      const journalReads = yield* Ref.make(0)
      const countedJournal = {
        ...journal,
        state: {
          ...journal.state,
          get: Ref.update(journalReads, (count) => count + 1).pipe(Effect.andThen(journal.state.get))
        }
      }
      const journalBefore = yield* journal.state.get
      const firstProjectionRead = yield* Deferred.make<void>()
      const permitFirstProjection = yield* Deferred.make<void>()
      const projectionReads = yield* Ref.make(0)
      const recovery = {
        readDeliveryProjection: Effect.gen(function* () {
          const readNumber = yield* Ref.updateAndGet(projectionReads, (count) => count + 1)
          const journalState = yield* journal.state.get
          if (readNumber === 1) {
            yield* Deferred.succeed(firstProjectionRead, undefined)
            yield* Deferred.await(permitFirstProjection)
          }
          return {
            evidence: {
              _tag: "AvailableDeliveryProjectionEvidence" as const,
              acceptedAt: journalState.position,
              facts: [],
              integrationWaits: []
            },
            frontier: { explanations: [], transitions: [] }
          }
        }),
        reconstructedPlannedAttemptPositions: []
      }
      const layerFiber = yield* makeReactiveDeliveryRelationsLayer(runId, target, countedJournal, recovery).pipe(
        Effect.forkChild
      )

      yield* Deferred.await(firstProjectionRead)
      const operation = makeTrackerGraphObservationOperation(OperationId.make("coherent-race-read"), target)
      yield* journal.append(runId, intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
      const projected = projectTrackerSnapshot({ revision: "coherent-race", tasks: [] })
      if (projected._tag === "Invalid") return yield* Effect.die(new Error("race graph must be valid"))
      const journalOutcome = yield* journal.append(
        runId,
        outcomeRecordKey(operation.operationId),
        taskTrackerFactsObservedEvent(
          operation.operationId,
          makeCompleteTaskTrackerFactsObserved(operation, projected.snapshot)
        )
      )
      yield* Deferred.succeed(permitFirstProjection, undefined)

      const layer = yield* Fiber.join(layerFiber)
      const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))
      const evaluation = Option.getOrThrow(yield* relation.changes.pipe(Stream.runHead))

      expect(journalOutcome.position).toBeGreaterThan(journalBefore.position)
      expect(evaluation.acceptedAt).toBe(journalOutcome.position)
      expect(evaluation.current.trackerGraph._tag).toBe("GraphEstablished")
      expect(yield* Ref.get(journalReads)).toBe(4)
      expect(yield* Ref.get(projectionReads)).toBe(2)
    }).pipe(Effect.provide(memoryJournalStoreLayer))
  )
)

it.effect("does not propose the initial graph read while recovered boundary work remains", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const journal = yield* makeJournalService
      const recoveredTransitions = yield* Ref.make<ReadonlyArray<RunnableFrontierTransition>>([
        RunnableFrontierTransition.SuspendPlannedAttemptExecutorWork({ plannedAttempt: recoveredAttempt })
      ])
      const recovery = {
        readDeliveryProjection: Effect.all({
          journalState: journal.state.get,
          transitions: Ref.get(recoveredTransitions)
        }).pipe(
          Effect.map(({ journalState, transitions }) => ({
            evidence: {
              _tag: "AvailableDeliveryProjectionEvidence" as const,
              acceptedAt: journalState.position,
              facts: [],
              integrationWaits: []
            },
            frontier: { explanations: [], transitions }
          }))
        ),
        reconstructedPlannedAttemptPositions: [
          { attemptId: recoveredAttempt.attemptId, runId, taskId: recoveredAttempt.taskId }
        ]
      }
      const layer = yield* makeReactiveDeliveryRelationsLayer(runId, target, journal, recovery)
      const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))
      const initial = Option.getOrThrow(yield* relation.changes.pipe(Stream.runHead))
      expect(initial.proposedActions).toMatchObject({
        _tag: "DeliveryProposalsAvailable",
        proposals: [
          { route: { _tag: "IdentityFreeWorkflowRoute", transition: { _tag: "SuspendPlannedAttemptExecutorWork" } } }
        ]
      })
    }).pipe(Effect.provide(memoryJournalStoreLayer))
  )
)

it.effect("establishes the current graph before proposing an external-success claim release", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const journal = yield* makeJournalService
      const claimOperationId = OperationId.make("stale-external-success-claim")
      const claim = ActiveTaskClaim.make({
        operationId: claimOperationId,
        owner: ClaimOwner.make("dalph"),
        taskId: recoveredAttempt.taskId,
        token: ClaimToken.make("stale-external-success-token")
      })
      const release = makeTaskClaimReleaseOperation({
        predecessorOperationIds: [claimOperationId],
        release: { claim, operationId: OperationId.make("stale-external-success-release-placeholder") }
      })
      const recovery = {
        readDeliveryProjection: journal.state.get.pipe(
          Effect.map((journalState) => ({
            evidence: {
              _tag: "AvailableDeliveryProjectionEvidence" as const,
              acceptedAt: journalState.position,
              facts: [],
              integrationWaits: []
            },
            frontier: {
              explanations: [],
              transitions: [
                RunnableFrontierTransition.ReleaseExternallyCompletedTaskClaim({
                  operation: release,
                  plannedAttempt: recoveredAttempt
                })
              ]
            }
          }))
        ),
        reconstructedPlannedAttemptPositions: [
          { attemptId: recoveredAttempt.attemptId, runId, taskId: recoveredAttempt.taskId }
        ]
      }
      const layer = yield* makeReactiveDeliveryRelationsLayer(runId, target, journal, recovery)
      const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))
      const initial = Option.getOrThrow(yield* relation.changes.pipe(Stream.runHead))

      expect(initial.current.trackerGraph._tag).toBe("GraphNotEstablished")
      expect(initial.proposedActions).toMatchObject({
        _tag: "DeliveryProposalsAvailable",
        proposals: [{ route: { _tag: "TrackerGraphReadRoute", purpose: "EstablishCurrentGraph" } }]
      })
    }).pipe(Effect.provide(memoryJournalStoreLayer))
  )
)

it.effect("fails initial reconciliation with the exact missing-policy error", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const journal = yield* makeJournalService
      const journalState = yield* journal.state.get
      const missingPolicy = {
        ...journalState,
        reconstructed: { ...journalState.reconstructed, controlPolicy: Option.none() }
      }
      const missingPolicyJournal = { ...journal, state: { ...journal.state, get: Effect.succeed(missingPolicy) } }

      const failure = yield* makeReactiveDeliveryRelationsLayer(
        runId,
        target,
        missingPolicyJournal,
        currentProjection(Effect.succeed(missingPolicy))
      ).pipe(Effect.flip)

      expect(failure).toBeInstanceOf(DeliveryControlPolicyMissing)
    }).pipe(Effect.provide(memoryJournalStoreLayer))
  )
)

it.effect("publishes a typed relation failure when a later recovery projection fails", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const journal = yield* makeJournalService
      const failProjection = yield* Ref.make(false)
      const recoveryFailure: InvalidWorkflowJournalHistory = {
        _tag: "InvalidWorkflowJournalHistory",
        issues: [],
        records: [],
        runId
      }
      const recovery = {
        ...currentProjection(journal.state.get.pipe(Effect.orDie)),
        readDeliveryProjection: Ref.get(failProjection).pipe(
          Effect.flatMap((failed) =>
            failed
              ? Effect.fail(recoveryFailure)
              : currentProjection(journal.state.get.pipe(Effect.orDie)).readDeliveryProjection
          )
        )
      }
      const layer = yield* makeReactiveDeliveryRelationsLayer(runId, target, journal, recovery)
      const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))
      const publication = yield* DeliveryAcceptedFactPublication.pipe(Effect.provide(layer))

      yield* Ref.set(failProjection, true)
      const failed = yield* relation.changes.pipe(Stream.drop(1), Stream.runHead, Effect.flip, Effect.forkChild)
      const trigger = makeTrackerGraphObservationOperation(OperationId.make("projection-failure-trigger"), target)
      yield* journal.append(runId, intentRecordKey(trigger.operationId), taskTrackerReadIntent(trigger))
      const failure = yield* Fiber.join(failed)
      const currentFailure = yield* relation.get.pipe(Effect.flip)
      const publicationFailure = yield* publication.awaitCurrent.pipe(Effect.flip)

      expect(failure).toBeInstanceOf(DeliveryRelationReconciliationError)
      expect(currentFailure).toEqual(failure)
      expect(publicationFailure).toEqual(failure)
      if (!(failure instanceof DeliveryRelationReconciliationError)) return expect.fail("expected relation failure")
      expect(Cause.squash(failure.cause)).toEqual(recoveryFailure)
    }).pipe(Effect.provide(memoryJournalStoreLayer))
  )
)

it.effect("derives safely when recovery evidence is unavailable before and after graph establishment", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const journal = yield* makeJournalService
      const initialLayer = yield* makeReactiveDeliveryRelationsLayer(runId, target, journal, unavailableProjection)
      const initialRelation = yield* deliveryRuntime.pipe(Effect.provide(initialLayer))
      const initial = Option.getOrThrow(yield* initialRelation.changes.pipe(Stream.runHead))
      expect(initial.current.trackerGraph._tag).toBe("GraphNotEstablished")

      const operation = makeTrackerGraphObservationOperation(OperationId.make("unavailable-evidence-graph"), target)
      yield* journal.append(runId, intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
      const projected = projectTrackerSnapshot({ revision: "unavailable-evidence", tasks: [] })
      if (projected._tag === "Invalid") return yield* Effect.die("unavailable-evidence graph must be valid")
      yield* journal.append(
        runId,
        outcomeRecordKey(operation.operationId),
        taskTrackerFactsObservedEvent(
          operation.operationId,
          makeCompleteTaskTrackerFactsObserved(operation, projected.snapshot)
        )
      )

      const establishedLayer = yield* makeReactiveDeliveryRelationsLayer(runId, target, journal, unavailableProjection)
      const establishedRelation = yield* deliveryRuntime.pipe(Effect.provide(establishedLayer))
      const established = Option.getOrThrow(yield* establishedRelation.changes.pipe(Stream.runHead))
      expect(established.current.trackerGraph._tag).toBe("GraphEstablished")
    }).pipe(Effect.provide(memoryJournalStoreLayer))
  )
)

it.effect("publishes a typed failure when journal-triggered reconciliation cannot read journal state", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const journal = yield* makeJournalService
      const journalState = yield* journal.state.get
      const failRead = yield* Ref.make(false)
      const journalFailure = new JournalHistoryInvalid({
        position: journalState.position,
        detail: "probe read failed",
        runId
      })
      const failingJournal = {
        ...journal,
        state: {
          ...journal.state,
          get: Ref.get(failRead).pipe(
            Effect.flatMap((failed) => (failed ? Effect.fail(journalFailure) : journal.state.get))
          )
        }
      }
      const layer = yield* makeReactiveDeliveryRelationsLayer(
        runId,
        target,
        failingJournal,
        currentProjection(journal.state.get.pipe(Effect.orDie))
      )
      const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))
      const publication = yield* DeliveryAcceptedFactPublication.pipe(Effect.provide(layer))
      yield* Ref.set(failRead, true)
      const publicationFailure = yield* publication.awaitCurrent.pipe(Effect.flip)
      const failed = yield* relation.changes.pipe(Stream.drop(1), Stream.runHead, Effect.flip, Effect.forkChild)
      const trigger = makeTrackerGraphObservationOperation(OperationId.make("journal-read-failure-trigger"), target)
      yield* journal.append(runId, intentRecordKey(trigger.operationId), taskTrackerReadIntent(trigger))
      const failure = yield* Fiber.join(failed)

      expect(failure).toBeInstanceOf(DeliveryRelationReconciliationError)
      expect(publicationFailure).toBeInstanceOf(DeliveryRelationReconciliationError)
      if (!(publicationFailure instanceof DeliveryRelationReconciliationError)) {
        return expect.fail("expected publication failure")
      }
      expect(Cause.squash(publicationFailure.cause)).toEqual(journalFailure)
      if (!(failure instanceof DeliveryRelationReconciliationError)) return expect.fail("expected relation failure")
      expect(Cause.squash(failure.cause)).toEqual(journalFailure)
    }).pipe(Effect.provide(memoryJournalStoreLayer))
  )
)

it.effect("publishes a typed failure when the journal signal closes with failure", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const journal = yield* makeJournalService
      const journalState = yield* journal.state.get
      const journalFailure = new JournalHistoryInvalid({
        position: journalState.position,
        detail: "journal signal failed",
        runId
      })
      const failingJournal = {
        ...journal,
        state: {
          ...journal.state,
          changes: Stream.succeed(journalState).pipe(Stream.concat(Stream.fail(journalFailure)))
        }
      }
      const layer = yield* makeReactiveDeliveryRelationsLayer(
        runId,
        target,
        failingJournal,
        currentProjection(journal.state.get.pipe(Effect.orDie))
      )
      const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))
      const failure = yield* relation.changes.pipe(
        Stream.dropWhile(({ current }) => current.trackerGraph._tag === "GraphNotEstablished"),
        Stream.runHead,
        Effect.flip
      )

      expect(failure).toBeInstanceOf(DeliveryRelationReconciliationError)
      if (!(failure instanceof DeliveryRelationReconciliationError)) return expect.fail("expected relation failure")
      expect(Cause.squash(failure.cause)).toEqual(journalFailure)
    }).pipe(Effect.provide(memoryJournalStoreLayer))
  )
)
