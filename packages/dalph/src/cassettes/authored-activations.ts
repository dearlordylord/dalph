import { Deferred, Effect, Fiber, Function, Layer, Ref } from "effect"
import { PlannedAttemptExecutor, type PlannedTaskAttempt } from "@dalph/contracts"
import { ControlledFakeExecutorStep, makeControlledFakePlannedAttemptExecutorLayer } from "@dalph/executor"
import {
  AuthoritativeTaskWorktreeReady,
  controlledTrackerMutationLayerFrom,
  CoordinatorOwnership,
  deterministicOperationIdAllocatorLayer,
  deterministicPlannedTaskAttemptLayer,
  deterministicTaskClaimAcquisitionPlannerLayer,
  GitWorktree,
  gitWorktreeTestLayer,
  type JournalRecord,
  JournalStore,
  journaledFreshRunRecoveryActivationLayer,
  journaledWorkflowInterpreterLayer,
  livePlannedAttemptRecoveryAuthorityLayer,
  makeLiveWorkflowInterpreterLayer,
  makeTaskWorkSpecification,
  memoryJournalStoreLayer,
  PlannedAttemptRecoveryAuthority,
  projectTrackerSnapshot,
  runGitWorktreeReconciliation,
  runWorkflow,
  startupRecoveryLayer,
  TrackerAdapterReadContext,
  TrackerAdapterReadError,
  TrackerAdapterReadFailureReason,
  TrackerGraphReader,
  type TraceItem,
  WorkflowInterpreter,
  WorkflowTrace
} from "@dalph/orchestrator"
import type { AuthoredCassetteLifecycleEvent, AuthoredOutsideOccurrence, AuthoredScenarioCassette } from "./authored.js"

const trackerReadFailure = (detail: string) =>
  new TrackerAdapterReadError({
    context: TrackerAdapterReadContext.cases.Fixture.make({ operation: "TrackerGraphReader.selectAdapter" }),
    detail,
    reason: TrackerAdapterReadFailureReason.cases.IncompleteSnapshot.make({})
  })

const controlledTrackerGraphReaderLayer = (outsideOccurrences: ReadonlyArray<AuthoredOutsideOccurrence>) =>
  Layer.effect(
    TrackerGraphReader,
    Effect.gen(function* () {
      const graphReturns = yield* Ref.make(
        outsideOccurrences.flatMap((occurrence) =>
          occurrence._tag === "TrackerGraphReadReturned" ? [occurrence.graph] : []
        )
      )
      const specificationReturns = yield* Ref.make(
        outsideOccurrences.flatMap((occurrence) =>
          occurrence._tag === "TaskWorkSpecificationReadReturned" ? [occurrence] : []
        )
      )
      return TrackerGraphReader.of({
        read: Effect.fn("ScenarioCassette.TrackerGraphReader.read")(function* () {
          const graph = yield* Ref.modify(graphReturns, (remaining) => [remaining[0], remaining.slice(1)] as const)
          if (graph === undefined) {
            return yield* trackerReadFailure("authored cassette has no tracker graph return for this logical read")
          }
          const projection = projectTrackerSnapshot(graph)
          return projection._tag === "Valid"
            ? projection.snapshot
            : yield* trackerReadFailure(
                `authored cassette tracker graph is invalid: ${projection.issues.map(({ _tag }) => _tag).join(", ")}`
              )
        }),
        readTaskWorkSpecification: Effect.fn("ScenarioCassette.TrackerGraphReader.readTaskWorkSpecification")(
          function* (_target, taskId) {
            const specification = yield* Ref.modify(
              specificationReturns,
              (remaining) => [remaining[0], remaining.slice(1)] as const
            )
            if (specification === undefined) {
              return yield* trackerReadFailure(`authored cassette has no task-work specification return for ${taskId}`)
            }
            if (specification.taskId !== taskId) {
              return yield* trackerReadFailure(
                `authored cassette returned task-work specification ${specification.taskId} for ${taskId}`
              )
            }
            return makeTaskWorkSpecification(specification)
          }
        )
      })
    })
  )

