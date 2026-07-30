import { Data, Match, Option } from "effect"
import {
  type PlannedTaskAttempt,
  type TaskId,
  type TaskRevision,
  type PlannedAttemptExecutorCorrelation,
  plannedAttemptExecutorCorrelation,
  plannedAttemptExecutorCorrelationKey,
  type PlannedAttemptExecutorReport
} from "@dalph/contracts"
import { type OperationId } from "../../workflow/identity.js"
import {
  type WorkflowResponsibilityEntry,
  workflowResponsibilityKey,
  workflowResponsibilityOperationId,
  type WorkflowResponsibilityState
} from "../reconstruction/state.js"
import type { ResponsibilityFreshFacts } from "./fresh-facts.js"
import type { QueuedIntegrationResponsibility } from "../../workflow/protocols/integration-admission/protocol.js"

export { ResponsibilityDisposition, type ResponsibilityFreshFacts } from "./fresh-facts.js"

export type RunnableFrontierTransition = Data.TaggedEnum<{
  CheckTaskClaim: { readonly operationId: OperationId; readonly taskId: TaskId }
  CommitFreshTaskClaimIntent: { readonly taskId: TaskId; readonly taskRevision: TaskRevision }
  ContinueFreshWorkflowOperation: { readonly operationId: OperationId; readonly taskId: TaskId }
  StartPlannedAttemptExecutorWork: { readonly plannedAttempt: PlannedTaskAttempt }
  ContinuePlannedAttemptExecutorWork: { readonly plannedAttempt: PlannedTaskAttempt }
  SuspendPlannedAttemptExecutorWork: { readonly plannedAttempt: PlannedTaskAttempt }
  ReconcileTaskClaim: { readonly operationId: OperationId; readonly taskId: TaskId }
  ReconcileTaskWorktree: { readonly operationId: OperationId; readonly taskId: TaskId }
  StartQueuedIntegration: { readonly responsibility: QueuedIntegrationResponsibility }
}>

export const RunnableFrontierTransition = Data.taggedEnum<RunnableFrontierTransition>()

export const runnableTransitionTaskId = (transition: RunnableFrontierTransition): TaskId =>
  transition._tag === "StartQueuedIntegration"
    ? transition.responsibility.plannedAttempt.taskId
    : transition._tag === "ContinuePlannedAttemptExecutorWork" ||
        transition._tag === "SuspendPlannedAttemptExecutorWork" ||
        transition._tag === "StartPlannedAttemptExecutorWork"
      ? transition.plannedAttempt.taskId
      : transition.taskId

export const runnableTransitionOperationId = (transition: RunnableFrontierTransition): OperationId | undefined =>
  "operationId" in transition ? transition.operationId : undefined

export type FrontierExplanation = Data.TaggedEnum<{
  CapacityWait: { readonly taskId: TaskId; readonly wakeCondition: "CapacityReleasedOrReconstructedStateChanged" }
  ActivationInProgress: { readonly operationId: Option.Option<OperationId>; readonly taskId: TaskId }
  DependencyWait: {
    readonly operationId: OperationId
    readonly prerequisiteTaskIds: ReadonlyArray<TaskId>
    readonly taskId: TaskId
    readonly wakeCondition: "TaskTrackerFactsObserved"
  }
  IntegrationDependencyWait: {
    readonly plannedAttempt: QueuedIntegrationResponsibility["plannedAttempt"]
    readonly prerequisiteTaskIds: ReadonlyArray<TaskId>
    readonly wakeCondition: "TaskTrackerFactsObserved"
  }
  IntegrationInProgress: { readonly taskId: TaskId }
  IntegrationTargetWait: { readonly taskId: TaskId; readonly wakeCondition: "IntegrationTargetReleased" }
  PlannedAttemptExecutorWorkSafelySuspended: {
    readonly correlation: PlannedAttemptExecutorCorrelation
    readonly taskId: TaskId
  }
  PlannedAttemptExecutorWorkTerminal: {
    readonly report: Extract<PlannedAttemptExecutorReport, { readonly _tag: "Terminal" }>
    readonly taskId: TaskId
  }
  PlannedAttemptExecutorWorkTypedIssue: {
    readonly correlation: PlannedAttemptExecutorCorrelation
    readonly reason: "DuplicateFreshFacts" | "MissingFreshFacts"
  }
  PlannedAttemptTaskMembershipConstraint: {
    readonly correlation: PlannedAttemptExecutorCorrelation
    readonly taskId: TaskId
    readonly wakeCondition: "TaskTrackerFactsObserved"
  }
  FinalOutcome: {
    readonly operationId: OperationId
    readonly outcome: "Blocked" | "Cancelled" | "Completed" | "Failed"
    readonly taskId: TaskId
  }
  Isolation: { readonly operationId: OperationId; readonly reason: "ForeignClaim"; readonly taskId: TaskId }
  Pause: { readonly operationId: OperationId; readonly taskId: TaskId }
  Relinquishment: {
    readonly operationId: OperationId
    readonly reason: "AuthorizedHandoff" | "FreshAuthorityRevocation"
    readonly taskId: TaskId
  }
  Settlement: {
    readonly operationId: OperationId
    readonly outcome: "ResponsibilityCompleted" | "TrackerCompleted"
    readonly taskId: TaskId
  }
  TypedIssue: { readonly operationId: OperationId; readonly reason: "DuplicateFreshFacts" | "MissingFreshFacts" }
  WorkflowOperationTaskMembershipConstraint: {
    readonly operationId: OperationId
    readonly taskId: TaskId
    readonly wakeCondition: "TaskTrackerFactsObserved"
  }
  UnreadableFactWait: {
    readonly boundary: "Executor" | "Git" | "TaskTracker"
    readonly operationId: OperationId
    readonly taskId: TaskId
    readonly wakeCondition: "BoundaryRereadSucceeded"
  }
}>

