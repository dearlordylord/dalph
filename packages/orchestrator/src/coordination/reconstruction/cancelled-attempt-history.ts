/* eslint-disable max-lines -- Cancellation chronology, claim settlement, and proof provenance are one fail-closed boundary. */
import { plannedTaskAttemptEquivalence, type PlannedTaskAttempt, type RunId } from "@dalph/contracts"
import { isExactTaskClaim } from "../../authorities/task-tracker/claim-mutation.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { OperationId } from "../../workflow/identity.js"
import type { WorkflowJournalEvent } from "../../workflow/registry/event.js"
import type { CancelledAttemptTaskClaimReleaseOperation, WorkflowOperation } from "../../workflow/registry/operation.js"
import type { CancelledAttemptClaimNoReleaseObservedEvent } from "../../workflow/protocols/run-cancellation/events.js"
import { authorizedClaimForAttempt } from "../../workflow/claim-authority-history.js"
import { recordedTaskAttemptPlanFor } from "../../workflow/protocols/task-attempt-planning/journal-evidence.js"
import {
  latestPlannedAttemptExecutorEvidence,
  plannedAttemptExecutorEvidence,
  type PlannedAttemptExecutorEvidence
} from "../../workflow/protocols/planned-attempt-executor-work/evidence.js"
import { taskTrackerObservationMatchesRead } from "../../workflow/task-tracker-facts/observation-match.js"
import { integrationResponsibilityEquivalence } from "../../workflow/protocols/integration-admission/responsibility.js"
import { claimReadMatchesTarget, exactWorkflowRunTargetForRun } from "../../workflow-journal/run-target.js"
import { taskTrackerTargetKey, type TrackerTarget } from "../../authorities/task-tracker/target.js"
import {
  cancelledAttemptImplementationAbandonedRecordKey,
  intentRecordKey,
  outcomeRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey,
  plannedAttemptReplacedRecordKey,
  runCancellationAppliedRecordKey
} from "../../workflow-journal/record-key.js"
import {
  isJournalRecordEvidence,
  journalEvidenceBefore,
  journalRecordByKey,
  journalRecordByPosition,
  journalRecordsForTask,
  lastJournalRecordForAttemptKind,
  type JournalHistorySource
} from "../../workflow-journal/record-evidence.js"

type AbandonedEvent = Extract<WorkflowJournalEvent, { readonly _tag: "CancelledAttemptImplementationAbandoned" }>
type NoReleaseEvent = CancelledAttemptClaimNoReleaseObservedEvent
type CancellationAppliedRecord = Omit<JournalRecord, "event"> & {
  readonly event: Extract<WorkflowJournalEvent, { readonly _tag: "RunCancellationApplied" }>
}
type ReleaseIntentEvent = Extract<WorkflowJournalEvent, { readonly _tag: "TaskClaimReleaseIntended" }>
type ClaimObservationRecord = Omit<JournalRecord, "event"> & {
  readonly event: Extract<WorkflowJournalEvent, { readonly _tag: "TaskTrackerFactsObserved" }>
}

const priorRecords = (records: JournalHistorySource, position: JournalPosition): JournalHistorySource =>
  isJournalRecordEvidence(records)
    ? journalEvidenceBefore(records, position)
    : records.filter((candidate) => candidate.position < position)

const recordsThrough = (records: JournalHistorySource, position: JournalPosition): JournalHistorySource =>
  isJournalRecordEvidence(records)
    ? journalEvidenceBefore(records, position + 1)
    : records.filter((candidate) => candidate.position <= position)

const exactCancellation = (
  records: JournalHistorySource,
  position: JournalPosition
): CancellationAppliedRecord | undefined =>
  (() => {
    const candidate = isJournalRecordEvidence(records)
      ? journalRecordByPosition(records, position)
      : records.find((record) => record.position === position && record.event._tag === "RunCancellationApplied")
    return candidate?.event._tag === "RunCancellationApplied" ? { ...candidate, event: candidate.event } : undefined
  })()

const matchingAbandonment = (
  records: JournalHistorySource,
  plannedAttempt: PlannedTaskAttempt,
  cancellationAppliedAt: JournalPosition,
  beforePosition: JournalPosition
): (JournalRecord & { readonly event: AbandonedEvent }) | undefined =>
  (() => {
    const source = priorRecords(records, beforePosition)
    const candidate = isJournalRecordEvidence(source)
      ? journalRecordByKey(source, cancelledAttemptImplementationAbandonedRecordKey(plannedAttempt.attemptId))
      : source.findLast(
          (record) =>
            record.event._tag === "CancelledAttemptImplementationAbandoned" &&
            record.event.cancellationAppliedAt === cancellationAppliedAt &&
            plannedTaskAttemptEquivalence(record.event.plannedAttempt, plannedAttempt)
        )
    return candidate?.event._tag === "CancelledAttemptImplementationAbandoned" &&
      candidate.event.cancellationAppliedAt === cancellationAppliedAt &&
      plannedTaskAttemptEquivalence(candidate.event.plannedAttempt, plannedAttempt)
      ? { ...candidate, event: candidate.event }
      : undefined
  })()

