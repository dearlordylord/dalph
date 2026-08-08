import { it } from "@effect/vitest"
import {
  AttemptId,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { Deferred, Effect, Fiber, Layer, Option, Ref, Stream, SubscriptionRef } from "effect"
import { expect } from "vitest"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { projectTrackerSnapshot } from "../../authorities/task-tracker/graph.js"
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import { ActiveTaskClaim } from "../../authorities/task-tracker/claim-mutation.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { makeIntegrationTargetResourceController } from "../admission/integration-target-resource.js"
import { initialRunPolicyRevision, RunControlPolicy } from "../../control/policy.js"
import { IntegrationCandidateBoundaryUnavailable } from "./integration-candidate-boundary.js"
import {
  deterministicOperationIdAllocatorLayer,
  deterministicPlannedTaskAttemptLayer,
  OperationIdAllocator
} from "../../workflow/protocols/task-attempt-planning/plan.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { OperationId } from "../../workflow/identity.js"
import { makeTaskClaimReleaseOperation } from "../../workflow/registry/operation.js"
import { TaskClaimReacquisitionRequestId } from "../../workflow/protocols/task-claim-reacquisition/events.js"
import { taskClaimReacquisitionOperationId } from "../../workflow/protocols/task-claim-reacquisition/plan.js"
import { RunnableFrontierTransition } from "../frontier/frontier.js"
import { ResponsibilityDisposition } from "../frontier/fresh-facts.js"
import { DeliveryProposalId, deliveryProposalsOf, trackerGraphReadProposalOf } from "./delivery-proposal.js"
import { DeliveryActionExecutor, type DeliveryActionResult, DeliverySemanticTrace } from "./delivery-action-executor.js"
import { deliveryRuntime } from "./delivery-runtime-adapter.js"
import { deterministicDeliveryRuntimeSupport, makeDeliveryRelationsLayer } from "./in-memory-relations.js"
import {
  currentSignalOf,
  type DeliveryActionProposal,
  type DeliveryProposalFrontier,
  DeliveryRelationRevision,
  type DeliveryRelationInputBundle,
  type DeliveryRuntimeEvaluation,
  TrackerGraphState
} from "./relations.js"
import { makeTestJournaledTrackerGraphObservation } from "../../../test/journaled-graph-observation.js"
import {
  DeliveryRuntimeProposalOwnershipConflict,
  proposalFrontiersAgree,
  proposalIsPresent,
  runDeliveryRuntime,
  type DeliveryRuntimeInput
} from "./run-delivery-runtime.js"
import { DeliveryRuntimeResources, deliveryRuntimeResourcesLayer } from "./delivery-runtime-resources.js"

const runDeliveryRuntimeDecision = <E>(relation: DeliveryRuntimeInput<E>) =>
  runDeliveryRuntime(relation).pipe(Effect.map(({ decision }) => decision))

const runId = RunId.make("runtime-test-run")
const target = FixtureTarget.make("runtime-test-target")
const projectedSnapshot = projectTrackerSnapshot({ revision: "runtime-test-snapshot", tasks: [] })
if (projectedSnapshot._tag === "Invalid") throw new Error("runtime test snapshot must be valid")
const snapshot = projectedSnapshot.snapshot
const policy = RunControlPolicy.make({
  revision: initialRunPolicyRevision,
  taskExecutionCapacity: TaskWorkCapacity.make(2)
})

const plannerLayer = deterministicPlannedTaskAttemptLayer({
  baseSha: GitCommitSha.make("1".repeat(40)),
  executor: TaskExecutorLocator.make("executor:runtime-test"),
  runId,
  worktreeRoot: WorktreeLocator.make("/runtime-test")
})
const identityLayers = Layer.mergeAll(
  deterministicOperationIdAllocatorLayer("runtime-operation"),
  plannerLayer,
  deliveryRuntimeResourcesLayer
)

const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("runtime-test-attempt"),
  baseSha: GitCommitSha.make("2".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/runtime-test"),
  executor: TaskExecutorLocator.make("executor:runtime-test"),
  runId,
  taskId: TaskId.make("runtime-recovered-task"),
  taskRevision: TaskRevision.make("runtime-test-revision"),
  worktree: WorktreeLocator.make("/runtime-test/recovered")
})

const proposal = (ordinal: number, taskId: TaskId): DeliveryActionProposal => ({
  ...trackerGraphReadProposalOf({
    acceptedAt: JournalPosition.make(ordinal + 1),
    purpose: "EstablishCurrentGraph",
    runId,
    target
  }),
  admission: {
    integrationTarget: { _tag: "NoIntegrationTargetResource" },
    taskWorkPosition: { _tag: "TaskWorkPositionRequired", mode: "ReserveOrReuse", taskId }
  },
  id: DeliveryProposalId.make(`runtime-proposal:${ordinal}:${taskId}`),
  order: { _tag: "FreshWorkflowOrder", frontierOrdinal: ordinal as never, step: "ReadCurrentTaskGraph", taskId },
  owner: "TicketDelivery"
})

const recoveredProposalFor = (
  transition: RunnableFrontierTransition,
  acceptedOperationIds = new Set<OperationId>()
) => {
  const proposals = deliveryProposalsOf({
    acceptedOperationIds,
    fresh: [],
    integrationResponsibilities: [],
    responsibilities: [
      { _tag: "PlannedAttemptExecutorWorkResponsibility" as const, beganAt: JournalPosition.make(1), plannedAttempt }
    ],
    runId,
    transitions: [transition]
  }).ticketDelivery
  const recovered = proposals[0]
  if (recovered === undefined) throw new Error(`no recovered proposal for ${transition._tag}`)
  return recovered
}

const baseEvaluation = Effect.gen(function* () {
  const relation = yield* deliveryRuntime.pipe(
    Effect.provide(
      makeDeliveryRelationsLayer({
        ...deterministicDeliveryRuntimeSupport(policy),
        coherent: currentSignalOf({
          legacy: {
            proposalContributions: { deliverySettlement: [], issues: [], ticketDelivery: [] },
            reflectionProposals: [],
            runtimeFacts: {
              acceptedAt: null,
              quiescence: { _tag: "QuiescencePassive", reason: "ProbeNotRequired" },
              revision: DeliveryRelationRevision.make(0),
              taskWork: { capacity: policy.taskExecutionCapacity, held: [] }
            },
            trackerGraphProposals: []
          },
          publication: { exactEvidence: [], graph: TrackerGraphState.cases.GraphNotEstablished.make({}), policy }
        } satisfies DeliveryRelationInputBundle)
      })
    )
  )
  return Option.getOrThrow(yield* relation.evaluations.changes.pipe(Stream.runHead))
})

