import { Context, Effect, Fiber, Layer, Option, Ref, Schema } from "effect"
import { type AttemptId, type RunId } from "@dalph/contracts"
import {
  AuthoritativeTaskWorktreeReady,
  CoordinatorOwnership,
  controlledTrackerMutationLayerFrom,
  deterministicOperationIdAllocatorLayer,
  deterministicPlannedTaskAttemptLayer,
  deterministicTaskClaimAcquisitionPlannerLayer,
  freshWorkflowRunId,
  GitWorktree,
  gitWorktreeTestLayer,
  type JournalRecord,
  JournalStore,
  journaledFreshRunRecoveryActivationLayer,
  journaledWorkflowInterpreterLayer,
  livePlannedAttemptRecoveryAuthorityLayer,
  makeLiveWorkflowInterpreterLayer,
  memoryJournalStoreLayer,
  reduceWorkflowJournalHistory,
  PlannedAttemptRecoveryAuthority,
  runGitWorktreeReconciliation,
  runRecoveredWorkflow,
  runWorkflow,
  startupRecoveryLayer,
  taskWorkCapacityControlLayer,
  TaskWorkCapacityControl,
  TrackerMutation,
  WorkflowInterpreter,
  WorkflowTrace
} from "@dalph/orchestrator"
import {
  assertExactlyOneAuthoredCassetteStoryItemOwner,
  AuthoredScenarioCassette,
  type AuthoredObservedBehavior,
  type AuthoredScenarioCassette as ScenarioCassette
} from "./authored-domain.js"
import { controlledExecutorLayer, controlledTrace, controlledTrackerGraphReaderLayer } from "./authored-adapters.js"
import { makeStoryCursor } from "./authored-cursor.js"
import { assertAuthoredExpectedBehavior } from "./authored-outcomes.js"

export interface AuthoredScenarioCassetteRun {
  readonly cassette: ScenarioCassette
  readonly coordinatorActivations: ReadonlyArray<"Fresh" | "Recovered">
  readonly history: ReturnType<typeof reduceWorkflowJournalHistory>
  readonly observedBehavior: AuthoredObservedBehavior
  readonly records: ReadonlyArray<JournalRecord>
  readonly recoveryAuthorityVerifiedAttemptIds: ReadonlyArray<AttemptId>
  readonly runId: RunId
}

