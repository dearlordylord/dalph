/* eslint-disable functional/immutable-data -- Validation accumulates private diagnostics and graph reachability only. */
import { type RunId } from "@dalph/contracts"
import { Effect } from "effect"
import type { TrackerTarget } from "../authorities/task-tracker/target.js"
import { exactTaskIdSetKey, taskTrackerTargetKey } from "../authorities/task-tracker/target.js"
import { workflowJournalEventVersion } from "../workflow/kernel/event.js"
import { WorkflowRunBeganEvent, WorkflowRunTerminatedEvent } from "../workflow/registry/event.js"
import {
  type RunFinalityEvidence,
  type RunTerminationDisposition,
  requiredRunFinalityFactFamilies
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
  const invalidEvidence = terminationEvidenceIssues(records, runId, disposition, evidence, records.length + 1)[0]
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
    record: makeWorkflowRunTerminatedRecord(runId, JournalPosition.make(records.length + 1), disposition, evidence)
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
  terminationPosition: number
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
): ReadonlyArray<string> => {
  const issues: Array<string> = []
  if (
    freshObservation.operationId !== evidence.operationId ||
    taskTrackerTargetKey(freshObservation.target) !== taskTrackerTargetKey(evidence.target)
  ) {
    issues.push("termination evidence operation or target does not match the observed graph")
  }
  if (
    freshObservation.factFamilies.some(
      ({ contentIdentity, coverage }) =>
        contentIdentity !== evidence.contentIdentity ||
        taskTrackerTargetKey(coverage.target) !== taskTrackerTargetKey(evidence.target) ||
        exactTaskIdSetKey(coverage.explicitlyCoveredTaskIds) !==
          exactTaskIdSetKey(evidence.coverage.explicitlyCoveredTaskIds)
    )
  ) {
    issues.push("termination evidence does not match the fresh observation's identity and coverage")
  }
  return issues
}

const blockedTaskIdsFor = (
  observation: CompleteTaskTrackerFactsObserved
): ReadonlySet<RunFinalityEvidence["blockedTaskIds"][number]> => {
  const [, lifecycles, prerequisites] = observation.factFamilies
  const blockedTaskIds = new Set(
    lifecycles.lifecycles
      .filter(({ lifecycle }) => lifecycle._tag === "TerminalWithoutSuccess")
      .map(({ taskId }) => taskId)
  )
  let changed = true
  while (changed) {
    changed = false
    for (const { prerequisiteTaskIds, taskId } of prerequisites.prerequisites) {
      if (!blockedTaskIds.has(taskId) && prerequisiteTaskIds.some((id) => blockedTaskIds.has(id))) {
        blockedTaskIds.add(taskId)
        changed = true
      }
    }
  }
  return blockedTaskIds
}

const completeFactFamilyIssues = (
  observation: CompleteTaskTrackerFactsObserved,
  evidence: RunFinalityEvidence
): ReadonlyArray<string> => {
  const issues: Array<string> = []
  const [, , , groupings] = observation.factFamilies
  if (evidence.requiredFactFamilies.some((family, index) => family !== requiredRunFinalityFactFamilies[index])) {
    issues.push("termination evidence must include every complete graph fact family")
  }
  if (
    observation.factFamilies.some(
      ({ coverage }) =>
        taskTrackerTargetKey(coverage.target) !== taskTrackerTargetKey(evidence.target) ||
        exactTaskIdSetKey(coverage.explicitlyCoveredTaskIds) !==
          exactTaskIdSetKey(evidence.coverage.explicitlyCoveredTaskIds)
    )
  ) {
    issues.push("termination evidence must match every fact-family target and coverage")
  }
  if (evidence.rootPresent !== groupings.groupings.some(({ parentTaskId }) => parentTaskId === null)) {
    issues.push("termination evidence root presence does not match the complete grouping facts")
  }
  return issues
}

const completeGraphOutcomeIssues = (
  observation: CompleteTaskTrackerFactsObserved,
  evidence: RunFinalityEvidence
): ReadonlyArray<string> => {
  const issues: Array<string> = []
  const [identities, lifecycles] = observation.factFamilies
  const terminalTaskIds = lifecycles.lifecycles
    .filter(({ lifecycle }) => lifecycle._tag === "TerminalWithoutSuccess")
    .map(({ taskId }) => taskId)
    .toSorted()
  const blockedTaskIds = blockedTaskIdsFor(observation)
  const allSucceeded = lifecycles.lifecycles.every(({ lifecycle }) => lifecycle._tag === "CompletedSuccessfully")
  const allSettledBySuccessOrBlockage = lifecycles.lifecycles.every(
    ({ lifecycle, taskId }) => lifecycle._tag === "CompletedSuccessfully" || blockedTaskIds.has(taskId)
  )
  const graphOutcome = allSucceeded
    ? "AllTasksSucceeded"
    : terminalTaskIds.length > 0 && allSettledBySuccessOrBlockage
      ? "Blocked"
      : "Unsettled"
  if (evidence.contentIdentity !== identities.contentIdentity || evidence.graphOutcome !== graphOutcome) {
    issues.push("termination evidence revision or graph outcome is not current")
  }
  if (exactTaskIdSetKey(evidence.terminalTaskIds) !== exactTaskIdSetKey(terminalTaskIds)) {
    issues.push("termination evidence terminal task facts do not match the graph")
  }
  if (exactTaskIdSetKey(evidence.blockedTaskIds) !== exactTaskIdSetKey([...blockedTaskIds])) {
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
  if (!evidence.complete || !evidence.rootPresent) issues.push("termination evidence must prove complete root coverage")
  return issues
}

const hasLaterCompleteObservation = (
  records: ReadonlyArray<JournalRecord>,
  evidence: RunFinalityEvidence,
  terminationPosition: number
): boolean =>
  records.some(({ event, position }) => {
    if (
      position <= evidence.observedAt ||
      position >= terminationPosition ||
      event._tag !== "TaskTrackerFactsObserved"
    ) {
      return false
    }
    return (
      event.observation._tag === "CompleteTaskTrackerFacts" ||
      event.observation._tag === "UnchangedTaskTrackerFactsReconfirmed"
    )
  })

const terminationEvidenceIssues = (
  records: ReadonlyArray<JournalRecord>,
  runId: RunId,
  disposition: RunTerminationDisposition,
  evidence: RunFinalityEvidence | undefined,
  terminationPosition: number
): ReadonlyArray<string> => {
  if (evidence === undefined) return ["termination evidence is required"]
  const began = records.find(({ event }) => event._tag === "WorkflowRunBegan")
  if (began?.event._tag !== "WorkflowRunBegan") return ["termination evidence requires the exact Run beginning"]
  const issues: Array<string> = [...basicEvidenceIssues(runId, began.event.target, evidence)]
  const observed = observedFinalityRecord(records, evidence, terminationPosition)
  if (observed === undefined) {
    issues.push("termination evidence must name one earlier complete or unchanged tracker observation position")
    return issues
  }
  const observation = completeObservationFor(records, observed)
  if (observation === undefined) {
    issues.push("unchanged termination evidence must link to its earlier complete tracker observation")
    return issues
  }
  issues.push(...readIntentIssues(records, evidence))
  issues.push(...freshObservationIssues(observed.event.observation, evidence))
  issues.push(...completeObservationIssues(observation, evidence))
  issues.push(...dispositionIssues(records, disposition, evidence.graphOutcome))
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
