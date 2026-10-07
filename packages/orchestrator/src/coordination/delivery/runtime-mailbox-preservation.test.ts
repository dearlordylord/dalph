import { liveJournalTestLayer } from "./live-journal-test-layer.js"
import { Journal } from "./journal.js"
import { makeReactiveDeliveryRelationsLayer } from "./reactive-delivery-relations.js"
import { DeliveryRelationPublicationObserver } from "./delivery-publication-observer.js"
import { deriveFreshTaskCandidateEvaluation } from "./fresh-task-candidate.js"
import { RunActivationOpportunity } from "../run/run-activation-opportunity.js"
import { journalEvidenceFrom } from "../../workflow-journal/record-evidence.js"
import { makeWorkflowRunBeganRecord } from "../../workflow-journal/run-lifecycle.js"
import { InRunJournal, type JournalRecord } from "../../workflow-journal/store.js"
import { memoryJournalTestLayerFromPartitionRecords } from "../../workflow-journal/adapters/memory-store.js"
import { intentRecordKey, outcomeRecordKey } from "../../workflow-journal/record-key.js"
import {
  makeTrackerGraphObservationOperation,
  makeTaskClaimAcquisitionOperation
} from "../../workflow/registry/operation.js"
import { taskTrackerReadIntent, TaskClaimAcquisitionIntendedEvent } from "../../workflow/registry/event.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../workflow/task-tracker-facts/observation.js"
import { AttemptBasePolicy } from "../../workflow/protocols/task-attempt-planning/base.js"
import { remotePublicationTargetForTest } from "../../../test/support/direct-publication.js"
import { TaskClaimAcquisition } from "../../authorities/task-tracker/claim-mutation.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import { TaskLifecycle, type Task } from "../../authorities/task-tracker/task.js"
import { projectTrackerSnapshot } from "../../authorities/task-tracker/graph.js"
import { deterministicTaskClaimAcquisitionPlannerLayer } from "../../workflow/protocols/task-claim-acquisition/plan.js"
import { makeIntegrationTargetResourceController } from "../admission/integration-target-resource.js"
import { InterruptibleWorkflowBoundaryIntent } from "../../workflow/interpretation/interpreter.js"
import { it } from "@effect/vitest"
import { expect } from "vitest"
import { Cause, Context, Deferred, Effect, Fiber, Layer, Option, Queue, Ref, Stream, SubscriptionRef } from "effect"
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
import { OperationId } from "../../workflow/identity.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { makeFreshTaskAdmissionTestBasis } from "../../../test/support/fresh-task-admission.js"
import { InitialControlPolicy, initialRunPolicyRevision, RunControlPolicy } from "../../control/policy.js"
import {
  OperationIdAllocator,
  deterministicOperationIdAllocatorLayer,
  deterministicPlannedTaskAttemptLayer
} from "../../workflow/protocols/task-attempt-planning/plan.js"
import { plannedAttemptProtocolControllerLayer } from "../../workflow/protocols/planned-attempt-executor-work/protocol-controller.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { DeliveryProposalOrdinal, DeliveryProposalId, trackerGraphReadProposalOf } from "./delivery-proposal.js"
import {
  interruptibleBoundaryOf,
  DeliveryActionExecutor,
  DeliverySemanticTrace,
  type DeliveryActionResult
} from "./delivery-action-executor.js"
import { deliveryRuntime } from "./delivery-runtime-adapter.js"
import { deterministicDeliveryRuntimeSupport, makeDeliveryRelationsLayer } from "./in-memory-relations.js"
import {
  currentSignalOf,
  currentSignalFromCurrentFirstStream,
  TrackerGraphState,
  type DeliveryRelationInputBundle,
  type DeliveryRuntimeEvaluation,
  type DeliveryActionProposal
} from "./relations.js"
import {
  runDeliveryRuntime,
  runDeliveryRuntimePhase,
  DeliveryRuntimePhase,
  type DeliveryRuntimeInput
} from "./run-delivery-runtime.js"
import {
  deliveryRuntimeResourceCapabilitiesOf,
  deliveryRuntimeResourceCapabilitiesLayer,
  DeliveryRuntimeResources,
  deliveryRuntimeResourcesLayer
} from "./delivery-runtime-resources.js"
import { makeApplicationExitLifecycle } from "../application-exit/lifecycle.js"
import { DeliveryRuntimeObservationObserver } from "./delivery-runtime-observation.js"
import { DeliveryAcceptedFactPublication } from "./delivery-accepted-fact-publication.js"
import {
  makePreparedBeginFixture,
  preparedBeginProposalsOf as derivePreparedBeginProposals
} from "../../../test/support/prepared-begin-proposal.js"