const proofEvidenceFor = (
  proof: AbandonedEvent["proof"],
  plannedAttempt: PlannedTaskAttempt,
  records: JournalHistorySource
): PlannedAttemptExecutorEvidence | undefined =>
  (() => {
    if (!isJournalRecordEvidence(records)) {
      return plannedAttemptExecutorEvidence(records, plannedAttempt).find(
        (candidate) => candidate.source._tag === "AcceptedReport" && candidate.source.ordinal === proof.reportOrdinal
      )
    }
    const candidate = journalRecordByKey(
      records,
      plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, proof.reportOrdinal)
    )
    if (
      candidate?.event._tag !== "PlannedAttemptExecutorWorkReported" ||
      candidate.event.ordinal !== proof.reportOrdinal ||
      candidate.event.report.correlation.runId !== plannedAttempt.runId ||
      candidate.event.report.correlation.attemptId !== plannedAttempt.attemptId
    ) {
      return undefined
    }
    return {
      observedAt: candidate.position,
      report: candidate.event.report,
      source: { _tag: "AcceptedReport", ordinal: candidate.event.ordinal }
    }
  })()

const proofMatchesEvidence = (
  proof: AbandonedEvent["proof"],
  plannedAttempt: PlannedTaskAttempt,
  records: JournalHistorySource
): boolean => {
  const evidence = proofEvidenceFor(proof, plannedAttempt, records)
  const latest = latestPlannedAttemptExecutorEvidence(records, plannedAttempt)
  if (
    evidence === undefined ||
    latest === undefined ||
    latest.observedAt !== evidence.observedAt ||
    (evidence.report._tag !== "ExecutorWorkTerminal" && evidence.report._tag !== "ExecutorWorkSafelySuspended")
  ) {
    return false
  }
  const laterCommand = lastJournalRecordForAttemptKind(
    records,
    plannedAttempt.attemptId,
    "PlannedAttemptExecutorCommandIntended"
  )
  return laterCommand === undefined || laterCommand.position <= evidence.observedAt
}

const focusedClaimObservationRecord = (
  record: JournalRecord,
  taskId: PlannedTaskAttempt["taskId"],
  immutableRunTarget: TrackerTarget | undefined
): record is ClaimObservationRecord =>
  record.event._tag === "TaskTrackerFactsObserved" &&
  immutableRunTarget !== undefined &&
  (record.event.observation._tag === "FocusedTaskClaimFacts" ||
    record.event.observation._tag === "FocusedTaskClaimFactsUnreadable") &&
  record.event.observation.coverage.taskId === taskId &&
  taskTrackerTargetKey(record.event.observation.target) === taskTrackerTargetKey(immutableRunTarget)

const exactClaimObservationAfter = (
  bounded: JournalHistorySource,
  operationId: OperationId,
  taskId: PlannedTaskAttempt["taskId"],
  after: JournalPosition,
  immutableRunTarget: TrackerTarget | undefined
): ClaimObservationRecord | undefined => {
  const exact = isJournalRecordEvidence(bounded)
    ? journalRecordByKey(bounded, outcomeRecordKey(operationId))
    : bounded.findLast(
        (candidate) =>
          candidate.position > after &&
          focusedClaimObservationRecord(candidate, taskId, immutableRunTarget) &&
          candidate.event.operationId === operationId
      )
  return exact !== undefined &&
    exact.position > after &&
    focusedClaimObservationRecord(exact, taskId, immutableRunTarget) &&
    exact.event.operationId === operationId
    ? exact
    : undefined
}

const claimObservationRecordFor = (
  records: JournalHistorySource,
  operationId: OperationId,
  taskId: PlannedTaskAttempt["taskId"],
  after: JournalPosition,
  before: JournalPosition,
  immutableRunTarget: TrackerTarget | undefined
): ClaimObservationRecord | undefined => {
  const bounded = priorRecords(records, before)
  const observation = exactClaimObservationAfter(bounded, operationId, taskId, after, immutableRunTarget)
  const latestFocused = isJournalRecordEvidence(bounded)
    ? Array.from(journalRecordsForTask(bounded, taskId)).findLast((candidate) =>
        focusedClaimObservationRecord(candidate, taskId, immutableRunTarget)
      )
    : bounded.findLast((candidate) => focusedClaimObservationRecord(candidate, taskId, immutableRunTarget))
  if (observation === undefined || (latestFocused !== undefined && latestFocused.position > observation.position)) {
    return undefined
  }
  return observation
}

const claimObservationIsExact = (
  record: ClaimObservationRecord | undefined,
  expectedClaim: AbandonedEvent["authorizedClaim"]
): boolean =>
  record?.event.observation._tag === "FocusedTaskClaimFacts" &&
  record.event.observation.observation._tag === "ActiveTaskClaim" &&
  isExactTaskClaim(record.event.observation.observation, expectedClaim)

