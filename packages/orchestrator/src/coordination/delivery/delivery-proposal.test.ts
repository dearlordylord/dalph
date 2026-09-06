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
import { Effect, Result } from "effect"
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
import {
  authorizeFreshContinuationProposal,
  deliveryProposalsOf,
  freshContinuationCommitmentRequirementOf,
  freshContinuationDecisionsOf,
  freshContinuationDecisionOf,
  trackerGraphReadProposalOf,
  type FreshContinuationDecision
} from "./delivery-proposal.js"
import { deliveryProposalFrontierOf } from "./relations.js"
import { materializeDeliveryAction } from "./delivery-action-materialization.js"
import { makeFreshTaskCommitmentForTest } from "../../../test/support/fresh-task-admission.js"

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

  it("rejects an unaccepted fresh claim entry from ordinary proposal derivation", () => {
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
      // Deliberately bypass the opaque continuation boundary to prove that
      // ordinary derivation remains fail-closed for a fresh entry.
      // oxlint-disable-next-line dalph/no-double-type-assertion -- Adversarial runtime input proves a cast cannot mint the private continuation capability.
      fresh: [{ step, transition }] as unknown as ReadonlyArray<FreshContinuationDecision>,
      runId,
      transitions: [transition]
    }

    const first = deliveryProposalsOf(input)
    const second = deliveryProposalsOf(input)

    expect(second).toEqual(first)
    expect(freshContinuationDecisionOf({ step, transition }, [])).toBeUndefined()
    expect(first.ticketDelivery).toEqual([])
    expect(first.deliverySettlement).toEqual([])
    expect(first.issues).toEqual([{ _tag: "FreshRouteProvenanceMissing", taskId, transition: transition._tag }])
  })

  it("keeps the hidden fresh plan step and declares both identities for post-admission allocation", () => {
    const predecessorOperationId = OperationId.make("accepted-specification-read")
    const claimOperationId = OperationId.make("accepted-plan-claim")
    const step = FreshWorkflowStep.RecordTaskAttemptPlan({
      claimOperationId,
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
      fresh: Result.getOrThrow(
        freshContinuationDecisionsOf(
          [{ step, transition }],
          [makeFreshTaskCommitmentForTest(taskId, claimOperationId, runId)]
        )
      ),
      runId,
      transitions: [transition]
    }).ticketDelivery

    expect(proposal).toMatchObject({
      actionIdentity: { _tag: "FreshOperationAndAttemptIdsRequired" },
      route: { _tag: "FreshWorkflowRoute", step: { _tag: "RecordTaskAttemptPlan" } }
    })
    if (proposal === undefined) return expect.fail("the accepted plan continuation must produce one proposal")
    expect(freshContinuationCommitmentRequirementOf({ ...proposal })).toEqual({
      _tag: "FreshContinuationCommitmentMissing"
    })
  })

  it("requires the exact accepted claim cycle for every commitment-bound continuation category", () => {
    const claimOperationId = OperationId.make("all-continuation-categories-claim")
    const commitment = makeFreshTaskCommitmentForTest(taskId, claimOperationId, runId)
    const specification = makeTaskWorkSpecification({ body: "Implement A", taskId, title: "A" })
    const continuation = (step: FreshWorkflowStep) => ({
      step,
      transition: RunnableFrontierTransition.ContinueFreshWorkflowOperation({
        operationId: "predecessorOperationId" in step ? step.predecessorOperationId : claimOperationId,
        taskId
      })
    })
    const cases = [
      continuation(
        FreshWorkflowStep.ReadPostClaimGraph({
          claimOperation: commitment.operation,
          predecessorOperationId: claimOperationId,
          task
        })
      ),
      continuation(
        FreshWorkflowStep.ReadTaskWorkSpecification({
          claimOperationId,
          predecessorOperationId: claimOperationId,
          task
        })
      ),
      continuation(
        FreshWorkflowStep.RecordTaskAttemptPlan({
          claimOperationId,
          predecessorOperationId: claimOperationId,
          specification,
          task
        })
      ),
      continuation(
        FreshWorkflowStep.ReconcileTaskWorktree({
          claimOperationId,
          plannedAttempt,
          predecessorOperationId: claimOperationId,
          task
        })
      ),
      {
        step: FreshWorkflowStep.BeginPlannedAttemptExecutorWork({
          claimOperationId,
          plannedAttempt,
          specification,
          task
        }),
        transition: RunnableFrontierTransition.BeginPlannedAttemptExecutorWork({ plannedAttempt })
      }
    ] as const

    for (const pair of cases) {
      expect(freshContinuationDecisionOf(pair, [])).toBeUndefined()
      const decision = freshContinuationDecisionOf(pair, [commitment])
      expect(decision).toMatchObject({
        authority: { _tag: "FreshCommitmentAuthority", commitment },
        step: { _tag: pair.step._tag }
      })
      if (decision === undefined) return expect.fail("the accepted claim cycle must authorize its continuation")
      const proposal = deliveryProposalsOf({
        acceptedOperationIds: new Set([claimOperationId]),
        fresh: [decision],
        runId,
        transitions: [pair.transition]
      }).ticketDelivery[0]
      if (proposal === undefined) return expect.fail("the authorized continuation must produce one proposal")
      expect(freshContinuationCommitmentRequirementOf(proposal)).toEqual({
        _tag: "FreshContinuationCommitmentRequired",
        commitment
      })
    }
  })

  it("does not let continuation authority authorize another route, Run, or causal wait", () => {
    const claimOperationId = OperationId.make("continuation-boundary-claim")
    const predecessorOperationId = OperationId.make("continuation-boundary-predecessor")
    const commitment = makeFreshTaskCommitmentForTest(taskId, claimOperationId, runId)
    const pair = {
      step: FreshWorkflowStep.ReadTaskWorkSpecification({ claimOperationId, predecessorOperationId, task }),
      transition: RunnableFrontierTransition.ContinueFreshWorkflowOperation({
        operationId: predecessorOperationId,
        taskId
      })
    }
    const decision = freshContinuationDecisionOf(pair, [commitment])
    if (decision === undefined) return expect.fail("the exact accepted claim cycle must authorize its continuation")
    if (decision.step._tag !== "ReadTaskWorkSpecification") {
      return expect.fail("the continuation decision must retain the focused specification step")
    }
    const graphProposal = trackerGraphReadProposalOf({
      acceptedAt: null,
      purpose: "EstablishCurrentGraph",
      runId,
      target: FixtureTarget.make("continuation-boundary-target")
    })

    expect(authorizeFreshContinuationProposal(graphProposal, decision, runId)).toBe(graphProposal)
    expect(freshContinuationCommitmentRequirementOf(graphProposal)).toEqual({
      _tag: "FreshContinuationCommitmentNotRequired"
    })

    const issued = deliveryProposalsOf({
      acceptedOperationIds: new Set([predecessorOperationId]),
      fresh: [decision],
      runId,
      transitions: [pair.transition]
    }).ticketDelivery[0]
    if (
      issued === undefined ||
      issued.route._tag !== "FreshWorkflowRoute" ||
      issued.actionIdentity._tag !== "FreshOperationIdRequired"
    ) {
      return expect.fail("the authorized continuation must produce one fresh workflow proposal")
    }

    const wrongRunProposal = { ...issued }
    expect(
      authorizeFreshContinuationProposal(wrongRunProposal, decision, RunId.make("continuation-boundary-other-run"))
    ).toBe(wrongRunProposal)
    expect(freshContinuationCommitmentRequirementOf(wrongRunProposal)).toEqual({
      _tag: "FreshContinuationCommitmentMissing"
    })

    const contradictoryWait = {
      _tag: issued._tag,
      actionIdentity: issued.actionIdentity,
      admission: issued.admission,
      id: issued.id,
      order: issued.order,
      owner: issued.owner,
      route: { ...issued.route, step: decision.step },
      waitsForLiveOperationId: OperationId.make("continuation-boundary-foreign-wait")
    }
    const authorizedContradiction = authorizeFreshContinuationProposal(contradictoryWait, decision, runId)
    expect(authorizedContradiction).not.toBe(contradictoryWait)
    expect(freshContinuationCommitmentRequirementOf(authorizedContradiction)).toEqual({
      _tag: "FreshContinuationCommitmentMissing"
    })
  })

  it("rejects executor observation paired with a different exact attempt", () => {
    const step = FreshWorkflowStep.ObservePlannedAttemptExecutorWork({
      acceptedProgress: { _tag: "ExecutorReportAccepted", ordinal: PlannedAttemptExecutorReportOrdinal.make(1) },
      plannedAttempt,
      specification: makeTaskWorkSpecification({ body: "Implement A", taskId, title: "A" }),
      task
    })
    const transition = RunnableFrontierTransition.ObservePlannedAttemptExecutorWork({
      acceptedProgress: step.acceptedProgress,
      plannedAttempt: PlannedTaskAttempt.make({
        ...plannedAttempt,
        attemptId: AttemptId.make("continuation-observe-other-attempt")
      })
    })

    expect(freshContinuationDecisionOf({ step, transition }, [])).toBeUndefined()
  })

  it("fails closed when a derived post-entry step is paired with an incompatible transition", () => {
    const predecessorOperationId = OperationId.make("invalid-fresh-pair")
    const step = FreshWorkflowStep.ReadTaskWorkSpecification({
      claimOperationId: OperationId.make("invalid-fresh-pair-claim"),
      predecessorOperationId,
      task
    })
    const transition = RunnableFrontierTransition.CommitFreshTaskClaimIntent({
      taskId,
      taskRevision: TaskRevision.make("invalid-fresh-pair-revision")
    })

    const result = freshContinuationDecisionsOf([{ step, transition }], [])
    if (result._tag !== "Failure") return expect.fail("incompatible fresh route unexpectedly passed validation")

    expect(result.failure).toMatchObject({
      _tag: "FreshDecisionPartitionInvalid",
      step: "ReadTaskWorkSpecification",
      stepTaskId: taskId,
      transition: "CommitFreshTaskClaimIntent",
      transitionTaskId: taskId
    })
  })

  it("rejects a continuation paired with a different causal predecessor operation", () => {
    const claimOperationId = OperationId.make("fresh-predecessor-mismatch-claim")
    const step = FreshWorkflowStep.ReadTaskWorkSpecification({
      claimOperationId,
      predecessorOperationId: OperationId.make("fresh-predecessor-actual"),
      task
    })
    const transition = RunnableFrontierTransition.ContinueFreshWorkflowOperation({
      operationId: OperationId.make("fresh-predecessor-unrelated"),
      taskId
    })

    expect(
      freshContinuationDecisionOf({ step, transition }, [
        makeFreshTaskCommitmentForTest(taskId, claimOperationId, runId)
      ])
    ).toBeUndefined()
  })

  it("makes all execution-relevant continuation evidence immutable after minting", () => {
    const claimOperationId = OperationId.make("fresh-post-mint-claim")
    const predecessorOperationId = OperationId.make("fresh-post-mint-predecessor")
    const step = FreshWorkflowStep.RecordTaskAttemptPlan({
      claimOperationId,
      predecessorOperationId,
      specification: makeTaskWorkSpecification({ body: "original", taskId, title: "Original" }),
      task
    })
    const transition = RunnableFrontierTransition.ContinueFreshWorkflowOperation({
      operationId: predecessorOperationId,
      taskId
    })
    const proposal = deliveryProposalsOf({
      acceptedOperationIds: new Set(),
      fresh: Result.getOrThrow(
        freshContinuationDecisionsOf(
          [{ step, transition }],
          [makeFreshTaskCommitmentForTest(taskId, claimOperationId, runId)]
        )
      ),
      runId,
      transitions: [transition]
    }).ticketDelivery[0]
    if (proposal === undefined || proposal.route._tag !== "FreshWorkflowRoute") {
      return expect.fail("missing authorized continuation proposal")
    }
    const route = proposal.route

    expect(() => {
      ;(route.step as { predecessorOperationId: OperationId }).predecessorOperationId =
        OperationId.make("fresh-post-mint-mutated")
    }).toThrow()
    expect(() => {
      if (route.step._tag !== "RecordTaskAttemptPlan") return
      ;(route.step.specification as { body: string }).body = "mutated"
    }).toThrow()

    expect(freshContinuationCommitmentRequirementOf(proposal)._tag).toBe("FreshContinuationCommitmentRequired")
  })

  it.each([
    PlannedTaskAttempt.make({ ...plannedAttempt, attemptId: AttemptId.make("attempt-A-other") }),
    PlannedTaskAttempt.make({ ...plannedAttempt, worktree: WorktreeLocator.make("/worktrees/A-other") })
  ])("rejects a Begin pair whose exact planned attempts disagree", (transitionAttempt) => {
    const step = FreshWorkflowStep.BeginPlannedAttemptExecutorWork({
      claimOperationId: OperationId.make("claim-before-begin"),
      plannedAttempt,
      specification: makeTaskWorkSpecification({ body: "Implement A", taskId, title: "A" }),
      task
    })
    const transition = RunnableFrontierTransition.BeginPlannedAttemptExecutorWork({ plannedAttempt: transitionAttempt })

    expect(
      freshContinuationDecisionsOf(
        [{ step, transition }],
        [makeFreshTaskCommitmentForTest(taskId, step.claimOperationId, runId)]
      )
    ).toMatchObject({ _tag: "Failure", failure: { _tag: "FreshDecisionPartitionInvalid" } })
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
    if (proposal === undefined) return expect.fail("accepted reconciliation must produce one proposal")
    expect(freshContinuationCommitmentRequirementOf(proposal)).toEqual({
      _tag: "FreshContinuationCommitmentNotRequired"
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
    const predecessorOperationIdB = OperationId.make("accepted-graph-read-B")
    const claimOperationIdB = OperationId.make("accepted-claim-B")
    const stepB = FreshWorkflowStep.ReadTaskWorkSpecification({
      claimOperationId: claimOperationIdB,
      predecessorOperationId: predecessorOperationIdB,
      task: { id: taskB, lifecycle: TaskLifecycle.cases.Open.make({}), parentTaskId: null, prerequisiteIds: [] }
    })
    const readyB = RunnableFrontierTransition.ContinueFreshWorkflowOperation({
      operationId: predecessorOperationIdB,
      taskId: taskB
    })
    const contributions = deliveryProposalsOf({
      acceptedOperationIds: new Set(),
      fresh: Result.getOrThrow(
        freshContinuationDecisionsOf(
          [{ step: stepB, transition: readyB }],
          [makeFreshTaskCommitmentForTest(taskB, claimOperationIdB, runId)]
        )
      ),
      runId,
      transitions: [brokenA, readyB]
    })

    const frontier = deliveryProposalFrontierOf(
      [contributions.ticketDelivery, contributions.deliverySettlement],
      contributions.issues
    )

    expect(frontier).toMatchObject({
      _tag: "DeliveryProposalsAvailable",
      freshTaskCandidates: [],
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
    const predecessorOperationIdC = OperationId.make("accepted-graph-read-C")
    const claimOperationIdC = OperationId.make("accepted-claim-C")
    const claimC = RunnableFrontierTransition.ContinueFreshWorkflowOperation({
      operationId: predecessorOperationIdC,
      taskId: taskC
    })
    const claimStepC = FreshWorkflowStep.ReadTaskWorkSpecification({
      claimOperationId: claimOperationIdC,
      predecessorOperationId: predecessorOperationIdC,
      task: { id: taskC, lifecycle: TaskLifecycle.cases.Open.make({}), parentTaskId: null, prerequisiteIds: [] }
    })
    const contributions = deliveryProposalsOf({
      acceptedOperationIds: new Set(),
      fresh: Result.getOrThrow(
        freshContinuationDecisionsOf(
          [{ step: claimStepC, transition: claimC }],
          [makeFreshTaskCommitmentForTest(taskC, claimOperationIdC, runId)]
        )
      ),
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
      freshTaskCandidates: [],
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
