/* eslint-disable import/no-nodejs-modules -- This file also guards the accepted literal source shape. */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { it } from "@effect/vitest"
import {
  AttemptId,
  GitCommitSha,
  PlannedAttemptExecutorReport,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { Deferred, Effect, Exit, Fiber, Option, Schema, Stream, SubscriptionRef } from "effect"
import { expect } from "vitest"
import { TaskDagSnapshot } from "../../authorities/task-tracker/graph.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { TaskLifecycle, TrackerRevision, TrackerSnapshot, type Task } from "../../authorities/task-tracker/task.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { initialRunPolicyRevision, RunControlPolicy } from "../../control/policy.js"
import { JournalPosition, JournalRecordKey } from "../../workflow-journal/identity.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import { OperationId } from "../../workflow/identity.js"
import { delivery } from "./delivery.js"
import { deliveryActionPlanning } from "./delivery-action-planning.js"
import { deliveryRuntime } from "./delivery-runtime-adapter.js"
import {
  TrackerGraphRelation,
  boundedParallelTickets,
  currentSignalOf,
  deliveryFinalityOf,
  deliverySettlements,
  executorResponsibilities,
  currentSignalFromCurrentFirstStream,
  mapCurrentSignal,
  PlannedAttemptExecutorTerminalEvidence,
  TrackerGraphState,
  zipCurrentSignals,
  type DeliveryRelationInputBundle,
  type DeliveryConsequences,
  type CurrentSignal,
  type TicketDeliveryEvidence
} from "./relations.js"
import { makeTestJournaledTrackerGraphObservation } from "../../../test/journaled-graph-observation.js"
import {
  deterministicDeliveryRuntimeSupport,
  makeDeliveryRelationsLayer as makeDeliveryRelationsLayerWithRuntime
} from "./in-memory-relations.js"
import {
  DeliveryProposalOrdinal,
  DeliveryProposalId,
  deliveryProposalsOf,
  trackerGraphReadProposalOf,
  type DeliveryProposalContributions
} from "./delivery-proposal.js"
import { FreshWorkflowStep } from "./fresh-workflow-step.js"
import { RunnableFrontierTransition } from "../frontier/frontier.js"
import { ResponsibilityDisposition } from "../frontier/fresh-facts.js"
import { frontierOf } from "./ticket-delivery-projection.js"
import { integrationFinalityFixture } from "../../workflow/protocols/integration-finality/fixtures.js"
import { StartedIntegrationResponsibility } from "../../workflow/protocols/integration-admission/protocol.js"
import { TargetPromotionState } from "../../workflow/protocols/target-promotion/state.js"
import { journaledIntegrationEvidenceOf } from "./delivery-evidence.js"
import {
  CompletionTaskIntendedEvent,
  IntegrationFinalitySettledEvent
} from "../../workflow/protocols/integration-finality/events.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"

const policy = RunControlPolicy.make({
  revision: initialRunPolicyRevision,
  taskExecutionCapacity: TaskWorkCapacity.make(1)
})

type DeliveryConsequencesPublicKeys =
  | "_tag"
  | "graph"
  | "frontier"
  | "tickets"
  | "ticketDeliveries"
  | "settlements"
  | "trackerConsequences"
type ExactKeys<Actual, Expected> = [Actual] extends [Expected] ? ([Expected] extends [Actual] ? true : false) : false
const deliveryConsequencesKeyContract: ExactKeys<
  Extract<keyof DeliveryConsequences, string>,
  DeliveryConsequencesPublicKeys
> = true

const makeDeliveryRelationsLayer = (
  input: Omit<
    Parameters<typeof makeDeliveryRelationsLayerWithRuntime>[0],
    "publicationConsistency" | "runtimeFacts" | "coherent"
  > & {
    readonly graph: CurrentSignal<TrackerGraphState>
    readonly exactEvidence: CurrentSignal<ReadonlyArray<TicketDeliveryEvidence>>
    readonly policy: CurrentSignal<RunControlPolicy>
  }
) => {
  const coherent = mapCurrentSignal(
    zipCurrentSignals(zipCurrentSignals(input.graph, input.exactEvidence), input.policy),
    ([[graph, exactEvidence], currentPolicy]): DeliveryRelationInputBundle => ({
      actionInputs: {
        proposalContributions: { deliverySettlement: [], issues: [], ticketDelivery: [] },
        reflectionProposals: [],
        runtimeFacts: {
          acceptedAt: null,
          cancellationApplied: false,
          pauseCoverage: {
            _tag: "PauseCoverageGraphNotEstablished",
            applied: { run: { _tag: "RunUnpaused" }, tasks: { _tag: "NoTaskPauses" } }
          },
          quiescence: { _tag: "TrackerReconfirmationAllowed" },
          taskWork: { capacity: currentPolicy.taskExecutionCapacity, held: [], preStart: [] }
        },
        trackerGraphProposals: []
      },
      publication: { exactEvidence, graph, policy: currentPolicy }
    })
  )
  return makeDeliveryRelationsLayerWithRuntime({ ...deterministicDeliveryRuntimeSupport(policy), ...input, coherent })
}

const journaledGraph = (revision: string, taskIds: ReadonlyArray<TaskId> = [], completed = false) => {
  const projected = TaskDagSnapshot.project(
    TrackerSnapshot.make({
      revision: TrackerRevision.make(revision),
      tasks: taskIds.map((id) => ({
        id,
        lifecycle: completed ? TaskLifecycle.cases.CompletedSuccessfully.make({}) : TaskLifecycle.cases.Open.make({}),
        parentTaskId: null,
        prerequisiteIds: []
      }))
    })
  )
  if (projected._tag === "Invalid") return expect.fail("test graph must be valid")
  return projected.snapshot
}

const journaledGraphState = (snapshot: ReturnType<typeof journaledGraph>) =>
  TrackerGraphState.cases.GraphEstablished.make({
    observation: makeTestJournaledTrackerGraphObservation({
      snapshot,
      operationId: OperationId.make(`fixture:${snapshot.revision}`),
      recordedAt: JournalPosition.make(1)
    })
  })

const exactAttemptEvidence = (taskId: TaskId) => ({
  _tag: "ResponsibilityFacts" as const,
  facts: {
    _tag: "PlannedAttemptExecutorFreshFacts" as const,
    disposition: {
      _tag: "Ready" as const,
      acceptedProgress: { _tag: "ExecutorResponsibilityBegan" as const, acceptedAt: JournalPosition.make(2) }
    },
    responsibility: {
      _tag: "PlannedAttemptExecutorWorkResponsibility" as const,
      beganAt: JournalPosition.make(2),
      plannedAttempt: PlannedTaskAttempt.make({
        attemptId: AttemptId.make(`attempt:${taskId}`),
        baseSha: GitCommitSha.make("1".repeat(40)),
        branch: TaskBranchRef.make(`refs/heads/dalph/${taskId}`),
        executor: TaskExecutorLocator.make("executor:fake"),
        runId: RunId.make("run-reactive-delivery"),
        taskId,
        taskRevision: TaskRevision.make(`revision:${taskId}`),
        worktree: WorktreeLocator.make(`/worktrees/${taskId}`)
      })
    }
  }
})

const releaseChronologyEvidence = (focusedSuccessAt: number, settled = false) => {
  const fixture = integrationFinalityFixture
  const responsibility = StartedIntegrationResponsibility.make({
    acceptedResult: fixture.promotionCorrelation.qualifiedCandidate.run.session.acceptedResult,
    integrationTarget: fixture.integrationTarget,
    plannedAttempt: fixture.plannedAttempt,
    queuedAt: JournalPosition.make(2),
    startedAt: JournalPosition.make(3)
  })
  const promotion = TargetPromotionState.cases.PromotionSucceeded.make({
    basis: fixture.promotionSuccess.basis,
    correlation: fixture.promotionCorrelation,
    observation: fixture.promotionSuccess.observation
  })
  const focusedRecord: JournalRecord = {
    event: fixture.focusedSuccessFactsEvent,
    key: JournalRecordKey.make(`delivery-planning-focused-success:${focusedSuccessAt}`),
    position: JournalPosition.make(focusedSuccessAt),
    runId: fixture.runId
  }
  const completionIntentRecord: JournalRecord = {
    event: CompletionTaskIntendedEvent.make({
      request: fixture.completionRequest,
      version: workflowJournalEventVersion
    }),
    key: JournalRecordKey.make(`delivery-planning-completion-intent:${focusedSuccessAt}`),
    position: JournalPosition.make(focusedSuccessAt - 1),
    runId: fixture.runId
  }
  const settlement = IntegrationFinalitySettledEvent.make({
    claim: fixture.claim,
    deletionOperationId: OperationId.make("issue-61-release-deletion"),
    replacementOperationId: OperationId.make("issue-61-release-replacement"),
    successObservation: fixture.successObservation,
    version: workflowJournalEventVersion
  })
  return [
    { _tag: "StartedIntegration" as const, responsibility },
    { _tag: "TargetPromotion" as const, responsibility, state: promotion },
    ...journaledIntegrationEvidenceOf([completionIntentRecord, focusedRecord]),
    ...(settled ? [{ _tag: "IntegrationFinalitySettlement" as const, settlement }] : [])
  ]
}
it.effect("assembles the literal delivery relation with honestly empty settlements", () =>
  Effect.gen(function* () {
    const layer = makeDeliveryRelationsLayer({
      graph: currentSignalOf(TrackerGraphState.cases.GraphNotEstablished.make({})),
      exactEvidence: currentSignalOf([]),
      policy: currentSignalOf(policy)
    })
    const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))

    const first = Array.from(yield* Stream.runCollect(relation.changes)).map(({ current }) => current)
    const second = Array.from(yield* Stream.runCollect(relation.changes)).map(({ current }) => current)

    expect(first).toHaveLength(1)
    expect(second).toEqual(first)
    expect(first[0]?.ticketDeliveries.deliveries).toEqual([])
    expect(first[0]?.settlements.settlements).toEqual([])
  })
)

