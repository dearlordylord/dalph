import type { DeliveryRelationInputBundle, JournalRecord } from "@dalph/orchestrator"
import { controlledDeliveryCharacterization as scenario } from "./controlled-characterization-catalog.js"
import { isControlledRetainedBResponsibility } from "./controlled-ds06.js"

const expectedHeldAttemptIds = [scenario.attempts.A1, scenario.attempts.C1, scenario.attempts.D1].toSorted()

const hasRetainedB = (publication: DeliveryRelationInputBundle) =>
  publication.publication.exactEvidence.some(isControlledRetainedBResponsibility)

const isAcceptedCapacityPublication = (
  publication: DeliveryRelationInputBundle,
  records: ReadonlyArray<JournalRecord>
) => {
  const capacityChange = records.find(
    ({ event }) => event._tag === "TaskWorkCapacityChanged" && event.capacity === scenario.policies.P2
  )
  if (capacityChange === undefined || capacityChange.event._tag !== "TaskWorkCapacityChanged") return false
  return (
    publication.publication.policy.revision === capacityChange.event.revision &&
    publication.publication.policy.taskExecutionCapacity === capacityChange.event.capacity &&
    publication.actionInputs.runtimeFacts.acceptedAt !== null &&
    publication.actionInputs.runtimeFacts.acceptedAt >= capacityChange.position
  )
}

/** The first P2 publication after the accepted capacity change retains all prior holders and B1. */
export const isControlledDs07CompleteCheckpoint = (
  publication: DeliveryRelationInputBundle,
  records: ReadonlyArray<JournalRecord>
) => {
  const heldAttemptIds = publication.actionInputs.runtimeFacts.taskWork.held
    .map(({ correlation }) => correlation.attemptId)
    .toSorted()
  return (
    publication.publication.graph._tag === "GraphEstablished" &&
    publication.publication.graph.observation.snapshot.revision === scenario.graphs.G1.revision &&
    isAcceptedCapacityPublication(publication, records) &&
    hasRetainedB(publication) &&
    heldAttemptIds.join(",") === expectedHeldAttemptIds.join(",")
  )
}
