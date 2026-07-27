import { Data, Match, Option } from "effect"
import type { OperationId, TaskId, TaskRevision } from "./domain.js"
import type {
  ExecutorOuterInvocation,
  ExecutorOuterInvocationOutcome,
  ExecutorOuterInvocationWait
} from "./executor-boundary.js"
import {
  type WorkflowResponsibilityEntry,
  workflowResponsibilityOperationId,
  type WorkflowResponsibilityState
} from "./reconstructed-managed-run-state.js"

export type RunnableFrontierTransition = Data.TaggedEnum<{
  CheckTaskClaim: {
    readonly operationId: OperationId
    readonly taskId: TaskId
  }
  CommitFreshTaskClaimIntent: {
    readonly taskId: TaskId
    readonly taskRevision: TaskRevision
  }
  ContinueFreshWorkflowOperation: {
    readonly operationId: OperationId
    readonly taskId: TaskId
  }
  StartExecutorInvocation: {
    readonly invocation: ExecutorOuterInvocation
  }
  ContinueExecutorInvocation: {
    readonly invocation: ExecutorOuterInvocation
  }
  CheckTaskWorkSession: {
    readonly operationId: OperationId
    readonly taskId: TaskId
  }
  ReconcileTaskClaim: {
    readonly operationId: OperationId
    readonly taskId: TaskId
  }
  ReconcileTaskWorktree: {
    readonly operationId: OperationId
    readonly taskId: TaskId
  }
}>

export const RunnableFrontierTransition = Data.taggedEnum<RunnableFrontierTransition>()

export const runnableTransitionTaskId = (
  transition: RunnableFrontierTransition
): TaskId =>
  transition._tag === "ContinueExecutorInvocation"
    || transition._tag === "StartExecutorInvocation"
    ? transition.invocation.correlation.taskId
    : transition.taskId

export const runnableTransitionOperationId = (
  transition: RunnableFrontierTransition
): OperationId | undefined =>
  transition._tag === "ContinueExecutorInvocation"
    || transition._tag === "StartExecutorInvocation"
    ? transition.invocation.correlation.invocationId
    : "operationId" in transition
    ? transition.operationId
    : undefined

export type ResponsibilityDisposition = Data.TaggedEnum<{
  DependencyWait: {
    readonly prerequisiteTaskIds: ReadonlyArray<TaskId>
  }
  FinalOutcome: {
    readonly outcome: "Blocked" | "Cancelled" | "Completed" | "Failed"
  }
  ExecutorInvocationWait: {
    readonly wait: ExecutorOuterInvocationWait
  }
  ExecutorInvocationSettled: {
    readonly outcome: ExecutorOuterInvocationOutcome
  }
  ForeignClaimIsolation: Record<never, never>
  MissingClaim: Record<never, never>
  Paused: Record<never, never>
  Ready: Record<never, never>
  Relinquished: {
    readonly reason: "AuthorizedHandoff" | "FreshAuthorityRevocation"
  }
  Settled: {
    readonly outcome: "ResponsibilityCompleted" | "TrackerCompleted"
  }
  UnreadableFactWait: {
    readonly boundary: "Executor" | "Git" | "TaskTracker" | "TaskWorkProvider"
  }
}>

export const ResponsibilityDisposition = Data.taggedEnum<ResponsibilityDisposition>()

