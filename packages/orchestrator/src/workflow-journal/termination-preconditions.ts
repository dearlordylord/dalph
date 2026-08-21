/* eslint-disable functional/immutable-data -- These are private validation indexes, never journal state. */
import { plannedTaskAttemptEquivalence, type PlannedTaskAttempt, type RunId } from "@dalph/contracts"
import { taskTrackerTargetKey } from "../authorities/task-tracker/target.js"
import { isExactTaskClaim } from "../authorities/task-tracker/claim-mutation.js"
import { reduceWorkflowJournalHistory } from "../coordination/reconstruction/history.js"
import type { WorkflowResponsibilityEntry } from "../coordination/reconstruction/state.js"
import { type OperationId } from "../workflow/identity.js"
import { describeJournalEvent } from "../workflow/registry/event-descriptor.js"
import { workflowJournalTransitionRuleFor } from "../coordination/reconstruction/history-transition.js"
import type {
  CompleteTaskTrackerFactsObserved,
  UnchangedTaskTrackerFactsReconfirmed
} from "../workflow/task-tracker-facts/observation.js"
import type { RunFinalityEvidence } from "../coordination/frontier/run-finality.js"
import type { JournalPosition } from "./identity.js"
import type { JournalRecord } from "./store.js"
import { sameAttemptChoiceRequestId, sameAttemptChoiceSubject } from "../workflow/protocols/attempt-choice/events.js"

type GraphFactsObservation = CompleteTaskTrackerFactsObserved | UnchangedTaskTrackerFactsReconfirmed

type GraphObservationRecord = {
  readonly operationId: OperationId
  readonly observation: GraphFactsObservation
  readonly position: JournalPosition
}

type GraphReadOperation = Extract<
  Extract<JournalRecord["event"], { readonly _tag: "TaskTrackerReadIntentRecorded" }>["operation"],
  { readonly _tag: "ReadTrackerGraph" }
>

const lengthPrefixed = (value: string): string => `${value.length}:${value}`

const canonicalSequence = (values: ReadonlyArray<string>): string => values.toSorted().map(lengthPrefixed).join("|")

/**
 * Compares tracker graph meaning, rather than encoded object identity. Revisions and
 * read freshness are intentionally omitted: a revision is evidence about a payload,
 * while this key answers whether two graph payloads describe the same graph.
 */
const graphFactsKey = (observation: CompleteTaskTrackerFactsObserved): string => {
  const [identities, lifecycles, prerequisites, groupings, membership] = observation.factFamilies
  const lifecycleKey = canonicalSequence(
    lifecycles.lifecycles.map(({ lifecycle, taskId }) => `${lengthPrefixed(taskId)}=${lifecycle._tag}`)
  )
  const prerequisiteKey = canonicalSequence(
    prerequisites.prerequisites.map(
      ({ prerequisiteTaskIds, taskId }) => `${lengthPrefixed(taskId)}=${canonicalSequence(prerequisiteTaskIds)}`
    )
  )
  const groupingKey = canonicalSequence(
    groupings.groupings.map(({ parentTaskId, taskId }) => `${lengthPrefixed(taskId)}=${parentTaskId ?? "<root>"}`)
  )
  return [
    canonicalSequence(identities.taskIds),
    lifecycleKey,
    prerequisiteKey,
    groupingKey,
    canonicalSequence(membership.memberTaskIds)
  ]
    .map(lengthPrefixed)
    .join(";")
}

const graphCoverageOverlaps = (left: GraphFactsObservation, right: GraphFactsObservation): boolean => {
  if (left._tag === "CompleteTaskTrackerFacts" && right._tag === "CompleteTaskTrackerFacts") {
    const leftCoverage = left.factFamilies[0].coverage.explicitlyCoveredTaskIds
    const rightCoverage = right.factFamilies[0].coverage.explicitlyCoveredTaskIds
    return (
      leftCoverage.length === 0 ||
      rightCoverage.length === 0 ||
      leftCoverage.some((taskId) => rightCoverage.includes(taskId))
    )
  }
  return true
}

const graphObservationTarget = (observation: GraphFactsObservation) => observation.target

