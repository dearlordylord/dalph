/* eslint-disable max-lines -- Raw ordered diagnostics and exact indexed evidence share one parity implementation. */
import { Match } from "effect"
import type { RunId } from "@dalph/contracts"
import { taskTrackerTargetKey } from "../../../authorities/task-tracker/target.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import {
  firstJournalRecordOfKind,
  isJournalRecordEvidence,
  journalCompletionReadCycle,
  journalEvidenceBefore,
  journalRecordsForOperationIdKind,
  journalSettledCompletionClaimReplacement,
  type JournalHistorySource
} from "../../../workflow-journal/record-evidence.js"
import type { WorkflowJournalEvent } from "../../registry/event.js"
import type { WorkflowOperation } from "../../registry/operation.js"
import {
  CompletionTaskAuthorization,
  candidateAncestryFor,
  completionTaskAuthorizationIssue
} from "./completion-task-protocol.js"
import {
  completionTaskCandidateAncestryReadOperationIdFor,
  completionTaskFocusedReadOperationIdFor,
  completionTaskRequestLookupOperationIdFor
} from "./completion-task-operation-identity.js"
import {
  CompletionTaskRequestOrdinal,
  completionTaskClaimEquals,
  completionTaskRequestEquals,
  completionTaskRequestLimit,
  type CompletionTaskRequest
} from "./events.js"
import {
  focusedCompletionIntentMatchesOutcome,
  focusedCompletionOutcomeMatchesRunTarget,
  isFocusedCompletionFactsObserved,
  type FocusedCompletionFactsObservedEvent
} from "./completion-task-history-relations.js"
import { invalidPostPromotionBlockerAncestryHistory } from "./post-promotion-blocker-ancestry.js"

const completionTaskEventTagValues = [
  "CompletionTaskIntended",
  "CompletionTaskAttemptIntended",
  "CompletionTaskAcknowledged",
  "CompletionTaskResponseLost",
  "CompletionTaskRejected",
  "CompletionTaskCandidateAncestryReadIntended",
  "CompletionTaskCandidateAncestryObserved",
  "CompletionTaskRequestLookupIntended",
  "CompletionTaskRequestLookupObserved"
] as const satisfies ReadonlyArray<WorkflowJournalEvent["_tag"]>

type CompletionTaskEventTag = (typeof completionTaskEventTagValues)[number]
type CompletionTaskProtocolEvent = Extract<WorkflowJournalEvent, { readonly _tag: CompletionTaskEventTag }>
type FocusedFactsReadOperation = Extract<WorkflowOperation, { readonly _tag: "ReadCompletionTaskFacts" }>
type FocusedFactsReadIntent = Extract<WorkflowJournalEvent, { readonly _tag: "TaskTrackerReadIntentRecorded" }> & {
  readonly operation: FocusedFactsReadOperation
}
type CompletionTaskEvent = CompletionTaskProtocolEvent | FocusedFactsReadIntent | FocusedCompletionFactsObservedEvent
const completionTaskEventTags = new Set<WorkflowJournalEvent["_tag"]>(completionTaskEventTagValues)
const completionTaskAttemptResultTagValues = [
  "CompletionTaskAcknowledged",
  "CompletionTaskResponseLost",
  "CompletionTaskRejected"
] as const satisfies ReadonlyArray<CompletionTaskProtocolEvent["_tag"]>
type CompletionTaskAttemptResult = Extract<
  CompletionTaskProtocolEvent,
  { readonly _tag: (typeof completionTaskAttemptResultTagValues)[number] }
>
const completionTaskAttemptResultTags = new Set<WorkflowJournalEvent["_tag"]>(completionTaskAttemptResultTagValues)

const isCompletionTaskAttemptResult = (event: WorkflowJournalEvent): event is CompletionTaskAttemptResult =>
  completionTaskAttemptResultTags.has(event._tag)

const isCompletionTaskEvent = (event: WorkflowJournalEvent): event is CompletionTaskEvent =>
  completionTaskEventTags.has(event._tag) ||
  (event._tag === "TaskTrackerReadIntentRecorded" && event.operation._tag === "ReadCompletionTaskFacts") ||
  isFocusedCompletionFactsObserved(event)

export interface CompletionTaskHistoryIssue {
  readonly detail: string
  readonly kind: "Identity" | "Semantic"
}

const semantic = (detail: string): CompletionTaskHistoryIssue => ({ detail, kind: "Semantic" })
const identity = (detail: string): CompletionTaskHistoryIssue => ({ detail, kind: "Identity" })