const claimObservationIsAbsentOrForeign = (
  record: ClaimObservationRecord | undefined,
  expectedClaim: NoReleaseEvent["expectedClaim"]
): boolean => {
  if (record?.event.observation._tag !== "FocusedTaskClaimFacts") return false
  const observed = record.event.observation.observation
  return observed._tag === "UnclaimedTask" || !isExactTaskClaim(observed, expectedClaim)
}

type ClaimReadOperation = typeof WorkflowOperation.cases.ReadTaskClaim.Type

type ClaimReadIntentRecord = JournalRecord & {
  readonly event: Extract<WorkflowJournalEvent, { readonly _tag: "TaskTrackerReadIntentRecorded" }> & {
    readonly operation: ClaimReadOperation
  }
}

const isExactClaimReadIntentAfter = (
  record: JournalRecord,
  operationId: OperationId,
  taskId: PlannedTaskAttempt["taskId"],
  after: JournalPosition,
  immutableRunTarget: TrackerTarget | undefined
): record is ClaimReadIntentRecord =>
  record.position > after &&
  record.event._tag === "TaskTrackerReadIntentRecorded" &&
  record.event.operation._tag === "ReadTaskClaim" &&
  record.event.operation.operationId === operationId &&
  record.event.operation.taskId === taskId &&
  immutableRunTarget !== undefined &&
  taskTrackerTargetKey(record.event.operation.target) === taskTrackerTargetKey(immutableRunTarget)

const claimReadIntentFor = (
  records: JournalHistorySource,
  operationId: OperationId,
  taskId: PlannedTaskAttempt["taskId"],
  after: JournalPosition,
  before: JournalPosition,
  immutableRunTarget: TrackerTarget | undefined
): ClaimReadOperation | undefined => {
  const bounded = priorRecords(records, before)
  const intent = isJournalRecordEvidence(bounded)
    ? journalRecordByKey(bounded, intentRecordKey(operationId))
    : bounded.findLast((record) => isExactClaimReadIntentAfter(record, operationId, taskId, after, immutableRunTarget))
  if (intent === undefined || !isExactClaimReadIntentAfter(intent, operationId, taskId, after, immutableRunTarget)) {
    return undefined
  }
  if (!claimReadMatchesTarget(records, operationId, taskId, after, before, immutableRunTarget)) return undefined
  return intent.event.operation
}

const cancellationAbandonmentForRelease = (
  records: JournalHistorySource,
  authority: Extract<
    CancelledAttemptTaskClaimReleaseOperation["authority"],
    { readonly _tag: "CancelledAttemptClaimReleaseAuthority" }
  >,
  beforePosition: JournalPosition
): (JournalRecord & { readonly event: AbandonedEvent }) | undefined =>
  (() => {
    const candidate = isJournalRecordEvidence(records)
      ? journalRecordByPosition(records, authority.implementationAbandonedAt)
      : records.find(
          (record) =>
            record.position === authority.implementationAbandonedAt &&
            record.position < beforePosition &&
            record.event._tag === "CancelledAttemptImplementationAbandoned" &&
            record.event.cancellationAppliedAt === authority.cancellationAppliedAt
        )
    return candidate !== undefined &&
      candidate.position < beforePosition &&
      candidate.event._tag === "CancelledAttemptImplementationAbandoned" &&
      candidate.event.cancellationAppliedAt === authority.cancellationAppliedAt
      ? { ...candidate, event: candidate.event }
      : undefined
  })()

const priorCancellationClaimDisposition = (
  records: JournalHistorySource,
  abandonedAt: JournalPosition,
  claim: AbandonedEvent["authorizedClaim"],
  beforePosition: JournalPosition
): JournalRecord | undefined =>
  (() => {
    const bounded = priorRecords(records, beforePosition)
    const candidates = isJournalRecordEvidence(bounded)
      ? Array.from(journalRecordsForTask(bounded, claim.taskId))
      : bounded
    return candidates.find(
      (candidate) =>
        candidate.position > abandonedAt &&
        ((candidate.event._tag === "CancelledAttemptClaimNoReleaseObserved" &&
          isExactTaskClaim(candidate.event.expectedClaim, claim)) ||
          (candidate.event._tag === "TaskClaimReleased" && isExactTaskClaim(candidate.event.release.claim, claim)))
    )
  })()

const priorCancellationReleaseIntent = (
  records: JournalHistorySource,
  abandonedAt: JournalPosition,
  claim: AbandonedEvent["authorizedClaim"],
  beforePosition: JournalPosition
): JournalRecord | undefined =>
  (() => {
    const bounded = priorRecords(records, beforePosition)
    const candidates = isJournalRecordEvidence(bounded)
      ? Array.from(journalRecordsForTask(bounded, claim.taskId))
      : bounded
    return candidates.find(
      (candidate) =>
        candidate.position > abandonedAt &&
        candidate.event._tag === "TaskClaimReleaseIntended" &&
        candidate.event.operation.authority._tag === "CancelledAttemptClaimReleaseAuthority" &&
        isExactTaskClaim(candidate.event.operation.release.claim, claim)
    )
  })()

