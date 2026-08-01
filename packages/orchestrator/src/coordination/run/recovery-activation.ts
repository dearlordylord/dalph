/* eslint-disable max-lines -- Fresh and authoritative activation must share one recovery authority boundary. */
import { Context, Effect, Exit, Layer, Option, Queue, Schema } from "effect"
import { ActivationCause, makeActivationCoordinator, type OwnedTransitionExecution } from "../activation/coordinator.js"
import {
  type AttemptId,
  type IntegrationTarget,
  type PlannedTaskAttempt,
  plannedTaskAttemptEquivalence,
  type RunId,
  TaskId,
  PlannedAttemptExecutor,
  plannedAttemptExecutorCorrelation,
  type PlannedAttemptExecutorReport
} from "@dalph/contracts"
import { type TaskWorkCapacity } from "../admission/capacity.js"
import { describeJournalEvent } from "../../workflow/registry/event-descriptor.js"
import {
  JournalStore,
  type JournalAppendError,
  type JournalRecord,
  type JournalStoreError
} from "../../workflow-journal/store.js"
import { workflowJournalTransitionRuleFor } from "../reconstruction/history-transition.js"
import { reduceWorkflowJournalHistory } from "../reconstruction/history.js"
import {
  continuePlannedAttemptExecutorWork,
  requestPlannedAttemptExecutorSuspension
} from "../../workflow/protocols/planned-attempt-executor-work/protocol.js"
import { authorizedClaimForAttempt } from "./recovery-authority.js"
import {
  type ReconstructedRunState,
  reconstructedTaskIsPaused,
  type WorkflowResponsibilityState,
  workflowResponsibilityOperationId
} from "../reconstruction/state.js"
import type { ResponsibilityFreshFacts } from "../frontier/fresh-facts.js"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import {
  deriveRunnableFrontier,
  FrontierExplanation,
  ResponsibilityDisposition,
  RunnableFrontierTransition,
  type RunnableFrontier
} from "../frontier/frontier.js"
import { recoverRunnableTransition } from "../frontier/recovery.js"
import { makeTaskAdmissionController } from "../admission/controller.js"
import {
  WorkflowInterpreter,
  type WorkflowInterpreterService,
  WorkflowTrace
} from "../../workflow/interpretation/interpreter.js"
import {
  latestReconstructedTaskGraph,
  reconstructedTaskWorkSpecificationFor
} from "../reconstruction/graph-knowledge.js"
import { type AcceptedResultNotDurable } from "../../workflow/protocols/integration-admission/protocol.js"
import { deriveIntegrationFrontier } from "../frontier/integration-frontier.js"
import {
  type IntegrationTargetResourceController,
  type IntegrationTargetResourceUnavailable,
  makeIntegrationTargetResourceController
} from "../admission/integration-target-resource.js"
import { runIntegrationTransition } from "./integration-transition-runtime.js"
import { OperationId } from "../../workflow/identity.js"
import { isExactTaskClaim } from "../../authorities/task-tracker/claim-mutation.js"
import {
  latestTaskClaimReacquisitionDirection,
  taskClaimReacquisitionOperationId
} from "../../workflow/protocols/task-claim-reacquisition/plan.js"

import {
  makeTaskClaimReleaseOperation,
  makeTaskClaimObservationOperation,
  makeTaskClaimAcquisitionOperation,
  makeTargetLineageObservationOperation,
  makeTaskWorktreeObservationOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTrackerGraphObservationOperation
} from "../../workflow/registry/operation.js"
import { OperationSelected } from "../../presentation/tracker-workflow-trace.js"
import type { TraceOutputError } from "../../presentation/trace-output.js"
import { TaskClaimAcquisitionPlanner } from "../../workflow/protocols/task-claim-acquisition/plan.js"
import { currentTaskClaimAuthority } from "../frontier/task-claim-authority.js"
import { decideTargetLineage } from "../../workflow/protocols/git-reconciliation/decision.js"
export { deriveIntegrationFrontier } from "../frontier/integration-frontier.js"

const finalRecordOffset = -1

type InterpreterError = {
  [Key in keyof WorkflowInterpreterService]-?: Effect.Error<ReturnType<NonNullable<WorkflowInterpreterService[Key]>>>
}[keyof WorkflowInterpreterService]

type InvalidWorkflowJournalHistory = Extract<
  ReturnType<typeof reduceWorkflowJournalHistory>,
  { readonly _tag: "InvalidWorkflowJournalHistory" }
>

