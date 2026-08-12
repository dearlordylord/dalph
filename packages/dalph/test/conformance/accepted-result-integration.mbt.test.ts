import { it } from "@effect/vitest"
import { NodeServices } from "@effect/platform-node"
import { defineDriver, ITFBigInt, ITFMap, stateCheck } from "@firfi/quint-connect/effect"
import { quintIt } from "@firfi/quint-connect/vitest"
import {
  AcceptedResult,
  AttemptId,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedAttemptExecutorReport,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import {
  CandidateContinuationLimit,
  CandidateCorrectionLimit,
  AttemptChoiceAppliedEvent,
  AttemptChoiceRequestId,
  attemptChoiceAppliedRecordKey,
  continueIntegrationCandidateConstruction,
  deriveIntegrationAdmission,
  deriveIntegrationCandidateConstruction,
  describeJournalEvent,
  InRunJournal,
  IntegrationCandidateAgent,
  IntegrationCandidateAgentReport,
  IntegrationCandidateCorrelation,
  IntegrationCandidateGit,
  IntegrationCandidateGitObservation,
  IntegrationCandidateGitReadFailure,
  IntegrationCandidateId,
  IntegrationCandidateResourceLocator,
  IntegrationSessionId,
  EvidenceDigest,
  EvidenceReference,
  EvidenceStore,
  EvidenceStoreFailure,
  integrationCandidateCorrelationEquals,
  integrationCandidateHasExactParents,
  makeIntegrationTargetResourceController,
  memoryEvidenceStoreLayer,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent,
  queueAcceptedResultIntegrationResponsibility,
  selectStartableIntegrationResponsibilities,
  startQueuedIntegration,
  TargetVerificationArtifactName,
  TargetVerificationBoundary,
  TargetVerificationBoundaryFailure,
  TargetVerificationCorrelation,
  TargetVerificationIntendedEvent,
  TargetVerificationPlan,
  TargetVerificationPlanId,
  TargetVerificationTerminal,
  TargetLineageObservation,
  deriveTargetVerificationState,
  runTargetVerification,
  targetVerificationCorrelationFor,
  targetVerificationIntentRecordKey,
  targetVerificationRequestIdForCandidate,
  TargetPromotionCompareAndSetFailure,
  TargetPromotionAttemptIntendedEvent,
  TargetPromotionAttemptOrdinal,
  TargetPromotionAttemptReason,
  type TargetPromotionCompareAndSetResult,
  TargetPromotionGit,
  TargetPromotionGitReadFailure,
  TargetPromotionGitReadObservation,
  TargetPromotionIntendedEvent,
  TargetPromotionVerification,
  deriveTargetPromotionState,
  runTargetPromotion,
  targetPromotionAttemptIntentRecordKey,
  targetPromotionIntentRecordKey,
  targetPromotionRequestFor,
  workflowJournalEventVersion,
  type IntegrationCandidateAgentReport as CandidateReport,
  type IntegrationCandidateGitObservation as CandidateGitObservation,
  type IntegrationCandidateConstructionState,
  type IntegrationTargetResourceController,
  type JournalRecord,
  type QueuedIntegrationResponsibility,
  type StartedIntegrationResponsibility,
  type TargetPromotionRequest
} from "@dalph/orchestrator"
import { Effect, Layer, Match, Schema } from "effect"

const runId = RunId.make("accepted-result-integration-model-run")
const target = IntegrationTarget.make({
  repository: GitRepositoryLocator.make("/repositories/accepted-result-integration.git"),
  ref: IntegrationTargetRef.make("refs/heads/master")
})
const independentTarget = IntegrationTarget.make({
  repository: GitRepositoryLocator.make("/repositories/accepted-result-integration-independent.git"),
  ref: IntegrationTargetRef.make("refs/heads/master")
})
const correctionLimit = CandidateCorrectionLimit.make(1)
const continuationLimit = CandidateContinuationLimit.make(2)
const verificationPlanFor = (id: bigint) =>
  TargetVerificationPlan.make({ planId: TargetVerificationPlanId.make(`model-public-plan-${id}`), target })
const restartRequestId = AttemptChoiceRequestId.make({ nonce: "accepted-result-model-restart", runId })

const commitOf = (value: bigint | number): GitCommitSha =>
  GitCommitSha.make(BigInt(value).toString(16).padStart(40, "0"))

const attempts = new Map(
  [1, 2].map((id) => [
    BigInt(id),
    PlannedTaskAttempt.make({
      attemptId: AttemptId.make(`accepted-result-integration-attempt-${id}`),
      baseSha: commitOf(id),
      branch: TaskBranchRef.make(`refs/heads/dalph/accepted-result-integration-${id}`),
      executor: TaskExecutorLocator.make("executor:model"),
      runId,
      taskId: TaskId.make(`accepted-result-integration-task-${id}`),
      taskRevision: TaskRevision.make(`accepted-result-integration-revision-${id}`),
      worktree: WorktreeLocator.make(`/worktrees/accepted-result-integration-${id}`)
    })
  ])
)

const acceptedResultOf = (id: bigint): AcceptedResult =>
  AcceptedResult.make({
    commit: commitOf(id + 20n),
    evidenceManifest: EvidenceReference.make({
      byteLength: 1,
      digest: EvidenceDigest.make(id.toString(16).padStart(64, "0"))
    })
  })

const SpecResult = Schema.Struct({
  acceptedEvidencePreserved: Schema.Boolean,
  acceptedResultCommit: ITFBigInt,
  candidateJournalPosition: ITFBigInt,
  continuationCount: ITFBigInt,
  correctionCount: ITFBigInt,
  expectedTargetHead: ITFBigInt,
  integrationResponsibilityCount: ITFBigInt,
  integrationResponsibilityRecorded: Schema.Boolean,
  integrationTarget: ITFBigInt,
  integrationSession: ITFBigInt,
  observedFirstParent: ITFBigInt,
  observedSecondParent: ITFBigInt,
  phase: Schema.Unknown,
  preIntegrationCancellation: Schema.Boolean,
  queuePosition: ITFBigInt,
  submittedCandidate: ITFBigInt,
  targetHeld: Schema.Boolean,
  verificationEvidenceReread: Schema.Boolean,
  verificationIntentRecorded: Schema.Boolean,
  verificationManifestSealed: Schema.Boolean,
  verificationOutcome: Schema.Unknown,
  verificationRequest: Schema.Struct({
    acceptedResult: ITFBigInt,
    candidate: ITFBigInt,
    candidatePosition: ITFBigInt,
    integrationSession: ITFBigInt,
    plan: ITFBigInt,
    requestId: ITFBigInt,
    target: ITFBigInt
  }),
  wrapperInvocationCount: ITFBigInt,
  reconciliationCount: ITFBigInt,
  promotionAuthorized: Schema.Boolean,
  verificationReplacementCount: ITFBigInt,
  promotionIntentRecorded: Schema.Boolean,
  promotionAttemptCount: ITFBigInt,
  promotionLastAttempt: ITFBigInt,
  promotionFreshExactHeadReads: ITFBigInt,
  promotionFreshExactHeadObservation: Schema.Boolean,
  promotionTargetFactsCurrent: Schema.Boolean,
  promotionExpectedHeadVerified: Schema.Boolean,
  promotionGitObservation: Schema.Unknown,
  promotionObservedTargetHead: ITFBigInt,
  promotionCandidateAncestryProven: Schema.Boolean,
  promotionResultRecorded: Schema.Boolean,
  promotionResponseAmbiguous: Schema.Boolean,
  promotionCompareAndSetRequested: Schema.Boolean,
  promotionForceRequested: Schema.Boolean,
  promotionEquivalentContentAccepted: Schema.Boolean,
  restartChoiceCommittedBeforeTerminal: Schema.Boolean
})

const SpecProjection = Schema.Struct({
  state: Schema.Struct({
    nextJournalPosition: ITFBigInt,
    recovered: Schema.Boolean,
    results: ITFMap(ITFBigInt, SpecResult),
    restartCount: ITFBigInt,
    targetFactsCurrent: Schema.Boolean,
    targetHeadProof: ITFBigInt,
    targetReacquisitionRequired: Schema.Boolean,
    trackerFactsCurrent: Schema.Boolean
  })
})

const variantTag = (value: unknown): string =>
  typeof value === "object" && value !== null && "tag" in value ? String(value.tag) : String(value)

const idFor = (value: bigint): PlannedTaskAttempt => {
  const attempt = attempts.get(value)
  return attempt === undefined ? Effect.runSync(Effect.die(`unknown model result ${value}`)) : attempt
}

const numericCommit = (sha: GitCommitSha | undefined): bigint => (sha === undefined ? 0n : BigInt(`0x${sha}`))

type Phase =
  | "NoAcceptedResult"
  | "AcceptedResult"
  | "LateAcceptedEvidence"
  | "Queued"
  | "Started"
  | "DependencyWait"
  | "CandidatePending"
  | "CorrectionRequired"
  | "CandidateReady"
  | "CorrectionLimitReached"
  | "ContinuationLimitReached"
  | "CorrelationContradiction"
  | "CorrelationContradictionReleased"
  | "VerificationIntent"
  | "VerificationInvoked"
  | "VerificationResponseLost"
  | "VerificationReconciling"
  | "VerificationPassedPendingSeal"
  | "VerificationPassed"
  | "VerificationFailed"
  | "VerificationKilled"
  | "VerificationTimedOut"
  | "VerificationPartial"
  | "VerificationCorrelationContradiction"
  | "VerificationEvidenceFailure"
  | "PromotionPremise"
  | "PromotionIntent"
  | "PromotionAttemptIntended"
  | "PromotionInFlight"
  | "PromotionResponseLost"
  | "PromotionReconciliation"
  | "PromotionRetryReady"
  | "PromotionReadPending"
  | "PromotionSucceeded"
  | "PromotionStale"
  | "PromotionExhausted"

type PromotionGitObservation =
  | "NoPromotionGitObservation"
  | "PromotionExactExpectedHead"
  | "PromotionCandidateCurrent"
  | "PromotionCandidateAncestor"
  | "PromotionOtherHead"
  | "PromotionUnreadableHead"

type VerificationOutcome = "NoVerificationOutcome" | "Passed" | "Failed" | "Killed" | "TimedOut" | "Partial"

type VerificationRequest = {
  requestId: bigint
  acceptedResult: bigint
  candidate: bigint
  candidatePosition: bigint
  integrationSession: bigint
  target: bigint
  plan: bigint
}

type ModelResult = {
  acceptedEvidencePreserved: boolean
  phase: Phase
  queuePosition: bigint
  preIntegrationCancellation: boolean
  targetHeld: boolean
  integrationSession: bigint
  submittedCandidate: bigint
  candidateJournalPosition: bigint
  expectedTargetHead: bigint
  integrationTarget: bigint
  integrationResponsibilityCount: bigint
  integrationResponsibilityRecorded: boolean
  acceptedResultCommit: bigint
  observedFirstParent: bigint
  observedSecondParent: bigint
  correctionCount: bigint
  continuationCount: bigint
  verificationRequest: VerificationRequest
  verificationOutcome: VerificationOutcome
  verificationIntentRecorded: boolean
  wrapperInvocationCount: bigint
  reconciliationCount: bigint
  verificationEvidenceReread: boolean
  verificationManifestSealed: boolean
  promotionAuthorized: boolean
  verificationReplacementCount: bigint
  promotionIntentRecorded: boolean
  promotionAttemptCount: bigint
  promotionLastAttempt: bigint
  promotionFreshExactHeadReads: bigint
  promotionFreshExactHeadObservation: boolean
  promotionTargetFactsCurrent: boolean
  promotionExpectedHeadVerified: boolean
  promotionGitObservation: PromotionGitObservation
  promotionObservedTargetHead: bigint
  promotionCandidateAncestryProven: boolean
  promotionResultRecorded: boolean
  promotionResponseAmbiguous: boolean
  promotionCompareAndSetRequested: boolean
  promotionForceRequested: boolean
  promotionEquivalentContentAccepted: boolean
  restartChoiceCommittedBeforeTerminal: boolean
}

const initialModelResult = (id: bigint): ModelResult => ({
  acceptedEvidencePreserved: false,
  phase: "NoAcceptedResult",
  queuePosition: 0n,
  preIntegrationCancellation: false,
  targetHeld: false,
  integrationSession: 0n,
  submittedCandidate: 0n,
  candidateJournalPosition: 0n,
  expectedTargetHead: 0n,
  integrationTarget: 1n,
  integrationResponsibilityCount: 0n,
  integrationResponsibilityRecorded: false,
  acceptedResultCommit: id + 20n,
  observedFirstParent: 0n,
  observedSecondParent: 0n,
  correctionCount: 0n,
  continuationCount: 0n,
  verificationRequest: {
    requestId: 0n,
    acceptedResult: 0n,
    candidate: 0n,
    candidatePosition: 0n,
    integrationSession: 0n,
    target: 0n,
    plan: 0n
  },
  verificationOutcome: "NoVerificationOutcome",
  verificationIntentRecorded: false,
  wrapperInvocationCount: 0n,
  reconciliationCount: 0n,
  verificationEvidenceReread: false,
  verificationManifestSealed: false,
  promotionAuthorized: false,
  verificationReplacementCount: 0n,
  promotionIntentRecorded: false,
  promotionAttemptCount: 0n,
  promotionLastAttempt: 0n,
  promotionFreshExactHeadReads: 0n,
  promotionFreshExactHeadObservation: false,
  promotionTargetFactsCurrent: false,
  promotionExpectedHeadVerified: false,
  promotionGitObservation: "NoPromotionGitObservation",
  promotionObservedTargetHead: 0n,
  promotionCandidateAncestryProven: false,
  promotionResultRecorded: false,
  promotionResponseAmbiguous: false,
  promotionCompareAndSetRequested: false,
  promotionForceRequested: false,
  promotionEquivalentContentAccepted: false,
  restartChoiceCommittedBeforeTerminal: false
})

const phaseFor = (
  accepted: boolean,
  queued: QueuedIntegrationResponsibility | StartedIntegrationResponsibility | undefined,
  candidate: IntegrationCandidateConstructionState | undefined,
  dependencyWait: boolean,
  contradictionReleased: boolean
): Phase => {
  if (!accepted) return "NoAcceptedResult"
  if (queued === undefined) return "AcceptedResult"
  if (queued._tag === "QueuedIntegrationResponsibility") return "Queued"
  if (dependencyWait) return "DependencyWait"
  if (contradictionReleased) return "CorrelationContradictionReleased"
  return Match.value(candidate).pipe(
    Match.when(undefined, (): Phase => "Started"),
    Match.tags({
      CandidateConstructionInProgress: (): Phase => "Started",
      CandidateValidationPending: (): Phase => "CandidatePending",
      CandidateCorrectionRequired: (): Phase => "CorrectionRequired",
      CandidateConstructed: (): Phase => "CandidateReady",
      CandidateCorrectionLimitReached: (): Phase => "CorrectionLimitReached",
      CandidateContinuationLimitReached: (): Phase => "ContinuationLimitReached",
      CandidateCorrelationContradiction: (): Phase => "CorrelationContradiction"
    }),
    Match.exhaustive
  )
}

type PromotionCasStep = TargetPromotionCompareAndSetResult | TargetPromotionCompareAndSetFailure
type PromotionReadStep = TargetPromotionGitReadObservation | TargetPromotionGitReadFailure

type PromotionBoundaryObservation =
  | { readonly _tag: "NoPromotionGitObservation" }
  | { readonly _tag: "PromotionExactExpectedHead"; readonly head: bigint }
  | { readonly _tag: "PromotionCandidateCurrent"; readonly head: bigint }
  | { readonly _tag: "PromotionCandidateAncestor"; readonly head: bigint }
  | { readonly _tag: "PromotionOtherHead"; readonly head: bigint }
  | { readonly _tag: "PromotionUnreadableHead" }

const acceptedResultIntegrationDriver = defineDriver(
  {
    acceptResultOne: {},
    acceptResultTwo: {},
    gitReadFailsOne: {},
    gitReadFailsTwo: {},
    init: {},
    observeAppliedRestartBeforeAcceptedOne: {},
    observeExactCandidateOne: {},
    observeExactCandidateTwo: {},
    observeInvalidCandidateOne: {},
    observeInvalidCandidateTwo: {},
    observeTargetFactsOne: {},
    observeTargetFactsTwo: {},
    observeTrackerFacts: {},
    queueAcceptedResultOne: {},
    queueAcceptedResultTwo: {},
    reacquireIntegrationTargetOne: {},
    reacquireIntegrationTargetTwo: {},
    recoverCoordinatorStep: {},
    releaseForeignCorrelationTargetOne: {},
    releaseForeignCorrelationTargetTwo: {},
    reportForeignCorrelationOne: {},
    reportForeignCorrelationTwo: {},
    recordVerificationIntentOne: {},
    invokeVerificationOne: {},
    loseVerificationResponseOne: {},
    reconcileVerificationOne: {},
    reportVerificationPassedOne: {},
    rereadAndSealPassedVerificationOne: {},
    reportVerificationFailedOne: {},
    reportVerificationKilledOne: {},
    reportVerificationTimedOutOne: {},
    reportVerificationPartialOne: {},
    reportVerificationCorrelationContradictionOne: {},
    reportVerificationEvidenceFailureOne: {},
    offerPromotionPremiseOne: {},
    recordPromotionIntentOne: {},
    recordPromotionAttemptIntentOne: {},
    sendPromotionAttemptOne: {},
    losePromotionAttemptResponseOne: {},
    reconcilePromotionOne: {},
    observePromotionCandidateCurrentOne: {},
    observePromotionCandidateAncestorOne: {},
    observePromotionExactExpectedHeadOne: {},
    observePromotionOtherHeadOne: {},
    observePromotionGitUnreadableOne: {},
    assignResultTwoIndependentTargetOne: {},
    reportWithoutCandidateOne: {},
    reportWithoutCandidateTwo: {},
    startIntegrationOne: {},
    startIntegrationTwo: {},
    submitCandidateOne31: {},
    submitCandidateOne32: {},
    submitCandidateTwo31: {},
    submitCandidateTwo32: {},
    waitOnDependencyOne: {},
    waitOnDependencyTwo: {}
  },
  () => {
    let records: ReadonlyArray<JournalRecord> = []
    let nextAgentReport: CandidateReport | undefined
    let nextGitResult: CandidateGitObservation | IntegrationCandidateGitReadFailure | undefined
    let resources: IntegrationTargetResourceController | undefined
    let recovered = false
    let trackerFactsCurrent = true
    let modelNextJournalPosition = 1n
    let modelRestartCount = 0n
    let modelTargetFactsCurrent = true
    let modelTargetHeadProof = 0n
    let modelTargetReacquisitionRequired = false
    let modelResults = new Map<bigint, ModelResult>([...attempts.keys()].map((id) => [id, initialModelResult(id)]))
    let dependencyWaits = new Set<bigint>()
    let releasedContradictions = new Set<bigint>()
    let stagedVerificationOutcome:
      | "Passed"
      | "Failed"
      | "Killed"
      | "TimedOut"
      | "Partial"
      | "CorrelationContradiction"
      | undefined
    let verificationBoundaryMode: "ResponseLost" | "ReturnStaged" = "ResponseLost"
    let verificationRequestsSeen: ReadonlyArray<TargetVerificationCorrelation> = []
    let verificationReconciliations = new Map<bigint, bigint>()
    let failVerificationEvidenceRead = false
    let promotionCasSteps: ReadonlyArray<PromotionCasStep> = []
    let promotionReadSteps: ReadonlyArray<PromotionReadStep> = []
    let promotionFreshExactHeadReads = new Map<bigint, bigint>()
    let promotionLatestObservation = new Map<bigint, PromotionBoundaryObservation>()
    let promotionTargetFacts = new Map<bigint, boolean>()
    let promotionReadAccounting: "Count" | "Skip" = "Count"
    let independentTargetTwo = false

    const modelResultFor = (id: bigint): ModelResult => {
      const result = modelResults.get(id)
      return result === undefined ? Effect.runSync(Effect.die(`unknown model result ${id}`)) : result
    }
    const updateModelResult = (id: bigint, update: (result: ModelResult) => ModelResult): void => {
      modelResults = new Map(modelResults).set(id, update(modelResultFor(id)))
    }
    const updateModelResults = (update: (result: ModelResult) => ModelResult): void => {
      modelResults = new Map([...modelResults].map(([id, result]) => [id, update(result)]))
    }
    const resetModelState = (): void => {
      modelNextJournalPosition = 1n
      modelRestartCount = 0n
      modelTargetFactsCurrent = true
      modelTargetHeadProof = 0n
      modelTargetReacquisitionRequired = false
      modelResults = new Map([...attempts.keys()].map((id) => [id, initialModelResult(id)]))
    }
    const modelObserveAppliedRestartBeforeAccepted = (id: bigint): void => {
      updateModelResult(id, (result) => ({ ...result, restartChoiceCommittedBeforeTerminal: true }))
    }
    const modelAcceptResult = (id: bigint): void => {
      updateModelResult(id, (result) => ({
        ...result,
        acceptedEvidencePreserved: true,
        phase: result.restartChoiceCommittedBeforeTerminal ? "LateAcceptedEvidence" : "AcceptedResult"
      }))
    }
    const modelQueueAcceptedResult = (id: bigint): void => {
      const queuePosition = modelNextJournalPosition
      modelNextJournalPosition += 1n
      updateModelResult(id, (result) => ({
        ...result,
        integrationResponsibilityCount: 1n,
        integrationResponsibilityRecorded: true,
        phase: "Queued",
        queuePosition,
        preIntegrationCancellation: true
      }))
    }
    const modelStartIntegration = (id: bigint): void => {
      const expectedTargetHead = id + 10n
      updateModelResult(id, (result) => ({
        ...result,
        phase: "Started",
        preIntegrationCancellation: false,
        targetHeld: true,
        integrationSession: id,
        expectedTargetHead
      }))
      modelTargetHeadProof = expectedTargetHead
      modelTargetReacquisitionRequired = anotherResultRequiresTargetReacquisition(id)
    }
    const modelSubmitCandidate = (id: bigint, candidate: bigint): void => {
      updateModelResult(id, (result) => ({
        ...result,
        phase: "CandidatePending",
        submittedCandidate: candidate,
        candidateJournalPosition: 0n,
        observedFirstParent: 0n,
        observedSecondParent: 0n
      }))
    }
    const modelObserveExactCandidate = (id: bigint): void => {
      const candidateJournalPosition = modelNextJournalPosition
      modelNextJournalPosition += 1n
      updateModelResult(id, (result) => ({
        ...result,
        phase: "CandidateReady",
        observedFirstParent: result.expectedTargetHead,
        observedSecondParent: result.acceptedResultCommit,
        candidateJournalPosition
      }))
    }
    const modelObserveInvalidCandidate = (id: bigint): void => {
      updateModelResult(id, (result) => {
        const exhausted = result.correctionCount >= 1n
        return {
          ...result,
          phase: exhausted ? "CorrectionLimitReached" : "CorrectionRequired",
          correctionCount: exhausted ? result.correctionCount : result.correctionCount + 1n,
          observedFirstParent: 99n,
          observedSecondParent: 98n,
          targetHeld: !exhausted
        }
      })
    }
    const modelGitReadFails = (): void => {
      // The Quint action is an explicit stutter: no model state changes.
    }
    const modelReportWithoutCandidate = (id: bigint): void => {
      updateModelResult(id, (result) => {
        const continuationCount = result.continuationCount + 1n
        return {
          ...result,
          continuationCount,
          phase: continuationCount >= 2n ? "ContinuationLimitReached" : result.phase,
          targetHeld: continuationCount >= 2n ? false : result.targetHeld
        }
      })
    }
    const modelReportForeignCorrelation = (id: bigint): void => {
      updateModelResult(id, (result) => ({ ...result, phase: "CorrelationContradiction", targetHeld: true }))
    }
    const modelReleaseForeignCorrelationTarget = (id: bigint): void => {
      updateModelResult(id, (result) => ({ ...result, phase: "CorrelationContradictionReleased", targetHeld: false }))
    }
    const modelWaitOnDependency = (id: bigint): void => {
      updateModelResult(id, (result) => ({ ...result, phase: "DependencyWait", targetHeld: false }))
    }
    const modelRecoverCoordinator = (): void => {
      const terminalPromotionPhases = new Set<Phase>(["PromotionSucceeded", "PromotionStale", "PromotionExhausted"])
      const requiresFreshAuthorityFacts = [...modelResults.values()].some(
        (result) =>
          result.phase !== "NoAcceptedResult" &&
          result.phase !== "LateAcceptedEvidence" &&
          !terminalPromotionPhases.has(result.phase)
      )
      updateModelResults((result) => ({
        ...result,
        phase:
          result.phase === "CorrelationContradictionReleased"
            ? "CorrelationContradiction"
            : result.phase === "PromotionAttemptIntended" ||
                result.phase === "PromotionInFlight" ||
                result.phase === "PromotionReconciliation" ||
                result.phase === "PromotionRetryReady"
              ? "PromotionResponseLost"
              : result.phase === "PromotionReadPending"
                ? result.promotionAttemptCount === 0n
                  ? "PromotionIntent"
                  : "PromotionResponseLost"
                : result.phase,
        promotionTargetFactsCurrent: result.phase.startsWith("Promotion") ? false : result.promotionTargetFactsCurrent,
        targetHeld: false
      }))
      recovered = true
      modelRestartCount += 1n
      if (requiresFreshAuthorityFacts) {
        trackerFactsCurrent = false
        modelTargetFactsCurrent = false
        modelTargetHeadProof = 0n
      }
      modelTargetReacquisitionRequired = requiresFreshAuthorityFacts
    }
    const modelObserveTrackerFacts = (): void => {
      trackerFactsCurrent = true
    }
    const modelObserveTargetFacts = (id: bigint): void => {
      const result = modelResultFor(id)
      modelTargetFactsCurrent = true
      modelTargetHeadProof = result.expectedTargetHead === 0n ? id + 10n : result.expectedTargetHead
      if (result.phase.startsWith("Promotion")) {
        updateModelResult(id, (current) => ({ ...current, promotionTargetFactsCurrent: true }))
      }
    }
    const anotherResultRequiresTargetReacquisition = (id: bigint): boolean =>
      [...modelResults].some(
        ([other, result]) =>
          other !== id &&
          !result.targetHeld &&
          [
            "Started",
            "CandidatePending",
            "CorrectionRequired",
            "CandidateReady",
            "VerificationIntent",
            "VerificationInvoked",
            "VerificationResponseLost",
            "VerificationReconciling",
            "VerificationPassedPendingSeal",
            "PromotionIntent"
          ].includes(result.phase)
      )
    const modelReacquireIntegrationTarget = (id: bigint): void => {
      updateModelResult(id, (result) => ({ ...result, targetHeld: true }))
      modelTargetReacquisitionRequired = anotherResultRequiresTargetReacquisition(id)
    }
    const modelRecordVerificationIntent = (id: bigint): void => {
      updateModelResult(id, (result) => ({
        ...result,
        phase: "VerificationIntent",
        verificationRequest: {
          requestId: id * 1000n + result.submittedCandidate,
          acceptedResult: result.acceptedResultCommit,
          candidate: result.submittedCandidate,
          candidatePosition: result.candidateJournalPosition,
          integrationSession: result.integrationSession,
          target: 1n,
          plan: 7000n + id
        },
        verificationOutcome: "NoVerificationOutcome",
        verificationIntentRecorded: true,
        wrapperInvocationCount: 0n,
        reconciliationCount: 0n,
        verificationEvidenceReread: false,
        verificationManifestSealed: false,
        promotionAuthorized: false
      }))
    }
    const modelInvokeVerification = (id: bigint): void => {
      updateModelResult(id, (result) => ({ ...result, phase: "VerificationInvoked", wrapperInvocationCount: 1n }))
    }
    const modelLoseVerificationResponse = (id: bigint): void => {
      updateModelResult(id, (result) => ({ ...result, phase: "VerificationResponseLost" }))
    }
    const modelReconcileVerification = (id: bigint): void => {
      updateModelResult(id, (result) => ({
        ...result,
        phase: "VerificationReconciling",
        reconciliationCount: result.reconciliationCount + 1n
      }))
    }
    const modelReportVerificationPassed = (id: bigint): void => {
      updateModelResult(id, (result) => ({
        ...result,
        phase: "VerificationPassedPendingSeal",
        verificationOutcome: "Passed",
        verificationEvidenceReread: false,
        verificationManifestSealed: false,
        promotionAuthorized: false
      }))
    }
    const modelRereadAndSealPassedVerification = (id: bigint): void => {
      updateModelResult(id, (result) => ({
        ...result,
        phase: "VerificationPassed",
        verificationEvidenceReread: true,
        verificationManifestSealed: true,
        promotionAuthorized: true,
        targetHeld: false
      }))
    }
    const modelReportDiagnostic = (id: bigint, phase: Phase, outcome: VerificationOutcome): void => {
      updateModelResult(id, (result) => ({
        ...result,
        phase,
        verificationOutcome: outcome,
        verificationEvidenceReread: true,
        verificationManifestSealed: true,
        promotionAuthorized: false,
        targetHeld: false
      }))
    }
    const modelReportVerificationBoundaryFailure = (id: bigint, phase: Phase): void => {
      updateModelResult(id, (result) => ({
        ...result,
        phase,
        verificationOutcome: "NoVerificationOutcome",
        verificationEvidenceReread: false,
        verificationManifestSealed: false,
        promotionAuthorized: false,
        targetHeld: false
      }))
    }
    const modelOfferPromotionPremise = (id: bigint): void => {
      updateModelResult(id, (result) => ({ ...result, phase: "PromotionPremise" }))
    }
    const modelRecordPromotionIntent = (id: bigint): void => {
      updateModelResult(id, (result) => ({
        ...result,
        phase: "PromotionIntent",
        targetHeld: true,
        promotionIntentRecorded: true,
        promotionAttemptCount: 0n,
        promotionLastAttempt: 0n,
        promotionFreshExactHeadReads: 0n,
        promotionFreshExactHeadObservation: false,
        promotionTargetFactsCurrent: false,
        promotionExpectedHeadVerified: true,
        promotionGitObservation: "NoPromotionGitObservation",
        promotionObservedTargetHead: 0n,
        promotionCandidateAncestryProven: false,
        promotionResultRecorded: false,
        promotionResponseAmbiguous: false,
        promotionCompareAndSetRequested: false,
        promotionForceRequested: false,
        promotionEquivalentContentAccepted: false
      }))
    }
    const modelRecordPromotionAttemptIntent = (id: bigint): void => {
      updateModelResult(id, (result) => ({
        ...result,
        phase: "PromotionAttemptIntended",
        promotionAttemptCount: result.promotionAttemptCount + 1n,
        promotionLastAttempt: result.promotionLastAttempt + 1n,
        promotionFreshExactHeadObservation: false,
        promotionGitObservation: "NoPromotionGitObservation",
        promotionObservedTargetHead: 0n,
        promotionResponseAmbiguous: false,
        promotionCompareAndSetRequested: false,
        promotionForceRequested: false,
        promotionEquivalentContentAccepted: false
      }))
    }
    const modelSendPromotionAttempt = (id: bigint): void => {
      updateModelResult(id, (result) => ({
        ...result,
        phase: "PromotionInFlight",
        promotionCompareAndSetRequested: true
      }))
    }
    const modelLosePromotionResponse = (id: bigint): void => {
      updateModelResult(id, (result) => ({
        ...result,
        phase: "PromotionResponseLost",
        targetHeld: false,
        promotionFreshExactHeadObservation: false,
        promotionTargetFactsCurrent: false,
        promotionGitObservation: "NoPromotionGitObservation",
        promotionObservedTargetHead: 0n,
        promotionResponseAmbiguous: true
      }))
    }
    const modelReconcilePromotion = (id: bigint): void => {
      updateModelResult(id, (result) => ({
        ...result,
        phase: "PromotionReconciliation",
        targetHeld: true,
        promotionFreshExactHeadObservation: false,
        promotionTargetFactsCurrent: false,
        promotionGitObservation: "NoPromotionGitObservation",
        promotionObservedTargetHead: 0n
      }))
    }
    const modelObservePromotionCandidateCurrent = (id: bigint): void => {
      updateModelResult(id, (result) => ({
        ...result,
        phase: "PromotionSucceeded",
        targetHeld: false,
        promotionGitObservation: "PromotionCandidateCurrent",
        promotionObservedTargetHead: result.submittedCandidate,
        promotionCandidateAncestryProven: true,
        promotionResultRecorded: true,
        promotionResponseAmbiguous: false
      }))
    }
    const modelObservePromotionCandidateAncestor = (id: bigint): void => {
      updateModelResult(id, (result) => ({
        ...result,
        phase: "PromotionSucceeded",
        targetHeld: false,
        promotionGitObservation: "PromotionCandidateAncestor",
        promotionObservedTargetHead: result.submittedCandidate + 100n,
        promotionCandidateAncestryProven: true,
        promotionResultRecorded: true,
        promotionResponseAmbiguous: false
      }))
    }
    const modelObservePromotionExactExpectedHead = (id: bigint): void => {
      updateModelResult(id, (result) => {
        const reads = result.promotionFreshExactHeadReads + 1n
        const exhausted = result.promotionAttemptCount >= 3n
        return {
          ...result,
          phase: exhausted ? "PromotionExhausted" : "PromotionRetryReady",
          targetHeld: !exhausted,
          promotionFreshExactHeadReads: reads,
          promotionFreshExactHeadObservation: true,
          promotionTargetFactsCurrent: true,
          promotionExpectedHeadVerified: true,
          promotionGitObservation: "PromotionExactExpectedHead",
          promotionObservedTargetHead: result.expectedTargetHead,
          promotionResultRecorded: false,
          promotionResponseAmbiguous: false
        }
      })
    }
    const modelObservePromotionOtherHead = (id: bigint): void => {
      updateModelResult(id, (result) => ({
        ...result,
        phase: "PromotionStale",
        targetHeld: false,
        promotionGitObservation: "PromotionOtherHead",
        promotionObservedTargetHead: result.expectedTargetHead + 1n,
        promotionCandidateAncestryProven: false,
        promotionResultRecorded: true,
        promotionResponseAmbiguous: false
      }))
    }
    const modelObservePromotionGitUnreadable = (id: bigint): void => {
      updateModelResult(id, (result) => ({
        ...result,
        phase: result.promotionAttemptCount >= 3n ? "PromotionExhausted" : "PromotionReadPending",
        targetHeld: false,
        promotionTargetFactsCurrent: false,
        promotionGitObservation: "PromotionUnreadableHead",
        promotionObservedTargetHead: 0n,
        promotionCandidateAncestryProven: false,
        promotionResultRecorded: false
      }))
    }
    const modelAssignResultTwoIndependentTarget = (): void => {
      independentTargetTwo = true
      updateModelResult(2n, (result) => ({ ...result, integrationTarget: 2n }))
    }

    const append = InRunJournal.of({
      append: (_requestedRunId, key, event) =>
        Effect.sync(() => {
          const existing = records.find((record) => record.key === key)
          if (existing !== undefined) return existing
          const record = { event, key, position: records.length + 1, runId } as JournalRecord
          records = [...records, record]
          return record
        }),
      read: () => Effect.succeed(records)
    })
    const candidateAgent = IntegrationCandidateAgent.of({
      startOrContinue: () =>
        Effect.sync(() => {
          const report = nextAgentReport
          nextAgentReport = undefined
          if (report === undefined) throw new Error("model action did not provide an integration-agent report")
          return report
        })
    })
    const candidateGit = IntegrationCandidateGit.of({
      readSubmittedCommit: (_repository, _candidateCommit) =>
        Effect.suspend(() => {
          const result = nextGitResult
          nextGitResult = undefined
          if (result === undefined) return Effect.die("model action did not provide a Git observation")
          return result._tag === "IntegrationCandidateGitReadFailure" ? Effect.fail(result) : Effect.succeed(result)
        })
    })
    const candidateLayer = Layer.mergeAll(
      Layer.succeed(InRunJournal, append),
      Layer.succeed(IntegrationCandidateAgent, candidateAgent),
      Layer.succeed(IntegrationCandidateGit, candidateGit)
    )
    const journalLayer = Layer.succeed(InRunJournal, append)
    const promotionIdForRequest = (request: TargetPromotionRequest): bigint =>
      numericCommit(request.candidateCorrelation.acceptedResultCommit) - 20n
    const recordPromotionReadObservation = (request: TargetPromotionRequest, step: PromotionReadStep): void => {
      if (promotionReadAccounting === "Skip") {
        promotionReadAccounting = "Count"
        return
      }
      const id = promotionIdForRequest(request)
      const observation: PromotionBoundaryObservation =
        step._tag === "TargetPromotionGitReadFailure"
          ? { _tag: "PromotionUnreadableHead" }
          : step._tag === "CandidateCurrent"
            ? { _tag: "PromotionCandidateCurrent", head: numericCommit(step.currentHeadSha) }
            : step._tag === "CandidateAncestor"
              ? { _tag: "PromotionCandidateAncestor", head: numericCommit(step.currentHeadSha) }
              : step.currentHeadSha === request.expectedTargetHead
                ? { _tag: "PromotionExactExpectedHead", head: numericCommit(step.currentHeadSha) }
                : { _tag: "PromotionOtherHead", head: numericCommit(step.currentHeadSha) }
      promotionLatestObservation = new Map(promotionLatestObservation).set(id, observation)
      if (observation._tag === "PromotionExactExpectedHead") {
        promotionFreshExactHeadReads = new Map(promotionFreshExactHeadReads).set(
          id,
          (promotionFreshExactHeadReads.get(id) ?? 0n) + 1n
        )
      }
      promotionReadAccounting = "Count"
    }
    const targetPromotionGit = TargetPromotionGit.of({
      compareAndSet: (request) =>
        Effect.suspend(() => {
          const step = promotionCasSteps[0]
          promotionCasSteps = promotionCasSteps.slice(1)
          if (step === undefined) return Effect.die("model action did not provide a promotion compare-and-set response")
          const id = promotionIdForRequest(request)
          if (
            request.expectedTargetHead !== commitOf(id + 10n) ||
            request.candidateCorrelation.expectedTargetHead !== request.expectedTargetHead ||
            (request.candidateCommit !== commitOf(id + 30n) &&
              request.candidateCommit !== commitOf(id + 31n) &&
              request.candidateCommit !== commitOf(id + 32n)) ||
            request.verificationManifest.byteLength <= 0
          ) {
            return Effect.die("promotion compare-and-set request was not bound to the exact sealed candidate")
          }
          return step._tag === "TargetPromotionCompareAndSetFailure" ? Effect.fail(step) : Effect.succeed(step)
        }),
      read: (request) =>
        Effect.suspend(() => {
          const step = promotionReadSteps[0]
          promotionReadSteps = promotionReadSteps.slice(1)
          if (step === undefined) return Effect.die("model action did not provide a promotion Git observation")
          recordPromotionReadObservation(request, step)
          return step._tag === "TargetPromotionGitReadFailure" ? Effect.fail(step) : Effect.succeed(step)
        })
    })
    const requireResources = (): Effect.Effect<IntegrationTargetResourceController> =>
      resources === undefined ? Effect.die("integration resources must be initialized") : Effect.succeed(resources)
    const admission = () => deriveIntegrationAdmission(records)
    const responsibilityFor = (id: bigint): StartedIntegrationResponsibility => {
      const attempt = idFor(id)
      const responsibility = admission().responsibilities.find(
        (candidate) => candidate.plannedAttempt.attemptId === attempt.attemptId
      )
      if (responsibility?._tag !== "StartedIntegrationResponsibility") {
        return Effect.runSync(Effect.die(`result ${id} has no started integration responsibility`))
      }
      return responsibility
    }
    const physicalResponsibilityFor = <A extends QueuedIntegrationResponsibility | StartedIntegrationResponsibility>(
      id: bigint,
      responsibility: A
    ): A =>
      id === 2n && independentTargetTwo
        ? ({ ...responsibility, integrationTarget: independentTarget } as A)
        : responsibility
    const lineageFor = (id: bigint) =>
      TargetLineageObservation.make({
        plannedBaseIsAncestorOfTargetHead: true,
        plannedBaseSha: idFor(id).baseSha,
        targetHeadSha: commitOf(id + 10n)
      })
    const continueCandidate = (id: bigint) =>
      continueIntegrationCandidateConstruction(
        responsibilityFor(id),
        lineageFor(id),
        correctionLimit,
        continuationLimit
      ).pipe(Effect.provide(candidateLayer), Effect.orDie)
    const correlationFor = (id: bigint) => {
      const responsibility = responsibilityFor(id)
      const state = deriveIntegrationCandidateConstruction(records, responsibility)
      if (state === undefined) {
        const candidateId = IntegrationCandidateId.make(
          `integration-candidate:${responsibility.plannedAttempt.runId}:${responsibility.plannedAttempt.attemptId}:${responsibility.startedAt}`
        )
        return IntegrationCandidateCorrelation.make({
          acceptanceManifest: responsibility.acceptedResult.evidenceManifest,
          acceptedResultCommit: responsibility.acceptedResult.commit,
          attemptId: responsibility.plannedAttempt.attemptId,
          candidateId,
          candidateResource: IntegrationCandidateResourceLocator.make(`integration-candidate-resource:${candidateId}`),
          expectedTargetHead: commitOf(id + 10n),
          integrationSessionId: IntegrationSessionId.make(
            `integration-session:${responsibility.plannedAttempt.runId}:${responsibility.plannedAttempt.attemptId}:${responsibility.startedAt}`
          ),
          integrationTarget: responsibility.integrationTarget,
          runId: responsibility.plannedAttempt.runId
        })
      }
      return state._tag === "CandidateCorrelationContradiction" ? state.expected : state.correlation
    }
    const verificationCandidateFor = (id: bigint) => {
      const constructed = records.findLast(
        ({ event }) =>
          event._tag === "IntegrationCandidateConstructed" &&
          event.correlation.attemptId === idFor(id).attemptId &&
          event.correlation.runId === runId
      )
      if (constructed?.event._tag !== "IntegrationCandidateConstructed") {
        return Effect.runSync(Effect.die(`result ${id} has no constructed candidate`))
      }
      return {
        candidateCommit: constructed.event.candidateCommit,
        constructedAt: constructed.position,
        correlation: constructed.event.correlation,
        reviewManifest: constructed.event.reviewManifest
      }
    }
    const verificationArtifact = {
      bytes: new TextEncoder().encode("controlled verification evidence"),
      name: TargetVerificationArtifactName.make("verification.log")
    }
    const verificationTerminalFor = (
      outcome: Exclude<typeof stagedVerificationOutcome, "CorrelationContradiction" | undefined>,
      correlation: TargetVerificationCorrelation
    ): TargetVerificationTerminal =>
      outcome === "Passed"
        ? TargetVerificationTerminal.cases.Passed.make({ artifacts: [verificationArtifact], correlation })
        : TargetVerificationTerminal.cases[outcome].make({ artifacts: [verificationArtifact], correlation })
    const verificationBoundary = TargetVerificationBoundary.of({
      runOrResume: (request) =>
        Effect.suspend(() => {
          verificationRequestsSeen = [...verificationRequestsSeen, request]
          if (verificationBoundaryMode === "ResponseLost" || stagedVerificationOutcome === undefined) {
            return Effect.fail(
              new TargetVerificationBoundaryFailure({
                detail: "controlled wrapper response was lost",
                requestId: request.requestId
              })
            )
          }
          if (stagedVerificationOutcome === "CorrelationContradiction") {
            return Effect.succeed(
              TargetVerificationTerminal.cases.Failed.make({
                artifacts: [],
                correlation: TargetVerificationCorrelation.make({
                  ...request,
                  candidateCommit: commitOf(99),
                  requestId: targetVerificationRequestIdForCandidate(
                    IntegrationCandidateId.make(`${request.candidateCorrelation.candidateId}:foreign`)
                  )
                })
              })
            )
          }
          return Effect.succeed(verificationTerminalFor(stagedVerificationOutcome, request))
        })
    })
    const unavailableEvidenceLayer = Layer.succeed(
      EvidenceStore,
      EvidenceStore.of({
        put: (bytes) =>
          Effect.succeed(
            EvidenceReference.make({ byteLength: bytes.byteLength, digest: EvidenceDigest.make("a".repeat(64)) })
          ),
        read: () =>
          Effect.fail(
            new EvidenceStoreFailure({
              detail: "controlled evidence object is unavailable",
              operation: "EvidenceStore.read"
            })
          )
      })
    )
    const runConcreteVerification = (id: bigint) =>
      runTargetVerification(verificationCandidateFor(id), verificationPlanFor(id)).pipe(
        Effect.provideService(InRunJournal, append),
        Effect.provideService(TargetVerificationBoundary, verificationBoundary),
        Effect.provide(failVerificationEvidenceRead ? unavailableEvidenceLayer : memoryEvidenceStoreLayer),
        Effect.provide(NodeServices.layer)
      )
    const appendConcreteVerificationIntent = (id: bigint) => {
      const candidate = verificationCandidateFor(id)
      const correlation = targetVerificationCorrelationFor(candidate, verificationPlanFor(id).planId)
      return append.append(
        runId,
        targetVerificationIntentRecordKey(correlation.requestId),
        TargetVerificationIntendedEvent.make({ correlation, version: workflowJournalEventVersion })
      )
    }
    const promotionCandidateFor = (id: bigint) => verificationCandidateFor(id)
    const promotionRequestFor = (id: bigint): TargetPromotionRequest => {
      const candidate = promotionCandidateFor(id)
      const verification = deriveTargetVerificationState(records, candidate)
      if (verification?._tag !== "VerificationPassed") {
        return Effect.runSync(Effect.die(`result ${id} has no sealed passing verification for promotion`))
      }
      return targetPromotionRequestFor(
        candidate,
        TargetPromotionVerification.make({ correlation: verification.correlation, manifest: verification.manifest })
      )
    }
    const runConcretePromotion = (id: bigint) => {
      const candidate = promotionCandidateFor(id)
      const verification = deriveTargetVerificationState(records, candidate)
      if (verification?._tag !== "VerificationPassed") {
        return Effect.die(`result ${id} has no sealed passing verification for promotion`)
      }
      return runTargetPromotion(candidate, verification).pipe(
        Effect.provideService(InRunJournal, append),
        Effect.provideService(TargetPromotionGit, targetPromotionGit)
      )
    }
    const readConcretePromotion = (id: bigint) => {
      const request = promotionRequestFor(id)
      return Effect.gen(function* () {
        const git = yield* TargetPromotionGit
        return yield* git.read(request)
      }).pipe(Effect.provideService(TargetPromotionGit, targetPromotionGit))
    }
    const stagePromotionRead = (step: PromotionReadStep): void => {
      promotionReadSteps = [step]
    }
    const stagePromotionCasFailure = (id: bigint): void => {
      const request = promotionRequestFor(id)
      promotionCasSteps = [
        new TargetPromotionCompareAndSetFailure({
          candidateCommit: request.candidateCommit,
          detail: "controlled compare-and-set response was lost",
          expectedHead: request.expectedTargetHead,
          target: request.integrationTarget
        })
      ]
    }
    const submit = (id: bigint, candidate: bigint) =>
      Effect.gen(function* () {
        const correlation = correlationFor(id)
        nextAgentReport = IntegrationCandidateAgentReport.cases.Submitted.make({
          candidateCommit: commitOf(candidate),
          correlation,
          reviewManifest: EvidenceReference.make({
            byteLength: 1,
            digest: EvidenceDigest.make(candidate.toString(16).padStart(64, "0"))
          })
        })
        nextGitResult = new IntegrationCandidateGitReadFailure({
          candidateCommit: commitOf(candidate),
          detail: "defer candidate observation to the next model action",
          repository: target.repository
        })
        yield* continueCandidate(id)
        modelSubmitCandidate(id, candidate)
      })
    const observe = (id: bigint, exact: boolean) =>
      Effect.gen(function* () {
        const correlation = correlationFor(id)
        nextGitResult = IntegrationCandidateGitObservation.cases.Commit.make({
          directParents: exact
            ? [correlation.expectedTargetHead, correlation.acceptedResultCommit]
            : [commitOf(99), commitOf(98)]
        })
        const state = yield* continueCandidate(id)
        if (state._tag === "CandidateCorrectionLimitReached") {
          yield* (yield* requireResources()).release(physicalResponsibilityFor(id, responsibilityFor(id)))
        }
        if (exact) modelObserveExactCandidate(id)
        else modelObserveInvalidCandidate(id)
      })
    const reportWithoutCandidate = (id: bigint) =>
      Effect.gen(function* () {
        const correlation = correlationFor(id)
        nextAgentReport = IntegrationCandidateAgentReport.cases.Working.make({ correlation })
        yield* continueCandidate(id)
        const reports = records.filter(
          ({ event }) =>
            event._tag === "IntegrationCandidateAgentReported" &&
            event.report._tag !== "Submitted" &&
            event.report.correlation.attemptId === idFor(id).attemptId
        ).length
        if (reports >= continuationLimit) {
          const state = yield* continueCandidate(id)
          if (state._tag === "CandidateContinuationLimitReached") {
            yield* (yield* requireResources()).release(physicalResponsibilityFor(id, responsibilityFor(id)))
          }
        }
        modelReportWithoutCandidate(id)
      })

    const acceptResult = (id: bigint) =>
      Effect.sync(() => {
        const attempt = idFor(id)
        const responsibility = PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
          plannedAttempt: attempt,
          version: workflowJournalEventVersion
        })
        const report = PlannedAttemptExecutorWorkReportedEvent.make({
          ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
          report: PlannedAttemptExecutorReport.cases.Terminal.make({
            correlation: { attemptId: attempt.attemptId, runId },
            result: { _tag: "Accepted", acceptedResult: acceptedResultOf(id) }
          }),
          version: workflowJournalEventVersion
        })
        for (const event of [responsibility, report]) {
          records = [
            ...records,
            {
              event,
              key: describeJournalEvent(event).expectedKey,
              position: records.length + 1,
              runId
            } as JournalRecord
          ]
        }
        modelAcceptResult(id)
      })
    const observeAppliedRestartBeforeAccepted = (id: bigint) =>
      append
        .append(
          runId,
          attemptChoiceAppliedRecordKey(restartRequestId),
          AttemptChoiceAppliedEvent.make({
            choice: "RestartTaskImplementation",
            initiatedBy: { _tag: "Operator" },
            occurrenceClassification: "InitiatedAction",
            requestId: restartRequestId,
            subject: {
              observedTaskRevision: TaskRevision.make(`accepted-result-integration-revision-${id}-changed`),
              plannedAttempt: idFor(id)
            },
            version: workflowJournalEventVersion
          })
        )
        .pipe(
          Effect.tap(() => Effect.sync(() => modelObserveAppliedRestartBeforeAccepted(id))),
          Effect.asVoid
        )
    const gitReadFails = (id: bigint) =>
      Effect.gen(function* () {
        const state = deriveIntegrationCandidateConstruction(records, responsibilityFor(id))
        if (state?._tag !== "CandidateValidationPending") return yield* Effect.die("candidate must be pending")
        nextGitResult = new IntegrationCandidateGitReadFailure({
          candidateCommit: state.candidateCommit,
          detail: "simulated ambiguous Git read",
          repository: target.repository
        })
        yield* continueCandidate(id)
        modelGitReadFails()
      })
    const queueAcceptedResult = (id: bigint) =>
      queueAcceptedResultIntegrationResponsibility(
        idFor(id),
        acceptedResultOf(id),
        id === 2n && independentTargetTwo ? independentTarget : target
      ).pipe(
        Effect.provide(journalLayer),
        Effect.orDie,
        Effect.tap(() => Effect.sync(() => modelQueueAcceptedResult(id)))
      )
    const releaseForeignCorrelationTarget = (id: bigint) =>
      Effect.gen(function* () {
        const responsibility = responsibilityFor(id)
        yield* (yield* requireResources()).release(physicalResponsibilityFor(id, responsibility))
        releasedContradictions = new Set(releasedContradictions).add(id)
        modelReleaseForeignCorrelationTarget(id)
      })
    const reacquireIntegrationTarget = (id: bigint) =>
      Effect.gen(function* () {
        const responsibility = responsibilityFor(id)
        const controller = yield* requireResources()
        const physicalResponsibility = physicalResponsibilityFor(id, responsibility)
        yield* controller.acquire(physicalResponsibility).pipe(Effect.orDie)
        yield* controller.publishAcceptedOwnership(physicalResponsibility)
        modelReacquireIntegrationTarget(id)
      })
    const reportForeignCorrelation = (id: bigint) =>
      Effect.gen(function* () {
        const correlation = correlationFor(id)
        nextAgentReport = IntegrationCandidateAgentReport.cases.Working.make({
          correlation: {
            ...correlation,
            candidateId: IntegrationCandidateId.make(`${correlation.candidateId}:foreign`)
          }
        })
        yield* continueCandidate(id)
        modelReportForeignCorrelation(id)
      })
    const startIntegration = (id: bigint) =>
      Effect.gen(function* () {
        const attempt = idFor(id)
        const controller = yield* requireResources()
        const snapshot = yield* controller.snapshot
        // Admission reconstruction deliberately preserves every historical
        // start. Current resource facts remove settled starts before applying
        // the production FIFO selector, as the delivery frontier does.
        const currentAdmission = {
          responsibilities: admission()
            .responsibilities.map((responsibility) =>
              responsibility.plannedAttempt.attemptId === idFor(2n).attemptId
                ? physicalResponsibilityFor(2n, responsibility)
                : responsibility
            )
            .filter(
              (responsibility) =>
                responsibility._tag === "QueuedIntegrationResponsibility" ||
                snapshot.heldResponsibilityPositions.has(responsibility.queuedAt)
            )
        }
        const queued =
          selectStartableIntegrationResponsibilities(currentAdmission).find(
            (responsibility) => responsibility.plannedAttempt.attemptId === attempt.attemptId
          ) ??
          (id === 2n && independentTargetTwo
            ? currentAdmission.responsibilities.find(
                (responsibility): responsibility is QueuedIntegrationResponsibility =>
                  responsibility._tag === "QueuedIntegrationResponsibility" &&
                  responsibility.plannedAttempt.attemptId === attempt.attemptId
              )
            : undefined)
        if (queued === undefined) return yield* Effect.die(`result ${id} is not startable`)
        const physicalQueued = physicalResponsibilityFor(id, queued)
        yield* controller.acquire(physicalQueued).pipe(Effect.orDie)
        yield* controller.publishAcceptedOwnership(physicalQueued)
        yield* startQueuedIntegration(queued).pipe(Effect.provide(journalLayer), Effect.orDie)
        modelStartIntegration(id)
      })
    const waitOnDependency = (id: bigint) =>
      Effect.gen(function* () {
        const responsibility = responsibilityFor(id)
        yield* (yield* requireResources()).release(physicalResponsibilityFor(id, responsibility))
        dependencyWaits = new Set(dependencyWaits).add(id)
        modelWaitOnDependency(id)
      })
    const recordVerificationIntent = (id: bigint) =>
      appendConcreteVerificationIntent(id).pipe(Effect.tap(() => Effect.sync(() => modelRecordVerificationIntent(id))))
    const invokeVerification = (id: bigint) =>
      Effect.gen(function* () {
        verificationBoundaryMode = "ResponseLost"
        stagedVerificationOutcome = undefined
        yield* Effect.exit(runConcreteVerification(id))
        modelInvokeVerification(id)
      })
    const loseVerificationResponse = (id: bigint) => Effect.sync(() => modelLoseVerificationResponse(id))
    const reconcileVerification = (id: bigint) =>
      Effect.gen(function* () {
        verificationBoundaryMode = "ResponseLost"
        stagedVerificationOutcome = undefined
        yield* Effect.exit(runConcreteVerification(id))
        verificationReconciliations = new Map(verificationReconciliations).set(
          id,
          (verificationReconciliations.get(id) ?? 0n) + 1n
        )
        modelReconcileVerification(id)
      })
    const reportVerificationPassed = (id: bigint) =>
      Effect.sync(() => {
        verificationBoundaryMode = "ReturnStaged"
        stagedVerificationOutcome = "Passed"
        modelReportVerificationPassed(id)
      })
    const rereadAndSealPassedVerification = (id: bigint) =>
      Effect.gen(function* () {
        const state = yield* runConcreteVerification(id)
        if (state._tag !== "VerificationPassed") return yield* Effect.die("passing evidence was not sealed")
        yield* (yield* requireResources()).release(physicalResponsibilityFor(id, responsibilityFor(id)))
        modelRereadAndSealPassedVerification(id)
      })
    const reportDiagnostic = (id: bigint, outcome: "Failed" | "Killed" | "TimedOut" | "Partial", phase: Phase) =>
      Effect.gen(function* () {
        verificationBoundaryMode = "ReturnStaged"
        stagedVerificationOutcome = outcome
        const state = yield* runConcreteVerification(id)
        if (state._tag !== "VerificationStopped" || state.outcome !== outcome) {
          return yield* Effect.die(`diagnostic ${outcome} was not sealed`)
        }
        yield* (yield* requireResources()).release(physicalResponsibilityFor(id, responsibilityFor(id)))
        modelReportDiagnostic(id, phase, outcome)
      })
    const reportVerificationFailed = (id: bigint) => reportDiagnostic(id, "Failed", "VerificationFailed")
    const reportVerificationKilled = (id: bigint) => reportDiagnostic(id, "Killed", "VerificationKilled")
    const reportVerificationTimedOut = (id: bigint) => reportDiagnostic(id, "TimedOut", "VerificationTimedOut")
    const reportVerificationPartial = (id: bigint) => reportDiagnostic(id, "Partial", "VerificationPartial")
    const reportVerificationCorrelationContradiction = (id: bigint) =>
      Effect.gen(function* () {
        verificationBoundaryMode = "ReturnStaged"
        stagedVerificationOutcome = "CorrelationContradiction"
        const state = yield* runConcreteVerification(id)
        if (state._tag !== "VerificationContradicted") {
          return yield* Effect.die("foreign verification correlation was not stopped")
        }
        yield* (yield* requireResources()).release(physicalResponsibilityFor(id, responsibilityFor(id)))
        modelReportVerificationBoundaryFailure(id, "VerificationCorrelationContradiction")
      })
    const reportVerificationEvidenceFailure = (id: bigint) =>
      Effect.gen(function* () {
        verificationBoundaryMode = "ReturnStaged"
        stagedVerificationOutcome = "Passed"
        failVerificationEvidenceRead = true
        const failure = yield* runConcreteVerification(id).pipe(Effect.flip)
        failVerificationEvidenceRead = false
        if (!(failure instanceof EvidenceStoreFailure)) {
          return yield* Effect.die("incomplete verification evidence did not fail closed")
        }
        yield* (yield* requireResources()).release(physicalResponsibilityFor(id, responsibilityFor(id)))
        modelReportVerificationBoundaryFailure(id, "VerificationEvidenceFailure")
      })
    const offerPromotionPremise = (id: bigint) => Effect.sync(() => modelOfferPromotionPremise(id))
    const recordPromotionIntent = (id: bigint) =>
      Effect.gen(function* () {
        const controller = yield* requireResources()
        const responsibility = physicalResponsibilityFor(id, responsibilityFor(id))
        yield* controller.acquire(responsibility).pipe(Effect.orDie)
        yield* controller.publishAcceptedOwnership(responsibility)
        const request = promotionRequestFor(id)
        yield* append.append(
          runId,
          targetPromotionIntentRecordKey(request.requestId),
          TargetPromotionIntendedEvent.make({ correlation: request, version: workflowJournalEventVersion })
        )
        modelRecordPromotionIntent(id)
        promotionTargetFacts = new Map(promotionTargetFacts).set(id, false)
        promotionLatestObservation = new Map(promotionLatestObservation).set(id, { _tag: "NoPromotionGitObservation" })
      })
    const recordPromotionAttemptIntent = (id: bigint) =>
      Effect.gen(function* () {
        const request = promotionRequestFor(id)
        const previousAttemptOrdinal = modelResultFor(id).promotionAttemptCount
        const attemptOrdinal = TargetPromotionAttemptOrdinal.make(Number(previousAttemptOrdinal + 1n))
        const reason =
          previousAttemptOrdinal === 0n
            ? TargetPromotionAttemptReason.cases.Initial.make({ observedHeadSha: request.expectedTargetHead })
            : TargetPromotionAttemptReason.cases.ReconciledExpectedHead.make({
                observedHeadSha: request.expectedTargetHead,
                previousAttemptOrdinal: TargetPromotionAttemptOrdinal.make(Number(previousAttemptOrdinal))
              })
        yield* append.append(
          runId,
          targetPromotionAttemptIntentRecordKey(request.requestId, attemptOrdinal),
          TargetPromotionAttemptIntendedEvent.make({
            attemptOrdinal,
            correlation: request,
            reason,
            version: workflowJournalEventVersion
          })
        )
        modelRecordPromotionAttemptIntent(id)
        promotionLatestObservation = new Map(promotionLatestObservation).set(id, { _tag: "NoPromotionGitObservation" })
      })
    const sendPromotionAttempt = (id: bigint) =>
      Effect.gen(function* () {
        stagePromotionCasFailure(id)
        const request = promotionRequestFor(id)
        const result = yield* Effect.exit(targetPromotionGit.compareAndSet(request))
        if (result._tag !== "Failure") {
          return yield* Effect.die("promotion compare-and-set did not expose the controlled ambiguous response")
        }
        promotionLatestObservation = new Map(promotionLatestObservation).set(id, { _tag: "NoPromotionGitObservation" })
        modelSendPromotionAttempt(id)
      })
    const losePromotionResponse = (id: bigint) =>
      Effect.gen(function* () {
        yield* (yield* requireResources()).release(physicalResponsibilityFor(id, responsibilityFor(id)))
        modelLosePromotionResponse(id)
        promotionTargetFacts = new Map(promotionTargetFacts).set(id, false)
        promotionLatestObservation = new Map(promotionLatestObservation).set(id, { _tag: "NoPromotionGitObservation" })
      })
    const reconcilePromotion = (id: bigint) =>
      Effect.gen(function* () {
        const controller = yield* requireResources()
        const responsibility = physicalResponsibilityFor(id, responsibilityFor(id))
        yield* controller.acquire(responsibility).pipe(Effect.orDie)
        yield* controller.publishAcceptedOwnership(responsibility)
        modelReconcilePromotion(id)
        modelTargetReacquisitionRequired = anotherResultRequiresTargetReacquisition(id)
        promotionTargetFacts = new Map(promotionTargetFacts).set(id, false)
        promotionLatestObservation = new Map(promotionLatestObservation).set(id, { _tag: "NoPromotionGitObservation" })
      })
    const observePromotionCandidate = (id: bigint, observation: "Current" | "Ancestor") =>
      Effect.gen(function* () {
        const request = promotionRequestFor(id)
        stagePromotionRead(
          observation === "Current"
            ? TargetPromotionGitReadObservation.cases.CandidateCurrent.make({ currentHeadSha: request.candidateCommit })
            : TargetPromotionGitReadObservation.cases.CandidateAncestor.make({
                currentHeadSha: commitOf(modelResultFor(id).submittedCandidate + 100n)
              })
        )
        promotionReadAccounting = "Count"
        const controller = yield* requireResources()
        const result = yield* controller.withPermit(
          physicalResponsibilityFor(id, responsibilityFor(id)),
          runConcretePromotion(id)
        )
        if (result._tag !== "PromotionSucceeded") {
          return yield* Effect.die(`promotion ${observation.toLowerCase()} observation did not prove success`)
        }
        yield* controller.release(physicalResponsibilityFor(id, responsibilityFor(id)))
        if (observation === "Current") modelObservePromotionCandidateCurrent(id)
        else modelObservePromotionCandidateAncestor(id)
        promotionTargetFacts = new Map(promotionTargetFacts).set(id, modelResultFor(id).promotionTargetFactsCurrent)
      })
    const observePromotionExactExpectedHead = (id: bigint) =>
      Effect.gen(function* () {
        const request = promotionRequestFor(id)
        stagePromotionRead(
          TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({
            currentHeadSha: request.expectedTargetHead
          })
        )
        promotionReadAccounting = "Count"
        const controller = yield* requireResources()
        const attemptCount = modelResultFor(id).promotionAttemptCount
        if (attemptCount >= 3n) {
          const result = yield* controller.withPermit(
            physicalResponsibilityFor(id, responsibilityFor(id)),
            runConcretePromotion(id)
          )
          if (result._tag !== "PromotionNonConvergent") {
            return yield* Effect.die("third exact expected-head read did not settle non-convergence")
          }
        } else {
          const result = yield* controller.withPermit(
            physicalResponsibilityFor(id, responsibilityFor(id)),
            readConcretePromotion(id)
          )
          if (result._tag !== "CandidateNotInAncestry" || result.currentHeadSha !== request.expectedTargetHead) {
            return yield* Effect.die("promotion retry was not authorized by a fresh exact expected-head read")
          }
        }
        modelTargetFactsCurrent = true
        modelTargetHeadProof = modelResultFor(id).expectedTargetHead
        modelObservePromotionExactExpectedHead(id)
        promotionTargetFacts = new Map(promotionTargetFacts).set(id, true)
        if (modelResultFor(id).phase === "PromotionExhausted") {
          yield* controller.release(physicalResponsibilityFor(id, responsibilityFor(id)))
        }
      })
    const observePromotionOtherHead = (id: bigint) =>
      Effect.gen(function* () {
        const request = promotionRequestFor(id)
        stagePromotionRead(
          TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({
            currentHeadSha: commitOf(numericCommit(request.expectedTargetHead) + 1n)
          })
        )
        promotionReadAccounting = "Count"
        const controller = yield* requireResources()
        const result = yield* controller.withPermit(
          physicalResponsibilityFor(id, responsibilityFor(id)),
          runConcretePromotion(id)
        )
        if (result._tag !== "PromotionStale") {
          return yield* Effect.die("other exact target head did not settle stale promotion")
        }
        yield* controller.release(physicalResponsibilityFor(id, responsibilityFor(id)))
        modelObservePromotionOtherHead(id)
        promotionTargetFacts = new Map(promotionTargetFacts).set(id, modelResultFor(id).promotionTargetFactsCurrent)
      })
    const observePromotionGitUnreadable = (id: bigint) =>
      Effect.gen(function* () {
        const request = promotionRequestFor(id)
        stagePromotionRead(
          new TargetPromotionGitReadFailure({
            candidateCommit: request.candidateCommit,
            detail: "controlled target head and ancestry read was unavailable",
            target: request.integrationTarget
          })
        )
        promotionReadAccounting = "Count"
        const controller = yield* requireResources()
        const attemptCount = modelResultFor(id).promotionAttemptCount
        const result = yield* Effect.exit(
          controller.withPermit(physicalResponsibilityFor(id, responsibilityFor(id)), runConcretePromotion(id))
        )
        if (attemptCount >= 3n) {
          if (result._tag !== "Success" || result.value._tag !== "PromotionNonConvergent") {
            return yield* Effect.die("unreadable third promotion read did not settle non-convergence")
          }
        } else if (result._tag !== "Failure") {
          return yield* Effect.die("unreadable promotion read unexpectedly changed the target")
        }
        yield* controller.release(physicalResponsibilityFor(id, responsibilityFor(id)))
        modelObservePromotionGitUnreadable(id)
        promotionTargetFacts = new Map(promotionTargetFacts).set(id, false)
      })
    const assignResultTwoIndependentTarget = () => Effect.sync(() => modelAssignResultTwoIndependentTarget())
    const observeTargetFacts = (id: bigint) =>
      Effect.sync(() => {
        promotionTargetFacts = new Map(promotionTargetFacts).set(id, modelResultFor(id).phase.startsWith("Promotion"))
        modelObserveTargetFacts(id)
      })

    const concreteVerificationProjectionFor = (id: bigint, targetHeld: boolean): Partial<ModelResult> => {
      const candidateRecord = records.findLast(
        ({ event }) =>
          event._tag === "IntegrationCandidateConstructed" && event.correlation.attemptId === idFor(id).attemptId
      )
      if (candidateRecord?.event._tag !== "IntegrationCandidateConstructed") return {}
      const candidate = {
        candidateCommit: candidateRecord.event.candidateCommit,
        constructedAt: candidateRecord.position,
        correlation: candidateRecord.event.correlation,
        reviewManifest: candidateRecord.event.reviewManifest
      }
      const intent = records.findLast(
        ({ event }) =>
          event._tag === "TargetVerificationIntended" &&
          event.correlation.candidateCorrelation.attemptId === idFor(id).attemptId
      )?.event
      if (intent?._tag !== "TargetVerificationIntended") return {}
      const correlation = intent.correlation
      const expectedRequestId = targetVerificationRequestIdForCandidate(candidate.correlation.candidateId)
      const expectedPlan = verificationPlanFor(id)
      const exactCandidateBinding =
        correlation.candidateCommit === candidate.candidateCommit &&
        correlation.candidateConstructedAt === candidate.constructedAt &&
        integrationCandidateCorrelationEquals(correlation.candidateCorrelation, candidate.correlation)
      const verification = deriveTargetVerificationState(records, candidate)
      const terminalPhase: Phase | undefined =
        verification?._tag === "VerificationPassed"
          ? modelResultFor(id).phase === "PromotionPremise"
            ? "PromotionPremise"
            : "VerificationPassed"
          : verification?._tag === "VerificationStopped"
            ? (`Verification${verification.outcome}` as Phase)
            : verification?._tag === "VerificationContradicted"
              ? "VerificationCorrelationContradiction"
              : undefined
      const outcome: VerificationOutcome =
        verification?._tag === "VerificationPassed"
          ? "Passed"
          : verification?._tag === "VerificationStopped"
            ? verification.outcome
            : verification?._tag === "VerificationContradicted"
              ? "NoVerificationOutcome"
              : modelResultFor(id).verificationOutcome
      const requestIdsSeen = new Set(
        verificationRequestsSeen
          .filter((request) => request.candidateCorrelation.attemptId === idFor(id).attemptId)
          .map((request) => request.requestId)
      )
      const terminalWasSealed =
        verification?._tag === "VerificationPassed" || verification?._tag === "VerificationStopped"
      return {
        phase: terminalPhase ?? modelResultFor(id).phase,
        promotionAuthorized: verification?._tag === "VerificationPassed",
        reconciliationCount: verificationReconciliations.get(id) ?? 0n,
        targetHeld,
        verificationEvidenceReread: terminalWasSealed,
        verificationIntentRecorded: true,
        verificationManifestSealed: terminalWasSealed,
        verificationOutcome: outcome,
        verificationReplacementCount: BigInt(Math.max(0, requestIdsSeen.size - 1)),
        verificationRequest: {
          acceptedResult: numericCommit(correlation.candidateCorrelation.acceptedResultCommit),
          candidate: numericCommit(correlation.candidateCommit),
          candidatePosition: exactCandidateBinding ? modelResultFor(id).candidateJournalPosition : -1n,
          integrationSession:
            correlation.candidateCorrelation.integrationSessionId === candidate.correlation.integrationSessionId
              ? id
              : -1n,
          plan: correlation.planId === expectedPlan.planId ? 7000n + id : -1n,
          requestId:
            correlation.requestId === expectedRequestId ? id * 1000n + numericCommit(correlation.candidateCommit) : -1n,
          target:
            JSON.stringify(correlation.candidateCorrelation.integrationTarget) === JSON.stringify(expectedPlan.target)
              ? 1n
              : -1n
        },
        wrapperInvocationCount: BigInt(requestIdsSeen.size)
      }
    }
    const concretePromotionProjectionFor = (id: bigint, targetHeld: boolean): Partial<ModelResult> => {
      const candidateRecord = records.findLast(
        ({ event }) =>
          event._tag === "IntegrationCandidateConstructed" && event.correlation.attemptId === idFor(id).attemptId
      )
      if (candidateRecord?.event._tag !== "IntegrationCandidateConstructed") return {}
      const candidate = {
        candidateCommit: candidateRecord.event.candidateCommit,
        constructedAt: candidateRecord.position,
        correlation: candidateRecord.event.correlation,
        reviewManifest: candidateRecord.event.reviewManifest
      }
      const verification = deriveTargetVerificationState(records, candidate)
      if (verification?._tag !== "VerificationPassed") return {}
      const request = targetPromotionRequestFor(
        candidate,
        TargetPromotionVerification.make({ correlation: verification.correlation, manifest: verification.manifest })
      )
      const intent = records.findLast(
        ({ event }) => event._tag === "TargetPromotionIntended" && event.correlation.requestId === request.requestId
      )
      if (intent?.event._tag !== "TargetPromotionIntended") return {}
      const state = deriveTargetPromotionState(records, request)
      const attempts = records.flatMap(({ event }) =>
        event._tag === "TargetPromotionAttemptIntended" && event.correlation.requestId === request.requestId
          ? [event]
          : []
      )
      const lastAttempt = attempts.at(-1)
      const latest = promotionLatestObservation.get(id)
      let promotionGitObservation: PromotionGitObservation = latest?._tag ?? "NoPromotionGitObservation"
      let promotionObservedTargetHead = latest !== undefined && "head" in latest ? latest.head : 0n
      let promotionCandidateAncestryProven = false
      let promotionResultRecorded = false
      let promotionPhase = modelResultFor(id).phase
      if (state?._tag === "PromotionSucceeded") {
        promotionPhase = "PromotionSucceeded"
        promotionCandidateAncestryProven = true
        promotionResultRecorded = true
        promotionGitObservation =
          state.observation._tag === "ReconciledCandidateAncestor"
            ? "PromotionCandidateAncestor"
            : "PromotionCandidateCurrent"
        promotionObservedTargetHead = numericCommit(state.observation.targetHeadSha)
      } else if (state?._tag === "PromotionStale") {
        promotionPhase = "PromotionStale"
        promotionResultRecorded = true
        promotionGitObservation = "PromotionOtherHead"
        promotionObservedTargetHead = numericCommit(
          state.observation._tag === "CompareAndSetRejected"
            ? state.observation.observedHeadSha
            : state.observation.observedHeadSha
        )
      } else if (state?._tag === "PromotionNonConvergent") {
        promotionPhase = "PromotionExhausted"
        promotionGitObservation =
          state.lastObservation._tag === "ExpectedHeadStillObserved"
            ? "PromotionExactExpectedHead"
            : "PromotionUnreadableHead"
        promotionObservedTargetHead =
          state.lastObservation._tag === "ExpectedHeadStillObserved"
            ? numericCommit(state.lastObservation.observedHeadSha)
            : 0n
      }
      return {
        phase: promotionPhase,
        targetHeld,
        promotionIntentRecorded: true,
        promotionAttemptCount: BigInt(attempts.length),
        promotionLastAttempt: lastAttempt === undefined ? 0n : BigInt(lastAttempt.attemptOrdinal),
        promotionFreshExactHeadReads: promotionFreshExactHeadReads.get(id) ?? 0n,
        promotionFreshExactHeadObservation: promotionLatestObservation.get(id)?._tag === "PromotionExactExpectedHead",
        promotionTargetFactsCurrent: promotionTargetFacts.get(id) ?? false,
        promotionExpectedHeadVerified: request.expectedTargetHead === candidate.correlation.expectedTargetHead,
        promotionGitObservation,
        promotionObservedTargetHead,
        promotionCandidateAncestryProven,
        promotionResultRecorded,
        promotionResponseAmbiguous: modelResultFor(id).promotionResponseAmbiguous,
        promotionCompareAndSetRequested: modelResultFor(id).promotionCompareAndSetRequested,
        promotionForceRequested: false,
        promotionEquivalentContentAccepted: false
      }
    }

    return {
      acceptResultOne: () => acceptResult(1n),
      acceptResultTwo: () => acceptResult(2n),
      gitReadFailsOne: () => gitReadFails(1n),
      gitReadFailsTwo: () => gitReadFails(2n),
      getState: () =>
        Effect.gen(function* () {
          const controller = yield* requireResources()
          const snapshot = yield* controller.snapshot
          const currentAdmission = admission()
          const queuedPositions = currentAdmission.responsibilities
            .map(({ queuedAt }) => queuedAt)
            .toSorted((left, right) => left - right)
          const results = new Map(
            [...attempts].map(([id, attempt]) => {
              const acceptedRecord = records.find(
                ({ event }) =>
                  event._tag === "PlannedAttemptExecutorWorkReported" &&
                  event.report._tag === "Terminal" &&
                  event.report.result._tag === "Accepted" &&
                  event.report.correlation.attemptId === attempt.attemptId
              )
              const accepted = acceptedRecord !== undefined
              const restartRecord = records.find(
                ({ event }) =>
                  event._tag === "AttemptChoiceApplied" &&
                  event.choice === "RestartTaskImplementation" &&
                  event.subject.plannedAttempt.attemptId === attempt.attemptId
              )
              const restartChoiceCommittedBeforeTerminal =
                restartRecord !== undefined &&
                acceptedRecord !== undefined &&
                restartRecord.position < acceptedRecord.position
              const integrationResponsibilityCount = records.filter(
                ({ event }) =>
                  event._tag === "IntegrationResponsibilityBegan" &&
                  event.plannedAttempt.attemptId === attempt.attemptId
              ).length
              const queued = currentAdmission.responsibilities.find(
                (responsibility) => responsibility.plannedAttempt.attemptId === attempt.attemptId
              )
              const candidate =
                queued?._tag === "StartedIntegrationResponsibility"
                  ? deriveIntegrationCandidateConstruction(records, queued)
                  : undefined
              const correlation =
                candidate === undefined && queued?._tag === "StartedIntegrationResponsibility"
                  ? correlationFor(id)
                  : candidate === undefined
                    ? undefined
                    : candidate._tag === "CandidateCorrelationContradiction"
                      ? candidate.expected
                      : candidate.correlation
              const observations = records.filter(
                ({ event }) =>
                  event._tag === "IntegrationCandidateGitObserved" && event.correlation.attemptId === attempt.attemptId
              )
              const invalidObservations = observations.filter(
                ({ event }) =>
                  event._tag === "IntegrationCandidateGitObserved" &&
                  correlation !== undefined &&
                  !integrationCandidateHasExactParents(event.observation, correlation)
              )
              const reports = records.filter(
                ({ event }) =>
                  event._tag === "IntegrationCandidateAgentReported" &&
                  event.expectedCorrelation.attemptId === attempt.attemptId
              )
              const submitted = reports.findLast(
                ({ event }) => event._tag === "IntegrationCandidateAgentReported" && event.report._tag === "Submitted"
              )
              const currentObservation = observations.findLast(
                ({ event }) =>
                  event._tag === "IntegrationCandidateGitObserved" && event.submissionAt === submitted?.position
              )?.event
              const parents =
                currentObservation?._tag === "IntegrationCandidateGitObserved" &&
                currentObservation.observation._tag === "Commit"
                  ? currentObservation.observation.directParents
                  : []
              const queueRank =
                queued === undefined ? 0 : queuedPositions.findIndex((position) => position === queued.queuedAt) + 1
              const observedResult = {
                acceptedResultCommit: id + 20n,
                continuationCount: BigInt(
                  reports.filter(
                    ({ event }) =>
                      event._tag === "IntegrationCandidateAgentReported" &&
                      event.report._tag !== "Submitted" &&
                      correlation !== undefined &&
                      integrationCandidateCorrelationEquals(event.report.correlation, correlation)
                  ).length
                ),
                correctionCount:
                  candidate?._tag === "CandidateCorrectionLimitReached"
                    ? BigInt(candidate.correctionCount)
                    : BigInt(invalidObservations.length),
                expectedTargetHead: numericCommit(correlation?.expectedTargetHead),
                integrationTarget: 1n,
                integrationSession: correlation === undefined ? 0n : id,
                observedFirstParent: numericCommit(parents[0]),
                observedSecondParent: numericCommit(parents[1]),
                phase:
                  candidate?._tag === "CandidateConstructionInProgress" && observations.length > 0
                    ? "CorrectionRequired"
                    : phaseFor(accepted, queued, candidate, dependencyWaits.has(id), releasedContradictions.has(id)),
                preIntegrationCancellation: queued?._tag === "QueuedIntegrationResponsibility",
                queuePosition: BigInt(queueRank),
                submittedCandidate:
                  submitted?.event._tag === "IntegrationCandidateAgentReported" &&
                  submitted.event.report._tag === "Submitted"
                    ? numericCommit(submitted.event.report.candidateCommit)
                    : 0n,
                targetHeld: queued === undefined ? false : snapshot.heldResponsibilityPositions.has(queued.queuedAt)
              }
              return [
                id,
                Object.assign(
                  observedResult,
                  modelResultFor(id),
                  concreteVerificationProjectionFor(
                    id,
                    queued === undefined ? false : snapshot.heldResponsibilityPositions.has(queued.queuedAt)
                  ),
                  concretePromotionProjectionFor(
                    id,
                    queued === undefined ? false : snapshot.heldResponsibilityPositions.has(queued.queuedAt)
                  ),
                  {
                    acceptedEvidencePreserved: accepted,
                    integrationResponsibilityCount: BigInt(integrationResponsibilityCount),
                    integrationResponsibilityRecorded: integrationResponsibilityCount === 1,
                    phase: restartChoiceCommittedBeforeTerminal ? "LateAcceptedEvidence" : modelResultFor(id).phase,
                    restartChoiceCommittedBeforeTerminal
                  }
                )
              ] as const
            })
          )
          return {
            nextJournalPosition: modelNextJournalPosition,
            recovered,
            results,
            restartCount: modelRestartCount,
            targetFactsCurrent: modelTargetFactsCurrent,
            targetHeadProof: modelTargetHeadProof,
            targetReacquisitionRequired: modelTargetReacquisitionRequired,
            trackerFactsCurrent
          }
        }),
      init: () =>
        Effect.gen(function* () {
          records = []
          nextAgentReport = undefined
          nextGitResult = undefined
          resources = yield* makeIntegrationTargetResourceController()
          recovered = false
          trackerFactsCurrent = true
          resetModelState()
          dependencyWaits = new Set()
          releasedContradictions = new Set()
          stagedVerificationOutcome = undefined
          verificationBoundaryMode = "ResponseLost"
          verificationRequestsSeen = []
          verificationReconciliations = new Map()
          failVerificationEvidenceRead = false
          promotionCasSteps = []
          promotionReadSteps = []
          promotionFreshExactHeadReads = new Map()
          promotionLatestObservation = new Map()
          promotionTargetFacts = new Map()
          promotionReadAccounting = "Count"
          independentTargetTwo = false
        }),
      observeAppliedRestartBeforeAcceptedOne: () => observeAppliedRestartBeforeAccepted(1n),
      observeExactCandidateOne: () => observe(1n, true),
      observeExactCandidateTwo: () => observe(2n, true),
      observeInvalidCandidateOne: () => observe(1n, false),
      observeInvalidCandidateTwo: () => observe(2n, false),
      observeTargetFactsOne: () => observeTargetFacts(1n),
      observeTargetFactsTwo: () => observeTargetFacts(2n),
      observeTrackerFacts: () =>
        Effect.sync(() => {
          trackerFactsCurrent = true
          modelObserveTrackerFacts()
        }),
      queueAcceptedResultOne: () => queueAcceptedResult(1n),
      queueAcceptedResultTwo: () => queueAcceptedResult(2n),
      reacquireIntegrationTargetOne: () => reacquireIntegrationTarget(1n),
      reacquireIntegrationTargetTwo: () => reacquireIntegrationTarget(2n),
      recoverCoordinatorStep: () =>
        Effect.gen(function* () {
          const terminalPromotionPhases = new Set<Phase>(["PromotionSucceeded", "PromotionStale", "PromotionExhausted"])
          resources = yield* makeIntegrationTargetResourceController()
          releasedContradictions = new Set()
          promotionCasSteps = []
          promotionReadSteps = []
          promotionReadAccounting = "Count"
          promotionLatestObservation = new Map(
            [...promotionLatestObservation].map(([id, observation]) => [
              id,
              terminalPromotionPhases.has(modelResultFor(id).phase)
                ? observation
                : { _tag: "NoPromotionGitObservation" }
            ])
          )
          promotionTargetFacts = new Map([...promotionTargetFacts].map(([id]) => [id, false]))
          modelRecoverCoordinator()
        }),
      releaseForeignCorrelationTargetOne: () => releaseForeignCorrelationTarget(1n),
      releaseForeignCorrelationTargetTwo: () => releaseForeignCorrelationTarget(2n),
      reportForeignCorrelationOne: () => reportForeignCorrelation(1n),
      reportForeignCorrelationTwo: () => reportForeignCorrelation(2n),
      recordVerificationIntentOne: () => recordVerificationIntent(1n),
      invokeVerificationOne: () => invokeVerification(1n),
      loseVerificationResponseOne: () => loseVerificationResponse(1n),
      reconcileVerificationOne: () => reconcileVerification(1n),
      reportVerificationPassedOne: () => reportVerificationPassed(1n),
      rereadAndSealPassedVerificationOne: () => rereadAndSealPassedVerification(1n),
      reportVerificationFailedOne: () => reportVerificationFailed(1n),
      reportVerificationKilledOne: () => reportVerificationKilled(1n),
      reportVerificationTimedOutOne: () => reportVerificationTimedOut(1n),
      reportVerificationPartialOne: () => reportVerificationPartial(1n),
      reportVerificationCorrelationContradictionOne: () => reportVerificationCorrelationContradiction(1n),
      reportVerificationEvidenceFailureOne: () => reportVerificationEvidenceFailure(1n),
      offerPromotionPremiseOne: () => offerPromotionPremise(1n),
      recordPromotionIntentOne: () => recordPromotionIntent(1n),
      recordPromotionAttemptIntentOne: () => recordPromotionAttemptIntent(1n),
      sendPromotionAttemptOne: () => sendPromotionAttempt(1n),
      losePromotionAttemptResponseOne: () => losePromotionResponse(1n),
      reconcilePromotionOne: () => reconcilePromotion(1n),
      observePromotionCandidateCurrentOne: () => observePromotionCandidate(1n, "Current"),
      observePromotionCandidateAncestorOne: () => observePromotionCandidate(1n, "Ancestor"),
      observePromotionExactExpectedHeadOne: () => observePromotionExactExpectedHead(1n),
      observePromotionOtherHeadOne: () => observePromotionOtherHead(1n),
      observePromotionGitUnreadableOne: () => observePromotionGitUnreadable(1n),
      assignResultTwoIndependentTargetOne: () => assignResultTwoIndependentTarget(),
      reportWithoutCandidateOne: () => reportWithoutCandidate(1n),
      reportWithoutCandidateTwo: () => reportWithoutCandidate(2n),
      startIntegrationOne: () => startIntegration(1n),
      startIntegrationTwo: () => startIntegration(2n),
      submitCandidateOne31: () => submit(1n, 31n),
      submitCandidateOne32: () => submit(1n, 32n),
      submitCandidateTwo31: () => submit(2n, 31n),
      submitCandidateTwo32: () => submit(2n, 32n),
      waitOnDependencyOne: () => waitOnDependency(1n),
      waitOnDependencyTwo: () => waitOnDependency(2n)
    }
  }
)

