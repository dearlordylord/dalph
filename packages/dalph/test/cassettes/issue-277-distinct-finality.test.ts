import { it } from "@effect/vitest"
import { NodeCrypto } from "@effect/platform-node"
import { Effect, Queue, Ref, Fiber, Deferred } from "effect"
import { expect } from "vitest"
import { TaskId, IntegrationTargetRef } from "@dalph/contracts"
import {
  type WorkflowJournalEvent as WorkflowEvent,
  type JournalRecord,
  type IntegratorRunCorrelation
} from "@dalph/orchestrator"
import { makeIssue277DistinctFinality, type Issue277Cut } from "../../test-support/issue-277-distinct-finality.js"
import type { SixTaskCandidateRead } from "../../test-support/six-task-integrator-git.js"

type Fixture = Effect.Success<ReturnType<typeof makeIssue277DistinctFinality>>
const names = ["B", "C", "D", "E", "F", "G"] as const

const expectPreparedSession = (actual: IntegratorRunCorrelation, fixed: IntegratorRunCorrelation["session"]) =>
  expect(actual.session).toEqual(fixed)
const expectCandidateRead = (actual: SixTaskCandidateRead, expected: SixTaskCandidateRead) =>
  expect(actual).toEqual(expected)

const start = Effect.fn("Issue277Test.start")(function* (fixture: Fixture) {
  const running = yield* fixture.activate.pipe(Effect.forkScoped)
  const take = <A>(queue: Queue.Dequeue<A>) =>
    Queue.take(queue).pipe(
      Effect.raceFirst(Fiber.join(running).pipe(Effect.andThen(Effect.die("runtime exited before checkpoint"))))
    )
  const event = (matches: (event: WorkflowEvent) => boolean) =>
    Effect.gen(function* () {
      for (;;) {
        const next = yield* take(fixture.events)
        if (matches(next)) return next
      }
    })
  const held = (expected: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      for (;;) {
        const bundle = yield* take(fixture.publicationQueue)
        if (
          JSON.stringify(bundle.actionInputs.runtimeFacts.taskWork.held.map(({ taskId }) => taskId).toSorted()) ===
          JSON.stringify(expected.toSorted())
        )
          return
      }
    })
  return { running, take, event, held }
})

const release = (fixture: Fixture, name: (typeof names)[number]) => {
  const latch = fixture.releaseIntegration.get(TaskId.make(name))
  return latch === undefined ? Effect.die("missing exact Integrator release") : Deferred.succeed(latch, undefined)
}
const isSettled = (name: string) => (event: WorkflowEvent) =>
  event._tag === "IntegrationFinalitySettled" && event.claim.plannedAttempt.taskId === name

const expectOrdinary = (records: ReadonlyArray<JournalRecord>) => {
  expect(records.filter(({ event }) => /Quarantin|SuccessorSession|WorkflowRunTerminated/.test(event._tag))).toEqual([])
}

