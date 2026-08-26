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
import { it as effectIt } from "@effect/vitest"
import { Effect, Stream } from "effect"
import { expect } from "vitest"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { validSnapshot } from "../../../test/task-dag.js"
import { OperationId } from "../../workflow/identity.js"
import { WorkflowInterpreter, WorkflowTrace } from "../../workflow/interpretation/interpreter.js"
import { OperationIdAllocator, PlannedTaskAttemptPlanner } from "../../workflow/protocols/task-attempt-planning/plan.js"
import { TaskClaimAcquisitionPlanner } from "../../workflow/protocols/task-claim-acquisition/plan.js"
import { InRunJournal } from "../../workflow-journal/store.js"
import { RunnableFrontierTransition } from "../frontier/frontier.js"
import type { TrackerGraphRefreshOperation } from "../frontier/frontier.js"
import type { DeliveryActionExecutionLease } from "./delivery-action-executor.js"
import { materializeDeliveryAction, materializedOperationId } from "./delivery-action-materialization.js"
import { deliveryProposalsOf } from "./delivery-proposal.js"
import { executeAcceptedWorkflowAction, executeNewRecoveredAction } from "./recovered-delivery-action-adapter.js"

import {
  makeTargetLineageObservationOperation,
  makeTaskClaimObservationOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTaskWorktreeObservationOperation,
  makeTrackerGraphObservationOperation
} from "../../workflow/registry/operation.js"

const runId = RunId.make("delivery-materialization-run")
const taskId = TaskId.make("delivery-materialization-task")
const target = FixtureTarget.make("delivery-materialization-target")
const integrationTarget = IntegrationTarget.make({
  ref: IntegrationTargetRef.make("refs/heads/main"),
  repository: GitRepositoryLocator.make("/repositories/delivery-materialization.git")
})
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("delivery-materialization-attempt"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/delivery-materialization"),
  executor: TaskExecutorLocator.make("executor:delivery-materialization"),
  runId,
  taskId,
  taskRevision: TaskRevision.make("delivery-materialization-revision"),
  worktree: WorktreeLocator.make("/worktrees/delivery-materialization")
})

const refreshOperationId = OperationId.make("delivery-materialization-planned-refresh")
const refreshPredecessorOperationId = OperationId.make("delivery-materialization-claim-observation")
const refreshOperation = makeTrackerGraphObservationOperation(
  refreshOperationId,
  target,
  [refreshPredecessorOperationId],
  [taskId]
) as TrackerGraphRefreshOperation

const observationTransitions = [
  RunnableFrontierTransition.ObservePlannedAttemptContinuationGraph({
    operation: makeTrackerGraphObservationOperation(
      OperationId.make("delivery-materialization-ordinary-graph"),
      target,
      [],
      []
    ),
    plannedAttempt
  }),
  RunnableFrontierTransition.ObservePlannedAttemptContinuationClaim({
    operation: makeTaskClaimObservationOperation(
      OperationId.make("delivery-materialization-ordinary-claim"),
      target,
      taskId,
      []
    ),
    plannedAttempt
  }),
  RunnableFrontierTransition.ObservePlannedAttemptContinuationSpecification({
    operation: makeTaskWorkSpecificationObservationOperation(
      OperationId.make("delivery-materialization-ordinary-specification"),
      target,
      taskId,
      []
    ),
    plannedAttempt
  }),
  RunnableFrontierTransition.ObservePlannedAttemptContinuationWorktree({
    operation: makeTaskWorktreeObservationOperation({
      operationId: OperationId.make("delivery-materialization-ordinary-worktree"),
      plannedAttempt,
      predecessorOperationIds: []
    }),
    plannedAttempt
  }),
  RunnableFrontierTransition.ObservePlannedAttemptContinuationTargetLineage({
    operation: makeTargetLineageObservationOperation({
      integrationTarget,
      operationId: OperationId.make("delivery-materialization-ordinary-lineage"),
      plannedAttempt,
      predecessorOperationIds: []
    }),
    plannedAttempt
  })
] as const

const refreshTransition = RunnableFrontierTransition.RefreshCurrentGraphAfterClaim({
  operation: refreshOperation,
  plannedAttempt
})

