import { Option } from "effect"
import { plannedAttemptExecutorCorrelation, type AttemptId, type TaskId } from "@dalph/contracts"
import type { ReconstructedRunState } from "../reconstruction/state.js"
import { latestReconstructedTaskGraph } from "../reconstruction/graph-knowledge.js"
import type { StartedIntegrationResponsibility } from "../../workflow/protocols/integration-admission/protocol.js"
import {
  deriveConstructedIntegrationCandidateOccurrence,
  deriveIntegrationCandidateConstruction
} from "../../workflow/protocols/integration-candidate-construction/protocol.js"
import type { TargetVerificationCandidate } from "../../workflow/protocols/target-verification/events.js"
import { deriveTargetVerificationState } from "../../workflow/protocols/target-verification/protocol.js"
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
import { acceptedCandidateProgressAt } from "./integration-candidate-progress.js"
import type { IntegrationFrontierRuntimeFacts } from "./integration-frontier.js"

type ClaimSubject = { readonly plannedAttempt: { readonly attemptId: AttemptId; readonly taskId: TaskId } }

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
  const candidateIntentFor = (responsibility: StartedIntegrationResponsibility) =>
    runState.workflowHistory.records.findLast(
      ({ event }) =>
        event._tag === "IntegrationCandidateConstructionIntended" && event.startedAt === responsibility.startedAt
    )?.event
  const hasPreIntentTargetRewrite = (responsibility: StartedIntegrationResponsibility) =>
    candidateIntentFor(responsibility) === undefined &&
    runtimeFacts.targetLineageByAttemptId?.get(responsibility.plannedAttempt.attemptId)
      ?.plannedBaseIsAncestorOfTargetHead === false
  const constructedCandidateFor = (
    responsibility: StartedIntegrationResponsibility
  ): TargetVerificationCandidate | undefined =>
    deriveConstructedIntegrationCandidateOccurrence(runState.workflowHistory.records, responsibility)
  const verificationTargetWasRewritten = (responsibility: StartedIntegrationResponsibility): boolean => {
    const candidate = constructedCandidateFor(responsibility)
    const lineage = runtimeFacts.targetLineageByAttemptId?.get(responsibility.plannedAttempt.attemptId)
    return (
      candidate !== undefined &&
      lineage !== undefined &&
      (lineage.plannedBaseIsAncestorOfTargetHead === false ||
        lineage.targetHeadSha !== candidate.correlation.expectedTargetHead)
    )
  }
  const targetLineageIsIncompatible = (responsibility: StartedIntegrationResponsibility): boolean => {
    const lineage = runtimeFacts.targetLineageByAttemptId?.get(responsibility.plannedAttempt.attemptId)
    return (
      lineage !== undefined &&
      (lineage.plannedBaseSha !== responsibility.plannedAttempt.baseSha || !lineage.plannedBaseIsAncestorOfTargetHead)
    )
  }
  const verificationFor = (candidate: TargetVerificationCandidate | undefined) =>
    candidate === undefined ? undefined : deriveTargetVerificationState(runState.workflowHistory.records, candidate)
  const promotionFor = (
    candidate: TargetVerificationCandidate | undefined,
    verification: ReturnType<typeof verificationFor>
  ) =>
    candidate === undefined || verification?._tag !== "VerificationPassed"
      ? undefined
      : deriveTargetPromotionStateFor(runState.workflowHistory.records, candidate, verification)
  const succeededPromotionFor = (responsibility: StartedIntegrationResponsibility) => {
    const candidate = constructedCandidateFor(responsibility)
    const verification = verificationFor(candidate)
    const promotion = promotionFor(candidate, verification)
    return promotion?._tag === "PromotionSucceeded" ? promotion : undefined
  }
  const candidateAwaitsVerificationPlan = (
    candidate: TargetVerificationCandidate | undefined,
    verification: ReturnType<typeof verificationFor>
  ): boolean =>
    candidate !== undefined &&
    verification === undefined &&
    Option.isNone(runtimeFacts.targetVerificationPlan ?? Option.none())
  const promotionRuntimeIsMissing = (verification: ReturnType<typeof verificationFor>): boolean =>
    verification?._tag === "VerificationPassed" && runtimeFacts.targetPromotionConfigured !== true
  const progressOrRewriteExplanation = (responsibility: StartedIntegrationResponsibility) =>
    hasPreIntentTargetRewrite(responsibility) || verificationTargetWasRewritten(responsibility)
      ? FrontierExplanation.PlannedAttemptGitConstraint({
          correlation: plannedAttemptExecutorCorrelation(responsibility.plannedAttempt),
          gitState: "TargetRewrite",
          taskId: responsibility.plannedAttempt.taskId,
          wakeCondition: "GitFactsObserved"
        })
      : FrontierExplanation.IntegrationInProgress({ plannedAttempt: responsibility.plannedAttempt })
  const explanationForStarted = (responsibility: StartedIntegrationResponsibility) => {
    const prerequisiteTaskIds = unsatisfiedPrerequisites(runState, responsibility)
    if (prerequisiteTaskIds.length > 0) {
      return FrontierExplanation.IntegrationDependencyWait({
        plannedAttempt: responsibility.plannedAttempt,
        prerequisiteTaskIds,
        wakeCondition: "TaskTrackerFactsObserved"
      })
    }
    const succeededPromotion = succeededPromotionFor(responsibility)
    if (succeededPromotion !== undefined) {
      return integrationFinalityExplanationFor(
        runState.workflowHistory.records,
        responsibility,
        succeededPromotion,
        runtimeFacts
      )
    }
    const candidate = constructedCandidateFor(responsibility)
    const verification = verificationFor(candidate)
    if (candidateAwaitsVerificationPlan(candidate, verification)) {
      return FrontierExplanation.TargetVerificationConfigurationWait({
        plannedAttempt: responsibility.plannedAttempt,
        wakeCondition: "TargetVerificationPlanConfigured"
      })
    }
    if (promotionRuntimeIsMissing(verification)) {
      return FrontierExplanation.TargetPromotionConfigurationWait({
        plannedAttempt: responsibility.plannedAttempt,
        wakeCondition: "TargetPromotionRuntimeConfigured"
      })
    }
    if (promotionFor(candidate, verification)?._tag === "PromotionPending") {
      return FrontierExplanation.IntegrationInProgress({ plannedAttempt: responsibility.plannedAttempt })
    }
    return progressOrRewriteExplanation(responsibility)
  }
  // eslint-disable-next-line complexity -- One started responsibility has a closed precedence order for tracker, claim, blocker, target, and candidate facts.
  const transitions = started.flatMap<RunnableFrontierTransitionType>((responsibility) => {
    /* v8 ignore next -- @preserve The serialized coordinator cannot select a responsibility while its scoped candidate effect is active. */
    if (runtimeFacts.activeResponsibilityPositions?.has(responsibility.queuedAt)) return []
    const waiting = unsatisfiedPrerequisites(runState, responsibility).length > 0
    const held = runtimeFacts.heldResponsibilityPositions.has(responsibility.queuedAt)
    const existing = deriveIntegrationCandidateConstruction(runState.workflowHistory.records, responsibility)
    if (existing?._tag === "CandidateConstructed") {
      const candidate = constructedCandidateFor(responsibility)
      const verification = verificationFor(candidate)
      const promotion = promotionFor(candidate, verification)
      if (promotion?._tag === "PromotionSucceeded") {
        /* v8 ignore next -- @preserve The promotion action releases its exact target in ensuring; this release-only branch defends same-process compatibility state. */
        if (held) return [RunnableFrontierTransition.ReleaseStartedIntegrationTarget({ responsibility })]
        /* v8 ignore next -- @preserve The post-promotion blocker scenario and finality tracker-wait test exercise this same passive no-transition outcome. */
        if (!trackerFactsAreCurrentFor(responsibility) || waiting) return []
        return integrationFinalityTransitionsFor(
          runState.workflowHistory.records,
          responsibility,
          promotion,
          runtimeFacts
        )
      }
    }
    if (!trackerFactsAreCurrentFor(responsibility)) {
      return held ? [RunnableFrontierTransition.ReleaseStartedIntegrationTarget({ responsibility })] : []
    }
    if (!claimIsExactFor(responsibility)) return []
    if (existing?._tag === "CandidateConstructed") {
      const candidate = Option.getOrThrow(Option.fromUndefinedOr(constructedCandidateFor(responsibility)))
      const verification = deriveTargetVerificationState(runState.workflowHistory.records, candidate)
      if (verification?._tag === "VerificationStopped" || verification?._tag === "VerificationContradicted") {
        return held ? [RunnableFrontierTransition.ReleaseStartedIntegrationTarget({ responsibility })] : []
      }
      if (verification?._tag === "VerificationPassed") {
        const promotion = deriveTargetPromotionStateFor(runState.workflowHistory.records, candidate, verification)
        if (
          promotion?._tag === "PromotionSucceeded" ||
          promotion?._tag === "PromotionStale" ||
          promotion?._tag === "PromotionNonConvergent"
        ) {
          return held ? [RunnableFrontierTransition.ReleaseStartedIntegrationTarget({ responsibility })] : []
        }
        if (waiting) return held ? [RunnableFrontierTransition.ReleaseStartedIntegrationTarget({ responsibility })] : []
        if (!runtimeFacts.targetLineageByAttemptId?.has(responsibility.plannedAttempt.attemptId)) {
          return held ? [] : [RunnableFrontierTransition.AcquireStartedIntegrationTarget({ responsibility })]
        }
        if (promotion === undefined && verificationTargetWasRewritten(responsibility)) {
          if (targetLineageIsIncompatible(responsibility)) {
            return held ? [RunnableFrontierTransition.ReleaseStartedIntegrationTarget({ responsibility })] : []
          }
          if (!held) return [RunnableFrontierTransition.AcquireStartedIntegrationTarget({ responsibility })]
          const durableIntent = candidateIntentFor(responsibility)
          const lineage = runtimeFacts.targetLineageByAttemptId.get(responsibility.plannedAttempt.attemptId)
          if (durableIntent?._tag !== "IntegrationCandidateConstructionIntended" || lineage === undefined) return []
          return [
            RunnableFrontierTransition.ContinueStartedIntegrationCandidate({
              acceptedCandidateProgressAt: acceptedCandidateProgressAt(
                runState.workflowHistory.records,
                responsibility
              ),
              correctionLimit: durableIntent.correctionLimit,
              continuationLimit: durableIntent.continuationLimit,
              lineage,
              responsibility
            })
          ]
        }
        if (runtimeFacts.targetPromotionConfigured !== true) {
          return held ? [RunnableFrontierTransition.ReleaseStartedIntegrationTarget({ responsibility })] : []
        }
        if (!held) return [RunnableFrontierTransition.AcquireStartedIntegrationTarget({ responsibility })]
        if (
          promotion === undefined &&
          !runtimeFacts.targetLineageByAttemptId.has(responsibility.plannedAttempt.attemptId)
        ) {
          return []
        }
        return [RunnableFrontierTransition.RunTargetPromotion({ candidate, responsibility, verification })]
      }
      if (waiting && held) return [RunnableFrontierTransition.ReleaseStartedIntegrationTarget({ responsibility })]
      const plan = runtimeFacts.targetVerificationPlan ?? Option.none()
      if (Option.isNone(plan))
        return held ? [RunnableFrontierTransition.ReleaseStartedIntegrationTarget({ responsibility })] : []
      if (waiting) return held ? [RunnableFrontierTransition.ReleaseStartedIntegrationTarget({ responsibility })] : []
      if (verificationTargetWasRewritten(responsibility)) {
        if (targetLineageIsIncompatible(responsibility)) {
          return held ? [RunnableFrontierTransition.ReleaseStartedIntegrationTarget({ responsibility })] : []
        }
        if (!held) return [RunnableFrontierTransition.AcquireStartedIntegrationTarget({ responsibility })]
        const durableIntent = candidateIntentFor(responsibility)
        const lineage = runtimeFacts.targetLineageByAttemptId?.get(responsibility.plannedAttempt.attemptId)
        if (durableIntent?._tag !== "IntegrationCandidateConstructionIntended" || lineage === undefined) return []
        return [
          RunnableFrontierTransition.ContinueStartedIntegrationCandidate({
            acceptedCandidateProgressAt: acceptedCandidateProgressAt(runState.workflowHistory.records, responsibility),
            correctionLimit: durableIntent.correctionLimit,
            continuationLimit: durableIntent.continuationLimit,
            lineage,
            responsibility
          })
        ]
      }
      if (!held) return [RunnableFrontierTransition.AcquireStartedIntegrationTarget({ responsibility })]
      if (!runtimeFacts.targetLineageByAttemptId?.has(responsibility.plannedAttempt.attemptId)) return []
      return [RunnableFrontierTransition.RunTargetVerification({ candidate, plan: plan.value, responsibility })]
    }
    if (
      existing?._tag === "CandidateCorrelationContradiction" ||
      existing?._tag === "CandidateCorrectionLimitReached" ||
      existing?._tag === "CandidateContinuationLimitReached"
    )
      return held ? [RunnableFrontierTransition.ReleaseStartedIntegrationTarget({ responsibility })] : []
    if (waiting && held) return [RunnableFrontierTransition.ReleaseStartedIntegrationTarget({ responsibility })]
    if (!waiting && !held) return [RunnableFrontierTransition.AcquireStartedIntegrationTarget({ responsibility })]
    if (waiting) return []
    const durableIntent = candidateIntentFor(responsibility)
    if (hasPreIntentTargetRewrite(responsibility)) return []
    return Option.all({
      continuationLimit:
        durableIntent?._tag === "IntegrationCandidateConstructionIntended"
          ? Option.some(durableIntent.continuationLimit)
          : (runtimeFacts.candidateContinuationLimit ?? Option.none()),
      correctionLimit:
        durableIntent?._tag === "IntegrationCandidateConstructionIntended"
          ? Option.some(durableIntent.correctionLimit)
          : (runtimeFacts.candidateCorrectionLimit ?? Option.none()),
      lineage:
        durableIntent?._tag === "IntegrationCandidateConstructionIntended"
          ? Option.some({
              plannedBaseIsAncestorOfTargetHead: true as const,
              plannedBaseSha: durableIntent.plannedAttempt.baseSha,
              targetHeadSha: durableIntent.correlation.expectedTargetHead
            })
          : Option.fromUndefinedOr(runtimeFacts.targetLineageByAttemptId?.get(responsibility.plannedAttempt.attemptId))
    }).pipe(
      Option.match({
        onNone: () => [],
        onSome: ({ continuationLimit, correctionLimit, lineage }) => [
          RunnableFrontierTransition.ContinueStartedIntegrationCandidate({
            acceptedCandidateProgressAt: acceptedCandidateProgressAt(runState.workflowHistory.records, responsibility),
            correctionLimit,
            continuationLimit,
            lineage,
            responsibility
          })
        ]
      })
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
