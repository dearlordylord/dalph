/* eslint-disable max-lines -- The bounded completion request and its recovery
 * chronology are kept together so every ambiguity crossing is auditable. */
import { AcceptedResultEvidenceManifest } from "@dalph/contracts"
import { Effect, Match, Option, Schema } from "effect"
import { TrackerTarget, taskTrackerTargetKey } from "../../../authorities/task-tracker/target.js"
import {
  InRunJournal,
  type AppendableWorkflowJournalEvent,
  type JournalRecord
} from "../../../workflow-journal/store.js"
import {
  completionTaskAcknowledgedRecordKey,
  completionTaskAttemptIntentRecordKey,
  completionTaskCandidateAncestryObservedRecordKey,
  completionTaskCandidateAncestryReadIntentRecordKey,
  completionTaskIntentRecordKey,
  completionTaskRequestLookupIntentRecordKey,
  completionTaskRequestLookupRecordKey,
  completionTaskRejectedRecordKey,
  completionTaskResponseLostRecordKey,
  intentRecordKey,
  outcomeRecordKey
} from "../../../workflow-journal/record-key.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { OperationId } from "../../identity.js"
import {
  CompletionTaskAcknowledgedEvent,
  CompletionTaskAttemptIntendedEvent,
  CompletionTaskCandidateAncestryObservedEvent,
  CompletionTaskCandidateAncestryReadIntendedEvent,
  CompletionTaskAuthorizationReadOrdinal,
  CompletionTaskConfirmationReadOrdinal,
  CompletionTaskFocusedReadPurpose,
  CompletionTaskIntendedEvent,
  CompletionTaskRequest,
  CompletionTaskRequestLookup,
  CompletionTaskRequestLookupIntendedEvent,
  CompletionTaskRequestLookupObservedEvent,
  CompletionTaskRequestOrdinal,
  CompletionTaskRejectedEvent,
  CompletionTaskResponseLostEvent,
  FocusedCompletedTaskObservation,
  FocusedTaskCompletionFacts,
  completionTaskRequestLimit,
  completionTaskClaimEquals,
  completionTaskFocusedReadPurposeEquals,
  completionTaskRequestEquals,
  type CompletionTaskAcknowledgement,
  type CompletionTaskBoundaryService,
  type CompletionTaskRequestFailure
} from "./events.js"
import { taskTrackerReadIntent, type WorkflowJournalEvent } from "../../registry/event.js"
import { makeCompletionTaskFactsObservationOperation } from "../../registry/operation.js"
import {
  makeFocusedTaskCompletionFactsObserved,
  taskTrackerFactsObservedEvent,
  type FocusedTaskCompletionFactsObserved
} from "../../task-tracker-facts/observation.js"
import { EvidenceStore } from "../evidence-store.js"
import {
  TargetPromotionGit,
  targetPromotionAcceptedResultOf,
  targetPromotionGitRequestFor,
  type TargetPromotionGitReadObservation
} from "../target-promotion/events.js"
import {
  completionTaskCandidateAncestryReadOperationIdFor,
  completionTaskFocusedReadOperationIdFor,
  completionTaskRequestLookupOperationIdFor
} from "./completion-task-operation-identity.js"
import { TaskTrackerMutationThrottled } from "../../../authorities/task-tracker/mutation-throttling.js"

/** The authorization facts consumed by one completion request attempt. */
export const CompletionTaskAuthorization = Schema.Struct({
  candidateAncestry: Schema.Literals(["Current", "Ancestor"]),
  focusedFacts: FocusedTaskCompletionFacts,
  gitReadOperationId: OperationId,
  target: TrackerTarget
})
export type CompletionTaskAuthorization = typeof CompletionTaskAuthorization.Type

/** One current authorization read either permits Q or proves that the exact task already succeeded. */
export const CompletionTaskAttemptAuthorization = Schema.TaggedUnion({
  CompletionAlreadyObserved: { observation: FocusedCompletedTaskObservation },
  ReadyToComplete: { authorization: CompletionTaskAuthorization }
})
export type CompletionTaskAttemptAuthorization = typeof CompletionTaskAttemptAuthorization.Type

/** The exact current fact that prevented or contradicted one completion request. */
export const CompletionTaskConflictReason = Schema.Literals([
  "CompletionClaimForeign",
  "CompletionClaimMissing",
  "FocusedFactsCorrelationMismatch",
  "FocusedSuccessContradiction",
  "PrerequisitesIncomplete",
  "PromotedCandidateStale",
  "RequestIdentityContradiction",
  "SealedEvidenceChanged",
  "SealedEvidenceUnavailableOrInvalid",
  "TaskNotInTarget",
  "TaskIdentityOrRevisionChanged",
  "TaskLifecycleConflict",
  "TrackerAcknowledgementMismatch",
  "TrackerCompletionRejected",
  "TrackerTargetChanged"
])
export type CompletionTaskConflictReason = typeof CompletionTaskConflictReason.Type

export interface CompletionTaskAuthorizationIssue {
  readonly detail: string
  readonly reason: CompletionTaskConflictReason
}

/** A completion request cannot cross the tracker boundary without exact current facts. */
export class CompletionTaskAuthorizationConflict extends Schema.TaggedError<CompletionTaskAuthorizationConflict>()(
  "IntegrationFinality.CompletionTaskAuthorizationConflict",
  { detail: Schema.String, reason: CompletionTaskConflictReason, request: CompletionTaskRequest }
) {}

/** Current authorization facts could not be read; no contradiction was proved and no tracker mutation may occur. */
export class CompletionTaskAuthorizationWait extends Schema.TaggedError<CompletionTaskAuthorizationWait>()(
  "IntegrationFinality.CompletionTaskAuthorizationWait",
  {
    detail: Schema.String,
    reason: Schema.Literals([
      "CurrentFactsJournalUnavailable",
      "FocusedFactsUnavailable",
      "PromotedCandidateAncestryUnavailable",
      "SealedEvidenceUnavailable"
    ]),
    request: CompletionTaskRequest
  }
) {}

