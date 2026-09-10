import { it } from "@effect/vitest"
import { NodeCrypto } from "@effect/platform-node"
import { Cause, Effect, Exit, Fiber, Queue, Ref } from "effect"
import { expect } from "vitest"
import { deriveIntegrationFinalityStateFor, reduceWorkflowJournalHistory } from "@dalph/orchestrator"
import { terminationPreconditionIssues } from "../../../orchestrator/src/workflow-journal/termination-preconditions.js"
import { makeIssue278NormalTermination } from "../../test-support/issue-278-normal-termination.js"
import { start, deliver, names } from "../../test-support/issue-278-test-controls.js"

type Fixture = Effect.Success<ReturnType<typeof makeIssue278NormalTermination>>
const allNames = ["A", ...names]

it.effect(
  "records Completed once only after Gfinal and no remaining work",
  () =>
    Effect.gen(function* () {
      const fixture = yield* makeIssue278NormalTermination()
      const process = yield* start(fixture)
      yield* deliver(fixture, process)
      yield* process.event((event) => event._tag === "WorkflowRunTerminated")
      const records = yield* fixture.journal.read(fixture.runId)
      expect(records.filter(({ event }) => event._tag === "IntegrationFinalitySettled")).toHaveLength(7)
      expect(records.at(-1)?.event).toMatchObject({ _tag: "WorkflowRunTerminated", disposition: "Completed" })
      expect((yield* Ref.get(fixture.graphReads)).filter(({ revision }) => revision.startsWith("Gfinal"))).toHaveLength(
        1
      )
      expect(yield* Ref.get(fixture.processEndRequests)).toBe(0)
      const finalReads = (yield* Ref.get(fixture.graphReads)).filter(({ revision }) => revision.startsWith("Gfinal"))
      const finalRead = finalReads[0]
      if (finalRead === undefined || finalRead.runtime === null)
        return expect.fail("missing live quiescence observation before final tracker call")
      expect(finalRead.runtime.liveOwners).toEqual([])
      expect(finalRead.runtime.evaluation.taskWork.held).toEqual([])
      expect(finalRead.runtime.evaluation.proposedActions).toMatchObject({
        _tag: "DeliveryProposalsAvailable",
        proposals: [],
        freshTaskCandidates: [],
        isolatedIssues: []
      })
      const terminal = records.at(-1)?.event
      if (terminal?._tag !== "WorkflowRunTerminated") return expect.fail("missing terminal record")
      expect(terminationPreconditionIssues(records.slice(0, -1), fixture.runId, terminal.evidence)).toEqual([])
      expect(yield* Ref.get(fixture.terminationAttempts)).toEqual([[fixture.runId, "Completed", terminal.evidence]])
      expect(finalRead.intent.event).toMatchObject({
        _tag: "TaskTrackerReadIntentRecorded",
        operation: { _tag: "ReadTrackerGraph", cause: { _tag: "PostQuiescenceReconfirmation" } }
      })
      const settled = records.filter(({ event }) => event._tag === "IntegrationFinalitySettled")
      expect(finalRead.intent.position).toBeGreaterThan(Math.max(...settled.map(({ position }) => position)))
      expect(terminal.evidence.operationId).toBe(
        finalRead.intent.event._tag === "TaskTrackerReadIntentRecorded"
          ? finalRead.intent.event.operation.operationId
          : undefined
      )
      expect(terminal.evidence.contentIdentity).toBe(finalRead.snapshot.revision)
      expect(records.find(({ position }) => position === terminal.evidence.observedAt)?.event).toMatchObject({
        _tag: "TaskTrackerFactsObserved",
        operationId: terminal.evidence.operationId
      })
      expect(terminal.evidence.requiredFactFamilies).toEqual([
        "TaskIdentities",
        "TaskLifecycles",
        "TaskPrerequisites",
        "TaskGroupings",
        "TaskTargetMembership"
      ])
      expect(terminal.evidence).toMatchObject({
        runId: fixture.runId,
        target: fixture.facts.target,
        rootTaskId: "A",
        complete: true
      })
    }).pipe(Effect.provide(NodeCrypto.layer)),
  30_000
)

