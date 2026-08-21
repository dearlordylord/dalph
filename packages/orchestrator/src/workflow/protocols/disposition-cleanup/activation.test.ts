import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { InitialControlPolicy } from "../../../control/policy.js"
import { TaskWorkCapacity } from "../../../coordination/admission/capacity.js"
import { memoryJournalTestLayer } from "../../../workflow-journal/adapters/memory-store.js"
import { JournalStore } from "../../../workflow-journal/store.js"
import {
  branchCleanupObservationIntendedRecordKey,
  plannedAttemptReplacedRecordKey,
  worktreeCleanupSettledRecordKey
} from "../../../workflow-journal/record-key.js"
import { OperationId } from "../../identity.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { deriveCleanupAuthorizations } from "./activation.js"
import { appendDerivedCleanupAuthorizations } from "./loop.js"
import { attempt, authorization, runId, successor } from "./fixtures.js"
import {
  appendAbandonedProvenance,
  appendReplacementProvenance,
  replacementProvenanceFor
} from "./provenance-fixtures.js"
import {
  runWorktreeCleanup,
  WorktreeCleanupMutationResult,
  WorktreeCleanupObservation,
  WorktreeCleanupSettledEvent,
  worktreeCleanupTestLayer
} from "./worktree.js"
import {
  BranchCleanupAuthorization,
  BranchCleanupEvidenceRevision,
  CleanupObservationOrdinal,
  WorktreeCleanupEvidenceRevision
} from "./disposition.js"
import { BranchCleanupObservationIntendedEvent } from "./branch.js"

const begin = Effect.fn("DispositionCleanupActivationTest.begin")(function* (target: string) {
  const journal = yield* JournalStore
  yield* journal.beginRun(
    runId,
    FixtureTarget.make(target),
    InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
  )
  return journal
})

