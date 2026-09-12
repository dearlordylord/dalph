import { type RunId, type TaskId } from "@dalph/contracts"
import { type ActiveTaskClaim, isExactTaskClaim } from "../../../authorities/task-tracker/claim-mutation.js"
import type { TaskClaimReacquisitionRequestId } from "./events.js"
import type { JournalPosition } from "../../../workflow-journal/identity.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import {
  isJournalRecordEvidence,
  journalEvidenceBefore,
  journalRecordByKey,
  journalRecordsForTask,
  journalTaskClaimObservationAt,
  lastJournalRecordForTaskKind,
  type JournalHistorySource,
  type JournalRecordEvidence
} from "../../../workflow-journal/record-evidence.js"
import { outcomeRecordKey } from "../../../workflow-journal/record-key.js"
import { OperationId } from "../../identity.js"

/** Stable acquisition operation identity derived from one applied reacquisition direction. */
export const taskClaimReacquisitionOperationId = (requestId: TaskClaimReacquisitionRequestId): OperationId =>
  OperationId.make(`task-claim-reacquisition:${requestId}`)

const isFocusedClaimObservation = (record: JournalRecord, taskId: TaskId): boolean =>
  record.event._tag === "TaskTrackerFactsObserved" &&
  (record.event.observation._tag === "FocusedTaskClaimFactsUnreadable" ||
    record.event.observation._tag === "FocusedTaskClaimFacts") &&
  record.event.observation.coverage.taskId === taskId

type ClaimLossEpisode = { readonly _tag: "Missing" } | { readonly _tag: "Foreign"; readonly claim: ActiveTaskClaim }

const claimLossEpisodeAt = (record: JournalRecord, expectedClaim: ActiveTaskClaim): ClaimLossEpisode | undefined => {
  if (record.event._tag !== "TaskTrackerFactsObserved" || record.event.observation._tag !== "FocusedTaskClaimFacts") {
    return undefined
  }
  const observation = record.event.observation.observation
  if (observation._tag === "UnclaimedTask") return { _tag: "Missing" }
  return isExactTaskClaim(observation, expectedClaim) ? undefined : { _tag: "Foreign", claim: observation }
}

const observationRemainsInEpisode = (
  record: JournalRecord,
  episode: ClaimLossEpisode,
  expectedClaim: ActiveTaskClaim
): boolean => {
  /* v8 ignore next -- @preserve The episode scan passes only focused facts or handles an acquisition before this call. */
  if (record.event._tag !== "TaskTrackerFactsObserved" || record.event.observation._tag !== "FocusedTaskClaimFacts") {
    return false
  }
  const observation = record.event.observation.observation
  if (observation._tag === "UnclaimedTask") return episode._tag === "Missing"
  if (isExactTaskClaim(observation, expectedClaim) || episode._tag === "Missing") return false
  return isExactTaskClaim(observation, episode.claim)
}

const directionFollowsCurrentLossEpisode = (
  records: ReadonlyArray<JournalRecord>,
  taskId: TaskId,
  expectedClaim: ActiveTaskClaim,
  directionPosition: JournalPosition,
  throughPosition: JournalPosition
): boolean => {
  const expectedClaimPosition = records.findLast(
    ({ event, position }) =>
      position < directionPosition && event._tag === "TaskClaimAcquired" && isExactTaskClaim(event.claim, expectedClaim)
  )?.position
  const lossRecord = records.findLast(
    (record) =>
      record.position < directionPosition &&
      (expectedClaimPosition === undefined || record.position > expectedClaimPosition) &&
      isFocusedClaimObservation(record, taskId)
  )
  if (lossRecord === undefined) return false
  const episode = claimLossEpisodeAt(lossRecord, expectedClaim)
  if (episode === undefined) return false
  return records
    .filter(
      (record) =>
        record.position > lossRecord.position &&
        record.position <= throughPosition &&
        (isFocusedClaimObservation(record, taskId) ||
          (record.event._tag === "TaskClaimAcquired" && isExactTaskClaim(record.event.claim, expectedClaim)))
    )
    .every(
      (record) =>
        record.event._tag !== "TaskClaimAcquired" && observationRemainsInEpisode(record, episode, expectedClaim)
    )
}

/**
 * Latest applied reacquisition direction made after the loss it authorizes.
 * Confirming reads may preserve that same loss across restart, while exact,
 * unreadable, or different-loss evidence ends the direction's authority.
 */
export const latestTaskClaimReacquisitionDirection = (
  records: JournalHistorySource,
  runId: RunId,
  taskId: TaskId,
  expectedClaim: ActiveTaskClaim,
  throughPosition: JournalPosition
) => {
  if (isJournalRecordEvidence(records)) {
    return latestIndexedTaskClaimReacquisitionDirection(records, runId, taskId, expectedClaim, throughPosition)
  }
  const taskRecords = Array.from(journalRecordsForTask(records, taskId))
  return taskRecords.findLast(
    ({ event, position }) =>
      event._tag === "TaskClaimReacquisitionDirected" &&
      event.subject.runId === runId &&
      event.subject.taskId === taskId &&
      position <= throughPosition &&
      directionFollowsCurrentLossEpisode(taskRecords, taskId, expectedClaim, position, throughPosition)
  )?.event
}

const exactClaimAcquiredAfterLoss = (
  records: JournalRecordEvidence,
  taskId: TaskId,
  expectedClaim: ActiveTaskClaim,
  lossPosition: JournalPosition
): boolean => {
  const acquired = journalRecordByKey(records, outcomeRecordKey(expectedClaim.operationId))
  return (
    acquired?.event._tag === "TaskClaimAcquired" &&
    acquired.event.claim.taskId === taskId &&
    isExactTaskClaim(acquired.event.claim, expectedClaim) &&
    acquired.position > lossPosition
  )
}

const unchangedClaimLossBeforeDirection = (
  through: JournalRecordEvidence,
  taskId: TaskId,
  expectedClaim: ActiveTaskClaim,
  directionPosition: JournalPosition
) => {
  const loss = journalTaskClaimObservationAt(journalEvidenceBefore(through, directionPosition), taskId)
  const current = journalTaskClaimObservationAt(through, taskId)
  if (loss === undefined || current === undefined || loss.episodeStartedAt !== current.episodeStartedAt) {
    return undefined
  }
  return claimLossEpisodeAt(loss.record, expectedClaim) === undefined ? undefined : loss
}

const latestIndexedTaskClaimReacquisitionDirection = (
  records: JournalRecordEvidence,
  runId: RunId,
  taskId: TaskId,
  expectedClaim: ActiveTaskClaim,
  throughPosition: JournalPosition
) => {
  const through = journalEvidenceBefore(records, throughPosition + 1)
  const direction = lastJournalRecordForTaskKind(through, taskId, "TaskClaimReacquisitionDirected")
  if (direction?.event._tag !== "TaskClaimReacquisitionDirected" || direction.event.subject.runId !== runId) {
    return undefined
  }
  const loss = unchangedClaimLossBeforeDirection(through, taskId, expectedClaim, direction.position)
  if (loss === undefined) return undefined
  if (exactClaimAcquiredAfterLoss(through, taskId, expectedClaim, loss.record.position)) {
    return undefined
  }
  return direction.event
}
