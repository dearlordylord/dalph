import { acceptedResultFixture } from "../../../test/support/evidence.js"
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
  WorktreeLocator,
  makeTaskWorkSpecification
} from "@dalph/contracts"
import { Effect } from "effect"
import { describe, expect } from "vitest"
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import { TaskClaimAcquisition } from "../../authorities/task-tracker/claim-mutation.js"
import { TaskLifecycle, type Task } from "../../authorities/task-tracker/task.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { OperationId } from "../../workflow/identity.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import {
  makeTaskClaimObservationOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTaskWorktreeObservationOperation,
  makeTargetLineageObservationOperation,
  makeTrackerGraphObservationOperation
} from "../../workflow/registry/operation.js"
import { StartedIntegrationResponsibility } from "../../workflow/protocols/integration-admission/protocol.js"
import { PlannedAttemptExecutorReportOrdinal } from "../../workflow/protocols/planned-attempt-executor-work/events.js"
import { OperationIdAllocator, PlannedTaskAttemptPlanner } from "../../workflow/protocols/task-attempt-planning/plan.js"
import { RunnableFrontierTransition } from "../frontier/frontier.js"
import { WorkflowResponsibilityEntry } from "../reconstruction/state.js"
import { FreshWorkflowStep } from "./fresh-workflow-step.js"
import { deliveryProposalsOf } from "./delivery-proposal.js"
import { deliveryProposalFrontierOf } from "./relations.js"
import { materializeDeliveryAction } from "./delivery-action-materialization.js"

const runId = RunId.make("proposal-run")
const taskId = TaskId.make("A")
const task: Task = { id: taskId, lifecycle: TaskLifecycle.cases.Open.make({}), parentTaskId: null, prerequisiteIds: [] }
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("attempt-A"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/A"),
  executor: TaskExecutorLocator.make("executor:fake"),
  runId,
  taskId,
  taskRevision: TaskRevision.make("revision-A"),
  worktree: WorktreeLocator.make("/worktrees/A")
})

