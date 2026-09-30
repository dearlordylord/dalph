import type { JournalHistorySource } from "../../../workflow-journal/record-evidence.js"
import { journalRecordsOfKind } from "../../../workflow-journal/record-evidence.js"
import type { IntegratorRunQualifiedCandidate } from "../integrator/events.js"
import { targetPromotionCorrelationFor } from "../target-promotion/events.js"
import { deriveIntegrationFinalityStateFor } from "./state.js"

/** Whether this exact candidate has accepted, matching IntegrationFinalitySettled evidence. */
export const isIntegrationFinalitySettledForCandidate = (
  source: JournalHistorySource,
  candidate: IntegratorRunQualifiedCandidate
): boolean => {
  const promotionRequestId = targetPromotionCorrelationFor(candidate).requestId
  return Array.from(journalRecordsOfKind(source, "IntegrationFinalitySettled")).some(
    ({ event }) =>
      event._tag === "IntegrationFinalitySettled" &&
      event.claim.promotionCorrelation.requestId === promotionRequestId &&
      deriveIntegrationFinalityStateFor(source, event.claim)?._tag === "IntegrationFinalitySettled"
  )
}