const claimBelongsToCancelledAttempt = (
  records: JournalHistorySource,
  runId: RunId,
  claim: AbandonedEvent["authorizedClaim"],
  beforePosition: JournalPosition
): boolean => {
  const bounded = priorRecords(records, beforePosition)
  const cancellation = isJournalRecordEvidence(bounded)
    ? journalRecordByKey(bounded, runCancellationAppliedRecordKey)
    : bounded.findLast((candidate) => candidate.runId === runId && candidate.event._tag === "RunCancellationApplied")
  if (cancellation === undefined || cancellation.runId !== runId) return false
  const prior = priorRecords(records, cancellation.position)
  const candidates = isJournalRecordEvidence(prior) ? Array.from(journalRecordsForTask(prior, claim.taskId)) : prior
  const attempts = candidates.flatMap((candidate) => {
    if (candidate.event._tag === "TaskAttemptPlanned") return [candidate.event.operation.plannedAttempt]
    if (candidate.event._tag === "PlannedAttemptReplaced") return [candidate.event.successorPlan.plannedAttempt]
    return []
  })
  return attempts.some((plannedAttempt) => {
    const executorBegan = isJournalRecordEvidence(prior)
      ? journalRecordByKey(prior, plannedAttemptExecutorWorkResponsibilityBeganRecordKey(plannedAttempt.attemptId))
      : prior.find(
          (candidate) =>
            candidate.event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
            plannedTaskAttemptEquivalence(candidate.event.plannedAttempt, plannedAttempt)
        )
    const authorized = authorizedClaimForAttempt(prior, plannedAttempt)?.claim
    return executorBegan !== undefined && authorized !== undefined && isExactTaskClaim(authorized, claim)
  })
}

const postCancellationForwardWorkTags = new Set<WorkflowJournalEvent["_tag"]>([
  "TaskClaimAcquisitionIntended",
  "TaskClaimReacquisitionDirected",
  "TaskAttemptPlanned",
  "PlannedAttemptReplaced",
  "PlannedAttemptExecutorWorkResponsibilityBegan",
  "IntegrationResponsibilityBegan",
  "AttemptChoiceApplied"
])

const postCancellationClaimAcquisitionWork = (
  operationId: OperationId,
  eventTag: "TaskClaimAcquired" | "TaskClaimAcquisitionRejected",
  records: JournalHistorySource,
  cancellationAt: JournalPosition
): string | undefined =>
  claimAcquisitionWasIntendedBeforeCancellation(records, operationId, cancellationAt) ? undefined : eventTag

const postCancellationIntegrationWork = (
  record: JournalRecord,
  records: JournalHistorySource,
  cancellationAt: JournalPosition
): string | undefined =>
  integrationResponsibilityWasBeganBeforeCancellation(record, records, cancellationAt)
    ? undefined
    : "IntegrationStarted"

const claimAcquisitionWasIntendedBeforeCancellation = (
  records: JournalHistorySource,
  operationId: OperationId,
  cancellationAt: JournalPosition
): boolean =>
  (() => {
    const prior = priorRecords(records, cancellationAt)
    if (!isJournalRecordEvidence(prior)) {
      return prior.some(
        ({ event }) =>
          event._tag === "TaskClaimAcquisitionIntended" && event.operation.acquisition.operationId === operationId
      )
    }
    const intent = journalRecordByKey(prior, intentRecordKey(operationId))
    return (
      intent?.event._tag === "TaskClaimAcquisitionIntended" &&
      intent.event.operation.acquisition.operationId === operationId
    )
  })()

const integrationResponsibilityPrecedesCancellation = (
  candidate: JournalRecord,
  started: Extract<WorkflowJournalEvent, { readonly _tag: "IntegrationStarted" }>,
  startedAt: JournalPosition,
  cancellationAt: JournalPosition
): boolean =>
  candidate.position < cancellationAt &&
  candidate.position < startedAt &&
  candidate.event._tag === "IntegrationResponsibilityBegan" &&
  integrationResponsibilityEquivalence(candidate.event, started)

const integrationResponsibilityWasBeganBeforeCancellation = (
  record: JournalRecord,
  records: JournalHistorySource,
  cancellationAt: JournalPosition
): boolean => {
  const started = record.event
  /* v8 ignore next -- @preserve postCancellationForwardWork calls this helper only for IntegrationStarted records. */
  if (started._tag !== "IntegrationStarted") return false
  if (!isJournalRecordEvidence(records)) {
    return records.some(
      (candidate) =>
        candidate.position === started.responsibilityBeganAt &&
        integrationResponsibilityPrecedesCancellation(candidate, started, record.position, cancellationAt)
    )
  }
  const candidate = journalRecordByPosition(records, started.responsibilityBeganAt)
  return (
    candidate !== undefined &&
    integrationResponsibilityPrecedesCancellation(candidate, started, record.position, cancellationAt)
  )
}

