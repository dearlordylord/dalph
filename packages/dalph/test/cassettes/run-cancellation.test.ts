import { NodeCrypto } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Context, Deferred, Effect, Exit, Fiber, Layer, Option, Ref, Schema } from "effect"
import { expect } from "vitest"
import { PlannedAttemptExecutor, RunId, TaskId } from "@dalph/contracts"
import { CoordinatorOwnership } from "../../../orchestrator/src/authorities/coordinator-ownership/ownership.js"
import { TaskDagSnapshot } from "../../../orchestrator/src/authorities/task-tracker/graph.js"
import { FixtureTarget } from "../../../orchestrator/src/authorities/task-tracker/fixture/target.js"
import { TrackerRevision, TrackerSnapshot } from "../../../orchestrator/src/authorities/task-tracker/task.js"
import { InitialControlPolicy } from "../../../orchestrator/src/control/policy.js"
import { taskWorkCapacityControlLayer } from "../../../orchestrator/src/control/task-work-capacity.js"
import { TaskWorkCapacity } from "../../../orchestrator/src/coordination/admission/capacity.js"
import {
  makeRunFinalityEvidence,
  RunFinalityDecision,
  runTerminationDispositionOf
} from "../../../orchestrator/src/coordination/frontier/run-finality.js"
import { makeApplicationExitShell } from "../../../orchestrator/src/coordination/application-exit/application-shell.js"
import { memoryJournalStoreLayer } from "../../../orchestrator/src/workflow-journal/adapters/memory-store.js"
import {
  InRunJournal,
  JournalStorageUnavailable,
  JournalStore,
  type JournalRecord,
  journalStoreCapabilities,
  RunLifecycleJournal
} from "../../../orchestrator/src/workflow-journal/store.js"
import { decideWorkflowRunTermination } from "../../../orchestrator/src/workflow-journal/run-lifecycle.js"
import { terminationPreconditionIssues } from "../../../orchestrator/src/workflow-journal/termination-preconditions.js"
import { journaledRunBootstrapLayer } from "../../../orchestrator/src/coordination/run/journaled-run-bootstrap.js"
import { noopJournalMaintenanceObservation } from "../../../orchestrator/src/workflow-journal/maintenance.js"
import { JournaledRunBootstrap } from "../../../orchestrator/src/coordination/run/run.js"
import { RunRecoveryProjection } from "../../../orchestrator/src/coordination/run/recovery-activation.js"
import { freshWorkflowRunId } from "../../../orchestrator/src/coordination/run/fresh-run-identity.js"
import { OperationId } from "../../../orchestrator/src/workflow/identity.js"
import { WorkflowInterpreter, WorkflowTrace } from "../../../orchestrator/src/workflow/interpretation/interpreter.js"
import { journaledWorkflowInterpreterLayer } from "../../../orchestrator/src/workflow-journal/journaled-interpreter.js"
import { attemptChoiceControlLayer } from "../../../orchestrator/src/workflow/protocols/attempt-choice/control.js"
import { controlDirectionApplicationLayer } from "../../../orchestrator/src/workflow/protocols/control-direction-application/protocol.js"
import { taskClaimReacquisitionControlLayer } from "../../../orchestrator/src/workflow/protocols/task-claim-reacquisition/control.js"
import { plannedAttemptProtocolControllerLayer } from "../../../orchestrator/src/workflow/protocols/planned-attempt-executor-work/protocol-controller.js"
import { deterministicOperationIdAllocatorLayer } from "../../../orchestrator/src/workflow/protocols/task-attempt-planning/plan.js"
import { DispositionCleanupActivation } from "../../../orchestrator/src/workflow/protocols/disposition-cleanup/loop.js"
import { makeTrackerGraphObservationOperation } from "../../../orchestrator/src/workflow/registry/operation.js"
import {
  idleRunCancellationAuthoredCassette,
  integrationRunCancellationAuthoredCassette,
  runAuthoredScenarioCassette,
  runningAttemptRunCancellationForeignClaimAuthoredCassette,
  runningAttemptRunCancellationAuthoredCassette,
  CassetteIdentityRenaming,
  invertCassetteIdentityRenaming,
  projectRecordedCassette,
  renameRecordedCassette,
  renderRecordedCassetteLyrics,
  verifyRecordedCassetteRoundTrip,
  verifyRecordedCassetteRoundTripWithRenaming
} from "../../src/cassettes/index.js"
import { controlledSynchronousPlannedAttemptExecutorLayer } from "../../test-support/controlled-synchronous-planned-attempt-executor.js"
import {
  remotePublicationGitLayerForTest,
  remoteBaselineGitLayerForTest,
  remotePublicationTargetForTest
} from "../../../orchestrator/test/support/direct-publication.js"