// Controlled facts use production relation evaluation and resource/admission Layers.
// Queue capacity is deliberately not an oracle: these cases qualify the unbounded Base too.
// Contract: docs/scenarios/bounded-runtime-mailbox.md.
// S2 preservation: identities, pending ownership, exact outcomes and causal successor.
// S3: direct attachment and queued failure, preceding evaluations and rollback.
// S4: held-consumer handoffs, pending acknowledgement, fresh intent dispositions,
//     subscription/action shutdown and existing application Exit cutoff.
// S5: ordinary admission/successor/passive quiescence and newer-publication capacity wait.
// Join owns S2 bound and the capacity-dependent S3/S4 suspended-offer witnesses;
// S1 capacity/FIFO and the old-unbounded negative control belong to implementation/join.
const runId = RunId.make("mailbox-preservation-run")
const target = FixtureTarget.make("mailbox-preservation-target")
const policy = RunControlPolicy.make({
  revision: initialRunPolicyRevision,
  taskExecutionCapacity: TaskWorkCapacity.make(2)
})
const plannerLayer = deterministicPlannedTaskAttemptLayer({
  baseSha: GitCommitSha.make("1".repeat(40)),
  executor: TaskExecutorLocator.make("executor:preservation"),
  runId,
  worktreeRoot: WorktreeLocator.make("/preservation")
})
const testDeliveryRuntimeResourcesLayer = Layer.unwrap(
  makeApplicationExitLifecycle().pipe(Effect.map(({ admission }) => deliveryRuntimeResourcesLayer(admission)))
)
const identityLayers = Layer.mergeAll(
  plannerLayer,
  deterministicOperationIdAllocatorLayer("preservation-operation"),
  plannedAttemptProtocolControllerLayer,
  testDeliveryRuntimeResourcesLayer
)
const proposal = (ordinal: number, taskId: TaskId): DeliveryActionProposal => ({
  ...trackerGraphReadProposalOf({
    acceptedAt: JournalPosition.make(ordinal + 1),
    purpose: "EstablishCurrentGraph",
    runId,
    target
  }),
  admission: {
    integrationTarget: { _tag: "NoIntegrationTargetResource" },
    plannedAttemptProtocol: { _tag: "NoPlannedAttemptProtocol" },
    taskWorkPosition: { _tag: "TaskWorkPositionRequired", mode: "ReserveOrReuse", taskId }
  },
  id: DeliveryProposalId.make(`preservation:${ordinal}:${taskId}`),
  order: {
    _tag: "FreshWorkflowOrder",
    frontierOrdinal: DeliveryProposalOrdinal.make(ordinal),
    step: "ReadCurrentTaskGraph",
    taskId
  },
  owner: "TicketDelivery"
})
const runDeliveryRuntimeQuiescence = <E>(
  relation: DeliveryRuntimeInput<E>,
  publication: DeliveryAcceptedFactPublication["Service"]
) => runDeliveryRuntime(runId, relation).pipe(Effect.provideService(DeliveryAcceptedFactPublication, publication))
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
          publication: { exactEvidence: [], graph: TrackerGraphState.cases.GraphNotEstablished.make({}), policy }
        } satisfies DeliveryRelationInputBundle)
      })
    )
  )
  return Option.getOrThrow(yield* relation.changes.pipe(Stream.runHead))
})

const dynamicEvaluationSignal = Effect.fn("Test.dynamicEvaluationSignal")(function* (
  initial: DeliveryRuntimeEvaluation,
  onPublish?: (current: DeliveryRuntimeEvaluation, next: DeliveryRuntimeEvaluation) => DeliveryRuntimeEvaluation
) {
  const state = yield* SubscriptionRef.make(initial)
  const signal = currentSignalFromCurrentFirstStream(SubscriptionRef.changes(state))
  return {
    ...signal,
    publish: (evaluation: DeliveryRuntimeEvaluation) =>
      SubscriptionRef.modify(state, (current) => {
        const next = onPublish === undefined ? evaluation : onPublish(current, evaluation)
        return [undefined, next] as const
      })
  } satisfies DeliveryRuntimeInput<never> & {
    readonly publish: (evaluation: DeliveryRuntimeEvaluation) => Effect.Effect<void>
  }
})

const withProposals = (
  evaluation: DeliveryRuntimeEvaluation,
  proposals: ReadonlyArray<DeliveryActionProposal>,
  capacity = 2
): DeliveryRuntimeEvaluation => ({
  ...evaluation,
  proposedActions: { _tag: "DeliveryProposalsAvailable", freshTaskCandidates: [], isolatedIssues: [], proposals },
  quiescence: { _tag: "QuiescencePassive", reason: "RunPaused" },
  taskWork: makeFreshTaskAdmissionTestBasis({ capacity: TaskWorkCapacity.make(capacity), runId })
})