const postCancellationForwardWork = (
  record: JournalRecord,
  records: JournalHistorySource,
  cancellationAt: JournalPosition
): string | undefined => {
  const { event } = record
  if (event._tag === "TaskClaimAcquired") {
    return postCancellationClaimAcquisitionWork(event.claim.operationId, event._tag, records, cancellationAt)
  }
  if (event._tag === "TaskClaimAcquisitionRejected") {
    return postCancellationClaimAcquisitionWork(event.operationId, event._tag, records, cancellationAt)
  }
  if (event._tag === "IntegrationStarted") {
    return postCancellationIntegrationWork(record, records, cancellationAt)
  }
  if (
    event._tag === "PlannedAttemptExecutorCommandIntended" &&
    (event.command === "Begin" || event.command === "Resume")
  ) {
    return event._tag
  }
  return postCancellationForwardWorkTags.has(event._tag) ? event._tag : undefined
}

/** Cancellation closes forward admission; only settlement, reconciliation, cleanup, and reads may follow. */
const validateNoForwardWorkAfterCancellation = (
  record: JournalRecord,
  runId: RunId,
  records: JournalHistorySource,
  onInvalid: (detail: string) => void
): void => {
  if (record.runId !== runId) return
  const prior = priorRecords(records, record.position)
  const cancellation = isJournalRecordEvidence(prior)
    ? journalRecordByKey(prior, runCancellationAppliedRecordKey)
    : prior.findLast((candidate) => candidate.runId === runId && candidate.event._tag === "RunCancellationApplied")
  if (cancellation === undefined || cancellation.runId !== runId) return
  const forbidden = postCancellationForwardWork(record, records, cancellation.position)
  if (forbidden !== undefined) {
    onInvalid(`post-cancellation history cannot record forward-work event ${forbidden}`)
  }
}

const validateAbandonmentFoundations = (
  event: AbandonedEvent,
  position: JournalPosition,
  runId: RunId,
  records: JournalHistorySource,
  prior: JournalHistorySource,
  onInvalid: (detail: string) => void
): CancellationAppliedRecord | undefined => {
  const cancellation = exactCancellation(records, event.cancellationAppliedAt)
  if (cancellation === undefined || cancellation.position >= position) {
    onInvalid("cancelled-attempt abandonment requires its exact prior RunCancellationApplied position")
  } else if (cancellation.runId !== runId) {
    onInvalid("cancelled-attempt abandonment names a cancellation from another Run")
  }
  if (event.plannedAttempt.runId !== runId) {
    onInvalid("cancelled-attempt abandonment planned attempt binds another Run")
  }
  if (recordedTaskAttemptPlanFor(prior, event.plannedAttempt) === undefined) {
    onInvalid("cancelled-attempt abandonment requires its exact prior planned attempt")
  }
  return cancellation
}

const validateAbandonmentResponsibility = (
  event: AbandonedEvent,
  cancellation: CancellationAppliedRecord | undefined,
  prior: JournalHistorySource,
  onInvalid: (detail: string) => void
): void => {
  const began = isJournalRecordEvidence(prior)
    ? journalRecordByKey(prior, plannedAttemptExecutorWorkResponsibilityBeganRecordKey(event.plannedAttempt.attemptId))
    : prior.find(
        (candidate) =>
          candidate.event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
          plannedTaskAttemptEquivalence(candidate.event.plannedAttempt, event.plannedAttempt)
      )
  const matchingBegan =
    began?.event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
    plannedTaskAttemptEquivalence(began.event.plannedAttempt, event.plannedAttempt)
      ? began
      : undefined
  if (matchingBegan === undefined || (cancellation !== undefined && matchingBegan.position >= cancellation.position)) {
    onInvalid("cancelled-attempt abandonment requires prior executor-work responsibility")
  }
}

const validateAbandonmentNotReplaced = (
  event: AbandonedEvent,
  prior: JournalHistorySource,
  onInvalid: (detail: string) => void
): void => {
  const replacement = isJournalRecordEvidence(prior)
    ? journalRecordByKey(prior, plannedAttemptReplacedRecordKey(event.plannedAttempt.attemptId))
    : prior.find(
        (candidate) =>
          candidate.event._tag === "PlannedAttemptReplaced" &&
          plannedTaskAttemptEquivalence(candidate.event.subject.plannedAttempt, event.plannedAttempt)
      )
  if (
    replacement?.event._tag === "PlannedAttemptReplaced" &&
    plannedTaskAttemptEquivalence(replacement.event.subject.plannedAttempt, event.plannedAttempt)
  ) {
    onInvalid("cancelled-attempt abandonment cannot follow replacement of the exact planned attempt")
  }
}

