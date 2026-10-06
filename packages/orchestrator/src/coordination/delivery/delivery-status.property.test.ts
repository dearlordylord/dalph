import { AttemptId, PlannedTaskAttempt, RunId, TaskId } from "@dalph/contracts"
import * as fc from "fast-check"
import { Effect, HashSet } from "effect"
import { expect, it } from "vitest"
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import { TaskClaimAcquisition } from "../../authorities/task-tracker/claim-mutation.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { makeFreshTaskAdmissionBasis, TaskAdmissionOccupancy } from "../admission/fresh-task-admission.js"
import { initialRunPolicyRevision, RunControlPolicy } from "../../control/policy.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { WorkflowResponsibilityEntry } from "../reconstruction/state.js"
import { ResponsibilityDisposition } from "../frontier/fresh-facts.js"
import { integrationFinalityFixture } from "../../workflow/protocols/integration-finality/fixtures.js"
import { QueuedIntegrationResponsibility } from "../../workflow/protocols/integration-admission/protocol.js"
import {
  trackerGraphReadProposalOf,
  DeliveryProposalId,
  DeliveryProposalOrdinal,
  type DeliveryActionProposal,
  type DeliveryProposalDerivationIssue
} from "./delivery-action-proposal.js"
import { deliveryProposalsOf } from "./delivery-proposal-derivation.js"
import { RunnableFrontierTransition } from "../frontier/frontier.js"
import { makeTargetLineageObservationOperation } from "../../workflow/registry/operation.js"
import { OperationId } from "../../workflow/identity.js"
import {
  DeliveryRuntimeObservationState,
  type DeliveryRuntimeLiveOwnerSnapshot
} from "./delivery-runtime-observation.js"
import {
  BoundedTicketRank,
  makeDeliveryReflection,
  makeDeliverySettlement,
  makeDeliverySettlements,
  TrackerGraphState,
  type BoundedParallelTickets,
  type DeliveryGraphPublication,
  type DeliveryRuntimeEvaluation,
  type TicketDelivery,
  type TicketDeliveries,
  type TicketDeliveryStanding
} from "./relations.js"
import {
  deliveryStatusOf,
  DeliveryStatusSubject,
  DeliveryStatusProjectionConflict,
  type CurrentDeliveryStatus,
  type DeliveryStatusEntry
} from "./delivery-status.js"
import { ticketOwnerSnapshotForTest } from "../../../test/support/delivery-runtime-live-owner.js"

const runId = RunId.make("delivery-status-property-run")
const target = FixtureTarget.make("delivery-status-property-target")
const policy = RunControlPolicy.make({
  revision: initialRunPolicyRevision,
  taskExecutionCapacity: TaskWorkCapacity.make(2)
})

const proposalOf = (id: string, taskId: TaskId, ordinal: number) => ({
  ...trackerGraphReadProposalOf({
    acceptedAt: JournalPosition.make(1),
    purpose: "EstablishCurrentGraph",
    runId,
    target
  }),
  admission: {
    integrationTarget: { _tag: "NoIntegrationTargetResource" as const },
    plannedAttemptProtocol: { _tag: "NoPlannedAttemptProtocol" as const },
    taskWorkPosition: { _tag: "TaskWorkPositionRequired" as const, mode: "ReserveOrReuse" as const, taskId }
  },
  id: DeliveryProposalId.make(id),
  order: {
    _tag: "FreshWorkflowOrder" as const,
    frontierOrdinal: DeliveryProposalOrdinal.make(ordinal),
    step: "ReadCurrentTaskGraph" as const,
    taskId
  },
  owner: "TicketDelivery" as const
})

const standingPair = (
  taskId: TaskId,
  reversed: boolean
): readonly [TicketDeliveryStanding, ...Array<TicketDeliveryStanding>] => {
  const conflict = { _tag: "ExactEvidenceConflict" as const, evidenceIdentities: [`evidence:${taskId}`] as const }
  const proposed = { _tag: "ProposedDelivery" as const }
  const promoted = {
    _tag: "PromotedPrerequisiteReleasePending" as const,
    prerequisiteTaskIds: [TaskId.make("prerequisite")] as const
  }
  return reversed ? [conflict, promoted, proposed] : [proposed, promoted, conflict]
}

