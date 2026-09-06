/* eslint-disable max-lines -- Admission authority, opaque reconstruction, and release minting stay one privacy boundary. */
import {
  compareTaskIds,
  plannedAttemptExecutorCorrelation,
  RunId,
  TaskId,
  type PlannedAttemptExecutorCorrelation,
  type PlannedTaskAttempt
} from "@dalph/contracts"
import { Data, Effect, Schema } from "effect"
import type { ActiveTaskClaim } from "../../authorities/task-tracker/claim-mutation.js"
import { workflowJournalHistoryIssueDetail } from "../reconstruction/history-result.js"
import { reduceWorkflowJournalHistory } from "../reconstruction/history.js"
import type { WorkflowOperation } from "../../workflow/registry/operation.js"
import type { OperationId } from "../../workflow/identity.js"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import {
  intentRecordKey,
  outcomeRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey
} from "../../workflow-journal/record-key.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import type { FreshTaskCandidate } from "../delivery/fresh-task-candidate.js"
import { immutableSnapshot } from "../immutable-snapshot.js"
import { acceptedFreshAttemptLineage } from "./fresh-attempt-lineage.js"
import type { TaskWorkCapacity } from "./capacity.js"
import { requiredPlannedAttemptPositionsOf } from "../run/required-planned-attempt-positions.js"

const FreshTaskCommitmentTypeId: unique symbol = Symbol("@dalph/FreshTaskCommitment")
const issuedFreshTaskCommitments = new WeakSet<object>()

type AcquireTaskClaimOperation = Extract<WorkflowOperation, { readonly _tag: "AcquireTaskClaim" }>
type TaskSelectionAcquireTaskClaimOperation = Omit<AcquireTaskClaimOperation, "authority"> & {
  readonly authority: Extract<AcquireTaskClaimOperation["authority"], { readonly _tag: "TaskSelectionAuthority" }>
}

/**
 * Durable evidence that the TaskSelectionAuthority committed one exact fresh
 * claim operation in one exact Run. The private brand prevents a claim ID,
 * task ID, and Run ID from being paired independently by an admission caller.
 */
export interface FreshTaskCommitment {
  readonly [FreshTaskCommitmentTypeId]: typeof FreshTaskCommitmentTypeId
  readonly acceptedIntentPosition: JournalPosition
  readonly operation: TaskSelectionAcquireTaskClaimOperation
  readonly runId: RunId
}

const brandFreshTaskCommitment = (
  acceptedIntentPosition: JournalPosition,
  runId: RunId,
  operation: TaskSelectionAcquireTaskClaimOperation
): FreshTaskCommitment => {
  const commitment: FreshTaskCommitment = {
    [FreshTaskCommitmentTypeId]: FreshTaskCommitmentTypeId,
    acceptedIntentPosition,
    operation: immutableSnapshot(operation),
    runId
  }
  Object.freeze(commitment)
  issuedFreshTaskCommitments.add(commitment)
  return commitment
}

const isTaskSelectionAcquireTaskClaimOperation = (
  operation: WorkflowOperation
): operation is TaskSelectionAcquireTaskClaimOperation =>
  operation._tag === "AcquireTaskClaim" && operation.authority._tag === "TaskSelectionAuthority"

const sameClaimAcquisition = (
  left: TaskSelectionAcquireTaskClaimOperation["acquisition"],
  right: TaskSelectionAcquireTaskClaimOperation["acquisition"]
): boolean =>
  left.operationId === right.operationId &&
  left.owner === right.owner &&
  left.taskId === right.taskId &&
  left.token === right.token

const sameOrderedPredecessors = (
  left: TaskSelectionAcquireTaskClaimOperation,
  right: TaskSelectionAcquireTaskClaimOperation
): boolean =>
  left.predecessorOperationIds.length === right.predecessorOperationIds.length &&
  left.predecessorOperationIds.every((operationId, index) => operationId === right.predecessorOperationIds[index])