/** The tracker returned a task-local conflict; no foreign state is mutated. */
export class CompletionTaskPreconditionConflict extends Schema.TaggedError<CompletionTaskPreconditionConflict>()(
  "IntegrationFinality.CompletionTaskPreconditionConflict",
  { detail: Schema.String, reason: CompletionTaskConflictReason, request: CompletionTaskRequest }
) {}

/** An ambiguous completion request could not be positively classified. */
export class CompletionTaskAmbiguousWait extends Schema.TaggedError<CompletionTaskAmbiguousWait>()(
  "IntegrationFinality.CompletionTaskAmbiguousWait",
  { detail: Schema.String, lookup: CompletionTaskRequestLookup, request: CompletionTaskRequest }
) {}

/** A post-loss focused read could not establish either success or safe reconciliation. */
export class CompletionTaskConfirmationWait extends Schema.TaggedError<CompletionTaskConfirmationWait>()(
  "IntegrationFinality.CompletionTaskConfirmationWait",
  { detail: Schema.String, operationId: OperationId, request: CompletionTaskRequest }
) {}

/** Three exact calls did not produce a positive request result. */
export class CompletionTaskDidNotConverge extends Schema.TaggedError<CompletionTaskDidNotConverge>()(
  "IntegrationFinality.CompletionTaskDidNotConverge",
  { attempts: Schema.Int, request: CompletionTaskRequest }
) {}

const CompletionTaskJournalEvent = Schema.Union([
  CompletionTaskIntendedEvent,
  CompletionTaskAttemptIntendedEvent,
  CompletionTaskAcknowledgedEvent,
  CompletionTaskResponseLostEvent,
  CompletionTaskRejectedEvent,
  CompletionTaskCandidateAncestryReadIntendedEvent,
  CompletionTaskCandidateAncestryObservedEvent,
  CompletionTaskRequestLookupIntendedEvent,
  CompletionTaskRequestLookupObservedEvent
])
type CompletionTaskJournalEvent = typeof CompletionTaskJournalEvent.Type
type CompletionTaskAuthorizationPurpose = Extract<CompletionTaskFocusedReadPurpose, { readonly _tag: "Authorization" }>
type CompletionTaskFactsReadOperation = Extract<
  WorkflowJournalEvent,
  { readonly _tag: "TaskTrackerReadIntentRecorded" }
>["operation"] & { readonly _tag: "ReadCompletionTaskFacts" }

const focusedCompletionObservation = (event: WorkflowJournalEvent): FocusedTaskCompletionFactsObserved | undefined =>
  event._tag === "TaskTrackerFactsObserved" && event.observation._tag === "FocusedTaskCompletionFacts"
    ? event.observation
    : undefined

const latestRequestEvent = (
  records: ReadonlyArray<JournalRecord>,
  tag: CompletionTaskJournalEvent["_tag"],
  operationId: string
): CompletionTaskJournalEvent | undefined => {
  for (const record of records.toReversed()) {
    const decoded = Schema.decodeUnknownOption(CompletionTaskJournalEvent)(record.event)
    if (Option.isSome(decoded) && decoded.value._tag === tag && decoded.value.request.operationId === operationId) {
      return decoded.value
    }
  }
  return undefined
}

const ordinalFor = (value: number): CompletionTaskRequestOrdinal => CompletionTaskRequestOrdinal.make(value)

const append = Effect.fn("IntegrationFinality.appendCompletionTaskEvent")(function* (
  request: CompletionTaskRequest,
  key: Parameters<InRunJournal["Service"]["append"]>[1],
  event: AppendableWorkflowJournalEvent
) {
  const journal = yield* InRunJournal
  return yield* journal.append(request.claim.plannedAttempt.runId, key, event)
})

const focusedTaskAuthorizationIssue = (
  facts: FocusedTaskCompletionFacts,
  target: TrackerTarget,
  request: CompletionTaskRequest
): CompletionTaskAuthorizationIssue | undefined => {
  if (facts.taskId !== request.taskId || facts.taskRevision !== request.taskRevision) {
    return {
      detail: "focused task revision or identity differs from the immutable request",
      reason: "TaskIdentityOrRevisionChanged"
    }
  }
  if (facts.lifecycle !== "Open") {
    return { detail: `task lifecycle is ${facts.lifecycle}, not Open`, reason: "TaskLifecycleConflict" }
  }
  if (taskTrackerTargetKey(facts.target) !== taskTrackerTargetKey(target)) {
    return { detail: "focused task facts came from another tracker target", reason: "TrackerTargetChanged" }
  }
  if (facts.targetMembership !== "Member") {
    return { detail: "focused task is not a member of the tracker target", reason: "TaskNotInTarget" }
  }
  if (facts.unfinishedPrerequisiteTaskIds.length !== 0) {
    return { detail: "task has unfinished prerequisites", reason: "PrerequisitesIncomplete" }
  }
  return undefined
}

const completionClaimAuthorizationIssue = (
  facts: FocusedTaskCompletionFacts,
  request: CompletionTaskRequest
): CompletionTaskAuthorizationIssue | undefined => {
  if (facts.currentClaim._tag === "UnclaimedTask") {
    return { detail: "the promotion-bound completion claim is missing", reason: "CompletionClaimMissing" }
  }
  if (
    facts.currentClaim._tag !== "CompletionTaskClaim" ||
    !completionTaskClaimEquals(facts.currentClaim, request.claim)
  ) {
    return { detail: "another claim replaced the promotion-bound completion claim", reason: "CompletionClaimForeign" }
  }
  return undefined
}

