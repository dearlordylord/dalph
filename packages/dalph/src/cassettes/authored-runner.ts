/* eslint-disable max-lines -- One chronological adapter owns fresh, pause, crash, recovery, candidate, and terminal story boundaries. */
import { Context, Deferred, Effect, Exit, Fiber, Layer, Option, Schema, Stream } from "effect"
import { type RunId } from "@dalph/contracts"
import {
  AuthoritativeTaskWorktreeReady,
  ControlDirectionApplication,
  controlDirectionApplicationLayer,
  taskClaimReacquisitionControlLayer,
  CoordinatorOwnership,
  controlledTrackerMutationLayerFrom,
  deterministicOperationIdAllocatorLayer,
  deterministicPlannedTaskAttemptLayer,
  deterministicTaskClaimAcquisitionPlannerLayer,
  CandidateCorrectionLimit,
  CandidateContinuationLimit,
  freshWorkflowRunId,
  GitTargetLineage,
  IntegrationCandidateAgent,
  IntegrationCandidateAgentReport,
  IntegrationCandidateResourceLocator,
  IntegrationCandidateGit,
  IntegrationCandidateGitReadFailure,
  GitWorktree,
  gitTargetLineageTestLayer,
  gitWorktreeTestLayer,
  type JournalRecord,
  JournalStore,
  journalStoreCapabilities,
  JournaledRunBootstrap,
  journaledRunBootstrapLayer,
  type JournaledRuntimeLayerInput,
  journaledWorkflowInterpreterLayer,
  makeLiveWorkflowInterpreterLayer,
  memoryJournalStoreLayer,
  observePlannedAttemptWorktreeThrough,
  observeTargetLineageThrough,
  reduceWorkflowJournalHistory,
  runGitWorktreeReconciliation,
  runRecoveredWorkflow,
  runWorkflow,
  validatedStartupRecoveryLayer,
  taskWorkCapacityControlLayer,
  TargetLineageObservation,
  TestGitWorktree,
  TrackerMutation,
  WorkflowInterpreter,
  WorkflowTrace
} from "@dalph/orchestrator"
import {
  assertExactlyOneAuthoredCassetteStoryItemOwner,
  AuthoredScenarioCassette,
  type AuthoredCassetteStoryItem,
  type AuthoredObservedBehavior,
  type AuthoredScenarioCassette as ScenarioCassette
} from "./authored-domain.js"
import {
  controlledExecutorLayer,
  controlledTrace,
  controlledTrackerGraphReaderLayer,
  controlledTrackerMutationLayer
} from "./authored-adapters.js"
import { makeStoryCursor } from "./authored-cursor.js"
import { assertAuthoredExpectedBehavior } from "./authored-outcomes.js"

export interface AuthoredScenarioCassetteRun {
  readonly cassette: ScenarioCassette
  readonly coordinatorActivations: ReadonlyArray<"Fresh" | "Recovered">
  readonly history: ReturnType<typeof reduceWorkflowJournalHistory>
  readonly observedBehavior: AuthoredObservedBehavior
  readonly records: ReadonlyArray<JournalRecord>
  readonly runId: RunId
}

const minimumCorrectionExhaustionValidationCount = 2
const authoredCandidateContinuationLimit = 2
const authoredSettlementYieldTurns = 10