const validateAbandonmentNotRepeated = (
  event: AbandonedEvent,
  prior: JournalHistorySource,
  onInvalid: (detail: string) => void
): void => {
  const abandoned = isJournalRecordEvidence(prior)
    ? journalRecordByKey(prior, cancelledAttemptImplementationAbandonedRecordKey(event.plannedAttempt.attemptId))
    : prior.find(
        (candidate) =>
          candidate.event._tag === "CancelledAttemptImplementationAbandoned" &&
          plannedTaskAttemptEquivalence(candidate.event.plannedAttempt, event.plannedAttempt)
      )
  if (
    abandoned?.event._tag === "CancelledAttemptImplementationAbandoned" &&
    plannedTaskAttemptEquivalence(abandoned.event.plannedAttempt, event.plannedAttempt)
  ) {
    onInvalid("cancelled-attempt implementation responsibility is already abandoned")
  }
}

const validateAbandonmentClaim = (
  event: AbandonedEvent,
  cancellation: CancellationAppliedRecord | undefined,
  records: JournalHistorySource,
  prior: JournalHistorySource,
  onInvalid: (detail: string) => void
): void => {
  const recordsThroughCancellation = cancellation === undefined ? prior : recordsThrough(records, cancellation.position)
  const authorized = authorizedClaimForAttempt(recordsThroughCancellation, event.plannedAttempt)?.claim
  if (authorized === undefined || !isExactTaskClaim(authorized, event.authorizedClaim)) {
    onInvalid("cancelled-attempt abandonment requires the exact authorized claim")
  }
}

const validateAbandonmentProof = (
  event: AbandonedEvent,
  cancellation: CancellationAppliedRecord | undefined,
  prior: JournalHistorySource,
  onInvalid: (detail: string) => void
): void => {
  if (cancellation === undefined || !proofMatchesEvidence(event.proof, event.plannedAttempt, prior)) {
    onInvalid("cancelled-attempt abandonment requires current safe or terminal executor evidence")
  }
}

const validateAbandonment = (
  record: JournalRecord,
  runId: RunId,
  records: JournalHistorySource,
  onInvalid: (detail: string) => void
): void => {
  if (record.event._tag !== "CancelledAttemptImplementationAbandoned") return
  const event = record.event
  const prior = priorRecords(records, record.position)
  const cancellation = validateAbandonmentFoundations(event, record.position, runId, records, prior, onInvalid)
  validateAbandonmentResponsibility(event, cancellation, prior, onInvalid)
  validateAbandonmentNotReplaced(event, prior, onInvalid)
  validateAbandonmentNotRepeated(event, prior, onInvalid)
  validateAbandonmentClaim(event, cancellation, records, prior, onInvalid)
  validateAbandonmentProof(event, cancellation, prior, onInvalid)
}

const validateNoReleaseFoundations = (
  event: NoReleaseEvent,
  position: JournalPosition,
  runId: RunId,
  prior: JournalHistorySource,
  onInvalid: (detail: string) => void
): (JournalRecord & { readonly event: AbandonedEvent }) | undefined => {
  if (event.plannedAttempt.runId !== runId) onInvalid("cancelled-attempt no-release binds another Run")
  const abandoned = matchingAbandonment(prior, event.plannedAttempt, event.cancellationAppliedAt, position)
  if (abandoned === undefined) {
    onInvalid("cancelled-attempt no-release requires its exact prior implementation abandonment")
    return undefined
  }
  if (!isExactTaskClaim(abandoned.event.authorizedClaim, event.expectedClaim)) {
    onInvalid("cancelled-attempt no-release contradicts its authorized claim")
  }
  return abandoned
}

const noReleaseObservationMatchesEvent = (
  expected: NoReleaseEvent["observation"],
  observed: NoReleaseEvent["observation"]
): boolean => {
  if (observed._tag === "UnclaimedTask") {
    return expected._tag === "UnclaimedTask" && expected.taskId === observed.taskId
  }
  return expected._tag === "ActiveTaskClaim" && isExactTaskClaim(expected, observed)
}

const noReleaseObservationIsValid = (
  prior: JournalHistorySource,
  event: NoReleaseEvent,
  position: JournalPosition,
  abandoned: JournalRecord & { readonly event: AbandonedEvent }
): boolean => {
  const immutableRunTarget = exactWorkflowRunTargetForRun(prior, event.plannedAttempt.runId)
  const observation = claimObservationRecordFor(
    prior,
    event.observationOperationId,
    event.plannedAttempt.taskId,
    abandoned.position,
    position,
    immutableRunTarget
  )
  const readIntent =
    observation === undefined
      ? undefined
      : claimReadIntentFor(
          prior,
          event.observationOperationId,
          event.plannedAttempt.taskId,
          abandoned.position,
          observation.position,
          immutableRunTarget
        )
  if (observation === undefined || readIntent === undefined) return false
  if (!readIntent.predecessorOperationIds.includes(abandoned.event.authorizedClaim.operationId)) return false
  if (!taskTrackerObservationMatchesRead(observation.event.observation, readIntent)) return false
  if (!claimObservationIsAbsentOrForeign(observation, event.expectedClaim)) return false
  if (observation.event.observation._tag !== "FocusedTaskClaimFacts") return false
  return noReleaseObservationMatchesEvent(event.observation, observation.event.observation.observation)
}