const prior = (records: JournalHistorySource, record: JournalRecord): JournalHistorySource =>
  isJournalRecordEvidence(records)
    ? journalEvidenceBefore(records, record.position)
    : records.filter(({ position }) => position < record.position)

const findFirst = <A>(values: Iterable<A>, predicate: (value: A) => boolean): A | undefined => {
  for (const value of values) if (predicate(value)) return value
  return undefined
}

const findLast = <A>(values: Iterable<A>, predicate: (value: A) => boolean): A | undefined => {
  let found: A | undefined
  for (const value of values) if (predicate(value)) found = value
  return found
}

const countMatching = <A>(values: Iterable<A>, predicate: (value: A) => boolean): number => {
  let count = 0
  for (const value of values) if (predicate(value)) count += 1
  return count
}

const exactReplacementPrior = (
  records: JournalHistorySource,
  record: JournalRecord,
  request: CompletionTaskRequest
): boolean =>
  isJournalRecordEvidence(records)
    ? journalSettledCompletionClaimReplacement(journalEvidenceBefore(records, record.position), request.claim) !==
      undefined
    : records.some(
        ({ event, position }) =>
          position < record.position &&
          event._tag === "CompletionClaimReplaced" &&
          completionTaskClaimEquals(event.claim, request.claim)
      )

const requestIntentIssue = (
  event: Extract<CompletionTaskEvent, { readonly _tag: "CompletionTaskIntended" }>,
  record: JournalRecord,
  records: JournalHistorySource
): CompletionTaskHistoryIssue | undefined => {
  const duplicate = findFirst(
    journalRecordsForOperationIdKind(prior(records, record), event.request.operationId, "CompletionTaskIntended"),
    ({ event: candidate }) =>
      candidate._tag === "CompletionTaskIntended" && candidate.request.operationId === event.request.operationId
  )
  return !duplicate && exactReplacementPrior(records, record, event.request)
    ? undefined
    : semantic(`completion request ${event.request.operationId} lacks one exact prior claim replacement`)
}

const focusedIntentIssue = (
  event: FocusedFactsReadIntent,
  record: JournalRecord,
  records: JournalHistorySource
): CompletionTaskHistoryIssue | undefined =>
  event.operation.operationId ===
    completionTaskFocusedReadOperationIdFor(event.operation.request, event.operation.purpose) &&
  exactReplacementPrior(records, record, event.operation.request)
    ? undefined
    : semantic(`focused completion read ${event.operation.operationId} lacks its exact replacement-bound identity`)

type CompletionAttemptIntended = Extract<CompletionTaskEvent, { readonly _tag: "CompletionTaskAttemptIntended" }>

const focusedFactsMatchOutcome = (event: FocusedCompletionFactsObservedEvent): boolean =>
  event.observation.facts.operationId === event.operationId &&
  event.observation.facts.taskId === event.observation.request.taskId &&
  taskTrackerTargetKey(event.observation.target) === taskTrackerTargetKey(event.observation.facts.target)

const focusedOutcomeIssue = (
  event: FocusedCompletionFactsObservedEvent,
  record: JournalRecord,
  records: JournalHistorySource
): CompletionTaskHistoryIssue | undefined => {
  const accepted = prior(records, record)
  const intent = findLast(
    journalRecordsForOperationIdKind(accepted, event.operationId, "TaskTrackerReadIntentRecorded"),
    ({ event: candidate }) =>
      candidate._tag === "TaskTrackerReadIntentRecorded" && candidate.operation.operationId === event.operationId
  )?.event
  const runBeginning = firstJournalRecordOfKind(
    isJournalRecordEvidence(records) ? accepted : records,
    "WorkflowRunBegan"
  )?.event
  const exact =
    focusedCompletionIntentMatchesOutcome(intent, event) &&
    focusedFactsMatchOutcome(event) &&
    focusedCompletionOutcomeMatchesRunTarget(event, runBeginning)
  return exact ? undefined : semantic(`focused completion outcome ${event.operationId} lacks its exact prior intent`)
}