/** Returns the first exact-current-premise conflict that forbids a completion mutation. */
export const completionTaskAuthorizationIssue = (
  authorization: CompletionTaskAuthorization,
  request: CompletionTaskRequest
): CompletionTaskAuthorizationIssue | undefined =>
  focusedTaskAuthorizationIssue(authorization.focusedFacts, authorization.target, request) ??
  completionClaimAuthorizationIssue(authorization.focusedFacts, request)

const appendIntentIfNeeded = Effect.fn("IntegrationFinality.appendCompletionTaskIntentIfNeeded")(function* (
  request: CompletionTaskRequest,
  records: ReadonlyArray<JournalRecord>
) {
  const existing = latestRequestEvent(records, "CompletionTaskIntended", request.operationId)
  if (existing?._tag === "CompletionTaskIntended") {
    /* v8 ignore next -- @preserve One journal key is append-once for one decoded Q; reconstruction owns hostile key substitution. */
    if (!completionTaskRequestEquals(existing.request, request)) {
      return yield* new CompletionTaskAuthorizationConflict({
        detail: "completion operation is bound to another Q",
        reason: "RequestIdentityContradiction",
        request
      })
    }
    return
  }
  yield* append(
    request,
    completionTaskIntentRecordKey(request),
    CompletionTaskIntendedEvent.make({ request, version: workflowJournalEventVersion })
  )
})

const latestAttempt = (records: ReadonlyArray<JournalRecord>, request: CompletionTaskRequest): number =>
  records.reduce(
    (latest, record) =>
      record.event._tag === "CompletionTaskAttemptIntended" && record.event.request.operationId === request.operationId
        ? Math.max(latest, Number(record.event.attemptOrdinal))
        : latest,
    0
  )

const appendLookup = Effect.fn("IntegrationFinality.appendCompletionTaskLookup")(function* (
  request: CompletionTaskRequest,
  ordinal: CompletionTaskRequestOrdinal,
  lookup: CompletionTaskRequestLookup
) {
  yield* append(
    request,
    completionTaskRequestLookupRecordKey(request, ordinal),
    CompletionTaskRequestLookupObservedEvent.make({
      attemptOrdinal: ordinal,
      lookup,
      operationId: completionTaskRequestLookupOperationIdFor(request, ordinal),
      request,
      version: workflowJournalEventVersion
    })
  )
})

/** Records intent and the normalized result around one task-local tracker read. */
export const readCompletionFocusedFacts = Effect.fn("IntegrationFinality.readCompletionFocusedFacts")(function* (
  boundary: CompletionTaskBoundaryService,
  request: CompletionTaskRequest,
  target: TrackerTarget,
  purpose: CompletionTaskFocusedReadPurpose
) {
  const operation = makeCompletionTaskFactsObservationOperation(request, target, purpose)
  const operationId = operation.operationId
  yield* append(request, intentRecordKey(operationId), taskTrackerReadIntent(operation))
  const journal = yield* InRunJournal
  const records = yield* journal.read(request.claim.plannedAttempt.runId)
  const existing = records.findLast(
    ({ event }) => event._tag === "TaskTrackerFactsObserved" && event.operationId === operationId
  )
  const existingObservation = existing === undefined ? undefined : focusedCompletionObservation(existing.event)
  if (existing !== undefined && existingObservation !== undefined) {
    /* v8 ignore start -- @preserve The append-once outcome key and history validator bind this result to its exact request, purpose, and target. */
    if (
      !completionTaskRequestEquals(existingObservation.request, request) ||
      !completionTaskFocusedReadPurposeEquals(existingObservation.purpose, purpose) ||
      taskTrackerTargetKey(existingObservation.target) !== taskTrackerTargetKey(target)
    ) {
      return yield* new CompletionTaskAuthorizationConflict({
        detail: "focused completion read outcome is bound to another request or purpose",
        reason: "FocusedFactsCorrelationMismatch",
        request
      })
    }
    /* v8 ignore stop -- @preserve */
    return { facts: existingObservation.facts, observedAt: existing.position, operationId } as const
  }
  const facts = yield* boundary.readFocusedTaskCompletion(request.taskId, target, operationId)
  if (facts.operationId !== operationId) {
    return yield* new CompletionTaskAuthorizationConflict({
      detail: "focused completion facts do not correlate to their durable read intent",
      reason: "FocusedFactsCorrelationMismatch",
      request
    })
  }
  const record = yield* append(
    request,
    outcomeRecordKey(operationId),
    taskTrackerFactsObservedEvent(operationId, makeFocusedTaskCompletionFactsObserved(operation, facts))
  )
  return { facts, observedAt: record.position, operationId } as const
})

/** Records intent and Git's normalized ancestry result around one current authorization read. */
export const readCompletionCandidateAncestry = Effect.fn("IntegrationFinality.readCompletionCandidateAncestry")(
  function* (request: CompletionTaskRequest, purpose: CompletionTaskAuthorizationPurpose) {
    const operationId = completionTaskCandidateAncestryReadOperationIdFor(request, purpose)
    yield* append(
      request,
      completionTaskCandidateAncestryReadIntentRecordKey(operationId),
      CompletionTaskCandidateAncestryReadIntendedEvent.make({
        attemptOrdinal: purpose.attemptOrdinal,
        operationId,
        request,
        version: workflowJournalEventVersion
      })
    )
    const journal = yield* InRunJournal
    const records = yield* journal.read(request.claim.plannedAttempt.runId)
    const existing = records.findLast(
      ({ event }) => event._tag === "CompletionTaskCandidateAncestryObserved" && event.operationId === operationId
    )
    if (existing?.event._tag === "CompletionTaskCandidateAncestryObserved") {
      /* v8 ignore start -- @preserve The append-once ancestry key and history validator bind this result to its exact request and numbered call. */
      if (
        existing.event.attemptOrdinal !== purpose.attemptOrdinal ||
        !completionTaskRequestEquals(existing.event.request, request)
      ) {
        return yield* new CompletionTaskAuthorizationConflict({
          detail: "candidate ancestry outcome is bound to another request or numbered call",
          reason: "RequestIdentityContradiction",
          request
        })
      }
      /* v8 ignore stop -- @preserve */
      return { observation: existing.event.observation, operationId } as const
    }
    const git = yield* TargetPromotionGit
    const observation = yield* git.read(targetPromotionGitRequestFor(request.claim.promotionCorrelation))
    yield* append(
      request,
      completionTaskCandidateAncestryObservedRecordKey(operationId),
      CompletionTaskCandidateAncestryObservedEvent.make({
        attemptOrdinal: purpose.attemptOrdinal,
        observation,
        operationId,
        request,
        version: workflowJournalEventVersion
      })
    )
    return { observation, operationId } as const
  }
)

