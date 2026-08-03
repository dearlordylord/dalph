import { RunId } from "@dalph/contracts"
import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { InitialControlPolicy } from "../../control/policy.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import type { IntegrationCandidateConstructionState } from "../../workflow/protocols/integration-candidate-construction/protocol.js"
import { deliveryRuntime } from "./delivery-runtime-adapter.js"
import { DeliveryProposalId } from "./delivery-action-proposal.js"
import { DeliveryRelationRevision } from "./relations.js"
import { makeSyntheticDeliveryRelationsLayer } from "./synthetic-delivery-relations.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import type { OperationId } from "../../workflow/identity.js"
import type { TaskDagSnapshot } from "../../authorities/task-tracker/graph.js"

it.effect("keeps synthetic quiescence and non-fact action outcomes process-local", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const layer = yield* makeSyntheticDeliveryRelationsLayer(
        RunId.make("synthetic-invalidation-run"),
        FixtureTarget.make("synthetic-invalidation-target"),
        InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }),
        (operationId: OperationId, snapshot: TaskDagSnapshot) => ({
          _tag: "AcceptedTrackerGraphObservation" as const,
          snapshot,
          operationId,
          contentIdentity: snapshot.revision,
          acceptedAt: JournalPosition.make(1),
          freshness: { _tag: "ObservedDuringLogicalRead" as const, operationId }
        })
      )
      const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))
      const proposalId = DeliveryProposalId.make("synthetic-invalidation-proposal")

      const revisions = [
        yield* relation.invalidate({ _tag: "QuiescenceProbeRequested" }),
        yield* relation.invalidate({ _tag: "QuiescenceProbeRequested" }),
        yield* relation.invalidate({
          _tag: "ProposalCompleted",
          proposalId,
          result: { _tag: "ActionCompleted", proposalId }
        }),
        yield* relation.invalidate({
          _tag: "ProposalCompleted",
          proposalId,
          result: {
            _tag: "IntegrationCandidateAdvanced",
            proposalId,
            resourceDisposition: "Retain",
            state: {} as IntegrationCandidateConstructionState
          }
        }),
        yield* relation.invalidate({ _tag: "ProposalCompleted", proposalId, result: null })
      ]

      expect(revisions).toEqual([1, 2, 3, 4, 5].map((revision) => DeliveryRelationRevision.make(revision)))
    })
  )
)
