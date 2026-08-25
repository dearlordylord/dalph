/* eslint-disable import/no-nodejs-modules -- The capability guard reads this module's static imports only. */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import {
  AttemptId,
  PlannedAttemptExecutorReport,
  RunId,
  TaskId,
  plannedAttemptExecutorCorrelation
} from "@dalph/contracts"
import { it } from "@effect/vitest"
import { Context, Effect, Ref, Schema, Stream } from "effect"
import { expect } from "vitest"
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import { TaskClaimAcquisition, TrackerMutation } from "../../authorities/task-tracker/claim-mutation.js"
import { TaskDagSnapshot } from "../../authorities/task-tracker/graph.js"
import { TaskLifecycle, TrackerRevision, TrackerSnapshot } from "../../authorities/task-tracker/task.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { initialRunPolicyRevision, RunControlPolicy } from "../../control/policy.js"
import {
  ResponsibilityDisposition,
  type PlannedAttemptExecutorDisposition,
  type ResponsibilityFreshFacts
} from "../frontier/fresh-facts.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { OperationId } from "../../workflow/identity.js"
import { WorkflowResponsibilityEntry } from "../reconstruction/state.js"
import { makeTaskClaimObservationOperation } from "../../workflow/registry/operation.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import {
  DeliveryProposalId,
  DeliveryProposalOrdinal,
  deliveryProposalOrderTaskId,
  trackerGraphReadProposalOf,
  type DeliveryActionProposal,
  type DeliveryProposalDerivationIssue
} from "./delivery-action-proposal.js"
import {
  DeliveryRuntimeObservationPublication,
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
import {
  CompletionTaskBoundary,
  IntegrationFinalitySettledEvent
} from "../../workflow/protocols/integration-finality/events.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import {
  QueuedIntegrationResponsibility,
  UnqueuedAcceptedResult
} from "../../workflow/protocols/integration-admission/protocol.js"
import { StartedIntegrationResponsibility } from "../../workflow/protocols/integration-admission/responsibility.js"
import { memoryJournalStoreLayer } from "../../workflow-journal/adapters/memory-store.js"
import { JournalStore, RunLifecycleJournal } from "../../workflow-journal/store.js"
import { TrackerGraphReader } from "../../authorities/task-tracker/graph-reader.js"
import { GitCommand } from "../../authorities/git/command.js"
import { GitTargetLineage } from "../../authorities/git/target-lineage.js"
import { GitWorktree } from "../../authorities/git/worktree.js"
import { CoordinatorOwnership } from "../../authorities/coordinator-ownership/ownership.js"
import { DeliveryRuntimeResourceCapabilityPair, DeliveryRuntimeResources } from "./delivery-runtime-resources.js"
import { DeliveryActionExecutor } from "./delivery-action-executor.js"
import { DeliveryAcceptedFactPublication } from "./delivery-accepted-fact-publication.js"
import { Journal } from "./journal.js"
import { ApplicationExitAdmission } from "../application-exit/lifecycle.js"
import { Integrator, IntegratorGit } from "../../workflow/protocols/integrator/protocol.js"
import { PlannedAttemptProtocolController } from "../../workflow/protocols/planned-attempt-executor-work/protocol-controller.js"
import { TaskWorkCapacityControl } from "../../control/task-work-capacity.js"
import { ControlDirectionApplication } from "../../workflow/protocols/control-direction-application/protocol.js"
import { TaskClaimReacquisitionControl } from "../../workflow/protocols/task-claim-reacquisition/control.js"
import { AttemptChoiceControl } from "../../workflow/protocols/attempt-choice/control.js"
import { IntegrationQuarantineDirectionControl } from "../../workflow/protocols/integration-quarantine/control.js"
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

const integrationFactsOf = () => {
  const fixture = integrationFinalityFixture
  const accepted = UnqueuedAcceptedResult.make({
    acceptedResult: fixture.promotionCorrelation.qualifiedCandidate.run.session.acceptedResult,
    plannedAttempt: fixture.plannedAttempt,
    terminalAt: JournalPosition.make(2)
  })
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
  const started = StartedIntegrationResponsibility.make({
    acceptedResult: fixture.promotionCorrelation.qualifiedCandidate.run.session.acceptedResult,
    integrationTarget: fixture.integrationTarget,
    plannedAttempt: fixture.plannedAttempt,
    queuedAt: JournalPosition.make(2),
    startedAt: JournalPosition.make(3)
  })
  return { accepted, fixture, queued, started }
}

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
  // A coherent runtime snapshot contains an accepted task order for every
  // task-scoped proposal/issue. Keep small fixtures honest without weakening
  // the production projection's fail-closed missing-order check.
  const actionProposals = [
    ...proposals,
    ...(proposedActions._tag === "DeliveryProposalsAvailable" ? proposedActions.proposals : []),
    ...liveOwners.map(({ proposal }) => proposal)
  ]
  const inferredTaskIds = [
    ...actionProposals.map(({ order }) => deliveryProposalOrderTaskId(order)),
    ...isolatedIssues.map(({ taskId }) => taskId)
  ].filter((taskId): taskId is TaskId => taskId !== null)
  const configuredTasks = new Map(tasks.map((task) => [task.id, task] as const))
  for (const taskId of inferredTaskIds) {
    const id = String(taskId)
    if (!configuredTasks.has(id)) configuredTasks.set(id, { id })
  }
  const graph = graphStateOf([...configuredTasks.values()], established)
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

