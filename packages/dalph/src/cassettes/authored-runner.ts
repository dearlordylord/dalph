/* eslint-disable max-lines -- One chronological adapter owns activation, pause, crash, candidate, and terminal story boundaries. */
import {
  Cause,
  Context,
  type Crypto,
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  Match,
  Option,
  Queue,
  Ref,
  Scope,
  type Result,
  Schema,
  Stream
} from "effect"
import {
  AcceptedResultEvidenceManifest,
  type AttemptId,
  type GitCommitSha,
  type IntegrationTarget,
  PlannedAttemptExecutorReport,
  type PlannedTaskAttempt,
  type RunId,
  type TaskId,
  type TaskRevision
} from "@dalph/contracts"
import {
  ApplicationExitShell,
  AuthoritativeTaskWorktreeReady,
  type AttemptChoiceApplicationResult,
  attemptChoiceControlWithProvidedProtocolLayer,
  AttemptChoiceRequestId,
  controlDirectionApplicationLayer,
  taskClaimReacquisitionControlLayer,
  TaskControlSubjectOutsideRun,
  CoordinatorOwnership,
  controlledTrackerMutationLayerFrom,
  deterministicOperationIdAllocatorLayer,
  deterministicPlannedTaskAttemptLayer,
  deterministicTaskClaimAcquisitionPlannerLayer,
  CompletionClaimBoundary,
  CompletionTaskBoundary,
  type CompletionTaskRequest,
  type BoundedTicketRank,
  DeliveryRelationPublicationObserver,
  DeliveryRuntimeObservationObserver,
  evaluateDeliveryRelationAndRuntimeInputBundle,
  type DeliveryConsequences,
  type DeliveryRelationInputBundle,
  type DeliveryRuntimeEvaluation,
  type DeliveryRuntimeLiveOwnerSnapshot,
  deliveryProposalOrderTaskId,
  type JournaledTrackerGraphObservation,
  type RunActivationOpportunityValue,
  freshWorkflowRunId,
  GitTargetLineage,
  GitTargetLineageReadFailure,
  Integrator,
  IntegratorSessionCorrelation,
  IntegratorGit,
  IntegratorGitReadFailure,
  IntegratorResult,
  GitWorktree,
  GitWorktreeCreateFailure,
  gitTargetLineageTestLayer,
  gitWorktreeTestLayer,
  type JournalRecord,
  type JournalPosition,
  OperationId,
  JournalStore,
  noopJournalMaintenanceObservation,
  journalStoreCapabilities,
  JournaledRunBootstrap,
  journaledRunBootstrapLayer,
  makeApplicationExitShell,
  type JournaledRuntimeLayerInput,
  journaledWorkflowInterpreterLayer,
  type PauseProgressView,
  workflowInterpreterLayer,
  makeLiveDeliveryActionExecutor,
  memoryJournalStoreLayer,
  observePlannedAttemptWorktreeThrough,
  observeTargetLineageThrough,
  reduceWorkflowJournalHistory,
  runGitWorktreeReconciliation,
  runWorkflowWithControlledDeliveryActionExecutor,
  runWorkflowWithControlledDeliveryActionExecutorForActiveWorkAuthorityRefresh,
  RunReactivationHint,
  RunReactivationOwner,
  runReactivationOwnerLayer,
  WorkflowRunAlreadyTerminated,
  validatedRunActivationLayer,
  preservingDispositionCleanupBoundaryLayer,
  taskWorkCapacityControlLayer,
  initialRunPolicyRevision,
  RunPolicyRevision,
  type TaskWorkCapacity,
  TargetLineageObservation,
  TargetPromotionCompareAndSetFailure,
  TargetPromotionCompareAndSetResult,
  TargetPromotionRequest,
  TargetPromotionGitReadFailure,
  TargetPromotionGitReadObservation,
  targetPromotionCorrelationFor,
  type TargetPromotionGitService,
  type TraceAtCursor,
  TraceCursor,
  TraceReader,
  TraceReaderLayer,
  memoryEvidenceStoreLayer,
  EvidenceStore,
  type EvidenceStoreFailure,
  TestGitWorktree,
  TrackerMutation,
  type TrackerRevision,
  type TrackerTask,
  TrackerAdapterReadError,
  type DeliveryActionExecutorService,
  WorkflowInterpreter,
  WorkflowTrace
} from "@dalph/orchestrator"
import {
  assertExactlyOneAuthoredCassetteStoryItemOwner,
  AuthoredDeliveryProposalId,
  AuthoredRunActivationOrdinal,
  decodeAuthoredPauseProgressResult,
  type AuthoredRunActivationOrdinal as AuthoredRunActivationOrdinalType,
  AuthoredScenarioCassette,
  type AuthoredCassetteStoryItem,
  type AuthoredObservedBehavior,
  type AuthoredScenarioCassette as ScenarioCassette
} from "./authored-domain.js"
import { controlledExecutorLayer, controlledTrace, controlledTrackerGraphReaderLayer } from "./authored-adapters.js"
import {
  consumeControlledTaskWorkSpecification,
  consumeControlledTrackerGraph
} from "./authored-tracker-read-results.js"
import {
  AuthoredCassetteInteractionMismatch,
  AuthoredCoordinatorProcessDies,
  authoredConcurrentGraphReadCause,
  makeStoryCursor,
  type AuthoredSafelySuspendedExecutorReportItem,
  type AuthoredStoryOccurrenceObserved,
  type StoryCursor
} from "./authored-cursor.js"
import type { AuthoredAttemptChoiceItem } from "./authored-cursor-items.js"
import { assertAuthoredExpectedBehavior } from "./authored-outcomes.js"
import { makeAuthoredRuntimeObservationCaptureObserver } from "./authored-runtime-observation-capture.js"
import { controlledTrackerAuthorityLayer } from "./authored-tracker-authority.js"
import {
  afterAuthoredExecutorReadiness,
  appendAuthoredJournalEvent,
  makeAuthoredExecutorReadiness,
  makeAuthoredProviderReadiness
} from "./authored-provider-readiness.js"
import { makeAuthoredOperatorRequestLifecycle } from "./authored-operator-request-lifecycle.js"

const acceptedSafeReportOrdinal = 2

type AuthoredCapacityOperatorControl = Pick<
  JournaledRunBootstrap["Service"]["operatorControl"],
  "readTaskWorkCapacity" | "setTaskWorkCapacity"
>

type DirectlyDrivenStoryItem = Extract<
  AuthoredCassetteStoryItem,
  {
    readonly _tag:
      | "OperatorAppliesControlDirection"
      | "OperatorAppliesControlDirectionBeforeDeliveryActionAdmission"
      | "OperatorAppliesRunCancellation"
      | "CassetteHoldsPlannedAttemptSuspensionBeforeExecutorBoundary"
      | "CassetteOffersRunReactivationHints"
      | "CassetteHoldsPlannedAttemptContinuationBeforeExecutorBoundary"
      | "CassetteReleasesHeldPlannedAttemptSuspension"
      | "CassetteReleasesHeldPlannedAttemptContinuation"
      | "CassetteReleasesHeldTargetPromotionReconciliationRead"
      | "CassetteHoldsTaskWorkSpecificationReadBeforeBoundary"
      | "CassetteReleasesHeldTaskWorkSpecificationRead"
      | "OperatorContinuesAttempt"
      | "OperatorDirectsTaskClaimReacquisition"
      | "OperatorRacesContinueAndStop"
      | "OperatorRestartsAttempt"
      | "OperatorAwaitsPauseProgress"
      | "OperatorStartsPauseObservation"
      | "OperatorSubscribesToPauseObservation"
      | "OperatorStopsAttempt"
      | "PauseProgressObserved"
      | "PauseProgressObservedCancelledAndReconnected"
      | "SetTaskExecutionCapacity"
  }
>

const directlyDrivenTags: ReadonlySet<AuthoredCassetteStoryItem["_tag"]> = new Set([
  "OperatorAppliesControlDirection",
  "OperatorAppliesControlDirectionBeforeDeliveryActionAdmission",
  "OperatorAppliesRunCancellation",
  "CassetteHoldsPlannedAttemptSuspensionBeforeExecutorBoundary",
  "CassetteOffersRunReactivationHints",
  "CassetteHoldsPlannedAttemptContinuationBeforeExecutorBoundary",
  "CassetteReleasesHeldPlannedAttemptSuspension",
  "CassetteReleasesHeldPlannedAttemptContinuation",
  "CassetteReleasesHeldTargetPromotionReconciliationRead",
  "CassetteHoldsTaskWorkSpecificationReadBeforeBoundary",
  "CassetteReleasesHeldTaskWorkSpecificationRead",
  "OperatorContinuesAttempt",
  "OperatorDirectsTaskClaimReacquisition",
  "OperatorRacesContinueAndStop",
  "OperatorRestartsAttempt",
  "OperatorAwaitsPauseProgress",
  "OperatorStartsPauseObservation",
  "OperatorSubscribesToPauseObservation",
  "OperatorStopsAttempt",
  "PauseProgressObserved",
  "PauseProgressObservedCancelledAndReconnected",
  "SetTaskExecutionCapacity"
])

const isDirectlyDrivenStoryItem = (item: AuthoredCassetteStoryItem | undefined): item is DirectlyDrivenStoryItem =>
  item !== undefined && directlyDrivenTags.has(item._tag)

/** Runs the exact public capacity read/apply/reconcile boundary before publishing its authored occurrence. */
export const driveAuthoredTaskWorkCapacityChange = Effect.fn("AuthoredCassette.driveTaskWorkCapacityChange")(
  function* (request: {
    readonly cursor: StoryCursor
    readonly operatorControl: AuthoredCapacityOperatorControl
    readonly runId: RunId
  }) {
    const change = yield* request.cursor.consumeCapacityChange
    /* v8 ignore start -- the tag-selected driver exclusively consumes this exact cursor item. */
    if (Option.isNone(change)) return
    /* v8 ignore stop */
    const current = yield* request.operatorControl.readTaskWorkCapacity(request.runId)
    const appliedRevision = RunPolicyRevision.make(initialRunPolicyRevision + 1)
    const expectedPolicy = { revision: appliedRevision, taskExecutionCapacity: change.value.capacity }
    const currentMatches =
      current.revision === expectedPolicy.revision &&
      current.taskExecutionCapacity === expectedPolicy.taskExecutionCapacity
    if (currentMatches) {
      yield* request.cursor.settleCapacityChange(change.value)
      return
    }
    if (current.revision !== initialRunPolicyRevision) {
      return yield* new AuthoredCassetteInteractionMismatch({
        actual: JSON.stringify(current),
        expected: JSON.stringify(expectedPolicy),
        storyPosition: yield* request.cursor.storyPosition
      })
    }
    const applied = yield* request.operatorControl.setTaskWorkCapacity({
      capacity: change.value.capacity,
      expectedRevision: current.revision,
      runId: request.runId
    })
    if (
      applied.revision !== expectedPolicy.revision ||
      applied.taskExecutionCapacity !== expectedPolicy.taskExecutionCapacity
    ) {
      return yield* new AuthoredCassetteInteractionMismatch({
        actual: JSON.stringify(applied),
        expected: JSON.stringify(expectedPolicy),
        storyPosition: yield* request.cursor.storyPosition
      })
    }
    yield* request.cursor.settleCapacityChange(change.value)
  }
)

/**
 * After ordinary delivery publishes one exact position, rereads that durable prefix and settles the
 * reserved Safe occurrence as one uninterruptible handoff.
 */
export const settleAuthoredSafelySuspendedPublication = Effect.fn("AuthoredCassette.settleSafelySuspendedPublication")(
  function* (request: {
    readonly acceptedSafeReport: Ref.Ref<Option.Option<AuthoredSafelySuspendedExecutorReportItem>>
    readonly acceptedThrough: JournalPosition | null
    readonly cursor: StoryCursor
    readonly readJournal: JournalStore["Service"]["read"]
    readonly runId: RunId
  }) {
    return yield* Effect.uninterruptible(
      Effect.gen(function* () {
        const reserved = yield* Ref.get(request.acceptedSafeReport)
        if (Option.isNone(reserved) || request.acceptedThrough === null) return false
        const acceptedThrough = request.acceptedThrough
        const records = yield* request.readJournal(request.runId)
        const publishedSafeRecords = records.flatMap(({ event, position }) =>
          position <= acceptedThrough &&
          event._tag === "PlannedAttemptExecutorWorkReported" &&
          event.report._tag === "ExecutorWorkSafelySuspended"
            ? [{ event, position }]
            : []
        )
        const acceptedSafeRecords = publishedSafeRecords.filter(
          ({ event }) =>
            event.report.correlation.runId === request.runId &&
            event.report.correlation.attemptId === reserved.value.report.attemptId
        )
        if (publishedSafeRecords.length === 0) return false
        const exact = acceptedSafeRecords.filter(
          ({ event, position }) => event.ordinal === acceptedSafeReportOrdinal && position === acceptedThrough
        )
        if (acceptedSafeRecords.length !== 1 || exact.length !== 1) {
          return yield* new AuthoredCassetteInteractionMismatch({
            actual: JSON.stringify(
              publishedSafeRecords.map(({ event, position }) => ({
                correlation: event.report.correlation,
                ordinal: event.ordinal,
                position
              }))
            ),
            expected: "one accepted Safe report at ordinal 2 and the published position",
            storyPosition: yield* request.cursor.storyPosition
          })
        }
        yield* request.cursor.settleSafelySuspendedExecutorReport(reserved.value)
        yield* Ref.set(request.acceptedSafeReport, Option.none())
        return true
      })
    )
  }
)

export interface AuthoredScenarioCassetteRun {
  readonly activationOrdinals: ReadonlyArray<AuthoredRunActivationOrdinalType>
  readonly cassette: ScenarioCassette
  readonly deliveryFrames: ReadonlyArray<AuthoredDeliveryFrame>
  readonly observationCaptures: ReadonlyArray<AuthoredObservationCapture>
  readonly observationMoments: ReadonlyArray<AuthoredObservationMoment>
  readonly history: ReturnType<typeof reduceWorkflowJournalHistory>
  readonly observedBehavior: AuthoredObservedBehavior
  readonly records: ReadonlyArray<JournalRecord>
  /** Fresh production reactivation-owner scopes composed by this authored run. */
  readonly reactivationOwnerProcessGenerationCount: number
  readonly runId: RunId
  /** Historical views are read from the production trace reader at exact journal cursors. */
  readonly traceHistories: ReadonlyArray<TraceAtCursor>
}

interface AuthoredTaggedDiagnostic {
  readonly kind: string
  readonly exact: string
}

interface AuthoredActionPlanningFact extends AuthoredTaggedDiagnostic {
  readonly attemptId: AttemptId | null
  /** Human-facing meaning derived while the production proposal or issue remains typed. */
  readonly summary: string
  /** Exact task correlation when the production value carries one. */
  readonly taskId: TaskId | null
}

interface AuthoredObligationDiagnostic extends AuthoredTaggedDiagnostic {
  readonly attemptId: AttemptId | null
  readonly summary: string
}

export interface AuthoredIntegrationOrder {
  /** Accepted executor results whose durable integration responsibility has not yet been recorded. */
  readonly awaitingResponsibility: ReadonlyArray<{
    readonly taskId: TaskId
    readonly runId: RunId
    readonly attemptId: AttemptId
    readonly acceptedCommit: GitCommitSha
    readonly terminalAt: JournalPosition
  }>
  /** Outstanding durable responsibilities in their exact journal order. */
  readonly responsibilities: ReadonlyArray<AuthoredIntegrationOrderResponsibility>
}

interface AuthoredIntegrationOrderResponsibilityBase {
  readonly taskId: TaskId
  readonly runId: RunId
  readonly attemptId: AttemptId
  readonly acceptedCommit: GitCommitSha
  readonly integrationTarget: IntegrationTarget
  readonly queuedAt: JournalPosition
}

type AuthoredIntegrationOrderResponsibility = AuthoredIntegrationOrderResponsibilityBase &
  (
    | { readonly state: "QueuedBeforeCutoff" }
    | { readonly state: "StartedPastCutoff"; readonly startedAt: JournalPosition }
  )

/** Zero-based count of authored interactions consumed when a production delivery publication was captured. */
export const AuthoredStoryPosition = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
  Schema.brand("AuthoredStoryPosition")
)
type AuthoredStoryPosition = typeof AuthoredStoryPosition.Type

/** One scenario-local, replayable rendezvous keyed by the exact authored hint item position. */
export const makeAuthoredHintDeliveryRendezvous = Effect.fn("AuthoredCassette.makeHintDeliveryRendezvous")(
  function* () {
    const deliveries = yield* Ref.make<ReadonlyMap<AuthoredStoryPosition, Deferred.Deferred<void>>>(new Map())
    const deliveryAt = Effect.fn("AuthoredCassette.hintDeliveryAt")(function* (storyPosition: AuthoredStoryPosition) {
      const candidate = yield* Deferred.make<void>()
      return yield* Ref.modify(deliveries, (current) => {
        const existing = current.get(storyPosition)
        return existing === undefined
          ? ([candidate, new Map(current).set(storyPosition, candidate)] as const)
          : ([existing, current] as const)
      })
    })
    const awaitAt = Effect.fn("AuthoredCassette.awaitHintDeliveryAt")(function* (storyPosition: AuthoredStoryPosition) {
      const delivery = yield* deliveryAt(storyPosition)
      yield* Deferred.await(delivery).pipe(
        Effect.ensuring(
          Ref.update(deliveries, (current) => {
            if (current.get(storyPosition) !== delivery) return current
            return new Map([...current].filter(([position]) => position !== storyPosition))
          })
        )
      )
    })
    const completeAt = Effect.fn("AuthoredCassette.completeHintDeliveryAt")(function* (
      storyPosition: AuthoredStoryPosition
    ) {
      const delivery = yield* deliveryAt(storyPosition)
      yield* Deferred.succeed(delivery, undefined)
    })
    return { awaitAt, completeAt }
  }
)

/** Delivers every hint before completing the exact return-to-hints rendezvous. */
export const deliverAuthoredRunReactivationHints = Effect.fn("AuthoredCassette.deliverRunReactivationHints")(function* <
  EOffer,
  ROffer,
  EComplete,
  RComplete
>(request: {
  readonly complete: Effect.Effect<void, EComplete, RComplete>
  readonly hints: ReadonlyArray<"TrackerNotification" | "Timer">
  readonly offer: (hint: "TrackerNotification" | "Timer") => Effect.Effect<void, EOffer, ROffer>
}) {
  yield* Effect.forEach(request.hints, request.offer, { discard: true })
  yield* request.complete
})

/** One-based order assigned when the Lab passively receives an observation during a cassette run. */
export const AuthoredObservationCaptureOrder = Schema.Int.check(Schema.isGreaterThan(0)).pipe(
  Schema.brand("AuthoredObservationCaptureOrder")
)
export type AuthoredObservationCaptureOrder = typeof AuthoredObservationCaptureOrder.Type

interface AuthoredObservationCorrelation {
  readonly activationOrdinal: AuthoredRunActivationOrdinalType
  readonly captureOrder: AuthoredObservationCaptureOrder
  readonly storyPosition: AuthoredStoryPosition
}

/** Raw capture retained in exact local arrival order before Delivery projection is evaluated. */
export type AuthoredObservationCapture = AuthoredObservationCorrelation &
  (
    | { readonly _tag: "AuthoredStoryOccurrenceCaptured"; readonly occurrence: AuthoredCassetteStoryItem }
    | { readonly _tag: "DeliveryPublicationCaptured"; readonly publication: AuthoredDeliveryPublication }
    | {
        readonly _tag: "DeliveryRuntimeOwnersCaptured"
        readonly liveOwners: ReadonlyArray<DeliveryRuntimeLiveOwnerSnapshot>
      }
  )

type AuthoredObservationCaptureInput =
  | { readonly _tag: "AuthoredStoryOccurrenceCaptured"; readonly occurrence: AuthoredCassetteStoryItem }
  | { readonly _tag: "DeliveryPublicationCaptured"; readonly publication: AuthoredDeliveryPublication }
  | {
      readonly _tag: "DeliveryRuntimeOwnersCaptured"
      readonly liveOwners: ReadonlyArray<DeliveryRuntimeLiveOwnerSnapshot>
    }

interface AuthoredObservationMomentContext extends AuthoredObservationCorrelation {
  /** Last coherent Delivery value at this moment; null until the first Delivery publication. */
  readonly deliveryFrame: AuthoredDeliveryFrame | null
  /** Current process-local owner view carried forward from the latest runtime publication. */
  readonly liveOwners: ReadonlyArray<DeliveryRuntimeLiveOwnerSnapshot>
}

