import { Context, Effect, Layer, Schema, Semaphore } from "effect"
import { ControlDirectionApplicationOrdinal, ControlDirectionAppliedEvent, controlDirectionRunId } from "./events.js"
import { ApplyControlDirectionRequest } from "./request.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { controlDirectionAppliedRecordKey } from "../../../workflow-journal/record-key.js"
import {
  type JournalAppendError,
  type JournalRecord,
  type JournalStoreError,
  InRunJournal,
  WorkflowRunNotBegan
} from "../../../workflow-journal/store.js"
import { AcceptedJournalReader } from "../../../workflow-journal/accepted-reader.js"
import { firstJournalRecordOfKind, journalRecordsOfKind } from "../../../workflow-journal/record-evidence.js"

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
    const journal = yield* InRunJournal
    const acceptedJournal = yield* AcceptedJournalReader
    const applications = yield* Semaphore.make(1)
    const applyUnserialized = Effect.fn("ControlDirectionApplication.apply")(function* (input: unknown) {
      const request = yield* Schema.decodeUnknownEffect(ApplyControlDirectionRequest, { onExcessProperty: "error" })(
        input
      )
      const runId = controlDirectionRunId(request.subject)
      const records = yield* acceptedJournal.readAccepted(runId)
      if (firstJournalRecordOfKind(records, "WorkflowRunBegan") === undefined) {
        return yield* new WorkflowRunNotBegan({ runId })
      }
      let priorApplicationCount = 0
      for (const _record of journalRecordsOfKind(records, "ControlDirectionApplied")) priorApplicationCount += 1
      const ordinal = ControlDirectionApplicationOrdinal.make(priorApplicationCount + 1)
      const appended = yield* journal.append(
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
      return appended
    })
    const apply = (input: unknown) => applications.withPermit(applyUnserialized(input))
    return ControlDirectionApplication.of({ apply })
  })
)
