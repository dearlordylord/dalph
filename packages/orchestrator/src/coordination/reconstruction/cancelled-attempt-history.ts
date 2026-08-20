/* eslint-disable max-lines -- Cancellation chronology, claim settlement, and proof provenance are one fail-closed boundary. */
import { plannedTaskAttemptEquivalence, type PlannedTaskAttempt, type RunId } from "@dalph/contracts"
import { isExactTaskClaim } from "../../authorities/task-tracker/claim-mutation.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { OperationId } from "../../workflow/identity.js"
import type { WorkflowJournalEvent } from "../../workflow/registry/event.js"
import type { CancelledAttemptTaskClaimReleaseOperation, WorkflowOperation } from "../../workflow/registry/operation.js"
import { authorizedClaimForAttempt } from "../../workflow/claim-authority-history.js"
import { recordedTaskAttemptPlanFor } from "../../workflow/protocols/task-attempt-planning/journal-evidence.js"
import {
  latestPlannedAttemptExecutorEvidence,
  plannedAttemptExecutorEvidence,
  type PlannedAttemptExecutorEvidence
} from "../../workflow/protocols/planned-attempt-executor-work/evidence.js"
import { taskTrackerObservationMatchesRead } from "../../workflow/task-tracker-facts/observation-match.js"
import { integrationResponsibilityEquivalence } from "../../workflow/protocols/integration-admission/responsibility.js"

type RelinquishedEvent = Extract<
  WorkflowJournalEvent,
  { readonly _tag: "CancelledAttemptImplementationResponsibilityRelinquished" }
>
type NoReleaseEvent = Extract<WorkflowJournalEvent, { readonly _tag: "CancelledAttemptClaimNoReleaseObserved" }>
type CancellationAppliedRecord = Omit<JournalRecord, "event"> & {
  readonly event: Extract<WorkflowJournalEvent, { readonly _tag: "RunCancellationApplied" }>
}
type ReleaseIntentEvent = Extract<WorkflowJournalEvent, { readonly _tag: "TaskClaimReleaseIntended" }>
type ClaimObservationRecord = Omit<JournalRecord, "event"> & {
  readonly event: Extract<WorkflowJournalEvent, { readonly _tag: "TaskTrackerFactsObserved" }>
}

const priorRecords = (records: ReadonlyArray<JournalRecord>, position: JournalPosition): ReadonlyArray<JournalRecord> =>
  records.filter((candidate) => candidate.position < position)

const exactCancellation = (
  records: ReadonlyArray<JournalRecord>,
  position: JournalPosition
): CancellationAppliedRecord | undefined =>
  records.find(
    (candidate): candidate is CancellationAppliedRecord =>
      candidate.position === position && candidate.event._tag === "RunCancellationApplied"
  )

const matchingRelinquishment = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  cancellationAppliedAt: JournalPosition,
  beforePosition: JournalPosition
): (JournalRecord & { readonly event: RelinquishedEvent }) | undefined =>
  records.findLast(
    (candidate): candidate is JournalRecord & { readonly event: RelinquishedEvent } =>
      candidate.position < beforePosition &&
      candidate.event._tag === "CancelledAttemptImplementationResponsibilityRelinquished" &&
      candidate.event.cancellationAppliedAt === cancellationAppliedAt &&
      plannedTaskAttemptEquivalence(candidate.event.plannedAttempt, plannedAttempt)
  )

const proofEvidenceFor = (
  proof: RelinquishedEvent["proof"],
  plannedAttempt: PlannedTaskAttempt,
  records: ReadonlyArray<JournalRecord>
): PlannedAttemptExecutorEvidence | undefined =>
  plannedAttemptExecutorEvidence(records, plannedAttempt).find((candidate) => {
    if (proof._tag === "CommandResponse") {
      return candidate.source._tag === "CommandResponse" && candidate.source.ordinal === proof.reportOrdinal
    }
    if (proof._tag === "CommandProjection") {
      return (
        candidate.source._tag === "CommandProjection" &&
        candidate.source.commandOrdinal === proof.commandOrdinal &&
        candidate.source.projectionOrdinal === proof.projectionOrdinal
      )
    }
    return candidate.source._tag === "StateProjection" && candidate.source.ordinal === proof.observationOrdinal
  })

