import { NodeCrypto, NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { GitCommitSha } from "@dalph/contracts"
import {
  GitCommand,
  CompletionTaskRequest,
  JournalDatabaseLocator,
  JournalStore,
  nodeGitCommandLayer,
  sqliteJournalStoreLayer
} from "@dalph/orchestrator"
import { Context, Effect, Layer, MutableList, Queue, Schema } from "effect"
import { expect } from "vitest"
import { createHermeticFixture } from "../../test-support/production-hermetic-fixture.js"
import {
  makeHermeticController,
  type HermeticControllerFixture,
  type HermeticPublicChild
} from "../../test-support/production-hermetic-controller.js"
import { disposeHermeticFixture } from "../../test-support/production-hermetic-fixture-cleanup.js"

const builtEntry = new URL("../../dist/bin/production-hermetic-qualification.js", import.meta.url).pathname
const fixtureLayer = nodeGitCommandLayer.pipe(Layer.provideMerge(NodeServices.layer), Layer.merge(NodeCrypto.layer))
const sourceBaseSha = GitCommitSha.make("bf027ef1588d0ec0d0e749b812d6652343682c3b")

const selectedOf = Effect.fn("HermeticQualification.selectedRun")(function* (child: HermeticPublicChild) {
  const selected = MutableList.toArray(child.recordLog).find((record) => record._tag === "RunSelected")
  if (selected === undefined) return yield* Effect.die("the actual child must select a Run")
  return selected
})

const readJournal = Effect.fn("HermeticQualification.readJournal")(function* (
  fixture: HermeticControllerFixture,
  child: HermeticPublicChild
) {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const storage = yield* Layer.build(
        sqliteJournalStoreLayer({ filename: JournalDatabaseLocator.make(fixture.manifest.journalDatabase) })
      )
      return yield* Context.get(storage, JournalStore).read((yield* selectedOf(child)).runId)
    })
  )
})

const awaitWaitingStatus = Effect.fn("HermeticQualification.awaitWaitingStatus")(function* (
  child: HermeticPublicChild
) {
  for (;;) {
    const record = yield* Queue.take(child.records)
    if (record._tag !== "CurrentStatus" || record.status._tag !== "DeliveryStatusAvailable") continue
    if (record.status.entries.some(({ classification }) => classification === "Waiting")) return record.status
  }
})

const closeCount = (counts: ReadonlyArray<{ readonly tag: string; readonly count: number }>) =>
  counts.find(({ tag }) => tag === "CloseIssue")?.count ?? 0

it.live(
  "built hermetic production CLI uses real SQLite and local Git with controlled outer providers",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* createHermeticFixture(builtEntry, sourceBaseSha)
        const controller = yield* makeHermeticController(fixture, {
          _tag: "PauseAt",
          boundary: "PromotionCompareAndSet"
        })
        const child = yield* controller.startChild()
        const boundary = yield* controller
          .awaitBoundary("PromotionCompareAndSet", child)
          .pipe(Effect.timeout("20 seconds"))
        expect(boundary._tag).toBe("PromotionCompareAndSet")
        if (boundary._tag !== "PromotionCompareAndSet") return yield* Effect.die("wrong concrete promotion boundary")
        expect(yield* controller.activeRequestCount).toBeGreaterThan(0)
        const liveDisposal = yield* disposeHermeticFixture(fixture, controller)
        expect(liveDisposal._tag).toBe("RetainedFixture")
        if (liveDisposal._tag === "RetainedFixture") {
          expect(liveDisposal.cause._tag).toBe("ChildrenRunning")
          expect(liveDisposal.retained).toEqual(fixture.creation.createdResources)
          expect(liveDisposal.removed).toEqual([])
        }
        const git = yield* GitCommand
        const before = yield* git.runInWorktree(fixture.manifest.repository, [
          "rev-parse",
          fixture.manifest.integrationRef
        ])
        expect(before.stdout.trim()).toBe(boundary.expectedTargetHead)
        expect(boundary.expectedTargetHead).toBe(fixture.manifest.baseSha)
        const parents = yield* git.runInWorktree(fixture.manifest.repository, [
          "show",
          "-s",
          "--format=%P",
          boundary.candidateCommit
        ])
        expect(parents.stdout.trim().split(" ")).toHaveLength(2)
        expect(parents.stdout.trim().split(" ")[0]).toBe(fixture.manifest.baseSha)
        yield* controller.releaseBoundary()
        const exitCode = yield* controller.awaitChild(child).pipe(Effect.timeout("20 seconds"))
        expect(exitCode).toBe(0)
        const after = yield* git.runInWorktree(fixture.manifest.repository, [
          "rev-parse",
          fixture.manifest.integrationRef
        ])
        expect(after.stdout.trim()).toBe(boundary.candidateCommit)
        const records = MutableList.toArray(child.recordLog)
        expect(records.some((record) => record._tag === "CurrentStatus")).toBe(true)
        expect((yield* controller.providerSnapshot).taskLifecycle).toBe("Completed")
        const journal = yield* readJournal(fixture, child)
        expect(journal.filter(({ event }) => event._tag === "WorkflowRunBegan")).toHaveLength(1)
        expect(journal.filter(({ event }) => event._tag === "TargetPromotionObservedSuccess")).toHaveLength(1)
        const acceptedCommits = journal.flatMap(({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkReported" &&
          event.report._tag === "ExecutorWorkTerminal" &&
          event.report.result._tag === "Accepted"
            ? [event.report.result.acceptedResult.commit]
            : []
        )
        expect(acceptedCommits).toHaveLength(1)
        expect(parents.stdout.trim().split(" ")).toEqual([fixture.manifest.baseSha, acceptedCommits[0]])
        const disposal = yield* disposeHermeticFixture(fixture, controller)
        expect(yield* controller.activeRequestCount).toBe(0)
        expect(disposal._tag).toBe("RetainedFixture")
        if (disposal._tag === "RetainedFixture") {
          expect(disposal.cause._tag).toBe("ChangedIdentity")
          if (disposal.cause._tag === "ChangedIdentity") expect(disposal.cause.resource._tag).toBe("PrivateStore")
          expect(disposal.retained).toEqual(fixture.creation.createdResources)
        }
      })
    ).pipe(Effect.provide(fixtureLayer)),
  { timeout: 60_000 }
)

