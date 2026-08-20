import { Effect, Schema } from "effect"
import { type JournalPosition } from "../../../workflow-journal/identity.js"
import { InRunJournal, type JournalRecord } from "../../../workflow-journal/store.js"
import { OperationId } from "../../identity.js"
import {
  latestPlannedAttemptExecutorEvidence,
  latestUnsettledPlannedAttemptExecutorCommand
} from "../planned-attempt-executor-work/evidence.js"
import {
  observePlannedAttemptExecutorStateWithPermit,
  reconcileOrObservePlannedAttemptExecutorStateWithPermit
} from "../planned-attempt-executor-work/protocol.js"
import { requestPlannedAttemptExecutorSuspensionWithPermit } from "../planned-attempt-executor-work/suspension-commands.js"
import { type PlannedAttemptProtocolPermit } from "../planned-attempt-executor-work/protocol-controller.js"
import { AttemptChoiceRequestId, AttemptChoiceSubject } from "./events.js"
import type { AttemptRestartPendingReason, AttemptRestartRejectedReason } from "./restart-reasons.js"
import {
  terminalRestartQuiescence,
  type RestartApplicationRecord,
  type RestartQuiescence
} from "./restart-authority-evidence.js"
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
  subject: AttemptChoiceSubject
): boolean =>
  records.some(
    ({ event, position }) =>
      position > applicationPosition &&
      event._tag === "TaskTrackerFactsObserved" &&
      event.observation._tag === "FocusedTaskWorkSpecificationFacts" &&
      event.observation.factFamily.taskId === subject.plannedAttempt.taskId &&
      event.observation.factFamily.fingerprint !== subject.observedTaskRevision
  )

const currentQuiescence = (
  records: ReadonlyArray<JournalRecord>,
  application: RestartApplicationRecord,
  subject: AttemptChoiceSubject
): RestartQuiescence => {
  const evidence = latestPlannedAttemptExecutorEvidence(records, subject.plannedAttempt)
  if (evidence?.report._tag === "Terminal") {
    return terminalRestartQuiescence(evidence, application)
  }
  if (evidence?.report._tag !== "SafelySuspended") return { _tag: "Unproved" }
  const laterCommand = records.some(
    ({ event, position }) =>
      position > evidence.observedAt &&
      event._tag === "PlannedAttemptExecutorCommandIntended" &&
      event.plannedAttempt.runId === subject.plannedAttempt.runId &&
      event.plannedAttempt.attemptId === subject.plannedAttempt.attemptId
  )
  return laterCommand ? { _tag: "Unproved" } : { _tag: "Proof", evidence }
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

export const terminalOrSafeRestartQuiescence = Effect.fn("AttemptRestart.establishQuiescence")(function* (
  records: ReadonlyArray<JournalRecord>,
  application: RestartApplicationRecord,
  subject: AttemptChoiceSubject,
  permit: PlannedAttemptProtocolPermit
) {
  const current = currentQuiescence(records, application, subject)
  if (current._tag !== "Unproved") return current
  const unsettled = latestUnsettledPlannedAttemptExecutorCommand(records, subject.plannedAttempt)
  const report = yield* unsettled === undefined
    ? requestPlannedAttemptExecutorSuspensionWithPermit(permit, subject.plannedAttempt).pipe(
        Effect.catchTag("PlannedAttemptExecutorSuspensionLimitReached", () =>
          observePlannedAttemptExecutorStateWithPermit(permit, subject.plannedAttempt)
        )
      )
    : reconcileOrObservePlannedAttemptExecutorStateWithPermit(permit, subject.plannedAttempt)
  if (report._tag === "Running") return { _tag: "Pending" as const, reason: "ExecutorRunning" as const }
  const journal = yield* InRunJournal
  return currentQuiescence(yield* journal.read(subject.plannedAttempt.runId), application, subject)
})