const dynamicRelation = Effect.fn("Test.dynamicDeliveryRuntimeRelation")(function* (
  initial: DeliveryRuntimeEvaluation,
  onPublish?: (current: DeliveryRuntimeEvaluation, next: DeliveryRuntimeEvaluation) => DeliveryRuntimeEvaluation,
  onStabilizationRead?: (current: DeliveryRuntimeEvaluation) => DeliveryRuntimeEvaluation
) {
  const state = yield* SubscriptionRef.make(initial)
  const evaluations = { get: SubscriptionRef.get(state), changes: SubscriptionRef.changes(state) }
  return {
    evaluations,
    requestStabilizationRead: () =>
      SubscriptionRef.modify(state, (current) => {
        const revision = DeliveryRelationRevision.make(current.revision + 1)
        const next = onStabilizationRead === undefined ? current : onStabilizationRead(current)
        return [revision, { ...next, revision }] as const
      }),
    publish: (evaluation: DeliveryRuntimeEvaluation) =>
      SubscriptionRef.modify(state, (current) => {
        const next = onPublish === undefined ? evaluation : onPublish(current, evaluation)
        return [undefined, next] as const
      }),
    proposedActions: {
      get: evaluations.get.pipe(Effect.map(({ proposedActions }) => proposedActions)),
      changes: evaluations.changes.pipe(Stream.map(({ proposedActions }) => proposedActions))
    }
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
  finality:
    proposals.length === 0
      ? { _tag: "RunMustRemainActive", reason: "TrackerTargetUnsettled" }
      : { _tag: "RunMustRemainActive", reason: "RunnableTransition" },
  proposedActions: { _tag: "DeliveryProposalsAvailable", isolatedIssues: [], proposals },
  quiescence: { _tag: "QuiescencePassive", reason: "ProbeNotRequired" },
  taskWork: { capacity: TaskWorkCapacity.make(capacity), held: [] }
})

const withSettledTrackerTarget = (evaluation: DeliveryRuntimeEvaluation): DeliveryRuntimeEvaluation => ({
  ...evaluation,
  finality: { _tag: "RunMayTerminate" },
  current: {
    ...evaluation.current,
    trackerGraph: TrackerGraphState.cases.GraphEstablished.make({
      observation: makeTestJournaledTrackerGraphObservation({
        snapshot,
        operationId: OperationId.make("runtime-settled-tracker-target"),
        recordedAt: JournalPosition.make(100)
      })
    })
  }
})

it.effect("compares every available and conflicting proposal-frontier shape", () =>
  Effect.sync(() => {
    const a = proposal(0, TaskId.make("frontier-A"))
    const b = proposal(1, TaskId.make("frontier-B"))
    const available = (proposals: ReadonlyArray<DeliveryActionProposal>) => ({
      _tag: "DeliveryProposalsAvailable" as const,
      isolatedIssues: [],
      proposals
    })
    const conflicts = (
      ids: readonly [DeliveryProposalId, ...ReadonlyArray<DeliveryProposalId>]
    ): DeliveryProposalFrontier => {
      const conflict = (id: DeliveryProposalId) => ({ id, owners: ["TrackerGraph", "TicketDelivery"] as const })
      return { _tag: "DeliveryProposalOwnershipConflict", conflicts: [conflict(ids[0]), ...ids.slice(1).map(conflict)] }
    }

    expect(proposalFrontiersAgree(available([a]), conflicts([a.id]))).toBe(false)
    expect(proposalFrontiersAgree(conflicts([a.id]), available([a]))).toBe(false)
    expect(proposalFrontiersAgree(conflicts([a.id]), conflicts([a.id, b.id]))).toBe(false)
    expect(proposalFrontiersAgree(conflicts([a.id]), conflicts([b.id]))).toBe(false)
    expect(proposalFrontiersAgree(conflicts([a.id]), conflicts([a.id]))).toBe(true)
    expect(proposalFrontiersAgree(available([a]), available([a, b]))).toBe(false)
    expect(proposalFrontiersAgree(available([a]), available([b]))).toBe(false)
    expect(proposalFrontiersAgree(available([a]), available([a]))).toBe(true)
    expect(proposalIsPresent(available([a]), a.id)).toBe(true)
    expect(proposalIsPresent(available([a]), b.id)).toBe(false)
    expect(proposalIsPresent(conflicts([a.id]), a.id)).toBe(true)
    expect(proposalIsPresent(conflicts([a.id]), b.id)).toBe(false)
  })
)

it.effect("reacts to an accepted action result through its owning fact signal", () =>
  Effect.gen(function* () {
    const a = proposal(0, TaskId.make("A"))
    const b = proposal(1, TaskId.make("B"))
    const c = proposal(2, TaskId.make("C"))
    const evaluation = withProposals(yield* baseEvaluation, [a, b, c], 2)
    const relation = yield* dynamicRelation(evaluation)
    const started = yield* Ref.make<ReadonlyArray<string>>([])
    const active = yield* Ref.make(0)
    const maximum = yield* Ref.make(0)
    const firstWaveStarted = yield* Deferred.make<void>()
    const thirdStarted = yield* Deferred.make<void>()
    const gates = new Map([
      [a.id, yield* Deferred.make<void>()],
      [b.id, yield* Deferred.make<void>()],
      [c.id, yield* Deferred.make<void>()]
    ])
    const executor = DeliveryActionExecutor.of({
      execute: (action, lease) =>
        Effect.gen(function* () {
          const id = action.proposal.id
          const taskId = action.proposal.admission.taskWorkPosition
          const correlation = {
            attemptId: AttemptId.make(`attempt:${taskId._tag === "TaskWorkPositionRequired" ? taskId.taskId : id}`),
            runId
          }
          const startedNow = yield* Ref.updateAndGet(started, (ids) => [...ids, id])
          const now = yield* Ref.updateAndGet(active, (count) => count + 1)
          yield* Ref.update(maximum, (prior) => Math.max(prior, now))
          if (startedNow.length === 2) yield* Deferred.succeed(firstWaveStarted, undefined)
          if (startedNow.length === 3) yield* Deferred.succeed(thirdStarted, undefined)
          yield* Deferred.await(Option.getOrThrow(Option.fromUndefinedOr(gates.get(id))))
          yield* lease.bindPlannedAttemptPosition(correlation)
          yield* lease.releasePlannedAttemptPosition(correlation)
          yield* Ref.update(active, (count) => count - 1)
          const current = yield* relation.evaluations.get
          yield* relation.publish(
            withProposals(
              current,
              current.proposedActions._tag === "DeliveryProposalsAvailable"
                ? current.proposedActions.proposals.filter(({ id: proposalId }) => proposalId !== id)
                : [],
              2
            )
          )
          return { _tag: "ActionCompleted", proposalId: id } satisfies DeliveryActionResult
        })
    })

    const runtime = yield* runDeliveryRuntimeDecision(relation).pipe(
      Effect.provide(identityLayers),
      Effect.provideService(DeliveryActionExecutor, executor),
      Effect.forkChild
    )
    yield* Deferred.await(firstWaveStarted)
    expect(yield* Ref.get(started)).toEqual([a.id, b.id])
    expect(yield* Ref.get(maximum)).toBe(2)

    yield* Deferred.succeed(Option.getOrThrow(Option.fromUndefinedOr(gates.get(a.id))), undefined)
    yield* Deferred.await(thirdStarted)
    expect(yield* Ref.get(started)).toEqual([a.id, b.id, c.id])
    yield* Deferred.succeed(Option.getOrThrow(Option.fromUndefinedOr(gates.get(b.id))), undefined)
    yield* Deferred.succeed(Option.getOrThrow(Option.fromUndefinedOr(gates.get(c.id))), undefined)

    expect(yield* Fiber.join(runtime)).toEqual({ _tag: "RunMustRemainActive", reason: "TrackerTargetUnsettled" })
  }).pipe(Effect.scoped)
)

it.effect("does not start a causal successor before its live operation owner is acknowledged", () =>
  Effect.gen(function* () {
    const ownedOperationId = OperationId.make("owned-operation")
    const parent = proposal(0, TaskId.make("A"))
    const successor = { ...proposal(1, TaskId.make("B")), waitsForLiveOperationId: ownedOperationId }
    const initial = withProposals(yield* baseEvaluation, [parent, successor])
    const relation = yield* dynamicRelation(initial)
    const parentStarted = yield* Deferred.make<void>()
    const successorStarted = yield* Deferred.make<void>()
    const finishParent = yield* Deferred.make<void>()
    const finishSuccessor = yield* Deferred.make<void>()
    const executor = DeliveryActionExecutor.of({
      execute: (action) =>
        (action.proposal.id === parent.id
          ? Deferred.succeed(parentStarted, undefined).pipe(
              Effect.andThen(Deferred.await(finishParent)),
              Effect.andThen(relation.publish(withProposals(initial, [successor])))
            )
          : Deferred.succeed(successorStarted, undefined).pipe(
              Effect.andThen(Deferred.await(finishSuccessor)),
              Effect.andThen(relation.publish(withProposals(initial, [])))
            )
        ).pipe(Effect.as({ _tag: "ActionCompleted", proposalId: action.proposal.id } satisfies DeliveryActionResult))
    })
    const allocator = OperationIdAllocator.of({ allocate: () => Effect.succeed(ownedOperationId) })

    const runtime = yield* runDeliveryRuntimeDecision(relation).pipe(
      Effect.provide(plannerLayer),
      Effect.provide(deliveryRuntimeResourcesLayer),
      Effect.provideService(OperationIdAllocator, allocator),
      Effect.provideService(DeliveryActionExecutor, executor),
      Effect.forkChild
    )
    yield* Deferred.await(parentStarted)
    yield* Effect.yieldNow
    expect(yield* Deferred.isDone(successorStarted)).toBe(false)

    yield* Deferred.succeed(finishParent, undefined)
    yield* Deferred.await(successorStarted)
    yield* Deferred.succeed(finishSuccessor, undefined)
    expect(yield* Fiber.join(runtime)).toEqual({ _tag: "RunMustRemainActive", reason: "TrackerTargetUnsettled" })
  }).pipe(Effect.scoped)
)

it.effect("does not start a causal successor before its accepted operation owner is acknowledged", () =>
  Effect.gen(function* () {
    const ownedOperationId = OperationId.make("accepted-owned-operation")
    const parent = recoveredProposalFor(
      RunnableFrontierTransition.CheckTaskClaim({ operationId: ownedOperationId, taskId: plannedAttempt.taskId }),
      new Set([ownedOperationId])
    )
    const successor = { ...proposal(1, TaskId.make("B")), waitsForLiveOperationId: ownedOperationId }
    const initial = withProposals(yield* baseEvaluation, [parent, successor])
    const relation = yield* dynamicRelation(initial)
    const parentStarted = yield* Deferred.make<void>()
    const successorStarted = yield* Deferred.make<void>()
    const finishParent = yield* Deferred.make<void>()
    const finishSuccessor = yield* Deferred.make<void>()
    const executor = DeliveryActionExecutor.of({
      execute: (action) =>
        (action.proposal.id === parent.id
          ? Deferred.succeed(parentStarted, undefined).pipe(
              Effect.andThen(Deferred.await(finishParent)),
              Effect.andThen(relation.publish(withProposals(initial, [successor])))
            )
          : Deferred.succeed(successorStarted, undefined).pipe(
              Effect.andThen(Deferred.await(finishSuccessor)),
              Effect.andThen(relation.publish(withProposals(initial, [])))
            )
        ).pipe(Effect.as({ _tag: "ActionCompleted", proposalId: action.proposal.id } satisfies DeliveryActionResult))
    })

    const runtime = yield* runDeliveryRuntimeDecision(relation).pipe(
      Effect.provide(identityLayers),
      Effect.provideService(DeliveryActionExecutor, executor),
      Effect.forkChild
    )
    yield* Deferred.await(parentStarted)
    yield* Effect.yieldNow
    expect(yield* Deferred.isDone(successorStarted)).toBe(false)

    yield* Deferred.succeed(finishParent, undefined)
    yield* Deferred.await(successorStarted)
    yield* Deferred.succeed(finishSuccessor, undefined)
    expect(yield* Fiber.join(runtime)).toEqual({ _tag: "RunMustRemainActive", reason: "TrackerTargetUnsettled" })
  }).pipe(Effect.scoped)
)

it.effect("admits independent fresh work while a recovered action remains live", () =>
  Effect.gen(function* () {
    const recovered = recoveredProposalFor(
      RunnableFrontierTransition.CommitTaskClaimReacquisitionIntent({
        plannedAttempt,
        requestId: TaskClaimReacquisitionRequestId.make("runtime-reconciliation-barrier"),
        taskId: plannedAttempt.taskId
      })
    )
    const fresh = proposal(1, TaskId.make("fresh-after-reconciliation"))
    const initial = withProposals(yield* baseEvaluation, [recovered, fresh], 2)
    const relation = yield* dynamicRelation(initial)
    const recoveredStarted = yield* Deferred.make<void>()
    const finishRecovered = yield* Deferred.make<void>()
    const freshStarted = yield* Deferred.make<void>()
    const executor = DeliveryActionExecutor.of({
      execute: (action) =>
        (action.proposal.id === recovered.id
          ? Deferred.succeed(recoveredStarted, undefined).pipe(
              Effect.andThen(Deferred.await(finishRecovered)),
              Effect.andThen(relation.publish(withProposals(initial, [])))
            )
          : Deferred.succeed(freshStarted, undefined).pipe(
              Effect.andThen(relation.publish(withProposals(initial, [recovered], 2)))
            )
        ).pipe(Effect.as({ _tag: "ActionCompleted", proposalId: action.proposal.id } satisfies DeliveryActionResult))
    })

    const runtime = yield* runDeliveryRuntimeDecision(relation).pipe(
      Effect.provide(identityLayers),
      Effect.provideService(DeliveryActionExecutor, executor),
      Effect.forkChild
    )
    yield* Deferred.await(recoveredStarted)
    yield* Deferred.await(freshStarted)

    yield* Deferred.succeed(finishRecovered, undefined)
    expect(yield* Fiber.join(runtime)).toEqual({ _tag: "RunMustRemainActive", reason: "TrackerTargetUnsettled" })
  }).pipe(Effect.scoped)
)

it.effect("keeps A as an unreadable Git wait while independent B executes its proposal", () =>
  Effect.gen(function* () {
    const taskA = plannedAttempt.taskId
    const taskB = TaskId.make("independent-B")
    const projected = projectTrackerSnapshot({
      revision: "unreadable-A-independent-B",
      tasks: [taskA, taskB].map((id) => ({
        id,
        lifecycle: { _tag: "Open" as const },
        parentTaskId: null,
        prerequisiteIds: []
      }))
    })
    if (projected._tag === "Invalid") return yield* Effect.die("test graph must be valid")
    const b = proposal(0, taskB)
    const proposalContributions = yield* SubscriptionRef.make({
      deliverySettlement: [],
      issues: [],
      ticketDelivery: [b]
    })
    const revision = yield* Ref.make(DeliveryRelationRevision.make(0))
    const runtimeFacts = yield* SubscriptionRef.make({
      acceptedAt: null,
      quiescence: { _tag: "QuiescencePassive" as const, reason: "ProbeNotRequired" as const },
      revision: DeliveryRelationRevision.make(0),
      taskWork: {
        capacity: TaskWorkCapacity.make(2),
        held: [{ correlation: { attemptId: plannedAttempt.attemptId, runId }, taskId: taskA }]
      }
    })
    const layer = makeDeliveryRelationsLayer({
      evaluationConsistency: {
        currentRevision: Ref.get(revision),
        withStableRevision: <A, E, R>(effect: Effect.Effect<A, E, R>) => effect
      },
      coherent: currentSignalOf({
        legacy: {
          proposalContributions: { deliverySettlement: [], issues: [], ticketDelivery: [] },
          reflectionProposals: [],
          runtimeFacts: {
            acceptedAt: null,
            quiescence: { _tag: "QuiescencePassive", reason: "ProbeNotRequired" },
            revision: DeliveryRelationRevision.make(0),
            taskWork: { capacity: policy.taskExecutionCapacity, held: [] }
          },
          trackerGraphProposals: []
        },
        publication: {
          exactEvidence: [
            {
              _tag: "ResponsibilityFacts" as const,
              facts: {
                _tag: "PlannedAttemptExecutorFreshFacts" as const,
                disposition: ResponsibilityDisposition.PlannedAttemptGitConstraint({ gitState: "WorktreeLost" }),
                responsibility: {
                  _tag: "PlannedAttemptExecutorWorkResponsibility" as const,
                  beganAt: JournalPosition.make(1),
                  plannedAttempt
                }
              }
            }
          ],
          graph: TrackerGraphState.cases.GraphEstablished.make({
            observation: makeTestJournaledTrackerGraphObservation({
              snapshot: projected.snapshot,
              operationId: OperationId.make("fixture:unreadable-A-independent-B"),
              recordedAt: JournalPosition.make(1)
            })
          }),
          policy
        }
      } satisfies DeliveryRelationInputBundle),
      requestStabilizationRead: () =>
        Effect.gen(function* () {
          const next = yield* Ref.updateAndGet(revision, (current) => DeliveryRelationRevision.make(current + 1))
          yield* SubscriptionRef.update(runtimeFacts, (current) => ({ ...current, revision: next }))
          return next
        }),
      proposalContributions: {
        get: SubscriptionRef.get(proposalContributions),
        changes: SubscriptionRef.changes(proposalContributions)
      },
      runtimeFacts: { get: SubscriptionRef.get(runtimeFacts), changes: SubscriptionRef.changes(runtimeFacts) }
    })
    const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))
    const initial = Option.getOrThrow(yield* relation.current.changes.pipe(Stream.runHead))
    expect(initial.ticketDeliveries.deliveries.find(({ taskId }) => taskId === taskA)?.standings[0]).toMatchObject({
      _tag: "ResponsibilitySituation",
      facts: { disposition: { _tag: "PlannedAttemptGitConstraint", gitState: "WorktreeLost" } }
    })
    const executed = yield* Ref.make<ReadonlyArray<TaskId>>([])
    const executor = DeliveryActionExecutor.of({
      execute: (action) =>
        Ref.update(executed, (current) => [...current, taskB]).pipe(
          Effect.andThen(
            SubscriptionRef.update(proposalContributions, (current) => ({ ...current, ticketDelivery: [] }))
          ),
          Effect.as({ _tag: "ActionCompleted", proposalId: action.proposal.id } satisfies DeliveryActionResult)
        )
    })

    expect(
      yield* runDeliveryRuntimeDecision(relation).pipe(
        Effect.provide(identityLayers),
        Effect.provideService(DeliveryActionExecutor, executor)
      )
    ).toEqual({ _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" })
    expect(yield* Ref.get(executed)).toEqual([taskB])
  }).pipe(Effect.scoped)
)

it.effect("ignores an older evaluation before accepting the next current publication", () =>
  Effect.gen(function* () {
    const actionProposal = proposal(0, TaskId.make("stale-evaluation"))
    const initial = {
      ...withProposals(yield* baseEvaluation, [actionProposal], 1),
      revision: DeliveryRelationRevision.make(2)
    }
    const relation = yield* dynamicRelation(initial)
    const started = yield* Deferred.make<void>()
    const finish = yield* Deferred.make<void>()
    const executor = DeliveryActionExecutor.of({
      execute: (action) =>
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Deferred.await(finish)),
          Effect.as({ _tag: "ActionCompleted" as const, proposalId: action.proposal.id })
        )
    })
    const runtime = yield* runDeliveryRuntimeDecision(relation).pipe(
      Effect.provide(identityLayers),
      Effect.provideService(DeliveryActionExecutor, executor),
      Effect.forkChild
    )
    yield* Deferred.await(started)
    yield* relation.publish({ ...initial, revision: DeliveryRelationRevision.make(1) })
    yield* Deferred.succeed(finish, undefined)
    yield* relation.publish({ ...withProposals(initial, [], 1), revision: DeliveryRelationRevision.make(3) })

    expect(yield* Fiber.join(runtime)).toEqual({ _tag: "RunMustRemainActive", reason: "TrackerTargetUnsettled" })
  }).pipe(Effect.scoped)
)

