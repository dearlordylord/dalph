import { it } from "@effect/vitest"
import { GitCommitSha, RunId, TaskExecutorLocator, WorktreeLocator } from "@dalph/contracts"
import { Effect, Layer, Ref, Semaphore, SubscriptionRef } from "effect"
import { expect } from "vitest"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { projectTrackerSnapshot } from "../../authorities/task-tracker/graph.js"
import { InitialControlPolicy, initialRunPolicyRevision, RunControlPolicy } from "../../control/policy.js"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import { reduceWorkflowJournalHistory } from "../reconstruction/history.js"
import { OperationId } from "../../workflow/identity.js"
import { taskTrackerReadIntent } from "../../workflow/registry/event.js"
import { makeTrackerGraphObservationOperation } from "../../workflow/registry/operation.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../workflow/task-tracker-facts/observation.js"
import { memoryJournalStoreLayer } from "../../workflow-journal/adapters/memory-store.js"
import { intentRecordKey, outcomeRecordKey } from "../../workflow-journal/record-key.js"
import { JournalStore } from "../../workflow-journal/store.js"
import {
  deterministicOperationIdAllocatorLayer,
  deterministicPlannedTaskAttemptLayer
} from "../../workflow/protocols/task-attempt-planning/plan.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { deliveryRuntime } from "./delivery-runtime-adapter.js"
import {
  DeliveryActionExecutor,
  DeliverySemanticTrace,
  type DeliverySemanticTraceEvent
} from "./delivery-action-executor.js"
import { trackerGraphReadProposalOf } from "./delivery-action-proposal.js"
import { deliveryRuntimeResourcesLayer } from "./delivery-runtime-resources.js"
import { makeDeliveryRelationsLayer } from "./in-memory-relations.js"
import {
  DeliveryRelationRevision,
  type DeliveryRelationInputBundle,
  type DeliveryRuntimeRelation,
  mapCurrentSignal,
  type TrackerGraphState
} from "./relations.js"
import { makeAcceptedFactPublicationGateway } from "./accepted-fact-gateway.js"
import { reactiveDeliveryRelationsLayer } from "./reactive-delivery-relations.js"
import { runDeliveryRuntime } from "./run-delivery-runtime.js"

const runId = RunId.make("semantic-conformance-run")
const target = FixtureTarget.make("semantic-conformance-target")
const initialRevision = DeliveryRelationRevision.make(0)
const initialPolicy = InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
const policy = RunControlPolicy.make({
  revision: initialRunPolicyRevision,
  taskExecutionCapacity: initialPolicy.taskExecutionCapacity
})
const identityLayers = Layer.mergeAll(
  deterministicOperationIdAllocatorLayer("semantic-conformance-operation"),
  deterministicPlannedTaskAttemptLayer({
    baseSha: GitCommitSha.make("1".repeat(40)),
    executor: TaskExecutorLocator.make("executor:semantic-conformance"),
    runId,
    worktreeRoot: WorktreeLocator.make("/semantic-conformance")
  }),
  deliveryRuntimeResourcesLayer
)

interface DryConformanceInput {
  readonly revision: DeliveryRelationRevision
  readonly trackerGraphProposals: ReadonlyArray<ReturnType<typeof trackerGraphReadProposalOf>>
}

const makeDryConformanceLayer = Effect.fn("DeliverySemanticConformance.makeDryLayer")(function* (
  graph: TrackerGraphState,
  acceptedAt: JournalPosition
) {
  const state = yield* SubscriptionRef.make<DryConformanceInput>({
    revision: initialRevision,
    trackerGraphProposals: []
  })
  const gate = yield* Semaphore.make(1)
  const revision = yield* Ref.make(initialRevision)
  const signal = { changes: SubscriptionRef.changes(state) }
  const coherent = mapCurrentSignal(
    signal,
    ({ revision: currentRevision }): DeliveryRelationInputBundle => ({
      exactEvidence: [],
      graph,
      policy,
      proposalContributions: { deliverySettlement: [], issues: [], ticketDelivery: [] },
      reflectionProposals: [],
      runtimeFacts: {
        acceptedAt,
        quiescence: { _tag: "QuiescenceProbeAllowed" },
        revision: currentRevision,
        taskWork: { capacity: policy.taskExecutionCapacity, held: [] }
      },
      trackerGraphProposals: []
    })
  )
  return makeDeliveryRelationsLayer({
    evaluationConsistency: {
      currentRevision: Ref.get(revision),
      withStableRevision: (effect) => gate.withPermit(effect)
    },
    coherent,
    invalidate: (cause) =>
      gate.withPermit(
        Ref.updateAndGet(revision, (current) => DeliveryRelationRevision.make(current + 1)).pipe(
          Effect.flatMap((next) =>
            SubscriptionRef.set(state, {
              revision: next,
              trackerGraphProposals:
                cause._tag === "QuiescenceProbeRequested"
                  ? [trackerGraphReadProposalOf({ acceptedAt, purpose: "QuiescenceProbe", runId, target })]
                  : []
            }).pipe(Effect.as(next))
          )
        )
      ),
    runtimeFacts: mapCurrentSignal(signal, ({ revision }) => ({
      acceptedAt,
      quiescence: { _tag: "QuiescenceProbeAllowed" },
      revision,
      taskWork: { capacity: policy.taskExecutionCapacity, held: [] }
    })),
    trackerGraphProposals: mapCurrentSignal(signal, ({ trackerGraphProposals }) => trackerGraphProposals)
  })
})

