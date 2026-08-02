import { it } from "@effect/vitest"
import { RunId, TaskId } from "@dalph/contracts"
import { Cause, Deferred, Effect, Fiber, Option, Ref, Stream } from "effect"
import { expect } from "vitest"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { projectTrackerSnapshot } from "../../authorities/task-tracker/graph.js"
import { InitialControlPolicy } from "../../control/policy.js"
import { OperationId } from "../../workflow/identity.js"
import { taskTrackerReadIntent } from "../../workflow/registry/event.js"
import { makeTrackerGraphObservationOperation } from "../../workflow/registry/operation.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../workflow/task-tracker-facts/observation.js"
import { memoryJournalStoreLayer } from "../../workflow-journal/adapters/memory-store.js"
import { intentRecordKey, outcomeRecordKey } from "../../workflow-journal/record-key.js"
import { AcceptedJournalHistoryInvalid, JournalStore } from "../../workflow-journal/store.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { reduceWorkflowJournalHistory } from "../reconstruction/history.js"
import { TaskClaimReacquisitionPlannerUnavailable } from "../run/recovery-activation.js"
import { type AcceptedFactPublicationState, makeAcceptedFactPublicationGateway } from "./accepted-fact-gateway.js"
import { delivery } from "./delivery.js"
import { DeliveryControlPolicyMissing, makeReactiveDeliveryRelationsLayer } from "./reactive-delivery-relations.js"
import { DeliveryRelationReconciliationError } from "./relations.js"

const runId = RunId.make("reactive-delivery-coherent-reconstruction")
const target = FixtureTarget.make("reactive-delivery-coherent-reconstruction-target")
const policy = InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })

const makeGateway = Effect.gen(function* () {
  const storage = yield* JournalStore
  yield* storage.beginRun(runId, target, policy)
  const initial = reduceWorkflowJournalHistory(runId, yield* storage.read(runId))
  if (initial._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(initial)
  return yield* makeAcceptedFactPublicationGateway(runId, target, initial, storage)
})

const currentProjection = (readCurrent: Effect.Effect<AcceptedFactPublicationState>) => ({
  readDeliveryProjection: readCurrent.pipe(
    Effect.map((accepted) => ({
      evidence: {
        _tag: "AvailableDeliveryProjectionEvidence" as const,
        acceptedAt: accepted.appliedPosition,
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

it.effect("retries reconstruction when an accepted append lands during recovery projection", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const gateway = yield* makeGateway
      const acceptedReads = yield* Ref.make(0)
      const countedGateway = {
        ...gateway,
        readCurrent: Ref.update(acceptedReads, (count) => count + 1).pipe(Effect.andThen(gateway.readCurrent))
      }
      const acceptedBefore = yield* gateway.readCurrent
      const firstProjectionRead = yield* Deferred.make<void>()
      const permitFirstProjection = yield* Deferred.make<void>()
      const projectionReads = yield* Ref.make(0)
      const recovery = {
        readDeliveryProjection: Effect.gen(function* () {
          const readNumber = yield* Ref.updateAndGet(projectionReads, (count) => count + 1)
          const accepted = yield* gateway.readCurrent
          if (readNumber === 1) {
            yield* Deferred.succeed(firstProjectionRead, undefined)
            yield* Deferred.await(permitFirstProjection)
          }
          return {
            evidence: {
              _tag: "AvailableDeliveryProjectionEvidence" as const,
              acceptedAt: accepted.appliedPosition,
              facts: [],
              integrationWaits: []
            },
            frontier: { explanations: [], transitions: [] }
          }
        }),
        reconstructedPlannedAttemptPositions: []
      }
      const layerFiber = yield* makeReactiveDeliveryRelationsLayer(runId, target, countedGateway, recovery).pipe(
        Effect.forkChild
      )

      yield* Deferred.await(firstProjectionRead)
      const operation = makeTrackerGraphObservationOperation(OperationId.make("coherent-race-read"), target)
      yield* gateway.journal.append(runId, intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
      const projected = projectTrackerSnapshot({ revision: "coherent-race", tasks: [] })
      if (projected._tag === "Invalid") return yield* Effect.die(new Error("race graph must be valid"))
      const acceptedOutcome = yield* gateway.journal.append(
        runId,
        outcomeRecordKey(operation.operationId),
        taskTrackerFactsObservedEvent(
          operation.operationId,
          makeCompleteTaskTrackerFactsObserved(operation, projected.snapshot)
        )
      )
      yield* Deferred.succeed(permitFirstProjection, undefined)

      const layer = yield* Fiber.join(layerFiber)
      const relation = yield* delivery.pipe(Effect.provide(layer))
      const evaluation = Option.getOrThrow(yield* relation.evaluations.changes.pipe(Stream.runHead))

      expect(acceptedOutcome.position).toBeGreaterThan(acceptedBefore.appliedPosition)
      expect(evaluation.acceptedAt).toBe(acceptedOutcome.position)
      expect(evaluation.current.trackerGraph._tag).toBe("GraphEstablished")
      expect(yield* Ref.get(acceptedReads)).toBe(4)
      expect(yield* Ref.get(projectionReads)).toBe(2)
    }).pipe(Effect.provide(memoryJournalStoreLayer))
  )
)

it.effect("fails initial reconciliation with the exact missing-policy error", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const gateway = yield* makeGateway
      const accepted = yield* gateway.readCurrent
      const missingPolicy = { ...accepted, reconstructed: { ...accepted.reconstructed, controlPolicy: Option.none() } }
      const missingPolicyGateway = { ...gateway, readCurrent: Effect.succeed(missingPolicy) }

      const failure = yield* makeReactiveDeliveryRelationsLayer(
        runId,
        target,
        missingPolicyGateway,
        currentProjection(Effect.succeed(missingPolicy))
      ).pipe(Effect.flip)

      expect(failure).toBeInstanceOf(DeliveryControlPolicyMissing)
    }).pipe(Effect.provide(memoryJournalStoreLayer))
  )
)

it.effect("publishes a typed relation failure when a later recovery projection fails", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const gateway = yield* makeGateway
      const failProjection = yield* Ref.make(false)
      const recoveryFailure = new TaskClaimReacquisitionPlannerUnavailable({ taskId: TaskId.make("failed-region") })
      const recovery = {
        ...currentProjection(gateway.readCurrent.pipe(Effect.orDie)),
        readDeliveryProjection: Ref.get(failProjection).pipe(
          Effect.flatMap((failed) =>
            failed
              ? Effect.fail(recoveryFailure)
              : currentProjection(gateway.readCurrent.pipe(Effect.orDie)).readDeliveryProjection
          )
        )
      }
      const layer = yield* makeReactiveDeliveryRelationsLayer(runId, target, gateway, recovery)
      const relation = yield* delivery.pipe(Effect.provide(layer))

      yield* Ref.set(failProjection, true)
      yield* relation.invalidate({ _tag: "AcceptedFactsChanged" })
      const failure = yield* relation.current.changes.pipe(Stream.runHead, Effect.flip)

      expect(failure).toBeInstanceOf(DeliveryRelationReconciliationError)
      if (!(failure instanceof DeliveryRelationReconciliationError)) return expect.fail("expected relation failure")
      expect(Cause.squash(failure.cause)).toEqual(recoveryFailure)
    }).pipe(Effect.provide(memoryJournalStoreLayer))
  )
)