it.effect("exposes only descriptive DeliveryConsequences fields", () =>
  Effect.gen(function* () {
    const layer = makeDeliveryRelationsLayer({
      graph: currentSignalOf(TrackerGraphState.cases.GraphNotEstablished.make({})),
      exactEvidence: currentSignalOf([]),
      policy: currentSignalOf(policy)
    })
    const signal = yield* delivery.pipe(Effect.provide(layer))
    const value = Option.getOrThrow(yield* signal.changes.pipe(Stream.runHead))

    expect(deliveryConsequencesKeyContract).toBe(true)
    expect(Object.keys(value).toSorted()).toEqual([
      "_tag",
      "frontier",
      "graph",
      "settlements",
      "ticketDeliveries",
      "tickets",
      "trackerConsequences"
    ])
    expect(Object.getOwnPropertySymbols(value)).toHaveLength(1)
    for (const forbiddenKey of [
      "actionExecution",
      "actionExecutor",
      "execute",
      "executor",
      "proposedActions",
      "proposalContributions",
      "proposals",
      "runtimeFacts",
      "taskWork",
      "held",
      "ownership",
      "resources",
      "invalidate",
      "revision",
      "quiescence",
      "finality",
      "route",
      "routes"
    ]) {
      expect(value).not.toHaveProperty(forbiddenKey)
    }
  })
)

