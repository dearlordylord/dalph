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
import { AcceptedJournalHistoryInvalid, JournalStore } from "../../workflow-journal/store.js"
import {
  ControlDirectionApplicationOrdinal,
  ControlDirectionAppliedEvent
} from "../../workflow/protocols/control-direction-application/events.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { RunnableFrontierTransition } from "../frontier/frontier.js"
import { reduceWorkflowJournalHistory } from "../reconstruction/history.js"
import type { InvalidWorkflowJournalHistory } from "../reconstruction/history-result.js"
import { type AcceptedFactPublicationState, makeAcceptedFactPublicationGateway } from "./accepted-fact-gateway.js"
import { delivery } from "./delivery.js"
import { deliveryRuntime } from "./delivery-runtime-adapter.js"
import { DeliveryControlPolicyMissing, makeReactiveDeliveryRelationsLayer } from "./reactive-delivery-relations.js"
import { DeliveryRelationReconciliationError } from "./relations.js"

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

it.effect("publishes accepted G1 and equal-content G2 through one reactive delivery", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const gateway = yield* makeGateway
      const layer = yield* makeReactiveDeliveryRelationsLayer(
        runId,
        target,
        gateway,
        currentProjection(gateway.readCurrent.pipe(Effect.orDie))
      )
      const signal = yield* delivery.pipe(Effect.provide(layer))
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

      yield* gateway.journal.append(runId, intentRecordKey(first.operationId), taskTrackerReadIntent(first))
      yield* gateway.journal.append(
        runId,
        outcomeRecordKey(first.operationId),
        taskTrackerFactsObservedEvent(
          first.operationId,
          makeCompleteTaskTrackerFactsObserved(first, projected.snapshot)
        )
      )
      yield* Deferred.await(firstDeliverySeen)
      yield* gateway.journal.append(runId, intentRecordKey(second.operationId), taskTrackerReadIntent(second))
      const records = yield* gateway.journal.read(runId)
      yield* gateway.journal.append(
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
        values.map((value) => (value.graph._tag === "GraphEstablished" ? value.graph.observation.acceptedAt : null))
      ).toEqual([JournalPosition.make(3), JournalPosition.make(5)])
      expect(
        values.map((value) =>
          value.graph._tag === "GraphEstablished" ? value.graph.observation.contentIdentity : null
        )
      ).toEqual([TrackerRevision.make("integrated-equal-content"), TrackerRevision.make("integrated-equal-content")])
    }).pipe(Effect.provide(memoryJournalStoreLayer))
  )
)

it.effect("keeps a recovered paused Run passive before its first current graph", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const gateway = yield* makeGateway
      const ordinal = ControlDirectionApplicationOrdinal.make(1)
      yield* gateway.journal.append(
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
        gateway,
        currentProjection(gateway.readCurrent.pipe(Effect.orDie))
      )
      const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))
      const evaluation = Option.getOrThrow(yield* relation.evaluations.changes.pipe(Stream.runHead))

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
      const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))
      const evaluation = Option.getOrThrow(yield* relation.evaluations.changes.pipe(Stream.runHead))

      expect(acceptedOutcome.position).toBeGreaterThan(acceptedBefore.appliedPosition)
      expect(evaluation.acceptedAt).toBe(acceptedOutcome.position)
      expect(evaluation.current.trackerGraph._tag).toBe("GraphEstablished")
      expect(yield* Ref.get(acceptedReads)).toBe(4)
      expect(yield* Ref.get(projectionReads)).toBe(2)
    }).pipe(Effect.provide(memoryJournalStoreLayer))
  )
)

it.effect("does not propose the initial graph read until recovered boundary work disappears", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const gateway = yield* makeGateway
      const recoveredTransitions = yield* Ref.make<ReadonlyArray<RunnableFrontierTransition>>([
        RunnableFrontierTransition.SuspendPlannedAttemptExecutorWork({ plannedAttempt: recoveredAttempt })
      ])
      const recovery = {
        readDeliveryProjection: Effect.all({
          accepted: gateway.readCurrent,
          transitions: Ref.get(recoveredTransitions)
        }).pipe(
          Effect.map(({ accepted, transitions }) => ({
            evidence: {
              _tag: "AvailableDeliveryProjectionEvidence" as const,
              acceptedAt: accepted.appliedPosition,
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
      const layer = yield* makeReactiveDeliveryRelationsLayer(runId, target, gateway, recovery)
      const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))
      const initial = Option.getOrThrow(yield* relation.evaluations.changes.pipe(Stream.runHead))
      expect(initial.proposedActions).toMatchObject({
        _tag: "DeliveryProposalsAvailable",
        proposals: [
          { route: { _tag: "IdentityFreeWorkflowRoute", transition: { _tag: "SuspendPlannedAttemptExecutorWork" } } }
        ]
      })
      const initialProposal =
        initial.proposedActions._tag === "DeliveryProposalsAvailable" ? initial.proposedActions.proposals[0] : undefined
      if (initialProposal === undefined) return yield* Effect.die("expected one recovered proposal")

      yield* Ref.set(recoveredTransitions, [])
      yield* relation.invalidate({ _tag: "ProposalCompleted", proposalId: initialProposal.id, result: null })
      const afterRecovery = Option.getOrThrow(yield* relation.evaluations.changes.pipe(Stream.runHead))
      expect(afterRecovery.proposedActions).toMatchObject({
        _tag: "DeliveryProposalsAvailable",
        proposals: [{ route: { _tag: "TrackerGraphReadRoute", purpose: "EstablishCurrentGraph" } }]
      })
    }).pipe(Effect.provide(memoryJournalStoreLayer))
  )
)

it.effect("establishes the current graph before proposing an external-success claim release", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const gateway = yield* makeGateway
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
        readDeliveryProjection: gateway.readCurrent.pipe(
          Effect.map((accepted) => ({
            evidence: {
              _tag: "AvailableDeliveryProjectionEvidence" as const,
              acceptedAt: accepted.appliedPosition,
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
      const layer = yield* makeReactiveDeliveryRelationsLayer(runId, target, gateway, recovery)
      const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))
      const initial = Option.getOrThrow(yield* relation.evaluations.changes.pipe(Stream.runHead))

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
      const recoveryFailure: InvalidWorkflowJournalHistory = {
        _tag: "InvalidWorkflowJournalHistory",
        issues: [],
        records: [],
        runId
      }
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
      const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))

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
      const initialRelation = yield* deliveryRuntime.pipe(Effect.provide(initialLayer))
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
      const establishedRelation = yield* deliveryRuntime.pipe(Effect.provide(establishedLayer))
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
      const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))
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
      const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))
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
