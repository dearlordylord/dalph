/* eslint-disable max-lines -- Exhaustive alpha-renaming keeps every closed recorded-cassette variant in one reviewable boundary. */
import { Effect, Match, Schema, type Brand } from "effect"
import {
  type AttemptId,
  type GitCommitSha,
  type GitRepositoryLocator,
  type IntegrationTarget,
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
  type ControlDirectionApplicationOrdinal,
  type FixtureTarget,
  ForeignWorktreeRegistration,
  type GithubIssueNumber,
  type GithubRepositoryName,
  type GithubRepositoryOwner,
  type OperationId,
  type PlannedAttemptWorktreeObservation,
  type PlannedAttemptExecutorReportOrdinal,
  type RunPolicyRevision,
  type TaskWorkCapacity,
  type TaskClaimReacquisitionRequestId,
  type IntegrationCandidateAgentReport,
  type IntegrationCandidateAgentReportOrdinal,
  type IntegrationCandidateGitValidationAttemptOrdinal,
  type CandidateCorrectionLimit,
  type CandidateContinuationLimit,
  type IntegrationCandidateCorrelation,
  type IntegrationCandidateId,
  type IntegrationCandidateResourceLocator,
  type IntegrationSessionId,
  type TaskTrackerFactsObservation,
  type TrackerRevision,
  type WorkflowOperation,
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
  | IntegrationCandidateId
  | IntegrationCandidateResourceLocator
  | IntegrationSessionId
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
  | IntegrationTargetRef
  | IntegrationCandidateAgentReportOrdinal
  | IntegrationCandidateGitValidationAttemptOrdinal
  | CandidateCorrectionLimit
  | CandidateContinuationLimit
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
  switch (report._tag) {
    case "Running":
      return completeFields<typeof report>({ _tag: "Running", correlation })
    case "SafelySuspended":
      return completeFields<typeof report>({ _tag: "SafelySuspended", correlation })
    case "Terminal":
      return completeFields<typeof report>({
        _tag: "Terminal",
        correlation,
        result: preserveCassetteValue(report.result)
      })
  }
}

const renameCandidateCorrelation = (
  correlation: IntegrationCandidateCorrelation,
  maps: IdentityRenamingMaps
): IntegrationCandidateCorrelation =>
  completeFields<IntegrationCandidateCorrelation>({
    acceptedResultCommit: preserveCassetteValue(correlation.acceptedResultCommit),
    attemptId: renamed(correlation.attemptId, maps.attemptIds),
    candidateId: renamed(correlation.candidateId, maps.integrationCandidateIds),
    candidateResource: renamed(correlation.candidateResource, maps.integrationCandidateResourceLocators),
    expectedTargetHead: preserveCassetteValue(correlation.expectedTargetHead),
    integrationSessionId: renamed(correlation.integrationSessionId, maps.integrationSessionIds),
    integrationTarget: completeFields<IntegrationTarget>({
      repository: preserveCassetteValue(correlation.integrationTarget.repository),
      ref: preserveCassetteValue(correlation.integrationTarget.ref)
    }),
    runId: renamed(correlation.runId, maps.runIds)
  })

const renameCandidateAgentReport = (
  report: IntegrationCandidateAgentReport,
  maps: IdentityRenamingMaps
): IntegrationCandidateAgentReport => {
  const correlation = renameCandidateCorrelation(report.correlation, maps)
  switch (report._tag) {
    case "Conflict":
      return completeFields<typeof report>({ _tag: "Conflict", correlation })
    case "ExitedWithoutCandidate":
      return completeFields<typeof report>({ _tag: "ExitedWithoutCandidate", correlation })
    case "Submitted":
      return completeFields<typeof report>({
        _tag: "Submitted",
        candidateCommit: preserveCassetteValue(report.candidateCommit),
        correlation
      })
    case "Working":
      return completeFields<typeof report>({ _tag: "Working", correlation })
  }
}

