import { it } from "@effect/vitest"
import { GitCommitSha, RunId, TaskExecutorLocator, TaskId, WorktreeLocator } from "@dalph/contracts"
import { Deferred, Effect, Exit, Fiber, Layer, Option, Queue, Ref, Stream } from "effect"
import { expect } from "vitest"
import { makeFreshTaskAdmissionTestBasis } from "../../../test/support/fresh-task-admission.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import {
  deterministicOperationIdAllocatorLayer,
  deterministicPlannedTaskAttemptLayer
} from "../../workflow/protocols/task-attempt-planning/plan.js"
import { plannedAttemptProtocolControllerLayer } from "../../workflow/protocols/planned-attempt-executor-work/protocol-controller.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { makeApplicationExitLifecycle } from "../application-exit/lifecycle.js"
import { initialRunPolicyRevision, RunControlPolicy } from "../../control/policy.js"
import { DeliveryActionExecutor, DeliverySemanticTrace, type DeliveryActionResult } from "./delivery-action-executor.js"
import { DeliveryProposalId, trackerGraphReadProposalOf } from "./delivery-proposal.js"
import { deliveryRuntime } from "./delivery-runtime-adapter.js"
import { DeliveryRuntimeObservationObserver } from "./delivery-runtime-observation.js"
import { deliveryRuntimeResourcesLayer } from "./delivery-runtime-resources.js"
import { deterministicDeliveryRuntimeSupport, makeDeliveryRelationsLayer } from "./in-memory-relations.js"
import { DeliveryPlanningCatchUp } from "./delivery-planning-catch-up.js"
import {
  currentSignalOf,
  makeCurrentSignal,
  TrackerGraphState,
  type DeliveryActionProposal,
  type DeliveryRelationInputBundle,
  type DeliveryRuntimeEvaluation
} from "./relations.js"
import { makeRuntimeEventMailbox, runDeliveryRuntime } from "./run-delivery-runtime.js"

const runId = RunId.make("mailbox-backpressure-run")
const target = FixtureTarget.make("mailbox-backpressure-target")
const policy = RunControlPolicy.make({
  revision: initialRunPolicyRevision,
  taskExecutionCapacity: TaskWorkCapacity.make(2)
})
const support = Layer.mergeAll(
  deterministicOperationIdAllocatorLayer("mailbox-operation"),
  deterministicPlannedTaskAttemptLayer({
    baseSha: GitCommitSha.make("1".repeat(40)),
    executor: TaskExecutorLocator.make("executor:mailbox"),
    runId,
    worktreeRoot: WorktreeLocator.make("/mailbox")
  }),
  plannedAttemptProtocolControllerLayer,
  Layer.unwrap(
    makeApplicationExitLifecycle().pipe(Effect.map(({ admission }) => deliveryRuntimeResourcesLayer(admission)))
  )
)
const publication = DeliveryPlanningCatchUp.of({
  awaitJournalPosition: Effect.succeed({
    _tag: "DeliveryPlanningCatchUpBoundary",
    acceptedThrough: JournalPosition.make(5),
    runId
  })
})
const proposal = (ordinal: number): DeliveryActionProposal => ({
  ...trackerGraphReadProposalOf({
    acceptedAt: JournalPosition.make(ordinal + 1),
    purpose: "EstablishCurrentGraph",
    runId,
    target
  }),
  id: DeliveryProposalId.make(`mailbox-proposal-${ordinal}`),
  admission: {
    integrationTarget: { _tag: "NoIntegrationTargetResource" },
    plannedAttemptProtocol: { _tag: "NoPlannedAttemptProtocol" },
    taskWorkPosition: {
      _tag: "TaskWorkPositionRequired",
      mode: "ReserveOrReuse",
      taskId: TaskId.make(`mailbox-task-${ordinal}`)
    }
  }
})
const baseEvaluation = Effect.gen(function* () {
  const relation = yield* deliveryRuntime.pipe(
    Effect.provide(
      makeDeliveryRelationsLayer({
        ...deterministicDeliveryRuntimeSupport(policy),
        coherent: currentSignalOf({
          actionInputs: {
            freshTaskCandidates: [],
            proposalContributions: { deliverySettlement: [], issues: [], ticketDelivery: [] },
            reflectionProposals: [],
            runtimeFacts: {
              acceptedAt: JournalPosition.make(1),
              acceptedFactPublication: { _tag: "WorkflowProgress" },
              cancellationApplied: false,
              pauseCoverage: {
                _tag: "PauseCoverageGraphNotEstablished",
                applied: { run: { _tag: "RunUnpaused" }, tasks: { _tag: "NoTaskPauses" } }
              },
              quiescence: { _tag: "QuiescencePassive", reason: "RunPaused" },
              taskWork: makeFreshTaskAdmissionTestBasis({ capacity: policy.taskExecutionCapacity, runId })
            },
            trackerGraphProposals: []
          },
          graphView: { exactEvidence: [], graph: TrackerGraphState.cases.GraphNotEstablished.make({}), policy }
        } satisfies DeliveryRelationInputBundle)
      })
    )
  )
  return Option.getOrThrow(yield* relation.changes.pipe(Stream.runHead))
})
const evaluationAt = (
  base: DeliveryRuntimeEvaluation,
  position: number,
  proposals: ReadonlyArray<DeliveryActionProposal>
): DeliveryRuntimeEvaluation => ({
  ...base,
  acceptedAt: JournalPosition.make(position),
  proposedActions: { _tag: "DeliveryProposalsAvailable", freshTaskCandidates: [], isolatedIssues: [], proposals }
})

