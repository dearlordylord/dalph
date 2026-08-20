/* eslint-disable max-lines -- Exhaustive alpha-renaming keeps every closed recorded-cassette variant in one reviewable boundary. */
import { Effect, Match, Schema, type Brand } from "effect"
import {
  type AttemptId,
  type GitCommitSha,
  type GitRepositoryLocator,
  type IntegrationTargetRef,
  type PlannedAttemptExecutorReport,
  type RunId,
  type TaskBranchRef,
  type TaskExecutorLocator,
  type TaskId,
  type TaskRevision,
  type WorktreeLocator
} from "@dalph/contracts"
import {
  CompetingWorktreeRegistrations,
  ConflictingWorktreeRegistration,
  ContradictoryWorktreeState,
  type ClaimOwner,
  type ClaimToken,
  AttemptChoiceRequestId,
  type ControlDirectionApplicationOrdinal,
  type FixtureTarget,
  ForeignWorktreeRegistration,
  type GithubIssueNumber,
  type GithubRepositoryName,
  type GithubRepositoryOwner,
  type OperationId,
  type ActiveTaskClaim,
  type TaskClaimObservation,
  type PlannedAttemptWorktreeObservation,
  type PlannedAttemptExecutorCommandOrdinal,
  type PlannedAttemptExecutorCommandProjectionObservation,
  type PlannedAttemptExecutorCommandProjectionOrdinal,
  type PlannedAttemptExecutorReportOrdinal,
  type PlannedAttemptExecutorStateObservation,
  type PlannedAttemptExecutorStateObservationOrdinal,
  type RunPolicyRevision,
  type TaskWorkCapacity,
  type TaskClaimReacquisitionRequestId,
  type IntegrationQuarantineBasis,
  IntegrationQuarantineDirectionFingerprint,
  IntegrationQuarantineDirectionRequestId,
  type IntegrationQuarantineFailureDetail,
  type IntegratorCandidateResourceLocator,
  type IntegratorCandidateText,
  IntegratorSessionId,
  type IntegratorSessionCorrelation,
  type IntegratorGitObservationType,
  type IntegratorNotPreparedDetail,
  type IntegratorResultType,
  type IntegratorRunCorrelation,
  type IntegratorRunQualifiedCandidate,
  type JournalPosition,
  type EvidenceDigest,
  type TargetPromotionCorrelation,
  type CompletionTaskClaim,
  type PostPromotionBlockerClearAuthorization,
  postPromotionBlockerAncestryOperationIdFor,
  type CompletionTaskRequest,
  type CompletionTaskRequestLookup,
  type CompletionClaimObservation,
  type CompletionClaimDeletionRequest,
  type FocusedTaskCompletionFacts,
  type FocusedCompletedTaskObservation,
  type CompletionClaimRequestOrdinal,
  type CompletionTaskRequestOrdinal,
  type CompletionTaskAuthorizationReadOrdinal,
  type CompletionTaskConfirmationReadOrdinal,
  type CompletionTaskFocusedReadPurpose,
  completionTaskFocusedReadOperationIdFor,
  type TargetPromotionAttemptOrdinal,
  type TargetPromotionAttemptLimit,
  targetPromotionRequestIdForCandidate,
  type TaskTrackerFactsObservation,
  type TrackerRevision,
  type WorkflowOperation,
  GitWorktreeReadFailure,
  UntrackedWorktreePath,
  WorktreeBaseMismatch
} from "@dalph/orchestrator"
import {
  type CassetteIdentityRenaming as CassetteIdentityRenamingType,
  RecordedCassette,
  type RecordedCassette as RecordedCassetteType,
  RecordedCassetteEntry,
  type RecordedCassetteEntry as RecordedCassetteEntryType
} from "./recorded-domain.js"
import { isRecordedIntegrationEntry, renameRecordedIntegrationEntry } from "./recorded-integration-renaming.js"
import {
  preserveRecordedRunBeginning,
  preserveRecordedRunCancellation,
  preserveRecordedRunPolicyChange,
  preserveRecordedRunTermination
} from "./recorded-policy-renaming.js"
import {
  type RecordedOperationIdentityMaps,
  renamePlannedAttempt,
  renameWorkflowOperation
} from "./recorded-operation-renaming.js"

const identityRenamingMap = <Identity extends string>(
  renamings: ReadonlyArray<{ readonly from: Identity; readonly to: Identity }>
) => new Map(renamings.map(({ from, to }) => [from, to]))

type IdentityRenamingMaps = RecordedOperationIdentityMaps & {
  readonly [Family in keyof CassetteIdentityRenamingType]: ReadonlyMap<
    CassetteIdentityRenamingType[Family][number]["from"],
    CassetteIdentityRenamingType[Family][number]["to"]
  >
}

/** Identities allocated by Dalph and therefore eligible for cassette alpha-renaming. */
type GeneratedCassetteIdentity =
  | AttemptId
  | ClaimToken
  | IntegratorCandidateResourceLocator
  | IntegratorSessionId
  | OperationId
  | RunId
  | TaskBranchRef
  | WorktreeLocator

/**
 * Values the cassette records but Dalph must not alpha-rename: task-tracker
 * identities, revisions, and claim owner; Git SHAs; configured executor and
 * tracker-target locators and executor-report ordinals.
 */
type PreservedCassetteBrand =
  | ClaimOwner
  | ControlDirectionApplicationOrdinal
  | FixtureTarget
  | GitCommitSha
  | GitRepositoryLocator
  | GithubIssueNumber
  | GithubRepositoryName
  | GithubRepositoryOwner
  | PlannedAttemptExecutorReportOrdinal
  | PlannedAttemptExecutorCommandOrdinal
  | PlannedAttemptExecutorCommandProjectionOrdinal
  | PlannedAttemptExecutorStateObservationOrdinal
  | IntegrationTargetRef
  | JournalPosition
  | EvidenceDigest
  | IntegratorCandidateText
  | IntegratorNotPreparedDetail
  | IntegrationQuarantineFailureDetail
  | TargetPromotionAttemptOrdinal
  | TargetPromotionAttemptLimit
  | CompletionClaimRequestOrdinal
  | CompletionTaskRequestOrdinal
  | CompletionTaskAuthorizationReadOrdinal
  | CompletionTaskConfirmationReadOrdinal
  | RunPolicyRevision
  | TaskWorkCapacity
  | TaskClaimReacquisitionRequestId
  | TaskExecutorLocator
  | TaskId
  | TaskRevision
  | TrackerRevision

type ContainsGeneratedOrUnclassifiedBrand<Value> = Value extends GeneratedCassetteIdentity
  ? true
  : Value extends Brand.Brand<infer _Keys extends string>
    ? Value extends PreservedCassetteBrand
      ? false
      : true
    : Value extends ReadonlyArray<infer Item>
      ? ContainsGeneratedOrUnclassifiedBrand<Item>
      : Value extends object
        ? true extends {
            [Key in keyof Value]-?: ContainsGeneratedOrUnclassifiedBrand<Value[Key]>
          }[keyof Value]
          ? true
          : false
        : false

type PreservableCassetteValue<Value> = true extends ContainsGeneratedOrUnclassifiedBrand<Value> ? never : Value

/** Requires every field, including optional fields, to receive an explicit disposition. */
type CompleteFields<Value> = { readonly [Key in keyof Value]-?: Value[Key] }

const completeFields = <Value>(value: CompleteFields<Value>): Value => value
function completeFieldsWithOptionalRoot<Value extends { readonly rootTaskId?: TaskId }>(
  value: CompleteFields<Omit<Value, "rootTaskId">> & Pick<Value, "rootTaskId">
): Value
function completeFieldsWithOptionalRoot(value: unknown): unknown {
  return value
}

const preserveCassetteValue = <Value>(value: PreservableCassetteValue<Value>): Value => value

const renamed = <Identity>(value: Identity, map: ReadonlyMap<Identity, Identity>): Identity => map.get(value) ?? value

const renameExecutorReport = (
  report: PlannedAttemptExecutorReport,
  maps: IdentityRenamingMaps
): PlannedAttemptExecutorReport => {
  const correlation = completeFields<typeof report.correlation>({
    attemptId: renamed(report.correlation.attemptId, maps.attemptIds),
    runId: renamed(report.correlation.runId, maps.runIds)
  })
  return Match.value(report).pipe(
    Match.tagsExhaustive({
      Running: (value) => completeFields<typeof value>({ _tag: "Running", correlation }),
      SafelySuspended: (value) => completeFields<typeof value>({ _tag: "SafelySuspended", correlation }),
      Terminal: (value) =>
        completeFields<typeof value>({ _tag: "Terminal", correlation, result: preserveCassetteValue(value.result) })
    })
  )
}