export type RunRecoveryActivationError =
  | Effect.Error<ReturnType<typeof continuePlannedAttemptExecutorWork>>
  | AcceptedResultNotDurable
  | InvalidWorkflowJournalHistory
  | InterpreterError
  | IntegrationTargetResourceUnavailable
  | JournalAppendError
  | JournalStoreError
  | TaskClaimReacquisitionPlannerUnavailable
  | TaskClaimReacquisitionPlanningFailed
  | TraceOutputError

/** A selected explicit reacquisition has no configured identity planner. */
export class TaskClaimReacquisitionPlannerUnavailable extends Schema.TaggedErrorClass<TaskClaimReacquisitionPlannerUnavailable>()(
  "TaskClaimReacquisitionPlannerUnavailable",
  { taskId: TaskId }
) {}

/** The configured planner could not allocate the replacement claim identity. */
export class TaskClaimReacquisitionPlanningFailed extends Schema.TaggedErrorClass<TaskClaimReacquisitionPlanningFailed>()(
  "TaskClaimReacquisitionPlanningFailed",
  { detail: Schema.String, taskId: TaskId }
) {}

/* v8 ignore start -- @preserve Planner failure rendering is a defensive fallback around a typed Effect boundary. */
const planningFailureDetail = (failure: unknown): string =>
  typeof failure === "object" && failure !== null && "_tag" in failure
    ? String(failure._tag)
    : "TaskClaimAcquisitionPlanner.plan failed"
/* v8 ignore stop -- @preserve */

const runTaskClaimReacquisition = Effect.fn("RunRecoveryActivation.runTaskClaimReacquisition")(function* (input: {
  readonly execution: OwnedTransitionExecution
  readonly interpreter: WorkflowInterpreterService
  readonly journal: JournalStore["Service"]
  readonly planner: Option.Option<TaskClaimAcquisitionPlanner["Service"]>
  readonly runId: RunId
  readonly trace: Option.Option<WorkflowTrace["Service"]>
  readonly transition: Extract<RunnableFrontierTransition, { readonly _tag: "CommitTaskClaimReacquisitionIntent" }>
}) {
  const planner = yield* Option.match(input.planner, {
    onNone: () => Effect.fail(new TaskClaimReacquisitionPlannerUnavailable({ taskId: input.transition.taskId })),
    onSome: Effect.succeed
  })
  const records = yield* input.journal.read(input.runId)
  const priorClaim = records.findLast(
    ({ event }) => event._tag === "TaskClaimAcquired" && event.claim.taskId === input.transition.taskId
  )?.event
  const observation = records.findLast(
    ({ event }) =>
      event._tag === "TaskTrackerFactsObserved" &&
      (event.observation._tag === "FocusedTaskClaimFacts" ||
        event.observation._tag === "FocusedTaskClaimFactsUnreadable") &&
      event.observation.coverage.taskId === input.transition.taskId
  )?.event
  const operationId = taskClaimReacquisitionOperationId(input.transition.requestId)
  const operation = makeTaskClaimAcquisitionOperation({
    acquisition: yield* planner.plan(operationId, input.transition.taskId).pipe(
      Effect.mapError(
        /* v8 ignore next -- @preserve The unavailable-planner path is tested; provider-specific planner failures are wrapped here. */
        (failure) =>
          new TaskClaimReacquisitionPlanningFailed({
            detail: planningFailureDetail(failure),
            taskId: input.transition.taskId
          })
      )
    ),
    authority: { _tag: "ExplicitTaskClaimReacquisitionAuthority", requestId: input.transition.requestId },
    predecessorOperationIds: [
      /* v8 ignore next -- @preserve Valid reacquisition history always includes the claim whose authority was lost. */
      ...(priorClaim?._tag === "TaskClaimAcquired" ? [priorClaim.claim.operationId] : []),
      /* v8 ignore next -- @preserve Valid reacquisition history always includes the missing or foreign observation. */
      ...(observation?._tag === "TaskTrackerFactsObserved" ? [observation.operationId] : [])
    ]
  })
  if (Option.isSome(input.trace)) {
    yield* input.trace.value.emit(OperationSelected.make({ operation }))
  }
  yield* input.interpreter.acquireTaskClaim(operation, input.execution.recordIntent(operationId))
})

