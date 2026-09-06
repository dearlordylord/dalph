import type { DeliveryRelationInputBundle, JournalRecord } from "@dalph/orchestrator"
import { issue268ControlledDeliveryCharacterization as scenario } from "./issue-268-controlled-characterization-catalog.js"

const commandOrdinal = 2
const expectedHeldCorrelations = [scenario.attempts.A1, scenario.attempts.C1, scenario.attempts.D1]
  .map((attemptId) => `${scenario.runId}:${attemptId}`)
  .toSorted()
const expectedCurrentTrackerFactKeys = [
  `FocusedTaskWorkSpecificationFacts:${scenario.taskIds.A}`,
  `FocusedTaskWorkSpecificationFacts:${scenario.taskIds.D}`,
  `FocusedTaskClaimFacts:${scenario.taskIds.A}`,
  `FocusedTaskClaimFacts:${scenario.taskIds.D}`
]
const expectedCurrentGitResultCount = [
  ["PlannedAttemptWorktreeObserved", scenario.attempts.A1],
  ["PlannedAttemptWorktreeObserved", scenario.attempts.D1],
  ["TargetLineageObserved", scenario.attempts.A1],
  ["TargetLineageObserved", scenario.attempts.D1]
].length

const exactCSuspendIntent = (records: ReadonlyArray<JournalRecord>) =>
  records.find(
    ({ event }) =>
      event._tag === "PlannedAttemptExecutorCommandIntended" &&
      event.command === "Suspend" &&
      event.ordinal === commandOrdinal &&
      event.plannedAttempt.attemptId === scenario.attempts.C1 &&
      event.plannedAttempt.runId === scenario.runId
  )

const acceptedCExecutingResponse = (records: ReadonlyArray<JournalRecord>) =>
  records.find(
    ({ event }) =>
      event._tag === "PlannedAttemptExecutorCommandResponseObserved" &&
      event.commandOrdinal === commandOrdinal &&
      event.plannedAttempt.attemptId === scenario.attempts.C1 &&
      event.plannedAttempt.runId === scenario.runId &&
      event.report._tag === "ExecutorWorkExecuting" &&
      event.report.correlation.attemptId === scenario.attempts.C1 &&
      event.report.correlation.runId === scenario.runId
  )

const acceptedP2Change = (records: ReadonlyArray<JournalRecord>) =>
  records.findLast(({ event }) => event._tag === "TaskWorkCapacityChanged" && event.capacity === scenario.policies.P2)

const holdsExactlyGrandfatheredAttempts = (publication: DeliveryRelationInputBundle) =>
  publication.actionInputs.runtimeFacts.taskWork.held
    .map(({ correlation }) => `${correlation.runId}:${correlation.attemptId}`)
    .toSorted()
    .join(",") === expectedHeldCorrelations.join(",")

const projectsCAsSuspending = (publication: DeliveryRelationInputBundle) =>
  publication.publication.exactEvidence.some(
    (evidence) =>
      evidence._tag === "ResponsibilityFacts" &&
      evidence.facts.responsibility._tag === "PlannedAttemptExecutorWorkResponsibility" &&
      evidence.facts.responsibility.plannedAttempt.attemptId === scenario.attempts.C1 &&
      evidence.facts.disposition._tag === "PlannedAttemptExecutorSuspensionRequested"
  )

const acceptedG2Facts = (records: ReadonlyArray<JournalRecord>) =>
  records.findLast(
    ({ event }) =>
      event._tag === "TaskTrackerFactsObserved" &&
      event.observation._tag === "CompleteTaskTrackerFacts" &&
      event.observation.factFamilies.some(({ contentIdentity }) => contentIdentity === scenario.graphs.G2.revision)
  )

