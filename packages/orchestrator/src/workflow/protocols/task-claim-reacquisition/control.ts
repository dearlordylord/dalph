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
  TaskClaimReacquisitionRequestId,
  TaskClaimReacquisitionSubject
} from "./events.js"

const ApplyTaskClaimReacquisitionRequest = Schema.Struct({
  requestId: TaskClaimReacquisitionRequestId,
  subject: TaskClaimReacquisitionSubject
})

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
      const request = yield* Schema.decodeUnknownEffect(ApplyTaskClaimReacquisitionRequest, {
        onExcessProperty: "error"
      })(input)
      const records = yield* journal.read(request.subject.runId)
      if (!records.some(({ event }) => event._tag === "WorkflowRunBegan")) {
        return yield* new WorkflowRunNotBegan({ runId: request.subject.runId })
      }
      return yield* journal.append(
        request.subject.runId,
        taskClaimReacquisitionDirectedRecordKey(request.requestId),
        TaskClaimReacquisitionDirectedEvent.make({
          initiatedBy: { _tag: "Operator" },
          occurrenceClassification: "InitiatedAction",
          requestId: request.requestId,
          subject: request.subject,
          version: workflowJournalEventVersion
        })
      )
    })
    return TaskClaimReacquisitionControl.of({ apply })
  })
)