/** Derives which journaled responsibilities are still unfinished. */
const deriveJournalResponsibilityFacts = (
  runState: ReconstructedRunState,
  activationBaselinePosition: Option.Option<JournalPosition> = Option.none()
): ReadonlyArray<ResponsibilityFreshFacts> => {
  const records = runState.workflowHistory.records
  const latestTaskGraph = latestReconstructedTaskGraph(runState.graphKnowledge)
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
          : currentTaskClaimAuthority(records, responsibility.taskId, expectedClaim, activationBaselinePosition)
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
    const paused = reconstructedTaskIsPaused(runState.pause, responsibility.plannedAttempt.taskId)
    const safelySuspended =
      report?._tag === "PlannedAttemptExecutorWorkReported" && report.report._tag === "SafelySuspended"
    const changedSpecification = changedTaskSpecification(responsibility.plannedAttempt)
    const acquiredClaim = authorizedClaimForAttempt(records, responsibility.plannedAttempt)
    const currentClaimRecord = records.findLast(
      ({ event, position }) =>
        event._tag === "TaskTrackerFactsObserved" &&
        (event.observation._tag === "FocusedTaskClaimFacts" ||
          event.observation._tag === "FocusedTaskClaimFactsUnreadable") &&
        event.observation.coverage.taskId === responsibility.plannedAttempt.taskId &&
        positionIsAfter(position, activationBaselinePosition)
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
                      : paused
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
  const journal = yield* JournalStore
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

type CurrentGraphObservation = {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "TaskTrackerFactsObserved" }>
  readonly position: JournalPosition
}

type ContinuationDecision = {
  readonly explanation?: FrontierExplanation
  readonly transition?: RunnableFrontierTransition
}

type ObservedOperationTransition = Extract<
  RunnableFrontierTransition,
  {
    readonly _tag:
      | "ObservePlannedAttemptContinuationGraph"
      | "ObservePlannedAttemptContinuationClaim"
      | "ObservePlannedAttemptContinuationSpecification"
      | "ObservePlannedAttemptContinuationTargetLineage"
      | "ObservePlannedAttemptContinuationWorktree"
      | "ObserveResponsibleTaskClaim"
      | "ReleaseExternallyCompletedTaskClaim"
  }
>

const isObservedOperationTransition = (
  transition: RunnableFrontierTransition
): transition is ObservedOperationTransition =>
  transition._tag === "ObservePlannedAttemptContinuationGraph" ||
  transition._tag === "ObservePlannedAttemptContinuationClaim" ||
  transition._tag === "ObservePlannedAttemptContinuationSpecification" ||
  transition._tag === "ObservePlannedAttemptContinuationTargetLineage" ||
  transition._tag === "ObservePlannedAttemptContinuationWorktree" ||
  transition._tag === "ObserveResponsibleTaskClaim" ||
  transition._tag === "ReleaseExternallyCompletedTaskClaim"

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

const attemptMayContinue = (records: ReadonlyArray<JournalRecord>, plannedAttempt: PlannedTaskAttempt): boolean => {
  const latestReportRecord = records.findLast(
    ({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkReported" &&
      event.report.correlation.attemptId === plannedAttempt.attemptId &&
      event.report.correlation.runId === plannedAttempt.runId
  )
  if (
    latestReportRecord?.event._tag !== "PlannedAttemptExecutorWorkReported" ||
    latestReportRecord.event.report._tag === "Running"
  ) {
    return true
  }
  if (latestReportRecord.event.report._tag === "Terminal") return false
  return records.some(
    ({ event, position }) =>
      position > latestReportRecord.position &&
      ((event._tag === "TaskClaimAcquisitionIntended" &&
        event.operation.acquisition.taskId === plannedAttempt.taskId &&
        event.operation.authority._tag === "ExplicitTaskClaimReacquisitionAuthority") ||
        (event._tag === "ControlDirectionApplied" &&
          event.direction === "Unpause" &&
          event.subject._tag === "Task" &&
          event.subject.taskId === plannedAttempt.taskId))
  )
}

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

const readRecoveredFrontier = Effect.fn("RunRecoveryActivation.readRecoveredFrontier")(function* (
  runId: RunId,
  integrationResources: IntegrationTargetResourceController,
  integrationTarget: Option.Option<IntegrationTarget>,
  activationBaselinePosition: Option.Option<JournalPosition>
) {
  const runState = yield* readRecoveredRunState(runId)
  const hasCurrentCompleteGraphObservation = runState.workflowHistory.records.some(
    ({ event, position }) =>
      event._tag === "TaskTrackerFactsObserved" &&
      (event.observation._tag === "CompleteTaskTrackerFacts" ||
        event.observation._tag === "UnchangedTaskTrackerFactsReconfirmed") &&
      positionIsAfter(position, activationBaselinePosition)
  )
  const currentTrackerTaskIds = Option.match(latestReconstructedTaskGraph(runState.graphKnowledge), {
    onNone: () => new Set<TaskId>(),
    onSome: (graph) => new Set(hasCurrentCompleteGraphObservation ? graph.taskIds() : [])
  })
  const ordinary = deriveRunnableFrontier({
    freshEligibleTasks: [],
    responsibility: runState.responsibility,
    responsibilityFacts: deriveJournalResponsibilityFacts(runState, activationBaselinePosition)
  })
  const currentGraphRecord = runState.workflowHistory.records.findLast(
    ({ event, position }) =>
      event._tag === "TaskTrackerFactsObserved" &&
      (event.observation._tag === "CompleteTaskTrackerFacts" ||
        event.observation._tag === "UnchangedTaskTrackerFactsReconfirmed") &&
      positionIsAfter(position, activationBaselinePosition)
  )
  const currentGraphObservation =
    currentGraphRecord?.event._tag === "TaskTrackerFactsObserved"
      ? { event: currentGraphRecord.event, position: currentGraphRecord.position }
      : undefined
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
  const continuationDecisions = ordinary.transitions.map((transition) =>
    transition._tag === "ContinuePlannedAttemptExecutorWork" &&
    pendingAttemptIds.has(transition.plannedAttempt.attemptId)
      ? {}
      : continuationDecisionFor(
          transition,
          runState.workflowHistory.records,
          currentGraphObservation,
          activationBaselinePosition,
          integrationTarget
        )
  )
  const integration = deriveIntegrationFrontier(runState, {
    ...(yield* integrationResources.snapshot),
    currentTrackerTaskIds,
    integrationTarget,
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
              activationBaselinePosition
            )
          ] as const
        ]
      })
    )
  })
  const unobservedClaimTaskIds = [...ordinary.explanations, ...integration.explanations].flatMap((explanation) =>
    (explanation._tag === "WorkflowOperationTaskClaimConstraint" ||
      explanation._tag === "IntegrationTaskClaimConstraint") &&
    explanation.claimState === "Unobserved"
      ? [explanation.taskId]
      : []
  )
  const claimObservationTransitions =
    currentGraphObservation === undefined
      ? []
      : [...new Set(unobservedClaimTaskIds)]
          .sort()
          .map((taskId) =>
            RunnableFrontierTransition.ObserveResponsibleTaskClaim({
              operation: makeTaskClaimObservationOperation(
                OperationId.make(`responsibility:${taskId}:after:${currentGraphObservation.position}:claim`),
                currentGraphObservation.event.observation.target,
                taskId,
                [currentGraphObservation.event.operationId]
              ),
              taskId
            })
          )
  return {
    explanations: [
      ...ordinary.explanations,
      ...continuationDecisions.flatMap(({ explanation }) => (explanation === undefined ? [] : [explanation])),
      ...integration.explanations
    ],
    transitions: [
      ...pendingGitReadTransitions,
      ...claimObservationTransitions,
      ...integration.transitions,
      ...continuationDecisions.flatMap(({ transition }) => (transition === undefined ? [] : [transition]))
    ]
  }
})

