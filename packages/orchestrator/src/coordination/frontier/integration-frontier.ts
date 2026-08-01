import { Option } from "effect"
import { type AttemptId, type IntegrationTarget, type TaskId } from "@dalph/contracts"
import type { ReconstructedRunState } from "../reconstruction/state.js"
import { latestReconstructedTaskGraph } from "../reconstruction/graph-knowledge.js"
import {
  deriveIntegrationAdmission,
  deriveUnqueuedAcceptedResults,
  selectStartableIntegrationResponsibilities,
  type QueuedIntegrationResponsibility,
  type StartedIntegrationResponsibility
} from "../../workflow/protocols/integration-admission/protocol.js"
import {
  FrontierExplanation,
  type RunnableFrontier,
  type RunnableFrontierTransition as RunnableFrontierTransitionType,
  RunnableFrontierTransition
} from "./frontier.js"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { CurrentTaskClaimAuthority } from "./task-claim-authority.js"
import type { TargetLineageObservation } from "../../authorities/git/target-lineage.js"
import {
  deriveIntegrationCandidateConstruction,
  type CandidateCorrectionLimit,
  type CandidateContinuationLimit
} from "../../workflow/protocols/integration-candidate-construction/protocol.js"

export interface IntegrationFrontierRuntimeFacts {
  /** Tasks covered by a complete graph observation committed in this activation. */
  readonly activeResponsibilityPositions?: ReadonlySet<JournalPosition>
  readonly currentTrackerTaskIds: ReadonlySet<TaskId>
  readonly heldResponsibilityPositions: ReadonlySet<JournalPosition>
  readonly integrationTarget: Option.Option<IntegrationTarget>
  readonly candidateCorrectionLimit?: Option.Option<CandidateCorrectionLimit>
  readonly candidateContinuationLimit?: Option.Option<CandidateContinuationLimit>
  readonly targetLineageByAttemptId?: ReadonlyMap<AttemptId, TargetLineageObservation>
  readonly taskClaimAuthorityByAttemptId: ReadonlyMap<AttemptId, CurrentTaskClaimAuthority>
}