it.effect("ignores a delayed proposal publication after a newer evaluation is current", () =>
  Effect.gen(function* () {
    const keeper = proposal(0, TaskId.make("coherence-keeper"))
    const stale = proposal(1, TaskId.make("coherence-stale"))
    const current = proposal(2, TaskId.make("coherence-current"))
    const initial = { ...withProposals(yield* baseEvaluation, [keeper], 2), revision: DeliveryRelationRevision.make(1) }
    const evaluations = yield* SubscriptionRef.make(initial)
    const proposals = yield* SubscriptionRef.make(initial.proposedActions)
    const relation: DeliveryRuntimeInput<never> = {
      evaluations: { get: SubscriptionRef.get(evaluations), changes: SubscriptionRef.changes(evaluations) },
      proposedActions: { get: SubscriptionRef.get(proposals), changes: SubscriptionRef.changes(proposals) },
      requestStabilizationRead: () => Effect.succeed(initial.revision)
    }
    const keeperStarted = yield* Deferred.make<void>()
    const currentStarted = yield* Deferred.make<void>()
    const finish = yield* Deferred.make<void>()
    const started = yield* Ref.make<ReadonlyArray<DeliveryProposalId>>([])
    const executor = DeliveryActionExecutor.of({
      execute: (action) =>
        Ref.update(started, (ids) => [...ids, action.proposal.id]).pipe(
          Effect.andThen(
            action.proposal.id === keeper.id
              ? Deferred.succeed(keeperStarted, undefined)
              : action.proposal.id === current.id
                ? Deferred.succeed(currentStarted, undefined)
                : Effect.void
          ),
          Effect.andThen(Deferred.await(finish)),
          Effect.as({ _tag: "ActionCompleted", proposalId: action.proposal.id } satisfies DeliveryActionResult)
        )
    })
    const runtime = yield* runDeliveryRuntimeDecision(relation).pipe(
      Effect.provide(identityLayers),
      Effect.provideService(DeliveryActionExecutor, executor),
      Effect.forkChild
    )
    yield* Deferred.await(keeperStarted)

    const next = { ...withProposals(initial, [current], 2), revision: DeliveryRelationRevision.make(2) }
    yield* SubscriptionRef.set(evaluations, next)
    yield* SubscriptionRef.set(proposals, withProposals(initial, [stale], 2).proposedActions)
    yield* Effect.yieldNow
    expect(yield* Ref.get(started)).toEqual([keeper.id])

    yield* SubscriptionRef.set(proposals, next.proposedActions)
    yield* Deferred.await(currentStarted)
    expect(yield* Ref.get(started)).toEqual([keeper.id, current.id])
    yield* Fiber.interrupt(runtime)
  }).pipe(Effect.scoped)
)

