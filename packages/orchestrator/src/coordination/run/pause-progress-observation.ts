/* eslint-disable max-lines -- The correlated Pause responsibility algebra and its exhaustive projection stay co-located. */
import {
  plannedAttemptExecutorCorrelation,
  plannedAttemptExecutorCorrelationKey,
  type PlannedAttemptExecutorCorrelation,
  RunId,
  type TaskId
} from "@dalph/contracts"
import { Match, Schema } from "effect"
import type { IntegrationTargetResourceSnapshot } from "../admission/integration-target-resource.js"
import type {
  DeliveryRuntimeLiveOwnerSnapshot,
  DeliveryRuntimeObservationState
} from "../delivery/delivery-runtime-observation.js"
import {
  acceptedWorkflowTransitionOperationId,
  deliveryProposalOrderTaskId,
  type DeliveryActionProposal,
  DeliveryProposalId
} from "../delivery/delivery-action-proposal.js"
import type { ExactWorkflowObligation, PauseCoverageFacts, TicketDelivery } from "../delivery/relations.js"
import {
  workflowResponsibilityKey,
  workflowResponsibilityOperationId,
  type WorkflowOperationResponsibility,
  type WorkflowResponsibilityEntry
} from "../reconstruction/state.js"
import {
  ControlDirectionSubject,
  type ControlDirectionSubject as ControlDirectionSubjectType
} from "../../workflow/protocols/control-direction-application/events.js"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { TargetPromotionCorrelation } from "../../workflow/protocols/target-promotion/events.js"
import type { StartedIntegrationResponsibility } from "../../workflow/protocols/integration-admission/protocol.js"
import { integrationResponsibilityEquivalence } from "../../workflow/protocols/integration-admission/responsibility.js"

/** Alice asked for Pause progress on an exact subject whose latest applied direction is not Pause. */
export class PauseNotApplied extends Schema.TaggedError<PauseNotApplied>()("PauseNotApplied", {
  subject: ControlDirectionSubject
}) {}

/** The delivery relation cannot assign one exact action owner, so Pause confirmation fails closed. */
export class PauseProgressProjectionConflict extends Schema.TaggedError<PauseProgressProjectionConflict>()(
  "PauseProgressProjectionConflict",
  { proposalIds: Schema.NonEmptyArray(DeliveryProposalId), subject: ControlDirectionSubject }
) {}

/** Alice named a different Run than the activation supplying this process-local observation. */
export class PauseObservationRunMismatch extends Schema.TaggedError<PauseObservationRunMismatch>()(
  "PauseObservationRunMismatch",
  { expectedRunId: RunId, requestedRunId: RunId }
) {}

/** Why one exact task responsibility is covered by the applied Pause. */
export type PauseResponsibilityCoverage =
  | { readonly _tag: "RunPauseCoverage" }
  | { readonly _tag: "ExactTaskPauseCoverage" }
  | {
      readonly _tag: "GroupingDescendantPauseCoverage"
      readonly groupingObservedAt: JournalPosition
      readonly pausedTaskId: TaskId
    }

type WorkflowObligation = Extract<ExactWorkflowObligation, { readonly _tag: "WorkflowResponsibility" }>
type ExecutorWorkflowObligation = WorkflowObligation & {
  readonly responsibility: Extract<
    WorkflowResponsibilityEntry,
    { readonly _tag: "PlannedAttemptExecutorWorkResponsibility" }
  >
}
type OperationWorkflowObligation = WorkflowObligation & { readonly responsibility: WorkflowOperationResponsibility }
type AcceptedIntegrationObligation = Extract<ExactWorkflowObligation, { readonly _tag: "AcceptedAwaitingIntegration" }>
type QueuedIntegrationObligation = Extract<ExactWorkflowObligation, { readonly _tag: "QueuedIntegration" }>
type StartedIntegrationObligation = Extract<ExactWorkflowObligation, { readonly _tag: "StartedIntegration" }>

/** Proves this projection derived display task and Pause coverage from the responsibility's exact identity. */
const PauseResponsibilityTypeId: unique symbol = Symbol("@dalph/PauseResponsibility")

