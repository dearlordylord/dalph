import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { it } from "@effect/vitest"
import {
  AttemptId,
  AcceptedResult,
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
import { Effect, FileSystem, Layer, Path, Schema } from "effect"
import { expect } from "vitest"
import { FixtureTarget } from "../authorities/task-tracker/fixture/target.js"
import { ActiveTaskClaim, UnclaimedTask } from "../authorities/task-tracker/claim-mutation.js"
import { ClaimOwner, ClaimToken } from "../authorities/task-tracker/claim.js"
import { InitialControlPolicy } from "../control/policy.js"
import { TaskWorkCapacity } from "../coordination/admission/capacity.js"
import { JournalDatabaseLocator, JournalPosition } from "../workflow-journal/identity.js"
import { memoryJournalStoreLayer, memoryJournalTestLayer } from "../workflow-journal/adapters/memory-store.js"
import { sqliteJournalStoreLayer, sqliteJournalTestLayer } from "../workflow-journal/adapters/sqlite-store.js"
import { JournalStore } from "../workflow-journal/store.js"
import type { JournalRecord } from "../workflow-journal/store.js"
import { WorkflowActor } from "../workflow/registry/actor.js"
import {
  ControlDirectionAppliedEvent,
  ControlDirectionApplicationOrdinal
} from "../workflow/protocols/control-direction-application/events.js"
import {
  AttemptChoiceAppliedEvent,
  AttemptChoiceRequestId,
  AttemptChoiceSubject,
  StoppedAttemptClaimNoReleaseObservedEvent
} from "../workflow/protocols/attempt-choice/events.js"
import {
  CancelledAttemptClaimNoReleaseObservedEvent,
  CancelledAttemptImplementationResponsibilityRelinquishedEvent,
  RunCancellationAppliedEvent
} from "../workflow/protocols/run-cancellation/events.js"
import {
  IntegratorCandidateCleanupAuthorization,
  IntegratorCandidateCleanupDisposition,
  IntegratorCandidateCleanupEvidenceRevision,
  IntegratorCandidateCleanupOwner,
  BranchCleanupAuthorization,
  BranchCleanupEvidenceRevision,
  BranchCleanupOwner,
  WorktreeCleanupEvidenceRevision
} from "../workflow/protocols/disposition-cleanup/disposition.js"
import {
  IntegratorCandidateCleanupMutationResult,
  IntegratorCandidateCleanupObservation,
  integratorCandidateCleanupTestLayer,
  runIntegratorCandidateCleanup
} from "../workflow/protocols/disposition-cleanup/integrator-candidate.js"
import {
  IntegratorCandidateResourceLocator,
  IntegratorSessionCorrelation,
  IntegratorSessionId
} from "../workflow/protocols/integrator/events.js"
import {
  IntegratorSuccessorPreparationInput,
  integratorSuccessorCorrelationFor
} from "../workflow/protocols/integrator/session.js"
import {
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  WorkflowRunBeganEvent
} from "../workflow/registry/event.js"
import { describeJournalEvent } from "../workflow/registry/event-descriptor.js"
import { workflowJournalEventVersion } from "../workflow/kernel/event.js"
import { OperationId } from "../workflow/identity.js"
import { makeTaskAttemptPlanOperation, makeTaskClaimAcquisitionOperation } from "../workflow/registry/operation.js"
import {
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "../workflow/protocols/planned-attempt-executor-work/events.js"
import {
  BranchCleanupAuthorizedEvent,
  BranchCleanupMutationResult,
  BranchCleanupObservation,
  branchCleanupTestLayer,
  runBranchCleanup
} from "../workflow/protocols/disposition-cleanup/branch.js"
import {
  WorktreeCleanupMutationResult,
  WorktreeCleanupObservation,
  WorktreeCleanupContradictedEvent,
  WorktreeCleanupAuthorizedEvent,
  runWorktreeCleanup,
  worktreeCleanupTestLayer
} from "../workflow/protocols/disposition-cleanup/worktree.js"
import { deriveCleanupAuthorizations } from "../workflow/protocols/disposition-cleanup/activation.js"
import {
  appendAbandonedProvenance,
  appendCandidateProvenance,
  appendReplacementProvenance
} from "../workflow/protocols/disposition-cleanup/provenance-fixtures.js"
import {
  attempt,
  authorization as worktreeAuthorization,
  runId as cleanupRunId,
  successor as worktreeSuccessor
} from "../workflow/protocols/disposition-cleanup/fixtures.js"
import {
  branchCleanupAuthorizedRecordKey,
  plannedAttemptExecutorCommandIntendedRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  plannedAttemptExecutorWorkResponsibilityBeganRecordKey,
  worktreeCleanupAuthorizedRecordKey
} from "../workflow-journal/record-key.js"
import {
  makeTraceReader,
  TraceAtCursor,
  TraceCursor,
  TraceProjectionInvalid,
  traceControlDispositionFacetVersion,
  traceReaderSchemaVersion
} from "./trace-reader.js"

const runId = RunId.make("issue-83-control-disposition-run")
const independentRunId = RunId.make("issue-83-control-disposition-independent")
const target = FixtureTarget.make("issue-83-control-disposition-target")
const initialPolicy = InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
const controlAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("issue-83-control-disposition-attempt"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/issue-83-control-disposition"),
  executor: TaskExecutorLocator.make("executor:issue-83-control-disposition"),
  runId,
  taskId: TaskId.make("issue-83-control-disposition-task"),
  taskRevision: TaskRevision.make("issue-83-control-disposition-revision"),
  worktree: WorktreeLocator.make("/worktrees/issue-83-control-disposition")
})
const candidateAcceptedResult = AcceptedResult.make({
  commit: attempt.baseSha,
  evidenceManifest: EvidenceReference.make({ byteLength: 1, digest: EvidenceDigest.make("a".repeat(64)) })
})
const candidateTarget = IntegrationTarget.make({
  ref: IntegrationTargetRef.make("refs/heads/main"),
  repository: GitRepositoryLocator.make("repo:issue-83-candidate")
})
const candidatePredecessor = IntegratorSessionCorrelation.make({
  acceptedResult: candidateAcceptedResult,
  candidateResource: IntegratorCandidateResourceLocator.make("candidate:issue-83-predecessor"),
  expectedTargetHead: attempt.baseSha,
  integrationTarget: candidateTarget,
  plannedAttempt: attempt,
  queuedAt: JournalPosition.make(5),
  sessionId: IntegratorSessionId.make("session:issue-83-predecessor"),
  startedAt: JournalPosition.make(6),
  targetLineageObservedAt: JournalPosition.make(8)
})
const candidateSuccessor = integratorSuccessorCorrelationFor(
  IntegratorSuccessorPreparationInput.make({
    directionAppliedAt: JournalPosition.make(13),
    predecessor: candidatePredecessor,
    quarantineAt: JournalPosition.make(12),
    targetLineage: {
      plannedBaseIsAncestorOfTargetHead: true,
      plannedBaseSha: attempt.baseSha,
      targetHeadSha: attempt.baseSha
    },
    targetLineageObservedAt: JournalPosition.make(15)
  })
)
const candidateCleanupAuthorization = IntegratorCandidateCleanupAuthorization.make({
  causalPredecessors: [OperationId.make("issue-83-candidate-full-rerun")],
  disposition: IntegratorCandidateCleanupDisposition.make({
    directionAppliedAt: JournalPosition.make(13),
    dispositionAt: JournalPosition.make(12),
    predecessor: candidatePredecessor,
    successor: candidateSuccessor
  }),
  evidenceRevision: IntegratorCandidateCleanupEvidenceRevision.make(1),
  locator: candidatePredecessor.candidateResource,
  observationAt: candidatePredecessor.targetLineageObservedAt,
  observationOperationId: OperationId.make(`${candidatePredecessor.sessionId}:predecessor-lineage`),
  operationId: OperationId.make("issue-83-candidate-cleanup"),
  owner: IntegratorCandidateCleanupOwner.make({ sessionId: candidatePredecessor.sessionId }),
  writerQuiescent: true
})
const candidateCleanupBoundaryLayer = () =>
  integratorCandidateCleanupTestLayer({
    observations: [
      IntegratorCandidateCleanupObservation.cases.Present.make({
        locator: candidatePredecessor.candidateResource,
        revision: IntegratorCandidateCleanupEvidenceRevision.make(1),
        sessionId: candidatePredecessor.sessionId,
        writerQuiescent: true
      }),
      IntegratorCandidateCleanupObservation.cases.Absent.make({
        locator: candidatePredecessor.candidateResource,
        revision: IntegratorCandidateCleanupEvidenceRevision.make(2)
      })
    ],
    mutations: [
      IntegratorCandidateCleanupMutationResult.cases.Removed.make({
        locator: candidatePredecessor.candidateResource,
        revision: IntegratorCandidateCleanupEvidenceRevision.make(2),
        sessionId: candidatePredecessor.sessionId
      })
    ]
  })
const record = (position: number, event: JournalRecord["event"], recordRunId: RunId): JournalRecord => ({
  event,
  key: describeJournalEvent(event).expectedKey,
  position: JournalPosition.make(position),
  runId: recordRunId
})

const runBeginningFor = (recordRunId: RunId, recordTarget: typeof target): JournalRecord =>
  record(
    1,
    WorkflowRunBeganEvent.make({
      initialControlPolicy: initialPolicy,
      initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
      occurrenceClassification: "InitiatedAction",
      target: recordTarget,
      version: workflowJournalEventVersion
    }),
    recordRunId
  )

const controlRecords = (recordRunId: RunId = runId): ReadonlyArray<JournalRecord> => {
  const subjectRun = { _tag: "Run" as const, runId: recordRunId }
  const subjectTask = { _tag: "Task" as const, runId: recordRunId, taskId: controlAttempt.taskId }
  const requestId = AttemptChoiceRequestId.make({ nonce: "issue-83-choice", runId: recordRunId })
  const subject = AttemptChoiceSubject.make({
    observedTaskRevision: TaskRevision.make("issue-83-observed-revision"),
    plannedAttempt: PlannedTaskAttempt.make({ ...controlAttempt, runId: recordRunId })
  })
  return [
    runBeginningFor(recordRunId, target),
    record(
      2,
      ControlDirectionAppliedEvent.make({
        direction: "Pause",
        initiatedBy: WorkflowActor.cases.Operator.make({}),
        occurrenceClassification: "InitiatedAction",
        ordinal: ControlDirectionApplicationOrdinal.make(1),
        subject: subjectRun,
        version: workflowJournalEventVersion
      }),
      recordRunId
    ),
    record(
      3,
      ControlDirectionAppliedEvent.make({
        direction: "Unpause",
        initiatedBy: WorkflowActor.cases.Operator.make({}),
        occurrenceClassification: "InitiatedAction",
        ordinal: ControlDirectionApplicationOrdinal.make(2),
        subject: subjectTask,
        version: workflowJournalEventVersion
      }),
      recordRunId
    ),
    record(
      4,
      AttemptChoiceAppliedEvent.make({
        choice: "ContinueExistingAttempt",
        initiatedBy: WorkflowActor.cases.Operator.make({}),
        occurrenceClassification: "InitiatedAction",
        requestId,
        subject,
        version: workflowJournalEventVersion
      }),
      recordRunId
    ),
    record(
      5,
      AttemptChoiceAppliedEvent.make({
        choice: "RestartTaskImplementation",
        initiatedBy: WorkflowActor.cases.Operator.make({}),
        occurrenceClassification: "InitiatedAction",
        requestId: AttemptChoiceRequestId.make({ nonce: "issue-83-restart", runId: recordRunId }),
        subject,
        version: workflowJournalEventVersion
      }),
      recordRunId
    ),
    record(
      6,
      AttemptChoiceAppliedEvent.make({
        choice: "StopTaskImplementation",
        initiatedBy: WorkflowActor.cases.Operator.make({}),
        occurrenceClassification: "InitiatedAction",
        requestId: AttemptChoiceRequestId.make({ nonce: "issue-83-stop", runId: recordRunId }),
        subject,
        version: workflowJournalEventVersion
      }),
      recordRunId
    )
  ]
}

const cancellationSettlementRecords = (): ReadonlyArray<JournalRecord> => {
  const claimOperation = makeTaskClaimAcquisitionOperation({
    acquisition: {
      operationId: OperationId.make("issue-83-cancel-settlement-claim"),
      owner: ClaimOwner.make("issue-83-cancel-settlement-owner"),
      taskId: controlAttempt.taskId,
      token: ClaimToken.make("issue-83-cancel-settlement-token")
    },
    predecessorOperationIds: []
  })
  const claim = ActiveTaskClaim.make(claimOperation.acquisition)
  const planOperation = makeTaskAttemptPlanOperation({
    operationId: OperationId.make("issue-83-cancel-settlement-plan"),
    plannedAttempt: controlAttempt,
    predecessorOperationIds: [claim.operationId]
  })
  const commandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(1)
  const reportOrdinal = PlannedAttemptExecutorReportOrdinal.make(1)
  const cancellationAppliedAt = JournalPosition.make(8)
  return [
    runBeginningFor(runId, target),
    record(
      2,
      TaskClaimAcquisitionIntendedEvent.make({ operation: claimOperation, version: workflowJournalEventVersion }),
      runId
    ),
    record(3, TaskClaimAcquiredEvent.make({ claim, version: workflowJournalEventVersion }), runId),
    record(4, TaskAttemptPlannedEvent.make({ operation: planOperation, version: workflowJournalEventVersion }), runId),
    record(
      5,
      PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
        plannedAttempt: controlAttempt,
        version: workflowJournalEventVersion
      }),
      runId
    ),
    record(
      6,
      PlannedAttemptExecutorCommandIntendedEvent.make({
        command: "Begin",
        initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
        occurrenceClassification: "InitiatedAction",
        ordinal: commandOrdinal,
        plannedAttempt: controlAttempt,
        version: workflowJournalEventVersion
      }),
      runId
    ),
    record(
      7,
      PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: reportOrdinal,
        report: PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
          correlation: { attemptId: controlAttempt.attemptId, runId }
        }),
        version: workflowJournalEventVersion
      }),
      runId
    ),
    record(
      Number(cancellationAppliedAt),
      RunCancellationAppliedEvent.make({
        initiatedBy: WorkflowActor.cases.Operator.make({}),
        occurrenceClassification: "InitiatedAction",
        version: workflowJournalEventVersion
      }),
      runId
    ),
    record(
      9,
      CancelledAttemptImplementationResponsibilityRelinquishedEvent.make({
        authorizedClaim: claim,
        cancellationAppliedAt,
        initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
        occurrenceClassification: "InitiatedAction",
        plannedAttempt: controlAttempt,
        proof: { _tag: "AcceptedReport", reportOrdinal },
        version: workflowJournalEventVersion
      }),
      runId
    )
  ]
}

