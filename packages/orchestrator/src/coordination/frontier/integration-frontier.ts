import { Option } from "effect"
import { type AttemptId, type IntegrationTarget, type TaskId } from "@dalph/contracts"
import type { ReconstructedRunState } from "../reconstruction/state.js"
import {
  deriveIntegrationAdmission,
  deriveUnqueuedAcceptedResults,
  selectStartableIntegrationResponsibilities,
  type QueuedIntegrationResponsibility,
  type StartedIntegrationResponsibility
} from "../../workflow/protocols/integration-admission/protocol.js"
import { FrontierExplanation, type RunnableFrontier, RunnableFrontierTransition } from "./frontier.js"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { CurrentTaskClaimAuthority } from "./task-claim-authority.js"
import type { TargetLineageObservation } from "../../authorities/git/target-lineage.js"
import type { ActiveTaskClaim } from "../../authorities/task-tracker/claim-mutation.js"
import {
  type CandidateCorrectionLimit,
  type CandidateContinuationLimit
} from "../../workflow/protocols/integration-candidate-construction/protocol.js"
import { type TargetVerificationPlan } from "../../workflow/protocols/target-verification/events.js"
import { claimAuthorityWaitsFor, queuedTargetWaitsFor } from "./integration-claim-waits.js"
import { deriveStartedIntegrationFrontier } from "./integration-frontier-transitions.js"
export { integrationFinalityTransitionsFor } from "./integration-finality-frontier.js"
export { integrationDeliveryWaitsOf, type IntegrationDeliveryWait } from "./integration-delivery-waits.js"

export interface IntegrationFrontierRuntimeFacts {
  /** Tasks covered by a complete graph observation committed in this activation. */
  readonly activeResponsibilityPositions?: ReadonlySet<JournalPosition>
  readonly currentTrackerTaskIds: ReadonlySet<TaskId>
  readonly heldResponsibilityPositions: ReadonlySet<JournalPosition>
  readonly integrationTarget: Option.Option<IntegrationTarget>
  readonly candidateCorrectionLimit?: Option.Option<CandidateCorrectionLimit>
  readonly candidateContinuationLimit?: Option.Option<CandidateContinuationLimit>
  readonly targetLineageByAttemptId?: ReadonlyMap<AttemptId, TargetLineageObservation>
  readonly targetVerificationPlan?: Option.Option<TargetVerificationPlan>
  readonly targetPromotionConfigured?: boolean
  readonly taskClaimAuthorityByAttemptId: ReadonlyMap<AttemptId, CurrentTaskClaimAuthority>
  readonly activeClaimByAttemptId?: ReadonlyMap<AttemptId, ActiveTaskClaim>
  readonly integrationFinalityConfigured?: boolean
  readonly completionTaskConfigured?: boolean
}

const emptyRuntimeFacts: IntegrationFrontierRuntimeFacts = {
  currentTrackerTaskIds: new Set(),
  activeResponsibilityPositions: new Set(),
  heldResponsibilityPositions: new Set(),
  integrationTarget: Option.none(),
  candidateCorrectionLimit: Option.none(),
  candidateContinuationLimit: Option.none(),
  targetLineageByAttemptId: new Map(),
  targetVerificationPlan: Option.none(),
  targetPromotionConfigured: false,
  taskClaimAuthorityByAttemptId: new Map()
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
  const {
    claimConstraintFor,
    claimIsExactFor,
    explanationForStarted,
    succeededPromotionFor,
    trackerFactsAreCurrentFor,
    transitions: responsibilityTransitions
  } = deriveStartedIntegrationFrontier(runState, runtimeFacts, started)
  const startable = selectStartableIntegrationResponsibilities({ responsibilities }).filter(
    (responsibility) => trackerFactsAreCurrentFor(responsibility) && claimIsExactFor(responsibility)
  )
  const transitions = startable.map((responsibility) =>
    RunnableFrontierTransition.StartQueuedIntegration({ responsibility })
  )
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
                    plannedAttempt: accepted.plannedAttempt,
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
                  plannedAttempt,
                  wakeCondition: "IntegrationTargetConfigured"
                })
              ),
          onSome: () => []
        })
      ],
      transitions: reconciliationTransitions
    }
  }
  const claimAuthorityWaits = claimAuthorityWaitsFor(
    [...started, ...queued],
    runtimeFacts.currentTrackerTaskIds,
    succeededPromotionFor,
    claimConstraintFor
  )
  return {
    explanations: [
      ...[...started, ...queued]
        .filter((responsibility) => !trackerFactsAreCurrentFor(responsibility))
        .map((responsibility) =>
          FrontierExplanation.IntegrationTrackerFactsWait({
            plannedAttempt: responsibility.plannedAttempt,
            wakeCondition: "TaskTrackerFactsObserved"
          })
        ),
      ...claimAuthorityWaits,
      ...started
        .filter(
          (responsibility) =>
            trackerFactsAreCurrentFor(responsibility) &&
            /* v8 ignore next -- @preserve The maintained restart cassette exercises post-promotion finality after the original active claim has become KC. */
            (claimIsExactFor(responsibility) || succeededPromotionFor(responsibility) !== undefined)
        )
        .map(explanationForStarted),
      ...queuedTargetWaitsFor(queued, runtimeFacts.currentTrackerTaskIds, claimIsExactFor, transitions)
    ],
    transitions: [...responsibilityTransitions(), ...transitions]
  }
}