interface PauseResponsibilityBase {
  /** Only this projection can bind coverage and display identity to the exact obligation or proposal. */
  readonly [PauseResponsibilityTypeId]: typeof PauseResponsibilityTypeId
  readonly coverage: PauseResponsibilityCoverage
  readonly taskId: TaskId
}

/** One executor responsibility whose exact planned attempt is covered by the applied Pause. */
export interface PauseExecutorResponsibility extends PauseResponsibilityBase {
  readonly _tag: "PauseExecutorResponsibility"
  readonly obligation: ExecutorWorkflowObligation
}

/** One non-executor workflow operation whose exact task is covered by the applied Pause. */
export interface PauseWorkflowOperationResponsibility extends PauseResponsibilityBase {
  readonly _tag: "PauseWorkflowOperationResponsibility"
  readonly obligation: OperationWorkflowObligation
}

/** One accepted result waiting for its exact integration responsibility. */
export interface PauseAcceptedIntegrationResponsibility extends PauseResponsibilityBase {
  readonly _tag: "PauseAcceptedIntegrationResponsibility"
  readonly obligation: AcceptedIntegrationObligation
}

/** One exact queued integration responsibility covered by the applied Pause. */
export interface PauseQueuedIntegrationResponsibility extends PauseResponsibilityBase {
  readonly _tag: "PauseQueuedIntegrationResponsibility"
  readonly obligation: QueuedIntegrationObligation
}

/** One exact started integration responsibility covered by the applied Pause. */
export interface PauseStartedIntegrationResponsibility extends PauseResponsibilityBase {
  readonly _tag: "PauseStartedIntegrationResponsibility"
  readonly obligation: StartedIntegrationObligation
}

export type PauseWorkflowResponsibility =
  | PauseExecutorResponsibility
  | PauseWorkflowOperationResponsibility
  | PauseAcceptedIntegrationResponsibility
  | PauseQueuedIntegrationResponsibility
  | PauseStartedIntegrationResponsibility

/** One admitted or proposed action that is currently crossing its ordinary protocol boundary. */
export interface PauseDeliveryActionResponsibility extends PauseResponsibilityBase {
  readonly _tag: "PauseDeliveryActionResponsibility"
  readonly proposal: DeliveryActionProposal
}

export type PauseResponsibility = PauseWorkflowResponsibility | PauseDeliveryActionResponsibility

/** The exact accepted or process-local fact preventing one covered responsibility from being safe. */
export type PauseDeliveryActionBlocker =
  | { readonly _tag: "ProposedDeliveryAction"; readonly proposal: DeliveryActionProposal }
  | { readonly _tag: "LiveDeliveryAction"; readonly owner: DeliveryRuntimeLiveOwnerSnapshot }
  | { readonly _tag: "AcceptedOutcomePublicationPending"; readonly proposal: DeliveryActionProposal }

export type PauseExecutorBlocker =
  | { readonly _tag: "ExecutorSafeSuspensionRequired"; readonly correlation: PlannedAttemptExecutorCorrelation }
  | PauseDeliveryActionBlocker

export type PauseIntegrationResourceBlocker =
  | { readonly _tag: "HeldIntegrationTarget"; readonly queuedAt: JournalPosition }
  | { readonly _tag: "ActiveIntegrationTarget"; readonly queuedAt: JournalPosition }

export type PauseStartedIntegrationBlocker =
  | { readonly _tag: "TargetPromotionResultRequired"; readonly request: TargetPromotionCorrelation }
  | PauseIntegrationResourceBlocker
  | PauseDeliveryActionBlocker

export type PauseSafeBoundaryBlocker =
  | PauseExecutorBlocker
  | PauseIntegrationResourceBlocker
  | PauseStartedIntegrationBlocker

/** One covered responsibility already stopped at its existing protocol's safe boundary. */
export interface PauseResponsibilityAtBoundary {
  readonly _tag: "PauseResponsibilityAtBoundary"
  readonly responsibility: PauseWorkflowResponsibility
}

