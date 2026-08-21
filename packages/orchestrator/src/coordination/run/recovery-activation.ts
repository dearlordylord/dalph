/* eslint-disable max-lines -- Exact history reconstruction spans every delivery authority boundary. */
import { Context, Effect, Match, Option, Schema } from "effect"
import {
  type IntegrationTarget,
  type PlannedTaskAttempt,
  plannedTaskAttemptEquivalence,
  RunId,
  type TaskId,
  plannedAttemptExecutorCorrelation
} from "@dalph/contracts"
import { describeJournalEvent } from "../../workflow/registry/event-descriptor.js"
import { InRunJournal, type JournalRecord } from "../../workflow-journal/store.js"
import { workflowJournalTransitionRuleFor } from "../reconstruction/history-transition.js"
import { reduceWorkflowJournalHistory } from "../reconstruction/history.js"
import { authorizedClaimForAttempt } from "./recovery-authority.js"
import {
  type ReconstructedPauseState,
  type ReconstructedRunState,
  reconstructedTaskIsPaused,
  workflowResponsibilityOperationId
} from "../reconstruction/state.js"
import type { PlannedAttemptExecutorDisposition, ResponsibilityFreshFacts } from "../frontier/fresh-facts.js"
import type { DeliveryProjectionEvidence } from "../frontier/delivery-projection-evidence.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import {
  deriveRunnableFrontier,
  FrontierExplanation,
  ResponsibilityDisposition,
  RunnableFrontierTransition,
  runnableTransitionTaskId,
  type RunnableFrontier
} from "../frontier/frontier.js"
import {
  latestReconstructedTaskGraph,
  reconstructedTaskGraphFromEvents,
  reconstructedTaskWorkSpecificationFor
} from "../reconstruction/graph-knowledge.js"
import {
  deriveIntegrationAdmission,
  type StartedIntegrationResponsibility
} from "../../workflow/protocols/integration-admission/protocol.js"
import { integrationResponsibilityEquivalence } from "../../workflow/protocols/integration-admission/responsibility.js"
import { deriveIntegrationFrontier, integrationDeliveryWaitsOf } from "../frontier/integration-frontier.js"
import { deriveIntegrationQuarantineState } from "../../workflow/protocols/integration-quarantine/state.js"
import {
  integratorCorrelationsEqual,
  integratorResponsibilityFactsEqual,
  integratorResponsibilityFactsFor,
  integratorResponsibilityFactsFromCorrelation
} from "../../workflow/protocols/integrator/state.js"
import { integratorRunStartedRecordKey, integratorSessionFixedRecordKey } from "../../workflow-journal/record-key.js"
import {
  type IntegrationTargetResourceSnapshot,
  type IntegrationTargetResourceController,
  makeIntegrationTargetResourceController
} from "../admission/integration-target-resource.js"
import { OperationId } from "../../workflow/identity.js"
import { isExactTaskClaim } from "../../authorities/task-tracker/claim-mutation.js"
import {
  latestTaskClaimReacquisitionDirection,
  taskClaimReacquisitionOperationId
} from "../../workflow/protocols/task-claim-reacquisition/plan.js"
import { targetPromotionRequestIdForCandidate } from "../../workflow/protocols/target-promotion/events.js"
import type { TargetPromotionRuntimeInput } from "../../workflow/protocols/target-promotion/runtime.js"
import {
  latestPlannedAttemptExecutorEvidence,
  latestPlannedAttemptExecutorProjectionIssue,
  latestUnsettledPlannedAttemptExecutorCommand
} from "../../workflow/protocols/planned-attempt-executor-work/evidence.js"
import {
  defaultPlannedAttemptExecutorSuspensionLimit,
  type PlannedAttemptExecutorCommandOrdinal,
  type PlannedAttemptExecutorCommandProjectionOrdinal,
  type PlannedAttemptExecutorReportOrdinal,
  type PlannedAttemptExecutorStateObservationOrdinal
} from "../../workflow/protocols/planned-attempt-executor-work/events.js"
import {
  AttemptQuiescenceProof,
  sameAttemptChoiceRequestId,
  sameAttemptChoiceSubject
} from "../../workflow/protocols/attempt-choice/events.js"
import {
  restartChoiceWasInvalidatedByLaterSpecification,
  restartClaimAuthorityAtApplication
} from "../../workflow/protocols/attempt-choice/restart-authority.js"
import {
  requiredPlannedAttemptPositionsOf,
  type RequiredPlannedAttemptPosition
} from "./required-planned-attempt-positions.js"
import {
  recordedTaskAttemptPlanFor,
  recordedTaskAttemptPlans
} from "../../workflow/protocols/task-attempt-planning/journal-evidence.js"

import {
  makeTaskClaimReleaseOperation,
  makeTaskClaimObservationOperation,
  makeTargetLineageObservationOperation,
  makeTaskWorktreeObservationOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTrackerGraphObservationOperation,
  TaskClaimReleaseAuthority
} from "../../workflow/registry/operation.js"
import { currentTaskClaimAuthority } from "../frontier/task-claim-authority.js"
import { decideTargetLineage } from "../../workflow/protocols/git-reconciliation/decision.js"
import type { TaskDagSnapshot } from "../../authorities/task-tracker/graph.js"
import { taskTrackerObservationMatchesRead } from "../../workflow/task-tracker-facts/observation-match.js"
export { deriveIntegrationFrontier } from "../frontier/integration-frontier.js"

const finalRecordOffset = -1

type AcquiredTaskClaim = Extract<JournalRecord["event"], { readonly _tag: "TaskClaimAcquired" }>["claim"]
type FocusedTaskClaim = Extract<
  Extract<JournalRecord["event"], { readonly _tag: "TaskTrackerFactsObserved" }>["observation"],
  { readonly _tag: "FocusedTaskClaimFacts" }
>["observation"]

const dispositionForFocusedClaim = (
  focusedClaim: FocusedTaskClaim,
  acquiredClaim: AcquiredTaskClaim
): PlannedAttemptExecutorDisposition | undefined => {
  if (focusedClaim._tag === "UnclaimedTask") return ResponsibilityDisposition.TaskClaimMissingConstraint()
  return isExactTaskClaim(focusedClaim, acquiredClaim)
    ? undefined
    : ResponsibilityDisposition.TaskForeignClaimIsolation()
}

const isRunPauseEvent = (event: JournalRecord["event"]): boolean =>
  event._tag === "ControlDirectionApplied" && event.direction === "Pause" && event.subject._tag === "Run"

type TaskPauseEvent = Extract<JournalRecord["event"], { readonly _tag: "ControlDirectionApplied" }> & {
  readonly direction: "Pause"
  readonly subject: Extract<
    Extract<JournalRecord["event"], { readonly _tag: "ControlDirectionApplied" }>["subject"],
    { readonly _tag: "Task" }
  >
}

const isTaskPauseEvent = (event: JournalRecord["event"]): event is TaskPauseEvent =>
  event._tag === "ControlDirectionApplied" && event.direction === "Pause" && event.subject._tag === "Task"

const isExecutorReportFor = (event: JournalRecord["event"], plannedAttempt: PlannedTaskAttempt): boolean =>
  event._tag === "PlannedAttemptExecutorWorkReported" &&
  event.report.correlation.runId === plannedAttempt.runId &&
  event.report.correlation.attemptId === plannedAttempt.attemptId

/** The Operator's Continue authority names the immutable plan and one exact changed authored fingerprint. */
const appliedContinueChoicePositionFor = (
  records: ReadonlyArray<Pick<JournalRecord, "event" | "position">>,
  plannedAttempt: PlannedTaskAttempt,
  observedTaskRevision?: PlannedTaskAttempt["taskRevision"]
): JournalPosition | undefined =>
  records.findLast(
    ({ event }) =>
      event._tag === "AttemptChoiceApplied" &&
      event.choice === "ContinueExistingAttempt" &&
      plannedTaskAttemptEquivalence(event.subject.plannedAttempt, plannedAttempt) &&
      (observedTaskRevision === undefined || event.subject.observedTaskRevision === observedTaskRevision)
  )?.position

type AppliedStopRecord = Omit<JournalRecord, "event"> & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "AttemptChoiceApplied" }> & {
    readonly choice: "StopTaskImplementation"
  }
}

const appliedStopChoiceFor = (records: ReadonlyArray<JournalRecord>, plannedAttempt: PlannedTaskAttempt) =>
  records.findLast(
    (record): record is AppliedStopRecord =>
      record.event._tag === "AttemptChoiceApplied" &&
      record.event.choice === "StopTaskImplementation" &&
      plannedTaskAttemptEquivalence(record.event.subject.plannedAttempt, plannedAttempt)
  )

const stopExecutorEventIsFor = (event: JournalRecord["event"], plannedAttempt: PlannedTaskAttempt): boolean =>
  (event._tag === "PlannedAttemptExecutorCommandIntended" ||
    event._tag === "PlannedAttemptExecutorCommandProjectionObserved" ||
    event._tag === "PlannedAttemptExecutorStateObserved") &&
  event.plannedAttempt.runId === plannedAttempt.runId &&
  event.plannedAttempt.attemptId === plannedAttempt.attemptId

const stopObservationIsContradictory = (event: JournalRecord["event"]): boolean =>
  (event._tag === "PlannedAttemptExecutorCommandProjectionObserved" ||
    event._tag === "PlannedAttemptExecutorStateObserved") &&
  event.observation._tag === "ExecutorReportContradiction"

const stopObservationIsRunning = (event: JournalRecord["event"]): boolean =>
  (event._tag === "PlannedAttemptExecutorCommandProjectionObserved" ||
    event._tag === "PlannedAttemptExecutorStateObserved") &&
  event.observation._tag === "ExactExecutorReport" &&
  event.observation.report._tag === "Running"

const stopObservationIsUnavailable = (event: JournalRecord["event"]): boolean =>
  (event._tag === "PlannedAttemptExecutorCommandProjectionObserved" ||
    event._tag === "PlannedAttemptExecutorStateObserved") &&
  (event.observation._tag === "ExecutorStateNoCurrentReport" ||
    event.observation._tag === "ExecutorStateTemporarilyUnavailable" ||
    event.observation._tag === "ExecutorStateUnreadable")

const stopWaitReasonFor = (
  event: JournalRecord["event"]
): Extract<PlannedAttemptExecutorDisposition, { readonly _tag: "AttemptStoppageWait" }>["reason"] => {
  if (stopObservationIsContradictory(event)) {
    return "ExecutorContradictory"
  }
  if (event._tag === "PlannedAttemptExecutorWorkReported" && event.report._tag === "Running") {
    return "ExecutorRunning"
  }
  if (stopObservationIsRunning(event)) {
    return "ExecutorRunning"
  }
  return "ExecutorUnavailable"
}

const stopQuiescenceIsProved = (records: ReadonlyArray<JournalRecord>, plannedAttempt: PlannedTaskAttempt): boolean => {
  const evidence = latestPlannedAttemptExecutorEvidence(records, plannedAttempt)
  /* v8 ignore start -- valid history admits an applied Stop only after an exact safe executor report, so its retained attempt always has evidence. */
  if (evidence === undefined) return false
  /* v8 ignore stop */
  const laterCommandExists = records.some(
    ({ event, position }) =>
      position > evidence.observedAt &&
      event._tag === "PlannedAttemptExecutorCommandIntended" &&
      event.plannedAttempt.runId === plannedAttempt.runId &&
      event.plannedAttempt.attemptId === plannedAttempt.attemptId
  )
  return (evidence.report._tag === "SafelySuspended" || evidence.report._tag === "Terminal") && !laterCommandExists
}

const latestStopExecutorRecordAfter = (
  records: ReadonlyArray<JournalRecord>,
  applied: AppliedStopRecord,
  plannedAttempt: PlannedTaskAttempt
) =>
  records.findLast(
    ({ event, position }) =>
      position > applied.position &&
      (stopExecutorEventIsFor(event, plannedAttempt) ||
        (event._tag === "PlannedAttemptExecutorWorkReported" &&
          event.report.correlation.runId === plannedAttempt.runId &&
          event.report.correlation.attemptId === plannedAttempt.attemptId))
  )

const pendingStopWaitDisposition = (
  latestStopExecutorRecord: JournalRecord | undefined,
  quiescenceIsAlreadyProved: boolean,
  activationBaselinePosition: Option.Option<JournalPosition>
): PlannedAttemptExecutorDisposition | undefined => {
  if (
    quiescenceIsAlreadyProved ||
    latestStopExecutorRecord === undefined ||
    !positionIsAfter(latestStopExecutorRecord.position, activationBaselinePosition)
  )
    return undefined
  return ResponsibilityDisposition.AttemptStoppageWait({ reason: stopWaitReasonFor(latestStopExecutorRecord.event) })
}

const pendingStoppedAttemptDisposition = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  applied: AppliedStopRecord,
  activationBaselinePosition: Option.Option<JournalPosition>
): PlannedAttemptExecutorDisposition => {
  const { requestId, subject } = applied.event
  const quiescenceIsAlreadyProved = stopQuiescenceIsProved(records, plannedAttempt)
  const wait = pendingStopWaitDisposition(
    latestStopExecutorRecordAfter(records, applied, plannedAttempt),
    quiescenceIsAlreadyProved,
    activationBaselinePosition
  )
  if (wait !== undefined) return wait
  if (!quiescenceIsAlreadyProved && latestUnsettledPlannedAttemptExecutorCommand(records, plannedAttempt)) {
    return ResponsibilityDisposition.AttemptStoppageRequired({ requestId, subject, taskWorkPosition: "ReserveOrReuse" })
  }
  const suspensionCommandCount = records.filter(
    ({ event, position }) =>
      position > applied.position &&
      event._tag === "PlannedAttemptExecutorCommandIntended" &&
      event.command === "Suspend" &&
      event.plannedAttempt.runId === plannedAttempt.runId &&
      event.plannedAttempt.attemptId === plannedAttempt.attemptId
  ).length
  if (!quiescenceIsAlreadyProved && suspensionCommandCount >= defaultPlannedAttemptExecutorSuspensionLimit) {
    return ResponsibilityDisposition.AttemptStoppageExecutorObservationRequired({ requestId, subject })
  }
  return ResponsibilityDisposition.AttemptStoppageRequired({
    requestId,
    subject,
    taskWorkPosition: quiescenceIsAlreadyProved ? "None" : "ReserveOrReuse"
  })
}

type AbandonmentRecord = Omit<JournalRecord, "event"> & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "AttemptImplementationAbandoned" }>
}

const settledStoppedAttemptDisposition = (
  records: ReadonlyArray<JournalRecord>,
  applied: AppliedStopRecord,
  abandonment: AbandonmentRecord
): PlannedAttemptExecutorDisposition | undefined => {
  const { requestId, subject } = applied.event
  const expectedClaim = abandonment.event.expectedClaim
  const noRelease = records.some(
    ({ event }) =>
      event._tag === "StoppedAttemptClaimNoReleaseObserved" &&
      sameAttemptChoiceRequestId(event.requestId, requestId) &&
      sameAttemptChoiceSubject(event.subject, subject)
  )
  if (noRelease) return ResponsibilityDisposition.StoppedAttemptSettled({ claimDisposition: "NoRelease" })
  const released = records.some(
    ({ event, position }) =>
      position > abandonment.position &&
      event._tag === "TaskClaimReleased" &&
      isExactTaskClaim(event.release.claim, expectedClaim)
  )
  if (released) return ResponsibilityDisposition.StoppedAttemptSettled({ claimDisposition: "Released" })
  return undefined
}

type StopReleaseIntentRecord = Omit<JournalRecord, "event"> & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "TaskClaimReleaseIntended" }>
}

type StopClaimObservationRecord = Omit<JournalRecord, "event"> & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "TaskTrackerFactsObserved" }> & {
    readonly observation: Extract<
      Extract<JournalRecord["event"], { readonly _tag: "TaskTrackerFactsObserved" }>["observation"],
      { readonly _tag: "FocusedTaskClaimFacts" | "FocusedTaskClaimFactsUnreadable" }
    >
  }
}

const requiredStopClaimObservationDisposition = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  applied: AppliedStopRecord,
  expectedClaim: AbandonmentRecord["event"]["expectedClaim"],
  observationBaseline: JournalPosition,
  releaseIntent: StopReleaseIntentRecord | undefined,
  claimObservation: StopClaimObservationRecord | undefined
): PlannedAttemptExecutorDisposition => {
  const target = continuationTarget(records)
  if (target === undefined) {
    return ResponsibilityDisposition.StoppedAttemptClaimPlanningWait({ reason: "TrackerTargetUnavailable" })
  }
  const after = claimObservation?.position ?? observationBaseline
  const releaseOperationId = releaseIntent?.event.operation.release.operationId
  return ResponsibilityDisposition.StoppedAttemptClaimObservationRequired({
    operation: makeTaskClaimObservationOperation(
      OperationId.make(`attempt-stop:${applied.event.requestId.nonce}:after:${after}:claim`),
      target,
      plannedAttempt.taskId,
      releaseOperationId === undefined ? [expectedClaim.operationId] : [expectedClaim.operationId, releaseOperationId]
    ),
    requestId: applied.event.requestId,
    subject: applied.event.subject
  })
}