it.effect("does not allocate an operation or attempt identity before admission", () =>
  Effect.gen(function* () {
    const a = proposal(0, TaskId.make("A"))
    const initial = {
      ...withProposals(yield* baseEvaluation, [a], 1),
      taskWork: {
        capacity: TaskWorkCapacity.make(1),
        held: [{ correlation: { attemptId: AttemptId.make("attempt:B"), runId }, taskId: TaskId.make("B") }]
      }
    }
    const relation = yield* dynamicRelation(initial)
    const allocations = yield* Ref.make(0)
    const allocator = OperationIdAllocator.of({
      allocate: () =>
        Ref.updateAndGet(allocations, (count) => count + 1).pipe(
          Effect.map((ordinal) => `operation:${ordinal}` as never)
        )
    })
    const executed = yield* Deferred.make<void>()
    const executor = DeliveryActionExecutor.of({
      execute: (action) =>
        Deferred.succeed(executed, undefined).pipe(
          Effect.andThen(relation.publish(withProposals(initial, [], 1))),
          Effect.as({ _tag: "ActionCompleted", proposalId: action.proposal.id } satisfies DeliveryActionResult)
        )
    })
    const runtime = yield* runDeliveryRuntimeDecision(relation).pipe(
      Effect.provide(plannerLayer),
      Effect.provide(deliveryRuntimeResourcesLayer),
      Effect.provideService(OperationIdAllocator, allocator),
      Effect.provideService(DeliveryActionExecutor, executor),
      Effect.forkChild
    )
    yield* Effect.yieldNow
    expect(yield* Ref.get(allocations)).toBe(0)

    yield* relation.publish({
      ...withProposals(initial, [a], 1),
      taskWork: { capacity: TaskWorkCapacity.make(1), held: [] }
    })
    yield* Deferred.await(executed)
    expect(yield* Ref.get(allocations)).toBe(1)
    expect(yield* Fiber.join(runtime)).toEqual({ _tag: "RunMustRemainActive", reason: "TrackerTargetUnsettled" })
  }).pipe(Effect.scoped)
)

