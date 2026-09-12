import { Effect, Schema } from "effect"
import { type JournalPosition } from "../../../workflow-journal/identity.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import {
  journalRecordsForAttemptKind,
  journalRecordsForOperationId,
  journalRecordsForTask,
  journalRestartReadIntents,
  isJournalRecordEvidence,
  journalSpecificationDivergedAfter,
  type JournalHistorySource
} from "../../../workflow-journal/record-evidence.js"
import { OperationId } from "../../identity.js"
import type { WorkflowJournalEvent } from "../../registry/event.js"
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

const specificationDiffersFromRestartChoice = (
  event: WorkflowJournalEvent,
  subject: AttemptChoiceSubject,
  immutableRunTarget: TrackerTarget | undefined
): boolean =>
  event._tag === "TaskTrackerFactsObserved" &&
  event.observation._tag === "FocusedTaskWorkSpecificationFacts" &&
  event.observation.factFamily.taskId === subject.plannedAttempt.taskId &&
  (immutableRunTarget === undefined ||
    taskTrackerTargetKey(event.observation.target) === taskTrackerTargetKey(immutableRunTarget)) &&
  event.observation.factFamily.fingerprint !== subject.observedTaskRevision

/** Once a later authored fingerprint differs, the exact earlier Restart choice can never authorize a successor. */
export const restartChoiceWasInvalidatedByLaterSpecification = (
  records: JournalHistorySource,
  applicationPosition: JournalRecord["position"],
  subject: AttemptChoiceSubject,
  immutableRunTarget?: TrackerTarget
): boolean => {
  if (isJournalRecordEvidence(records))
    return journalSpecificationDivergedAfter(records, {
      taskId: subject.plannedAttempt.taskId,
      ...(immutableRunTarget === undefined ? {} : { target: immutableRunTarget }),
      expected: subject.observedTaskRevision,
      afterPosition: applicationPosition
    })
  for (const { event, position } of journalRecordsForTask(records, subject.plannedAttempt.taskId)) {
    if (position > applicationPosition && specificationDiffersFromRestartChoice(event, subject, immutableRunTarget))
      return true
  }
  return false
}

const commandIntendedAfterQuiescence = (
  records: JournalHistorySource,
  subject: AttemptChoiceSubject,
  observedAt: JournalPosition
): boolean => {
  let laterCommand = false
  for (const { event, position } of journalRecordsForAttemptKind(
    records,
    subject.plannedAttempt.attemptId,
    "PlannedAttemptExecutorCommandIntended"
  )) {
    if (
      position > observedAt &&
      event._tag === "PlannedAttemptExecutorCommandIntended" &&
      event.plannedAttempt.runId === subject.plannedAttempt.runId &&
      event.plannedAttempt.attemptId === subject.plannedAttempt.attemptId
    )
      laterCommand = true
  }
  return laterCommand
}

const currentQuiescence = (records: JournalHistorySource, subject: AttemptChoiceSubject): RestartQuiescence => {
  const evidence = latestPlannedAttemptExecutorEvidence(records, subject.plannedAttempt)
  if (evidence === undefined) return { _tag: "Pending", reason: "ExecutorUnavailable" }
  if (!isAcceptedPlannedAttemptExecutorEvidence(evidence)) {
    return { _tag: "Pending", reason: "ExecutorLifecycleAcceptancePending" }
  }
  if (evidence.report._tag === "ExecutorWorkTerminal") return terminalRestartQuiescence(evidence)
  if (evidence.report._tag !== "ExecutorWorkSafelySuspended") {
    return { _tag: "Rejected", reason: "ExecutingDoesNotAuthorizeReplacement" }
  }
  return commandIntendedAfterQuiescence(records, subject, evidence.observedAt)
    ? { _tag: "Rejected", reason: "LaterExecutorCommandInvalidatedChoice" }
    : { _tag: "Proof", evidence }
}

const restartReadHasOutcome = (records: JournalHistorySource, operationId: OperationId): boolean => {
  let hasOutcome = false
  for (const { event: candidate } of journalRecordsForOperationId(records, operationId)) {
    if (
      (candidate._tag === "TaskTrackerFactsObserved" ||
        candidate._tag === "PlannedAttemptWorktreeObserved" ||
        candidate._tag === "TargetLineageObserved" ||
        candidate._tag === "AttemptRestartAuthorityReadFailed") &&
      candidate.operationId === operationId
    )
      hasOutcome = true
  }
  return hasOutcome
}

export const nextRestartReadOperationId = (
  records: JournalHistorySource,
  requestId: AttemptChoiceRequestId,
  phase: "claim" | "graph" | "specification" | "target-lineage" | "worktree",
  after: JournalPosition
): OperationId => {
  const prefix = `attempt-restart:${encodeURIComponent(requestId.nonce)}:${phase}:after:`
  let pending:
    | Extract<WorkflowJournalEvent, { readonly _tag: "TaskTrackerReadIntentRecorded" | "GitReadIntentRecorded" }>
    | undefined
  for (const { event } of journalRestartReadIntents(records, requestId.nonce, phase)) {
    if (event._tag !== "TaskTrackerReadIntentRecorded" && event._tag !== "GitReadIntentRecorded") continue
    const hasOutcome = restartReadHasOutcome(records, event.operation.operationId)
    if (event.operation.operationId.startsWith(prefix) && !hasOutcome) pending = event
  }
  return pending !== undefined ? pending.operation.operationId : OperationId.make(`${prefix}${after}`)
}

export const currentRestartQuiescence = Effect.fn("AttemptRestart.establishQuiescence")(
  (records: JournalHistorySource, subject: AttemptChoiceSubject) => Effect.succeed(currentQuiescence(records, subject))
)