const graphObservationFor = (
  records: ReadonlyArray<GraphObservationRecord>,
  observation: GraphFactsObservation
): CompleteTaskTrackerFactsObserved | undefined => {
  if (observation._tag === "CompleteTaskTrackerFacts") return observation
  const prior = records.find(
    ({ observation: candidate, operationId }) =>
      operationId === observation.priorFullObservationOperationId && candidate._tag === "CompleteTaskTrackerFacts"
  )
  /* v8 ignore next -- @preserve The find predicate admits only complete graph observations. */
  return prior?.observation._tag === "CompleteTaskTrackerFacts" ? prior.observation : undefined
}

const graphObservationRecords = (records: ReadonlyArray<JournalRecord>): ReadonlyArray<GraphObservationRecord> =>
  records.flatMap(({ event, position }) => {
    if (event._tag !== "TaskTrackerFactsObserved") return []
    if (
      event.observation._tag !== "CompleteTaskTrackerFacts" &&
      event.observation._tag !== "UnchangedTaskTrackerFactsReconfirmed"
    )
      return []
    return [{ observation: event.observation, operationId: event.operationId, position }]
  })

const graphReadOperations = (records: ReadonlyArray<JournalRecord>): ReadonlyMap<OperationId, GraphReadOperation> =>
  new Map(
    records.flatMap(({ event }) =>
      event._tag === "TaskTrackerReadIntentRecorded" && event.operation._tag === "ReadTrackerGraph"
        ? [[event.operation.operationId, event.operation] as const]
        : []
    )
  )

/** Returns whether `ancestor` is named, directly or transitively, by `descendant`. */
const causallyPrecedes = (
  operations: ReadonlyMap<OperationId, GraphReadOperation>,
  ancestor: OperationId,
  descendant: OperationId
): boolean => {
  const visited = new Set<OperationId>()
  const visit = (operationId: OperationId): boolean => {
    if (visited.has(operationId)) return false
    visited.add(operationId)
    const operation = operations.get(operationId)
    if (operation === undefined) return false
    if (operation.predecessorOperationIds.includes(ancestor)) return true
    return operation.predecessorOperationIds.some(visit)
  }
  return ancestor !== descendant && visit(descendant)
}

const graphObservationSupersededBy = (
  operations: ReadonlyMap<OperationId, GraphReadOperation>,
  earlier: GraphObservationRecord,
  later: GraphObservationRecord
): boolean => {
  if (earlier.operationId === later.operationId) return false
  if (causallyPrecedes(operations, earlier.operationId, later.operationId)) return true
  return (
    later.observation._tag === "UnchangedTaskTrackerFactsReconfirmed" &&
    later.observation.priorFullObservationOperationId === earlier.operationId
  )
}

const graphObservationsContradict = (
  observations: ReadonlyArray<GraphObservationRecord>,
  operations: ReadonlyMap<OperationId, GraphReadOperation>,
  left: GraphObservationRecord,
  right: GraphObservationRecord
): boolean => {
  if (left.operationId === right.operationId) return false
  if (graphObservationSupersededBy(operations, left, right)) return false
  if (
    taskTrackerTargetKey(graphObservationTarget(left.observation)) !==
    taskTrackerTargetKey(graphObservationTarget(right.observation))
  ) {
    return false
  }
  if (!graphCoverageOverlaps(left.observation, right.observation)) return false
  const leftGraph = graphObservationFor(observations, left.observation)
  const rightGraph = graphObservationFor(observations, right.observation)
  return leftGraph !== undefined && rightGraph !== undefined && graphFactsKey(leftGraph) !== graphFactsKey(rightGraph)
}

/**
 * A later journal position is not itself tracker freshness. Only an explicit causal
 * predecessor (or a typed reconfirmation reference) may supersede an older graph read.
 */
const graphKnowledgeIssues = (records: ReadonlyArray<JournalRecord>): ReadonlyArray<string> => {
  const observations = graphObservationRecords(records)
  const operations = graphReadOperations(records)
  const maximal = observations.filter(
    (candidate) => !observations.some((later) => graphObservationSupersededBy(operations, candidate, later))
  )
  const contradictory = maximal.some((left) =>
    maximal.some((right) => graphObservationsContradict(observations, operations, left, right))
  )
  return contradictory ? ["termination requires tracker graph observations to be causally comparable"] : []
}

