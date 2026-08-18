import { PlannedAttemptExecutor, RunId, TaskId } from "@dalph/contracts"
import { it } from "@effect/vitest"
import { NodeCrypto } from "@effect/platform-node"
import { Context, Deferred, Effect, Exit, Fiber, Layer, Option, Ref, Scope, Stream } from "effect"
import { expect } from "vitest"
import { TestClock } from "effect/testing"
import { CoordinatorOwnership } from "../../authorities/coordinator-ownership/ownership.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import {
  TrackerAdapterReadContext,
  TrackerAdapterReadError,
  TrackerAdapterReadFailureReason,
  TrackerGraphReader
} from "../../authorities/task-tracker/graph-reader.js"
import { TaskDagSnapshot } from "../../authorities/task-tracker/graph.js"
import { TrackerRevision, TrackerSnapshot } from "../../authorities/task-tracker/task.js"
import { InitialControlPolicy, initialRunPolicyRevision, RunControlPolicy } from "../../control/policy.js"
import { taskWorkCapacityControlLayer } from "../../control/task-work-capacity.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { Journal } from "../delivery/journal.js"
import { DeliveryRuntimeObservationPublication } from "../delivery/delivery-runtime-observation.js"
import { deliveryRuntime } from "../delivery/delivery-runtime-adapter.js"
import { deterministicDeliveryRuntimeSupport, makeDeliveryRelationsLayer } from "../delivery/in-memory-relations.js"
import { currentSignalOf, type DeliveryRelationInputBundle, TrackerGraphState } from "../delivery/relations.js"
import { RunFinalityDecision } from "../frontier/frontier.js"
import { memoryJournalStoreLayer } from "../../workflow-journal/adapters/memory-store.js"
import {
  InRunJournal,
  JournalStorageUnavailable,
  JournalStore,
  journalStoreCapabilities,
  RunLifecycleJournal,
  WorkflowRunAlreadyTerminated,
  WorkflowRunTargetMismatch
} from "../../workflow-journal/store.js"
import { OperationId } from "../../workflow/identity.js"
import { plannedAttemptProtocolControllerLayer } from "../../workflow/protocols/planned-attempt-executor-work/protocol-controller.js"
import { taskTrackerReadIntent } from "../../workflow/registry/event.js"
import { projectWorkflowOccurrences } from "../../workflow/registry/occurrence-projection.js"
import { makeTrackerGraphObservationOperation } from "../../workflow/registry/operation.js"
import {
  integrationQuarantinedRecordKey,
  integratorRunResultRecordedRecordKey,
  integratorRunStartedRecordKey,
  intentRecordKey
} from "../../workflow-journal/record-key.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { AllocatedWorkflowRunId, freshWorkflowRunId } from "./fresh-run-identity.js"
import { RunRecoveryProjection } from "./recovery-activation.js"
import { JournaledRunBootstrap } from "./run.js"
import { journaledRunBootstrapLayer } from "./journaled-run-bootstrap.js"
import {
  type ApplicationExitShellService,
  type ApplicationProcessLifecycleService,
  makeApplicationExitShell
} from "../application-exit/application-shell.js"
import { ApplicationExitDiagnostic, ApplicationExitResult } from "../application-exit/lifecycle-decision.js"
import { WorkflowInterpreter, WorkflowTrace } from "../../workflow/interpretation/interpreter.js"
import { controlDirectionApplicationLayer } from "../../workflow/protocols/control-direction-application/protocol.js"
import { attemptChoiceControlLayer } from "../../workflow/protocols/attempt-choice/control.js"
import { taskClaimReacquisitionControlLayer } from "../../workflow/protocols/task-claim-reacquisition/control.js"
import { TaskClaimReacquisitionRequestId } from "../../workflow/protocols/task-claim-reacquisition/events.js"
import {
  IntegrationQuarantineBasis,
  IntegrationQuarantineCause,
  IntegrationQuarantineDirectionFingerprint,
  IntegrationQuarantineDirectionRequestId,
  IntegrationQuarantineResultEvidence,
  IntegrationQuarantinedEvent
} from "../../workflow/protocols/integration-quarantine/events.js"
import {
  IntegratorNotPreparedDetail,
  IntegratorRunResultRecordedEvent,
  IntegratorRunStartedEvent,
  IntegratorResult
} from "../../workflow/protocols/integrator/events.js"
import { integrationFinalityFixture } from "../../workflow/protocols/integration-finality/fixtures.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import { deterministicOperationIdAllocatorLayer } from "../../workflow/protocols/task-attempt-planning/plan.js"
import { journaledWorkflowInterpreterLayer } from "../../workflow-journal/journaled-interpreter.js"

const initialPolicy = InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(2) })
const runtimePolicy = RunControlPolicy.make({
  revision: initialRunPolicyRevision,
  taskExecutionCapacity: initialPolicy.taskExecutionCapacity
})
const finalityProof = (
  decision:
    | ReturnType<typeof RunFinalityDecision.RunMayTerminate>
    | ReturnType<typeof RunFinalityDecision.RunMustRemainActive>
) => ({ acceptedAt: JournalPosition.make(1), decision })
const defaultOwnership = CoordinatorOwnership.of({ release: Effect.void, runMutation: (mutation) => mutation })
const emptyGraph = TaskDagSnapshot.project(
  TrackerSnapshot.make({ revision: TrackerRevision.make("bootstrap-control-empty"), tasks: [] })
)
if (emptyGraph._tag !== "Valid") throw new Error("bootstrap control fixture graph must project")

const defaultTrackerGraphReader = TrackerGraphReader.of({
  read: () => Effect.succeed(emptyGraph.snapshot),
  readTaskWorkSpecification: () => Effect.die("unused")
})

const unpausedRuntimeEvaluation = Effect.gen(function* () {
  const runtime = yield* deliveryRuntime.pipe(
    Effect.provide(
      makeDeliveryRelationsLayer({
        ...deterministicDeliveryRuntimeSupport(runtimePolicy),
        coherent: currentSignalOf({
          legacy: {
            proposalContributions: { deliverySettlement: [], issues: [], ticketDelivery: [] },
            reflectionProposals: [],
            runtimeFacts: {
              acceptedAt: null,
              pauseCoverage: {
                _tag: "PauseCoverageGraphNotEstablished",
                applied: { run: { _tag: "RunUnpaused" }, tasks: { _tag: "NoTaskPauses" } }
              },
              quiescence: { _tag: "TrackerReconfirmationAllowed" },
              taskWork: { capacity: runtimePolicy.taskExecutionCapacity, held: [] }
            },
            trackerGraphProposals: []
          },
          publication: {
            exactEvidence: [],
            graph: TrackerGraphState.cases.GraphNotEstablished.make({}),
            policy: runtimePolicy
          }
        } satisfies DeliveryRelationInputBundle)
      })
    )
  )
  return yield* runtime.get
})

const runtimeLayer = (runId: RunId, trackerGraphReader: TrackerGraphReader["Service"] = defaultTrackerGraphReader) =>
  Layer.mergeAll(
    Layer.effect(InRunJournal, InRunJournal),
    attemptChoiceControlLayer,
    controlDirectionApplicationLayer,
    Layer.mock(PlannedAttemptExecutor, {}),
    Layer.mock(RunRecoveryProjection, {
      _tag: "AuthoritativeRunRecoveryProjection",
      runId: RunId.make("bootstrap-fixture"),
      readDeliveryProjection: Effect.succeed({
        evidence: { _tag: "UnavailableDeliveryProjectionEvidence" as const },
        frontier: { explanations: [], transitions: [] }
      }),
      reconstructedPlannedAttemptPositions: []
    }),
    taskWorkCapacityControlLayer,
    taskClaimReacquisitionControlLayer,
    deterministicOperationIdAllocatorLayer(`bootstrap-control:${runId}`),
    plannedAttemptProtocolControllerLayer,
    journaledWorkflowInterpreterLayer(
      runId,
      Layer.mock(WorkflowInterpreter, { readTrackerGraph: (operation) => trackerGraphReader.read(operation.target) })
    ),
    Layer.mock(WorkflowTrace, { emit: () => Effect.void })
  )

