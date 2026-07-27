import { Data, Match, Option } from "effect"
import type { OperationId, TaskId, TaskRevision } from "./domain.js"
import {
  type WorkflowResponsibilityEntry,
  type WorkflowResponsibilityState
} from "./reconstructed-managed-run-state.js"

/**
 * Issue #133 replaces the evidence-sealing-, review-, and handback-specific
 * variants below with executor-declared outer transitions. They preserve only
 * the current fixed executor protocol and are not universal Dalph
 * orchestration vocabulary.
 */
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
  ContinueImplementationEvidenceSealing: {
    readonly operationId: OperationId
    readonly taskId: TaskId
  }
  ContinueImplementationReview: {
    readonly operationId: OperationId
    readonly taskId: TaskId
  }
  ContinueReviewFindingsHandback: {
    readonly operationId: OperationId
    readonly taskId: TaskId
  }
  ContinueTaskExecution: {
    readonly operationId: OperationId
    readonly taskId: TaskId
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

export type ResponsibilityDisposition = Data.TaggedEnum<{
  DependencyWait: {
    readonly prerequisiteTaskIds: ReadonlyArray<TaskId>
  }
  FinalOutcome: {
    readonly outcome: "Blocked" | "Cancelled" | "Completed" | "Failed"
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

const responsibilityOperationId = (
  responsibility: WorkflowResponsibilityEntry
): OperationId =>
  Match.value(responsibility).pipe(
    Match.tags({
      ImplementationEvidenceResponsibility: ({ operation }) => operation.operationId,
      ImplementationReviewResponsibility: ({ operation }) => operation.request.operationId,
      ReviewFindingsHandbackResponsibility: ({ operation }) => operation.request.operationId,
      TaskClaimResponsibility: ({ acquisition }) => acquisition.operationId,
      TaskExecutionResponsibility: ({ operation }) => operation.request.operationId,
      TaskWorkSessionResponsibility: ({ operation }) => operation.request.operationId,
      TaskWorktreeResponsibility: ({ operation }) => operation.operationId
    }),
    Match.exhaustive
  )

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
        || explanation._tag === "Relinquishment"
        || explanation._tag === "Settlement"
        ? [explanation.operationId]
        : []
    )
  )
  if (
    responsibility.entries.some((entry) => !terminalOperationIds.has(responsibilityOperationId(entry)))
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
      ImplementationEvidenceResponsibility: ({ operation }) =>
        RunnableFrontierTransition.ContinueImplementationEvidenceSealing({
          operationId: operation.operationId,
          taskId: facts.responsibility.taskId
        }),
      ImplementationReviewResponsibility: ({ operation }) =>
        RunnableFrontierTransition.ContinueImplementationReview({
          operationId: operation.request.operationId,
          taskId: facts.responsibility.taskId
        }),
      ReviewFindingsHandbackResponsibility: ({ operation }) =>
        RunnableFrontierTransition.ContinueReviewFindingsHandback({
          operationId: operation.request.operationId,
          taskId: facts.responsibility.taskId
        }),
      TaskClaimResponsibility: ({ acquisition }) =>
        RunnableFrontierTransition.CheckTaskClaim({
          operationId: acquisition.operationId,
          taskId: facts.responsibility.taskId
        }),
      TaskExecutionResponsibility: ({ operation }) =>
        RunnableFrontierTransition.ContinueTaskExecution({
          operationId: operation.request.operationId,
          taskId: facts.responsibility.taskId
        }),
      TaskWorkSessionResponsibility: ({ operation }) =>
        RunnableFrontierTransition.CheckTaskWorkSession({
          operationId: operation.request.operationId,
          taskId: facts.responsibility.taskId
        }),
      TaskWorktreeResponsibility: ({ operation }) =>
        RunnableFrontierTransition.ReconcileTaskWorktree({
          operationId: operation.operationId,
          taskId: facts.responsibility.taskId
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
        operationId: responsibilityOperationId(facts.responsibility),
        prerequisiteTaskIds: [...prerequisiteTaskIds].sort(),
        taskId: facts.responsibility.taskId,
        wakeCondition: "TaskGraphFactsUpdated"
      })
    }),
    FinalOutcome: ({ outcome }) => ({
      explanation: FrontierExplanation.FinalOutcome({
        operationId: responsibilityOperationId(facts.responsibility),
        outcome,
        taskId: facts.responsibility.taskId
      })
    }),
    ForeignClaimIsolation: () => ({
      explanation: FrontierExplanation.Isolation({
        operationId: responsibilityOperationId(facts.responsibility),
        reason: "ForeignClaim",
        taskId: facts.responsibility.taskId
      })
    }),
    MissingClaim: () => ({
      transition: RunnableFrontierTransition.ReconcileTaskClaim({
        operationId: responsibilityOperationId(facts.responsibility),
        taskId: facts.responsibility.taskId
      })
    }),
    Paused: () => ({
      explanation: FrontierExplanation.Pause({
        operationId: responsibilityOperationId(facts.responsibility),
        taskId: facts.responsibility.taskId
      })
    }),
    Ready: () => ({ transition: readyTransition(facts) }),
    Relinquished: ({ reason }) => ({
      explanation: FrontierExplanation.Relinquishment({
        operationId: responsibilityOperationId(facts.responsibility),
        reason,
        taskId: facts.responsibility.taskId
      })
    }),
    Settled: ({ outcome }) => ({
      explanation: FrontierExplanation.Settlement({
        operationId: responsibilityOperationId(facts.responsibility),
        outcome,
        taskId: facts.responsibility.taskId
      })
    }),
    UnreadableFactWait: ({ boundary }) => ({
      explanation: FrontierExplanation.UnreadableFactWait({
        boundary,
        operationId: responsibilityOperationId(facts.responsibility),
        taskId: facts.responsibility.taskId,
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
      const operationId = responsibilityOperationId(responsibility)
      const matchingFacts = input.responsibilityFacts.filter((facts) =>
        responsibilityOperationId(facts.responsibility) === operationId
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
        taskId: responsibility.taskId
      }
    })
  const responsibleTaskIds = new Set(
    input.responsibility.entries.map(({ taskId }) => taskId)
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