/** Exact durable identity of one canonically accepted fresh-task commitment. */
export const sameFreshTaskCommitment = (left: FreshTaskCommitment, right: FreshTaskCommitment): boolean => {
  const leftAcquisition = left.operation.acquisition
  const rightAcquisition = right.operation.acquisition
  return (
    issuedFreshTaskCommitments.has(left) &&
    issuedFreshTaskCommitments.has(right) &&
    left.runId === right.runId &&
    left.acceptedIntentPosition === right.acceptedIntentPosition &&
    sameClaimAcquisition(leftAcquisition, rightAcquisition) &&
    sameOrderedPredecessors(left.operation, right.operation)
  )
}

/** The sole capacity-consuming state of one task at one scheduling instant. */
export type TaskAdmissionOccupancy = Data.TaggedEnum<{
  FreshEntryReserved: { readonly candidate: FreshTaskCandidate }
  FreshTaskCommitted: { readonly commitment: FreshTaskCommitment }
  ExistingResponsibilityReserved: { readonly plannedAttempt: PlannedTaskAttempt }
  ExactAttemptHeld: { readonly plannedAttempt: PlannedTaskAttempt }
}>

export const TaskAdmissionOccupancy = Data.taggedEnum<TaskAdmissionOccupancy>()

const FreshTaskAdmissionBasisTypeId: unique symbol = Symbol("@dalph/FreshTaskAdmissionBasis")
const FreshTaskAdmissionReleaseEvidenceTypeId: unique symbol = Symbol("@dalph/FreshTaskAdmissionReleaseEvidence")
const FreshTaskAdmissionProjectionTypeId: unique symbol = Symbol("@dalph/FreshTaskAdmissionProjection")
const issuedFreshTaskAdmissionProjections = new WeakSet<object>()

interface FreshTaskAdmissionReleaseEvidenceBase {
  readonly [FreshTaskAdmissionReleaseEvidenceTypeId]: typeof FreshTaskAdmissionReleaseEvidenceTypeId
  readonly claimOperationId: OperationId
  readonly runId: RunId
  readonly taskId: TaskId
}

/**
 * Exact accepted Journal evidence that one task's claim-operation cycle no
 * longer owns pre-attempt admission. Values are privately minted only while
 * projecting a canonically validated contiguous Run prefix.
 */
type FreshTaskAdmissionReleaseEvidence =
  | (FreshTaskAdmissionReleaseEvidenceBase & {
      readonly _tag: "ExactAttemptHandoffAccepted"
      readonly plannedAttempt: PlannedTaskAttempt
    })
  | (FreshTaskAdmissionReleaseEvidenceBase & { readonly _tag: "ExactPreOwnershipClaimRejected" })

const exactAttemptHandoffAccepted = (input: {
  readonly claimOperationId: OperationId
  readonly plannedAttempt: PlannedTaskAttempt
  readonly runId: RunId
  readonly taskId: TaskId
}): Extract<FreshTaskAdmissionReleaseEvidence, { readonly _tag: "ExactAttemptHandoffAccepted" }> => {
  const evidence: Extract<FreshTaskAdmissionReleaseEvidence, { readonly _tag: "ExactAttemptHandoffAccepted" }> = {
    [FreshTaskAdmissionReleaseEvidenceTypeId]: FreshTaskAdmissionReleaseEvidenceTypeId,
    _tag: "ExactAttemptHandoffAccepted",
    claimOperationId: input.claimOperationId,
    plannedAttempt: immutableSnapshot(input.plannedAttempt),
    runId: input.runId,
    taskId: input.taskId
  }
  return Object.freeze(evidence)
}

const exactPreOwnershipClaimRejected = (input: {
  readonly claimOperationId: OperationId
  readonly runId: RunId
  readonly taskId: TaskId
}): Extract<FreshTaskAdmissionReleaseEvidence, { readonly _tag: "ExactPreOwnershipClaimRejected" }> => {
  const evidence: Extract<FreshTaskAdmissionReleaseEvidence, { readonly _tag: "ExactPreOwnershipClaimRejected" }> = {
    [FreshTaskAdmissionReleaseEvidenceTypeId]: FreshTaskAdmissionReleaseEvidenceTypeId,
    _tag: "ExactPreOwnershipClaimRejected",
    claimOperationId: input.claimOperationId,
    runId: input.runId,
    taskId: input.taskId
  }
  return Object.freeze(evidence)
}

