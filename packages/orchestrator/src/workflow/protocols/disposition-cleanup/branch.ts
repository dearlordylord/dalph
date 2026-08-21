/* eslint-disable max-lines -- The branch gate, recovery chronology, and controlled boundary stay co-located for auditability. */

import { Effect, Context, Layer, Ref, Schema } from "effect"
import { GitCommitSha, TaskBranchRef, WorktreeLocator } from "@dalph/contracts"
import { InRunJournal } from "../../../workflow-journal/in-run-journal.js"
import type { AppendableWorkflowJournalEvent, JournalRecord } from "../../../workflow-journal/store.js"
import {
  branchCleanupAuthorizedRecordKey,
  branchCleanupAbsenceConfirmedRecordKey,
  branchCleanupContradictedRecordKey,
  branchCleanupMutationIntendedRecordKey,
  branchCleanupMutationResultRecordedRecordKey,
  branchCleanupObservationIntendedRecordKey,
  branchCleanupObservedRecordKey,
  branchCleanupSettledRecordKey
} from "../../../workflow-journal/record-key.js"
import {
  CleanupMutationOrdinal,
  CleanupObservationOrdinal,
  BranchCleanupAuthorization,
  BranchCleanupEvidenceRevision,
  cleanupMutationRequestLimit,
  branchCleanupAuthorizationEquals
} from "./disposition.js"
import {
  validateBranchCleanupHistory,
  validateSettledWorktreeForBranch,
  validateWorktreeCleanupProvenance
} from "./provenance.js"
import { OperationId } from "../../identity.js"
import { WorkflowActor } from "../../registry/actor.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import type { CoordinatorOwnershipError } from "../../../authorities/coordinator-ownership/ownership.js"

/** Fresh Git facts for the exact planned branch after its worktree settled. */
export const BranchCleanupObservation = Schema.TaggedUnion({
  Present: {
    branch: TaskBranchRef,
    headSha: GitCommitSha,
    registeredWorktree: Schema.NullOr(WorktreeLocator),
    revision: BranchCleanupEvidenceRevision
  },
  Absent: { branch: TaskBranchRef, revision: BranchCleanupEvidenceRevision },
  Foreign: {
    branch: TaskBranchRef,
    observedHead: GitCommitSha,
    observedWorktree: WorktreeLocator,
    reason: Schema.Literals(["DifferentHead", "RegisteredWorktree", "OtherOwner"]),
    revision: BranchCleanupEvidenceRevision
  },
  Unreadable: { branch: TaskBranchRef, detail: Schema.String }
})
export type BranchCleanupObservation = typeof BranchCleanupObservation.Type

/** Result of one exact branch-delete request. */
export const BranchCleanupMutationResult = Schema.TaggedUnion({
  Removed: { branch: TaskBranchRef, revision: BranchCleanupEvidenceRevision },
  AlreadyAbsent: { branch: TaskBranchRef, revision: BranchCleanupEvidenceRevision },
  DefinitelyNotApplied: { branch: TaskBranchRef, detail: Schema.String },
  Unknown: { branch: TaskBranchRef, detail: Schema.String }
})
export type BranchCleanupMutationResult = typeof BranchCleanupMutationResult.Type

export const BranchCleanupOutcome = Schema.TaggedUnion({
  Settled: {
    authorization: BranchCleanupAuthorization,
    result: Schema.Union([BranchCleanupMutationResult.cases.Removed, BranchCleanupMutationResult.cases.AlreadyAbsent])
  },
  Pending: { authorization: BranchCleanupAuthorization, attempts: Schema.Int, reason: Schema.String },
  Preserved: { authorization: BranchCleanupAuthorization, reason: Schema.String }
})
export type BranchCleanupOutcome = typeof BranchCleanupOutcome.Type

/** Durable authorization for deleting one exact task branch. */
export const BranchCleanupAuthorizedEvent = Schema.TaggedStruct("BranchCleanupAuthorized", {
  authorization: BranchCleanupAuthorization,
  initiatedBy: WorkflowActor.cases.DalphCoordinator,
  occurrenceClassification: Schema.Literal("InitiatedAction"),
  version: Schema.Literal(workflowJournalEventVersion)
})
export type BranchCleanupAuthorizedEvent = typeof BranchCleanupAuthorizedEvent.Type

