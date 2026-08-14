import { FrontierExplanation } from "./frontier.js"
import type {
  QueuedIntegrationResponsibility,
  StartedIntegrationResponsibility
} from "../../workflow/protocols/integration-admission/protocol.js"
import type { CurrentTaskClaimAuthority } from "./task-claim-authority.js"

type Responsibility = StartedIntegrationResponsibility | QueuedIntegrationResponsibility
type ClaimConstraint = Exclude<CurrentTaskClaimAuthority, { readonly _tag: "Exact" }>

export const claimAuthorityWaitsFor = (
  responsibilities: ReadonlyArray<Responsibility>,
  currentTrackerTaskIds: ReadonlySet<string>,
  succeededPromotionFor: (responsibility: StartedIntegrationResponsibility) => unknown,
  claimConstraintFor: (responsibility: Responsibility) => ClaimConstraint | undefined
) =>
  responsibilities.flatMap((responsibility) => {
    if (!currentTrackerTaskIds.has(responsibility.plannedAttempt.taskId)) return []
    if (responsibility._tag === "StartedIntegrationResponsibility" && succeededPromotionFor(responsibility)) return []
    const constraint = claimConstraintFor(responsibility)
    if (constraint === undefined) return []
    const claimState = constraint._tag
    return [
      FrontierExplanation.IntegrationTaskClaimConstraint({
        claimState,
        plannedAttempt: responsibility.plannedAttempt,
        wakeCondition:
          claimState === "Missing" || claimState === "Foreign"
            ? "ExplicitAppliedTaskClaimReacquisitionDirection"
            : "TaskClaimFactsObserved"
      })
    ]
  })

export const queuedTargetWaitsFor = (
  queued: ReadonlyArray<QueuedIntegrationResponsibility>,
  currentTrackerTaskIds: ReadonlySet<string>,
  claimIsExactFor: (responsibility: QueuedIntegrationResponsibility) => boolean,
  transitions: ReadonlyArray<{ readonly responsibility: { readonly queuedAt: unknown } }>
) =>
  queued
    .filter(
      (responsibility) =>
        currentTrackerTaskIds.has(responsibility.plannedAttempt.taskId) && claimIsExactFor(responsibility)
    )
    .flatMap((responsibility) =>
      transitions.some((transition) => transition.responsibility.queuedAt === responsibility.queuedAt)
        ? []
        : [
            FrontierExplanation.IntegrationTargetWait({
              plannedAttempt: responsibility.plannedAttempt,
              wakeCondition: "IntegrationTargetReleased"
            })
          ]
    )