/** Stable process-local lookup key for one exact task and claim-operation cycle. */
export const freshTaskAdmissionReleaseKey = (taskId: TaskId, claimOperationId: OperationId): string =>
  JSON.stringify([taskId, claimOperationId])

const releaseEvidenceKey = (evidence: FreshTaskAdmissionReleaseEvidence): string =>
  freshTaskAdmissionReleaseKey(evidence.taskId, evidence.claimOperationId)

/** Opaque admission reconstruction minted from one canonically accepted Run prefix. */
export interface FreshTaskAdmissionProjection {
  readonly [FreshTaskAdmissionProjectionTypeId]: typeof FreshTaskAdmissionProjectionTypeId
  readonly _tag: "FreshTaskAdmissionProjection"
  readonly acceptedAt: JournalPosition
  readonly commitments: ReadonlyArray<Extract<TaskAdmissionOccupancy, { readonly _tag: "FreshTaskCommitted" }>>
  /** Exact attempts whose accepted responsibility still requires a position at this Journal prefix. */
  readonly heldAttempts: ReadonlyArray<PlannedTaskAttempt>
  readonly releaseEvidence: ReadonlyArray<FreshTaskAdmissionReleaseEvidence>
  readonly runId: RunId
}

/** Arbitrary records did not form one accepted contiguous Run reconstruction. */
export class FreshTaskAdmissionProjectionInvalid extends Schema.TaggedError<FreshTaskAdmissionProjectionInvalid>()(
  "FreshTaskAdmissionProjectionInvalid",
  { issues: Schema.Array(Schema.String), runId: RunId }
) {}

type ClaimIntentRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "TaskClaimAcquisitionIntended" }>
}

const isExactClaim = (
  claim: ActiveTaskClaim,
  acquisition: ClaimIntentRecord["event"]["operation"]["acquisition"]
): boolean =>
  claim.operationId === acquisition.operationId &&
  claim.owner === acquisition.owner &&
  claim.taskId === acquisition.taskId &&
  claim.token === acquisition.token

const exactOwnedClaimWasAccepted = (records: ReadonlyArray<JournalRecord>, intent: ClaimIntentRecord): boolean =>
  records.some(
    (record) =>
      record.position > intent.position &&
      record.runId === intent.runId &&
      record.event._tag === "TaskClaimAcquired" &&
      record.key === outcomeRecordKey(intent.event.operation.acquisition.operationId) &&
      isExactClaim(record.event.claim, intent.event.operation.acquisition)
  )

const exactPreOwnershipRejectionWasAccepted = (
  records: ReadonlyArray<JournalRecord>,
  intent: ClaimIntentRecord
): boolean => {
  if (exactOwnedClaimWasAccepted(records, intent)) return false
  return records.some(
    (record) =>
      record.position > intent.position &&
      record.runId === intent.runId &&
      record.event._tag === "TaskClaimAcquisitionRejected" &&
      record.event.operationId === intent.event.operation.acquisition.operationId &&
      record.key === outcomeRecordKey(intent.event.operation.acquisition.operationId)
  )
}

const exactAttemptHandoffs = (
  runId: RunId,
  records: ReadonlyArray<JournalRecord>
): ReadonlyMap<string, Extract<FreshTaskAdmissionReleaseEvidence, { readonly _tag: "ExactAttemptHandoffAccepted" }>> =>
  new Map(
    records.flatMap((record) => {
      if (record.event._tag !== "PlannedAttemptExecutorWorkResponsibilityBegan") return []
      if (
        record.runId !== runId ||
        record.runId !== record.event.plannedAttempt.runId ||
        record.key !== plannedAttemptExecutorWorkResponsibilityBeganRecordKey(record.event.plannedAttempt.attemptId)
      ) {
        return []
      }
      const acceptedPrefix = records.filter((candidate) => candidate.position <= record.position)
      const lineage = acceptedFreshAttemptLineage(acceptedPrefix, record.event.plannedAttempt, "WorktreeReady")
      if (lineage === undefined) return []
      const evidence = exactAttemptHandoffAccepted({
        claimOperationId: lineage.claimOperationId,
        plannedAttempt: record.event.plannedAttempt,
        runId,
        taskId: record.event.plannedAttempt.taskId
      })
      return [[releaseEvidenceKey(evidence), evidence] as const]
    })
  )