it.effect("S2/S5: distinct completions retain owners until publication, settle once, then admit the successor", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const first = proposal(0, TaskId.make("preservation-A"))
      const second = proposal(1, TaskId.make("preservation-B"))
      const firstOperation = OperationId.make("preservation-first-operation")
      const successor = { ...proposal(2, TaskId.make("preservation-C")), waitsForLiveOperationId: firstOperation }
      const base = yield* baseEvaluation
      const initial = {
        ...withProposals(base, [first, second]),
        acceptedAt: JournalPosition.make(10),
        current: { ...base.current, runId }
      }
      const relation = yield* dynamicEvaluationSignal(initial)
      const started = yield* Queue.unbounded<DeliveryProposalId>()
      const pending = yield* Queue.unbounded<DeliveryProposalId>()
      const releaseFirst = yield* Deferred.make<void>()
      const releaseSecond = yield* Deferred.make<void>()
      const successorVisible = yield* Deferred.make<void>()
      const finishSuccessor = yield* Deferred.make<void>()
      const children = yield* Ref.make<ReadonlyMap<DeliveryProposalId, Fiber.Fiber<unknown, unknown>>>(new Map())
      const calls = yield* Ref.make<ReadonlyArray<DeliveryProposalId>>([])
      const outcomes = yield* Ref.make<ReadonlyArray<DeliveryActionResult>>([])
      const firstResult: DeliveryActionResult = { _tag: "ActionCompleted", proposalId: first.id }
      const secondResult: DeliveryActionResult = { _tag: "ActionCompleted", proposalId: second.id }
      const successorResult: DeliveryActionResult = { _tag: "ActionCompleted", proposalId: successor.id }
      const runtime = yield* runDeliveryRuntimeQuiescence(relation, {
        awaitCurrent: Effect.succeed({
          _tag: "DeliveryAcceptedPublicationBoundary",
          acceptedThrough: JournalPosition.make(12),
          runId
        })
      }).pipe(
        Effect.provideService(DeliveryActionExecutor, {
          execute: ({ proposal: action }) =>
            Effect.gen(function* () {
              yield* Effect.withFiber((fiber) =>
                Ref.update(children, (current) => new Map(current).set(action.id, fiber))
              )
              yield* Ref.update(calls, (ids) => [...ids, action.id])
              yield* Queue.offer(started, action.id)
              if (action.id === first.id) {
                yield* Deferred.await(releaseFirst)
                return firstResult
              }
              if (action.id === second.id) {
                yield* Deferred.await(releaseSecond)
                return secondResult
              }
              expect(action.id).toBe(successor.id)
              yield* Deferred.await(finishSuccessor)
              expect(yield* Ref.get(outcomes)).toEqual([secondResult, firstResult])
              yield* relation.publish({ ...withProposals(initial, []), acceptedAt: JournalPosition.make(13) })
              return successorResult
            })
        }),
        Effect.provideService(DeliverySemanticTrace, {
          emit: (event) =>
            event._tag === "ActionCompletionPublicationPending"
              ? Queue.offer(pending, event.proposalId)
              : event._tag === "ActionOutcome"
                ? Ref.update(outcomes, (items) => [...items, event.result])
                : Effect.void
        }),
        Effect.provide(identityLayers),
        Effect.provideService(OperationIdAllocator, {
          allocate: () =>
            Ref.get(calls).pipe(
              Effect.map((ids) =>
                ids.length === 0 ? firstOperation : OperationId.make(`preservation-other-${ids.length}`)
              )
            )
        }),
        Effect.provideService(DeliveryRuntimeObservationObserver, {
          observe: ({ evaluation, liveOwners }) => {
            if (evaluation.acceptedAt !== JournalPosition.make(11)) return Effect.void
            expect(liveOwners.map(({ proposal }) => proposal.id).sort()).toEqual([first.id, second.id].sort())
            return Deferred.succeed(successorVisible, undefined)
          }
        }),
        Effect.forkChild
      )
      expect([yield* Queue.take(started), yield* Queue.take(started)].sort()).toEqual([first.id, second.id].sort())
      // Authored causal order is B then A; no order is imposed on independent admission.
      yield* Deferred.succeed(releaseSecond, undefined)
      expect(yield* Queue.take(pending)).toBe(second.id)
      yield* Deferred.succeed(releaseFirst, undefined)
      expect(yield* Queue.take(pending)).toBe(first.id)
      yield* relation.publish({ ...withProposals(initial, [successor]), acceptedAt: JournalPosition.make(11) })
      yield* Deferred.await(successorVisible)
      expect(yield* Ref.get(outcomes)).toEqual([])
      expect(yield* Ref.get(calls)).toHaveLength(2)
      expect(runtime.pollUnsafe()).toBeUndefined()
      yield* relation.publish({ ...withProposals(initial, [successor]), acceptedAt: JournalPosition.make(12) })
      expect(yield* Queue.take(started)).toBe(successor.id)
      // Keep the successor live so phase closure cannot hide a missing ACK by
      // interrupting stranded predecessors. Both original children must exit
      // successfully through their actual acknowledgement wait first.
      const predecessorChildren = yield* Ref.get(children)
      for (const id of [first.id, second.id]) {
        const child = Option.getOrThrow(Option.fromUndefinedOr(predecessorChildren.get(id)))
        expect((yield* Fiber.await(child))._tag).toBe("Success")
      }
      yield* Deferred.succeed(finishSuccessor, undefined)
      expect(yield* Fiber.join(runtime)).toMatchObject({
        _tag: "PassiveRuntimeQuiescence",
        acceptedAt: JournalPosition.make(13)
      })
      expect(yield* Ref.get(calls)).toHaveLength(3)
      const results = yield* Ref.get(outcomes)
      expect(results).toEqual([secondResult, firstResult, successorResult])
      expect(results[0]).toBe(secondResult)
      expect(results[1]).toBe(firstResult)
    })
  )
)

// An entered pending-completion trace proves the child has handed off its exact
// result and is waiting for acknowledgement; executor return alone cannot prove it.
it.effect("S3/S4: relation failure or phase cancellation abandons a pending completion without an outcome", () =>
  Effect.forEach(
    ["RelationFailure", "Cancellation"] as const,
    (cut) =>
      Effect.scoped(
        Effect.gen(function* () {
          const action = proposal(0, TaskId.make(`pending-${cut}`))
          const base = yield* baseEvaluation
          const initial = {
            ...withProposals(base, [action], 1),
            acceptedAt: JournalPosition.make(20),
            current: { ...base.current, runId }
          }
          const failure = { _tag: "AuthoredRelationFailure" as const, cut }
          const cause = Cause.fail(failure)
          const failRelation = yield* Deferred.make<never, typeof failure>()
          const subscribed = yield* Deferred.make<void>()
          const stopped = yield* Deferred.make<void>()
          const relation = currentSignalFromCurrentFirstStream(
            Stream.concat(
              Stream.make(initial),
              Stream.fromEffect(
                Deferred.succeed(subscribed, undefined).pipe(Effect.andThen(Deferred.await(failRelation)))
              )
            ).pipe(Stream.ensuring(Deferred.succeed(stopped, undefined)))
          )
          const pending = yield* Deferred.make<void>()
          const childHandle = yield* Deferred.make<Fiber.Fiber<unknown, unknown>>()
          const outcomes = yield* Ref.make<ReadonlyArray<DeliveryActionResult>>([])
          const runtime = yield* runDeliveryRuntimeQuiescence(relation, {
            awaitCurrent: Effect.succeed({
              _tag: "DeliveryAcceptedPublicationBoundary",
              acceptedThrough: JournalPosition.make(21),
              runId
            })
          }).pipe(
            Effect.provideService(DeliveryActionExecutor, {
              execute: ({ proposal }) =>
                Effect.withFiber((fiber) => Deferred.succeed(childHandle, fiber)).pipe(
                  Effect.as({ _tag: "ActionCompleted", proposalId: proposal.id } as const)
                )
            }),
            Effect.provideService(DeliverySemanticTrace, {
              emit: (event) =>
                event._tag === "ActionCompletionPublicationPending"
                  ? Deferred.succeed(pending, undefined)
                  : event._tag === "ActionOutcome"
                    ? Ref.update(outcomes, (items) => [...items, event.result])
                    : Effect.void
            }),
            Effect.forkChild
          )
          yield* Deferred.await(subscribed)
          yield* Deferred.await(pending)
          const resources = yield* DeliveryRuntimeResources
          const before = yield* resources.runtimeObservation.get
          expect(before._tag).toBe("Ready")
          if (before._tag !== "Ready") return yield* Effect.die("owner must be visible")
          expect(before.liveOwners.map(({ proposal }) => proposal.id)).toEqual([action.id])
          if (cut === "RelationFailure") {
            yield* Deferred.failCause(failRelation, cause)
            const exit = yield* Fiber.await(runtime)
            expect(exit._tag).toBe("Failure")
            if (exit._tag !== "Failure") return yield* Effect.die("relation failure must fail the phase")
            expect(exit.cause.reasons.map((reason) => reason._tag)).toEqual(cause.reasons.map((reason) => reason._tag))
            expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))).toBe(failure)
          } else {
            yield* Fiber.interrupt(runtime)
          }
          yield* Deferred.await(stopped)
          const childExit = yield* Fiber.await(yield* Deferred.await(childHandle))
          expect(childExit._tag).toBe("Failure")
          if (childExit._tag !== "Failure")
            return yield* Effect.die("abandoned completion must not acknowledge success")
          expect(Cause.hasInterrupts(childExit.cause)).toBe(true)
          const after = yield* resources.runtimeObservation.get
          expect(after._tag).toBe("Closed")
          if (after._tag !== "Closed") return yield* Effect.die("phase must close observation")
          expect(after.final?.liveOwners).toEqual([])
          expect(yield* Ref.get(outcomes)).toEqual([])
        })
      ).pipe(Effect.provide(identityLayers)),
    { discard: true }
  )
)