const ancestryIntentIssue = (
  event: Extract<CompletionTaskEvent, { readonly _tag: "CompletionTaskCandidateAncestryReadIntended" }>,
  record: JournalRecord,
  records: JournalHistorySource
): CompletionTaskHistoryIssue | undefined => {
  const accepted = prior(records, record)
  const acceptedCycle = isJournalRecordEvidence(accepted)
    ? journalCompletionReadCycle(accepted, {
        attemptOrdinal: event.attemptOrdinal,
        purpose: "Authorization",
        request: event.request
      })
    : undefined
  const matchingFocusedIntent = isJournalRecordEvidence(accepted)
    ? acceptedCycle?.latestIntent
    : findLast(
        journalRecordsForOperationIdKind(accepted, event.operationId, "TaskTrackerReadIntentRecorded"),
        ({ event: candidate }) =>
          candidate._tag === "TaskTrackerReadIntentRecorded" &&
          candidate.operation._tag === "ReadCompletionTaskFacts" &&
          candidate.operation.purpose._tag === "Authorization" &&
          candidate.operation.purpose.attemptOrdinal === event.attemptOrdinal &&
          completionTaskRequestEquals(candidate.operation.request, event.request)
      )
  const focusedIntent = matchingFocusedIntent?.event
  if (
    matchingFocusedIntent === undefined ||
    focusedIntent?._tag !== "TaskTrackerReadIntentRecorded" ||
    focusedIntent.operation._tag !== "ReadCompletionTaskFacts" ||
    focusedIntent.operation.purpose._tag !== "Authorization"
  ) {
    return semantic(`completion ancestry read ${event.operationId} lacks its exact replacement-bound identity`)
  }
  const matchingFocusedOutcome = isJournalRecordEvidence(accepted)
    ? acceptedCycle?.latestOutcome
    : findLast(
        journalRecordsForOperationIdKind(accepted, event.operationId, "TaskTrackerFactsObserved"),
        ({ event: candidate, position }) =>
          position > matchingFocusedIntent.position &&
          isFocusedCompletionFactsObserved(candidate) &&
          focusedCompletionIntentMatchesOutcome(focusedIntent, candidate)
      )
  return matchingFocusedOutcome !== undefined &&
    matchingFocusedOutcome.position > matchingFocusedIntent.position &&
    isFocusedCompletionFactsObserved(matchingFocusedOutcome.event) &&
    focusedCompletionIntentMatchesOutcome(focusedIntent, matchingFocusedOutcome.event) &&
    (!isJournalRecordEvidence(accepted) ||
      event.operationId ===
        completionTaskCandidateAncestryReadOperationIdFor(event.request, focusedIntent.operation.purpose)) &&
    exactReplacementPrior(records, record, event.request)
    ? undefined
    : semantic(`completion ancestry read ${event.operationId} lacks its exact replacement-bound identity`)
}

const ancestryOutcomeIssue = (
  event: Extract<CompletionTaskEvent, { readonly _tag: "CompletionTaskCandidateAncestryObserved" }>,
  record: JournalRecord,
  records: JournalHistorySource
): CompletionTaskHistoryIssue | undefined => {
  const intent = findLast(
    journalRecordsForOperationIdKind(
      prior(records, record),
      event.operationId,
      "CompletionTaskCandidateAncestryReadIntended"
    ),
    ({ event: candidate }) =>
      candidate._tag === "CompletionTaskCandidateAncestryReadIntended" && candidate.operationId === event.operationId
  )?.event
  return intent?._tag === "CompletionTaskCandidateAncestryReadIntended" &&
    intent.attemptOrdinal === event.attemptOrdinal &&
    completionTaskRequestEquals(intent.request, event.request)
    ? undefined
    : semantic(`completion ancestry outcome ${event.operationId} lacks its exact prior intent`)
}

const focusedFactsAuthorizeAttempt = (
  focused: WorkflowJournalEvent | undefined,
  event: CompletionAttemptIntended
): focused is FocusedCompletionFactsObservedEvent =>
  focused?._tag === "TaskTrackerFactsObserved" &&
  focused.observation._tag === "FocusedTaskCompletionFacts" &&
  focused.observation.purpose._tag === "Authorization" &&
  focused.observation.purpose.attemptOrdinal === event.attemptOrdinal &&
  completionTaskRequestEquals(focused.observation.request, event.request)

type CandidateAncestryObserved = Extract<
  CompletionTaskEvent,
  { readonly _tag: "CompletionTaskCandidateAncestryObserved" }
>

const ancestryAuthorizesAttempt = (
  ancestry: WorkflowJournalEvent | undefined,
  event: CompletionAttemptIntended
): ancestry is CandidateAncestryObserved =>
  ancestry?._tag === "CompletionTaskCandidateAncestryObserved" &&
  ancestry.attemptOrdinal === event.attemptOrdinal &&
  completionTaskRequestEquals(ancestry.request, event.request)

