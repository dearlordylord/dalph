import {
  AttemptId,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorReport,
  PlannedTaskAttempt,
  type RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator,
  plannedAttemptExecutorCorrelation
} from "@dalph/contracts"
import { NodeCrypto } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Clock, Context, Deferred, Effect, Exit, Fiber, Layer, Ref, Scope, Stream, SubscriptionRef } from "effect"
import { expect } from "vitest"
import { makeApplicationExitShell } from "../application-exit/application-shell.js"
import { CoordinatorOwnership } from "../../authorities/coordinator-ownership/ownership.js"
import { PlannedWorktreeReady } from "../../authorities/git/worktree.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { projectTrackerSnapshot, type TaskDagSnapshot } from "../../authorities/task-tracker/graph.js"
import { InitialControlPolicy, initialRunPolicyRevision, RunControlPolicy } from "../../control/policy.js"
import { taskWorkCapacityControlLayer } from "../../control/task-work-capacity.js"
import { acceptedResultFixture } from "../../../test/support/evidence.js"
import { makeTestJournaledTrackerGraphObservation } from "../../../test/journaled-graph-observation.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { DeliveryActionExecutor } from "../delivery/delivery-action-executor.js"
import { DeliveryAcceptedFactPublication } from "../delivery/delivery-accepted-fact-publication.js"
import { deliveryRuntime } from "../delivery/delivery-runtime-adapter.js"
import { DeliveryRuntimeObservationPublication } from "../delivery/delivery-runtime-observation.js"
import { DeliveryRuntimeResources } from "../delivery/delivery-runtime-resources.js"
import { DeliveryRelationPublicationObserver } from "../delivery/delivery-publication-observer.js"
import { makeDeliveryRelationsLayer } from "../delivery/in-memory-relations.js"
import { makeReactiveDeliveryRelationsLayer } from "../delivery/reactive-delivery-relations.js"
import {
  type CurrentSignal,
  type DeliveryRelationInputBundle,
  type DeliveryRuntimeEvaluation,
  TrackerGraphState
} from "../delivery/relations.js"
import { deliveryProposalsOf, type DeliveryActionProposal } from "../delivery/delivery-proposal.js"
import { makeLiveDeliveryActionExecutor } from "../delivery/live-delivery-action-executor.js"
import {
  ResponsibilityDisposition,
  type PlannedAttemptExecutorDisposition,
  type ResponsibilityFreshFacts
} from "../frontier/fresh-facts.js"
import { RunnableFrontierTransition, RunFinalityDecision } from "../frontier/frontier.js"
import { WorkflowResponsibilityEntry } from "../reconstruction/state.js"
import { runDeliveryRuntime } from "../delivery/run-delivery-runtime.js"
import { Journal } from "../delivery/journal.js"
import { memoryJournalStoreLayer } from "../../workflow-journal/adapters/memory-store.js"
import {
  InRunJournal,
  JournalStore,
  journalStoreCapabilities,
  RunLifecycleJournal
} from "../../workflow-journal/store.js"
import { WorkflowInterpreter, WorkflowTrace } from "../../workflow/interpretation/interpreter.js"
import { journaledWorkflowInterpreterLayer } from "../../workflow-journal/journaled-interpreter.js"
import { OperationId } from "../../workflow/identity.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import { attemptChoiceControlLayer } from "../../workflow/protocols/attempt-choice/control.js"
import { controlDirectionApplicationLayer } from "../../workflow/protocols/control-direction-application/protocol.js"
import {
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "../../workflow/protocols/planned-attempt-executor-work/events.js"
import { plannedAttemptProtocolControllerLayer } from "../../workflow/protocols/planned-attempt-executor-work/protocol-controller.js"
import { makeTaskTrackerFactsObservedFromRead } from "../../workflow/protocols/task-tracker-read/protocol.js"
import { taskClaimReacquisitionControlLayer } from "../../workflow/protocols/task-claim-reacquisition/control.js"
import { TaskClaimAcquisitionPlanner } from "../../workflow/protocols/task-claim-acquisition/plan.js"
import {
  deterministicOperationIdAllocatorLayer,
  deterministicPlannedTaskAttemptLayer
} from "../../workflow/protocols/task-attempt-planning/plan.js"
import { StartedIntegrationResponsibility } from "../../workflow/protocols/integration-admission/protocol.js"
import {
  IntegrationCandidateCorrelation,
  IntegrationCandidateId,
  IntegrationCandidateResourceLocator,
  IntegrationSessionId
} from "../../workflow/protocols/integration-candidate-construction/events.js"
import {
  TargetPromotionCorrelation,
  TargetPromotionRequestId
} from "../../workflow/protocols/target-promotion/events.js"
import { TargetPromotionPendingRetry, TargetPromotionState } from "../../workflow/protocols/target-promotion/state.js"
import {
  TargetVerificationCorrelation,
  TargetVerificationPlanId,
  TargetVerificationRequestId
} from "../../workflow/protocols/target-verification/events.js"
import {
  taskTrackerReadIntent,
  TaskAttemptPlannedEvent,
  TaskWorktreeReconciliationIntendedEvent
} from "../../workflow/registry/event.js"
import {
  makeTaskAttemptPlanOperation,
  makeTaskWorktreeReconciliationOperation,
  makeTrackerGraphObservationOperation
} from "../../workflow/registry/operation.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import {
  attemptPlanRecordKey,
  intentRecordKey,
  outcomeRecordKey,
  plannedAttemptExecutorCommandIntendedRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey
} from "../../workflow-journal/record-key.js"
import { type AllocatedWorkflowRunId, freshWorkflowRunId } from "./fresh-run-identity.js"
import { journaledRunBootstrapLayer } from "./journaled-run-bootstrap.js"
import { makeRunRecoveryProjection, RunRecoveryProjection } from "./recovery-activation.js"
import { pauseSafeBoundaryBlockersOf, type PauseProgressView } from "./pause-progress-observation.js"
import { JournaledRunBootstrap } from "./run.js"

const target = FixtureTarget.make("pause-progress-public-boundary")
const initialPolicy = InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(4) })
const policy = RunControlPolicy.make({
  revision: initialRunPolicyRevision,
  taskExecutionCapacity: initialPolicy.taskExecutionCapacity
})

interface BoundaryCalls {
  readonly executor: number
  readonly git: number
  readonly journalStore: number
  readonly tracker: number
}

const noBoundaryCalls: BoundaryCalls = { executor: 0, git: 0, journalStore: 0, tracker: 0 }

const increment = (calls: Ref.Ref<BoundaryCalls>, boundary: keyof BoundaryCalls) =>
  Ref.update(calls, (current) => ({ ...current, [boundary]: current[boundary] + 1 }))

const snapshot = (revision: string, dParent: "A" | null): TaskDagSnapshot => {
  const projected = projectTrackerSnapshot({
    revision,
    tasks: [
      { id: "A", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] },
      { id: "D", lifecycle: { _tag: "Open" }, parentTaskId: dParent, prerequisiteIds: [] },
      { id: "C", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }
    ]
  })
  if (projected._tag === "Invalid") throw new Error(`invalid ${revision} graph fixture`)
  return projected.snapshot
}

const plannedAttempt = (runId: RunId, taskId: TaskId): PlannedTaskAttempt =>
  PlannedTaskAttempt.make({
    attemptId: AttemptId.make(`pause-public-${taskId}`),
    baseSha: GitCommitSha.make("1".repeat(40)),
    branch: TaskBranchRef.make(`refs/heads/pause-public-${taskId}`),
    executor: TaskExecutorLocator.make("executor:pause-public"),
    runId,
    taskId,
    taskRevision: TaskRevision.make(`pause-public-revision-${taskId}`),
    worktree: WorktreeLocator.make(`/pause-public/${taskId}`)
  })