const deliveryOf = (taskId: TaskId, rank: number, reversed: boolean): TicketDelivery => ({
  _tag: "TicketDelivery",
  evidence: [],
  obligations: [],
  placement: { _tag: "Selected", rank: BoundedTicketRank.make(rank) },
  standings: standingPair(taskId, reversed),
  taskId
})

const ticketDeliveriesOf = (reverseA: boolean, reverseB: boolean): TicketDeliveries => {
  const graph = TrackerGraphState.cases.GraphNotEstablished.make({})
  const publication: DeliveryGraphPublication = { exactEvidence: [], graph, policy }
  const source: BoundedParallelTickets = {
    _tag: "BoundedParallelTickets",
    placements: [
      { placement: { _tag: "Selected", rank: BoundedTicketRank.make(0) }, taskId: TaskId.make("A") },
      { placement: { _tag: "Selected", rank: BoundedTicketRank.make(1) }, taskId: TaskId.make("B") }
    ],
    policy,
    publication,
    source: { _tag: "DeliveryFrontier", publication, source: graph, standings: [] }
  }
  return {
    _tag: "TicketDeliveries",
    deliveries: [deliveryOf(TaskId.make("A"), 0, reverseA), deliveryOf(TaskId.make("B"), 1, reverseB)],
    source
  }
}

const stateOf = (
  proposalOrder:
    | readonly ["A", "A2", "B"]
    | readonly ["A", "B", "A2"]
    | readonly ["A2", "A", "B"]
    | readonly ["A2", "B", "A"]
    | readonly ["B", "A", "A2"]
    | readonly ["B", "A2", "A"],
  ownerOrder: readonly ["A", "B"] | readonly ["B", "A"],
  reverseA: boolean,
  reverseB: boolean,
  reverseIssues: boolean
): DeliveryRuntimeObservationState => {
  const proposalA = proposalOf("property-A", TaskId.make("A"), 0)
  const proposalA2 = proposalOf("property-A-unowned", TaskId.make("A"), 2)
  const proposalB = proposalOf("property-B", TaskId.make("B"), 1)
  const proposals = proposalOrder.map((label) => (label === "A" ? proposalA : label === "A2" ? proposalA2 : proposalB))
  const ownerForTask = (taskId: "A" | "B"): DeliveryRuntimeLiveOwnerSnapshot =>
    taskId === "A" ? ticketOwnerSnapshotForTest(proposalA) : ticketOwnerSnapshotForTest(proposalB)
  const liveOwners = ownerOrder.map(ownerForTask)
  const issues: ReadonlyArray<DeliveryProposalDerivationIssue> = [
    {
      _tag: "AcceptedOperationEvidenceMissing",
      operationId: OperationId.make("property-issue-operation-A"),
      taskId: TaskId.make("A"),
      transition: "CommitFreshTaskClaimIntent"
    },
    { _tag: "FreshRouteProvenanceMissing", taskId: TaskId.make("B"), transition: "ContinueFreshWorkflowOperation" }
  ]
  const ticketDeliveries = ticketDeliveriesOf(reverseA, reverseB)
  const settlements = makeDeliverySettlements(ticketDeliveries, [])
  const current = {
    _tag: "DeliveryRuntimeSnapshot" as const,
    reflection: makeDeliveryReflection(settlements),
    settlements,
    ticketDeliveries,
    trackerGraph: ticketDeliveries.source.publication.graph,
    runId,
    cancellationApplied: false
  }
  const evaluation: DeliveryRuntimeEvaluation = {
    _tag: "DeliveryRuntimeEvaluation",
    acceptedAt: JournalPosition.make(2),
    runId,
    current,
    pauseCoverage: {
      _tag: "PauseCoverageGraphNotEstablished",
      applied: { run: { _tag: "RunUnpaused" }, tasks: { _tag: "NoTaskPauses" } }
    },
    proposedActions: {
      _tag: "DeliveryProposalsAvailable",
      freshTaskCandidates: [],
      isolatedIssues: reverseIssues ? issues.toReversed() : issues,
      proposals
    },
    quiescence: { _tag: "TrackerReconfirmationAllowed" },
    taskWork: Effect.runSync(
      makeFreshTaskAdmissionBasis({
        acceptedAt: JournalPosition.make(2),
        capacity: policy.taskExecutionCapacity,
        entries: [],
        runId
      })
    ),
    cancellationApplied: false
  }
  return DeliveryRuntimeObservationState.Ready({ evaluation, liveOwners })
}

