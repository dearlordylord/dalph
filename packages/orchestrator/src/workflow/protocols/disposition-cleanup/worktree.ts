/* eslint-disable max-lines -- The exact cleanup algebra, recovery chronology, and controlled boundary stay co-located for auditability. */

import { Effect, Context, Layer, Ref, Schema } from "effect"
import { AttemptId, GitCommitSha, TaskBranchRef, WorktreeLocator } from "@dalph/contracts"
import { InRunJournal } from "../../../workflow-journal/in-run-journal.js"
import type { AppendableWorkflowJournalEvent, JournalRecord } from "../../../workflow-journal/store.js"
import {
  worktreeCleanupAuthorizedRecordKey,
  worktreeCleanupAbsenceConfirmedRecordKey,
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
  cleanupMutationRequestLimit,
  worktreeCleanupAuthorizationEquals
} from "./disposition.js"
import { validateWorktreeCleanupHistory, validateWorktreeCleanupProvenance } from "./provenance.js"

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
  Removed: { branch: TaskBranchRef, locator: WorktreeLocator, revision: WorktreeCleanupEvidenceRevision },
  AlreadyAbsent: { branch: TaskBranchRef, locator: WorktreeLocator, revision: WorktreeCleanupEvidenceRevision },
  DefinitelyNotApplied: { branch: TaskBranchRef, detail: Schema.String, locator: WorktreeLocator },
  Unknown: { branch: TaskBranchRef, detail: Schema.String, locator: WorktreeLocator }
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