it.effect(
  "proves seven tracker successes from Gfinal and seven exact claim absences",
  () =>
    Effect.gen(function* () {
      const fixture = yield* makeIssue278NormalTermination()
      const process = yield* start(fixture)
      yield* deliver(fixture, process)
      yield* process.event((event) => event._tag === "WorkflowRunTerminated")
      const records = yield* fixture.journal.read(fixture.runId)
      const reads = yield* Ref.get(fixture.graphReads)
      const finalRead = reads.find(({ revision }) => revision.startsWith("Gfinal"))
      if (finalRead === undefined) return expect.fail("missing actual final tracker read")
      expect(finalRead.settledTaskIds).toEqual(allNames)
      expect(finalRead.snapshot.toWire().tasks.map(({ id, lifecycle }) => [id, lifecycle._tag])).toEqual(
        allNames.map((name) => [name, "CompletedSuccessfully"])
      )
      const initialRead = reads.find(({ revision }) => revision === "G5")
      expect(initialRead?.snapshot.toWire().tasks.map(({ id, lifecycle }) => [id, lifecycle._tag])).toEqual(
        allNames.map((name) => [name, name === "A" ? "CompletedSuccessfully" : "Open"])
      )
      expect(
        (yield* Ref.get(fixture.claimCalls)).flatMap((call) => (call._tag === "Complete" ? [call.request.taskId] : []))
      ).toEqual(allNames.filter((name) => name !== "A"))
      expect(finalRead.snapshot.revision).not.toBe("G5")
      expect(fixture.settledA.history._tag).toBe("ValidWorkflowJournalHistory")
      expect(fixture.settledA.folded._tag).toBe("ValidWorkflowJournalHistory")
      expect(reduceWorkflowJournalHistory(fixture.runId, records)._tag).toBe("ValidWorkflowJournalHistory")
      const deleted = records.filter(({ event }) => event._tag === "CompletionClaimDeleted")
      expect(deleted).toHaveLength(allNames.length)
      for (const name of allNames) {
        const settlement = records.find(
          ({ event }) => event._tag === "IntegrationFinalitySettled" && event.claim.plannedAttempt.taskId === name
        )
        const deletion = deleted.find(
          ({ event }) => event._tag === "CompletionClaimDeleted" && event.claim.plannedAttempt.taskId === name
        )
        if (
          settlement?.event._tag !== "IntegrationFinalitySettled" ||
          deletion?.event._tag !== "CompletionClaimDeleted"
        )
          return expect.fail("missing exact finality history")
        const claim = settlement.event.claim
        const successObservation = settlement.event.successObservation
        expect(deletion.event.claim).toEqual(claim)
        expect(settlement.event.deletionOperationId).toBe(deletion.event.operationId)
        expect(settlement.event.successObservation).toEqual(deletion.event.successObservation)
        expect(deriveIntegrationFinalityStateFor(records, claim)?._tag).toBe("IntegrationFinalitySettled")
        expect(settlement.position).toBeGreaterThan(deletion.position)
        expect(deletion.position).toBeGreaterThan(settlement.event.successObservation.observedAt)
        expect(records.find(({ position }) => position === successObservation.observedAt)?.event).toMatchObject({
          _tag: "TaskTrackerFactsObserved",
          observation: {
            _tag: "FocusedTaskCompletionFacts",
            facts: { taskId: name, lifecycle: "CompletedSuccessfully", currentClaim: claim }
          }
        })
        expect(
          records.filter(({ event }) => event._tag === "TaskClaimReleased" && event.release.claim.taskId === name)
        ).toHaveLength(1)
        expect(
          records.some(
            ({ event, position }) =>
              position < deletion.position &&
              event._tag === "CompletionClaimDeletionReadObserved" &&
              event.request.claim.plannedAttempt.taskId === name &&
              event.observation._tag === "CompletionClaimMarkerAbsent"
          )
        ).toBe(true)
        const cleanupReads = records.filter(
          ({ event, position }) =>
            position < deletion.position &&
            event._tag === "CompletionClaimDeletionReadObserved" &&
            event.request.claim.plannedAttempt.taskId === name
        )
        const finalAbsenceReads = cleanupReads.slice(-2)
        expect(
          finalAbsenceReads.map(({ event }) =>
            event._tag === "CompletionClaimDeletionReadObserved" ? event.observation._tag : "WrongOccurrence"
          )
        ).toEqual(["CompletionClaimMarkerAbsent", "UnclaimedTask"])
        for (const { event, position } of finalAbsenceReads) {
          if (event._tag !== "CompletionClaimDeletionReadObserved")
            return expect.fail("missing exact final cleanup read")
          expect(event.request.claim).toEqual(claim)
          expect(event.request.operationId).toBe(deletion.event.operationId)
          expect(position).toBeGreaterThan(successObservation.observedAt)
        }
        if (name !== "A") {
          const calls = yield* Ref.get(fixture.claimCalls)
          const mutations = calls.filter(
            (call) => call._tag === "Delete" && call.request.claim.plannedAttempt.taskId === name
          )
          expect(mutations).toHaveLength(1)
          expect(calls).toContainEqual({
            _tag: "Marker",
            request: { taskId: claim.plannedAttempt.taskId, expectedClaim: claim },
            observation: { _tag: "CompletionClaimMarkerAbsent", taskId: claim.plannedAttempt.taskId }
          })
          expect(calls).toContainEqual({
            _tag: "Active",
            taskId: claim.plannedAttempt.taskId,
            observation: { _tag: "UnclaimedTask", taskId: claim.plannedAttempt.taskId }
          })
        }
      }
    }).pipe(Effect.provide(NodeCrypto.layer)),
  30_000
)