/** One covered responsibility and the exact ordinary boundary facts that still prevent confirmation. */
export type PauseResponsibilityPreventingBoundary =
  | {
      readonly _tag: "PauseResponsibilityPreventingBoundary"
      readonly blockers: readonly [PauseExecutorBlocker, ...ReadonlyArray<PauseExecutorBlocker>]
      readonly responsibility: PauseExecutorResponsibility
    }
  | {
      readonly _tag: "PauseResponsibilityPreventingBoundary"
      readonly blockers: readonly [PauseDeliveryActionBlocker, ...ReadonlyArray<PauseDeliveryActionBlocker>]
      readonly responsibility: PauseWorkflowOperationResponsibility | PauseDeliveryActionResponsibility
    }
  | {
      readonly _tag: "PauseResponsibilityPreventingBoundary"
      readonly blockers: readonly [
        PauseIntegrationResourceBlocker | PauseDeliveryActionBlocker,
        ...ReadonlyArray<PauseIntegrationResourceBlocker | PauseDeliveryActionBlocker>
      ]
      readonly responsibility: PauseQueuedIntegrationResponsibility
    }
  | {
      readonly _tag: "PauseResponsibilityPreventingBoundary"
      readonly blockers: readonly [PauseStartedIntegrationBlocker, ...ReadonlyArray<PauseStartedIntegrationBlocker>]
      readonly responsibility: PauseStartedIntegrationResponsibility
    }

/** Widens a correlated blocker tuple only for generic presentation and traversal. */
export const pauseSafeBoundaryBlockersOf = (
  boundary: PauseResponsibilityPreventingBoundary
): ReadonlyArray<PauseSafeBoundaryBlocker> => boundary.blockers

/** A passive current view of one applied Pause; it is never journaled workflow state. */
export type PauseProgressView =
  | {
      readonly _tag: "PauseWaiting"
      readonly atBoundary: ReadonlyArray<PauseResponsibilityAtBoundary>
      readonly preventing: readonly [
        PauseResponsibilityPreventingBoundary,
        ...ReadonlyArray<PauseResponsibilityPreventingBoundary>
      ]
      readonly subject: ControlDirectionSubjectType
    }
  | {
      readonly _tag: "PauseConfirmed"
      readonly atBoundary: ReadonlyArray<PauseResponsibilityAtBoundary>
      readonly subject: ControlDirectionSubjectType
    }
  | { readonly _tag: "PauseNoLongerApplied"; readonly subject: ControlDirectionSubjectType }

type ReadyRuntimeObservation = Extract<DeliveryRuntimeObservationState, { readonly _tag: "Ready" }>

const appliedPauseCoversSubject = (subject: ControlDirectionSubjectType, coverage: PauseCoverageFacts): boolean =>
  Match.valueTags(subject, {
    Run: () => coverage.applied.run._tag === "RunPaused",
    Task: ({ taskId }) =>
      coverage.applied.tasks._tag === "TaskPauses" && coverage.applied.tasks.taskIds.includes(taskId)
  })

const coveredTaskCoverage = (
  subject: ControlDirectionSubjectType,
  coverage: PauseCoverageFacts,
  deliveries: ReadonlyArray<TicketDelivery>,
  actionTaskIds: ReadonlyArray<TaskId>
): ReadonlyMap<TaskId, PauseResponsibilityCoverage> =>
  Match.valueTags(subject, {
    Run: () =>
      new Map<TaskId, PauseResponsibilityCoverage>(
        [
          ...new Set([
            ...deliveries.flatMap(({ obligations, taskId }) => [taskId, ...obligations.map(obligationTaskId)]),
            ...actionTaskIds
          ])
        ].map((taskId) => [taskId, { _tag: "RunPauseCoverage" } satisfies PauseResponsibilityCoverage])
      ),
    Task: ({ taskId }) => {
      const covered = new Map<TaskId, PauseResponsibilityCoverage>([[taskId, { _tag: "ExactTaskPauseCoverage" }]])
      if (coverage._tag === "PauseCoverageGraphEstablished") {
        for (const descendantTaskId of coverage.snapshot.groupingSubtreeOf(taskId)) {
          if (descendantTaskId === taskId) continue
          covered.set(descendantTaskId, {
            _tag: "GroupingDescendantPauseCoverage",
            groupingObservedAt: coverage.observedAt,
            pausedTaskId: taskId
          })
        }
      }
      return covered
    }
  })