it.effect("starts one live action while its proposal remains present", () =>
  Effect.gen(function* () {
    const persistent = trackerGraphReadProposalOf({
      acceptedAt: JournalPosition.make(1),
      purpose: "EstablishCurrentGraph",
      runId,
      target
    })
    const initial = withProposals(yield* baseEvaluation, [persistent])
    const relation = yield* dynamicRelation(initial)
    const started = yield* Deferred.make<void>()
    const finish = yield* Deferred.make<void>()
    const settled = yield* Deferred.make<void>()
    const starts = yield* Ref.make(0)
    const executor = DeliveryActionExecutor.of({
      execute: (action) =>
        Ref.update(starts, (count) => count + 1).pipe(
          Effect.andThen(Deferred.succeed(started, undefined)),
          Effect.andThen(Deferred.await(finish)),
          Effect.as({ _tag: "ActionCompleted", proposalId: action.proposal.id } satisfies DeliveryActionResult)
        )
    })
    const runtime = yield* runDeliveryRuntimeDecision(relation).pipe(
      Effect.provide(identityLayers),
      Effect.provideService(DeliveryActionExecutor, executor),
      Effect.provideService(
        DeliverySemanticTrace,
        DeliverySemanticTrace.of({
          emit: (event) =>
            event._tag === "ActionOutcome" && event.proposalId === persistent.id
              ? Deferred.succeed(settled, undefined)
              : Effect.void
        })
      ),
      Effect.forkChild
    )
    yield* Deferred.await(started)
    yield* relation.publish({ ...initial, revision: DeliveryRelationRevision.make(1) })
    yield* Effect.yieldNow
    expect(yield* Ref.get(starts)).toBe(1)
    yield* Deferred.succeed(finish, undefined)
    yield* Deferred.await(settled)
    yield* relation.publish({ ...initial, revision: DeliveryRelationRevision.make(2) })
    yield* Effect.yieldNow
    expect(yield* Ref.get(starts)).toBe(1)
    yield* relation.publish(withProposals({ ...initial, revision: DeliveryRelationRevision.make(3) }, []))
    expect(yield* Fiber.join(runtime)).toEqual({ _tag: "RunMustRemainActive", reason: "TrackerTargetUnsettled" })
  }).pipe(Effect.scoped)
)

it.effect("requests and executes one quiescence probe before returning finality", () =>
  Effect.gen(function* () {
    const probeProposal = {
      ...trackerGraphReadProposalOf({
        acceptedAt: JournalPosition.make(10),
        purpose: "QuiescenceProbe",
        runId,
        target
      }),
      id: DeliveryProposalId.make("quiescence-probe")
    }
    const initial = {
      ...withProposals(yield* baseEvaluation, []),
      quiescence: { _tag: "QuiescenceProbeAllowed" as const }
    }
    const relation = yield* dynamicRelation(initial, undefined, (current) => ({
      ...withProposals(current, [probeProposal]),
      quiescence: { _tag: "QuiescenceProbeAllowed" }
    }))
    const requests = yield* Ref.make(0)
    const executor = DeliveryActionExecutor.of({
      execute: (action) =>
        Effect.gen(function* () {
          yield* Ref.update(requests, (count) => count + 1)
          const current = yield* relation.evaluations.get
          yield* relation.publish({
            ...withSettledTrackerTarget(
              withProposals({ ...current, revision: DeliveryRelationRevision.make(current.revision + 1) }, [])
            ),
            quiescence: { _tag: "QuiescenceProbeAllowed" }
          })
          return {
            _tag: "TrackerGraphObservationPublished",
            operationId: action._tag === "FreshOperationAction" ? action.operationId : ("unexpected" as never),
            proposalId: action.proposal.id,
            snapshot
          } as const
        })
    })

    const finality = yield* runDeliveryRuntimeDecision(relation).pipe(
      Effect.provide(identityLayers),
      Effect.provideService(DeliveryActionExecutor, executor)
    )

    expect(finality).toEqual({ _tag: "RunMayTerminate" })
    expect(yield* Ref.get(requests)).toBe(1)
  }).pipe(Effect.scoped)
)