const proofMatchesEvidence = (
  proof: RelinquishedEvent["proof"],
  plannedAttempt: PlannedTaskAttempt,
  records: ReadonlyArray<JournalRecord>
): boolean => {
  const evidence = proofEvidenceFor(proof, plannedAttempt, records)
  const latest = latestPlannedAttemptExecutorEvidence(records, plannedAttempt)
  if (
    evidence === undefined ||
    latest === undefined ||
    latest.observedAt !== evidence.observedAt ||
    (evidence.report._tag !== "Terminal" && evidence.report._tag !== "SafelySuspended")
  ) {
    return false
  }
  return !records.some(
    ({ event, position }) =>
      position > evidence.observedAt &&
      event._tag === "PlannedAttemptExecutorCommandIntended" &&
      event.plannedAttempt.runId === plannedAttempt.runId &&
      event.plannedAttempt.attemptId === plannedAttempt.attemptId
  )
}

const focusedClaimObservationRecord = (record: JournalRecord, taskId: PlannedTaskAttempt["taskId"]): boolean =>
  record.event._tag === "TaskTrackerFactsObserved" &&
  (record.event.observation._tag === "FocusedTaskClaimFacts" ||
    record.event.observation._tag === "FocusedTaskClaimFactsUnreadable") &&
  record.event.observation.coverage.taskId === taskId

const claimObservationRecordFor = (
  records: ReadonlyArray<JournalRecord>,
  operationId: OperationId,
  taskId: PlannedTaskAttempt["taskId"],
  after: JournalPosition,
  before: JournalPosition
): ClaimObservationRecord | undefined => {
  const observation = records.findLast(
    (candidate): candidate is ClaimObservationRecord =>
      candidate.position > after &&
      candidate.position < before &&
      candidate.event._tag === "TaskTrackerFactsObserved" &&
      candidate.event.operationId === operationId &&
      (candidate.event.observation._tag === "FocusedTaskClaimFacts" ||
        candidate.event.observation._tag === "FocusedTaskClaimFactsUnreadable") &&
      candidate.event.observation.coverage.taskId === taskId
  )
  if (
    observation === undefined ||
    records.some(
      (candidate) =>
        candidate.position > observation.position &&
        candidate.position < before &&
        focusedClaimObservationRecord(candidate, taskId)
    )
  ) {
    return undefined
  }
  return observation
}