export const FrontierExplanation = Data.taggedEnum<FrontierExplanation>()

export interface RunnableFrontierInput {
  readonly freshEligibleTasks: ReadonlyArray<{ readonly taskId: TaskId; readonly taskRevision: TaskRevision }>
  readonly responsibility: WorkflowResponsibilityState
  readonly responsibilityFacts: ReadonlyArray<ResponsibilityFreshFacts>
}

export interface RunnableFrontier {
  readonly explanations: ReadonlyArray<FrontierExplanation>
  readonly transitions: ReadonlyArray<RunnableFrontierTransition>
}

export type RunFinalityDecision = Data.TaggedEnum<{
  RunMayTerminate: Record<never, never>
  RunMustRemainActive: { readonly reason: "RunnableTransition" | "TrackerTargetUnsettled" | "UnsettledResponsibility" }
}>

export const RunFinalityDecision = Data.taggedEnum<RunFinalityDecision>()

const workflowResponsibilityTaskId = (responsibility: WorkflowResponsibilityEntry): TaskId =>
  responsibility._tag === "PlannedAttemptExecutorWorkResponsibility"
    ? responsibility.plannedAttempt.taskId
    : responsibility.taskId

/** Run termination requires tracker settlement and no runnable or unsettled responsibility. */
export const deriveRunFinalityDecision = (
  frontier: RunnableFrontier,
  responsibility: WorkflowResponsibilityState,
  trackerTargetSettled: boolean
): RunFinalityDecision => {
  if (frontier.transitions.length > 0) {
    return RunFinalityDecision.RunMustRemainActive({ reason: "RunnableTransition" })
  }
  if (
    frontier.explanations.some(
      ({ _tag }) =>
        _tag === "IntegrationDependencyWait" || _tag === "IntegrationInProgress" || _tag === "IntegrationTargetWait"
    )
  ) {
    return RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })
  }
  const terminalOperationIds = new Set(
    frontier.explanations.flatMap((explanation) =>
      explanation._tag === "FinalOutcome" || explanation._tag === "Relinquishment" || explanation._tag === "Settlement"
        ? [explanation.operationId]
        : []
    )
  )
  const terminalPlannedAttempts = new Set(
    frontier.explanations.flatMap((explanation) =>
      explanation._tag === "PlannedAttemptExecutorWorkTerminal"
        ? [plannedAttemptExecutorCorrelationKey(explanation.report.correlation)]
        : []
    )
  )
  if (
    responsibility.entries.some((entry) =>
      entry._tag === "PlannedAttemptExecutorWorkResponsibility"
        ? !terminalPlannedAttempts.has(
            plannedAttemptExecutorCorrelationKey(plannedAttemptExecutorCorrelation(entry.plannedAttempt))
          )
        : !terminalOperationIds.has(workflowResponsibilityOperationId(entry))
    )
  ) {
    return RunFinalityDecision.RunMustRemainActive({ reason: "UnsettledResponsibility" })
  }
  return trackerTargetSettled
    ? RunFinalityDecision.RunMayTerminate()
    : RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })
}

