import { it } from "@effect/vitest"
import { NodeCrypto } from "@effect/platform-node"
import { Deferred, Effect, Queue, Ref } from "effect"
import { expect } from "vitest"
import { TaskId, PlannedAttemptExecutorProjection } from "@dalph/contracts"
import { deriveIntegrationFinalityStateFor, reduceWorkflowJournalHistory } from "@dalph/orchestrator"
import { deliveryFinalityOf } from "../../../orchestrator/src/coordination/delivery/relations.js"
import { makeIssue278NormalTermination } from "../../test-support/issue-278-normal-termination.js"
import { start, type Issue278Fixture } from "../../test-support/issue-278-test-controls.js"

const remainsActive = Effect.fn("Issue278Test.remainsActive")(function* (fixture: Issue278Fixture) {
  const records = yield* fixture.journal.read(fixture.runId)
  expect(records.some(({ event }) => event._tag === "WorkflowRunTerminated")).toBe(false)
  expect(yield* Ref.get(fixture.terminationAttempts)).toEqual([])
  expect((yield* Ref.get(fixture.graphReads)).filter(({ revision }) => revision.startsWith("Gfinal"))).toEqual([])
  expect(yield* Ref.get(fixture.processEndRequests)).toBe(0)
  expect(reduceWorkflowJournalHistory(fixture.runId, records)._tag).toBe("ValidWorkflowJournalHistory")
  return records
})

it.effect(
  "keeps proposals live owners held executor integration finality and claim-cleanup work nonterminal",
  () =>
    Effect.gen(function* () {
      const fixture = yield* makeIssue278NormalTermination()
      const process = yield* start(fixture)
      yield* process.event(
        (event) => event._tag === "PlannedAttemptExecutorWorkReported" && event.report._tag === "ExecutorWorkExecuting"
      )
      for (;;) {
        const observation = yield* process.take(fixture.runtimeObservationQueue)
        if (observation.evaluation.taskWork.held.some(({ taskId }) => taskId === "B")) break
      }
      const executing = yield* remainsActive(fixture)
      expect(
        executing.some(
          ({ event }) =>
            event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" && event.plannedAttempt.taskId === "B"
        )
      ).toBe(true)
      const ready = yield* Ref.get(fixture.runtimeObservations)
      const proposalObservation = ready.find(
        (observation) =>
          observation._tag === "Ready" &&
          observation.evaluation.proposedActions._tag === "DeliveryProposalsAvailable" &&
          (observation.evaluation.proposedActions.proposals.length > 0 ||
            observation.evaluation.proposedActions.freshTaskCandidates.length > 0)
      )
      if (proposalObservation?._tag !== "Ready") return expect.fail("missing real executable proposal")
      expect(
        deliveryFinalityOf(
          proposalObservation.evaluation.current,
          proposalObservation.evaluation.proposedActions,
          proposalObservation.evaluation.quiescence
        )
      ).toEqual({ _tag: "RunMustRemainActive", reason: "RunnableTransition" })
      expect(
        ready.some(
          (observation) =>
            observation._tag === "Ready" && observation.evaluation.taskWork.held.some(({ taskId }) => taskId === "B")
        )
      ).toBe(true)
      yield* fixture.terminal("B")
      const integration = yield* process.take(fixture.integrationEntered)
      expect(integration.session.plannedAttempt.taskId).toBe("B")
      const integrating = yield* remainsActive(fixture)
      expect(
        integrating.some(
          ({ event }) => event._tag === "IntegrationResponsibilityBegan" && event.plannedAttempt.taskId === "B"
        )
      ).toBe(true)
      const owners = (yield* Ref.get(fixture.runtimeObservations)).flatMap((observation) =>
        observation._tag === "Ready" ? observation.liveOwners : []
      )
      expect(
        owners.some(
          (owner) =>
            owner._tag === "MaterializedDeliveryAction" &&
            owner.proposal.order._tag === "IntegrationOrder" &&
            owner.proposal.order.taskId === "B"
        )
      ).toBe(true)
      yield* Ref.set(fixture.deliveryHold, { _tag: "Armed", at: "CompletionClaimReplaced" })
      const release = fixture.releaseIntegration.get(TaskId.make("B"))
      if (release === undefined) return expect.fail("missing B integration boundary")
      yield* Deferred.succeed(release, undefined)
      expect(yield* process.take(fixture.heldDelivery)).toBe("CompletionClaimReplaced")
      const finalizing = yield* remainsActive(fixture)
      const replacement = finalizing.findLast(({ event }) => event._tag === "CompletionClaimReplaced")?.event
      if (replacement?._tag !== "CompletionClaimReplaced") return expect.fail("missing exact B replacement")
      expect(replacement.claim.plannedAttempt.taskId).toBe("B")
      expect(deriveIntegrationFinalityStateFor(finalizing, replacement.claim)?._tag).toBe("CompletionClaimReplaced")
      yield* Ref.set(fixture.deliveryHold, { _tag: "Armed", at: "CompletionClaimDeletionIntended" })
      yield* Queue.offer(fixture.releaseDelivery, undefined)
      expect(yield* process.take(fixture.heldDelivery)).toBe("CompletionClaimDeletionIntended")
      const cleaning = yield* remainsActive(fixture)
      expect(deriveIntegrationFinalityStateFor(cleaning, replacement.claim)?._tag).toBe("DeletionPending")
      expect(
        cleaning.some(
          ({ event }) => event._tag === "CompletionClaimDeleted" && event.claim.plannedAttempt.taskId === "B"
        )
      ).toBe(false)
      expect(
        cleaning.some(
          ({ event }) => event._tag === "IntegrationFinalitySettled" && event.claim.plannedAttempt.taskId === "B"
        )
      ).toBe(false)
      yield* Ref.set(fixture.deliveryHold, { _tag: "Disabled" })
      yield* Queue.offer(fixture.releaseDelivery, undefined)
      yield* process.event(
        (event) => event._tag === "IntegrationFinalitySettled" && event.claim.plannedAttempt.taskId === "B"
      )
    }).pipe(Effect.provide(NodeCrypto.layer)),
  30_000
)

