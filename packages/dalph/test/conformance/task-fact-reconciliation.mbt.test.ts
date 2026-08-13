/* eslint-disable max-lines -- One driver keeps the model action-to-production-boundary map auditable. */
import { it } from "@effect/vitest"
import { defineDriver, ITFBigInt, stateCheck } from "@firfi/quint-connect/effect"
import { quintIt } from "@firfi/quint-connect/vitest"
import {
  AcceptedResult,
  AcceptedResultEvidenceManifest,
  AttemptId,
  EvidenceDigest,
  EvidenceReference,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorProjection,
  plannedTaskAttemptEquivalence,
  PlannedAttemptExecutorReport,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  WorktreeLocator
} from "@dalph/contracts"
import {
  ActiveTaskClaim,
  AttemptWorktreeLost,
  AuthoritativeTaskWorktreeReady,
  advanceAttemptStoppage,
  advanceAttemptRestart,
  AttemptChoiceControl,
  AttemptChoiceRequestId,
  attemptChoiceControlLayer,
  ClaimOwner,
  ClaimToken,
  continuePlannedAttemptExecutorWork,
  EvidenceStore,
  FixtureTarget,
  InitialControlPolicy,
  JournalPosition,
  JournalStore,
  legacyMemoryJournalStoreLayer,
  makePlannedAttemptProtocolController,
  OperationId,
  OperationIdAllocator,
  observePlannedAttemptExecutorState,
  observeAttemptStoppageExecutor,
  PlannedAttemptProtocolController,
  type PlannedAttemptProtocolControllerService,
  plannedAttemptProtocolControllerLayer,
  PlannedTaskAttemptPlanner,
  recordStoppedAttemptClaimNoRelease,
  makeApplicationExitLifecycle,
  requestPlannedAttemptExecutorSuspension,
  TaskClaimReleaseFailure,
  TaskLifecycle,
  TaskAttemptPlanRecordAcknowledged,
  TaskWorkCapacity,
  TrackerRevision,
  workflowJournalEventVersion
} from "../../../orchestrator/src/index.js"
import { Deferred, Effect, Fiber, Layer, Match, Option, Schema } from "effect"
import { expect } from "vitest"
import {
  makeDeliveryRuntimeAdmissionController,
  type DeliveryAdmissionReservation,
  type DeliveryRuntimeAdmissionController
} from "../../../orchestrator/src/coordination/delivery/delivery-runtime-admission.js"
import {
  DeliveryProposalId,
  trackerGraphReadProposalOf
} from "../../../orchestrator/src/coordination/delivery/delivery-proposal.js"
import { makeIntegrationTargetResourceController } from "../../../orchestrator/src/coordination/admission/integration-target-resource.js"
import { GitWorktreeReadFailure, PlannedWorktreeReady } from "../../../orchestrator/src/authorities/git/worktree.js"
import {
  GitTargetLineageReadFailure,
  TargetLineageObservation
} from "../../../orchestrator/src/authorities/git/target-lineage.js"
import { FixtureReadError } from "../../../orchestrator/src/authorities/task-tracker/graph-reader.js"
import { projectTrackerSnapshot } from "../../../orchestrator/src/authorities/task-tracker/graph.js"
import { makeTaskWorkSpecification } from "../../../orchestrator/src/authorities/task-tracker/task-work-specification.js"
import { makeRunRecoveryProjection } from "../../../orchestrator/src/coordination/run/recovery-activation.js"
import { deriveFreshWorkflowDecisions } from "../../../orchestrator/src/coordination/run/fresh-workflow.js"
import { latestReconstructedTaskGraph } from "../../../orchestrator/src/coordination/reconstruction/graph-knowledge.js"
import { reduceWorkflowJournalHistory } from "../../../orchestrator/src/coordination/reconstruction/history.js"
import { journaledWorkflowInterpreterLayer } from "../../../orchestrator/src/workflow-journal/journaled-interpreter.js"
import {
  journalStoreCapabilities,
  legacyUnpublishedInRunJournalLayer,
  type JournalRecord
} from "../../../orchestrator/src/workflow-journal/store.js"
import {
  attemptPlanRecordKey,
  intentRecordKey,
  outcomeRecordKey,
  plannedAttemptExecutorCommandIntendedRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey
} from "../../../orchestrator/src/workflow-journal/record-key.js"
import {
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  taskTrackerReadIntent
} from "../../../orchestrator/src/workflow/registry/event.js"
import {
  makeTaskAttemptPlanOperation,
  makeTaskClaimAcquisitionOperation,
  makeTaskClaimObservationOperation,
  makeTaskWorktreeReconciliationOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTrackerGraphObservationOperation
} from "../../../orchestrator/src/workflow/registry/operation.js"
import {
  makeFocusedTaskWorkSpecificationFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../../orchestrator/src/workflow/task-tracker-facts/observation.js"
import {
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorReportOrdinal,
  type PlannedAttemptExecutorStateObservation,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "../../../orchestrator/src/workflow/protocols/planned-attempt-executor-work/events.js"
import { continuePlannedAttemptExecutorWorkWithPermit } from "../../../orchestrator/src/workflow/protocols/planned-attempt-executor-work/suspension-commands.js"
import {
  queueAcceptedResultIntegrationResponsibility,
  startQueuedIntegration
} from "../../../orchestrator/src/workflow/protocols/integration-admission/protocol.js"
import {
  AuthoritativePlannedAttemptWorktreeObserved,
  AuthoritativeTargetLineageObserved,
  AuthoritativeTaskClaimObserved,
  TaskClaimObservationUnreadable,
  WorkflowInterpreter
} from "../../../orchestrator/src/workflow/interpretation/interpreter.js"
import { AuthoritativeTaskClaimReleased } from "../../../orchestrator/src/workflow/protocols/task-claim-release/protocol.js"
import { decideWorkflowRunBeginning } from "../../../orchestrator/src/workflow-journal/run-lifecycle.js"

const runId = RunId.make("task-fact-model-run")
const otherRunId = RunId.make("task-fact-model-other-run")
const taskId = TaskId.make("task-fact-model-A")
const independentTaskId = TaskId.make("task-fact-model-B")
const target = FixtureTarget.make("task-fact-model-target")
const integrationTarget = IntegrationTarget.make({
  repository: GitRepositoryLocator.make("/repositories/task-fact-model.git"),
  ref: IntegrationTargetRef.make("refs/heads/main")
})
const acceptedResult = AcceptedResult.make({
  commit: GitCommitSha.make("3".repeat(40)),
  evidenceManifest: EvidenceReference.make({ byteLength: 1, digest: EvidenceDigest.make("3".repeat(64)) })
})
const plannedSpecification = makeTaskWorkSpecification({ body: "F1", taskId, title: "F1" })
const specificationF2 = makeTaskWorkSpecification({ body: "F2", taskId, title: "F2" })
const specificationF3 = makeTaskWorkSpecification({ body: "F3", taskId, title: "F3" })
const independentSpecification = makeTaskWorkSpecification({ body: "B", taskId: independentTaskId, title: "B" })
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("task-fact-model-P"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/task-fact-model-P"),
  executor: TaskExecutorLocator.make("executor:task-fact-model"),
  runId,
  taskId,
  taskRevision: plannedSpecification.fingerprint,
  worktree: WorktreeLocator.make("/worktrees/task-fact-model-P")
})
const replacementTargetHead = GitCommitSha.make("4".repeat(40))
const successorAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("task-fact-model-P2"),
  baseSha: replacementTargetHead,
  branch: TaskBranchRef.make("refs/heads/dalph/task-fact-model-P2"),
  executor: plannedAttempt.executor,
  runId,
  taskId,
  taskRevision: specificationF2.fingerprint,
  worktree: WorktreeLocator.make("/worktrees/task-fact-model-P2")
})
const independentPlannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("task-fact-model-B-attempt"),
  baseSha: GitCommitSha.make("3".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/task-fact-model-B"),
  executor: TaskExecutorLocator.make("executor:task-fact-model-B"),
  runId,
  taskId: independentTaskId,
  taskRevision: independentSpecification.fingerprint,
  worktree: WorktreeLocator.make("/worktrees/task-fact-model-B")
})
const correlation = { attemptId: plannedAttempt.attemptId, runId }
const successorCorrelation = { attemptId: successorAttempt.attemptId, runId }
const claimOperation = makeTaskClaimAcquisitionOperation({
  acquisition: {
    operationId: OperationId.make("task-fact-model-claim"),
    owner: ClaimOwner.make("dalph"),
    taskId,
    token: ClaimToken.make("task-fact-model-token")
  },
  predecessorOperationIds: []
})
const exactClaim = ActiveTaskClaim.make(claimOperation.acquisition)
const foreignClaim = ActiveTaskClaim.make({
  operationId: OperationId.make("task-fact-model-foreign-claim"),
  owner: ClaimOwner.make("foreign"),
  taskId,
  token: ClaimToken.make("task-fact-model-foreign-token")
})
const planOperation = makeTaskAttemptPlanOperation({
  operationId: OperationId.make("task-fact-model-plan"),
  plannedAttempt,
  predecessorOperationIds: [exactClaim.operationId]
})
const continueD1 = AttemptChoiceRequestId.make({ nonce: "continue-D1", runId })
const stopD2 = AttemptChoiceRequestId.make({ nonce: "stop-D2", runId })
const continueD3 = AttemptChoiceRequestId.make({ nonce: "continue-D3", runId })
const restartD1 = AttemptChoiceRequestId.make({ nonce: "restart-D1", runId })
const subjectF2 = { observedTaskRevision: specificationF2.fingerprint, plannedAttempt }
const subjectF3 = { observedTaskRevision: specificationF3.fingerprint, plannedAttempt }

const graphProjection = projectTrackerSnapshot({
  revision: TrackerRevision.make("task-fact-model-graph"),
  tasks: [
    { id: taskId, lifecycle: TaskLifecycle.cases.Open.make({}), parentTaskId: null, prerequisiteIds: [] },
    { id: independentTaskId, lifecycle: TaskLifecycle.cases.Open.make({}), parentTaskId: null, prerequisiteIds: [] }
  ]
})
const graphSnapshot = Option.getOrThrow(
  graphProjection._tag === "Valid" ? Option.some(graphProjection.snapshot) : Option.none()
)
const independentOnlyGraphProjection = projectTrackerSnapshot({
  revision: TrackerRevision.make("task-fact-model-independent-only-graph"),
  tasks: [
    { id: independentTaskId, lifecycle: TaskLifecycle.cases.Open.make({}), parentTaskId: null, prerequisiteIds: [] }
  ]
})
const independentOnlyGraphSnapshot = Option.getOrThrow(
  independentOnlyGraphProjection._tag === "Valid" ? Option.some(independentOnlyGraphProjection.snapshot) : Option.none()
)

const Variant = Schema.Struct({ tag: Schema.String, value: Schema.Unknown })

type ExecutorObservationTag = PlannedAttemptExecutorStateObservation["_tag"]

const executorEvidenceProjection = (
  currentFailure: ExecutorObservationTag | undefined,
  report: PlannedAttemptExecutorReport | undefined,
  restartSelected: boolean
): string => {
  if (currentFailure === "ExecutorReportContradiction") return "ExecutorContradiction"
  if (currentFailure !== undefined && currentFailure !== "ExactExecutorReport") return "ExecutorUnavailable"
  if (report?._tag === "SafelySuspended") return "ExactSafelySuspended"
  if (report?._tag === "Running") return "ExactRunning"
  if (report?._tag !== "Terminal") return "ExecutorUnavailable"
  if (!restartSelected) return "ExactTerminal"
  if (report.result._tag === "Accepted") return "ExactAcceptedTerminal"
  return report.result._tag === "Completed" ? "ExactCompletedTerminal" : "ExactFailedTerminal"
}

it("projects every newer non-exact executor observation instead of stale exact evidence", () => {
  const staleRunning = PlannedAttemptExecutorReport.cases.Running.make({
    correlation: { attemptId: plannedAttempt.attemptId, runId }
  })
  expect(executorEvidenceProjection("ExecutorReportContradiction", staleRunning, false)).toBe("ExecutorContradiction")
  for (const outcome of [
    "ExecutorStateNoCurrentReport",
    "ExecutorStateTemporarilyUnavailable",
    "ExecutorStateUnreadable"
  ] as const) {
    expect(executorEvidenceProjection(outcome, staleRunning, false)).toBe("ExecutorUnavailable")
  }
})

const RequestIdProjection = Schema.Struct({ nonce: ITFBigInt, runId: ITFBigInt })
const SpecProjection = Schema.Struct({
  state: Schema.Struct({
    appliedChoiceCount: ITFBigInt,
    authorizedFingerprint: Variant,
    claimObservation: Variant,
    claimReleaseAuthorizedByExactRead: Schema.Boolean,
    claimReleaseCallCount: ITFBigInt,
    claimReleaseCallCountAtNonExactObservation: ITFBigInt,
    claimRecoveryCount: ITFBigInt,
    claimReleaseIntentRecorded: Schema.Boolean,
    claimReleaseResponseAmbiguous: Schema.Boolean,
    claimResult: Variant,
    cleanupSelected: Schema.Boolean,
    continueStage: Variant,
    currentFingerprint: Variant,
    evidencePreserved: Schema.Boolean,
    executorEvidence: Variant,
    f2WinningChoice: Variant,
    f3WinningChoice: Variant,
    freshClaimExact: Schema.Boolean,
    freshExecutorExact: Schema.Boolean,
    freshGraphExact: Schema.Boolean,
    freshLineageExact: Schema.Boolean,
    freshSpecificationExact: Schema.Boolean,
    freshWorktreeExact: Schema.Boolean,
    implementationResponsibilityRetained: Schema.Boolean,
    independentTaskEligible: Schema.Boolean,
    independentTaskSelected: Schema.Boolean,
    integrationSelected: Schema.Boolean,
    lastControlResult: Variant,
    lastSettledStopCommandOrdinal: ITFBigInt,
    logsPreserved: Schema.Boolean,
    positionHeld: Schema.Boolean,
    quiescenceUnbroken: Schema.Boolean,
    resumedAttempt: Variant,
    sessionHistoryPreserved: Schema.Boolean,
    stopCommandCallCount: ITFBigInt,
    stopCommandIntentCount: ITFBigInt,
    stopCommandSettlementCount: ITFBigInt,
    stopProjectionsThisActivation: ITFBigInt,
    stopRecoveryCount: ITFBigInt,
    stopResponseAmbiguous: Schema.Boolean,
    stopStage: Variant,
    suspensionCommandCountSinceSafeEvidence: ITFBigInt,
    unresolvedClaimReleaseResponsibility: Schema.Boolean,
    winningRequestId: RequestIdProjection,
    wipPreserved: Schema.Boolean,
    worktreePreserved: Schema.Boolean,
    replacementPhase: Variant,
    replacementDisposition: Variant,
    replacementTaskFacts: Variant,
    replacementClaimFacts: Variant,
    replacementClaimReadsThisActivation: ITFBigInt,
    oldWorktreeFacts: Variant,
    replacementTargetHeadFacts: Variant,
    observedOldWorktreeHead: Variant,
    oldBaseB1IsAncestor: Schema.Boolean,
    observedReplacementTargetHead: Variant,
    p1Unsettled: Schema.Boolean,
    p1Superseded: Schema.Boolean,
    plannedSuccessor: Variant,
    replacementEventRecorded: Schema.Boolean,
    replacementEventCount: ITFBigInt,
    successorAllocationCount: ITFBigInt,
    successorBaseHead: Variant,
    successorBranchIdentity: Variant,
    successorWorktreeIdentity: Variant,
    successorCarriesP1Content: Schema.Boolean,
    successorWorktreeReady: Schema.Boolean,
    successorAdmissionCount: ITFBigInt,
    successorPositionHeld: Schema.Boolean,
    successorExecutorStartCount: ITFBigInt,
    successorExecutorResponsibilityRetained: Schema.Boolean,
    replacementProcessLossCount: ITFBigInt,
    completedResultPreserved: Schema.Boolean,
    failedResultPreserved: Schema.Boolean,
    lateAcceptedCommitPreserved: Schema.Boolean,
    lateAcceptedEvidencePreserved: Schema.Boolean,
    lateAcceptedIntegrationResponsibilityCount: ITFBigInt,
    p1BranchPreserved: Schema.Boolean,
    p1CommitsPreserved: Schema.Boolean,
    p1JournalEvidencePreserved: Schema.Boolean,
    replacementCleanupCallCount: ITFBigInt,
    replacementClaimMutationCallCount: ITFBigInt
  })
})

