import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { InitialControlPolicy } from "../../../control/policy.js"
import { TaskWorkCapacity } from "../../../coordination/admission/capacity.js"
import { JournalStore } from "../../../workflow-journal/store.js"
import { memoryJournalTestLayer } from "../../../workflow-journal/adapters/memory-store.js"
import { authorization, attempt, runId } from "./fixtures.js"
import { appendAbandonedProvenance } from "./provenance-fixtures.js"
import { activateDispositionCleanup, runDispositionCleanupLoop, selectCleanupResponsibilities } from "./loop.js"
import { worktreeCleanupTestLayer } from "./worktree.js"
import { branchCleanupTestLayer } from "./branch.js"
import { integratorCandidateCleanupTestLayer } from "./integrator-candidate.js"

const begin = Effect.fn("DispositionCleanupLoopTest.begin")(function* (target: string) {
  const journal = yield* JournalStore
  yield* journal.beginRun(
    runId,
    FixtureTarget.make(target),
    InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
  )
  return journal
})

it.effect("selects the same typed worktree responsibility with and without an operation filter", () =>
  Effect.gen(function* () {
    const journal = yield* begin("loop-operation-filter")
    yield* appendAbandonedProvenance(attempt)
    const activated = yield* activateDispositionCleanup(runId)
    const selected = activated.worktree[0]
    expect(selected).toBeDefined()
    if (selected === undefined) return
    const records = yield* journal.read(runId)
    expect(selectCleanupResponsibilities(records).worktree?.operationId).toBe(selected.operationId)
    expect(selectCleanupResponsibilities(records, selected.operationId).worktree?.operationId).toBe(
      selected.operationId
    )
  }).pipe(Effect.provide(worktreeCleanupTestLayer({ observations: [] })), Effect.provide(memoryJournalTestLayer))
)

it.effect("deduplicates duplicate typed proposals before crossing a cleanup boundary", () =>
  Effect.gen(function* () {
    yield* begin("loop-duplicate-proposals")
    const result = yield* runDispositionCleanupLoop(runId, {
      branch: [],
      candidate: [],
      worktree: [authorization, authorization]
    })
    expect(result.worktreeOutcomes).toHaveLength(1)
    expect(result.worktreeOutcomes[0]?._tag).toBe("Preserved")
  }).pipe(
    Effect.provide(worktreeCleanupTestLayer({ observations: [] })),
    Effect.provide(branchCleanupTestLayer({ observations: [] })),
    Effect.provide(integratorCandidateCleanupTestLayer({ observations: [] })),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("ignores a malformed tagged authorization record at the journal boundary", () =>
  Effect.gen(function* () {
    const journal = yield* begin("loop-malformed-authorization")
    const records = yield* journal.read(runId)
    const beginning = records[0]
    expect(beginning).toBeDefined()
    if (beginning === undefined) return

    // This is the one deliberately malformed boundary value in this test:
    // persisted decoding normally supplies JournalRecord, while this fixture
    // proves selector recovery when a legacy/corrupt row has only the tag.
    const malformed = { ...beginning, event: { _tag: "WorktreeCleanupAuthorized" } }

    expect(() => selectCleanupResponsibilities([...records, malformed])).not.toThrow()
    expect(selectCleanupResponsibilities([...records, malformed]).worktree).toBeUndefined()
  }).pipe(Effect.provide(memoryJournalTestLayer))
)