it.effect(
  "keeps an exact executor correlation conflict and its retained position nonterminal",
  () =>
    Effect.gen(function* () {
      const fixture = yield* makeIssue278NormalTermination()
      const process = yield* start(fixture)
      yield* process.event(
        (event) => event._tag === "PlannedAttemptExecutorWorkReported" && event.report._tag === "ExecutorWorkExecuting"
      )
      const expected = { runId: fixture.runId, attemptId: fixture.facts.taskFacts.B.attemptId }
      const acceptedA = fixture.settledA.records.find(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkReported" && event.report._tag === "ExecutorWorkTerminal"
      )?.event
      if (acceptedA?._tag !== "PlannedAttemptExecutorWorkReported")
        return expect.fail("missing actual A executor report")
      const observed = acceptedA.report
      yield* fixture.publish(
        "B",
        PlannedAttemptExecutorProjection.cases.CorrelationContradiction.make({ expected, observed })
      )
      const occurrence = yield* process.event((event) => event._tag === "PlannedAttemptExecutorStateObserved")
      expect(occurrence).toMatchObject({
        _tag: "PlannedAttemptExecutorStateObserved",
        observation: { _tag: "ExecutorReportContradiction" }
      })
      const records = yield* remainsActive(fixture)
      expect(
        records.some(
          ({ event }) => event._tag === "IntegrationResponsibilityBegan" && event.plannedAttempt.taskId === "B"
        )
      ).toBe(false)
      expect(
        (yield* Ref.get(fixture.runtimeObservations)).some(
          (observation) =>
            observation._tag === "Ready" && observation.evaluation.taskWork.held.some(({ taskId }) => taskId === "B")
        )
      ).toBe(true)
    }).pipe(Effect.provide(NodeCrypto.layer)),
  30_000
)