// eslint-disable-next-line complexity -- Distinct worktree facts carry different generated locators and require exhaustive renaming.
const renamePlannedAttemptWorktreeObservation = (
  observation: PlannedAttemptWorktreeObservation,
  maps: IdentityRenamingMaps
): PlannedAttemptWorktreeObservation => {
  switch (observation._tag) {
    case "AttemptWorktreeLost":
      return completeFields<typeof observation>({
        _tag: "AttemptWorktreeLost",
        plannedAttempt: renamePlannedAttempt(observation.plannedAttempt, maps)
      })
    case "CompetingWorktreeRegistrations":
      return new CompetingWorktreeRegistrations({
        observedBranchAtPlannedWorktree: renamed(observation.observedBranchAtPlannedWorktree, maps.taskBranchRefs),
        observedHeadAtPlannedWorktree: preserveCassetteValue(observation.observedHeadAtPlannedWorktree),
        plannedBranch: renamed(observation.plannedBranch, maps.taskBranchRefs),
        plannedBranchRegisteredWorktree: renamed(observation.plannedBranchRegisteredWorktree, maps.worktreeLocators),
        plannedWorktree: renamed(observation.plannedWorktree, maps.worktreeLocators)
      })
    case "ConflictingWorktreeRegistration":
      return new ConflictingWorktreeRegistration({
        observedBranch: renamed(observation.observedBranch, maps.taskBranchRefs),
        observedHead: preserveCassetteValue(observation.observedHead),
        plannedBranch: renamed(observation.plannedBranch, maps.taskBranchRefs),
        worktree: renamed(observation.worktree, maps.worktreeLocators)
      })
    case "ContradictoryWorktreeState":
      return new ContradictoryWorktreeState({
        detail: preserveCassetteValue(observation.detail),
        worktree: renamed(observation.worktree, maps.worktreeLocators)
      })
    case "ForeignWorktreeRegistration":
      return new ForeignWorktreeRegistration({
        branch: renamed(observation.branch, maps.taskBranchRefs),
        plannedWorktree: renamed(observation.plannedWorktree, maps.worktreeLocators),
        registeredWorktree: renamed(observation.registeredWorktree, maps.worktreeLocators)
      })
    case "PlannedWorktreeReady":
      return completeFields<typeof observation>({
        _tag: "PlannedWorktreeReady",
        baseSha: preserveCassetteValue(observation.baseSha),
        branch: renamed(observation.branch, maps.taskBranchRefs),
        headSha: preserveCassetteValue(observation.headSha),
        worktree: renamed(observation.worktree, maps.worktreeLocators)
      })
    case "UntrackedWorktreePath":
      return new UntrackedWorktreePath({ worktree: renamed(observation.worktree, maps.worktreeLocators) })
    case "WorktreeBaseMismatch":
      return new WorktreeBaseMismatch({
        baseSha: preserveCassetteValue(observation.baseSha),
        branch: renamed(observation.branch, maps.taskBranchRefs),
        headSha: preserveCassetteValue(observation.headSha),
        worktree: renamed(observation.worktree, maps.worktreeLocators)
      })
  }
}

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
): TaskTrackerFactsObservation => {
  switch (observation._tag) {
    case "CompleteTaskTrackerFacts":
      return completeFields<typeof observation>({
        _tag: "CompleteTaskTrackerFacts",
        factFamilies: renameFactFamilies(observation.factFamilies, maps),
        operationId: renamed(observation.operationId, maps.operationIds),
        target: preserveCassetteValue(observation.target)
      })
    case "FocusedTaskWorkSpecificationFacts":
      return completeFields<typeof observation>({
        _tag: "FocusedTaskWorkSpecificationFacts",
        factFamily: renameFreshness(observation.factFamily, maps),
        operationId: renamed(observation.operationId, maps.operationIds),
        target: preserveCassetteValue(observation.target)
      })
    case "FocusedTaskClaimFacts":
      return completeFields<typeof observation>({
        ...observation,
        freshness: {
          ...observation.freshness,
          operationId: renamed(observation.freshness.operationId, maps.operationIds)
        },
        observation:
          observation.observation._tag === "ActiveTaskClaim"
            ? {
                ...observation.observation,
                operationId: renamed(observation.observation.operationId, maps.operationIds),
                token: renamed(observation.observation.token, maps.claimTokens)
              }
            : preserveCassetteValue(observation.observation),
        operationId: renamed(observation.operationId, maps.operationIds),
        target: preserveCassetteValue(observation.target)
      })
    case "FocusedTaskClaimFactsUnreadable":
      return completeFields<typeof observation>({
        ...observation,
        operationId: renamed(observation.operationId, maps.operationIds),
        target: preserveCassetteValue(observation.target)
      })
    case "UnchangedTaskTrackerFactsReconfirmed":
      return completeFields<typeof observation>({
        _tag: "UnchangedTaskTrackerFactsReconfirmed",
        factFamilies: renameFactFamilies(observation.factFamilies, maps),
        operationId: renamed(observation.operationId, maps.operationIds),
        priorFullObservationOperationId: renamed(observation.priorFullObservationOperationId, maps.operationIds),
        target: preserveCassetteValue(observation.target)
      })
  }
}

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
    operation: renameWorkflowOperation(operation, maps)
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
      IntegrationCandidateConstructionIntended: (candidateEntry) => {
        const correlation = renameCandidateCorrelation(candidateEntry.correlation, maps)
        return completeFields<typeof candidateEntry>({
          _tag: "IntegrationCandidateConstructionIntended",
          correlation,
          correctionLimit: preserveCassetteValue(candidateEntry.correctionLimit),
          continuationLimit: preserveCassetteValue(candidateEntry.continuationLimit),
          initiatedBy: preserveCassetteValue(candidateEntry.initiatedBy),
          occurrenceClassification: preserveCassetteValue(candidateEntry.occurrenceClassification),
          plannedAttempt: renamePlannedAttempt(candidateEntry.plannedAttempt, maps)
        })
      },
      IntegrationCandidateAgentReported: (candidateEntry) =>
        completeFields<typeof candidateEntry>({
          _tag: "IntegrationCandidateAgentReported",
          expectedCorrelation: renameCandidateCorrelation(candidateEntry.expectedCorrelation, maps),
          occurrenceClassification: preserveCassetteValue(candidateEntry.occurrenceClassification),
          ordinal: preserveCassetteValue(candidateEntry.ordinal),
          report: renameCandidateAgentReport(candidateEntry.report, maps)
        }),
      IntegrationCandidateGitObserved: (candidateEntry) =>
        completeFields<typeof candidateEntry>({
          _tag: "IntegrationCandidateGitObserved",
          candidateCommit: preserveCassetteValue(candidateEntry.candidateCommit),
          correlation: renameCandidateCorrelation(candidateEntry.correlation, maps),
          observation: preserveCassetteValue(candidateEntry.observation),
          occurrenceClassification: preserveCassetteValue(candidateEntry.occurrenceClassification)
        }),
      IntegrationCandidateConstructed: (candidateEntry) =>
        completeFields<typeof candidateEntry>({
          _tag: "IntegrationCandidateConstructed",
          candidateCommit: preserveCassetteValue(candidateEntry.candidateCommit),
          correlation: renameCandidateCorrelation(candidateEntry.correlation, maps),
          occurrenceClassification: preserveCassetteValue(candidateEntry.occurrenceClassification)
        }),
      IntegrationCandidateGitValidationFailed: (candidateEntry) =>
        completeFields<typeof candidateEntry>({
          _tag: "IntegrationCandidateGitValidationFailed",
          attemptOrdinal: preserveCassetteValue(candidateEntry.attemptOrdinal),
          candidateCommit: preserveCassetteValue(candidateEntry.candidateCommit),
          correlation: renameCandidateCorrelation(candidateEntry.correlation, maps),
          detail: preserveCassetteValue(candidateEntry.detail),
          occurrenceClassification: preserveCassetteValue(candidateEntry.occurrenceClassification)
        }),
      IntegrationCandidateCorrectionLimitReached: (candidateEntry) =>
        completeFields<typeof candidateEntry>({
          _tag: "IntegrationCandidateCorrectionLimitReached",
          correctionCount: preserveCassetteValue(candidateEntry.correctionCount),
          correctionLimit: preserveCassetteValue(candidateEntry.correctionLimit),
          correlation: renameCandidateCorrelation(candidateEntry.correlation, maps),
          occurrenceClassification: preserveCassetteValue(candidateEntry.occurrenceClassification)
        }),
      IntegrationCandidateContinuationLimitReached: (candidateEntry) =>
        completeFields<typeof candidateEntry>({
          _tag: "IntegrationCandidateContinuationLimitReached",
          continuationCount: preserveCassetteValue(candidateEntry.continuationCount),
          continuationLimit: preserveCassetteValue(candidateEntry.continuationLimit),
          correlation: renameCandidateCorrelation(candidateEntry.correlation, maps),
          occurrenceClassification: preserveCassetteValue(candidateEntry.occurrenceClassification)
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
      PlannedAttemptExecutorWorkResponsibilityBegan: (responsibilityEntry) =>
        completeFields<typeof responsibilityEntry>({
          _tag: "PlannedAttemptExecutorWorkResponsibilityBegan",
          initiatedBy: preserveCassetteValue(responsibilityEntry.initiatedBy),
          occurrenceClassification: preserveCassetteValue(responsibilityEntry.occurrenceClassification),
          plannedAttempt: renamePlannedAttempt(responsibilityEntry.plannedAttempt, maps)
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
        completeFields<typeof observationEntry>({
          _tag: "TaskTrackerFactsObserved",
          evidence: renameTrackerFactsObservation(observationEntry.evidence, maps),
          occurrenceClassification: preserveCassetteValue(observationEntry.occurrenceClassification),
          originatingActionOperationId: renamed(observationEntry.originatingActionOperationId, maps.operationIds)
        }),
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
      WorkflowRunTerminated: preserveRecordedRunTermination
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
    integrationCandidateIds: identityRenamingMap<IntegrationCandidateId>(renaming.integrationCandidateIds),
    integrationCandidateResourceLocators: identityRenamingMap<IntegrationCandidateResourceLocator>(
      renaming.integrationCandidateResourceLocators
    ),
    integrationSessionIds: identityRenamingMap<IntegrationSessionId>(renaming.integrationSessionIds),
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