quintIt(
  it.effect,
  "replays accepted-result integration through production journal and candidate protocols",
  {
    backend: "typescript",
    driverFactory: acceptedResultIntegrationDriver,
    maxSteps: 35,
    nTraces: 100,
    seed: "57",
    spec: "specs/acceptedResultIntegration.qnt",
    stateCheck: stateCheck(
      (raw) =>
        Schema.decodeUnknownEffect(SpecProjection)(raw).pipe(
          Effect.map(({ state }) => ({
            ...state,
            results: new Map(
              [...state.results].map(([id, result]) => [
                id,
                {
                  ...result,
                  phase: variantTag(result.phase),
                  verificationOutcome: variantTag(result.verificationOutcome),
                  promotionGitObservation: variantTag(result.promotionGitObservation)
                }
              ])
            )
          })),
          Effect.orDie
        ),
      (spec, implementation) =>
        spec.nextJournalPosition === implementation.nextJournalPosition &&
        spec.recovered === implementation.recovered &&
        spec.restartCount === implementation.restartCount &&
        spec.targetFactsCurrent === implementation.targetFactsCurrent &&
        spec.targetHeadProof === implementation.targetHeadProof &&
        spec.targetReacquisitionRequired === implementation.targetReacquisitionRequired &&
        spec.trackerFactsCurrent === implementation.trackerFactsCurrent &&
        [...spec.results].every(([id, expected]) => {
          const actual = implementation.results.get(id)
          return (
            actual !== undefined &&
            expected.acceptedEvidencePreserved === actual.acceptedEvidencePreserved &&
            expected.acceptedResultCommit === actual.acceptedResultCommit &&
            expected.candidateJournalPosition === actual.candidateJournalPosition &&
            expected.continuationCount === actual.continuationCount &&
            expected.correctionCount === actual.correctionCount &&
            expected.expectedTargetHead === actual.expectedTargetHead &&
            expected.integrationResponsibilityCount === actual.integrationResponsibilityCount &&
            expected.integrationResponsibilityRecorded === actual.integrationResponsibilityRecorded &&
            expected.integrationTarget === actual.integrationTarget &&
            expected.integrationSession === actual.integrationSession &&
            expected.observedFirstParent === actual.observedFirstParent &&
            expected.observedSecondParent === actual.observedSecondParent &&
            expected.phase === actual.phase &&
            expected.preIntegrationCancellation === actual.preIntegrationCancellation &&
            expected.queuePosition === actual.queuePosition &&
            expected.submittedCandidate === actual.submittedCandidate &&
            expected.targetHeld === actual.targetHeld &&
            expected.verificationEvidenceReread === actual.verificationEvidenceReread &&
            expected.verificationIntentRecorded === actual.verificationIntentRecorded &&
            expected.verificationManifestSealed === actual.verificationManifestSealed &&
            expected.verificationOutcome === variantTag(actual.verificationOutcome) &&
            expected.verificationRequest.acceptedResult === actual.verificationRequest.acceptedResult &&
            expected.verificationRequest.candidate === actual.verificationRequest.candidate &&
            expected.verificationRequest.candidatePosition === actual.verificationRequest.candidatePosition &&
            expected.verificationRequest.integrationSession === actual.verificationRequest.integrationSession &&
            expected.verificationRequest.plan === actual.verificationRequest.plan &&
            expected.verificationRequest.requestId === actual.verificationRequest.requestId &&
            expected.verificationRequest.target === actual.verificationRequest.target &&
            expected.wrapperInvocationCount === actual.wrapperInvocationCount &&
            expected.reconciliationCount === actual.reconciliationCount &&
            expected.promotionAuthorized === actual.promotionAuthorized &&
            expected.verificationReplacementCount === actual.verificationReplacementCount &&
            expected.promotionIntentRecorded === actual.promotionIntentRecorded &&
            expected.promotionAttemptCount === actual.promotionAttemptCount &&
            expected.promotionLastAttempt === actual.promotionLastAttempt &&
            expected.promotionFreshExactHeadReads === actual.promotionFreshExactHeadReads &&
            expected.promotionFreshExactHeadObservation === actual.promotionFreshExactHeadObservation &&
            expected.promotionTargetFactsCurrent === actual.promotionTargetFactsCurrent &&
            expected.promotionExpectedHeadVerified === actual.promotionExpectedHeadVerified &&
            expected.promotionGitObservation === actual.promotionGitObservation &&
            expected.promotionObservedTargetHead === actual.promotionObservedTargetHead &&
            expected.promotionCandidateAncestryProven === actual.promotionCandidateAncestryProven &&
            expected.promotionResultRecorded === actual.promotionResultRecorded &&
            expected.promotionResponseAmbiguous === actual.promotionResponseAmbiguous &&
            expected.promotionCompareAndSetRequested === actual.promotionCompareAndSetRequested &&
            expected.promotionForceRequested === actual.promotionForceRequested &&
            expected.promotionEquivalentContentAccepted === actual.promotionEquivalentContentAccepted &&
            expected.restartChoiceCommittedBeforeTerminal === actual.restartChoiceCommittedBeforeTerminal
          )
        })
    )
  },
  180_000
)
