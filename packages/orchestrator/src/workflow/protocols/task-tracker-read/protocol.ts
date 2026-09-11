import { Effect, Option, Schema } from "effect"
import { type RunId } from "@dalph/contracts"
import type {
  FixtureReadError,
  TrackerAdapterReadError,
  TrackerReadError
} from "../../../authorities/task-tracker/graph-reader.js"
import { type GraphProjectionError, type TaskDagSnapshot } from "../../../authorities/task-tracker/graph.js"
import { exactTaskIdSetKey, taskTrackerTargetKey } from "../../../authorities/task-tracker/target.js"
import {
  type CompleteTaskTrackerFactsObserved,
  CompleteTargetClosureCoverage,
  makeCompleteTaskTrackerFactsObserved,
  TaskGroupingsReconfirmed,
  TaskIdentitiesReconfirmed,
  TaskLifecyclesReconfirmed,
  TaskPrerequisitesReconfirmed,
  TaskTrackerFactsObservedEvent,
  TaskTrackerFactsReadFailed,
  TaskTrackerFactsReadUnavailable,
  taskTrackerFactsObservedEvent,
  TaskTargetMembershipReconfirmed,
  type UnchangedTaskTrackerFactsReconfirmed,
  UnchangedTaskTrackerFactsReconfirmed as UnchangedTaskTrackerFactsReconfirmedSchema,
  type TaskTrackerFactsReadFailed as TaskTrackerFactsReadFailedObservation
} from "../../task-tracker-facts/observation.js"
import { type WorkflowOperation } from "../../registry/operation.js"
import { taskTrackerReadIntent } from "../../registry/event.js"
import {
  reconstructedTaskGraphFromEvents,
  TaskTrackerKnowledgeUnavailable
} from "../../../coordination/reconstruction/graph-knowledge.js"
import {
  InterruptibleWorkflowBoundaryIntent,
  runInterruptibleBoundary,
  type InterruptibleWorkflowBoundaryExecution,
  type WorkflowInterpreterService
} from "../../interpretation/interpreter.js"
import { intentRecordKey, outcomeRecordKey } from "../../../workflow-journal/record-key.js"
import type { InRunJournalService, JournalRecord } from "../../../workflow-journal/store.js"
import { AcceptedJournalReader } from "../../../workflow-journal/accepted-reader.js"
import {
  journalEvidenceBefore,
  journalRecordByKey,
  journalRecordsOfKind,
  type JournalRecordEvidence,
  type JournalHistorySource
} from "../../../workflow-journal/record-evidence.js"

const fullObservationFromEvent = (event: unknown): Option.Option<CompleteTaskTrackerFactsObserved> =>
  Option.flatMap(Schema.decodeUnknownOption(TaskTrackerFactsObservedEvent)(event), ({ observation }) =>
    observation._tag === "CompleteTaskTrackerFacts" ? Option.some(observation) : Option.none()
  )

type TaskTrackerObservationHistory = ReadonlyArray<{ readonly event: unknown }> | JournalRecordEvidence

const isIndexedTaskTrackerObservationHistory = (
  records: TaskTrackerObservationHistory
): records is JournalRecordEvidence => !Array.isArray(records)

const taskTrackerFactEvents = function* (records: TaskTrackerObservationHistory): Iterable<unknown> {
  const candidates = isIndexedTaskTrackerObservationHistory(records)
    ? journalRecordsOfKind(records, "TaskTrackerFactsObserved")
    : records
  for (const { event } of candidates) yield event
}

const graphReconstructionEvents = (
  records: JournalHistorySource,
  event: Extract<JournalRecord["event"], { readonly _tag: "TaskTrackerFactsObserved" }>
): ReadonlyArray<TaskTrackerFactsObservedEvent> => {
  const observation = event.observation
  if (observation._tag !== "UnchangedTaskTrackerFactsReconfirmed") return [event]
  const prior = journalRecordByKey(records, outcomeRecordKey(observation.priorFullObservationOperationId))
  return prior?.event._tag === "TaskTrackerFactsObserved" ? [prior.event, event] : [event]
}