const appendRunningAttempt = Effect.fn("PauseProgressAcceptance.appendRunningAttempt")(function* (
  journal: Journal["Service"],
  attempt: PlannedTaskAttempt
) {
  const plan = makeTaskAttemptPlanOperation({
    operationId: OperationId.make(`pause-public-restart-plan-${attempt.taskId}`),
    plannedAttempt: attempt,
    predecessorOperationIds: []
  })
  yield* journal.append(
    attempt.runId,
    attemptPlanRecordKey(attempt.attemptId),
    TaskAttemptPlannedEvent.make({ operation: plan, version: workflowJournalEventVersion })
  )
  yield* journal.append(
    attempt.runId,
    plannedAttemptExecutorWorkResponsibilityBeganRecordKey(attempt.attemptId),
    PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
      plannedAttempt: attempt,
      version: workflowJournalEventVersion
    })
  )
  const commandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(1)
  yield* journal.append(
    attempt.runId,
    plannedAttemptExecutorCommandIntendedRecordKey(attempt.attemptId, commandOrdinal),
    PlannedAttemptExecutorCommandIntendedEvent.make({
      command: "StartOrContinue",
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      ordinal: commandOrdinal,
      plannedAttempt: attempt,
      version: workflowJournalEventVersion
    })
  )
  const reportOrdinal = PlannedAttemptExecutorReportOrdinal.make(1)
  yield* journal.append(
    attempt.runId,
    plannedAttemptExecutorWorkReportedRecordKey(attempt.attemptId, reportOrdinal),
    PlannedAttemptExecutorWorkReportedEvent.make({
      ordinal: reportOrdinal,
      report: PlannedAttemptExecutorReport.cases.Running.make({
        correlation: plannedAttemptExecutorCorrelation(attempt)
      }),
      version: workflowJournalEventVersion
    })
  )
})

const appendUnresolvedSuspension = Effect.fn("PauseProgressAcceptance.appendUnresolvedSuspension")(function* (
  journal: Journal["Service"],
  attempt: PlannedTaskAttempt
) {
  const ordinal = PlannedAttemptExecutorCommandOrdinal.make(2)
  yield* journal.append(
    attempt.runId,
    plannedAttemptExecutorCommandIntendedRecordKey(attempt.attemptId, ordinal),
    PlannedAttemptExecutorCommandIntendedEvent.make({
      command: "Suspend",
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      ordinal,
      plannedAttempt: attempt,
      version: workflowJournalEventVersion
    })
  )
})

const appendSafeSuspensionReport = Effect.fn("PauseProgressAcceptance.appendSafeSuspensionReport")(function* (
  journal: Journal["Service"],
  attempt: PlannedTaskAttempt
) {
  const ordinal = PlannedAttemptExecutorReportOrdinal.make(2)
  yield* journal.append(
    attempt.runId,
    plannedAttemptExecutorWorkReportedRecordKey(attempt.attemptId, ordinal),
    PlannedAttemptExecutorWorkReportedEvent.make({
      ordinal,
      report: PlannedAttemptExecutorReport.cases.SafelySuspended.make({
        correlation: plannedAttemptExecutorCorrelation(attempt)
      }),
      version: workflowJournalEventVersion
    })
  )
})

const executorFacts = (
  runId: RunId,
  taskId: TaskId,
  disposition: PlannedAttemptExecutorDisposition
): Extract<ResponsibilityFreshFacts, { readonly _tag: "PlannedAttemptExecutorFreshFacts" }> => ({
  _tag: "PlannedAttemptExecutorFreshFacts",
  disposition,
  responsibility: {
    _tag: "PlannedAttemptExecutorWorkResponsibility",
    beganAt: JournalPosition.make(10),
    plannedAttempt: plannedAttempt(runId, taskId)
  }
})

const suspensionProposal = (runId: RunId, taskId: TaskId, acceptedAt: JournalPosition): DeliveryActionProposal => {
  const facts = executorFacts(runId, taskId, ResponsibilityDisposition.PlannedAttemptExecutorSuspensionRequested())
  const proposal = deliveryProposalsOf({
    acceptedAt,
    acceptedOperationIds: new Set(),
    fresh: [],
    responsibilities: [facts.responsibility],
    runId,
    transitions: [
      RunnableFrontierTransition.SuspendPlannedAttemptExecutorWork({
        plannedAttempt: facts.responsibility.plannedAttempt
      })
    ]
  }).ticketDelivery[0]
  if (proposal === undefined) throw new Error("the Pause fixture must derive one exact Suspend proposal")
  return proposal
}

const graphState = (graph: TaskDagSnapshot, recordedAt: JournalPosition) =>
  TrackerGraphState.cases.GraphEstablished.make({
    observation: makeTestJournaledTrackerGraphObservation({
      operationId: OperationId.make(`pause-public-graph-${graph.revision}`),
      recordedAt,
      snapshot: graph
    })
  })

interface BundleInput {
  readonly acceptedAt: JournalPosition
  readonly evidence: DeliveryRelationInputBundle["publication"]["exactEvidence"]
  readonly graph: TaskDagSnapshot
  readonly paused: "Run" | "Task" | "Unpaused"
  readonly proposals?: ReadonlyArray<DeliveryActionProposal>
  readonly taskWork?: DeliveryRuntimeEvaluation["taskWork"]
}

const bundle = ({ acceptedAt, evidence, graph, paused, proposals = [], taskWork }: BundleInput) =>
  ({
    legacy: {
      proposalContributions: { deliverySettlement: [], issues: [], ticketDelivery: proposals },
      reflectionProposals: [],
      runtimeFacts: {
        acceptedAt,
        pauseCoverage: {
          _tag: "PauseCoverageGraphEstablished" as const,
          applied: {
            run: paused === "Run" ? { _tag: "RunPaused" as const } : { _tag: "RunUnpaused" as const },
            tasks:
              paused === "Task"
                ? { _tag: "TaskPauses" as const, taskIds: [TaskId.make("A")] }
                : { _tag: "NoTaskPauses" as const }
          },
          observedAt: acceptedAt,
          snapshot: graph
        },
        quiescence: { _tag: "QuiescencePassive" as const, reason: "RunPaused" as const },
        taskWork: taskWork ?? { capacity: policy.taskExecutionCapacity, held: [] }
      },
      trackerGraphProposals: []
    },
    publication: { exactEvidence: evidence, graph: graphState(graph, acceptedAt), policy }
  }) satisfies DeliveryRelationInputBundle

const dynamicBundle = Effect.fn("PauseProgressAcceptance.dynamicBundle")(function* (
  initial: DeliveryRelationInputBundle
) {
  const state = yield* SubscriptionRef.make(initial)
  return {
    signal: {
      changes: SubscriptionRef.changes(state),
      get: SubscriptionRef.get(state)
    } satisfies CurrentSignal<DeliveryRelationInputBundle>,
    publish: (next: DeliveryRelationInputBundle) => SubscriptionRef.set(state, next)
  }
})

const boundaryWorkflowInterpreter = (
  graph: TaskDagSnapshot,
  calls: Ref.Ref<BoundaryCalls>,
  reconcileTaskWorktree?: WorkflowInterpreter["Service"]["reconcileTaskWorktree"]
): WorkflowInterpreter["Service"] =>
  WorkflowInterpreter.of({
    acquireTaskClaim: () => increment(calls, "tracker").pipe(Effect.andThen(Effect.die("unexpected tracker mutation"))),
    readTaskClaim: () => increment(calls, "tracker").pipe(Effect.andThen(Effect.die("unexpected tracker read"))),
    readTaskWorktree: () => increment(calls, "git").pipe(Effect.andThen(Effect.die("unexpected Git read"))),
    readTargetLineage: () => increment(calls, "git").pipe(Effect.andThen(Effect.die("unexpected Git read"))),
    readTrackerGraph: () => increment(calls, "tracker").pipe(Effect.as(graph)),
    readTaskWorkSpecification: () =>
      increment(calls, "tracker").pipe(Effect.andThen(Effect.die("unexpected tracker read"))),
    releaseTaskClaim: () => increment(calls, "tracker").pipe(Effect.andThen(Effect.die("unexpected tracker mutation"))),
    reconcileTaskWorktree:
      reconcileTaskWorktree ??
      (() => increment(calls, "git").pipe(Effect.andThen(Effect.die("unexpected Git mutation")))),
    recordTaskAttemptPlan: () => Effect.die("unexpected plan recording")
  })

const plannedAttemptLayer = (runId: RunId) =>
  deterministicPlannedTaskAttemptLayer({
    baseSha: GitCommitSha.make("2".repeat(40)),
    executor: TaskExecutorLocator.make("executor:pause-public"),
    runId,
    worktreeRoot: WorktreeLocator.make("/pause-public/planned")
  })

