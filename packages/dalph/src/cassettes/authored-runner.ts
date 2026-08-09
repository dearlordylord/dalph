/* eslint-disable max-lines -- One chronological adapter owns fresh, pause, crash, recovery, candidate, and terminal story boundaries. */
import { Context, Deferred, Effect, Exit, Fiber, Layer, Option, Ref, Schema, Stream } from "effect"
import { GitCommitSha, type PlannedAttemptExecutorReport, type RunId } from "@dalph/contracts"
import {
  AuthoritativeTaskWorktreeReady,
  attemptChoiceControlLayer,
  AttemptChoiceRequestId,
  controlDirectionApplicationLayer,
  taskClaimReacquisitionControlLayer,
  TaskControlSubjectOutsideRun,
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
  workflowInterpreterLayer,
  makeLiveDeliveryActionExecutor,
  makeTaskWorkSpecificationObservationOperation,
  memoryJournalStoreLayer,
  OperationId,
  OperationSelected,
  observePlannedAttemptWorktreeThrough,
  observeTargetLineageThrough,
  reduceWorkflowJournalHistory,
  runGitWorktreeReconciliation,
  runRecoveredWorkflowWithControlledDeliveryActionExecutor,
  runWorkflowWithControlledDeliveryActionExecutor,
  validatedStartupRecoveryLayer,
  taskWorkCapacityControlLayer,
  TargetLineageObservation,
  TargetVerificationArtifact,
  TargetVerificationBoundary,
  TargetVerificationBoundaryFailure,
  TargetVerificationCorrelation,
  TargetVerificationPlan,
  TargetVerificationRequestId,
  TargetVerificationTerminal,
  TargetPromotionCompareAndSetFailure,
  TargetPromotionCompareAndSetResult,
  TargetPromotionGitReadFailure,
  TargetPromotionGitReadObservation,
  type TargetPromotionGitService,
  memoryEvidenceStoreLayer,
  EvidenceStore,
  TestGitWorktree,
  TrackerMutation,
  TrackerAdapterReadError,
  type DeliveryActionExecutorService,
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
const gitCommitHexLength = 40
const authoredSettlementYieldTurns = 10

const operatorControlFailureMatches = (
  failure: unknown,
  expectedReason: "IncompleteSnapshot" | "OutsideCurrentTargetClosure"
): boolean => {
  if (expectedReason === "OutsideCurrentTargetClosure") {
    return Schema.is(TaskControlSubjectOutsideRun)(failure)
  }
  /* v8 ignore next -- @preserve The only authored tracker-control failure reason is decoded as IncompleteSnapshot. */
  if (!Schema.is(TrackerAdapterReadError)(failure)) return false
  /* v8 ignore next -- @preserve The authored failure schema cannot name another tracker-read reason. */
  return failure.reason._tag === "IncompleteSnapshot"
}

const attemptChoiceFailureReason = (
  failure: unknown
): "AlreadyApplied" | "IdentityContradiction" | "NotAvailable" | "OutsidePreIntegrationPhase" | undefined => {
  if (typeof failure !== "object" || failure === null || !("_tag" in failure)) return undefined
  switch (failure._tag) {
    case "AttemptChoiceAlreadyApplied":
      return "AlreadyApplied"
    case "AttemptChoiceRequestIdentityContradiction":
      return "IdentityContradiction"
    case "AttemptChoiceNotAvailable":
      return "NotAvailable"
    case "AttemptChoiceOutsidePreIntegrationPhase":
      return "OutsidePreIntegrationPhase"
    default:
      return undefined
  }
}

type TargetVerificationStoryResult = Extract<
  AuthoredCassetteStoryItem,
  { readonly _tag: "TargetVerificationReturned" }
>["result"]

const targetVerificationArtifactsFrom = (
  result: TargetVerificationStoryResult
): ReadonlyArray<TargetVerificationArtifact> =>
  result._tag === "CorrelationContradiction"
    ? []
    : result.artifacts.map(({ content, name }) =>
        TargetVerificationArtifact.make({ bytes: new TextEncoder().encode(content), name })
      )

const foreignTargetVerificationTerminalFrom = (
  correlation: TargetVerificationCorrelation
): TargetVerificationTerminal =>
  TargetVerificationTerminal.cases.Failed.make({
    artifacts: [],
    correlation: TargetVerificationCorrelation.make({
      ...correlation,
      candidateCommit: GitCommitSha.make("f".repeat(gitCommitHexLength)),
      requestId: TargetVerificationRequestId.make(`${correlation.requestId}:foreign`)
    })
  })

const passedTargetVerificationTerminalFrom = (
  artifacts: ReadonlyArray<TargetVerificationArtifact>,
  correlation: TargetVerificationCorrelation
): TargetVerificationTerminal => {
  const [first, ...rest] = artifacts
  /* v8 ignore next -- @preserve Authored Passed verification results require at least one declared artifact; non-passing terminals use their distinct cases. */
  return first === undefined
    ? TargetVerificationTerminal.cases.Failed.make({ artifacts: [], correlation })
    : TargetVerificationTerminal.cases.Passed.make({ artifacts: [first, ...rest], correlation })
}

const targetVerificationTerminalFrom = (
  result: TargetVerificationStoryResult,
  correlation: TargetVerificationCorrelation
): TargetVerificationTerminal => {
  const artifacts = targetVerificationArtifactsFrom(result)
  if (result._tag === "CorrelationContradiction") return foreignTargetVerificationTerminalFrom(correlation)
  switch (result._tag) {
    case "Failed":
      return TargetVerificationTerminal.cases.Failed.make({ artifacts, correlation })
    case "Killed":
      return TargetVerificationTerminal.cases.Killed.make({ artifacts, correlation })
    case "Partial":
      return TargetVerificationTerminal.cases.Partial.make({ artifacts, correlation })
    case "Passed": {
      return passedTargetVerificationTerminalFrom(artifacts, correlation)
    }
    case "TimedOut":
      return TargetVerificationTerminal.cases.TimedOut.make({ artifacts, correlation })
  }
}

/** Decodes and drives one story through the ordinary production delivery program. */
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
      const admittedContinuationChoiceApplied = yield* Deferred.make<void>()
      const targetVerificationStory = cassette.story.some((item) => item._tag === "TargetVerificationReturned")
      const targetPromotionStory = cassette.story.some((item) => item._tag.startsWith("TargetPromotion"))
      const candidateTerminalEventTag = targetVerificationStory
        ? cassette.story.some(
            (item) => item._tag === "TargetVerificationReturned" && item.result._tag === "CorrelationContradiction"
          )
          ? "TargetVerificationCorrelationContradicted"
          : "TargetVerificationEvidenceSealed"
        : cassette.story.some(
              (item) =>
                item._tag === "IntegrationCandidateAgentReported" && item.report._tag === "CorrelationContradiction"
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
      const coordinatorLifecycleBoundaryCount = cassette.story.filter(
        (item) => item._tag === "CoordinatorActivationReturned" || item._tag === "CoordinatorProcessDies"
      ).length
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
      const evidenceStoreContext = yield* Layer.build(memoryEvidenceStoreLayer)
      const evidenceStore = Context.get(evidenceStoreContext, EvidenceStore)
      const verificationPlan =
        command.verificationPlanId === null
          ? undefined
          : TargetVerificationPlan.make({ planId: command.verificationPlanId, target: command.integrationTarget })
      const verificationReports = yield* Ref.make<ReadonlyMap<string, TargetVerificationTerminal>>(new Map())
      const targetVerificationBoundary = TargetVerificationBoundary.of({
        runOrResume: (request) =>
          Ref.get(verificationReports).pipe(
            Effect.flatMap((reports) => {
              const existing = reports.get(request.requestId)
              return existing === undefined
                ? cursor.consumeTargetVerificationReturned.pipe(
                    Effect.mapError(
                      /* v8 ignore next -- @preserve Maintained verification cassettes supply the declared wrapper return; generic cursor mismatch behavior is tested at the cursor seam. */
                      (failure) =>
                        new TargetVerificationBoundaryFailure({
                          detail: `${failure._tag} at story position ${failure.storyPosition}`,
                          requestId: request.requestId
                        })
                    ),
                    Effect.map((item) => targetVerificationTerminalFrom(item.result, request)),
                    Effect.tap((terminal) =>
                      Ref.update(verificationReports, (current) => new Map(current).set(request.requestId, terminal))
                    )
                  )
                : Effect.succeed(existing)
            })
          )
      })
      const targetPromotionGit = {
        compareAndSet: (request: Parameters<TargetPromotionGitService["compareAndSet"]>[0]) =>
          cursor.consumeTargetPromotionCompareAndSet.pipe(
            Effect.map(({ result }) =>
              result._tag === "Applied"
                ? TargetPromotionCompareAndSetResult.cases.Applied.make({ newHeadSha: request.candidateCommit })
                : TargetPromotionCompareAndSetResult.cases.RejectedExpectedHead.make({
                    observedHeadSha: result.observedHeadSha
                  })
            ),
            Effect.mapError(
              /* v8 ignore next -- @preserve Maintained promotion cassettes supply the declared compare-and-set occurrence; cursor mismatch behavior is shared. */
              (failure) =>
                new TargetPromotionCompareAndSetFailure({
                  candidateCommit: request.candidateCommit,
                  detail: `${failure._tag}: ${"detail" in failure ? failure.detail : "interaction mismatch"} at story position ${failure.storyPosition}`,
                  expectedHead: request.expectedTargetHead,
                  target: request.integrationTarget
                })
            )
          ),
        read: (request: Parameters<TargetPromotionGitService["read"]>[0]) =>
          cursor.consumeTargetPromotionGitRead.pipe(
            Effect.map(({ observation }) => TargetPromotionGitReadObservation.make(observation)),
            Effect.mapError(
              /* v8 ignore next -- @preserve Authored coordinator runs publish read failure through the runtime relation; the maintained direct protocol cassette owns the typed unreadable chronology. */
              (failure) =>
                new TargetPromotionGitReadFailure({
                  candidateCommit: request.candidateCommit,
                  detail: `${failure._tag}: ${"detail" in failure ? failure.detail : "interaction mismatch"} at story position ${failure.storyPosition}`,
                  target: request.integrationTarget
                })
            )
          )
      }
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
      const activeOperatorControl = yield* Ref.make<
        JournaledRunBootstrap["Service"]["operatorControl"]["applyControlDirection"]
      >(() => Effect.die("operator control is not installed"))
      const applyNextControlDirection = Effect.gen(function* () {
        const direction = yield* cursor.consumeInFlightExecutorControlDirection
        if (Option.isNone(direction)) return
        yield* (yield* Ref.get(activeOperatorControl))({
          direction: direction.value.direction,
          subject:
            direction.value.subject._tag === "Run"
              ? { _tag: "Run", runId }
              : { _tag: "Task", runId, taskId: direction.value.subject.taskId }
        }).pipe(Effect.orDie)
      })
      const trackerMutationLayer = controlledTrackerMutationLayer(cursor, Context.get(sharedContext, TrackerMutation))
      const gitWorktreeLayer = Layer.succeed(GitWorktree, Context.get(sharedContext, GitWorktree))
      const gitTargetLineage = Context.get(sharedContext, GitTargetLineage)
      const testGitWorktree = Context.get(sharedContext, TestGitWorktree)
      const trackerLayer = controlledTrackerGraphReaderLayer(cursor)
      const ordinaryInterpreterLayer = workflowInterpreterLayer.pipe(
        Layer.provide(Layer.merge(trackerLayer, trackerMutationLayer)),
        Layer.provide(gitWorktreeLayer),
        Layer.provide(Layer.succeed(GitTargetLineage, gitTargetLineage))
      )
      const boundaryAdjustedInterpreterLayer = Layer.effect(
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
      ).pipe(Layer.provide(ordinaryInterpreterLayer), Layer.provide(gitWorktreeLayer))
      const baseControlPolicyLayer = taskWorkCapacityControlLayer
      const operatorControlLayer = Layer.mergeAll(
        attemptChoiceControlLayer,
        controlDirectionApplicationLayer,
        taskClaimReacquisitionControlLayer
      )
      const controlPolicyLayer = Layer.merge(baseControlPolicyLayer, operatorControlLayer)
      const interpreterLayer = journaledWorkflowInterpreterLayer(runId, boundaryAdjustedInterpreterLayer)
      const planningLayer = (phase: "fresh" | "recovery", recoveryOrdinal = 1) =>
        Layer.mergeAll(
          deterministicOperationIdAllocatorLayer(
            phase === "fresh"
              ? `cassette:${runId}:operation`
              : recoveryOrdinal === 1
                ? `cassette:${runId}:recovery:operation`
                : `cassette:${runId}:recovery:${recoveryOrdinal}:operation`
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
                  /* v8 ignore next -- @preserve Accepted authored candidate stories declare every report; this diagnostic keeps malformed runtime re-entry total. */
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
      const recoveredRuntimeOrdinal = yield* Ref.make(0)
      const survivingExecutorReports = yield* Ref.make<ReadonlyMap<string, PlannedAttemptExecutorReport>>(new Map())
      const runtimeLayerFor = ({ startup }: JournaledRuntimeLayerInput, recoveryOrdinal: number) => {
        const planning = planningLayer(startup === "Fresh" ? "fresh" : "recovery", recoveryOrdinal)
        const executorLayer = controlledExecutorLayer(
          cursor,
          runId,
          applyNextControlDirection,
          survivingExecutorReports
        ).pipe(Layer.provide(controlPolicyLayer))
        const startupLayer = validatedStartupRecoveryLayer(
          runId,
          command.integrationTarget,
          startup,
          CandidateCorrectionLimit.make(1),
          CandidateContinuationLimit.make(authoredCandidateContinuationLimit),
          verificationPlan === undefined
            ? undefined
            : { boundary: targetVerificationBoundary, evidenceStore, plan: verificationPlan },
          targetPromotionStory ? { git: targetPromotionGit } : undefined
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
      const runtimeLayer = (input: JournaledRuntimeLayerInput) =>
        input.startup === "Fresh"
          ? runtimeLayerFor(input, 0)
          : Layer.unwrap(
              Ref.updateAndGet(recoveredRuntimeOrdinal, (ordinal) => ordinal + 1).pipe(
                Effect.map((ordinal) => runtimeLayerFor(input, ordinal))
              )
            )
      const application = journaledRunBootstrapLayer(runId, runtimeLayer).pipe(
        Layer.provide(journalLayer),
        Layer.provide(coordinatorOwnershipLayer)
      )

      const withAuthoredOperatorDriver = <A, E, R>(program: Effect.Effect<A, E, R>) =>
        Effect.scoped(
          Effect.gen(function* () {
            const bootstrap = yield* JournaledRunBootstrap
            yield* Ref.set(activeOperatorControl, bootstrap.operatorControl.applyControlDirection)
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
            const driveAttemptChoice = Effect.gen(function* () {
              const authored = yield* cursor.consumeAttemptChoice
              if (Option.isNone(authored)) return
              const item = authored.value
              const planned = (yield* sharedJournal.read(runId)).findLast(
                ({ event }) =>
                  event._tag === "TaskAttemptPlanned" &&
                  event.operation.plannedAttempt.attemptId === item.attemptId &&
                  event.operation.plannedAttempt.taskId === item.taskId
              )?.event
              if (planned?._tag !== "TaskAttemptPlanned") {
                return yield* Effect.die(
                  new Error(`authored attempt choice cannot find planned attempt ${item.attemptId}`)
                )
              }
              const requestId = AttemptChoiceRequestId.make({ nonce: item.requestNonce, runId })
              const result = yield* Effect.result(
                bootstrap.operatorControl.applyAttemptChoice({
                  choice:
                    item._tag === "OperatorContinuesAttempt" ? "ContinueExistingAttempt" : "StopTaskImplementation",
                  requestId,
                  subject: {
                    observedTaskRevision: item.observedTaskRevision,
                    plannedAttempt: planned.operation.plannedAttempt
                  }
                })
              )
              if (item.expected._tag === "Rejected") {
                if (result._tag !== "Failure" || attemptChoiceFailureReason(result.failure) !== item.expected.reason) {
                  return yield* Effect.die(
                    new Error(`authored attempt-choice rejection mismatch for ${item.requestNonce}`)
                  )
                }
                return
              }
              if (result._tag !== "Success") {
                return yield* Effect.die(
                  new Error(`authored attempt choice ${item.requestNonce} failed with ${result.failure._tag}`)
                )
              }
              if (
                (item._tag === "OperatorContinuesAttempt" && result.success._tag !== "ContinueApplied") ||
                (item._tag === "OperatorStopsAttempt" &&
                  (result.success._tag !== "StopApplied" || result.success.status._tag !== item.expected.status))
              ) {
                return yield* Effect.die(new Error(`authored attempt-choice result mismatch for ${item.requestNonce}`))
              }
              const queried = yield* bootstrap.operatorControl.readAttemptChoice(requestId)
              if (
                queried._tag !== result.success._tag ||
                (queried._tag === "StopApplied" &&
                  result.success._tag === "StopApplied" &&
                  queried.status._tag !== result.success.status._tag)
              ) {
                return yield* Effect.die(new Error(`authored attempt-choice query mismatch for ${item.requestNonce}`))
              }
              if (item._tag === "OperatorStopsAttempt") {
                yield* Deferred.succeed(admittedContinuationChoiceApplied, undefined)
              }
            }).pipe(Effect.orDie)
            const driveControlDirection = Effect.gen(function* () {
              const direction = yield* cursor.consumeControlDirection
              /* v8 ignore start -- the tag-selected driver exclusively consumes this exact cursor item. */
              if (Option.isNone(direction)) return
              /* v8 ignore stop */
              const result = bootstrap.operatorControl.applyControlDirection({
                direction: direction.value.direction,
                subject:
                  direction.value.subject._tag === "Run"
                    ? { _tag: "Run", runId }
                    : { _tag: "Task", runId, taskId: direction.value.subject.taskId }
              })
              yield* result.pipe(
                Effect.matchEffect({
                  onSuccess: () => Effect.void,
                  onFailure: (failure) =>
                    Effect.gen(function* () {
                      const expected = yield* cursor.consumeControlDirectionFailure
                      /* v8 ignore next -- @preserve Maintained failed-control stories carry the immediately following visible result. */
                      if (Option.isNone(expected)) return yield* failure
                      const expectedFailure = expected.value
                      /* v8 ignore next -- @preserve Both maintained failure variants exercise the matching path; this guard diagnoses malformed authored stories. */
                      if (
                        !operatorControlFailureMatches(failure, expectedFailure.reason) ||
                        direction.value.direction !== expectedFailure.direction ||
                        direction.value.subject._tag !== "Task" ||
                        direction.value.subject.taskId !== expectedFailure.subject.taskId
                      ) {
                        return yield* Effect.die(
                          new Error(
                            `authored control failure mismatch: expected ${expectedFailure.reason}, received ${failure._tag}`
                          )
                        )
                      }
                    })
                })
              )
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
              OperatorContinuesAttempt: driveAttemptChoice,
              OperatorAppliesControlDirection: driveControlDirection,
              OperatorDirectsTaskClaimReacquisition: driveClaimReacquisition,
              OperatorStopsAttempt: driveAttemptChoice,
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

      const controlledExecutorFactory = (factoryRunId: RunId, factoryTarget: typeof command.target) =>
        Effect.gen(function* () {
          const live = yield* makeLiveDeliveryActionExecutor(factoryRunId, factoryTarget)
          const interpreter = yield* WorkflowInterpreter
          const workflowTrace = yield* WorkflowTrace
          return {
            ...live,
            execute: (action, lease) =>
              Effect.gen(function* () {
                const hold = yield* cursor.consumeAdmittedContinuationExecutorIntentHold
                if (Option.isSome(hold)) {
                  const expected = hold.value
                  if (
                    action._tag !== "IdentityFreeAction" ||
                    action.proposal.route._tag !== "IdentityFreeWorkflowRoute" ||
                    action.proposal.route.transition._tag !== "ContinuePlannedAttemptExecutorWork"
                  ) {
                    return yield* Effect.die(
                      new Error(
                        `authored continuation hold expected ContinuePlannedAttemptExecutorWork, received ${action.proposal.route._tag}`
                      )
                    )
                  }
                  const transition = action.proposal.route.transition
                  if (
                    transition.plannedAttempt.attemptId !== expected.attemptId ||
                    transition.plannedAttempt.taskId !== expected.taskId
                  ) {
                    return yield* Effect.die(
                      new Error(
                        `authored continuation hold expected ${expected.taskId}/${expected.attemptId}, received ${transition.plannedAttempt.taskId}/${transition.plannedAttempt.attemptId}`
                      )
                    )
                  }
                  const operation = makeTaskWorkSpecificationObservationOperation(
                    OperationId.make(`cassette:${factoryRunId}:admitted-continuation-race:specification`),
                    factoryTarget,
                    transition.plannedAttempt.taskId
                  )
                  yield* workflowTrace.emit(OperationSelected.make({ operation }))
                  yield* interpreter.readTaskWorkSpecification(operation)
                  yield* Deferred.await(admittedContinuationChoiceApplied)
                }
                return yield* live.execute(action, lease)
              })
          } satisfies DeliveryActionExecutorService
        })

      const execution = yield* Effect.scoped(
        Effect.gen(function* () {
          const freshRun = withAuthoredOperatorDriver(
            runWorkflowWithControlledDeliveryActionExecutor(
              command.target,
              initial.policy,
              runId,
              controlledExecutorFactory
            ).pipe(Effect.provide(planningLayer("fresh")))
          )
          if (coordinatorLifecycleBoundaryCount > 0) {
            let coordinator = yield* Effect.forkScoped(freshRun)
            const coordinatorActivations: Array<"Fresh" | "Recovered"> = ["Fresh"]
            let consumedLifecycleBoundaries = 0
            let recoveryOrdinal = 0
            while (consumedLifecycleBoundaries < coordinatorLifecycleBoundaryCount) {
              const boundary = yield* Effect.raceFirst(
                cursor.awaitCoordinatorProcessDeath.pipe(Effect.as({ _tag: "CoordinatorProcessDied" as const })),
                Fiber.await(coordinator).pipe(
                  Effect.map((exit) => ({ _tag: "CoordinatorActivationReturned" as const, exit }))
                )
              )
              consumedLifecycleBoundaries += 1
              if (boundary._tag === "CoordinatorActivationReturned") {
                if (Exit.isFailure(boundary.exit)) return yield* Effect.failCause(boundary.exit.cause)
                const expected = yield* cursor.consumeCoordinatorActivationReturned
                const actual = boundary.exit.value
                const matches =
                  expected.decision._tag === actual._tag &&
                  (expected.decision._tag === "RunMayTerminate" ||
                    (actual._tag === "RunMustRemainActive" && expected.decision.reason === actual.reason))
                if (!matches) {
                  return yield* Effect.die(
                    `authored coordinator activation expected ${JSON.stringify(expected.decision)}, received ${JSON.stringify(actual)}`
                  )
                }
              } else {
                yield* Fiber.interrupt(coordinator)
              }
              if (yield* cursor.atTerminalAssertions) break
              recoveryOrdinal += 1
              const recoveredRun = withAuthoredOperatorDriver(
                runRecoveredWorkflowWithControlledDeliveryActionExecutor(
                  command.target,
                  controlledExecutorFactory
                ).pipe(Effect.provide(planningLayer("recovery", recoveryOrdinal)))
              )
              coordinator = yield* recoveredRun.pipe(Effect.forkScoped({ startImmediately: true }))
              coordinatorActivations.push("Recovered")
            }
            yield* Effect.raceFirst(
              cursor.awaitTerminalAssertions,
              Fiber.join(coordinator).pipe(
                Effect.andThen(Effect.die("recovered coordinator stopped before the authored terminal assertions"))
              )
            )
            if (candidateTerminalEventTag !== undefined) yield* Deferred.await(candidateOutcomeRecorded)
            for (let settleTurn = 0; settleTurn < authoredSettlementYieldTurns; settleTurn += 1) yield* Effect.yieldNow
            const recoveredCoordinatorExit = coordinator.pollUnsafe()
            yield* Fiber.interrupt(coordinator)
            return { coordinatorActivations, records: yield* sharedJournal.read(runId), recoveredCoordinatorExit }
          }
          yield* freshRun
          return {
            coordinatorActivations: ["Fresh"] as const,
            records: yield* sharedJournal.read(runId),
            recoveredCoordinatorExit: undefined
          }
        }).pipe(Effect.provide(application))
      )
      const { coordinatorActivations, records, recoveredCoordinatorExit } = execution
      /* v8 ignore next -- @preserve Recovered authored runs return success after their declared final read; action failures are asserted by the direct protocol cassette. */
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
        coordinatorActivations,
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