const statusFor = (state: DeliveryRuntimeObservationState): CurrentDeliveryStatus => {
  const result = deliveryStatusOf(SchemaSubject, state)
  if (
    result._tag === "DeliveryStatusRunMismatch" ||
    result._tag === "DeliveryStatusRunIdentityUnavailable" ||
    result._tag === "DeliveryStatusProjectionConflict"
  ) {
    return expect.fail(`status projection failed in deterministic property: ${result.message}`)
  }
  return result
}

const SchemaSubject = DeliveryStatusSubject.cases.Run.make({ runId })

const statusTaskStandingOf = (taskId: TaskId, disposition: StatusPropertyDisposition) => {
  const responsibility = WorkflowResponsibilityEntry.cases.TaskClaimResponsibility.make({
    acquisition: TaskClaimAcquisition.make({
      operationId: OperationId.make(`status-property-claim:${taskId}`),
      owner: ClaimOwner.make("dalph"),
      taskId,
      token: ClaimToken.make(`status-property-token:${taskId}`)
    }),
    beganAt: JournalPosition.make(3),
    taskId
  })
  return {
    standing: {
      _tag: "ResponsibilitySituation" as const,
      facts: { _tag: "WorkflowOperationFreshFacts" as const, disposition, responsibility }
    },
    obligation: { _tag: "WorkflowResponsibility" as const, responsibility }
  }
}

type PhenomenonPermutation = {
  readonly proposals: boolean
  readonly owners: boolean
  readonly standings: boolean
  readonly sourcePlacements: boolean
  readonly obligations: boolean
  readonly issues: boolean
  readonly settlements: boolean
}

type StatusPropertyDisposition =
  | ReturnType<typeof ResponsibilityDisposition.WorkflowOperationTaskClaimConstraint>
  | ReturnType<typeof ResponsibilityDisposition.Relinquished>

const nonEmptyStandingsOf = (standings: TicketDelivery["standings"]): TicketDelivery["standings"] => {
  const reversed = standings.toReversed()
  const [first, ...rest] = reversed
  if (first === undefined) return expect.fail("all-phenomena property fixture requires one standing")
  return [first, ...rest]
}