const runtimeLayer = (
  runId: RunId,
  graph: TaskDagSnapshot,
  calls: Ref.Ref<BoundaryCalls>,
  reconcileTaskWorktree?: WorkflowInterpreter["Service"]["reconcileTaskWorktree"]
) =>
  Layer.mergeAll(
    Layer.effect(InRunJournal, InRunJournal),
    attemptChoiceControlLayer,
    controlDirectionApplicationLayer,
    Layer.succeed(
      PlannedAttemptExecutor,
      PlannedAttemptExecutor.of({
        project: () => increment(calls, "executor").pipe(Effect.andThen(Effect.die("unexpected executor projection"))),
        requestSuspension: () =>
          increment(calls, "executor").pipe(Effect.andThen(Effect.die("unexpected executor suspension"))),
        startOrContinue: () =>
          increment(calls, "executor").pipe(Effect.andThen(Effect.die("unexpected executor continuation")))
      })
    ),
    Layer.mock(RunRecoveryProjection, {
      _tag: "AuthoritativeRunRecoveryProjection",
      runId,
      readDeliveryProjection: Effect.succeed({
        evidence: { _tag: "UnavailableDeliveryProjectionEvidence" as const },
        frontier: { explanations: [], transitions: [] }
      }),
      reconstructedPlannedAttemptPositions: []
    }),
    taskWorkCapacityControlLayer,
    Layer.mock(TaskClaimAcquisitionPlanner, { plan: () => Effect.die("unexpected claim planning") }),
    taskClaimReacquisitionControlLayer,
    deterministicOperationIdAllocatorLayer(`pause-progress-public:${runId}`),
    plannedAttemptLayer(runId),
    Layer.mock(DeliveryRelationPublicationObserver, { observe: () => Effect.void }),
    plannedAttemptProtocolControllerLayer,
    journaledWorkflowInterpreterLayer(
      runId,
      Layer.succeed(WorkflowInterpreter, boundaryWorkflowInterpreter(graph, calls, reconcileTaskWorktree))
    ),
    Layer.mock(WorkflowTrace, { emit: () => Effect.void })
  )

const countingStore = (delegate: JournalStore["Service"], calls: Ref.Ref<BoundaryCalls>) =>
  JournalStore.of({
    beginRun: (...input) => increment(calls, "journalStore").pipe(Effect.andThen(delegate.beginRun(...input))),
    append: (...input) => increment(calls, "journalStore").pipe(Effect.andThen(delegate.append(...input))),
    read: (...input) => increment(calls, "journalStore").pipe(Effect.andThen(delegate.read(...input))),
    readRunForRecovery: (...input) =>
      increment(calls, "journalStore").pipe(Effect.andThen(delegate.readRunForRecovery(...input))),
    scan: () => increment(calls, "journalStore").pipe(Effect.andThen(delegate.scan())),
    terminateRun: (...input) => increment(calls, "journalStore").pipe(Effect.andThen(delegate.terminateRun(...input)))
  })

const buildBootstrap = Effect.fn("PauseProgressAcceptance.buildBootstrap")(function* (
  runId: AllocatedWorkflowRunId,
  graph: TaskDagSnapshot,
  storage: JournalStore["Service"],
  calls: Ref.Ref<BoundaryCalls>,
  reconcileTaskWorktree?: WorkflowInterpreter["Service"]["reconcileTaskWorktree"]
) {
  const capabilities = yield* Layer.build(journalStoreCapabilities(Layer.succeed(JournalStore, storage)))
  const ownership = CoordinatorOwnership.of({ release: Effect.void, runMutation: (mutation) => mutation })
  const application = journaledRunBootstrapLayer(
    runId,
    ({ runId }) => runtimeLayer(runId, graph, calls, reconcileTaskWorktree),
    yield* makeApplicationExitShell(ownership, { requestEnd: () => Effect.void })
  ).pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(JournalStore, storage),
        Layer.succeed(RunLifecycleJournal, Context.get(capabilities, RunLifecycleJournal)),
        Layer.succeed(CoordinatorOwnership, ownership)
      )
    )
  )
  return Context.get(yield* Layer.build(application), JournaledRunBootstrap)
})

const publishJournaledRuntimeObservation = Effect.fn("PauseProgressAcceptance.publishJournaledRuntimeObservation")(
  function* (runId: RunId) {
    const journal = yield* Journal
    const publication = yield* DeliveryRuntimeObservationPublication
    const resources = yield* DeliveryRuntimeResources
    const recovery = yield* makeRunRecoveryProjection(
      runId,
      undefined,
      undefined,
      undefined,
      resources.integrationTargets
    )
    const relations = yield* makeReactiveDeliveryRelationsLayer(
      runId,
      target,
      journal,
      recovery,
      resources.integrationTargets
    )
    const relation = yield* deliveryRuntime.pipe(Effect.provide(relations))
    const evaluation = yield* relation.get
    yield* publication.publish(evaluation, [])
    return evaluation
  }
)

const startRelationRuntime = Effect.fn("PauseProgressAcceptance.startRelationRuntime")(function* (
  bootstrap: JournaledRunBootstrap["Service"],
  runId: AllocatedWorkflowRunId,
  coherent: CurrentSignal<DeliveryRelationInputBundle>,
  executor: DeliveryActionExecutor["Service"] | "Live",
  entered: Deferred.Deferred<void>,
  keepActivationOpen: Deferred.Deferred<void>,
  integration?: {
    readonly release: Deferred.Deferred<void>
    readonly responsibility: Pick<StartedIntegrationResponsibility, "integrationTarget" | "queuedAt">
  },
  runtimeAccepted?: ReadonlyArray<{ readonly acceptedAt: JournalPosition; readonly observed: Deferred.Deferred<void> }>,
  beforeRuntime?: Effect.Effect<void, never, Journal>,
  livePublication: Effect.Effect<void> = Effect.void
) {
  return yield* bootstrap
    .activate(
      target,
      Effect.succeed(initialPolicy),
      runId,
      Effect.gen(function* () {
        if (beforeRuntime !== undefined) yield* beforeRuntime
        const resources = yield* DeliveryRuntimeResources
        if (integration !== undefined) {
          yield* resources.integrationTargets.acquire(integration.responsibility)
          yield* resources.integrationTargets.publishAcceptedOwnership(integration.responsibility)
          yield* Deferred.await(integration.release).pipe(
            Effect.andThen(resources.integrationTargets.release(integration.responsibility)),
            Effect.forkChild
          )
        }
        for (const accepted of runtimeAccepted ?? []) {
          yield* resources.runtimeObservation.changes.pipe(
            Stream.filter(
              (state) =>
                state._tag === "Ready" &&
                state.evaluation.acceptedAt !== null &&
                state.evaluation.acceptedAt >= accepted.acceptedAt
            ),
            Stream.take(1),
            Stream.runDrain,
            Effect.andThen(Deferred.succeed(accepted.observed, undefined)),
            Effect.forkChild
          )
        }
        const relation = yield* deliveryRuntime.pipe(
          Effect.provide(
            makeDeliveryRelationsLayer({
              coherent,
              publicationConsistency: { withStablePublication: <A, E, R>(effect: Effect.Effect<A, E, R>) => effect }
            })
          )
        )
        const actionExecutor =
          executor === "Live"
            ? yield* makeLiveDeliveryActionExecutor(runId, target).pipe(
                Effect.provideService(
                  TaskClaimAcquisitionPlanner,
                  TaskClaimAcquisitionPlanner.of({ plan: () => Effect.die("unexpected claim planning") })
                ),
                Effect.provideService(
                  DeliveryAcceptedFactPublication,
                  DeliveryAcceptedFactPublication.of({ awaitCurrent: livePublication })
                )
              )
            : executor
        yield* Deferred.succeed(entered, undefined)
        yield* runDeliveryRuntime(relation).pipe(Effect.provideService(DeliveryActionExecutor, actionExecutor))
        yield* Deferred.await(keepActivationOpen)
        return {
          acceptedAt: JournalPosition.make(1),
          decision: RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })
        }
      })
    )
    .pipe(Effect.provide(plannedAttemptLayer(runId)), Effect.forkChild)
})

const passiveActionExecutor = DeliveryActionExecutor.of({
  execute: () => Effect.die("a suspension proposal without its exact held position must not execute")
})

