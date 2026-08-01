/* eslint-disable max-lines -- The closed transition/explanation algebra and its exhaustive mapping share one owner. */
import { Data, Match, Option } from "effect"
import {
  type IntegrationTarget,
  type PlannedTaskAttempt,
  type TaskId,
  type TaskRevision,
  type PlannedAttemptExecutorCorrelation,
  plannedAttemptExecutorCorrelation,
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
import type {
  QueuedIntegrationResponsibility,
  StartedIntegrationResponsibility,
  UnqueuedAcceptedResult
} from "../../workflow/protocols/integration-admission/protocol.js"
import type { WorkflowOperation } from "../../workflow/registry/operation.js"
import type { TaskClaimReacquisitionRequestId } from "../../workflow/protocols/task-claim-reacquisition/events.js"

export { ResponsibilityDisposition, type ResponsibilityFreshFacts } from "./fresh-facts.js"
export { deriveRunFinalityDecision, RunFinalityDecision } from "./run-finality.js"

export type RunnableFrontierTransition = Data.TaggedEnum<{
  CheckTaskClaim: { readonly operationId: OperationId; readonly taskId: TaskId }
  CommitFreshTaskClaimIntent: { readonly taskId: TaskId; readonly taskRevision: TaskRevision }
  CommitTaskClaimReacquisitionIntent: { readonly requestId: TaskClaimReacquisitionRequestId; readonly taskId: TaskId }
  ContinueFreshWorkflowOperation: { readonly operationId: OperationId; readonly taskId: TaskId }
  StartPlannedAttemptExecutorWork: { readonly plannedAttempt: PlannedTaskAttempt }
  ContinuePlannedAttemptExecutorWork: { readonly plannedAttempt: PlannedTaskAttempt }
  ObservePlannedAttemptContinuationGraph: {
    readonly operation: typeof WorkflowOperation.cases.ReadTrackerGraph.Type
    readonly plannedAttempt: PlannedTaskAttempt
  }
  ObservePlannedAttemptContinuationSpecification: {
    readonly operation: typeof WorkflowOperation.cases.ReadTaskWorkSpecification.Type
    readonly plannedAttempt: PlannedTaskAttempt
  }
  ObservePlannedAttemptContinuationClaim: {
    readonly operation: typeof WorkflowOperation.cases.ReadTaskClaim.Type
    readonly plannedAttempt: PlannedTaskAttempt
  }
  ObservePlannedAttemptContinuationWorktree: {
    readonly operation: typeof WorkflowOperation.cases.ReadTaskWorktree.Type
    readonly plannedAttempt: PlannedTaskAttempt
  }
  ObservePlannedAttemptContinuationTargetLineage: {
    readonly operation: typeof WorkflowOperation.cases.ReadTargetLineage.Type
    readonly plannedAttempt: PlannedTaskAttempt
  }
  ObserveResponsibleTaskClaim: {
    readonly operation: typeof WorkflowOperation.cases.ReadTaskClaim.Type
    readonly taskId: TaskId
  }
  SuspendPlannedAttemptExecutorWork: { readonly plannedAttempt: PlannedTaskAttempt }
  ReconcileTaskClaim: { readonly operationId: OperationId; readonly taskId: TaskId }
  ReconcileTaskClaimRelease: { readonly operationId: OperationId; readonly taskId: TaskId }
  ReleaseExternallyCompletedTaskClaim: { readonly operation: typeof WorkflowOperation.cases.ReleaseTaskClaim.Type }
  ReconcileTaskWorktree: { readonly operationId: OperationId; readonly taskId: TaskId }
  QueueAcceptedResultIntegrationResponsibility: {
    readonly accepted: UnqueuedAcceptedResult
    readonly integrationTarget: IntegrationTarget
  }
  StartQueuedIntegration: { readonly responsibility: QueuedIntegrationResponsibility }
  AcquireStartedIntegrationTarget: { readonly responsibility: StartedIntegrationResponsibility }
  ReleaseStartedIntegrationTarget: { readonly responsibility: StartedIntegrationResponsibility }
}>

export const RunnableFrontierTransition = Data.taggedEnum<RunnableFrontierTransition>()

export const runnableTransitionTaskId = (transition: RunnableFrontierTransition): TaskId =>
  transition._tag === "QueueAcceptedResultIntegrationResponsibility"
    ? transition.accepted.plannedAttempt.taskId
    : transition._tag === "ReleaseExternallyCompletedTaskClaim"
      ? transition.operation.release.claim.taskId
      : "responsibility" in transition
        ? transition.responsibility.plannedAttempt.taskId
        : "plannedAttempt" in transition
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
  IntegrationConfigurationWait: { readonly taskId: TaskId; readonly wakeCondition: "IntegrationTargetConfigured" }
  IntegrationTaskClaimConstraint: {
    readonly claimState: "Foreign" | "Missing" | "Unreadable" | "Unobserved"
    readonly taskId: TaskId
    readonly wakeCondition: "ExplicitTaskClaimReacquisitionRequested" | "TaskClaimFactsObserved"
  }
  IntegrationInProgress: { readonly taskId: TaskId }
  IntegrationTrackerFactsWait: { readonly taskId: TaskId; readonly wakeCondition: "TaskTrackerFactsObserved" }
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
  PlannedAttemptTaskLifecycleConstraint: {
    readonly correlation: PlannedAttemptExecutorCorrelation
    readonly lifecycle: "TerminalWithoutSuccess"
    readonly taskId: TaskId
    readonly wakeCondition: "TaskTrackerFactsObserved"
  }
  PlannedAttemptGitConstraint: {
    readonly correlation: PlannedAttemptExecutorCorrelation
    readonly gitState:
      | "CompetingWorktreeRegistrations"
      | "ConflictingWorktreeRegistration"
      | "ContradictoryWorktreeState"
      | "ForeignWorktreeRegistration"
      | "TargetRewrite"
      | "UntrackedWorktreePath"
      | "WorktreeBaseMismatch"
      | "WorktreeLost"
    readonly taskId: TaskId
    readonly wakeCondition: "GitFactsObserved"
  }
  PlannedAttemptTaskExternalSuccessConstraint: {
    readonly correlation: PlannedAttemptExecutorCorrelation
    readonly taskId: TaskId
    readonly wakeCondition: "ExactTaskClaimDispositionApplied"
  }
  PlannedAttemptTaskExternalSuccessSettled: {
    readonly correlation: PlannedAttemptExecutorCorrelation
    readonly taskId: TaskId
  }
  PlannedAttemptTaskClaimConstraint: {
    readonly claimState: "Foreign" | "Missing" | "Unreadable"
    readonly correlation: PlannedAttemptExecutorCorrelation
    readonly taskId: TaskId
    readonly wakeCondition: "ExplicitTaskClaimReacquisitionRequested" | "TaskClaimFactsObserved"
  }
  PlannedAttemptTaskSpecificationChangeConstraint: {
    readonly availableResolutions: readonly [
      "ContinueExistingAttempt",
      "RestartTaskImplementation",
      "StopTaskImplementation"
    ]
    readonly correlation: PlannedAttemptExecutorCorrelation
    readonly observedFingerprint: TaskRevision
    readonly plannedFingerprint: TaskRevision
    readonly taskId: TaskId
    readonly wakeCondition: "TaskResolutionApplied"
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
  WorkflowOperationTaskClaimConstraint: {
    readonly claimState: "Foreign" | "Missing" | "Unreadable" | "Unobserved"
    readonly operationId: OperationId
    readonly taskId: TaskId
    readonly wakeCondition: "ExplicitTaskClaimReacquisitionRequested" | "TaskClaimFactsObserved"
  }
  WorkflowOperationGitConstraint: {
    readonly gitState: "WorktreeLost"
    readonly operationId: OperationId
    readonly taskId: TaskId
    readonly wakeCondition: "GitFactsObserved"
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

const workflowResponsibilityTaskId = (responsibility: WorkflowResponsibilityEntry): TaskId =>
  responsibility._tag === "PlannedAttemptExecutorWorkResponsibility"
    ? responsibility.plannedAttempt.taskId
    : responsibility.taskId

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
      TaskClaimReleaseResponsibility: ({ operation }) =>
        RunnableFrontierTransition.ReconcileTaskClaimRelease({
          operationId: operation.release.operationId,
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
      PlannedAttemptGitConstraint: ({ gitState }) => ({
        explanation: FrontierExplanation.PlannedAttemptGitConstraint({
          correlation: plannedAttemptExecutorCorrelation(facts.responsibility.plannedAttempt),
          gitState,
          taskId: facts.responsibility.plannedAttempt.taskId,
          wakeCondition: "GitFactsObserved"
        })
      }),
      TaskExternalSuccessConstraint: () => ({
        explanation: FrontierExplanation.PlannedAttemptTaskExternalSuccessConstraint({
          correlation: plannedAttemptExecutorCorrelation(facts.responsibility.plannedAttempt),
          taskId: facts.responsibility.plannedAttempt.taskId,
          wakeCondition: "ExactTaskClaimDispositionApplied"
        })
      }),
      TaskExternalSuccessReleaseNeeded: ({ operation }) => ({
        transition: RunnableFrontierTransition.ReleaseExternallyCompletedTaskClaim({ operation })
      }),
      TaskExternalSuccessSettled: () => ({
        explanation: FrontierExplanation.PlannedAttemptTaskExternalSuccessSettled({
          correlation: plannedAttemptExecutorCorrelation(facts.responsibility.plannedAttempt),
          taskId: facts.responsibility.plannedAttempt.taskId
        })
      }),
      TaskClaimMissingConstraint: () => ({
        explanation: FrontierExplanation.PlannedAttemptTaskClaimConstraint({
          claimState: "Missing",
          correlation: plannedAttemptExecutorCorrelation(facts.responsibility.plannedAttempt),
          taskId: facts.responsibility.plannedAttempt.taskId,
          wakeCondition: "ExplicitTaskClaimReacquisitionRequested"
        })
      }),
      TaskClaimUnreadableWait: () => ({
        explanation: FrontierExplanation.PlannedAttemptTaskClaimConstraint({
          claimState: "Unreadable",
          correlation: plannedAttemptExecutorCorrelation(facts.responsibility.plannedAttempt),
          taskId: facts.responsibility.plannedAttempt.taskId,
          wakeCondition: "TaskClaimFactsObserved"
        })
      }),
      TaskForeignClaimIsolation: () => ({
        explanation: FrontierExplanation.PlannedAttemptTaskClaimConstraint({
          claimState: "Foreign",
          correlation: plannedAttemptExecutorCorrelation(facts.responsibility.plannedAttempt),
          taskId: facts.responsibility.plannedAttempt.taskId,
          wakeCondition: "ExplicitTaskClaimReacquisitionRequested"
        })
      }),
      TaskClaimReacquisitionRequested: ({ requestId }) => ({
        transition: RunnableFrontierTransition.CommitTaskClaimReacquisitionIntent({
          requestId,
          taskId: facts.responsibility.plannedAttempt.taskId
        })
      }),
      TaskLifecycleConstraint: ({ lifecycle }) => ({
        explanation: FrontierExplanation.PlannedAttemptTaskLifecycleConstraint({
          correlation: plannedAttemptExecutorCorrelation(facts.responsibility.plannedAttempt),
          lifecycle,
          taskId: facts.responsibility.plannedAttempt.taskId,
          wakeCondition: "TaskTrackerFactsObserved"
        })
      }),
      TaskSpecificationChangeConstraint: ({ observedFingerprint, plannedFingerprint }) => ({
        explanation: FrontierExplanation.PlannedAttemptTaskSpecificationChangeConstraint({
          availableResolutions: ["ContinueExistingAttempt", "RestartTaskImplementation", "StopTaskImplementation"],
          correlation: plannedAttemptExecutorCorrelation(facts.responsibility.plannedAttempt),
          observedFingerprint,
          plannedFingerprint,
          taskId: facts.responsibility.plannedAttempt.taskId,
          wakeCondition: "TaskResolutionApplied"
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
      WorkflowOperationTaskClaimConstraint: ({ claimState }) => ({
        explanation: FrontierExplanation.WorkflowOperationTaskClaimConstraint({
          claimState,
          operationId: workflowResponsibilityOperationId(facts.responsibility),
          taskId: workflowResponsibilityTaskId(facts.responsibility),
          wakeCondition:
            claimState === "Missing" || claimState === "Foreign"
              ? "ExplicitTaskClaimReacquisitionRequested"
              : "TaskClaimFactsObserved"
        })
      }),
      WorkflowOperationGitConstraint: ({ gitState }) => ({
        explanation: FrontierExplanation.WorkflowOperationGitConstraint({
          gitState,
          operationId: workflowResponsibilityOperationId(facts.responsibility),
          taskId: workflowResponsibilityTaskId(facts.responsibility),
          wakeCondition: "GitFactsObserved"
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
