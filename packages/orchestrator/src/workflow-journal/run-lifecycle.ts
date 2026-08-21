/* eslint-disable functional/immutable-data -- Validation accumulates private diagnostics and graph reachability only. */
import { type RunId, type TaskId } from "@dalph/contracts"
import { Effect } from "effect"
import type { TrackerTarget } from "../authorities/task-tracker/target.js"
import { exactTaskIdSetKey, taskTrackerTargetKey } from "../authorities/task-tracker/target.js"
import { workflowJournalEventVersion } from "../workflow/kernel/event.js"
import { WorkflowRunBeganEvent, WorkflowRunTerminatedEvent } from "../workflow/registry/event.js"
import {
  type RunFinalityEvidence,
  type RunTerminationDisposition,
  requiredRunFinalityFactFamilies,
  runGraphTaskFactsOutcome
} from "../coordination/frontier/run-finality.js"
import { JournalPosition } from "./identity.js"
import { workflowRunBeganRecordKey, workflowRunTerminatedRecordKey } from "./record-key.js"
import {
  type JournalRecord,
  WorkflowRunAlreadyBegan,
  WorkflowRunAlreadyTerminated,
  WorkflowRunIdentityAlreadyUsed,
  WorkflowRunNotBegan,
  WorkflowRunTargetMismatch,
  WorkflowRunTerminationEvidenceInvalid
} from "./store.js"
import type { InitialControlPolicy } from "../control/policy.js"
import { terminationPreconditionIssues } from "./termination-preconditions.js"
import { hasLaterCompleteObservation } from "./run-termination-freshness.js"
import type {
  CompleteTaskTrackerFactsObserved,
  TaskTrackerFactsObservedEvent,
  UnchangedTaskTrackerFactsReconfirmed
} from "../workflow/task-tracker-facts/observation.js"

type FinalityObservation = CompleteTaskTrackerFactsObserved | UnchangedTaskTrackerFactsReconfirmed
type TrackerFactsObservedRecord = Omit<JournalRecord, "event"> & {
  readonly event: TaskTrackerFactsObservedEvent & { readonly observation: FinalityObservation }
}

type LifecycleTransition<A> =
  | { readonly _tag: "LifecycleTransitionAccepted"; readonly record: JournalRecord }
  | { readonly _tag: "LifecycleTransitionRejected"; readonly failure: A }

export const makeWorkflowRunBeganRecord = (
  runId: RunId,
  target: TrackerTarget,
  initialControlPolicy: InitialControlPolicy
): JournalRecord => ({
  event: WorkflowRunBeganEvent.make({
    initialControlPolicy,
    initiatedBy: { _tag: "DalphCoordinator" },
    occurrenceClassification: "InitiatedAction",
    target,
    version: workflowJournalEventVersion
  }),
  key: workflowRunBeganRecordKey,
  position: JournalPosition.make(1),
  runId
})

export const makeWorkflowRunTerminatedRecord = (
  runId: RunId,
  position: JournalPosition,
  disposition: RunTerminationDisposition,
  evidence: RunFinalityEvidence
): JournalRecord => ({
  event: WorkflowRunTerminatedEvent.make({
    disposition,
    evidence,
    occurrenceClassification: "NonActionOccurrence",
    version: workflowJournalEventVersion
  }),
  key: workflowRunTerminatedRecordKey,
  position,
  runId
})

/** Decides the only legal first lifecycle transition without performing persistence. */
export const decideWorkflowRunBeginning = (
  records: ReadonlyArray<JournalRecord>,
  runId: RunId,
  target: TrackerTarget,
  initialControlPolicy: InitialControlPolicy
): LifecycleTransition<WorkflowRunAlreadyBegan | WorkflowRunIdentityAlreadyUsed> => {
  const began = records.find(({ event }) => event._tag === "WorkflowRunBegan")
  if (began !== undefined) {
    return {
      _tag: "LifecycleTransitionRejected",
      failure: new WorkflowRunAlreadyBegan({ beganAt: began.position, runId })
    }
  }
  const first = records[0]
  return first === undefined
    ? { _tag: "LifecycleTransitionAccepted", record: makeWorkflowRunBeganRecord(runId, target, initialControlPolicy) }
    : {
        _tag: "LifecycleTransitionRejected",
        failure: new WorkflowRunIdentityAlreadyUsed({ firstRecordAt: first.position, runId })
      }
}