it.live(
  "completion-response cut kills P1 and recovers the same Run with parent provider state",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* createHermeticFixture(builtEntry, sourceBaseSha)
        const controller = yield* makeHermeticController(fixture, { _tag: "PauseAt", boundary: "CompletionResponse" })
        const first = yield* controller.startChild()
        const boundary = yield* controller.awaitBoundary("CompletionResponse", first).pipe(Effect.timeout("20 seconds"))
        expect(boundary._tag).toBe("CompletionResponse")
        const before = yield* controller.providerSnapshot
        expect(yield* controller.activeRequestCount).toBeGreaterThan(0)
        expect(before.taskLifecycle).toBe("Completed")
        expect(closeCount(before.operationCounts)).toBe(1)
        const original = yield* selectedOf(first)
        yield* controller.killChild(first)
        yield* controller.releaseBoundary()
        const second = yield* controller.startChild()
        expect(yield* controller.awaitChild(second).pipe(Effect.timeout("20 seconds"))).toBe(0)
        expect(yield* selectedOf(second)).toMatchObject({ runId: original.runId, selection: "Recovered" })
        expect(closeCount((yield* controller.providerSnapshot).operationCounts)).toBe(1)
        const journal = yield* readJournal(fixture, second)
        expect(journal.filter(({ event }) => event._tag === "WorkflowRunBegan")).toHaveLength(1)
        expect(journal.filter(({ event }) => event._tag === "TargetPromotionObservedSuccess")).toHaveLength(1)
        expect((yield* disposeHermeticFixture(fixture, controller))._tag).toBe("RetainedFixture")
        expect(yield* controller.activeRequestCount).toBe(0)
      })
    ).pipe(Effect.provide(fixtureLayer)),
  { timeout: 60_000 }
)