const observedStoppedClaimDisposition = (
  applied: AppliedStopRecord,
  expectedClaim: AbandonmentRecord["event"]["expectedClaim"],
  releaseIntent: StopReleaseIntentRecord | undefined,
  claimObservation: StopClaimObservationRecord
): PlannedAttemptExecutorDisposition => {
  const { requestId, subject } = applied.event
  if (claimObservation.event.observation._tag === "FocusedTaskClaimFactsUnreadable") {
    return ResponsibilityDisposition.StoppedAttemptClaimUnreadableWait({
      observationOperationId: claimObservation.event.operationId
    })
  }
  const observation = claimObservation.event.observation.observation
  if (observation._tag !== "ActiveTaskClaim" || !isExactTaskClaim(observation, expectedClaim)) {
    return ResponsibilityDisposition.StoppedAttemptClaimNoReleaseRequired({
      observationOperationId: claimObservation.event.operationId,
      requestId,
      subject
    })
  }
  if (releaseIntent !== undefined) {
    /* v8 ignore start -- history rejects an abandoned-attempt release intent unless it carries this exact stopped-attempt authority. */
    if (releaseIntent.event.operation.authority._tag !== "StoppedAttemptClaimReleaseAuthority") {
      return ResponsibilityDisposition.StoppedAttemptClaimPlanningWait({ reason: "FocusedObservationContradiction" })
    }
    /* v8 ignore stop */
    return ResponsibilityDisposition.StoppedAttemptClaimReleaseRetryRequired({
      operation: { ...releaseIntent.event.operation, authority: releaseIntent.event.operation.authority },
      requestId,
      subject
    })
  }
  return ResponsibilityDisposition.StoppedAttemptClaimReleaseRequired({
    operation: makeTaskClaimReleaseOperation({
      authority: TaskClaimReleaseAuthority.cases.StoppedAttemptClaimReleaseAuthority.make({
        observationOperationId: claimObservation.event.operationId,
        requestId
      }),
      predecessorOperationIds: [expectedClaim.operationId, claimObservation.event.operationId],
      release: { claim: expectedClaim, operationId: OperationId.make(`attempt-stop:${requestId.nonce}:claim-release`) }
    }),
    requestId,
    subject
  })
}

const abandonedStoppedAttemptDisposition = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  applied: AppliedStopRecord,
  abandonment: AbandonmentRecord,
  activationBaselinePosition: Option.Option<JournalPosition>
): PlannedAttemptExecutorDisposition => {
  const settled = settledStoppedAttemptDisposition(records, applied, abandonment)
  if (settled !== undefined) return settled
  const expectedClaim = abandonment.event.expectedClaim
  const releaseIntent = records.findLast(
    (record): record is StopReleaseIntentRecord =>
      record.position > abandonment.position &&
      record.event._tag === "TaskClaimReleaseIntended" &&
      isExactTaskClaim(record.event.operation.release.claim, expectedClaim)
  )
  const observationBaseline = releaseIntent?.position ?? abandonment.position
  const claimObservation = records.findLast(
    (record): record is StopClaimObservationRecord =>
      record.position > observationBaseline &&
      record.event._tag === "TaskTrackerFactsObserved" &&
      (record.event.observation._tag === "FocusedTaskClaimFacts" ||
        record.event.observation._tag === "FocusedTaskClaimFactsUnreadable") &&
      record.event.observation.coverage.taskId === plannedAttempt.taskId
  )
  if (claimObservation === undefined || !positionIsAfter(claimObservation.position, activationBaselinePosition)) {
    return requiredStopClaimObservationDisposition(
      records,
      plannedAttempt,
      applied,
      expectedClaim,
      observationBaseline,
      releaseIntent,
      claimObservation
    )
  }
  return observedStoppedClaimDisposition(applied, expectedClaim, releaseIntent, claimObservation)
}

const stoppedAttemptDisposition = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  activationBaselinePosition: Option.Option<JournalPosition>
): PlannedAttemptExecutorDisposition | undefined => {
  const applied = appliedStopChoiceFor(records, plannedAttempt)
  if (applied === undefined) return undefined
  const abandonment = records.findLast(
    (record): record is AbandonmentRecord =>
      record.event._tag === "AttemptImplementationAbandoned" &&
      sameAttemptChoiceRequestId(record.event.requestId, applied.event.requestId) &&
      sameAttemptChoiceSubject(record.event.subject, applied.event.subject)
  )
  return abandonment === undefined
    ? pendingStoppedAttemptDisposition(records, plannedAttempt, applied, activationBaselinePosition)
    : abandonedStoppedAttemptDisposition(records, plannedAttempt, applied, abandonment, activationBaselinePosition)
}

type CancellationAppliedRecord = Omit<JournalRecord, "event"> & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "RunCancellationApplied" }>
}

type CancellationRelinquishedRecord = Omit<JournalRecord, "event"> & {
  readonly event: Extract<
    JournalRecord["event"],
    { readonly _tag: "CancelledAttemptImplementationResponsibilityRelinquished" }
  >
}

type CancellationNoReleaseRecord = Omit<JournalRecord, "event"> & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "CancelledAttemptClaimNoReleaseObserved" }>
}

type CancellationReleaseIntentRecord = Omit<JournalRecord, "event"> & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "TaskClaimReleaseIntended" }>
}

type CancellationClaimObservationRecord = Omit<JournalRecord, "event"> & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "TaskTrackerFactsObserved" }> & {
    readonly observation: Extract<
      Extract<JournalRecord["event"], { readonly _tag: "TaskTrackerFactsObserved" }>["observation"],
      { readonly _tag: "FocusedTaskClaimFacts" | "FocusedTaskClaimFactsUnreadable" }
    >
  }
}

const cancellationAppliedRecordFor = (records: ReadonlyArray<JournalRecord>): CancellationAppliedRecord | undefined =>
  records.findLast((record): record is CancellationAppliedRecord => record.event._tag === "RunCancellationApplied")

const cancellationRelinquishedRecordFor = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  cancellation: CancellationAppliedRecord
): CancellationRelinquishedRecord | undefined =>
  records.findLast(
    (record): record is CancellationRelinquishedRecord =>
      record.event._tag === "CancelledAttemptImplementationResponsibilityRelinquished" &&
      plannedTaskAttemptEquivalence(record.event.plannedAttempt, plannedAttempt) &&
      record.event.cancellationAppliedAt === cancellation.position
  )

const cancellationProofFor = (evidence: {
  readonly source:
    | { readonly _tag: "CommandResponse"; readonly ordinal: PlannedAttemptExecutorReportOrdinal }
    | {
        readonly _tag: "CommandProjection"
        readonly commandOrdinal: PlannedAttemptExecutorCommandOrdinal
        readonly projectionOrdinal: PlannedAttemptExecutorCommandProjectionOrdinal
      }
    | { readonly _tag: "StateProjection"; readonly ordinal: PlannedAttemptExecutorStateObservationOrdinal }
}): AttemptQuiescenceProof =>
  Match.valueTags(evidence.source, {
    CommandResponse: ({ ordinal }) => AttemptQuiescenceProof.cases.CommandResponse.make({ reportOrdinal: ordinal }),
    CommandProjection: ({ commandOrdinal, projectionOrdinal }) =>
      AttemptQuiescenceProof.cases.CommandProjection.make({ commandOrdinal, projectionOrdinal }),
    StateProjection: ({ ordinal }) => AttemptQuiescenceProof.cases.StateProjection.make({ observationOrdinal: ordinal })
  })

const cancellationQuiescenceEvidenceFor = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt
) => {
  const evidence = latestPlannedAttemptExecutorEvidence(records, plannedAttempt)
  if (evidence === undefined || (evidence.report._tag !== "SafelySuspended" && evidence.report._tag !== "Terminal")) {
    return undefined
  }
  const laterCommandExists = records.some(
    ({ event, position }) =>
      position > evidence.observedAt &&
      event._tag === "PlannedAttemptExecutorCommandIntended" &&
      plannedTaskAttemptEquivalence(event.plannedAttempt, plannedAttempt)
  )
  return laterCommandExists ? undefined : evidence
}

const cancellationClaimObservationFor = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  relinquished: CancellationRelinquishedRecord,
  releaseIntent: CancellationReleaseIntentRecord | undefined
): CancellationClaimObservationRecord | undefined => {
  const after = releaseIntent?.position ?? relinquished.position
  return records.findLast((record): record is CancellationClaimObservationRecord => {
    if (!isCancellationClaimObservationRecord(record, plannedAttempt, after)) return false
    return cancellationClaimObservationMatchesRead(records, record, plannedAttempt, relinquished, releaseIntent, after)
  })
}

const isCancellationClaimObservationRecord = (
  record: JournalRecord,
  plannedAttempt: PlannedTaskAttempt,
  after: JournalPosition
): record is CancellationClaimObservationRecord => {
  if (record.position <= after) return false
  const observation = record.event
  if (observation._tag !== "TaskTrackerFactsObserved") return false
  if (
    observation.observation._tag !== "FocusedTaskClaimFacts" &&
    observation.observation._tag !== "FocusedTaskClaimFactsUnreadable"
  )
    return false
  return observation.observation.coverage.taskId === plannedAttempt.taskId
}

const cancellationClaimReadIntentFor = (
  records: ReadonlyArray<JournalRecord>,
  observation: CancellationClaimObservationRecord,
  after: JournalPosition
): Extract<JournalRecord["event"], { readonly _tag: "TaskTrackerReadIntentRecorded" }>["operation"] | undefined => {
  const intent = records.findLast(
    (candidate) =>
      candidate.position > after &&
      candidate.position < observation.position &&
      candidate.event._tag === "TaskTrackerReadIntentRecorded" &&
      candidate.event.operation.operationId === observation.event.operationId
  )
  return intent?.event._tag === "TaskTrackerReadIntentRecorded" ? intent.event.operation : undefined
}

const cancellationClaimObservationMatchesRead = (
  records: ReadonlyArray<JournalRecord>,
  observation: CancellationClaimObservationRecord,
  plannedAttempt: PlannedTaskAttempt,
  relinquished: CancellationRelinquishedRecord,
  releaseIntent: CancellationReleaseIntentRecord | undefined,
  after: JournalPosition
): boolean => {
  const operation = cancellationClaimReadIntentFor(records, observation, after)
  if (operation === undefined || operation._tag !== "ReadTaskClaim") return false
  if (operation.taskId !== plannedAttempt.taskId) return false
  if (!operation.predecessorOperationIds.includes(relinquished.event.authorizedClaim.operationId)) return false
  if (
    releaseIntent !== undefined &&
    !operation.predecessorOperationIds.includes(releaseIntent.event.operation.release.operationId)
  )
    return false
  return taskTrackerObservationMatchesRead(observation.event.observation, operation)
}

const cancellationReleaseIntentFor = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  relinquished: CancellationRelinquishedRecord
): CancellationReleaseIntentRecord | undefined =>
  records.findLast(
    (record): record is CancellationReleaseIntentRecord =>
      record.position > relinquished.position &&
      record.event._tag === "TaskClaimReleaseIntended" &&
      isExactTaskClaim(record.event.operation.release.claim, relinquished.event.authorizedClaim) &&
      record.event.operation.authority._tag === "CancelledAttemptClaimReleaseAuthority" &&
      record.event.operation.authority.cancellationAppliedAt === relinquished.event.cancellationAppliedAt &&
      record.event.operation.authority.implementationRelinquishedAt === relinquished.position &&
      record.event.operation.release.claim.taskId === plannedAttempt.taskId
  )

const cancellationNoReleaseFor = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  relinquished: CancellationRelinquishedRecord
): CancellationNoReleaseRecord | undefined =>
  records.findLast(
    (record): record is CancellationNoReleaseRecord =>
      record.position > relinquished.position &&
      record.event._tag === "CancelledAttemptClaimNoReleaseObserved" &&
      plannedTaskAttemptEquivalence(record.event.plannedAttempt, plannedAttempt) &&
      record.event.cancellationAppliedAt === relinquished.event.cancellationAppliedAt &&
      isExactTaskClaim(record.event.expectedClaim, relinquished.event.authorizedClaim)
  )

const cancellationReleaseSettledFor = (
  records: ReadonlyArray<JournalRecord>,
  relinquished: CancellationRelinquishedRecord,
  releaseIntent: CancellationReleaseIntentRecord | undefined
): boolean =>
  releaseIntent !== undefined &&
  records.some(
    ({ event, position }) =>
      position > relinquished.position &&
      event._tag === "TaskClaimReleased" &&
      event.release.operationId === releaseIntent.event.operation.release.operationId &&
      isExactTaskClaim(event.release.claim, relinquished.event.authorizedClaim)
  )

const cancellationIntegrationAdmittedBefore = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  cancellation: CancellationAppliedRecord
): boolean =>
  records.some(
    ({ event, position }) =>
      position < cancellation.position &&
      ((event._tag === "IntegrationResponsibilityBegan" &&
        plannedTaskAttemptEquivalence(event.plannedAttempt, plannedAttempt)) ||
        (event._tag === "IntegrationStarted" && plannedTaskAttemptEquivalence(event.plannedAttempt, plannedAttempt)))
  )

const requiredCancelledAttemptClaimObservationDisposition = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  cancellation: CancellationAppliedRecord,
  relinquished: CancellationRelinquishedRecord,
  releaseIntent: CancellationReleaseIntentRecord | undefined,
  claimObservation: CancellationClaimObservationRecord | undefined
): PlannedAttemptExecutorDisposition => {
  const target = continuationTarget(records)
  if (target === undefined) {
    return ResponsibilityDisposition.CancelledAttemptClaimPlanningWait({ reason: "TrackerTargetUnavailable" })
  }
  const observationBaseline = releaseIntent?.position ?? relinquished.position
  const after = claimObservation?.position ?? observationBaseline
  const predecessorOperationIds = [
    relinquished.event.authorizedClaim.operationId,
    ...(releaseIntent === undefined ? [] : [releaseIntent.event.operation.release.operationId])
  ]
  return ResponsibilityDisposition.CancelledAttemptClaimObservationRequired({
    operation: makeTaskClaimObservationOperation(
      OperationId.make(
        `cancelled-attempt:${plannedAttempt.attemptId}:cancel:${cancellation.position}:after:${after}:claim`
      ),
      target,
      plannedAttempt.taskId,
      predecessorOperationIds
    ),
    plannedAttempt
  })
}

const cancelledAttemptClaimDisposition = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  cancellation: CancellationAppliedRecord,
  relinquished: CancellationRelinquishedRecord,
  activationBaselinePosition: Option.Option<JournalPosition>
): PlannedAttemptExecutorDisposition => {
  const noRelease = cancellationNoReleaseFor(records, plannedAttempt, relinquished)
  if (noRelease !== undefined)
    return ResponsibilityDisposition.CancelledAttemptSettled({ claimDisposition: "NoRelease" })
  const releaseIntent = cancellationReleaseIntentFor(records, plannedAttempt, relinquished)
  if (cancellationReleaseSettledFor(records, relinquished, releaseIntent)) {
    return ResponsibilityDisposition.CancelledAttemptSettled({ claimDisposition: "Released" })
  }
  const claimObservation = cancellationClaimObservationFor(records, plannedAttempt, relinquished, releaseIntent)
  return cancelledAttemptClaimObservationDisposition(
    records,
    plannedAttempt,
    cancellation,
    relinquished,
    activationBaselinePosition,
    releaseIntent,
    claimObservation
  )
}

