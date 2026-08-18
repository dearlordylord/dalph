import { Option } from "effect"
import { plannedAttemptExecutorCorrelation, type AttemptId, type TaskId } from "@dalph/contracts"
import type { ReconstructedRunState } from "../reconstruction/state.js"
import { latestReconstructedTaskGraph } from "../reconstruction/graph-knowledge.js"
import type { StartedIntegrationResponsibility } from "../../workflow/protocols/integration-admission/protocol.js"
import { deriveTargetPromotionStateFor } from "../../workflow/protocols/target-promotion/protocol.js"
import {
  integrationFinalityExplanationFor,
  integrationFinalityTransitionsFor
} from "./integration-finality-frontier.js"
import {
  FrontierExplanation,
  RunnableFrontierTransition,
  type RunnableFrontierTransition as RunnableFrontierTransitionType
} from "./frontier.js"
import type { IntegrationFrontierRuntimeFacts } from "./integration-frontier.js"
import {
  deriveCurrentIntegratorState,
  integratorRunQualifiedCandidateFromState,
  type CurrentIntegratorState
} from "../../workflow/protocols/integrator/state.js"
import type { TargetLineageObservation } from "../../authorities/git/target-lineage.js"
import type { JournalPosition } from "../../workflow-journal/identity.js"

type ClaimSubject = { readonly plannedAttempt: { readonly attemptId: AttemptId; readonly taskId: TaskId } }
type PromotionState = ReturnType<typeof deriveTargetPromotionStateFor>
type SucceededPromotion = Extract<PromotionState, { readonly _tag: "PromotionSucceeded" }>

interface StartedResponsibilityAnalysis {
  readonly trackerFactsAreCurrentFor: (responsibility: {
    readonly plannedAttempt: { readonly taskId: TaskId }
  }) => boolean
  readonly claimIsExactFor: (responsibility: ClaimSubject) => boolean
  readonly claimConstraintFor: (
    responsibility: ClaimSubject
  ) => Exclude<ReturnType<typeof claimAuthorityFor>, { readonly _tag: "Exact" }> | undefined
  readonly succeededPromotionFor: (
    responsibility: StartedIntegrationResponsibility
  ) => Extract<ReturnType<typeof deriveTargetPromotionStateFor>, { readonly _tag: "PromotionSucceeded" }> | undefined
  readonly explanationForStarted: (responsibility: StartedIntegrationResponsibility) => FrontierExplanation
  readonly transitions: () => ReadonlyArray<RunnableFrontierTransitionType>
}

const claimAuthorityFor = (runtimeFacts: IntegrationFrontierRuntimeFacts, responsibility: ClaimSubject) =>
  runtimeFacts.taskClaimAuthorityByAttemptId.get(responsibility.plannedAttempt.attemptId) ?? {
    _tag: "Unobserved" as const
  }

const unsatisfiedPrerequisites = (
  runState: ReconstructedRunState,
  responsibility: StartedIntegrationResponsibility
): ReadonlyArray<TaskId> => {
  const graph = latestReconstructedTaskGraph(runState.graphKnowledge)
  if (Option.isNone(graph)) return []
  return graph.value
    .prerequisitesOf(responsibility.plannedAttempt.taskId)
    .filter((taskId) => Option.getOrUndefined(graph.value.lifecycleOf(taskId))?._tag !== "CompletedSuccessfully")
}

interface DurableTargetLineage {
  readonly observation: TargetLineageObservation
  readonly observedAt: JournalPosition
}

const targetLineageEqual = (left: TargetLineageObservation, right: TargetLineageObservation): boolean =>
  left.plannedBaseIsAncestorOfTargetHead === right.plannedBaseIsAncestorOfTargetHead &&
  left.plannedBaseSha === right.plannedBaseSha &&
  left.targetHeadSha === right.targetHeadSha

const durableTargetLineageFor = (
  runState: ReconstructedRunState,
  runtimeFacts: IntegrationFrontierRuntimeFacts,
  responsibility: StartedIntegrationResponsibility
): DurableTargetLineage | undefined => {
  const current = runtimeFacts.targetLineageByAttemptId?.get(responsibility.plannedAttempt.attemptId)
  if (current === undefined) return undefined
  const record = runState.workflowHistory.records.findLast(
    ({ event }) =>
      event._tag === "TargetLineageObserved" &&
      event.plannedAttempt.attemptId === responsibility.plannedAttempt.attemptId &&
      event.plannedAttempt.runId === responsibility.plannedAttempt.runId &&
      targetLineageEqual(event.observation, current)
  )
  return record?.event._tag === "TargetLineageObserved"
    ? { observation: record.event.observation, observedAt: record.position }
    : undefined
}