const tag = (variant: { readonly tag: string }): string => variant.tag
const fingerprintTag = (fingerprint: string): string =>
  fingerprint === specificationF2.fingerprint ? "F2" : fingerprint === specificationF3.fingerprint ? "F3" : "F1"
const requestProjection = (request: typeof continueD1) => ({
  nonce:
    request.nonce === stopD2.nonce
      ? 2n
      : request.nonce === continueD3.nonce
        ? 3n
        : request.nonce === restartD1.nonce
          ? 4n
          : 1n,
  runId: 65n
})
const isIndependentTaskProgress = (candidate: { readonly _tag: string; readonly taskId?: TaskId }): boolean =>
  candidate.taskId === independentTaskId &&
  (candidate._tag === "CheckTaskClaim" || candidate._tag === "CommitFreshTaskClaimIntent")
const isGraphRefreshProgress = (candidate: { readonly _tag: string; readonly taskId?: TaskId }): boolean =>
  candidate.taskId === independentTaskId && candidate._tag === "ContinueFreshWorkflowOperation"

const continuationProposal = {
  ...trackerGraphReadProposalOf({
    acceptedAt: JournalPosition.make(1),
    purpose: "EstablishCurrentGraph",
    runId,
    target
  }),
  admission: {
    integrationTarget: { _tag: "NoIntegrationTargetResource" as const },
    plannedAttemptProtocol: { _tag: "NoPlannedAttemptProtocol" as const },
    taskWorkPosition: { _tag: "TaskWorkPositionRequired" as const, mode: "ReserveOrReuse" as const, taskId }
  },
  id: DeliveryProposalId.make("task-fact-model-continuation")
}

