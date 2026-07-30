import { Effect, Match, Schema, type Brand } from "effect"
import {
  type AttemptId,
  type GitCommitSha,
  type PlannedAttemptExecutorReport,
  type RunId,
  type TaskBranchRef,
  type TaskExecutorLocator,
  type TaskId,
  type TaskRevision,
  type WorktreeLocator
} from "@dalph/contracts"
import {
  type ClaimOwner,
  type ClaimToken,
  type ControlCommand,
  type ControlCommandId,
  type FixtureTarget,
  type GithubIssueNumber,
  type GithubRepositoryName,
  type GithubRepositoryOwner,
  type OperationId,
  type PlannedAttemptExecutorReportOrdinal,
  type RunPolicyRevision,
  type TaskWorkCapacity,
  type TaskTrackerFactsObservation,
  type TrackerRevision,
  type WorkflowOperation
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
  | ControlCommandId
  | OperationId
  | RunId
  | TaskBranchRef
  | WorktreeLocator

/**
 * Values the cassette records but Dalph must not alpha-rename: task-tracker
 * identities, revisions, and claim owner; Git SHAs; configured executor and
 * tracker-target locators; the user identity already carried by a control
 * command; and executor-report ordinals.
 */
type PreservedCassetteBrand =
  | ClaimOwner
  | ControlCommand["operatorId"]
  | FixtureTarget
  | GitCommitSha
  | GithubIssueNumber
  | GithubRepositoryName
  | GithubRepositoryOwner
  | PlannedAttemptExecutorReportOrdinal
  | RunPolicyRevision
  | TaskWorkCapacity
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

const renameControlCommand = (command: ControlCommand, maps: IdentityRenamingMaps): ControlCommand => {
  switch (command._tag) {
    case "RequestRunPause":
      return completeFields<typeof command>({
        _tag: "RequestRunPause",
        commandId: renamed(command.commandId, maps.controlCommandIds),
        operatorId: preserveCassetteValue(command.operatorId),
        runId: renamed(command.runId, maps.runIds)
      })
    case "RequestRunUnpause":
      return completeFields<typeof command>({
        _tag: "RequestRunUnpause",
        commandId: renamed(command.commandId, maps.controlCommandIds),
        operatorId: preserveCassetteValue(command.operatorId),
        runId: renamed(command.runId, maps.runIds)
      })
    case "RequestTaskPause":
      return completeFields<typeof command>({
        _tag: "RequestTaskPause",
        commandId: renamed(command.commandId, maps.controlCommandIds),
        operatorId: preserveCassetteValue(command.operatorId),
        runId: renamed(command.runId, maps.runIds),
        taskId: preserveCassetteValue(command.taskId)
      })
    case "RequestTaskUnpause":
      return completeFields<typeof command>({
        _tag: "RequestTaskUnpause",
        commandId: renamed(command.commandId, maps.controlCommandIds),
        operatorId: preserveCassetteValue(command.operatorId),
        runId: renamed(command.runId, maps.runIds),
        taskId: preserveCassetteValue(command.taskId)
      })
  }
}

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
      ControlCommandRecorded: (commandEntry) =>
        completeFields<typeof commandEntry>({
          _tag: "ControlCommandRecorded",
          command: renameControlCommand(commandEntry.command, maps)
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
    controlCommandIds: identityRenamingMap<ControlCommandId>(renaming.controlCommandIds),
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