/** Decides the only legal final lifecycle transition without performing persistence. */
export const decideWorkflowRunTermination = (
  records: ReadonlyArray<JournalRecord>,
  runId: RunId,
  disposition: RunTerminationDisposition,
  evidence: RunFinalityEvidence
): LifecycleTransition<WorkflowRunAlreadyTerminated | WorkflowRunNotBegan | WorkflowRunTerminationEvidenceInvalid> => {
  const began = records.find(({ event }) => event._tag === "WorkflowRunBegan")
  if (began === undefined) {
    return { _tag: "LifecycleTransitionRejected", failure: new WorkflowRunNotBegan({ runId }) }
  }
  const terminated = records.find(({ event }) => event._tag === "WorkflowRunTerminated")
  if (terminated !== undefined) {
    return {
      _tag: "LifecycleTransitionRejected",
      failure: new WorkflowRunAlreadyTerminated({ runId, terminatedAt: terminated.position })
    }
  }
  const terminationPosition = JournalPosition.make(records.length + 1)
  const invalidEvidence = terminationEvidenceIssues(records, runId, disposition, evidence, terminationPosition)[0]
  const invalidPrecondition =
    invalidEvidence === undefined ? terminationPreconditionIssues(records, runId, evidence)[0] : undefined
  if (invalidEvidence !== undefined || invalidPrecondition !== undefined) {
    return {
      _tag: "LifecycleTransitionRejected",
      failure: new WorkflowRunTerminationEvidenceInvalid({
        detail: invalidEvidence ?? invalidPrecondition ?? "termination evidence is invalid",
        runId
      })
    }
  }
  return {
    _tag: "LifecycleTransitionAccepted",
    record: makeWorkflowRunTerminatedRecord(runId, terminationPosition, disposition, evidence)
  }
}

/**
 * Rechecks terminal evidence at the storage boundary. Runtime projections are
 * advisory; the append may proceed only when this immutable journal prefix
 * contains the named read intent and the exact complete observation it proved.
 */
const observedFinalityRecord = (
  records: ReadonlyArray<JournalRecord>,
  evidence: RunFinalityEvidence,
  terminationPosition: JournalPosition
): TrackerFactsObservedRecord | undefined => {
  const observed = records.find(
    (candidate): candidate is TrackerFactsObservedRecord =>
      candidate.position === evidence.observedAt &&
      candidate.event._tag === "TaskTrackerFactsObserved" &&
      (candidate.event.observation._tag === "CompleteTaskTrackerFacts" ||
        candidate.event.observation._tag === "UnchangedTaskTrackerFactsReconfirmed")
  )
  if (observed === undefined || observed.position >= terminationPosition) {
    return undefined
  }
  return observed
}

const completeObservationFor = (
  records: ReadonlyArray<JournalRecord>,
  observed: TrackerFactsObservedRecord
): CompleteTaskTrackerFactsObserved | undefined => {
  const freshObservation = observed.event.observation
  if (freshObservation._tag === "CompleteTaskTrackerFacts") return freshObservation
  const complete = records.find(({ event }) => {
    if (event._tag !== "TaskTrackerFactsObserved") return false
    return (
      event.operationId === freshObservation.priorFullObservationOperationId &&
      event.observation._tag === "CompleteTaskTrackerFacts"
    )
  })
  return complete?.event._tag === "TaskTrackerFactsObserved" &&
    complete.event.observation._tag === "CompleteTaskTrackerFacts"
    ? complete.event.observation
    : undefined
}

/** Returns the first tracker-resolved root for this target; later reads may change graph membership but not Run input. */
const firstObservedRootTaskIdFor = (
  records: ReadonlyArray<JournalRecord>,
  target: TrackerTarget
): TaskId | undefined => {
  const first = records.find(
    (candidate): candidate is TrackerFactsObservedRecord =>
      candidate.event._tag === "TaskTrackerFactsObserved" &&
      ["CompleteTaskTrackerFacts", "UnchangedTaskTrackerFactsReconfirmed"].includes(candidate.event.observation._tag) &&
      taskTrackerTargetKey(candidate.event.observation.target) === taskTrackerTargetKey(target)
  )
  return first === undefined ? undefined : completeObservationFor(records, first)?.rootTaskId
}

const readIntentIssues = (
  records: ReadonlyArray<JournalRecord>,
  evidence: RunFinalityEvidence
): ReadonlyArray<string> => {
  const intent = records.find(
    ({ event }) =>
      event._tag === "TaskTrackerReadIntentRecorded" && event.operation.operationId === evidence.operationId
  )
  if (intent?.event._tag !== "TaskTrackerReadIntentRecorded" || intent.event.operation._tag !== "ReadTrackerGraph") {
    return ["termination evidence must name the exact complete graph-read intent"]
  }
  return taskTrackerTargetKey(intent.event.operation.target) !== taskTrackerTargetKey(evidence.target) ||
    exactTaskIdSetKey(intent.event.operation.readShape.explicitlyCoveredTaskIds) !==
      exactTaskIdSetKey(evidence.readShape.explicitlyCoveredTaskIds)
    ? ["termination evidence read shape or target does not match its graph-read intent"]
    : []
}