const executorSteps = (
  outsideOccurrences: ReadonlyArray<AuthoredOutsideOccurrence>
): ReadonlyArray<ControlledFakeExecutorStep> =>
  outsideOccurrences.flatMap((occurrence) => {
    if (occurrence._tag !== "PlannedAttemptExecutorWorkReported") return []
    const fields = { correlation: occurrence.report.correlation, report: occurrence.report }
    const step: ControlledFakeExecutorStep =
      occurrence.request === "StartOrContinue"
        ? ControlledFakeExecutorStep.cases.StartOrContinue.make(fields)
        : ControlledFakeExecutorStep.cases.Suspend.make(fields)
    return [step]
  })

export interface AuthoredCassetteActivationRun {
  readonly activationKinds: ReadonlyArray<"Fresh" | "StartupRecovery">
  readonly completedLifecycleEvents: ReadonlyArray<AuthoredCassetteLifecycleEvent>
  readonly records: ReadonlyArray<JournalRecord>
  readonly recoveryAuthorityVerifiedAttemptIds: ReadonlyArray<PlannedTaskAttempt["attemptId"]>
  readonly traceItems: ReadonlyArray<TraceItem>
}

/**
 * Runs one or two coordinator scopes. The journal and controlled boundary
 * state survive coordinator death; allocation and planning services do not.
 */