const appendRecords = Effect.fn("TraceReaderControlDispositionTest.appendRecords")(function* (
  journal: JournalStore["Service"],
  records: ReadonlyArray<JournalRecord>
) {
  const beginning = records[0]
  if (beginning === undefined || beginning.event._tag !== "WorkflowRunBegan") {
    return yield* Effect.die("control-disposition fixture must begin with WorkflowRunBegan")
  }
  yield* journal.beginRun(beginning.runId, beginning.event.target, beginning.event.initialControlPolicy)
  for (const item of records.slice(1)) {
    if (item.event._tag === "WorkflowRunBegan" || item.event._tag === "WorkflowRunTerminated") {
      return yield* Effect.die("control-disposition fixture cannot append a Run lifecycle event")
    }
    yield* journal.append(item.runId, item.key, item.event)
  }
})

const establishCandidateCleanupPrefix = Effect.fn("TraceReaderControlDispositionTest.establishCandidateCleanupPrefix")(
  function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(cleanupRunId, FixtureTarget.make("issue-83-candidate-target"), initialPolicy)
    const commandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(1)
    const reportOrdinal = PlannedAttemptExecutorReportOrdinal.make(1)
    yield* journal.append(
      cleanupRunId,
      plannedAttemptExecutorWorkResponsibilityBeganRecordKey(attempt.attemptId),
      PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
        plannedAttempt: attempt,
        version: workflowJournalEventVersion
      })
    )
    yield* journal.append(
      cleanupRunId,
      plannedAttemptExecutorCommandIntendedRecordKey(attempt.attemptId, commandOrdinal),
      PlannedAttemptExecutorCommandIntendedEvent.make({
        command: "Begin",
        initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
        occurrenceClassification: "InitiatedAction",
        ordinal: commandOrdinal,
        plannedAttempt: attempt,
        version: workflowJournalEventVersion
      })
    )
    yield* journal.append(
      cleanupRunId,
      plannedAttemptExecutorWorkReportedRecordKey(attempt.attemptId, reportOrdinal),
      PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: reportOrdinal,
        report: PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
          correlation: { attemptId: attempt.attemptId, runId: cleanupRunId },
          result: { _tag: "Accepted", acceptedResult: candidateAcceptedResult }
        }),
        version: workflowJournalEventVersion
      })
    )
    yield* appendCandidateProvenance(
      candidatePredecessor,
      candidateSuccessor,
      "issue-83-candidate-full-rerun",
      "StartupValid"
    )
  }
)