it.effect(
  "S3/S4: a held consumer preserves preceding occurrences and stops live producers on failure or cancellation",
  () =>
    Effect.forEach(
      ["Failure", "CancelBeforeIntent", "CancelAfterIntent", "CancelCompletionHandoff"] as const,
      (cut) =>
        Effect.scoped(
          Effect.gen(function* () {
            const base = yield* baseEvaluation
            const owner = proposal(0, TaskId.make(`held-${cut}`))
            const initial = {
              ...withProposals(base, [owner], 1),
              acceptedAt: JournalPosition.make(30),
              current: { ...base.current, runId }
            }
            const held = { ...initial, acceptedAt: JournalPosition.make(31) }
            const queued = { ...initial, acceptedAt: JournalPosition.make(32) }
            const startChanges = yield* Deferred.make<void>()
            const consumerHeld = yield* Deferred.make<void>()
            const releaseConsumer = yield* Deferred.make<void>()
            const failureEntered = yield* Deferred.make<void>()
            const subscriberStopped = yield* Deferred.make<void>()
            const executorStarted = yield* Deferred.make<void>()
            const executorStopped = yield* Deferred.make<void>()
            const finishAction = yield* Deferred.make<void>()
            const publicationEntered = yield* Deferred.make<void>()
            const failure = { _tag: "HeldConsumerRelationFailure" as const }
            const changes = Stream.fromEffect(Deferred.await(startChanges)).pipe(
              Stream.flatMap(() =>
                Stream.concat(
                  Stream.make(held, queued),
                  Stream.fromEffect(
                    Deferred.succeed(failureEntered, undefined).pipe(Effect.andThen(Effect.fail(failure)))
                  )
                )
              )
            )
            const relation = currentSignalFromCurrentFirstStream(
              Stream.concat(Stream.make(initial), changes).pipe(
                Stream.ensuring(Deferred.succeed(subscriberStopped, undefined))
              )
            )
            const outcomes = yield* Ref.make<ReadonlyArray<DeliveryActionResult>>([])
            const applied = yield* Ref.make<ReadonlyArray<JournalPosition | null>>([])
            const heldOnce = yield* Ref.make(false)
            const runtimeResources = yield* Deferred.make<DeliveryRuntimeResources["Service"]>()
            const runtime = yield* Effect.gen(function* () {
              yield* Deferred.succeed(runtimeResources, yield* DeliveryRuntimeResources)
              return yield* runDeliveryRuntimeQuiescence(relation, {
                awaitCurrent: Deferred.succeed(publicationEntered, undefined).pipe(
                  Effect.as({
                    _tag: "DeliveryAcceptedPublicationBoundary" as const,
                    acceptedThrough: JournalPosition.make(33),
                    runId
                  })
                )
              })
            }).pipe(
              Effect.provideService(DeliveryActionExecutor, {
                execute: (action, lease) =>
                  Effect.gen(function* () {
                    if (cut === "CancelAfterIntent") {
                      if (!("operationId" in action))
                        return yield* Effect.die("authored graph read must materialize an operation")
                      yield* lease.recordIntent(action.operationId)
                    }
                    yield* Deferred.succeed(executorStarted, undefined)
                    yield* Deferred.await(finishAction)
                    return { _tag: "ActionCompleted", proposalId: action.proposal.id } as const
                  }).pipe(Effect.ensuring(Deferred.succeed(executorStopped, undefined)))
              }),
              Effect.provideService(DeliverySemanticTrace, {
                emit: (event) =>
                  event._tag === "ActionOutcome"
                    ? Ref.update(outcomes, (items) => [...items, event.result])
                    : Effect.void
              }),
              Effect.provide(identityLayers),
              Effect.provideService(DeliveryRuntimeObservationObserver, {
                observe: ({ evaluation, liveOwners }) =>
                  Effect.gen(function* () {
                    yield* Ref.update(applied, (positions) => [...positions, evaluation.acceptedAt])
                    if (evaluation.acceptedAt !== held.acceptedAt || (yield* Ref.getAndSet(heldOnce, true))) return
                    expect(liveOwners.map(({ proposal }) => proposal.id)).toEqual([owner.id])
                    if (cut === "CancelAfterIntent") {
                      expect(liveOwners[0]).toMatchObject({
                        _tag: "MaterializedDeliveryAction",
                        intent: "IntentRecorded"
                      })
                    }
                    yield* Deferred.succeed(consumerHeld, undefined)
                    yield* Deferred.await(releaseConsumer)
                  })
              }),
              Effect.forkChild
            )
            yield* Deferred.await(executorStarted)
            yield* Deferred.succeed(startChanges, undefined)
            yield* Deferred.await(consumerHeld)
            // The relation has offered the preceding evaluation before entering failure.
            // Its failure offer can be suspended in the bounded candidate, but this
            // independent branch does not assert that new capacity-specific fact.
            yield* Deferred.await(failureEntered)
            if (cut === "CancelCompletionHandoff") {
              yield* Deferred.succeed(finishAction, undefined)
              yield* Deferred.await(publicationEntered)
              yield* Deferred.await(executorStopped)
            }
            if (cut === "Failure") {
              yield* Deferred.succeed(releaseConsumer, undefined)
              expect(yield* Effect.flip(Fiber.join(runtime))).toBe(failure)
              const positions = yield* Ref.get(applied)
              expect(positions.indexOf(held.acceptedAt)).toBeLessThan(positions.indexOf(queued.acceptedAt))
            } else {
              // Interruption releases the consumer's selection permit before rollback.
              yield* Fiber.interrupt(runtime)
            }
            yield* Deferred.await(executorStopped)
            yield* Deferred.await(subscriberStopped)
            expect(yield* Ref.get(outcomes)).toEqual([])
            const resources = yield* Deferred.await(runtimeResources)
            const observation = yield* resources.runtimeObservation.get
            expect(observation._tag).toBe("Closed")
            if (observation._tag !== "Closed") return yield* Effect.die("shutdown must close observation")
            expect(observation.final?.liveOwners).toEqual([])
            expect(yield* resources.integrationTargets.snapshot).toEqual({
              activeResponsibilities: [],
              heldResponsibilities: []
            })
          })
        ),
      { discard: true }
    )
)
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("preservation-attempt"),
  baseSha: GitCommitSha.make("2".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/preservation"),
  executor: TaskExecutorLocator.make("executor:preservation"),
  runId,
  taskId: TaskId.make("runtime-recovered-task"),
  taskRevision: TaskRevision.make("preservation-revision"),
  worktree: WorktreeLocator.make("/preservation/recovered")
})