const cancelledAttemptClaimObservationDisposition = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  cancellation: CancellationAppliedRecord,
  relinquished: CancellationRelinquishedRecord,
  activationBaselinePosition: Option.Option<JournalPosition>,
  releaseIntent: CancellationReleaseIntentRecord | undefined,
  claimObservation: CancellationClaimObservationRecord | undefined
): PlannedAttemptExecutorDisposition => {
  if (claimObservation === undefined || !positionIsAfter(claimObservation.position, activationBaselinePosition)) {
    return requiredCancelledAttemptClaimObservationDisposition(
      records,
      plannedAttempt,
      cancellation,
      relinquished,
      releaseIntent,
      claimObservation
    )
  }
  if (claimObservation.event.observation._tag === "FocusedTaskClaimFactsUnreadable") {
    return ResponsibilityDisposition.CancelledAttemptClaimUnreadableWait({
      observationOperationId: claimObservation.event.operationId
    })
  }
  const observation = claimObservation.event.observation.observation
  if (observation._tag !== "ActiveTaskClaim" || !isExactTaskClaim(observation, relinquished.event.authorizedClaim)) {
    return ResponsibilityDisposition.CancelledAttemptClaimNoReleaseRequired({
      observationOperationId: claimObservation.event.operationId,
      plannedAttempt
    })
  }
  if (releaseIntent !== undefined) {
    const authority = releaseIntent.event.operation.authority
    if (authority._tag !== "CancelledAttemptClaimReleaseAuthority") {
      return ResponsibilityDisposition.CancelledAttemptClaimPlanningWait({ reason: "FocusedObservationContradiction" })
    }
    return ResponsibilityDisposition.CancelledAttemptClaimReleaseRetryRequired({
      operation: {
        ...releaseIntent.event.operation,
        authority: TaskClaimReleaseAuthority.cases.CancelledAttemptClaimReleaseAuthority.make({
          cancellationAppliedAt: authority.cancellationAppliedAt,
          implementationRelinquishedAt: authority.implementationRelinquishedAt,
          observationOperationId: authority.observationOperationId
        })
      },
      plannedAttempt
    })
  }
  return ResponsibilityDisposition.CancelledAttemptClaimReleaseRequired({
    operation: makeTaskClaimReleaseOperation({
      authority: TaskClaimReleaseAuthority.cases.CancelledAttemptClaimReleaseAuthority.make({
        cancellationAppliedAt: cancellation.position,
        implementationRelinquishedAt: relinquished.position,
        observationOperationId: claimObservation.event.operationId
      }),
      predecessorOperationIds: [relinquished.event.authorizedClaim.operationId, claimObservation.event.operationId],
      release: {
        claim: relinquished.event.authorizedClaim,
        operationId: OperationId.make(`cancelled-attempt:${plannedAttempt.attemptId}:claim-release`)
      }
    }),
    plannedAttempt
  })
}

const cancelledAttemptDisposition = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  activationBaselinePosition: Option.Option<JournalPosition>
): PlannedAttemptExecutorDisposition | undefined => {
  const cancellation = cancellationAppliedRecordFor(records)
  if (cancellation === undefined || cancellationIntegrationAdmittedBefore(records, plannedAttempt, cancellation)) {
    return undefined
  }
  const quiescence = cancellationQuiescenceEvidenceFor(records, plannedAttempt)
  if (quiescence === undefined) return ResponsibilityDisposition.PlannedAttemptExecutorSuspensionRequested()
  const relinquished = cancellationRelinquishedRecordFor(records, plannedAttempt, cancellation)
  if (relinquished === undefined) {
    return ResponsibilityDisposition.CancelledAttemptRelinquishmentRequired({
      plannedAttempt,
      proof: cancellationProofFor(quiescence)
    })
  }
  return cancelledAttemptClaimDisposition(
    records,
    plannedAttempt,
    cancellation,
    relinquished,
    activationBaselinePosition
  )
}

type AppliedRestartRecord = Omit<JournalRecord, "event"> & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "AttemptChoiceApplied" }> & {
    readonly choice: "RestartTaskImplementation"
  }
}

type AppliedChoiceRecord = Omit<JournalRecord, "event"> & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "AttemptChoiceApplied" }>
}

const appliedRestartChoiceFor = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt
): AppliedRestartRecord | undefined => {
  const latest = records.findLast(
    (record): record is AppliedChoiceRecord =>
      record.event._tag === "AttemptChoiceApplied" &&
      plannedTaskAttemptEquivalence(record.event.subject.plannedAttempt, plannedAttempt)
  )
  return latest?.event.choice === "RestartTaskImplementation"
    ? { ...latest, event: { ...latest.event, choice: "RestartTaskImplementation" } }
    : undefined
}

type RestartObservationScope = (record: JournalRecord) => boolean

const terminalRestartDisposition = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt
): PlannedAttemptExecutorDisposition | undefined => {
  const evidence = latestPlannedAttemptExecutorEvidence(records, plannedAttempt)
  if (evidence?.report._tag !== "Terminal") return undefined
  if (evidence.report.result._tag === "Completed") {
    return ResponsibilityDisposition.AttemptRestartRejected({ reason: "CompletedDoesNotAuthorizeReplacement" })
  }
  return evidence.report.result._tag === "Failed"
    ? ResponsibilityDisposition.AttemptRestartRejected({ reason: "FailedDoesNotAuthorizeReplacement" })
    : undefined
}

const changedRestartSpecificationDisposition = (
  records: ReadonlyArray<JournalRecord>,
  applied: AppliedRestartRecord
): PlannedAttemptExecutorDisposition | undefined => {
  return restartChoiceWasInvalidatedByLaterSpecification(records, applied.position, applied.event.subject)
    ? ResponsibilityDisposition.AttemptRestartRejected({ reason: "NewFingerprintChoiceRequired" })
    : undefined
}

const restartGraphDisposition = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  afterActivation: RestartObservationScope
): PlannedAttemptExecutorDisposition | undefined => {
  const currentGraphRecord = records.findLast((record) => {
    if (
      !afterActivation(record) ||
      record.event._tag !== "TaskTrackerFactsObserved" ||
      (record.event.observation._tag !== "CompleteTaskTrackerFacts" &&
        record.event.observation._tag !== "UnchangedTaskTrackerFactsReconfirmed")
    ) {
      return false
    }
    const operationId = record.event.operationId
    return records.some(
      ({ event, position }) =>
        position < record.position &&
        event._tag === "TaskTrackerReadIntentRecorded" &&
        event.operation._tag === "ReadTrackerGraph" &&
        event.operation.operationId === operationId &&
        event.operation.readShape.explicitlyCoveredTaskIds.includes(plannedAttempt.taskId)
    )
  })
  if (currentGraphRecord?.event._tag !== "TaskTrackerFactsObserved") return undefined
  const graph = reconstructedTaskGraphFromEvents(
    records.filter(({ position }) => position <= currentGraphRecord.position).map(({ event }) => event),
    currentGraphRecord.event.observation.target
  )
  return Option.exists(graph, (snapshot) => !snapshot.eligibleTasks().some(({ id }) => id === plannedAttempt.taskId))
    ? ResponsibilityDisposition.AttemptRestartWait({ reason: "TaskNotEligible" })
    : undefined
}

const latestRestartClaimObservation = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  afterActivation: RestartObservationScope
): JournalRecord | undefined =>
  records.findLast(
    (record) =>
      afterActivation(record) &&
      record.event._tag === "TaskTrackerFactsObserved" &&
      (record.event.observation._tag === "FocusedTaskClaimFacts" ||
        record.event.observation._tag === "FocusedTaskClaimFactsUnreadable") &&
      record.event.observation.coverage.taskId === plannedAttempt.taskId
  )

const activeRestartClaimDisposition = (
  records: ReadonlyArray<JournalRecord>,
  applied: AppliedRestartRecord,
  observation: Extract<FocusedTaskClaim, { readonly _tag: "ActiveTaskClaim" }>
): PlannedAttemptExecutorDisposition | undefined => {
  const expected = restartClaimAuthorityAtApplication(records, applied)?.claim
  return expected === undefined || !isExactTaskClaim(observation, expected)
    ? ResponsibilityDisposition.AttemptRestartWait({ reason: "ClaimForeign" })
    : undefined
}

const restartClaimDisposition = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  applied: AppliedRestartRecord,
  afterActivation: RestartObservationScope
): PlannedAttemptExecutorDisposition | undefined => {
  const claim = latestRestartClaimObservation(records, plannedAttempt, afterActivation)
  if (claim?.event._tag !== "TaskTrackerFactsObserved") return undefined
  if (claim.event.observation._tag === "FocusedTaskClaimFactsUnreadable") {
    return ResponsibilityDisposition.AttemptRestartWait({ reason: "ClaimUnreadable" })
  }
  /* v8 ignore next -- @preserve latestRestartClaimObservation selects only focused readable or focused unreadable claim observations. */
  if (claim.event.observation._tag !== "FocusedTaskClaimFacts") return undefined
  const observation = claim.event.observation.observation
  if (observation._tag === "UnclaimedTask") {
    return ResponsibilityDisposition.AttemptRestartWait({ reason: "ClaimAbsent" })
  }
  return activeRestartClaimDisposition(records, applied, observation)
}

const restartWorktreeDisposition = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  afterActivation: RestartObservationScope
): PlannedAttemptExecutorDisposition | undefined => {
  const worktree = records.findLast((record) => {
    if (!afterActivation(record) || record.event._tag !== "PlannedAttemptWorktreeObserved") return false
    const operationId = record.event.operationId
    return records.some(
      ({ event, position }) =>
        position < record.position &&
        event._tag === "GitReadIntentRecorded" &&
        event.operation._tag === "ReadTaskWorktree" &&
        event.operation.operationId === operationId &&
        plannedTaskAttemptEquivalence(event.operation.plannedAttempt, plannedAttempt)
    )
  })
  return worktree?.event._tag === "PlannedAttemptWorktreeObserved" &&
    worktree.event.observation._tag !== "PlannedWorktreeReady"
    ? ResponsibilityDisposition.AttemptRestartWait({ reason: "OldWorktreeNotReady" })
    : undefined
}

const restartExecutorIsRunning = (event: JournalRecord["event"]): boolean =>
  stopObservationIsRunning(event) ||
  (event._tag === "PlannedAttemptExecutorWorkReported" && event.report._tag === "Running")

const restartExecutorDisposition = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  afterActivation: RestartObservationScope
): PlannedAttemptExecutorDisposition | undefined => {
  const latestExecutor = records.findLast(
    (record) =>
      afterActivation(record) &&
      (stopExecutorEventIsFor(record.event, plannedAttempt) || isExecutorReportFor(record.event, plannedAttempt))
  )
  if (latestExecutor === undefined) return undefined
  if (stopObservationIsContradictory(latestExecutor.event)) {
    return ResponsibilityDisposition.AttemptRestartWait({ reason: "ExecutorContradictory" })
  }
  if (stopObservationIsUnavailable(latestExecutor.event)) {
    return ResponsibilityDisposition.AttemptRestartWait({ reason: "ExecutorUnavailable" })
  }
  return restartExecutorIsRunning(latestExecutor.event)
    ? ResponsibilityDisposition.AttemptRestartWait({ reason: "ExecutorRunning" })
    : undefined
}

const restartAuthorityReadFailureDisposition = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  afterActivation: RestartObservationScope
): PlannedAttemptExecutorDisposition | undefined => {
  const failure = records.findLast(
    (record) =>
      afterActivation(record) &&
      record.event._tag === "AttemptRestartAuthorityReadFailed" &&
      plannedTaskAttemptEquivalence(record.event.subject.plannedAttempt, plannedAttempt)
  )?.event
  if (failure?._tag !== "AttemptRestartAuthorityReadFailed") return undefined
  return ResponsibilityDisposition.AttemptRestartWait({
    reason:
      failure.failure._tag === "AttemptRestartTaskFactsReadFailure"
        ? "TaskFactsUnreadable"
        : failure.failure._tag === "GitWorktreeReadFailure"
          ? "OldWorktreeUnreadable"
          : "TargetHeadUnreadable"
  })
}

export const restartReplacementDisposition = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt,
  activationBaselinePosition: Option.Option<JournalPosition>,
  integrationTarget: Option.Option<IntegrationTarget>
): PlannedAttemptExecutorDisposition | undefined => {
  const applied = appliedRestartChoiceFor(records, plannedAttempt)
  if (applied === undefined) return undefined
  const replaced = records.some(
    ({ event }) =>
      event._tag === "PlannedAttemptReplaced" &&
      plannedTaskAttemptEquivalence(event.subject.plannedAttempt, plannedAttempt)
  )
  if (replaced) return undefined
  const afterActivation = ({ position }: JournalRecord): boolean =>
    position > applied.position && positionIsAfter(position, activationBaselinePosition)
  const observedDisposition = [
    terminalRestartDisposition(records, plannedAttempt),
    changedRestartSpecificationDisposition(records, applied),
    restartGraphDisposition(records, plannedAttempt, afterActivation),
    restartClaimDisposition(records, plannedAttempt, applied, afterActivation),
    restartWorktreeDisposition(records, plannedAttempt, afterActivation),
    restartAuthorityReadFailureDisposition(records, plannedAttempt, afterActivation),
    restartExecutorDisposition(records, plannedAttempt, afterActivation)
  ].find((disposition) => disposition !== undefined)
  if (observedDisposition !== undefined) return observedDisposition
  return Option.match(integrationTarget, {
    onNone: () => ResponsibilityDisposition.AttemptRestartWait({ reason: "IntegrationTargetUnavailable" }),
    onSome: (target) =>
      ResponsibilityDisposition.AttemptRestartRequired({
        integrationTarget: target,
        requestId: applied.event.requestId,
        subject: applied.event.subject
      })
  })
}

const suspensionIsOwedAfterBoundary = (
  records: ReadonlyArray<Pick<JournalRecord, "event" | "position">>,
  plannedAttempt: PlannedTaskAttempt,
  beganAt: JournalPosition,
  boundaryPosition: JournalPosition
): boolean => {
  if (boundaryPosition <= beganAt) return false
  const latestReportBeforeBoundary = records.findLast(
    ({ event, position }) => position < boundaryPosition && isExecutorReportFor(event, plannedAttempt)
  )?.event
  const wasRunningOrCrossingStartBoundary =
    latestReportBeforeBoundary === undefined ||
    (latestReportBeforeBoundary._tag === "PlannedAttemptExecutorWorkReported" &&
      latestReportBeforeBoundary.report._tag === "Running")
  const settledAfterBoundary = records.some(
    ({ event, position }) => position > boundaryPosition && isSuspensionSettlementFor(event, plannedAttempt)
  )
  return wasRunningOrCrossingStartBoundary && !settledAfterBoundary
}

const suspensionWasOwedAfterPause = (
  records: ReadonlyArray<Pick<JournalRecord, "event" | "position">>,
  plannedAttempt: PlannedTaskAttempt,
  beganAt: JournalPosition,
  isApplicablePause: (event: JournalRecord["event"]) => boolean
): boolean =>
  records.some(
    ({ event, position }) =>
      isApplicablePause(event) && suspensionIsOwedAfterBoundary(records, plannedAttempt, beganAt, position)
  )

const taskPauseCoversAttempt = (
  event: JournalRecord["event"],
  plannedAttempt: PlannedTaskAttempt,
  currentGraph: TaskDagSnapshot | undefined
): boolean =>
  isTaskPauseEvent(event) &&
  reconstructedTaskIsPaused(
    { run: { _tag: "RunUnpaused" }, tasks: { _tag: "TaskPauses", taskIds: [event.subject.taskId] } },
    plannedAttempt.taskId,
    currentGraph
  )

const isMatchingTaskUnpause = (event: JournalRecord["event"], pause: TaskPauseEvent): boolean =>
  event._tag === "ControlDirectionApplied" &&
  event.direction === "Unpause" &&
  event.subject._tag === "Task" &&
  event.subject.runId === pause.subject.runId &&
  event.subject.taskId === pause.subject.taskId

type GraphObservationRecord = Pick<JournalRecord, "position"> & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "TaskTrackerFactsObserved" }>
}

const isGraphObservationRecord = (
  record: Pick<JournalRecord, "event" | "position">
): record is GraphObservationRecord =>
  record.event._tag === "TaskTrackerFactsObserved" &&
  (record.event.observation._tag === "CompleteTaskTrackerFacts" ||
    record.event.observation._tag === "UnchangedTaskTrackerFactsReconfirmed")

const reconstructedGraphsByHistory = new WeakMap<
  ReadonlyArray<Pick<JournalRecord, "event" | "position">>,
  Map<JournalPosition, TaskDagSnapshot | undefined>
>()

type PauseCoverageHistoryIndex = {
  readonly graphObservations: ReadonlyArray<GraphObservationRecord>
  readonly taskUnpausePositions: Map<JournalPosition, JournalPosition | undefined>
}

const pauseCoverageHistoryIndexes = new WeakMap<
  ReadonlyArray<Pick<JournalRecord, "event" | "position">>,
  PauseCoverageHistoryIndex
>()

const pauseCoverageHistoryIndexFor = (
  records: ReadonlyArray<Pick<JournalRecord, "event" | "position">>
): PauseCoverageHistoryIndex => {
  const cached = pauseCoverageHistoryIndexes.get(records)
  if (cached !== undefined) return cached
  const index = {
    graphObservations: records.filter(isGraphObservationRecord),
    taskUnpausePositions: new Map<JournalPosition, JournalPosition | undefined>()
  }
  pauseCoverageHistoryIndexes.set(records, index)
  return index
}

const taskUnpausePositionFor = (
  records: ReadonlyArray<Pick<JournalRecord, "event" | "position">>,
  index: PauseCoverageHistoryIndex,
  pause: TaskPauseEvent,
  pausePosition: JournalPosition
): JournalPosition | undefined => {
  if (index.taskUnpausePositions.has(pausePosition)) return index.taskUnpausePositions.get(pausePosition)
  const unpausePosition = records.find(
    ({ event, position }) => position > pausePosition && isMatchingTaskUnpause(event, pause)
  )?.position
  // eslint-disable-next-line functional/immutable-data -- This process-local index is intentionally populated lazily.
  index.taskUnpausePositions.set(pausePosition, unpausePosition)
  return unpausePosition
}

