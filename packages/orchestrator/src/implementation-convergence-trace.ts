import { Schema } from "effect"
import {
  AuthoritativeImplementationConvergenceDisposition,
  ImplementationConvergenceSimulated
} from "./implementation-convergence.js"
import { WorkflowOperation } from "./workflow-operation.js"

/** Exposes one evidence-backed terminal implementation result without releasing retained resources. */
export const ImplementationConvergenceDispositionRecordedTrace = Schema.TaggedStruct(
  "ImplementationConvergenceDispositionRecorded",
  {
    operation: WorkflowOperation.cases.RecordImplementationDisposition,
    result: AuthoritativeImplementationConvergenceDisposition
  }
)

/** Projects bounded loop completion without inventing a terminal live disposition. */
export const ImplementationConvergenceSimulatedTrace = Schema.TaggedStruct(
  "ImplementationConvergenceSimulated",
  {
    operation: WorkflowOperation.cases.RecordImplementationDisposition,
    result: ImplementationConvergenceSimulated
  }
)