const proposalTaskId = (proposal: DeliveryActionProposal): TaskId | null => deliveryProposalOrderTaskId(proposal.order)

const workflowResponsibilityTaskId = (responsibility: WorkflowResponsibilityEntry): TaskId =>
  Match.valueTags(responsibility, {
    PlannedAttemptExecutorWorkResponsibility: ({ plannedAttempt }) => plannedAttempt.taskId,
    TaskClaimReleaseResponsibility: ({ taskId }) => taskId,
    TaskClaimResponsibility: ({ taskId }) => taskId,
    TaskWorktreeResponsibility: ({ taskId }) => taskId
  })

const obligationTaskId = (obligation: ExactWorkflowObligation): TaskId =>
  Match.valueTags(obligation, {
    AcceptedAwaitingIntegration: ({ accepted }) => accepted.plannedAttempt.taskId,
    QueuedIntegration: ({ responsibility }) => responsibility.plannedAttempt.taskId,
    StartedIntegration: ({ responsibility }) => responsibility.plannedAttempt.taskId,
    WorkflowResponsibility: ({ responsibility }) => workflowResponsibilityTaskId(responsibility)
  })

const integrationQueuedAt = (obligation: ExactWorkflowObligation): JournalPosition | null =>
  Match.valueTags(obligation, {
    AcceptedAwaitingIntegration: () => null,
    QueuedIntegration: ({ responsibility }) => responsibility.queuedAt,
    StartedIntegration: ({ responsibility }) => responsibility.queuedAt,
    WorkflowResponsibility: () => null
  })

const executorProposalMatchesObligation = (
  proposal: DeliveryActionProposal,
  obligation: ExactWorkflowObligation
): boolean => {
  if (obligation._tag !== "WorkflowResponsibility") return false
  if (obligation.responsibility._tag !== "PlannedAttemptExecutorWorkResponsibility") return false
  if (proposal.admission.plannedAttemptProtocol._tag !== "PlannedAttemptProtocolRequired") return false
  return (
    plannedAttemptExecutorCorrelationKey(proposal.admission.plannedAttemptProtocol.correlation) ===
    plannedAttemptExecutorCorrelationKey(plannedAttemptExecutorCorrelation(obligation.responsibility.plannedAttempt))
  )
}

const integrationProposalMatchesObligation = (
  proposal: DeliveryActionProposal,
  obligation: ExactWorkflowObligation
): boolean => {
  const queuedAt = integrationQueuedAt(obligation)
  if (queuedAt === null) return false
  if (proposal.admission.integrationTarget._tag !== "IntegrationTargetResourceRequired") return false
  return proposal.admission.integrationTarget.queuedAt === queuedAt
}

const workflowOperationProposalMatchesObligation = (
  proposal: DeliveryActionProposal,
  obligation: ExactWorkflowObligation
): boolean => {
  if (obligation._tag !== "WorkflowResponsibility") return false
  if (obligation.responsibility._tag === "PlannedAttemptExecutorWorkResponsibility") return false
  if (proposal.route._tag !== "AcceptedWorkflowRoute") return false
  return (
    acceptedWorkflowTransitionOperationId(proposal.route.transition) ===
    workflowResponsibilityOperationId(obligation.responsibility)
  )
}

const proposalMatchesObligation = (proposal: DeliveryActionProposal, obligation: ExactWorkflowObligation): boolean =>
  executorProposalMatchesObligation(proposal, obligation) ||
  integrationProposalMatchesObligation(proposal, obligation) ||
  workflowOperationProposalMatchesObligation(proposal, obligation)

const executorBoundaryBlocker = (
  delivery: TicketDelivery,
  obligation: ExecutorWorkflowObligation
): ReadonlyArray<PauseExecutorBlocker> => {
  const identity = workflowResponsibilityKey(obligation.responsibility)
  const safe = delivery.evidence.some(
    (evidence) =>
      evidence._tag === "ResponsibilityFacts" &&
      workflowResponsibilityKey(evidence.facts.responsibility) === identity &&
      (evidence.facts.disposition._tag === "PlannedAttemptExecutorWorkSafelySuspended" ||
        evidence.facts.disposition._tag === "PlannedAttemptExecutorWorkTerminal")
  )
  if (safe) return []
  return [
    {
      _tag: "ExecutorSafeSuspensionRequired",
      correlation: plannedAttemptExecutorCorrelation(obligation.responsibility.plannedAttempt)
    }
  ]
}

