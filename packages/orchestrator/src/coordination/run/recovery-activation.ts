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
import type { ResponsibilityFreshFacts } from "../frontier/fresh-facts.js"
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
import { TargetLineageObservation } from "../../authorities/git/target-lineage.js"
import {
  latestTaskClaimReacquisitionDirection,
  taskClaimReacquisitionOperationId
} from "../../workflow/protocols/task-claim-reacquisition/plan.js"

import {
  makeTaskClaimReleaseOperation,
  makeTaskClaimObservationOperation,
  makeTargetLineageObservationOperation,
  makeTaskWorktreeObservationOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTrackerGraphObservationOperation
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

const isSuspensionSettlementFor = (event: JournalRecord["event"], plannedAttempt: PlannedTaskAttempt): boolean =>
  isExecutorReportFor(event, plannedAttempt) &&
  event._tag === "PlannedAttemptExecutorWorkReported" &&
  (event.report._tag === "SafelySuspended" || event.report._tag === "Terminal")

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
  return runState.responsibility.entries.map((responsibility) => {
    if (responsibility._tag !== "PlannedAttemptExecutorWorkResponsibility") {
      const settled = settledOperationIds.has(workflowResponsibilityOperationId(responsibility))
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
      return {
        _tag: "WorkflowOperationFreshFacts" as const,
        disposition: !settled
          ? taskLeftMembership(responsibility.taskId)
            ? ResponsibilityDisposition.TaskMembershipConstraint()
            : claimAuthority !== undefined && claimAuthority._tag !== "Exact"
              ? ResponsibilityDisposition.WorkflowOperationTaskClaimConstraint({ claimState: claimAuthority._tag })
              : ResponsibilityDisposition.Ready()
          : ResponsibilityDisposition.Settled({ outcome: "ResponsibilityCompleted" }),
        responsibility
      }
    }
    const report = records.findLast(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkReported" &&
        event.report.correlation.runId === responsibility.plannedAttempt.runId &&
        event.report.correlation.attemptId === responsibility.plannedAttempt.attemptId
    )?.event
    const paused = reconstructedTaskIsPaused(
      runState.pause,
      responsibility.plannedAttempt.taskId,
      Option.getOrUndefined(latestTaskGraph)
    )
    const safelySuspended =
      report?._tag === "PlannedAttemptExecutorWorkReported" && report.report._tag === "SafelySuspended"
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
    const acquiredClaim = authorizedClaimForAttempt(records, responsibility.plannedAttempt)
    const currentClaimRecord = records.findLast(
      ({ event, position }) =>
        event._tag === "TaskTrackerFactsObserved" &&
        (event.observation._tag === "FocusedTaskClaimFacts" ||
          event.observation._tag === "FocusedTaskClaimFactsUnreadable") &&
        event.observation.coverage.taskId === responsibility.plannedAttempt.taskId &&
        positionIsAfter(position, freshnessBaselineForTask(responsibility.plannedAttempt.taskId))
    )
    const currentClaimFacts = currentClaimRecord?.event
    const committedReacquisitionIntent = records.findLast(
      ({ event }) =>
        event._tag === "TaskClaimAcquisitionIntended" &&
        event.operation.authority._tag === "ExplicitTaskClaimReacquisitionAuthority" &&
        event.operation.acquisition.taskId === responsibility.plannedAttempt.taskId
    )
    const committedReacquisition =
      committedReacquisitionIntent?.event._tag === "TaskClaimAcquisitionIntended" &&
      committedReacquisitionIntent.event.operation.authority._tag === "ExplicitTaskClaimReacquisitionAuthority"
        ? {
            requestId: committedReacquisitionIntent.event.operation.authority.requestId,
            operation: committedReacquisitionIntent.event.operation
          }
        : undefined
    const committedReacquisitionOutcome =
      committedReacquisition !== undefined
        ? records.findLast(
            ({ event }) =>
              (event._tag === "TaskClaimAcquired" &&
                event.claim.operationId === committedReacquisition.operation.acquisition.operationId) ||
              (event._tag === "TaskClaimAcquisitionRejected" &&
                event.operationId === committedReacquisition.operation.acquisition.operationId)
          )
        : undefined
    const committedReacquisitionDirection =
      committedReacquisition !== undefined &&
      (committedReacquisitionOutcome === undefined ||
        currentClaimRecord === undefined ||
        currentClaimRecord.position < committedReacquisitionOutcome.position)
        ? records.findLast(
            ({ event }) =>
              event._tag === "TaskClaimReacquisitionDirected" && event.requestId === committedReacquisition.requestId
          )?.event
        : undefined
    const reacquisitionDirection =
      committedReacquisitionDirection?._tag === "TaskClaimReacquisitionDirected"
        ? committedReacquisitionDirection
        : currentClaimRecord === undefined || acquiredClaim?._tag !== "TaskClaimAcquired"
          ? undefined
          : latestTaskClaimReacquisitionDirection(
              records,
              responsibility.plannedAttempt.runId,
              responsibility.plannedAttempt.taskId,
              acquiredClaim.claim,
              /* v8 ignore next -- @preserve Recovery responsibility derivation always reads a non-empty run journal. */
              records.at(finalRecordOffset)?.position ?? currentClaimRecord.position
            )
    const reacquisitionRequestId =
      reacquisitionDirection?._tag === "TaskClaimReacquisitionDirected" ? reacquisitionDirection.requestId : undefined
    const reacquisitionOperationId =
      reacquisitionRequestId === undefined ? undefined : taskClaimReacquisitionOperationId(reacquisitionRequestId)
    const reacquisitionIntentExists =
      reacquisitionOperationId !== undefined &&
      records.some(
        ({ event }) =>
          event._tag === "TaskClaimAcquisitionIntended" &&
          event.operation.authority._tag === "ExplicitTaskClaimReacquisitionAuthority" &&
          event.operation.authority.requestId === reacquisitionRequestId &&
          event.operation.acquisition.operationId === reacquisitionOperationId
      )
    const reacquisitionOutcomeRecord =
      reacquisitionOperationId === undefined
        ? undefined
        : records.findLast(
            ({ event }) => event._tag === "TaskClaimAcquired" && event.claim.operationId === reacquisitionOperationId
          )
    const claimConstraint =
      reacquisitionOutcomeRecord !== undefined &&
      currentClaimRecord !== undefined &&
      reacquisitionOutcomeRecord.position > currentClaimRecord.position
        ? undefined
        : currentClaimFacts?._tag === "TaskTrackerFactsObserved"
          ? currentClaimFacts.observation._tag === "FocusedTaskClaimFactsUnreadable"
            ? ResponsibilityDisposition.TaskClaimUnreadableWait()
            : /* v8 ignore next -- @preserve Recovered executor responsibility always has its causal acquired claim. */
              currentClaimFacts.observation._tag === "FocusedTaskClaimFacts" &&
                acquiredClaim?._tag === "TaskClaimAcquired"
              ? currentClaimFacts.observation.observation._tag === "UnclaimedTask"
                ? ResponsibilityDisposition.TaskClaimMissingConstraint()
                : isExactTaskClaim(currentClaimFacts.observation.observation, acquiredClaim.claim)
                  ? undefined
                  : ResponsibilityDisposition.TaskForeignClaimIsolation()
              : undefined
          : undefined
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
    const gitConstraint =
      latestWorktreeObservation?.event._tag === "PlannedAttemptWorktreeObserved" &&
      latestWorktreeObservation.event.observation._tag !== "PlannedWorktreeReady"
        ? ResponsibilityDisposition.PlannedAttemptGitConstraint({
            gitState:
              latestWorktreeObservation.event.observation._tag === "AttemptWorktreeLost"
                ? "WorktreeLost"
                : latestWorktreeObservation.event.observation._tag
          })
        : latestTargetLineageObservation?.event._tag === "TargetLineageObserved" &&
            decideTargetLineage(latestTargetLineageObservation.event.observation)._tag === "IncompatibleTargetRewrite"
          ? ResponsibilityDisposition.PlannedAttemptGitConstraint({ gitState: "TargetRewrite" })
          : undefined
    const externalSuccessRelease =
      acquiredClaim?._tag === "TaskClaimAcquired"
        ? makeTaskClaimReleaseOperation({
            predecessorOperationIds: [acquiredClaim.claim.operationId],
            release: {
              claim: acquiredClaim.claim,
              operationId: OperationId.make(`external-success-release:${acquiredClaim.claim.operationId}`)
            }
          })
        : undefined
    const externalSuccessReleaseIntended =
      externalSuccessRelease === undefined
        ? false
        : records.some(
            ({ event }) =>
              event._tag === "TaskClaimReleaseIntended" &&
              event.operation.release.operationId === externalSuccessRelease.release.operationId
          )
    const externalSuccessReleaseSettled =
      externalSuccessRelease === undefined ? true : settledOperationIds.has(externalSuccessRelease.release.operationId)
    const claimCanBeReacquired =
      currentClaimFacts?._tag === "TaskTrackerFactsObserved" &&
      currentClaimFacts.observation._tag === "FocusedTaskClaimFacts" &&
      acquiredClaim?._tag === "TaskClaimAcquired" &&
      (currentClaimFacts.observation.observation._tag === "UnclaimedTask" ||
        !isExactTaskClaim(currentClaimFacts.observation.observation, acquiredClaim.claim))
    const appliedReacquisitionDirection =
      claimCanBeReacquired &&
      reacquisitionDirection?._tag === "TaskClaimReacquisitionDirected" &&
      !reacquisitionIntentExists
        ? ResponsibilityDisposition.AppliedTaskClaimReacquisitionDirection({
            requestId: reacquisitionDirection.requestId
          })
        : undefined
    const disposition =
      report?._tag === "PlannedAttemptExecutorWorkReported" && report.report._tag === "Terminal"
        ? ResponsibilityDisposition.PlannedAttemptExecutorWorkTerminal({ report: report.report })
        : taskLeftMembership(responsibility.plannedAttempt.taskId)
          ? safelySuspended
            ? ResponsibilityDisposition.TaskMembershipConstraint()
            : ResponsibilityDisposition.PlannedAttemptExecutorSuspensionRequested()
          : taskTerminalWithoutSuccess(responsibility.plannedAttempt.taskId)
            ? safelySuspended
              ? ResponsibilityDisposition.TaskLifecycleConstraint({ lifecycle: "TerminalWithoutSuccess" })
              : ResponsibilityDisposition.PlannedAttemptExecutorSuspensionRequested()
            : taskCompletedSuccessfully(responsibility.plannedAttempt.taskId)
              ? safelySuspended
                ? externalSuccessRelease === undefined || externalSuccessReleaseSettled
                  ? ResponsibilityDisposition.TaskExternalSuccessSettled()
                  : externalSuccessReleaseIntended
                    ? ResponsibilityDisposition.TaskExternalSuccessConstraint()
                    : ResponsibilityDisposition.TaskExternalSuccessReleaseNeeded({ operation: externalSuccessRelease })
                : ResponsibilityDisposition.PlannedAttemptExecutorSuspensionRequested()
              : claimConstraint !== undefined
                ? safelySuspended
                  ? (appliedReacquisitionDirection ?? claimConstraint)
                  : ResponsibilityDisposition.PlannedAttemptExecutorSuspensionRequested()
                : gitConstraint !== undefined
                  ? safelySuspended
                    ? gitConstraint
                    : ResponsibilityDisposition.PlannedAttemptExecutorSuspensionRequested()
                  : Option.isSome(changedSpecification)
                    ? safelySuspended
                      ? ResponsibilityDisposition.TaskSpecificationChangeConstraint({
                          observedFingerprint: changedSpecification.value.fingerprint,
                          plannedFingerprint: responsibility.plannedAttempt.taskRevision
                        })
                      : ResponsibilityDisposition.PlannedAttemptExecutorSuspensionRequested()
                    : safelySuspended && paused
                      ? ResponsibilityDisposition.PlannedAttemptExecutorWorkSafelySuspended({
                          correlation: report.report.correlation
                        })
                      : paused || runPauseSuspensionOwed || taskPauseSuspensionOwed
                        ? ResponsibilityDisposition.PlannedAttemptExecutorSuspensionRequested()
                        : ResponsibilityDisposition.Ready()
    return { _tag: "PlannedAttemptExecutorFreshFacts" as const, disposition, responsibility }
  })
}