const candidateCleanupRecords = Effect.fn("TraceReaderControlDispositionTest.candidateCleanupRecords")(function* () {
  const journal = yield* JournalStore
  yield* establishCandidateCleanupPrefix()
  const outcome = yield* runIntegratorCandidateCleanup(candidateCleanupAuthorization)
  if (outcome._tag !== "Settled") return yield* Effect.die("candidate cleanup fixture did not settle")
  return yield* journal.read(cleanupRunId)
})

const nodeFileSystemAndPath = Layer.merge(NodeFileSystem.layer, NodePath.layer)

it.effect("projects applied Pause Unpause Continue Restart and Stop at the exact cursor", () =>
  Effect.gen(function* () {
    const records = controlRecords()
    const view = yield* makeTraceReader({ read: () => Effect.succeed(records) }).readAt(
      TraceCursor.make({ position: JournalPosition.make(6), runId })
    )
    expect(view.version).toBe(traceReaderSchemaVersion)
    expect(view.facets.controlDisposition.version).toBe(traceControlDispositionFacetVersion)
    expect(view.facets.controlDisposition.controls.map(({ _tag }) => _tag)).toEqual([
      "Direction",
      "Direction",
      "AttemptChoice",
      "AttemptChoice",
      "AttemptChoice"
    ])
    expect(
      view.facets.controlDisposition.controls.map((control) =>
        control._tag === "Direction" ? control.direction : control.choice
      )
    ).toEqual(["Pause", "Unpause", "ContinueExistingAttempt", "RestartTaskImplementation", "StopTaskImplementation"])
    expect(view.facets.controlDisposition.controls[0]?.source.position).toBe(JournalPosition.make(2))
    expect(
      view.facets.controlDisposition.controls[0]?._tag === "Direction" &&
        view.facets.controlDisposition.controls[0].subject._tag
    ).toBe("Run")
    expect(
      view.facets.controlDisposition.controls[1]?._tag === "Direction" &&
        view.facets.controlDisposition.controls[1].subject._tag
    ).toBe("Task")
    expect(Schema.is(TraceAtCursor)(view)).toBe(true)
  })
)

it.effect("does not leak a later control into an earlier cursor", () =>
  Effect.gen(function* () {
    const records = controlRecords()
    const view = yield* makeTraceReader({ read: () => Effect.succeed(records) }).readAt(
      TraceCursor.make({ position: JournalPosition.make(3), runId })
    )
    expect(view.items.map(({ identity }) => identity.position)).toEqual([
      JournalPosition.make(2),
      JournalPosition.make(3)
    ])
    expect(view.facets.controlDisposition.controls.map(({ _tag }) => _tag)).toEqual(["Direction", "Direction"])
    expect(
      view.facets.controlDisposition.controls.some((control) => control.source.position > JournalPosition.make(3))
    ).toBe(false)
  })
)

