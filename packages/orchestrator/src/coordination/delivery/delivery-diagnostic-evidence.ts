import { TaskId } from "@dalph/contracts"
import { Schema } from "effect"
import { OperationId } from "../../workflow/identity.js"
import { JournalPosition } from "../../workflow-journal/identity.js"

/** Safe accepted read identities, kept separate by the authority family they can explain. */
export const DeliveryDiagnosticAuthorityEvidence = Schema.Struct({
  gitWorktree: Schema.NullOr(
    Schema.Struct({ observedAt: JournalPosition, operationId: OperationId, kind: Schema.NonEmptyString })
  ),
  gitLineage: Schema.NullOr(
    Schema.Struct({ observedAt: JournalPosition, operationId: OperationId, kind: Schema.NonEmptyString })
  ),
  claim: Schema.Array(
    Schema.Struct({ observedAt: JournalPosition, operationId: OperationId, kind: Schema.NonEmptyString })
  )
})

/** Accepted executor evidence names its observed kind without claiming safety from absence. */
export const DeliveryDiagnosticExecutorEvidence = Schema.Struct({
  observedAt: JournalPosition,
  kind: Schema.Literals([
    "ResponsibilityRecorded",
    "ExecutorWorkExecuting",
    "ExecutorWorkSafelySuspended",
    "ExecutorWorkTerminal",
    "ExecutorWorkResultRejected",
    "ExecutorStateNoCurrentReport",
    "ExecutorStateTemporarilyUnavailable",
    "ExecutorStateUnreadable",
    "ExecutorReportContradiction",
    "ExecutorInitialReportCausalityContradiction",
    "ExecutorLifecycleTransitionContradiction"
  ])
})

/** Exact refused Base-read subjects; the projection supplies only a safe public reason. */
export const DeliveryDiagnosticAttemptBaseAdmission = Schema.TaggedUnion({
  HistoricalPolicyUnspecified: {},
  QualificationRefused: {
    refusals: Schema.Array(
      Schema.Struct({
        taskId: TaskId,
        operationId: OperationId,
        observedAt: JournalPosition,
        boundary: Schema.Literals(["TargetHead", "AnchorAncestry", "ExecutionCommit"]),
        detail: Schema.String
      })
    )
  }
})
