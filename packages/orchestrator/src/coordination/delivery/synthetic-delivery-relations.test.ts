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
import { AcceptedFactPublicationGateway, makeAcceptedFactPublicationGateway } from "./accepted-fact-gateway.js"
import { reduceWorkflowJournalHistory } from "../reconstruction/history.js"
import { memoryJournalStoreLayer } from "../../workflow-journal/adapters/memory-store.js"
import { JournalStore } from "../../workflow-journal/store.js"

it.effect("keeps synthetic quiescence and non-fact action outcomes process-local", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const runId = RunId.make("synthetic-invalidation-run")
      const target = FixtureTarget.make("synthetic-invalidation-target")
      const initialPolicy = InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
      const storage = yield* JournalStore
      yield* storage.beginRun(runId, target, initialPolicy)
      const initial = reduceWorkflowJournalHistory(runId, yield* storage.read(runId))
      if (initial._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(initial)
      const gateway = yield* makeAcceptedFactPublicationGateway(runId, target, initial, storage)
      const layer = yield* makeSyntheticDeliveryRelationsLayer(runId, target, initialPolicy).pipe(
        Effect.provideService(AcceptedFactPublicationGateway, gateway)
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
  ).pipe(Effect.provide(memoryJournalStoreLayer))
)
