import { type RunId } from "@dalph/contracts"
import { Effect, Option } from "effect"
import { makeTaskTrackerFactsObservedFromRead } from "../workflow/protocols/task-tracker-read/protocol.js"
import { taskTrackerReadIntent } from "../workflow/registry/event.js"
import type { WorkflowOperation } from "../workflow/registry/operation.js"
import {
  InterruptibleWorkflowBoundaryIntent,
  type InterruptibleWorkflowBoundaryExecution,
  type WorkflowInterpreterService
} from "../workflow/interpretation/interpreter.js"
import {
  reconstructedTaskGraphFromEvents,
  TaskTrackerKnowledgeUnavailable
} from "../coordination/reconstruction/graph-knowledge.js"
import { intentRecordKey, outcomeRecordKey } from "./record-key.js"
import type { InRunJournalService } from "./store.js"

export const runInterruptibleBoundary = <A, E, R, B, E2, R2>(
  execution: InterruptibleWorkflowBoundaryExecution | undefined,
  intent: InterruptibleWorkflowBoundaryIntent,
  call: Effect.Effect<A, E, R>,
  recordResult: (result: A) => Effect.Effect<B, E2, R2>
): Effect.Effect<B, E | E2, R | R2> =>
  execution === undefined ? call.pipe(Effect.flatMap(recordResult)) : execution.run(intent, call, recordResult)

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
      return yield* requireTaskGraph(
        reconstructedTaskGraphFromEvents(
          records.slice(0, existingObservationIndex + 1).map(({ event }) => event),
          operation.target
        ),
        operation.operationId
      )
    }
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
    )
  })