const resourceBlockers = (
  obligation: QueuedIntegrationObligation | StartedIntegrationObligation,
  resources: IntegrationTargetResourceSnapshot
): ReadonlyArray<PauseIntegrationResourceBlocker> => {
  const queuedAt = obligation.responsibility.queuedAt
  return [
    ...(resources.heldResponsibilityPositions.has(queuedAt)
      ? [{ _tag: "HeldIntegrationTarget" as const, queuedAt }]
      : []),
    ...(resources.activeResponsibilityPositions.has(queuedAt)
      ? [{ _tag: "ActiveIntegrationTarget" as const, queuedAt }]
      : [])
  ]
}

const sameStartedIntegrationResponsibility = (
  left: StartedIntegrationResponsibility,
  right: StartedIntegrationResponsibility
): boolean =>
  left.queuedAt === right.queuedAt &&
  left.startedAt === right.startedAt &&
  integrationResponsibilityEquivalence(left, right)

const targetPromotionBlockers = (
  delivery: TicketDelivery,
  obligation: StartedIntegrationObligation
): ReadonlyArray<PauseStartedIntegrationBlocker> =>
  delivery.evidence.flatMap((evidence) =>
    evidence._tag === "TargetPromotion" &&
    evidence.state._tag === "PromotionPending" &&
    sameStartedIntegrationResponsibility(evidence.responsibility, obligation.responsibility)
      ? [{ _tag: "TargetPromotionResultRequired", request: evidence.state.correlation }]
      : []
  )

const actionBlocker = (
  proposal: DeliveryActionProposal,
  liveOwners: ReadonlyArray<DeliveryRuntimeLiveOwnerSnapshot>
): PauseDeliveryActionBlocker => {
  const owner = liveOwners.find(({ proposal: candidate }) => candidate.id === proposal.id)
  if (owner === undefined) return { _tag: "ProposedDeliveryAction", proposal }
  return Match.valueTags(owner, {
    AdmittedDeliveryAction: () => ({ _tag: "LiveDeliveryAction", owner }) satisfies PauseDeliveryActionBlocker,
    MaterializedDeliveryAction: () => ({ _tag: "LiveDeliveryAction", owner }) satisfies PauseDeliveryActionBlocker,
    SettledBeforeMaterialization: () =>
      ({ _tag: "AcceptedOutcomePublicationPending", proposal }) satisfies PauseDeliveryActionBlocker,
    SettledMaterializedDeliveryAction: () =>
      ({ _tag: "AcceptedOutcomePublicationPending", proposal }) satisfies PauseDeliveryActionBlocker
  })
}

type PauseProjection =
  | { readonly _tag: "PauseProjectionNotApplied" }
  | PauseProgressProjectionConflict
  | PauseProgressView

interface CoveredPauseActions {
  readonly actions: ReadonlyMap<DeliveryProposalId, CoveredPauseAction>
  readonly coverageByTask: ReadonlyMap<TaskId, PauseResponsibilityCoverage>
  readonly liveOwners: ReadonlyArray<DeliveryRuntimeLiveOwnerSnapshot>
}

interface CoveredPauseAction {
  readonly coverage: PauseResponsibilityCoverage
  readonly proposal: DeliveryActionProposal
  readonly taskId: TaskId
}

