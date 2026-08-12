import { plannedTaskAttemptEquivalence } from "@dalph/contracts"
import { Effect, Match, Schema } from "effect"
import { InRunJournal, type JournalRecord } from "../../../workflow-journal/store.js"
import { OperationId } from "../../identity.js"
import {
  latestPlannedAttemptExecutorEvidence,
  latestUnsettledPlannedAttemptExecutorCommand,
  type PlannedAttemptExecutorEvidence
} from "../planned-attempt-executor-work/evidence.js"
import {
  reconcileOrObservePlannedAttemptExecutorStateWithPermit,
  requestPlannedAttemptExecutorSuspensionWithPermit
} from "../planned-attempt-executor-work/protocol.js"
import { type PlannedAttemptProtocolPermit } from "../planned-attempt-executor-work/protocol-controller.js"
import {
  AttemptChoiceRequestId,
  AttemptChoiceSubject,
  type AttemptQuiescenceProof,
  sameAttemptChoiceRequestId,
  sameAttemptChoiceSubject
} from "./events.js"

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

export type AttemptRestartPendingReason =
  | "ClaimAbsent"
  | "ClaimForeign"
  | "ClaimUnreadable"
  | "ExecutorRunning"
  | "OldWorktreeNotReady"
  | "TaskNotEligible"

export type AttemptRestartRejectedReason =
  | "CompletedDoesNotAuthorizeReplacement"
  | "FailedDoesNotAuthorizeReplacement"
  | "NewFingerprintChoiceRequired"

export type RestartApplicationRecord = Omit<JournalRecord, "event"> & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "AttemptChoiceApplied" }> & {
    readonly choice: "RestartTaskImplementation"
  }
}

export const exactAppliedRestart = (
  records: ReadonlyArray<JournalRecord>,
  requestId: AttemptChoiceRequestId,
  subject: AttemptChoiceSubject
): RestartApplicationRecord | undefined =>
  records.find(
    (record): record is RestartApplicationRecord =>
      record.event._tag === "AttemptChoiceApplied" &&
      record.event.choice === "RestartTaskImplementation" &&
      sameAttemptChoiceRequestId(record.event.requestId, requestId) &&
      sameAttemptChoiceSubject(record.event.subject, subject)
  )

export const recordedReplacement = (records: ReadonlyArray<JournalRecord>, subject: AttemptChoiceSubject) =>
  records.find(
    ({ event }) =>
      event._tag === "PlannedAttemptReplaced" &&
      plannedTaskAttemptEquivalence(event.subject.plannedAttempt, subject.plannedAttempt)
  )

export const proofFor = (evidence: PlannedAttemptExecutorEvidence): AttemptQuiescenceProof =>
  Match.valueTags(evidence.source, {
    CommandResponse: ({ ordinal }) => ({ _tag: "CommandResponse" as const, reportOrdinal: ordinal }),
    CommandProjection: ({ commandOrdinal, projectionOrdinal }) => ({
      _tag: "CommandProjection" as const,
      commandOrdinal,
      projectionOrdinal
    }),
    StateProjection: ({ ordinal }) => ({ _tag: "StateProjection" as const, observationOrdinal: ordinal })
  })

type RestartQuiescence =
  | { readonly _tag: "Proof"; readonly evidence: PlannedAttemptExecutorEvidence }
  | { readonly _tag: "Rejected"; readonly reason: AttemptRestartRejectedReason }
  | { readonly _tag: "Unproved" }

const terminalRestartQuiescence = (
  evidence: PlannedAttemptExecutorEvidence,
  application: RestartApplicationRecord
): RestartQuiescence => {
  if (evidence.report._tag !== "Terminal") return { _tag: "Unproved" }
  if (evidence.report.result._tag === "Completed") {
    return { _tag: "Rejected", reason: "CompletedDoesNotAuthorizeReplacement" }
  }
  if (evidence.report.result._tag === "Failed") {
    return { _tag: "Rejected", reason: "FailedDoesNotAuthorizeReplacement" }
  }
  return evidence.observedAt > application.position ? { _tag: "Proof", evidence } : { _tag: "Unproved" }
}

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
  after: number
): OperationId => {
  const prefix = `attempt-restart:${requestId.nonce}:${phase}:after:`
  const pending = records.findLast(
    ({ event }) =>
      ((event._tag === "TaskTrackerReadIntentRecorded" && event.operation.operationId.startsWith(prefix)) ||
        (event._tag === "GitReadIntentRecorded" && event.operation.operationId.startsWith(prefix))) &&
      !records.some(
        ({ event: candidate }) =>
          (candidate._tag === "TaskTrackerFactsObserved" ||
            candidate._tag === "PlannedAttemptWorktreeObserved" ||
            candidate._tag === "TargetLineageObserved") &&
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
    ? requestPlannedAttemptExecutorSuspensionWithPermit(permit, subject.plannedAttempt)
    : reconcileOrObservePlannedAttemptExecutorStateWithPermit(permit, subject.plannedAttempt)
  if (report._tag === "Running") return { _tag: "Pending" as const, reason: "ExecutorRunning" as const }
  const journal = yield* InRunJournal
  return currentQuiescence(yield* journal.read(subject.plannedAttempt.runId), application, subject)
})
