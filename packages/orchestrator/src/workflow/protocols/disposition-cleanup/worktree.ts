import { Effect, Context, Layer, Ref, Schema } from "effect"
import { AttemptId, GitCommitSha, TaskBranchRef, WorktreeLocator } from "@dalph/contracts"
import { InRunJournal } from "../../../workflow-journal/in-run-journal.js"
import type { AppendableWorkflowJournalEvent, JournalRecord } from "../../../workflow-journal/store.js"
import {
  worktreeCleanupAuthorizedRecordKey,
  worktreeCleanupContradictedRecordKey,
  worktreeCleanupMutationIntendedRecordKey,
  worktreeCleanupMutationResultRecordedRecordKey,
  worktreeCleanupObservationIntendedRecordKey,
  worktreeCleanupObservedRecordKey,
  worktreeCleanupSettledRecordKey
} from "../../../workflow-journal/record-key.js"
import { OperationId } from "../../identity.js"
import { WorkflowActor } from "../../registry/actor.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  CleanupMutationOrdinal,
  CleanupObservationOrdinal,
  WorktreeCleanupAuthorization,
  WorktreeCleanupEvidenceRevision,
  cleanupMutationRequestLimit
} from "./disposition.js"

/** Fresh Git evidence for the exact planned worktree named by one authorization. */
export const WorktreeCleanupObservation = Schema.TaggedUnion({
  Present: {
    attemptId: AttemptId,
    branch: TaskBranchRef,
    headSha: GitCommitSha,
    locator: WorktreeLocator,
    revision: WorktreeCleanupEvidenceRevision,
    writerQuiescent: Schema.Literal(true)
  },
  Absent: { locator: WorktreeLocator, revision: WorktreeCleanupEvidenceRevision },
  Foreign: {
    locator: WorktreeLocator,
    observedBranch: TaskBranchRef,
    observedHead: GitCommitSha,
    reason: Schema.Literals(["OtherBranch", "OtherOwner", "MovedRegistration"]),
    revision: WorktreeCleanupEvidenceRevision
  },
  Unregistered: { locator: WorktreeLocator, revision: WorktreeCleanupEvidenceRevision },
  Unreadable: { detail: Schema.String, locator: WorktreeLocator }
})
export type WorktreeCleanupObservation = typeof WorktreeCleanupObservation.Type

/** Result returned by the worktree remove boundary; Unknown is intentionally recoverable. */
export const WorktreeCleanupMutationResult = Schema.TaggedUnion({
  Removed: { locator: WorktreeLocator, revision: WorktreeCleanupEvidenceRevision },
  AlreadyAbsent: { locator: WorktreeLocator, revision: WorktreeCleanupEvidenceRevision },
  DefinitelyNotApplied: { detail: Schema.String, locator: WorktreeLocator },
  Unknown: { detail: Schema.String, locator: WorktreeLocator }
})
export type WorktreeCleanupMutationResult = typeof WorktreeCleanupMutationResult.Type

/** Terminal result of one exact worktree cleanup responsibility. */
export const WorktreeCleanupOutcome = Schema.TaggedUnion({
  Settled: {
    authorization: WorktreeCleanupAuthorization,
    result: Schema.Union([
      WorktreeCleanupMutationResult.cases.Removed,
      WorktreeCleanupMutationResult.cases.AlreadyAbsent
    ])
  },
  Pending: { authorization: WorktreeCleanupAuthorization, attempts: Schema.Int, reason: Schema.String },
  Preserved: { authorization: WorktreeCleanupAuthorization, reason: Schema.String }
})
export type WorktreeCleanupOutcome = typeof WorktreeCleanupOutcome.Type

/** Durable authorization for removing one exact planned-attempt worktree. */
export const WorktreeCleanupAuthorizedEvent = Schema.TaggedStruct("WorktreeCleanupAuthorized", {
  authorization: WorktreeCleanupAuthorization,
  initiatedBy: WorkflowActor.cases.DalphCoordinator,
  occurrenceClassification: Schema.Literal("InitiatedAction"),
  version: Schema.Literal(workflowJournalEventVersion)
})
export type WorktreeCleanupAuthorizedEvent = typeof WorktreeCleanupAuthorizedEvent.Type