it.effect(
  "settles B through G through distinct Integrator qualification promotion focused success and exact claim deletion paths",
  () =>
    Effect.gen(function* () {
      const fixture = yield* makeIssue277DistinctFinality()
      const process = yield* start(fixture)
      yield* process.held(["B", "C", "D"])
      for (const [name, held] of [
        ["B", ["C", "D", "E"]],
        ["C", ["D", "E", "F"]],
        ["D", ["E", "F", "G"]],
        ["E", ["F", "G"]],
        ["F", ["G"]],
        ["G", []]
      ] as const) {
        yield* fixture.terminal(name)
        yield* process.held(held)
      }
      for (const name of names) {
        const run = yield* process.take(fixture.integrationEntered)
        expect(run.session.plannedAttempt.taskId).toBe(name)
        yield* release(fixture, name)
        yield* process.event(isSettled(name))
      }
      expect(yield* process.take(fixture.reached)).toEqual({ _tag: "Finished" })
      yield* Fiber.interrupt(process.running)
      const records = yield* fixture.journal.read(fixture.runId)
      const runs = yield* Ref.get(fixture.integrations)
      const candidateReads = yield* Ref.get(fixture.candidateReads)
      expect(candidateReads).toHaveLength(names.length)
      const calls = yield* Ref.get(fixture.calls)
      const promotions = yield* Ref.get(fixture.promotions)
      const promotionReads = yield* Ref.get(fixture.promotionReads)
      const evidenceReads = yield* Ref.get(fixture.evidenceReads)
      expect(runs.map(({ session }) => session.plannedAttempt.taskId)).toEqual(names)
      expect(promotions).toHaveLength(names.length)
      const settled = records.filter(({ event }) => event._tag === "IntegrationFinalitySettled")
      expect(settled).toHaveLength(names.length)
      for (const values of [
        runs.map(({ session }) => session.sessionId),
        runs.map(({ session }) => session.candidateResource),
        runs.map(({ session }) => session.plannedAttempt.attemptId),
        runs.map(({ session }) => session.acceptedResult.commit),
        runs.map(({ session }) => JSON.stringify(session.acceptedResult.evidenceManifest)),
        promotions.map(({ candidateCommit }) => candidateCommit),
        calls.flatMap((call) => (call._tag === "Complete" ? [call.request.operationId] : [])),
        calls.flatMap((call) => (call._tag === "Replace" ? [JSON.stringify(call.request.claim)] : [])),
        calls.flatMap((call) => (call._tag === "Replace" ? [call.request.operationId] : [])),
        calls.flatMap((call) => (call._tag === "Delete" ? [call.request.operationId] : [])),
        calls.flatMap((call) => (call._tag === "ReleaseOriginal" ? [call.request.operationId] : [])),
        calls.flatMap((call) => (call._tag === "Delete" ? [call.request.claim.promotionCorrelation.requestId] : [])),
        calls.flatMap((call) => (call._tag === "Delete" ? [call.request.successObservation.operationId] : [])),
        calls.flatMap((call) => (call._tag === "Delete" ? [String(call.request.successObservation.observedAt)] : [])),
        calls.flatMap((call) => (call._tag === "Delete" ? [call.request.successObservation.trackerRevision] : []))
      ])
        expect(new Set(values).size).toBe(names.length)
      for (const [index, name] of names.entries()) {
        const run = runs[index]
        const expected = fixture.facts.taskFacts[name]
        if (run === undefined) return expect.fail("missing task integration")
        const fixed = records.find(
          ({ event }) => event._tag === "IntegratorSessionFixed" && event.correlation.plannedAttempt.taskId === name
        )
        const returned = records.find(
          ({ event }) =>
            event._tag === "IntegratorRunResultRecorded" && event.run.session.plannedAttempt.taskId === name
        )
        const candidateRead = candidateReads[index]
        if (
          fixed?.event._tag !== "IntegratorSessionFixed" ||
          returned?.event._tag !== "IntegratorRunResultRecorded" ||
          returned.event.result._tag !== "PreparedCandidate" ||
          candidateRead === undefined
        )
          return expect.fail("missing fixed session, prepared result, or actual Git read")
        const fixedSession = fixed.event.correlation
        expectPreparedSession(run, fixedSession)
        const expectedRead = {
          target: fixed.event.correlation.integrationTarget,
          candidateText: returned.event.result.candidateText
        }
        expectCandidateRead(candidateRead, expectedRead)
        const foreignRun = runs.find(({ session }) => session.plannedAttempt.taskId !== name)
        if (foreignRun === undefined) return expect.fail("missing another task for the resource-swap control")
        const swappedPreparation = {
          ...run,
          session: { ...run.session, candidateResource: foreignRun.session.candidateResource }
        }
        expect(() => expectPreparedSession(swappedPreparation, fixedSession)).toThrow()
        const wrongTargetRead = {
          ...candidateRead,
          target: { ...candidateRead.target, ref: IntegrationTargetRef.make("refs/heads/foreign") }
        }
        expect(() => expectCandidateRead(wrongTargetRead, expectedRead)).toThrow()
        const previous = index === 0 ? fixture.facts.baseSha : promotions[index - 1]?.candidateCommit
        expect(run.session.expectedTargetHead).toBe(previous)
        expect(run.session.acceptedResult.commit).toBe(expected.acceptedCommit)
        expect(promotions[index]).toEqual({
          integrationTarget: fixture.facts.integrationTarget,
          expectedTargetHead: previous,
          candidateCommit: expected.candidateCommit
        })
        const readsForCandidate = promotionReads.filter(
          ({ candidateCommit }) => candidateCommit === expected.candidateCommit
        )
        expect(readsForCandidate.length).toBeGreaterThan(0)
        for (const read of readsForCandidate) expect(read).toEqual(promotions[index])
        expect(run.ordinal).toBe(1)
        expect(evidenceReads).toContainEqual(run.session.acceptedResult.evidenceManifest)
        const candidates = records.filter(
          ({ event }) =>
            event._tag === "IntegratorRunCandidateGitObserved" && event.run.session.plannedAttempt.taskId === name
        )
        expect(candidates).toHaveLength(1)
        const candidate = candidates[0]?.event
        if (candidate?._tag !== "IntegratorRunCandidateGitObserved" || candidate.observation._tag !== "Commit")
          return expect.fail("missing exact candidate")
        expect(candidate.run).toEqual(run)
        expect(candidate.observation.commit).toBe(expected.candidateCommit)
        expect(candidate.observation.directParents).toEqual([previous, expected.acceptedCommit])
        const completed = calls.filter((call) => call._tag === "Complete" && call.request.taskId === name)
        const deleted = calls.filter(
          (call) => call._tag === "Delete" && call.request.claim.plannedAttempt.taskId === name
        )
        const replaced = calls.filter(
          (call) => call._tag === "Replace" && call.request.claim.plannedAttempt.taskId === name
        )
        expect(completed).toHaveLength(1)
        expect(deleted).toHaveLength(1)
        expect(replaced).toHaveLength(1)
        const completion = completed[0]
        const deletion = deleted[0]
        const replacement = replaced[0]
        if (completion?._tag !== "Complete" || deletion?._tag !== "Delete" || replacement?._tag !== "Replace")
          return expect.fail("missing exact finality calls")
        expect(completion.request.claim).toEqual(replacement.request.claim)
        expect(deletion.request.claim).toEqual(replacement.request.claim)
        expect(deletion.request.claim.promotionCorrelation.qualifiedCandidate.run).toEqual(run)
        const settlement = settled.find(
          ({ event }) => event._tag === "IntegrationFinalitySettled" && event.claim.plannedAttempt.taskId === name
        )
        if (settlement?.event._tag !== "IntegrationFinalitySettled") return expect.fail("missing exact settlement")
        expect(settlement.event.claim).toEqual(deletion.request.claim)
        expect(settlement.event.deletionOperationId).toBe(deletion.request.operationId)
        expect(settlement.event.replacementOperationId).toBe(replacement.request.operationId)
        expect(settlement.event.successObservation).toEqual(deletion.request.successObservation)
        const positionOf = (matches: (event: WorkflowEvent) => boolean) => {
          const matching = records.filter(({ event }) => matches(event))
          expect(matching).toHaveLength(1)
          const record = matching[0]
          if (record === undefined) return expect.fail("missing exact chronological occurrence")
          return record.position
        }
        const promotion = deletion.request.claim.promotionCorrelation
        const ordered = [
          positionOf(
            (event) =>
              event._tag === "PlannedAttemptExecutorWorkReported" &&
              event.report._tag === "ExecutorWorkTerminal" &&
              event.report.correlation.attemptId === run.session.plannedAttempt.attemptId
          ),
          positionOf(
            (event) => event._tag === "IntegrationResponsibilityBegan" && event.plannedAttempt.taskId === name
          ),
          positionOf(
            (event) => event._tag === "IntegratorSessionFixed" && event.correlation.sessionId === run.session.sessionId
          ),
          positionOf(
            (event) => event._tag === "IntegratorRunStarted" && event.run.session.sessionId === run.session.sessionId
          ),
          positionOf(
            (event) =>
              event._tag === "IntegratorRunResultRecorded" && event.run.session.sessionId === run.session.sessionId
          ),
          positionOf(
            (event) =>
              event._tag === "IntegratorRunCandidateGitObserved" &&
              event.run.session.sessionId === run.session.sessionId
          ),
          positionOf(
            (event) => event._tag === "TargetPromotionIntended" && event.correlation.requestId === promotion.requestId
          ),
          positionOf(
            (event) =>
              event._tag === "TargetPromotionAttemptIntended" && event.correlation.requestId === promotion.requestId
          ),
          positionOf(
            (event) =>
              event._tag === "TargetPromotionObservedSuccess" && event.correlation.requestId === promotion.requestId
          ),
          positionOf(
            (event) =>
              event._tag === "CompletionClaimReplacementIntended" &&
              event.operationId === replacement.request.operationId
          ),
          positionOf(
            (event) => event._tag === "CompletionClaimReplaced" && event.operationId === replacement.request.operationId
          ),
          positionOf(
            (event) =>
              event._tag === "CompletionTaskIntended" && event.request.operationId === completion.request.operationId
          ),
          positionOf(
            (event) =>
              event._tag === "CompletionTaskAttemptIntended" &&
              event.request.operationId === completion.request.operationId
          ),
          positionOf(
            (event) =>
              event._tag === "CompletionTaskAcknowledged" &&
              event.request.operationId === completion.request.operationId
          ),
          deletion.request.successObservation.observedAt,
          positionOf(
            (event) =>
              event._tag === "CompletionClaimDeletionIntended" && event.operationId === deletion.request.operationId
          ),
          positionOf((event) => event._tag === "TaskClaimReleased" && event.release.claim.taskId === name),
          positionOf(
            (event) => event._tag === "CompletionClaimDeleted" && event.operationId === deletion.request.operationId
          ),
          settlement.position
        ]
        expect(ordered.every((position, index) => index === 0 || position > (ordered[index - 1] ?? position))).toBe(
          true
        )
        const acknowledged = records.find(
          ({ event }) => event._tag === "CompletionTaskAcknowledged" && event.request.taskId === name
        )
        const absence = records.find(
          ({ event }) => event._tag === "CompletionClaimDeleted" && event.claim.plannedAttempt.taskId === name
        )
        expect(deletion.request.successObservation.observedAt).toBeGreaterThan(
          acknowledged?.position ?? Number.MAX_SAFE_INTEGER
        )
        expect(absence?.position).toBeGreaterThan(deletion.request.successObservation.observedAt)
        expect(settlement.position).toBeGreaterThan(absence?.position ?? Number.MAX_SAFE_INTEGER)
        const focused = calls.find(
          (call) =>
            call._tag === "Focused" && call.facts.operationId === deletion.request.successObservation.operationId
        )
        expect(focused).toMatchObject({
          _tag: "Focused",
          facts: { taskId: name, lifecycle: "CompletedSuccessfully", currentClaim: deletion.request.claim }
        })
        const deleteIndex = calls.indexOf(deletion)
        const original = calls.filter((call) => call._tag === "ReleaseOriginal" && call.request.claim.taskId === name)
        expect(original).toHaveLength(1)
        expect(original[0]).toMatchObject({
          _tag: "ReleaseOriginal",
          request: { claim: deletion.request.claim.originalClaim }
        })
        expect(calls.indexOf(completion)).toBeLessThan(calls.indexOf(focused ?? deletion))
        expect(calls.indexOf(focused ?? deletion)).toBeLessThan(calls.indexOf(original[0] ?? deletion))
        expect(calls.indexOf(original[0] ?? deletion)).toBeLessThan(deleteIndex)
        expect(
          calls
            .slice(deleteIndex + 1)
            .some((call) => call._tag === "Active" && call.taskId === name && call.observation._tag === "UnclaimedTask")
        ).toBe(true)
        const bytes = yield* fixture.evidence.read(run.session.acceptedResult.evidenceManifest)
        expect(bytes).toBeDefined()
      }
      expect(yield* Ref.get(fixture.head)).toBe(fixture.facts.taskFacts.G.candidateCommit)
      expectOrdinary(records)
    }).pipe(Effect.provide(NodeCrypto.layer)),
  30_000
)