const allPhenomenaStateOf = (permutation: PhenomenonPermutation): DeliveryRuntimeObservationState => {
  const base = stateOf(["A", "A2", "B"], ["A", "B"], permutation.standings, !permutation.standings, permutation.issues)
  if (base._tag !== "Ready") return expect.fail("all-phenomena property fixture must be ready")

  const capacityTask = TaskId.make("C")
  const targetTask = TaskId.make("I")
  const trackerTask = TaskId.make("T")
  const relinquishedTask = TaskId.make("R")
  const settlementTaskA = TaskId.make("S1")
  const settlementTaskB = TaskId.make("S2")
  const fixture = integrationFinalityFixture
  const plannedAttempt = PlannedTaskAttempt.make({ ...fixture.plannedAttempt, runId, taskId: targetTask })
  const queued = QueuedIntegrationResponsibility.make({
    acceptedResult: fixture.promotionCorrelation.qualifiedCandidate.run.session.acceptedResult,
    integrationTarget: fixture.integrationTarget,
    plannedAttempt,
    preIntegrationCancellation: { attemptId: plannedAttempt.attemptId, queuedAt: JournalPosition.make(2), runId },
    queuedAt: JournalPosition.make(2)
  })
  const tracker = statusTaskStandingOf(
    trackerTask,
    ResponsibilityDisposition.WorkflowOperationTaskClaimConstraint({ claimState: "Missing" })
  )
  const relinquished = statusTaskStandingOf(
    relinquishedTask,
    ResponsibilityDisposition.Relinquished({ reason: "AuthorizedHandoff" })
  )
  const acceptedStandingOf = (
    taskId: TaskId,
    disposition: ReturnType<
      typeof ResponsibilityDisposition.CancelledAttemptSettled | typeof ResponsibilityDisposition.StoppedAttemptSettled
    >
  ) => {
    const plannedAttempt = PlannedTaskAttempt.make({ ...fixture.plannedAttempt, runId, taskId })
    const responsibility = WorkflowResponsibilityEntry.cases.PlannedAttemptExecutorWorkResponsibility.make({
      beganAt: JournalPosition.make(2),
      plannedAttempt
    })
    return {
      standing: {
        _tag: "ResponsibilitySituation" as const,
        facts: { _tag: "PlannedAttemptExecutorFreshFacts" as const, disposition, responsibility }
      }
    }
  }
  const cancelled = acceptedStandingOf(
    settlementTaskA,
    ResponsibilityDisposition.CancelledAttemptSettled({ claimDisposition: "Released" })
  )
  const stopped = acceptedStandingOf(
    settlementTaskB,
    ResponsibilityDisposition.StoppedAttemptSettled({ claimDisposition: "Released" })
  )
  const proposal = proposalOf("property-publication", capacityTask, 3)
  const settledOwner = ticketOwnerSnapshotForTest(proposal, { _tag: "SettledBeforeMaterialization" })
  const extraDeliveries: ReadonlyArray<TicketDelivery> = [
    {
      _tag: "TicketDelivery",
      evidence: [],
      obligations: [],
      placement: { _tag: "Selected", rank: BoundedTicketRank.make(2) },
      standings: [{ _tag: "ProposedDelivery" }],
      taskId: capacityTask
    },
    {
      _tag: "TicketDelivery",
      evidence: [{ _tag: "QueuedIntegration", responsibility: queued }],
      obligations: [{ _tag: "QueuedIntegration", responsibility: queued }],
      placement: { _tag: "Selected", rank: BoundedTicketRank.make(3) },
      standings: [{ _tag: "IntegrationWait", wait: { _tag: "IntegrationTargetWait", plannedAttempt } }],
      taskId: targetTask
    },
    {
      _tag: "TicketDelivery",
      evidence: [],
      obligations: [tracker.obligation],
      placement: { _tag: "Selected", rank: BoundedTicketRank.make(4) },
      standings: [tracker.standing],
      taskId: trackerTask
    },
    {
      _tag: "TicketDelivery",
      evidence: [],
      obligations: [relinquished.obligation],
      placement: { _tag: "Selected", rank: BoundedTicketRank.make(5) },
      standings: [relinquished.standing],
      taskId: relinquishedTask
    },
    {
      _tag: "TicketDelivery",
      evidence: [],
      obligations: [],
      placement: { _tag: "Selected", rank: BoundedTicketRank.make(6) },
      standings: [cancelled.standing],
      taskId: settlementTaskA
    },
    {
      _tag: "TicketDelivery",
      evidence: [],
      obligations: [],
      placement: { _tag: "Selected", rank: BoundedTicketRank.make(7) },
      standings: [stopped.standing],
      taskId: settlementTaskB
    }
  ]
  const source = base.evaluation.current.ticketDeliveries.source
  const placements: BoundedParallelTickets["placements"] = [
    ...source.placements,
    ...extraDeliveries.map(({ placement, taskId }) => {
      if (placement._tag === "AbsentFromCurrentGraph" || placement._tag === "GraphNotEstablished") {
        return expect.fail("all-phenomena property fixture requires bounded ticket placements")
      }
      return { taskId, placement }
    })
  ]
  const deliveries = [...base.evaluation.current.ticketDeliveries.deliveries, ...extraDeliveries]
  const ticketDeliveries = {
    ...base.evaluation.current.ticketDeliveries,
    deliveries,
    source: { ...source, placements: permutation.sourcePlacements ? placements.toReversed() : placements }
  }
  const settlementEntries = [
    makeDeliverySettlement({ attemptId: AttemptId.make("property-settlement-S1"), taskId: settlementTaskA }),
    makeDeliverySettlement({ attemptId: AttemptId.make("property-settlement-S2"), taskId: settlementTaskB })
  ]
  const settlements = makeDeliverySettlements(
    ticketDeliveries,
    permutation.settlements ? settlementEntries.toReversed() : settlementEntries
  )
  const current = {
    ...base.evaluation.current,
    reflection: makeDeliveryReflection(settlements),
    settlements,
    ticketDeliveries
  }
  const proposals = [
    ...(base.evaluation.proposedActions._tag === "DeliveryProposalsAvailable"
      ? base.evaluation.proposedActions.proposals
      : []),
    proposal
  ]
  const issues =
    base.evaluation.proposedActions._tag === "DeliveryProposalsAvailable"
      ? base.evaluation.proposedActions.isolatedIssues
      : []
  const liveOwners = [...base.liveOwners, settledOwner]
  const evaluation = {
    ...base.evaluation,
    current,
    proposedActions: {
      _tag: "DeliveryProposalsAvailable" as const,
      freshTaskCandidates: [],
      isolatedIssues: permutation.issues ? issues.toReversed() : issues,
      proposals: permutation.proposals ? proposals.toReversed() : proposals
    },
    taskWork: Effect.runSync(
      makeFreshTaskAdmissionBasis({
        acceptedAt: base.evaluation.acceptedAt,
        capacity: base.evaluation.taskWork.capacity,
        entries: [
          TaskAdmissionOccupancy.ExactAttemptHeld({
            plannedAttempt: PlannedTaskAttempt.make({
              ...fixture.plannedAttempt,
              attemptId: AttemptId.make("property-holder-A"),
              runId,
              taskId: TaskId.make("A")
            })
          }),
          TaskAdmissionOccupancy.ExactAttemptHeld({
            plannedAttempt: PlannedTaskAttempt.make({
              ...fixture.plannedAttempt,
              attemptId: AttemptId.make("property-holder-B"),
              runId,
              taskId: TaskId.make("B")
            })
          })
        ],
        runId
      })
    )
  }
  const orderedOwners = permutation.owners ? liveOwners.toReversed() : liveOwners
  const orderedDeliveries = permutation.standings
    ? evaluation.current.ticketDeliveries.deliveries.map((delivery) => ({
        ...delivery,
        obligations: permutation.obligations ? delivery.obligations.toReversed() : delivery.obligations,
        standings: nonEmptyStandingsOf(delivery.standings)
      }))
    : evaluation.current.ticketDeliveries.deliveries.map((delivery) => ({
        ...delivery,
        obligations: permutation.obligations ? delivery.obligations.toReversed() : delivery.obligations
      }))
  return DeliveryRuntimeObservationState.Ready({
    evaluation: {
      ...evaluation,
      current: {
        ...evaluation.current,
        ticketDeliveries: { ...evaluation.current.ticketDeliveries, deliveries: orderedDeliveries }
      }
    },
    liveOwners: orderedOwners
  })
}