/** One exact playback moment. Only DeliveryPublicationMoment changes the source-stage values. */
export type AuthoredObservationMoment = AuthoredObservationMomentContext &
  (
    | { readonly _tag: "AuthoredStoryOccurrenceMoment"; readonly occurrence: AuthoredCassetteStoryItem }
    | { readonly _tag: "DeliveryPublicationMoment"; readonly deliveryFrame: AuthoredDeliveryFrame }
    | { readonly _tag: "DeliveryRuntimeOwnersMoment" }
  )

/** Internal test evidence for one production runtime-observer callback. Not part of the cassette public API. */
export interface InternalAuthoredRuntimeEvaluationCapture {
  readonly activationOrdinal: AuthoredRunActivationOrdinalType
  readonly evaluation: DeliveryRuntimeEvaluation
  readonly storyPosition: AuthoredStoryPosition
}

/** Internal cassette result used only by source-local causal assertions. */
export interface InternalAuthoredScenarioCassetteRun extends AuthoredScenarioCassetteRun {
  readonly runtimeEvaluationCaptures: ReadonlyArray<InternalAuthoredRuntimeEvaluationCapture>
}

export interface AuthoredDeliveryFrame {
  readonly activationOrdinal: AuthoredRunActivationOrdinalType
  readonly storyPosition: AuthoredStoryPosition
  readonly acceptedAt: JournalPosition | null
  readonly graph:
    | { readonly _tag: "NotEstablished" }
    | {
        readonly _tag: "Established"
        readonly revision: TrackerRevision
        /** Exact journal-backed logical read that established this graph publication. */
        readonly observation: {
          readonly operationId: JournaledTrackerGraphObservation["operationId"]
          readonly contentIdentity: JournaledTrackerGraphObservation["contentIdentity"]
          readonly recordedAt: JournaledTrackerGraphObservation["recordedAt"]
        }
        readonly tasks: ReadonlyArray<{
          readonly id: TaskId
          readonly lifecycle: TrackerTask["lifecycle"]["_tag"]
          readonly parentTaskId: TaskId | null
          readonly prerequisiteIds: ReadonlyArray<TaskId>
        }>
      }
  readonly capacity: TaskWorkCapacity
  /** Whether this exact runtime publication permits a finality read or must remain passive. */
  readonly quiescence: DeliveryRelationInputBundle["actionInputs"]["runtimeFacts"]["quiescence"]
  readonly heldPositions: ReadonlyArray<{
    readonly taskId: TaskId
    readonly runId: RunId
    readonly attemptId: AttemptId
  }>
  /** Journal-derived same-target FIFO input; never a persisted queue row or process-local target lease. */
  readonly integrationOrder: AuthoredIntegrationOrder
  readonly frontier: ReadonlyArray<
    | {
        readonly taskId: TaskId
        readonly standing: "Eligible"
        readonly taskRevision: TaskRevision
        readonly reasons: readonly []
      }
    | {
        readonly taskId: TaskId
        readonly standing: "Excluded"
        readonly taskRevision: null
        readonly reasons: ReadonlyArray<AuthoredTaggedDiagnostic>
      }
  >
  readonly tickets: ReadonlyArray<{
    readonly taskId: TaskId
    readonly placement: AuthoredTaggedDiagnostic
    readonly rank: BoundedTicketRank | null
    readonly reasons: ReadonlyArray<AuthoredTaggedDiagnostic>
  }>
  readonly deliveries: ReadonlyArray<{
    readonly taskId: TaskId
    readonly placement: AuthoredTaggedDiagnostic
    readonly evidence: ReadonlyArray<AuthoredTaggedDiagnostic>
    readonly standings: ReadonlyArray<AuthoredTaggedDiagnostic>
    readonly obligations: ReadonlyArray<AuthoredObligationDiagnostic>
  }>
  readonly settlements: ReadonlyArray<{ readonly taskId: TaskId; readonly attemptId: AttemptId }>
  readonly trackerReflection: { readonly _tag: "DeliveryReflection"; readonly settlementCount: number }
  /** Downstream action-planning result; observing it performs no action. */
  readonly actionPlanning:
    | {
        readonly _tag: "DeliveryProposalsAvailable"
        readonly proposals: ReadonlyArray<AuthoredActionPlanningFact>
        readonly isolatedIssues: ReadonlyArray<AuthoredActionPlanningFact>
      }
    | {
        readonly _tag: "DeliveryProposalOwnershipConflict"
        readonly conflicts: ReadonlyArray<AuthoredActionPlanningFact>
      }
}

/** One exact production delivery publication correlated to the authored story cursor. */
export interface AuthoredDeliveryPublication {
  readonly activationOrdinal: AuthoredRunActivationOrdinalType
  readonly storyPosition: AuthoredStoryPosition
  readonly bundle: DeliveryRelationInputBundle
}

export interface AuthoredScenarioCassetteRunOptions {
  /** Synchronous read-only notification; callers must move expensive projection outside the runtime turn. */
  readonly onDeliveryPublication?: (publication: AuthoredDeliveryPublication) => void
  /** Synchronous raw notification in the same deterministic order retained by the completed run. */
  readonly onObservationCapture?: (capture: AuthoredObservationCapture) => void
}

/** The in-memory end condition for one production reactivation-owner process generation. */
type ReactivationOwnerProcessOutcome = "CoordinatorProcessDied" | "TerminalAssertions"

const readyReactivationOwnerPriorityOutcome = Effect.fn("AuthoredCassette.readyReactivationOwnerPriorityOutcome")(
  function* (coordinatorProcessDeaths: Queue.Dequeue<void>, failure: Deferred.Deferred<unknown>) {
    const completedFailure = yield* Deferred.poll(failure)
    if (Option.isSome(completedFailure)) {
      return yield* completedFailure.value.pipe(Effect.flatMap((cause) => Effect.die(cause)))
    }
    const processDeath = yield* Queue.poll(coordinatorProcessDeaths)
    if (Option.isSome(processDeath)) {
      return Option.some<ReactivationOwnerProcessOutcome>("CoordinatorProcessDied")
    }
    return Option.none<ReactivationOwnerProcessOutcome>()
  }
)

/**
 * Waits for one owner generation outcome. Simultaneous-ready priority is owner
 * defect, authored process death, then terminal assertions. The death waiter
 * peeks without consuming; selection atomically polls the exact signal only
 * after proving that no owner defect is ready.
 */
export const awaitReactivationOwnerProcessOutcome = Effect.fn("AuthoredCassette.awaitReactivationOwnerProcessOutcome")(
  function* (
    awaitTerminalAssertions: Effect.Effect<void>,
    coordinatorProcessDeaths: Queue.Dequeue<void>,
    failure: Deferred.Deferred<unknown>
  ) {
    const alreadyReady = yield* readyReactivationOwnerPriorityOutcome(coordinatorProcessDeaths, failure)
    if (Option.isSome(alreadyReady)) return alreadyReady.value

    const wake = yield* Effect.raceAllFirst([
      awaitTerminalAssertions.pipe(Effect.as("TerminalAssertions" as const)),
      Queue.peek(coordinatorProcessDeaths).pipe(Effect.as("HigherPriorityReady" as const)),
      Deferred.await(failure).pipe(Effect.as("HigherPriorityReady" as const))
    ])
    const priorityOutcome = yield* readyReactivationOwnerPriorityOutcome(coordinatorProcessDeaths, failure)
    if (Option.isSome(priorityOutcome)) return priorityOutcome.value
    if (wake === "TerminalAssertions") return wake
    return yield* Effect.die("a ready reactivation-owner priority signal disappeared before selection")
  }
)

type AuthoredPauseObservationResult = (typeof AuthoredCassetteStoryItem.cases.PauseProgressObserved.Type)["result"]
type AuthoredPauseResponsibility =
  | Extract<AuthoredPauseObservationResult, { readonly _tag: "PauseConfirmed" }>["atBoundary"][number]
  | Extract<AuthoredPauseObservationResult, { readonly _tag: "PauseWaiting" }>["preventing"][number]["responsibility"]
type AuthoredPauseBlocker = Extract<
  AuthoredPauseObservationResult,
  { readonly _tag: "PauseWaiting" }
>["preventing"][number]["blockers"][number]
type AuthoredPauseProposal = Extract<AuthoredPauseBlocker, { readonly _tag: "ProposedDeliveryAction" }>["proposal"]
type AuthoredPauseLiveOwner = Extract<AuthoredPauseBlocker, { readonly _tag: "LiveDeliveryAction" }>["owner"]

/* v8 ignore next -- @preserve The production Pause projector excludes the taskless graph proposal before authored projection. */
const taskIdOfPauseProposal = (proposal: DeliveryProposal): TaskId => {
  const taskId = deliveryProposalOrderTaskId(proposal.order)
  return Option.fromNullishOr(taskId).pipe(
    Option.getOrThrowWith(() => new Error("Pause delivery action has no task identity"))
  )
}

/* v8 ignore next -- @preserve Exhaustive route matching retains this impossible graph-proposal defect after the task-identity gate. */
const tasklessPauseProposalDefect = (): never =>
  Option.none<never>().pipe(
    Option.getOrThrowWith(() => new Error("Pause delivery action cannot be a tracker graph read"))
  )

const authoredOperationIdOf = (operationId: string, runId: RunId) =>
  OperationId.make(operationId.replaceAll(runId, "$authored-run"))

const authoredDeliveryProposalIdOf = (proposal: DeliveryProposal, runId: RunId): AuthoredDeliveryProposalId => {
  const taskId = taskIdOfPauseProposal(proposal)
  const identity = Match.valueTags(proposal.route, {
    AcceptedWorkflowRoute: ({ transition }) => [
      "AcceptedWorkflowRoute",
      transition._tag,
      "operationId" in transition
        ? authoredOperationIdOf(transition.operationId, runId)
        : transition.operation._tag === "ReleaseTaskClaim"
          ? authoredOperationIdOf(transition.operation.release.operationId, runId)
          : authoredOperationIdOf(transition.operation.operationId, runId),
      taskId
    ],
    FreshExecutorWorkflowRoute: ({ step }) => [
      "FreshExecutorWorkflowRoute",
      step._tag,
      step.plannedAttempt.attemptId,
      taskId
    ],
    FreshWorkflowRoute: ({ step }) => [
      "FreshWorkflowRoute",
      step._tag,
      "plannedAttempt" in step ? step.plannedAttempt.attemptId : null,
      taskId
    ],
    IdentityFreeWorkflowRoute: ({ transition }) => [
      "IdentityFreeWorkflowRoute",
      transition._tag,
      proposal.admission.plannedAttemptProtocol._tag === "PlannedAttemptProtocolRequired"
        ? proposal.admission.plannedAttemptProtocol.correlation.attemptId
        : null,
      proposal.admission.integrationTarget._tag === "IntegrationTargetResourceRequired"
        ? proposal.admission.integrationTarget.queuedAt
        : null,
      taskId
    ],
    RecoveredNewActionRoute: ({ action }) => [
      "RecoveredNewActionRoute",
      action._tag,
      "plannedAttempt" in action ? (action.plannedAttempt?.attemptId ?? null) : null,
      taskId
    ],
    /* v8 ignore next -- @preserve Pause excludes the taskless tracker-graph proposal before projection. */
    TrackerGraphReadRoute: tasklessPauseProposalDefect
  })
  return AuthoredDeliveryProposalId.make(JSON.stringify(identity))
}

const authoredAcceptanceManifestDigest = "1111111111111111111111111111111111111111111111111111111111111111"

const authoredTargetPromotionRequestOf = (request: TargetPromotionRequest, runId: RunId): TargetPromotionRequest => {
  const normalized = Schema.decodeUnknownSync(TargetPromotionRequest)(
    JSON.parse(JSON.stringify(request).replaceAll(String(runId), "$authored-run"))
  )
  return Schema.decodeUnknownSync(TargetPromotionRequest)({
    ...normalized,
    qualifiedCandidate: {
      ...normalized.qualifiedCandidate,
      run: {
        ...normalized.qualifiedCandidate.run,
        session: {
          ...normalized.qualifiedCandidate.run.session,
          acceptedResult: {
            ...normalized.qualifiedCandidate.run.session.acceptedResult,
            evidenceManifest: {
              ...normalized.qualifiedCandidate.run.session.acceptedResult.evidenceManifest,
              digest: authoredAcceptanceManifestDigest
            }
          }
        }
      }
    }
  })
}

/** Authored stories use the cassette run placeholder while preserving every other Integrator request fact exactly. */
const authoredIntegratorSessionCorrelationOf = (
  correlation: IntegratorSessionCorrelation,
  runId: RunId
): IntegratorSessionCorrelation => {
  const normalized = Schema.decodeUnknownSync(IntegratorSessionCorrelation)(
    JSON.parse(JSON.stringify(correlation).replaceAll(String(runId), "$authored-run"))
  )
  return Schema.decodeUnknownSync(IntegratorSessionCorrelation)({
    ...normalized,
    acceptedResult: {
      ...normalized.acceptedResult,
      evidenceManifest: { ...normalized.acceptedResult.evidenceManifest, digest: authoredAcceptanceManifestDigest }
    }
  })
}

const authoredTargetPromotionGitRequestMatches = (
  request: Parameters<TargetPromotionGitService["read"]>[0],
  expected: TargetPromotionRequest
): boolean =>
  request.candidateCommit === expected.qualifiedCandidate.candidateCommit &&
  request.expectedTargetHead === expected.qualifiedCandidate.run.session.expectedTargetHead &&
  request.integrationTarget.repository === expected.qualifiedCandidate.run.session.integrationTarget.repository &&
  request.integrationTarget.ref === expected.qualifiedCandidate.run.session.integrationTarget.ref

const targetPromotionRequestOf = (
  transition: Extract<
    Extract<DeliveryProposal["route"], { readonly _tag: "IdentityFreeWorkflowRoute" }>["transition"],
    { readonly _tag: "RunTargetPromotion" }
  >,
  runId: RunId
): TargetPromotionRequest => {
  const request = targetPromotionCorrelationFor(transition.candidate)
  return authoredTargetPromotionRequestOf(request, runId)
}

const authoredTaskOrAttemptCorrelationOf = (
  plannedAttempt: PlannedTaskAttempt | null
): Extract<AuthoredPauseProposal, { readonly _tag: "RecoveredNewActionRoute" }>["correlation"] =>
  plannedAttempt === null ? { _tag: "Task" } : { _tag: "Attempt", attemptId: plannedAttempt.attemptId }

const authoredPauseProposalOf = (proposal: DeliveryProposal, runId: RunId): AuthoredPauseProposal => {
  const proposalId = authoredDeliveryProposalIdOf(proposal, runId)
  const taskId = taskIdOfPauseProposal(proposal)
  return Match.valueTags(proposal.route, {
    AcceptedWorkflowRoute: ({ transition }) => ({
      _tag: "AcceptedWorkflowRoute" as const,
      operationId:
        "operationId" in transition
          ? authoredOperationIdOf(transition.operationId, runId)
          : transition.operation._tag === "ReleaseTaskClaim"
            ? authoredOperationIdOf(transition.operation.release.operationId, runId)
            : authoredOperationIdOf(transition.operation.operationId, runId),
      proposalId,
      taskId
    }),
    FreshExecutorWorkflowRoute: ({ step }) => ({
      _tag: "FreshExecutorWorkflowRoute" as const,
      attemptId: step.plannedAttempt.attemptId,
      proposalId,
      taskId
    }),
    FreshWorkflowRoute: ({ step }) => ({
      _tag: "FreshWorkflowRoute" as const,
      correlation:
        "plannedAttempt" in step ? authoredTaskOrAttemptCorrelationOf(step.plannedAttempt) : { _tag: "Task" as const },
      proposalId,
      taskId
    }),
    IdentityFreeWorkflowRoute: ({ transition }) => {
      const integration = proposal.admission.integrationTarget
      const protocol = proposal.admission.plannedAttemptProtocol
      const correlation =
        transition._tag === "RunTargetPromotion"
          ? {
              _tag: "TargetPromotion" as const,
              attemptId: transition.responsibility.plannedAttempt.attemptId,
              queuedAt: transition.responsibility.queuedAt,
              request: targetPromotionRequestOf(transition, runId)
            }
          : integration._tag === "IntegrationTargetResourceRequired"
            ? protocol._tag === "PlannedAttemptProtocolRequired"
              ? {
                  _tag: "Integration" as const,
                  attemptId: protocol.correlation.attemptId,
                  queuedAt: integration.queuedAt
                }
              : { _tag: "Task" as const }
            : protocol._tag === "PlannedAttemptProtocolRequired"
              ? { _tag: "PlannedAttempt" as const, attemptId: protocol.correlation.attemptId }
              : { _tag: "Task" as const }
      return { _tag: "IdentityFreeWorkflowRoute" as const, correlation, proposalId, taskId }
    },
    RecoveredNewActionRoute: ({ action }) => ({
      _tag: "RecoveredNewActionRoute" as const,
      correlation: authoredTaskOrAttemptCorrelationOf("plannedAttempt" in action ? action.plannedAttempt : null),
      proposalId,
      taskId
    }),
    /* v8 ignore next -- @preserve Pause excludes the taskless tracker-graph proposal before projection. */
    TrackerGraphReadRoute: tasklessPauseProposalDefect
  })
}

const authoredPauseLiveOwnerOf = (
  owner: Extract<
    PauseProgressView,
    { readonly _tag: "PauseWaiting" }
  >["preventing"][number]["blockers"][number] extends infer Blocker
    ? Blocker extends { readonly _tag: "LiveDeliveryAction"; readonly owner: infer Owner }
      ? Owner
      : never
    : never,
  runId: RunId
): AuthoredPauseLiveOwner =>
  Match.valueTags(owner, {
    AdmittedDeliveryAction: ({ proposal }) => ({
      _tag: "AdmittedDeliveryAction" as const,
      proposal: authoredPauseProposalOf(proposal, runId)
    }),
    MaterializedDeliveryAction: ({ intent, operationId, proposal }) => ({
      _tag: "MaterializedDeliveryAction" as const,
      intent,
      operationId: authoredOperationIdOf(operationId, runId),
      proposal: authoredPauseProposalOf(proposal, runId)
    }),
    SettledBeforeMaterialization: ({ proposal }) => ({
      _tag: "SettledBeforeMaterialization" as const,
      proposal: authoredPauseProposalOf(proposal, runId)
    }),
    SettledMaterializedDeliveryAction: ({ intent, operationId, proposal }) => ({
      _tag: "SettledMaterializedDeliveryAction" as const,
      intent,
      operationId: authoredOperationIdOf(operationId, runId),
      proposal: authoredPauseProposalOf(proposal, runId)
    })
  })

const authoredPauseResponsibilityOf = (
  responsibility:
    | Extract<PauseProgressView, { readonly _tag: "PauseConfirmed" }>["atBoundary"][number]["responsibility"]
    | Extract<
        Extract<PauseProgressView, { readonly _tag: "PauseWaiting" }>["preventing"][number]["responsibility"],
        { readonly _tag: "PauseDeliveryActionResponsibility" }
      >,
  runId: RunId
): AuthoredPauseResponsibility => {
  const coverage = responsibility.coverage
  if (responsibility._tag === "PauseDeliveryActionResponsibility") {
    return {
      _tag: "DeliveryAction",
      proposal: authoredPauseProposalOf(responsibility.proposal, runId),
      coverage,
      taskId: responsibility.taskId
    }
  }
  return Match.valueTags(responsibility.obligation, {
    AcceptedAwaitingIntegration: ({ accepted }) => ({
      _tag: "AcceptedAwaitingIntegration" as const,
      attemptId: accepted.plannedAttempt.attemptId,
      coverage,
      taskId: responsibility.taskId,
      terminalAt: accepted.terminalAt
    }),
    QueuedIntegration: ({ responsibility: queued }) => ({
      _tag: "QueuedIntegration" as const,
      attemptId: queued.plannedAttempt.attemptId,
      coverage,
      queuedAt: queued.queuedAt,
      taskId: responsibility.taskId
    }),
    StartedIntegration: ({ responsibility: started }) => ({
      _tag: "StartedIntegration" as const,
      attemptId: started.plannedAttempt.attemptId,
      coverage,
      queuedAt: started.queuedAt,
      startedAt: started.startedAt,
      taskId: responsibility.taskId
    }),
    WorkflowResponsibility: ({ responsibility: workflow }) => {
      if (workflow._tag === "PlannedAttemptExecutorWorkResponsibility") {
        return {
          _tag: "PlannedAttemptExecutorWork" as const,
          attemptId: workflow.plannedAttempt.attemptId,
          beganAt: workflow.beganAt,
          coverage,
          taskId: responsibility.taskId
        }
      }
      return Match.valueTags(workflow, {
        TaskClaimResponsibility: ({ acquisition, beganAt }) => ({
          _tag: "WorkflowOperation" as const,
          beganAt,
          coverage,
          operationId: authoredOperationIdOf(acquisition.operationId, runId),
          responsibilityTag: workflow._tag,
          taskId: responsibility.taskId
        }),
        TaskClaimReleaseResponsibility: ({ beganAt, operation }) => ({
          _tag: "WorkflowOperation" as const,
          beganAt,
          coverage,
          operationId: authoredOperationIdOf(operation.release.operationId, runId),
          responsibilityTag: workflow._tag,
          taskId: responsibility.taskId
        }),
        TaskWorktreeResponsibility: ({ beganAt, operation }) => ({
          _tag: "WorkflowOperation" as const,
          beganAt,
          coverage,
          operationId: authoredOperationIdOf(operation.operationId, runId),
          responsibilityTag: workflow._tag,
          taskId: responsibility.taskId
        })
      })
    }
  })
}