it.effect("reopens the same exact control view through memory and SQLite", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const records = controlRecords()
      const cursor = TraceCursor.make({ position: JournalPosition.make(6), runId })
      const memory = yield* Effect.scoped(
        Effect.gen(function* () {
          const journal = yield* JournalStore
          yield* appendRecords(journal, records)
          const reader = makeTraceReader({ read: journal.read })
          const first = yield* reader.readAt(cursor)
          const reopened = yield* makeTraceReader({ read: journal.read }).readAt(cursor)
          return { first, reopened }
        }).pipe(Effect.provide(memoryJournalStoreLayer))
      )
      expect(memory.reopened).toEqual(memory.first)
      expect(memory.reopened.facets.controlDisposition).toEqual(memory.first.facets.controlDisposition)

      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-trace-issue-83-" })
      const filename = JournalDatabaseLocator.make(path.join(directory, "journal.sqlite"))
      const sqliteLayer = sqliteJournalStoreLayer({ filename })
      const firstSqlite = yield* Effect.scoped(
        Effect.gen(function* () {
          const journal = yield* JournalStore
          yield* appendRecords(journal, records)
          return yield* makeTraceReader({ read: journal.read }).readAt(cursor)
        }).pipe(Effect.provide(sqliteLayer))
      )
      const reopenedSqlite = yield* Effect.scoped(
        Effect.gen(function* () {
          const journal = yield* JournalStore
          return yield* makeTraceReader({ read: journal.read }).readAt(cursor)
        }).pipe(Effect.provide(sqliteLayer))
      )
      expect(reopenedSqlite).toEqual(firstSqlite)
      expect(reopenedSqlite.facets.controlDisposition.controls).toEqual(firstSqlite.facets.controlDisposition.controls)
    }).pipe(Effect.provide(nodeFileSystemAndPath))
  )
)

it.effect("records an applied Run cancellation as its own Operator disposition", () =>
  Effect.gen(function* () {
    const records = [
      runBeginningFor(runId, target),
      record(
        2,
        RunCancellationAppliedEvent.make({
          initiatedBy: WorkflowActor.cases.Operator.make({}),
          occurrenceClassification: "InitiatedAction",
          version: workflowJournalEventVersion
        }),
        runId
      )
    ]
    const view = yield* makeTraceReader({ read: () => Effect.succeed(records) }).readAt(
      TraceCursor.make({ position: JournalPosition.make(2), runId })
    )
    expect(view.facets.controlDisposition.dispositions).toEqual([
      {
        _tag: "RunCancellationApplied",
        initiatedBy: { _tag: "Operator" },
        source: { runId, position: JournalPosition.make(2) }
      }
    ])
  })
)

it.effect("fails closed for a cancelled-attempt relinquishment with malformed executor proof", () =>
  Effect.gen(function* () {
    const records = cancellationSettlementRecords()
    const relinquishment = records.at(-1)
    if (relinquishment?.event._tag !== "CancelledAttemptImplementationResponsibilityRelinquished") {
      return yield* Effect.die("cancellation settlement fixture lacks relinquishment")
    }
    const malformed = [
      ...records.slice(0, -1),
      {
        ...relinquishment,
        event: CancelledAttemptImplementationResponsibilityRelinquishedEvent.make({
          ...relinquishment.event,
          proof: { _tag: "AcceptedReport", reportOrdinal: PlannedAttemptExecutorReportOrdinal.make(2) }
        })
      }
    ]
    const last = malformed.at(-1)
    if (last === undefined) return yield* Effect.die("malformed cancellation fixture is empty")
    const failure = yield* Effect.flip(
      makeTraceReader({ read: () => Effect.succeed(malformed) }).readAt(
        TraceCursor.make({ position: last.position, runId })
      )
    )
    expect(failure).toBeInstanceOf(TraceProjectionInvalid)
    if (failure._tag !== "TraceProjectionInvalid") return
    expect(failure.detail).toContain(
      "cancelled-attempt relinquishment requires current safe or terminal executor evidence"
    )
  })
)

it.effect("fails closed for forward executor work after Run cancellation", () =>
  Effect.gen(function* () {
    const records = cancellationSettlementRecords()
    const last = records.at(-1)
    if (last === undefined) return yield* Effect.die("cancellation settlement fixture is empty")
    const forwardWork = record(
      Number(last.position) + 1,
      PlannedAttemptExecutorCommandIntendedEvent.make({
        command: "Begin",
        initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
        occurrenceClassification: "InitiatedAction",
        ordinal: PlannedAttemptExecutorCommandOrdinal.make(2),
        plannedAttempt: controlAttempt,
        version: workflowJournalEventVersion
      }),
      runId
    )
    const malformed = [...records, forwardWork]
    const failure = yield* Effect.flip(
      makeTraceReader({ read: () => Effect.succeed(malformed) }).readAt(
        TraceCursor.make({ position: forwardWork.position, runId })
      )
    )
    expect(failure).toBeInstanceOf(TraceProjectionInvalid)
    if (failure._tag !== "TraceProjectionInvalid") return
    expect(failure.detail).toContain(
      "post-cancellation history cannot record forward-work event PlannedAttemptExecutorCommandIntended"
    )
  })
)

it.effect("fails closed for executor responsibility beginning after Run cancellation", () =>
  Effect.gen(function* () {
    const records = cancellationSettlementRecords()
    const last = records.at(-1)
    if (last === undefined) return yield* Effect.die("cancellation settlement fixture is empty")
    const forwardResponsibility = record(
      Number(last.position) + 1,
      PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
        plannedAttempt: controlAttempt,
        version: workflowJournalEventVersion
      }),
      runId
    )
    const malformed = [...records, forwardResponsibility]
    const failure = yield* Effect.flip(
      makeTraceReader({ read: () => Effect.succeed(malformed) }).readAt(
        TraceCursor.make({ position: forwardResponsibility.position, runId })
      )
    )
    expect(failure).toBeInstanceOf(TraceProjectionInvalid)
    if (failure._tag !== "TraceProjectionInvalid") return
    expect(failure.detail).toContain(
      "post-cancellation history cannot record forward-work event PlannedAttemptExecutorWorkResponsibilityBegan"
    )
  })
)

it.effect(
  "fails a cancellation observation without its exact earlier Run cancellation and keeps another Run readable",
  () =>
    Effect.gen(function* () {
      const expectedClaim = ActiveTaskClaim.make({
        operationId: OperationId.make("issue-83-cancel-claim"),
        owner: ClaimOwner.make("issue-83-cancel-owner"),
        taskId: controlAttempt.taskId,
        token: ClaimToken.make("issue-83-cancel-token")
      })
      const malformed = [
        runBeginningFor(runId, target),
        record(
          2,
          CancelledAttemptClaimNoReleaseObservedEvent.make({
            cancellationAppliedAt: JournalPosition.make(1),
            expectedClaim,
            observation: UnclaimedTask.make({ taskId: controlAttempt.taskId }),
            observationOperationId: OperationId.make("issue-83-cancel-observation"),
            occurrenceClassification: "NonActionOccurrence",
            plannedAttempt: controlAttempt,
            version: workflowJournalEventVersion
          }),
          runId
        )
      ]
      const reader = makeTraceReader({
        read: (requestedRunId) =>
          Effect.succeed(requestedRunId === runId ? malformed : controlRecords(independentRunId))
      })
      const failure = yield* Effect.flip(reader.readAt(TraceCursor.make({ position: JournalPosition.make(2), runId })))
      expect(failure).toBeInstanceOf(TraceProjectionInvalid)
      const independent = yield* reader.readAt(
        TraceCursor.make({ position: JournalPosition.make(6), runId: independentRunId })
      )
      expect(independent.cursor.runId).toBe(independentRunId)
      expect(independent.facets.controlDisposition.controls).toHaveLength(5)
    })
)

