import { Effect, Schema } from "effect"
import {
  AttemptId,
  ClaimToken,
  OperationId,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  WorktreeLocator
} from "./domain.js"
import { ControlCommand } from "./control-command.js"
import { PlannedWorktreeReady } from "./git-worktree.js"
import { PlannedAttemptExecutorReport } from "./planned-attempt-executor.js"
import { PlannedAttemptExecutorReportOrdinal } from "./planned-attempt-executor-journal.js"
import { TaskTrackerFactsObservation } from "./task-tracker-facts.js"
import { ActiveTaskClaim } from "./tracker-mutation.js"
import { WorkflowOperation } from "./workflow-operation.js"
import { WorkflowActor } from "./workflow-occurrence.js"

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
  TaskWorktreeReconciliationInitiated: { operation: WorkflowOperation.cases.ReconcileTaskWorktree }
})
export type RecordedCassetteEntry = typeof RecordedCassetteEntry.Type

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

const identityRenamingMap = (renamings: ReadonlyArray<{ readonly from: string; readonly to: string }>) =>
  new Map(renamings.map(({ from, to }) => [from, to]))

type IdentityRenamingMaps = ReadonlyMap<string, ReadonlyMap<string, string>>

const renamedString = (value: string, field: string | undefined, maps: IdentityRenamingMaps): string =>
  field === undefined ? value : (maps.get(field)?.get(value) ?? value)

const renameEncodedIdentity = (value: unknown, field: string | undefined, maps: IdentityRenamingMaps): unknown => {
  if (typeof value === "string") return renamedString(value, field, maps)
  if (Array.isArray(value)) return value.map((item) => renameEncodedIdentity(item, field, maps))
  if (value === null || typeof value !== "object") return value
  return Object.fromEntries(
    Reflect.ownKeys(value).flatMap((key) =>
      typeof key === "string" ? [[key, renameEncodedIdentity(Reflect.get(value, key), key, maps)] as const] : []
    )
  )
}

/** Applies alpha-renaming through the cassette Schema boundary. */
export const renameRecordedCassette = Effect.fn("ScenarioCassette.renameRecorded")(function* (
  cassette: RecordedCassette,
  renaming: CassetteIdentityRenaming
) {
  const operationIds = identityRenamingMap(renaming.operationIds)
  const maps: IdentityRenamingMaps = new Map([
    ["attemptId", identityRenamingMap(renaming.attemptIds)],
    ["branch", identityRenamingMap(renaming.taskBranchRefs)],
    ["operationId", operationIds],
    ["originatingActionOperationId", operationIds],
    ["predecessorOperationIds", operationIds],
    ["priorFullObservationOperationId", operationIds],
    ["runId", identityRenamingMap(renaming.runIds)],
    ["token", identityRenamingMap(renaming.claimTokens)],
    ["worktree", identityRenamingMap(renaming.worktreeLocators)]
  ])
  const encoded = yield* Schema.encodeUnknownEffect(RecordedCassette)(cassette)
  return yield* Schema.decodeUnknownEffect(RecordedCassette)(renameEncodedIdentity(encoded, undefined, maps))
})

export const invertCassetteIdentityRenaming = (renaming: CassetteIdentityRenaming): CassetteIdentityRenaming =>
  CassetteIdentityRenaming.make({
    attemptIds: renaming.attemptIds.map(({ from, to }) => ({ from: to, to: from })),
    claimTokens: renaming.claimTokens.map(({ from, to }) => ({ from: to, to: from })),
    operationIds: renaming.operationIds.map(({ from, to }) => ({ from: to, to: from })),
    runIds: renaming.runIds.map(({ from, to }) => ({ from: to, to: from })),
    taskBranchRefs: renaming.taskBranchRefs.map(({ from, to }) => ({ from: to, to: from })),
    worktreeLocators: renaming.worktreeLocators.map(({ from, to }) => ({ from: to, to: from }))
  })
