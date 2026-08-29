import { it } from "@effect/vitest"
import { NodeCrypto } from "@effect/platform-node"
import { Effect, Schema } from "effect"
import { expect } from "vitest"
import { RunId } from "@dalph/contracts"
import {
  ActiveWorkAuthorityRefreshAuthority,
  ActiveWorkAuthorityRefreshGitReadIntentRecordedEvent,
  ActiveWorkAuthorityRefreshGitReadFailedEvent,
  ActiveWorkAuthorityRefreshOrdinal,
  GitTargetLineageReadFailure,
  GitWorktreeReadFailure,
  type WorkflowOperation,
  JournalPosition,
  OperationId,
  WorkflowActor,
  makeTargetLineageObservationOperation,
  makeTaskWorktreeObservationOperation,
  makeActiveWorkAuthorityRefreshGitReadOperation,
  describeJournalEvent,
  workflowJournalEventVersion,
  type JournalRecord,
  type WorkflowJournalEvent
} from "@dalph/orchestrator"
import {
  CassetteIdentityRenaming,
  RecordedCassette,
  changedAttemptContinuesAuthoredCassette,
  invertCassetteIdentityRenaming,
  projectRecordedCassette,
  renameRecordedCassette,
  renderRecordedCassetteLyrics,
  recordedCassetteVersion,
  runAuthoredScenarioCassette,
  verifyRecordedCassetteRoundTrip,
  verifyRecordedCassetteRoundTripWithRenaming
} from "../../src/cassettes/index.js"

const insertEvent = (
  records: ReadonlyArray<JournalRecord>,
  index: number,
  event: WorkflowJournalEvent
): ReadonlyArray<JournalRecord> => {
  const recordsWithEvent = [
    ...records.slice(0, index),
    { event, key: describeJournalEvent(event).expectedKey },
    ...records.slice(index)
  ]
  const runId = records[0]?.runId
  if (runId === undefined) return expect.fail("active-refresh cassette fixture requires a run")
  return recordsWithEvent.map((record, position) => ({
    ...record,
    position: JournalPosition.make(position + 1),
    runId
  }))
}

const activeRefreshFailureRecords = (
  records: ReadonlyArray<JournalRecord>,
  readKind: "ReadTaskWorktree" | "ReadTargetLineage"
): ReadonlyArray<JournalRecord> => {
  const runningIndex = records.findIndex(
    ({ event }) => event._tag === "PlannedAttemptExecutorWorkReported" && event.report._tag === "Running"
  )
  const plannedAttempt = records.find(({ event }) => event._tag === "TaskAttemptPlanned")?.event
  if (runningIndex < 0 || plannedAttempt?._tag !== "TaskAttemptPlanned") {
    return expect.fail("active-refresh cassette fixture requires a planned attempt reported Running")
  }
  const targetLineageOperation = records
    .map(({ event }) => event)
    .filter(
      (event): event is Extract<WorkflowJournalEvent, { readonly _tag: "GitReadIntentRecorded" }> =>
        event._tag === "GitReadIntentRecorded"
    )
    .map(({ operation }) => operation)
    .find(
      (operation): operation is Extract<WorkflowOperation, { readonly _tag: "ReadTargetLineage" }> =>
        operation._tag === "ReadTargetLineage"
    )
  const planned = plannedAttempt.operation.plannedAttempt
  const authority = ActiveWorkAuthorityRefreshAuthority.make({ attemptId: planned.attemptId, runId: planned.runId })
  const ordinal = ActiveWorkAuthorityRefreshOrdinal.make(1)
  const genericOperation =
    readKind === "ReadTaskWorktree"
      ? makeTaskWorktreeObservationOperation({
          operationId: OperationId.make("recorded-active-refresh-intent"),
          plannedAttempt: planned,
          predecessorOperationIds: []
        })
      : targetLineageOperation === undefined
        ? expect.fail("active-refresh cassette fixture requires a target-lineage operation")
        : makeTargetLineageObservationOperation({
            integrationTarget: targetLineageOperation.integrationTarget,
            operationId: OperationId.make("recorded-active-refresh-intent"),
            plannedAttempt: planned,
            predecessorOperationIds: []
          })
  const operation = makeActiveWorkAuthorityRefreshGitReadOperation(genericOperation, authority, ordinal)
  const failure =
    operation._tag === "ReadTaskWorktree"
      ? new GitWorktreeReadFailure({
          detail: "recorded active-refresh worktree read failed",
          worktree: operation.plannedAttempt.worktree
        })
      : new GitTargetLineageReadFailure({
          detail: "recorded active-refresh target-lineage read failed",
          plannedBaseSha: operation.plannedAttempt.baseSha,
          target: operation.integrationTarget
        })
  const intent = ActiveWorkAuthorityRefreshGitReadIntentRecordedEvent.make({
    initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
    occurrenceClassification: "InitiatedAction",
    operation,
    version: workflowJournalEventVersion
  })
  return insertEvent(
    insertEvent(records, runningIndex + 1, intent),
    runningIndex + 2,
    ActiveWorkAuthorityRefreshGitReadFailedEvent.make({
      authority,
      failure,
      occurrenceClassification: "NonActionOccurrence",
      operation,
      ordinal,
      source: "Timer",
      version: workflowJournalEventVersion
    })
  )
}