it.effect("shows Alice the exact Suspend changing from proposed to live before its executor boundary returns", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const runId = yield* freshWorkflowRunId(target)
      const graph = snapshot("pause-public-live-owner", null)
      const calls = yield* Ref.make(noBoundaryCalls)
      const memory = Context.get(yield* Layer.build(memoryJournalStoreLayer), JournalStore)
      const bootstrap = yield* buildBootstrap(runId, graph, countingStore(memory, calls), calls)
      const acceptedAt = JournalPosition.make(20)
      const proposal = suspensionProposal(runId, TaskId.make("A"), acceptedAt)
      const facts = executorFacts(
        runId,
        TaskId.make("A"),
        ResponsibilityDisposition.PlannedAttemptExecutorSuspensionRequested()
      )
      const relation = yield* dynamicBundle(
        bundle({
          acceptedAt,
          evidence: [{ _tag: "ResponsibilityFacts", facts }],
          graph,
          paused: "Task",
          proposals: [proposal],
          taskWork: {
            capacity: policy.taskExecutionCapacity,
            held: [
              {
                correlation: plannedAttemptExecutorCorrelation(facts.responsibility.plannedAttempt),
                taskId: facts.responsibility.plannedAttempt.taskId
              }
            ]
          }
        })
      )
      const beforeRuntimeEntered = yield* Deferred.make<void>()
      const allowRuntime = yield* Deferred.make<void>()
      const runtimeEntered = yield* Deferred.make<void>()
      const executorEntered = yield* Deferred.make<void>()
      const keepOpen = yield* Deferred.make<void>()
      const executor = DeliveryActionExecutor.of({
        execute: () => Deferred.succeed(executorEntered, undefined).pipe(Effect.andThen(Effect.never))
      })
      const activation = yield* startRelationRuntime(
        bootstrap,
        runId,
        relation.signal,
        executor,
        runtimeEntered,
        keepOpen,
        undefined,
        undefined,
        Effect.gen(function* () {
          yield* Deferred.succeed(beforeRuntimeEntered, undefined)
          yield* Deferred.await(allowRuntime)
        })
      )
      yield* Effect.raceFirst(
        Deferred.await(beforeRuntimeEntered),
        Fiber.join(activation).pipe(Effect.andThen(Effect.die("activation ended before runtime setup")))
      )
      yield* bootstrap.operatorControl.applyControlDirection({
        direction: "Pause",
        subject: { _tag: "Task", runId, taskId: TaskId.make("A") }
      })
      const observed = yield* bootstrap.operatorControl
        .observePause({ _tag: "Task", runId, taskId: TaskId.make("A") })
        .pipe(Stream.take(2), Stream.runCollect, Effect.forkChild)
      yield* Deferred.succeed(allowRuntime, undefined)
      yield* Effect.raceFirst(
        Deferred.await(runtimeEntered),
        Fiber.join(activation).pipe(Effect.andThen(Effect.die("activation ended before delivery runtime")))
      )
      yield* Effect.raceFirst(
        Deferred.await(executorEntered),
        Fiber.join(activation).pipe(Effect.andThen(Effect.die("activation ended before Suspend executor")))
      )
      const views = Array.from(yield* Fiber.join(observed))
      expect(views.map(({ _tag }) => _tag)).toEqual(["PauseWaiting", "PauseWaiting"])
      const blockerTags = views.map((view) =>
        view._tag === "PauseWaiting"
          ? view.preventing.flatMap((boundary) => pauseSafeBoundaryBlockersOf(boundary).map(({ _tag }) => _tag))
          : []
      )
      expect(blockerTags).toEqual([
        ["ExecutorSafeSuspensionRequired", "ProposedDeliveryAction"],
        ["ExecutorSafeSuspensionRequired", "LiveDeliveryAction"]
      ])
      for (const view of views) {
        if (view._tag !== "PauseWaiting") continue
        const actionBlocker = view.preventing
          .flatMap(pauseSafeBoundaryBlockersOf)
          .find(({ _tag }) => _tag === "ProposedDeliveryAction" || _tag === "LiveDeliveryAction")
        expect(
          actionBlocker?._tag === "ProposedDeliveryAction"
            ? actionBlocker.proposal
            : actionBlocker?._tag === "LiveDeliveryAction"
              ? actionBlocker.owner.proposal
              : undefined
        ).toEqual(proposal)
      }
      yield* Fiber.interrupt(activation)
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("updates Alice's public task Pause view as accepted executor and Git facts reach their boundaries", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const runId = yield* freshWorkflowRunId(target)
      const graph = snapshot("pause-public-G1", "A")
      const calls = yield* Ref.make(noBoundaryCalls)
      const memory = Context.get(yield* Layer.build(memoryJournalStoreLayer), JournalStore)
      const bootstrap = yield* buildBootstrap(runId, graph, countingStore(memory, calls), calls)
      const acceptedAt = JournalPosition.make(50)
      const aAttempt = plannedAttempt(runId, TaskId.make("A"))
      const dAttempt = plannedAttempt(runId, TaskId.make("D"))
      const integration = StartedIntegrationResponsibility.make({
        acceptedResult: acceptedResultFixture(GitCommitSha.make("3".repeat(40))),
        integrationTarget: IntegrationTarget.make({
          repository: GitRepositoryLocator.make("/pause-public/integration.git"),
          ref: IntegrationTargetRef.make("refs/heads/main")
        }),
        plannedAttempt: dAttempt,
        queuedAt: JournalPosition.make(40),
        startedAt: JournalPosition.make(41)
      })
      const candidateId = IntegrationCandidateId.make("pause-public-D-candidate")
      const candidateCommit = GitCommitSha.make("4".repeat(40))
      const candidateCorrelation = IntegrationCandidateCorrelation.make({
        acceptanceManifest: integration.acceptedResult.evidenceManifest,
        acceptedResultCommit: integration.acceptedResult.commit,
        attemptId: dAttempt.attemptId,
        candidateId,
        candidateResource: IntegrationCandidateResourceLocator.make("/pause-public/candidate-D"),
        expectedTargetHead: dAttempt.baseSha,
        integrationSessionId: IntegrationSessionId.make("pause-public-D-session"),
        integrationTarget: integration.integrationTarget,
        runId
      })
      const verificationCorrelation = TargetVerificationCorrelation.make({
        candidateCommit,
        candidateConstructedAt: JournalPosition.make(42),
        candidateCorrelation,
        planId: TargetVerificationPlanId.make("pause-public-D-plan"),
        requestId: TargetVerificationRequestId.make("pause-public-D-verification")
      })
      const promotionRequest = TargetPromotionCorrelation.make({
        acceptanceManifest: integration.acceptedResult.evidenceManifest,
        candidateCommit,
        candidateConstructedAt: verificationCorrelation.candidateConstructedAt,
        candidateCorrelation,
        expectedTargetHead: dAttempt.baseSha,
        integrationTarget: integration.integrationTarget,
        requestId: TargetPromotionRequestId.make(`target-promotion:${candidateId}`),
        reviewManifest: integration.acceptedResult.evidenceManifest,
        verificationCorrelation,
        verificationManifest: integration.acceptedResult.evidenceManifest
      })
      const promotion = TargetPromotionState.cases.PromotionPending.make({
        correlation: promotionRequest,
        retry: TargetPromotionPendingRetry.cases.NeedInitialReconciliationRead.make({})
      })
      const initial = bundle({
        acceptedAt,
        evidence: [
          {
            _tag: "ResponsibilityFacts",
            facts: executorFacts(
              runId,
              TaskId.make("A"),
              ResponsibilityDisposition.PlannedAttemptExecutorSuspensionRequested()
            )
          },
          { _tag: "StartedIntegration", responsibility: integration },
          { _tag: "TargetPromotion", responsibility: integration, state: promotion }
        ],
        graph,
        paused: "Unpaused",
        proposals: [suspensionProposal(runId, TaskId.make("A"), acceptedAt)]
      })
      const relation = yield* dynamicBundle(initial)
      const entered = yield* Deferred.make<void>()
      const keepOpen = yield* Deferred.make<void>()
      const releaseIntegration = yield* Deferred.make<void>()
      const activation = yield* startRelationRuntime(
        bootstrap,
        runId,
        relation.signal,
        passiveActionExecutor,
        entered,
        keepOpen,
        { release: releaseIntegration, responsibility: integration }
      )
      yield* Deferred.await(entered)
      yield* bootstrap.operatorControl.applyControlDirection({
        direction: "Pause",
        subject: { _tag: "Task", runId, taskId: TaskId.make("A") }
      })
      yield* relation.publish({
        ...initial,
        legacy: {
          ...initial.legacy,
          runtimeFacts: {
            ...initial.legacy.runtimeFacts,
            pauseCoverage: {
              ...initial.legacy.runtimeFacts.pauseCoverage,
              applied: { run: { _tag: "RunUnpaused" }, tasks: { _tag: "TaskPauses", taskIds: [TaskId.make("A")] } }
            }
          }
        }
      })

      const first = yield* Deferred.make<void>()
      const observing = yield* bootstrap.operatorControl
        .observePause({ _tag: "Task", runId, taskId: TaskId.make("A") })
        .pipe(
          Stream.tap(() => Deferred.succeed(first, undefined)),
          Stream.runCollect,
          Effect.forkChild
        )
      yield* Deferred.await(first)
      yield* Deferred.succeed(releaseIntegration, undefined)
      yield* Effect.yieldNow
      yield* relation.publish(
        bundle({
          acceptedAt: JournalPosition.make(51),
          evidence: [
            {
              _tag: "ResponsibilityFacts",
              facts: executorFacts(
                runId,
                TaskId.make("A"),
                ResponsibilityDisposition.PlannedAttemptExecutorWorkSafelySuspended({
                  correlation: plannedAttemptExecutorCorrelation(aAttempt)
                })
              )
            },
            { _tag: "StartedIntegration", responsibility: integration }
          ],
          graph,
          paused: "Task"
        })
      )
      const views = Array.from(yield* Fiber.join(observing))

      expect(views.map(({ _tag }) => _tag)).toEqual(["PauseWaiting", "PauseWaiting", "PauseConfirmed"])
      expect(views[0]).toMatchObject({
        preventing: [
          { responsibility: { taskId: "A" } },
          {
            blockers: [
              { _tag: "TargetPromotionResultRequired", request: promotionRequest },
              { _tag: "HeldIntegrationTarget" }
            ],
            responsibility: { taskId: "D" }
          }
        ]
      })
      expect(views[1]).toMatchObject({
        preventing: [
          { responsibility: { taskId: "A" } },
          {
            blockers: [{ _tag: "TargetPromotionResultRequired", request: promotionRequest }],
            responsibility: { taskId: "D" }
          }
        ]
      })
      expect(views[2]).toMatchObject({
        atBoundary: [{ responsibility: { taskId: "A" } }, { responsibility: { taskId: "D" } }]
      })
      yield* Deferred.succeed(keepOpen, undefined)
      yield* Fiber.join(activation)
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("adds G2's newly grouped running descendant and rejects its pre-G2 safe report", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const runId = yield* freshWorkflowRunId(target)
      const g1 = snapshot("pause-public-independent-G1", null)
      const g2 = snapshot("pause-public-grouped-G2", "A")
      const calls = yield* Ref.make(noBoundaryCalls)
      const memory = Context.get(yield* Layer.build(memoryJournalStoreLayer), JournalStore)
      const bootstrap = yield* buildBootstrap(runId, g2, countingStore(memory, calls), calls)
      const aRequested = {
        _tag: "ResponsibilityFacts" as const,
        facts: executorFacts(
          runId,
          TaskId.make("A"),
          ResponsibilityDisposition.PlannedAttemptExecutorSuspensionRequested()
        )
      }
      const dSafeBeforeG2 = {
        _tag: "ResponsibilityFacts" as const,
        facts: executorFacts(
          runId,
          TaskId.make("D"),
          ResponsibilityDisposition.PlannedAttemptExecutorWorkSafelySuspended({
            correlation: plannedAttemptExecutorCorrelation(plannedAttempt(runId, TaskId.make("D")))
          })
        )
      }
      const g1AcceptedAt = JournalPosition.make(60)
      const aProposal = suspensionProposal(runId, TaskId.make("A"), g1AcceptedAt)
      const relation = yield* dynamicBundle(
        bundle({
          acceptedAt: g1AcceptedAt,
          evidence: [aRequested, dSafeBeforeG2],
          graph: g1,
          paused: "Unpaused",
          proposals: [aProposal]
        })
      )
      const entered = yield* Deferred.make<void>()
      const keepOpen = yield* Deferred.make<void>()
      const runtimeAcceptedG2 = yield* Deferred.make<void>()
      const activation = yield* startRelationRuntime(
        bootstrap,
        runId,
        relation.signal,
        passiveActionExecutor,
        entered,
        keepOpen,
        undefined,
        [{ acceptedAt: JournalPosition.make(61), observed: runtimeAcceptedG2 }]
      )
      yield* Deferred.await(entered)
      yield* bootstrap.operatorControl.applyControlDirection({
        direction: "Pause",
        subject: { _tag: "Task", runId, taskId: TaskId.make("A") }
      })
      yield* relation.publish(
        bundle({
          acceptedAt: g1AcceptedAt,
          evidence: [aRequested, dSafeBeforeG2],
          graph: g1,
          paused: "Task",
          proposals: [aProposal]
        })
      )

      const first = yield* Deferred.make<void>()
      const g2Observed = yield* Deferred.make<void>()
      const emissionCount = yield* Ref.make(0)
      const observing = yield* bootstrap.operatorControl
        .observePause({ _tag: "Task", runId, taskId: TaskId.make("A") })
        .pipe(
          Stream.tap(() =>
            Ref.getAndUpdate(emissionCount, (count) => count + 1).pipe(
              Effect.flatMap((index) =>
                index === 0 ? Deferred.succeed(first, undefined) : Deferred.succeed(g2Observed, undefined)
              )
            )
          ),
          Stream.runCollect,
          Effect.forkChild
        )
      yield* Deferred.await(first)
      const g2AcceptedAt = JournalPosition.make(61)
      yield* relation.publish(
        bundle({
          acceptedAt: g2AcceptedAt,
          evidence: [aRequested, dSafeBeforeG2],
          graph: g2,
          paused: "Task",
          proposals: [aProposal, suspensionProposal(runId, TaskId.make("D"), g2AcceptedAt)]
        })
      )
      yield* Deferred.await(runtimeAcceptedG2)
      yield* Deferred.await(g2Observed)
      yield* relation.publish(
        bundle({
          acceptedAt: JournalPosition.make(62),
          evidence: [
            {
              _tag: "ResponsibilityFacts",
              facts: executorFacts(
                runId,
                TaskId.make("A"),
                ResponsibilityDisposition.PlannedAttemptExecutorWorkSafelySuspended({
                  correlation: plannedAttemptExecutorCorrelation(plannedAttempt(runId, TaskId.make("A")))
                })
              )
            },
            {
              _tag: "ResponsibilityFacts",
              facts: executorFacts(
                runId,
                TaskId.make("D"),
                ResponsibilityDisposition.PlannedAttemptExecutorWorkSafelySuspended({
                  correlation: plannedAttemptExecutorCorrelation(plannedAttempt(runId, TaskId.make("D")))
                })
              )
            }
          ],
          graph: g2,
          paused: "Task"
        })
      )
      const views = Array.from(yield* Fiber.join(observing))

      expect(views.map(({ _tag }) => _tag)).toEqual(["PauseWaiting", "PauseWaiting", "PauseConfirmed"])
      expect(views[0]).toMatchObject({ preventing: [{ responsibility: { taskId: "A" } }] })
      expect(views[1]).toMatchObject({
        preventing: [
          { responsibility: { taskId: "A" } },
          {
            blockers: [{ _tag: "ProposedDeliveryAction" }],
            responsibility: {
              coverage: { _tag: "GroupingDescendantPauseCoverage", groupingObservedAt: g2AcceptedAt },
              taskId: "D"
            }
          }
        ]
      })
      yield* Deferred.succeed(keepOpen, undefined)
      yield* Fiber.join(activation)
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("keeps Alice's subscription through a later activation that confirms G2's grouped descendant", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const runId = yield* freshWorkflowRunId(target)
      const g1 = snapshot("pause-public-activation-G1", null)
      const g2 = snapshot("pause-public-activation-G2", "A")
      const calls = yield* Ref.make(noBoundaryCalls)
      const memory = Context.get(yield* Layer.build(memoryJournalStoreLayer), JournalStore)
      const bootstrap = yield* buildBootstrap(runId, g1, countingStore(memory, calls), calls)
      const aAttempt = plannedAttempt(runId, TaskId.make("A"))
      const dAttempt = plannedAttempt(runId, TaskId.make("D"))
      const firstReady = yield* Deferred.make<void>()
      const publishWaiting = yield* Deferred.make<void>()
      const waitingPublished = yield* Deferred.make<void>()
      const finishFirst = yield* Deferred.make<void>()
      const firstIntegrationTargets = yield* Deferred.make<DeliveryRuntimeResources["Service"]["integrationTargets"]>()
      const firstActivation = yield* bootstrap
        .activate(
          target,
          Effect.succeed(initialPolicy),
          runId,
          Effect.gen(function* () {
            const journal = yield* Journal
            const resources = yield* DeliveryRuntimeResources
            yield* Deferred.succeed(firstIntegrationTargets, resources.integrationTargets)
            const graphRead = makeTrackerGraphObservationOperation(
              OperationId.make("pause-public-across-activation-read-G1"),
              target
            )
            yield* journal.append(runId, intentRecordKey(graphRead.operationId), taskTrackerReadIntent(graphRead))
            yield* journal.append(
              runId,
              outcomeRecordKey(graphRead.operationId),
              makeTaskTrackerFactsObservedFromRead(yield* journal.read(runId), graphRead, g1)
            )
            yield* appendRunningAttempt(journal, aAttempt)
            yield* appendRunningAttempt(journal, dAttempt)
            yield* Deferred.succeed(firstReady, undefined)
            yield* Deferred.await(publishWaiting)
            yield* appendUnresolvedSuspension(journal, aAttempt)
            yield* publishJournaledRuntimeObservation(runId)
            yield* Deferred.succeed(waitingPublished, undefined)
            yield* Deferred.await(finishFirst)
            return {
              acceptedAt: JournalPosition.make(1),
              decision: RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })
            }
          })
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(firstReady)
      yield* bootstrap.operatorControl.applyControlDirection({
        direction: "Pause",
        subject: { _tag: "Task", runId, taskId: TaskId.make("A") }
      })
      yield* Deferred.succeed(publishWaiting, undefined)
      yield* Effect.raceFirst(
        Deferred.await(waitingPublished),
        Fiber.join(firstActivation).pipe(Effect.andThen(Effect.die("first activation ended before publishing Waiting")))
      )

      const waitingSeen = yield* Deferred.make<void>()
      const confirmedSeen = yield* Deferred.make<void>()
      const observing = yield* bootstrap.operatorControl
        .observePause({ _tag: "Task", runId, taskId: TaskId.make("A") })
        .pipe(
          Stream.tap((view) =>
            view._tag === "PauseConfirmed"
              ? Deferred.succeed(confirmedSeen, undefined)
              : Deferred.succeed(waitingSeen, undefined)
          ),
          Stream.runCollect,
          Effect.forkChild
        )
      yield* Deferred.await(waitingSeen)
      yield* Deferred.succeed(finishFirst, undefined)
      expect(yield* Fiber.join(firstActivation)).toEqual({
        _tag: "RunMustRemainActive",
        reason: "UnsettledResponsibility"
      })
      expect(observing.pollUnsafe()).toBeUndefined()

      const secondPublished = yield* Deferred.make<void>()
      const finishSecond = yield* Deferred.make<void>()
      const secondActivation = yield* bootstrap
        .activate(
          target,
          Effect.die("the later activation must reconstruct the existing initial policy"),
          runId,
          Effect.gen(function* () {
            const journal = yield* Journal
            const resources = yield* DeliveryRuntimeResources
            expect(resources.integrationTargets).toBe(yield* Deferred.await(firstIntegrationTargets))
            const graphRead = makeTrackerGraphObservationOperation(
              OperationId.make("pause-public-across-activation-read-G2"),
              target
            )
            yield* journal.append(runId, intentRecordKey(graphRead.operationId), taskTrackerReadIntent(graphRead))
            yield* journal.append(
              runId,
              outcomeRecordKey(graphRead.operationId),
              makeTaskTrackerFactsObservedFromRead(yield* journal.read(runId), graphRead, g2)
            )
            yield* appendUnresolvedSuspension(journal, dAttempt)
            yield* appendSafeSuspensionReport(journal, aAttempt)
            yield* appendSafeSuspensionReport(journal, dAttempt)
            yield* publishJournaledRuntimeObservation(runId)
            yield* Deferred.succeed(secondPublished, undefined)
            yield* Deferred.await(finishSecond)
            return {
              acceptedAt: JournalPosition.make(1),
              decision: RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })
            }
          })
        )
        .pipe(Effect.forkChild)
      yield* Effect.raceFirst(
        Deferred.await(secondPublished),
        Fiber.join(secondActivation).pipe(
          Effect.andThen(Effect.die("second activation ended before publishing Confirmed"))
        )
      )
      yield* Deferred.await(confirmedSeen)
      const views = Array.from(yield* Fiber.join(observing))

      expect(views.map(({ _tag }) => _tag)).toEqual(["PauseWaiting", "PauseConfirmed"])
      expect(views[0]).toMatchObject({ preventing: [{ responsibility: { taskId: "A" } }] })
      expect(views[1]).toMatchObject({
        atBoundary: [
          { responsibility: { taskId: "A" } },
          { responsibility: { coverage: { _tag: "GroupingDescendantPauseCoverage" }, taskId: "D" } }
        ]
      })
      const acceptedRecords = yield* memory.read(runId)
      const g2Position = acceptedRecords.find(
        ({ event }) =>
          event._tag === "TaskTrackerFactsObserved" &&
          event.operationId === OperationId.make("pause-public-across-activation-read-G2")
      )?.position
      const dSafePosition = acceptedRecords.find(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkReported" &&
          event.report._tag === "SafelySuspended" &&
          event.report.correlation.attemptId === dAttempt.attemptId
      )?.position
      expect(dSafePosition).toBeGreaterThan(g2Position ?? Number.MAX_SAFE_INTEGER)

      yield* Deferred.succeed(finishSecond, undefined)
      expect(yield* Fiber.join(secondActivation)).toEqual({
        _tag: "RunMustRemainActive",
        reason: "UnsettledResponsibility"
      })
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("Alice disconnects while Run R reaches its existing planned-worktree safe boundary", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const runId = yield* freshWorkflowRunId(target)
      const graph = snapshot("pause-public-reconnect", null)
      const calls = yield* Ref.make(noBoundaryCalls)
      const memory = Context.get(yield* Layer.build(memoryJournalStoreLayer), JournalStore)
      const gitEntered = yield* Deferred.make<void>()
      const finishGit = yield* Deferred.make<void>()
      const attempt = plannedAttempt(runId, TaskId.make("A"))
      const worktreeProof = PlannedWorktreeReady.make({
        baseSha: attempt.baseSha,
        branch: attempt.branch,
        headSha: attempt.baseSha,
        worktree: attempt.worktree
      })
      const bootstrap = yield* buildBootstrap(runId, graph, countingStore(memory, calls), calls, () =>
        increment(calls, "git").pipe(
          Effect.andThen(Deferred.succeed(gitEntered, undefined)),
          Effect.andThen(Deferred.await(finishGit)),
          Effect.as({ _tag: "AuthoritativeTaskWorktreeReady" as const, proof: worktreeProof })
        )
      )
      const acceptedAt = JournalPosition.make(70)
      const planOperationId = OperationId.make("pause-public-disconnect-plan")
      const plan = makeTaskAttemptPlanOperation({
        operationId: planOperationId,
        plannedAttempt: attempt,
        predecessorOperationIds: []
      })
      const operationId = OperationId.make(`pause-progress-public:${runId}:0`)
      const operation = makeTaskWorktreeReconciliationOperation({
        operationId,
        plannedAttempt: attempt,
        predecessorOperationIds: [planOperationId]
      })
      const responsibility = WorkflowResponsibilityEntry.cases.TaskWorktreeResponsibility.make({
        beganAt: JournalPosition.make(69),
        operation,
        taskId: attempt.taskId
      })
      const unresolved = {
        _tag: "ResponsibilityFacts" as const,
        facts: {
          _tag: "WorkflowOperationFreshFacts" as const,
          disposition: ResponsibilityDisposition.Ready(),
          responsibility
        }
      }
      const transition = RunnableFrontierTransition.ReconcileTaskWorktree({ operationId, taskId: attempt.taskId })
      const proposal = deliveryProposalsOf({
        acceptedAt,
        acceptedOperationIds: new Set([operationId]),
        fresh: [],
        responsibilities: [responsibility],
        runId,
        transitions: [transition]
      }).ticketDelivery[0]
      if (proposal === undefined) return yield* Effect.die("the ordinary delivery relation must propose OW")
      const relation = yield* dynamicBundle(
        bundle({ acceptedAt, evidence: [unresolved], graph, paused: "Unpaused", proposals: [proposal] })
      )
      const entered = yield* Deferred.make<void>()
      const keepOpen = yield* Deferred.make<void>()
      const pauseAccepted = yield* Deferred.make<void>()
      const outcomeAccepted = yield* Deferred.make<void>()
      const outcomePublished = yield* Deferred.make<void>()
      const activation = yield* startRelationRuntime(
        bootstrap,
        runId,
        relation.signal,
        "Live",
        entered,
        keepOpen,
        undefined,
        [
          { acceptedAt: JournalPosition.make(71), observed: pauseAccepted },
          { acceptedAt: JournalPosition.make(72), observed: outcomeAccepted }
        ],
        Effect.gen(function* () {
          const journal = yield* Journal
          yield* journal.append(
            runId,
            attemptPlanRecordKey(attempt.attemptId),
            TaskAttemptPlannedEvent.make({ operation: plan, version: workflowJournalEventVersion })
          )
          yield* journal.append(
            runId,
            intentRecordKey(operationId),
            TaskWorktreeReconciliationIntendedEvent.make({ operation, version: workflowJournalEventVersion })
          )
        }).pipe(Effect.orDie),
        relation
          .publish(bundle({ acceptedAt: JournalPosition.make(72), evidence: [], graph, paused: "Run" }))
          .pipe(Effect.andThen(Deferred.succeed(outcomePublished, undefined)))
      )
      yield* Deferred.await(entered)
      yield* relation.publish(
        bundle({ acceptedAt, evidence: [unresolved], graph, paused: "Unpaused", proposals: [proposal] })
      )
      yield* Effect.raceFirst(
        Deferred.await(gitEntered),
        Fiber.join(activation).pipe(Effect.andThen(Effect.die("activation ended before OW crossed Git")))
      )
      const intentRecords = (yield* memory.read(runId)).filter(
        ({ event }) =>
          event._tag === "TaskWorktreeReconciliationIntended" && event.operation.operationId === operationId
      )
      expect(intentRecords).toHaveLength(1)
      expect(intentRecords[0]?.event).toEqual(
        TaskWorktreeReconciliationIntendedEvent.make({ operation, version: workflowJournalEventVersion })
      )
      yield* bootstrap.operatorControl.applyControlDirection({ direction: "Pause", subject: { _tag: "Run", runId } })
      yield* relation.publish(
        bundle({
          acceptedAt: JournalPosition.make(71),
          evidence: [unresolved],
          graph,
          paused: "Run",
          proposals: [proposal]
        })
      )
      yield* Deferred.await(pauseAccepted)
      const timers = yield* Ref.make(0)
      const ambientClock = yield* Clock.Clock
      const observingClock = Clock.Clock.of({
        currentTimeMillis: ambientClock.currentTimeMillis,
        currentTimeMillisUnsafe: () => ambientClock.currentTimeMillisUnsafe(),
        currentTimeNanos: ambientClock.currentTimeNanos,
        currentTimeNanosUnsafe: () => ambientClock.currentTimeNanosUnsafe(),
        monotonicTimeNanos: ambientClock.monotonicTimeNanos,
        monotonicTimeNanosUnsafe: () => ambientClock.monotonicTimeNanosUnsafe(),
        sleep: () => Ref.update(timers, (count) => count + 1).pipe(Effect.andThen(Effect.never))
      })

      const first = yield* Deferred.make<void>()
      const observed = yield* Ref.make<ReadonlyArray<PauseProgressView>>([])
      const disconnected = yield* bootstrap.operatorControl.observePause({ _tag: "Run", runId }).pipe(
        Stream.tap((view) =>
          Ref.update(observed, (views) => [...views, view]).pipe(Effect.andThen(Deferred.succeed(first, undefined)))
        ),
        Stream.runDrain,
        Effect.provideService(Clock.Clock, observingClock),
        Effect.forkChild
      )
      yield* Effect.raceFirst(
        Deferred.await(first),
        Fiber.join(disconnected).pipe(Effect.andThen(Effect.die("observer ended without Waiting")))
      )
      yield* Effect.yieldNow
      const [waiting] = yield* Ref.get(observed)
      expect(waiting).toMatchObject({
        _tag: "PauseWaiting",
        preventing: [
          {
            blockers: [{ _tag: "LiveDeliveryAction" }],
            responsibility: {
              obligation: { _tag: "WorkflowResponsibility", responsibility: { operation, taskId: attempt.taskId } },
              taskId: attempt.taskId
            }
          }
        ]
      })
      const callsWhileWaiting = yield* Ref.get(calls)
      const timersWhileWaiting = yield* Ref.get(timers)
      expect(callsWhileWaiting).toMatchObject({ executor: 0, git: 1, tracker: 0 })
      expect(timersWhileWaiting).toBe(0)
      const recordsWhileWaiting = yield* memory.read(runId)
      expect(
        recordsWhileWaiting.filter(
          ({ event }) => event._tag === "TaskWorktreeReady" && event.operationId === operationId
        )
      ).toHaveLength(0)
      yield* Fiber.interrupt(disconnected)
      const activationState = activation.pollUnsafe()
      const callsAfterDisconnect = yield* Ref.get(calls)
      expect(activationState).toBeUndefined()
      expect(callsAfterDisconnect).toEqual(callsWhileWaiting)
      expect(yield* memory.read(runId)).toEqual(recordsWhileWaiting)

      yield* Deferred.succeed(finishGit, undefined)
      yield* Deferred.await(outcomePublished)
      yield* Deferred.await(outcomeAccepted)

      const recordsBeforeReconnect = yield* memory.read(runId)
      const reconnected = Array.from(
        yield* bootstrap.operatorControl.observePause({ _tag: "Run", runId }).pipe(Stream.runCollect)
      )
      expect(reconnected.map(({ _tag }) => _tag)).toEqual(["PauseConfirmed"])
      const finalRecords = yield* memory.read(runId)
      expect(finalRecords).toEqual(recordsBeforeReconnect)
      const finalTags = finalRecords.map(({ event }) => event._tag)
      expect(finalRecords.filter(({ event }) => event._tag === "TaskWorktreeReconciliationIntended")).toHaveLength(1)
      expect(finalRecords.map(({ event }) => event).filter(({ _tag }) => _tag === "TaskWorktreeReady")).toEqual([
        expect.objectContaining({ operationId, proof: worktreeProof })
      ])
      expect(finalTags).not.toContain("AttemptImplementationAbandoned")
      expect(finalTags).not.toContain("PauseWaiting")
      expect(yield* Ref.get(calls)).toMatchObject({ executor: 0, git: 1, tracker: 0 })
      expect(yield* Ref.get(timers)).toBe(0)
      yield* Fiber.interrupt(activation)
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect(
  "ends Alice's waiting task Pause observation after real Operator Unpause without cancelling its exact suspension",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const runId = yield* freshWorkflowRunId(target)
        const graph = snapshot("pause-public-unpause-before-confirmation", null)
        const calls = yield* Ref.make(noBoundaryCalls)
        const memory = Context.get(yield* Layer.build(memoryJournalStoreLayer), JournalStore)
        const bootstrap = yield* buildBootstrap(runId, graph, countingStore(memory, calls), calls)
        const acceptedAt = JournalPosition.make(80)
        const requested = {
          _tag: "ResponsibilityFacts" as const,
          facts: executorFacts(
            runId,
            TaskId.make("A"),
            ResponsibilityDisposition.PlannedAttemptExecutorSuspensionRequested()
          )
        }
        const pending = suspensionProposal(runId, TaskId.make("A"), acceptedAt)
        const relation = yield* dynamicBundle(
          bundle({ acceptedAt, evidence: [requested], graph, paused: "Unpaused", proposals: [pending] })
        )
        const entered = yield* Deferred.make<void>()
        const keepOpen = yield* Deferred.make<void>()
        const activation = yield* startRelationRuntime(
          bootstrap,
          runId,
          relation.signal,
          passiveActionExecutor,
          entered,
          keepOpen
        )
        yield* Deferred.await(entered)
        yield* bootstrap.operatorControl.applyControlDirection({
          direction: "Pause",
          subject: { _tag: "Task", runId, taskId: TaskId.make("A") }
        })
        yield* relation.publish(
          bundle({ acceptedAt, evidence: [requested], graph, paused: "Task", proposals: [pending] })
        )

        const waiting = yield* Deferred.make<void>()
        const observing = yield* bootstrap.operatorControl
          .observePause({ _tag: "Task", runId, taskId: TaskId.make("A") })
          .pipe(
            Stream.tap((view) => (view._tag === "PauseWaiting" ? Deferred.succeed(waiting, undefined) : Effect.void)),
            Stream.runCollect,
            Effect.forkChild
          )
        yield* Deferred.await(waiting)

        yield* bootstrap.operatorControl.applyControlDirection({
          direction: "Unpause",
          subject: { _tag: "Task", runId, taskId: TaskId.make("A") }
        })
        yield* relation.publish(
          bundle({
            acceptedAt: JournalPosition.make(81),
            evidence: [requested],
            graph,
            paused: "Unpaused",
            proposals: []
          })
        )

        const views = Array.from(yield* Fiber.join(observing))
        expect(views.map(({ _tag }) => _tag)).toEqual(["PauseWaiting", "PauseNoLongerApplied"])
        expect(
          (yield* relation.signal.get).publication.exactEvidence.some(
            (evidence) =>
              evidence._tag === "ResponsibilityFacts" &&
              evidence.facts.responsibility._tag === "PlannedAttemptExecutorWorkResponsibility" &&
              evidence.facts.responsibility.plannedAttempt.attemptId ===
                plannedAttempt(runId, TaskId.make("A")).attemptId &&
              evidence.facts.disposition._tag === "PlannedAttemptExecutorSuspensionRequested"
          )
        ).toBe(true)
        expect(yield* Ref.get(calls)).toMatchObject({ executor: 0, git: 0 })
        expect(
          (yield* memory.read(runId))
            .filter(({ event }) => event._tag === "ControlDirectionApplied")
            .map(({ event }) => (event._tag === "ControlDirectionApplied" ? event.direction : null))
        ).toEqual(["Pause", "Unpause"])
        expect(
          yield* bootstrap.operatorControl
            .observePause({ _tag: "Task", runId, taskId: TaskId.make("A") })
            .pipe(Stream.runDrain, Effect.flip)
        ).toMatchObject({ _tag: "PauseNotApplied", subject: { _tag: "Task", taskId: "A" } })

        yield* Deferred.succeed(keepOpen, undefined)
        yield* Fiber.join(activation)
      })
    ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("ends Alice's old subscription on coordinator death, then restarts G2 for a fresh A and D view", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const runId = yield* freshWorkflowRunId(target)
      const g2 = snapshot("pause-public-restart-G2", "A")
      const calls = yield* Ref.make(noBoundaryCalls)
      const memory = Context.get(yield* Layer.build(memoryJournalStoreLayer), JournalStore)
      const aAttempt = plannedAttempt(runId, TaskId.make("A"))
      const dAttempt = plannedAttempt(runId, TaskId.make("D"))
      const firstBootstrapScope = yield* Scope.make()
      const firstBootstrap = yield* buildBootstrap(runId, g2, countingStore(memory, calls), calls).pipe(
        Scope.provide(firstBootstrapScope)
      )
      const durableBasisReady = yield* Deferred.make<void>()
      const appendSuspensions = yield* Deferred.make<void>()
      const suspensionsDurable = yield* Deferred.make<void>()
      const firstActivation = yield* firstBootstrap
        .activate(
          target,
          Effect.succeed(initialPolicy),
          runId,
          Effect.gen(function* () {
            const journal = yield* Journal
            yield* appendRunningAttempt(journal, aAttempt)
            yield* appendRunningAttempt(journal, dAttempt)
            const graphRead = makeTrackerGraphObservationOperation(
              OperationId.make("pause-public-restart-read-G2"),
              target
            )
            yield* journal.append(runId, intentRecordKey(graphRead.operationId), taskTrackerReadIntent(graphRead))
            yield* journal.append(
              runId,
              outcomeRecordKey(graphRead.operationId),
              makeTaskTrackerFactsObservedFromRead(yield* journal.read(runId), graphRead, g2)
            )
            yield* Deferred.succeed(durableBasisReady, undefined)
            yield* Deferred.await(appendSuspensions)
            yield* appendUnresolvedSuspension(journal, aAttempt)
            yield* appendUnresolvedSuspension(journal, dAttempt)
            yield* Deferred.succeed(suspensionsDurable, undefined)
            return yield* Effect.never
          })
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(durableBasisReady)
      yield* firstBootstrap.operatorControl.applyControlDirection({
        direction: "Pause",
        subject: { _tag: "Task", runId, taskId: TaskId.make("A") }
      })
      yield* Deferred.succeed(appendSuspensions, undefined)
      yield* Deferred.await(suspensionsDurable)
      const interruptedObservation = yield* firstBootstrap.operatorControl
        .observePause({ _tag: "Task", runId, taskId: TaskId.make("A") })
        .pipe(Stream.runDrain, Effect.forkChild)
      yield* Effect.yieldNow
      expect(interruptedObservation.pollUnsafe()).toBeUndefined()
      yield* Fiber.interrupt(firstActivation)
      yield* Scope.close(firstBootstrapScope, Exit.void)
      yield* Fiber.join(interruptedObservation)

      const durableBeforeRestart = yield* memory.read(runId)
      const g2Position = durableBeforeRestart.find(
        ({ event }) => event._tag === "TaskTrackerFactsObserved" && event.operationId === "pause-public-restart-read-G2"
      )?.position
      expect(g2Position).toBeDefined()
      const dSuspensionPosition = durableBeforeRestart.find(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorCommandIntended" &&
          event.command === "Suspend" &&
          event.plannedAttempt.attemptId === dAttempt.attemptId
      )?.position
      expect(dSuspensionPosition).toBeGreaterThan(g2Position ?? Number.MAX_SAFE_INTEGER)

      const secondBootstrap = yield* buildBootstrap(runId, g2, countingStore(memory, calls), calls)
      const runtimeReady = yield* Deferred.make<void>()
      const keepSecondOpen = yield* Deferred.make<void>()
      const secondActivation = yield* secondBootstrap
        .activate(
          target,
          Effect.die("restart must reconstruct the existing initial policy"),
          runId,
          Effect.gen(function* () {
            const journal = yield* Journal
            const resources = yield* DeliveryRuntimeResources
            const recovery = yield* makeRunRecoveryProjection(runId)
            const relations = yield* makeReactiveDeliveryRelationsLayer(
              runId,
              target,
              journal,
              recovery,
              resources.integrationTargets
            )
            const relation = yield* deliveryRuntime.pipe(Effect.provide(relations))
            const observeReady = yield* resources.runtimeObservation.changes.pipe(
              Stream.filter(({ _tag }) => _tag === "Ready"),
              Stream.take(1),
              Stream.runDrain,
              Effect.andThen(Deferred.succeed(runtimeReady, undefined)),
              Effect.forkChild
            )
            const runtime = yield* runDeliveryRuntime(relation).pipe(
              Effect.provideService(DeliveryActionExecutor, DeliveryActionExecutor.of({ execute: () => Effect.never })),
              Effect.forkChild
            )
            yield* Deferred.await(runtimeReady)
            yield* Deferred.await(keepSecondOpen)
            yield* Fiber.interrupt(runtime)
            yield* Fiber.interrupt(observeReady)
            return {
              acceptedAt: (yield* journal.state.get).position,
              decision: RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })
            }
          })
        )
        .pipe(Effect.provide(plannedAttemptLayer(runId)), Effect.forkChild)
      yield* Deferred.await(runtimeReady)

      const recordsBeforeObservation = yield* memory.read(runId)
      const view = Array.from(
        yield* secondBootstrap.operatorControl
          .observePause({ _tag: "Task", runId, taskId: TaskId.make("A") })
          .pipe(Stream.take(1), Stream.runCollect)
      )[0]
      expect(view?._tag).toBe("PauseWaiting")
      if (view?._tag !== "PauseWaiting") return yield* Effect.die("restart must derive a waiting Pause view")
      expect(
        [...view.atBoundary, ...view.preventing].map(({ responsibility }) => responsibility.taskId).toSorted()
      ).toEqual(["A", "D"])
      expect(view.preventing).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            blockers: expect.arrayContaining([
              expect.objectContaining({
                _tag: "ExecutorSafeSuspensionRequired",
                correlation: plannedAttemptExecutorCorrelation(dAttempt)
              })
            ]),
            responsibility: expect.objectContaining({
              coverage: expect.objectContaining({ _tag: "GroupingDescendantPauseCoverage", pausedTaskId: "A" }),
              taskId: "D"
            })
          })
        ])
      )
      expect(yield* memory.read(runId)).toEqual(recordsBeforeObservation)
      expect(recordsBeforeObservation.map(({ event }) => event._tag)).not.toContain("PauseWaiting")

      yield* Deferred.succeed(keepSecondOpen, undefined)
      yield* Fiber.join(secondActivation)
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)