const taskFactReconciliationDriver = defineDriver(
  {
    abandonImplementation: {},
    admitSuccessorThroughOrdinaryCapacity: {},
    admitSameAttemptP: {},
    applyContinueF2: {},
    applyContinueF3: {},
    applyRestartF2: {},
    applyStopF2: {},
    beginReplacementFactsFromRetainedSafeSuspension: {},
    beginIntegration: {},
    callStoppage: {},
    init: {},
    loseClaimReleaseResponse: {},
    loseStoppageResponse: {},
    observeF2Change: {},
    observeAbsentClaim: {},
    observeExactClaim: {},
    observeExactTerminal: {},
    observeF3BeforeContinuation: {},
    observeReplacementClaimAbsent: {},
    observeReplacementClaimForeign: {},
    observeReplacementClaimUnreadableBounded: {},
    observeReplacementExactF2TaskFacts: {},
    observeReplacementExactH2: {},
    observeReplacementExactK1: {},
    observeReplacementExactW1Ready: {},
    observeReplacementF3TaskFacts: {},
    observeReplacementH2Unreadable: {},
    observeReplacementTaskFactsUnreadable: {},
    observeReplacementTaskNotEligible: {},
    observeReplacementW1NotReady: {},
    observeReplacementW1Unreadable: {},
    observeRestartAccepted: {},
    observeRestartCompleted: {},
    observeRestartExecutorContradiction: {},
    observeRestartExecutorUnavailable: {},
    observeRestartFailed: {},
    observeRestartRunning: {},
    observeRestartSafelySuspended: {},
    observeForeignClaim: {},
    observeUnreadableClaim: {},
    projectClaimReleased: {},
    projectClaimStillExact: {},
    projectExactRunningForStoppage: {},
    projectExactSafeForStoppage: {},
    projectExactTerminalForStoppage: {},
    projectReadOnlyExactSafeAfterStoppageLimit: {},
    prepareCleanSuccessorW2: {},
    readFreshExactClaim: {},
    readFreshExactExecutor: {},
    readFreshExactGraph: {},
    readFreshExactLineage: {},
    readFreshExactSpecification: {},
    readFreshExactWorktree: {},
    recordClaimReleaseIntent: {},
    recordStoppageIntent: {},
    recoverClaimActivation: {},
    recoverReplacementAppendAbsent: {},
    recoverReplacementAppendPresent: {},
    recoverStopActivation: {},
    redeliverExactF2Choice: {},
    rejectContinuePastIntegrationCutoff: {},
    rejectLosingF2Choice: {},
    rejectPersistedRequestContentReuse: {},
    rejectRunMismatchedRequest: {},
    rejectRestartPastIntegrationCutoff: {},
    rejectStopPastIntegrationCutoff: {},
    releaseExactClaim: {},
    requireStoppageReconciliation: {},
    recordPlannedAttemptReplacement: {},
    breakRestartSafeSuspension: {},
    selectIndependentTaskB: {},
    startSuccessorExecutor: {}
  },
  () => {
    let records: ReadonlyArray<JournalRecord> = []
    let activeRecovery: Effect.Success<ReturnType<typeof makeRunRecoveryProjection>> | undefined
    let currentSpecification = plannedSpecification
    let currentClaim: "Exact" | "Absent" | "Foreign" | "Unreadable" = "Exact"
    let currentOldWorktree: "Ready" | "NotReady" | "Unreadable" = "Ready"
    let replacementTaskFactsReadable = true
    let replacementTaskEligible = true
    let replacementTargetHeadReadable = true
    let executorAuthority: PlannedAttemptExecutorReport | undefined =
      PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation })
    let nextStartOrContinueReport: PlannedAttemptExecutorReport = PlannedAttemptExecutorReport.cases.Running.make({
      correlation
    })
    let activeRequestId = continueD1
    let activeSubject = subjectF2
    let activeChoice: "ContinueExistingAttempt" | "RestartTaskImplementation" | "StopTaskImplementation" =
      "ContinueExistingAttempt"
    let lastControlResult = "NoControlResult"
    let replacementPhase = "ReplacementNotRequested"
    let replacementDisposition = "NoReplacementDisposition"
    let replacementTaskFacts = "ReplacementTaskFactsNotRead"
    let replacementClaimFacts = "ReplacementClaimNotRead"
    let replacementClaimReadsThisActivation = 0
    let oldWorktreeFacts = "OldWorktreeNotRead"
    let replacementTargetHeadFacts = "ReplacementTargetHeadNotRead"
    let observedOldWorktreeHead = "NoGitCommit"
    let oldBaseB1IsAncestor = false
    let observedReplacementTargetHead = "NoGitCommit"
    let replacementProcessLossCount = 0
    let successorAdmissionCount = 0
    let successorAdmissionReservation: DeliveryAdmissionReservation | undefined
    let restartSuspensionReport: PlannedAttemptExecutorReport = PlannedAttemptExecutorReport.cases.Running.make({
      correlation
    })
    let restartSuspensionBoundary = false
    let controller: DeliveryRuntimeAdmissionController | undefined
    let suspensionCallCount = 0
    let stopProjectionBaseline = 0
    let stopRecoveryCount = 0
    let releaseCallCount = 0
    // Captures the real release-boundary count when the latest authoritative
    // claim observation becomes non-exact. It is chronology input, not a
    // mirrored decision: any later production boundary call changes the
    // compared count while this baseline remains fixed.
    let releaseCallCountAtNonExactObservation = 0
    let protocolController: PlannedAttemptProtocolControllerService | undefined
    let claimRecoveryCount = 0
    // Recovery starts a new activation. The journal remains authoritative;
    // this baseline only classifies whether that activation has performed its
    // required stopped-claim observation yet.
    let claimObservationBaseline = 0
    let commandIntentSignal = Deferred.makeUnsafe<void>()
    let commandIntentGate = Deferred.makeUnsafe<void>()
    let commandCallSignal = Deferred.makeUnsafe<void>()
    let commandResponse = Deferred.makeUnsafe<PlannedAttemptExecutorReport>()
    let pauseCommandIntent = false
    let pendingCommand: Fiber.Fiber<PlannedAttemptExecutorReport, unknown> | undefined
    let releaseIntentSignal = Deferred.makeUnsafe<void>()
    let releaseIntentGate = Deferred.makeUnsafe<void>()
    let releaseCallSignal = Deferred.makeUnsafe<void>()
    let releaseResponse = Deferred.makeUnsafe<"Failure" | "Success">()
    let pauseReleaseIntent = false
    let pendingRelease: Fiber.Fiber<unknown, unknown> | undefined
    let pendingReleaseCallBaseline = 0

    const journal = JournalStore.of({
      append: (eventRunId, key, event) =>
        Effect.gen(function* () {
          const existing = records.find((record) => record.runId === eventRunId && record.key === key)
          if (existing !== undefined) return existing
          const record = {
            event,
            key,
            position: JournalPosition.make(records.filter(({ runId: recorded }) => recorded === eventRunId).length + 1),
            runId: eventRunId
          } satisfies JournalRecord
          records = [...records, record]
          if (pauseCommandIntent && event._tag === "PlannedAttemptExecutorCommandIntended") {
            pauseCommandIntent = false
            yield* Deferred.succeed(commandIntentSignal, undefined)
            yield* Deferred.await(commandIntentGate)
          }
          if (pauseReleaseIntent && event._tag === "TaskClaimReleaseIntended") {
            pauseReleaseIntent = false
            yield* Deferred.succeed(releaseIntentSignal, undefined)
            yield* Deferred.await(releaseIntentGate)
          }
          return record
        }),
      beginRun: (eventRunId, eventTarget, policy) =>
        Effect.sync(() => {
          const decision = decideWorkflowRunBeginning(records, eventRunId, eventTarget, policy)
          if (decision._tag !== "LifecycleTransitionAccepted") throw new Error("model Run must begin")
          records = [decision.record]
          return decision.record
        }),
      read: (eventRunId) => Effect.succeed(records.filter(({ runId: recorded }) => recorded === eventRunId)),
      readRunForRecovery: () => Effect.die("model driver uses one already-begun Run"),
      scan: () => Effect.succeed({ issues: [], runs: [{ records, runId }] }),
      terminateRun: () => Effect.die("model driver never terminates its Run")
    })
    const journalLayer = legacyUnpublishedInRunJournalLayer.pipe(
      Layer.provideMerge(journalStoreCapabilities(Layer.succeed(JournalStore, journal)))
    )
    const acceptanceEvidenceLayer = Layer.succeed(
      EvidenceStore,
      EvidenceStore.of({
        put: (bytes) =>
          Effect.succeed(
            EvidenceReference.make({ byteLength: bytes.byteLength, digest: EvidenceDigest.make("a".repeat(64)) })
          ),
        read: () =>
          Effect.succeed(
            new TextEncoder().encode(
              JSON.stringify(
                AcceptedResultEvidenceManifest.make({
                  commit: acceptedResult.commit,
                  correlation: { attemptId: plannedAttempt.attemptId, runId },
                  formatVersion: 1,
                  outcome: "Accepted",
                  predecessor: null
                })
              )
            )
          )
      })
    )
    const executor = PlannedAttemptExecutor.of({
      project: () =>
        Effect.succeed(
          executorAuthority === undefined
            ? PlannedAttemptExecutorProjection.cases.NoReport.make({
                correlation: { attemptId: plannedAttempt.attemptId, runId }
              })
            : executorAuthority.correlation.attemptId !== plannedAttempt.attemptId ||
                executorAuthority.correlation.runId !== runId
              ? PlannedAttemptExecutorProjection.cases.CorrelationContradiction.make({
                  expected: { attemptId: plannedAttempt.attemptId, runId },
                  observed: executorAuthority
                })
              : PlannedAttemptExecutorProjection.cases.Exact.make({ report: executorAuthority })
        ),
      requestSuspension: () =>
        restartSuspensionBoundary
          ? Effect.sync(() => {
              suspensionCallCount += 1
              executorAuthority = restartSuspensionReport
              return restartSuspensionReport
            })
          : Effect.gen(function* () {
              suspensionCallCount += 1
              yield* Deferred.succeed(commandCallSignal, undefined)
              return yield* Deferred.await(commandResponse)
            }),
      startOrContinue: (attempt) =>
        Effect.sync(() => {
          if (plannedTaskAttemptEquivalence(attempt, successorAttempt)) {
            return PlannedAttemptExecutorReport.cases.Running.make({ correlation: successorCorrelation })
          }
          const report = nextStartOrContinueReport
          nextStartOrContinueReport = PlannedAttemptExecutorReport.cases.Running.make({ correlation })
          executorAuthority = report
          return report
        })
    })
    const baseInterpreter = WorkflowInterpreter.of({
      acquireTaskClaim: () => Effect.die("claim acquisition is outside this adapter"),
      readTrackerGraph: () =>
        replacementTaskFactsReadable
          ? Effect.succeed(replacementTaskEligible ? graphSnapshot : independentOnlyGraphSnapshot)
          : Effect.fail(new FixtureReadError({ detail: "replacement task facts unreadable", target })),
      readTaskClaim: () =>
        currentClaim === "Unreadable"
          ? Effect.succeed(TaskClaimObservationUnreadable.make({ attempts: 3, taskId }))
          : Effect.succeed(
              AuthoritativeTaskClaimObserved.make({
                observation:
                  currentClaim === "Exact"
                    ? exactClaim
                    : currentClaim === "Foreign"
                      ? foreignClaim
                      : { _tag: "UnclaimedTask" as const, taskId }
              })
            ),
      readTaskWorktree: () =>
        currentOldWorktree === "Unreadable"
          ? Effect.fail(
              new GitWorktreeReadFailure({ detail: "replacement W1 unreadable", worktree: plannedAttempt.worktree })
            )
          : Effect.succeed(
              AuthoritativePlannedAttemptWorktreeObserved.make({
                observation:
                  currentOldWorktree === "Ready"
                    ? PlannedWorktreeReady.make({
                        baseSha: plannedAttempt.baseSha,
                        branch: plannedAttempt.branch,
                        headSha: GitCommitSha.make("2".repeat(40)),
                        worktree: plannedAttempt.worktree
                      })
                    : AttemptWorktreeLost.make({ plannedAttempt })
              })
            ),
      readTargetLineage: () =>
        replacementTargetHeadReadable
          ? Effect.succeed(
              AuthoritativeTargetLineageObserved.make({
                observation: TargetLineageObservation.make({
                  plannedBaseIsAncestorOfTargetHead: true,
                  plannedBaseSha: plannedAttempt.baseSha,
                  targetHeadSha: replacementTargetHead
                })
              })
            )
          : Effect.fail(
              new GitTargetLineageReadFailure({
                detail: "replacement H2 unreadable",
                plannedBaseSha: plannedAttempt.baseSha,
                target: integrationTarget
              })
            ),
      releaseTaskClaim: (operation) =>
        Effect.gen(function* () {
          releaseCallCount += 1
          yield* Deferred.succeed(releaseCallSignal, undefined)
          const response = yield* Deferred.await(releaseResponse)
          if (response === "Failure") {
            return yield* new TaskClaimReleaseFailure({ detail: "model response lost", release: operation.release })
          }
          currentClaim = "Absent"
          return AuthoritativeTaskClaimReleased.make({ release: operation.release })
        }),
      readTaskWorkSpecification: (operation) =>
        Effect.succeed(operation.taskId === independentTaskId ? independentSpecification : currentSpecification),
      reconcileTaskWorktree: (operation) =>
        plannedTaskAttemptEquivalence(operation.plannedAttempt, successorAttempt)
          ? Effect.succeed(
              AuthoritativeTaskWorktreeReady.make({
                proof: PlannedWorktreeReady.make({
                  baseSha: successorAttempt.baseSha,
                  branch: successorAttempt.branch,
                  headSha: successorAttempt.baseSha,
                  worktree: successorAttempt.worktree
                })
              })
            )
          : Effect.die("model worktree reconciliation must prepare exact P2"),
      recordTaskAttemptPlan: (operation) =>
        Effect.succeed(TaskAttemptPlanRecordAcknowledged.make({ plannedAttempt: operation.plannedAttempt }))
    })
    const interpreterLayer = journaledWorkflowInterpreterLayer(
      runId,
      Layer.succeed(WorkflowInterpreter, baseInterpreter)
    )
    const provideJournal = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      protocolController === undefined
        ? Effect.die("planned-attempt protocol controller not initialized")
        : effect.pipe(
            Effect.provide(journalLayer),
            Effect.provide(acceptanceEvidenceLayer),
            Effect.provideService(PlannedAttemptProtocolController, protocolController),
            Effect.provideService(PlannedAttemptExecutor, executor)
          )
    const provideControl = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      provideJournal(effect.pipe(Effect.provide(attemptChoiceControlLayer)))
    const provideInterpreter = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      provideJournal(effect.pipe(Effect.provide(interpreterLayer)))
    const replacementPlanner = PlannedTaskAttemptPlanner.of({
      plan: (planningRequest) =>
        planningRequest._tag === "Fresh"
          ? Effect.die("Restart MBT must request one exact replacement plan")
          : Effect.succeed(
              PlannedTaskAttempt.make({
                ...successorAttempt,
                baseSha: planningRequest.baseSha,
                taskRevision: planningRequest.specification.fingerprint
              })
            )
    })
    const replacementOperationIds = OperationIdAllocator.of({
      allocate: () => Effect.succeed(OperationId.make("task-fact-model-plan-P2"))
    })
    const advanceRestart = () =>
      provideJournal(
        advanceAttemptRestart(restartD1, subjectF2, integrationTarget).pipe(
          Effect.provide(interpreterLayer),
          Effect.provideService(PlannedTaskAttemptPlanner, replacementPlanner),
          Effect.provideService(OperationIdAllocator, replacementOperationIds)
        )
      )
    const recovery = () =>
      activeRecovery === undefined
        ? provideJournal(makeRunRecoveryProjection(runId, integrationTarget)).pipe(
            Effect.tap((created) =>
              Effect.sync(() => {
                activeRecovery = created
              })
            )
          )
        : Effect.succeed(activeRecovery)
    const projection = () => Effect.flatMap(recovery(), ({ readDeliveryProjection }) => readDeliveryProjection)
    const reactivate = () =>
      Effect.sync(() => {
        activeRecovery = undefined
      }).pipe(Effect.andThen(projection()))
    const fullProjection = () =>
      provideJournal(makeRunRecoveryProjection(runId, integrationTarget)).pipe(
        Effect.flatMap(({ readDeliveryProjection }) => readDeliveryProjection)
      )
    // Mirrors reactive-delivery-relations: fresh decisions from the coherent
    // journal frame are combined with the authoritative recovered frontier.
    const freshDecisions = () =>
      Effect.gen(function* () {
        const reduction = reduceWorkflowJournalHistory(runId, records)
        if (reduction._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(reduction)
        const runState = reduction.runState
        const currentGraph = Option.getOrUndefined(latestReconstructedTaskGraph(runState.graphKnowledge))
        const currentGraphOperationId = runState.graphKnowledge.taskTrackerFacts.findLast(
          (observation) =>
            observation._tag === "CompleteTaskTrackerFacts" ||
            observation._tag === "UnchangedTaskTrackerFactsReconfirmed"
        )?.operationId
        const acceptedAt = runState.appliedThrough
        const runControlPolicy = Option.getOrUndefined(runState.controlPolicy)
        if (
          currentGraph === undefined ||
          currentGraphOperationId === undefined ||
          acceptedAt === null ||
          runControlPolicy === undefined
        ) {
          return yield* Effect.die("current delivery frame must be reconstructable")
        }
        return deriveFreshWorkflowDecisions({
          acceptedAt,
          currentGraph,
          currentGraphOperationId,
          pause: runState.pause,
          responsibility: runState.responsibility,
          runControlPolicy,
          workflowHistory: runState.workflowHistory
        })
      })
    const requireController = () =>
      controller === undefined ? Effect.die("admission controller not initialized") : Effect.succeed(controller)
    const reservePosition = Effect.fn("TaskFactModel.reservePosition")(function* () {
      const admission = yield* requireController()
      const snapshot = yield* admission.snapshot
      if (!snapshot.positions.has(taskId)) {
        const decision = yield* admission.tryReserve(continuationProposal)
        if (decision._tag === "Deferred") return yield* Effect.die("task position must be available")
        yield* admission.bindPlannedAttemptPosition(taskId, correlation)
      }
    })
    const reserveSuccessorPosition = Effect.fn("TaskFactModel.reserveSuccessorPosition")(function* () {
      const admission = yield* requireController()
      const successorProposal = {
        ...continuationProposal,
        admission: {
          integrationTarget: { _tag: "NoIntegrationTargetResource" as const },
          plannedAttemptProtocol: {
            _tag: "PlannedAttemptProtocolRequired" as const,
            correlation: successorCorrelation
          },
          taskWorkPosition: { _tag: "TaskWorkPositionRequired" as const, mode: "ReserveOrReuse" as const, taskId }
        },
        id: DeliveryProposalId.make("task-fact-model-successor-admission")
      }
      const decision = yield* admission.tryReserve(successorProposal)
      if (decision._tag === "Deferred") return yield* Effect.die(`successor admission deferred: ${decision.reason}`)
      if (decision.reservation._tag !== "PlannedAttemptProtocolAdmission") {
        return yield* Effect.die("successor admission omitted its exact-attempt protocol permit")
      }
      successorAdmissionReservation = decision.reservation
      successorAdmissionCount += 1
    })
    const releasePosition = Effect.fn("TaskFactModel.releasePosition")(function* () {
      const admission = yield* requireController()
      const snapshot = yield* admission.snapshot
      if (snapshot.positions.has(taskId)) yield* admission.releasePlannedAttemptPosition(correlation)
    })
    const applyChoice = (
      choice: "ContinueExistingAttempt" | "RestartTaskImplementation" | "StopTaskImplementation",
      requestId: typeof continueD1,
      subject: typeof subjectF2
    ) =>
      provideControl(
        Effect.gen(function* () {
          const control = yield* AttemptChoiceControl
          const before = records.filter(({ event }) => event._tag === "AttemptChoiceApplied").length
          const result = yield* control.apply({ choice, requestId, subject })
          const after = records.filter(({ event }) => event._tag === "AttemptChoiceApplied").length
          lastControlResult = after === before ? "ExactRedelivery" : "ChoiceApplied"
          activeChoice = choice
          return result
        })
      )
    const expectChoiceFailure = <A, E extends { readonly _tag: string }, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(
        Effect.flip,
        Effect.tap((failure) =>
          Effect.sync(() => {
            lastControlResult =
              failure._tag === "AttemptChoiceRequestRunMismatch"
                ? "RequestRunBindingMismatch"
                : failure._tag === "AttemptChoiceRequestIdentityContradiction"
                  ? "PersistedRequestContentContradiction"
                  : failure._tag === "AttemptChoiceAlreadyApplied"
                    ? "ChoiceAlreadyApplied"
                    : "ChoiceOutsidePreIntegration"
          })
        ),
        Effect.asVoid
      )
    const transition = (transitionTag: string) =>
      Effect.gen(function* () {
        const current = yield* projection()
        const found = current.frontier.transitions.find(({ _tag }) => _tag === transitionTag)
        if (found === undefined) return yield* Effect.die(`missing production transition ${transitionTag}`)
        return found
      })
    type Transition = Effect.Success<ReturnType<typeof transition>>
    const readThroughTransitionTags = [
      "ObservePlannedAttemptContinuationGraph",
      "ObservePlannedAttemptContinuationSpecification",
      "ObservePlannedAttemptContinuationClaim",
      "ObserveStoppedAttemptClaim",
      "ObservePlannedAttemptContinuationWorktree",
      "ObservePlannedAttemptContinuationTargetLineage"
    ] as const satisfies ReadonlyArray<Transition["_tag"]>
    type ReadThroughTransitionTag = (typeof readThroughTransitionTags)[number]
    type ReadThroughTransition = Extract<Transition, { readonly _tag: ReadThroughTransitionTag }>
    const isReadThroughTransition = (selected: Transition): selected is ReadThroughTransition =>
      readThroughTransitionTags.some((tag) => tag === selected._tag)
    const readThrough = (transitionTag: string) =>
      Effect.gen(function* () {
        const selected = yield* transition(transitionTag)
        if (!isReadThroughTransition(selected)) {
          return yield* Effect.die(`unsupported observation ${selected._tag}`)
        }
        yield* provideInterpreter(
          Effect.gen(function* () {
            const interpreter = yield* WorkflowInterpreter
            yield* Match.valueTags(selected, {
              ObservePlannedAttemptContinuationGraph: (value) => interpreter.readTrackerGraph(value.operation),
              ObservePlannedAttemptContinuationSpecification: (value) =>
                interpreter.readTaskWorkSpecification(value.operation),
              ObservePlannedAttemptContinuationClaim: (value) => interpreter.readTaskClaim(value.operation),
              ObserveStoppedAttemptClaim: (value) => interpreter.readTaskClaim(value.operation),
              ObservePlannedAttemptContinuationWorktree: (value) => interpreter.readTaskWorktree(value.operation),
              ObservePlannedAttemptContinuationTargetLineage: (value) => interpreter.readTargetLineage(value.operation)
            })
          })
        )
      })
    const resetCommandBoundary = () => {
      commandIntentSignal = Deferred.makeUnsafe<void>()
      commandIntentGate = Deferred.makeUnsafe<void>()
      commandCallSignal = Deferred.makeUnsafe<void>()
      commandResponse = Deferred.makeUnsafe<PlannedAttemptExecutorReport>()
      pauseCommandIntent = true
    }
    const resetReleaseBoundary = () => {
      releaseIntentSignal = Deferred.makeUnsafe<void>()
      releaseIntentGate = Deferred.makeUnsafe<void>()
      releaseCallSignal = Deferred.makeUnsafe<void>()
      releaseResponse = Deferred.makeUnsafe<"Failure" | "Success">()
      pauseReleaseIntent = true
    }
    const startRecoveredReleaseRetry = () =>
      Effect.gen(function* () {
        releaseCallSignal = Deferred.makeUnsafe<void>()
        releaseResponse = Deferred.makeUnsafe<"Failure" | "Success">()
        pauseReleaseIntent = false
        pendingReleaseCallBaseline = releaseCallCount
        const selected = yield* transition("ReleaseStoppedAttemptClaim")
        if (selected._tag !== "ReleaseStoppedAttemptClaim") return yield* Effect.die("wrong release transition")
        pendingRelease = yield* provideInterpreter(
          Effect.gen(function* () {
            yield* (yield* WorkflowInterpreter).releaseTaskClaim(selected.operation)
          })
        ).pipe(Effect.forkDetach({ startImmediately: true }))
      })
    const crossReleaseBoundary = () =>
      pendingRelease === undefined || pendingRelease.pollUnsafe() !== undefined
        ? startRecoveredReleaseRetry()
        : Deferred.succeed(releaseIntentGate, undefined)
    const latestChoice = () =>
      records.findLast(({ event }) => event._tag === "AttemptChoiceApplied") as
        | (JournalRecord & {
            readonly event: Extract<JournalRecord["event"], { readonly _tag: "AttemptChoiceApplied" }>
          })
        | undefined
    const latestEvidenceRecord = () =>
      records.findLast(({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkReported"
          ? event.report.correlation.attemptId === correlation.attemptId &&
            event.report.correlation.runId === correlation.runId
          : (event._tag === "PlannedAttemptExecutorCommandProjectionObserved" ||
              event._tag === "PlannedAttemptExecutorStateObserved") &&
            event.observation._tag === "ExactExecutorReport" &&
            plannedTaskAttemptEquivalence(event.plannedAttempt, plannedAttempt)
      )
    const latestEvidence = () => latestEvidenceRecord()?.event
    const evidenceReport = () => {
      const evidence = latestEvidence()
      if (evidence?._tag === "PlannedAttemptExecutorWorkReported") return evidence.report
      if (
        evidence?._tag === "PlannedAttemptExecutorCommandProjectionObserved" ||
        evidence?._tag === "PlannedAttemptExecutorStateObserved"
      ) {
        return evidence.observation._tag === "ExactExecutorReport" ? evidence.observation.report : undefined
      }
      return undefined
    }
    const executorProjectionCount = () =>
      records.filter(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorCommandProjectionObserved" ||
          event._tag === "PlannedAttemptExecutorStateObserved"
      ).length
    const postChoiceRecords = () => {
      const choice = latestChoice()
      return choice === undefined ? [] : records.filter(({ position }) => position > choice.position)
    }
    const freshFacts = () => {
      const choice = latestChoice()
      if (choice?.event.choice !== "ContinueExistingAttempt") {
        return { claim: false, executor: false, graph: false, lineage: false, specification: false, worktree: false }
      }
      const afterChoice = postChoiceRecords()
      const changedSpecification = afterChoice.findLast(
        ({ event }) =>
          event._tag === "TaskTrackerFactsObserved" &&
          event.observation._tag === "FocusedTaskWorkSpecificationFacts" &&
          event.observation.factFamily.fingerprint !== choice.event.subject.observedTaskRevision
      )
      // A newly observed fingerprint invalidates every earlier continuation
      // read. The mismatch observation itself requests a new choice; freshness
      // for that revision begins strictly after the later choice is journaled.
      const later =
        changedSpecification === undefined
          ? afterChoice
          : records.filter(({ position }) => position > changedSpecification.position)
      return {
        claim: later.some(
          ({ event }) => event._tag === "TaskTrackerFactsObserved" && event.observation._tag === "FocusedTaskClaimFacts"
        ),
        executor: later.some(
          ({ event }) =>
            event._tag === "PlannedAttemptExecutorStateObserved" &&
            event.observation._tag === "ExactExecutorReport" &&
            event.observation.report._tag === "SafelySuspended"
        ),
        graph: later.some(
          ({ event }) =>
            event._tag === "TaskTrackerFactsObserved" &&
            (event.observation._tag === "CompleteTaskTrackerFacts" ||
              event.observation._tag === "UnchangedTaskTrackerFactsReconfirmed")
        ),
        lineage: later.some(({ event }) => event._tag === "TargetLineageObserved"),
        specification: later.some(
          ({ event }) =>
            event._tag === "TaskTrackerFactsObserved" && event.observation._tag === "FocusedTaskWorkSpecificationFacts"
        ),
        worktree: later.some(({ event }) => event._tag === "PlannedAttemptWorktreeObserved")
      }
    }
    const continueStage = () => {
      const choice = latestChoice()?.event
      if (
        choice?.choice === "RestartTaskImplementation" &&
        replacementPhase === "ReplacementRejected" &&
        replacementDisposition === "NewFingerprintChoiceRequired"
      )
        return "NewChoiceRequired"
      if (choice?.choice !== "ContinueExistingAttempt") return "NotContinuing"
      const later = postChoiceRecords()
      if (
        later.some(
          ({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended" && event.command === "StartOrContinue"
        )
      )
        return "ContinueResumed"
      const latestSpecification = later.findLast(
        ({ event }) =>
          event._tag === "TaskTrackerFactsObserved" && event.observation._tag === "FocusedTaskWorkSpecificationFacts"
      )?.event
      if (
        latestSpecification?._tag === "TaskTrackerFactsObserved" &&
        latestSpecification.observation._tag === "FocusedTaskWorkSpecificationFacts" &&
        latestSpecification.observation.factFamily.fingerprint !== choice.subject.observedTaskRevision
      )
        return "NewChoiceRequired"
      const fresh = freshFacts()
      return !fresh.graph
        ? "NeedFreshGraph"
        : !fresh.specification
          ? "NeedFreshSpecification"
          : !fresh.claim
            ? "NeedFreshClaim"
            : !fresh.worktree
              ? "NeedFreshWorktree"
              : !fresh.lineage
                ? "NeedFreshLineage"
                : !fresh.executor
                  ? "NeedFreshExecutor"
                  : "ReadyToResume"
    }
    const claimObservation = () => {
      const abandonment = records.findLast(({ event }) => event._tag === "AttemptImplementationAbandoned")
      const observed = records.findLast(
        ({ event, position }) =>
          abandonment !== undefined &&
          position > abandonment.position &&
          event._tag === "TaskTrackerFactsObserved" &&
          (event.observation._tag === "FocusedTaskClaimFacts" ||
            event.observation._tag === "FocusedTaskClaimFactsUnreadable")
      )
      const released = records.findLast(
        ({ event, position }) =>
          abandonment !== undefined && position > abandonment.position && event._tag === "TaskClaimReleased"
      )
      if (released !== undefined && (observed === undefined || released.position > observed.position))
        return "ClaimAbsent"
      const observedEvent = observed?.event
      if (observedEvent?._tag !== "TaskTrackerFactsObserved") return "ClaimNotRead"
      if (observedEvent.observation._tag === "FocusedTaskClaimFactsUnreadable") return "ClaimUnreadable"
      if (observedEvent.observation._tag !== "FocusedTaskClaimFacts") return "ClaimNotRead"
      const observation = observedEvent.observation.observation
      return observation._tag === "UnclaimedTask"
        ? "ClaimAbsent"
        : observation.owner === exactClaim.owner && observation.token === exactClaim.token
          ? "ClaimExact"
          : "ClaimForeign"
    }
    const stoppedClaimObservationCount = () => {
      const abandonment = records.findLast(({ event }) => event._tag === "AttemptImplementationAbandoned")
      return records.filter(
        ({ event, position }) =>
          abandonment !== undefined &&
          position > abandonment.position &&
          event._tag === "TaskTrackerFactsObserved" &&
          (event.observation._tag === "FocusedTaskClaimFacts" ||
            event.observation._tag === "FocusedTaskClaimFactsUnreadable")
      ).length
    }
    const stopStage = () => {
      const stop = records.findLast(
        ({ event }) => event._tag === "AttemptChoiceApplied" && event.choice === "StopTaskImplementation"
      )
      if (stop === undefined) return "NotStopping"
      const abandoned = records.findLast(({ event }) => event._tag === "AttemptImplementationAbandoned")
      if (abandoned === undefined) return "NeedQuiescence"
      const released = records.some(
        ({ event, position }) => position > abandoned.position && event._tag === "TaskClaimReleased"
      )
      const noRelease = records.some(
        ({ event, position }) => position > abandoned.position && event._tag === "StoppedAttemptClaimNoReleaseObserved"
      )
      if (released || noRelease) return "StopComplete"
      const observation = claimObservation()
      if (observation === "ClaimNotRead") return "NeedClaimObservation"
      if (observation === "ClaimUnreadable") return "StopWaiting"
      if (observation === "ClaimAbsent" || observation === "ClaimForeign") return "StopComplete"
      const releaseIntent = records.findLast(
        ({ event, position }) => position > abandoned.position && event._tag === "TaskClaimReleaseIntended"
      )
      if (releaseIntent === undefined) return "NeedClaimRelease"
      const releaseCallInFlight =
        pendingRelease !== undefined &&
        pendingRelease.pollUnsafe() === undefined &&
        releaseCallCount > pendingReleaseCallBaseline
      if (releaseCallInFlight) return "ClaimReleaseAmbiguous"
      const readAfterIntent = records.some(
        ({ event, position }) =>
          position > releaseIntent.position &&
          event._tag === "TaskTrackerFactsObserved" &&
          event.observation._tag === "FocusedTaskClaimFacts"
      )
      return readAfterIntent ? "ClaimReleaseRetryWait" : "NeedClaimRelease"
    }
    const appendExecutorReport = (report: PlannedAttemptExecutorReport) =>
      Effect.gen(function* () {
        const ordinal = PlannedAttemptExecutorReportOrdinal.make(
          records.filter(({ event }) => event._tag === "PlannedAttemptExecutorWorkReported").length + 1
        )
        executorAuthority = report
        yield* journal.append(
          runId,
          plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, ordinal),
          PlannedAttemptExecutorWorkReportedEvent.make({ ordinal, report, version: workflowJournalEventVersion })
        )
      })
    const breakRetainedRestartProof = () =>
      Effect.gen(function* () {
        const ordinal = PlannedAttemptExecutorCommandOrdinal.make(
          records.filter(({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended").length + 1
        )
        yield* journal.append(
          runId,
          plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, ordinal),
          PlannedAttemptExecutorCommandIntendedEvent.make({
            command: "StartOrContinue",
            initiatedBy: { _tag: "DalphCoordinator" },
            occurrenceClassification: "InitiatedAction",
            ordinal,
            plannedAttempt,
            version: workflowJournalEventVersion
          })
        )
        yield* appendExecutorReport(PlannedAttemptExecutorReport.cases.Running.make({ correlation }))
      })
    const appendUnsettledExecutorCommand = () =>
      Effect.gen(function* () {
        const ordinal = PlannedAttemptExecutorCommandOrdinal.make(
          records.filter(({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended").length + 1
        )
        yield* journal.append(
          runId,
          plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, ordinal),
          PlannedAttemptExecutorCommandIntendedEvent.make({
            command: "StartOrContinue",
            initiatedBy: { _tag: "DalphCoordinator" },
            occurrenceClassification: "InitiatedAction",
            ordinal,
            plannedAttempt,
            version: workflowJournalEventVersion
          })
        )
      })
    const appendStartOrContinueReport = (report: PlannedAttemptExecutorReport) =>
      Effect.gen(function* () {
        const ordinal = PlannedAttemptExecutorCommandOrdinal.make(
          records.filter(({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended").length + 1
        )
        yield* journal.append(
          runId,
          plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, ordinal),
          PlannedAttemptExecutorCommandIntendedEvent.make({
            command: "StartOrContinue",
            initiatedBy: { _tag: "DalphCoordinator" },
            occurrenceClassification: "InitiatedAction",
            ordinal,
            plannedAttempt,
            version: workflowJournalEventVersion
          })
        )
        yield* appendExecutorReport(report)
      })
    const expectRestartResult = (
      expectedTag: "AttemptRestartPending" | "AttemptRestartRejected" | "PlannedAttemptReplacementRecorded",
      expectedReason?: string
    ) =>
      advanceRestart().pipe(
        Effect.tap((result) =>
          Effect.sync(() => {
            if (result._tag !== expectedTag || ("reason" in result && result.reason !== expectedReason)) {
              throw new Error(
                `unexpected Restart result ${result._tag}${"reason" in result ? `:${result.reason}` : ""}`
              )
            }
          })
        ),
        Effect.orDie
      )

    return {
      init: () =>
        Effect.gen(function* () {
          records = []
          activeRecovery = undefined
          currentSpecification = plannedSpecification
          currentClaim = "Exact"
          currentOldWorktree = "Ready"
          replacementTaskFactsReadable = true
          replacementTaskEligible = true
          replacementTargetHeadReadable = true
          executorAuthority = PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation })
          nextStartOrContinueReport = PlannedAttemptExecutorReport.cases.Running.make({ correlation })
          activeRequestId = continueD1
          activeSubject = subjectF2
          activeChoice = "ContinueExistingAttempt"
          lastControlResult = "NoControlResult"
          replacementPhase = "ReplacementNotRequested"
          replacementDisposition = "NoReplacementDisposition"
          replacementTaskFacts = "ReplacementTaskFactsNotRead"
          replacementClaimFacts = "ReplacementClaimNotRead"
          replacementClaimReadsThisActivation = 0
          oldWorktreeFacts = "OldWorktreeNotRead"
          replacementTargetHeadFacts = "ReplacementTargetHeadNotRead"
          observedOldWorktreeHead = "NoGitCommit"
          oldBaseB1IsAncestor = false
          observedReplacementTargetHead = "NoGitCommit"
          replacementProcessLossCount = 0
          successorAdmissionCount = 0
          successorAdmissionReservation = undefined
          restartSuspensionReport = PlannedAttemptExecutorReport.cases.Running.make({ correlation })
          restartSuspensionBoundary = false
          suspensionCallCount = 0
          stopProjectionBaseline = 0
          stopRecoveryCount = 0
          releaseCallCount = 0
          releaseCallCountAtNonExactObservation = 0
          pendingReleaseCallBaseline = 0
          claimRecoveryCount = 0
          claimObservationBaseline = 0
          const freshProtocolController = yield* makePlannedAttemptProtocolController()
          protocolController = freshProtocolController
          controller = yield* makeDeliveryRuntimeAdmissionController(
            { capacity: TaskWorkCapacity.make(1), held: [] },
            yield* makeIntegrationTargetResourceController(),
            (yield* makeApplicationExitLifecycle()).admission
          ).pipe(Effect.provideService(PlannedAttemptProtocolController, freshProtocolController))
          yield* journal.beginRun(
            runId,
            target,
            InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
          )
          yield* journal.append(
            runId,
            intentRecordKey(exactClaim.operationId),
            TaskClaimAcquisitionIntendedEvent.make({ operation: claimOperation, version: workflowJournalEventVersion })
          )
          yield* journal.append(
            runId,
            outcomeRecordKey(exactClaim.operationId),
            TaskClaimAcquiredEvent.make({ claim: exactClaim, version: workflowJournalEventVersion })
          )
          yield* journal.append(
            runId,
            attemptPlanRecordKey(plannedAttempt.attemptId),
            TaskAttemptPlannedEvent.make({ operation: planOperation, version: workflowJournalEventVersion })
          )
          yield* journal.append(
            runId,
            plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
            PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
              plannedAttempt,
              version: workflowJournalEventVersion
            })
          )
          const commandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(1)
          yield* journal.append(
            runId,
            plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, commandOrdinal),
            PlannedAttemptExecutorCommandIntendedEvent.make({
              command: "StartOrContinue",
              initiatedBy: { _tag: "DalphCoordinator" },
              occurrenceClassification: "InitiatedAction",
              ordinal: commandOrdinal,
              plannedAttempt,
              version: workflowJournalEventVersion
            })
          )
          const ordinal = PlannedAttemptExecutorReportOrdinal.make(1)
          yield* journal.append(
            runId,
            plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, ordinal),
            PlannedAttemptExecutorWorkReportedEvent.make({
              ordinal,
              report: executorAuthority,
              version: workflowJournalEventVersion
            })
          )
          const graphOperation = makeTrackerGraphObservationOperation(
            OperationId.make("task-fact-model-initial-graph"),
            target,
            [],
            []
          )
          yield* provideInterpreter(
            Effect.gen(function* () {
              yield* (yield* WorkflowInterpreter).readTrackerGraph(graphOperation)
            })
          )
          const specificationOperation = makeTaskWorkSpecificationObservationOperation(
            OperationId.make("task-fact-model-initial-F1"),
            target,
            taskId,
            []
          )
          yield* journal.append(
            runId,
            intentRecordKey(specificationOperation.operationId),
            taskTrackerReadIntent(specificationOperation)
          )
          yield* journal.append(
            runId,
            outcomeRecordKey(specificationOperation.operationId),
            taskTrackerFactsObservedEvent(
              specificationOperation.operationId,
              makeFocusedTaskWorkSpecificationFactsObserved(specificationOperation, plannedSpecification)
            )
          )
          const independentSpecificationOperation = makeTaskWorkSpecificationObservationOperation(
            OperationId.make("task-fact-model-initial-B"),
            target,
            independentTaskId,
            []
          )
          yield* journal.append(
            runId,
            intentRecordKey(independentSpecificationOperation.operationId),
            taskTrackerReadIntent(independentSpecificationOperation)
          )
          yield* journal.append(
            runId,
            outcomeRecordKey(independentSpecificationOperation.operationId),
            taskTrackerFactsObservedEvent(
              independentSpecificationOperation.operationId,
              makeFocusedTaskWorkSpecificationFactsObserved(independentSpecificationOperation, independentSpecification)
            )
          )
        }).pipe(Effect.orDie),
      observeF2Change: () =>
        Effect.sync(() => {
          currentSpecification = specificationF2
        }).pipe(
          Effect.andThen(
            provideInterpreter(
              Effect.gen(function* () {
                const operation = makeTaskWorkSpecificationObservationOperation(
                  OperationId.make(`task-fact-model-F2-${records.length + 1}`),
                  target,
                  taskId,
                  []
                )
                yield* (yield* WorkflowInterpreter).readTaskWorkSpecification(operation)
              })
            )
          ),
          Effect.orDie,
          Effect.asVoid
        ),
      applyContinueF2: () =>
        Effect.sync(() => {
          activeRequestId = continueD1
          activeSubject = subjectF2
        }).pipe(
          Effect.andThen(applyChoice("ContinueExistingAttempt", continueD1, subjectF2)),
          Effect.orDie,
          Effect.asVoid
        ),
      applyRestartF2: () =>
        Effect.sync(() => {
          activeRequestId = restartD1
          activeSubject = subjectF2
          replacementPhase = "RestartApplied"
        }).pipe(
          Effect.andThen(applyChoice("RestartTaskImplementation", restartD1, subjectF2)),
          Effect.orDie,
          Effect.asVoid
        ),
      applyStopF2: () =>
        Effect.sync(() => {
          activeRequestId = stopD2
          activeSubject = subjectF2
        }).pipe(
          Effect.andThen(applyChoice("StopTaskImplementation", stopD2, subjectF2)),
          Effect.tap(() =>
            Effect.sync(() => {
              stopProjectionBaseline = executorProjectionCount()
            })
          ),
          Effect.orDie,
          Effect.asVoid
        ),
      redeliverExactF2Choice: () =>
        applyChoice(activeChoice, activeRequestId, activeSubject).pipe(Effect.orDie, Effect.asVoid),
      rejectRunMismatchedRequest: () =>
        expectChoiceFailure(
          applyChoice("ContinueExistingAttempt", continueD1, {
            ...subjectF2,
            plannedAttempt: PlannedTaskAttempt.make({ ...plannedAttempt, runId: otherRunId })
          })
        ).pipe(Effect.orDie),
      rejectPersistedRequestContentReuse: () =>
        expectChoiceFailure(
          applyChoice(
            activeChoice === "ContinueExistingAttempt" ? "StopTaskImplementation" : "ContinueExistingAttempt",
            activeRequestId,
            activeSubject
          )
        ).pipe(Effect.orDie),
      rejectLosingF2Choice: () =>
        expectChoiceFailure(
          applyChoice(
            activeChoice === "ContinueExistingAttempt" ? "StopTaskImplementation" : "ContinueExistingAttempt",
            AttemptChoiceRequestId.make({ nonce: "losing-choice", runId }),
            subjectF2
          )
        ).pipe(Effect.orDie),
      observeExactTerminal: () =>
        Effect.sync(() => {
          nextStartOrContinueReport = PlannedAttemptExecutorReport.cases.Terminal.make({
            correlation,
            result: { _tag: "Accepted", acceptedResult }
          })
        }).pipe(
          Effect.andThen(reservePosition),
          Effect.andThen(provideJournal(continuePlannedAttemptExecutorWork(plannedAttempt))),
          Effect.andThen(releasePosition()),
          Effect.orDie,
          Effect.asVoid
        ),
      beginIntegration: () =>
        Effect.gen(function* () {
          // Reactive delivery rebuilds the coherent recovery frame after the
          // accepted report, then reads the exact claim and consumes queue and
          // start transitions against that same activation baseline.
          const cutoffRecovery = yield* provideJournal(makeRunRecoveryProjection(runId, integrationTarget))
          const graphObservation = makeTrackerGraphObservationOperation(
            OperationId.make(`task-fact-model-integration-graph-${records.length + 1}`),
            target,
            [],
            []
          )
          yield* provideInterpreter(
            Effect.gen(function* () {
              yield* (yield* WorkflowInterpreter).readTrackerGraph(graphObservation)
            })
          )
          const claimObservation = makeTaskClaimObservationOperation(
            OperationId.make(`task-fact-model-integration-claim-${records.length + 1}`),
            target,
            taskId,
            [exactClaim.operationId]
          )
          yield* provideInterpreter(
            Effect.gen(function* () {
              yield* (yield* WorkflowInterpreter).readTaskClaim(claimObservation)
            })
          )
          const afterClaimRead = yield* cutoffRecovery.readDeliveryProjection
          const queue = afterClaimRead.frontier.transitions.find(
            ({ _tag }) => _tag === "QueueAcceptedResultIntegrationResponsibility"
          )
          if (queue === undefined || queue._tag !== "QueueAcceptedResultIntegrationResponsibility") {
            return yield* Effect.die("missing accepted-result queue transition after exact activation-local facts")
          }
          if (
            !plannedTaskAttemptEquivalence(queue.accepted.plannedAttempt, plannedAttempt) ||
            queue.accepted.acceptedResult.commit !== acceptedResult.commit
          ) {
            return yield* Effect.die("wrong accepted-result queue transition")
          }
          yield* provideJournal(
            queueAcceptedResultIntegrationResponsibility(
              queue.accepted.plannedAttempt,
              queue.accepted.acceptedResult,
              queue.integrationTarget
            )
          )
          const afterQueue = yield* cutoffRecovery.readDeliveryProjection
          const start = afterQueue.frontier.transitions.find(({ _tag }) => _tag === "StartQueuedIntegration")
          if (start === undefined || start._tag !== "StartQueuedIntegration")
            return yield* Effect.die("missing integration-start transition")
          yield* provideJournal(startQueuedIntegration(start.responsibility))
        }).pipe(Effect.orDie),
      rejectContinuePastIntegrationCutoff: () =>
        expectChoiceFailure(applyChoice("ContinueExistingAttempt", continueD1, subjectF2)).pipe(Effect.orDie),
      rejectRestartPastIntegrationCutoff: () =>
        expectChoiceFailure(applyChoice("RestartTaskImplementation", restartD1, subjectF2)).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              replacementPhase = "ReplacementRejected"
              replacementDisposition = "PastIntegrationCutoff"
            })
          ),
          Effect.orDie
        ),
      rejectStopPastIntegrationCutoff: () =>
        expectChoiceFailure(applyChoice("StopTaskImplementation", stopD2, subjectF2)).pipe(Effect.orDie),
      readFreshExactGraph: () => readThrough("ObservePlannedAttemptContinuationGraph").pipe(Effect.orDie),
      readFreshExactSpecification: () =>
        readThrough("ObservePlannedAttemptContinuationSpecification").pipe(Effect.orDie),
      readFreshExactClaim: () => readThrough("ObservePlannedAttemptContinuationClaim").pipe(Effect.orDie),
      readFreshExactWorktree: () => readThrough("ObservePlannedAttemptContinuationWorktree").pipe(Effect.orDie),
      readFreshExactLineage: () => readThrough("ObservePlannedAttemptContinuationTargetLineage").pipe(Effect.orDie),
      readFreshExactExecutor: () =>
        provideJournal(observePlannedAttemptExecutorState(plannedAttempt)).pipe(Effect.orDie, Effect.asVoid),
      admitSameAttemptP: () =>
        reservePosition().pipe(
          Effect.andThen(provideJournal(continuePlannedAttemptExecutorWork(plannedAttempt))),
          Effect.orDie,
          Effect.asVoid
        ),
      observeF3BeforeContinuation: () =>
        Effect.sync(() => {
          currentSpecification = specificationF3
        }).pipe(Effect.andThen(readThrough("ObservePlannedAttemptContinuationSpecification")), Effect.orDie),
      applyContinueF3: () =>
        Effect.sync(() => {
          activeRequestId = continueD3
          activeSubject = subjectF3
        }).pipe(
          Effect.andThen(applyChoice("ContinueExistingAttempt", continueD3, subjectF3)),
          Effect.orDie,
          Effect.asVoid
        ),
      beginReplacementFactsFromRetainedSafeSuspension: () =>
        Effect.sync(() => {
          replacementPhase = "NeedCurrentReplacementTaskFacts"
          replacementDisposition = "NoReplacementDisposition"
        }),
      breakRestartSafeSuspension: () =>
        breakRetainedRestartProof().pipe(
          Effect.andThen(reservePosition()),
          Effect.tap(() =>
            Effect.sync(() => {
              replacementPhase = "NeedCurrentExecutorQuiescence"
              replacementDisposition = "NoReplacementDisposition"
              replacementTaskFacts = "ReplacementTaskFactsNotRead"
              replacementClaimFacts = "ReplacementClaimNotRead"
              replacementClaimReadsThisActivation = 0
              oldWorktreeFacts = "OldWorktreeNotRead"
              replacementTargetHeadFacts = "ReplacementTargetHeadNotRead"
              observedOldWorktreeHead = "NoGitCommit"
              oldBaseB1IsAncestor = false
              observedReplacementTargetHead = "NoGitCommit"
            })
          ),
          Effect.orDie
        ),
      observeRestartRunning: () =>
        Effect.gen(function* () {
          restartSuspensionBoundary = true
          restartSuspensionReport = PlannedAttemptExecutorReport.cases.Running.make({ correlation })
          yield* expectRestartResult("AttemptRestartPending", "ExecutorRunning")
          restartSuspensionBoundary = false
          replacementPhase = "ReplacementWaiting"
          replacementDisposition = "RunningWriterWait"
        }),
      observeRestartExecutorUnavailable: () =>
        Effect.gen(function* () {
          executorAuthority = undefined
          yield* appendUnsettledExecutorCommand()
          yield* expectRestartResult("AttemptRestartPending", "ExecutorUnavailable")
          replacementPhase = "ReplacementWaiting"
          replacementDisposition = "ExecutorUnreadableWait"
        }).pipe(Effect.orDie),
      observeRestartExecutorContradiction: () =>
        Effect.gen(function* () {
          executorAuthority = PlannedAttemptExecutorReport.cases.Running.make({
            correlation: { attemptId: AttemptId.make("task-fact-model-contradictory-attempt"), runId }
          })
          yield* appendUnsettledExecutorCommand()
          yield* expectRestartResult("AttemptRestartPending", "ExecutorContradictory")
          replacementPhase = "ReplacementWaiting"
          replacementDisposition = "ExecutorCorrelationContradiction"
        }).pipe(Effect.orDie),
      observeRestartSafelySuspended: () =>
        Effect.gen(function* () {
          restartSuspensionBoundary = true
          restartSuspensionReport = PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation })
          yield* provideJournal(requestPlannedAttemptExecutorSuspension(plannedAttempt))
          restartSuspensionBoundary = false
          yield* releasePosition()
          replacementPhase = "NeedCurrentReplacementTaskFacts"
          replacementDisposition = "NoReplacementDisposition"
          replacementTaskFacts = "ReplacementTaskFactsNotRead"
          replacementClaimFacts = "ReplacementClaimNotRead"
          replacementClaimReadsThisActivation = 0
          oldWorktreeFacts = "OldWorktreeNotRead"
          replacementTargetHeadFacts = "ReplacementTargetHeadNotRead"
          observedOldWorktreeHead = "NoGitCommit"
          oldBaseB1IsAncestor = false
          observedReplacementTargetHead = "NoGitCommit"
        }).pipe(Effect.orDie),
      observeRestartAccepted: () =>
        appendStartOrContinueReport(
          PlannedAttemptExecutorReport.cases.Terminal.make({
            correlation,
            result: { _tag: "Accepted", acceptedResult }
          })
        ).pipe(
          Effect.andThen(releasePosition()),
          Effect.tap(() =>
            Effect.sync(() => {
              replacementPhase = "NeedCurrentReplacementTaskFacts"
              replacementDisposition = "NoReplacementDisposition"
              replacementTaskFacts = "ReplacementTaskFactsNotRead"
              replacementClaimFacts = "ReplacementClaimNotRead"
              replacementClaimReadsThisActivation = 0
              oldWorktreeFacts = "OldWorktreeNotRead"
              replacementTargetHeadFacts = "ReplacementTargetHeadNotRead"
              observedOldWorktreeHead = "NoGitCommit"
              oldBaseB1IsAncestor = false
              observedReplacementTargetHead = "NoGitCommit"
            })
          ),
          Effect.orDie
        ),
      observeRestartCompleted: () =>
        appendStartOrContinueReport(
          PlannedAttemptExecutorReport.cases.Terminal.make({ correlation, result: { _tag: "Completed" } })
        ).pipe(
          Effect.andThen(releasePosition()),
          Effect.andThen(expectRestartResult("AttemptRestartRejected", "CompletedDoesNotAuthorizeReplacement")),
          Effect.tap(() =>
            Effect.sync(() => {
              replacementPhase = "ReplacementRejected"
              replacementDisposition = "CompletedDoesNotAuthorizeReplacement"
            })
          ),
          Effect.orDie,
          Effect.asVoid
        ),
      observeRestartFailed: () =>
        appendStartOrContinueReport(
          PlannedAttemptExecutorReport.cases.Terminal.make({ correlation, result: { _tag: "Failed" } })
        ).pipe(
          Effect.andThen(releasePosition()),
          Effect.andThen(expectRestartResult("AttemptRestartRejected", "FailedDoesNotAuthorizeReplacement")),
          Effect.tap(() =>
            Effect.sync(() => {
              replacementPhase = "ReplacementRejected"
              replacementDisposition = "FailedDoesNotAuthorizeReplacement"
            })
          ),
          Effect.orDie,
          Effect.asVoid
        ),
      observeReplacementExactF2TaskFacts: () =>
        Effect.sync(() => {
          currentSpecification = specificationF2
          replacementTaskFacts = "ExactF2OpenInClosureUnblocked"
          replacementClaimReadsThisActivation = 0
          replacementPhase = "NeedCurrentReplacementClaim"
        }),
      observeReplacementF3TaskFacts: () =>
        Effect.sync(() => {
          currentSpecification = specificationF3
        }).pipe(
          Effect.andThen(expectRestartResult("AttemptRestartRejected", "NewFingerprintChoiceRequired")),
          Effect.tap(() =>
            Effect.sync(() => {
              replacementPhase = "ReplacementRejected"
              replacementDisposition = "NewFingerprintChoiceRequired"
              replacementTaskFacts = "ReplacementF3Observed"
            })
          ),
          Effect.orDie,
          Effect.asVoid
        ),
      observeReplacementTaskFactsUnreadable: () =>
        Effect.sync(() => {
          replacementTaskFactsReadable = false
        }).pipe(
          Effect.andThen(expectRestartResult("AttemptRestartPending", "TaskFactsUnreadable")),
          Effect.tap(() =>
            Effect.sync(() => {
              replacementPhase = "ReplacementWaiting"
              replacementDisposition = "TaskFactsUnreadableWait"
              replacementTaskFacts = "ReplacementTaskFactsUnreadable"
            })
          ),
          Effect.orDie,
          Effect.asVoid
        ),
      observeReplacementTaskNotEligible: () =>
        Effect.sync(() => {
          replacementTaskEligible = false
        }).pipe(
          Effect.andThen(expectRestartResult("AttemptRestartPending", "TaskNotEligible")),
          Effect.tap(() =>
            Effect.sync(() => {
              replacementPhase = "ReplacementWaiting"
              replacementDisposition = "TaskNotEligibleWait"
              replacementTaskFacts = "ReplacementTaskNotEligible"
            })
          ),
          Effect.orDie,
          Effect.asVoid
        ),
      observeReplacementExactK1: () =>
        Effect.sync(() => {
          currentClaim = "Exact"
          replacementClaimFacts = "ExactK1Observed"
          replacementClaimReadsThisActivation += 1
          replacementPhase = "NeedCurrentOldWorktree"
        }),
      observeReplacementClaimAbsent: () =>
        Effect.sync(() => {
          currentClaim = "Absent"
        }).pipe(
          Effect.andThen(expectRestartResult("AttemptRestartPending", "ClaimAbsent")),
          Effect.tap(() =>
            Effect.sync(() => {
              replacementPhase = "ReplacementWaiting"
              replacementDisposition = "ClaimAbsentWait"
              replacementClaimFacts = "ReplacementClaimAbsent"
              replacementClaimReadsThisActivation += 1
            })
          ),
          Effect.orDie,
          Effect.asVoid
        ),
      observeReplacementClaimForeign: () =>
        Effect.sync(() => {
          currentClaim = "Foreign"
        }).pipe(
          Effect.andThen(expectRestartResult("AttemptRestartPending", "ClaimForeign")),
          Effect.tap(() =>
            Effect.sync(() => {
              replacementPhase = "ReplacementWaiting"
              replacementDisposition = "ClaimForeignWait"
              replacementClaimFacts = "ReplacementClaimForeign"
              replacementClaimReadsThisActivation += 1
            })
          ),
          Effect.orDie,
          Effect.asVoid
        ),
      observeReplacementClaimUnreadableBounded: () =>
        Effect.sync(() => {
          currentClaim = "Unreadable"
        }).pipe(
          Effect.andThen(expectRestartResult("AttemptRestartPending", "ClaimUnreadable")),
          Effect.tap(() =>
            Effect.sync(() => {
              replacementPhase = "ReplacementWaiting"
              replacementDisposition = "ClaimUnreadableWait"
              replacementClaimFacts = "ReplacementClaimUnreadable"
              replacementClaimReadsThisActivation = 3
            })
          ),
          Effect.orDie,
          Effect.asVoid
        ),
      observeReplacementExactW1Ready: () =>
        Effect.sync(() => {
          currentOldWorktree = "Ready"
          oldWorktreeFacts = "ExactW1Ready"
          observedOldWorktreeHead = "HeadH1Commit"
          oldBaseB1IsAncestor = true
          replacementPhase = "NeedCurrentTargetHead"
        }),
      observeReplacementW1NotReady: () =>
        Effect.sync(() => {
          currentOldWorktree = "NotReady"
        }).pipe(
          Effect.andThen(expectRestartResult("AttemptRestartPending", "OldWorktreeNotReady")),
          Effect.tap(() =>
            Effect.sync(() => {
              replacementPhase = "ReplacementWaiting"
              replacementDisposition = "OldWorktreeNotReadyWait"
              oldWorktreeFacts = "OldWorktreeNotReady"
            })
          ),
          Effect.orDie,
          Effect.asVoid
        ),
      observeReplacementW1Unreadable: () =>
        Effect.sync(() => {
          currentOldWorktree = "Unreadable"
        }).pipe(
          Effect.andThen(expectRestartResult("AttemptRestartPending", "OldWorktreeUnreadable")),
          Effect.tap(() =>
            Effect.sync(() => {
              replacementPhase = "ReplacementWaiting"
              replacementDisposition = "OldWorktreeUnreadableWait"
              oldWorktreeFacts = "OldWorktreeUnreadable"
            })
          ),
          Effect.orDie,
          Effect.asVoid
        ),
      observeReplacementExactH2: () =>
        Effect.sync(() => {
          replacementTargetHeadFacts = "ExactH2Observed"
          observedReplacementTargetHead = "HeadH2Commit"
          replacementPhase = "ReplacementReadyToAppend"
        }),
      observeReplacementH2Unreadable: () =>
        Effect.sync(() => {
          replacementTargetHeadReadable = false
        }).pipe(
          Effect.andThen(expectRestartResult("AttemptRestartPending", "TargetHeadUnreadable")),
          Effect.tap(() =>
            Effect.sync(() => {
              replacementPhase = "ReplacementWaiting"
              replacementDisposition = "TargetHeadUnreadableWait"
              replacementTargetHeadFacts = "ReplacementTargetHeadUnreadable"
            })
          ),
          Effect.orDie,
          Effect.asVoid
        ),
      recoverReplacementAppendAbsent: () =>
        Effect.sync(() => {
          replacementProcessLossCount += 1
          replacementPhase = "NeedCurrentReplacementTaskFacts"
          replacementTaskFacts = "ReplacementTaskFactsNotRead"
          replacementClaimFacts = "ReplacementClaimNotRead"
          replacementClaimReadsThisActivation = 0
          oldWorktreeFacts = "OldWorktreeNotRead"
          replacementTargetHeadFacts = "ReplacementTargetHeadNotRead"
          observedOldWorktreeHead = "NoGitCommit"
          oldBaseB1IsAncestor = false
          observedReplacementTargetHead = "NoGitCommit"
          activeRecovery = undefined
        }),
      recordPlannedAttemptReplacement: () =>
        expectRestartResult("PlannedAttemptReplacementRecorded").pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              replacementPhase = "PlannedAttemptReplacementRecorded"
              replacementDisposition = "NoReplacementDisposition"
            })
          ),
          Effect.asVoid
        ),
      recoverReplacementAppendPresent: () =>
        Effect.sync(() => {
          replacementProcessLossCount += 1
          activeRecovery = undefined
        }).pipe(Effect.andThen(expectRestartResult("PlannedAttemptReplacementRecorded")), Effect.asVoid),
      prepareCleanSuccessorW2: () =>
        Effect.gen(function* () {
          const replacement = records.findLast(({ event }) => event._tag === "PlannedAttemptReplaced")?.event
          if (replacement?._tag !== "PlannedAttemptReplaced") {
            return yield* Effect.die("successor worktree preparation requires the atomic replacement event")
          }
          const operation = makeTaskWorktreeReconciliationOperation({
            operationId: OperationId.make("task-fact-model-worktree-P2"),
            plannedAttempt: successorAttempt,
            predecessorOperationIds: [replacement.successorPlan.operationId]
          })
          yield* provideInterpreter(
            Effect.gen(function* () {
              yield* (yield* WorkflowInterpreter).reconcileTaskWorktree(operation)
            })
          )
          replacementPhase = "SuccessorWaitingForAdmission"
        }).pipe(Effect.orDie),
      admitSuccessorThroughOrdinaryCapacity: () =>
        reserveSuccessorPosition().pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              replacementPhase = "SuccessorAdmitted"
            })
          ),
          Effect.orDie
        ),
      startSuccessorExecutor: () =>
        Effect.gen(function* () {
          const admission = yield* requireController()
          const reservation = successorAdmissionReservation
          if (reservation?._tag !== "PlannedAttemptProtocolAdmission") {
            return yield* Effect.die("successor start requires its admitted exact-attempt protocol permit")
          }
          yield* provideJournal(continuePlannedAttemptExecutorWorkWithPermit(reservation.permit, successorAttempt))
          yield* admission.complete(reservation)
          successorAdmissionReservation = undefined
          replacementPhase = "SuccessorRunning"
        }).pipe(Effect.orDie),
      requireStoppageReconciliation: () =>
        Effect.sync(() => {
          executorAuthority = PlannedAttemptExecutorReport.cases.Running.make({ correlation })
        }).pipe(
          Effect.andThen(provideJournal(observePlannedAttemptExecutorState(plannedAttempt))),
          // This read supplies the model's external "proof broke" trigger; it
          // is not one of the later Stop reconciliation projections.
          Effect.tap(() =>
            Effect.sync(() => {
              stopProjectionBaseline += 1
            })
          ),
          Effect.andThen(reservePosition()),
          Effect.orDie,
          Effect.asVoid
        ),
      recordStoppageIntent: () =>
        Effect.gen(function* () {
          resetCommandBoundary()
          pendingCommand = yield* provideJournal(requestPlannedAttemptExecutorSuspension(plannedAttempt)).pipe(
            Effect.forkDetach({ startImmediately: true })
          )
          yield* Deferred.await(commandIntentSignal)
        }).pipe(Effect.orDie),
      callStoppage: () =>
        Deferred.succeed(commandIntentGate, undefined).pipe(
          Effect.andThen(Deferred.await(commandCallSignal)),
          Effect.orDie,
          Effect.asVoid
        ),
      loseStoppageResponse: () =>
        pendingCommand === undefined
          ? Effect.die("stoppage command must be pending")
          : Fiber.interrupt(pendingCommand).pipe(Effect.asVoid),
      projectExactRunningForStoppage: () =>
        Effect.sync(() => {
          executorAuthority = PlannedAttemptExecutorReport.cases.Running.make({ correlation })
        }).pipe(
          Effect.andThen(provideJournal(requestPlannedAttemptExecutorSuspension(plannedAttempt))),
          Effect.andThen(reservePosition()),
          Effect.orDie,
          Effect.asVoid
        ),
      projectExactSafeForStoppage: () =>
        Effect.sync(() => {
          executorAuthority = PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation })
        }).pipe(
          Effect.andThen(provideJournal(requestPlannedAttemptExecutorSuspension(plannedAttempt))),
          Effect.andThen(releasePosition()),
          Effect.orDie,
          Effect.asVoid
        ),
      projectExactTerminalForStoppage: () =>
        Effect.sync(() => {
          executorAuthority = PlannedAttemptExecutorReport.cases.Terminal.make({
            correlation,
            result: { _tag: "Completed" }
          })
        }).pipe(
          Effect.andThen(provideJournal(requestPlannedAttemptExecutorSuspension(plannedAttempt))),
          Effect.andThen(releasePosition()),
          Effect.orDie,
          Effect.asVoid
        ),
      recoverStopActivation: () =>
        Effect.gen(function* () {
          yield* reactivate()
          if (stopRecoveryCount < 3) stopRecoveryCount += 1
          stopProjectionBaseline = executorProjectionCount()
        }).pipe(Effect.orDie, Effect.asVoid),
      projectReadOnlyExactSafeAfterStoppageLimit: () =>
        Effect.gen(function* () {
          const selected = yield* transition("ObserveAttemptStoppageExecutor")
          if (selected._tag !== "ObserveAttemptStoppageExecutor")
            return yield* Effect.die("missing production post-limit Stop observation")
          executorAuthority = PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation })
          yield* provideControl(observeAttemptStoppageExecutor(selected.requestId, selected.subject)).pipe(
            Effect.provideService(PlannedAttemptExecutor, executor)
          )
          yield* releasePosition()
        }).pipe(Effect.orDie, Effect.asVoid),
      abandonImplementation: () =>
        provideControl(
          advanceAttemptStoppage(activeRequestId, activeSubject).pipe(
            Effect.provideService(PlannedAttemptExecutor, executor)
          )
        ).pipe(Effect.andThen(releasePosition()), Effect.orDie, Effect.asVoid),
      observeExactClaim: () =>
        Effect.sync(() => {
          currentClaim = "Exact"
        }).pipe(Effect.andThen(readThrough("ObserveStoppedAttemptClaim")), Effect.orDie),
      observeAbsentClaim: () =>
        Effect.sync(() => {
          currentClaim = "Absent"
        }).pipe(
          Effect.andThen(readThrough("ObserveStoppedAttemptClaim")),
          Effect.andThen(
            Effect.gen(function* () {
              const selected = yield* transition("RecordStoppedAttemptClaimNoRelease")
              if (selected._tag !== "RecordStoppedAttemptClaimNoRelease")
                return yield* Effect.die("wrong no-release transition")
              yield* provideControl(
                recordStoppedAttemptClaimNoRelease(activeRequestId, activeSubject, selected.observationOperationId)
              )
            })
          ),
          Effect.andThen(
            Effect.sync(() => {
              releaseCallCountAtNonExactObservation = releaseCallCount
            })
          ),
          Effect.orDie
        ),
      observeForeignClaim: () =>
        Effect.sync(() => {
          currentClaim = "Foreign"
        }).pipe(
          Effect.andThen(readThrough("ObserveStoppedAttemptClaim")),
          Effect.andThen(
            Effect.gen(function* () {
              const selected = yield* transition("RecordStoppedAttemptClaimNoRelease")
              if (selected._tag !== "RecordStoppedAttemptClaimNoRelease")
                return yield* Effect.die("wrong no-release transition")
              yield* provideControl(
                recordStoppedAttemptClaimNoRelease(activeRequestId, activeSubject, selected.observationOperationId)
              )
            })
          ),
          Effect.andThen(
            Effect.sync(() => {
              releaseCallCountAtNonExactObservation = releaseCallCount
            })
          ),
          Effect.orDie
        ),
      observeUnreadableClaim: () =>
        Effect.sync(() => {
          currentClaim = "Unreadable"
        }).pipe(
          Effect.andThen(readThrough("ObserveStoppedAttemptClaim")),
          Effect.andThen(
            Effect.sync(() => {
              releaseCallCountAtNonExactObservation = releaseCallCount
            })
          ),
          Effect.orDie
        ),
      recordClaimReleaseIntent: () =>
        Effect.gen(function* () {
          resetReleaseBoundary()
          pendingReleaseCallBaseline = releaseCallCount
          const selected = yield* transition("ReleaseStoppedAttemptClaim")
          if (selected._tag !== "ReleaseStoppedAttemptClaim") return yield* Effect.die("wrong release transition")
          pendingRelease = yield* provideInterpreter(
            Effect.gen(function* () {
              yield* (yield* WorkflowInterpreter).releaseTaskClaim(selected.operation)
            })
          ).pipe(Effect.forkDetach({ startImmediately: true }))
          yield* Deferred.await(releaseIntentSignal)
        }).pipe(Effect.orDie),
      releaseExactClaim: () =>
        Effect.gen(function* () {
          yield* crossReleaseBoundary()
          yield* Deferred.await(releaseCallSignal)
          yield* Deferred.succeed(releaseResponse, "Success")
          if (pendingRelease === undefined) return yield* Effect.die("claim release must be pending")
          yield* Fiber.join(pendingRelease)
          releaseCallCountAtNonExactObservation = releaseCallCount
        }).pipe(Effect.orDie),
      loseClaimReleaseResponse: () =>
        crossReleaseBoundary().pipe(Effect.andThen(Deferred.await(releaseCallSignal)), Effect.orDie, Effect.asVoid),
      projectClaimReleased: () =>
        Effect.gen(function* () {
          yield* Deferred.succeed(releaseResponse, "Success")
          if (pendingRelease === undefined) return yield* Effect.die("claim release must be pending")
          yield* Fiber.join(pendingRelease)
          releaseCallCountAtNonExactObservation = releaseCallCount
        }).pipe(Effect.orDie),
      projectClaimStillExact: () =>
        Effect.gen(function* () {
          yield* Deferred.succeed(releaseResponse, "Failure")
          if (pendingRelease === undefined) return yield* Effect.die("claim release must be pending")
          yield* Fiber.await(pendingRelease)
          currentClaim = "Exact"
          yield* readThrough("ObserveStoppedAttemptClaim")
        }).pipe(Effect.orDie),
      recoverClaimActivation: () =>
        Effect.sync(() => {
          claimObservationBaseline = stoppedClaimObservationCount()
        }).pipe(
          Effect.andThen(reactivate()),
          Effect.tap(() =>
            Effect.sync(() => {
              claimRecoveryCount = Math.min(claimRecoveryCount + 1, 3)
            })
          ),
          Effect.orDie,
          Effect.asVoid
        ),
      selectIndependentTaskB: () =>
        Effect.gen(function* () {
          const recovered = yield* fullProjection()
          const fresh = yield* freshDecisions()
          const selected = fresh.find(
            ({ transition }) =>
              transition._tag === "ContinueFreshWorkflowOperation" && transition.taskId === independentTaskId
          )
          const recoveredSelected = recovered.frontier.transitions.some((candidate) =>
            isIndependentTaskProgress(candidate)
          )
          if (selected === undefined || recoveredSelected)
            return yield* Effect.die("independent task B must select its fresh graph-read decision")
          if (selected.step._tag !== "RecordTaskAttemptPlan")
            return yield* Effect.die(`unexpected independent task B step ${selected.step._tag}`)
          const operation = makeTaskAttemptPlanOperation({
            operationId: OperationId.make("task-fact-model-independent-B-selection"),
            plannedAttempt: independentPlannedAttempt,
            predecessorOperationIds: [selected.step.predecessorOperationId]
          })
          yield* provideInterpreter(
            Effect.gen(function* () {
              yield* (yield* WorkflowInterpreter).recordTaskAttemptPlan(operation)
            })
          )
        }).pipe(Effect.orDie),
      getState: () =>
        Effect.gen(function* () {
          const currentRecovery = yield* projection()
          const fullRecovery = yield* fullProjection()
          const freshWorkflow = yield* freshDecisions()
          const choice = latestChoice()?.event
          const fresh = freshFacts()
          const report = evidenceReport()
          const suspendIntents = records.filter(
            ({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended" && event.command === "Suspend"
          )
          const latestSafeEvidencePosition = records.findLast(
            ({ event }) =>
              (event._tag === "PlannedAttemptExecutorWorkReported" && event.report._tag === "SafelySuspended") ||
              ((event._tag === "PlannedAttemptExecutorCommandProjectionObserved" ||
                event._tag === "PlannedAttemptExecutorStateObserved") &&
                event.observation._tag === "ExactExecutorReport" &&
                event.observation.report._tag === "SafelySuspended")
          )?.position
          const exactSuspendProjections = records.filter(
            ({ event }) =>
              event._tag === "PlannedAttemptExecutorCommandProjectionObserved" &&
              event.observation._tag === "ExactExecutorReport" &&
              suspendIntents.some(({ event: intent }) =>
                intent._tag === "PlannedAttemptExecutorCommandIntended"
                  ? intent.ordinal === event.commandOrdinal
                  : false
              )
          )
          const restartApplied = records.some(
            ({ event }) => event._tag === "AttemptChoiceApplied" && event.choice === "RestartTaskImplementation"
          )
          const latestSuspendIntent = suspendIntents.at(-1)
          const restartSuspendResponses = restartApplied
            ? records.filter(
                ({ event, position }) =>
                  latestSuspendIntent !== undefined &&
                  position > latestSuspendIntent.position &&
                  event._tag === "PlannedAttemptExecutorWorkReported" &&
                  event.report.correlation.attemptId === correlation.attemptId &&
                  event.report.correlation.runId === correlation.runId
              )
            : []
          const latestSuspend = suspendIntents.at(-1)?.event
          const latestSettled = exactSuspendProjections.at(-1)?.event
          const latestRestartSuspendResponse = restartSuspendResponses.at(-1)?.event
          const latestSuspendSettled =
            latestSuspend?._tag === "PlannedAttemptExecutorCommandIntended" &&
            records.some(
              ({ event }) =>
                event._tag === "PlannedAttemptExecutorCommandProjectionObserved" &&
                event.commandOrdinal === latestSuspend.ordinal &&
                event.observation._tag === "ExactExecutorReport"
            )
          const abandonment = records.findLast(({ event }) => event._tag === "AttemptImplementationAbandoned")
          const claimIntent = records.findLast(({ event }) => event._tag === "TaskClaimReleaseIntended")
          const claimReleased = records.some(({ event }) => event._tag === "TaskClaimReleased")
          const noRelease = records.findLast(
            ({ event }) => event._tag === "StoppedAttemptClaimNoReleaseObserved"
          )?.event
          const f2Choice = records.find(
            ({ event }) =>
              event._tag === "AttemptChoiceApplied" &&
              event.subject.observedTaskRevision === specificationF2.fingerprint
          )?.event
          const observation = claimObservation()
          const releaseTransition = currentRecovery.frontier.transitions.find(
            ({ _tag }) => _tag === "ReleaseStoppedAttemptClaim"
          )
          const releaseOperation =
            claimIntent?.event._tag === "TaskClaimReleaseIntended"
              ? claimIntent.event.operation
              : releaseTransition?._tag === "ReleaseStoppedAttemptClaim"
                ? releaseTransition.operation
                : undefined
          const authorityObservationOperationId =
            releaseOperation !== undefined &&
            "authority" in releaseOperation &&
            "observationOperationId" in releaseOperation.authority
              ? releaseOperation.authority.observationOperationId
              : undefined
          const exactClaimObservation = records.findLast(
            ({ event, position }) =>
              abandonment !== undefined &&
              position > abandonment.position &&
              event._tag === "TaskTrackerFactsObserved" &&
              event.operationId === authorityObservationOperationId &&
              event.observation._tag === "FocusedTaskClaimFacts" &&
              event.observation.observation._tag === "ActiveTaskClaim" &&
              event.observation.observation.operationId === exactClaim.operationId &&
              event.observation.observation.owner === exactClaim.owner &&
              event.observation.observation.token === exactClaim.token
          )?.event
          const exactObservationOperationId =
            exactClaimObservation?._tag === "TaskTrackerFactsObserved" ? exactClaimObservation.operationId : undefined
          const exactReleaseAuthority =
            releaseOperation !== undefined &&
            exactObservationOperationId !== undefined &&
            releaseOperation.release.claim.operationId === exactClaim.operationId &&
            releaseOperation.release.claim.owner === exactClaim.owner &&
            releaseOperation.release.claim.token === exactClaim.token &&
            releaseOperation.predecessorOperationIds.includes(exactClaim.operationId) &&
            releaseOperation.predecessorOperationIds.includes(exactObservationOperationId) &&
            "authority" in releaseOperation &&
            "_tag" in releaseOperation.authority &&
            releaseOperation.authority._tag === "StoppedAttemptClaimReleaseAuthority" &&
            "observationOperationId" in releaseOperation.authority &&
            releaseOperation.authority.observationOperationId === exactObservationOperationId &&
            "requestId" in releaseOperation.authority &&
            "runId" in releaseOperation.authority.requestId &&
            "nonce" in releaseOperation.authority.requestId &&
            releaseOperation.authority.requestId.runId === activeRequestId.runId &&
            releaseOperation.authority.requestId.nonce === activeRequestId.nonce
          const evidenceRecord = latestEvidenceRecord()
          const nonExactExecutorObservation = records.findLast(
            ({ event }) =>
              (event._tag === "PlannedAttemptExecutorCommandProjectionObserved" ||
                event._tag === "PlannedAttemptExecutorStateObserved") &&
              event.observation._tag !== "ExactExecutorReport" &&
              plannedTaskAttemptEquivalence(event.plannedAttempt, plannedAttempt)
          )
          const currentExecutorFailure =
            nonExactExecutorObservation !== undefined &&
            (evidenceRecord === undefined || nonExactExecutorObservation.position > evidenceRecord.position)
              ? nonExactExecutorObservation.event._tag === "PlannedAttemptExecutorCommandProjectionObserved" ||
                nonExactExecutorObservation.event._tag === "PlannedAttemptExecutorStateObserved"
                ? nonExactExecutorObservation.event.observation._tag
                : undefined
              : undefined
          const laterExecutorCommand =
            evidenceRecord !== undefined &&
            records.some(
              ({ event, position }) =>
                position > evidenceRecord.position &&
                event._tag === "PlannedAttemptExecutorCommandIntended" &&
                plannedTaskAttemptEquivalence(event.plannedAttempt, plannedAttempt)
            )
          const plannedIdentityPreserved =
            records.some(
              ({ event }) =>
                event._tag === "TaskAttemptPlanned" &&
                plannedTaskAttemptEquivalence(event.operation.plannedAttempt, plannedAttempt)
            ) &&
            records.some(
              ({ event }) =>
                event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
                plannedTaskAttemptEquivalence(event.plannedAttempt, plannedAttempt)
            )
          const cleanupTransitionSelected = currentRecovery.frontier.transitions.some(
            ({ _tag }) =>
              _tag === "ReplacePromotedTaskClaim" ||
              _tag === "DeleteCompletedTaskCompletionClaim" ||
              _tag === "ReleaseStartedIntegrationTarget"
          )
          const artifactsPreserved = plannedIdentityPreserved && !cleanupTransitionSelected
          const admission = yield* requireController()
          const admissionSnapshot = yield* admission.snapshot
          const pendingCommandExit = pendingCommand?.pollUnsafe()
          const independentTaskEligible =
            graphSnapshot.toWire().tasks.some(({ id }) => id === independentTaskId) &&
            [...fullRecovery.frontier.transitions, ...freshWorkflow.map(({ transition }) => transition)].some(
              (candidate) => isIndependentTaskProgress(candidate) || isGraphRefreshProgress(candidate)
            )
          const independentTaskSelected = records.some(
            ({ event }) =>
              event._tag === "TaskAttemptPlanned" &&
              plannedTaskAttemptEquivalence(event.operation.plannedAttempt, independentPlannedAttempt)
          )
          const journalStopStage = stopStage()
          const claimObservationsThisActivation = stoppedClaimObservationCount() - claimObservationBaseline
          const recoveryTransitions = [...currentRecovery.frontier.transitions, ...fullRecovery.frontier.transitions]
          const projectedStopStage =
            (journalStopStage === "StopWaiting" || journalStopStage === "ClaimReleaseRetryWait") &&
            claimObservationsThisActivation === 0 &&
            recoveryTransitions.some(({ _tag }) => _tag === "ObserveStoppedAttemptClaim")
              ? "NeedClaimObservation"
              : journalStopStage === "ClaimReleaseRetryWait" &&
                  claimObservationsThisActivation === 1 &&
                  recoveryTransitions.some(({ _tag }) => _tag === "ReleaseStoppedAttemptClaim")
                ? "NeedClaimRelease"
                : journalStopStage
          const replacementRecords = records.filter(({ event }) => event._tag === "PlannedAttemptReplaced")
          const replacement = replacementRecords.at(-1)?.event
          const replacementSuccessor =
            replacement?._tag === "PlannedAttemptReplaced" ? replacement.successorPlan.plannedAttempt : undefined
          const successorWorktreeIntent = records.findLast(
            ({ event }) =>
              event._tag === "TaskWorktreeReconciliationIntended" &&
              plannedTaskAttemptEquivalence(event.operation.plannedAttempt, successorAttempt)
          )?.event
          const successorWorktreeReady =
            successorWorktreeIntent?._tag === "TaskWorktreeReconciliationIntended" &&
            records.some(
              ({ event }) =>
                event._tag === "TaskWorktreeReady" &&
                event.operationId === successorWorktreeIntent.operation.operationId
            )
          const successorExecutorStartCount = records.filter(
            ({ event }) =>
              event._tag === "PlannedAttemptExecutorCommandIntended" &&
              event.command === "StartOrContinue" &&
              plannedTaskAttemptEquivalence(event.plannedAttempt, successorAttempt)
          ).length
          const successorExecutorResponsibilityBegan = records.some(
            ({ event }) =>
              event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
              plannedTaskAttemptEquivalence(event.plannedAttempt, successorAttempt)
          )
          const successorExecutorReport = records.findLast(
            ({ event }) =>
              event._tag === "PlannedAttemptExecutorWorkReported" &&
              event.report.correlation.attemptId === successorCorrelation.attemptId &&
              event.report.correlation.runId === successorCorrelation.runId
          )?.event
          const restartApplication = records.find(
            ({ event }) => event._tag === "AttemptChoiceApplied" && event.choice === "RestartTaskImplementation"
          )
          const lateTerminal = records.findLast(
            ({ event, position }) =>
              restartApplication !== undefined &&
              position > restartApplication.position &&
              event._tag === "PlannedAttemptExecutorWorkReported" &&
              event.report._tag === "Terminal"
          )?.event
          const lateAccepted =
            lateTerminal?._tag === "PlannedAttemptExecutorWorkReported" &&
            lateTerminal.report._tag === "Terminal" &&
            lateTerminal.report.result._tag === "Accepted"
          const completed =
            lateTerminal?._tag === "PlannedAttemptExecutorWorkReported" &&
            lateTerminal.report._tag === "Terminal" &&
            lateTerminal.report.result._tag === "Completed"
          const failed =
            lateTerminal?._tag === "PlannedAttemptExecutorWorkReported" &&
            lateTerminal.report._tag === "Terminal" &&
            lateTerminal.report.result._tag === "Failed"
          const lateAcceptedIntegrationResponsibilityCount = records.filter(
            ({ event, position }) =>
              restartApplication !== undefined &&
              position > restartApplication.position &&
              event._tag === "IntegrationResponsibilityBegan" &&
              event.plannedAttempt.attemptId === plannedAttempt.attemptId
          ).length
          return {
            appliedChoiceCount: BigInt(records.filter(({ event }) => event._tag === "AttemptChoiceApplied").length),
            authorizedFingerprint:
              choice?.choice === "ContinueExistingAttempt" || choice?.choice === "RestartTaskImplementation"
                ? fingerprintTag(choice.subject.observedTaskRevision)
                : "F1",
            claimObservation: observation,
            claimReleaseAuthorizedByExactRead: abandonment !== undefined && exactReleaseAuthority,
            claimReleaseCallCount: BigInt(releaseCallCount),
            claimReleaseCallCountAtNonExactObservation: BigInt(releaseCallCountAtNonExactObservation),
            claimRecoveryCount: BigInt(claimRecoveryCount),
            claimReleaseIntentRecorded: claimIntent !== undefined,
            claimReleaseResponseAmbiguous:
              claimIntent !== undefined && !claimReleased && stopStage() === "ClaimReleaseAmbiguous",
            claimResult: claimReleased
              ? "ExactClaimReleased"
              : noRelease?._tag === "StoppedAttemptClaimNoReleaseObserved"
                ? noRelease.observation._tag === "UnclaimedTask"
                  ? "NoReleaseAbsent"
                  : "NoReleaseForeign"
                : "NoClaimResult",
            cleanupSelected: cleanupTransitionSelected,
            continueStage: continueStage(),
            currentFingerprint: fingerprintTag(currentSpecification.fingerprint),
            evidencePreserved: artifactsPreserved,
            executorEvidence: executorEvidenceProjection(
              currentExecutorFailure,
              report,
              choice?.choice === "RestartTaskImplementation"
            ),
            f2WinningChoice:
              f2Choice?._tag === "AttemptChoiceApplied"
                ? f2Choice.choice === "ContinueExistingAttempt"
                  ? "ContinueChoice"
                  : f2Choice.choice === "RestartTaskImplementation"
                    ? "RestartChoice"
                    : "StopChoice"
                : "NoChoice",
            f3WinningChoice: records.some(
              ({ event }) =>
                event._tag === "AttemptChoiceApplied" &&
                event.subject.observedTaskRevision === specificationF3.fingerprint
            )
              ? "ContinueChoice"
              : "NoChoice",
            freshClaimExact: fresh.claim,
            freshExecutorExact: fresh.executor,
            freshGraphExact: fresh.graph,
            freshLineageExact: fresh.lineage,
            freshSpecificationExact: fresh.specification,
            freshWorktreeExact: fresh.worktree,
            implementationResponsibilityRetained:
              abandonment === undefined &&
              !records.some(({ event }) => event._tag === "PlannedAttemptReplaced") &&
              !(choice?.choice === "RestartTaskImplementation" && report?._tag === "Terminal"),
            independentTaskEligible,
            independentTaskSelected,
            integrationSelected: records.some(({ event }) => event._tag === "IntegrationStarted"),
            lastControlResult,
            lastSettledStopCommandOrdinal:
              latestSettled?._tag === "PlannedAttemptExecutorCommandProjectionObserved"
                ? BigInt(latestSettled.commandOrdinal)
                : latestRestartSuspendResponse?._tag === "PlannedAttemptExecutorWorkReported"
                  ? BigInt(latestRestartSuspendResponse.ordinal)
                  : 0n,
            logsPreserved: artifactsPreserved,
            positionHeld: (() => {
              const position = admissionSnapshot.positions.get(taskId)
              return (
                position !== undefined &&
                position._tag !== "PendingRuntimePosition" &&
                position.correlation.attemptId === correlation.attemptId &&
                position.correlation.runId === correlation.runId
              )
            })(),
            quiescenceUnbroken:
              (report?._tag === "SafelySuspended" || report?._tag === "Terminal") && !laterExecutorCommand,
            resumedAttempt: continueStage() === "ContinueResumed" ? "AttemptP" : "NoAttempt",
            sessionHistoryPreserved: artifactsPreserved,
            stopCommandCallCount: BigInt(suspensionCallCount),
            stopCommandIntentCount: BigInt(suspendIntents.length),
            stopCommandSettlementCount: BigInt(exactSuspendProjections.length + restartSuspendResponses.length),
            stopProjectionsThisActivation: BigInt(
              f2Choice?._tag === "AttemptChoiceApplied" && f2Choice.choice === "StopTaskImplementation"
                ? executorProjectionCount() - stopProjectionBaseline
                : 0
            ),
            stopRecoveryCount: BigInt(stopRecoveryCount),
            stopResponseAmbiguous:
              latestSuspend?._tag === "PlannedAttemptExecutorCommandIntended" &&
              !latestSuspendSettled &&
              suspensionCallCount > 0 &&
              pendingCommandExit !== undefined,
            stopStage: projectedStopStage,
            suspensionCommandCountSinceSafeEvidence: BigInt(
              suspendIntents.filter(
                ({ position }) => latestSafeEvidencePosition === undefined || position > latestSafeEvidencePosition
              ).length
            ),
            unresolvedClaimReleaseResponsibility:
              abandonment !== undefined && !claimReleased && noRelease === undefined,
            winningRequestId: choice === undefined ? { nonce: 0n, runId: 0n } : requestProjection(choice.requestId),
            wipPreserved: artifactsPreserved,
            worktreePreserved: artifactsPreserved,
            replacementPhase,
            replacementDisposition,
            replacementTaskFacts,
            replacementClaimFacts,
            replacementClaimReadsThisActivation: BigInt(replacementClaimReadsThisActivation),
            oldWorktreeFacts,
            replacementTargetHeadFacts,
            observedOldWorktreeHead,
            oldBaseB1IsAncestor,
            observedReplacementTargetHead,
            p1Unsettled: replacement === undefined,
            p1Superseded: replacement !== undefined,
            plannedSuccessor: replacement === undefined ? "NoPlannedSuccessor" : "PlannedP2",
            replacementEventRecorded: replacement !== undefined,
            replacementEventCount: BigInt(replacementRecords.length),
            successorAllocationCount: BigInt(replacementRecords.length),
            successorBaseHead: replacementSuccessor?.baseSha === replacementTargetHead ? "HeadH2Commit" : "NoGitCommit",
            successorBranchIdentity: replacementSuccessor?.branch === successorAttempt.branch ? "P2Branch" : "NoBranch",
            successorWorktreeIdentity:
              replacementSuccessor?.worktree === successorAttempt.worktree ? "W2Worktree" : "NoWorktree",
            successorCarriesP1Content:
              replacementSuccessor !== undefined &&
              (replacementSuccessor.branch === plannedAttempt.branch ||
                replacementSuccessor.worktree === plannedAttempt.worktree),
            successorWorktreeReady,
            successorAdmissionCount: BigInt(successorAdmissionCount),
            successorPositionHeld: (() => {
              const position = admissionSnapshot.positions.get(taskId)
              return (
                position !== undefined &&
                position._tag !== "PendingRuntimePosition" &&
                position.correlation.attemptId === successorCorrelation.attemptId &&
                position.correlation.runId === successorCorrelation.runId
              )
            })(),
            successorExecutorStartCount: BigInt(successorExecutorStartCount),
            successorExecutorResponsibilityRetained:
              successorExecutorResponsibilityBegan &&
              successorExecutorReport?._tag === "PlannedAttemptExecutorWorkReported" &&
              successorExecutorReport.report._tag === "Running",
            replacementProcessLossCount: BigInt(replacementProcessLossCount),
            completedResultPreserved: completed,
            failedResultPreserved: failed,
            lateAcceptedCommitPreserved: lateAccepted,
            lateAcceptedEvidencePreserved: lateAccepted,
            lateAcceptedIntegrationResponsibilityCount: BigInt(lateAcceptedIntegrationResponsibilityCount),
            p1BranchPreserved: plannedIdentityPreserved,
            p1CommitsPreserved: artifactsPreserved,
            p1JournalEvidencePreserved: plannedIdentityPreserved,
            replacementCleanupCallCount: 0n,
            replacementClaimMutationCallCount: 0n
          }
        })
    }
  }
)

