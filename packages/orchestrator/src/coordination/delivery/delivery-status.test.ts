/* eslint-disable import/no-nodejs-modules -- The capability guard reads this module's static imports only. */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { AttemptId, RunId, TaskId } from "@dalph/contracts"
import { it } from "@effect/vitest"
import { Effect, Schema, Stream } from "effect"
import { expect } from "vitest"
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import { TaskClaimAcquisition } from "../../authorities/task-tracker/claim-mutation.js"
import { TaskDagSnapshot } from "../../authorities/task-tracker/graph.js"
import { TaskLifecycle, TrackerRevision, TrackerSnapshot } from "../../authorities/task-tracker/task.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { initialRunPolicyRevision, RunControlPolicy } from "../../control/policy.js"
import { ResponsibilityDisposition } from "../frontier/fresh-facts.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { OperationId } from "../../workflow/identity.js"
import { WorkflowResponsibilityEntry } from "../reconstruction/state.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import {
  DeliveryProposalId,
  DeliveryProposalOrdinal,
  trackerGraphReadProposalOf,
  type DeliveryActionProposal,
  type DeliveryProposalDerivationIssue
} from "./delivery-action-proposal.js"
import {
  DeliveryRuntimeObservationState,
  type DeliveryRuntimeLiveOwnerSnapshot
} from "./delivery-runtime-observation.js"
import {
  currentSignalOf,
  currentSignalFromCurrentFirstStream,
  makeDeliveryReflection,
  TrackerGraphState,
  type DeliveryRuntimeEvaluation,
  type DeliveryRuntimeSnapshot,
  type DeliveryProposalFrontier,
  type TicketDeliveryEvidence
} from "./relations.js"
import { makeTestJournaledTrackerGraphObservation } from "../../../test/journaled-graph-observation.js"
import { integrationFinalityFixture } from "../../workflow/protocols/integration-finality/fixtures.js"
import { IntegrationFinalitySettledEvent } from "../../workflow/protocols/integration-finality/events.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import { QueuedIntegrationResponsibility } from "../../workflow/protocols/integration-admission/protocol.js"
import { memoryJournalStoreLayer } from "../../workflow-journal/adapters/memory-store.js"
import { JournalStore } from "../../workflow-journal/store.js"
import {
  boundedParallelTicketsOf,
  deliverySettlementsOf,
  frontierOf,
  ticketDeliveriesOf
} from "./ticket-delivery-projection.js"
import {
  deliveryStatusOf,
  deliveryStatusSignalOf,
  DeliveryStatusProjectionConflict,
  DeliveryStatusRunIdentityUnavailable,
  DeliveryStatusRunMismatch,
  DeliveryStatusSubject,
  type CurrentDeliveryStatus,
  type DeliveryStatusEntry
} from "./delivery-status.js"

type StatusProjectionHasOnlyObservationInputs =
  Parameters<typeof deliveryStatusOf> extends [DeliveryStatusSubject, DeliveryRuntimeObservationState] ? true : false
type StatusVocabularyHasNoExecutorPrivateTags =
  Extract<DeliveryStatusEntry["_tag"], "Agent" | "Session" | "Turn" | "Role" | "Stage"> extends never ? true : false
const statusProjectionHasOnlyObservationInputs: StatusProjectionHasOnlyObservationInputs = true
const statusVocabularyHasNoExecutorPrivateTags: StatusVocabularyHasNoExecutorPrivateTags = true

const runId = RunId.make("delivery-status-run")
const policy = RunControlPolicy.make({
  revision: initialRunPolicyRevision,
  taskExecutionCapacity: TaskWorkCapacity.make(2)
})
const target = FixtureTarget.make("delivery-status-target")