/** True when the journal still assigns work to this Dalph run. */
export const hasUnfinishedRunResponsibility = (runState: ReconstructedRunState): boolean =>
  deriveJournalResponsibilityFacts(runState).some(
    ({ disposition }) => disposition._tag !== "Settled" && disposition._tag !== "PlannedAttemptExecutorWorkTerminal"
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

const continuationRequiresFreshFacts = (runState: ReconstructedRunState): boolean => {
  return latestCompletedPauseCyclePosition(runState) !== undefined
}

const transitionTagsAllowedWhilePaused = new Set<RunnableFrontierTransition["_tag"]>([
  "CheckTaskClaim",
  "ReconcileTaskClaim",
  "ReconcileTaskClaimRelease",
  "ReconcileTaskWorktree",
  "SuspendPlannedAttemptExecutorWork",
  "ReleaseStartedIntegrationTarget"
])
const transitionTagsAllowedToFinishHeldIntegration = new Set<RunnableFrontierTransition["_tag"]>([
  "ContinueStartedIntegrationCandidate",
  "ObservePlannedAttemptContinuationTargetLineage",
  "ObserveResponsibleTaskClaim",
  "ReleaseStartedIntegrationTarget"
])
const transitionMayRunWhileRunPaused = (transition: RunnableFrontierTransition): boolean =>
  transitionTagsAllowedWhilePaused.has(transition._tag)

/** A crashed candidate request may finish only when its exact intent predates the active Run Pause. */
/* v8 ignore start -- @preserve Candidate protocol tests cover durable intent correlation; the authored cursor cannot yet crash inside this boundary. */
const startedIntegrationIntentMayReconcileBeforePause = (
  transition: RunnableFrontierTransition,
  records: ReadonlyArray<JournalRecord>,
  pausePosition: JournalPosition | undefined
): boolean => {
  if (
    transition._tag !== "AcquireStartedIntegrationTarget" &&
    transition._tag !== "ContinueStartedIntegrationCandidate"
  ) {
    return false
  }
  return (
    pausePosition !== undefined &&
    records.some(
      ({ event, position }) =>
        position < pausePosition &&
        event._tag === "IntegrationCandidateConstructionIntended" &&
        event.startedAt === transition.responsibility.startedAt
    )
  )
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
      if (Option.isNone(integrationTarget)) return { transition }
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
      if (currentTargetLineageRecord !== undefined) return { transition }
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
  "IntegrationDependencyWait",
  "IntegrationConfigurationWait",
  "IntegrationInProgress",
  "IntegrationTrackerFactsWait",
  "IntegrationTargetWait",
  "PlannedAttemptTaskLifecycleConstraint",
  "PlannedAttemptGitConstraint",
  "PlannedAttemptTaskClaimConstraint",
  "PlannedAttemptTaskExternalSuccessConstraint",
  "PlannedAttemptTaskMembershipConstraint",
  "PlannedAttemptTaskSpecificationChangeConstraint",
  "WorkflowOperationTaskMembershipConstraint"
])