const coveredPauseActions = (
  subject: ControlDirectionSubjectType,
  runtime: ReadyRuntimeObservation
): CoveredPauseActions => {
  const { evaluation, liveOwners } = runtime
  const proposals = Match.valueTags(evaluation.proposedActions, {
    DeliveryProposalOwnershipConflict: () => [],
    DeliveryProposalsAvailable: ({ proposals }) => proposals
  })
  const everyActionProposal = [...proposals, ...liveOwners.map(({ proposal }) => proposal)]
  const actionTaskIds = everyActionProposal.flatMap((proposal) => {
    const taskId = proposalTaskId(proposal)
    return taskId === null ? [] : [taskId]
  })
  const coverageByTask = coveredTaskCoverage(
    subject,
    evaluation.pauseCoverage,
    evaluation.current.ticketDeliveries.deliveries,
    actionTaskIds
  )
  const coveredActionOf = (proposal: DeliveryActionProposal): CoveredPauseAction | null => {
    const taskId = proposalTaskId(proposal)
    if (taskId === null) return null
    const coverage = coverageByTask.get(taskId)
    return coverage === undefined ? null : { coverage, proposal, taskId }
  }
  const coveredLiveOwners = liveOwners.filter(({ proposal }) => coveredActionOf(proposal) !== null)
  const actions = new Map<DeliveryProposalId, CoveredPauseAction>()
  for (const proposal of proposals) {
    const action = coveredActionOf(proposal)
    if (action !== null) actions.set(proposal.id, action)
  }
  for (const owner of coveredLiveOwners) {
    const action = coveredActionOf(owner.proposal)
    if (action !== null) actions.set(owner.proposal.id, action)
  }
  return { actions, coverageByTask, liveOwners: coveredLiveOwners }
}

interface ObligationPauseProgress {
  readonly actionIds: ReadonlyArray<DeliveryProposalId>
  readonly progress: PauseResponsibilityAtBoundary | PauseResponsibilityPreventingBoundary
}

const matchingActionFacts = (
  obligation: ExactWorkflowObligation,
  actions: ReadonlyMap<DeliveryProposalId, CoveredPauseAction>,
  liveOwners: ReadonlyArray<DeliveryRuntimeLiveOwnerSnapshot>
) => {
  const proposals = [...actions.values()]
    .map(({ proposal }) => proposal)
    .filter((proposal) => proposalMatchesObligation(proposal, obligation))
  return {
    actionIds: proposals.map(({ id }) => id),
    blockers: proposals.map((proposal) => actionBlocker(proposal, liveOwners))
  }
}

const actionOnlyProgress = (
  responsibility: PauseWorkflowOperationResponsibility,
  actionIds: ReadonlyArray<DeliveryProposalId>,
  blockers: ReadonlyArray<PauseDeliveryActionBlocker>
): ObligationPauseProgress => {
  const firstBlocker = blockers[0]
  return {
    actionIds,
    progress:
      firstBlocker === undefined
        ? { _tag: "PauseResponsibilityAtBoundary", responsibility }
        : {
            _tag: "PauseResponsibilityPreventingBoundary",
            blockers: [firstBlocker, ...blockers.slice(1)],
            responsibility
          }
  }
}

const executorProgress = (
  delivery: TicketDelivery,
  responsibility: PauseExecutorResponsibility,
  actionIds: ReadonlyArray<DeliveryProposalId>,
  actionBlockers: ReadonlyArray<PauseDeliveryActionBlocker>
): ObligationPauseProgress => {
  const blockers: ReadonlyArray<PauseExecutorBlocker> = [
    ...executorBoundaryBlocker(delivery, responsibility.obligation),
    ...actionBlockers
  ]
  const firstBlocker = blockers[0]
  return {
    actionIds,
    progress:
      firstBlocker === undefined
        ? { _tag: "PauseResponsibilityAtBoundary", responsibility }
        : {
            _tag: "PauseResponsibilityPreventingBoundary",
            blockers: [firstBlocker, ...blockers.slice(1)],
            responsibility
          }
  }
}

const queuedIntegrationProgress = (
  responsibility: PauseQueuedIntegrationResponsibility,
  actionIds: ReadonlyArray<DeliveryProposalId>,
  actionBlockers: ReadonlyArray<PauseDeliveryActionBlocker>,
  resources: IntegrationTargetResourceSnapshot
): ObligationPauseProgress => {
  const blockers: ReadonlyArray<PauseIntegrationResourceBlocker | PauseDeliveryActionBlocker> = [
    ...resourceBlockers(responsibility.obligation, resources),
    ...actionBlockers
  ]
  const firstBlocker = blockers[0]
  return {
    actionIds,
    progress:
      firstBlocker === undefined
        ? { _tag: "PauseResponsibilityAtBoundary", responsibility }
        : {
            _tag: "PauseResponsibilityPreventingBoundary",
            blockers: [firstBlocker, ...blockers.slice(1)],
            responsibility
          }
  }
}