it.effect("a quiescence probe that reveals work cannot satisfy the later idle state", () =>
  Effect.gen(function* () {
    const firstProbe = {
      ...trackerGraphReadProposalOf({
        acceptedAt: JournalPosition.make(20),
        purpose: "QuiescenceProbe",
        runId,
        target
      }),
      id: DeliveryProposalId.make("revealing-probe")
    }
    const work = proposal(0, TaskId.make("A"))
    const secondProbe = {
      ...trackerGraphReadProposalOf({
        acceptedAt: JournalPosition.make(21),
        purpose: "QuiescenceProbe",
        runId,
        target
      }),
      id: DeliveryProposalId.make("final-probe")
    }
    const initial = {
      ...withProposals(yield* baseEvaluation, []),
      quiescence: { _tag: "QuiescenceProbeAllowed" as const }
    }
    const withProbeAllowed = (evaluation: DeliveryRuntimeEvaluation): DeliveryRuntimeEvaluation => ({
      ...evaluation,
      quiescence: { _tag: "QuiescenceProbeAllowed" }
    })
    const relation = yield* dynamicRelation(initial, undefined, (current) => {
      const next = current.acceptedAt === initial.acceptedAt ? firstProbe : secondProbe
      return withProbeAllowed(withProposals(current, [next]))
    })
    const executed = yield* Ref.make<ReadonlyArray<string>>([])
    const executor = DeliveryActionExecutor.of({
      execute: (action) =>
        Effect.gen(function* () {
          yield* Ref.update(executed, (ids) => [...ids, action.proposal.id])
          const current = yield* relation.evaluations.get
          const nextRevision = DeliveryRelationRevision.make(current.revision + 1)
          if (action.proposal.id === firstProbe.id) {
            yield* relation.publish({
              ...withProbeAllowed(withProposals({ ...current, revision: nextRevision }, [work])),
              acceptedAt: JournalPosition.make(21)
            })
          } else if (action.proposal.id === work.id) {
            yield* relation.publish({
              ...withProbeAllowed(withProposals({ ...current, revision: nextRevision }, [])),
              acceptedAt: JournalPosition.make(21)
            })
          } else {
            yield* relation.publish(
              withSettledTrackerTarget(withProbeAllowed(withProposals({ ...current, revision: nextRevision }, [])))
            )
          }
          return action.proposal.route._tag === "TrackerGraphReadRoute" &&
            action.proposal.route.purpose === "QuiescenceProbe"
            ? {
                _tag: "TrackerGraphObservationPublished" as const,
                operationId: action._tag === "FreshOperationAction" ? action.operationId : ("unexpected" as never),
                proposalId: action.proposal.id,
                snapshot
              }
            : { _tag: "ActionCompleted" as const, proposalId: action.proposal.id }
        })
    })

    const finality = yield* runDeliveryRuntimeDecision(relation).pipe(
      Effect.provide(identityLayers),
      Effect.provideService(DeliveryActionExecutor, executor)
    )
    expect(yield* Ref.get(executed)).toEqual([firstProbe.id, work.id, secondProbe.id])
    expect(finality).toEqual({ _tag: "RunMayTerminate" })
  }).pipe(Effect.scoped)
)

it.effect("interrupts every scoped live action without manufacturing completion", () =>
  Effect.gen(function* () {
    const a = proposal(0, TaskId.make("A"))
    const relation = yield* dynamicRelation(withProposals(yield* baseEvaluation, [a], 1))
    const started = yield* Deferred.make<void>()
    const interrupted = yield* Deferred.make<void>()
    const executor = DeliveryActionExecutor.of({
      execute: () =>
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.ensuring(Deferred.succeed(interrupted, undefined))
        )
    })
    const fiber = yield* runDeliveryRuntimeDecision(relation).pipe(
      Effect.provide(identityLayers),
      Effect.provideService(DeliveryActionExecutor, executor),
      Effect.forkChild
    )
    yield* Deferred.await(started)
    yield* Fiber.interrupt(fiber)
    yield* Deferred.await(interrupted)
  }).pipe(Effect.scoped)
)

it.effect("releases acquired integration ownership and its relation subscriber on interruption", () =>
  Effect.gen(function* () {
    const acquired = {
      ...proposal(0, TaskId.make("A")),
      admission: {
        integrationTarget: {
          _tag: "IntegrationTargetResourceRequired" as const,
          access: "Acquire" as const,
          integrationTarget: IntegrationTarget.make({
            repository: GitRepositoryLocator.make("/runtime-test/repository.git"),
            ref: IntegrationTargetRef.make("refs/heads/main")
          }),
          queuedAt: JournalPosition.make(40)
        },
        taskWorkPosition: { _tag: "NoTaskWorkPosition" as const }
      }
    }
    const evaluation = withProposals(yield* baseEvaluation, [acquired])
    const subscribers = yield* Ref.make(0)
    const evaluations = {
      get: Effect.succeed(evaluation),
      changes: Stream.fromEffect(Ref.update(subscribers, (count) => count + 1).pipe(Effect.as(evaluation))).pipe(
        Stream.concat(Stream.never),
        Stream.ensuring(Ref.update(subscribers, (count) => count - 1))
      )
    }
    const relation = {
      evaluations,
      requestStabilizationRead: () => Effect.succeed(DeliveryRelationRevision.make(1)),
      proposedActions: {
        get: evaluations.get.pipe(Effect.map(({ proposedActions }) => proposedActions)),
        changes: evaluations.changes.pipe(Stream.map(({ proposedActions }) => proposedActions))
      }
    } satisfies DeliveryRuntimeInput
    const actionStarted = yield* Deferred.make<void>()
    const executor = DeliveryActionExecutor.of({
      execute: (_action, lease) =>
        lease.acceptIntegrationTargetOwnership.pipe(
          Effect.andThen(Deferred.succeed(actionStarted, undefined)),
          Effect.andThen(Effect.never)
        )
    })
    const integrationTargets = yield* makeIntegrationTargetResourceController()
    const fiber = yield* runDeliveryRuntimeDecision(relation).pipe(
      Effect.provide(plannerLayer),
      Effect.provide(deterministicOperationIdAllocatorLayer("interrupt-cleanup")),
      Effect.provideService(DeliveryRuntimeResources, DeliveryRuntimeResources.of({ integrationTargets })),
      Effect.provideService(DeliveryActionExecutor, executor),
      Effect.forkChild
    )
    yield* Deferred.await(actionStarted)
    expect((yield* integrationTargets.snapshot).heldResponsibilityPositions).toEqual(
      new Set([JournalPosition.make(40)])
    )
    expect(yield* Ref.get(subscribers)).toBe(2)

    yield* Fiber.interrupt(fiber)

    expect(yield* integrationTargets.snapshot).toEqual({
      activeResponsibilityPositions: new Set(),
      heldResponsibilityPositions: new Set()
    })
    expect(yield* Ref.get(subscribers)).toBe(0)
  }).pipe(Effect.scoped)
)

it.effect("rolls back acquired integration ownership when the action fails", () =>
  Effect.gen(function* () {
    const acquired = {
      ...proposal(0, TaskId.make("A")),
      admission: {
        integrationTarget: {
          _tag: "IntegrationTargetResourceRequired" as const,
          access: "Acquire" as const,
          integrationTarget: IntegrationTarget.make({
            repository: GitRepositoryLocator.make("/runtime-test/failure-repository.git"),
            ref: IntegrationTargetRef.make("refs/heads/main")
          }),
          queuedAt: JournalPosition.make(41)
        },
        taskWorkPosition: { _tag: "NoTaskWorkPosition" as const }
      }
    }
    const relation = yield* dynamicRelation(withProposals(yield* baseEvaluation, [acquired]))
    const actionFailure = new IntegrationCandidateBoundaryUnavailable({ boundary: "Agent" })
    const integrationTargets = yield* makeIntegrationTargetResourceController()

    expect(
      yield* runDeliveryRuntimeDecision(relation).pipe(
        Effect.provide(plannerLayer),
        Effect.provide(deterministicOperationIdAllocatorLayer("failed-integration-action")),
        Effect.provideService(DeliveryRuntimeResources, DeliveryRuntimeResources.of({ integrationTargets })),
        Effect.provideService(
          DeliveryActionExecutor,
          DeliveryActionExecutor.of({ execute: () => Effect.fail(actionFailure) })
        ),
        Effect.flip
      )
    ).toEqual(actionFailure)
    expect(yield* integrationTargets.snapshot).toEqual({
      activeResponsibilityPositions: new Set(),
      heldResponsibilityPositions: new Set()
    })
  }).pipe(Effect.scoped)
)