const readyTransition = (
  facts: Extract<ResponsibilityFreshFacts, { readonly _tag: "WorkflowOperationFreshFacts" }>
): RunnableFrontierTransition =>
  Match.value(facts.responsibility).pipe(
    Match.tags({
      TaskClaimResponsibility: ({ acquisition }) =>
        RunnableFrontierTransition.CheckTaskClaim({
          operationId: acquisition.operationId,
          taskId: workflowResponsibilityTaskId(facts.responsibility)
        }),
      TaskWorktreeResponsibility: ({ operation }) =>
        RunnableFrontierTransition.ReconcileTaskWorktree({
          operationId: operation.operationId,
          taskId: workflowResponsibilityTaskId(facts.responsibility)
        })
    }),
    Match.exhaustive
  )

const executorDecisionFor = (
  facts: Extract<ResponsibilityFreshFacts, { readonly _tag: "PlannedAttemptExecutorFreshFacts" }>
): { readonly explanation?: FrontierExplanation; readonly transition?: RunnableFrontierTransition } =>
  Match.value(facts.disposition).pipe(
    Match.tags({
      PlannedAttemptExecutorWorkSafelySuspended: ({ correlation }) => ({
        explanation: FrontierExplanation.PlannedAttemptExecutorWorkSafelySuspended({
          correlation,
          taskId: facts.responsibility.plannedAttempt.taskId
        })
      }),
      PlannedAttemptExecutorWorkTerminal: ({ report }) => ({
        explanation: FrontierExplanation.PlannedAttemptExecutorWorkTerminal({
          report,
          taskId: facts.responsibility.plannedAttempt.taskId
        })
      }),
      PlannedAttemptExecutorSuspensionRequested: () => ({
        transition: RunnableFrontierTransition.SuspendPlannedAttemptExecutorWork({
          plannedAttempt: facts.responsibility.plannedAttempt
        })
      }),
      TaskMembershipConstraint: () => ({
        explanation: FrontierExplanation.PlannedAttemptTaskMembershipConstraint({
          correlation: plannedAttemptExecutorCorrelation(facts.responsibility.plannedAttempt),
          taskId: facts.responsibility.plannedAttempt.taskId,
          wakeCondition: "TaskTrackerFactsObserved"
        })
      }),
      Ready: () => ({
        transition: RunnableFrontierTransition.ContinuePlannedAttemptExecutorWork({
          plannedAttempt: facts.responsibility.plannedAttempt
        })
      })
    }),
    Match.exhaustive
  )

const operationDecisionFor = (
  facts: Extract<ResponsibilityFreshFacts, { readonly _tag: "WorkflowOperationFreshFacts" }>
): { readonly explanation?: FrontierExplanation; readonly transition?: RunnableFrontierTransition } =>
  Match.value(facts.disposition).pipe(
    Match.tags({
      DependencyWait: ({ prerequisiteTaskIds }) => ({
        explanation: FrontierExplanation.DependencyWait({
          operationId: workflowResponsibilityOperationId(facts.responsibility),
          prerequisiteTaskIds: [...prerequisiteTaskIds].sort(),
          taskId: workflowResponsibilityTaskId(facts.responsibility),
          wakeCondition: "TaskTrackerFactsObserved"
        })
      }),
      FinalOutcome: ({ outcome }) => ({
        explanation: FrontierExplanation.FinalOutcome({
          operationId: workflowResponsibilityOperationId(facts.responsibility),
          outcome,
          taskId: workflowResponsibilityTaskId(facts.responsibility)
        })
      }),
      ForeignClaimIsolation: () => ({
        explanation: FrontierExplanation.Isolation({
          operationId: workflowResponsibilityOperationId(facts.responsibility),
          reason: "ForeignClaim",
          taskId: workflowResponsibilityTaskId(facts.responsibility)
        })
      }),
      MissingClaim: () => ({
        transition: RunnableFrontierTransition.ReconcileTaskClaim({
          operationId: workflowResponsibilityOperationId(facts.responsibility),
          taskId: workflowResponsibilityTaskId(facts.responsibility)
        })
      }),
      Paused: () => ({
        explanation: FrontierExplanation.Pause({
          operationId: workflowResponsibilityOperationId(facts.responsibility),
          taskId: workflowResponsibilityTaskId(facts.responsibility)
        })
      }),
      Ready: () => ({ transition: readyTransition(facts) }),
      Relinquished: ({ reason }) => ({
        explanation: FrontierExplanation.Relinquishment({
          operationId: workflowResponsibilityOperationId(facts.responsibility),
          reason,
          taskId: workflowResponsibilityTaskId(facts.responsibility)
        })
      }),
      Settled: ({ outcome }) => ({
        explanation: FrontierExplanation.Settlement({
          operationId: workflowResponsibilityOperationId(facts.responsibility),
          outcome,
          taskId: workflowResponsibilityTaskId(facts.responsibility)
        })
      }),
      TaskMembershipConstraint: () => ({
        explanation: FrontierExplanation.WorkflowOperationTaskMembershipConstraint({
          operationId: workflowResponsibilityOperationId(facts.responsibility),
          taskId: workflowResponsibilityTaskId(facts.responsibility),
          wakeCondition: "TaskTrackerFactsObserved"
        })
      }),
      UnreadableFactWait: ({ boundary }) => ({
        explanation: FrontierExplanation.UnreadableFactWait({
          boundary,
          operationId: workflowResponsibilityOperationId(facts.responsibility),
          taskId: workflowResponsibilityTaskId(facts.responsibility),
          wakeCondition: "BoundaryRereadSucceeded"
        })
      })
    }),
    Match.exhaustive
  )