const startedIntegrationProgress = (
  delivery: TicketDelivery,
  responsibility: PauseStartedIntegrationResponsibility,
  actionIds: ReadonlyArray<DeliveryProposalId>,
  actionBlockers: ReadonlyArray<PauseDeliveryActionBlocker>,
  resources: IntegrationTargetResourceSnapshot
): ObligationPauseProgress => {
  const blockers: ReadonlyArray<PauseStartedIntegrationBlocker> = [
    ...targetPromotionBlockers(delivery, responsibility.obligation),
    ...resourceBlockers(responsibility.obligation, resources),
    ...actionBlockers
  ]
  const firstBlocker = blockers[0]
  return {
    actionIds,
    progress:
      firstBlocker === undefined
        ? { _tag: "PauseResponsibilityAtBoundary", responsibility }
        : {
            _tag: "PauseResponsibilityPreventingBoundary",
            blockers: [firstBlocker, ...blockers.slice(1)],
            responsibility
          }
  }
}

const obligationPauseProgress = (
  delivery: TicketDelivery,
  obligation: ExactWorkflowObligation,
  coverage: PauseResponsibilityCoverage,
  actions: ReadonlyMap<DeliveryProposalId, CoveredPauseAction>,
  liveOwners: ReadonlyArray<DeliveryRuntimeLiveOwnerSnapshot>,
  resources: IntegrationTargetResourceSnapshot
): ObligationPauseProgress => {
  const { actionIds, blockers } = matchingActionFacts(obligation, actions, liveOwners)
  const taskId = obligationTaskId(obligation)
  return Match.valueTags(obligation, {
    AcceptedAwaitingIntegration: (acceptedObligation) =>
      ({
        actionIds: [],
        progress: {
          _tag: "PauseResponsibilityAtBoundary",
          responsibility: {
            _tag: "PauseAcceptedIntegrationResponsibility",
            [PauseResponsibilityTypeId]: PauseResponsibilityTypeId,
            coverage,
            obligation: acceptedObligation,
            taskId
          }
        }
      }) satisfies ObligationPauseProgress,
    QueuedIntegration: (queuedObligation) =>
      queuedIntegrationProgress(
        {
          _tag: "PauseQueuedIntegrationResponsibility",
          [PauseResponsibilityTypeId]: PauseResponsibilityTypeId,
          coverage,
          obligation: queuedObligation,
          taskId
        },
        actionIds,
        blockers,
        resources
      ),
    StartedIntegration: (startedObligation) =>
      startedIntegrationProgress(
        delivery,
        {
          _tag: "PauseStartedIntegrationResponsibility",
          [PauseResponsibilityTypeId]: PauseResponsibilityTypeId,
          coverage,
          obligation: startedObligation,
          taskId
        },
        actionIds,
        blockers,
        resources
      ),
    WorkflowResponsibility: (workflowObligation) =>
      Match.valueTags(workflowObligation.responsibility, {
        PlannedAttemptExecutorWorkResponsibility: (responsibility) =>
          executorProgress(
            delivery,
            {
              _tag: "PauseExecutorResponsibility",
              [PauseResponsibilityTypeId]: PauseResponsibilityTypeId,
              coverage,
              obligation: { ...workflowObligation, responsibility },
              taskId
            },
            actionIds,
            blockers
          ),
        TaskClaimReleaseResponsibility: (responsibility) =>
          actionOnlyProgress(
            {
              _tag: "PauseWorkflowOperationResponsibility",
              [PauseResponsibilityTypeId]: PauseResponsibilityTypeId,
              coverage,
              obligation: { ...workflowObligation, responsibility },
              taskId
            },
            actionIds,
            blockers
          ),
        TaskClaimResponsibility: (responsibility) =>
          actionOnlyProgress(
            {
              _tag: "PauseWorkflowOperationResponsibility",
              [PauseResponsibilityTypeId]: PauseResponsibilityTypeId,
              coverage,
              obligation: { ...workflowObligation, responsibility },
              taskId
            },
            actionIds,
            blockers
          ),
        TaskWorktreeResponsibility: (responsibility) =>
          actionOnlyProgress(
            {
              _tag: "PauseWorkflowOperationResponsibility",
              [PauseResponsibilityTypeId]: PauseResponsibilityTypeId,
              coverage,
              obligation: { ...workflowObligation, responsibility },
              taskId
            },
            actionIds,
            blockers
          )
      })
  })
}

