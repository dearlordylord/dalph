import { Effect, Option } from "effect"
import type { RunId } from "@dalph/contracts"
import { taskTrackerTargetKey } from "../../../authorities/task-tracker/target.js"
import { reconstructedTaskGraphFor } from "../../../coordination/reconstruction/graph-knowledge.js"
import { AcceptedJournalReader } from "../../../workflow-journal/accepted-reader.js"
import type { JournalPosition } from "../../../workflow-journal/identity.js"
import {
  firstJournalRecordOfKind,
  isJournalRecordEvidence,
  journalEvidenceBefore,
  journalGraphBlockerClearEpisodeAt,
  journalRecordsForOperationId,
  journalRecordsForPromotionRequest,
  type JournalHistorySource
} from "../../../workflow-journal/record-evidence.js"
import { intentRecordKey, outcomeRecordKey } from "../../../workflow-journal/record-key.js"
import { InRunJournal, type JournalRecord } from "../../../workflow-journal/store.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  targetPromotionCorrelationEquals,
  targetPromotionGitRequestFor,
  TargetPromotionGit
} from "../target-promotion/events.js"
import {
  completionTaskClaimEquals,
  PostPromotionBlockerCandidateAncestryObservation,
  PostPromotionBlockerCandidateAncestryObservedEvent,
  PostPromotionBlockerCandidateAncestryReadIntendedEvent,
  PostPromotionBlockerClearAuthorization,
  postPromotionBlockerAncestryOperationIdFor,
  type CompletionTaskClaim,
  type PostPromotionBlockerCandidateAncestryObservation as PostPromotionBlockerCandidateAncestryObservationType,
  type PostPromotionBlockerClearAuthorization as PostPromotionBlockerClearAuthorizationType
} from "./events.js"

type GraphRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "TaskTrackerFactsObserved" }>
}

const isGraphRecord = (record: JournalRecord): record is GraphRecord =>
  record.event._tag === "TaskTrackerFactsObserved" &&
  (record.event.observation._tag === "CompleteTaskTrackerFacts" ||
    record.event.observation._tag === "UnchangedTaskTrackerFactsReconfirmed")

const promotionSucceededAt = (
  records: JournalHistorySource,
  claim: CompletionTaskClaim
): JournalPosition | undefined => {
  let position: JournalPosition | undefined
  const candidates = isJournalRecordEvidence(records)
    ? journalRecordsForPromotionRequest(records, claim.promotionCorrelation.requestId)
    : records
  for (const { event, position: candidatePosition } of candidates) {
    if (
      event._tag === "TargetPromotionObservedSuccess" &&
      targetPromotionCorrelationEquals(event.correlation, claim.promotionCorrelation)
    )
      position = candidatePosition
  }
  return position
}

const taskIsBlockedAt = (
  records: ReadonlyArray<JournalRecord>,
  record: GraphRecord,
  claim: CompletionTaskClaim
): boolean | undefined => {
  const observations = records
    .filter(({ position }) => position <= record.position)
    .flatMap(({ event }) => (event._tag === "TaskTrackerFactsObserved" ? [event.observation] : []))
  const graph = reconstructedTaskGraphFor({ taskTrackerFacts: observations }, record.event.observation.target)
  if (Option.isNone(graph)) return undefined
  const taskId = claim.plannedAttempt.taskId
  if (Option.isNone(graph.value.lifecycleOf(taskId))) return undefined
  return graph.value
    .prerequisitesOf(taskId)
    .some(
      (prerequisite) => Option.getOrUndefined(graph.value.lifecycleOf(prerequisite))?._tag !== "CompletedSuccessfully"
    )
}

