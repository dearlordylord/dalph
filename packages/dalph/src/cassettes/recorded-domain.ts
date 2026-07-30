import { Effect, Schema } from "effect"
import {
  AttemptId,
  PlannedAttemptExecutorReport,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  WorktreeLocator
} from "@dalph/contracts"
import {
  ActiveTaskClaim,
  ClaimToken,
  ControlCommand,
  ControlCommandId,
  OperationId,
  PlannedAttemptExecutorReportOrdinal,
  PlannedWorktreeReady,
  TrackerTarget,
  TaskTrackerFactsObservation,
  WorkflowActor,
  WorkflowOperation
} from "@dalph/orchestrator"

const initiatedByCoordinator = {
  initiatedBy: WorkflowActor.cases.DalphCoordinator,
  occurrenceClassification: Schema.Literal("InitiatedAction")
}
const nonActionOccurrence = { occurrenceClassification: Schema.Literal("NonActionOccurrence") }

/**
 * One domain meaning per journaled fact. Ordering belongs to the entry array;
 * physical journal keys, positions, payload versions, and storage encoding do
 * not belong to this boundary.
 */
export const RecordedCassetteEntry = Schema.TaggedUnion({
  ControlCommandRecorded: { command: ControlCommand },
  PlannedAttemptExecutorWorkReported: {
    ...nonActionOccurrence,
    ordinal: PlannedAttemptExecutorReportOrdinal,
    report: PlannedAttemptExecutorReport
  },
  PlannedAttemptExecutorWorkResponsibilityBegan: { ...initiatedByCoordinator, plannedAttempt: PlannedTaskAttempt },
  TaskAttemptPlanned: { operation: WorkflowOperation.cases.RecordTaskAttemptPlan },
  TaskClaimAcquired: { claim: ActiveTaskClaim },
  TaskClaimAcquisitionIntended: { operation: WorkflowOperation.cases.AcquireTaskClaim },
  TaskTrackerFactsObserved: {
    evidence: TaskTrackerFactsObservation,
    ...nonActionOccurrence,
    originatingActionOperationId: OperationId
  },
  TaskTrackerReadInitiated: {
    ...initiatedByCoordinator,
    operation: Schema.Union([
      WorkflowOperation.cases.ReadTrackerGraph,
      WorkflowOperation.cases.ReadTaskWorkSpecification
    ])
  },
  TaskWorktreeReady: { operationId: OperationId, proof: PlannedWorktreeReady },
  TaskWorktreeReconciliationIntended: { operation: WorkflowOperation.cases.ReconcileTaskWorktree },
  WorkflowRunBegan: { ...initiatedByCoordinator, target: TrackerTarget },
  WorkflowRunTerminated: { ...nonActionOccurrence, disposition: Schema.Literal("Completed") }
})
export type RecordedCassetteEntry = typeof RecordedCassetteEntry.Type

/**
 * Provisional recorded format version. Incrementing it does not promise
 * backward compatibility until the project owner removes this comment.
 */
export const recordedCassetteVersion = 1 as const

export const RecordedCassette = Schema.TaggedStruct("RecordedCassette", {
  entries: Schema.Array(RecordedCassetteEntry),
  runId: RunId,
  schemaVersion: Schema.Literal(recordedCassetteVersion)
})
export type RecordedCassette = typeof RecordedCassette.Type

const consistentIdentityRenaming = Schema.makeFilter(
  (renamings: ReadonlyArray<{ readonly from: string; readonly to: string }>) => {
    const from = new Set(renamings.map(({ from }) => from))
    const to = new Set(renamings.map(({ to }) => to))
    return from.size === renamings.length && to.size === renamings.length
      ? undefined
      : "identity renaming must be one-to-one and assign each source only once"
  }
)