it("keeps simultaneous status entries deterministic when proposal, owner, and standing arrays are permuted", () => {
  const canonical = statusFor(stateOf(["A", "A2", "B"], ["A", "B"], false, false, false))
  if (canonical._tag !== "DeliveryStatusAvailable") return expect.fail("property fixture must be available")
  const phenomenonCounts = canonical.entries.reduce<Partial<Record<DeliveryStatusEntry["_tag"], number>>>(
    (counts, entry) => ({ ...counts, [entry._tag]: (counts[entry._tag] ?? 0) + 1 }),
    {}
  )
  expect(phenomenonCounts).toMatchObject({
    DependencyWait: 2,
    EvidenceConflict: 2,
    ProposedDeliveryAction: 1,
    LiveDeliveryAction: 2,
    EvidenceUnavailable: 2
  })
  fc.assert(
    fc.property(
      fc.constantFrom(
        ["A", "A2", "B"] as const,
        ["A", "B", "A2"] as const,
        ["A2", "A", "B"] as const,
        ["A2", "B", "A"] as const,
        ["B", "A", "A2"] as const,
        ["B", "A2", "A"] as const
      ),
      fc.constantFrom(["A", "B"] as const, ["B", "A"] as const),
      fc.boolean(),
      fc.boolean(),
      fc.boolean(),
      (proposalOrder, ownerOrder, reverseA, reverseB, reverseIssues) => {
        const permutation = statusFor(stateOf(proposalOrder, ownerOrder, reverseA, reverseB, reverseIssues))
        expect(permutation).toEqual(canonical)
        if (permutation._tag !== "DeliveryStatusAvailable") return
        const counts = permutation.entries.reduce<Partial<Record<DeliveryStatusEntry["_tag"], number>>>(
          (current, entry) => ({ ...current, [entry._tag]: (current[entry._tag] ?? 0) + 1 }),
          {}
        )
        expect(counts).toEqual(phenomenonCounts)
      }
    ),
    { numRuns: 50 }
  )
})