const boundaryCounts = (fixture: Fixture) =>
  Effect.all({
    graphReads: Ref.get(fixture.graphReads),
    specificationReads: Ref.get(fixture.specificationReads),
    claimCalls: Ref.get(fixture.claimCalls),
    commands: Ref.get(fixture.commands),
    integrations: Ref.get(fixture.integrations),
    promotions: Ref.get(fixture.promotions),
    promotionReads: Ref.get(fixture.promotionReads),
    evidenceReads: Ref.get(fixture.evidenceReads),
    appendAttempts: Ref.get(fixture.appendAttempts),
    terminationAttempts: Ref.get(fixture.terminationAttempts),
    runtimeObservations: Ref.get(fixture.runtimeObservations),
    runtimeEntries: Ref.get(fixture.runtimeEntries)
  })

it.effect(
  "obtains a distinct later Gfinal after a crash before termination",
  () =>
    Effect.gen(function* () {
      const fixture = yield* makeIssue278NormalTermination()
      yield* Ref.set(fixture.terminationCut, { _tag: "Armed", at: "FinalGraphObserved" })
      const process = yield* start(fixture)
      yield* deliver(fixture, process)
      expect(yield* Queue.take(fixture.reached)).toBe("FinalGraphObserved")
      const prefix = yield* fixture.journal.read(fixture.runId)
      expect(prefix.at(-1)?.event._tag).toBe("TaskTrackerFactsObserved")
      expect(yield* Ref.get(fixture.terminationAttempts)).toEqual([])
      yield* Fiber.interrupt(process.running)
      yield* Ref.set(fixture.terminationCut, { _tag: "Disabled" })
      const restarted = yield* start(fixture)
      yield* restarted.event((event) => event._tag === "WorkflowRunTerminated")
      const records = yield* fixture.journal.read(fixture.runId)
      expect(records.slice(0, prefix.length)).toEqual(prefix)
      const reads = (yield* Ref.get(fixture.graphReads)).filter(
        ({ intent }) =>
          intent.event._tag === "TaskTrackerReadIntentRecorded" &&
          intent.event.operation._tag === "ReadTrackerGraph" &&
          intent.event.operation.cause._tag === "PostQuiescenceReconfirmation"
      )
      expect(reads).toHaveLength(2)
      expect(reads[1]?.intent.position).toBeGreaterThan(prefix.length)
      const operations = reads.flatMap(({ intent }) =>
        intent.event._tag === "TaskTrackerReadIntentRecorded" ? [intent.event.operation.operationId] : []
      )
      expect(new Set(operations).size).toBe(2)
      expect(records.at(-1)?.event).toMatchObject({
        _tag: "WorkflowRunTerminated",
        disposition: "Completed",
        evidence: { operationId: operations[1], contentIdentity: "Gfinal" }
      })
      expect(yield* Ref.get(fixture.terminationAttempts)).toHaveLength(1)
    }).pipe(Effect.provide(NodeCrypto.layer)),
  30_000
)

it.effect(
  "reconstructs lost termination acknowledgement without another append attempt or boundary call",
  () =>
    Effect.gen(function* () {
      const fixture = yield* makeIssue278NormalTermination()
      yield* Ref.set(fixture.terminationCut, { _tag: "Armed", at: "TerminationAppended" })
      const process = yield* start(fixture)
      yield* deliver(fixture, process)
      expect(yield* Queue.take(fixture.reached)).toBe("TerminationAppended")
      const prefix = yield* fixture.journal.read(fixture.runId)
      expect(prefix.at(-1)?.event._tag).toBe("WorkflowRunTerminated")
      yield* Fiber.interrupt(process.running)
      const before = yield* boundaryCounts(fixture)
      expect(before.terminationAttempts).toHaveLength(1)
      expect(before.runtimeEntries).toBeGreaterThan(0)
      yield* Ref.set(fixture.terminationCut, { _tag: "Disabled" })
      const reentry = yield* Effect.exit(fixture.activate)
      expect(Exit.isFailure(reentry)).toBe(true)
      if (Exit.isFailure(reentry)) expect(Cause.pretty(reentry.cause)).toContain("WorkflowRunAlreadyTerminated")
      expect(yield* fixture.journal.read(fixture.runId)).toEqual(prefix)
      expect(yield* boundaryCounts(fixture)).toEqual(before)
      expect(yield* Ref.get(fixture.processEndRequests)).toBe(0)
    }).pipe(Effect.provide(NodeCrypto.layer)),
  30_000
)
