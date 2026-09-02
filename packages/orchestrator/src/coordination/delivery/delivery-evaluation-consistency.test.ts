/* eslint-disable import/no-nodejs-modules -- This test also guards the deleted process-revision seam. */
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
import { it } from "@effect/vitest"
import { Deferred, Effect, Fiber, Layer, Queue, Semaphore, Stream, SubscriptionRef } from "effect"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { expect } from "vitest"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { initialRunPolicyRevision, RunControlPolicy } from "../../control/policy.js"
import { OperationId } from "../../workflow/identity.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import {
  makeTaskClaimObservationOperation,
  makeTaskWorktreeObservationOperation,
  makeTargetLineageObservationOperation
} from "../../workflow/registry/operation.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { RunnableFrontierTransition } from "../frontier/frontier.js"
import { makeTestJournaledTrackerGraphObservation } from "../../../test/journaled-graph-observation.js"
import { deliveryRuntime } from "./delivery-runtime-adapter.js"
import { deliveryProposalsOf, trackerGraphReadProposalOf, type DeliveryActionProposal } from "./delivery-proposal.js"
import { deterministicDeliveryRuntimeSupport, makeDeliveryRelationsLayer } from "./in-memory-relations.js"
import {
  currentSignalFromCurrentFirstStream,
  deliveryProposalFrontierOf,
  DeliveryRuntimeAssembly,
  type DeliveryRelationInputBundle,
  TrackerGraphState
} from "./relations.js"
import { projectTrackerSnapshot } from "../../authorities/task-tracker/graph.js"
import { delivery } from "./delivery.js"

const policy = RunControlPolicy.make({
  revision: initialRunPolicyRevision,
  taskExecutionCapacity: TaskWorkCapacity.make(1)
})
const runId = RunId.make("coherent-runtime-evaluation")
const target = FixtureTarget.make("coherent-runtime-evaluation-target")
const proposal = trackerGraphReadProposalOf({ acceptedAt: null, purpose: "EstablishCurrentGraph", runId, target })

const samePositionAttempt = (task: "A" | "C") =>
  PlannedTaskAttempt.make({
    attemptId: AttemptId.make(`same-position-attempt-${task}`),
    baseSha: GitCommitSha.make(task === "A" ? "a".repeat(40) : "c".repeat(40)),
    branch: TaskBranchRef.make(`refs/heads/dalph/same-position-${task}`),
    executor: TaskExecutorLocator.make("executor:same-position-evaluation"),
    runId,
    taskId: TaskId.make(task),
    taskRevision: TaskRevision.make(`same-position-revision-${task}`),
    worktree: WorktreeLocator.make(`/worktrees/same-position-${task}`)
  })

const samePositionA = samePositionAttempt("A")
const samePositionC = samePositionAttempt("C")
const samePositionClaimOperation = makeTaskClaimObservationOperation(
  OperationId.make("same-position-C-claim"),
  target,
  samePositionC.taskId
)
const samePositionWorktreeOperation = makeTaskWorktreeObservationOperation({
  operationId: OperationId.make("same-position-A-worktree"),
  plannedAttempt: samePositionA,
  predecessorOperationIds: []
})
const samePositionLineageOperation = makeTargetLineageObservationOperation({
  integrationTarget: IntegrationTarget.make({
    ref: IntegrationTargetRef.make("refs/heads/main"),
    repository: GitRepositoryLocator.make("/repositories/same-position.git")
  }),
  operationId: OperationId.make("same-position-A-lineage"),
  plannedAttempt: samePositionA,
  predecessorOperationIds: [samePositionWorktreeOperation.operationId]
})
const samePositionClaimTransition = RunnableFrontierTransition.ObservePlannedAttemptContinuationClaim({
  operation: samePositionClaimOperation,
  plannedAttempt: samePositionC
})
const samePositionWorktreeTransition = RunnableFrontierTransition.ObservePlannedAttemptContinuationWorktree({
  operation: samePositionWorktreeOperation,
  plannedAttempt: samePositionA
})
const samePositionLineageTransition = RunnableFrontierTransition.ObservePlannedAttemptContinuationTargetLineage({
  operation: samePositionLineageOperation,
  plannedAttempt: samePositionA
})

const samePositionProposals = (
  aTransition: typeof samePositionWorktreeTransition | typeof samePositionLineageTransition
): ReadonlyArray<DeliveryActionProposal> =>
  deliveryProposalsOf({
    acceptedOperationIds: new Set(),
    fresh: [],
    pendingReadOperationIds: new Set([aTransition.operation.operationId, samePositionClaimOperation.operationId]),
    runId,
    transitions: [aTransition, samePositionClaimTransition]
  }).ticketDelivery

