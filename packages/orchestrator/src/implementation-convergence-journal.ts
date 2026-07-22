import { Schema } from "effect"
import { workflowJournalEventVersion } from "./journal-event-version.js"
import { WorkflowOperation } from "./workflow-operation.js"

/** Records the exact bounded implementation result while preserving every retained resource and evidence link. */
export const ImplementationConvergenceDispositionRecordedEvent = Schema.TaggedStruct(
  "ImplementationConvergenceDispositionRecorded",
  {
    operation: WorkflowOperation.cases.RecordImplementationDisposition,
    version: Schema.Literal(workflowJournalEventVersion)
  }
)
