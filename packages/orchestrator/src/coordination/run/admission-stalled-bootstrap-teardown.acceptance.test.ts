import {
  AttemptId,
  GitCommitSha,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorLifecycleObservation,
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
import { Context, Deferred, Effect, Exit, Fiber, Layer, Ref, SubscriptionRef } from "effect"
import { expect } from "vitest"
import { CoordinatorOwnership } from "../../authorities/coordinator-ownership/ownership.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { InitialControlPolicy, initialRunPolicyRevision, RunControlPolicy } from "../../control/policy.js"
import { taskWorkCapacityControlLayer } from "../../control/task-work-capacity.js"
import { WorkflowInterpreter, WorkflowTrace } from "../../workflow/interpretation/interpreter.js"
import { OperationId } from "../../workflow/identity.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import { journaledWorkflowInterpreterLayer } from "../../workflow-journal/journaled-interpreter.js"
import { memoryJournalStoreLayer } from "../../workflow-journal/adapters/memory-store.js"
import { attemptPlanRecordKey } from "../../workflow-journal/record-key.js"
import {
  InRunJournal,
  JournalStore,
  RunLifecycleJournal,
  journalStoreCapabilities,
  type JournalStoreService
} from "../../workflow-journal/store.js"
import { attemptChoiceControlLayer } from "../../workflow/protocols/attempt-choice/control.js"
import { controlDirectionApplicationLayer } from "../../workflow/protocols/control-direction-application/protocol.js"
import { taskClaimReacquisitionControlLayer } from "../../workflow/protocols/task-claim-reacquisition/control.js"
import {
  deterministicOperationIdAllocatorLayer,
  deterministicPlannedTaskAttemptLayer
} from "../../workflow/protocols/task-attempt-planning/plan.js"
import { TaskAttemptPlannedEvent } from "../../workflow/registry/event.js"
import { makeTaskAttemptPlanOperation } from "../../workflow/registry/operation.js"
import { DispositionCleanupActivation } from "../../workflow/protocols/disposition-cleanup/loop.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { makeApplicationExitShell } from "../application-exit/application-shell.js"
import { DeliveryAcceptedFactPublication } from "../delivery/delivery-accepted-fact-publication.js"
import { DeliveryActionExecutor } from "../delivery/delivery-action-executor.js"
import { deliveryRuntime } from "../delivery/delivery-runtime-adapter.js"
import { DeliveryRuntimeResources } from "../delivery/delivery-runtime-resources.js"
import { deterministicDeliveryRuntimeSupport, makeDeliveryRelationsLayer } from "../delivery/in-memory-relations.js"
import { executeFreshPlannedAttempt } from "../delivery/planned-attempt-delivery-action-adapter.js"
import {
  currentSignalFromCurrentFirstStream,
  type DeliveryRelationInputBundle,
  type DeliveryRuntimeEvaluation,
  TrackerGraphState
} from "../delivery/relations.js"
import type { RunFinalityProof } from "../frontier/frontier.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { noopJournalMaintenanceObservation } from "../../workflow-journal/maintenance.js"
import { makePreparedBeginFixture, preparedBeginProposalsOf } from "../../../test/support/prepared-begin-proposal.js"
import { freshWorkflowRunId } from "./fresh-run-identity.js"
import { journaledRunBootstrapLayer } from "./journaled-run-bootstrap.js"
import {
  PassivePlannedAttemptObserver,
  PassivePlannedAttemptProjectionPublication
} from "./passive-planned-attempt-observer.js"
import { RunRecoveryProjection } from "./recovery-activation.js"
import { JournaledRunBootstrap } from "./run.js"
import { runStabilizedDelivery } from "./run-stabilization.js"

const target = FixtureTarget.make("admission-stalled-bootstrap-teardown")
const initialPolicy = InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(3) })
const runtimePolicy = RunControlPolicy.make({
  revision: initialRunPolicyRevision,
  taskExecutionCapacity: initialPolicy.taskExecutionCapacity
})

interface BoundaryCounts {
  readonly executorBegin: number
  readonly git: number
  readonly integrationAcquire: number
  readonly journalAppend: number
  readonly releaseAll: number
  readonly tracker: number
}

const noBoundaryCounts: BoundaryCounts = {
  executorBegin: 0,
  git: 0,
  integrationAcquire: 0,
  journalAppend: 0,
  releaseAll: 0,
  tracker: 0
}

const increment = (counts: Ref.Ref<BoundaryCounts>, key: keyof BoundaryCounts) =>
  Ref.update(counts, (current) => ({ ...current, [key]: current[key] + 1 }))

