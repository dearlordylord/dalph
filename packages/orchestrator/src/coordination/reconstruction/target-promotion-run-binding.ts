import type { RunId } from "@dalph/contracts"
import type { WorkflowJournalEvent } from "../../workflow/registry/event.js"
import { targetPromotionRunIdOf } from "../../workflow/protocols/target-promotion/events.js"

type TargetPromotionRunBindingEvent = Extract<
  WorkflowJournalEvent,
  {
    readonly _tag:
      | "TargetPromotionIntended"
      | "TargetPromotionAttemptIntended"
      | "TargetPromotionReconciliationDeferred"
      | "TargetPromotionObservedSuccess"
      | "TargetPromotionStale"
      | "TargetPromotionNonConvergence"
  }
>

export const invalidTargetPromotionRunBinding = (
  event: TargetPromotionRunBindingEvent,
  runId: RunId
): string | undefined =>
  targetPromotionRunIdOf(event.correlation) === runId
    ? undefined
    : `target promotion binds run ${targetPromotionRunIdOf(event.correlation)}`