const settledOperationIds = (records: ReadonlyArray<JournalRecord>): ReadonlySet<OperationId> =>
  new Set(
    records.flatMap(({ event }) => {
      const transition = workflowJournalTransitionRuleFor(event)
      const descriptor = describeJournalEvent(event)
      return transition?._tag === "Outcome" && descriptor._tag === "OperationEventDescriptor"
        ? [descriptor.operationId]
        : []
    })
  )

const taskClaimReleaseSettled = (
  records: ReadonlyArray<JournalRecord>,
  responsibility: Extract<WorkflowResponsibilityEntry, { readonly _tag: "TaskClaimReleaseResponsibility" }>
): boolean =>
  records.some(
    ({ event, position }) =>
      position > responsibility.beganAt &&
      event._tag === "StoppedAttemptClaimNoReleaseObserved" &&
      event.observation._tag === "ActiveTaskClaim" &&
      isExactTaskClaim(event.expectedClaim, responsibility.operation.release.claim) &&
      !isExactTaskClaim(event.observation, event.expectedClaim)
  ) ||
  records.some(
    ({ event, position }) =>
      position > responsibility.beganAt &&
      event._tag === "StoppedAttemptClaimNoReleaseObserved" &&
      event.observation._tag === "UnclaimedTask" &&
      event.observation.taskId === responsibility.taskId &&
      event.expectedClaim.taskId === responsibility.taskId
  ) ||
  records.some(
    ({ event, position }) =>
      position > responsibility.beganAt &&
      event._tag === "CancelledAttemptClaimNoReleaseObserved" &&
      isExactTaskClaim(event.expectedClaim, responsibility.operation.release.claim) &&
      (event.observation._tag === "UnclaimedTask"
        ? event.observation.taskId === responsibility.taskId
        : !isExactTaskClaim(event.observation, event.expectedClaim))
  )

const taskClaimAcquisitionSettled = (
  records: ReadonlyArray<JournalRecord>,
  responsibility: Extract<WorkflowResponsibilityEntry, { readonly _tag: "TaskClaimResponsibility" }>
): boolean => {
  const outcome = records.findLast(({ event, position }) => {
    if (position <= responsibility.beganAt) return false
    return (
      (event._tag === "TaskClaimAcquired" && event.claim.operationId === responsibility.acquisition.operationId) ||
      (event._tag === "TaskClaimAcquisitionRejected" && event.operationId === responsibility.acquisition.operationId)
    )
  })
  if (outcome?.event._tag === "TaskClaimAcquisitionRejected") return true
  if (outcome?.event._tag !== "TaskClaimAcquired") return false
  const acquiredClaim = outcome.event.claim
  return (
    records.some(({ event, position }) => {
      if (position <= outcome.position || event._tag !== "TaskClaimReleased") return false
      return isExactTaskClaim(event.release.claim, acquiredClaim)
    }) ||
    records.some(({ event, position }) => {
      if (position <= outcome.position || event._tag !== "StoppedAttemptClaimNoReleaseObserved") return false
      if (!isExactTaskClaim(event.expectedClaim, acquiredClaim)) return false
      if (event.observation._tag === "UnclaimedTask") return event.observation.taskId === acquiredClaim.taskId
      return !isExactTaskClaim(event.observation, acquiredClaim)
    }) ||
    records.some(({ event, position }) => {
      if (position <= outcome.position || event._tag !== "CancelledAttemptClaimNoReleaseObserved") return false
      if (!isExactTaskClaim(event.expectedClaim, acquiredClaim)) return false
      if (event.observation._tag === "UnclaimedTask") return event.observation.taskId === acquiredClaim.taskId
      return !isExactTaskClaim(event.observation, acquiredClaim)
    }) ||
    records.some(
      ({ event, position }) =>
        position > outcome.position &&
        event._tag === "IntegrationFinalitySettled" &&
        isExactTaskClaim(event.claim.originalClaim, acquiredClaim)
    )
  )
}

const cancellationForAttempt = (records: ReadonlyArray<JournalRecord>, plannedAttempt: PlannedTaskAttempt) =>
  records.find(({ event, runId }) => runId === plannedAttempt.runId && event._tag === "RunCancellationApplied")

const hasCancellationRelinquishment = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt
): boolean =>
  records.some(({ event, runId }) => {
    if (runId !== plannedAttempt.runId || event._tag !== "CancelledAttemptImplementationResponsibilityRelinquished") {
      return false
    }
    return plannedTaskAttemptEquivalence(event.plannedAttempt, plannedAttempt)
  })