/** Selects one restart-safe current-authorization cycle for a numbered completion call. */
export const nextCompletionAuthorizationPurpose = Effect.fn("IntegrationFinality.nextCompletionAuthorizationPurpose")(
  function* (request: CompletionTaskRequest, attemptOrdinal: CompletionTaskRequestOrdinal) {
    const journal = yield* InRunJournal
    const records = yield* journal.read(request.claim.plannedAttempt.runId)
    const priorIntents: ReadonlyArray<
      CompletionTaskFactsReadOperation & { readonly purpose: CompletionTaskAuthorizationPurpose }
    > = records.flatMap(({ event }) => {
      if (
        event._tag !== "TaskTrackerReadIntentRecorded" ||
        event.operation._tag !== "ReadCompletionTaskFacts" ||
        event.operation.request.operationId !== request.operationId ||
        event.operation.purpose._tag !== "Authorization" ||
        event.operation.purpose.attemptOrdinal !== attemptOrdinal
      ) {
        return []
      }
      return [{ ...event.operation, purpose: event.operation.purpose }]
    })
    const latest = priorIntents.reduce<(typeof priorIntents)[number] | undefined>(
      (current, candidate) =>
        /* v8 ignore next -- @preserve Authorization ordinals are journal-monotonic; hostile duplicate/reordered keys are rejected during reconstruction. */
        current === undefined || candidate.purpose.authorizationOrdinal > current.purpose.authorizationOrdinal
          ? candidate
          : current,
      undefined
    )
    if (latest?.purpose._tag === "Authorization") {
      const focusedWasObserved = records.some(
        ({ event }) => event._tag === "TaskTrackerFactsObserved" && event.operationId === latest.operationId
      )
      if (!focusedWasObserved) return latest.purpose
    }
    const nextOrdinal =
      priorIntents.reduce((greatest, intent) => Math.max(greatest, Number(intent.purpose.authorizationOrdinal)), 0) + 1
    return CompletionTaskFocusedReadPurpose.cases.Authorization.make({
      attemptOrdinal,
      authorizationOrdinal: CompletionTaskAuthorizationReadOrdinal.make(nextOrdinal)
    })
  }
)

/** Rereads and records every current premise required before one tracker mutation call. */
export const authorizeCompletionTaskAttempt = Effect.fn("IntegrationFinality.authorizeCompletionTaskAttempt")(
  function* (
    boundary: CompletionTaskBoundaryService,
    request: CompletionTaskRequest,
    target: TrackerTarget,
    ordinal: CompletionTaskRequestOrdinal
  ) {
    const purpose = yield* nextCompletionAuthorizationPurpose(request, ordinal).pipe(
      Effect.mapError(
        (failure) =>
          new CompletionTaskAuthorizationWait({
            detail: `current authorization cycle could not be reconstructed: ${String(failure)}`,
            reason: "CurrentFactsJournalUnavailable",
            request
          })
      )
    )
    const focused = yield* readCompletionFocusedFacts(boundary, request, target, purpose).pipe(
      Effect.mapError((failure) =>
        Match.value(failure).pipe(
          Match.when(Match.instanceOf(CompletionTaskAuthorizationConflict), (conflict) => conflict),
          Match.orElse(
            (cause) =>
              new CompletionTaskAuthorizationWait({ detail: String(cause), reason: "FocusedFactsUnavailable", request })
          )
        )
      )
    )
    const alreadyCompleted = focusedCompletionObservationFor(request, focused.facts, focused.observedAt, target)
    if (alreadyCompleted !== undefined) {
      return CompletionTaskAttemptAuthorization.cases.CompletionAlreadyObserved.make({ observation: alreadyCompleted })
    }
    const ancestry = yield* readCompletionCandidateAncestry(request, purpose).pipe(
      Effect.mapError((failure) =>
        Match.value(failure).pipe(
          Match.when(Match.instanceOf(CompletionTaskAuthorizationConflict), (conflict) => conflict),
          Match.orElse(
            (cause) =>
              new CompletionTaskAuthorizationWait({
                detail: String(cause),
                reason: "PromotedCandidateAncestryUnavailable",
                request
              })
          )
        )
      )
    )
    const candidateAncestry = candidateAncestryFor(ancestry.observation)
    if (candidateAncestry === undefined) {
      return yield* new CompletionTaskAuthorizationConflict({
        detail: "promoted candidate is no longer in target ancestry",
        reason: "PromotedCandidateStale",
        request
      })
    }
    yield* rereadCompletionEvidence(request)
    return CompletionTaskAttemptAuthorization.cases.ReadyToComplete.make({
      authorization: CompletionTaskAuthorization.make({
        candidateAncestry,
        focusedFacts: focused.facts,
        gitReadOperationId: ancestry.operationId,
        target
      })
    })
  }
)