const fixedTargetLineageFor = (
  state: Exclude<CurrentIntegratorState, { readonly _tag: "Absent" | "Contradiction" }>
): DurableTargetLineage => ({
  observation: {
    plannedBaseIsAncestorOfTargetHead: true,
    plannedBaseSha: state.run.session.plannedAttempt.baseSha,
    targetHeadSha: state.run.session.expectedTargetHead
  },
  observedAt: state.run.session.targetLineageObservedAt
})

const targetLineageIsIncompatible = (
  lineage: TargetLineageObservation,
  responsibility: StartedIntegrationResponsibility
): boolean =>
  lineage.plannedBaseSha !== responsibility.plannedAttempt.baseSha || !lineage.plannedBaseIsAncestorOfTargetHead

const fixedIntegratorSessionLineageChanged = (
  state: CurrentIntegratorState,
  lineage: TargetLineageObservation,
  responsibility: StartedIntegrationResponsibility
): boolean =>
  state._tag !== "Absent" &&
  state._tag !== "Contradiction" &&
  (lineage.targetHeadSha !== state.run.session.expectedTargetHead ||
    targetLineageIsIncompatible(lineage, responsibility))

const releaseStartedIntegrationTargetFor = (
  responsibility: StartedIntegrationResponsibility,
  held: boolean
): ReadonlyArray<RunnableFrontierTransitionType> =>
  held ? [RunnableFrontierTransition.ReleaseStartedIntegrationTarget({ responsibility })] : []

const explanationAfterPrerequisitesFor = (
  runState: ReconstructedRunState,
  runtimeFacts: IntegrationFrontierRuntimeFacts,
  responsibility: StartedIntegrationResponsibility,
  integratorState: CurrentIntegratorState,
  promotion: PromotionState
): FrontierExplanation => {
  if (promotion?._tag === "PromotionSucceeded") {
    return integrationFinalityExplanationFor(runState.workflowHistory.records, responsibility, promotion, runtimeFacts)
  }
  if (integratorState._tag === "GitQualifiedPrepared" && runtimeFacts.targetPromotionConfigured !== true) {
    return FrontierExplanation.TargetPromotionConfigurationWait({
      plannedAttempt: responsibility.plannedAttempt,
      wakeCondition: "TargetPromotionRuntimeConfigured"
    })
  }
  const lineage = runtimeFacts.targetLineageByAttemptId?.get(responsibility.plannedAttempt.attemptId)
  if (lineage === undefined)
    return FrontierExplanation.IntegrationInProgress({ plannedAttempt: responsibility.plannedAttempt })
  if (targetLineageIsIncompatible(lineage, responsibility)) {
    return FrontierExplanation.PlannedAttemptGitConstraint({
      correlation: plannedAttemptExecutorCorrelation(responsibility.plannedAttempt),
      gitState: "TargetRewrite",
      taskId: responsibility.plannedAttempt.taskId,
      wakeCondition: "GitFactsObserved"
    })
  }
  return FrontierExplanation.IntegrationInProgress({ plannedAttempt: responsibility.plannedAttempt })
}

const promotionSucceededTransitionsFor = (
  runState: ReconstructedRunState,
  runtimeFacts: IntegrationFrontierRuntimeFacts,
  responsibility: StartedIntegrationResponsibility,
  promotion: SucceededPromotion,
  held: boolean,
  waiting: boolean,
  trackerFactsAreCurrent: boolean
): ReadonlyArray<RunnableFrontierTransitionType> => {
  /* v8 ignore next -- @preserve The promotion action releases its exact target in ensuring; this defends same-process retained ownership. */
  if (held) return [RunnableFrontierTransition.ReleaseStartedIntegrationTarget({ responsibility })]
  if (!trackerFactsAreCurrent || waiting) return []
  return integrationFinalityTransitionsFor(runState.workflowHistory.records, responsibility, promotion, runtimeFacts)
}

const integratorStateBlocksProgress = (state: CurrentIntegratorState, promotion: PromotionState): boolean => {
  if (state._tag === "Contradiction" || state._tag === "NotPrepared" || state._tag === "CandidateRejected") return true
  return promotion?._tag === "PromotionStale" || promotion?._tag === "PromotionNonConvergent"
}

