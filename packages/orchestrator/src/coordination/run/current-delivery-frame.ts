import type { TaskDagSnapshot } from "../../authorities/task-tracker/graph.js"
import type { RunControlPolicy } from "../../control/policy.js"
import type { OperationId } from "../../workflow/identity.js"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import { Effect, Option, Schema } from "effect"
import type { AcceptedFactPublicationState } from "../delivery/accepted-fact-gateway.js"
import { latestReconstructedTaskGraph } from "../reconstruction/graph-knowledge.js"
import type { ReconstructedRunState } from "../reconstruction/state.js"
import type { FreshWorkflowActionFact } from "./fresh-workflow-fact.js"

/** Accepted journal history does not yet contain a graph usable by delivery. */
export class CurrentDeliveryGraphUnavailable extends Schema.TaggedErrorClass<CurrentDeliveryGraphUnavailable>()(
  "CurrentDeliveryGraphUnavailable",
  {}
) {}

/** Validated accepted history unexpectedly lacks its initial control policy. */
export class CurrentDeliveryControlPolicyUnavailable extends Schema.TaggedErrorClass<CurrentDeliveryControlPolicyUnavailable>()(
  "CurrentDeliveryControlPolicyUnavailable",
  {}
) {}

interface CurrentDeliveryFrameBase {
  readonly currentGraph: TaskDagSnapshot
  readonly currentGraphOperationId: OperationId
  readonly pause: ReconstructedRunState["pause"]
  readonly responsibility: ReconstructedRunState["responsibility"]
  readonly runControlPolicy: RunControlPolicy
}

/** One immutable input to pure delivery projection; it owns no runtime state. */
export type CurrentDeliveryFrame = CurrentDeliveryFrameBase &
  (
    | {
        readonly _tag: "JournaledCurrentDeliveryFrame"
        readonly acceptedAt: JournalPosition
        readonly workflowHistory: ReconstructedRunState["workflowHistory"]
      }
    | { readonly _tag: "SyntheticCurrentDeliveryFrame"; readonly workflowFacts: ReadonlyArray<FreshWorkflowActionFact> }
  )

/** Projects one already-coherent accepted snapshot without another read. */
export const journaledCurrentDeliveryFrameOf = (
  accepted: AcceptedFactPublicationState
): Effect.Effect<CurrentDeliveryFrame, CurrentDeliveryControlPolicyUnavailable | CurrentDeliveryGraphUnavailable> =>
  Effect.gen(function* () {
    if (accepted.graph._tag === "GraphNotEstablished") return yield* new CurrentDeliveryGraphUnavailable()
    const currentGraph = Option.getOrUndefined(latestReconstructedTaskGraph(accepted.reconstructed.graphKnowledge))
    /* v8 ignore start -- GraphEstablished is published from this exact reconstructed graph. */
    if (currentGraph === undefined) return yield* new CurrentDeliveryGraphUnavailable()
    /* v8 ignore stop */
    const currentGraphOperationId = accepted.reconstructed.graphKnowledge.taskTrackerFacts.findLast(
      (observation) =>
        observation._tag === "CompleteTaskTrackerFacts" || observation._tag === "UnchangedTaskTrackerFactsReconfirmed"
    )?.operationId
    /* v8 ignore start -- A reconstructed complete graph retains its accepted observation identity. */
    if (currentGraphOperationId === undefined) return yield* new CurrentDeliveryGraphUnavailable()
    /* v8 ignore stop */
    const runControlPolicy = Option.getOrUndefined(accepted.reconstructed.controlPolicy)
    /* v8 ignore start -- Bootstrap validates that Run beginning established this policy. */
    if (runControlPolicy === undefined) return yield* new CurrentDeliveryControlPolicyUnavailable()
    /* v8 ignore stop */
    return {
      _tag: "JournaledCurrentDeliveryFrame",
      acceptedAt: accepted.appliedPosition,
      currentGraph,
      currentGraphOperationId,
      pause: accepted.reconstructed.pause,
      responsibility: accepted.reconstructed.responsibility,
      runControlPolicy,
      workflowHistory: accepted.reconstructed.workflowHistory
    }
  })
