/* eslint-disable max-lines -- One chronological adapter owns fresh, pause, crash, recovery, candidate, and terminal story boundaries. */
import { Context, Deferred, Effect, Exit, Fiber, Layer, Option, Ref, Schema, Stream } from "effect"
import { type AttemptId, GitCommitSha, type RunId, type TaskId } from "@dalph/contracts"
import {
  AuthoritativeTaskWorktreeReady,
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
  type BoundedTicketRank,
  DeliveryRelationPublicationObserver,
  evaluateDeliveryRelationInputBundle,
  type DeliveryConsequences,
  type DeliveryRelationInputBundle,
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
  type JournalPosition,
  JournalStore,
  journalStoreCapabilities,
  JournaledRunBootstrap,
  journaledRunBootstrapLayer,
  type JournaledRuntimeLayerInput,
  journaledWorkflowInterpreterLayer,
  workflowInterpreterLayer,
  memoryJournalStoreLayer,
  observePlannedAttemptWorktreeThrough,
  observeTargetLineageThrough,
  reduceWorkflowJournalHistory,
  runGitWorktreeReconciliation,
  runRecoveredWorkflow,
  runWorkflow,
  validatedStartupRecoveryLayer,
  taskWorkCapacityControlLayer,
  type TaskWorkCapacity,
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
  type TrackerRevision,
  type TrackerTask,
  TrackerAdapterReadError,
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
  readonly deliveryFrames: ReadonlyArray<AuthoredDeliveryFrame>
  readonly history: ReturnType<typeof reduceWorkflowJournalHistory>
  readonly observedBehavior: AuthoredObservedBehavior
  readonly records: ReadonlyArray<JournalRecord>
  readonly runId: RunId
}

interface AuthoredDeliveryFact {
  readonly kind: string
  readonly exact: string
}

const AuthoredStoryPosition = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
  Schema.brand("AuthoredStoryPosition")
)
type AuthoredStoryPosition = typeof AuthoredStoryPosition.Type

export interface AuthoredDeliveryFrame {
  readonly activation: "Fresh" | "Recovered"
  readonly storyPosition: AuthoredStoryPosition
  readonly acceptedAt: JournalPosition | null
  readonly graph:
    | { readonly _tag: "NotEstablished" }
    | {
        readonly _tag: "Established"
        readonly revision: TrackerRevision
        readonly tasks: ReadonlyArray<{
          readonly id: TaskId
          readonly lifecycle: TrackerTask["lifecycle"]["_tag"]
          readonly parentTaskId: TaskId | null
          readonly prerequisiteIds: ReadonlyArray<TaskId>
        }>
      }
  readonly capacity: TaskWorkCapacity
  readonly heldPositions: ReadonlyArray<{
    readonly taskId: TaskId
    readonly runId: RunId
    readonly attemptId: AttemptId
  }>
  readonly frontier: ReadonlyArray<{
    readonly taskId: TaskId
    readonly standing: "Eligible" | "Excluded"
    readonly reasons: ReadonlyArray<AuthoredDeliveryFact>
  }>
  readonly tickets: ReadonlyArray<{
    readonly taskId: TaskId
    readonly placement: AuthoredDeliveryFact
    readonly rank: BoundedTicketRank | null
    readonly reasons: ReadonlyArray<AuthoredDeliveryFact>
  }>
  readonly deliveries: ReadonlyArray<{
    readonly taskId: TaskId
    readonly placement: AuthoredDeliveryFact
    readonly evidence: ReadonlyArray<AuthoredDeliveryFact>
    readonly standings: ReadonlyArray<AuthoredDeliveryFact>
    readonly obligations: ReadonlyArray<AuthoredDeliveryFact>
  }>
  readonly settlements: ReadonlyArray<{ readonly taskId: TaskId; readonly attemptId: AttemptId }>
  readonly trackerReflection: { readonly _tag: "DeliveryReflection"; readonly settlementCount: number }
}

interface CapturedDeliveryPublication {
  readonly activation: "Fresh" | "Recovered"
  readonly storyPosition: AuthoredStoryPosition
  readonly bundle: DeliveryRelationInputBundle
}

const diagnosticJsonIndent = 2
const authoredDeliveryFactOf = (value: { readonly _tag: string }): AuthoredDeliveryFact => ({
  kind: value._tag,
  exact: JSON.stringify(value, null, diagnosticJsonIndent)
})