/** Derives the latest exact blocked-then-clear tracker chronology after promotion. */
export const postPromotionBlockerClearAuthorizationFor = (
  records: JournalHistorySource,
  claim: CompletionTaskClaim
): PostPromotionBlockerClearAuthorizationType | undefined => {
  const promotedAt = promotionSucceededAt(records, claim)
  if (promotedAt === undefined) return undefined
  const began = firstJournalRecordOfKind(records, "WorkflowRunBegan")
  if (began?.event._tag !== "WorkflowRunBegan") return undefined
  if (isJournalRecordEvidence(records)) {
    const episode = journalGraphBlockerClearEpisodeAt(records, {
      afterPosition: promotedAt,
      target: began.event.target,
      taskId: claim.plannedAttempt.taskId
    })
    return episode === undefined ? undefined : PostPromotionBlockerClearAuthorization.make({ ...episode, claim })
  }
  const runTargetKey = taskTrackerTargetKey(began.event.target)
  const graphRecords = records.filter(
    (record): record is GraphRecord =>
      record.position > promotedAt &&
      isGraphRecord(record) &&
      taskTrackerTargetKey(record.event.observation.target) === runTargetKey
  )
  const blocked = graphRecords.findLast((record) => taskIsBlockedAt(records, record, claim) === true)
  if (blocked === undefined) return undefined
  const cleared = graphRecords.findLast(
    (record) => record.position > blocked.position && taskIsBlockedAt(records, record, claim) === false
  )
  return cleared === undefined
    ? undefined
    : PostPromotionBlockerClearAuthorization.make({
        blockerClearedAt: cleared.position,
        blockerObservedAt: blocked.position,
        claim
      })
}

const authorizationEquals = (
  left: PostPromotionBlockerClearAuthorizationType,
  right: PostPromotionBlockerClearAuthorizationType
): boolean =>
  left.blockerClearedAt === right.blockerClearedAt &&
  left.blockerObservedAt === right.blockerObservedAt &&
  completionTaskClaimEquals(left.claim, right.claim)

interface PostPromotionBlockerAncestryHistoryIssue {
  readonly detail: string
  readonly kind: "Identity" | "Semantic"
}

type PostPromotionBlockerAncestryIntent = Extract<
  JournalRecord["event"],
  { readonly _tag: "PostPromotionBlockerCandidateAncestryReadIntended" }
>
type PostPromotionBlockerAncestryOutcome = Extract<
  JournalRecord["event"],
  { readonly _tag: "PostPromotionBlockerCandidateAncestryObserved" }
>

/** Checks one authorization against the exact durable promotion and tracker chronology. */
export const postPromotionBlockerClearAuthorizationIssue = (
  records: JournalHistorySource,
  authorization: PostPromotionBlockerClearAuthorizationType,
  beforePosition?: JournalPosition
): string | undefined => {
  const prior =
    beforePosition === undefined
      ? records
      : isJournalRecordEvidence(records)
        ? journalEvidenceBefore(records, beforePosition)
        : records.filter(({ position }) => position < beforePosition)
  const derived = postPromotionBlockerClearAuthorizationFor(prior, authorization.claim)
  return derived !== undefined && authorizationEquals(derived, authorization)
    ? undefined
    : "post-promotion blocker ancestry read lacks its exact promotion, blocker, and later-clear chronology"
}

const invalidPostPromotionBlockerAncestryIntent = (
  records: JournalHistorySource,
  record: JournalRecord,
  event: PostPromotionBlockerAncestryIntent
): PostPromotionBlockerAncestryHistoryIssue | undefined => {
  const detail = postPromotionBlockerClearAuthorizationIssue(records, event.authorization, record.position)
  return detail === undefined ? undefined : { detail, kind: "Semantic" }
}

const invalidPostPromotionBlockerAncestryOutcome = (
  records: JournalHistorySource,
  record: JournalRecord,
  event: PostPromotionBlockerAncestryOutcome
): PostPromotionBlockerAncestryHistoryIssue | undefined => {
  let intent: PostPromotionBlockerAncestryIntent | undefined
  for (const { event: candidate, position } of journalRecordsForOperationId(records, event.operationId)) {
    if (
      position < record.position &&
      candidate._tag === "PostPromotionBlockerCandidateAncestryReadIntended" &&
      candidate.operationId === event.operationId
    )
      intent = candidate
  }
  return intent !== undefined && authorizationEquals(intent.authorization, event.authorization)
    ? undefined
    : {
        detail: `post-promotion blocker ancestry outcome ${event.operationId} lacks its exact prior intent`,
        kind: "Semantic"
      }
}