/** One explicit, consistent alpha-renaming for generated cassette identities. */
export const CassetteIdentityRenaming = Schema.Struct({
  attemptIds: Schema.Array(Schema.Struct({ from: AttemptId, to: AttemptId })).check(consistentIdentityRenaming),
  claimTokens: Schema.Array(Schema.Struct({ from: ClaimToken, to: ClaimToken })).check(consistentIdentityRenaming),
  controlCommandIds: Schema.Array(Schema.Struct({ from: ControlCommandId, to: ControlCommandId })).check(
    consistentIdentityRenaming
  ),
  operationIds: Schema.Array(Schema.Struct({ from: OperationId, to: OperationId })).check(consistentIdentityRenaming),
  runIds: Schema.Array(Schema.Struct({ from: RunId, to: RunId })).check(consistentIdentityRenaming),
  taskBranchRefs: Schema.Array(Schema.Struct({ from: TaskBranchRef, to: TaskBranchRef })).check(
    consistentIdentityRenaming
  ),
  worktreeLocators: Schema.Array(Schema.Struct({ from: WorktreeLocator, to: WorktreeLocator })).check(
    consistentIdentityRenaming
  )
})
export type CassetteIdentityRenaming = typeof CassetteIdentityRenaming.Type

const identityRenamingMap = <Identity extends string>(
  renamings: ReadonlyArray<{ readonly from: Identity; readonly to: Identity }>
) => new Map(renamings.map(({ from, to }) => [from, to]))

interface IdentityRenamingMaps {
  readonly attemptIds: ReadonlyMap<AttemptId, AttemptId>
  readonly claimTokens: ReadonlyMap<ClaimToken, ClaimToken>
  readonly controlCommandIds: ReadonlyMap<ControlCommandId, ControlCommandId>
  readonly operationIds: ReadonlyMap<OperationId, OperationId>
  readonly runIds: ReadonlyMap<RunId, RunId>
  readonly taskBranchRefs: ReadonlyMap<TaskBranchRef, TaskBranchRef>
  readonly worktreeLocators: ReadonlyMap<WorktreeLocator, WorktreeLocator>
}

const renamed = <Identity>(value: Identity, map: ReadonlyMap<Identity, Identity>): Identity => map.get(value) ?? value

const renamePredecessors = (predecessors: ReadonlyArray<OperationId>, maps: IdentityRenamingMaps) =>
  predecessors.map((operationId) => renamed(operationId, maps.operationIds))

const renamePlannedAttempt = (attempt: PlannedTaskAttempt, maps: IdentityRenamingMaps): PlannedTaskAttempt => ({
  ...attempt,
  attemptId: renamed(attempt.attemptId, maps.attemptIds),
  branch: renamed(attempt.branch, maps.taskBranchRefs),
  runId: renamed(attempt.runId, maps.runIds),
  worktree: renamed(attempt.worktree, maps.worktreeLocators)
})

function renameWorkflowOperation(
  operation: typeof WorkflowOperation.cases.AcquireTaskClaim.Type,
  maps: IdentityRenamingMaps
): typeof WorkflowOperation.cases.AcquireTaskClaim.Type
function renameWorkflowOperation(
  operation: typeof WorkflowOperation.cases.ReadTaskWorkSpecification.Type,
  maps: IdentityRenamingMaps
): typeof WorkflowOperation.cases.ReadTaskWorkSpecification.Type
function renameWorkflowOperation(
  operation: typeof WorkflowOperation.cases.ReadTrackerGraph.Type,
  maps: IdentityRenamingMaps
): typeof WorkflowOperation.cases.ReadTrackerGraph.Type
function renameWorkflowOperation(
  operation:
    | typeof WorkflowOperation.cases.ReadTaskWorkSpecification.Type
    | typeof WorkflowOperation.cases.ReadTrackerGraph.Type,
  maps: IdentityRenamingMaps
): typeof WorkflowOperation.cases.ReadTaskWorkSpecification.Type | typeof WorkflowOperation.cases.ReadTrackerGraph.Type
function renameWorkflowOperation(
  operation: typeof WorkflowOperation.cases.RecordTaskAttemptPlan.Type,
  maps: IdentityRenamingMaps
): typeof WorkflowOperation.cases.RecordTaskAttemptPlan.Type
function renameWorkflowOperation(
  operation: typeof WorkflowOperation.cases.ReconcileTaskWorktree.Type,
  maps: IdentityRenamingMaps
): typeof WorkflowOperation.cases.ReconcileTaskWorktree.Type
function renameWorkflowOperation(operation: WorkflowOperation, maps: IdentityRenamingMaps): WorkflowOperation {
  switch (operation._tag) {
    case "AcquireTaskClaim":
      return {
        ...operation,
        acquisition: {
          ...operation.acquisition,
          operationId: renamed(operation.acquisition.operationId, maps.operationIds),
          token: renamed(operation.acquisition.token, maps.claimTokens)
        },
        predecessorOperationIds: renamePredecessors(operation.predecessorOperationIds, maps)
      }
    case "ReadTaskWorkSpecification":
    case "ReadTrackerGraph":
      return {
        ...operation,
        operationId: renamed(operation.operationId, maps.operationIds),
        predecessorOperationIds: renamePredecessors(operation.predecessorOperationIds, maps)
      }
    case "RecordTaskAttemptPlan":
    case "ReconcileTaskWorktree":
      return {
        ...operation,
        operationId: renamed(operation.operationId, maps.operationIds),
        plannedAttempt: renamePlannedAttempt(operation.plannedAttempt, maps),
        predecessorOperationIds: renamePredecessors(operation.predecessorOperationIds, maps)
      }
  }
}