it.effect("fails with the exact relation cause before admitting any proposal", () =>
  Effect.gen(function* () {
    const initial = yield* baseEvaluation
    const relationFailure = { _tag: "TestRelationFailure" as const }
    const relation = {
      evaluations: { get: Effect.fail(relationFailure), changes: Stream.fail(relationFailure) },
      proposedActions: currentSignalOf(initial.proposedActions),
      requestStabilizationRead: () => Effect.succeed(DeliveryRelationRevision.make(0))
    } satisfies DeliveryRuntimeInput<typeof relationFailure>
    const executor = DeliveryActionExecutor.of({ execute: () => Effect.die("no action may start") })

    const failure = yield* runDeliveryRuntimeDecision(relation).pipe(
      Effect.provide(identityLayers),
      Effect.provideService(DeliveryActionExecutor, executor),
      Effect.flip
    )

    expect(failure).toEqual(relationFailure)
  }).pipe(Effect.scoped)
)

it.effect("fails closed when the assembled relation reports conflicting proposal ownership", () =>
  Effect.gen(function* () {
    const conflictedId = DeliveryProposalId.make("runtime-owner-conflict")
    const conflicted = {
      ...(yield* baseEvaluation),
      proposedActions: {
        _tag: "DeliveryProposalOwnershipConflict" as const,
        conflicts: [{ id: conflictedId, owners: ["TrackerGraph" as const, "TicketDelivery" as const] }] as const
      }
    }
    const relation = yield* dynamicRelation(conflicted)
    const executor = DeliveryActionExecutor.of({ execute: () => Effect.die("conflict cannot authorize action") })

    const failure = yield* runDeliveryRuntimeDecision(relation).pipe(
      Effect.provide(identityLayers),
      Effect.provideService(DeliveryActionExecutor, executor),
      Effect.flip
    )

    expect(failure).toBeInstanceOf(DeliveryRuntimeProposalOwnershipConflict)
    if (!(failure instanceof DeliveryRuntimeProposalOwnershipConflict))
      return expect.fail("expected ownership conflict")
    expect(failure.proposalIds).toEqual([conflictedId])
  }).pipe(Effect.scoped)
)

it.effect("returns the exact action failure after rolling back its process-local admission", () =>
  Effect.gen(function* () {
    const actionProposal = proposal(0, TaskId.make("action-failure"))
    const initial = withProposals(yield* baseEvaluation, [actionProposal], 1)
    const relation = yield* dynamicRelation(initial)
    const actionFailure = new IntegrationCandidateBoundaryUnavailable({ boundary: "Agent" })
    const executor = DeliveryActionExecutor.of({ execute: () => Effect.fail(actionFailure) })

    const failure = yield* runDeliveryRuntimeDecision(relation).pipe(
      Effect.provide(identityLayers),
      Effect.provideService(DeliveryActionExecutor, executor),
      Effect.flip
    )

    expect(failure).toEqual(actionFailure)
  }).pipe(Effect.scoped)
)

it.effect("materializes accepted and source-derived operation identities only after admission", () =>
  Effect.gen(function* () {
    const requestId = TaskClaimReacquisitionRequestId.make("runtime-reacquisition-request")
    const reacquisition = recoveredProposalFor(
      RunnableFrontierTransition.CommitTaskClaimReacquisitionIntent({
        plannedAttempt,
        requestId,
        taskId: plannedAttempt.taskId
      })
    )
    const claimOperationId = OperationId.make("runtime-external-claim")
    const claim = ActiveTaskClaim.make({
      operationId: claimOperationId,
      owner: ClaimOwner.make("dalph"),
      taskId: plannedAttempt.taskId,
      token: ClaimToken.make("runtime-external-token")
    })
    const releaseOperation = makeTaskClaimReleaseOperation({
      predecessorOperationIds: [claimOperationId],
      release: { claim, operationId: OperationId.make("runtime-release-placeholder") }
    })
    const externalRelease = recoveredProposalFor(
      RunnableFrontierTransition.ReleaseExternallyCompletedTaskClaim({ operation: releaseOperation, plannedAttempt })
    )
    const acceptedOperationId = OperationId.make("runtime-accepted-operation")
    const accepted = recoveredProposalFor(
      RunnableFrontierTransition.CheckTaskClaim({ operationId: acceptedOperationId, taskId: plannedAttempt.taskId }),
      new Set([acceptedOperationId])
    )
    const initial = withProposals(yield* baseEvaluation, [reacquisition, externalRelease, accepted], 1)
    const relation = yield* dynamicRelation(initial)
    const actions = yield* Ref.make<ReadonlyArray<{ readonly id: DeliveryProposalId; readonly operationId: string }>>(
      []
    )
    const executor = DeliveryActionExecutor.of({
      execute: (action) =>
        Ref.update(actions, (current) => [
          ...current,
          {
            id: action.proposal.id,
            operationId:
              action._tag === "FreshOperationAction"
                ? action.operationId
                : action._tag === "AcceptedOperationAction"
                  ? action.proposal.actionIdentity.operationId
                  : "unexpected"
          }
        ]).pipe(
          Effect.andThen(
            relation.evaluations.get.pipe(
              Effect.flatMap((current) =>
                relation.publish(
                  withProposals(
                    current,
                    current.proposedActions._tag === "DeliveryProposalsAvailable"
                      ? current.proposedActions.proposals.filter(({ id }) => id !== action.proposal.id)
                      : [],
                    1
                  )
                )
              )
            )
          ),
          Effect.as({ _tag: "ActionCompleted", proposalId: action.proposal.id } as const)
        )
    })

    expect(
      yield* runDeliveryRuntimeDecision(relation).pipe(
        Effect.provide(identityLayers),
        Effect.provideService(DeliveryActionExecutor, executor)
      )
    ).toEqual({ _tag: "RunMustRemainActive", reason: "TrackerTargetUnsettled" })
    expect(yield* Ref.get(actions)).toEqual([
      { id: reacquisition.id, operationId: taskClaimReacquisitionOperationId(requestId) },
      { id: externalRelease.id, operationId: `external-success-release:${claimOperationId}` },
      { id: accepted.id, operationId: acceptedOperationId }
    ])
  }).pipe(Effect.scoped)
)

it.effect("passes a deferred proposal without reordering the later proposals", () =>
  Effect.gen(function* () {
    const live = proposal(0, TaskId.make("live"))
    const blockedFirst = proposal(1, TaskId.make("blocked-first"))
    const blockedLater = proposal(2, TaskId.make("blocked-later"))
    const free = {
      ...trackerGraphReadProposalOf({
        acceptedAt: JournalPosition.make(90),
        purpose: "EstablishCurrentGraph",
        runId,
        target
      }),
      id: DeliveryProposalId.make("runtime-free-later-proposal")
    }
    const initial = withProposals(yield* baseEvaluation, [live], 1)
    const relation = yield* dynamicRelation(initial)
    const liveStarted = yield* Deferred.make<void>()
    const freeStarted = yield* Deferred.make<void>()
    const executor = DeliveryActionExecutor.of({
      execute: (action, lease) =>
        Effect.gen(function* () {
          if (action.proposal.id === live.id) {
            yield* Deferred.succeed(liveStarted, undefined)
          } else if (action.proposal.id === free.id) {
            yield* lease.bindPlannedAttemptPosition({ attemptId: plannedAttempt.attemptId, runId })
            yield* Deferred.succeed(freeStarted, undefined)
          }
          return yield* Effect.never
        })
    })
    const runtime = yield* runDeliveryRuntimeDecision(relation).pipe(
      Effect.provide(identityLayers),
      Effect.provideService(DeliveryActionExecutor, executor),
      Effect.forkChild
    )
    yield* Deferred.await(liveStarted)
    yield* relation.publish(withProposals(initial, [blockedFirst, live, blockedLater, free], 1))
    yield* Deferred.await(freeStarted)
    yield* Fiber.interrupt(runtime)
  }).pipe(Effect.scoped)
)

