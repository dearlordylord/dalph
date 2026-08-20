import { plannedTaskAttemptEquivalence } from "@dalph/contracts"
import { Match } from "effect"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import { authorizedClaimForAttempt } from "../../claim-authority-history.js"
import {
  AttemptChoiceRequestId,
  AttemptChoiceSubject,
  type AttemptQuiescenceProof,
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
): RestartApplicationRecord | undefined =>
  records.find(
    (record): record is RestartApplicationRecord =>
      record.event._tag === "AttemptChoiceApplied" &&
      record.event.choice === "RestartTaskImplementation" &&
      sameAttemptChoiceRequestId(record.event.requestId, requestId) &&
      sameAttemptChoiceSubject(record.event.subject, subject)
  )

export const recordedReplacement = (
  records: ReadonlyArray<JournalRecord>,
  subject: AttemptChoiceSubject
): PlannedAttemptReplacementRecord | undefined => {
  const replacements = records.filter(
    (record): record is PlannedAttemptReplacementRecord =>
      record.event._tag === "PlannedAttemptReplaced" &&
      plannedTaskAttemptEquivalence(record.event.subject.plannedAttempt, subject.plannedAttempt)
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