const renameExecutorCommandProjectionObservation = (
  observation: PlannedAttemptExecutorCommandProjectionObservation,
  maps: IdentityRenamingMaps
): PlannedAttemptExecutorCommandProjectionObservation => {
  if (observation._tag === "ExactExecutorReport") {
    return { _tag: observation._tag, report: renameExecutorReport(observation.report, maps) }
  }
  if (observation._tag === "ExecutorReportContradiction") {
    return { _tag: observation._tag, observed: renameExecutorReport(observation.observed, maps) }
  }
  return observation
}

const renameExecutorStateObservation = (
  observation: PlannedAttemptExecutorStateObservation,
  maps: IdentityRenamingMaps
): PlannedAttemptExecutorStateObservation => {
  if (observation._tag === "ExactExecutorReport") {
    return { _tag: observation._tag, report: renameExecutorReport(observation.report, maps) }
  }
  if (observation._tag === "ExecutorReportContradiction") {
    return { _tag: observation._tag, observed: renameExecutorReport(observation.observed, maps) }
  }
  return observation
}

const renameActiveTaskClaim = (claim: ActiveTaskClaim, maps: IdentityRenamingMaps): ActiveTaskClaim => ({
  ...claim,
  operationId: renamed(claim.operationId, maps.operationIds),
  token: renamed(claim.token, maps.claimTokens)
})

const renameTaskClaimObservation = (
  observation: TaskClaimObservation,
  maps: IdentityRenamingMaps
): TaskClaimObservation =>
  observation._tag === "ActiveTaskClaim" ? renameActiveTaskClaim(observation, maps) : preserveCassetteValue(observation)

const renameCompletionClaimObservation = (
  observation: CompletionClaimObservation,
  maps: IdentityRenamingMaps
): CompletionClaimObservation => {
  if (observation._tag === "ActiveTaskClaim") return renameActiveTaskClaim(observation, maps)
  if (observation._tag === "CompletionTaskClaim") return renameCompletionTaskClaim(observation, maps)
  return observation
}

const renameFocusedTaskCompletionFacts = (
  facts: FocusedTaskCompletionFacts,
  maps: IdentityRenamingMaps
): FocusedTaskCompletionFacts =>
  completeFields<FocusedTaskCompletionFacts>({
    currentClaim: renameCompletionClaimObservation(facts.currentClaim, maps),
    lifecycle: preserveCassetteValue(facts.lifecycle),
    operationId: renamed(facts.operationId, maps.operationIds),
    target: preserveCassetteValue(facts.target),
    targetMembership: preserveCassetteValue(facts.targetMembership),
    taskId: preserveCassetteValue(facts.taskId),
    taskRevision: preserveCassetteValue(facts.taskRevision),
    trackerRevision: preserveCassetteValue(facts.trackerRevision),
    unfinishedPrerequisiteTaskIds: preserveCassetteValue(facts.unfinishedPrerequisiteTaskIds)
  })

const renameAttemptChoiceRequestId = (
  requestId: AttemptChoiceRequestId,
  maps: IdentityRenamingMaps
): AttemptChoiceRequestId =>
  AttemptChoiceRequestId.make({ nonce: requestId.nonce, runId: renamed(requestId.runId, maps.runIds) })

const renameIntegratorCandidateResource = (
  resource: IntegratorCandidateResourceLocator,
  maps: IdentityRenamingMaps
): IntegratorCandidateResourceLocator => maps.integratorCandidateResourceLocators.get(resource) ?? resource

const renameIntegratorSession = (sessionId: IntegratorSessionId, maps: IdentityRenamingMaps): IntegratorSessionId =>
  IntegratorSessionId.make(
    String(maps.integratorSessionIds.get(IntegratorSessionId.make(String(sessionId))) ?? sessionId)
  )

const renameIntegratorSessionCorrelation = (
  correlation: IntegratorSessionCorrelation,
  maps: IdentityRenamingMaps
): IntegratorSessionCorrelation =>
  completeFields<IntegratorSessionCorrelation>({
    acceptedResult: completeFields<typeof correlation.acceptedResult>({
      commit: preserveCassetteValue(correlation.acceptedResult.commit),
      evidenceManifest: completeFields<typeof correlation.acceptedResult.evidenceManifest>({
        byteLength: correlation.acceptedResult.evidenceManifest.byteLength,
        digest: preserveCassetteValue(correlation.acceptedResult.evidenceManifest.digest)
      })
    }),
    candidateResource: renameIntegratorCandidateResource(correlation.candidateResource, maps),
    expectedTargetHead: preserveCassetteValue(correlation.expectedTargetHead),
    integrationTarget: completeFields<typeof correlation.integrationTarget>({
      repository: preserveCassetteValue(correlation.integrationTarget.repository),
      ref: preserveCassetteValue(correlation.integrationTarget.ref)
    }),
    plannedAttempt: renamePlannedAttempt(correlation.plannedAttempt, maps),
    queuedAt: preserveCassetteValue(correlation.queuedAt),
    sessionId: renameIntegratorSession(correlation.sessionId, maps),
    startedAt: preserveCassetteValue(correlation.startedAt),
    targetLineageObservedAt: preserveCassetteValue(correlation.targetLineageObservedAt)
  })

const renameIntegratorRunCorrelation = (
  run: IntegratorRunCorrelation,
  maps: IdentityRenamingMaps
): IntegratorRunCorrelation =>
  completeFields<IntegratorRunCorrelation>({
    ordinal: run.ordinal,
    session: renameIntegratorSessionCorrelation(run.session, maps)
  })

const renameIntegratorRunQualifiedCandidate = (
  candidate: IntegratorRunQualifiedCandidate,
  maps: IdentityRenamingMaps
): IntegratorRunQualifiedCandidate =>
  completeFields<IntegratorRunQualifiedCandidate>({
    candidateCommit: preserveCassetteValue(candidate.candidateCommit),
    candidateText: preserveCassetteValue(candidate.candidateText),
    directParents: preserveCassetteValue(candidate.directParents),
    qualifiedAt: preserveCassetteValue(candidate.qualifiedAt),
    run: completeFields<typeof candidate.run>({
      ordinal: candidate.run.ordinal,
      session: renameIntegratorSessionCorrelation(candidate.run.session, maps)
    })
  })

const renameIntegratorGitObservation = (observation: IntegratorGitObservationType): IntegratorGitObservationType =>
  Match.valueTags(observation, {
    Commit: (value) =>
      completeFields<typeof value>({
        _tag: "Commit",
        candidateText: preserveCassetteValue(value.candidateText),
        commit: preserveCassetteValue(value.commit),
        directParents: preserveCassetteValue(value.directParents)
      }),
    Missing: (value) =>
      completeFields<typeof value>({ _tag: "Missing", candidateText: preserveCassetteValue(value.candidateText) }),
    NonCommit: (value) =>
      completeFields<typeof value>({
        _tag: "NonCommit",
        candidateText: preserveCassetteValue(value.candidateText),
        objectType: preserveCassetteValue(value.objectType)
      })
  })

const renameIntegrationQuarantineBasis = (basis: IntegrationQuarantineBasis): IntegrationQuarantineBasis =>
  Match.valueTags(basis, {
    ConclusiveResult: (value) =>
      completeFields<typeof value>({
        _tag: "ConclusiveResult",
        cause: Match.valueTags(value.cause, {
          InvalidCandidate: (cause) =>
            completeFields<typeof cause>({
              _tag: "InvalidCandidate",
              candidateText: preserveCassetteValue(cause.candidateText),
              observation: renameIntegratorGitObservation(cause.observation)
            }),
          NotPrepared: (cause) =>
            completeFields<typeof cause>({ _tag: "NotPrepared", detail: preserveCassetteValue(cause.detail) })
        }),
        evidence:
          value.evidence.candidateObservationAt === undefined
            ? { resultRecordedAt: preserveCassetteValue(value.evidence.resultRecordedAt) }
            : {
                candidateObservationAt: preserveCassetteValue(value.evidence.candidateObservationAt),
                resultRecordedAt: preserveCassetteValue(value.evidence.resultRecordedAt)
              }
      }),
    ProviderRunFailure: (value) =>
      completeFields<typeof value>({
        _tag: "ProviderRunFailure",
        detail: preserveCassetteValue(value.detail),
        ownedActivityProvenAbsentAt: preserveCassetteValue(value.ownedActivityProvenAbsentAt)
      }),
    RetryTargetHeadChanged: (value) =>
      completeFields<typeof value>({
        _tag: "RetryTargetHeadChanged",
        direction: preserveCassetteValue(value.direction),
        directionAppliedAt: preserveCassetteValue(value.directionAppliedAt),
        observedTargetHead: preserveCassetteValue(value.observedTargetHead),
        priorQuarantineAt: preserveCassetteValue(value.priorQuarantineAt),
        targetLineageObservedAt: preserveCassetteValue(value.targetLineageObservedAt)
      })
  })