export const pauseObservationResultOf = (view: PauseProgressView, runId: RunId): AuthoredPauseObservationResult => {
  if (view._tag === "PauseNoLongerApplied") {
    return decodeAuthoredPauseProgressResult({ _tag: "PauseNoLongerApplied" })
  }
  const atBoundary = view.atBoundary.map(({ responsibility }) => authoredPauseResponsibilityOf(responsibility, runId))
  if (view._tag === "PauseConfirmed") return decodeAuthoredPauseProgressResult({ _tag: "PauseConfirmed", atBoundary })
  const authoredBlocker = (blocker: (typeof view.preventing)[number]["blockers"][number]) =>
    blocker._tag === "ExecutorSafeSuspensionRequired"
      ? { _tag: blocker._tag, attemptId: blocker.correlation.attemptId }
      : blocker._tag === "ProposedDeliveryAction"
        ? { _tag: blocker._tag, proposal: authoredPauseProposalOf(blocker.proposal, runId) }
        : blocker._tag === "LiveDeliveryAction"
          ? { _tag: blocker._tag, owner: authoredPauseLiveOwnerOf(blocker.owner, runId) }
          : blocker._tag === "AcceptedOutcomePublicationPending"
            ? { _tag: blocker._tag, proposal: authoredPauseProposalOf(blocker.proposal, runId) }
            : blocker._tag === "HeldIntegrationTarget" || blocker._tag === "ActiveIntegrationTarget"
              ? { _tag: blocker._tag, queuedAt: blocker.queuedAt }
              : { _tag: blocker._tag, request: authoredTargetPromotionRequestOf(blocker.request, runId) }
  const authoredPreventing = ({ blockers, responsibility }: (typeof view.preventing)[number]) => ({
    blockers: [authoredBlocker(blockers[0]), ...blockers.slice(1).map(authoredBlocker)] as const,
    responsibility: authoredPauseResponsibilityOf(responsibility, runId)
  })
  return decodeAuthoredPauseProgressResult({
    _tag: "PauseWaiting",
    atBoundary,
    preventing: [authoredPreventing(view.preventing[0]), ...view.preventing.slice(1).map(authoredPreventing)]
  })
}

const pauseObservationResultMatches = (
  actual: AuthoredPauseObservationResult,
  expected: AuthoredPauseObservationResult
): boolean => {
  return JSON.stringify(actual) === JSON.stringify(expected)
}

const diagnosticJsonIndent = 2
const authoredTaggedDiagnosticOf = (value: { readonly _tag: string }): AuthoredTaggedDiagnostic => ({
  kind: value._tag,
  exact: JSON.stringify(value, null, diagnosticJsonIndent)
})

type DeliveryObligation = DeliveryConsequences["ticketDeliveries"]["deliveries"][number]["obligations"][number]
type WorkflowResponsibility = Extract<DeliveryObligation, { readonly _tag: "WorkflowResponsibility" }>["responsibility"]

const authoredOrderedIntegrationResponsibilityOf = (
  obligation: DeliveryObligation
): ReadonlyArray<AuthoredIntegrationOrderResponsibility> => {
  if (obligation._tag !== "QueuedIntegration" && obligation._tag !== "StartedIntegration") return []
  const responsibility = obligation.responsibility
  const base: AuthoredIntegrationOrderResponsibilityBase = {
    acceptedCommit: responsibility.acceptedResult.commit,
    attemptId: responsibility.plannedAttempt.attemptId,
    integrationTarget: responsibility.integrationTarget,
    queuedAt: responsibility.queuedAt,
    runId: responsibility.plannedAttempt.runId,
    taskId: responsibility.plannedAttempt.taskId
  }
  return responsibility._tag === "StartedIntegrationResponsibility"
    ? [{ ...base, startedAt: responsibility.startedAt, state: "StartedPastCutoff" }]
    : [{ ...base, state: "QueuedBeforeCutoff" }]
}

const authoredIntegrationOrderOf = (
  deliveries: DeliveryConsequences["ticketDeliveries"]["deliveries"]
): AuthoredIntegrationOrder => {
  const obligations = deliveries.flatMap(({ obligations }) => obligations)
  return {
    awaitingResponsibility: obligations
      .flatMap((obligation) =>
        obligation._tag === "AcceptedAwaitingIntegration"
          ? [
              {
                acceptedCommit: obligation.accepted.acceptedResult.commit,
                attemptId: obligation.accepted.plannedAttempt.attemptId,
                runId: obligation.accepted.plannedAttempt.runId,
                taskId: obligation.accepted.plannedAttempt.taskId,
                terminalAt: obligation.accepted.terminalAt
              }
            ]
          : []
      )
      .toSorted((left, right) => left.terminalAt - right.terminalAt),
    responsibilities: obligations
      .flatMap(authoredOrderedIntegrationResponsibilityOf)
      .toSorted((left, right) => left.queuedAt - right.queuedAt)
  }
}

const authoredWorkflowResponsibilityCorrelation = (
  responsibility: WorkflowResponsibility
): Pick<AuthoredObligationDiagnostic, "attemptId" | "summary"> =>
  Match.valueTags(responsibility, {
    TaskClaimResponsibility: () => ({ attemptId: null, summary: "task-claim acquisition responsibility" }),
    TaskClaimReleaseResponsibility: () => ({ attemptId: null, summary: "task-claim release responsibility" }),
    TaskWorktreeResponsibility: () => ({ attemptId: null, summary: "Git worktree responsibility" }),
    PlannedAttemptExecutorWorkResponsibility: (value) => ({
      attemptId: value.plannedAttempt.attemptId,
      summary: `planned-attempt executor responsibility · attempt ID ${value.plannedAttempt.attemptId}`
    })
  })

const authoredObligationDiagnosticOf = (obligation: DeliveryObligation): AuthoredObligationDiagnostic => {
  const correlation = Match.valueTags(obligation, {
    WorkflowResponsibility: (value) => authoredWorkflowResponsibilityCorrelation(value.responsibility),
    AcceptedAwaitingIntegration: (value) => ({
      attemptId: value.accepted.plannedAttempt.attemptId,
      summary: `accepted result awaiting integration · attempt ID ${value.accepted.plannedAttempt.attemptId}`
    }),
    QueuedIntegration: (value) => ({
      attemptId: value.responsibility.plannedAttempt.attemptId,
      summary: `queued integration responsibility · attempt ID ${value.responsibility.plannedAttempt.attemptId}`
    }),
    StartedIntegration: (value) => ({
      attemptId: value.responsibility.plannedAttempt.attemptId,
      summary: `started integration responsibility · attempt ID ${value.responsibility.plannedAttempt.attemptId}`
    })
  })
  return { ...correlation, kind: obligation._tag, exact: JSON.stringify(obligation, null, diagnosticJsonIndent) }
}

type DeliveryProposal = Extract<
  DeliveryRuntimeEvaluation["proposedActions"],
  { readonly _tag: "DeliveryProposalsAvailable" }
>["proposals"][number]
type DeliveryProposalIssue = Extract<
  DeliveryRuntimeEvaluation["proposedActions"],
  { readonly _tag: "DeliveryProposalsAvailable" }
>["isolatedIssues"][number]
type DeliveryProposalConflict = Extract<
  DeliveryRuntimeEvaluation["proposedActions"],
  { readonly _tag: "DeliveryProposalOwnershipConflict" }
>["conflicts"][number]

type ProposalActionTagForRoute<Route> = Route extends { readonly _tag: "TrackerGraphReadRoute" }
  ? "TrackerGraphReadRoute"
  : Route extends { readonly step: { readonly _tag: infer Tag extends string } }
    ? Tag
    : Route extends { readonly action: { readonly _tag: infer Tag extends string } }
      ? Tag
      : Route extends { readonly transition: { readonly _tag: infer Tag extends string } }
        ? Tag
        : never
type ProposalActionTag = ProposalActionTagForRoute<DeliveryProposal["route"]>
type ActionMeaningTag = ProposalActionTag | DeliveryProposalIssue["transition"]

const proposalActionLabels = {
  AcquireStartedIntegrationTarget: "Acquire the integration-target position for started integration",
  AcquireTaskClaim: "Ask the tracker to create the task claim",
  AdvanceAttemptRestart: "Check current authority and atomically replace the exact changed attempt",
  AdvanceAttemptStoppage: "Advance the exact Stop decision for the planned attempt",
  CheckTaskClaim: "Check the tracker result for the accepted task-claim request",
  CommitFreshTaskClaimIntent: "Record intent to create the task claim",
  CommitTaskClaimReacquisitionIntent: "Record intent to reacquire the task claim",
  ContinueFreshWorkflowOperation: "Send the already-journaled request to its recorded owning system",
  ObservePlannedAttemptExecutorWork: "Passively observe the executor's current report for the exact planned attempt",
  ResumePlannedAttemptExecutorWorkAfterCurrentFacts:
    "Authorize current tracker and Git facts, then tell the executor to resume the exact safely suspended attempt",
  FixIntegratorSuccessorSession: "Fix the one FullRerun successor after the operator direction and fresh Git lineage",
  DeleteCompletedTaskCompletionClaim: "Ask the tracker to delete the exact completion claim",
  ObserveCancelledAttemptClaim: "Check the tracker claim after cancelling the exact attempt",
  ObserveAttemptStoppageExecutor: "Check the executor for safe suspension or a terminal result after Stop",
  ObservePlannedAttemptContinuationClaim: "Check the tracker claim before continuing the planned attempt",
  ReconcilePlannedAttemptExecutorWork: "Reconcile one ambiguous executor command before another command",
  ObservePlannedAttemptContinuationGraph: "Check the tracker graph before continuing the planned attempt",
  ObservePlannedAttemptContinuationSpecification:
    "Check tracker work instructions before continuing the planned attempt",
  ObservePlannedAttemptContinuationTargetLineage: "Check Git target lineage before continuing the planned attempt",
  ObservePlannedAttemptContinuationWorktree: "Check the Git worktree before continuing the planned attempt",
  ObserveResponsibleTaskClaim: "Check the tracker claim held by the current workflow responsibility",
  CompletePromotedTask: "Ask the tracker to complete the exact promoted task",
  ObserveFocusedTaskCompletion: "Check that the exact promoted task completed successfully",
  ObserveStoppedAttemptClaim: "Check the tracker claim before releasing a stopped attempt",
  QueueAcceptedResultIntegrationResponsibility: "Queue the accepted result for integration",
  ReadCurrentTaskGraph: "Read the tracker graph for the selected task",
  ReadPostClaimGraph: "Read the tracker graph after creating the task claim",
  ReadTargetLineage: "Read current target lineage from Git",
  ReadTaskClaim: "Read the current task claim from the tracker",
  ReadTaskWorkSpecification: "Read the task's work instructions from the tracker",
  ReadTaskWorktree: "Check the exact Git worktree after restart",
  ReadTrackerGraph: "Read the current tracker graph after restart",
  ReconcileTaskClaim: "Check the tracker after an ambiguous task-claim request",
  ReconcileTaskClaimRelease: "Check the tracker after an ambiguous claim-release request",
  ReconcileTaskWorktree: "Check or create the exact Git worktree",
  RecordChangedHeadRetryQuarantine: "Record that Retry observed a changed integration-target head",
  RecordInitialConclusiveIntegrationQuarantine: "Record the exact conclusive Integrator result as quarantined",
  RecordProviderRunFailureIntegrationQuarantine: "Recover quarantine after exact provider-owned activity absence",
  RecordRetryConclusiveIntegrationQuarantine: "Record the exact conclusive Retry run result as quarantined",
  RecordStoppedAttemptClaimNoRelease: "Record that the stopped attempt has no exact claim to release",
  RecordCancelledAttemptClaimNoRelease: "Record that the cancelled attempt has no exact claim to release",
  RecordTaskAttemptPlan: "Record the exact planned task attempt in Dalph's journal",
  ReleaseExternallyCompletedTaskClaim: "Ask the tracker to release the externally completed task's claim",
  ReleaseStartedIntegrationTarget: "Release the held integration-target position",
  ReleaseStoppedAttemptClaim: "Ask the tracker to release the stopped attempt's exact claim",
  ReleaseCancelledAttemptClaim: "Ask the tracker to release the cancelled attempt's exact claim",
  ObservePromotedCandidateAncestryAfterBlockerClear: "Recheck Git ancestry after a promoted task's blocker clears",
  ReplacePromotedTaskClaim: "Ask the tracker to replace the promoted task claim with its completion claim",
  RetryStoppedAttemptClaimRelease: "Retry the exact stopped-attempt claim release",
  RetryCancelledAttemptClaimRelease: "Retry the exact cancelled-attempt claim release",
  RelinquishCancelledAttemptImplementation: "Relinquish the cancelled attempt's implementation responsibility",
  RunIntegrator: "Ask the outer Integrator to prepare or resume the exact integration session",
  RunTargetPromotion: "Compare and set the integration target to the verified candidate commit",
  BeginPlannedAttemptExecutorWork: "Tell the executor to start the exact planned attempt",
  StartQueuedIntegration: "Start the exact queued integration responsibility",
  SuspendPlannedAttemptExecutorWork: "Request safe suspension of the exact planned-attempt executor work",
  TaskClaimReacquisition: "Try to reacquire the exact task claim",
  TrackerGraphReadRoute: "Read the tracker graph to establish the current graph"
} as const satisfies Record<ActionMeaningTag, string>

const proposalOwnerLabels = {
  DeliveryReflection: "delivery reflection",
  DeliverySettlement: "delivery settlement",
  TicketDelivery: "ticket delivery",
  TrackerGraph: "tracker graph"
} as const satisfies Record<DeliveryProposal["owner"], string>

const proposalTaskId = (proposal: DeliveryProposal): TaskId | null => deliveryProposalOrderTaskId(proposal.order)

const proposalActionTag = (proposal: DeliveryProposal): ProposalActionTag =>
  Match.valueTags(proposal.route, {
    TrackerGraphReadRoute: (route) => route._tag,
    FreshWorkflowRoute: (route) => route.step._tag,
    FreshExecutorWorkflowRoute: (route) => route.step._tag,
    RecoveredNewActionRoute: (route) => route.action._tag,
    AcceptedWorkflowRoute: (route) => route.transition._tag,
    IdentityFreeWorkflowRoute: (route) => route.transition._tag
  })

const taskWorkAdmissionSummary = (proposal: DeliveryProposal): string => {
  const requirement = proposal.admission.taskWorkPosition
  return Match.valueTags(requirement, {
    NoTaskWorkPosition: () => "needs no task-work position",
    TaskWorkPositionRequired: (value) =>
      Match.value(value.mode).pipe(
        Match.when("Existing", () => "requires the existing task-work position"),
        Match.when("ReserveOrReuse", () => "must reserve or reuse a task-work position"),
        Match.exhaustive
      )
  })
}

const integrationTargetAdmissionSummary = (proposal: DeliveryProposal): string => {
  const requirement = proposal.admission.integrationTarget
  return Match.valueTags(requirement, {
    NoIntegrationTargetResource: () => "needs no integration-target resource",
    IntegrationTargetResourceRequired: (value) =>
      Match.value(value.access).pipe(
        Match.when("Acquire", () => "must acquire the integration-target resource"),
        Match.when("Release", () => "must release the held integration-target resource"),
        Match.when("UseHeld", () => "requires the held integration-target resource"),
        Match.exhaustive
      )
  })
}

const plannedAttemptProtocolAdmissionSummary = (proposal: DeliveryProposal): string => {
  const requirement = proposal.admission.plannedAttemptProtocol
  return Match.valueTags(requirement, {
    NoPlannedAttemptProtocol: () => "needs no executor/Continue-or-Stop serialization",
    PlannedAttemptProtocolRequired: () => "must serialize this action with executor commands and Continue or Stop"
  })
}

const authoredActionProposalFactOf = (proposal: DeliveryProposal): AuthoredActionPlanningFact => {
  const taskId = proposalTaskId(proposal)
  const attemptId =
    proposal.admission.plannedAttemptProtocol._tag === "PlannedAttemptProtocolRequired"
      ? proposal.admission.plannedAttemptProtocol.correlation.attemptId
      : null
  const action = proposalActionLabels[proposalActionTag(proposal)]
  const recoveredPurpose =
    proposal.order._tag === "RecoveredWorkflowOrder" ? proposalActionLabels[proposal.order.transition] : undefined
  const purpose =
    recoveredPurpose === undefined || recoveredPurpose === action ? undefined : `to ${recoveredPurpose.toLowerCase()}`
  return {
    attemptId,
    kind: proposal._tag,
    taskId,
    summary: [
      action,
      taskId === null ? undefined : `task ${taskId}`,
      attemptId === null ? undefined : `attempt ID ${attemptId}`,
      purpose,
      plannedAttemptProtocolAdmissionSummary(proposal),
      taskWorkAdmissionSummary(proposal),
      integrationTargetAdmissionSummary(proposal),
      proposal.waitsForLiveOperationId === null
        ? undefined
        : `waits for live operation ${proposal.waitsForLiveOperationId}`,
      `planned by the ${proposalOwnerLabels[proposal.owner]} layer`
    ]
      .filter((part): part is string => part !== undefined)
      .join(" · "),
    exact: JSON.stringify(proposal, null, diagnosticJsonIndent)
  }
}

const authoredActionIssueFactOf = (issue: DeliveryProposalIssue): AuthoredActionPlanningFact => {
  const action = proposalActionLabels[issue.transition]
  const summary = Match.valueTags(issue, {
    AcceptedOperationEvidenceMissing: () =>
      `Dalph cannot ${action.toLowerCase()} because accepted journal evidence is missing`,
    FreshRouteProvenanceMissing: () => `Dalph cannot ${action.toLowerCase()} because fresh route provenance is missing`,
    TypedRoutePolicyContradiction: () =>
      `Dalph cannot ${action.toLowerCase()} because the typed route policy contradicts this transition`
  })
  return {
    attemptId: null,
    kind: issue._tag,
    taskId: issue.taskId,
    summary: `${summary} · task ${issue.taskId}`,
    exact: JSON.stringify(issue, null, diagnosticJsonIndent)
  }
}

const authoredActionConflictFactOf = (conflict: DeliveryProposalConflict): AuthoredActionPlanningFact => ({
  attemptId: null,
  kind: "DeliveryProposalOwnershipConflict",
  taskId: null,
  summary: `Proposal ownership conflict for ${conflict.id}: ${conflict.owners.join(" and ")} · planning fails closed`,
  exact: JSON.stringify(conflict, null, diagnosticJsonIndent)
})

