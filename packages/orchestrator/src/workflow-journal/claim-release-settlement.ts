import { isExactTaskClaim } from "../authorities/task-tracker/claim-mutation.js"
import type { TrackerTarget } from "../authorities/task-tracker/target.js"
import { JournalPosition } from "./identity.js"
import { claimReadMatchesTarget } from "./run-target.js"
import type { JournalRecord } from "./store.js"
import type { WorkflowResponsibilityEntry } from "../coordination/reconstruction/state.js"
import { sameAttemptChoiceRequestId } from "../workflow/protocols/attempt-choice/events.js"
import type { OperationId } from "../workflow/identity.js"

type TaskClaimReleaseResponsibility = Extract<
  WorkflowResponsibilityEntry,
  { readonly _tag: "TaskClaimReleaseResponsibility" }
>

type WorkflowRunTarget = TrackerTarget | undefined

const claimReadForTarget = (
  records: ReadonlyArray<JournalRecord>,
  observationOperationId: OperationId,
  taskId: TaskClaimReleaseResponsibility["taskId"],
  before: JournalPosition,
  immutableRunTarget: WorkflowRunTarget
): boolean =>
  claimReadMatchesTarget(records, observationOperationId, taskId, JournalPosition.make(1), before, immutableRunTarget)

const taskClaimReleaseOutcomeSettled = (
  records: ReadonlyArray<JournalRecord>,
  responsibility: TaskClaimReleaseResponsibility,
  immutableRunTarget: WorkflowRunTarget
): boolean => {
  const operation = responsibility.operation
  return records.some(({ event, position }) => {
    if (event._tag !== "TaskClaimReleased") return false
    if (
      ![
        position > responsibility.beganAt,
        event.release.operationId === operation.release.operationId,
        isExactTaskClaim(event.release.claim, operation.release.claim)
      ].every(Boolean)
    )
      return false
    const intent = records.findLast(
      ({ event: candidate }) =>
        candidate._tag === "TaskClaimReleaseIntended" &&
        candidate.operation.release.operationId === operation.release.operationId
    )
    if (intent?.event._tag !== "TaskClaimReleaseIntended") return false
    const authority = intent.event.operation.authority
    if (authority._tag === "WorkflowClaimReleaseAuthority") return true
    return claimReadForTarget(
      records,
      authority.observationOperationId,
      responsibility.taskId,
      position,
      immutableRunTarget
    )
  })
}

const stoppedClaimNoReleaseSettled = (
  records: ReadonlyArray<JournalRecord>,
  event: Extract<JournalRecord["event"], { readonly _tag: "StoppedAttemptClaimNoReleaseObserved" }>,
  position: JournalPosition,
  responsibility: TaskClaimReleaseResponsibility,
  immutableRunTarget: WorkflowRunTarget
): boolean => {
  const authority = responsibility.operation.authority
  if (authority._tag !== "StoppedAttemptClaimReleaseAuthority") return false
  const observationMatches =
    event.observation._tag === "UnclaimedTask"
      ? event.observation.taskId === responsibility.taskId
      : !isExactTaskClaim(event.observation, event.expectedClaim)
  return [
    position > responsibility.beganAt,
    isExactTaskClaim(event.expectedClaim, responsibility.operation.release.claim),
    sameAttemptChoiceRequestId(event.requestId, authority.requestId),
    observationMatches,
    claimReadForTarget(records, event.observationOperationId, responsibility.taskId, position, immutableRunTarget)
  ].every(Boolean)
}

const cancelledClaimNoReleaseSettled = (
  records: ReadonlyArray<JournalRecord>,
  event: Extract<JournalRecord["event"], { readonly _tag: "CancelledAttemptClaimNoReleaseObserved" }>,
  position: JournalPosition,
  responsibility: TaskClaimReleaseResponsibility,
  immutableRunTarget: WorkflowRunTarget
): boolean => {
  const authority = responsibility.operation.authority
  if (authority._tag !== "CancelledAttemptClaimReleaseAuthority") return false
  const observationMatches =
    event.observation._tag === "UnclaimedTask"
      ? event.observation.taskId === responsibility.taskId
      : !isExactTaskClaim(event.observation, event.expectedClaim)
  return [
    position > responsibility.beganAt,
    isExactTaskClaim(event.expectedClaim, responsibility.operation.release.claim),
    event.observationOperationId === authority.observationOperationId,
    observationMatches,
    claimReadForTarget(records, event.observationOperationId, responsibility.taskId, position, immutableRunTarget)
  ].every(Boolean)
}

/** A stopped claim release settles only from a target-matching focused claim read. */
export const taskClaimReleaseSettled = (
  records: ReadonlyArray<JournalRecord>,
  responsibility: TaskClaimReleaseResponsibility,
  immutableRunTarget: WorkflowRunTarget
): boolean =>
  taskClaimReleaseOutcomeSettled(records, responsibility, immutableRunTarget) ||
  records.some(({ event, position }) =>
    event._tag === "StoppedAttemptClaimNoReleaseObserved"
      ? stoppedClaimNoReleaseSettled(records, event, position, responsibility, immutableRunTarget)
      : event._tag === "CancelledAttemptClaimNoReleaseObserved"
        ? cancelledClaimNoReleaseSettled(records, event, position, responsibility, immutableRunTarget)
        : false
  )