const graphReconstructedAt = (
  records: ReadonlyArray<Pick<JournalRecord, "event" | "position">>,
  graphObservation: GraphObservationRecord
): TaskDagSnapshot | undefined => {
  const cachedByPosition = reconstructedGraphsByHistory.get(records)
  if (cachedByPosition?.has(graphObservation.position) === true) {
    return cachedByPosition.get(graphObservation.position)
  }
  const graph = Option.getOrUndefined(
    reconstructedTaskGraphFromEvents(
      records.filter(({ position }) => position <= graphObservation.position).map(({ event }) => event),
      graphObservation.event.observation.target
    )
  )
  const cache = cachedByPosition ?? new Map<JournalPosition, TaskDagSnapshot | undefined>()
  // eslint-disable-next-line functional/immutable-data -- This process-local index is intentionally populated lazily.
  cache.set(graphObservation.position, graph)
  reconstructedGraphsByHistory.set(records, cache)
  return graph
}

const taskPauseCoverageBoundaries = (
  records: ReadonlyArray<Pick<JournalRecord, "event" | "position">>,
  pause: TaskPauseEvent,
  pausePosition: JournalPosition,
  plannedAttempt: PlannedTaskAttempt,
  currentGraph: TaskDagSnapshot | undefined
): ReadonlyArray<JournalPosition> => {
  if (pause.subject.taskId === plannedAttempt.taskId) return [pausePosition]
  const historyIndex = pauseCoverageHistoryIndexFor(records)
  const unpausePosition = taskUnpausePositionFor(records, historyIndex, pause, pausePosition)
  const graphObservations = historyIndex.graphObservations.filter(
    ({ position }) =>
      position < pausePosition ||
      (position > pausePosition && (unpausePosition === undefined || position < unpausePosition))
  )
  const graphBeforePause = graphObservations.findLast(({ position }) => position < pausePosition)
  const graphsWhilePaused = graphObservations.filter(({ position }) => position > pausePosition)
  const observedGraphs = [
    ...(graphBeforePause === undefined ? [] : [{ boundary: pausePosition, observation: graphBeforePause }]),
    ...graphsWhilePaused.map((observation) => ({ boundary: observation.position, observation }))
  ].flatMap(({ boundary, observation }) => {
    const graph = graphReconstructedAt(records, observation)
    return graph === undefined ? [] : [{ boundary, graph }]
  })
  if (observedGraphs.length === 0) {
    return unpausePosition === undefined && taskPauseCoversAttempt(pause, plannedAttempt, currentGraph)
      ? [pausePosition]
      : []
  }
  let covered = false
  return observedGraphs.flatMap(({ boundary, graph }) => {
    const nowCovered = taskPauseCoversAttempt(pause, plannedAttempt, graph)
    const newlyCovered = nowCovered && !covered
    covered = nowCovered
    return newlyCovered ? [boundary] : []
  })
}

/** A covered running attempt still owes the exact suspension requested by an applied task Pause. */
export const taskPauseSuspensionIsOwed = (
  records: ReadonlyArray<Pick<JournalRecord, "event" | "position">>,
  plannedAttempt: PlannedTaskAttempt,
  beganAt: JournalPosition,
  currentGraph: TaskDagSnapshot | undefined
): boolean =>
  records.some(
    ({ event, position }) =>
      isTaskPauseEvent(event) &&
      taskPauseCoverageBoundaries(records, event, position, plannedAttempt, currentGraph).some((boundary) =>
        suspensionIsOwedAfterBoundary(records, plannedAttempt, beganAt, boundary)
      )
  )

const reportSettlesSuspensionFor = (
  report: Extract<JournalRecord["event"], { readonly _tag: "PlannedAttemptExecutorWorkReported" }>["report"],
  plannedAttempt: PlannedTaskAttempt
): boolean => {
  const expected = plannedAttemptExecutorCorrelation(plannedAttempt)
  return (
    report.correlation.runId === expected.runId &&
    report.correlation.attemptId === expected.attemptId &&
    (report._tag === "SafelySuspended" || report._tag === "Terminal")
  )
}

const isSuspensionSettlementFor = (event: JournalRecord["event"], plannedAttempt: PlannedTaskAttempt): boolean => {
  if (event._tag === "PlannedAttemptExecutorWorkReported") {
    return reportSettlesSuspensionFor(event.report, plannedAttempt)
  }
  return (
    event._tag === "PlannedAttemptExecutorCommandProjectionObserved" &&
    event.observation._tag === "ExactExecutorReport" &&
    reportSettlesSuspensionFor(event.observation.report, plannedAttempt)
  )
}

type ReconstructedResponsibility = ReconstructedRunState["responsibility"]["entries"][number]
type WorkflowOperationResponsibility = Exclude<
  ReconstructedResponsibility,
  { readonly _tag: "PlannedAttemptExecutorWorkResponsibility" }
>

/** Derives which journaled responsibilities are still unfinished. */
export const deriveJournalResponsibilityFacts = (
  runState: ReconstructedRunState,
  activationBaselinePosition: Option.Option<JournalPosition> = Option.none(),
  integrationTarget: Option.Option<IntegrationTarget> = Option.none()
): ReadonlyArray<ResponsibilityFreshFacts> => {
  const records = runState.workflowHistory.records
  const latestTaskGraph = latestReconstructedTaskGraph(runState.graphKnowledge)
  const currentTaskGraph = Option.getOrUndefined(latestTaskGraph)
  const freshnessBaselineForTask = (taskId: TaskId) =>
    continuationFreshnessBaselineForTask(runState, activationBaselinePosition, taskId, currentTaskGraph)
  const freshnessBaselineForAttempt = (plannedAttempt: PlannedTaskAttempt) =>
    continuationFreshnessBaselineForAttempt(runState, activationBaselinePosition, plannedAttempt, currentTaskGraph)
  const taskLeftMembership = (taskId: TaskId): boolean =>
    Option.isSome(latestTaskGraph) && !latestTaskGraph.value.taskIds().includes(taskId)
  const taskTerminalWithoutSuccess = (taskId: TaskId): boolean =>
    Option.getOrUndefined(Option.flatMap(latestTaskGraph, (graph) => graph.lifecycleOf(taskId)))?._tag ===
    "TerminalWithoutSuccess"
  const taskCompletedSuccessfully = (taskId: TaskId): boolean =>
    Option.getOrUndefined(Option.flatMap(latestTaskGraph, (graph) => graph.lifecycleOf(taskId)))?._tag ===
    "CompletedSuccessfully"
  const changedTaskSpecification = (plannedAttempt: PlannedTaskAttempt) =>
    Option.filter(
      reconstructedTaskWorkSpecificationFor(runState.graphKnowledge, plannedAttempt.taskId),
      ({ fingerprint }) => fingerprint !== plannedAttempt.taskRevision
    )
  const settledOperationIds = new Set(
    records.flatMap(({ event }) => {
      const transition = workflowJournalTransitionRuleFor(event)
      const descriptor = describeJournalEvent(event)
      return transition?._tag === "Outcome" && descriptor._tag === "OperationEventDescriptor"
        ? [descriptor.operationId]
        : []
    })
  )
  const workflowOperationFreshFacts = (responsibility: WorkflowOperationResponsibility): ResponsibilityFreshFacts => {
    const stoppedNoReleaseSettles = (): boolean =>
      responsibility._tag === "TaskClaimReleaseResponsibility" &&
      records.some(
        ({ event, position }) =>
          position > responsibility.beganAt &&
          event._tag === "StoppedAttemptClaimNoReleaseObserved" &&
          isExactTaskClaim(event.expectedClaim, responsibility.operation.release.claim)
      )
    const settled =
      settledOperationIds.has(workflowResponsibilityOperationId(responsibility)) || stoppedNoReleaseSettles()
    const expectedClaim =
      responsibility._tag === "TaskClaimReleaseResponsibility"
        ? responsibility.operation.release.claim
        : responsibility._tag === "TaskWorktreeResponsibility"
          ? authorizedClaimForAttempt(records, responsibility.operation.plannedAttempt)?.claim
          : undefined
    const claimAuthority =
      responsibility._tag === "TaskClaimResponsibility"
        ? undefined
        : currentTaskClaimAuthority(
            records,
            responsibility.taskId,
            expectedClaim,
            freshnessBaselineForTask(responsibility.taskId)
          )
    const stoppedAttemptOwnsClaimRelease = (): boolean =>
      responsibility._tag === "TaskClaimReleaseResponsibility" &&
      records.some(
        ({ event, position }) =>
          position < responsibility.beganAt &&
          event._tag === "AttemptImplementationAbandoned" &&
          isExactTaskClaim(event.expectedClaim, responsibility.operation.release.claim)
      )
    const unsettledDisposition = () => {
      if (stoppedAttemptOwnsClaimRelease()) {
        return ResponsibilityDisposition.WorkflowOperationTaskClaimConstraint({ claimState: "Unobserved" })
      }
      if (taskLeftMembership(responsibility.taskId)) return ResponsibilityDisposition.TaskMembershipConstraint()
      return claimAuthority !== undefined && claimAuthority._tag !== "Exact"
        ? ResponsibilityDisposition.WorkflowOperationTaskClaimConstraint({ claimState: claimAuthority._tag })
        : ResponsibilityDisposition.Ready()
    }
    return {
      _tag: "WorkflowOperationFreshFacts" as const,
      disposition: settled
        ? ResponsibilityDisposition.Settled({ outcome: "ResponsibilityCompleted" })
        : unsettledDisposition(),
      responsibility
    }
  }
  return runState.responsibility.entries.map((responsibility) => {
    if (responsibility._tag !== "PlannedAttemptExecutorWorkResponsibility") {
      return workflowOperationFreshFacts(responsibility)
    }
    const report = latestPlannedAttemptExecutorEvidence(records, responsibility.plannedAttempt)
    const projectionIssue = latestPlannedAttemptExecutorProjectionIssue(records, responsibility.plannedAttempt)
    const projectionWait =
      projectionIssue !== undefined && (report === undefined || projectionIssue.observedAt > report.observedAt)
    const paused = reconstructedTaskIsPaused(
      runState.pause,
      responsibility.plannedAttempt.taskId,
      Option.getOrUndefined(latestTaskGraph)
    )
    const safelySuspended = report?.report._tag === "SafelySuspended"
    /**
     * A completed Run Pause application durably requests suspension of every
     * exact attempt that was still running when that direction was recorded.
     * A later Unpause cannot erase an executor request that may already have
     * crossed its boundary; only a correlated executor report settles it.
     */
    const runPauseSuspensionOwed = suspensionWasOwedAfterPause(
      records,
      responsibility.plannedAttempt,
      responsibility.beganAt,
      isRunPauseEvent
    )
    const taskPauseSuspensionOwed = taskPauseSuspensionIsOwed(
      records,
      responsibility.plannedAttempt,
      responsibility.beganAt,
      Option.getOrUndefined(latestTaskGraph)
    )
    const changedSpecification = changedTaskSpecification(responsibility.plannedAttempt)
    const exactChangedSpecificationMayContinue = () =>
      Option.isSome(changedSpecification) &&
      appliedContinueChoicePositionFor(
        records,
        responsibility.plannedAttempt,
        changedSpecification.value.fingerprint
      ) !== undefined
    const acquiredClaim = authorizedClaimForAttempt(records, responsibility.plannedAttempt)
    const currentClaimRecord = records.findLast(
      ({ event, position }) =>
        event._tag === "TaskTrackerFactsObserved" &&
        (event.observation._tag === "FocusedTaskClaimFacts" ||
          event.observation._tag === "FocusedTaskClaimFactsUnreadable") &&
        event.observation.coverage.taskId === responsibility.plannedAttempt.taskId &&
        positionIsAfter(position, freshnessBaselineForAttempt(responsibility.plannedAttempt))
    )
    const currentClaimFacts = currentClaimRecord?.event
    const committedReacquisitionIntent = records.findLast(
      ({ event }) =>
        event._tag === "TaskClaimAcquisitionIntended" &&
        event.operation.authority._tag === "ExplicitTaskClaimReacquisitionAuthority" &&
        event.operation.acquisition.taskId === responsibility.plannedAttempt.taskId
    )
    const deriveCommittedReacquisition = () =>
      committedReacquisitionIntent?.event._tag === "TaskClaimAcquisitionIntended" &&
      committedReacquisitionIntent.event.operation.authority._tag === "ExplicitTaskClaimReacquisitionAuthority"
        ? {
            requestId: committedReacquisitionIntent.event.operation.authority.requestId,
            operation: committedReacquisitionIntent.event.operation
          }
        : undefined
    const committedReacquisition = deriveCommittedReacquisition()
    const deriveCommittedReacquisitionOutcome = () =>
      committedReacquisition === undefined
        ? undefined
        : records.findLast(
            ({ event }) =>
              (event._tag === "TaskClaimAcquired" &&
                event.claim.operationId === committedReacquisition.operation.acquisition.operationId) ||
              (event._tag === "TaskClaimAcquisitionRejected" &&
                event.operationId === committedReacquisition.operation.acquisition.operationId)
          )
    const committedReacquisitionOutcome = deriveCommittedReacquisitionOutcome()
    const deriveCommittedReacquisitionDirection = () => {
      if (committedReacquisition === undefined) return undefined
      if (
        committedReacquisitionOutcome !== undefined &&
        currentClaimRecord !== undefined &&
        currentClaimRecord.position >= committedReacquisitionOutcome.position
      )
        return undefined
      return records.findLast(
        ({ event }) =>
          event._tag === "TaskClaimReacquisitionDirected" && event.requestId === committedReacquisition.requestId
      )?.event
    }
    const committedReacquisitionDirection = deriveCommittedReacquisitionDirection()
    const deriveReacquisitionDirection = () => {
      if (committedReacquisitionDirection?._tag === "TaskClaimReacquisitionDirected") {
        return committedReacquisitionDirection
      }
      if (currentClaimRecord === undefined || acquiredClaim?._tag !== "TaskClaimAcquired") return undefined
      return latestTaskClaimReacquisitionDirection(
        records,
        responsibility.plannedAttempt.runId,
        responsibility.plannedAttempt.taskId,
        acquiredClaim.claim,
        /* v8 ignore next -- @preserve Recovery responsibility derivation always reads a non-empty run journal. */
        records.at(finalRecordOffset)?.position ?? currentClaimRecord.position
      )
    }
    const reacquisitionDirection = deriveReacquisitionDirection()
    const reacquisitionRequestId = () =>
      reacquisitionDirection?._tag === "TaskClaimReacquisitionDirected" ? reacquisitionDirection.requestId : undefined
    const reacquisitionOperationId = () => {
      const requestId = reacquisitionRequestId()
      return requestId === undefined ? undefined : taskClaimReacquisitionOperationId(requestId)
    }
    const reacquisitionIntentExists = (): boolean => {
      const operationId = reacquisitionOperationId()
      const requestId = reacquisitionRequestId()
      return (
        operationId !== undefined &&
        records.some(
          ({ event }) =>
            event._tag === "TaskClaimAcquisitionIntended" &&
            event.operation.authority._tag === "ExplicitTaskClaimReacquisitionAuthority" &&
            event.operation.authority.requestId === requestId &&
            event.operation.acquisition.operationId === operationId
        )
      )
    }
    const deriveReacquisitionOutcomeRecord = () => {
      const operationId = reacquisitionOperationId()
      return operationId === undefined
        ? undefined
        : records.findLast(({ event }) => event._tag === "TaskClaimAcquired" && event.claim.operationId === operationId)
    }
    const reacquisitionOutcomeRecord = deriveReacquisitionOutcomeRecord()
    const reacquisitionSupersedesClaimObservation = (): boolean =>
      reacquisitionOutcomeRecord !== undefined &&
      currentClaimRecord !== undefined &&
      reacquisitionOutcomeRecord.position > currentClaimRecord.position
    const deriveClaimConstraint = (): PlannedAttemptExecutorDisposition | undefined => {
      if (reacquisitionSupersedesClaimObservation()) return undefined
      if (currentClaimFacts?._tag !== "TaskTrackerFactsObserved") return undefined
      if (currentClaimFacts.observation._tag === "FocusedTaskClaimFactsUnreadable") {
        return ResponsibilityDisposition.TaskClaimUnreadableWait()
      }
      /* v8 ignore start -- currentClaimRecord selects only focused-readable or focused-unreadable facts, and unreadable returned above. */
      if (currentClaimFacts.observation._tag !== "FocusedTaskClaimFacts") return undefined
      /* v8 ignore stop */
      const focusedClaim = currentClaimFacts.observation.observation
      return Option.match(Option.fromUndefinedOr(acquiredClaim), {
        onNone: () => undefined,
        onSome: (acquired) => dispositionForFocusedClaim(focusedClaim, acquired.claim)
      })
    }
    const claimConstraint = deriveClaimConstraint()
    const worktreeReadOperationIds = new Set(
      records.flatMap(({ event }) =>
        event._tag === "GitReadIntentRecorded" &&
        event.operation._tag === "ReadTaskWorktree" &&
        event.operation.plannedAttempt.attemptId === responsibility.plannedAttempt.attemptId &&
        event.operation.plannedAttempt.runId === responsibility.plannedAttempt.runId
          ? [event.operation.operationId]
          : []
      )
    )
    const latestWorktreeObservation = records.findLast(
      ({ event }) => event._tag === "PlannedAttemptWorktreeObserved" && worktreeReadOperationIds.has(event.operationId)
    )
    const targetLineageReadOperationIds = new Set(
      records.flatMap(({ event }) =>
        event._tag === "GitReadIntentRecorded" &&
        event.operation._tag === "ReadTargetLineage" &&
        event.operation.plannedAttempt.attemptId === responsibility.plannedAttempt.attemptId &&
        event.operation.plannedAttempt.runId === responsibility.plannedAttempt.runId
          ? [event.operation.operationId]
          : []
      )
    )
    const latestTargetLineageObservation = records.findLast(
      ({ event }) =>
        event._tag === "TargetLineageObserved" &&
        targetLineageReadOperationIds.has(event.operationId) &&
        event.plannedAttempt.baseSha === responsibility.plannedAttempt.baseSha
    )
    const deriveGitConstraint = (): PlannedAttemptExecutorDisposition | undefined => {
      if (
        latestWorktreeObservation?.event._tag === "PlannedAttemptWorktreeObserved" &&
        latestWorktreeObservation.event.observation._tag !== "PlannedWorktreeReady"
      ) {
        return ResponsibilityDisposition.PlannedAttemptGitConstraint({
          gitState:
            latestWorktreeObservation.event.observation._tag === "AttemptWorktreeLost"
              ? "WorktreeLost"
              : latestWorktreeObservation.event.observation._tag
        })
      }
      if (
        latestTargetLineageObservation?.event._tag === "TargetLineageObserved" &&
        decideTargetLineage(latestTargetLineageObservation.event.observation)._tag === "IncompatibleTargetRewrite"
      )
        return ResponsibilityDisposition.PlannedAttemptGitConstraint({ gitState: "TargetRewrite" })
      return undefined
    }
    const gitConstraint = deriveGitConstraint()
    const deriveExternalSuccessRelease = () =>
      acquiredClaim?._tag === "TaskClaimAcquired"
        ? makeTaskClaimReleaseOperation({
            authority: TaskClaimReleaseAuthority.cases.WorkflowClaimReleaseAuthority.make({}),
            predecessorOperationIds: [acquiredClaim.claim.operationId],
            release: {
              claim: acquiredClaim.claim,
              operationId: OperationId.make(`external-success-release:${acquiredClaim.claim.operationId}`)
            }
          })
        : undefined
    const externalSuccessRelease = deriveExternalSuccessRelease()
    const externalSuccessReleaseIntended = () =>
      externalSuccessRelease !== undefined &&
      records.some(
        ({ event }) =>
          event._tag === "TaskClaimReleaseIntended" &&
          event.operation.release.operationId === externalSuccessRelease.release.operationId
      )
    const externalSuccessReleaseSettled = () =>
      externalSuccessRelease === undefined || settledOperationIds.has(externalSuccessRelease.release.operationId)
    const claimCanBeReacquired = () =>
      currentClaimFacts?._tag === "TaskTrackerFactsObserved" &&
      currentClaimFacts.observation._tag === "FocusedTaskClaimFacts" &&
      acquiredClaim?._tag === "TaskClaimAcquired" &&
      (currentClaimFacts.observation.observation._tag === "UnclaimedTask" ||
        !isExactTaskClaim(currentClaimFacts.observation.observation, acquiredClaim.claim))
    const deriveAppliedReacquisitionDirection = () =>
      claimCanBeReacquired() &&
      reacquisitionDirection?._tag === "TaskClaimReacquisitionDirected" &&
      !reacquisitionIntentExists()
        ? ResponsibilityDisposition.AppliedTaskClaimReacquisitionDirection({
            requestId: reacquisitionDirection.requestId
          })
        : undefined
    const appliedReacquisitionDirection = deriveAppliedReacquisitionDirection()
    const restartDisposition = restartReplacementDisposition(
      records,
      responsibility.plannedAttempt,
      activationBaselinePosition,
      integrationTarget
    )
    const stopDisposition = stoppedAttemptDisposition(
      records,
      responsibility.plannedAttempt,
      activationBaselinePosition
    )
    const cancellationDisposition = cancelledAttemptDisposition(
      records,
      responsibility.plannedAttempt,
      activationBaselinePosition
    )
    const suspensionRequested = () => ResponsibilityDisposition.PlannedAttemptExecutorSuspensionRequested()
    const externalSuccessDisposition = (): PlannedAttemptExecutorDisposition | undefined => {
      if (!taskCompletedSuccessfully(responsibility.plannedAttempt.taskId)) return undefined
      if (!safelySuspended) return suspensionRequested()
      if (externalSuccessRelease === undefined || externalSuccessReleaseSettled()) {
        return ResponsibilityDisposition.TaskExternalSuccessSettled()
      }
      return externalSuccessReleaseIntended()
        ? ResponsibilityDisposition.TaskExternalSuccessConstraint()
        : ResponsibilityDisposition.TaskExternalSuccessReleaseNeeded({ operation: externalSuccessRelease })
    }
    const nonterminalTaskStateDisposition = (): PlannedAttemptExecutorDisposition | undefined => {
      if (taskLeftMembership(responsibility.plannedAttempt.taskId)) {
        return safelySuspended ? ResponsibilityDisposition.TaskMembershipConstraint() : suspensionRequested()
      }
      if (taskTerminalWithoutSuccess(responsibility.plannedAttempt.taskId)) {
        return safelySuspended
          ? ResponsibilityDisposition.TaskLifecycleConstraint({ lifecycle: "TerminalWithoutSuccess" })
          : suspensionRequested()
      }
      return externalSuccessDisposition()
    }
    const taskStateDisposition = (): PlannedAttemptExecutorDisposition | undefined => {
      if (restartDisposition !== undefined) return restartDisposition
      if (stopDisposition !== undefined) return stopDisposition
      if (projectionWait) {
        return ResponsibilityDisposition.PlannedAttemptExecutorProjectionWait({ reason: projectionIssue.reason })
      }
      if (cancellationDisposition !== undefined) return cancellationDisposition
      if (report?.report._tag === "Terminal") {
        return ResponsibilityDisposition.PlannedAttemptExecutorWorkTerminal({ report: report.report })
      }
      return nonterminalTaskStateDisposition()
    }
    const changedSpecificationDisposition = (): PlannedAttemptExecutorDisposition | undefined => {
      if (Option.isNone(changedSpecification) || exactChangedSpecificationMayContinue()) return undefined
      return safelySuspended
        ? ResponsibilityDisposition.TaskSpecificationChangeConstraint({
            observedFingerprint: changedSpecification.value.fingerprint,
            plannedFingerprint: responsibility.plannedAttempt.taskRevision
          })
        : suspensionRequested()
    }
    const constraintDisposition = (): PlannedAttemptExecutorDisposition | undefined => {
      if (claimConstraint !== undefined) {
        return safelySuspended ? (appliedReacquisitionDirection ?? claimConstraint) : suspensionRequested()
      }
      if (gitConstraint !== undefined) return safelySuspended ? gitConstraint : suspensionRequested()
      return changedSpecificationDisposition()
    }
    const readyProgress = () => {
      if (report === undefined) {
        return { _tag: "ExecutorResponsibilityBegan" as const, acceptedAt: responsibility.beganAt }
      }
      return report.source._tag === "CommandResponse"
        ? { _tag: "ExecutorReportAccepted" as const, ordinal: report.source.ordinal }
        : { _tag: "ExecutorProjectionAccepted" as const, observedAt: report.observedAt }
    }
    const pauseOrReadyDisposition = (): PlannedAttemptExecutorDisposition => {
      if (safelySuspended && paused) {
        return ResponsibilityDisposition.PlannedAttemptExecutorWorkSafelySuspended({
          correlation: report.report.correlation
        })
      }
      return paused || runPauseSuspensionOwed || taskPauseSuspensionOwed
        ? suspensionRequested()
        : { _tag: "Ready", acceptedProgress: readyProgress() }
    }
    const disposition = taskStateDisposition() ?? constraintDisposition() ?? pauseOrReadyDisposition()
    return { _tag: "PlannedAttemptExecutorFreshFacts" as const, disposition, responsibility }
  })
}

