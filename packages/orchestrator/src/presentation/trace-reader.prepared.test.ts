import { it } from "@effect/vitest"
import { Deferred, Effect, Fiber, Result, Schema } from "effect"
import { expect } from "vitest"
import { RunId, TaskBranchRef } from "@dalph/contracts"
import { TaskAttemptPlannedEvent } from "../workflow/registry/event.js"
import { RunCancellationAppliedEvent } from "../workflow/protocols/run-cancellation/events.js"
import { makeTaskAttemptPlanOperation } from "../workflow/registry/operation.js"
import { OperationId } from "../workflow/identity.js"
import { workflowJournalEventVersion } from "../workflow/kernel/event.js"
import { describeJournalEvent } from "../workflow/registry/event-descriptor.js"
import { validateAttemptStopHistory } from "../coordination/reconstruction/attempt-validation.js"
import { journalEvidenceFrom } from "../workflow-journal/record-evidence.js"
import { JournalPosition, JournalRecordKey } from "../workflow-journal/identity.js"
import { InRunJournal } from "../workflow-journal/in-run-journal.js"
import { worktreeCleanupAuthorizedRecordKey } from "../workflow-journal/record-key.js"
import { appendAbandonedProvenance } from "../workflow/protocols/disposition-cleanup/provenance-fixtures.js"
import { dispositionCleanupLiveJournalTestLayer } from "../workflow/protocols/disposition-cleanup/live-journal-test.js"
import { attempt, runId as cleanupRunId } from "../workflow/protocols/disposition-cleanup/fixtures.js"
import {
  WorktreeCleanupAuthorizedEvent,
  WorktreeCleanupContradictedEvent,
  WorktreeCleanupObservation
} from "../workflow/protocols/disposition-cleanup/worktree.js"
import { JournalPartitionContradiction } from "../workflow-journal/store.js"
import { makeTraceReader, TraceCursor } from "./trace-reader.js"
import { capacitiesThrough, coldReaderFor, readerFor, runId } from "./trace-reader.prepared-fixtures.js"