it.effect("explains graph-only dependency waits without workflow evidence", () =>
  Effect.gen(function* () {
    const state = evaluationOf({ tasks: [{ id: "A" }, { id: "B" }, { id: "D", prerequisiteIds: ["A", "B"] }] })
    const signal = yield* deliveryStatusSignalOf(currentSignalOf(state), { _tag: "Run", runId })
    const status = yield* signal.get
    expect(status).toMatchObject({ _tag: "DeliveryStatusAvailable" })
    if (status._tag !== "DeliveryStatusAvailable") return
    expect(status.entries.some((entry) => entry._tag === "DependencyWait" && entry.taskId === TaskId.make("D"))).toBe(
      true
    )

    const ready = evaluationOf({ tasks: [{ id: "A" }, { id: "B" }, { id: "D", prerequisiteIds: ["A", "B"] }] })
    if (ready._tag !== "Ready") return expect.fail("graph-only malformed fixture must be ready")
    const malformedGraph = DeliveryRuntimeObservationState.Ready({
      evaluation: {
        ...ready.evaluation,
        current: {
          ...ready.evaluation.current,
          ticketDeliveries: {
            ...ready.evaluation.current.ticketDeliveries,
            source: {
              ...ready.evaluation.current.ticketDeliveries.source,
              placements: ready.evaluation.current.ticketDeliveries.source.placements.map(({ placement, taskId }) =>
                taskId === TaskId.make("D") && placement._tag === "GraphExcluded"
                  ? {
                      taskId,
                      placement: {
                        ...placement,
                        reasons: [{ _tag: "PrerequisitesIncomplete", prerequisiteTaskIds: [] }]
                      }
                    }
                  : { placement, taskId }
              )
            }
          }
        }
      },
      liveOwners: []
    })
    expect(deliveryStatusOf({ _tag: "Run", runId }, malformedGraph)).toBeInstanceOf(DeliveryStatusProjectionConflict)
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
      },
      {
        claimState: "Foreign" as const,
        fact: "Foreign" as const,
        wakeCondition: "ExplicitAppliedTaskClaimReacquisitionDirection" as const
      }
    ]
    for (const { claimState, fact, wakeCondition } of cases) {
      const state = evaluationOf({
        tasks: [{ id: "D", prerequisiteIds: ["A", "B"] }, { id: "A" }, { id: "B" }, { id: "E" }],
        evidence: [
          taskClaimEvidenceOf(TaskId.make("D")),
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

it("projects promoted prerequisite release as an exact dependency wait", () => {
  const state = evaluationOf({ tasks: [{ id: "A" }, { id: "B" }] })
  if (state._tag !== "Ready") return expect.fail("promoted prerequisite fixture must be ready")
  const promotedTask = TaskId.make("B")
  const delivery = state.evaluation.current.ticketDeliveries.deliveries.find(({ taskId }) => taskId === promotedTask)
  if (delivery === undefined) return expect.fail("promoted prerequisite delivery must exist")
  const promoted = DeliveryRuntimeObservationState.Ready({
    evaluation: {
      ...state.evaluation,
      current: {
        ...state.evaluation.current,
        ticketDeliveries: {
          ...state.evaluation.current.ticketDeliveries,
          deliveries: [
            {
              ...delivery,
              standings: [{ _tag: "PromotedPrerequisiteReleasePending", prerequisiteTaskIds: [TaskId.make("A")] }]
            },
            ...state.evaluation.current.ticketDeliveries.deliveries.filter(({ taskId }) => taskId !== promotedTask)
          ]
        }
      }
    },
    liveOwners: []
  })
  const status = statusFor(promoted, { _tag: "Task", runId, taskId: promotedTask })
  expect(status).toMatchObject({ _tag: "DeliveryStatusAvailable" })
  if (status._tag !== "DeliveryStatusAvailable") return
  const wait = status.entries.find(({ _tag }) => _tag === "DependencyWait")
  expect(wait?._tag).toBe("DependencyWait")
  if (wait?._tag !== "DependencyWait") return
  expect(wait.taskId).toBe(promotedTask)
  expect(wait.prerequisiteTaskIds).toEqual([TaskId.make("A")])
  expect(wait.standing._tag).toBe("PromotedPrerequisiteReleasePending")

  const emptyPromoted = DeliveryRuntimeObservationState.Ready({
    evaluation: {
      ...state.evaluation,
      current: {
        ...state.evaluation.current,
        ticketDeliveries: {
          ...state.evaluation.current.ticketDeliveries,
          deliveries: [
            {
              ...delivery,
              standings: [
                {
                  _tag: "PromotedPrerequisiteReleasePending",
                  // @ts-expect-error -- malformed fixture exercises fail-closed validation.
                  prerequisiteTaskIds: []
                }
              ]
            },
            ...state.evaluation.current.ticketDeliveries.deliveries.filter(({ taskId }) => taskId !== promotedTask)
          ]
        }
      }
    },
    liveOwners: []
  })
  expect(deliveryStatusOf({ _tag: "Task", runId, taskId: promotedTask }, emptyPromoted)).toBeInstanceOf(
    DeliveryStatusProjectionConflict
  )
})

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

it("fails closed for every tracker-claim fact when its exact responsibility is absent", () => {
  const taskId = TaskId.make("tracker-matrix")
  const claim = taskClaimEvidenceOf(taskId)
  if (claim._tag !== "ResponsibilityFacts") return expect.fail("tracker matrix fixture must retain facts")
  if (claim.facts._tag !== "WorkflowOperationFreshFacts")
    return expect.fail("tracker matrix fixture must use workflow facts")
  const claimStates = ["Missing", "Unreadable", "Unobserved", "Foreign"] as const
  for (const claimState of claimStates) {
    const state = evaluationOf({
      tasks: [{ id: String(taskId) }],
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
    if (state._tag !== "Ready") return expect.fail("tracker matrix state must be ready")
    const delivery = state.evaluation.current.ticketDeliveries.deliveries[0]
    if (delivery === undefined) return expect.fail("tracker matrix delivery must exist")
    const contradictory = DeliveryRuntimeObservationState.Ready({
      evaluation: {
        ...state.evaluation,
        current: {
          ...state.evaluation.current,
          ticketDeliveries: {
            ...state.evaluation.current.ticketDeliveries,
            deliveries: [{ ...delivery, obligations: [] }]
          }
        }
      },
      liveOwners: state.liveOwners
    })
    expect(
      deliveryStatusOf(Schema.decodeUnknownSync(DeliveryStatusSubject)({ _tag: "Run", runId }), contradictory)
    ).toBeInstanceOf(DeliveryStatusProjectionConflict)
  }
})

it("maps responsibility dispositions by meaning without turning terminal or paused facts into blocked evidence", () => {
  const workflowTask = TaskId.make("semantic-workflow")
  const workflow = taskClaimEvidenceOf(workflowTask)
  if (workflow._tag !== "ResponsibilityFacts" || workflow.facts._tag !== "WorkflowOperationFreshFacts") {
    return expect.fail("semantic workflow fixture must retain workflow facts")
  }
  const workflowCases: ReadonlyArray<{
    readonly disposition: Extract<
      ResponsibilityFreshFacts,
      { readonly _tag: "WorkflowOperationFreshFacts" }
    >["disposition"]
    readonly expected: ReadonlyArray<"DependencyWait" | "EvidenceUnavailable" | "TrackerFactWait">
  }> = [
    { disposition: ResponsibilityDisposition.Paused(), expected: [] as const },
    { disposition: ResponsibilityDisposition.FinalOutcome({ outcome: "Completed" }), expected: [] as const },
    { disposition: ResponsibilityDisposition.Settled({ outcome: "ResponsibilityCompleted" }), expected: [] as const },
    {
      disposition: ResponsibilityDisposition.WorkflowOperationGitConstraint({ gitState: "WorktreeLost" }),
      expected: ["EvidenceUnavailable"] as const
    },
    { disposition: ResponsibilityDisposition.TaskMembershipConstraint(), expected: ["EvidenceUnavailable"] as const },
    {
      disposition: ResponsibilityDisposition.WorkflowOperationTaskClaimConstraint({ claimState: "Missing" }),
      expected: ["TrackerFactWait"] as const
    },
    {
      disposition: ResponsibilityDisposition.DependencyWait({ prerequisiteTaskIds: [TaskId.make("prerequisite")] }),
      expected: ["DependencyWait"] as const
    },
    { disposition: ResponsibilityDisposition.MissingClaim(), expected: ["TrackerFactWait"] as const },
    { disposition: ResponsibilityDisposition.ForeignClaimIsolation(), expected: ["TrackerFactWait"] as const },
    {
      disposition: ResponsibilityDisposition.UnreadableFactWait({ boundary: "TaskTracker" }),
      expected: ["TrackerFactWait"] as const
    },
    {
      disposition: ResponsibilityDisposition.UnreadableFactWait({ boundary: "Executor" }),
      expected: ["EvidenceUnavailable"] as const
    },
    {
      disposition: ResponsibilityDisposition.UnreadableFactWait({ boundary: "Git" }),
      expected: ["EvidenceUnavailable"] as const
    }
  ]
  for (const { disposition, expected } of workflowCases) {
    const status = statusFor(
      evaluationOf({
        tasks: [{ id: String(workflowTask) }],
        evidence: [{ ...workflow, facts: { ...workflow.facts, disposition } }]
      }),
      { _tag: "Task", runId, taskId: workflowTask }
    )
    expect(status).toMatchObject({ _tag: "DeliveryStatusAvailable" })
    if (status._tag !== "DeliveryStatusAvailable") continue
    expect(
      status.entries
        .filter(({ _tag }) => _tag === "DependencyWait" || _tag === "EvidenceUnavailable" || _tag === "TrackerFactWait")
        .map(({ _tag }) => _tag)
    ).toEqual(expected)
  }

  const executorTask = integrationFinalityFixture.taskId
  const executorResponsibility = {
    _tag: "PlannedAttemptExecutorWorkResponsibility" as const,
    beganAt: JournalPosition.make(2),
    plannedAttempt: integrationFinalityFixture.plannedAttempt
  }
  const executorCases: ReadonlyArray<
    readonly [PlannedAttemptExecutorDisposition, "TrackerFactWait" | "Relinquishment" | "Settlement" | null]
  > = [
    [ResponsibilityDisposition.TaskClaimMissingConstraint(), "TrackerFactWait"],
    [ResponsibilityDisposition.TaskClaimUnreadableWait(), "TrackerFactWait"],
    [ResponsibilityDisposition.TaskForeignClaimIsolation(), "TrackerFactWait"],
    [ResponsibilityDisposition.CancelledAttemptSettled({ claimDisposition: "Released" }), "Settlement"],
    [ResponsibilityDisposition.StoppedAttemptSettled({ claimDisposition: "Released" }), "Settlement"],
    [
      ResponsibilityDisposition.PlannedAttemptExecutorWorkTerminal({
        report: PlannedAttemptExecutorReport.cases.Terminal.make({
          correlation: plannedAttemptExecutorCorrelation(integrationFinalityFixture.plannedAttempt),
          result: { _tag: "Completed" }
        })
      }),
      null
    ],
    [ResponsibilityDisposition.Relinquished({ reason: "AuthorizedHandoff" }), "Relinquishment"]
  ] as const
  for (const [disposition, expected] of executorCases) {
    const status = statusFor(
      evaluationOf({
        runtimeRunId: integrationFinalityFixture.runId,
        tasks: [{ id: String(executorTask) }],
        evidence: [
          {
            _tag: "ResponsibilityFacts",
            facts: { _tag: "PlannedAttemptExecutorFreshFacts", disposition, responsibility: executorResponsibility }
          }
        ]
      }),
      { _tag: "Task", runId: integrationFinalityFixture.runId, taskId: executorTask }
    )
    expect(status).toMatchObject({ _tag: "DeliveryStatusAvailable" })
    if (status._tag !== "DeliveryStatusAvailable") continue
    if (expected === null) expect(status.entries).toEqual([])
    else expect(status.entries).toEqual([expect.objectContaining({ _tag: expected })])
    if (expected === "Relinquishment") {
      expect(status.entries[0]).toMatchObject({
        supporting: {
          _tag: "PlannedAttempt",
          correlation: plannedAttemptExecutorCorrelation(integrationFinalityFixture.plannedAttempt)
        }
      })
    }
    if (expected === "Settlement") {
      expect(status.entries[0]).toMatchObject({
        _tag: "Settlement",
        settlement: {
          _tag: "AcceptedStandingSettlement",
          standing: { _tag: disposition._tag, claimDisposition: "Released", responsibility: executorResponsibility }
        }
      })
    }
  }
})

it("projects cancelled and stopped accepted standings as distinct public settlements", () => {
  const cases = [
    ["cancelled-status", ResponsibilityDisposition.CancelledAttemptSettled({ claimDisposition: "Released" })],
    ["stopped-status", ResponsibilityDisposition.StoppedAttemptSettled({ claimDisposition: "Released" })],
    [
      "cancelled-no-release-status",
      ResponsibilityDisposition.CancelledAttemptSettled({ claimDisposition: "NoRelease" })
    ],
    ["stopped-no-release-status", ResponsibilityDisposition.StoppedAttemptSettled({ claimDisposition: "NoRelease" })]
  ] as const
  for (const [taskIdText, disposition] of cases) {
    const taskId = TaskId.make(taskIdText)
    const plannedAttempt = { ...integrationFinalityFixture.plannedAttempt, taskId }
    const responsibility = {
      _tag: "PlannedAttemptExecutorWorkResponsibility" as const,
      beganAt: JournalPosition.make(2),
      plannedAttempt
    }
    const state = evaluationOf({
      runtimeRunId: integrationFinalityFixture.runId,
      tasks: [{ id: taskIdText }],
      evidence: [
        {
          _tag: "ResponsibilityFacts",
          facts: { _tag: "PlannedAttemptExecutorFreshFacts", disposition, responsibility }
        }
      ]
    })
    if (state._tag !== "Ready") return expect.fail("settled standing fixture must be ready")
    expect(state.evaluation.current.ticketDeliveries.deliveries[0]?.obligations).toEqual([])
    const status = statusFor(state, { _tag: "Task", runId: integrationFinalityFixture.runId, taskId })
    expect(status).toMatchObject({ _tag: "DeliveryStatusAvailable" })
    if (status._tag !== "DeliveryStatusAvailable") continue
    const settlement = status.entries.find(({ _tag }) => _tag === "Settlement")
    expect(settlement).toMatchObject({
      _tag: "Settlement",
      settlement: {
        _tag: "AcceptedStandingSettlement",
        standing: { _tag: disposition._tag, claimDisposition: disposition.claimDisposition, responsibility }
      }
    })
  }

  const mismatchTaskId = TaskId.make("settled-mismatch")
  const mismatchResponsibility = {
    _tag: "PlannedAttemptExecutorWorkResponsibility" as const,
    beganAt: JournalPosition.make(2),
    plannedAttempt: { ...integrationFinalityFixture.plannedAttempt, taskId: mismatchTaskId }
  }
  const mismatchState = evaluationOf({
    runtimeRunId: integrationFinalityFixture.runId,
    tasks: [{ id: String(mismatchTaskId) }],
    evidence: [
      {
        _tag: "ResponsibilityFacts",
        facts: {
          _tag: "PlannedAttemptExecutorFreshFacts",
          disposition: ResponsibilityDisposition.CancelledAttemptSettled({ claimDisposition: "Released" }),
          responsibility: mismatchResponsibility
        }
      }
    ]
  })
  if (mismatchState._tag !== "Ready") return expect.fail("mismatched settled fixture must be ready")
  const mismatchDelivery = mismatchState.evaluation.current.ticketDeliveries.deliveries[0]
  if (mismatchDelivery === undefined) return expect.fail("mismatched settled delivery must exist")
  const malformedResponsibility = {
    _tag: "PlannedAttemptExecutorWorkResponsibility" as const,
    beganAt: JournalPosition.make(2),
    plannedAttempt: { ...integrationFinalityFixture.plannedAttempt, taskId: TaskId.make("foreign-settled") }
  }
  const retainedObligationState = DeliveryRuntimeObservationState.Ready({
    evaluation: {
      ...mismatchState.evaluation,
      current: {
        ...mismatchState.evaluation.current,
        ticketDeliveries: {
          ...mismatchState.evaluation.current.ticketDeliveries,
          deliveries: [
            {
              ...mismatchDelivery,
              obligations: [{ _tag: "WorkflowResponsibility" as const, responsibility: mismatchResponsibility }]
            }
          ]
        }
      }
    },
    liveOwners: []
  })
  expect(
    deliveryStatusOf(
      { _tag: "Task", runId: integrationFinalityFixture.runId, taskId: mismatchTaskId },
      retainedObligationState
    )
  ).toBeInstanceOf(DeliveryStatusProjectionConflict)
  const malformedState = DeliveryRuntimeObservationState.Ready({
    evaluation: {
      ...mismatchState.evaluation,
      current: {
        ...mismatchState.evaluation.current,
        ticketDeliveries: {
          ...mismatchState.evaluation.current.ticketDeliveries,
          deliveries: [
            {
              ...mismatchDelivery,
              standings: [
                {
                  _tag: "ResponsibilitySituation" as const,
                  facts: {
                    _tag: "PlannedAttemptExecutorFreshFacts" as const,
                    disposition: ResponsibilityDisposition.CancelledAttemptSettled({ claimDisposition: "Released" }),
                    responsibility: malformedResponsibility
                  }
                }
              ]
            }
          ]
        }
      }
    },
    liveOwners: []
  })
  expect(
    deliveryStatusOf({ _tag: "Task", runId: integrationFinalityFixture.runId, taskId: mismatchTaskId }, malformedState)
  ).toBeInstanceOf(DeliveryStatusProjectionConflict)

  const foreignRunResponsibility = {
    ...mismatchResponsibility,
    plannedAttempt: { ...mismatchResponsibility.plannedAttempt, runId: RunId.make("foreign-settled-run") }
  }
  const foreignRunState = DeliveryRuntimeObservationState.Ready({
    evaluation: {
      ...mismatchState.evaluation,
      current: {
        ...mismatchState.evaluation.current,
        ticketDeliveries: {
          ...mismatchState.evaluation.current.ticketDeliveries,
          deliveries: [
            {
              ...mismatchDelivery,
              standings: [
                {
                  _tag: "ResponsibilitySituation" as const,
                  facts: {
                    _tag: "PlannedAttemptExecutorFreshFacts" as const,
                    disposition: ResponsibilityDisposition.CancelledAttemptSettled({ claimDisposition: "NoRelease" }),
                    responsibility: foreignRunResponsibility
                  }
                }
              ]
            }
          ]
        }
      }
    },
    liveOwners: []
  })
  expect(
    deliveryStatusOf({ _tag: "Task", runId: integrationFinalityFixture.runId, taskId: mismatchTaskId }, foreignRunState)
  ).toBeInstanceOf(DeliveryStatusProjectionConflict)
})

it("retains materialized operation identity through live and settled owner chronology", () => {
  const proposal = taskProposalOf("materialized-status-proposal", TaskId.make("A"))
  const operationId = OperationId.make("materialized-status-operation")
  const materialized: DeliveryRuntimeLiveOwnerSnapshot = {
    _tag: "MaterializedDeliveryAction",
    intent: "IntentRecorded",
    operationId,
    proposal
  }
  const settled: DeliveryRuntimeLiveOwnerSnapshot = {
    _tag: "SettledMaterializedDeliveryAction",
    intent: "IntentRecorded",
    operationId,
    proposal
  }
  const live = statusFor(evaluationOf({ proposals: [proposal], liveOwners: [materialized] }), { _tag: "Run", runId })
  const publicationPending = statusFor(evaluationOf({ proposals: [proposal], liveOwners: [settled] }), {
    _tag: "Run",
    runId
  })
  expect(live).toMatchObject({ entries: [{ _tag: "LiveDeliveryAction", owner: { operationId } }] })
  expect(publicationPending).toMatchObject({
    entries: [{ _tag: "AcceptedFactPublicationWait", owner: { operationId } }]
  })
})

it("fails closed for duplicate or mismatched live-owner snapshots", () => {
  const proposal = taskProposalOf("duplicate-owner-proposal", TaskId.make("A"))
  const duplicate = deliveryStatusOf(
    Schema.decodeUnknownSync(DeliveryStatusSubject)({ _tag: "Run", runId }),
    evaluationOf({ proposals: [proposal], liveOwners: [ownerOf(proposal, false), ownerOf(proposal, false)] })
  )
  expect(duplicate).toBeInstanceOf(DeliveryStatusProjectionConflict)

  const mismatched = deliveryStatusOf(
    Schema.decodeUnknownSync(DeliveryStatusSubject)({ _tag: "Run", runId }),
    evaluationOf({
      proposals: [proposal],
      liveOwners: [ownerOf({ ...proposal, waitsForLiveOperationId: OperationId.make("different") }, false)]
    })
  )
  expect(mismatched).toBeInstanceOf(DeliveryStatusProjectionConflict)

  const absent = deliveryStatusOf(
    Schema.decodeUnknownSync(DeliveryStatusSubject)({ _tag: "Run", runId }),
    evaluationOf({
      proposals: [proposal],
      liveOwners: [ownerOf(taskProposalOf("absent-owner-proposal", TaskId.make("A")), false)]
    })
  )
  expect(absent).toBeInstanceOf(DeliveryStatusProjectionConflict)

  const repeatedFrontierProposal = deliveryStatusOf(
    Schema.decodeUnknownSync(DeliveryStatusSubject)({ _tag: "Run", runId }),
    evaluationOf({
      proposedActions: { _tag: "DeliveryProposalsAvailable", isolatedIssues: [], proposals: [proposal, proposal] }
    })
  )
  expect(repeatedFrontierProposal).toBeInstanceOf(DeliveryStatusProjectionConflict)
})

it("compares live-owner proposals canonically through causal predecessor arrays", () => {
  const taskId = TaskId.make("canonical-owner-task")
  const operation = makeTaskClaimObservationOperation(OperationId.make("canonical-owner-operation"), target, taskId, [
    OperationId.make("canonical-owner-predecessor")
  ])
  const proposal = {
    ...taskProposalOf("canonical-owner-proposal", taskId),
    actionIdentity: { _tag: "ExistingOperationId" as const },
    route: {
      _tag: "AcceptedWorkflowRoute" as const,
      transition: {
        _tag: "ObservePlannedAttemptContinuationClaim" as const,
        operation,
        plannedAttempt: integrationFinalityFixture.plannedAttempt
      }
    }
  }
  const equal = deliveryStatusOf(
    Schema.decodeUnknownSync(DeliveryStatusSubject)({ _tag: "Run", runId }),
    evaluationOf({ proposals: [proposal], liveOwners: [ownerOf(proposal, false)] })
  )
  expect(equal).toMatchObject({ _tag: "DeliveryStatusAvailable", entries: [{ _tag: "LiveDeliveryAction" }] })

  const changed = {
    ...proposal,
    route: {
      ...proposal.route,
      transition: {
        ...proposal.route.transition,
        operation: makeTaskClaimObservationOperation(operation.operationId, target, taskId, [
          OperationId.make("canonical-owner-other-predecessor")
        ])
      }
    }
  }
  const mismatch = deliveryStatusOf(
    Schema.decodeUnknownSync(DeliveryStatusSubject)({ _tag: "Run", runId }),
    evaluationOf({ proposals: [proposal], liveOwners: [ownerOf(changed, false)] })
  )
  expect(mismatch).toBeInstanceOf(DeliveryStatusProjectionConflict)
})

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
      evidenceIdentities: [expect.any(String)],
      responsibility: { _tag: "WorkflowResponsibility" }
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

    const ready = evaluationOf({ tasks: [{ id: "A" }], evidence: [conflicting, conflicting] })
    if (ready._tag !== "Ready") return expect.fail("malformed conflict fixture must be ready")
    const delivery = ready.evaluation.current.ticketDeliveries.deliveries.find(({ taskId }) => taskId === taskA)
    if (delivery === undefined) return expect.fail("malformed conflict delivery must exist")
    const malformed = DeliveryRuntimeObservationState.Ready({
      evaluation: {
        ...ready.evaluation,
        current: {
          ...ready.evaluation.current,
          ticketDeliveries: {
            ...ready.evaluation.current.ticketDeliveries,
            deliveries: [{ ...delivery, standings: [{ _tag: "ExactEvidenceConflict", evidenceIdentities: [""] }] }]
          }
        }
      },
      liveOwners: []
    })
    expect(deliveryStatusOf({ _tag: "Run", runId }, malformed)).toBeInstanceOf(DeliveryStatusProjectionConflict)

    const duplicateIdentity = DeliveryRuntimeObservationState.Ready({
      evaluation: {
        ...ready.evaluation,
        current: {
          ...ready.evaluation.current,
          ticketDeliveries: {
            ...ready.evaluation.current.ticketDeliveries,
            deliveries: [
              {
                ...delivery,
                standings: [{ _tag: "ExactEvidenceConflict", evidenceIdentities: ["duplicate", "duplicate"] }]
              }
            ]
          }
        }
      },
      liveOwners: []
    })
    expect(deliveryStatusOf({ _tag: "Run", runId }, duplicateIdentity)).toBeInstanceOf(DeliveryStatusProjectionConflict)

    const separatorCollision = DeliveryRuntimeObservationState.Ready({
      evaluation: {
        ...ready.evaluation,
        current: {
          ...ready.evaluation.current,
          ticketDeliveries: {
            ...ready.evaluation.current.ticketDeliveries,
            deliveries: [
              {
                ...delivery,
                standings: [
                  { _tag: "ExactEvidenceConflict", evidenceIdentities: ["a,b", "c"] },
                  { _tag: "ExactEvidenceConflict", evidenceIdentities: ["a", "b,c"] }
                ]
              }
            ]
          }
        }
      },
      liveOwners: []
    })
    const separatorCollisionStatus = deliveryStatusOf({ _tag: "Run", runId }, separatorCollision)
    expect(separatorCollisionStatus).toMatchObject({ _tag: "DeliveryStatusAvailable" })
    if (separatorCollisionStatus._tag === "DeliveryStatusAvailable") {
      expect(separatorCollisionStatus.entries.filter(({ _tag }) => _tag === "EvidenceConflict")).toHaveLength(2)
    }
  })
)

it.effect("explains the exact integration target wait without receiving resource authority", () =>
  Effect.gen(function* () {
    yield* Effect.void
    const { fixture, queued } = integrationFactsOf()
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

it("retains every integration wait family with its typed supporting responsibility", () => {
  const { accepted, fixture, started } = integrationFactsOf()
  const cases = [
    {
      evidence: [
        { _tag: "StartedIntegration" as const, responsibility: started },
        {
          _tag: "IntegrationWait" as const,
          wait: {
            _tag: "IntegrationDependencyWait" as const,
            plannedAttempt: fixture.plannedAttempt,
            prerequisiteTaskIds: [TaskId.make("prerequisite")]
          }
        }
      ],
      expected: "DependencyWait"
    },
    {
      evidence: [
        { _tag: "AcceptedAwaitingIntegration" as const, accepted },
        {
          _tag: "IntegrationWait" as const,
          wait: { _tag: "IntegrationConfigurationWait" as const, plannedAttempt: fixture.plannedAttempt }
        }
      ],
      expected: "EvidenceUnavailable"
    },
    {
      evidence: [
        { _tag: "StartedIntegration" as const, responsibility: started },
        {
          _tag: "IntegrationWait" as const,
          wait: { _tag: "TargetPromotionConfigurationWait" as const, plannedAttempt: fixture.plannedAttempt }
        }
      ],
      expected: "EvidenceUnavailable"
    },
    {
      evidence: [
        { _tag: "StartedIntegration" as const, responsibility: started },
        {
          _tag: "IntegrationWait" as const,
          wait: {
            _tag: "IntegrationTaskClaimConstraint" as const,
            claimState: "Foreign" as const,
            plannedAttempt: fixture.plannedAttempt
          }
        }
      ],
      expected: "TrackerFactWait"
    }
  ] as const
  for (const testCase of cases) {
    const status = statusFor(
      evaluationOf({
        runtimeRunId: fixture.runId,
        tasks: [{ id: String(fixture.taskId) }],
        evidence: testCase.evidence
      }),
      { _tag: "Task", runId: fixture.runId, taskId: fixture.taskId }
    )
    expect(status).toMatchObject({
      _tag: "DeliveryStatusAvailable",
      entries: [expect.objectContaining({ _tag: testCase.expected })]
    })
    if (status._tag !== "DeliveryStatusAvailable") continue
    const entry = status.entries.find(({ _tag }) => _tag === testCase.expected)
    expect(entry).toBeDefined()
    if (testCase.expected === "DependencyWait") {
      expect(entry).toMatchObject({
        prerequisiteTaskIds: [TaskId.make("prerequisite")],
        standing: { _tag: "IntegrationWait", wait: { _tag: "IntegrationDependencyWait" } }
      })
    } else if (testCase.expected === "EvidenceUnavailable") {
      expect(entry).toMatchObject({ evidence: { _tag: expect.stringMatching(/ConfigurationWait/) } })
    } else {
      expect(entry).toMatchObject({
        fact: { _tag: "Foreign", boundary: "TaskTracker" },
        wakeCondition: "ExplicitAppliedTaskClaimReacquisitionDirection"
      })
    }
  }
})

it("fails closed when any integration wait names another delivery task", () => {
  const { fixture, started } = integrationFactsOf()
  const otherTaskId = TaskId.make("other-integration-task")
  const crossTaskAttempt = { ...fixture.plannedAttempt, taskId: otherTaskId }
  const waits: ReadonlyArray<Extract<TicketDeliveryEvidence, { readonly _tag: "IntegrationWait" }>["wait"]> = [
    { _tag: "IntegrationConfigurationWait", plannedAttempt: crossTaskAttempt },
    { _tag: "TargetPromotionConfigurationWait", plannedAttempt: crossTaskAttempt },
    { _tag: "IntegrationTrackerFactsWait", plannedAttempt: crossTaskAttempt },
    { _tag: "IntegrationTaskClaimConstraint", claimState: "Missing", plannedAttempt: crossTaskAttempt },
    { _tag: "IntegrationTargetWait", plannedAttempt: crossTaskAttempt }
  ]
  const state = evaluationOf({
    runtimeRunId: fixture.runId,
    tasks: [{ id: String(fixture.taskId) }],
    evidence: [{ _tag: "StartedIntegration", responsibility: started }]
  })
  if (state._tag !== "Ready") return expect.fail("cross-task integration fixture must be ready")
  const delivery = state.evaluation.current.ticketDeliveries.deliveries.find(({ taskId }) => taskId === fixture.taskId)
  if (delivery === undefined) return expect.fail("cross-task integration delivery must exist")
  for (const wait of waits) {
    const malformed = DeliveryRuntimeObservationState.Ready({
      evaluation: {
        ...state.evaluation,
        current: {
          ...state.evaluation.current,
          ticketDeliveries: {
            ...state.evaluation.current.ticketDeliveries,
            deliveries: [{ ...delivery, standings: [{ _tag: "IntegrationWait", wait }] }]
          }
        }
      },
      liveOwners: []
    })
    expect(deliveryStatusOf({ _tag: "Task", runId: fixture.runId, taskId: fixture.taskId }, malformed)).toBeInstanceOf(
      DeliveryStatusProjectionConflict
    )
  }
})

it("maps every integration tracker fact state to its exact passive wake condition", () => {
  const { fixture, started } = integrationFactsOf()
  const cases = [
    {
      wait: { _tag: "IntegrationTrackerFactsWait" as const, plannedAttempt: fixture.plannedAttempt },
      fact: "Unobserved" as const,
      wakeCondition: "TaskTrackerFactsObserved" as const
    },
    {
      wait: {
        _tag: "IntegrationTaskClaimConstraint" as const,
        claimState: "Missing" as const,
        plannedAttempt: fixture.plannedAttempt
      },
      fact: "Missing" as const,
      wakeCondition: "ExplicitAppliedTaskClaimReacquisitionDirection" as const
    },
    {
      wait: {
        _tag: "IntegrationTaskClaimConstraint" as const,
        claimState: "Unreadable" as const,
        plannedAttempt: fixture.plannedAttempt
      },
      fact: "Unreadable" as const,
      wakeCondition: "TaskClaimFactsObserved" as const
    },
    {
      wait: {
        _tag: "IntegrationTaskClaimConstraint" as const,
        claimState: "Unobserved" as const,
        plannedAttempt: fixture.plannedAttempt
      },
      fact: "Unobserved" as const,
      wakeCondition: "TaskClaimFactsObserved" as const
    }
  ] as const
  for (const testCase of cases) {
    const status = statusFor(
      evaluationOf({
        runtimeRunId: fixture.runId,
        tasks: [{ id: String(fixture.taskId) }],
        evidence: [
          { _tag: "StartedIntegration", responsibility: started },
          { _tag: "IntegrationWait", wait: testCase.wait }
        ]
      }),
      { _tag: "Task", runId: fixture.runId, taskId: fixture.taskId }
    )
    expect(status).toMatchObject({
      _tag: "DeliveryStatusAvailable",
      entries: [
        expect.objectContaining({
          _tag: "TrackerFactWait",
          fact: { _tag: testCase.fact, boundary: "TaskTracker" },
          wakeCondition: testCase.wakeCondition
        })
      ]
    })
  }
})

it("fails closed for every integration wait without its exact supporting responsibility", () => {
  const fixture = integrationFinalityFixture
  const waits = [
    {
      _tag: "IntegrationDependencyWait" as const,
      plannedAttempt: fixture.plannedAttempt,
      prerequisiteTaskIds: [TaskId.make("prerequisite")]
    },
    { _tag: "IntegrationConfigurationWait" as const, plannedAttempt: fixture.plannedAttempt },
    {
      _tag: "IntegrationTaskClaimConstraint" as const,
      claimState: "Foreign" as const,
      plannedAttempt: fixture.plannedAttempt
    },
    { _tag: "IntegrationTrackerFactsWait" as const, plannedAttempt: fixture.plannedAttempt },
    { _tag: "IntegrationTargetWait" as const, plannedAttempt: fixture.plannedAttempt },
    { _tag: "TargetPromotionConfigurationWait" as const, plannedAttempt: fixture.plannedAttempt }
  ]
  for (const wait of waits) {
    const result = deliveryStatusOf(
      Schema.decodeUnknownSync(DeliveryStatusSubject)({ _tag: "Task", runId: fixture.runId, taskId: fixture.taskId }),
      evaluationOf({
        runtimeRunId: fixture.runId,
        tasks: [{ id: String(fixture.taskId) }],
        evidence: [{ _tag: "IntegrationWait", wait }]
      })
    )
    expect(result).toBeInstanceOf(DeliveryStatusProjectionConflict)
  }

  const emptyDependency = deliveryStatusOf(
    Schema.decodeUnknownSync(DeliveryStatusSubject)({ _tag: "Task", runId: fixture.runId, taskId: fixture.taskId }),
    evaluationOf({
      runtimeRunId: fixture.runId,
      tasks: [{ id: String(fixture.taskId) }],
      evidence: [
        {
          _tag: "IntegrationWait",
          wait: { _tag: "IntegrationDependencyWait", plannedAttempt: fixture.plannedAttempt, prerequisiteTaskIds: [] }
        }
      ]
    })
  )
  expect(emptyDependency).toBeInstanceOf(DeliveryStatusProjectionConflict)

  const validDependencyState = evaluationOf({
    runtimeRunId: fixture.runId,
    tasks: [{ id: String(fixture.taskId) }],
    evidence: [
      {
        _tag: "IntegrationWait",
        wait: {
          _tag: "IntegrationDependencyWait",
          plannedAttempt: fixture.plannedAttempt,
          prerequisiteTaskIds: [TaskId.make("prerequisite")]
        }
      }
    ]
  })
  if (validDependencyState._tag !== "Ready") return expect.fail("dependency mismatch fixture must be ready")
  const dependencyDelivery = validDependencyState.evaluation.current.ticketDeliveries.deliveries.find(
    ({ taskId }) => taskId === fixture.taskId
  )
  if (dependencyDelivery === undefined) return expect.fail("dependency mismatch delivery must exist")
  const mismatchedTaskDependency = deliveryStatusOf(
    Schema.decodeUnknownSync(DeliveryStatusSubject)({ _tag: "Task", runId: fixture.runId, taskId: fixture.taskId }),
    DeliveryRuntimeObservationState.Ready({
      evaluation: {
        ...validDependencyState.evaluation,
        current: {
          ...validDependencyState.evaluation.current,
          ticketDeliveries: {
            ...validDependencyState.evaluation.current.ticketDeliveries,
            deliveries: [
              {
                ...dependencyDelivery,
                standings: [
                  {
                    _tag: "IntegrationWait",
                    wait: {
                      _tag: "IntegrationDependencyWait",
                      plannedAttempt: { ...fixture.plannedAttempt, taskId: TaskId.make("different-task") },
                      prerequisiteTaskIds: [TaskId.make("prerequisite")]
                    }
                  }
                ]
              }
            ]
          }
        }
      },
      liveOwners: []
    })
  )
  expect(mismatchedTaskDependency).toBeInstanceOf(DeliveryStatusProjectionConflict)
})

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
    const closedBeforeReady = DeliveryRuntimeObservationState.Closed({ final: null })
    expect(statusFor(closedBeforeReady, { _tag: "Run", runId })).toEqual({
      _tag: "DeliveryStatusClosed",
      subject: { _tag: "Run", runId },
      final: null
    })

    const signal = yield* deliveryStatusSignalOf(currentSignalOf(ready), { _tag: "Run", runId })
    expect(yield* signal.get).toMatchObject({ _tag: "DeliveryStatusAvailable" })
  })
)

it("keeps an unestablished tracker graph as an explicit passive fact", () => {
  const status = statusFor(evaluationOf({ established: false }), { _tag: "Run", runId })
  expect(status).toMatchObject({
    _tag: "DeliveryStatusAvailable",
    entries: [
      {
        _tag: "TrackerFactWait",
        responsibility: null,
        fact: { _tag: "Unobserved", boundary: "TaskTracker" },
        wakeCondition: "TaskTrackerFactsObserved",
        standing: { _tag: "GraphNotEstablished" }
      }
    ]
  })
})

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

it("orders numeric proposal ordinals numerically before proposal identity", () => {
  const taskA = TaskId.make("A")
  const ordinalTen = {
    ...taskProposalOf("status-ordinal-ten", taskA),
    order: { ...taskProposalOf("status-ordinal-ten", taskA).order, frontierOrdinal: DeliveryProposalOrdinal.make(10) }
  }
  const ordinalTwo = {
    ...taskProposalOf("status-ordinal-two", taskA),
    order: { ...taskProposalOf("status-ordinal-two", taskA).order, frontierOrdinal: DeliveryProposalOrdinal.make(2) }
  }
  const state = evaluationOf({ tasks: [{ id: "A" }], proposals: [ordinalTen, ordinalTwo] })
  const status = statusFor(state, { _tag: "Run", runId })
  expect(status).toMatchObject({ _tag: "DeliveryStatusAvailable" })
  if (status._tag !== "DeliveryStatusAvailable") return
  const proposals = status.entries.filter(
    (entry): entry is Extract<DeliveryStatusEntry, { readonly _tag: "ProposedDeliveryAction" }> =>
      entry._tag === "ProposedDeliveryAction"
  )
  expect(proposals.map(({ proposal }) => proposal.id)).toEqual([ordinalTwo.id, ordinalTen.id])
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

it.effect("calls no instrumented authority or mutation boundary while status changes and reconnects", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<ReadonlyArray<string>>([])
    const forbidden = <ServiceShape>(boundary: string): ServiceShape =>
      new Proxy(
        {},
        {
          get:
            (_target, property) =>
            (..._args: ReadonlyArray<unknown>) =>
              Ref.update(calls, (current) => [...current, `${boundary}.${String(property)}`]).pipe(
                Effect.flatMap(() => Effect.die(`forbidden status boundary called: ${boundary}.${String(property)}`))
              )
        }
      ) as ServiceShape
    const forbiddenContext = Context.empty()
      .pipe(
        Context.add(JournalStore, forbidden<typeof JournalStore.Service>("JournalStore")),
        Context.add(RunLifecycleJournal, forbidden<typeof RunLifecycleJournal.Service>("RunLifecycleJournal")),
        Context.add(TrackerGraphReader, forbidden<typeof TrackerGraphReader.Service>("TrackerGraphReader")),
        Context.add(TrackerMutation, forbidden<typeof TrackerMutation.Service>("TrackerMutation")),
        Context.add(GitCommand, forbidden<typeof GitCommand.Service>("GitCommand")),
        Context.add(GitTargetLineage, forbidden<typeof GitTargetLineage.Service>("GitTargetLineage")),
        Context.add(GitWorktree, forbidden<typeof GitWorktree.Service>("GitWorktree")),
        Context.add(CoordinatorOwnership, forbidden<typeof CoordinatorOwnership.Service>("CoordinatorOwnership")),
        Context.add(
          DeliveryRuntimeResources,
          forbidden<typeof DeliveryRuntimeResources.Service>("DeliveryRuntimeResources")
        ),
        Context.add(
          DeliveryRuntimeResourceCapabilityPair,
          forbidden<typeof DeliveryRuntimeResourceCapabilityPair.Service>("DeliveryRuntimeResourceCapabilityPair")
        ),
        Context.add(
          DeliveryRuntimeObservationPublication,
          forbidden<typeof DeliveryRuntimeObservationPublication.Service>("DeliveryRuntimeObservationPublication")
        ),
        Context.add(DeliveryActionExecutor, forbidden<typeof DeliveryActionExecutor.Service>("DeliveryActionExecutor")),
        Context.add(
          DeliveryAcceptedFactPublication,
          forbidden<typeof DeliveryAcceptedFactPublication.Service>("DeliveryAcceptedFactPublication")
        ),
        Context.add(Journal, forbidden<typeof Journal.Service>("Journal")),
        Context.add(
          ApplicationExitAdmission,
          forbidden<typeof ApplicationExitAdmission.Service>("ApplicationExitAdmission")
        ),
        Context.add(CompletionTaskBoundary, forbidden<typeof CompletionTaskBoundary.Service>("CompletionTaskBoundary")),
        Context.add(Integrator, forbidden<typeof Integrator.Service>("Integrator")),
        Context.add(IntegratorGit, forbidden<typeof IntegratorGit.Service>("IntegratorGit")),
        Context.add(
          PlannedAttemptProtocolController,
          forbidden<typeof PlannedAttemptProtocolController.Service>("PlannedAttemptProtocolController")
        ),
        Context.add(
          TaskWorkCapacityControl,
          forbidden<typeof TaskWorkCapacityControl.Service>("TaskWorkCapacityControl")
        )
      )
      .pipe(
        Context.add(
          ControlDirectionApplication,
          forbidden<typeof ControlDirectionApplication.Service>("ControlDirectionApplication")
        ),
        Context.add(
          TaskClaimReacquisitionControl,
          forbidden<typeof TaskClaimReacquisitionControl.Service>("TaskClaimReacquisitionControl")
        ),
        Context.add(AttemptChoiceControl, forbidden<typeof AttemptChoiceControl.Service>("AttemptChoiceControl")),
        Context.add(
          IntegrationQuarantineDirectionControl,
          forbidden<typeof IntegrationQuarantineDirectionControl.Service>("IntegrationQuarantineDirectionControl")
        )
      )
    const before = evaluationOf({ tasks: [{ id: "A" }] })
    const after = evaluationOf({
      tasks: [{ id: "A" }],
      proposals: [taskProposalOf("instrumented-after", TaskId.make("A"))]
    })
    const source = currentSignalFromCurrentFirstStream(Stream.fromIterable([before, after]))
    const signal = yield* deliveryStatusSignalOf(source, { _tag: "Run", runId }).pipe(Effect.provide(forbiddenContext))
    yield* signal.get
    yield* signal.changes.pipe(Stream.take(2), Stream.runCollect)
    expect(yield* Ref.get(calls)).toEqual([])
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