it.effect("rejects nonterminal executor reports as terminal delivery evidence", () =>
  Effect.gen(function* () {
    const correlation = { attemptId: AttemptId.make("attempt-A"), runId: RunId.make("run-A") }
    const reports = [
      PlannedAttemptExecutorReport.cases.Running.make({ correlation }),
      PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation })
    ]

    for (const report of reports) {
      const decoded = yield* Effect.exit(
        Schema.decodeUnknownEffect(PlannedAttemptExecutorTerminalEvidence)({
          _tag: "PlannedAttemptExecutorTerminal",
          report
        })
      )
      expect(Exit.isFailure(decoded)).toBe(true)
    }
  })
)

it.effect("keeps a proposed delivery unsettled until ordinary evidence advances it", () =>
  Effect.gen(function* () {
    const taskId = TaskId.make("proposed-finality")
    const relation = yield* deliveryRuntime.pipe(
      Effect.provide(
        makeDeliveryRelationsLayer({
          exactEvidence: currentSignalOf([]),
          graph: currentSignalOf(TrackerGraphState.cases.GraphNotEstablished.make({})),
          policy: currentSignalOf(policy)
        })
      )
    )
    const current = Option.getOrThrow(
      yield* relation.changes.pipe(
        Stream.map(({ current: snapshot }) => snapshot),
        Stream.runHead
      )
    )

    expect(
      deliveryFinalityOf(
        {
          ...current,
          ticketDeliveries: {
            ...current.ticketDeliveries,
            deliveries: [
              {
                _tag: "TicketDelivery",
                evidence: [],
                obligations: [],
                placement: { _tag: "GraphNotEstablished" },
                standings: [{ _tag: "ProposedDelivery" }],
                taskId
              }
            ]
          }
        },
        { _tag: "DeliveryProposalsAvailable", isolatedIssues: [], proposals: [] },
        { _tag: "TrackerReconfirmationAllowed" }
      )
    ).toEqual({ _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" })
  })
)

it.effect("lets a completed tracker target terminate after exact integration finality settles", () =>
  Effect.gen(function* () {
    const fixture = integrationFinalityFixture
    const relation = yield* deliveryRuntime.pipe(
      Effect.provide(
        makeDeliveryRelationsLayer({
          exactEvidence: currentSignalOf(releaseChronologyEvidence(5, true)),
          graph: currentSignalOf(journaledGraphState(journaledGraph("finality-settled", [fixture.taskId], true))),
          policy: currentSignalOf(policy)
        })
      )
    )
    const current = Option.getOrThrow(
      yield* relation.changes.pipe(
        Stream.map(({ current: snapshot }) => snapshot),
        Stream.runHead
      )
    )

    const delivery = current.ticketDeliveries.deliveries[0]
    if (delivery === undefined) return yield* Effect.die("fixture must project one ticket delivery")
    const settledStanding = delivery.standings.find((standing) => standing._tag === "IntegrationFinalitySettled")
    if (settledStanding === undefined) return yield* Effect.die("fixture must project exact integration finality")
    const settledCurrent = {
      ...current,
      ticketDeliveries: {
        ...current.ticketDeliveries,
        deliveries: [{ ...delivery, obligations: [] as const, standings: [settledStanding] as const }]
      }
    }
    expect(
      deliveryFinalityOf(
        settledCurrent,
        { _tag: "DeliveryProposalsAvailable", isolatedIssues: [], proposals: [] },
        { _tag: "TrackerReconfirmationAllowed" }
      )
    ).toEqual({ _tag: "RunMayTerminate" })
  })
)

it.effect("treats a fully disposed cancelled attempt as settled for Run finality", () =>
  Effect.gen(function* () {
    const fixture = integrationFinalityFixture
    const relation = yield* deliveryRuntime.pipe(
      Effect.provide(
        makeDeliveryRelationsLayer({
          exactEvidence: currentSignalOf(releaseChronologyEvidence(5, true)),
          graph: currentSignalOf(
            journaledGraphState(journaledGraph("cancelled-attempt-settled", [fixture.taskId], true))
          ),
          policy: currentSignalOf(policy)
        })
      )
    )
    const current = Option.getOrThrow(
      yield* relation.changes.pipe(
        Stream.map(({ current: snapshot }) => snapshot),
        Stream.runHead
      )
    )
    const delivery = current.ticketDeliveries.deliveries[0]
    if (delivery === undefined) return yield* Effect.die("fixture must project one ticket delivery")
    const cancelledAttemptStanding = {
      _tag: "ResponsibilitySituation" as const,
      facts: {
        _tag: "PlannedAttemptExecutorFreshFacts" as const,
        disposition: ResponsibilityDisposition.CancelledAttemptSettled({ claimDisposition: "Released" }),
        responsibility: {
          _tag: "PlannedAttemptExecutorWorkResponsibility" as const,
          beganAt: JournalPosition.make(1),
          plannedAttempt: fixture.plannedAttempt
        }
      }
    }
    expect(
      deliveryFinalityOf(
        {
          ...current,
          cancellationApplied: true,
          ticketDeliveries: {
            ...current.ticketDeliveries,
            deliveries: [{ ...delivery, standings: [{ _tag: "ProposedDelivery" }, cancelledAttemptStanding] }]
          }
        },
        { _tag: "DeliveryProposalsAvailable", isolatedIssues: [], proposals: [] },
        { _tag: "TrackerReconfirmationAllowed" }
      )
    ).toEqual({ _tag: "RunMayTerminate" })
  })
)

it.effect("keeps a settled journaled graph active while the Run is paused", () =>
  Effect.gen(function* () {
    const layer = makeDeliveryRelationsLayer({
      exactEvidence: currentSignalOf([]),
      graph: currentSignalOf(journaledGraphState(journaledGraph("paused-settled"))),
      policy: currentSignalOf(policy)
    })
    const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))
    const current = Option.getOrThrow(
      yield* relation.changes.pipe(
        Stream.map(({ current }) => current),
        Stream.runHead
      )
    )

    expect(
      deliveryFinalityOf(
        current,
        { _tag: "DeliveryProposalsAvailable", isolatedIssues: [], proposals: [] },
        { _tag: "QuiescencePassive", reason: "RunPaused" }
      )
    ).toEqual({ _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" })
    expect(
      deliveryFinalityOf(
        current,
        {
          _tag: "DeliveryProposalOwnershipConflict",
          conflicts: [
            {
              id: DeliveryProposalId.make("finality-owner-conflict"),
              order: { _tag: "TrackerGraphOrder", acceptedAt: null },
              owners: ["TrackerGraph", "TicketDelivery"]
            }
          ]
        },
        { _tag: "TrackerReconfirmationAllowed" }
      )
    ).toEqual({ _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" })
  })
)

it.effect("keeps every descriptive subscription action-free", () =>
  Effect.gen(function* () {
    const layer = makeDeliveryRelationsLayer({
      graph: currentSignalOf(TrackerGraphState.cases.GraphNotEstablished.make({})),
      exactEvidence: currentSignalOf([]),
      policy: currentSignalOf(policy)
    })
    const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))

    const first = Array.from(yield* Stream.runCollect(relation.changes)).map(({ proposedActions }) => proposedActions)
    const second = Array.from(yield* Stream.runCollect(relation.changes)).map(({ proposedActions }) => proposedActions)
    expect(first).toEqual([{ _tag: "DeliveryProposalsAvailable", isolatedIssues: [], proposals: [] }])
    expect(second).toEqual(first)
  })
)

it.effect("exposes each lower proposal stream without performing an action", () =>
  Effect.gen(function* () {
    const layer = makeDeliveryRelationsLayer({
      graph: currentSignalOf(TrackerGraphState.cases.GraphNotEstablished.make({})),
      exactEvidence: currentSignalOf([]),
      policy: currentSignalOf(policy)
    })
    const lower = yield* Effect.gen(function* () {
      const tracker = yield* TrackerGraphRelation
      const frontier = mapCurrentSignal(tracker.signal, frontierOf)
      const tickets = yield* boundedParallelTickets(frontier)
      const responsibilities = yield* executorResponsibilities(tickets)
      const settlements = yield* deliverySettlements(responsibilities)
      return { responsibilities, settlements }
    }).pipe(Effect.provide(layer))

    expect(Array.from(yield* Stream.runCollect(lower.responsibilities.proposedActions.changes))).toEqual([[]])
    expect(Array.from(yield* Stream.runCollect(lower.settlements.proposedActions.changes))).toEqual([[]])
  })
)

it.effect("cannot carry an initial graph-read proposal into an established graph revision", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const proposal = trackerGraphReadProposalOf({
        acceptedAt: JournalPosition.make(1),
        purpose: "EstablishCurrentGraph",
        runId: RunId.make("causal-tracker-proposal"),
        target: FixtureTarget.make("causal-tracker-proposal-target")
      })
      const graphState = yield* SubscriptionRef.make(TrackerGraphState.cases.GraphNotEstablished.make({}))
      const relation = yield* deliveryRuntime.pipe(
        Effect.provide(
          makeDeliveryRelationsLayer({
            exactEvidence: currentSignalOf([]),
            graph: currentSignalFromCurrentFirstStream(SubscriptionRef.changes(graphState)),
            policy: currentSignalOf(policy),
            trackerGraphProposals: currentSignalOf([proposal])
          })
        )
      )

      const firstObserved = yield* Deferred.make<void>()
      const collected = yield* relation.changes.pipe(
        Stream.map(({ proposedActions }) => proposedActions),
        Stream.tap(() => Deferred.succeed(firstObserved, undefined)),
        Stream.take(2),
        Stream.runCollect,
        Effect.forkChild
      )
      yield* Deferred.await(firstObserved)
      yield* SubscriptionRef.set(graphState, journaledGraphState(journaledGraph("causal-established")))
      const frontiers = Array.from(yield* Fiber.join(collected))

      expect(frontiers[0]).toMatchObject({
        _tag: "DeliveryProposalsAvailable",
        proposals: [{ id: proposal.id, route: { purpose: "EstablishCurrentGraph" } }]
      })
      expect(frontiers.at(-1)).toEqual({ _tag: "DeliveryProposalsAvailable", isolatedIssues: [], proposals: [] })
    })
  )
)

