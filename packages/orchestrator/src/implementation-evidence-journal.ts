import { Schema } from "effect"
import { OperationId } from "./domain.js"
import { SealedImplementationEvidence } from "./implementation-evidence.js"
import { WorkflowOperation } from "./workflow-operation.js"

const workflowJournalEventVersion = 2 as const // eslint-disable-line no-magic-numbers

/** Records sealing intent before any evidence object can become visible. */
export const ImplementationEvidenceSealingIntendedEvent = Schema.TaggedStruct(
  "ImplementationEvidenceSealingIntended",
  {
    operation: WorkflowOperation.cases.SealImplementationEvidence,
    version: Schema.Literal(workflowJournalEventVersion)
  }
)

/** Records the complete predecessor-linked manifest only after every object is sealed. */
export const ImplementationEvidenceSealedEvent = Schema.TaggedStruct(
  "ImplementationEvidenceSealed",
  {
    operationId: OperationId,
    sealed: SealedImplementationEvidence,
    version: Schema.Literal(workflowJournalEventVersion)
  }
)

export const ImplementationEvidenceJournalEvent = Schema.Union([
  ImplementationEvidenceSealingIntendedEvent,
  ImplementationEvidenceSealedEvent
])