const buildBootstrap = Effect.fn("JournaledRunBootstrapTest.build")(function* (
  expectedRunId: RunId,
  storage: JournalStore["Service"],
  trackerGraphReader: TrackerGraphReader["Service"] = defaultTrackerGraphReader,
  applicationExit?: ApplicationExitShellService,
  processLifecycle?: ApplicationProcessLifecycleService,
  ownership: CoordinatorOwnership["Service"] = defaultOwnership
) {
  const journalContext = yield* Layer.build(journalStoreCapabilities(Layer.succeed(JournalStore, storage)))
  const dependencies = Layer.mergeAll(
    Layer.succeed(JournalStore, storage),
    Layer.succeed(RunLifecycleJournal, Context.get(journalContext, RunLifecycleJournal)),
    Layer.succeed(CoordinatorOwnership, ownership)
  )
  const sharedApplicationExit =
    applicationExit ??
    (yield* makeApplicationExitShell(ownership, processLifecycle ?? { requestEnd: () => Effect.void }))
  const application = journaledRunBootstrapLayer(
    expectedRunId,
    ({ runId }) => runtimeLayer(runId, trackerGraphReader),
    sharedApplicationExit
  ).pipe(Layer.provide(dependencies))
  const bootstrap = Context.get(yield* Layer.build(application), JournaledRunBootstrap)
  return { ...bootstrap, applicationExitRequestBoundary: sharedApplicationExit.requestBoundary }
})

