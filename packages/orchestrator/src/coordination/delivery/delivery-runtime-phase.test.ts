import {
  AttemptId,
  GitCommitSha,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { initialRunPolicyRevision, RunControlPolicy } from "../../control/policy.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { OperationId } from "../../workflow/identity.js"
import { AttemptChoiceRequestId } from "../../workflow/protocols/attempt-choice/events.js"
import {
  makeTaskClaimObservationOperation,
  makeTaskWorktreeObservationOperation
} from "../../workflow/registry/operation.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { makeFreshTaskAdmissionTestBasis } from "../../../test/support/fresh-task-admission.js"
import { RunnableFrontierTransition } from "../frontier/frontier.js"
import { deliveryRuntime } from "./delivery-runtime-adapter.js"
import { deliveryProposalsOf, trackerGraphReadProposalOf } from "./delivery-proposal.js"
import { evaluationForPhase, DeliveryRuntimePhase } from "./delivery-runtime-phase.js"
import { deterministicDeliveryRuntimeSupport, makeDeliveryRelationsLayer } from "./in-memory-relations.js"
import {
  currentSignalOf,
  type DeliveryActionProposal,
  type DeliveryRelationInputBundle,
  type DeliveryRuntimeEvaluation,
  TrackerGraphState
} from "./relations.js"

const runId = RunId.make("delivery-runtime-phase-run")
const target = FixtureTarget.make("delivery-runtime-phase-target")
const capacity = TaskWorkCapacity.make(2)
const policy = RunControlPolicy.make({ revision: initialRunPolicyRevision, taskExecutionCapacity: capacity })

const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("delivery-runtime-phase-active-attempt"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/delivery-runtime-phase-active"),
  executor: TaskExecutorLocator.make("executor:delivery-runtime-phase"),
  runId,
  taskId: TaskId.make("delivery-runtime-phase-active-task"),
  taskRevision: TaskRevision.make("delivery-runtime-phase-active-revision"),
  worktree: WorktreeLocator.make("/worktrees/delivery-runtime-phase-active")
})

const independentAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("delivery-runtime-phase-independent-attempt"),
  baseSha: GitCommitSha.make("2".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/delivery-runtime-phase-independent"),
  executor: TaskExecutorLocator.make("executor:delivery-runtime-phase-independent"),
  runId,
  taskId: TaskId.make("delivery-runtime-phase-independent-task"),
  taskRevision: TaskRevision.make("delivery-runtime-phase-independent-revision"),
  worktree: WorktreeLocator.make("/worktrees/delivery-runtime-phase-independent")
})

const proposalFor = (
  transition: RunnableFrontierTransition,
  attempt: PlannedTaskAttempt,
  acceptedOperationIds: ReadonlySet<OperationId> = new Set()
): DeliveryActionProposal => {
  const proposal = deliveryProposalsOf({
    acceptedOperationIds,
    fresh: [],
    responsibilities: [
      { _tag: "PlannedAttemptExecutorWorkResponsibility", beganAt: JournalPosition.make(1), plannedAttempt: attempt }
    ],
    runId: attempt.runId,
    transitions: [transition]
  }).ticketDelivery[0]
  if (proposal === undefined) return expect.fail(`fixture transition ${transition._tag} must derive one proposal`)
  return proposal
}

const baseEvaluation = Effect.gen(function* () {
  const runtime = yield* deliveryRuntime.pipe(
    Effect.provide(
      makeDeliveryRelationsLayer({
        ...deterministicDeliveryRuntimeSupport(policy),
        coherent: currentSignalOf({
          actionInputs: {
            freshTaskCandidates: [],
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
              taskWork: makeFreshTaskAdmissionTestBasis({ capacity })
            },
            trackerGraphProposals: []
          },
          publication: { exactEvidence: [], graph: TrackerGraphState.cases.GraphNotEstablished.make({}), policy }
        } satisfies DeliveryRelationInputBundle)
      })
    )
  )
  return yield* runtime.get
})

const withProposals = (
  evaluation: DeliveryRuntimeEvaluation,
  proposals: ReadonlyArray<DeliveryActionProposal>
): DeliveryRuntimeEvaluation => ({
  ...evaluation,
  proposedActions: { _tag: "DeliveryProposalsAvailable", freshTaskCandidates: [], isolatedIssues: [], proposals }
})

const worktreeOperation = makeTaskWorktreeObservationOperation({
  operationId: OperationId.make("delivery-runtime-phase-active-worktree"),
  plannedAttempt,
  predecessorOperationIds: []
})
const activeWorktreeTransition = RunnableFrontierTransition.ObservePlannedAttemptContinuationWorktree({
  operation: worktreeOperation,
  plannedAttempt
})