/** Runtime check for an exact projection minted by the canonical projector. */
const isFreshTaskAdmissionProjection = (value: unknown): value is FreshTaskAdmissionProjection =>
  typeof value === "object" && value !== null && issuedFreshTaskAdmissionProjections.has(value)

/**
 * Validates an arbitrary supplied prefix with the canonical Run reducer before
 * it can mint either a durable commitment or release authority.
 */
export const projectFreshTaskAdmission = (
  runId: RunId,
  records: ReadonlyArray<JournalRecord>
): FreshTaskAdmissionProjection | FreshTaskAdmissionProjectionInvalid => {
  const reduction = reduceWorkflowJournalHistory(runId, records)
  if (reduction._tag === "InvalidWorkflowJournalHistory") {
    return new FreshTaskAdmissionProjectionInvalid({
      issues: reduction.issues.map(workflowJournalHistoryIssueDetail),
      runId
    })
  }
  const acceptedAt = reduction.runState.appliedThrough
  if (acceptedAt === null) {
    return new FreshTaskAdmissionProjectionInvalid({ issues: ["accepted Run history is empty"], runId })
  }
  const acceptedRecords = reduction.records
  const requiredPositions = requiredPlannedAttemptPositionsOf(reduction.runState)
  const heldAttempts = reduction.runState.responsibility.entries.flatMap((entry) => {
    if (entry._tag !== "PlannedAttemptExecutorWorkResponsibility") return []
    const required = requiredPositions.some(
      ({ attemptId, runId: requiredRunId, taskId }) =>
        attemptId === entry.plannedAttempt.attemptId &&
        requiredRunId === entry.plannedAttempt.runId &&
        taskId === entry.plannedAttempt.taskId
    )
    return required ? [immutableSnapshot(entry.plannedAttempt)] : []
  })
  const handoffs = exactAttemptHandoffs(runId, acceptedRecords)
  const intents = acceptedRecords.filter(
    (record): record is ClaimIntentRecord =>
      record.event._tag === "TaskClaimAcquisitionIntended" &&
      record.event.operation.authority._tag === "TaskSelectionAuthority" &&
      record.key === intentRecordKey(record.event.operation.acquisition.operationId)
  )
  const releaseEvidence = intents.flatMap((intent): ReadonlyArray<FreshTaskAdmissionReleaseEvidence> => {
    const acquisition = intent.event.operation.acquisition
    if (exactPreOwnershipRejectionWasAccepted(acceptedRecords, intent)) {
      return [
        exactPreOwnershipClaimRejected({ claimOperationId: acquisition.operationId, runId, taskId: acquisition.taskId })
      ]
    }
    const handoff = handoffs.get(freshTaskAdmissionReleaseKey(acquisition.taskId, acquisition.operationId))
    return handoff === undefined ? [] : [handoff]
  })
  const releaseKeys = releaseEvidence.map(releaseEvidenceKey)
  const duplicateReleaseKeys = [...new Set(releaseKeys.filter((key, index) => releaseKeys.indexOf(key) !== index))]
  const intentKeys = new Set(
    intents.map(({ event }) =>
      freshTaskAdmissionReleaseKey(event.operation.acquisition.taskId, event.operation.acquisition.operationId)
    )
  )
  const unmatchedReleaseKeys = [...handoffs.keys()].filter((key) => !intentKeys.has(key))
  if (duplicateReleaseKeys.length > 0 || unmatchedReleaseKeys.length > 0) {
    return new FreshTaskAdmissionProjectionInvalid({
      issues: [
        ...duplicateReleaseKeys.map((key) => `duplicate or conflicting release key ${key}`),
        ...unmatchedReleaseKeys.map((key) => `unmatched release key ${key}`)
      ],
      runId
    })
  }
  const releasedKeys = new Set(releaseKeys)
  const commitments = intents.flatMap((intent) => {
    const acquisition = intent.event.operation.acquisition
    if (releasedKeys.has(freshTaskAdmissionReleaseKey(acquisition.taskId, acquisition.operationId))) return []
    const operation = intent.event.operation
    if (!isTaskSelectionAcquireTaskClaimOperation(operation)) return []
    const commitment = brandFreshTaskCommitment(intent.position, runId, operation)
    return [Object.freeze(TaskAdmissionOccupancy.FreshTaskCommitted({ commitment }))]
  })
  Object.freeze(commitments)
  Object.freeze(heldAttempts)
  Object.freeze(releaseEvidence)
  const projection: FreshTaskAdmissionProjection = {
    [FreshTaskAdmissionProjectionTypeId]: FreshTaskAdmissionProjectionTypeId,
    _tag: "FreshTaskAdmissionProjection",
    acceptedAt,
    commitments,
    heldAttempts,
    releaseEvidence,
    runId
  }
  Object.freeze(projection)
  issuedFreshTaskAdmissionProjections.add(projection)
  return projection
}