it.effect("derives safely when recovery evidence is unavailable before and after graph establishment", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const gateway = yield* makeGateway
      const initialLayer = yield* makeReactiveDeliveryRelationsLayer(runId, target, gateway, unavailableProjection)
      const initialRelation = yield* delivery.pipe(Effect.provide(initialLayer))
      const initial = Option.getOrThrow(yield* initialRelation.evaluations.changes.pipe(Stream.runHead))
      expect(initial.current.trackerGraph._tag).toBe("GraphNotEstablished")

      const operation = makeTrackerGraphObservationOperation(OperationId.make("unavailable-evidence-graph"), target)
      yield* gateway.journal.append(runId, intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
      const projected = projectTrackerSnapshot({ revision: "unavailable-evidence", tasks: [] })
      if (projected._tag === "Invalid") return yield* Effect.die("unavailable-evidence graph must be valid")
      yield* gateway.journal.append(
        runId,
        outcomeRecordKey(operation.operationId),
        taskTrackerFactsObservedEvent(
          operation.operationId,
          makeCompleteTaskTrackerFactsObserved(operation, projected.snapshot)
        )
      )

      const establishedLayer = yield* makeReactiveDeliveryRelationsLayer(runId, target, gateway, unavailableProjection)
      const establishedRelation = yield* delivery.pipe(Effect.provide(establishedLayer))
      const established = Option.getOrThrow(yield* establishedRelation.evaluations.changes.pipe(Stream.runHead))
      expect(established.current.trackerGraph._tag).toBe("GraphEstablished")
    }).pipe(Effect.provide(memoryJournalStoreLayer))
  )
)

it.effect("publishes a typed failure when a quiescence probe cannot read accepted facts", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const gateway = yield* makeGateway
      const accepted = yield* gateway.readCurrent
      const failRead = yield* Ref.make(false)
      const gatewayFailure = new AcceptedJournalHistoryInvalid({
        acceptedPosition: accepted.appliedPosition,
        detail: "probe read failed",
        runId
      })
      const failingGateway = {
        ...gateway,
        readCurrent: Ref.get(failRead).pipe(
          Effect.flatMap((failed) => (failed ? Effect.fail(gatewayFailure) : gateway.readCurrent))
        )
      }
      const layer = yield* makeReactiveDeliveryRelationsLayer(
        runId,
        target,
        failingGateway,
        currentProjection(gateway.readCurrent.pipe(Effect.orDie))
      )
      const relation = yield* delivery.pipe(Effect.provide(layer))
      yield* Ref.set(failRead, true)
      yield* relation.invalidate({ _tag: "QuiescenceProbeRequested" })
      const failure = yield* relation.current.changes.pipe(Stream.runHead, Effect.flip)

      expect(failure).toBeInstanceOf(DeliveryRelationReconciliationError)
      if (!(failure instanceof DeliveryRelationReconciliationError)) return expect.fail("expected relation failure")
      expect(Cause.squash(failure.cause)).toEqual(gatewayFailure)
    }).pipe(Effect.provide(memoryJournalStoreLayer))
  )
)

it.effect("publishes a typed failure when the accepted-fact signal closes with failure", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const gateway = yield* makeGateway
      const accepted = yield* gateway.readCurrent
      const gatewayFailure = new AcceptedJournalHistoryInvalid({
        acceptedPosition: accepted.appliedPosition,
        detail: "accepted signal failed",
        runId
      })
      const failingGateway = {
        ...gateway,
        current: { changes: Stream.succeed(accepted).pipe(Stream.concat(Stream.fail(gatewayFailure))) }
      }
      const layer = yield* makeReactiveDeliveryRelationsLayer(
        runId,
        target,
        failingGateway,
        currentProjection(gateway.readCurrent.pipe(Effect.orDie))
      )
      const relation = yield* delivery.pipe(Effect.provide(layer))
      const failure = yield* relation.current.changes.pipe(
        Stream.dropWhile((current) => current.trackerGraph._tag === "GraphNotEstablished"),
        Stream.runHead,
        Effect.flip
      )

      expect(failure).toBeInstanceOf(DeliveryRelationReconciliationError)
      if (!(failure instanceof DeliveryRelationReconciliationError)) return expect.fail("expected relation failure")
      expect(Cause.squash(failure.cause)).toEqual(gatewayFailure)
    }).pipe(Effect.provide(memoryJournalStoreLayer))
  )
)