const freshObservationIssues = (
  freshObservation: FinalityObservation,
  evidence: RunFinalityEvidence
): ReadonlyArray<string> =>
  [
    freshObservation.operationId !== evidence.operationId ||
    taskTrackerTargetKey(freshObservation.target) !== taskTrackerTargetKey(evidence.target)
      ? "termination evidence operation or target does not match the observed graph"
      : undefined,
    freshObservation.factFamilies.some(
      ({ contentIdentity, coverage }) =>
        contentIdentity !== evidence.contentIdentity ||
        taskTrackerTargetKey(coverage.target) !== taskTrackerTargetKey(evidence.target) ||
        exactTaskIdSetKey(coverage.explicitlyCoveredTaskIds) !==
          exactTaskIdSetKey(evidence.coverage.explicitlyCoveredTaskIds)
    )
      ? "termination evidence does not match the fresh observation's identity and coverage"
      : undefined
  ].filter((issue): issue is string => issue !== undefined)

const completeFactFamilyIssues = (
  observation: CompleteTaskTrackerFactsObserved,
  evidence: RunFinalityEvidence
): ReadonlyArray<string> => {
  const [, , , groupings] = observation.factFamilies
  // A reconfirmation may widen its explicit closure while retaining the earlier full facts.
  // freshObservationIssues validates the terminal read's exact target and coverage.
  return [
    evidence.requiredFactFamilies.some((family, index) => family !== requiredRunFinalityFactFamilies[index])
      ? "termination evidence must include every complete graph fact family"
      : undefined,
    evidence.rootTaskId !== observation.rootTaskId
      ? "termination evidence must retain the exact tracker-selected Run root"
      : undefined,
    !groupings.groupings.some(({ taskId }) => taskId === evidence.rootTaskId)
      ? "termination evidence Run root must belong to the complete grouping facts"
      : undefined
  ].filter((issue): issue is string => issue !== undefined)
}

const completeGraphOutcomeIssues = (
  observation: CompleteTaskTrackerFactsObserved,
  evidence: RunFinalityEvidence
): ReadonlyArray<string> => {
  const issues: Array<string> = []
  const [identities, lifecycles] = observation.factFamilies
  const prerequisitesByTaskId = new Map(
    observation.factFamilies[2].prerequisites.map(({ prerequisiteTaskIds, taskId }) => [taskId, prerequisiteTaskIds])
  )
  const graphFacts = runGraphTaskFactsOutcome(
    lifecycles.lifecycles.map(({ lifecycle, taskId }) => ({
      id: taskId,
      lifecycle,
      prerequisiteIds: prerequisitesByTaskId.get(taskId) ?? []
    }))
  )
  if (evidence.contentIdentity !== identities.contentIdentity || evidence.graphOutcome !== graphFacts.graphOutcome) {
    issues.push("termination evidence revision or graph outcome is not current")
  }
  if (exactTaskIdSetKey(evidence.terminalTaskIds) !== exactTaskIdSetKey(graphFacts.terminalTaskIds)) {
    issues.push("termination evidence terminal task facts do not match the graph")
  }
  if (exactTaskIdSetKey(evidence.blockedTaskIds) !== exactTaskIdSetKey(graphFacts.blockedTaskIds)) {
    issues.push("termination evidence dependency blockage facts do not match the graph")
  }
  return issues
}

const completeObservationIssues = (
  observation: CompleteTaskTrackerFactsObserved,
  evidence: RunFinalityEvidence
): ReadonlyArray<string> => [
  ...completeFactFamilyIssues(observation, evidence),
  ...completeGraphOutcomeIssues(observation, evidence)
]

const dispositionIssues = (
  records: ReadonlyArray<JournalRecord>,
  disposition: RunTerminationDisposition,
  graphOutcome: RunFinalityEvidence["graphOutcome"]
): ReadonlyArray<string> => {
  const cancellationApplied = records.some(({ event }) => event._tag === "RunCancellationApplied")
  const expected =
    graphOutcome === "AllTasksSucceeded"
      ? "Completed"
      : cancellationApplied
        ? "Cancelled"
        : graphOutcome === "Blocked"
          ? "Blocked"
          : undefined
  return expected === disposition
    ? []
    : ["termination disposition does not follow graph evidence and cancellation precedence"]
}