const journaledFreshTransitionTags = new Set<RunnableFrontierTransition["_tag"]>([
  "AcquireStartedIntegrationTarget",
  "CommitTaskClaimReacquisitionIntent",
  "ContinueStartedIntegrationCandidate",
  "ObservePlannedAttemptContinuationGraph",
  "ObservePlannedAttemptContinuationClaim",
  "ObservePlannedAttemptContinuationSpecification",
  "ObservePlannedAttemptContinuationTargetLineage",
  "ObservePlannedAttemptContinuationWorktree",
  "ObserveResponsibleTaskClaim",
  "QueueAcceptedResultIntegrationResponsibility",
  "ReleaseExternallyCompletedTaskClaim",
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
  candidateContinuationLimit: Option.Option<CandidateContinuationLimit>
) {
  const runState = yield* readRecoveredRunState(runId)
  const currentTaskGraph = Option.getOrUndefined(latestReconstructedTaskGraph(runState.graphKnowledge))
  const requiredFreshnessBaseline = continuationFreshnessBaseline(runState, activationBaselinePosition)
  const freshnessBaselineForTask = (taskId: TaskId) =>
    continuationFreshnessBaselineForTask(runState, activationBaselinePosition, taskId, currentTaskGraph)
  const currentGraphObservationForTask = (taskId: TaskId) =>
    currentCompleteGraphObservationAfter(runState.workflowHistory.records, freshnessBaselineForTask(taskId))
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
          currentGraphObservationForTask(transition.plannedAttempt.taskId),
          freshnessBaselineForTask(transition.plannedAttempt.taskId),
          integrationTarget
        )
  })
  const integrationResourceSnapshot = yield* integrationResources.snapshot
  const activationTargetLineage = runState.workflowHistory.records.flatMap(({ event, position }) => {
    if (event._tag !== "TargetLineageObserved") return []
    const taskBaseline = freshnessBaselineForTask(event.plannedAttempt.taskId)
    return positionIsAfter(position, taskBaseline) ? [[event.plannedAttempt.attemptId, event.observation] as const] : []
  })
  const durableCandidateLineage = runState.workflowHistory.records.flatMap(({ event }) =>
    event._tag === "IntegrationCandidateConstructionIntended"
      ? [
          [
            event.plannedAttempt.attemptId,
            TargetLineageObservation.make({
              plannedBaseIsAncestorOfTargetHead: true,
              plannedBaseSha: event.plannedAttempt.baseSha,
              targetHeadSha: event.correlation.expectedTargetHead
            })
          ] as const
        ]
      : []
  )
  const targetLineageByAttemptId = new Map([...activationTargetLineage, ...durableCandidateLineage])
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
    allowRecoveredContinuation: continuationRequiresFreshFacts(runState),
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
  allowRecoveredContinuation: boolean
): RunnableFrontier => ({
  explanations: frontier.explanations.filter(({ _tag }) => journaledFreshExplanationTags.has(_tag)),
  transitions: frontier.transitions.filter(
    ({ _tag }) =>
      journaledFreshTransitionTags.has(_tag) ||
      (allowRecoveredContinuation && _tag === "ContinuePlannedAttemptExecutorWork")
  )
})

