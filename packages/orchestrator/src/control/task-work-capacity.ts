import { RunId } from "@dalph/contracts"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { TaskWorkCapacity } from "../coordination/admission/capacity.js"
import { reduceWorkflowJournalHistory } from "../coordination/reconstruction/history.js"
import { workflowJournalEventVersion } from "../workflow/kernel/event.js"
import { TaskWorkCapacityChangedEvent } from "../workflow/registry/event.js"
import { taskWorkCapacityPolicyRecordKey } from "../workflow-journal/record-key.js"
import {
  type JournalAppendError,
  type JournalReadError,
  InRunJournal,
  WorkflowRunNotBegan
} from "../workflow-journal/store.js"
import { RunControlPolicy, RunPolicyRevision } from "./policy.js"

export const SetTaskWorkCapacityRequest = Schema.Struct({
  capacity: TaskWorkCapacity,
  expectedRevision: RunPolicyRevision,
  runId: RunId
})
export type SetTaskWorkCapacityRequest = typeof SetTaskWorkCapacityRequest.Type

/** The Operator named an older durable Run policy than the journal currently contains. */
export class TaskWorkCapacityPolicyRevisionConflict extends Schema.TaggedErrorClass<TaskWorkCapacityPolicyRevisionConflict>()(
  "TaskWorkCapacityPolicyRevisionConflict",
  { current: RunControlPolicy, expectedRevision: RunPolicyRevision, runId: RunId }
) {}

type InvalidWorkflowJournalHistory = Extract<
  ReturnType<typeof reduceWorkflowJournalHistory>,
  { readonly _tag: "InvalidWorkflowJournalHistory" }
>

interface TaskWorkCapacityControlService {
  readonly apply: (
    input: unknown
  ) => Effect.Effect<
    RunControlPolicy,
    | InvalidWorkflowJournalHistory
    | JournalAppendError
    | Schema.SchemaError
    | TaskWorkCapacityPolicyRevisionConflict
    | WorkflowRunNotBegan
  >
  readonly read: (
    runId: RunId
  ) => Effect.Effect<RunControlPolicy, InvalidWorkflowJournalHistory | JournalReadError | WorkflowRunNotBegan>
}

/** Decodes, journals, and reconstructs one Run's Operator-applied task-work capacity. */
export class TaskWorkCapacityControl extends Context.Service<TaskWorkCapacityControl, TaskWorkCapacityControlService>()(
  "@dalph/TaskWorkCapacityControl"
) {}

export const reconstructTaskWorkCapacityPolicy = Effect.fn("TaskWorkCapacityControl.reconstruct")(function* (
  runId: RunId,
  records: Parameters<typeof reduceWorkflowJournalHistory>[1]
) {
  const reduced = reduceWorkflowJournalHistory(runId, records)
  if (reduced._tag === "InvalidWorkflowJournalHistory") return yield* Effect.fail(reduced)
  return yield* Option.match(reduced.runState.controlPolicy, {
    onNone: () => Effect.fail(new WorkflowRunNotBegan({ runId })),
    onSome: Effect.succeed
  })
})

export const taskWorkCapacityControlLayer = Layer.effect(
  TaskWorkCapacityControl,
  Effect.gen(function* () {
    const journal = yield* InRunJournal
    const read = Effect.fn("TaskWorkCapacityControl.read")(function* (runId: RunId) {
      return yield* reconstructTaskWorkCapacityPolicy(runId, yield* journal.read(runId))
    })
    const apply = Effect.fn("TaskWorkCapacityControl.apply")(function* (input: unknown) {
      const request = yield* Schema.decodeUnknownEffect(SetTaskWorkCapacityRequest)(input)
      const current = yield* read(request.runId)
      if (current.revision !== request.expectedRevision) {
        return yield* new TaskWorkCapacityPolicyRevisionConflict({
          current,
          expectedRevision: request.expectedRevision,
          runId: request.runId
        })
      }
      const revision = RunPolicyRevision.make(current.revision + 1)
      yield* journal
        .append(
          request.runId,
          taskWorkCapacityPolicyRecordKey(revision),
          TaskWorkCapacityChangedEvent.make({
            capacity: request.capacity,
            initiatedBy: { _tag: "Operator" },
            occurrenceClassification: "InitiatedAction",
            previousRevision: current.revision,
            revision,
            version: workflowJournalEventVersion
          })
        )
        .pipe(
          Effect.catchTag("JournalStoreContradiction", () =>
            read(request.runId).pipe(
              Effect.flatMap(
                (latest) =>
                  new TaskWorkCapacityPolicyRevisionConflict({
                    current: latest,
                    expectedRevision: request.expectedRevision,
                    runId: request.runId
                  })
              )
            )
          )
        )
      return RunControlPolicy.make({ revision, taskExecutionCapacity: request.capacity })
    })
    return TaskWorkCapacityControl.of({ apply, read })
  })
)
