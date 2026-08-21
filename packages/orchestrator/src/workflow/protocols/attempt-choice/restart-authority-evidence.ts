import { plannedTaskAttemptEquivalence, type PlannedTaskAttempt } from "@dalph/contracts"
import { Match, Schema } from "effect"
import type { JournalPosition } from "../../../workflow-journal/identity.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import {
  attemptChoiceAppliedRecordKey,
  plannedAttemptReplacedRecordKey,
  plannedAttemptExecutorCommandIntendedRecordKey,
  plannedAttemptExecutorCommandProjectionObservedRecordKey,
  plannedAttemptExecutorStateObservedRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey
} from "../../../workflow-journal/record-key.js"
import { authorizedClaimForAttempt } from "../../claim-authority-history.js"
import { latestPlannedAttemptExecutorEvidence } from "../planned-attempt-executor-work/evidence.js"
import {
  AttemptQuiescenceProof,
  type AttemptChoiceRequestId,
  type AttemptChoiceSubject,
  sameAttemptChoiceRequestId,
  sameAttemptChoiceSubject
} from "./events.js"
import type { PlannedAttemptExecutorEvidence } from "../planned-attempt-executor-work/evidence.js"

/** Exact durable applied Restart choice used by replacement reconstruction. */
export type RestartApplicationRecord = Omit<JournalRecord, "event"> & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "AttemptChoiceApplied" }> & {
    readonly choice: "RestartTaskImplementation"
  }
}

/** One atomic replacement event recovered for an applied Restart choice. */
export type PlannedAttemptReplacementRecord = Omit<JournalRecord, "event"> & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "PlannedAttemptReplaced" }>
}

export const exactAppliedRestart = (
  records: ReadonlyArray<JournalRecord>,
  requestId: AttemptChoiceRequestId,
  subject: AttemptChoiceSubject
): RestartApplicationRecord | undefined => {
  const matches = records.filter(
    (record): record is RestartApplicationRecord =>
      record.event._tag === "AttemptChoiceApplied" &&
      record.event.choice === "RestartTaskImplementation" &&
      record.runId === subject.plannedAttempt.runId &&
      record.key === attemptChoiceAppliedRecordKey(record.event.requestId) &&
      sameAttemptChoiceRequestId(record.event.requestId, requestId) &&
      sameAttemptChoiceSubject(record.event.subject, subject)
  )
  return matches.length === 1 ? matches[0] : undefined
}

export const recordedReplacement = (
  records: ReadonlyArray<JournalRecord>,
  subject: AttemptChoiceSubject
): PlannedAttemptReplacementRecord | undefined => {
  const replacements = records.filter(
    (record): record is PlannedAttemptReplacementRecord =>
      record.event._tag === "PlannedAttemptReplaced" &&
      record.runId === subject.plannedAttempt.runId &&
      record.key === plannedAttemptReplacedRecordKey(subject.plannedAttempt.attemptId) &&
      sameAttemptChoiceSubject(record.event.subject, subject)
  )
  return replacements.length === 1 ? replacements[0] : undefined
}

/** Canonical claim authority retained at the exact applied Restart position. */
export const restartClaimAuthorityAtApplication = (
  records: ReadonlyArray<JournalRecord>,
  application: RestartApplicationRecord
) =>
  authorizedClaimForAttempt(
    records.filter(({ position }) => position <= application.position),
    application.event.subject.plannedAttempt
  )

/** Converts executor evidence source identity into its durable quiescence proof. */
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

export type RestartQuiescence =
  | { readonly _tag: "Proof"; readonly evidence: PlannedAttemptExecutorEvidence }
  | {
      readonly _tag: "Rejected"
      readonly reason: "CompletedDoesNotAuthorizeReplacement" | "FailedDoesNotAuthorizeReplacement"
    }
  | { readonly _tag: "Unproved" }