const readJournaledFreshFrontier = Effect.fn("RunRecoveryActivation.readJournaledFreshFrontier")(function* (
  runId: RunId,
  integrationResources: IntegrationTargetResourceController,
  integrationTarget: Option.Option<IntegrationTarget>,
  activationBaselinePosition: Option.Option<JournalPosition>
) {
  const frontier = yield* readRecoveredFrontier(
    runId,
    integrationResources,
    integrationTarget,
    activationBaselinePosition
  )
  return {
    explanations: frontier.explanations.filter(({ _tag }) => journaledFreshExplanationTags.has(_tag)),
    transitions: frontier.transitions.filter(({ _tag }) => journaledFreshTransitionTags.has(_tag))
  }
})

// eslint-disable-next-line functional/no-mixed-types -- The source pairs immutable reconstruction with its executor capability.
interface RunRecoveryActivationSource {
  /** Continues an attempt first planned by this activation, without applying startup-recovery authority checks. */
  readonly continueFreshPlannedAttemptExecutorWork: (
    plannedAttempt: PlannedTaskAttempt
  ) => Effect.Effect<PlannedAttemptExecutorReport, RunRecoveryActivationError>
  /** Continues an attempt reconstructed at startup after rereading its tracker claim and Git worktree. */
  readonly continuePlannedAttemptExecutorWork: (
    plannedAttempt: PlannedTaskAttempt
  ) => Effect.Effect<PlannedAttemptExecutorReport, RunRecoveryActivationError>
  readonly readFinalityFrontier: Effect.Effect<RunnableFrontier, RunRecoveryActivationError, never>
  readonly readFrontier: Effect.Effect<RunnableFrontier, RunRecoveryActivationError, never>
  readonly readResponsibility: Effect.Effect<WorkflowResponsibilityState, RunRecoveryActivationError, never>
  readonly reconstructedPlannedAttemptPositions: ReadonlyArray<{
    readonly attemptId: AttemptId
    readonly runId: RunId
    readonly taskId: TaskId
  }>
  readonly waitForNextExecutorWake: Effect.Effect<void, RunRecoveryActivationError, never>
}