const preparedAttemptFixture = (name: string) => makePreparedBeginFixture(plannedAttempt, "preservation-capacity", name)
const preparedBeginProposalsOf = (fixtures: ReadonlyArray<ReturnType<typeof preparedAttemptFixture>>) =>
  derivePreparedBeginProposals(runId, fixtures)
it.effect("S5: a newer accepted capacity publication admits its ordinary read before exact quiescence", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const base = yield* baseEvaluation
      const [blocked] = preparedBeginProposalsOf([preparedAttemptFixture("accepted-control-blocked")])
      if (blocked === undefined) return yield* Effect.die("prepared attempt must produce Begin")
      const acceptedControl = JournalPosition.make(2)
      const acceptedRead = JournalPosition.make(3)
      const boundary = { runId, attemptId: plannedAttempt.attemptId }
      const initial = {
        ...withProposals(base, [blocked], 1),
        acceptedAt: JournalPosition.make(1),
        activeRefreshBoundary: { _tag: "ActiveRefreshRuntimeBoundary" as const, runId, reconciledAttempts: [boundary] },
        taskWork: makeFreshTaskAdmissionTestBasis({
          capacity: TaskWorkCapacity.make(1),
          held: [preparedAttemptFixture("accepted-control-held").attempt]
        })
      } satisfies DeliveryRuntimeEvaluation
      const read = trackerGraphReadProposalOf({
        acceptedAt: acceptedControl,
        purpose: "EstablishCurrentGraph",
        runId,
        target
      })
      const relation = yield* dynamicEvaluationSignal(initial)
      const freshnessCuts = yield* Ref.make<ReadonlyArray<JournalPosition>>([])
      const durablePosition = yield* Ref.make(acceptedControl)
      const firstCut = yield* Deferred.make<void>()
      const publishAcceptedControl = yield* Deferred.make<void>()
      const executed = yield* Ref.make<ReadonlyArray<DeliveryProposalId>>([])
      const publication = DeliveryAcceptedFactPublication.of({
        awaitCurrent: Effect.gen(function* () {
          // Capture the durable prefix before awaiting its projection, as the
          // production publication boundary does; no future fact is required.
          const acceptedThrough = yield* Ref.get(durablePosition)
          yield* Ref.update(freshnessCuts, (cuts) => [...cuts, acceptedThrough])
          yield* Deferred.succeed(firstCut, undefined)
          yield* Deferred.await(publishAcceptedControl)
          return { _tag: "DeliveryAcceptedPublicationBoundary", acceptedThrough, runId } as const
        })
      })
      const runtime = yield* runDeliveryRuntimePhase(
        runId,
        relation,
        DeliveryRuntimePhase.ActiveRefreshPostG2([boundary])
      ).pipe(
        Effect.provideService(DeliveryAcceptedFactPublication, publication),
        Effect.provide(identityLayers),
        Effect.provideService(
          DeliveryActionExecutor,
          DeliveryActionExecutor.of({
            execute: ({ proposal }) =>
              Effect.gen(function* () {
                expect(proposal.id).toBe(read.id)
                yield* Ref.update(executed, (ids) => [...ids, proposal.id])
                yield* Ref.set(durablePosition, acceptedRead)
                yield* relation.publish({ ...initial, acceptedAt: acceptedRead })
                return { _tag: "ActionCompleted", proposalId: proposal.id } satisfies DeliveryActionResult
              })
          })
        ),
        Effect.forkChild
      )
      yield* Deferred.await(firstCut)
      expect(runtime.pollUnsafe()).toBeUndefined()
      expect(yield* Ref.get(executed)).toEqual([])
      yield* relation.publish({
        ...initial,
        acceptedAt: acceptedControl,
        proposedActions: {
          _tag: "DeliveryProposalsAvailable",
          freshTaskCandidates: [],
          isolatedIssues: [],
          proposals: [blocked, read]
        }
      })
      yield* Deferred.succeed(publishAcceptedControl, undefined)
      const result = yield* Fiber.join(runtime)
      expect(result._tag).toBe("TaskWorkAdmissionStalledRuntimeQuiescence")
      expect(result.acceptedAt).toBe(acceptedRead)
      expect(result.proposedActions.proposals).toEqual([blocked])
      expect(yield* Ref.get(executed)).toEqual([read.id])
      // One stale-return cut, one action-completion cut, one final current cut.
      expect(yield* Ref.get(freshnessCuts)).toEqual([acceptedControl, acceptedRead, acceptedRead])
    })
  )
)