/** True when the journal still assigns work to this Dalph run. */
export const hasUnfinishedRunResponsibility = (runState: ReconstructedRunState): boolean =>
  deriveJournalResponsibilityFacts(runState).some(
    ({ disposition }) =>
      disposition._tag !== "Settled" &&
      disposition._tag !== "PlannedAttemptExecutorWorkTerminal" &&
      disposition._tag !== "StoppedAttemptSettled" &&
      disposition._tag !== "CancelledAttemptSettled"
  )

const readRecoveredRunState = Effect.fn("RunRecoveryActivation.readRecoveredRunState")(function* (runId: RunId) {
  const journal = yield* InRunJournal
  const reduction = reduceWorkflowJournalHistory(runId, yield* journal.read(runId))
  if (reduction._tag === "InvalidWorkflowJournalHistory") {
    return yield* Effect.fail(reduction)
  }
  return reduction.runState
})

const latestJournalPosition = (
  records: ReadonlyArray<{ readonly position: JournalPosition }>
): Option.Option<JournalPosition> =>
  Option.fromUndefinedOr(records.reduce<JournalPosition | undefined>((_previous, { position }) => position, undefined))

const positionIsAfter = (position: JournalPosition, baseline: Option.Option<JournalPosition>): boolean =>
  Option.match(baseline, { onNone: () => true, onSome: (baselinePosition) => position > baselinePosition })

const latestCompletedRunPauseCyclePosition = (runState: ReconstructedRunState): JournalPosition | undefined => {
  if (runState.pause.run._tag === "RunPaused") return undefined
  const wasPaused = runState.workflowHistory.records.some(
    ({ event }) =>
      event._tag === "ControlDirectionApplied" && event.direction === "Pause" && event.subject._tag === "Run"
  )
  if (!wasPaused) return undefined
  /* v8 ignore next -- A valid unpaused history that previously applied Run Pause necessarily contains a later Run Unpause. */
  return runState.workflowHistory.records.findLast(
    ({ event }) =>
      event._tag === "ControlDirectionApplied" && event.direction === "Unpause" && event.subject._tag === "Run"
  )?.position
}

const completedTaskPauseCyclesByRecords = new WeakMap<
  ReadonlyArray<JournalRecord>,
  ReadonlyArray<{ readonly position: JournalPosition; readonly taskId: TaskId }>
>()

const completedTaskPauseCycles = (
  runState: ReconstructedRunState
): ReadonlyArray<{ readonly position: JournalPosition; readonly taskId: TaskId }> => {
  const records = runState.workflowHistory.records
  const cached = completedTaskPauseCyclesByRecords.get(records)
  if (cached !== undefined) return cached
  const cycles = records.flatMap(({ event, position }) => {
    if (event._tag !== "ControlDirectionApplied" || event.direction !== "Unpause" || event.subject._tag !== "Task") {
      return []
    }
    const taskId = event.subject.taskId
    const completesPause = records.some(
      ({ event: candidate, position: candidatePosition }) =>
        candidatePosition < position &&
        candidate._tag === "ControlDirectionApplied" &&
        candidate.direction === "Pause" &&
        candidate.subject._tag === "Task" &&
        candidate.subject.taskId === taskId
    )
    return completesPause ? [{ position, taskId }] : []
  })
  completedTaskPauseCyclesByRecords.set(records, cycles)
  return cycles
}

const latestCompletedTaskPauseCyclePosition = (runState: ReconstructedRunState): JournalPosition | undefined =>
  completedTaskPauseCycles(runState).at(finalRecordOffset)?.position

const latestCompletedTaskPauseCyclePositionFor = (
  runState: ReconstructedRunState,
  taskId: TaskId,
  currentGraph: TaskDagSnapshot | undefined
): JournalPosition | undefined =>
  completedTaskPauseCycles(runState).findLast(
    ({ taskId: pausedTaskId }) =>
      pausedTaskId === taskId || currentGraph?.groupingSubtreeOf(pausedTaskId).includes(taskId) === true
  )?.position

const latestCompletedPauseCyclePosition = (runState: ReconstructedRunState): JournalPosition | undefined => {
  const positions = [
    latestCompletedRunPauseCyclePosition(runState),
    latestCompletedTaskPauseCyclePosition(runState)
  ].filter((position): position is JournalPosition => position !== undefined)
  return positions.length === 0 ? undefined : JournalPosition.make(Math.max(...positions))
}

const continuationFreshnessBaseline = (
  runState: ReconstructedRunState,
  activationBaselinePosition: Option.Option<JournalPosition>
): Option.Option<JournalPosition> => {
  const latestUnpause = latestCompletedPauseCyclePosition(runState)
  if (latestUnpause === undefined) return activationBaselinePosition
  return Option.some(
    JournalPosition.make(
      Option.match(activationBaselinePosition, {
        onNone: () => latestUnpause,
        onSome: (activationBaseline) => Math.max(activationBaseline, latestUnpause)
      })
    )
  )
}

const continuationFreshnessBaselineForTask = (
  runState: ReconstructedRunState,
  activationBaselinePosition: Option.Option<JournalPosition>,
  taskId: TaskId,
  currentGraph: TaskDagSnapshot | undefined
): Option.Option<JournalPosition> => {
  const positions = [
    Option.getOrUndefined(activationBaselinePosition),
    latestCompletedRunPauseCyclePosition(runState),
    latestCompletedTaskPauseCyclePositionFor(runState, taskId, currentGraph)
  ].filter((position): position is JournalPosition => position !== undefined)
  return positions.length === 0 ? Option.none() : Option.some(JournalPosition.make(Math.max(...positions)))
}

/** A Continue choice refreshes only the exact immutable attempt named by that choice. */
export const continuationFreshnessBaselineForAttempt = (
  runState: ReconstructedRunState,
  activationBaselinePosition: Option.Option<JournalPosition>,
  plannedAttempt: PlannedTaskAttempt,
  currentGraph: TaskDagSnapshot | undefined
): Option.Option<JournalPosition> => {
  const positions = [
    Option.getOrUndefined(
      continuationFreshnessBaselineForTask(runState, activationBaselinePosition, plannedAttempt.taskId, currentGraph)
    ),
    appliedContinueChoicePositionFor(runState.workflowHistory.records, plannedAttempt)
  ].filter((position): position is JournalPosition => position !== undefined)
  return positions.length === 0 ? Option.none() : Option.some(JournalPosition.make(Math.max(...positions)))
}

const transitionTagsAllowedWhilePaused = new Set<RunnableFrontierTransition["_tag"]>([
  "AdvanceAttemptStoppage",
  "RelinquishCancelledAttemptImplementation",
  "CheckTaskClaim",
  "ObserveAttemptStoppageExecutor",
  "ObserveCancelledAttemptClaim",
  "ObserveStoppedAttemptClaim",
  "RecordCancelledAttemptClaimNoRelease",
  "RecordStoppedAttemptClaimNoRelease",
  "ReconcileTaskClaim",
  "ReconcileTaskClaimRelease",
  "ReconcileTaskWorktree",
  "ReleaseStoppedAttemptClaim",
  "ReleaseCancelledAttemptClaim",
  "RetryCancelledAttemptClaimRelease",
  "RetryStoppedAttemptClaimRelease",
  "SuspendPlannedAttemptExecutorWork",
  "ReleaseStartedIntegrationTarget"
])
const transitionTagsAllowedToFinishHeldIntegration = new Set<RunnableFrontierTransition["_tag"]>([
  "RunTargetPromotion",
  "ObservePromotedCandidateAncestryAfterBlockerClear",
  "ReplacePromotedTaskClaim",
  "CompletePromotedTask",
  "ObserveFocusedTaskCompletion",
  "DeleteCompletedTaskCompletionClaim",
  "ObservePlannedAttemptContinuationTargetLineage",
  "ObserveResponsibleTaskClaim",
  "ReleaseStartedIntegrationTarget"
])
const transitionMayRunWhileRunPaused = (transition: RunnableFrontierTransition): boolean =>
  transitionTagsAllowedWhilePaused.has(transition._tag)

export const recordBeforePause = (
  records: ReadonlyArray<JournalRecord>,
  pausePosition: JournalPosition,
  predicate: (record: JournalRecord) => boolean
): boolean => records.some((record) => record.position < pausePosition && predicate(record))

type PausedIntegrationReconciliation = Extract<
  RunnableFrontierTransition,
  { readonly _tag: "AcquireStartedIntegrationTarget" | "RunTargetPromotion" }
>

const pausedIntegrationReconciliationTags: ReadonlySet<RunnableFrontierTransition["_tag"]> = new Set([
  "AcquireStartedIntegrationTarget",
  "RunTargetPromotion"
])

const isPausedIntegrationReconciliation = (
  transition: RunnableFrontierTransition
): transition is PausedIntegrationReconciliation => pausedIntegrationReconciliationTags.has(transition._tag)

