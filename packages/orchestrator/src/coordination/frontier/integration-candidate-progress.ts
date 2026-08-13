import { Option, Schema } from "effect"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import {
  IntegrationCandidateConstructionJournalEvent,
  integrationCandidateConstructionEventCorrelation,
  integrationCandidateCorrelationEquals
} from "../../workflow/protocols/integration-candidate-construction/events.js"
import type { StartedIntegrationResponsibility } from "../../workflow/protocols/integration-admission/protocol.js"

/** Finds the latest accepted occurrence for the exact started candidate-construction session. */
export const acceptedCandidateProgressAt = (
  records: ReadonlyArray<JournalRecord>,
  responsibility: StartedIntegrationResponsibility
): JournalPosition | null => {
  const intentRecord = records.findLast(
    ({ event }) =>
      event._tag === "IntegrationCandidateConstructionIntended" && event.startedAt === responsibility.startedAt
  )
  const intent = intentRecord?.event
  if (intentRecord === undefined || intent?._tag !== "IntegrationCandidateConstructionIntended") return null
  const isCandidateEvent = Schema.is(IntegrationCandidateConstructionJournalEvent)
  const relevant = records.findLast(
    ({ event, position }) =>
      position > intentRecord.position &&
      isCandidateEvent(event) &&
      integrationCandidateCorrelationEquals(integrationCandidateConstructionEventCorrelation(event), intent.correlation)
  )
  return Option.match(Option.fromUndefinedOr(relevant), { onNone: () => null, onSome: ({ position }) => position })
}