it.effect("derives one stable proposal from a persistent delivery consequence without performing it", () =>
  Effect.gen(function* () {
    const task: Task = {
      id: TaskId.make("current-action-task"),
      lifecycle: TaskLifecycle.cases.Open.make({}),
      parentTaskId: null,
      prerequisiteIds: []
    }
    const predecessorOperationId = OperationId.make("current-action-predecessor")
    const step = FreshWorkflowStep.AcquireTaskClaim({ predecessorOperationId, task })
    const transition = RunnableFrontierTransition.CommitFreshTaskClaimIntent({
      taskId: task.id,
      taskRevision: TaskRevision.make("current-action-revision")
    })
    const lowerProposal = deliveryProposalsOf({
      acceptedOperationIds: new Set(),
      fresh: [{ step, transition }],
      runId: RunId.make("current-action-run"),
      transitions: [transition]
    }).ticketDelivery[0]
    if (lowerProposal === undefined) return yield* Effect.die("fixture must derive a lower proposal")
    const layer = makeDeliveryRelationsLayer({
      exactEvidence: currentSignalOf([]),
      graph: currentSignalOf(journaledGraphState(journaledGraph("canonical-delivery-current"))),
      policy: currentSignalOf(policy),
      proposalContributions: currentSignalOf({ deliverySettlement: [], issues: [], ticketDelivery: [lowerProposal] }),
      trackerGraphProposals: currentSignalOf([])
    })
    const { current, first, second, trackerProposals } = yield* Effect.gen(function* () {
      const consequences = yield* delivery
      const proposals = yield* deliveryActionPlanning(consequences)
      const tracker = yield* TrackerGraphRelation
      return {
        current: Option.getOrThrow(yield* consequences.changes.pipe(Stream.runHead)),
        first: yield* proposals.get,
        second: yield* proposals.get,
        trackerProposals: yield* tracker.proposedActions.get
      }
    }).pipe(Effect.provide(layer))

    expect(current.graph._tag).toBe("GraphEstablished")
    if (current.graph._tag === "GraphEstablished") {
      expect(current.graph.observation.snapshot.revision).toBe("canonical-delivery-current")
    }
    expect(second).toEqual(first)
    expect(first).toMatchObject({ _tag: "DeliveryProposalsAvailable", proposals: [lowerProposal] })
    expect(trackerProposals).toEqual([])
    expect(lowerProposal.actionIdentity._tag).toBe("FreshOperationIdRequired")
  })
)