describe("deliveryProposalsOf", () => {
  it("gives distinct accepted executor lifecycle reports distinct observation proposals", () => {
    const proposalAt = (ordinal: number) => {
      const transition = RunnableFrontierTransition.ObservePlannedAttemptExecutorWork({
        acceptedProgress: {
          _tag: "ExecutorReportAccepted",
          ordinal: PlannedAttemptExecutorReportOrdinal.make(ordinal)
        },
        plannedAttempt
      })
      return deliveryProposalsOf({ acceptedOperationIds: new Set(), fresh: [], runId, transitions: [transition] })
        .ticketDelivery[0]
    }

    const afterExecuting = proposalAt(1)
    const afterTerminal = proposalAt(2)

    expect(afterExecuting?.id).not.toBe(afterTerminal?.id)
    expect(afterExecuting?.route).toMatchObject({ transition: { acceptedProgress: { ordinal: 1 } } })
    expect(afterTerminal?.route).toMatchObject({ transition: { acceptedProgress: { ordinal: 2 } } })
  })

  it("derives one stable fresh claim proposal without allocating its operation identity", () => {
    const step = FreshWorkflowStep.AcquireTaskClaim({
      predecessorOperationId: OperationId.make("journaled-graph-read"),
      task
    })
    const transition = RunnableFrontierTransition.CommitFreshTaskClaimIntent({
      taskId,
      taskRevision: TaskRevision.make("revision-A")
    })
    const input = {
      acceptedOperationIds: new Set<OperationId>(),
      fresh: [{ step, transition }],
      runId,
      transitions: [transition]
    }

    const first = deliveryProposalsOf(input)
    const second = deliveryProposalsOf(input)

    expect(second).toEqual(first)
    expect(first.ticketDelivery).toHaveLength(1)
    expect(first.deliverySettlement).toEqual([])
    expect(first.ticketDelivery[0]).toMatchObject({
      actionIdentity: { _tag: "FreshOperationIdRequired" },
      admission: {
        integrationTarget: { _tag: "NoIntegrationTargetResource" },
        taskWorkPosition: { _tag: "TaskWorkPositionRequired", mode: "ReserveOrReuse", taskId }
      },
      owner: "TicketDelivery",
      route: { _tag: "FreshWorkflowRoute", step }
    })
  })

  it("keeps the hidden fresh plan step and declares both identities for post-admission allocation", () => {
    const predecessorOperationId = OperationId.make("accepted-specification-read")
    const step = FreshWorkflowStep.RecordTaskAttemptPlan({
      predecessorOperationId,
      specification: makeTaskWorkSpecification({ body: "Implement A", taskId, title: "A" }),
      task
    })
    const transition = RunnableFrontierTransition.ContinueFreshWorkflowOperation({
      operationId: predecessorOperationId,
      taskId
    })

    const [proposal] = deliveryProposalsOf({
      acceptedOperationIds: new Set([predecessorOperationId]),
      fresh: [{ step, transition }],
      runId,
      transitions: [transition]
    }).ticketDelivery

    expect(proposal).toMatchObject({
      actionIdentity: { _tag: "FreshOperationAndAttemptIdsRequired" },
      route: { _tag: "FreshWorkflowRoute", step: { _tag: "RecordTaskAttemptPlan" } }
    })
  })

  it("reuses the exact accepted operation identity for responsibility reconciliation", () => {
    const operationId = OperationId.make("accepted-claim-operation")
    const transition = RunnableFrontierTransition.ReconcileTaskClaim({ operationId, taskId })

    const [proposal] = deliveryProposalsOf({
      acceptedOperationIds: new Set([operationId]),
      fresh: [],
      runId,
      transitions: [transition]
    }).ticketDelivery

    expect(proposal).toMatchObject({
      actionIdentity: { _tag: "ExistingOperationId" },
      admission: {
        integrationTarget: { _tag: "NoIntegrationTargetResource" },
        taskWorkPosition: { _tag: "NoTaskWorkPosition" }
      },
      route: { _tag: "AcceptedWorkflowRoute", transition }
    })
  })

  it.effect("allocates for a historical graph read whose prefix only looks active", () =>
    Effect.gen(function* () {
      const operationId = OperationId.make("active-refresh:proposal-run:after:17:graph")
      const operation = makeTrackerGraphObservationOperation(
        { _tag: "WorkflowEstablishment" },
        operationId,
        FixtureTarget.make("proposal-target"),
        [],
        [taskId]
      )
      const transition = RunnableFrontierTransition.ObservePlannedAttemptContinuationGraph({
        operation,
        plannedAttempt
      })

      const [proposal] = deliveryProposalsOf({
        acceptedOperationIds: new Set(),
        fresh: [],
        responsibilities: [
          { _tag: "PlannedAttemptExecutorWorkResponsibility", beganAt: JournalPosition.make(2), plannedAttempt }
        ],
        runId,
        transitions: [transition]
      }).ticketDelivery

      expect(proposal?.actionIdentity).toEqual({ _tag: "FreshOperationIdRequired", source: { _tag: "Allocate" } })
      if (proposal === undefined) return
      const materialized = yield* materializeDeliveryAction(proposal).pipe(
        Effect.provideService(
          OperationIdAllocator,
          OperationIdAllocator.of({ allocate: () => Effect.succeed(OperationId.make("historical-g1-fresh")) })
        ),
        Effect.provideService(
          PlannedTaskAttemptPlanner,
          PlannedTaskAttemptPlanner.of({ plan: () => Effect.die("historical graph materialization must not plan") })
        )
      )
      expect(materialized).toMatchObject({
        _tag: "FreshOperationAction",
        operationId: OperationId.make("historical-g1-fresh")
      })
    })
  )

  it.effect("preserves each pending ordinary-read identity through proposal materialization", () =>
    Effect.gen(function* () {
      const graphOperation = makeTrackerGraphObservationOperation(
        { _tag: "AttemptContinuation" },
        OperationId.make("pending-graph-read"),
        FixtureTarget.make("proposal-target"),
        [],
        [taskId]
      )
      const specificationOperation = makeTaskWorkSpecificationObservationOperation(
        OperationId.make("pending-specification-read"),
        FixtureTarget.make("proposal-target"),
        taskId
      )
      const claimOperation = makeTaskClaimObservationOperation(
        OperationId.make("pending-claim-read"),
        FixtureTarget.make("proposal-target"),
        taskId
      )
      const worktreeOperation = makeTaskWorktreeObservationOperation({
        operationId: OperationId.make("pending-worktree-read"),
        plannedAttempt,
        predecessorOperationIds: [claimOperation.operationId]
      })
      const lineageOperation = makeTargetLineageObservationOperation({
        integrationTarget: IntegrationTarget.make({
          ref: IntegrationTargetRef.make("refs/heads/main"),
          repository: GitRepositoryLocator.make("/repositories/pending-ordinary-read.git")
        }),
        operationId: OperationId.make("pending-lineage-read"),
        plannedAttempt,
        predecessorOperationIds: [worktreeOperation.operationId]
      })
      const cases = [
        {
          operation: graphOperation,
          transition: RunnableFrontierTransition.ObservePlannedAttemptContinuationGraph({
            operation: graphOperation,
            plannedAttempt
          })
        },
        {
          operation: specificationOperation,
          transition: RunnableFrontierTransition.ObservePlannedAttemptContinuationSpecification({
            operation: specificationOperation,
            plannedAttempt
          })
        },
        {
          operation: claimOperation,
          transition: RunnableFrontierTransition.ObservePlannedAttemptContinuationClaim({
            operation: claimOperation,
            plannedAttempt
          })
        },
        {
          operation: worktreeOperation,
          transition: RunnableFrontierTransition.ObservePlannedAttemptContinuationWorktree({
            operation: worktreeOperation,
            plannedAttempt
          })
        },
        {
          operation: lineageOperation,
          transition: RunnableFrontierTransition.ObservePlannedAttemptContinuationTargetLineage({
            operation: lineageOperation,
            plannedAttempt
          })
        }
      ] as const

      for (const candidate of cases) {
        const [proposal] = deliveryProposalsOf({
          acceptedOperationIds: new Set(),
          fresh: [],
          pendingReadOperationIds: new Set([candidate.operation.operationId]),
          runId,
          transitions: [candidate.transition]
        }).ticketDelivery
        if (proposal === undefined) return yield* Effect.die("pending read must produce one proposal")

        const materialized = yield* materializeDeliveryAction(proposal).pipe(
          Effect.provideService(
            OperationIdAllocator,
            OperationIdAllocator.of({ allocate: () => Effect.die("pending read must not allocate a new identity") })
          ),
          Effect.provideService(
            PlannedTaskAttemptPlanner,
            PlannedTaskAttemptPlanner.of({ plan: () => Effect.die("pending read must not plan an attempt") })
          )
        )
        expect(materialized).toMatchObject({
          _tag: "FreshOperationAction",
          operationId: candidate.operation.operationId
        })
      }
    })
  )

  it("orders operation reconciliation from the matching accepted responsibility", () => {
    const operationId = OperationId.make("accepted-claim-operation-with-responsibility")
    const beganAt = JournalPosition.make(9)
    const transition = RunnableFrontierTransition.ReconcileTaskClaim({ operationId, taskId })

    const [proposal] = deliveryProposalsOf({
      acceptedOperationIds: new Set([operationId]),
      fresh: [],
      responsibilities: [
        WorkflowResponsibilityEntry.cases.TaskClaimResponsibility.make({
          acquisition: TaskClaimAcquisition.make({
            operationId,
            owner: ClaimOwner.make("dalph"),
            taskId,
            token: ClaimToken.make("proposal-claim-token")
          }),
          beganAt,
          taskId
        })
      ],
      runId,
      transitions: [transition]
    }).ticketDelivery

    expect(proposal?.order).toMatchObject({ _tag: "RecoveredWorkflowOrder", responsibilityBeganAt: beganAt })
  })

  it("authorizes nothing when a fresh transition lost its immutable route provenance", () => {
    const transition = RunnableFrontierTransition.CommitFreshTaskClaimIntent({
      taskId,
      taskRevision: TaskRevision.make("revision-A")
    })

    const result = deliveryProposalsOf({ acceptedOperationIds: new Set(), fresh: [], runId, transitions: [transition] })

    expect(result.ticketDelivery).toEqual([])
    expect(result.deliverySettlement).toEqual([])
    expect(result.issues).toEqual([
      { _tag: "FreshRouteProvenanceMissing", taskId, transition: "CommitFreshTaskClaimIntent" }
    ])
  })

  it("distinguishes a new recovered lineage read and carries its already-held exact integration target", () => {
    const integrationTarget = IntegrationTarget.make({
      repository: GitRepositoryLocator.make("/repo/.git"),
      ref: IntegrationTargetRef.make("refs/heads/main")
    })
    const responsibility = StartedIntegrationResponsibility.make({
      acceptedResult: acceptedResultFixture(GitCommitSha.make("2".repeat(40))),
      integrationTarget,
      plannedAttempt,
      queuedAt: JournalPosition.make(5),
      startedAt: JournalPosition.make(6)
    })
    const operation = makeTargetLineageObservationOperation({
      integrationTarget,
      operationId: OperationId.make("projection-placeholder-must-not-be-carried"),
      plannedAttempt,
      predecessorOperationIds: []
    })
    const transition = RunnableFrontierTransition.ObservePlannedAttemptContinuationTargetLineage({
      operation,
      plannedAttempt
    })

    const [proposal] = deliveryProposalsOf({
      acceptedOperationIds: new Set(),
      fresh: [],
      integrationResponsibilities: [responsibility],
      runId,
      transitions: [transition]
    }).deliverySettlement

    expect(proposal).toMatchObject({
      actionIdentity: { _tag: "FreshOperationIdRequired" },
      admission: {
        integrationTarget: {
          _tag: "IntegrationTargetResourceRequired",
          access: "UseHeld",
          integrationTarget,
          queuedAt: JournalPosition.make(5)
        }
      },
      owner: "DeliverySettlement",
      order: { _tag: "IntegrationOrder", queuedAt: JournalPosition.make(5), startedAt: JournalPosition.make(6) },
      route: {
        _tag: "RecoveredNewActionRoute",
        action: { _tag: "ReadTargetLineage", operation: { integrationTarget } }
      }
    })
    expect(JSON.stringify(proposal)).not.toContain("projection-placeholder-must-not-be-carried")
  })

  it("isolates A's missing route evidence while independent B remains actionable", () => {
    const brokenA = RunnableFrontierTransition.CommitFreshTaskClaimIntent({
      taskId,
      taskRevision: TaskRevision.make("revision-A")
    })
    const taskB = TaskId.make("B")
    const stepB = FreshWorkflowStep.AcquireTaskClaim({
      predecessorOperationId: OperationId.make("journaled-graph-read"),
      task: { id: taskB, lifecycle: TaskLifecycle.cases.Open.make({}), parentTaskId: null, prerequisiteIds: [] }
    })
    const readyB = RunnableFrontierTransition.CommitFreshTaskClaimIntent({
      taskId: taskB,
      taskRevision: TaskRevision.make("revision-B")
    })
    const contributions = deliveryProposalsOf({
      acceptedOperationIds: new Set(),
      fresh: [{ step: stepB, transition: readyB }],
      runId,
      transitions: [brokenA, readyB]
    })

    const frontier = deliveryProposalFrontierOf(
      [contributions.ticketDelivery, contributions.deliverySettlement],
      contributions.issues
    )

    expect(frontier).toMatchObject({
      _tag: "DeliveryProposalsAvailable",
      isolatedIssues: [{ _tag: "FreshRouteProvenanceMissing", taskId, transition: brokenA._tag }],
      proposals: [{ owner: "TicketDelivery", route: { _tag: "FreshWorkflowRoute", step: { task: { id: taskB } } } }]
    })
  })

  it("preserves existing A ahead of fresh C without consulting live positions", () => {
    const taskC = TaskId.make("C")
    const continueA = RunnableFrontierTransition.ObservePlannedAttemptExecutorWork({
      acceptedProgress: { _tag: "ExecutorResponsibilityBegan", acceptedAt: JournalPosition.make(2) },
      plannedAttempt
    })
    const claimC = RunnableFrontierTransition.CommitFreshTaskClaimIntent({
      taskId: taskC,
      taskRevision: TaskRevision.make("revision-C")
    })
    const claimStepC = FreshWorkflowStep.AcquireTaskClaim({
      predecessorOperationId: OperationId.make("journaled-graph-read"),
      task: { id: taskC, lifecycle: TaskLifecycle.cases.Open.make({}), parentTaskId: null, prerequisiteIds: [] }
    })
    const contributions = deliveryProposalsOf({
      acceptedOperationIds: new Set(),
      fresh: [{ step: claimStepC, transition: claimC }],
      responsibilities: [
        { _tag: "PlannedAttemptExecutorWorkResponsibility", beganAt: JournalPosition.make(2), plannedAttempt }
      ],
      runId,
      transitions: [continueA, claimC]
    })

    const frontier = deliveryProposalFrontierOf(
      [contributions.ticketDelivery, contributions.deliverySettlement],
      contributions.issues
    )

    expect(frontier).toMatchObject({
      _tag: "DeliveryProposalsAvailable",
      isolatedIssues: [],
      proposals: [
        {
          order: { _tag: "RecoveredWorkflowOrder", responsibilityBeganAt: JournalPosition.make(2) },
          route: { _tag: "IdentityFreeWorkflowRoute", transition: continueA }
        },
        {
          order: { _tag: "FreshWorkflowOrder", taskId: taskC },
          route: { _tag: "FreshWorkflowRoute", step: claimStepC }
        }
      ]
    })
  })
})