/** A journal-backed source can execute recovered transitions for its exact run. */
// eslint-disable-next-line functional/no-mixed-types -- The discriminated source carries the exact run and its sole recovered-transition capability.
interface AuthoritativeRunRecoveryActivation extends RunRecoveryActivationSource {
  readonly _tag: "AuthoritativeRunRecoveryActivation"
  readonly runId: RunId
  readonly runTransition: (
    transition: RunnableFrontierTransition,
    execution: OwnedTransitionExecution
  ) => Effect.Effect<void, RunRecoveryActivationError, never>
}

/** A live fresh Run may execute only integration work reconstructed from its own journal. */
interface JournaledFreshRunActivation extends RunRecoveryActivationSource {
  readonly _tag: "JournaledFreshRunActivation"
  readonly runId: RunId
  readonly runTransition: (
    transition: RunnableFrontierTransition,
    execution: OwnedTransitionExecution
  ) => Effect.Effect<void, RunRecoveryActivationError, never>
}

/** A non-journaled composition has no recovered-transition capability. */
interface SyntheticFreshOnlyActivation extends RunRecoveryActivationSource {
  readonly _tag: "SyntheticFreshOnlyActivation"
}

type RunRecoveryActivationService =
  | AuthoritativeRunRecoveryActivation
  | JournaledFreshRunActivation
  | SyntheticFreshOnlyActivation

/**
 * Current-run recovered work source. It owns no selector, admission controller,
 * or runner; a caller composes these transitions into its one activation loop.
 */
export class RunRecoveryActivation extends Context.Service<RunRecoveryActivation, RunRecoveryActivationService>()(
  "@dalph/RunRecoveryActivation"
) {}

/** Explicit fresh-only composition for dry-run and deterministic tests. */
export const emptyRunRecoveryActivationLayer = Layer.effect(
  RunRecoveryActivation,
  PlannedAttemptExecutor.pipe(
    Effect.map((executor) => {
      const continueAttempt = (plannedAttempt: PlannedTaskAttempt) => executor.startOrContinue(plannedAttempt)
      return RunRecoveryActivation.of({
        _tag: "SyntheticFreshOnlyActivation",
        continueFreshPlannedAttemptExecutorWork: continueAttempt,
        continuePlannedAttemptExecutorWork: continueAttempt,
        readFinalityFrontier: Effect.succeed({ explanations: [], transitions: [] }),
        readFrontier: Effect.succeed({ explanations: [], transitions: [] }),
        readResponsibility: Effect.succeed({ entries: [] }),
        reconstructedPlannedAttemptPositions: [],
        waitForNextExecutorWake: Effect.void
      })
    })
  )
)

/**
 * Fresh-run composition that records coarse executor responsibility and
 * reports while exposing no recovered transitions.
 */