it.effect("S3: attachment failure preserves the exact cause and admits no action", () =>
  Effect.gen(function* () {
    const failure = { _tag: "AuthoredAttachmentFailure" as const }
    const executions = yield* Ref.make(0)
    const exit = yield* Effect.exit(
      runDeliveryRuntimePhase(runId, currentSignalFromCurrentFirstStream(Stream.fail(failure))).pipe(
        Effect.provide(identityLayers),
        Effect.provideService(DeliveryAcceptedFactPublication, {
          awaitCurrent: Effect.die("attachment must fail before publication")
        }),
        Effect.provideService(DeliveryActionExecutor, {
          execute: () =>
            Ref.update(executions, (count) => count + 1).pipe(
              Effect.andThen(Effect.die("attachment must fail before admission"))
            )
        })
      )
    )
    expect(exit._tag).toBe("Failure")
    if (exit._tag !== "Failure") return yield* Effect.die("attachment must fail")
    expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))).toBe(failure)
    expect(yield* Ref.get(executions)).toBe(0)
  })
)

it.effect("S4: application Exit interrupts the registered authority wait and forbids successor admission", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const base = yield* baseEvaluation
      const owner = proposal(0, TaskId.make("exit-owner"))
      const successor = proposal(1, TaskId.make("exit-successor"))
      const relationStopped = yield* Deferred.make<void>()
      const relation = currentSignalFromCurrentFirstStream(
        Stream.concat(Stream.make(withProposals(base, [owner, successor], 1)), Stream.never).pipe(
          Stream.ensuring(Deferred.succeed(relationStopped, undefined))
        )
      )
      const lifecycle = yield* makeApplicationExitLifecycle()
      const capabilities = yield* deliveryRuntimeResourceCapabilitiesOf(
        yield* makeIntegrationTargetResourceController(),
        lifecycle.admission
      )
      const operationId = OperationId.make("preservation-exit-operation")
      const waiting = yield* Deferred.make<void>()
      const stopped = yield* Deferred.make<void>()
      const calls = yield* Ref.make<ReadonlyArray<DeliveryProposalId>>([])
      const outcomes = yield* Ref.make<ReadonlyArray<DeliveryActionResult>>([])
      const runtime = yield* runDeliveryRuntimeQuiescence(relation, {
        awaitCurrent: Effect.die("interrupted authority wait cannot publish success")
      }).pipe(
        Effect.provide(plannerLayer),
        Effect.provide(plannedAttemptProtocolControllerLayer),
        Effect.provide(deliveryRuntimeResourceCapabilitiesLayer(capabilities)),
        Effect.provideService(OperationIdAllocator, { allocate: () => Effect.succeed(operationId) }),
        Effect.provideService(DeliverySemanticTrace, {
          emit: (event) =>
            event._tag === "ActionOutcome" ? Ref.update(outcomes, (items) => [...items, event.result]) : Effect.void
        }),
        Effect.provideService(DeliveryActionExecutor, {
          execute: (action, lease) =>
            Effect.gen(function* () {
              yield* Ref.update(calls, (ids) => [...ids, action.proposal.id])
              expect(action.proposal.id).toBe(owner.id)
              yield* lease.recordIntent(operationId)
              return yield* interruptibleBoundaryOf(lease).run(
                InterruptibleWorkflowBoundaryIntent.AuthorityRequest({ family: "TaskTracker", operationId }),
                Deferred.succeed(waiting, undefined).pipe(
                  Effect.andThen(Effect.never),
                  Effect.onInterrupt(() => Deferred.succeed(stopped, undefined))
                ),
                () => Effect.die("Exit cannot fabricate an authority result")
              )
            })
        }),
        Effect.forkChild
      )
      yield* Deferred.await(waiting)
      yield* lifecycle.requestExit
      yield* Deferred.await(stopped)
      expect((yield* Fiber.await(runtime))._tag).toBe("Failure")
      yield* lifecycle.awaitForwardOwnersReleased
      yield* Deferred.await(relationStopped)
      expect(yield* lifecycle.admission.snapshot).toEqual({
        cutoffClosed: true,
        preparingOwnerCount: 0,
        registeredOwnerCount: 0
      })
      expect(yield* Ref.get(calls)).toEqual([owner.id])
      expect(yield* Ref.get(outcomes)).toEqual([])
      const observation = yield* capabilities.resources.runtimeObservation.get
      expect(observation._tag).toBe("Closed")
      if (observation._tag !== "Closed") return yield* Effect.die("Exit must close observation")
      expect(observation.final?.liveOwners).toEqual([])
    })
  )
)