const bundle = (graph: DeliveryRelationInputBundle["publication"]["graph"]): DeliveryRelationInputBundle => ({
  actionInputs: {
    proposalContributions: { deliverySettlement: [], issues: [], ticketDelivery: [] },
    reflectionProposals: [],
    runtimeFacts: {
      acceptedAt: graph._tag === "GraphEstablished" ? graph.observation.recordedAt : null,
      cancellationApplied: false,
      pauseCoverage: {
        _tag: "PauseCoverageGraphNotEstablished",
        applied: { run: { _tag: "RunUnpaused" }, tasks: { _tag: "NoTaskPauses" } }
      },
      quiescence: { _tag: "TrackerReconfirmationAllowed" },
      taskWork: { capacity: policy.taskExecutionCapacity, held: [] }
    },
    trackerGraphProposals: graph._tag === "GraphNotEstablished" ? [proposal] : []
  },
  publication: { exactEvidence: [], graph, policy }
})

it.effect("publishes graph and planned frontier as one coherent runtime evaluation", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const projected = projectTrackerSnapshot({ revision: "accepted-G1", tasks: [] })
      if (projected._tag === "Invalid") return yield* Effect.die("fixture graph must be valid")
      const established = TrackerGraphState.cases.GraphEstablished.make({
        observation: makeTestJournaledTrackerGraphObservation({
          operationId: OperationId.make("accepted-G1-read"),
          recordedAt: JournalPosition.make(2),
          snapshot: projected.snapshot
        })
      })
      const state = yield* SubscriptionRef.make(bundle(TrackerGraphState.cases.GraphNotEstablished.make({})))
      const layer = makeDeliveryRelationsLayer({
        ...deterministicDeliveryRuntimeSupport(policy),
        coherent: currentSignalFromCurrentFirstStream(SubscriptionRef.changes(state))
      })
      const evaluations = yield* deliveryRuntime.pipe(Effect.provide(layer))
      const firstSeen = yield* Deferred.make<void>()
      const collected = yield* evaluations.changes.pipe(
        Stream.tap(() => Deferred.succeed(firstSeen, undefined)),
        Stream.take(2),
        Stream.runCollect,
        Effect.forkChild
      )
      yield* Deferred.await(firstSeen)
      yield* SubscriptionRef.set(state, bundle(established))
      const [before, after] = Array.from(yield* Fiber.join(collected))

      expect(before?.current.trackerGraph._tag).toBe("GraphNotEstablished")
      expect(before?.proposedActions).toMatchObject({ proposals: [{ id: proposal.id }] })
      expect(before?.pauseCoverage).toEqual({
        _tag: "PauseCoverageGraphNotEstablished",
        applied: { run: { _tag: "RunUnpaused" }, tasks: { _tag: "NoTaskPauses" } }
      })
      expect(after?.current.trackerGraph).toEqual(established)
      expect(after?.proposedActions).toEqual({ _tag: "DeliveryProposalsAvailable", isolatedIssues: [], proposals: [] })
    })
  )
)

it.effect("emits every accepted stable publication after repeated current planning samples", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const projected = projectTrackerSnapshot({ revision: "accepted-repeated-G0", tasks: [] })
      if (projected._tag === "Invalid") return yield* Effect.die("fixture graph must be valid")
      const reflectionProposal: DeliveryActionProposal = { ...proposal, owner: "DeliveryReflection" }
      const acceptedOrdinals = [20, 23, 33].map((ordinal) => JournalPosition.make(ordinal))
      const publications = acceptedOrdinals.map((acceptedAt, index): DeliveryRelationInputBundle => {
        const established = TrackerGraphState.cases.GraphEstablished.make({
          observation: makeTestJournaledTrackerGraphObservation({
            operationId: OperationId.make(`accepted-repeated-G0-read-${acceptedAt}`),
            recordedAt: acceptedAt,
            snapshot: projected.snapshot
          })
        })
        const current = bundle(established)
        return {
          ...current,
          actionInputs: {
            ...current.actionInputs,
            reflectionProposals: index === 1 ? [reflectionProposal] : [],
            runtimeFacts: { ...current.actionInputs.runtimeFacts, acceptedAt }
          }
        }
      })
      const [initial, ...later] = publications
      if (initial === undefined) return yield* Effect.die("fixture must contain an initial publication")
      const state = yield* SubscriptionRef.make(initial)
      const publicationGate = yield* Semaphore.make(1)
      const layer = makeDeliveryRelationsLayer({
        publicationConsistency: { withStablePublication: (effect) => publicationGate.withPermit(effect) },
        coherent: currentSignalFromCurrentFirstStream(SubscriptionRef.changes(state))
      })
      const evaluations = yield* deliveryRuntime.pipe(Effect.provide(layer))
      const observed = yield* Queue.unbounded<Effect.Success<typeof evaluations.get>>()
      const collected = yield* evaluations.changes.pipe(
        Stream.tap((evaluation) => Queue.offer(observed, evaluation)),
        Stream.take(publications.length),
        Stream.runCollect,
        Effect.forkChild
      )

      yield* Queue.take(observed)
      for (const publication of later) {
        yield* publicationGate.withPermit(SubscriptionRef.set(state, publication))
        yield* Queue.take(observed)
      }
      const actual = Array.from(yield* Fiber.join(collected))

      expect(
        actual.map(({ acceptedAt, current, proposedActions }) => ({
          acceptedAt,
          graphOperationId:
            current.trackerGraph._tag === "GraphEstablished"
              ? current.trackerGraph.observation.operationId
              : current.trackerGraph._tag,
          graphRecordedAt:
            current.trackerGraph._tag === "GraphEstablished"
              ? current.trackerGraph.observation.recordedAt
              : current.trackerGraph._tag,
          proposalIds:
            proposedActions._tag === "DeliveryProposalsAvailable" ? proposedActions.proposals.map(({ id }) => id) : []
        }))
      ).toEqual(
        acceptedOrdinals.map((acceptedAt, index) => ({
          acceptedAt,
          graphOperationId: OperationId.make(`accepted-repeated-G0-read-${acceptedAt}`),
          graphRecordedAt: acceptedAt,
          proposalIds: index === 1 ? [reflectionProposal.id] : []
        }))
      )
    })
  )
)