const focusedCompletionObservationFor = (
  request: CompletionTaskRequest,
  facts: FocusedTaskCompletionFacts,
  observedAt: JournalRecord["position"],
  target: TrackerTarget
): FocusedCompletedTaskObservation | undefined =>
  facts.lifecycle === "CompletedSuccessfully" &&
  facts.taskId === request.taskId &&
  facts.taskRevision === request.taskRevision &&
  taskTrackerTargetKey(facts.target) === taskTrackerTargetKey(target)
    ? FocusedCompletedTaskObservation.make({
        claim: request.claim,
        lifecycle: "CompletedSuccessfully",
        observedAt,
        operationId: facts.operationId,
        taskId: facts.taskId,
        taskRevision: facts.taskRevision,
        trackerRevision: facts.trackerRevision,
        target: facts.target
      })
    : undefined

/** Pure current task-local classification shared by live confirmation and reconstructed diagnostics. */
export type CompletionTaskConfirmationDisposition =
  | { readonly _tag: "CompletedSuccessfully" }
  | { readonly _tag: "Pending" }
  | { readonly _tag: "Conflict"; readonly detail: string; readonly reason: CompletionTaskConflictReason }

export const completionTaskConfirmationDisposition = (
  request: CompletionTaskRequest,
  target: TrackerTarget,
  operationId: OperationId,
  facts: FocusedTaskCompletionFacts
): CompletionTaskConfirmationDisposition => {
  if (facts.operationId !== operationId) {
    return {
      _tag: "Conflict",
      detail: "focused completion result names another read operation",
      reason: "FocusedFactsCorrelationMismatch"
    }
  }
  if (facts.taskId !== request.taskId || facts.taskRevision !== request.taskRevision) {
    return {
      _tag: "Conflict",
      detail: "focused completion result names another task identity or revision",
      reason: "TaskIdentityOrRevisionChanged"
    }
  }
  if (taskTrackerTargetKey(facts.target) !== taskTrackerTargetKey(target)) {
    return {
      _tag: "Conflict",
      detail: "focused completion result names another tracker target or target membership",
      reason: "TrackerTargetChanged"
    }
  }
  if (facts.targetMembership !== "Member") {
    return {
      _tag: "Conflict",
      detail: "focused completion reconciliation found the task outside the tracker target",
      reason: "TaskNotInTarget"
    }
  }
  return Match.value(facts.lifecycle).pipe(
    Match.when("CompletedSuccessfully", () => ({ _tag: "CompletedSuccessfully" as const })),
    Match.when("TerminalWithoutSuccess", () => ({
      _tag: "Conflict" as const,
      detail: "focused completion reconciliation found TerminalWithoutSuccess",
      reason: "TaskLifecycleConflict" as const
    })),
    Match.when("Open", () =>
      Match.valueTags(facts.currentClaim, {
        ActiveTaskClaim: () => ({
          _tag: "Conflict" as const,
          detail: "focused completion reconciliation found another current claim",
          reason: "CompletionClaimForeign" as const
        }),
        CompletionTaskClaim: (claim) =>
          completionTaskClaimEquals(claim, request.claim)
            ? ({ _tag: "Pending" as const } as const)
            : ({
                _tag: "Conflict" as const,
                detail: "focused completion reconciliation found another current claim",
                reason: "CompletionClaimForeign" as const
              } as const),
        ForeignCompletionClaim: () => ({
          _tag: "Conflict" as const,
          detail: "focused completion reconciliation found another completion fingerprint",
          reason: "CompletionClaimForeign" as const
        }),
        UnclaimedTask: () => ({
          _tag: "Conflict" as const,
          detail: "focused completion reconciliation found no current claim",
          reason: "CompletionClaimMissing" as const
        })
      })
    ),
    Match.exhaustive
  )
}

export const nextCompletionConfirmationPurpose = Effect.fn("IntegrationFinality.nextCompletionConfirmationPurpose")(
  function* (request: CompletionTaskRequest, attemptOrdinal: CompletionTaskRequestOrdinal) {
    const journal = yield* InRunJournal
    const records = yield* journal.read(request.claim.plannedAttempt.runId)
    const priorIntents = records.flatMap(({ event }) =>
      event._tag === "TaskTrackerReadIntentRecorded" &&
      event.operation._tag === "ReadCompletionTaskFacts" &&
      event.operation.request.operationId === request.operationId &&
      event.operation.purpose._tag === "Confirmation" &&
      event.operation.purpose.attemptOrdinal === attemptOrdinal
        ? [event.operation]
        : []
    )
    const unresolved = priorIntents.findLast(
      (intent) =>
        !records.some(
          ({ event }) => event._tag === "TaskTrackerFactsObserved" && event.operationId === intent.operationId
        )
    )
    return unresolved?.purpose._tag === "Confirmation"
      ? unresolved.purpose
      : CompletionTaskFocusedReadPurpose.cases.Confirmation.make({
          attemptOrdinal,
          confirmationOrdinal: CompletionTaskConfirmationReadOrdinal.make(priorIntents.length + 1)
        })
  }
)

const completionConfirmationFromFocusedFacts = Effect.fn("IntegrationFinality.completionConfirmationFromFocusedFacts")(
  function* (
    request: CompletionTaskRequest,
    target: TrackerTarget,
    focused: {
      readonly facts: FocusedTaskCompletionFacts
      readonly observedAt: JournalRecord["position"]
      readonly operationId: OperationId
    }
  ) {
    const { facts, observedAt, operationId } = focused
    const disposition = completionTaskConfirmationDisposition(request, target, operationId, facts)
    if (disposition._tag === "Pending") return undefined
    if (disposition._tag === "Conflict") {
      return yield* new CompletionTaskPreconditionConflict({
        detail: disposition.detail,
        reason: disposition.reason,
        request
      })
    }
    const observation = FocusedCompletedTaskObservation.make({
      claim: request.claim,
      lifecycle: "CompletedSuccessfully",
      observedAt,
      operationId,
      taskId: request.taskId,
      taskRevision: request.taskRevision,
      trackerRevision: facts.trackerRevision,
      target: facts.target
    })
    return observation
  }
)