const renameControlCommand = (command: ControlCommand, maps: IdentityRenamingMaps): ControlCommand => ({
  ...command,
  commandId: renamed(command.commandId, maps.controlCommandIds),
  runId: renamed(command.runId, maps.runIds)
})

const renameExecutorReport = (
  report: PlannedAttemptExecutorReport,
  maps: IdentityRenamingMaps
): PlannedAttemptExecutorReport => ({
  ...report,
  correlation: {
    attemptId: renamed(report.correlation.attemptId, maps.attemptIds),
    runId: renamed(report.correlation.runId, maps.runIds)
  }
})

const renameFreshness = <
  Fact extends { readonly freshness: { readonly _tag: "ObservedDuringLogicalRead"; readonly operationId: OperationId } }
>(
  fact: Fact,
  maps: IdentityRenamingMaps
): Fact => ({
  ...fact,
  freshness: { ...fact.freshness, operationId: renamed(fact.freshness.operationId, maps.operationIds) }
})

const renameTrackerFactsObservation = (
  observation: TaskTrackerFactsObservation,
  maps: IdentityRenamingMaps
): TaskTrackerFactsObservation => {
  switch (observation._tag) {
    case "CompleteTaskTrackerFacts":
      return {
        ...observation,
        factFamilies: [
          renameFreshness(observation.factFamilies[0], maps),
          renameFreshness(observation.factFamilies[1], maps),
          renameFreshness(observation.factFamilies[2], maps),
          renameFreshness(observation.factFamilies[3], maps),
          renameFreshness(observation.factFamilies[4], maps)
        ],
        operationId: renamed(observation.operationId, maps.operationIds)
      }
    case "FocusedTaskWorkSpecificationFacts":
      return {
        ...observation,
        factFamily: renameFreshness(observation.factFamily, maps),
        operationId: renamed(observation.operationId, maps.operationIds)
      }
    case "UnchangedTaskTrackerFactsReconfirmed":
      return {
        ...observation,
        factFamilies: [
          renameFreshness(observation.factFamilies[0], maps),
          renameFreshness(observation.factFamilies[1], maps),
          renameFreshness(observation.factFamilies[2], maps),
          renameFreshness(observation.factFamilies[3], maps),
          renameFreshness(observation.factFamilies[4], maps)
        ],
        operationId: renamed(observation.operationId, maps.operationIds),
        priorFullObservationOperationId: renamed(observation.priorFullObservationOperationId, maps.operationIds)
      }
  }
}

type RecordedOperationEntry = Extract<RecordedCassetteEntry, { readonly operation: WorkflowOperation }>

const renameRecordedOperationEntry = (
  entry: RecordedOperationEntry,
  maps: IdentityRenamingMaps
): RecordedOperationEntry => {
  switch (entry._tag) {
    case "TaskAttemptPlanned":
      return { ...entry, operation: renameWorkflowOperation(entry.operation, maps) }
    case "TaskClaimAcquisitionIntended":
      return { ...entry, operation: renameWorkflowOperation(entry.operation, maps) }
    case "TaskTrackerReadInitiated":
      return { ...entry, operation: renameWorkflowOperation(entry.operation, maps) }
    case "TaskWorktreeReconciliationIntended":
      return { ...entry, operation: renameWorkflowOperation(entry.operation, maps) }
  }
}

