import { it } from "@effect/vitest"
import {
  AcceptedResult,
  AcceptedResultEvidenceManifest,
  AttemptId,
  EvidenceDigest,
  EvidenceReference,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedAttemptExecutorReport,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  WorktreeLocator,
  makeTaskWorkSpecification
} from "@dalph/contracts"
import { Effect, Layer } from "effect"
import { NodeServices } from "@effect/platform-node"
import { expect } from "vitest"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { liveJournalTestLayer } from "../../../coordination/delivery/live-journal-test-layer.js"
import { makeExecutingAttemptHistory } from "../../../../test/support/executing-attempt-history.js"
import { InRunJournal, type JournalRecord } from "../../../workflow-journal/store.js"
import { ActiveTaskClaim } from "../../../authorities/task-tracker/claim-mutation.js"
import { ClaimOwner, ClaimToken } from "../../../authorities/task-tracker/claim.js"
import { describeJournalEvent } from "../../registry/event-descriptor.js"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorStateObservation,
  PlannedAttemptExecutorStateObservationOrdinal,
  PlannedAttemptExecutorStateObservedEvent,
  PlannedAttemptExecutorWorkReportedEvent
} from "../planned-attempt-executor-work/events.js"
import { EvidenceStore, EvidenceStoreFailure, memoryEvidenceStoreLayer } from "../evidence-store.js"
import {
  AcceptedResultEvidenceConflict,
  AcceptedResultEvidenceUnavailable,
  qualifyAcceptedResultEvidence,
  queueAcceptedResultIntegrationResponsibility
} from "./protocol.js"
import { OperationId } from "../../identity.js"

const runId = RunId.make("accepted-result-evidence-run")
const specification = makeTaskWorkSpecification({
  body: "Qualify the exact accepted executor result evidence.",
  taskId: TaskId.make("accepted-result-evidence-task"),
  title: "Accepted result evidence"
})
const attempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("accepted-result-evidence-attempt"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/accepted-result-evidence"),
  executor: TaskExecutorLocator.make("executor:accepted-result-evidence"),
  runId,
  taskId: TaskId.make("accepted-result-evidence-task"),
  taskRevision: specification.fingerprint,
  worktree: WorktreeLocator.make("/worktrees/accepted-result-evidence")
})
const target = IntegrationTarget.make({
  repository: GitRepositoryLocator.make("/repositories/accepted-result-evidence.git"),
  ref: IntegrationTargetRef.make("refs/heads/main")
})
const trackerTarget = FixtureTarget.make("accepted-result-evidence-target")
const activeClaim = ActiveTaskClaim.make({
  operationId: OperationId.make("accepted-result-evidence-claim"),
  owner: ClaimOwner.make("dalph:accepted-result-evidence"),
  taskId: attempt.taskId,
  token: ClaimToken.make("accepted-result-evidence-token")
})
const bytesFor = (manifest: AcceptedResultEvidenceManifest): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(manifest))

const acceptedResultIn = (reference: AcceptedResult["evidenceManifest"]): AcceptedResult =>
  AcceptedResult.make({ commit: GitCommitSha.make("a".repeat(40)), evidenceManifest: reference })

const acceptedRecordsFor = (result: AcceptedResult): ReadonlyArray<JournalRecord> => {
  const executing = makeExecutingAttemptHistory({
    activeClaim,
    plannedAttempt: attempt,
    runId,
    taskSpecification: specification,
    trackerTarget
  })
  const terminal = PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
    correlation: { attemptId: attempt.attemptId, runId },
    result: { _tag: "Accepted", acceptedResult: result }
  })
  const events = [
    PlannedAttemptExecutorStateObservedEvent.make({
      observation: PlannedAttemptExecutorStateObservation.cases.ExactExecutorReport.make({ report: terminal }),
      occurrenceClassification: "NonActionOccurrence",
      ordinal: PlannedAttemptExecutorStateObservationOrdinal.make(1),
      plannedAttempt: attempt,
      version: workflowJournalEventVersion
    }),
    PlannedAttemptExecutorWorkReportedEvent.make({
      ordinal: PlannedAttemptExecutorReportOrdinal.make(2),
      report: terminal,
      version: workflowJournalEventVersion
    })
  ]
  return events.reduce<ReadonlyArray<JournalRecord>>(
    (records, event) => [
      ...records,
      { event, key: describeJournalEvent(event).expectedKey, position: JournalPosition.make(records.length + 1), runId }
    ],
    executing.records
  )
}