const taskFactStateCheck = stateCheck(
  (raw) =>
    Schema.decodeUnknownEffect(SpecProjection)(raw).pipe(
      Effect.map(({ state }) => ({
        ...state,
        authorizedFingerprint: tag(state.authorizedFingerprint),
        claimObservation: tag(state.claimObservation),
        claimResult: tag(state.claimResult),
        continueStage: tag(state.continueStage),
        currentFingerprint: tag(state.currentFingerprint),
        executorEvidence: tag(state.executorEvidence),
        f2WinningChoice: tag(state.f2WinningChoice),
        f3WinningChoice: tag(state.f3WinningChoice),
        lastControlResult: tag(state.lastControlResult),
        oldWorktreeFacts: tag(state.oldWorktreeFacts),
        observedOldWorktreeHead: tag(state.observedOldWorktreeHead),
        observedReplacementTargetHead: tag(state.observedReplacementTargetHead),
        plannedSuccessor: tag(state.plannedSuccessor),
        replacementClaimFacts: tag(state.replacementClaimFacts),
        replacementDisposition: tag(state.replacementDisposition),
        replacementPhase: tag(state.replacementPhase),
        replacementTargetHeadFacts: tag(state.replacementTargetHeadFacts),
        replacementTaskFacts: tag(state.replacementTaskFacts),
        resumedAttempt: tag(state.resumedAttempt),
        successorBaseHead: tag(state.successorBaseHead),
        successorBranchIdentity: tag(state.successorBranchIdentity),
        successorWorktreeIdentity: tag(state.successorWorktreeIdentity),
        stopStage: tag(state.stopStage)
      })),
      Effect.orDie
    ),
  (spec, implementation) =>
    JSON.stringify(spec, (_, value) => (typeof value === "bigint" ? value.toString() : value)) ===
    JSON.stringify(implementation, (_, value) => (typeof value === "bigint" ? value.toString() : value))
)