const countingJournalStore = (delegate: JournalStoreService, counts: Ref.Ref<BoundaryCounts>) =>
  JournalStore.of({
    ...delegate,
    append: (...input) => increment(counts, "journalAppend").pipe(Effect.andThen(delegate.append(...input)))
  })

const baseAttempt = (runId: RunId) =>
  PlannedTaskAttempt.make({
    attemptId: AttemptId.make("admission-stalled-bootstrap-base-attempt"),
    baseSha: GitCommitSha.make("1".repeat(40)),
    branch: TaskBranchRef.make("refs/heads/dalph/admission-stalled-bootstrap-base"),
    executor: TaskExecutorLocator.make("executor:admission-stalled-bootstrap"),
    runId,
    taskId: TaskId.make("admission-stalled-bootstrap-base-task"),
    taskRevision: TaskRevision.make("admission-stalled-bootstrap-base-revision"),
    worktree: WorktreeLocator.make("/admission-stalled-bootstrap/base")
  })

const bundle = (
  acceptedAt: JournalPosition,
  proposals: DeliveryRelationInputBundle["actionInputs"]["proposalContributions"]["ticketDelivery"],
  held: DeliveryRuntimeEvaluation["taskWork"]["held"]
): DeliveryRelationInputBundle => ({
  actionInputs: {
    proposalContributions: { deliverySettlement: [], issues: [], ticketDelivery: proposals },
    reflectionProposals: [],
    runtimeFacts: {
      acceptedAt,
      cancellationApplied: false,
      pauseCoverage: {
        _tag: "PauseCoverageGraphNotEstablished",
        applied: { run: { _tag: "RunUnpaused" }, tasks: { _tag: "NoTaskPauses" } }
      },
      quiescence: { _tag: "TrackerReconfirmationAllowed" },
      taskWork: { capacity: runtimePolicy.taskExecutionCapacity, held }
    },
    trackerGraphProposals: []
  },
  publication: { exactEvidence: [], graph: TrackerGraphState.cases.GraphNotEstablished.make({}), policy: runtimePolicy }
})

const runtimeLayer = (
  runId: RunId,
  executor: PlannedAttemptExecutor["Service"],
  interpreter: WorkflowInterpreter["Service"],
  runtimeFinalizers: Ref.Ref<number>
) =>
  Layer.mergeAll(
    Layer.effectDiscard(Effect.addFinalizer(() => Ref.update(runtimeFinalizers, (count) => count + 1))),
    Layer.effect(InRunJournal, InRunJournal),
    attemptChoiceControlLayer,
    controlDirectionApplicationLayer,
    Layer.succeed(PlannedAttemptExecutor, executor),
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
    taskClaimReacquisitionControlLayer,
    deterministicOperationIdAllocatorLayer(`admission-stalled-bootstrap:${runId}`),
    journaledWorkflowInterpreterLayer(runId, Layer.succeed(WorkflowInterpreter, interpreter)),
    Layer.mock(WorkflowTrace, { emit: () => Effect.void }),
    Layer.succeed(
      DispositionCleanupActivation,
      DispositionCleanupActivation.of({
        responsibilities: { branch: [], candidate: [], worktree: [] },
        run: Effect.die("the focused teardown does not run disposition cleanup")
      })
    )
  )