// S1 and the subscriber half of S4. The second pull is reached only after
// the first offer returns. The third pull requires the blocked second offer.
for (const cancel of [false, true]) {
  it.effect(
    cancel
      ? "interrupts a full-mailbox subscriber without draining or acknowledging"
      : "backpressures the real relation subscriber and applies every evaluation in FIFO order",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const base = yield* baseEvaluation
          const initial = evaluationAt(base, 1, [proposal(0)])
          const held = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          const produce = yield* Deferred.make<void>()
          const secondPulled = yield* Deferred.make<void>()
          const thirdPulled = yield* Deferred.make<void>()
          const drained = yield* Deferred.make<void>()
          const stopped = yield* Deferred.make<void>()
          const applied = yield* Ref.make<ReadonlyArray<number>>([])
          let initialPublications = 0
          const observer = DeliveryRuntimeObservationObserver.of({
            observe: ({ evaluation }) =>
              Effect.gen(function* () {
                if (evaluation.acceptedAt === initial.acceptedAt) {
                  initialPublications++
                  if (initialPublications === 2) {
                    yield* Deferred.succeed(held, undefined)
                    yield* Deferred.await(release)
                  }
                } else {
                  yield* Ref.update(applied, (values) => [...values, Number(evaluation.acceptedAt)])
                  if (evaluation.acceptedAt === JournalPosition.make(4)) yield* Deferred.succeed(drained, undefined)
                }
              })
          })
          const changes = Stream.fromIterable([2, 3, 4]).pipe(
            Stream.mapEffect((position) =>
              Effect.gen(function* () {
                yield* Deferred.await(produce)
                if (position === 3) yield* Deferred.succeed(secondPulled, undefined)
                if (position === 4) yield* Deferred.succeed(thirdPulled, undefined)
                return evaluationAt(base, position, [proposal(0)])
              })
            ),
            Stream.ensuring(Deferred.succeed(stopped, undefined))
          )
          const relation = makeCurrentSignal(Effect.succeed({ current: initial, changes }))
          const runtime = yield* runDeliveryRuntime(runId, relation).pipe(
            Effect.provide(support),
            Effect.provideService(DeliveryRuntimeObservationObserver, observer),
            Effect.provideService(DeliveryPlanningCatchUp, publication),
            Effect.provideService(DeliveryActionExecutor, DeliveryActionExecutor.of({ execute: () => Effect.never })),
            Effect.forkChild
          )
          yield* Deferred.await(held)
          yield* Deferred.succeed(produce, undefined)
          yield* Deferred.await(secondPulled)
          // Let the subscriber finish the second handoff if capacity permits it.
          yield* Effect.yieldNow
          expect(yield* Deferred.isDone(thirdPulled)).toBe(false)
          expect(yield* Ref.get(applied)).toEqual([])
          if (cancel) {
            yield* Fiber.interrupt(runtime)
            const exit = yield* Fiber.await(runtime)
            expect(Exit.isFailure(exit)).toBe(true)
            expect(yield* Deferred.isDone(stopped)).toBe(true)
            expect(yield* Deferred.isDone(thirdPulled)).toBe(false)
            expect(yield* Ref.get(applied)).toEqual([])
          } else {
            yield* Deferred.succeed(release, undefined)
            yield* Deferred.await(drained)
            expect(yield* Ref.get(applied)).toEqual([2, 3, 4])
            yield* Fiber.interrupt(runtime)
            expect(yield* Deferred.isDone(stopped)).toBe(true)
          }
        })
      )
  )
}

