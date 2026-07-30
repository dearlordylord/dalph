import { Effect, Layer, Schema } from "effect"
import { type RunId } from "@dalph/contracts"
import {
  AuthoritativeTaskWorktreeReady,
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
  makeLiveWorkflowInterpreterLayer,
  memoryJournalStoreLayer,
  reduceWorkflowJournalHistory,
  runGitWorktreeReconciliation,
  runWorkflow,
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
  readonly history: ReturnType<typeof reduceWorkflowJournalHistory>
  readonly observedBehavior: AuthoredObservedBehavior
  readonly records: ReadonlyArray<JournalRecord>
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
  const trace = controlledTrace(cursor)
  const journalLayer = memoryJournalStoreLayer
  const trackerLayer = controlledTrackerGraphReaderLayer(cursor)
  const liveInterpreterLayer = makeLiveWorkflowInterpreterLayer("DeterministicTest").pipe(
    Layer.provide(Layer.merge(trackerLayer, controlledTrackerMutationLayerFrom(cassette.startingFacts.taskClaims)))
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
  ).pipe(
    Layer.provide(liveInterpreterLayer),
    Layer.provide(gitWorktreeTestLayer(cassette.startingFacts.worktreeObservation))
  )
  const executorLayer = controlledExecutorLayer(cursor, runId)
  const workflowLayer = Layer.mergeAll(
    journaledWorkflowInterpreterLayer(runId, authoritativeInterpreterLayer),
    journaledFreshRunRecoveryActivationLayer(runId).pipe(Layer.provide(executorLayer)),
    deterministicOperationIdAllocatorLayer(`cassette:${runId}:operation`),
    deterministicTaskClaimAcquisitionPlannerLayer({ owner: command.claimOwner, tokenPrefix: command.claimTokenPrefix }),
    deterministicPlannedTaskAttemptLayer({
      baseSha: command.baseSha,
      executor: command.executor,
      runId,
      worktreeRoot: command.worktreeRoot
    })
  ).pipe(Layer.provideMerge(journalLayer))

  const records = yield* Effect.gen(function* () {
    yield* runWorkflow(command.target, initial.policy, runId).pipe(Effect.provideService(WorkflowTrace, trace))
    return yield* (yield* JournalStore).read(runId)
  }).pipe(Effect.provide(workflowLayer))
  const assertions = yield* cursor.consumeTerminalAssertions
  const observedBehavior = yield* assertAuthoredExpectedBehavior(records, assertions)
  return {
    cassette,
    history: reduceWorkflowJournalHistory(runId, records),
    observedBehavior,
    records,
    runId
  } satisfies AuthoredScenarioCassetteRun
})