it.effect(
  "lets the maintainer inspect exact graph, causal evidence and retained cleanup responsibilities at every cursor",
  () =>
    Effect.gen(function* () {
      const journal = yield* InRunJournal
      const authorization = yield* appendAbandonedProvenance(attempt)
      const authorized = WorktreeCleanupAuthorizedEvent.make({
        authorization,
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        version: workflowJournalEventVersion
      })
      yield* journal.append(cleanupRunId, worktreeCleanupAuthorizedRecordKey(authorization.operationId), authorized)
      const records = yield* journal.read(cleanupRunId)
      let selectedSourceReads = 0
      const observedRecords = records.map((record) => ({
        get event() {
          selectedSourceReads += 1
          return record.event
        },
        key: record.key,
        position: record.position,
        runId: record.runId
      }))
      const prepared = yield* readerFor(observedRecords).prepare(cleanupRunId)
      selectedSourceReads = 0
      const cold = coldReaderFor(records)
      let graphs = 0
      let causalEdges = 0
      let responsibilities = 0
      let cleanup = 0
      for (const cursor of prepared.cursors) {
        const selected = prepared.select(cursor)
        expect(selected).toEqual(yield* Effect.result(cold.readAt(cursor)))
        if (Result.isSuccess(selected)) {
          graphs += selected.success.graph === null ? 0 : 1
          causalEdges += selected.success.relationships.workflowCausalEdges.length
          responsibilities += selected.success.facets.recovery.retainedResponsibilities.length
          cleanup += selected.success.facets.controlDisposition.cleanup.length
        }
      }
      expect(graphs).toBeGreaterThan(0)
      expect(causalEdges).toBeGreaterThan(0)
      expect(responsibilities).toBeGreaterThan(0)
      expect(cleanup).toBeGreaterThan(0)
      expect(selectedSourceReads).toBe(0)
      let orderedStopFailures = 0
      const abandonment = records.find((record) => record.event._tag === "AttemptImplementationAbandoned")
      if (abandonment === undefined) return yield* Effect.die("cleanup fixture must contain abandonment")
      const stopVariants = [
        records,
        records.filter((record) => record.event._tag !== "AttemptChoiceApplied"),
        records.flatMap((record) => (record === abandonment ? [record, record] : [record]))
      ]
      for (const variant of stopVariants) {
        const chronological = variant.map((record, index) => ({ ...record, position: JournalPosition.make(index + 1) }))
        for (const [index] of chronological.entries()) {
          const prefix = chronological.slice(0, index + 1)
          const coldIssues = validateAttemptStopHistory(cleanupRunId, prefix)
          expect(validateAttemptStopHistory(cleanupRunId, journalEvidenceFrom(prefix))).toEqual(coldIssues)
          orderedStopFailures += coldIssues.length
        }
      }
      expect(orderedStopFailures).toBeGreaterThan(0)
      const cancellation = RunCancellationAppliedEvent.make({
        initiatedBy: { _tag: "Operator" },
        occurrenceClassification: "InitiatedAction",
        version: workflowJournalEventVersion
      })
      const cancelledRecords = [
        ...records,
        {
          event: cancellation,
          key: describeJournalEvent(cancellation).expectedKey,
          position: JournalPosition.make(records.length + 1),
          runId: cleanupRunId
        }
      ]
      const cancelled = yield* readerFor(cancelledRecords).prepare(cleanupRunId)
      const cancelledCursor = TraceCursor.make({
        position: JournalPosition.make(cancelledRecords.length),
        runId: cleanupRunId
      })
      expect(Result.isSuccess(cancelled.select(cancelledCursor))).toBe(true)
      expect(cancelled.select(cancelledCursor)).toEqual(
        yield* Effect.result(coldReaderFor(cancelledRecords).readAt(cancelledCursor))
      )
      const forbiddenPlan = TaskAttemptPlannedEvent.make({
        operation: makeTaskAttemptPlanOperation({
          operationId: OperationId.make("prepared-forbidden-after-cancellation"),
          plannedAttempt: attempt,
          predecessorOperationIds: []
        }),
        version: workflowJournalEventVersion
      })
      const forbiddenRecords = [
        ...cancelledRecords,
        {
          event: forbiddenPlan,
          key: describeJournalEvent(forbiddenPlan).expectedKey,
          position: JournalPosition.make(cancelledRecords.length + 1),
          runId: cleanupRunId
        }
      ]
      const forbidden = yield* readerFor(forbiddenRecords).prepare(cleanupRunId)
      const forbiddenCursor = TraceCursor.make({
        position: JournalPosition.make(forbiddenRecords.length),
        runId: cleanupRunId
      })
      expect(forbidden.select(forbiddenCursor)).toMatchObject({
        _tag: "Failure",
        failure: {
          _tag: "TraceProjectionInvalid",
          detail: `post-cancellation history cannot record forward-work event TaskAttemptPlanned at journal position ${forbiddenCursor.position}`
        }
      })
      expect(forbidden.select(forbiddenCursor)).toEqual(
        yield* Effect.result(coldReaderFor(forbiddenRecords).readAt(forbiddenCursor))
      )
      const miskeyedRecords = forbiddenRecords.map((record) =>
        record.position === cancelledCursor.position
          ? { ...record, key: JournalRecordKey.make("miskeyed-cancellation") }
          : record
      )
      const miskeyed = yield* readerFor(miskeyedRecords).prepare(cleanupRunId)
      expect(miskeyed.select(forbiddenCursor)).toEqual(forbidden.select(forbiddenCursor))
      expect(miskeyed.select(forbiddenCursor)).toEqual(
        yield* Effect.result(coldReaderFor(miskeyedRecords).readAt(forbiddenCursor))
      )
      const contradiction = WorktreeCleanupContradictedEvent.make({
        authorization,
        detail: "contradiction without preceding observation",
        observation: WorktreeCleanupObservation.cases.Foreign.make({
          locator: authorization.locator,
          observedBranch: TaskBranchRef.make("refs/heads/foreign"),
          observedHead: authorization.expectedHead,
          reason: "OtherOwner",
          revision: authorization.evidenceRevision
        }),
        occurrenceClassification: "NonActionOccurrence",
        operationId: OperationId.make("prepared-invalid-cleanup-observation"),
        version: workflowJournalEventVersion
      })
      const malformed = [
        ...records,
        ...[cancellation, cancellation, contradiction].map((event, offset) => ({
          event,
          key: describeJournalEvent(event).expectedKey,
          position: JournalPosition.make(records.length + offset + 1),
          runId: cleanupRunId
        }))
      ]
      const finalCursor = TraceCursor.make({ position: JournalPosition.make(malformed.length), runId: cleanupRunId })
      const invalid = yield* readerFor(malformed).prepare(cleanupRunId)
      expect(invalid.select(finalCursor)).toMatchObject({
        _tag: "Failure",
        failure: {
          _tag: "TraceProjectionInvalid",
          detail: expect.stringContaining("RunCancellationApplied may occur only once")
        }
      })
      const foreignRunId = RunId.make("foreign-cleanup-run")
      const foreignContradiction = Schema.decodeUnknownSync(WorktreeCleanupContradictedEvent)({
        ...contradiction,
        authorization: {
          ...authorization,
          disposition: { ...authorization.disposition, plannedAttempt: { ...attempt, runId: foreignRunId } }
        }
      })
      const foreign = malformed.map((record) =>
        record.position === finalCursor.position ? { ...record, event: foreignContradiction } : record
      )
      const foreignPrepared = yield* readerFor(foreign).prepare(cleanupRunId)
      expect(foreignPrepared.select(finalCursor)).toMatchObject({
        _tag: "Failure",
        failure: {
          _tag: "TraceProjectionInvalid",
          detail: `worktree cleanup contradiction binds run ${foreignRunId} at journal position ${finalCursor.position}`
        }
      })
      for (const cursor of invalid.cursors) {
        expect(invalid.select(cursor)).toEqual(yield* Effect.result(coldReaderFor(malformed).readAt(cursor)))
      }
      expect(invalid.select(prepared.cursors[0] ?? finalCursor)).toEqual(
        prepared.select(prepared.cursors[0] ?? finalCursor)
      )
    }).pipe(Effect.provide(dispositionCleanupLiveJournalTestLayer()))
)