it.effect("keeps B out of actual proposals after settlement until focused A success precedes the releasing graph", () =>
  Effect.gen(function* () {
    const fixture = integrationFinalityFixture
    const taskB = TaskId.make("issue-61-dependant-B")
    const graphFor = (recordedAt: number) => {
      const projected = TaskDagSnapshot.project(
        TrackerSnapshot.make({
          revision: TrackerRevision.make(`issue-61-release-graph:${recordedAt}`),
          tasks: [
            {
              id: fixture.taskId,
              lifecycle: TaskLifecycle.cases.CompletedSuccessfully.make({}),
              parentTaskId: null,
              prerequisiteIds: []
            },
            {
              id: taskB,
              lifecycle: TaskLifecycle.cases.Open.make({}),
              parentTaskId: null,
              prerequisiteIds: [fixture.taskId]
            }
          ]
        })
      )
      if (projected._tag === "Invalid") return expect.fail("issue-61 proposal graph must be valid")
      return TrackerGraphState.cases.GraphEstablished.make({
        observation: makeTestJournaledTrackerGraphObservation({
          operationId: OperationId.make(`issue-61-release-graph:${recordedAt}`),
          recordedAt: JournalPosition.make(recordedAt),
          snapshot: projected.snapshot
        })
      })
    }
    const task: Task = {
      id: taskB,
      lifecycle: TaskLifecycle.cases.Open.make({}),
      parentTaskId: null,
      prerequisiteIds: [fixture.taskId]
    }
    const step = FreshWorkflowStep.AcquireTaskClaim({
      predecessorOperationId: OperationId.make("issue-61-releasing-graph"),
      task
    })
    const transition = RunnableFrontierTransition.CommitFreshTaskClaimIntent({
      taskId: taskB,
      taskRevision: TaskRevision.make("issue-61-dependant-revision")
    })
    const proposal = deliveryProposalsOf({
      acceptedOperationIds: new Set(),
      fresh: [{ step, transition }],
      runId: fixture.runId,
      transitions: [transition]
    }).ticketDelivery[0]
    if (proposal === undefined) return yield* Effect.die("issue-61 fixture must derive B's fresh proposal")
    const contributions = currentSignalOf({ deliverySettlement: [], issues: [], ticketDelivery: [proposal] })
    const proposalsFor = (recordedAt: number, evidence: ReadonlyArray<TicketDeliveryEvidence>) => {
      const layer = makeDeliveryRelationsLayer({
        exactEvidence: currentSignalOf(evidence),
        graph: currentSignalOf(graphFor(recordedAt)),
        policy: currentSignalOf(policy),
        proposalContributions: contributions
      })
      return Effect.gen(function* () {
        const consequences = yield* delivery
        return yield* (yield* deliveryActionPlanning(consequences)).get
      }).pipe(Effect.provide(layer))
    }

    const exactEvidence = releaseChronologyEvidence(9)
    const settledExactEvidence = releaseChronologyEvidence(9, true)
    expect(yield* proposalsFor(8, exactEvidence)).toMatchObject({ _tag: "DeliveryProposalsAvailable", proposals: [] })
    expect(yield* proposalsFor(8, settledExactEvidence)).toMatchObject({
      _tag: "DeliveryProposalsAvailable",
      proposals: []
    })
    expect(yield* proposalsFor(10, exactEvidence)).toMatchObject({
      _tag: "DeliveryProposalsAvailable",
      proposals: [proposal]
    })
    expect(yield* proposalsFor(10, settledExactEvidence)).toMatchObject({
      _tag: "DeliveryProposalsAvailable",
      proposals: [proposal]
    })
    expect(yield* proposalsFor(8, [])).toMatchObject({ _tag: "DeliveryProposalsAvailable", proposals: [proposal] })
  })
)