it.effect("fails closed for malformed Stop abandonment and stopped-claim prefixes", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(cleanupRunId, FixtureTarget.make("issue-83-stop-validation-target"), initialPolicy)
    yield* appendAbandonedProvenance(attempt)
    const records = yield* journal.read(cleanupRunId)
    const abandonment = records.find(({ event }) => event._tag === "AttemptImplementationAbandoned")
    if (abandonment?.event._tag !== "AttemptImplementationAbandoned") {
      return yield* Effect.die("Stop validation fixture did not record abandonment")
    }
    const lastElementOffset = -1
    const lastRecord = records.at(lastElementOffset)
    if (lastRecord === undefined) return yield* Effect.die("Stop validation fixture is empty")
    const reindex = (values: ReadonlyArray<JournalRecord>): ReadonlyArray<JournalRecord> =>
      values.map((item, index) => ({ ...item, position: JournalPosition.make(index + 1) }))
    const malformed = [
      {
        detail: "requires its exact prior applied Stop choice",
        records: reindex(records.filter(({ event }) => event._tag !== "AttemptChoiceApplied"))
      },
      {
        detail: "requires its exact accepted Safe executor proof",
        records: reindex(
          records.map((item) =>
            item.event._tag !== "AttemptImplementationAbandoned"
              ? item
              : {
                  ...item,
                  event: {
                    ...item.event,
                    proof: {
                      _tag: "AcceptedReport" as const,
                      reportOrdinal: PlannedAttemptExecutorReportOrdinal.make(
                        Number(item.event.proof.reportOrdinal) + 1
                      )
                    }
                  }
                }
          )
        )
      },
      {
        detail: "requires its exact authorized claim",
        records: reindex(
          records.map((item) =>
            item.event._tag === "AttemptImplementationAbandoned"
              ? {
                  ...item,
                  event: {
                    ...item.event,
                    expectedClaim: ActiveTaskClaim.make({
                      ...item.event.expectedClaim,
                      token: ClaimToken.make("issue-83-stop-validation-foreign-token")
                    })
                  }
                }
              : item
          )
        )
      },
      {
        detail: "requires the latest exact post-baseline claim read",
        records: reindex([
          ...records,
          record(
            Number(lastRecord.position) + 1,
            StoppedAttemptClaimNoReleaseObservedEvent.make({
              expectedClaim: abandonment.event.expectedClaim,
              observation: UnclaimedTask.make({ taskId: attempt.taskId }),
              observationOperationId: OperationId.make("issue-83-stop-validation-missing-claim-read"),
              occurrenceClassification: "NonActionOccurrence",
              requestId: abandonment.event.requestId,
              subject: abandonment.event.subject,
              version: workflowJournalEventVersion
            }),
            cleanupRunId
          )
        ])
      }
    ]
    for (const variant of malformed) {
      const last = variant.records.at(-1)
      if (last === undefined) return yield* Effect.die("malformed Stop fixture is empty")
      const failure = yield* Effect.flip(
        makeTraceReader({ read: () => Effect.succeed(variant.records) }).readAt(
          TraceCursor.make({ position: last.position, runId: cleanupRunId })
        )
      )
      expect(failure).toBeInstanceOf(TraceProjectionInvalid)
      if (failure._tag !== "TraceProjectionInvalid") continue
      expect(failure.detail).toContain(variant.detail)
    }
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("fails closed for duplicate applied cancellation history", () =>
  Effect.gen(function* () {
    const applied = RunCancellationAppliedEvent.make({
      initiatedBy: WorkflowActor.cases.Operator.make({}),
      occurrenceClassification: "InitiatedAction",
      version: workflowJournalEventVersion
    })
    const records = [runBeginningFor(runId, target), record(2, applied, runId), record(3, applied, runId)]
    const failure = yield* Effect.flip(
      makeTraceReader({ read: () => Effect.succeed(records) }).readAt(
        TraceCursor.make({ position: JournalPosition.make(3), runId })
      )
    )
    expect(failure).toBeInstanceOf(TraceProjectionInvalid)
    if (failure._tag !== "TraceProjectionInvalid") return
    expect(failure.detail).toContain("RunCancellationApplied may occur only once")
  })
)

it.effect("rejects cleanup contradiction without its ordered observation prefix", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(cleanupRunId, FixtureTarget.make("issue-83-contradiction-prefix-target"), initialPolicy)
    const authorization = yield* appendAbandonedProvenance(attempt)
    const authorized = WorktreeCleanupAuthorizedEvent.make({
      authorization,
      initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
      occurrenceClassification: "InitiatedAction",
      version: workflowJournalEventVersion
    })
    yield* journal.append(cleanupRunId, worktreeCleanupAuthorizedRecordKey(authorization.operationId), authorized)
    const records = yield* journal.read(cleanupRunId)
    const contradiction = WorktreeCleanupContradictedEvent.make({
      authorization,
      detail: "malformed contradiction without observation",
      observation: WorktreeCleanupObservation.cases.Foreign.make({
        locator: authorization.locator,
        observedBranch: TaskBranchRef.make("refs/heads/foreign"),
        observedHead: authorization.expectedHead,
        reason: "OtherOwner",
        revision: authorization.evidenceRevision
      }),
      occurrenceClassification: "NonActionOccurrence",
      operationId: OperationId.make("issue-83-contradiction-missing-observation"),
      version: workflowJournalEventVersion
    })
    const malformed = [...records, record(Number(records.at(-1)?.position ?? 0) + 1, contradiction, cleanupRunId)]
    const last = malformed.at(-1)
    if (last === undefined) return yield* Effect.die("contradiction fixture is empty")
    const failure = yield* Effect.flip(
      makeTraceReader({ read: () => Effect.succeed(malformed) }).readAt(
        TraceCursor.make({ position: last.position, runId: cleanupRunId })
      )
    )
    expect(failure).toBeInstanceOf(TraceProjectionInvalid)
    if (failure._tag !== "TraceProjectionInvalid") return
    expect(failure.detail).toContain("cleanup contradiction requires its exact preceding observation intent and result")
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("rejects worktree cleanup authorization without its exact disposition provenance", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(cleanupRunId, FixtureTarget.make("issue-83-missing-cleanup-provenance"), initialPolicy)
    const authorized = WorktreeCleanupAuthorizedEvent.make({
      authorization: worktreeAuthorization,
      initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
      occurrenceClassification: "InitiatedAction",
      version: workflowJournalEventVersion
    })
    const appended = yield* journal.append(
      cleanupRunId,
      worktreeCleanupAuthorizedRecordKey(worktreeAuthorization.operationId),
      authorized
    )
    const failure = yield* Effect.flip(
      makeTraceReader({ read: journal.read }).readAt(
        TraceCursor.make({ position: appended.position, runId: cleanupRunId })
      )
    )
    expect(failure).toBeInstanceOf(TraceProjectionInvalid)
    if (failure._tag !== "TraceProjectionInvalid") return
    expect(failure.detail).toContain("Worktree cleanup provenance")
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("rejects branch cleanup authorization before the exact worktree cleanup has settled", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(cleanupRunId, FixtureTarget.make("issue-83-unsettled-worktree-target"), initialPolicy)
    yield* appendReplacementProvenance(attempt, worktreeSuccessor)
    const branchAuthorization = BranchCleanupAuthorization.make({
      causalPredecessors: [worktreeAuthorization.operationId, ...worktreeAuthorization.causalPredecessors],
      disposition: worktreeAuthorization.disposition,
      evidenceRevision: BranchCleanupEvidenceRevision.make(1),
      expectedHead: worktreeAuthorization.expectedHead,
      locator: attempt.branch,
      observationAt: worktreeAuthorization.observationAt,
      observationOperationId: worktreeAuthorization.observationOperationId,
      operationId: OperationId.make("issue-83-unsettled-branch-cleanup"),
      owner: BranchCleanupOwner.make({ attemptId: attempt.attemptId }),
      worktreeCleanupOperationId: worktreeAuthorization.operationId,
      writerQuiescent: true
    })
    const authorized = BranchCleanupAuthorizedEvent.make({
      authorization: branchAuthorization,
      initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
      occurrenceClassification: "InitiatedAction",
      version: workflowJournalEventVersion
    })
    const appended = yield* journal.append(
      cleanupRunId,
      branchCleanupAuthorizedRecordKey(branchAuthorization.operationId),
      authorized
    )
    const failure = yield* Effect.flip(
      makeTraceReader({ read: journal.read }).readAt(
        TraceCursor.make({ position: appended.position, runId: cleanupRunId })
      )
    )
    expect(failure).toBeInstanceOf(TraceProjectionInvalid)
    if (failure._tag !== "TraceProjectionInvalid") return
    expect(failure.detail).toContain("Branch cleanup provenance")
    expect(failure.detail).toContain("settled worktree")
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("keeps abandonment and authorized worktree cleanup distinct with exact source identities", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(cleanupRunId, FixtureTarget.make("issue-83-cleanup-target"), initialPolicy)
    const authorization = yield* appendAbandonedProvenance(attempt)
    const authorized = WorktreeCleanupAuthorizedEvent.make({
      authorization,
      initiatedBy: WorkflowActor.cases.DalphCoordinator.make({}),
      occurrenceClassification: "InitiatedAction",
      version: workflowJournalEventVersion
    })
    const appended = yield* journal.append(
      cleanupRunId,
      worktreeCleanupAuthorizedRecordKey(authorization.operationId),
      authorized
    )
    const view = yield* makeTraceReader({ read: journal.read }).readAt(
      TraceCursor.make({ position: appended.position, runId: cleanupRunId })
    )
    expect(view.facets.controlDisposition.dispositions.map(({ _tag }) => _tag)).toContain("AttemptAbandoned")
    expect(view.facets.controlDisposition.cleanup).toHaveLength(1)
    const cleanup = view.facets.controlDisposition.cleanup[0]
    expect(cleanup?._tag).toBe("Worktree")
    if (cleanup?._tag !== "Worktree") return
    expect(cleanup.status._tag).toBe("Authorized")
    expect(cleanup.status.source.position).toBe(appended.position)
    expect(cleanup.steps).toHaveLength(1)
    expect(cleanup.steps[0]?.source.position).toBe(appended.position)
  }).pipe(Effect.provide(memoryJournalStoreLayer))
)

it.effect("keeps every settled branch cleanup step separate after its settled worktree predecessor", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(cleanupRunId, FixtureTarget.make("issue-83-branch-target"), initialPolicy)
    yield* appendReplacementProvenance(attempt, worktreeSuccessor)
    const worktree = yield* runWorktreeCleanup(worktreeAuthorization)
    if (worktree._tag !== "Settled") return yield* Effect.die("worktree cleanup fixture did not settle")
    const branchAuthorization = deriveCleanupAuthorizations(yield* journal.read(cleanupRunId)).branch[0]
    if (branchAuthorization === undefined) return yield* Effect.die("branch cleanup authorization was not derived")
    const branchOutcome = yield* runBranchCleanup(branchAuthorization)
    if (branchOutcome._tag !== "Settled") return yield* Effect.die("branch cleanup fixture did not settle")
    const records = yield* journal.read(cleanupRunId)
    const settled = records.find(({ event }) => event._tag === "BranchCleanupSettled")
    if (settled === undefined) return yield* Effect.die("branch cleanup fixture did not record settlement")
    const view = yield* makeTraceReader({ read: journal.read }).readAt(
      TraceCursor.make({ position: settled.position, runId: cleanupRunId })
    )
    expect(view.facets.controlDisposition.cleanup.map(({ _tag }) => _tag)).toEqual(["Worktree", "Branch"])
    const branch = view.facets.controlDisposition.cleanup.find(({ _tag }) => _tag === "Branch")
    expect(branch?._tag).toBe("Branch")
    if (branch?._tag !== "Branch") return
    expect(branch.status._tag).toBe("Settled")
    expect(branch.status.source.position).toBe(settled.position)
    expect(branch.steps.map(({ event }) => event._tag)).toEqual([
      "BranchCleanupAuthorized",
      "BranchCleanupObservationIntended",
      "BranchCleanupObserved",
      "BranchCleanupMutationIntended",
      "BranchCleanupMutationResultRecorded",
      "BranchCleanupObservationIntended",
      "BranchCleanupObserved",
      "BranchCleanupAbsenceConfirmed",
      "BranchCleanupSettled"
    ])
  }).pipe(
    Effect.provide(
      branchCleanupTestLayer({
        observations: [
          BranchCleanupObservation.cases.Present.make({
            branch: attempt.branch,
            headSha: attempt.baseSha,
            registeredWorktree: null,
            revision: BranchCleanupEvidenceRevision.make(1)
          }),
          BranchCleanupObservation.cases.Absent.make({
            branch: attempt.branch,
            revision: BranchCleanupEvidenceRevision.make(2)
          })
        ],
        mutations: [
          BranchCleanupMutationResult.cases.Removed.make({
            branch: attempt.branch,
            revision: BranchCleanupEvidenceRevision.make(2)
          })
        ]
      })
    ),
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

it.effect("projects a contradictory branch observation without merging it into worktree cleanup", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(cleanupRunId, FixtureTarget.make("issue-83-branch-contradiction-target"), initialPolicy)
    yield* appendReplacementProvenance(attempt, worktreeSuccessor)
    const worktree = yield* runWorktreeCleanup(worktreeAuthorization)
    if (worktree._tag !== "Settled") return yield* Effect.die("worktree cleanup fixture did not settle")
    const branchAuthorization = deriveCleanupAuthorizations(yield* journal.read(cleanupRunId)).branch[0]
    if (branchAuthorization === undefined) return yield* Effect.die("branch cleanup authorization was not derived")
    const branch = yield* runBranchCleanup(branchAuthorization)
    if (branch._tag !== "Preserved") return yield* Effect.die("branch contradiction fixture was not preserved")
    const records = yield* journal.read(cleanupRunId)
    const contradicted = records.find(({ event }) => event._tag === "BranchCleanupContradicted")
    if (contradicted === undefined) return yield* Effect.die("branch contradiction fixture did not record its result")
    const view = yield* makeTraceReader({ read: journal.read }).readAt(
      TraceCursor.make({ position: contradicted.position, runId: cleanupRunId })
    )
    expect(view.facets.controlDisposition.cleanup.map(({ _tag }) => _tag)).toEqual(["Worktree", "Branch"])
    const cleanup = view.facets.controlDisposition.cleanup.find(({ _tag }) => _tag === "Branch")
    expect(cleanup?.status._tag).toBe("Contradicted")
    expect(cleanup?.status.source.position).toBe(contradicted.position)
  }).pipe(
    Effect.provide(
      branchCleanupTestLayer({
        observations: [
          BranchCleanupObservation.cases.Foreign.make({
            branch: attempt.branch,
            observedHead: GitCommitSha.make("f".repeat(40)),
            observedWorktree: WorktreeLocator.make("/tmp/issue-83-foreign-branch-owner"),
            reason: "DifferentHead",
            revision: BranchCleanupEvidenceRevision.make(2)
          })
        ]
      })
    ),
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

it.effect("projects Integrator candidate cleanup progress at each committed intent/result cursor", () =>
  Effect.gen(function* () {
    const records = yield* candidateCleanupRecords()
    const reader = makeTraceReader({ read: () => Effect.succeed(records) })
    const positionOf = (tag: string, occurrence = 0): Effect.Effect<JournalPosition> => {
      const matches = records.filter(({ event }) => event._tag === tag)
      const match = matches[occurrence]
      return match === undefined
        ? Effect.die(`candidate fixture is missing ${tag} #${occurrence}`)
        : Effect.succeed(match.position)
    }
    const readAt = (position: JournalPosition) => reader.readAt(TraceCursor.make({ position, runId: cleanupRunId }))
    const mutationIntentPosition = yield* positionOf("IntegratorCandidateCleanupMutationIntended")
    const mutationResultPosition = yield* positionOf("IntegratorCandidateCleanupMutationResultRecorded")
    const secondObservationIntentPosition = yield* positionOf("IntegratorCandidateCleanupObservationIntended", 1)
    const absentPosition = yield* positionOf("IntegratorCandidateCleanupObserved", 1)
    const settledPosition = yield* positionOf("IntegratorCandidateCleanupSettled")

    const pending = yield* readAt(mutationIntentPosition)
    const pendingCleanup = pending.facets.controlDisposition.cleanup[0]
    expect(pendingCleanup?._tag).toBe("IntegratorCandidate")
    if (pendingCleanup?._tag !== "IntegratorCandidate") return
    expect(pendingCleanup.status).toEqual({
      _tag: "MutationPending",
      source: { runId: cleanupRunId, position: mutationIntentPosition }
    })
    expect(pendingCleanup.steps.map(({ source }) => source.position)).toEqual(
      records
        .filter(
          ({ event }) =>
            event._tag === "IntegratorCandidateCleanupAuthorized" ||
            event._tag === "IntegratorCandidateCleanupObservationIntended" ||
            event._tag === "IntegratorCandidateCleanupObserved" ||
            event._tag === "IntegratorCandidateCleanupMutationIntended"
        )
        .filter(({ position }) => position <= mutationIntentPosition)
        .map(({ position }) => position)
    )
    expect(pendingCleanup.steps.some(({ source }) => source.position === mutationResultPosition)).toBe(false)

    const result = yield* readAt(mutationResultPosition)
    const resultCleanup = result.facets.controlDisposition.cleanup[0]
    expect(resultCleanup?._tag).toBe("IntegratorCandidate")
    if (resultCleanup?._tag !== "IntegratorCandidate") return
    expect(resultCleanup.status).toEqual({
      _tag: "MutationResultRecorded",
      result: "Removed",
      source: { runId: cleanupRunId, position: mutationResultPosition }
    })

    const observationPending = yield* readAt(secondObservationIntentPosition)
    const observationPendingCleanup = observationPending.facets.controlDisposition.cleanup[0]
    expect(observationPendingCleanup?._tag).toBe("IntegratorCandidate")
    if (observationPendingCleanup?._tag !== "IntegratorCandidate") return
    expect(observationPendingCleanup.status).toEqual({
      _tag: "ObservationPending",
      source: { runId: cleanupRunId, position: secondObservationIntentPosition }
    })

    const absent = yield* readAt(absentPosition)
    const absentCleanup = absent.facets.controlDisposition.cleanup[0]
    expect(absentCleanup?._tag).toBe("IntegratorCandidate")
    if (absentCleanup?._tag !== "IntegratorCandidate") return
    expect(absentCleanup.status).toEqual({ _tag: "Absent", source: { runId: cleanupRunId, position: absentPosition } })

    const settled = yield* readAt(settledPosition)
    const settledCleanup = settled.facets.controlDisposition.cleanup[0]
    expect(settledCleanup?._tag).toBe("IntegratorCandidate")
    if (settledCleanup?._tag !== "IntegratorCandidate") return
    expect(settledCleanup.status).toEqual({
      _tag: "Settled",
      result: "Removed",
      source: { runId: cleanupRunId, position: settledPosition }
    })
    expect(settledCleanup.steps.map(({ event }) => event._tag)).toEqual([
      "IntegratorCandidateCleanupAuthorized",
      "IntegratorCandidateCleanupObservationIntended",
      "IntegratorCandidateCleanupObserved",
      "IntegratorCandidateCleanupMutationIntended",
      "IntegratorCandidateCleanupMutationResultRecorded",
      "IntegratorCandidateCleanupObservationIntended",
      "IntegratorCandidateCleanupObserved",
      "IntegratorCandidateCleanupAbsenceConfirmed",
      "IntegratorCandidateCleanupSettled"
    ])
    expect(settledCleanup.steps.map(({ source }) => source.runId)).toEqual(settledCleanup.steps.map(() => cleanupRunId))
  }).pipe(Effect.provide(candidateCleanupBoundaryLayer()), Effect.provide(memoryJournalTestLayer))
)

it.effect("projects a contradictory Integrator candidate observation at its exact source", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* establishCandidateCleanupPrefix()
    const outcome = yield* runIntegratorCandidateCleanup(candidateCleanupAuthorization)
    if (outcome._tag !== "Preserved") return yield* Effect.die("candidate contradiction fixture was not preserved")
    const records = yield* journal.read(cleanupRunId)
    const contradicted = records.find(({ event }) => event._tag === "IntegratorCandidateCleanupContradicted")
    if (contradicted === undefined)
      return yield* Effect.die("candidate contradiction fixture did not record its result")
    const view = yield* makeTraceReader({ read: journal.read }).readAt(
      TraceCursor.make({ position: contradicted.position, runId: cleanupRunId })
    )
    const cleanup = view.facets.controlDisposition.cleanup[0]
    expect(cleanup?._tag).toBe("IntegratorCandidate")
    if (cleanup?._tag !== "IntegratorCandidate") return
    expect(cleanup.status._tag).toBe("Contradicted")
    expect(cleanup.status.source.position).toBe(contradicted.position)
  }).pipe(
    Effect.provide(
      integratorCandidateCleanupTestLayer({
        observations: [
          IntegratorCandidateCleanupObservation.cases.Foreign.make({
            locator: candidateCleanupAuthorization.locator,
            observedSessionId: IntegratorSessionId.make("session:issue-83-foreign-candidate"),
            reason: "OtherSession",
            revision: IntegratorCandidateCleanupEvidenceRevision.make(2)
          })
        ]
      })
    ),
    Effect.provide(memoryJournalTestLayer)
  )
)