it.effect("before G2 admits the tracker graph read", () =>
  Effect.gen(function* () {
    const base = yield* baseEvaluation
    const graph = trackerGraphReadProposalOf({ acceptedAt: null, purpose: "EstablishCurrentGraph", runId, target })

    const phased = evaluationForPhase(
      DeliveryRuntimePhase.ActiveRefreshPreG2([{ runId, attemptId: plannedAttempt.attemptId }]),
      withProposals(base, [graph])
    )

    expect(phased.proposedActions).toMatchObject({ _tag: "DeliveryProposalsAvailable", proposals: [graph] })
  })
)

it.effect("before G2 admits a fresh active-attempt authority read and defers independent work", () =>
  Effect.gen(function* () {
    const base = yield* baseEvaluation
    const independentTransition = RunnableFrontierTransition.ObservePlannedAttemptExecutorWork({
      acceptedProgress: { _tag: "ExecutorResponsibilityBegan", acceptedAt: JournalPosition.make(2) },
      plannedAttempt: independentAttempt
    })
    const jointlyDerived = deliveryProposalsOf({
      acceptedOperationIds: new Set(),
      fresh: [],
      responsibilities: [
        { _tag: "PlannedAttemptExecutorWorkResponsibility", beganAt: JournalPosition.make(1), plannedAttempt },
        {
          _tag: "PlannedAttemptExecutorWorkResponsibility",
          beganAt: JournalPosition.make(2),
          plannedAttempt: independentAttempt
        }
      ],
      runId,
      transitions: [activeWorktreeTransition, independentTransition]
    }).ticketDelivery
    expect(jointlyDerived).toHaveLength(2)
    const [freshActiveRead, independentContinuation] = jointlyDerived
    if (freshActiveRead === undefined || independentContinuation === undefined) {
      return expect.fail("the joint A+B frontier must derive both production proposals")
    }
    expect([freshActiveRead.order, independentContinuation.order]).toMatchObject([
      { frontierOrdinal: 0, responsibilityBeganAt: 1 },
      { frontierOrdinal: 1, responsibilityBeganAt: 2 }
    ])

    const phased = evaluationForPhase(
      DeliveryRuntimePhase.ActiveRefreshPreG2([{ runId, attemptId: plannedAttempt.attemptId }]),
      withProposals(base, jointlyDerived)
    )

    expect(phased.proposedActions).toMatchObject({ _tag: "DeliveryProposalsAvailable", proposals: [freshActiveRead] })
  })
)

it.effect("before G2 admits replay of an accepted active-attempt authority read", () =>
  Effect.gen(function* () {
    const base = yield* baseEvaluation
    const acceptedActiveRead = proposalFor(
      activeWorktreeTransition,
      plannedAttempt,
      new Set([worktreeOperation.operationId])
    )

    const phased = evaluationForPhase(
      DeliveryRuntimePhase.ActiveRefreshPreG2([{ runId, attemptId: plannedAttempt.attemptId }]),
      withProposals(base, [acceptedActiveRead])
    )

    expect(phased.proposedActions).toMatchObject({
      _tag: "DeliveryProposalsAvailable",
      proposals: [acceptedActiveRead]
    })
  })
)

it.effect("before G2 admits the active attempt's executor read", () =>
  Effect.gen(function* () {
    const base = yield* baseEvaluation
    const activeExecutorRead = proposalFor(
      RunnableFrontierTransition.ReconcilePlannedAttemptExecutorWork({ plannedAttempt }),
      plannedAttempt
    )

    const phased = evaluationForPhase(
      DeliveryRuntimePhase.ActiveRefreshPreG2([{ runId, attemptId: plannedAttempt.attemptId }]),
      withProposals(base, [activeExecutorRead])
    )

    expect(phased.proposedActions).toMatchObject({
      _tag: "DeliveryProposalsAvailable",
      proposals: [activeExecutorRead]
    })
  })
)