it.effect("returns a relation failure published after actions have started", () =>
  Effect.gen(function* () {
    const actionProposal = proposal(0, TaskId.make("later-relation-failure"))
    const initial = withProposals(yield* baseEvaluation, [actionProposal], 1)
    const fail = yield* Deferred.make<void>()
    const relationFailure = { _tag: "LaterRelationFailure" as const }
    const evaluations = {
      get: Effect.succeed(initial),
      changes: Stream.succeed(initial).pipe(
        Stream.concat(Stream.fromEffect(Deferred.await(fail).pipe(Effect.andThen(Effect.fail(relationFailure)))))
      )
    }
    const relation = {
      evaluations,
      proposedActions: currentSignalOf(initial.proposedActions),
      requestStabilizationRead: () => Effect.succeed(DeliveryRelationRevision.make(1))
    } satisfies DeliveryRuntimeInput<typeof relationFailure>
    const started = yield* Deferred.make<void>()
    const executor = DeliveryActionExecutor.of({
      execute: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never))
    })
    const runtime = yield* runDeliveryRuntimeDecision(relation).pipe(
      Effect.provide(identityLayers),
      Effect.provideService(DeliveryActionExecutor, executor),
      Effect.forkChild
    )
    yield* Deferred.await(started)
    yield* Deferred.succeed(fail, undefined)

    expect(yield* Effect.flip(Fiber.join(runtime))).toEqual(relationFailure)
  }).pipe(Effect.scoped)
)

it.effect("fails closed when a later evaluation introduces conflicting ownership", () =>
  Effect.gen(function* () {
    const actionProposal = proposal(0, TaskId.make("later-owner-conflict"))
    const initial = withProposals(yield* baseEvaluation, [actionProposal], 1)
    const dynamic = yield* dynamicRelation(initial)
    const conflictedId = DeliveryProposalId.make("later-runtime-owner-conflict")
    const conflicted = {
      ...initial,
      proposedActions: {
        _tag: "DeliveryProposalOwnershipConflict" as const,
        conflicts: [{ id: conflictedId, owners: ["TrackerGraph", "TicketDelivery"] }] as const
      }
    }
    const executor = DeliveryActionExecutor.of({
      execute: (action) =>
        dynamic.publish(conflicted).pipe(Effect.as({ _tag: "ActionCompleted", proposalId: action.proposal.id }))
    })
    const failure = yield* runDeliveryRuntimeDecision(dynamic).pipe(
      Effect.provide(identityLayers),
      Effect.provideService(DeliveryActionExecutor, executor),
      Effect.flip
    )

    expect(failure).toBeInstanceOf(DeliveryRuntimeProposalOwnershipConflict)
    if (!(failure instanceof DeliveryRuntimeProposalOwnershipConflict))
      return expect.fail("expected ownership conflict")
    expect(failure.proposalIds).toEqual([conflictedId])
  }).pipe(Effect.scoped)
)

it.effect("does not let a probe satisfy quiescence when work appears before its outcome", () =>
  Effect.gen(function* () {
    const probeProposal = {
      ...trackerGraphReadProposalOf({
        acceptedAt: JournalPosition.make(100),
        purpose: "QuiescenceProbe",
        runId,
        target
      }),
      id: DeliveryProposalId.make("probe-with-concurrent-work")
    }
    const work = proposal(0, TaskId.make("work-revealed-before-probe-outcome"))
    const initial = {
      ...withProposals(yield* baseEvaluation, []),
      quiescence: { _tag: "QuiescenceProbeAllowed" as const }
    }
    const relation = yield* dynamicRelation(initial, undefined, (current) => ({
      ...withProposals(current, [probeProposal]),
      quiescence: { _tag: "QuiescenceProbeAllowed" }
    }))
    const probeStarted = yield* Deferred.make<void>()
    const finishProbe = yield* Deferred.make<void>()
    const workStarted = yield* Deferred.make<void>()
    const executor = DeliveryActionExecutor.of({
      execute: (action) =>
        action.proposal.id === probeProposal.id
          ? Deferred.succeed(probeStarted, undefined).pipe(
              Effect.andThen(Deferred.await(finishProbe)),
              Effect.as({ _tag: "ActionCompleted", proposalId: probeProposal.id } as const)
            )
          : Deferred.succeed(workStarted, undefined).pipe(Effect.andThen(Effect.never))
    })
    const runtime = yield* runDeliveryRuntimeDecision(relation).pipe(
      Effect.provide(identityLayers),
      Effect.provideService(DeliveryActionExecutor, executor),
      Effect.forkChild
    )
    yield* Deferred.await(probeStarted)
    const afterProbeRequest = yield* relation.evaluations.get
    yield* relation.publish({
      ...withProposals(
        { ...afterProbeRequest, revision: DeliveryRelationRevision.make(afterProbeRequest.revision + 1) },
        [probeProposal, work]
      ),
      quiescence: { _tag: "QuiescenceProbeAllowed" }
    })
    yield* Deferred.await(workStarted)
    yield* Deferred.succeed(finishProbe, undefined)
    yield* Fiber.interrupt(runtime)
  }).pipe(Effect.scoped)
)

it.effect("keeps one outstanding quiescence probe request while its relation revision is still empty", () =>
  Effect.gen(function* () {
    const initial = {
      ...withProposals(yield* baseEvaluation, []),
      quiescence: { _tag: "QuiescenceProbeAllowed" as const }
    }
    const state = yield* SubscriptionRef.make(initial)
    const requests = yield* Ref.make(0)
    const requested = yield* Deferred.make<void>()
    const evaluations = { get: SubscriptionRef.get(state), changes: SubscriptionRef.changes(state) }
    const relation = {
      evaluations,
      requestStabilizationRead: () =>
        SubscriptionRef.modify(state, (current) => {
          const revision = DeliveryRelationRevision.make(current.revision + 1)
          return [revision, { ...current, revision }] as const
        }).pipe(
          Effect.tap(() =>
            Ref.update(requests, (count) => count + 1).pipe(Effect.andThen(Deferred.succeed(requested, undefined)))
          )
        ),
      proposedActions: {
        get: evaluations.get.pipe(Effect.map(({ proposedActions }) => proposedActions)),
        changes: evaluations.changes.pipe(Stream.map(({ proposedActions }) => proposedActions))
      }
    } satisfies DeliveryRuntimeInput
    const executor = DeliveryActionExecutor.of({ execute: () => Effect.die("no proposal may execute") })
    const runtime = yield* runDeliveryRuntimeDecision(relation).pipe(
      Effect.provide(identityLayers),
      Effect.provideService(DeliveryActionExecutor, executor),
      Effect.forkChild
    )
    yield* Deferred.await(requested)
    yield* Effect.yieldNow
    yield* Effect.yieldNow
    expect(yield* Ref.get(requests)).toBe(1)
    yield* Fiber.interrupt(runtime)
  }).pipe(Effect.scoped)
)
