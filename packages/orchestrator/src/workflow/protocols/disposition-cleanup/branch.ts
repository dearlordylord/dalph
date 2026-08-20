import { Effect, Context, Layer, Ref, Schema } from "effect"
import { GitCommitSha, TaskBranchRef, WorktreeLocator } from "@dalph/contracts"
import { InRunJournal } from "../../../workflow-journal/in-run-journal.js"
import type { AppendableWorkflowJournalEvent, JournalRecord } from "../../../workflow-journal/store.js"
import {
  branchCleanupAuthorizedRecordKey,
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
  plannedAttemptCleanupDispositionEquals
} from "./disposition.js"
import { OperationId } from "../../identity.js"
import { WorkflowActor } from "../../registry/actor.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"

/** Fresh Git facts for the exact planned branch after its worktree settled. */
export const BranchCleanupObservation = Schema.TaggedUnion({
  Present: { branch: TaskBranchRef, headSha: GitCommitSha, revision: BranchCleanupEvidenceRevision },
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
  ) => Effect.Effect<BranchCleanupMutationResult>
}
export class BranchCleanupBoundary extends Context.Service<BranchCleanupBoundary, BranchCleanupBoundaryService>()(
  "@dalph/BranchCleanupBoundary"
) {}

export const BranchCleanupBoundaryCall = Schema.TaggedUnion({
  Observe: { ordinal: CleanupObservationOrdinal },
  Remove: { ordinal: CleanupMutationOrdinal }
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
            const ordinal = CleanupObservationOrdinal.make((yield* Ref.get(calls)).length + 1)
            yield* Ref.update(calls, (values) => [...values, BranchCleanupBoundaryCall.cases.Observe.make({ ordinal })])
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
              BranchCleanupBoundaryCall.cases.Remove.make({ ordinal: attempt })
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

const recordsWith = (records: ReadonlyArray<JournalRecord>, tag: BranchCleanupJournalEvent["_tag"]) =>
  records.filter((record) => record.event._tag === tag)

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
  observation.revision === authorization.evidenceRevision

/** Reconciles one branch cleanup, requiring the exact worktree settlement first. */
export const runBranchCleanup = Effect.fn("BranchCleanup.run")(function* (authorization: BranchCleanupAuthorization) {
  const boundary = yield* BranchCleanupBoundary
  const journal = yield* InRunJournal
  const runId = authorization.disposition.plannedAttempt.runId
  let records = yield* journal.read(runId)
  const worktreeSettled = records.some((record) => {
    if (record.event._tag !== "WorktreeCleanupSettled") return false
    const worktreeAuthorization = record.event.authorization
    const plannedAttempt = authorization.disposition.plannedAttempt
    return (
      worktreeAuthorization.operationId === authorization.worktreeCleanupOperationId &&
      worktreeAuthorization.disposition._tag === authorization.disposition._tag &&
      plannedAttemptCleanupDispositionEquals(worktreeAuthorization.disposition, authorization.disposition) &&
      worktreeAuthorization.locator === plannedAttempt.worktree &&
      worktreeAuthorization.owner.attemptId === authorization.owner.attemptId &&
      worktreeAuthorization.owner.branch === authorization.locator &&
      worktreeAuthorization.expectedHead === authorization.expectedHead
    )
  })
  if (!worktreeSettled) {
    return BranchCleanupOutcome.cases.Preserved.make({
      authorization,
      reason: "branch cleanup cannot begin before the exact worktree cleanup settles"
    })
  }
  if (
    !records.some(
      (record) =>
        record.event._tag === "BranchCleanupAuthorized" &&
        record.event.authorization.operationId === authorization.operationId
    )
  ) {
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
  const observationOrdinal = CleanupObservationOrdinal.make(
    recordsWith(records, "BranchCleanupObservationIntended").length + 1
  )
  const observationOperationId = OperationId.make(`${authorization.operationId}:observe:${observationOrdinal}`)
  const observationKey = branchCleanupObservationIntendedRecordKey(authorization.operationId, observationOrdinal)
  if (!records.some((record) => record.key === observationKey)) {
    yield* appendEvent(
      runId,
      observationKey,
      BranchCleanupObservationIntendedEvent.make({
        authorization,
        initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
        occurrenceClassification: "InitiatedAction",
        operationId: observationOperationId,
        ordinal: observationOrdinal,
        version: workflowJournalEventVersion
      })
    )
    records = yield* journal.read(runId)
  }
  const observation = yield* boundary.observe(authorization)
  yield* appendEvent(
    runId,
    branchCleanupObservedRecordKey(authorization.operationId, observationOrdinal),
    BranchCleanupObservedEvent.make({
      authorization,
      observation,
      occurrenceClassification: "NonActionOccurrence",
      operationId: observationOperationId,
      ordinal: observationOrdinal,
      version: workflowJournalEventVersion
    })
  )
  const settled = records.find(
    (record): record is JournalRecord & { readonly event: BranchCleanupSettledEvent } =>
      record.event._tag === "BranchCleanupSettled" &&
      record.event.authorization.operationId === authorization.operationId
  )?.event
  if (settled !== undefined && observation._tag === "Absent")
    return BranchCleanupOutcome.cases.Settled.make({ authorization, result: settled.result })
  if (observation._tag === "Absent") {
    const result = BranchCleanupMutationResult.cases.AlreadyAbsent.make({
      branch: authorization.locator,
      revision: observation.revision
    })
    yield* appendEvent(
      runId,
      branchCleanupMutationResultRecordedRecordKey(authorization.operationId, CleanupMutationOrdinal.make(1)),
      BranchCleanupMutationResultRecordedEvent.make({
        attempt: CleanupMutationOrdinal.make(1),
        authorization,
        occurrenceClassification: "NonActionOccurrence",
        operationId: OperationId.make(`${authorization.operationId}:mutation:1`),
        result,
        version: workflowJournalEventVersion
      })
    )
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
    return BranchCleanupOutcome.cases.Settled.make({ authorization, result })
  }
  if (!exactPresent(observation, authorization)) {
    yield* appendEvent(
      runId,
      branchCleanupContradictedRecordKey(authorization.operationId),
      BranchCleanupContradictedEvent.make({
        authorization,
        detail:
          observation._tag === "Unreadable" ? observation.detail : "fresh branch facts do not match authorization",
        observation,
        occurrenceClassification: "NonActionOccurrence",
        operationId: observationOperationId,
        version: workflowJournalEventVersion
      })
    )
    return BranchCleanupOutcome.cases.Preserved.make({
      authorization,
      reason: "fresh branch facts contradicted authorization"
    })
  }
  const count = recordsWith(records, "BranchCleanupMutationIntended").length
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
  if (result._tag === "Removed" || result._tag === "AlreadyAbsent") {
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
    return BranchCleanupOutcome.cases.Settled.make({ authorization, result })
  }
  return BranchCleanupOutcome.cases.Pending.make({ authorization, attempts: attempt, reason: result.detail })
})