const freshClaimFacts = Effect.fn("MailboxPreservation.freshClaimFacts")(function* (task: Task) {
  const projected = projectTrackerSnapshot({ revision: "preservation-graph", tasks: [task] })
  if (projected._tag !== "Valid") return yield* Effect.die("authored graph must be valid")
  const graphOperationId = OperationId.make("preservation-current-graph")
  const focusedOperationId = OperationId.make("preservation-focused-graph")
  const began = makeWorkflowRunBeganRecord(
    runId,
    target,
    InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }),
    remotePublicationTargetForTest,
    AttemptBasePolicy.cases.ExplicitFixedBase.make({ baseSha: GitCommitSha.make("1".repeat(40)) })
  )
  const records: ReadonlyArray<JournalRecord> = [
    began,
    ...[graphOperationId, focusedOperationId].flatMap((operationId, index) => {
      const operation = makeTrackerGraphObservationOperation(
        { _tag: "WorkflowEstablishment" },
        operationId,
        target,
        [],
        index === 0 ? [] : [task.id]
      )
      return [
        {
          event: taskTrackerReadIntent(operation),
          key: intentRecordKey(operationId),
          position: JournalPosition.make(2 + index * 2),
          runId
        },
        {
          event: taskTrackerFactsObservedEvent(
            operationId,
            makeCompleteTaskTrackerFactsObserved(operation, projected.snapshot)
          ),
          key: outcomeRecordKey(operationId),
          position: JournalPosition.make(3 + index * 2),
          runId
        }
      ]
    })
  ]
  const { frontier } = yield* deriveFreshTaskCandidateEvaluation({
    acceptedAt: JournalPosition.make(5),
    activeRefreshBoundaryReached: false,
    frame: {
      acceptedAt: JournalPosition.make(5),
      currentGraph: projected.snapshot,
      currentGraphOperationId: graphOperationId,
      pause: { run: { _tag: "RunUnpaused" }, tasks: { _tag: "NoTaskPauses" } },
      responsibility: { entries: [] },
      runId,
      runControlPolicy: policy,
      workflowHistory: { evidence: journalEvidenceFrom(records) }
    },
    opportunity: RunActivationOpportunity.OrdinaryRunEntry(),
    recoveredAttemptIds: new Set(),
    unsettledIntegrationTaskIds: new Set(),
    runId,
    target
  })
  expect(frontier.candidates.map(({ decision }) => decision.step._tag)).toEqual(["AcquireTaskClaim"])
  return { frontier, records, focusedOperationId }
})

it.effect(
  "S4: fresh claim cancellation releases before-intent admission and retains recorded-intent responsibility",
  () =>
    Effect.forEach(
      [false, true],
      (recordIntent) =>
        Effect.scoped(
          Effect.gen(function* () {
            const taskId = TaskId.make(`fresh-cancellation-${recordIntent}`)
            const task: Task = {
              id: taskId,
              lifecycle: TaskLifecycle.cases.Open.make({}),
              parentTaskId: null,
              prerequisiteIds: []
            }
            const { focusedOperationId, frontier, records } = yield* freshClaimFacts(task)
            const journal = Context.get(
              yield* Layer.build(memoryJournalTestLayerFromPartitionRecords({ hot: records })),
              InRunJournal
            )
            const base = yield* baseEvaluation
            const evaluation: DeliveryRuntimeEvaluation = {
              ...withProposals(base, [], 1),
              acceptedAt: JournalPosition.make(5),
              taskWork: makeFreshTaskAdmissionTestBasis({
                acceptedAt: JournalPosition.make(5),
                capacity: TaskWorkCapacity.make(1),
                runId
              }),
              proposedActions: {
                _tag: "DeliveryProposalsAvailable",
                freshTaskCandidateFrontier: frontier,
                freshTaskCandidates: frontier.candidates,
                isolatedIssues: [],
                proposals: []
              }
            }
            const relation = yield* dynamicEvaluationSignal(evaluation)
            const lifecycle = yield* makeApplicationExitLifecycle()
            const capabilities = yield* deliveryRuntimeResourceCapabilitiesOf(
              yield* makeIntegrationTargetResourceController(),
              lifecycle.admission
            )
            const started = yield* Deferred.make<void>()
            const stopped = yield* Deferred.make<void>()
            const operationId = OperationId.make(`preservation-claim-${recordIntent}`)
            const outcomes = yield* Ref.make<ReadonlyArray<DeliveryActionResult>>([])
            const runtime = yield* runDeliveryRuntimeQuiescence(relation, {
              awaitCurrent: Effect.die("cancelled claim cannot publish success")
            }).pipe(
              Effect.provide(plannerLayer),
              Effect.provide(plannedAttemptProtocolControllerLayer),
              Effect.provide(
                deterministicTaskClaimAcquisitionPlannerLayer({
                  owner: ClaimOwner.make("preservation-owner"),
                  tokenPrefix: "preservation-token"
                })
              ),
              Effect.provide(deliveryRuntimeResourceCapabilitiesLayer(capabilities)),
              Effect.provideService(OperationIdAllocator, { allocate: () => Effect.succeed(operationId) }),
              Effect.provideService(DeliverySemanticTrace, {
                emit: (event) =>
                  event._tag === "ActionOutcome"
                    ? Ref.update(outcomes, (items) => [...items, event.result])
                    : Effect.void
              }),
              Effect.provideService(DeliveryActionExecutor, {
                execute: (action, lease) =>
                  Effect.gen(function* () {
                    expect(action.proposal.order).toMatchObject({ taskId })
                    expect(action).toMatchObject({ _tag: "FreshOperationAction", operationId })
                    if (recordIntent) {
                      const operation = makeTaskClaimAcquisitionOperation({
                        acquisition: TaskClaimAcquisition.make({
                          operationId,
                          taskId,
                          owner: ClaimOwner.make("preservation-owner"),
                          token: ClaimToken.make("preservation-exact-token")
                        }),
                        predecessorOperationIds: [focusedOperationId]
                      })
                      yield* journal.append(
                        runId,
                        intentRecordKey(operationId),
                        TaskClaimAcquisitionIntendedEvent.make({ operation, version: workflowJournalEventVersion })
                      )
                      yield* lease.recordIntent(operationId)
                    }
                    yield* Deferred.succeed(started, undefined)
                    return yield* Deferred.await(stopped).pipe(
                      Effect.andThen(Effect.die("coordinator never completes the authority call"))
                    )
                  }).pipe(Effect.onInterrupt(() => Deferred.succeed(stopped, undefined)))
              }),
              Effect.forkChild
            )
            yield* Deferred.await(started)
            const admission = yield* capabilities.resources.makeAdmissionController(evaluation.taskWork)
            expect((yield* admission.snapshot).positions.size).toBe(1)
            yield* Fiber.interrupt(runtime)
            yield* Deferred.await(stopped)
            const snapshot = yield* admission.snapshot
            if (recordIntent) {
              expect(snapshot.positions.get(taskId)).toMatchObject({
                _tag: "FreshEntryRuntimePosition",
                activity: { _tag: "AwaitingDurableCommitment", claimOperationId: operationId }
              })
              expect(
                (yield* journal.read(runId)).filter(({ event }) => event._tag === "TaskClaimAcquisitionIntended")
              ).toHaveLength(1)
            } else {
              expect(snapshot.positions.size).toBe(0)
              expect(yield* journal.read(runId)).toEqual(records)
            }
            expect(yield* Ref.get(outcomes)).toEqual([])
            expect(yield* lifecycle.admission.snapshot).toMatchObject({
              preparingOwnerCount: 0,
              registeredOwnerCount: 0
            })
          })
        ).pipe(Effect.provide(plannedAttemptProtocolControllerLayer)),
      { discard: true }
    )
)