const beforeD = Effect.fn("Issue277Test.beforeD")(function* () {
  const fixture = yield* makeIssue277DistinctFinality()
  const process = yield* start(fixture)
  yield* process.held(["B", "C", "D"])
  for (const name of ["B", "C"] as const) {
    yield* fixture.terminal(name)
    yield* process.take(fixture.integrationEntered)
    yield* release(fixture, name)
    yield* process.event(isSettled(name))
  }
  return { fixture, process }
})

for (const cut of [
  "AcceptedResult",
  "IntegratorResult",
  "PromotionIntent",
  "Promotion",
  "CompletionRequest",
  "CompletionAcknowledgement",
  "ClaimDeletionIntent",
  "ClaimDeletion"
] satisfies ReadonlyArray<Issue277Cut>) {
  it.effect(
    `recovers D after ${cut} without duplicating delivery effects`,
    () =>
      Effect.gen(function* () {
        const { fixture, process } = yield* beforeD()
        yield* Ref.set(fixture.finalityCut, { _tag: "Armed", at: cut, attemptId: fixture.facts.taskFacts.D.attemptId })
        yield* release(fixture, "D")
        yield* fixture.terminal("D")
        expect(yield* Queue.take(fixture.reached)).toEqual({ _tag: "Crash", at: cut })
        const prefix = yield* fixture.journal.read(fixture.runId)
        const prefixCalls = yield* Ref.get(fixture.calls)
        const prefixPromotions = yield* Ref.get(fixture.promotions)
        expect(prefix.some(({ event }) => isSettled("D")(event))).toBe(false)
        if (cut === "CompletionRequest") {
          expect(
            prefix.filter(({ event }) => event._tag === "CompletionTaskAcknowledged" && event.request.taskId === "D")
          ).toEqual([])
          expect(prefixCalls.filter((call) => call._tag === "Complete" && call.request.taskId === "D")).toHaveLength(1)
          expect(
            prefixCalls.filter(
              (call) =>
                call._tag === "Focused" && call.facts.taskId === "D" && call.facts.lifecycle === "CompletedSuccessfully"
            )
          ).toEqual([])
        }
        yield* Fiber.interrupt(process.running)
        yield* Ref.set(fixture.finalityCut, { _tag: "Disabled" })
        const restarted = yield* start(fixture)
        yield* restarted.event(isSettled("D"))
        yield* Fiber.interrupt(restarted.running)
        const records = yield* fixture.journal.read(fixture.runId)
        expect(records.slice(0, prefix.length)).toEqual(prefix)
        expect(records.filter(({ event }) => isSettled("D")(event))).toHaveLength(1)
        expect((yield* Ref.get(fixture.commands)).filter(({ taskId }) => taskId === "D")).toHaveLength(1)
        expect(
          (yield* Ref.get(fixture.integrations)).filter(({ session }) => session.plannedAttempt.taskId === "D")
        ).toHaveLength(1)
        expect(
          (yield* Ref.get(fixture.promotions)).filter(
            ({ candidateCommit }) => candidateCommit === fixture.facts.taskFacts.D.candidateCommit
          )
        ).toHaveLength(1)
        const calls = yield* Ref.get(fixture.calls)
        expect(
          calls.filter((call) => call._tag === "ReleaseOriginal" && call.request.claim.taskId === "D")
        ).toHaveLength(1)
        const original = (yield* Ref.get(fixture.commands)).find(({ taskId }) => taskId === "D")
        const run = (yield* Ref.get(fixture.integrations)).find(({ session }) => session.plannedAttempt.taskId === "D")
        const settlement = records.find(({ event }) => isSettled("D")(event))
        if (run === undefined || original === undefined || settlement?.event._tag !== "IntegrationFinalitySettled")
          return expect.fail("missing recovered D identity")
        expect(run.session.plannedAttempt).toEqual(original)
        expect(run.session.expectedTargetHead).toBe(fixture.facts.taskFacts.C.candidateCommit)
        expect(run.session.acceptedResult.commit).toBe(fixture.facts.taskFacts.D.acceptedCommit)
        expect(settlement.event.claim.plannedAttempt).toEqual(original)
        expect(settlement.event.claim.promotionCorrelation.qualifiedCandidate.run).toEqual(run)
        expect(settlement.event.claim.promotionCorrelation.qualifiedCandidate.candidateCommit).toBe(
          fixture.facts.taskFacts.D.candidateCommit
        )
        expect(
          records.filter(
            ({ event }) => event._tag === "IntegratorSessionFixed" && event.correlation.plannedAttempt.taskId === "D"
          )
        ).toHaveLength(1)
        for (const { event } of prefix) {
          if (event._tag === "IntegratorSessionFixed" && event.correlation.plannedAttempt.taskId === "D")
            expect(event.correlation).toEqual(run.session)
          if (
            event._tag === "PlannedAttemptExecutorWorkReported" &&
            event.report._tag === "ExecutorWorkTerminal" &&
            event.report.correlation.attemptId === original.attemptId
          )
            expect(event.report.result).toEqual({ _tag: "Accepted", acceptedResult: run.session.acceptedResult })
        }
        if (cut === "CompletionRequest") {
          const recovery = calls.slice(prefixCalls.length)
          const confirmations = recovery.filter((call) => call._tag === "Focused")
          expect(confirmations).toHaveLength(1)
          expect(confirmations[0]).toMatchObject({
            _tag: "Focused",
            facts: {
              lifecycle: "CompletedSuccessfully",
              currentClaim: settlement.event.claim,
              taskId: original.taskId,
              taskRevision: original.taskRevision,
              target: fixture.facts.target,
              operationId: settlement.event.successObservation.operationId,
              trackerRevision: settlement.event.successObservation.trackerRevision
            }
          })
          expect(calls.filter((call) => call._tag === "Lookup")).toEqual([])
          expect(recovery.filter((call) => call._tag === "Complete")).toEqual([])
          const markers = recovery.filter((call) => call._tag === "Marker")
          expect(recovery.map((call) => call._tag)).toEqual([
            "Focused",
            "Marker",
            "Active",
            "ReleaseOriginal",
            "Active",
            "Marker",
            "Active",
            "Delete",
            "Marker",
            "Active"
          ])
          expect(markers).toHaveLength(3)
          for (const marker of markers.slice(0, 2))
            expect(marker).toEqual({
              _tag: "Marker",
              request: { taskId: original.taskId, expectedClaim: settlement.event.claim },
              observation: settlement.event.claim
            })
          expect(markers[2]).toEqual({
            _tag: "Marker",
            request: { taskId: original.taskId, expectedClaim: settlement.event.claim },
            observation: { _tag: "CompletionClaimMarkerAbsent", taskId: original.taskId }
          })
          const confirmationIndex = recovery.findIndex((call) => call._tag === "Focused")
          const releaseIndex = recovery.findIndex((call) => call._tag === "ReleaseOriginal")
          const deletionIndex = recovery.findIndex((call) => call._tag === "Delete")
          const markerIndices = recovery.flatMap((call, index) => (call._tag === "Marker" ? [index] : []))
          expect(markerIndices[0]).toBeGreaterThan(confirmationIndex)
          expect(releaseIndex).toBeGreaterThan(markerIndices[0] ?? Number.MAX_SAFE_INTEGER)
          expect(markerIndices[1]).toBeGreaterThan(releaseIndex)
          expect(deletionIndex).toBeGreaterThan(markerIndices[1] ?? Number.MAX_SAFE_INTEGER)
        }
        if (cut === "ClaimDeletion") {
          expect(calls).toEqual(prefixCalls)
          expect(yield* Ref.get(fixture.promotions)).toEqual(prefixPromotions)
        }
        for (const tag of ["Complete", "Delete", "Replace"] as const)
          expect(
            calls.filter((call) => call._tag === tag && call.request.claim.plannedAttempt.taskId === "D")
          ).toHaveLength(1)
        expect(
          records.filter(
            ({ event }) =>
              event._tag === "PlannedAttemptExecutorWorkReported" &&
              event.report._tag === "ExecutorWorkTerminal" &&
              event.report.correlation.attemptId === fixture.facts.taskFacts.D.attemptId
          )
        ).toHaveLength(1)
        expectOrdinary(records)
      }).pipe(Effect.provide(NodeCrypto.layer)),
    30_000
  )
}