quintIt(
  it.effect,
  "replays exact task-fact choices and recovery through production journal and authority seams",
  {
    backend: "typescript",
    driverFactory: taskFactReconciliationDriver,
    maxSamples: 100,
    maxSteps: 34,
    nTraces: 100,
    seed: "65",
    spec: "specs/taskFactReconciliation.qnt",
    step: "mbtStep",
    stateCheck: taskFactStateCheck
  },
  180_000
)

quintIt(
  it.effect,
  "replays clean changed-attempt replacement and rejection through production protocols",
  {
    backend: "typescript",
    driverFactory: taskFactReconciliationDriver,
    maxSamples: 200,
    maxSteps: 18,
    nTraces: 200,
    seed: "66",
    spec: "specs/taskFactReconciliation.qnt",
    step: "restartMbtStep",
    stateCheck: taskFactStateCheck
  },
  180_000
)

quintIt(
  it.effect,
  "replays the complete clean P2 worktree, bounded admission, and executor start path",
  {
    backend: "typescript",
    driverFactory: taskFactReconciliationDriver,
    maxSamples: 1,
    maxSteps: 12,
    nTraces: 1,
    seed: "6601",
    spec: "specs/taskFactReconciliation.qnt",
    step: "restartSuccessMbtStep",
    stateCheck: taskFactStateCheck
  },
  180_000
)

