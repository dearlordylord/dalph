import { type RunId } from "@dalph/contracts"
import { Effect, Option } from "effect"
import type {
  FixtureReadError,
  TrackerAdapterReadError,
  TrackerReadError
} from "../authorities/task-tracker/graph-reader.js"
import type { GraphProjectionError } from "../authorities/task-tracker/graph.js"
import {
  TaskTrackerFactsReadFailed,
  TaskTrackerFactsReadUnavailable,
  taskTrackerFactsObservedEvent,
  type TaskTrackerFactsReadFailed as TaskTrackerFactsReadFailedObservation
} from "../workflow/task-tracker-facts/observation.js"
import { makeTaskTrackerFactsObservedFromRead } from "../workflow/protocols/task-tracker-read/protocol.js"
import { taskTrackerReadIntent } from "../workflow/registry/event.js"
import type { WorkflowOperation } from "../workflow/registry/operation.js"
import {
  InterruptibleWorkflowBoundaryIntent,
  runInterruptibleBoundary,
  type InterruptibleWorkflowBoundaryExecution,
  type WorkflowInterpreterService
} from "../workflow/interpretation/interpreter.js"
import {
  reconstructedTaskGraphFromEvents,
  TaskTrackerKnowledgeUnavailable
} from "../coordination/reconstruction/graph-knowledge.js"
import { intentRecordKey, outcomeRecordKey } from "./record-key.js"
import type { InRunJournalService } from "./store.js"

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
    const key = intentRecordKey(operation.operationId)
    yield* Effect.uninterruptible(
      journal.append(runId, key, taskTrackerReadIntent(operation)).pipe(Effect.andThen(onIntentRecorded))
    )
    const records = yield* journal.read(runId)
    const existingObservationIndex = records.findIndex(
      ({ event }) => event._tag === "TaskTrackerFactsObserved" && event.operationId === operation.operationId
    )
    if (existingObservationIndex >= 0) {
      const existing = records[existingObservationIndex]?.event
      if (existing?._tag === "TaskTrackerFactsObserved" && existing.observation._tag === "TaskTrackerFactsReadFailed") {
        return yield* new TaskTrackerFactsReadUnavailable({ observation: existing.observation })
      }
      return yield* requireTaskGraph(
        reconstructedTaskGraphFromEvents(
          records.slice(0, existingObservationIndex + 1).map(({ event }) => event),
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
          yield* journal.append(
            runId,
            outcomeRecordKey(operation.operationId),
            makeTaskTrackerFactsObservedFromRead(records, operation, snapshot)
          )
          const recorded = yield* journal.read(runId)
          return yield* requireTaskGraph(
            reconstructedTaskGraphFromEvents(
              recorded.map(({ event }) => event),
              operation.target
            ),
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