const cancellationInitialPolicy = InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
const projectedCancellationGraph = TaskDagSnapshot.project(
  TrackerSnapshot.make({
    revision: TrackerRevision.make("run-cancellation-terminal-recovery"),
    rootTaskId: TaskId.make("cancel-root"),
    tasks: [
      {
        id: TaskId.make("cancel-root"),
        lifecycle: { _tag: "TerminalWithoutSuccess" },
        parentTaskId: null,
        prerequisiteIds: []
      },
      {
        id: TaskId.make("cancel-dependent"),
        lifecycle: { _tag: "Open" },
        parentTaskId: TaskId.make("cancel-root"),
        prerequisiteIds: [TaskId.make("cancel-root")]
      }
    ]
  })
)
const cancellationGraph = Option.getOrThrow(
  projectedCancellationGraph._tag === "Valid" ? Option.some(projectedCancellationGraph) : Option.none()
)

const expectCancellationTerminationPreconditions = (records: ReadonlyArray<JournalRecord>): void => {
  const termination = records.findLast(({ event }) => event._tag === "WorkflowRunTerminated")
  if (termination?.event._tag !== "WorkflowRunTerminated") return expect.fail("cancellation fixture did not terminate")
  const evidence = termination.event.evidence
  const terminatedRunId = termination.runId
  const prefix = records.filter(({ event }) => event._tag !== "WorkflowRunTerminated")
  expect(terminationPreconditionIssues(prefix, terminatedRunId, evidence)).toEqual([])
}