const cancellationEvidenceIssues = (
  records: ReadonlyArray<JournalRecord>,
  evidence: RunFinalityEvidence
): ReadonlyArray<string> => {
  const cancellation = records.findLast(({ event }) => event._tag === "RunCancellationApplied")
  return cancellation !== undefined && evidence.observedAt <= cancellation.position
    ? ["cancellation terminal evidence must use a graph observation after RunCancellationApplied"]
    : []
}

const basicEvidenceIssues = (
  runId: RunId,
  beganTarget: TrackerTarget,
  evidence: RunFinalityEvidence
): ReadonlyArray<string> => {
  const issues: Array<string> = []
  if (evidence.runId !== runId) issues.push("termination evidence must name the journal Run")
  if (taskTrackerTargetKey(evidence.target) !== taskTrackerTargetKey(beganTarget)) {
    issues.push("termination evidence must name the beginning target")
  }
  if (!evidence.complete || evidence.rootTaskId.length === 0) {
    issues.push("termination evidence must prove complete root coverage")
  }
  return issues
}

const initialTerminationEvidence = (
  records: ReadonlyArray<JournalRecord>,
  runId: RunId,
  evidence: RunFinalityEvidence,
  terminationPosition: JournalPosition
) => {
  const began = records.find(({ event }) => event._tag === "WorkflowRunBegan")
  if (began?.event._tag !== "WorkflowRunBegan") {
    return { issues: ["termination evidence requires the exact Run beginning"] }
  }
  const issues: Array<string> = [...basicEvidenceIssues(runId, began.event.target, evidence)]
  const observed = observedFinalityRecord(records, evidence, terminationPosition)
  if (observed === undefined) {
    return {
      issues: [
        ...issues,
        "termination evidence must name one earlier complete or unchanged tracker observation position"
      ]
    }
  }
  const observation = completeObservationFor(records, observed)
  if (observation === undefined) {
    return {
      issues: [...issues, "unchanged termination evidence must link to its earlier complete tracker observation"]
    }
  }
  return { issues, observed, observation }
}

const terminationEvidenceIssues = (
  records: ReadonlyArray<JournalRecord>,
  runId: RunId,
  disposition: RunTerminationDisposition,
  evidence: RunFinalityEvidence | undefined,
  terminationPosition: JournalPosition
): ReadonlyArray<string> => {
  if (evidence === undefined) return ["termination evidence is required"]
  const initial = initialTerminationEvidence(records, runId, evidence, terminationPosition)
  if (initial.observed === undefined) return initial.issues
  const { observation, observed } = initial
  const issues: Array<string> = [...initial.issues]
  issues.push(...readIntentIssues(records, evidence))
  issues.push(...freshObservationIssues(observed.event.observation, evidence))
  issues.push(...completeObservationIssues(observation, evidence))
  const firstRootTaskId = firstObservedRootTaskIdFor(records, evidence.target)
  if (firstRootTaskId === undefined || firstRootTaskId !== evidence.rootTaskId) {
    issues.push("termination evidence must retain the first tracker-selected Run root")
  }
  issues.push(...dispositionIssues(records, disposition, evidence.graphOutcome))
  issues.push(...cancellationEvidenceIssues(records, evidence))
  if (hasLaterCompleteObservation(records, evidence, terminationPosition)) {
    issues.push("termination evidence must use the latest complete graph observation")
  }
  return issues
}

/** Rereads the journal facts required to retain and validate an already-established Run. */
export const readRecoverableRunBeginning = Effect.fn("WorkflowRunLifecycle.readRecoverableBeginning")(function* (
  records: ReadonlyArray<JournalRecord>,
  runId: RunId,
  target: TrackerTarget
) {
  const began = records.find(({ event }) => event._tag === "WorkflowRunBegan")
  if (began?.event._tag !== "WorkflowRunBegan") {
    return yield* new WorkflowRunNotBegan({ runId })
  }
  const terminated = records.find(({ event }) => event._tag === "WorkflowRunTerminated")
  if (terminated !== undefined) {
    return yield* new WorkflowRunAlreadyTerminated({ runId, terminatedAt: terminated.position })
  }
  if (taskTrackerTargetKey(began.event.target) !== taskTrackerTargetKey(target)) {
    return yield* new WorkflowRunTargetMismatch({ recordedTarget: began.event.target, requestedTarget: target, runId })
  }
  return began
})