const makeJournaledFreshRunRecoveryActivationEffect = Effect.fn("RunRecoveryActivation.makeJournaledFreshSource")(
  function* (runId: RunId, integrationTarget: Option.Option<IntegrationTarget>) {
    const executor = yield* PlannedAttemptExecutor
    const journal = yield* JournalStore
    const workflowInterpreter = Context.getOption(yield* Effect.context<never>(), WorkflowInterpreter)
    const workflowTrace = Context.getOption(yield* Effect.context<never>(), WorkflowTrace)
    const claimPlanner = Context.getOption(yield* Effect.context<never>(), TaskClaimAcquisitionPlanner)
    const activationBaselinePosition = latestJournalPosition(yield* journal.read(runId))
    const integrationResources = yield* makeIntegrationTargetResourceController()
    const provideJournal = <A, E>(effect: Effect.Effect<A, E, JournalStore>): Effect.Effect<A, E> =>
      Effect.provideService(effect, JournalStore, journal)
    const continueAttempt = (plannedAttempt: PlannedTaskAttempt) =>
      continuePlannedAttemptExecutorWork(plannedAttempt).pipe(
        Effect.provideService(PlannedAttemptExecutor, executor),
        Effect.provideService(JournalStore, journal)
      )
    const runObservedOperation = (
      transition: ObservedOperationTransition
    ): Effect.Effect<void, RunRecoveryActivationError> =>
      // eslint-disable-next-line complexity -- Closed observation tags route to their matching interpreter boundary.
      Effect.gen(function* () {
        const interpreter = Option.getOrUndefined(workflowInterpreter)
        if (interpreter === undefined) {
          return yield* Effect.die(`fresh journal activation cannot interpret ${transition._tag}`)
        }
        if (Option.isSome(workflowTrace)) {
          yield* workflowTrace.value.emit(OperationSelected.make({ operation: transition.operation }))
        }
        switch (transition._tag) {
          case "ObservePlannedAttemptContinuationClaim":
          case "ObserveResponsibleTaskClaim":
            yield* interpreter.readTaskClaim(transition.operation)
            return
          case "ObservePlannedAttemptContinuationGraph":
            yield* interpreter.readTrackerGraph(transition.operation)
            return
          case "ObservePlannedAttemptContinuationSpecification":
            yield* interpreter.readTaskWorkSpecification(transition.operation)
            return
          case "ObservePlannedAttemptContinuationTargetLineage":
            yield* interpreter.readTargetLineage(transition.operation)
            return
          case "ObservePlannedAttemptContinuationWorktree":
            yield* interpreter.readTaskWorktree(transition.operation)
            return
          case "ReleaseExternallyCompletedTaskClaim":
            yield* interpreter.releaseTaskClaim(transition.operation)
            return
        }
      })
    /* v8 ignore start -- @preserve The shared reacquisition runtime is exercised through recovered activation. */
    const runClaimReacquisition = (
      transition: Extract<RunnableFrontierTransition, { readonly _tag: "CommitTaskClaimReacquisitionIntent" }>,
      execution: OwnedTransitionExecution
    ) =>
      runTaskClaimReacquisition({
        execution,
        interpreter: Option.getOrThrowWith(
          workflowInterpreter,
          () => new Error("fresh journal activation has no workflow interpreter")
        ),
        journal,
        planner: claimPlanner,
        runId,
        trace: workflowTrace,
        transition
      })
    /* v8 ignore stop -- @preserve */
    return RunRecoveryActivation.of({
      _tag: "JournaledFreshRunActivation",
      continueFreshPlannedAttemptExecutorWork: continueAttempt,
      continuePlannedAttemptExecutorWork: continueAttempt,
      readFinalityFrontier: provideJournal(
        readRecoveredFrontier(runId, integrationResources, integrationTarget, activationBaselinePosition)
      ),
      readFrontier: provideJournal(
        readJournaledFreshFrontier(runId, integrationResources, integrationTarget, activationBaselinePosition)
      ),
      readResponsibility: provideJournal(
        readRecoveredRunState(runId).pipe(Effect.map(({ responsibility }) => responsibility))
      ),
      reconstructedPlannedAttemptPositions: [],
      runId,
      // eslint-disable-next-line complexity -- Fresh activation exhaustively routes its closed transition vocabulary.
      runTransition: (transition, execution) =>
        /* v8 ignore next -- @preserve Fresh activation cannot receive an explicit recovery-only reacquisition transition. */
        transition._tag === "CommitTaskClaimReacquisitionIntent"
          ? runClaimReacquisition(transition, execution)
          : transition._tag === "ObservePlannedAttemptContinuationGraph" ||
              transition._tag === "ObservePlannedAttemptContinuationClaim" ||
              transition._tag === "ObservePlannedAttemptContinuationSpecification" ||
              transition._tag === "ObservePlannedAttemptContinuationTargetLineage" ||
              transition._tag === "ObservePlannedAttemptContinuationWorktree" ||
              transition._tag === "ObserveResponsibleTaskClaim" ||
              transition._tag === "ReleaseExternallyCompletedTaskClaim"
            ? runObservedOperation(transition)
            : transition._tag === "SuspendPlannedAttemptExecutorWork"
              ? requestPlannedAttemptExecutorSuspension(transition.plannedAttempt).pipe(
                  Effect.provideService(PlannedAttemptExecutor, executor),
                  Effect.provideService(JournalStore, journal),
                  Effect.flatMap((report) =>
                    report._tag === "SafelySuspended" || report._tag === "Terminal"
                      ? execution.releasePlannedAttemptExecutorWorkPosition(
                          plannedAttemptExecutorCorrelation(transition.plannedAttempt)
                        )
                      : Effect.void
                  )
                )
              : provideJournal(runIntegrationTransition(transition, integrationResources)).pipe(
                  Effect.flatMap((handled) =>
                    handled ? Effect.void : Effect.die(`fresh journal activation cannot run ${transition._tag}`)
                  )
                ),
      waitForNextExecutorWake: Effect.void
    })
  }
)

export const makeJournaledFreshRunRecoveryActivation = (
  runId: RunId,
  configuredIntegrationTarget?: IntegrationTarget
) => makeJournaledFreshRunRecoveryActivationEffect(runId, Option.fromUndefinedOr(configuredIntegrationTarget))