const authoredDeliveryFrameOf = (
  captured: AuthoredDeliveryPublication,
  consequences: DeliveryConsequences,
  runtime: DeliveryRuntimeEvaluation
): AuthoredDeliveryFrame => {
  const conflictFacts: ReadonlyArray<AuthoredActionPlanningFact> =
    runtime.proposedActions._tag === "DeliveryProposalOwnershipConflict"
      ? runtime.proposedActions.conflicts.map(authoredActionConflictFactOf)
      : []
  return {
    activationOrdinal: captured.activationOrdinal,
    storyPosition: captured.storyPosition,
    acceptedAt: captured.bundle.actionInputs.runtimeFacts.acceptedAt,
    graph:
      consequences.graph._tag === "GraphNotEstablished"
        ? { _tag: "NotEstablished" }
        : {
            _tag: "Established",
            revision: consequences.graph.observation.snapshot.revision,
            observation: {
              operationId: consequences.graph.observation.operationId,
              contentIdentity: consequences.graph.observation.contentIdentity,
              recordedAt: consequences.graph.observation.recordedAt
            },
            tasks: consequences.graph.observation.snapshot
              .toWire()
              .tasks.map((task) => ({
                id: task.id,
                lifecycle: task.lifecycle._tag,
                parentTaskId: task.parentTaskId,
                prerequisiteIds: task.prerequisiteIds
              }))
          },
    capacity: captured.bundle.actionInputs.runtimeFacts.taskWork.capacity,
    quiescence: captured.bundle.actionInputs.runtimeFacts.quiescence,
    heldPositions: captured.bundle.actionInputs.runtimeFacts.taskWork.held.map(({ correlation, taskId }) => ({
      taskId,
      runId: correlation.runId,
      attemptId: correlation.attemptId
    })),
    integrationOrder: authoredIntegrationOrderOf(consequences.ticketDeliveries.deliveries),
    frontier: consequences.frontier.standings.map((standing) =>
      standing._tag === "Eligible"
        ? { taskId: standing.taskId, standing: standing._tag, taskRevision: standing.taskRevision, reasons: [] }
        : {
            taskId: standing.taskId,
            standing: standing._tag,
            taskRevision: null,
            reasons: standing.reasons.map(authoredTaggedDiagnosticOf)
          }
    ),
    tickets: consequences.tickets.placements.map(({ placement, taskId }) => ({
      taskId,
      placement: authoredTaggedDiagnosticOf(placement),
      rank: "rank" in placement ? placement.rank : null,
      reasons: placement._tag === "GraphExcluded" ? placement.reasons.map(authoredTaggedDiagnosticOf) : []
    })),
    deliveries: consequences.ticketDeliveries.deliveries.map((ticket) => ({
      taskId: ticket.taskId,
      placement: authoredTaggedDiagnosticOf(ticket.placement),
      evidence: ticket.evidence.map(authoredTaggedDiagnosticOf),
      standings: ticket.standings.map(authoredTaggedDiagnosticOf),
      obligations: ticket.obligations.map(authoredObligationDiagnosticOf)
    })),
    settlements: consequences.settlements.settlements.map(({ attemptId, taskId }) => ({ attemptId, taskId })),
    trackerReflection: {
      _tag: consequences.trackerConsequences._tag,
      settlementCount: consequences.trackerConsequences.source.settlements.length
    },
    actionPlanning:
      runtime.proposedActions._tag === "DeliveryProposalsAvailable"
        ? {
            _tag: "DeliveryProposalsAvailable",
            proposals: runtime.proposedActions.proposals.map(authoredActionProposalFactOf),
            isolatedIssues: runtime.proposedActions.isolatedIssues.map(authoredActionIssueFactOf)
          }
        : { _tag: "DeliveryProposalOwnershipConflict", conflicts: conflictFacts }
  }
}

/** Projects one exact captured publication through the literal production delivery composition. */
export const evaluateAuthoredDeliveryPublication = Effect.fn("AuthoredCassette.evaluateDeliveryPublication")(function* (
  publication: AuthoredDeliveryPublication
) {
  const { consequences, runtime } = yield* evaluateDeliveryRelationAndRuntimeInputBundle(publication.bundle)
  return authoredDeliveryFrameOf(publication, consequences, runtime)
})

/** Projects raw captures into one chronology while retaining the latest observed Delivery and runtime values. */
export const evaluateAuthoredObservationChronology = Effect.fn("AuthoredCassette.evaluateObservationChronology")(
  (captures: ReadonlyArray<AuthoredObservationCapture>) =>
    Effect.reduce(
      captures,
      (): ReadonlyArray<AuthoredObservationMoment> => [],
      (moments, capture) =>
        evaluateAuthoredObservationCapture(capture, moments.at(latestArrayElementIndex) ?? null).pipe(
          Effect.map((moment) => [...moments, moment])
        )
    )
)

/** Evaluates one newly captured observation against the immediately preceding playback moment. */
export const evaluateAuthoredObservationCapture: (
  capture: AuthoredObservationCapture,
  previous: AuthoredObservationMoment | null
) => Effect.Effect<AuthoredObservationMoment, Effect.Error<ReturnType<typeof evaluateAuthoredDeliveryPublication>>> =
  Effect.fn("AuthoredCassette.evaluateObservationCapture")(function* (
    capture: AuthoredObservationCapture,
    previous: AuthoredObservationMoment | null
  ) {
    const correlation = {
      activationOrdinal: capture.activationOrdinal,
      captureOrder: capture.captureOrder,
      storyPosition: capture.storyPosition
    }
    const deliveryFrame = previous?.deliveryFrame ?? null
    const liveOwners = previous?.liveOwners ?? []
    if (capture._tag === "DeliveryPublicationCaptured") {
      return {
        _tag: "DeliveryPublicationMoment",
        ...correlation,
        deliveryFrame: yield* evaluateAuthoredDeliveryPublication(capture.publication),
        liveOwners
      } satisfies AuthoredObservationMoment
    }
    if (capture._tag === "DeliveryRuntimeOwnersCaptured") {
      return {
        _tag: "DeliveryRuntimeOwnersMoment",
        ...correlation,
        deliveryFrame,
        liveOwners: capture.liveOwners
      } satisfies AuthoredObservationMoment
    }
    return {
      _tag: "AuthoredStoryOccurrenceMoment",
      ...correlation,
      deliveryFrame,
      liveOwners,
      occurrence: capture.occurrence
    } satisfies AuthoredObservationMoment
  })

const latestArrayElementIndex = -1
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
  /* v8 ignore start -- @preserve AttemptChoiceControl exposes only its closed tagged error union to these callers. */
  if (typeof failure !== "object" || failure === null || !("_tag" in failure)) return undefined
  /* v8 ignore stop -- @preserve */
  return Match.value(failure._tag).pipe(
    Match.when("AttemptChoiceAlreadyApplied", () => "AlreadyApplied" as const),
    Match.when("AttemptChoiceRequestIdentityContradiction", () => "IdentityContradiction" as const),
    Match.when("AttemptChoiceNotAvailable", () => "NotAvailable" as const),
    Match.when("AttemptChoiceOutsidePreIntegrationPhase", () => "OutsidePreIntegrationPhase" as const),
    /* v8 ignore next -- @preserve Other control and infrastructure failures are not authored rejection reasons. */
    Match.orElse(() => undefined)
  )
}

type AttemptChoiceControlResult = Result.Result<AttemptChoiceApplicationResult, unknown>

type AuthoredInFlightControlDirectionItem =
  | typeof AuthoredCassetteStoryItem.cases.OperatorAppliesControlDirectionWhileExecutorRequestInFlight.Type
  | typeof AuthoredCassetteStoryItem.cases.OperatorAppliesRunCancellationWhileExecutorRequestInFlight.Type
  | typeof AuthoredCassetteStoryItem.cases.OperatorUnpausesWhileExecutorRequestInFlightAfterQueuedPauseWaiting.Type

type AuthoredInFlightControlDirection = Exclude<
  AuthoredInFlightControlDirectionItem,
  typeof AuthoredCassetteStoryItem.cases.OperatorAppliesRunCancellationWhileExecutorRequestInFlight.Type
>

const isRunCancellationDuringInFlight = (
  item: AuthoredInFlightControlDirectionItem
): item is typeof AuthoredCassetteStoryItem.cases.OperatorAppliesRunCancellationWhileExecutorRequestInFlight.Type =>
  item._tag === "OperatorAppliesRunCancellationWhileExecutorRequestInFlight"

const requestedInFlightControlDirection = (item: AuthoredInFlightControlDirection): "Unpause" | "Pause" =>
  item._tag === "OperatorUnpausesWhileExecutorRequestInFlightAfterQueuedPauseWaiting" ? "Unpause" : item.direction

const inFlightControlSubjectFor = (item: AuthoredInFlightControlDirection, runId: RunId) =>
  item.subject._tag === "Run"
    ? { _tag: "Run" as const, runId }
    : { _tag: "Task" as const, runId, taskId: item.subject.taskId }

const expectedInFlightControlFailureReason = (
  item: AuthoredInFlightControlDirection
): "IncompleteSnapshot" | "OutsideCurrentTargetClosure" | undefined =>
  item._tag === "OperatorAppliesControlDirectionWhileExecutorRequestInFlight" && item.outcome._tag === "Rejected"
    ? item.outcome.reason
    : undefined

const expectedInFlightPauseResults = (
  item: AuthoredInFlightControlDirection
): ReadonlyArray<AuthoredPauseObservationResult> =>
  item._tag === "OperatorUnpausesWhileExecutorRequestInFlightAfterQueuedPauseWaiting"
    ? [...item.queued, { _tag: "PauseNoLongerApplied" as const }]
    : item.outcome._tag === "AppliedAndPauseObservationEnds"
      ? [item.outcome.result]
      : []

const attemptChoiceDirectionFor = (
  item: AuthoredAttemptChoiceItem
): "ContinueExistingAttempt" | "RestartTaskImplementation" | "StopTaskImplementation" =>
  item._tag === "OperatorContinuesAttempt"
    ? "ContinueExistingAttempt"
    : item._tag === "OperatorRestartsAttempt"
      ? "RestartTaskImplementation"
      : "StopTaskImplementation"

const appliedAttemptChoiceMatches = (
  item: AuthoredAttemptChoiceItem,
  result: AttemptChoiceApplicationResult
): boolean => {
  /* v8 ignore start -- @preserve The driver calls this matcher only after selecting an Applied authored result. */
  if (item.expected._tag !== "Applied") return false
  /* v8 ignore stop -- @preserve */
  if (item._tag === "OperatorContinuesAttempt") return result._tag === "ContinueApplied"
  if (item._tag === "OperatorRestartsAttempt") return result._tag === "RestartApplied"
  return result._tag === "StopApplied" && result.status._tag === item.expected.status
}

const queriedAttemptChoiceMatches = (
  application: AttemptChoiceApplicationResult,
  queried: AttemptChoiceApplicationResult
): boolean => {
  /* v8 ignore start -- @preserve The immediate journal-derived query must retain the application result's direction tag. */
  if (queried._tag !== application._tag) return false
  /* v8 ignore stop -- @preserve */
  if (queried._tag !== "StopApplied" || application._tag !== "StopApplied") return true
  return queried.status._tag === application.status._tag
}

const attemptChoiceRejectionMatches = (item: AuthoredAttemptChoiceItem, result: AttemptChoiceControlResult): boolean =>
  item.expected._tag === "Rejected" &&
  result._tag === "Failure" &&
  attemptChoiceFailureReason(result.failure) === item.expected.reason

const attemptChoiceRaceHasOneWinner = (results: ReadonlyArray<AttemptChoiceControlResult>): boolean => {
  const successes = results.filter((result) => result._tag === "Success")
  const failures = results.filter((result) => result._tag === "Failure")
  return (
    successes.length === 1 &&
    failures.length === 1 &&
    attemptChoiceFailureReason(failures[0]?.failure) === "AlreadyApplied"
  )
}

type CoordinatorFinalityDecision =
  | { readonly _tag: "RunMayTerminate" }
  | {
      readonly _tag: "RunMustRemainActive"
      readonly reason: "RunnableTransition" | "TrackerTargetUnsettled" | "UnsettledResponsibility"
    }

export const settleCoordinatorActivationReturn = <E>(
  cursor: StoryCursor,
  exit: Exit.Exit<CoordinatorFinalityDecision, E>
) =>
  Effect.gen(function* () {
    if (Exit.isFailure(exit)) return yield* Effect.failCause(exit.cause)
    return yield* cursor.consumeCoordinatorActivationReturnedFor(exit.value)
  })

/** Internal cassette policy correlating a real reactivation callback return with its authored boundary. */
export const settleAuthoredReactivationOwnerReturn = (
  lifecycle: ScenarioCassette["processLifecycle"],
  cursor: StoryCursor,
  decision: CoordinatorFinalityDecision
) =>
  lifecycle?._tag === "ReactivationOwnerProcessGenerations"
    ? settleCoordinatorActivationReturn(cursor, Exit.succeed(decision)).pipe(Effect.map(Option.some))
    : lifecycle?._tag === "CurrentFirstReactivationAfterProcessDeath"
      ? cursor.currentStoryItem.pipe(
          Effect.flatMap((item) =>
            item?._tag === "CoordinatorActivationReturned"
              ? settleCoordinatorActivationReturn(cursor, Exit.succeed(decision)).pipe(Effect.map(Option.some))
              : Effect.succeed(Option.none())
          )
        )
      : Effect.succeed(Option.none())

/** The authored death control is a typed defect, never a production failure. */
const isAuthoredCoordinatorProcessDeath = (exit: Exit.Exit<unknown, unknown>): boolean =>
  Exit.isFailure(exit) &&
  exit.cause.reasons.some(
    (reason) => Cause.isDieReason(reason) && reason.defect instanceof AuthoredCoordinatorProcessDies
  )

type AuthoredActivationReturnSignal = {
  readonly acknowledgement: Deferred.Deferred<void>
  readonly successor:
    | { readonly _tag: "HintDelivery"; readonly awaitDelivery: Effect.Effect<void> }
    | { readonly _tag: "StoryItem"; readonly item: AuthoredCassetteStoryItem | undefined }
}

/**
 * Converts one exact returned callback followed by immediate authored death, or by the accepted single
 * capacity-change prelude and death, into the process-level death signal. Any immediate non-death item
 * acknowledges the callback untouched. Once the accepted capacity prelude begins, any successor other than
 * death is a typed authored mismatch.
 */
export const awaitAuthoredProcessDeathAfterActivationReturn = Effect.fn(
  "AuthoredCassette.awaitProcessDeathAfterActivationReturn"
)(function* (request: {
  readonly awaitActivationReturn: Effect.Effect<AuthoredActivationReturnSignal>
  readonly cursor: Pick<
    StoryCursor,
    "awaitStoryItemAdvance" | "currentStoryItem" | "pauseAtCoordinatorProcessDeath" | "storyPosition"
  >
  readonly onProcessDeath: Effect.Effect<void>
}) {
  const signal = yield* request.awaitActivationReturn
  if (signal.successor._tag === "HintDelivery") {
    yield* signal.successor.awaitDelivery
    yield* Deferred.succeed(signal.acknowledgement, undefined)
    return
  }
  let current = signal.successor.item
  const capacityPreludeStarted = current?._tag === "SetTaskExecutionCapacity"
  if (current?._tag === "SetTaskExecutionCapacity") {
    yield* request.cursor.awaitStoryItemAdvance(current)
    current = yield* request.cursor.currentStoryItem
  }
  if (current?._tag !== "CoordinatorProcessDies") {
    if (capacityPreludeStarted) {
      return yield* new AuthoredCassetteInteractionMismatch({
        actual: current?._tag ?? "end of story",
        expected: "CoordinatorProcessDies after SetTaskExecutionCapacity",
        storyPosition: yield* request.cursor.storyPosition
      })
    }
    yield* Deferred.succeed(signal.acknowledgement, undefined)
    return
  }
  const death = yield* Effect.exit(request.cursor.pauseAtCoordinatorProcessDeath)
  if (!isAuthoredCoordinatorProcessDeath(death)) {
    return yield* Exit.match(death, {
      onFailure: Effect.failCause,
      onSuccess: () => Effect.die("authored process death disappeared")
    })
  }
  yield* request.onProcessDeath
})

/** Extracts a typed authored-correlation failure captured inside a journal append callback. */
export const authoredInteractionMismatchFrom = (
  exit: Exit.Exit<unknown, unknown>
): AuthoredCassetteInteractionMismatch | undefined => {
  if (Exit.isFailure(exit)) {
    for (const reason of exit.cause.reasons) {
      if (Cause.isFailReason(reason) && reason.error instanceof AuthoredCassetteInteractionMismatch) {
        return reason.error
      }
    }
  }
  return undefined
}

type AuthoredTaskClaimAcquisitionRejected = typeof AuthoredCassetteStoryItem.cases.TaskClaimAcquisitionRejected.Type
type TaskClaimAcquisitionRejectedEvent = Extract<
  JournalRecord["event"],
  { readonly _tag: "TaskClaimAcquisitionRejected" }
>

const authoredTaskClaimAcquisitionRejectionMatches = (request: {
  readonly attemptedTaskId: TaskId | undefined
  readonly event: TaskClaimAcquisitionRejectedEvent
  readonly expected: AuthoredTaskClaimAcquisitionRejected
}): boolean =>
  [
    request.attemptedTaskId !== undefined,
    request.expected.operationId === request.event.operationId,
    request.attemptedTaskId === request.event.observed.taskId,
    JSON.stringify(request.expected.observed) === JSON.stringify(request.event.observed)
  ].every(Boolean)

const handleAuthoredTaskClaimJournalEvent = (request: {
  readonly acquisitionTaskIds: Ref.Ref<ReadonlyMap<OperationId, TaskId>>
  readonly authoredInteractionFailure: Ref.Ref<AuthoredCassetteInteractionMismatch | undefined>
  readonly cursor: StoryCursor
  readonly event: JournalRecord["event"]
}) =>
  Effect.gen(function* () {
    const { event } = request
    if (event._tag === "TaskClaimAcquisitionIntended") {
      yield* Ref.update(request.acquisitionTaskIds, (current) =>
        new Map(current).set(event.operation.acquisition.operationId, event.operation.acquisition.taskId)
      )
    }
    if (event._tag !== "TaskClaimAcquisitionRejected") return false

    const expectedExit = yield* Effect.exit(request.cursor.consumeTaskClaimAcquisitionRejected)
    const expectedMismatch = authoredInteractionMismatchFrom(expectedExit)
    if (expectedMismatch !== undefined) {
      yield* Ref.set(request.authoredInteractionFailure, expectedMismatch)
      return true
    }
    /* v8 ignore next -- @preserve This cursor operation's only typed failure is the mismatch handled immediately above. */
    if (Exit.isFailure(expectedExit)) {
      return yield* Effect.die(expectedExit.cause)
    }
    const expected = expectedExit.value
    const attemptedTaskId = (yield* Ref.get(request.acquisitionTaskIds)).get(event.operationId)
    if (!authoredTaskClaimAcquisitionRejectionMatches({ attemptedTaskId, event, expected })) {
      yield* Ref.set(
        request.authoredInteractionFailure,
        new AuthoredCassetteInteractionMismatch({
          actual: JSON.stringify(event.observed),
          expected: JSON.stringify({ operationId: expected.operationId, attemptedTaskId, observed: expected.observed }),
          storyPosition: (yield* request.cursor.storyPosition) - 1
        })
      )
      return true
    }
    // The rejection is durable before this boundary dies.
    // The next activation must therefore reconstruct from
    // the same journal instead of retrying the acquisition.
    yield* request.cursor.pauseAtCoordinatorProcessDeath
    return true
  })