const renameIntegrationQuarantineDirectionFingerprint = (
  fingerprint: IntegrationQuarantineDirectionFingerprint,
  maps: IdentityRenamingMaps
): IntegrationQuarantineDirectionFingerprint =>
  IntegrationQuarantineDirectionFingerprint.make({
    direction: preserveCassetteValue(fingerprint.direction),
    quarantineAt: preserveCassetteValue(fingerprint.quarantineAt),
    sessionId: renameIntegratorSession(fingerprint.sessionId, maps)
  })

const renameIntegrationQuarantineDirectionRequestId = (
  requestId: IntegrationQuarantineDirectionRequestId,
  maps: IdentityRenamingMaps
): IntegrationQuarantineDirectionRequestId =>
  IntegrationQuarantineDirectionRequestId.make({
    nonce: preserveCassetteValue(requestId.nonce),
    runId: renamed(requestId.runId, maps.runIds)
  })

const renameIntegratorResult = (result: IntegratorResultType, maps: IdentityRenamingMaps): IntegratorResultType =>
  Match.valueTags(result, {
    NotPrepared: (value) =>
      completeFields<typeof value>({
        _tag: "NotPrepared",
        correlation: renameIntegratorSessionCorrelation(value.correlation, maps),
        detail: preserveCassetteValue(value.detail)
      }),
    PreparedCandidate: (value) =>
      completeFields<typeof value>({
        _tag: "PreparedCandidate",
        candidateText: preserveCassetteValue(value.candidateText),
        correlation: renameIntegratorSessionCorrelation(value.correlation, maps)
      })
  })

const renameTargetPromotionCorrelation = (
  correlation: TargetPromotionCorrelation,
  maps: IdentityRenamingMaps
): TargetPromotionCorrelation => {
  const qualifiedCandidate = renameIntegratorRunQualifiedCandidate(correlation.qualifiedCandidate, maps)
  return completeFields<TargetPromotionCorrelation>({
    qualifiedCandidate,
    requestId: targetPromotionRequestIdForCandidate(qualifiedCandidate)
  })
}

const renameCompletionTaskClaim = (claim: CompletionTaskClaim, maps: IdentityRenamingMaps): CompletionTaskClaim =>
  completeFields<CompletionTaskClaim>({
    _tag: "CompletionTaskClaim",
    originalClaim: completeFields<typeof claim.originalClaim>({
      _tag: "ActiveTaskClaim",
      operationId: renamed(claim.originalClaim.operationId, maps.operationIds),
      owner: preserveCassetteValue(claim.originalClaim.owner),
      taskId: preserveCassetteValue(claim.originalClaim.taskId),
      token: renamed(claim.originalClaim.token, maps.claimTokens)
    }),
    plannedAttempt: renamePlannedAttempt(claim.plannedAttempt, maps),
    promotionCorrelation: renameTargetPromotionCorrelation(claim.promotionCorrelation, maps)
  })

const renamePostPromotionBlockerAuthorization = (
  authorization: PostPromotionBlockerClearAuthorization,
  maps: IdentityRenamingMaps
): PostPromotionBlockerClearAuthorization =>
  completeFields<PostPromotionBlockerClearAuthorization>({
    blockerClearedAt: preserveCassetteValue(authorization.blockerClearedAt),
    blockerObservedAt: preserveCassetteValue(authorization.blockerObservedAt),
    claim: renameCompletionTaskClaim(authorization.claim, maps)
  })

const renameCompletionTaskRequest = (
  request: CompletionTaskRequest,
  maps: IdentityRenamingMaps
): CompletionTaskRequest =>
  completeFields<CompletionTaskRequest>({
    claim: renameCompletionTaskClaim(request.claim, maps),
    operationId: renamed(request.operationId, maps.operationIds),
    taskId: preserveCassetteValue(request.taskId),
    taskRevision: preserveCassetteValue(request.taskRevision)
  })

const renameFocusedCompletedTaskObservation = (
  observation: FocusedCompletedTaskObservation,
  maps: IdentityRenamingMaps
): FocusedCompletedTaskObservation =>
  completeFields<FocusedCompletedTaskObservation>({
    _tag: "FocusedCompletedTaskObservation",
    claim: renameCompletionTaskClaim(observation.claim, maps),
    lifecycle: "CompletedSuccessfully",
    observedAt: preserveCassetteValue(observation.observedAt),
    operationId: renamed(observation.operationId, maps.operationIds),
    taskId: preserveCassetteValue(observation.taskId),
    taskRevision: preserveCassetteValue(observation.taskRevision),
    trackerRevision: preserveCassetteValue(observation.trackerRevision),
    target: preserveCassetteValue(observation.target)
  })

const renameCompletionSuccessObservation = renameFocusedCompletedTaskObservation

const renameCompletionTaskRequestLookup = (
  lookup: CompletionTaskRequestLookup,
  maps: IdentityRenamingMaps
): CompletionTaskRequestLookup =>
  Match.value(lookup).pipe(
    Match.tagsExhaustive({
      Applied: (value) =>
        completeFields<typeof value>({ _tag: "Applied", request: renameCompletionTaskRequest(value.request, maps) }),
      NotApplied: (value) =>
        completeFields<typeof value>({ _tag: "NotApplied", request: renameCompletionTaskRequest(value.request, maps) }),
      Unreadable: (value) =>
        completeFields<typeof value>({
          _tag: "Unreadable",
          detail: value.detail,
          request: renameCompletionTaskRequest(value.request, maps)
        })
    })
  )

const preserveCompletionTaskFocusedReadPurpose = (
  purpose: CompletionTaskFocusedReadPurpose
): CompletionTaskFocusedReadPurpose =>
  Match.valueTags(purpose, {
    Authorization: (value) =>
      completeFields<typeof value>({
        _tag: "Authorization",
        attemptOrdinal: preserveCassetteValue(value.attemptOrdinal),
        authorizationOrdinal: preserveCassetteValue(value.authorizationOrdinal)
      }),
    Confirmation: (value) =>
      completeFields<typeof value>({
        _tag: "Confirmation",
        attemptOrdinal: preserveCassetteValue(value.attemptOrdinal),
        confirmationOrdinal: preserveCassetteValue(value.confirmationOrdinal)
      })
  })

const renameCompletionClaimDeletionRequest = (
  request: CompletionClaimDeletionRequest,
  maps: IdentityRenamingMaps
): CompletionClaimDeletionRequest => ({
  claim: renameCompletionTaskClaim(request.claim, maps),
  operationId: renamed(request.operationId, maps.operationIds),
  successObservation: renameCompletionSuccessObservation(request.successObservation, maps)
})

const renamePlannedAttemptWorktreeObservation = (
  observation: PlannedAttemptWorktreeObservation,
  maps: IdentityRenamingMaps
): PlannedAttemptWorktreeObservation =>
  Match.value(observation).pipe(
    Match.tagsExhaustive({
      AttemptWorktreeLost: (value) =>
        completeFields<typeof value>({
          _tag: "AttemptWorktreeLost",
          plannedAttempt: renamePlannedAttempt(value.plannedAttempt, maps)
        }),
      CompetingWorktreeRegistrations: (value) =>
        new CompetingWorktreeRegistrations({
          observedBranchAtPlannedWorktree: renamed(value.observedBranchAtPlannedWorktree, maps.taskBranchRefs),
          observedHeadAtPlannedWorktree: preserveCassetteValue(value.observedHeadAtPlannedWorktree),
          plannedBranch: renamed(value.plannedBranch, maps.taskBranchRefs),
          plannedBranchRegisteredWorktree: renamed(value.plannedBranchRegisteredWorktree, maps.worktreeLocators),
          plannedWorktree: renamed(value.plannedWorktree, maps.worktreeLocators)
        }),
      ConflictingWorktreeRegistration: (value) =>
        new ConflictingWorktreeRegistration({
          observedBranch: renamed(value.observedBranch, maps.taskBranchRefs),
          observedHead: preserveCassetteValue(value.observedHead),
          plannedBranch: renamed(value.plannedBranch, maps.taskBranchRefs),
          worktree: renamed(value.worktree, maps.worktreeLocators)
        }),
      ContradictoryWorktreeState: (value) =>
        new ContradictoryWorktreeState({
          detail: preserveCassetteValue(value.detail),
          worktree: renamed(value.worktree, maps.worktreeLocators)
        }),
      ForeignWorktreeRegistration: (value) =>
        new ForeignWorktreeRegistration({
          branch: renamed(value.branch, maps.taskBranchRefs),
          plannedWorktree: renamed(value.plannedWorktree, maps.worktreeLocators),
          registeredWorktree: renamed(value.registeredWorktree, maps.worktreeLocators)
        }),
      PlannedWorktreeReady: (value) =>
        completeFields<typeof value>({
          _tag: "PlannedWorktreeReady",
          baseSha: preserveCassetteValue(value.baseSha),
          branch: renamed(value.branch, maps.taskBranchRefs),
          headSha: preserveCassetteValue(value.headSha),
          worktree: renamed(value.worktree, maps.worktreeLocators)
        }),
      UntrackedWorktreePath: (value) =>
        new UntrackedWorktreePath({ worktree: renamed(value.worktree, maps.worktreeLocators) }),
      WorktreeBaseMismatch: (value) =>
        new WorktreeBaseMismatch({
          baseSha: preserveCassetteValue(value.baseSha),
          branch: renamed(value.branch, maps.taskBranchRefs),
          headSha: preserveCassetteValue(value.headSha),
          worktree: renamed(value.worktree, maps.worktreeLocators)
        })
    })
  )

