import { it } from "@effect/vitest"
import { Deferred, Effect, Fiber, Schema } from "effect"
import { expect } from "vitest"
import { AttemptId, TaskId } from "@dalph/contracts"
import { AuthoredCassetteStoryItem } from "../../src/cassettes/authored-domain.js"
import { makeStoryCursor, type StoryCursor } from "../../src/cassettes/authored-cursor.js"

const aAttemptId = AttemptId.make("attempt:A:0")
const bAttemptId = AttemptId.make("attempt:B:1")
const cAttemptId = AttemptId.make("attempt:C:1")
const dAttemptId = AttemptId.make("attempt:D:1")

const bWorktreeOperation = { _tag: "ReconcileTaskWorktree", attemptId: bAttemptId, taskId: TaskId.make("B") } as const
const cWorktreeOperation = { _tag: "ReconcileTaskWorktree", attemptId: cAttemptId, taskId: TaskId.make("C") } as const
const dWorktreeOperation = { _tag: "ReconcileTaskWorktree", attemptId: dAttemptId, taskId: TaskId.make("D") } as const

const concurrentGroup = Schema.decodeUnknownSync(AuthoredCassetteStoryItem)({
  _tag: "ConcurrentInteractionGroup",
  members: [
    { _tag: "DalphSelects", operation: bWorktreeOperation },
    { _tag: "DalphSelects", operation: cWorktreeOperation },
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "ExecutorWorkExecuting", attemptId: aAttemptId },
      request: "Begin"
    }
  ]
})

const strictD = AuthoredCassetteStoryItem.cases.DalphSelects.make({ operation: dWorktreeOperation })
const story = [concurrentGroup, strictD]

type GroupMemberName = "A" | "B" | "C"

const consumeMember = (cursor: StoryCursor, member: GroupMemberName) => {
  switch (member) {
    case "A":
      return cursor.consumeExecutorReportFor("Begin", aAttemptId).pipe(Effect.asVoid)
    case "B":
      return cursor.consumeDalphSelectionFor(bWorktreeOperation).pipe(Effect.asVoid)
    case "C":
      return cursor.consumeDalphSelectionFor(cWorktreeOperation).pipe(Effect.asVoid)
  }
}

const memberPermutations: ReadonlyArray<readonly [GroupMemberName, GroupMemberName, GroupMemberName]> = [
  ["A", "B", "C"],
  ["A", "C", "B"],
  ["B", "A", "C"],
  ["B", "C", "A"],
  ["C", "A", "B"],
  ["C", "B", "A"]
]

it.effect("consumes B worktree C worktree and A executing in all six orders before advancing once", () =>
  Effect.gen(function* () {
    for (const permutation of memberPermutations) {
      const occurrences: Array<{ readonly item: AuthoredCassetteStoryItem; readonly storyPosition: number }> = []
      const cursor = yield* makeStoryCursor(story, {
        onOccurrence: (occurrence) => Effect.sync(() => occurrences.push(occurrence))
      })

      yield* consumeMember(cursor, permutation[0])
      expect(yield* cursor.storyPosition).toBe(0)
      expect(occurrences).toEqual([])

      yield* consumeMember(cursor, permutation[1])
      expect(yield* cursor.storyPosition).toBe(0)
      expect(occurrences).toEqual([])

      yield* consumeMember(cursor, permutation[2])
      expect(yield* cursor.storyPosition).toBe(1)
      expect(occurrences).toEqual([{ item: concurrentGroup, storyPosition: 1 }])

      const dSelection = yield* cursor.consumeDalphSelectionFor(dWorktreeOperation)
      expect(dSelection.operation).toEqual(dWorktreeOperation)
      expect(yield* cursor.storyPosition).toBe(2)
    }
  })
)

it.effect("serializes simultaneous exact group claims and emits one occurrence after the final claim", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const occurrences: Array<{ readonly item: AuthoredCassetteStoryItem; readonly storyPosition: number }> = []
      const cursor = yield* makeStoryCursor(story, {
        onOccurrence: (occurrence) => Effect.sync(() => occurrences.push(occurrence))
      })
      const release = yield* Deferred.make<void>()
      const aReady = yield* Deferred.make<void>()
      const bReady = yield* Deferred.make<void>()
      const cReady = yield* Deferred.make<void>()
      const claim = (member: GroupMemberName, ready: Deferred.Deferred<void>) =>
        Deferred.succeed(ready, undefined).pipe(
          Effect.andThen(Deferred.await(release)),
          Effect.andThen(consumeMember(cursor, member))
        )
      const aClaim = yield* claim("A", aReady).pipe(Effect.forkScoped)
      const bClaim = yield* claim("B", bReady).pipe(Effect.forkScoped)
      const cClaim = yield* claim("C", cReady).pipe(Effect.forkScoped)

      yield* Effect.all([Deferred.await(aReady), Deferred.await(bReady), Deferred.await(cReady)], {
        concurrency: "unbounded",
        discard: true
      })
      expect(yield* cursor.storyPosition).toBe(0)
      expect(occurrences).toEqual([])
      yield* Deferred.succeed(release, undefined)
      yield* Effect.all([Fiber.join(aClaim), Fiber.join(bClaim), Fiber.join(cClaim)], {
        concurrency: "unbounded",
        discard: true
      })

      expect(yield* cursor.storyPosition).toBe(1)
      expect(occurrences).toEqual([{ item: concurrentGroup, storyPosition: 1 }])
      yield* cursor.consumeDalphSelectionFor(dWorktreeOperation)
      expect(yield* cursor.storyPosition).toBe(2)
    })
  )
)

