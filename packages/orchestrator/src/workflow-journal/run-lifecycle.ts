import { type RunId } from "@dalph/contracts"
import { Effect } from "effect"
import type { TrackerTarget } from "../authorities/task-tracker/target.js"
import { taskTrackerTargetKey } from "../authorities/task-tracker/target.js"
import { workflowJournalEventVersion } from "../workflow/kernel/event.js"
import { WorkflowRunBeganEvent, WorkflowRunTerminatedEvent } from "../workflow/registry/event.js"
import { JournalPosition } from "./identity.js"
import { workflowRunBeganRecordKey, workflowRunTerminatedRecordKey } from "./record-key.js"
import {
  type JournalRecord,
  WorkflowRunAlreadyBegan,
  WorkflowRunAlreadyTerminated,
  WorkflowRunIdentityAlreadyUsed,
  WorkflowRunNotBegan,
  WorkflowRunTargetMismatch
} from "./store.js"
import type { InitialControlPolicy } from "../control/policy.js"

type LifecycleTransition<A> =
  | { readonly _tag: "LifecycleTransitionAccepted"; readonly record: JournalRecord }
  | { readonly _tag: "LifecycleTransitionRejected"; readonly failure: A }

export const makeWorkflowRunBeganRecord = (
  runId: RunId,
  target: TrackerTarget,
  initialControlPolicy: InitialControlPolicy
): JournalRecord => ({
  event: WorkflowRunBeganEvent.make({
    initialControlPolicy,
    initiatedBy: { _tag: "DalphCoordinator" },
    occurrenceClassification: "InitiatedAction",
    target,
    version: workflowJournalEventVersion
  }),
  key: workflowRunBeganRecordKey,
  position: JournalPosition.make(1),
  runId
})

export const makeWorkflowRunTerminatedRecord = (runId: RunId, position: JournalPosition): JournalRecord => ({
  event: WorkflowRunTerminatedEvent.make({
    disposition: "Completed",
    occurrenceClassification: "NonActionOccurrence",
    version: workflowJournalEventVersion
  }),
  key: workflowRunTerminatedRecordKey,
  position,
  runId
})

/** Decides the only legal first lifecycle transition without performing persistence. */
export const decideWorkflowRunBeginning = (
  records: ReadonlyArray<JournalRecord>,
  runId: RunId,
  target: TrackerTarget,
  initialControlPolicy: InitialControlPolicy
): LifecycleTransition<WorkflowRunAlreadyBegan | WorkflowRunIdentityAlreadyUsed> => {
  const began = records.find(({ event }) => event._tag === "WorkflowRunBegan")
  if (began !== undefined) {
    return {
      _tag: "LifecycleTransitionRejected",
      failure: new WorkflowRunAlreadyBegan({ beganAt: began.position, runId })
    }
  }
  const first = records[0]
  return first === undefined
    ? { _tag: "LifecycleTransitionAccepted", record: makeWorkflowRunBeganRecord(runId, target, initialControlPolicy) }
    : {
        _tag: "LifecycleTransitionRejected",
        failure: new WorkflowRunIdentityAlreadyUsed({ firstRecordAt: first.position, runId })
      }
}

/** Decides the only legal final lifecycle transition without performing persistence. */
export const decideWorkflowRunTermination = (
  records: ReadonlyArray<JournalRecord>,
  runId: RunId
): LifecycleTransition<WorkflowRunAlreadyTerminated | WorkflowRunNotBegan> => {
  const began = records.find(({ event }) => event._tag === "WorkflowRunBegan")
  if (began === undefined) {
    return { _tag: "LifecycleTransitionRejected", failure: new WorkflowRunNotBegan({ runId }) }
  }
  const terminated = records.find(({ event }) => event._tag === "WorkflowRunTerminated")
  return terminated === undefined
    ? {
        _tag: "LifecycleTransitionAccepted",
        record: makeWorkflowRunTerminatedRecord(runId, JournalPosition.make(records.length + 1))
      }
    : {
        _tag: "LifecycleTransitionRejected",
        failure: new WorkflowRunAlreadyTerminated({ runId, terminatedAt: terminated.position })
      }
}

/** Rereads the journal facts required to retain and validate an already-established Run. */
export const readRecoverableRunBeginning = Effect.fn("WorkflowRunLifecycle.readRecoverableBeginning")(function* (
  records: ReadonlyArray<JournalRecord>,
  runId: RunId,
  target: TrackerTarget
) {
  const began = records.find(({ event }) => event._tag === "WorkflowRunBegan")
  if (began?.event._tag !== "WorkflowRunBegan") {
    return yield* new WorkflowRunNotBegan({ runId })
  }
  const terminated = records.find(({ event }) => event._tag === "WorkflowRunTerminated")
  if (terminated !== undefined) {
    return yield* new WorkflowRunAlreadyTerminated({ runId, terminatedAt: terminated.position })
  }
  if (taskTrackerTargetKey(began.event.target) !== taskTrackerTargetKey(target)) {
    return yield* new WorkflowRunTargetMismatch({ recordedTarget: began.event.target, requestedTarget: target, runId })
  }
  return began
})