const validateNoReleaseObservation = (
  prior: JournalHistorySource,
  event: NoReleaseEvent,
  position: JournalPosition,
  abandoned: JournalRecord & { readonly event: AbandonedEvent },
  onInvalid: (detail: string) => void
): void => {
  if (!noReleaseObservationIsValid(prior, event, position, abandoned)) {
    onInvalid("cancelled-attempt no-release requires an exact absent or foreign focused claim observation")
  }
}

const validateNoReleaseDisposition = (
  prior: JournalHistorySource,
  event: NoReleaseEvent,
  position: JournalPosition,
  abandoned: JournalRecord & { readonly event: AbandonedEvent },
  onInvalid: (detail: string) => void
): void => {
  if (
    priorCancellationClaimDisposition(prior, abandoned.position, event.expectedClaim, position) !== undefined ||
    priorCancellationReleaseIntent(prior, abandoned.position, event.expectedClaim, position) !== undefined
  ) {
    onInvalid("cancelled-attempt claim disposition is already terminal")
  }
}

const validateNoRelease = (
  record: JournalRecord,
  runId: RunId,
  records: JournalHistorySource,
  onInvalid: (detail: string) => void
): void => {
  if (record.event._tag !== "CancelledAttemptClaimNoReleaseObserved") return
  const event = record.event
  const prior = priorRecords(records, record.position)
  const abandoned = validateNoReleaseFoundations(event, record.position, runId, prior, onInvalid)
  if (abandoned === undefined) return
  validateNoReleaseObservation(prior, event, record.position, abandoned, onInvalid)
  validateNoReleaseDisposition(prior, event, record.position, abandoned, onInvalid)
}

const validateNonCancellationReleaseAuthority = (
  operation: ReleaseIntentEvent["operation"],
  runId: RunId,
  records: JournalHistorySource,
  position: JournalPosition,
  prior: JournalHistorySource,
  onInvalid: (detail: string) => void
): void => {
  const candidates = isJournalRecordEvidence(prior)
    ? Array.from(journalRecordsForTask(prior, operation.release.claim.taskId))
    : prior
  const abandoned = candidates.findLast(
    (candidate) =>
      candidate.event._tag === "CancelledAttemptImplementationAbandoned" &&
      isExactTaskClaim(candidate.event.authorizedClaim, operation.release.claim)
  )
  if (abandoned !== undefined || claimBelongsToCancelledAttempt(records, runId, operation.release.claim, position)) {
    onInvalid("cancelled-attempt claim release requires CancelledAttemptClaimReleaseAuthority")
  }
}

const cancellationReleaseAbandonmentFor = (
  operation: ReleaseIntentEvent["operation"],
  authority: Extract<
    ReleaseIntentEvent["operation"]["authority"],
    { readonly _tag: "CancelledAttemptClaimReleaseAuthority" }
  >,
  runId: RunId,
  position: JournalPosition,
  prior: JournalHistorySource,
  onInvalid: (detail: string) => void
): (JournalRecord & { readonly event: AbandonedEvent }) | undefined => {
  const cancellation = exactCancellation(prior, authority.cancellationAppliedAt)
  if (cancellation === undefined || cancellation.runId !== runId) {
    onInvalid("cancelled-attempt claim release requires its exact prior RunCancellationApplied")
  }
  const abandoned = cancellationAbandonmentForRelease(prior, authority, position)
  if (abandoned === undefined) {
    onInvalid("cancelled-attempt claim release requires its exact prior implementation abandonment")
    return undefined
  }
  if (!isExactTaskClaim(operation.release.claim, abandoned.event.authorizedClaim)) {
    onInvalid("cancelled-attempt claim release contradicts its authorized claim")
  }
  return abandoned
}

const cancellationReleaseObservationIsValid = (
  prior: JournalHistorySource,
  authority: Extract<
    ReleaseIntentEvent["operation"]["authority"],
    { readonly _tag: "CancelledAttemptClaimReleaseAuthority" }
  >,
  position: JournalPosition,
  abandoned: JournalRecord & { readonly event: AbandonedEvent }
): boolean => {
  const immutableRunTarget = exactWorkflowRunTargetForRun(prior, abandoned.event.plannedAttempt.runId)
  const observation = claimObservationRecordFor(
    prior,
    authority.observationOperationId,
    abandoned.event.plannedAttempt.taskId,
    abandoned.position,
    position,
    immutableRunTarget
  )
  if (observation === undefined) return false
  const readIntent = claimReadIntentFor(
    prior,
    authority.observationOperationId,
    abandoned.event.plannedAttempt.taskId,
    abandoned.position,
    position,
    immutableRunTarget
  )
  if (readIntent === undefined) return false
  if (!readIntent.predecessorOperationIds.includes(abandoned.event.authorizedClaim.operationId)) return false
  if (!taskTrackerObservationMatchesRead(observation.event.observation, readIntent)) return false
  return claimObservationIsExact(observation, abandoned.event.authorizedClaim)
}