/** Decodes and drives one story through the production coordinator activation program. */
export const runAuthoredScenarioCassette = Effect.fn("AuthoredCassette.run")(function* (input: unknown) {
  const cassette = yield* Schema.decodeUnknownEffect(AuthoredScenarioCassette, { onExcessProperty: "error" })(input)
  yield* Effect.forEach(cassette.story, (item) => assertExactlyOneAuthoredCassetteStoryItemOwner(item._tag), {
    discard: true
  })
  const cursor = yield* makeStoryCursor(cassette.story)
  const initial = yield* cursor.consumeInitialPolicy
  const command = yield* cursor.consumeRunCoordinator
  const runId = yield* freshWorkflowRunId(command.target)
  const coordinatorDies = cassette.story.some((item) => item._tag === "CoordinatorProcessDies")
  const recoveryAuthorityVerifiedAttemptIds = yield* Ref.make<ReadonlyArray<AttemptId>>([])
  const trace = controlledTrace(cursor)
  const sharedContext = yield* Layer.build(
    Layer.mergeAll(
      memoryJournalStoreLayer,
      controlledTrackerMutationLayerFrom(cassette.startingFacts.taskClaims),
      gitWorktreeTestLayer(cassette.startingFacts.worktreeObservation)
    )
  ).pipe(Effect.scoped)
  const journalLayer = Layer.succeed(JournalStore, Context.get(sharedContext, JournalStore))
  const trackerMutationLayer = Layer.succeed(TrackerMutation, Context.get(sharedContext, TrackerMutation))
  const gitWorktreeLayer = Layer.succeed(GitWorktree, Context.get(sharedContext, GitWorktree))
  const trackerLayer = controlledTrackerGraphReaderLayer(cursor)
  const liveInterpreterLayer = makeLiveWorkflowInterpreterLayer("DeterministicTest").pipe(
    Layer.provide(Layer.merge(trackerLayer, trackerMutationLayer))
  )
  const authoritativeInterpreterLayer = Layer.effect(
    WorkflowInterpreter,
    Effect.gen(function* () {
      const interpreter = yield* WorkflowInterpreter
      const gitWorktree = yield* GitWorktree
      return WorkflowInterpreter.of({
        ...interpreter,
        reconcileTaskWorktree: (operation) =>
          runGitWorktreeReconciliation(gitWorktree, operation.plannedAttempt).pipe(
            Effect.map((proof) => AuthoritativeTaskWorktreeReady.make({ proof }))
          )
      })
    })
  ).pipe(Layer.provide(liveInterpreterLayer), Layer.provide(gitWorktreeLayer))
  const baseControlPolicyLayer = taskWorkCapacityControlLayer.pipe(Layer.provide(journalLayer))
  const controlledControlPolicyLayer = Layer.effect(
    TaskWorkCapacityControl,
    Effect.gen(function* () {
      const control = yield* TaskWorkCapacityControl
      return TaskWorkCapacityControl.of({
        ...control,
        read: (requestedRunId) =>
          Effect.gen(function* () {
            const change = yield* cursor.consumeCapacityChange
            if (Option.isSome(change)) {
              const current = yield* control.read(requestedRunId)
              yield* control
                .apply({ capacity: change.value.capacity, expectedRevision: current.revision, runId: requestedRunId })
                .pipe(Effect.orDie)
            }
            yield* cursor.pauseAtCoordinatorProcessDeath
            return yield* control.read(requestedRunId)
          })
      })
    })
  ).pipe(Layer.provide(baseControlPolicyLayer))
  const interpreterLayer = journaledWorkflowInterpreterLayer(runId, authoritativeInterpreterLayer).pipe(
    Layer.provide(journalLayer)
  )
  const planningLayer = (phase: "fresh" | "recovery") =>
    Layer.mergeAll(
      deterministicOperationIdAllocatorLayer(
        phase === "fresh" ? `cassette:${runId}:operation` : `cassette:${runId}:recovery:operation`
      ),
      deterministicTaskClaimAcquisitionPlannerLayer({
        owner: command.claimOwner,
        tokenPrefix: command.claimTokenPrefix
      }),
      deterministicPlannedTaskAttemptLayer({
        baseSha: command.baseSha,
        executor: command.executor,
        runId,
        worktreeRoot: command.worktreeRoot
      })
    )
  const freshExecutorLayer = controlledExecutorLayer(cursor, runId)
  const freshWorkflowLayer = Layer.mergeAll(
    interpreterLayer,
    journaledFreshRunRecoveryActivationLayer(runId).pipe(Layer.provide(freshExecutorLayer)),
    planningLayer("fresh"),
    controlledControlPolicyLayer
  ).pipe(Layer.provideMerge(journalLayer))
  const coordinatorOwnershipLayer = Layer.succeed(
    CoordinatorOwnership,
    /* v8 ignore next -- startup only requires capability presence; cassette mutations use controlled authorities. */
    CoordinatorOwnership.of({ runMutation: (mutation) => mutation })
  )
  const recoveryAuthorityLayer = livePlannedAttemptRecoveryAuthorityLayer.pipe(
    Layer.provide(gitWorktreeLayer),
    Layer.provide(trackerMutationLayer),
    Layer.provide(journalLayer)
  )
  const observedRecoveryAuthorityLayer = Layer.effect(
    PlannedAttemptRecoveryAuthority,
    Effect.gen(function* () {
      const authority = yield* PlannedAttemptRecoveryAuthority
      return PlannedAttemptRecoveryAuthority.of({
        verify: Effect.fn("AuthoredCassette.RecoveryAuthority.verify")(function* (plannedAttempt) {
          yield* authority.verify(plannedAttempt)
          yield* Ref.update(recoveryAuthorityVerifiedAttemptIds, (attemptIds) => [
            ...attemptIds,
            plannedAttempt.attemptId
          ])
        })
      })
    })
  ).pipe(Layer.provide(recoveryAuthorityLayer))
  const recoveryExecutorLayer = controlledExecutorLayer(cursor, runId)
  const recoveryStartupLayer = startupRecoveryLayer(runId).pipe(
    Layer.provide(interpreterLayer),
    Layer.provide(observedRecoveryAuthorityLayer),
    Layer.provide(controlledControlPolicyLayer),
    Layer.provide(recoveryExecutorLayer),
    Layer.provide(journalLayer),
    Layer.provide(coordinatorOwnershipLayer),
    Layer.provide(Layer.succeed(WorkflowTrace, trace))
  )
  const recoveryWorkflowLayer = Layer.merge(recoveryStartupLayer, planningLayer("recovery"))

  const records = yield* Effect.scoped(
    Effect.gen(function* () {
      const freshRun = runWorkflow(command.target, initial.policy, runId).pipe(
        Effect.provideService(WorkflowTrace, trace),
        Effect.provide(freshWorkflowLayer)
      )
      if (coordinatorDies) {
        const coordinator = yield* Effect.forkScoped(freshRun)
        yield* Effect.raceFirst(
          cursor.awaitCoordinatorProcessDeath,
          Fiber.join(coordinator).pipe(
            Effect.andThen(Effect.die("fresh coordinator stopped before its authored process-death boundary"))
          )
        )
        yield* Fiber.interrupt(coordinator)
        yield* runRecoveredWorkflow(command.target).pipe(Effect.provide(recoveryWorkflowLayer))
      } else {
        yield* freshRun
      }
      return yield* (yield* JournalStore).read(runId)
    }).pipe(Effect.provide(journalLayer))
  )
  const assertions = yield* cursor.consumeTerminalAssertions
  const observedBehavior = yield* assertAuthoredExpectedBehavior(records, assertions)
  return {
    cassette,
    coordinatorActivations: coordinatorDies ? ["Fresh", "Recovered"] : ["Fresh"],
    history: reduceWorkflowJournalHistory(runId, records),
    observedBehavior,
    records,
    recoveryAuthorityVerifiedAttemptIds: yield* Ref.get(recoveryAuthorityVerifiedAttemptIds),
    runId
  } satisfies AuthoredScenarioCassetteRun
})
