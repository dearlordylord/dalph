import { it } from "@effect/vitest"
import { TaskId } from "@dalph/contracts"
import { Deferred, Effect, Fiber, Ref, Semaphore, Stream, SubscriptionRef } from "effect"
import { expect } from "vitest"
import { TaskDagSnapshot } from "../../authorities/task-tracker/graph.js"
import { TaskLifecycle, TrackerRevision, TrackerSnapshot } from "../../authorities/task-tracker/task.js"
import { initialRunPolicyRevision, RunControlPolicy } from "../../control/policy.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { OperationId } from "../../workflow/identity.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { deliveryRuntime } from "./delivery-runtime-adapter.js"
import { makeDeliveryRelationsLayer } from "./in-memory-relations.js"
import {
  DeliveryRelationRevision,
  makeAcceptedTrackerGraphObservation,
  mapCurrentSignal,
  type DeliveryRelationInputBundle,
  type DeliveryRuntimeFacts,
  TrackerGraphState
} from "./relations.js"

const graph = (revision: string, taskId: TaskId) => {
  const projected = TaskDagSnapshot.project(
    TrackerSnapshot.make({
      revision: TrackerRevision.make(revision),
      tasks: [{ id: taskId, lifecycle: TaskLifecycle.cases.Open.make({}), parentTaskId: null, prerequisiteIds: [] }]
    })
  )
  if (projected._tag === "Invalid") return expect.fail("test graph must be valid")
  const operationId = OperationId.make(`fixture:${revision}`)
  return TrackerGraphState.cases.GraphEstablished.make({
    observation: makeAcceptedTrackerGraphObservation({
      snapshot: projected.snapshot,
      operationId,
      acceptedAt: JournalPosition.make(1)
    })
  })
}

const policy = (capacity: number) =>
  RunControlPolicy.make({ revision: initialRunPolicyRevision, taskExecutionCapacity: TaskWorkCapacity.make(capacity) })

interface CoherentInput {
  readonly facts: DeliveryRuntimeFacts
  readonly graph: TrackerGraphState
  readonly policy: RunControlPolicy
}

it.effect("never combines runtime facts from one accepted revision with another graph revision", () =>
  Effect.gen(function* () {
    const taskA = TaskId.make("A")
    const taskB = TaskId.make("B")
    const firstRevision = DeliveryRelationRevision.make(1)
    const secondRevision = DeliveryRelationRevision.make(2)
    const input = yield* SubscriptionRef.make<CoherentInput>({
      facts: {
        acceptedAt: JournalPosition.make(1),
        quiescence: { _tag: "QuiescencePassive", reason: "ProbeNotRequired" },
        revision: firstRevision,
        taskWork: { capacity: TaskWorkCapacity.make(1), held: [] }
      },
      graph: graph("graph-1", taskA),
      policy: policy(1)
    })
    const gate = yield* Semaphore.make(1)
    const revision = yield* Ref.make(firstRevision)
    const firstSamplingEntered = yield* Deferred.make<void>()
    const permitSampling = yield* Deferred.make<void>()
    const sampleCount = yield* Ref.make(0)
    const signal = { changes: SubscriptionRef.changes(input) }
    const coherent = mapCurrentSignal(
      signal,
      ({ facts, graph, policy }): DeliveryRelationInputBundle => ({
        legacy: {
          proposalContributions: { deliverySettlement: [], issues: [], ticketDelivery: [] },
          reflectionProposals: [],
          runtimeFacts: facts,
          trackerGraphProposals: []
        },
        publication: { exactEvidence: [], graph, policy }
      })
    )
    const layer = makeDeliveryRelationsLayer({
      evaluationConsistency: {
        currentRevision: Ref.get(revision),
        withStableRevision: (effect) =>
          gate.withPermit(
            Ref.updateAndGet(sampleCount, (count) => count + 1).pipe(
              Effect.tap((count) =>
                count === 1
                  ? Deferred.succeed(firstSamplingEntered, undefined).pipe(
                      Effect.andThen(Deferred.await(permitSampling))
                    )
                  : Effect.void
              ),
              Effect.andThen(effect)
            )
          )
      },
      coherent,
      invalidate: () => Ref.get(revision),
      runtimeFacts: mapCurrentSignal(signal, ({ facts }) => facts)
    })
    const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))
    const collected = yield* relation.evaluations.changes.pipe(Stream.take(2), Stream.runCollect, Effect.forkChild)
    yield* Deferred.await(firstSamplingEntered)

    const publishSecond = yield* gate
      .withPermit(
        Ref.set(revision, secondRevision).pipe(
          Effect.andThen(
            SubscriptionRef.set(input, {
              facts: {
                acceptedAt: JournalPosition.make(2),
                quiescence: { _tag: "QuiescencePassive", reason: "ProbeNotRequired" },
                revision: secondRevision,
                taskWork: { capacity: TaskWorkCapacity.make(2), held: [] }
              },
              graph: graph("graph-2", taskB),
              policy: policy(2)
            })
          )
        )
      )
      .pipe(Effect.forkChild)
    yield* Effect.yieldNow
    expect(publishSecond.pollUnsafe()).toBeUndefined()
    yield* Deferred.succeed(permitSampling, undefined)
    yield* Fiber.join(publishSecond)

    const evaluations = Array.from(yield* Fiber.join(collected))
    expect(
      evaluations.map((evaluation) => ({
        acceptedAt: evaluation.acceptedAt,
        capacity: evaluation.taskWork.capacity,
        graphRevision:
          evaluation.current.trackerGraph._tag === "GraphEstablished"
            ? evaluation.current.trackerGraph.observation.snapshot.toWire().revision
            : "missing",
        revision: evaluation.revision
      }))
    ).toEqual([
      {
        acceptedAt: JournalPosition.make(1),
        capacity: TaskWorkCapacity.make(1),
        graphRevision: TrackerRevision.make("graph-1"),
        revision: firstRevision
      },
      {
        acceptedAt: JournalPosition.make(2),
        capacity: TaskWorkCapacity.make(2),
        graphRevision: TrackerRevision.make("graph-2"),
        revision: secondRevision
      }
    ])
  }).pipe(Effect.scoped)
)
