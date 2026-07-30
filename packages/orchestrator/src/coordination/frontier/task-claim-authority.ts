import { Option } from "effect"
import type { TaskId } from "@dalph/contracts"
import { type ActiveTaskClaim, isExactTaskClaim } from "../../authorities/task-tracker/claim-mutation.js"
import type { JournalPosition } from "../../workflow-journal/identity.js"
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
  records: ReadonlyArray<JournalRecord>,
  taskId: TaskId,
  expectedClaim: ActiveTaskClaim | undefined,
  activationBaselinePosition: Option.Option<JournalPosition>
): CurrentTaskClaimAuthority => {
  if (expectedClaim === undefined) return { _tag: "Missing" }
  const expectedAt = records.findLast(
    ({ event }) => event._tag === "TaskClaimAcquired" && event.claim.operationId === expectedClaim.operationId
  )?.position
  const observationRecord = records.findLast(
    ({ event, position }) =>
      afterBaseline(position, activationBaselinePosition) &&
      (expectedAt === undefined || position > expectedAt) &&
      event._tag === "TaskTrackerFactsObserved" &&
      (event.observation._tag === "FocusedTaskClaimFacts" ||
        event.observation._tag === "FocusedTaskClaimFactsUnreadable") &&
      event.observation.coverage.taskId === taskId
  )
  const observation = observationRecord?.event
  if (
    observation?._tag !== "TaskTrackerFactsObserved" ||
    (observation.observation._tag !== "FocusedTaskClaimFacts" &&
      observation.observation._tag !== "FocusedTaskClaimFactsUnreadable")
  ) {
    return { _tag: "Unobserved" }
  }
  return classifyObservation(observation.observation, expectedClaim)
}