/** Rejects a blocker-clear ancestry event without its exact Run-local chronology and prior intent. */
export const invalidPostPromotionBlockerAncestryHistory = (
  records: JournalHistorySource,
  record: JournalRecord,
  runId: RunId
): PostPromotionBlockerAncestryHistoryIssue | undefined => {
  const event = record.event
  if (
    event._tag !== "PostPromotionBlockerCandidateAncestryReadIntended" &&
    event._tag !== "PostPromotionBlockerCandidateAncestryObserved"
  ) {
    return undefined
  }
  if (event.authorization.claim.plannedAttempt.runId !== runId) {
    return { detail: `post-promotion blocker ancestry read ${event.operationId} binds another Run`, kind: "Identity" }
  }
  return event._tag === "PostPromotionBlockerCandidateAncestryReadIntended"
    ? invalidPostPromotionBlockerAncestryIntent(records, record, event)
    : invalidPostPromotionBlockerAncestryOutcome(records, record, event)
}

/** Returns true only when Git freshly proved the promoted candidate current or ancestral. */
export const postPromotionBlockerAncestryIsPositive = (
  observation: PostPromotionBlockerCandidateAncestryObservationType
): boolean =>
  observation._tag === "Observed" &&
  (observation.observation._tag === "CandidateCurrent" || observation.observation._tag === "CandidateAncestor")

/** Selects the durable outcome for one exact authorization. */
export const postPromotionBlockerAncestryOutcomeFor = (
  records: JournalHistorySource,
  authorization: PostPromotionBlockerClearAuthorizationType
) => {
  const operationId = postPromotionBlockerAncestryOperationIdFor(authorization)
  let outcome: JournalRecord | undefined
  for (const record of journalRecordsForOperationId(records, operationId)) {
    if (record.event._tag === "PostPromotionBlockerCandidateAncestryObserved") outcome = record
  }
  return outcome
}

/** Journal-first, restart-idempotent Git ancestry read after one blocker clears. */
export const readPostPromotionBlockerCandidateAncestry = Effect.fn(
  "IntegrationFinality.readPostPromotionBlockerCandidateAncestry"
)(function* (authorization: PostPromotionBlockerClearAuthorizationType) {
  const operationId = postPromotionBlockerAncestryOperationIdFor(authorization)
  const runId = authorization.claim.plannedAttempt.runId
  const journal = yield* InRunJournal
  const accepted = yield* AcceptedJournalReader
  yield* journal.append(
    runId,
    intentRecordKey(operationId),
    PostPromotionBlockerCandidateAncestryReadIntendedEvent.make({
      authorization,
      operationId,
      version: workflowJournalEventVersion
    })
  )
  const records = yield* accepted.readAccepted(runId)
  const existing = postPromotionBlockerAncestryOutcomeFor(records, authorization)
  if (existing?.event._tag === "PostPromotionBlockerCandidateAncestryObserved") {
    return existing.event.observation
  }
  const git = yield* TargetPromotionGit
  const observation = yield* git.read(targetPromotionGitRequestFor(authorization.claim.promotionCorrelation)).pipe(
    Effect.map((value) => PostPromotionBlockerCandidateAncestryObservation.cases.Observed.make({ observation: value })),
    Effect.catchTag("TargetPromotionGitReadFailure", (failure) =>
      Effect.succeed(PostPromotionBlockerCandidateAncestryObservation.cases.Unreadable.make({ detail: failure.detail }))
    )
  )
  yield* journal.append(
    runId,
    outcomeRecordKey(operationId),
    PostPromotionBlockerCandidateAncestryObservedEvent.make({
      authorization,
      observation,
      operationId,
      version: workflowJournalEventVersion
    })
  )
  return observation
})