// Projection assertions reuse each accepted cancellation replay below; no extra
// coordinator run is needed to test pure identity rewriting and rendering.
const expectCancellationRecording = Effect.fn("RunCancellationTest.recording")(function* (
  records: ReadonlyArray<JournalRecord>
) {
  const recorded = yield* projectRecordedCassette(records)
  expect(
    verifyRecordedCassetteRoundTrip(records, recorded).every(
      (checkpoint) =>
        checkpoint.workflowHistoryEquivalent &&
        checkpoint.operationalStateEquivalent &&
        checkpoint.pureSelectionEquivalent
    )
  ).toBe(true)
  const abandoned = recorded.entries.find((entry) => entry._tag === "CancelledAttemptImplementationAbandoned")
  const noRelease = recorded.entries.find((entry) => entry._tag === "CancelledAttemptClaimNoReleaseObserved")
  const claims = [
    ...(abandoned?._tag === "CancelledAttemptImplementationAbandoned" ? [abandoned.authorizedClaim] : []),
    ...(noRelease?._tag === "CancelledAttemptClaimNoReleaseObserved" ? [noRelease.expectedClaim] : [])
  ]
  const operationIds = [
    ...claims.map(({ operationId }) => operationId),
    ...(noRelease?._tag === "CancelledAttemptClaimNoReleaseObserved" ? [noRelease.observationOperationId] : [])
  ].filter((value, index, all) => all.indexOf(value) === index)
  const renaming = yield* Schema.decodeUnknownEffect(CassetteIdentityRenaming)({
    attemptIds:
      abandoned?._tag === "CancelledAttemptImplementationAbandoned"
        ? [{ from: abandoned.plannedAttempt.attemptId, to: "renamed-cancelled-attempt" }]
        : [],
    claimTokens: claims
      .map(({ token }, index) => ({ from: token, to: `renamed-cancelled-claim-${index}` }))
      .filter((value, index, all) => all.findIndex(({ from }) => from === value.from) === index),
    integratorCandidateResourceLocators: [],
    integratorSessionIds: [],
    operationIds: operationIds.map((from, index) => ({ from, to: `renamed-cancelled-operation-${index}` })),
    runIds: [{ from: recorded.runId, to: "renamed-cancelled-run" }],
    taskBranchRefs:
      abandoned?._tag === "CancelledAttemptImplementationAbandoned"
        ? [{ from: abandoned.plannedAttempt.branch, to: "refs/heads/dalph/renamed-cancelled-attempt" }]
        : [],
    worktreeLocators:
      abandoned?._tag === "CancelledAttemptImplementationAbandoned"
        ? [{ from: abandoned.plannedAttempt.worktree, to: "/dalph/renamed-cancelled-attempt" }]
        : []
  })
  const renamed = yield* renameRecordedCassette(recorded, renaming)
  expect(renamed.runId).toBe("renamed-cancelled-run")
  const renamedNoRelease = renamed.entries.find((entry) => entry._tag === "CancelledAttemptClaimNoReleaseObserved")
  if (noRelease?._tag === "CancelledAttemptClaimNoReleaseObserved") {
    if (renamedNoRelease?._tag !== "CancelledAttemptClaimNoReleaseObserved")
      return expect.fail("lost claim preservation")
    expect(renamedNoRelease.expectedClaim.operationId).toBe(
      renaming.operationIds.find(({ from }) => from === noRelease.expectedClaim.operationId)?.to
    )
    expect(renamedNoRelease.observationOperationId).toBe(
      renaming.operationIds.find(({ from }) => from === noRelease.observationOperationId)?.to
    )
  }
  expect(
    (yield* verifyRecordedCassetteRoundTripWithRenaming(
      records,
      renamed,
      invertCassetteIdentityRenaming(renaming)
    )).every((checkpoint) => checkpoint.workflowHistoryEquivalent)
  ).toBe(true)
  const lyrics = renderRecordedCassetteLyrics(renamed)
  expect(lyrics).toContain("Operator applied Run cancellation.")
  if (abandoned !== undefined) {
    expect(lyrics).toContain("abandoned implementation responsibility for cancelled attempt")
  }
  if (noRelease !== undefined) expect(lyrics).toContain("cancelling attempt")
})

const cancellationOwnership = CoordinatorOwnership.of({ release: Effect.void, runMutation: (mutation) => mutation })
const cancellationExecutorLayer = controlledSynchronousPlannedAttemptExecutorLayer(
  Layer.mock(PlannedAttemptExecutor, {})
)

const cancellationRuntimeLayer = (runId: RunId) =>
  Layer.mergeAll(
    Layer.effect(InRunJournal, InRunJournal),
    attemptChoiceControlLayer,
    controlDirectionApplicationLayer,
    cancellationExecutorLayer,
    Layer.mock(RunRecoveryProjection, {
      _tag: "AuthoritativeRunRecoveryProjection",
      runId: RunId.make("run-cancellation-terminal-recovery-fixture"),
      readDeliveryProjection: Effect.succeed({
        evidence: { _tag: "UnavailableDeliveryProjectionEvidence" as const },
        frontier: { explanations: [], transitions: [] }
      }),
      reconstructedPlannedAttemptPositions: []
    }),
    taskWorkCapacityControlLayer,
    taskClaimReacquisitionControlLayer,
    deterministicOperationIdAllocatorLayer(`run-cancellation-terminal-recovery:${runId}`),
    plannedAttemptProtocolControllerLayer,
    journaledWorkflowInterpreterLayer(
      runId,
      Layer.mock(WorkflowInterpreter, { readTrackerGraph: () => Effect.succeed(cancellationGraph.snapshot) })
    ),
    Layer.mock(WorkflowTrace, { emit: () => Effect.void }),
    Layer.succeed(
      DispositionCleanupActivation,
      DispositionCleanupActivation.of({
        responsibilities: { branch: [], candidate: [], worktree: [] },
        run: Effect.succeed({
          branch: undefined,
          branchOutcomes: [],
          candidate: undefined,
          candidateOutcomes: [],
          remaining: { branch: [], candidate: [], worktree: [] },
          selected: { branch: undefined, candidate: undefined, worktree: undefined },
          worktree: undefined,
          worktreeOutcomes: []
        })
      })
    ),
    remoteBaselineGitLayerForTest,
    remotePublicationGitLayerForTest
  )

