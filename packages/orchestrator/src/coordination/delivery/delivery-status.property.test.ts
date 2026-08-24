import { RunId, TaskId } from "@dalph/contracts"
import * as fc from "fast-check"
import { expect, it } from "vitest"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { initialRunPolicyRevision, RunControlPolicy } from "../../control/policy.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import {
  trackerGraphReadProposalOf,
  DeliveryProposalId,
  DeliveryProposalOrdinal,
  type DeliveryProposalDerivationIssue
} from "./delivery-action-proposal.js"
import { OperationId } from "../../workflow/identity.js"
import {
  DeliveryRuntimeObservationState,
  type DeliveryRuntimeLiveOwnerSnapshot
} from "./delivery-runtime-observation.js"
import {
  BoundedTicketRank,
  makeDeliveryReflection,
  makeDeliverySettlements,
  TrackerGraphState,
  type BoundedParallelTickets,
  type DeliveryGraphPublication,
  type DeliveryRuntimeEvaluation,
  type TicketDelivery,
  type TicketDeliveries,
  type TicketDeliveryStanding
} from "./relations.js"
import { deliveryStatusOf, DeliveryStatusSubject, type CurrentDeliveryStatus } from "./delivery-status.js"

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
  return reversed ? [conflict, proposed] : [proposed, conflict]
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
  proposalOrder: readonly ["A", "B"] | readonly ["B", "A"],
  ownerOrder: readonly ["A", "B"] | readonly ["B", "A"],
  reverseA: boolean,
  reverseB: boolean,
  reverseIssues: boolean
): DeliveryRuntimeObservationState => {
  const proposalA = proposalOf("property-A", TaskId.make("A"), 0)
  const proposalB = proposalOf("property-B", TaskId.make("B"), 1)
  const proposals = proposalOrder.map((taskId) => (taskId === "A" ? proposalA : proposalB))
  const ownerForTask = (taskId: "A" | "B"): DeliveryRuntimeLiveOwnerSnapshot =>
    taskId === "A"
      ? { _tag: "AdmittedDeliveryAction", proposal: proposalA }
      : { _tag: "AdmittedDeliveryAction", proposal: proposalB }
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
    current,
    pauseCoverage: {
      _tag: "PauseCoverageGraphNotEstablished",
      applied: { run: { _tag: "RunUnpaused" }, tasks: { _tag: "NoTaskPauses" } }
    },
    proposedActions: {
      _tag: "DeliveryProposalsAvailable",
      isolatedIssues: reverseIssues ? issues.toReversed() : issues,
      proposals
    },
    quiescence: { _tag: "TrackerReconfirmationAllowed" },
    taskWork: { capacity: policy.taskExecutionCapacity, held: [] },
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

it("keeps simultaneous status entries deterministic when proposal, owner, and standing arrays are permuted", () => {
  const canonical = statusFor(stateOf(["A", "B"], ["A", "B"], false, false, false))
  fc.assert(
    fc.property(
      fc.boolean(),
      fc.boolean(),
      fc.boolean(),
      fc.boolean(),
      fc.boolean(),
      (reverseProposals, reverseOwners, reverseA, reverseB, reverseIssues) => {
        const proposalOrder = reverseProposals ? (["B", "A"] as const) : (["A", "B"] as const)
        const ownerOrder = reverseOwners ? (["B", "A"] as const) : (["A", "B"] as const)
        expect(statusFor(stateOf(proposalOrder, ownerOrder, reverseA, reverseB, reverseIssues))).toEqual(canonical)
      }
    ),
    { numRuns: 50 }
  )
})