const graphStateOf = (
  tasks: ReadonlyArray<{ readonly id: string; readonly prerequisiteIds?: ReadonlyArray<string> }> = [],
  established = true
): TrackerGraphState => {
  if (!established) return TrackerGraphState.cases.GraphNotEstablished.make({})
  const projected = TaskDagSnapshot.project(
    TrackerSnapshot.make({
      revision: TrackerRevision.make("status-graph-revision"),
      tasks: tasks.map(({ id, prerequisiteIds }) => ({
        id: TaskId.make(id),
        lifecycle: TaskLifecycle.cases.Open.make({}),
        parentTaskId: null,
        prerequisiteIds: (prerequisiteIds ?? []).map((prerequisiteId) => TaskId.make(prerequisiteId))
      }))
    })
  )
  if (projected._tag === "Invalid") {
    expect.fail("invalid status fixture")
  }
  const operationId = OperationId.make("status-graph-read")
  const observation = makeTestJournaledTrackerGraphObservation({
    snapshot: projected.snapshot,
    operationId,
    recordedAt: JournalPosition.make(4)
  })
  return TrackerGraphState.cases.GraphEstablished.make({ observation })
}

const proposalOf = (id: string): DeliveryActionProposal => ({
  ...trackerGraphReadProposalOf({
    acceptedAt: JournalPosition.make(4),
    purpose: "EstablishCurrentGraph",
    runId,
    target
  }),
  id: DeliveryProposalId.make(id)
})

const taskProposalOf = (id: string, taskId: TaskId): DeliveryActionProposal => ({
  ...proposalOf(id),
  admission: {
    integrationTarget: { _tag: "NoIntegrationTargetResource" },
    plannedAttemptProtocol: { _tag: "NoPlannedAttemptProtocol" },
    taskWorkPosition: { _tag: "TaskWorkPositionRequired", mode: "ReserveOrReuse", taskId }
  },
  order: {
    _tag: "FreshWorkflowOrder",
    frontierOrdinal: DeliveryProposalOrdinal.make(0),
    step: "ReadCurrentTaskGraph",
    taskId
  },
  owner: "TicketDelivery"
})

const ownerOf = (proposal: DeliveryActionProposal, settled: boolean): DeliveryRuntimeLiveOwnerSnapshot =>
  settled ? { _tag: "SettledBeforeMaterialization", proposal } : { _tag: "AdmittedDeliveryAction", proposal }

const taskClaimEvidenceOf = (taskId: TaskId): TicketDeliveryEvidence => ({
  _tag: "ResponsibilityFacts",
  facts: {
    _tag: "WorkflowOperationFreshFacts",
    disposition: ResponsibilityDisposition.Ready(),
    responsibility: WorkflowResponsibilityEntry.cases.TaskClaimResponsibility.make({
      acquisition: TaskClaimAcquisition.make({
        operationId: OperationId.make(`status-claim:${taskId}`),
        owner: ClaimOwner.make("dalph"),
        taskId,
        token: ClaimToken.make(`status-token:${taskId}`)
      }),
      beganAt: JournalPosition.make(2),
      taskId
    })
  }
})