// S2: two exact children must get past a full mailbox, retain their lagged
// publication proofs, then settle only after the catch-up evaluation arrives.
// S4: interruption also stops children offering into that full mailbox.
for (const disposition of ["Drain", "CancelBlockedOffers", "CancelPendingAcknowledgement"] as const) {
  it.effect(
    disposition === "CancelBlockedOffers"
      ? "cancels independent completion offers blocked behind a relation occurrence"
      : disposition === "CancelPendingAcknowledgement"
        ? "interrupts children awaiting acknowledgement of retained completions"
        : "drains independent completions and acknowledges lagged publications exactly once",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const base = yield* baseEvaluation
          const proposals = [proposal(0), proposal(1)]
          const initial = evaluationAt(base, 1, proposals)
          const inputs = yield* Queue.unbounded<DeliveryRuntimeEvaluation>()
          const started = yield* Queue.unbounded<string>()
          const published = yield* Queue.unbounded<void>()
          const pending = yield* Queue.unbounded<string>()
          const finish = yield* Deferred.make<void>()
          const held = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          const fillerAccepted = yield* Deferred.make<void>()
          const outcomes = yield* Ref.make<ReadonlyArray<DeliveryActionResult>>([])
          const stopped = yield* Ref.make<ReadonlyArray<string>>([])
          let holdOnce = true
          const observer = DeliveryRuntimeObservationObserver.of({
            observe: ({ evaluation }) =>
              evaluation.acceptedAt === JournalPosition.make(2) && holdOnce
                ? Effect.gen(function* () {
                    holdOnce = false
                    yield* Deferred.succeed(held, undefined)
                    yield* Deferred.await(release)
                  })
                : Effect.void
          })
          const changes = Stream.fromEffectRepeat(Queue.take(inputs)).pipe(
            Stream.tap((evaluation) =>
              evaluation.acceptedAt === JournalPosition.make(4)
                ? Deferred.succeed(fillerAccepted, undefined)
                : Effect.void
            )
          )
          // Each callback's successor runs only when the runtime offer succeeded.
          const relation = makeCurrentSignal(Effect.succeed({ current: initial, changes }))
          const executor = DeliveryActionExecutor.of({
            execute: ({ proposal: action }) =>
              Queue.offer(started, action.id).pipe(
                Effect.andThen(Deferred.await(finish)),
                Effect.as({ _tag: "ActionCompleted", proposalId: action.id } satisfies DeliveryActionResult),
                Effect.ensuring(Ref.update(stopped, (ids) => [...ids, action.id]))
              )
          })
          const runtime = yield* runDeliveryRuntime(runId, relation).pipe(
            Effect.provide(support),
            Effect.provideService(DeliveryRuntimeObservationObserver, observer),
            Effect.provideService(DeliveryActionExecutor, executor),
            Effect.provideService(
              DeliveryPlanningCatchUp,
              DeliveryPlanningCatchUp.of({
                awaitJournalPosition: Queue.offer(published, undefined).pipe(
                  Effect.andThen(publication.awaitJournalPosition)
                )
              })
            ),
            Effect.provideService(
              DeliverySemanticTrace,
              DeliverySemanticTrace.of({
                emit: (event) =>
                  event._tag === "ActionOutcome"
                    ? Ref.update(outcomes, (values) => [...values, event.result])
                    : event._tag === "ActionCompletionPublicationPending"
                      ? Queue.offer(pending, event.proposalId)
                      : Effect.void
              })
            ),
            Effect.forkChild
          )
          expect(new Set([yield* Queue.take(started), yield* Queue.take(started)])).toEqual(
            new Set(proposals.map(({ id }) => id))
          )
          yield* Queue.offer(inputs, evaluationAt(base, 2, proposals))
          yield* Deferred.await(held)
          yield* Queue.offer(inputs, evaluationAt(base, 3, proposals))
          // Pulling 4 proves that 3 entered the sole slot. Its offer now blocks,
          // followed by both completion offers while the consumer stays held.
          yield* Queue.offer(inputs, evaluationAt(base, 4, proposals))
          yield* Deferred.await(fillerAccepted)
          yield* Deferred.succeed(finish, undefined)
          yield* Queue.take(published)
          yield* Queue.take(published)
          expect(yield* Ref.get(outcomes)).toEqual([])
          expect(yield* Queue.size(pending)).toBe(0)
          if (disposition === "CancelBlockedOffers") {
            yield* Fiber.interrupt(runtime)
            expect(Exit.isFailure(yield* Fiber.await(runtime))).toBe(true)
            expect(yield* Ref.get(outcomes)).toEqual([])
          } else {
            yield* Deferred.succeed(release, undefined)
            expect(new Set([yield* Queue.take(pending), yield* Queue.take(pending)])).toEqual(
              new Set(proposals.map(({ id }) => id))
            )
            expect(yield* Ref.get(outcomes)).toEqual([])
            if (disposition === "CancelPendingAcknowledgement") {
              yield* Fiber.interrupt(runtime)
              expect(Exit.isFailure(yield* Fiber.await(runtime))).toBe(true)
              expect(yield* Ref.get(outcomes)).toEqual([])
              return
            }
            yield* Queue.offer(inputs, evaluationAt(base, 5, []))
            expect(yield* Fiber.join(runtime)).toMatchObject({
              _tag: "PassiveRuntimeQuiescence",
              acceptedAt: JournalPosition.make(5)
            })
            expect((yield* Ref.get(outcomes)).map(({ proposalId }) => proposalId).sort()).toEqual(
              proposals.map(({ id }) => id).sort()
            )
          }
          expect((yield* Ref.get(stopped)).toSorted()).toEqual(proposals.map(({ id }) => id).sort())
        })
      )
  )
}