type CompleteFactFamilies = Extract<
  TaskTrackerFactsObservation,
  { readonly _tag: "CompleteTaskTrackerFacts" }
>["factFamilies"]
type ReconfirmedFactFamilies = Extract<
  TaskTrackerFactsObservation,
  { readonly _tag: "UnchangedTaskTrackerFactsReconfirmed" }
>["factFamilies"]
type FocusedFactFamily = Extract<
  TaskTrackerFactsObservation,
  { readonly _tag: "FocusedTaskWorkSpecificationFacts" }
>["factFamily"]
type TrackerFactFamily = CompleteFactFamilies[number] | FocusedFactFamily | ReconfirmedFactFamilies[number]
type WithoutFreshness<Value> = Value extends unknown ? Omit<Value, "freshness"> : never
type PreservableProof<Value> = true extends ContainsGeneratedOrUnclassifiedBrand<Value> ? never : true

const trackerFactFieldsWithoutFreshnessArePreservable: PreservableProof<WithoutFreshness<TrackerFactFamily>> = true

function renameFreshness<Fact extends TrackerFactFamily>(fact: Fact, maps: IdentityRenamingMaps): Fact
function renameFreshness(fact: TrackerFactFamily, maps: IdentityRenamingMaps): TrackerFactFamily {
  const { freshness, ...preservedFactFields } = fact
  void trackerFactFieldsWithoutFreshnessArePreservable
  return {
    ...preservedFactFields,
    freshness: completeFields<typeof freshness>({
      _tag: "ObservedDuringLogicalRead",
      operationId: renamed(freshness.operationId, maps.operationIds)
    })
  }
}

const renameFactFamilies = <
  First extends TrackerFactFamily,
  Second extends TrackerFactFamily,
  Third extends TrackerFactFamily,
  Fourth extends TrackerFactFamily,
  Fifth extends TrackerFactFamily
>(
  factFamilies: readonly [First, Second, Third, Fourth, Fifth],
  maps: IdentityRenamingMaps
): readonly [First, Second, Third, Fourth, Fifth] => [
  renameFreshness(factFamilies[0], maps),
  renameFreshness(factFamilies[1], maps),
  renameFreshness(factFamilies[2], maps),
  renameFreshness(factFamilies[3], maps),
  renameFreshness(factFamilies[4], maps)
]

const renameTrackerFactsObservation = (
  observation: TaskTrackerFactsObservation,
  maps: IdentityRenamingMaps
): TaskTrackerFactsObservation =>
  Match.value(observation).pipe(
    Match.tagsExhaustive({
      CompleteTaskTrackerFacts: (value) =>
        completeFieldsWithOptionalRoot<typeof value>({
          _tag: "CompleteTaskTrackerFacts",
          factFamilies: renameFactFamilies(value.factFamilies, maps),
          operationId: renamed(value.operationId, maps.operationIds),
          ...(value.rootTaskId === undefined ? {} : { rootTaskId: preserveCassetteValue(value.rootTaskId) }),
          target: preserveCassetteValue(value.target)
        }),
      FocusedTaskCompletionFacts: (value) =>
        (() => {
          const request = renameCompletionTaskRequest(value.request, maps)
          const operationId = completionTaskFocusedReadOperationIdFor(request, value.purpose)
          return completeFields<typeof value>({
            _tag: "FocusedTaskCompletionFacts",
            facts: { ...renameFocusedTaskCompletionFacts(value.facts, maps), operationId },
            operationId,
            purpose: preserveCompletionTaskFocusedReadPurpose(value.purpose),
            request,
            target: preserveCassetteValue(value.target)
          })
        })(),
      FocusedTaskWorkSpecificationFacts: (value) =>
        completeFields<typeof value>({
          _tag: "FocusedTaskWorkSpecificationFacts",
          factFamily: renameFreshness(value.factFamily, maps),
          operationId: renamed(value.operationId, maps.operationIds),
          target: preserveCassetteValue(value.target)
        }),
      FocusedTaskClaimFacts: (value) =>
        completeFields<typeof value>({
          ...value,
          freshness: { ...value.freshness, operationId: renamed(value.freshness.operationId, maps.operationIds) },
          observation:
            value.observation._tag === "ActiveTaskClaim"
              ? {
                  ...value.observation,
                  operationId: renamed(value.observation.operationId, maps.operationIds),
                  token: renamed(value.observation.token, maps.claimTokens)
                }
              : preserveCassetteValue(value.observation),
          operationId: renamed(value.operationId, maps.operationIds),
          target: preserveCassetteValue(value.target)
        }),
      FocusedTaskClaimFactsUnreadable: (value) =>
        completeFields<typeof value>({
          ...value,
          operationId: renamed(value.operationId, maps.operationIds),
          target: preserveCassetteValue(value.target)
        }),
      TaskTrackerFactsReadFailed: (value) =>
        completeFields<typeof value>({
          ...value,
          operationId: renamed(value.operationId, maps.operationIds),
          target: preserveCassetteValue(value.target)
        }),
      UnchangedTaskTrackerFactsReconfirmed: (value) =>
        completeFieldsWithOptionalRoot<typeof value>({
          _tag: "UnchangedTaskTrackerFactsReconfirmed",
          factFamilies: renameFactFamilies(value.factFamilies, maps),
          operationId: renamed(value.operationId, maps.operationIds),
          priorFullObservationOperationId: renamed(value.priorFullObservationOperationId, maps.operationIds),
          ...(value.rootTaskId === undefined ? {} : { rootTaskId: preserveCassetteValue(value.rootTaskId) }),
          target: preserveCassetteValue(value.target)
        })
    })
  )

type RecordedOperationEntry = Extract<RecordedCassetteEntryType, { readonly operation: WorkflowOperation }>
type WithoutOperation<Value> = Value extends unknown ? Omit<Value, "operation"> : never
const RecordedOperationEntrySchema = RecordedCassetteEntry.pipe(
  Schema.refine((entry): entry is RecordedOperationEntry => "operation" in entry)
)

const recordedOperationEntryFieldsWithoutOperationArePreservable: PreservableProof<
  WithoutOperation<RecordedOperationEntry>
> = true

function renameRecordedOperationEntry<Entry extends RecordedOperationEntry>(
  entry: Entry,
  maps: IdentityRenamingMaps
): Entry
function renameRecordedOperationEntry(
  entry: RecordedOperationEntry,
  maps: IdentityRenamingMaps
): RecordedOperationEntry {
  const { operation, ...preservedEntryFields } = entry
  void recordedOperationEntryFieldsWithoutOperationArePreservable
  return Schema.decodeUnknownSync(RecordedOperationEntrySchema)({
    ...preservedEntryFields,
    operation: renameWorkflowOperation(operation, maps, (request) => renameCompletionTaskRequest(request, maps))
  })
}

