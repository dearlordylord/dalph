import { Effect, Schema } from "effect"
import { type JournalPosition } from "../../../workflow-journal/identity.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import { OperationId } from "../../identity.js"
import {
  latestPlannedAttemptExecutorEvidence,
  isAcceptedPlannedAttemptExecutorEvidence
} from "../planned-attempt-executor-work/evidence.js"
import { AttemptChoiceRequestId, AttemptChoiceSubject } from "./events.js"
import type { AttemptRestartPendingReason, AttemptRestartRejectedReason } from "./restart-reasons.js"
import { terminalRestartQuiescence, type RestartQuiescence } from "./restart-authority-evidence.js"
import { taskTrackerTargetKey, type TrackerTarget } from "../../../authorities/task-tracker/target.js"
export {
  exactAppliedRestart,
  proofFor,
  recordedReplacement,
  restartClaimAuthorityAtApplication,
  terminalRestartQuiescence
} from "./restart-authority-evidence.js"
export type { PlannedAttemptReplacementRecord, RestartApplicationRecord } from "./restart-authority-evidence.js"

/** Restart cannot advance without its exact durable applied Operator choice. */
export class AttemptRestartChoiceContradiction extends Schema.TaggedError<AttemptRestartChoiceContradiction>()(
  "AttemptRestartChoiceContradiction",
  { requestId: AttemptChoiceRequestId, subject: AttemptChoiceSubject }
) {}

/** Current durable authority contradicts the immutable replacement request. */
export class AttemptRestartAuthorityContradiction extends Schema.TaggedError<AttemptRestartAuthorityContradiction>()(
  "AttemptRestartAuthorityContradiction",
  { detail: Schema.String, requestId: AttemptChoiceRequestId, subject: AttemptChoiceSubject }
) {}

export type AttemptRestartAdvanceResult =
  | { readonly _tag: "AttemptRestartPending"; readonly reason: AttemptRestartPendingReason }
  | { readonly _tag: "AttemptRestartRejected"; readonly reason: AttemptRestartRejectedReason }
  | { readonly _tag: "PlannedAttemptReplacementRecorded"; readonly replacement: JournalRecord }

/** Once a later authored fingerprint differs, the exact earlier Restart choice can never authorize a successor. */
export const restartChoiceWasInvalidatedByLaterSpecification = (
  records: ReadonlyArray<JournalRecord>,
  applicationPosition: JournalRecord["position"],
  subject: AttemptChoiceSubject,
  immutableRunTarget?: TrackerTarget
): boolean =>
  records.some(
    ({ event, position }) =>
      position > applicationPosition &&
      event._tag === "TaskTrackerFactsObserved" &&
      event.observation._tag === "FocusedTaskWorkSpecificationFacts" &&
      event.observation.factFamily.taskId === subject.plannedAttempt.taskId &&
      (immutableRunTarget === undefined ||
        taskTrackerTargetKey(event.observation.target) === taskTrackerTargetKey(immutableRunTarget)) &&
      event.observation.factFamily.fingerprint !== subject.observedTaskRevision
  )

const currentQuiescence = (records: ReadonlyArray<JournalRecord>, subject: AttemptChoiceSubject): RestartQuiescence => {
  const evidence = latestPlannedAttemptExecutorEvidence(records, subject.plannedAttempt)
  if (evidence === undefined) return { _tag: "Pending", reason: "ExecutorUnavailable" }
  if (!isAcceptedPlannedAttemptExecutorEvidence(evidence)) {
    return { _tag: "Pending", reason: "ExecutorLifecycleAcceptancePending" }
  }
  if (evidence.report._tag === "ExecutorWorkTerminal") {
    return terminalRestartQuiescence(evidence)
  }
  if (evidence.report._tag !== "ExecutorWorkSafelySuspended") {
    return { _tag: "Rejected", reason: "ExecutingDoesNotAuthorizeReplacement" }
  }
  const laterCommand = records.some(
    ({ event, position }) =>
      position > evidence.observedAt &&
      event._tag === "PlannedAttemptExecutorCommandIntended" &&
      event.plannedAttempt.runId === subject.plannedAttempt.runId &&
      event.plannedAttempt.attemptId === subject.plannedAttempt.attemptId
  )
  return laterCommand
    ? { _tag: "Rejected", reason: "LaterExecutorCommandInvalidatedChoice" }
    : { _tag: "Proof", evidence }
}

export const nextRestartReadOperationId = (
  records: ReadonlyArray<JournalRecord>,
  requestId: AttemptChoiceRequestId,
  phase: "claim" | "graph" | "specification" | "target-lineage" | "worktree",
  after: JournalPosition
): OperationId => {
  const prefix = `attempt-restart:${encodeURIComponent(requestId.nonce)}:${phase}:after:`
  const pending = records.findLast(
    ({ event }) =>
      ((event._tag === "TaskTrackerReadIntentRecorded" && event.operation.operationId.startsWith(prefix)) ||
        (event._tag === "GitReadIntentRecorded" && event.operation.operationId.startsWith(prefix))) &&
      !records.some(
        ({ event: candidate }) =>
          (candidate._tag === "TaskTrackerFactsObserved" ||
            candidate._tag === "PlannedAttemptWorktreeObserved" ||
            candidate._tag === "TargetLineageObserved" ||
            candidate._tag === "AttemptRestartAuthorityReadFailed") &&
          candidate.operationId === event.operation.operationId
      )
  )?.event
  return pending !== undefined &&
    (pending._tag === "TaskTrackerReadIntentRecorded" || pending._tag === "GitReadIntentRecorded")
    ? pending.operation.operationId
    : OperationId.make(`${prefix}${after}`)
}

export const currentRestartQuiescence = Effect.fn("AttemptRestart.establishQuiescence")(
  (records: ReadonlyArray<JournalRecord>, subject: AttemptChoiceSubject) =>
    Effect.succeed(currentQuiescence(records, subject))
)
