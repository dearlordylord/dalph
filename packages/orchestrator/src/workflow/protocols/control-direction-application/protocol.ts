import { Context, Effect, Layer, Schema } from "effect"
import { ControlDirectionApplicationOrdinal, ControlDirectionAppliedEvent, controlDirectionRunId } from "./events.js"
import { ApplyControlDirectionRequest } from "./request.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { controlDirectionAppliedRecordKey } from "../../../workflow-journal/record-key.js"
import {
  type JournalAppendError,
  type JournalRecord,
  type JournalStoreError,
  JournalStore,
  WorkflowRunNotBegan
} from "../../../workflow-journal/store.js"

interface ControlDirectionApplicationService {
  readonly apply: (
    input: unknown
  ) => Effect.Effect<JournalRecord, JournalAppendError | JournalStoreError | Schema.SchemaError | WorkflowRunNotBegan>
}

/** Decodes and durably applies one Operator Pause or Unpause direction. */
export class ControlDirectionApplication extends Context.Service<
  ControlDirectionApplication,
  ControlDirectionApplicationService
>()("@dalph/ControlDirectionApplication") {}

export const controlDirectionApplicationLayer = Layer.effect(
  ControlDirectionApplication,
  Effect.gen(function* () {
    const journal = yield* JournalStore
    const apply = Effect.fn("ControlDirectionApplication.apply")(function* (input: unknown) {
      const request = yield* Schema.decodeUnknownEffect(ApplyControlDirectionRequest)(input)
      const runId = controlDirectionRunId(request.subject)
      const records = yield* journal.read(runId)
      if (!records.some(({ event }) => event._tag === "WorkflowRunBegan")) {
        return yield* new WorkflowRunNotBegan({ runId })
      }
      const ordinal = ControlDirectionApplicationOrdinal.make(
        records.filter(({ event }) => event._tag === "ControlDirectionApplied").length + 1
      )
      return yield* journal.append(
        runId,
        controlDirectionAppliedRecordKey(ordinal),
        ControlDirectionAppliedEvent.make({
          direction: request.direction,
          initiatedBy: { _tag: "Operator" },
          occurrenceClassification: "InitiatedAction",
          ordinal,
          subject: request.subject,
          version: workflowJournalEventVersion
        })
      )
    })
    return ControlDirectionApplication.of({ apply })
  })
)