const validateCancellationReleaseObservation = (
  prior: JournalHistorySource,
  authority: Extract<
    ReleaseIntentEvent["operation"]["authority"],
    { readonly _tag: "CancelledAttemptClaimReleaseAuthority" }
  >,
  position: JournalPosition,
  abandoned: JournalRecord & { readonly event: AbandonedEvent },
  onInvalid: (detail: string) => void
): void => {
  if (!cancellationReleaseObservationIsValid(prior, authority, position, abandoned)) {
    onInvalid("cancelled-attempt claim release requires a fresh exact focused claim observation")
  }
}

const validateCancellationReleaseDisposition = (
  prior: JournalHistorySource,
  operation: ReleaseIntentEvent["operation"],
  position: JournalPosition,
  abandoned: JournalRecord & { readonly event: AbandonedEvent },
  onInvalid: (detail: string) => void
): void => {
  if (
    priorCancellationClaimDisposition(prior, abandoned.position, operation.release.claim, position) !== undefined ||
    priorCancellationReleaseIntent(prior, abandoned.position, operation.release.claim, position) !== undefined
  ) {
    onInvalid("cancelled-attempt claim disposition is already terminal")
  }
}

const validateCancellationReleaseIntent = (
  record: JournalRecord,
  runId: RunId,
  records: JournalHistorySource,
  onInvalid: (detail: string) => void
): void => {
  if (record.event._tag !== "TaskClaimReleaseIntended") return
  const operation = record.event.operation
  const authority = operation.authority
  const prior = priorRecords(records, record.position)
  if (authority._tag !== "CancelledAttemptClaimReleaseAuthority") {
    validateNonCancellationReleaseAuthority(operation, runId, records, record.position, prior, onInvalid)
    return
  }
  const abandoned = cancellationReleaseAbandonmentFor(operation, authority, runId, record.position, prior, onInvalid)
  if (abandoned === undefined) {
    return
  }
  validateCancellationReleaseObservation(prior, authority, record.position, abandoned, onInvalid)
  validateCancellationReleaseDisposition(prior, operation, record.position, abandoned, onInvalid)
}

/** The exact cancellation release intent is the last matching raw record, unlike ordinary release diagnostics. */
const cancellationReleaseIntentFor = (prior: JournalHistorySource, operationId: OperationId) => {
  const intentCandidate = isJournalRecordEvidence(prior)
    ? journalRecordByKey(prior, intentRecordKey(operationId))
    : prior.findLast(
        (candidate) =>
          candidate.event._tag === "TaskClaimReleaseIntended" &&
          candidate.event.operation.release.operationId === operationId
      )
  return intentCandidate?.event._tag === "TaskClaimReleaseIntended" &&
    intentCandidate.event.operation.release.operationId === operationId
    ? { ...intentCandidate, event: intentCandidate.event }
    : undefined
}

const validateCancellationReleaseOutcome = (
  record: JournalRecord,
  runId: RunId,
  records: JournalHistorySource,
  onInvalid: (detail: string) => void
): void => {
  if (record.event._tag !== "TaskClaimReleased") return
  const released = record.event
  const prior = priorRecords(records, record.position)
  const intent = cancellationReleaseIntentFor(prior, released.release.operationId)
  if (intent?.event.operation.authority._tag !== "CancelledAttemptClaimReleaseAuthority") return
  if (intent.runId !== runId || !isExactTaskClaim(intent.event.operation.release.claim, released.release.claim)) {
    onInvalid("cancelled-attempt claim release outcome contradicts its exact intent")
  }
  const authority = intent.event.operation.authority
  const abandoned = cancellationAbandonmentForRelease(prior, authority, record.position)
  if (abandoned === undefined) {
    onInvalid("cancelled-attempt claim release outcome requires its exact prior abandonment")
    return
  }
  if (
    priorCancellationClaimDisposition(prior, abandoned.position, released.release.claim, record.position) !== undefined
  ) {
    onInvalid("cancelled-attempt claim disposition is already terminal")
  }
}

/** Validates cancellation settlement facts before reconstruction or any retry. */
export const validateCancelledAttemptHistory = (
  record: JournalRecord,
  runId: RunId,
  records: JournalHistorySource,
  onInvalid: (detail: string) => void
): void => {
  validateNoForwardWorkAfterCancellation(record, runId, records, onInvalid)
  validateAbandonment(record, runId, records, onInvalid)
  validateNoRelease(record, runId, records, onInvalid)
  validateCancellationReleaseIntent(record, runId, records, onInvalid)
  validateCancellationReleaseOutcome(record, runId, records, onInvalid)
}

/** Validates every cancellation settlement event in one immutable journal prefix. */
export const validateCancelledAttemptHistoryPrefix = (
  runId: RunId,
  records: ReadonlyArray<JournalRecord>
): { readonly position: JournalPosition; readonly detail: string } | undefined => {
  for (const record of records) {
    let detail: string | undefined
    validateCancelledAttemptHistory(record, runId, records, (candidate) => {
      detail ??= candidate
    })
    if (detail !== undefined) return { detail, position: record.position }
  }
  return undefined
}