it.effect("retains exact ordered invalid-prefix issues and storage-order duplicate cursor availability", () =>
  Effect.gen(function* () {
    const records = capacitiesThrough([2, 3])
    const first = records[0]
    const second = records[1]
    if (first === undefined || second === undefined) return yield* Effect.die("prepared fixture requires two records")
    const malformed = [first, { ...second, runId: RunId.make("foreign-envelope") }, second]
    const prepared = yield* readerFor(malformed).prepare(runId)
    expect(prepared.cursors.map(({ position }) => position)).toEqual([1, 2, 2])
    expect(
      prepared.select(prepared.cursors[0] ?? TraceCursor.make({ position: JournalPosition.make(1), runId }))
    ).toEqual(
      Effect.runSync(
        Effect.result(coldReaderFor(malformed).readAt(TraceCursor.make({ position: JournalPosition.make(1), runId })))
      )
    )
    const cursor = TraceCursor.make({ position: JournalPosition.make(2), runId })
    expect(prepared.select(cursor)).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "TraceJournalPrefixInvalid",
        issues: [
          { _tag: "RunMismatch", position: 2 },
          { _tag: "PositionGap", actualPosition: 2, expectedPosition: 3 }
        ]
      }
    })
    expect(prepared.select(cursor)).toEqual(prepared.select(cursor))
    for (const missing of [4, 99]) {
      expect(prepared.select(TraceCursor.make({ position: JournalPosition.make(missing), runId }))).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "TraceCursorNotCommitted" }
      })
    }
    expect(
      prepared.select(TraceCursor.make({ position: JournalPosition.make(1), runId: RunId.make("other-run") }))
    ).toMatchObject({ _tag: "Failure", failure: { _tag: "TraceCursorNotCommitted" } })
  })
)