export type FrontierExplanation = Data.TaggedEnum<{
  CapacityWait: {
    readonly taskId: TaskId
    readonly wakeCondition: "CapacityReleasedOrReconstructedStateChanged"
  }
  ActivationInProgress: {
    readonly operationId: Option.Option<OperationId>
    readonly taskId: TaskId
  }
  DependencyWait: {
    readonly operationId: OperationId
    readonly prerequisiteTaskIds: ReadonlyArray<TaskId>
    readonly taskId: TaskId
    readonly wakeCondition: "TaskGraphFactsUpdated"
  }
  ExecutorInvocationWait: {
    readonly taskId: TaskId
    readonly wait: ExecutorOuterInvocationWait
    readonly wakeCondition: "ExecutorRetryDeadlineReached"
  }
  ExecutorInvocationSettlement: {
    readonly operationId: OperationId
    readonly outcome: ExecutorOuterInvocationOutcome
    readonly taskId: TaskId
  }
  FinalOutcome: {
    readonly operationId: OperationId
    readonly outcome: "Blocked" | "Cancelled" | "Completed" | "Failed"
    readonly taskId: TaskId
  }
  Isolation: {
    readonly operationId: OperationId
    readonly reason: "ForeignClaim"
    readonly taskId: TaskId
  }
  Pause: {
    readonly operationId: OperationId
    readonly taskId: TaskId
  }
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
  TypedIssue: {
    readonly operationId: OperationId
    readonly reason: "DuplicateFreshFacts" | "MissingFreshFacts"
  }
  UnreadableFactWait: {
    readonly boundary: "Executor" | "Git" | "TaskTracker" | "TaskWorkProvider"
    readonly operationId: OperationId
    readonly taskId: TaskId
    readonly wakeCondition: "BoundaryRereadSucceeded"
  }
}>

export const FrontierExplanation = Data.taggedEnum<FrontierExplanation>()

export interface ResponsibilityFreshFacts {
  readonly disposition: ResponsibilityDisposition
  readonly responsibility: WorkflowResponsibilityEntry
}

export interface RunnableFrontierInput {
  readonly freshEligibleTasks: ReadonlyArray<{
    readonly taskId: TaskId
    readonly taskRevision: TaskRevision
  }>
  readonly responsibility: WorkflowResponsibilityState
  readonly responsibilityFacts: ReadonlyArray<ResponsibilityFreshFacts>
}

export interface RunnableFrontier {
  readonly explanations: ReadonlyArray<FrontierExplanation>
  readonly transitions: ReadonlyArray<RunnableFrontierTransition>
}

export type RunFinalityDecision = Data.TaggedEnum<{
  RunMayTerminate: Record<never, never>
  RunMustRemainActive: {
    readonly reason:
      | "RunnableTransition"
      | "TrackerTargetUnsettled"
      | "UnsettledResponsibility"
  }
}>

export const RunFinalityDecision = Data.taggedEnum<RunFinalityDecision>()

const workflowResponsibilityTaskId = (
  responsibility: WorkflowResponsibilityEntry
): TaskId =>
  responsibility._tag === "ExecutorInvocationResponsibility"
    ? responsibility.invocation.correlation.taskId
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
  const terminalOperationIds = new Set(
    frontier.explanations.flatMap((explanation) =>
      explanation._tag === "FinalOutcome"
        || explanation._tag === "ExecutorInvocationSettlement"
        || explanation._tag === "Relinquishment"
        || explanation._tag === "Settlement"
        ? [explanation.operationId]
        : []
    )
  )
  if (
    responsibility.entries.some((entry) => !terminalOperationIds.has(workflowResponsibilityOperationId(entry)))
  ) {
    return RunFinalityDecision.RunMustRemainActive({
      reason: "UnsettledResponsibility"
    })
  }
  return trackerTargetSettled
    ? RunFinalityDecision.RunMayTerminate()
    : RunFinalityDecision.RunMustRemainActive({ reason: "TrackerTargetUnsettled" })
}