export const journaledFreshRunRecoveryActivationLayer = (
  runId: RunId,
  configuredIntegrationTarget?: IntegrationTarget
) => Layer.effect(RunRecoveryActivation, makeJournaledFreshRunRecoveryActivation(runId, configuredIntegrationTarget))

const makeRunRecoveryActivationEffect = Effect.fn("RunRecoveryActivation.makeRecoverySource")(function* (
  runId: RunId,
  integrationTarget: Option.Option<IntegrationTarget>
) {
  const dependencies = yield* Effect.context<JournalStore | WorkflowInterpreter | WorkflowTrace>()
  const integrationResources = yield* makeIntegrationTargetResourceController()
  const plannedAttemptExecutor = yield* PlannedAttemptExecutor
  const workflowInterpreter = yield* WorkflowInterpreter
  const workflowTrace = yield* WorkflowTrace
  const claimPlanner = Context.getOption(yield* Effect.context<never>(), TaskClaimAcquisitionPlanner)
  const provideDependencies = <A, E>(
    effect: Effect.Effect<A, E, JournalStore | WorkflowInterpreter | WorkflowTrace>
  ): Effect.Effect<A, E> => Effect.provide(effect, dependencies)
  const journal = yield* JournalStore
  const initialReduction = reduceWorkflowJournalHistory(runId, yield* journal.read(runId))
  if (initialReduction._tag === "InvalidWorkflowJournalHistory") {
    return yield* Effect.fail(initialReduction)
  }
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
  const readFrontier = Effect.fn("RunRecoveryActivation.readActivationFrontier")(function* () {
    return yield* readRecoveredFrontier(runId, integrationResources, integrationTarget, activationBaselinePosition)
  })
  const waitForNextExecutorWake = Effect.fn("RunRecoveryActivation.waitForNextExecutorWake")(() => Effect.void)
  // eslint-disable-next-line complexity -- Closed observation tags route to their matching journaled authority boundary.
  const runObservedOperation = Effect.fn("RunRecoveryActivation.runObservedOperation")(function* (
    transition: ObservedOperationTransition
  ) {
    if (
      transition._tag === "ObservePlannedAttemptContinuationWorktree" ||
      transition._tag === "ObservePlannedAttemptContinuationTargetLineage"
    ) {
      const plannedAttempt = transition.operation.plannedAttempt
      const records = (yield* readRecoveredRunState(runId)).workflowHistory.records
      if (!attemptMayContinue(records, plannedAttempt)) return
    }
    yield* workflowTrace.emit(OperationSelected.make({ operation: transition.operation }))
    switch (transition._tag) {
      case "ObservePlannedAttemptContinuationClaim":
      case "ObserveResponsibleTaskClaim":
        yield* workflowInterpreter.readTaskClaim(transition.operation)
        return
      case "ObservePlannedAttemptContinuationGraph":
        yield* workflowInterpreter.readTrackerGraph(transition.operation)
        return
      case "ObservePlannedAttemptContinuationSpecification":
        yield* workflowInterpreter.readTaskWorkSpecification(transition.operation)
        return
      case "ObservePlannedAttemptContinuationTargetLineage":
        yield* workflowInterpreter.readTargetLineage(transition.operation)
        return
      case "ObservePlannedAttemptContinuationWorktree":
        yield* workflowInterpreter.readTaskWorktree(transition.operation)
        return
      case "ReleaseExternallyCompletedTaskClaim":
        yield* workflowInterpreter.releaseTaskClaim(transition.operation)
        return
    }
  })
  const runClaimReacquisition = (
    transition: Extract<RunnableFrontierTransition, { readonly _tag: "CommitTaskClaimReacquisitionIntent" }>,
    execution: OwnedTransitionExecution
  ) =>
    runTaskClaimReacquisition({
      execution,
      interpreter: workflowInterpreter,
      journal,
      planner: claimPlanner,
      runId,
      trace: Option.some(workflowTrace),
      transition
    })
  const runExecutorTransition = Effect.fn("RunRecoveryActivation.runExecutorTransition")(function* (
    transition: Extract<
      RunnableFrontierTransition,
      { readonly _tag: "ContinuePlannedAttemptExecutorWork" | "SuspendPlannedAttemptExecutorWork" }
    >,
    execution: OwnedTransitionExecution
  ) {
    const correlation = plannedAttemptExecutorCorrelation(transition.plannedAttempt)
    if (transition._tag === "ContinuePlannedAttemptExecutorWork") {
      yield* execution.bindPlannedAttemptExecutorPosition(correlation)
    }
    const report = yield* (
      transition._tag === "ContinuePlannedAttemptExecutorWork"
        ? continuePlannedAttemptExecutorWork(transition.plannedAttempt)
        : requestPlannedAttemptExecutorSuspension(transition.plannedAttempt)
    ).pipe(Effect.provideService(PlannedAttemptExecutor, plannedAttemptExecutor))
    if (report._tag === "SafelySuspended" || report._tag === "Terminal") {
      yield* execution.releasePlannedAttemptExecutorWorkPosition(correlation)
    }
  })
  const runTransition = Effect.fn("RunRecoveryActivation.runTransition")(function* (
    transition: RunnableFrontierTransition,
    execution: OwnedTransitionExecution
  ) {
    if (yield* runIntegrationTransition(transition, integrationResources)) return
    if (transition._tag === "CommitTaskClaimReacquisitionIntent") {
      yield* runClaimReacquisition(transition, execution)
      return
    }
    if (isObservedOperationTransition(transition)) {
      yield* runObservedOperation(transition)
      return
    }
    if (
      transition._tag === "ContinuePlannedAttemptExecutorWork" ||
      transition._tag === "SuspendPlannedAttemptExecutorWork"
    ) {
      yield* runExecutorTransition(transition, execution)
      return
    }
    yield* recoverRunnableTransition(runId, transition)
  })
  return {
    _tag: "AuthoritativeRunRecoveryActivation",
    continueFreshPlannedAttemptExecutorWork: (plannedAttempt) =>
      provideDependencies(
        continuePlannedAttemptExecutorWork(plannedAttempt).pipe(
          Effect.provideService(PlannedAttemptExecutor, plannedAttemptExecutor)
        )
      ),
    continuePlannedAttemptExecutorWork: (plannedAttempt) =>
      provideDependencies(
        continuePlannedAttemptExecutorWork(plannedAttempt).pipe(
          Effect.provideService(PlannedAttemptExecutor, plannedAttemptExecutor)
        )
      ),
    readFrontier: provideDependencies(readFrontier()),
    readFinalityFrontier: provideDependencies(readFrontier()),
    readResponsibility: provideDependencies(
      readRecoveredRunState(runId).pipe(Effect.map(({ responsibility }) => responsibility))
    ),
    reconstructedPlannedAttemptPositions,
    runId,
    runTransition: (transition, execution) => provideDependencies(runTransition(transition, execution)),
    waitForNextExecutorWake: provideDependencies(waitForNextExecutorWake())
  } satisfies AuthoritativeRunRecoveryActivation
})