const evaluationOf = ({
  capacity = policy.taskExecutionCapacity,
  established = true,
  evidence = [],
  held = [],
  isolatedIssues = [],
  liveOwners = [],
  proposals = [],
  proposedActions = { _tag: "DeliveryProposalsAvailable", isolatedIssues, proposals },
  tasks = [],
  withRunId = true,
  runtimeRunId = runId
}: {
  readonly tasks?: ReadonlyArray<{ readonly id: string; readonly prerequisiteIds?: ReadonlyArray<string> }>
  readonly established?: boolean
  readonly evidence?: ReadonlyArray<TicketDeliveryEvidence>
  readonly isolatedIssues?: ReadonlyArray<DeliveryProposalDerivationIssue>
  readonly proposals?: ReadonlyArray<DeliveryActionProposal>
  readonly proposedActions?: DeliveryProposalFrontier
  readonly liveOwners?: ReadonlyArray<DeliveryRuntimeLiveOwnerSnapshot>
  readonly held?: ReadonlyArray<{
    readonly taskId: TaskId
    readonly correlation: { readonly attemptId: AttemptId; readonly runId: RunId }
  }>
  readonly capacity?: TaskWorkCapacity
  readonly withRunId?: boolean
  readonly runtimeRunId?: RunId
} = {}): DeliveryRuntimeObservationState => {
  const graph = graphStateOf(tasks, established)
  const publication = { exactEvidence: evidence, graph, policy: { ...policy, taskExecutionCapacity: capacity } }
  const tickets = boundedParallelTicketsOf(frontierOf(publication))
  const ticketDeliveries = ticketDeliveriesOf(tickets, evidence)
  const settlements = deliverySettlementsOf(ticketDeliveries)
  const current: DeliveryRuntimeSnapshot = {
    _tag: "DeliveryRuntimeSnapshot",
    reflection: makeDeliveryReflection(settlements),
    settlements,
    ticketDeliveries,
    trackerGraph: graph,
    ...(withRunId ? { runId: runtimeRunId } : {}),
    cancellationApplied: false
  }
  const evaluation: DeliveryRuntimeEvaluation = {
    _tag: "DeliveryRuntimeEvaluation",
    acceptedAt: JournalPosition.make(5),
    current,
    pauseCoverage: {
      _tag: "PauseCoverageGraphNotEstablished",
      applied: { run: { _tag: "RunUnpaused" }, tasks: { _tag: "NoTaskPauses" } }
    },
    proposedActions,
    quiescence: { _tag: "TrackerReconfirmationAllowed" },
    taskWork: { capacity, held },
    cancellationApplied: false
  }
  return DeliveryRuntimeObservationState.Ready({ evaluation, liveOwners })
}

const statusFor = (state: DeliveryRuntimeObservationState, subject: unknown): CurrentDeliveryStatus => {
  const decoded = Schema.decodeUnknownSync(DeliveryStatusSubject)(subject)
  const result = deliveryStatusOf(decoded, state)
  if (
    result instanceof DeliveryStatusProjectionConflict ||
    result instanceof DeliveryStatusRunIdentityUnavailable ||
    result instanceof DeliveryStatusRunMismatch
  ) {
    expect.fail(result.message)
  }
  return result
}

it.effect("explains eligible work waiting for exact capacity", () =>
  Effect.gen(function* () {
    yield* Effect.void
    const state = evaluationOf({
      tasks: [{ id: "A" }, { id: "B" }, { id: "C" }],
      held: [
        { taskId: TaskId.make("C"), correlation: { attemptId: AttemptId.make("C-attempt"), runId } },
        { taskId: TaskId.make("B"), correlation: { attemptId: AttemptId.make("B-attempt"), runId } }
      ]
    })
    const status = statusFor(state, { _tag: "Task", runId, taskId: TaskId.make("A") })
    expect(status).toMatchObject({ _tag: "DeliveryStatusAvailable", entries: [{ _tag: "TaskWorkCapacityWait" }] })
    if (status._tag !== "DeliveryStatusAvailable") return
    const wait = status.entries.find(({ _tag }) => _tag === "TaskWorkCapacityWait")
    expect(wait).toMatchObject({
      scope: { _tag: "RunTaskWorkCapacityScope", runId, capacity: TaskWorkCapacity.make(2) },
      holders: [{ taskId: TaskId.make("B") }, { taskId: TaskId.make("C") }]
    })
  })
)

it.effect("explains dependency waits from the complete graph and does not call a tracker", () =>
  Effect.gen(function* () {
    const state = evaluationOf({ tasks: [{ id: "A" }, { id: "B" }, { id: "D", prerequisiteIds: ["A", "B"] }] })
    const signal = yield* deliveryStatusSignalOf(currentSignalOf(state), { _tag: "Run", runId })
    const status = yield* signal.get
    expect(status).toMatchObject({ _tag: "DeliveryStatusAvailable" })
    if (status._tag !== "DeliveryStatusAvailable") return
    expect(status.entries.some((entry) => entry._tag === "DependencyWait" && entry.taskId === TaskId.make("D"))).toBe(
      true
    )
  })
)