const renameRecordedCassetteEntry = (
  entry: RecordedCassetteEntryType,
  maps: IdentityRenamingMaps
): RecordedCassetteEntryType =>
  Match.value(entry).pipe(
    Match.when(
      (candidate): candidate is RecordedOperationEntry => "operation" in candidate,
      (operationEntry) => renameRecordedOperationEntry(operationEntry, maps)
    ),
    Match.when(isRecordedIntegrationEntry, (integrationEntry) =>
      renameRecordedIntegrationEntry(integrationEntry, (attempt) => renamePlannedAttempt(attempt, maps))
    ),
    Match.tags({
      IntegratorSessionFixed: (entry) =>
        completeFields<typeof entry>({
          _tag: "IntegratorSessionFixed",
          correlation: renameIntegratorSessionCorrelation(entry.correlation, maps)
        }),
      IntegratorSuccessorSessionFixed: (entry) =>
        completeFields<typeof entry>({
          _tag: "IntegratorSuccessorSessionFixed",
          direction: preserveCassetteValue(entry.direction),
          directionAppliedAt: preserveCassetteValue(entry.directionAppliedAt),
          predecessor: renameIntegratorSessionCorrelation(entry.predecessor, maps),
          quarantineAt: preserveCassetteValue(entry.quarantineAt),
          successor: renameIntegratorSessionCorrelation(entry.successor, maps),
          successorGeneration: preserveCassetteValue(entry.successorGeneration)
        }),
      IntegratorRunStarted: (entry) =>
        completeFields<typeof entry>({
          _tag: "IntegratorRunStarted",
          run: renameIntegratorRunCorrelation(entry.run, maps)
        }),
      IntegratorRunResultRecorded: (entry) =>
        completeFields<typeof entry>({
          _tag: "IntegratorRunResultRecorded",
          result: renameIntegratorResult(entry.result, maps),
          run: renameIntegratorRunCorrelation(entry.run, maps)
        }),
      IntegratorRunCandidateGitReadIntended: (entry) =>
        completeFields<typeof entry>({
          _tag: "IntegratorRunCandidateGitReadIntended",
          candidateText: preserveCassetteValue(entry.candidateText),
          run: renameIntegratorRunCorrelation(entry.run, maps)
        }),
      IntegratorRunCandidateGitObserved: (entry) =>
        completeFields<typeof entry>({
          _tag: "IntegratorRunCandidateGitObserved",
          candidateText: preserveCassetteValue(entry.candidateText),
          observation: renameIntegratorGitObservation(entry.observation),
          run: renameIntegratorRunCorrelation(entry.run, maps)
        }),
      IntegrationProviderRunActivityAbsent: (entry) =>
        completeFields<typeof entry>({
          _tag: "IntegrationProviderRunActivityAbsent",
          correlation: renameIntegratorSessionCorrelation(entry.correlation, maps),
          detail: preserveCassetteValue(entry.detail),
          occurrenceClassification: preserveCassetteValue(entry.occurrenceClassification),
          run: renameIntegratorRunCorrelation(entry.run, maps)
        }),
      IntegrationQuarantined: (entry) =>
        completeFields<typeof entry>({
          _tag: "IntegrationQuarantined",
          basis: renameIntegrationQuarantineBasis(entry.basis),
          correlation: renameIntegratorSessionCorrelation(entry.correlation, maps),
          occurrenceClassification: preserveCassetteValue(entry.occurrenceClassification)
        }),
      IntegrationQuarantineDirectionApplied: (entry) =>
        completeFields<typeof entry>({
          _tag: "IntegrationQuarantineDirectionApplied",
          fingerprint: renameIntegrationQuarantineDirectionFingerprint(entry.fingerprint, maps),
          initiatedBy: preserveCassetteValue(entry.initiatedBy),
          occurrenceClassification: preserveCassetteValue(entry.occurrenceClassification),
          requestId: renameIntegrationQuarantineDirectionRequestId(entry.requestId, maps)
        }),
      TargetPromotionIntended: (entry) =>
        completeFields<typeof entry>({
          _tag: "TargetPromotionIntended",
          correlation: renameTargetPromotionCorrelation(entry.correlation, maps),
          initiatedBy: preserveCassetteValue(entry.initiatedBy),
          occurrenceClassification: preserveCassetteValue(entry.occurrenceClassification)
        }),
      TargetPromotionAttemptIntended: (entry) =>
        completeFields<typeof entry>({
          _tag: "TargetPromotionAttemptIntended",
          attemptOrdinal: preserveCassetteValue(entry.attemptOrdinal),
          correlation: renameTargetPromotionCorrelation(entry.correlation, maps),
          initiatedBy: preserveCassetteValue(entry.initiatedBy),
          occurrenceClassification: preserveCassetteValue(entry.occurrenceClassification),
          reason: preserveCassetteValue(entry.reason)
        }),
      TargetPromotionObservedSuccess: (entry) =>
        completeFields<typeof entry>({
          _tag: "TargetPromotionObservedSuccess",
          basis: preserveCassetteValue(entry.basis),
          correlation: renameTargetPromotionCorrelation(entry.correlation, maps),
          observation: preserveCassetteValue(entry.observation),
          occurrenceClassification: preserveCassetteValue(entry.occurrenceClassification)
        }),
      TargetPromotionStale: (entry) =>
        completeFields<typeof entry>({
          _tag: "TargetPromotionStale",
          basis: preserveCassetteValue(entry.basis),
          correlation: renameTargetPromotionCorrelation(entry.correlation, maps),
          observation: preserveCassetteValue(entry.observation),
          occurrenceClassification: preserveCassetteValue(entry.occurrenceClassification)
        }),
      TargetPromotionNonConvergence: (entry) =>
        completeFields<typeof entry>({
          _tag: "TargetPromotionNonConvergence",
          attemptLimit: preserveCassetteValue(entry.attemptLimit),
          attemptOrdinal: preserveCassetteValue(entry.attemptOrdinal),
          correlation: renameTargetPromotionCorrelation(entry.correlation, maps),
          lastObservation: preserveCassetteValue(entry.lastObservation),
          occurrenceClassification: preserveCassetteValue(entry.occurrenceClassification)
        }),
      CompletionClaimReplacementIntended: (entry) =>
        completeFields<typeof entry>({
          _tag: "CompletionClaimReplacementIntended",
          claim: renameCompletionTaskClaim(entry.claim, maps),
          initiatedBy: preserveCassetteValue(entry.initiatedBy),
          occurrenceClassification: preserveCassetteValue(entry.occurrenceClassification),
          operationId: renamed(entry.operationId, maps.operationIds)
        }),
      CompletionClaimReplacementAttemptIntended: (entry) =>
        completeFields<typeof entry>({
          _tag: "CompletionClaimReplacementAttemptIntended",
          attemptOrdinal: preserveCassetteValue(entry.attemptOrdinal),
          claim: renameCompletionTaskClaim(entry.claim, maps),
          initiatedBy: preserveCassetteValue(entry.initiatedBy),
          occurrenceClassification: preserveCassetteValue(entry.occurrenceClassification),
          operationId: renamed(entry.operationId, maps.operationIds)
        }),
      CompletionClaimReplaced: (entry) =>
        completeFields<typeof entry>({
          _tag: "CompletionClaimReplaced",
          claim: renameCompletionTaskClaim(entry.claim, maps),
          occurrenceClassification: preserveCassetteValue(entry.occurrenceClassification),
          operationId: renamed(entry.operationId, maps.operationIds)
        }),
      CompletionClaimDeletionIntended: (entry) =>
        completeFields<typeof entry>({
          _tag: "CompletionClaimDeletionIntended",
          claim: renameCompletionTaskClaim(entry.claim, maps),
          initiatedBy: preserveCassetteValue(entry.initiatedBy),
          occurrenceClassification: preserveCassetteValue(entry.occurrenceClassification),
          operationId: renamed(entry.operationId, maps.operationIds),
          successObservation: renameCompletionSuccessObservation(entry.successObservation, maps)
        }),
      CompletionClaimDeletionAttemptIntended: (entry) =>
        completeFields<typeof entry>({
          _tag: "CompletionClaimDeletionAttemptIntended",
          attemptOrdinal: preserveCassetteValue(entry.attemptOrdinal),
          claim: renameCompletionTaskClaim(entry.claim, maps),
          initiatedBy: preserveCassetteValue(entry.initiatedBy),
          occurrenceClassification: preserveCassetteValue(entry.occurrenceClassification),
          operationId: renamed(entry.operationId, maps.operationIds),
          successObservation: renameCompletionSuccessObservation(entry.successObservation, maps)
        }),
      CompletionClaimDeletionReadObserved: (entry) =>
        completeFields<typeof entry>({
          _tag: "CompletionClaimDeletionReadObserved",
          observation: renameCompletionClaimObservation(entry.observation, maps),
          occurrenceClassification: preserveCassetteValue(entry.occurrenceClassification),
          purpose: entry.purpose,
          replacementOperationId: renamed(entry.replacementOperationId, maps.operationIds),
          request: renameCompletionClaimDeletionRequest(entry.request, maps)
        }),
      CompletionClaimDeleted: (entry) =>
        completeFields<typeof entry>({
          _tag: "CompletionClaimDeleted",
          claim: renameCompletionTaskClaim(entry.claim, maps),
          occurrenceClassification: preserveCassetteValue(entry.occurrenceClassification),
          operationId: renamed(entry.operationId, maps.operationIds),
          successObservation: renameCompletionSuccessObservation(entry.successObservation, maps)
        }),
      IntegrationFinalitySettled: (entry) =>
        completeFields<typeof entry>({
          _tag: "IntegrationFinalitySettled",
          claim: renameCompletionTaskClaim(entry.claim, maps),
          deletionOperationId: renamed(entry.deletionOperationId, maps.operationIds),
          occurrenceClassification: preserveCassetteValue(entry.occurrenceClassification),
          replacementOperationId: renamed(entry.replacementOperationId, maps.operationIds),
          successObservation: renameCompletionSuccessObservation(entry.successObservation, maps)
        }),
      CompletionTaskIntended: (entry) =>
        completeFields<typeof entry>({
          _tag: "CompletionTaskIntended",
          initiatedBy: preserveCassetteValue(entry.initiatedBy),
          occurrenceClassification: preserveCassetteValue(entry.occurrenceClassification),
          request: renameCompletionTaskRequest(entry.request, maps)
        }),
      CompletionTaskAttemptIntended: (entry) =>
        completeFields<typeof entry>({
          _tag: "CompletionTaskAttemptIntended",
          attemptOrdinal: preserveCassetteValue(entry.attemptOrdinal),
          focusedFactsOperationId: renamed(entry.focusedFactsOperationId, maps.operationIds),
          gitReadOperationId: renamed(entry.gitReadOperationId, maps.operationIds),
          initiatedBy: preserveCassetteValue(entry.initiatedBy),
          occurrenceClassification: preserveCassetteValue(entry.occurrenceClassification),
          request: renameCompletionTaskRequest(entry.request, maps)
        }),
      CompletionTaskAcknowledged: (entry) =>
        completeFields<typeof entry>({
          _tag: "CompletionTaskAcknowledged",
          acknowledgement: completeFields<typeof entry.acknowledgement>({
            operationId: renamed(entry.acknowledgement.operationId, maps.operationIds),
            taskId: preserveCassetteValue(entry.acknowledgement.taskId)
          }),
          attemptOrdinal: preserveCassetteValue(entry.attemptOrdinal),
          occurrenceClassification: preserveCassetteValue(entry.occurrenceClassification),
          request: renameCompletionTaskRequest(entry.request, maps)
        }),
      CompletionTaskResponseLost: (entry) =>
        completeFields<typeof entry>({
          _tag: "CompletionTaskResponseLost",
          attemptOrdinal: preserveCassetteValue(entry.attemptOrdinal),
          occurrenceClassification: preserveCassetteValue(entry.occurrenceClassification),
          request: renameCompletionTaskRequest(entry.request, maps)
        }),
      CompletionTaskRejected: (entry) =>
        completeFields<typeof entry>({
          _tag: "CompletionTaskRejected",
          attemptOrdinal: preserveCassetteValue(entry.attemptOrdinal),
          detail: preserveCassetteValue(entry.detail),
          occurrenceClassification: preserveCassetteValue(entry.occurrenceClassification),
          request: renameCompletionTaskRequest(entry.request, maps)
        }),
      CompletionTaskCandidateAncestryReadIntended: (entry) =>
        completeFields<typeof entry>({
          _tag: "CompletionTaskCandidateAncestryReadIntended",
          attemptOrdinal: preserveCassetteValue(entry.attemptOrdinal),
          initiatedBy: preserveCassetteValue(entry.initiatedBy),
          occurrenceClassification: preserveCassetteValue(entry.occurrenceClassification),
          operationId: renamed(entry.operationId, maps.operationIds),
          request: renameCompletionTaskRequest(entry.request, maps)
        }),
      CompletionTaskCandidateAncestryObserved: (entry) =>
        completeFields<typeof entry>({
          _tag: "CompletionTaskCandidateAncestryObserved",
          attemptOrdinal: preserveCassetteValue(entry.attemptOrdinal),
          observation: preserveCassetteValue(entry.observation),
          occurrenceClassification: preserveCassetteValue(entry.occurrenceClassification),
          operationId: renamed(entry.operationId, maps.operationIds),
          request: renameCompletionTaskRequest(entry.request, maps)
        }),
      PostPromotionBlockerCandidateAncestryReadIntended: (entry) => {
        const authorization = renamePostPromotionBlockerAuthorization(entry.authorization, maps)
        return completeFields<typeof entry>({
          _tag: "PostPromotionBlockerCandidateAncestryReadIntended",
          authorization,
          initiatedBy: preserveCassetteValue(entry.initiatedBy),
          occurrenceClassification: preserveCassetteValue(entry.occurrenceClassification),
          operationId: postPromotionBlockerAncestryOperationIdFor(authorization)
        })
      },
      PostPromotionBlockerCandidateAncestryObserved: (entry) => {
        const authorization = renamePostPromotionBlockerAuthorization(entry.authorization, maps)
        return completeFields<typeof entry>({
          _tag: "PostPromotionBlockerCandidateAncestryObserved",
          authorization,
          observation: preserveCassetteValue(entry.observation),
          occurrenceClassification: preserveCassetteValue(entry.occurrenceClassification),
          operationId: postPromotionBlockerAncestryOperationIdFor(authorization)
        })
      },
      CompletionTaskRequestLookupIntended: (entry) =>
        completeFields<typeof entry>({
          _tag: "CompletionTaskRequestLookupIntended",
          attemptOrdinal: preserveCassetteValue(entry.attemptOrdinal),
          initiatedBy: preserveCassetteValue(entry.initiatedBy),
          occurrenceClassification: preserveCassetteValue(entry.occurrenceClassification),
          operationId: renamed(entry.operationId, maps.operationIds),
          request: renameCompletionTaskRequest(entry.request, maps)
        }),
      CompletionTaskRequestLookupObserved: (entry) =>
        completeFields<typeof entry>({
          _tag: "CompletionTaskRequestLookupObserved",
          attemptOrdinal: preserveCassetteValue(entry.attemptOrdinal),
          lookup: renameCompletionTaskRequestLookup(entry.lookup, maps),
          occurrenceClassification: preserveCassetteValue(entry.occurrenceClassification),
          operationId: renamed(entry.operationId, maps.operationIds),
          request: renameCompletionTaskRequest(entry.request, maps)
        }),
      AttemptChoiceApplied: (choiceEntry) =>
        completeFields<typeof choiceEntry>({
          _tag: "AttemptChoiceApplied",
          choice: preserveCassetteValue(choiceEntry.choice),
          initiatedBy: preserveCassetteValue(choiceEntry.initiatedBy),
          occurrenceClassification: preserveCassetteValue(choiceEntry.occurrenceClassification),
          requestId: renameAttemptChoiceRequestId(choiceEntry.requestId, maps),
          subject: completeFields<typeof choiceEntry.subject>({
            observedTaskRevision: preserveCassetteValue(choiceEntry.subject.observedTaskRevision),
            plannedAttempt: renamePlannedAttempt(choiceEntry.subject.plannedAttempt, maps)
          })
        }),
      PlannedAttemptReplaced: (replacementEntry) =>
        completeFields<typeof replacementEntry>({
          _tag: "PlannedAttemptReplaced",
          initiatedBy: preserveCassetteValue(replacementEntry.initiatedBy),
          occurrenceClassification: preserveCassetteValue(replacementEntry.occurrenceClassification),
          requestId: renameAttemptChoiceRequestId(replacementEntry.requestId, maps),
          subject: completeFields<typeof replacementEntry.subject>({
            observedTaskRevision: preserveCassetteValue(replacementEntry.subject.observedTaskRevision),
            plannedAttempt: renamePlannedAttempt(replacementEntry.subject.plannedAttempt, maps)
          }),
          successorPlan: completeFields<typeof replacementEntry.successorPlan>({
            _tag: "RecordTaskAttemptPlan",
            operationId: renamed(replacementEntry.successorPlan.operationId, maps.operationIds),
            plannedAttempt: renamePlannedAttempt(replacementEntry.successorPlan.plannedAttempt, maps),
            predecessorOperationIds: replacementEntry.successorPlan.predecessorOperationIds.map((operationId) =>
              renamed(operationId, maps.operationIds)
            )
          }),
          witness: completeFields<typeof replacementEntry.witness>({
            claimObservationOperationId: renamed(
              replacementEntry.witness.claimObservationOperationId,
              maps.operationIds
            ),
            expectedClaim: renameActiveTaskClaim(replacementEntry.witness.expectedClaim, maps),
            graphObservationOperationId: renamed(
              replacementEntry.witness.graphObservationOperationId,
              maps.operationIds
            ),
            oldWorktreeObservationOperationId: renamed(
              replacementEntry.witness.oldWorktreeObservationOperationId,
              maps.operationIds
            ),
            oldWorktreeProof: completeFields<typeof replacementEntry.witness.oldWorktreeProof>({
              _tag: "PlannedWorktreeReady",
              baseSha: preserveCassetteValue(replacementEntry.witness.oldWorktreeProof.baseSha),
              branch: renamed(replacementEntry.witness.oldWorktreeProof.branch, maps.taskBranchRefs),
              headSha: preserveCassetteValue(replacementEntry.witness.oldWorktreeProof.headSha),
              worktree: renamed(replacementEntry.witness.oldWorktreeProof.worktree, maps.worktreeLocators)
            }),
            quiescenceProof: preserveCassetteValue(replacementEntry.witness.quiescenceProof),
            specificationObservationOperationId: renamed(
              replacementEntry.witness.specificationObservationOperationId,
              maps.operationIds
            ),
            targetHeadSha: preserveCassetteValue(replacementEntry.witness.targetHeadSha),
            targetLineageObservationOperationId: renamed(
              replacementEntry.witness.targetLineageObservationOperationId,
              maps.operationIds
            )
          })
        }),
      AttemptRestartAuthorityReadFailed: (failureEntry) =>
        completeFields<typeof failureEntry>({
          _tag: "AttemptRestartAuthorityReadFailed",
          failure:
            failureEntry.failure._tag === "GitWorktreeReadFailure"
              ? new GitWorktreeReadFailure({
                  detail: failureEntry.failure.detail,
                  worktree: renamed(failureEntry.failure.worktree, maps.worktreeLocators)
                })
              : preserveCassetteValue(failureEntry.failure),
          occurrenceClassification: preserveCassetteValue(failureEntry.occurrenceClassification),
          operationId: renamed(failureEntry.operationId, maps.operationIds),
          requestId: renameAttemptChoiceRequestId(failureEntry.requestId, maps),
          subject: completeFields<typeof failureEntry.subject>({
            observedTaskRevision: preserveCassetteValue(failureEntry.subject.observedTaskRevision),
            plannedAttempt: renamePlannedAttempt(failureEntry.subject.plannedAttempt, maps)
          })
        }),
      AttemptStoppageIntended: (intentEntry) =>
        completeFields<typeof intentEntry>({
          _tag: "AttemptStoppageIntended",
          initiatedBy: preserveCassetteValue(intentEntry.initiatedBy),
          occurrenceClassification: preserveCassetteValue(intentEntry.occurrenceClassification),
          requestId: renameAttemptChoiceRequestId(intentEntry.requestId, maps),
          subject: completeFields<typeof intentEntry.subject>({
            observedTaskRevision: preserveCassetteValue(intentEntry.subject.observedTaskRevision),
            plannedAttempt: renamePlannedAttempt(intentEntry.subject.plannedAttempt, maps)
          })
        }),
      AttemptImplementationAbandoned: (abandonedEntry) =>
        completeFields<typeof abandonedEntry>({
          _tag: "AttemptImplementationAbandoned",
          expectedClaim: renameActiveTaskClaim(abandonedEntry.expectedClaim, maps),
          initiatedBy: preserveCassetteValue(abandonedEntry.initiatedBy),
          occurrenceClassification: preserveCassetteValue(abandonedEntry.occurrenceClassification),
          proof: preserveCassetteValue(abandonedEntry.proof),
          requestId: renameAttemptChoiceRequestId(abandonedEntry.requestId, maps),
          subject: completeFields<typeof abandonedEntry.subject>({
            observedTaskRevision: preserveCassetteValue(abandonedEntry.subject.observedTaskRevision),
            plannedAttempt: renamePlannedAttempt(abandonedEntry.subject.plannedAttempt, maps)
          })
        }),
      StoppedAttemptClaimNoReleaseObserved: (observationEntry) =>
        completeFields<typeof observationEntry>({
          _tag: "StoppedAttemptClaimNoReleaseObserved",
          expectedClaim: renameActiveTaskClaim(observationEntry.expectedClaim, maps),
          observation: renameTaskClaimObservation(observationEntry.observation, maps),
          observationOperationId: renamed(observationEntry.observationOperationId, maps.operationIds),
          occurrenceClassification: preserveCassetteValue(observationEntry.occurrenceClassification),
          requestId: renameAttemptChoiceRequestId(observationEntry.requestId, maps),
          subject: completeFields<typeof observationEntry.subject>({
            observedTaskRevision: preserveCassetteValue(observationEntry.subject.observedTaskRevision),
            plannedAttempt: renamePlannedAttempt(observationEntry.subject.plannedAttempt, maps)
          })
        }),
      CancelledAttemptImplementationResponsibilityRelinquished: (relinquishedEntry) =>
        completeFields<typeof relinquishedEntry>({
          _tag: "CancelledAttemptImplementationResponsibilityRelinquished",
          authorizedClaim: renameActiveTaskClaim(relinquishedEntry.authorizedClaim, maps),
          cancellationAppliedAt: preserveCassetteValue(relinquishedEntry.cancellationAppliedAt),
          initiatedBy: preserveCassetteValue(relinquishedEntry.initiatedBy),
          occurrenceClassification: preserveCassetteValue(relinquishedEntry.occurrenceClassification),
          plannedAttempt: renamePlannedAttempt(relinquishedEntry.plannedAttempt, maps),
          proof: preserveCassetteValue(relinquishedEntry.proof)
        }),
      CancelledAttemptClaimNoReleaseObserved: (observationEntry) =>
        completeFields<typeof observationEntry>({
          _tag: "CancelledAttemptClaimNoReleaseObserved",
          cancellationAppliedAt: preserveCassetteValue(observationEntry.cancellationAppliedAt),
          expectedClaim: renameActiveTaskClaim(observationEntry.expectedClaim, maps),
          observation: renameTaskClaimObservation(observationEntry.observation, maps),
          observationOperationId: renamed(observationEntry.observationOperationId, maps.operationIds),
          occurrenceClassification: preserveCassetteValue(observationEntry.occurrenceClassification),
          plannedAttempt: renamePlannedAttempt(observationEntry.plannedAttempt, maps)
        }),
      ControlDirectionApplied: (directionEntry) =>
        completeFields<typeof directionEntry>({
          _tag: "ControlDirectionApplied",
          direction: preserveCassetteValue(directionEntry.direction),
          initiatedBy: preserveCassetteValue(directionEntry.initiatedBy),
          occurrenceClassification: preserveCassetteValue(directionEntry.occurrenceClassification),
          ordinal: preserveCassetteValue(directionEntry.ordinal),
          subject:
            directionEntry.subject._tag === "Run"
              ? { _tag: "Run", runId: renamed(directionEntry.subject.runId, maps.runIds) }
              : {
                  _tag: "Task",
                  runId: renamed(directionEntry.subject.runId, maps.runIds),
                  taskId: preserveCassetteValue(directionEntry.subject.taskId)
                }
        }),
      TaskClaimReacquisitionDirected: (directionEntry) =>
        completeFields<typeof directionEntry>({
          _tag: "TaskClaimReacquisitionDirected",
          initiatedBy: preserveCassetteValue(directionEntry.initiatedBy),
          occurrenceClassification: preserveCassetteValue(directionEntry.occurrenceClassification),
          requestId: preserveCassetteValue(directionEntry.requestId),
          taskId: preserveCassetteValue(directionEntry.taskId)
        }),
      PlannedAttemptExecutorWorkReported: (reportEntry) =>
        completeFields<typeof reportEntry>({
          _tag: "PlannedAttemptExecutorWorkReported",
          occurrenceClassification: preserveCassetteValue(reportEntry.occurrenceClassification),
          ordinal: preserveCassetteValue(reportEntry.ordinal),
          report: renameExecutorReport(reportEntry.report, maps)
        }),
      PlannedAttemptExecutorCommandIntended: (intentEntry) =>
        completeFields<typeof intentEntry>({
          _tag: "PlannedAttemptExecutorCommandIntended",
          command: preserveCassetteValue(intentEntry.command),
          initiatedBy: preserveCassetteValue(intentEntry.initiatedBy),
          occurrenceClassification: preserveCassetteValue(intentEntry.occurrenceClassification),
          ordinal: preserveCassetteValue(intentEntry.ordinal),
          plannedAttempt: renamePlannedAttempt(intentEntry.plannedAttempt, maps)
        }),
      PlannedAttemptExecutorCommandProjectionObserved: (observationEntry) =>
        completeFields<typeof observationEntry>({
          _tag: "PlannedAttemptExecutorCommandProjectionObserved",
          commandOrdinal: preserveCassetteValue(observationEntry.commandOrdinal),
          observation: renameExecutorCommandProjectionObservation(observationEntry.observation, maps),
          occurrenceClassification: preserveCassetteValue(observationEntry.occurrenceClassification),
          plannedAttempt: renamePlannedAttempt(observationEntry.plannedAttempt, maps),
          projectionOrdinal: preserveCassetteValue(observationEntry.projectionOrdinal)
        }),
      PlannedAttemptExecutorCommandResponseContradicted: (observationEntry) =>
        completeFields<typeof observationEntry>({
          _tag: "PlannedAttemptExecutorCommandResponseContradicted",
          commandOrdinal: preserveCassetteValue(observationEntry.commandOrdinal),
          observed: renameExecutorReport(observationEntry.observed, maps),
          occurrenceClassification: preserveCassetteValue(observationEntry.occurrenceClassification),
          plannedAttempt: renamePlannedAttempt(observationEntry.plannedAttempt, maps)
        }),
      PlannedAttemptExecutorStateObserved: (observationEntry) =>
        completeFields<typeof observationEntry>({
          _tag: "PlannedAttemptExecutorStateObserved",
          observation: renameExecutorStateObservation(observationEntry.observation, maps),
          occurrenceClassification: preserveCassetteValue(observationEntry.occurrenceClassification),
          ordinal: preserveCassetteValue(observationEntry.ordinal),
          plannedAttempt: renamePlannedAttempt(observationEntry.plannedAttempt, maps)
        }),
      PlannedAttemptExecutorWorkResponsibilityBegan: (responsibilityEntry) =>
        completeFields<typeof responsibilityEntry>({
          _tag: "PlannedAttemptExecutorWorkResponsibilityBegan",
          initiatedBy: preserveCassetteValue(responsibilityEntry.initiatedBy),
          occurrenceClassification: preserveCassetteValue(responsibilityEntry.occurrenceClassification),
          plannedAttempt: renamePlannedAttempt(responsibilityEntry.plannedAttempt, maps)
        }),
      PlannedAttemptContinuationAuthorized: (authorizationEntry) =>
        completeFields<typeof authorizationEntry>({
          _tag: "PlannedAttemptContinuationAuthorized",
          plannedAttempt: renamePlannedAttempt(authorizationEntry.plannedAttempt, maps),
          witness: {
            activeTaskContinuationRead: {
              graphObservationOperationId: renamed(
                authorizationEntry.witness.activeTaskContinuationRead.graphObservationOperationId,
                maps.operationIds
              ),
              taskClaimObservationOperationId: renamed(
                authorizationEntry.witness.activeTaskContinuationRead.taskClaimObservationOperationId,
                maps.operationIds
              ),
              taskWorkSpecificationObservationOperationId: renamed(
                authorizationEntry.witness.activeTaskContinuationRead.taskWorkSpecificationObservationOperationId,
                maps.operationIds
              )
            },
            worktreeObservationOperationId: renamed(
              authorizationEntry.witness.worktreeObservationOperationId,
              maps.operationIds
            )
          }
        }),
      PlannedAttemptWorktreeObserved: (observationEntry) =>
        completeFields<typeof observationEntry>({
          _tag: "PlannedAttemptWorktreeObserved",
          observation: renamePlannedAttemptWorktreeObservation(observationEntry.observation, maps),
          occurrenceClassification: preserveCassetteValue(observationEntry.occurrenceClassification),
          originatingActionOperationId: renamed(observationEntry.originatingActionOperationId, maps.operationIds)
        }),
      TargetLineageObserved: (observationEntry) =>
        completeFields<typeof observationEntry>({
          _tag: "TargetLineageObserved",
          observation: preserveCassetteValue(observationEntry.observation),
          occurrenceClassification: preserveCassetteValue(observationEntry.occurrenceClassification),
          originatingActionOperationId: renamed(observationEntry.originatingActionOperationId, maps.operationIds),
          plannedAttempt: renamePlannedAttempt(observationEntry.plannedAttempt, maps)
        }),
      TaskClaimAcquired: (claimEntry) =>
        completeFields<typeof claimEntry>({
          _tag: "TaskClaimAcquired",
          claim: completeFields<typeof claimEntry.claim>({
            _tag: "ActiveTaskClaim",
            operationId: renamed(claimEntry.claim.operationId, maps.operationIds),
            owner: preserveCassetteValue(claimEntry.claim.owner),
            taskId: preserveCassetteValue(claimEntry.claim.taskId),
            token: renamed(claimEntry.claim.token, maps.claimTokens)
          })
        }),
      TaskClaimAcquisitionRejected: (rejectedEntry) =>
        completeFields<typeof rejectedEntry>({
          _tag: "TaskClaimAcquisitionRejected",
          observed: completeFields<typeof rejectedEntry.observed>({
            _tag: "ActiveTaskClaim",
            operationId: renamed(rejectedEntry.observed.operationId, maps.operationIds),
            owner: preserveCassetteValue(rejectedEntry.observed.owner),
            taskId: preserveCassetteValue(rejectedEntry.observed.taskId),
            token: renamed(rejectedEntry.observed.token, maps.claimTokens)
          }),
          operationId: renamed(rejectedEntry.operationId, maps.operationIds),
          reason: preserveCassetteValue(rejectedEntry.reason)
        }),
      TaskClaimReleased: (releaseEntry) =>
        completeFields<typeof releaseEntry>({
          _tag: "TaskClaimReleased",
          release: completeFields<typeof releaseEntry.release>({
            claim: completeFields<typeof releaseEntry.release.claim>({
              _tag: "ActiveTaskClaim",
              operationId: renamed(releaseEntry.release.claim.operationId, maps.operationIds),
              owner: preserveCassetteValue(releaseEntry.release.claim.owner),
              taskId: preserveCassetteValue(releaseEntry.release.claim.taskId),
              token: renamed(releaseEntry.release.claim.token, maps.claimTokens)
            }),
            operationId: renamed(releaseEntry.release.operationId, maps.operationIds)
          })
        }),
      TaskTrackerFactsObserved: (observationEntry) =>
        (() => {
          const evidence = renameTrackerFactsObservation(observationEntry.evidence, maps)
          return completeFields<typeof observationEntry>({
            _tag: "TaskTrackerFactsObserved",
            evidence,
            occurrenceClassification: preserveCassetteValue(observationEntry.occurrenceClassification),
            originatingActionOperationId: evidence.operationId
          })
        })(),
      TaskWorkCapacityChanged: preserveRecordedRunPolicyChange,
      TaskWorktreeReady: (worktreeEntry) =>
        completeFields<typeof worktreeEntry>({
          _tag: "TaskWorktreeReady",
          operationId: renamed(worktreeEntry.operationId, maps.operationIds),
          proof: completeFields<typeof worktreeEntry.proof>({
            _tag: "PlannedWorktreeReady",
            baseSha: preserveCassetteValue(worktreeEntry.proof.baseSha),
            branch: renamed(worktreeEntry.proof.branch, maps.taskBranchRefs),
            headSha: preserveCassetteValue(worktreeEntry.proof.headSha),
            worktree: renamed(worktreeEntry.proof.worktree, maps.worktreeLocators)
          })
        }),
      WorkflowRunBegan: preserveRecordedRunBeginning,
      WorkflowRunTerminated: preserveRecordedRunTermination,
      RunCancellationApplied: preserveRecordedRunCancellation
    }),
    Match.exhaustive
  )