const attemptOrdinalIsNextAndBounded = (ordinal: number, priorAttemptCount: number): boolean =>
  ordinal === priorAttemptCount + 1 && ordinal <= completionTaskRequestLimit

const requestIntentForAttempt = (
  accepted: JournalHistorySource,
  event: CompletionAttemptIntended
): JournalRecord | undefined =>
  findLast(
    journalRecordsForOperationIdKind(accepted, event.request.operationId, "CompletionTaskIntended"),
    ({ event: candidate }) =>
      candidate._tag === "CompletionTaskIntended" && completionTaskRequestEquals(candidate.request, event.request)
  )

const focusedFactsForAttempt = (
  accepted: JournalHistorySource,
  event: CompletionAttemptIntended
): WorkflowJournalEvent | undefined =>
  findLast(
    journalRecordsForOperationIdKind(accepted, event.focusedFactsOperationId, "TaskTrackerFactsObserved"),
    ({ event: candidate }) =>
      candidate._tag === "TaskTrackerFactsObserved" && candidate.operationId === event.focusedFactsOperationId
  )?.event

const ancestryForAttempt = (
  accepted: JournalHistorySource,
  event: CompletionAttemptIntended
): WorkflowJournalEvent | undefined =>
  findLast(
    journalRecordsForOperationIdKind(accepted, event.gitReadOperationId, "CompletionTaskCandidateAncestryObserved"),
    ({ event: candidate }) =>
      candidate._tag === "CompletionTaskCandidateAncestryObserved" && candidate.operationId === event.gitReadOperationId
  )?.event

const completionAttemptCountForRequest = (accepted: JournalHistorySource, event: CompletionAttemptIntended): number =>
  countMatching(
    journalRecordsForOperationIdKind(accepted, event.request.operationId, "CompletionTaskAttemptIntended"),
    ({ event: candidate }) =>
      candidate._tag === "CompletionTaskAttemptIntended" && candidate.request.operationId === event.request.operationId
  )

const previousNotAppliedLookupPrecedesAuthorization = (
  accepted: JournalHistorySource,
  event: CompletionAttemptIntended
): boolean => {
  const ordinal = Number(event.attemptOrdinal)
  if (ordinal === 1) return true
  const previousOrdinal = ordinal - 1
  const previousLookupOperationId = completionTaskRequestLookupOperationIdFor(
    event.request,
    CompletionTaskRequestOrdinal.make(previousOrdinal)
  )
  const lookup = findLast(
    journalRecordsForOperationIdKind(accepted, previousLookupOperationId, "CompletionTaskRequestLookupObserved"),
    ({ event: candidate }) =>
      candidate._tag === "CompletionTaskRequestLookupObserved" &&
      Number(candidate.attemptOrdinal) === previousOrdinal &&
      candidate.operationId === previousLookupOperationId &&
      completionTaskRequestEquals(candidate.request, event.request) &&
      candidate.lookup._tag === "NotApplied" &&
      completionTaskRequestEquals(candidate.lookup.request, event.request)
  )
  const focusedIntent = findLast(
    journalRecordsForOperationIdKind(accepted, event.focusedFactsOperationId, "TaskTrackerReadIntentRecorded"),
    ({ event: candidate }) =>
      candidate._tag === "TaskTrackerReadIntentRecorded" &&
      candidate.operation.operationId === event.focusedFactsOperationId
  )
  const ancestryIntent = findLast(
    journalRecordsForOperationIdKind(accepted, event.gitReadOperationId, "CompletionTaskCandidateAncestryReadIntended"),
    ({ event: candidate }) =>
      candidate._tag === "CompletionTaskCandidateAncestryReadIntended" &&
      candidate.operationId === event.gitReadOperationId
  )
  return (
    lookup !== undefined &&
    focusedIntent !== undefined &&
    ancestryIntent !== undefined &&
    lookup.position < focusedIntent.position &&
    lookup.position < ancestryIntent.position
  )
}