it.effect("explains exact dependency and tracker-fact waits", () =>
  Effect.gen(function* () {
    yield* Effect.void
    const taskId = TaskId.make("E")
    const claim = taskClaimEvidenceOf(taskId)
    if (claim._tag !== "ResponsibilityFacts" || claim.facts._tag !== "WorkflowOperationFreshFacts") {
      return expect.fail("status claim fixture must retain one workflow responsibility")
    }
    const cases = [
      {
        claimState: "Missing" as const,
        fact: "Missing" as const,
        wakeCondition: "ExplicitAppliedTaskClaimReacquisitionDirection" as const
      },
      {
        claimState: "Unreadable" as const,
        fact: "Unreadable" as const,
        wakeCondition: "TaskClaimFactsObserved" as const
      },
      {
        claimState: "Unobserved" as const,
        fact: "Unobserved" as const,
        wakeCondition: "TaskClaimFactsObserved" as const
      }
    ]
    for (const { claimState, fact, wakeCondition } of cases) {
      const state = evaluationOf({
        tasks: [{ id: "D", prerequisiteIds: ["A", "B"] }, { id: "A" }, { id: "B" }, { id: "E" }],
        evidence: [
          {
            ...claim,
            facts: {
              ...claim.facts,
              disposition: ResponsibilityDisposition.WorkflowOperationTaskClaimConstraint({ claimState })
            }
          }
        ]
      })
      const status = statusFor(state, { _tag: "Run", runId })
      expect(status).toMatchObject({ _tag: "DeliveryStatusAvailable" })
      if (status._tag !== "DeliveryStatusAvailable") return
      expect(status.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            _tag: "DependencyWait",
            taskId: TaskId.make("D"),
            prerequisiteTaskIds: [TaskId.make("A"), TaskId.make("B")]
          }),
          expect.objectContaining({
            _tag: "TrackerFactWait",
            responsibility: expect.objectContaining({ _tag: "WorkflowResponsibility" }),
            fact: { _tag: fact, boundary: "TaskTracker" },
            wakeCondition,
            standing: expect.objectContaining({ _tag: "ResponsibilitySituation" })
          })
        ])
      )
    }
  })
)

it.effect("distinguishes proposed, live, and accepted publication-pending actions", () =>
  Effect.gen(function* () {
    yield* Effect.void
    const proposal = proposalOf("status-proposal")
    const proposed = statusFor(evaluationOf({ proposals: [proposal] }), { _tag: "Run", runId })
    expect(proposed).toMatchObject({ entries: [{ _tag: "ProposedDeliveryAction" }] })

    const live = statusFor(evaluationOf({ proposals: [proposal], liveOwners: [ownerOf(proposal, false)] }), {
      _tag: "Run",
      runId
    })
    expect(live).toMatchObject({ entries: [{ _tag: "LiveDeliveryAction" }] })
    if (live._tag === "DeliveryStatusAvailable") {
      expect(live.entries.some(({ _tag }) => _tag === "ProposedDeliveryAction")).toBe(false)
    }

    const pending = statusFor(evaluationOf({ proposals: [proposal], liveOwners: [ownerOf(proposal, true)] }), {
      _tag: "Run",
      runId
    })
    expect(pending).toMatchObject({ entries: [{ _tag: "AcceptedFactPublicationWait" }] })
    if (pending._tag === "DeliveryStatusAvailable") {
      expect(pending.entries.some(({ _tag }) => _tag === "ProposedDeliveryAction")).toBe(false)
    }
  })
)