type RecordedFactEntry = Extract<
  RecordedCassetteEntry,
  {
    readonly _tag:
      | "TaskClaimAcquired"
      | "TaskTrackerFactsObserved"
      | "TaskWorktreeReady"
      | "WorkflowRunBegan"
      | "WorkflowRunTerminated"
  }
>

const renameRecordedFactEntry = (entry: RecordedFactEntry, maps: IdentityRenamingMaps): RecordedFactEntry => {
  switch (entry._tag) {
    case "TaskClaimAcquired":
      return {
        ...entry,
        claim: {
          ...entry.claim,
          operationId: renamed(entry.claim.operationId, maps.operationIds),
          token: renamed(entry.claim.token, maps.claimTokens)
        }
      }
    case "TaskTrackerFactsObserved":
      return {
        ...entry,
        evidence: renameTrackerFactsObservation(entry.evidence, maps),
        originatingActionOperationId: renamed(entry.originatingActionOperationId, maps.operationIds)
      }
    case "TaskWorktreeReady":
      return {
        ...entry,
        operationId: renamed(entry.operationId, maps.operationIds),
        proof: {
          ...entry.proof,
          branch: renamed(entry.proof.branch, maps.taskBranchRefs),
          worktree: renamed(entry.proof.worktree, maps.worktreeLocators)
        }
      }
    case "WorkflowRunBegan":
    case "WorkflowRunTerminated":
      return entry
  }
}

const renameRecordedCassetteEntry = (
  entry: RecordedCassetteEntry,
  maps: IdentityRenamingMaps
): RecordedCassetteEntry => {
  if ("operation" in entry) return renameRecordedOperationEntry(entry, maps)
  if (entry._tag === "ControlCommandRecorded") {
    return { ...entry, command: renameControlCommand(entry.command, maps) }
  }
  if (entry._tag === "PlannedAttemptExecutorWorkReported") {
    return { ...entry, report: renameExecutorReport(entry.report, maps) }
  }
  if (entry._tag === "PlannedAttemptExecutorWorkResponsibilityBegan") {
    return { ...entry, plannedAttempt: renamePlannedAttempt(entry.plannedAttempt, maps) }
  }
  return renameRecordedFactEntry(entry, maps)
}

/** Applies an exhaustive per-entry alpha-renaming through the cassette Schema boundary. */
export const renameRecordedCassette = Effect.fn("ScenarioCassette.renameRecorded")(function* (
  cassette: RecordedCassette,
  renaming: CassetteIdentityRenaming
) {
  const maps: IdentityRenamingMaps = {
    attemptIds: identityRenamingMap(renaming.attemptIds),
    claimTokens: identityRenamingMap(renaming.claimTokens),
    controlCommandIds: identityRenamingMap(renaming.controlCommandIds),
    operationIds: identityRenamingMap(renaming.operationIds),
    runIds: identityRenamingMap(renaming.runIds),
    taskBranchRefs: identityRenamingMap(renaming.taskBranchRefs),
    worktreeLocators: identityRenamingMap(renaming.worktreeLocators)
  }
  return yield* Schema.decodeUnknownEffect(RecordedCassette)(
    RecordedCassette.make({
      ...cassette,
      entries: cassette.entries.map((entry) => renameRecordedCassetteEntry(entry, maps)),
      runId: renamed(cassette.runId, maps.runIds)
    })
  )
})

export const invertCassetteIdentityRenaming = (renaming: CassetteIdentityRenaming): CassetteIdentityRenaming =>
  CassetteIdentityRenaming.make({
    attemptIds: renaming.attemptIds.map(({ from, to }) => ({ from: to, to: from })),
    claimTokens: renaming.claimTokens.map(({ from, to }) => ({ from: to, to: from })),
    controlCommandIds: renaming.controlCommandIds.map(({ from, to }) => ({ from: to, to: from })),
    operationIds: renaming.operationIds.map(({ from, to }) => ({ from: to, to: from })),
    runIds: renaming.runIds.map(({ from, to }) => ({ from: to, to: from })),
    taskBranchRefs: renaming.taskBranchRefs.map(({ from, to }) => ({ from: to, to: from })),
    worktreeLocators: renaming.worktreeLocators.map(({ from, to }) => ({ from: to, to: from }))
  })
