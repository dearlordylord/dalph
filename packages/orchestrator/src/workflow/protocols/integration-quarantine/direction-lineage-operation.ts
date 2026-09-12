import type { PlannedTaskAttempt } from "@dalph/contracts"
import type { JournalPosition } from "../../../workflow-journal/identity.js"
import { OperationId } from "../../identity.js"

/** Identifies the Git lineage read authorized by one exact Q/D and current post-claim tracker graph. */
export const integrationQuarantineDirectionTargetLineageOperationId = (
  facts: {
    readonly quarantineAt: JournalPosition
    readonly directionAt: JournalPosition
    readonly direction: { readonly requestId: { readonly nonce: string } }
  },
  plannedAttempt: PlannedTaskAttempt,
  graphObservedAt: JournalPosition
): OperationId =>
  OperationId.make(
    `integration-quarantine-direction:${encodeURIComponent(facts.direction.requestId.nonce)}:${plannedAttempt.attemptId}:q:${facts.quarantineAt}:d:${facts.directionAt}:g:${graphObservedAt}:target-lineage`
  )