it.effect("fails closed when proposal ownership is contradictory", () =>
  Effect.gen(function* () {
    yield* Effect.void
    const proposal = proposalOf("status-conflicting-proposal")
    const proposedActions: DeliveryProposalFrontier = {
      _tag: "DeliveryProposalOwnershipConflict",
      conflicts: [{ id: proposal.id, order: proposal.order, owners: ["TrackerGraph", "TicketDelivery"] }]
    }
    const result = deliveryStatusOf(
      Schema.decodeUnknownSync(DeliveryStatusSubject)({ _tag: "Run", runId }),
      evaluationOf({ proposedActions })
    )
    expect(result).toBeInstanceOf(DeliveryStatusProjectionConflict)
  })
)

it.effect("localizes unavailable evidence without blocking an independent task", () =>
  Effect.gen(function* () {
    yield* Effect.void
    const taskA = TaskId.make("A")
    const taskB = TaskId.make("B")
    const issue: DeliveryProposalDerivationIssue = {
      _tag: "AcceptedOperationEvidenceMissing",
      operationId: OperationId.make("status-missing-operation"),
      taskId: taskA,
      transition: "CommitFreshTaskClaimIntent"
    }
    const proposal = taskProposalOf("status-live-B", taskB)
    const status = statusFor(
      evaluationOf({
        tasks: [{ id: "A" }, { id: "B" }],
        isolatedIssues: [issue],
        proposals: [proposal],
        liveOwners: [ownerOf(proposal, false)]
      }),
      { _tag: "Run", runId }
    )
    expect(status).toMatchObject({ _tag: "DeliveryStatusAvailable" })
    if (status._tag !== "DeliveryStatusAvailable") return
    expect(status.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _tag: "EvidenceUnavailable",
          subject: { _tag: "Task", runId, taskId: taskA },
          responsibility: null,
          evidence: { _tag: "ProposalDerivationIssue", issue }
        }),
        expect.objectContaining({
          _tag: "LiveDeliveryAction",
          subject: { _tag: "Task", runId, taskId: taskB },
          owner: ownerOf(proposal, false)
        })
      ])
    )
    expect(
      status.entries.some(
        ({ _tag, subject }) => _tag === "LiveDeliveryAction" && subject._tag === "Task" && subject.taskId === taskA
      )
    ).toBe(false)
  })
)

it.effect("localizes contradictory evidence without blocking an independent task", () =>
  Effect.gen(function* () {
    yield* Effect.void
    const taskA = TaskId.make("A")
    const taskB = TaskId.make("B")
    const conflicting = taskClaimEvidenceOf(taskA)
    const proposal = taskProposalOf("status-live-B-conflict", taskB)
    const status = statusFor(
      evaluationOf({
        tasks: [{ id: "A" }, { id: "B" }],
        evidence: [conflicting, conflicting],
        proposals: [proposal],
        liveOwners: [ownerOf(proposal, false)]
      }),
      { _tag: "Run", runId }
    )
    expect(status).toMatchObject({ _tag: "DeliveryStatusAvailable" })
    if (status._tag !== "DeliveryStatusAvailable") return
    const conflict = status.entries.find(({ _tag }) => _tag === "EvidenceConflict")
    expect(conflict).toMatchObject({
      _tag: "EvidenceConflict",
      subject: { _tag: "Task", runId, taskId: taskA },
      evidenceIdentities: [expect.any(String)]
    })
    expect(
      status.entries.some(
        ({ _tag, subject }) => _tag === "EvidenceUnavailable" && subject._tag === "Task" && subject.taskId === taskA
      )
    ).toBe(false)
    expect(status.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ _tag: "LiveDeliveryAction", subject: { _tag: "Task", runId, taskId: taskB } })
      ])
    )
  })
)

