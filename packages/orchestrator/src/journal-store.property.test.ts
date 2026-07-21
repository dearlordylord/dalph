import { Schema } from "effect"
import * as fc from "fast-check"
import { expect, it } from "vitest"
import { OperationId, TaskId } from "./domain.js"
import { ManagedWorkflowEvent, managedWorkflowIntent } from "./journal-store.js"
import { WorkflowOperation } from "./workflow.js"

const nonEmptyIdentity = fc.string({ minLength: 1, maxLength: 40 })

it("round-trips and deterministically re-encodes managed task intents", () => {
  fc.assert(
    fc.property(
      nonEmptyIdentity,
      nonEmptyIdentity,
      fc.array(nonEmptyIdentity, { maxLength: 6 }),
      (operationId, taskId, predecessorOperationIds) => {
        const event = managedWorkflowIntent(
          WorkflowOperation.cases.ExecuteTask.make({
            operationId: OperationId.make(operationId),
            predecessorOperationIds: predecessorOperationIds.map((id) => OperationId.make(id)),
            taskId: TaskId.make(taskId)
          })
        )
        const encoded = Schema.encodeUnknownSync(ManagedWorkflowEvent)(event)
        const decoded = Schema.decodeUnknownSync(ManagedWorkflowEvent)(encoded)

        expect(decoded).toEqual(event)
        expect(JSON.stringify(Schema.encodeUnknownSync(ManagedWorkflowEvent)(decoded)))
          .toBe(JSON.stringify(encoded))
      }
    ),
    { numRuns: 100 }
  )
})