export const makeRunRecoveryActivation = (runId: RunId, configuredIntegrationTarget?: IntegrationTarget) =>
  makeRunRecoveryActivationEffect(runId, Option.fromUndefinedOr(configuredIntegrationTarget))

/**
 * Routes every already-intended recovered responsibility through the same
 * serial selector/admission/ownership loop used by fresh activation.
 */
export const activateRecoveredResponsibilities = Effect.fn("RunRecoveryActivation.activateRecoveredResponsibilities")(
  function* (
    runId: RunId,
    input: { readonly capacity: TaskWorkCapacity; readonly integrationTarget: IntegrationTarget | undefined }
  ) {
    const recovery = yield* makeRunRecoveryActivation(runId, input.integrationTarget)
    const admissionController = yield* makeTaskAdmissionController({
      capacity: input.capacity,
      reconstructedPlannedAttemptPositions: recovery.reconstructedPlannedAttemptPositions
    })
    const completed = yield* Queue.unbounded<Exit.Exit<void, RunRecoveryActivationError>>()
    const readFrontier: Effect.Effect<RunnableFrontier, RunRecoveryActivationError> = recovery.readFrontier

    yield* Effect.scoped(
      Effect.gen(function* () {
        const coordinator = yield* makeActivationCoordinator({
          admissionController,
          readFrontier,
          runId,
          runTransition: (transition, execution): Effect.Effect<void, RunRecoveryActivationError> =>
            Effect.gen(function* () {
              const exit = yield* recovery.runTransition(transition, execution).pipe(Effect.exit)
              yield* Queue.offer(completed, exit)
              yield* Exit.match(exit, { onFailure: Effect.failCause, onSuccess: () => Effect.void })
            })
        })

        function drainRecoveredResponsibilities(): Effect.Effect<void, RunRecoveryActivationError> {
          return Effect.gen(function* () {
            yield* coordinator.signal(ActivationCause.Restart()).pipe(Effect.orDie)
            const next = (yield* recovery.readFrontier).transitions[0]
            if (next === undefined) {
              yield* recovery.waitForNextExecutorWake
              return
            }
            yield* Queue.take(completed).pipe(Effect.flatten, Effect.andThen(drainRecoveredResponsibilities))
          })
        }
        yield* drainRecoveredResponsibilities()
      })
    )
  }
)