it.effect(
  "waits for focused success and exact claim absence before settling B",
  () =>
    Effect.gen(function* () {
      for (const cut of ["CompletionAcknowledgement", "MarkerDeletion"] as const) {
        const fixture = yield* makeIssue277DistinctFinality()
        const process = yield* start(fixture)
        yield* process.held(["B", "C", "D"])
        yield* Ref.set(fixture.finalityCut, { _tag: "Armed", at: cut, attemptId: fixture.facts.taskFacts.B.attemptId })
        yield* release(fixture, "B")
        yield* fixture.terminal("B")
        expect(yield* Queue.take(fixture.reached)).toEqual({ _tag: "Crash", at: cut })
        yield* Fiber.interrupt(process.running)
        const prefix = yield* fixture.journal.read(fixture.runId)
        const calls = yield* Ref.get(fixture.calls)
        expect(
          prefix.filter(
            ({ event }) => event._tag === "CompletionClaimDeleted" || event._tag === "IntegrationFinalitySettled"
          )
        ).toEqual([])
        if (cut === "CompletionAcknowledgement") {
          expect(calls.filter((call) => call._tag === "Complete")).toHaveLength(1)
          expect(
            calls.filter((call) => call._tag === "Focused" && call.facts.lifecycle === "CompletedSuccessfully")
          ).toEqual([])
          expect(calls.filter((call) => call._tag === "Delete")).toEqual([])
        } else {
          expect(calls.at(-1)?._tag).toBe("Delete")
          expect(calls.filter((call) => call._tag === "Delete")).toHaveLength(1)
        }
        yield* Ref.set(fixture.finalityCut, { _tag: "Disabled" })
        const restarted = yield* start(fixture)
        yield* restarted.event(isSettled("B"))
        yield* Fiber.interrupt(restarted.running)
        const recoveredCalls = yield* Ref.get(fixture.calls)
        expect(recoveredCalls.filter((call) => call._tag === "Delete")).toHaveLength(1)
        if (cut === "MarkerDeletion") {
          const deletion = calls.at(-1)
          if (deletion?._tag !== "Delete") return expect.fail("missing the exact interrupted marker deletion")
          expect(recoveredCalls.slice(calls.length)).toEqual([
            {
              _tag: "Marker",
              request: { taskId: deletion.request.claim.plannedAttempt.taskId, expectedClaim: deletion.request.claim },
              observation: { _tag: "CompletionClaimMarkerAbsent", taskId: deletion.request.claim.plannedAttempt.taskId }
            },
            {
              _tag: "Active",
              taskId: deletion.request.claim.plannedAttempt.taskId,
              observation: { _tag: "UnclaimedTask", taskId: deletion.request.claim.plannedAttempt.taskId }
            }
          ])
          expect(recoveredCalls.filter((call) => call._tag === "ReleaseOriginal")).toHaveLength(1)
          expect(recoveredCalls.filter((call) => call._tag === "Complete")).toHaveLength(1)
          expect(recoveredCalls.filter((call) => call._tag === "Lookup")).toEqual([])
        }
      }
    }).pipe(Effect.provide(NodeCrypto.layer)),
  30_000
)