const buildCancellationBootstrap = Effect.fn("RunCancellationTest.buildBootstrap")(function* (
  expectedRunId: RunId,
  storage: JournalStore["Service"]
) {
  const journalContext = yield* Layer.build(journalStoreCapabilities(Layer.succeed(JournalStore, storage)))
  const dependencies = Layer.mergeAll(
    Layer.succeed(JournalStore, storage),
    Layer.succeed(RunLifecycleJournal, Context.get(journalContext, RunLifecycleJournal)),
    Layer.succeed(CoordinatorOwnership, cancellationOwnership)
  )
  const applicationExit = yield* makeApplicationExitShell(cancellationOwnership, { requestEnd: () => Effect.void })
  const context = yield* Layer.build(
    journaledRunBootstrapLayer(
      expectedRunId,
      ({ runId }) => cancellationRuntimeLayer(runId),
      applicationExit,
      noopJournalMaintenanceObservation,
      undefined,
      remotePublicationTargetForTest
    ).pipe(
      Layer.provide(dependencies),
      Layer.provide(cancellationExecutorLayer),
      Layer.provide(remotePublicationGitLayerForTest)
    )
  )
  return Context.get(context, JournaledRunBootstrap)
})

const cancelledFinalityProof = (runId: RunId, target: ReturnType<typeof FixtureTarget.make>) =>
  Effect.gen(function* () {
    const interpreter = yield* WorkflowInterpreter
    const journal = yield* InRunJournal
    const operation = makeTrackerGraphObservationOperation(
      { _tag: "WorkflowEstablishment" },
      OperationId.make(`cancel-finality:${runId}`),
      target
    )
    const snapshot = yield* interpreter.readTrackerGraph(operation)
    const observation = (yield* journal.read(runId)).findLast(
      ({ event }) => event._tag === "TaskTrackerFactsObserved" && event.operationId === operation.operationId
    )
    if (observation?.event._tag !== "TaskTrackerFactsObserved") {
      return yield* Effect.die("cancellation finality graph read was not recorded")
    }
    const evidence = makeRunFinalityEvidence({
      observedAt: observation.position,
      operationId: operation.operationId,
      readShape: operation.readShape,
      rootTaskId: snapshot.rootTaskId ?? TaskId.make("cancel-root"),
      runId,
      snapshot,
      target
    })
    const disposition = runTerminationDispositionOf(evidence.graphOutcome, true)
    if (disposition === undefined) return yield* Effect.die("cancellation graph must have a terminal disposition")
    return {
      acceptedAt: observation.position,
      decision: RunFinalityDecision.RunMayTerminate(),
      disposition,
      evidence
    } as const
  })