/** A fresh absence proof reconciles an initial or ambiguous cleanup without fabricating a mutation result. */
export const WorktreeCleanupAbsenceConfirmedEvent = Schema.TaggedStruct("WorktreeCleanupAbsenceConfirmed", {
  authorization: WorktreeCleanupAuthorization,
  cause: Schema.Literals(["InitialAbsence", "MutationResponseReconciliation"]),
  observation: WorktreeCleanupObservation.cases.Absent,
  occurrenceClassification: Schema.Literal("NonActionOccurrence"),
  operationId: OperationId,
  ordinal: CleanupObservationOrdinal,
  version: Schema.Literal(workflowJournalEventVersion)
})
export type WorktreeCleanupAbsenceConfirmedEvent = typeof WorktreeCleanupAbsenceConfirmedEvent.Type

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
  WorktreeCleanupAbsenceConfirmedEvent,
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
  Observe: { operationId: OperationId, ordinal: CleanupObservationOrdinal },
  Remove: { operationId: OperationId, ordinal: CleanupMutationOrdinal }
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
                operationId: authorization.operationId,
                ordinal: CleanupObservationOrdinal.make(current.filter((call) => call._tag === "Observe").length + 1)
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
              WorktreeCleanupBoundaryCall.cases.Remove.make({
                operationId: authorization.operationId,
                ordinal: attempt
              })
            ])
            const values = yield* Ref.getAndUpdate(mutations, (current) =>
              current.length > 1 ? current.slice(1) : current
            )
            return (
              values[0] ??
              WorktreeCleanupMutationResult.cases.Unknown.make({
                branch: authorization.owner.branch,
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

const recordsFor = (
  records: ReadonlyArray<JournalRecord>,
  tag: WorktreeCleanupJournalEvent["_tag"],
  operationId: OperationId
) =>
  records.filter(
    (record) =>
      record.event._tag === tag &&
      "authorization" in record.event &&
      record.event.authorization.operationId === operationId
  )

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

const nextObservationOrdinal = (
  records: ReadonlyArray<JournalRecord>,
  operationId: OperationId
): CleanupObservationOrdinal =>
  CleanupObservationOrdinal.make(recordsFor(records, "WorktreeCleanupObservationIntended", operationId).length + 1)

const unmatchedObservationIntent = (
  records: ReadonlyArray<JournalRecord>,
  authorization: WorktreeCleanupAuthorization
) =>
  records.find((record) => {
    if (
      record.event._tag !== "WorktreeCleanupObservationIntended" ||
      !worktreeCleanupAuthorizationEquals(record.event.authorization, authorization)
    ) {
      return false
    }
    const intended = record.event
    return !records.some((observed) => {
      if (observed.event._tag !== "WorktreeCleanupObserved") return false
      return (
        observed.event.authorization.operationId === authorization.operationId &&
        observed.event.operationId === intended.operationId &&
        observed.event.ordinal === intended.ordinal
      )
    })
  })

const existingAuthorization = (records: ReadonlyArray<JournalRecord>, operationId: OperationId) =>
  records.find(
    (record): record is JournalRecord & { readonly event: WorktreeCleanupAuthorizedEvent } =>
      record.event._tag === "WorktreeCleanupAuthorized" && record.event.authorization.operationId === operationId
  )?.event

const existingSettled = (records: ReadonlyArray<JournalRecord>, authorization: WorktreeCleanupAuthorization) =>
  records.find(
    (record): record is JournalRecord & { readonly event: WorktreeCleanupSettledEvent } =>
      record.event._tag === "WorktreeCleanupSettled" &&
      record.event.authorization.operationId === authorization.operationId &&
      worktreeCleanupAuthorizationEquals(record.event.authorization, authorization)
  )?.event

const observationHasAuthorizedLocator = (
  observation: WorktreeCleanupObservation,
  authorization: WorktreeCleanupAuthorization
): boolean => observation.locator === authorization.locator

/** Every mutation response must identify the same worktree and owning branch as the authorization. */
export const worktreeCleanupMutationResultMatchesAuthorization = (
  result: WorktreeCleanupMutationResult,
  authorization: WorktreeCleanupAuthorization
): boolean => result.locator === authorization.locator && result.branch === authorization.owner.branch

const observeFresh = Effect.fn("WorktreeCleanup.observeFresh")(function* (
  authorization: WorktreeCleanupAuthorization,
  records: ReadonlyArray<JournalRecord>
) {
  const boundary = yield* WorktreeCleanupBoundary
  const runId = authorization.disposition.plannedAttempt.runId
  const unmatched = unmatchedObservationIntent(records, authorization)
  const ordinal =
    unmatched?.event._tag === "WorktreeCleanupObservationIntended"
      ? unmatched.event.ordinal
      : nextObservationOrdinal(records, authorization.operationId)
  const operationId =
    unmatched?.event._tag === "WorktreeCleanupObservationIntended"
      ? unmatched.event.operationId
      : OperationId.make(`${authorization.operationId}:observe:${ordinal}`)
  const key = worktreeCleanupObservationIntendedRecordKey(authorization.operationId, ordinal)
  if (!records.some((record) => record.key === key)) {
    yield* appendEvent(
      runId,
      key,
      WorktreeCleanupObservationIntendedEvent.make({
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
    worktreeCleanupObservedRecordKey(authorization.operationId, ordinal),
    WorktreeCleanupObservedEvent.make({
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

const appendContradiction = Effect.fn("WorktreeCleanup.appendContradiction")(function* (
  authorization: WorktreeCleanupAuthorization,
  observation: WorktreeCleanupObservation,
  operationId: OperationId,
  detail: string,
  records: ReadonlyArray<JournalRecord>
) {
  const runId = authorization.disposition.plannedAttempt.runId
  const key = worktreeCleanupContradictedRecordKey(authorization.operationId)
  if (!records.some((record) => record.key === key)) {
    yield* appendEvent(
      runId,
      key,
      WorktreeCleanupContradictedEvent.make({
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

const settleFromAbsence = Effect.fn("WorktreeCleanup.settleFromAbsence")(function* (
  authorization: WorktreeCleanupAuthorization,
  observation: WorktreeCleanupObservation,
  operationId: OperationId,
  ordinal: CleanupObservationOrdinal,
  result: Extract<WorktreeCleanupMutationResult, { readonly _tag: "AlreadyAbsent" | "Removed" }>,
  records: ReadonlyArray<JournalRecord>
) {
  if (observation._tag !== "Absent")
    return yield* Effect.die("worktree absence settlement requires an Absent observation")
  const runId = authorization.disposition.plannedAttempt.runId
  const mutationExists = records.some(
    (record) =>
      record.event._tag === "WorktreeCleanupMutationIntended" &&
      worktreeCleanupAuthorizationEquals(record.event.authorization, authorization)
  )
  const derivedCause = mutationExists ? "MutationResponseReconciliation" : "InitialAbsence"
  const absenceKey = worktreeCleanupAbsenceConfirmedRecordKey(authorization.operationId, ordinal)
  if (!records.some((record) => record.key === absenceKey)) {
    yield* appendEvent(
      runId,
      absenceKey,
      WorktreeCleanupAbsenceConfirmedEvent.make({
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
      worktreeCleanupSettledRecordKey(authorization.operationId),
      WorktreeCleanupSettledEvent.make({
        authorization,
        occurrenceClassification: "NonActionOccurrence",
        result,
        version: workflowJournalEventVersion
      })
    )
  }
  return WorktreeCleanupOutcome.cases.Settled.make({ authorization, result: settled?.result ?? result })
})

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

  const provenance = validateWorktreeCleanupProvenance(records, authorization)
  if (provenance._tag === "Invalid") {
    return WorktreeCleanupOutcome.cases.Preserved.make({ authorization, reason: provenance.detail })
  }
  const history = validateWorktreeCleanupHistory(records, authorization)
  if (history._tag === "Invalid") {
    return WorktreeCleanupOutcome.cases.Preserved.make({ authorization, reason: history.detail })
  }

  // A valid terminal prefix is already the durable answer. Replaying it must
  // not perform another Git read (or append a second authorization/observation
  // prefix): the recorded absence and settlement are the recovery proof.
  const settledBeforeReplay = existingSettled(records, authorization)
  if (settledBeforeReplay !== undefined) {
    return WorktreeCleanupOutcome.cases.Settled.make({ authorization, result: settledBeforeReplay.result })
  }

  const journalAuthorization = existingAuthorization(records, authorization.operationId)
  if (
    journalAuthorization !== undefined &&
    !worktreeCleanupAuthorizationEquals(journalAuthorization.authorization, authorization)
  ) {
    return WorktreeCleanupOutcome.cases.Preserved.make({
      authorization,
      reason: "journaled worktree authorization differs from the requested authorization"
    })
  }
  if (journalAuthorization === undefined) {
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

  const firstObservation = yield* observeFresh(authorization, records)
  records = firstObservation.records
  const observed = firstObservation.observed

  if (observed._tag === "Absent" && observationHasAuthorizedLocator(observed, authorization)) {
    const alreadyAbsent = WorktreeCleanupMutationResult.cases.AlreadyAbsent.make({
      branch: authorization.owner.branch,
      locator: authorization.locator,
      revision: observed.revision
    })
    return yield* settleFromAbsence(
      authorization,
      observed,
      firstObservation.operationId,
      firstObservation.ordinal,
      alreadyAbsent,
      records
    )
  }

  if (
    !observationHasAuthorizedLocator(observed, authorization) ||
    !worktreeCleanupObservationMatchesAuthorization(observed, authorization)
  ) {
    yield* appendContradiction(
      authorization,
      observed,
      firstObservation.operationId,
      observed._tag === "Unreadable" ? observed.detail : "fresh Git facts do not match the authorization",
      records
    )
    return WorktreeCleanupOutcome.cases.Preserved.make({
      authorization,
      reason: "fresh Git facts contradicted authorization"
    })
  }

  const mutationAttempts = recordsFor(records, "WorktreeCleanupMutationIntended", authorization.operationId).length
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
  records = yield* journal.read(runId)
  if (!worktreeCleanupMutationResultMatchesAuthorization(result, authorization)) {
    yield* appendContradiction(
      authorization,
      observed,
      mutationOperationId,
      "worktree mutation response identified a different locator or owning branch",
      records
    )
    return WorktreeCleanupOutcome.cases.Preserved.make({
      authorization,
      reason: "worktree mutation response contradicted authorization"
    })
  }
  if (result._tag === "Removed" || result._tag === "AlreadyAbsent") {
    const postMutationObservation = yield* observeFresh(authorization, records)
    records = postMutationObservation.records
    if (
      postMutationObservation.observed._tag === "Absent" &&
      observationHasAuthorizedLocator(postMutationObservation.observed, authorization)
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
      "worktree mutation did not receive a fresh authorized absence proof",
      records
    )
    return WorktreeCleanupOutcome.cases.Preserved.make({
      authorization,
      reason: "worktree mutation was not followed by a fresh authorized absence"
    })
  }
  const reason = result._tag === "Unknown" ? "worktree remove response was lost" : result.detail
  return WorktreeCleanupOutcome.cases.Pending.make({ authorization, attempts: attempt, reason })
})