const proposalFor = (
  transition: RunnableFrontierTransition,
  acceptedOperationIds: ReadonlySet<OperationId> = new Set()
): ReturnType<typeof deliveryProposalsOf>["ticketDelivery"][number] | undefined => {
  const result = deliveryProposalsOf({
    acceptedOperationIds,
    fresh: [],
    integrationResponsibilities: [],
    responsibilities: [],
    runId,
    transitions: [transition]
  })
  const proposal = [...result.ticketDelivery, ...result.deliverySettlement][0]
  return proposal
}

const inertLease = (recordIntent: (operationId: OperationId) => Effect.Effect<void>): DeliveryActionExecutionLease => ({
  acceptIntegrationTargetOwnership: Effect.void,
  bindPlannedAttemptPosition: () => Effect.void,
  forwardBoundary: {
    _tag: "InterruptibleBoundary",
    execution: { run: (_intent, effect, recordResult) => effect.pipe(Effect.flatMap(recordResult)) }
  },
  integrationTargets: {
    acquire: () => Effect.void,
    changes: Stream.empty,
    publishAcceptedOwnership: () => Effect.void,
    release: () => Effect.void,
    releaseAll: Effect.void,
    snapshot: Effect.succeed({ activeResponsibilityPositions: new Set(), heldResponsibilityPositions: new Set() }),
    withPermit: (_responsibility, effect) => effect
  },
  recordIntent,
  releasePlannedAttemptPosition: () => Effect.void,
  withPlannedAttemptProtocol: () => Effect.die("unused planned-attempt protocol lease")
})

const observationInterpreter = (observed: Array<typeof refreshOperation>) =>
  WorkflowInterpreter.of({
    acquireTaskClaim: () => Effect.die("unused claim acquisition"),
    readTaskClaim: () => Effect.die("unused claim read"),
    readTaskWorktree: () => Effect.die("unused worktree read"),
    readTargetLineage: () => Effect.die("unused target-lineage read"),
    readTrackerGraph: (operation, onIntentRecorded) =>
      Effect.gen(function* () {
        if (onIntentRecorded !== undefined) yield* onIntentRecorded
        observed.push(operation as typeof refreshOperation)
        return validSnapshot({ revision: "delivery-materialization-graph", tasks: [] })
      }),
    readTaskWorkSpecification: () => Effect.die("unused specification read"),
    reconcileTaskWorktree: () => Effect.die("unused worktree reconciliation"),
    recordTaskAttemptPlan: () => Effect.die("unused attempt planning"),
    releaseTaskClaim: () => Effect.die("unused claim release")
  })

effectIt.effect("carries a fresh planned graph-refresh identity through proposal, materialization, and intent", () =>
  Effect.gen(function* () {
    const proposal = proposalFor(refreshTransition)
    if (proposal === undefined)
      return yield* Effect.die("expected a delivery proposal for RefreshCurrentGraphAfterClaim")
    expect(proposal).toMatchObject({
      actionIdentity: {
        _tag: "FreshOperationIdRequired",
        source: { _tag: "DeterministicOperationId", operationId: refreshOperationId }
      },
      route: { _tag: "RecoveredNewActionRoute", action: { operationIdSource: { _tag: "DeterministicOperationId" } } }
    })

    const allocatorId = OperationId.make("delivery-materialization-allocator-must-not-win")
    const action = yield* materializeDeliveryAction(proposal).pipe(
      Effect.provideService(
        OperationIdAllocator,
        OperationIdAllocator.of({ allocate: () => Effect.succeed(allocatorId) })
      ),
      Effect.provideService(
        PlannedTaskAttemptPlanner,
        PlannedTaskAttemptPlanner.of({ plan: () => Effect.die("unused attempt planner") })
      )
    )
    expect(materializedOperationId(action)).toBe(refreshOperationId)
    if (action._tag !== "FreshOperationAction") return yield* Effect.die("expected a fresh graph-refresh action")
    if (action.proposal.route._tag !== "RecoveredNewActionRoute") {
      return yield* Effect.die("expected a recovered observation route")
    }

    const intents: Array<OperationId> = []
    const observed: Array<typeof refreshOperation> = []
    yield* executeNewRecoveredAction(
      action.proposal.route.action,
      action.operationId,
      inertLease((operationId) => Effect.sync(() => intents.push(operationId))),
      runId
    ).pipe(
      Effect.provideService(WorkflowInterpreter, observationInterpreter(observed)),
      Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })),
      Effect.provideService(
        InRunJournal,
        InRunJournal.of({ append: () => Effect.die("unused journal append"), read: () => Effect.succeed([]) })
      ),
      Effect.provideService(
        PlannedTaskAttemptPlanner,
        PlannedTaskAttemptPlanner.of({ plan: () => Effect.die("unused attempt planner") })
      ),
      Effect.provideService(
        TaskClaimAcquisitionPlanner,
        TaskClaimAcquisitionPlanner.of({ plan: () => Effect.die("unused claim planner") })
      )
    )
    expect(intents).toEqual([refreshOperationId])
    expect(observed).toHaveLength(1)
    expect(observed[0]?.operationId).toBe(refreshOperationId)
    expect(observed[0]?.predecessorOperationIds).toEqual([refreshPredecessorOperationId])
  })
)