it.effect("emits one coherent same-position planning successor before a later accepted sentinel", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const position80 = JournalPosition.make(80)
      const position81 = JournalPosition.make(81)
      const initialBundle = bundle(TrackerGraphState.cases.GraphNotEstablished.make({}))
      const at = (acceptedAt: JournalPosition): DeliveryRelationInputBundle => ({
        ...initialBundle,
        actionInputs: {
          ...initialBundle.actionInputs,
          runtimeFacts: { ...initialBundle.actionInputs.runtimeFacts, acceptedAt, runId }
        }
      })
      const coherent = yield* SubscriptionRef.make(at(position80))
      const worktree = samePositionProposals(samePositionWorktreeTransition)
      const lineage = samePositionProposals(samePositionLineageTransition)
      const worktreeFrontier = deliveryProposalFrontierOf([worktree])
      const lineageFrontier = deliveryProposalFrontierOf([lineage])
      const planning = yield* SubscriptionRef.make(worktreeFrontier)
      const publicationGate = yield* Semaphore.make(1)
      const completedSamples = yield* Queue.unbounded<void>()
      const layer = makeDeliveryRelationsLayer({
        coherent: currentSignalFromCurrentFirstStream(SubscriptionRef.changes(coherent)),
        publicationConsistency: {
          withStablePublication: (effect) =>
            publicationGate.withPermit(effect).pipe(Effect.tap(() => Queue.offer(completedSamples, undefined)))
        }
      })
      const { assembly, consequences } = yield* Effect.all({
        assembly: DeliveryRuntimeAssembly,
        consequences: delivery
      }).pipe(Effect.provide(layer))
      const planningSignal = {
        ...currentSignalFromCurrentFirstStream(SubscriptionRef.changes(planning)),
        getWithinStablePublication: SubscriptionRef.get(planning)
      }
      const evaluations = assembly.of({ delivery: consequences, proposedActions: planningSignal })
      const observed = yield* Queue.unbounded<Effect.Success<typeof evaluations.get>>()
      const collected = yield* evaluations.changes.pipe(
        Stream.tap((evaluation) => Queue.offer(observed, evaluation)),
        Stream.take(3),
        Stream.runCollect,
        Effect.forkChild
      )

      yield* Queue.take(observed)
      yield* Queue.take(completedSamples)
      yield* publicationGate.withPermit(SubscriptionRef.set(planning, lineageFrontier))
      yield* Queue.take(observed)
      yield* Queue.take(completedSamples)
      yield* publicationGate.withPermit(
        SubscriptionRef.set(planning, deliveryProposalFrontierOf([lineage.map((proposal) => ({ ...proposal }))]))
      )
      // The duplicate invalidation has completed its coherent sample before
      // the sentinel can advance. A missing structural dedupe would therefore
      // make that duplicate, rather than position 81, the third observation.
      yield* Queue.take(completedSamples)
      yield* publicationGate.withPermit(SubscriptionRef.set(coherent, at(position81)))
      yield* Queue.take(observed)

      const actual = Array.from(yield* Fiber.join(collected))
      expect(
        actual.map(({ acceptedAt, proposedActions }) => ({
          acceptedAt,
          proposalIds:
            proposedActions._tag === "DeliveryProposalsAvailable"
              ? proposedActions.proposals.map(({ id }) => id)
              : proposedActions.conflicts.map(({ id }) => id)
        }))
      ).toEqual([
        { acceptedAt: position80, proposalIds: worktree.map(({ id }) => id) },
        { acceptedAt: position80, proposalIds: lineage.map(({ id }) => id) },
        { acceptedAt: position81, proposalIds: lineage.map(({ id }) => id) }
      ])
    })
  )
)