it("orders every simultaneous delivery-status phenomenon independently of source permutations", () => {
  const canonical = statusFor(
    allPhenomenaStateOf({
      proposals: false,
      owners: false,
      standings: false,
      sourcePlacements: false,
      obligations: false,
      issues: false,
      settlements: false
    })
  )
  if (canonical._tag !== "DeliveryStatusAvailable") return expect.fail("all-phenomena property must be available")
  const phenomenonCounts = canonical.entries.reduce<Partial<Record<DeliveryStatusEntry["_tag"], number>>>(
    (counts, entry) => ({ ...counts, [entry._tag]: (counts[entry._tag] ?? 0) + 1 }),
    {}
  )
  expect(phenomenonCounts).toMatchObject({
    DependencyWait: 2,
    TrackerFactWait: 2,
    TaskWorkCapacityWait: 6,
    ProposedDeliveryAction: 1,
    LiveDeliveryAction: 2,
    AcceptedFactPublicationWait: 1,
    IntegrationTargetWait: 1,
    EvidenceUnavailable: 2,
    EvidenceConflict: 2,
    Settlement: 4,
    Relinquishment: 1
  })
  expect(
    canonical.entries
      .filter(
        (entry): entry is Extract<DeliveryStatusEntry, { readonly _tag: "Settlement" }> => entry._tag === "Settlement"
      )
      .map((entry) => entry.settlement._tag)
  ).toEqual(["DeliverySettlement", "CancelledAttemptSettled", "DeliverySettlement", "StoppedAttemptSettled"])
  fc.assert(
    fc.property(
      fc.record({
        proposals: fc.boolean(),
        owners: fc.boolean(),
        standings: fc.boolean(),
        sourcePlacements: fc.boolean(),
        obligations: fc.boolean(),
        issues: fc.boolean(),
        settlements: fc.boolean()
      }),
      (permutation) => {
        const projected = statusFor(allPhenomenaStateOf(permutation))
        expect(projected).toEqual(canonical)
        if (projected._tag !== "DeliveryStatusAvailable") return
        expect(
          projected.entries.reduce<Partial<Record<DeliveryStatusEntry["_tag"], number>>>(
            (counts, entry) => ({ ...counts, [entry._tag]: (counts[entry._tag] ?? 0) + 1 }),
            {}
          )
        ).toEqual(phenomenonCounts)
      }
    ),
    { numRuns: 50 }
  )
})

const listingChangeArbitrary = fc.record({
  before: fc.array(fc.boolean(), { maxLength: 6 }),
  inserted: fc.integer({ min: 0, max: 6 }),
  prefix: fc.integer({ min: 1, max: 100 }),
  advance: fc.integer({ min: 0, max: 20 }),
  settled: fc.boolean()
})

const movedReadState = ({
  advance,
  before,
  inserted,
  prefix,
  settled
}: {
  readonly before: ReadonlyArray<boolean>
  readonly inserted: number
  readonly prefix: number
  readonly advance: number
  readonly settled: boolean
}) => {
  const taskId = TaskId.make("B")
  const plannedAttempt = { ...integrationFinalityFixture.plannedAttempt, runId, taskId }
  const operationId = OperationId.make("property-materialized-lineage")
  const transition = RunnableFrontierTransition.ObservePlannedAttemptContinuationTargetLineage({
    plannedAttempt,
    operationIdentity: "Allocate",
    operation: makeTargetLineageObservationOperation({
      operationId,
      plannedAttempt,
      integrationTarget: integrationFinalityFixture.integrationTarget,
      predecessorOperationIds: []
    })
  })
  const derived = deliveryProposalsOf({
    acceptedAt: JournalPosition.make(prefix),
    acceptedOperationIds: HashSet.empty(),
    fresh: [],
    runId,
    transitions: [transition]
  }).ticketDelivery[0]
  if (
    derived?.order._tag !== "RecoveredWorkflowOrder" ||
    derived.route._tag !== "RecoveredNewActionRoute" ||
    derived.actionIdentity._tag !== "FreshOperationIdRequired"
  )
    return expect.fail("must derive recovered lineage read")
  const original = {
    ...derived,
    route: derived.route,
    actionIdentity: derived.actionIdentity,
    order: { ...derived.order, frontierOrdinal: DeliveryProposalOrdinal.make(before.length) }
  }
  const owner = ticketOwnerSnapshotForTest(original, {
    _tag: settled ? "SettledMaterializedDeliveryAction" : "MaterializedDeliveryAction",
    intent: "IntentRecorded",
    operationId
  })
  const current = {
    ...original,
    actionIdentity: { _tag: "FreshOperationIdRequired" as const, source: { _tag: "Preserve" as const, operationId } },
    order: {
      ...original.order,
      acceptedAt: JournalPosition.make(prefix + advance),
      frontierOrdinal: DeliveryProposalOrdinal.make(before.filter(Boolean).length + inserted)
    }
  }
  const unrelated = [
    ...before.flatMap((keep, index) => (keep ? [`remaining:${index}`] : [])),
    ...Array.from({ length: inserted }, (_, index) => `inserted:${index}`)
  ].map((id, index) => proposalOf(id, TaskId.make("A"), index))
  const base = stateOf(["A", "A2", "B"], ["A", "B"], false, false, false)
  if (base._tag !== "Ready") return expect.fail("property base must be Ready")
  const project = (
    proposal: DeliveryActionProposal = current,
    owners: ReadonlyArray<DeliveryRuntimeLiveOwnerSnapshot> = [owner],
    acceptedAt = JournalPosition.make(prefix + advance)
  ) =>
    deliveryStatusOf(SchemaSubject, {
      ...base,
      liveOwners: owners,
      evaluation: {
        ...base.evaluation,
        acceptedAt,
        proposedActions: {
          _tag: "DeliveryProposalsAvailable",
          freshTaskCandidates: [],
          isolatedIssues: [],
          proposals: [...unrelated, proposal]
        }
      }
    })
  return { original, current, owner, project }
}

