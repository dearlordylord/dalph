import type { PlannedTaskAttempt } from "@dalph/contracts"
import type { DeliveryRelationInputBundle, JournalRecord } from "@dalph/orchestrator"
import { issue268ControlledDeliveryCharacterization as scenario } from "./issue-268-controlled-characterization-catalog.js"

const expectedHeldAttemptIds = [scenario.attempts.A1, scenario.attempts.C1, scenario.attempts.D1].toSorted()

/** Exact immutable B1 attempt used across the controlled delivery story. */
export const isIssue268ExactB1Plan = (plan: PlannedTaskAttempt) =>
  [
    plan.attemptId === scenario.attempts.B1,
    plan.baseSha === scenario.baseSha,
    plan.branch === "refs/heads/dalph/issue-268-b-1",
    plan.executor === "executor:issue-268-controlled",
    plan.runId === scenario.runId,
    plan.taskId === scenario.taskIds.B,
    plan.taskRevision === scenario.specifications.F1.B.fingerprint,
    plan.worktree === "/dalph/controlled-characterization/issue-268/B-1"
  ].every(Boolean)

/** Exact retained B1 responsibility shared by later controlled-story checkpoints. */
export const isIssue268RetainedBResponsibility = (
  evidence: DeliveryRelationInputBundle["publication"]["exactEvidence"][number]
) => {
  if (evidence._tag !== "ResponsibilityFacts" || evidence.facts._tag !== "PlannedAttemptExecutorFreshFacts") {
    return false
  }
  const { disposition, responsibility } = evidence.facts
  if (disposition._tag !== "TaskSpecificationChangeConstraint") {
    return false
  }
  return (
    disposition.observedFingerprint === scenario.specifications.F2.B.fingerprint &&
    disposition.plannedFingerprint === scenario.specifications.F1.B.fingerprint &&
    isIssue268ExactB1Plan(responsibility.plannedAttempt)
  )
}

/** The first G1 publication after D1 is executing and occupies B1's released position. */
export const isIssue268Ds06CompleteCheckpoint = (
  publication: DeliveryRelationInputBundle,
  records: ReadonlyArray<JournalRecord>
) => {
  const hasDExecuting = records.some(
    ({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkReported" &&
      event.ordinal === 1 &&
      event.report._tag === "ExecutorWorkExecuting" &&
      event.report.correlation.attemptId === scenario.attempts.D1
  )
  const hasDResponsibility = publication.publication.exactEvidence.some(
    (evidence) =>
      evidence._tag === "ResponsibilityFacts" &&
      evidence.facts.responsibility._tag === "PlannedAttemptExecutorWorkResponsibility" &&
      evidence.facts.responsibility.plannedAttempt.attemptId === scenario.attempts.D1
  )
  const hasRetainedBResponsibility = publication.publication.exactEvidence.some(isIssue268RetainedBResponsibility)
  const heldAttemptIds = publication.actionInputs.runtimeFacts.taskWork.held
    .map(({ correlation }) => correlation.attemptId)
    .toSorted()
  return (
    publication.publication.graph._tag === "GraphEstablished" &&
    publication.publication.graph.observation.snapshot.revision === scenario.graphs.G1.revision &&
    hasDExecuting &&
    hasDResponsibility &&
    hasRetainedBResponsibility &&
    heldAttemptIds.join(",") === expectedHeldAttemptIds.join(",")
  )
}