const comparableFullObservation = (
  records: TaskTrackerObservationHistory,
  complete: CompleteTaskTrackerFactsObserved
): CompleteTaskTrackerFactsObserved | undefined => {
  let found: CompleteTaskTrackerFactsObserved | undefined
  for (const event of taskTrackerFactEvents(records)) {
    const prior = Option.getOrUndefined(fullObservationFromEvent(event))
    if (
      prior !== undefined &&
      prior.operationId !== complete.operationId &&
      taskTrackerTargetKey(prior.target) === taskTrackerTargetKey(complete.target) &&
      prior.rootTaskId === complete.rootTaskId &&
      exactTaskIdSetKey(prior.factFamilies[0].taskIds) === exactTaskIdSetKey(complete.factFamilies[0].taskIds)
    )
      found = prior
  }
  return found
}

const makeUnchangedReconfirmation = (
  operation: typeof WorkflowOperation.cases.ReadTrackerGraph.Type,
  complete: CompleteTaskTrackerFactsObserved,
  prior: CompleteTaskTrackerFactsObserved
): UnchangedTaskTrackerFactsReconfirmed => {
  const [identities, lifecycles, prerequisites, groupings, membership] = complete.factFamilies
  const evidence = {
    completeness: "Complete" as const,
    consistency: "PotentiallyMixedTime" as const,
    contentIdentity: identities.contentIdentity,
    freshness: { _tag: "ObservedDuringLogicalRead" as const, operationId: operation.operationId }
  }
  const coverage = CompleteTargetClosureCoverage.make({
    explicitlyCoveredTaskIds: operation.readShape.explicitlyCoveredTaskIds,
    target: operation.target
  })
  return UnchangedTaskTrackerFactsReconfirmedSchema.make({
    factFamilies: [
      TaskIdentitiesReconfirmed.make({ ...evidence, coverage, target: identities.target }),
      TaskLifecyclesReconfirmed.make({ ...evidence, coverage, subjectTaskIds: lifecycles.subjectTaskIds }),
      TaskPrerequisitesReconfirmed.make({ ...evidence, coverage, subjectTaskIds: prerequisites.subjectTaskIds }),
      TaskGroupingsReconfirmed.make({ ...evidence, coverage, subjectTaskIds: groupings.subjectTaskIds }),
      TaskTargetMembershipReconfirmed.make({ ...evidence, coverage, target: membership.target })
    ],
    operationId: operation.operationId,
    priorFullObservationOperationId: prior.operationId,
    ...(complete.rootTaskId === undefined ? {} : { rootTaskId: complete.rootTaskId }),
    target: operation.target
  })
}

/** Chooses a complete payload or compact unchanged reconfirmation for one read. */
export const makeTaskTrackerFactsObservedFromRead = (
  records: TaskTrackerObservationHistory,
  operation: typeof WorkflowOperation.cases.ReadTrackerGraph.Type,
  snapshot: TaskDagSnapshot
): TaskTrackerFactsObservedEvent => {
  const complete = makeCompleteTaskTrackerFactsObserved(operation, snapshot)
  const prior = comparableFullObservation(records, complete)
  const unchanged =
    prior !== undefined && prior.factFamilies[0].contentIdentity === complete.factFamilies[0].contentIdentity
  return taskTrackerFactsObservedEvent(
    operation.operationId,
    unchanged ? makeUnchangedReconfirmation(operation, complete, prior) : complete
  )
}

type TrackerGraphReadFailure = FixtureReadError | GraphProjectionError | TrackerAdapterReadError | TrackerReadError

