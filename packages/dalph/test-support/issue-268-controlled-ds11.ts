import { samePlannedTaskAttempt, type PlannedTaskAttempt } from "@dalph/contracts"
import type { DeliveryRelationInputBundle, JournalRecord } from "@dalph/orchestrator"
import { issue268ControlledDeliveryCharacterization as scenario } from "./issue-268-controlled-characterization-catalog.js"
import { isIssue268RetainedBResponsibility } from "./issue-268-controlled-ds06.js"

const safeReportOrdinal = 2
const expectedHeldCorrelations = [scenario.attempts.A1, scenario.attempts.D1]
  .map((attemptId) => `${scenario.runId}:${attemptId}`)
  .toSorted()

const retainsExactC = (publication: DeliveryRelationInputBundle, plannedAttempt: PlannedTaskAttempt) =>
  publication.publication.exactEvidence.some(
    (evidence) =>
      evidence._tag === "ResponsibilityFacts" &&
      evidence.facts._tag === "PlannedAttemptExecutorFreshFacts" &&
      evidence.facts.disposition._tag === "TaskLifecycleConstraint" &&
      samePlannedTaskAttempt(evidence.facts.responsibility.plannedAttempt, plannedAttempt)
  )

/** DS-11 completes when exact C1 Safe is accepted and only A1/D1 continue to occupy P2. */
// eslint-disable-next-line complexity -- The content-qualified checkpoint conjoins exact Safe, stabilization, authority, and retention evidence.
export const isIssue268Ds11CompleteCheckpoint = (
  publication: DeliveryRelationInputBundle,
  records: ReadonlyArray<JournalRecord>
) => {
  const observations = records.filter(
    ({ event }) =>
      event._tag === "PlannedAttemptExecutorStateObserved" &&
      event.plannedAttempt.attemptId === scenario.attempts.C1 &&
      event.plannedAttempt.runId === scenario.runId &&
      event.observation._tag === "ExactExecutorReport" &&
      event.observation.report._tag === "ExecutorWorkSafelySuspended" &&
      event.observation.report.correlation.attemptId === scenario.attempts.C1 &&
      event.observation.report.correlation.runId === scenario.runId
  )
  const reports = records.filter(
    ({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkReported" &&
      event.ordinal === safeReportOrdinal &&
      event.report._tag === "ExecutorWorkSafelySuspended" &&
      event.report.correlation.attemptId === scenario.attempts.C1 &&
      event.report.correlation.runId === scenario.runId
  )
  const observation = observations[0]
  const report = reports[0]
  const capacityChange = records.find(
    ({ event }) => event._tag === "TaskWorkCapacityChanged" && event.capacity === scenario.policies.P2
  )
  const cResponsibility = records.find(
    ({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
      event.plannedAttempt.attemptId === scenario.attempts.C1 &&
      event.plannedAttempt.runId === scenario.runId
  )
  const graphIntent = records.findLast(
    ({ event, position }) =>
      report !== undefined &&
      position > report.position &&
      event._tag === "TaskTrackerReadIntentRecorded" &&
      event.operation._tag === "ReadTrackerGraph" &&
      event.operation.cause._tag === "PostQuiescenceReconfirmation" &&
      event.operation.target === scenario.target &&
      event.operation.predecessorOperationIds.includes(event.operation.cause.quiescentGraphOperationId)
  )
  const graphOperation =
    graphIntent?.event._tag === "TaskTrackerReadIntentRecorded" &&
    graphIntent.event.operation._tag === "ReadTrackerGraph" &&
    graphIntent.event.operation.cause._tag === "PostQuiescenceReconfirmation"
      ? graphIntent.event.operation
      : undefined
  const quiescentGraphOperationId =
    graphOperation?.cause._tag === "PostQuiescenceReconfirmation"
      ? graphOperation.cause.quiescentGraphOperationId
      : undefined
  const graphResult = records.findLast(
    // eslint-disable-next-line complexity -- One exact result must match every causal field of the post-quiescence graph operation.
    ({ event, position }) =>
      graphIntent !== undefined &&
      graphOperation !== undefined &&
      quiescentGraphOperationId !== undefined &&
      position > graphIntent.position &&
      event._tag === "TaskTrackerFactsObserved" &&
      event.observation._tag === "UnchangedTaskTrackerFactsReconfirmed" &&
      event.observation.operationId === graphOperation.operationId &&
      event.observation.priorFullObservationOperationId === quiescentGraphOperationId &&
      event.observation.factFamilies.every(({ contentIdentity }) => contentIdentity === scenario.graphs.G2.revision)
  )
  const acceptedAt = publication.actionInputs.runtimeFacts.acceptedAt
  if (
    observation === undefined ||
    report === undefined ||
    observations.length !== 1 ||
    reports.length !== 1 ||
    capacityChange === undefined ||
    capacityChange.event._tag !== "TaskWorkCapacityChanged" ||
    cResponsibility === undefined ||
    cResponsibility.event._tag !== "PlannedAttemptExecutorWorkResponsibilityBegan" ||
    graphIntent === undefined ||
    graphResult === undefined ||
    acceptedAt === null ||
    publication.publication.graph._tag !== "GraphEstablished"
  ) {
    return false
  }
  const held = publication.actionInputs.runtimeFacts.taskWork.held
    .map(({ correlation }) => `${correlation.runId}:${correlation.attemptId}`)
    .toSorted()
  return (
    observation.position < report.position &&
    report.position < graphIntent.position &&
    graphIntent.position < graphResult.position &&
    acceptedAt >= graphResult.position &&
    publication.publication.graph.observation.snapshot.revision === scenario.graphs.G2.revision &&
    publication.publication.policy.revision === capacityChange.event.revision &&
    publication.publication.policy.taskExecutionCapacity === scenario.policies.P2 &&
    acceptedAt >= capacityChange.position &&
    held.join(",") === expectedHeldCorrelations.join(",") &&
    publication.publication.exactEvidence.some(isIssue268RetainedBResponsibility) &&
    retainsExactC(publication, cResponsibility.event.plannedAttempt)
  )
}