it.effect("explains the exact integration target wait without receiving resource authority", () =>
  Effect.gen(function* () {
    yield* Effect.void
    const fixture = integrationFinalityFixture
    const queued = QueuedIntegrationResponsibility.make({
      acceptedResult: fixture.promotionCorrelation.qualifiedCandidate.run.session.acceptedResult,
      integrationTarget: fixture.integrationTarget,
      plannedAttempt: fixture.plannedAttempt,
      preIntegrationCancellation: {
        attemptId: fixture.plannedAttempt.attemptId,
        queuedAt: JournalPosition.make(2),
        runId: fixture.runId
      },
      queuedAt: JournalPosition.make(2)
    })
    const status = statusFor(
      evaluationOf({
        runtimeRunId: fixture.runId,
        tasks: [{ id: String(fixture.taskId) }],
        evidence: [
          { _tag: "QueuedIntegration", responsibility: queued },
          { _tag: "IntegrationWait", wait: { _tag: "IntegrationTargetWait", plannedAttempt: fixture.plannedAttempt } }
        ]
      }),
      { _tag: "Task", runId: fixture.runId, taskId: fixture.taskId }
    )
    expect(status).toMatchObject({ _tag: "DeliveryStatusAvailable" })
    if (status._tag !== "DeliveryStatusAvailable") return
    expect(status.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _tag: "IntegrationTargetWait",
          plannedAttempt: fixture.plannedAttempt,
          integrationTarget: fixture.integrationTarget,
          responsibility: expect.objectContaining({ _tag: "QueuedIntegration", responsibility: queued }),
          wait: { _tag: "IntegrationTargetWait", plannedAttempt: fixture.plannedAttempt },
          standing: expect.objectContaining({ _tag: "IntegrationWait" })
        })
      ])
    )
  })
)

it.effect("fails closed when an integration target wait has no exact queued responsibility", () =>
  Effect.gen(function* () {
    yield* Effect.void
    const fixture = integrationFinalityFixture
    const result = deliveryStatusOf(
      Schema.decodeUnknownSync(DeliveryStatusSubject)({ _tag: "Task", runId: fixture.runId, taskId: fixture.taskId }),
      evaluationOf({
        runtimeRunId: fixture.runId,
        tasks: [{ id: String(fixture.taskId) }],
        evidence: [
          { _tag: "IntegrationWait", wait: { _tag: "IntegrationTargetWait", plannedAttempt: fixture.plannedAttempt } }
        ]
      })
    )
    expect(result).toBeInstanceOf(DeliveryStatusProjectionConflict)
  })
)

it.effect("keeps settlement and relinquishment distinct with exact supporting facts", () =>
  Effect.gen(function* () {
    yield* Effect.void
    const fixture = integrationFinalityFixture
    const settlement = IntegrationFinalitySettledEvent.make({
      claim: fixture.claim,
      deletionOperationId: OperationId.make("status-settlement-deletion"),
      replacementOperationId: OperationId.make("status-settlement-replacement"),
      successObservation: fixture.successObservation,
      version: workflowJournalEventVersion
    })
    const relinquishedTask = TaskId.make("B")
    const relinquished = taskClaimEvidenceOf(relinquishedTask)
    if (relinquished._tag !== "ResponsibilityFacts" || relinquished.facts._tag !== "WorkflowOperationFreshFacts") {
      return expect.fail("status relinquishment fixture must retain one workflow responsibility")
    }
    const status = statusFor(
      evaluationOf({
        runtimeRunId: fixture.runId,
        tasks: [{ id: String(fixture.taskId) }, { id: "B" }],
        evidence: [
          { _tag: "IntegrationFinalitySettlement", settlement },
          {
            ...relinquished,
            facts: {
              ...relinquished.facts,
              disposition: ResponsibilityDisposition.Relinquished({ reason: "AuthorizedHandoff" })
            }
          }
        ]
      }),
      { _tag: "Run", runId: fixture.runId }
    )
    expect(status).toMatchObject({ _tag: "DeliveryStatusAvailable" })
    if (status._tag !== "DeliveryStatusAvailable") return
    expect(status.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _tag: "Settlement",
          subject: expect.objectContaining({ _tag: "Task", runId: fixture.runId, taskId: fixture.taskId }),
          taskId: fixture.taskId,
          attemptId: fixture.plannedAttempt.attemptId,
          settlement: expect.objectContaining({ _tag: "DeliverySettlement", taskId: fixture.taskId })
        }),
        expect.objectContaining({
          _tag: "Relinquishment",
          subject: expect.objectContaining({ _tag: "Task", runId: fixture.runId, taskId: relinquishedTask }),
          responsibility: expect.objectContaining({ _tag: "WorkflowResponsibility" }),
          reason: "AuthorizedHandoff"
        })
      ])
    )
    const settlementEntry = status.entries.find(({ _tag }) => _tag === "Settlement")
    const relinquishmentEntry = status.entries.find(({ _tag }) => _tag === "Relinquishment")
    expect(settlementEntry?.classification).toBe("Settled")
    expect(relinquishmentEntry?.classification).toBe("Relinquished")
  })
)