/** A crashed integration request may finish only when its exact intent predates the active Run Pause. */
const startedIntegrationIntentMayReconcileBeforePause = (
  transition: RunnableFrontierTransition,
  records: ReadonlyArray<JournalRecord>,
  pausePosition: JournalPosition | undefined
): boolean => {
  if (pausePosition === undefined || !isPausedIntegrationReconciliation(transition)) return false
  return Match.valueTags(transition, {
    RunTargetPromotion: (transition) =>
      recordBeforePause(
        records,
        pausePosition,
        ({ event }) =>
          event._tag === "TargetPromotionIntended" &&
          event.correlation.requestId === targetPromotionRequestIdForCandidate(transition.candidate)
      ),
    AcquireStartedIntegrationTarget: ({ responsibility }) =>
      recordBeforePause(
        records,
        pausePosition,
        ({ event, position }) =>
          position === responsibility.startedAt &&
          event._tag === "IntegrationStarted" &&
          integrationResponsibilityEquivalence(event, responsibility)
      )
  })
}

const activeTaskPausePosition = (
  runState: ReconstructedRunState,
  taskId: TaskId,
  currentGraph: TaskDagSnapshot | undefined
): JournalPosition | undefined => {
  if (runState.pause.tasks._tag === "NoTaskPauses") return undefined
  return runState.workflowHistory.records.findLast(
    ({ event }) =>
      event._tag === "ControlDirectionApplied" &&
      event.direction === "Pause" &&
      event.subject._tag === "Task" &&
      runState.pause.tasks._tag === "TaskPauses" &&
      runState.pause.tasks.taskIds.includes(event.subject.taskId) &&
      (event.subject.taskId === taskId ||
        currentGraph?.groupingSubtreeOf(event.subject.taskId).includes(taskId) === true)
  )?.position
}

export const filterFrontierForActivePauses = (
  frontier: RunnableFrontier,
  runState: ReconstructedRunState,
  currentTaskGraph: TaskDagSnapshot | undefined,
  pendingGitReadReconciliations: ReadonlySet<RunnableFrontierTransition>,
  heldIntegrationTaskIds: ReadonlySet<TaskId>
): RunnableFrontier => {
  const historicalRunPausePosition = runState.workflowHistory.records.findLast(
    ({ event }) =>
      event._tag === "ControlDirectionApplied" && event.direction === "Pause" && event.subject._tag === "Run"
  )?.position
  // A cancellation is the same selection boundary for already-admitted
  // integration reconciliation, but it is not persisted as a derived
  // ControlDirectionApplied event.  Use its durable position only for the
  // pre-boundary intent check below.
  const cancellationPosition =
    runState.cancellation._tag === "RunCancellationApplied" ? runState.cancellation.appliedAt : undefined
  const runPausePosition = [historicalRunPausePosition, cancellationPosition]
    .filter((position): position is JournalPosition => position !== undefined)
    .reduce<JournalPosition | undefined>(
      (latest, position) => (latest === undefined || position > latest ? position : latest),
      undefined
    )
  const transitionMayRunWhileTaskPaused = (transition: RunnableFrontierTransition): boolean => {
    const pausePosition = activeTaskPausePosition(runState, runnableTransitionTaskId(transition), currentTaskGraph)
    return (
      pausePosition === undefined ||
      transitionTagsAllowedWhilePaused.has(transition._tag) ||
      (heldIntegrationTaskIds.has(runnableTransitionTaskId(transition)) &&
        transitionTagsAllowedToFinishHeldIntegration.has(transition._tag)) ||
      pendingGitReadReconciliations.has(transition) ||
      startedIntegrationIntentMayReconcileBeforePause(transition, runState.workflowHistory.records, pausePosition)
    )
  }
  const runSettlementClosed = runState.pause.run._tag === "RunPaused" || cancellationPosition !== undefined
  const transitions = runSettlementClosed
    ? frontier.transitions.filter(
        (transition) =>
          transitionMayRunWhileRunPaused(transition) ||
          (heldIntegrationTaskIds.has(runnableTransitionTaskId(transition)) &&
            transitionTagsAllowedToFinishHeldIntegration.has(transition._tag)) ||
          pendingGitReadReconciliations.has(transition) ||
          startedIntegrationIntentMayReconcileBeforePause(
            transition,
            runState.workflowHistory.records,
            runPausePosition
          )
      )
    : frontier.transitions.filter(transitionMayRunWhileTaskPaused)
  return { ...frontier, transitions }
}
type CurrentGraphObservation = {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "TaskTrackerFactsObserved" }>
  readonly position: JournalPosition
}
type TrackerFactsRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "TaskTrackerFactsObserved" }>
}
type WorktreeObservationRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "PlannedAttemptWorktreeObserved" }>
}

type IntegrationQuarantineDirectionFacts = {
  readonly quarantineAt: JournalPosition
  readonly directionAt: JournalPosition
  readonly direction: Extract<JournalRecord["event"], { readonly _tag: "IntegrationQuarantineDirectionApplied" }>
  readonly predecessorOperationId: OperationId
}

/**
 * Finds one latest quarantine direction only when its fixed session, run,
 * responsibility, and target-lineage read are all exact. The direction event
 * is not itself a workflow operation, so the fresh read keeps the fixed
 * session's real lineage operation as its durable causal predecessor.
 */
// eslint-disable-next-line complexity -- Exact S/run/Q/D reconstruction is intentionally one fail-closed causal relation.
const integrationQuarantineDirectionFor = (
  records: ReadonlyArray<JournalRecord>,
  responsibility: StartedIntegrationResponsibility
): IntegrationQuarantineDirectionFacts | undefined => {
  const matchingQuarantine = records.findLast(
    (record) =>
      record.event._tag === "IntegrationQuarantined" &&
      record.runId === responsibility.plannedAttempt.runId &&
      integratorResponsibilityFactsEqual(
        integratorResponsibilityFactsFromCorrelation(record.event.correlation),
        integratorResponsibilityFactsFor(responsibility)
      )
  )
  if (matchingQuarantine?.event._tag !== "IntegrationQuarantined") return undefined
  const quarantineCorrelation = matchingQuarantine.event.correlation

  const fixedSessionRecords = records.filter(
    (record) =>
      record.event._tag === "IntegratorSessionFixed" &&
      integratorResponsibilityFactsEqual(
        integratorResponsibilityFactsFromCorrelation(record.event.correlation),
        integratorResponsibilityFactsFromCorrelation(quarantineCorrelation)
      )
  )
  if (fixedSessionRecords.length !== 1) return undefined
  const fixedSession = fixedSessionRecords[0]
  const fixedSessionEvent = fixedSession?.event
  if (
    fixedSession === undefined ||
    fixedSessionEvent?._tag !== "IntegratorSessionFixed" ||
    fixedSession.key !==
      integratorSessionFixedRecordKey(integratorResponsibilityFactsFromCorrelation(quarantineCorrelation)) ||
    fixedSession.runId !== responsibility.plannedAttempt.runId ||
    !integratorCorrelationsEqual(fixedSessionEvent.correlation, quarantineCorrelation) ||
    fixedSession.position <= quarantineCorrelation.targetLineageObservedAt ||
    fixedSession.position >= matchingQuarantine.position
  ) {
    return undefined
  }

  const initialRunRecords = records.filter(
    (record) =>
      record.runId === responsibility.plannedAttempt.runId &&
      record.event._tag === "IntegratorRunStarted" &&
      record.event.run.ordinal === 1 &&
      integratorCorrelationsEqual(record.event.run.session, quarantineCorrelation) &&
      record.position > fixedSession.position &&
      record.position < matchingQuarantine.position
  )
  if (initialRunRecords.length !== 1) return undefined
  const initialRun = initialRunRecords[0]
  const initialRunEvent = initialRun?.event
  if (
    initialRun === undefined ||
    initialRunEvent?._tag !== "IntegratorRunStarted" ||
    initialRun.key !== integratorRunStartedRecordKey(initialRunEvent.run) ||
    initialRun.position <= fixedSession.position ||
    initialRun.position >= matchingQuarantine.position
  ) {
    return undefined
  }

  const state = deriveIntegrationQuarantineState(records, quarantineCorrelation.sessionId)
  if (state._tag !== "DirectionApplied" || state.quarantineAt !== matchingQuarantine.position) return undefined

  const directionRecord = records.find(
    (record) =>
      record.position === state.applicationAt &&
      record.runId === responsibility.plannedAttempt.runId &&
      record.event._tag === "IntegrationQuarantineDirectionApplied"
  )
  if (
    directionRecord?.event._tag !== "IntegrationQuarantineDirectionApplied" ||
    directionRecord.event.requestId.runId !== responsibility.plannedAttempt.runId ||
    directionRecord.event.fingerprint.sessionId !== quarantineCorrelation.sessionId ||
    directionRecord.event.fingerprint.quarantineAt !== matchingQuarantine.position
  ) {
    return undefined
  }

  const fixedLineageRecord = records.find(
    (record) =>
      record.position === quarantineCorrelation.targetLineageObservedAt &&
      record.event._tag === "TargetLineageObserved" &&
      record.event.operationId.length > 0 &&
      record.event.plannedAttempt.runId === responsibility.plannedAttempt.runId &&
      plannedTaskAttemptEquivalence(record.event.plannedAttempt, responsibility.plannedAttempt) &&
      record.event.observation.plannedBaseIsAncestorOfTargetHead &&
      record.event.observation.plannedBaseSha === responsibility.plannedAttempt.baseSha &&
      record.event.observation.targetHeadSha === quarantineCorrelation.expectedTargetHead
  )
  if (fixedLineageRecord?.event._tag !== "TargetLineageObserved") return undefined

  return {
    quarantineAt: matchingQuarantine.position,
    directionAt: directionRecord.position,
    direction: directionRecord.event,
    predecessorOperationId: fixedLineageRecord.event.operationId
  }
}

const integrationQuarantineDirectionTargetLineageOperationId = (
  facts: IntegrationQuarantineDirectionFacts,
  plannedAttempt: PlannedTaskAttempt,
  graphObservedAt: JournalPosition
): OperationId =>
  OperationId.make(
    `integration-quarantine-direction:${encodeURIComponent(facts.direction.requestId.nonce)}:${plannedAttempt.attemptId}:q:${facts.quarantineAt}:d:${facts.directionAt}:g:${graphObservedAt}:target-lineage`
  )

const currentCompleteGraphObservationAfter = (
  records: ReadonlyArray<JournalRecord>,
  baseline: Option.Option<JournalPosition>
): CurrentGraphObservation | undefined => {
  const record = records.findLast(
    ({ event, position }) =>
      event._tag === "TaskTrackerFactsObserved" &&
      (event.observation._tag === "CompleteTaskTrackerFacts" ||
        event.observation._tag === "UnchangedTaskTrackerFactsReconfirmed") &&
      positionIsAfter(position, baseline)
  )
  return record?.event._tag === "TaskTrackerFactsObserved"
    ? { event: record.event, position: record.position }
    : undefined
}

type ContinuationDecision = {
  readonly explanation?: FrontierExplanation
  readonly transition?: RunnableFrontierTransition
}

const continuationTarget = (records: ReadonlyArray<JournalRecord>) => {
  const began = records.find(({ event }) => event._tag === "WorkflowRunBegan")
  if (began?.event._tag === "WorkflowRunBegan") return began.event.target
  /* v8 ignore start -- @preserve Valid reconstructed histories always begin with WorkflowRunBegan; this keeps diagnostics total for defensive callers. */
  const historicalGraph = records.findLast(
    ({ event }) =>
      event._tag === "TaskTrackerFactsObserved" &&
      (event.observation._tag === "CompleteTaskTrackerFacts" ||
        event.observation._tag === "UnchangedTaskTrackerFactsReconfirmed")
  )
  /* v8 ignore next -- @preserve The selecting predicate above permits only TaskTrackerFactsObserved graph records. */
  return historicalGraph?.event._tag === "TaskTrackerFactsObserved"
    ? historicalGraph.event.observation.target
    : undefined
  /* v8 ignore stop -- @preserve */
}

const decisionWithoutCurrentGraph = (
  plannedAttempt: PlannedTaskAttempt,
  planOperationId: OperationId | undefined,
  records: ReadonlyArray<JournalRecord>,
  activationBaselinePosition: Option.Option<JournalPosition>
): ContinuationDecision => {
  const target = continuationTarget(records)
  /* v8 ignore start -- @preserve A valid recovered run always supplies its WorkflowRunBegan target. */
  if (target === undefined) {
    return {
      explanation: FrontierExplanation.PlannedAttemptExecutorWorkTypedIssue({
        correlation: plannedAttemptExecutorCorrelation(plannedAttempt),
        reason: "MissingFreshFacts"
      })
    }
  }
  /* v8 ignore stop -- @preserve */
  const baseline = Option.getOrElse(
    activationBaselinePosition,
    /* v8 ignore next -- @preserve Recovery activations always establish a baseline before continuation reads. */
    () => 0
  )
  return {
    transition: RunnableFrontierTransition.ObservePlannedAttemptContinuationGraph({
      operation: makeTrackerGraphObservationOperation(
        OperationId.make(`continuation:${plannedAttempt.attemptId}:after:${baseline}:graph`),
        target,
        /* v8 ignore next -- @preserve A recovered executor responsibility always has its durable plan operation. */
        planOperationId === undefined ? [] : [planOperationId],
        [plannedAttempt.taskId]
      ),
      plannedAttempt
    })
  }
}