const unmatchedActionProgress = (
  actions: ReadonlyMap<DeliveryProposalId, CoveredPauseAction>,
  matchedActionIds: ReadonlySet<DeliveryProposalId>,
  liveOwners: ReadonlyArray<DeliveryRuntimeLiveOwnerSnapshot>
): ReadonlyArray<PauseResponsibilityPreventingBoundary> =>
  [...actions.values()].flatMap(({ coverage, proposal, taskId }) => {
    if (matchedActionIds.has(proposal.id)) return []
    return [
      {
        _tag: "PauseResponsibilityPreventingBoundary",
        blockers: [actionBlocker(proposal, liveOwners)],
        responsibility: {
          _tag: "PauseDeliveryActionResponsibility",
          [PauseResponsibilityTypeId]: PauseResponsibilityTypeId,
          coverage,
          proposal,
          taskId
        }
      }
    ]
  })

/** Purely derives Alice's current Pause progress from one coherent runtime and resource snapshot. */
export const pauseProgressViewOf = (
  subject: ControlDirectionSubjectType,
  runtime: ReadyRuntimeObservation,
  resources: IntegrationTargetResourceSnapshot
): PauseProjection => {
  const { evaluation } = runtime
  if (!appliedPauseCoversSubject(subject, evaluation.pauseCoverage)) return { _tag: "PauseProjectionNotApplied" }
  if (evaluation.proposedActions._tag === "DeliveryProposalOwnershipConflict") {
    const conflictCoverage = coveredTaskCoverage(
      subject,
      evaluation.pauseCoverage,
      evaluation.current.ticketDeliveries.deliveries,
      evaluation.proposedActions.conflicts.flatMap(({ order }) => {
        const taskId = deliveryProposalOrderTaskId(order)
        return taskId === null ? [] : [taskId]
      })
    )
    const proposalIds = evaluation.proposedActions.conflicts.flatMap(({ id, order }) => {
      const taskId = deliveryProposalOrderTaskId(order)
      return taskId !== null && conflictCoverage.has(taskId) ? [id] : []
    })
    const [firstProposalId, ...remainingProposalIds] = proposalIds
    if (firstProposalId !== undefined) {
      return new PauseProgressProjectionConflict({ proposalIds: [firstProposalId, ...remainingProposalIds], subject })
    }
  }

  const deliveries = evaluation.current.ticketDeliveries.deliveries
  const coveredActions = coveredPauseActions(subject, runtime)
  const obligationProgress = deliveries.flatMap((delivery) =>
    delivery.obligations.flatMap((obligation) =>
      Match.value(coveredActions.coverageByTask.get(obligationTaskId(obligation))).pipe(
        Match.when(undefined, () => []),
        Match.orElse((coverage) => [
          obligationPauseProgress(
            delivery,
            obligation,
            coverage,
            coveredActions.actions,
            coveredActions.liveOwners,
            resources
          )
        ])
      )
    )
  )
  const atBoundary = obligationProgress.flatMap(({ progress }) =>
    progress._tag === "PauseResponsibilityAtBoundary" ? [progress] : []
  )
  const preventing = obligationProgress.flatMap(({ progress }) =>
    progress._tag === "PauseResponsibilityPreventingBoundary" ? [progress] : []
  )
  const matchedActionIds = new Set(obligationProgress.flatMap(({ actionIds }) => actionIds))
  preventing.push(...unmatchedActionProgress(coveredActions.actions, matchedActionIds, coveredActions.liveOwners))

  const firstPreventing = preventing[0]
  return firstPreventing === undefined
    ? { _tag: "PauseConfirmed", atBoundary, subject }
    : { _tag: "PauseWaiting", atBoundary, preventing: [firstPreventing, ...preventing.slice(1)], subject }
}