/** Performs one new task-local confirmation read and classifies its exact current result. */
export const readCurrentCompletionConfirmation = Effect.fn("IntegrationFinality.readCurrentCompletionConfirmation")(
  function* (
    boundary: CompletionTaskBoundaryService,
    request: CompletionTaskRequest,
    ordinal: CompletionTaskRequestOrdinal,
    target: TrackerTarget
  ) {
    const purpose = yield* nextCompletionConfirmationPurpose(request, ordinal)
    const focused = yield* readCompletionFocusedFacts(boundary, request, target, purpose).pipe(
      Effect.mapError(
        (failure) =>
          new CompletionTaskConfirmationWait({
            /* v8 ignore next -- @preserve Every typed focused-read or journal failure carries detail; String remains fail-closed for foreign defects. */
            detail: "detail" in failure ? failure.detail : String(failure),
            operationId: completionTaskFocusedReadOperationIdFor(request, purpose),
            request
          })
      )
    )
    return {
      observation: yield* completionConfirmationFromFocusedFacts(request, target, focused),
      operationId: focused.operationId
    } as const
  }
)

/** Resumes a durable confirmation outcome before issuing any newer tracker read. */
export const readCompletionConfirmation = Effect.fn("IntegrationFinality.readCompletionConfirmation")(function* (
  boundary: CompletionTaskBoundaryService,
  request: CompletionTaskRequest,
  ordinal: CompletionTaskRequestOrdinal,
  target: TrackerTarget
) {
  const journal = yield* InRunJournal
  const records = yield* journal.read(request.claim.plannedAttempt.runId)
  const existing = records.findLast(
    ({ event }) =>
      event._tag === "TaskTrackerFactsObserved" &&
      event.observation._tag === "FocusedTaskCompletionFacts" &&
      event.observation.request.operationId === request.operationId &&
      event.observation.purpose._tag === "Confirmation" &&
      event.observation.purpose.attemptOrdinal === ordinal
  )
  if (
    existing?.event._tag === "TaskTrackerFactsObserved" &&
    existing.event.observation._tag === "FocusedTaskCompletionFacts"
  ) {
    return yield* completionConfirmationFromFocusedFacts(request, target, {
      facts: existing.event.observation.facts,
      observedAt: existing.position,
      operationId: existing.event.operationId
    })
  }
  return (yield* readCurrentCompletionConfirmation(boundary, request, ordinal, target)).observation
})

const lookupForAttempt = (
  records: ReadonlyArray<JournalRecord>,
  request: CompletionTaskRequest,
  ordinal: CompletionTaskRequestOrdinal
): CompletionTaskRequestLookup | undefined => {
  const record = records.findLast(
    ({ event }) =>
      event._tag === "CompletionTaskRequestLookupObserved" &&
      event.request.operationId === request.operationId &&
      event.attemptOrdinal === ordinal
  )
  return record?.event._tag === "CompletionTaskRequestLookupObserved" ? record.event.lookup : undefined
}

const readAndRecordCompletionRequestLookup = Effect.fn("IntegrationFinality.readAndRecordCompletionRequestLookup")(
  function* (
    boundary: CompletionTaskBoundaryService,
    request: CompletionTaskRequest,
    ordinal: CompletionTaskRequestOrdinal
  ) {
    const operationId = completionTaskRequestLookupOperationIdFor(request, ordinal)
    yield* append(
      request,
      completionTaskRequestLookupIntentRecordKey(request, ordinal),
      CompletionTaskRequestLookupIntendedEvent.make({
        attemptOrdinal: ordinal,
        operationId,
        request,
        version: workflowJournalEventVersion
      })
    )
    const lookup = yield* boundary
      .readCompletionRequest(request)
      .pipe(
        Effect.catchTag("IntegrationFinality.CompletionTaskRequestLookupFailure", (failure) =>
          Effect.succeed(CompletionTaskRequestLookup.cases.Unreadable.make({ detail: failure.detail, request }))
        )
      )
    if (!completionTaskRequestEquals(lookup.request, request)) {
      return yield* new CompletionTaskPreconditionConflict({
        detail: "completion-request lookup returned a different request identity",
        reason: "RequestIdentityContradiction",
        request
      })
    }
    yield* appendLookup(request, ordinal, lookup)
    return lookup
  }
)

const reconcileAmbiguousCompletionAttempt = Effect.fn("IntegrationFinality.reconcileAmbiguousCompletionAttempt")(
  function* (
    boundary: CompletionTaskBoundaryService,
    request: CompletionTaskRequest,
    ordinal: CompletionTaskRequestOrdinal,
    target: TrackerTarget
  ) {
    yield* append(
      request,
      completionTaskResponseLostRecordKey(request, ordinal),
      CompletionTaskResponseLostEvent.make({ attemptOrdinal: ordinal, request, version: workflowJournalEventVersion })
    )
    const confirmed = yield* readCompletionConfirmation(boundary, request, ordinal, target)
    if (confirmed !== undefined) return confirmed
    const lookup = yield* readAndRecordCompletionRequestLookup(boundary, request, ordinal)
    if (lookup._tag === "Applied") {
      return yield* new CompletionTaskAmbiguousWait({
        detail: "the exact request was applied, but task success still requires a fresh focused observation",
        lookup,
        request
      })
    }
    if (lookup._tag === "Unreadable") {
      return yield* new CompletionTaskAmbiguousWait({ detail: lookup.detail, lookup, request })
    }
    return undefined
  }
)

type CompletionTaskProtocolSuccess = CompletionTaskAcknowledgement | FocusedCompletedTaskObservation