// eslint-disable-next-line complexity -- The chronological claim→worktree continuation gate constructs one exact causal read chain.
const decisionAfterCurrentSpecification = (
  transition: Extract<RunnableFrontierTransition, { readonly _tag: "ContinuePlannedAttemptExecutorWork" }>,
  planOperationId: OperationId | undefined,
  records: ReadonlyArray<JournalRecord>,
  currentGraphObservation: CurrentGraphObservation,
  currentSpecificationRecord: TrackerFactsRecord,
  integrationTarget: Option.Option<IntegrationTarget>
): ContinuationDecision => {
  const plannedAttempt = transition.plannedAttempt
  const authorizedClaim = authorizedClaimForAttempt(records, plannedAttempt)
  /* v8 ignore next -- @preserve A valid retained planned attempt has its exact historical claim authority. */
  const authorizedClaimRecord =
    authorizedClaim === undefined
      ? undefined
      : records.findLast(
          ({ event }) =>
            event._tag === "TaskClaimAcquired" && event.claim.operationId === authorizedClaim.claim.operationId
        )
  const claimObservationCutoff = Math.max(
    currentSpecificationRecord.position,
    /* v8 ignore next -- @preserve The authorized claim selected above names its durable acquisition record. */
    authorizedClaimRecord?.position ?? currentSpecificationRecord.position
  )
  const currentClaimRecord = records.findLast(
    (record): record is TrackerFactsRecord =>
      record.event._tag === "TaskTrackerFactsObserved" &&
      (record.event.observation._tag === "FocusedTaskClaimFacts" ||
        record.event.observation._tag === "FocusedTaskClaimFactsUnreadable") &&
      record.event.observation.coverage.taskId === plannedAttempt.taskId &&
      record.position > claimObservationCutoff
  )
  if (currentClaimRecord !== undefined) {
    const currentClaimEvent = currentClaimRecord.event
    const currentClaimIsExact =
      authorizedClaim !== undefined &&
      currentClaimEvent.observation._tag === "FocusedTaskClaimFacts" &&
      currentClaimEvent.observation.observation._tag === "ActiveTaskClaim" &&
      isExactTaskClaim(currentClaimEvent.observation.observation, authorizedClaim.claim)
    if (!currentClaimIsExact) return {}
    const currentWorktreeReadOperationIds = new Set(
      records.flatMap(({ event, position }) =>
        event._tag === "GitReadIntentRecorded" &&
        event.operation._tag === "ReadTaskWorktree" &&
        position > currentClaimRecord.position &&
        event.operation.plannedAttempt.attemptId === plannedAttempt.attemptId &&
        event.operation.plannedAttempt.runId === plannedAttempt.runId
          ? [event.operation.operationId]
          : []
      )
    )
    const currentWorktreeRecord = records.findLast(
      (record): record is WorktreeObservationRecord =>
        record.event._tag === "PlannedAttemptWorktreeObserved" &&
        record.position > currentClaimRecord.position &&
        currentWorktreeReadOperationIds.has(record.event.operationId)
    )
    const currentWorktreeEvent = currentWorktreeRecord?.event
    if (
      currentWorktreeRecord !== undefined &&
      currentWorktreeEvent !== undefined &&
      currentWorktreeEvent.observation._tag === "PlannedWorktreeReady"
    ) {
      const latestExecutorEvidence = latestPlannedAttemptExecutorEvidence(records, plannedAttempt)
      if (
        latestExecutorEvidence !== undefined &&
        currentGraphObservation.position <= latestExecutorEvidence.observedAt
      ) {
        return decisionWithoutCurrentGraph(
          plannedAttempt,
          planOperationId,
          records,
          Option.some(latestExecutorEvidence.observedAt)
        )
      }
      const currentSpecificationEvent = currentSpecificationRecord.event
      const currentClaimEvent = currentClaimRecord.event
      const continuationWithCurrentFacts =
        RunnableFrontierTransition.ContinuePlannedAttemptExecutorWorkAfterCurrentFacts({
          acceptedProgress: transition.acceptedProgress,
          plannedAttempt,
          witness: {
            activeTaskContinuationRead: {
              graphObservationOperationId: currentGraphObservation.event.operationId,
              taskClaimObservationOperationId: currentClaimEvent.operationId,
              taskWorkSpecificationObservationOperationId: currentSpecificationEvent.operationId
            },
            worktreeObservationOperationId: currentWorktreeEvent.operationId
          }
        })
      const appliedContinueChoicePosition = appliedContinueChoicePositionFor(records, plannedAttempt)
      if (Option.isNone(integrationTarget)) {
        return appliedContinueChoicePosition === undefined
          ? { transition: continuationWithCurrentFacts }
          : {
              explanation: FrontierExplanation.IntegrationConfigurationWait({
                plannedAttempt,
                wakeCondition: "IntegrationTargetConfigured"
              })
            }
      }
      const targetLineageReadOperationIds = new Set(
        records.flatMap(({ event, position }) =>
          event._tag === "GitReadIntentRecorded" &&
          event.operation._tag === "ReadTargetLineage" &&
          position > currentWorktreeRecord.position &&
          event.operation.plannedAttempt.attemptId === plannedAttempt.attemptId &&
          event.operation.plannedAttempt.runId === plannedAttempt.runId
            ? [event.operation.operationId]
            : []
        )
      )
      const currentTargetLineageRecord = records.findLast(
        ({ event, position }) =>
          event._tag === "TargetLineageObserved" &&
          position > currentWorktreeRecord.position &&
          targetLineageReadOperationIds.has(event.operationId)
      )
      if (currentTargetLineageRecord !== undefined) {
        if (appliedContinueChoicePosition === undefined) return { transition: continuationWithCurrentFacts }
        const currentExecutorEvidence = latestPlannedAttemptExecutorEvidence(records, plannedAttempt)
        /* v8 ignore start -- @preserve An applied Continue choice is valid only after exact safely-suspended executor evidence. */
        if (currentExecutorEvidence === undefined) {
          return {
            transition: RunnableFrontierTransition.ObservePlannedAttemptContinuationExecutor({ plannedAttempt })
          }
        }
        /* v8 ignore stop -- @preserve */
        /* v8 ignore next -- @preserve A valid applied Continue choice is authorized only by its exact safely-suspended executor evidence. */
        return currentExecutorEvidence.report._tag === "SafelySuspended"
          ? { transition: continuationWithCurrentFacts }
          : {}
      }
      return {
        transition: RunnableFrontierTransition.ObservePlannedAttemptContinuationTargetLineage({
          operation: makeTargetLineageObservationOperation({
            integrationTarget: integrationTarget.value,
            operationId: OperationId.make(
              `continuation:${plannedAttempt.attemptId}:after:${currentWorktreeRecord.position}:target-lineage`
            ),
            plannedAttempt,
            predecessorOperationIds: [currentWorktreeEvent.operationId]
          }),
          plannedAttempt
        })
      }
    }
    if (currentWorktreeRecord !== undefined) return { transition }
    return {
      transition: RunnableFrontierTransition.ObservePlannedAttemptContinuationWorktree({
        operation: makeTaskWorktreeObservationOperation({
          operationId: OperationId.make(
            `continuation:${plannedAttempt.attemptId}:after:${currentClaimRecord.position}:worktree`
          ),
          plannedAttempt,
          predecessorOperationIds: [
            /* v8 ignore next -- @preserve A recovered executor responsibility always has its durable plan operation. */
            ...(planOperationId === undefined ? [] : [planOperationId]),
            currentGraphObservation.event.operationId,
            currentSpecificationRecord.event.operationId,
            currentClaimRecord.event.operationId
          ]
        }),
        plannedAttempt
      })
    }
  }
  return {
    transition: RunnableFrontierTransition.ObservePlannedAttemptContinuationClaim({
      operation: makeTaskClaimObservationOperation(
        OperationId.make(`continuation:${plannedAttempt.attemptId}:after:${claimObservationCutoff}:claim`),
        currentGraphObservation.event.observation.target,
        plannedAttempt.taskId,
        [
          /* v8 ignore next -- @preserve A recovered executor responsibility always has its durable plan operation. */
          ...(planOperationId === undefined ? [] : [planOperationId]),
          currentGraphObservation.event.operationId,
          currentSpecificationRecord.event.operationId
        ]
      ),
      plannedAttempt
    })
  }
}

const decisionWithoutCurrentSpecification = (
  plannedAttempt: PlannedTaskAttempt,
  planOperationId: OperationId | undefined,
  currentGraphObservation: CurrentGraphObservation
): ContinuationDecision => ({
  transition: RunnableFrontierTransition.ObservePlannedAttemptContinuationSpecification({
    operation: makeTaskWorkSpecificationObservationOperation(
      OperationId.make(
        `continuation:${plannedAttempt.attemptId}:after:${currentGraphObservation.position}:specification`
      ),
      currentGraphObservation.event.observation.target,
      plannedAttempt.taskId,
      [
        /* v8 ignore next -- @preserve A recovered executor responsibility always has its durable plan operation. */
        ...(planOperationId === undefined ? [] : [planOperationId]),
        currentGraphObservation.event.operationId
      ]
    ),
    plannedAttempt
  })
})

/** A safely suspended attempt may reopen as soon as current grouping facts no longer cover its task. */
export const safelySuspendedAttemptMayContinue = (
  pause: ReconstructedPauseState,
  plannedAttempt: PlannedTaskAttempt,
  currentGraph: TaskDagSnapshot | undefined
): boolean => !reconstructedTaskIsPaused(pause, plannedAttempt.taskId, currentGraph)

const unsettledExecutorCommandFor = (
  transition: RunnableFrontierTransition,
  records: ReadonlyArray<JournalRecord>
): PlannedTaskAttempt | undefined => {
  if (
    transition._tag !== "ContinuePlannedAttemptExecutorWork" &&
    transition._tag !== "SuspendPlannedAttemptExecutorWork"
  ) {
    return undefined
  }
  return latestUnsettledPlannedAttemptExecutorCommand(records, transition.plannedAttempt) === undefined
    ? undefined
    : transition.plannedAttempt
}

const plannedAttemptPlanOperationId = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt
): OperationId | undefined => recordedTaskAttemptPlanFor(records, plannedAttempt)?.operationId

export const continuationDecisionFor = (
  transition: RunnableFrontierTransition,
  records: ReadonlyArray<JournalRecord>,
  currentGraphObservation: CurrentGraphObservation | undefined,
  activationBaselinePosition: Option.Option<JournalPosition>,
  integrationTarget: Option.Option<IntegrationTarget>
): ContinuationDecision => {
  const unsettledPlannedAttempt = unsettledExecutorCommandFor(transition, records)
  if (unsettledPlannedAttempt !== undefined) {
    return {
      transition: RunnableFrontierTransition.ObservePlannedAttemptContinuationExecutor({
        plannedAttempt: unsettledPlannedAttempt
      })
    }
  }
  if (transition._tag !== "ContinuePlannedAttemptExecutorWork") return { transition }
  const plannedAttempt = transition.plannedAttempt
  /* v8 ignore next -- @preserve A recovered executor-work responsibility always has its journaled task plan. */
  const planOperationId = plannedAttemptPlanOperationId(records, plannedAttempt)
  if (currentGraphObservation === undefined) {
    return decisionWithoutCurrentGraph(plannedAttempt, planOperationId, records, activationBaselinePosition)
  }
  const currentSpecificationRecord = records.findLast(
    (record): record is TrackerFactsRecord =>
      record.event._tag === "TaskTrackerFactsObserved" &&
      record.event.observation._tag === "FocusedTaskWorkSpecificationFacts" &&
      record.event.observation.factFamily.taskId === plannedAttempt.taskId &&
      record.position > currentGraphObservation.position
  )
  if (currentSpecificationRecord !== undefined) {
    return decisionAfterCurrentSpecification(
      transition,
      planOperationId,
      records,
      currentGraphObservation,
      currentSpecificationRecord,
      integrationTarget
    )
  }
  return decisionWithoutCurrentSpecification(plannedAttempt, planOperationId, currentGraphObservation)
}

export const gitReadIntentHasOutcome = (records: ReadonlyArray<JournalRecord>, operationId: OperationId): boolean =>
  records.some(
    ({ event }) =>
      (event._tag === "PlannedAttemptWorktreeObserved" ||
        event._tag === "TargetLineageObserved" ||
        (event._tag === "AttemptRestartAuthorityReadFailed" &&
          event.failure._tag !== "AttemptRestartTaskFactsReadFailure")) &&
      event.operationId === operationId
  )