/** Invalid supplied history grants no commitment and, critically, no release authority. */
export const projectFreshTaskCommitments = (
  runId: RunId,
  records: ReadonlyArray<JournalRecord>
): FreshTaskAdmissionProjection["commitments"] => {
  const projection = projectFreshTaskAdmission(runId, records)
  return projection._tag === "FreshTaskAdmissionProjection" ? projection.commitments : []
}

const immutableReadonlyMap = <Key, Value>(entries: Iterable<readonly [Key, Value]>): ReadonlyMap<Key, Value> => {
  const source = new Map(entries)
  const view: ReadonlyMap<Key, Value> = {
    get size() {
      return source.size
    },
    entries: () => source.entries(),
    forEach: (callback, thisArg) => source.forEach((value, key) => callback.call(thisArg, value, key, view)),
    get: (key) => source.get(key),
    has: (key) => source.has(key),
    keys: () => source.keys(),
    values: () => source.values(),
    [Symbol.iterator]: () => source[Symbol.iterator]()
  }
  return Object.freeze(view)
}

/** Checked closed occupancy for one coherent policy and authority observation. */
export interface FreshTaskAdmissionBasis {
  readonly [FreshTaskAdmissionBasisTypeId]: typeof FreshTaskAdmissionBasisTypeId
  readonly acceptedAt: JournalPosition | null
  readonly capacity: TaskWorkCapacity
  /** Exact executor-held positions only; ready responsibilities remain in `occupied` but are not held attempts. */
  readonly held: ReadonlyArray<{ readonly correlation: PlannedAttemptExecutorCorrelation; readonly taskId: TaskId }>
  readonly occupied: ReadonlyMap<TaskId, TaskAdmissionOccupancy>
  /** Accepted exact releases indexed by the task and claim operation they settle. */
  readonly releaseEvidence: ReadonlyMap<string, FreshTaskAdmissionReleaseEvidence>
  readonly runId: RunId
}

/** More than one occupancy form was supplied for the same tracker task. */
export class FreshTaskAdmissionBasisInvalid extends Schema.TaggedError<FreshTaskAdmissionBasisInvalid>()(
  "FreshTaskAdmissionBasisInvalid",
  { duplicateTaskIds: Schema.Array(TaskId) }
) {}

/** An occupancy aggregate belongs to a Run other than the basis being built. */
export class FreshTaskAdmissionBasisRunMismatch extends Schema.TaggedError<FreshTaskAdmissionBasisRunMismatch>()(
  "FreshTaskAdmissionBasisRunMismatch",
  { mismatchedTaskIds: Schema.Array(TaskId), runId: RunId }
) {}