it.live(
  "promotion-CAS cut preserves a real foreign head and waits until graceful Exit",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* createHermeticFixture(builtEntry, sourceBaseSha)
        const controller = yield* makeHermeticController(fixture, {
          _tag: "PauseAt",
          boundary: "PromotionCompareAndSet"
        })
        const child = yield* controller.startChild()
        const boundary = yield* controller
          .awaitBoundary("PromotionCompareAndSet", child)
          .pipe(Effect.timeout("20 seconds"))
        if (boundary._tag !== "PromotionCompareAndSet") return yield* Effect.die("wrong concrete CAS cut")
        const git = yield* GitCommand
        const foreign = yield* git.runInWorktree(fixture.manifest.repository, [
          "commit-tree",
          `${fixture.manifest.baseSha}^{tree}`,
          "-p",
          fixture.manifest.baseSha,
          "-m",
          "foreign head"
        ])
        expect(foreign.exitCode).toBe(0)
        const foreignHead = GitCommitSha.make(foreign.stdout.trim())
        const moved = yield* git.runInWorktree(fixture.manifest.repository, [
          "update-ref",
          fixture.manifest.integrationRef,
          foreignHead,
          fixture.manifest.baseSha
        ])
        expect(moved.exitCode).toBe(0)
        yield* controller.releaseBoundary()
        const stale = yield* Effect.gen(function* () {
          for (;;) {
            const record = yield* Queue.take(child.records)
            if (record._tag !== "HistoricalSnapshot") continue
            const observed = record.snapshot.items.find(({ occurrence }) => occurrence._tag === "TargetPromotionStale")
            if (observed !== undefined) return observed
          }
        }).pipe(Effect.timeout("20 seconds"))
        expect(stale.occurrence).toMatchObject({
          observation: { _tag: "CompareAndSetRejected", observedHeadSha: foreignHead }
        })
        expect(yield* child.handle.isRunning).toBe(true)
        yield* controller.terminateChild(child)
        expect(yield* controller.awaitChild(child).pipe(Effect.timeout("20 seconds"))).toBe(0)
        const journal = yield* readJournal(fixture, child)
        expect(journal.find(({ event }) => event._tag === "TargetPromotionStale")?.position).toBe(
          stale.identity.position
        )
        expect(journal.some(({ event }) => event._tag === "WorkflowRunTerminated")).toBe(false)
        const original = yield* selectedOf(child)
        const second = yield* controller.startChild()
        const waiting = yield* awaitWaitingStatus(second).pipe(Effect.timeout("20 seconds"))
        expect(waiting.subject).toEqual({ _tag: "Run", runId: original.runId })
        expect(yield* selectedOf(second)).toMatchObject({ runId: original.runId, selection: "Recovered" })
        yield* controller.terminateChild(second)
        expect(yield* controller.awaitChild(second).pipe(Effect.timeout("20 seconds"))).toBe(0)
        const after = yield* git.runInWorktree(fixture.manifest.repository, [
          "rev-parse",
          fixture.manifest.integrationRef
        ])
        expect(after.stdout.trim()).toBe(foreignHead)
        expect(closeCount((yield* controller.providerSnapshot).operationCounts)).toBe(0)
        expect((yield* disposeHermeticFixture(fixture, controller))._tag).toBe("RetainedFixture")
      })
    ).pipe(Effect.provide(fixtureLayer)),
  { timeout: 60_000 }
)