/** Terminal executor evidence proves replacement only after Restart was applied. */
export const terminalRestartQuiescence = (
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

/** Exact structural equality for the durable executor quiescence witness. */
const proofEquals = Schema.toEquivalence(AttemptQuiescenceProof)

/**
 * Validates the complete executor witness used by replacement and abandonment
 * cleanup. A directly forged safe report is insufficient: responsibility,
 * command intent, and the exact correlated response/projection must all be
 * present before the quiescence proof, with no later command before disposal.
 */
export const exactExecutorQuiescenceEvidence = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  after: JournalPosition,
  before: JournalPosition,
  expected: AttemptQuiescenceProof,
  application?: RestartApplicationRecord
): boolean => {
  const bounded = records.filter(({ position }) => position < before)
  const evidence = latestPlannedAttemptExecutorEvidence(bounded, plannedAttempt)
  if (evidence === undefined || evidence.observedAt <= after || evidence.observedAt >= before) return false
  const responsibilities = bounded.filter(
    (record) =>
      record.event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
      record.runId === plannedAttempt.runId &&
      record.key === plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId) &&
      plannedTaskAttemptEquivalence(record.event.plannedAttempt, plannedAttempt) &&
      record.position < evidence.observedAt
  )
  if (responsibilities.length !== 1) return false
  const commands = bounded.filter((record) => {
    const { event } = record
    return (
      event._tag === "PlannedAttemptExecutorCommandIntended" &&
      record.runId === plannedAttempt.runId &&
      event.plannedAttempt.runId === plannedAttempt.runId &&
      event.plannedAttempt.attemptId === plannedAttempt.attemptId &&
      record.key === plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, event.ordinal)
    )
  })
  if (commands.length === 0) return false
  const source = evidence.source
  const exactSource = (() => {
    switch (source._tag) {
      case "CommandResponse": {
        const report = bounded.filter(
          (record) =>
            record.event._tag === "PlannedAttemptExecutorWorkReported" &&
            record.runId === plannedAttempt.runId &&
            record.key === plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, source.ordinal) &&
            record.position === evidence.observedAt &&
            record.event.ordinal === source.ordinal &&
            record.event.report.correlation.runId === plannedAttempt.runId &&
            record.event.report.correlation.attemptId === plannedAttempt.attemptId
        )
        return (
          report.length === 1 &&
          commands.filter((record) => {
            const { event } = record
            return (
              event._tag === "PlannedAttemptExecutorCommandIntended" &&
              record.position < evidence.observedAt &&
              Number(event.ordinal) === Number(source.ordinal)
            )
          }).length === 1
        )
      }
      case "CommandProjection": {
        const projection = bounded.filter(
          (record) =>
            record.event._tag === "PlannedAttemptExecutorCommandProjectionObserved" &&
            record.runId === plannedAttempt.runId &&
            record.key ===
              plannedAttemptExecutorCommandProjectionObservedRecordKey(
                plannedAttempt.attemptId,
                source.commandOrdinal,
                source.projectionOrdinal
              ) &&
            record.position === evidence.observedAt &&
            record.event.commandOrdinal === source.commandOrdinal &&
            record.event.projectionOrdinal === source.projectionOrdinal &&
            record.event.observation._tag === "ExactExecutorReport" &&
            record.event.observation.report.correlation.runId === plannedAttempt.runId &&
            record.event.observation.report.correlation.attemptId === plannedAttempt.attemptId
        )
        return (
          projection.length === 1 &&
          commands.filter((record) => {
            const { event } = record
            return (
              event._tag === "PlannedAttemptExecutorCommandIntended" &&
              record.position < evidence.observedAt &&
              event.ordinal === source.commandOrdinal
            )
          }).length === 1
        )
      }
      case "StateProjection": {
        const state = bounded.filter(
          (record) =>
            record.event._tag === "PlannedAttemptExecutorStateObserved" &&
            record.runId === plannedAttempt.runId &&
            record.key === plannedAttemptExecutorStateObservedRecordKey(plannedAttempt.attemptId, source.ordinal) &&
            record.position === evidence.observedAt &&
            record.event.ordinal === source.ordinal &&
            record.event.observation._tag === "ExactExecutorReport" &&
            record.event.observation.report.correlation.runId === plannedAttempt.runId &&
            record.event.observation.report.correlation.attemptId === plannedAttempt.attemptId
        )
        return state.length === 1 && commands.some((record) => record.position < evidence.observedAt)
      }
    }
  })()
  if (!exactSource) return false
  const laterExecutorCommand = records.some(
    ({ event, position }) =>
      position > evidence.observedAt &&
      event._tag === "PlannedAttemptExecutorCommandIntended" &&
      event.plannedAttempt.runId === plannedAttempt.runId &&
      event.plannedAttempt.attemptId === plannedAttempt.attemptId
  )
  if (laterExecutorCommand) return false
  const quiescent =
    evidence.report._tag === "SafelySuspended" ||
    (evidence.report._tag === "Terminal" && application === undefined) ||
    (application !== undefined && terminalRestartQuiescence(evidence, application)._tag === "Proof")
  return quiescent && proofEquals(proofFor(evidence), expected)
}