/** Scenario mapping: Alice's idle CancelRun chronology uses the authored runner's production operator boundary. */
it.effect("cancels an idle Run after the durable direction and fresh graph read", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(idleRunCancellationAuthoredCassette)
    yield* expectCancellationRecording(run.records)
    expect(run.records.filter(({ event }) => event._tag === "RunCancellationApplied")).toHaveLength(1)
    expect(run.records.at(-1)?.event).toMatchObject({ _tag: "WorkflowRunTerminated", disposition: "Cancelled" })
    expect(run.observedBehavior.protocolEvidence).toEqual([{ _tag: "RunCancellationApplied" }])
  }).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("cancels a running exact attempt through suspension, claim release, and fresh classification", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(runningAttemptRunCancellationAuthoredCassette)
    yield* expectCancellationRecording(run.records)
    const eventTags = run.records.map(({ event }) => event._tag)
    expect(eventTags.filter((tag) => tag === "RunCancellationApplied")).toHaveLength(1)
    expect(eventTags.filter((tag) => tag === "PlannedAttemptExecutorWorkReported")).toHaveLength(2)
    expect(eventTags.filter((tag) => tag === "CancelledAttemptImplementationAbandoned")).toHaveLength(1)
    expect(eventTags.filter((tag) => tag === "TaskClaimReleaseIntended")).toHaveLength(1)
    expect(eventTags.filter((tag) => tag === "TaskClaimReleased")).toHaveLength(1)
    expect(eventTags.filter((tag) => tag === "TaskWorktreeReady")).toHaveLength(1)
    expect(run.records.at(-1)?.event).toMatchObject({ _tag: "WorkflowRunTerminated", disposition: "Cancelled" })
    expect(eventTags).not.toContain("AttemptImplementationAbandoned")
    expect(eventTags).not.toContain("PlannedAttemptReplaced")
    expectCancellationTerminationPreconditions(run.records)
  }).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("cancels after admitted integration settles without rollback or replacement", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(integrationRunCancellationAuthoredCassette)
    yield* expectCancellationRecording(run.records)
    const eventTags = run.records.map(({ event }) => event._tag)
    expect(eventTags.filter((tag) => tag === "RunCancellationApplied")).toHaveLength(1)
    expect(eventTags.filter((tag) => tag === "IntegrationResponsibilityBegan")).toHaveLength(1)
    expect(eventTags.filter((tag) => tag === "IntegrationStarted")).toHaveLength(1)
    expect(eventTags.filter((tag) => tag === "TargetPromotionObservedSuccess")).toHaveLength(1)
    expect(eventTags.filter((tag) => tag === "CompletionClaimDeleted")).toHaveLength(1)
    expect(eventTags.filter((tag) => tag === "TaskClaimAcquired")).toHaveLength(1)
    expect(eventTags).not.toContain("AttemptImplementationAbandoned")
    expect(eventTags).not.toContain("PlannedAttemptReplaced")
    expect(eventTags).not.toContain("IntegrationRollbackStarted")
    expect(run.records.at(-1)?.event).toMatchObject({ _tag: "WorkflowRunTerminated", disposition: "Cancelled" })
    expectCancellationTerminationPreconditions(run.records)
  }).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("cancels a running exact attempt without releasing a foreign claim", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(runningAttemptRunCancellationForeignClaimAuthoredCassette)
    yield* expectCancellationRecording(run.records)
    const eventTags = run.records.map(({ event }) => event._tag)
    expect(eventTags.filter((tag) => tag === "CancelledAttemptImplementationAbandoned")).toHaveLength(1)
    expect(eventTags.filter((tag) => tag === "CancelledAttemptClaimNoReleaseObserved")).toHaveLength(1)
    expect(eventTags).not.toContain("TaskClaimReleaseIntended")
    expect(eventTags).not.toContain("TaskClaimReleased")
    expect(eventTags).not.toContain("AttemptImplementationAbandoned")
    expect(eventTags).not.toContain("PlannedAttemptReplaced")
    expect(run.records.at(-1)?.event).toMatchObject({ _tag: "WorkflowRunTerminated", disposition: "Cancelled" })
    expectCancellationTerminationPreconditions(run.records)
  }).pipe(Effect.provide(NodeCrypto.layer))
)