/** Decodes and drives one story through the ordinary production delivery program. */
const runAuthoredScenarioCassetteWith = (
  request: { readonly input: unknown; readonly options: AuthoredScenarioCassetteRunOptions },
  captureRuntimeEvaluation?: (capture: InternalAuthoredRuntimeEvaluationCapture) => Effect.Effect<void>
) => {
  const { input, options } = request
  return Effect.scoped(
    // eslint-disable-next-line complexity -- One chronological adapter owns activation, crash, candidate, and terminal story boundaries.
    Effect.gen(function* () {
      const cassette = yield* Schema.decodeUnknownEffect(AuthoredScenarioCassette, { onExcessProperty: "error" })(input)
      const controlledProviderReadiness = yield* makeAuthoredProviderReadiness(
        cassette.controlledProviderReadiness ?? [],
        cassette.controlledIntegratorReadiness ?? []
      )
      const controlledExecutorReadiness = yield* makeAuthoredExecutorReadiness(
        cassette.controlledExecutorReadiness ?? []
      )
      yield* Effect.forEach(cassette.story, (item) => assertExactlyOneAuthoredCassetteStoryItemOwner(item._tag), {
        discard: true
      })
      const activeDeliveryActivation = yield* Ref.make<AuthoredRunActivationOrdinalType>(
        AuthoredRunActivationOrdinal.make(1)
      )
      const observationCaptureState = yield* Ref.make<{
        readonly captures: ReadonlyArray<AuthoredObservationCapture>
        readonly nextOrder: number
      }>({ captures: [], nextOrder: 1 })
      const appendObservation = Effect.fn("AuthoredCassette.appendObservation")(function* (
        observation: AuthoredObservationCaptureInput,
        storyPosition: AuthoredStoryPosition
      ) {
        const activationOrdinal = yield* Ref.get(activeDeliveryActivation)
        const capture = yield* Ref.modify(observationCaptureState, ({ captures, nextOrder }) => {
          const correlation = {
            activationOrdinal,
            captureOrder: AuthoredObservationCaptureOrder.make(nextOrder),
            storyPosition
          }
          const captured: AuthoredObservationCapture =
            observation._tag === "AuthoredStoryOccurrenceCaptured"
              ? { ...correlation, _tag: observation._tag, occurrence: observation.occurrence }
              : observation._tag === "DeliveryPublicationCaptured"
                ? { ...correlation, _tag: observation._tag, publication: observation.publication }
                : { ...correlation, _tag: observation._tag, liveOwners: observation.liveOwners }
          return [captured, { captures: [...captures, captured], nextOrder: nextOrder + 1 }]
        })
        yield* Effect.exit(Effect.sync(() => options.onObservationCapture?.(capture)))
        return capture
      })
      const cursor = yield* makeStoryCursor(cassette.story, {
        onOccurrence: ({ item, storyPosition }: AuthoredStoryOccurrenceObserved) =>
          appendObservation(
            { _tag: "AuthoredStoryOccurrenceCaptured", occurrence: item },
            AuthoredStoryPosition.make(storyPosition)
          ).pipe(Effect.asVoid)
      })
      const authoredCoordinatorProcessDeaths = yield* Queue.unbounded<void>()
      const reactivationOwnerProcessGenerationCount = yield* Ref.make(0)
      const observeAuthoredCoordinatorProcessDeath = <A, E, R>(program: Effect.Effect<A, E, R>) =>
        program.pipe(
          Effect.onExit((exit) =>
            isAuthoredCoordinatorProcessDeath(exit)
              ? Queue.offer(authoredCoordinatorProcessDeaths, undefined).pipe(Effect.asVoid)
              : Effect.void
          )
        )
      const offerRunReactivationHint = yield* Ref.make<(hint: "TrackerNotification" | "Timer") => Effect.Effect<void>>(
        () => Effect.die("the authored Run reactivation owner is not active")
      )
      const authoredHintDelivery = yield* makeAuthoredHintDeliveryRendezvous()
      const capturedDeliveryPublications = yield* Ref.make<ReadonlyArray<AuthoredDeliveryPublication>>([])
      const deliveryPublicationSignals = yield* Queue.unbounded<AuthoredDeliveryPublication>()
      const plannedSuspensionExecutorBoundaryGate = yield* Ref.make<
        Option.Option<{
          readonly attemptId: AttemptId
          readonly release: Deferred.Deferred<void>
          readonly taskId: TaskId
        }>
      >(Option.none())
      const plannedContinuationExecutorBoundaryGate = yield* Ref.make<
        ReadonlyMap<
          string,
          { readonly attemptId: AttemptId; readonly release: Deferred.Deferred<void>; readonly taskId: TaskId }
        >
      >(new Map())
      const targetPromotionReconciliationReadBoundaryGate = yield* Ref.make<
        Option.Option<{ readonly release: Deferred.Deferred<void>; readonly request: TargetPromotionRequest }>
      >(Option.none())
      const initialPauseObservationConsumed = yield* Deferred.make<void>()
      const acceptedSafeReport = yield* Ref.make<Option.Option<AuthoredSafelySuspendedExecutorReportItem>>(
        Option.none()
      )
      type PublicationObserverJournalFailure = Effect.Error<ReturnType<JournalStore["Service"]["read"]>>
      const publicationObserverJournalFailure = yield* Ref.make<PublicationObserverJournalFailure | undefined>(
        undefined
      )
      const authoredInteractionFailure = yield* Ref.make<AuthoredCassetteInteractionMismatch | undefined>(undefined)
      const publicationObserver = DeliveryRelationPublicationObserver.of({
        observe: (bundle) =>
          Effect.gen(function* () {
            const acceptedThrough = bundle.actionInputs.runtimeFacts.acceptedAt
            yield* settleAuthoredSafelySuspendedPublication({
              acceptedSafeReport,
              acceptedThrough,
              cursor,
              readJournal: sharedJournal.read,
              runId
            })
            const activationOrdinal = yield* Ref.get(activeDeliveryActivation)
            const storyPosition = yield* cursor.storyPosition
            const publication = { activationOrdinal, storyPosition: AuthoredStoryPosition.make(storyPosition), bundle }
            yield* Ref.update(capturedDeliveryPublications, (captured) => [...captured, publication])
            yield* appendObservation({ _tag: "DeliveryPublicationCaptured", publication }, publication.storyPosition)
            yield* Queue.offer(deliveryPublicationSignals, publication)
            // A read-only diagnostic observer defect never changes production cassette execution.
            yield* Effect.exit(Effect.sync(() => options.onDeliveryPublication?.(publication)))
          }).pipe(
            Effect.catch((failure) =>
              (failure instanceof AuthoredCassetteInteractionMismatch
                ? Ref.set(authoredInteractionFailure, failure)
                : Ref.set(publicationObserverJournalFailure, failure)
              ).pipe(Effect.andThen(Effect.die(failure)))
            )
          )
      })
      const runtimeObservationObserver = yield* makeAuthoredRuntimeObservationCaptureObserver(
        {
          captureOwners: (liveOwners, storyPosition) =>
            appendObservation({ _tag: "DeliveryRuntimeOwnersCaptured", liveOwners }, storyPosition).pipe(Effect.asVoid),
          correlateOwners: () =>
            cursor.storyPosition.pipe(Effect.map((position) => AuthoredStoryPosition.make(position)))
        },
        captureRuntimeEvaluation === undefined
          ? undefined
          : {
              captureEvaluation: (evaluation, correlation) => captureRuntimeEvaluation({ ...correlation, evaluation }),
              correlateEvaluation: () =>
                Effect.all({
                  activationOrdinal: Ref.get(activeDeliveryActivation),
                  storyPosition: cursor.storyPosition.pipe(
                    Effect.map((position) => AuthoredStoryPosition.make(position))
                  )
                })
            }
      )
      const admittedContinuationChoiceApplied = yield* Deferred.make<void>()
      const operatorAttemptChoiceLifecycle = yield* makeAuthoredOperatorRequestLifecycle()
      const targetPromotionStory = cassette.story.some((item) => item._tag.startsWith("TargetPromotion"))
      const exactCausalTrackerReadStory = cassette.story.some(
        (item) =>
          item._tag === "ConcurrentTrackerReadBatch" ||
          (item._tag === "ConcurrentInteractionGroup" &&
            item.members.some(({ interaction }) => interaction._tag === "TrackerGraphReadReturned"))
      )
      const initial = yield* cursor.consumeInitialPolicy
      const command = yield* cursor.consumeRunCoordinator
      const runId = yield* freshWorkflowRunId(command.target)
      const coordinatorLifecycleBoundaryCount = cassette.story.filter(
        (item) =>
          item._tag === "CoordinatorActivationReturned" ||
          item._tag === "CoordinatorProcessDies" ||
          (item._tag === "ConcurrentInteractionGroup" &&
            item.members.some(({ interaction }) => interaction._tag === "CoordinatorActivationReturned"))
      ).length
      const operatorControlGraphReadGate = yield* Ref.make<
        Option.Option<{ readonly release: Deferred.Deferred<void>; readonly taskId: TaskId }>
      >(Option.none())
      const operatorControlGraphReadActive = yield* Ref.make(false)
      const trace = controlledTrace(cursor, { operatorControlGraphReadActive, operatorControlGraphReadGate })
      const sharedContext = yield* Layer.build(
        Layer.mergeAll(
          memoryJournalStoreLayer,
          controlledTrackerMutationLayerFrom(cassette.startingFacts.taskClaims),
          gitTargetLineageTestLayer(
            cassette.startingFacts.targetLineageObservations?.[0] ??
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
      const acceptedEvidencePublicationFailure = yield* Ref.make<EvidenceStoreFailure | undefined>(undefined)
      const acquisitionTaskIds = yield* Ref.make<ReadonlyMap<OperationId, TaskId>>(new Map())
      const prepareExecutorReport = Effect.fn("AuthoredCassette.sealAcceptedExecutorEvidence")(function* (
        report: PlannedAttemptExecutorReport
      ) {
        if (report._tag !== "ExecutorWorkTerminal" || report.result._tag !== "Accepted") return report
        const acceptedResult = report.result.acceptedResult
        const evidenceManifest = yield* evidenceStore
          .put(
            new TextEncoder().encode(
              JSON.stringify(
                AcceptedResultEvidenceManifest.make({
                  commit: acceptedResult.commit,
                  correlation: report.correlation,
                  formatVersion: 1,
                  outcome: "Accepted",
                  predecessor: null
                })
              )
            )
          )
          .pipe(
            Effect.tapError((failure) => Ref.set(acceptedEvidencePublicationFailure, failure)),
            Effect.orElseSucceed(() => acceptedResult.evidenceManifest)
          )
        return PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
          correlation: report.correlation,
          result: { _tag: "Accepted", acceptedResult: { commit: acceptedResult.commit, evidenceManifest } }
        })
      })
      const targetPromotionGit = {
        compareAndSet: (request: Parameters<TargetPromotionGitService["compareAndSet"]>[0]) =>
          cursor.consumeTargetPromotionCompareAndSet.pipe(
            Effect.tap(({ result }) =>
              result._tag === "Applied"
                ? controlledExecutorReadiness.releaseSource({
                    candidateCommit: request.candidateCommit,
                    expectedTargetHead: request.expectedTargetHead,
                    integrationTarget: request.integrationTarget
                  })
                : Effect.void
            ),
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
          Effect.gen(function* () {
            const authoredDeath = yield* cursor.consumeTargetPromotionReconciliationReadBoundaryDeath
            if (Option.isSome(authoredDeath)) {
              /* v8 ignore start -- @preserve The request-correlated death item is constructed from this exact normalized promotion request. */
              if (!authoredTargetPromotionGitRequestMatches(request, authoredDeath.value.request)) {
                return yield* Effect.die(
                  `target-promotion reconciliation-read death expected ${JSON.stringify(authoredDeath.value.request)}, received ${JSON.stringify(request)}`
                )
              }
              /* v8 ignore stop -- @preserve */
              yield* cursor.pauseAtCoordinatorProcessDeath
              return yield* Effect.die(
                "target-promotion reconciliation-read death was not followed by CoordinatorProcessDies"
              )
            }
            const authoredHold = yield* cursor.consumeTargetPromotionReconciliationReadBoundaryHold
            if (Option.isSome(authoredHold)) {
              /* v8 ignore start -- @preserve The paired hold is constructed from this exact normalized promotion request and closure allows only one active hold. */
              if (!authoredTargetPromotionGitRequestMatches(request, authoredHold.value.request)) {
                return yield* Effect.die(
                  `held target-promotion reconciliation read expected ${JSON.stringify(authoredHold.value.request)}, received ${JSON.stringify(request)}`
                )
              }
              if (Option.isSome(yield* Ref.get(targetPromotionReconciliationReadBoundaryGate))) {
                return yield* Effect.die("a target-promotion reconciliation-read hold is already active")
              }
              /* v8 ignore stop -- @preserve */
              const release = yield* Deferred.make<void>()
              yield* Ref.set(
                targetPromotionReconciliationReadBoundaryGate,
                Option.some({ release, request: authoredHold.value.request })
              )
              yield* Deferred.await(release)
            }
            return yield* cursor
              .consumeTargetPromotionGitRead(request.integrationTarget.repository, request.candidateCommit)
              .pipe(
                Effect.map(({ observation }) => TargetPromotionGitReadObservation.make(observation)),
                Effect.mapError(
                  /* v8 ignore next -- @preserve Authored coordinator runs publish read failure through the runtime relation; the maintained direct protocol cassette owns the typed unreadable chronology. */
                  (failure) =>
                    new TargetPromotionGitReadFailure({
                      candidateCommit: request.candidateCommit,
                      detail: `${failure._tag}: ${
                        "detail" in failure ? failure.detail : "interaction mismatch"
                      } at story position ${failure.storyPosition}`,
                      target: request.integrationTarget
                    })
                )
              )
          })
      }
      const observedExecutorLifecycleKeys = yield* Ref.make<ReadonlySet<string>>(new Set())
      type AuthoredJournalAppendKey = JournalRecord["key"]
      type AuthoredJournalAppendEvent = JournalRecord["event"]
      const isExecutorLifecycleAppend = (event: AuthoredJournalAppendEvent): boolean =>
        event._tag === "PlannedAttemptReplaced" ||
        event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" ||
        event._tag === "PlannedAttemptExecutorWorkReported"
      const shouldPauseAfterTrackerFactsAppend = (event: AuthoredJournalAppendEvent): boolean =>
        event._tag === "TaskTrackerFactsObserved" && !event.operationId.startsWith("attempt-restart:")
      const isIntegratorBoundaryAppend = (event: AuthoredJournalAppendEvent): boolean =>
        event._tag === "IntegratorSessionFixed" ||
        event._tag === "IntegratorRunStarted" ||
        event._tag === "IntegratorRunResultRecorded" ||
        event._tag === "IntegratorRunCandidateGitReadIntended" ||
        event._tag === "IntegratorRunCandidateGitObserved"
      const pauseAtAuthoredJournalBoundary = (event: AuthoredJournalAppendEvent): Effect.Effect<void> => {
        // A tracker observation may be durable before the coordinator process
        // dies. Authored Integrator boundaries and replacement appends use the
        // same exact death seam.
        if (shouldPauseAfterTrackerFactsAppend(event)) return cursor.pauseAtCoordinatorProcessDeath
        if (event._tag === "PlannedAttemptReplaced") return cursor.pauseAtCoordinatorProcessDeath
        if (isIntegratorBoundaryAppend(event)) return cursor.pauseAtCoordinatorProcessDeath
        return Effect.void
      }
      const pauseAfterJournalAppend = (
        key: AuthoredJournalAppendKey,
        event: AuthoredJournalAppendEvent
      ): Effect.Effect<void> =>
        Effect.gen(function* () {
          yield* pauseAtAuthoredJournalBoundary(event)
          if (!isExecutorLifecycleAppend(event)) return
          const firstDurableAppend = yield* Ref.modify(observedExecutorLifecycleKeys, (observed) => {
            const encodedKey = String(key)
            return [!observed.has(encodedKey), new Set([...observed, encodedKey])]
          })
          /* v8 ignore next -- @preserve Idempotent lifecycle redelivery must not consume an unrelated later death control. */
          if (firstDurableAppend) yield* cursor.pauseAtCoordinatorProcessDeath
        })
      const journalLayer = journalStoreCapabilities(
        Layer.succeed(
          JournalStore,
          JournalStore.of({
            ...sharedJournal,
            append: (requestedRunId, key, event) =>
              appendAuthoredJournalEvent({
                afterAcceptedAppend: Effect.gen(function* () {
                  const taskClaimHandled = yield* handleAuthoredTaskClaimJournalEvent({
                    acquisitionTaskIds,
                    authoredInteractionFailure,
                    cursor,
                    event
                  })
                  if (taskClaimHandled) return
                  yield* pauseAfterJournalAppend(key, event)
                }),
                append: sharedJournal.append(requestedRunId, key, event),
                event,
                readiness: controlledProviderReadiness
              })
          })
        )
      )
      const activeOperatorControl = yield* Ref.make<
        JournaledRunBootstrap["Service"]["operatorControl"]["applyControlDirection"]
      >(
        /* v8 ignore next -- @preserve The controlled driver starts only after installing the bootstrap operator control. */
        () => Effect.die("operator control is not installed")
      )
      const activeRunCancellation = yield* Ref.make<
        JournaledRunBootstrap["Service"]["operatorControl"]["applyRunCancellation"]
      >(
        /* v8 ignore next -- @preserve The controlled executor starts only after installing the bootstrap cancellation control. */
        () => Effect.die("run cancellation control is not installed")
      )
      const activePauseObservationResults = yield* Ref.make<
        Option.Option<Queue.Dequeue<AuthoredPauseObservationResult>>
      >(Option.none())
      const authoredRunScope = yield* Scope.Scope
      interface ActiveAuthoredPauseObservation {
        readonly fiber: Fiber.Fiber<void | boolean, never>
        readonly results: Queue.Dequeue<AuthoredPauseObservationResult>
        readonly subject: (typeof AuthoredCassetteStoryItem.cases.OperatorStartsPauseObservation.Type)["subject"]
      }
      const activePauseObservation = yield* Ref.make<Option.Option<ActiveAuthoredPauseObservation>>(Option.none())

      const awaitPlannedSuspensionBoundary = Effect.fn("AuthoredCassette.awaitPlannedSuspensionBoundary")(function* (
        plannedAttempt: PlannedTaskAttempt,
        request: "Begin" | "Resume" | "Suspend"
      ) {
        const hold = yield* Ref.get(plannedSuspensionExecutorBoundaryGate)
        if (
          Option.isNone(hold) ||
          plannedAttempt.attemptId !== hold.value.attemptId ||
          plannedAttempt.taskId !== hold.value.taskId
        ) {
          return
        }
        if (request !== "Suspend") return
        yield* Deferred.await(hold.value.release)
      })

      const verifyExpectedPauseResults = Effect.fn("AuthoredCassette.verifyExpectedPauseResults")(function* (
        expectedResults: ReadonlyArray<AuthoredPauseObservationResult>
      ) {
        if (expectedResults.length === 0) return
        const results = yield* Ref.get(activePauseObservationResults)
        /* v8 ignore start -- @preserve In-flight Unpause closure requires one active observation and its exact queued results. */
        if (Option.isNone(results)) return yield* Effect.die("no authored Pause observation is active")
        for (const expected of expectedResults) {
          const actual = yield* Queue.take(results.value)
          if (!pauseObservationResultMatches(actual, expected)) {
            return yield* Effect.die(
              `authored Pause observation expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`
            )
          }
        }
        /* v8 ignore stop -- @preserve */
      })

      const applyInFlightControlDirection = Effect.fn("AuthoredCassette.applyInFlightControlDirection")(function* (
        plannedAttempt: PlannedTaskAttempt
      ) {
        const direction = yield* cursor.consumeInFlightExecutorControlDirection(plannedAttempt.attemptId)
        if (Option.isNone(direction)) return
        const item = direction.value
        if (isRunCancellationDuringInFlight(item)) {
          const cancellation = yield* (yield* Ref.get(activeRunCancellation))({ runId }).pipe(Effect.orDie)
          if (cancellation._tag !== "RunCancellationApplied" && cancellation._tag !== "RunCancellationAlreadyApplied") {
            return yield* Effect.die(`authored in-flight cancellation returned unexpected result ${cancellation._tag}`)
          }
          return
        }
        const controlItem = item
        const requestedDirection = requestedInFlightControlDirection(controlItem)
        const application = (yield* Ref.get(activeOperatorControl))({
          direction: requestedDirection,
          subject: inFlightControlSubjectFor(controlItem, runId)
        })
        /* v8 ignore start -- @preserve The closed in-flight control schema covers rejection and terminal-observation variants; maintained #63 chronology exercises the exact queued-Waiting Unpause case. */
        const expectedFailureReason = expectedInFlightControlFailureReason(controlItem)
        yield* application.pipe(
          Effect.matchEffect({
            onFailure: (failure) =>
              expectedFailureReason !== undefined && operatorControlFailureMatches(failure, expectedFailureReason)
                ? Effect.void
                : Effect.die(failure),
            onSuccess: () =>
              expectedFailureReason === undefined
                ? Effect.void
                : Effect.die(`authored in-flight control expected ${expectedFailureReason}, received success`)
          })
        )
        yield* verifyExpectedPauseResults(expectedInFlightPauseResults(controlItem))
        /* v8 ignore stop -- @preserve */
      })

      const awaitExecutorPublicationHold = Effect.fn("AuthoredCassette.awaitExecutorPublicationHold")(function* (
        plannedAttempt: PlannedTaskAttempt,
        request: "Begin" | "Resume" | "Suspend"
      ) {
        const hold = yield* cursor.consumeExecutorRequestPublicationHold(
          plannedAttempt.taskId,
          plannedAttempt.attemptId,
          request
        )
        if (Option.isNone(hold)) return
        if (request !== "Suspend") {
          // Begin and Resume retain their established boundary: discard
          // publications captured before the hold, then await the next one.
          yield* Queue.takeAll(deliveryPublicationSignals)
          yield* Queue.take(deliveryPublicationSignals)
          return
        }
        const holdAdvancePosition = hold.value.releaseAfterStoryPosition
        const holdActivationOrdinal = yield* Ref.get(activeDeliveryActivation)
        let matchingPublicationObserved = false
        yield* Effect.whileLoop({
          while: () => !matchingPublicationObserved,
          body: () =>
            Queue.take(deliveryPublicationSignals).pipe(
              Effect.map(
                (publication) =>
                  publication.activationOrdinal === holdActivationOrdinal &&
                  publication.storyPosition > holdAdvancePosition
              )
            ),
          step: (matches) => {
            matchingPublicationObserved = matches
          }
        })
      })

      const applyNextControlDirection = (plannedAttempt: PlannedTaskAttempt, request: "Begin" | "Resume" | "Suspend") =>
        Effect.gen(function* () {
          yield* awaitPlannedSuspensionBoundary(plannedAttempt, request)
          yield* applyInFlightControlDirection(plannedAttempt)
          yield* awaitExecutorPublicationHold(plannedAttempt, request)
        })
      const beforeCompletionTask = yield* Ref.make<(request: CompletionTaskRequest) => Effect.Effect<void>>(
        /* v8 ignore next -- @preserve Most authored stories have no completion-task hold; tests replace this hook when chronology needs one. */
        () => Effect.void
      )
      const trackerAuthority = yield* Layer.build(
        controlledTrackerAuthorityLayer(cursor, Context.get(sharedContext, TrackerMutation), {
          reportInteractionMismatch: (failure) => Ref.set(authoredInteractionFailure, failure),
          lookupAcquisitionOperationTask: (operationId) =>
            Ref.get(acquisitionTaskIds).pipe(
              Effect.map((operations) => Option.fromUndefinedOr(operations.get(operationId)))
            ),
          beforeCompleteTask: (request) =>
            Ref.get(beforeCompletionTask).pipe(Effect.flatMap((boundary) => boundary(request)))
        })
      )
      const trackerMutationLayer = Layer.succeed(TrackerMutation, Context.get(trackerAuthority, TrackerMutation))
      const completionClaimBoundary = Context.get(trackerAuthority, CompletionClaimBoundary)
      const completionTaskBoundary = Context.get(trackerAuthority, CompletionTaskBoundary)
      const completionFinalityConfigured = cassette.story.some(
        (item) =>
          item._tag === "CompletionClaimReadReturned" ||
          item._tag === "CompletionClaimReplacementApplied" ||
          item._tag === "CompletionClaimDeletionApplied"
      )
      const completionTaskConfigured = cassette.story.some(
        (item) =>
          item._tag === "CompletionTaskFocusedReadReturned" ||
          item._tag === "CompletionTaskRequestLookupReturned" ||
          item._tag === "CompletionTaskRequestReturned"
      )
      const baseGitWorktree = Context.get(sharedContext, GitWorktree)
      const authoredGitWorktree = GitWorktree.of({
        ...baseGitWorktree,
        createPlannedWorktree: (plannedAttempt) =>
          Effect.gen(function* () {
            yield* cursor.awaitInFlightOperatorItems
            const lost = yield* cursor.consumeGitPlannedWorktreeCreateResponseLost
            if (Option.isNone(lost)) return yield* baseGitWorktree.createPlannedWorktree(plannedAttempt)
            yield* baseGitWorktree.createPlannedWorktree(plannedAttempt)
            return yield* new GitWorktreeCreateFailure({ detail: lost.value.detail, worktree: plannedAttempt.worktree })
          })
      })
      const gitWorktreeLayer = Layer.succeed(GitWorktree, authoredGitWorktree)
      const gitTargetLineage = Context.get(sharedContext, GitTargetLineage)
      const authoredTargetLineage = yield* Ref.make(cassette.startingFacts.targetLineageObservations ?? [])
      const authoredGitTargetLineage = GitTargetLineage.of({
        read: (plannedBaseSha, target) =>
          Effect.gen(function* () {
            const next = yield* Ref.modify(
              authoredTargetLineage,
              (remaining) => [remaining[0], remaining.slice(1)] as const
            )
            /* v8 ignore next -- @preserve Each authored target-lineage read is paired with its next declared observation. */
            if (next !== undefined) {
              return next.plannedBaseSha === plannedBaseSha
                ? next
                : yield* new GitTargetLineageReadFailure({
                    detail: "the authored observation names a different planned Base SHA",
                    plannedBaseSha,
                    target
                  })
            }
            return yield* gitTargetLineage.read(plannedBaseSha, target)
          })
      })
      const testGitWorktree = Context.get(sharedContext, TestGitWorktree)
      const trackerLayer = controlledTrackerGraphReaderLayer(cursor)
      const ordinaryInterpreterLayer = workflowInterpreterLayer.pipe(
        Layer.provide(Layer.merge(trackerLayer, trackerMutationLayer)),
        Layer.provide(gitWorktreeLayer),
        Layer.provide(Layer.succeed(GitTargetLineage, authoredGitTargetLineage))
      )
      const boundaryAdjustedInterpreterLayer = Layer.effect(
        WorkflowInterpreter,
        Effect.gen(function* () {
          const interpreter = yield* WorkflowInterpreter
          const gitWorktree = yield* GitWorktree
          return WorkflowInterpreter.of({
            ...interpreter,
            ...(exactCausalTrackerReadStory
              ? {
                  readTrackerGraph: (operation) =>
                    consumeControlledTrackerGraph(cursor, operation.target, {
                      graphReadCause: authoredConcurrentGraphReadCause(operation.cause._tag),
                      operationId: operation.operationId,
                      predecessorOperationIds: operation.predecessorOperationIds
                    }),
                  readTaskWorkSpecification: (operation) =>
                    consumeControlledTaskWorkSpecification(cursor, operation.taskId, {
                      operationId: operation.operationId,
                      predecessorOperationIds: operation.predecessorOperationIds
                    })
                }
              : {}),
            readTaskWorktree: (operation) =>
              Effect.gen(function* () {
                const change = yield* cursor.consumeGitWorktreeObservationChange
                if (Option.isSome(change)) {
                  yield* testGitWorktree.setObservation(change.value.observation)
                }
                return yield* observePlannedAttemptWorktreeThrough(gitWorktree, operation)
              }),
            readTargetLineage: (operation) => observeTargetLineageThrough(authoredGitTargetLineage, operation),
            reconcileTaskWorktree: (operation) =>
              controlledProviderReadiness.awaitTarget(operation.plannedAttempt).pipe(
                Effect.andThen(runGitWorktreeReconciliation(gitWorktree, operation.plannedAttempt)),
                Effect.map((proof) => AuthoritativeTaskWorktreeReady.make({ proof }))
              )
          })
        })
      ).pipe(Layer.provide(ordinaryInterpreterLayer), Layer.provide(gitWorktreeLayer))
      const baseControlPolicyLayer = taskWorkCapacityControlLayer
      const operatorControlLayer = Layer.mergeAll(
        attemptChoiceControlWithProvidedProtocolLayer,
        controlDirectionApplicationLayer,
        taskClaimReacquisitionControlLayer
      )
      const controlPolicyLayer = Layer.merge(baseControlPolicyLayer, operatorControlLayer)
      const planningLayer = (activationOrdinal: AuthoredRunActivationOrdinalType) =>
        Layer.mergeAll(
          deterministicOperationIdAllocatorLayer(`cassette:${runId}:activation:${activationOrdinal}:operation`),
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
      const preparedCandidateCorrelations = yield* Ref.make<
        ReadonlyMap<string, ReadonlyArray<IntegratorSessionCorrelation>>
      >(new Map())
      const integratorLayer = Layer.merge(
        Layer.succeed(
          Integrator,
          Integrator.of({
            prepare: (request) =>
              Effect.gen(function* () {
                const authoredCorrelation = authoredIntegratorSessionCorrelationOf(request.correlation, runId)
                yield* controlledProviderReadiness.awaitIntegratorTarget(authoredCorrelation)
                yield* cursor.consumeIntegratorRequest(authoredCorrelation)
                const authored = yield* cursor.consumeIntegratorResult
                if (authored.result._tag === "NotPrepared") {
                  return IntegratorResult.cases.NotPrepared.make({
                    correlation: request.correlation,
                    detail: authored.result.detail
                  })
                }
                const candidateText = authored.result.candidateText
                yield* Ref.update(preparedCandidateCorrelations, (current) => {
                  return new Map([
                    ...current,
                    [candidateText, [...(current.get(candidateText) ?? []), authoredCorrelation]]
                  ])
                })
                return IntegratorResult.cases.PreparedCandidate.make({
                  candidateText,
                  correlation: request.correlation
                })
              }).pipe(Effect.catchTag("AuthoredCassetteInteractionMismatch", Effect.die))
          })
        ),
        Layer.succeed(
          IntegratorGit,
          IntegratorGit.of({
            readCandidate: (target, candidateText) =>
              Effect.gen(function* () {
                const authored = yield* cursor.consumeIntegratorGitObservation(candidateText)
                const correlation = yield* Ref.modify(preparedCandidateCorrelations, (current) => {
                  const owners = current.get(candidateText) ?? []
                  const [owner, ...remaining] = owners
                  const next = new Map(
                    remaining.length === 0
                      ? [...current].filter(([existingCandidate]) => existingCandidate !== candidateText)
                      : [...current, [candidateText, remaining] as const]
                  )
                  return [owner, next] as const
                })
                if (correlation !== undefined) {
                  yield* controlledProviderReadiness.releaseSource(correlation, candidateText)
                }
                return authored.observation
              }).pipe(
                Effect.catchTag("AuthoredCassetteInteractionMismatch", Effect.die),
                Effect.mapError(
                  (failure) =>
                    new IntegratorGitReadFailure({
                      candidateText,
                      detail: `${failure._tag}: ${"detail" in failure ? failure.detail : "interaction mismatch"} at story position ${failure.storyPosition}`,
                      target
                    })
                )
              )
          })
        )
      )
      const coordinatorOwnership = CoordinatorOwnership.of({
        /* v8 ignore next -- Activation construction requires capability presence; cassette mutations use controlled authorities. */
        release: Effect.void,
        runMutation: (mutation) => mutation
      })
      const coordinatorOwnershipLayer = Layer.succeed(CoordinatorOwnership, coordinatorOwnership)
      const latestRuntimeActivationOrdinal = yield* Ref.make(0)
      const survivingExecutorReports = yield* Ref.make<ReadonlyMap<string, PlannedAttemptExecutorReport>>(new Map())
      const unresolvedLostExecutorResponses = yield* Ref.make<ReadonlySet<string>>(new Set())
      const executorLayer = controlledExecutorLayer({
        cursor,
        runId,
        beforeExecutorReport: applyNextControlDirection,
        survivingReports: survivingExecutorReports,
        unresolvedLostResponses: unresolvedLostExecutorResponses,
        prepareReport: prepareExecutorReport,
        reserveAcceptedSafeReport: (reserved) => Ref.set(acceptedSafeReport, Option.some(reserved)),
        reportMismatch: (failure) => Ref.set(authoredInteractionFailure, failure)
      })
      const runtimeLayerFor = (
        activationOrdinal: AuthoredRunActivationOrdinalType,
        opportunity: RunActivationOpportunityValue
      ) => {
        const interpreterLayer = journaledWorkflowInterpreterLayer(runId, boundaryAdjustedInterpreterLayer)
        const planning = planningLayer(activationOrdinal)
        const activationLayer = validatedRunActivationLayer(
          runId,
          command.integrationTarget,
          command.targetPromotionConfigured === true || targetPromotionStory ? { git: targetPromotionGit } : undefined,
          completionFinalityConfigured ? completionClaimBoundary : undefined,
          completionTaskConfigured ? completionTaskBoundary : undefined,
          preservingDispositionCleanupBoundaryLayer,
          evidenceStore,
          false,
          opportunity
        ).pipe(
          Layer.provide(integratorLayer),
          Layer.provide(interpreterLayer),
          Layer.provide(controlPolicyLayer),
          Layer.provide(executorLayer),
          Layer.provide(Layer.succeed(WorkflowTrace, trace)),
          Layer.provideMerge(planning)
        )
        return Layer.effectContext(
          Effect.gen(function* () {
            yield* Ref.set(activeDeliveryActivation, activationOrdinal)
            const context = yield* Layer.build(activationLayer)
            yield* Ref.set(beforeCompletionTask, (_request) =>
              Effect.gen(function* () {
                const item = yield* cursor.currentStoryItem
                if (item?._tag !== "CompletionTaskPrerequisiteReopened") return
                yield* cursor.consumeCompletionTaskPrerequisiteReopened.pipe(Effect.orDie)
              }).pipe(Effect.orDie)
            )
            return context
          })
        )
      }
      const runtimeLayer = ({ opportunity }: JournaledRuntimeLayerInput) =>
        Layer.unwrap(
          Ref.updateAndGet(latestRuntimeActivationOrdinal, (ordinal) => ordinal + 1).pipe(
            Effect.map((ordinal) => runtimeLayerFor(AuthoredRunActivationOrdinal.make(ordinal), opportunity))
          )
        )
      const operatorControlGraphReadBoundary = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        Effect.gen(function* () {
          yield* Ref.set(operatorControlGraphReadActive, true)
          const result = yield* effect
          return result
        }).pipe(Effect.ensuring(Ref.set(operatorControlGraphReadActive, false)))
      const makeApplicationProcess = Effect.gen(function* () {
        const applicationExit = yield* makeApplicationExitShell(coordinatorOwnership, {
          /* v8 ignore next -- @preserve Authored cassettes observe exit chronology without terminating the test process. */
          requestEnd: () => Effect.void
        })
        const application = journaledRunBootstrapLayer(
          runId,
          runtimeLayer,
          applicationExit,
          noopJournalMaintenanceObservation,
          operatorControlGraphReadBoundary
        ).pipe(Layer.provide(journalLayer), Layer.provide(coordinatorOwnershipLayer), Layer.provide(executorLayer))
        return { application, applicationExit }
      })
      const withAuthoredOperatorDriver = <A, E, R>(
        bootstrap: JournaledRunBootstrap["Service"],
        program: Effect.Effect<A, E, R>
      ) =>
        Effect.scoped(
          Effect.gen(function* () {
            yield* Ref.set(activeOperatorControl, bootstrap.operatorControl.applyControlDirection)
            yield* Ref.set(activeRunCancellation, bootstrap.operatorControl.applyRunCancellation)
            const requireActivePauseObservation = Effect.fn("AuthoredCassette.requireActivePauseObservation")(
              function* (
                subject: (typeof AuthoredCassetteStoryItem.cases.OperatorStartsPauseObservation.Type)["subject"]
              ) {
                const active = yield* Ref.get(activePauseObservation)
                /* v8 ignore start -- @preserve Authored Pause closure validation keeps observation results inside one matching active subscription. */
                if (Option.isNone(active)) return yield* Effect.die("no authored Pause observation is active")
                if (JSON.stringify(active.value.subject) !== JSON.stringify(subject)) {
                  return yield* Effect.die("authored Pause result subject does not match the active observation")
                }
                /* v8 ignore stop -- @preserve */
                return active.value
              }
            )

            const takeExpectedPauseResult = Effect.fn("AuthoredCassette.takeExpectedPauseResult")(function* (
              active: ActiveAuthoredPauseObservation,
              expected: AuthoredPauseObservationResult
            ) {
              const actual = yield* Queue.take(active.results)
              /* v8 ignore start -- @preserve Maintained authored cassettes assert the exact process-local view; the mismatch is only a generic authoring diagnostic. */
              if (!pauseObservationResultMatches(actual, expected)) {
                return yield* Effect.die(
                  `authored Pause observation expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`
                )
              }
              /* v8 ignore stop -- @preserve */
              return actual
            })

            const reconnectPauseObservation = Effect.fn("AuthoredCassette.reconnectPauseObservation")(function* (
              authored: typeof AuthoredCassetteStoryItem.cases.PauseProgressObservedCancelledAndReconnected.Type
            ) {
              yield* Queue.takeAll(deliveryPublicationSignals)
              yield* Queue.take(deliveryPublicationSignals)
              yield* Effect.yieldNow
              const journalLengthAtReconnect = (yield* sharedJournal.read(runId)).length
              /* v8 ignore start -- @preserve The authored disconnect/reconnect chronology uses a whole-Run Pause; task-subject reconnect is covered by the public observer acceptance tests. */
              const subject =
                authored.reconnectSubject._tag === "Run"
                  ? { _tag: "Run" as const, runId }
                  : { _tag: "Task" as const, runId, taskId: authored.reconnectSubject.taskId }
              /* v8 ignore stop -- @preserve */
              const reconnected = Array.from(
                yield* bootstrap.operatorControl.observePause(subject).pipe(
                  /* v8 ignore next -- @preserve The same exact view projector is exercised on the original subscription; reconnect merely derives a fresh terminal value. */
                  Stream.map((view) => pauseObservationResultOf(view, runId)),
                  Stream.runCollect
                )
              )
              /* v8 ignore start -- @preserve The maintained reconnect cassette declares the exact sole terminal view produced by the fresh subscription. */
              if (JSON.stringify(reconnected) !== JSON.stringify([authored.reconnectResult])) {
                return yield* Effect.die(
                  `authored reconnected Pause observation expected ${JSON.stringify(authored.reconnectResult)}, received ${JSON.stringify(reconnected)}`
                )
              }
              if ((yield* sharedJournal.read(runId)).length !== journalLengthAtReconnect) {
                return yield* Effect.die("reconnecting the process-local Pause observation appended a workflow record")
              }
              /* v8 ignore stop -- @preserve */
            })

            const driveCapacityChange = driveAuthoredTaskWorkCapacityChange({
              cursor,
              operatorControl: bootstrap.operatorControl,
              runId
            })
            const driveRunReactivationHints = Effect.gen(function* () {
              const storyPosition = AuthoredStoryPosition.make(yield* cursor.storyPosition)
              const authored = yield* cursor.consumeRunReactivationHints
              /* v8 ignore next -- @preserve The tag-selected driver consumes only the current hint burst. */
              if (Option.isNone(authored)) return
              const offer = yield* Ref.get(offerRunReactivationHint)
              yield* deliverAuthoredRunReactivationHints({
                complete: authoredHintDelivery.completeAt(storyPosition),
                hints: authored.value.hints,
                offer
              })
            }).pipe(Effect.orDie)
            const requirePlannedAttempt = Effect.fn("AuthoredCassette.requirePlannedAttempt")(function* (item: {
              readonly attemptId: AuthoredAttemptChoiceItem["attemptId"]
              readonly taskId: AuthoredAttemptChoiceItem["taskId"]
            }) {
              const records = yield* sharedJournal.read(runId)
              const planned = records
                .flatMap(({ event }) =>
                  event._tag === "TaskAttemptPlanned"
                    ? [event.operation]
                    : event._tag === "PlannedAttemptReplaced"
                      ? [event.successorPlan]
                      : []
                )
                .findLast(
                  ({ plannedAttempt }) =>
                    plannedAttempt.attemptId === item.attemptId && plannedAttempt.taskId === item.taskId
                )
              /* v8 ignore start -- @preserve Attempt-choice closure validation requires the exact earlier planned attempt. */
              if (planned === undefined) {
                return yield* Effect.die(
                  new Error(`authored attempt choice cannot find planned attempt ${item.attemptId}`)
                )
              }
              /* v8 ignore stop -- @preserve */
              return planned.plannedAttempt
            })
            const applyAttemptChoice = (
              plannedAttempt: PlannedTaskAttempt,
              observedTaskRevision: TaskRevision,
              choice: "ContinueExistingAttempt" | "RestartTaskImplementation" | "StopTaskImplementation",
              nonce: string
            ) =>
              Effect.result(
                bootstrap.operatorControl.applyAttemptChoice({
                  choice,
                  requestId: AttemptChoiceRequestId.make({ nonce, runId }),
                  subject: { observedTaskRevision, plannedAttempt }
                })
              )
            const confirmAppliedAttemptChoice = Effect.fn("AuthoredCassette.confirmAppliedAttemptChoice")(function* (
              item: AuthoredAttemptChoiceItem,
              requestId: AttemptChoiceRequestId,
              result: AttemptChoiceControlResult
            ) {
              if (result._tag !== "Success") {
                const reason = attemptChoiceFailureReason(result.failure)
                /* v8 ignore start -- @preserve AttemptChoiceControl's closed tagged failure union is classified exhaustively. */
                if (reason === undefined) {
                  return yield* Effect.die(
                    new Error(`authored attempt choice ${item.requestNonce} failed with unexpected failure`)
                  )
                }
                /* v8 ignore stop -- @preserve */
                /* v8 ignore next -- @preserve Accepted cassette stories do not intentionally drive the attempt-choice boundary to a typed failure. */
                return yield* Effect.die(
                  new Error(`authored attempt choice ${item.requestNonce} failed with ${reason}`)
                )
              }
              if (!appliedAttemptChoiceMatches(item, result.success)) {
                return yield* Effect.die(
                  new Error(
                    `authored attempt-choice result mismatch for ${item.requestNonce}: expected ${JSON.stringify(item.expected)}, received ${JSON.stringify(result.success)}`
                  )
                )
              }
              const queried = yield* bootstrap.operatorControl.readAttemptChoice(requestId)
              /* v8 ignore start -- @preserve The query is derived from the exact application record written immediately above. */
              if (!queriedAttemptChoiceMatches(result.success, queried)) {
                return yield* Effect.die(new Error(`authored attempt-choice query mismatch for ${item.requestNonce}`))
              }
              /* v8 ignore stop -- @preserve */
              if (item._tag === "OperatorStopsAttempt" || item._tag === "OperatorRestartsAttempt") {
                yield* Deferred.succeed(admittedContinuationChoiceApplied, undefined)
              }
            })
            const driveAttemptChoice = Effect.uninterruptibleMask((restore) =>
              Effect.gen(function* () {
                const authored = yield* cursor.consumeAttemptChoiceClaimed((item) =>
                  operatorAttemptChoiceLifecycle.claim(
                    JSON.stringify(AttemptChoiceRequestId.make({ nonce: item.requestNonce, runId }))
                  )
                )
                /* v8 ignore start -- @preserve The exhaustive direct-item dispatcher invokes this driver only for the current attempt-choice tag. */
                if (Option.isNone(authored)) return
                /* v8 ignore stop -- @preserve */
                const { claim, item } = authored.value
                const requestId = AttemptChoiceRequestId.make({ nonce: item.requestNonce, runId })
                yield* operatorAttemptChoiceLifecycle.runClaimed(
                  claim,
                  restore(
                    Effect.gen(function* () {
                      const plannedAttempt = yield* requirePlannedAttempt(item)
                      const result = yield* applyAttemptChoice(
                        plannedAttempt,
                        item.observedTaskRevision,
                        attemptChoiceDirectionFor(item),
                        item.requestNonce
                      )
                      if (item.expected._tag === "Rejected") {
                        if (!attemptChoiceRejectionMatches(item, result)) {
                          return yield* Effect.die(
                            new Error(`authored attempt-choice rejection mismatch for ${item.requestNonce}`)
                          )
                        }
                        return
                      }
                      yield* confirmAppliedAttemptChoice(item, requestId, result)
                    })
                  )
                )
              })
            ).pipe(Effect.orDie)
            const driveAttemptChoiceRace = Effect.gen(function* () {
              const authored = yield* cursor.consumeAttemptChoiceRace
              /* v8 ignore start -- @preserve The tag-selected driver runs only while the race item is current. */
              if (Option.isNone(authored)) return
              /* v8 ignore stop -- @preserve */
              const item = authored.value
              const plannedAttempt = yield* requirePlannedAttempt(item)
              const apply = (choice: "ContinueExistingAttempt" | "StopTaskImplementation", nonce: string) =>
                applyAttemptChoice(plannedAttempt, item.observedTaskRevision, choice, nonce)
              const results = yield* Effect.all(
                [
                  apply("ContinueExistingAttempt", item.continueRequestNonce),
                  apply("StopTaskImplementation", item.stopRequestNonce)
                ],
                { concurrency: "unbounded" }
              )
              /* v8 ignore start -- @preserve Atomic request-key application makes one success and one AlreadyApplied failure exhaustive. */
              if (!attemptChoiceRaceHasOneWinner(results)) {
                return yield* Effect.die(new Error("authored concurrent Continue/Stop race did not produce one winner"))
              }
              /* v8 ignore stop -- @preserve */
            }).pipe(Effect.orDie)
            type AuthoredControlDirectionItem =
              | typeof AuthoredCassetteStoryItem.cases.OperatorAppliesControlDirection.Type
              | typeof AuthoredCassetteStoryItem.cases.OperatorAppliesControlDirectionBeforeDeliveryActionAdmission.Type
            type OperatorGraphReadGate = { readonly release: Deferred.Deferred<void>; readonly taskId: TaskId }
            const operatorGraphReadGateFor = (
              expected: AuthoredControlDirectionItem,
              authoredItem: AuthoredCassetteStoryItem | undefined
            ): Effect.Effect<Option.Option<OperatorGraphReadGate>> => {
              const subject =
                authoredItem?._tag === "OperatorAppliesControlDirectionBeforeDeliveryActionAdmission"
                  ? authoredItem.subject
                  : undefined
              if (
                expected._tag !== "OperatorAppliesControlDirectionBeforeDeliveryActionAdmission" ||
                authoredItem?._tag !== "OperatorAppliesControlDirectionBeforeDeliveryActionAdmission" ||
                subject?._tag !== "Task"
              ) {
                return Effect.succeed(Option.none())
              }
              return Deferred.make<void>().pipe(
                Effect.map((release) => Option.some({ release, taskId: subject.taskId }))
              )
            }
            const releaseOperatorGraphReadGate = Effect.gen(function* () {
              const gate = yield* Ref.get(operatorControlGraphReadGate)
              if (Option.isNone(gate)) return
              yield* Ref.set(operatorControlGraphReadGate, Option.none())
              yield* Deferred.succeed(gate.value.release, undefined)
            })
            const driveControlDirection = (expected: AuthoredControlDirectionItem) =>
              Effect.gen(function* () {
                const authoredItem = yield* cursor.currentStoryItem
                const operatorGraphReadGate = yield* operatorGraphReadGateFor(expected, authoredItem)
                yield* Ref.set(operatorControlGraphReadGate, operatorGraphReadGate)
                const direction = yield* cursor.consumeControlDirection(expected)
                /* v8 ignore start -- the tag-selected driver exclusively consumes this exact cursor item. */
                if (Option.isNone(direction)) {
                  yield* releaseOperatorGraphReadGate
                  return
                }
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
                yield* releaseOperatorGraphReadGate
                if (direction.value._tag === "OperatorAppliesControlDirectionBeforeDeliveryActionAdmission") {
                  yield* cursor.completeControlDirectionBeforeDeliveryActionAdmission
                }
              }).pipe(Effect.ensuring(releaseOperatorGraphReadGate), Effect.orDie)
            const driveRunCancellation = Effect.gen(function* () {
              const authored = yield* cursor.consumeRunCancellation
              /* v8 ignore next -- @preserve The exhaustive direct-item dispatcher invokes this driver only for the current cancellation tag. */
              if (Option.isNone(authored)) return
              /* v8 ignore stop -- @preserve */
              const result = yield* bootstrap.operatorControl.applyRunCancellation({ runId })
              if (result._tag !== "RunCancellationApplied" && result._tag !== "RunCancellationAlreadyApplied") {
                return yield* Effect.die(`authored cancellation returned unexpected result ${result._tag}`)
              }
            }).pipe(Effect.orDie)
            const drivePauseObservationStart = Effect.gen(function* () {
              const authored = yield* cursor.consumePauseObservationStart
              /* v8 ignore start -- @preserve The exhaustive direct-item dispatcher invokes this driver only for the current observation-start tag, and closure rejects overlapping starts. */
              if (Option.isNone(authored)) return
              if (Option.isSome(yield* Ref.get(activePauseObservation))) {
                return yield* Effect.die("an authored Pause observation is already active")
              }
              /* v8 ignore stop -- @preserve */
              const observed = yield* Queue.unbounded<AuthoredPauseObservationResult>()
              const item = authored.value
              const subject =
                item.subject._tag === "Run"
                  ? { _tag: "Run" as const, runId }
                  : { _tag: "Task" as const, runId, taskId: item.subject.taskId }
              const fiber = yield* bootstrap.operatorControl.observePause(subject).pipe(
                Stream.runForEach((view) => {
                  const result = pauseObservationResultOf(view, runId)
                  return Queue.offer(observed, result)
                }),
                Effect.catch((failure) => {
                  const absence = { _tag: "PauseNotApplied" } as const
                  /* v8 ignore next -- @preserve Pause observation exposes only the closed PauseNotApplied failure. */
                  return failure._tag === "PauseNotApplied"
                    ? Queue.offer(observed, absence)
                    : Effect.die("authored Pause observation failed with an unexpected error")
                }),
                Effect.forkIn(authoredRunScope, {
                  startImmediately: authored.value._tag === "OperatorStartsPauseObservation"
                })
              )
              yield* Ref.set(activePauseObservation, Option.some({ fiber, results: observed, subject: item.subject }))
              yield* Ref.set(activePauseObservationResults, Option.some(observed))
              yield* Deferred.succeed(initialPauseObservationConsumed, undefined)
            }).pipe(Effect.orDie)
            const drivePauseProgressObservedCancelledAndReconnected = Effect.gen(function* () {
              const authored = yield* cursor.consumePauseProgressObservedCancelledAndReconnected
              /* v8 ignore start -- @preserve The exhaustive direct-item dispatcher invokes this driver only for the current cancel/reconnect tag. */
              if (Option.isNone(authored)) return
              /* v8 ignore stop -- @preserve */
              const active = yield* requireActivePauseObservation(authored.value.subject)
              yield* takeExpectedPauseResult(active, authored.value.result)
              const journalLengthBeforeCancel = (yield* sharedJournal.read(runId)).length
              yield* Fiber.interrupt(active.fiber).pipe(Effect.forkScoped)
              /* v8 ignore start -- @preserve The passive observer has no journal capability; the maintained cassette separately asserts that no Pause-progress event exists. */
              if ((yield* sharedJournal.read(runId)).length !== journalLengthBeforeCancel) {
                return yield* Effect.die("ending the process-local Pause observation appended a workflow record")
              }
              /* v8 ignore stop -- @preserve */
              yield* Ref.set(activePauseObservation, Option.none())
              yield* Ref.set(activePauseObservationResults, Option.none())
              yield* reconnectPauseObservation(authored.value)
            }).pipe(Effect.orDie)
            const drivePauseProgressObserved = Effect.gen(function* () {
              const authored = yield* cursor.consumePauseProgressObserved
              /* v8 ignore start -- @preserve The exhaustive direct-item dispatcher invokes this driver only for the current Pause result tag. */
              if (Option.isNone(authored)) return
              /* v8 ignore stop -- @preserve */
              const active = yield* requireActivePauseObservation(authored.value.subject)
              const actual = yield* takeExpectedPauseResult(active, authored.value.result)
              /* v8 ignore start -- @preserve Maintained standalone result items observe nonterminal Waiting; terminal values are consumed by the contiguous await and reconnect chronologies. */
              if (actual._tag !== "PauseWaiting") yield* Ref.set(activePauseObservation, Option.none())
              if (actual._tag !== "PauseWaiting") yield* Ref.set(activePauseObservationResults, Option.none())
              /* v8 ignore stop -- @preserve */
            }).pipe(Effect.orDie)
            const drivePauseProgressAwait = Effect.gen(function* () {
              let expectations: ReadonlyArray<typeof AuthoredCassetteStoryItem.cases.OperatorAwaitsPauseProgress.Type> =
                []
              let authored = yield* cursor.consumePauseProgressAwait
              while (Option.isSome(authored)) {
                expectations = [...expectations, authored.value]
                authored = yield* cursor.consumePauseProgressAwait
              }
              /* v8 ignore start -- @preserve The exhaustive direct-item dispatcher invokes this driver only while at least one contiguous await is current; closure binds all awaits to the active subject. */
              if (expectations.length === 0) return
              const active = yield* Ref.get(activePauseObservation)
              if (Option.isNone(active)) return yield* Effect.die("no authored Pause observation is active")
              if (
                expectations.some(({ subject }) => JSON.stringify(subject) !== JSON.stringify(active.value.subject))
              ) {
                return yield* Effect.die("authored Pause result subject does not match the active observation")
              }
              /* v8 ignore stop -- @preserve */
              for (const expected of expectations) {
                const actual = yield* Queue.take(active.value.results)
                /* v8 ignore start -- @preserve Maintained authored cassettes assert the exact queued result; this mismatch is only a generic authoring diagnostic. */
                if (!pauseObservationResultMatches(actual, expected.result)) {
                  return yield* Effect.die(
                    `authored Pause observation expected ${JSON.stringify(expected.result)}, received ${JSON.stringify(actual)}`
                  )
                }
                /* v8 ignore stop -- @preserve */
                if (actual._tag !== "PauseWaiting") {
                  yield* Ref.set(activePauseObservation, Option.none())
                  yield* Ref.set(activePauseObservationResults, Option.none())
                }
              }
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
            const drivePlannedSuspensionExecutorBoundaryRelease = Effect.gen(function* () {
              const authored = yield* cursor.consumePlannedAttemptSuspensionExecutorBoundaryRelease
              /* v8 ignore start -- @preserve The direct-item dispatcher and paired-hold closure guarantee this exact release and correlation. */
              if (Option.isNone(authored)) return
              const gate = yield* Ref.get(plannedSuspensionExecutorBoundaryGate)
              if (
                Option.isNone(gate) ||
                gate.value.attemptId !== authored.value.attemptId ||
                gate.value.taskId !== authored.value.taskId
              ) {
                return yield* Effect.die(
                  `no held planned suspension matches ${authored.value.taskId}/${authored.value.attemptId}`
                )
              }
              /* v8 ignore stop -- @preserve */
              yield* Deferred.succeed(gate.value.release, undefined)
              yield* Ref.set(plannedSuspensionExecutorBoundaryGate, Option.none())
            }).pipe(Effect.orDie)
            const drivePlannedContinuationExecutorBoundaryRelease = Effect.gen(function* () {
              const authored = yield* cursor.consumePlannedAttemptContinuationExecutorBoundaryRelease
              /* v8 ignore start -- @preserve The direct-item dispatcher and paired-hold closure guarantee this exact release and correlation. */
              if (Option.isNone(authored)) return
              const key = `${authored.value.taskId}:${authored.value.attemptId}`
              const gates = yield* Ref.get(plannedContinuationExecutorBoundaryGate)
              const gate = gates.get(key)
              if (gate === undefined) {
                return yield* Effect.die(
                  `no held planned continuation matches ${authored.value.taskId}/${authored.value.attemptId}`
                )
              }
              /* v8 ignore stop -- @preserve */
              yield* Deferred.succeed(gate.release, undefined)
              yield* Ref.set(
                plannedContinuationExecutorBoundaryGate,
                new Map([...gates].filter(([candidate]) => candidate !== key))
              )
            }).pipe(Effect.orDie)
            const drivePlannedContinuationExecutorBoundaryHold = Effect.gen(function* () {
              const authored = yield* cursor.consumePlannedAttemptContinuationExecutorBoundaryHold
              /* v8 ignore start -- @preserve The direct-item dispatcher invokes this exact hold once; closure rejects an unmatched or duplicate hold. */
              if (Option.isNone(authored)) return
              const key = `${authored.value.taskId}:${authored.value.attemptId}`
              const gates = yield* Ref.get(plannedContinuationExecutorBoundaryGate)
              if (gates.has(key)) return yield* Effect.die(`planned continuation hold ${key} is already active`)
              /* v8 ignore stop -- @preserve */
              const release = yield* Deferred.make<void>()
              yield* Ref.update(plannedContinuationExecutorBoundaryGate, (current) =>
                new Map(current).set(key, {
                  attemptId: authored.value.attemptId,
                  release,
                  taskId: authored.value.taskId
                })
              )
            }).pipe(Effect.orDie)
            const drivePlannedSuspensionExecutorBoundaryHold = Effect.gen(function* () {
              const authored = yield* cursor.consumePlannedAttemptSuspensionExecutorBoundaryHold
              /* v8 ignore start -- @preserve The direct-item dispatcher invokes this exact hold once; closure rejects an overlapping hold. */
              if (Option.isNone(authored)) return
              if (Option.isSome(yield* Ref.get(plannedSuspensionExecutorBoundaryGate))) {
                return yield* Effect.die("a planned suspension executor-boundary hold is already armed")
              }
              /* v8 ignore stop -- @preserve */
              const release = yield* Deferred.make<void>()
              yield* Ref.set(
                plannedSuspensionExecutorBoundaryGate,
                Option.some({ attemptId: authored.value.attemptId, release, taskId: authored.value.taskId })
              )
            }).pipe(Effect.orDie)
            const driveTargetPromotionReconciliationReadBoundaryRelease = Effect.gen(function* () {
              const authored = yield* cursor.consumeTargetPromotionReconciliationReadBoundaryRelease
              /* v8 ignore start -- @preserve The direct-item dispatcher and paired-hold closure guarantee this exact request-correlated release. */
              if (Option.isNone(authored)) return
              const gate = yield* Ref.get(targetPromotionReconciliationReadBoundaryGate)
              if (
                Option.isNone(gate) ||
                JSON.stringify(gate.value.request) !== JSON.stringify(authored.value.request)
              ) {
                return yield* Effect.die(
                  `no held target-promotion reconciliation read matches ${JSON.stringify(authored.value.request)}`
                )
              }
              /* v8 ignore stop -- @preserve */
              yield* Deferred.succeed(gate.value.release, undefined)
              yield* Ref.set(targetPromotionReconciliationReadBoundaryGate, Option.none())
            }).pipe(Effect.orDie)
            const driveTaskWorkSpecificationReadBoundaryHold = cursor.consumeTaskWorkSpecificationReadBoundaryHold.pipe(
              Effect.asVoid,
              Effect.orDie
            )
            const driveTaskWorkSpecificationReadBoundaryRelease =
              cursor.consumeTaskWorkSpecificationReadBoundaryRelease.pipe(Effect.asVoid, Effect.orDie)
            const driveAuthoredOperatorItem = (item: DirectlyDrivenStoryItem) =>
              Match.valueTags(item, {
                OperatorAppliesControlDirection: (item) => driveControlDirection(item),
                OperatorAppliesControlDirectionBeforeDeliveryActionAdmission: (item) => driveControlDirection(item),
                OperatorAppliesRunCancellation: () => driveRunCancellation,
                CassetteHoldsPlannedAttemptSuspensionBeforeExecutorBoundary: () =>
                  drivePlannedSuspensionExecutorBoundaryHold,
                CassetteOffersRunReactivationHints: () => driveRunReactivationHints,
                CassetteHoldsPlannedAttemptContinuationBeforeExecutorBoundary: () =>
                  drivePlannedContinuationExecutorBoundaryHold,
                CassetteReleasesHeldPlannedAttemptSuspension: () => drivePlannedSuspensionExecutorBoundaryRelease,
                CassetteReleasesHeldPlannedAttemptContinuation: () => drivePlannedContinuationExecutorBoundaryRelease,
                CassetteReleasesHeldTargetPromotionReconciliationRead: () =>
                  driveTargetPromotionReconciliationReadBoundaryRelease,
                CassetteHoldsTaskWorkSpecificationReadBeforeBoundary: () => driveTaskWorkSpecificationReadBoundaryHold,
                CassetteReleasesHeldTaskWorkSpecificationRead: () => driveTaskWorkSpecificationReadBoundaryRelease,
                OperatorContinuesAttempt: () => driveAttemptChoice,
                OperatorDirectsTaskClaimReacquisition: () => driveClaimReacquisition,
                OperatorRacesContinueAndStop: () => driveAttemptChoiceRace,
                OperatorRestartsAttempt: () => driveAttemptChoice,
                OperatorAwaitsPauseProgress: () => drivePauseProgressAwait,
                OperatorStartsPauseObservation: () => drivePauseObservationStart,
                OperatorSubscribesToPauseObservation: () => drivePauseObservationStart,
                OperatorStopsAttempt: () => driveAttemptChoice,
                PauseProgressObserved: () => drivePauseProgressObserved,
                PauseProgressObservedCancelledAndReconnected: () => drivePauseProgressObservedCancelledAndReconnected,
                SetTaskExecutionCapacity: () => driveCapacityChange
              })
            const nextDirectlyDrivenItem = Effect.gen(function* () {
              const current = yield* cursor.currentStoryItem
              if (isDirectlyDrivenStoryItem(current)) return current
              const next = yield* cursor.storyItems.pipe(Stream.filter(isDirectlyDrivenStoryItem), Stream.runHead)
              return yield* Option.match(next, {
                /* v8 ignore next -- @preserve Every decoded story retains its terminal assertion after the last directly-driven item. */
                onNone: () => Effect.die("authored direct-item stream ended before terminal assertions"),
                onSome: Effect.succeed
              })
            })
            const driver = yield* nextDirectlyDrivenItem.pipe(
              Effect.flatMap(driveAuthoredOperatorItem),
              Effect.forever,
              Effect.forkScoped
            )
            return yield* Effect.raceFirst(
              program,
              Fiber.join(driver).pipe(Effect.andThen(Effect.die("authored direct-item driver ended unexpectedly")))
            )
          })
        )

      const controlledExecutorFactory = (factoryRunId: RunId, factoryTarget: typeof command.target) =>
        Effect.gen(function* () {
          const live = yield* makeLiveDeliveryActionExecutor(factoryRunId, factoryTarget)
          type ControlledDeliveryAction = Parameters<DeliveryActionExecutorService["execute"]>[0]
          const observedOrResumedPlannedAttempt = (
            action: ControlledDeliveryAction
          ): PlannedTaskAttempt | undefined => {
            /* v8 ignore next -- @preserve This helper is called only by the identity-free delivery executor wrapper. */
            if (action._tag !== "IdentityFreeAction") return undefined
            const route = action.proposal.route
            if (route._tag === "FreshExecutorWorkflowRoute") {
              return route.step._tag === "ObservePlannedAttemptExecutorWork" ? route.step.plannedAttempt : undefined
            }
            const transition = route.transition
            if (
              transition._tag !== "ObservePlannedAttemptExecutorWork" &&
              transition._tag !== "ResumePlannedAttemptExecutorWorkAfterCurrentFacts"
            ) {
              return undefined
            }
            return transition.plannedAttempt
          }

          const resumedPlannedAttempt = (action: ControlledDeliveryAction): PlannedTaskAttempt | undefined => {
            if (action._tag !== "IdentityFreeAction" || action.proposal.route._tag !== "IdentityFreeWorkflowRoute") {
              return undefined
            }
            const transition = action.proposal.route.transition
            return transition._tag === "ResumePlannedAttemptExecutorWorkAfterCurrentFacts"
              ? transition.plannedAttempt
              : undefined
          }

          const begunPlannedAttempt = (action: ControlledDeliveryAction): PlannedTaskAttempt | undefined => {
            if (action._tag !== "IdentityFreeAction" || action.proposal.route._tag !== "FreshExecutorWorkflowRoute") {
              return undefined
            }
            const step = action.proposal.route.step
            return step._tag === "BeginPlannedAttemptExecutorWork" ? step.plannedAttempt : undefined
          }

          const awaitAdmittedContinuationChoice = Effect.fn("AuthoredCassette.awaitAdmittedContinuationChoice")(
            function* (action: ControlledDeliveryAction) {
              const hold = yield* cursor.consumeAdmittedContinuationExecutorIntentHold
              if (Option.isNone(hold)) return
              const plannedAttempt = resumedPlannedAttempt(action)
              /* v8 ignore start -- @preserve Hold closure validation places this synchronization only before the exact admitted Resume action. */
              if (plannedAttempt === undefined) {
                return yield* Effect.die(
                  new Error(
                    `authored continuation hold expected ResumePlannedAttemptExecutorWorkAfterCurrentFacts, received ${action.proposal.route._tag}`
                  )
                )
              }
              /* v8 ignore stop -- @preserve */
              /* v8 ignore start -- @preserve Hold closure validation binds the admitted continuation to this exact planned attempt. */
              if (plannedAttempt.attemptId !== hold.value.attemptId || plannedAttempt.taskId !== hold.value.taskId) {
                return yield* Effect.die(
                  new Error(
                    `authored continuation hold expected ${hold.value.taskId}/${hold.value.attemptId}, received ${plannedAttempt.taskId}/${plannedAttempt.attemptId}`
                  )
                )
              }
              /* v8 ignore stop -- @preserve */
              yield* Deferred.await(admittedContinuationChoiceApplied)
            }
          )
          const awaitPlannedContinuationExecutorBoundary = Effect.fn(
            "AuthoredCassette.awaitPlannedContinuationExecutorBoundary"
          )(function* (action: ControlledDeliveryAction) {
            const plannedAttempt = observedOrResumedPlannedAttempt(action)
            if (plannedAttempt === undefined) return
            const key = `${plannedAttempt.taskId}:${plannedAttempt.attemptId}`
            const current = yield* cursor.currentStoryItem
            if (current?._tag === "CassetteHoldsPlannedAttemptContinuationBeforeExecutorBoundary") {
              yield* cursor.awaitCurrentStoryAdvance
            }
            const gate = (yield* Ref.get(plannedContinuationExecutorBoundaryGate)).get(key)
            if (gate !== undefined) yield* Deferred.await(gate.release)
          })
          return {
            ...live,
            execute: (action, lease) =>
              Effect.gen(function* () {
                yield* awaitAdmittedContinuationChoice(action)
                yield* awaitPlannedContinuationExecutorBoundary(action)
                const begun = begunPlannedAttempt(action)
                return yield* begun === undefined
                  ? live.execute(action, lease)
                  : afterAuthoredExecutorReadiness(controlledExecutorReadiness, begun, live.execute(action, lease))
              })
          } satisfies DeliveryActionExecutorService
        })

      const initialControlPolicyEvaluations = yield* Ref.make(0)
      const initialControlPolicySource = Ref.updateAndGet(initialControlPolicyEvaluations, (count) => count + 1).pipe(
        Effect.flatMap((evaluationCount) =>
          /* v8 ignore next -- @preserve One authored Run evaluates its initial policy exactly once; reevaluation is a fail-fast harness defect. */
          evaluationCount === 1
            ? Effect.succeed(initial.policy)
            : Effect.die("an authored Run must not reevaluate its initial control-policy source")
        )
      )
      const activateRun = (activationOrdinal: AuthoredRunActivationOrdinalType) =>
        Ref.set(activeDeliveryActivation, activationOrdinal).pipe(
          Effect.andThen(
            runWorkflowWithControlledDeliveryActionExecutor(
              command.target,
              initialControlPolicySource,
              runId,
              controlledExecutorFactory,
              false
            ).pipe(Effect.provide(planningLayer(activationOrdinal)))
          )
        )
      const activateRunInNewApplicationProcess = (activationOrdinal: AuthoredRunActivationOrdinalType) =>
        Effect.scoped(
          Effect.gen(function* () {
            const { application } = yield* makeApplicationProcess
            const applicationContext = yield* Layer.build(application)
            const bootstrap = Context.get(applicationContext, JournaledRunBootstrap)
            return yield* withAuthoredOperatorDriver(
              bootstrap,
              activateRun(activationOrdinal).pipe(Effect.provide(applicationContext))
            )
          })
        )
      const settleReactivationOwnerReturn = (decision: CoordinatorFinalityDecision) =>
        settleAuthoredReactivationOwnerReturn(cassette.processLifecycle, cursor, decision)
      const runThroughProductionReactivationOwner = (
        trackerSource: { readonly _tag: "CurrentFirst" } | { readonly _tag: "NoCurrent" }
      ) =>
        Effect.gen(function* () {
          yield* Ref.update(reactivationOwnerProcessGenerationCount, (count) => count + 1)
          const { application, applicationExit } = yield* makeApplicationProcess
          const applicationContext = yield* Layer.build(application)
          const bootstrap = Context.get(applicationContext, JournaledRunBootstrap)
          const failure = yield* Deferred.make<unknown>()
          const activationReturns = yield* Queue.unbounded<AuthoredActivationReturnSignal>()
          const quietInterval = Duration.hours(1)
          const trackerNotificationSource = {
            attach: Effect.gen(function* () {
              const authored = yield* cursor.consumeCurrentTrackerNotification
              if (Option.isNone(authored) && trackerSource._tag === "CurrentFirst") {
                return yield* Effect.die("the authored current-first tracker source requires one exact notification")
              }
              return {
                changes: Stream.empty,
                current: Option.isSome(authored) ? { _tag: "AuthoredTrackerNotification" as const } : undefined
              }
            }),
            changes: Stream.empty,
            get: Effect.void
          }
          const coordinateActivationReturn = Effect.fn("AuthoredCassette.coordinateActivationReturn")(function* (
            decision: CoordinatorFinalityDecision
          ) {
            const settled = yield* settleReactivationOwnerReturn(decision)
            if (Option.isNone(settled)) return
            const acknowledgement = yield* Deferred.make<void>()
            const { successor, successorPosition } = settled.value
            const correlatedSuccessor =
              successor?._tag === "CassetteOffersRunReactivationHints" && successorPosition !== undefined
                ? {
                    _tag: "HintDelivery" as const,
                    awaitDelivery: authoredHintDelivery.awaitAt(AuthoredStoryPosition.make(successorPosition))
                  }
                : { _tag: "StoryItem" as const, item: successor }
            yield* Queue.offer(activationReturns, { acknowledgement, successor: correlatedSuccessor })
            yield* Deferred.await(acknowledgement)
          })
          const ownerLayer = runReactivationOwnerLayer({
            activate: (opportunity) =>
              Ref.get(latestRuntimeActivationOrdinal).pipe(
                Effect.flatMap((ordinal) =>
                  observeAuthoredCoordinatorProcessDeath(
                    runWorkflowWithControlledDeliveryActionExecutor(
                      command.target,
                      initialControlPolicySource,
                      runId,
                      controlledExecutorFactory,
                      false,
                      opportunity
                    )
                  ).pipe(
                    Effect.provide(planningLayer(AuthoredRunActivationOrdinal.make(ordinal + 1))),
                    Effect.provideService(JournaledRunBootstrap, bootstrap),
                    Effect.tap(coordinateActivationReturn)
                  )
                )
              ),
            activateActiveWorkAuthorityRefresh: (source) =>
              Ref.get(latestRuntimeActivationOrdinal).pipe(
                Effect.flatMap((ordinal) =>
                  observeAuthoredCoordinatorProcessDeath(
                    runWorkflowWithControlledDeliveryActionExecutorForActiveWorkAuthorityRefresh(
                      command.target,
                      initialControlPolicySource,
                      runId,
                      controlledExecutorFactory,
                      source,
                      false
                    )
                  ).pipe(
                    Effect.provide(planningLayer(AuthoredRunActivationOrdinal.make(ordinal + 1))),
                    Effect.provideService(JournaledRunBootstrap, bootstrap),
                    Effect.tap(coordinateActivationReturn)
                  )
                )
              ),
            activationInterval: quietInterval,
            failureCooldown: quietInterval,
            installAcceptedRunReactivationObservers: ({ acceptedFactPublication, control }) =>
              bootstrap.registerAcceptedRunReactivationObservers({
                control,
                acceptedFactPublication: () => acceptedFactPublication
              }),
            isTerminationFailure: (cause) => cause instanceof WorkflowRunAlreadyTerminated,
            onFailure: (cause) => Deferred.succeed(failure, cause).pipe(Effect.asVoid),
            readControl: bootstrap.readRunReactivationControl(command.target, runId),
            runId,
            ...(trackerSource._tag === "CurrentFirst" ? { trackerNotificationSource } : {})
          }).pipe(Layer.provide(Layer.succeed(ApplicationExitShell, applicationExit)))
          const ownerContext = yield* Layer.build(ownerLayer)
          const processContext = Context.merge(applicationContext, ownerContext)
          return yield* withAuthoredOperatorDriver(
            bootstrap,
            Effect.gen(function* () {
              const owner = yield* RunReactivationOwner
              yield* Queue.take(activationReturns).pipe(
                Effect.flatMap((signal) =>
                  awaitAuthoredProcessDeathAfterActivationReturn({
                    awaitActivationReturn: Effect.succeed(signal),
                    cursor,
                    onProcessDeath: Queue.offer(authoredCoordinatorProcessDeaths, undefined).pipe(Effect.asVoid)
                  })
                ),
                Effect.forever,
                Effect.catchCause((cause) => Deferred.succeed(failure, cause).pipe(Effect.asVoid)),
                Effect.forkScoped
              )
              yield* Ref.set(offerRunReactivationHint, (hint) =>
                owner.hint(
                  hint === "TrackerNotification"
                    ? RunReactivationHint.TrackerNotification()
                    : RunReactivationHint.Timer()
                )
              )
              return yield* awaitReactivationOwnerProcessOutcome(
                cursor.awaitTerminalAssertions,
                authoredCoordinatorProcessDeaths,
                failure
              )
            }).pipe(Effect.provide(processContext))
          )
        })
      const runAcrossActivations = Effect.gen(function* () {
        const firstActivationOrdinal = AuthoredRunActivationOrdinal.make(1)
        let coordinator = yield* Effect.forkScoped(activateRun(firstActivationOrdinal))
        let activationOrdinals: ReadonlyArray<AuthoredRunActivationOrdinalType> = [firstActivationOrdinal]
        let consumedLifecycleBoundaries = 0
        let activationOrdinal = firstActivationOrdinal
        while (consumedLifecycleBoundaries < coordinatorLifecycleBoundaryCount) {
          const boundaryExit = yield* Fiber.await(coordinator)
          const interactionFailure = yield* Ref.get(authoredInteractionFailure)
          if (interactionFailure !== undefined) return yield* interactionFailure
          const boundary = { _tag: "CoordinatorActivationReturned" as const, exit: boundaryExit }
          consumedLifecycleBoundaries += 1
          if (isAuthoredCoordinatorProcessDeath(boundary.exit)) {
            // The exact production action fiber raised the typed cassette
            // control. Its scoped activation has already unwound; do not
            // synthesize an interrupt, journal event, or recovery attempt.
          } else {
            yield* settleCoordinatorActivationReturn(cursor, boundary.exit)
          }
          yield* operatorAttemptChoiceLifecycle.awaitInFlightAtBoundary()
          if (yield* cursor.atTerminalAssertions) break
          activationOrdinal = AuthoredRunActivationOrdinal.make(activationOrdinal + 1)
          coordinator = yield* activateRun(activationOrdinal).pipe(Effect.forkScoped({ startImmediately: true }))
          activationOrdinals = [...activationOrdinals, activationOrdinal]
        }
        yield* Effect.raceFirst(
          cursor.awaitTerminalAssertions,
          Fiber.join(coordinator).pipe(
            /* v8 ignore next -- @preserve Accepted stories reach terminal assertions before their coordinator activation can stop. */
            Effect.andThen(
              Effect.flatMap(cursor.storyPosition, (storyPosition) =>
                Ref.get(acceptedEvidencePublicationFailure).pipe(
                  Effect.flatMap((failure) =>
                    failure === undefined
                      ? Effect.die(
                          `coordinator activation stopped at story position ${storyPosition} before the authored terminal assertions`
                        )
                      : Effect.fail(failure)
                  )
                )
              )
            )
          )
        )
        for (let settleTurn = 0; settleTurn < authoredSettlementYieldTurns; settleTurn += 1) yield* Effect.yieldNow
        const coordinatorExitAtAssertions = coordinator.pollUnsafe()
        yield* Fiber.interrupt(coordinator)
        return { activationOrdinals, coordinatorExitAtAssertions, records: yield* sharedJournal.read(runId) }
      })
      const runReactivationOwnerStory = Effect.gen(function* () {
        const firstActivationOrdinal = AuthoredRunActivationOrdinal.make(1)
        const coordinator = yield* Effect.forkScoped(activateRunInNewApplicationProcess(firstActivationOrdinal))
        const boundaryExit = yield* Fiber.await(coordinator)
        const interactionFailure = yield* Ref.get(authoredInteractionFailure)
        if (interactionFailure !== undefined) return yield* interactionFailure
        if (!isAuthoredCoordinatorProcessDeath(boundaryExit)) {
          return yield* Effect.die(
            "the authored current-first reactivation story requires one coordinator process death"
          )
        }
        yield* runThroughProductionReactivationOwner({ _tag: "CurrentFirst" })
        const activationCount = yield* Ref.get(latestRuntimeActivationOrdinal)
        return {
          activationOrdinals: Array.from({ length: activationCount }, (_, index) =>
            AuthoredRunActivationOrdinal.make(index + 1)
          ),
          coordinatorExitAtAssertions: undefined,
          records: yield* sharedJournal.read(runId)
        }
      })
      const runReactivationOwnerLifecycleStory = Effect.gen(function* () {
        while (!(yield* cursor.atTerminalAssertions)) {
          const outcome = yield* Effect.scoped(runThroughProductionReactivationOwner({ _tag: "NoCurrent" }))
          if (outcome === "TerminalAssertions") break
        }
        const activationCount = yield* Ref.get(latestRuntimeActivationOrdinal)
        return {
          activationOrdinals: Array.from({ length: activationCount }, (_, index) =>
            AuthoredRunActivationOrdinal.make(index + 1)
          ),
          coordinatorExitAtAssertions: undefined,
          records: yield* sharedJournal.read(runId)
        }
      })
      const runSingleActivation = Effect.gen(function* () {
        const activationOrdinal = AuthoredRunActivationOrdinal.make(1)
        const activationOrdinals: Array<AuthoredRunActivationOrdinalType> = [activationOrdinal]
        yield* activateRun(activationOrdinal)
        return { activationOrdinals, coordinatorExitAtAssertions: undefined, records: yield* sharedJournal.read(runId) }
      })
      const ordinaryCoordinatorExecution = Effect.gen(function* () {
        if (coordinatorLifecycleBoundaryCount > 0) return yield* runAcrossActivations
        return yield* runSingleActivation
      })
      const standardCoordinatorExecution = Effect.gen(function* () {
        const { application } = yield* makeApplicationProcess
        const applicationContext = yield* Layer.build(application)
        const bootstrap = Context.get(applicationContext, JournaledRunBootstrap)
        return yield* withAuthoredOperatorDriver(
          bootstrap,
          ordinaryCoordinatorExecution.pipe(Effect.provide(applicationContext))
        )
      })
      const processProvidedCoordinatorExecution = Effect.gen(function* () {
        const lifecycle = cassette.processLifecycle
        if (lifecycle?._tag === "CurrentFirstReactivationAfterProcessDeath") {
          return yield* runReactivationOwnerStory
        }
        if (lifecycle?._tag === "ReactivationOwnerProcessGenerations") {
          return yield* runReactivationOwnerLifecycleStory
        }
        return yield* standardCoordinatorExecution
      })
      const executionExit = yield* Effect.exit(
        Effect.scoped(
          processProvidedCoordinatorExecution.pipe(
            Effect.provideService(DeliveryRelationPublicationObserver, publicationObserver),
            Effect.provideService(DeliveryRuntimeObservationObserver, runtimeObservationObserver)
          )
        )
      )
      const publicationJournalFailure = yield* Ref.get(publicationObserverJournalFailure)
      if (publicationJournalFailure !== undefined) return yield* publicationJournalFailure
      const execution = yield* Exit.match(executionExit, { onFailure: Effect.failCause, onSuccess: Effect.succeed })
      const { activationOrdinals, coordinatorExitAtAssertions, records } = execution
      /* v8 ignore next -- @preserve Later authored activations return after their declared final read; action failures are asserted by the direct protocol cassette. */
      if (coordinatorExitAtAssertions !== undefined && Exit.isFailure(coordinatorExitAtAssertions)) {
        return yield* Effect.failCause(coordinatorExitAtAssertions.cause)
      }
      const assertions = yield* cursor.consumeTerminalAssertions
      const behaviorExit = yield* Effect.exit(assertAuthoredExpectedBehavior(records, assertions))
      if (Exit.isFailure(behaviorExit)) {
        return yield* Effect.failCause(behaviorExit.cause)
      }
      const observedBehavior = behaviorExit.value
      yield* controlledProviderReadiness.assertAllReleased()
      yield* controlledExecutorReadiness.assertAllReleased()
      const observationCaptures = (yield* Ref.get(observationCaptureState)).captures
      const observationMoments = yield* evaluateAuthoredObservationChronology(observationCaptures)
      const deliveryFrames = observationMoments.flatMap((moment) =>
        moment._tag === "DeliveryPublicationMoment" ? [moment.deliveryFrame] : []
      )
      const traceHistories = yield* Effect.gen(function* () {
        const reader = yield* TraceReader
        return yield* Effect.forEach(records, ({ position }) => reader.readAt(TraceCursor.make({ position, runId })))
      }).pipe(Effect.provide(TraceReaderLayer.pipe(Layer.provide(journalLayer))))
      return {
        activationOrdinals,
        cassette,
        deliveryFrames,
        history: reduceWorkflowJournalHistory(runId, records),
        observationCaptures,
        observationMoments,
        observedBehavior,
        records,
        reactivationOwnerProcessGenerationCount: yield* Ref.get(reactivationOwnerProcessGenerationCount),
        runId,
        traceHistories
      } satisfies AuthoredScenarioCassetteRun
    })
  )
}

/** Decodes and drives one story through the production coordinator activation program. */
export interface AuthoredScenarioCassetteRunFailure {
  readonly _tag: string
}

export const runAuthoredScenarioCassette: (
  input: unknown,
  options?: AuthoredScenarioCassetteRunOptions
) => Effect.Effect<AuthoredScenarioCassetteRun, AuthoredScenarioCassetteRunFailure, Crypto.Crypto> = (
  input,
  options = {}
) => runAuthoredScenarioCassetteWith({ input, options })

/** Internal source-test runner that retains every production runtime-observer evaluation callback. */
export const runAuthoredScenarioCassetteWithRuntimeEvaluations: (
  input: unknown,
  options?: AuthoredScenarioCassetteRunOptions
) => Effect.Effect<InternalAuthoredScenarioCassetteRun, AuthoredScenarioCassetteRunFailure, Crypto.Crypto> = (
  input,
  options = {}
) =>
  Effect.gen(function* () {
    const runtimeEvaluationCaptures = yield* Ref.make<ReadonlyArray<InternalAuthoredRuntimeEvaluationCapture>>([])
    const run = yield* runAuthoredScenarioCassetteWith({ input, options }, (capture) =>
      Ref.update(runtimeEvaluationCaptures, (captures) => [...captures, capture])
    )
    return { ...run, runtimeEvaluationCaptures: yield* Ref.get(runtimeEvaluationCaptures) }
  })