it.live(
  "completion-throttle cut uses production HTTP429 classification and preserves unfinished Run",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* createHermeticFixture(builtEntry, sourceBaseSha)
        const controller = yield* makeHermeticController(fixture, { _tag: "PauseAt", boundary: "CompletionThrottle" })
        yield* controller.setCompletionResponse("Throttled")
        const first = yield* controller.startChild()
        expect(
          (yield* controller.awaitBoundary("CompletionThrottle", first).pipe(Effect.timeout("20 seconds")))._tag
        ).toBe("CompletionThrottle")
        yield* controller.releaseBoundary()
        expect(yield* controller.awaitChild(first).pipe(Effect.timeout("20 seconds"))).toBe(1)
        expect(MutableList.toArray(first.recordLog).find((record) => record._tag === "Failure")).toMatchObject({
          code: "delivery.provider_throttled"
        })
        expect(
          MutableList.toArray(first.recordLog).some((record) => record._tag === "ApplicationExitDisposition")
        ).toBe(false)
        expect(closeCount((yield* controller.providerSnapshot).operationCounts)).toBe(1)
        const journal = yield* readJournal(fixture, first)
        expect(journal.filter(({ event }) => event._tag === "WorkflowRunBegan")).toHaveLength(1)
        expect(journal.some(({ event }) => event._tag === "WorkflowRunTerminated")).toBe(false)
        const last = journal.at(-1)
        if (last === undefined) return yield* Effect.die("the throttled Run must retain its journal prefix")
        const original = yield* selectedOf(first)
        const beforeRecovery = yield* controller.providerSnapshot
        const second = yield* controller.startChild()
        const observedLookup = yield* Effect.gen(function* () {
          for (;;) {
            const record = yield* Queue.take(second.records)
            if (record._tag !== "HistoricalSnapshot") continue
            const observed = record.snapshot.items.find(
              ({ occurrence }) =>
                occurrence._tag === "IntegrationFocusedCompletionOccurred" &&
                occurrence.event._tag === "CompletionTaskRequestLookupObserved"
            )
            if (observed !== undefined) return observed
          }
        }).pipe(Effect.timeout("20 seconds"))
        expect(observedLookup.occurrence).toMatchObject({
          event: { lookup: { _tag: "Unreadable" }, attemptOrdinal: 1 }
        })
        const waiting = yield* awaitWaitingStatus(second).pipe(Effect.timeout("20 seconds"))
        expect(waiting.subject).toEqual({ _tag: "Run", runId: original.runId })
        expect(yield* selectedOf(second)).toMatchObject({ runId: original.runId, selection: "Recovered" })
        expect(
          MutableList.toArray(second.recordLog).some(
            (record) =>
              record._tag === "CurrentStatus" &&
              record.status._tag === "DeliveryStatusAvailable" &&
              record.status.subject._tag === "Run" &&
              record.status.subject.runId === original.runId
          )
        ).toBe(true)
        expect(yield* second.handle.isRunning).toBe(true)
        yield* controller.terminateChild(second)
        expect(yield* controller.awaitChild(second).pipe(Effect.timeout("20 seconds"))).toBe(0)
        expect(
          MutableList.toArray(second.recordLog).filter((record) => record._tag === "ApplicationExitDisposition")
        ).toEqual([
          {
            _tag: "ApplicationExitDisposition",
            disposition: { _tag: "Succeeded", requestedStatus: 0 },
            runId: original.runId,
            version: 1
          }
        ])
        const recovered = yield* readJournal(fixture, second)
        const afterRecovery = yield* controller.providerSnapshot
        const attempts = recovered.filter(({ event }) => event._tag === "CompletionTaskAttemptIntended")
        expect(closeCount(afterRecovery.operationCounts)).toBe(attempts.length)
        const newAttempts = attempts.filter(({ position }) => position > last.position)
        expect(newAttempts).toHaveLength(0)
        expect(closeCount(afterRecovery.operationCounts)).toBe(1)
        const originalAttempt = journal.find(({ event }) => event._tag === "CompletionTaskAttemptIntended")
        const lookup = recovered.find(({ position }) => position === observedLookup.identity.position)
        if (
          originalAttempt?.event._tag !== "CompletionTaskAttemptIntended" ||
          lookup?.event._tag !== "CompletionTaskRequestLookupObserved"
        )
          return yield* Effect.die("missing original completion attempt or exact lookup observation")
        expect(lookup.event.attemptOrdinal).toBe(originalAttempt.event.attemptOrdinal)
        expect(Schema.toEquivalence(CompletionTaskRequest)(lookup.event.request, originalAttempt.event.request)).toBe(
          true
        )
        expect(lookup.event.lookup._tag).toBe("Unreadable")
        const lookupOperationId = lookup.event.operationId
        expect(
          Schema.toEquivalence(CompletionTaskRequest)(lookup.event.lookup.request, originalAttempt.event.request)
        ).toBe(true)
        const lookupIntent = recovered.find(
          ({ event }) => event._tag === "CompletionTaskRequestLookupIntended" && event.operationId === lookupOperationId
        )
        if (lookupIntent?.event._tag !== "CompletionTaskRequestLookupIntended")
          return yield* Effect.die("missing exact completion lookup intent")
        expect(lookupIntent.event.attemptOrdinal).toBe(originalAttempt.event.attemptOrdinal)
        expect(
          Schema.toEquivalence(CompletionTaskRequest)(lookupIntent.event.request, originalAttempt.event.request)
        ).toBe(true)
        const lifecycleRead = recovered.find(
          ({ event, position }) =>
            position > last.position &&
            event._tag === "TaskTrackerReadIntentRecorded" &&
            event.operation._tag === "ReadCompletionTaskFacts"
        )
        if (lifecycleRead === undefined) return yield* Effect.die("missing recovery lifecycle read")
        expect(lifecycleRead.position).toBeLessThan(lookupIntent.position)
        expect(lookupIntent.position).toBeGreaterThan(last.position)
        expect(lookup.position).toBeGreaterThan(lookupIntent.position)
        expect(recovered.filter(({ event }) => event._tag === "TaskClaimReleased")).toHaveLength(
          journal.filter(({ event }) => event._tag === "TaskClaimReleased").length
        )
        expect(afterRecovery.operationCounts.find(({ tag }) => tag === "CodexStartTurn")).toEqual(
          beforeRecovery.operationCounts.find(({ tag }) => tag === "CodexStartTurn")
        )
        expect(recovered.filter(({ event }) => event._tag === "WorkflowRunBegan")).toHaveLength(1)
        expect(recovered.some(({ event }) => event._tag === "WorkflowRunTerminated")).toBe(false)
        const disposal = yield* disposeHermeticFixture(fixture, controller)
        expect(disposal._tag).toBe("RetainedFixture")
        if (disposal._tag === "RetainedFixture") expect(disposal.cause._tag).toBe("UnfinishedRun")
        expect(yield* controller.activeRequestCount).toBe(0)
      })
    ).pipe(Effect.provide(fixtureLayer)),
  { timeout: 60_000 }
)