/** Scenario mapping: a committed terminal append loses its acknowledgement; the live Journal reconciles it before returning, and a fresh bootstrap must never append a second one. */
it.effect("re-enters once after an unacknowledged cancellation termination append", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const target = FixtureTarget.make("run-cancellation-terminal-recovery")
      const runId = yield* freshWorkflowRunId(target)
      const journalContext = yield* Layer.build(memoryJournalStoreLayer)
      const delegate = Context.get(journalContext, JournalStore)
      const terminationCalls = yield* Ref.make(0)
      const storage = JournalStore.of({
        ...delegate,
        terminateRun: (requestedRunId, disposition, evidence) =>
          Ref.update(terminationCalls, (count) => count + 1).pipe(
            Effect.andThen(delegate.terminateRun(requestedRunId, disposition, evidence)),
            Effect.andThen(
              Effect.fail(
                new JournalStorageUnavailable({
                  detail: "the cancellation terminal record committed before its acknowledgement was lost",
                  operation: "JournalStore.terminateRun"
                })
              )
            )
          )
      })
      const bootstrap = yield* buildCancellationBootstrap(runId, storage)
      const runtimeReady = yield* Deferred.make<void>()
      const continueFinality = yield* Deferred.make<void>()
      const firstActivation = yield* bootstrap
        .activate(
          target,
          Effect.succeed(cancellationInitialPolicy),
          runId,
          Deferred.succeed(runtimeReady, undefined).pipe(
            Effect.andThen(Deferred.await(continueFinality)),
            Effect.andThen(cancelledFinalityProof(runId, target))
          )
        )
        .pipe(Effect.forkChild)

      yield* Deferred.await(runtimeReady)
      expect(yield* bootstrap.operatorControl.applyRunCancellation({ runId })).toMatchObject({
        _tag: "RunCancellationApplied"
      })
      yield* Deferred.succeed(continueFinality, undefined)
      const firstExit = yield* Fiber.await(firstActivation)
      expect(firstExit).toEqual(Exit.succeed({ _tag: "RunMayTerminate" }))

      const firstRecords = yield* delegate.read(runId)
      expect(firstRecords.map(({ event }) => event._tag)).toEqual([
        "WorkflowRunBegan",
        "RemotePublicationAdmissionReadIntended",
        "RemotePublicationAdmissionObserved",
        "RunCancellationApplied",
        "TaskTrackerReadIntentRecorded",
        "TaskTrackerFactsObserved",
        "WorkflowRunTerminated"
      ])
      expectCancellationTerminationPreconditions(firstRecords)
      const terminal = firstRecords.at(-1)
      if (terminal?.event._tag !== "WorkflowRunTerminated") return expect.fail("missing cancellation termination")
      const prefix = firstRecords.slice(0, -1)
      // Exercise the complete storage decision: it checks fresh evidence as
      // well as prefix validity and retained responsibilities.
      expect(
        decideWorkflowRunTermination(prefix, runId, terminal.event.disposition, terminal.event.evidence)._tag
      ).toBe("LifecycleTransitionAccepted")
      for (const tag of [
        "WorkflowRunBegan",
        "RunCancellationApplied",
        "TaskTrackerReadIntentRecorded",
        "TaskTrackerFactsObserved"
      ]) {
        expect(
          decideWorkflowRunTermination(
            prefix.filter(({ event }) => event._tag !== tag),
            runId,
            terminal.event.disposition,
            terminal.event.evidence
          )._tag,
          `missing ${tag}`
        ).toBe("LifecycleTransitionRejected")
      }
      expect(firstRecords.filter(({ event }) => event._tag === "WorkflowRunTerminated")).toHaveLength(1)
      expect(yield* Ref.get(terminationCalls)).toBe(1)

      const reentered = yield* buildCancellationBootstrap(runId, storage)
      const reentryFailure = yield* reentered
        .activate(
          target,
          Effect.die("terminal recovery must not evaluate the initial policy"),
          runId,
          Effect.die("terminal recovery must not enter the runtime")
        )
        .pipe(Effect.flip)
      expect(reentryFailure).toMatchObject({ _tag: "WorkflowRunAlreadyTerminated", runId })
      expect(yield* Ref.get(terminationCalls)).toBe(1)
      expect((yield* delegate.read(runId)).filter(({ event }) => event._tag === "WorkflowRunTerminated")).toHaveLength(
        1
      )
    })
  ).pipe(Effect.provide(NodeCrypto.layer))
)