const projectRecoveredRunState = Effect.fn("RunRecoveryActivation.projectRecoveredRunState")(function* (
  runState: ReconstructedRunState,
  integrationResources: IntegrationTargetResourceController,
  integrationTarget: Option.Option<IntegrationTarget>,
  activationBaselinePosition: Option.Option<JournalPosition>,
  targetPromotionConfigured: boolean,
  integrationFinalityConfigured: boolean,
  completionTaskConfigured: boolean,
  currentIntegrationResources?: IntegrationTargetResourceSnapshot
) {
  /**
   * Cancellation closes new selection but does not create a second pause
   * record or a second responsibility ledger.  The recovery projection uses
   * the already-established Run Pause filtering and executor suspension
   * rules as a process-local settlement overlay while the durable
   * RunCancellationApplied fact remains the only cancellation authority.
   */
  const settlementRunState: ReconstructedRunState =
    runState.cancellation._tag === "RunCancellationApplied"
      ? { ...runState, pause: { ...runState.pause, run: { _tag: "RunPaused" as const } } }
      : runState
  const currentTaskGraph = Option.getOrUndefined(latestReconstructedTaskGraph(settlementRunState.graphKnowledge))
  const requiredFreshnessBaseline = continuationFreshnessBaseline(runState, activationBaselinePosition)
  const freshnessBaselineForTask = (taskId: TaskId) =>
    continuationFreshnessBaselineForTask(runState, activationBaselinePosition, taskId, currentTaskGraph)
  const freshnessBaselineForAttempt = (plannedAttempt: PlannedTaskAttempt) =>
    continuationFreshnessBaselineForAttempt(runState, activationBaselinePosition, plannedAttempt, currentTaskGraph)
  const currentGraphObservationForTask = (taskId: TaskId) =>
    currentCompleteGraphObservationAfter(runState.workflowHistory.records, freshnessBaselineForTask(taskId))
  const currentGraphObservationForAttempt = (plannedAttempt: PlannedTaskAttempt) =>
    currentCompleteGraphObservationAfter(runState.workflowHistory.records, freshnessBaselineForAttempt(plannedAttempt))
  const currentTrackerTaskIds = new Set(
    currentTaskGraph?.taskIds().filter((taskId) => currentGraphObservationForTask(taskId) !== undefined) ?? []
  )
  const responsibilityFacts = deriveJournalResponsibilityFacts(
    settlementRunState,
    activationBaselinePosition,
    integrationTarget
  )
  const ordinary = deriveRunnableFrontier({
    freshEligibleTasks: [],
    responsibility: settlementRunState.responsibility,
    responsibilityFacts
  })
  const pendingGitReadIntents = runState.workflowHistory.records
    .filter(
      (
        record
      ): record is JournalRecord & {
        readonly event: Extract<JournalRecord["event"], { readonly _tag: "GitReadIntentRecorded" }>
      } => {
        if (record.event._tag !== "GitReadIntentRecorded") return false
        const operationId = record.event.operation.operationId
        return !gitReadIntentHasOutcome(runState.workflowHistory.records, operationId)
      }
    )
    .filter(
      (record, index, pending) =>
        pending.findLastIndex(({ event }) =>
          plannedTaskAttemptEquivalence(event.operation.plannedAttempt, record.event.operation.plannedAttempt)
        ) === index
    )
  const pendingAttemptIds = new Set(pendingGitReadIntents.map(({ event }) => event.operation.plannedAttempt.attemptId))
  const pendingTargetLineageAttemptIds = new Set(
    pendingGitReadIntents.flatMap(({ event }) =>
      event.operation._tag === "ReadTargetLineage" ? [event.operation.plannedAttempt.attemptId] : []
    )
  )
  const pendingGitReadTransitions = pendingGitReadIntents.map(({ event }) =>
    event.operation._tag === "ReadTaskWorktree"
      ? RunnableFrontierTransition.ObservePlannedAttemptContinuationWorktree({
          operation: event.operation,
          plannedAttempt: event.operation.plannedAttempt
        })
      : RunnableFrontierTransition.ObservePlannedAttemptContinuationTargetLineage({
          operation: event.operation,
          plannedAttempt: event.operation.plannedAttempt
        })
  )
  const continuationDecisions = ordinary.transitions.map((transition) => {
    if (transition._tag !== "ContinuePlannedAttemptExecutorWork") {
      return continuationDecisionFor(
        transition,
        runState.workflowHistory.records,
        undefined,
        activationBaselinePosition,
        integrationTarget
      )
    }
    return pendingAttemptIds.has(transition.plannedAttempt.attemptId)
      ? {}
      : continuationDecisionFor(
          transition,
          runState.workflowHistory.records,
          currentGraphObservationForAttempt(transition.plannedAttempt),
          freshnessBaselineForAttempt(transition.plannedAttempt),
          integrationTarget
        )
  })
  /**
   * A prior activation may have recorded a non-exact executor projection while
   * its command remained unmatched. A later ordinary Run entry is itself a
   * bounded reread boundary, so ask the opaque executor again before declaring
   * the responsibility a permanent wait. The position gate prevents a fresh
   * temporary/unreadable result from immediately retrying in the same entry.
   */
  const projectionRetryDecisions = responsibilityFacts.flatMap((facts) => {
    if (
      facts._tag !== "PlannedAttemptExecutorFreshFacts" ||
      facts.disposition._tag !== "PlannedAttemptExecutorProjectionWait"
    ) {
      return []
    }
    const issue = latestPlannedAttemptExecutorProjectionIssue(
      runState.workflowHistory.records,
      facts.responsibility.plannedAttempt
    )
    return issue !== undefined && !positionIsAfter(issue.observedAt, activationBaselinePosition)
      ? [
          {
            transition: RunnableFrontierTransition.ObservePlannedAttemptContinuationExecutor({
              plannedAttempt: facts.responsibility.plannedAttempt
            })
          }
        ]
      : []
  })
  const integrationResourceSnapshot = currentIntegrationResources ?? (yield* integrationResources.snapshot)
  const integrationResponsibilities = deriveIntegrationAdmission(runState.workflowHistory.records).responsibilities
  const latestClaimObservationPositionFor = (taskId: TaskId) =>
    runState.workflowHistory.records.findLast(
      ({ event, position }) =>
        positionIsAfter(position, freshnessBaselineForTask(taskId)) &&
        event._tag === "TaskTrackerFactsObserved" &&
        (event.observation._tag === "FocusedTaskClaimFacts" ||
          event.observation._tag === "FocusedTaskClaimFactsUnreadable") &&
        event.observation.coverage.taskId === taskId
    )?.position
  const directionLineageByAttemptId = new Map(
    integrationResponsibilities.flatMap((responsibility) => {
      if (responsibility._tag !== "StartedIntegrationResponsibility") return []
      const direction = integrationQuarantineDirectionFor(runState.workflowHistory.records, responsibility)
      return direction === undefined || direction.direction.fingerprint.direction !== "Retry"
        ? []
        : [
            [
              responsibility.plannedAttempt.attemptId,
              {
                directionAt: direction.directionAt,
                operationId: integrationQuarantineDirectionTargetLineageOperationId(
                  direction,
                  responsibility.plannedAttempt,
                  currentGraphObservationForTask(responsibility.plannedAttempt.taskId)?.position ??
                    direction.directionAt
                )
              }
            ] as const
          ]
    })
  )
  const activationTargetLineage = runState.workflowHistory.records.flatMap(({ event, position }) => {
    if (event._tag !== "TargetLineageObserved") return []
    const taskBaseline = freshnessBaselineForTask(event.plannedAttempt.taskId)
    const directionLineage = directionLineageByAttemptId.get(event.plannedAttempt.attemptId)
    const isExactDirectionLineage =
      directionLineage !== undefined &&
      position > directionLineage.directionAt &&
      event.operationId === directionLineage.operationId
    return positionIsAfter(position, taskBaseline) || isExactDirectionLineage
      ? [[event.plannedAttempt.attemptId, event.observation] as const]
      : []
  })
  const targetLineageByAttemptId = new Map(activationTargetLineage)
  const targetLineageRefreshRequiredAttemptIds = new Set([
    ...pendingTargetLineageAttemptIds,
    ...recordedTaskAttemptPlans(runState.workflowHistory.records).flatMap(({ plannedAttempt }) => {
      const graphObservedAt = currentGraphObservationForTask(plannedAttempt.taskId)?.position
      const lineageObservedAt = runState.workflowHistory.records.findLast(
        ({ event }) =>
          event._tag === "TargetLineageObserved" &&
          event.plannedAttempt.attemptId === plannedAttempt.attemptId &&
          event.plannedAttempt.runId === plannedAttempt.runId
      )?.position
      return graphObservedAt !== undefined && (lineageObservedAt === undefined || graphObservedAt > lineageObservedAt)
        ? [plannedAttempt.attemptId]
        : []
    })
  ])
  const activeClaimByAttemptId = new Map(
    recordedTaskAttemptPlans(runState.workflowHistory.records).flatMap(({ plannedAttempt }) => {
      const claim = authorizedClaimForAttempt(runState.workflowHistory.records, plannedAttempt)?.claim
      return claim === undefined ? [] : [[plannedAttempt.attemptId, claim] as const]
    })
  )
  const taskClaimAuthorityByAttemptId = new Map(
    recordedTaskAttemptPlans(runState.workflowHistory.records).map(({ plannedAttempt }) => {
      return [
        plannedAttempt.attemptId,
        currentTaskClaimAuthority(
          runState.workflowHistory.records,
          plannedAttempt.taskId,
          authorizedClaimForAttempt(runState.workflowHistory.records, plannedAttempt)?.claim,
          freshnessBaselineForTask(plannedAttempt.taskId)
        )
      ] as const
    })
  )
  const integration = deriveIntegrationFrontier(runState, {
    ...integrationResourceSnapshot,
    currentTrackerTaskIds,
    integrationTarget,
    targetLineageByAttemptId,
    targetLineageRefreshRequiredAttemptIds,
    targetPromotionConfigured,
    activeClaimByAttemptId,
    integrationFinalityConfigured,
    completionTaskConfigured,
    taskClaimAuthorityByAttemptId
  })
  const integrationLineageTransitions = Option.match(integrationTarget, {
    onNone: () => [],
    onSome: (target) =>
      // eslint-disable-next-line complexity -- Candidate lineage starts only after the exact responsibility passes every current authority gate.
      integrationResponsibilities.flatMap<RunnableFrontierTransition>((responsibility) => {
        if (responsibility._tag !== "StartedIntegrationResponsibility") return []
        const appliedQuarantineDirection = integrationQuarantineDirectionFor(
          runState.workflowHistory.records,
          responsibility
        )
        const quarantineDirection = appliedQuarantineDirection
        const claimObservedAt = latestClaimObservationPositionFor(responsibility.plannedAttempt.taskId)
        const taskGraphObservation = currentGraphObservationForTask(responsibility.plannedAttempt.taskId)
        const graphWasCheckedAfterClaim =
          claimObservedAt !== undefined &&
          taskGraphObservation !== undefined &&
          taskGraphObservation.position > claimObservedAt
        const claimIsExact =
          taskClaimAuthorityByAttemptId.get(responsibility.plannedAttempt.attemptId)?._tag === "Exact"
        const targetIsHeld = integrationResourceSnapshot.heldResponsibilityPositions.has(responsibility.queuedAt)
        const directionLineageOperationId =
          quarantineDirection === undefined
            ? undefined
            : integrationQuarantineDirectionTargetLineageOperationId(
                quarantineDirection,
                responsibility.plannedAttempt,
                taskGraphObservation?.position ?? quarantineDirection.directionAt
              )
        const directionLineageWasObserved =
          quarantineDirection !== undefined &&
          directionLineageOperationId !== undefined &&
          runState.workflowHistory.records.some(
            ({ event, position }) =>
              position > quarantineDirection.directionAt &&
              event._tag === "TargetLineageObserved" &&
              event.operationId === directionLineageOperationId &&
              plannedTaskAttemptEquivalence(event.plannedAttempt, responsibility.plannedAttempt)
          )
        const targetLineageReadIsRequired =
          quarantineDirection === undefined
            ? !targetLineageByAttemptId.has(responsibility.plannedAttempt.attemptId) ||
              targetLineageRefreshRequiredAttemptIds.has(responsibility.plannedAttempt.attemptId)
            : !directionLineageWasObserved
        const lineageReadIsReady =
          !integrationResourceSnapshot.activeResponsibilityPositions.has(responsibility.queuedAt) &&
          graphWasCheckedAfterClaim &&
          claimIsExact &&
          !pendingAttemptIds.has(responsibility.plannedAttempt.attemptId) &&
          targetLineageReadIsRequired &&
          !integration.transitions.some(
            (transition) =>
              transition._tag === "RunIntegrator" && transition.responsibility.queuedAt === responsibility.queuedAt
          ) &&
          !integration.transitions.some(
            (transition) =>
              transition._tag === "ReleaseStartedIntegrationTarget" &&
              transition.responsibility.queuedAt === responsibility.queuedAt
          )
        if (quarantineDirection !== undefined && !targetIsHeld && lineageReadIsReady) {
          return integration.transitions.some(
            (transition) =>
              transition._tag === "AcquireStartedIntegrationTarget" &&
              transition.responsibility.queuedAt === responsibility.queuedAt
          )
            ? []
            : [RunnableFrontierTransition.AcquireStartedIntegrationTarget({ responsibility })]
        }
        return targetIsHeld && lineageReadIsReady
          ? [
              RunnableFrontierTransition.ObservePlannedAttemptContinuationTargetLineage({
                operation: makeTargetLineageObservationOperation({
                  integrationTarget: target,
                  operationId: OperationId.make(
                    directionLineageOperationId === undefined
                      ? `integration-candidate:${responsibility.plannedAttempt.attemptId}:after:${responsibility.startedAt}:activation:${Option.getOrElse(requiredFreshnessBaseline, () => 0)}:target-lineage`
                      : directionLineageOperationId
                  ),
                  plannedAttempt: responsibility.plannedAttempt,
                  predecessorOperationIds:
                    quarantineDirection === undefined ? [] : [quarantineDirection.predecessorOperationId]
                }),
                plannedAttempt: responsibility.plannedAttempt
              })
            ]
          : []
      })
  })
  const unobservedClaimTaskIds = [...ordinary.explanations, ...integration.explanations].flatMap((explanation) =>
    (explanation._tag === "WorkflowOperationTaskClaimConstraint" ||
      explanation._tag === "IntegrationTaskClaimConstraint") &&
    explanation.claimState === "Unobserved"
      ? [explanation._tag === "IntegrationTaskClaimConstraint" ? explanation.plannedAttempt.taskId : explanation.taskId]
      : []
  )
  const claimObservationTransitions = [...new Set(unobservedClaimTaskIds)].sort().flatMap((taskId) => {
    const taskGraphObservation = currentGraphObservationForTask(taskId)
    return taskGraphObservation === undefined
      ? []
      : [
          RunnableFrontierTransition.ObserveResponsibleTaskClaim({
            operation: makeTaskClaimObservationOperation(
              OperationId.make(`responsibility:${taskId}:after:${taskGraphObservation.position}:claim`),
              taskGraphObservation.event.observation.target,
              taskId,
              [taskGraphObservation.event.operationId]
            ),
            taskId
          })
        ]
  })
  const frontier = {
    explanations: [
      ...ordinary.explanations,
      ...continuationDecisions.flatMap(({ explanation }) => (explanation === undefined ? [] : [explanation])),
      ...integration.explanations
    ],
    transitions: [
      ...pendingGitReadTransitions,
      ...claimObservationTransitions,
      ...continuationDecisions.flatMap(({ transition }) => (transition === undefined ? [] : [transition])),
      ...projectionRetryDecisions.map(({ transition }) => transition),
      ...integrationLineageTransitions,
      ...integration.transitions
    ]
  }
  const pendingGitReadReconciliations = new Set<RunnableFrontierTransition>(pendingGitReadTransitions)
  const heldIntegrationTaskIds = new Set(
    deriveIntegrationAdmission(runState.workflowHistory.records).responsibilities.flatMap((responsibility) =>
      responsibility._tag === "StartedIntegrationResponsibility" &&
      integrationResourceSnapshot.heldResponsibilityPositions.has(responsibility.queuedAt)
        ? [responsibility.plannedAttempt.taskId]
        : []
    )
  )
  return {
    acceptedAt: runState.appliedThrough,
    frontier: filterFrontierForActivePauses(
      frontier,
      settlementRunState,
      currentTaskGraph,
      pendingGitReadReconciliations,
      heldIntegrationTaskIds
    ),
    integrationWaits: integrationDeliveryWaitsOf(integration),
    responsibilityFacts
  }
})

const readRecoveredProjection = Effect.fn("RunRecoveryActivation.readRecoveredProjection")(function* (
  runId: RunId,
  integrationResources: IntegrationTargetResourceController,
  integrationTarget: Option.Option<IntegrationTarget>,
  activationBaselinePosition: Option.Option<JournalPosition>,
  targetPromotionConfigured: boolean,
  integrationFinalityConfigured: boolean,
  completionTaskConfigured: boolean
) {
  return yield* projectRecoveredRunState(
    yield* readRecoveredRunState(runId),
    integrationResources,
    integrationTarget,
    activationBaselinePosition,
    targetPromotionConfigured,
    integrationFinalityConfigured,
    completionTaskConfigured
  )
})

/** One reconstruction turn; process-local integration state is sampled exactly once. */
export interface RunRecoveryProjectionSnapshot {
  readonly evidence: DeliveryProjectionEvidence
  readonly frontier: RunnableFrontier
}

/** Exact shared failures that can prevent reconstruction of descriptive recovery evidence. */
export class RunRecoveryProjectionRunMismatch extends Schema.TaggedError<RunRecoveryProjectionRunMismatch>()(
  "RunRecoveryProjectionRunMismatch",
  { expectedRunId: RunId, receivedRunId: RunId }
) {}

export type RunRecoveryProjectionError =
  | Effect.Error<ReturnType<typeof readRecoveredProjection>>
  | RunRecoveryProjectionRunMismatch

/** Read-only reconstructed evidence consumed by delivery. */
export interface RunRecoveryProjectionSource {
  readonly readDeliveryProjection: Effect.Effect<RunRecoveryProjectionSnapshot, RunRecoveryProjectionError, never>
  readonly reconstructedPlannedAttemptPositions: ReadonlyArray<RequiredPlannedAttemptPosition>
}

type RunRecoveryProjectionService = RunRecoveryProjectionSource & {
  readonly _tag: "AuthoritativeRunRecoveryProjection"
  /** Projects an already-validated current journal state without replaying its complete history. */
  readonly projectDeliveryFrom: (
    runState: ReconstructedRunState
  ) => Effect.Effect<RunRecoveryProjectionSnapshot, RunRecoveryProjectionError, never>
  readonly runId: RunId
}

const isAuthoritativeRunRecoveryProjection = (
  source: RunRecoveryProjectionSource
): source is RunRecoveryProjectionService => "_tag" in source && source._tag === "AuthoritativeRunRecoveryProjection"

/**
 * Production recovery consumes the journal service's validated current state.
 * Explicit projection sources retain their read boundary.
 */
export const readDeliveryProjectionFrom = (
  source: RunRecoveryProjectionSource,
  runState: ReconstructedRunState
): Effect.Effect<RunRecoveryProjectionSnapshot, RunRecoveryProjectionError, never> => {
  if (!isAuthoritativeRunRecoveryProjection(source)) return source.readDeliveryProjection
  return source.runId === runState.runId
    ? source.projectDeliveryFrom(runState)
    : Effect.fail(new RunRecoveryProjectionRunMismatch({ expectedRunId: source.runId, receivedRunId: runState.runId }))
}

/**
 * Read-only current-run recovery evidence for the descriptive delivery relation.
 */
export class RunRecoveryProjection extends Context.Service<RunRecoveryProjection, RunRecoveryProjectionService>()(
  "@dalph/RunRecoveryProjection"
) {}

const recoveryProjectionSnapshot = (
  projection: Effect.Success<ReturnType<typeof readRecoveredProjection>>,
  frontier: RunnableFrontier = projection.frontier
): RunRecoveryProjectionSnapshot => ({
  evidence: {
    _tag: "AvailableDeliveryProjectionEvidence",
    acceptedAt: projection.acceptedAt,
    facts: projection.responsibilityFacts,
    integrationWaits: projection.integrationWaits
  },
  frontier
})

const samePositions = (left: ReadonlySet<JournalPosition>, right: ReadonlySet<JournalPosition>): boolean =>
  left.size === right.size && [...left].every((position) => right.has(position))

const sameIntegrationResourceSnapshot = (
  left: IntegrationTargetResourceSnapshot,
  right: IntegrationTargetResourceSnapshot
): boolean =>
  samePositions(left.activeResponsibilityPositions, right.activeResponsibilityPositions) &&
  samePositions(left.heldResponsibilityPositions, right.heldResponsibilityPositions)

interface JournalCurrentReconstructedState {
  readonly state: { readonly get: Effect.Effect<{ readonly reconstructed: ReconstructedRunState }> }
}

const hasCurrentReconstructedState = (journal: object): journal is object & JournalCurrentReconstructedState =>
  "state" in journal &&
  typeof journal.state === "object" &&
  journal.state !== null &&
  "get" in journal.state &&
  Effect.isEffect(journal.state.get)

const makeRunRecoveryProjectionEffect = Effect.fn("RunRecoveryProjection.makeAuthoritative")(function* (
  runId: RunId,
  integrationTarget: Option.Option<IntegrationTarget>,
  integrationResourcesOverride: IntegrationTargetResourceController | undefined,
  targetPromotionConfigured: boolean,
  integrationFinalityConfigured: boolean,
  completionTaskConfigured: boolean
) {
  const journal = yield* InRunJournal
  const integrationResources = integrationResourcesOverride ?? (yield* makeIntegrationTargetResourceController())
  const initialReduction = reduceWorkflowJournalHistory(runId, yield* journal.read(runId))
  if (initialReduction._tag === "InvalidWorkflowJournalHistory") return yield* Effect.fail(initialReduction)
  const initialRecords = initialReduction.runState.workflowHistory.records
  const activationBaselinePosition = latestJournalPosition(initialRecords)
  const reconstructedPlannedAttemptPositions = requiredPlannedAttemptPositionsOf(initialReduction.runState)
  const projectionByRunState = new WeakMap<
    ReconstructedRunState,
    { readonly resources: IntegrationTargetResourceSnapshot; readonly snapshot: RunRecoveryProjectionSnapshot }
  >()
  const projectDeliveryFrom = Effect.fn("RunRecoveryProjection.projectDeliveryFrom")(function* (
    runState: ReconstructedRunState
  ) {
    const resources = yield* integrationResources.snapshot
    const cached = projectionByRunState.get(runState)
    if (cached !== undefined && sameIntegrationResourceSnapshot(cached.resources, resources)) return cached.snapshot
    const snapshot = recoveryProjectionSnapshot(
      yield* projectRecoveredRunState(
        runState,
        integrationResources,
        integrationTarget,
        activationBaselinePosition,
        targetPromotionConfigured,
        integrationFinalityConfigured,
        completionTaskConfigured,
        resources
      )
    )
    // eslint-disable-next-line functional/immutable-data -- Process-local projection memo; journal and resources remain authoritative.
    projectionByRunState.set(runState, { resources, snapshot })
    return snapshot
  })
  const projection = !hasCurrentReconstructedState(journal)
    ? readRecoveredProjection(
        runId,
        integrationResources,
        integrationTarget,
        activationBaselinePosition,
        targetPromotionConfigured,
        integrationFinalityConfigured,
        completionTaskConfigured
      ).pipe(Effect.map(recoveryProjectionSnapshot), Effect.provideService(InRunJournal, journal))
    : journal.state.get.pipe(
        Effect.flatMap(({ reconstructed }) =>
          reconstructed.runId === runId
            ? projectDeliveryFrom(reconstructed)
            : Effect.fail(
                new RunRecoveryProjectionRunMismatch({ expectedRunId: runId, receivedRunId: reconstructed.runId })
              )
        )
      )
  return RunRecoveryProjection.of({
    _tag: "AuthoritativeRunRecoveryProjection",
    readDeliveryProjection: projection,
    projectDeliveryFrom,
    reconstructedPlannedAttemptPositions,
    runId
  })
})

/** Read-only projection reconstructed from the exact accepted Run history. */
export const makeRunRecoveryProjection = (
  runId: RunId,
  configuredIntegrationTarget?: IntegrationTarget,
  integrationResources?: IntegrationTargetResourceController,
  targetPromotion?: TargetPromotionRuntimeInput,
  integrationFinalityConfigured = false,
  completionTaskConfigured = false
) =>
  makeRunRecoveryProjectionEffect(
    runId,
    Option.fromUndefinedOr(configuredIntegrationTarget),
    integrationResources,
    targetPromotion !== undefined,
    integrationFinalityConfigured,
    completionTaskConfigured
  )