const testJournalLayer = (result: AcceptedResult) =>
  liveJournalTestLayer({ records: acceptedRecordsFor(result), runId, target: trackerTarget })

it.effect("admits a durable accepted result only after its exact manifest qualifies", () =>
  Effect.gen(function* () {
    const store = yield* EvidenceStore
    const manifest = AcceptedResultEvidenceManifest.make({
      commit: GitCommitSha.make("a".repeat(40)),
      correlation: { attemptId: attempt.attemptId, runId },
      formatVersion: 1,
      outcome: "Accepted",
      predecessor: null
    })
    const reference = yield* store.put(bytesFor(manifest))
    const result = acceptedResultIn(reference)
    const { queued, records } = yield* Effect.gen(function* () {
      const queued = yield* queueAcceptedResultIntegrationResponsibility(attempt, result, target)
      const records = yield* InRunJournal.pipe(Effect.flatMap((journal) => journal.read(runId)))
      return { queued, records }
    }).pipe(Effect.provide(testJournalLayer(result)))
    expect(queued.acceptedResult).toEqual(result)
    expect(records.filter(({ event }) => event._tag === "IntegrationResponsibilityBegan")).toHaveLength(1)
  }).pipe(Effect.provide(memoryEvidenceStoreLayer.pipe(Layer.provide(NodeServices.layer))))
)

it.effect("waits when acceptance evidence is unavailable without consuming integration", () =>
  Effect.gen(function* () {
    const result = AcceptedResult.make({
      commit: GitCommitSha.make("a".repeat(40)),
      evidenceManifest: EvidenceReference.make({ byteLength: 12, digest: EvidenceDigest.make("b".repeat(64)) })
    })
    const { failure, records } = yield* Effect.gen(function* () {
      const failure = yield* Effect.flip(queueAcceptedResultIntegrationResponsibility(attempt, result, target))
      const records = yield* InRunJournal.pipe(Effect.flatMap((journal) => journal.read(runId)))
      return { failure, records }
    }).pipe(Effect.provide(testJournalLayer(result)))
    expect(failure).toBeInstanceOf(AcceptedResultEvidenceUnavailable)
    expect(records.some(({ event }) => event._tag === "IntegrationResponsibilityBegan")).toBe(false)
  }).pipe(
    Effect.provide(
      Layer.succeed(
        EvidenceStore,
        EvidenceStore.of({
          put: () => Effect.die("unused"),
          read: () =>
            Effect.fail(
              new EvidenceStoreFailure({
                detail: "acceptance object not published yet",
                operation: "EvidenceStore.read"
              })
            )
        })
      )
    )
  )
)

it.effect("exposes malformed or mismatched acceptance bytes as a task-local conflict", () =>
  Effect.gen(function* () {
    const result = AcceptedResult.make({
      commit: GitCommitSha.make("a".repeat(40)),
      evidenceManifest: EvidenceReference.make({ byteLength: 1, digest: EvidenceDigest.make("c".repeat(64)) })
    })
    const bytes = new TextEncoder().encode(JSON.stringify({ formatVersion: 1, outcome: "Accepted" }))
    const failure = yield* Effect.flip(
      qualifyAcceptedResultEvidence(attempt, result).pipe(
        Effect.provideService(
          EvidenceStore,
          EvidenceStore.of({ put: () => Effect.die("unused"), read: () => Effect.succeed(bytes) })
        )
      )
    )
    expect(failure).toBeInstanceOf(AcceptedResultEvidenceConflict)
    expect(failure.attemptId).toBe(attempt.attemptId)
    expect(failure.runId).toBe(runId)
  })
)