const resumeRecordedCompletionOutcome = Effect.fn("IntegrationFinality.resumeRecordedCompletionOutcome")(function* (
  boundary: CompletionTaskBoundaryService,
  request: CompletionTaskRequest,
  target: TrackerTarget,
  records: ReadonlyArray<JournalRecord>
) {
  const acknowledgement = latestRequestEvent(records, "CompletionTaskAcknowledged", request.operationId)
  if (acknowledgement?._tag === "CompletionTaskAcknowledged") return Option.some(acknowledgement.acknowledgement)
  const rejection = latestRequestEvent(records, "CompletionTaskRejected", request.operationId)
  if (rejection?._tag !== "CompletionTaskRejected") return Option.none<CompletionTaskProtocolSuccess>()
  const confirmed = yield* readCompletionConfirmation(boundary, request, rejection.attemptOrdinal, target)
  if (confirmed !== undefined) return Option.some(confirmed)
  return yield* new CompletionTaskPreconditionConflict({
    detail: rejection.detail,
    reason: "TrackerCompletionRejected",
    request
  })
})

const resumeKnownCompletionLookup = Effect.fn("IntegrationFinality.resumeKnownCompletionLookup")(function* (
  boundary: CompletionTaskBoundaryService,
  request: CompletionTaskRequest,
  ordinal: CompletionTaskRequestOrdinal,
  target: TrackerTarget,
  lookup: CompletionTaskRequestLookup
) {
  if (lookup._tag === "NotApplied") return Option.none<CompletionTaskProtocolSuccess>()
  const confirmed = yield* readCompletionConfirmation(boundary, request, ordinal, target)
  /* v8 ignore next -- @preserve A durable lookup follows a durable exact-open confirmation; without newer graph authority it cannot become success inside this resume call. */
  if (confirmed !== undefined) return Option.some(confirmed)
  return yield* new CompletionTaskAmbiguousWait({
    detail:
      lookup._tag === "Applied"
        ? "the exact request was applied, but task success still requires a fresh focused observation"
        : lookup.detail,
    lookup,
    request
  })
})

const resumeLatestCompletionAttempt = Effect.fn("IntegrationFinality.resumeLatestCompletionAttempt")(function* (
  boundary: CompletionTaskBoundaryService,
  request: CompletionTaskRequest,
  target: TrackerTarget,
  records: ReadonlyArray<JournalRecord>
) {
  const attemptedOrdinal = latestAttempt(records, request)
  if (attemptedOrdinal === 0) {
    return { completed: Option.none<CompletionTaskProtocolSuccess>(), nextOrdinal: 1, records } as const
  }
  const ordinal = ordinalFor(attemptedOrdinal)
  const lookup = lookupForAttempt(records, request, ordinal)
  if (lookup !== undefined) {
    return {
      completed: yield* resumeKnownCompletionLookup(boundary, request, ordinal, target, lookup),
      nextOrdinal: attemptedOrdinal + 1,
      records
    } as const
  }
  const confirmed = yield* reconcileAmbiguousCompletionAttempt(boundary, request, ordinal, target)
  const journal = yield* InRunJournal
  return {
    completed: Option.fromNullishOr(confirmed),
    nextOrdinal: attemptedOrdinal + 1,
    records: yield* journal.read(request.claim.plannedAttempt.runId)
  } as const
})

const recordCompletionAcknowledgement = Effect.fn("IntegrationFinality.recordCompletionAcknowledgement")(function* (
  request: CompletionTaskRequest,
  ordinal: CompletionTaskRequestOrdinal,
  acknowledgement: CompletionTaskAcknowledgement
) {
  if (acknowledgement.operationId !== request.operationId || acknowledgement.taskId !== request.taskId) {
    return yield* new CompletionTaskPreconditionConflict({
      detail: "tracker acknowledged another completion request",
      reason: "TrackerAcknowledgementMismatch",
      request
    })
  }
  yield* append(
    request,
    completionTaskAcknowledgedRecordKey(request),
    CompletionTaskAcknowledgedEvent.make({
      acknowledgement,
      attemptOrdinal: ordinal,
      request,
      version: workflowJournalEventVersion
    })
  )
  return acknowledgement
})

const handleCompletionRequestFailure = Effect.fn("IntegrationFinality.handleCompletionRequestFailure")(function* (
  boundary: CompletionTaskBoundaryService,
  request: CompletionTaskRequest,
  ordinal: CompletionTaskRequestOrdinal,
  target: TrackerTarget,
  failure: CompletionTaskRequestFailure | TaskTrackerMutationThrottled
) {
  if (failure instanceof TaskTrackerMutationThrottled) return yield* failure
  if (failure.outcome !== "DefinitelyNotApplied") {
    const confirmed = yield* reconcileAmbiguousCompletionAttempt(boundary, request, ordinal, target)
    return confirmed === undefined ? ({ _tag: "Retry" } as const) : ({ _tag: "Completed", result: confirmed } as const)
  }
  yield* append(
    request,
    completionTaskRejectedRecordKey(request, ordinal),
    CompletionTaskRejectedEvent.make({
      attemptOrdinal: ordinal,
      detail: failure.detail,
      request,
      version: workflowJournalEventVersion
    })
  )
  const confirmed = yield* readCompletionConfirmation(boundary, request, ordinal, target)
  if (confirmed !== undefined) return { _tag: "Completed", result: confirmed } as const
  return yield* new CompletionTaskPreconditionConflict({
    detail: failure.detail,
    reason: "TrackerCompletionRejected",
    request
  })
})