effectIt.effect("keeps ordinary recovered observations allocator-backed", () =>
  Effect.gen(function* () {
    const allocatorId = OperationId.make("delivery-materialization-ordinary-allocator")
    for (const transition of observationTransitions) {
      const proposal = proposalFor(transition)
      if (proposal === undefined) return yield* Effect.die(`expected a delivery proposal for ${transition._tag}`)
      const action = yield* materializeDeliveryAction(proposal).pipe(
        Effect.provideService(
          OperationIdAllocator,
          OperationIdAllocator.of({ allocate: () => Effect.succeed(allocatorId) })
        ),
        Effect.provideService(
          PlannedTaskAttemptPlanner,
          PlannedTaskAttemptPlanner.of({ plan: () => Effect.die("unused attempt planner") })
        )
      )
      expect(materializedOperationId(action), transition._tag).toBe(allocatorId)
    }
  })
)

effectIt.effect("routes an accepted graph refresh as the same AcceptedOperationAction", () =>
  Effect.gen(function* () {
    const proposal = proposalFor(refreshTransition, new Set([refreshOperationId]))
    if (proposal === undefined)
      return yield* Effect.die("expected a delivery proposal for RefreshCurrentGraphAfterClaim")
    expect(proposal.actionIdentity).toEqual({ _tag: "ExistingOperationId" })
    if (proposal.route._tag !== "AcceptedWorkflowRoute") {
      return yield* Effect.die("expected the accepted refresh to retain its accepted route")
    }

    const action = yield* materializeDeliveryAction(proposal).pipe(
      Effect.provideService(
        OperationIdAllocator,
        OperationIdAllocator.of({ allocate: () => Effect.die("accepted refresh must not allocate") })
      ),
      Effect.provideService(
        PlannedTaskAttemptPlanner,
        PlannedTaskAttemptPlanner.of({ plan: () => Effect.die("unused attempt planner") })
      )
    )
    expect(action._tag).toBe("AcceptedOperationAction")
    expect(materializedOperationId(action)).toBe(refreshOperationId)

    const intents: Array<OperationId> = []
    const observed: Array<typeof refreshOperation> = []
    yield* executeAcceptedWorkflowAction(
      runId,
      proposal.route.transition,
      inertLease((operationId) => Effect.sync(() => intents.push(operationId)))
    ).pipe(
      Effect.provideService(WorkflowInterpreter, observationInterpreter(observed)),
      Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })),
      Effect.provideService(
        InRunJournal,
        InRunJournal.of({ append: () => Effect.die("unused journal append"), read: () => Effect.succeed([]) })
      ),
      Effect.provideService(
        PlannedTaskAttemptPlanner,
        PlannedTaskAttemptPlanner.of({ plan: () => Effect.die("unused attempt planner") })
      )
    )
    expect(intents).toEqual([refreshOperationId])
    expect(observed[0]?.operationId).toBe(refreshOperationId)
  })
)
