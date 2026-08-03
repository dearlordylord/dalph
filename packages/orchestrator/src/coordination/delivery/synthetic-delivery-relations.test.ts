import { RunId } from "@dalph/contracts"
import { it } from "@effect/vitest"
import { Cause, Effect, Option, Ref, Stream } from "effect"
import { expect } from "vitest"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { InitialControlPolicy } from "../../control/policy.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import type { IntegrationCandidateConstructionState } from "../../workflow/protocols/integration-candidate-construction/protocol.js"
import { deliveryRuntime } from "./delivery-runtime-adapter.js"
import { DeliveryProposalId } from "./delivery-action-proposal.js"
import { DeliveryRelationReconciliationError, DeliveryRelationRevision } from "./relations.js"
import { makeSyntheticDeliveryRelationsLayer } from "./synthetic-delivery-relations.js"
import { Journal, makeJournal } from "./journal.js"
import { reduceWorkflowJournalHistory } from "../reconstruction/history.js"
import { memoryJournalStoreLayer } from "../../workflow-journal/adapters/memory-store.js"
import { JournalHistoryInvalid, JournalStore } from "../../workflow-journal/store.js"

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
      const journal = yield* makeJournal(runId, target, initial, storage)
      const layer = yield* makeSyntheticDeliveryRelationsLayer(runId, target, initialPolicy).pipe(
        Effect.provideService(Journal, journal)
      )
      const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))
      const current = yield* relation.current.get
      expect(current.trackerGraph._tag).toBe("GraphNotEstablished")
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

it.effect("publishes a typed failure when journal state cannot be reread after a proposal completes", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const runId = RunId.make("synthetic-publication-failure-run")
      const target = FixtureTarget.make("synthetic-publication-failure-target")
      const initialPolicy = InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
      const storage = yield* JournalStore
      yield* storage.beginRun(runId, target, initialPolicy)
      const initial = reduceWorkflowJournalHistory(runId, yield* storage.read(runId))
      if (initial._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(initial)
      const journal = yield* makeJournal(runId, target, initial, storage)
      const journalState = yield* journal.state.get
      const failRead = yield* Ref.make(false)
      const journalFailure = new JournalHistoryInvalid({
        position: journalState.position,
        detail: "synthetic proposal completion read failed",
        runId
      })
      const failingJournal = {
        ...journal,
        state: {
          ...journal.state,
          get: Ref.get(failRead).pipe(
            Effect.flatMap((failed) => (failed ? Effect.fail(journalFailure) : journal.state.get))
          )
        }
      }
      const layer = yield* makeSyntheticDeliveryRelationsLayer(runId, target, initialPolicy).pipe(
        Effect.provideService(Journal, failingJournal)
      )
      const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))

      yield* Ref.set(failRead, true)
      yield* relation.invalidate({
        _tag: "ProposalCompleted",
        proposalId: DeliveryProposalId.make("synthetic-publication-failure-proposal"),
        result: null
      })
      const failure = yield* relation.current.changes.pipe(Stream.runHead, Effect.flip)
      const currentFailure = yield* relation.current.get.pipe(Effect.flip)

      expect(failure).toBeInstanceOf(DeliveryRelationReconciliationError)
      expect(currentFailure).toEqual(failure)
      if (!(failure instanceof DeliveryRelationReconciliationError)) return expect.fail("expected relation failure")
      expect(Cause.hasDies(failure.cause)).toBe(false)
      expect(Cause.squash(failure.cause)).toEqual(journalFailure)

      yield* relation.invalidate({ _tag: "QuiescenceProbeRequested" })
      const stickyFailure = yield* relation.current.changes.pipe(Stream.runHead, Effect.flip)
      expect(stickyFailure).toBeInstanceOf(DeliveryRelationReconciliationError)

      yield* Ref.set(failRead, false)
      yield* relation.invalidate({
        _tag: "ProposalCompleted",
        proposalId: DeliveryProposalId.make("synthetic-publication-recovery-proposal"),
        result: null
      })
      const recovered = yield* relation.current.changes.pipe(Stream.runHead, Effect.map(Option.getOrThrow))
      expect(recovered.trackerGraph._tag).toBe("GraphNotEstablished")
    })
  ).pipe(Effect.provide(memoryJournalStoreLayer))
)