const emptyRuntimeFacts: IntegrationFrontierRuntimeFacts = {
  currentTrackerTaskIds: new Set(),
  activeResponsibilityPositions: new Set(),
  heldResponsibilityPositions: new Set(),
  integrationTarget: Option.none(),
  candidateCorrectionLimit: Option.none(),
  candidateContinuationLimit: Option.none(),
  targetLineageByAttemptId: new Map(),
  taskClaimAuthorityByAttemptId: new Map()
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

/** Derives target serialization and blocker waits from journal order plus current tracker facts. */
export const deriveIntegrationFrontier = (
  runState: ReconstructedRunState,
  runtimeFacts: IntegrationFrontierRuntimeFacts = emptyRuntimeFacts
): RunnableFrontier => {
  const responsibilities = deriveIntegrationAdmission(runState.workflowHistory.records).responsibilities
  const unqueuedAccepted = deriveUnqueuedAcceptedResults(runState.workflowHistory.records)
  const started = responsibilities.filter(
    (responsibility): responsibility is StartedIntegrationResponsibility =>
      responsibility._tag === "StartedIntegrationResponsibility"
  )
  const queued = responsibilities.filter(
    (responsibility): responsibility is QueuedIntegrationResponsibility =>
      responsibility._tag === "QueuedIntegrationResponsibility"
  )
  const trackerFactsAreCurrentFor = (responsibility: { readonly plannedAttempt: { readonly taskId: TaskId } }) =>
    runtimeFacts.currentTrackerTaskIds.has(responsibility.plannedAttempt.taskId)
  type ClaimSubject = { readonly plannedAttempt: { readonly attemptId: AttemptId; readonly taskId: TaskId } }
  const claimAuthorityFor = (responsibility: ClaimSubject) =>
    runtimeFacts.taskClaimAuthorityByAttemptId.get(responsibility.plannedAttempt.attemptId) ?? {
      _tag: "Unobserved" as const
    }
  const claimIsExactFor = (responsibility: ClaimSubject) => claimAuthorityFor(responsibility)._tag === "Exact"
  const claimConstraintFor = (responsibility: ClaimSubject) => {
    const authority = claimAuthorityFor(responsibility)
    return authority._tag === "Exact" ? undefined : authority
  }
  const startable = selectStartableIntegrationResponsibilities({ responsibilities }).filter(
    (responsibility) => trackerFactsAreCurrentFor(responsibility) && claimIsExactFor(responsibility)
  )
  const transitions = startable.map((responsibility) =>
    RunnableFrontierTransition.StartQueuedIntegration({ responsibility })
  )
  // eslint-disable-next-line complexity -- One started responsibility has a closed precedence order for tracker, claim, blocker, target, and candidate facts.
  const responsibilityTransitions = started.flatMap<RunnableFrontierTransitionType>((responsibility) => {
    if (!trackerFactsAreCurrentFor(responsibility) || !claimIsExactFor(responsibility)) return []
    /* v8 ignore next -- @preserve The serialized coordinator cannot select a responsibility while its scoped candidate effect is active. */
    if (runtimeFacts.activeResponsibilityPositions?.has(responsibility.queuedAt)) return []
    const waiting = unsatisfiedPrerequisites(runState, responsibility).length > 0
    const held = runtimeFacts.heldResponsibilityPositions.has(responsibility.queuedAt)
    const existing = deriveIntegrationCandidateConstruction(runState.workflowHistory.records, responsibility)
    if (
      existing?._tag === "CandidateConstructed" ||
      existing?._tag === "CandidateCorrelationContradiction" ||
      existing?._tag === "CandidateCorrectionLimitReached" ||
      existing?._tag === "CandidateContinuationLimitReached"
    )
      return held ? [RunnableFrontierTransition.ReleaseStartedIntegrationTarget({ responsibility })] : []
    if (waiting && held) return [RunnableFrontierTransition.ReleaseStartedIntegrationTarget({ responsibility })]
    if (!waiting && !held) return [RunnableFrontierTransition.AcquireStartedIntegrationTarget({ responsibility })]
    if (waiting) return []
    const durableIntent = runState.workflowHistory.records.findLast(
      ({ event }) =>
        event._tag === "IntegrationCandidateConstructionIntended" && event.startedAt === responsibility.startedAt
    )?.event
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
            correctionLimit,
            continuationLimit,
            lineage,
            responsibility
          })
        ]
      })
    )
  })
  const reconciliationTransitions = Option.match(runtimeFacts.integrationTarget, {
    onNone: () => [],
    onSome: (integrationTarget) =>
      unqueuedAccepted
        .filter(claimIsExactFor)
        .slice(0, 1)
        .map((accepted) =>
          RunnableFrontierTransition.QueueAcceptedResultIntegrationResponsibility({ accepted, integrationTarget })
        )
  })
  if (unqueuedAccepted.length > 0) {
    return {
      explanations: [
        ...unqueuedAccepted.flatMap((accepted) => {
          const constraint = claimConstraintFor(accepted)
          return constraint === undefined
            ? []
            : [
                (() => {
                  const claimState = constraint._tag
                  return FrontierExplanation.IntegrationTaskClaimConstraint({
                    claimState,
                    taskId: accepted.plannedAttempt.taskId,
                    wakeCondition:
                      claimState === "Missing" || claimState === "Foreign"
                        ? "ExplicitAppliedTaskClaimReacquisitionDirection"
                        : "TaskClaimFactsObserved"
                  })
                })()
              ]
        }),
        ...Option.match(runtimeFacts.integrationTarget, {
          onNone: () =>
            unqueuedAccepted
              .filter(claimIsExactFor)
              /* v8 ignore next -- Configuration-wait mapping is exercised through the equivalent frontier explanation assertion. */
              .map(({ plannedAttempt }) =>
                FrontierExplanation.IntegrationConfigurationWait({
                  taskId: plannedAttempt.taskId,
                  wakeCondition: "IntegrationTargetConfigured"
                })
              ),
          onSome: () => []
        })
      ],
      transitions: reconciliationTransitions
    }
  }
  const trackerFactsWaits = [...started, ...queued]
    .filter((responsibility) => !trackerFactsAreCurrentFor(responsibility))
    .map((responsibility) =>
      FrontierExplanation.IntegrationTrackerFactsWait({
        taskId: responsibility.plannedAttempt.taskId,
        wakeCondition: "TaskTrackerFactsObserved"
      })
    )
  const claimAuthorityWaits = [...started, ...queued].flatMap((responsibility) => {
    if (!trackerFactsAreCurrentFor(responsibility)) return []
    const constraint = claimConstraintFor(responsibility)
    if (constraint === undefined) return []
    const claimState = constraint._tag
    return [
      FrontierExplanation.IntegrationTaskClaimConstraint({
        claimState,
        taskId: responsibility.plannedAttempt.taskId,
        wakeCondition:
          claimState === "Missing" || claimState === "Foreign"
            ? "ExplicitAppliedTaskClaimReacquisitionDirection"
            : "TaskClaimFactsObserved"
      })
    ]
  })
  return {
    explanations: [
      ...trackerFactsWaits,
      ...claimAuthorityWaits,
      ...started
        .filter((responsibility) => trackerFactsAreCurrentFor(responsibility) && claimIsExactFor(responsibility))
        .map((responsibility) => {
          const prerequisiteTaskIds = unsatisfiedPrerequisites(runState, responsibility)
          return prerequisiteTaskIds.length === 0
            ? FrontierExplanation.IntegrationInProgress({ taskId: responsibility.plannedAttempt.taskId })
            : FrontierExplanation.IntegrationDependencyWait({
                plannedAttempt: responsibility.plannedAttempt,
                prerequisiteTaskIds,
                wakeCondition: "TaskTrackerFactsObserved"
              })
        }),
      ...queued
        .filter((responsibility) => trackerFactsAreCurrentFor(responsibility) && claimIsExactFor(responsibility))
        .flatMap((responsibility) =>
          transitions.some((transition) => transition.responsibility.queuedAt === responsibility.queuedAt)
            ? []
            : [
                FrontierExplanation.IntegrationTargetWait({
                  taskId: responsibility.plannedAttempt.taskId,
                  wakeCondition: "IntegrationTargetReleased"
                })
              ]
        )
    ],
    transitions: [...responsibilityTransitions, ...transitions]
  }
}