const targetPromotionConfigurationIsMissing = (
  state: CurrentIntegratorState,
  runtimeFacts: IntegrationFrontierRuntimeFacts
): boolean => state._tag === "GitQualifiedPrepared" && runtimeFacts.targetPromotionConfigured !== true

const fixedLineageRequiresRelease = (
  runtimeFacts: IntegrationFrontierRuntimeFacts,
  responsibility: StartedIntegrationResponsibility,
  state: CurrentIntegratorState
): boolean => {
  if (state._tag !== "GitQualifiedPrepared") return false
  const lineage = runtimeFacts.targetLineageByAttemptId?.get(responsibility.plannedAttempt.attemptId)
  return lineage !== undefined && fixedIntegratorSessionLineageChanged(state, lineage, responsibility)
}

const settledIntegrationMustReleaseTarget = (
  waiting: boolean,
  runtimeFacts: IntegrationFrontierRuntimeFacts,
  responsibility: StartedIntegrationResponsibility,
  integratorState: CurrentIntegratorState,
  promotion: PromotionState
): boolean =>
  waiting ||
  integratorStateBlocksProgress(integratorState, promotion) ||
  targetPromotionConfigurationIsMissing(integratorState, runtimeFacts) ||
  fixedLineageRequiresRelease(runtimeFacts, responsibility, integratorState)

const transitionsBeforeStartedIntegrationAdmission = (
  runState: ReconstructedRunState,
  runtimeFacts: IntegrationFrontierRuntimeFacts,
  responsibility: StartedIntegrationResponsibility,
  waiting: boolean,
  held: boolean,
  integratorState: CurrentIntegratorState,
  promotion: PromotionState,
  trackerFactsAreCurrentFor: (responsibility: { readonly plannedAttempt: { readonly taskId: TaskId } }) => boolean,
  claimIsExactFor: (responsibility: ClaimSubject) => boolean
): ReadonlyArray<RunnableFrontierTransitionType> | undefined => {
  if (promotion?._tag === "PromotionSucceeded") {
    return promotionSucceededTransitionsFor(
      runState,
      runtimeFacts,
      responsibility,
      promotion,
      held,
      waiting,
      trackerFactsAreCurrentFor(responsibility)
    )
  }
  if (!trackerFactsAreCurrentFor(responsibility)) return releaseStartedIntegrationTargetFor(responsibility, held)
  if (!claimIsExactFor(responsibility)) return []
  if (settledIntegrationMustReleaseTarget(waiting, runtimeFacts, responsibility, integratorState, promotion)) {
    return releaseStartedIntegrationTargetFor(responsibility, held)
  }
  return undefined
}

const absentIntegratorProgressTransitionsFor = (
  runState: ReconstructedRunState,
  runtimeFacts: IntegrationFrontierRuntimeFacts,
  responsibility: StartedIntegrationResponsibility,
  held: boolean
): ReadonlyArray<RunnableFrontierTransitionType> => {
  if (runtimeFacts.targetLineageRefreshRequiredAttemptIds?.has(responsibility.plannedAttempt.attemptId) === true) {
    return []
  }
  const lineage = durableTargetLineageFor(runState, runtimeFacts, responsibility)
  if (lineage === undefined) return []
  if (targetLineageIsIncompatible(lineage.observation, responsibility)) {
    return releaseStartedIntegrationTargetFor(responsibility, held)
  }
  return [
    RunnableFrontierTransition.RunIntegrator({
      lineage: lineage.observation,
      lineageObservedAt: lineage.observedAt,
      responsibility
    })
  ]
}

const qualifiedIntegratorProgressTransitionsFor = (
  runtimeFacts: IntegrationFrontierRuntimeFacts,
  responsibility: StartedIntegrationResponsibility,
  state: Extract<CurrentIntegratorState, { readonly _tag: "GitQualifiedPrepared" }>
): ReadonlyArray<RunnableFrontierTransitionType> =>
  runtimeFacts.targetLineageRefreshRequiredAttemptIds?.has(responsibility.plannedAttempt.attemptId) === true
    ? []
    : [
        RunnableFrontierTransition.RunTargetPromotion({
          candidate: integratorRunQualifiedCandidateFromState(state),
          responsibility
        })
      ]