it.effect("fails closed when replacement authority has no exact ready-worktree witness", () =>
  Effect.gen(function* () {
    const journal = yield* begin("activation-missing-replacement-witness")
    const replacement = yield* journal.append(
      runId,
      plannedAttemptReplacedRecordKey(attempt.attemptId),
      replacementProvenanceFor(attempt, successor)
    )
    const derived = deriveCleanupAuthorizations([replacement])
    expect(derived.worktree).toEqual([])
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("fails closed when abandonment authority has no exact ready-worktree witness", () =>
  Effect.gen(function* () {
    const journal = yield* begin("activation-missing-abandonment-witness")
    yield* appendAbandonedProvenance(attempt)
    const records = (yield* journal.read(runId)).filter(({ event }) => event._tag !== "PlannedAttemptWorktreeObserved")
    expect(deriveCleanupAuthorizations(records).worktree).toEqual([])
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("derives one abandonment authorization from the latest exact ready-worktree witness", () =>
  Effect.gen(function* () {
    const journal = yield* begin("activation-abandonment-witness")
    yield* appendAbandonedProvenance(attempt)
    const derived = deriveCleanupAuthorizations(yield* journal.read(runId)).worktree
    expect(derived).toHaveLength(1)
    expect(derived[0]?.disposition._tag).toBe("Abandoned")
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("keeps an existing exact cleanup authorization when activation derives it again", () =>
  Effect.gen(function* () {
    const journal = yield* begin("activation-existing-exact-authorization")
    yield* appendAbandonedProvenance(attempt)

    yield* appendDerivedCleanupAuthorizations(runId, ["worktree"])
    yield* appendDerivedCleanupAuthorizations(runId, ["worktree"])

    const authorizations = (yield* journal.read(runId)).filter(
      ({ event }) => event._tag === "WorktreeCleanupAuthorized"
    )
    expect(authorizations).toHaveLength(1)
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("rejects a derived replacement authorization when its provenance prefix is incomplete", () =>
  Effect.gen(function* () {
    const journal = yield* begin("activation-incomplete-replacement-prefix")
    yield* appendReplacementProvenance(attempt, successor)
    const records = (yield* journal.read(runId)).filter(({ event }) => event._tag !== "TaskClaimAcquired")
    expect(deriveCleanupAuthorizations(records).worktree).toEqual([])
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("deduplicates repeated typed terminal evidence for one cleanup operation", () =>
  Effect.gen(function* () {
    const journal = yield* begin("activation-duplicate-terminal-evidence")
    yield* appendAbandonedProvenance(attempt, OperationId.make("activation-duplicate-abandonment"))
    const records = yield* journal.read(runId)
    const abandonment = records.find(({ event }) => event._tag === "AttemptImplementationAbandoned")
    expect(abandonment).toBeDefined()
    if (abandonment === undefined) return
    const derived = deriveCleanupAuthorizations([...records, abandonment])
    expect(derived.worktree).toHaveLength(1)
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("rejects a branch authorization when its settled worktree history is incomplete", () =>
  Effect.gen(function* () {
    const journal = yield* begin("activation-incomplete-settlement-history")
    yield* appendReplacementProvenance(attempt, successor)
    yield* journal.append(
      runId,
      worktreeCleanupSettledRecordKey(authorization.operationId),
      WorktreeCleanupSettledEvent.make({
        authorization,
        occurrenceClassification: "NonActionOccurrence",
        result: WorktreeCleanupMutationResult.cases.AlreadyAbsent.make({
          branch: attempt.branch,
          locator: attempt.worktree,
          revision: WorktreeCleanupEvidenceRevision.make(1)
        }),
        version: workflowJournalEventVersion
      })
    )
    expect(deriveCleanupAuthorizations(yield* journal.read(runId)).branch).toEqual([])
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("rejects a branch authorization when its own history begins after worktree settlement", () =>
  Effect.gen(function* () {
    const journal = yield* begin("activation-branch-history-after-settlement")
    yield* appendReplacementProvenance(attempt, successor)
    yield* runWorktreeCleanup(authorization)
    const beforeBranchEvent = deriveCleanupAuthorizations(yield* journal.read(runId)).branch[0]
    expect(beforeBranchEvent).toBeDefined()
    if (beforeBranchEvent === undefined) return
    const ordinal = CleanupObservationOrdinal.make(1)
    const branchAuthorization = BranchCleanupAuthorization.make({
      ...beforeBranchEvent,
      evidenceRevision: BranchCleanupEvidenceRevision.make(1)
    })
    yield* journal.append(
      runId,
      branchCleanupObservationIntendedRecordKey(branchAuthorization.operationId, ordinal),
      BranchCleanupObservationIntendedEvent.make({
        authorization: branchAuthorization,
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        operationId: OperationId.make("activation-branch-history-after-settlement:observe"),
        ordinal,
        version: workflowJournalEventVersion
      })
    )
    expect(deriveCleanupAuthorizations(yield* journal.read(runId)).branch).toEqual([])
  }).pipe(
    Effect.provide(
      worktreeCleanupTestLayer({
        observations: [
          WorktreeCleanupObservation.cases.Present.make({
            attemptId: attempt.attemptId,
            branch: attempt.branch,
            headSha: attempt.baseSha,
            locator: attempt.worktree,
            revision: WorktreeCleanupEvidenceRevision.make(1),
            writerQuiescent: true
          }),
          WorktreeCleanupObservation.cases.Absent.make({
            locator: attempt.worktree,
            revision: WorktreeCleanupEvidenceRevision.make(2)
          })
        ],
        mutations: [
          WorktreeCleanupMutationResult.cases.Removed.make({
            branch: attempt.branch,
            locator: attempt.worktree,
            revision: WorktreeCleanupEvidenceRevision.make(2)
          })
        ]
      })
    ),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("rejects a replacement with a settled worktree record before its authority witness", () =>
  Effect.gen(function* () {
    const journal = yield* begin("activation-settlement-before-witness")
    const replacement = replacementProvenanceFor(attempt, successor)
    yield* journal.append(
      runId,
      worktreeCleanupSettledRecordKey(authorization.operationId),
      WorktreeCleanupSettledEvent.make({
        authorization,
        occurrenceClassification: "NonActionOccurrence",
        result: WorktreeCleanupMutationResult.cases.AlreadyAbsent.make({
          branch: attempt.branch,
          locator: attempt.worktree,
          revision: WorktreeCleanupEvidenceRevision.make(1)
        }),
        version: workflowJournalEventVersion
      })
    )
    const replacementRecord = yield* journal.append(
      runId,
      plannedAttemptReplacedRecordKey(attempt.attemptId),
      replacement
    )
    expect(deriveCleanupAuthorizations([replacementRecord]).worktree).toEqual([])
  }).pipe(Effect.provide(memoryJournalTestLayer))
)