it.effect("requires command reconciliation before a generic executor-state projection", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.append(
      runId,
      plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
      PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({ plannedAttempt, version: workflowJournalEventVersion })
    )
    const commandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(1)
    yield* journal.append(
      runId,
      plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, commandOrdinal),
      PlannedAttemptExecutorCommandIntendedEvent.make({
        command: "Suspend",
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        ordinal: commandOrdinal,
        plannedAttempt,
        version: workflowJournalEventVersion
      })
    )
    let projectionCalls = 0
    const failure = yield* observePlannedAttemptExecutorState(plannedAttempt).pipe(
      Effect.provideService(
        PlannedAttemptExecutor,
        PlannedAttemptExecutor.of({
          project: () =>
            Effect.sync(() => {
              projectionCalls += 1
              return PlannedAttemptExecutorProjection.cases.Exact.make({
                report: PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation })
              })
            }),
          requestSuspension: () => Effect.die("unused suspension"),
          startOrContinue: () => Effect.die("unused continuation")
        })
      ),
      Effect.flip
    )
    const records = yield* journal.read(runId)

    expect(failure._tag).toBe("PlannedAttemptExecutorCommandReconciliationRequired")
    expect(projectionCalls).toBe(0)
    expect(records.some(({ event }) => event._tag === "PlannedAttemptExecutorStateObserved")).toBe(false)
  }).pipe(Effect.provide(legacyMemoryJournalStoreLayer), Effect.provide(plannedAttemptProtocolControllerLayer))
)

it("rejects a work report whose exact command intent is absent", () => {
  const reportOrdinal = PlannedAttemptExecutorReportOrdinal.make(1)
  const records: ReadonlyArray<JournalRecord> = [
    {
      event: PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
        plannedAttempt,
        version: workflowJournalEventVersion
      }),
      key: plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId),
      position: JournalPosition.make(1),
      runId
    },
    {
      event: PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: reportOrdinal,
        report: PlannedAttemptExecutorReport.cases.Running.make({ correlation }),
        version: workflowJournalEventVersion
      }),
      key: plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, reportOrdinal),
      position: JournalPosition.make(2),
      runId
    }
  ]
  const reduction = reduceWorkflowJournalHistory(runId, records)

  expect(reduction).toMatchObject({
    _tag: "InvalidWorkflowJournalHistory",
    issues: expect.arrayContaining([
      expect.objectContaining({ detail: expect.stringContaining("has no outstanding command intent") })
    ])
  })
})