it.effect("fails closed when two owners claim one proposal identity", () =>
  Effect.gen(function* () {
    const proposal = trackerGraphReadProposalOf({
      acceptedAt: JournalPosition.make(1),
      purpose: "EstablishCurrentGraph",
      runId: RunId.make("proposal-conflict"),
      target: FixtureTarget.make("proposal-conflict-target")
    })
    const layer = makeDeliveryRelationsLayer({
      exactEvidence: currentSignalOf([]),
      graph: currentSignalOf(TrackerGraphState.cases.GraphNotEstablished.make({})),
      policy: currentSignalOf(policy),
      proposalContributions: currentSignalOf({
        deliverySettlement: [{ ...proposal, owner: "DeliverySettlement" }],
        issues: [],
        ticketDelivery: [{ ...proposal, owner: "TicketDelivery" }]
      }),
      trackerGraphProposals: currentSignalOf([proposal])
    })
    const { frontier, runtimeFrontier } = yield* Effect.gen(function* () {
      const consequences = yield* delivery
      const proposals = yield* deliveryActionPlanning(consequences)
      const runtime = yield* deliveryRuntime
      return { frontier: yield* proposals.get, runtimeFrontier: (yield* runtime.get).proposedActions }
    }).pipe(Effect.provide(layer))

    expect(frontier).toEqual({
      _tag: "DeliveryProposalOwnershipConflict",
      conflicts: [
        { id: proposal.id, order: proposal.order, owners: ["TrackerGraph", "TicketDelivery", "DeliverySettlement"] }
      ]
    })
    expect(runtimeFrontier).toEqual(frontier)
  })
)

it.effect("combines every proposal owner in accepted order", () =>
  Effect.gen(function* () {
    const target = FixtureTarget.make("proposal-composition-target")
    const proposalFor = (
      ordinal: number,
      owner: "DeliveryReflection" | "DeliverySettlement" | "TicketDelivery" | "TrackerGraph"
    ) => ({
      ...trackerGraphReadProposalOf({
        acceptedAt: JournalPosition.make(ordinal + 2),
        purpose: "EstablishCurrentGraph",
        runId: RunId.make("proposal-composition"),
        target: FixtureTarget.make(`proposal-composition-target-${ordinal}`)
      }),
      order: {
        _tag: "RecoveredWorkflowOrder" as const,
        acceptedAt: JournalPosition.make(1),
        frontierOrdinal: DeliveryProposalOrdinal.make(ordinal),
        responsibilityBeganAt: null,
        taskId: TaskId.make(`proposal-owner-${ordinal}`),
        transition: "CheckTaskClaim" as const
      },
      owner
    })
    const tracker = trackerGraphReadProposalOf({
      acceptedAt: JournalPosition.make(1),
      purpose: "EstablishCurrentGraph",
      runId: RunId.make("proposal-composition"),
      target
    })
    const ticket = proposalFor(2, "TicketDelivery")
    const settlement = proposalFor(0, "DeliverySettlement")
    const reflection = proposalFor(1, "DeliveryReflection")
    const isolatedIssue = {
      _tag: "FreshRouteProvenanceMissing" as const,
      taskId: TaskId.make("isolated-owner-task"),
      transition: "CommitFreshTaskClaimIntent" as const
    }
    const layer = makeDeliveryRelationsLayer({
      exactEvidence: currentSignalOf([]),
      graph: currentSignalOf(TrackerGraphState.cases.GraphNotEstablished.make({})),
      policy: currentSignalOf(policy),
      proposalContributions: currentSignalOf({
        deliverySettlement: [settlement],
        issues: [isolatedIssue],
        ticketDelivery: [ticket]
      }),
      reflectionProposals: currentSignalOf([reflection]),
      trackerGraphProposals: currentSignalOf([tracker])
    })
    const frontier = yield* Effect.gen(function* () {
      const consequences = yield* delivery
      const proposals = yield* deliveryActionPlanning(consequences)
      return yield* proposals.get
    }).pipe(Effect.provide(layer))

    expect(frontier._tag).toBe("DeliveryProposalsAvailable")
    if (frontier._tag === "DeliveryProposalsAvailable") {
      expect(frontier.proposals.map(({ owner }) => owner)).toEqual([
        "DeliverySettlement",
        "DeliveryReflection",
        "TicketDelivery",
        "TrackerGraph"
      ])
      expect(frontier.isolatedIssues).toEqual([isolatedIssue])
    }
  })
)