const readyTransition = (
  facts: ResponsibilityFreshFacts
): RunnableFrontierTransition =>
  Match.value(facts.responsibility).pipe(
    Match.tags({
      ExecutorInvocationResponsibility: ({ invocation }) =>
        RunnableFrontierTransition.ContinueExecutorInvocation({
          invocation
        }),
      TaskClaimResponsibility: ({ acquisition }) =>
        RunnableFrontierTransition.CheckTaskClaim({
          operationId: acquisition.operationId,
          taskId: workflowResponsibilityTaskId(facts.responsibility)
        }),
      TaskWorkSessionResponsibility: ({ operation }) =>
        RunnableFrontierTransition.CheckTaskWorkSession({
          operationId: operation.request.operationId,
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

const decisionFor = (
  facts: ResponsibilityFreshFacts
): {
  readonly explanation?: FrontierExplanation
  readonly transition?: RunnableFrontierTransition
} =>
  ResponsibilityDisposition.$match(facts.disposition, {
    DependencyWait: ({ prerequisiteTaskIds }) => ({
      explanation: FrontierExplanation.DependencyWait({
        operationId: workflowResponsibilityOperationId(facts.responsibility),
        prerequisiteTaskIds: [...prerequisiteTaskIds].sort(),
        taskId: workflowResponsibilityTaskId(facts.responsibility),
        wakeCondition: "TaskGraphFactsUpdated"
      })
    }),
    FinalOutcome: ({ outcome }) => ({
      explanation: FrontierExplanation.FinalOutcome({
        operationId: workflowResponsibilityOperationId(facts.responsibility),
        outcome,
        taskId: workflowResponsibilityTaskId(facts.responsibility)
      })
    }),
    ExecutorInvocationWait: ({ wait }) => ({
      explanation: FrontierExplanation.ExecutorInvocationWait({
        taskId: workflowResponsibilityTaskId(facts.responsibility),
        wait,
        wakeCondition: "ExecutorRetryDeadlineReached"
      })
    }),
    ExecutorInvocationSettled: ({ outcome }) => ({
      explanation: FrontierExplanation.ExecutorInvocationSettlement({
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
    UnreadableFactWait: ({ boundary }) => ({
      explanation: FrontierExplanation.UnreadableFactWait({
        boundary,
        operationId: workflowResponsibilityOperationId(facts.responsibility),
        taskId: workflowResponsibilityTaskId(facts.responsibility),
        wakeCondition: "BoundaryRereadSucceeded"
      })
    })
  })

/** Derives process-local choices in responsibility-first, canonical task order. */
export const deriveRunnableFrontier = (
  input: RunnableFrontierInput
): RunnableFrontier => {
  const responsibleDecisions = input.responsibility.entries
    .map((responsibility) => {
      const operationId = workflowResponsibilityOperationId(responsibility)
      const matchingFacts = input.responsibilityFacts.filter((facts) =>
        workflowResponsibilityOperationId(facts.responsibility) === operationId
      )
      const decision = matchingFacts.length === 1
        ? decisionFor(Option.getOrThrow(Option.fromUndefinedOr(matchingFacts[0])))
        : {
          explanation: FrontierExplanation.TypedIssue({
            operationId,
            reason: matchingFacts.length === 0
              ? "MissingFreshFacts"
              : "DuplicateFreshFacts"
          })
        }
      return {
        ...decision,
        beganAt: responsibility.beganAt,
        taskId: workflowResponsibilityTaskId(responsibility)
      }
    })
  const responsibleTaskIds = new Set(
    input.responsibility.entries.map(workflowResponsibilityTaskId)
  )
  const responsibleTransitions = responsibleDecisions
    .filter((decision): decision is typeof decision & {
      readonly transition: RunnableFrontierTransition
    } => decision.transition !== undefined)
    .toSorted((left, right) => left.beganAt - right.beganAt || left.taskId.localeCompare(right.taskId))
    .map(({ transition }) => transition)
  const freshTransitions = input.freshEligibleTasks
    .filter(({ taskId }) => !responsibleTaskIds.has(taskId))
    .filter(({ taskId }, index, tasks) => tasks.findIndex((candidate) => candidate.taskId === taskId) === index)
    .toSorted((left, right) => left.taskId.localeCompare(right.taskId))
    .map(({ taskId, taskRevision }) =>
      RunnableFrontierTransition.CommitFreshTaskClaimIntent({
        taskId,
        taskRevision
      })
    )
  return {
    explanations: responsibleDecisions.flatMap(({ explanation }) => explanation === undefined ? [] : [explanation]),
    transitions: [...responsibleTransitions, ...freshTransitions]
  }
}