it.effect("a replacement runtime assembly immediately exposes the current same-position lineage successor", () =>
  Effect.gen(function* () {
    const position80 = JournalPosition.make(80)
    const initialBundle = bundle(TrackerGraphState.cases.GraphNotEstablished.make({}))
    const atPosition80: DeliveryRelationInputBundle = {
      ...initialBundle,
      actionInputs: {
        ...initialBundle.actionInputs,
        runtimeFacts: { ...initialBundle.actionInputs.runtimeFacts, acceptedAt: position80, runId }
      }
    }
    const coherent = yield* SubscriptionRef.make(atPosition80)
    const worktree = samePositionProposals(samePositionWorktreeTransition)
    const lineage = samePositionProposals(samePositionLineageTransition)
    const planning = yield* SubscriptionRef.make(deliveryProposalFrontierOf([worktree]))
    const publicationGate = yield* Semaphore.make(1)

    const observeCurrentEvaluationInFreshScope = () =>
      Effect.scoped(
        Effect.gen(function* () {
          const { assembly, consequences } = yield* Effect.all({
            assembly: DeliveryRuntimeAssembly,
            consequences: delivery
          })
          const planningSignal = {
            ...currentSignalFromCurrentFirstStream(SubscriptionRef.changes(planning)),
            getWithinStablePublication: SubscriptionRef.get(planning)
          }
          const attachment = yield* assembly.of({ delivery: consequences, proposedActions: planningSignal }).attach
          return attachment.current
        }).pipe(
          Effect.provide(
            Layer.fresh(
              makeDeliveryRelationsLayer({
                coherent: currentSignalFromCurrentFirstStream(SubscriptionRef.changes(coherent)),
                publicationConsistency: { withStablePublication: (effect) => publicationGate.withPermit(effect) }
              })
            )
          )
        )
      )

    const scope1Current = yield* observeCurrentEvaluationInFreshScope()
    expect(scope1Current).toMatchObject({
      acceptedAt: position80,
      proposedActions: { _tag: "DeliveryProposalsAvailable", proposals: worktree.map(({ id }) => ({ id })) }
    })

    yield* publicationGate.withPermit(SubscriptionRef.set(planning, deliveryProposalFrontierOf([lineage])))

    const scope2Current = yield* observeCurrentEvaluationInFreshScope()
    expect(scope2Current).toMatchObject({
      acceptedAt: position80,
      proposedActions: { _tag: "DeliveryProposalsAvailable", proposals: lineage.map(({ id }) => ({ id })) }
    })
  })
)

it("removes process revisions and general invalidation from runtime assembly", () => {
  const sources = ["./relations.ts", "./in-memory-relations.ts", "./delivery-runtime-adapter.ts"].map((path) =>
    readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8")
  )
  expect(sources.join("\n")).not.toMatch(/DeliveryRelationRevision|currentRevision|withStableRevision|invalidate/)
})

it("acknowledges the bounded post-G2 event cut without relation version authority", () => {
  const runtime = readFileSync(fileURLToPath(new URL("./run-delivery-runtime.ts", import.meta.url)), "utf8")
  const relation = readFileSync(fileURLToPath(new URL("./relations.ts", import.meta.url)), "utf8")
  const quiescence = readFileSync(fileURLToPath(new URL("./delivery-runtime-quiescence.ts", import.meta.url)), "utf8")
  const journalEvents = readFileSync(
    fileURLToPath(new URL("../../workflow/registry/event.ts", import.meta.url)),
    "utf8"
  )

  expect(runtime).toContain('Queue.offer(events, { _tag: "PostG2AdmissionStallCut", token: offeredToken.value })')
  expect(runtime).toContain('emit({ _tag: "PostG2AdmissionStallCutApplied", token: event.token })')
  expect(quiescence).toContain('Schema.brand("PostG2AdmissionStallCutToken")')
  expect([relation, journalEvents].join("\n")).not.toMatch(
    /PostG2AdmissionStallCutToken|PostG2AdmissionStallCut|DeliveryRelationRevision/
  )
})