/** Applies an exhaustive per-entry alpha-renaming through the cassette Schema boundary. */
export const renameRecordedCassette = Effect.fn("ScenarioCassette.renameRecorded")(function* (
  cassette: RecordedCassetteType,
  renaming: CassetteIdentityRenamingType
) {
  const maps = completeFields<IdentityRenamingMaps>({
    attemptIds: identityRenamingMap<AttemptId>(renaming.attemptIds),
    claimTokens: identityRenamingMap<ClaimToken>(renaming.claimTokens),
    integratorCandidateResourceLocators: identityRenamingMap<IntegratorCandidateResourceLocator>(
      renaming.integratorCandidateResourceLocators
    ),
    integratorSessionIds: identityRenamingMap<IntegratorSessionId>(renaming.integratorSessionIds),
    operationIds: identityRenamingMap<OperationId>(renaming.operationIds),
    runIds: identityRenamingMap<RunId>(renaming.runIds),
    taskBranchRefs: identityRenamingMap<TaskBranchRef>(renaming.taskBranchRefs),
    worktreeLocators: identityRenamingMap<WorktreeLocator>(renaming.worktreeLocators)
  })
  return yield* Schema.decodeUnknownEffect(RecordedCassette)(
    RecordedCassette.make(
      completeFields<RecordedCassetteType>({
        entries: cassette.entries.map((entry) => renameRecordedCassetteEntry(entry, maps)),
        runId: renamed(cassette.runId, maps.runIds),
        schemaVersion: preserveCassetteValue(cassette.schemaVersion),
        _tag: "RecordedCassette"
      })
    )
  )
})

export { invertCassetteIdentityRenaming } from "./recorded-renaming-inversion.js"