const authoredDeliveryFrameOf = (
  captured: CapturedDeliveryPublication,
  consequences: DeliveryConsequences
): AuthoredDeliveryFrame => ({
  activation: captured.activation,
  storyPosition: captured.storyPosition,
  acceptedAt: captured.bundle.legacy.runtimeFacts.acceptedAt,
  graph:
    consequences.graph._tag === "GraphNotEstablished"
      ? { _tag: "NotEstablished" }
      : {
          _tag: "Established",
          revision: consequences.graph.observation.snapshot.revision,
          tasks: consequences.graph.observation.snapshot
            .toWire()
            .tasks.map((task) => ({
              id: task.id,
              lifecycle: task.lifecycle._tag,
              parentTaskId: task.parentTaskId,
              prerequisiteIds: task.prerequisiteIds
            }))
        },
  capacity: captured.bundle.legacy.runtimeFacts.taskWork.capacity,
  heldPositions: captured.bundle.legacy.runtimeFacts.taskWork.held.map(({ correlation, taskId }) => ({
    taskId,
    runId: correlation.runId,
    attemptId: correlation.attemptId
  })),
  frontier: consequences.frontier.standings.map((standing) => ({
    taskId: standing.taskId,
    standing: standing._tag,
    reasons: standing._tag === "Excluded" ? standing.reasons.map(authoredDeliveryFactOf) : []
  })),
  tickets: consequences.tickets.placements.map(({ placement, taskId }) => ({
    taskId,
    placement: authoredDeliveryFactOf(placement),
    rank: "rank" in placement ? placement.rank : null,
    reasons: placement._tag === "GraphExcluded" ? placement.reasons.map(authoredDeliveryFactOf) : []
  })),
  deliveries: consequences.ticketDeliveries.deliveries.map((ticket) => ({
    taskId: ticket.taskId,
    placement: authoredDeliveryFactOf(ticket.placement),
    evidence: ticket.evidence.map(authoredDeliveryFactOf),
    standings: ticket.standings.map(authoredDeliveryFactOf),
    obligations: ticket.obligations.map(authoredDeliveryFactOf)
  })),
  settlements: consequences.settlements.settlements.map(({ attemptId, taskId }) => ({ attemptId, taskId })),
  trackerReflection: {
    _tag: consequences.trackerConsequences._tag,
    settlementCount: consequences.trackerConsequences.source.settlements.length
  }
})

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
      const activeDeliveryActivation = yield* Ref.make<"Fresh" | "Recovered">("Fresh")
      const capturedDeliveryPublications = yield* Ref.make<ReadonlyArray<CapturedDeliveryPublication>>([])
      const publicationObserver = DeliveryRelationPublicationObserver.of({
        observe: (bundle) =>
          Effect.all({ activation: Ref.get(activeDeliveryActivation), storyPosition: cursor.storyPosition }).pipe(
            Effect.flatMap(({ activation, storyPosition }) =>
              Ref.update(capturedDeliveryPublications, (captured) => [
                ...captured,
                { activation, storyPosition: AuthoredStoryPosition.make(storyPosition), bundle }
              ])
            )
          )
      })
      const candidateOutcomeRecorded = yield* Deferred.make<void>()
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
      const operatorControlLayer = Layer.merge(controlDirectionApplicationLayer, taskClaimReacquisitionControlLayer)
      const controlPolicyLayer = Layer.merge(baseControlPolicyLayer, operatorControlLayer)
      const interpreterLayer = journaledWorkflowInterpreterLayer(runId, boundaryAdjustedInterpreterLayer)
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
      const runtimeLayer = ({ startup }: JournaledRuntimeLayerInput) => {
        const planning = planningLayer(startup === "Fresh" ? "fresh" : "recovery")
        const executorLayer = controlledExecutorLayer(cursor, runId, applyNextControlDirection).pipe(
          Layer.provide(controlPolicyLayer)
        )
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
            yield* Ref.set(activeDeliveryActivation, "Recovered")
            const recoveredRun = withAuthoredOperatorDriver(
              runRecoveredWorkflow(command.target).pipe(Effect.provide(planningLayer("recovery")))
            )
            const recovered = yield* recoveredRun.pipe(Effect.forkScoped({ startImmediately: true }))
            yield* Effect.raceFirst(cursor.awaitTerminalAssertions, Fiber.join(recovered))
            if (candidateTerminalEventTag !== undefined) yield* Deferred.await(candidateOutcomeRecorded)
            for (let settleTurn = 0; settleTurn < authoredSettlementYieldTurns; settleTurn += 1) yield* Effect.yieldNow
            const recoveredCoordinatorExit = recovered.pollUnsafe()
            yield* Fiber.interrupt(recovered)
            return { records: yield* sharedJournal.read(runId), recoveredCoordinatorExit }
          }
          yield* freshRun
          return { records: yield* sharedJournal.read(runId), recoveredCoordinatorExit: undefined }
        }).pipe(
          Effect.provide(application),
          Effect.provideService(DeliveryRelationPublicationObserver, publicationObserver)
        )
      )
      const { records, recoveredCoordinatorExit } = execution
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
      const deliveryFrames = yield* Effect.forEach(yield* Ref.get(capturedDeliveryPublications), (captured) =>
        evaluateDeliveryRelationInputBundle(captured.bundle).pipe(
          Effect.map((consequences) => authoredDeliveryFrameOf(captured, consequences))
        )
      )
      return {
        cassette,
        coordinatorActivations: coordinatorDies ? ["Fresh", "Recovered"] : ["Fresh"],
        deliveryFrames,
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