const runCompletionAttempt = Effect.fn("IntegrationFinality.runCompletionAttempt")(function* <R>(
  boundary: CompletionTaskBoundaryService,
  request: CompletionTaskRequest,
  ordinal: CompletionTaskRequestOrdinal,
  target: TrackerTarget,
  records: ReadonlyArray<JournalRecord>,
  authorization: (
    ordinal: CompletionTaskRequestOrdinal
  ) => Effect.Effect<
    CompletionTaskAttemptAuthorization,
    CompletionTaskAuthorizationConflict | CompletionTaskAuthorizationWait,
    R
  >
) {
  const authorizationResult = yield* authorization(ordinal)
  if (authorizationResult._tag === "CompletionAlreadyObserved") {
    return { _tag: "Completed", result: authorizationResult.observation } as const
  }
  const premiseIssue = completionTaskAuthorizationIssue(authorizationResult.authorization, request)
  if (premiseIssue !== undefined) return yield* new CompletionTaskPreconditionConflict({ ...premiseIssue, request })
  yield* appendIntentIfNeeded(request, records)
  yield* append(
    request,
    completionTaskAttemptIntentRecordKey(request, ordinal),
    CompletionTaskAttemptIntendedEvent.make({
      attemptOrdinal: ordinal,
      focusedFactsOperationId: authorizationResult.authorization.focusedFacts.operationId,
      gitReadOperationId: authorizationResult.authorization.gitReadOperationId,
      request,
      version: workflowJournalEventVersion
    })
  )
  const result = yield* boundary.completeTask(request).pipe(Effect.result)
  if (result._tag === "Success") {
    return {
      _tag: "Completed",
      result: yield* recordCompletionAcknowledgement(request, ordinal, result.success)
    } as const
  }
  return yield* handleCompletionRequestFailure(boundary, request, ordinal, target, result.failure)
})

/** Executes the bounded Q protocol. Current authorization is reread before every numbered call. */
export const runCompletionTaskProtocol = Effect.fn("IntegrationFinality.runCompletionTaskProtocol")(function* <R>(
  boundary: CompletionTaskBoundaryService,
  request: CompletionTaskRequest,
  target: TrackerTarget,
  authorization: (
    ordinal: CompletionTaskRequestOrdinal
  ) => Effect.Effect<
    CompletionTaskAttemptAuthorization,
    CompletionTaskAuthorizationConflict | CompletionTaskAuthorizationWait,
    R
  >
) {
  const journal = yield* InRunJournal
  const initialRecords = yield* journal.read(request.claim.plannedAttempt.runId)
  const recorded = yield* resumeRecordedCompletionOutcome(boundary, request, target, initialRecords)
  if (Option.isSome(recorded)) return recorded.value
  const resumed = yield* resumeLatestCompletionAttempt(boundary, request, target, initialRecords)
  if (Option.isSome(resumed.completed)) return resumed.completed.value
  let records = resumed.records
  for (let nextOrdinal = resumed.nextOrdinal; nextOrdinal <= completionTaskRequestLimit; nextOrdinal += 1) {
    const ordinal = ordinalFor(nextOrdinal)
    const attempt = yield* runCompletionAttempt(boundary, request, ordinal, target, records, authorization)
    if (attempt._tag === "Completed") return attempt.result
    records = yield* journal.read(request.claim.plannedAttempt.runId)
  }
  return yield* new CompletionTaskDidNotConverge({ attempts: completionTaskRequestLimit, request })
})

/** Rereads and schema-validates the exact accepted-result evidence before Q may mutate the tracker. */
export const rereadCompletionEvidence = Effect.fn("IntegrationFinality.rereadCompletionEvidence")(function* (
  request: CompletionTaskRequest
) {
  const store = yield* EvidenceStore
  const parseManifestJson = (bytes: Uint8Array) =>
    Effect.try({
      try: (): unknown => JSON.parse(new TextDecoder().decode(bytes)),
      catch: (cause) =>
        new CompletionTaskAuthorizationConflict({
          detail: `accepted-result evidence is not JSON: ${String(cause)}`,
          reason: "SealedEvidenceUnavailableOrInvalid",
          request
        })
    })
  const acceptedResult = targetPromotionAcceptedResultOf(request.claim.promotionCorrelation)
  const reference = acceptedResult.evidenceManifest
  const decoded = yield* store.read(reference).pipe(
    Effect.mapError(
      (cause) =>
        new CompletionTaskAuthorizationWait({
          detail: `accepted-result evidence is unavailable: ${String(cause)}`,
          reason: "SealedEvidenceUnavailable",
          request
        })
    ),
    Effect.flatMap(parseManifestJson),
    Effect.flatMap(Schema.decodeUnknownEffect(AcceptedResultEvidenceManifest)),
    Effect.mapError((cause) =>
      /* v8 ignore next -- @preserve Earlier sealed-read/JSON failures are already owner-typed; only schema defects require the envelope wrapper. */
      cause instanceof CompletionTaskAuthorizationConflict || cause instanceof CompletionTaskAuthorizationWait
        ? cause
        : new CompletionTaskAuthorizationConflict({
            detail: `accepted-result evidence has an invalid envelope: ${String(cause)}`,
            reason: "SealedEvidenceUnavailableOrInvalid",
            request
          })
    )
  )
  if (
    decoded.commit !== acceptedResult.commit ||
    decoded.correlation.attemptId !== request.claim.plannedAttempt.attemptId ||
    decoded.correlation.runId !== request.claim.plannedAttempt.runId
  ) {
    return yield* new CompletionTaskAuthorizationConflict({
      detail: "accepted-result evidence does not bind the promoted commit, RunId, and AttemptId",
      reason: "SealedEvidenceChanged",
      request
    })
  }
  return decoded
})

export const candidateAncestryFor = (
  observation: TargetPromotionGitReadObservation
): "Current" | "Ancestor" | undefined =>
  observation._tag === "CandidateCurrent"
    ? "Current"
    : observation._tag === "CandidateAncestor"
      ? "Ancestor"
      : undefined