const makeLiveFakeConformanceLayer = Effect.fn("DeliverySemanticConformance.makeLiveFakeLayer")(function* () {
  const storage = yield* JournalStore
  yield* storage.beginRun(runId, target, initialPolicy)
  const initial = reduceWorkflowJournalHistory(runId, yield* storage.read(runId))
  if (initial._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(initial)
  const gateway = yield* makeAcceptedFactPublicationGateway(runId, target, initial, storage)
  const projected = projectTrackerSnapshot({ revision: "semantic-conformance", tasks: [] })
  if (projected._tag === "Invalid") return yield* Effect.die(new Error("conformance graph must be valid"))
  const operation = makeTrackerGraphObservationOperation(OperationId.make("semantic-conformance-read"), target)
  yield* gateway.journal.append(runId, intentRecordKey(operation.operationId), taskTrackerReadIntent(operation))
  yield* gateway.journal.append(
    runId,
    outcomeRecordKey(operation.operationId),
    taskTrackerFactsObservedEvent(
      operation.operationId,
      makeCompleteTaskTrackerFactsObserved(operation, projected.snapshot)
    )
  )
  const accepted = yield* gateway.readCurrent
  const recovery = {
    readDeliveryProjection: gateway.readCurrent.pipe(
      Effect.map((current) => ({
        evidence: {
          _tag: "AvailableDeliveryProjectionEvidence" as const,
          acceptedAt: current.appliedPosition,
          facts: [],
          integrationWaits: []
        },
        frontier: { explanations: [], transitions: [] }
      }))
    ),
    reconstructedPlannedAttemptPositions: []
  }
  return {
    acceptedAt: accepted.appliedPosition,
    graph: accepted.graph,
    layer: reactiveDeliveryRelationsLayer(runId, target, gateway, recovery)
  }
})

const runMode = Effect.fn("DeliverySemanticConformance.runMode")(function* <E>(
  relation: DeliveryRuntimeRelation<E>,
  mode: "Dry" | "LiveFake"
) {
  const events = yield* Ref.make<ReadonlyArray<DeliverySemanticTraceEvent>>([])
  const boundaryCalls = yield* Ref.make(0)
  const executor = DeliveryActionExecutor.of({
    execute: (action) =>
      (mode === "LiveFake" ? Ref.update(boundaryCalls, (count) => count + 1) : Effect.void).pipe(
        Effect.as({ _tag: "ActionCompleted" as const, proposalId: action.proposal.id })
      )
  })
  yield* runDeliveryRuntime(relation).pipe(
    Effect.provide(identityLayers),
    Effect.provideService(DeliveryActionExecutor, executor),
    Effect.provideService(
      DeliverySemanticTrace,
      DeliverySemanticTrace.of({ emit: (event) => Ref.update(events, (current) => [...current, event]) })
    )
  )
  return { boundaryCalls: yield* Ref.get(boundaryCalls), events: yield* Ref.get(events) }
})

it.effect("dry and live-fake Layers emit the same DeliverySemanticTrace after equivalent current graphs", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const liveSetup = yield* makeLiveFakeConformanceLayer()
      const dryLayer = yield* makeDryConformanceLayer(liveSetup.graph, liveSetup.acceptedAt)
      const dryRelation = yield* deliveryRuntime.pipe(Effect.provide(dryLayer))
      const liveRelation = yield* deliveryRuntime.pipe(Effect.provide(liveSetup.layer))
      const dry = yield* runMode(dryRelation, "Dry")
      const liveFake = yield* runMode(liveRelation, "LiveFake")
      const graphProposal = trackerGraphReadProposalOf({
        acceptedAt: liveSetup.acceptedAt,
        purpose: "QuiescenceProbe",
        runId,
        target
      })

      expect(liveSetup.graph._tag).toBe("GraphEstablished")
      expect(dry.events).toEqual(liveFake.events)
      expect(dry.events).toEqual([
        { _tag: "ProposalAdmitted", proposalId: graphProposal.id },
        { _tag: "ActionOutcome", outcome: "ActionCompleted", proposalId: graphProposal.id }
      ])
      expect(dry.boundaryCalls).toBe(0)
      expect(liveFake.boundaryCalls).toBe(1)
    }).pipe(Effect.provide(memoryJournalStoreLayer))
  )
)