it.effect("changes the proposal frontier when its accepted fact signal changes", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const task: Task = {
        id: TaskId.make("accepted-fact-task"),
        lifecycle: TaskLifecycle.cases.Open.make({}),
        parentTaskId: null,
        prerequisiteIds: []
      }
      const step = FreshWorkflowStep.AcquireTaskClaim({
        predecessorOperationId: OperationId.make("accepted-fact-graph"),
        task
      })
      const transition = RunnableFrontierTransition.CommitFreshTaskClaimIntent({
        taskId: task.id,
        taskRevision: TaskRevision.make("accepted-fact-revision")
      })
      const proposal = deliveryProposalsOf({
        acceptedOperationIds: new Set(),
        fresh: [{ step, transition }],
        runId: RunId.make("accepted-fact-run"),
        transitions: [transition]
      }).ticketDelivery[0]
      if (proposal === undefined) return yield* Effect.die("fixture must derive an accepted-fact proposal")
      const initialContributions: DeliveryProposalContributions = {
        deliverySettlement: [],
        issues: [],
        ticketDelivery: []
      }
      const acceptedContributions: DeliveryProposalContributions = {
        deliverySettlement: [],
        issues: [],
        ticketDelivery: [proposal]
      }
      const acceptedFacts = yield* SubscriptionRef.make(initialContributions)
      const proposalContributions = currentSignalFromCurrentFirstStream(SubscriptionRef.changes(acceptedFacts))
      const layer = makeDeliveryRelationsLayer({
        exactEvidence: currentSignalOf([]),
        graph: currentSignalOf(journaledGraphState(journaledGraph("accepted-fact-graph", [task.id]))),
        policy: currentSignalOf(policy),
        proposalContributions
      })
      const observed = yield* Effect.gen(function* () {
        const consequences = yield* delivery
        const proposals = yield* deliveryActionPlanning(consequences)
        const firstObserved = yield* Deferred.make<void>()
        const collected = yield* proposals.changes.pipe(
          Stream.tap(() => Deferred.succeed(firstObserved, undefined)),
          Stream.take(2),
          Stream.runCollect,
          Effect.forkChild
        )
        const stableCollected = yield* proposals.changesWithinStablePublication.pipe(
          Stream.take(2),
          Stream.runCollect,
          Effect.forkChild
        )
        yield* Deferred.await(firstObserved)
        yield* SubscriptionRef.set(acceptedFacts, acceptedContributions)
        return {
          frontiers: Array.from(yield* Fiber.join(collected)),
          stableFrontiers: Array.from(yield* Fiber.join(stableCollected))
        }
      }).pipe(Effect.provide(layer))

      const expected = [
        { _tag: "DeliveryProposalsAvailable", isolatedIssues: [], proposals: [] },
        { _tag: "DeliveryProposalsAvailable", isolatedIssues: [], proposals: [proposal] }
      ]
      expect(observed.frontiers).toEqual(expected)
      expect(observed.stableFrontiers).toEqual(expected)
    })
  )
)

it.effect("keeps empty settlements action-free after reconstructing the relation on restart", () =>
  Effect.gen(function* () {
    const input = {
      graph: currentSignalOf(TrackerGraphState.cases.GraphNotEstablished.make({})),
      exactEvidence: currentSignalOf([]),
      policy: currentSignalOf(policy)
    }
    const evaluate = Effect.gen(function* () {
      const relation = yield* deliveryRuntime.pipe(Effect.provide(makeDeliveryRelationsLayer(input)))
      return {
        actions: Array.from(yield* Stream.runCollect(relation.changes)).map(({ proposedActions }) => proposedActions),
        current: Array.from(yield* Stream.runCollect(relation.changes)).map(({ current }) => current)
      }
    })

    const beforeStop = yield* evaluate
    const afterRestart = yield* evaluate

    expect(beforeStop.actions).toEqual([{ _tag: "DeliveryProposalsAvailable", isolatedIssues: [], proposals: [] }])
    expect(afterRestart).toEqual(beforeStop)
    expect(afterRestart.current[0]?.settlements.settlements).toEqual([])
  })
)

it.effect("preserves each causal graph revision through final reflection", () =>
  Effect.gen(function* () {
    const graphOne = journaledGraphState(journaledGraph("graph-1"))
    const graphTwo = journaledGraphState(journaledGraph("graph-2"))
    const layer = makeDeliveryRelationsLayer({
      graph: currentSignalFromCurrentFirstStream(Stream.fromIterable([graphOne, graphTwo])),
      exactEvidence: currentSignalOf([]),
      policy: currentSignalOf(policy)
    })
    const relation = yield* delivery.pipe(Effect.provide(layer))

    const reflections = Array.from(yield* Stream.runCollect(relation.changes))

    expect(reflections.map(({ graph }) => graph)).toEqual([graphOne, graphTwo])
  })
)

it.effect("recomputes the same flat relation when the current policy changes", () =>
  Effect.gen(function* () {
    const taskA = TaskId.make("A")
    const taskB = TaskId.make("B")
    const capacityTwo = RunControlPolicy.make({
      revision: initialRunPolicyRevision,
      taskExecutionCapacity: TaskWorkCapacity.make(2)
    })
    const layer = makeDeliveryRelationsLayer({
      graph: currentSignalOf(journaledGraphState(journaledGraph("graph-policy", [taskA, taskB]))),
      exactEvidence: currentSignalOf([]),
      policy: currentSignalFromCurrentFirstStream(Stream.make(policy, capacityTwo).pipe(Stream.rechunk(1)))
    })
    const relation = yield* delivery.pipe(Effect.provide(layer))

    const reflections = Array.from(yield* Stream.runCollect(relation.changes))

    expect(reflections.map(({ ticketDeliveries }) => ticketDeliveries.deliveries.map(({ taskId }) => taskId))).toEqual([
      [taskA],
      [taskA, taskB]
    ])
  })
)

it.effect("recomputes the same flat relation when exact responsibility evidence changes", () =>
  Effect.gen(function* () {
    const taskA = TaskId.make("A")
    const taskB = TaskId.make("B")
    const layer = makeDeliveryRelationsLayer({
      graph: currentSignalOf(journaledGraphState(journaledGraph("graph-evidence", [taskA, taskB]))),
      exactEvidence: currentSignalFromCurrentFirstStream(
        Stream.make([], [exactAttemptEvidence(taskB)]).pipe(Stream.rechunk(1))
      ),
      policy: currentSignalOf(policy)
    })
    const relation = yield* delivery.pipe(Effect.provide(layer))

    const reflections = Array.from(yield* Stream.runCollect(relation.changes))

    expect(reflections.map(({ ticketDeliveries }) => ticketDeliveries.deliveries.map(({ taskId }) => taskId))).toEqual([
      [taskA],
      [taskA, taskB]
    ])
    expect(reflections[1]?.ticketDeliveries.deliveries.find(({ taskId }) => taskId === taskB)?.placement._tag).toBe(
      "EligibleOutsideBound"
    )
  })
)