it.effect("after G2 suppresses captured A suspension and preserves independent B continuation", () =>
  Effect.gen(function* () {
    const base = yield* baseEvaluation
    const activeTransition = RunnableFrontierTransition.SuspendPlannedAttemptExecutorWork({ plannedAttempt })
    const independentTransition = RunnableFrontierTransition.ObservePlannedAttemptExecutorWork({
      acceptedProgress: { _tag: "ExecutorResponsibilityBegan", acceptedAt: JournalPosition.make(2) },
      plannedAttempt: independentAttempt
    })
    const jointlyDerived = deliveryProposalsOf({
      acceptedOperationIds: new Set(),
      fresh: [],
      responsibilities: [
        { _tag: "PlannedAttemptExecutorWorkResponsibility", beganAt: JournalPosition.make(1), plannedAttempt },
        {
          _tag: "PlannedAttemptExecutorWorkResponsibility",
          beganAt: JournalPosition.make(2),
          plannedAttempt: independentAttempt
        }
      ],
      runId,
      transitions: [activeTransition, independentTransition]
    }).ticketDelivery
    expect(jointlyDerived).toHaveLength(2)
    const [activeSuspension, independentContinuation] = jointlyDerived
    if (activeSuspension === undefined || independentContinuation === undefined) {
      return expect.fail("the joint A+B frontier must derive both production proposals")
    }
    expect([activeSuspension.order, independentContinuation.order]).toMatchObject([
      { frontierOrdinal: 0, responsibilityBeganAt: 1 },
      { frontierOrdinal: 1, responsibilityBeganAt: 2 }
    ])

    const phased = evaluationForPhase(
      DeliveryRuntimePhase.ActiveRefreshPostG2([{ runId, attemptId: plannedAttempt.attemptId }]),
      withProposals(base, jointlyDerived)
    )

    expect(phased.proposedActions).toMatchObject({
      _tag: "DeliveryProposalsAvailable",
      proposals: [independentContinuation]
    })
  })
)

it.effect("after G2 suppresses the captured attempt's continuation", () =>
  Effect.gen(function* () {
    const base = yield* baseEvaluation
    const activeContinuation = proposalFor(
      RunnableFrontierTransition.ObservePlannedAttemptExecutorWork({
        acceptedProgress: { _tag: "ExecutorResponsibilityBegan", acceptedAt: JournalPosition.make(1) },
        plannedAttempt
      }),
      plannedAttempt
    )

    const phased = evaluationForPhase(
      DeliveryRuntimePhase.ActiveRefreshPostG2([{ runId, attemptId: plannedAttempt.attemptId }]),
      withProposals(base, [activeContinuation])
    )

    expect(phased.proposedActions).toMatchObject({ _tag: "DeliveryProposalsAvailable", proposals: [] })
  })
)

it.effect("after G2 suppresses a fresh authority read for the captured attempt", () =>
  Effect.gen(function* () {
    const base = yield* baseEvaluation
    const freshActiveRead = proposalFor(activeWorktreeTransition, plannedAttempt)

    const phased = evaluationForPhase(
      DeliveryRuntimePhase.ActiveRefreshPostG2([{ runId, attemptId: plannedAttempt.attemptId }]),
      withProposals(base, [freshActiveRead])
    )

    expect(phased.proposedActions).toMatchObject({ _tag: "DeliveryProposalsAvailable", proposals: [] })
  })
)

it.effect("after G2 preserves a non-refresh transition for the captured attempt", () =>
  Effect.gen(function* () {
    const base = yield* baseEvaluation
    const attemptChoiceRead = proposalFor(
      RunnableFrontierTransition.ObserveAttemptStoppageExecutor({
        requestId: AttemptChoiceRequestId.make({ nonce: "delivery-runtime-phase-stop", runId }),
        subject: { observedTaskRevision: plannedAttempt.taskRevision, plannedAttempt }
      }),
      plannedAttempt
    )

    const phased = evaluationForPhase(
      DeliveryRuntimePhase.ActiveRefreshPostG2([{ runId, attemptId: plannedAttempt.attemptId }]),
      withProposals(base, [attemptChoiceRead])
    )

    expect(phased.proposedActions).toMatchObject({ _tag: "DeliveryProposalsAvailable", proposals: [attemptChoiceRead] })
  })
)

it.effect("after G2 preserves an independent recovered tracker read with no planned attempt", () =>
  Effect.gen(function* () {
    const base = yield* baseEvaluation
    const independentTaskId = TaskId.make("delivery-runtime-phase-independent-claim")
    const transition = RunnableFrontierTransition.ObserveResponsibleTaskClaim({
      operation: makeTaskClaimObservationOperation(
        OperationId.make("delivery-runtime-phase-independent-claim-read"),
        target,
        independentTaskId
      ),
      taskId: independentTaskId
    })
    const [independentRead] = deliveryProposalsOf({
      acceptedOperationIds: new Set(),
      fresh: [],
      runId,
      transitions: [transition]
    }).ticketDelivery
    if (independentRead === undefined) return expect.fail("the independent tracker read must derive a proposal")

    expect(independentRead.route).toMatchObject({
      _tag: "RecoveredNewActionRoute",
      action: { _tag: "ReadTaskClaim", plannedAttempt: null, taskId: independentTaskId }
    })

    const phased = evaluationForPhase(
      DeliveryRuntimePhase.ActiveRefreshPostG2([{ runId, attemptId: plannedAttempt.attemptId }]),
      withProposals(base, [independentRead])
    )

    expect(phased.proposedActions).toMatchObject({ _tag: "DeliveryProposalsAvailable", proposals: [independentRead] })
  })
)