/** One reconstruction turn; process-local integration state is sampled exactly once. */
export interface RunRecoveryProjectionSnapshot {
  readonly evidence: DeliveryProjectionEvidence
  readonly frontier: RunnableFrontier
}

/** Exact shared failures that can prevent reconstruction of descriptive recovery evidence. */
export type RunRecoveryProjectionError = Effect.Error<ReturnType<typeof readRecoveredProjection>>

/** Read-only reconstructed evidence consumed by the flat delivery relation. */
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
  | (RunRecoveryProjectionSource & { readonly _tag: "SyntheticFreshOnlyProjection" })

/**
 * Read-only current-run recovery evidence for the descriptive delivery relation.
 */
export class RunRecoveryProjection extends Context.Service<RunRecoveryProjection, RunRecoveryProjectionService>()(
  "@dalph/RunRecoveryProjection"
) {}

/** Explicit fresh-only composition for dry-run and deterministic tests. */
export const emptyRunRecoveryProjectionLayer = Layer.succeed(
  RunRecoveryProjection,
  RunRecoveryProjection.of({
    _tag: "SyntheticFreshOnlyProjection",
    readDeliveryProjection: Effect.succeed({
      evidence: { _tag: "AvailableDeliveryProjectionEvidence", acceptedAt: null, facts: [], integrationWaits: [] },
      frontier: { explanations: [], transitions: [] }
    }),
    reconstructedPlannedAttemptPositions: []
  })
)

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
  integrationResourcesOverride: IntegrationTargetResourceController | undefined
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
    candidateContinuationLimit
  ).pipe(
    Effect.map((current) =>
      recoveryProjectionSnapshot(
        current,
        journaledFreshFrontierOf(current.frontier, current.allowRecoveredContinuation)
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
  integrationResources?: IntegrationTargetResourceController
) =>
  makeJournaledFreshRunRecoveryProjectionEffect(
    runId,
    Option.fromUndefinedOr(configuredIntegrationTarget),
    Option.fromUndefinedOr(candidateCorrectionLimit),
    Option.fromUndefinedOr(candidateContinuationLimit),
    integrationResources
  )

const makeRunRecoveryProjectionEffect = Effect.fn("RunRecoveryProjection.makeAuthoritative")(function* (
  runId: RunId,
  integrationTarget: Option.Option<IntegrationTarget>,
  candidateCorrectionLimit: Option.Option<CandidateCorrectionLimit>,
  candidateContinuationLimit: Option.Option<CandidateContinuationLimit>,
  integrationResourcesOverride: IntegrationTargetResourceController | undefined
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
      const report = initialRecords.findLast(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkReported" &&
          event.report.correlation.attemptId === responsibility.plannedAttempt.attemptId &&
          event.report.correlation.runId === responsibility.plannedAttempt.runId
      )?.event
      return report?._tag === "PlannedAttemptExecutorWorkReported" &&
        (report.report._tag === "SafelySuspended" || report.report._tag === "Terminal")
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
    candidateContinuationLimit
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
  integrationResources?: IntegrationTargetResourceController
) =>
  makeRunRecoveryProjectionEffect(
    runId,
    Option.fromUndefinedOr(configuredIntegrationTarget),
    Option.fromUndefinedOr(candidateCorrectionLimit),
    Option.fromUndefinedOr(candidateContinuationLimit),
    integrationResources
  )

export const journaledFreshRunRecoveryProjectionLayer = (
  runId: RunId,
  configuredIntegrationTarget?: IntegrationTarget,
  candidateCorrectionLimit?: CandidateCorrectionLimit,
  candidateContinuationLimit?: CandidateContinuationLimit
) =>
  Layer.effect(
    RunRecoveryProjection,
    makeJournaledFreshRunRecoveryProjection(
      runId,
      configuredIntegrationTarget,
      candidateCorrectionLimit,
      candidateContinuationLimit
    )
  )