it("keeps quiescence probes out of action planning and former scheduler runtime code", () => {
  const deliverySource = readFileSync(fileURLToPath(new URL("./delivery.ts", import.meta.url)), "utf8")
  const planningSource = readFileSync(fileURLToPath(new URL("./delivery-action-planning.ts", import.meta.url)), "utf8")
  const runtimeAdapterSource = readFileSync(
    fileURLToPath(new URL("./delivery-runtime-adapter.ts", import.meta.url)),
    "utf8"
  )
  const relationSource = readFileSync(fileURLToPath(new URL("./relations.ts", import.meta.url)), "utf8")
  const projectionSource = readFileSync(
    fileURLToPath(new URL("./ticket-delivery-projection.ts", import.meta.url)),
    "utf8"
  )
  const proposalSource = readFileSync(fileURLToPath(new URL("./delivery-proposal.ts", import.meta.url)), "utf8")
  const proposalModelSource = readFileSync(
    fileURLToPath(new URL("./delivery-action-proposal.ts", import.meta.url)),
    "utf8"
  )
  const proposalDerivationSource = readFileSync(
    fileURLToPath(new URL("./delivery-proposal-derivation.ts", import.meta.url)),
    "utf8"
  )
  const proposalRouteSource = readFileSync(
    fileURLToPath(new URL("./delivery-proposal-route.ts", import.meta.url)),
    "utf8"
  )
  const runSource = readFileSync(fileURLToPath(new URL("../run/run.ts", import.meta.url)), "utf8")
  const inMemorySource = readFileSync(fileURLToPath(new URL("./in-memory-relations.ts", import.meta.url)), "utf8")
  const reactiveSource = readFileSync(
    fileURLToPath(new URL("./reactive-delivery-relations.ts", import.meta.url)),
    "utf8"
  )
  const runtimeSource = readFileSync(fileURLToPath(new URL("./run-delivery-runtime.ts", import.meta.url)), "utf8")

  const outerEffect = deliverySource.slice(deliverySource.indexOf("export const delivery"))
  expect(outerEffect).toBe(`export const delivery = Effect.gen(function* () {
  const trackerGraph = yield* TrackerGraphRelation

  const graph = trackerGraph.signal
  const frontier = mapCurrentSignal(graph, frontierOf)
  const tickets = yield* boundedParallelTickets(frontier)
  const responsibilities = yield* executorResponsibilities(tickets)
  const settlements = yield* deliverySettlements(responsibilities)

  return yield* reflectDeliverySettlements(settlements)
})
`)

  const completeDeliverySource = `${deliverySource}\n${relationSource}\n${projectionSource}\n${proposalSource}\n${proposalModelSource}\n${proposalDerivationSource}\n${proposalRouteSource}`
  const importedModules = Array.from(
    deliverySource.matchAll(/^import\s+(?:(?:.|\n)*?\s+from\s+)?"([^"]+)"\s*$/gm),
    ([, moduleName]) => moduleName
  )
  expect(importedModules).toEqual(["effect", "./relations.js", "./ticket-delivery-projection.js"])
  expect(completeDeliverySource).not.toMatch(
    /\b(?:JournalStore|WorkflowInterpreter|RunRecoveryActivation|TaskAdmissionController|makeActivationCoordinator|Queue|Ref|Semaphore|fork|runDeliveryActivation)\b/
  )
  expect(projectionSource).not.toMatch(/coordination\/(?:admission|frontier|run)/)
  expect(`${proposalSource}\n${proposalModelSource}\n${proposalDerivationSource}\n${proposalRouteSource}`).not.toMatch(
    /(?:\.\.\/admission\/controller|\.\.\/run\/|\b(?:Effect|Queue|Ref|Semaphore|WorkflowInterpreter)\b)/
  )
  expect(planningSource).not.toMatch(
    /\b(?:DeliveryActionExecutor|DeliveryRuntimeAssembly|DeliveryRuntimeRelation|Queue|Ref|Semaphore|fork|runDeliveryRuntime)\b/
  )
  expect(runtimeAdapterSource).toContain("const proposedActions = yield* deliveryActionPlanning(consequences)")
  expect(runtimeAdapterSource).toContain("return assembly.of({ delivery: consequences, proposedActions })")
  expect(
    `${planningSource}\n${proposalModelSource}\n${runtimeAdapterSource}\n${relationSource}\n${inMemorySource}\n${reactiveSource}\n${runtimeSource}`
  ).not.toContain("QuiescenceProbe")
  expect(relationSource).not.toContain("DeliveryRuntimeRelation")
  expect(relationSource).not.toContain("DeliveryRelationRevision")
  expect(inMemorySource).not.toContain("hasNonProbeWork")
  expect(runSource.match(/\bconst consequences = yield\* delivery\b/g)).toHaveLength(1)
  expect(runSource.match(/\brunStabilizedDelivery\(/g)).toHaveLength(1)
})

it("keeps the live action dispatcher free of workflow protocol implementations", () => {
  const dispatcherSource = readFileSync(
    fileURLToPath(new URL("./live-delivery-action-executor.ts", import.meta.url)),
    "utf8"
  )

  expect(dispatcherSource).not.toMatch(/workflow\/protocols|coordination\/run|workflow\/registry/)
  expect(dispatcherSource).toContain('from "./fresh-delivery-action-adapter.js"')
  expect(dispatcherSource).toContain('from "./recovered-delivery-action-adapter.js"')
  expect(dispatcherSource).toContain('from "./planned-attempt-delivery-action-adapter.js"')
  expect(dispatcherSource).toContain('from "./integration-delivery-action-adapter.js"')
})