/** A durable commitment was supplied as an arbitrary aggregate instead of by the opaque Journal projection. */
export class FreshTaskAdmissionCommitmentAuthorityInvalid extends Schema.TaggedError<FreshTaskAdmissionCommitmentAuthorityInvalid>()(
  "FreshTaskAdmissionCommitmentAuthorityInvalid",
  { taskIds: Schema.Array(TaskId) }
) {}

/** Release evidence was not the exact opaque projection for this basis revision and Run. */
export class FreshTaskAdmissionReleaseAuthorityInvalid extends Schema.TaggedError<FreshTaskAdmissionReleaseAuthorityInvalid>()(
  "FreshTaskAdmissionReleaseAuthorityInvalid",
  { reason: Schema.Literals(["AcceptedPositionMismatch", "RunMismatch", "UnrecognizedProjection"]), runId: RunId }
) {}

type NonCommitmentOccupancy = Exclude<TaskAdmissionOccupancy, { readonly _tag: "FreshTaskCommitted" }>

interface FreshTaskAdmissionBasisInput {
  readonly acceptedAt?: JournalPosition | null
  readonly capacity: TaskWorkCapacity
  readonly entries: ReadonlyArray<NonCommitmentOccupancy>
  readonly projection?: FreshTaskAdmissionProjection
  readonly runId: RunId
}

const issuedFreshTaskAdmissionBases = new WeakMap<object, FreshTaskAdmissionProjection | null>()

interface FreshTaskAdmissionBasisInternalInput {
  readonly acceptedAt?: JournalPosition | null
  readonly capacity: TaskWorkCapacity
  readonly entries: ReadonlyArray<TaskAdmissionOccupancy>
  readonly projection?: FreshTaskAdmissionProjection
  readonly runId: RunId
}

const nonNullObjectField = (value: unknown, key: PropertyKey): object | undefined => {
  if (typeof value !== "object" || value === null) return undefined
  const field = Reflect.get(value, key)
  return typeof field === "object" && field !== null ? field : undefined
}

const callerSuppliedCommitmentTaskId = (value: unknown): TaskId | undefined => {
  if (typeof value !== "object" || value === null || Reflect.get(value, "_tag") !== "FreshTaskCommitted") {
    return undefined
  }
  const commitment = nonNullObjectField(value, "commitment")
  const operation = nonNullObjectField(commitment, "operation")
  const acquisition = nonNullObjectField(operation, "acquisition")
  if (acquisition === undefined) return undefined
  const taskId = Reflect.get(acquisition, "taskId")
  return Schema.is(TaskId)(taskId) ? taskId : undefined
}

const occupancyRunId = (occupancy: TaskAdmissionOccupancy): RunId =>
  occupancy._tag === "FreshEntryReserved"
    ? occupancy.candidate.runId
    : occupancy._tag === "FreshTaskCommitted"
      ? occupancy.commitment.runId
      : occupancy.plannedAttempt.runId

const makeFreshTaskAdmissionBasisFromOccupied = (
  acceptedAt: JournalPosition | null,
  capacity: TaskWorkCapacity,
  occupied: ReadonlyMap<TaskId, TaskAdmissionOccupancy>,
  releaseEvidence: ReadonlyArray<FreshTaskAdmissionReleaseEvidence>,
  runId: RunId
): FreshTaskAdmissionBasis => {
  const immutableOccupied = immutableReadonlyMap(occupied)
  const immutableReleaseEvidence = immutableReadonlyMap(
    releaseEvidence.map((evidence) => [releaseEvidenceKey(evidence), evidence] as const)
  )
  const held = Object.freeze(
    [...immutableOccupied].flatMap(([taskId, occupancy]) =>
      occupancy._tag === "ExactAttemptHeld"
        ? [immutableSnapshot({ correlation: plannedAttemptExecutorCorrelation(occupancy.plannedAttempt), taskId })]
        : []
    )
  )
  const basis: FreshTaskAdmissionBasis = {
    [FreshTaskAdmissionBasisTypeId]: FreshTaskAdmissionBasisTypeId,
    acceptedAt,
    capacity,
    held,
    occupied: immutableOccupied,
    releaseEvidence: immutableReleaseEvidence,
    runId
  }
  return Object.freeze(basis)
}