// The same mailbox operations are called by the runtime's subscriber, child,
// and consumer. This additionally proves child return at the exact Deferred.
it.effect("returns a completion producer only after its exact acknowledgement", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const mailbox = yield* makeRuntimeEventMailbox<number>()
      const releaseConsumer = yield* Deferred.make<void>()
      const consumed = yield* Deferred.make<void>()
      const acknowledged = yield* Deferred.make<void>()
      const delivered = yield* Ref.make<ReadonlyArray<number>>([])
      yield* mailbox.offer(0)
      const producer = yield* mailbox
        .offerAndAwaitAcknowledgement(1, acknowledged)
        .pipe(Effect.forkChild({ startImmediately: true }))
      expect(producer.pollUnsafe()).toBeUndefined()
      const consumer = yield* Effect.gen(function* () {
        yield* Deferred.await(releaseConsumer)
        for (let index = 0; index < 2; index++) {
          const event = yield* mailbox.take
          yield* Ref.update(delivered, (events) => [...events, event])
        }
        yield* Deferred.succeed(consumed, undefined)
      }).pipe(Effect.forkChild({ startImmediately: true }))
      expect(yield* Ref.get(delivered)).toEqual([])
      yield* Deferred.succeed(releaseConsumer, undefined)
      yield* Deferred.await(consumed)
      expect(yield* Ref.get(delivered)).toEqual([0, 1])
      expect(producer.pollUnsafe()).toBeUndefined()
      expect(yield* Deferred.isDone(acknowledged)).toBe(false)
      yield* Deferred.succeed(acknowledged, undefined)
      yield* Fiber.join(producer)
      yield* Fiber.join(consumer)
      expect(yield* Deferred.succeed(acknowledged, undefined)).toBe(false)
    })
  )
)

it.effect("interrupts rejected offers after scope closure instead of waiting for acknowledgement", () =>
  Effect.gen(function* () {
    const mailbox = yield* Effect.scoped(makeRuntimeEventMailbox<number>())
    const acknowledged = yield* Deferred.make<void>()
    const exit = yield* Effect.exit(mailbox.offerAndAwaitAcknowledgement(1, acknowledged))
    expect(Exit.isFailure(exit)).toBe(true)
    expect(yield* Deferred.isDone(acknowledged)).toBe(false)
  })
)
