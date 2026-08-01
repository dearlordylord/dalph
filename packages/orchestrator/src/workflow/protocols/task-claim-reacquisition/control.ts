import { Context, Effect, Layer, Schema } from "effect"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { taskClaimReacquisitionDirectedRecordKey } from "../../../workflow-journal/record-key.js"
import {
  type JournalAppendError,
  type JournalRecord,
  type JournalStoreError,
  JournalStore,
  WorkflowRunNotBegan
} from "../../../workflow-journal/store.js"
import {
  TaskClaimReacquisitionDirectedEvent,
  TaskClaimReacquisitionDirectionOrdinal,
  TaskClaimReacquisitionSubject
} from "./events.js"

interface TaskClaimReacquisitionControlService {
  readonly apply: (
    input: unknown
  ) => Effect.Effect<JournalRecord, JournalAppendError | JournalStoreError | Schema.SchemaError | WorkflowRunNotBegan>
}

/** Decodes and durably applies one explicit Operator claim-reacquisition direction. */
export class TaskClaimReacquisitionControl extends Context.Service<
  TaskClaimReacquisitionControl,
  TaskClaimReacquisitionControlService
>()("@dalph/TaskClaimReacquisitionControl") {}

export const taskClaimReacquisitionControlLayer = Layer.effect(
  TaskClaimReacquisitionControl,
  Effect.gen(function* () {
    const journal = yield* JournalStore
    const apply = Effect.fn("TaskClaimReacquisitionControl.apply")(function* (input: unknown) {
      const subject = yield* Schema.decodeUnknownEffect(TaskClaimReacquisitionSubject)(input)
      const records = yield* journal.read(subject.runId)
      if (!records.some(({ event }) => event._tag === "WorkflowRunBegan")) {
        return yield* new WorkflowRunNotBegan({ runId: subject.runId })
      }
      const ordinal = TaskClaimReacquisitionDirectionOrdinal.make(
        records.filter(({ event }) => event._tag === "TaskClaimReacquisitionDirected").length + 1
      )
      return yield* journal.append(
        subject.runId,
        taskClaimReacquisitionDirectedRecordKey(ordinal),
        TaskClaimReacquisitionDirectedEvent.make({
          initiatedBy: { _tag: "Operator" },
          occurrenceClassification: "InitiatedAction",
          ordinal,
          subject,
          version: workflowJournalEventVersion
        })
      )
    })
    return TaskClaimReacquisitionControl.of({ apply })
  })
)