const attemptIssue = (
  event: CompletionAttemptIntended,
  record: JournalRecord,
  records: JournalHistorySource
): CompletionTaskHistoryIssue | undefined => {
  const accepted = prior(records, record)
  const requestIntent = requestIntentForAttempt(accepted, event)
  const focused = focusedFactsForAttempt(accepted, event)
  const ancestry = ancestryForAttempt(accepted, event)
  const ordinal = Number(event.attemptOrdinal)
  const priorAttemptCount = completionAttemptCountForRequest(accepted, event)
  if (
    requestIntent === undefined ||
    !focusedFactsAuthorizeAttempt(focused, event) ||
    !ancestryAuthorizesAttempt(ancestry, event) ||
    !attemptOrdinalIsNextAndBounded(ordinal, priorAttemptCount)
  ) {
    return semantic(`completion call ${ordinal} lacks exact current tracker and Git authorization`)
  }
  if (!previousNotAppliedLookupPrecedesAuthorization(accepted, event)) {
    return semantic(`completion call ${ordinal} lacks the previous exact NotApplied lookup before fresh authorization`)
  }
  const candidateAncestry = candidateAncestryFor(ancestry.observation)
  if (candidateAncestry === undefined) {
    return semantic(`completion call ${ordinal} follows a stale promoted-candidate ancestry result`)
  }
  const authorization = CompletionTaskAuthorization.make({
    candidateAncestry,
    focusedFacts: focused.observation.facts,
    gitReadOperationId: ancestry.operationId,
    target: focused.observation.facts.target
  })
  const issue = completionTaskAuthorizationIssue(authorization, event.request)
  return issue === undefined ? undefined : semantic(`completion call ${ordinal} is unauthorized: ${issue.detail}`)
}

const attemptResultIssue = (
  event: Extract<
    CompletionTaskEvent,
    { readonly _tag: "CompletionTaskAcknowledged" | "CompletionTaskRejected" | "CompletionTaskResponseLost" }
  >,
  record: JournalRecord,
  records: JournalHistorySource
): CompletionTaskHistoryIssue | undefined => {
  const accepted = prior(records, record)
  const attempt = findLast(
    journalRecordsForOperationIdKind(
      accepted,
      completionTaskRequestLookupOperationIdFor(event.request, event.attemptOrdinal),
      "CompletionTaskAttemptIntended"
    ),
    ({ event: candidate }) =>
      candidate._tag === "CompletionTaskAttemptIntended" &&
      candidate.attemptOrdinal === event.attemptOrdinal &&
      completionTaskRequestEquals(candidate.request, event.request)
  )
  if (attempt === undefined) return semantic(`${event._tag} lacks its exact prior numbered call intent`)
  const resultOperationId = completionTaskRequestLookupOperationIdFor(event.request, event.attemptOrdinal)
  let priorResult: JournalRecord | undefined
  if (isJournalRecordEvidence(accepted)) {
    for (const kind of completionTaskAttemptResultTagValues) {
      const candidate = findFirst(
        journalRecordsForOperationIdKind(accepted, resultOperationId, kind),
        ({ event: candidate }) =>
          isCompletionTaskAttemptResult(candidate) &&
          candidate.attemptOrdinal === event.attemptOrdinal &&
          completionTaskRequestEquals(candidate.request, event.request)
      )
      if (candidate !== undefined && (priorResult === undefined || candidate.position < priorResult.position)) {
        priorResult = candidate
      }
    }
  } else {
    priorResult = findFirst(accepted, ({ event: candidate }) =>
      isCompletionTaskAttemptResult(candidate) &&
      candidate.attemptOrdinal === event.attemptOrdinal &&
      completionTaskRequestEquals(candidate.request, event.request)
    )
  }
  if (priorResult !== undefined) {
    return semantic(
      `completion call ${event.attemptOrdinal} has mutually exclusive ${priorResult.event._tag} and ${event._tag} outcomes`
    )
  }
  if (
    event._tag === "CompletionTaskAcknowledged" &&
    (event.acknowledgement.operationId !== event.request.operationId ||
      event.acknowledgement.taskId !== event.request.taskId)
  ) {
    return identity(`completion acknowledgement names another task or request`)
  }
  return undefined
}

const isExactOpenConfirmation = (
  confirmation: WorkflowJournalEvent | undefined,
  request: CompletionTaskRequest
): boolean =>
  confirmation?._tag === "TaskTrackerFactsObserved" &&
  confirmation.observation._tag === "FocusedTaskCompletionFacts" &&
  confirmation.observation.facts.lifecycle === "Open" &&
  confirmation.observation.facts.currentClaim._tag === "CompletionTaskClaim" &&
  completionTaskClaimEquals(confirmation.observation.facts.currentClaim, request.claim)