it.effect("S5: accepted journal facts pass through production reactive publication before runtime quiescence", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const began = makeWorkflowRunBeganRecord(
        runId,
        target,
        InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }),
        remotePublicationTargetForTest,
        AttemptBasePolicy.cases.ExplicitFixedBase.make({ baseSha: GitCommitSha.make("1".repeat(40)) })
      )
      const journalContext = yield* Layer.build(liveJournalTestLayer({ records: [began], runId, target }))
      const journal = Context.get(journalContext, Journal)
      const lifecycle = yield* makeApplicationExitLifecycle()
      const capabilities = yield* deliveryRuntimeResourceCapabilitiesOf(
        yield* makeIntegrationTargetResourceController(),
        lifecycle.admission
      )
      const published = yield* Deferred.make<void>()
      const releasePublication = yield* Deferred.make<void>()
      const outcomes = yield* Ref.make<ReadonlyArray<DeliveryActionResult>>([])
      const calls = yield* Ref.make<ReadonlyArray<DeliveryProposalId>>([])
      const productionRelations = yield* makeReactiveDeliveryRelationsLayer(
        runId,
        target,
        journal,
        {
          readDeliveryProjection: journal.state.get.pipe(
            Effect.orDie,
            Effect.map((state) => ({
              evidence: {
                _tag: "AvailableDeliveryProjectionEvidence" as const,
                acceptedAt: state.position,
                facts: [],
                integrationWaits: []
              },
              frontier: { explanations: [], transitions: [] }
            }))
          ),
          reconstructedPlannedAttemptPositions: []
        },
        capabilities.resources.integrationTargets,
        began.position
      ).pipe(
        Effect.provideService(DeliveryRelationPublicationObserver, {
          observe: (bundle) =>
            bundle.actionInputs.runtimeFacts.acceptedAt === JournalPosition.make(3)
              ? Deferred.succeed(published, undefined).pipe(Effect.andThen(Deferred.await(releasePublication)))
              : Effect.void
        })
      )
      const runtime = yield* Effect.gen(function* () {
        const relation = yield* deliveryRuntime
        return yield* runDeliveryRuntime(runId, relation)
      }).pipe(
        Effect.provide(productionRelations),
        Effect.provide(plannerLayer),
        Effect.provide(plannedAttemptProtocolControllerLayer),
        Effect.provide(deliveryRuntimeResourceCapabilitiesLayer(capabilities)),
        Effect.provide(deterministicOperationIdAllocatorLayer("preservation-reactive-graph")),
        Effect.provideService(DeliverySemanticTrace, {
          emit: (event) =>
            event._tag === "ActionOutcome" ? Ref.update(outcomes, (items) => [...items, event.result]) : Effect.void
        }),
        Effect.provideService(DeliveryActionExecutor, {
          execute: (action, lease) =>
            Effect.gen(function* () {
              expect(action.proposal.order).toMatchObject({ _tag: "TrackerGraphOrder" })
              if (action._tag !== "FreshOperationAction")
                return yield* Effect.die("graph read must materialize its admitted operation")
              yield* Ref.update(calls, (ids) => [...ids, action.proposal.id])
              const operation = makeTrackerGraphObservationOperation(
                { _tag: "WorkflowEstablishment" },
                action.operationId,
                target
              )
              yield* journal.append(runId, intentRecordKey(action.operationId), taskTrackerReadIntent(operation))
              yield* lease.recordIntent(action.operationId)
              const graph = projectTrackerSnapshot({ revision: "preservation-empty-graph", tasks: [] })
              if (graph._tag === "Invalid") return yield* Effect.die("authored empty graph must be valid")
              yield* journal.append(
                runId,
                outcomeRecordKey(action.operationId),
                taskTrackerFactsObservedEvent(
                  action.operationId,
                  makeCompleteTaskTrackerFactsObserved(operation, graph.snapshot)
                )
              )
              return { _tag: "ActionCompleted", proposalId: action.proposal.id } as const
            })
        }),
        Effect.forkChild
      )
      yield* Deferred.await(published)
      expect(runtime.pollUnsafe()).toBeUndefined()
      expect(yield* Ref.get(outcomes)).toEqual([])
      const observation = yield* capabilities.resources.runtimeObservation.get
      expect(observation._tag).toBe("Ready")
      if (observation._tag !== "Ready") return yield* Effect.die("unpublished completion must retain its owner")
      expect(observation.liveOwners.map(({ proposal }) => proposal.id)).toEqual(yield* Ref.get(calls))
      yield* Deferred.succeed(releasePublication, undefined)
      const result = yield* Fiber.join(runtime)
      expect(result).toMatchObject({
        _tag: "TrackerReconfirmationQuiescence",
        acceptedAt: JournalPosition.make(3),
        proposedActions: { proposals: [] }
      })
      expect(yield* Ref.get(calls)).toHaveLength(1)
      expect((yield* Ref.get(outcomes)).map(({ proposalId }) => proposalId)).toEqual(yield* Ref.get(calls))
      expect((yield* journal.read(runId)).map(({ event }) => event._tag)).toEqual([
        "WorkflowRunBegan",
        "TaskTrackerReadIntentRecorded",
        "TaskTrackerFactsObserved"
      ])
    })
  )
)