it.effect("reopens the exact candidate disposition and cleanup facet through memory and SQLite", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const settledCursorFor = (records: ReadonlyArray<JournalRecord>): Effect.Effect<TraceCursor> => {
        const settled = records.find(({ event }) => event._tag === "IntegratorCandidateCleanupSettled")
        return settled === undefined
          ? Effect.die("candidate fixture is missing settled cleanup")
          : Effect.succeed(TraceCursor.make({ position: settled.position, runId: cleanupRunId }))
      }
      const memory = yield* Effect.scoped(
        Effect.gen(function* () {
          const journal = yield* JournalStore
          const records = yield* candidateCleanupRecords()
          const cursor = yield* settledCursorFor(records)
          const first = yield* makeTraceReader({ read: journal.read }).readAt(cursor)
          const reopened = yield* makeTraceReader({ read: journal.read }).readAt(cursor)
          return { first, reopened }
        }).pipe(Effect.provide(candidateCleanupBoundaryLayer()), Effect.provide(memoryJournalTestLayer))
      )
      expect(memory.reopened).toEqual(memory.first)
      expect(memory.reopened.facets.controlDisposition.cleanup).toEqual(memory.first.facets.controlDisposition.cleanup)

      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-trace-issue-83-candidate-" })
      const filename = JournalDatabaseLocator.make(path.join(directory, "journal.sqlite"))
      const sqliteLayer = sqliteJournalTestLayer({ filename })
      const firstSqlite = yield* Effect.scoped(
        Effect.gen(function* () {
          const journal = yield* JournalStore
          const records = yield* candidateCleanupRecords()
          return yield* makeTraceReader({ read: journal.read }).readAt(yield* settledCursorFor(records))
        }).pipe(Effect.provide(candidateCleanupBoundaryLayer()), Effect.provide(sqliteLayer))
      )
      const reopenedSqlite = yield* Effect.scoped(
        Effect.gen(function* () {
          const journal = yield* JournalStore
          return yield* makeTraceReader({ read: journal.read }).readAt(
            TraceCursor.make({ position: JournalPosition.make(25), runId: cleanupRunId })
          )
        }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))
      )
      expect(reopenedSqlite).toEqual(firstSqlite)
      expect(reopenedSqlite.facets.controlDisposition).toEqual(firstSqlite.facets.controlDisposition)
    }).pipe(Effect.provide(nodeFileSystemAndPath))
  )
)

