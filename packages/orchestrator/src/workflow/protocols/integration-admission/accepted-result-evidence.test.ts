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
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { Effect, Layer } from "effect"
import { NodeServices } from "@effect/platform-node"
import { expect } from "vitest"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { defaultTaskWorkCapacity } from "../../../coordination/admission/capacity.js"
import { InitialControlPolicy } from "../../../control/policy.js"
import { memoryJournalTestLayer } from "../../../workflow-journal/adapters/memory-store.js"
import {
  attemptPlanRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey
} from "../../../workflow-journal/record-key.js"
import { JournalStore } from "../../../workflow-journal/store.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "../planned-attempt-executor-work/events.js"
import { EvidenceStore, EvidenceStoreFailure, memoryEvidenceStoreLayer } from "../evidence-store.js"
import {
  AcceptedResultEvidenceConflict,
  AcceptedResultEvidenceUnavailable,
  qualifyAcceptedResultEvidence,
  queueAcceptedResultIntegrationResponsibility
} from "./protocol.js"
import { TaskAttemptPlannedEvent } from "../../registry/event.js"
import { OperationId } from "../../identity.js"
import { makeTaskAttemptPlanOperation } from "../../registry/operation.js"

const runId = RunId.make("accepted-result-evidence-run")
const attempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("accepted-result-evidence-attempt"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/accepted-result-evidence"),
  executor: TaskExecutorLocator.make("executor:accepted-result-evidence"),
  runId,
  taskId: TaskId.make("accepted-result-evidence-task"),
  taskRevision: TaskRevision.make("accepted-result-evidence-revision"),
  worktree: WorktreeLocator.make("/worktrees/accepted-result-evidence")
})
const target = IntegrationTarget.make({
  repository: GitRepositoryLocator.make("/repositories/accepted-result-evidence.git"),
  ref: IntegrationTargetRef.make("refs/heads/main")
})
const bytesFor = (manifest: AcceptedResultEvidenceManifest): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(manifest))

const acceptedResultIn = (reference: AcceptedResult["evidenceManifest"]): AcceptedResult =>
  AcceptedResult.make({ commit: GitCommitSha.make("a".repeat(40)), evidenceManifest: reference })

const appendDurableAcceptedReport = (result: AcceptedResult) =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      FixtureTarget.make("accepted-result-evidence-target"),
      InitialControlPolicy.make({ taskExecutionCapacity: defaultTaskWorkCapacity })
    )
    yield* journal.append(
      runId,
      attemptPlanRecordKey(attempt.attemptId),
      TaskAttemptPlannedEvent.make({
        operation: makeTaskAttemptPlanOperation({
          operationId: OperationId.make("accepted-result-evidence-plan"),
          plannedAttempt: attempt,
          predecessorOperationIds: []
        }),
        version: workflowJournalEventVersion
      })
    )
    yield* journal.append(
      runId,
      plannedAttemptExecutorWorkResponsibilityBeganRecordKey(attempt.attemptId),
      PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
        plannedAttempt: attempt,
        version: workflowJournalEventVersion
      })
    )
    yield* journal.append(
      runId,
      plannedAttemptExecutorWorkReportedRecordKey(attempt.attemptId, PlannedAttemptExecutorReportOrdinal.make(1)),
      PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
        report: PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
          correlation: { attemptId: attempt.attemptId, runId },
          result: { _tag: "Accepted", acceptedResult: result }
        }),
        version: workflowJournalEventVersion
      })
    )
  })

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
    yield* appendDurableAcceptedReport(result)

    const queued = yield* queueAcceptedResultIntegrationResponsibility(attempt, result, target)
    const records = yield* JournalStore.pipe(Effect.flatMap((journal) => journal.read(runId)))
    expect(queued.acceptedResult).toEqual(result)
    expect(records.filter(({ event }) => event._tag === "IntegrationResponsibilityBegan")).toHaveLength(1)
  }).pipe(
    Effect.provide(memoryJournalTestLayer),
    Effect.provide(memoryEvidenceStoreLayer.pipe(Layer.provide(NodeServices.layer)))
  )
)

it.effect("waits when acceptance evidence is unavailable without consuming integration", () =>
  Effect.gen(function* () {
    const result = AcceptedResult.make({
      commit: GitCommitSha.make("a".repeat(40)),
      evidenceManifest: EvidenceReference.make({ byteLength: 12, digest: EvidenceDigest.make("b".repeat(64)) })
    })
    yield* appendDurableAcceptedReport(result)
    const failure = yield* Effect.flip(queueAcceptedResultIntegrationResponsibility(attempt, result, target))
    expect(failure).toBeInstanceOf(AcceptedResultEvidenceUnavailable)
    expect(
      (yield* JournalStore.pipe(Effect.flatMap((journal) => journal.read(runId)))).some(
        ({ event }) => event._tag === "IntegrationResponsibilityBegan"
      )
    ).toBe(false)
  }).pipe(
    Effect.provide(memoryJournalTestLayer),
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
    yield* appendDurableAcceptedReport(result)
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
  }).pipe(Effect.provide(memoryJournalTestLayer))
)