/** Intent preceding each fresh branch read. */
export const BranchCleanupObservationIntendedEvent = Schema.TaggedStruct("BranchCleanupObservationIntended", {
  authorization: BranchCleanupAuthorization,
  initiatedBy: WorkflowActor.cases.DalphCoordinator,
  occurrenceClassification: Schema.Literal("InitiatedAction"),
  operationId: OperationId,
  ordinal: CleanupObservationOrdinal,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type BranchCleanupObservationIntendedEvent = typeof BranchCleanupObservationIntendedEvent.Type

/** Fresh branch observation bound to the exact authorization. */
export const BranchCleanupObservedEvent = Schema.TaggedStruct("BranchCleanupObserved", {
  authorization: BranchCleanupAuthorization,
  observation: BranchCleanupObservation,
  occurrenceClassification: Schema.Literal("NonActionOccurrence"),
  operationId: OperationId,
  ordinal: CleanupObservationOrdinal,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type BranchCleanupObservedEvent = typeof BranchCleanupObservedEvent.Type

/** A fresh branch absence proof reconciles an initial or ambiguous deletion without fabricating a result. */
export const BranchCleanupAbsenceConfirmedEvent = Schema.TaggedStruct("BranchCleanupAbsenceConfirmed", {
  authorization: BranchCleanupAuthorization,
  cause: Schema.Literals(["InitialAbsence", "MutationResponseReconciliation"]),
  observation: BranchCleanupObservation.cases.Absent,
  occurrenceClassification: Schema.Literal("NonActionOccurrence"),
  operationId: OperationId,
  ordinal: CleanupObservationOrdinal,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type BranchCleanupAbsenceConfirmedEvent = typeof BranchCleanupAbsenceConfirmedEvent.Type

/** Intent preceding one exact bounded branch-delete request. */
export const BranchCleanupMutationIntendedEvent = Schema.TaggedStruct("BranchCleanupMutationIntended", {
  attempt: CleanupMutationOrdinal,
  authorization: BranchCleanupAuthorization,
  initiatedBy: WorkflowActor.cases.DalphCoordinator,
  occurrenceClassification: Schema.Literal("InitiatedAction"),
  operationId: OperationId,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type BranchCleanupMutationIntendedEvent = typeof BranchCleanupMutationIntendedEvent.Type

/** Result after branch deletion, including a lost provider response. */
export const BranchCleanupMutationResultRecordedEvent = Schema.TaggedStruct("BranchCleanupMutationResultRecorded", {
  attempt: CleanupMutationOrdinal,
  authorization: BranchCleanupAuthorization,
  occurrenceClassification: Schema.Literal("NonActionOccurrence"),
  operationId: OperationId,
  result: BranchCleanupMutationResult,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type BranchCleanupMutationResultRecordedEvent = typeof BranchCleanupMutationResultRecordedEvent.Type

/** Fresh branch facts contradicted the exact owner, head, or locator. */
export const BranchCleanupContradictedEvent = Schema.TaggedStruct("BranchCleanupContradicted", {
  authorization: BranchCleanupAuthorization,
  detail: Schema.String,
  observation: BranchCleanupObservation,
  occurrenceClassification: Schema.Literal("NonActionOccurrence"),
  operationId: OperationId,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type BranchCleanupContradictedEvent = typeof BranchCleanupContradictedEvent.Type

/** Branch deletion settled only after a prior worktree cleanup settlement. */
export const BranchCleanupSettledEvent = Schema.TaggedStruct("BranchCleanupSettled", {
  authorization: BranchCleanupAuthorization,
  occurrenceClassification: Schema.Literal("NonActionOccurrence"),
  result: Schema.Union([BranchCleanupMutationResult.cases.Removed, BranchCleanupMutationResult.cases.AlreadyAbsent]),
  version: Schema.Literal(workflowJournalEventVersion)
})
export type BranchCleanupSettledEvent = typeof BranchCleanupSettledEvent.Type

export const BranchCleanupJournalEvent = Schema.Union([
  BranchCleanupAuthorizedEvent,
  BranchCleanupObservationIntendedEvent,
  BranchCleanupObservedEvent,
  BranchCleanupAbsenceConfirmedEvent,
  BranchCleanupMutationIntendedEvent,
  BranchCleanupMutationResultRecordedEvent,
  BranchCleanupContradictedEvent,
  BranchCleanupSettledEvent
])
export type BranchCleanupJournalEvent = typeof BranchCleanupJournalEvent.Type

/** Provider-neutral branch boundary used by production, cassettes, and tests. */
export interface BranchCleanupBoundaryService {
  readonly observe: (authorization: BranchCleanupAuthorization) => Effect.Effect<BranchCleanupObservation>
  readonly remove: (
    authorization: BranchCleanupAuthorization,
    attempt: CleanupMutationOrdinal
  ) => Effect.Effect<BranchCleanupMutationResult, CoordinatorOwnershipError>
}
export class BranchCleanupBoundary extends Context.Service<BranchCleanupBoundary, BranchCleanupBoundaryService>()(
  "@dalph/BranchCleanupBoundary"
) {}

export const BranchCleanupBoundaryCall = Schema.TaggedUnion({
  Observe: { branch: TaskBranchRef, operationId: OperationId, ordinal: CleanupObservationOrdinal },
  Remove: { branch: TaskBranchRef, operationId: OperationId, ordinal: CleanupMutationOrdinal }
})
export type BranchCleanupBoundaryCall = typeof BranchCleanupBoundaryCall.Type

export class TestBranchCleanupBoundary extends Context.Service<
  TestBranchCleanupBoundary,
  { readonly calls: () => Effect.Effect<ReadonlyArray<BranchCleanupBoundaryCall>> }
>()("@dalph/TestBranchCleanupBoundary") {}

/** Deterministic branch boundary script. */
export const branchCleanupTestLayer = (input: {
  readonly observations: ReadonlyArray<BranchCleanupObservation>
  readonly mutations?: ReadonlyArray<BranchCleanupMutationResult>
}) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const observations = yield* Ref.make(input.observations)
      const mutations = yield* Ref.make(input.mutations ?? [])
      const calls = yield* Ref.make<ReadonlyArray<BranchCleanupBoundaryCall>>([])
      const service = BranchCleanupBoundary.of({
        observe: (authorization) =>
          Effect.gen(function* () {
            const current = yield* Ref.getAndUpdate(observations, (values) =>
              values.length > 1 ? values.slice(1) : values
            )
            const ordinal = CleanupObservationOrdinal.make(
              (yield* Ref.get(calls)).filter((call) => call._tag === "Observe").length + 1
            )
            yield* Ref.update(calls, (values) => [
              ...values,
              BranchCleanupBoundaryCall.cases.Observe.make({
                branch: authorization.locator,
                operationId: authorization.operationId,
                ordinal
              })
            ])
            return (
              current[0] ??
              BranchCleanupObservation.cases.Unreadable.make({
                branch: authorization.locator,
                detail: "script exhausted"
              })
            )
          }),
        remove: (authorization, attempt) =>
          Effect.gen(function* () {
            yield* Ref.update(calls, (values) => [
              ...values,
              BranchCleanupBoundaryCall.cases.Remove.make({
                branch: authorization.locator,
                operationId: authorization.operationId,
                ordinal: attempt
              })
            ])
            const current = yield* Ref.getAndUpdate(mutations, (values) =>
              values.length > 1 ? values.slice(1) : values
            )
            return (
              current[0] ??
              BranchCleanupMutationResult.cases.Unknown.make({
                branch: authorization.locator,
                detail: "script exhausted"
              })
            )
          })
      })
      return Context.empty().pipe(
        Context.add(BranchCleanupBoundary, service),
        Context.add(TestBranchCleanupBoundary, { calls: () => Ref.get(calls) })
      )
    })
  )

const recordsWith = (
  records: ReadonlyArray<JournalRecord>,
  tag: BranchCleanupJournalEvent["_tag"],
  operationId: OperationId
) =>
  records.filter(
    (record) =>
      record.event._tag === tag &&
      "authorization" in record.event &&
      record.event.authorization.operationId === operationId
  )

const appendEvent = Effect.fn("BranchCleanup.appendEvent")(function* (
  runId: Parameters<InRunJournal["Service"]["append"]>[0],
  key: Parameters<InRunJournal["Service"]["append"]>[1],
  event: AppendableWorkflowJournalEvent
) {
  const journal = yield* InRunJournal
  return yield* journal.append(runId, key, event)
})

const exactPresent = (observation: BranchCleanupObservation, authorization: BranchCleanupAuthorization): boolean =>
  observation._tag === "Present" &&
  observation.branch === authorization.locator &&
  observation.headSha === authorization.expectedHead &&
  observation.registeredWorktree === null &&
  observation.revision === authorization.evidenceRevision

const observationHasAuthorizedBranch = (
  observation: BranchCleanupObservation,
  authorization: BranchCleanupAuthorization
): boolean => observation.branch === authorization.locator

/** Every branch result must identify the exact authorized branch. */
export const branchCleanupMutationResultMatchesAuthorization = (
  result: BranchCleanupMutationResult,
  authorization: BranchCleanupAuthorization
): boolean => result.branch === authorization.locator

const nextObservationOrdinal = (
  records: ReadonlyArray<JournalRecord>,
  operationId: OperationId
): CleanupObservationOrdinal =>
  CleanupObservationOrdinal.make(recordsWith(records, "BranchCleanupObservationIntended", operationId).length + 1)

const unmatchedObservationIntent = (records: ReadonlyArray<JournalRecord>, authorization: BranchCleanupAuthorization) =>
  records.find((record) => {
    if (
      record.event._tag !== "BranchCleanupObservationIntended" ||
      !branchCleanupAuthorizationEquals(record.event.authorization, authorization)
    ) {
      return false
    }
    const intended = record.event
    return !records.some((observed) => {
      if (observed.event._tag !== "BranchCleanupObserved") return false
      return (
        observed.event.authorization.operationId === authorization.operationId &&
        observed.event.operationId === intended.operationId &&
        observed.event.ordinal === intended.ordinal
      )
    })
  })

const existingAuthorization = (records: ReadonlyArray<JournalRecord>, operationId: OperationId) =>
  records.find(
    (record): record is JournalRecord & { readonly event: BranchCleanupAuthorizedEvent } =>
      record.event._tag === "BranchCleanupAuthorized" && record.event.authorization.operationId === operationId
  )?.event

const existingSettled = (records: ReadonlyArray<JournalRecord>, authorization: BranchCleanupAuthorization) =>
  records.find(
    (record): record is JournalRecord & { readonly event: BranchCleanupSettledEvent } =>
      record.event._tag === "BranchCleanupSettled" &&
      record.event.authorization.operationId === authorization.operationId &&
      branchCleanupAuthorizationEquals(record.event.authorization, authorization)
  )?.event

const existingContradiction = (records: ReadonlyArray<JournalRecord>, authorization: BranchCleanupAuthorization) =>
  records.find(
    (record): record is JournalRecord & { readonly event: BranchCleanupContradictedEvent } =>
      record.event._tag === "BranchCleanupContradicted" &&
      record.event.authorization.operationId === authorization.operationId &&
      branchCleanupAuthorizationEquals(record.event.authorization, authorization)
  )?.event

const observeFresh = Effect.fn("BranchCleanup.observeFresh")(function* (
  authorization: BranchCleanupAuthorization,
  records: ReadonlyArray<JournalRecord>
) {
  const boundary = yield* BranchCleanupBoundary
  const runId = authorization.disposition.plannedAttempt.runId
  const unmatched = unmatchedObservationIntent(records, authorization)
  const ordinal =
    unmatched?.event._tag === "BranchCleanupObservationIntended"
      ? unmatched.event.ordinal
      : nextObservationOrdinal(records, authorization.operationId)
  const operationId =
    unmatched?.event._tag === "BranchCleanupObservationIntended"
      ? unmatched.event.operationId
      : OperationId.make(`${authorization.operationId}:observe:${ordinal}`)
  const key = branchCleanupObservationIntendedRecordKey(authorization.operationId, ordinal)
  if (!records.some((record) => record.key === key)) {
    yield* appendEvent(
      runId,
      key,
      BranchCleanupObservationIntendedEvent.make({
        authorization,
        initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
        occurrenceClassification: "InitiatedAction",
        operationId,
        ordinal,
        version: workflowJournalEventVersion
      })
    )
  }
  const observed = yield* boundary.observe(authorization)
  yield* appendEvent(
    runId,
    branchCleanupObservedRecordKey(authorization.operationId, ordinal),
    BranchCleanupObservedEvent.make({
      authorization,
      observation: observed,
      occurrenceClassification: "NonActionOccurrence",
      operationId,
      ordinal,
      version: workflowJournalEventVersion
    })
  )
  return { observed, operationId, ordinal, records: yield* (yield* InRunJournal).read(runId) }
})

const appendContradiction = Effect.fn("BranchCleanup.appendContradiction")(function* (
  authorization: BranchCleanupAuthorization,
  observation: BranchCleanupObservation,
  operationId: OperationId,
  detail: string,
  records: ReadonlyArray<JournalRecord>
) {
  const runId = authorization.disposition.plannedAttempt.runId
  const key = branchCleanupContradictedRecordKey(authorization.operationId)
  if (!records.some((record) => record.key === key)) {
    yield* appendEvent(
      runId,
      key,
      BranchCleanupContradictedEvent.make({
        authorization,
        detail,
        observation,
        occurrenceClassification: "NonActionOccurrence",
        operationId,
        version: workflowJournalEventVersion
      })
    )
  }
})

const settleFromAbsence = Effect.fn("BranchCleanup.settleFromAbsence")(function* (
  authorization: BranchCleanupAuthorization,
  observation: BranchCleanupObservation,
  operationId: OperationId,
  ordinal: CleanupObservationOrdinal,
  result: Extract<BranchCleanupMutationResult, { readonly _tag: "AlreadyAbsent" | "Removed" }>,
  records: ReadonlyArray<JournalRecord>
) {
  if (observation._tag !== "Absent")
    return yield* Effect.die("branch absence settlement requires an Absent observation")
  if (result.revision !== observation.revision) {
    yield* appendContradiction(
      authorization,
      observation,
      operationId,
      "branch mutation result revision did not match the latest absence observation",
      records
    )
    return BranchCleanupOutcome.cases.Preserved.make({
      authorization,
      reason: "branch mutation result was stale relative to the latest absence proof"
    })
  }
  const runId = authorization.disposition.plannedAttempt.runId
  const mutationExists = records.some(
    (record) =>
      record.event._tag === "BranchCleanupMutationIntended" &&
      branchCleanupAuthorizationEquals(record.event.authorization, authorization)
  )
  const derivedCause = mutationExists ? "MutationResponseReconciliation" : "InitialAbsence"
  const absenceKey = branchCleanupAbsenceConfirmedRecordKey(authorization.operationId, ordinal)
  if (!records.some((record) => record.key === absenceKey)) {
    yield* appendEvent(
      runId,
      absenceKey,
      BranchCleanupAbsenceConfirmedEvent.make({
        authorization,
        cause: derivedCause,
        observation,
        occurrenceClassification: "NonActionOccurrence",
        operationId,
        ordinal,
        version: workflowJournalEventVersion
      })
    )
  }
  const settled = existingSettled(records, authorization)
  if (settled === undefined) {
    yield* appendEvent(
      runId,
      branchCleanupSettledRecordKey(authorization.operationId),
      BranchCleanupSettledEvent.make({
        authorization,
        occurrenceClassification: "NonActionOccurrence",
        result,
        version: workflowJournalEventVersion
      })
    )
  }
  return BranchCleanupOutcome.cases.Settled.make({ authorization, result: settled?.result ?? result })
})

/** Reconciles one branch cleanup, requiring the exact worktree settlement first. */
export const runBranchCleanup = Effect.fn("BranchCleanup.run")(function* (authorization: BranchCleanupAuthorization) {
  const boundary = yield* BranchCleanupBoundary
  const journal = yield* InRunJournal
  const runId = authorization.disposition.plannedAttempt.runId
  let records = yield* journal.read(runId)
  const provenance = validateWorktreeCleanupProvenance(records, authorization)
  if (provenance._tag === "Invalid") {
    return BranchCleanupOutcome.cases.Preserved.make({ authorization, reason: provenance.detail })
  }
  const worktreeSettled = validateSettledWorktreeForBranch(records, authorization)
  if (worktreeSettled._tag === "Invalid") {
    return BranchCleanupOutcome.cases.Preserved.make({ authorization, reason: worktreeSettled.detail })
  }
  const history = validateBranchCleanupHistory(records, authorization)
  if (history._tag === "Invalid") {
    return BranchCleanupOutcome.cases.Preserved.make({ authorization, reason: history.detail })
  }
  const contradictedBeforeReplay = existingContradiction(records, authorization)
  if (contradictedBeforeReplay !== undefined) {
    return BranchCleanupOutcome.cases.Preserved.make({ authorization, reason: contradictedBeforeReplay.detail })
  }
  // A valid terminal prefix is the recovery answer. Do not reread or append
  // anything on a second or later invocation of the same settled operation.
  const settledBeforeReplay = existingSettled(records, authorization)
  if (settledBeforeReplay !== undefined) {
    return BranchCleanupOutcome.cases.Settled.make({ authorization, result: settledBeforeReplay.result })
  }
  const journalAuthorization = existingAuthorization(records, authorization.operationId)
  if (
    journalAuthorization !== undefined &&
    !branchCleanupAuthorizationEquals(journalAuthorization.authorization, authorization)
  ) {
    return BranchCleanupOutcome.cases.Preserved.make({
      authorization,
      reason: "journaled branch authorization differs from the requested authorization"
    })
  }
  if (journalAuthorization === undefined) {
    yield* appendEvent(
      runId,
      branchCleanupAuthorizedRecordKey(authorization.operationId),
      BranchCleanupAuthorizedEvent.make({
        authorization,
        initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
        occurrenceClassification: "InitiatedAction",
        version: workflowJournalEventVersion
      })
    )
    records = yield* journal.read(runId)
  }
  const firstObservation = yield* observeFresh(authorization, records)
  records = firstObservation.records
  const observation = firstObservation.observed
  if (observation._tag === "Absent" && observationHasAuthorizedBranch(observation, authorization)) {
    const result = BranchCleanupMutationResult.cases.AlreadyAbsent.make({
      branch: authorization.locator,
      revision: observation.revision
    })
    return yield* settleFromAbsence(
      authorization,
      observation,
      firstObservation.operationId,
      firstObservation.ordinal,
      result,
      records
    )
  }
  if (!observationHasAuthorizedBranch(observation, authorization) || !exactPresent(observation, authorization)) {
    yield* appendContradiction(
      authorization,
      observation,
      firstObservation.operationId,
      observation._tag === "Unreadable" ? observation.detail : "fresh branch facts do not match authorization",
      records
    )
    return BranchCleanupOutcome.cases.Preserved.make({
      authorization,
      reason: "fresh branch facts contradicted authorization"
    })
  }
  const count = recordsWith(records, "BranchCleanupMutationIntended", authorization.operationId).length
  if (count >= cleanupMutationRequestLimit)
    return BranchCleanupOutcome.cases.Pending.make({
      authorization,
      attempts: count,
      reason: "bounded branch deletion requests exhausted"
    })
  const attempt = CleanupMutationOrdinal.make(count + 1)
  const mutationOperationId = OperationId.make(`${authorization.operationId}:mutation:${attempt}`)
  yield* appendEvent(
    runId,
    branchCleanupMutationIntendedRecordKey(authorization.operationId, attempt),
    BranchCleanupMutationIntendedEvent.make({
      attempt,
      authorization,
      initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
      occurrenceClassification: "InitiatedAction",
      operationId: mutationOperationId,
      version: workflowJournalEventVersion
    })
  )
  const result = yield* boundary.remove(authorization, attempt)
  yield* appendEvent(
    runId,
    branchCleanupMutationResultRecordedRecordKey(authorization.operationId, attempt),
    BranchCleanupMutationResultRecordedEvent.make({
      attempt,
      authorization,
      occurrenceClassification: "NonActionOccurrence",
      operationId: mutationOperationId,
      result,
      version: workflowJournalEventVersion
    })
  )
  records = yield* journal.read(runId)
  if (!branchCleanupMutationResultMatchesAuthorization(result, authorization)) {
    yield* appendContradiction(
      authorization,
      observation,
      mutationOperationId,
      "branch mutation response identified a different branch",
      records
    )
    return BranchCleanupOutcome.cases.Preserved.make({
      authorization,
      reason: "branch mutation response contradicted authorization"
    })
  }
  if (result._tag === "Removed" || result._tag === "AlreadyAbsent") {
    const postMutationObservation = yield* observeFresh(authorization, records)
    records = postMutationObservation.records
    if (
      postMutationObservation.observed._tag === "Absent" &&
      observationHasAuthorizedBranch(postMutationObservation.observed, authorization)
    ) {
      return yield* settleFromAbsence(
        authorization,
        postMutationObservation.observed,
        postMutationObservation.operationId,
        postMutationObservation.ordinal,
        result,
        records
      )
    }
    yield* appendContradiction(
      authorization,
      postMutationObservation.observed,
      postMutationObservation.operationId,
      "branch mutation did not receive a fresh authorized absence proof",
      records
    )
    return BranchCleanupOutcome.cases.Preserved.make({
      authorization,
      reason: "branch mutation was not followed by a fresh authorized absence"
    })
  }
  return BranchCleanupOutcome.cases.Pending.make({ authorization, attempts: attempt, reason: result.detail })
})