it.effect("reads storage once and retains earlier snapshots without rereading or accumulating selected views", () =>
  Effect.gen(function* () {
    let records = capacitiesThrough([2, 3])
    let reads = 0
    let failRead = false
    const failure = new JournalPartitionContradiction({ runId })
    const reader = makeTraceReader({
      read: () =>
        Effect.suspend(() => {
          reads += 1
          return failRead ? Effect.fail(failure) : Effect.succeed(records)
        })
    })
    const prepared = yield* reader.prepare(runId)
    const cursor = TraceCursor.make({ position: JournalPosition.make(2), runId })
    const earlier = prepared.select(cursor)
    const serializedEarlier = JSON.stringify(earlier)
    for (const available of prepared.cursors) expect(Result.isSuccess(prepared.select(available))).toBe(true)
    expect(reads).toBe(1)
    expect(prepared.select(cursor)).toEqual(earlier)
    if (Result.isSuccess(earlier)) {
      const repeated = prepared.select(cursor)
      if (Result.isSuccess(repeated)) expect(repeated.success).not.toBe(earlier.success)
    }
    records = capacitiesThrough([2, 3, 4])
    const later = yield* reader.prepare(runId)
    expect(later.cursors).toHaveLength(4)
    expect(prepared.cursors).toHaveLength(3)
    expect(JSON.stringify(earlier)).toBe(serializedEarlier)
    yield* reader.readAt(cursor)
    failRead = true
    expect(yield* Effect.flip(reader.readAt(cursor))).toBe(failure)
    expect(yield* Effect.flip(reader.prepare(runId))).toBe(failure)
    expect(prepared.select(cursor)).toEqual(earlier)
  })
)

it.effect("does not leave an interrupted storage read as a successful or pending prepared snapshot", () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>()
    const release = yield* Deferred.make<void>()
    let block = true
    const records = capacitiesThrough([2])
    const reader = makeTraceReader({
      read: () =>
        Effect.gen(function* () {
          if (block) {
            yield* Deferred.succeed(entered, undefined)
            yield* Deferred.await(release)
          }
          return records
        })
    })
    const pending = yield* reader.prepare(runId).pipe(Effect.forkScoped)
    yield* Deferred.await(entered)
    yield* Fiber.interrupt(pending)
    block = false
    expect((yield* reader.prepare(runId)).cursors).toHaveLength(2)
  })
)

it.effect(
  "bounds source inspection at preparation and never replays source records when selecting N or 2N cursors",
  () =>
    Effect.gen(function* () {
      const preparationCounts: Array<number> = []
      for (const size of [8, 16]) {
        let eventReads = 0
        const records = capacitiesThrough(Array.from({ length: size - 1 }, () => 2)).map((record) => ({
          get event() {
            eventReads += 1
            return record.event
          },
          key: record.key,
          position: record.position,
          runId: record.runId
        }))
        const prepared = yield* readerFor(records).prepare(runId)
        preparationCounts.push(eventReads)
        eventReads = 0
        for (const cursor of prepared.cursors) expect(Result.isSuccess(prepared.select(cursor))).toBe(true)
        expect(eventReads).toBe(0)
      }
      const smaller = preparationCounts[0] ?? 0
      const larger = preparationCounts[1] ?? 0
      expect(smaller).toBeGreaterThan(0)
      expect(larger).toBeLessThanOrEqual(smaller * 2)
    })
)
