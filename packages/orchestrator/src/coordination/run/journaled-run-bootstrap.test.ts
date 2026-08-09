import { PlannedAttemptExecutor, RunId, TaskId } from "@dalph/contracts"
import { it } from "@effect/vitest"
import { NodeCrypto } from "@effect/platform-node"
import { Context, Deferred, Effect, Fiber, Layer, Option, Ref } from "effect"
import { expect } from "vitest"
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
import { InitialControlPolicy } from "../../control/policy.js"
import { taskWorkCapacityControlLayer } from "../../control/task-work-capacity.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { Journal } from "../delivery/journal.js"
import { deliveryRuntimeResourcesLayer } from "../delivery/delivery-runtime-resources.js"
import { RunFinalityDecision } from "../frontier/frontier.js"
import { memoryJournalStoreLayer } from "../../workflow-journal/adapters/memory-store.js"
import {
  InRunJournal,
  JournalStore,
  journalStoreCapabilities,
  RunLifecycleJournal
} from "../../workflow-journal/store.js"
import { OperationId } from "../../workflow/identity.js"
import { plannedAttemptProtocolControllerLayer } from "../../workflow/protocols/planned-attempt-executor-work/protocol-controller.js"
import { taskTrackerReadIntent } from "../../workflow/registry/event.js"
import { makeTrackerGraphObservationOperation } from "../../workflow/registry/operation.js"
import { intentRecordKey } from "../../workflow-journal/record-key.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { freshWorkflowRunId } from "./fresh-run-identity.js"
import { RunRecoveryProjection } from "./recovery-activation.js"
import { JournaledRunBootstrap } from "./run.js"
import { journaledRunBootstrapLayer } from "./journaled-run-bootstrap.js"
import { WorkflowInterpreter, WorkflowTrace } from "../../workflow/interpretation/interpreter.js"
import { controlDirectionApplicationLayer } from "../../workflow/protocols/control-direction-application/protocol.js"
import { attemptChoiceControlLayer } from "../../workflow/protocols/attempt-choice/control.js"
import { taskClaimReacquisitionControlLayer } from "../../workflow/protocols/task-claim-reacquisition/control.js"
import { TaskClaimReacquisitionRequestId } from "../../workflow/protocols/task-claim-reacquisition/events.js"
import { deterministicOperationIdAllocatorLayer } from "../../workflow/protocols/task-attempt-planning/plan.js"
import { journaledWorkflowInterpreterLayer } from "../../workflow-journal/journaled-interpreter.js"

const initialPolicy = InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(2) })
const finalityProof = (
  decision:
    | ReturnType<typeof RunFinalityDecision.RunMayTerminate>
    | ReturnType<typeof RunFinalityDecision.RunMustRemainActive>
) => ({ acceptedAt: JournalPosition.make(1), decision })
const ownershipLayer = Layer.succeed(
  CoordinatorOwnership,
  CoordinatorOwnership.of({ runMutation: (mutation) => mutation })
)
const emptyGraph = TaskDagSnapshot.project(
  TrackerSnapshot.make({ revision: TrackerRevision.make("bootstrap-control-empty"), tasks: [] })
)
if (emptyGraph._tag !== "Valid") throw new Error("bootstrap control fixture graph must project")

const defaultTrackerGraphReader = TrackerGraphReader.of({
  read: () => Effect.succeed(emptyGraph.snapshot),
  readTaskWorkSpecification: () => Effect.die("unused")
})

const runtimeLayer = (runId: RunId, trackerGraphReader: TrackerGraphReader["Service"] = defaultTrackerGraphReader) =>
  Layer.mergeAll(
    Layer.effect(InRunJournal, InRunJournal),
    attemptChoiceControlLayer,
    controlDirectionApplicationLayer,
    Layer.mock(PlannedAttemptExecutor, {}),
    Layer.mock(RunRecoveryProjection, {
      _tag: "JournaledFreshRunProjection",
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
    deliveryRuntimeResourcesLayer,
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
  trackerGraphReader: TrackerGraphReader["Service"] = defaultTrackerGraphReader
) {
  const journalContext = yield* Layer.build(journalStoreCapabilities(Layer.succeed(JournalStore, storage)))
  const dependencies = Layer.mergeAll(
    Layer.succeed(JournalStore, storage),
    Layer.succeed(RunLifecycleJournal, Context.get(journalContext, RunLifecycleJournal)),
    ownershipLayer
  )
  const application = journaledRunBootstrapLayer(expectedRunId, ({ runId }) =>
    runtimeLayer(runId, trackerGraphReader)
  ).pipe(Layer.provide(dependencies))
  return Context.get(yield* Layer.build(application), JournaledRunBootstrap)
})

it.effect("begins a fresh Run before exposing only its journal-backed runtime capabilities", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-fresh")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      const bootstrap = yield* buildBootstrap(runId, storage)
      const observed = yield* Ref.make<Option.Option<Record<string, unknown>>>(Option.none())

      yield* bootstrap.fresh(
        target,
        initialPolicy,
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

it.effect("accepts recovered bootstrap after an active finality proof", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-incomplete-recovery")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      const bootstrap = yield* buildBootstrap(runId, storage)
      const activations = yield* Ref.make<ReadonlyArray<"Fresh" | "Recovered">>([])
      const active = RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })

      expect(
        yield* bootstrap.fresh(
          target,
          initialPolicy,
          runId,
          Ref.update(activations, (seen) => [...seen, "Fresh" as const]).pipe(Effect.as(finalityProof(active)))
        )
      ).toEqual(active)
      expect(
        yield* bootstrap.recovered(
          target,
          Ref.update(activations, (seen) => [...seen, "Recovered" as const]).pipe(Effect.as(finalityProof(active)))
        )
      ).toEqual(active)

      expect(yield* Ref.get(activations)).toEqual(["Fresh", "Recovered"])
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
        .fresh(
          requestedTarget,
          initialPolicy,
          requestedRunId,
          Effect.succeed(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })))
        )
        .pipe(Effect.flip)

      expect(mismatch).toMatchObject({ _tag: "JournaledRunIdentityMismatch", expectedRunId, requestedRunId })
      expect(yield* storage.read(requestedRunId)).toEqual([])
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
        .fresh(
          target,
          initialPolicy,
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

it.effect("uses the configured Run identity when recovery finds no unfinished Run", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("journaled-bootstrap-empty-recovery")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const storage = Context.get(journalContext, JournalStore)
      const bootstrap = yield* buildBootstrap(runId, storage)

      const failure = yield* bootstrap
        .recovered(
          target,
          Effect.succeed(finalityProof(RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })))
        )
        .pipe(Effect.flip)

      expect(failure).toMatchObject({ _tag: "WorkflowRunNotBegan", runId })
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
        .fresh(
          target,
          initialPolicy,
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
          .recovered(
            target,
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
          .recovered(
            target,
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
        .fresh(
          target,
          initialPolicy,
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
        .recovered(
          target,
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
        .fresh(
          target,
          initialPolicy,
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
        .fresh(
          target,
          initialPolicy,
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
        .fresh(
          target,
          initialPolicy,
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
        .fresh(
          target,
          initialPolicy,
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
        "TaskTrackerReadIntentRecorded"
      ])
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
        .fresh(
          target,
          initialPolicy,
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
        .fresh(
          target,
          initialPolicy,
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
