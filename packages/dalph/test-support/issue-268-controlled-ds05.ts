import type { DeliveryRelationInputBundle, JournalRecord } from "@dalph/orchestrator"
import { issue268ControlledDeliveryCharacterization as scenario } from "./issue-268-controlled-characterization-catalog.js"

const expectedHeldAttemptIds = [scenario.attempts.A1, scenario.attempts.C1].toSorted()
const safeReportOrdinal = 2

/** The first complete G1 publication after B1 Safe is durable and only B1's position has released. */
export const isIssue268Ds05CompleteCheckpoint = (
  publication: DeliveryRelationInputBundle,
  records: ReadonlyArray<JournalRecord>
) => {
  const acceptedSafe = records.find(
    ({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkReported" &&
      event.ordinal === safeReportOrdinal &&
      event.report._tag === "ExecutorWorkSafelySuspended" &&
      event.report.correlation.attemptId === scenario.attempts.B1
  )
  const hasChangedB = publication.publication.exactEvidence.some(
    (evidence) =>
      evidence._tag === "ResponsibilityFacts" &&
      evidence.facts.responsibility._tag === "PlannedAttemptExecutorWorkResponsibility" &&
      evidence.facts.responsibility.plannedAttempt.attemptId === scenario.attempts.B1 &&
      evidence.facts.disposition._tag === "TaskSpecificationChangeConstraint" &&
      evidence.facts.disposition.plannedFingerprint === scenario.specifications.F1.B.fingerprint &&
      evidence.facts.disposition.observedFingerprint === scenario.specifications.F2.B.fingerprint
  )
  const heldAttemptIds = publication.actionInputs.runtimeFacts.taskWork.held
    .map(({ correlation }) => correlation.attemptId)
    .toSorted()
  return (
    publication.publication.graph._tag === "GraphEstablished" &&
    publication.publication.graph.observation.snapshot.revision === scenario.graphs.G1.revision &&
    acceptedSafe !== undefined &&
    publication.actionInputs.runtimeFacts.acceptedAt !== null &&
    publication.actionInputs.runtimeFacts.acceptedAt >= acceptedSafe.position &&
    hasChangedB &&
    heldAttemptIds.join(",") === expectedHeldAttemptIds.join(",")
  )
}