const lookupIntentIssue = (
  event: Extract<CompletionTaskEvent, { readonly _tag: "CompletionTaskRequestLookupIntended" }>,
  record: JournalRecord,
  records: JournalHistorySource
): CompletionTaskHistoryIssue | undefined => {
  const accepted = prior(records, record)
  const lost = findLast(
    journalRecordsForOperationIdKind(accepted, event.operationId, "CompletionTaskResponseLost"),
    ({ event: candidate }) =>
      candidate._tag === "CompletionTaskResponseLost" &&
      candidate.attemptOrdinal === event.attemptOrdinal &&
      completionTaskRequestEquals(candidate.request, event.request)
  )
  const confirmation = isJournalRecordEvidence(accepted)
    ? journalCompletionReadCycle(accepted, {
        attemptOrdinal: event.attemptOrdinal,
        purpose: "Confirmation",
        request: event.request
      }).latestOutcome
    : findLast(
        journalRecordsForOperationIdKind(accepted, event.operationId, "TaskTrackerFactsObserved"),
        ({ event: candidate }) =>
          candidate._tag === "TaskTrackerFactsObserved" &&
          candidate.observation._tag === "FocusedTaskCompletionFacts" &&
          candidate.observation.purpose._tag === "Confirmation" &&
          candidate.observation.purpose.attemptOrdinal === event.attemptOrdinal &&
          completionTaskRequestEquals(candidate.observation.request, event.request)
      )
  return lost !== undefined &&
    confirmation !== undefined &&
    lost.position < confirmation.position &&
    isExactOpenConfirmation(confirmation.event, event.request) &&
    event.operationId === completionTaskRequestLookupOperationIdFor(event.request, event.attemptOrdinal)
    ? undefined
    : semantic(
        `completion request lookup ${event.operationId} lacks a prior lost call and exact open-task confirmation`
      )
}

const lookupOutcomeIssue = (
  event: Extract<CompletionTaskEvent, { readonly _tag: "CompletionTaskRequestLookupObserved" }>,
  record: JournalRecord,
  records: JournalHistorySource
): CompletionTaskHistoryIssue | undefined => {
  const intent = findLast(
    journalRecordsForOperationIdKind(prior(records, record), event.operationId, "CompletionTaskRequestLookupIntended"),
    ({ event: candidate }) =>
      candidate._tag === "CompletionTaskRequestLookupIntended" && candidate.operationId === event.operationId
  )?.event
  return intent?._tag === "CompletionTaskRequestLookupIntended" &&
    intent.attemptOrdinal === event.attemptOrdinal &&
    completionTaskRequestEquals(intent.request, event.request) &&
    completionTaskRequestEquals(event.lookup.request, event.request)
    ? undefined
    : semantic(`completion request lookup outcome ${event.operationId} lacks its exact prior intent`)
}

/** Validates one task-completion event against its exact Run and prior durable chronology. */
export const invalidCompletionTaskHistory = (
  record: JournalRecord,
  records: JournalHistorySource,
  runId: RunId
): CompletionTaskHistoryIssue | undefined => {
  const event = record.event
  const postPromotionIssue = invalidPostPromotionBlockerAncestryHistory(records, record, runId)
  if (postPromotionIssue !== undefined) return postPromotionIssue
  if (!isCompletionTaskEvent(event)) return undefined
  const request =
    event._tag === "TaskTrackerReadIntentRecorded"
      ? event.operation.request
      : event._tag === "TaskTrackerFactsObserved"
        ? event.observation.request
        : event.request
  if (request.claim.plannedAttempt.runId !== runId) {
    return identity(`completion request ${request.operationId} binds another Run`)
  }
  return Match.valueTags(event, {
    CompletionTaskAcknowledged: (value) => attemptResultIssue(value, record, records),
    CompletionTaskAttemptIntended: (value) => attemptIssue(value, record, records),
    CompletionTaskCandidateAncestryObserved: (value) => ancestryOutcomeIssue(value, record, records),
    CompletionTaskCandidateAncestryReadIntended: (value) => ancestryIntentIssue(value, record, records),
    CompletionTaskIntended: (value) => requestIntentIssue(value, record, records),
    CompletionTaskRejected: (value) => attemptResultIssue(value, record, records),
    CompletionTaskRequestLookupIntended: (value) => lookupIntentIssue(value, record, records),
    CompletionTaskRequestLookupObserved: (value) => lookupOutcomeIssue(value, record, records),
    CompletionTaskResponseLost: (value) => attemptResultIssue(value, record, records),
    TaskTrackerFactsObserved: (value) => focusedOutcomeIssue(value, record, records),
    TaskTrackerReadIntentRecorded: (value) => focusedIntentIssue(value, record, records)
  })
}