it.effect("rejects foreign duplicate and downstream claims without advancing an incomplete group", () =>
  Effect.gen(function* () {
    const foreignOperation = {
      _tag: "ReconcileTaskWorktree",
      attemptId: AttemptId.make("attempt:X:1"),
      taskId: TaskId.make("X")
    } as const

    const foreignOccurrences: Array<unknown> = []
    const foreign = yield* makeStoryCursor(story, {
      onOccurrence: (occurrence) => Effect.sync(() => foreignOccurrences.push(occurrence))
    })
    const foreignError = yield* foreign.consumeDalphSelectionFor(foreignOperation).pipe(Effect.flip)
    expect(foreignError._tag).toBe("AuthoredCassetteInteractionMismatch")
    expect(yield* foreign.storyPosition).toBe(0)
    expect(foreignOccurrences).toEqual([])

    const duplicateOccurrences: Array<unknown> = []
    const duplicate = yield* makeStoryCursor(story, {
      onOccurrence: (occurrence) => Effect.sync(() => duplicateOccurrences.push(occurrence))
    })
    yield* duplicate.consumeDalphSelectionFor(bWorktreeOperation)
    const duplicateError = yield* duplicate.consumeDalphSelectionFor(bWorktreeOperation).pipe(Effect.flip)
    expect(duplicateError._tag).toBe("AuthoredCassetteInteractionMismatch")
    expect(yield* duplicate.storyPosition).toBe(0)
    expect(duplicateOccurrences).toEqual([])

    const downstreamOccurrences: Array<unknown> = []
    const downstream = yield* makeStoryCursor(story, {
      onOccurrence: (occurrence) => Effect.sync(() => downstreamOccurrences.push(occurrence))
    })
    yield* downstream.consumeDalphSelectionFor(bWorktreeOperation)
    const downstreamError = yield* downstream.consumeDalphSelectionFor(dWorktreeOperation).pipe(Effect.flip)
    expect(downstreamError._tag).toBe("AuthoredCassetteInteractionMismatch")
    expect(yield* downstream.storyPosition).toBe(0)
    expect(downstreamOccurrences).toEqual([])
  })
)

it.effect("keeps an incomplete group current without inventing timeout semantics", () =>
  Effect.gen(function* () {
    const occurrences: Array<{ readonly item: AuthoredCassetteStoryItem; readonly storyPosition: number }> = []
    const cursor = yield* makeStoryCursor(story, {
      onOccurrence: (occurrence) => Effect.sync(() => occurrences.push(occurrence))
    })

    yield* cursor.consumeDalphSelectionFor(bWorktreeOperation)

    expect(yield* cursor.storyPosition).toBe(0)
    expect((yield* cursor.currentStoryItem)?._tag).toBe("ConcurrentInteractionGroup")
    expect(occurrences).toEqual([])
  })
)

it.effect("recreates every group member after its cursor scope is replaced", () =>
  Effect.gen(function* () {
    yield* Effect.scoped(
      Effect.gen(function* () {
        const first = yield* makeStoryCursor(story)
        yield* first.consumeDalphSelectionFor(bWorktreeOperation)
        expect(yield* first.storyPosition).toBe(0)
      })
    )

    yield* Effect.scoped(
      Effect.gen(function* () {
        const replacement = yield* makeStoryCursor(story)
        yield* replacement.consumeDalphSelectionFor(bWorktreeOperation)
        yield* replacement.consumeDalphSelectionFor(cWorktreeOperation)
        const report = yield* replacement.consumeExecutorReportFor("Begin", aAttemptId)
        expect(report.report).toEqual({ _tag: "ExecutorWorkExecuting", attemptId: aAttemptId })
        expect(yield* replacement.storyPosition).toBe(1)
      })
    )
  })
)