const worktreeContradictionView = (observation: WorktreeCleanupObservation) =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(cleanupRunId, FixtureTarget.make("issue-83-contradiction-target"), initialPolicy)
    yield* appendReplacementProvenance(attempt, worktreeSuccessor)
    const outcome = yield* runWorktreeCleanup(worktreeAuthorization)
    if (outcome._tag !== "Preserved") return yield* Effect.die("contradiction fixture did not preserve the worktree")
    const records = yield* journal.read(cleanupRunId)
    const contradictionRecord = records.find(({ event }) => event._tag === "WorktreeCleanupContradicted")
    if (contradictionRecord?.event._tag !== "WorktreeCleanupContradicted") {
      return yield* Effect.die("contradiction fixture did not record contradiction")
    }
    const view = yield* makeTraceReader({ read: () => Effect.succeed(records) }).readAt(
      TraceCursor.make({ position: contradictionRecord.position, runId: cleanupRunId })
    )
    return {
      cleanup: view.facets.controlDisposition.cleanup[0],
      contradictionDetail: contradictionRecord.event.detail,
      contradictionPosition: contradictionRecord.position
    }
  }).pipe(
    Effect.provide(worktreeCleanupTestLayer({ observations: [observation] })),
    Effect.provide(memoryJournalTestLayer)
  )