it("keeps exact admitted actions visible across generated current listing changes", () => {
  fc.assert(
    fc.property(listingChangeArbitrary, (input) => {
      const { original, owner, project } = movedReadState(input)
      const status = project()
      expect(status).toMatchObject({ _tag: "DeliveryStatusAvailable" })
      if (status._tag !== "DeliveryStatusAvailable") return expect.fail("unchanged admitted read must remain visible")
      const live = status.entries.filter(
        (entry) =>
          (entry._tag === "LiveDeliveryAction" || entry._tag === "AcceptedFactPublicationWait") &&
          entry.owner.proposal.id === original.id
      )
      expect(live).toHaveLength(1)
      expect(live[0]).toMatchObject({ owner })
      expect(owner.proposal).toEqual(original)
    }),
    { numRuns: 100, examples: [[{ before: [false], inserted: 0, prefix: 81, advance: 3, settled: false }]] }
  )
})

it("rejects changed causal evidence despite generated listing changes", () => {
  fc.assert(
    fc.property(listingChangeArbitrary, (input) => {
      const { current, owner, project } = movedReadState(input)
      const foreignId = OperationId.make("foreign-property-read")
      const changes: ReadonlyArray<DeliveryActionProposal> = [
        { ...current, order: { ...current.order, taskId: TaskId.make("A") } },
        { ...current, order: { ...current.order, responsibilityBeganAt: JournalPosition.make(1) } },
        { ...current, order: { ...current.order, transition: "ObserveResponsibleTaskClaim" } },
        { ...current, waitsForLiveOperationId: foreignId },
        {
          ...current,
          actionIdentity: { _tag: "FreshOperationIdRequired", source: { _tag: "Preserve", operationId: foreignId } }
        },
        { ...current, owner: "DeliverySettlement" },
        {
          ...current,
          admission: {
            ...current.admission,
            taskWorkPosition: { _tag: "TaskWorkPositionRequired", mode: "ReserveOrReuse", taskId: TaskId.make("A") }
          }
        },
        { ...current, order: { ...current.order, acceptedAt: JournalPosition.make(input.prefix + input.advance + 1) } }
      ]
      if (current.route.action._tag !== "ReadTargetLineage") return expect.fail("must preserve lineage route")
      const changedRoute = {
        ...current,
        route: {
          ...current.route,
          action: {
            ...current.route.action,
            operation: { ...current.route.action.operation, predecessorOperationIds: [foreignId] }
          }
        }
      }
      for (const changed of [...changes, changedRoute])
        expect(project(changed)).toBeInstanceOf(DeliveryStatusProjectionConflict)
      expect(project(current, [owner, owner])).toBeInstanceOf(DeliveryStatusProjectionConflict)
      expect(project(current, [{ ...owner, admissionAuthority: { ...owner.admissionAuthority } }])).toBeInstanceOf(
        DeliveryStatusProjectionConflict
      )
      expect(project(current, [{ ...owner, proposal: current }])).toBeInstanceOf(DeliveryStatusProjectionConflict)
      if (input.prefix > 1)
        expect(
          project(
            { ...current, order: { ...current.order, acceptedAt: JournalPosition.make(input.prefix - 1) } },
            [owner],
            JournalPosition.make(input.prefix - 1)
          )
        ).toBeInstanceOf(DeliveryStatusProjectionConflict)
    }),
    { numRuns: 100 }
  )
})