it.effect("returns admission-stalled finality through production bootstrap teardown", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const runId = yield* freshWorkflowRunId(target)
      const [a, b, c, d, e] = ["A", "B", "C", "D", "E"].map((name) =>
        makePreparedBeginFixture(baseAttempt(runId), "admission-stalled-bootstrap", name)
      )
      if (a === undefined || b === undefined || c === undefined || d === undefined || e === undefined) {
        return yield* Effect.die("the focused teardown requires five exact prepared attempts")
      }
      const [beginC, blockedD, blockedE] = preparedBeginProposalsOf(runId, [c, d, e])
      if (beginC === undefined || blockedD === undefined || blockedE === undefined) {
        return yield* Effect.die("C, D, and E must each produce one production Begin proposal")
      }
      const blocked = [blockedD, blockedE] as const
      const heldAB = [a, b].map(({ attempt }) => ({
        correlation: plannedAttemptExecutorCorrelation(attempt),
        taskId: attempt.taskId
      }))
      const bundles = yield* SubscriptionRef.make(bundle(JournalPosition.make(1), [beginC, ...blocked], heldAB))
      const coherent = currentSignalFromCurrentFirstStream(SubscriptionRef.changes(bundles))
      const counts = yield* Ref.make(noBoundaryCounts)
      const phaseCompleted = yield* Deferred.make<{
        readonly registeredOwners: number
        readonly preparingOwners: number
        readonly counts: BoundaryCounts
        readonly proof: RunFinalityProof
      }>()
      const releaseProgram = yield* Deferred.make<void>()
      const relationFinalizers = yield* Ref.make(0)
      const runtimeFinalizers = yield* Ref.make(0)

      const plannedAttemptExecutor = PlannedAttemptExecutor.of({
        begin: ({ plannedAttempt }) =>
          plannedAttempt.attemptId === c.attempt.attemptId
            ? increment(counts, "executorBegin").pipe(
                Effect.as(
                  PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
                    correlation: plannedAttemptExecutorCorrelation(c.attempt)
                  })
                )
              )
            : Effect.die("D and E must remain outside the executor boundary"),
        observe: () => Effect.die("the controlled C completion reuses its accepted executing report"),
        requestSuspension: () => Effect.die("the focused teardown does not suspend work"),
        resume: () => Effect.die("the focused teardown does not resume work")
      })
      const interpreter = WorkflowInterpreter.of({
        acquireTaskClaim: () => increment(counts, "tracker").pipe(Effect.andThen(Effect.die("unexpected claim"))),
        readTaskClaim: () => increment(counts, "tracker").pipe(Effect.andThen(Effect.die("unexpected claim read"))),
        readTaskWorktree: () => increment(counts, "git").pipe(Effect.andThen(Effect.die("unexpected Git read"))),
        readTargetLineage: () => increment(counts, "git").pipe(Effect.andThen(Effect.die("unexpected Git read"))),
        readTrackerGraph: () =>
          increment(counts, "tracker").pipe(Effect.andThen(Effect.die("the admission stall must not start G2"))),
        readTaskWorkSpecification: () =>
          increment(counts, "tracker").pipe(Effect.andThen(Effect.die("unexpected tracker read"))),
        releaseTaskClaim: () =>
          increment(counts, "tracker").pipe(Effect.andThen(Effect.die("unexpected tracker mutation"))),
        reconcileTaskWorktree: () =>
          increment(counts, "git").pipe(Effect.andThen(Effect.die("unexpected Git mutation"))),
        recordTaskAttemptPlan: () => Effect.die("the exact C attempt is already planned")
      })
      const ownership = CoordinatorOwnership.of({ release: Effect.void, runMutation: (mutation) => mutation })
      const applicationExit = yield* makeApplicationExitShell(ownership, { requestEnd: () => Effect.void })
      const memory = Context.get(yield* Layer.build(memoryJournalStoreLayer), JournalStore)
      const storage = countingJournalStore(memory, counts)
      yield* storage.beginRun(runId, target, initialPolicy)
      const cPlan = makeTaskAttemptPlanOperation({
        operationId: OperationId.make("admission-stalled-bootstrap-plan-C"),
        plannedAttempt: c.attempt,
        predecessorOperationIds: []
      })
      const planned = yield* storage.append(
        runId,
        attemptPlanRecordKey(c.attempt.attemptId),
        TaskAttemptPlannedEvent.make({ operation: cPlan, version: workflowJournalEventVersion })
      )
      yield* SubscriptionRef.set(bundles, bundle(planned.position, [beginC, ...blocked], heldAB))
      const journalCapabilities = yield* Layer.build(journalStoreCapabilities(Layer.succeed(JournalStore, storage)))
      const bootstrapLayer = journaledRunBootstrapLayer(
        runId,
        ({ runId: activeRunId }) => runtimeLayer(activeRunId, plannedAttemptExecutor, interpreter, runtimeFinalizers),
        applicationExit,
        noopJournalMaintenanceObservation
      ).pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(JournalStore, storage),
            Layer.succeed(RunLifecycleJournal, Context.get(journalCapabilities, RunLifecycleJournal)),
            Layer.succeed(CoordinatorOwnership, ownership),
            Layer.mock(PlannedAttemptExecutorLifecycleObservation, {})
          )
        )
      )
      const bootstrap = Context.get(yield* Layer.build(bootstrapLayer), JournaledRunBootstrap)
      const program = Effect.gen(function* () {
        const relation = yield* deliveryRuntime.pipe(
          Effect.provide(
            makeDeliveryRelationsLayer({ ...deterministicDeliveryRuntimeSupport(runtimePolicy), coherent })
          )
        )
        const journal = yield* InRunJournal
        const actionExecutor = DeliveryActionExecutor.of({
          execute: (action, lease) => {
            if (
              action._tag !== "IdentityFreeAction" ||
              action.proposal.id !== beginC.id ||
              action.proposal.route._tag !== "FreshExecutorWorkflowRoute"
            ) {
              return Effect.die("only C may cross the delivery action boundary")
            }
            const executing = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({
              correlation: plannedAttemptExecutorCorrelation(c.attempt)
            })
            return executeFreshPlannedAttempt(action, action.proposal.route, lease).pipe(
              Effect.provideService(InRunJournal, journal),
              Effect.provideService(PlannedAttemptExecutor, plannedAttemptExecutor),
              Effect.provideService(
                PassivePlannedAttemptObserver,
                PassivePlannedAttemptObserver.of({
                  attach: () => Effect.succeed({ acceptedFacts: "UnchangedPassiveObservation", report: executing })
                })
              ),
              Effect.provideService(
                PassivePlannedAttemptProjectionPublication,
                PassivePlannedAttemptProjectionPublication.of({
                  publish: () => Effect.die("C's reused executing report needs no publication"),
                  publishWithPermit: () => Effect.die("C's reused executing report needs no publication")
                })
              )
            )
          }
        })
        const resources = yield* DeliveryRuntimeResources
        const countedResources = DeliveryRuntimeResources.of({
          ...resources,
          integrationTargets: {
            ...resources.integrationTargets,
            acquire: (responsibility) =>
              increment(counts, "integrationAcquire").pipe(
                Effect.andThen(resources.integrationTargets.acquire(responsibility))
              ),
            releaseAll: increment(counts, "releaseAll").pipe(Effect.andThen(resources.integrationTargets.releaseAll))
          }
        })
        const publication = DeliveryAcceptedFactPublication.of({
          awaitCurrent: Effect.gen(function* () {
            const records = yield* journal.read(runId).pipe(Effect.orDie)
            const acceptedThrough = records.at(-1)?.position
            if (acceptedThrough === undefined) return yield* Effect.die("C must publish one accepted Journal prefix")
            yield* SubscriptionRef.set(bundles, bundle(acceptedThrough, blocked, heldAB))
            return { _tag: "DeliveryAcceptedPublicationBoundary" as const, acceptedThrough, runId }
          })
        })
        const proof = yield* Effect.acquireUseRelease(
          Effect.succeed(relation),
          (current) =>
            runStabilizedDelivery(target, runId, current).pipe(
              Effect.provideService(DeliveryRuntimeResources, countedResources),
              Effect.provideService(DeliveryActionExecutor, actionExecutor),
              Effect.provideService(DeliveryAcceptedFactPublication, publication)
            ),
          () => Ref.update(relationFinalizers, (count) => count + 1)
        )
        const admission = yield* applicationExit.admission.snapshot
        yield* Deferred.succeed(phaseCompleted, {
          registeredOwners: admission.registeredOwnerCount,
          preparingOwners: admission.preparingOwnerCount,
          counts: yield* Ref.get(counts),
          proof
        })
        yield* Deferred.await(releaseProgram)
        return proof
      })
      const closedProgram = program.pipe(
        Effect.provide(
          deterministicPlannedTaskAttemptLayer({
            baseSha: GitCommitSha.make("2".repeat(40)),
            executor: TaskExecutorLocator.make("executor:admission-stalled-bootstrap-planner"),
            runId,
            worktreeRoot: WorktreeLocator.make("/admission-stalled-bootstrap/planned")
          })
        )
      )
      const activation = yield* bootstrap
        .activate(target, Effect.succeed(initialPolicy), runId, closedProgram)
        .pipe(Effect.orDie, Effect.forkChild)
      const cut = yield* Effect.raceFirst(
        Deferred.await(phaseCompleted).pipe(Effect.map((phase) => ({ _tag: "PhaseCompleted" as const, phase }))),
        Fiber.await(activation).pipe(Effect.map((exit) => ({ _tag: "ActivationExited" as const, exit })))
      )
      expect(
        cut._tag,
        cut._tag === "ActivationExited" && Exit.isFailure(cut.exit) ? String(cut.exit.cause) : undefined
      ).toBe("PhaseCompleted")
      if (cut._tag !== "PhaseCompleted") return
      const phase = cut.phase
      expect(phase.proof.decision).toEqual({ _tag: "RunMustRemainActive", reason: "RunnableTransition" })
      expect(phase.preparingOwners).toBe(0)
      expect(phase.registeredOwners).toBe(1)
      expect(phase.counts).toMatchObject({ executorBegin: 1, git: 0, integrationAcquire: 0, releaseAll: 1, tracker: 0 })
      expect(yield* Ref.get(relationFinalizers)).toBe(1)
      expect(yield* Ref.get(runtimeFinalizers)).toBe(0)

      yield* Deferred.succeed(releaseProgram, undefined)
      expect(yield* Fiber.join(activation)).toEqual({ _tag: "RunMustRemainActive", reason: "RunnableTransition" })
      expect(yield* Ref.get(runtimeFinalizers)).toBe(1)
      expect(yield* Ref.get(relationFinalizers)).toBe(1)
      expect(yield* Ref.get(counts)).toEqual(phase.counts)
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)