const readFailureObservation = (
  operation: typeof WorkflowOperation.cases.ReadTrackerGraph.Type,
  failure: TrackerGraphReadFailure
): TaskTrackerFactsReadFailedObservation => {
  const detail =
    failure._tag === "TaskDag.GraphProjectionError"
      ? failure.issues.map((issue) => JSON.stringify(issue)).join("; ")
      : failure.detail
  const mapped =
    failure._tag === "FixtureReader.FixtureReadError"
      ? { _tag: "FixtureReadError" as const, detail }
      : failure._tag === "TaskDag.GraphProjectionError"
        ? { _tag: "GraphProjectionError" as const, detail }
        : failure._tag === "TrackerGraphReader.AdapterReadError"
          ? { _tag: "TrackerAdapterReadError" as const, detail, reason: failure.reason }
          : { _tag: "TrackerReadError" as const, detail }
  return TaskTrackerFactsReadFailed.make({
    completeness: "Unreadable",
    failure: mapped,
    operationId: operation.operationId,
    target: operation.target
  })
}

const requireTaskGraph = <A>(
  knowledge: Option.Option<A>,
  operationId: (typeof WorkflowOperation.cases.ReadTrackerGraph.Type)["operationId"]
): Effect.Effect<A, TaskTrackerKnowledgeUnavailable> =>
  Option.match(knowledge, {
    onNone: () => Effect.fail(new TaskTrackerKnowledgeUnavailable({ knowledge: "TaskGraph", operationId })),
    onSome: Effect.succeed
  })

/** Records one complete tracker graph read and its typed unreadable outcome. */
export const journaledTrackerGraphRead = (
  runId: RunId,
  interpreter: WorkflowInterpreterService,
  journal: InRunJournalService
) =>
  Effect.fn("WorkflowInterpreter.Journaled.readTrackerGraph")(function* (
    operation: typeof WorkflowOperation.cases.ReadTrackerGraph.Type,
    onIntentRecorded: Effect.Effect<void> = Effect.void,
    interruptibleBoundary?: InterruptibleWorkflowBoundaryExecution
  ) {
    const acceptedJournal = yield* AcceptedJournalReader
    const key = intentRecordKey(operation.operationId)
    yield* Effect.uninterruptible(
      journal.append(runId, key, taskTrackerReadIntent(operation)).pipe(Effect.andThen(onIntentRecorded))
    )
    const records = yield* acceptedJournal.readAccepted(runId)
    const existingRecord = journalRecordByKey(records, outcomeRecordKey(operation.operationId))
    if (existingRecord?.event._tag === "TaskTrackerFactsObserved") {
      const existing = existingRecord.event
      if (existing.observation._tag === "TaskTrackerFactsReadFailed") {
        return yield* new TaskTrackerFactsReadUnavailable({ observation: existing.observation })
      }
      return yield* requireTaskGraph(
        reconstructedTaskGraphFromEvents(
          graphReconstructionEvents(journalEvidenceBefore(records, existingRecord.position + 1), existing),
          operation.target
        ),
        operation.operationId
      )
    }
    const recordReadFailure = (failure: TrackerGraphReadFailure) =>
      Effect.gen(function* () {
        const observation = readFailureObservation(operation, failure)
        yield* journal.append(
          runId,
          outcomeRecordKey(operation.operationId),
          taskTrackerFactsObservedEvent(operation.operationId, observation)
        )
        return yield* failure
      })
    return yield* runInterruptibleBoundary(
      interruptibleBoundary,
      InterruptibleWorkflowBoundaryIntent.AuthorityRequest({
        family: "TaskTracker",
        operationId: operation.operationId
      }),
      interpreter.readTrackerGraph(operation),
      (snapshot) =>
        Effect.gen(function* () {
          const observed = makeTaskTrackerFactsObservedFromRead(records, operation, snapshot)
          yield* journal.append(runId, outcomeRecordKey(operation.operationId), observed)
          const recorded = yield* acceptedJournal.readAccepted(runId)
          return yield* requireTaskGraph(
            reconstructedTaskGraphFromEvents(graphReconstructionEvents(recorded, observed), operation.target),
            operation.operationId
          )
        })
    ).pipe(
      Effect.catchTags({
        "FixtureReader.FixtureReadError": recordReadFailure,
        "TaskDag.GraphProjectionError": recordReadFailure,
        "TrackerGraphReader.AdapterReadError": recordReadFailure,
        "TrackerGraphReader.TrackerReadError": recordReadFailure
      })
    )
  })