export const runAuthoredCassetteActivations = Effect.fn("ScenarioCassette.runActivations")(function* (
  cassette: AuthoredScenarioCassette
) {
  const command = cassette.actorCommands[0]
  const observedTraceItems = yield* Ref.make<ReadonlyArray<TraceItem>>([])
  const recoveryAuthorityVerifiedAttemptIds = yield* Ref.make<ReadonlyArray<PlannedTaskAttempt["attemptId"]>>([])
  const trace = WorkflowTrace.of({
    emit: Effect.fn("ScenarioCassette.WorkflowTrace.emit")(function* (item) {
      yield* Ref.update(observedTraceItems, (current) => [...current, item])
    })
  })
  const trackerReaderLayer = controlledTrackerGraphReaderLayer(cassette.outsideOccurrences)
  const trackerMutationLayer = controlledTrackerMutationLayerFrom(cassette.startingFacts.taskClaims)
  const gitWorktreeLayer = gitWorktreeTestLayer(cassette.startingFacts.worktreeObservation)
  const persistentHarnessStateLayer = Layer.mergeAll(
    memoryJournalStoreLayer,
    trackerReaderLayer,
    trackerMutationLayer,
    gitWorktreeLayer
  )
  const coordinatorLocalLayer = (activation: "Fresh" | "StartupRecovery") =>
    Layer.mergeAll(
      deterministicOperationIdAllocatorLayer(
        activation === "Fresh"
          ? `cassette:${command.runId}:operation`
          : `cassette:${command.runId}:startup-recovery:operation`
      ),
      deterministicTaskClaimAcquisitionPlannerLayer({
        owner: command.claimOwner,
        tokenPrefix: command.claimTokenPrefix
      }),
      deterministicPlannedTaskAttemptLayer({
        baseSha: command.baseSha,
        executor: command.executor,
        runId: command.runId,
        worktreeRoot: command.worktreeRoot
      })
    )
  const liveInterpreterLayer = makeLiveWorkflowInterpreterLayer("DeterministicTest")
  const baseInterpreterLayer = Layer.effect(
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
  ).pipe(Layer.provide(liveInterpreterLayer))
  const interpreterLayer = journaledWorkflowInterpreterLayer(command.runId, baseInterpreterLayer)
  const controlledExecutorLayer = makeControlledFakePlannedAttemptExecutorLayer(
    executorSteps(cassette.outsideOccurrences)
  )
  const freshRecoveryLayer = journaledFreshRunRecoveryActivationLayer.pipe(Layer.provide(controlledExecutorLayer))
  const runFresh = runWorkflow(command.target, command.capacity).pipe(
    Effect.provide(
      Layer.mergeAll(
        interpreterLayer,
        freshRecoveryLayer,
        coordinatorLocalLayer("Fresh"),
        Layer.succeed(WorkflowTrace, trace)
      )
    )
  )
  const lifecycleEvent = cassette.lifecycleEvents[0]

  const execution = yield* Effect.gen(function* () {
    const activationKinds = yield* lifecycleEvent === undefined
      ? runFresh.pipe(Effect.as<ReadonlyArray<"Fresh" | "StartupRecovery">>(["Fresh"]))
      : Effect.gen(function* () {
          const responsibilityReached = yield* Deferred.make<PlannedTaskAttempt>()
          const deathExecutorLayer = Layer.succeed(
            PlannedAttemptExecutor,
            PlannedAttemptExecutor.of({
              project: Function.constant(Effect.succeedNone),
              requestSuspension: Function.constant(Effect.never),
              startOrContinue: (plannedAttempt) =>
                Deferred.succeed(responsibilityReached, plannedAttempt).pipe(Effect.andThen(Effect.never))
            })
          )
          const deathRecoveryLayer = journaledFreshRunRecoveryActivationLayer.pipe(Layer.provide(deathExecutorLayer))
          yield* Effect.scoped(
            Effect.gen(function* () {
              const firstActivation = yield* runWorkflow(command.target, command.capacity).pipe(
                Effect.provide(
                  Layer.mergeAll(
                    interpreterLayer,
                    deathRecoveryLayer,
                    coordinatorLocalLayer("Fresh"),
                    Layer.succeed(WorkflowTrace, trace)
                  )
                ),
                Effect.forkScoped
              )
              yield* Deferred.await(responsibilityReached)
              yield* Fiber.interrupt(firstActivation)
            })
          )

          const liveRecoveryAuthorityLayer = livePlannedAttemptRecoveryAuthorityLayer
          const observedRecoveryAuthorityLayer = Layer.effect(
            PlannedAttemptRecoveryAuthority,
            Effect.gen(function* () {
              const authority = yield* PlannedAttemptRecoveryAuthority
              return PlannedAttemptRecoveryAuthority.of({
                verify: (plannedAttempt) =>
                  authority
                    .verify(plannedAttempt)
                    .pipe(
                      Effect.tap(() =>
                        Ref.update(recoveryAuthorityVerifiedAttemptIds, (current) => [
                          ...current,
                          plannedAttempt.attemptId
                        ])
                      )
                    )
              })
            })
          ).pipe(Layer.provide(liveRecoveryAuthorityLayer))
          const ownershipLayer = Layer.succeed(
            CoordinatorOwnership,
            CoordinatorOwnership.of({ runMutation: Function.identity })
          )
          const recoveryLayer = startupRecoveryLayer(command.runId).pipe(
            Layer.provide(interpreterLayer),
            Layer.provide(observedRecoveryAuthorityLayer),
            Layer.provide(controlledExecutorLayer),
            Layer.provide(ownershipLayer),
            Layer.provide(Layer.succeed(WorkflowTrace, trace))
          )
          yield* runWorkflow(command.target, command.capacity).pipe(
            Effect.provide(Layer.merge(recoveryLayer, coordinatorLocalLayer("StartupRecovery")))
          )
          return ["Fresh", "StartupRecovery"] as const
        })
    const records = yield* (yield* JournalStore).read(command.runId)
    return { activationKinds, records }
  }).pipe(Effect.provide(persistentHarnessStateLayer))
  return {
    activationKinds: execution.activationKinds,
    completedLifecycleEvents: cassette.lifecycleEvents,
    records: execution.records,
    recoveryAuthorityVerifiedAttemptIds: yield* Ref.get(recoveryAuthorityVerifiedAttemptIds),
    traceItems: yield* Ref.get(observedTraceItems)
  } satisfies AuthoredCassetteActivationRun
})