const startedIntegrationProgressTransitionFor = (
  runState: ReconstructedRunState,
  runtimeFacts: IntegrationFrontierRuntimeFacts,
  responsibility: StartedIntegrationResponsibility,
  integratorState: CurrentIntegratorState,
  held: boolean
): ReadonlyArray<RunnableFrontierTransitionType> => {
  // A fixed Integrator session or qualified candidate may outlive a released
  // process-local target position. The unfinished outer boundary reuses S's
  // durable H; only later promotion requires current target authority.
  if (!held) return [RunnableFrontierTransition.AcquireStartedIntegrationTarget({ responsibility })]
  if (integratorState._tag === "GitQualifiedPrepared") {
    return qualifiedIntegratorProgressTransitionsFor(runtimeFacts, responsibility, integratorState)
  }
  if (integratorState._tag === "Absent") {
    return absentIntegratorProgressTransitionsFor(runState, runtimeFacts, responsibility, held)
  }
  if (integratorState._tag === "Contradiction") return []
  const lineage = fixedTargetLineageFor(integratorState)
  return [
    RunnableFrontierTransition.RunIntegrator({
      lineage: lineage.observation,
      lineageObservedAt: lineage.observedAt,
      responsibility
    })
  ]
}

/** Derives current started-responsibility authority, explanations, and transitions in precedence order. */
export const deriveStartedIntegrationFrontier = (
  runState: ReconstructedRunState,
  runtimeFacts: IntegrationFrontierRuntimeFacts,
  started: ReadonlyArray<StartedIntegrationResponsibility>
): StartedResponsibilityAnalysis => {
  const trackerFactsAreCurrentFor = (responsibility: { readonly plannedAttempt: { readonly taskId: TaskId } }) =>
    runtimeFacts.currentTrackerTaskIds.has(responsibility.plannedAttempt.taskId)
  const claimIsExactFor = (responsibility: ClaimSubject) =>
    claimAuthorityFor(runtimeFacts, responsibility)._tag === "Exact"
  const claimConstraintFor = (responsibility: ClaimSubject) => {
    const authority = claimAuthorityFor(runtimeFacts, responsibility)
    return authority._tag === "Exact" ? undefined : authority
  }
  const integratorStateFor = (responsibility: StartedIntegrationResponsibility) =>
    deriveCurrentIntegratorState(runState.workflowHistory.records, responsibility)
  const promotionFor = (state: CurrentIntegratorState) =>
    state._tag === "GitQualifiedPrepared"
      ? deriveTargetPromotionStateFor(runState.workflowHistory.records, integratorRunQualifiedCandidateFromState(state))
      : undefined
  const succeededPromotionFor = (responsibility: StartedIntegrationResponsibility) => {
    const promotion = promotionFor(integratorStateFor(responsibility))
    return promotion?._tag === "PromotionSucceeded" ? promotion : undefined
  }
  const explanationForStarted = (responsibility: StartedIntegrationResponsibility) => {
    const prerequisiteTaskIds = unsatisfiedPrerequisites(runState, responsibility)
    if (prerequisiteTaskIds.length > 0) {
      return FrontierExplanation.IntegrationDependencyWait({
        plannedAttempt: responsibility.plannedAttempt,
        prerequisiteTaskIds,
        wakeCondition: "TaskTrackerFactsObserved"
      })
    }
    const integratorState = integratorStateFor(responsibility)
    return explanationAfterPrerequisitesFor(
      runState,
      runtimeFacts,
      responsibility,
      integratorState,
      promotionFor(integratorState)
    )
  }
  const transitions = started.flatMap<RunnableFrontierTransitionType>((responsibility) => {
    /* v8 ignore next -- @preserve The serialized coordinator cannot select a responsibility while its scoped Integrator effect is active. */
    if (runtimeFacts.activeResponsibilityPositions?.has(responsibility.queuedAt)) return []
    const waiting = unsatisfiedPrerequisites(runState, responsibility).length > 0
    const held = runtimeFacts.heldResponsibilityPositions.has(responsibility.queuedAt)
    const integratorState = integratorStateFor(responsibility)
    const promotion = promotionFor(integratorState)
    const earlyTransition = transitionsBeforeStartedIntegrationAdmission(
      runState,
      runtimeFacts,
      responsibility,
      waiting,
      held,
      integratorState,
      promotion,
      trackerFactsAreCurrentFor,
      claimIsExactFor
    )
    return (
      earlyTransition ??
      startedIntegrationProgressTransitionFor(runState, runtimeFacts, responsibility, integratorState, held)
    )
  })
  return {
    trackerFactsAreCurrentFor,
    claimIsExactFor,
    claimConstraintFor,
    succeededPromotionFor,
    explanationForStarted,
    transitions: () => transitions
  }
}