const isIssuedFrozenAdmissionBasis = (value: unknown): value is object =>
  typeof value === "object" &&
  value !== null &&
  issuedFreshTaskAdmissionBases.has(value) &&
  Reflect.get(value, FreshTaskAdmissionBasisTypeId) === FreshTaskAdmissionBasisTypeId &&
  Object.isFrozen(value)

const isFrozenReadonlyMapView = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  Object.isFrozen(value) &&
  !("set" in value) &&
  !("delete" in value) &&
  !("clear" in value)

const isFrozenReadonlyArray = (value: unknown): boolean => Array.isArray(value) && Object.isFrozen(value)

/** Runtime check for the privately minted immutable admission basis. */
export const isFreshTaskAdmissionBasis = (value: unknown): value is FreshTaskAdmissionBasis => {
  if (!isIssuedFrozenAdmissionBasis(value)) return false
  const occupied: unknown = Reflect.get(value, "occupied")
  const releaseEvidence: unknown = Reflect.get(value, "releaseEvidence")
  const held: unknown = Reflect.get(value, "held")
  return isFrozenReadonlyMapView(occupied) && isFrozenReadonlyMapView(releaseEvidence) && isFrozenReadonlyArray(held)
}

/** Derives the tracker task from its one authoritative occupancy aggregate. */
export const taskAdmissionOccupancyTaskId = (occupancy: TaskAdmissionOccupancy): TaskId =>
  occupancy._tag === "FreshEntryReserved"
    ? occupancy.candidate.taskId
    : occupancy._tag === "FreshTaskCommitted"
      ? occupancy.commitment.operation.acquisition.taskId
      : occupancy.plannedAttempt.taskId

/** Derives the exact executor correlation from a planned-attempt occupancy. */
export const taskAdmissionOccupancyExecutorCorrelation = (
  occupancy: TaskAdmissionOccupancy
): PlannedAttemptExecutorCorrelation | undefined =>
  occupancy._tag === "ExistingResponsibilityReserved" || occupancy._tag === "ExactAttemptHeld"
    ? plannedAttemptExecutorCorrelation(occupancy.plannedAttempt)
    : undefined

const buildFreshTaskAdmissionBasis = Effect.fn("FreshTaskAdmission.buildBasis")(function* (
  input: FreshTaskAdmissionBasisInternalInput,
  projectedCommitments: FreshTaskAdmissionProjection["commitments"],
  projectedHeldAttempts: FreshTaskAdmissionProjection["heldAttempts"],
  releaseEvidence: FreshTaskAdmissionProjection["releaseEvidence"],
  projectionSource: FreshTaskAdmissionProjection | null
) {
  const acceptedAt = input.acceptedAt ?? null
  const entries: ReadonlyArray<TaskAdmissionOccupancy> = [
    ...projectedCommitments,
    ...projectedHeldAttempts.map((plannedAttempt) => TaskAdmissionOccupancy.ExactAttemptHeld({ plannedAttempt })),
    ...input.entries
  ]
  const mismatchedTaskIds = entries
    .filter((entry) => occupancyRunId(entry) !== input.runId)
    .map(taskAdmissionOccupancyTaskId)
    .toSorted(compareTaskIds)
  if (mismatchedTaskIds.length > 0) {
    return yield* new FreshTaskAdmissionBasisRunMismatch({ mismatchedTaskIds, runId: input.runId })
  }
  const taskIds = entries.map(taskAdmissionOccupancyTaskId)
  const duplicateTaskIds = [...new Set(taskIds.filter((taskId, index) => taskIds.indexOf(taskId) !== index))].toSorted(
    compareTaskIds
  )
  if (duplicateTaskIds.length > 0) {
    return yield* new FreshTaskAdmissionBasisInvalid({ duplicateTaskIds })
  }
  const occupied = new Map(
    entries.map((entry) => {
      const immutableEntry =
        entry._tag === "FreshEntryReserved"
          ? Object.freeze(TaskAdmissionOccupancy.FreshEntryReserved({ candidate: entry.candidate }))
          : entry._tag === "FreshTaskCommitted"
            ? Object.freeze(TaskAdmissionOccupancy.FreshTaskCommitted({ commitment: entry.commitment }))
            : entry._tag === "ExistingResponsibilityReserved"
              ? Object.freeze(
                  TaskAdmissionOccupancy.ExistingResponsibilityReserved({
                    plannedAttempt: immutableSnapshot(entry.plannedAttempt)
                  })
                )
              : Object.freeze(
                  TaskAdmissionOccupancy.ExactAttemptHeld({ plannedAttempt: immutableSnapshot(entry.plannedAttempt) })
                )
      return [taskAdmissionOccupancyTaskId(immutableEntry), immutableEntry] as const
    })
  )
  const basis = makeFreshTaskAdmissionBasisFromOccupied(
    acceptedAt,
    input.capacity,
    occupied,
    releaseEvidence,
    input.runId
  )
  issuedFreshTaskAdmissionBases.set(basis, projectionSource)
  return basis
})

