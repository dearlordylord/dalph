import { type RunId, type TaskId } from "@dalph/contracts"
import { type ActiveTaskClaim, isExactTaskClaim } from "../../../authorities/task-tracker/claim-mutation.js"
import { type ControlCommandId } from "../../../control/identity.js"
import type { JournalPosition } from "../../../workflow-journal/identity.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import { OperationId } from "../../identity.js"

/** Stable acquisition operation identity derived from one authenticated reacquisition command. */
export const taskClaimReacquisitionOperationId = (commandId: ControlCommandId): OperationId =>
  OperationId.make(`task-claim-reacquisition:${commandId}`)

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

const commandFollowsCurrentLossEpisode = (
  records: ReadonlyArray<JournalRecord>,
  taskId: TaskId,
  expectedClaim: ActiveTaskClaim,
  commandPosition: JournalPosition,
  throughPosition: JournalPosition
): boolean => {
  const expectedClaimPosition = records.findLast(
    ({ event, position }) =>
      position < commandPosition && event._tag === "TaskClaimAcquired" && isExactTaskClaim(event.claim, expectedClaim)
  )?.position
  const lossRecord = records.findLast(
    (record) =>
      record.position < commandPosition &&
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
 * Latest explicit reacquisition command made after the loss it authorizes.
 * Confirming reads may preserve that same loss across restart, while exact,
 * unreadable, or different-loss evidence ends the command's authority.
 */
export const latestTaskClaimReacquisitionCommand = (
  records: ReadonlyArray<JournalRecord>,
  runId: RunId,
  taskId: TaskId,
  expectedClaim: ActiveTaskClaim,
  throughPosition: JournalPosition
) =>
  records.findLast(
    ({ event, position }) =>
      event._tag === "ControlCommandRecorded" &&
      event.command._tag === "RequestTaskClaimReacquisition" &&
      event.command.runId === runId &&
      event.command.taskId === taskId &&
      position <= throughPosition &&
      commandFollowsCurrentLossEpisode(records, taskId, expectedClaim, position, throughPosition)
  )?.event
