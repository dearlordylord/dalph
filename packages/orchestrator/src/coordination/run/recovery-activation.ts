/* eslint-disable max-lines -- Fresh and authoritative activation must share one recovery authority boundary. */
import { Context, Effect, Layer, Option } from "effect"
import {
  type AttemptId,
  type IntegrationTarget,
  type PlannedTaskAttempt,
  plannedTaskAttemptEquivalence,
  type RunId,
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
import { deriveIntegrationAdmission } from "../../workflow/protocols/integration-admission/protocol.js"
import { deriveIntegrationFrontier, integrationDeliveryWaitsOf } from "../frontier/integration-frontier.js"
import {
  type IntegrationTargetResourceController,
  makeIntegrationTargetResourceController
} from "../admission/integration-target-resource.js"
import {
  type CandidateContinuationLimit,
  type CandidateCorrectionLimit
} from "../../workflow/protocols/integration-candidate-construction/protocol.js"
import { OperationId } from "../../workflow/identity.js"
import { isExactTaskClaim } from "../../authorities/task-tracker/claim-mutation.js"
import {
  latestTaskClaimReacquisitionDirection,
  taskClaimReacquisitionOperationId
} from "../../workflow/protocols/task-claim-reacquisition/plan.js"
import {
  targetVerificationRequestIdForCandidate,
  type TargetVerificationPlan
} from "../../workflow/protocols/target-verification/events.js"
import { targetPromotionRequestIdForCandidate } from "../../workflow/protocols/target-promotion/events.js"
import type { TargetVerificationRuntimeInput } from "../../workflow/protocols/target-verification/runtime.js"
import type { TargetPromotionRuntimeInput } from "../../workflow/protocols/target-promotion/runtime.js"
import {
  latestPlannedAttemptExecutorEvidence,
  latestUnsettledPlannedAttemptExecutorCommand
} from "../../workflow/protocols/planned-attempt-executor-work/evidence.js"
import { defaultPlannedAttemptExecutorSuspensionLimit } from "../../workflow/protocols/planned-attempt-executor-work/events.js"
import { sameAttemptChoiceRequestId, sameAttemptChoiceSubject } from "../../workflow/protocols/attempt-choice/events.js"

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
export { deriveIntegrationFrontier } from "../frontier/integration-frontier.js"

const finalRecordOffset = -1

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
    return ResponsibilityDisposition.StoppedAttemptClaimReleaseRequired({
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

const graphReconstructedAt = (
  records: ReadonlyArray<Pick<JournalRecord, "event" | "position">>,
  graphObservation: GraphObservationRecord
): TaskDagSnapshot | undefined =>
  Option.getOrUndefined(
    reconstructedTaskGraphFromEvents(
      records.filter(({ position }) => position <= graphObservation.position).map(({ event }) => event),
      graphObservation.event.observation.target
    )
  )

const taskPauseCoverageBoundaries = (
  records: ReadonlyArray<Pick<JournalRecord, "event" | "position">>,
  pause: TaskPauseEvent,
  pausePosition: JournalPosition,
  plannedAttempt: PlannedTaskAttempt,
  currentGraph: TaskDagSnapshot | undefined
): ReadonlyArray<JournalPosition> => {
  if (pause.subject.taskId === plannedAttempt.taskId) return [pausePosition]
  const unpausePosition = records.find(
    ({ event, position }) => position > pausePosition && isMatchingTaskUnpause(event, pause)
  )?.position
  const graphObservations = records
    .filter(isGraphObservationRecord)
    .filter(
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
const deriveJournalResponsibilityFacts = (
  runState: ReconstructedRunState,
  activationBaselinePosition: Option.Option<JournalPosition> = Option.none()
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
      const transition = workflowJournalTransitionRuleFor(event._tag)
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
    /* v8 ignore start -- @preserve Maintained crash cassettes cover owed and settled suspension; these chronological guards exclude historical Pause cycles and already-safe attempts. */
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
    /* v8 ignore stop -- @preserve */
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
      if (acquiredClaim?._tag !== "TaskClaimAcquired") return undefined
      if (currentClaimFacts.observation.observation._tag === "UnclaimedTask") {
        return ResponsibilityDisposition.TaskClaimMissingConstraint()
      }
      return isExactTaskClaim(currentClaimFacts.observation.observation, acquiredClaim.claim)
        ? undefined
        : ResponsibilityDisposition.TaskForeignClaimIsolation()
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
    const stopDisposition = stoppedAttemptDisposition(
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
    const taskStateDisposition = (): PlannedAttemptExecutorDisposition | undefined => {
      if (stopDisposition !== undefined) return stopDisposition
      if (report?.report._tag === "Terminal") {
        return ResponsibilityDisposition.PlannedAttemptExecutorWorkTerminal({ report: report.report })
      }
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
      disposition._tag !== "StoppedAttemptSettled"
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

const completedTaskPauseCycles = (
  runState: ReconstructedRunState
): ReadonlyArray<{ readonly position: JournalPosition; readonly taskId: TaskId }> =>
  runState.workflowHistory.records.flatMap(({ event, position }) => {
    if (event._tag !== "ControlDirectionApplied" || event.direction !== "Unpause" || event.subject._tag !== "Task") {
      return []
    }
    const taskId = event.subject.taskId
    const completesPause = runState.workflowHistory.records.some(
      ({ event: candidate, position: candidatePosition }) =>
        candidatePosition < position &&
        candidate._tag === "ControlDirectionApplied" &&
        candidate.direction === "Pause" &&
        candidate.subject._tag === "Task" &&
        candidate.subject.taskId === taskId
    )
    return completesPause ? [{ position, taskId }] : []
  })

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
const continuationFreshnessBaselineForAttempt = (
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

const continuationRequiresFreshFacts = (
  runState: ReconstructedRunState,
  plannedAttempt: PlannedTaskAttempt
): boolean => {
  return (
    latestCompletedPauseCyclePosition(runState) !== undefined ||
    appliedContinueChoicePositionFor(runState.workflowHistory.records, plannedAttempt) !== undefined
  )
}

const transitionTagsAllowedWhilePaused = new Set<RunnableFrontierTransition["_tag"]>([
  "AdvanceAttemptStoppage",
  "CheckTaskClaim",
  "ObserveAttemptStoppageExecutor",
  "ObserveStoppedAttemptClaim",
  "RecordStoppedAttemptClaimNoRelease",
  "ReconcileTaskClaim",
  "ReconcileTaskClaimRelease",
  "ReconcileTaskWorktree",
  "ReleaseStoppedAttemptClaim",
  "SuspendPlannedAttemptExecutorWork",
  "ReleaseStartedIntegrationTarget"
])
const transitionTagsAllowedToFinishHeldIntegration = new Set<RunnableFrontierTransition["_tag"]>([
  "ContinueStartedIntegrationCandidate",
  "RunTargetVerification",
  "RunTargetPromotion",
  "ReplacePromotedTaskClaim",
  "DeleteCompletedTaskCompletionClaim",
  "ObservePlannedAttemptContinuationTargetLineage",
  "ObserveResponsibleTaskClaim",
  "ReleaseStartedIntegrationTarget"
])
const transitionMayRunWhileRunPaused = (transition: RunnableFrontierTransition): boolean =>
  transitionTagsAllowedWhilePaused.has(transition._tag)

const recordBeforePause = (
  records: ReadonlyArray<JournalRecord>,
  pausePosition: JournalPosition,
  predicate: (record: JournalRecord) => boolean
): boolean => records.some((record) => record.position < pausePosition && predicate(record))

type PausedIntegrationReconciliation = Extract<
  RunnableFrontierTransition,
  {
    readonly _tag:
      | "AcquireStartedIntegrationTarget"
      | "ContinueStartedIntegrationCandidate"
      | "RunTargetPromotion"
      | "RunTargetVerification"
  }
>

const pausedIntegrationReconciliationTags: ReadonlySet<RunnableFrontierTransition["_tag"]> = new Set([
  "AcquireStartedIntegrationTarget",
  "ContinueStartedIntegrationCandidate",
  "RunTargetPromotion",
  "RunTargetVerification"
])

const isPausedIntegrationReconciliation = (
  transition: RunnableFrontierTransition
): transition is PausedIntegrationReconciliation => pausedIntegrationReconciliationTags.has(transition._tag)

/** A crashed candidate request may finish only when its exact intent predates the active Run Pause. */
/* v8 ignore start -- @preserve Candidate protocol tests cover durable intent correlation; the authored cursor cannot yet crash inside this boundary. */
const startedIntegrationIntentMayReconcileBeforePause = (
  transition: RunnableFrontierTransition,
  records: ReadonlyArray<JournalRecord>,
  pausePosition: JournalPosition | undefined
): boolean => {
  if (pausePosition === undefined || !isPausedIntegrationReconciliation(transition)) return false
  switch (transition._tag) {
    case "RunTargetVerification":
      return recordBeforePause(
        records,
        pausePosition,
        ({ event }) =>
          event._tag === "TargetVerificationIntended" &&
          event.correlation.requestId ===
            targetVerificationRequestIdForCandidate(transition.candidate.correlation.candidateId)
      )
    case "RunTargetPromotion":
      return recordBeforePause(
        records,
        pausePosition,
        ({ event }) =>
          event._tag === "TargetPromotionIntended" &&
          event.correlation.requestId ===
            targetPromotionRequestIdForCandidate(transition.candidate.correlation.candidateId)
      )
    case "AcquireStartedIntegrationTarget":
    case "ContinueStartedIntegrationCandidate":
      return recordBeforePause(
        records,
        pausePosition,
        ({ event }) =>
          event._tag === "IntegrationCandidateConstructionIntended" &&
          event.startedAt === transition.responsibility.startedAt
      )
  }
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

const filterFrontierForActivePauses = (
  frontier: RunnableFrontier,
  runState: ReconstructedRunState,
  currentTaskGraph: TaskDagSnapshot | undefined,
  pendingGitReadReconciliations: ReadonlySet<RunnableFrontierTransition>,
  heldIntegrationTaskIds: ReadonlySet<TaskId>
): RunnableFrontier => {
  const runPausePosition = runState.workflowHistory.records.findLast(
    ({ event }) =>
      event._tag === "ControlDirectionApplied" && event.direction === "Pause" && event.subject._tag === "Run"
  )?.position
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
  const transitions =
    runState.pause.run._tag === "RunPaused"
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
/* v8 ignore stop -- @preserve */

type CurrentGraphObservation = {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "TaskTrackerFactsObserved" }>
  readonly position: JournalPosition
}

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
  currentSpecificationRecord: JournalRecord,
  integrationTarget: Option.Option<IntegrationTarget>
): ContinuationDecision => {
  const plannedAttempt = transition.plannedAttempt
  const authorizedClaim = authorizedClaimForAttempt(records, plannedAttempt)
  const authorizedClaimRecord =
    authorizedClaim === undefined
      ? undefined
      : records.findLast(
          ({ event }) =>
            event._tag === "TaskClaimAcquired" && event.claim.operationId === authorizedClaim.claim.operationId
        )
  const claimObservationCutoff = Math.max(
    currentSpecificationRecord.position,
    authorizedClaimRecord?.position ?? currentSpecificationRecord.position
  )
  const currentClaimRecord = records.findLast(
    ({ event, position }) =>
      event._tag === "TaskTrackerFactsObserved" &&
      (event.observation._tag === "FocusedTaskClaimFacts" ||
        event.observation._tag === "FocusedTaskClaimFactsUnreadable") &&
      event.observation.coverage.taskId === plannedAttempt.taskId &&
      position > claimObservationCutoff
  )
  if (currentClaimRecord !== undefined) {
    const currentClaimEvent = currentClaimRecord.event
    const currentClaimIsExact =
      authorizedClaim !== undefined &&
      currentClaimEvent._tag === "TaskTrackerFactsObserved" &&
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
      ({ event, position }) =>
        event._tag === "PlannedAttemptWorktreeObserved" &&
        position > currentClaimRecord.position &&
        currentWorktreeReadOperationIds.has(event.operationId)
    )
    if (
      currentWorktreeRecord?.event._tag === "PlannedAttemptWorktreeObserved" &&
      currentWorktreeRecord.event.observation._tag === "PlannedWorktreeReady"
    ) {
      const appliedContinueChoicePosition = appliedContinueChoicePositionFor(records, plannedAttempt)
      if (Option.isNone(integrationTarget)) {
        return appliedContinueChoicePosition === undefined
          ? { transition }
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
        if (appliedContinueChoicePosition === undefined) return { transition }
        const currentExecutorEvidence = latestPlannedAttemptExecutorEvidence(
          records,
          plannedAttempt,
          currentTargetLineageRecord.position
        )
        if (currentExecutorEvidence === undefined) {
          return {
            transition: RunnableFrontierTransition.ObservePlannedAttemptContinuationExecutor({ plannedAttempt })
          }
        }
        return currentExecutorEvidence.source._tag !== "CommandResponse" &&
          currentExecutorEvidence.report._tag === "SafelySuspended"
          ? { transition }
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
            predecessorOperationIds: [currentWorktreeRecord.event.operationId]
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
            /* v8 ignore next -- @preserve This branch follows a narrowed task-tracker observation record. */
            ...(currentSpecificationRecord.event._tag === "TaskTrackerFactsObserved"
              ? [currentSpecificationRecord.event.operationId]
              : []),
            /* v8 ignore next -- @preserve This branch follows a narrowed task-tracker observation record. */
            ...(currentClaimRecord.event._tag === "TaskTrackerFactsObserved"
              ? [currentClaimRecord.event.operationId]
              : [])
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
          /* v8 ignore next -- @preserve The selecting predicate narrows this record to TaskTrackerFactsObserved. */
          ...(currentSpecificationRecord.event._tag === "TaskTrackerFactsObserved"
            ? [currentSpecificationRecord.event.operationId]
            : [])
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

const continuationDecisionFor = (
  transition: RunnableFrontierTransition,
  records: ReadonlyArray<JournalRecord>,
  currentGraphObservation: CurrentGraphObservation | undefined,
  activationBaselinePosition: Option.Option<JournalPosition>,
  integrationTarget: Option.Option<IntegrationTarget>
): ContinuationDecision => {
  if (transition._tag !== "ContinuePlannedAttemptExecutorWork") return { transition }
  const plannedAttempt = transition.plannedAttempt
  const plan = records.find(
    ({ event }) =>
      event._tag === "TaskAttemptPlanned" && event.operation.plannedAttempt.attemptId === plannedAttempt.attemptId
  )?.event
  /* v8 ignore next -- @preserve A recovered executor-work responsibility always has its journaled task plan. */
  const planOperationId = plan?._tag === "TaskAttemptPlanned" ? plan.operation.operationId : undefined
  if (currentGraphObservation === undefined) {
    return decisionWithoutCurrentGraph(plannedAttempt, planOperationId, records, activationBaselinePosition)
  }
  const currentSpecificationRecord = records.findLast(
    ({ event, position }) =>
      event._tag === "TaskTrackerFactsObserved" &&
      event.observation._tag === "FocusedTaskWorkSpecificationFacts" &&
      event.observation.factFamily.taskId === plannedAttempt.taskId &&
      position > currentGraphObservation.position
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

const journaledFreshExplanationTags = new Set<FrontierExplanation["_tag"]>([
  "AttemptStoppageWait",
  "IntegrationDependencyWait",
  "IntegrationConfigurationWait",
  "IntegrationInProgress",
  "IntegrationTrackerFactsWait",
  "IntegrationTargetWait",
  "TargetPromotionConfigurationWait",
  "TargetVerificationConfigurationWait",
  "PlannedAttemptTaskLifecycleConstraint",
  "PlannedAttemptGitConstraint",
  "PlannedAttemptTaskClaimConstraint",
  "PlannedAttemptTaskExternalSuccessConstraint",
  "PlannedAttemptTaskMembershipConstraint",
  "PlannedAttemptTaskSpecificationChangeConstraint",
  "StoppedAttemptClaimPlanningWait",
  "StoppedAttemptClaimReleasePending",
  "StoppedAttemptClaimWait",
  "StoppedAttemptSettled",
  "WorkflowOperationTaskMembershipConstraint"
])

const journaledFreshTransitionTags = new Set<RunnableFrontierTransition["_tag"]>([
  "AcquireStartedIntegrationTarget",
  "AdvanceAttemptStoppage",
  "CommitTaskClaimReacquisitionIntent",
  "ContinueStartedIntegrationCandidate",
  "RunTargetVerification",
  "RunTargetPromotion",
  "ObservePlannedAttemptContinuationGraph",
  "ObserveAttemptStoppageExecutor",
  "ObservePlannedAttemptContinuationClaim",
  "ObservePlannedAttemptContinuationExecutor",
  "ObservePlannedAttemptContinuationSpecification",
  "ObservePlannedAttemptContinuationTargetLineage",
  "ObservePlannedAttemptContinuationWorktree",
  "ObserveResponsibleTaskClaim",
  "ObserveStoppedAttemptClaim",
  "QueueAcceptedResultIntegrationResponsibility",
  "ReleaseExternallyCompletedTaskClaim",
  "RecordStoppedAttemptClaimNoRelease",
  "ReleaseStoppedAttemptClaim",
  "ReleaseStartedIntegrationTarget",
  "SuspendPlannedAttemptExecutorWork",
  "StartQueuedIntegration"
])

const readRecoveredProjection = Effect.fn("RunRecoveryActivation.readRecoveredProjection")(function* (
  runId: RunId,
  integrationResources: IntegrationTargetResourceController,
  integrationTarget: Option.Option<IntegrationTarget>,
  activationBaselinePosition: Option.Option<JournalPosition>,
  candidateCorrectionLimit: Option.Option<CandidateCorrectionLimit>,
  candidateContinuationLimit: Option.Option<CandidateContinuationLimit>,
  targetVerificationPlan: Option.Option<TargetVerificationPlan>,
  targetPromotionConfigured: boolean,
  integrationFinalityConfigured: boolean
) {
  const runState = yield* readRecoveredRunState(runId)
  const currentTaskGraph = Option.getOrUndefined(latestReconstructedTaskGraph(runState.graphKnowledge))
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
  const responsibilityFacts = deriveJournalResponsibilityFacts(runState, activationBaselinePosition)
  const ordinary = deriveRunnableFrontier({
    freshEligibleTasks: [],
    responsibility: runState.responsibility,
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
        return !runState.workflowHistory.records.some(
          ({ event }) =>
            (event._tag === "PlannedAttemptWorktreeObserved" || event._tag === "TargetLineageObserved") &&
            event.operationId === operationId
        )
      }
    )
    .filter(
      (record, index, pending) =>
        pending.findLastIndex(({ event }) =>
          plannedTaskAttemptEquivalence(event.operation.plannedAttempt, record.event.operation.plannedAttempt)
        ) === index
    )
  const pendingAttemptIds = new Set(pendingGitReadIntents.map(({ event }) => event.operation.plannedAttempt.attemptId))
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
  const integrationResourceSnapshot = yield* integrationResources.snapshot
  const activationTargetLineage = runState.workflowHistory.records.flatMap(({ event, position }) => {
    if (event._tag !== "TargetLineageObserved") return []
    const taskBaseline = freshnessBaselineForTask(event.plannedAttempt.taskId)
    return positionIsAfter(position, taskBaseline) ? [[event.plannedAttempt.attemptId, event.observation] as const] : []
  })
  const targetLineageByAttemptId = new Map(activationTargetLineage)
  const activeClaimByAttemptId = new Map(
    runState.workflowHistory.records.flatMap(({ event }) => {
      if (event._tag !== "TaskAttemptPlanned") return []
      const claim = authorizedClaimForAttempt(runState.workflowHistory.records, event.operation.plannedAttempt)?.claim
      return claim === undefined ? [] : [[event.operation.plannedAttempt.attemptId, claim] as const]
    })
  )
  const latestClaimObservationPositionFor = (taskId: TaskId) =>
    runState.workflowHistory.records.findLast(
      ({ event, position }) =>
        positionIsAfter(position, freshnessBaselineForTask(taskId)) &&
        event._tag === "TaskTrackerFactsObserved" &&
        (event.observation._tag === "FocusedTaskClaimFacts" ||
          event.observation._tag === "FocusedTaskClaimFactsUnreadable") &&
        event.observation.coverage.taskId === taskId
    )?.position
  const integration = deriveIntegrationFrontier(runState, {
    ...integrationResourceSnapshot,
    candidateCorrectionLimit,
    candidateContinuationLimit,
    currentTrackerTaskIds,
    integrationTarget,
    targetLineageByAttemptId,
    targetVerificationPlan,
    targetPromotionConfigured,
    activeClaimByAttemptId,
    integrationFinalityConfigured,
    taskClaimAuthorityByAttemptId: new Map(
      runState.workflowHistory.records.flatMap(({ event }) => {
        if (event._tag !== "TaskAttemptPlanned") return []
        const { plannedAttempt } = event.operation
        return [
          [
            plannedAttempt.attemptId,
            currentTaskClaimAuthority(
              runState.workflowHistory.records,
              plannedAttempt.taskId,
              authorizedClaimForAttempt(runState.workflowHistory.records, plannedAttempt)?.claim,
              freshnessBaselineForTask(plannedAttempt.taskId)
            )
          ] as const
        ]
      })
    )
  })
  const integrationLineageTransitions = Option.match(integrationTarget, {
    onNone: () => [],
    onSome: (target) =>
      // eslint-disable-next-line complexity -- Candidate lineage starts only after the exact responsibility passes every current authority gate.
      deriveIntegrationAdmission(runState.workflowHistory.records).responsibilities.flatMap((responsibility) => {
        if (responsibility._tag !== "StartedIntegrationResponsibility") return []
        const claimObservedAt = latestClaimObservationPositionFor(responsibility.plannedAttempt.taskId)
        const taskGraphObservation = currentGraphObservationForTask(responsibility.plannedAttempt.taskId)
        const graphWasCheckedAfterClaim =
          claimObservedAt !== undefined &&
          taskGraphObservation !== undefined &&
          taskGraphObservation.position > claimObservedAt
        return integrationResourceSnapshot.heldResponsibilityPositions.has(responsibility.queuedAt) &&
          graphWasCheckedAfterClaim &&
          !pendingAttemptIds.has(responsibility.plannedAttempt.attemptId) &&
          !targetLineageByAttemptId.has(responsibility.plannedAttempt.attemptId) &&
          !integration.transitions.some(
            (transition) =>
              transition._tag === "ReleaseStartedIntegrationTarget" &&
              transition.responsibility.queuedAt === responsibility.queuedAt
          )
          ? [
              RunnableFrontierTransition.ObservePlannedAttemptContinuationTargetLineage({
                operation: makeTargetLineageObservationOperation({
                  integrationTarget: target,
                  operationId: OperationId.make(
                    `integration-candidate:${responsibility.plannedAttempt.attemptId}:after:${responsibility.startedAt}:activation:${Option.getOrElse(requiredFreshnessBaseline, () => 0)}:target-lineage`
                  ),
                  plannedAttempt: responsibility.plannedAttempt,
                  predecessorOperationIds: []
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
    recoveredContinuationAttemptIds: new Set(
      runState.responsibility.entries.flatMap((responsibility) =>
        responsibility._tag === "PlannedAttemptExecutorWorkResponsibility" &&
        continuationRequiresFreshFacts(runState, responsibility.plannedAttempt)
          ? [responsibility.plannedAttempt.attemptId]
          : []
      )
    ),
    frontier: filterFrontierForActivePauses(
      frontier,
      runState,
      currentTaskGraph,
      pendingGitReadReconciliations,
      heldIntegrationTaskIds
    ),
    integrationWaits: integrationDeliveryWaitsOf(integration),
    responsibilityFacts
  }
})

const journaledFreshFrontierOf = (
  frontier: RunnableFrontier,
  recoveredContinuationAttemptIds: ReadonlySet<AttemptId>
): RunnableFrontier => ({
  explanations: frontier.explanations.filter(({ _tag }) => journaledFreshExplanationTags.has(_tag)),
  transitions: frontier.transitions.filter(
    (transition) =>
      journaledFreshTransitionTags.has(transition._tag) ||
      (transition._tag === "ContinuePlannedAttemptExecutorWork" &&
        recoveredContinuationAttemptIds.has(transition.plannedAttempt.attemptId))
  )
})

/** One reconstruction turn; process-local integration state is sampled exactly once. */
export interface RunRecoveryProjectionSnapshot {
  readonly evidence: DeliveryProjectionEvidence
  readonly frontier: RunnableFrontier
}

/** Exact shared failures that can prevent reconstruction of descriptive recovery evidence. */
export type RunRecoveryProjectionError = Effect.Error<ReturnType<typeof readRecoveredProjection>>

/** Read-only reconstructed evidence consumed by delivery. */
export interface RunRecoveryProjectionSource {
  readonly readDeliveryProjection: Effect.Effect<RunRecoveryProjectionSnapshot, RunRecoveryProjectionError, never>
  readonly reconstructedPlannedAttemptPositions: ReadonlyArray<{
    readonly attemptId: AttemptId
    readonly runId: RunId
    readonly taskId: TaskId
  }>
}

/** A non-journaled composition has no recovered-transition capability. */
type RunRecoveryProjectionService =
  | (RunRecoveryProjectionSource & { readonly _tag: "AuthoritativeRunRecoveryProjection"; readonly runId: RunId })
  | (RunRecoveryProjectionSource & { readonly _tag: "JournaledFreshRunProjection"; readonly runId: RunId })

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

const makeJournaledFreshRunRecoveryProjectionEffect = Effect.fn("RunRecoveryProjection.makeJournaledFresh")(function* (
  runId: RunId,
  integrationTarget: Option.Option<IntegrationTarget>,
  candidateCorrectionLimit: Option.Option<CandidateCorrectionLimit>,
  candidateContinuationLimit: Option.Option<CandidateContinuationLimit>,
  targetVerificationPlan: Option.Option<TargetVerificationPlan>,
  integrationResourcesOverride: IntegrationTargetResourceController | undefined,
  targetPromotionConfigured: boolean,
  integrationFinalityConfigured: boolean
) {
  const journal = yield* InRunJournal
  const integrationResources = integrationResourcesOverride ?? (yield* makeIntegrationTargetResourceController())
  const activationBaselinePosition = latestJournalPosition(yield* journal.read(runId))
  const projection = readRecoveredProjection(
    runId,
    integrationResources,
    integrationTarget,
    activationBaselinePosition,
    candidateCorrectionLimit,
    candidateContinuationLimit,
    targetVerificationPlan,
    targetPromotionConfigured,
    integrationFinalityConfigured
  ).pipe(
    Effect.map((current) =>
      recoveryProjectionSnapshot(
        current,
        journaledFreshFrontierOf(current.frontier, current.recoveredContinuationAttemptIds)
      )
    ),
    Effect.provideService(InRunJournal, journal)
  )
  return RunRecoveryProjection.of({
    _tag: "JournaledFreshRunProjection",
    readDeliveryProjection: projection,
    reconstructedPlannedAttemptPositions: [],
    runId
  })
})

/** Read-only projection for a live Run begun by this process. */
export const makeJournaledFreshRunRecoveryProjection = (
  runId: RunId,
  configuredIntegrationTarget?: IntegrationTarget,
  candidateCorrectionLimit?: CandidateCorrectionLimit,
  candidateContinuationLimit?: CandidateContinuationLimit,
  integrationResources?: IntegrationTargetResourceController,
  targetVerification?: TargetVerificationRuntimeInput,
  targetPromotion?: TargetPromotionRuntimeInput,
  integrationFinalityConfigured = false
) =>
  makeJournaledFreshRunRecoveryProjectionEffect(
    runId,
    Option.fromUndefinedOr(configuredIntegrationTarget),
    Option.fromUndefinedOr(candidateCorrectionLimit),
    Option.fromUndefinedOr(candidateContinuationLimit),
    Option.fromUndefinedOr(targetVerification?.plan),
    integrationResources,
    targetPromotion !== undefined,
    integrationFinalityConfigured
  )

const makeRunRecoveryProjectionEffect = Effect.fn("RunRecoveryProjection.makeAuthoritative")(function* (
  runId: RunId,
  integrationTarget: Option.Option<IntegrationTarget>,
  candidateCorrectionLimit: Option.Option<CandidateCorrectionLimit>,
  candidateContinuationLimit: Option.Option<CandidateContinuationLimit>,
  targetVerificationPlan: Option.Option<TargetVerificationPlan>,
  integrationResourcesOverride: IntegrationTargetResourceController | undefined,
  targetPromotionConfigured: boolean,
  integrationFinalityConfigured: boolean
) {
  const journal = yield* InRunJournal
  const integrationResources = integrationResourcesOverride ?? (yield* makeIntegrationTargetResourceController())
  const initialReduction = reduceWorkflowJournalHistory(runId, yield* journal.read(runId))
  if (initialReduction._tag === "InvalidWorkflowJournalHistory") return yield* Effect.fail(initialReduction)
  const initialRecords = initialReduction.runState.workflowHistory.records
  const activationBaselinePosition = latestJournalPosition(initialRecords)
  const reconstructedPlannedAttemptPositions = initialReduction.runState.responsibility.entries.flatMap(
    (responsibility) => {
      if (responsibility._tag !== "PlannedAttemptExecutorWorkResponsibility") return []
      const abandoned = initialRecords.some(
        ({ event }) =>
          event._tag === "AttemptImplementationAbandoned" &&
          plannedTaskAttemptEquivalence(event.subject.plannedAttempt, responsibility.plannedAttempt)
      )
      const evidence = latestPlannedAttemptExecutorEvidence(initialRecords, responsibility.plannedAttempt)
      const laterCommandExists =
        evidence !== undefined &&
        initialRecords.some(
          ({ event, position }) =>
            position > evidence.observedAt &&
            event._tag === "PlannedAttemptExecutorCommandIntended" &&
            event.plannedAttempt.runId === responsibility.plannedAttempt.runId &&
            event.plannedAttempt.attemptId === responsibility.plannedAttempt.attemptId
        )
      return abandoned ||
        (evidence !== undefined &&
          !laterCommandExists &&
          (evidence.report._tag === "SafelySuspended" || evidence.report._tag === "Terminal"))
        ? []
        : [
            {
              attemptId: responsibility.plannedAttempt.attemptId,
              runId: responsibility.plannedAttempt.runId,
              taskId: responsibility.plannedAttempt.taskId
            }
          ]
    }
  )
  const projection = readRecoveredProjection(
    runId,
    integrationResources,
    integrationTarget,
    activationBaselinePosition,
    candidateCorrectionLimit,
    candidateContinuationLimit,
    targetVerificationPlan,
    targetPromotionConfigured,
    integrationFinalityConfigured
  ).pipe(Effect.map(recoveryProjectionSnapshot), Effect.provideService(InRunJournal, journal))
  return RunRecoveryProjection.of({
    _tag: "AuthoritativeRunRecoveryProjection",
    readDeliveryProjection: projection,
    reconstructedPlannedAttemptPositions,
    runId
  })
})

/** Read-only projection reconstructed from the exact accepted Run history. */
export const makeRunRecoveryProjection = (
  runId: RunId,
  configuredIntegrationTarget?: IntegrationTarget,
  candidateCorrectionLimit?: CandidateCorrectionLimit,
  candidateContinuationLimit?: CandidateContinuationLimit,
  integrationResources?: IntegrationTargetResourceController,
  targetVerification?: TargetVerificationRuntimeInput,
  targetPromotion?: TargetPromotionRuntimeInput,
  integrationFinalityConfigured = false
) =>
  makeRunRecoveryProjectionEffect(
    runId,
    Option.fromUndefinedOr(configuredIntegrationTarget),
    Option.fromUndefinedOr(candidateCorrectionLimit),
    Option.fromUndefinedOr(candidateContinuationLimit),
    Option.fromUndefinedOr(targetVerification?.plan),
    integrationResources,
    targetPromotion !== undefined,
    integrationFinalityConfigured
  )

export const journaledFreshRunRecoveryProjectionLayer = (
  runId: RunId,
  configuredIntegrationTarget?: IntegrationTarget,
  candidateCorrectionLimit?: CandidateCorrectionLimit,
  candidateContinuationLimit?: CandidateContinuationLimit,
  targetVerification?: TargetVerificationRuntimeInput,
  targetPromotion?: TargetPromotionRuntimeInput,
  integrationFinalityConfigured = false
) =>
  Layer.effect(
    RunRecoveryProjection,
    makeJournaledFreshRunRecoveryProjection(
      runId,
      configuredIntegrationTarget,
      candidateCorrectionLimit,
      candidateContinuationLimit,
      undefined,
      targetVerification,
      targetPromotion,
      integrationFinalityConfigured
    )
  )