const callerSuppliedCommitmentTaskIds = (entries: ReadonlyArray<NonCommitmentOccupancy>): ReadonlyArray<TaskId> =>
  entries
    .flatMap((entry) => {
      const taskId = callerSuppliedCommitmentTaskId(entry)
      return taskId === undefined ? [] : [taskId]
    })
    .toSorted(compareTaskIds)

type ProjectionValidation =
  | { readonly _tag: "Invalid"; readonly reason: "AcceptedPositionMismatch" | "RunMismatch" | "UnrecognizedProjection" }
  | { readonly _tag: "Valid"; readonly projection: FreshTaskAdmissionProjection | null }

const validateProjectionForBasis = (
  input: FreshTaskAdmissionBasisInput,
  acceptedAt: JournalPosition | null
): ProjectionValidation => {
  const projection = input.projection
  if (projection === undefined) return { _tag: "Valid", projection: null }
  if (!isFreshTaskAdmissionProjection(projection)) return { _tag: "Invalid", reason: "UnrecognizedProjection" }
  if (projection.runId !== input.runId) return { _tag: "Invalid", reason: "RunMismatch" }
  return projection.acceptedAt === acceptedAt
    ? { _tag: "Valid", projection }
    : { _tag: "Invalid", reason: "AcceptedPositionMismatch" }
}

const projectionBasisParts = (projection: FreshTaskAdmissionProjection | null) =>
  projection === null
    ? { commitments: [], heldAttempts: [], releaseEvidence: [] }
    : {
        commitments: projection.commitments,
        heldAttempts: projection.heldAttempts,
        releaseEvidence: projection.releaseEvidence
      }

/** Forms one map so entry, commitment, responsibility, and exact-attempt occupancy cannot overlap. */
export const makeFreshTaskAdmissionBasis = Effect.fn("FreshTaskAdmission.makeBasis")(function* (
  input: FreshTaskAdmissionBasisInput
) {
  // Keep a runtime guard for untyped JavaScript and explicit hostile casts even
  // though ordinary TypeScript callers cannot supply durable occupancy here.
  const suppliedCommitmentTaskIds = callerSuppliedCommitmentTaskIds(input.entries)
  if (suppliedCommitmentTaskIds.length > 0) {
    return yield* new FreshTaskAdmissionCommitmentAuthorityInvalid({ taskIds: suppliedCommitmentTaskIds })
  }
  const acceptedAt = input.acceptedAt ?? null
  const validation = validateProjectionForBasis(input, acceptedAt)
  if (validation._tag === "Invalid") {
    return yield* new FreshTaskAdmissionReleaseAuthorityInvalid({ reason: validation.reason, runId: input.runId })
  }
  const projection = validation.projection
  const parts = projectionBasisParts(projection)
  return yield* buildFreshTaskAdmissionBasis(
    input,
    parts.commitments,
    parts.heldAttempts,
    parts.releaseEvidence,
    projection
  )
})
