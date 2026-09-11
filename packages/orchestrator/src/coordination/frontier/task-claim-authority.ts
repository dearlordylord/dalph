import { Option } from "effect"
import type { TaskId } from "@dalph/contracts"
import { type ActiveTaskClaim, isExactTaskClaim } from "../../authorities/task-tracker/claim-mutation.js"
import type { TrackerTarget } from "../../authorities/task-tracker/target.js"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import { outcomeRecordKey } from "../../workflow-journal/record-key.js"
import {
  journalLatestTaskObservation,
  journalRecordByKey,
  journalRecordsForTaskKind,
  type JournalRecordEvidence
} from "../../workflow-journal/record-evidence.js"
import type { JournalRecord } from "../../workflow-journal/store.js"

/** Current tracker evidence relative to the exact claim that authorizes task work. */
export type CurrentTaskClaimAuthority =
  | { readonly _tag: "Exact" }
  | { readonly _tag: "Foreign" }
  | { readonly _tag: "Missing" }
  | { readonly _tag: "Unreadable" }
  | { readonly _tag: "Unobserved" }

const afterBaseline = (position: JournalPosition, baseline: Option.Option<JournalPosition>): boolean =>
  Option.match(baseline, { onNone: () => true, onSome: (value) => position > value })

const classifyObservation = (
  observation: Extract<
    Extract<JournalRecord["event"], { readonly _tag: "TaskTrackerFactsObserved" }>["observation"],
    { readonly _tag: "FocusedTaskClaimFacts" | "FocusedTaskClaimFactsUnreadable" }
  >,
  expectedClaim: ActiveTaskClaim
): CurrentTaskClaimAuthority => {
  if (observation._tag === "FocusedTaskClaimFactsUnreadable") return { _tag: "Unreadable" }
  if (observation.observation._tag === "UnclaimedTask") return { _tag: "Missing" }
  return isExactTaskClaim(observation.observation, expectedClaim) ? { _tag: "Exact" } : { _tag: "Foreign" }
}

/**
 * Compares the latest activation-local tracker observation with one exact
 * claim. An observation predating that claim cannot authorize later work.
 */
export const currentTaskClaimAuthority = (
  records: JournalRecordEvidence,
  taskId: TaskId,
  expectedClaim: ActiveTaskClaim | undefined,
  activationBaselinePosition: Option.Option<JournalPosition>,
  immutableRunTarget?: TrackerTarget
): CurrentTaskClaimAuthority => {
  if (expectedClaim === undefined) return { _tag: "Missing" }
  const expectedRecord = journalRecordByKey(records, outcomeRecordKey(expectedClaim.operationId))
  const expectedAt =
    expectedRecord?.event._tag === "TaskClaimAcquired" &&
    expectedRecord.event.claim.operationId === expectedClaim.operationId
      ? expectedRecord.position
      : undefined
  let observationRecord: JournalRecord | undefined
  if (immutableRunTarget !== undefined) {
    const observed = journalLatestTaskObservation(records, {
      kind: "FocusedTaskClaimFacts",
      target: immutableRunTarget,
      taskId
    })
    const unreadable = journalLatestTaskObservation(records, {
      kind: "FocusedTaskClaimFactsUnreadable",
      target: immutableRunTarget,
      taskId
    })
    observationRecord =
      observed === undefined || (unreadable !== undefined && unreadable.position > observed.position)
        ? unreadable
        : observed
  } else {
    for (const record of journalRecordsForTaskKind(records, taskId, "TaskTrackerFactsObserved")) {
      if (
        record.event._tag === "TaskTrackerFactsObserved" &&
        (record.event.observation._tag === "FocusedTaskClaimFacts" ||
          record.event.observation._tag === "FocusedTaskClaimFactsUnreadable") &&
        record.event.observation.coverage.taskId === taskId
      )
        observationRecord = record
    }
  }
  if (
    observationRecord !== undefined &&
    (!afterBaseline(observationRecord.position, activationBaselinePosition) ||
      (expectedAt !== undefined && observationRecord.position <= expectedAt))
  )
    observationRecord = undefined
  const observation = observationRecord?.event
  if (
    observation?._tag !== "TaskTrackerFactsObserved" ||
    (observation.observation._tag !== "FocusedTaskClaimFacts" &&
      observation.observation._tag !== "FocusedTaskClaimFactsUnreadable")
  ) {
    return Option.match(activationBaselinePosition, {
      onNone: () => ({ _tag: "Unobserved" as const }),
      onSome: (activationBaseline) =>
        expectedAt !== undefined && expectedAt > activationBaseline
          ? { _tag: "Exact" as const }
          : { _tag: "Unobserved" as const }
    })
  }
  return classifyObservation(observation.observation, expectedClaim)
}