it.effect("reconnects current-first and distinguishes not-ready, absent, wrong-Run, and closed", () =>
  Effect.gen(function* () {
    const notReady = DeliveryRuntimeObservationState.NotReady()
    expect(statusFor(notReady, { _tag: "Run", runId })).toMatchObject({ _tag: "DeliveryStatusNotReady" })

    const absent = statusFor(evaluationOf({ tasks: [{ id: "A" }] }), { _tag: "Task", runId, taskId: TaskId.make("Z") })
    expect(absent).toMatchObject({
      _tag: "TaskAbsentFromCurrentGraph",
      graphSource: { revision: "status-graph-revision" }
    })

    const wrong = deliveryStatusOf(
      Schema.decodeUnknownSync(DeliveryStatusSubject)({ _tag: "Run", runId: RunId.make("other-run") }),
      evaluationOf({ tasks: [{ id: "A" }] })
    )
    expect(wrong).toBeInstanceOf(DeliveryStatusRunMismatch)

    const ready = evaluationOf({ tasks: [{ id: "A" }] })
    const closed = DeliveryRuntimeObservationState.Closed({ final: ready._tag === "Ready" ? ready : null })
    expect(statusFor(closed, { _tag: "Run", runId })).toMatchObject({
      _tag: "DeliveryStatusClosed",
      final: { _tag: "DeliveryStatusAvailable" }
    })

    const signal = yield* deliveryStatusSignalOf(currentSignalOf(ready), { _tag: "Run", runId })
    expect(yield* signal.get).toMatchObject({ _tag: "DeliveryStatusAvailable" })
  })
)

it.effect("fails closed when the coherent runtime snapshot has no RunId", () =>
  Effect.gen(function* () {
    yield* Effect.void
    const result = deliveryStatusOf(
      Schema.decodeUnknownSync(DeliveryStatusSubject)({ _tag: "Run", runId }),
      evaluationOf({ withRunId: false })
    )
    expect(result).toBeInstanceOf(DeliveryStatusRunIdentityUnavailable)
  })
)

