import type { RunId } from "@dalph/contracts"
import type { TaskDagSnapshot } from "../../authorities/task-tracker/graph.js"
import type { RunControlPolicy } from "../../control/policy.js"
import type { OperationId } from "../../workflow/identity.js"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import { Effect, Option, Schema } from "effect"
import type { JournalState } from "../delivery/journal.js"
import type { ReconstructedRunState } from "../reconstruction/state.js"

/** Journal history does not yet contain a graph usable by delivery. */
export class CurrentDeliveryGraphUnavailable extends Schema.TaggedError<CurrentDeliveryGraphUnavailable>()(
  "CurrentDeliveryGraphUnavailable",
  {}
) {}

/** Validated journal history unexpectedly lacks its initial control policy. */
export class CurrentDeliveryControlPolicyUnavailable extends Schema.TaggedError<CurrentDeliveryControlPolicyUnavailable>()(
  "CurrentDeliveryControlPolicyUnavailable",
  {}
) {}

interface CurrentDeliveryFrameBase {
  readonly currentGraph: TaskDagSnapshot
  readonly currentGraphOperationId: OperationId
  readonly pause: ReconstructedRunState["pause"]
  readonly responsibility: ReconstructedRunState["responsibility"]
  readonly runId: RunId
  readonly runControlPolicy: RunControlPolicy
}

/** One immutable journal-backed input to pure delivery projection; it owns no runtime state. */
export type CurrentDeliveryFrame = CurrentDeliveryFrameBase & {
  readonly acceptedAt: JournalPosition
  readonly workflowHistory: ReconstructedRunState["workflowHistory"]
}

/** Projects one already-coherent journal snapshot without another read. */
export const journaledCurrentDeliveryFrameOf = (
  journal: JournalState
): Effect.Effect<CurrentDeliveryFrame, CurrentDeliveryControlPolicyUnavailable | CurrentDeliveryGraphUnavailable> =>
  Effect.gen(function* () {
    if (journal.graph._tag === "GraphNotEstablished") return yield* new CurrentDeliveryGraphUnavailable()
    const currentGraph = journal.graph.observation.snapshot
    const currentGraphOperationId = journal.graph.observation.operationId
    const runControlPolicy = Option.getOrUndefined(journal.reconstructed.controlPolicy)
    /* v8 ignore start -- Bootstrap validates that Run beginning established this policy. */
    if (runControlPolicy === undefined) return yield* new CurrentDeliveryControlPolicyUnavailable()
    /* v8 ignore stop */
    return {
      acceptedAt: journal.position,
      currentGraph,
      currentGraphOperationId,
      // Cancellation borrows the established Pause selection semantics for
      // derived work: already-owned responsibilities may settle, but no fresh
      // task work may be selected after the durable direction.
      pause:
        journal.reconstructed.cancellation._tag === "RunCancellationApplied"
          ? { ...journal.reconstructed.pause, run: { _tag: "RunPaused" as const } }
          : journal.reconstructed.pause,
      responsibility: journal.reconstructed.responsibility,
      runId: journal.reconstructed.runId,
      runControlPolicy,
      workflowHistory: journal.reconstructed.workflowHistory
    }
  })