const claimObservationIsExact = (
  record: ClaimObservationRecord | undefined,
  expectedClaim: RelinquishedEvent["authorizedClaim"]
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

type ClaimReadOperation = Extract<WorkflowOperation, { readonly _tag: "ReadTaskClaim" }>

const claimReadIntentFor = (
  records: ReadonlyArray<JournalRecord>,
  operationId: OperationId,
  taskId: PlannedTaskAttempt["taskId"],
  after: JournalPosition,
  before: JournalPosition
): ClaimReadOperation | undefined =>
  (() => {
    const intent = records.findLast(
      ({ event, position }) =>
        position > after &&
        position < before &&
        event._tag === "TaskTrackerReadIntentRecorded" &&
        event.operation._tag === "ReadTaskClaim" &&
        event.operation.operationId === operationId &&
        event.operation.taskId === taskId
    )
    if (intent?.event._tag !== "TaskTrackerReadIntentRecorded") return undefined
    return intent.event.operation._tag === "ReadTaskClaim" ? intent.event.operation : undefined
  })()

const cancellationRelinquishmentForRelease = (
  records: ReadonlyArray<JournalRecord>,
  authority: Extract<
    CancelledAttemptTaskClaimReleaseOperation["authority"],
    { readonly _tag: "CancelledAttemptClaimReleaseAuthority" }
  >,
  beforePosition: JournalPosition
): (JournalRecord & { readonly event: RelinquishedEvent }) | undefined =>
  records.find(
    (candidate): candidate is JournalRecord & { readonly event: RelinquishedEvent } =>
      candidate.position === authority.implementationRelinquishedAt &&
      candidate.position < beforePosition &&
      candidate.event._tag === "CancelledAttemptImplementationResponsibilityRelinquished" &&
      candidate.event.cancellationAppliedAt === authority.cancellationAppliedAt
  )

const priorCancellationClaimDisposition = (
  records: ReadonlyArray<JournalRecord>,
  relinquishedAt: JournalPosition,
  claim: RelinquishedEvent["authorizedClaim"],
  beforePosition: JournalPosition
): JournalRecord | undefined =>
  records.find(
    (candidate) =>
      candidate.position > relinquishedAt &&
      candidate.position < beforePosition &&
      ((candidate.event._tag === "CancelledAttemptClaimNoReleaseObserved" &&
        isExactTaskClaim(candidate.event.expectedClaim, claim)) ||
        (candidate.event._tag === "TaskClaimReleased" && isExactTaskClaim(candidate.event.release.claim, claim)))
  )

const priorCancellationReleaseIntent = (
  records: ReadonlyArray<JournalRecord>,
  relinquishedAt: JournalPosition,
  claim: RelinquishedEvent["authorizedClaim"],
  beforePosition: JournalPosition
): JournalRecord | undefined =>
  records.find(
    (candidate) =>
      candidate.position > relinquishedAt &&
      candidate.position < beforePosition &&
      candidate.event._tag === "TaskClaimReleaseIntended" &&
      candidate.event.operation.authority._tag === "CancelledAttemptClaimReleaseAuthority" &&
      isExactTaskClaim(candidate.event.operation.release.claim, claim)
  )

const claimBelongsToCancelledAttempt = (
  records: ReadonlyArray<JournalRecord>,
  runId: RunId,
  claim: RelinquishedEvent["authorizedClaim"],
  beforePosition: JournalPosition
): boolean => {
  const cancellation = records.findLast(
    (candidate) =>
      candidate.position < beforePosition &&
      candidate.runId === runId &&
      candidate.event._tag === "RunCancellationApplied"
  )
  if (cancellation === undefined) return false
  const prior = records.filter((candidate) => candidate.position < cancellation.position)
  const attempts = prior.flatMap((candidate) => {
    if (candidate.event._tag === "TaskAttemptPlanned") return [candidate.event.operation.plannedAttempt]
    if (candidate.event._tag === "PlannedAttemptReplaced") return [candidate.event.successorPlan.plannedAttempt]
    return []
  })
  return attempts.some((plannedAttempt) => {
    const executorBegan = prior.some(
      (candidate) =>
        candidate.event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
        plannedTaskAttemptEquivalence(candidate.event.plannedAttempt, plannedAttempt)
    )
    const authorized = authorizedClaimForAttempt(prior, plannedAttempt)?.claim
    return executorBegan && authorized !== undefined && isExactTaskClaim(authorized, claim)
  })
}

const postCancellationForwardWorkTags = new Set<WorkflowJournalEvent["_tag"]>([
  "TaskClaimAcquisitionIntended",
  "TaskClaimReacquisitionDirected",
  "TaskAttemptPlanned",
  "PlannedAttemptReplaced",
  "IntegrationResponsibilityBegan",
  "AttemptChoiceApplied"
])

const postCancellationClaimAcquisitionWork = (
  operationId: OperationId,
  eventTag: "TaskClaimAcquired" | "TaskClaimAcquisitionRejected",
  records: ReadonlyArray<JournalRecord>,
  cancellationAt: JournalPosition
): string | undefined =>
  claimAcquisitionWasIntendedBeforeCancellation(records, operationId, cancellationAt) ? undefined : eventTag

const postCancellationIntegrationWork = (
  record: JournalRecord,
  records: ReadonlyArray<JournalRecord>,
  cancellationAt: JournalPosition
): string | undefined =>
  integrationResponsibilityWasBeganBeforeCancellation(record, records, cancellationAt)
    ? undefined
    : "IntegrationStarted"

const claimAcquisitionWasIntendedBeforeCancellation = (
  records: ReadonlyArray<JournalRecord>,
  operationId: OperationId,
  cancellationAt: JournalPosition
): boolean =>
  records.some(
    ({ event, position }) =>
      position < cancellationAt &&
      event._tag === "TaskClaimAcquisitionIntended" &&
      event.operation.acquisition.operationId === operationId
  )

const integrationResponsibilityWasBeganBeforeCancellation = (
  record: JournalRecord,
  records: ReadonlyArray<JournalRecord>,
  cancellationAt: JournalPosition
): boolean => {
  const started = record.event
  if (started._tag !== "IntegrationStarted") return false
  return records.some((candidate) => {
    const began = candidate.event
    return (
      candidate.position < cancellationAt &&
      candidate.position < record.position &&
      candidate.position === started.responsibilityBeganAt &&
      began._tag === "IntegrationResponsibilityBegan" &&
      integrationResponsibilityEquivalence(began, started)
    )
  })
}

const postCancellationForwardWork = (
  record: JournalRecord,
  records: ReadonlyArray<JournalRecord>,
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
  if (event._tag === "PlannedAttemptExecutorCommandIntended" && event.command === "StartOrContinue") {
    return event._tag
  }
  return postCancellationForwardWorkTags.has(event._tag) ? event._tag : undefined
}

/** Cancellation closes forward admission; only settlement, reconciliation, cleanup, and reads may follow. */
const validateNoForwardWorkAfterCancellation = (
  record: JournalRecord,
  runId: RunId,
  records: ReadonlyArray<JournalRecord>,
  onInvalid: (detail: string) => void
): void => {
  if (record.runId !== runId) return
  const cancellation = records.findLast(
    (candidate) =>
      candidate.position < record.position &&
      candidate.runId === runId &&
      candidate.event._tag === "RunCancellationApplied"
  )
  if (cancellation === undefined) return
  const forbidden = postCancellationForwardWork(record, records, cancellation.position)
  if (forbidden !== undefined) {
    onInvalid(`post-cancellation history cannot record forward-work event ${forbidden}`)
  }
}

const validateRelinquishmentFoundations = (
  event: RelinquishedEvent,
  position: JournalPosition,
  runId: RunId,
  records: ReadonlyArray<JournalRecord>,
  prior: ReadonlyArray<JournalRecord>,
  onInvalid: (detail: string) => void
): CancellationAppliedRecord | undefined => {
  const cancellation = exactCancellation(records, event.cancellationAppliedAt)
  if (cancellation === undefined || cancellation.position >= position) {
    onInvalid("cancelled-attempt relinquishment requires its exact prior RunCancellationApplied position")
  } else if (cancellation.runId !== runId) {
    onInvalid("cancelled-attempt relinquishment names a cancellation from another Run")
  }
  if (event.plannedAttempt.runId !== runId) {
    onInvalid("cancelled-attempt relinquishment planned attempt binds another Run")
  }
  if (recordedTaskAttemptPlanFor(prior, event.plannedAttempt) === undefined) {
    onInvalid("cancelled-attempt relinquishment requires its exact prior planned attempt")
  }
  return cancellation
}

const validateRelinquishmentResponsibility = (
  event: RelinquishedEvent,
  cancellation: CancellationAppliedRecord | undefined,
  prior: ReadonlyArray<JournalRecord>,
  onInvalid: (detail: string) => void
): void => {
  const began = prior.find(
    (candidate) =>
      candidate.event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
      plannedTaskAttemptEquivalence(candidate.event.plannedAttempt, event.plannedAttempt)
  )
  if (began === undefined || (cancellation !== undefined && began.position >= cancellation.position)) {
    onInvalid("cancelled-attempt relinquishment requires prior executor-work responsibility")
  }
}

const validateRelinquishmentNotReplaced = (
  event: RelinquishedEvent,
  prior: ReadonlyArray<JournalRecord>,
  onInvalid: (detail: string) => void
): void => {
  if (
    prior.some(
      (candidate) =>
        candidate.event._tag === "PlannedAttemptReplaced" &&
        plannedTaskAttemptEquivalence(candidate.event.subject.plannedAttempt, event.plannedAttempt)
    )
  ) {
    onInvalid("cancelled-attempt relinquishment cannot follow replacement of the exact planned attempt")
  }
}

const validateRelinquishmentNotRepeated = (
  event: RelinquishedEvent,
  prior: ReadonlyArray<JournalRecord>,
  onInvalid: (detail: string) => void
): void => {
  if (
    prior.some(
      (candidate) =>
        candidate.event._tag === "CancelledAttemptImplementationResponsibilityRelinquished" &&
        plannedTaskAttemptEquivalence(candidate.event.plannedAttempt, event.plannedAttempt)
    )
  ) {
    onInvalid("cancelled-attempt implementation responsibility is already relinquished")
  }
}

const validateRelinquishmentClaim = (
  event: RelinquishedEvent,
  cancellation: CancellationAppliedRecord | undefined,
  records: ReadonlyArray<JournalRecord>,
  prior: ReadonlyArray<JournalRecord>,
  onInvalid: (detail: string) => void
): void => {
  const recordsThroughCancellation =
    cancellation === undefined ? prior : records.filter((candidate) => candidate.position <= cancellation.position)
  const authorized = authorizedClaimForAttempt(recordsThroughCancellation, event.plannedAttempt)?.claim
  if (authorized === undefined || !isExactTaskClaim(authorized, event.authorizedClaim)) {
    onInvalid("cancelled-attempt relinquishment requires the exact authorized claim")
  }
}

const validateRelinquishmentProof = (
  event: RelinquishedEvent,
  cancellation: CancellationAppliedRecord | undefined,
  prior: ReadonlyArray<JournalRecord>,
  onInvalid: (detail: string) => void
): void => {
  if (cancellation === undefined || !proofMatchesEvidence(event.proof, event.plannedAttempt, prior)) {
    onInvalid("cancelled-attempt relinquishment requires current safe or terminal executor evidence")
  }
}

const validateRelinquishment = (
  record: JournalRecord,
  runId: RunId,
  records: ReadonlyArray<JournalRecord>,
  onInvalid: (detail: string) => void
): void => {
  if (record.event._tag !== "CancelledAttemptImplementationResponsibilityRelinquished") return
  const event = record.event
  const prior = priorRecords(records, record.position)
  const cancellation = validateRelinquishmentFoundations(event, record.position, runId, records, prior, onInvalid)
  validateRelinquishmentResponsibility(event, cancellation, prior, onInvalid)
  validateRelinquishmentNotReplaced(event, prior, onInvalid)
  validateRelinquishmentNotRepeated(event, prior, onInvalid)
  validateRelinquishmentClaim(event, cancellation, records, prior, onInvalid)
  validateRelinquishmentProof(event, cancellation, prior, onInvalid)
}

const validateNoReleaseFoundations = (
  event: NoReleaseEvent,
  position: JournalPosition,
  runId: RunId,
  prior: ReadonlyArray<JournalRecord>,
  onInvalid: (detail: string) => void
): (JournalRecord & { readonly event: RelinquishedEvent }) | undefined => {
  if (event.plannedAttempt.runId !== runId) onInvalid("cancelled-attempt no-release binds another Run")
  const relinquished = matchingRelinquishment(prior, event.plannedAttempt, event.cancellationAppliedAt, position)
  if (relinquished === undefined) {
    onInvalid("cancelled-attempt no-release requires its exact prior implementation relinquishment")
    return undefined
  }
  if (!isExactTaskClaim(relinquished.event.authorizedClaim, event.expectedClaim)) {
    onInvalid("cancelled-attempt no-release contradicts its authorized claim")
  }
  return relinquished
}

const noReleaseObservationMatchesEvent = (
  expected: NoReleaseEvent["observation"],
  observed: NoReleaseEvent["observation"] | undefined
): boolean => {
  if (observed === undefined) return false
  if (observed._tag === "UnclaimedTask") {
    return expected._tag === "UnclaimedTask" && expected.taskId === observed.taskId
  }
  return expected._tag === "ActiveTaskClaim" && isExactTaskClaim(expected, observed)
}

const noReleaseObservationIsValid = (
  prior: ReadonlyArray<JournalRecord>,
  event: NoReleaseEvent,
  position: JournalPosition,
  relinquished: JournalRecord & { readonly event: RelinquishedEvent }
): boolean => {
  const observation = claimObservationRecordFor(
    prior,
    event.observationOperationId,
    event.plannedAttempt.taskId,
    relinquished.position,
    position
  )
  const readIntent =
    observation === undefined
      ? undefined
      : claimReadIntentFor(
          prior,
          event.observationOperationId,
          event.plannedAttempt.taskId,
          relinquished.position,
          observation.position
        )
  if (observation === undefined || readIntent === undefined) return false
  if (!readIntent.predecessorOperationIds.includes(relinquished.event.authorizedClaim.operationId)) return false
  if (!taskTrackerObservationMatchesRead(observation.event.observation, readIntent)) return false
  if (!claimObservationIsAbsentOrForeign(observation, event.expectedClaim)) return false
  const observedClaim =
    observation.event.observation._tag === "FocusedTaskClaimFacts"
      ? observation.event.observation.observation
      : undefined
  return noReleaseObservationMatchesEvent(event.observation, observedClaim)
}

const validateNoReleaseObservation = (
  prior: ReadonlyArray<JournalRecord>,
  event: NoReleaseEvent,
  position: JournalPosition,
  relinquished: JournalRecord & { readonly event: RelinquishedEvent },
  onInvalid: (detail: string) => void
): void => {
  if (!noReleaseObservationIsValid(prior, event, position, relinquished)) {
    onInvalid("cancelled-attempt no-release requires an exact absent or foreign focused claim observation")
  }
}

const validateNoReleaseDisposition = (
  prior: ReadonlyArray<JournalRecord>,
  event: NoReleaseEvent,
  position: JournalPosition,
  relinquished: JournalRecord & { readonly event: RelinquishedEvent },
  onInvalid: (detail: string) => void
): void => {
  if (
    priorCancellationClaimDisposition(prior, relinquished.position, event.expectedClaim, position) !== undefined ||
    priorCancellationReleaseIntent(prior, relinquished.position, event.expectedClaim, position) !== undefined
  ) {
    onInvalid("cancelled-attempt claim disposition is already terminal")
  }
}

const validateNoRelease = (
  record: JournalRecord,
  runId: RunId,
  records: ReadonlyArray<JournalRecord>,
  onInvalid: (detail: string) => void
): void => {
  if (record.event._tag !== "CancelledAttemptClaimNoReleaseObserved") return
  const event = record.event
  const prior = priorRecords(records, record.position)
  const relinquished = validateNoReleaseFoundations(event, record.position, runId, prior, onInvalid)
  if (relinquished === undefined) return
  validateNoReleaseObservation(prior, event, record.position, relinquished, onInvalid)
  validateNoReleaseDisposition(prior, event, record.position, relinquished, onInvalid)
}

const validateNonCancellationReleaseAuthority = (
  operation: ReleaseIntentEvent["operation"],
  runId: RunId,
  records: ReadonlyArray<JournalRecord>,
  position: JournalPosition,
  prior: ReadonlyArray<JournalRecord>,
  onInvalid: (detail: string) => void
): void => {
  const relinquished = prior.findLast(
    (candidate) =>
      candidate.event._tag === "CancelledAttemptImplementationResponsibilityRelinquished" &&
      isExactTaskClaim(candidate.event.authorizedClaim, operation.release.claim)
  )
  if (relinquished !== undefined || claimBelongsToCancelledAttempt(records, runId, operation.release.claim, position)) {
    onInvalid("cancelled-attempt claim release requires CancelledAttemptClaimReleaseAuthority")
  }
}

const cancellationReleaseRelinquishmentFor = (
  operation: ReleaseIntentEvent["operation"],
  authority: Extract<
    ReleaseIntentEvent["operation"]["authority"],
    { readonly _tag: "CancelledAttemptClaimReleaseAuthority" }
  >,
  runId: RunId,
  position: JournalPosition,
  prior: ReadonlyArray<JournalRecord>,
  onInvalid: (detail: string) => void
): (JournalRecord & { readonly event: RelinquishedEvent }) | undefined => {
  const cancellation = exactCancellation(prior, authority.cancellationAppliedAt)
  if (cancellation === undefined || cancellation.runId !== runId) {
    onInvalid("cancelled-attempt claim release requires its exact prior RunCancellationApplied")
  }
  const relinquished = cancellationRelinquishmentForRelease(prior, authority, position)
  if (relinquished === undefined) {
    onInvalid("cancelled-attempt claim release requires its exact prior implementation relinquishment")
    return undefined
  }
  if (!isExactTaskClaim(operation.release.claim, relinquished.event.authorizedClaim)) {
    onInvalid("cancelled-attempt claim release contradicts its authorized claim")
  }
  return relinquished
}

const cancellationReleaseObservationIsValid = (
  prior: ReadonlyArray<JournalRecord>,
  authority: Extract<
    ReleaseIntentEvent["operation"]["authority"],
    { readonly _tag: "CancelledAttemptClaimReleaseAuthority" }
  >,
  position: JournalPosition,
  relinquished: JournalRecord & { readonly event: RelinquishedEvent }
): boolean => {
  const observation = claimObservationRecordFor(
    prior,
    authority.observationOperationId,
    relinquished.event.plannedAttempt.taskId,
    relinquished.position,
    position
  )
  if (observation === undefined) return false
  const readIntent = claimReadIntentFor(
    prior,
    authority.observationOperationId,
    relinquished.event.plannedAttempt.taskId,
    relinquished.position,
    position
  )
  if (readIntent === undefined) return false
  if (!readIntent.predecessorOperationIds.includes(relinquished.event.authorizedClaim.operationId)) return false
  if (!taskTrackerObservationMatchesRead(observation.event.observation, readIntent)) return false
  return claimObservationIsExact(observation, relinquished.event.authorizedClaim)
}

const validateCancellationReleaseObservation = (
  prior: ReadonlyArray<JournalRecord>,
  authority: Extract<
    ReleaseIntentEvent["operation"]["authority"],
    { readonly _tag: "CancelledAttemptClaimReleaseAuthority" }
  >,
  position: JournalPosition,
  relinquished: JournalRecord & { readonly event: RelinquishedEvent },
  onInvalid: (detail: string) => void
): void => {
  if (!cancellationReleaseObservationIsValid(prior, authority, position, relinquished)) {
    onInvalid("cancelled-attempt claim release requires a fresh exact focused claim observation")
  }
}

const validateCancellationReleaseDisposition = (
  prior: ReadonlyArray<JournalRecord>,
  operation: ReleaseIntentEvent["operation"],
  position: JournalPosition,
  relinquished: JournalRecord & { readonly event: RelinquishedEvent },
  onInvalid: (detail: string) => void
): void => {
  if (
    priorCancellationClaimDisposition(prior, relinquished.position, operation.release.claim, position) !== undefined ||
    priorCancellationReleaseIntent(prior, relinquished.position, operation.release.claim, position) !== undefined
  ) {
    onInvalid("cancelled-attempt claim disposition is already terminal")
  }
}

const validateCancellationReleaseIntent = (
  record: JournalRecord,
  runId: RunId,
  records: ReadonlyArray<JournalRecord>,
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
  const relinquished = cancellationReleaseRelinquishmentFor(
    operation,
    authority,
    runId,
    record.position,
    prior,
    onInvalid
  )
  if (relinquished === undefined) {
    return
  }
  validateCancellationReleaseObservation(prior, authority, record.position, relinquished, onInvalid)
  validateCancellationReleaseDisposition(prior, operation, record.position, relinquished, onInvalid)
}

const validateCancellationReleaseOutcome = (
  record: JournalRecord,
  runId: RunId,
  records: ReadonlyArray<JournalRecord>,
  onInvalid: (detail: string) => void
): void => {
  if (record.event._tag !== "TaskClaimReleased") return
  const released = record.event
  const prior = priorRecords(records, record.position)
  const intent = prior.findLast((candidate): candidate is JournalRecord & { readonly event: ReleaseIntentEvent } => {
    const candidateEvent = candidate.event
    return (
      candidateEvent._tag === "TaskClaimReleaseIntended" &&
      candidateEvent.operation.release.operationId === released.release.operationId
    )
  })
  if (intent?.event.operation.authority._tag !== "CancelledAttemptClaimReleaseAuthority") return
  if (intent.runId !== runId || !isExactTaskClaim(intent.event.operation.release.claim, released.release.claim)) {
    onInvalid("cancelled-attempt claim release outcome contradicts its exact intent")
  }
  const authority = intent.event.operation.authority
  const relinquished = cancellationRelinquishmentForRelease(prior, authority, record.position)
  if (relinquished === undefined) {
    onInvalid("cancelled-attempt claim release outcome requires its exact prior relinquishment")
    return
  }
  if (
    priorCancellationClaimDisposition(prior, relinquished.position, released.release.claim, record.position) !==
    undefined
  ) {
    onInvalid("cancelled-attempt claim disposition is already terminal")
  }
}

/** Validates cancellation settlement facts before reconstruction or any retry. */
export const validateCancelledAttemptHistory = (
  record: JournalRecord,
  runId: RunId,
  records: ReadonlyArray<JournalRecord>,
  onInvalid: (detail: string) => void
): void => {
  validateNoForwardWorkAfterCancellation(record, runId, records, onInvalid)
  validateRelinquishment(record, runId, records, onInvalid)
  validateNoRelease(record, runId, records, onInvalid)
  validateCancellationReleaseIntent(record, runId, records, onInvalid)
  validateCancellationReleaseOutcome(record, runId, records, onInvalid)
}