const decisionFor = (
  facts: ResponsibilityFreshFacts
): { readonly explanation?: FrontierExplanation; readonly transition?: RunnableFrontierTransition } =>
  facts._tag === "PlannedAttemptExecutorFreshFacts" ? executorDecisionFor(facts) : operationDecisionFor(facts)

/** Derives process-local choices in responsibility-first, canonical task order. */
export const deriveRunnableFrontier = (input: RunnableFrontierInput): RunnableFrontier => {
  const responsibleDecisions = input.responsibility.entries.map((responsibility) => {
    const responsibilityKey = workflowResponsibilityKey(responsibility)
    const matchingFacts = input.responsibilityFacts.filter(
      (facts) => workflowResponsibilityKey(facts.responsibility) === responsibilityKey
    )
    const decision =
      matchingFacts.length === 1
        ? decisionFor(Option.getOrThrow(Option.fromUndefinedOr(matchingFacts[0])))
        : responsibility._tag === "PlannedAttemptExecutorWorkResponsibility"
          ? {
              explanation: FrontierExplanation.PlannedAttemptExecutorWorkTypedIssue({
                correlation: {
                  attemptId: responsibility.plannedAttempt.attemptId,
                  runId: responsibility.plannedAttempt.runId
                },
                reason: matchingFacts.length === 0 ? "MissingFreshFacts" : "DuplicateFreshFacts"
              })
            }
          : {
              explanation: FrontierExplanation.TypedIssue({
                operationId: workflowResponsibilityOperationId(responsibility),
                reason: matchingFacts.length === 0 ? "MissingFreshFacts" : "DuplicateFreshFacts"
              })
            }
    return { ...decision, beganAt: responsibility.beganAt, taskId: workflowResponsibilityTaskId(responsibility) }
  })
  const responsibleTaskIds = new Set(input.responsibility.entries.map(workflowResponsibilityTaskId))
  const responsibleTransitions = responsibleDecisions
    .filter(
      (decision): decision is typeof decision & { readonly transition: RunnableFrontierTransition } =>
        decision.transition !== undefined
    )
    .toSorted((left, right) => left.beganAt - right.beganAt || left.taskId.localeCompare(right.taskId))
    .map(({ transition }) => transition)
  const freshTransitions = input.freshEligibleTasks
    .filter(({ taskId }) => !responsibleTaskIds.has(taskId))
    .filter(({ taskId }, index, tasks) => tasks.findIndex((candidate) => candidate.taskId === taskId) === index)
    .toSorted((left, right) => left.taskId.localeCompare(right.taskId))
    .map(({ taskId, taskRevision }) => RunnableFrontierTransition.CommitFreshTaskClaimIntent({ taskId, taskRevision }))
  return {
    explanations: responsibleDecisions.flatMap(({ explanation }) => (explanation === undefined ? [] : [explanation])),
    transitions: [...responsibleTransitions, ...freshTransitions]
  }
}