/** Decodes and drives one story through the production flat-delivery program. */
const runAuthoredScenarioCassetteWith = Effect.fn("AuthoredCassette.runWith")(function* (input: unknown) {
  return yield* Effect.scoped(
    // eslint-disable-next-line complexity -- One chronological adapter owns the fresh, crash, recovery, candidate, and terminal story boundaries.
    Effect.gen(function* () {
      const cassette = yield* Schema.decodeUnknownEffect(AuthoredScenarioCassette, { onExcessProperty: "error" })(input)
      yield* Effect.forEach(cassette.story, (item) => assertExactlyOneAuthoredCassetteStoryItemOwner(item._tag), {
        discard: true
      })
      const cursor = yield* makeStoryCursor(cassette.story)
      const candidateOutcomeRecorded = yield* Deferred.make<void>()
      const candidateTerminalEventTag = cassette.story.some(
        (item) => item._tag === "IntegrationCandidateAgentReported" && item.report._tag === "CorrelationContradiction"
      )
        ? "IntegrationCandidateAgentReported"
        : cassette.story.some(
              (item) =>
                item._tag === "ExpectedBehavior" &&
                item.orchestration?.some((evidence) => evidence._tag === "IntegrationCandidateConstructed")
            )
          ? "IntegrationCandidateConstructed"
          : cassette.story.filter((item) => item._tag === "IntegrationCandidateGitValidationReturned").length >=
              minimumCorrectionExhaustionValidationCount
            ? "IntegrationCandidateCorrectionLimitReached"
            : cassette.story.filter(
                  (item) => item._tag === "IntegrationCandidateAgentReported" && item.report._tag !== "Submitted"
                ).length >= authoredCandidateContinuationLimit
              ? "IntegrationCandidateContinuationLimitReached"
              : cassette.story.some((item) => item._tag === "IntegrationCandidateAgentReported")
                ? "IntegrationCandidateAgentReported"
                : undefined
      const initial = yield* cursor.consumeInitialPolicy
      const command = yield* cursor.consumeRunCoordinator
      const runId = yield* freshWorkflowRunId(command.target)
      const coordinatorDies = cassette.story.some((item) => item._tag === "CoordinatorProcessDies")
      const trace = controlledTrace(cursor)
      const sharedContext = yield* Layer.build(
        Layer.mergeAll(
          memoryJournalStoreLayer,
          controlledTrackerMutationLayerFrom(cassette.startingFacts.taskClaims),
          gitTargetLineageTestLayer(
            cassette.startingFacts.targetLineageObservation ??
              TargetLineageObservation.make({
                plannedBaseIsAncestorOfTargetHead: true,
                plannedBaseSha: command.baseSha,
                targetHeadSha: command.baseSha
              })
          ),
          gitWorktreeTestLayer(cassette.startingFacts.worktreeObservation)
        )
      )
      const sharedJournal = Context.get(sharedContext, JournalStore)
      const journalLayer = journalStoreCapabilities(
        Layer.succeed(
          JournalStore,
          JournalStore.of({
            ...sharedJournal,
            append: (requestedRunId, key, event) =>
              sharedJournal
                .append(requestedRunId, key, event)
                .pipe(
                  Effect.tap(() =>
                    candidateTerminalEventTag !== undefined && event._tag === candidateTerminalEventTag
                      ? Deferred.succeed(candidateOutcomeRecorded, undefined)
                      : Effect.void
                  )
                )
          })
        )
      )
      const applyNextControlDirection = (executorControlDirection: ControlDirectionApplication["Service"]) =>
        Effect.gen(function* () {
          const direction = yield* cursor.consumeInFlightExecutorControlDirection
          if (Option.isNone(direction)) return
          yield* executorControlDirection
            .apply({
              direction: direction.value.direction,
              subject:
                direction.value.subject._tag === "Run"
                  ? { _tag: "Run", runId }
                  : { _tag: "Task", runId, taskId: direction.value.subject.taskId }
            })
            .pipe(Effect.orDie)
        })
      const trackerMutationLayer = controlledTrackerMutationLayer(cursor, Context.get(sharedContext, TrackerMutation))
      const gitWorktreeLayer = Layer.succeed(GitWorktree, Context.get(sharedContext, GitWorktree))
      const gitTargetLineage = Context.get(sharedContext, GitTargetLineage)
      const testGitWorktree = Context.get(sharedContext, TestGitWorktree)
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
            readTaskWorktree: (operation) =>
              Effect.gen(function* () {
                const change = yield* cursor.consumeGitWorktreeObservationChange
                if (Option.isSome(change)) {
                  yield* testGitWorktree.setObservation(change.value.observation)
                }
                return yield* observePlannedAttemptWorktreeThrough(gitWorktree, operation)
              }),
            readTargetLineage: (operation) => observeTargetLineageThrough(gitTargetLineage, operation),
            reconcileTaskWorktree: (operation) =>
              runGitWorktreeReconciliation(gitWorktree, operation.plannedAttempt).pipe(
                Effect.map((proof) => AuthoritativeTaskWorktreeReady.make({ proof }))
              )
          })
        })
      ).pipe(Layer.provide(liveInterpreterLayer), Layer.provide(gitWorktreeLayer))
      const baseControlPolicyLayer = taskWorkCapacityControlLayer
      const operatorControlLayer = Layer.merge(controlDirectionApplicationLayer, taskClaimReacquisitionControlLayer)
      const controlPolicyLayer = Layer.merge(baseControlPolicyLayer, operatorControlLayer)
      const interpreterLayer = journaledWorkflowInterpreterLayer(runId, authoritativeInterpreterLayer)
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
      const candidateLayer = Layer.merge(
        Layer.succeed(
          IntegrationCandidateAgent,
          IntegrationCandidateAgent.of({
            startOrContinue: (request) =>
              cursor.consumeIntegrationCandidateAgentReport.pipe(
                Effect.flatMap((candidateReport) => {
                  if (Option.isNone(candidateReport)) {
                    return Context.get(sharedContext, JournalStore)
                      .read(runId)
                      .pipe(
                        Effect.orDie,
                        Effect.flatMap((candidateRecords) =>
                          Effect.die(
                            `candidate frontier invoked the agent without an authored report: ${candidateRecords
                              .filter(({ event }) => event._tag.startsWith("IntegrationCandidate"))
                              .map(({ event }) => event._tag)
                              .join(",")}`
                          )
                        )
                      )
                  }
                  const authored = candidateReport.value.report
                  return Effect.succeed(
                    authored._tag === "Submitted"
                      ? IntegrationCandidateAgentReport.cases.Submitted.make({
                          candidateCommit: authored.candidateCommit,
                          correlation: request.correlation
                        })
                      : authored._tag === "Conflict"
                        ? IntegrationCandidateAgentReport.cases.Conflict.make({ correlation: request.correlation })
                        : authored._tag === "CorrelationContradiction"
                          ? IntegrationCandidateAgentReport.cases.Working.make({
                              correlation: {
                                ...request.correlation,
                                candidateResource: IntegrationCandidateResourceLocator.make(
                                  "/candidate-resources/authored-foreign"
                                )
                              }
                            })
                          : authored._tag === "ExitedWithoutCandidate"
                            ? IntegrationCandidateAgentReport.cases.ExitedWithoutCandidate.make({
                                correlation: request.correlation
                              })
                            : IntegrationCandidateAgentReport.cases.Working.make({ correlation: request.correlation })
                  )
                })
              )
          })
        ),
        Layer.succeed(
          IntegrationCandidateGit,
          IntegrationCandidateGit.of({
            readSubmittedCommit: (repository, candidateCommit) =>
              cursor.consumeIntegrationCandidateGitValidation.pipe(
                Effect.map(({ observation }) => observation),
                Effect.mapError(
                  (failure) =>
                    new IntegrationCandidateGitReadFailure({
                      candidateCommit,
                      detail: `${failure._tag}: ${
                        /* v8 ignore next -- @preserve The generic interaction-mismatch rendering is exercised at the shared authored cursor boundary. */
                        failure._tag === "AuthoredIntegrationCandidateGitValidationFailure"
                          ? failure.detail
                          : "interaction mismatch"
                      } at story position ${failure.storyPosition}`,
                      repository
                    })
                )
              )
          })
        )
      )
      const coordinatorOwnershipLayer = Layer.succeed(
        CoordinatorOwnership,
        /* v8 ignore next -- startup only requires capability presence; cassette mutations use controlled authorities. */
        CoordinatorOwnership.of({ runMutation: (mutation) => mutation })
      )
      const runtimeLayer = ({ startup }: JournaledRuntimeLayerInput) => {
        const planning = planningLayer(startup === "Fresh" ? "fresh" : "recovery")
        const executorLayer = Layer.unwrap(
          Effect.gen(function* () {
            const controlDirection = yield* ControlDirectionApplication
            return controlledExecutorLayer(cursor, runId, applyNextControlDirection(controlDirection))
          })
        ).pipe(Layer.provide(controlPolicyLayer))
        const startupLayer = validatedStartupRecoveryLayer(
          runId,
          command.integrationTarget,
          startup,
          CandidateCorrectionLimit.make(1),
          CandidateContinuationLimit.make(authoredCandidateContinuationLimit)
        ).pipe(
          Layer.provide(candidateLayer),
          Layer.provide(interpreterLayer),
          Layer.provide(controlPolicyLayer),
          Layer.provide(executorLayer),
          Layer.provide(Layer.succeed(WorkflowTrace, trace)),
          Layer.provide(planning)
        )
        return startupLayer
      }
      const application = journaledRunBootstrapLayer(runId, runtimeLayer).pipe(
        Layer.provide(journalLayer),
        Layer.provide(coordinatorOwnershipLayer)
      )

      const withAuthoredOperatorDriver = <A, E, R>(program: Effect.Effect<A, E, R>) =>
        Effect.scoped(
          Effect.gen(function* () {
            const bootstrap = yield* JournaledRunBootstrap
            const driveCapacityChange = Effect.gen(function* () {
              const change = yield* cursor.consumeCapacityChange
              /* v8 ignore start -- the tag-selected driver exclusively consumes this exact cursor item. */
              if (Option.isNone(change)) return
              /* v8 ignore stop */
              const current = yield* bootstrap.operatorControl.readTaskWorkCapacity(runId)
              yield* bootstrap.operatorControl.setTaskWorkCapacity({
                capacity: change.value.capacity,
                expectedRevision: current.revision,
                runId
              })
            }).pipe(Effect.orDie)
            const driveControlDirection = Effect.gen(function* () {
              const direction = yield* cursor.consumeControlDirection
              /* v8 ignore start -- the tag-selected driver exclusively consumes this exact cursor item. */
              if (Option.isNone(direction)) return
              /* v8 ignore stop */
              yield* bootstrap.operatorControl.applyControlDirection({
                direction: direction.value.direction,
                subject:
                  direction.value.subject._tag === "Run"
                    ? { _tag: "Run", runId }
                    : { _tag: "Task", runId, taskId: direction.value.subject.taskId }
              })
            }).pipe(Effect.orDie)
            const driveClaimReacquisition = Effect.gen(function* () {
              const direction = yield* cursor.consumeClaimReacquisitionDirection
              /* v8 ignore start -- the tag-selected driver exclusively consumes this exact cursor item. */
              if (Option.isNone(direction)) return
              /* v8 ignore stop */
              yield* bootstrap.operatorControl.applyTaskClaimReacquisition({
                requestId: direction.value.requestId,
                subject: { runId, taskId: direction.value.taskId }
              })
            }).pipe(Effect.orDie)
            const drivers: Partial<Record<AuthoredCassetteStoryItem["_tag"], Effect.Effect<void>>> = {
              CoordinatorProcessDies: cursor.pauseAtCoordinatorProcessDeath,
              OperatorAppliesControlDirection: driveControlDirection,
              OperatorDirectsTaskClaimReacquisition: driveClaimReacquisition,
              SetTaskExecutionCapacity: driveCapacityChange
            }
            const driveAuthoredOperatorItem = (item: AuthoredCassetteStoryItem | undefined) => {
              /* v8 ignore start -- scoped execution stops before the cursor can publish its out-of-range sentinel. */
              if (item === undefined) return Effect.void
              /* v8 ignore stop */
              return drivers[item._tag] ?? Effect.void
            }
            yield* cursor.storyItems.pipe(Stream.runForEach(driveAuthoredOperatorItem), Effect.forkScoped)
            return yield* program
          })
        )

      const execution = yield* Effect.scoped(
        Effect.gen(function* () {
          const freshRun = withAuthoredOperatorDriver(
            runWorkflow(command.target, initial.policy, runId).pipe(Effect.provide(planningLayer("fresh")))
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
            const recoveredRun = withAuthoredOperatorDriver(
              runRecoveredWorkflow(command.target).pipe(Effect.provide(planningLayer("recovery")))
            )
            const recovered = yield* recoveredRun.pipe(Effect.forkScoped({ startImmediately: true }))
            yield* Effect.raceFirst(
              cursor.awaitTerminalAssertions,
              Fiber.join(recovered).pipe(
                Effect.andThen(Effect.die("recovered coordinator stopped before the authored terminal assertions"))
              )
            )
            if (candidateTerminalEventTag !== undefined) yield* Deferred.await(candidateOutcomeRecorded)
            for (let settleTurn = 0; settleTurn < authoredSettlementYieldTurns; settleTurn += 1) yield* Effect.yieldNow
            const recoveredCoordinatorExit = recovered.pollUnsafe()
            yield* Fiber.interrupt(recovered)
            return { records: yield* sharedJournal.read(runId), recoveredCoordinatorExit }
          }
          yield* freshRun
          return { records: yield* sharedJournal.read(runId), recoveredCoordinatorExit: undefined }
        }).pipe(Effect.provide(application))
      )
      const { records, recoveredCoordinatorExit } = execution
      if (recoveredCoordinatorExit !== undefined && Exit.isFailure(recoveredCoordinatorExit)) {
        return yield* Effect.failCause(recoveredCoordinatorExit.cause)
      }
      const assertions = yield* cursor.consumeTerminalAssertions
      const behaviorExit = yield* Effect.exit(assertAuthoredExpectedBehavior(records, assertions))
      if (Exit.isFailure(behaviorExit)) {
        return yield* Effect.failCause(behaviorExit.cause)
      }
      const observedBehavior = behaviorExit.value
      return {
        cassette,
        coordinatorActivations: coordinatorDies ? ["Fresh", "Recovered"] : ["Fresh"],
        history: reduceWorkflowJournalHistory(runId, records),
        observedBehavior,
        records,
        runId
      } satisfies AuthoredScenarioCassetteRun
    })
  )
})

/** Decodes and drives one story through the production coordinator activation program. */
export const runAuthoredScenarioCassette = Effect.fn("AuthoredCassette.run")((input: unknown) =>
  runAuthoredScenarioCassetteWith(input)
)