it("uses accepted delivery order only for task grouping, while structural order handles input permutations", () => {
  const taskA = TaskId.make("A")
  const taskB = TaskId.make("B")
  const proposalA = taskProposalOf("status-task-order-A", taskA)
  const proposalB = taskProposalOf("status-task-order-B", taskB)
  const state = evaluationOf({
    tasks: [{ id: "A" }, { id: "B" }],
    proposals: [proposalA, proposalB],
    liveOwners: [ownerOf(proposalA, false), ownerOf(proposalB, false)]
  })
  if (state._tag !== "Ready") return expect.fail("order fixture must be ready")
  const canonical = statusFor(state, { _tag: "Run", runId })
  const reversed = DeliveryRuntimeObservationState.Ready({
    evaluation: {
      ...state.evaluation,
      current: {
        ...state.evaluation.current,
        ticketDeliveries: {
          ...state.evaluation.current.ticketDeliveries,
          deliveries: state.evaluation.current.ticketDeliveries.deliveries.toReversed()
        }
      }
    },
    liveOwners: state.liveOwners
  })
  const reversedStatus = statusFor(reversed, { _tag: "Run", runId })
  if (canonical._tag !== "DeliveryStatusAvailable" || reversedStatus._tag !== "DeliveryStatusAvailable") {
    return expect.fail("order fixture must remain available")
  }
  expect(canonical.entries.map(({ subject }) => (subject._tag === "Task" ? subject.taskId : null))).toEqual([
    taskA,
    taskB
  ])
  expect(reversedStatus.entries.map(({ subject }) => (subject._tag === "Task" ? subject.taskId : null))).toEqual([
    taskB,
    taskA
  ])
})

it.effect("reconnects to current status without a durable UI cursor", () =>
  Effect.gen(function* () {
    const before = evaluationOf({
      tasks: [{ id: "A" }, { id: "B" }, { id: "C" }],
      held: [
        { taskId: TaskId.make("C"), correlation: { attemptId: AttemptId.make("C-before"), runId } },
        { taskId: TaskId.make("B"), correlation: { attemptId: AttemptId.make("B-before"), runId } }
      ]
    })
    const proposal = taskProposalOf("status-reconnect-A", TaskId.make("A"))
    const after = evaluationOf({
      tasks: [{ id: "A" }, { id: "B" }],
      proposals: [proposal],
      liveOwners: [ownerOf(proposal, false)]
    })
    const source = currentSignalFromCurrentFirstStream(Stream.fromIterable([before, after]))
    const statusSignal = yield* deliveryStatusSignalOf(source, { _tag: "Run", runId })
    const first = yield* statusSignal.get
    expect(first).toMatchObject({ _tag: "DeliveryStatusAvailable" })
    const observed = yield* statusSignal.changes.pipe(Stream.take(2), Stream.runCollect)
    expect(observed).toHaveLength(2)
    expect(observed[0]).toMatchObject({ entries: [{ _tag: "TaskWorkCapacityWait" }] })
    expect(observed[1]).toMatchObject({ entries: [{ _tag: "LiveDeliveryAction" }] })
  })
)

it.effect("requires only a passive status signal and performs no journal or authority call", () =>
  Effect.gen(function* () {
    const state = evaluationOf({ tasks: [{ id: "A" }] })
    const signal = yield* deliveryStatusSignalOf(
      currentSignalFromCurrentFirstStream(Stream.fromIterable([state, state])),
      { _tag: "Run", runId }
    )
    expect(Object.keys(signal).toSorted()).toEqual(["attach", "changes", "get"])
    expect(yield* signal.get).toMatchObject({ _tag: "DeliveryStatusAvailable" })
    yield* signal.changes.pipe(Stream.take(2), Stream.runCollect)
    expect(statusProjectionHasOnlyObservationInputs).toBe(true)
    expect(statusVocabularyHasNoExecutorPrivateTags).toBe(true)
    const source = readFileSync(fileURLToPath(new URL("./delivery-status.ts", import.meta.url)), "utf8")
    expect(source).not.toMatch(
      /\b(?:JournalStore|DeliveryRuntimeResourcesService|DeliveryRuntimeAdmissionController|TaskTrackerService|GitService|IntegratorService|ApplicationExitService)\b/
    )
  })
)

it.effect("does not append a status value or cursor to the workflow Journal", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    const before = yield* journal.read(runId)
    const signal = yield* deliveryStatusSignalOf(currentSignalOf(evaluationOf({ tasks: [{ id: "A" }] })), {
      _tag: "Run",
      runId
    })
    yield* signal.get
    const after = yield* journal.read(runId)
    expect(after).toEqual(before)
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)