it.effect("preserves a contradictory worktree cleanup with its exact source identity", () =>
  Effect.gen(function* () {
    const { cleanup, contradictionDetail, contradictionPosition } = yield* worktreeContradictionView(
      WorktreeCleanupObservation.cases.Foreign.make({
        locator: attempt.worktree,
        observedBranch: TaskBranchRef.make("refs/heads/foreign"),
        observedHead: attempt.baseSha,
        reason: "OtherOwner",
        revision: WorktreeCleanupEvidenceRevision.make(1)
      })
    )
    expect(cleanup?._tag).toBe("Worktree")
    if (cleanup?._tag !== "Worktree") return
    expect(cleanup.status).toEqual({
      _tag: "Contradicted",
      detail: contradictionDetail,
      source: { runId: cleanupRunId, position: contradictionPosition }
    })
    expect(cleanup.steps.at(-1)?.event._tag).toBe("WorktreeCleanupContradicted")
    expect(cleanup.steps.at(-1)?.source.position).toBe(contradictionPosition)
  })
)

it.effect("keeps unreadable and unregistered worktree observations visibly distinct", () =>
  Effect.gen(function* () {
    const unreadable = yield* worktreeContradictionView(
      WorktreeCleanupObservation.cases.Unreadable.make({
        detail: "Git worktree metadata cannot be read",
        locator: attempt.worktree
      })
    )
    const unregistered = yield* worktreeContradictionView(
      WorktreeCleanupObservation.cases.Unregistered.make({
        locator: attempt.worktree,
        revision: WorktreeCleanupEvidenceRevision.make(2)
      })
    )
    expect(unreadable.cleanup?.status._tag).toBe("Contradicted")
    expect(unreadable.cleanup?.status).toEqual(
      expect.objectContaining({ detail: "Git worktree metadata cannot be read" })
    )
    expect(unregistered.cleanup?._tag).toBe("Worktree")
    if (unregistered.cleanup?._tag !== "Worktree") return
    expect(
      unregistered.cleanup.steps.some(
        ({ event }) => event._tag === "WorktreeCleanupObserved" && event.observation._tag === "Unregistered"
      )
    ).toBe(true)
  })
)
