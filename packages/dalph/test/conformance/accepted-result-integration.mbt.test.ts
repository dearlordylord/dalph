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
  workflowJournalEventVersion,
  type IntegrationCandidateAgentReport as CandidateReport,
  type IntegrationCandidateGitObservation as CandidateGitObservation,
  type IntegrationCandidateConstructionState,
  type IntegrationTargetResourceController,
  type JournalRecord,
  type QueuedIntegrationResponsibility,
  type StartedIntegrationResponsibility
} from "@dalph/orchestrator"
import { Effect, Layer, Schema } from "effect"

const runId = RunId.make("accepted-result-integration-model-run")
const target = IntegrationTarget.make({
  repository: GitRepositoryLocator.make("/repositories/accepted-result-integration.git"),
  ref: IntegrationTargetRef.make("refs/heads/master")
})
const correctionLimit = CandidateCorrectionLimit.make(1)
const continuationLimit = CandidateContinuationLimit.make(2)
const verificationPlanFor = (id: bigint) =>
  TargetVerificationPlan.make({ planId: TargetVerificationPlanId.make(`model-public-plan-${id}`), target })

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

const acceptedResultOf = (id: bigint): AcceptedResult => AcceptedResult.make({ commit: commitOf(id + 20n) })

const SpecResult = Schema.Struct({
  acceptedResultCommit: ITFBigInt,
  candidateJournalPosition: ITFBigInt,
  continuationCount: ITFBigInt,
  correctionCount: ITFBigInt,
  expectedTargetHead: ITFBigInt,
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
  verificationReplacementCount: ITFBigInt
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
  phase: Phase
  queuePosition: bigint
  preIntegrationCancellation: boolean
  targetHeld: boolean
  integrationSession: bigint
  submittedCandidate: bigint
  candidateJournalPosition: bigint
  expectedTargetHead: bigint
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
}

const initialModelResult = (id: bigint): ModelResult => ({
  phase: "NoAcceptedResult",
  queuePosition: 0n,
  preIntegrationCancellation: false,
  targetHeld: false,
  integrationSession: 0n,
  submittedCandidate: 0n,
  candidateJournalPosition: 0n,
  expectedTargetHead: 0n,
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
  verificationReplacementCount: 0n
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
  switch (candidate?._tag) {
    case undefined:
    case "CandidateConstructionInProgress":
      return "Started"
    case "CandidateValidationPending":
      return "CandidatePending"
    case "CandidateCorrectionRequired":
      return "CorrectionRequired"
    case "CandidateConstructed":
      return "CandidateReady"
    case "CandidateCorrectionLimitReached":
      return "CorrectionLimitReached"
    case "CandidateContinuationLimitReached":
      return "ContinuationLimitReached"
    case "CandidateCorrelationContradiction":
      return "CorrelationContradiction"
  }
}

const acceptedResultIntegrationDriver = defineDriver(
  {
    acceptResultOne: {},
    acceptResultTwo: {},
    gitReadFailsOne: {},
    gitReadFailsTwo: {},
    init: {},
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
    recoverCoordinator: {},
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
    const modelAcceptResult = (id: bigint): void => {
      updateModelResult(id, (result) => ({ ...result, phase: "AcceptedResult" }))
    }
    const modelQueueAcceptedResult = (id: bigint): void => {
      const queuePosition = modelNextJournalPosition
      modelNextJournalPosition += 1n
      updateModelResult(id, (result) => ({
        ...result,
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
      modelTargetReacquisitionRequired = false
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
      updateModelResults((result) => ({
        ...result,
        phase: result.phase === "CorrelationContradictionReleased" ? "CorrelationContradiction" : result.phase,
        targetHeld: false
      }))
      recovered = true
      modelRestartCount += 1n
      trackerFactsCurrent = false
      modelTargetFactsCurrent = false
      modelTargetHeadProof = 0n
      modelTargetReacquisitionRequired = true
    }
    const modelObserveTrackerFacts = (): void => {
      trackerFactsCurrent = true
    }
    const modelObserveTargetFacts = (id: bigint): void => {
      const result = modelResultFor(id)
      modelTargetFactsCurrent = true
      modelTargetHeadProof = result.expectedTargetHead === 0n ? id + 10n : result.expectedTargetHead
    }
    const modelReacquireIntegrationTarget = (id: bigint): void => {
      updateModelResult(id, (result) => ({ ...result, targetHeld: true }))
      modelTargetReacquisitionRequired = false
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
        correlation: constructed.event.correlation
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
    const submit = (id: bigint, candidate: bigint) =>
      Effect.gen(function* () {
        const correlation = correlationFor(id)
        nextAgentReport = IntegrationCandidateAgentReport.cases.Submitted.make({
          candidateCommit: commitOf(candidate),
          correlation
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
          yield* (yield* requireResources()).release(responsibilityFor(id))
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
            yield* (yield* requireResources()).release(responsibilityFor(id))
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
      queueAcceptedResultIntegrationResponsibility(idFor(id), acceptedResultOf(id), target).pipe(
        Effect.provide(journalLayer),
        Effect.orDie,
        Effect.tap(() => Effect.sync(() => modelQueueAcceptedResult(id)))
      )
    const releaseForeignCorrelationTarget = (id: bigint) =>
      Effect.gen(function* () {
        const responsibility = responsibilityFor(id)
        yield* (yield* requireResources()).release(responsibility)
        releasedContradictions = new Set(releasedContradictions).add(id)
        modelReleaseForeignCorrelationTarget(id)
      })
    const reacquireIntegrationTarget = (id: bigint) =>
      Effect.gen(function* () {
        const responsibility = responsibilityFor(id)
        const controller = yield* requireResources()
        yield* controller.acquire(responsibility).pipe(Effect.orDie)
        yield* controller.publishAcceptedOwnership(responsibility)
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
          responsibilities: admission().responsibilities.filter(
            (responsibility) =>
              responsibility._tag === "QueuedIntegrationResponsibility" ||
              snapshot.heldResponsibilityPositions.has(responsibility.queuedAt)
          )
        }
        const queued = selectStartableIntegrationResponsibilities(currentAdmission).find(
          (responsibility) => responsibility.plannedAttempt.attemptId === attempt.attemptId
        )
        if (queued === undefined) return yield* Effect.die(`result ${id} is not startable`)
        yield* controller.acquire(queued).pipe(Effect.orDie)
        yield* controller.publishAcceptedOwnership(queued)
        yield* startQueuedIntegration(queued).pipe(Effect.provide(journalLayer), Effect.orDie)
        modelStartIntegration(id)
      })
    const waitOnDependency = (id: bigint) =>
      Effect.gen(function* () {
        const responsibility = responsibilityFor(id)
        yield* (yield* requireResources()).release(responsibility)
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
        yield* (yield* requireResources()).release(responsibilityFor(id))
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
        yield* (yield* requireResources()).release(responsibilityFor(id))
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
        yield* (yield* requireResources()).release(responsibilityFor(id))
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
        yield* (yield* requireResources()).release(responsibilityFor(id))
        modelReportVerificationBoundaryFailure(id, "VerificationEvidenceFailure")
      })
    const offerPromotionPremise = (id: bigint) => Effect.sync(() => modelOfferPromotionPremise(id))
    const observeTargetFacts = (id: bigint) => Effect.sync(() => modelObserveTargetFacts(id))

    const concreteVerificationProjectionFor = (id: bigint, targetHeld: boolean): Partial<ModelResult> => {
      const candidateRecord = records.findLast(
        ({ event }) =>
          event._tag === "IntegrationCandidateConstructed" && event.correlation.attemptId === idFor(id).attemptId
      )
      if (candidateRecord?.event._tag !== "IntegrationCandidateConstructed") return {}
      const candidate = {
        candidateCommit: candidateRecord.event.candidateCommit,
        constructedAt: candidateRecord.position,
        correlation: candidateRecord.event.correlation
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
              const accepted = records.some(
                ({ event }) =>
                  event._tag === "PlannedAttemptExecutorWorkReported" &&
                  event.report._tag === "Terminal" &&
                  event.report.result._tag === "Accepted" &&
                  event.report.correlation.attemptId === attempt.attemptId
              )
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
                  )
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
        }),
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
      recoverCoordinator: () =>
        Effect.gen(function* () {
          resources = yield* makeIntegrationTargetResourceController()
          releasedContradictions = new Set()
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
    maxSteps: 20,
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
                  verificationOutcome: variantTag(result.verificationOutcome)
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
            expected.acceptedResultCommit === actual.acceptedResultCommit &&
            expected.candidateJournalPosition === actual.candidateJournalPosition &&
            expected.continuationCount === actual.continuationCount &&
            expected.correctionCount === actual.correctionCount &&
            expected.expectedTargetHead === actual.expectedTargetHead &&
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
            expected.verificationReplacementCount === actual.verificationReplacementCount
          )
        })
    )
  },
  30_000
)