/** Intent immediately preceding each fresh Git read used by worktree cleanup. */
export const WorktreeCleanupObservationIntendedEvent = Schema.TaggedStruct("WorktreeCleanupObservationIntended", {
  authorization: WorktreeCleanupAuthorization,
  initiatedBy: WorkflowActor.cases.DalphCoordinator,
  occurrenceClassification: Schema.Literal("InitiatedAction"),
  operationId: OperationId,
  ordinal: CleanupObservationOrdinal,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type WorktreeCleanupObservationIntendedEvent = typeof WorktreeCleanupObservationIntendedEvent.Type

/** Fresh Git result for the same locator, owner, disposition, and evidence revision. */
export const WorktreeCleanupObservedEvent = Schema.TaggedStruct("WorktreeCleanupObserved", {
  authorization: WorktreeCleanupAuthorization,
  observation: WorktreeCleanupObservation,
  occurrenceClassification: Schema.Literal("NonActionOccurrence"),
  operationId: OperationId,
  ordinal: CleanupObservationOrdinal,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type WorktreeCleanupObservedEvent = typeof WorktreeCleanupObservedEvent.Type

/** Intent immediately preceding one bounded Git worktree removal request. */
export const WorktreeCleanupMutationIntendedEvent = Schema.TaggedStruct("WorktreeCleanupMutationIntended", {
  attempt: CleanupMutationOrdinal,
  authorization: WorktreeCleanupAuthorization,
  initiatedBy: WorkflowActor.cases.DalphCoordinator,
  occurrenceClassification: Schema.Literal("InitiatedAction"),
  operationId: OperationId,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type WorktreeCleanupMutationIntendedEvent = typeof WorktreeCleanupMutationIntendedEvent.Type

/** Result after one worktree removal call, including an explicitly lost response. */
export const WorktreeCleanupMutationResultRecordedEvent = Schema.TaggedStruct("WorktreeCleanupMutationResultRecorded", {
  attempt: CleanupMutationOrdinal,
  authorization: WorktreeCleanupAuthorization,
  occurrenceClassification: Schema.Literal("NonActionOccurrence"),
  operationId: OperationId,
  result: WorktreeCleanupMutationResult,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type WorktreeCleanupMutationResultRecordedEvent = typeof WorktreeCleanupMutationResultRecordedEvent.Type

/** Fresh Git evidence contradicted the immutable cleanup subject, so deletion stops. */
export const WorktreeCleanupContradictedEvent = Schema.TaggedStruct("WorktreeCleanupContradicted", {
  authorization: WorktreeCleanupAuthorization,
  detail: Schema.String,
  observation: WorktreeCleanupObservation,
  occurrenceClassification: Schema.Literal("NonActionOccurrence"),
  operationId: OperationId,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type WorktreeCleanupContradictedEvent = typeof WorktreeCleanupContradictedEvent.Type

/** Exact worktree removal settled; this event never authorizes branch deletion. */
export const WorktreeCleanupSettledEvent = Schema.TaggedStruct("WorktreeCleanupSettled", {
  authorization: WorktreeCleanupAuthorization,
  occurrenceClassification: Schema.Literal("NonActionOccurrence"),
  result: Schema.Union([
    WorktreeCleanupMutationResult.cases.Removed,
    WorktreeCleanupMutationResult.cases.AlreadyAbsent
  ]),
  version: Schema.Literal(workflowJournalEventVersion)
})
export type WorktreeCleanupSettledEvent = typeof WorktreeCleanupSettledEvent.Type

export const WorktreeCleanupJournalEvent = Schema.Union([
  WorktreeCleanupAuthorizedEvent,
  WorktreeCleanupObservationIntendedEvent,
  WorktreeCleanupObservedEvent,
  WorktreeCleanupMutationIntendedEvent,
  WorktreeCleanupMutationResultRecordedEvent,
  WorktreeCleanupContradictedEvent,
  WorktreeCleanupSettledEvent
])
export type WorktreeCleanupJournalEvent = typeof WorktreeCleanupJournalEvent.Type

/** Controlled provider-neutral boundary; production and cassettes implement the same calls. */
export interface WorktreeCleanupBoundaryService {
  readonly observe: (authorization: WorktreeCleanupAuthorization) => Effect.Effect<WorktreeCleanupObservation>
  readonly remove: (
    authorization: WorktreeCleanupAuthorization,
    attempt: CleanupMutationOrdinal
  ) => Effect.Effect<WorktreeCleanupMutationResult>
}

export class WorktreeCleanupBoundary extends Context.Service<WorktreeCleanupBoundary, WorktreeCleanupBoundaryService>()(
  "@dalph/WorktreeCleanupBoundary"
) {}

/** Calls visible at the controlled boundary, retained for ordering assertions. */
export const WorktreeCleanupBoundaryCall = Schema.TaggedUnion({
  Observe: { ordinal: CleanupObservationOrdinal },
  Remove: { ordinal: CleanupMutationOrdinal }
})
export type WorktreeCleanupBoundaryCall = typeof WorktreeCleanupBoundaryCall.Type

export class TestWorktreeCleanupBoundary extends Context.Service<
  TestWorktreeCleanupBoundary,
  { readonly calls: () => Effect.Effect<ReadonlyArray<WorktreeCleanupBoundaryCall>> }
>()("@dalph/TestWorktreeCleanupBoundary") {}

/** Scripted boundary used by cassettes and focused protocol tests. */
export const worktreeCleanupTestLayer = (input: {
  readonly observations: ReadonlyArray<WorktreeCleanupObservation>
  readonly mutations?: ReadonlyArray<WorktreeCleanupMutationResult>
}) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const observations = yield* Ref.make(input.observations)
      const mutations = yield* Ref.make(input.mutations ?? [])
      const calls = yield* Ref.make<ReadonlyArray<WorktreeCleanupBoundaryCall>>([])
      const boundary = WorktreeCleanupBoundary.of({
        observe: (authorization) =>
          Effect.gen(function* () {
            const values = yield* Ref.getAndUpdate(observations, (current) =>
              current.length > 1 ? current.slice(1) : current
            )
            yield* Ref.update(calls, (current) => [
              ...current,
              WorktreeCleanupBoundaryCall.cases.Observe.make({
                ordinal: CleanupObservationOrdinal.make(current.length + 1)
              })
            ])
            return (
              values[0] ??
              WorktreeCleanupObservation.cases.Unreadable.make({
                detail: "scripted worktree observation exhausted",
                locator: authorization.locator
              })
            )
          }),
        remove: (authorization, attempt) =>
          Effect.gen(function* () {
            yield* Ref.update(calls, (current) => [
              ...current,
              WorktreeCleanupBoundaryCall.cases.Remove.make({ ordinal: attempt })
            ])
            const values = yield* Ref.getAndUpdate(mutations, (current) =>
              current.length > 1 ? current.slice(1) : current
            )
            return (
              values[0] ??
              WorktreeCleanupMutationResult.cases.Unknown.make({
                detail: "scripted worktree mutation response exhausted",
                locator: authorization.locator
              })
            )
          })
      })
      return Context.empty().pipe(
        Context.add(WorktreeCleanupBoundary, boundary),
        Context.add(TestWorktreeCleanupBoundary, { calls: () => Ref.get(calls) })
      )
    })
  )

const recordsFor = (records: ReadonlyArray<JournalRecord>, tag: WorktreeCleanupJournalEvent["_tag"]) =>
  records.filter((record) => record.event._tag === tag)

const appendEvent = Effect.fn("WorktreeCleanup.appendEvent")(function* (
  runId: Parameters<InRunJournal["Service"]["append"]>[0],
  key: Parameters<InRunJournal["Service"]["append"]>[1],
  event: AppendableWorkflowJournalEvent
) {
  const journal = yield* InRunJournal
  return yield* journal.append(runId, key, event)
})

/** Exact subject comparison used before a destructive worktree boundary call. */
export const worktreeCleanupObservationMatchesAuthorization = (
  observation: WorktreeCleanupObservation,
  authorization: WorktreeCleanupAuthorization
): boolean =>
  observation._tag === "Present" &&
  observation.locator === authorization.locator &&
  observation.attemptId === authorization.owner.attemptId &&
  observation.branch === authorization.owner.branch &&
  observation.headSha === authorization.expectedHead &&
  observation.revision === authorization.evidenceRevision &&
  observation.writerQuiescent

const nextObservationOrdinal = (records: ReadonlyArray<JournalRecord>): CleanupObservationOrdinal =>
  CleanupObservationOrdinal.make(recordsFor(records, "WorktreeCleanupObservationIntended").length + 1)

const nextMutationOrdinal = (records: ReadonlyArray<JournalRecord>): CleanupMutationOrdinal =>
  CleanupMutationOrdinal.make(recordsFor(records, "WorktreeCleanupMutationIntended").length + 1)

const existingAuthorization = (records: ReadonlyArray<JournalRecord>, operationId: OperationId) =>
  records.find(
    (record): record is JournalRecord & { readonly event: WorktreeCleanupAuthorizedEvent } =>
      record.event._tag === "WorktreeCleanupAuthorized" && record.event.authorization.operationId === operationId
  )?.event

const existingSettled = (records: ReadonlyArray<JournalRecord>, authorization: WorktreeCleanupAuthorization) =>
  records.find(
    (record): record is JournalRecord & { readonly event: WorktreeCleanupSettledEvent } =>
      record.event._tag === "WorktreeCleanupSettled" &&
      record.event.authorization.operationId === authorization.operationId
  )?.event

/**
 * Reconcile one exact worktree cleanup responsibility. Every retry reads Git
 * after prior intent/result history; a branch protocol may depend on the
 * resulting WorktreeCleanupSettled record.
 */
export const runWorktreeCleanup = Effect.fn("WorktreeCleanup.run")(function* (
  authorization: WorktreeCleanupAuthorization
) {
  const boundary = yield* WorktreeCleanupBoundary
  const journal = yield* InRunJournal
  const runId = authorization.disposition.plannedAttempt.runId
  let records = yield* journal.read(runId)

  if (existingAuthorization(records, authorization.operationId) === undefined) {
    yield* appendEvent(
      runId,
      worktreeCleanupAuthorizedRecordKey(authorization.operationId),
      WorktreeCleanupAuthorizedEvent.make({
        authorization,
        initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
        occurrenceClassification: "InitiatedAction",
        version: workflowJournalEventVersion
      })
    )
    records = yield* journal.read(runId)
  }

  const settled = existingSettled(records, authorization)
  const observationOrdinal = nextObservationOrdinal(records)
  const observationOperationId = OperationId.make(`${authorization.operationId}:observe:${observationOrdinal}`)
  const observationIntentKey = worktreeCleanupObservationIntendedRecordKey(
    authorization.operationId,
    observationOrdinal
  )
  const observationIntentExists = records.some((record) => record.key === observationIntentKey)
  if (!observationIntentExists) {
    yield* appendEvent(
      runId,
      observationIntentKey,
      WorktreeCleanupObservationIntendedEvent.make({
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
  const observed = yield* boundary.observe(authorization)
  yield* appendEvent(
    runId,
    worktreeCleanupObservedRecordKey(authorization.operationId, observationOrdinal),
    WorktreeCleanupObservedEvent.make({
      authorization,
      observation: observed,
      occurrenceClassification: "NonActionOccurrence",
      operationId: observationOperationId,
      ordinal: observationOrdinal,
      version: workflowJournalEventVersion
    })
  )

  if (settled !== undefined) {
    if (observed._tag === "Absent")
      return WorktreeCleanupOutcome.cases.Settled.make({ authorization, result: settled.result })
    yield* appendEvent(
      runId,
      worktreeCleanupContradictedRecordKey(authorization.operationId),
      WorktreeCleanupContradictedEvent.make({
        authorization,
        detail: "a settled worktree cleanup was reopened with a present or unreadable locator",
        observation: observed,
        occurrenceClassification: "NonActionOccurrence",
        operationId: observationOperationId,
        version: workflowJournalEventVersion
      })
    )
    return WorktreeCleanupOutcome.cases.Preserved.make({
      authorization,
      reason: "settled cleanup no longer proves absence"
    })
  }

  if (observed._tag === "Absent") {
    const alreadyAbsent = WorktreeCleanupMutationResult.cases.AlreadyAbsent.make({
      locator: authorization.locator,
      revision: observed.revision
    })
    const attempt = nextMutationOrdinal(records)
    yield* appendEvent(
      runId,
      worktreeCleanupMutationResultRecordedRecordKey(authorization.operationId, attempt),
      WorktreeCleanupMutationResultRecordedEvent.make({
        attempt,
        authorization,
        occurrenceClassification: "NonActionOccurrence",
        operationId: OperationId.make(`${authorization.operationId}:mutation:${attempt}`),
        result: alreadyAbsent,
        version: workflowJournalEventVersion
      })
    )
    yield* appendEvent(
      runId,
      worktreeCleanupSettledRecordKey(authorization.operationId),
      WorktreeCleanupSettledEvent.make({
        authorization,
        occurrenceClassification: "NonActionOccurrence",
        result: alreadyAbsent,
        version: workflowJournalEventVersion
      })
    )
    return WorktreeCleanupOutcome.cases.Settled.make({ authorization, result: alreadyAbsent })
  }

  if (!worktreeCleanupObservationMatchesAuthorization(observed, authorization)) {
    yield* appendEvent(
      runId,
      worktreeCleanupContradictedRecordKey(authorization.operationId),
      WorktreeCleanupContradictedEvent.make({
        authorization,
        detail: observed._tag === "Unreadable" ? observed.detail : "fresh Git facts do not match the authorization",
        observation: observed,
        occurrenceClassification: "NonActionOccurrence",
        operationId: observationOperationId,
        version: workflowJournalEventVersion
      })
    )
    return WorktreeCleanupOutcome.cases.Preserved.make({
      authorization,
      reason: "fresh Git facts contradicted authorization"
    })
  }

  const mutationAttempts = recordsFor(records, "WorktreeCleanupMutationIntended").length
  if (mutationAttempts >= cleanupMutationRequestLimit) {
    return WorktreeCleanupOutcome.cases.Pending.make({
      authorization,
      attempts: mutationAttempts,
      reason: "bounded worktree cleanup requests exhausted"
    })
  }
  const attempt = CleanupMutationOrdinal.make(mutationAttempts + 1)
  const mutationOperationId = OperationId.make(`${authorization.operationId}:mutation:${attempt}`)
  yield* appendEvent(
    runId,
    worktreeCleanupMutationIntendedRecordKey(authorization.operationId, attempt),
    WorktreeCleanupMutationIntendedEvent.make({
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
    worktreeCleanupMutationResultRecordedRecordKey(authorization.operationId, attempt),
    WorktreeCleanupMutationResultRecordedEvent.make({
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
      worktreeCleanupSettledRecordKey(authorization.operationId),
      WorktreeCleanupSettledEvent.make({
        authorization,
        occurrenceClassification: "NonActionOccurrence",
        result,
        version: workflowJournalEventVersion
      })
    )
    return WorktreeCleanupOutcome.cases.Settled.make({ authorization, result })
  }
  const reason = result._tag === "Unknown" ? "worktree remove response was lost" : result.detail
  return WorktreeCleanupOutcome.cases.Pending.make({ authorization, attempts: attempt, reason })
})