const hasIntegrationSettlement = (records: ReadonlyArray<JournalRecord>, plannedAttempt: PlannedTaskAttempt): boolean =>
  records.some(({ event, runId }) => {
    if (runId !== plannedAttempt.runId || event._tag !== "IntegrationFinalitySettled") return false
    return plannedTaskAttemptEquivalence(event.claim.plannedAttempt, plannedAttempt)
  })

const latestExecutorReport = (records: ReadonlyArray<JournalRecord>, plannedAttempt: PlannedTaskAttempt) =>
  records.findLast(
    ({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkReported" &&
      event.report.correlation.runId === plannedAttempt.runId &&
      event.report.correlation.attemptId === plannedAttempt.attemptId
  )

const latestTerminalExecutorReportPosition = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt
): JournalPosition | undefined => {
  const latest = latestExecutorReport(records, plannedAttempt)
  return latest?.event._tag === "PlannedAttemptExecutorWorkReported" && latest.event.report._tag === "Terminal"
    ? latest.position
    : undefined
}

const abandonedAttemptSettled = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt
): boolean => {
  const abandonment = records.findLast(({ event }) => {
    if (event._tag !== "AttemptImplementationAbandoned") return false
    return plannedTaskAttemptEquivalence(event.subject.plannedAttempt, plannedAttempt)
  })
  if (abandonment?.event._tag !== "AttemptImplementationAbandoned") return false
  const abandonmentEvent = abandonment.event
  const released = records.some(({ event, position }) => {
    if (position <= abandonment.position || event._tag !== "TaskClaimReleased") return false
    return isExactTaskClaim(event.release.claim, abandonmentEvent.expectedClaim)
  })
  const noRelease = records.some(({ event }) => {
    if (event._tag !== "StoppedAttemptClaimNoReleaseObserved") return false
    return (
      sameAttemptChoiceRequestId(event.requestId, abandonmentEvent.requestId) &&
      sameAttemptChoiceSubject(event.subject, abandonmentEvent.subject)
    )
  })
  return released || noRelease
}

const executorReportSettled = (records: ReadonlyArray<JournalRecord>, plannedAttempt: PlannedTaskAttempt): boolean => {
  const cancellationApplied = cancellationForAttempt(records, plannedAttempt)
  const cancellationRelinquished = hasCancellationRelinquishment(records, plannedAttempt)
  const integrationSettled = hasIntegrationSettlement(records, plannedAttempt)
  const terminalAt = latestTerminalExecutorReportPosition(records, plannedAttempt)
  if (cancellationApplied !== undefined) {
    return cancellationRelinquished || integrationSettled
  }
  return cancellationRelinquished || terminalAt !== undefined || abandonedAttemptSettled(records, plannedAttempt)
}

const responsibilityIssues = (
  records: ReadonlyArray<JournalRecord>,
  entries: ReadonlyArray<WorkflowResponsibilityEntry>
): ReadonlyArray<string> => {
  const settled = settledOperationIds(records)
  return entries.flatMap((responsibility) => {
    const settledByHistory =
      responsibility._tag === "PlannedAttemptExecutorWorkResponsibility"
        ? executorReportSettled(records, responsibility.plannedAttempt)
        : responsibility._tag === "TaskClaimReleaseResponsibility"
          ? settled.has(responsibility.operation.release.operationId) ||
            taskClaimReleaseSettled(records, responsibility)
          : responsibility._tag === "TaskClaimResponsibility"
            ? taskClaimAcquisitionSettled(records, responsibility)
            : settled.has(responsibility.operation.operationId)
    return settledByHistory ? [] : ["termination requires every journal responsibility to be settled"]
  })
}

/** Pure storage-boundary checks for facts not represented by the terminal event itself. */
export const terminationPreconditionIssues = (
  records: ReadonlyArray<JournalRecord>,
  runId: RunId,
  _evidence: RunFinalityEvidence
): ReadonlyArray<string> => {
  const history = reduceWorkflowJournalHistory(runId, records)
  if (history._tag === "InvalidWorkflowJournalHistory") {
    return ["termination requires a valid workflow-journal history prefix"]
  }
  const graphIssues = graphKnowledgeIssues(records)
  if (graphIssues.length > 0) return graphIssues
  return responsibilityIssues(records, history.runState.responsibility.entries)
}