const completedCurrentTrackerReads = (
  records: ReadonlyArray<JournalRecord>,
  after: JournalRecord["position"],
  before: JournalRecord["position"]
) => {
  const observed = records.flatMap(({ event, position }) => {
    if (position <= after || position >= before || event._tag !== "TaskTrackerFactsObserved") return []
    if (event.observation._tag === "FocusedTaskWorkSpecificationFacts") {
      return [`${event.observation._tag}:${event.observation.factFamily.taskId}`]
    }
    return event.observation._tag === "FocusedTaskClaimFacts"
      ? [`${event.observation._tag}:${event.observation.coverage.taskId}`]
      : []
  })
  return (
    observed.length === expectedCurrentTrackerFactKeys.length &&
    expectedCurrentTrackerFactKeys.every((key) => observed.includes(key))
  )
}

const completedCurrentGitReads = (
  records: ReadonlyArray<JournalRecord>,
  after: JournalRecord["position"],
  before: JournalRecord["position"]
) => {
  const expected = records.flatMap(({ event, position }) => {
    if (position <= after || position >= before || event._tag !== "GitReadIntentRecorded") return []
    const operation = event.operation
    const attemptId = operation.plannedAttempt.attemptId
    if (
      operation.plannedAttempt.runId !== scenario.runId ||
      (attemptId !== scenario.attempts.A1 && attemptId !== scenario.attempts.D1)
    ) {
      return []
    }
    return [
      {
        operationId: operation.operationId,
        resultTag: operation._tag === "ReadTaskWorktree" ? "PlannedAttemptWorktreeObserved" : "TargetLineageObserved"
      } as const
    ]
  })
  const completed = records.filter(({ event, position }) => {
    if (position <= after || position >= before) return false
    if (event._tag !== "PlannedAttemptWorktreeObserved" && event._tag !== "TargetLineageObserved") return false
    return expected.some(({ operationId, resultTag }) => operationId === event.operationId && resultTag === event._tag)
  })
  return expected.length === expectedCurrentGitResultCount &&
    expected.every(({ operationId, resultTag }) =>
      completed.some(
        ({ event }) =>
          (event._tag === "PlannedAttemptWorktreeObserved" || event._tag === "TargetLineageObserved") &&
          event.operationId === operationId &&
          event._tag === resultTag
      )
    )
    ? completed
    : []
}

/** The live DS-10 checkpoint has accepted C1's still-executing Suspend response without releasing its position. */
// eslint-disable-next-line complexity -- The checkpoint deliberately conjoins every causal identity and journal-position requirement.
export const isIssue268Ds10CompleteCheckpoint = (
  publication: DeliveryRelationInputBundle,
  records: ReadonlyArray<JournalRecord>
) => {
  const intent = exactCSuspendIntent(records)
  const response = acceptedCExecutingResponse(records)
  const capacityChange = acceptedP2Change(records)
  const g2Facts = acceptedG2Facts(records)
  const gitResults =
    g2Facts === undefined || intent === undefined
      ? []
      : completedCurrentGitReads(records, g2Facts.position, intent.position)
  if (
    intent === undefined ||
    response === undefined ||
    capacityChange === undefined ||
    g2Facts === undefined ||
    capacityChange.event._tag !== "TaskWorkCapacityChanged"
  ) {
    return false
  }
  const acceptedAt = publication.actionInputs.runtimeFacts.acceptedAt
  if (acceptedAt === null || publication.publication.graph._tag !== "GraphEstablished") return false
  return (
    intent.position < response.position &&
    g2Facts.position < intent.position &&
    acceptedAt >= response.position &&
    completedCurrentTrackerReads(records, g2Facts.position, intent.position) &&
    gitResults.length === expectedCurrentGitResultCount &&
    gitResults.every(({ position }) => acceptedAt >= position) &&
    publication.publication.graph.observation.snapshot.revision === scenario.graphs.G2.revision &&
    publication.publication.policy.revision === capacityChange.event.revision &&
    publication.publication.policy.taskExecutionCapacity === scenario.policies.P2 &&
    acceptedAt >= capacityChange.position &&
    projectsCAsSuspending(publication) &&
    holdsExactlyGrandfatheredAttempts(publication)
  )
}