it("rejects the pre-change recorded-cassette schema instead of silently dropping active intent fields", () => {
  expect(() =>
    Schema.decodeUnknownSync(RecordedCassette)({
      _tag: "RecordedCassette",
      entries: [],
      runId: RunId.make("recorded-active-refresh-version-run"),
      schemaVersion: recordedCassetteVersion - 1
    })
  ).toThrow()
})

it.effect("records active-refresh Git failures as typed non-action cassette outcomes", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(changedAttemptContinuesAuthoredCassette)
    for (const readKind of ["ReadTaskWorktree", "ReadTargetLineage"] as const) {
      const records = activeRefreshFailureRecords(run.records, readKind)
      const recorded = yield* projectRecordedCassette(records)
      const sourceFailure = records.find(({ event }) => event._tag === "ActiveWorkAuthorityRefreshGitReadFailed")?.event
      const recordedFailure = recorded.entries.find((entry) => entry._tag === "ActiveWorkAuthorityRefreshGitReadFailed")
      const recordedIntent = recorded.entries.find(
        (entry) => entry._tag === "ActiveWorkAuthorityRefreshGitReadInitiated"
      )
      if (sourceFailure?._tag !== "ActiveWorkAuthorityRefreshGitReadFailed") {
        return yield* Effect.die("active-refresh cassette fixture did not retain its failure event")
      }
      expect(recordedFailure).toMatchObject({
        _tag: "ActiveWorkAuthorityRefreshGitReadFailed",
        authority: sourceFailure.authority,
        failure: sourceFailure.failure,
        occurrenceClassification: "NonActionOccurrence",
        operation: sourceFailure.operation,
        ordinal: sourceFailure.ordinal,
        source: sourceFailure.source
      })
      expect(recordedIntent).toMatchObject({
        _tag: "ActiveWorkAuthorityRefreshGitReadInitiated",
        operation: sourceFailure.operation
      })
      expect(recordedIntent).not.toHaveProperty("source")
      expect(recordedIntent?.operation).not.toHaveProperty("source")
      expect(renderRecordedCassetteLyrics(recorded)).toContain("active-refresh Git read failed")
      expect(
        verifyRecordedCassetteRoundTrip(records, recorded).every(
          ({ operationalStateEquivalent, pureSelectionEquivalent, workflowHistoryEquivalent }) =>
            workflowHistoryEquivalent && operationalStateEquivalent && pureSelectionEquivalent
        )
      ).toBe(true)
    }
  }).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("records an active-refresh successful intent without process-local source", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(changedAttemptContinuesAuthoredCassette)
    const records = activeRefreshFailureRecords(run.records, "ReadTaskWorktree")
      .filter(({ event }) => event._tag !== "ActiveWorkAuthorityRefreshGitReadFailed")
      .map((record, index) => ({ ...record, position: JournalPosition.make(index + 1) }))
    const recorded = yield* projectRecordedCassette(records)
    const intent = recorded.entries.find((entry) => entry._tag === "ActiveWorkAuthorityRefreshGitReadInitiated")
    expect(intent?._tag).toBe("ActiveWorkAuthorityRefreshGitReadInitiated")
    expect(intent).not.toHaveProperty("source")
    expect(intent?.operation).not.toHaveProperty("source")
    const encoded = yield* Schema.encodeUnknownEffect(RecordedCassette)(recorded)
    expect(JSON.stringify(encoded)).not.toContain("TrackerNotification")
    expect(JSON.stringify(encoded)).not.toContain("Timer")
  }).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("alpha-renames active-refresh failure identities without changing typed Git resources", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(changedAttemptContinuesAuthoredCassette)
    for (const readKind of ["ReadTaskWorktree", "ReadTargetLineage"] as const) {
      const records = activeRefreshFailureRecords(run.records, readKind)
      const recorded = yield* projectRecordedCassette(records)
      const failure = recorded.entries.find((entry) => entry._tag === "ActiveWorkAuthorityRefreshGitReadFailed")
      if (failure?._tag !== "ActiveWorkAuthorityRefreshGitReadFailed") {
        return yield* Effect.die("active-refresh cassette fixture did not project its failure")
      }
      const renaming = yield* Schema.decodeUnknownEffect(CassetteIdentityRenaming)({
        attemptIds: [{ from: failure.authority.attemptId, to: "renamed-active-refresh-attempt" }],
        claimTokens: [],
        integratorCandidateResourceLocators: [],
        integratorSessionIds: [],
        operationIds: [{ from: failure.operation.operationId, to: "renamed-active-refresh-operation" }],
        runIds: [{ from: failure.authority.runId, to: "renamed-active-refresh-run" }],
        taskBranchRefs: [{ from: failure.operation.plannedAttempt.branch, to: "refs/heads/renamed-active-refresh" }],
        worktreeLocators: [{ from: failure.operation.plannedAttempt.worktree, to: "/tmp/renamed-active-refresh" }]
      })
      const renamed = yield* renameRecordedCassette(recorded, renaming)
      const renamedIntent = renamed.entries.find(
        (entry) =>
          entry._tag === "ActiveWorkAuthorityRefreshGitReadInitiated" &&
          entry.operation.operationId === "renamed-active-refresh-operation"
      )
      const renamedFailure = renamed.entries.find((entry) => entry._tag === "ActiveWorkAuthorityRefreshGitReadFailed")
      if (renamedIntent?._tag !== "ActiveWorkAuthorityRefreshGitReadInitiated") {
        return yield* Effect.die("renamed cassette did not retain active-refresh intent")
      }
      expect(renamedIntent).not.toHaveProperty("source")
      expect(renamedIntent.operation).not.toHaveProperty("source")
      if (renamedFailure?._tag !== "ActiveWorkAuthorityRefreshGitReadFailed") {
        return yield* Effect.die("renamed cassette did not retain active-refresh failure")
      }
      expect(renamedFailure.authority.attemptId).toBe("renamed-active-refresh-attempt")
      expect(renamedFailure.authority.runId).toBe("renamed-active-refresh-run")
      expect(renamedFailure.operation.operationId).toBe("renamed-active-refresh-operation")
      expect(renamedFailure.ordinal).toBe(failure.ordinal)
      expect(renamedFailure.source).toBe(failure.source)
      expect(renamedFailure.operation._tag).toBe(failure.operation._tag)
      if (failure.operation._tag === "ReadTaskWorktree") {
        if (renamedFailure.operation._tag !== "ReadTaskWorktree") {
          return yield* Effect.die("renamed active-refresh failure changed its operation kind")
        }
        expect(renamedFailure.operation.plannedAttempt.worktree).toBe("/tmp/renamed-active-refresh")
      } else {
        if (renamedFailure.operation._tag !== "ReadTargetLineage") {
          return yield* Effect.die("renamed active-refresh failure changed its operation kind")
        }
        expect(renamedFailure.operation.integrationTarget.repository).toBe(
          failure.operation.integrationTarget.repository
        )
      }
      expect(
        (yield* verifyRecordedCassetteRoundTripWithRenaming(
          records,
          renamed,
          invertCassetteIdentityRenaming(renaming)
        )).every(
          ({ operationalStateEquivalent, pureSelectionEquivalent, workflowHistoryEquivalent }) =>
            workflowHistoryEquivalent && operationalStateEquivalent && pureSelectionEquivalent
        )
      ).toBe(true)
    }
  }).pipe(Effect.provide(NodeCrypto.layer))
)