it.effect("an idle application Exit closes its runtime, releases the coordinator lock, and journals no Exit fact", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-idle-exit")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      const runtimeActive = yield* Deferred.make<void>()
      const lockReleased = yield* Deferred.make<void>()
      const requestedStatus = yield* Deferred.make<number>()
      const chronology = yield* Ref.make<Array<string>>([])
      const ownership = CoordinatorOwnership.of({
        release: Ref.update(chronology, (events) => [...events, "coordinator-lock-released"]).pipe(
          Effect.andThen(Deferred.succeed(lockReleased, undefined)),
          Effect.asVoid
        ),
        runMutation: (mutation) => mutation
      })
      const applicationExit = yield* makeApplicationExitShell(ownership, {
        requestEnd: ({ status }) =>
          Ref.update(chronology, (events) => [...events, "process-end-requested"]).pipe(
            Effect.andThen(Deferred.succeed(requestedStatus, status)),
            Effect.asVoid
          )
      })
      const bootstrap = yield* buildBootstrap(
        runId,
        storage,
        defaultTrackerGraphReader,
        applicationExit,
        undefined,
        ownership
      )
      const running = yield* bootstrap
        .activate(
          target,
          Effect.succeed(initialPolicy),
          runId,
          Deferred.succeed(runtimeActive, undefined).pipe(
            Effect.andThen(applicationExit.awaitExitRequested),
            Effect.as(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" }))),
            Effect.ensuring(Ref.update(chronology, (events) => [...events, "runtime-closed"]))
          )
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(runtimeActive)

      const result = yield* bootstrap.applicationExitRequestBoundary.requestExit

      expect(result).toMatchObject({ _tag: "Succeeded", requestedStatus: 0 })
      expect(yield* Deferred.isDone(lockReleased)).toBe(true)
      expect(yield* Deferred.await(requestedStatus)).toBe(0)
      expect(yield* Ref.get(chronology)).toEqual([
        "runtime-closed",
        "coordinator-lock-released",
        "process-end-requested"
      ])
      expect(yield* Fiber.join(running)).toEqual({ _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" })
      const records = yield* storage.read(runId)
      expect(records.map(({ event }) => event._tag)).toEqual(["WorkflowRunBegan"])
      expect((yield* projectWorkflowOccurrences(records)).occurrences).toEqual([])
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("keeps the active Run alive until its exact executor-family Exit drain finishes", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-executor-exit-drain")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      const runtimeActive = yield* Deferred.make<void>()
      const executorDrainStarted = yield* Deferred.make<void>()
      const releaseExecutorDrain = yield* Deferred.make<void>()
      const applicationExit = yield* makeApplicationExitShell(defaultOwnership, { requestEnd: () => Effect.void })
      const observedApplicationExit: ApplicationExitShellService = {
        ...applicationExit,
        awaitExecutorDrains: applicationExit.awaitExecutorDrains,
        registerExecutorDrain: (drain) =>
          applicationExit.registerExecutorDrain({
            suspendRunningExecutorWork: Deferred.succeed(executorDrainStarted, undefined).pipe(
              Effect.andThen(Deferred.await(releaseExecutorDrain)),
              Effect.andThen(drain.suspendRunningExecutorWork)
            )
          })
      }
      const bootstrap = yield* buildBootstrap(runId, storage, defaultTrackerGraphReader, observedApplicationExit)
      const running = yield* bootstrap
        .activate(
          target,
          Effect.succeed(initialPolicy),
          runId,
          Deferred.succeed(runtimeActive, undefined).pipe(
            Effect.andThen(applicationExit.awaitExitRequested),
            Effect.as(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })))
          )
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(runtimeActive)
      const exiting = yield* applicationExit.requestBoundary.requestExit.pipe(Effect.forkChild)
      yield* Deferred.await(executorDrainStarted)

      expect(running.pollUnsafe()).toBeUndefined()
      yield* Deferred.succeed(releaseExecutorDrain, undefined)
      expect(yield* Fiber.join(exiting)).toEqual(ApplicationExitResult.cases.Succeeded.make({ requestedStatus: 0 }))
      expect(yield* Fiber.join(running)).toEqual({ _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" })
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("times out instead of interrupting a non-idle Run whose family owner has not drained", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-non-idle-exit")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      const runtimeActive = yield* Deferred.make<void>()
      const lockReleased = yield* Ref.make(false)
      const requestedStatuses = yield* Ref.make<ReadonlyArray<number>>([])
      const ownership = CoordinatorOwnership.of({
        release: Ref.set(lockReleased, true),
        runMutation: (mutation) => mutation
      })
      const applicationExit = yield* makeApplicationExitShell(ownership, {
        requestEnd: ({ status }) => Ref.update(requestedStatuses, (statuses) => [...statuses, status])
      })
      const bootstrap = yield* buildBootstrap(
        runId,
        storage,
        defaultTrackerGraphReader,
        applicationExit,
        undefined,
        ownership
      )
      const running = yield* bootstrap
        .activate(
          target,
          Effect.succeed(initialPolicy),
          runId,
          Deferred.succeed(runtimeActive, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.as(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })))
          )
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(runtimeActive)
      const exiting = yield* bootstrap.applicationExitRequestBoundary.requestExit.pipe(Effect.forkChild)
      yield* Effect.yieldNow
      yield* TestClock.adjust("5 seconds")

      expect(yield* Fiber.join(exiting)).toMatchObject({ _tag: "TimedOut", requestedStatus: 1 })
      expect(yield* Ref.get(lockReleased)).toBe(false)
      expect(yield* Ref.get(requestedStatuses)).toEqual([1])
      expect((yield* storage.read(runId)).map(({ event }) => event._tag)).toEqual(["WorkflowRunBegan"])
      expect(running.pollUnsafe()).toBeUndefined()
      yield* Fiber.interrupt(running)
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("finishes an already-admitted Run termination append before successful Exit", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-termination-append-at-exit")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const delegate = Context.get(journalContext, JournalStore)
      const terminationStarted = yield* Deferred.make<void>()
      const releaseTermination = yield* Deferred.make<void>()
      const lockReleased = yield* Deferred.make<void>()
      const storage = JournalStore.of({
        ...delegate,
        terminateRun: (requestedRunId) =>
          Deferred.succeed(terminationStarted, undefined).pipe(
            Effect.andThen(Deferred.await(releaseTermination)),
            Effect.andThen(delegate.terminateRun(requestedRunId))
          )
      })
      const ownership = CoordinatorOwnership.of({
        release: Deferred.succeed(lockReleased, undefined).pipe(Effect.asVoid),
        runMutation: (mutation) => mutation
      })
      const applicationExit = yield* makeApplicationExitShell(ownership, { requestEnd: () => Effect.void })
      const bootstrap = yield* buildBootstrap(
        runId,
        storage,
        defaultTrackerGraphReader,
        applicationExit,
        undefined,
        ownership
      )
      const running = yield* bootstrap
        .activate(
          target,
          Effect.succeed(initialPolicy),
          runId,
          Effect.succeed(finalityProof(RunFinalityDecision.RunMayTerminate()))
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(terminationStarted)

      const exiting = yield* bootstrap.applicationExitRequestBoundary.requestExit.pipe(Effect.forkChild)
      yield* Effect.yieldNow
      expect(yield* Deferred.isDone(lockReleased)).toBe(false)

      yield* Deferred.succeed(releaseTermination, undefined)
      expect(yield* Fiber.join(running)).toEqual({ _tag: "RunMayTerminate" })
      expect(yield* Fiber.join(exiting)).toMatchObject({ _tag: "Succeeded", requestedStatus: 0 })
      expect(yield* Deferred.isDone(lockReleased)).toBe(true)
      expect((yield* delegate.read(runId)).map(({ event }) => event._tag)).toEqual([
        "WorkflowRunBegan",
        "WorkflowRunTerminated"
      ])
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("reopens an unfinished Run normally after an authored Exit death cut", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-reopen-after-exit-death")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      yield* storage.beginRun(runId, target, initialPolicy)

      const restarted = yield* buildBootstrap(
        runId,
        storage,
        defaultTrackerGraphReader,
        yield* makeApplicationExitShell(defaultOwnership, { requestEnd: () => Effect.void })
      )
      const entered = yield* Ref.make(false)
      const finality = RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })

      expect(
        yield* restarted.activate(
          target,
          Effect.die("ordinary reopening must retain the recorded initial policy"),
          runId,
          Ref.set(entered, true).pipe(Effect.as(finalityProof(finality)))
        )
      ).toEqual(finality)
      expect(yield* Ref.get(entered)).toBe(true)
      expect((yield* storage.read(runId)).map(({ event }) => event._tag)).toEqual(["WorkflowRunBegan"])
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("one application Exit driver and cutoff are shared by every Run bootstrap", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const firstTarget = FixtureTarget.make("shared-exit-first-run")
      const secondTarget = FixtureTarget.make("shared-exit-second-run")
      const firstRunId = yield* freshWorkflowRunId(firstTarget)
      const secondRunId = yield* freshWorkflowRunId(secondTarget)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      const processEnds = yield* Ref.make(0)
      const lockReleases = yield* Ref.make(0)
      const ownership = CoordinatorOwnership.of({
        release: Ref.update(lockReleases, (count) => count + 1),
        runMutation: (mutation) => mutation
      })
      const applicationExit = yield* makeApplicationExitShell(ownership, {
        requestEnd: () => Ref.update(processEnds, (count) => count + 1)
      })
      const nextDrainId = yield* Ref.make(0)
      const drained = yield* Ref.make<ReadonlyArray<number>>([])
      const observedApplicationExit: ApplicationExitShellService = {
        ...applicationExit,
        awaitExecutorDrains: applicationExit.awaitExecutorDrains,
        registerProcessLocalDrain: (drain) =>
          Ref.getAndUpdate(nextDrainId, (id) => id + 1).pipe(
            Effect.flatMap((drainId) =>
              applicationExit.registerProcessLocalDrain({
                closeProcessLocalResources: drain.closeProcessLocalResources.pipe(
                  Effect.ensuring(Ref.update(drained, (ids) => [...ids, drainId]))
                )
              })
            )
          )
      }
      const first = yield* buildBootstrap(
        firstRunId,
        storage,
        defaultTrackerGraphReader,
        observedApplicationExit,
        undefined,
        ownership
      )
      const second = yield* buildBootstrap(
        secondRunId,
        storage,
        defaultTrackerGraphReader,
        observedApplicationExit,
        undefined,
        ownership
      )

      const firstResult = yield* first.applicationExitRequestBoundary.requestExit
      const repeatedResult = yield* second.applicationExitRequestBoundary.requestExit

      expect(repeatedResult).toEqual(firstResult)
      expect(yield* Ref.get(drained)).toEqual([0, 1])
      expect(yield* Ref.get(lockReleases)).toBe(1)
      expect(yield* Ref.get(processEnds)).toBe(1)
      expect(
        (yield* applicationExit.admission.prepareForwardOwner("InterruptibleBoundary").pipe(Effect.flip))._tag
      ).toBe("ApplicationExiting")
      expect(yield* applicationExit.admission.snapshot).toEqual({
        cutoffClosed: true,
        preparingOwnerCount: 0,
        registeredOwnerCount: 0
      })
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("rejects a Run activation that reaches the application after the Exit cutoff", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-activation-after-exit")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      const applicationExit = yield* makeApplicationExitShell(defaultOwnership, { requestEnd: () => Effect.void })
      const bootstrap = yield* buildBootstrap(runId, storage, defaultTrackerGraphReader, applicationExit)
      yield* applicationExit.requestBoundary.requestExit

      expect(
        yield* bootstrap
          .activate(
            target,
            Effect.succeed(initialPolicy),
            runId,
            Effect.die("a post-cutoff activation must not enter its runtime")
          )
          .pipe(Effect.flip)
      ).toMatchObject({ _tag: "ApplicationExiting" })
      expect(yield* storage.read(runId)).toEqual([])
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("does not append Run termination when the program reaches finality only after the Exit cutoff", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-finality-after-exit")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      const runtimeActive = yield* Deferred.make<void>()
      const applicationExit = yield* makeApplicationExitShell(defaultOwnership, { requestEnd: () => Effect.void })
      const bootstrap = yield* buildBootstrap(runId, storage, defaultTrackerGraphReader, applicationExit)
      const running = yield* bootstrap
        .activate(
          target,
          Effect.succeed(initialPolicy),
          runId,
          Deferred.succeed(runtimeActive, undefined).pipe(
            Effect.andThen(applicationExit.awaitExitRequested),
            Effect.as(finalityProof(RunFinalityDecision.RunMayTerminate()))
          )
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(runtimeActive)

      const exiting = yield* applicationExit.requestBoundary.requestExit.pipe(Effect.forkChild)
      expect(yield* Fiber.join(running)).toEqual({ _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" })
      expect(yield* Fiber.join(exiting)).toMatchObject({ _tag: "Succeeded" })
      expect((yield* storage.read(runId)).map(({ event }) => event._tag)).toEqual(["WorkflowRunBegan"])
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("rejects an activation queued before Exit when it reaches the cutoff after the active Run closes", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-queued-activation-at-exit")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      const applicationExit = yield* makeApplicationExitShell(defaultOwnership, { requestEnd: () => Effect.void })
      const bootstrap = yield* buildBootstrap(runId, storage, defaultTrackerGraphReader, applicationExit)
      const active = yield* Deferred.make<void>()
      const finish = yield* Deferred.make<void>()
      const first = yield* bootstrap
        .activate(
          target,
          Effect.succeed(initialPolicy),
          runId,
          Deferred.succeed(active, undefined).pipe(
            Effect.andThen(Deferred.await(finish)),
            Effect.as(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })))
          )
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(active)
      const queuedProgramEntered = yield* Ref.make(false)
      const queued = yield* bootstrap
        .activate(
          target,
          Effect.die("the established Run must not reread an initial policy"),
          runId,
          Ref.set(queuedProgramEntered, true).pipe(
            Effect.as(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })))
          )
        )
        .pipe(Effect.forkChild)
      yield* Effect.yieldNow

      const exiting = yield* applicationExit.requestBoundary.requestExit.pipe(Effect.forkChild)
      yield* Deferred.succeed(finish, undefined)
      yield* Fiber.join(first)
      yield* Fiber.join(exiting)

      expect(yield* Fiber.join(queued).pipe(Effect.flip)).toMatchObject({ _tag: "ApplicationExiting" })
      expect(yield* Ref.get(queuedProgramEntered)).toBe(false)
      expect((yield* storage.read(runId)).map(({ event }) => event._tag)).toEqual(["WorkflowRunBegan"])
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("establishes an absent Run before activating its journal-backed runtime once", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-fresh")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      const bootstrap = yield* buildBootstrap(runId, storage)
      const observed = yield* Ref.make<Option.Option<Record<string, unknown>>>(Option.none())

      yield* bootstrap.activate(
        target,
        Effect.succeed(initialPolicy),
        runId,
        Effect.gen(function* () {
          const context = yield* Effect.context<never>()
          const journal = yield* Journal
          yield* Ref.set(
            observed,
            Option.some({
              graph: (yield* journal.state.get).graph._tag,
              hasInRunJournal: Option.isSome(Context.getOption(context, InRunJournal)),
              hasRawJournal: Option.isSome(Context.getOption(context, JournalStore)),
              hasLifecycleJournal: Option.isSome(Context.getOption(context, RunLifecycleJournal))
            })
          )
          return finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" }))
        })
      )

      expect(Option.getOrThrow(yield* Ref.get(observed))).toEqual({
        graph: "GraphNotEstablished",
        hasInRunJournal: true,
        hasLifecycleJournal: false,
        hasRawJournal: false
      })
      expect((yield* storage.read(runId)).map(({ event }) => event._tag)).toEqual(["WorkflowRunBegan"])
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("retries an unacknowledged Run beginning through the same entry without appending it twice", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-lost-begin-response")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const delegate = Context.get(journalContext, JournalStore)
      const storage = JournalStore.of({
        ...delegate,
        beginRun: (requestedRunId, requestedTarget, policy) =>
          delegate
            .beginRun(requestedRunId, requestedTarget, policy)
            .pipe(
              Effect.andThen(
                Effect.fail(
                  new JournalStorageUnavailable({
                    detail: "the beginning committed before its response was lost",
                    operation: "JournalStore.beginRun"
                  })
                )
              )
            )
      })
      const bootstrap = yield* buildBootstrap(runId, storage)
      const activations = yield* Ref.make(0)
      const active = RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })

      expect(
        yield* bootstrap.activate(
          target,
          Effect.succeed(initialPolicy),
          runId,
          Ref.update(activations, (count) => count + 1).pipe(Effect.as(finalityProof(active)))
        )
      ).toEqual(active)
      expect(yield* Ref.get(activations)).toBe(1)
      expect((yield* delegate.read(runId)).map(({ event }) => event._tag)).toEqual(["WorkflowRunBegan"])
      expect(yield* bootstrap.applicationExitRequestBoundary.requestExit).toMatchObject({ _tag: "Succeeded" })
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("retries a pre-commit Run beginning failure without entering activation", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-pre-commit-begin-failure")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const delegate = Context.get(journalContext, JournalStore)
      const beginAttempts = yield* Ref.make(0)
      const scans = yield* Ref.make(0)
      const initialPolicyEvaluations = yield* Ref.make(0)
      const programCalls = yield* Ref.make(0)
      const preCommitFailure = new JournalStorageUnavailable({
        detail: "the beginning failed before any row was committed",
        operation: "JournalStore.beginRun"
      })
      const storage = JournalStore.of({
        ...delegate,
        beginRun: (requestedRunId, requestedTarget, policy) =>
          Ref.getAndUpdate(beginAttempts, (count) => count + 1).pipe(
            Effect.flatMap((attempt) =>
              attempt === 0 ? Effect.fail(preCommitFailure) : delegate.beginRun(requestedRunId, requestedTarget, policy)
            )
          ),
        scan: () => Ref.update(scans, (count) => count + 1).pipe(Effect.andThen(delegate.scan()))
      })
      const bootstrap = yield* buildBootstrap(runId, storage)
      const policy = Ref.update(initialPolicyEvaluations, (count) => count + 1).pipe(Effect.as(initialPolicy))
      const active = RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })
      const activation = Ref.update(programCalls, (count) => count + 1).pipe(Effect.as(finalityProof(active)))

      expect(yield* bootstrap.activate(target, policy, runId, activation).pipe(Effect.flip)).toBe(preCommitFailure)
      expect(yield* delegate.read(runId)).toEqual([])
      expect(yield* Ref.get(initialPolicyEvaluations)).toBe(1)
      // Tracker, Git, and executor boundaries exist only inside the activation program's context.
      expect(yield* Ref.get(programCalls)).toBe(0)

      expect(yield* bootstrap.activate(target, policy, runId, activation)).toEqual(active)
      expect(yield* Ref.get(initialPolicyEvaluations)).toBe(2)
      expect(yield* Ref.get(beginAttempts)).toBe(2)
      expect(yield* Ref.get(scans)).toBe(2)
      expect(yield* Ref.get(programCalls)).toBe(1)
      expect((yield* delegate.read(runId)).map(({ event }) => event._tag)).toEqual(["WorkflowRunBegan"])
      expect(yield* bootstrap.applicationExitRequestBoundary.requestExit).toMatchObject({ _tag: "Succeeded" })
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("classifies a failed beginning from the immediately reconciled durable Run fact", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const recordedTarget = FixtureTarget.make("journaled-bootstrap-racing-recorded-target")
      const requestedTarget = FixtureTarget.make("journaled-bootstrap-racing-requested-target")
      const runId = yield* freshWorkflowRunId(requestedTarget)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const delegate = Context.get(journalContext, JournalStore)
      const beginFailure = new JournalStorageUnavailable({
        detail: "the beginning append failed before its outcome was known",
        operation: "JournalStore.beginRun"
      })
      const targetMismatch = new WorkflowRunTargetMismatch({ recordedTarget, requestedTarget, runId })
      const alreadyTerminated = new WorkflowRunAlreadyTerminated({ runId, terminatedAt: JournalPosition.make(2) })
      const reconciliationUnavailable = new JournalStorageUnavailable({
        detail: "the reconciliation read was unavailable",
        operation: "JournalStore.readRunForRecovery"
      })
      const cases = [
        { expected: targetMismatch, reconciliationFailure: targetMismatch },
        { expected: alreadyTerminated, reconciliationFailure: alreadyTerminated },
        { expected: beginFailure, reconciliationFailure: reconciliationUnavailable }
      ] as const

      for (const { expected, reconciliationFailure } of cases) {
        const storage = JournalStore.of({
          ...delegate,
          beginRun: () => Effect.fail(beginFailure),
          readRunForRecovery: () => Effect.fail(reconciliationFailure)
        })
        const bootstrap = yield* buildBootstrap(runId, storage)
        const runtimeEntered = yield* Ref.make(false)
        const failure = yield* bootstrap
          .activate(
            requestedTarget,
            Effect.succeed(initialPolicy),
            runId,
            Ref.set(runtimeEntered, true).pipe(
              Effect.as(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })))
            )
          )
          .pipe(Effect.flip)

        expect(failure).toBe(expected)
        expect(yield* Ref.get(runtimeEntered)).toBe(false)
      }
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("re-enters an unfinished Run without evaluating the initial policy source", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-incomplete-recovery")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      const bootstrap = yield* buildBootstrap(runId, storage)
      const activations = yield* Ref.make(0)
      const initialPolicyEvaluations = yield* Ref.make(0)
      const active = RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })

      expect(
        yield* bootstrap.activate(
          target,
          Ref.update(initialPolicyEvaluations, (count) => count + 1).pipe(Effect.as(initialPolicy)),
          runId,
          Ref.update(activations, (count) => count + 1).pipe(Effect.as(finalityProof(active)))
        )
      ).toEqual(active)
      expect(
        yield* bootstrap.activate(
          target,
          Effect.die("an established Run must not evaluate a replacement initial policy"),
          runId,
          Ref.update(activations, (count) => count + 1).pipe(Effect.as(finalityProof(active)))
        )
      ).toEqual(active)

      expect(yield* Ref.get(activations)).toBe(2)
      expect(yield* Ref.get(initialPolicyEvaluations)).toBe(1)
      expect((yield* storage.read(runId)).map(({ event }) => event._tag)).toEqual(["WorkflowRunBegan"])
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("rejects a different fresh Run identity before recording its beginning", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const expectedTarget = FixtureTarget.make("journaled-bootstrap-expected")
      const requestedTarget = FixtureTarget.make("journaled-bootstrap-requested")
      const expectedRunId = yield* freshWorkflowRunId(expectedTarget)
      const requestedRunId = yield* freshWorkflowRunId(requestedTarget)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      const bootstrap = yield* buildBootstrap(expectedRunId, storage)

      const mismatch = yield* bootstrap
        .activate(
          requestedTarget,
          Effect.succeed(initialPolicy),
          requestedRunId,
          Effect.succeed(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })))
        )
        .pipe(Effect.flip)

      expect(mismatch).toMatchObject({ _tag: "JournaledRunIdentityMismatch", expectedRunId, requestedRunId })
      expect(yield* storage.read(requestedRunId)).toEqual([])
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("rejects an established Run whose target differs before activation", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const recordedTarget = FixtureTarget.make("journaled-bootstrap-recorded-target")
      const requestedTarget = FixtureTarget.make("journaled-bootstrap-mismatched-target")
      const runId = yield* freshWorkflowRunId(recordedTarget)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      yield* storage.beginRun(runId, recordedTarget, initialPolicy)
      const bootstrap = yield* buildBootstrap(runId, storage)
      const runtimeEntered = yield* Ref.make(false)

      const failure = yield* bootstrap
        .activate(
          requestedTarget,
          Effect.die("existing history must supply the initial policy"),
          runId,
          Ref.set(runtimeEntered, true).pipe(
            Effect.as(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })))
          )
        )
        .pipe(Effect.flip)

      expect(failure).toMatchObject({ _tag: "WorkflowRunTargetMismatch", recordedTarget, requestedTarget, runId })
      expect(yield* Ref.get(runtimeEntered)).toBe(false)
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("names every unfinished Run and activates none when startup discovery finds several", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const firstTarget = FixtureTarget.make("journaled-bootstrap-first-unfinished-target")
      const secondTarget = FixtureTarget.make("journaled-bootstrap-second-unfinished-target")
      const requestedTarget = FixtureTarget.make("journaled-bootstrap-requested-after-several")
      const firstRunId = yield* freshWorkflowRunId(firstTarget)
      const secondRunId = yield* freshWorkflowRunId(secondTarget)
      const requestedRunId = yield* freshWorkflowRunId(requestedTarget)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      yield* storage.beginRun(firstRunId, firstTarget, initialPolicy)
      yield* storage.beginRun(secondRunId, secondTarget, initialPolicy)
      const bootstrap = yield* buildBootstrap(requestedRunId, storage)
      const runtimeEntered = yield* Ref.make(false)

      const failure = yield* bootstrap
        .activate(
          requestedTarget,
          Effect.die("several unfinished Runs must block initial policy evaluation"),
          requestedRunId,
          Ref.set(runtimeEntered, true).pipe(
            Effect.as(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })))
          )
        )
        .pipe(Effect.flip)

      expect(failure).toMatchObject({
        _tag: "StartupRecoveryBlocked",
        issues: [
          { _tag: "OtherUnfinishedRunIssue", requestedRunId, unfinishedRunId: firstRunId },
          { _tag: "OtherUnfinishedRunIssue", requestedRunId, unfinishedRunId: secondRunId }
        ]
      })
      expect(yield* Ref.get(runtimeEntered)).toBe(false)
      expect(yield* storage.read(requestedRunId)).toEqual([])
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("rejects a terminated Run before constructing activation", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-terminated")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      yield* storage.beginRun(runId, target, initialPolicy)
      yield* storage.terminateRun(runId)
      const bootstrap = yield* buildBootstrap(runId, storage)
      const runtimeEntered = yield* Ref.make(false)

      const failure = yield* bootstrap
        .activate(
          target,
          Effect.die("terminated history must not evaluate the initial policy"),
          runId,
          Ref.set(runtimeEntered, true).pipe(
            Effect.as(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })))
          )
        )
        .pipe(Effect.flip)

      expect(failure).toMatchObject({ _tag: "WorkflowRunAlreadyTerminated", runId })
      expect(yield* Ref.get(runtimeEntered)).toBe(false)
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("blocks runtime construction when the freshly read journal prefix is invalid", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-invalid-prefix")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const delegate = Context.get(journalContext, JournalStore)
      yield* delegate.beginRun(runId, target, initialPolicy)
      const storage = JournalStore.of({
        ...delegate,
        read: (requestedRunId) =>
          delegate
            .read(requestedRunId)
            .pipe(
              Effect.map((records) =>
                Option.match(Option.fromUndefinedOr(records[0]), {
                  onNone: () => records,
                  onSome: (began) => [...records, { ...began, position: JournalPosition.make(2) }]
                })
              )
            )
      })
      const bootstrap = yield* buildBootstrap(runId, storage)
      const runtimeEntered = yield* Ref.make(false)

      const failure = yield* bootstrap
        .activate(
          target,
          Effect.die("invalid existing history must not evaluate the initial policy"),
          runId,
          Ref.set(runtimeEntered, true).pipe(
            Effect.as(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })))
          )
        )
        .pipe(Effect.flip)

      expect(failure).toMatchObject({ _tag: "StartupRecoveryBlocked" })
      expect(yield* Ref.get(runtimeEntered)).toBe(false)
      expect(yield* delegate.read(runId)).toHaveLength(1)
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("uses the configured Run identity when establishment finds no unfinished Run", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-empty-recovery")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      const bootstrap = yield* buildBootstrap(runId, storage)

      const failure = yield* bootstrap
        .activate(
          target,
          Effect.fail("initial-policy-failure"),
          runId,
          Effect.succeed(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })))
        )
        .pipe(Effect.flip)

      expect(failure).toBe("initial-policy-failure")
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("publishes an Operator Pause through the active journal without exposing runtime services", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-pause")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      const bootstrap = yield* buildBootstrap(runId, storage)
      const runtimeActive = yield* Deferred.make<void>()
      const inspectPause = yield* Deferred.make<void>()
      const observedPause = yield* Deferred.make<string>()
      const finish = yield* Deferred.make<void>()
      const running = yield* bootstrap
        .activate(
          target,
          Effect.succeed(initialPolicy),
          runId,
          Effect.gen(function* () {
            const journal = yield* Journal
            yield* Deferred.succeed(runtimeActive, undefined)
            yield* Deferred.await(inspectPause)
            yield* Deferred.succeed(observedPause, (yield* journal.state.get).reconstructed.pause.run._tag)
            yield* Deferred.await(finish)
            return finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" }))
          })
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(runtimeActive)

      yield* bootstrap.operatorControl.applyControlDirection({ direction: "Pause", subject: { _tag: "Run", runId } })
      yield* bootstrap.operatorControl.applyTaskClaimReacquisition({
        requestId: TaskClaimReacquisitionRequestId.make("pause-test-reacquisition"),
        subject: { runId, taskId: TaskId.make("pause-test-task") }
      })
      yield* Deferred.succeed(inspectPause, undefined)
      expect(yield* Deferred.await(observedPause)).toBe("RunPaused")
      expect((yield* storage.read(runId)).filter(({ event }) => event._tag === "ControlDirectionApplied")).toHaveLength(
        1
      )
      expect(
        (yield* storage.read(runId)).filter(({ event }) => event._tag === "TaskClaimReacquisitionDirected")
      ).toHaveLength(1)

      yield* Deferred.succeed(finish, undefined)
      yield* Fiber.join(running)
      expect(
        yield* bootstrap.operatorControl
          .applyControlDirection({ direction: "Unpause", subject: { _tag: "Run", runId } })
          .pipe(Effect.flip)
      ).toMatchObject({ _tag: "JournaledRunNotActive" })
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("keeps the Journal-backed quarantine direction route available after delivery stabilizes", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-quarantine-direction")
      const runId = AllocatedWorkflowRunId.make(integrationFinalityFixture.runId)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      const bootstrap = yield* buildBootstrap(runId, storage)
      yield* bootstrap.activate(
        target,
        Effect.succeed(initialPolicy),
        runId,
        Effect.succeed(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })))
      )

      const run = integrationFinalityFixture.qualifiedCandidate.run
      yield* storage.append(
        runId,
        integratorRunStartedRecordKey(run),
        IntegratorRunStartedEvent.make({ run, version: workflowJournalEventVersion })
      )
      const detail = IntegratorNotPreparedDetail.make("operator must choose the next disposition")
      const result = yield* storage.append(
        runId,
        integratorRunResultRecordedRecordKey(run),
        IntegratorRunResultRecordedEvent.make({
          result: IntegratorResult.cases.NotPrepared.make({ correlation: run.session, detail }),
          run,
          version: workflowJournalEventVersion
        })
      )
      const basis = IntegrationQuarantineBasis.cases.ConclusiveResult.make({
        cause: IntegrationQuarantineCause.cases.NotPrepared.make({ detail }),
        evidence: IntegrationQuarantineResultEvidence.make({ resultRecordedAt: result.position })
      })
      const quarantine = yield* storage.append(
        runId,
        integrationQuarantinedRecordKey(run.session.sessionId, basis),
        IntegrationQuarantinedEvent.make({
          basis,
          correlation: run.session,
          occurrenceClassification: "NonActionOccurrence",
          version: workflowJournalEventVersion
        })
      )
      const requestId = IntegrationQuarantineDirectionRequestId.make({ nonce: "post-stabilization", runId })
      const request = {
        fingerprint: IntegrationQuarantineDirectionFingerprint.make({
          direction: "Retry",
          quarantineAt: quarantine.position,
          sessionId: run.session.sessionId
        }),
        requestId
      }
      const applied = yield* bootstrap.operatorControl.applyIntegrationQuarantineDirection(request)

      expect(applied.application.event.fingerprint.direction).toBe("Retry")
      expect(yield* bootstrap.operatorControl.applyIntegrationQuarantineDirection(request)).toEqual(applied)
      expect(yield* bootstrap.operatorControl.readIntegrationQuarantineDirection({ requestId })).toEqual(applied)
      expect(
        yield* bootstrap.operatorControl
          .applyIntegrationQuarantineDirection({
            ...request,
            requestId: IntegrationQuarantineDirectionRequestId.make({
              nonce: "foreign-bootstrap",
              runId: RunId.make("foreign-quarantine-direction-run")
            })
          })
          .pipe(Effect.flip)
      ).toMatchObject({ _tag: "JournaledRunIdentityMismatch", expectedRunId: runId })
      expect((yield* storage.read(runId)).map(({ event }) => event._tag)).toEqual([
        "WorkflowRunBegan",
        "IntegratorRunStarted",
        "IntegratorRunResultRecorded",
        "IntegrationQuarantined",
        "IntegrationQuarantineDirectionApplied"
      ])
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("rejects an unapplied Operator Pause after the application Exit cutoff", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-exiting-pause")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      const applicationExit = yield* makeApplicationExitShell(defaultOwnership, { requestEnd: () => Effect.void })
      const bootstrap = yield* buildBootstrap(runId, storage, defaultTrackerGraphReader, applicationExit)
      const runtimeActive = yield* Deferred.make<void>()
      const running = yield* bootstrap
        .activate(
          target,
          Effect.succeed(initialPolicy),
          runId,
          Deferred.succeed(runtimeActive, undefined).pipe(
            Effect.andThen(applicationExit.awaitExitRequested),
            Effect.as(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })))
          )
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(runtimeActive)

      yield* bootstrap.applicationExitRequestBoundary.requestExit
      for (const direction of ["Pause", "Unpause"] as const) {
        expect(
          yield* bootstrap.operatorControl
            .applyControlDirection({ direction, subject: { _tag: "Run", runId } })
            .pipe(Effect.flip)
        ).toMatchObject({ _tag: "ApplicationExiting" })
      }
      expect((yield* storage.read(runId)).map(({ event }) => event._tag)).toEqual(["WorkflowRunBegan"])
      yield* Fiber.join(running)
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("reports a failed already-produced Pause write through the application Exit result", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-failed-write-at-exit")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const delegate = Context.get(journalContext, JournalStore)
      const storage = JournalStore.of({
        ...delegate,
        append: (requestedRunId, key, event) =>
          event._tag === "ControlDirectionApplied"
            ? Effect.fail(
                new JournalStorageUnavailable({
                  detail: "authored produced-write failure",
                  operation: "JournalStore.append"
                })
              )
            : delegate.append(requestedRunId, key, event)
      })
      const runtimeActive = yield* Deferred.make<void>()
      const lockReleased = yield* Ref.make(false)
      const ownership = CoordinatorOwnership.of({
        release: Ref.set(lockReleased, true),
        runMutation: (mutation) => mutation
      })
      const applicationExit = yield* makeApplicationExitShell(ownership, { requestEnd: () => Effect.void })
      const bootstrap = yield* buildBootstrap(
        runId,
        storage,
        defaultTrackerGraphReader,
        applicationExit,
        undefined,
        ownership
      )
      const running = yield* bootstrap
        .activate(
          target,
          Effect.succeed(initialPolicy),
          runId,
          Deferred.succeed(runtimeActive, undefined).pipe(
            Effect.andThen(applicationExit.awaitExitRequested),
            Effect.as(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })))
          )
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(runtimeActive)

      expect(
        yield* bootstrap.operatorControl
          .applyControlDirection({ direction: "Pause", subject: { _tag: "Run", runId } })
          .pipe(Effect.flip)
      ).toMatchObject({ _tag: "JournalStorageUnavailable" })
      expect(yield* bootstrap.applicationExitRequestBoundary.requestExit).toEqual(
        ApplicationExitResult.cases.Failed.make({
          diagnostics: [ApplicationExitDiagnostic.make("Run journal append failed before application Exit completed")],
          requestedStatus: 1
        })
      )
      expect(yield* Ref.get(lockReleased)).toBe(true)
      yield* Fiber.join(running)
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("tells Alice that her exact Run Pause is not applied", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-observe-unpaused")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const bootstrap = yield* buildBootstrap(runId, Context.get(journalContext, JournalStore))
      const ready = yield* Deferred.make<void>()
      const finish = yield* Deferred.make<void>()
      const running = yield* bootstrap
        .activate(
          target,
          Effect.succeed(initialPolicy),
          runId,
          Effect.gen(function* () {
            const observation = yield* DeliveryRuntimeObservationPublication
            const journal = yield* Journal
            const acceptedAt = (yield* journal.state.get).position
            yield* observation.publish({ ...(yield* unpausedRuntimeEvaluation), acceptedAt }, [])
            yield* Deferred.succeed(ready, undefined)
            yield* Deferred.await(finish)
            return finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" }))
          })
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(ready)

      const failure = yield* bootstrap.operatorControl
        .observePause({ _tag: "Run", runId })
        .pipe(Stream.runDrain, Effect.flip)

      expect(failure).toMatchObject({ _tag: "PauseNotApplied", subject: { _tag: "Run", runId } })
      yield* Deferred.succeed(finish, undefined)
      yield* Fiber.join(running)
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("does not keep the Run open for Alice's Pause subscription and ends it with the bootstrap scope", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-observe-disconnect")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const bootstrapScope = yield* Scope.make()
      const bootstrap = yield* buildBootstrap(runId, Context.get(journalContext, JournalStore)).pipe(
        Scope.provide(bootstrapScope)
      )
      const ready = yield* Deferred.make<void>()
      const finish = yield* Deferred.make<void>()
      const running = yield* bootstrap
        .activate(
          target,
          Effect.succeed(initialPolicy),
          runId,
          Deferred.succeed(ready, undefined).pipe(
            Effect.andThen(Deferred.await(finish)),
            Effect.as(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })))
          )
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(ready)

      const observing = yield* bootstrap.operatorControl
        .observePause({ _tag: "Run", runId })
        .pipe(Stream.runDrain, Effect.forkChild)
      yield* Effect.yieldNow
      yield* Deferred.succeed(finish, undefined)

      expect(yield* Fiber.join(running)).toEqual({ _tag: "RunMustRemainActive", reason: "TrackerTargetUnsettled" })
      expect(observing.pollUnsafe()).toBeUndefined()
      yield* Scope.close(bootstrapScope, Exit.void)
      yield* Fiber.join(observing)
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect(
  "serializes recovery inspection with the preceding runtime so no queued activation keeps a stale prefix",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const target = FixtureTarget.make("journaled-bootstrap-recovery-order")
        const runId = yield* freshWorkflowRunId(target)
        const journalContext = yield* Layer.build(memoryJournalStoreLayer)
        const storage = Context.get(journalContext, JournalStore)
        yield* storage.beginRun(runId, target, initialPolicy)
        const bootstrap = yield* buildBootstrap(runId, storage)
        const firstActive = yield* Deferred.make<void>()
        const appendFirst = yield* Deferred.make<void>()
        const firstAppended = yield* Deferred.make<void>()
        const finishFirst = yield* Deferred.make<void>()
        const secondActive = yield* Deferred.make<void>()
        const firstOperation = makeTrackerGraphObservationOperation(OperationId.make("recovery-first-prefix"), target)
        const secondOperation = makeTrackerGraphObservationOperation(OperationId.make("recovery-second-prefix"), target)

        const first = yield* bootstrap
          .activate(
            target,
            Effect.die("existing history must supply the initial policy"),
            runId,
            Effect.gen(function* () {
              const journal = yield* InRunJournal
              yield* Deferred.succeed(firstActive, undefined)
              yield* Deferred.await(appendFirst)
              yield* journal.append(
                runId,
                intentRecordKey(firstOperation.operationId),
                taskTrackerReadIntent(firstOperation)
              )
              yield* Deferred.succeed(firstAppended, undefined)
              yield* Deferred.await(finishFirst)
              return finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" }))
            })
          )
          .pipe(Effect.forkChild)
        yield* Deferred.await(firstActive)
        const second = yield* bootstrap
          .activate(
            target,
            Effect.die("existing history must supply the initial policy"),
            runId,
            Effect.gen(function* () {
              const journal = yield* InRunJournal
              yield* Deferred.succeed(secondActive, undefined)
              expect((yield* journal.read(runId)).map(({ event }) => event._tag)).toEqual([
                "WorkflowRunBegan",
                "TaskTrackerReadIntentRecorded"
              ])
              yield* journal.append(
                runId,
                intentRecordKey(secondOperation.operationId),
                taskTrackerReadIntent(secondOperation)
              )
              return finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" }))
            })
          )
          .pipe(Effect.forkChild)

        yield* Deferred.succeed(appendFirst, undefined)
        yield* Deferred.await(firstAppended)
        expect(yield* Deferred.isDone(secondActive)).toBe(false)
        yield* Deferred.succeed(finishFirst, undefined)
        yield* Fiber.join(first)
        yield* Fiber.join(second)
        expect(yield* Deferred.isDone(secondActive)).toBe(true)
        expect((yield* storage.read(runId)).map(({ position }) => position)).toEqual([1, 2, 3])
      })
    ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("drains accepted Operator calls and records termination before another recovery can enter", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-close-order")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const delegate = Context.get(journalContext, JournalStore)
      const capacityAppendStarted = yield* Deferred.make<void>()
      const releaseCapacityAppend = yield* Deferred.make<void>()
      const runtimeActive = yield* Deferred.make<void>()
      const finishRuntime = yield* Deferred.make<void>()
      const terminationStarted = yield* Deferred.make<void>()
      const allowTermination = yield* Deferred.make<void>()
      const recoveryActive = yield* Deferred.make<void>()
      const storage = JournalStore.of({
        ...delegate,
        append: (requestedRunId, key, event) =>
          event._tag === "TaskWorkCapacityChanged"
            ? Deferred.succeed(capacityAppendStarted, undefined).pipe(
                Effect.andThen(Deferred.await(releaseCapacityAppend)),
                Effect.andThen(delegate.append(requestedRunId, key, event))
              )
            : delegate.append(requestedRunId, key, event),
        terminateRun: (requestedRunId) =>
          Deferred.succeed(terminationStarted, undefined).pipe(
            Effect.andThen(Deferred.await(allowTermination)),
            Effect.andThen(delegate.terminateRun(requestedRunId))
          )
      })
      const bootstrap = yield* buildBootstrap(runId, storage)
      const running = yield* bootstrap
        .activate(
          target,
          Effect.succeed(initialPolicy),
          runId,
          Effect.gen(function* () {
            yield* Deferred.succeed(runtimeActive, undefined)
            yield* Deferred.await(finishRuntime)
            return finalityProof(RunFinalityDecision.RunMayTerminate())
          })
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(runtimeActive)
      const currentPolicy = yield* bootstrap.operatorControl.readTaskWorkCapacity(runId)
      const capacityChange = yield* bootstrap.operatorControl
        .setTaskWorkCapacity({ capacity: 1, expectedRevision: currentPolicy.revision, runId })
        .pipe(Effect.forkChild)
      yield* Deferred.await(capacityAppendStarted)
      yield* Deferred.succeed(finishRuntime, undefined)

      const awaitClosedAdmission = (): Effect.Effect<void> =>
        bootstrap.operatorControl
          .readTaskWorkCapacity(runId)
          .pipe(
            Effect.matchEffect({
              onFailure: (failure) => (failure._tag === "JournaledRunNotActive" ? Effect.void : Effect.die(failure)),
              onSuccess: () => Effect.yieldNow.pipe(Effect.andThen(Effect.suspend(awaitClosedAdmission)))
            })
          )
      yield* awaitClosedAdmission()
      expect(yield* Deferred.isDone(terminationStarted)).toBe(false)

      yield* Deferred.succeed(releaseCapacityAppend, undefined)
      yield* Fiber.join(capacityChange)
      yield* Deferred.await(terminationStarted)
      const queuedRecovery = yield* bootstrap
        .activate(
          target,
          Effect.die("terminated history must not evaluate the initial policy"),
          runId,
          Deferred.succeed(recoveryActive, undefined).pipe(
            Effect.as(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })))
          )
        )
        .pipe(Effect.flip, Effect.forkChild)
      expect(yield* Deferred.isDone(recoveryActive)).toBe(false)

      yield* Deferred.succeed(allowTermination, undefined)
      expect(yield* Fiber.join(running)).toEqual({ _tag: "RunMayTerminate" })
      expect(yield* Fiber.join(queuedRecovery)).toMatchObject({ _tag: "WorkflowRunAlreadyTerminated", runId })
      expect(yield* Deferred.isDone(recoveryActive)).toBe(false)
      expect((yield* storage.read(runId)).map(({ event }) => event._tag)).toEqual([
        "WorkflowRunBegan",
        "TaskWorkCapacityChanged",
        "WorkflowRunTerminated"
      ])
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("rechecks a terminal decision after an already-accepted Operator Pause finishes appending", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-pause-before-termination")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const delegate = Context.get(journalContext, JournalStore)
      const pauseAppendStarted = yield* Deferred.make<void>()
      const releasePauseAppend = yield* Deferred.make<void>()
      const runtimeActive = yield* Deferred.make<void>()
      const finishRuntime = yield* Deferred.make<void>()
      const storage = JournalStore.of({
        ...delegate,
        append: (requestedRunId, key, event) =>
          event._tag === "ControlDirectionApplied"
            ? Deferred.succeed(pauseAppendStarted, undefined).pipe(
                Effect.andThen(Deferred.await(releasePauseAppend)),
                Effect.andThen(delegate.append(requestedRunId, key, event))
              )
            : delegate.append(requestedRunId, key, event)
      })
      const bootstrap = yield* buildBootstrap(runId, storage)
      const running = yield* bootstrap
        .activate(
          target,
          Effect.succeed(initialPolicy),
          runId,
          Deferred.succeed(runtimeActive, undefined).pipe(
            Effect.andThen(Deferred.await(finishRuntime)),
            Effect.as(finalityProof(RunFinalityDecision.RunMayTerminate()))
          )
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(runtimeActive)
      const pause = yield* bootstrap.operatorControl
        .applyControlDirection({ direction: "Pause", subject: { _tag: "Run", runId } })
        .pipe(Effect.forkChild)
      yield* Deferred.await(pauseAppendStarted)
      yield* Deferred.succeed(finishRuntime, undefined)
      yield* Effect.yieldNow

      yield* Deferred.succeed(releasePauseAppend, undefined)
      yield* Fiber.join(pause)
      expect(yield* Fiber.join(running)).toEqual({ _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" })
      expect((yield* storage.read(runId)).map(({ event }) => event._tag)).toEqual([
        "WorkflowRunBegan",
        "ControlDirectionApplied"
      ])
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("flushes an already-started Pause append before successful Exit and preserves the applied direction", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-pause-flush-before-exit")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const delegate = Context.get(journalContext, JournalStore)
      const pauseAppendStarted = yield* Deferred.make<void>()
      const releasePauseAppend = yield* Deferred.make<void>()
      const runtimeActive = yield* Deferred.make<void>()
      const lockReleased = yield* Deferred.make<void>()
      const storage = JournalStore.of({
        ...delegate,
        append: (requestedRunId, key, event) =>
          event._tag === "ControlDirectionApplied"
            ? Deferred.succeed(pauseAppendStarted, undefined).pipe(
                Effect.andThen(Deferred.await(releasePauseAppend)),
                Effect.andThen(delegate.append(requestedRunId, key, event))
              )
            : delegate.append(requestedRunId, key, event)
      })
      const ownership = CoordinatorOwnership.of({
        release: Deferred.succeed(lockReleased, undefined).pipe(Effect.asVoid),
        runMutation: (mutation) => mutation
      })
      const applicationExit = yield* makeApplicationExitShell(ownership, { requestEnd: () => Effect.void })
      const bootstrap = yield* buildBootstrap(
        runId,
        storage,
        defaultTrackerGraphReader,
        applicationExit,
        undefined,
        ownership
      )
      const running = yield* bootstrap
        .activate(
          target,
          Effect.succeed(initialPolicy),
          runId,
          Deferred.succeed(runtimeActive, undefined).pipe(
            Effect.andThen(applicationExit.awaitExitRequested),
            Effect.as(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })))
          )
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(runtimeActive)
      const pause = yield* bootstrap.operatorControl
        .applyControlDirection({ direction: "Pause", subject: { _tag: "Run", runId } })
        .pipe(Effect.forkChild)
      yield* Deferred.await(pauseAppendStarted)

      const exiting = yield* bootstrap.applicationExitRequestBoundary.requestExit.pipe(Effect.forkChild)
      yield* Effect.yieldNow
      expect(yield* Deferred.isDone(lockReleased)).toBe(false)

      yield* Deferred.succeed(releasePauseAppend, undefined)
      yield* Fiber.join(pause)
      expect(yield* Fiber.join(exiting)).toMatchObject({ _tag: "Succeeded" })
      expect(yield* Deferred.isDone(lockReleased)).toBe(true)
      expect(yield* Fiber.join(running)).toEqual({ _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" })
      expect((yield* storage.read(runId)).map(({ event }) => event._tag)).toEqual([
        "WorkflowRunBegan",
        "ControlDirectionApplied"
      ])
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

const graphContaining = (taskId: TaskId) => {
  const projection = TaskDagSnapshot.project(
    TrackerSnapshot.make({
      revision: TrackerRevision.make(`bootstrap-control-${taskId}`),
      tasks: [{ id: taskId, lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
    })
  )
  if (projection._tag !== "Valid") throw new Error("bootstrap control fixture graph must project")
  return projection.snapshot
}

it.effect("reads the current Run target before applying Alice's task Pause", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-current-task-control")
      const runId = yield* freshWorkflowRunId(target)
      const taskId = TaskId.make("task-2")
      const requestedTargets = yield* Ref.make<ReadonlyArray<typeof target>>([])
      const tracker = TrackerGraphReader.of({
        read: (requestedTarget) =>
          Ref.update(requestedTargets, (current) => [...current, requestedTarget as typeof target]).pipe(
            Effect.as(graphContaining(taskId))
          ),
        readTaskWorkSpecification: () => Effect.die("unused")
      })
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      const bootstrap = yield* buildBootstrap(runId, storage, tracker)
      const active = yield* Deferred.make<void>()
      const finish = yield* Deferred.make<void>()
      const running = yield* bootstrap
        .activate(
          target,
          Effect.succeed(initialPolicy),
          runId,
          Deferred.succeed(active, undefined).pipe(
            Effect.andThen(Deferred.await(finish)),
            Effect.as(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })))
          )
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(active)

      const applied = yield* bootstrap.operatorControl.applyControlDirection({
        direction: "Pause",
        subject: { _tag: "Task", runId, taskId }
      })

      expect(yield* Ref.get(requestedTargets)).toEqual([target])
      expect(applied.event).toMatchObject({
        _tag: "ControlDirectionApplied",
        direction: "Pause",
        subject: { _tag: "Task", runId, taskId }
      })
      expect((yield* storage.read(runId)).map(({ event }) => event._tag)).toEqual([
        "WorkflowRunBegan",
        "TaskTrackerReadIntentRecorded",
        "TaskTrackerFactsObserved",
        "ControlDirectionApplied"
      ])
      yield* Deferred.succeed(finish, undefined)
      yield* Fiber.join(running)
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("rejects Alice's stale task Pause and Unpause visibly without applying either direction", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-stale-task-control")
      const runId = yield* freshWorkflowRunId(target)
      const taskId = TaskId.make("task-2")
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      const bootstrap = yield* buildBootstrap(runId, storage)
      const active = yield* Deferred.make<void>()
      const finish = yield* Deferred.make<void>()
      const running = yield* bootstrap
        .activate(
          target,
          Effect.succeed(initialPolicy),
          runId,
          Deferred.succeed(active, undefined).pipe(
            Effect.andThen(Deferred.await(finish)),
            Effect.as(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })))
          )
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(active)

      for (const direction of ["Pause", "Unpause"] as const) {
        const rejection = yield* bootstrap.operatorControl
          .applyControlDirection({ direction, subject: { _tag: "Task", runId, taskId } })
          .pipe(Effect.flip)

        expect(rejection).toMatchObject({
          _tag: "TaskControlSubjectOutsideRun",
          direction,
          reason: "OutsideCurrentTargetClosure",
          runId,
          taskId
        })
      }
      expect((yield* storage.read(runId)).map(({ event }) => event._tag)).toEqual([
        "WorkflowRunBegan",
        "TaskTrackerReadIntentRecorded",
        "TaskTrackerFactsObserved",
        "TaskTrackerReadIntentRecorded",
        "TaskTrackerFactsObserved"
      ])
      yield* Deferred.succeed(finish, undefined)
      yield* Fiber.join(running)
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("keeps an unreadable task membership distinct from stale rejection and applies nothing", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-unreadable-task-control")
      const runId = yield* freshWorkflowRunId(target)
      const taskId = TaskId.make("task-2")
      const unreadable = new TrackerAdapterReadError({
        context: TrackerAdapterReadContext.cases.Fixture.make({ operation: "TrackerGraphReader.selectAdapter" }),
        detail: "current target closure is incomplete",
        reason: TrackerAdapterReadFailureReason.cases.IncompleteSnapshot.make({})
      })
      const tracker = TrackerGraphReader.of({
        read: () => Effect.fail(unreadable),
        readTaskWorkSpecification: () => Effect.die("unused")
      })
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      const bootstrap = yield* buildBootstrap(runId, storage, tracker)
      const active = yield* Deferred.make<void>()
      const finish = yield* Deferred.make<void>()
      const running = yield* bootstrap
        .activate(
          target,
          Effect.succeed(initialPolicy),
          runId,
          Deferred.succeed(active, undefined).pipe(
            Effect.andThen(Deferred.await(finish)),
            Effect.as(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })))
          )
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(active)

      const failure = yield* bootstrap.operatorControl
        .applyControlDirection({ direction: "Unpause", subject: { _tag: "Task", runId, taskId } })
        .pipe(Effect.flip)

      expect(failure).toBe(unreadable)
      expect((yield* storage.read(runId)).map(({ event }) => event._tag)).toEqual([
        "WorkflowRunBegan",
        "TaskTrackerReadIntentRecorded",
        "TaskTrackerFactsObserved"
      ])
      const observed = (yield* storage.read(runId)).find(({ event }) => event._tag === "TaskTrackerFactsObserved")
      expect(
        observed?.event._tag === "TaskTrackerFactsObserved" ? observed.event.observation : undefined
      ).toMatchObject({
        _tag: "TaskTrackerFactsReadFailed",
        completeness: "Unreadable",
        failure: { _tag: "TrackerAdapterReadError", reason: { _tag: "IncompleteSnapshot" } }
      })
      yield* Deferred.succeed(finish, undefined)
      yield* Fiber.join(running)
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("rejects another Run's task subject before reading this Run's target", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-foreign-run-task-control")
      const runId = yield* freshWorkflowRunId(target)
      const foreignRunId = yield* freshWorkflowRunId(FixtureTarget.make("another-run-target"))
      const taskId = TaskId.make("task-2")
      const tracker = TrackerGraphReader.of({
        read: () => Effect.die("a foreign Run request must not read the active Run target"),
        readTaskWorkSpecification: () => Effect.die("unused")
      })
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      const bootstrap = yield* buildBootstrap(runId, storage, tracker)
      const active = yield* Deferred.make<void>()
      const finish = yield* Deferred.make<void>()
      const running = yield* bootstrap
        .activate(
          target,
          Effect.succeed(initialPolicy),
          runId,
          Deferred.succeed(active, undefined).pipe(
            Effect.andThen(Deferred.await(finish)),
            Effect.as(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })))
          )
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(active)

      const failure = yield* bootstrap.operatorControl
        .applyControlDirection({ direction: "Pause", subject: { _tag: "Task", runId: foreignRunId, taskId } })
        .pipe(Effect.flip)

      expect(failure).toMatchObject({
        _tag: "InRunJournalRunMismatch",
        expectedRunId: runId,
        requestedRunId: foreignRunId
      })
      expect((yield* storage.read(runId)).map(({ event }) => event._tag)).toEqual(["WorkflowRunBegan"])
      yield* Deferred.succeed(finish, undefined)
      yield* Fiber.join(running)
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("applies Alice's Run Pause without a task-membership read", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-run-control-without-membership")
      const runId = yield* freshWorkflowRunId(target)
      const tracker = TrackerGraphReader.of({
        read: () => Effect.die("Run control must not read task membership"),
        readTaskWorkSpecification: () => Effect.die("unused")
      })
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      const bootstrap = yield* buildBootstrap(runId, storage, tracker)
      const active = yield* Deferred.make<void>()
      const finish = yield* Deferred.make<void>()
      const running = yield* bootstrap
        .activate(
          target,
          Effect.succeed(initialPolicy),
          runId,
          Deferred.succeed(active, undefined).pipe(
            Effect.andThen(Deferred.await(finish)),
            Effect.as(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })))
          )
        )
        .pipe(Effect.forkChild)
      yield* Deferred.await(active)

      const applied = yield* bootstrap.operatorControl.applyControlDirection({
        direction: "Pause",
        subject: { _tag: "Run", runId }
      })
      expect(applied.event).toMatchObject({ _tag: "ControlDirectionApplied", subject: { _tag: "Run", runId } })
      yield* Deferred.succeed(finish, undefined)
      yield* Fiber.join(running)
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)
